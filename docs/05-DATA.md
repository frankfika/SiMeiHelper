# 司美助手 SiMeiHelper — 数据与架构

| 项 | 值 |
|---|---|
| 版本 | v1.0（MVP） |
| 日期 | 2026-10-05 |
| 状态 | 已定稿，可实施 |
| 关联文档 | 01-PRD.md · 02-UX.md · 03-VISUAL.md |

> 本文档是工程实现的"真相源"：字段名、函数签名、公式、阈值、文案模板以本文为准。与其他文档冲突时，**数据/算法以本文为准，交互以 02-UX 为准，视觉以 03-VISUAL 为准**。

---

## 1. 工程约定

### 1.1 目录结构（固定，不得增减一级目录）

```
SiMeiHelper/
├── app.js / app.json / app.wxss / theme.json / sitemap.json / project.config.json
├── custom-tab-bar/            index.js/json/wxml/wxss  （自定义底部 tab，见 03-VISUAL §4.10）
├── components/
│   ├── ring/                  体感浓度环 / 进度环（canvas 2d）
│   ├── line-chart/            体重折线图（canvas 2d）
│   ├── chip-group/            单选/多选/三态 chip
│   ├── cup-grid/              打卡格子（水杯 / 蛋白份）
│   └── insight-card/          洞察卡
├── pages/
│   ├── onboarding/            首次启动 6 步
│   ├── today/      (tab)      今天
│   ├── log/        (tab)      记录（今日打卡 + 日历）
│   ├── chat/       (tab)      小美
│   ├── me/         (tab)      我的
│   ├── dose/                  记录注射
│   ├── trend/                 体重趋势
│   ├── plan/                  用药方案编辑
│   ├── article/               知识卡阅读（?id=）
│   ├── report/                就诊摘要
│   ├── sos/                   身体很不舒服
│   └── settings/              设置（AI / 提醒 / 数据）
├── utils/
│   ├── date.js      日期工具（本地时区）
│   ├── storage.js   本地存储 + 迁移
│   ├── pk.js        药代动力学（已存在，见 §4）
│   ├── plan.js      阶段判定、每日目标、体重统计、部位轮换
│   ├── insight.js   洞察卡规则引擎
│   ├── rules.js     AI 规则引擎（意图、模板、简报、解析器、守卫）
│   ├── ai.js        AI 门面 + provider（rules / openai_compat）
│   └── theme.js     给 canvas 用的颜色 token（JS 版）
├── data/
│   └── kb.js        知识卡内容（§8）
└── test/            node 可直接运行的断言测试：node test/xxx.test.js
```

### 1.2 硬性编码规则

1. **纯函数优先**：`pk.js / plan.js / insight.js / rules.js / date.js` 不得在模块顶层或函数内调用 `wx.*`，全部数据通过参数传入，以便 `node test/*.test.js` 直接运行。只有 `storage.js`、`ai.js`（网络部分）、页面可以调用 `wx.*`。
2. 模块导出统一用 `module.exports = { ... }`，引用用相对路径 `require('../../utils/plan.js')`。
3. 时间：存储一律用 **毫秒时间戳（number）**；"哪一天"一律用本地日期字符串 `'YYYY-MM-DD'`（`date.dateKey(ms)`）。不得存 Date 对象。
4. 体重单位存 kg（1 位小数），展示时 kg；一句话解析支持"斤"并换算（÷2）。
5. 基础库最低版本：`3.0.0`（`project.config.json` 的 `libVersion` 设为 `3.5.0`）。依赖：canvas `type="2d"`、`wx.addPhoneRepeatCalendar`（≥2.15）、`custom-tab-bar`、CSS 变量、`prefers-color-scheme`。
6. 不引入任何 npm 包。

### 1.3 app.json 关键配置

```json
{
  "pages": [
    "pages/today/today", "pages/log/log", "pages/chat/chat", "pages/me/me",
    "pages/onboarding/onboarding", "pages/dose/dose", "pages/trend/trend",
    "pages/plan/plan", "pages/article/article", "pages/report/report",
    "pages/sos/sos", "pages/settings/settings"
  ],
  "window": {
    "navigationBarTitleText": "司美助手",
    "navigationBarBackgroundColor": "@navBg",
    "navigationBarTextStyle": "@navText",
    "backgroundColor": "@pageBg",
    "backgroundTextStyle": "@bgText"
  },
  "tabBar": {
    "custom": true,
    "color": "@tabColor", "selectedColor": "@tabSelected", "backgroundColor": "@tabBg",
    "list": [
      { "pagePath": "pages/today/today", "text": "今天" },
      { "pagePath": "pages/log/log", "text": "记录" },
      { "pagePath": "pages/chat/chat", "text": "小美" },
      { "pagePath": "pages/me/me", "text": "我的" }
    ]
  },
  "darkmode": true,
  "themeLocation": "theme.json",
  "style": "v2",
  "sitemapLocation": "sitemap.json",
  "lazyCodeLoading": "requiredComponents"
}
```

`theme.json` 的取值见 03-VISUAL §3.7。

### 1.4 启动守卫（app.js）

```
onLaunch():
  storage.migrate()
  globalData = { pendingAsk: null, theme: wx.getSystemInfoSync().theme || 'light' }
  wx.onThemeChange(({theme}) => globalData.theme = theme)

每个 tab 页 onLoad 第一行:
  if (!app.ensureOnboarded()) return
app.ensureOnboarded():
  meta = storage.get('smh_meta')
  if (meta.disclaimerAcceptedVersion !== DISCLAIMER_VERSION || !meta.onboardedAt) {
    wx.reLaunch({ url: '/pages/onboarding/onboarding' }); return false
  }
  return true
```

`DISCLAIMER_VERSION = '2026-10-v1'`，定义在 `storage.js` 并导出。免责声明全文见 01-PRD §6。

---

## 2. 本地存储 Schema

所有 key 以 `smh_` 为前缀。总量预算：2 年重度使用 < 1.5MB（微信上限：单 key 1MB、总量 10MB）。

### 2.1 Key 一览

| Key | 类型 | 说明 | 预估大小 |
|---|---|---|---|
| `smh_meta` | object | 版本、免责、onboarding 进度 | < 1KB |
| `smh_profile` | object | 身体数据 | < 1KB |
| `smh_med` | object | 当前用药方案 + 方案历史 | < 10KB |
| `smh_doses` | array | 注射记录 | 每条 ~150B，2 年 ~16KB |
| `smh_checkins` | object(map) | 每日打卡，key 为日期 | 每天 ~350B，2 年 ~260KB |
| `smh_chat` | object | 对话（最多 200 条） | < 200KB |
| `smh_insights` | object | 洞察卡状态与冷却 | < 10KB |
| `smh_brief` | object | 今日简报缓存（只存当天） | < 2KB |
| `smh_kb_read` | object | 已读知识卡 `{ [id]: ms }` | < 2KB |
| `smh_settings` | object | AI 配置、提醒状态 | < 2KB |
| `smh_onb_draft` | object | onboarding 未完成时的表单草稿，完成后删除 | < 1KB |
| `smh_tip_sym` | boolean | 症状三态提示是否已展示过 | — |

### 2.2 `smh_meta`

| 字段 | 类型 | 示例 | 说明 |
|---|---|---|---|
| `schemaVersion` | number | `1` | 迁移用，当前 = 1 |
| `installedAt` | number | `1791091200000` | 首次启动 |
| `disclaimerAcceptedVersion` | string\|null | `'2026-10-v1'` | |
| `disclaimerAcceptedAt` | number\|null | | |
| `onboardingStep` | number | `3` | 1–6，中断续接 |
| `onboardedAt` | number\|null | | 完成 onboarding 时间 |
| `lastOpenDate` | string | `'2026-10-05'` | 用于"新的一天"判断 |

### 2.3 `smh_profile`

```js
{
  nickname: '王姐',            // string, 可空，默认 ''，展示时空则用"你"
  sex: 'female',              // 'female' | 'male' | 'other'
  birthYear: 1988,            // number 1920..(今年-18)
  heightCm: 165,              // number 120..220
  startWeightKg: 92.0,        // number 30..300，onboarding 时的体重
  startWeightDate: '2026-10-05',
  goalWeightKg: 80.0,         // number | null
  activityLevel: 'sedentary', // 'sedentary' | 'light' | 'active'
  conditions: ['t2d'],        // string[]，取值见下
  createdAt: 1791091200000,
  updatedAt: 1791091200000
}
```

`conditions` 取值：`t2d`（2 型糖尿病）、`insulin_su`（在用胰岛素或磺脲类降糖药）、`gallbladder`（胆囊疾病史）、`pancreatitis`（胰腺炎史）、`mtc_men2`（本人或家族甲状腺髓样癌/MEN2）、`pregnancy`（怀孕/哺乳/备孕）、`kidney`（肾脏疾病）、`none`。`none` 与其他互斥。

### 2.4 `smh_med`

```js
{
  status: 'active',           // 'considering' 还在了解 | 'prescribed' 已开药未开始 | 'active' 在用
                              // | 'tapering' 减量中 | 'stopped' 已停药
  medId: 'tirzepatide',       // 'semaglutide' | 'tirzepatide' | 'dulaglutide' | null
  brand: '穆峰达',             // string，可空
  startDate: '2026-09-07',    // 首针日期 'YYYY-MM-DD' | null
  currentDoseMg: 5,           // number | null，必须是 MEDS[medId].doseOptionsMg 之一
  doseSince: '2026-10-05',    // 当前剂量开始日期
  injectWeekday: 0,           // 0=周日 … 6=周六 | null
  doctor: { name: '', hospital: '' },
  nextVisitDate: '2026-10-30',// string | null
  stopDate: null,             // tapering/stopped 时必填
  stopWeightKg: null,         // 进入 tapering/stopped 时自动取最近体重
  calendarAdded: { inject: false, visit: false, checkin: false },
  history: [                  // 按 date 升序，只追加
    { date: '2026-09-07', event: 'start', medId: 'tirzepatide', doseMg: 2.5, note: '' },
    { date: '2026-10-05', event: 'dose_change', medId: 'tirzepatide', doseMg: 5, note: '医生调整' }
  ],                          // event: 'start'|'dose_change'|'pause'|'resume'|'switch'|'taper'|'stop'
  updatedAt: 1791091200000
}
```

### 2.5 `smh_doses`（按 `timeMs` 升序数组）

```js
[
  {
    id: 'd_1791091200000',     // 'd_' + createdAt
    medId: 'tirzepatide',
    doseMg: 5,
    timeMs: 1791091200000,     // 注射时间（用户可改）
    site: 'abd_ll',            // 见 §5.4
    note: '',
    createdAt: 1791091200000
  }
]
```

### 2.6 `smh_checkins`（map，key = 'YYYY-MM-DD'）

```js
{
  '2026-10-05': {
    date: '2026-10-05',
    weightKg: 88.4,            // number | null
    feel: 'ok',                // 'good' | 'ok' | 'bad' | null
    symptoms: {                // 只存有值的项；1=轻，2=重
      nausea: 1, constipation: 2
    },
    proteinServings: 3,        // number 0..8 | null （1 份 ≈ 20g 蛋白，见 §5.2）
    waterCups: 6,              // number 0..16 | null （1 杯 = 250ml）
    cardioMin: 30,             // number 0..300 | null
    strength: false,           // boolean | null
    appetite: 'low',           // 'low' | 'normal' | 'high' | null
    nlText: '有点恶心，吃了三份蛋白，走了半小时', // 最近一次一句话原文
    note: '',
    updatedAt: 1791091200000,
    completedAt: 1791091260000 // 点"完成打卡"时间 | null
  }
}
```

`symptoms` 的 key 白名单：`nausea` 恶心、`vomiting` 呕吐、`diarrhea` 腹泻、`constipation` 便秘、`reflux` 反酸烧心、`bloating` 胀气、`fatigue` 乏力、`dizziness` 头晕、`injection_site` 注射处不适、`hair_loss` 掉头发。

### 2.7 `smh_chat`

```js
{
  messages: [
    {
      id: 'm_1791091200000_u',
      role: 'user',            // 'user' | 'assistant'
      type: 'text',            // 'text' | 'safety' （急症卡）
      content: '打完针恶心怎么办',
      actions: [],             // [{ label: '去记录注射', kind: 'navigate', payload: '/pages/dose/dose' }]
                               // kind: 'navigate' | 'switchTab' | 'apply_checkin' | 'call' | 'ask'
      source: null,            // assistant 才有：'rules' | 'llm' | 'guard'
      createdAt: 1791091200000
    }
  ]
}
```

超过 200 条时从头部截断。

### 2.8 `smh_insights`

```js
{
  active: [
    {
      key: 'fast_loss',               // ruleId 或 ruleId + ':' + 唯一后缀（如 'post_increase:2026-10-05'）
      ruleId: 'fast_loss',
      title: '这两周掉得有点快',
      body: '…',
      askPrompt: '减重太快会不会有司美脸？我该怎么调整？',
      cta: { label: '看看怎么防', kind: 'navigate', payload: '/pages/article/article?id=kb_face' }, // 可空
      priority: 80,
      createdAt: 1791091200000,
      dismissedAt: null
    }
  ],
  lastFired: { fast_loss: 1791091200000 },  // key -> ms，用于冷却
  lastDismissed: { fast_loss: 1791091200000 }
}
```

### 2.9 `smh_brief`

```js
{
  date: '2026-10-05',
  inputHash: 'start|peak|bad0|dose0|p3w6c30s0', // 见 §6.6
  headline: '打针后第 2 天，胃口小是正常的，先把蛋白吃够。',
  tasks: [
    { key: 'protein', text: '吃够 4 份蛋白（约 80g）' },
    { key: 'water',   text: '喝够 10 杯水' },
    { key: 'move',    text: '饭后散步 20 分钟' }
  ],
  note: '',
  source: 'rules',             // 'rules' | 'llm'
  generatedAt: 1791091200000,
  llmCountToday: 1             // 当天 LLM 生成次数，上限 3
}
```

`tasks[].key` 取值：`protein`、`water`、`move`、`strength`、`dose`、`rest`、`weigh`。

### 2.10 `smh_settings`

```js
{
  ai: {
    provider: 'rules',          // 'rules' | 'openai_compat'
    baseUrl: '',                // 例 'https://api.deepseek.com/v1'（不带 /chat/completions）
    model: '',                  // 例 'deepseek-chat'
    apiKey: '',                 // 仅本机存储；见 §6.7 安全说明
    temperature: 0.6
  },
  reminders: { askedCalendar: false },  // 是否已引导过加日历（只引导一次）
  updatedAt: 0
}
```

### 2.11 默认值与迁移

`storage.js` 内置 `DEFAULTS`，`get(key)` 在无值时返回 **深拷贝的默认值**：

```js
DEFAULTS = {
  smh_meta: { schemaVersion: 1, installedAt: 0, disclaimerAcceptedVersion: null, disclaimerAcceptedAt: null,
              onboardingStep: 1, onboardedAt: null, lastOpenDate: '' },
  smh_profile: null,
  smh_med: { status: 'considering', medId: null, brand: '', startDate: null, currentDoseMg: null, doseSince: null,
             injectWeekday: null, doctor: { name: '', hospital: '' }, nextVisitDate: null, stopDate: null,
             stopWeightKg: null, calendarAdded: { inject: false, visit: false, checkin: false }, history: [], updatedAt: 0 },
  smh_doses: [],
  smh_checkins: {},
  smh_chat: { messages: [] },
  smh_insights: { active: [], lastFired: {}, lastDismissed: {} },
  smh_brief: null,
  smh_kb_read: {},
  smh_settings: { ai: { provider: 'rules', baseUrl: '', model: '', apiKey: '', temperature: 0.6 },
                  reminders: { askedCalendar: false }, updatedAt: 0 }
}
```

迁移：

```
SCHEMA_VERSION = 1
MIGRATIONS = { /* 2: (all) => { ...; return all } */ }
migrate():
  meta = get('smh_meta')
  if meta.installedAt === 0: meta.installedAt = Date.now(); set('smh_meta', meta); return
  for v = meta.schemaVersion + 1 .. SCHEMA_VERSION:
    MIGRATIONS[v]()       // 每个迁移函数自行读写各 key
    meta.schemaVersion = v; set('smh_meta', meta)
```

---

## 3. 服务层函数签名

> 类型记法：`?` 可空；`Checkin`、`Dose` 等指 §2 中的结构。所有带 `now` 参数的函数，调用方传 `Date.now()`；测试传固定值。

### 3.1 `utils/date.js`

| 函数 | 入参 | 返回 | 说明 |
|---|---|---|---|
| `dateKey(ms)` | number | `'YYYY-MM-DD'` | 本地时区 |
| `parseKey(key)` | string | number | 当天 00:00 本地时间 ms |
| `addDays(key, n)` | string, number | string | |
| `daysBetween(aKey, bKey)` | string, string | number | b − a，整数天 |
| `weekdayCn(n)` | 0..6 | `'周日'`… | |
| `friendly(ms, now)` | number, number | string | "今天 21:30" / "昨天" / "10月3日" |

### 3.2 `utils/storage.js`（唯一允许读写 wx storage 的模块）

| 函数 | 入参 | 返回 | 说明 |
|---|---|---|---|
| `KEYS` | — | object | 所有 key 常量 |
| `DISCLAIMER_VERSION` | — | string | `'2026-10-v1'` |
| `get(key)` | string | any | 无值返回 DEFAULTS 深拷贝 |
| `set(key, value)` | string, any | boolean | try/catch；失败时若为容量错误，先截断 `smh_chat` 至 100 条重试一次；仍失败 `wx.showToast('存储空间不足')` 返回 false |
| `update(key, fn)` | string, (old)=>new | new | 读-改-写 |
| `migrate()` | — | void | §2.11 |
| `getCheckin(dateKey)` | string | Checkin | 无则返回空 Checkin（所有字段 null，symptoms `{}`）。**注：返回深拷贝，避免污染 storage** |
| `upsertCheckin(dateKey, patch)` | string, Partial\<Checkin\> | `[dateKey]: Checkin` map（**实际返回整张 smh_checkins map**，与文档签名不符；调用方应使用 `getCheckin` 重新读取当天） | 浅合并（`symptoms` 整体替换），写 `updatedAt` |
| `completeCheckin(dateKey)` | string | `[dateKey]: Checkin` map（同上） | 写 `completedAt` |
| `listCheckins(fromKey, toKey)` | string, string | Checkin[] | 闭区间，按日期升序，只返回存在的 |
| `addDose(dose)` | Omit\<Dose,'id'\|'createdAt'\> | Dose | 插入并按 timeMs 排序 |
| `deleteDose(id)` | string | void | |
| `saveMed(patch, historyEvent?)` | object, object? | Med | 合并；有 historyEvent 则追加到 history |
| `appendChat(msg)` | ChatMessage | void | 超 200 截断 |
| `clearChat()` | — | void | |
| `exportAll()` | — | string | 所有 smh_ key 的 JSON（apiKey 替换为 `'***'`） |
| `clearAll()` | — | void | 删除全部 smh_ key |

### 3.3 `utils/pk.js`（已存在，本次只做增补）

已有导出（保持不变）：`MEDS, solveKa, singleDosePeak, levelPct, peakTimeH, nextDoseMs`。

需增补：

| 函数/常量 | 入参 | 返回 | 说明 |
|---|---|---|---|
| `MEDS[id]` 增加字段 | — | — | `doseOptionsMg`, `minIntervalH`, `missedRule`, `labelSchedule`，值见 §4.5 |
| `steadyPeakPct(medId, doseMg)` | string, number | number | 稳态峰值（与 `levelPct` 同一标尺），§4.3 |
| `feltPct(doses, tMs, medId, currentDoseMg)` | Dose[], number, string, number | number\|null | 体感浓度 0–100（整数），§4.3 |
| `phase(lastDoseMs, tMs)` | number\|null, number | `{ key, label, hint, hoursSince }` \| null | §4.4 |
| `curve(doses, fromMs, toMs, stepH, medId, currentDoseMg)` | … | `{t:number, v:number}[]` | 给药物卡迷你曲线用（P0 可不画，保留函数） |

### 3.4 `utils/plan.js`

| 函数 | 入参 | 返回 | 说明 |
|---|---|---|---|
| `STAGES` | — | `{ explore:{name:'观望期'}, start:{name:'起始期'}, titrate:{name:'递增期'}, plateau:{name:'平台期'}, maintain:{name:'维持期'} }` | |
| `computeStage(med, checkins, now)` | Med, Checkin map, number | `{ key, name, week }` | §5.1；`week` = 用药第几周（未用药为 null） |
| `latestWeight(checkins, profile)` | map, Profile | `{ kg, date }` | 无打卡体重时回落 `profile.startWeightKg` |
| `computeTargets(profile, weightKg, stageKey)` | Profile, number, string | Targets | §5.2 |
| `weeklyRatePct(checkins, endKey, days=14)` | map, string, number | number\|null | §5.3，正数 = 下降 |
| `movingAvg(points, window=7)` | `{date,kg}[]` | `{date,kg}[]` | 按日历日窗口 |
| `nextSite(doses)` | Dose[] | siteKey | §5.4 |
| `siteLastUsed(doses)` | Dose[] | `{ [siteKey]: ms\|null }` | |
| `doseIntervalWarn(medId, lastDoseMs, newDoseMs)` | … | `{ warn:boolean, hours:number, minH:number }` | §5.5 |
| `isBadDay(checkin)` | Checkin | boolean | 难受模式判定（PRD F11） |
| `streak(checkins, todayKey)` | map, string | number | 截至今天（含今天若已完成，否则从昨天起）连续 `completedAt` 天数 |
| `checkinProgress(checkin, targets)` | Checkin, Targets | `{ protein:bool, water:bool, move:bool, strengthToday:bool }` | 简报任务打勾 |

`Targets` 结构：

```js
{
  proteinG: 85, proteinServings: 4,
  waterMl: 2700, waterCups: 11,
  cardioMinDaily: 30, strengthPerWeek: 2,
  moveText: '每周 150 分钟中等强度 + 力量 2 次',
  refWeightKg: 68.1,
  basis: '蛋白按 1.2g × 参考体重 68kg 计算；水按 30ml × 当前体重计算。肾病/心衰等需限水限蛋白的情况，以医生为准。'
}
```

### 3.5 `utils/insight.js`

| 函数 | 入参 | 返回 | 说明 |
|---|---|---|---|
| `RULES` | — | Rule[] | §7.2 |
| `evaluate(data, now)` | `InsightData`, number | InsightCard[] | 纯函数：返回**本次应新出现**的卡（已过滤冷却） |
| `merge(state, newCards, now)` | InsightsState, InsightCard[], number | InsightsState | 合并进 `active`，更新 `lastFired`；同 key 已在 active 未关闭则不重复 |
| `visible(state, max=2)` | InsightsState | InsightCard[] | 未 dismiss，按 priority 降序取前 max |
| `dismiss(state, key, now)` | … | InsightsState | 写 `dismissedAt` 与 `lastDismissed` |
| `refresh()` | — | InsightCard[] | **唯一非纯函数**：读 storage → evaluate → merge → 写回 → 返回 visible |

`InsightData`：`{ profile, med, doses, checkins, insightsState, targets, stage, todayKey }`。

### 3.6 `utils/rules.js`（AI 降级引擎，全部纯函数）

| 函数 | 入参 | 返回 | 说明 |
|---|---|---|---|
| `screenRedFlags(text)` | string | `{ level:'emergency'\|'urgent'\|'none', id?, reply? }` | §6.1 |
| `guardOutput(text)` | string | `{ ok:boolean, text:string }` | §6.2，不 ok 时 text 为安全模板 |
| `matchIntent(text)` | string | intentId \| null | §6.3 |
| `reply(text, ctx)` | string, AiContext | `{ content, actions }` | 红旗 → 意图 → 兜底 |
| `dailyBrief(ctx)` | AiContext | Brief | §6.6 |
| `parseCheckin(text, ctx)` | string, AiContext | Partial\<Checkin\> | §6.4 |
| `checkinFeedback(checkin, targets, ctx)` | … | string | §6.8 |
| `visitQuestions(ctx)` | AiContext | string[] | §6.9 |
| `suggestedQuestions(ctx)` | AiContext | string[4] | 对话空态 chip，按阶段 §6.10 |
| `fill(tpl, vars)` | string, object | string | `{name}` 占位替换，缺失变量替换为空串 |

### 3.7 `utils/ai.js`（门面，页面只调用这里）

| 函数 | 入参 | 返回 | 说明 |
|---|---|---|---|
| `buildContext(now)` | number | AiContext | 读 storage，组装 §6.5 |
| `isLLM()` | — | boolean | `settings.ai.provider==='openai_compat' && apiKey && baseUrl && model` |
| `chat(userText, ctx)` | string, AiContext | `Promise<{content, actions, source, type}>` | §6.7 流程 |
| `dailyBrief(ctx)` | AiContext | `Promise<Brief>` | 规则版立即可得：调用方先用 `rules.dailyBrief` 渲染，再 await 本函数 |
| `parseCheckin(text, ctx)` | … | `Promise<Partial<Checkin>>` | LLM 失败回落规则 |
| `checkinFeedback(checkin, targets, ctx)` | … | `Promise<string>` | 同上 |
| `visitQuestions(ctx)` | … | `Promise<string[]>` | 同上 |
| `testConnection()` | — | `Promise<{ok, ms, error?}>` | 设置页"测试连接" |
| `providers` | — | `{ rules, openai_compat }` | 每个 provider 实现 `complete({ system, messages, json, timeoutMs }) → Promise<string>`；`rules.complete` 直接 reject（表示走规则分支） |

### 3.8 `utils/theme.js`

`colors(theme)` → 返回 canvas 用颜色对象（值与 03-VISUAL §3.1 的 CSS 变量一致）。`theme` 取 `app.globalData.theme`。

---

## 4. 药代动力学（PK）模块

### 4.1 模型

Bateman 单室一级吸收/一级消除模型，单剂（剂量 D，注射后 t 小时）：

```
C(t) = D · (e^(−ke·t) − e^(−ka·t))        （t > 0；省略常数系数 F·ka/(V(ka−ke))，因为只用相对值）
ke = ln2 / t½
ka：满足 Tmax = ln(ka/ke) / (ka − ke) 的解（ka > ke），用二分法求（pk.solveKa 已实现）
```

| 药物 | t½ (h) | Tmax (h) | ke (1/h) | ka (1/h) | 标准剂量 | 标准剂量稳态峰值 `SS_PEAK_STD`（levelPct 标尺） |
|---|---|---|---|---|---|---|
| semaglutide 司美格鲁肽 | 168 | 36 | 0.004126 | 0.089641 | 1.0 mg | 205.11 |
| tirzepatide 替尔泊肽 | 132 | 24 | 0.005251 | 0.142908 | 2.5 mg | 173.22 |
| dulaglutide 度拉糖肽 | 120 | 48 | 0.005776 | 0.051258 | 1.5 mg | 169.54 |

> 参数来源（FDA 处方信息，2026 复核）：
> - Zepbound/Mounjaro PI：tmax median **24h**（范围 8–72h）；超重/肥胖人群 t½ ≈ **5–6 天** → 取 132h。
> - Trulicity PI：tmax median **48h**（范围 24–72h）；t½ ≈ **5 天** → 120h。
> - Ozempic/Wegovy PI：t½ ≈ **1 周**（168h）；tmax **1–3 天** → 取 36h。

### 4.2 多剂叠加（已实现：`levelPct`）

```
levelPct(doses, t) = 100 × Σ_i  doseMg_i · g(t − t_i)  /  (standardDoseMg · g(Tmax))
g(Δ) = e^(−ke·Δ) − e^(−ka·Δ)，Δ ≤ 0 或 Δ > 7·t½ 时取 0
```

含义：100 = "标准剂量单针在峰值时刻的水平"。

> 已修复的缺陷（2026-10-05）：原实现 `refPeak = singleDosePeak / standardDoseMg` 写反了，导致标准剂量 ≠ 1mg 的药（替尔泊肽）数值放大 6.25 倍；以及 `timeMs === 0` 被当成无效值。已改正并在 `test/pk.test.js` 增加替尔泊肽用例。

### 4.3 体感浓度%（给用户看的数）

用户关心的是"相对于**我自己这个剂量**吃满（稳态）时，现在大概在几成"。因此：

```
steadyPeakPct(medId, doseMg) = (doseMg / standardDoseMg) × SS_PEAK_STD[medId]
  SS_PEAK_STD 由模拟得到：标准剂量每 168h 注射 1 次共 12 针，取第 12 个间隔内逐小时 levelPct 的最大值。
  实现：首次调用时模拟并缓存（不要硬编码，§4.1 表中数值用于测试比对）。

feltPct(doses, t, medId, currentDoseMg):
  ds = doses.filter(d => d.medId === medId)        // 换药后只算当前药
  if ds 为空 或 currentDoseMg 无效: return null
  v = levelPct(ds, t) / steadyPeakPct(medId, currentDoseMg) × 100
  return Math.round(clamp(v, 0, 100))
```

说明：起始期前几针没蓄积满，数值会偏低（例如第一针峰值约 50–57%），这是事实，文案上解释为"药效在慢慢建立"。

### 4.4 时相（phase）

按距上一针的小时数 `h`（与药物无关，便于文案统一）：

| key | 条件 | label | hint（药物卡副文案） |
|---|---|---|---|
| `rising` | 0 ≤ h < 24 | 吸收上升 | 药物正在吸收，接下来两天胃口可能会变小 |
| `peak` | 24 ≤ h < 72 | 高峰期 | 恶心、饱胀最常出现在这几天，少量多餐、蛋白优先 |
| `steady` | 72 ≤ h < 144 | 平稳期 | 身体状态通常最稳，适合安排运动 |
| `trough` | 144 ≤ h < 192 | 低谷期 | 快到打针日了，嘴馋一点是正常的，提前备好高蛋白零食 |
| `overdue` | h ≥ 192 | 已过打针日 | 超过计划时间了，记得看看漏打怎么处理 |

`lastDoseMs` 为空返回 null。

### 4.5 药物常量增补（写入 `pk.MEDS`）

```js
semaglutide: {
  doseOptionsMg: [0.25, 0.5, 1, 1.7, 2, 2.4],
  minIntervalH: 48,
  missedRule: '诺和泰说明书：漏打 5 天内尽快补打；超过 5 天就跳过这次。诺和盈说明书：距下次计划注射还有 2 天以上就尽快补打，否则跳过。',
  labelSchedule: '减重适应症说明书常见节奏：0.25mg 起始，每 4 周递增一档（0.25→0.5→1.0→1.7→2.4mg）。',
},
tirzepatide: {
  doseOptionsMg: [2.5, 5, 7.5, 10, 12.5, 15],
  minIntervalH: 72,
  missedRule: '说明书：漏打 4 天（96 小时）内尽快补打；超过就跳过这次，按原计划日继续。',
  labelSchedule: '说明书常见节奏：2.5mg 起始 4 周，之后每至少 4 周可递增 2.5mg。',
},
dulaglutide: {
  doseOptionsMg: [0.75, 1.5, 3, 4.5],
  minIntervalH: 72,
  missedRule: '说明书：距下次计划注射还有 3 天（72 小时）以上就尽快补打，否则跳过。',
  labelSchedule: '说明书常见节奏：0.75mg 或 1.5mg 起始，按医生评估调整。',
}
```

以上文字**只能**出现在知识卡与规则模板中，且同段必须跟随"具体剂量和节奏以你的医生为准"。所有场景通用补充一句："不要一次打两针来补。"

### 4.6 测试向量（`test/pk.test.js` 必须新增，允许误差 ±0.5）

时间基准 `T = Date.UTC(2026,0,5,12)`，`H = 3600000`，`D = 24*H`。

| # | 输入 | 期望 |
|---|---|---|
| 1 | `steadyPeakPct('semaglutide',1)` | 205.11 |
| 2 | `steadyPeakPct('tirzepatide',2.5)` | 173.22 |
| 3 | `steadyPeakPct('dulaglutide',1.5)` | 169.54 |
| 4 | 替尔泊肽 2.5mg 单针于 T；`feltPct(.., T+30H, 'tirzepatide', 2.5)` | 57 |
| 5 | 同上，T+72H | 47 |
| 6 | 同上，T+168H | 28 |
| 7 | 司美 0.25mg 于 T+0/7/14/21D，0.5mg 于 T+28D；`feltPct(.., T+684H, 'semaglutide', 0.5)` | 63 |
| 8 | 同上，T+744H | 65 |
| 9 | 同上，T+828H | 46 |
| 10 | 司美 1mg 于 T+0..77D 每 7 天共 12 针；T+77D+36H | 99 |
| 11 | 同上；T+77D+167H | 59 |
| 12 | `phase(T, T+50H).key` | `'peak'` |
| 13 | `phase(T, T+200H).key` | `'overdue'` |
| 14 | `feltPct([], T, 'semaglutide', 1)` | null |

### 4.7 PK 在产品中的用途（只有这三处）

1. **药物状态卡**：环 = `feltPct`；副文案 = `phase.hint`。
2. **今日简报**：`phase.key` 参与简报模板选择（§6.6）与 `inputHash`。
3. **洞察卡**：`trough_appetite`（低谷期 + 食欲大）、`dose_overdue`（overdue）。

不得用于：推荐注射时间、推荐剂量、任何"浓度不够要加量"类表述。

---

## 5. 业务算法（`plan.js`）

### 5.1 阶段判定 `computeStage(med, checkins, now)`

```
today = dateKey(now)
if med.status in ['considering','prescribed'] or !med.startDate: return explore (week=null)
if med.status in ['tapering','stopped']: return maintain (week = 用药周数)
week = floor(daysBetween(med.startDate, today) / 7) + 1
if week <= 4: return start
if week >= 12 and isPlateau(checkins, today): return plateau
return titrate

isPlateau(checkins, today):
  recent = 体重均值( today-6 .. today )
  past   = 体重均值( today-34 .. today-28 )
  两个窗口都至少 1 个体重记录，且 28 天内(today-27..today)总体重记录 ≥ 4，否则 false
  return |recent - past| / past < 0.01
```

### 5.2 每日目标 `computeTargets(profile, weightKg, stageKey)`

```
h = heightCm / 100
refWeightKg = min(weightKg, 25 × h²)                       // BMI 25 对应体重，避免按高体重算出过量蛋白
proteinG = clamp(round5(1.2 × refWeightKg), 60, 120)        // round5: 四舍五入到 5 的倍数
proteinServings = max(3, round(proteinG / 20))              // 1 份 ≈ 20g 优质蛋白
waterMl = clamp(round100(30 × weightKg), 1500, 3000)
waterCups = round(waterMl / 250)
```

| stage | cardioMinDaily | strengthPerWeek | moveText |
|---|---|---|---|
| explore | 20 | 0 | 每天快走 20 分钟，先动起来 |
| start | 20 | 1 | 每天轻快走 20–30 分钟；身体允许的话每周 1 次简单力量 |
| titrate | 30 | 2 | 每周 150 分钟中等强度 + 力量 2 次 |
| plateau | 40 | 3 | 每周 150–300 分钟 + 力量 2–3 次 |
| maintain | 40 | 3 | 每周 200–300 分钟 + 力量 2–3 次，这是不反弹的关键 |

`profile.conditions` 含 `kidney` 时：`basis` 追加"你有肾脏情况，蛋白和饮水量请先和医生确认"，数值照常但今天页蛋白任务文案改为"蛋白按医生建议吃"。

"1 份蛋白"对照（知识卡与打卡页提示复用，常量 `PROTEIN_SERVING_EXAMPLES`）：
- 一掌心大小、一指厚的瘦肉/鸡胸/鱼虾（约 100g 生重）
- 2 个鸡蛋
- 1 盒（200–250g）北豆腐 半盒 ≈ 1 份
- 300ml 牛奶 + 1 个鸡蛋
- 1 杯（约 200g）希腊酸奶
- 1 勺乳清蛋白粉

### 5.3 减重速度 `weeklyRatePct(checkins, endKey, days=14)`

```
取 endKey-days+1 .. endKey 内的体重点 (x=天序号, y=kg)，少于 3 个返回 null
最小二乘斜率 slope (kg/天)
rate = −slope × 7 / mean(y) × 100       // 正数=下降，单位 %/周
保留 1 位小数
```

展示分档（趋势页与洞察）：`rate ≤ 0`：灰"持平/回升"；`0 < rate ≤ 1.0`：绿"稳"；`1.0 < rate ≤ 1.5`：中性"偏快一点"；`rate > 1.5`：黄"有点快"。

### 5.4 注射部位轮换

```
SITES = [
  { key:'abd_ul', name:'腹部 左上' }, { key:'abd_ur', name:'腹部 右上' },
  { key:'abd_ll', name:'腹部 左下' }, { key:'abd_lr', name:'腹部 右下' },
  { key:'thigh_l', name:'左大腿' },  { key:'thigh_r', name:'右大腿' },
  { key:'arm_l', name:'左上臂' },    { key:'arm_r', name:'右上臂' }
]
nextSite(doses):
  last = siteLastUsed(doses)
  从未用过的部位中按 SITES 顺序取第一个；都用过则取 last 最小（最久未用）的那个
```

部位文案统一提示："离肚脐 5cm 以外；上臂通常需要别人帮忙打。"

### 5.5 注射间隔警告

`doseIntervalWarn(medId, lastDoseMs, newDoseMs)`：`hours = (newDoseMs − lastDoseMs)/H`，`warn = hours < MEDS[medId].minIntervalH`（司美 48h，替尔泊肽/度拉糖肽 72h）。

### 5.6 难受模式 `isBadDay(checkin)`

`checkin.feel === 'bad' || Object.values(checkin.symptoms).some(v => v === 2) || !!checkin.symptoms.vomiting`

---

## 6. AI 层

### 6.1 红旗守卫 `screenRedFlags(text)`（在任何 LLM 调用之前执行）

按顺序匹配，命中第一个即返回。（注意：本文所有表格内正则中的 `\|` 是 Markdown 转义，写代码时一律还原为 `|`。）`emergency` = 立即就医/120；`urgent` = 今天/尽快联系医生。

| id | level | 匹配正则（JS，`i`） | 回复要点 |
|---|---|---|---|
| `pancreatitis` | emergency | `(剧烈\|很疼\|疼得厉害\|绞痛\|受不了).{0,6}(肚子\|腹\|胃)\|(肚子\|腹\|胃).{0,6}(剧烈\|疼得厉害\|疼到后背\|痛到背)\|疼到后背\|痛到背` | 持续剧烈腹痛（尤其放射到后背）可能是急性胰腺炎等急症，请停止进食，立即就医 |
| `allergy` | emergency | `呼吸困难\|喘不上气\|喉咙(肿\|发紧)\|嘴唇肿\|脸肿\|全身(起疹\|风团)` | 可能是严重过敏，立即拨打 120 |
| `dehydration` | emergency | `(一直\|不停\|停不下来).{0,4}吐\|喝(水)?(都\|也)吐\|吐了.{0,4}(一天\|整天\|好几次)\|(没有\|几乎没\|很少)(小便\|尿)` | 持续呕吐、喝不进水或尿很少有脱水和肾损伤风险，请尽快去急诊 |
| `hypoglycemia` | emergency | `低血糖\|(心慌\|手抖).{0,6}(出汗\|冷汗)\|血糖.{0,4}(3\.\d\|2\.\d\|很低)` | 立即吃 15g 快速糖（3–4 块方糖/半杯果汁），15 分钟后复测；意识不清立即 120；之后联系医生 |
| `gallbladder` | urgent | `右上腹.{0,4}(疼\|痛)\|(皮肤\|眼睛\|眼白).{0,2}(发黄\|变黄)\|陶土(色)?便` | 可能与胆囊有关，请今天就去医院 |
| `thyroid` | urgent | `脖子.{0,4}(肿块\|包块\|鼓包)\|声音嘶哑.{0,6}(吞咽\|咽东西)` | 请尽快就诊并告诉医生你在用的药 |
| `vision` | urgent | `视力(突然\|下降)\|突然看不清\|眼前发黑` | 尤其有糖尿病时，请尽快去眼科/内分泌科 |
| `mental` | emergency | `不想活\|想死\|自杀\|自残\|活着没意思` | 你的感受很重要。请拨打全国心理援助热线 **12356** 或 **120**，或马上联系身边信任的人 |

回复模板统一结构（`type:'safety'`）：

```
⚠️ {一句话判断}
{1–2 句怎么做}
这种情况不适合等，也不适合在这里聊。如果症状很重，请直接拨打 120。
```

actions：emergency → `[{label:'拨打 120', kind:'call', payload:'120'}]`（mental 另加 `{label:'拨打 12356', kind:'call', payload:'12356'}`）；urgent → `[{label:'查看就医提醒', kind:'navigate', payload:'/pages/sos/sos'}]`。

`test/rules.test.js` 必须包含以下样例（期望 id）：
`"肚子疼得厉害还疼到后背"→pancreatitis`、`"喝水都吐"→dehydration`、`"心慌手抖出冷汗"→hypoglycemia`、`"眼睛发黄"→gallbladder`、`"嘴唇肿了喘不上气"→allergy`、`"有点恶心"→none`、`"今天便秘"→none`、`"最近不想活了"→mental`。

### 6.2 剂量守卫 `guardOutput(text)`（只作用于 LLM 输出）

任一命中即 `ok:false`：

```js
const DOSE_PATTERNS = [
  /(加|减|增|升|降|调)(量|剂量)?(到|至|成)\s*\d+(\.\d+)?\s*(mg|毫克)/i,
  /(建议|可以|应该|不妨|试试|最好)[^。\n]{0,12}(打|注射|用|换成)\s*\d+(\.\d+)?\s*(mg|毫克)/i,
  /(可以|建议|直接|自己)[^。\n]{0,6}(停药|停掉|停用|减量|加量)/,
  /(每周|一周)(打|注射)\s*(两|2|三|3)\s*(次|针)/,
  /(网上|代购|淘宝|海外)[^。\n]{0,8}(买|购)/
]
```

替换模板：

```
这个问题涉及剂量或用药调整，我不能替你做决定——这一步需要你的处方医生根据你的情况来判断。
我可以帮你把最近的体重、反应和打卡情况整理成就诊摘要，复诊时直接给医生看。
```

actions：`[{label:'生成就诊摘要', kind:'navigate', payload:'/pages/report/report'}]`，`source:'guard'`。

测试：`"你可以加到1mg试试"→false`、`"建议你打 2.5mg"→false`、`"你可以自己停药"→false`、`"多吃蛋白质，每份约 20g"→true`、`"说明书起始剂量通常是 0.25mg，具体以医生为准"→true`。

### 6.3 意图表（规则对话）

`matchIntent`：按表格顺序逐个测试正则，命中第一个。模板变量：`{name}` 昵称或"你"、`{proteinServings}`、`{proteinG}`、`{waterCups}`、`{waterMl}`、`{moveText}`、`{medName}`、`{doseMg}`、`{stageName}`、`{phaseLabel}`、`{missedRule}`、`{labelSchedule}`。

| intentId | 正则 | 回复模板 | actions |
|---|---|---|---|
| `dose_change` | `加量\|减量\|加到\|减到\|调量\|剂量.{0,4}(多少\|几)\|打几(毫克\|mg)\|多打\|少打` | 想调整剂量的心情我懂。不过加不加量、加多少，得由你的处方医生根据你的反应和效果来定，我不能替你决定。\n一般说明书上的节奏是：{labelSchedule}这只是参考，具体以医生为准。\n复诊前我可以帮你把最近的数据整理好👇 | 生成就诊摘要 |
| `stop_drug` | `停药\|不打了\|能停\|什么时候停\|停了会` | 停药是个大决定，一定要和医生一起商量，最好不要自己突然停。\n研究显示，很多人停药后一年内会回升相当一部分体重（司美格鲁肽的研究里大约回升了减掉部分的 2/3）。所以停不停、怎么停，医生会看你的体重、血糖和习惯是否稳定。\n你现在就能做的：把蛋白、力量训练和每周称重变成习惯——这些是停药后守住体重最靠谱的东西。 | 看「停药会反弹吗」(article kb_stop)；生成就诊摘要 |
| `buy_source` | `哪(里\|儿)买\|代购\|便宜.{0,4}(药\|针)\|没(有)?处方\|网上买\|复方\|仿制\|水光\|自配` | 这个我帮不了你，也不建议这么做：来源不明的药可能剂量不准、甚至不是真药。请通过医院处方、正规药房获取。可以挂内分泌科、减重门诊或营养科。 | — |
| `missed_dose` | `漏打\|忘(了\|记)打\|没打\|错过` | 别慌，漏一针很常见。\n{missedRule}\n不要一次打两针来补。不确定的话，打电话问问医生或药师最稳妥。 | 去记录注射 |
| `injection_how` | `怎么打\|注射方法\|打哪\|部位\|针头\|笔怎么用\|第一针` | 第一次打别紧张，大多数人说"比想象中轻"。\n1. 洗手，检查药液澄清、在有效期内；\n2. 选部位：腹部（离肚脐 5cm 外）、大腿前外侧或上臂，每次换个位置；\n3. 按你手上这支笔的说明书操作，注射后按住停留几秒再拔出；\n4. 用过的针头放进硬质容器。\n你下次推荐打：{nextSiteName}。 | 看「第一针怎么打」(kb_first_shot)；去记录注射 |
| `nausea` | `恶心\|想吐\|反胃\|没胃口\|吃不下\|饱胀\|吐了` | 恶心是最常见的反应，多出现在打针后 1–3 天和刚加量时，通常几周内会减轻。试试：\n· 少量多餐，吃到七分饱就停\n· 先吃蛋白，少油炸、少甜\n· 小口慢慢喝水，别一次猛灌\n· 吃完别马上躺下\n如果吐到喝水都留不住、或伴随剧烈腹痛，请马上就医。 | 记到今天打卡（apply_checkin `{symptoms:{nausea:1}}`） |
| `constipation` | `便秘\|拉不出\|大便干\|几天没(大便\|拉)` | 便秘很常见，因为吃得少、喝得少、肠子也变慢了。\n· 今天把水喝到 {waterCups} 杯（约 {waterMl}ml）\n· 每餐有一拳蔬菜，加点燕麦、奇亚籽\n· 饭后走 10–15 分钟\n超过 3–4 天没排便、或肚子很胀很痛，跟医生说一声。 | 记到今天打卡（`{symptoms:{constipation:1}}`） |
| `diarrhea` | `腹泻\|拉肚子\|拉稀` | 腹泻时最重要的是补水和电解质：少量多次喝水，可以喝口服补液盐。暂时少吃油腻、辛辣和乳制品。\n如果一天拉很多次、出现头晕、尿少，或持续 2 天以上，请就医。 | 记到今天打卡（`{symptoms:{diarrhea:1}}`） |
| `simei_face` | `司美脸\|脸(凹\|垮\|塌\|松\|老)\|显老\|面部` | "司美脸"不是药直接伤脸，而是减得快时面部脂肪也跟着变少、皮肤来不及回缩。能做的：\n1. 掉得稳一点：每周 0.5–1% 体重比较理想\n2. 蛋白吃够：你每天约 {proteinServings} 份（{proteinG}g）\n3. 每周 2–3 次力量训练，保住肌肉\n4. 喝够水、睡够、做好防晒\n我会帮你盯着减重速度，太快会提醒你。 | 看「司美脸怎么防」(kb_face) |
| `protein` | `蛋白\|吃什么\|怎么吃\|吃多少\|饮食\|食谱\|餐盘` | 你每天的蛋白目标约 {proteinG}g，差不多 {proteinServings} 份。1 份大概是：一掌心大小的肉/鱼，或 2 个鸡蛋，或 300ml 牛奶加 1 个蛋。\n每餐顺序：先吃蛋白 → 再吃蔬菜 → 最后吃一点主食。胃口小的时候，优先保证蛋白。 | 看「用药期间怎么吃」(kb_eat) |
| `water` | `喝水\|喝多少水\|水分` | 你每天的饮水目标约 {waterMl}ml，也就是 {waterCups} 杯。用药后口渴感会变弱，最好定时小口喝，别等渴了再喝。 | — |
| `exercise` | `运动\|锻炼\|健身\|力量\|跑步\|走路\|步数\|撸铁` | 要动，而且力量训练比你想的更重要——它帮你减脂不减肌肉，也让脸和身体不那么"垮"。\n你现在是{stageName}，建议：{moveText}。\n刚打完针那两天如果头晕没力气，就换成散步，别硬撑。 | 看「要不要运动」(kb_move) |
| `plateau` | `平台期\|不掉(秤\|了)\|体重不动\|不降了\|瓶颈` | 体重停一停很正常，身体在适应。先看三件事：蛋白够不够、力量练没练、睡得好不好。还有，别只看秤——腰围和衣服松紧也算数。\n至于要不要调整用药，请复诊时和医生聊，我可以帮你整理这几周的数据。 | 看「平台期」(kb_plateau)；生成就诊摘要 |
| `hair_loss` | `掉发\|脱发\|掉头发` | 减重期间掉头发多数和体重下降快、蛋白不足有关，通常是暂时的。先把蛋白吃够（{proteinG}g/天），别节食过猛。持续 3 个月以上或成片脱落，去看看皮肤科。 | — |
| `alcohol` | `喝酒\|酒精\|聚餐\|应酬\|啤酒` | 能少喝就少喝。酒精会让恶心、反酸更明显；如果你同时在用降糖药，还会增加低血糖风险。实在要喝：先吃点蛋白垫肚子，慢慢喝、配着水喝。 | — |
| `fatigue` | `乏力\|没力气\|累\|头晕\|犯困` | 吃得少了，累和头晕挺常见。检查一下：水喝够了吗？蛋白和主食是不是吃太少了？起身慢一点。\n如果头晕到站不稳、心慌出冷汗，尤其你在用降糖药，请立刻测血糖或就医。 | 记到今天打卡（`{symptoms:{fatigue:1}}`） |
| `pregnancy` | `怀孕\|备孕\|哺乳\|避孕\|喂奶` | 这个很重要：怀孕、备孕、哺乳期间一般不建议使用这类药，司美格鲁肽说明书建议计划怀孕前至少停药 2 个月。用替尔泊肽时口服避孕药效果可能下降，开始和每次加量后的 4 周建议加用其他避孕方式。请务必和医生确认。 | — |
| `what_is` | `是什么\|原理\|怎么起作用\|GLP\|多久(起效\|见效)` | {medName}属于 GLP-1 类药物（替尔泊肽还同时作用于 GIP），通过增加饱腹感、减慢胃排空、调节食欲来帮助减重。多数人头几周就能感到胃口变小，体重明显变化一般在 1–3 个月。它是"帮你更容易吃少"，不是"不用改习惯"。 | 看「这药是什么」(kb_what) |
| `fit` | `适合\|能不能用\|BMI\|挂什么科\|哪个科` | 国内减重适应症一般是：BMI ≥ 28，或 BMI ≥ 24 且合并高血压、高血糖、脂肪肝等体重相关问题。你的 BMI 约 {bmi}。适不适合要医生判断，可以挂内分泌科、减重门诊或营养科。 | 看「我适合用吗」(kb_fit) |
| `greeting` | `^(你好\|hi\|hello\|在吗\|嗨)` | 我在～今天感觉怎么样？想聊吃、动、副作用，还是想先打个卡？ | 去打卡 |

兜底（未命中）：

```
这个问题我还没把握答好🙏 你可以换个说法，或者看看下面这些我比较擅长的：
```
actions：`suggestedQuestions(ctx)` 的 4 个问题，`kind:'ask'`。

规则模式下每条回复末尾**不**追加通用免责（页面顶部已有常驻条），但 `dose_change / stop_drug / missed_dose / plateau / pregnancy / fit` 模板已内含"以医生为准"。

### 6.4 一句话打卡解析 `parseCheckin(text, ctx)`

规则（全部匹配，互不排斥）：

| 字段 | 规则 |
|---|---|
| weightKg | `/(\d{2,3}(?:\.\d)?)\s*(kg\|公斤\|千克)/i` → 值；`/(\d{2,3}(?:\.\d)?)\s*斤/` → 值/2；结果须在 30–300，且与 ctx.latestWeightKg 相差 ≤ 10kg，否则丢弃 |
| proteinServings | 数字或中文数字（一二两三四五六七八）+ `份蛋白`；另计数：`(\d\|[一二两三四])个(鸡)?蛋` 每 2 个 = 1 份（向下取 0.5 精度）；`(一\|1)杯(牛)?奶` = 0.5 份；`鸡胸\|牛肉\|鱼\|虾\|瘦肉\|豆腐` 每出现一次 = 1 份（仅在没有显式"N份蛋白"时累加）；结果取整到 0.5，上限 8 |
| waterCups | `(\d+\|中文数字)\s*杯水` → 值；`(\d{3,4})\s*(ml\|毫升)` → round(值/250)；`(\d(\.\d)?)\s*(升\|L)` → round(值×4) |
| cardioMin | `(走\|跑\|骑\|游\|跳\|爬\|散步\|快走\|有氧)[^，。,\.]{0,6}?(\d+\|半)\s*(个)?(分钟\|小时)`：半小时=30，N 小时=N×60；`(\d{4,5})\s*步` → round(步数/100)（≈1 分钟/100 步），上限 300 |
| strength | `力量\|撸铁\|深蹲\|哑铃\|器械\|弹力带\|俯卧撑\|健身房` → true |
| symptoms | `恶心\|想吐\|反胃`→nausea；`吐了\|呕吐`→vomiting；`拉肚子\|腹泻`→diarrhea；`便秘\|拉不出`→constipation；`反酸\|烧心`→reflux；`胀气\|胀`→bloating；`累\|乏力\|没力气`→fatigue；`头晕`→dizziness；`掉头发\|脱发`→hair_loss。前面有`很\|特别\|非常\|严重\|厉害`（同一子句内）→ 2，否则 1；`不恶心\|没(有)?恶心` 等否定形式不计 |
| feel | `舒服\|不错\|挺好\|很好`→good；`难受\|不舒服\|很差\|好难`→bad；有 symptoms 且无 bad 关键词→ok；否则不填 |
| appetite | `没胃口\|吃不下\|不饿`→low；`嘴馋\|很饿\|想吃\|饿得快`→high |

先跑 `screenRedFlags(text)`：若非 none，打卡页在预览上方显示红色安全提示（同 §6.1 文案），仍允许填入。

测试样例（`test/rules.test.js`）：

| 输入 | 期望（只列出应有字段） |
|---|---|
| `今天88.5公斤，有点恶心，吃了3份蛋白，喝了6杯水` | weightKg 88.5, symptoms {nausea:1}, proteinServings 3, waterCups 6, feel 'ok' |
| `177斤，走了半小时，没胃口` | weightKg 88.5, cardioMin 30, appetite 'low' |
| `便秘很严重，喝了1500ml水` | symptoms {constipation:2}, waterCups 6, feel 'ok' |
| `去健身房练了深蹲，今天状态不错` | strength true, feel 'good' |
| `早上两个鸡蛋，中午鸡胸，晚上一杯牛奶，走了8000步` | proteinServings 2.5, cardioMin 80 |
| `今天挺好的` | feel 'good'（其他字段不存在） |

（第 5 例：2 个蛋 = 1 份 + 鸡胸 1 份 + 1 杯奶 0.5 份 = 2.5。）

### 6.5 `AiContext` 结构（`ai.buildContext` 输出）

```js
{
  now: 1791091200000, todayKey: '2026-10-05', hour: 9,
  name: '王姐',
  profile: { sex: 'female', age: 38, heightCm: 165, bmi: 32.5, goalWeightKg: 80, conditions: ['t2d'] },
  stage: { key: 'titrate', name: '递增期', week: 5 },
  med: { status: 'active', medId: 'tirzepatide', medName: '替尔泊肽', doseMg: 5, doseSince: '2026-10-05',
         daysOnDose: 0, injectWeekday: 0, nextVisitDate: '2026-10-30',
         missedRule: '…', labelSchedule: '…' },
  pk: { feltPct: 48, phase: 'peak', phaseLabel: '高峰期', hoursSinceDose: 50, nextDoseKey: '2026-10-12', daysToNextDose: 7 },
  weight: { latestKg: 88.4, latestDate: '2026-10-05', startKg: 92, changeKg: -3.6, changePct: -3.9, weeklyRatePct: 0.9 },
  targets: { proteinG: 80, proteinServings: 4, waterMl: 2700, waterCups: 11, cardioMinDaily: 30, strengthPerWeek: 2, moveText: '…' },
  today: { /* 今日 Checkin */ },
  last7: { checkinDays: 5, proteinHitDays: 2, waterHitDays: 3, strengthCount: 1, avgCardioMin: 22,
           symptomDays: { nausea: 3, constipation: 2 }, badDays: 1 },
  badDay: false,
  nextSiteName: '腹部 右上',
  insights: ['fast_loss']        // 当前可见洞察 ruleId
}
```

发给 LLM 时序列化为紧凑中文摘要（`ai.contextToText(ctx)`），不发送原始打卡数组，示例：

```
【用户】王姐，女，38岁，165cm，BMI 32.5，目标 80kg；健康情况：2型糖尿病
【阶段】递增期 第5周；替尔泊肽 5mg（今天刚调整），每周日打针；下次复诊 10-30
【药物】距上一针 50 小时，高峰期，体感浓度约 48%
【体重】最新 88.4kg（起始 92kg，-3.9%），近两周每周 -0.9%
【目标】蛋白 4 份/80g，水 11 杯，运动：每周 150 分钟 + 力量 2 次
【近7天】打卡 5 天；蛋白达标 2 天；喝水达标 3 天；力量 1 次；恶心 3 天、便秘 2 天；难受 1 天
【今天】感觉一般；恶心(轻)；蛋白 1 份；水 3 杯
```

### 6.6 今日简报

**inputHash**（任一变化则重新生成）：`[stage.key, pk.phase||'none', badDay?1:0, isDoseDay?1:0, 'p'+protein, 'w'+water, 'c'+cardio, 's'+(strength?1:0)].join('|')`。注：只有"完成打卡"和"记录注射"后才主动重算；单纯切 tab 只在 hash 变化时重算。

**规则版 `rules.dailyBrief(ctx)`**——headline 按优先级取第一个命中的：

| 优先级 | 条件 | headline 模板 |
|---|---|---|
| 1 | `badDay` | 今天身体不太舒服，目标都先放一放，照顾好自己最要紧。 |
| 2 | stage = explore | {name}，先把这药了解清楚，再和医生一起决定，一点都不晚。 |
| 3 | stage = maintain | 维持期第 {weeksSinceStop} 周，守住就是赢。今天也称一下体重吧。 |
| 4 | 今天是打针日（`pk.daysToNextDose ≤ 0` 或 今天星期 = injectWeekday 且今天无注射记录） | 今天是打针日 💉 打完记得记一下，接下来两天胃口会小一些。 |
| 5 | `med.daysOnDose ≤ 7` 且有过 dose_change | 刚换到 {doseMg}mg，这周身体可能需要重新适应，慢慢来。 |
| 6 | phase = peak | 打针后第 {dayN} 天，胃口小是正常的，先把蛋白吃够。 |
| 7 | phase = trough | 快到打针日了，嘴馋一点很正常，提前备好鸡蛋、酸奶。 |
| 8 | stage = plateau | 体重歇一歇不代表没效果，今天把力量练上。 |
| 9 | 其他 | {stageName}第 {week} 周，按节奏来，你做得挺好。 |

tasks（固定 3 条）：
- badDay：`rest`"小口喝水，每 15 分钟喝几口"；`protein`"能吃就吃一点，清淡、少量多餐"；`rest`"出现剧烈腹痛或喝水都吐，马上就医"。
- 打针日：`dose`"打针并记录（推荐部位：{nextSiteName}）"；`protein`；`water`。
- explore：`protein`；`move`"每天快走 20 分钟"；`weigh`"每周固定一天称体重"。
- maintain：`weigh`"今天称一下体重"；`protein`；`strength` 或 `move`（本周力量次数 < strengthPerWeek 时取 strength）。
- 其他：`protein`"吃够 {proteinServings} 份蛋白（约 {proteinG}g）"；`water`"喝够 {waterCups} 杯水"；第三条：若本周（周一起算）力量次数 < strengthPerWeek 且 phase ≠ peak → `strength`"做一次 20 分钟力量训练"，否则 `move`"走 {cardioMinDaily} 分钟"。

`dayN = floor(hoursSinceDose/24)+1`。

**LLM 版**：system 用 §6.7 通用提示词 + 以下任务说明，user 为 `contextToText(ctx)`：

```
任务：为用户写今天的简报。只输出 JSON，不要任何其他文字：
{"headline":"不超过40个汉字，口语、有温度、具体到今天","tasks":[{"key":"protein|water|move|strength|dose|rest|weigh","text":"不超过24个汉字的具体行动"}],"note":"可选，不超过30字"}
要求：tasks 恰好 3 条；数字必须使用【目标】里的数值；不得出现任何药物剂量数字；身体难受时只给休息和补水类任务。
```

校验：能 `JSON.parse`（先截取第一个 `{` 到最后一个 `}`）；headline 1–40 字；tasks 长度 3 且 key 在白名单；整段文本过 `guardOutput`。任一失败 → 保持规则版。成功则写 `source:'llm'`。

### 6.7 对话流程 `ai.chat(userText, ctx)` 与系统提示词

```
1. rf = rules.screenRedFlags(userText)
   if rf.level !== 'none': return { content: rf.reply, actions: rf.actions, source:'rules', type:'safety' }
2. if !isLLM(): return { ...rules.reply(userText, ctx), source:'rules', type:'text' }
3. intent = rules.matchIntent(userText)
   if intent in ['dose_change','buy_source']: return 规则模板（这两类不交给 LLM）
4. messages = [system(SYSTEM_PROMPT + '\n' + contextToText(ctx)), 最近 10 条历史(仅 text 类型), user(userText)]
5. raw = await provider.complete({ messages, timeoutMs: 15000 })   // 失败/超时 → 规则回复，标记 offline:true
6. g = rules.guardOutput(raw); if !g.ok → { content: g.text, actions:[就诊摘要], source:'guard' }
7. actions = 若 intent 命中且规则表中该意图有 actions，则附上同样的 actions
8. return { content: raw.trim().slice(0, 600), actions, source:'llm', type:'text' }
```

`SYSTEM_PROMPT`（原文使用）：

```
你是「小美」，司美助手里的 AI 陪伴者，陪伴正在使用或考虑使用 GLP-1 类药物（司美格鲁肽、替尔泊肽等）减重的中国用户。
你的风格：像一个懂行又温暖的朋友。口语、简短、具体，不说教，不评判身材，不用"管住嘴""自律"这类词。每次回复不超过 200 字，必要时用 2–4 个短条目。
你必须遵守：
1. 你不是医生，不做诊断。症状只区分：常见反应（给缓解建议）/ 需要尽快就医 / 需要立即拨打 120。
2. 绝不给出剂量建议：不说"加到/减到/打多少 mg"，不建议自行加量、减量、停药、换药、补打两针。涉及这些，说明需要由处方医生决定，并提出可以帮用户整理就诊摘要。
3. 不推荐任何购药渠道、代购、复配或来源不明的药物。
4. 饮食和运动建议使用用户资料中【目标】的数值，用"份""杯""分钟"表达，不计算卡路里。
5. 如果用户提到怀孕、备孕、哺乳、胰腺炎史、甲状腺髓样癌家族史，提醒其务必与医生确认。
6. 不确定的事情直说不确定，并建议问医生或药师。
以下是该用户的资料（仅供你个性化回答，不要复述）：
```

`openai_compat` 请求：

```
wx.request({
  url: baseUrl.replace(/\/$/, '') + '/chat/completions',
  method: 'POST', timeout: 15000,
  header: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + apiKey },
  data: { model, messages, temperature, max_tokens: 600, stream: false }
})
→ res.statusCode === 200 ? res.data.choices[0].message.content : reject
```

**安全说明（必须写进设置页说明文字）**：MVP 的 apiKey 存在用户手机本地并从小程序直接请求，仅适合开发与内测；正式上线前必须改为自有后端/云函数代理（P1），小程序端不持有 key。正式版需在小程序后台配置 request 合法域名（HTTPS）。

### 6.8 打卡即时反馈 `rules.checkinFeedback(checkin, targets)`

按顺序取第一个命中：
1. `isBadDay` → "今天辛苦了，好好休息。明天会好一些的 🌱"
2. 蛋白、水、运动三项都达标 → "三项全达标！今天的你很稳 💪"
3. 蛋白差 1 份以内（`0 < 目标 − 实际 ≤ 1`）→ "蛋白 {p}/{P} 份，晚饭加个鸡蛋就齐了 👍"
4. 水 < 目标 × 0.6 → "水才 {w}/{W} 杯，睡前再喝两杯吧"
5. `strength === true` → "练了力量，肌肉在帮你守住线条 💪"
6. 其他 → "记下了！坚持记录本身就很了不起。"

达标定义：`protein: proteinServings ≥ targets.proteinServings`；`water: waterCups ≥ targets.waterCups`；`move: cardioMin ≥ targets.cardioMinDaily || strength === true`。

LLM 版：一句 ≤ 40 字，输入为 contextToText + "用户刚完成今天的打卡，用一句话给出温暖、具体的反馈"；过 `guardOutput`，失败回落规则。

### 6.9 复诊问题 `rules.visitQuestions(ctx)`

候选（满足条件即加入，取前 5；不足 3 条时补通用问题 a、b、c）：
- 近 4 周恶心/呕吐天数 ≥ 7 →"我这几周胃肠反应比较多（{n} 天），需要调整什么吗？"
- 当前剂量已用 ≥ 4 周 →"我现在的剂量用了 {w} 周，下一步是维持还是调整？"
- stage = plateau →"体重这几周变化不大，接下来怎么安排？"
- weeklyRatePct > 1.5 →"我掉得比较快（每周约 {r}%），需要注意肌肉流失吗？"
- conditions 含 t2d 或 insulin_su →"我的降糖药需要配合调整吗？"
- stage = maintain 或用药 ≥ 40 周 →"我什么时候可以考虑减量或停药？停药后怎么防反弹？"
- 通用 a："我需要定期查哪些指标（血糖、血脂、肝肾功能）？"
- 通用 b："哪些情况需要我马上停药就医？"
- 通用 c："我的饮食和运动安排有什么需要调整的？"

### 6.10 推荐问题 `rules.suggestedQuestions(ctx)`（对话空态 / 兜底 chip）

| stage | 4 个问题 |
|---|---|
| explore | 这药是怎么起作用的？/ 我适合用吗？/ 挂什么科？/ 会有什么副作用？ |
| start | 第一针怎么打？/ 打完恶心怎么办？/ 每天该吃多少蛋白？/ 要不要运动？ |
| titrate | 怎么预防司美脸？/ 加量后又恶心了怎么办？/ 力量训练怎么开始？/ 便秘怎么办？ |
| plateau | 平台期怎么办？/ 体重不动还要坚持吗？/ 怎么预防司美脸？/ 我该练多少力量？ |
| maintain | 停药会反弹吗？/ 维持期怎么吃？/ 体重回升了怎么办？/ 每周要运动多久？ |

badDay 时覆盖为：打完恶心怎么办？/ 便秘怎么办？/ 什么情况要去医院？/ 吃不下东西怎么办？

---

## 7. 洞察引擎（`insight.js`）

### 7.1 执行时机与合并

- `today.onShow`、`log` 页"完成打卡"、`dose` 页保存后，调用 `insight.refresh()`。
- `evaluate` 对每条规则：`cond(data) === true` 且 不在冷却期 → 生成卡。冷却判断：`now − max(lastFired[key], lastDismissed[key]) ≥ cooldownDays × 24H`；`once` 类规则用带后缀的唯一 key，只要 `lastFired[key]` 存在就不再触发。
- active 中超过 14 天未关闭的卡自动移除。

### 7.2 规则表（13 条）

近 N 天 = 含今天往前 N 个日历日。"有记录"指该字段非 null。

| ruleId | 优先级 | 条件 | 冷却 | title | body | askPrompt | cta |
|---|---|---|---|---|---|---|---|
| `dose_overdue` | 95 | med.active 且 `pk.phase === 'overdue'` | key=`dose_overdue:`+上次注射日期，once | 这周的针还没记录 | 如果已经打了，记一下就好；如果漏打了，{missedRule} | 我漏打了一针，该怎么办？ | 去记录注射 |
| `regain` | 90 | stage=maintain 且 stopWeightKg 且 最新体重 > stopWeightKg × 1.03 | 14 天 | 体重在往回走 | 比停药时高了 {deltaKg}kg。别慌，这正是该约个复诊的信号，早点和医生聊比等它涨上去好。 | 停药后体重回升了怎么办？ | 生成就诊摘要 |
| `fast_loss` | 80 | `weeklyRatePct(14) > 1.5` | 14 天 | 这两周掉得有点快 | 近两周平均每周 -{rate}%。掉太快更容易掉肌肉、脸也容易"垮"，蛋白和力量要跟上。 | 减重太快会不会有司美脸？我该注意什么？ | 看「司美脸怎么防」 |
| `constipation_streak` | 75 | 近 4 天中 ≥ 3 天 symptoms.constipation | 7 天 | 便秘好几天了 | 试试今天把水喝到 {waterCups} 杯，每餐加一拳蔬菜，饭后走 15 分钟。超过 3–4 天没排便请告诉医生。 | 便秘好几天了怎么办？ | — |
| `water_low` | 70 | 近 3 天 waterCups 有记录天数 ≥ 2，且平均 < waterCups × 0.6，且近 3 天出现过 nausea 或 constipation | 5 天 | 水可能喝少了 | 最近几天平均 {avg} 杯，离 {waterCups} 杯还差不少。恶心、便秘都和喝水少有关。 | 喝水总是忘怎么办？ | — |
| `post_increase` | 70 | med.history 最近一条 dose_change 的 doseMg 大于前一个剂量，且距今 ≤ 7 天 | key=`post_increase:`+变更日期，once | 刚加量，这周温柔一点 | 加量后的一周最容易又恶心、没力气，通常会慢慢好起来。少量多餐，运动强度先降一档。 | 加量后又恶心了怎么办？ | — |
| `plateau` | 65 | stage=plateau | 21 天 | 体重在休息，不是你的错 | 平台期很常见。先检查蛋白、力量、睡眠；用药要不要调整，复诊时和医生聊。 | 平台期怎么办？ | 看「平台期」 |
| `protein_low` | 60 | 近 7 天 proteinServings 有记录 ≥ 3 天，且达标天数 < 有记录天数的一半 | 7 天 | 蛋白有点跟不上 | 近 7 天只有 {hit}/{n} 天吃够蛋白。胃口小的时候，先吃蛋白再吃别的。 | 胃口小怎么吃够蛋白？ | 看「用药期间怎么吃」 |
| `visit_soon` | 60 | nextVisitDate 在今天起 0–3 天内 | key=`visit_soon:`+日期，once | {days}天后复诊 | 提前把这几周的数据整理好，复诊时给医生看，省时又说得清。 | 复诊时我该问医生什么？ | 生成就诊摘要 |
| `strength_low` | 55 | stage ∈ {titrate, plateau, maintain}，近 14 天打卡 ≥ 5 天，strength=true 天数 < 2 | 14 天 | 加点力量训练吧 | 近两周力量训练 {n} 次。每周 2 次、每次 20 分钟，就能帮你少掉肌肉。 | 力量训练怎么在家开始？ | 看「要不要运动」 |
| `trough_appetite` | 50 | phase=trough 且 今日 appetite='high' | 7 天 | 嘴馋是药效低谷，正常 | 快到打针日了，药效在低谷，饿得快很正常。备点鸡蛋、酸奶、豆干，饿了先吃蛋白。 | 打针前几天特别饿怎么办？ | — |
| `titration_4w` | 40 | med.active，daysOnDose ≥ 28，currentDoseMg < 该药 doseOptionsMg 最大值，近 7 天无 isBadDay | 28 天 | 当前剂量已经 {weeks} 周了 | 是维持还是调整，下次复诊时可以和医生聊聊。我帮你把这几周的反应和体重整理好。 | 复诊时我该问医生什么？ | 生成就诊摘要 |
| `streak` | 30 | streak ∈ {7, 30, 100} | key=`streak:`+天数，once | 连续打卡 {n} 天 🎉 | 记录本身就是改变的开始。谢谢你认真对待自己。 | — | — |

文案约束：不出现"该加量了""效果不好""失败"等措辞（R2、R8）。

### 7.3 测试（`test/insight.test.js`）

至少覆盖：`fast_loss` 触发与冷却、`dose_overdue` once 语义、`protein_low` 记录不足不触发、`visible` 最多 2 张按优先级、`dismiss` 后冷却从 dismiss 时刻算。

---

## 8. 知识卡内容（`data/kb.js`）

结构：`module.exports = [{ id, title, stages: ['start',…], minutes: 2, sections: [{ h: '小标题', p: ['段落/条目', …] }] }]`。页面渲染：小标题 + 条目（每条一个 `<view class="kb-li">`）。以下为全部 P0 内容要点，工程直接转写为条目（可轻度润色但不得增减医学事实）。所有涉及剂量的篇目末尾固定加一条："具体剂量和节奏，以你的处方医生为准。"

| id | 标题 | stages | 要点 |
|---|---|---|---|
| `kb_what` | 这药到底是什么 | explore,start | GLP-1 受体激动剂，模拟肠道激素：增加饱腹感、减慢胃排空、减少食欲；替尔泊肽同时作用于 GIP 和 GLP-1 两个受体；都是每周打一次的皮下注射；头几周胃口就会变小，体重明显变化通常在 1–3 个月；它让你更容易吃少，但吃什么、动不动仍然决定结果 |
| `kb_fit` | 我适合用吗 | explore | 国内减重适应症一般为 BMI ≥ 28，或 ≥ 24 且合并高血压/高血糖/脂肪肝等；不适合或需特别谨慎：怀孕/哺乳/备孕、本人或家族甲状腺髓样癌/MEN2、胰腺炎史、严重胃肠疾病；挂内分泌科、减重门诊或营养科；只用处方、正规药房的药 |
| `kb_prepare` | 开始前准备什么 | explore,start | 复诊前列好问题（已用药物、病史）；家里备：体重秤、量杯/水杯、鸡蛋酸奶等高蛋白食物；定一个固定的打针日；把打针日加到手机日历；拍一张正面照留作对比（P1 功能上线后可在 App 内） |
| `kb_first_shot` | 第一针怎么打 | start | 洗手、核对药品与有效期、药液应澄清；部位：腹部离肚脐 5cm 外、大腿前外侧、上臂，每次轮换；按所用注射笔说明书操作，注射后停留几秒再拔针；针头放硬质容器；开封前冷藏 2–8°C，开封后按说明书规定的温度和天数保存；第一次可以请医护人员示范 |
| `kb_nausea` | 恶心、没胃口怎么办 | start,titrate | 最常见反应，多在打针后 1–3 天和加量后出现，通常几周内减轻；少量多餐、七分饱停；先吃蛋白，少油炸甜腻；小口慢喝水；饭后别马上躺；吐到喝水都留不住、剧烈腹痛 → 立即就医 |
| `kb_gut` | 便秘和腹泻 | start,titrate | 便秘：喝够水、每餐一拳蔬菜、加燕麦/奇亚籽、饭后走走；3–4 天没排便或腹胀痛告诉医生；腹泻：少量多次补水，可用口服补液盐，暂避油腻辛辣乳制品；一天多次或头晕尿少需就医 |
| `kb_eat` | 用药期间怎么吃 | start,titrate,plateau,maintain | 优先级：蛋白 > 蔬菜 > 主食；每天目标 = App 计算的 N 份蛋白（1 份 ≈ 20g，列出 §5.2 对照）；餐盘：1/2 蔬菜、1/4 蛋白、1/4 主食；吃饭顺序先蛋白后主食；胃口小时用鸡蛋、酸奶、豆腐、蛋白粉补；不需要算卡路里 |
| `kb_move` | 要不要运动、动多少 | start,titrate,plateau,maintain | 要动，而且力量训练很关键：减重时可能有约 1/4 到 1/3 的体重来自肌肉等非脂肪组织；按阶段的目标（引用 §5.2 表）；在家力量入门：靠墙深蹲、跪姿俯卧撑、弹力带划船、臀桥，每个 3 组×10–12 次，约 20 分钟；打针后 1–2 天头晕没力气就改散步；运动前后喝水 |
| `kb_face` | "司美脸"怎么防 | titrate,plateau | 不是药物直接伤脸，而是快速减脂时面部脂肪减少、皮肤回缩跟不上，加上肌肉流失显得憔悴；预防：减重速度每周 0.5–1% 体重、蛋白吃够、每周 2–3 次力量、喝够水、睡够、防晒；App 会在近两周超过每周 1.5% 时提醒；已出现明显变化可在体重稳定后咨询正规医美/皮肤科 |
| `kb_titration` | 加量前后那一周 | titrate | 说明书常见节奏（引用 §4.5 labelSchedule，两种药各一条）；是否加量由医生根据效果和耐受决定，不是越快越好；加量后一周反应可能回来，少量多餐、运动降一档；不能耐受时联系医生，不要自行减半或跳针 |
| `kb_missed` | 漏打了怎么办 | start,titrate,plateau | 三种药的 missedRule 原文；不要一次打两针补；改打针日要保证两针间隔（司美 ≥ 2 天、替尔泊肽/度拉糖肽 ≥ 3 天）；不确定就问医生或药师 |
| `kb_plateau` | 平台期是怎么回事 | plateau | 体重下降后身体代谢和食欲会适应，几周不动很常见；检查：蛋白、力量、睡眠、喝水、是否有"隐形零食"；看腰围和衣服而不只看秤；用药是否调整，复诊和医生聊，不要自行加量 |
| `kb_stop` | 停药会反弹吗 | plateau,maintain | 研究显示停药后一年内很多人会回升相当一部分体重（司美格鲁肽研究中约回升已减体重的 2/3）；所以停药/减量要和医生一起决定，不要自己突然停；停前准备：蛋白、力量、每周称重已成习惯；停药后 App 进入维持期模式，体重超过停药时 3% 会提醒你复诊 |
| `kb_maintain` | 维持期怎么吃动 | maintain | 蛋白目标不变；运动量比减重期更多（每周 200–300 分钟 + 力量 2–3 次）；每周固定一天称重；体重守护区间 = 停药体重 ±2%，超过 3% 尽快复诊；偶尔吃多不用补偿性节食 |
| `kb_red_flags` | 这些情况要马上去医院 | 全部 | 列出 §6.1 的 7 类症状（不含 mental）的口语描述；"如果拿不准，宁可去一趟"；120 |
| `kb_special` | 特殊情况须知 | explore,start | 怀孕/备孕/哺乳（司美停药至少 2 个月再备孕）；替尔泊肽与口服避孕药（开始和每次加量后 4 周加用其他避孕方式）；同时用胰岛素/磺脲类的低血糖风险；手术/胃镜前告诉医生你在用这类药（胃排空变慢） |
| `disclaimer` | 免责声明 | （不在推荐中出现） | 01-PRD §6 全文 |

推荐逻辑（今天页阶段指南卡）：取 `stages` 含当前阶段的篇目，按表中顺序，优先第一篇未读（`smh_kb_read` 无记录）；都读过则取第一篇。badDay 时固定推荐 `kb_nausea` 或 `kb_red_flags`（有 vomiting 时）。

---

## 9. 页面 — 组件 — 服务依赖关系

```
app.js ──> storage.migrate, ensureOnboarded

pages/onboarding ──> storage(meta/profile/med/settings), plan.computeTargets, pk.MEDS, date
pages/today ─────┬─> ai.buildContext ──> storage, plan, pk, date
                 ├─> rules.dailyBrief（同步首屏） → ai.dailyBrief（异步替换） → storage(smh_brief)
                 ├─> insight.refresh ──> storage, plan, pk
                 ├─> pk.feltPct / pk.phase
                 ├─> components: ring, insight-card
                 └─> data/kb（阶段指南卡）
pages/log ───────┬─> storage.getCheckin/upsertCheckin/completeCheckin/listCheckins
                 ├─> ai.parseCheckin → rules.parseCheckin, rules.screenRedFlags
                 ├─> ai.checkinFeedback, insight.refresh, plan.computeTargets
                 └─> components: chip-group, cup-grid
pages/chat ──────┬─> ai.chat ──> rules.screenRedFlags → (provider.complete | rules.reply) → rules.guardOutput
                 ├─> rules.suggestedQuestions, storage.appendChat
                 └─> app.globalData.pendingAsk（入站问题）
pages/me ────────> storage(profile/med), plan.computeTargets, plan.streak
pages/dose ──────> storage.addDose/saveMed, plan.nextSite/siteLastUsed/doseIntervalWarn, pk.MEDS, insight.refresh
pages/trend ─────> storage.listCheckins, plan.movingAvg/weeklyRatePct, components: line-chart
pages/plan ──────> storage.saveMed, pk.MEDS, wx.addPhoneRepeatCalendar / wx.addPhoneCalendar
pages/article ───> data/kb, storage(smh_kb_read)
pages/report ────> storage(全部只读), plan, ai.visitQuestions → rules.visitQuestions
pages/sos ───────> 静态内容（rules 中红旗清单常量 RED_FLAG_LIST），wx.makePhoneCall
pages/settings ──> storage(settings/exportAll/clearAll/clearChat), ai.testConnection
custom-tab-bar ──> 无服务依赖
components/ring, line-chart ──> utils/theme（取色）
```

依赖方向只能是：页面 → ai/insight → rules/plan/pk/date → （无）；storage 被 ai/insight 与页面使用。`rules/plan/pk/date` 之间：`rules → plan, pk, date`；`plan → pk, date`；`pk` 无依赖。禁止反向依赖。

### 9.1 测试清单（node 直接运行，全部必须通过）

| 文件 | 覆盖 |
|---|---|
| `test/pk.test.js` | 现有 + §4.6 全部向量 |
| `test/plan.test.js` | computeStage 5 个阶段各 1 例 + 平台期边界；computeTargets（165cm/92kg/titrate → proteinG 80, servings 4, waterMl 2800, cups 11）；weeklyRatePct；nextSite；doseIntervalWarn |
| `test/rules.test.js` | §6.1 红旗样例、§6.2 守卫样例、§6.3 每个意图至少 1 例、§6.4 解析样例、dailyBrief 优先级 1/4/6 各 1 例 |
| `test/insight.test.js` | §7.3 |

computeTargets 校验算式：h=1.65 → 25×1.65²=68.06 → ref=68.06 → 1.2×68.06=81.7 → round5=80 → servings=round(80/20)=4；water=30×92=2760 → round100=2800 → cups=round(11.2)=11。
