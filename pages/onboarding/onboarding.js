// pages/onboarding — 首次启动 6 步（docs/02-UX.md §4.1）
// 单页切换：顶部自绘进度点 + 水平滑动动画 250ms；每步完成写 meta.onboardingStep；
// 中断恢复：跳到 meta.onboardingStep，已填数据从 smh_onb_draft 恢复（完成后删除）。
const storage = require('../../utils/storage.js')
const pk = require('../../utils/pk.js')
const plan = require('../../utils/plan.js')
const date = require('../../utils/date.js')
const privacy = require('../../data/privacy.js')

const KEYS = storage.KEYS

// 免责声明全文（01-PRD §6，DISCLAIMER_VERSION = '2026-10-v1'）
const DISCLAIMER_ITEMS = [
  '这里的所有内容只用于健康科普和自我记录，不能代替医生的诊断和治疗。',
  '小美不会告诉你该打多少剂量、什么时候加量或停药——这些决定请一定和你的处方医生一起做。',
  '药物浓度曲线是根据说明书参数估算的示意图，不是你的真实血药浓度。',
  '如果出现剧烈腹痛、持续呕吐喝不进水、呼吸困难、面部或喉咙肿胀等情况，请立即就医或拨打 120。',
  '请只使用医院处方、正规药房购买的药品。',
  '你的数据默认只保存在这部手机里。开启 AI 服务时，你的问题和必要的记录摘要会发送给你所配置的 AI 服务商。',
]

const WELCOME_POINTS = [
  { icon: '💉', text: '记住每一针，自动轮换部位' },
  { icon: '🥚', text: '每天吃多少、喝多少，给你具体数字' },
  { icon: '✨', text: '小美随时回答，关键时刻提醒你找医生' },
]

const SEX_OPTIONS = [
  { value: 'female', label: '女' },
  { value: 'male', label: '男' },
  { value: 'other', label: '不愿透露' },
]

const HEALTH_OPTIONS = [
  { value: 't2d', label: '2 型糖尿病' },
  { value: 'insulin_su', label: '在用胰岛素或磺脲类降糖药' },
  { value: 'gallbladder', label: '胆囊问题' },
  { value: 'pancreatitis', label: '胰腺炎病史' },
  { value: 'mtc_men2', label: '甲状腺髓样癌（本人或家族）' },
  { value: 'pregnancy', label: '正在怀孕、哺乳或备孕' },
  { value: 'kidney', label: '肾脏问题' },
  { value: 'none', label: '都没有' },
]

// 选中后点「下一步」必须先看提示卡的情况（02-UX §4.1 Step 4）
const CONDITION_ALERT = ['pregnancy', 'mtc_men2', 'pancreatitis']

const STATUS_OPTIONS = [
  { value: 'considering', icon: '🔍', label: '还在了解' },
  { value: 'prescribed', icon: '📝', label: '医生开了药，还没开始' },
  { value: 'active', icon: '💉', label: '已经在用了' },
  { value: 'stopped', icon: '🌿', label: '已经停药了' },
]

const WEEKDAY_OPTIONS = [
  { value: 0, label: '周日' },
  { value: 1, label: '周一' },
  { value: 2, label: '周二' },
  { value: 3, label: '周三' },
  { value: 4, label: '周四' },
  { value: 5, label: '周五' },
  { value: 6, label: '周六' },
]

function round1(n) {
  return Math.round(n * 10) / 10
}

Page({
  data: {
    topPad: 44,
    step: 1,
    animCls: '',
    todayKey: '',
    // Step 1
    welcomePoints: WELCOME_POINTS,
    privacyAccepted: false,
    showPrivacyModal: false,
    privacyDoc: null,
    showTermsModal: false,
    termsDoc: null,
    // Step 2
    disclaimerItems: DISCLAIMER_ITEMS,
    disclaimerAccepted: false,
    // Step 3
    d: { nickname: '', sex: null, birthYear: 1990, heightCm: '', weightKg: '', goalWeightKg: '' },
    sexOptions: SEX_OPTIONS,
    years: [],
    yearIndex: 0,
    errors: {},
    bmiText: '',
    goalHint: '',
    minor: false,
    step3Ready: false,
    step5Ready: false,
    focus: { nickname: false, height: false, weight: false, goal: false },
    welcomeLead: '用司美格鲁肽、替尔泊肽减重的路上，\n吃什么、怎么动、身体反应正不正常、什么时候该找医生——\n我和 AI 小美陪你一起。',
    // Step 4
    healthOptions: HEALTH_OPTIONS,
    conditions: [],
    showCondAlert: false,
    // Step 5
    statusOptions: STATUS_OPTIONS,
    medStatus: null,
    medOptions: [],
    medId: null,
    doseOptions: [],
    doseMg: null,
    startDate: '',
    injectWeekday: null,
    plannedWeekday: null,
    stopDate: '',
    weekdayOptions: WEEKDAY_OPTIONS,
    // Step 6
    firstName: '你',
    stageName: '',
    targetCards: [],
    bubbleText: '',
    showCalendarBtn: false,
    calendarAdded: false,
  },

  onLoad() {
    const sys = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()
    const now = Date.now()
    const todayKey = date.dateKey(now)
    const thisYear = new Date(now).getFullYear()

    // 出生年选择范围：1930 – 今年-18（02-UX §4.1 Step 3）
    const years = []
    for (let y = 1930; y <= thisYear - 18; y++) years.push(y)

    const medOptions = Object.keys(pk.MEDS).map((id) => ({ value: id, label: pk.MEDS[id].name }))

    // 中断恢复：免责版本变化 → 从 Step 2 重新确认；否则跳 meta.onboardingStep；
    // 页面级草稿（最近停留步 + 已填数据）优先于 meta
    const meta = storage.get(KEYS.META)
    let step = meta.onboardingStep || 1
    if (meta.onboardedAt && meta.disclaimerAcceptedVersion !== storage.DISCLAIMER_VERSION) step = 2
    const draft = storage.get(KEYS.ONB_DRAFT)
    if (draft && typeof draft.step === 'number') step = draft.step

    this.setData({
      topPad: (sys.statusBarHeight || 20) + 12,
      todayKey,
      years,
      yearIndex: Math.max(0, years.indexOf(1990)),
      step,
      medOptions,
      startDate: todayKey,
      stopDate: todayKey,
    })

    if (draft && draft.d) {
      const d = Object.assign({}, this.data.d, draft.d)
      const yearIndex = Math.max(0, years.indexOf(d.birthYear))
      this.setData({
        d,
        yearIndex: yearIndex >= 0 ? yearIndex : this.data.yearIndex,
        disclaimerAccepted: !!draft.disclaimerAccepted,
        privacyAccepted: !!draft.privacyAccepted,
        conditions: Array.isArray(draft.conditions) ? draft.conditions : [],
        medStatus: draft.medStatus || null,
        medId: draft.medId || null,
        doseMg: draft.doseMg === null || draft.doseMg === undefined ? null : draft.doseMg,
        startDate: draft.startDate || todayKey,
        injectWeekday: draft.injectWeekday === undefined ? null : draft.injectWeekday,
        plannedWeekday: draft.plannedWeekday === undefined ? null : draft.plannedWeekday,
        stopDate: draft.stopDate || todayKey,
      })
      this.syncDoseOptions()
      this.validateStep3()
      this.refreshStep5()
    }

    if (step === 6) this.prepareStep6()
  },

  onUnload() {
    if (this._animT) clearTimeout(this._animT)
  },

  // ------------------------------------------------------------------
  // 步骤切换：水平滑动动画 250ms + 写 meta.onboardingStep + 存草稿
  // ------------------------------------------------------------------
  goToStep(n, dir) {
    const next = Math.min(6, Math.max(1, n))
    if (next === this.data.step && !dir) return
    if (next === 6) this.prepareStep6()
    this.setData({ step: next, animCls: '' })
    storage.update(KEYS.META, (m) => Object.assign({}, m, { onboardingStep: next }))
    this.saveDraft()
    if (this._animT) clearTimeout(this._animT)
    // 先清空动画类再挂上，保证连续切换也能重新触发
    this._animT = setTimeout(() => {
      this.setData({ animCls: dir === 'back' ? 'step-back' : 'step-next' })
    }, 30)
  },

  goBack() {
    if (this.data.step > 1) this.goToStep(this.data.step - 1, 'back')
  },

  goNext() {
    const s = this.data.step
    if (s === 1) {
      // Step 1 → Step 2：必须勾选隐私政策 + 服务条款 + 免责声明（合规 #1）
      if (!this.data.privacyAccepted) {
        return wx.showToast({ title: '请先阅读并同意《隐私政策》与《服务条款》', icon: 'none' })
      }
      // 写版本号
      const now = Date.now()
      storage.update(KEYS.META, (m) => Object.assign({}, m, {
        privacyAcceptedVersion: privacy.PRIVACY_VERSION,
        privacyAcceptedAt: now,
        termsAcceptedVersion: privacy.TERMS_VERSION,
        termsAcceptedAt: now,
      }))
      return this.goToStep(2)
    }
    if (s === 2) {
      const now = Date.now()
      storage.update(KEYS.META, (m) => Object.assign({}, m, {
        disclaimerAcceptedVersion: storage.DISCLAIMER_VERSION,
        disclaimerAcceptedAt: now,
      }))
      return this.goToStep(3)
    }
    if (s === 3) return this.goToStep(4)
    if (s === 4) {
      // pregnancy / mtc_men2 / pancreatitis → 先显示提示卡（非 modal，02-UX §4.1）
      const hit = this.data.conditions.some((c) => CONDITION_ALERT.indexOf(c) >= 0)
      if (hit && !this.data.showCondAlert) return this.setData({ showCondAlert: true })
      this.setData({ showCondAlert: false })
      return this.goToStep(5)
    }
    if (s === 5) return this.goToStep(6)
  },

  condAlertOk() {
    this.setData({ showCondAlert: false })
    this.goToStep(5)
  },

  // ------------------------------------------------------------------
  // 隐私政策 + 服务条款（Step 1 必读）
  // ------------------------------------------------------------------
  togglePrivacy() {
    this.setData({ privacyAccepted: !this.data.privacyAccepted })
    this.saveDraft()
  },

  openPrivacy() {
    this.setData({ showPrivacyModal: true, privacyDoc: privacy.PRIVACY_DOC })
  },

  openTerms() {
    this.setData({ showTermsModal: true, termsDoc: privacy.TERMS_DOC })
  },

  closePrivacyModal() {
    this.setData({ showPrivacyModal: false })
  },

  closeTermsModal() {
    this.setData({ showTermsModal: false })
  },

  // 占位：阻止冒泡到 mask 关闭
  noop() {},

  // ------------------------------------------------------------------
  // 草稿（smh_onb_draft，完成后删除）
  // ------------------------------------------------------------------
  saveDraft() {
    const d = this.data
    storage.set(KEYS.ONB_DRAFT, {
      step: d.step,
      disclaimerAccepted: d.disclaimerAccepted,
      privacyAccepted: d.privacyAccepted,
      d: d.d,
      conditions: d.conditions,
      medStatus: d.medStatus,
      medId: d.medId,
      doseMg: d.doseMg,
      startDate: d.startDate,
      injectWeekday: d.injectWeekday,
      plannedWeekday: d.plannedWeekday,
      stopDate: d.stopDate,
    })
  },

  // ------------------------------------------------------------------
  // Step 1 欢迎
  // ------------------------------------------------------------------
  startWelcome() {
    this.goToStep(2)
  },

  // ------------------------------------------------------------------
  // Step 2 免责
  // ------------------------------------------------------------------
  toggleDisclaimer() {
    this.setData({ disclaimerAccepted: !this.data.disclaimerAccepted })
    this.saveDraft()
  },

  // ------------------------------------------------------------------
  // Step 3 身体数据
  // ------------------------------------------------------------------
  onBoxFocus(e) {
    this.setData({ ['focus.' + e.currentTarget.dataset.field]: true })
  },

  onBoxBlur(e) {
    this.setData({ ['focus.' + e.currentTarget.dataset.field]: false })
  },

  onNickname(e) {
    this.setData({ 'd.nickname': e.detail.value })
    this.saveDraft()
  },

  onSex(e) {
    this.setData({ 'd.sex': e.detail.value })
    this.saveDraft()
  },

  onBirthYear(e) {
    const idx = Number(e.detail.value)
    const year = this.data.years[idx]
    this.setData({ yearIndex: idx, 'd.birthYear': year })
    this.validateStep3()
    this.saveDraft()
  },

  onHeight(e) {
    this.setData({ 'd.heightCm': e.detail.value })
    this.validateStep3()
    this.saveDraft()
  },

  onWeight(e) {
    this.setData({ 'd.weightKg': e.detail.value })
    this.validateStep3()
    this.saveDraft()
  },

  onGoalWeight(e) {
    this.setData({ 'd.goalWeightKg': e.detail.value })
    this.validateStep3()
    this.saveDraft()
  },

  validateStep3() {
    const d = this.data.d
    const thisYear = new Date().getFullYear()
    const errors = {}
    const heightCm = parseFloat(d.heightCm)
    const weightKg = parseFloat(d.weightKg)
    const goalKg = d.goalWeightKg === '' ? null : parseFloat(d.goalWeightKg)

    if (!(d.birthYear >= 1920 && d.birthYear <= thisYear - 18)) errors.birthYear = '出生年份不在支持范围内'
    if (d.heightCm !== '' && (!isFinite(heightCm) || heightCm < 120 || heightCm > 220)) errors.heightCm = '身高请在 120–220cm 之间'
    if (d.weightKg !== '' && (!isFinite(weightKg) || weightKg < 30 || weightKg > 300)) errors.weightKg = '体重请在 30–300kg 之间'
    if (goalKg !== null && (!isFinite(goalKg) || goalKg < 20 || goalKg > 300 || (isFinite(weightKg) && goalKg >= weightKg))) {
      errors.goalWeightKg = '目标体重需小于当前体重（20–300kg）'
    }

    // BMI（身高体重都有效时）
    let bmiText = ''
    if (isFinite(heightCm) && isFinite(weightKg) && heightCm >= 120 && heightCm <= 220) {
      const h = heightCm / 100
      bmiText = round1(weightKg / (h * h)).toFixed(1)
    }

    // 目标提示：减掉 5–10% 约多少 kg
    let goalHint = ''
    if (isFinite(weightKg) && weightKg >= 30 && weightKg <= 300) {
      goalHint = '先定个小目标也很好：减掉 5–10% 已经对健康很有帮助（约 ' + round1(weightKg * 0.05) + '–' + round1(weightKg * 0.1) + 'kg）'
    }

    const age = thisYear - d.birthYear
    this.setData({
      errors, bmiText, goalHint,
      minor: age < 18,
      step3Ready: !!(d.sex && d.heightCm !== '' && d.weightKg !== '' &&
        !errors.heightCm && !errors.weightKg && !errors.goalWeightKg && !errors.birthYear),
    })
  },

  // ------------------------------------------------------------------
  // Step 4 健康情况（「都没有」与其他互斥）
  // ------------------------------------------------------------------
  onConditions(e) {
    let next = (e.detail.value || []).slice()
    const prev = this.data.conditions
    const hasNone = next.indexOf('none') >= 0
    const hadNone = prev.indexOf('none') >= 0
    if (hasNone && !hadNone) {
      next = ['none']
    } else if (hasNone && next.length > 1) {
      next = next.filter((c) => c !== 'none')
    }
    this.setData({ conditions: next })
    this.saveDraft()
  },

  // ------------------------------------------------------------------
  // Step 5 用药状态 + 方案
  // ------------------------------------------------------------------
  onStatus(e) {
    this.setData({ medStatus: e.currentTarget.dataset.value })
    this.syncDoseOptions()
    this.refreshStep5()
    this.saveDraft()
  },

  onMedId(e) {
    this.setData({ medId: e.detail.value, doseMg: null })
    this.syncDoseOptions()
    this.refreshStep5()
    this.saveDraft()
  },

  syncDoseOptions() {
    const med = this.data.medId ? pk.MEDS[this.data.medId] : null
    const doseOptions = med ? med.doseOptionsMg.map((v) => ({ value: v, label: v + 'mg' })) : []
    this.setData({ doseOptions })
  },

  onDoseMg(e) {
    this.setData({ doseMg: e.detail.value })
    this.refreshStep5()
    this.saveDraft()
  },

  onStartDate(e) {
    this.setData({ startDate: e.detail.value })
    this.refreshStep5()
    this.saveDraft()
  },

  onInjectWeekday(e) {
    this.setData({ injectWeekday: e.detail.value })
    this.refreshStep5()
    this.saveDraft()
  },

  onPlannedWeekday(e) {
    this.setData({ plannedWeekday: e.detail.value })
    this.refreshStep5()
    this.saveDraft()
  },

  onStopDate(e) {
    this.setData({ stopDate: e.detail.value })
    this.refreshStep5()
    this.saveDraft()
  },

  step5ReadyCalc() {
    const d = this.data
    if (!d.medStatus) return false
    if (d.medStatus === 'considering') return true
    if (!d.medId || d.doseMg === null || d.doseMg === undefined) return false
    if (d.medStatus === 'active') return !!(d.startDate && d.injectWeekday !== null && d.injectWeekday !== undefined)
    if (d.medStatus === 'prescribed') return true // 计划打针日选填
    if (d.medStatus === 'stopped') return !!d.stopDate
    return false
  },

  refreshStep5() {
    this.setData({ step5Ready: this.step5ReadyCalc() })
  },

  // ------------------------------------------------------------------
  // Step 6 我的计划
  // ------------------------------------------------------------------
  prepareStep6() {
    const d = this.data
    const weightKg = parseFloat(d.d.weightKg) || 70
    const stageKey = d.medStatus === 'active' ? 'start'
      : (d.medStatus === 'stopped' ? 'maintain' : 'explore')
    const tmpProfile = { heightCm: parseFloat(d.d.heightCm) || 165, conditions: d.conditions }
    const targets = plan.computeTargets(tmpProfile, weightKg, stageKey)

    const targetCards = [
      { icon: '🥚', main: '蛋白 ' + targets.proteinServings + ' 份', sub: '约 ' + targets.proteinG + 'g' },
      { icon: '💧', main: '喝水 ' + targets.waterCups + ' 杯', sub: '约 ' + (targets.waterMl / 1000).toFixed(1) + 'L' },
      { icon: '🚶', main: '每天 ' + targets.cardioMinDaily + ' 分钟', sub: '力量每周 ' + targets.strengthPerWeek + ' 次' },
    ]

    const stageName = plan.STAGES[stageKey].name
    let bubbleText
    if (stageKey === 'explore') {
      bubbleText = '先别急着开始，我帮你把要了解的都准备好了。'
    } else if (stageKey === 'maintain') {
      bubbleText = '你进入了' + stageName + '。接下来最重要的是把蛋白、力量训练和每周称重变成习惯，守住体重。有任何反应，随时来问我。'
    } else {
      bubbleText = '你现在是' + stageName + '。这个阶段最重要的是把蛋白吃够、开始做点力量训练，防止掉肌肉。有任何反应，随时来问我。'
    }

    const weekday = d.medStatus === 'active' ? d.injectWeekday : d.plannedWeekday
    this.setData({
      firstName: (d.d.nickname || '').trim() || '你',
      stageName,
      targetCards,
      bubbleText,
      showCalendarBtn: (d.medStatus === 'active' || d.medStatus === 'prescribed') && weekday !== null && weekday !== undefined,
    })
    this.syncCalendarAdded()
  },

  syncCalendarAdded() {
    const med = storage.get(KEYS.MED)
    this.setData({ calendarAdded: !!(med && med.calendarAdded && med.calendarAdded.inject) })
  },

  addCalendar() {
    const d = this.data
    const weekday = d.medStatus === 'active' ? d.injectWeekday : d.plannedWeekday
    if (weekday === null || weekday === undefined) return
    // 下一个打针日的 09:00（§5.3，秒级时间戳）
    const todayWd = new Date(date.parseKey(d.todayKey)).getDay()
    const ahead = (weekday - todayWd + 7) % 7
    const startSec = Math.floor((date.parseKey(d.todayKey) + ahead * 86400000 + 9 * 3600000) / 1000)
    wx.addPhoneRepeatCalendar({
      title: '💉 今天是打针日',
      startTime: startSec,
      description: '打完记得在司美助手里记一下',
      repeatInterval: 'week',
      alarm: true,
      alarmOffset: 0,
      success: () => {
        const cur = storage.get(KEYS.MED)
        storage.saveMed({ calendarAdded: Object.assign({ inject: false, visit: false, checkin: false }, cur.calendarAdded, { inject: true }) })
        this.setData({ calendarAdded: true })
        wx.showToast({ title: '已加到手机日历', icon: 'none' })
      },
      fail: () => {
        wx.showToast({ title: '没加上也没关系，打开小程序时我会提醒你', icon: 'none' })
      },
    })
  },

  // ------------------------------------------------------------------
  // 完成：写 profile / med / meta.onboardedAt → 今天页
  // ------------------------------------------------------------------
  finish() {
    const d = this.data
    const now = Date.now()
    const todayKey = date.dateKey(now)

    const profile = {
      nickname: (d.d.nickname || '').trim(),
      sex: d.d.sex,
      birthYear: d.d.birthYear,
      heightCm: parseFloat(d.d.heightCm),
      startWeightKg: round1(parseFloat(d.d.weightKg)),
      startWeightDate: todayKey,
      goalWeightKg: d.d.goalWeightKg === '' ? null : round1(parseFloat(d.d.goalWeightKg)),
      activityLevel: 'sedentary', // MVP 未收集活动量，默认久坐（05-DATA §2.3）
      conditions: d.conditions,
      createdAt: now,
      updatedAt: now,
    }
    storage.set(KEYS.PROFILE, profile)

    if (d.medStatus === 'active') {
      storage.saveMed({
        status: 'active',
        medId: d.medId,
        currentDoseMg: d.doseMg,
        startDate: d.startDate,
        doseSince: d.startDate,
        injectWeekday: d.injectWeekday,
      }, { date: d.startDate, event: 'start', medId: d.medId, doseMg: d.doseMg, note: '' })
    } else if (d.medStatus === 'prescribed') {
      storage.saveMed({
        status: 'prescribed',
        medId: d.medId,
        currentDoseMg: d.doseMg,
        injectWeekday: d.plannedWeekday,
      })
    } else if (d.medStatus === 'stopped') {
      storage.saveMed({
        status: 'stopped',
        medId: d.medId,
        stopDate: d.stopDate,
        stopWeightKg: profile.startWeightKg, // 进入停药态自动取 Step 3 体重（02-UX §4.1 Step 5）
      })
    } else {
      storage.saveMed({ status: 'considering' })
    }

    storage.update(KEYS.META, (m) => Object.assign({}, m, {
      onboardingStep: 6,
      onboardedAt: now,
      lastOpenDate: todayKey,
    }))
    storage.set(KEYS.ONB_DRAFT, null) // 完成后删除草稿

    wx.switchTab({ url: '/pages/today/today' })
  },
})
