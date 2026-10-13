// pages/dose — 记录注射（docs/02-UX.md §3.5 / docs/05-DATA.md §2.4-2.5, §5.4-5.5）
const storage = require('../../utils/storage.js')
const plan = require('../../utils/plan.js')
const pk = require('../../utils/pk.js')
const date = require('../../utils/date.js')
const insight = require('../../utils/insight.js')

const KEYS = storage.KEYS
const H = 3600000

function pad2(n) { return n < 10 ? '0' + n : '' + n }

Page({
  data: {
    med: null,
    medOptions: [],      // [{value,label}] 三药
    medId: '',
    doseOptions: [],     // ['0.25mg', ...]
    doseMg: null,
    todayKey: '',
    dateValue: '',       // picker 显示 YYYY-MM-DD
    dateMax: '',         // picker 上界：固定为今天，永不随选中日期回退（补录历史针时上界不能收缩）
    timeValue: '',       // picker 显示 HH:mm
    timeMs: 0,
    sites: [],           // [{key,name,lastText,recommended,selected}]
    nextSiteKey: '',
    nextSiteName: '',
    note: '',
    recent: [],          // 最近 5 针 [{id,text,timeMs}]
    canSave: false,
  },

  onLoad() {
    const med = storage.get(KEYS.MED)
    const doses = storage.get(KEYS.DOSES) || []
    const medOptions = Object.keys(pk.MEDS).map((id) => ({ value: id, label: pk.MEDS[id].name }))
    const medId = med.medId || ''
    const now = new Date()
    this._draft = {
      medId,
      doseMg: med.currentDoseMg || null,
      dateValue: date.dateKey(now.getTime()),
      timeValue: pad2(now.getHours()) + ':' + pad2(now.getMinutes()),
    }
    this.setData({
      med,
      medOptions,
      dateValue: this._draft.dateValue,
      dateMax: this._draft.dateValue,   // onLoad 时 _draft.dateValue 就是今天
      timeValue: this._draft.timeValue,
    })
    this._rebuild()
  },

  onShow() {
    this._rebuild()
  },

  _rebuild() {
    const med = storage.get(KEYS.MED)
    const doses = storage.get(KEYS.DOSES) || []
    const medId = this._draft.medId
    const medDef = pk.MEDS[medId]
    const doseOptions = medDef ? medDef.doseOptionsMg.map((mg) => ({ value: mg, label: mg + 'mg' })) : []
    const timeMs = this._composeTimeMs()
    const last = siteLastUsedOf(doses)
    const recommended = medId ? plan.nextSite(doses) : ''
    const sites = plan.SITES.map((s) => {
      const lastMs = last[s.key]
      return {
        key: s.key,
        name: s.name,
        lastText: lastMs ? '上次 ' + date.friendly(lastMs, Date.now()).replace('今天 ', '').replace('昨天 ', '') : '没用过',
        recommended: s.key === recommended,
        selected: s.key === this._draft.siteKey,
      }
    })
    const recent = doses.slice(-5).reverse().map((d) => ({
      id: d.id,
      timeMs: d.timeMs,
      text: date.friendly(d.timeMs, Date.now()) + ' · ' + (d.doseMg || '?') + 'mg · ' + plan.siteName(d.site),
    }))
    const dv = this._draft.dateValue || date.dateKey(Date.now())
    const dvDate = new Date(dv.replace(/-/g, '/'))
    const dateLabel = (dvDate.getMonth() + 1) + '月' + dvDate.getDate() + '日 ' + date.weekdayCn(dvDate.getDay())
    this.setData({
      med,
      medId,
      medName: medDef ? medDef.name : '',
      dateValue: dv,                    // 与 dateLabel 保持一致：picker 打开时停在已选日期上
      dateMax: date.dateKey(Date.now()), // 上界恒为「今天」，只向前推进（跨零点刷新），不随 dv 回退
      dateLabel,
      doseOptions,
      doseMg: this._draft.doseMg,
      timeMs,
      sites,
      nextSiteKey: recommended,
      nextSiteName: recommended ? plan.siteName(recommended) : '',
      recent,
      canSave: !!(medId && this._draft.doseMg && this._draft.siteKey && timeMs),
    })
  },

  _composeTimeMs() {
    const d = this._draft.dateValue || date.dateKey(Date.now())
    const parts = (this._draft.timeValue || '09:00').split(':')
    const ms = new Date(d.replace(/-/g, '/')).getTime() + parseInt(parts[0], 10) * H + parseInt(parts[1], 10) * 60000
    return ms > Date.now() ? Date.now() : ms
  },

  // ---- 事件 ----

  onPickMed(e) {
    const medId = e.detail.value
    if (medId === this._draft.medId) return
    this._draft.medId = medId
    // 换药时剂量默认取该药第一档，部位推荐会随 doses 自动重算
    const medDef = pk.MEDS[medId]
    this._draft.doseMg = medDef ? medDef.doseOptionsMg[0] : null
    this._rebuild()
  },

  onPickDose(e) {
    const mg = e.detail.value
    if (typeof mg !== 'number' || !(mg > 0)) return
    if (mg === this._draft.doseMg) return
    this._draft.doseMg = mg
    this._rebuild()
  },

  onPickDate(e) {
    this._draft.dateValue = e.detail.value
    this._rebuild()
  },

  onPickTime(e) {
    this._draft.timeValue = e.detail.value
    this._rebuild()
  },

  onPickSite(e) {
    const key = e.currentTarget.dataset.key
    this._draft.siteKey = key
    this._rebuild()
  },

  onNote(e) {
    this._draft.note = e.detail.value
  },

  onSave() {
    if (!this.data.canSave) return
    const med = storage.get(KEYS.MED)
    const doses = storage.get(KEYS.DOSES) || []
    const { medId, doseMg } = this._draft
    const timeMs = this._composeTimeMs()
    const prev = doses.length ? doses[doses.length - 1] : null
    if (prev) {
      const warn = plan.doseIntervalWarn(medId, prev.timeMs, timeMs)
      if (warn.warn) {
        const days = Math.max(1, Math.round(warn.minH / 24))
        wx.showModal({
          title: '距离上一针才 ' + Math.floor(warn.hours) + ' 小时',
          content: '两针之间一般至少间隔 ' + days + ' 天（' + warn.minH + ' 小时）。确认要现在记录吗？',
          confirmText: '确认记录',
          cancelText: '再想想',
          success: (r) => { if (r.confirm) this._save(timeMs) },
        })
        return
      }
    }
    // 剂量与方案不一致 → 确认是否更新方案
    if (med.currentDoseMg && doseMg !== med.currentDoseMg) {
      wx.showModal({
        title: '医生给你调整剂量了吗？',
        content: '本次记录 ' + doseMg + 'mg，与当前方案 ' + med.currentDoseMg + 'mg 不一致。',
        confirmText: '是，更新方案',
        cancelText: '只是这次',
        success: (r) => this._save(timeMs, r.confirm),
      })
      return
    }
    this._save(timeMs, false)
  },

  _save(timeMs, updatePlanDose) {
    const med = storage.get(KEYS.MED)
    const { medId, doseMg, siteKey, note } = this._draft
    const todayKey = date.dateKey(timeMs)

    // §Q1：补录更早或夹在中间的针时，与「所有历史针」取绝对时间差最小值来判定间隔
    const allDoses = (storage.get(KEYS.DOSES) || []).filter((d) => d && d.timeMs && d.timeMs < timeMs)
    const prev = allDoses.length ? allDoses.reduce((m, d) => (Math.abs(timeMs - d.timeMs) < Math.abs(timeMs - m.timeMs) ? d : m)) : null
    if (prev) {
      const warn = plan.doseIntervalWarn(medId, prev.timeMs, timeMs)
      if (warn.warn) {
        const days = Math.max(1, Math.round(warn.minH / 24))
        const pending = { medId, doseMg, timeMs, siteKey, note, updatePlanDose }
        this._pendingSave = pending
        wx.showModal({
          title: '距离上一针才 ' + Math.floor(warn.hours) + ' 小时',
          content: '两针之间一般至少间隔 ' + days + ' 天（' + warn.minH + ' 小时）。确认要现在记录吗？',
          confirmText: '确认记录',
          cancelText: '再想想',
          success: (r) => {
            if (!r.confirm) { this._pendingSave = null; return }
            // §Q2：间隔确认后继续走剂量校验
            this._afterIntervalConfirm(pending)
          },
        })
        return
      }
    }
    this._afterIntervalConfirm({ medId, doseMg, timeMs, siteKey, note, updatePlanDose })
  },

  _afterIntervalConfirm(p) {
    const med = storage.get(KEYS.MED)
    if (med.currentDoseMg && p.doseMg !== med.currentDoseMg) {
      this._pendingSave = p
      wx.showModal({
        title: '医生给你调整剂量了吗？',
        content: '本次记录 ' + p.doseMg + 'mg，与当前方案 ' + med.currentDoseMg + 'mg 不一致。',
        confirmText: '是，更新方案',
        cancelText: '只是这次',
        success: (r) => {
          const updatePlanDose = !!r.confirm
          this._commit(Object.assign({}, p, { updatePlanDose }))
        },
      })
      return
    }
    this._commit(Object.assign({}, p, { updatePlanDose: false }))
  },

  _commit(p) {
    const med = storage.get(KEYS.MED)
    const { medId, doseMg, timeMs, siteKey, note, updatePlanDose } = p
    const todayKey = date.dateKey(timeMs)
    storage.addDose({ medId, doseMg, timeMs, site: siteKey, note: note || '' })
    if (med.status === 'prescribed' || med.status === 'considering') {
      storage.saveMed(
        { status: 'active', medId, startDate: todayKey, currentDoseMg: doseMg, doseSince: todayKey },
        { date: todayKey, event: 'start', medId, doseMg, note: '' }
      )
    } else if (updatePlanDose && doseMg !== med.currentDoseMg) {
      storage.saveMed(
        { currentDoseMg: doseMg, doseSince: todayKey },
        { date: todayKey, event: 'dose_change', medId, doseMg, note: '' }
      )
    } else if (!med.medId) {
      storage.saveMed({ medId }, null)
    }
    wx.showToast({ title: '记好了 ✓', icon: 'success' })
    insight.refresh()
    this._maybeAskCalendar(med)
  },

  _maybeAskCalendar(med) {
    const settings = storage.get(KEYS.SETTINGS)
    if (med.calendarAdded && med.calendarAdded.inject) { this._back(); return }
    if (settings.reminders && settings.reminders.askedCalendar) { this._back(); return }
    wx.showModal({
      title: '要把每周打针日加到手机日历吗？',
      content: '会在你设定的打针日早上 9 点提醒你。',
      confirmText: '加一下',
      cancelText: '先不用',
      success: (r) => {
        if (r.confirm) {
          const cur = storage.get(KEYS.MED)
          const weekday = typeof cur.injectWeekday === 'number' ? cur.injectWeekday : 1
          const startSec = Math.floor(this._nextWeekdayAt(weekday, 9) / 1000)
          wx.addPhoneRepeatCalendar({
            title: '💉 今天是打针日',
            startTime: startSec,
            description: '打完记得在司美助手里记一下',
            repeatInterval: 'week',
            alarm: true,
            alarmOffset: 0,
            success: () => {
              // §Q3：先展开原有的 calendarAdded，避免把 visit/checkin 标记覆盖掉
              const curMed = storage.get(KEYS.MED)
              storage.saveMed({ calendarAdded: Object.assign({}, curMed.calendarAdded, { inject: true }) }, null)
              wx.showToast({ title: '已加到手机日历', icon: 'none' })
            },
            fail: () => wx.showToast({ title: '没加上也没关系，打开小程序时我会提醒你', icon: 'none' }),
          })
        }
        const cur = storage.get(KEYS.SETTINGS)
        cur.reminders = cur.reminders || {}
        cur.reminders.askedCalendar = true
        cur.updatedAt = Date.now()
        storage.set(KEYS.SETTINGS, cur)
        this._back()
      },
    })
  },

  /** 下一个 weekday（0=周日）的 hour 点（本地时间） */
  _nextWeekdayAt(weekday, hour) {
    const now = new Date()
    for (let i = 0; i < 8; i++) {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i, hour, 0, 0, 0)
      if (d.getTime() > now.getTime() && d.getDay() === weekday) return d.getTime()
    }
    return now.getTime()
  },

  _back() {
    setTimeout(() => wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/today/today' }) }), 400)
  },

  onRecentLongPress(e) {
    const id = e.currentTarget.dataset.id
    wx.showActionSheet({
      itemList: ['删除这条'],
      success: (r) => {
        if (r.tapIndex !== 0) return
        wx.showModal({
          title: '删除这条注射记录？',
          content: '删除后无法恢复。',
          confirmText: '删除',
          confirmColor: '#D14343',
          success: (m) => {
            if (!m.confirm) return
            storage.deleteDose(id)
            this._rebuild()
          },
        })
      },
    })
  },
})

function siteLastUsedOf(doses) {
  const map = {}
  for (const s of plan.SITES) map[s.key] = null
  for (const d of doses || []) {
    if (d && d.site && (map[d.site] === null || d.timeMs > map[d.site])) map[d.site] = d.timeMs
  }
  return map
}
