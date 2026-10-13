// pages/plan — 用药方案（docs/02-UX.md §3.7 / docs/05-DATA.md §2.4）
const storage = require('../../utils/storage.js')
const plan = require('../../utils/plan.js')
const pk = require('../../utils/pk.js')
const date = require('../../utils/date.js')

const KEYS = storage.KEYS
const H = 3600000

const MED_OPTS = Object.keys(pk.MEDS).map((id) => ({ value: id, label: pk.MEDS[id].name }))

const EVENT_LABEL = {
  start: (e) => '开始 ' + (pk.MEDS[e.medId] ? pk.MEDS[e.medId].name : e.medId) + ' ' + (e.doseMg || '') + 'mg',
  dose_change: (e) => '剂量调整为 ' + e.doseMg + 'mg',
  pause: () => '暂停用药',
  resume: () => '恢复用药',
  switch: (e) => '换用 ' + (pk.MEDS[e.medId] ? pk.MEDS[e.medId].name : e.medId),
  taper: () => '开始减量',
  stop: () => '停药',
}

Page({
  data: {
    draft: {
      status: 'considering', medId: '', brand: '', currentDoseMg: null,
      startDate: '', injectWeekday: null, doctor: '', hospital: '',
      nextVisitDate: '',
    },
    medOptions: MED_OPTS,
    doseOptions: [], doseLabels: [],
    statusOptions: [
      { value: 'considering', label: '还在了解' },
      { value: 'prescribed', label: '已开药未开始' },
      { value: 'active', label: '正在用' },
      { value: 'tapering', label: '在减量' },
      { value: 'stopped', label: '已停药' },
    ],
    weekdayOptions: [
      { value: 1, label: '周一' }, { value: 2, label: '周二' }, { value: 3, label: '周三' },
      { value: 4, label: '周四' }, { value: 5, label: '周五' }, { value: 6, label: '周六' },
      { value: 0, label: '周日' },
    ],
    injectWeekdayLabel: '',
    calendarAdded: { inject: false, visit: false, checkin: false },
    history: [],
    canSave: false,
    settings: null,
    showInjectCard: false,
    showVisitCard: false,
    showCheckinCard: false,
    today: date.dateKey(Date.now()),
    dailyCheckinAdded: false,
  },

  onLoad() {
    this._load()
  },

  onShow() {
    this._load()
  },

  _load() {
    const med = storage.get(KEYS.MED)
    const settings = storage.get(KEYS.SETTINGS)
    const medId = med.medId || ''
    const medDef = pk.MEDS[medId]
    const doseOptions = medDef ? medDef.doseOptionsMg.map((mg) => ({ value: mg, label: mg + 'mg' })) : []
    const draft = {
      status: med.status || 'considering',
      medId,
      brand: med.brand || '',
      currentDoseMg: med.currentDoseMg,
      startDate: med.startDate || '',
      injectWeekday: med.injectWeekday,
      doctor: (med.doctor && med.doctor.name) || '',
      hospital: (med.doctor && med.doctor.hospital) || '',
      nextVisitDate: med.nextVisitDate || '',
    }
    const history = (med.history || []).slice().reverse().map((e) => ({
      date: e.date, label: (EVENT_LABEL[e.event] && EVENT_LABEL[e.event](e)) || (e.event || ''),
    }))
    this.setData({
      draft,
      medId,
      doseOptions,
      injectWeekdayLabel: draft.injectWeekday !== null && draft.injectWeekday !== undefined
        ? ({0:'周日',1:'周一',2:'周二',3:'周三',4:'周四',5:'周五',6:'周六'}[draft.injectWeekday])
        : '',
      calendarAdded: Object.assign({ inject: false, visit: false, checkin: false }, med.calendarAdded || {}),
      history,
      settings,
      canSave: !!(draft.medId),
      showInjectCard: !!draft.injectWeekday,
      showVisitCard: !!draft.nextVisitDate,
      showCheckinCard: !!(settings && settings.reminders && settings.reminders.dailyCheckin),
      dailyCheckinAdded: !!(med.calendarAdded && med.calendarAdded.checkin),
    })
  },

  // ---- 选择事件 ----

  onPickStatus(e) { this._patchDraft({ status: e.detail.value }); this._load() },
  onPickMed(e) {
    const v = e.detail.value
    const patch = { medId: v, brand: '' }
    if (v !== this.data.draft.medId) patch.currentDoseMg = null
    this._patchDraft(patch)
    this._load()
  },
  onPickDose(e) {
    const mg = e.detail.value
    if (typeof mg !== 'number' || !(mg > 0)) return
    this._patchDraft({ currentDoseMg: mg })
  },
  onPickInjectDay(e) { this._patchDraft({ injectWeekday: e.detail.value }); this._load() },
  onBrandInput(e) { this._patchDraft({ brand: e.detail.value }) },
  onStartDate(e) { this._patchDraft({ startDate: e.detail.value }) },
  onVisitDate(e) { this._patchDraft({ nextVisitDate: e.detail.value }); this._load() },
  onDoctorInput(e) { this._patchDraft({ doctor: e.detail.value }) },
  onHospitalInput(e) { this._patchDraft({ hospital: e.detail.value }) },

  _patchDraft(p) {
    const d = Object.assign({}, this.data.draft, p)
    this.setData({ draft: d, canSave: !!d.medId })
  },

  // ---- 保存 ----

  onSave() {
    if (!this.data.canSave) return
    const d = this.data.draft
    const cur = storage.get(KEYS.MED)
    const patch = {
      status: d.status,
      medId: d.medId,
      brand: d.brand,
      currentDoseMg: d.currentDoseMg,
      doseSince: d.currentDoseMg !== cur.currentDoseMg ? date.dateKey(Date.now()) : cur.doseSince,
      startDate: d.startDate || null,
      injectWeekday: d.injectWeekday,
      doctor: { name: d.doctor, hospital: d.hospital },
      nextVisitDate: d.nextVisitDate || null,
    }
    const events = []
    const today = date.dateKey(Date.now())
    if (!cur.medId && d.medId) {
      events.push({ date: today, event: 'start', medId: d.medId, doseMg: d.currentDoseMg, note: '' })
    }
    if (cur.medId && d.medId && cur.medId !== d.medId) {
      events.push({ date: today, event: 'switch', medId: d.medId, doseMg: d.currentDoseMg, note: '' })
    }
    if (cur.currentDoseMg && d.currentDoseMg && cur.currentDoseMg !== d.currentDoseMg && d.status === 'active') {
      events.push({ date: today, event: 'dose_change', medId: d.medId, doseMg: d.currentDoseMg, note: '' })
    }
    if (cur.status !== d.status) {
      if (d.status === 'tapering') events.push({ date: today, event: 'taper', medId: d.medId, doseMg: d.currentDoseMg, note: '' })
      if (d.status === 'stopped') {
        const lw = plan.latestWeight(storage.get(KEYS.CHECKINS) || {}, storage.get(KEYS.PROFILE))
        patch.stopWeightKg = lw ? lw.kg : null
        patch.stopDate = today
        events.push({ date: today, event: 'stop', medId: d.medId, doseMg: d.currentDoseMg, note: '' })
      }
      if (cur.status === 'tapering' && d.status === 'active') events.push({ date: today, event: 'resume', medId: d.medId, doseMg: d.currentDoseMg, note: '' })
    }
    storage.saveMed(patch, null)
    for (const ev of events) storage.saveMed({}, ev)
    wx.showToast({ title: '已保存', icon: 'success' })
    setTimeout(() => wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/today/today' }) }), 300)
  },

  // ---- 日历 ----

  onAddInjectCal() {
    const wd = this.data.draft.injectWeekday
    if (wd === null || wd === undefined) {
      wx.showToast({ title: '先设一个打针日', icon: 'none' })
      return
    }
    const startMs = nextWeekdayAt(wd, 9)
    wx.addPhoneRepeatCalendar({
      title: '💉 今天是打针日',
      startTime: Math.floor(startMs / 1000),
      description: '打完记得在司美助手里记一下',
      repeatInterval: 'week',
      alarm: true,
      alarmOffset: 0,
      success: () => {
        const cur = storage.get(KEYS.MED)
        cur.calendarAdded = Object.assign({}, cur.calendarAdded, { inject: true })
        storage.set(KEYS.MED, cur)
        wx.showToast({ title: '已加到手机日历', icon: 'none' })
        this._load()
      },
      fail: () => wx.showToast({ title: '没加上也没关系，打开小程序时我会提醒你', icon: 'none' }),
    })
  },

  onAddVisitCal() {
    const k = this.data.draft.nextVisitDate
    if (!k) {
      wx.showToast({ title: '先填一个复诊日', icon: 'none' })
      return
    }
    const startMs = new Date(k.replace(/-/g, '/') + ' 08:00').getTime()
    wx.addPhoneCalendar({
      title: '🏥 复诊日：带上就诊摘要',
      startTime: Math.floor(startMs / 1000),
      allDay: false,
      alarm: true,
      alarmOffset: 86400,
      success: () => {
        const cur = storage.get(KEYS.MED)
        cur.calendarAdded = Object.assign({}, cur.calendarAdded, { visit: true })
        storage.set(KEYS.MED, cur)
        wx.showToast({ title: '已加到手机日历', icon: 'none' })
        this._load()
      },
      fail: () => wx.showToast({ title: '没加上也没关系', icon: 'none' }),
    })
  },

  onToggleDailyCheckin(e) {
    const on = !!e.detail.value
    const settings = storage.get(KEYS.SETTINGS)
    settings.reminders = Object.assign({}, settings.reminders, { dailyCheckin: on })
    settings.updatedAt = Date.now()
    storage.set(KEYS.SETTINGS, settings)
    if (on) {
      const startSec = Math.floor((new Date().getHours() < 21 ? nextSameHourAt(21) : nextSameHourAt(21)) / 1000)
      wx.addPhoneRepeatCalendar({
        title: '🌱 花 30 秒和小美打个卡',
        startTime: startSec,
        repeatInterval: 'day',
        alarm: true,
        alarmOffset: 0,
        success: () => {
          const cur = storage.get(KEYS.MED)
          cur.calendarAdded = Object.assign({}, cur.calendarAdded, { checkin: true })
          storage.set(KEYS.MED, cur)
          wx.showToast({ title: '已加到手机日历', icon: 'none' })
        },
        fail: () => wx.showToast({ title: '打开小程序时我会提醒你', icon: 'none' }),
      })
    }
    this._load()
  },
})

function nextWeekdayAt(weekday, hour) {
  const now = new Date()
  for (let i = 0; i < 8; i++) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i, hour, 0, 0, 0)
    if (d.getTime() > now.getTime() && d.getDay() === weekday) return d.getTime()
  }
  return now.getTime()
}
function nextSameHourAt(hour) {
  const now = new Date()
  let d = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, 0, 0, 0)
  if (d.getTime() <= now.getTime()) d = new Date(d.getTime() + 86400000)
  return d.getTime()
}