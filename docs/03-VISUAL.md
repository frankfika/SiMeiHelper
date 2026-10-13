# 司美助手 SiMeiHelper — 视觉规范（VISUAL）

| 项 | 值 |
|---|---|
| 版本 | v1.0（MVP） |
| 日期 | 2026-10-05 |
| 状态 | 已定稿，可实施 |
| 关联文档 | 02-UX.md（内容与交互）· 05-DATA.md（数据） |

> 所有尺寸单位为 **rpx**（750 设计宽）。所有颜色通过 CSS 变量引用，**禁止在页面 wxss 中写死十六进制色值**（canvas 除外，canvas 从 `utils/theme.js` 取色）。

---

## 1. 设计原则

1. **安静的医疗信任感**：低饱和湖青色为主色，大量留白，暖白底而非纯白，像一间干净明亮的诊室，而不是健身 App。
2. **温暖，不说教**：AI（小美）专属一抹杏橙色，只出现在 AI 相关元素上，让"有人在陪你"可被看见。圆角偏大，不用尖锐的红色表达体重上升。
3. **极简层级**：每屏只有一个实色主按钮；信息靠字号和留白分层，不靠框线和颜色堆叠。
4. **数字要好读**：体重、份数、百分比使用等宽数字、大字号；单位用小一号的次级色。
5. **可访问**：正文对比度 ≥ 4.5:1，暗色模式完整支持。

---

## 2. 视觉关键词与禁忌

- 关键词：湖青、暖白、杏橙点缀、大圆角、柔和投影、留白、等宽数字。
- 禁忌：纯黑 #000 文本、纯白 #FFF 页面底、高饱和渐变、霓虹色、体重上升用红色、卡通化人体、"前后对比"减肥广告式视觉、感叹号成串。

---

## 3. Design Tokens

### 3.1 色板（`app.wxss` 中 `page { }` 定义）

| Token | 浅色 | 暗色 | 用途 | 对比度（浅色，对白/对底） |
|---|---|---|---|---|
| `--c-primary` | `#1F7A6E` | `#4FBFAE` | 主色：主按钮、选中态、进度、均线 | 5.16 / 4.70 |
| `--c-primary-pressed` | `#17625A` | `#3FA99A` | 主按钮按下 | — |
| `--c-on-primary` | `#FFFFFF` | `#0E1F1C` | 主色上的文字 | — |
| `--c-primary-soft` | `#E3F1EE` | `#18332F` | 次按钮底、chip 轻选、cup 已填 | — |
| `--c-accent` | `#E8835A` | `#F08C6A` | AI 专属点缀（图标、色条，**不用于正文文字**） | 2.68（仅装饰） |
| `--c-accent-text` | `#B4472C` | `#F4A487` | AI 标签文字 | 5.41 |
| `--c-accent-soft` | `#FDF1EA` | `#33231C` | AI 卡片渐变起点 | — |
| `--c-bg` | `#F6F4F0` | `#121615` | 页面底色（暖白） | — |
| `--c-surface` | `#FFFFFF` | `#1C2120` | 卡片 | — |
| `--c-surface-2` | `#EFECE6` | `#252B2A` | 输入框底、分段控件底、环轨道、未选 chip | — |
| `--c-border` | `#E4E0D8` | `#2E3534` | 分割线、描边 | — |
| `--c-text-1` | `#1C2624` | `#E6EDEB` | 标题、正文 | 15.6 |
| `--c-text-2` | `#5B6B70` | `#A9B5B3` | 次要文字 | 5.55 / 5.05 |
| `--c-text-3` | `#6B7A7E` | `#8C9997` | 辅助说明（仅用于 ≥24rpx） | 4.46 |
| `--c-placeholder` | `#9AA5A8` | `#5F6B69` | 输入框占位 | — |
| `--c-success` | `#2F855A` | `#5CC28A` | 达标、"稳" | 4.54 |
| `--c-success-soft` | `#E6F4EC` | `#173225` | | |
| `--c-warning` | `#B7791F` | `#E0A84A` | 提示色条/图标（不作小字） | 3.64 |
| `--c-warning-text` | `#8A5A0B` | `#F0C27A` | 提示文字 | 6.3 |
| `--c-warning-soft` | `#FFF4DE` | `#33280F` | 提示底 | |
| `--c-danger` | `#D14343` | `#F07171` | 急症、删除 | 4.57 |
| `--c-danger-soft` | `#FDECEC` | `#3A1C1C` | 急症卡底 | |
| `--c-info` | `#2B6CB0` | `#6AA6E0` | 说明块图标 | 5.4 |
| `--c-info-soft` | `#E8F0FA` | `#16263A` | 说明块底 | |
| `--c-mask` | `rgba(20,28,26,0.45)` | `rgba(0,0,0,0.6)` | 遮罩 | |

语义映射规则：
- 体重下降不用绿色庆祝、上升不用红色——趋势图与数字一律 `text-1`/`primary`；只有"减重速度"分档用 success/中性(text-2)/warning。
- 急症只用 danger；普通"难受"用 warning。
- AI 元素 = accent 系；用户行为/主操作 = primary 系。

### 3.2 字体

```css
page {
  font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Helvetica Neue", "Microsoft YaHei", sans-serif;
  -webkit-font-smoothing: antialiased;
}
.num { font-variant-numeric: tabular-nums; font-family: "DIN Alternate", -apple-system, "Helvetica Neue", sans-serif; }
```

### 3.3 字号 / 字重阶梯

| Token | 字号 | 行高 | 字重 | 用途 |
|---|---|---|---|---|
| `--fs-display` | 64rpx | 1.1 | 600 | 体重大数字、环中心百分比（`.num`） |
| `--fs-h1` | 44rpx | 1.3 | 600 | 页面大标题（onboarding 标题、文章标题） |
| `--fs-h2` | 36rpx | 1.4 | 600 | 简报 headline、卡片主标题 |
| `--fs-h3` | 32rpx | 1.4 | 600 | 区块标题、文章小标题 |
| `--fs-body-lg` | 32rpx | 1.6 | 400 | 对话气泡正文、文章正文 |
| `--fs-body` | 30rpx | 1.6 | 400 | 默认正文、列表项 |
| `--fs-body-sm` | 28rpx | 1.5 | 400 | chip、次按钮、表单值 |
| `--fs-caption` | 24rpx | 1.4 | 400 | 辅助说明、来源标签、tab 文字 |

字重仅使用 400 / 500 / 600。500 用于按钮文字与选中 tab。

### 3.4 间距阶梯

| Token | 值 | 用途 |
|---|---|---|
| `--sp-1` | 8rpx | 图标与文字间距、行内元素 |
| `--sp-2` | 16rpx | chip 之间、标题与副标题 |
| `--sp-3` | 24rpx | 卡片之间、卡内块之间 |
| `--sp-4` | 32rpx | 页面左右边距、卡片内边距 |
| `--sp-5` | 48rpx | 大区块之间、onboarding 内容区上下 |
| `--sp-6` | 64rpx | 空态上下留白 |

页面容器：`padding: 24rpx 32rpx calc(160rpx + env(safe-area-inset-bottom))`（底部为 tab bar 留空；二级页底部有固定按钮时为 `calc(176rpx + env(safe-area-inset-bottom))`）。

### 3.5 圆角

| Token | 值 | 用途 |
|---|---|---|
| `--r-sm` | 12rpx | cup 格子、小标签、tooltip |
| `--r-md` | 20rpx | 输入框、分段控件、部位格子 |
| `--r-lg` | 32rpx | 卡片、气泡 |
| `--r-pill` | 999rpx | 按钮、chip、pill |

### 3.6 阴影

| Token | 浅色 | 暗色 |
|---|---|---|
| `--shadow-card` | `0 2rpx 8rpx rgba(28,38,36,0.04), 0 8rpx 24rpx rgba(28,38,36,0.06)` | `none`（暗色改用 `1rpx solid var(--c-border)`） |
| `--shadow-float` | `0 8rpx 32rpx rgba(28,38,36,0.12)` | `0 8rpx 32rpx rgba(0,0,0,0.5)` |
| `--border-card` | `none` | `1rpx solid var(--c-border)` |

### 3.7 暗色模式实现

1. `app.json`：`"darkmode": true, "themeLocation": "theme.json"`。
2. `theme.json`（原样）：

```json
{
  "light": { "navBg": "#F6F4F0", "navText": "black", "pageBg": "#F6F4F0", "bgText": "dark",
             "tabColor": "#6B7A7E", "tabSelected": "#1F7A6E", "tabBg": "#FFFFFF" },
  "dark":  { "navBg": "#121615", "navText": "white", "pageBg": "#121615", "bgText": "light",
             "tabColor": "#8C9997", "tabSelected": "#4FBFAE", "tabBg": "#1C2120" }
}
```

3. `app.wxss`：`page { 浅色变量 }` + `@media (prefers-color-scheme: dark) { page { 暗色变量 } }`。自定义组件需在组件 wxss 中同样可读到 `page` 上的变量（CSS 变量可继承到组件内，组件 `options.styleIsolation` 保持默认 `isolated` 即可读取继承变量）。
4. canvas：`utils/theme.js` 导出 `{ light: {...}, dark: {...} }`，组件 `attached` 时读取 `getApp().globalData.theme`，并在 `wx.onThemeChange` 回调中重绘。
5. 暗色下：卡片去阴影加描边；`card-ai` 渐变改用暗色 token；图片/emoji 不做反色。

### 3.8 `app.wxss` 骨架（工程直接使用）

```css
page {
  --c-primary:#1F7A6E; --c-primary-pressed:#17625A; --c-on-primary:#FFFFFF; --c-primary-soft:#E3F1EE;
  --c-accent:#E8835A; --c-accent-text:#B4472C; --c-accent-soft:#FDF1EA;
  --c-bg:#F6F4F0; --c-surface:#FFFFFF; --c-surface-2:#EFECE6; --c-border:#E4E0D8;
  --c-text-1:#1C2624; --c-text-2:#5B6B70; --c-text-3:#6B7A7E; --c-placeholder:#9AA5A8;
  --c-success:#2F855A; --c-success-soft:#E6F4EC; --c-warning:#B7791F; --c-warning-text:#8A5A0B; --c-warning-soft:#FFF4DE;
  --c-danger:#D14343; --c-danger-soft:#FDECEC; --c-info:#2B6CB0; --c-info-soft:#E8F0FA; --c-mask:rgba(20,28,26,.45);
  --fs-display:64rpx; --fs-h1:44rpx; --fs-h2:36rpx; --fs-h3:32rpx; --fs-body-lg:32rpx; --fs-body:30rpx; --fs-body-sm:28rpx; --fs-caption:24rpx;
  --sp-1:8rpx; --sp-2:16rpx; --sp-3:24rpx; --sp-4:32rpx; --sp-5:48rpx; --sp-6:64rpx;
  --r-sm:12rpx; --r-md:20rpx; --r-lg:32rpx; --r-pill:999rpx;
  --shadow-card:0 2rpx 8rpx rgba(28,38,36,.04),0 8rpx 24rpx rgba(28,38,36,.06);
  --shadow-float:0 8rpx 32rpx rgba(28,38,36,.12); --border-card:none;
  --ai-gradient:linear-gradient(135deg,#FDF1EA 0%,#FFFFFF 62%);
  background:var(--c-bg); color:var(--c-text-1); font-size:var(--fs-body); line-height:1.6;
}
@media (prefers-color-scheme: dark) {
  page {
    --c-primary:#4FBFAE; --c-primary-pressed:#3FA99A; --c-on-primary:#0E1F1C; --c-primary-soft:#18332F;
    --c-accent:#F08C6A; --c-accent-text:#F4A487; --c-accent-soft:#33231C;
    --c-bg:#121615; --c-surface:#1C2120; --c-surface-2:#252B2A; --c-border:#2E3534;
    --c-text-1:#E6EDEB; --c-text-2:#A9B5B3; --c-text-3:#8C9997; --c-placeholder:#5F6B69;
    --c-success:#5CC28A; --c-success-soft:#173225; --c-warning:#E0A84A; --c-warning-text:#F0C27A; --c-warning-soft:#33280F;
    --c-danger:#F07171; --c-danger-soft:#3A1C1C; --c-info:#6AA6E0; --c-info-soft:#16263A; --c-mask:rgba(0,0,0,.6);
    --shadow-card:none; --shadow-float:0 8rpx 32rpx rgba(0,0,0,.5); --border-card:1rpx solid #2E3534;
    --ai-gradient:linear-gradient(135deg,#33231C 0%,#1C2120 62%);
  }
}
```

---

## 4. 组件规格

> 全局类名在 `app.wxss` 定义；带 `components/` 的为自定义组件。

### 4.1 卡片 `.card` / `.card-ai` / `.card-flat`

| 属性 | `.card` | `.card-ai` | `.card-flat` |
|---|---|---|---|
| 背景 | `--c-surface` | `--ai-gradient` | `--c-surface-2` |
| 圆角 | `--r-lg` | `--r-lg` | `--r-md` |
| 内边距 | `--sp-4` | `--sp-4` | `--sp-3` |
| 阴影/描边 | `--shadow-card` + `--border-card` | 同左 | 无 |
| 外边距 | `margin-bottom: var(--sp-3)` | 同左 | 同左 |

- 卡片标签行 `.card-label`：`--fs-caption`、500、`--c-text-3`，`margin-bottom: var(--sp-2)`。
- `.card-ai .card-label`：`--c-accent-text`，前缀「✨」。
- 可点击整卡：`hover-class="card-hover"` → `opacity: .85`；右上角或标题行尾「›」用 `--c-text-3`。

### 4.2 按钮

小程序 `<button>` 需先重置：`button{margin:0;padding:0;line-height:inherit;background:none;font-size:inherit;} button::after{border:none;}`。

| 类 | 高度 | 宽度 | 背景 | 文字 | 圆角 | 字号/字重 |
|---|---|---|---|---|---|---|
| `.btn-primary` | 96rpx | 100% | `--c-primary` | `--c-on-primary` | pill | `--fs-h3` / 500 |
| `.btn-secondary` | 88rpx | 100% 或自适应 | `--c-primary-soft` | `--c-primary` | pill | `--fs-body` / 500 |
| `.btn-secondary-sm` | 64rpx | 自适应，`padding: 0 28rpx` | `--c-primary-soft` | `--c-primary` | pill | `--fs-body-sm` / 500 |
| `.btn-text` | 64rpx（热区 88） | 自适应 | 透明 | `--c-primary` | — | `--fs-body-sm` / 500 |
| `.btn-danger` | 96rpx | 100% | `--c-danger` | `#FFFFFF` | pill | `--fs-h3` / 500 |

状态：按下 `hover-class="btn-hover"` → primary 背景换 `--c-primary-pressed`，其他 `opacity: .7`；禁用 `opacity: .4`（不改色）；加载中文字替换为「…」并禁用。

底部固定按钮容器 `.footer-bar`：`position: fixed; left:0; right:0; bottom:0; padding: 16rpx 32rpx calc(16rpx + env(safe-area-inset-bottom)); background: var(--c-bg);` tab 页中改为 `bottom: calc(100rpx + env(safe-area-inset-bottom))`，`padding-bottom: 16rpx`。

### 4.3 输入行 `.form-row`

- 高度 min 104rpx，`display:flex; align-items:center; justify-content:space-between; padding: 0 var(--sp-4)`（在卡片内时左右 padding 为 0）。
- 左：标题 `--fs-body` `--c-text-1`；可带说明 `?` 图标（36rpx 圆，`--c-surface-2` 底，`--c-text-2` 字）。
- 右：控件；文本输入 `text-align: right`，`--fs-body`，占位色 `--c-placeholder`（`placeholder-class="ph"`）；单位紧随，`--fs-body-sm` `--c-text-3`。
- 行间分隔：`border-bottom: 1rpx solid var(--c-border)`，最后一行无。
- 错误：行下方 `--fs-caption` `--c-danger` 文本，`padding-bottom: var(--sp-2)`。
- 独立输入框 `.input-box`（onboarding）：高 96rpx，`--c-surface-2` 底，`--r-md`，内边距 0 28rpx；聚焦时 `box-shadow: 0 0 0 4rpx var(--c-primary-soft)`。

### 4.4 Chip `components/chip-group`

属性：`options: [{value,label}]`、`value`（单选为值，多选为数组，三态为 `{key:1|2}` 对象）、`mode: 'single'|'multi'|'tri'`、`size: 'md'|'lg'`、`columns`（0=自动换行）。事件 `change`。

| 状态 | 背景 | 文字 | 边框 |
|---|---|---|---|
| 默认 | `--c-surface-2` | `--c-text-2` | 无 |
| 选中（single/multi）/ 三态"重" | `--c-primary` | `--c-on-primary` | 无 |
| 三态"轻" | `--c-primary-soft` | `--c-primary` | `2rpx solid var(--c-primary)` |

- md：高 72rpx，`padding 0 28rpx`，`--fs-body-sm`，pill，间距 `--sp-2`。
- lg（onboarding/推荐问题）：高 96rpx，`--r-md`，`--fs-body`，左对齐，可 2 列网格。
- 三态"重"：chip 右上角 28rpx 圆形角标「重」（`--fs-caption` 缩至 20rpx 例外，`--c-danger` 底白字）——这是唯一允许 <24rpx 的文字，因同时有颜色和位置信息。
- 切换时 `transform: scale(.96)` 100ms。

### 4.5 打卡格子 `components/cup-grid`

属性：`target`（目标格数）、`value`（可 0.5 步进）、`icon`（'💧' 或 '🥚'）、`max`（16）。事件 `change`。

- 格子 64×64rpx，`--r-sm`，间距 12rpx，自动换行（一行最多 8 个）。
- 空格：`--c-surface-2` 底，emoji `opacity: .25`。
- 已填：`--c-primary-soft` 底 + `2rpx solid var(--c-primary)`，emoji 不透明。
- 半格（0.5）：`background: linear-gradient(90deg, var(--c-primary-soft) 50%, var(--c-surface-2) 50%)`。
- 超出目标：value ≥ target 时末尾显示「+」格（虚线边框 `2rpx dashed var(--c-border)`），点击 +1。
- 达成目标瞬间：整组 `scale(1.04)` 回弹 200ms + `wx.vibrateShort({type:'light'})`。
- 右侧/下方计数：`.num` `--fs-body-sm`，「3/4 份」，达标时 `--c-success` 并加「✓」。

### 4.6 进度环 `components/ring`

属性：`value`(0–100 或 null)、`size`(rpx，默认 160)、`stroke`(rpx，默认 14)、`color`('primary'|'accent'|'success')、`label`(中心下方小字)。

- 实现：`<canvas type="2d">`，按 `size × dpr` 设置画布；rpx→px：`px = rpx * windowWidth / 750`。
- 轨道：整圆，`surface-2` 色；进度弧：从 -90° 顺时针，`lineCap: 'round'`，主色。
- 中心文字**不画在 canvas 里**，用绝对定位的 WXML 覆盖：数值 `--fs-h1`(size=160 时) `.num` 600 +「%」`--fs-caption`；下方 label `--fs-caption` `--c-text-3`。value 为 null 显示「--」。
- 动画：value 变化时 300ms ease-out 从旧值过渡（`requestAnimationFrame` via `canvas.requestAnimationFrame`）。
- 无障碍：外层 view `aria-role="img" aria-label="体感浓度 {value}%"`。

### 4.7 图表 `components/line-chart`

属性：`points: [{date, kg}]`、`avg: [{date, kg}]`、`markers: [{date, label}]`（竖虚线）、`goal`（kg|null）、`mode: 'full'|'mini'`、`height`（rpx）。

full 模式样式：
- 画布内边距：左 64rpx（Y 轴标签）、右 24、上 32、下 48（X 轴标签）。
- Y 轴：自动取 [min−1, max+1] 取整，3 条水平网格线（`border` 色，1px），左侧标签 `--fs-caption` 等值 px、`text-3` 色。
- X 轴：首、中、尾 3 个日期标签「10/5」。
- 原始点：半径 3px，`text-3` 色 60% 透明。
- 均线：`primary` 色，线宽 2.5px，`lineJoin: 'round'`，无平滑（直线连接）。
- 均线下方面积：`primary` 由 18% → 0% 透明的竖向渐变。
- 目标线：`success` 色 1px 虚线 `[6,6]`，右端标签「目标 80」。
- markers：`text-3` 1px 虚线竖线，顶部标签（`--fs-caption` 等值），标签背景 `surface` 圆角矩形防遮挡。
- tooltip：点击时找最近点，画 `text-1` 色 4px 实心圆 + 上方 WXML 浮层（`--shadow-float`，`--r-sm`，「10/5 · 88.4kg」）。
- mini 模式：无坐标轴、无点，仅均线（若点 <7 则画原始折线）+ 面积，线宽 2px。

### 4.8 AI 对话气泡

| | 用户气泡 `.bubble-user` | 小美气泡 `.bubble-ai` | 急症卡 `.bubble-safety` |
|---|---|---|---|
| 对齐 | 右 | 左（头像 48rpx 圆，`--c-accent-soft` 底，「✨」居中） | 左，全宽（减头像） |
| 背景 | `--c-primary` | `--c-surface` | `--c-danger-soft` |
| 文字 | `--c-on-primary`，`--fs-body-lg` | `--c-text-1`，`--fs-body-lg` | `--c-text-1`；首行「⚠️ …」600 |
| 圆角 | `32rpx 32rpx 8rpx 32rpx` | `32rpx 32rpx 32rpx 8rpx` | `--r-lg`，左侧 `8rpx solid var(--c-danger)` |
| 内边距 | `20rpx 28rpx` | `24rpx 28rpx` | `--sp-4` |
| 最大宽 | 78% | 82% | 100% |
| 阴影 | 无 | `--shadow-card` | 无 |

- 气泡间距：同一角色连续 `--sp-2`，换角色 `--sp-3`。
- actions 行：气泡下方 `--sp-2`，左对齐头像右侧，`btn-secondary-sm`，换行间距 `--sp-2`；急症卡内「拨打 120」为 `.btn-danger` 高 80rpx。
- 来源小字（「离线回答」等）：气泡下方 `--fs-caption` `--c-text-3`。
- 输入中：小美气泡内 3 个 12rpx 圆点，`--c-text-3`，依次 `opacity .3→1` 循环 900ms。
- 文本支持换行：`white-space: pre-wrap; word-break: break-all`；用 `<text user-select>` 允许选择。

### 4.9 洞察卡 `components/insight-card`

属性：`card`（InsightCard）。事件 `dismiss`、`ask`、`cta`。

- `.card` 基础 + 左侧色条：`border-left: 8rpx solid`，priority ≥ 80 用 `--c-warning`，其余 `--c-primary`（左侧圆角保留）。
- 结构：标题 `--fs-h3` 600 → 正文 `--fs-body` `--c-text-2`（`--sp-1` 上间距）→ 按钮行（`--sp-3` 上间距，`justify-content: space-between`）：左「知道了」`btn-text`（`--c-text-3` 色）；右侧依次 cta `btn-text` 与「问小美」`btn-secondary-sm`（前缀「✨」）。
- 进场：`opacity 0→1; translateY(16rpx→0)` 250ms；关闭：高度/透明度收起 200ms 后移除。

### 4.10 底部 Tab `custom-tab-bar`

**建议：MVP 使用 emoji + 自定义 tab bar**（无需准备图片资源、可在暗色模式下保持一致、可实现"小美"强调）；P1 替换为 2px 线性 SVG 图标（`<image src="/assets/icons/xx.svg">`）。

| tab | emoji | 文案 |
|---|---|---|
| 今天 | ☀️ | 今天 |
| 记录 | 📝 | 记录 |
| 小美 | ✨ | 小美 |
| 我的 | 🙂 | 我的 |

规格：
- 容器：高 `100rpx + env(safe-area-inset-bottom)`，`--c-surface` 底，顶部 `1rpx solid var(--c-border)`，4 等分。
- 普通项：emoji 40rpx（`font-size`）在上，文字 `--fs-caption` 在下，间距 4rpx；未选中 emoji `filter: grayscale(1); opacity: .55`，文字 `--c-text-3`；选中 emoji 原色不透明，文字 `--c-primary` 500。
- 「小美」项：emoji 置于 64rpx 圆内，未选中圆底 `--c-accent-soft`（emoji 不灰化，保持"有生命"），选中圆底 `--c-accent`；文字选中用 `--c-accent-text`。
- 每个 tab 页 `onShow` 调用 `this.getTabBar && this.getTabBar().setData({ selected: <index> })`。
- 切换：`wx.switchTab`，无动画。

### 4.11 其他小件

| 组件 | 规格 |
|---|---|
| 阶段 pill `.pill` | 高 52rpx，`padding 0 20rpx`，pill，`--c-primary-soft` 底，`--c-primary` 字，`--fs-caption` 500 |
| 分段控件 `.segmented` | 高 72rpx，`--c-surface-2` 底，`--r-md`，内 4rpx；选中项 `--c-surface` 底 + `--shadow-card`，`--fs-body-sm` 500 |
| 提示条 `.banner-warning` | `--c-warning-soft` 底，`--r-md`，`padding --sp-3`，左「🌿」，文字 `--c-warning-text` |
| 说明块 `.notice` | `--c-info-soft` 底，`--r-md`，`padding --sp-3`，文字 `--fs-body-sm` `--c-text-2`，左「ℹ️」 |
| 列表项 `.list-item` | 高 104rpx，左 emoji 36rpx + 文字 `--fs-body`；右灰字 `--fs-body-sm` `--c-text-3` + 「›」 |
| 空态 `.empty` | 居中，上下 `--sp-6`；emoji 80rpx → 文案 `--fs-body` `--c-text-2` → 按钮（可选） |
| 部位格子 `.site` | 高 112rpx，`--r-md`，`--c-surface-2` 底；名称 `--fs-body-sm` 500，下方上次日期 `--fs-caption` `--c-text-3`；推荐：`2rpx solid var(--c-primary)` + 右上「推荐」pill（20rpx 字例外同 chip 角标）；选中：`--c-primary` 底、`--c-on-primary` 字 |
| 安全常驻条 `.safety-strip` | 高 64rpx，`--c-surface-2` 底，`--fs-caption` `--c-text-2`，居中单行省略 |
| 体重区间条 | 高 16rpx pill，`--c-surface-2` 轨道；区间段 `--c-primary-soft`；当前点 24rpx 圆 `--c-primary` + 白色 4rpx 描边 |

---

## 5. 关键页面逐屏布局

### 5.1 今天页（浅色，首屏 ≈ 1334rpx 高视口）

```
┌──────────────────────────────────────────┐ 导航栏「司美助手」（系统，bg=--c-bg）
│ [banner-warning 身体很不舒服？ 看看 › | 我好多了]  ← 仅难受模式
│                                                   │
│ 早上好，王姐                      [递增期·第5周]   │ ← --fs-h1 / pill 右对齐
│ 10月5日 周日                                       │ ← --fs-caption --c-text-3, 上距 8
│                                                   │ ← --sp-4
│ ╭─ card-ai ─────────────────────────────────────╮ │
│ │ ✨ 小美今日简报                    AI 生成    │ │ ← card-label / 右 caption text-3
│ │ 打针后第 2 天，胃口小是正常的，               │ │ ← --fs-h2 600 text-1，最多 2 行
│ │ 先把蛋白吃够。                                │ │
│ │ ─────────────────────────────── (--sp-3)      │ │
│ │ ○ 吃够 4 份蛋白（约 80g）            2/4 ›    │ │ ← 任务行 高 88，圈 36rpx 2rpx 描边 primary
│ │ ● ̶喝̶够̶ ̶1̶1̶ ̶杯̶水̶                    11/11   │ │ ← 达标：实心圈白✓，删除线 text-3
│ │ ○ 走 30 分钟                       20/30 ›    │ │
│ │                                  问问小美 ›   │ │ ← btn-text 右对齐
│ ╰───────────────────────────────────────────────╯ │
│ ╭─ card ────────────────────────────────────────╮ │
│ │ ┌────┐  替尔泊肽 5mg                          │ │ ← --fs-h3
│ │ │48% │  [高峰期] 恶心、饱胀最常出现在这几天…  │ │ ← 时相 pill(primary-soft) + body-sm text-2
│ │ │体感│  下次打针：周日（还有 5 天）          │ │ ← body-sm text-1
│ │ └────┘                                        │ │ ← ring 160rpx，左侧，右侧内容 flex:1 左距 --sp-4
│ │                              记录注射 ›      │ │
│ │ 曲线按说明书参数估算，只是示意…              │ │ ← caption text-3，上距 --sp-2
│ ╰───────────────────────────────────────────────╯ │
│ ╭─ insight-card (warning 色条) ─────────────────╮ │
│ │ 这两周掉得有点快                               │ │
│ │ 近两周平均每周 -1.7%。掉太快更容易…           │ │
│ │ 知道了            看看怎么防 ›  [✨ 问小美]   │ │
│ ╰───────────────────────────────────────────────╯ │
│ ╭─ card ───────────────────╮                      │
│ │ 体重            ╱╲_╱‾    │                      │ ← 左：caption 标签 / display 数字「88.4」+ body-sm「kg」
│ │ 88.4 kg        (mini)    │                      │    右：mini line-chart 宽 280 高 80
│ │ 比起始 -3.6kg（-3.9%）   │                      │
│ ╰──────────────────────────╯                      │
│ ╭─ card ────────────────────────────────────────╮ │
│ │ 递增期最该知道的                               │ │ ← card-label
│ │ "司美脸"怎么防                    2 分钟 ›     │ │ ← --fs-h3
│ ╰───────────────────────────────────────────────╯ │
│        小美是 AI 陪伴助手，不能代替医生。          │ ← caption text-3 居中，上下 --sp-4
└──────────────────────────────────────────────────┘
│  ☀️今天   📝记录   (✨)小美   🙂我的              │ custom-tab-bar
```

样式要点：
- 问候行与卡片之间 `--sp-4`；卡片之间 `--sp-3`。
- 简报卡是唯一使用 `--fs-h2` 正文的卡；任务行左圈与文字间距 `--sp-2`，右侧进度 `.num --fs-body-sm --c-text-3`。
- 药物卡 ring 与右侧内容垂直居中；打针日时「记录这一针」为 `btn-primary`（全宽，置于卡片底部，上距 `--sp-3`），替代「记录注射 ›」文字按钮。

### 5.2 记录页（打卡）

```
┌──────────────────────────────────────────────────┐ 导航栏「记录」
│        ‹    今天 10月5日    ›                      │ ← --fs-h3 居中，箭头 btn-text 88×88 热区
│ ╭─ card-ai ─────────────────────────────────────╮ │
│ │ ✨ 一句话告诉小美                              │ │
│ │ ┌───────────────────────────────────────────┐ │ │ ← textarea：surface-2 底 r-md，min 2 行
│ │ │比如：今天 88 公斤，有点恶心，吃了 3 份…   │ │ │
│ │ └───────────────────────────────────────────┘ │ │
│ │                                    [帮我填]    │ │ ← btn-secondary-sm 右对齐
│ │ ┄ 预览（出现时）┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄    │ │
│ │ 小美帮你理出了这些，对吗？                     │ │ ← body-sm text-2
│ │ [体重 88kg ×] [恶心·轻 ×] [蛋白 3 份 ×]       │ │ ← chip 轻态样式 + ×
│ │ [══════ 填进去 ══════]   不对，我自己填        │ │ ← btn-secondary(主色实底变体) + btn-text
│ ╰───────────────────────────────────────────────╯ │
│ ╭─ card（form-row 列表）────────────────────────╮ │
│ │ 体重                              88.4  kg    │ │
│ │ ───────────────────────────────────────────── │ │
│ │ 今天感觉        [😊 不错][😐 一般][😣 难受]   │ │ ← chip md，右对齐
│ │ ───────────────────────────────────────────── │ │
│ │ 不舒服的地方                                   │ │ ← 标题独占一行，chip 换行在下（左对齐）
│ │ [恶心][呕吐][腹泻][便秘ⓡ][反酸][胀气]…        │ │
│ │ 点一次是轻，再点一次是重                       │ │ ← caption text-3（首次）
│ │ ───────────────────────────────────────────── │ │
│ │ 蛋白 ?                               3/4 份   │ │
│ │ [🥚][🥚][🥚][ 🥚 ]                             │ │ ← cup-grid 在标题下一行
│ │ ───────────────────────────────────────────── │ │
│ │ 喝水                        6/11 杯 · 1杯=250ml│ │
│ │ [💧][💧][💧][💧][💧][💧][ ][ ]                 │ │
│ │ [ ][ ][ ]                                      │ │
│ │ ───────────────────────────────────────────── │ │
│ │ 有氧运动                                       │ │
│ │ [0][15][30][45][60][90] 分钟                   │ │
│ │ ───────────────────────────────────────────── │ │
│ │ 做了力量训练（深蹲、哑铃、弹力带都算）  (○ )  │ │ ← switch color=primary
│ │ ───────────────────────────────────────────── │ │
│ │ 食欲                      [小][正常][大]       │ │
│ ╰───────────────────────────────────────────────╯ │
│ ╭─ card ────────────────────────────────────────╮ │
│ │ 这个月           连续 7 天 · 本月 18 天   体重趋势 › │
│ │ 日 一 二 三 四 五 六                            │ │ ← caption text-3
│ │  •  •  ◦  •  •  •  •                           │ │ ← 日期 body-sm；完成=6rpx primary 实心点在日期下
│ │ 💉                                             │ │
│ ╰───────────────────────────────────────────────╯ │
│ ┌──────────── 完成打卡 ────────────┐              │ ← footer-bar（tab bar 之上）btn-primary
└──────────────────────────────────────────────────┘
```

样式要点：
- 单行控件（体重、感觉、食欲、力量）为左右结构；多选/格子行为上下结构（标题行 + 控件行，控件行上距 `--sp-2`，行下内边距 `--sp-3`）。
- 打卡反馈气泡出现在 footer-bar 上方：`.bubble-ai` 样式，左侧带「✨」头像，进场 250ms。
- 页面底部留白需 ≥ footer-bar 高度 + tab bar 高度（`calc(260rpx + env(safe-area-inset-bottom))`）。

### 5.3 小美页（AI 对话）

```
┌──────────────────────────────────────────────────┐ 导航栏「小美」
│ 小美是 AI 陪伴助手，不是医生。不提供诊断和剂量建议。· 离线模式 │ ← safety-strip 吸顶
│                                                   │
│                     10月5日                       │ ← caption text-3 居中
│                              ┌──────────────────┐ │
│                              │打完针恶心怎么办？│ │ ← bubble-user
│                              └──────────────────┘ │
│ (✨) ┌───────────────────────────────────┐        │
│      │恶心是最常见的反应，多出现在打针后 │        │ ← bubble-ai
│      │1–3 天和刚加量时……                 │        │
│      │· 少量多餐，吃到七分饱就停         │        │
│      │· 先吃蛋白，少油炸、少甜           │        │
│      └───────────────────────────────────┘        │
│      [记到今天打卡]                               │ ← actions btn-secondary-sm
│      离线回答                                     │ ← caption text-3（仅规则兜底）
│                                                   │
│ (✨) ╭─ bubble-safety ─────────────────────────╮  │
│      ┃ ⚠️ 持续剧烈腹痛可能是急症              │  │
│      ┃ 请停止进食，立即就医……                  │  │
│      ┃ [══════ 拨打 120 ══════]               │  │ ← btn-danger
│      ╰─────────────────────────────────────────╯  │
│                                                   │
│ [怎么预防司美脸？] [便秘怎么办？] [力量训练…] →  │ ← 横滑 chip md（键盘弹起时隐藏）
│ ┌─────────────────────────────────────┐  (➤)    │ ← 输入区 surface 底，上 1rpx border
│ │问小美任何问题…                      │         │    textarea surface-2 r-md；发送 72rpx 圆 primary
│ └─────────────────────────────────────┘         │
└──────────────────────────────────────────────────┘
│  ☀️今天   📝记录   (✨)小美   🙂我的              │
```

空态布局（无消息）：safety-strip 下方，内容垂直居中偏上（距顶 15vh）：「✨」96rpx 于 160rpx `--c-accent-soft` 圆内 → `--sp-3` →「我是小美」`--fs-h1` → `--sp-2` → 副文案 `--fs-body` `--c-text-2` 居中 → `--sp-5` → 4 个推荐问题 chip lg（全宽，左对齐，每个前缀「💬」）。

样式要点：
- 消息区 `scroll-view` 高度 = 视口 − safety-strip − 输入区 − tab bar；新消息后 `scroll-into-view` 到底部锚点。
- 输入区：`padding: 16rpx 32rpx`，背景 `--c-surface`，发送按钮禁用态 `opacity .4`；键盘高度 `h` 时输入区 `transform: translateY(-(h - tabBarHeight)px)`。
- 小美气泡中的条目符号「·」与数字列表不加额外缩进，保持朴素。

---

## 6. 动效与反馈汇总

| 场景 | 动效 | 时长 |
|---|---|---|
| 卡片/洞察卡进场 | opacity + translateY 16rpx | 250ms ease-out |
| 简报 LLM 替换 | 旧内容 opacity→0，新内容 →1 | 200ms |
| chip 点击 | scale .96 | 100ms |
| cup-grid 达标 | scale 1.04 回弹 + 轻振动 | 200ms |
| ring 数值变化 | 弧长过渡 | 300ms ease-out |
| 页面内行高亮（focusField） | 背景 `--c-primary-soft` → 透明 | 1000ms |
| 打字中 | 三点循环 | 900ms 循环 |

不使用：页面转场自定义动画、视差、粒子、彩带庆祝。

---

## 7. 文案视觉规范

- 数字与单位之间：中文语境「88.4 kg」「4 份」「30 分钟」加空格；百分比「-3.9%」不加空格。
- 负号统一使用 ASCII 连字符「-」。
- 体重保留 1 位小数；百分比 1 位小数；体感浓度为整数。
- 日期：近 7 天用「今天/昨天/周三」，其余「10月5日」；跨年「2025年12月3日」。
- emoji 每个卡片最多 1 个（标签前缀不计）；对话每条 ≤ 2 个。
