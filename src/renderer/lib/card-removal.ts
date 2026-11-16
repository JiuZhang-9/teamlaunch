/**
 * 卡片删除动效 + FLIP 补位（1.9.0，2026-11-15 用户从 10 机制演示中选定 6 种做成设置项）。
 *
 * 统一时序（所有机制共用）：
 *   ① 先量幸存卡片的现位置（FLIP 的"旧位置"）；
 *   ② 按选中的机制给每张待删卡片叠动效层（克隆真实卡片 DOM，按机制切条/拆块/缩放）；
 *   ③ 动画走完才调用 commit()（真实从 store 移除）；
 *   ④ React 重渲后的下一帧量"新位置"，对幸存卡片做 FLIP——从旧位置滑到新位置。
 *
 * 这里只负责时序与 DOM，不碰任何 store；commit 由调用方给（removeEntry/removeEntries）。
 * prefers-reduced-motion 下跳过全部动画直接提交，避免"看着没动却等了半秒"。
 */

export type DeleteFx = 'dissolve' | 'rgb' | 'crt' | 'melt' | 'burn' | 'tiles';

/** 各机制动画总时长（不含批量错峰），提交 store 前的等待依据。 */
const FX_DUR: Record<DeleteFx, number> = {
  dissolve: 830,
  rgb: 470,
  crt: 660,
  melt: 850,
  burn: 570,
  tiles: 690,
};
const FLIP_MS = 240;
const STAGGER_MS = 70;

/** 在卡片正上方建一层动效载体（fixed 定位对齐视口矩形），clone 为真实卡片 DOM。 */
function makeLayer(
  card: HTMLElement,
  opts: { tint?: string; clip?: string; transparentBg?: boolean } = {},
): HTMLElement {
  const rect = card.getBoundingClientRect();
  const layer = document.createElement('div');
  layer.className = 'tl-fx-layer';
  layer.style.cssText = `position:fixed;left:${rect.left}px;top:${rect.top}px;width:${rect.width}px;height:${rect.height}px;z-index:80;pointer-events:none;${opts.clip ? `clip-path:${opts.clip};` : ''}`;
  const clone = card.cloneNode(true) as HTMLElement;
  clone.removeAttribute('data-tl-card-id');
  clone.removeAttribute('data-tl-marquee-hit');
  clone.removeAttribute('data-tl-selected');
  clone.style.cssText += ';position:absolute;inset:0;width:100%;height:100%;margin:0;visibility:visible;';
  if (opts.transparentBg) clone.style.background = 'transparent';
  if (opts.tint) layer.style.background = opts.tint;
  layer.appendChild(clone);
  document.body.appendChild(layer);
  return layer;
}

/** 播放一层动效；delayMs 为正时把动画 startTime 推迟到未来（批量错峰用）。 */
function playLayer(layer: HTMLElement, keyframes: Keyframe[], dur: number, delayMs = 0, easing = 'linear'): void {
  const a = layer.animate(keyframes, { duration: dur, easing, fill: 'forwards' });
  if (delayMs > 0) a.startTime = performance.now() + delayMs;
  a.onfinish = () => {
    a.cancel();
    layer.remove();
  };
}

/* ---------- 六种机制（每个 runner 返回该机制的总时长，不含批量错峰） ---------- */

/** dissolve 像素溶解：6×5=30 小块，乱序闪烁着消失。 */
function fxDissolve(card: HTMLElement, delayMs: number): number {
  const cols = 6, rows = 5;
  const order: number[] = [];
  for (let i = 0; i < cols * rows; i += 1) order.push(i);
  order.sort(() => Math.random() - 0.5);
  order.forEach((idx, k) => {
    const col = idx % cols, row = (idx / cols) | 0;
    const layer = makeLayer(card, {
      clip: `inset(${row * 20}% ${(cols - 1 - col) * (100 / cols)}% ${(rows - 1 - row) * 20}% ${col * (100 / cols)}%)`,
    });
    playLayer(layer, [
      { opacity: 1 },
      { opacity: 1, offset: 0.4 + Math.random() * 0.2 },
      { opacity: 0 },
    ], 640, delayMs + k * 6);
  });
  return 640 + (cols * rows - 1) * 6;
}

/** rgb RGB 三通道爆散：红/绿/蓝三层各朝一个方向飞散淡出。 */
function fxRgb(card: HTMLElement, delayMs: number): number {
  const tints = ['rgba(255,45,85,.5)', 'rgba(45,255,120,.5)', 'rgba(45,120,255,.5)'];
  const dirs: Array<[number, number, number]> = [[80, -55, 8], [-70, 45, -7], [0, 85, 0]];
  dirs.forEach(([dx, dy, rot], i) => {
    const layer = makeLayer(card, { tint: tints[i], transparentBg: true });
    playLayer(layer, [
      { transform: 'none', opacity: 0.9 },
      { transform: `translate(${dx * 0.4}px, ${dy * 0.4}px) rotate(${rot * 0.5}deg)`, opacity: 0.8, offset: 0.35 },
      { transform: `translate(${dx}px, ${dy}px) rotate(${rot}deg)`, opacity: 0 },
    ], 430, delayMs, 'cubic-bezier(0.2,0,0,1)');
  });
  return 430;
}

/** crt CRT 关机：整卡压扁成一条亮线，亮点一缩即灭。 */
function fxCrt(card: HTMLElement, delayMs: number): number {
  const layer = makeLayer(card);
  layer.style.transformOrigin = '50% 50%';
  playLayer(layer, [
    { transform: 'scaleY(1)', filter: 'brightness(1)' },
    { transform: 'scaleY(0.28)', filter: 'brightness(1.6)', offset: 0.45 },
    { transform: 'scaleY(0.006)', filter: 'brightness(4)', offset: 0.75 },
    { transform: 'scaleY(0.004) scaleX(0.25)', filter: 'brightness(6)', opacity: 0 },
  ], 480, delayMs, 'cubic-bezier(0.4,0,1,1)');
  const rect = card.getBoundingClientRect();
  const line = document.createElement('div');
  line.className = 'tl-fx-layer';
  line.style.cssText = `position:fixed;left:${rect.left}px;top:${rect.top + rect.height / 2 - 1}px;width:${rect.width}px;height:2px;background:#eaffff;box-shadow:0 0 12px 2px #bfefff;z-index:80;pointer-events:none;`;
  document.body.appendChild(line);
  playLayer(line, [
    { opacity: 1, transform: 'scaleX(1)' },
    { opacity: 1, transform: 'scaleX(0.12)', offset: 0.7 },
    { opacity: 0, transform: 'scaleX(0)' },
  ], 300, delayMs + 330, 'cubic-bezier(0.4,0,1,1)');
  return 630;
}

/** melt 熔化下滴：八根液柱各自以不同速度拉长滴落。 */
function fxMelt(card: HTMLElement, delayMs: number): number {
  const cols = 8;
  for (let j = 0; j < cols; j += 1) {
    const layer = makeLayer(card, { clip: `inset(0 ${(cols - 1 - j) * (100 / cols)}% 0 ${j * (100 / cols)}%)` });
    layer.style.transformOrigin = '50% 0';
    const drop = 26 + Math.random() * 70;
    playLayer(layer, [
      { transform: 'translateY(0) scaleY(1)', opacity: 1 },
      { transform: `translateY(${drop * 0.45}px) scaleY(1.35)`, opacity: 0.95, offset: 0.55 },
      { transform: `translateY(${drop}px) scaleY(1.9)`, opacity: 0 },
    ], 640, delayMs + j * 28, 'cubic-bezier(0.6,0,0.9,0.6)');
  }
  return 640 + (cols - 1) * 28;
}

/** burn 烧灼扫描：橙色灼线从上往下扫，扫过即烧穿。 */
function fxBurn(card: HTMLElement, delayMs: number): number {
  const layer = makeLayer(card);
  playLayer(layer, [
    { clipPath: 'inset(0 0 0 0)' },
    { clipPath: 'inset(100% 0 0 0)' },
  ], 560, delayMs, 'linear');
  const rect = card.getBoundingClientRect();
  const bar = document.createElement('div');
  bar.className = 'tl-fx-layer';
  bar.style.cssText = `position:fixed;left:${rect.left - 6}px;top:${rect.top - 16}px;width:${rect.width + 12}px;height:14px;background:linear-gradient(rgba(255,138,45,0), rgba(255,138,45,.85) 55%, rgba(255,230,150,.95) 72%, rgba(255,138,45,.4));filter:blur(.5px);z-index:80;pointer-events:none;`;
  document.body.appendChild(bar);
  playLayer(bar, [
    { top: `${rect.top - 16}px` },
    { top: `${rect.top + rect.height}px` },
  ], 560, delayMs, 'linear');
  return 560;
}

/** tiles 方块爆飞：4×4 碎块从中心向外炸开带旋转。 */
function fxTiles(card: HTMLElement, delayMs: number): number {
  const cols = 4, rows = 4;
  let maxEnd = 0;
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const layer = makeLayer(card, { clip: `inset(${row * 25}% ${(cols - 1 - col) * 25}% ${(rows - 1 - row) * 25}% ${col * 25}%)` });
      const dx = (col - (cols - 1) / 2) * (46 + Math.random() * 30);
      const dy = (row - (rows - 1) / 2) * (38 + Math.random() * 26);
      const rot = (Math.random() - 0.5) * 90;
      const delay = delayMs + (row + col) * 22;
      maxEnd = Math.max(maxEnd, delay + 540);
      playLayer(layer, [
        { transform: 'none', opacity: 1 },
        { transform: `translate(${dx * 0.35}px, ${dy * 0.35}px) rotate(${rot * 0.4}deg)`, opacity: 1, offset: 0.3 },
        { transform: `translate(${dx}px, ${dy + 46}px) rotate(${rot}deg)`, opacity: 0 },
      ], 540, delay, 'cubic-bezier(0.45,0,0.8,0.4)');
    }
  }
  return maxEnd;
}

const FX_RUNNERS: Record<DeleteFx, (card: HTMLElement, delayMs: number) => number> = {
  dissolve: fxDissolve,
  rgb: fxRgb,
  crt: fxCrt,
  melt: fxMelt,
  burn: fxBurn,
  tiles: fxTiles,
};

/** 对一批卡片播放删除动效，动画结束后提交 store；幸存卡片 FLIP 补位。 */
export function glitchRemoveCards(
  entryIds: string[],
  commit: () => void,
  fx: DeleteFx = 'dissolve',
): void {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    commit();
    return;
  }
  const idSet = new Set(entryIds);
  const targets = entryIds
    .map((id) => document.querySelector<HTMLElement>(`[data-tl-card-id="${CSS.escape(id)}"]`))
    .filter((el): el is HTMLElement => el !== null);
  if (targets.length === 0) {
    commit();
    return;
  }
  /* 补位范围 = 被删卡片所在的那个内容面板（团队 / 个人页各自的网格一起补位）。 */
  const scope = targets[0].closest<HTMLElement>('[id^="tl-panel-"]') ?? document;
  const survivors = [...scope.querySelectorAll<HTMLElement>('[data-tl-card-id]')].filter(
    (el) => !idSet.has(el.getAttribute('data-tl-card-id') ?? ''),
  );
  const firstRects = new Map(survivors.map((el) => [el, el.getBoundingClientRect()]));

  let maxEnd = 0;
  targets.forEach((card, i) => {
    const delay = i * STAGGER_MS;
    /* 克隆要在隐藏本体之前做，否则克隆出的是 visibility:hidden 的空壳。 */
    const end = FX_RUNNERS[fx]?.(card, delay) ?? FX_DUR[fx];
    card.style.visibility = 'hidden';
    maxEnd = Math.max(maxEnd, end + delay);
  });
  window.setTimeout(() => {
    commit();
    requestAnimationFrame(() => {
      for (const el of survivors) {
        if (!el.isConnected) continue;
        const prev = firstRects.get(el);
        if (!prev) continue;
        const now = el.getBoundingClientRect();
        const dx = prev.left - now.left;
        const dy = prev.top - now.top;
        if (dx === 0 && dy === 0) continue;
        el.style.transition = 'none';
        el.style.transform = `translate(${dx}px, ${dy}px)`;
        requestAnimationFrame(() => {
          el.style.transition = `transform ${FLIP_MS}ms var(--ease-emphasis)`;
          el.style.transform = '';
          const cleanup = (): void => {
            el.style.transition = '';
            el.removeEventListener('transitionend', cleanup);
          };
          el.addEventListener('transitionend', cleanup);
        });
      }
    });
  }, maxEnd);
}

export { STAGGER_MS as CARD_FX_STAGGER_MS };
