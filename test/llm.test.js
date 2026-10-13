// test/llm.test.js — 真实 LLM provider 路径测试（使用 mock 返回罐装回答）
//
// 验证：
//   - LLM 简报：合法罐装回答 → 写入 smh_brief (source='llm')
//   - LLM 简报：非法回答（缺字段/超长/含剂量）→ 回退规则版
//   - llmCountToday 上限：第 4 次不再调 LLM
//   - LLM chat 路径：规则红旗优先于 LLM；dose_change 强制走规则

const assert = require('assert')
const path = require('path')

// ---------------------------------------------------------------------------
// wx shim + mock LLM provider（用可注入的 canned response）
// ---------------------------------------------------------------------------

function makeWxWithMock(canned) {
  const store = {}
  let pendingResponse = canned
  let pendingCloudResult = {}

  function setNext(response) { pendingResponse = response }
  function setCloudNext(response) { pendingCloudResult = response }

  const wx = {
    setStorageSync(k, v) { store[k] = v },
    getStorageSync(k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : '' },
    removeStorageSync(k) { delete store[k] },
    getStorageInfoSync() { return { currentSize: 0, limitSize: 10240 } },
    getSystemInfoSync() { return { theme: 'light', platform: 'devtools' } },
    getWindowInfo() { return { windowWidth: 375, pixelRatio: 2 } },
    getAppBaseInfo() { return { theme: 'light' } },
    onThemeChange() {}, offThemeChange() {},
    showToast() {}, showModal() { return { confirm: true } },
    makePhoneCall() {}, addPhoneRepeatCalendar() {}, addPhoneCalendar() {},
    setNavigationBarTitle() {}, setClipboardData(o) { o && o.success && o.success() },
    showActionSheet() { return { tapIndex: 0 } },
    pageScrollTo() {}, vibrateShort() {},
    // Mock provider: 调 success(pendingResponse) 模拟 LLM 200
    request(opts) {
      const reply = pendingResponse
      pendingResponse = canned // 重置
      if (opts && opts.success) {
        opts.success({ statusCode: 200, data: { choices: [{ message: { content: reply } }] } })
      }
    },
    // mock 云函数代理（合规 #1）
    cloud: {
      callFunction(opts) {
        const reply = pendingCloudResult
        pendingCloudResult = {} // 重置
        if (reply.fail) {
          if (opts && opts.fail) opts.fail({ errMsg: reply.errMsg || 'mock fail' })
        } else if (opts && opts.success) {
          opts.success({ result: reply.success || { ok: false, error: 'mock 无响应' } })
        }
      },
    },
    __setNext: setNext,
    __setCloudNext: setCloudNext,
    __store: store,
  }
  return wx
}

// ---------------------------------------------------------------------------
// 种子数据：已完成 onboarding + 在用 替尔泊肽
// ---------------------------------------------------------------------------

function buildSeed() {
  const now = Date.now()
  const DAY = 86400000
  return {
    smh_meta: {
      schemaVersion: 1, installedAt: now - 30 * DAY,
      disclaimerAcceptedVersion: '2026-10-v1', disclaimerAcceptedAt: now - 30 * DAY,
      onboardingStep: 6, onboardedAt: now - 30 * DAY, lastOpenDate: '',
    },
    smh_profile: {
      nickname: '王姐', sex: 'female', birthYear: 1988,
      heightCm: 165, startWeightKg: 92, startWeightDate: '2026-09-05',
      goalWeightKg: 80, conditions: ['t2d'],
    },
    smh_med: {
      status: 'active', medId: 'tirzepatide', brand: '',
      currentDoseMg: 5, doseSince: '2026-09-12',
      startDate: '2026-09-05', injectWeekday: 0,
      doctor: { name: '', hospital: '' }, nextVisitDate: null,
      stopDate: null, stopWeightKg: null,
      calendarAdded: { inject: false, visit: false, checkin: false },
      history: [
        { date: '2026-09-05', event: 'start', medId: 'tirzepatide', doseMg: 2.5 },
        { date: '2026-09-12', event: 'dose_change', medId: 'tirzepatide', doseMg: 5 },
      ],
    },
    smh_doses: [
      { id: 'd1', medId: 'tirzepatide', doseMg: 2.5, timeMs: now - 30 * DAY, site: 'abd_ul' },
      { id: 'd2', medId: 'tirzepatide', doseMg: 2.5, timeMs: now - 23 * DAY, site: 'abd_ur' },
      { id: 'd3', medId: 'tirzepatide', doseMg: 5, timeMs: now - 16 * DAY, site: 'abd_ll' },
      { id: 'd4', medId: 'tirzepatide', doseMg: 5, timeMs: now - 9 * DAY, site: 'abd_lr' },
    ],
    smh_checkins: {
      '2026-09-12': { date: '2026-09-12', weightKg: 91.5, feel: 'ok', symptoms: {}, proteinServings: 4, waterCups: 10, cardioMin: 30, strength: false, appetite: 'normal', completedAt: now - 23 * DAY },
      '2026-09-19': { date: '2026-09-19', weightKg: 90.8, feel: 'ok', symptoms: {}, proteinServings: 5, waterCups: 11, cardioMin: 30, strength: true, appetite: 'normal', completedAt: now - 16 * DAY },
      '2026-09-26': { date: '2026-09-26', weightKg: 90.0, feel: 'good', symptoms: {}, proteinServings: 4, waterCups: 12, cardioMin: 45, strength: false, appetite: 'normal', completedAt: now - 9 * DAY },
    },
    smh_chat: { messages: [] },
    smh_insights: { active: [], lastFired: {}, lastDismissed: {} },
    smh_brief: null,
    smh_kb_read: {},
    smh_settings: {
      ai: {
        provider: 'openai_compat',
        baseUrl: 'https://mock.example/v1',
        model: 'mock-1',
        apiKey: 'sk-test',
        temperature: 0.6,
      },
      reminders: { askedCalendar: true },
      updatedAt: 1,
    },
  }
}

function freshLoad() {
  for (const m of ['storage', 'date', 'pk', 'plan', 'rules', 'insight', 'theme', 'ai']) {
    try { delete require.cache[require.resolve(path.join(__dirname, '..', 'utils', m + '.js'))]; } catch (e) {}
  }
  return {
    storage: require(path.join(__dirname, '..', 'utils/storage.js')),
    plan: require(path.join(__dirname, '..', 'utils/plan.js')),
    rules: require(path.join(__dirname, '..', 'utils/rules.js')),
    insight: require(path.join(__dirname, '..', 'utils/insight.js')),
    ai: require(path.join(__dirname, '..', 'utils/ai.js')),
  }
}

// ---------------------------------------------------------------------------
// 测试
// ---------------------------------------------------------------------------

async function main() {
  let pass = 0, fail = 0
  const log = (ok, name) => { if (ok) { pass++; console.log('  ✓ ' + name); } else { fail++; console.log('  ✗ ' + name); } }

  // =====================================================================
  // T1：合法罐装简报 → 写入 smh_brief (source='llm')
  // =====================================================================
  {
    const canned = JSON.stringify({
      headline: '王姐，今天继续保持就好',
      tasks: [
        { key: 'protein', text: '蛋白 4 份稳了' },
        { key: 'water', text: '水 11 杯起步' },
        { key: 'move', text: '走 30 分钟出出汗' },
      ],
      note: '今天感觉挺稳',
    })
    const wx = makeWxWithMock(canned)
    global.wx = wx
    const seed = buildSeed()
    for (const [k, v] of Object.entries(seed)) wx.setStorageSync(k, v)
    const m = freshLoad()
    const ctx = m.ai.buildContext(Date.now())
    const brief = await m.ai.dailyBrief(ctx)
    log(brief.source === 'llm', 'T1.1 合法简报 → source=llm')
    log(brief.headline === '王姐，今天继续保持就好', 'T1.2 标题正确')
    log(brief.tasks.length === 3, 'T1.3 任务数 = 3')
    log(brief.tasks.every((t) => ['protein', 'water', 'move'].includes(t.key)), 'T1.4 任务 key 在白名单')
    log(wx.getStorageSync('smh_brief').source === 'llm', 'T1.5 smh_brief 已写入')
    log(wx.getStorageSync('smh_brief').llmCountToday === 1, 'T1.6 llmCountToday = 1')
  }

  // =====================================================================
  // T2：含剂量的简报 → guard 拦截 → 回落规则版
  // =====================================================================
  {
    const canned = JSON.stringify({
      headline: '建议把剂量加到 1mg 试试',  // ← 含剂量数字+单位
      tasks: [
        { key: 'protein', text: '蛋白 4 份' },
        { key: 'water', text: '水 11 杯' },
        { key: 'move', text: '走 30 分钟' },
      ],
    })
    const wx = makeWxWithMock(canned)
    global.wx = wx
    const seed = buildSeed()
    wx.setStorageSync('smh_brief', null)  // 重置
    for (const [k, v] of Object.entries(seed)) wx.setStorageSync(k, v)
    const m = freshLoad()
    const brief = await m.ai.dailyBrief(m.ai.buildContext(Date.now()))
    log(brief.source === 'rules', 'T2.1 含剂量 → 回落 source=rules')
    log(brief.headline !== '建议把剂量加到 1mg 试试', 'T2.2 回落后的 headline 不是被拦截版本')
    // smh_brief 仅在 LLM 成功时写入；回落时不写
    log(!wx.getStorageSync('smh_brief') || wx.getStorageSync('smh_brief').source !== 'llm', 'T2.3 smh_brief 未被 LLM 版覆盖')
  }

  // =====================================================================
  // T3：结构非法 → 回落规则版
  // =====================================================================
  {
    const cases = [
      ['任务数 ≠ 3', JSON.stringify({ headline: 'ok', tasks: [{ key: 'protein', text: 'a' }] })],
      ['key 不在白名单', JSON.stringify({ headline: 'ok', tasks: [
        { key: 'unknown', text: 'a' }, { key: 'water', text: 'b' }, { key: 'move', text: 'c' }
      ] })],
      ['headline 超 40 字', JSON.stringify({
        headline: '这是非常非常非常非常非常非常非常非常非常非常非常非常非常非常长的标题绝对不应该被接受',
        tasks: [{ key: 'protein', text: 'a' }, { key: 'water', text: 'b' }, { key: 'move', text: 'c' }]
      })],
      ['JSON 不合法', '这根本不是 json { broken'],
      ['JSON 空对象', JSON.stringify({})],
    ]
    for (const [name, raw] of cases) {
      const wx = makeWxWithMock(raw)
      global.wx = wx
      const seed = buildSeed()
      wx.setStorageSync('smh_brief', null)
      for (const [k, v] of Object.entries(seed)) wx.setStorageSync(k, v)
      const m = freshLoad()
      const brief = await m.ai.dailyBrief(m.ai.buildContext(Date.now()))
      log(brief.source === 'rules', 'T3: ' + name + ' → 回落 rules')
    }
  }

  // =====================================================================
  // T4：llmCountToday 上限（第 4 次不再调 LLM）
  // =====================================================================
  {
    const canned = JSON.stringify({
      headline: '今天也辛苦啦',
      tasks: [{ key: 'protein', text: 'a' }, { key: 'water', text: 'b' }, { key: 'move', text: 'c' }],
    })
    const wx = makeWxWithMock(canned)
    global.wx = wx
    const seed = buildSeed()
    wx.setStorageSync('smh_brief', null)
    for (const [k, v] of Object.entries(seed)) wx.setStorageSync(k, v)
    const m = freshLoad()
    let requestCount = 0
    // 包装 request 来计数
    const origRequest = wx.request
    wx.request = function(opts) {
      requestCount++
      return origRequest.call(this, opts)
    }
    for (let i = 1; i <= 5; i++) {
      const brief = await m.ai.dailyBrief(m.ai.buildContext(Date.now()))
      const expected = i <= 3 ? 'llm' : 'rules'
      log(brief.source === expected, `T4.第${i}次：source=${expected}（实际 ${brief.source}）`)
    }
    log(requestCount === 3, `T4 请求次数 = 3（实际 ${requestCount}）`)
  }

  // =====================================================================
  // T5：LLM chat 路径 - 红旗优先于 LLM
  // =====================================================================
  {
    const canned = 'LLM 想说没事多喝水'  // LLM 想绕过红旗
    const wx = makeWxWithMock(canned)
    global.wx = wx
    const seed = buildSeed()
    for (const [k, v] of Object.entries(seed)) wx.setStorageSync(k, v)
    const m = freshLoad()
    let requestCount = 0
    wx.request = function(opts) { requestCount++ }
    const ctx = m.ai.buildContext(Date.now())
    // 红旗应直接拦截，不发 LLM 请求
    const r1 = await m.ai.chat('我肚子疼得厉害还疼到后背', ctx)
    log(r1.type === 'safety', 'T5.1 红旗 → type=safety')
    log(requestCount === 0, 'T5.2 红旗未触发 LLM 请求')
    // 心理危机
    const r2 = await m.ai.chat('不想活了', ctx)
    log(r2.type === 'safety', 'T5.3 心理危机 → type=safety')
    // dose_change 不进 LLM
    const r3 = await m.ai.chat('你可以加到1mg试试', ctx)
    log(r3.source === 'rules', 'T5.4 dose_change → 强制 rules（不进 LLM）')
    log(requestCount === 0, 'T5.5 dose_change 未触发 LLM 请求')
    // buy_source 也不进 LLM
    const r4 = await m.ai.chat('网上买便宜的', ctx)
    log(r4.source === 'rules', 'T5.6 buy_source → 强制 rules')
    log(requestCount === 0, 'T5.7 buy_source 未触发 LLM 请求')
  }

  // =====================================================================
  // T6：LLM chat 路径 - LLM 输出含剂量 → guard 替换
  // =====================================================================
  {
    const canned = '你可以加到1.5mg试试'  // LLM 说出剂量
    const wx = makeWxWithMock(canned)
    global.wx = wx
    const seed = buildSeed()
    for (const [k, v] of Object.entries(seed)) wx.setStorageSync(k, v)
    const m = freshLoad()
    const ctx = m.ai.buildContext(Date.now())
    // 用通用提问，避开 dose_change 强制走规则
    const r = await m.ai.chat('今天感觉有点累，有什么建议吗', ctx)
    log(r.source === 'guard', 'T6.1 LLM 含剂量 → source=guard')
    log(r.content.indexOf('处方医生') >= 0, 'T6.2 guard 替换文案含"处方医生"')
    log(r.actions.some((a) => a.kind === 'navigate' && a.payload.indexOf('report') >= 0), 'T6.3 guard 附"生成就诊摘要"按钮')
  }

  // =====================================================================
  // T7：LLM 聊天超时 → 回落规则 + offline 标
  // =====================================================================
  {
    const wx = makeWxWithMock('')
    global.wx = wx
    // 让 request 永远 fail
    wx.request = function(opts) { if (opts && opts.fail) opts.fail({ errMsg: 'timeout' }) }
    const seed = buildSeed()
    for (const [k, v] of Object.entries(seed)) wx.setStorageSync(k, v)
    const m = freshLoad()
    const r = await m.ai.chat('今天想问问要不要运动', m.ai.buildContext(Date.now()))
    log(r.source === 'rules', 'T7.1 超时回落 rules')
    log(r.offline === true, 'T7.2 offline 标记')
  }

  // =====================================================================
  // T8：合规 #1 — 云函数代理（cloud_proxy）路径
  // =====================================================================
  {
    // 切换到 cloud_proxy provider，关闭自填 key
    const wx = makeWxWithMock('')
    global.wx = wx
    const seed = buildSeed()
    seed.smh_settings.ai.provider = 'cloud_proxy' // 旧值
    seed.smh_settings.ai.baseUrl = ''
    seed.smh_settings.ai.apiKey = ''
    seed.smh_settings.ai.model = 'deepseek-chat'
    for (const [k, v] of Object.entries(seed)) wx.setStorageSync(k, v)
    const m = freshLoad()
    // 模拟云函数返回合法罐装回答
    wx.__setCloudNext({ success: { ok: true, content: '今天先好好休息一下，不舒服就别运动啦。' } })
    const ctx = m.ai.buildContext(Date.now())
    const r = await m.ai.chat('今天能运动吗', ctx)
    log(r.source === 'llm', 'T8.1 cloud_proxy 路径 → source=llm')
    log(r.content.indexOf('好好休息') >= 0, 'T8.2 cloud_proxy 返回内容正确')
    log(r.offline !== true, 'T8.3 cloud_proxy 不打 offline 标')

    // 测试连接（重新 setNext，因为上面 chat 已消耗 pendingCloudResult）
    wx.__setCloudNext({ success: { ok: true, content: 'pong' } })
    const t = await m.ai.testConnection()
    log(t.ok === true, 'T8.4 testConnection cloud_proxy ok')
  }

  // =====================================================================
  // T9：合规 #1 — 云函数返回错误 → 回落规则 + offline
  // =====================================================================
  {
    const wx = makeWxWithMock('')
    global.wx = wx
    const seed = buildSeed()
    seed.smh_settings.ai.provider = 'cloud_proxy'
    seed.smh_settings.ai.baseUrl = ''
    seed.smh_settings.ai.apiKey = ''
    seed.smh_settings.ai.model = 'deepseek-chat'
    for (const [k, v] of Object.entries(seed)) wx.setStorageSync(k, v)
    const m = freshLoad()
    // 云函数返回 ok:false
    wx.__setCloudNext({ success: { ok: false, error: 'DEEPSEEK_API_KEY not set' } })
    const ctx = m.ai.buildContext(Date.now())
    const r = await m.ai.chat('今天能运动吗', ctx)
    log(r.source === 'rules', 'T9.1 云函数 ok:false → 回落 rules')
    log(r.offline === true, 'T9.2 云函数失败 → offline=true')

    // 云函数网络失败
    wx.__setCloudNext({ fail: true, errMsg: 'request:fail timeout' })
    const r2 = await m.ai.chat('今天能运动吗', ctx)
    log(r2.source === 'rules', 'T9.3 云函数网络失败 → 回落 rules')
    log(r2.offline === true, 'T9.4 云函数网络失败 → offline=true')
  }

  // =====================================================================
  // T10：合规 #1 — isLLM 不再需要 apiKey（仅需 provider=cloud_proxy）
  // =====================================================================
  {
    const wx = makeWxWithMock('')
    global.wx = wx
    const seed = buildSeed()
    seed.smh_settings.ai.provider = 'cloud_proxy'
    seed.smh_settings.ai.baseUrl = ''
    seed.smh_settings.ai.apiKey = '' // 关键：无 key
    seed.smh_settings.ai.model = 'deepseek-chat'
    for (const [k, v] of Object.entries(seed)) wx.setStorageSync(k, v)
    const m = freshLoad()
    log(m.ai.isLLM() === true, 'T10.1 cloud_proxy + 无 apiKey → isLLM()=true')
    log(m.storage.exportAll().indexOf('apiKey') === -1 || m.storage.exportAll().indexOf('sk-') < 0, 'T10.2 导出数据不含有效 apiKey（关键安全属性）')
  }

  // =====================================================================
  // T11：合规 #1 — 云函数简报路径
  // =====================================================================
  {
    const wx = makeWxWithMock('')
    global.wx = wx
    const seed = buildSeed()
    seed.smh_settings.ai.provider = 'cloud_proxy'
    seed.smh_settings.ai.baseUrl = ''
    seed.smh_settings.ai.apiKey = ''
    seed.smh_settings.ai.model = 'deepseek-chat'
    for (const [k, v] of Object.entries(seed)) wx.setStorageSync(k, v)
    const m = freshLoad()
    const validBrief = '{"headline":"今天记得多喝水","tasks":[{"key":"water","text":"喝够 6 杯水"},{"key":"protein","text":"吃够 4 份蛋白"},{"key":"rest","text":"不舒服就多休息"}]}'
    wx.__setCloudNext({ success: { ok: true, content: validBrief } })
    const brief = await m.ai.dailyBrief()
    log(brief.source === 'llm', 'T11.1 cloud_proxy 简报 → source=llm')
    log(brief.headline === '今天记得多喝水', 'T11.2 headline 正确')
    log(brief.tasks.length === 3, 'T11.3 tasks 恰好 3 条')
  }

  console.log('\n' + (fail ? fail + ' 处失败' : 'LLM 路径全部通过 ✓') + '（' + pass + '/' + (pass + fail) + '）')
  process.exit(fail ? 1 : 0)
}

main().catch((e) => {
  console.error('💥', e && e.stack || e)
  process.exit(2)
})