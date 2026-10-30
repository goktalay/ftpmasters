'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const posix = require('path').posix;
const { Session, isInside } = require('../src/session');

// Bellek içi uzak dosya sistemi (remote.js ile aynı arayüz). Klasörler Set, dosyalar Buffer tutar.
function memoryRemote(files) {
  const dirs = new Set(['/']);
  const data = new Map();
  const addParents = (p) => { for (let d = posix.dirname(p); !dirs.has(d); d = posix.dirname(d)) dirs.add(d); };
  for (const [p, content] of Object.entries(files)) {
    if (p.endsWith('/')) { const d = p.slice(0, -1); dirs.add(d); addParents(d); } else { data.set(p, Buffer.from(content)); addParents(p); }
  }
  const missing = () => Object.assign(new Error('No such file'), { code: 2 });
  const children = (dir) => [...dirs, ...data.keys()].filter((p) => p !== '/' && posix.dirname(p) === dir);
  return {
    dirs, data, parallel: true, closed: false,
    async list(dir) {
      if (!dirs.has(dir)) throw missing();
      return children(dir).map((p) => ({ name: posix.basename(p), path: p, isDir: dirs.has(p), isLink: false, size: data.get(p)?.length || 0, mtime: 0 }));
    },
    async stat(p) {
      if (dirs.has(p)) return { isDir: true, size: 0 };
      if (data.has(p)) return { isDir: false, size: data.get(p).length };
      throw missing();
    },
    async exists(p) { return dirs.has(p) || data.has(p); },
    async mkdir(p) { if (dirs.has(p) || data.has(p)) throw new Error('exists'); dirs.add(p); },
    async rename(a, b) {
      if (!dirs.has(posix.dirname(b))) throw missing();
      if (data.has(a)) { data.set(b, data.get(a)); data.delete(a); return; }
      if (!dirs.has(a)) throw missing();
      for (const p of [...dirs]) if (p === a || p.startsWith(a + '/')) { dirs.delete(p); dirs.add(b + p.slice(a.length)); }
      for (const [p, v] of [...data]) if (p.startsWith(a + '/')) { data.delete(p); data.set(b + p.slice(a.length), v); }
    },
    async removeFile(p) { if (!data.delete(p)) throw missing(); },
    async download(src, local, onBytes) {
      if (!data.has(src)) throw missing();
      fs.writeFileSync(local, data.get(src));
      onBytes(data.get(src).length);
    },
    async upload(local, dst, onBytes) {
      if (!dirs.has(posix.dirname(dst))) throw missing();
      const buf = fs.readFileSync(local);
      data.set(dst, buf);
      onBytes(buf.length);
    },
    close() {},
  };
}

function session(remote, opts = {}) {
  const roots = [];
  const s = new Session({
    conn: { id: 'x', protocol: 'sftp', cacheMode: 'never' },
    options: () => ({ maxConcurrent: 2, retryAttempts: 0, retryDelay: 0, conflict: 'rename', ...opts }),
    send: (ch, d) => { if (ch === 'transfer:rootDone') roots.push(d); },
    errText: (err) => err.message,
  });
  s.browse = remote;
  s.roots = roots;
  return s;
}

// Kök kopyalamalar bitene kadar bekler
async function settle(s, count) {
  for (let i = 0; i < 200 && s.roots.length < count; i++) await new Promise((r) => setTimeout(r, 20));
  return s.roots;
}

test('isInside klasörün kendisini ve altını tanır, benzer adlı kardeşi tanımaz', () => {
  assert.equal(isInside('/a', '/a'), true);
  assert.equal(isInside('/a/b/c', '/a'), true);
  assert.equal(isInside('/ab', '/a'), false);
  assert.equal(isInside('/', '/a'), false);
});

test('taşıma dosya ve klasörleri tek yeniden adlandırmayla hedefe götürür', async () => {
  const r = memoryRemote({ '/www/a.txt': 'A', '/www/img/x.png': 'X', '/arsiv/': '' });
  const s = session(r);
  const res = await s.move([{ path: '/www/a.txt', name: 'a.txt', isDir: false }, { path: '/www/img', name: 'img', isDir: true }], '/arsiv');
  s.close();
  assert.deepEqual(res, { moved: 2, skipped: 0, failed: [] });
  assert.equal(r.data.get('/arsiv/a.txt').toString(), 'A');
  assert.equal(r.data.get('/arsiv/img/x.png').toString(), 'X');
  assert.equal(r.data.has('/www/a.txt'), false);
  assert.equal(r.dirs.has('/www/img'), false);
});

test('taşıma: klasör kendi içine ya da aynı klasöre taşınmaz', async () => {
  const r = memoryRemote({ '/www/img/x.png': 'X' });
  const s = session(r);
  const res = await s.move([{ path: '/www/img', name: 'img', isDir: true }], '/www/img');
  const same = await s.move([{ path: '/www/img', name: 'img', isDir: true }], '/www');
  s.close();
  assert.equal(res.skipped, 1);
  assert.equal(same.skipped, 1);
  assert.equal(r.data.get('/www/img/x.png').toString(), 'X');
});

test('taşıma: hedefte aynı ad varsa kurala göre yeniden adlandırır, atlar veya üzerine yazar', async () => {
  const files = () => ({ '/a/r.txt': 'yeni', '/b/r.txt': 'eski' });
  let r = memoryRemote(files());
  let s = session(r, { conflict: 'rename' });
  await s.move([{ path: '/a/r.txt', name: 'r.txt', isDir: false }], '/b');
  s.close();
  assert.equal(r.data.get('/b/r (1).txt').toString(), 'yeni');
  assert.equal(r.data.get('/b/r.txt').toString(), 'eski');

  r = memoryRemote(files());
  s = session(r, { conflict: 'skip' });
  const res = await s.move([{ path: '/a/r.txt', name: 'r.txt', isDir: false }], '/b');
  s.close();
  assert.equal(res.skipped, 1);
  assert.equal(r.data.has('/a/r.txt'), true);

  r = memoryRemote(files());
  s = session(r, { conflict: 'overwrite' });
  await s.move([{ path: '/a/r.txt', name: 'r.txt', isDir: false }], '/b');
  s.close();
  assert.equal(r.data.get('/b/r.txt').toString(), 'yeni');
});

test('taşıma hatası öğe bazında raporlanır, diğerleri taşınır', async () => {
  const r = memoryRemote({ '/a/1.txt': '1', '/a/2.txt': '2', '/b/': '' });
  const s = session(r);
  const res = await s.move([{ path: '/a/yok.txt', name: 'yok.txt', isDir: false }, { path: '/a/2.txt', name: '2.txt', isDir: false }], '/b');
  s.close();
  assert.equal(res.moved, 1);
  assert.deepEqual(res.failed.map((f) => f.name), ['yok.txt']);
  assert.equal(r.data.get('/b/2.txt').toString(), '2');
});

test('kopyalama klasörü alt klasörleriyle birlikte çoğaltır, kaynak yerinde kalır', async () => {
  const r = memoryRemote({ '/site/index.html': '<h1>', '/site/css/app.css': 'body{}', '/site/bos/': '', '/yedek/': '' });
  const s = session(r);
  await s.copy([{ path: '/site', name: 'site', isDir: true }], '/yedek');
  const roots = await settle(s, 1);
  s.close();
  assert.equal(roots[0].status, 'done');
  assert.equal(roots[0].kind, 'copy');
  assert.equal(r.data.get('/yedek/site/index.html').toString(), '<h1>');
  assert.equal(r.data.get('/yedek/site/css/app.css').toString(), 'body{}');
  assert.equal(r.dirs.has('/yedek/site/bos'), true);
  assert.equal(r.data.get('/site/index.html').toString(), '<h1>');
});

test('aynı klasöre kopyalama "ad (1)" olarak çoğaltır; klasör adında uzantı ayrılmaz', async () => {
  const r = memoryRemote({ '/w/a.txt': 'A', '/w/v1.2/x': 'X' });
  const s = session(r);
  await s.copy([{ path: '/w/a.txt', name: 'a.txt', isDir: false, size: 1 }, { path: '/w/v1.2', name: 'v1.2', isDir: true }], '/w');
  await settle(s, 2);
  s.close();
  assert.equal(r.data.get('/w/a (1).txt').toString(), 'A');
  assert.equal(r.data.get('/w/v1.2 (1)/x').toString(), 'X');
});

test('kopyalama klasörü kendi içine kopyalamaz', async () => {
  const r = memoryRemote({ '/w/a.txt': 'A' });
  const s = session(r);
  await s.copy([{ path: '/w', name: 'w', isDir: true }], '/w');
  await new Promise((res) => setTimeout(res, 50));
  s.close();
  assert.equal(s.roots.length, 0);
  assert.deepEqual([...r.data.keys()], ['/w/a.txt']);
});
