# Pages & UI Code Review Report — SiMeiHelper

## 总览

- **审查范围**：12 pages + 5 components（`pages/onboarding, log, today, chat, dose, me, plan, sos, article, report, settings, trend` + `components/{ring,line-chart,chip-group,cup-grid,insight-card}`）
- **基准检查**：`node tools/page-contract.js` ✅ 12/12 wxml/js handler 名一致（未发现新不一致）
- **分级总计**：
  - **P0 blocker**：9 条（影响安全 / 数据正确性 / 必现崩溃）
  - **P1 major**：24 条（状态机 / 可访问性 / 与 spec 不一致）
  - **P2 minor**：22 条（性能 / 重复代码 / 体验 nit）
- **报告位置**：`/tmp/code-review-pages-ui.md`（537 行，按文件分节）

## 关键路径重点（用户特别关心的）

### 1. `today.js` onShow 简报缓存逻辑
- **P1**：`localInputHash` 公式未覆盖 `ctx.pk.daysToNextDose ≤ 0` 分支，与 `ai.inputHash` 不一致 → 跨会话 hash 漂移
- **P1**：`_briefTried = hash` 在 `force=true` 下拉刷新时仍保留 → 用户期望"再拉一次会重试"但被跳过
- **P1**：`_injectedToday` 在 onShow 顶部快照，但后续 `renderBrief`/`renderInsights` 内部用的都是这份缓存 → 与 dose.js 写入之间存在窄竞态
- **P2**：badDay 过滤把 priority<70 的卡全滤掉，UI 上没说明"洞察已简化"

### 2. `chat.js` sendMessage + apply_checkin 合并 symptoms
- **P0**：`sendMessage` 末尾 `.then` 第二个回调清 `sending/typing` 状态，没有 `.finally` → 如果 ai.chat resolve 但 appendChat throw，sending=true 卡死
- **P1**：`_applied[mid][aidx]` 是 page instance 字段，页面销毁后丢失 → 重新进入 chat，state.active 卡上同一个 action 按钮又能再点（"已记录"提示丢失）
- **P1**：apply_checkin 路径 `patch.symptoms = Object.assign({}, cur.symptoms || {}, patch.symptoms)` 合并逻辑正确（chat.js:259），但未写 `insight.refresh()` → 痛点未触发洞察（today.js onShow 会重算，OK）

### 3. `dose.js` `_save/_afterIntervalConfirm/_commit` 三阶段保存
- **P0**：`_save` 间隔检查用 "**所有历史针中绝对时间差最小的那一条**" 来判 prev——补录一周前的针时，prev 是 lastDose（时间在未来），算的是未来距离而非用户期望的"上一针"
- **P0**：`dose.wxml:19` `<picker mode="date" end="{{dateValue}}">` 让"可选最晚日期"绑成自身——意味着**用户无法选历史日期补录**，但页面文案是"打完多久都可以记"
- **P0**：`_draft.siteKey` 默认缺失 → 用户必须手动点 site 一次才能保存；与 `nextSite` 自动推荐样式冲突（推荐只是视觉标记，没 setData）
- **P1**：补录模式（line 200 `_save(timeMs, false)`）**跳过剂量一致性确认**——与正常保存逻辑不一致
- **P1**：`onPickDose` 只判 `typeof mg === 'number'`，chip-group 在字符串 value 时直接 return 不保存——依赖 chip-group type 严格匹配

### 4. `log.js` 一句话打卡 + 月历 30 天限制
- **P0**：`onComplete` 用旧 `_now` 调 `insight.refresh` → 跨 0:00 时 `lastFired`/`lastDismissed` 用错误的 todayKey
- **P1**：`onPreviewRemove` 用 `preview.slice().splice(idx, 1)` → 删除中间项后再点后续 chip 实际指向不同字段（dataset idx 与 ui 不一致）
- **P1**：`readOnly = date.daysBetween(minKey, key) < 0` 等价 `key < minKey`——但**当 key 恰好等于 minKey 时 readOnly=false**（line 228 `key < _minKey` 用了 `< 0`，没考虑边界）
- **P1**：`weightNote` 用 `this._lastWeight` 是 loadDay 时算的，跨 onShow 之间不会更新（saveField 没刷新 weightNote）
- **P2**：`refreshAll` 用 `lastDoneKey` 字符串字典序比较，**未排除未来日期**的 completedAt 误算"上次打卡 ≥ 3 天前"

### 5. `pages/settings/settings.js` clearAll 双重确认
- **P0**：仅靠 `editable modal` 用户输入 "清空" 确认——WeChat 的 editable modal 没 maxlength，可绕过
- **P1**：成功后 `wx.reLaunch` 到 onboarding，但**没删除 globalData.pendingAsk**（chat.js 端 global state 残留）
- **P2**：apiKey 用 `<input password="{{true}}" bindinput="onApiKey">` ——onApiKey 直接存未 trim 的 key（OK），但 `setData({apiKeyDisplay})` 在 onBaseUrl/onModel 路径没同步触发——**切换 provider 时 apiKeyDisplay 可能错位**

### 6. `pages/sos/sos.js` onFlag 红旗映射
- **P0**：FLAGS 数组硬编码 7 项（pancreatitis/dehydration/hypoglycemia/allergy/gallbladder/thyroid/vision），与 rules.js RED_FLAGS 静态对应——**rules.js 加新红旗时 sos.js 不会自动同步**（不同步就是 stale UI）
- **P1**：REPLY_NOTICE fallback 写死 `FALLBACK_NOTICE`，与 rules.js SAFETY_TAIL 不联动
- **P1**：`buildRelief` 取 kb 段落时，kb 未就绪每组都返回通用句"多数会在身体适应后减轻"——文字过于模板化，缺 kb.js 的 fallback 引用
- **P2**：sos.wxml:22 chip "有/没有" 用 `<view bindtap>` 不是 `<button>`——可访问性差（无原生焦点环，screen reader 不读）

## 其他跨页一致性问题

### P1 一致性
1. **`pendingAsk` 协议**：article/trend/today 三页发，chat.js `consumePendingAsk` 看「:」结尾判定只填入 vs 直接发送——但**`onSend`/`sending=true` 时把 pendingAsk 放进 input 后若用户切走，pendingAsk 仍 null，下次来 chat 不会重发**
2. **`focusField` 协议**：today.js → log.js 跨页传 `app.globalData.focusField`——log.js onShow 消费一次后清空，**第二次回退路径缺 fallback**
3. **`updateGoal` 路径**：me.js `editGoal` 写 `goalWeightKg:null` 表示清空，trend.js 不依赖——OK；但**me.js `stage.week === 0` 时显示"观望中"**（`stage.week ? String : '观望中'`）——用药第 0 周误判

### P2 性能 / 重复
1. `dose.js:331 siteLastUsedOf(doses)` 与 `plan.js:169 siteLastUsed(doses)` 是**重复代码**
2. `log.wxml:99–186` 正常/难受模式 form-row block 重复 4 次，可抽 `<include>`
3. `plan.js:230` 死代码三目 `new Date().getHours() < 21 ? nextSameHourAt(21) : nextSameHourAt(21)` 两分支相同

## 修复优先级

### P0 必修（5 条）
1. `dose.wxml:19` picker `end="{{dateValue}}"` → 改成 `end="{{''}}"` 或具体 today（让补录生效）
2. `chat.js:184–232` sendMessage 末尾 catch 分支后用 `.finally` 清 `sending/typing`
3. `dose.js:188–209` `_save` 间隔检查取 closest prior 而非 closest absolute
4. `settings.js:164–182` `onClearAll` 二次确认加强（showActionSheet 第二层）
5. `me.js:74` `stage.week === 0` 误判 → `stage.week != null ? String : '观望中'`

### P1 应修（按子目录分批）
- today.js: `_briefTried` force 清 / localInputHash 公式补 / 红旗映射 sort by date
- chat.js: `_applied` 持久化到 message.actions
- dose.js: `_draft.siteKey` 默认值 / 补录路径剂量一致性确认
- log.js: `onPreviewRemove` 用 key 而非 idx / `_now` 用 Date.now() / `weightNote` 刷新
- settings.js: apiKeyDisplay 同步 / globalData 清残留
- sos.js: FLAGS 动态从 rules.RED_FLAGS 生成
- report.js:122 硬编码 'titrate' stage → 用 computeStage

### P2 锦上添花
- 重复代码合并、冗余 setData 合并、UI nit

完整报告已写到 `/tmp/code-review-pages-ui.md`（每条 P0/P1/P2 都有文件:行号 + 问题 + 修复建议）。**未修改任何文件**，仅给报告。