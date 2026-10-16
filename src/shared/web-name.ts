/**
 * 网页入口的默认名称 —— 与主进程 `identifyAsEntry` 共用的**同一条规则**（去 www 的 hostname）。
 *
 * 为什么抽出来：网页名称自动识别要靠它判断"这个名称还是不是默认值"
 * （是默认值才允许用抓来的标题覆盖；用户手写过的名字绝不覆盖），
 * 规则写两份就会出现"界面认为是默认、主进程认为不是"的静默错配。
 */
export function defaultWebName(rawUrl: string): string | null {
  try {
    const host = new URL(String(rawUrl)).hostname.replace(/^www\./i, '');
    return host.length > 0 ? host : null;
  } catch {
    return null;
  }
}
