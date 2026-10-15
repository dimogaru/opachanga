const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const name = Buffer.from(type);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([length, name, data, checksum]);
}

function png(size, maskable = false) {
  const pixels = Buffer.alloc(size * size * 4);
  const center = (size - 1) / 2;
  const outerRadius = size * (maskable ? 0.48 : 0.5);
  const ballRadius = size * 0.31;
  const inset = maskable ? size * 0.12 : size * 0.07;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const i = (y * size + x) * 4;
      const dx = x - center;
      const dy = y - center;
      const distance = Math.hypot(dx, dy);
      const inside = maskable || Math.max(Math.abs(dx), Math.abs(dy)) <= outerRadius;
      let color = [18, 59, 42, inside ? 255 : 0];
      if (inside && distance < ballRadius) color = [248, 248, 238, 255];
      const hexRadius = size * 0.092;
      const inCenterHex = inside && Math.abs(dx) < hexRadius && Math.abs(dy) < hexRadius * 0.87 &&
        Math.abs(dx) + Math.abs(dy) * 0.58 < hexRadius;
      if (inCenterHex) color = [18, 59, 42, 255];
      const spots = [
        [center, center - ballRadius * 0.75],
        [center + ballRadius * 0.72, center - ballRadius * 0.22],
        [center + ballRadius * 0.45, center + ballRadius * 0.62],
        [center - ballRadius * 0.45, center + ballRadius * 0.62],
        [center - ballRadius * 0.72, center - ballRadius * 0.22],
      ];
      if (inside && distance < ballRadius && spots.some(([sx, sy]) => Math.hypot(x - sx, y - sy) < hexRadius * 0.55)) {
        color = [18, 59, 42, 255];
      }
      if (maskable && Math.abs(dx) < inset && Math.abs(dy) < inset) color = [248, 248, 238, 255];
      pixels.set(color, i);
    }
  }
  const scanlines = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y += 1) {
    const start = y * (size * 4 + 1);
    pixels.copy(scanlines, start + 1, y * size * 4, (y + 1) * size * 4);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", zlib.deflateSync(scanlines)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const directory = __dirname;
fs.mkdirSync(directory, { recursive: true });
fs.writeFileSync(path.join(directory, "icon-192.png"), png(192));
fs.writeFileSync(path.join(directory, "icon-512.png"), png(512));
fs.writeFileSync(path.join(directory, "icon-512-maskable.png"), png(512, true));
