/**
 * 新增入口的共用入参与构造 —— 个人页与团队编辑态的"批量添加"必须走同一套换算。
 *
 * 为什么抽到 shared：入口是判别联合（web 只有 url、app 有 target/sourcePath/args…），
 * 同一行文本在两边各写一份构造，迟早分叉成"个人页能加、团队页被 schema 拒"这种只在
 * 某一侧出现的怪事。id 与时间由调用方传入，这里保持纯函数（可进 smoke）。
 */
import type { Entry } from './schema/entry.ts';

/** 新增入口的入参。sourcePath 用于保留 .lnk 原始路径，便于将来重新解析。 */
export interface NewEntryInput {
  /** web 时 target 放网址（批量粘贴里网址是主要场景，三条新增路径共用一套入参）。 */
  kind: 'app' | 'folder' | 'web';
  name: string;
  target: string;
  sourcePath?: string | null;
  /** 归到哪个分组；不传则由调用方决定默认落点。 */
  groupName?: string;
}

/** 由新增入参造一条入口。id 与 now 由调用方生成（保持本函数纯）。 */
export function makeEntry(input: NewEntryInput, sort: number, id: string, now: string): Entry {
  const common = {
    id,
    name: input.name,
    sort,
    icon: { kind: 'local' as const },
    iconAssetHash: null,
    updatedAt: now,
  };
  if (input.kind === 'web') {
    return { ...common, type: 'web', url: input.target, description: null };
  }
  return input.kind === 'app'
    ? {
        ...common,
        type: 'app',
        target: input.target,
        sourcePath: input.sourcePath ?? null,
        args: '',
        cwd: '',
        expandEnv: true,
      }
    : { ...common, type: 'folder', target: input.target };
}
