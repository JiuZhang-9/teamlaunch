/**
 * 本机程序搜索打分（纯函数，放 shared 以便 smoke/门禁直测）。
 *
 * 目标体验是"像 uTools"：中文名按汉字、全拼、首字母都能搜到。
 * 拼音键由主进程在扫描时预计算（pinyin-pro），渲染层只做纯字符串比较——
 * 这样渲染层不必为搜索引入拼音库，门禁也能直接测打分逻辑。
 *
 * 打分是**分段**的，不追求连续值：同段内再按名称短优先、界面顺序稳定即可。
 */

export interface SearchableProgram {
  name: string;
  target: string;
  /** 全拼（小写、去分隔符）。 */
  py?: string;
  /** 拼音首字母（小写）。 */
  pyInit?: string;
}

/** 搜索归一：小写、ü → v、去空白与常见分隔符（"Visual Studio" → "visualstudio"）。 */
export function normalizeSearchText(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/[üǖǘǚǜ]/g, 'v')
    .replace(/[\s\-_.·]+/g, '');
}

function basename(target: string): string {
  return target.replace(/^.*[\\/]/, '').toLowerCase();
}

/**
 * 命中返回 >0，未命中返回 0。分段：
 *   100 名称完全一致
 *    92 名称前缀
 *    88 拼音首字母完全一致（wx → 微信）
 *    86 全拼完全一致（weixin → 微信）
 *    80 首字母前缀
 *    78 全拼前缀
 *    70 名称包含
 *    60 首字母 / 全拼包含
 *    40 目标文件名包含（chrome → chrome.exe）
 *
 * 刻意**不匹配完整路径**：路径里的 "Program Files" 会让 "program" 之类的查询命中几乎所有程序。
 */
export function scoreProgram(item: SearchableProgram, query: string): number {
  const q = query.trim().toLowerCase();
  if (q.length === 0) return 0;
  const qc = normalizeSearchText(q);
  if (qc.length === 0) return 0;

  const name = item.name.toLowerCase();
  const nameC = normalizeSearchText(item.name);
  const py = (item.py ?? '').toLowerCase();
  const pyInit = (item.pyInit ?? '').toLowerCase();

  if (name === q) return 100;
  if (nameC === qc) return 98;
  if (name.startsWith(q)) return 92;
  if (nameC.startsWith(qc)) return 90;
  if (pyInit.length > 0 && pyInit === qc) return 88;
  if (py.length > 0 && py === qc) return 86;
  if (pyInit.length > 0 && pyInit.startsWith(qc)) return 80;
  if (py.length > 0 && py.startsWith(qc)) return 78;
  if (name.includes(q)) return 70;
  if (nameC.includes(qc)) return 68;
  if (pyInit.length > 0 && pyInit.includes(qc)) return 60;
  if (py.length > 0 && py.includes(qc)) return 58;
  if (basename(item.target).includes(q)) return 40;
  return 0;
}
