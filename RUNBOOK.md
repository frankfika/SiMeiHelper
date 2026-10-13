# 司美助手 SiMeiHelper · 运行手册

> 给开发者 + 内测用户的运行手册。读完此文件即可上手编译、调试与发布。

## 一、源码编译与运行

### 1.1 微信开发者工具导入

1. 下载[微信开发者工具](https://developers.weixin.qq.com/miniprogram/dev/devtools/download.html)（最新稳定版）。
2. 「小程序」→「+」→「导入项目」：
   - **项目目录**：本仓库根目录 `SiMeiHelper/`
   - **AppID**：选「测试号」（touristappid 已在 project.config.json 预置，正式发布前替换）。
   - **项目名称**：`SiMeiHelper`
3. 基础库 ≥ 3.5.0（已在 `project.config.json` 设 `libVersion`）。
4. 编译 → 模拟器显示「司美助手」。

### 1.2 不带开发环境，仅 build 命令行检查

```bash
# 一键运行所有 17 道闸门（推荐用于本地提交前 + CI）
node tools/run-all.js

# 也可以单独运行
for t in test/*.js; do node "$t"; done

# 集成校验（JSON / 页面完整性 / 组件引用 / js 语法 / require 路径 / 纯函数可 require）
node tools/check.js

# 用户会话模拟（端到端 cross-module 状态机）
node tools/simulator.js

# 60 天用户旅程演示（人可读 narrative + 5 项不变量验证）
node tools/demo-runner.js --fast
```

预期输出：`9/9 通过 ✅ 全部通过`。`demo-runner` 输出人类可读的多日 narrative。

### 1.3 测试运行设备

- 微信开发者工具 → 右上角「真机调试」→ 扫码 → 在真机上完整走查 E2E-CHECKLIST.md。
- 真机调试基础库版本要保持与本地一致。

---

## 二、目录速览

```
SiMeiHelper/
├── app.js / app.json / app.wxss           应用入口 + 启动守卫 + 主题
├── custom-tab-bar/                        自定义底部导航
├── components/                            ring / line-chart / chip-group / cup-grid / insight-card
├── pages/                                 12 页面（onboarding / today / log / chat / me / dose / trend / plan / article / report / sos / settings）
├── utils/                                 date / storage / theme / plan / pk / rules / insight / ai
├── data/kb.js                             17 张知识卡
├── docs/                                  Claude Code 产出的规格（PRD / UX / 视觉 / 数据）
├── test/                                  8 个测试套件（pk / plan / rules / insight / corpus / integration / llm / storage-contract）
├── tools/check.js                         集成校验
├── tools/simulator.js                     用户会话模拟（端到端状态机）
├── tools/demo-runner.js                    60 天用户旅程演示（人可读 narrative + 不变量验证）
├── tools/wxml-check.js                    WXML 标签平衡校验（属性内 `>` / `{{ }}` 表达式 / 注释 都正确处理）
├── tools/page-contract.js                 页面 wxml/js 引用一致性（bindtap/bindinput/bindchange 等 handler 名匹配 js 方法）
├── tools/run-all.js                       一键运行所有 17 道闸门
├── AGENTS.md                              协作约定
├── README.md                              用户/开发者入口
├── E2E-CHECKLIST.md                       真机端到端走查清单
├── CHANGELOG.md                           关键变更日志
└── RUNBOOK.md（本文件）                   运行手册
```

---

## 三、5 个核心模块速查

### 3.1 utils/pk.js — 药代动力学（Bateman 模型）

```js
const pk = require('./utils/pk.js')
pk.MEDS.semaglutide          // {id, name, brands, halfLifeH, tmaxH, standardDoseMg, doseOptionsMg, minIntervalH, missedRule, labelSchedule, ...}
pk.feltPct(doses, tMs, medId, doseMg)  // 0-100 整数（体感浓度 %）
pk.phase(lastDoseMs, tMs)             // {key: 'rising'|'peak'|'steady'|'trough'|'overdue', label, hint}
pk.nextDoseMs(lastDose)                // 下一针时间戳
pk.curve(doses, fromMs, toMs, stepH, medId, currentDoseMg)  // [{t, v}]
```

参数来源：药品说明书公开信息（替尔 t½≈132h/Tmax≈30h；司美 t½≈168h/Tmax≈36h；度拉 t½≈108h/Tmax≈48h）。

### 3.2 utils/rules.js — AI 规则引擎（安全关键）

```js
const rules = require('./utils/rules.js')
rules.screenRedFlags(text)   // {level:'emergency'|'urgent'|'none', id, reply, actions, type:'safety'} — chat 必须先调用
rules.guardOutput(text)      // {ok:true|false, text} — LLM 输出过滤，false 时用安全模板替换
rules.matchIntent(text)      // intentId 18 类
rules.reply(text, ctx)       // 规则版回复（不依赖 LLM）
rules.dailyBrief(ctx)        // 今日简报规则版（同步可达）
rules.checkinFeedback(checkin, targets, ctx)  // 打卡反馈
rules.visitQuestions(ctx)    // 复诊问题
rules.parseCheckin(text, ctx) // 一句话打卡解析
```

**安全调用顺序（chat.js 已严格遵循）**：
```
1. screenRedFlags(text)           ← 必须在最前
2. (LLM is OFF → rules.reply)     ← 离线兜底
3. (intent ∈ {dose_change, buy_source} → rules.reply) ← 不进 LLM
4. LLM 调用
5. guardOutput(llmOutput)         ← 拦截剂量表述
```

### 3.3 utils/insight.js — 洞察卡引擎

```js
const insight = require('./utils/insight.js')
insight.refresh(now?)    // 唯一非纯函数；读 storage → evaluate → merge → 写回 → visible(2)
insight.evaluate(data, now)    // 纯函数：返回候选卡
insight.merge(state, newCards, now)
insight.visible(state, max=2)
insight.dismiss(state, key, now)
```

**触发时机**：`today.onShow` / `log` 完成打卡 / `dose` 保存注射后。

### 3.4 utils/ai.js — AI 门面

```js
const ai = require('./utils/ai.js')
ai.buildContext(now)              // → AiContext
ai.contextToText(ctx)             // 6-7 行紧凑中文摘要
ai.isLLM()                        // 是否配置了 LLM
ai.inputHash(ctx)                  // 简报 hash，用于判断是否需重算
ai.chat(userText, ctx)            // Promise<{content, actions, source, type, offline?}>
ai.dailyBrief(ctx)                // Promise<Brief>
ai.parseCheckin(text, ctx)        // Promise<Partial<Checkin>>
ai.checkinFeedback(checkin, targets, ctx)  // Promise<string>
ai.visitQuestions(ctx)            // Promise<string[]>
ai.testConnection()               // Promise<{ok, ms, error?}>
```

### 3.5 utils/plan.js — 阶段/目标/部位/速度

```js
plan.computeStage(med, checkins, now)     // {key, name, week}
plan.computeTargets(profile, weightKg, stageKey)
plan.weeklyRatePct(checkins, endKey, days?)   // 正数=下降%/周
plan.rateBand(rate)                       // 'flat'|'steady'|'fastish'|'fast'
plan.movingAvg(points, window?)
plan.nextSite(doses), plan.siteName(key), plan.siteLastUsed(doses)
plan.doseIntervalWarn(medId, lastMs, newMs)
plan.isBadDay(checkin), plan.streak(checkins, todayKey)
plan.PROTEIN_SERVING_EXAMPLES            // 1 份蛋白 ≈ 20g
```

---

## 四、关键数据契约

### 4.1 本地存储 schema（storage.js）

| key | 形态 |
|---|---|
| smh_meta | {schemaVersion, installedAt, disclaimerVersion?, onboardingStage, onboardedAt, lastOpenDate} |
| smh_profile | {nickname, sex, birthYear, heightCm, startWeightKg, goalWeightKg, startWeightDate, conditions[]} |
| smh_med | {status, medId, brand, startDate, currentDoseMg, doseSince, injectWeekday, doctor, nextVisitDate, stopDate, stopWeightKg, calendarAdded, history[]} |
| smh_doses | [{id, medId, doseMg, timeMs, site, note}] |
| smh_checkins | {[dateKey]: Checkin} |
| smh_chat | {messages:[{role, content, type, source, actions, id, ts}]} |
| smh_insights | {active:[InsightCard], lastFired, lastDismissed} |
| smh_brief | {date, inputHash, headline, tasks:[{key,text}], note, source, generatedAt, llmCountToday} |
| smh_kb_read | {[kbId]: ms} |
| smh_settings | {ai:{provider, baseUrl, model, apiKey, temperature}, reminders:{...}} |

### 4.2 服务层依赖（单向，禁止反向）

```
页面 → ai/insight → rules/plan/pk/date → （无）
storage 被 ai/insight 与页面使用
```

---

## 五、发布前 checklist（合规优先）

Claude Code 最终评审"离真实用户内测还差什么"清单 #3：**合规**。

### 5.1 必做

- [ ] **API Key 改走云函数代理**：当前在用户手机本地直连服务商（仅适合内测）。正式版需自有后端，小程序端不持有 key。
- [ ] **小程序后台配置 request 合法域名**：使用真实域名（生产 LLM）后，必须在 MP 后台加白。
- [ ] **隐私协议**：健康数据会上传给 LLM，需要单独的隐私保护指引（MP 后台 → 设置 → 隐私保护指引）。
- [ ] **用户授权同意**：在 onboarding 加入"使用 AI 服务"二级确认。
- [ ] **免责声明版本管理**：DISCLAIMER_VERSION 当前 `'2026-10-v1'`。升级时旧用户重走 onboarding 第 2 步。
- [ ] **医生文案审核**：让内分泌科医生过一遍 §6.1 红旗文案 / 简报模板 / 一句话打卡解析。

### 5.2 内测 → 上线顺序

1. 灰度 50 用户，跑 `E2E-CHECKLIST.md` 全 ✓。
2. 灰度期内持续收集 `smh_chat` 误拦截样本，扩 `corpus.test.js`。
3. 通过医生审核 → 申请类目（医疗 → 工具类 / 健康管理类）。
4. 上架前最后一次安全回归（11 测试套件 + corpus 252 断言）。

---

## 六、故障排查

| 现象 | 检查 |
|---|---|
| 启动页不跳转 onboarding | 检查 `smh_meta.disclaimerAcceptedVersion === storage.DISCLAIMER_VERSION` |
| 今天页药物卡显示 `undefined mg` | `med.currentDoseMg` 必须是 number，不是字符串；chip-group 剂量选项须 `{value:number, label:'Xmg'}` |
| 注入日判断没生效 | `buildContext` 输出 `injectedToday`；injectWeekday 必须是 number 0-6（0=周日） |
| 急症卡被 LLM 输出后不出现 | 红旗守卫必须在 LLM 之前（`ai.chat` 第 1 步）；不能跳过 |
| 洞察卡挂着不消失 | dose_overdue 等「条件型」卡在 `refresh` 中应被 `cleanupExpired` 移除 |
| LLM 输出含「加到1mg」 | guardOutput 必须调用；DOSE_PATTERNS 包含「加量到X ≤ Xmg」模式 |
| 体重 kg 显示 `undefined` | `plan.latestWeight` 在 checkins 为空时回落到 profile.startWeightKg |
| 滑动列表不滚动到底部 | scroll-view bind:scroll-into-view 触发的锚点 view 必须在文档末尾 |

### 6.1 npm test 偶发卡顿

极少数环境下（macOS + Homebrew Node 25 + npm 11），`npm test` 可能首次或偶发运行卡顿 5–16 分钟。

**根因推测**：npm 在零依赖项目里仍会尝试 `audit` + 元数据 resolve，触发与本地缓存的某些交互。

**解决方案**（任选其一）：
1. 直接调用：`node tools/run-all.js`（推荐，CI 即用此命令，不经 npm 包装）
2. 添加 npm flags：`npm test --silent --no-audit --no-fund`
3. `tools/run-all.js` 已内置 **60s 子进程超时 + SIGKILL** 兜底：即使个别测试死循环，也只会卡 60s 一次并以 `✗ (TIMEOUT)` 标记后继续

---

## 七、CI 接入建议

最小化 CI（GitHub Actions / Gitee Go）：

```yaml
name: check
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: node tools/run-all.js   # 一键跑 17 道闸门（不经 npm）
```

`tools/run-all.js` 失败即阻断 PR：
- 9 测试套件（800+ 断言）
- `tools/check.js`：JSON 合法性 / 12 页面完整性 / 5 组件引用 / js 语法 / require 路径
- `tools/simulator.js`：端到端 68 项用户会话断言（含 8 项危险场景 + 7 项 clearAll 重入路径）

---

## 八、扩展与定制

### 8.1 增加一种药

1. `utils/pk.js` MEDS 加一条记录（id/name/brands/halfLifeH/tmaxH/standardDoseMg/maxDoseMg/doseOptionsMg/minIntervalH/missedRule/labelSchedule）。
2. `data/kb.js` 复制一篇知识卡调整 id/title/sections/stages。
3. 真机走 `E2E-CHECKLIST §1 Step 5 + §5`。

### 8.2 接入私有 LLM 代理

1. 自建后端（Cloud Function / Express / Cloud Run），内部持 key，路由为 `POST /chat/completions`。
2. `utils/ai.js` 改 providers.openai_compat.complete 的 url 与 timeout（无需其它改动）。
3. MP 后台 → request 合法域名 → 加上你的后端域名（HTTPS）。
4. 设置页「Base URL」填入你的后端地址。

### 8.3 增加一种洞察卡

1. `utils/insight.js` RULES 加一条记录（ruleId/priority/cooldownDays/once?/cond/buildCard 模板）。
2. `test/insight.test.js` 加对应 1 例。
3. 真机观察 `today` 页洞察卡。

### 8.4 调整简报模板

简报规则版在 `utils/rules.js#dailyBrief`（按优先级 1–9 分支），调整后跑 `node test/rules.test.js §5`。
LLM 任务说明在 `utils/ai.js#dailyBrief`，调整后需重跑 `corpus.test.js` 验证剂量守卫未误拦。