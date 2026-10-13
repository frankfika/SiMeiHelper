// pages/today — 今天页（docs/02-UX.md §3.1 / docs/05-DATA.md §9）
// onShow 全流程：ctx → 简报（缓存/hash → 规则版同步 → LLM 异步替换，3 次/天上限）
// → insight.refresh() → 药物卡 4 形态 → 体重小卡 → 阶段指南卡
const storage = require('../../utils/storage.js')
const plan = require('../../utils/plan.js')
const pk = require('../../utils/pk.js')
const date = require('../../utils/date.js')
const rules = require('../../utils/rules.js')
const insight = require('../../utils/insight.js')

// ai.js / kb.js 由并行任务交付；require 失败时页面按规则版降级，不阻塞
let ai = null
try { ai = require('../../utils/ai.js') } catch (e) { ai = null }
let kb = null
try { kb = require('../../data/kb.js') } catch (e) { kb = null }

const KEYS = storage.KEYS

// 阶段 pill 点击 toast（01-PRD §4.1「用户此时最大的问题」改写为陈述）
const STAGE_TOAST = {
  explore: '观望期：先了解清楚适不适合你，再和医生一起决定。',
  start: '起始期：身体在适应药物，重点是打针、蛋白和水分。',
  titrate: '递增期：身体在适应更高剂量，重点是蛋白和力量。',
  plateau: '平台期：体重在休息不是你的错，先检查蛋白、力量和睡眠。',
  maintain: '维持期：守住体重就是赢，蛋白、力量和每周称重是关键。',
}

const EXPLORE_CHECKLIST = [
  { id: 'kb_fit', text: '了解这药适不适合我' },
  { id: 'kb_prepare', text: '看看开始前要准备什么' },
  { id: 'kb_special', text: '特殊情况须知' },
]
const PRESCRIBED_CHECKLIST = [
  { id: 'kb_first_shot', text: '第一针怎么打' },
  { id: 'kb_prepare', text: '看看开始前要准备什么' },
  { id: 'kb_special', text: '特殊情况须知' },
]

function fmt1(n) {
  return (Math.round(n * 10) / 10).toFixed(1)
}
function signed1(n) {
  return (n > 0 ? '+' : '') + fmt1(n)
}
function greetingWord(hour) {
  if (hour >= 5 && hour < 11) return '早上好'
  if (hour >= 11 && hour < 13) return '中午好'
  if (hour >= 13 && hour < 18) return '下午好'
  return '晚上好'
}
function clamp01(n) {
  return Math.max(0, Math.min(100, n))
}
/** 是否打针日：daysToNextDose ≤ 0，或今天星期 = 设定打针日且今天没有注射记录（§6.6） */
function computeIsDoseDay(ctx, todayKey, injectedToday) {
  if (injectedToday) return false
  const pkInfo = ctx.pk || {}
  const medInfo = ctx.med || {}
  if (typeof pkInfo.daysToNextDose === 'number' && pkInfo.daysToNextDose <= 0) return true
  if (typeof medInfo.injectWeekday === 'number') {
    return new Date(date.parseKey(todayKey)).getDay() === medInfo.injectWeekday
  }
  return false
}

/** ai.js 不可用时的本地降级 ctx（字段同 05-DATA §6.5，取页面用到的子集） */
function buildLocalCtx(now) {
  const profile = storage.get('smh_profile')
  const med = storage.get('smh_med') || {}
  const doses = storage.get('smh_doses') || []
  const checkins = storage.get('smh_checkins') || {}
  const todayKey = date.dateKey(now)
  const stage = plan.computeStage(med, checkins, now)
  const latest = plan.latestWeight(checkins, profile)
  const latestKg = latest ? latest.kg : null
  const startKg = profile && typeof profile.startWeightKg === 'number' ? profile.startWeightKg : null
  const targets = plan.computeTargets(profile, latestKg, stage.key)
  const lastDose = doses.length ? doses[doses.length - 1] : null
  const ph = lastDose ? pk.phase(lastDose.timeMs, now) : null
  const nextMs = lastDose ? pk.nextDoseMs(lastDose) : null
  const nextDoseKey = nextMs ? date.dateKey(nextMs) : null
  const medConst = med.medId ? pk.MEDS[med.medId] : null
  const today = storage.getCheckin(todayKey)

  const last7 = { strengthCount: 0, checkinDays: 0 }
  for (let i = 0; i < 7; i++) {
    const c = checkins[date.addDays(todayKey, -i)]
    if (!c) continue
    last7.checkinDays++
    if (c.strength === true) last7.strengthCount++
  }

  return {
    now,
    todayKey,
    hour: new Date(now).getHours(),
    name: (profile && profile.nickname) || '',
    latestWeightKg: latestKg,
    profile: {
      sex: profile ? profile.sex : null,
      heightCm: profile ? profile.heightCm : null,
      goalWeightKg: profile ? profile.goalWeightKg : null,
      conditions: (profile && profile.conditions) || [],
    },
    stage,
    med: {
      status: med.status || 'considering',
      medId: med.medId || null,
      medName: medConst ? medConst.name : '',
      doseMg: med.currentDoseMg || null,
      daysOnDose: med.doseSince ? date.daysBetween(med.doseSince, todayKey) : null,
      injectWeekday: typeof med.injectWeekday === 'number' ? med.injectWeekday : null,
      missedRule: medConst ? medConst.missedRule : '',
      labelSchedule: medConst ? medConst.labelSchedule : '',
    },
    pk: {
      feltPct: (med.medId && typeof med.currentDoseMg === 'number' && lastDose)
        ? pk.feltPct(doses, now, med.medId, med.currentDoseMg) : null,
      phase: ph ? ph.key : null,
      phaseLabel: ph ? ph.label : null,
      hoursSinceDose: ph ? Math.round(ph.hoursSince) : null,
      nextDoseKey,
      daysToNextDose: nextMs ? date.daysBetween(todayKey, nextDoseKey) : null,
    },
    weight: {
      latestKg,
      latestDate: latest ? latest.date : null,
      startKg,
      changeKg: (latestKg !== null && startKg !== null) ? Math.round((latestKg - startKg) * 10) / 10 : null,
    },
    targets,
    today,
    last7,
    badDay: plan.isBadDay(today),
    nextSiteName: plan.siteName(plan.nextSite(doses)),
    insights: [],
  }
}

Page({
  data: {
    greeting: '',
    dateText: '',
    stagePill: '',
    stageKey: '',
    badDay: false,

    // ② 简报卡
    brief: null,
    briefLoading: false,
    briefFlash: false,

    // ③ 药物状态卡
    medView: 'none', // active | explore | prescribed | maintain
    medHighlight: false,
    medTitle: '',
    felt: null,
    phaseLabel: '',
    phaseHint: '',
    switchNote: false,
    nextDoseText: '',
    nextDoseWarn: false,
    isDoseDay: false,
    hasDoses: false,
    checklist: [],
    maintain: null,

    // ④ 洞察卡
    insights: [],

    // ⑤ 体重小卡
    weightView: null,

    // ⑥ 阶段指南卡
    guideCard: null,
  },

  onLoad() {
    if (!getApp().ensureOnboarded()) return
  },

  onShow() {
    if (this.getTabBar) this.getTabBar().setData({ selected: 0 })
    if (!getApp().ensureOnboarded()) return
    this.refreshAll(false)
  },

  onPullDownRefresh() {
    // 下拉刷新：强制重算简报（LLM 当天上限 3 次，超过只刷规则版）
    this.refreshAll(true)
    wx.stopPullDownRefresh()
  },

  onUnload() {
    if (this._hlT) clearTimeout(this._hlT)
    if (this._flashT) clearTimeout(this._flashT)
  },

  // ------------------------------------------------------------------
  // 主流程
  // ------------------------------------------------------------------
  refreshAll(force) {
    const now = Date.now()
    const todayKey = date.dateKey(now)

    // 每天首次打开（§3.1 关键交互 / §2.2 lastOpenDate）
    const meta = storage.get(KEYS.META)
    const firstOpenToday = meta.lastOpenDate !== todayKey
    if (firstOpenToday) {
      storage.update(KEYS.META, (m) => Object.assign({}, m, { lastOpenDate: todayKey }))
    }

    let ctx = null
    try { ctx = ai ? ai.buildContext(now) : null } catch (e) { ctx = null }
    if (!ctx || !ctx.todayKey) ctx = buildLocalCtx(now)
    this._ctx = ctx
    this._now = now
    this._todayKey = todayKey
    this._doses = storage.get('smh_doses') || []
    this._injectedToday = this._doses.some((d) => d && date.dateKey(d.timeMs) === todayKey)
    this._isDoseDay = computeIsDoseDay(ctx, todayKey, this._injectedToday)

    this.renderGreeting(ctx)
    this.renderBrief(ctx, force)
    this.renderMedCard(ctx, now, firstOpenToday)
    this.renderInsights(ctx)
    this.renderWeightCard(ctx)
    this.renderGuideCard(ctx)
  },

  // ------------------------------------------------------------------
  // ① 问候行
  // ------------------------------------------------------------------
  renderGreeting(ctx) {
    const d = new Date(this._now)
    const name = (ctx.name || '').trim() || '你好'
    this.setData({
      greeting: greetingWord(ctx.hour !== undefined ? ctx.hour : d.getHours()) + '，' + name,
      dateText: (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + date.weekdayCn(d.getDay()),
      stagePill: this.stagePillText(ctx.stage),
      stageKey: ctx.stage.key,
      badDay: !!ctx.badDay,
    })
  },

  stagePillText(stage) {
    if (!stage) return ''
    if (stage.key === 'explore') return stage.name
    if (stage.key === 'maintain') {
      return typeof stage.week === 'number' ? stage.name + ' · 第 ' + stage.week + ' 周' : stage.name
    }
    return stage.name + ' · 第 ' + (stage.week || 1) + ' 周'
  },

  onStagePillTap() {
    const text = STAGE_TOAST[this.data.stageKey]
    if (text) wx.showToast({ title: text, icon: 'none', duration: 2200 })
  },

  // ------------------------------------------------------------------
  // ② AI 今日简报卡
  // ------------------------------------------------------------------
  renderBrief(ctx, force) {
    const hash = (ai && ai.inputHash) ? ai.inputHash(ctx) : this.localInputHash(ctx)
    const cache = storage.get(KEYS.BRIEF)
    let brief = null
    if (!force && cache && cache.date === this._todayKey && cache.inputHash === hash) {
      brief = cache // 缓存命中且 hash 相同
    }
    if (!brief) {
      const r = rules.dailyBrief(ctx) || {}
      brief = {
        date: this._todayKey,
        inputHash: hash,
        headline: r.headline || '',
        tasks: Array.isArray(r.tasks) ? r.tasks : [],
        note: r.note || '',
        source: 'rules',
        generatedAt: Date.now(),
        llmCountToday: (cache && cache.date === this._todayKey && cache.llmCountToday) || 0,
      }
      storage.set(KEYS.BRIEF, brief)
    }

    this.setData({
      brief: this.decorateBrief(brief, ctx),
      briefFlash: false,
    })

    // 异步 LLM 简报：未配置 / 上限用完时 ai.dailyBrief 直接返回规则版（source==='rules'）
    if (ai && brief.source !== 'llm') {
      if (!force && this._briefTried === hash) return // 同一 hash 本会话已试过（失败不反复请求）
      this._briefTried = hash
      this.setData({ briefLoading: true })
      ai.dailyBrief(ctx).then((b) => {
        if (!b || b.source !== 'llm') {
          this.setData({ briefLoading: false })
          return
        }
        if (b.inputHash !== hash) return // 已过期（期间打卡变动），保持规则版
        this.setData({
          brief: this.decorateBrief(b, ctx),
          briefLoading: false,
          briefFlash: true, // 内容淡入替换 200ms
        })
        if (this._flashT) clearTimeout(this._flashT)
        this._flashT = setTimeout(() => this.setData({ briefFlash: false }), 300)
      }).catch(() => this.setData({ briefLoading: false }))
    }
  },

  /** 简报任务 → 加 done / progress 展示字段（§3.1 ②） */
  decorateBrief(brief, ctx) {
    const t = ctx.targets || {}
    const today = ctx.today || {}
    const prog = plan.checkinProgress(today, t)
    const num = (v) => (typeof v === 'number' ? v : 0)

    const tasks = (brief.tasks || []).slice(0, 3).map((task) => {
      const out = { key: task.key, text: task.text, done: false, progress: '' }
      if (task.key === 'protein') {
        out.done = prog.protein
        out.progress = num(today.proteinServings) + '/' + (t.proteinServings || '')
      } else if (task.key === 'water') {
        out.done = prog.water
        out.progress = num(today.waterCups) + '/' + (t.waterCups || '')
      } else if (task.key === 'move') {
        out.done = prog.move
        out.progress = num(today.cardioMin) + '/' + (t.cardioMinDaily || '') + ' 分'
      } else if (task.key === 'strength') {
        out.done = prog.strengthToday
        out.progress = (today.strength ? 1 : 0) + '/1'
      } else if (task.key === 'weigh') {
        out.done = !!today.weightKg
        out.progress = today.weightKg ? '已称' : '未称'
      } else if (task.key === 'dose') {
        out.done = this._injectedToday
        out.progress = this._injectedToday ? '已记' : ''
      }
      return out
    })

    return {
      headline: brief.headline || '',
      note: brief.note || '',
      source: brief.source === 'llm' ? 'AI 生成' : '规则建议',
      tasks,
    }
  },

  /** ai.inputHash 不可用时的本地降级（§6.6 公式） */
  localInputHash(ctx) {
    const t = ctx.today || {}
    return [
      ctx.stage ? ctx.stage.key : 'none',
      (ctx.pk && ctx.pk.phase) || 'none',
      ctx.badDay ? 1 : 0,
      this._isDoseDay ? 1 : 0,
      'p' + (typeof t.proteinServings === 'number' ? t.proteinServings : 0),
      'w' + (typeof t.waterCups === 'number' ? t.waterCups : 0),
      'c' + (typeof t.cardioMin === 'number' ? t.cardioMin : 0),
      's' + (t.strength === true ? 1 : 0),
    ].join('|')
  },

  /** 任务行点击：protein/water/move/strength/weigh → 记录页对应行；dose → 记录注射 */
  onTaskTap(e) {
    const key = e.currentTarget.dataset.key
    if (key === 'rest') return
    if (key === 'dose') {
      wx.navigateTo({ url: '/pages/dose/dose' })
      return
    }
    const fieldMap = { protein: 'protein', water: 'water', move: 'cardio', strength: 'strength', weigh: 'weight' }
    const field = fieldMap[key]
    if (!field) return
    getApp().globalData.focusField = field
    wx.switchTab({ url: '/pages/log/log' })
  },

  onBriefAsk() {
    getApp().globalData.pendingAsk = '关于今天的安排，我想问问'
    wx.switchTab({ url: '/pages/chat/chat' })
  },

  // ------------------------------------------------------------------
  // ③ 药物状态卡（4 形态）
  // ------------------------------------------------------------------
  renderMedCard(ctx, now, firstOpenToday) {
    const med = storage.get(KEYS.MED) || {}
    const doses = this._doses
    const todayKey = this._todayKey
    const stageKey = ctx.stage ? ctx.stage.key : 'explore'

    if (stageKey === 'maintain' || med.status === 'tapering' || med.status === 'stopped') {
      this.renderMaintainCard(med)
      return
    }
    if (med.status === 'prescribed') {
      this.renderChecklistCard('prescribed')
      return
    }
    if (med.status === 'considering') {
      this.renderChecklistCard('explore')
      return
    }

    // active 形态
    const medConst = med.medId ? pk.MEDS[med.medId] : null
    const last = doses.length ? doses[doses.length - 1] : null
    let felt = null
    let ph = null
    let daysToNext = null
    let nextWd = ''
    if (last && last.timeMs) {
      felt = (med.medId && typeof med.currentDoseMg === 'number')
        ? pk.feltPct(doses, now, med.medId, med.currentDoseMg) : null
      ph = pk.phase(last.timeMs, now)
      const nextMs = pk.nextDoseMs(last)
      if (nextMs) {
        const nextKey = date.dateKey(nextMs)
        daysToNext = date.daysBetween(todayKey, nextKey)
        nextWd = date.weekdayCn(new Date(date.parseKey(nextKey)).getDay())
      }
    }
    const isDoseDay = this._isDoseDay
    const overdue = !!(ph && ph.key === 'overdue')

    let nextDoseText = ''
    let nextDoseWarn = false
    if (last && daysToNext !== null && daysToNext < 0) {
      nextDoseText = '已过计划日 ' + (-daysToNext) + ' 天'
      nextDoseWarn = true
    } else if (isDoseDay) {
      nextDoseText = '今天是打针日'
    } else if (last && daysToNext !== null) {
      nextDoseText = '下次打针：' + nextWd + '（还有 ' + daysToNext + ' 天）'
    }

    // 难受模式：打针日前 1 天内改提示（§6.2 药物卡行）
    let phaseHint = ph ? ph.hint : ''
    if (ctx.badDay && daysToNext !== null && daysToNext >= 0 && daysToNext <= 1) {
      phaseHint = '这几天难受的话，打针前可以先问问医生'
    }

    // 换药后 28 天内：副文案追加一行（§6.4）
    let switchNote = false
    const switches = (med.history || []).filter((h) => h && h.event === 'switch' && h.date)
    if (switches.length) {
      const lastSwitch = switches[switches.length - 1]
      const since = date.daysBetween(lastSwitch.date, todayKey)
      if (since >= 0 && since < 28) switchNote = true
    }

    this.setData({
      medView: 'active',
      medTitle: medConst ? medConst.name + ' ' + med.currentDoseMg + 'mg' : '',
      felt,
      phaseLabel: ph ? ph.label : '',
      phaseHint,
      switchNote,
      nextDoseText,
      nextDoseWarn,
      isDoseDay,
      hasDoses: doses.length > 0,
    })

    // 每天首次打开且是打针日：边框高亮 1.5s 后褪去（§3.1 关键交互）
    if (firstOpenToday && isDoseDay) {
      this.setData({ medHighlight: true })
      if (this._hlT) clearTimeout(this._hlT)
      this._hlT = setTimeout(() => this.setData({ medHighlight: false }), 1500)
    }
  },

  /** explore / prescribed 形态：开始前清单卡（§3.1 ③） */
  renderChecklistCard(kind) {
    const kbRead = storage.get(KEYS.KB_READ) || {}
    const base = kind === 'prescribed' ? PRESCRIBED_CHECKLIST : EXPLORE_CHECKLIST
    this.setData({
      medView: kind,
      checklist: base.map((i) => ({ id: i.id, text: i.text, read: !!kbRead[i.id] })),
      isDoseDay: false,
      hasDoses: this._doses.length > 0,
    })
  },

  /** maintain 形态：体重守护区间卡（§3.1 ③ / §6.3） */
  renderMaintainCard(med) {
    const checkins = storage.get(KEYS.CHECKINS) || {}
    const profile = storage.get(KEYS.PROFILE)
    const lw = plan.latestWeight(checkins, profile)
    const stopKg = (med && typeof med.stopWeightKg === 'number' && med.stopWeightKg > 0)
      ? med.stopWeightKg : (lw ? lw.kg : null)
    const currentKg = lw ? lw.kg : null

    let view = null
    if (stopKg && currentKg) {
      const low = stopKg * 0.98
      const high = stopKg * 1.02
      const winLow = stopKg * 0.96
      const winHigh = stopKg * 1.04
      const inRange = currentKg >= low && currentKg <= high
      let text
      if (inRange) text = '在区间内，稳稳的 👍'
      else if (currentKg > high) text = '比区间高了 ' + fmt1(currentKg - high) + 'kg，留意一下'
      else text = '比区间低了 ' + fmt1(low - currentKg) + 'kg，留意一下'
      view = {
        currentKg: fmt1(currentKg),
        text,
        segLeft: ((low - winLow) / (winHigh - winLow)) * 100,
        segWidth: ((high - low) / (winHigh - winLow)) * 100,
        dotPct: clamp01(((currentKg - winLow) / (winHigh - winLow)) * 100),
      }
    }
    this.setData({ medView: 'maintain', maintain: view, isDoseDay: false })
  },

  goDose() {
    wx.navigateTo({ url: '/pages/dose/dose' })
  },
  goPlan() {
    wx.navigateTo({ url: '/pages/plan/plan' })
  },
  onChecklistTap(e) {
    wx.navigateTo({ url: '/pages/article/article?id=' + e.currentTarget.dataset.id })
  },
  goFirstShot() {
    wx.navigateTo({ url: '/pages/dose/dose' })
  },
  goLogWeight() {
    getApp().globalData.focusField = 'weight'
    wx.switchTab({ url: '/pages/log/log' })
  },

  // ------------------------------------------------------------------
  // ④ 洞察卡区（0–2 张）
  // ------------------------------------------------------------------
  renderInsights(ctx) {
    const cards = insight.refresh(this._now)
    // 难受模式只显示 priority ≥ 70 的卡（§6.2）
    const shown = ctx.badDay ? cards.filter((c) => c.priority >= 70) : cards
    this.setData({ insights: shown })
  },

  onInsightDismiss(e) {
    const key = e.detail.key
    const next = insight.dismiss(storage.get(KEYS.INSIGHTS), key, Date.now())
    storage.set(KEYS.INSIGHTS, next)
    const visible = insight.visible(next, 2)
    this.setData({ insights: this.data.badDay ? visible.filter((c) => c.priority >= 70) : visible })
  },

  onInsightAsk(e) {
    getApp().globalData.pendingAsk = e.detail.prompt || '我想问问'
    wx.switchTab({ url: '/pages/chat/chat' })
  },

  onInsightCta(e) {
    const cta = e.detail.cta
    if (!cta || cta.kind !== 'navigate' || !cta.payload) return
    wx.navigateTo({
      url: cta.payload,
      fail: () => {
        wx.switchTab({ url: cta.payload.split('?')[0] })
      },
    })
  },

  // ------------------------------------------------------------------
  // ⑤ 体重小卡
  // ------------------------------------------------------------------
  renderWeightCard(ctx) {
    if (ctx.badDay) {
      this.setData({ weightView: null }) // 难受模式隐藏（§6.2）
      return
    }
    const profile = storage.get(KEYS.PROFILE)
    const checkins = storage.get(KEYS.CHECKINS) || {}
    const latest = plan.latestWeight(checkins, profile)
    if (!latest) {
      this.setData({ weightView: null })
      return
    }
    const startKg = profile && typeof profile.startWeightKg === 'number' ? profile.startWeightKg : null
    let changeText = ''
    if (startKg) {
      const delta = latest.kg - startKg
      changeText = '比起始 ' + signed1(delta) + 'kg（' + signed1((delta / startKg) * 100) + '%）'
    }
    const points = storage.listCheckins(date.addDays(this._todayKey, -13), this._todayKey)
      .filter((c) => typeof c.weightKg === 'number')
      .map((c) => ({ date: c.date, kg: c.weightKg }))

    // 本周（周一起）还没称
    const wd = new Date(date.parseKey(this._todayKey)).getDay()
    const monday = date.addDays(this._todayKey, -((wd + 6) % 7))
    const weighedThisWeek = storage.listCheckins(monday, this._todayKey)
      .some((c) => typeof c.weightKg === 'number')

    this.setData({
      weightView: {
        latestKg: fmt1(latest.kg),
        changeText,
        points,
        chart: points.length >= 2,
        notWeighed: !weighedThisWeek,
      },
    })
  },

  goTrend() {
    wx.navigateTo({ url: '/pages/trend/trend' })
  },

  // ------------------------------------------------------------------
  // ⑥ 阶段指南卡
  // ------------------------------------------------------------------
  renderGuideCard(ctx) {
    if (!kb || !kb.length) {
      this.setData({ guideCard: null })
      return
    }
    const kbRead = storage.get(KEYS.KB_READ) || {}
    let card = null
    if (ctx.badDay) {
      // 难受模式固定推荐 kb_nausea / 有呕吐时 kb_red_flags（§6.2 / 05-DATA §8）
      const vomited = !!(ctx.today && ctx.today.symptoms && ctx.today.symptoms.vomiting)
      card = kb.find((k) => k.id === (vomited ? 'kb_red_flags' : 'kb_nausea')) || null
    } else {
      const candidates = kb.filter((k) => Array.isArray(k.stages) && k.stages.indexOf(ctx.stage.key) >= 0)
      const unread = candidates.filter((k) => !kbRead[k.id])
      card = unread.length ? unread[0] : (candidates[0] || null)
    }
    if (!card) {
      this.setData({ guideCard: null })
      return
    }
    this.setData({
      guideCard: {
        id: card.id,
        label: this.stagePillText(ctx.stage).split(' · ')[0] + '最该知道的',
        title: card.title,
        minutes: card.minutes || 2,
        read: !!kbRead[card.id],
      },
    })
  },

  goGuide() {
    if (this.data.guideCard) {
      wx.navigateTo({ url: '/pages/article/article?id=' + this.data.guideCard.id })
    }
  },

  // ------------------------------------------------------------------
  // 难受模式顶部条
  // ------------------------------------------------------------------
  goSos() {
    wx.navigateTo({ url: '/pages/sos/sos' })
  },

  /** 「我好多了」：feel→ok，重度降为轻度，删除呕吐，立即恢复正常模式（§6.2） */
  imBetter() {
    const today = storage.getCheckin(this._todayKey)
    const symptoms = {}
    Object.keys(today.symptoms || {}).forEach((k) => {
      if (k === 'vomiting') return
      symptoms[k] = today.symptoms[k] === 2 ? 1 : today.symptoms[k]
    })
    storage.upsertCheckin(this._todayKey, { feel: 'ok', symptoms })
    this.refreshAll(false)
  },
})
