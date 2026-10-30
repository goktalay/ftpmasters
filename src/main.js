'use strict';

const { app, BrowserWindow, ipcMain, safeStorage, shell, dialog, clipboard, nativeTheme } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const I18N = require('./i18n');
const { createRemote, friendlyError, PROTOCOLS } = require('./remote');
const { Session } = require('./session');
const { createAccount, API_BASE } = require('./account');
const { createSso } = require('./sso');
const { limiter } = require('./throttle');

// Arayüz dili: ayarlarda seçilen ya da sistem dili (desteklenmiyorsa İngilizce)
let t = I18N.createT('en');
const currentLang = () => (store && store.settings.language) || I18N.resolveLanguage(app.getLocale());
function applyLanguage() { t = I18N.createT(currentLang()); }

const ICON = path.join(__dirname, '..', 'build', 'icon.png');
const errText = (err) => friendlyError(err, t);

// ---------------------------------------------------------------------------
// Kalıcı depo (userData/store.json)
// ---------------------------------------------------------------------------
const storePath = () => path.join(app.getPath('userData'), 'store.json');

const defaultStore = () => ({
  folders: [],      // { id, name, parentId }
  connections: [],  // site kayıtları, bkz. conn:save
  syncMeta: {},     // senkron: öğe id -> { kind, hash, updated_at, rev, device, deleted }
  settings: {
    appTheme: 'system',     // 'dark' | 'light' | 'system' (Mastertool standardı: varsayılan Sistem)
    language: null,         // null = sistem dili
    speedLimitOn: false,    // global hız sınırı açık mı
    speedLimitKB: 1024,     // KB/sn
    maxConcurrent: 4,       // site başına aynı anda en fazla aktarım (genel)
    retryAttempts: 3,
    retryDelay: 10,         // sn
    transferType: 'binary', // 'binary' | 'ascii' | 'auto'
    conflict: 'overwrite',  // aynı adlı hedef: 'overwrite' | 'rename' | 'skip'
    localDir: os.homedir(),
    localWidth: 360,
    localOpen: true,
    transferWidth: 560,
    transferOpen: true,
    trCols: [200, 72, 150, 120],
    showHidden: true,
  },
});

let store = null;

function uid() {
  return crypto.randomBytes(8).toString('hex');
}

function loadStore() {
  applyLanguage();
  try {
    store = { ...defaultStore(), ...JSON.parse(fs.readFileSync(storePath(), 'utf8')) };
    store.settings = { ...defaultStore().settings, ...(store.settings || {}) };
    if (!store.syncMeta) store.syncMeta = {};
  } catch {
    store = defaultStore();
  }
  applyAppTheme();
  applyLanguage();
  applySpeedLimit();
}

// Gece / Gündüz / Sistem: tüm pencerelerin prefers-color-scheme'ini ve başlık çubuklarını belirler
function applyAppTheme() {
  const v = store.settings.appTheme;
  nativeTheme.themeSource = v === 'light' || v === 'system' ? v : 'dark';
}
const windowBg = () => (nativeTheme.shouldUseDarkColors ? '#0b0f17' : '#eef2f7');

function applySpeedLimit() {
  const s = store.settings;
  limiter.set(s.speedLimitOn ? Math.max(1, Number(s.speedLimitKB) || 0) : 0);
}

let saveTimer = null;
// Kütüphane değişikliği kaydedilir ve (3 sn sonra) senkron tetiklenir; cihaza özgü kayıtlar için { sync: false }
function saveStore({ sync = true } = {}) {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(writeStore, 150);
  if (sync && account) account.onLocalChange();
}
function writeStore() {
  saveTimer = null;
  fs.mkdirSync(path.dirname(storePath()), { recursive: true });
  fs.writeFileSync(storePath(), JSON.stringify(store, null, 2), 'utf8');
}

function encrypt(text) {
  if (!text) return '';
  if (safeStorage.isEncryptionAvailable()) return 'enc:' + safeStorage.encryptString(text).toString('base64');
  return 'b64:' + Buffer.from(text, 'utf8').toString('base64');
}

function decrypt(value) {
  if (!value) return '';
  if (value.startsWith('enc:')) return safeStorage.decryptString(Buffer.from(value.slice(4), 'base64'));
  if (value.startsWith('b64:')) return Buffer.from(value.slice(4), 'base64').toString('utf8');
  return value;
}

// Arayüze gönderilen kopya: şifreler asla renderer'a gitmez.
function publicStore() {
  return {
    folders: store.folders,
    settings: store.settings,
    connections: store.connections.map((c) => {
      const { password, passphrase, hostKey, ...rest } = c;
      return { ...rest, hasPassword: !!password, hasPassphrase: !!passphrase };
    }),
  };
}

function broadcastStore() {
  const data = publicStore();
  for (const w of BrowserWindow.getAllWindows()) w.webContents.send('store:changed', data);
}

// Kayıtlı sitenin çözülmüş (şifreli alanları açılmış) hali
function resolveConnection(id) {
  const c = store.connections.find((x) => x.id === id);
  if (!c) throw new Error(t('main.errConnNotFound'));
  return { ...c, password: decrypt(c.password), passphrase: decrypt(c.passphrase) };
}

// Formdan gelen veri; boş şifre alanı düzenlemede "değiştirme" anlamına gelir.
function mergeFormWithStored(form) {
  const stored = form.id ? store.connections.find((x) => x.id === form.id) : null;
  const sameHost = stored && stored.host === form.host && Number(stored.port) === Number(form.port);
  return {
    ...form,
    password: form.password || (stored && !form.clearPassword ? decrypt(stored.password) : ''),
    passphrase: form.passphrase || (stored ? decrypt(stored.passphrase) : ''),
    hostKey: sameHost ? stored.hostKey : null,
  };
}

// Sitenin aktarım seçenekleri: "Genel ayarları kullan" ise uygulama ayarlarından gelir
function siteOptions(id) {
  const s = store.settings;
  const c = store.connections.find((x) => x.id === id) || {};
  const custom = c.siteOptions === 'custom';
  return {
    maxConcurrent: custom ? c.maxConcurrent : s.maxConcurrent,
    retryAttempts: custom ? c.retryAttempts : s.retryAttempts,
    retryDelay: custom ? c.retryDelay : s.retryDelay,
    conflict: custom && c.conflict ? c.conflict : s.conflict,
    transferType: c.transferType && c.transferType !== 'global' ? c.transferType : s.transferType,
  };
}

// ---------------------------------------------------------------------------
// Mastertool hesabı (ftpmasters.com) ve uçtan uca şifreli senkron
// ---------------------------------------------------------------------------
let account = null;
let loginWindow = null;
let loginNotice = null; // giriş ekranında gösterilecek bilgi (ör. oturum süresi doldu)

// Cihazdaki ortak oturum (tüm Mastertool uygulamaları): Windows Kimlik Bilgisi Yöneticisi'nde ortak kimlik,
// %APPDATA%\Mastertool\sso-state.json'da durum işareti. Testlerde MASTERTOOL_SSO_DIR ve MASTERTOOL_SSO_MEMORY=1
// ile gerçek kimlik deposuna dokunmadan çalışır.
function createSharedSession() {
  const stateDir = process.env.MASTERTOOL_SSO_DIR || path.join(app.getPath('appData'), 'Mastertool');
  let memory = null;
  const keyring = process.env.MASTERTOOL_SSO_MEMORY === '1'
    ? { get: () => memory, set: (v) => { memory = String(v); }, del: () => { memory = null; } }
    : undefined;
  try {
    return createSso({ stateDir, ...(keyring ? { keyring } : {}) });
  } catch {
    return null; // kimlik deposu yüklenemezse uygulama ortak oturum olmadan çalışır
  }
}

// Başka bir Mastertool uygulamasında giriş yapıldı (ya da hesap değişti): giriş ekranını atla
function onSharedLogin({ backupFile }) {
  loginNotice = null;
  if (!mainWindow) createMainWindow();
  if (loginWindow) loginWindow.destroy();
  if (backupFile) mainWindow.webContents.once('did-finish-load', () => mainWindow.webContents.send('account:backup', backupFile));
  account.start();
}

const expireNotice = (code) => t({
  app_disabled: 'auth.errAppDisabled',
  wrong_app: 'auth.errWrongApp',
  signed_out_elsewhere: 'auth.signedOutElsewhere',
}[code] || 'auth.errSessionExpired');

function initAccount() {
  account = createAccount({
    sso: createSharedSession(),
    onSharedLogin,
    userDataDir: app.getPath('userData'),
    appVersion: app.getVersion(),
    encrypt,
    decrypt,
    getStore: () => store,
    // Senkrondan gelen kütüphaneyi uygula (yeni senkron tetiklemeden)
    replaceLibrary: ({ folders, connections, settings, syncMeta }) => {
      const prevLang = currentLang();
      Object.assign(store, { folders, connections, syncMeta });
      Object.assign(store.settings, settings);
      writeStore();
      applyAppTheme();
      applySpeedLimit();
      applyLanguage();
      broadcastStore();
      for (const s of sessions.values()) s.pump();
      if (currentLang() !== prevLang && mainWindow) mainWindow.webContents.reload();
    },
    persistStore: writeStore,
    // Başka bir hesapla giriş: önceki kütüphaneyi yedekle, temiz başla (yerel kopya silinmez)
    backupAndClearLibrary: () => {
      const hasData = store.connections.length || store.folders.length;
      let file = null;
      if (hasData) {
        file = path.join(app.getPath('userData'), `store-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
        fs.writeFileSync(file, JSON.stringify(store, null, 2), 'utf8');
      }
      Object.assign(store, { folders: [], connections: [], syncMeta: {} });
      writeStore();
      return file;
    },
    onStatus: (st) => {
      for (const w of BrowserWindow.getAllWindows()) w.webContents.send('account:status', st);
    },
    onSessionExpired: (code) => showLogin(expireNotice(code)),
    onUpdate: (info) => mainWindow && mainWindow.webContents.send('app:update', info),
  });
}

function createLoginWindow() {
  loginWindow = new BrowserWindow({
    width: 440,
    height: 640,
    resizable: false,
    maximizable: false,
    backgroundColor: windowBg(),
    title: 'FTP Masters',
    icon: ICON,
    autoHideMenuBar: true,
    webPreferences,
  });
  loginWindow.setMenuBarVisibility(false);
  loginWindow.loadFile(path.join(__dirname, 'renderer', 'login.html'));
  loginWindow.on('closed', () => (loginWindow = null));
}

// Oturum yoksa ya da düştüyse: giriş ekranını aç, diğer tüm pencereleri (site pencereleri dahil) kapat
function showLogin(notice) {
  loginNotice = notice || null;
  if (!loginWindow) createLoginWindow();
  else loginWindow.focus();
  for (const w of BrowserWindow.getAllWindows()) if (w !== loginWindow) w.destroy();
  mainWindow = null;
}

// ---------------------------------------------------------------------------
// Pencereler
// ---------------------------------------------------------------------------
let mainWindow = null;

const webPreferences = { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false };

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 760,
    minHeight: 500,
    backgroundColor: windowBg(),
    title: 'FTP Masters',
    icon: ICON,
    autoHideMenuBar: true,
    webPreferences,
  });
  mainWindow.setMenuBarVisibility(false);
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  mainWindow.on('closed', () => (mainWindow = null));
}

function showMainWindow() {
  if (!account || !account.isLoggedIn()) {
    if (loginWindow) {
      if (loginWindow.isMinimized()) loginWindow.restore();
      loginWindow.show();
      loginWindow.focus();
    } else showLogin();
    return;
  }
  if (!mainWindow) createMainWindow();
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function openSiteWindow(id) {
  if (!account || !account.isLoggedIn()) return;
  const c = store.connections.find((x) => x.id === id);
  if (!c) return;
  const win = new BrowserWindow({
    width: 1480,
    height: 860,
    minWidth: 900,
    minHeight: 480,
    backgroundColor: windowBg(),
    title: `${c.name} — FTP Masters`,
    icon: ICON,
    autoHideMenuBar: true,
    webPreferences,
  });
  win.setMenuBarVisibility(false);
  win.loadFile(path.join(__dirname, 'renderer', 'site.html'), { query: { id } });
  const wcId = win.webContents.id;
  win.on('close', (e) => {
    const s = sessions.get(wcId);
    if (!s || win.forceClose) return;
    const active = [...s.nodes.values()].some((n) => !n.isDir && ['queued', 'active', 'retry'].includes(n.status));
    if (!active) return;
    const choice = dialog.showMessageBoxSync(win, {
      type: 'question',
      buttons: [t('main.closeAnyway'), t('common.cancel')],
      defaultId: 1,
      cancelId: 1,
      title: 'FTP Masters',
      message: t('main.closeActive'),
    });
    if (choice !== 0) e.preventDefault();
  });
  win.on('closed', () => closeSession(wcId));
}

// ---------------------------------------------------------------------------
// Site oturumları (her site penceresi bir oturum)
// ---------------------------------------------------------------------------
const sessions = new Map(); // webContents.id -> Session

function closeSession(wcId) {
  const s = sessions.get(wcId);
  if (!s) return;
  sessions.delete(wcId);
  s.close();
}

function getSession(event) {
  const s = sessions.get(event.sender.id);
  if (!s) throw new Error(t('main.errNoSession'));
  return s;
}

function rememberHostKey(id, fingerprint) {
  const c = store.connections.find((x) => x.id === id);
  if (c && fingerprint && c.hostKey !== fingerprint) {
    c.hostKey = fingerprint;
    saveStore();
  }
}

// Hata mesajını kullanıcı dostu hale getirip fırlatır (renderer'a temiz metin gitsin)
const wrap = (fn) => async (event, arg) => {
  try {
    return await fn(event, arg);
  } catch (err) {
    throw new Error(errText(err));
  }
};

ipcMain.handle('site:open', async (event) => {
  const wc = event.sender;
  const id = new URL(wc.getURL()).searchParams.get('id');
  closeSession(wc.id);
  let conn;
  try {
    conn = resolveConnection(id);
  } catch (err) {
    return { ok: false, message: err.message };
  }
  const session = new Session({
    conn,
    options: () => siteOptions(id),
    send: (ch, data) => !wc.isDestroyed() && wc.send(ch, data),
    errText,
    onHostKey: (fp) => rememberHostKey(id, fp),
  });
  sessions.set(wc.id, session);
  try {
    const remote = await session.open();
    let home = '/';
    try { home = await remote.pwd(); } catch {}
    const startRemote = (conn.rememberLastDir && conn.lastRemoteDir) || conn.remoteDir || home;
    const startLocal = (conn.rememberLastDir && conn.lastLocalDir) || conn.localDir || store.settings.localDir || os.homedir();
    let info = '';
    try { info = await session.run((r) => r.info()); } catch {}
    return { ok: true, home, startRemote, startLocal, info };
  } catch (err) {
    closeSession(wc.id);
    return { ok: false, message: errText(err) };
  }
});

ipcMain.handle('site:list', wrap((event, { dir, refresh }) => getSession(event).list(dir, refresh)));

ipcMain.handle('site:stat', wrap((event, p) => getSession(event).run((r) => r.stat(p))));

ipcMain.handle('site:mkdir', wrap(async (event, p) => {
  const s = getSession(event);
  await s.run((r) => r.mkdir(p));
  s.invalidate(path.posix.dirname(p));
}));

ipcMain.handle('site:rename', wrap(async (event, { from, to }) => {
  const s = getSession(event);
  await s.run((r) => r.rename(from, to));
  s.invalidate(path.posix.dirname(from));
  s.invalidate(path.posix.dirname(to));
}));

ipcMain.handle('site:delete', wrap(async (event, items) => {
  const s = getSession(event);
  for (const it of items) {
    await s.run((r) => (it.isDir && !it.isLink ? r.removeDir(it.path) : r.removeFile(it.path)));
    s.invalidate(path.posix.dirname(it.path));
    s.invalidate(it.path);
  }
}));

ipcMain.handle('site:move', wrap((event, { items, dstDir }) => getSession(event).move(items, dstDir)));
ipcMain.handle('site:copy', wrap((event, { items, dstDir }) => getSession(event).copy(items, dstDir)));

ipcMain.handle('site:download', (event, { items, localDir }) => getSession(event).download(items, localDir));
ipcMain.handle('site:upload', (event, { paths, remoteDir }) => getSession(event).upload(paths, remoteDir));

ipcMain.on('site:lastDir', (event, { remote, local }) => {
  const s = sessions.get(event.sender.id);
  if (!s) return;
  const c = store.connections.find((x) => x.id === s.conn.id);
  if (!c || !c.rememberLastDir) return;
  let changed = false;
  if (remote && c.lastRemoteDir !== remote) { c.lastRemoteDir = remote; changed = true; }
  if (local && c.lastLocalDir !== local) { c.lastLocalDir = local; changed = true; }
  if (changed) saveStore({ sync: false });
});

ipcMain.on('transfer:cancel', (event, id) => sessions.get(event.sender.id)?.cancel(id));
ipcMain.on('transfer:cancelAll', (event) => sessions.get(event.sender.id)?.cancelAll());
ipcMain.on('transfer:retry', (event, id) => sessions.get(event.sender.id)?.retry(id));
ipcMain.handle('transfer:clear', (event, ids) => sessions.get(event.sender.id)?.clear(ids) || []);

// ---------------------------------------------------------------------------
// Yerel (Windows) dosya yöneticisi
// ---------------------------------------------------------------------------
ipcMain.handle('local:list', async (_e, dir) => {
  const entries = await fs.promises.readdir(dir, { withFileTypes: true });
  const out = await Promise.all(entries.map(async (e) => {
    const full = path.join(dir, e.name);
    let size = 0;
    let mtime = 0;
    let isDir = e.isDirectory();
    try {
      const st = await fs.promises.stat(full);
      size = st.size;
      mtime = st.mtimeMs;
      isDir = st.isDirectory();
    } catch { /* erişilemeyen sistem dosyaları */ }
    return { name: e.name, path: full, isDir, size: isDir ? 0 : size, mtime };
  }));
  return out;
});

ipcMain.handle('local:drives', async () => {
  const drives = [];
  for (let c = 65; c <= 90; c++) {
    const d = String.fromCharCode(c) + ':\\';
    try {
      await fs.promises.access(d);
      drives.push(d);
    } catch {}
  }
  return drives;
});

ipcMain.handle('local:special', () => ({
  home: os.homedir(),
  desktop: app.getPath('desktop'),
  downloads: app.getPath('downloads'),
  documents: app.getPath('documents'),
}));

ipcMain.handle('local:open', (_e, p) => shell.openPath(p));
ipcMain.handle('local:reveal', (_e, p) => shell.showItemInFolder(p));
ipcMain.handle('local:mkdir', wrap((_e, p) => fs.promises.mkdir(p)));
ipcMain.handle('local:rename', wrap((_e, { from, to }) => fs.promises.rename(from, to)));
// Yerel silme Geri Dönüşüm Kutusu'na taşır (kalıcı silmez)
ipcMain.handle('local:trash', wrap(async (_e, paths) => { for (const p of paths) await shell.trashItem(p); }));
ipcMain.handle('local:exists', (_e, p) => fs.existsSync(p));

ipcMain.handle('clipboard:write', (_e, text) => clipboard.writeText(String(text ?? '')));

ipcMain.handle('dialog:pickFolder', async (event, defaultPath) => {
  const res = await dialog.showOpenDialog(BrowserWindow.fromWebContents(event.sender), {
    defaultPath: defaultPath || os.homedir(),
    properties: ['openDirectory', 'createDirectory'],
  });
  return res.canceled ? null : res.filePaths[0];
});

ipcMain.handle('dialog:pickKey', async (event) => {
  const res = await dialog.showOpenDialog(BrowserWindow.fromWebContents(event.sender), {
    title: t('main.pickKey'),
    defaultPath: path.join(os.homedir(), '.ssh'),
    properties: ['openFile', 'showHiddenFiles'],
  });
  return res.canceled ? null : res.filePaths[0];
});

// ---------------------------------------------------------------------------
// Depo işlemleri
// ---------------------------------------------------------------------------
ipcMain.handle('store:get', () => publicStore());

// --- Hesap ---------------------------------------------------------------------
ipcMain.handle('account:state', () => ({ ...account.state(), notice: loginNotice, appVersion: app.getVersion() }));

ipcMain.handle('account:login', async (_e, { email, password, remember }) => {
  try {
    const { backupFile } = await account.login(email, password, remember);
    loginNotice = null;
    // Önce ana pencere açılır, sonra giriş penceresi kapanır (aksi halde uygulama kapanırdı)
    if (!mainWindow) createMainWindow();
    if (loginWindow) loginWindow.destroy();
    if (backupFile) mainWindow.webContents.once('did-finish-load', () => mainWindow.webContents.send('account:backup', backupFile));
    account.start();
    return { ok: true };
  } catch (e) {
    return { ok: false, code: e.code || 'error', message: e.message };
  }
});

ipcMain.handle('account:logout', async () => {
  await account.logout();
  showLogin();
});

ipcMain.handle('account:syncNow', () => account.syncNow());
ipcMain.handle('account:setSync', async (_e, on) => {
  try { await account.setSyncEnabled(on); return { ok: true }; } catch (e) { return { ok: false, code: e.code }; }
});
ipcMain.handle('account:deleteRemote', async () => {
  try { await account.deleteRemote(); return { ok: true }; } catch (e) { return { ok: false, code: e.code }; }
});

// Mastertool düğmesi: portal, uygulamanın dili ve o anki gece/gündüz temasıyla tarayıcıda açılır
ipcMain.handle('app:openMastertool', () => {
  const theme = nativeTheme.shouldUseDarkColors ? 'dark' : 'light';
  shell.openExternal(`https://mastertool.download/?lang=${encodeURIComponent(currentLang())}&theme=${theme}`);
});

// Hesap sayfaları varsayılan tarayıcıda açılır (yalnız bu adresler)
// Web sayfaları uygulamanın diliyle ve o anki temasıyla açılır (Mastertool standardı)
const webQuery = () => `lang=${encodeURIComponent(currentLang())}&theme=${nativeTheme.shouldUseDarkColors ? 'dark' : 'light'}&app=fm`;

ipcMain.handle('account:openWeb', (_e, page) => {
  const allowed = { forgot: '/sifremi-unuttum', register: '/kayit', account: '/hesabim' };
  if (allowed[page]) shell.openExternal(`${API_BASE}${allowed[page]}?${webQuery()}`);
});

// Windows oturumu açılınca başlat (cihaza özgü; senkronlanmaz). Mastertool ortak iskeletiyle aynı
// argümanla kaydedilir; FTP Masters'ta tepsi olmadığından --hidden ile de normal açılır.
function applyOpenAtLogin() {
  if (!app.isPackaged) return;
  app.setLoginItemSettings({ openAtLogin: !!store.settings.openAtLogin, args: ['--hidden'] });
}

// Ayarlar > Hakkında
ipcMain.handle('app:about', () => ({
  version: app.getVersion(),
  electron: process.versions.electron,
  chrome: process.versions.chrome,
  openAtLogin: app.isPackaged ? app.getLoginItemSettings({ args: ['--hidden'] }).openAtLogin : !!store.settings.openAtLogin,
}));

// Chromium/Electron lisans dosyaları kurulum klasöründe durur
ipcMain.handle('app:openLicenses', () => {
  const file = path.join(path.dirname(process.execPath), 'LICENSES.chromium.html');
  if (fs.existsSync(file)) return shell.openPath(file);
  return shell.openExternal('https://www.electronjs.org/docs/latest#license');
});

// Ayarlar > Hakkında: güncelleme denetimi
ipcMain.handle('app:checkUpdate', async () => {
  try { return { ok: true, ...(await account.latestRelease()) }; } catch (e) { return { ok: false, code: e.code || 'error', message: e.message }; }
});
ipcMain.on('app:lang', (e) => { e.returnValue = currentLang(); });
ipcMain.on('app:version', (e) => { e.returnValue = app.getVersion(); });

const num = (v, def, min, max) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : def;
};
const oneOf = (v, list, def) => (list.includes(v) ? v : def);

ipcMain.handle('conn:save', (_e, form) => {
  let c = form.id ? store.connections.find((x) => x.id === form.id) : null;
  if (!c) {
    c = { id: uid(), createdAt: Date.now() };
    store.connections.push(c);
  }
  const protocol = oneOf(form.protocol, Object.keys(PROTOCOLS), 'ftp');
  // Host, port veya protokol değiştiyse eski SSH host anahtarını unut
  if (c.host && (c.host !== form.host || Number(c.port) !== Number(form.port) || c.protocol !== protocol)) c.hostKey = null;
  Object.assign(c, {
    // General
    name: String(form.name || form.host).trim(),
    host: String(form.host).trim(),
    username: String(form.username || '').trim(),
    loginMethod: oneOf(form.loginMethod, ['normal', 'anonymous'], 'normal'),
    authType: form.authType === 'key' ? 'key' : 'password',
    keyPath: form.keyPath || '',
    comments: form.comments || '',
    folderId: form.folderId ?? c.folderId ?? null,
    color: form.color || c.color || '#22d3ee',
    // Actions
    remoteDir: String(form.remoteDir || '').trim(),
    localDir: String(form.localDir || '').trim(),
    rememberLastDir: !!form.rememberLastDir,
    cacheMode: oneOf(form.cacheMode, ['session', 'always', 'never'], 'session'),
    uploadCase: oneOf(form.uploadCase, ['preserve', 'lower', 'upper'], 'preserve'),
    // Type
    protocol,
    port: num(form.port, PROTOCOLS[protocol].port, 1, 65535),
    transferType: oneOf(form.transferType, ['global', 'binary', 'ascii', 'auto'], 'global'),
    timezone: num(form.timezone, 0, -14, 14),
    // Options
    siteOptions: oneOf(form.siteOptions, ['global', 'custom'], 'global'),
    retryAttempts: num(form.retryAttempts, 3, 0, 99),
    retryDelay: num(form.retryDelay, 10, 0, 3600),
    maxConcurrent: num(form.maxConcurrent, 4, 1, 20),
    conflict: oneOf(form.conflict, ['overwrite', 'rename', 'skip'], 'overwrite'),
    encoding: oneOf(form.encoding, ['auto', 'utf8', 'ascii'], 'auto'),
  });
  if (!c.rememberLastDir) { c.lastRemoteDir = ''; c.lastLocalDir = ''; }
  if (form.password) c.password = encrypt(form.password);
  if (form.clearPassword) c.password = '';
  if (form.passphrase) c.passphrase = encrypt(form.passphrase);
  if (form.testedHostKey && !c.hostKey) c.hostKey = form.testedHostKey;
  saveStore();
  broadcastStore();
  for (const s of sessions.values()) if (s.conn.id === c.id) s.pump();
  return c.id;
});

ipcMain.handle('conn:delete', (_e, id) => {
  store.connections = store.connections.filter((c) => c.id !== id);
  saveStore();
  broadcastStore();
});

ipcMain.handle('conn:duplicate', (_e, id) => {
  const c = store.connections.find((x) => x.id === id);
  if (!c) return;
  store.connections.push({ ...c, id: uid(), name: c.name + t('main.copySuffix'), createdAt: Date.now(), lastRemoteDir: '', lastLocalDir: '' });
  saveStore();
  broadcastStore();
});

ipcMain.handle('conn:move', (_e, { id, folderId }) => {
  const c = store.connections.find((x) => x.id === id);
  if (c) c.folderId = folderId || null;
  saveStore();
  broadcastStore();
});

ipcMain.handle('conn:resetLastDir', (_e, id) => {
  const c = store.connections.find((x) => x.id === id);
  if (c) { c.lastRemoteDir = ''; c.lastLocalDir = ''; }
  saveStore();
  broadcastStore();
});

ipcMain.handle('conn:test', async (_e, form) => {
  const conn = mergeFormWithStored(form);
  if (!conn.host) return { ok: false, message: t('main.errHost') };
  if (conn.loginMethod !== 'anonymous' && !conn.username) return { ok: false, message: t('main.errUser') };
  const started = Date.now();
  let remote;
  try {
    remote = createRemote(conn);
    await remote.connect();
    const ms = Date.now() - started;
    let info = '';
    let home = '';
    try { info = await remote.info(); } catch {}
    try { home = await remote.pwd(); } catch {}
    let remoteDirOk = true;
    if (conn.remoteDir) {
      try { await remote.list(conn.remoteDir); } catch { remoteDirOk = false; }
    }
    return { ok: true, ms, info, home, remoteDirOk, fingerprint: remote.fingerprint, firstTime: remote.fingerprint && !conn.hostKey };
  } catch (err) {
    return { ok: false, message: errText(err) };
  } finally {
    if (remote) remote.close();
  }
});

ipcMain.handle('conn:open', (_e, id) => openSiteWindow(id));
ipcMain.handle('app:showMain', () => showMainWindow());

ipcMain.handle('folder:save', (_e, { id, name, parentId }) => {
  let f = id ? store.folders.find((x) => x.id === id) : null;
  if (!f) {
    f = { id: uid(), parentId: parentId || null };
    store.folders.push(f);
  }
  f.name = name.trim();
  saveStore();
  broadcastStore();
  return f.id;
});

ipcMain.handle('folder:move', (_e, { id, parentId }) => {
  // Bir klasörü kendi alt klasörüne taşımayı engelle
  let p = parentId;
  while (p) {
    if (p === id) return false;
    p = (store.folders.find((x) => x.id === p) || {}).parentId;
  }
  const f = store.folders.find((x) => x.id === id);
  if (f) f.parentId = parentId || null;
  saveStore();
  broadcastStore();
  return true;
});

ipcMain.handle('folder:delete', (_e, id) => {
  const f = store.folders.find((x) => x.id === id);
  if (!f) return;
  // İçerik üst klasöre taşınır
  for (const c of store.connections) if (c.folderId === id) c.folderId = f.parentId || null;
  for (const sub of store.folders) if (sub.parentId === id) sub.parentId = f.parentId || null;
  store.folders = store.folders.filter((x) => x.id !== id);
  saveStore();
  broadcastStore();
});

// Görünüm ayarları (panel genişlikleri vb.) sessizce kaydedilir, yayınlanmaz
const QUIET_SETTINGS = ['localWidth', 'localOpen', 'transferWidth', 'transferOpen', 'trCols', 'localDir', 'showHidden', 'openAtLogin'];

ipcMain.handle('settings:set', (_e, patch) => {
  Object.assign(store.settings, patch);
  saveStore({ sync: Object.keys(patch).some((k) => !QUIET_SETTINGS.includes(k)) });
  if ('appTheme' in patch) applyAppTheme();
  if ('speedLimitOn' in patch || 'speedLimitKB' in patch) applySpeedLimit();
  if ('openAtLogin' in patch) applyOpenAtLogin();
  if ('language' in patch) {
    applyLanguage();
    // Site pencereleri yeniden yüklenirse süren aktarımlar kesilir; yalnızca ana pencere yenilenir
    if (mainWindow) mainWindow.webContents.reload();
    if (loginWindow) loginWindow.webContents.reload();
    return;
  }
  if (Object.keys(patch).some((k) => !QUIET_SETTINGS.includes(k))) broadcastStore();
  // Eşzamanlı aktarım sınırı arttıysa bekleyen kuyrukları hemen ilerlet
  if ('maxConcurrent' in patch) for (const s of sessions.values()) s.pump();
});

// ---------------------------------------------------------------------------
app.setAppUserModelId('com.ftpmasters.app');

app.on('web-contents-created', (_e, wc) => {
  wc.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  wc.on('will-navigate', (e) => e.preventDefault());
});

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  // İkinci örnek (ör. Master Tool tepsi menüsünden açılış): gizli/simge durumundaki pencereyi öne getir.
  // Açılış henüz bitmediyse (hesap yüklenmeden) yok sayılır; ilk pencere zaten açılmak üzere.
  app.on('second-instance', () => { if (account) showMainWindow(); });

  app.whenReady().then(async () => {
    loadStore();
    initAccount();
    // Uygulama girişsiz açılmaz. Sırasıyla: kendi saklı oturumu ("Beni hatırla"; çevrimdışıyken yerel
    // kütüphaneyle), yoksa başka bir Mastertool uygulamasında açılmış ortak oturumla şifresiz giriş,
    // o da yoksa giriş ekranı. Başka uygulamadaki giriş/çıkışlar durum dosyasından izlenir.
    let r = { ok: account.isLoggedIn() };
    try { r = await account.resume(); } catch { r = { ok: account.isLoggedIn() }; }
    if (r.ok) {
      createMainWindow();
      account.start();
    } else {
      if (['app_disabled', 'signed_out_elsewhere'].includes(r.code)) loginNotice = expireNotice(r.code);
      createLoginWindow();
    }
    account.startWatching();
    app.on('activate', () => BrowserWindow.getAllWindows().length === 0 && showMainWindow());
  });

  app.on('window-all-closed', () => {
    if (saveTimer) { clearTimeout(saveTimer); writeStore(); }
    app.quit();
  });
}
