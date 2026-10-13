# SiMeiHelper — Tests + Tools Review Report

Reviewed by subagent against:
- 11 test files in `test/`
- 6 tools in `tools/`
- `.github/workflows/ci.yml`
- Reference docs: `docs/05-DATA.md`, `RUNBOOK.md`, `CHANGELOG.md`, `RELEASE.md`

Total observation: suite **passes (15/15 gates, ~4.7s)**. Findings below categorize real gaps from
nice-to-haves. Severity rationale:
- **P0 blocker** — a real test/automation bug that can let a regression slip into main
- **P1 major** — meaningful but fixable improvement (true uncovered path or weak assertion)
- **P2 minor** — polish / documentation / tool ergonomics

---

## Summary table

| Severity | Count | Examples |
|---|---|---|
| P0 | 5 | `recentHistory` 历史回填路径未测；LLM `parseCheckin` 路径仅 mock 200；demo-runner 不在 CI；CI 总闸门不依赖 demo-runner；kb.js 内容零内容测试 |
| P1 | 9 | `theme.js` 0 测试；`testConnection` 0 测试；`contextToText` 0 测试；`movingAvg` 半测；`isDoseDay` 仅间接；`daysToNextDose` 边界；`isLLM` 部分字段未测；`page-contract` 误报风险；J6 utils-only storage 反向引用检查不全 |
| P2 | 8 | wxml-check 处理属性内 `>` 较脆弱；page-contract 误报模式；demo-runner 不带 fixture；tools/run-all.js 头注描述与现实不符（"9 个测试" 实际 11）；tools/check.js 缺覆盖率上限告警；simulator.js `G3 feltPct < 20` 与 `G3 feltPct=0` 实际输出太宽；inputHash 跨调用相等断言太弱；regression.test.js B1 chip 测试假阳性 |

---

# P0 — Blockers

## P0-1 `recentHistory` 去重逻辑完全没测到
**文件**: `utils/ai.js:476-488`
**问题**: `recentHistory()` 第 3 步会删除最后一条 `role==='user'` 且 `content===userText` 的重复
（防止 chat.js 先 append 后又发给 LLM）。这是 chat.js 显式依赖的不变量（P1-3 注释）。
**没测到什么**:
- chat.js 调用顺序："appendChat(user) → ai.chat(text, ctx)"，保证 user 不重复发给 LLM
- `recentHistory(text)` 中传入的 text 与 smh_chat 末尾 user 重复时的 slice
- 跨多类型 message（type='card'）过滤
**修复建议**: 在 `test/llm.test.js` 新增 section "recentHistory 去重"：构造 smh_chat 含 `[user-A, assistant-B, user-text]`，让 mock 仅记录 LLM 收到的 messages，断言最后一条不是 `user-text`。

## P0-2 `ai.parseCheckin` LLM 路径只测了 200 成功 / 网络失败两条
**文件**: `test/llm.test.js:131-181`（仅 dailyBrief），`utils/ai.js:684-705`
**问题**: `ai.parseCheckin`（一句话打卡）从未在 LLM mock 模式下走过。它有 4 条独立路径：
1. isLLM=false → 规则版
2. LLM 返回合法 JSON → sanitize
3. LLM 含剂量 → guard 拦截 → 规则版
4. JSON 非法 / 字段类型错误 → sanitize 后无字段 → 规则版

**没测到什么**:
- LLM mock 200 但 JSON 不合法
- LLM mock 200 且 JSON 合法但 weightKg 越界（30–300 / ±10kg）
- LLM mock 200 且 weightKg 数字合法但 missing `feel`
- 体重与 ctx.latestWeightKg 差 > 10kg 应被丢弃（与 rule 版相同）
- LLM 输出含症状词 `nausea=3`（超出 1/2 枚举）应被丢弃
**风险**: 这是页面 `pages/log/log.js:322` 走的真实路径——若 sanitize 函数 bug 误接受非法 weightKg → 体检体重被打成 200kg。
**修复建议**: 在 `test/llm.test.js` 增加 T8 "parseCheckin LLM 路径" 5+ 例，每例覆盖上述场景。

## P0-3 `tools/demo-runner.js` 不在 run-all 闸门里，更不在 .github/workflows
**文件**: `tools/demo-runner.js`, `tools/run-all.js:107`（没有 demo-runner run 行）, `.github/workflows/ci.yml:37,115`
**问题**: demo-runner 跑 60 天用户旅程 + 5 项不变量（med history 序列、doses 有序、chat 为空等），
曾在 Round 24 调试中**捕获到 history 缺 start 事件的真实 bug**。但：
- `tools/run-all.js` 只跑 `simulator.js` 不跑 `demo-runner.js`
- `RELEASE.md:33-50` 列了 15 闸门 demo-runner 没列；`CHANGELOG.md` Round 24 提到 demo-runner 但没说加进 run-all
- CI `all-must-pass` 闸门只检 `test / static / sanity` 三个 job，demo-runner 不在任何 job 里
**风险**: 任何修改会破坏 med history 序列的改动都跑不过 demo-runner，但因为它不在 CI，下次 PR 直接合入。
**修复建议**:
1. `tools/run-all.js` 第 108 行后追加 `run('demo-runner.js', 'node', ['tools/demo-runner.js'])`，凑齐 16 闸门（更新 doc 与 RELEASE.md）
2. 或者在 `ci.yml` `test` job 加一个 demo-runner 步骤
3. 任意一种；当前的"已交付但未串接"是真正的 CI 漏检

## P0-4 `data/kb.js`（17 张知识卡）零内容测试
**文件**: `data/kb.js`, `tools/check.js:98-99`
**问题**: 唯一测试是 `try { require('../data/kb.js') } catch {}`（纯语法检查）。
**没测到什么**:
- 17 张卡都有必填字段（id/title/sections/stages 来自 `docs/05-DATA.md §8`）
- 卡 id 与 `utils/rules.js ACTIONS` 中的 `kb_*` payload（如 `kb_face` / `kb_eat`）一一对应
- 跨引用一致性：洞察卡 CTA `payload: '/pages/article/article?id=kb_xxx'` 必须能在 kb.js 找到

**风险**: 删除一张卡或打错 id → 点洞察卡 CTA 后 `pages/article/article.js` 走空态"内容走丢了"，用户看到是产品故障。
**修复建议**: 新增 `test/kb-contract.test.js`：
1. 校验所有卡包含 `{id, title, sections: [{h, body}]}`
2. 校验 `rules.ACTIONS.kb*` payload 中的 `id=` 都在 kb.js 中存在
3. 校验 `insight.js` RULES 中所有 cta 的 `payload` 都能在 kb.js 找到（或为 navigate/popup 类型）

## P0-5 `pages/onboarding` 6 步页面逻辑 0 测试
**文件**: `pages/onboarding/onboarding.js` (557 行)
**问题**: onboarding 是用户首屏，6 步状态机、性别/年龄/身高/体重校验、conditions 互斥、med status 迁移、addCalendar 是产品 P0 关键路径。`simulator.js` 和 integration 都只是 seed `onboardedAt=...`，从未跑过页面函数。
**没测到什么**:
- `validateStep3` 边界：身高 119/221、体重 29/301、goal ≥ 当前体重、birthYear 1920/今年-17
- `step5ReadyCalc` 4 种 medStatus 状态机
- `finish()` 写 profile / med / meta 的字段完整性（特别是 stopDate=startDate fallback、`stopWeightKg=profile.startWeightKg`）
- `addCalendar` 模态 confirm/cancel + 时间戳换算
- 中断恢复：草稿覆盖、`meta.onboardedAt && disclaimerAcceptedVersion !== VERSION → 跳 Step 2`

**风险**: `pages/onboarding/onboarding.js:317` goal ≥ 当前体重判定若被改坏 → 用户填 100kg→80kg，目标 80 < 当前 100，正确；但若改坏让 >= 通过 → UI bug。
**修复建议**: 新增 `test/onboarding.test.js`：require 不依赖 Page 的方式，把关键方法暴露成 `module.exports = { validateStep3, step5ReadyCalc, finish, prepareStep6 }`；或新建纯函数模块让 onboarding.js 复用。

---

# P1 — Major (real coverage gaps / weak assertions)

## P1-1 `utils/theme.js` 完全没测
**文件**: `utils/theme.js`, 缺测
**问题**: `colors(theme)` 是 canvas 组件（ring/line-chart）取色的关键函数；light/dark 必须和 `app.wxss` 的 CSS 变量一致。**没有任何断言测试 keys 集合、值的格式或 dark/light 区分**。
**没测到什么**:
- `colors('dark')` 返回所有 13 个 key
- `colors(undefined)` / `colors(null)` / `colors('')` → 回落 light
- 颜色字符串必须以 `#` 开头且 7 位 hex（避免 typo 导致 canvas 渲染透明）
**风险**: `app.wxss` 与 `theme.js` 一旦漂移（改色不同时改两边），开发工具白屏但测试通过。
**修复建议**: 新增 `test/theme.test.js`：5–8 例即可覆盖。

## P1-2 `ai.testConnection()` 没测
**文件**: `utils/ai.js:762-791`, 缺测
**问题**: settings 页 `node tools/check.js` 推断会调用它。`isLLM()` 全字段 true 已测（J4），但 testConnection 的 success/fail 路径、`max_tokens: 1` 的最小请求、`{ok: false, ms: 0, error}` 格式均未覆盖。
**修复建议**: 在 `test/llm.test.js` 加 T8。

## P1-3 `ai.contextToText()` 0 测试
**文件**: `utils/ai.js:339-429`
**问题**: 这是 LLM 的 system 提示词喂入内容，每个字段对应 AiContext 一个属性。**没有断言任何一行格式**——LLM 看不到的内容改了也测不出。
**没测到什么**:
- 6 行都出现且顺序固定
- 各种 conditions 翻译（8 种 condition CN 名）
- `dayN` 计算（hoursSinceDose=50 → "第 3 天"）
- `weeklyRatePct > 0` 显示为 `每周 -X%`，`<= 0` 显示"持平"
- today.feel CN 映射
**风险**: 改了 `CONDITION_CN` 但拼错 → LLM 误解用户健康情况（典型：错误告诉 LLM "胰腺炎史" → 强相关红旗错位）
**修复建议**: 在 `test/llm.test.js` 加 T9 "contextToText"，跑 5 种 ctx 验证 6 行稳定。

## P1-4 `plan.movingAvg` 测试不充分
**文件**: `test/plan.test.js:110-121`, `utils/plan.js:249-265`
**问题**: 仅 3 个点（10-01/10-03/10-08）→ 测了首点不变、10-03=均值、10-08=两日均值。
**没测到什么**:
- 边界：窗口为 1 时退化为自身
- 窗口大于数组长度
- 含 null kg 的点（被跳过）
- 空数组 → 返回空数组
**风险**: 实际 trend 页面使用；若 movingAvg 在空数组上崩 → 趋势页白屏。

## P1-5 `rules.isDoseDay` 缺直接测
**文件**: `utils/rules.js:470-480`, 缺测
**问题**: 仅通过 `dailyBrief` 间接测试（`test/rules.test.js:157`）。但 `isDoseDay` 有两个分支：
1. `daysToNextDose <= 0`（已测）
2. weekday === injectWeekday && !injectedToday（未测）—— 这是 inputHash 的关键路径
**风险**: inputHash 与 brief 都依赖该函数，某天手抖改坏优先级不会触发回归测试报警。
**修复建议**: 在 `test/rules.test.js` 增加 `rules.isDoseDay(ctx)` 5 例。

## P1-6 `isLLM()` 部分字段未测
**文件**: `utils/ai.js:169-172`, `test/integration.test.js:202`
**问题**: J4 只验证 4 个字段全设返回 true。但 `isLLM()` 是 AND 链：`provider==='openai_compat' && apiKey && baseUrl && model`。
**没测到什么**:
- 仅设 provider → false
- provider + apiKey 缺 baseUrl → false
- provider + baseUrl 缺 apiKey → false
- provider + apiKey + baseUrl 缺 model → false
- provider 设成未注册的字符串 → false（应回落 rules）
**风险**: 任何一个字段缺失导致 LLM 实际配置 OK 但 isLLM 返回 false → 用户付费的 API 永远走规则版。

## P1-7 `page-contract.js` 在 dynamic 方法名场景会误报
**文件**: `tools/page-contract.js:58-60`
**问题**: `\n\s*(?:async\s+|static\s+)*([a-zA-Z_$][\w$]*)\s*\(` 会匹配所有"看起来像函数调用"的方法名。`onLoad` / `onShow` / `onUnload` 等 Page 钩子会被算成"已声明"，但 **wxml 不可能调用 `bindload="onLoad"` 这种**（生命周期钩子不是 handler）。
反向问题：如果有 `bindtap="xxx"` 但 `xxx` 在 wxml 中是字符串拼接（如 `bindtap="handle${index}"`），**会被判定为未声明**——但代码实际能跑。
**风险**: 该工具是 CI 闸门，误报会让 PR 失败、漏报会让真 bug 进 main。
**修复建议**: 
- 增加生命周期黑名单跳过（`onLoad/onShow/onReady/onUnload/onPullDownRefresh/onReachBottom/onShareAppMessage/onPageScroll`）
- 或在文件头注释明确说明 dynamic handler 不检测（已知）

## P1-8 集成测试 J6 反向引用检查不完整
**文件**: `test/integration.test.js:231-276`
**问题**: J6 用正则 `/['"]smh_[a-zA-Z_]+['"]/g` 抓所有 smh_* key。但 `data/kb.js` 也引用 `pages/article/article` 的 `kb_face` 等——kb.js 是独立模块但被 page 间接 require。
**没测到什么**: `data/kb.js` 中的内容 id 跨模块对齐（建议并入 P0-4 的 kb-contract.test.js）。
**风险**: 中等；kb.js 是数据驱动的内容，更新时不期望破坏测试。
**修复建议**: 在新增 `test/kb-contract.test.js` 中合并此项。

## P1-9 `storage.appendChat` 容量截断 (200 → 100) 未测
**文件**: `utils/storage.js:233-240`
**问题**: 截断逻辑 `if (chat.messages.length > 200) chat.messages = chat.messages.slice(-200)` 完全没测。
**没测到什么**:
- 第 201 条消息时触发截断
- 截断后保留最新 200 条
**风险**: chat 跑一年后超容量 → wx.setStorageSync 抛错 → 整个 send 路径崩。
**修复建议**: 在 `test/storage-contract.test.js` 加 "C9: appendChat 200 上限截断" 2 例。

---

# P2 — Minor (polish / docs / assertions)

## P2-1 `tools/run-all.js:1-13` 注释说"9 道质量门"，实际跑 15 道
**文件**: `tools/run-all.js:5-7` (`9 个测试套件`) / `tools/run-all.js:79` (`→ 运行 11 个测试套件`) 内部矛盾
**问题**: 文件头注释"11 个测试套件 + 9 道质量门",下方 "→" 提示中给的是"11 个测试套件 + WXML + 页面引用"。配套看 RUNBOOK.md `§七、CI 接入建议` 是 "9 道闸门"，但 RELEASE.md `§5` 列 15 道。
**修复建议**: 统一为"15 道闸门（11 测试 + wxml-check + page-contract + check + simulator）"。

## P2-2 `regression.test.js:36-56` "B1 chip" 测试是恒真断言
**文件**: `test/regression.test.js:42-55`
**问题**: 该测试只测试了 JS 内置 `===` 在 `0.5 === '0.5mg'` 返回 undefined 的事实。即使生产代码完全没被改，这个测试也通过——它没有覆盖 `pages/dose/dose.js:62` `medDef.doseOptionsMg.map((mg) => ({value: mg, label: mg+'mg'}))` 的实际代码。
**修复建议**: 用 `vm` 加载 `pages/dose/dose.js` 调取 `medDef`，或 require dose.js 的 helper 函数验证实际数据格式。

## P2-3 `integration.test.js:130-133` `inputHash` 跨调用相等断言太弱
**文件**: `test/integration.test.js:130-133`
**问题**: `assert.equal(h1, h2, 'inputHash 跨调用稳定')` 只验证两次 buildContext 后 hash 相同。但若 `inputHash` 改成恒返回 `'constant'`，这条断言仍然通过。
**修复建议**: 加 2 例：
- ctx 的 `today.proteinServings` 改成不同值，h1 ≠ h2
- ctx 的 `pk.daysToNextDose` 改成不同值，h1 ≠ h2

## P2-4 `tools/simulator.js:436-437` `G3 feltPct < 20` 太宽
**文件**: `tools/simulator.js:436-437`
**问题**: 实际跑下来 `farFuture feltPct=0`（输出注释里直接说"应 < 20"）。0 < 20 是恒真断言。
**修复建议**: 改为"应 < 5"（100 天后 tirzepatide 半衰期 132h 代谢 12 个半衰期，应基本为 0）。

## P2-5 `tools/simulator.js:387-388` weeklyRatePct 是恒真
**文件**: `tools/simulator.js:387`
**问题**: `ctxF.weight.weeklyRatePct === null || typeof ctxF.weight.weeklyRatePct === 'number'` —— 任何值都满足。等于没断言。
**修复建议**: 改 `assert.ok(typeof ctxF.weight.weeklyRatePct === 'number' && ctxF.weight.weeklyRatePct >= 0)`。

## P2-6 `tools/wxml-check.js` 对 attribute 内 `>` 处理依赖引号配对
**文件**: `tools/wxml-check.js:55-70`
**问题**: 处理 `<view catchtap="a > b">` 时，进入 `inAttrQuote` 状态后会扫到 `>` 并跳过——但若 wxml 写错成 `<view catchtap="a > b"`，引号配对逻辑依赖 `inAttrQuote` 正确识别引号字符。"` > `" 紧邻属性值末尾时若引号丢失，行为可被欺骗（如双引号内含未转义双引号）。
**修复建议**: 增加"缺引号属性值"测试用例（验证是否报警）。

## P2-7 `tools/check.js:75-79` 跑 node `--check` 走子进程慢
**文件**: `tools/check.js:77`
**问题**: 30+ 个 JS 文件每个 fork 子进程耗时 3.2s（CI 报告耗时）。可以用 parse-only 模式批量检查。
**修复建议**: 用 `node --check` 仅对 utils / pages 跑，tools 砍掉。但当前 3.2s 可接受，不必立刻改。

## P2-8 `tools/demo-runner.js` 没有 fixture / 不在 CI
**文件**: `tools/demo-runner.js`（整文件）
**问题**: 即使在 run-all 里加进（P0-3 修复），它写死了 wx storage 模拟但 fixture 是硬编码（`Date.UTC(2026, 8, 5, 9)`）。任何 date 漂移都会让 narrative 错乱。
**修复建议**: 用 `process.env.SIMEI_EPOCH` 注入 fixture 时间，或把 narrative 与断言解耦。

---

# Tools 实用性总体评价

| 工具 | 用途 | 评价 | 备注 |
|---|---|---|---|
| `tools/check.js` | JSON/页面/组件/js/require 完整性 | ✅ 实用 | 是真静态检查，已捕获历史 bug |
| `tools/simulator.js` | 端到端 68 项断言 | ✅ 实用 | 但 P0-1/P0-3 指出的覆盖盲点存在 |
| `tools/wxml-check.js` | WXML 平衡 | ✅ 实用 | 但 P2-6 有边缘脆弱性 |
| `tools/page-contract.js` | bindtap→method 一致性 | ⚠️ 需改进 | P1-7 误报风险 |
| `tools/run-all.js` | 一键 15 闸门 | ✅ 实用 | 注释与实际不一致（P2-1） |
| `tools/demo-runner.js` | 60 天 narrative + 5 不变量 | ✅ 实用但**未串接** | **P0-3** 是 CI 漏检 |

---

# CI 闸门对照（15 闸门 vs .github/workflows/ci.yml）

| 闸门 | 在 run-all？ | 在 CI？ | 是否实际跑？ |
|---|---|---|---|
| 1 corpus.test.js | ✅ | ✅ (test job) | ✅ |
| 2 insight.test.js | ✅ | ✅ | ✅ |
| 3 integration.test.js | ✅ | ✅ | ✅ |
| 4 llm.test.js | ✅ | ✅ | ✅ |
| 5 pk.test.js | ✅ | ✅ | ✅ |
| 6 plan.test.js | ✅ | ✅ | ✅ |
| 7 rules.test.js | ✅ | ✅ | ✅ |
| 8 storage-contract.test.js | ✅ | ✅ | ✅ |
| 9 regression.test.js | ✅ | ✅ | ✅ |
| 10 sos.test.js | ✅ | ✅ | ✅ |
| 11 dose-flow.test.js | ✅ | ✅ | ✅ |
| 12 wxml-check.js | ✅ | ✅ (static job) | ✅ |
| 13 page-contract.js | ✅ | ✅ (static job) | ✅ |
| 14 check.js | ✅ | ✅ (static job) | ✅ |
| 15 simulator.js | ✅ | ✅ (sanity job 列了 files) | ✅ |
| 16 demo-runner.js | ❌ **不在 run-all** | ❌ **不在 CI** | **❌ 未跑** |

**注意**: `RELEASE.md §5` 列了 15 闸门 demo-runner 不在其中（其实是 15+1=16 闸门）。CHANGELOG Round 24 "调试中暴露 history 缺失 start 事件的真实 bug" 是 demo-runner 的高价值场景。**P0-3 必须修**。

---

# 关键建议优先级

修复顺序（按收益）：

1. **P0-3** 把 demo-runner 接入 run-all（10 行代码 + 一行 ci）
2. **P0-1** 加 `recentHistory` 去重测试（防 chat 重复发送）
3. **P0-4** 新增 `test/kb-contract.test.js`（5 分钟写完，挡一类产品故障）
4. **P0-2** 给 `ai.parseCheckin` LLM 路径加 5 例
5. **P1-1** + **P1-3** 新增 `test/theme.test.js` + 在 `test/llm.test.js` 加 contextToText 测试
6. **P1-5** + **P1-6** 给 `isDoseDay` 和 `isLLM` 加边界用例

修复 P0/P1 后断言数预计 +60 个（从 ~240 → ~300），CI 跑时 +200ms，仍可控。