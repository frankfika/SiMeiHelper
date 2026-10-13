# SiMeHelper Tests + Tools Review Report (Final)

Reviewed against:
- 11 test files in `test/`
- 6 tools in `tools/`
- `.github/workflows/ci.yml`
- Reference docs: `docs/05-DATA.md`, `RUNBOOK.md`, `CHANGELOG.md`, `RELEASE.md`

**Suite passes (15/15 gates, ~4.7s).** Below are real gaps from nice-to-haves. No files were edited; only diagnostic suggestions.

## Severity counts

- **P0 blocker**: 5
- **P1 major**: 9
- **P2 minor**: 8

---

## P0 — Blockers

### P0-1 `recentHistory` 去重逻辑完全没测
**File**: `utils/ai.js:476-488`
chat.js 调用顺序：`appendChat(user) → ai.chat(text, ctx)`。`recentHistory(text)` 必须删掉最后一条 `role==='user'` 且 `content===userText` 的重复（P1-3 注释）。chat.js 真实依赖此不变量但测试从未覆盖。
**Fix**: `test/llm.test.js` 加 section；mock 记录 LLM 收到的 messages，断言最后一条 user 不会重复发送。

### P0-2 `ai.parseCheckin` LLM 路径只测了 200 成功 / 网络失败两条
**File**: `test/llm.test.js:131-181`（仅 dailyBrief），`utils/ai.js:684-705`
`ai.parseCheckin` 4 条独立路径（isLLM=false / sanitize / guard / JSON 非法）只测 1 条。**没测 weightKg 越界（30-300 / ±10kg）、症状严重度超 1/2 枚举、JSON 字段类型错误**。这是 `pages/log/log.js:322` 真实路径，若 sanitize 函数 bug 误接受 → 体重被打成 200kg。
**Fix**: 加 T8 "parseCheckin LLM 路径" 5+ 例。

### P0-3 `tools/demo-runner.js` 不在 run-all 闸门里，更不在 CI
**File**: `tools/demo-runner.js`, `tools/run-all.js:107`, `.github/workflows/ci.yml`
demo-runner 跑 60 天用户旅程 + 5 项不变量（med history 序列、doses 有序等），**Round 24 调试中曾捕获 history 缺 start 事件的真实 bug**。但：
- `tools/run-all.js` 只跑 simulator 不跑 demo-runner
- CI `all-must-pass` 闸门只检 test/static/sanity 三个 job，demo-runner 不在任何一个
- RELEASE.md §5 列 15 闸门 demo-runner 不在其中；CHANGELOG Round 24 提到 demo-runner 但没说加进 run-all

**当前是"已交付但未串接"的真实 CI 漏检**。
**Fix**:
1. `tools/run-all.js:108` 后追加 `run('demo-runner.js', 'node', ['tools/demo-runner.js'])`，凑 16 闸门
2. 更新 RELEASE.md / RUNBOOK.md

### P0-4 `data/kb.js`（17 张知识卡）零内容测试
**File**: `data/kb.js`, `tools/check.js:98-99`
唯一测试是 `try { require('../data/kb.js') } catch {}`（纯语法检查）。
**没测**:
- 17 张卡都有必填字段 `{id, title, sections}`
- 卡 id 与 `utils/rules.js ACTIONS` 中的 `kb_*` payload 一一对应
- 跨引用一致性：洞察卡 CTA `payload: '/pages/article/article?id=kb_xxx'` 必须能在 kb.js 找到

**风险**: 删除一张卡或打错 id → 点洞察卡 CTA 后 `pages/article/article.js` 走空态"内容走丢了"，用户看到产品故障。
**Fix**: 新增 `test/kb-contract.test.js`，3 个 section 即可。

### P0-5 `pages/onboarding` 6 步页面逻辑 0 测试
**File**: `pages/onboarding/onboarding.js` (557 行)
onboarding 是用户首屏，6 步状态机、validateStep3 校验、conditions 互斥、med status 迁移、finish 写 profile/med/meta 字段完整性 — **产品 P0 关键路径，0 测试**。
**没测**:
- validateStep3 边界：身高 119/221、体重 29/301、goal ≥ 当前体重
- step5ReadyCalc 4 种 medStatus
- finish() 的 stopDate fallback、stopWeightKg=profile.startWeightKg
- 中断恢复：草稿覆盖、disclaimer version 跳 Step 2
**Fix**: 新增 `test/onboarding.test.js`；或拆出纯函数模块让 page 复用。

---

## P1 — Major

| # | 文件:行号 | 问题 | 修复 |
|---|---|---|---|
| P1-1 | `utils/theme.js` 0 测 | canvas 组件取色关键函数零断言；颜色 hex 格式无验证 | 新增 `test/theme.test.js`，5-8 例 |
| P1-2 | `utils/ai.js:762-791` testConnection 0 测 | settings 页会调，max_tokens:1、success/fail 路径未覆盖 | `test/llm.test.js` 加 T8 |
| P1-3 | `utils/ai.js:339-429` contextToText 0 测 | LLM 喂入内容，6 行格式/condition CN/weeklyRatePct 方向均未测 | `test/llm.test.js` 加 T9 |
| P1-4 | `test/plan.test.js:110-121` movingAvg 半测 | 边界窗口=1 / 大于数组 / 含 null kg / 空数组 未测 | 加 4 例 |
| P1-5 | `utils/rules.js:470-480` isDoseDay 缺直接测 | 仅通过 dailyBrief 间接测；weekday + !injectedToday 分支没断言 | `test/rules.test.js` 加 5 例 |
| P1-6 | `utils/ai.js:169-172` isLLM 部分字段未测 | J4 只测 4 字段全设；缺 1/2/3 字段 false 应回 false | 加 4 例 |
| P1-7 | `tools/page-contract.js:58-60` 误报风险 | 动态方法名（`handle${index}`）会被判错；生命周期钩子被当 handler | 加黑名单 / 注释明确 dynamic 不检测 |
| P1-8 | `test/integration.test.js:231-276` J6 反向引用不完整 | data/kb.js 引用未检查 | 并入 P0-4 kb-contract |
| P1-9 | `utils/storage.js:233-240` appendChat 容量截断未测 | 第 201 条截断至 200 关键逻辑零断言 | `test/storage-contract.test.js` 加 C9 |

---

## P2 — Minor

| # | 文件:行号 | 问题 |
|---|---|---|
| P2-1 | `tools/run-all.js:1-13` | 注释说"9 道质量门"，实际跑 15 道；与 RUNBOOK/RELEASE 描述不一致 |
| P2-2 | `test/regression.test.js:36-56` "B1 chip" 测试是恒真断言 | 只测 JS 内置 `===`，未覆盖 `pages/dose/dose.js:62` 真实代码 |
| P2-3 | `test/integration.test.js:130-133` inputHash 跨调用相等 | 恒真 — 改成 `return 'constant'` 也通过 |
| P2-4 | `tools/simulator.js:436-437` G3 feltPct < 20 | 实际输出 0；0<20 恒真 |
| P2-5 | `tools/simulator.js:387` weeklyRatePct 断言 | `=== null \|\| typeof === 'number'` 任何值都满足 |
| P2-6 | `tools/wxml-check.js:55-70` | attribute 内 `>` 依赖引号配对，缺引号场景未测 |
| P2-7 | `tools/check.js:77` | 30+ 个 JS 文件每个 fork 子进程，3.2s 慢但可接受 |
| P2-8 | `tools/demo-runner.js` | fixture 时间硬编码 `Date.UTC(2026, 8, 5, 9)`，date 漂移会让 narrative 错乱 |

---

## 工具实用性总评

| 工具 | 评价 | 备注 |
|---|---|---|
| `check.js` | ✅ 实用 | 静态检查，已捕获历史 bug |
| `simulator.js` | ✅ 实用 | 但 P0-1/P0-3 覆盖盲点 |
| `wxml-check.js` | ✅ 实用 | P2-6 边缘脆弱 |
| `page-contract.js` | ⚠️ 需改进 | P1-7 误报风险 |
| `run-all.js` | ✅ 实用 | P2-1 注释不一致 |
| `demo-runner.js` | ✅ 实用但**未串接** | **P0-3 是真 CI 漏检** |

---

## CI 闸门 vs 15 闸门声明

```
1-11 测试套件 → run-all ✅ CI test job ✅
12 wxml-check → run-all ✅ CI static job ✅
13 page-contract → run-all ✅ CI static job ✅
14 check.js → run-all ✅ CI static job ✅
15 simulator.js → run-all ✅ CI sanity job (列了 files) ✅
16 demo-runner.js → run-all ❌ CI ❌ **未跑**
```

RELEASE.md §5 / CHANGELOG Round 24 提到 demo-runner，但实际没接 CI。

---

## 推荐修复顺序

按收益：

1. **P0-3** demo-runner 接入 run-all（10 行代码）
2. **P0-1** recentHistory 去重测试（防 chat 重复发送）
3. **P0-4** test/kb-contract.test.js（5 分钟，挡一类产品故障）
4. **P0-2** parseCheckin LLM 路径 5 例
5. **P1-1** + **P1-3** theme.js + contextToText 测试
6. **P1-5** + **P1-6** isDoseDay + isLLM 边界用例

修复 P0/P1 后断言数预计 +60 个（~240 → ~300），CI 跑时 +200ms，仍可控。

---

完整报告也写入了 `test/review-report.md`，便于归档。

无需修改源文件 — 这是 review-only 任务。