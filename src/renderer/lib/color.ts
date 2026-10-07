/**
 * 主题色派生 —— accentColor（6 位 hex）→ 运行时 CSS 变量。
 * 只算颜色，不做任何 UI 判断；浅色模式取"更深更稳"，深色模式整体提亮一档保证可读。
 */

export function hexToHsl(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (mx + mn) / 2;
  if (mx !== mn) {
    const d = mx - mn;
    s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
    if (mx === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (mx === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
  }
  return [h, s * 100, l * 100];
}

export function hslToHex(h: number, s: number, l: number): string {
  s /= 100;
  l /= 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const to = (x: number) => Math.round(255 * x).toString(16).padStart(2, '0');
  return `#${to(f(0))}${to(f(8))}${to(f(4))}`;
}

function shade(hex: string, dl: number): string {
  const [h, s, l] = hexToHsl(hex);
  return hslToHex(h, s, Math.max(0, Math.min(96, l + dl)));
}

function rgba(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

/** 把 accentColor 派生成 --accent* 变量写到 :root。theme 变化时需重算（深色整体提亮）。 */
export function applyAccentColor(hex: string, theme: 'light' | 'dark'): void {
  const dark = theme === 'dark';
  const root = document.documentElement.style;
  root.setProperty('--accent', dark ? shade(hex, 10) : hex);
  root.setProperty('--accent-hover', dark ? shade(hex, 18) : shade(hex, -7));
  root.setProperty('--accent-active', dark ? shade(hex, 26) : shade(hex, -13));
  root.setProperty('--accent-text', dark ? shade(hex, 26) : shade(hex, -12));
  root.setProperty('--accent-tint', rgba(hex, dark ? 0.16 : 0.1));
  root.setProperty('--accent-tint-hover', rgba(hex, dark ? 0.24 : 0.16));
  root.setProperty('--ring-accent', rgba(hex, dark ? 0.4 : 0.3));
}
