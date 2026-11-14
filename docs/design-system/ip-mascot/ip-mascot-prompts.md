# TeamLaunch IP 吉祥物出图提示词（ip-as-logo skill）

> 由 ip-as-logo skill（`~/.agents/skills/ip-as-logo`）流程产出，2026-11-14。
> 三个方向各 2 张，共 6 个独立候选：A1/A2（火箭）、B1/B2（方块机器人）、C1/C2（企鹅领队）。
> 配色全部取自产品设计令牌 `docs/design-system/design-tokens.css`（琥珀黄 `#fbbf24` / 珊瑚红 `#ee7a6c` /
> 深暖棕 `#2c2111` / 奶油底 `#fdf3e3` / 薄荷 `#e7f5ec` / 灰蓝 `#e7edf2` / 淡紫 `#efe7f1` 家族）。

## 使用规则（重要，来自 skill 硬规矩）

1. **一次只生成一张**：每个候选单独出图，绝不把六张拼成一张九宫格/联页图。
2. **尺寸**：请求 1:1 正方形，约 1536×1536；工具若只支持 1254×1254 就接受原样，不要重采样。
3. **提示词里没有 "logo / app icon" 字样是故意的**：skill 明确禁止在生成 prompt 里透露"这是 logo"，
   否则图像模型会往文字标跑。直接整段粘贴即可。
4. **现代模型**（GPT Image 2 / Nano Banana Pro·2 / Seedance 5.0 Pro / 即梦等指令跟随型）：
   直接用下面完整 prompt，末尾 `Constraints:` 行就是负向约束，**不要再单独填负向词框**。
5. **老式模型**（SD 系 / 有独立 negative_prompt 输入框的工具）：把 prompt 里的 `Constraints:` 整行删掉，
   改填附录 A 的负向词。
6. **一次成型**：每个候选生成一次，出什么用什么，不要自动重试；不满意就换候选或让我出新变体。
7. **不要用上一张结果当参考图**续生成，六个候选必须互相独立。
8. 所有候选都从**左下角探出**（skill 固定构图，占画面 85–95%），这是刻意的品牌构图记忆点。

## 三个方向

| 方向 | IP 主体 — 产品关联 — 定义轮廓 |
|---|---|
| A | 圆胖火箭 — 「TeamLaunch」名字直指"发射"，一键全员出发 — 钝圆头锥 + 大圆窗 + 短圆尾翼 |
| B | 圆角方块小机器人 — 产品本体是"入口卡片网格"，把一张入口卡片拟人化 — 圆角矩形身体 + 宽圆面罩 |
| C | 胖企鹅领队 — "团队列队、统一出发"的秩序感与亲和力 — 圆滚滚水滴形 + 短圆翅 |

---

## A1 · 圆胖火箭（暖琥珀黄 × 奶油白 / 深暖棕底）

配色映射：身体＝暖琥珀黄（令牌 `#fbbf24` 族），头锥+圆窗+尾翼＝奶油白（`#fdf3e3` 族），
五官复用琥珀黄；背景＝深暖棕（`#2c2111` 族压饱和）。构图：完整站直，下尾翼被左下角轻裁。

```text
Create one complete full-bleed 1:1 square image.
Background: fill the entire square with solid deep warm brown. Keep deep warm brown visible in every open area and in the corners not occupied by the character; the assigned emergence corner must be occupied by the character.
Subject: place one extremely simplified, cute, endearing plump toy rocket IP character on the background, reduced to one soft rounded continuous silhouette and one defining feature. The rocket stands upright, emerging from the lower-left corner: one blunt rounded nose cone, one large round window on the upper body, and two short rounded tail fins, with the lower fin gently cropped by the bottom-left edge. Face: two simple friendly eyes and one tiny calm smile placed on the round window area.
Complexity: use only 4–7 large basic shapes and at most two broad internal color regions. Use two simple eyes and add one tiny mouth only when it helps the expression. Remove every nonessential line, outline, anatomical detail, texture, and decoration. Keep the character readable at 32 × 32.
Color behavior: use exactly three semantic colors in the complete image: exactly two IP base colors plus the background color. The two IP colors are warm amber yellow for the rocket body and cream white for the nose cone, round window and tail fins, organized into broad purposeful masses; reuse warm amber yellow for the eyes and mouth. Fill the background with solid deep warm brown, gently muted so it feels restrained while remaining clearly chromatic, clean, and intentional rather than gray or muddy. Keep the IP, facial marks, and background clearly separated.
Composition: keep the character upright and emerging from the lower-left corner, filling about 85–95% of the square so it remains visually dominant. Cropping at the bottom or left side is welcome when it strengthens the corner emergence. Preserve both paired identifying features. Never center or bottom-center the character.
Style: make simplification, cuteness, and lovable baby-like appeal the strongest qualities. Use large soft forms, compact proportions, thick rounded contours, and an ultra-clean graphic treatment. Prefer one clear shape over several explanatory details. Add an extremely, extremely subtle, almost imperceptible sense of depth through a barely-there neo-skeuomorphic treatment.
Finish: show only the character on the full-canvas background, with clean surfaces and normal square outer corners.
Constraints: Use no text or watermark. Add no borders, frames, cards, or presentation masks. Include one character only, with no extra subjects or scenery. Use no fragile lines, sharp tips, unnecessary outlines, tiny details, or decorative marks. Add no photorealistic material, dramatic bevel, glossy hotspot, deep occlusion, extrusion, strong three-dimensional rendering, or external cast shadow. Keep the background solid and uniform, with no texture, vignette, or lighting variation.
```

## A2 · 圆胖火箭近裁（奶油白 × 软珊瑚红 / 柔杏底）

配色映射：身体＝奶油白，头锥+尾翼＝软珊瑚红（`#ee7a6c` 族），五官复用珊瑚红；
背景＝柔杏色（`#fbede6` 族）。构图：更贴左下、底部约三分之一被裁，只露上半身；表情换成小圆嘴的欢呼感。
定义特征：仍是大圆窗（同物种），但面部直接画在身上、不再画窗，形状更少更胖。

```text
Create one complete full-bleed 1:1 square image.
Background: fill the entire square with solid soft apricot. Keep soft apricot visible in every open area and in the corners not occupied by the character; the assigned emergence corner must be occupied by the character.
Subject: place one extremely simplified, cute, endearing plump toy rocket IP character on the background, reduced to one soft rounded continuous silhouette and one defining feature. The rocket leans out of the lower-left corner, its lower third cropped by the bottom edge: one blunt rounded nose cone and two short rounded tail fins, with the face drawn directly on the body — two simple friendly eyes and one tiny round open mouth expressing a happy cheer.
Complexity: use only 4–7 large basic shapes and at most two broad internal color regions. Use two simple eyes and add one tiny mouth only when it helps the expression. Remove every nonessential line, outline, anatomical detail, texture, and decoration. Keep the character readable at 32 × 32.
Color behavior: use exactly three semantic colors in the complete image: exactly two IP base colors plus the background color. The two IP colors are cream white for the rocket body and soft coral red for the nose cone and tail fins, organized into broad purposeful masses; reuse soft coral red for the eyes and mouth. Fill the background with solid soft apricot, gently muted so it feels restrained while remaining clearly chromatic, clean, and intentional rather than gray or muddy. Keep the IP, facial marks, and background clearly separated.
Composition: keep the character upright and emerging from the lower-left corner, filling about 85–95% of the square so it remains visually dominant. Cropping at the bottom or left side is welcome when it strengthens the corner emergence. Preserve both paired identifying features. Never center or bottom-center the character.
Style: make simplification, cuteness, and lovable baby-like appeal the strongest qualities. Use large soft forms, compact proportions, thick rounded contours, and an ultra-clean graphic treatment. Prefer one clear shape over several explanatory details. Add an extremely, extremely subtle, almost imperceptible sense of depth through a barely-there neo-skeuomorphic treatment.
Finish: show only the character on the full-canvas background, with clean surfaces and normal square outer corners.
Constraints: Use no text or watermark. Add no borders, frames, cards, or presentation masks. Include one character only, with no extra subjects or scenery. Use no fragile lines, sharp tips, unnecessary outlines, tiny details, or decorative marks. Add no photorealistic material, dramatic bevel, glossy hotspot, deep occlusion, extrusion, strong three-dimensional rendering, or external cast shadow. Keep the background solid and uniform, with no texture, vignette, or lighting variation.
```

## B1 · 入口卡片小机器人（暖琥珀黄 × 深暖棕 / 薄荷底）

配色映射：圆角方块身体＝暖琥珀黄（`#fbbf24` 族），宽面罩＝深暖棕（`#2c2111` 族），
面罩上的眼睛与小嘴复用奶油白；背景＝柔和薄荷青（`#e7f5ec` 族）。
构图：全身直立、双短圆臂垂在身侧，完整不裁。唯一物种特征＝宽面罩（入口卡片的"标题栏"）。

```text
Create one complete full-bleed 1:1 square image.
Background: fill the entire square with solid soft mint green. Keep soft mint green visible in every open area and in the corners not occupied by the character; the assigned emergence corner must be occupied by the character.
Subject: place one extremely simplified, cute, endearing rounded-square robot IP character on the background, reduced to one soft rounded continuous silhouette and one defining feature. The robot stands upright in the lower-left corner, full body visible: one rounded square body, one broad horizontal visor panel across the upper face, and two stubby rounded arms resting at the sides. Face: two simple friendly eyes and one tiny calm smile placed on the visor panel.
Complexity: use only 4–7 large basic shapes and at most two broad internal color regions. Use two simple eyes and add one tiny mouth only when it helps the expression. Remove every nonessential line, outline, anatomical detail, texture, and decoration. Keep the character readable at 32 × 32.
Color behavior: use exactly three semantic colors in the complete image: exactly two IP base colors plus the background color. The two IP colors are warm amber yellow for the rounded square body and deep warm brown for the broad visor panel, organized into broad purposeful masses; reuse cream white from the visor's light counterpart for the eyes and mouth on the visor. Fill the background with solid soft mint green, gently muted so it feels restrained while remaining clearly chromatic, clean, and intentional rather than gray or muddy. Keep the IP, facial marks, and background clearly separated.
Composition: keep the character upright and emerging from the lower-left corner, filling about 85–95% of the square so it remains visually dominant. Cropping at the bottom or left side is welcome when it strengthens the corner emergence. Preserve both paired identifying features. Never center or bottom-center the character.
Style: make simplification, cuteness, and lovable baby-like appeal the strongest qualities. Use large soft forms, compact proportions, thick rounded contours, and an ultra-clean graphic treatment. Prefer one clear shape over several explanatory details. Add an extremely, extremely subtle, almost imperceptible sense of depth through a barely-there neo-skeuomorphic treatment.
Finish: show only the character on the full-canvas background, with clean surfaces and normal square outer corners.
Constraints: Use no text or watermark. Add no borders, frames, cards, or presentation masks. Include one character only, with no extra subjects or scenery. Use no fragile lines, sharp tips, unnecessary outlines, tiny details, or decorative marks. Add no photorealistic material, dramatic bevel, glossy hotspot, deep occlusion, extrusion, strong three-dimensional rendering, or external cast shadow. Keep the background solid and uniform, with no texture, vignette, or lighting variation.
```

## B2 · 入口卡片小机器人挥手（软珊瑚红 × 奶油白 / 灰蓝底）

配色映射：身体＝软珊瑚红（`#ee7a6c` 族），面罩＝奶油白（`#fdf3e3` 族），眼睛复用珊瑚红；
背景＝柔和灰蓝（`#e7edf2` 族）。构图：身体微微向左下倾探，右下留出背景；一只短圆臂举起挥手
（双臂都在画面内），一只眼眨眼微笑。

```text
Create one complete full-bleed 1:1 square image.
Background: fill the entire square with solid muted steel blue. Keep muted steel blue visible in every open area and in the corners not occupied by the character; the assigned emergence corner must be occupied by the character.
Subject: place one extremely simplified, cute, endearing rounded-square robot IP character on the background, reduced to one soft rounded continuous silhouette and one defining feature. The robot leans gently out of the lower-left corner: one rounded square body, one broad horizontal visor panel across the upper face, and two stubby rounded arms with one raised in a friendly wave, both arms visible. Face: two simple eyes with one eye closed in a friendly wink and one tiny smile placed on the visor panel.
Complexity: use only 4–7 large basic shapes and at most two broad internal color regions. Use two simple eyes and add one tiny mouth only when it helps the expression. Remove every nonessential line, outline, anatomical detail, texture, and decoration. Keep the character readable at 32 × 32.
Color behavior: use exactly three semantic colors in the complete image: exactly two IP base colors plus the background color. The two IP colors are soft coral red for the rounded square body and cream white for the broad visor panel, organized into broad purposeful masses; reuse soft coral red for the eyes and mouth on the visor. Fill the background with solid muted steel blue, gently muted so it feels restrained while remaining clearly chromatic, clean, and intentional rather than gray or muddy. Keep the IP, facial marks, and background clearly separated.
Composition: keep the character upright and emerging from the lower-left corner, filling about 85–95% of the square so it remains visually dominant. Cropping at the bottom or left side is welcome when it strengthens the corner emergence. Preserve both paired identifying features. Never center or bottom-center the character.
Style: make simplification, cuteness, and lovable baby-like appeal the strongest qualities. Use large soft forms, compact proportions, thick rounded contours, and an ultra-clean graphic treatment. Prefer one clear shape over several explanatory details. Add an extremely, extremely subtle, almost imperceptible sense of depth through a barely-there neo-skeuomorphic treatment.
Finish: show only the character on the full-canvas background, with clean surfaces and normal square outer corners.
Constraints: Use no text or watermark. Add no borders, frames, cards, or presentation masks. Include one character only, with no extra subjects or scenery. Use no fragile lines, sharp tips, unnecessary outlines, tiny details, or decorative marks. Add no photorealistic material, dramatic bevel, glossy hotspot, deep occlusion, extrusion, strong three-dimensional rendering, or external cast shadow. Keep the background solid and uniform, with no texture, vignette, or lighting variation.
```

## C1 · 胖企鹅领队（深暖棕 × 奶油白 / 黄油底）

配色映射：背与头＝深暖棕（`#2c2111` 族），肚与脸斑＝奶油白（`#fdf3e3` 族），喙与脚复用深暖棕；
背景＝柔和黄油黄（`#fdf3e3`/`#fbbf24` 之间的低饱和档）。构图：全身站立，一只短圆翅微举打招呼
（双翅都可见）。企鹅两色天然满足"恰好两色"约束。

```text
Create one complete full-bleed 1:1 square image.
Background: fill the entire square with solid soft butter yellow. Keep soft butter yellow visible in every open area and in the corners not occupied by the character; the assigned emergence corner must be occupied by the character.
Subject: place one extremely simplified, cute, endearing plump penguin IP character on the background, reduced to one soft rounded continuous silhouette and one defining feature. The penguin stands upright in the lower-left corner, full body visible: one rounded teardrop body, one broad cream face and belly patch, two short rounded flippers with one raised in a friendly greeting, and two tiny rounded feet. Face: two simple friendly eyes and one tiny calm smile on the cream face patch.
Complexity: use only 4–7 large basic shapes and at most two broad internal color regions. Use two simple eyes and add one tiny mouth only when it helps the expression. Remove every nonessential line, outline, anatomical detail, texture, and decoration. Keep the character readable at 32 × 32.
Color behavior: use exactly three semantic colors in the complete image: exactly two IP base colors plus the background color. The two IP colors are deep warm brown for the back, head, beak and feet, and cream white for the face and belly patch, organized into broad purposeful masses; reuse deep warm brown for the eyes and mouth. Fill the background with solid soft butter yellow, gently muted so it feels restrained while remaining clearly chromatic, clean, and intentional rather than gray or muddy. Keep the IP, facial marks, and background clearly separated.
Composition: keep the character upright and emerging from the lower-left corner, filling about 85–95% of the square so it remains visually dominant. Cropping at the bottom or left side is welcome when it strengthens the corner emergence. Preserve both paired identifying features. Never center or bottom-center the character.
Style: make simplification, cuteness, and lovable baby-like appeal the strongest qualities. Use large soft forms, compact proportions, thick rounded contours, and an ultra-clean graphic treatment. Prefer one clear shape over several explanatory details. Add an extremely, extremely subtle, almost imperceptible sense of depth through a barely-there neo-skeuomorphic treatment.
Finish: show only the character on the full-canvas background, with clean surfaces and normal square outer corners.
Constraints: Use no text or watermark. Add no borders, frames, cards, or presentation masks. Include one character only, with no extra subjects or scenery. Use no fragile lines, sharp tips, unnecessary outlines, tiny details, or decorative marks. Add no photorealistic material, dramatic bevel, glossy hotspot, deep occlusion, extrusion, strong three-dimensional rendering, or external cast shadow. Keep the background solid and uniform, with no texture, vignette, or lighting variation.
```

## C2 · 珊瑚背企鹅歪头（软珊瑚红 × 暖琥珀黄 / 淡紫底）

配色映射：背与头＝软珊瑚红（`#ee7a6c` 族），脸斑与肚＝暖琥珀黄（`#fbbf24` 族），喙、脚、五官复用珊瑚红；
背景＝柔和淡紫（`#efe7f1` 族）。构图：微微歪头，全身下缘轻裁；六张里唯一"双 IP 色都非中性"的配色策略。

```text
Create one complete full-bleed 1:1 square image.
Background: fill the entire square with solid muted lilac. Keep muted lilac visible in every open area and in the corners not occupied by the character; the assigned emergence corner must be occupied by the character.
Subject: place one extremely simplified, cute, endearing plump penguin IP character on the background, reduced to one soft rounded continuous silhouette and one defining feature. The penguin leans out of the lower-left corner with its head tilted slightly, lower body gently cropped by the bottom edge: one rounded teardrop body, one broad face and belly patch, two short rounded flippers tucked at the sides, and two tiny rounded feet. Face: two simple friendly eyes and one tiny calm smile on the face patch.
Complexity: use only 4–7 large basic shapes and at most two broad internal color regions. Use two simple eyes and add one tiny mouth only when it helps the expression. Remove every nonessential line, outline, anatomical detail, texture, and decoration. Keep the character readable at 32 × 32.
Color behavior: use exactly three semantic colors in the complete image: exactly two IP base colors plus the background color. The two IP colors are soft coral red for the back, head, beak and feet, and warm amber yellow for the face and belly patch, organized into broad purposeful masses; reuse soft coral red for the eyes and mouth. Fill the background with solid muted lilac, gently muted so it feels restrained while remaining clearly chromatic, clean, and intentional rather than gray or muddy. Keep the IP, facial marks, and background clearly separated.
Composition: keep the character upright and emerging from the lower-left corner, filling about 85–95% of the square so it remains visually dominant. Cropping at the bottom or left side is welcome when it strengthens the corner emergence. Preserve both paired identifying features. Never center or bottom-center the character.
Style: make simplification, cuteness, and lovable baby-like appeal the strongest qualities. Use large soft forms, compact proportions, thick rounded contours, and an ultra-clean graphic treatment. Prefer one clear shape over several explanatory details. Add an extremely, extremely subtle, almost imperceptible sense of depth through a barely-there neo-skeuomorphic treatment.
Finish: show only the character on the full-canvas background, with clean surfaces and normal square outer corners.
Constraints: Use no text or watermark. Add no borders, frames, cards, or presentation masks. Include one character only, with no extra subjects or scenery. Use no fragile lines, sharp tips, unnecessary outlines, tiny details, or decorative marks. Add no photorealistic material, dramatic bevel, glossy hotspot, deep occlusion, extrusion, strong three-dimensional rendering, or external cast shadow. Keep the background solid and uniform, with no texture, vignette, or lighting variation.
```

---

## 附录 A · 老式模型（有独立 negative_prompt 输入框）专用

用上附录负向词时，把正文 prompt 里整行 `Constraints: …` 删掉再粘贴，避免同一份约束走两个通道重复。

```text
text, watermark, borders, frames, cards, presentation masks, extra subjects, scenery, thin fragile lines, sharp tips, photorealistic materials, strong three-dimensional rendering, external cast shadows
```

## 出图之后的下一步（skill 不负责、需单独做）

1. 六张里选中一张后，如需微调（换背景色/表情/配色），回来让我按同一骨架出替换候选，不要在原图上改。
2. 定稿图 → 派生 `build/icon.ico`（多尺寸 16/24/32/48/64/128/256）、`build/tray.ico`、安装包侧图等，
   属于单独的转换流程，届时另做并跑门禁。
3. 当前 `build/icon.ico` 仍是黑底白 T 字标，动它之前记得这属于"改代码/资源"，按交付顺序走
   （先出图实测、通过后再提交）。
