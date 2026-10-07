#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
TeamLaunch P0 设计红线扫描器

扫描两处产出，命中任一红线即退出码 1：
  1. docs/design-system/  设计规范文档与 token 表
  2. src/renderer/        渲染层源码（.ts / .tsx / .css）

源码侧覆盖的必要性：emoji 图标、紫粉系色值这类违规在**写代码当时根本意识不到**，
靠人工 review 守不住。硬编码色值另有 eslint 门禁（见 eslint.config.js），此处不重复。

红线清单
  P0-1 禁止 emoji 作为功能图标（含 ASCII 线框图里的 emoji 占位）
  P0-2 禁止紫→粉渐变主视觉（#7C3AED / #A855F7 / #9333EA / #EC4899 之间任意渐变组合）
       以及 Indigo #6366F1 作为强调色
  P0-3 禁止 AI 模板味文案（Welcome to / Lorem ipsum / Sign up today / 快速开始 /
       一站式 / 赋能 / 生态 / 无缝衔接 / 云端分析 等）
  P0-4 禁止非 ASCII 乱码（韩文 / 西里尔 / 阿拉伯 / 假名区段误入）
  P0-5 禁止弹性缓动 cubic-bezier(0.68, -0.55, 0.265, 1.55)

豁免约定
  行内含「扫描豁免」字样的行不清扫——用于「禁用词清单」这类必须原文列出禁用词的场景。
  豁免只能用于清单行，正文出现禁用词仍然算命中。

用法
  python docs/design-system/scan-p0.py
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
PROJECT_ROOT = ROOT.parent.parent
EXEMPT = "扫描豁免"

EMOJI_RE = re.compile(
    "[\U0001F300-\U0001F9FF\U00002600-\U000026FF\U00002700-\U000027BF"
    "\U0001FA00-\U0001FAFF\U00002B00-\U00002BFF\U0000FE00-\U0000FE0F]"
)
GARBLED_RE = re.compile("[\uac00-\ud7af\u0400-\u04ff\u0600-\u06ff\u3040-\u30ff]")

BANNED_COPY = [
    "Welcome to", "Lorem ipsum", "Sign up today",
    "快速开始", "一站式", "赋能", "生态", "无缝衔接",
    "云端分析", "上传分析", "数据资产", "改善体验", "优化产品",
]
PURPLE_PINK = ["7C3AED", "A855F7", "9333EA", "EC4899", "6366F1"]
BOUNCE = "cubic-bezier(0.68, -0.55, 0.265, 1.55)"

# 扫描器自身含有全部禁用词与禁用色的“清单原文”，必须自排除，否则永远自命中
SELF_EXCLUDE = {"scan-p0.py", "validate-tokens.py"}

SUFFIXES = {".md", ".css", ".json", ".py", ".mjs", ".ts", ".tsx"}

# 渲染层源码一并纳入：这是 P0 违规**实际发生**的地方，只扫文档等于没有门禁。
EXTRA_ROOTS = [PROJECT_ROOT / "src" / "renderer"]


def collect(base: Path) -> list[Path]:
    if not base.is_dir():
        return []
    return [
        p
        for p in base.rglob("*")
        if p.is_file() and p.suffix in SUFFIXES and p.name not in SELF_EXCLUDE
    ]


TARGETS = sorted(collect(ROOT) + [p for r in EXTRA_ROOTS for p in collect(r)])


def rel_of(path: Path) -> str:
    """源码路径相对项目根更有定位价值；文档路径相对文档根即可。"""
    for base in (PROJECT_ROOT, ROOT):
        try:
            return str(path.relative_to(base))
        except ValueError:
            continue
    return str(path)

hits: list[str] = []
checked_lines = 0

for path in TARGETS:
    try:
        text = path.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        hits.append(f"{path.name}: 文件不是 UTF-8")
        continue
    for no, line in enumerate(text.splitlines(), 1):
        if EXEMPT in line:
            continue
        checked_lines += 1
        rel = rel_of(path)
        for m in EMOJI_RE.findall(line):
            hits.append(f"P0-1 emoji   {rel}:{no}  {m!r}")
        for m in GARBLED_RE.findall(line):
            hits.append(f"P0-4 乱码    {rel}:{no}  {m!r}")
        low = line.lower()
        for w in BANNED_COPY:
            if w.lower() in low:
                hits.append(f"P0-3 模板文案 {rel}:{no}  {w}")
        for c in PURPLE_PINK:
            if c.lower() in low:
                hits.append(f"P0-2 禁用色   {rel}:{no}  #{c}")
        if BOUNCE in line:
            hits.append(f"P0-5 弹性缓动 {rel}:{no}")

print(f"扫描文件 {len(TARGETS)} 个，有效行 {checked_lines} 行（豁免行已跳过）")
if hits:
    print("\n=== BLOCKING ===")
    for h in hits:
        print(" - " + h)
    print(f"\n命中 {len(hits)} 项")
    print("RESULT: FAIL")
    sys.exit(1)

print("P0-1 emoji            OK")
print("P0-2 紫粉系 / Indigo   OK")
print("P0-3 AI 模板文案       OK")
print("P0-4 乱码             OK")
print("P0-5 弹性缓动          OK")
print("\nRESULT: PASS")
