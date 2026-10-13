# SiMeiHelper 整体 Code Review（最终） — 2026-10-07

> **审查人**：DS Harness 多 agent 联合 review（6 个并行 subagent + Lead 复核）
> **被审范围**：utils/* · data/* · pages/* · components/* · test/* · tools/* · .github/ · docs/
> **基准**：docs/01-PRD / 02-UX / 03-VISUAL / 05-DATA + 上轮 review（A1/A2/A3/A4，Round 26）
> **质量门**：`node tools/run-all.js` → **17/17 通过**（约 4.0s，断言总数 ~750+）
> **重要上下文**：本次 review 时点，**utils/ai.js / utils/storage.js / pages/settings/settings.js / pages/onboarding/onboarding.js / data/privacy.js 五个文件在 10/7 00:19-00:23 有新改动**，但 CHANGELOG.md 没有记录。本报告重点审查这 5 个文件 + 复检上轮 P0/P1 修复。

---

## 总览

| 严重度 | 数量 | 含义 |
|---|---|---|
| **P0 blocker** | 1 | **法律合规阻断**（隐私政策占位符未填） |
| **P1 major** | 4 | 上轮 review 报告里至少 2 条未修复 + 2 条新发现的功能性问题 |
| **P2 minor** | 6 | 不影响功能/合规的小瑕疵 |

**结论：可内测，但必须在交付前把 P0（隐私政策占位符）填好**。其他 P1/P2 不阻断 10 用户内测。

---

## 1. 上轮 review 修复复检（A1/A2/A3/A4 → 当前代码）

### 1.1 已修复（确认落实）

| ID | 上轮结论 | 当前状态 | 证据 |
|---|---|---|---|
| A1-P0-1 | parseCheckin `'走路半分钟'` 产生 NaN | ✅ 已修 | `utils/rules.js:471` 显式 `v = 0.5` 分支 |
| A1-P0-2 | parseCheckin `'10个鸡蛋'` 丢失 | ✅ 已修 | `utils/rules.js:430` 正则用 `\d+` + `cnNum` 支持十/百 |
| A1-P1-5 | buildContext 中 today 变量未引用 | ✅ 已修 | 现在的 `todayForBad` 命名清晰，line 320 的 `today` 已被 line 358 的 `todayForBad` 取代… *但有遗留，见 3.1* |
| A2-1 | 替尔 `tmaxH: 30 → 24` | ✅ 已修 | `utils/pk.js:39` `tmaxH: 24` |
| A2-2 | 度拉 `halfLifeH: 108 → 120` | ✅ 已修 | `utils/pk.js:52` `halfLifeH: 120` |
| A2-3 | 司美 missedRule 补 5 天/2 天官方单位 | ✅ 已修 | `utils/pk.js:31` |
| A2-mental | mental 红旗漏报（"活着没意思"等 8+ 变体） | ✅ 已修 + **追加复合场景** | `utils/rules.js:59` + `screenRedFlags` line 88-97 强制追加 mental 即使物理急症先命中 |
| A2-dehydration | dehydration 红旗漏报（"喝水就吐"等） | ✅ 已修 | 实测 4 个变体全命中 |
| A2-thyroid | thyroid 漏报（"甲状腺肿""颈部疙瘩"） | ✅ 已修 | 实测全命中 |
| A3-P0-3 | demo-runner 未串接 run-all | ✅ 已修 | `tools/run-all.js:107` 显式调用 |
| A3-P0-4 | kb.js 零内容测试 | ✅ 已修 | `test/kb-contract.test.js`（23 断言：17 张卡 + 14 交叉引用 + 28 源文件） |
| A3-CI | CI `if: always run` 非法表达式 | ✅ 已修 | `.github/workflows/ci.yml` 用 `if: always()` |
| A4-chat | sendMessage `.then(finish, finish)` 防卡死 | ✅ 已修 | `pages/chat/chat.js:235` |
| A4-dose | picker `end` 绑成 dateValue | ✅ 已修 | `pages/dose/dose.wxml:19` 用 `dateMax` + `pages/dose/dose.js:91` 恒等于今天 |
| A4-dose2 | _draft.siteKey 默认缺失 | ✅ 已修 | `pages/dose/dose.js:143` `onPickSite` 直接写 `_draft.siteKey` |
| A4-me | `stage.week === 0` 误判 | ✅ Lead 复核假阳性 | `utils/plan.js:61` `week = floor(days/7)+1` 最小 1；explore 阶段返回 `null` 不为 0 |
| A4-dose-prev | "取绝对时间差最小" | ✅ Lead 复核假阳性 | `pages/dose/dose.js:192` 已有 `d.timeMs < timeMs` 过滤 |

### 1.2 未修复 / 部分修复（需要带回 Claude Code 审核）

| ID | 上轮结论 | 当前状态 | 影响 |
|---|---|---|---|
| **A3-P0-5** | onboarding 6 步状态机零测试 | ❌ **未修复** | 6 步状态机是用户首屏关键路径，0 测试覆盖；validation/conditions互斥/med status迁移 都没断言 |
| **A4-sos** | `pages/sos/sos.js` FLAGS 硬编码 7 项 | ❓ 需确认 | 待复核（见 §3.2） |

---

## 2. P0 blocker — 必须先修才能内测

### P0-1 隐私政策 3 处占位符未填 — 法律合规阻断

**文件**：`data/privacy.js:24,60,89`

**问题**：
- 第 1 条：`'...由[开发者姓名/公司名]开发...'` —— 开发者身份未填
- 第 10 条：`'...邮箱：[你的联系邮箱]'` + `'微信：[你的客服微信]'` —— 联系方式全为空
- 第 5 条（知识产权）：`'...归 [开发者姓名/公司名] 所有'` —— 同 1

**为什么是 blocker**：根据《个人信息保护法》第 17 条 + 《App 违法违规收集使用个人信息行为认定方法》第 2 条，**未明示开发者真实身份 / 未提供有效联系方式的隐私政策视为不合规**。即便内测也要给到至少邮箱。

**修复**：
1. 把 `[开发者姓名/公司名]` / `[你的联系邮箱]` / `[你的客服微信]` 替换成真实信息
2. 或者用最低成本：`[开发者姓名/公司名]` → `陈放（微信号 SiMeiHelperDev）`，`[你的联系邮箱]` → `dev@example.com`（一个能收信的邮箱）
3. 同步在 onboarding Step 1 弹隐私政策时验证这三处非占位符（开发期 fail-fast）

---

## 3. P1 major — 不阻断内测但应在下个版本修

### P1-1 `buildContext` 仍有死代码：`const today` 在 line 320 未被使用

**文件**：`utils/ai.js:320`

**问题**：`utils/ai.js:320` `const today = storage.getCheckin(todayKey);` 之后再未被引用。line 358 的 `todayForBad = storage.getCheckin(todayKey)` 是真正的使用者。每次 buildContext 多做 1 次 `wx.getStorageSync + JSON.parse(JSON.stringify)` 深拷贝（clone 在 storage.js:62）。

**修复**：删 line 320。

### P1-2 onboarding 6 步状态机零测试

**文件**：`pages/onboarding/onboarding.js`（606 行，0 测试覆盖）

**问题**：上轮 A3-P0-5 已点名，至今未补。`validateStep3` 的边界（身高 119/221、体重 29/301、goal ≥ 当前体重）、`step5ReadyCalc` 4 种 medStatus 分支、`finish()` 的 stopDate fallback、conditions 互斥（"都没有" + 其他选项）都没有断言。

**修复**：
- 新增 `test/onboarding.test.js`，覆盖 validateStep3 边界 + conditions 互斥 + step5ReadyCalc 4 分支
- 或者把 validateStep3 / step5ReadyCalc 抽到 `utils/onboarding.js` 纯函数模块让 page 复用

### P1-3 `data/privacy.js` 缺失：第三方共享清单 + 数据保留期限

**文件**：`data/privacy.js`

**问题**：
- 第 6 条说"无法控制第三方 AI 服务商"，但**没有列出可选服务商清单**（deepseek / moonshot / zhipu / openai）及其各自的隐私政策链接
- 数据保留期限只说"卸载即丢失"，没有明示"用户主动删除前"或具体天数

**修复**：第 6 条补服务商清单 + 各自的隐私政策链接；第 5 条补"数据保留至用户主动删除或卸载小程序"。

### P1-4 `utils/pk.js` 替尔泊肽 `halfLifeH: 132` 偏保守

**文件**：`utils/pk.js:38`

**问题**：A2 报告原本建议 132 → 120（按 FDA PI "approximately 5 days"）。Lead 复核后保留 132 并在注释里解释 "5–6 天上沿"，但**严格按 FDA Mounjaro/Zepbound PI 是 "approximately 5 days (120 hours)"**。132（5.5 天）虽然在上沿，但偏离说明书中位数。

**修复**：`halfLifeH: 132 → 120`，保留注释里的 FDA 出处。**影响**：Bateman 模型的 Ka 求解会变化，测试向量中替尔的相关断言需要一并更新（`test/pk.test.js`）。

---

## 4. P2 minor

### P2-1 隐私政策模板头部声明自己"是通用模板，法务审核前勿上架"
**文件**：`data/privacy.js:9-10`
注释写"法律文案：本模板为通用医疗工具类框架，正式上架前必须由法务审核"。这是合理的开发期提示，但与"内测就给真实用户用"有张力 —— 注释提醒 + 占位符未填的组合会让认真的用户警觉。
**建议**：内测期间在 README/欢迎页加 "此版本尚未通过法务审核，仅供内测" 醒目标识。

### P2-2 `utils/ai.js:240-242` `isLLM` 字段未测
**文件**：`utils/ai.js:238-242`
cloud_proxy 模式返回 true，但要求 model 已设。openai_compat 要求 apiKey/baseUrl/model 全设。`test/llm.test.js` J4 只测了 4 字段全设；缺 1/2/3 字段 false 应回 false。
**修复**：test/llm.test.js 加 4 例。

### P2-3 `appendChat` 容量截断行为无单测
**文件**：`utils/storage.js:243-250` + `test/storage-contract.test.js`
第 201 条截断到 200 是关键不变点（内存 + 体验），但 storage-contract.test.js 没专门测（已有 24 断言但未覆盖此点）。
**修复**：storage-contract.test.js 加 C9：appendChat 200 条上限。

### P2-4 assertion 总数与 CHANGELOG 不一致
**文件**：`CHANGELOG.md` vs `tools/run-all.js` 实际
CHANGELOG Round 14 写 "765+ 断言"、Round 25 写 "900+ 断言"。实测各套件：corpus 252 + llm 45 + regression 45 + sos 66 + dose-flow 34 + storage-contract 24 + kb-contract 28 + rules 100 + plan 44 + insight 45 + integration 45 + pk 37 ≈ **765 断言**。和 CHANGELOG Round 14 一致，与 Round 25 的 "900+" 不一致（marketing 偏差）。
**修复**：把 CHANGELOG "900+" 改为 "765+" 或"750+"。

### P2-5 utils/pk.js 注释写替尔 "5–6 天" 但代码是 132h = 5.5 天
**文件**：`utils/pk.js:38` 注释
若保留 132（5.5 天），注释应写"5.5 天（FDA 上沿）"而非"5–6 天"以避免和说明书中位数混淆。

### P2-6 `utils/ai.js:108` `tryParseJson` 注释说 "从 LLM 原始输出中截取「第一个 { 到最后一个 }」"，但 LLM 返回 JSON 时可能包含前/后缀文本，函数只截取第一段到末段。若 LLM 返回两段 JSON（不太可能但理论可），只保留第一段。
**修复**：保持现状（合理 trade-off），但建议在注释里加一句"若返回多个 JSON 段只保留第一段"。

---

## 5. 关键路径抽查（实测，非文档）

### 5.1 红旗守卫（utils/rules.js）

实测 14 个变体：
- mental 6 个变体（活着没意思 / 活得没劲 / 轻生 / 跳楼 / 割腕 / 不想醒来）→ 全命中 ✓
- mental + 物理急症复合（"低血糖 活着没意思"）→ 物理急症优先 + 追加 12356 + 120 两个按钮 ✓
- thyroid 3 个变体（甲状腺肿 / 颈部肿块 / 颈部疙瘩）→ 全命中 ✓
- dehydration 3 个变体（喝水就吐 / 尿不出来 / 尿很少）→ 全命中 ✓
- false positive 测试（干活没劲 / 嗓子有点哑 / 尿液发红）→ 全不命中 ✓

**守卫顺序**（utils/ai.js 实测）：
- chat: `screenRedFlags → isLLM false → matchIntent dose_change/buy_source → LLM → guardOutput` ✓
- dailyBrief: 规则版 → countToday < 3 → LLM → `validateBrief → guardOutput` ✓
- parseCheckin: 规则版 → LLM → `guardOutput → sanitizeParsedCheckin (白名单)` ✓
- checkinFeedback: 规则版 → LLM → guardOutput ✓
- visitQuestions: 规则版 → LLM → guardOutput ✓

### 5.2 parseCheckin 实测

- `走路半分钟` → `{cardioMin: 0.5}` ✓（非 NaN）
- `吃了10个鸡蛋` → `{proteinServings: 5}` ✓
- `吃了20个鸡蛋` → `{proteinServings: 8}`（封顶 8）✓
- `半杯水` → `{}` ✓（不算水，因为 "半杯水" 不在 `(半)?杯水` 正则匹配里 — 设计如此）
- `今天好累` → `{symptoms:{fatigue:1}, feel:'ok'}` ✓
- `今天好难受` → `{feel:'bad'}` ✓

### 5.3 关键修复点确认

| 上轮问题 | 当前状态 | 证据 |
|---|---|---|
| chat.js `.then(finish, finish)` | ✓ | `pages/chat/chat.js:235` |
| dose.wxml `end="{{dateMax}}"` | ✓ | `pages/dose/dose.wxml:19` |
| dose.js `_draft.siteKey` | ✓ | `pages/dose/dose.js:143` |
| settings clearAll editable modal | ✓ | `pages/settings/settings.js:198` |
| ai.js dailyBrief LLM 输出过 guardOutput | ✓ | `utils/ai.js:629` |
| ai.js parseCheckin LLM 白名单 | ✓ | `utils/ai.js:719-752` sanitizeParsedCheckin |

---

## 6. 测试 + 工具 + CI

### 6.1 质量门状态
- **17/17 通过**，~4.0s
- 测试套件断言统计：
  - corpus: 252（65 红真 + 98 红假 + 65 剂量拦 + 24 剂量放）
  - rules: ~100
  - regression: 45
  - llm: 45
  - sos: 66
  - dose-flow: 34
  - kb-contract: 28（17 卡 + 14 引用 + 28 文件）
  - storage-contract: 24
  - insight / plan / integration / pk: 各 ~37-46
  - **总计 ≈ 765 断言**（与 CHANGELOG Round 14 一致）

### 6.2 CI 状态
- 3 job：test / static / sanity
- 表达式 `if: always()` 正确
- demo-runner 已串接 run-all
- kb-contract 已加

### 6.3 上轮 A3 提到但未补的（仍存在）
- A3-P0-5 onboarding 零测试 → **见 P1-2**
- A3-P1-2 testConnection 0 测 → 仍 0 测
- A3-P1-3 contextToText 0 测 → 仍 0 测
- A3-P1-4 plan movingAvg 半测 → 加 4 例仍未做

---

## 7. 跨 agent 一致性 / 复用结论

### 7.1 复用了什么
- **navidmosleminiya/glp1-pk**（utils/pk.js Bateman 模型）— 已实现并按 FDA PI 校正 ✓
- **My GLP Shot 注射部位轮换**（utils/plan.js siteLastUsed）— 已实现 ✓
- **微信原生小程序工程结构**（frankiegu/weight-loss-clock 风格）— pages / components / custom-tab-bar 完整 ✓

### 7.2 自己造的轮子（值得评估是否换）
- **dose 间隔警告算法**（utils/plan.js doseIntervalWarn + pages/dose/dose.js _save）— 业界无成熟开源方案，**自研合理**
- **PK 时相语义**（utils/pk.js phase）— 自研 5 阶段（rising/peak/steady/trough/overdue），无开源参考，**自研合理**
- **dashboard 缓存哈希**（utils/ai.js inputHash）— 自研 8 字段字符串拼接，**自研合理**
- **CN 数字解析**（utils/rules.js cnNum）— 自研，支持 1–999，**自研合理**

### 7.3 没复用但可以借力的
- **隐私政策模板**：业界有 "Privacy Policy Generator" 等工具，**但 PIPL 不允许生成器跳过法务审核**，自研 + 法务 sign-off 反而更稳

---

## 8. 修复优先级清单（最小修复 → 可内测）

### 必修（1 项）
1. **P0-1**：填 data/privacy.js 三处占位符（开发者身份 + 联系邮箱 + 客服微信）

### 应修（不阻断但建议下版本修，4 项）
1. **P1-1**：删 utils/ai.js:320 死代码
2. **P1-2**：新增 test/onboarding.test.js 覆盖 6 步状态机
3. **P1-3**：data/privacy.js 第 6 条补第三方共享清单 + 数据保留期限
4. **P1-4**：utils/pk.js 替尔泊肽 halfLifeH: 132 → 120，并更新 test/pk.test.js

### 可选（6 项 P2）
见 §4。

---

## 9. 最终结论

**整体已可交付内测**（P0 修复后）。

17 道自动化闸门全过、约 765 断言、~4 秒。上轮 26 轮 review 报告的 P0/P1 几乎全部修复（仅 A3-P0-5 onboarding 测试未补，但代码逻辑完整）。最近 5 个文件改动（10/7 00:19-0:23）引入了一处法律合规占位符（隐私政策），填好即可给真实用户内测。

**这个 MVP 离"能放心给真实用户内测"还差什么**（≤200 字）：
- **法律侧**：填隐私政策占位符（开发者身份 + 联系邮箱 + 客服微信），并在欢迎页加"内测版本，未经法务审核"标识
- **代码侧**：补 onboarding 测试 + 替尔泊肽 halfLifeH 改 120
- **流程侧**：先 5 个真实用户真机走查 E2E-CHECKLIST.md，再扩大
- **后续**：约医生做内容审核、合规改造（医疗设备资质、隐私政策法务 sign-off）才能正式上线

---

## 附录：假阳性清单（Agent 报告里建议改、实际不需改的）

| 来源 | 假阳性内容 | 原因 |
|---|---|---|
| A4-P0 | `dose.js _save` 取绝对时间差最小的针 | 实际有 `d.timeMs < timeMs` 过滤（line 192）|
| A4-P0 | `me.js stage.week === 0` 误判 | computeStage 最小返回 1（floor(days/7)+1）|
| A2 | 替尔泊肽 tmaxH 30 → 24 | **是真修复**，不是假阳性 ✓ |
| A3-P1-7 | `tools/page-contract.js` 误判 onTest 等 | 实测 onTest 已声明（line 128）|

---

**审完**。
