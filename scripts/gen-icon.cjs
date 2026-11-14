/*
 * 生成应用图标（build/icon.ico + build/tray.ico）—— 纯 node 实现，无第三方依赖。
 *
 * 2026-11-14 换标：采用 ip-as-logo 流程选定的 IP 吉祥物「珊瑚企鹅」（用户拍板原样采用，
 * 不修脸不裁剪，见 docs/design-system/ip-mascot/）。源图 build/icon-source.png
 * （= selected/C2_0.png，1024×1024 8bit RGB）。脚本职责从"程序化画 T"改为：
 *   1. 解码源 PNG（8bit RGB/RGBA、非隔行、全 5 种行滤波）；
 *   2. 面积平均降采样到各尺寸（1024 → 256..16，只缩不放）；
 *   3. 复用原有 PNG 编码 / ICO 容器（Vista+ 内嵌 PNG）/ 预览拼图。
 * 尺寸集不变：icon = 256/128/64/48/32/24/16，tray = 32/24/16。
 *
 * 2026-10-19 旧版为黑底白 T（圆角方块 + 收分竖笔，4x 超采样光栅化），历史见 git。
 *
 * 用法：node scripts/gen-icon.cjs
 */
const zlib = require('node:zlib');
const fs = require('node:fs');
const path = require('node:path');

/* ---------- PNG 解码（8bit RGB/RGBA、非隔行；行滤波 0-4 全支持） ---------- */
function decodePng(buf) {
  const SIGNATURE = 0x89504e47;
  if (buf.readUInt32BE(0) !== SIGNATURE) throw new Error('not a png file');
  let pos = 8;
  let width = 0;
  let height = 0;
  let depth = 0;
  let colorType = 0;
  let interlace = 0;
  const idats = [];
  while (pos + 8 <= buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      depth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === 'IDAT') {
      idats.push(data);
    } else if (type === 'IEND') {
      break;
    }
    pos += 12 + len;
  }
  if (depth !== 8) throw new Error(`unsupported png bit depth: ${depth}`);
  if (interlace !== 0) throw new Error('interlaced png not supported');
  if (colorType !== 2 && colorType !== 6) throw new Error(`unsupported png color type: ${colorType}`);
  const bpp = colorType === 6 ? 4 : 3;
  const raw = zlib.inflateSync(Buffer.concat(idats));
  const stride = width * bpp;
  if (raw.length < height * (stride + 1)) throw new Error('png idat too short');
  const out = Buffer.alloc(width * height * 4);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < height; y += 1) {
    const lineStart = y * (stride + 1);
    const filter = raw[lineStart];
    const line = raw.subarray(lineStart + 1, lineStart + 1 + stride);
    const cur = Buffer.alloc(stride);
    for (let i = 0; i < stride; i += 1) {
      const a = i >= bpp ? cur[i - bpp] : 0;
      const b = prev[i];
      const c = i >= bpp ? prev[i - bpp] : 0;
      let v = line[i];
      if (filter === 1) {
        v = (v + a) & 0xff;
      } else if (filter === 2) {
        v = (v + b) & 0xff;
      } else if (filter === 3) {
        v = (v + ((a + b) >> 1)) & 0xff;
      } else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        v = (v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 0xff;
      }
      cur[i] = v;
    }
    const rowOut = y * width * 4;
    if (colorType === 6) {
      for (let x = 0; x < width; x += 1) {
        out[rowOut + x * 4] = cur[x * 4];
        out[rowOut + x * 4 + 1] = cur[x * 4 + 1];
        out[rowOut + x * 4 + 2] = cur[x * 4 + 2];
        out[rowOut + x * 4 + 3] = cur[x * 4 + 3];
      }
    } else {
      for (let x = 0; x < width; x += 1) {
        out[rowOut + x * 4] = cur[x * 3];
        out[rowOut + x * 4 + 1] = cur[x * 3 + 1];
        out[rowOut + x * 4 + 2] = cur[x * 3 + 2];
        out[rowOut + x * 4 + 3] = 255;
      }
    }
    prev = cur;
  }
  return { width, height, rgba: out };
}

/* ---------- 面积平均降采样（正方形源 → 正方形目标；只缩不放） ---------- */
function downscale(src, size) {
  if (src.width !== src.height) throw new Error(`source must be square, got ${src.width}x${src.height}`);
  if (size > src.width) throw new Error(`cannot upscale ${src.width} -> ${size}`);
  const out = Buffer.alloc(size * size * 4);
  const srcW = src.width;
  for (let dy = 0; dy < size; dy += 1) {
    const y0 = (dy * srcW) / size;
    const y1 = ((dy + 1) * srcW) / size;
    for (let dx = 0; dx < size; dx += 1) {
      const x0 = (dx * srcW) / size;
      const x1 = ((dx + 1) * srcW) / size;
      let r = 0;
      let g = 0;
      let b = 0;
      let wsum = 0;
      for (let sy = Math.floor(y0); sy < Math.min(srcW, Math.ceil(y1)); sy += 1) {
        const wy = Math.min(y1, sy + 1) - Math.max(y0, sy);
        if (wy <= 0) continue;
        for (let sx = Math.floor(x0); sx < Math.min(srcW, Math.ceil(x1)); sx += 1) {
          const wx = Math.min(x1, sx + 1) - Math.max(x0, sx);
          if (wx <= 0) continue;
          const si = (sy * srcW + sx) * 4;
          const w = wx * wy;
          r += src.rgba[si] * w;
          g += src.rgba[si + 1] * w;
          b += src.rgba[si + 2] * w;
          wsum += w;
        }
      }
      const di = (dy * size + dx) * 4;
      out[di] = Math.round(r / wsum);
      out[di + 1] = Math.round(g / wsum);
      out[di + 2] = Math.round(b / wsum);
      out[di + 3] = 255;
    }
  }
  return out;
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

/** 把若干张正方形图标按格子摆进一块浅灰画布（便于目检小尺寸表现）。 */
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

const src = decodePng(fs.readFileSync(path.join(outDir, 'icon-source.png')));
const pick = (size) => encodePng(size, size, downscale(src, size));

const iconSizes = [256, 128, 64, 48, 32, 24, 16];
fs.writeFileSync(path.join(outDir, 'icon.ico'), buildIco(iconSizes.map((size) => ({ size, png: pick(size) }))));

const traySizes = [32, 24, 16];
fs.writeFileSync(path.join(outDir, 'tray.ico'), buildIco(traySizes.map((size) => ({ size, png: pick(size) }))));

/* 应用内品牌标（TitleBar / 设置·关于 的 BrandMark 组件 import 用）：与 ico 同一源图派生。 */
const brandDir = path.join(__dirname, '..', 'src', 'renderer', 'assets');
fs.mkdirSync(brandDir, { recursive: true });
fs.writeFileSync(path.join(brandDir, 'brand-mark.png'), pick(128));

/* 预览：256 / 96 / 48 / 32 / 16 一行排开，供人工目检各尺寸表现。 */
const preview = [256, 96, 48, 32, 16].map((s) => ({ size: s, rgba: downscale(src, s) }));
const sheet = composeSheet(preview, 288, 5);
fs.writeFileSync(path.join(outDir, 'icon-preview-sheet.png'), encodePng(sheet.width, sheet.height, sheet.rgba));
fs.writeFileSync(path.join(outDir, 'icon-preview-256.png'), encodePng(256, 256, downscale(src, 256)));
fs.writeFileSync(path.join(outDir, 'icon-preview-32.png'), encodePng(32, 32, downscale(src, 32)));
console.log(`icons written from icon-source.png (${src.width}x${src.height}): build/icon.ico + tray.ico + preview-sheet/256/32 + src/renderer/assets/brand-mark.png`);
