// pages/report — 就诊摘要（docs/02-UX.md §3.9）
const storage = require('../../utils/storage.js')
const plan = require('../../utils/plan.js')
const date = require('../../utils/date.js')
const pk = require('../../utils/pk.js')
const ai = require('../../utils/ai.js')

const KEYS = storage.KEYS

const COND_CN = {
  t2d: '2型糖尿病', insulin_su: '在用胰岛素或磺脲类',
  gallbladder: '胆囊疾病史', pancreatitis: '胰腺炎史',
  mtc_men2: '甲状腺髓样癌/MEN2', pregnancy: '怀孕/哺乳/备孕',
  kidney: '肾脏疾病',
}

const SEX_CN = { female: '女', male: '男', other: '不愿透露' }

function fmt1(n) { return typeof n === 'number' ? (Math.round(n * 10) / 10).toFixed(1) : '—' }
function fmtPct(n) { return typeof n === 'number' ? (Math.round(n * 10) / 10).toFixed(1) + '%' : '—' }
function plus(n) { return n > 0 ? '+' + fmt1(n) : fmt1(n) }

Page({
  data: {
    range: '4w',
    rangeOptions: [{ value: '4w', label: '近 4 周' }, { value: '12w', label: '近 12 周' }, { value: 'all', label: '全部' }],
    sections: [],
    visitQuestions: [],
    hasRecord: false,
    empty: false,
    now: 0,
  },

  onLoad() {
    this._render()
  },

  onShow() {
    this._render()
  },

  async onRefresh() {
    this._render()
  },

  onPickRange(e) {
    this.setData({ range: e.detail.value })
    this._render()
  },

  _rangeDates() {
    const today = date.dateKey(Date.now())
    if (this.data.range === 'all') return { from: null, to: today }
    const days = this.data.range === '4w' ? 28 : 84
    return { from: date.addDays(today, -days + 1), to: today }
  },

  _render() {
    const profile = storage.get(KEYS.PROFILE)
    const med = storage.get(KEYS.MED)
    const doses = storage.get(KEYS.DOSES) || []
    const checkins = storage.get(KEYS.CHECKINS) || {}
    const now = Date.now()
    const { from, to } = this._rangeDates()
    const rangeCheckins = (from === null)
      ? Object.keys(checkins).sort().map((k) => checkins[k])
      : Object.keys(checkins).filter((k) => k >= from && k <= to).sort().map((k) => checkins[k])
    const rangeDoses = (from === null)
      ? doses.slice()
      : doses.filter((d) => {
          const k = date.dateKey(d.timeMs)
          return k >= from && k <= to
        })

    const hasRecord = !!(med && med.medId)
    const medDef = med && med.medId ? pk.MEDS[med.medId] : null
    const medName = medDef ? medDef.name : '—'
    const lw = plan.latestWeight(checkins, profile)
    const start = profile && profile.startWeightKg
    const changeKg = lw && start ? Math.round((lw.kg - start) * 10) / 10 : null
    const rate = plan.weeklyRatePct(checkins, date.dateKey(now), 14)

    // 剂量历史（从 med.history 的 start/dose_change）
    const doseEvents = (med.history || []).filter((e) => e.event === 'start' || e.event === 'dose_change')
    const doseSummary = doseEvents.length
      ? doseEvents.map((e) => e.doseMg + 'mg(' + e.date + ')').join(' → ')
      : (med.currentDoseMg ? med.currentDoseMg + 'mg' : '—')
    const injectWeekday = med.injectWeekday !== null && med.injectWeekday !== undefined
      ? ['','周一','周二','周三','周四','周五','周六','周日'][med.injectWeekday]
      : '—'

    // 注射：应打 = 范围内完整周数（=days/7）；记录 = doses 在范围内条数
    const totalDays = from === null
      ? (doses.length ? Math.max(7, Math.ceil((now - doses[0].timeMs) / 86400000)) : 0)
      : null
    const expectedShots = from === null ? Math.ceil(totalDays / 7) : Math.ceil(((new Date(to.replace(/-/g, '/')).getTime() - new Date(from.replace(/-/g, '/')).getTime()) / 86400000 + 1) / 7)
    const recordedShots = rangeDoses.length

    // 症状统计
    const symMap = {}
    let symptomTotal = 0
    let severeTotal = 0
    for (const c of rangeCheckins) {
      const s = (c && c.symptoms) || {}
      for (const k of Object.keys(s)) {
        symMap[k] = symMap[k] || { days: 0, severe: 0 }
        symMap[k].days++
        symptomTotal++
        if (s[k] === 2) { symMap[k].severe++; severeTotal++ }
      }
    }
    const symList = Object.keys(symMap).map((k) => ({
      name: symptomCn(k),
      days: symMap[k].days,
      severe: symMap[k].severe,
    })).sort((a, b) => b.days - a.days)

    // 打卡情况
    const checkinDays = rangeCheckins.length
    let proteinHit = 0
    let strengthDays = 0
    const targets = plan.computeTargets(profile, lw ? lw.kg : start, 'titrate')
    for (const c of rangeCheckins) {
      if (typeof c.proteinServings === 'number' && c.proteinServings >= targets.proteinServings) proteinHit++
      if (c.strength === true) strengthDays++
    }

    const sections = []
    sections.push({
      title: '基本信息',
      rows: [
        ['性别', profile && SEX_CN[profile.sex] || '—'],
        ['年龄', profile && profile.age ? profile.age + ' 岁' : '—'],
        ['身高', profile && profile.heightCm ? profile.heightCm + ' cm' : '—'],
        ['起始体重', start ? start + ' kg' : '—'],
        ['目标体重', profile && profile.goalWeightKg ? profile.goalWeightKg + ' kg' : '—'],
        ['合并情况', profile && profile.conditions && profile.conditions.length ? profile.conditions.map((c) => COND_CN[c] || c).join('、') : '无'],
      ],
    })
    sections.push({
      title: '用药',
      rows: [
        ['当前药物', medName],
        ['开始日期', med.startDate || '—'],
        ['剂量序列', doseSummary],
        ['每周打针', injectWeekday],
      ],
    })
    sections.push({
      title: '注射记录',
      rows: [['应打 / 记录', expectedShots + ' 针 / ' + recordedShots + ' 针']],
    })
    sections.push({
      title: '体重',
      rows: [
        ['起始 → 现在', start && lw ? (start + ' → ' + lw.kg + ' kg（' + plus(changeKg) + ' kg）') : '—'],
        ['近两周速度', rate !== null ? ('- ' + Math.round(Math.abs(rate) * 10) / 10 + '% / 周') : '—'],
      ],
    })
    sections.push({
      title: '不良反应',
      rows: symList.length ? symList.map((s) => [s.name, s.days + ' 天（其中重度 ' + s.severe + ' 天）']) : [['近期未记录明显不良反应', '']],
    })
    sections.push({
      title: '打卡情况',
      rows: [
        ['打卡天数', checkinDays + ' 天'],
        ['蛋白达标', proteinHit + ' 天'],
        ['力量训练', strengthDays + ' 次'],
      ],
    })

    this.setData({
      sections,
      hasRecord,
      empty: !hasRecord,
      now,
      nowLabel: date.friendly(now),
      visitQuestions: [],
    })

    // 复诊问题：先渲染规则版，再异步 LLM 替换
    try {
      const ai0 = require('../../utils/rules.js')
      const ctx0 = ai.buildContext(now)
      const rq = ai0.visitQuestions(ctx0)
      this.setData({ visitQuestions: rq })
      ai.visitQuestions(ctx0).then((lq) => {
        if (lq && lq.length && JSON.stringify(lq) !== JSON.stringify(rq)) {
          this.setData({ visitQuestions: lq })
        }
      }).catch(() => {})
    } catch (e) {}
  },

  onCopy() {
    const lines = []
    lines.push('【司美助手 · 就诊摘要】生成于 ' + date.friendly(this.now))
    lines.push('数据范围：' + this.data.range)
    for (const sec of this.data.sections) {
      lines.push('【' + sec.title + '】')
      for (const r of sec.rows) lines.push(r[0] + (r[1] ? '：' + r[1] : ''))
    }
    if (this.data.visitQuestions.length) {
      lines.push('【想问医生的问题】')
      this.data.visitQuestions.forEach((q, i) => lines.push((i + 1) + '. ' + q))
    }
    lines.push('由用户自行记录，仅供参考。')
    wx.setClipboardData({
      data: lines.join('\n'),
      success: () => wx.showToast({ title: '已复制，可以粘贴给医生', icon: 'none' }),
    })
  },

  onShareHint() {
    wx.showToast({ title: '截个屏就能保存这一页', icon: 'none' })
  },
})

function symptomCn(k) {
  return ({
    nausea: '恶心', vomiting: '呕吐', diarrhea: '腹泻', constipation: '便秘',
    reflux: '反酸', bloating: '胀气', fatigue: '乏力', dizziness: '头晕', hair_loss: '脱发',
  })[k] || k
}