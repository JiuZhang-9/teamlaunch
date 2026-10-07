#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
TeamLaunch Design Token 校验器

用途：CI / 本地一键校验 docs/design-system/design-tokens.json 的结构完整性。
退出码：0 = 全部通过；1 = 存在阻断项。

校验项
  1. JSON 可被标准库 json.load 读取（无语法错误、无重复键）
  2. 全部 {a.b.c} 引用可解析
     —— component / a11y 层允许写「主题相对引用」 `{semantic.*}`，
        校验器会分别在 semantic.light 与 semantic.dark 两个主题下解析
  3. light / dark 两套 semantic 的键完全对等（不得只在一侧定义）
  4. primitive 层不得反向引用 semantic（分层依赖只向下）
  5. 颜色值必须是 #RGB / #RRGGBB（forced-colors 系统关键字除外）
  6. P0 反模式扫描：禁止出现紫粉系主色、禁止出现 emoji

用法
  python docs/design-system/validate-tokens.py
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

FILE = Path(__file__).with_name("design-tokens.json")
THEMES = ("light", "dark")
SYSTEM_COLOR_KEYWORDS = {
    # forced-colors 映射允许的系统关键字
    "Canvas", "CanvasText", "Highlight", "HighlightText", "LinkText", "GrayText",
}
BANNED_HUES = {"7C3AED", "A855F7", "9333EA", "EC4899", "6366F1", "3B82F6"}
EMOJI_RE = re.compile(
    "[" "\U0001F300-\U0001F9FF" "\U00002600-\U000026FF" "\U00002700-\U000027BF" "]"
)

errors: list[str] = []
warns: list[str] = []


def resolve(doc: dict, path: str) -> tuple[bool, str]:
    """解析 {a.b.c} 引用。主题相对引用在 light/dark 两侧都必须能解析。"""
    parts = path.split(".")
    if parts[0] == "semantic" and len(parts) > 1 and parts[1] not in THEMES:
        rest = parts[1:]
        results = []
        for theme in THEMES:
            cur = doc.get("semantic", {}).get(theme)
            ok = True
            for p in rest:
                if isinstance(cur, dict) and p in cur:
                    cur = cur[p]
                else:
                    ok = False
                    break
            results.append((ok, theme))
        if all(ok for ok, _ in results):
            return True, "both themes"
        missing = [t for ok, t in results if not ok]
        return False, f"主题缺失: {', '.join(missing)}"

    cur = doc
    for p in parts:
        if isinstance(cur, dict) and p in cur:
            cur = cur[p]
        else:
            return False, "路径不存在"
    return True, "ok"


def walk_leaves(node, prefix=""):
    if isinstance(node, dict):
        if "value" in node:
            yield prefix, node
        else:
            for k, v in node.items():
                yield from walk_leaves(v, f"{prefix}.{k}" if prefix else k)
    elif isinstance(node, list):
        for i, v in enumerate(node):
            yield from walk_leaves(v, f"{prefix}[{i}]")


def main() -> int:
    if not FILE.exists():
        print(f"[FATAL] 找不到 {FILE}")
        return 1

    raw = FILE.read_text(encoding="utf-8")

    # --- 1. json.load ---------------------------------------------------
    try:
        doc = json.loads(raw)
    except json.JSONDecodeError as exc:
        print(f"[FATAL] json.load 失败: {exc}")
        return 1
    print(f"[1/6] json.load                OK  ({FILE.name}, {len(raw)} bytes)")

    # --- 2. 引用解析 ----------------------------------------------------
    refs = sorted(set(re.findall(r"\{([a-zA-Z0-9_.]+)\}", raw)))
    broken = []
    for r in refs:
        ok, why = resolve(doc, r)
        if not ok:
            broken.append(f"{r} -> {why}")
    if broken:
        errors.append("存在无法解析的引用：\n    " + "\n    ".join(broken))
        print(f"[2/6] 引用解析                  FAIL ({len(broken)}/{len(refs)} 断链)")
    else:
        print(f"[2/6] 引用解析                  OK  ({len(refs)} 条引用全部可解析)")

    # --- 3. 双主题对等 --------------------------------------------------
    def keyset(node, prefix=""):
        out = set()
        if isinstance(node, dict):
            if "value" in node:
                out.add(prefix)
            else:
                for k, v in node.items():
                    out |= keyset(v, f"{prefix}.{k}" if prefix else k)
        return out

    sem = doc.get("semantic", {})
    sets = {t: keyset(sem.get(t, {})) for t in THEMES}
    if len(sets["light"]) != len(sets["dark"]) or (sets["light"] ^ sets["dark"]):
        diff = sorted(sets["light"] ^ sets["dark"])
        errors.append("light/dark semantic 键不对等：\n    " + "\n    ".join(diff))
        print("[3/6] 双主题对等                FAIL")
    else:
        print(f"[3/6] 双主题对等                OK  (各 {len(sets['light'])} 个 semantic 键)")

    # --- 4. 分层依赖只向下 ----------------------------------------------
    prim_raw = json.dumps(doc.get("primitive", {}), ensure_ascii=False)
    upward = re.findall(r"\{(semantic|component)\.", prim_raw)
    if upward:
        errors.append(f"primitive 层反向引用了上层：{set(upward)}")
        print("[4/6] 分层依赖方向              FAIL")
    else:
        print("[4/6] 分层依赖方向              OK  (primitive 不引用上层)")

    # --- 5. 颜色格式 ----------------------------------------------------
    bad_color = []
    for path, leaf in walk_leaves(doc.get("primitive", {}), "primitive"):
        if leaf.get("type") != "color":
            continue
        v = str(leaf["value"]).strip()
        if v in SYSTEM_COLOR_KEYWORDS:
            continue
        if not re.fullmatch(r"#[0-9A-Fa-f]{6}", v) and not re.fullmatch(
            r"#[0-9A-Fa-f]{3}", v
        ):
            bad_color.append(f"{path} = {v}")
    if bad_color:
        errors.append("颜色值格式非法：\n    " + "\n    ".join(bad_color))
        print(f"[5/6] 颜色格式                  FAIL ({len(bad_color)} 项)")
    else:
        print("[5/6] 颜色格式                  OK  (#RRGGBB / 系统关键字)")

    # --- 6. P0 反模式扫描 -----------------------------------------------
    hits = [h for h in BANNED_HUES if h.lower() in raw.lower()]
    emoji_hits = EMOJI_RE.findall(raw)
    if hits:
        errors.append(f"出现禁用色相（紫粉系 / Tailwind Indigo / #3B82F6）：{hits}")
    if emoji_hits:
        errors.append(f"出现 emoji：{set(emoji_hits)}")
    if hits or emoji_hits:
        print("[6/6] P0 反模式扫描             FAIL")
    else:
        print("[6/6] P0 反模式扫描             OK  (无紫粉系、无 emoji)")

    # --- 汇总 ------------------------------------------------------------
    leaf_count = sum(1 for _ in walk_leaves(doc))
    print("-" * 60)
    print(f"leaf token 总数 : {leaf_count}")
    print(f"版本            : {doc.get('version')}")
    print(f"图标库          : {doc.get('meta', {}).get('iconLibrary', {}).get('package')}"
          f"@{doc.get('meta', {}).get('iconLibrary', {}).get('version')}"
          f" (verified={doc.get('meta', {}).get('iconLibrary', {}).get('verified')})")
    for w in warns:
        print(f"[warn] {w}")
    if errors:
        print("\n=== BLOCKING ===")
        for e in errors:
            print(" - " + e)
        print("\nRESULT: FAIL")
        return 1
    print("\nRESULT: PASS")
    return 0


if __name__ == "__main__":
    sys.exit(main())
