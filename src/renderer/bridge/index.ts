/**
 * 宿主能力解析 —— 渲染层获取 window.tl 的唯一入口。
 *
 * **这里没有预览模式。** 渲染层只认 Electron 宿主注入的 window.tl：
 * 有就是有，没有就是故障，直接进错误页。
 *
 * 曾经这里会在缺失时回落到一套 mock（假数据 + "预览模式未接入 X"的提示），
 * 结果是打包出来的程序一旦 preload 没加载上，就静默变成"演示版"——
 * 用户以为产品本来就这样，实际是功能全废。那套东西已彻底删除。
 */
import type { TeamLaunchApi } from './types.ts';

/** 故障文案：明确说这是故障，并给出可执行的下一步。不出现"预览模式"字样。 */
export const MISSING_PRELOAD_MESSAGE =
  '应用组件未能加载，请重新安装。若问题持续，请把安装目录下的 resources\\app.asar 反馈给管理员。';

export interface HostState {
  /** 非空 = 宿主不可用，渲染层必须渲染错误页、不进正常 UI。 */
  fatalError: string | null;
}

/** Electron 环境判定：file: 协议（打包后必然），或 UA 带 Electron。 */
function isElectronHost(): boolean {
  if (typeof navigator !== 'undefined' && /electron/i.test(navigator.userAgent ?? '')) return true;
  return typeof location !== 'undefined' && location.protocol === 'file:';
}

function hasHost(): boolean {
  return typeof window !== 'undefined' && Boolean(window.tl);
}

export const hostState: HostState = {
  fatalError: isElectronHost() && !hasHost() ? MISSING_PRELOAD_MESSAGE : null,
};

/**
 * 宿主缺失时的占位：任何调用**直接抛错**，不模拟、不伪造成功、不给假数据。
 *
 * 正常路径下 hostState.fatalError 非空时 App 会渲染错误页，这个占位不会被真正调用；
 * 它存在的唯一原因是各 store 在模块装载期就要 import api，需要一个非空对象。
 */
function createMissingHost(): TeamLaunchApi {
  const fail = (): never => {
    throw new Error(MISSING_PRELOAD_MESSAGE);
  };
  return new Proxy({} as TeamLaunchApi, {
    get: (_target, prop) => (prop === 'kind' ? 'electron' : fail),
  });
}

export const api: TeamLaunchApi = hasHost() ? window.tl! : createMissingHost();

export type { TeamLaunchApi };
