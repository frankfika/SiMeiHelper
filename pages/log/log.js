// pages/log — 记录页（每日打卡）
// 真相源：docs/02-UX.md §3.2（逐块规格）/ §4.2（打卡闭环）/ §6.2（难受模式），
//         docs/03-VISUAL.md §5.2（逐屏），docs/05-DATA.md §2.6（checkin schema）/ §6.4（parseCheckin）
// 约定：所有控件 bindchange 即 upsertCheckin（无保存按钮）；日期一律走 utils/date.js；
//       tab 页 onLoad 第一行 ensureOnboarded；onShow 置 tab selected=1。
const storage = require('../../utils/storage.js')
const plan = require('../../utils/plan.js')
const date = require('../../utils/date.js')
const rules = require('../../utils/rules.js')
const insight = require('../../utils/insight.js')
const theme = require('../../utils/theme.js')
const ai = require('../../utils/ai.js')

const LOOKBACK_DAYS = 30 // 可回看窗口：早于 30 天只读（02-UX §3.2 ①）

const FEEL_OPTIONS = [
  { value: 'good', label: '😊 不错' },
  { value: 'ok', label: '😐 一般' },
  { value: 'bad', label: '😣 难受' },
]
const FEEL_LABEL = { good: '不错', ok: '一般', bad: '难受' }

// 症状白名单与文案（05-DATA §2.6）；tri 三态：1=轻（浅色）2=重（实色+「重」角标）
const SYMPTOM_OPTIONS = [
  { value: 'nausea', label: '恶心' },
  { value: 'vomiting', label: '呕吐' },
  { value: 'diarrhea', label: '腹泻' },
  { value: 'constipation', label: '便秘' },
  { value: 'reflux', label: '反酸' },
  { value: 'bloating', label: '胀气' },
  { value: 'fatigue', label: '乏力' },
  { value: 'dizziness', label: '头晕' },
  { value: 'injection_site', label: '注射处' },
  { value: 'hair_loss', label: '掉头发' },
]
const SYMPTOM_LABEL = {
  nausea: '恶心', vomiting: '呕吐', diarrhea: '腹泻', constipation: '便秘',
  reflux: '反酸', bloating: '胀气', fatigue: '乏力', dizziness: '头晕',
  injection_site: '注射处', hair_loss: '掉头发',
}

const APPETITE_OPTIONS = [
  { value: 'low', label: '小' },
  { value: 'normal', label: '正常' },
  { value: 'high', label: '大' },
]
const APPETITE_LABEL = { low: '小', normal: '正常', high: '大' }

const CARDIO_OPTIONS = [0, 15, 30, 45, 60, 90].map((v) => ({ value: v, label: String(v) }))
const DOW_LABELS = ['日', '一', '二', '三', '四', '五', '六']

// 今天页任务行 focusField → 记录页行 id（02-UX §3.2 关键交互）
const FOCUS_ROW = {
  weight: 'row-weight',
  protein: 'row-protein',
  water: 'row-water',
  cardio: 'row-cardio',
  strength: 'row-strength',
}

function fmt1(n) {
  return (Math.round(n * 10) / 10).toFixed(1)
}

/** 解析结果 → 预览 chip 列表（02-UX §3.2 ②） */
function previewChips(parsed) {
  const p = parsed || {}
  const chips = []
  if (typeof p.weightKg === 'number') chips.push({ field: 'weight', key: '', label: '体重 ' + p.weightKg + 'kg' })
  if (p.feel) chips.push({ field: 'feel', key: '', label: '感觉 ' + (FEEL_LABEL[p.feel] || p.feel) })
  const sym = p.symptoms || {}
  Object.keys(sym).forEach((k) => {
    chips.push({ field: 'sym', key: k, label: (SYMPTOM_LABEL[k] || k) + (sym[k] === 2 ? '·重' : '·轻') })
  })
  if (typeof p.proteinServings === 'number') chips.push({ field: 'protein', key: '', label: '蛋白 ' + p.proteinServings + ' 份' })
  if (typeof p.waterCups === 'number') chips.push({ field: 'water', key: '', label: '水 ' + p.waterCups + ' 杯' })
  if (typeof p.cardioMin === 'number') chips.push({ field: 'cardio', key: '', label: '有氧 ' + p.cardioMin + ' 分钟' })
  if (p.strength === true) chips.push({ field: 'strength', key: '', label: '力量训练' })
  if (p.appetite) chips.push({ field: 'appetite', key: '', label: '食欲 ' + (APPETITE_LABEL[p.appetite] || p.appetite) })
  if (p.note) chips.push({ field: 'note', key: '', label: '备注：' + p.note })
  return chips
}

Page({
  data: {
    // ① 日期切换行
    selKey: '',
    dateText: '',
    canPrev: false,
    canNext: false,
    readOnly: false,

    // ② 一句话卡
    nlText: '',
    nlParsing: false,
    showPreview: false,
    preview: [],          // [{field, key, label}]
    previewEmpty: false,
    nlSafety: null,       // 红旗安全卡 {level, reply, actions}

    // ③ 结构化打卡
    checkin: { date: '', symptoms: {}, completedAt: null },
    weightText: '',
    weightPh: '如 88.4',
    weightError: '',
    weightNote: '',       // 昨天参照 / 骤变提示（02-UX §6.4）
    feelOptions: FEEL_OPTIONS,
    symptomOptions: SYMPTOM_OPTIONS,
    appetiteOptions: APPETITE_OPTIONS,
    cardioOptions: CARDIO_OPTIONS,
    feel: null,
    symptoms: {},
    protein: 0,
    water: 0,
    cardio: null,
    strength: false,
    appetite: null,
    proteinTarget: 4,
    waterTarget: 11,
    switchColor: '#1F7A6E',
    tipSym: false,        // 「点一次是轻，再点一次是重」首次提示
    badDay: false,
    otherOpen: true,      // 难受模式折叠区（默认折叠）

    // ④ 完成反馈：bubble（footer 上方气泡）→ 3s 后 card（卡片顶部一行小字，不自动消失）
    feedback: '',
    feedbackStage: 'none',

    // ⑤ 月历
    dowLabels: DOW_LABELS,
    streakText: '',
    calCells: [],

    // 其他状态
    firstCheckin: false,
    welcomeBack: false,
    showSheet: false,
    proteinExamples: [],
    hlRows: {},
  },

  onLoad() {
    if (!getApp().ensureOnboarded()) return
    this.setData({ selKey: date.dateKey(Date.now()) })
  },

  onShow() {
    if (this.getTabBar) this.getTabBar().setData({ selected: 1 })
    if (!getApp().ensureOnboarded()) return
    this.refreshAll()

    // 从今天页任务行进入：滚动到对应行并高亮 1s（02-UX §3.2 关键交互）
    const ff = getApp().globalData.focusField
    if (ff && FOCUS_ROW[ff]) {
      getApp().globalData.focusField = null
      if (this.data.badDay && ff !== 'weight') {
        this.setData({ otherOpen: true }) // 难受模式下目标行在折叠区里，先展开
      }
      const tick = wx.nextTick ? wx.nextTick : (fn) => setTimeout(fn, 100)
      tick(() => {
        wx.pageScrollTo({ selector: '#' + FOCUS_ROW[ff], duration: 300, fail: () => {} })
        this.flashRows([ff])
      })
    }
  },

  onUnload() {
    if (this._hlT) clearTimeout(this._hlT)
    if (this._fbT) clearTimeout(this._fbT)
  },

  // ------------------------------------------------------------------
  // 数据装载
  // ------------------------------------------------------------------
  refreshAll() {
    const now = Date.now()
    this._now = now
    this._todayKey = date.dateKey(now)
    this._minKey = date.addDays(this._todayKey, -LOOKBACK_DAYS)

    const profile = storage.get(storage.KEYS.PROFILE)
    const med = storage.get(storage.KEYS.MED)
    const checkins = storage.get(storage.KEYS.CHECKINS) || {}
    this._checkins = checkins

    // 打针日 → 月历 💉（doses 里该日有记录）
    this._doseDays = {}
    ;(storage.get(storage.KEYS.DOSES) || []).forEach((d) => {
      if (d && d.timeMs) this._doseDays[date.dateKey(d.timeMs)] = true
    })

    // 每日目标（05-DATA §3.4）
    const stage = plan.computeStage(med, checkins, now)
    const lw = plan.latestWeight(checkins, profile)
    this._targets = plan.computeTargets(profile, lw ? lw.kg : undefined, stage.key)

    // switch 主色（theme.js 色板与 app.wxss CSS 变量同源）
    const colors = theme.colors(getApp().globalData.theme)

    // 首次引导（§3.2 空态）/ 欢迎回来（§5.1：距上次打卡 ≥ 3 天仅当天显示）
    const keys = Object.keys(checkins)
    let lastDoneKey = ''
    keys.forEach((k) => {
      if (checkins[k] && checkins[k].completedAt && k > lastDoneKey) lastDoneKey = k
    })
    const welcomeBack = !!(lastDoneKey
      && lastDoneKey < this._todayKey
      && date.daysBetween(lastDoneKey, this._todayKey) >= 3)

    this.setData({
      proteinTarget: this._targets.proteinServings,
      waterTarget: this._targets.waterCups,
      switchColor: colors.primary,
      proteinExamples: plan.PROTEIN_SERVING_EXAMPLES,
      firstCheckin: keys.length === 0,
      welcomeBack,
      tipSym: !wx.getStorageSync('smh_tip_sym'), // 02-UX §3.2 ③ 一次性标记（规格指定直接读写该 key）
    })

    this.loadDay(this.data.selKey || this._todayKey)
    this.refreshCalendar()
  },

  /** 装载某一天到表单（日期切换 / 填进去回填 / onShow 都走这里） */
  loadDay(key) {
    const todayKey = this._todayKey
    const c = storage.getCheckin(key)
    const readOnly = date.daysBetween(this._minKey, key) < 0 // key 早于 30 天窗口

    // 体重占位/参照：selKey 之前最近一次体重
    let lastW = null
    Object.keys(this._checkins).forEach((k) => {
      const w = this._checkins[k] && this._checkins[k].weightKg
      if (k < key && typeof w === 'number' && (!lastW || k > lastW.date)) lastW = { kg: w, date: k }
    })
    this._lastWeight = lastW

    let weightNote = ''
    if (key === todayKey) {
      const y = this._checkins[date.addDays(todayKey, -1)]
      if (y && typeof y.weightKg === 'number') weightNote = '昨天 ' + fmt1(y.weightKg)
    }

    const badDay = plan.isBadDay(c)
    const hasMove = typeof c.proteinServings === 'number'
      || typeof c.waterCups === 'number'
      || typeof c.cardioMin === 'number'
      || c.strength === true

    const d = new Date(date.parseKey(key))
    const dayLabel = (d.getMonth() + 1) + '月' + d.getDate() + '日'

    this.setData({
      selKey: key,
      dateText: key === todayKey ? '今天 ' + dayLabel : dayLabel + ' · ' + date.weekdayCn(d.getDay()),
      canPrev: key > this._minKey,
      canNext: key < todayKey,
      readOnly,
      checkin: c,
      weightText: typeof c.weightKg === 'number' ? fmt1(c.weightKg) : '',
      weightPh: lastW ? fmt1(lastW.kg) : '如 88.4',
      weightError: '',
      weightNote,
      feel: c.feel,
      symptoms: c.symptoms || {},
      protein: typeof c.proteinServings === 'number' ? c.proteinServings : 0,
      water: typeof c.waterCups === 'number' ? c.waterCups : 0,
      cardio: typeof c.cardioMin === 'number' ? c.cardioMin : null,
      strength: c.strength === true,
      appetite: c.appetite,
      nlText: c.nlText || '', // 回看时显示原文
      showPreview: false,
      preview: [],
      previewEmpty: false,
      nlSafety: null,
      badDay,
      // 难受模式折叠区默认折叠（§6.2），但已有数据时展开，避免"看不见已填的值"
      otherOpen: !badDay ? true : hasMove,
    })
  },

  // ------------------------------------------------------------------
  // ① 日期切换（不晚于今天；早于 30 天只读并提示）
  // ------------------------------------------------------------------
  onPrevDay() {
    if (!this.data.canPrev) return
    this.loadDay(date.addDays(this.data.selKey, -1))
    this.refreshCalendar()
    wx.pageScrollTo({ scrollTop: 0, duration: 200 })
  },

  onNextDay() {
    if (!this.data.canNext) return
    this.loadDay(date.addDays(this.data.selKey, 1))
    this.refreshCalendar()
    wx.pageScrollTo({ scrollTop: 0, duration: 200 })
  },

  // ------------------------------------------------------------------
  // ② 一句话卡：screenRedFlags → ai.parseCheckin → 预览 → 填进去
  // ------------------------------------------------------------------
  onNlInput(e) {
    this.setData({ nlText: e.detail.value })
  },

  onNlSubmit() {
    if (this.data.readOnly || this.data.nlParsing) return
    const text = String(this.data.nlText || '').trim()
    if (!text) return
    const submitKey = this.data.selKey

    // 红旗守卫先于任何解析/LLM（05-DATA §6.1 / §6.4）；命中仍允许填入
    const rf = rules.screenRedFlags(text)
    this.setData({
      nlParsing: true,
      nlSafety: rf && rf.level !== 'none' ? rf : null,
      previewEmpty: false,
    })

    let ctx = null
    try { ctx = ai.buildContext(Date.now()) } catch (e) { ctx = null }
    ai.parseCheckin(text, ctx || undefined).then((parsed) => {
      if (this.data.selKey !== submitKey) return // 提交期间已切换日期，丢弃过期结果
      this._parsed = parsed || {}
      this._nlApplied = text
      const chips = previewChips(this._parsed)
      this.setData({
        nlParsing: false,
        showPreview: true,
        preview: chips,
        previewEmpty: chips.length === 0,
      })
    }).catch(() => {
      if (this.data.selKey !== submitKey) return
      this.setData({ nlParsing: false, showPreview: false, preview: [], previewEmpty: true })
    })
  },

  onPreviewRemove(e) {
    const idx = Number(e.currentTarget.dataset.idx)
    const preview = this.data.preview.slice()
    preview.splice(idx, 1)
    // 全部移除后直接收起预览（引导句只出现在"本来就没识别到"时）
    if (!preview.length) {
      this.setData({ preview: [], showPreview: false })
      return
    }
    this.setData({ preview })
  },

  onPreviewApply() {
    if (this.data.readOnly) return
    const parsed = this._parsed || {}
    const preview = this.data.preview
    const has = (field) => preview.some((c) => c.field === field)

    const patch = {}
    if (has('weight')) patch.weightKg = parsed.weightKg
    if (has('feel')) patch.feel = parsed.feel
    const symChips = preview.filter((c) => c.field === 'sym')
    if (symChips.length) {
      // 合并而非整体替换：已打卡的其他症状保留，仅覆盖/新增识别出的项
      const sym = Object.assign({}, this.data.checkin.symptoms || {})
      symChips.forEach((c) => { sym[c.key] = (parsed.symptoms || {})[c.key] })
      patch.symptoms = sym
    }
    if (has('protein')) patch.proteinServings = parsed.proteinServings
    if (has('water')) patch.waterCups = parsed.waterCups
    if (has('cardio')) patch.cardioMin = parsed.cardioMin
    if (has('strength')) patch.strength = true
    if (has('appetite')) patch.appetite = parsed.appetite
    if (has('note')) patch.note = parsed.note
    patch.nlText = this._nlApplied || String(this.data.nlText || '').trim() // 记录原文

    storage.upsertCheckin(this.data.selKey, patch)

    const rows = []
    if (patch.weightKg !== undefined) rows.push('weight')
    if (patch.feel !== undefined) rows.push('feel')
    if (patch.symptoms !== undefined) rows.push('sym')
    if (patch.proteinServings !== undefined) rows.push('protein')
    if (patch.waterCups !== undefined) rows.push('water')
    if (patch.cardioMin !== undefined) rows.push('cardio')
    if (patch.strength !== undefined) rows.push('strength')
    if (patch.appetite !== undefined) rows.push('appetite')

    this.setData({ showPreview: false, preview: [], nlSafety: null })
    this.loadDay(this.data.selKey) // 同步表单（难受模式含值时折叠区自动展开）
    this.flashRows(rows)
  },

  onPreviewCancel() {
    this.setData({ showPreview: false, preview: [], previewEmpty: false, nlSafety: null })
  },

  /** 红旗安全卡 actions：call / navigate（05-DATA §6.1） */
  onSafetyAction(e) {
    const a = e.currentTarget.dataset.action
    if (!a) return
    if (a.kind === 'call' && a.payload) {
      wx.makePhoneCall({ phoneNumber: a.payload, fail: () => {} })
    } else if (a.kind === 'navigate' && a.payload) {
      wx.navigateTo({ url: a.payload, fail: () => {} })
    }
  },

  // ------------------------------------------------------------------
  // ③ 结构化打卡（每个 change 即存，无保存按钮）
  // ------------------------------------------------------------------
  /** 通用保存：upsert → 同步 badDay/月历；hlKey 传行名则高亮该行 1s
   *  （注：upsertCheckin/completeCheckin 实际返回整张 checkins map，故保存后用 getCheckin 重读当天） */
  saveField(patch, hlKey) {
    if (this.data.readOnly) return
    storage.upsertCheckin(this.data.selKey, patch)
    const cur = storage.getCheckin(this.data.selKey)
    this.setData({ checkin: cur, badDay: plan.isBadDay(cur) })
    this.refreshCalendar()
    if (hlKey) this.flashRows([hlKey])
  },

  /** 行高亮 1s（「填进去」/ focusField 共用） */
  flashRows(fields) {
    if (!fields || !fields.length) return
    const hlRows = {}
    fields.forEach((f) => { hlRows[f] = true })
    this.setData({ hlRows })
    if (this._hlT) clearTimeout(this._hlT)
    this._hlT = setTimeout(() => this.setData({ hlRows: {} }), 1000)
  },

  onWeightInput(e) {
    this.setData({ weightText: e.detail.value, weightError: '' })
  },

  /** 体重失焦保存；30–300 之外红字不保存（02-UX §3.2 ③ 第 1 行） */
  onWeightBlur(e) {
    if (this.data.readOnly) return
    const raw = String(e.detail.value || '').trim()
    const cur = this.data.checkin
    if (!raw) {
      // 清空输入视为放弃编辑：恢复原值，不误清数据
      this.setData({
        weightText: typeof cur.weightKg === 'number' ? fmt1(cur.weightKg) : '',
        weightError: '',
      })
      return
    }
    const v = Math.round(parseFloat(raw) * 10) / 10
    if (!isFinite(v) || v < 30 || v > 300) {
      this.setData({ weightError: '看看是不是输错了', weightText: raw })
      return
    }
    this.setData({ weightError: '' })
    if (typeof cur.weightKg === 'number' && cur.weightKg === v) return
    this.saveField({ weightKg: v })

    // 体重骤变提示：与上次差 > 5kg 且间隔 < 7 天（02-UX §6.4，提示不阻止）
    if (this._lastWeight && this._lastWeight.date < this.data.selKey) {
      const gap = date.daysBetween(this._lastWeight.date, this.data.selKey)
      if (Math.abs(v - this._lastWeight.kg) > 5 && gap < 7) {
        this.setData({ weightNote: '和上次差得有点多，看看是不是输错了' })
      }
    }
  },

  /** 单选 chip 的"再点一次取消"（02-UX §3.2 ③：感觉/有氧/食欲） */
  onFeelChange(e) {
    const v = e.detail.value
    const next = v === this.data.feel ? null : v
    this.setData({ feel: next })
    this.saveField({ feel: next }, 'feel')
  },

  onCardioChange(e) {
    const v = e.detail.value
    const next = v === this.data.cardio ? null : v
    this.setData({ cardio: next })
    this.saveField({ cardioMin: next }, 'cardio')
  },

  onAppetiteChange(e) {
    const v = e.detail.value
    const next = v === this.data.appetite ? null : v
    this.setData({ appetite: next })
    this.saveField({ appetite: next }, 'appetite')
  },

  /** 症状 tri：值即 {key:1|2}；首次交互后隐藏提示并写一次性标记 */
  onSymChange(e) {
    const v = e.detail.value || {}
    const sym = {}
    Object.keys(v).forEach((k) => {
      if (v[k] === 1 || v[k] === 2) sym[k] = v[k]
    })
    if (!wx.getStorageSync('smh_tip_sym')) {
      wx.setStorageSync('smh_tip_sym', true) // 规格指定的一次性标记（02-UX §3.2 ③）
    }
    this.setData({ symptoms: sym, tipSym: false })
    this.saveField({ symptoms: sym }, 'sym')
  },

  onProteinChange(e) {
    this.setData({ protein: e.detail.value })
    this.saveField({ proteinServings: e.detail.value }, 'protein')
  },

  onWaterChange(e) {
    this.setData({ water: e.detail.value })
    this.saveField({ waterCups: e.detail.value }, 'water')
  },

  onStrengthChange(e) {
    const v = e.detail.value === true
    this.setData({ strength: v })
    this.saveField({ strength: v }, 'strength')
  },

  onFoldToggle() {
    this.setData({ otherOpen: !this.data.otherOpen })
  },

  // ------------------------------------------------------------------
  // 蛋白「?」→ 底部弹出 1 份对照（02-UX §3.2 ③；05-DATA §5.2）
  // ------------------------------------------------------------------
  onProteinHelp() {
    this.setData({ showSheet: true })
  },

  onSheetClose() {
    this.setData({ showSheet: false })
  },

  noop() {},

  // ------------------------------------------------------------------
  // ④ 完成打卡：completeCheckin → checkinFeedback → insight.refresh
  // ------------------------------------------------------------------
  onComplete() {
    if (this.data.readOnly) return
    storage.completeCheckin(this.data.selKey)
    const after = storage.getCheckin(this.data.selKey)
    try { wx.vibrateShort({ type: 'light' }) } catch (e) { /* 部分机型不支持 */ }
    this.setData({ checkin: after })
    this.refreshCalendar()

    let ctx = null
    try { ctx = ai.buildContext(Date.now()) } catch (e) { ctx = null }
    const fallback = () => {
      let text = ''
      try { text = rules.checkinFeedback(after, this._targets, ctx) } catch (e2) { text = '' }
      this.showFeedback(text)
    }
    ai.checkinFeedback(after, this._targets, ctx || undefined)
      .then((text) => this.showFeedback(text || ''))
      .catch(fallback)

    insight.refresh(this._now) // 回今天页时简报/洞察卡随之更新（02-UX §4.2）
  },

  /** 反馈气泡（footer 上方，bubble-ai 样式）→ 3s 后保留为结构化卡顶部一行小字 */
  showFeedback(text) {
    if (!text) return
    this.setData({ feedback: text, feedbackStage: 'bubble' })
    if (this._fbT) clearTimeout(this._fbT)
    this._fbT = setTimeout(() => this.setData({ feedbackStage: 'card' }), 3000)
  },

  // ------------------------------------------------------------------
  // ⑤ 月历（7 列；完成=实心点 / 有记录未完成=空心 / 难受=warning 三角 / 打针=💉）
  // ------------------------------------------------------------------
  refreshCalendar() {
    this._checkins = storage.get(storage.KEYS.CHECKINS) || {} // 每次重读，避免快照过期
    const todayKey = this._todayKey
    const ym = todayKey.slice(0, 7) // 月历固定展示"这个月"（今天所在月）
    const parts = ym.split('-')
    const y = Number(parts[0])
    const m = Number(parts[1])
    const daysInMonth = new Date(y, m, 0).getDate()
    const startWd = new Date(y, m - 1, 1).getDay() // 0=周日（视觉规范首列「日」）

    const cells = []
    let idx = 0
    for (let i = 0; i < startWd; i++) cells.push({ idx: idx++, empty: true })

    let monthDone = 0
    for (let d = 1; d <= daysInMonth; d++) {
      const key = ym + '-' + (d < 10 ? '0' + d : '' + d)
      const c = this._checkins[key]
      const done = !!(c && c.completedAt)
      if (done) monthDone++
      cells.push({
        idx: idx++,
        key,
        d,
        done,
        hasData: !!(c && (c.completedAt || c.updatedAt > 0)),
        bad: !!(c && plan.isBadDay(c)),
        dose: !!this._doseDays[key],
        future: key > todayKey,
        sel: key === this.data.selKey,
      })
    }

    this.setData({
      streakText: '连续 ' + plan.streak(this._checkins, todayKey) + ' 天 · 本月 ' + monthDone + ' 天',
      calCells: cells,
    })
  },

  /** 点日期 → 页面顶部日期切到该日（02-UX §3.2 ⑤） */
  onDayTap(e) {
    const key = e.currentTarget.dataset.key
    if (!key || key > this._todayKey) return
    this.loadDay(key)
    this.refreshCalendar()
    wx.pageScrollTo({ scrollTop: 0, duration: 200 })
  },

  goTrend() {
    wx.navigateTo({ url: '/pages/trend/trend' })
  },

  goSos() {
    wx.navigateTo({ url: '/pages/sos/sos' })
  },
})
