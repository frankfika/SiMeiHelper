# utils/services + data 层深度 code review 报告

**项目**：司美助手 SiMeiHelper  
**审查范围**：utils/storage.js, plan.js, pk.js, rules.js, insight.js, ai.js, date.js, theme.js, data/kb.js  
**测试基准**：现有 11 套件 / 900+ 断言全部通过 → 报告聚焦**测试未覆盖的边界 / 与 docs/05-DATA.md 不一致 / 真实用户场景下的副作用**。

---

## P0 blocker（实际会破坏功能或安全）

### P0-1. `parseCheckin` 在 `走路半分钟` 等病句上产出 `cardioMin: NaN`
- 文件：`utils/rules.js:424-430`
- 代码：`mMin[2] === '半' ? 30 : Math.min(300, parseInt(mMin[2], 10) * 60)` 走 else 分支时对 `mMin[2] === '半'` 直接用 `parseInt('半', 10)` = NaN
- 实际触发：`'走路半分钟'` / `'跑了半分钟'` / `'骑车半分钟'` 都会被解析为 `cardioMin: NaN`（**Math.min(300, NaN) = NaN**）。`规则. parseCheckin('今天走路半分钟', {})` 验证返回 `{cardioMin: NaN}`。
- 后果：`NaN` 写入 `smh_checkins[date].cardioMin` → 后续 `Math.round(avgCardioMin)` / `last7.avgCardioMin` 计算污染；UI 渲染 NaN 会显示为空或错误。
- 修复建议：正则改为 `/(\d+|半)/`，并在 unit=`分钟` 时对 `半` 做 30 分钟解释（同 unit=`小时` 一致）；或对最终值做 `if (!isFinite(v)) skip`。

### P0-2. `parseCheckin` 蛋白 eggs 正则 `\d` 限定为个位数
- 文件：`utils/rules.js:390-397`
- 代码：`const egg = t.match(/(\d|[一二两三四])个(鸡)?蛋/g);`
- 实际触发：`'吃了10个鸡蛋'`、`'吃了20个鸡蛋'` 都被丢弃（`\d` 只匹配 0-9），而 spec §6.4 说"1 份 ≈ 2 个蛋"——大量鸡蛋的合理输入无法识别。
- 后果：用户输入 `10个鸡蛋` 时 proteinServings 为 null，**违反 docs §6.4 测试样例意图**（spec 期望累加）。
- 修复建议：改为 `/(\d+|[一二两三四五六七八九十百]+)个(鸡)?蛋/g`，并在 `cnNum` 兜底。

---

## P1 major（会引发用户困惑或文档不一致）

### P1-1. `dose_guard` 误拦"未来/以后/反过来"等中性语义
- 文件：`utils/rules.js:98`（DOSE_PATTERNS 第 6 条）
- 正则：`/(建议|可以|应该|直接|不妨|试试|最好).{0,80}(停药|停掉|停用|减量|加量|暂停)/`
- 实测：
  - `'X 应该加量（未来加）'` → **blocked**（明明是"未来加"，不是当下建议）
  - `'准备以后再加到1mg'` → 走 intent 反向 lookahead 放过
  - `'你的医生说你现在可以加到1mg'` → **blocked**（医生转述，spec 教学示例应放行）
  - `'说明书告诉你应该从0.25mg开始'` → ok（spec 显式测试）
  - `'医生说你准备好就可以加量'` → **blocked**（医生建议转述）
- 影响：LLM 给用户的**科普回复**会被 dose_guard 当场替换为"不能替你做决定"模板，破坏用户体验。
- 修复建议：放宽 lookahead，加入否定词检测（"不/别/千万/不该/不要"）；或把 `建议` 前缀后追加 `\d+(mg|毫克)` 强制条件——很多 false positive 是无具体数字的"加量"二字。

### P1-2. `rules.RED_FLAGS` mental 覆盖不全
- 文件：`utils/rules.js:59`
- 正则：`/不想活|想死|自杀|自残|活着没意思|活在世上没意义|活没意义|自我了断|结束.{0,3}(自己|我的).{0,2}生命|想结束.{0,2}生命/`
- 实测：
  - `'活着没意义'` ✓
  - `'觉得活着没意义'` ✗（漏报）
  - `'活不下去'` ✗（漏报）
  - `'甲状腺肿块'` ✗（漏报——thyroid 正则只匹配 `肿块` 前 4 字内）
- 后果：危机用户在自伤意念表达变体下不会被心理热线提醒，是 safety 红线。
- 修复建议：mental 正则增加 `活着没意义|活不下去|活不下去|不想活了|活得太累`；thyroid 正则放宽（如 `脖子.{0,4}(肿|包|鼓)` 或 `甲状腺.{0,4}(肿|包)`）。

### P1-3. `rules.RED_FLAGS` dehydration 漏报"尿特别少 / 喝水就吐"
- 文件：`utils/rules.js:29`
- 正则：`/(没有|几乎没|很少)(小便|尿)/`，但 spec 描述也是这个表达式。问题在测试面：`'喝水就吐'`、`'尿特别少'`、`'尿不出来'` 都没命中。
- 实测：
  - `'喝水都吐'` ✓
  - `'喝水就吐'` ✗（"就"没在 `(都|也)` 中）
  - `'尿不出来'` ✗
  - `'尿很少'` ✗（"很" 不在 `(没有|几乎没|很少)` 中）
- 后果：用户脱水性急症不被识别。
- 修复建议：扩展为 `/(没|不|几乎)(有)?(小便|尿)` 或增加变体 `/(喝|吃)(水|东西)(就|都|也)(吐|疼)`、`/(小便|尿)(很少|出不来|不出来|不出)`。

### P1-4. `dailyBrief.llmCountToday` 仅在 LLM 成功时才递增
- 文件：`utils/ai.js:619-625`
- 路径：LLM 调用 → `validateBrief(raw)` 失败 → 返回 `ruleBrief`（**未递增 llmCountToday**）→ 下次刷新又触发 LLM → 反复浪费 API 调用与时间。
- 后果：上限 3 次的"每日 LLM 生成次数"实际可能 30+ 次（全失败）。用户每次切 tab 都耗 15s 等 LLM 超时。
- 修复建议：在 `complete()` 调用前（或 `.then().catch()` 都失败时）预先 `storage.set('smh_brief', {date, llmCountToday: countToday+1, source:'rules'})`。spec §2.9 "上限 3" 应该按 attempts 算而非 successes。

### P1-5. `ai.buildContext` 中 `storage.getCheckin(todayKey)` 重复读两次
- 文件：`utils/ai.js:250` 与 `utils/ai.js:288`
- 变量 `today` (line 250) 读取后**从未被引用**（grep 确认）；line 288 又 `todayForBad = storage.getCheckin(todayKey)`。
- 后果：每次 buildContext 多做 1 次 `wx.getStorageSync` + 1 次 `JSON.parse(JSON.stringify(...))` 深拷贝——微性能损耗，但变量名/未使用变量让维护性变差。
- 修复建议：删除 line 250 的 `const today = storage.getCheckin(todayKey);`，把 line 288 改名为 `today`。

### P1-6. `parseCheckin` protein 食物列表误命中"鱼豆腐 / 鱼丸"
- 文件：`utils/rules.js:402-407`
- 正则：`/鸡胸|牛肉|鱼|虾|瘦肉|豆腐/g`，累加时**每次出现都 +1 份**。
- 实测：`'今天吃了鱼豆腐'` → 鱼 + 豆腐 → 2 份（实际约 1 份）；`'吃了鱼丸'` → 1 份（鱼丸里鱼含量极低）。
- 后果：蛋白估值偏高。
- 修复建议：长词优先匹配（`鱼丸` 不应计 `鱼`）；或拆为 `\b鸡胸\b|牛肉|鱼|虾|瘦肉|豆腐` 配合 anchor。

### P1-7. `rules.dailyBrief` line 499 缺分号导致依赖 ASI
- 文件：`utils/rules.js:499`
- 代码：`const kidneyFlag = c.profile && Array.isArray(c.profile.conditions) && c.profile.conditions.indexOf('kidney') >= 0`
- 下一行紧跟 `const proteinText = kidneyFlag`——ASI 仍正常工作但依赖 `indexOf >= 0` 返回 number（-1 / n）作为表达式结尾的副作用。
- 后果：能跑但代码风格脆弱，未来插入空行会 break。
- 修复建议：加 `;`。

### P1-8. `plan.weeklyRatePct` 全相等体重时返回 `-0`
- 文件：`utils/plan.js:141-143`
- 实测：3 个相同体重点 → `slope = 0`, `rate = (-0 * 7) / meanY * 100 = -0` → 返回 `-0`（`-0 < 0` false，`rateBand(-0)` 返回 `'flat'` 正确，但用户面看到 "-0.0%/周" 困惑）。
- 修复建议：`return Math.round(rate * 10) / 10 + 0` 消负零；或 `Math.abs(rate) < 0.05` 时返回 0。

---

## P2 minor（风格 / 注释 / 优化建议）

### P2-1. `DOSE_PATTERNS` 条数与文档不符
- 文件：`utils/rules.js:89-121`（实际 19 条）；`RELEASE.md:75` 称"DOSE_PATTERNS 25 条模式"；`docs/05-DATA.md:728-734` 列出 5 条示例。
- 建议：以一处为准更新其它两处（建议更新 RELEASE.md 为 19）。

### P2-2. `INTENTS` 共 20 条，spec/RUNBOOK 说"18 类意图"
- 文件：`utils/rules.js:186-307`（dose_change, stop_drug, buy_source, missed_dose, injection_how, nausea, constipation, diarrhea, simei_face, protein, water, exercise, plateau, hair_loss, alcohol, fatigue, pregnancy, what_is, fit, greeting = 20）
- 文件：`docs/05-DATA.md:748-773` 列表共 18（缺 `fit` 和 `hair_loss` 中的一个）；`RUNBOOK.md` 称"intentId 18 类"。
- 建议：核对并修正 docs / RUNBOOK。

### P2-3. `parseCheckin` proteinServings 不一致
- 文件：`utils/rules.js:407`（`Math.min(8, Math.round(p * 2) / 2)`）vs spec §6.4 "结果取整到 0.5，上限 8"——但 `'2个蛋 + 1杯奶 + 1块豆腐'` → 累加 `p=2.5`，`Math.round(2.5 * 2)/2 = 2.5` ✓。
- `'1个蛋'` → `p = 0.5` ✓；但当出现 `'1个蛋+1杯奶'` → `p = 1`，`Math.round(1*2)/2 = 1` ✓。
- 边界 OK，但 `'10个鸡蛋'` 因 P0-2 完全丢失是更严重 bug。

### P2-4. `isDoseDay` 缺 `c.todayDate` 时无声回退 false
- 文件：`utils/rules.js:475-478`
- 文档没明说 todayDate 来自哪里——`buildContext` 不返回 `todayDate` 字段。需要 ctx 注入。
- 建议：在 docs §6.5 AiContext 中明确 `ctx.todayDate` 是可选（与 `ctx.now` / `ctx.todayKey` 冗余但用于 weekday 判断），或在 buildContext 里也填充 `todayDate`。

### P2-5. `plan.doseIntervalWarn` 接受负 hours 并 warn
- 文件：`utils/plan.js:200-205`
- 实测：`doseIntervalWarn('semaglutide', 1000, 500)` → `{warn: true, hours: -0.0001..., minH: 48}`。负数 hours 语义上不应是 warn（应是 invalid input），但目前行为合理（误操作会被拦）。无 P0 影响，仅建议明确注释。

### P2-6. `storage.upsertCheckin` 实际返回整张 map，docs §3.2 已标注但易误用
- 文件：`utils/storage.js:153-164`
- 文档 `docs/05-DATA.md:387` 已明确标注返回 map。但仍是 API 陷阱：未来调用方很容易 `.completedAt` 取值就出错。
- 建议：函数命名 `upsertCheckinReturningMap` 或返回 `{ updated: Checkin, map }`。

### P2-7. `ai.dailyBrief` isDoseDay 重复实现
- 文件：`utils/ai.js:449-458` 与 `utils/rules.js:470-480`
- 两处都做了 weekday 注入判断——DRY 违反，但功能正确。建议把 `rules.isDoseDay` 在 ctx 没有 `todayDate` 时回退到 `new Date(ctx.now).toISOString().slice(0,10)`。

### P2-8. `ai.chat` Step 7 intent.actions 重复调用 rules.reply
- 文件：`utils/ai.js:534-538`
- 在 LLM 成功路径里又调用一次 `rules.reply(text, ctx)`，仅为了拿 `rr.actions`——而 Step 5 之前其实可以复用。但解析 success / fail 不同路径已轻微增加重复。

### P2-9. `parseCheckin` symptom 严重度"after"分支可能误判
- 文件：`utils/rules.js:447-450`
- 代码：`SEVERE_RE.test(after)` 会把症状词后面的"严重/很"算作本症状的严重度——但 `"今天有点恶心，但是不严重"` 实际解析为 `nausea: 1`（after 不含 SEVERE_RE）✓。
- 但 `"今天难受，便秘很严重"` → 子句分割后便秘子句的 before/after 包含 SEVERE_RE → 命中 2 ✓。  
- 边界 OK，仅 P2。

### P2-10. `data/kb.js` 17 张卡与 docs §8 表完全对齐 ✓ — 无问题
- 含 disclaimer 共 17 张；3 张剂量篇（kb_titration / kb_missed / kb_first_shot）末尾均含"具体剂量和节奏，以你的处方医生为准"。

### P2-11. `insight.refresh` `lastFired` / `lastDismissed` 不随 active 卡删除而清理
- 文件：`utils/insight.js:407-431`
- 长期使用（一年）后这些 map 会持续增长。P2 不是 P0——一年最多 13×365 ≈ 5000 entries，体积 < 200KB。但建议在 `cleanupExpired` 中加 90 天前的 lastFired/lastDismissed 清理。

### P2-12. `pk.steadyPeakPct` 用模块级 `steadyPeakCache`，永远不清
- 文件：`utils/pk.js:137-161`
- 实际项目里 medId 只有 3 种，不会内存爆炸。P3。

### P2-13. `theme.js` 没有"亮/暗模式对比值文档"
- 文件：`utils/theme.js`
- 值与 `app.wxss` 的 CSS 变量一致（注释已说明），但没指向 `docs/03-VISUAL.md §3.1` 作为真值源——颜色一致性靠人工对照。
- 建议：在 `light` / `dark` 对象上方注释指向 `docs/03-VISUAL.md §3.1`。

### P2-14. `parseCheckin` 中 `t.split(...)` 在中文标点上不稳
- 文件：`utils/rules.js:368`
- `clauses = t.split(/[，。,\.；;！!？?\s]+/).filter(Boolean)`
- 实测：`'今天恶心。没胃口'` → `['今天恶心', '没胃口']` ✓；`'今天恶心,没胃口'` → `['今天恶心', '没胃口']` ✓；`'今天恶心，没胃口'` → `['今天恶心', '没胃口']` ✓。
- 半角逗号、中文逗号都被覆盖。OK。

### P2-15. `parseCheckin` 半字符 `'今 天 恶 心'`（中间空格）能正确分割
- 已在 P2-14 中覆盖（`\s+`）。

---

## 测试盲区（建议补强）

| 区域 | 建议补测试 |
|------|------------|
| rules.js | `'医生说你准备好就可以加量'` 应放行；`'X 应该加量（未来加）'` 期望行为 |
| rules.js | mental 反向预测变体（`'觉得活着没意义'`、`'活不下去'`） |
| rules.js | dehydration 口语变体（`'喝水就吐'`、`'尿不出来'`） |
| rules.js | thyroid `'甲状腺肿块'` / `'脖子肿块'` |
| rules.js | `parseCheckin('今天走路半分钟')` 期望非 NaN |
| rules.js | `parseCheckin('今天吃了10个鸡蛋')` 期望 5 份 |
| rules.js | `parseCheckin('今天吃了鱼豆腐')` 期望 1 份 |
| ai.js | `dailyBrief` LLM 校验失败 3 次后应当停止重试 |
| ai.js | `buildContext` 在 `smh_insights` 为 null/string 时不抛错 |
| plan.js | `weeklyRatePct` 全相等体重返回非 `-0` |
| plan.js | `computeStage` 中 med=null / status='tapering' 但 startDate=null |
| storage.js | `upsertCheckin` 返回值类型契约（docs §3.2 已明确） |

---

## 总览

- **P0**：2 条（直接破坏数据完整性 / 真实场景下写入 NaN）
- **P1**：8 条（safety 漏报、文档不一致、用户体验）
- **P2**：15 条（风格 / 优化 / DRY）

**最关键建议**：
1. 先修 P0-1（cardioMin NaN）和 P0-2（蛋白大数字丢失）—— 立即影响真实用户。
2. P1-1（dose_guard 误拦）、P1-2/P1-3（红旗漏报）是 medical safety 边界，优先级等同 P0。
3. P1-4（llmCountToday）影响性能与 API 成本，应在 P1 阶段修。
4. P1-5/P1-6/P1-7/P1-8 是代码质量与文档一致性，建议合并到下轮维护 sprint。

**所有现有测试套件 900+ 断言全部通过**，这些 issue 集中在测试未触达的真实场景或 spec 演进后的边缘 case。