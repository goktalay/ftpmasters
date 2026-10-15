'use strict';

// Protokol katmanı: FTP / FTPS (basic-ftp) ve SFTP (ssh2) için ortak arayüz.
//
//   connect()                         bağlan ve oturum aç
//   list(dir)                         [{ name, path, isDir, isLink, size, mtime, raw }]
//   pwd(), stat(p), exists(p)
//   mkdir(p), rename(a, b), removeFile(p), removeDir(p)
//   download(remote, local, onBytes, ctl, opts) / upload(local, remote, onBytes, ctl, opts)
//   close()
//
// `ctl` aktarım başına bir nesnedir; protokol ctl.abort'u doldurur, çağıran iptal için onu çağırır.
// `parallel` true ise aynı bağlantı üzerinde birden fazla aktarım aynı anda yürüyebilir (SFTP);
// false ise (FTP) her eşzamanlı aktarım için ayrı bağlantı açılır.

const fs = require('fs');
const crypto = require('crypto');
const posix = require('path').posix;
const ftp = require('basic-ftp');
const { Client: SshClient } = require('ssh2');
const { Meter } = require('./throttle');

const PROTOCOLS = {
  ftp: { port: 21 },
  'ftps-implicit': { port: 990 },
  'ftps-ssl': { port: 21 },
  'ftps-tls': { port: 21 },
  sftp: { port: 22 },
};

const isIp = (h) => /^[\d.]+$/.test(h) || h.includes(':');

// Metin uzantıları: "Otomatik" aktarım türünde bunlar ASCII, diğerleri ikili (binary) aktarılır
const TEXT_EXT = new Set(['txt', 'htm', 'html', 'css', 'js', 'json', 'xml', 'php', 'asp', 'aspx', 'csv', 'ini', 'conf', 'cfg', 'md', 'sh', 'pl', 'py', 'sql', 'svg', 'htaccess', 'log']);
function useAscii(mode, name) {
  if (mode === 'ascii') return true;
  if (mode !== 'auto') return false;
  const ext = (name.split('.').pop() || '').toLowerCase();
  return TEXT_EXT.has(ext);
}

function credentials(conn) {
  if (conn.loginMethod === 'anonymous') return { user: 'anonymous', password: conn.password || 'anonymous@' };
  return { user: String(conn.username || '').trim(), password: conn.password || '' };
}

// Akışı bir dosyaya yazar ve dosya tamamen kapanana kadar bekler
function fileSink(localPath, onBytes) {
  const meter = new Meter(onBytes);
  const out = fs.createWriteStream(localPath);
  meter.pipe(out);
  const finished = new Promise((resolve, reject) => {
    out.on('close', resolve);
    out.on('error', reject);
    meter.on('error', (err) => { out.destroy(); reject(err); });
  });
  return { meter, out, finished };
}

// ---------------------------------------------------------------------------
// FTP / FTPS
// ---------------------------------------------------------------------------
class FtpRemote {
  constructor(conn) {
    this.conn = conn;
    this.client = null;
    this.parallel = false;
  }

  get closed() { return !this.client || this.client.closed; }

  async connect() {
    const conn = this.conn;
    const host = String(conn.host || '').trim();
    const port = Number(conn.port) || PROTOCOLS[conn.protocol].port;
    const c = new ftp.Client(30000);
    if (conn.encoding === 'ascii') c.ftp.encoding = 'latin1';
    // Sunucu sertifikaları çoğunlukla kendinden imzalıdır; FileZilla/CuteFTP gibi kabul ediyoruz
    const tls = { rejectUnauthorized: false, servername: isIp(host) ? undefined : host };
    try {
      if (conn.protocol === 'ftps-implicit') {
        await c.connectImplicitTLS(host, port, tls);
      } else {
        await c.connect(host, port);
        if (conn.protocol === 'ftps-tls') await c.useTLS(tls, 'AUTH TLS');
        if (conn.protocol === 'ftps-ssl') await c.useTLS(tls, 'AUTH SSL');
      }
      const { user, password } = credentials(conn);
      await c.login(user, password);
      await c.useDefaultSettings();
      if (conn.encoding === 'ascii') await c.sendIgnoringError('OPTS UTF8 OFF');
    } catch (err) {
      c.close();
      throw err;
    }
    this.client = c;
    return this;
  }

  async info() {
    const res = await this.client.sendIgnoringError('SYST');
    return (res.message || '').replace(/^\d+\s*/, '').trim();
  }

  pwd() { return this.client.pwd(); }

  noop() { return this.client.send('NOOP'); }

  async list(dir) {
    const items = await this.client.list(dir);
    const tz = Number(this.conn.timezone) || 0;
    return items
      .filter((e) => e.name !== '.' && e.name !== '..')
      .map((e) => ({
        name: e.name,
        path: posix.join(dir, e.name),
        isDir: e.type === ftp.FileType.Directory,
        isLink: e.type === ftp.FileType.SymbolicLink,
        size: e.size,
        mtime: e.modifiedAt ? e.modifiedAt.getTime() + tz * 3600000 : 0,
        raw: e.rawModifiedAt || '',
      }));
  }

  async stat(p) {
    try {
      return { isDir: false, size: await this.client.size(p) };
    } catch {
      // SIZE klasörlerde başarısız olur; klasöre girmeyi deneyerek ayırt et
      const cwd = await this.client.pwd();
      await this.client.cd(p);
      await this.client.cd(cwd);
      return { isDir: true, size: 0 };
    }
  }

  async exists(p) {
    try { await this.stat(p); return true; } catch { return false; }
  }

  async mkdir(p) {
    await this.client.send('MKD ' + (await this.client.protectWhitespace(p)));
  }

  rename(a, b) { return this.client.rename(a, b); }
  removeFile(p) { return this.client.remove(p); }
  removeDir(p) { return this.client.removeDir(p); }

  async download(remotePath, localPath, onBytes, ctl, { transferType } = {}) {
    const c = this.client;
    ctl.abort = () => c.close();
    const ascii = useAscii(transferType, posix.basename(remotePath));
    const { meter, finished } = fileSink(localPath, onBytes);
    if (ascii) await c.send('TYPE A');
    try {
      await c.downloadTo(meter, remotePath);
      await finished;
    } finally {
      if (ascii && !c.closed) await c.send('TYPE I').catch(() => {});
    }
  }

  async upload(localPath, remotePath, onBytes, ctl, { transferType } = {}) {
    const c = this.client;
    ctl.abort = () => c.close();
    const ascii = useAscii(transferType, posix.basename(remotePath));
    const meter = new Meter(onBytes);
    const src = fs.createReadStream(localPath);
    src.on('error', (err) => meter.destroy(err));
    src.pipe(meter);
    if (ascii) await c.send('TYPE A');
    try {
      await c.uploadFrom(meter, remotePath);
    } finally {
      src.destroy();
      if (ascii && !c.closed) await c.send('TYPE I').catch(() => {});
    }
  }

  close() {
    if (this.client) this.client.close();
  }
}

// ---------------------------------------------------------------------------
// SFTP (SSH2)
// ---------------------------------------------------------------------------
class SftpRemote {
  constructor(conn) {
    this.conn = conn;
    this.ssh = null;
    this.sftp = null;
    this.parallel = true;
    this.fingerprint = null;
    this._closed = true;
  }

  get closed() { return this._closed; }

  connect() {
    const conn = this.conn;
    return new Promise((resolve, reject) => {
      const ssh = new SshClient();
      let mismatch = false;
      const { user, password } = credentials(conn);
      const cfg = {
        host: String(conn.host || '').trim(),
        port: Number(conn.port) || 22,
        username: user,
        readyTimeout: 20000,
        keepaliveInterval: 20000,
        tryKeyboard: true,
        hostVerifier: (key) => {
          this.fingerprint = crypto.createHash('sha256').update(key).digest('base64');
          if (conn.hostKey && conn.hostKey !== this.fingerprint) {
            mismatch = true;
            return false;
          }
          return true;
        },
      };
      try {
        if (conn.authType === 'key' && conn.keyPath) {
          cfg.privateKey = fs.readFileSync(conn.keyPath);
          if (conn.passphrase) cfg.passphrase = conn.passphrase;
        } else {
          cfg.password = password;
        }
      } catch (err) {
        return reject(err);
      }
      ssh.on('keyboard-interactive', (_n, _i, _l, prompts, finish) => finish(prompts.map(() => password)));
      ssh.on('error', (err) => {
        this._closed = true;
        if (mismatch) {
          const e = new Error('HOSTKEY');
          e.hostKey = { old: conn.hostKey, new: this.fingerprint };
          reject(e);
        } else reject(err);
      });
      ssh.on('close', () => (this._closed = true));
      ssh.on('ready', () => {
        ssh.sftp((err, sftp) => {
          if (err) { ssh.end(); return reject(err); }
          this.ssh = ssh;
          this.sftp = sftp;
          this._closed = false;
          sftp.on('close', () => (this._closed = true));
          resolve(this);
        });
      });
      ssh.connect(cfg);
    });
  }

  _call(fn, ...args) {
    return new Promise((resolve, reject) => this.sftp[fn](...args, (err, res) => (err ? reject(err) : resolve(res))));
  }

  info() {
    return new Promise((resolve) => {
      this.ssh.exec('uname -sr 2>/dev/null; hostname 2>/dev/null', (err, stream) => {
        if (err) return resolve('');
        let out = '';
        stream.on('data', (d) => (out += d));
        stream.on('close', () => resolve(out.trim().split('\n').join(' · ')));
      });
    });
  }

  pwd() { return this._call('realpath', '.'); }

  noop() { return this._call('realpath', '.'); }

  async list(dir) {
    const list = await this._call('readdir', dir);
    const out = list
      .filter((e) => e.filename !== '.' && e.filename !== '..')
      .map((e) => {
        const type = e.attrs.mode & 0o170000;
        return {
          name: e.filename,
          path: posix.join(dir, e.filename),
          isDir: type === 0o040000,
          isLink: type === 0o120000,
          size: e.attrs.size,
          mtime: e.attrs.mtime * 1000,
          raw: '',
        };
      });
    // Sembolik bağlantıların klasör olup olmadığını öğren
    await Promise.all(out.filter((e) => e.isLink).map(async (e) => {
      try { e.isDir = (await this._call('stat', e.path)).isDirectory(); } catch {}
    }));
    return out;
  }

  async stat(p) {
    const st = await this._call('stat', p);
    return { isDir: st.isDirectory(), size: st.size };
  }

  async exists(p) {
    try { await this._call('stat', p); return true; } catch { return false; }
  }

  mkdir(p) { return this._call('mkdir', p); }
  rename(a, b) { return this._call('rename', a, b); }
  removeFile(p) { return this._call('unlink', p); }

  async removeDir(p) {
    for (const e of await this.list(p)) {
      if (e.isDir && !e.isLink) await this.removeDir(e.path);
      else await this._call('unlink', e.path);
    }
    await this._call('rmdir', p);
  }

  download(remotePath, localPath, onBytes, ctl) {
    return new Promise((resolve, reject) => {
      const src = this.sftp.createReadStream(remotePath);
      const { meter, out, finished } = fileSink(localPath, onBytes);
      ctl.abort = () => { const e = new Error('cancelled'); src.destroy(e); meter.destroy(e); out.destroy(); };
      src.on('error', (err) => { meter.destroy(err); });
      src.pipe(meter);
      finished.then(resolve, reject);
    });
  }

  upload(localPath, remotePath, onBytes, ctl) {
    return new Promise((resolve, reject) => {
      const src = fs.createReadStream(localPath);
      const meter = new Meter(onBytes);
      const dst = this.sftp.createWriteStream(remotePath);
      let failed = false;
      const fail = (err) => {
        if (failed) return;
        failed = true;
        src.destroy();
        meter.destroy();
        dst.destroy();
        reject(err);
      };
      ctl.abort = () => fail(new Error('cancelled'));
      src.on('error', fail);
      meter.on('error', fail);
      dst.on('error', fail);
      dst.on('close', () => { if (!failed) resolve(); });
      src.pipe(meter).pipe(dst);
    });
  }

  close() {
    this._closed = true;
    try { this.ssh && this.ssh.end(); } catch {}
  }
}

function createRemote(conn) {
  return conn.protocol === 'sftp' ? new SftpRemote(conn) : new FtpRemote(conn);
}

// Sunucu hatalarını kullanıcı dostu metne çevirir
function friendlyError(err, t) {
  const msg = (err && err.message) || String(err);
  const code = err && err.code;
  if (msg === 'HOSTKEY' && err.hostKey) return t('main.errHostKey', err.hostKey);
  if (code === 530 || /All configured authentication methods failed|Login incorrect|530/i.test(msg)) return t('main.errAuth');
  if (code === 550) return t('main.err550', { msg: msg.replace(/^550\s*/, '') });
  if (code === 553) return t('main.err553');
  if (/ECONNREFUSED/i.test(msg)) return t('main.errRefused');
  if (/ETIMEDOUT|Timed out|Timeout/i.test(msg)) return t('main.errTimeout');
  if (/ENOTFOUND|EAI_AGAIN/i.test(msg)) return t('main.errDns');
  if (/EHOSTUNREACH|ENETUNREACH/i.test(msg)) return t('main.errUnreach');
  if (/ECONNRESET|socket hang up|Client is closed|closed by the server/i.test(msg)) return t('main.errReset');
  if (/ENOENT|No such file/i.test(msg)) return t('main.errNotFound');
  if (/EACCES|EPERM|Permission denied/i.test(msg)) return t('main.errPerm');
  if (/wrong version number|SSL|TLS|certificate/i.test(msg)) return t('main.errTls', { msg });
  return msg;
}

module.exports = { createRemote, friendlyError, PROTOCOLS };
