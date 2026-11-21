/**
 * 网页搜索（2026-11-21，1.11.0）。
 *
 * 用户想法：搜索框里打好内容后，一个按钮 / Alt+Enter 直接用浏览器搜索。
 * 拍板口径：**不读应用内配置的引擎**，而是用目标浏览器自己的默认搜索引擎——
 * 在浏览器里怎么搜，这里就怎么搜；读不到时回退 Bing，并在界面上如实显示。
 *
 * 这里放纯函数（判定类必须放 shared，smoke/门禁才能覆盖）：
 *  - `parseDefaultSearchTemplate`：从 Chromium 的 Preferences JSON 里取默认搜索模板；
 *  - `buildWebSearchUrl`：把 `{searchTerms}` 换成编码后的词，并清理其余占位变量；
 *  - `looksLikeUrlOrPath`：输入本身是网址/路径时不显示"搜索网页"（避免搜一个网址）。
 *
 * 隐私：只读浏览器的搜索模板字段，不读历史/书签；URL 只在本机拼好交给浏览器，
 * 不经过同步/上报。
 */

export interface SearchEngineTemplate {
  /** 引擎显示名（Preferences 里的 short_name，如「百度」）。 */
  name: string;
  /** 搜索 URL 模板，必须含 `{searchTerms}`。 */
  template: string;
}

/** 读不到浏览器默认引擎时的兜底：Bing（国内可直连，结果页相对干净）。 */
export const FALLBACK_SEARCH_ENGINE: SearchEngineTemplate = {
  name: 'Bing',
  template: 'https://www.bing.com/search?q={searchTerms}',
};

/** 内置搜索引擎的 URL 模板（Preferences 里只存 keyword，不存模板，见下方说明）。 */
const KNOWN_ENGINES: Array<{ pattern: RegExp; engine: SearchEngineTemplate }> = [
  { pattern: /(^|\.)bing\.com$/i, engine: { name: 'Bing', template: 'https://www.bing.com/search?q={searchTerms}' } },
  { pattern: /(^|\.)google\./i, engine: { name: 'Google', template: 'https://www.google.com/search?q={searchTerms}' } },
  { pattern: /(^|\.)baidu\.com$/i, engine: { name: '百度', template: 'https://www.baidu.com/s?wd={searchTerms}' } },
  { pattern: /(^|\.)sogou\.com$/i, engine: { name: '搜狗', template: 'https://www.sogou.com/web?query={searchTerms}' } },
  { pattern: /(^|\.)so\.com$/i, engine: { name: '360 搜索', template: 'https://www.so.com/s?q={searchTerms}' } },
];

function knownEngine(keyword: string, shortName: string): SearchEngineTemplate | null {
  for (const item of KNOWN_ENGINES) {
    if (item.pattern.test(keyword) || item.pattern.test(shortName)) return item.engine;
  }
  return null;
}

/**
 * 从 Preferences JSON 里取默认搜索引擎模板。结构不认识就返回 null（调用方回退）。
 *
 * 两种真实形态（2026-11-21 本机实测）：
 *  - 旧版/自定义引擎：`default_search_provider_data.template_url_data.search_url` 带完整模板；
 *  - 新版 Chrome：`default_search_provider_data.mirrored_template_url_data` 只有
 *    `keyword` / `short_name`（如 `bing.com` / `Microsoft Bing`），**内置引擎的 URL 模板
 *    在浏览器二进制里、不落盘**——这时按 keyword 映射内置模板；映射不到才回退。
 *
 * 旧字段 `default_search_provider` 一并兼容。只认 GET 模板（`search_url`）。
 */
export function parseDefaultSearchTemplate(prefs: unknown): SearchEngineTemplate | null {
  if (prefs === null || typeof prefs !== 'object') return null;
  const root = prefs as Record<string, unknown>;
  const candidates: unknown[] = [];
  const data = root.default_search_provider_data;
  if (data !== null && typeof data === 'object') {
    const record = data as Record<string, unknown>;
    candidates.push(record.template_url_data);
    candidates.push(record.mirrored_template_url_data);
  }
  candidates.push(root.default_search_provider);
  for (const raw of candidates) {
    if (raw === null || typeof raw !== 'object') continue;
    const item = raw as Record<string, unknown>;
    const shortName = typeof item.short_name === 'string' ? item.short_name.trim() : '';
    const keyword = typeof item.keyword === 'string' ? item.keyword.trim() : '';
    const template = item.search_url;
    if (typeof template === 'string' && template.includes('{searchTerms}')) {
      return {
        name: shortName.length > 0 ? shortName : keyword.length > 0 ? keyword : '浏览器默认搜索引擎',
        template,
      };
    }
    /* 新版 Chrome 只落 keyword：按内置引擎映射。 */
    const mapped = knownEngine(keyword, shortName);
    if (mapped !== null) return mapped;
  }
  return null;
}

/**
 * 用模板拼搜索结果 URL。
 *
 * - `{searchTerms}` → `encodeURIComponent(query)`；
 * - 其余 `{inputEncoding}` / `{language}` 这类次要变量直接清空，并清理留下的空参数；
 * - 结果必须仍是合法的 http(s) URL，否则返回 null（调用方回退）。
 */
export function buildWebSearchUrl(engine: SearchEngineTemplate, query: string): string | null {
  const trimmed = query.trim();
  if (trimmed.length === 0) return null;
  /* host 段必须来自模板的固定部分：`https://{google:baseURL}/search` 这类模板
     清掉变量后会变成 `https:///search`，URL 解析器会把它错认成 host=search。 */
  const host = /^https?:\/\/([^/]+)/i.exec(engine.template)?.[1];
  if (host === undefined || host.includes('{')) return null;
  let url = engine.template.replaceAll('{searchTerms}', encodeURIComponent(trimmed));
  /* 模板里可能还有 {inputEncoding}、{google:baseURL} 之类；清掉占位符，
     再收拾 `?&` / `&&` / 结尾的 &。host 被清坏的模板会在下面 URL 校验里被拒。 */
  url = url.replace(/\{[^}]*\}/g, '');
  url = url.replace(/([?&])&+/g, '$1').replace(/[?&]+$/, '');
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

/**
 * 输入本身像网址/路径时，不提供"网页搜索"：
 * `https://…`、`C:\…`、`\\server\share`、`./…`、`/…`。
 * 普通域名（`example.com`）不算——用户很可能就是想搜它。
 */
export function looksLikeUrlOrPath(text: string): boolean {
  const value = text.trim();
  if (value.length === 0) return false;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) return true;
  if (/^[a-zA-Z]:[\\/]/.test(value)) return true;
  if (/^\\\\/.test(value)) return true;
  if (/^(?:\.{1,2}[\\/]|[\\/])/.test(value)) return true;
  return false;
}
