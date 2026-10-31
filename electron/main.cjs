const { app, BrowserWindow, ipcMain, safeStorage, dialog, nativeImage, nativeTheme, shell } = require('electron');
const path = require('node:path');
const { ConfigStore, validateSettings } = require('./config.cjs');
const { HistoryStore } = require('./history.cjs');
const { WorkspaceTools } = require('./tools.cjs');
const { WorkspaceManager } = require('./workspaces.cjs');
const { FolderStore } = require('./folder.cjs');
const { AgentEngine } = require('./agent.cjs');
const { requestResponse, responseText } = require('./provider.cjs');

app.setName('coco');
if (process.env.COCO_USER_DATA) app.setPath('userData', process.env.COCO_USER_DATA);
let win, config, history, manager;
let quitting = false, released = false;
const devUrl = process.env.COCO_DEV_URL;

function emit(event) { if (win && !win.isDestroyed()) win.webContents.send('coco:event', event); }
function thumb(dataUrl) {
  const image = nativeImage.createFromDataURL(dataUrl);
  const small = image.getSize().width > 480 ? image.resize({ width: 480, quality: 'good' }) : image;
  return `data:image/jpeg;base64,${small.toJPEG(70).toString('base64')}`;
}
function engines() { return [...(manager?.workspaces.values() || [])].flatMap(ws => [...ws.agents.values()].map(agent => agent.engine)); }
function engine(wsId, agentId) { return manager.agent(wsId, agentId).engine; }
function trusted(event) { return win && event.sender === win.webContents && event.senderFrame === win.webContents.mainFrame; }

function handle(channel, handler) {
  ipcMain.handle(channel, async (event, ...args) => {
    if (!trusted(event)) throw new Error('无效的客户端请求。');
    try { return { ok: true, data: await handler(...args) }; }
    catch (error) { return { ok: false, error: error.message || '操作失败。' }; }
  });
}

async function bootstrap() {
  const userData = app.getPath('userData');
  config = new ConfigStore(userData, safeStorage);
  history = new HistoryStore(userData);
  const folders = new FolderStore(userData);
  await config.load();
  await history.load();
  await folders.load();

  win = new BrowserWindow({
    width: 1480, height: 940, minWidth: 1040, minHeight: 640,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#161514' : '#f2f0ec', frame: false, show: false,
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    title: 'coco',
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true, devTools: !app.isPackaged },
  });
  manager = new WorkspaceManager({
    win, emit, folders,
    createEngine: (ws, agent) => new AgentEngine({ config, history, tools: new WorkspaceTools(manager, ws.id), emit: event => emit({ ...event, wsId: ws.id, agentId: agent.id }), thumb, workspace: ws, agent }),
  });
  manager.createWorkspace();

  handle('app:bootstrap', () => ({
    settings: config.public(), version: app.getVersion(), workspaces: manager.state(), activeId: manager.activeId,
    sessions: Object.fromEntries([...manager.workspaces.values()].flatMap(ws => [...ws.agents.values()].map(agent => [agent.id, structuredClone(agent.engine.tasks)]))),
  }));
  handle('settings:save', input => {
    if (engines().some(item => item.active())) throw new Error('请在 coco 停止工作后再修改设置。');
    return config.save(input);
  });
  handle('settings:test', async (input, vision = false) => {
    const checked = validateSettings(input);
    const settings = { ...checked, apiKey: String(input.apiKey || '').trim() || (input.clearApiKey ? '' : config.secret().apiKey) };
    const started = Date.now();
    const content = [{ type: 'input_text', text: vision ? 'Describe this app window in one short Chinese sentence. This is a connection test.' : 'Reply with OK. This is an API connection test.' }];
    // The vision test uses coco's own window, never the desktop.
    if (vision) { const image = await win.webContents.capturePage(); content.push({ type: 'input_image', image_url: thumb(image.toDataURL()), detail: 'low' }); }
    const result = await requestResponse(settings, [{ role: 'user', content }]);
    return { message: responseText(result) || '模型返回成功。', latency: Date.now() - started, vision };
  });
  handle('history:list', () => history.summaries());
  handle('history:get', id => history.get(String(id)));

  handle('workspace:create', () => { const ws = manager.createWorkspace(); manager.publish(); return ws.id; });
  handle('workspace:close', id => manager.closeWorkspace(id));
  handle('workspace:rename', (id, name) => manager.renameWorkspace(id, name));
  handle('workspace:activate', id => manager.activate(id));
  ipcMain.on('tiles:layout', (event, wsId, rects) => { if (trusted(event)) manager.setRects(wsId, rects); });
  handle('tile:add', (wsId, hint) => manager.addTile(wsId, hint || {}).id);
  handle('tile:open', async (wsId, tileId, target) => { await manager.openTile(wsId, tileId, target); });
  handle('tile:close', (wsId, tileId) => manager.closeTile(wsId, tileId));
  handle('tile:nav', (wsId, tileId, action, url) => manager.navigate(wsId, tileId, action, url));
  handle('tile:focus', (wsId, tileId) => manager.focusTile(wsId, tileId));
  handle('folder:choose', async wsId => {
    const ws = manager.get(wsId);
    const result = await dialog.showOpenDialog(win, { title: `选择「${ws.name}」的工作区文件夹`, defaultPath: ws.folder?.root, properties: ['openDirectory'] });
    return result.canceled ? null : manager.setFolder(wsId, result.filePaths[0]);
  });
  handle('folder:clear', wsId => manager.clearFolder(wsId));
  handle('folder:files', (wsId, query) => manager.folderFiles(wsId, query));
  handle('folder:reveal', async wsId => {
    const folder = manager.folderOf(wsId);
    if (!folder) throw new Error('这个工作区没有绑定文件夹。');
    const error = await shell.openPath(folder.root);
    if (error) throw new Error(error);
  });
  handle('apps:list', async refresh => (await manager.apps(Boolean(refresh))).apps);
  handle('windows:list', () => manager.desktopWindows());

  handle('agent:add', (wsId, hint) => manager.addAgent(wsId, hint || {}));
  handle('agent:close', (wsId, agentId) => manager.closeAgent(wsId, agentId));
  handle('agent:send', (wsId, text, agentId) => engine(wsId, agentId).send(text));
  handle('agent:pause', (wsId, agentId) => engine(wsId, agentId).pause());
  handle('agent:resume', (wsId, agentId) => engine(wsId, agentId).resume());
  handle('agent:stop', (wsId, agentId) => engine(wsId, agentId).stop());
  handle('agent:answer', (wsId, text, agentId) => engine(wsId, agentId).answer(text));
  handle('agent:reset', (wsId, agentId) => {
    const agent = manager.agent(wsId, agentId);
    agent.engine.reset();
    emit({ type: 'agent-reset', wsId, agentId: agent.id });
  });
  handle('window:action', action => {
    if (action === 'minimize') win.minimize();
    else if (action === 'maximize') win.isMaximized() ? win.unmaximize() : win.maximize();
    else if (action === 'close') win.close();
    else throw new Error('未知的窗口操作。');
  });

  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', event => event.preventDefault());
  win.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  win.once('ready-to-show', () => win.show());
  // Embedded apps are owned by this window; hand them back to the desktop before it is destroyed.
  win.on('close', event => {
    if (released) return;
    event.preventDefault();
    if (quitting) return;
    quitting = true;
    for (const item of engines()) item.stop();
    Promise.race([Promise.allSettled(engines().map(item => item.runningPromise)), new Promise(resolve => setTimeout(resolve, 3000))])
      .then(() => manager.dispose())
      .finally(() => { released = true; win.close(); });
  });
  win.on('closed', () => { win = null; });
  if (devUrl) {
    if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(devUrl)) throw new Error('开发地址必须为本机服务。');
    await win.loadURL(devUrl);
  } else await win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
  app.whenReady().then(bootstrap).catch(error => { dialog.showErrorBox('coco 无法启动', error.message); app.exit(1); });
  app.on('window-all-closed', () => app.quit());
}
