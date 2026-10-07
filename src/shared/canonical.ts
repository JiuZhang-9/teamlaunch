/**
 * src/shared/canonical.ts —— 规范 JSON（前后端共用）
 *
 * 规范化的定义（写死在这里，不得在实现里另立一套）：
 *   - 对象键按 UTF-16 码元升序排序，数组保持原顺序
 *   - 无任何空白字符
 *   - 字符串按 JSON 规则转义（不转义非 ASCII，保证 UTF-8 字节稳定）
 *   - undefined 字段丢弃，null 保留
 *
 * 本文件**必须保持零 Node 依赖**：renderer 的发布 diff 直接 import 它，
 * 而 Vite dev server 对 `node:crypto` 是 browser-external——顶层 import
 * 绑定一解析就抛错，整个渲染层白屏。哈希部分在 canonical-hash.ts（仅
 * 主进程/服务端加载）。
 */

export function canonicalJson(value: unknown): string {
  return serialize(value);
}

function serialize(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('canonicalJson: 不支持非有限数字');
    return JSON.stringify(value);
  }
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) {
    let out = '[';
    for (let i = 0; i < value.length; i += 1) {
      if (i > 0) out += ',';
      out += serialize(value[i]);
    }
    return `${out}]`;
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record)
      .filter((k) => record[k] !== undefined)
      .sort();
    let out = '{';
    for (let i = 0; i < keys.length; i += 1) {
      if (i > 0) out += ',';
      out += `${JSON.stringify(keys[i])}:${serialize(record[keys[i]])}`;
    }
    return `${out}}`;
  }
  throw new TypeError(`canonicalJson: 不支持的类型 ${typeof value}`);
}
