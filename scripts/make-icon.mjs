// Renders the OmniContext icon (rounded square, gradient, orbit ring + core) to PNG with no deps.
import fs from 'node:fs';
import zlib from 'node:zlib';

function png(size) {
  const px = Buffer.alloc(size * size * 4);
  const c = size / 2;
  const R = size * 0.46; // tile half-size
  const rad = size * 0.2; // corner radius
  const mix = (a, b, t) => a + (b - a) * t;
  const SS = 4;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) {
        const fx = x + (sx + 0.5) / SS, fy = y + (sy + 0.5) / SS;
        // rounded-rect mask
        const qx = Math.max(Math.abs(fx - c) - (R - rad), 0), qy = Math.max(Math.abs(fy - c) - (R - rad), 0);
        if (Math.hypot(qx, qy) > rad) continue;
        const t = (fx + fy) / (2 * size);
        let cr = mix(79, 20, t), cg = mix(70, 184, t), cb = mix(229, 166, t); // indigo -> teal
        const dx = fx - c, dy = fy - c;
        // tilted orbit ellipse
        const ang = -0.5, ex = dx * Math.cos(ang) - dy * Math.sin(ang), ey = dx * Math.sin(ang) + dy * Math.cos(ang);
        const e = Math.hypot(ex / (size * 0.33), ey / (size * 0.15));
        const ring = Math.abs(e - 1) < 0.075;
        const core = Math.hypot(dx, dy) < size * 0.105;
        const sat = Math.hypot(dx - size * 0.26, dy + size * 0.13) < size * 0.045;
        if (ring || core || sat) { cr = 255; cg = 255; cb = 255; }
        r += cr; g += cg; b += cb; a += 255;
      }
      const n = SS * SS, i = (y * size + x) * 4;
      const cov = a / 255;
      px[i] = cov ? r / cov : 0; px[i + 1] = cov ? g / cov : 0; px[i + 2] = cov ? b / cov : 0; px[i + 3] = a / n;
    }
  }
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) px.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  const crcT = new Int32Array(256).map((_, n) => { let k = n; for (let j = 0; j < 8; j++) k = k & 1 ? 0xedb88320 ^ (k >>> 1) : k >>> 1; return k; });
  const crc = (buf) => { let k = -1; for (const v of buf) k = crcT[(k ^ v) & 255] ^ (k >>> 8); return (k ^ -1) >>> 0; };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const cr = Buffer.alloc(4); cr.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, cr]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

for (const [file, size] of [['app/build/icon.png', 1024], ['icon.png', 512], ['docs/icon.png', 256], ['app/renderer/icon.png', 128], ['app/build/tray.png', 32]]) {
  fs.mkdirSync(file.split('/').slice(0, -1).join('/') || '.', { recursive: true });
  fs.writeFileSync(file, png(size));
  console.log('wrote', file);
}
