# TeamLaunch IP 候选 · 编辑优化提示词（第二轮：图生图 / 局部重绘）

> 2026-11-14。针对用户精选的 5 张（已复制到 `selected/`）：A1-run1·#1 火箭、B2-run1·#0 机器人、
> C1·#0 走路企鹅、C1·#3 像素企鹅、C2·#0 歪头企鹅。
> 与首轮出图提示词（`ip-mascot-prompts.md`）不同：**这些是"编辑已有图"的提示词**，要把原图一起喂给工具。
>
> **已拍板（2026-11-14）**：① 5 张**并存优化**，修完再定主形象；② 像素企鹅走**严格像素化**（路线 A，
> 脚下黑线默认去掉——想找回随时能补，反之难抠）；③ 编辑走**指令式工具**（Nano Banana Pro / GPT Image 类），
> 原图 + 提示词整段直接贴。

## 用法（按工具分）

| 工具 | 用法 |
|---|---|
| **Nano Banana Pro / GPT Image / Seed 类指令编辑** | 上传原图 + 直接粘贴提示词整段（推荐，指令服从最好） |
| **Midjourney Editor** | 用"局部重绘"涂选要改的区域（背景/脸部），再粘贴提示词；MJ 对整段指令服从弱，**尽量只涂要改的部分** |
| **MJ 变体路线** | 原图 URL 作 `--cref`（角色参考）出全新变体，贴首轮文档里的提示词并加修改要求 |

通用注意：一次只让模型改一类东西（背景/脸/手指分开做），改完不满意就重抽，别在同一张上连续叠改。
提示词里不出现 logo / icon 字样（skill 纪律）；**透明底不要让模型做**——定稿后由脚本对纯色底抠图。

---

## P1 · A1-run1·#1（3D 黄火箭）

**现状**：形象极萌（窗环脸+奶油头锥），但背景是暖棕渐变光效+地面反光，构图居中。
**保**：形象、材质、表情全保留。**修**：背景纯色化、角色放大占满画面。

```text
Edit this image. Keep the character exactly as it is: the same plump toy rocket with the same cream nose cone, the same ring window with the smiling face inside, the same cream side fins and rounded feet, the same soft felt-clay material, colors and proportions. Only change the background: replace the warm gradient glow and the soft floor light with one completely solid, uniform deep warm brown filling the entire square, with no gradient, no vignette, no lighting variation, no ground plane, and no cast shadow. Slightly enlarge the character so it fills about 85–90% of the square. Constraints: no text, no watermark, no borders, no scenery, keep the character's identity unchanged.
```

可选追加（按需拼进主提示词末尾）：

- 构图左下版：`Move the character so it emerges gently from the lower-left corner, slightly cropped at the bottom edge.`
- 眨眼表情版：`Change the expression to two closed happy eyes with the same tiny smile.`
- 珊瑚配色变体：`Change the cream nose cone, window ring and fins to soft coral red, keep everything else identical.`

---

## P2 · B2-run1·#0（手绘方块机器人）

**现状**：形态和表情都好（走路挥手、闭眼笑），但地面有草丛杂物+阴影线，纸面颗粒重。
**保**：手绘速写风格、姿态、表情。**修**：清场（去草丛/地线/投影）。

```text
Edit this image. Keep the character exactly as it is: the same rounded-square coral red robot walking and waving with its cream visor face, closed happy eyes and open smile, the same hand-drawn illustration style, pencil texture, colors and proportions. Only clean up the scene: remove the grass, the plants, the ground line and the cast shadow, and fill the entire square with one completely solid, uniform muted steel blue background, with no scenery, no ground, no texture patches. Constraints: no text, no watermark, no borders, no scenery, keep the character's identity, pose and hand-drawn style unchanged.
```

可选追加：

- 手指圆润化：`Replace the detailed waving hand with a simple rounded mitten hand with no individual fingers.`
- 缝线简化：`Simplify the panel seam lines on the body so only two or three large soft shapes remain.`
- 半清干净版（去纸颗粒但保留手绘笔触感）：`Repaint the character with cleaner surfaces and much less paper grain, keeping a subtle hand-drawn feel.`

---

## P3 · C1·#3（像素企鹅）【已拍板】严格像素化

**现状**：GameBoy 味的侧身像素企鹅，复古感强，但像素网格不规整、杂灰阶多、脚下有一条黑线、
底色是米色纸纹而非纯色。
**已拍板**：走严格像素资产路线；脚下黑线默认去掉（想找回随时可在像素编辑器补一条，反之难抠）。

```text
Edit this image. Redraw the penguin as a clean, strict pixel-art sprite on a uniform square pixel grid of about 64 × 64 cells: keep the same side-view penguin with cream face and belly patch, same friendly expression and pose. Limit the palette to exactly three colors — deep charcoal brown for the body, cream white for the face and belly, one solid soft butter yellow filling the background — remove all stray intermediate pixels, noise and dithering, remove the dark ground line under the feet, align every pixel to the grid, and add a consistent one-pixel deep charcoal outline around the character. Enlarge the penguin so it fills about 85% of the square. Constraints: no text, no watermark, exactly three colors, crisp grid-aligned pixels only, no dithering, no gradient.
```

想保留脚下黑线的复古味：从主提示词里删掉 `remove the dark ground line under the feet, ` 这一段即可。

备选路线（未选，留档）· 转黏土风：

```text
Edit this image. Keep the exact composition, pose, colors and expression of this penguin, but repaint it as a soft rounded felt-clay character with smooth continuous surfaces, replacing the pixel-art rendering entirely. Fill the entire square with one solid soft butter yellow background, with no ground line and no noise. Constraints: no text, no watermark, keep the character's identity unchanged.
```

---

## P4 · C1·#0（3D 走路企鹅）

**现状**：这批里最有故事感的一张（一摇一摆走路），瑕疵最少；只有背景轻微噪点和地面投影，
构图偏小。
**保**：姿态、材质、表情全保留。**修**：几乎只有背景纯净化+放大。

```text
Edit this image. Keep the character exactly as it is: the same plump felt-clay penguin waddling with one foot lifted, the same deep charcoal back and cream belly, the same friendly face with the small dark beak, the same material and proportions. Only change the background: make it one completely solid, uniform soft butter yellow filling the entire square, with no gradient, no vignette, no floor plane, keeping only a very subtle soft contact shadow directly under the feet. Slightly enlarge the penguin so it fills about 85–90% of the square. Constraints: no text, no watermark, no scenery, keep the character's identity unchanged.
```

可选追加：

- 镜像（朝左走）：`Mirror the character so it walks toward the left.`（朝右走其实有"出发"语义，可不改）
- 打招呼版：`Raise one flipper in a friendly greeting while keeping the waddling pose.`
- 眨眼表情版：`Change the expression to one closed happy eye and one open eye, keeping the tiny beak smile.`

---

## P5 · C2·#0（手绘歪头企鹅）

**现状**：构图全 28 张最佳（左下探出+底部裁切）、配色精准（珊瑚×琥珀×淡紫），但脸部五官失衡
（双目错位+嘴线怪）。
**保**：构图、配色、歪头、描边风格。**修**：只重画脸。

```text
Edit this image. Keep the composition, colors and hand-drawn outline style exactly as they are: the same plump coral red penguin with the amber face patch and belly, the same muted lilac solid background, the same gentle head tilt, the same lower-left emergence with the bottom edge crop, the same flipper shapes. Only redraw the face: place two simple round dark eyes symmetrically on the amber face patch with even spacing and the same size, and one tiny simple calm smile centered between and below them; remove the odd beak line, the misplaced eye and every stray mark, so the expression becomes calm, friendly and balanced. Constraints: no text, no watermark, keep the character's identity, pose, colors and outline style unchanged.
```

可选追加：

- 描边减淡：`Soften the black outline to a thinner, subtler line.`
- 眨眼开心版：`Change the expression to one closed happy eye and one open eye with a tiny open smile.`

---

## 编辑时的公共纪律（来自 skill）

1. **一次一类改动**：背景、脸、手别在一次编辑里全要求，模型会顾此失彼。
2. **改完不满意就重抽**，不要在结果上继续叠改（会越改越糊）。
3. 修好的图如果整体气质已经对了，**别再让模型"优化"第二遍**。
4. 透明底/尺寸裁切/ico 转换：定稿后脚本处理，不进提示词。

## 建议执行顺序（一次一类改动，逐张推进）

| 顺序 | 图 | 第一段编辑（必修） | 可选第二段（第一段满意后再做） |
|---|---|---|---|
| 1 | A1 火箭 #1 | 纯色底+放大（P1 主提示词） | 左下构图版 / 表情或珊瑚配色变体 |
| 2 | 走路企鹅 #0 | 纯色底+放大（P4 主提示词） | 打招呼版 / 眨眼版 |
| 3 | 机器人 #0 | 清场去草丛（P2 主提示词） | 手指圆润化 / 缝线简化 |
| 4 | 歪头企鹅 #0 | 只重画脸（P5 主提示词） | 描边减淡 |
| 5 | 像素企鹅 #3 | 严格像素化（P3 已选路线） | 无——网格图别再叠改 |

## 修完怎么交回来

像这次一样：编辑好的图放一个文件夹 → 告诉我路径 → 我建第二轮评审页（原版 vs 编辑版对比 + 规范点评 +
32×32 实测）→ 你勾选 → 我打包。每张至少交 1 张主编辑结果；同张做了可选第二段的，两个版本都给我。
