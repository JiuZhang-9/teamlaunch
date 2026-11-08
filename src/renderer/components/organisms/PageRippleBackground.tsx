/**
 * PageRippleBackground —— 团队 / 个人页的网点水波背景（2026-11-08）。
 *
 * 用户定稿：静止时页面完全不动；鼠标在内容区移动才从指针位置泛起波纹，
 * 约 1.5 秒后自行停下。团队与个人不靠新增颜色区分，而靠**点阵与波纹形状**：
 *  - 团队：24px 方形点阵 + 圆点 + 圆形波前；
 *  - 个人：20px 错位点阵 + 小方点 + 菱形波前（|dx|+|dy|）。
 * 网点颜色只取现有中性令牌（--meta），波纹只改大小/透明度，不引入页面色。
 *
 * 性能与可访问性：
 *  - 只在有波纹时跑 rAF，波纹衰减完就停；空闲不画。
 *  - Canvas 绝对定位在内容层后面，pointer-events-none；鼠标监听挂在 window 上，
 *    指针在内容区矩形内才触发（卡片不挡事件）。
 *  - prefers-reduced-motion 下只画静态网点；窗口隐藏时取消 rAF。
 */
import { useEffect, useRef } from 'react';

export interface PageRippleBackgroundProps {
  tab: 'team' | 'personal';
}

const TEAM_SPACING = 24;
const PERSONAL_SPACING = 20;
const RIPPLE_LIFE_MS = 1600;
const EMIT_GAP_MS = 45;
const MAX_RIPPLES = 6;
const MAX_DPR = 2;

interface Ripple {
  x: number;
  y: number;
  start: number;
  amp: number;
}

export function PageRippleBackground({ tab }: PageRippleBackgroundProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const probeRef = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    const root = rootRef.current;
    const canvas = canvasRef.current;
    const probe = probeRef.current;
    if (!root || !canvas || !probe) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const personal = tab === 'personal';
    const spacing = personal ? PERSONAL_SPACING : TEAM_SPACING;
    let reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let width = 0;
    let height = 0;
    let raf = 0;
    let ripples: Ripple[] = [];
    let last = { x: -999, y: -999, t: 0 };
    let dotColor = getComputedStyle(probe).color;

    const readColor = () => {
      const color = getComputedStyle(probe).color;
      if (color) dotColor = color;
    };

    const waveDistance = (dx: number, dy: number): number => (
      personal ? (Math.abs(dx) + Math.abs(dy)) * 0.74 : Math.hypot(dx, dy)
    );

    const draw = (now: number, animate: boolean): void => {
      ctx.clearRect(0, 0, width, height);
      const rows = Math.ceil(height / spacing) + 2;
      const cols = Math.ceil(width / spacing) + 2;

      for (let row = 0; row < rows; row += 1) {
        const y = row * spacing;
        const rowOffset = personal && row % 2 === 1 ? spacing / 2 : 0;
        for (let col = 0; col < cols; col += 1) {
          const x = col * spacing + rowOffset;
          let dx = 0;
          let dy = 0;
          let glow = 0;

          for (const ripple of ripples) {
            const age = (now - ripple.start) / 1000;
            if (age < 0 || age > RIPPLE_LIFE_MS / 1000) continue;
            const rx = x - ripple.x;
            const ry = y - ripple.y;
            const distance = waveDistance(rx, ry);
            const phase = (distance - age * 260) * 0.055;
            const env = Math.exp(-distance / 170) * Math.exp(-age / 0.85) * ripple.amp;
            const shift = Math.sin(phase) * env;
            const norm = (personal ? Math.abs(rx) + Math.abs(ry) : Math.hypot(rx, ry)) || 1;
            dx += (rx / norm) * shift;
            dy += (ry / norm) * shift;
            glow = Math.max(glow, Math.max(0, Math.cos(phase)) * env);
          }

          const radius = (personal ? 1 : 1.15) + glow * 0.9;
          ctx.globalAlpha = Math.min(0.9, 0.28 + glow * 0.45);
          ctx.fillStyle = dotColor;

          if (personal) {
            const size = radius * 1.7;
            const left = x + dx - size / 2;
            const top = y + dy - size / 2;
            if (typeof ctx.roundRect === 'function') {
              ctx.beginPath();
              ctx.roundRect(left, top, size, size, 0.8);
              ctx.fill();
            } else {
              ctx.fillRect(left, top, size, size);
            }
          } else {
            ctx.beginPath();
            ctx.arc(x + dx, y + dy, radius, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }
      ctx.globalAlpha = 1;

      if (animate && ripples.length > 0) {
        ripples = ripples.filter((ripple) => now - ripple.start < RIPPLE_LIFE_MS);
        if (ripples.length > 0) {
          raf = requestAnimationFrame((t) => draw(t, true));
          return;
        }
      }
      raf = 0;
    };

    const resize = (): void => {
      if (raf !== 0) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
      const rect = root.getBoundingClientRect();
      const dpr = Math.min(MAX_DPR, window.devicePixelRatio || 1);
      width = rect.width;
      height = rect.height;
      canvas.width = Math.max(1, Math.round(width * dpr));
      canvas.height = Math.max(1, Math.round(height * dpr));
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      draw(performance.now(), false);
    };

    const onPointerMove = (event: PointerEvent): void => {
      if (reduceMotion) return;
      const rect = root.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      if (x < 0 || y < 0 || x > width || y > height) return;

      const now = performance.now();
      const speed = Math.hypot(x - last.x, y - last.y);
      if (now - last.t < EMIT_GAP_MS && speed < 8) return;
      last = { x, y, t: now };
      ripples.push({ x, y, start: now, amp: Math.min(2.6, 0.8 + speed * 0.08) });
      if (ripples.length > MAX_RIPPLES) ripples = ripples.slice(-MAX_RIPPLES);
      if (raf === 0) raf = requestAnimationFrame((t) => draw(t, true));
    };

    const onVisibility = (): void => {
      if (document.visibilityState === 'hidden') {
        if (raf !== 0) {
          cancelAnimationFrame(raf);
          raf = 0;
        }
        ripples = [];
        return;
      }
      draw(performance.now(), false);
    };

    const schemeDark = window.matchMedia('(prefers-color-scheme: dark)');
    const schemeMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onTheme = (): void => {
      readColor();
      draw(performance.now(), false);
    };
    const onMotion = (): void => {
      reduceMotion = schemeMotion.matches;
      if (reduceMotion) {
        if (raf !== 0) {
          cancelAnimationFrame(raf);
          raf = 0;
        }
        ripples = [];
        draw(performance.now(), false);
      }
    };

    const themeObserver = new MutationObserver(onTheme);
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

    window.addEventListener('pointermove', onPointerMove, { passive: true });
    document.addEventListener('visibilitychange', onVisibility);
    if (typeof schemeDark.addEventListener === 'function') schemeDark.addEventListener('change', onTheme);
    if (typeof schemeMotion.addEventListener === 'function') schemeMotion.addEventListener('change', onMotion);

    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(root);

    readColor();
    resize();

    return () => {
      if (raf !== 0) cancelAnimationFrame(raf);
      window.removeEventListener('pointermove', onPointerMove);
      document.removeEventListener('visibilitychange', onVisibility);
      if (typeof schemeDark.removeEventListener === 'function') schemeDark.removeEventListener('change', onTheme);
      if (typeof schemeMotion.removeEventListener === 'function') schemeMotion.removeEventListener('change', onMotion);
      themeObserver.disconnect();
      resizeObserver.disconnect();
    };
  }, [tab]);

  return (
    <div ref={rootRef} aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
      <span
        ref={probeRef}
        aria-hidden
        className="absolute h-0 w-0 overflow-hidden"
        style={{ color: 'var(--meta)' }}
      />
    </div>
  );
}
