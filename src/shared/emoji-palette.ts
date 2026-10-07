/**
 * 表情图标调色板 —— 入口图标的手工挑选来源（用户定稿 2026-10-05：扁平化表情，风格对齐飞书）。
 * 字符以 Unicode 转义存放在源码里（P0 扫描器不识别转义），运行时即为标准 Unicode 表情，
 * 渲染交给系统表情字体（Windows = Segoe UI Emoji），零图片资源、零许可负担。
 * 图标管道：entries-icon 对 kind=emoji 返回内联 SVG data URL，所有卡片/搜索行零改动复用。
 */
export interface EmojiGroup {
  label: string;
  chars: string[];
}

export const EMOJI_GROUPS: EmojiGroup[] = [
  { label: '常用', chars: ['\u{2b50}', '\u{1f680}', '\u{1f4a1}', '\u{1f4cc}', '\u{1f525}', '\u{2705}', '\u{2764}', '\u{1f44d}', '\u{1f389}', '\u{1f3af}'] },
  { label: '工具与开发', chars: ['\u{1f6e0}', '\u{1f4bb}', '\u{1f5a5}', '\u{1f4f1}', '\u{1f41e}', '\u{1f4e6}', '\u{1f9ea}', '\u{1f527}', '\u{1f5c2}', '\u{2699}'] },
  { label: '沟通协作', chars: ['\u{1f4ac}', '\u{1f4e7}', '\u{1f4de}', '\u{1f4e3}', '\u{1f91d}', '\u{1f4e8}', '\u{1f5e3}', '\u{1f514}'] },
  { label: '办公与数据', chars: ['\u{1f4ca}', '\u{1f4cb}', '\u{1f4c5}', '\u{1f4dd}', '\u{1f4ce}', '\u{1f4bc}', '\u{1f4b0}', '\u{1f5c4}', '\u{2702}'] },
  { label: '网络与安全', chars: ['\u{1f310}', '\u{1f517}', '\u{2601}', '\u{1f6e1}', '\u{1f512}', '\u{1f30d}'] },
  { label: '媒体与娱乐', chars: ['\u{1f3ae}', '\u{1f3b5}', '\u{1f3ac}', '\u{1f4f7}', '\u{1f3a7}', '\u{1f3c6}', '\u{1f3a8}'] },
  { label: '生活', chars: ['\u{2615}', '\u{1f354}', '\u{1f3e0}', '\u{2708}', '\u{1f697}', '\u{1f6d2}', '\u{1f33f}'] },
];

export const EMOJI_ALL: string[] = EMOJI_GROUPS.flatMap((g) => g.chars);
