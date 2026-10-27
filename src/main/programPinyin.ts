/**
 * 程序名 → 拼音检索键（主进程侧，pinyin-pro）。
 *
 * 为什么放主进程：拼音库只服务索引构建，渲染层拿预计算好的 `py` / `pyInit` 做纯字符串匹配，
 * 不必把拼音数据打进渲染包。词边界口径见下方注释。
 */
import { pinyin } from 'pinyin-pro';

/** 只保留字母数字：搜索时同样做这个归一，两端口径一致。ü 统一写成 v（nv / lvxing）。 */
function compact(value: string): string {
  return value
    .toLowerCase()
    .replace(/[üǖǘǚǜ]/g, 'v')
    .replace(/[^a-z0-9]+/g, '');
}

/**
 * 全拼 + 首字母。
 *
 * pinyin-pro 的 `nonZh: 'consecutive'` 会把连续的非中文原样返回（"Google Chrome" 是一段），
 * 所以首字母要再按空格/符号切词：中文每个音节取首字母，英文每个单词取首字母。
 * 例：微信 → weixin / wx；Google Chrome → googlechrome / gc；QQ音乐 → qqyinyue / qyy。
 */
export function pinyinKeys(text: string): { py: string; pyInit: string } {
  const segments = pinyin(text, {
    toneType: 'none',
    type: 'array',
    nonZh: 'consecutive',
  }) as string[];

  const py = compact(segments.join(''));
  let initials = '';
  for (const raw of segments) {
    const seg = raw.trim();
    if (seg.length === 0) continue;
    for (const word of seg.split(/[^A-Za-z0-9]+/)) {
      if (word.length > 0) initials += word[0];
    }
  }
  return { py, pyInit: compact(initials) };
}
