/*
 * 生成应用图标（build/icon.ico + build/tray.ico）—— 纯 node 实现，无第三方依赖。
 *
 * 2026-10-19 重设计（用户反馈：「目前的 T 图标不好看，缺乏设计感，显得简单粗鲁」）。
 * 方向不变（仍是他 2026-10-07 定下的黑底白 T、圆角方块、任务栏/托盘/安装器统一），
 * 变的是**字形的工艺**：
 *   1. 横笔改成**圆角矩形**（r≈1.0）而不是"粗线 + 全圆头线帽"——圆头在线宽 2.6 时
 *      两端鼓成两个半圆，远看像一团胖字，正是"粗鲁"的来源；
 *   2. 竖笔**带收分**（上宽 3.0 → 下宽 2.3，底端圆角）——真实的展示体 T 就是这么写；
 *   3. **视觉居中**：T 的重心在上方，所以上边距故意留得比下边距小（4.3 / 4.9），
 *      几何居中反而会让字看着往下坠；
 *   4. 方块外圆角从 6 放宽到 6.6，配合更细的字形，整体不再"楞"。
 * 光栅化仍是 4x 超采样抗锯齿 + 手写 PNG（Vista+ 支持 ICO 内嵌 PNG），零依赖。
 * 同时输出 build/icon-preview-sheet.png（多尺寸 + 带品牌色下划线的备选变体并排），供人工目检。
 *
 * 用法：node scripts/gen-icon.cjs
 */
const zlib = require('node:zlib');
const fs = require('node:fs');
const path = require('node:path');

const BLACK = [0, 0, 0];
const WHITE = [255, 255, 255];
/** 品牌青蓝（与 settings.accentColor 默认值同源）：只用在下划线的备选变体上。 */
const ACCENT = [0x10, 0x66, 0x96];

/* 几何常量（24 viewBox）。 */
const BOX = { x: 1.4, y: 1.4, w: 21.2, h: 21.2, r: 6.6 };
/** 横笔：圆角矩形。 */
const BAR = { x: 6.2, y: 5.7, w: 11.6, h: 2.7, r: 1.0 };
/** 竖笔：带收分（上宽下窄）+ 底端圆角；从横笔下沿起、到 bottom 结束再补一个半圆。 */
const STEM = { cx: 12, top: 8.4, bottom: 16.6, topHalf: 1.5, bottomHalf: 1.15 };
/** 备选变体（B）：方块底部一条品牌色短线，示意"在启动"。 */
const UNDERLINE = { x: 9.2, y: 19.0, w: 5.6, h: 1.3, r: 0.65 };

/** 点是否落在圆角矩形内。 */
function inRoundRect(x, y, r) {
  const ox = Math.max(r.x + r.r, Math.min(x, r.x + r.w - r.r));
  const oy = Math.max(r.y + r.r, Math.min(y, r.y + r.h - r.r));
  const inCorner = (x < r.x + r.r || x > r.x + r.w - r.r) && (y < r.y + r.r || y > r.y + r.h - r.r);
  return inCorner ? Math.hypot(x - ox, y - oy) <= r.r : x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
}

/** 点是否落在竖笔内（线性收分 + 底端半圆）。 */
function inStem(x, y) {
  if (y >= STEM.top && y <= STEM.bottom) {
    const t = (y - STEM.top) / (STEM.bottom - STEM.top);
    const half = STEM.topHalf + (STEM.bottomHalf - STEM.topHalf) * t;
    return Math.abs(x - STEM.cx) <= half;
  }
  if (y > STEM.bottom && y <= STEM.bottom + STEM.bottomHalf) {
    return Math.hypot(x - STEM.cx, y - STEM.bottom) <= STEM.bottomHalf;
  }
  return false;
}

/**
 * 光栅化一帧：黑底圆角方块 + 白 T（variant='accent' 时多一条品牌色下划线）。
 * 坐标按 24 viewBox 缩放；4x4 超采样做抗锯齿。
 * 覆盖率按像素聚合后再落色——同像素多次 put 会互相叠加，边缘会浑。
 */
function rasterize(size, variant = 'plain') {
  const buf = Buffer.alloc(size * size * 4, 0);
  const scale = size / 24;
  const ss = 4;
  const total = ss * ss;
  const putpixel = (px, py, rgb, a) => {
    if (a <= 0) return;
    const i = (py * size + px) * 4;
    const inv = 255 - a;
    buf[i] = (rgb[0] * a + buf[i] * inv) / 255;
    buf[i + 1] = (rgb[1] * a + buf[i + 1] * inv) / 255;
    buf[i + 2] = (rgb[2] * a + buf[i + 2] * inv) / 255;
    buf[i + 3] = Math.max(buf[i + 3], a);
  };
  for (let py = 0; py < size; py += 1) {
    for (let px = 0; px < size; px += 1) {
      let boxHits = 0;
      let whiteHits = 0;
      let accentHits = 0;
      for (let sy = 0; sy < ss; sy += 1) {
        for (let sx = 0; sx < ss; sx += 1) {
          const x = (px + (sx + 0.5) / ss) / scale;
          const y = (py + (sy + 0.5) / ss) / scale;
          if (!inRoundRect(x, y, BOX)) continue;
          boxHits += 1;
          if (inRoundRect(x, y, BAR) || inStem(x, y)) whiteHits += 1;
          else if (variant === 'accent' && inRoundRect(x, y, UNDERLINE)) accentHits += 1;
        }
      }
      if (boxHits === 0) continue;
      putpixel(px, py, BLACK, (boxHits / total) * 255);
      if (whiteHits > 0) putpixel(px, py, WHITE, (whiteHits / total) * 255);
      if (accentHits > 0) putpixel(px, py, ACCENT, (accentHits / total) * 255);
    }
  }
  return buf;
}

/* ---------- PNG 编码（RGBA，无滤波；支持任意宽高，预览拼图要用） ---------- */
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
function encodePng(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y += 1) {
    raw[y * (width * 4 + 1)] = 0; // filter none
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
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

/** 把若干张正方形图标按格子摆进一块浅灰画布（便于目检黑方块）。 */
function composeSheet(cells, cellSize, cols) {
  const rows = Math.ceil(cells.length / cols);
  const width = cols * cellSize;
  const height = rows * cellSize;
  const canvas = Buffer.alloc(width * height * 4, 0);
  for (let i = 0; i < width * height; i += 1) {
    canvas[i * 4] = 0xf2;
    canvas[i * 4 + 1] = 0xf2;
    canvas[i * 4 + 2] = 0xf2;
    canvas[i * 4 + 3] = 255;
  }
  cells.forEach((cell, index) => {
    const ox = (index % cols) * cellSize + Math.floor((cellSize - cell.size) / 2);
    const oy = Math.floor(index / cols) * cellSize + Math.floor((cellSize - cell.size) / 2);
    for (let y = 0; y < cell.size; y += 1) {
      for (let x = 0; x < cell.size; x += 1) {
        const si = (y * cell.size + x) * 4;
        const a = cell.rgba[si + 3] / 255;
        if (a === 0) continue;
        const di = ((oy + y) * width + (ox + x)) * 4;
        const inv = 1 - a;
        canvas[di] = cell.rgba[si] * a + canvas[di] * inv;
        canvas[di + 1] = cell.rgba[si + 1] * a + canvas[di + 1] * inv;
        canvas[di + 2] = cell.rgba[si + 2] * a + canvas[di + 2] * inv;
        canvas[di + 3] = 255;
      }
    }
  });
  return { width, height, rgba: canvas };
}

const outDir = path.join(__dirname, '..', 'build');
fs.mkdirSync(outDir, { recursive: true });

const iconSizes = [256, 128, 64, 48, 32, 24, 16];
const iconEntries = iconSizes.map((size) => ({ size, png: encodePng(size, size, rasterize(size)) }));
fs.writeFileSync(path.join(outDir, 'icon.ico'), buildIco(iconEntries));

const traySizes = [32, 24, 16];
const trayEntries = traySizes.map((size) => ({ size, png: encodePng(size, size, rasterize(size)) }));
fs.writeFileSync(path.join(outDir, 'tray.ico'), buildIco(trayEntries));

/* 预览：第一行 = 定稿（256 / 96 / 48 / 32 / 16），第二行 = 带品牌色下划线的备选变体。 */
const preview = [
  ...[256, 96, 48, 32, 16].map((s) => ({ size: s, rgba: rasterize(s) })),
  ...[128, 48, 32].map((s) => ({ size: s, rgba: rasterize(s, 'accent') })),
];
const sheet = composeSheet(preview, 288, 5);
fs.writeFileSync(path.join(outDir, 'icon-preview-sheet.png'), encodePng(sheet.width, sheet.height, sheet.rgba));
fs.writeFileSync(path.join(outDir, 'icon-preview-256.png'), encodePng(256, 256, rasterize(256)));
fs.writeFileSync(path.join(outDir, 'icon-preview-32.png'), encodePng(32, 32, rasterize(32)));
console.log('icons written to build/ (icon.ico + tray.ico + preview-sheet/256/32)');
