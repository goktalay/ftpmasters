'use strict';

const { contextBridge, ipcRenderer, webUtils } = require('electron');

const on = (channel) => (cb) => {
  const listener = (_e, data) => cb(data);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};

contextBridge.exposeInMainWorld('api', {
  // arayüz dili (açılışta senkron alınır ki ilk çizim doğru dilde olsun)
  lang: ipcRenderer.sendSync('app:lang'),
  version: ipcRenderer.sendSync('app:version'),

  // Mastertool hesabı ve senkron
  accountState: () => ipcRenderer.invoke('account:state'),
  login: (email, password, remember) => ipcRenderer.invoke('account:login', { email, password, remember }),
  logout: () => ipcRenderer.invoke('account:logout'),
  syncNow: () => ipcRenderer.invoke('account:syncNow'),
  setSyncEnabled: (on) => ipcRenderer.invoke('account:setSync', on),
  deleteRemoteLibrary: () => ipcRenderer.invoke('account:deleteRemote'),
  openWeb: (page) => ipcRenderer.invoke('account:openWeb', page), // 'forgot' | 'register' | 'account'
  onAccountStatus: on('account:status'),
  onUpdateAvailable: on('app:update'),
  onLibraryBackup: on('account:backup'),
  openMastertool: () => ipcRenderer.invoke('app:openMastertool'),
  checkUpdate: () => ipcRenderer.invoke('app:checkUpdate'),
  about: () => ipcRenderer.invoke('app:about'),
  openLicenses: () => ipcRenderer.invoke('app:openLicenses'),

  // depo
  getStore: () => ipcRenderer.invoke('store:get'),
  onStoreChanged: on('store:changed'),
  setSettings: (patch) => ipcRenderer.invoke('settings:set', patch),
  showMain: () => ipcRenderer.invoke('app:showMain'),

  // siteler
  saveConnection: (form) => ipcRenderer.invoke('conn:save', form),
  deleteConnection: (id) => ipcRenderer.invoke('conn:delete', id),
  duplicateConnection: (id) => ipcRenderer.invoke('conn:duplicate', id),
  moveConnection: (id, folderId) => ipcRenderer.invoke('conn:move', { id, folderId }),
  resetLastDir: (id) => ipcRenderer.invoke('conn:resetLastDir', id),
  testConnection: (form) => ipcRenderer.invoke('conn:test', form),
  openConnection: (id) => ipcRenderer.invoke('conn:open', id),
  pickKeyFile: () => ipcRenderer.invoke('dialog:pickKey'),
  pickFolder: (defaultPath) => ipcRenderer.invoke('dialog:pickFolder', defaultPath),

  // klasörler
  saveFolder: (f) => ipcRenderer.invoke('folder:save', f),
  moveFolder: (id, parentId) => ipcRenderer.invoke('folder:move', { id, parentId }),
  deleteFolder: (id) => ipcRenderer.invoke('folder:delete', id),

  // site penceresi: sunucu
  siteOpen: () => ipcRenderer.invoke('site:open'),
  siteList: (dir, refresh) => ipcRenderer.invoke('site:list', { dir, refresh }),
  siteStat: (p) => ipcRenderer.invoke('site:stat', p),
  siteMkdir: (p) => ipcRenderer.invoke('site:mkdir', p),
  siteRename: (from, to) => ipcRenderer.invoke('site:rename', { from, to }),
  siteDelete: (items) => ipcRenderer.invoke('site:delete', items),
  siteDownload: (items, localDir) => ipcRenderer.invoke('site:download', { items, localDir }),
  siteUpload: (paths, remoteDir) => ipcRenderer.invoke('site:upload', { paths, remoteDir }),
  siteLastDir: (remote, local) => ipcRenderer.send('site:lastDir', { remote, local }),
  onSessionStatus: on('session:status'),

  // aktarımlar
  onTransferUpdate: on('transfer:update'),
  onTransferRootDone: on('transfer:rootDone'),
  transferCancel: (id) => ipcRenderer.send('transfer:cancel', id),
  transferCancelAll: () => ipcRenderer.send('transfer:cancelAll'),
  transferRetry: (id) => ipcRenderer.send('transfer:retry', id),
  transferClear: (ids) => ipcRenderer.invoke('transfer:clear', ids),

  // yerel dosyalar
  localList: (dir) => ipcRenderer.invoke('local:list', dir),
  localDrives: () => ipcRenderer.invoke('local:drives'),
  localSpecial: () => ipcRenderer.invoke('local:special'),
  localOpen: (p) => ipcRenderer.invoke('local:open', p),
  localReveal: (p) => ipcRenderer.invoke('local:reveal', p),
  localMkdir: (p) => ipcRenderer.invoke('local:mkdir', p),
  localRename: (from, to) => ipcRenderer.invoke('local:rename', { from, to }),
  localTrash: (paths) => ipcRenderer.invoke('local:trash', paths),
  pathForFile: (file) => webUtils.getPathForFile(file),

  clipboardWrite: (t) => ipcRenderer.invoke('clipboard:write', t),
});
