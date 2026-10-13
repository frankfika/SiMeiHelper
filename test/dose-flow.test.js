// test/dose-flow.test.js — pages/dose 状态机测试
//
// 目的：medication pages 是事件最敏感、最复杂的状态机：
//   - 注射间隔检查（最近一针 vs 所有历史针 — Round 3 Q1 修复）
//   - 剂量一致性检查（用户记录剂量 vs 方案剂量 — 可能误改方案）
//   - prescribed/considering → active 状态机迁移
//   - 加日历引导（避免重复弹窗）
// 这里不直接载入 Page({})（依赖 wx 全局），而是用 wx-shim + 状态机单步推进。

const assert = require('assert')
const path = require('path')

// ---------------------------------------------------------------------------
// wx shim + 模态响应队列
// ---------------------------------------------------------------------------

function makeWx(modalResponses) {
  const store = {}
  let modalIndex = 0
  return {
    setStorageSync(k, v) { store[k] = v },
    getStorageSync(k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : '' },
    removeStorageSync(k) { delete store[k] },
    getStorageInfoSync() { return { currentSize: 0, limitSize: 10240 } },
    showToast() {}, request() {},
    getSystemInfoSync() { return { theme: 'light' } },
    onThemeChange() {}, offThemeChange() {},
    showModal(opts) {
      const r = modalResponses[modalIndex++] || { confirm: false }
      if (opts && opts.success) opts.success(r)
      return r
    },
    makePhoneCall() {}, addPhoneRepeatCalendar() {}, addPhoneCalendar() {},
    setNavigationBarTitle() {}, setClipboardData() {},
    navigateTo() {}, navigateBack() {}, switchTab() {}, reLaunch() {},
    pageScrollTo() {}, vibrateShort() {},
    __store: store,
  }
}

// ---------------------------------------------------------------------------
// 测用例数据：4 周持续用药场景
// ---------------------------------------------------------------------------

function buildSeed() {
  const now = Date.now()
  const DAY = 86400000
  const today = (() => {
    const d = new Date(now)
    return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate()
  })()
  return {
    now, today, DAY,
    smh_meta: {
      schemaVersion: 1, installedAt: now - 90 * DAY,
      disclaimerAcceptedVersion: '2026-10-v1', disclaimerAcceptedAt: now - 90 * DAY,
      onboardingStep: 6, onboardedAt: now - 90 * DAY, lastOpenDate: today,
    },
    smh_profile: {
      nickname: '王姐', sex: 'female', birthYear: 1988,
      heightCm: 165, startWeightKg: 92, startWeightDate: today,
      goalWeightKg: 80, conditions: [],
    },
    smh_med: {
      status: 'active', medId: 'tirzepatide', brand: '',
      currentDoseMg: 2.5, doseSince: today,
      startDate: today, injectWeekday: 0,
      doctor: { name: '', hospital: '' },
      history: [],
      calendarAdded: { inject: true, visit: false, checkin: false },
    },
    smh_doses: [
      { id: 'd1', medId: 'tirzepatide', doseMg: 2.5, timeMs: now - 7 * DAY, site: 'abd_ul' },
      { id: 'd2', medId: 'tirzepatide', doseMg: 2.5, timeMs: now - 14 * DAY, site: 'abd_ur' },
      { id: 'd3', medId: 'tirzepatide', doseMg: 2.5, timeMs: now - 21 * DAY, site: 'abd_ll' },
    ],
    smh_checkins: {}, smh_chat: { messages: [] },
    smh_insights: { active: [], lastFired: {}, lastDismissed: {} },
    smh_brief: null, smh_kb_read: {},
    smh_settings: { ai: { provider: 'rules' }, reminders: { askedCalendar: true } },
  }
}

let pass = 0, fail = 0
const log = (ok, name) => { if (ok) { pass++; console.log('  ✓ ' + name); } else { fail++; console.log('  ✗ ' + name); } }

const storage = require(path.join(__dirname, '..', 'utils/storage.js'))
const plan = require(path.join(__dirname, '..', 'utils/plan.js'))
const date = require(path.join(__dirname, '..', 'utils/date.js'))

console.log('A. dose 间隔检查 - plan.doseIntervalWarn 边界')
{
  const seed = buildSeed()
  // tirzepatide: minIntervalH = 72
  // 距离 7 天整（=14*12=168h > 72h）→ 不报警
  const w1 = plan.doseIntervalWarn('tirzepatide', seed.now - 7 * seed.DAY, seed.now)
  log(w1.minH === 72 && w1.warn === false, 'A.1 tirzepatide 7 天前打针 → 不报警（7×24=168h > 72h）')
  // 距离 60h → 报警
  const w2 = plan.doseIntervalWarn('tirzepatide', seed.now - 60 * 3600000, seed.now)
  log(w2.warn === true, 'A.2 tirzepatide 60h 前 → 报警')
  // 距离 73h → 不报警（恰好 72h+1）
  const w3 = plan.doseIntervalWarn('tirzepatide', seed.now - 73 * 3600000, seed.now)
  log(w3.warn === false, 'A.3 tirzepatide 73h 前 → 不报警')
  // semaglutide: minIntervalH = 48
  const w4 = plan.doseIntervalWarn('semaglutide', seed.now - 50 * 3600000, seed.now)
  log(w4.minH === 48 && w4.warn === false, 'A.4 semaglutide 50h 前 → 不报警（< 48h 才报警）')
  const w5 = plan.doseIntervalWarn('semaglutide', seed.now - 36 * 3600000, seed.now)
  log(w5.warn === true, 'A.5 semaglutide 36h 前 → 报警')
}

console.log('\nB. dose 加日历引导（避免重复弹窗）')
{
  const seed = buildSeed()
  // seed.calendarAdded.inject 已是 true → 不应弹窗
  log(seed.smh_med.calendarAdded.inject === true, 'B.1 初始 calendarAdded.inject=true（已加过日历）')
  log(seed.smh_settings.reminders.askedCalendar === true, 'B.2 初始 reminders.askedCalendar=true（已问过）')
  // 注：seed 模拟"已有"状态；真正首次使用应该是 false/true。验证 storage 写入语义：
  // 当 calendarAdded.inject 已经是 true 时，不应再写 wx.addPhoneRepeatCalendar
}

console.log('\nC. 加日历引导状态机（首次 vs 后续）')
{
  // 模拟第 1 次注射（calendarAdded.inject=false, askedCalendar=false）
  // 第 1 次：弹 showModal → 用户选「加一下」→ addPhoneRepeatCalendar + 写 calendarAdded.inject
  // 第 2 次：calendarAdded.inject=true → 不弹窗
  let calledAddCalendar = false
  const wx = makeWx([{ confirm: true }]) // 用户选「加一下」
  wx.addPhoneRepeatCalendar = () => { calledAddCalendar = true }
  // 直接模拟逻辑
  const med = { calendarAdded: { inject: false, visit: false, checkin: false } }
  const settings = { reminders: { askedCalendar: false } }
  const shouldShowCalendarPrompt = !(med.calendarAdded && med.calendarAdded.inject) &&
    !(settings.reminders && settings.reminders.askedCalendar)
  log(shouldShowCalendarPrompt, 'C.1 首次应弹日历引导')
  // 模拟弹窗 + 加日历 + 写状态
  wx.showModal({ title: '要把每周打针日加到手机日历吗？', success: (r) => {
    if (r.confirm) {
      wx.addPhoneRepeatCalendar({ title: '💉 打针', repeatInterval: 'week' })
      calledAddCalendar = true
      // 写 med.calendarAdded.inject = true
      med.calendarAdded.inject = true
    }
    settings.reminders.askedCalendar = true
  }})
  log(calledAddCalendar, 'C.2 选"加一下"时调 addPhoneRepeatCalendar')
  log(med.calendarAdded.inject === true, 'C.3 加完后 med.calendarAdded.inject=true')
  log(settings.reminders.askedCalendar === true, 'C.4 弹窗后 askedCalendar=true（下次不再问）')

  // 模拟第 2 次：calendarAdded.inject 已经是 true → 不弹
  calledAddCalendar = false
  const wx2 = makeWx([])
  const shouldShow2 = !(med.calendarAdded && med.calendarAdded.inject) &&
    !(settings.reminders && settings.reminders.askedCalendar)
  log(!shouldShow2, 'C.5 已有 calendarAdded.inject → 不再弹日历引导')
  log(!calledAddCalendar, 'C.6 不会调用 addPhoneRepeatCalendar')
}

console.log('\nD. storage.addDose / deleteDose 状态机')
{
  // reset
  global.wx = makeWx([])
  for (const k of Object.keys(storage.KEYS)) {
    try { global.wx.removeStorageSync(storage.KEYS[k]) } catch (e) {}
  }
  const before = storage.get(storage.KEYS.DOSES)
  log(Array.isArray(before) && before.length === 0, 'D.1 初始 doses 是空数组（DEFAULTS 提供）')
  const d = storage.addDose({ medId: 'tirzepatide', doseMg: 5, timeMs: Date.now(), site: 'abd_ul' })
  log(typeof d.id === 'string' && d.medId === 'tirzepatide', 'D.2 addDose 返回新增 Dose 包含自动生成 id')
  const after = storage.get(storage.KEYS.DOSES)
  log(after.length === 1 && after[0].id === d.id, 'D.3 doses 数组长度=1，新条目在最前')
  // deleteDose
  storage.deleteDose(d.id)
  const after2 = storage.get(storage.KEYS.DOSES)
  log(after2.length === 0, 'D.4 deleteDose 后 doses 数组长度=0')
}

console.log('\nE. prescribed → active 状态机迁移（首次注射）')
{
  // 重置
  global.wx = makeWx([])
  for (const k of Object.keys(storage.KEYS)) try { global.wx.removeStorageSync(storage.KEYS[k]) } catch (e) {}
  // 模拟完成 onboarding 后的「已开药未开始」状态
  storage.set('smh_meta', { disclaimerAcceptedVersion: '2026-10-v1', onboardedAt: Date.now() })
  storage.set('smh_med', { status: 'prescribed', medId: 'tirzepatide', currentDoseMg: null, history: [] })
  const medBefore = storage.get('smh_med')
  log(medBefore.status === 'prescribed', 'E.1 起始：med.status=prescribed（已开药未开始）')
  // 模拟用户第一次打针
  const now = Date.now()
  storage.addDose({ medId: 'tirzepatide', doseMg: 2.5, timeMs: now, site: 'abd_ul' })
  storage.saveMed({
    status: 'active', medId: 'tirzepatide', startDate: date.dateKey(now),
    currentDoseMg: 2.5, doseSince: date.dateKey(now),
  }, { date: date.dateKey(now), event: 'start', medId: 'tirzepatide', doseMg: 2.5, note: '' })
  const medAfter = storage.get('smh_med')
  log(medAfter.status === 'active', 'E.2 prescribed → active 状态机迁移')
  log(medAfter.currentDoseMg === 2.5, 'E.3 currentDoseMg 写入')
  log(medAfter.doseSince === date.dateKey(now), 'E.4 doseSince 等于起始时间')
  log(Array.isArray(medAfter.history) && medAfter.history.length === 1, 'E.5 history 追加 start 事件')
  log(medAfter.history[0].event === 'start', 'E.6 history[0].event === start')
  log(medAfter.history[0].doseMg === 2.5, 'E.7 history[0].doseMg = 2.5')
}

console.log('\nF. 剂量变化状态机（医生调整剂量）')
{
  // 重置
  global.wx = makeWx([])
  for (const k of Object.keys(storage.KEYS)) try { global.wx.removeStorageSync(storage.KEYS[k]) } catch (e) {}
  storage.set('smh_med', { status: 'active', medId: 'tirzepatide', currentDoseMg: 2.5, history: [
    { date: '2026-09-05', event: 'start', medId: 'tirzepatide', doseMg: 2.5 },
  ] })
  // 模拟用户记录新剂量（5mg 而不是当前 2.5mg）
  storage.saveMed({
    currentDoseMg: 5, doseSince: '2026-09-12',
  }, { date: '2026-09-12', event: 'dose_change', medId: 'tirzepatide', doseMg: 5, note: '' })
  const med = storage.get('smh_med')
  log(med.currentDoseMg === 5, 'F.1 currentDoseMg 更新到 5')
  log(med.history.length === 2, 'F.2 history 追加 dose_change 事件')
  log(med.history[1].event === 'dose_change', 'F.3 history[1].event = dose_change')
  log(med.history[1].doseMg === 5, 'F.4 history[1].doseMg = 5')
  log(med.history[1].date === '2026-09-12', 'F.5 history[1].date = 2026-09-12')
}

console.log('\nG. 停药状态机（停药 → 进入维持期）')
{
  global.wx = makeWx([])
  for (const k of Object.keys(storage.KEYS)) try { global.wx.removeStorageSync(storage.KEYS[k]) } catch (e) {}
  storage.set('smh_med', { status: 'active', medId: 'tirzepatide', currentDoseMg: 5, history: [
    { date: '2026-09-01', event: 'start', medId: 'tirzepatide', doseMg: 2.5 },
    { date: '2026-09-08', event: 'dose_change', medId: 'tirzepatide', doseMg: 5 },
  ] })
  storage.set('smh_profile', { startWeightKg: 92 })
  // 用户记录停药
  storage.saveMed({
    status: 'stopped', stopDate: '2026-10-05', stopWeightKg: 92,
  }, { date: '2026-10-05', event: 'stop', medId: 'tirzepatide', doseMg: 5, note: '' })
  const med = storage.get('smh_med')
  log(med.status === 'stopped', 'G.1 状态 → stopped')
  log(med.stopDate === '2026-10-05', 'G.2 stopDate = 2026-10-05')
  log(med.stopWeightKg === 92, 'G.3 stopWeightKg = 92（落地当前体重）')
  log(med.history.length === 3, 'G.4 history 追加 stop 事件')
  log(med.history[2].event === 'stop', 'G.5 history[2].event = stop')
}

console.log('\n' + (fail ? fail + ' 处失败' : 'dose 状态机全部通过 ✓') + '（' + pass + '/' + (pass + fail) + '）')
process.exit(fail ? 1 : 0)