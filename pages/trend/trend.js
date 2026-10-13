// pages/trend/trend.js — 体重趋势（02-UX §3.6）
// 范围分段（4 周/12 周/全部）→ 统计 2×2 + line-chart full + 小美解读卡
// 数据只读：storage / plan；markers 来自 med.history 的 dose_change 与 stop 事件
const app = getApp()
const storage = require('../../utils/storage.js')
const plan = require('../../utils/plan.js')
const date = require('../../utils/date.js')

const RANGES = {
  w4: { days: 28 },
  w12: { days: 84 },
  all: { days: 0 }, // 0 = 不限
}

// 速度分档 → 统计格词 + 解读句 + 问小美问题（05-DATA §5.3 / 02-UX §3.6）
const BAND_TEXT = {
  flat: {
    word: '持平/回升',
    sentence: '最近持平，别只看秤，也量量腰围。',
    ask: '最近体重不掉了，是平台期吗？怎么办？',
  },
  steady: {
    word: '稳',
    sentence: '节奏很好，保持现在的蛋白和运动就行。',
    ask: '我的减重速度正常吗？怎么保持？',
  },
  fastish: {
    word: '偏快一点',
    sentence: '速度不错，记得蛋白和力量跟上。',
    ask: '减重速度偏快一点，蛋白和力量训练怎么跟上？',
  },
  fast: {
    word: '有点快',
    sentence: '这两周掉得有点快，注意蛋白和力量，防止掉肌肉。',
    ask: '我这两周掉秤有点快，需要担心吗？',
  },
  // 14 天内体重点不足 3 个，weeklyRatePct 为 null 时的兜底文案
  none: {
    word: '',
    sentence: '再记几次体重，小美就能帮你分析节奏了。',
    ask: '刚开始记录体重，怎样记录对减重最有帮助？',
  },
}

/** 全部体重点 [{date, kg}]，按日期升序 */
function allWeightPoints() {
  const map = storage.get(storage.KEYS.CHECKINS) || {}
  return Object.keys(map)
    .sort()
    .filter((k) => typeof map[k].weightKg === 'number')
    .map((k) => ({ date: k, kg: map[k].weightKg }))
}

function fmt1(n) {
  return (Math.round(n * 10) / 10).toFixed(1)
}

/** med.history → 图表 markers（dose_change 标「2.5→5mg」、stop 标「停药」） */
function buildMarkers(history) {
  const out = []
  let prevDose = null
  for (const h of history || []) {
    if (h.event === 'dose_change' && typeof h.doseMg === 'number') {
      out.push({
        date: h.date,
        label: prevDose !== null ? prevDose + '→' + h.doseMg + 'mg' : h.doseMg + 'mg',
      })
    } else if (h.event === 'stop') {
      out.push({ date: h.date, label: '停药' })
    }
    if (typeof h.doseMg === 'number') prevDose = h.doseMg
  }
  return out
}

Page({
  data: {
    range: 'w12', // 默认 12 周
    // 统计 2×2
    startText: '--',
    currentText: '--',
    changeText: '', // 「-3.6kg」
    changePctText: '', // 「-3.9%」
    rateText: '--',
    band: 'none',
    bandWord: '',
    // 图表
    points: [],
    avg: [],
    markers: [],
    goal: null,
    empty: true,
    needMore: 2,
    // 解读卡
    bandSentence: BAND_TEXT.none.sentence,
  },

  onShow() {
    this.refresh()
  },

  refresh() {
    const todayKey = date.dateKey(Date.now())
    const profile = storage.get('smh_profile')
    const med = storage.get('smh_med')
    const checkins = storage.get(storage.KEYS.CHECKINS) || {}

    const all = allWeightPoints()
    const days = RANGES[this.data.range].days
    const fromKey = days > 0 ? date.addDays(todayKey, -(days - 1)) : null
    const points = fromKey ? all.filter((p) => p.date >= fromKey) : all
    const empty = points.length < 2

    // 统计：起始 = 档案起始体重（缺省回落首个点）；当前 = 最近体重
    let startKg = profile && typeof profile.startWeightKg === 'number' ? profile.startWeightKg : null
    if (startKg === null && all.length) startKg = all[0].kg
    const latest = plan.latestWeight(checkins, profile)
    const currentKg = latest ? latest.kg : null

    let changeText = ''
    let changePctText = ''
    if (startKg !== null && currentKg !== null) {
      changeText = fmt1(currentKg - startKg) + 'kg'
      changePctText = fmt1(((currentKg - startKg) / startKg) * 100) + '%'
    }

    const rate = plan.weeklyRatePct(checkins, todayKey, 14)
    const band = rate === null ? 'none' : plan.rateBand(rate)
    const bt = BAND_TEXT[band]

    const markers = buildMarkers(med && med.history)
      .filter((m) => !fromKey || m.date >= fromKey)

    this.setData({
      startText: startKg !== null ? fmt1(startKg) : '--',
      currentText: currentKg !== null ? fmt1(currentKg) : '--',
      changeText,
      changePctText,
      rateText: rate === null ? '--' : fmt1(rate),
      band,
      bandWord: bt.word,
      bandSentence: bt.sentence,
      points,
      avg: empty ? [] : plan.movingAvg(points, 7),
      markers,
      goal: profile && typeof profile.goalWeightKg === 'number' ? profile.goalWeightKg : null,
      empty,
      needMore: Math.max(1, 2 - points.length),
    })
  },

  onRange(e) {
    const range = e.currentTarget.dataset.range
    if (!range || range === this.data.range) return
    this.setData({ range })
    this.refresh()
  },

  /** 解读卡「问小美 ›」：带分档问题切到小美页 */
  goAsk() {
    app.globalData.pendingAsk = BAND_TEXT[this.data.band].ask
    wx.switchTab({ url: '/pages/chat/chat' })
  },

  /** 底部「记今天的体重 ›」：切到记录页并聚焦体重行 */
  goLog() {
    app.globalData.focusField = 'weight'
    wx.switchTab({ url: '/pages/log/log' })
  },
})
