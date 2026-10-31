const { app, Menu, WebContentsView, screen, session } = require('electron');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { NativeHost } = require('./native.cjs');

const PARTITION = 'persist:coco-web';
const LABELS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const MAX_TILES = 12;
const JUNK_APP = /uninstall|卸载|readme|release notes|帮助|help|documentation|website|manual|license|许可|网站/i;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function normalizeUrl(input) {
  const text = String(input || '').trim();
  if (!text) throw new Error('请输入网址或搜索内容。');
  if (/^https?:\/\//i.test(text)) return new URL(text).href;
  if (/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/.*)?$/i.test(text)) return new URL(`http://${text}`).href;
  if (!/\s/.test(text) && /^[\w-]+(\.[\w-]+)+(:\d+)?([/?#].*)?$/.test(text)) return new URL(`https://${text}`).href;
  return `https://www.bing.com/search?q=${encodeURIComponent(text)}`;
}

function cleanApps(list) {
  const seen = new Set();
  return list.filter(item => {
    const key = `${item.name}\n${item.id}`;
    if (!item.name || !item.id || seen.has(key) || JUNK_APP.test(item.name) || /\.(txt|chm|pdf|html?|url|rtf|md)$/i.test(item.id)) return false;
    seen.add(key);
    return true;
  }).sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
}

function findApp(apps, query, android) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return null;
  const pool = android === undefined ? apps : apps.filter(item => item.android === Boolean(android));
  return pool.find(item => item.name.toLowerCase() === q) || pool.find(item => item.name.toLowerCase().startsWith(q)) || pool.find(item => item.name.toLowerCase().includes(q)) || null;
}

const READ_PAGE = `(() => {
  const controls = Array.from(document.querySelectorAll('a,button,input,textarea,select,[role="button"],[role="link"],[contenteditable="true"]'))
    .filter(el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; })
    .slice(0, 150).map((el, index) => {
      el.setAttribute('data-coco-id', String(index));
      return { element: index, tag: el.tagName.toLowerCase(), type: el.getAttribute('type') || undefined, text: (el.getAttribute('aria-label') || el.innerText || el.value || el.getAttribute('placeholder') || el.getAttribute('title') || '').trim().replace(/\\s+/g, ' ').slice(0, 120) };
    });
  return { title: document.title, url: location.href, text: (document.body ? document.body.innerText : '').slice(0, 16000), controls };
})()`;

const KEY_NAMES = { ENTER: 'Enter', RETURN: 'Enter', ESC: 'Escape', ESCAPE: 'Escape', TAB: 'Tab', SPACE: 'Space', BACKSPACE: 'Backspace', DELETE: 'Delete', DEL: 'Delete', UP: 'Up', DOWN: 'Down', LEFT: 'Left', RIGHT: 'Right', HOME: 'Home', END: 'End', PAGEUP: 'PageUp', PAGEDOWN: 'PageDown', INSERT: 'Insert', PLUS: 'Plus', MINUS: '-' };
const MODIFIERS = { CTRL: 'control', CONTROL: 'control', ALT: 'alt', SHIFT: 'shift', WIN: 'meta', META: 'meta', CMD: 'meta' };

function point(value, size) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > 1000) throw new Error('坐标必须在 0–1000 之间。');
  return Math.round(number / 1000 * (size - 1));
}

class WorkspaceManager {
  constructor({ win, emit, createEngine }) {
    Object.assign(this, { win, emit, createEngine });
    this.layoutHost = new NativeHost('layout');
    this.io = new NativeHost('io');
    this.workspaces = new Map();
    this.activeId = null;
    this.catalog = null;
    this.inputLock = Promise.resolve();
    this.placing = false;
    this.placeAgain = false;
    this.placeWaiters = [];
    this.rectWaiters = new Set();
    const handle = win.getNativeWindowHandle();
    this.owner = (handle.length >= 8 ? handle.readBigUInt64LE() : BigInt(handle.readUInt32LE())).toString();
    this.setupSession();
    for (const event of ['move', 'resize', 'restore', 'maximize', 'unmaximize', 'show', 'enter-full-screen', 'leave-full-screen']) win.on(event, () => this.schedulePlace());
    this.timer = setInterval(() => { if (this.hasNative()) this.schedulePlace(); }, 800);
  }

  setupSession() {
    const ses = session.fromPartition(PARTITION);
    const name = app.getName().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    ses.setUserAgent(ses.getUserAgent().replace(new RegExp(`\\s(?:${name}|Electron)\\/\\S+`, 'g'), ''));
    ses.setPermissionRequestHandler((_contents, permission, callback) => callback(['fullscreen', 'clipboard-sanitized-write'].includes(permission)));
    ses.on('will-download', (_event, item) => {
      const directory = path.join(app.getPath('downloads'), 'coco');
      fs.mkdirSync(directory, { recursive: true });
      const parsed = path.parse(path.basename(item.getFilename()) || 'download');
      let target = path.join(directory, parsed.base);
      for (let i = 1; fs.existsSync(target); i++) target = path.join(directory, `${parsed.name} (${i})${parsed.ext}`);
      item.setSavePath(target);
      this.emit({ type: 'notice', message: `正在下载到 ${target}` });
    });
  }

  // ---- state ----
  get(id) {
    const ws = this.workspaces.get(id);
    if (!ws) throw new Error('工作区不存在。');
    return ws;
  }
  tile(ws, id) {
    const tile = ws.tiles.get(id);
    if (!tile) throw new Error('拼贴不存在。');
    return tile;
  }
  tileByLabel(ws, label) {
    const key = String(label || '').trim().toUpperCase();
    const tile = [...ws.tiles.values()].find(item => item.label === key);
    if (!tile) throw new Error(`没有拼贴 ${label || '（未指定）'}。先用 tiles 的 list 查看。`);
    return tile;
  }
  publicTile(tile) {
    const { id, label, kind, title, url, status, error, canBack, canForward, hint } = tile;
    return { id, label, kind, title, url, status, error, canBack: Boolean(canBack), canForward: Boolean(canForward), hint };
  }
  state() { return [...this.workspaces.values()].map(ws => ({ id: ws.id, name: ws.name, tiles: [...ws.tiles.values()].map(tile => this.publicTile(tile)) })); }
  publish() { this.emit({ type: 'workspaces', workspaces: this.state() }); }
  hasNative() { for (const ws of this.workspaces.values()) for (const tile of ws.tiles.values()) if (tile.hwnd) return true; return false; }
  findByHwnd(hwnd) {
    for (const ws of this.workspaces.values()) for (const tile of ws.tiles.values()) if (tile.hwnd === hwnd) return { ws, tile };
    return null;
  }

  createWorkspace() {
    const used = new Set([...this.workspaces.values()].map(ws => ws.name));
    let n = 1;
    while (used.has(`coco ${n}`)) n++;
    const ws = { id: randomUUID(), name: `coco ${n}`, tiles: new Map(), rects: new Map(), focused: null, engine: null };
    this.workspaces.set(ws.id, ws);
    ws.engine = this.createEngine(ws);
    this.addTile(ws.id);
    if (!this.activeId) this.activeId = ws.id;
    return ws;
  }
  async closeWorkspace(id) {
    const ws = this.get(id);
    if (this.workspaces.size === 1) throw new Error('至少保留一个工作区。');
    ws.engine.stop();
    await ws.engine.runningPromise;
    await Promise.allSettled([...ws.tiles.keys()].map(tileId => this.closeTile(id, tileId, false)));
    this.workspaces.delete(id);
    if (this.activeId === id) this.activeId = this.workspaces.keys().next().value;
    this.publish();
    return this.activeId;
  }
  renameWorkspace(id, name) {
    const text = String(name || '').trim().slice(0, 24);
    if (!text) throw new Error('名称不能为空。');
    this.get(id).name = text;
    this.publish();
  }
  activate(id) {
    this.get(id);
    this.activeId = id;
    this.schedulePlace();
  }
  focusTile(wsId, tileId) {
    const ws = this.get(wsId);
    if (ws.tiles.has(tileId)) ws.focused = tileId;
  }

  addTile(wsId, hint = {}) {
    const ws = this.get(wsId);
    if (ws.tiles.size >= MAX_TILES) throw new Error(`一个工作区最多 ${MAX_TILES} 个拼贴。`);
    const used = new Set([...ws.tiles.values()].map(tile => tile.label));
    const label = [...LABELS].find(letter => !used.has(letter));
    const near = hint.near && ws.tiles.has(hint.near) ? hint.near : ws.focused;
    const tile = { id: randomUUID(), label, kind: 'empty', title: '新拼贴', url: '', status: 'idle', error: '', hint: { near, dir: ['right', 'down'].includes(hint.dir) ? hint.dir : 'auto' } };
    ws.tiles.set(tile.id, tile);
    ws.focused = tile.id;
    this.publish();
    return tile;
  }
  emptyTile(ws) {
    const focused = ws.tiles.get(ws.focused);
    if (focused?.kind === 'empty') return focused;
    return [...ws.tiles.values()].find(tile => tile.kind === 'empty') || null;
  }
  async closeTile(wsId, tileId, publish = true) {
    const ws = this.get(wsId);
    const tile = this.tile(ws, tileId);
    tile.closed = true;
    ws.tiles.delete(tileId);
    ws.rects.delete(tileId);
    if (ws.focused === tileId) ws.focused = [...ws.tiles.keys()].at(-1) || null;
    this.destroyView(tile);
    if (tile.hwnd) await this.layoutHost.call('close', { hwnd: tile.hwnd }).catch(() => {});
    if (publish) this.publish();
  }
  destroyView(tile) {
    if (!tile.view) return;
    const view = tile.view;
    tile.view = null;
    try { this.win.contentView.removeChildView(view); } catch {}
    if (!view.webContents.isDestroyed()) view.webContents.close();
  }
  reset(ws, tile, error = '') {
    this.destroyView(tile);
    Object.assign(tile, { hwnd: null, kind: 'empty', title: '新拼贴', url: '', status: 'idle', error, launch: null });
    this.publish();
  }

  async openTile(wsId, tileId, target = {}) {
    const ws = this.get(wsId);
    const tile = this.tile(ws, tileId);
    if (tile.kind !== 'empty' && tile.status !== 'error') throw new Error('这个拼贴已经打开了内容。');
    if (tile.kind !== 'empty') this.reset(ws, tile);
    ws.focused = tile.id;
    if (target.kind === 'web') return this.loadWeb(ws, tile, normalizeUrl(target.url));
    if (target.kind === 'app') return this.launch(ws, tile, { id: String(target.id || ''), name: String(target.name || '应用'), android: Boolean(target.android) });
    if (target.kind === 'window') return this.adoptExisting(ws, tile, String(target.hwnd || ''));
    throw new Error('未知的打开方式。');
  }

  // ---- web ----
  createView(ws, tile) {
    const view = new WebContentsView({ webPreferences: { partition: PARTITION, sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false, spellcheck: false } });
    view.setBackgroundColor('#ffffffff');
    view.setVisible(false);
    this.win.contentView.addChildView(view);
    const wc = view.webContents;
    const sync = () => {
      if (tile.view !== view || wc.isDestroyed()) return;
      tile.url = wc.getURL();
      tile.title = wc.getTitle() || tile.url;
      tile.canBack = wc.navigationHistory.canGoBack();
      tile.canForward = wc.navigationHistory.canGoForward();
      this.publish();
    };
    wc.setWindowOpenHandler(({ url }) => {
      if (/^https?:/i.test(url)) setImmediate(() => wc.loadURL(url).catch(() => {}));
      return { action: 'deny' };
    });
    wc.on('will-navigate', (event, url) => { if (!/^(https?|about|data|blob):/i.test(url)) event.preventDefault(); });
    wc.on('did-start-loading', () => { tile.status = 'loading'; tile.error = ''; this.publish(); this.schedulePlace(); });
    wc.on('did-stop-loading', () => { if (tile.status === 'loading') tile.status = 'ready'; sync(); });
    wc.on('did-navigate', sync);
    wc.on('did-navigate-in-page', sync);
    wc.on('page-title-updated', sync);
    wc.on('did-fail-load', (_event, code, description, _url, isMainFrame) => {
      if (!isMainFrame || code === -3) return;
      tile.status = 'error';
      tile.error = `${description || '页面加载失败'}（${code}）`;
      this.publish();
      this.schedulePlace();
    });
    wc.on('render-process-gone', () => { tile.status = 'error'; tile.error = '页面进程已退出，请刷新。'; this.publish(); });
    wc.on('focus', () => { ws.focused = tile.id; this.emit({ type: 'focus', wsId: ws.id, tileId: tile.id }); });
    wc.on('will-prevent-unload', event => event.preventDefault());
    wc.on('context-menu', (_event, params) => {
      const history = wc.navigationHistory;
      Menu.buildFromTemplate([
        { label: '后退', enabled: history.canGoBack(), click: () => history.goBack() },
        { label: '前进', enabled: history.canGoForward(), click: () => history.goForward() },
        { label: '刷新', click: () => wc.reload() },
        { type: 'separator' },
        { label: '剪切', role: 'cut', enabled: params.editFlags.canCut },
        { label: '复制', role: 'copy', enabled: params.editFlags.canCopy },
        { label: '粘贴', role: 'paste', enabled: params.editFlags.canPaste },
        { label: '全选', role: 'selectAll' },
      ]).popup({ window: this.win });
    });
    return view;
  }
  async loadWeb(ws, tile, url) {
    if (!tile.view) tile.view = this.createView(ws, tile);
    Object.assign(tile, { kind: 'web', url, title: new URL(url).hostname || url, status: 'loading', error: '' });
    this.publish();
    this.schedulePlace();
    await Promise.race([tile.view.webContents.loadURL(url).catch(() => {}), sleep(20000)]);
    return tile;
  }
  async waitLoad(wc, timeout = 15000) {
    await sleep(120);
    if (wc.isDestroyed() || !wc.isLoading()) return;
    await Promise.race([new Promise(resolve => wc.once('did-stop-loading', resolve)), sleep(timeout)]);
  }
  navigate(wsId, tileId, action, url) {
    const tile = this.tile(this.get(wsId), tileId);
    if (!tile.view) throw new Error('只有网页拼贴可以导航。');
    const wc = tile.view.webContents;
    if (action === 'back' && wc.navigationHistory.canGoBack()) wc.navigationHistory.goBack();
    else if (action === 'forward' && wc.navigationHistory.canGoForward()) wc.navigationHistory.goForward();
    else if (action === 'reload') wc.reload();
    else if (action === 'url') wc.loadURL(normalizeUrl(url)).catch(() => {});
  }

  // ---- native windows ----
  async apps(refresh = false) {
    if (!this.catalog || refresh) {
      this.catalog = this.io.call('apps', {}, 90000).then(result => ({ client: result.client, apps: cleanApps(result.apps || []) }));
      this.catalog.catch(() => { this.catalog = null; });
    }
    return this.catalog;
  }
  windows() { return this.layoutHost.call('windows', { exclude: process.pid }); }
  async desktopWindows() {
    return (await this.windows()).filter(item => !this.findByHwnd(item.hwnd)).map(({ hwnd, title, process: name }) => ({ hwnd, title, process: name }));
  }
  async launch(ws, tile, entry) {
    const catalog = await this.apps();
    Object.assign(tile, { kind: entry.android ? 'android' : 'app', title: entry.name, status: 'launching', error: '', launch: null });
    this.publish();
    try {
      const existing = await this.windows();
      const before = new Set(existing.map(item => item.hwnd));
      if (entry.android && !catalog.client) throw new Error('没有找到 WSA（Windows 安卓子系统）。');
      await this.io.call('launch', { app: entry.id, android: entry.android, client: catalog.client });
      // WSA names each Android window's class after its package, so an app that is already running is found directly.
      const running = entry.android && existing.find(item => item.className === entry.id && !this.findByHwnd(item.hwnd));
      tile.launch = running ? null : { before, package: entry.android ? entry.id : null };
      const found = running || await this.waitWindow(tile, before, entry.android ? entry.id : null, entry.android ? 60000 : 25000);
      await this.adopt(ws, tile, found);
      return tile;
    } catch (error) {
      if (!tile.closed) { tile.status = 'error'; tile.error = error.message; this.publish(); }
      throw error;
    }
  }
  // Launchers (explorer, WsaClient) rarely own the window they open, so the new window is found by diffing.
  async waitWindow(tile, before, androidPackage, timeout) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      await sleep(450);
      if (tile.closed) throw new Error('拼贴已关闭。');
      const fresh = (await this.windows()).filter(item => !before.has(item.hwnd) && !this.findByHwnd(item.hwnd));
      // Prefer the window named after the package; after half the wait, any new WSA window will do.
      const late = Date.now() > deadline - timeout / 2;
      const match = androidPackage ? fresh.find(item => item.className === androidPackage) || (late && fresh.find(item => /^WsaClient$/i.test(item.process))) : fresh[0];
      if (match) return match;
    }
    throw new Error(androidPackage ? '安卓应用窗口没有出现。WSA 首次启动较慢，可以稍后重试。' : '没有检测到新窗口。如果应用已经在运行，请在「窗口」里接入它。');
  }
  async adoptExisting(ws, tile, hwnd) {
    const found = (await this.windows()).find(item => item.hwnd === hwnd);
    if (!found) throw new Error('窗口已关闭或不可接入。');
    tile.launch = null;
    return this.adopt(ws, tile, found);
  }
  async adopt(ws, tile, found) {
    if (tile.closed) return tile;
    if (this.findByHwnd(found.hwnd)) throw new Error('该窗口已经在 coco 中。');
    await this.layoutHost.call('attach', { hwnd: found.hwnd, owner: this.owner });
    if (tile.kind === 'empty') tile.kind = /^WsaClient$/i.test(found.process) ? 'android' : 'app';
    Object.assign(tile, { hwnd: found.hwnd, process: found.process, title: found.title, status: 'ready', error: '', adoptedAt: Date.now() });
    this.publish();
    await this.flushPlacement();
    return tile;
  }
  windowGone(ws, tile) {
    // A splash screen often closes right after launch; keep looking for the real window for a while.
    if (tile.launch?.before && Date.now() - tile.adoptedAt < 20000 && !tile.relaunching) {
      tile.relaunching = true;
      Object.assign(tile, { hwnd: null, status: 'launching' });
      this.publish();
      this.waitWindow(tile, tile.launch.before, tile.launch.package, 20000)
        .then(found => this.adopt(ws, tile, found))
        .catch(() => { if (!tile.closed) this.reset(ws, tile, '应用窗口已关闭。'); })
        .finally(() => { tile.relaunching = false; });
      return;
    }
    this.reset(ws, tile, '应用窗口已关闭。');
  }

  // ---- placement ----
  setRects(wsId, rects) {
    const ws = this.workspaces.get(wsId);
    if (!ws || !rects || typeof rects !== 'object') return;
    for (const [tileId, rect] of Object.entries(rects)) {
      if (!ws.tiles.has(tileId)) continue;
      ws.rects.set(tileId, rect && [rect.x, rect.y, rect.width, rect.height].every(Number.isFinite) && rect.width > 8 && rect.height > 8
        ? { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) } : null);
    }
    for (const waiter of [...this.rectWaiters]) waiter();
    this.schedulePlace();
  }
  waitFor(predicate, timeout = 2500) {
    if (predicate()) return Promise.resolve(true);
    return new Promise(resolve => {
      const check = () => { if (predicate()) done(true); };
      const done = value => { clearTimeout(timer); this.rectWaiters.delete(check); resolve(value); };
      const timer = setTimeout(() => done(predicate()), timeout);
      this.rectWaiters.add(check);
    });
  }
  toScreen(rect) {
    const content = this.win.getContentBounds();
    const r = screen.dipToScreenRect(this.win, { x: content.x + rect.x, y: content.y + rect.y, width: rect.width, height: rect.height });
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  }
  schedulePlace() {
    if (this.placing) { this.placeAgain = true; return; }
    this.placing = true;
    this.applyPlacement().catch(() => {}).finally(() => {
      this.placing = false;
      if (this.placeAgain) { this.placeAgain = false; this.schedulePlace(); return; }
      for (const resolve of this.placeWaiters.splice(0)) resolve();
    });
  }
  flushPlacement() { return new Promise(resolve => { this.placeWaiters.push(resolve); this.schedulePlace(); }); }
  async applyPlacement() {
    if (!this.win || this.win.isDestroyed()) return;
    const visibleWindow = this.win.isVisible() && !this.win.isMinimized();
    const items = [];
    for (const ws of this.workspaces.values()) {
      const shown = visibleWindow && ws.id === this.activeId;
      for (const tile of ws.tiles.values()) {
        const rect = ws.rects.get(tile.id);
        if (tile.view) {
          // Hidden views keep their size so background captures match what the agent will click.
          const key = rect ? `${rect.x},${rect.y},${rect.width},${rect.height}` : '';
          if (rect && key !== tile.bounds) { tile.view.setBounds(rect); tile.bounds = key; }
          const visible = Boolean(shown && rect && tile.status !== 'error');
          if (visible !== tile.visible) { tile.view.setVisible(visible); tile.visible = visible; }
        }
        if (tile.hwnd) items.push(shown && rect ? { hwnd: tile.hwnd, ...this.toScreen(rect), show: true } : { hwnd: tile.hwnd, x: 0, y: 0, w: 0, h: 0, show: false });
      }
    }
    if (!items.length) return;
    let changed = false;
    for (const result of await this.layoutHost.call('place', { items })) {
      const found = this.findByHwnd(result.hwnd);
      if (!found) continue;
      if (!result.alive) this.windowGone(found.ws, found.tile);
      else if (result.title && result.title !== found.tile.title) { found.tile.title = result.title; changed = true; }
    }
    if (changed) this.publish();
  }
  // Desktop and Android apps take real mouse and keyboard input, so their workspace must be on screen first.
  async reveal(ws, tile) {
    if (this.activeId !== ws.id || !ws.rects.get(tile.id)) {
      this.activeId = ws.id;
      this.emit({ type: 'reveal', wsId: ws.id, tileId: tile.id });
      await this.waitFor(() => Boolean(ws.rects.get(tile.id)));
    }
    if (this.win.isMinimized()) this.win.restore();
    if (!this.win.isFocused()) { this.win.show(); this.win.focus(); }
    await this.flushPlacement();
    await sleep(120);
  }
  lock(work) {
    const run = this.inputLock.then(work, work);
    this.inputLock = run.catch(() => {});
    return run;
  }

  // ---- agent surface: everything here is scoped to one workspace ----
  describe(wsId) {
    const ws = this.get(wsId);
    return [...ws.tiles.values()].map(tile => {
      const rect = ws.rects.get(tile.id);
      return { tile: tile.label, kind: tile.kind, title: tile.title, url: tile.kind === 'web' ? tile.url : undefined, status: tile.status, error: tile.error || undefined, size: rect ? `${rect.width}×${rect.height}` : undefined, focused: ws.focused === tile.id || undefined };
    });
  }
  async agentOpenWeb(wsId, url) {
    const ws = this.get(wsId);
    const tile = this.emptyTile(ws) || this.addTile(wsId);
    await this.loadWeb(ws, tile, normalizeUrl(url));
    await this.waitFor(() => ws.rects.has(tile.id));
    return tile;
  }
  async agentOpenApp(wsId, name, android) {
    const ws = this.get(wsId);
    const catalog = await this.apps();
    const entry = findApp(catalog.apps, name, android);
    if (!entry) throw new Error(`没有找到应用「${name}」。用 tiles 的 apps 搜索准确名称。`);
    const tile = this.emptyTile(ws) || this.addTile(wsId);
    await this.waitFor(() => ws.rects.has(tile.id));
    return this.launch(ws, tile, entry);
  }
  async agentClose(wsId, label) { const ws = this.get(wsId); await this.closeTile(wsId, this.tileByLabel(ws, label).id); }
  async capture(wsId, label, max = 1400) {
    const ws = this.get(wsId);
    const tile = this.tileByLabel(ws, label);
    if (tile.kind === 'empty') throw new Error(`拼贴 ${tile.label} 还是空的。`);
    if (tile.status === 'launching') throw new Error(`拼贴 ${tile.label} 的应用还在启动。`);
    if (tile.view) {
      await this.waitFor(() => Boolean(ws.rects.get(tile.id)), 1500);
      const image = await tile.view.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true });
      if (image.isEmpty()) throw new Error('页面还没有渲染出来，请稍后再看。');
      const size = image.getSize();
      const scale = Math.min(1, max / Math.max(size.width, size.height));
      const output = scale < 1 ? image.resize({ width: Math.round(size.width * scale), quality: 'good' }) : image;
      const { width, height } = output.getSize();
      return { tile, dataUrl: `data:image/jpeg;base64,${output.toJPEG(80).toString('base64')}`, width, height };
    }
    if (!tile.hwnd) throw new Error(`拼贴 ${tile.label} 没有可观察的内容。`);
    return this.lock(async () => {
      await this.reveal(ws, tile);
      const file = path.join(os.tmpdir(), `coco-shot-${randomUUID()}.jpg`);
      try {
        const shot = await this.io.call('capture', { hwnd: tile.hwnd, max, path: file }, 20000);
        return { tile, dataUrl: `data:image/jpeg;base64,${fs.readFileSync(file).toString('base64')}`, width: shot.width, height: shot.height };
      } finally { fs.rm(file, { force: true }, () => {}); }
    });
  }
  async input(wsId, label, args) {
    const ws = this.get(wsId);
    const tile = this.tileByLabel(ws, label);
    if (tile.view) return this.webInput(tile, args);
    if (!tile.hwnd) throw new Error(`拼贴 ${tile.label} 没有可操作的内容。`);
    return this.lock(async () => { await this.reveal(ws, tile); await this.nativeInput(tile, args); });
  }
  nativeInput(tile, args) {
    const hwnd = tile.hwnd;
    const amount = Math.max(-20, Math.min(20, Number(args.amount) || 3));
    switch (args.action) {
      case 'click': case 'double_click': case 'right_click':
        return this.io.call('click', { hwnd, x: args.x, y: args.y, button: args.action === 'right_click' ? 'right' : 'left', count: args.action === 'double_click' ? 2 : 1 });
      case 'move': return this.io.call('move', { hwnd, x: args.x, y: args.y });
      case 'drag': return this.io.call('drag', { hwnd, x: args.x, y: args.y, toX: args.to_x, toY: args.to_y });
      case 'scroll': return this.io.call('scroll', { hwnd, x: args.x ?? 500, y: args.y ?? 500, amount: Math.round(-120 * amount) });
      case 'type':
        if (typeof args.text !== 'string' || !args.text || args.text.length > 5000) throw new Error('输入内容需为 1–5000 字。');
        return this.io.call('type', { hwnd, text: args.text }, 90000);
      case 'key':
        if (!args.key) throw new Error('请指定按键。');
        return this.io.call('key', { hwnd, key: String(args.key) });
      default: throw new Error('未知的操作。');
    }
  }
  webInput(tile, args) {
    const wc = tile.view.webContents;
    const bounds = tile.view.getBounds();
    const at = (x, y) => ({ x: point(x, bounds.width), y: point(y, bounds.height) });
    switch (args.action) {
      case 'click': case 'double_click': case 'right_click': {
        const p = at(args.x, args.y);
        const button = args.action === 'right_click' ? 'right' : 'left';
        wc.sendInputEvent({ type: 'mouseMove', ...p });
        for (let count = 1; count <= (args.action === 'double_click' ? 2 : 1); count++) {
          wc.sendInputEvent({ type: 'mouseDown', ...p, button, clickCount: count });
          wc.sendInputEvent({ type: 'mouseUp', ...p, button, clickCount: count });
        }
        return;
      }
      case 'move': wc.sendInputEvent({ type: 'mouseMove', ...at(args.x, args.y) }); return;
      case 'drag': {
        const a = at(args.x, args.y), b = at(args.to_x, args.to_y);
        wc.sendInputEvent({ type: 'mouseMove', ...a });
        wc.sendInputEvent({ type: 'mouseDown', ...a, button: 'left', clickCount: 1 });
        for (let i = 1; i <= 12; i++) wc.sendInputEvent({ type: 'mouseMove', x: Math.round(a.x + (b.x - a.x) * i / 12), y: Math.round(a.y + (b.y - a.y) * i / 12), modifiers: ['leftButtonDown'] });
        wc.sendInputEvent({ type: 'mouseUp', ...b, button: 'left', clickCount: 1 });
        return;
      }
      case 'scroll': {
        const p = at(args.x ?? 500, args.y ?? 500);
        const amount = Math.max(-20, Math.min(20, Number(args.amount) || 3));
        wc.sendInputEvent({ type: 'mouseMove', ...p });
        wc.sendInputEvent({ type: 'mouseWheel', ...p, deltaX: 0, deltaY: -100 * amount, canScroll: true });
        return;
      }
      case 'type':
        if (typeof args.text !== 'string' || !args.text || args.text.length > 5000) throw new Error('输入内容需为 1–5000 字。');
        return wc.insertText(args.text);
      case 'key': return this.webKey(wc, String(args.key || ''));
      default: throw new Error('未知的操作。');
    }
  }
  webKey(wc, chord) {
    const parts = chord.split('+').map(part => part.trim()).filter(Boolean);
    if (!parts.length) throw new Error('请指定按键。');
    const modifiers = parts.slice(0, -1).map(part => MODIFIERS[part.toUpperCase()]).filter(Boolean);
    const last = parts.at(-1);
    const keyCode = KEY_NAMES[last.toUpperCase()] || (last.length === 1 ? last.toUpperCase() : last);
    const char = keyCode === 'Enter' ? '\r' : keyCode === 'Space' ? ' ' : last.length === 1 ? (modifiers.includes('shift') ? last.toUpperCase() : last.toLowerCase()) : null;
    wc.sendInputEvent({ type: 'keyDown', keyCode, modifiers });
    if (char && !modifiers.some(m => ['control', 'alt', 'meta'].includes(m))) wc.sendInputEvent({ type: 'char', keyCode: char, modifiers });
    wc.sendInputEvent({ type: 'keyUp', keyCode, modifiers });
  }
  async web(wsId, label, args) {
    const ws = this.get(wsId);
    const tile = this.tileByLabel(ws, label);
    if (!tile.view) throw new Error(`拼贴 ${tile.label} 不是网页。`);
    const wc = tile.view.webContents;
    const element = () => {
      const id = Number(args.element);
      if (!Number.isInteger(id) || id < 0) throw new Error('请提供 read 结果中的元素编号。');
      return id;
    };
    switch (args.action) {
      case 'navigate': await this.loadWeb(ws, tile, normalizeUrl(args.url)); return { url: wc.getURL(), title: wc.getTitle() };
      case 'back': wc.navigationHistory.goBack(); await this.waitLoad(wc); return { url: wc.getURL(), title: wc.getTitle() };
      case 'forward': wc.navigationHistory.goForward(); await this.waitLoad(wc); return { url: wc.getURL(), title: wc.getTitle() };
      case 'reload': wc.reload(); await this.waitLoad(wc); return { url: wc.getURL(), title: wc.getTitle() };
      case 'read': return wc.executeJavaScript(READ_PAGE, true);
      case 'click_element': {
        const id = element();
        const center = await wc.executeJavaScript(`(() => { const el = document.querySelector('[data-coco-id="${id}"]'); if (!el) return null; el.scrollIntoView({ block: 'center', inline: 'center' }); const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`, true);
        if (!center) throw new Error('元素不存在，请重新 read。');
        await sleep(150);
        const zoom = wc.getZoomFactor();
        const p = { x: Math.round(center.x * zoom), y: Math.round(center.y * zoom) };
        wc.sendInputEvent({ type: 'mouseMove', ...p });
        wc.sendInputEvent({ type: 'mouseDown', ...p, button: 'left', clickCount: 1 });
        wc.sendInputEvent({ type: 'mouseUp', ...p, button: 'left', clickCount: 1 });
        return { clicked: id };
      }
      case 'fill': {
        const id = element();
        if (typeof args.text !== 'string') throw new Error('请提供要填写的文字。');
        const ok = await wc.executeJavaScript(`(() => { const el = document.querySelector('[data-coco-id="${id}"]'); if (!el) return false; el.scrollIntoView({ block: 'center' }); el.focus(); if (typeof el.select === 'function') el.select(); else document.execCommand('selectAll'); return true; })()`, true);
        if (!ok) throw new Error('元素不存在，请重新 read。');
        if (args.text) wc.insertText(args.text); else wc.sendInputEvent({ type: 'keyDown', keyCode: 'Delete' });
        return { filled: id };
      }
      default: throw new Error('未知的网页操作。');
    }
  }

  // Embedded windows go back to the desktop with their original frame; closing the owner would destroy them.
  async dispose() {
    clearInterval(this.timer);
    const releases = [];
    for (const ws of this.workspaces.values()) for (const tile of ws.tiles.values()) if (tile.hwnd) releases.push(this.layoutHost.call('release', { hwnd: tile.hwnd }, 4000).catch(() => {}));
    await Promise.race([Promise.allSettled(releases), sleep(5000)]);
    this.layoutHost.close();
    this.io.close();
  }
}

module.exports = { WorkspaceManager, normalizeUrl, cleanApps, findApp };
