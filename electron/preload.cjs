const { contextBridge, ipcRenderer } = require('electron');

const invoke = channel => (...args) => ipcRenderer.invoke(channel, ...args);
contextBridge.exposeInMainWorld('coco', {
  bootstrap: invoke('app:bootstrap'),
  saveSettings: invoke('settings:save'),
  testConnection: invoke('settings:test'),
  historyList: invoke('history:list'),
  historyGet: invoke('history:get'),
  createWorkspace: invoke('workspace:create'),
  closeWorkspace: invoke('workspace:close'),
  renameWorkspace: invoke('workspace:rename'),
  activateWorkspace: invoke('workspace:activate'),
  layout(wsId, rects) { ipcRenderer.send('tiles:layout', wsId, rects); },
  addTile: invoke('tile:add'),
  openTile: invoke('tile:open'),
  closeTile: invoke('tile:close'),
  navTile: invoke('tile:nav'),
  focusTile: invoke('tile:focus'),
  chooseFolder: invoke('folder:choose'),
  clearFolder: invoke('folder:clear'),
  folderFiles: invoke('folder:files'),
  revealFolder: invoke('folder:reveal'),
  apps: invoke('apps:list'),
  windows: invoke('windows:list'),
  send: invoke('agent:send'),
  pause: invoke('agent:pause'),
  resume: invoke('agent:resume'),
  stop: invoke('agent:stop'),
  answer: invoke('agent:answer'),
  reset: invoke('agent:reset'),
  windowAction: invoke('window:action'),
  onEvent(callback) {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('coco:event', listener);
    return () => ipcRenderer.removeListener('coco:event', listener);
  },
});
