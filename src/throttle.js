'use strict';

// Tüm pencerelerdeki tüm aktarımların paylaştığı hız sınırı ve sayaç.
// Her aktarım verisini bir Meter (Transform akışı) üzerinden geçirir; sınır açıksa
// parçalar, global "bir sonraki boş zaman" çizelgesine göre geciktirilir. Geri basınç
// (backpressure) sayesinde soket de aynı hızda okunur/yazılır.

const { Transform } = require('stream');

const limiter = {
  bytesPerSec: 0, // 0 = sınırsız
  nextFree: 0,
  set(kbps) {
    this.bytesPerSec = kbps > 0 ? kbps * 1024 : 0;
    this.nextFree = 0;
  },
  // n bayt için ne kadar beklenmesi gerektiğini (ms) döndürür
  take(n) {
    if (!this.bytesPerSec) return 0;
    const now = Date.now();
    // Uzun süre boşta kaldıysa en fazla 250 ms'lik birikmiş hak tanı
    const start = Math.max(now - 250, this.nextFree);
    this.nextFree = start + (n / this.bytesPerSec) * 1000;
    return Math.max(0, start - now);
  },
};

// Sınır açıkken parçaları küçült ki ilerleme akıcı görünsün
const SLICE = 16 * 1024;

class Meter extends Transform {
  constructor(onBytes) {
    super();
    this.onBytes = onBytes;
  }

  _transform(chunk, _enc, cb) {
    if (!limiter.bytesPerSec) {
      this.onBytes(chunk.length);
      return cb(null, chunk);
    }
    const parts = [];
    for (let i = 0; i < chunk.length; i += SLICE) parts.push(chunk.subarray(i, i + SLICE));
    const next = () => {
      if (this.destroyed) return cb();
      const part = parts.shift();
      if (!part) return cb();
      const wait = limiter.take(part.length);
      const go = () => {
        if (this.destroyed) return cb();
        this.onBytes(part.length);
        this.push(part);
        next();
      };
      if (wait > 0) setTimeout(go, wait); else go();
    };
    next();
  }
}

module.exports = { limiter, Meter };
