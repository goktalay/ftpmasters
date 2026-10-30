'use strict';

// Site oturumu: bir site penceresinin sunucu bağlantıları, dosya listeleme ve aktarım kuyruğu.
//
// - Gezinme için tek bir "browse" bağlantısı vardır; FTP aynı anda tek komut çalıştırabildiği
//   için bu bağlantıdaki çağrılar sıraya alınır.
// - Aktarımlar bir havuzdan bağlantı alır. FTP'de her eşzamanlı aktarım kendi bağlantısını açar
//   (site ayarındaki "aynı anda en fazla aktarım" kadar); SFTP'de tek SSH bağlantısı paylaşılır.
// - Sunucu içinde taşıma tek bir yeniden adlandırmadır (RNFR/RNTO, SFTP rename). Kopyalama için
//   FTP'de sunucu tarafı komut olmadığından her dosya geçici bir yerel dosya üzerinden indirilip
//   hedefe yüklenir; aktarım ağacında "copy" türünde görünür.
// - Her indirme/yükleme/kopyalama bir ağaç olarak tutulur (kök → klasörler → dosyalar). Klasörün boyutu ve
//   ilerlemesi alt dosyalarının toplamıdır. Değişiklikler toplanıp ~8 kez/sn arayüze gönderilir.

const fs = require('fs');
const os = require('os');
const path = require('path');
const posix = path.posix;
const crypto = require('crypto');
const { createRemote } = require('./remote');

const uid = () => crypto.randomBytes(6).toString('hex');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Uygulama boyunca saklanan listeleme önbelleği ("Her zaman önbellek kullan" seçeneği için)
const globalCache = new Map(); // connId -> Map(dir -> list)

class Session {
  /**
   * @param {object} o
   * @param {object} o.conn       çözülmüş site kaydı (şifreler açık)
   * @param {Function} o.options  () => { maxConcurrent, retryAttempts, retryDelay, conflict, transferType }
   * @param {Function} o.send     (channel, data) => void   arayüze mesaj
   * @param {Function} o.errText  (err) => string           kullanıcı dostu hata
   * @param {Function} o.onHostKey (fingerprint) => void
   */
  constructor({ conn, options, send, errText, onHostKey }) {
    this.conn = conn;
    this.options = options;
    this.send = send;
    this.errText = errText;
    this.onHostKey = onHostKey;
    this.browse = null;
    this.browseChain = Promise.resolve();
    this.cache = conn.cacheMode === 'always'
      ? (globalCache.get(conn.id) || globalCache.set(conn.id, new Map()).get(conn.id))
      : new Map();

    this.idle = [];      // boşta bekleyen FTP aktarım bağlantıları
    this.workers = 0;    // açık FTP aktarım bağlantısı sayısı
    this.waiters = [];   // bağlantı bekleyen aktarımlar

    this.queue = [];     // bekleyen dosya görevleri
    this.running = 0;
    this.tasks = new Map(); // nodeId -> görev (aktif/bekleyen)
    this.nodes = new Map(); // nodeId -> düğüm
    this.added = [];
    this.dirty = new Set();
    this.flushTimer = null;
    this.closed = false;
    this.keepAlive = setInterval(() => this.ping(), 45000);
  }

  // --- Bağlantı ---------------------------------------------------------------
  async open() {
    const r = createRemote(this.conn);
    await r.connect();
    if (r.fingerprint && this.onHostKey) this.onHostKey(r.fingerprint);
    this.browse = r;
    return r;
  }

  async ensureBrowse() {
    if (this.browse && !this.browse.closed) return this.browse;
    if (this.closed) throw new Error('Client is closed');
    if (!this.reconnecting) {
      this.send('session:status', { state: 'connecting' });
      this.reconnecting = this.open().finally(() => (this.reconnecting = null));
      this.reconnecting.then(
        () => this.send('session:status', { state: 'connected' }),
        () => this.send('session:status', { state: 'disconnected' })
      );
    }
    return this.reconnecting;
  }

  // Gezinme bağlantısında sıralı çağrı; bağlantı kopmuşsa bir kez yeniden bağlanıp dener
  run(fn) {
    const job = this.browseChain.then(async () => {
      try {
        return await fn(await this.ensureBrowse());
      } catch (err) {
        if (this.browse && this.browse.closed && !this.closed) return fn(await this.ensureBrowse());
        throw err;
      }
    });
    this.browseChain = job.catch(() => {});
    return job;
  }

  ping() {
    if (this.closed || !this.browse || this.browse.closed) return;
    this.run((r) => r.noop()).catch(() => {});
  }

  async list(dir, refresh) {
    if (!refresh && this.conn.cacheMode !== 'never' && this.cache.has(dir)) return this.cache.get(dir);
    const list = await this.run((r) => r.list(dir));
    if (this.conn.cacheMode !== 'never') this.cache.set(dir, list);
    return list;
  }

  invalidate(dir) {
    this.cache.delete(dir);
  }

  // --- Aktarım bağlantı havuzu -------------------------------------------------
  maxConcurrent() {
    return Math.max(1, Math.min(20, Number(this.options().maxConcurrent) || 1));
  }

  async acquire() {
    if (this.conn.protocol === 'sftp') return this.ensureBrowse();
    if (this.idle.length) {
      const r = this.idle.pop();
      if (!r.closed) return r;
      this.workers--;
    }
    if (this.workers < this.maxConcurrent()) {
      this.workers++;
      try {
        return await createRemote(this.conn).connect();
      } catch (err) {
        this.workers--;
        this.wakeWaiter();
        throw err;
      }
    }
    return new Promise((resolve) => this.waiters.push(resolve)).then(() => this.acquire());
  }

  release(r) {
    if (r === this.browse) return;
    if (this.closed || r.closed) { this.discard(r); return; }
    this.idle.push(r);
    this.wakeWaiter();
  }

  discard(r) {
    if (r === this.browse) return; // SFTP: gezinme bağlantısı ensureBrowse ile yeniden kurulur
    try { r.close(); } catch {}
    this.workers--;
    this.wakeWaiter();
  }

  wakeWaiter() {
    const w = this.waiters.shift();
    if (w) w();
  }

  // --- Aktarım ağacı -----------------------------------------------------------
  addNode(n) {
    const node = { size: 0, done: 0, status: 'queued', error: null, files: 0, finished: 0, failed: 0, active: 0, scanning: false, ...n, id: uid() };
    this.nodes.set(node.id, node);
    this.added.push(node);
    this.schedule();
    return node;
  }

  ancestors(node) {
    const out = [];
    let p = node.parentId && this.nodes.get(node.parentId);
    while (p) { out.push(p); p = p.parentId && this.nodes.get(p.parentId); }
    return out;
  }

  touch(node) {
    this.dirty.add(node.id);
    this.schedule();
  }

  schedule() {
    if (!this.flushTimer) this.flushTimer = setTimeout(() => this.flush(), 120);
  }

  // Klasör düğümünün durumu, alt dosyalarının sayaçlarından türetilir
  dirStatus(d) {
    if (d.cancelled && !d.active) return 'cancelled';
    if (d.scanning) return 'scanning';
    if (d.finished >= d.files) return d.failed ? 'error' : 'done';
    return d.active ? 'active' : 'queued';
  }

  flush() {
    this.flushTimer = null;
    if (this.closed) return;
    const now = Date.now();
    const changed = [];
    for (const id of this.dirty) {
      const n = this.nodes.get(id);
      if (!n) continue;
      if (n.isDir) n.status = this.dirStatus(n);
      const o = { id, size: n.size, done: n.done, status: n.status, error: n.error, files: n.files, finished: n.finished };
      if (!n.parentId) {
        // Kök düğüm için anlık hız (B/sn), kısa bir pencerede ölçülür
        const dt = now - (n.lastT || n.startT || now);
        if (dt >= 400) {
          n.speed = ((n.done - (n.lastDone || 0)) / dt) * 1000;
          n.lastT = now;
          n.lastDone = n.done;
        }
        o.speed = ['active', 'scanning', 'queued', 'retry'].includes(n.status) ? n.speed || 0 : 0;
        if (o.status !== n.reported && ['done', 'error', 'cancelled', 'skipped'].includes(o.status)) {
          n.reported = o.status;
          if (n.kind === 'upload' || n.kind === 'copy') {
            this.invalidate(n.dstDir);
            for (const k of [...this.cache.keys()]) if (k === n.dst || k.startsWith(n.dst + '/')) this.cache.delete(k);
          }
          this.send('transfer:rootDone', { id, kind: n.kind, status: o.status, name: n.name, dstDir: n.dstDir, failed: n.failed });
        }
      }
      changed.push(o);
    }
    const added = this.added.map(({ id, parentId, rootId, name, isDir, kind, size, status, src, dst }) => ({ id, parentId, rootId, name, isDir, kind, size, status, src, dst }));
    this.added = [];
    this.dirty.clear();
    this.send('transfer:update', { added, changed });
    // Hâlâ süren aktarım varsa hız bilgisinin güncel kalması için kökleri tekrar işaretle
    for (const n of this.nodes.values()) {
      if (!n.parentId && ['active', 'scanning', 'queued', 'retry'].includes(this.dirStatusOrStatus(n))) this.touch(n);
    }
  }

  dirStatusOrStatus(n) { return n.isDir ? this.dirStatus(n) : n.status; }

  // Dosya düğümü eklendiğinde boyutunu ve dosya sayısını üst klasörlere yansıt
  registerFile(node) {
    for (const a of this.ancestors(node)) { a.size += node.size; a.files++; this.touch(a); }
    if (!node.parentId) node.files = 1;
  }

  addDone(node, n) {
    node.done += n;
    this.touch(node);
    for (const a of this.ancestors(node)) { a.done += n; this.touch(a); }
  }

  setFileStatus(node, status, error) {
    const prev = node.status;
    node.status = status;
    node.error = error || null;
    const wasActive = prev === 'active';
    const isActive = status === 'active';
    const finishedNow = ['done', 'error', 'cancelled', 'skipped'].includes(status) && !['done', 'error', 'cancelled', 'skipped'].includes(prev);
    const reopened = !['done', 'error', 'cancelled', 'skipped'].includes(status) && ['error', 'cancelled'].includes(prev);
    const targets = node.parentId ? this.ancestors(node) : [];
    if (!node.parentId) { node.finished = finishedNow ? 1 : reopened ? 0 : node.finished; node.failed = status === 'error' ? 1 : 0; }
    for (const a of targets) {
      if (wasActive !== isActive) a.active += isActive ? 1 : -1;
      if (finishedNow) { a.finished++; if (status === 'error') a.failed++; }
      if (reopened) { a.finished--; if (prev === 'error') a.failed--; }
      this.touch(a);
    }
    this.touch(node);
  }

  // --- Görev kuyruğu ------------------------------------------------------------
  enqueue(node) {
    const task = { node, ctl: {}, cancelled: false };
    this.tasks.set(node.id, task);
    this.queue.push(task);
    this.pump();
  }

  pump() {
    while (!this.closed && this.running < this.maxConcurrent() && this.queue.length) {
      const task = this.queue.shift();
      if (task.cancelled) { this.tasks.delete(task.node.id); continue; }
      this.running++;
      this.runTask(task).finally(() => {
        this.running--;
        this.tasks.delete(task.node.id);
        this.pump();
      });
    }
  }

  async runTask(task) {
    const node = task.node;
    const opts = this.options();
    const attempts = Math.max(0, Number(opts.retryAttempts) || 0);
    for (let attempt = 0; ; attempt++) {
      let remote = null;
      try {
        remote = await this.acquire();
        if (task.cancelled) { this.release(remote); return; }
        if (node.done) this.addDone(node, -node.done); // yeniden denemede baştan başla
        this.setFileStatus(node, 'active');
        const skipped = await this.transferFile(remote, node, task, opts);
        this.release(remote);
        this.setFileStatus(node, skipped ? 'skipped' : 'done');
        return;
      } catch (err) {
        if (remote) {
          if (remote.parallel && !remote.closed && !task.cancelled) this.release(remote); else this.discard(remote);
        }
        if (task.cancelled || this.closed) {
          await this.cleanupPartial(node);
          this.setFileStatus(node, 'cancelled');
          return;
        }
        const msg = this.errText(err);
        if (attempt < attempts && !(err && err.code === 550)) {
          this.setFileStatus(node, 'retry', msg);
          await sleep(Math.max(0, Number(opts.retryDelay) || 0) * 1000);
          if (task.cancelled) { this.setFileStatus(node, 'cancelled'); return; }
          continue;
        }
        this.setFileStatus(node, 'error', msg);
        return;
      }
    }
  }

  // Tek bir dosyayı aktarır; aynı adlı hedef "atla" kuralıyla geçildiyse true döner
  async transferFile(remote, node, task, opts) {
    const onBytes = (n) => this.addDone(node, n);
    if (node.kind === 'download') {
      let dst = node.dst;
      if (fs.existsSync(dst)) {
        if (opts.conflict === 'skip') return true;
        if (opts.conflict === 'rename') node.dst = dst = uniqueLocalPath(dst);
      }
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      node.partial = dst;
      await remote.download(node.src, dst, onBytes, task.ctl, opts);
      node.partial = null;
      if (node.mtime) fs.promises.utimes(dst, new Date(), new Date(node.mtime)).catch(() => {});
    } else if (node.kind === 'copy') {
      let dst = node.dst;
      if (opts.conflict !== 'overwrite' && (await remote.exists(dst))) {
        if (opts.conflict === 'skip') return true;
        node.dst = dst = await uniqueRemotePath(remote, dst);
      }
      // İndirme ve yükleme ilerlemenin yarısını oluşturur; içerik birebir kalsın diye ikili aktarılır
      const half = (n) => this.addDone(node, n / 2);
      const tmp = path.join(os.tmpdir(), `ftpm-copy-${uid()}`);
      try {
        await remote.download(node.src, tmp, half, task.ctl, { ...opts, transferType: 'binary' });
        node.partial = dst;
        await remote.upload(tmp, dst, half, task.ctl, { ...opts, transferType: 'binary' });
        node.partial = null;
      } finally {
        fs.promises.rm(tmp, { force: true }).catch(() => {});
      }
    } else {
      let dst = node.dst;
      if (opts.conflict !== 'overwrite' && (await remote.exists(dst))) {
        if (opts.conflict === 'skip') return true;
        node.dst = dst = await uniqueRemotePath(remote, dst);
      }
      node.partial = dst;
      await remote.upload(node.src, dst, onBytes, task.ctl, opts);
      node.partial = null;
    }
    return false;
  }

  async cleanupPartial(node) {
    const p = node.partial;
    if (!p) return;
    node.partial = null;
    if (node.kind === 'download') {
      // Windows'ta dosya kısa bir süre kilitli kalabilir
      for (let i = 0; i < 6; i++) {
        try { await fs.promises.rm(p, { force: true }); return; } catch { await sleep(400); }
      }
    } else {
      this.run((r) => r.removeFile(p)).catch(() => {});
    }
  }

  // --- İndirme / yükleme başlatma ------------------------------------------------
  caseName(name) {
    const rule = this.conn.uploadCase;
    if (rule === 'lower') return name.toLowerCase();
    if (rule === 'upper') return name.toUpperCase();
    return name;
  }

  // items: [{ path, name, isDir, size, mtime }] (uzak), localDir: hedef klasör
  download(items, localDir) {
    for (const it of items) {
      const dst = path.join(localDir, it.name);
      if (!it.isDir) {
        const node = this.addNode({ name: it.name, isDir: false, kind: 'download', src: it.path, dst, size: it.size || 0, mtime: it.mtime, dstDir: localDir, startT: Date.now() });
        node.rootId = node.id;
        this.registerFile(node);
        this.enqueue(node);
        continue;
      }
      const root = this.addNode({ name: it.name, isDir: true, kind: 'download', src: it.path, dst, dstDir: localDir, scanning: true, startT: Date.now() });
      root.rootId = root.id;
      this.scanRemote(root).catch((err) => {
        root.error = this.errText(err);
        root.failed++;
        root.scanning = false;
        this.touch(root);
      });
    }
  }

  // Uzak klasörü gezip dosyalarını kuyruğa ekler; hedef indirmede yerel, kopyalamada uzak klasördür
  async scanRemote(root) {
    const kind = root.kind;
    const join = kind === 'copy' ? posix.join : path.join;
    const remote = await this.acquire();
    try {
      const walk = async (dirNode) => {
        if (kind === 'copy') {
          try { await remote.mkdir(dirNode.dst); } catch { /* zaten var */ }
        } else {
          fs.mkdirSync(dirNode.dst, { recursive: true });
        }
        const list = await remote.list(dirNode.src);
        list.sort((a, b) => (b.isDir - a.isDir) || a.name.localeCompare(b.name));
        for (const e of list) {
          if (root.cancelled) return;
          if (e.isDir) {
            const d = this.addNode({ parentId: dirNode.id, rootId: root.id, name: e.name, isDir: true, kind, src: e.path, dst: join(dirNode.dst, e.name), scanning: true });
            await walk(d);
            d.scanning = false;
            this.touch(d);
          } else {
            const f = this.addNode({ parentId: dirNode.id, rootId: root.id, name: e.name, isDir: false, kind, src: e.path, dst: join(dirNode.dst, e.name), size: e.size || 0, mtime: e.mtime });
            this.registerFile(f);
            this.enqueue(f);
          }
        }
      };
      await walk(root);
    } finally {
      this.release(remote);
      root.scanning = false;
      for (const n of this.nodes.values()) if (n.rootId === root.id && n.isDir) { n.scanning = false; this.touch(n); }
      this.touch(root);
    }
  }

  // paths: yerel dosya/klasör yolları, remoteDir: hedef uzak klasör
  upload(paths, remoteDir) {
    for (const p of paths) {
      let st;
      try { st = fs.statSync(p); } catch { continue; }
      const name = this.caseName(path.basename(p));
      const dst = posix.join(remoteDir, name);
      if (!st.isDirectory()) {
        const node = this.addNode({ name: path.basename(p), isDir: false, kind: 'upload', src: p, dst, size: st.size, dstDir: remoteDir, startT: Date.now() });
        node.rootId = node.id;
        this.registerFile(node);
        this.enqueue(node);
        continue;
      }
      const root = this.addNode({ name: path.basename(p), isDir: true, kind: 'upload', src: p, dst, dstDir: remoteDir, scanning: true, startT: Date.now() });
      root.rootId = root.id;
      this.scanLocal(root).catch((err) => {
        root.error = this.errText(err);
        root.failed++;
        root.scanning = false;
        this.touch(root);
      });
    }
  }

  async scanLocal(root) {
    const remote = await this.acquire();
    try {
      const walk = async (dirNode) => {
        try { await remote.mkdir(dirNode.dst); } catch { /* zaten var */ }
        const entries = await fs.promises.readdir(dirNode.src, { withFileTypes: true });
        entries.sort((a, b) => (b.isDirectory() - a.isDirectory()) || a.name.localeCompare(b.name));
        for (const e of entries) {
          if (root.cancelled) return;
          const src = path.join(dirNode.src, e.name);
          const dst = posix.join(dirNode.dst, this.caseName(e.name));
          if (e.isDirectory()) {
            const d = this.addNode({ parentId: dirNode.id, rootId: root.id, name: e.name, isDir: true, kind: 'upload', src, dst, scanning: true });
            await walk(d);
            d.scanning = false;
            this.touch(d);
          } else if (e.isFile()) {
            let size = 0;
            try { size = (await fs.promises.stat(src)).size; } catch {}
            const f = this.addNode({ parentId: dirNode.id, rootId: root.id, name: e.name, isDir: false, kind: 'upload', src, dst, size });
            this.registerFile(f);
            this.enqueue(f);
          }
        }
      };
      await walk(root);
    } finally {
      this.release(remote);
      root.scanning = false;
      for (const n of this.nodes.values()) if (n.rootId === root.id && n.isDir) { n.scanning = false; this.touch(n); }
      this.touch(root);
    }
  }

  // --- Sunucu içinde taşıma / kopyalama ---------------------------------------------
  // items: [{ path, name, isDir }] (uzak), dstDir: sunucudaki hedef klasör.
  // Klasör kendi içine taşınamaz/kopyalanamaz; bu öğeler sessizce atlanır (arayüz önceden uyarır).

  // Her öğe tek bir yeniden adlandırmayla taşınır. Aynı klasöre taşıma bir şey yapmaz.
  async move(items, dstDir) {
    const res = { moved: 0, skipped: 0, failed: [] };
    const conflict = this.options().conflict;
    for (const it of items) {
      if (posix.dirname(it.path) === dstDir || isInside(dstDir, it.path)) { res.skipped++; continue; }
      try {
        const done = await this.run(async (r) => {
          let dst = posix.join(dstDir, it.name);
          if (await r.exists(dst)) {
            if (conflict === 'skip') return false;
            if (conflict === 'overwrite' && !it.isDir && !(await r.stat(dst)).isDir) await r.removeFile(dst);
            else dst = await uniqueRemotePath(r, dst, it.isDir);
          }
          await r.rename(it.path, dst);
          return true;
        });
        if (done) res.moved++; else res.skipped++;
      } catch (err) {
        res.failed.push({ name: it.name, error: this.errText(err) });
      }
      this.invalidate(posix.dirname(it.path));
      for (const k of [...this.cache.keys()]) if (k === it.path || k.startsWith(it.path + '/')) this.cache.delete(k);
    }
    this.invalidate(dstDir);
    return res;
  }

  // Kopyalama aktarım kuyruğunda yürür. Aynı klasöre kopyalanan öğe "ad (1)" olarak çoğaltılır.
  async copy(items, dstDir) {
    for (const it of items) {
      if (isInside(dstDir, it.path)) continue;
      let dst = posix.join(dstDir, it.name);
      if (posix.dirname(it.path) === dstDir) dst = await this.run((r) => uniqueRemotePath(r, dst, it.isDir));
      const name = posix.basename(dst);
      if (!it.isDir) {
        const node = this.addNode({ name, isDir: false, kind: 'copy', src: it.path, dst, size: it.size || 0, dstDir, startT: Date.now() });
        node.rootId = node.id;
        this.registerFile(node);
        this.enqueue(node);
        continue;
      }
      const root = this.addNode({ name, isDir: true, kind: 'copy', src: it.path, dst, dstDir, scanning: true, startT: Date.now() });
      root.rootId = root.id;
      this.scanRemote(root).catch((err) => {
        root.error = this.errText(err);
        root.failed++;
        root.scanning = false;
        this.touch(root);
      });
    }
  }

  // --- İptal / yeniden dene / temizle -------------------------------------------
  subtree(id) {
    const out = [];
    const node = this.nodes.get(id);
    if (!node) return out;
    const ids = new Set([id]);
    out.push(node);
    for (const n of this.nodes.values()) {
      if (n.rootId !== node.rootId || n === node) continue;
      // düğümün atalarında hedef varsa alt ağaçtadır
      let p = n.parentId;
      while (p && !ids.has(p)) p = this.nodes.get(p)?.parentId;
      if (p) out.push(n);
    }
    return out;
  }

  cancel(id) {
    for (const n of this.subtree(id)) {
      if (n.isDir) { n.cancelled = true; this.touch(n); continue; }
      const task = this.tasks.get(n.id);
      if (!task) continue;
      task.cancelled = true;
      if (n.status === 'active') { try { task.ctl.abort && task.ctl.abort(); } catch {} }
      else this.setFileStatus(n, 'cancelled');
    }
  }

  cancelAll() {
    for (const n of this.nodes.values()) if (!n.parentId) this.cancel(n.id);
  }

  retry(id) {
    for (const n of this.subtree(id)) {
      if (n.isDir) { n.cancelled = false; this.touch(n); continue; }
      if (n.status !== 'error' && n.status !== 'cancelled') continue;
      if (n.done) this.addDone(n, -n.done);
      this.setFileStatus(n, 'queued');
      this.enqueue(n);
    }
    const root = this.nodes.get(this.nodes.get(id)?.rootId);
    if (root) { root.reported = null; root.error = root.scanning ? root.error : null; this.touch(root); }
  }

  // Bitmiş kök aktarımları listeden kaldır
  clear(ids) {
    const roots = ids ? ids.map((id) => this.nodes.get(id)).filter(Boolean)
      : [...this.nodes.values()].filter((n) => !n.parentId && ['done', 'error', 'cancelled', 'skipped'].includes(this.dirStatusOrStatus(n)));
    const removed = [];
    for (const r of roots) {
      if (r.parentId) continue;
      const st = this.dirStatusOrStatus(r);
      if (!['done', 'error', 'cancelled', 'skipped'].includes(st)) continue;
      for (const n of [...this.nodes.values()]) if (n.rootId === r.id) { this.nodes.delete(n.id); this.dirty.delete(n.id); }
      removed.push(r.id);
    }
    return removed;
  }

  close() {
    this.closed = true;
    clearInterval(this.keepAlive);
    clearTimeout(this.flushTimer);
    for (const task of this.tasks.values()) { task.cancelled = true; try { task.ctl.abort && task.ctl.abort(); } catch {} }
    for (const r of this.idle) { try { r.close(); } catch {} }
    this.idle = [];
    if (this.browse) this.browse.close();
  }
}

function uniqueLocalPath(p) {
  if (!fs.existsSync(p)) return p;
  const { dir, name, ext } = path.parse(p);
  for (let i = 1; ; i++) {
    const cand = path.join(dir, `${name} (${i})${ext}`);
    if (!fs.existsSync(cand)) return cand;
  }
}

// dir, p'nin kendisi ya da altındaki bir klasör mü
function isInside(dir, p) {
  return dir === p || dir.startsWith(p.replace(/\/+$/, '') + '/');
}

async function uniqueRemotePath(remote, p, isDir = false) {
  const dir = posix.dirname(p);
  const ext = isDir ? '' : posix.extname(p);
  const base = posix.basename(p, ext);
  for (let i = 1; ; i++) {
    const cand = posix.join(dir, `${base} (${i})${ext}`);
    if (!(await remote.exists(cand))) return cand;
  }
}

module.exports = { Session, isInside };
