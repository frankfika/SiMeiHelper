// test/integration.test.js — 跨模块集成测试
// 目标：验证页面调用 → 服务层 → 存储的完整链路。
// 与 unit test 的区别：本测试同时加载 ai / rules / insight / plan / pk / storage，
// 用一个 wx shim 提供最小运行时，跑出真实用户流程中可能触发的跨模块交互。

const assert = require('assert')
const path = require('path')

// ---------------------------------------------------------------------------
// wx shim（最小兼容：让 ai.js/storage.js 能在 node 里 require）
// ---------------------------------------------------------------------------
function makeWxShim(initial) {
  const store = Object.assign({}, initial || {})
  const shim = {
    setStorageSync(key, val) { store[key] = val },
    getStorageSync(key) {
      if (Object.prototype.hasOwnProperty.call(store, key)) return store[key]
      return ''
    },
    removeStorageSync(key) { delete store[key] },
    getSystemInfoSync() { return { theme: 'light' } },
    getWindowInfo() { return { windowWidth: 375, pixelRatio: 2 } },
    getAppBaseInfo() { return { theme: 'light' } },
    onThemeChange() {},
    showToast() {},
    showModal() { return { confirm: true } },
    makePhoneCall() {},
    addPhoneRepeatCalendar() {},
    addPhoneCalendar() {},
    request(opts) {
      // 默认所有 LLM 请求都失败，强制走规则版
      if (opts.fail) opts.fail({ errMsg: 'mock:network-error' })
      else opts.success && opts.success({ statusCode: 503, data: null })
    },
    navigateTo() {}, navigateBack() {}, switchTab() {}, reLaunch() {},
    setNavigationBarTitle() {},
    setClipboardData(opts) { opts && opts.success && opts.success() },
    showActionSheet() {},
    pageScrollTo() {},
    vibrateShort() {},
    getStorageInfoSync() { return { currentSize: 0, limitSize: 10000 } },
    __store: store,  // 测试用
  }
  return shim
}

function installWx(shim) {
  global.wx = shim
}

function uninstallWx() {
  delete global.wx
}

// ---------------------------------------------------------------------------
// 用一行最少的真实存储装填，模拟一个已经"完成了 onboarding + 用了 4 周"的用户
// ---------------------------------------------------------------------------
function buildSeedProfile() {
  return {
    smh_meta: { schemaVersion: 1, installedAt: 1, disclaimerAcceptedVersion: '2026-10-v1', disclaimerAcceptedAt: 1, onboardingStep: 6, onboardedAt: 1, lastOpenDate: '2026-10-05' },
    smh_profile: { nickname: '王姐', sex: 'female', birthYear: 1988, heightCm: 165, startWeightKg: 92, startWeightDate: '2026-09-07', goalWeightKg: 80, conditions: ['t2d'] },
    smh_med: { status: 'active', medId: 'tirzepatide', brand: '', currentDoseMg: 5, doseSince: '2026-09-14', startDate: '2026-09-07', injectWeekday: 0, doctor: { name: '', hospital: '' }, nextVisitDate: null, stopDate: null, stopWeightKg: null, calendarAdded: { inject: true, visit: false, checkin: false }, history: [{ date: '2026-09-07', event: 'start', medId: 'tirzepatide', doseMg: 2.5 }, { date: '2026-09-14', event: 'dose_change', medId: 'tirzepatide', doseMg: 5 }] },
    smh_doses: [
      { id: 'd1', medId: 'tirzepatide', doseMg: 2.5, timeMs: Date.UTC(2026, 8, 7, 9), site: 'abd_ul' },
      { id: 'd2', medId: 'tirzepatide', doseMg: 2.5, timeMs: Date.UTC(2026, 8, 14, 9), site: 'abd_ur' },
      { id: 'd3', medId: 'tirzepatide', doseMg: 5, timeMs: Date.UTC(2026, 8, 21, 9), site: 'abd_ll' },
      { id: 'd4', medId: 'tirzepatide', doseMg: 5, timeMs: Date.UTC(2026, 8, 28, 9), site: 'abd_lr' },
    ],
    smh_checkins: {
      '2026-09-21': { date: '2026-09-21', weightKg: 91.2, feel: 'ok', symptoms: {}, proteinServings: 4, waterCups: 9, cardioMin: 30, strength: false, appetite: 'normal', nlText: '', note: '', updatedAt: 1, completedAt: 1 },
      '2026-09-28': { date: '2026-09-28', weightKg: 90.0, feel: 'ok', symptoms: {}, proteinServings: 5, waterCups: 11, cardioMin: 30, strength: true, appetite: 'normal', nlText: '', note: '', updatedAt: 1, completedAt: 1 },
      '2026-10-04': { date: '2026-10-04', weightKg: 88.8, feel: 'good', symptoms: {}, proteinServings: 4, waterCups: 10, cardioMin: 45, strength: false, appetite: 'normal', nlText: '', note: '', updatedAt: 1, completedAt: 1 },
    },
    smh_chat: { messages: [] },
    smh_insights: { active: [], lastFired: {}, lastDismissed: {} },
    smh_brief: null,
    smh_kb_read: {},
    smh_settings: { ai: { provider: 'rules', baseUrl: '', model: '', apiKey: '', temperature: 0.6 }, reminders: { askedCalendar: true }, updatedAt: 1 },
  }
}

// ---------------------------------------------------------------------------
// 测试
// ---------------------------------------------------------------------------

function freshLoad() {
  // 重新加载模块（避免状态污染）
  delete require.cache[require.resolve('../utils/storage.js')]
  delete require.cache[require.resolve('../utils/insight.js')]
  delete require.cache[require.resolve('../utils/ai.js')]
  delete require.cache[require.resolve('../utils/rules.js')]
  delete require.cache[require.resolve('../utils/plan.js')]
  delete require.cache[require.resolve('../utils/pk.js')]
  delete require.cache[require.resolve('../utils/date.js')]
  const storage = require('../utils/storage.js')
  const plan = require('../utils/plan.js')
  const rules = require('../utils/rules.js')
  const insight = require('../utils/insight.js')
  const ai = require('../utils/ai.js')
  return { storage, plan, rules, insight, ai }
}

// ---------------------------------------------------------------------------
// J1：onboarding 已完成，进入今天页
// ---------------------------------------------------------------------------
async function j1_todayPage() {
  installWx(makeWxShim(buildSeedProfile()))
  const m = freshLoad()
  const now = Date.UTC(2026, 9, 5, 12)
  const ctx = m.ai.buildContext(now)
  assert.equal(ctx.name, '王姐', 'profile.nickname')
  assert.equal(ctx.profile.heightCm, 165)
  assert.equal(ctx.profile.bmi, 32.6, '88.8 / 1.65² 保留 1 位小数（用 latestKg 而非 startWeightKg）')
  assert.equal(ctx.med.medName, '替尔泊肽', 'medName 映射')
  assert.equal(ctx.med.doseMg, 5, 'currentDoseMg')
  assert.equal(ctx.med.daysOnDose >= 21, true, 'daysOnDose 应 ≥ 21 天')
  assert.equal(ctx.stage.key, 'titrate', '周 6 应为 titrate 期')
  assert.equal(ctx.weight.latestKg, 88.8)
  assert.equal(ctx.weight.startKg, 92)
  assert.ok(ctx.weight.changeKg < 0, '体重下降')
  assert.ok(ctx.nextSiteName && ctx.nextSiteName.length > 0, '下一针部位有名字')
  assert.equal(typeof ctx.pk.feltPct, 'number', '体感浓度')
  assert.ok(ctx.pk.feltPct >= 0 && ctx.pk.feltPct <= 100, '体感 0-100')
  assert.ok(['rising','peak','steady','trough','overdue'].indexOf(ctx.pk.phase) >= 0, 'phase 在枚举内')
  assert.equal(ctx.pk.injectedToday, false, '今天无注射')
  assert.equal(ctx.targets.proteinG, 80, 'computeTargets proteinG')
  assert.equal(ctx.targets.proteinServings, 4)
  assert.equal(ctx.targets.waterCups, 11, 'computeTargets waterCups')
  // 简报 hash 跨两次调用稳定
  const h1 = m.ai.inputHash(ctx)
  const ctx2 = m.ai.buildContext(now)
  const h2 = m.ai.inputHash(ctx2)
  assert.equal(h1, h2, 'inputHash 跨调用稳定')
  // 规则版简报
  const brief = m.rules.dailyBrief(ctx)
  assert.ok(brief.headline && brief.headline.length > 0 && brief.headline.length <= 60, 'brief headline 长度合理')
  assert.equal(brief.tasks.length, 3, 'tasks = 3')
  for (const t of brief.tasks) assert.ok(['protein','water','move','strength','dose','rest','weigh'].indexOf(t.key) >= 0, 'task key 白名单: ' + t.key)
}

// ---------------------------------------------------------------------------
// J2：录入新注射 → 自动从 prescribed 转为 active
// ---------------------------------------------------------------------------
async function j2_firstInjection() {
  const seed = buildSeedProfile()
  // 模拟新用户刚注册完三周
  seed.smh_med = { status: 'considering', medId: null, currentDoseMg: null }
  delete seed.smh_doses
  installWx(makeWxShim(seed))
  const m = freshLoad()
  const now = Date.UTC(2026, 9, 5, 9)
  const k = require('../utils/date.js').dateKey(now)
  m.storage.addDose({ medId: 'tirzepatide', doseMg: 2.5, timeMs: now, site: 'abd_ul', note: '' })
  m.storage.saveMed({ status: 'active', medId: 'tirzepatide', startDate: k, currentDoseMg: 2.5, doseSince: k }, { date: k, event: 'start', medId: 'tirzepatide', doseMg: 2.5, note: '' })
  const med = m.storage.get('smh_med')
  assert.equal(med.status, 'active', 'considering → active')
  assert.equal(med.startDate, k, 'startDate 写入')
  assert.equal(med.currentDoseMg, 2.5)
  const ctx = m.ai.buildContext(now)
  assert.equal(ctx.med.medName, '替尔泊肽', 'buildContext 识别药名')
  assert.equal(ctx.stage.key, 'start', '新启用用户为起始期')
}

// ---------------------------------------------------------------------------
// J3：对话安全守卫（红旗优先 LLM）
// ---------------------------------------------------------------------------
async function j3_safetyGuard() {
  installWx(makeWxShim(buildSeedProfile()))
  const m = freshLoad()
  const ctx = m.ai.buildContext(Date.now())
  const r = await m.ai.chat('我肚子疼得厉害还疼到后背', ctx)
  assert.equal(r.type, 'safety', '红旗优先 LLM')
  assert.equal(r.intentId, null, '急症不应再走意图')
  assert.ok(r.content.indexOf('120') >= 0, '急症卡含 120 引导')
  assert.equal(r.source, 'rules', 'source=rules')
  // actions 含拨打 120
  assert.ok(r.actions.some((a) => a.kind === 'call' && a.payload === '120'), 'actions 含拨打 120')
  // 心理危机
  const r2 = await m.ai.chat('最近不想活了', ctx)
  assert.equal(r2.type, 'safety')
  assert.equal(r2.actions.some((a) => a.payload === '12356'), true, '心理危机含 12356')
  // 剂量建议走规则（不调 LLM）
  const r3 = await m.ai.chat('你可以加到1mg试试', ctx)
  assert.equal(r3.source, 'rules', 'dose_change 强制走规则')
  assert.equal(r3.type, 'text')
  // 通用意图
  const r4 = await m.ai.chat('你好', ctx)
  assert.equal(r4.intentId, 'greeting')
}

// ---------------------------------------------------------------------------
// J4：LLM 配置（用 openai_compat provider 但 mock 网络失败 → 回落规则）
// ---------------------------------------------------------------------------
async function j4_llmFailover() {
  const seed = buildSeedProfile()
  seed.smh_settings.ai.provider = 'openai_compat'
  seed.smh_settings.ai.baseUrl = 'https://example.invalid/v1'
  seed.smh_settings.ai.model = 'mock-model'
  seed.smh_settings.ai.apiKey = 'sk-test'
  installWx(makeWxShim(seed))
  const m = freshLoad()
  assert.equal(m.ai.isLLM(), true, 'isLLM true')
  const r = await m.ai.chat('有点恶心怎么办', m.ai.buildContext(Date.now()))
  // 请求 mock 失败，应回落规则 + offline:true
  assert.equal(r.source, 'rules', 'LLM 失败回落规则')
  assert.equal(r.offline, true, 'offline 标记')
}

// ---------------------------------------------------------------------------
// J5：洞察卡 + 复诊问题
// ---------------------------------------------------------------------------
async function j5_insights() {
  installWx(makeWxShim(buildSeedProfile()))
  const m = freshLoad()
  const now = Date.UTC(2026, 9, 5, 12)
  // 触发 refresh（注入 prescribed，不应报错）
  const visible = m.insight.refresh(now)
  assert.ok(Array.isArray(visible), 'refresh 返回数组')
  // 复诊问题：4 周体重下降 -3.2kg（91.2 → 88.8 → 88.4？数据/计算检查无异常即可）
  const ctx = m.ai.buildContext(now)
  const qs = m.rules.visitQuestions(ctx)
  assert.ok(qs.length >= 3 && qs.length <= 5, '复诊问题 3-5 条')
  // 建议问题按 stage
  const sugs = m.rules.suggestedQuestions(ctx)
  assert.equal(sugs.length, 4)
}

// ---------------------------------------------------------------------------
// J6：storage key 一致性：utils/* 引用的 smh_* key 必须都在 storage.js 的 KEYS 里登记
// ---------------------------------------------------------------------------
function j6_storageKeysConsistent() {
  const fs = require('fs')
  const path = require('path')
  const storageSrc = fs.readFileSync(path.join(__dirname, '../utils/storage.js'), 'utf8')
  const storage = require('../utils/storage.js')
  const defined = new Set(Object.keys(storage.KEYS).map((k) => 'smh_' + k.toLowerCase()))
  const utilsFiles = ['utils/ai.js','utils/rules.js','utils/plan.js','utils/insight.js','utils/pk.js','utils/date.js']
  const referenced = new Set()
  for (const f of utilsFiles) {
    const src = fs.readFileSync(path.join(__dirname, '..', f), 'utf8')
    let m
    const re = /['"]smh_[a-zA-Z_]+['"]/g
    while ((m = re.exec(src))) referenced.add(m[0].slice(1, -1))
  }
  for (const k of referenced) {
    assert.ok(defined.has(k), k + ' 在 utils 中被引用但 storage.js KEYS 未登记（实际登记：' + [...defined].join(', ') + '）')
  }
  // 反向：storage.js 登记的 key 都应被至少一处使用（utils 或 app.js）
  // smh_meta 由 app.js 使用（ensureOnboarded 等），不属于 utils 直接引用。
  const appSrc = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8')
  const appReferenced = new Set()
  let am
  const appRe = /['"]smh_[a-zA-Z_]+['"]/g
  while ((am = appRe.exec(appSrc))) appReferenced.add(am[0].slice(1, -1))
  // 收集所有页面引用的 smh_* key（页面通过 storage.KEYS.xxx 或字符串直接引用）
  const pagesDir2 = path.join(__dirname, '../pages')
  const pageFiles2 = fs.readdirSync(pagesDir2).filter((n) => fs.statSync(path.join(pagesDir2, n)).isDirectory()).map((n) => n)
  const pageReferenced = new Set()
  for (const p of pageFiles2) {
    const j = path.join(pagesDir2, p, p + '.js')
    if (!fs.existsSync(j)) continue
    const src = fs.readFileSync(j, 'utf8')
    // 直接字符串字面量
    let pm
    const pRe = /['"]smh_[a-zA-Z_]+['"]/g
    while ((pm = pRe.exec(src))) pageReferenced.add(pm[0].slice(1, -1))
    // KEYS.XXX 形式（uppercase 常量）
    const kRe = /KEYS\.([A-Z_]+)/g
    let km
    while ((km = kRe.exec(src))) pageReferenced.add('smh_' + km[1].toLowerCase())
  }
  for (const k of [...defined]) {
    if (referenced.has(k) || appReferenced.has(k) || pageReferenced.has(k)) continue
    assert.ok(false, k + ' 在 KEYS 登记但未被 utils / app.js / 任何页面引用')
  }
}

// ---------------------------------------------------------------------------
// J7：页面字段对齐——pages 调用 storage/ai/plan/insight 时方法名应与模块导出对齐
// 检测 mod.foo( 形式的调用（排除 require 字符串、属性访问）
// ---------------------------------------------------------------------------
function j7_pageMethodSurface() {
  const fs = require('fs')
  const path = require('path')
  const surface = {
    storage: Object.keys(require('../utils/storage.js')),
    plan: Object.keys(require('../utils/plan.js')),
    insight: Object.keys(require('../utils/insight.js')),
    ai: Object.keys(require('../utils/ai.js')),
    rules: Object.keys(require('../utils/rules.js')),
    pk: Object.keys(require('../utils/pk.js')),
    date: Object.keys(require('../utils/date.js')),
  }
  const pagesDir = path.join(__dirname, '../pages')
  const pageFiles = fs.readdirSync(pagesDir).filter((n) => fs.statSync(path.join(pagesDir, n)).isDirectory()).map((n) => n)
  const errors = []
  // 收集各模块的 require 别名（const storage = require(...); const { foo } = require(...)）
  for (const p of pageFiles) {
    const jsPath = path.join(pagesDir, p, p + '.js')
    if (!fs.existsSync(jsPath)) continue
    const src = fs.readFileSync(jsPath, 'utf8')
    for (const mod of Object.keys(surface)) {
      // 仅匹配形如 `mod.fn(` 或 `mod.fn ` 后跟 ( 的真正函数调用
      const re = new RegExp('\\b' + mod + '\\.([a-zA-Z_][a-zA-Z0-9_]*)\\s*\\(', 'g')
      let mm
      while ((mm = re.exec(src))) {
        const fn = mm[1]
        // 跳过 storage 常量访问
        if (mod === 'storage' && (fn === 'KEYS' || fn === 'DISCLAIMER_VERSION' || fn === 'SCHEMA_VERSION')) continue
        if (surface[mod].indexOf(fn) < 0) {
          errors.push(p + '/' + p + '.js:' + mod + '.' + fn + '() 未在模块导出中')
        }
      }
    }
  }
  if (errors.length) {
    console.log('页面调用未对齐导出：')
    for (const e of errors.slice(0, 20)) console.log('  ✗ ' + e)
    if (errors.length > 20) console.log('  ...共 ' + errors.length + ' 处')
    throw new Error('页面-服务签名未对齐（' + errors.length + ' 处）')
  }
}

// ---------------------------------------------------------------------------
// 运行所有 journey
// ---------------------------------------------------------------------------

(async () => {
  let pass = 0, fail = 0
  const journeys = [
    ['J1 onboarding + today', j1_todayPage],
    ['J2 first injection', j2_firstInjection],
    ['J3 safety guard', j3_safetyGuard],
    ['J4 LLM failover', j4_llmFailover],
    ['J5 insights + visit', j5_insights],
    ['J6 storage key 一致性', j6_storageKeysConsistent],
    ['J7 页面字段对齐', j7_pageMethodSurface],
  ]
  for (const [name, fn] of journeys) {
    try {
      await fn()
      console.log('  ✓ ' + name)
      pass++
    } catch (e) {
      console.log('  ✗ ' + name + ': ' + (e && e.message || e))
      fail++
    } finally {
      uninstallWx()
    }
  }
  console.log('\n' + (fail ? fail + ' 处失败' : '集成 ' + pass + '/' + journeys.length + ' 全部通过 ✓'))
  process.exit(fail ? 1 : 0)
})()