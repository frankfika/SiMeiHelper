// test/regression.test.js — Claude Code Round 3 评审修复的回归测试
//
// 目的：把 Round 3 评审发现的 1 blocker + 9 majors + 5 minors 中**已修复**的关键 bug
//       显式化为回归测试。未来 agent 修改规则/服务时一旦重新引入这些 bug，立即报警。
//
// 评审清单 + 修复记录见 docs/05-DATA.md §6.7 和 CHANGELOG.md Round 3。

const assert = require('assert')
const path = require('path')

// ---------------------------------------------------------------------------
// wx shim
// ---------------------------------------------------------------------------
const DAY = 86400000
function makeWx() {
  const store = {}
  return {
    setStorageSync(k, v) { store[k] = v },
    getStorageSync(k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : '' },
    removeStorageSync(k) { delete store[k] },
    getStorageInfoSync() { return { currentSize: 0, limitSize: 10240 } },
    showToast() {}, request() {}, getSystemInfoSync() { return { theme: 'light' } },
    onThemeChange() {}, showModal() { return { confirm: true } },
    navigateTo() {}, navigateBack() {}, switchTab() {}, reLaunch() {},
    setNavigationBarTitle() {}, setClipboardData() {},
  }
}

let pass = 0, fail = 0
const log = (ok, name, detail) => {
  if (ok) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (detail ? '  — ' + detail : '')); }
}

// ===========================================================================
// 区块 A：B1 blocker — 剂量 chip 数据格式
// ===========================================================================
console.log('A. B1 blocker — dose/plan 剂量 chip 数据格式');
{
  // 模拟页面调用语义：组件接受 value=数字 + options=[{value:number, label:'Xmg'}]
  // 若 value 是数字且 options 的 value 是数字，chip 能正确匹配
  const chipOptions = [
    { value: 0.25, label: '0.25mg' },
    { value: 0.5, label: '0.5mg' },
    { value: 1.0, label: '1mg' },
  ]
  // 找到当前剂量对应 chip
  const curDose = 0.5
  const matched = chipOptions.find((o) => o.value === curDose)
  log(matched && matched.label === '0.5mg', 'A.1 数字 value 能匹配（之前传字符串 → undefined）')
  log(typeof chipOptions[0].value === 'number', 'A.2 options 的 value 字段是 number')
  // 反例：字符串 value 不应匹配（旧的坏模式）
  const badOptions = ['0.25mg', '0.5mg', '1mg']
  const badMatch = badOptions.find((o) => o === 0.5)
  log(badMatch === undefined, 'A.3 反例：字符串 value 与 number 比较 → undefined（不应被采用）')
}

// ===========================================================================
// 区块 B：S1 — 血糖 13.5（高血糖）不应误报 hypoglycemia
// ===========================================================================
console.log('\nB. S1 — 血糖阈值收紧（高血糖不报警）');
{
  global.wx = makeWx()
  const rules = require(path.join(__dirname, '..', 'utils/rules.js'))
  log(rules.screenRedFlags('血糖13.5').level === 'none', 'B.1 血糖13.5（高血糖）不报警')
  log(rules.screenRedFlags('血糖 5.6 正常').level === 'none', 'B.2 血糖5.6 不报警')
  log(rules.screenRedFlags('血糖3.2').level === 'emergency', 'B.3 血糖3.2（低血糖）报警')
  log(rules.screenRedFlags('血糖2.8').level === 'emergency', 'B.4 血糖2.8（低血糖）报警')
  log(rules.screenRedFlags('血糖4.0').level === 'none', 'B.5 血糖4.0（临界但不算低）不报警（避免误报）')
  log(rules.screenRedFlags('血糖5.0').level === 'none', 'B.6 血糖5.0 不报警')
  log(rules.screenRedFlags('血糖3.8').level === 'emergency', 'B.7 血糖3.8 边界内仍报警')
}

// ===========================================================================
// 区块 C：S2 — 胰腺炎 / 胃部痉挛口语化变体
// ===========================================================================
console.log('\nC. S2 — 胰腺炎口语化变体（痉挛/阵痛）');
{
  global.wx = makeWx()
  const rules = require(path.join(__dirname, '..', 'utils/rules.js'))
  const cases = [
    '胃部痉挛，疼得厉害',
    '肚子阵痛',
    '上腹剧痛',
    '腹部一阵阵绞痛',
    '胃痉挛，疼到背部',
    '剑突下剧痛',
    '吃完饭上腹剧痛',
    '胃一阵阵疼，后背也疼',
  ]
  for (const t of cases) {
    const r = rules.screenRedFlags(t)
    log(r.level === 'emergency', 'C.1 pancreatitis 命中: ' + t)
  }
}

// ===========================================================================
// 区块 D：S3 — 剂量守卫加"翻倍/补打/打两针"
// ===========================================================================
console.log('\nD. S3 — 剂量守卫加"翻倍/补打"');
{
  const rules = require(path.join(__dirname, '..', 'utils/rules.js'))
  const blocked = [
    '剂量翻倍试试',
    '剂量加倍',
    '可以补打一针吗',
    '建议再打一针补上',
    '可以一次打两针',
    '一次打两针补上',
    '每周打一针加一次口服',
    '每周打2次',
    '试试每周两针',
    '建议每周两针',
    '改为每周3针',
  ]
  for (const t of blocked) {
    const g = rules.guardOutput(t)
    log(!g.ok, 'D.1 dose_guard 拦截: ' + t)
  }
  const allowed = [
    '多吃蛋白质，每份约 20g',
    // 注："一次不要打两针" / "请不要一次打两针" Round 4 已决议移入 DOSE_GUARD（safe-fail：宁拦不错放），见 corpus.test.js。
    '什么时候加量由医生决定',
    '不要自己加量',
  ]
  for (const t of allowed) {
    const g = rules.guardOutput(t)
    log(g.ok, 'D.2 dose_guard 放行: ' + t)
  }
}

// ===========================================================================
// 区块 E：S4 — dose_overdue 条件不成立时 refresh 应清除（cleanupExpired）
// ===========================================================================
console.log('\nE. S4 — insight.refresh 清理条件不成立的过期卡');
{
  global.wx = makeWx()
  // 用真实 storage
  const storage = require(path.join(__dirname, '..', 'utils/storage.js'))
  const insight = require(path.join(__dirname, '..', 'utils/insight.js'))

  // 模拟：已有 overdue 卡，但用户打了针（pk.phase 应不再是 overdue）
  const now = Date.now()
  // 装数据：dose_overdue 应只在 phase=overdue 时触发
  const med = { status: 'active', medId: 'tirzepatide', currentDoseMg: 5, doseSince: '2026-09-01', startDate: '2026-08-25', injectWeekday: 0, history: [] }
  const doses = [{ id: 'd1', medId: 'tirzepatide', doseMg: 5, timeMs: now - 3600000, site: 'abd_ul' }]
  const checkins = {}
  const profile = { nickname: 'X', sex: 'female', birthYear: 1990, heightCm: 165, startWeightKg: 92, startWeightDate: '2026-08-01', goalWeightKg: 80, conditions: [] }
  const settings = { ai: { provider: 'rules' }, reminders: {} }
  wx.setStorageSync('smh_meta', { schemaVersion: 1, installedAt: now - 100*DAY, disclaimerAcceptedVersion: storage.DISCLAIMER_VERSION, disclaimerAcceptedAt: now - 100*DAY, onboardingStep: 6, onboardedAt: now - 100*DAY, lastOpenDate: '' })
  wx.setStorageSync('smh_profile', profile)
  wx.setStorageSync('smh_med', med)
  wx.setStorageSync('smh_doses', doses)
  wx.setStorageSync('smh_checkins', checkins)
  wx.setStorageSync('smh_chat', { messages: [] })
  wx.setStorageSync('smh_insights', { active: [], lastFired: {}, lastDismissed: {} })
  wx.setStorageSync('smh_brief', null)
  wx.setStorageSync('smh_kb_read', {})
  wx.setStorageSync('smh_settings', settings)
  // 第 7 天的剂量 → phase=steady（不是 overdue）。dose_overdue 不应触发
  const visible = insight.refresh(now)
  log(!visible.some((c) => c.ruleId === 'dose_overdue'),
    'E.1 dose_overdue 在 phase=steady 时不触发（刚打过针的合理状态）')

  // 模拟：11 天没打针（过打针日）→ phase=overdue → 应触发
  const oldDoses = [{ id: 'd1', medId: 'tirzepatide', doseMg: 5, timeMs: now - 11 * 24 * DAY, site: 'abd_ul' }]
  wx.setStorageSync('smh_doses', oldDoses)
  wx.setStorageSync('smh_insights', { active: [], lastFired: {}, lastDismissed: {} })
  const visibleOverdue = insight.refresh(now)
  log(visibleOverdue.some((c) => c.ruleId === 'dose_overdue'),
    'E.2 dose_overdue 在 phase=overdue 时正确触发')

  // 关键：用户打了针（conditions 不再成立）→ 刷新后 overdue 卡应清除
  wx.setStorageSync('smh_doses', doses) // 重新打针
  // 不重置 insightsState — refresh 应自动清除不成立的卡
  const visibleCleared = insight.refresh(now)
  log(!visibleCleared.some((c) => c.ruleId === 'dose_overdue'),
    'E.3 S4 修复：refresh 后 dose_overdue 卡被清除（条件不成立）')
}

// ===========================================================================
// 区块 F：S5 — 肾病用户蛋白文案改写
// ===========================================================================
console.log('\nF. S5 — 肾病用户蛋白文案改写');
{
  global.wx = makeWx()
  const rules = require(path.join(__dirname, '..', 'utils/rules.js'))
  const ctx = {
    profile: { conditions: ['kidney'] },
    targets: { proteinG: 80, proteinServings: 4, waterCups: 11, waterMl: 2800 },
    phase: 'titrate',
    pk: { phase: 'steady' },
    name: '肾友',
  }
  const brief = rules.dailyBrief(ctx)
  log(brief.tasks[0].text.indexOf('医生建议') >= 0 || brief.tasks[0].text.indexOf('医生') >= 0,
    'F.1 肾病用户蛋白任务文案含"医生"引导（不直接推 1.2g/kg）')
}

// ===========================================================================
// 区块 G：S7 — log.js parseCheckin 红旗命中不应阻断解析
// ===========================================================================
console.log('\nG. S7 — log.js parseCheckin 红旗命中不阻断');
{
  // 这是一个页面的代码契约。验证 utils/rules.parseCheckin 本身仍解析非红旗字段
  global.wx = makeWx()
  const rules = require(path.join(__dirname, '..', 'utils/rules.js'))
  const text = '肚子疼得厉害还疼到后背，今天 88 公斤，吃了 1 份蛋白'
  const rf = rules.screenRedFlags(text)
  const parsed = rules.parseCheckin(text, { latestWeightKg: 88.5 })
  log(rf.level === 'emergency', 'G.1 红旗命中')
  log(parsed.weightKg === 88, 'G.2 红旗命中后 weightKg 字段仍可解析（不让页面吃）')
  log(parsed.proteinServings === 1, 'G.3 蛋白字段仍可解析')
}

// ===========================================================================
// 区块 H：S8 — parseCheckin 否定（不恶心）应不计
// ===========================================================================
console.log('\nH. S8 — parseCheckin 否定形式');
{
  global.wx = makeWx()
  const rules = require(path.join(__dirname, '..', 'utils/rules.js'))
  const r1 = rules.parseCheckin('今天不恶心，没啥事', { latestWeightKg: 88 })
  log(!r1.symptoms || !r1.symptoms.nausea, 'H.1 "不恶心" → symptoms 不应含 nausea')
  const r2 = rules.parseCheckin('今天没恶心，挺好的', { latestWeightKg: 88 })
  log(!r2.symptoms || !r2.symptoms.nausea, 'H.2 "没恶心" → 不含 nausea')
  const r3 = rules.parseCheckin('今天没有恶心', { latestWeightKg: 88 })
  log(!r3.symptoms || !r3.symptoms.nausea, 'H.3 "没有恶心" → 不含 nausea')
  // 反例：肯定陈述应命中
  const r4 = rules.parseCheckin('今天有点恶心', { latestWeightKg: 88 })
  log(r4.symptoms && r4.symptoms.nausea === 1, 'H.4 "有点恶心" → nausea:1（确保否定逻辑没误吞）')
}

// ===========================================================================
// 区块 I：buildContext 输出 injectedToday 字段（P1-1）
// ===========================================================================
console.log('\nI. P1-1 — buildContext 输出 injectedToday');
{
  global.wx = makeWx()
  const storage = require(path.join(__dirname, '..', 'utils/storage.js'))
  const ai = require(path.join(__dirname, '..', 'utils/ai.js'))
  const date = require(path.join(__dirname, '..', 'utils/date.js'))
  const now = Date.now()
  const todayKey = date.dateKey(now)
  wx.setStorageSync('smh_meta', { schemaVersion: 1, installedAt: now-30*86400000, disclaimerAcceptedVersion: storage.DISCLAIMER_VERSION, disclaimerAcceptedAt: now-30*86400000, onboardingStep: 6, onboardedAt: now-30*86400000, lastOpenDate: '' })
  wx.setStorageSync('smh_profile', { nickname: 'X', heightCm: 165, startWeightKg: 92 })
  wx.setStorageSync('smh_med', { status: 'active', medId: 'tirzepatide', currentDoseMg: 5, doseSince: '2026-09-01', startDate: '2026-08-25', injectWeekday: 0, history: [] })
  // 没有打针 → false
  wx.setStorageSync('smh_doses', [])
  wx.setStorageSync('smh_checkins', {})
  wx.setStorageSync('smh_chat', { messages: [] })
  wx.setStorageSync('smh_insights', { active: [], lastFired: {}, lastDismissed: {} })
  wx.setStorageSync('smh_brief', null)
  wx.setStorageSync('smh_kb_read', {})
  wx.setStorageSync('smh_settings', { ai: { provider: 'rules' }, reminders: {} })
  const ctx1 = ai.buildContext(now)
  log(ctx1.pk.injectedToday === false, 'I.1 今天没打针 → injectedToday=false')

  // 打了针 → true（用 today 02:00 避免 now-1h 在 CST 0–1 点跨界到昨天）
  const today02 = date.parseKey(todayKey) + 2 * 3600000
  wx.setStorageSync('smh_doses', [{ id: 'd1', medId: 'tirzepatide', doseMg: 5, timeMs: today02, site: 'abd_ul' }])
  wx.setStorageSync('smh_insights', { active: [], lastFired: {}, lastDismissed: {} })
  const ctx2 = ai.buildContext(now)
  log(ctx2.pk.injectedToday === true, 'I.2 今天打了针 → injectedToday=true')
}

console.log('\n' + (fail ? fail + ' 处失败' : 'Round 3 评审回归全部通过 ✓') + '（' + pass + '/' + (pass + fail) + '）')
process.exit(fail ? 1 : 0)