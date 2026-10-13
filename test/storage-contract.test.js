// test/storage-contract.test.js — 存储接口契约测试（锁住"返回值是 map 不是单条记录"的行为）
//
// 背景：utils/storage.js 的 update(key, fn) → set(key, fn(get(key))) → 返回 set 的最新值（即整张 map）。
// 所以 upsertCheckin / completeCheckin / addDose / saveMed 等都返回整张表（或整条 med），而不是单个 Checkin/Dose。
//
// 这个行为已被 docs/05-DATA.md 标注（Round 8 补遗）。本测试把它**变成断言**，未来如果有人
// 把 update 改成 return old[dateKey]，会立即失败。

const assert = require('assert')
const path = require('path')

// ---------------------------------------------------------------------------
// wx shim
// ---------------------------------------------------------------------------
function makeWx() {
  const store = {}
  return {
    setStorageSync(k, v) { store[k] = v },
    getStorageSync(k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : '' },
    removeStorageSync(k) { delete store[k] },
    showToast() {}, request() {}, getSystemInfoSync() { return { theme: 'light' } },
    onThemeChange() {}, showModal() { return { confirm: true } },
    navigateTo() {}, navigateBack() {}, switchTab() {}, reLaunch() {},
    setNavigationBarTitle() {}, setClipboardData() {},
  }
}

// ---------------------------------------------------------------------------
// 测试
// ---------------------------------------------------------------------------

let pass = 0, fail = 0
const log = (ok, name) => { if (ok) { pass++; console.log('  ✓ ' + name); } else { fail++; console.log('  ✗ ' + name); } }

global.wx = makeWx()
const storage = require(path.join(__dirname, '..', 'utils/storage.js'))

// ---------------------------------------------------------------------------
// 1. upsertCheckin 返回值是整张 checkins map（不是单条 Checkin）
// ---------------------------------------------------------------------------
{
  const r1 = storage.upsertCheckin('2026-10-05', { weightKg: 88.5 })
  log(typeof r1 === 'object' && !Array.isArray(r1), 'C1.1 upsertCheckin 返回 plain object（不是数组）')
  log('2026-10-05' in r1, 'C1.2 返回值包含当天 key')
  log(r1['2026-10-05'].weightKg === 88.5, 'C1.3 返回的 map 里今天数据正确')
  log(Object.keys(r1).length >= 1, 'C1.4 返回的是含当天记录的 map（至少 1 个 key）')
  // 文档警告：页面应使用 getCheckin(dateKey) 重读，**不要**直接访问返回值
}

// ---------------------------------------------------------------------------
// 2. completeCheckin 返回值同上
// ---------------------------------------------------------------------------
{
  storage.upsertCheckin('2026-10-05', { weightKg: 88.5 })
  const r2 = storage.completeCheckin('2026-10-05')
  log(typeof r2 === 'object' && !Array.isArray(r2), 'C2.1 completeCheckin 返回 plain object（整张 map）')
  log(r2['2026-10-05'].completedAt > 0, 'C2.2 完成时间戳写入')
}

// ---------------------------------------------------------------------------
// 3. addDose 返回单个 Dose 对象（不是 list）—— 与 upsertCheckin 不同！
// ---------------------------------------------------------------------------
{
  const r3 = storage.addDose({ medId: 'tirzepatide', doseMg: 5, timeMs: Date.now(), site: 'abd_ul' })
  log(typeof r3 === 'object' && !Array.isArray(r3), 'C3.1 addDose 返回 plain object（单个 Dose）')
  log(r3.medId === 'tirzepatide', 'C3.2 返回值含 medId 字段')
  log(typeof r3.id === 'string', 'C3.3 自动生成 id 字段')
  log(r3.doseMg === 5, 'C3.4 doseMg 正确')
}

// ---------------------------------------------------------------------------
// 4. saveMed 返回整条 med（不是 patch）
// ---------------------------------------------------------------------------
{
  storage.saveMed({ status: 'active', medId: 'tirzepatide' })
  const r4 = storage.saveMed({ currentDoseMg: 5 }, { date: '2026-10-05', event: 'dose_change', medId: 'tirzepatide', doseMg: 5 })
  log(typeof r4 === 'object', 'C4.1 saveMed 返回 object（整条 med）')
  log(r4.status === 'active', 'C4.2 status 保持')
  log(r4.currentDoseMg === 5, 'C4.3 currentDoseMg 更新')
  log(Array.isArray(r4.history) && r4.history.length > 0, 'C4.4 history 事件追加')
}

// ---------------------------------------------------------------------------
// 5. appendChat 返回 undefined（与前四个不同）
// ---------------------------------------------------------------------------
{
  const before = storage.get('smh_chat') || { messages: [] }
  const r5 = storage.appendChat({ role: 'user', content: 'hello', type: 'text', ts: Date.now() })
  log(r5 === undefined, 'C5.1 appendChat 返回 undefined（注意：与上面 4 个不同）')
  const after = storage.get('smh_chat')
  log(after.messages.length === before.messages.length + 1, 'C5.2 chat.messages 长度 +1')
}

// ---------------------------------------------------------------------------
// 6. update() / set() / get() 基础契约
// ---------------------------------------------------------------------------
{
  storage.set('smh_test', { foo: 'bar' })
  log(storage.get('smh_test').foo === 'bar', 'C6.1 set + get 往返一致')
  const r6 = storage.update('smh_test', (v) => Object.assign({}, v, { extra: 1 }))
  log(r6 && r6.foo === 'bar' && r6.extra === 1, 'C6.2 update 返回新值')
  // 注意：utils/storage.js 不导出 remove()，页面直接用 wx.removeStorageSync(key)
  // 这里也直接调 shim 来验证 remove
  global.wx.removeStorageSync('smh_test')
  log(JSON.stringify(storage.get('smh_test')) === 'null', 'C6.3 wx.removeStorageSync 后 get 返回 null')
}

// ---------------------------------------------------------------------------
// 7. 关键 schema 字段名一致性（避免 typo / 字段漂移）
// ---------------------------------------------------------------------------
{
  log(typeof storage.DISCLAIMER_VERSION === 'string', 'C7.1 DISCLAIMER_VERSION 是字符串')
  log(typeof storage.SCHEMA_VERSION === 'number', 'C7.2 SCHEMA_VERSION 是数字')
  // KEYS 名称稳定性
  const expectedKeys = ['META', 'PROFILE', 'MED', 'DOSES', 'CHECKINS', 'CHAT', 'INSIGHTS', 'BRIEF', 'KB_READ', 'SETTINGS', 'ONB_DRAFT']
  log(JSON.stringify(Object.keys(storage.KEYS).sort()) === JSON.stringify(expectedKeys.sort()),
    'C7.3 KEYS 集合与文档一致（11 项）')
}

// ---------------------------------------------------------------------------
// 8. exportAll 不暴露明文 apiKey
// ---------------------------------------------------------------------------
{
  storage.update(storage.KEYS.SETTINGS, (s) => Object.assign({}, s, { ai: { provider: 'openai_compat', apiKey: 'sk-SECRET-KEY-12345', baseUrl: 'https://x', model: 'm', temperature: 0.6 } }))
  const json = storage.exportAll()
  log(json.indexOf('sk-SECRET-KEY-12345') === -1, 'C8.1 exportAll 不含明文 apiKey')
  log(json.indexOf('"apiKey": "***"') >= 0, 'C8.2 exportAll 用 *** 替换 apiKey')
  storage.clearAll()
}

console.log('\n' + (fail ? fail + ' 处失败' : 'storage 契约全部通过 ✓') + '（' + pass + '/' + (pass + fail) + '）')
process.exit(fail ? 1 : 0)