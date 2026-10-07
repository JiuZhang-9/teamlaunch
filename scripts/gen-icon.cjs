/*
 * 生成应用图标（build/icon.ico + build/tray.ico）—— 纯 node 实现，无第三方依赖。
 *
 * 2026-10-07 用户定稿（图标统一）：任务栏 / 托盘 / 安装器全部用**黑底白 T**的实底
 * 变体——黑 #000000、圆角方块（与应用内 BrandMark 同一套几何语言）、方块占画布
 * ~88% 并把 T 加大加粗（任务栏/托盘 16px 下更醒目）。应用内左上角的 BrandMark
 * 仍跟随主题色（用户确认不改），两者共享"T 在圆角方块上"的造型语言。
 * 几何：24 viewBox，方块 rect(1.5,1.5,21,21) rx6；白 T：横笔 (6.5,7)-(17.5,7)、
 * 竖笔 (12,7)-(12,17.5)，圆头线帽，线宽 2.6。光栅化 4x 超采样抗锯齿，
 * PNG 手工编码（Vista+ 支持 ICO 内嵌 PNG）。
 *
 * 用法：node scripts/gen-icon.cjs
 */
const zlib = require('node:zlib');
const fs = require('node:fs');
const path = require('node:path');

const BLACK = [0, 0, 0];
const WHITE = [255, 255, 255];

/* 几何常量（24 viewBox）。方块从旧版 3..21（75%）放大到 1.5..22.5（88%），T 同步加大。 */
const BOX = { x: 1.5, y: 1.5, w: 21, h: 21, r: 6 };
const T = { x1: 6.5, y: 7, x2: 17.5, y2: 17.5, cx: 12, stroke: 2.6 };

/** 两点间线段距离（圆头线帽 = 到线段的最短距离，端点自然圆润）。 */
function distToSegment(px, py, x1, y1, x2, y2) {
  const vx = x2 - x1;
  const vy = y2 - y1;
  const lenSq = vx * vx + vy * vy;
  let t = lenSq === 0 ? 0 : ((px - x1) * vx + (py - y1) * vy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const ex = x1 + t * vx - px;
  const ey = y1 + t * vy - py;
  return Math.hypot(ex, ey);
}

/** 光栅化一帧：黑底圆角方块 + 白 T。坐标按 24 viewBox 缩放。 */
function rasterize(size) {
  const buf = Buffer.alloc(size * size * 4, 0);
  const scale = size / 24;
  const ss = 4; // 每像素 4x4 超采样
  const halfStroke = (T.stroke * scale) / 2;
  const putpixel = (px, py, r, g, b, a) => {
    const i = (py * size + px) * 4;
    const inv = 255 - a;
    buf[i] = (r * a + buf[i] * inv) / 255;
    buf[i + 1] = (g * a + buf[i + 1] * inv) / 255;
    buf[i + 2] = (b * a + buf[i + 2] * inv) / 255;
    buf[i + 3] = Math.max(buf[i + 3], a);
  };
  const bx = BOX.x * scale;
  const by = BOX.y * scale;
  const bw = BOX.w * scale;
  const bh = BOX.h * scale;
  const br = BOX.r * scale;
  for (let py = 0; py < size; py += 1) {
    for (let px = 0; px < size; px += 1) {
      let acc = 0;
      for (let sy = 0; sy < ss; sy += 1) {
        for (let sx = 0; sx < ss; sx += 1) {
          const x = px + (sx + 0.5) / ss;
          const y = py + (sy + 0.5) / ss;
          // 圆角方块内部判定（四角用圆弧圆心距离）
          const ox = Math.max(bx + br, Math.min(x, bx + bw - br));
          const oy = Math.max(by + br, Math.min(y, by + bh - br));
          const inCorner = (x < bx + br || x > bx + bw - br) && (y < by + br || y > by + bh - br);
          const inside = inCorner
            ? Math.hypot(x - ox, y - oy) <= br
            : x >= bx && x <= bx + bw && y >= by && y <= by + bh;
          if (!inside) continue;
          const dT = Math.min(
            distToSegment(x, y, T.x1 * scale, T.y * scale, T.x2 * scale, T.y * scale),
            distToSegment(x, y, T.cx * scale, T.y * scale, T.cx * scale, T.y2 * scale),
          );
          acc = 1;
          if (dT <= halfStroke) {
            putpixel(px, py, WHITE[0], WHITE[1], WHITE[2], 255);
          } else {
            putpixel(px, py, BLACK[0], BLACK[1], BLACK[2], 255);
          }
        }
      }
      void acc;
    }
  }
  return buf;
}

/* ---------- PNG 编码（RGBA，无滤波） ---------- */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function encodePng(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y += 1) {
    raw[y * (size * 4 + 1)] = 0; // filter none
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ---------- ICO 容器（内嵌 PNG） ---------- */
function buildIco(entries) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2); // icon
  header.writeUInt16LE(entries.length, 4);
  const dirSize = 16 * entries.length;
  let offset = 6 + dirSize;
  const dirs = [];
  const bodies = [];
  for (const { size, png } of entries) {
    const d = Buffer.alloc(16);
    d[0] = size >= 256 ? 0 : size;
    d[1] = size >= 256 ? 0 : size;
    d[2] = 0;
    d[3] = 0;
    d.writeUInt16LE(1, 4); // color plane
    d.writeUInt16LE(32, 6); // bpp
    d.writeUInt32LE(png.length, 8);
    d.writeUInt32LE(offset, 12);
    offset += png.length;
    dirs.push(d);
    bodies.push(png);
  }
  return Buffer.concat([header, ...dirs, ...bodies]);
}

const outDir = path.join(__dirname, '..', 'build');
fs.mkdirSync(outDir, { recursive: true });

const iconSizes = [256, 128, 64, 48, 32, 24, 16];
const iconEntries = iconSizes.map((size) => ({
  size,
  png: encodePng(size, rasterize(size)),
}));
fs.writeFileSync(path.join(outDir, 'icon.ico'), buildIco(iconEntries));

const traySizes = [32, 24, 16];
const trayEntries = traySizes.map((size) => ({
  size,
  png: encodePng(size, rasterize(size)),
}));
fs.writeFileSync(path.join(outDir, 'tray.ico'), buildIco(trayEntries));

// 预览图（人工目检用）
fs.writeFileSync(path.join(outDir, 'icon-preview-256.png'), encodePng(256, rasterize(256)));
fs.writeFileSync(path.join(outDir, 'icon-preview-32.png'), encodePng(32, rasterize(32)));
console.log('icons written to build/ (icon.ico + tray.ico + previews)');
