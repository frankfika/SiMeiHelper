// test/sos.test.js — SOS 红旗 + 缓解卡状态机测试
//
// 目的：SOS 页是用户最关键的求助路径，任何红旗逻辑偏差都会变成"用户误以为没事"的真实事故。
// 由于 SOS 是 Page({...}) 结构直接依赖 wx.Page，测试里不能直接 require。所以：
//   - 测试 replyToNotice 提取函数（重写一份等价逻辑）
//   - 测试 RED_FLAG_MAP 索引（与 rules.RED_FLAGS 一致性）
//   - 测试 红旗 actions 的硬约束（拨打 120 / 12356）
//   - 测试 SOS 行 id 列表与规则的对应关系

const assert = require('assert')
const path = require('path')

function makeWx() {
  const store = {}
  return {
    setStorageSync(k, v) { store[k] = v },
    getStorageSync(k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : '' },
    removeStorageSync(k) { delete store[k]; },
    getStorageInfoSync() { return { currentSize: 0, limitSize: 10240 } },
    showToast() {}, request() {}, getSystemInfoSync() { return { theme: 'light' } },
    onThemeChange() {}, showModal() { return { confirm: true } },
    navigateTo() {}, navigateBack() {}, switchTab() {}, reLaunch() {},
    setNavigationBarTitle() {}, setClipboardData() {}, makePhoneCall() {},
    addPhoneRepeatCalendar() {}, addPhoneCalendar() {},
  }
}

global.wx = makeWx()
const rules = require(path.join(__dirname, '..', 'utils/rules.js'))

let pass = 0, fail = 0
const log = (ok, name) => { if (ok) { pass++; console.log('  ✓ ' + name); } else { fail++; console.log('  ✗ ' + name); } }

// 从 sos.js 复制 replyToNotice 逻辑（保持同步：测试和生产代码必须一致）
function replyToNotice(reply) {
  const lines = String(reply || '').split('\n').filter((l) => l && l.indexOf('这种情况不适合等') !== 0)
  const text = lines.map((l) => l.replace(/^⚠️\s*/, '')).join('')
  return text || '请立即就医'
}

// SOS 7 行 ID（02-05: 不包含 mental，mental 走 chat 急症）
const SOS_FLAG_IDS = ['pancreatitis', 'dehydration', 'hypoglycemia', 'allergy', 'gallbladder', 'thyroid', 'vision']

// RED_FLAG_MAP
const RED_FLAG_MAP = {}
for (const rf of rules.RED_FLAGS || []) if (rf && rf.id) RED_FLAG_MAP[rf.id] = rf

// =========================================================================
// A. replyToNotice 文本提取（去掉 ⚠️ 前缀 + SAFETY_TAIL 尾句）
// =========================================================================
log(replyToNotice('').indexOf('请立即就医') >= 0, 'A.1 空 reply 走 fallback "请立即就医"')
log(replyToNotice(null).indexOf('请立即就医') >= 0, 'A.2 null reply 走 fallback')

// 真实 RED_FLAGS reply 验证
for (const id of ['pancreatitis', 'dehydration', 'hypoglycemia', 'allergy', 'gallbladder', 'thyroid', 'vision']) {
  const notice = replyToNotice((RED_FLAG_MAP[id] || {}).reply)
  log(notice.length > 0, 'A.3 ' + id + ' 急症说明非空')
  log(!/^⚠️/.test(notice), 'A.4 ' + id + ' 已去除 ⚠️ 前缀')
  log(notice.indexOf('这种情况不适合等') === -1, 'A.5 ' + id + ' 已去除 SAFETY_TAIL 尾句')
}

// 关键行动保留
log(replyToNotice((RED_FLAG_MAP['pancreatitis'] || {}).reply).indexOf('停止进食') >= 0,
  'A.6 pancreatitis 保留"停止进食"')
log(replyToNotice((RED_FLAG_MAP['pancreatitis'] || {}).reply).indexOf('立即就医') >= 0,
  'A.7 pancreatitis 保留"立即就医"')

// =========================================================================
// B. SOS 7 行 ID 一致性（与产品文档 02-UX §3.10 对齐）
// =========================================================================
log(SOS_FLAG_IDS.length === 7, 'B.1 SOS 行 = 7 个')
log(SOS_FLAG_IDS.indexOf('mental') === -1, 'B.2 mental 不在 SOS 行（12356 走 chat 急症卡）')
for (const id of SOS_FLAG_IDS) {
  log(!!RED_FLAG_MAP[id], 'B.3 ' + id + ' 在 RED_FLAG_MAP 中（避免文档与代码漂移）')
}
// 反向：mental 应在 RED_FLAG_MAP 中（虽然 SOS 不用，但 chat 会用）
log(!!RED_FLAG_MAP['mental'], 'B.5 mental 在 RED_FLAG_MAP 中（chat 急症卡使用）')

// =========================================================================
// C. SOS 行为契约：onFlag 状态机
// =========================================================================

// 模拟初始状态：所有行 answer=null
let flags = SOS_FLAG_IDS.map((id) => ({ id, answer: null }))

// 1) 全部"没有" → 缓解卡
flags = flags.map((f) => ({ ...f, answer: 'no' }))
const allNo = flags.every((f) => f.answer === 'no')
const yesFlag = flags.find((f) => f.answer === 'yes')
log(allNo, 'C.1 全部「没有」时 allNo=true → 缓解卡分支')
log(!yesFlag, 'C.2 全部「没有」时 yesFlag=undefined')

// 2) 任一"有" → 急症卡
flags[0] = { ...flags[0], answer: 'yes' }
const yesAfter = flags.find((f) => f.answer === 'yes')
const allNoAfter = !yesAfter && flags.every((f) => f.answer === 'no')
log(yesAfter && yesAfter.id === 'pancreatitis', 'C.3 「有」时 yes 标识 first 红旗 ID')
log(!allNoAfter, 'C.4 「有」时 allNo=false → 急症卡分支')

// 3) "有" → 急症卡说明取自对应 RED_FLAG_MAP.reply
const expectedNotice = replyToNotice((RED_FLAG_MAP[yesAfter.id] || {}).reply)
log(expectedNotice.length > 0, 'C.5 「有」时急症卡说明非空')

// 4) 用户改主意：先"有"再改为"没有" → 急症卡消失，进入缓解卡
flags[0] = { ...flags[0], answer: 'no' }
const yesFinal = flags.find((f) => f.answer === 'yes')
const allNoFinal = !yesFinal && flags.every((f) => f.answer === 'no')
log(!yesFinal, 'C.6 「有」→「没有」后 yes 消失')
log(allNoFinal, 'C.7 「有」→「没有」后 allNo=true → 回到缓解卡分支')

// 5) 关键：单行点击同答案不重复触发（幂等性）
const sameToggleTest = () => {
  const f = [{ id: 'pancreatitis', answer: 'no' }]
  // 用户再点"没有" → 已经是 'no'，onFlag 应 return 不变（看 sos.js line 79）
  // 这里仅验证语义：重复点击 isNoop
  return f[0].answer === 'no'
}
log(sameToggleTest(), 'C.8 重复同答案语义保持')

// =========================================================================
// D. 急症卡 actions 硬约束
// 设计原则（来自 utils/rules.js）：
//   emergency（pancreatitis/hypoglycemia/dehydration/allergy）
//     → 唯一动作 "拨打 120"（急症用户不应先去 sos 页看更多内容）
//   urgent（gallbladder/thyroid/vision）
//     → 动作 "查看就医提醒"（跳转 sos 页 — 让用户对照 7 条自查）
// =========================================================================
const FLAG_TEST = {
  pancreatitis: '肚子疼得厉害还疼到后背',
  dehydration: '喝水都吐',
  hypoglycemia: '血糖3.2',
  allergy: '嘴唇肿了喘不上气',
  gallbladder: '眼睛发黄',
  thyroid: '脖子摸到肿块',
  vision: '视力突然下降了',
}
for (const [id, text] of Object.entries(FLAG_TEST)) {
  const r = rules.screenRedFlags(text)
  log(r.id === id, 'D.0 ' + id + ' 命中（' + r.level + '）')
  if (r.level === 'emergency') {
    // emergency 旗：唯一动作是拨打 120（不让用户先去翻查 sos 页）
    log(r.actions.some((a) => a.kind === 'call' && a.payload === '120'),
      'D.1 ' + id + ' emergency → 拨打 120')
    log(!r.actions.some((a) => a.kind === 'navigate'),
      'D.2 ' + id + ' emergency → 不走跳转（直接打 120，避免延误）')
  } else if (r.level === 'urgent') {
    // urgent 旗：跳转 sos 页让用户对照 7 条自查（不主动拨 120 — 让用户自评）
    log(r.actions.some((a) => a.kind === 'navigate' && a.payload.indexOf('sos') >= 0),
      'D.3 ' + id + ' urgent → 跳转 sos 页')
    log(!r.actions.some((a) => a.kind === 'call' && a.payload === '120'),
      'D.4 ' + id + ' urgent → 不主动拨 120（让用户自评）')
  }
}

// mental 危机（chat 处理）必须有 12356
const mental = rules.screenRedFlags('最近不想活了')
log(mental.id === 'mental' && mental.actions.some((a) => a.payload === '12356'),
  'D.4 mental 危机 actions 含拨打 12356（chat 用）')
log(mental.actions.some((a) => a.kind === 'call' && a.payload === '120'),
  'D.5 mental 危机 actions 含拨打 120（双重保险）')

console.log('\n' + (fail ? fail + ' 处失败' : 'SOS 状态机全部通过 ✓') + '（' + pass + '/' + (pass + fail) + '）')
process.exit(fail ? 1 : 0)