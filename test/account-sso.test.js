'use strict';
// Ortak oturum (SSO) — sözleşmeyi taklit eden sahte sunucu ve aynı ortak kimliği paylaşan birden çok "uygulama".
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { memoryKeyring, tmpDir } = require('./helpers');

const PASS = 'Gizli-Şifre1!';
const KDF = { alg: 'PBKDF2-SHA256', iter: 1000, salt: crypto.randomBytes(16).toString('base64') };

// --- Sahte sunucu ----------------------------------------------------------------------
const srv = {
  authHash: null, appDisabled: false, requests: [],
  ssoTokens: new Set(), appTokens: new Map(), // app token -> sso token | null
  library: { version: 0, blob: null },
};
const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (d) => (body += d));
  req.on('end', () => {
    const j = body ? JSON.parse(body) : {};
    srv.requests.push({ url: req.url, body: j });
    const send = (code, o) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
    const bearer = (req.headers.authorization || '').replace('Bearer ', '');
    const user = { id: 7, email: 'a@b.com', name: 'Ali' };
    const issue = (sso) => { const t = crypto.randomBytes(8).toString('hex'); srv.appTokens.set(t, sso); return t; };
    switch (req.url) {
      case '/api/fm/auth/prelogin': return send(200, { kdf: KDF });
      case '/api/fm/auth/login': {
        if (j.auth_hash !== srv.authHash) return send(401, { code: 'bad_credentials' });
        if (srv.appDisabled) return send(403, { code: 'app_disabled' });
        const sso = j.sso ? crypto.randomBytes(8).toString('hex') : null;
        if (sso) srv.ssoTokens.add(sso);
        return send(200, { token: issue(sso), ...(sso ? { sso_token: sso } : {}), user, kdf: KDF, sync_enabled: true });
      }
      case '/api/fm/auth/sso': {
        if (!srv.ssoTokens.has(j.sso_token)) return send(401, { code: 'session_expired' });
        if (srv.appDisabled) return send(403, { code: 'app_disabled' });
        return send(200, { token: issue(j.sso_token), user, kdf: KDF, sync_enabled: true });
      }
      case '/api/fm/auth/logout': {
        const sso = srv.appTokens.get(bearer);
        srv.appTokens.delete(bearer);
        if (sso) { // ortak oturumdan türetilmiş: tüm aile kapanır
          srv.ssoTokens.delete(sso);
          for (const [t, s] of srv.appTokens) if (s === sso) srv.appTokens.delete(t);
        }
        return send(200, { ok: true, sso_ended: !!sso });
      }
    }
    if (!srv.appTokens.has(bearer)) return send(401, { code: 'session_expired' });
    if (req.url === '/api/fm/me') return send(200, { user, kdf: KDF, sync_enabled: true });
    if (req.url === '/api/fm/library' && req.method === 'GET') return send(200, srv.library);
    if (req.url === '/api/fm/library' && req.method === 'PUT') {
      if ((j.base_version ?? 0) !== srv.library.version) return send(409, { code: 'conflict', ...srv.library });
      srv.library = { version: srv.library.version + 1, blob: j.blob };
      return send(200, { version: srv.library.version });
    }
    if (req.url === '/api/fm/releases/latest') return send(200, { version: null });
    send(404, { code: 'not_found' });
  });
});

let A; // account modülü (FTPM_API ayarlandıktan sonra yüklenir)
const { createSso } = require('../src/sso');

// Aynı ortak kimlik deposunu ve durum klasörünü paylaşan bir "uygulama"
function makeApp(shared, { sites = [] } = {}) {
  const dir = tmpDir('ftpm-app-');
  const store = { folders: [], connections: sites, syncMeta: {}, settings: { appTheme: 'dark', language: null } };
  const events = { expired: [], sharedLogin: 0 };
  const enc = (v) => 'b64:' + Buffer.from(v).toString('base64');
  const dec = (v) => (v.startsWith('b64:') ? Buffer.from(v.slice(4), 'base64').toString() : v);
  const sso = createSso({ keyring: shared.keyring, stateDir: shared.stateDir, pollMs: 40 });
  const acc = A.createAccount({
    userDataDir: dir, appVersion: '1.4.0', encrypt: enc, decrypt: dec, getStore: () => store,
    replaceLibrary: ({ folders, connections, settings, syncMeta }) => { Object.assign(store, { folders, connections, syncMeta }); Object.assign(store.settings, settings); },
    persistStore: () => {}, backupAndClearLibrary: () => null,
    onStatus: () => {}, onUpdate: () => {},
    onSessionExpired: (code) => events.expired.push(code),
    onSharedLogin: () => { events.sharedLogin++; },
    sso,
  });
  return { acc, store, events, sso, dir };
}

const sharedEnv = () => ({ keyring: memoryKeyring(), stateDir: tmpDir('ftpm-sso-') });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const site = (id, name) => ({ id, name, host: 'ftp.example.com', port: 21, protocol: 'ftp', username: 'u', password: '', createdAt: 1 });

test.before(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  process.env.FTPM_API = `http://127.0.0.1:${server.address().port}`;
  A = require('../src/account');
  srv.authHash = (await A.deriveKeys(PASS, KDF)).authHash;
});
test.after(() => server.close());
test.beforeEach(() => {
  srv.appDisabled = false;
  srv.requests = [];
  srv.library = { version: 0, blob: null };
});

test('şifreyle girişte sso:true gönderilir ve ortak kimlik sözleşmedeki biçimde yazılır', async () => {
  const env = sharedEnv();
  const app = makeApp(env);
  await app.acc.login('A@B.com', PASS, true);
  const req = srv.requests.find((r) => r.url === '/api/fm/auth/login');
  assert.equal(req.body.sso, true);
  assert.equal(req.body.app_version, '1.4.0');
  const raw = JSON.parse(env.keyring.peek());
  assert.deepEqual(Object.keys(raw), ['v', 'email', 'user', 'sso_token', 'master', 'kdf', 'at']);
  assert.equal(raw.email, 'a@b.com');
  assert.ok(srv.ssoTokens.has(raw.sso_token));
  // master'dan türetilen anahtar uygulamanın şifreleme anahtarıyla aynı (diğer uygulama aynı kütüphaneyi açabilsin)
  const viaMaster = A.encKeyFromMaster(Buffer.from(raw.master, 'base64'));
  assert.deepEqual(viaMaster, (await A.deriveKeys(PASS, KDF)).encKey);
  assert.equal(app.sso.readState().state, 'in');
  // ortak kimlikteki gizli değerler hesap dosyasına yazılmaz
  const file = fs.readFileSync(path.join(app.dir, 'account.json'), 'utf8');
  assert.ok(!file.includes(raw.sso_token) && !file.includes(raw.master));
});

test('ikinci uygulama şifre sormadan açılır ve aynı şifreli kütüphaneyi okur', async () => {
  const env = sharedEnv();
  const a = makeApp(env, { sites: [site('aaaaaaaaaaaaaaa1', 'Web')] });
  await a.acc.login('a@b.com', PASS, true);
  await a.acc.syncNow();
  const b = makeApp(env);
  const r = await b.acc.resume();
  assert.equal(r.ok, true);
  assert.ok(srv.requests.some((x) => x.url === '/api/fm/auth/sso' && x.body.sso_token && x.body.app_version === '1.4.0'));
  await b.acc.syncNow();
  assert.deepEqual(b.store.connections.map((c) => c.name), ['Web']);
});

test('giriş ekranındaki uygulama, başka uygulamada giriş yapılınca kendiliğinden açılır', async () => {
  const env = sharedEnv();
  const waiting = makeApp(env);
  assert.equal((await waiting.acc.resume()).ok, false);
  waiting.acc.startWatching();
  const other = makeApp(env);
  await other.acc.login('a@b.com', PASS, true);
  await wait(300);
  waiting.acc.stopWatching();
  assert.equal(waiting.events.sharedLogin, 1);
  assert.equal(waiting.acc.isLoggedIn(), true);
});

test('birinde çıkış yapılınca diğeri giriş ekranına döner; yerel siteler silinmez', async () => {
  const env = sharedEnv();
  const a = makeApp(env);
  await a.acc.login('a@b.com', PASS, true);
  const b = makeApp(env, { sites: [site('bbbbbbbbbbbbbbb1', 'Yerel')] });
  await b.acc.resume();
  b.acc.startWatching();
  await a.acc.logout();
  await wait(300);
  b.acc.stopWatching();
  assert.equal(env.keyring.peek(), null);
  assert.equal(a.sso.readState().state, 'out');
  assert.deepEqual(b.events.expired, ['signed_out_elsewhere']);
  assert.equal(b.acc.isLoggedIn(), false);
  assert.deepEqual(b.store.connections.map((c) => c.name), ['Yerel']);
});

test('uygulama kapalıyken başka yerde çıkış yapıldıysa açılışta giriş ekranı gelir', async () => {
  const env = sharedEnv();
  const a = makeApp(env);
  await a.acc.login('a@b.com', PASS, true);
  env.keyring.del(); // uygulama kapalıyken başka bir uygulama çıkış yaptı
  assert.deepEqual(await a.acc.resume(), { ok: false, code: 'signed_out_elsewhere' });
  assert.equal(a.acc.isLoggedIn(), false);
});

test('ortak oturum sunucuda bitmişse (401) ortak kimlik silinir, durum "out" olur', async () => {
  const env = sharedEnv();
  const a = makeApp(env);
  await a.acc.login('a@b.com', PASS, true);
  srv.ssoTokens.clear(); // şifre değişti / Hesabım > Oturumlar'dan kapatıldı
  const b = makeApp(env);
  const r = await b.acc.resume();
  assert.equal(r.ok, false);
  assert.equal(env.keyring.peek(), null);
  assert.equal(b.sso.readState().state, 'out');
});

test('lisans kapalıysa (403 app_disabled) mesaj verilir, ortak kimliğe dokunulmaz', async () => {
  const env = sharedEnv();
  const a = makeApp(env);
  await a.acc.login('a@b.com', PASS, true);
  srv.appDisabled = true;
  const b = makeApp(env);
  const r = await b.acc.resume();
  assert.deepEqual([r.ok, r.code], [false, 'app_disabled']);
  assert.notEqual(env.keyring.peek(), null);
});

test('istekte 401 session_expired → tüm aile için çıkış', async () => {
  const env = sharedEnv();
  const a = makeApp(env);
  await a.acc.login('a@b.com', PASS, true);
  srv.appTokens.clear();
  await a.acc.syncNow();
  assert.deepEqual(a.events.expired, ['session_expired']);
  assert.equal(env.keyring.peek(), null);
  assert.equal(a.sso.readState().state, 'out');
});

test('kimlik deposu olmadan (sso yok) eski davranış sürer', async () => {
  const dir = tmpDir('ftpm-app-');
  const acc = A.createAccount({
    userDataDir: dir, appVersion: '1.4.0', encrypt: (v) => v, decrypt: (v) => v,
    getStore: () => ({ folders: [], connections: [], syncMeta: {}, settings: {} }),
    replaceLibrary: () => {}, persistStore: () => {}, backupAndClearLibrary: () => null,
    onStatus: () => {}, onSessionExpired: () => {}, onUpdate: () => {},
  });
  await acc.login('a@b.com', PASS, true);
  const req = srv.requests.filter((r) => r.url === '/api/fm/auth/login').pop();
  assert.equal(req.body.sso, false);
  assert.equal(acc.isLoggedIn(), true);
});
