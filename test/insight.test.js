// test/insight.test.js — 在 Node 中运行: node test/insight.test.js
// 只测纯函数（evaluate / merge / visible / dismiss），固定时间戳，手工构造 InsightData，不依赖 wx。
const assert = require('assert');
const insight = require('../utils/insight.js');

const H = 3600000;
const D = 24 * H;
const NOW = Date.UTC(2026, 9, 5, 12); // 固定"现在"：2026-10-05 12:00 UTC

let sectionNo = 0;
function section(label) {
  sectionNo += 1;
  console.log(`\n[${sectionNo}] ${label}`);
}

// ---- 测试本地日期工具（与 §3.1 dateKey 语义一致：本地时区 'YYYY-MM-DD'）----
const pad2 = (n) => (n < 10 ? '0' : '') + n;
const dk = (ms) => {
  const d = new Date(ms);
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
};
const pk = (key) => {
  const p = key.split('-');
  return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2])).getTime();
};
const ad = (key, n) => dk(pk(key) + n * D);

const TODAY = '2026-10-05'; // InsightData.todayKey 为显式传入，固定值，与时区无关

// ---- 公共夹具 ----
const profile = {
  nickname: '王姐', sex: 'female', birthYear: 1988, heightCm: 165,
  startWeightKg: 92, startWeightDate: ad(TODAY, -28), goalWeightKg: 80,
  activityLevel: 'sedentary', conditions: [], createdAt: NOW, updatedAt: NOW,
};
const targets = {
  proteinG: 80, proteinServings: 4, waterMl: 2700, waterCups: 11,
  cardioMinDaily: 30, strengthPerWeek: 2, moveText: '每周 150 分钟中等强度 + 力量 2 次',
  refWeightKg: 68.1, basis: '',
};
const stage = { key: 'start', name: '起始期', week: 2 };
const medBase = {
  status: 'prescribed', medId: 'semaglutide', brand: '', startDate: ad(TODAY, -14),
  currentDoseMg: 0.5, doseSince: ad(TODAY, -14), injectWeekday: 1,
  doctor: { name: '', hospital: '' }, nextVisitDate: null, stopDate: null,
  stopWeightKg: null, calendarAdded: { inject: false, visit: false, checkin: false },
  history: [{ date: ad(TODAY, -14), event: 'start', medId: 'semaglutide', doseMg: 0.5, note: '' }],
  updatedAt: NOW,
};
const emptyState = { active: [], lastFired: {}, lastDismissed: {} };

function baseData(over) {
  return Object.assign({
    profile, med: Object.assign({}, medBase), doses: [], checkins: {},
    insightsState: { active: [], lastFired: {}, lastDismissed: {} },
    targets, stage, todayKey: TODAY,
  }, over);
}

function ruleIds(cards) {
  return cards.map((c) => c.ruleId);
}

// ===========================================================================
section('fast_loss：weeklyRatePct > 1.5 触发，冷却期内不重复触发');

// 近 14 天 3 个体重点：100 → 98 → 96 kg，最小二乘周减率 ≈ 2.2%/周 > 1.5
const flCheckins = {};
flCheckins[ad(TODAY, -13)] = { date: ad(TODAY, -13), weightKg: 100, symptoms: {} };
flCheckins[ad(TODAY, -7)] = { date: ad(TODAY, -7), weightKg: 98, symptoms: {} };
flCheckins[TODAY] = { date: TODAY, weightKg: 96, symptoms: {} };
const flData = baseData({ checkins: flCheckins });

const flCards = insight.evaluate(flData, NOW);
console.log('  首次 evaluate →', ruleIds(flCards));
assert.equal(flCards.length, 1, '夹具下应只触发 fast_loss 一张卡');
assert.equal(flCards[0].ruleId, 'fast_loss');
assert.equal(flCards[0].key, 'fast_loss');
assert.equal(flCards[0].priority, 80);
assert.ok(flCards[0].body.includes('-2.2%'), `body 应含周减率 -2.2%，实际：${flCards[0].body}`);
assert.ok(flCards[0].dismissedAt === null && typeof flCards[0].createdAt === 'number');
assert.deepEqual(flCards[0].cta, { label: '看「司美脸怎么防」', kind: 'navigate', payload: '/pages/article/article?id=kb_face' });

// 合并后立刻再 evaluate：lastFired 刚写入，处于 14 天冷却内，不得再出 fast_loss
const flState = insight.merge(flData.insightsState, flCards, NOW);
const flCards2 = insight.evaluate(Object.assign({}, flData, { insightsState: flState }), NOW);
console.log('  合并后立即 evaluate →', ruleIds(flCards2));
assert.equal(ruleIds(flCards2).includes('fast_loss'), false, '冷却期内不得重复触发');
assert.equal(flState.lastFired.fast_loss, NOW, 'merge 应写 lastFired');
// 冷却刚过 14 天则可再次出现
const flCards3 = insight.evaluate(
  Object.assign({}, flData, { insightsState: flState }),
  NOW + 14 * D
);
assert.equal(ruleIds(flCards3).includes('fast_loss'), true, '冷却期满（now − lastFired ≥ 14 天）应可再次触发');

// ===========================================================================
section('dose_overdue：once 语义，key 带上次注射日期后缀');

const odDose1 = NOW - 200 * H; // 距今 200h ≥ 192h → phase = overdue
const odMed = Object.assign({}, medBase, {
  status: 'active',
  currentDoseMg: 0.5,
  doseSince: ad(TODAY, -14),
});
const odData = baseData({
  med: odMed,
  doses: [{ id: 'd1', medId: 'semaglutide', doseMg: 0.5, timeMs: odDose1, site: 'abd_ll', note: '', createdAt: odDose1 }],
});
const odKey1 = 'dose_overdue:' + dk(odDose1);

const odCards = insight.evaluate(odData, NOW);
console.log('  首次 evaluate →', odCards.map((c) => c.key));
assert.equal(odCards.length, 1, '夹具下应只触发 dose_overdue');
assert.equal(odCards[0].key, odKey1, `key 应带日期后缀：${odKey1}`);
assert.ok(odCards[0].body.includes('不要一次打两针来补'), '漏打文案须带"不要一次打两针来补"（§4.5）');
assert.ok(odCards[0].body.includes('以你的医生为准'), 'missedRule 段落须跟随"以你的医生为准"（§4.5）');
assert.ok(odCards[0].body.includes('跳过'), 'body 应包含 missedRule 说明书内容');

// 同日期（同 key）再次 evaluate：lastFired 已存在 → once 类不再触发
const odState = insight.merge(odData.insightsState, odCards, NOW);
const odCards2 = insight.evaluate(Object.assign({}, odData, { insightsState: odState }), NOW);
console.log('  同日期再次 evaluate →', odCards2.map((c) => c.key));
assert.equal(odCards2.some((c) => c.ruleId === 'dose_overdue'), false, '同日期（once）不得再触发');

// 上次注射日期变化 → 新后缀 key → 可再次触发
const odDose2 = NOW - 14 * D - 2 * H; // 同样 overdue，但日期与第一次不同
const odData2 = baseData({
  med: odMed,
  doses: [{ id: 'd2', medId: 'semaglutide', doseMg: 0.5, timeMs: odDose2, site: 'abd_ur', note: '', createdAt: odDose2 }],
  insightsState: odState,
});
const odKey2 = 'dose_overdue:' + dk(odDose2);
const odCards3 = insight.evaluate(odData2, NOW);
console.log('  日期变化后 evaluate →', odCards3.map((c) => c.key));
assert.notEqual(odKey2, odKey1, '两次注射日期应不同');
assert.ok(odCards3.some((c) => c.key === odKey2), '日期变化后应可再次触发（新唯一 key）');

// ===========================================================================
section('protein_low：记录不足 / 达标过半不触发，命中时触发');

// (a) 近 7 天只有 2 天有 proteinServings 记录（< 3 天）→ 不触发
const paCheckins = {};
paCheckins[TODAY] = { date: TODAY, proteinServings: 2, symptoms: {} };
paCheckins[ad(TODAY, -1)] = { date: ad(TODAY, -1), proteinServings: 3, symptoms: {} };
const paCards = insight.evaluate(baseData({ checkins: paCheckins }), NOW);
console.log('  (a) 记录 2 天 →', ruleIds(paCards));
assert.equal(paCards.some((c) => c.ruleId === 'protein_low'), false, '有记录天数 < 3 不得触发');

// (b) 4 天有记录、达标 2 天（= 一半）→ 不触发（须严格少于一半）
const pbCheckins = {};
[0, -1, -2, -3].forEach((off, i) => {
  pbCheckins[ad(TODAY, off)] = { date: ad(TODAY, off), proteinServings: i < 2 ? 4 : 2, symptoms: {} };
});
const pbCards = insight.evaluate(baseData({ checkins: pbCheckins }), NOW);
console.log('  (b) 达标 2/4 →', ruleIds(pbCards));
assert.equal(pbCards.some((c) => c.ruleId === 'protein_low'), false, '达标天数 = 一半时不得触发');

// (c) 4 天有记录、达标 1 天 → 触发，body 含 hit/n
const pcCheckins = {};
[0, -1, -2, -3].forEach((off, i) => {
  pcCheckins[ad(TODAY, off)] = { date: ad(TODAY, off), proteinServings: i === 0 ? 4 : 2, symptoms: {} };
});
const pcCards = insight.evaluate(baseData({ checkins: pcCheckins }), NOW);
console.log('  (c) 达标 1/4 →', ruleIds(pcCards));
const pcCard = pcCards.find((c) => c.ruleId === 'protein_low');
assert.ok(pcCard, '达标天数 < 一半时应触发');
assert.ok(pcCard.body.includes('1/4'), `body 应含 "1/4"，实际：${pcCard.body}`);

// ===========================================================================
section('visible：priority 降序取前 2，同分 createdAt 新者在前，过滤已 dismiss');

const mkCard = (key, priority, createdAt, dismissedAt) => ({
  key, ruleId: key, title: 't', body: 'b', askPrompt: null, cta: null,
  priority, createdAt, dismissedAt: dismissedAt || null,
});
const visState = {
  active: [
    mkCard('a95', 95, NOW - 3 * D),
    mkCard('a80', 80, NOW - 2 * D),
    mkCard('a60_old', 60, NOW - 1 * D),
    mkCard('a60_new', 60, NOW),
    mkCard('a30', 30, NOW),
    mkCard('a99_gone', 99, NOW, NOW - H), // 已 dismiss，不应出现
  ],
  lastFired: {}, lastDismissed: {},
};
const top2 = insight.visible(visState); // max 默认 2
console.log('  visible 默认 →', top2.map((c) => c.key));
assert.equal(top2.length, 2, '默认最多 2 张');
assert.deepEqual(top2.map((c) => c.key), ['a95', 'a80'], '应按 priority 降序取前 2，排除已 dismiss');

const all = insight.visible(visState, 10);
console.log('  visible(10) →', all.map((c) => c.key));
assert.equal(all.length, 5, '已 dismiss 的卡不返回');
assert.deepEqual(all.map((c) => c.key), ['a95', 'a80', 'a60_new', 'a60_old', 'a30'],
  '同 priority（60）时 createdAt 新者在前');

// ===========================================================================
section('dismiss：不再可见；冷却从 dismiss 时刻计算');

// 用 fast_loss 夹具：T0 触发并合并，T1 dismiss
const T0 = NOW;
const dState0 = insight.merge(emptyState, insight.evaluate(flData, T0), T0);
assert.equal(insight.visible(dState0).length, 1, 'dismiss 前应可见');

const T1 = NOW + 3 * D;
const dState1 = insight.dismiss(dState0, 'fast_loss', T1);
console.log('  dismiss 后 visible →', insight.visible(dState1).map((c) => c.key));
assert.equal(insight.visible(dState1).length, 0, 'dismiss 后 visible 不再包含');
assert.equal(dState1.active[0].dismissedAt, T1, '卡上应写 dismissedAt');
assert.equal(dState1.lastDismissed.fast_loss, T1, 'lastDismissed 应写 dismiss 时刻');

// 未到冷却（从 T1 起算 14 天）：T1 + 13 天仍不出新卡
const midCards = insight.evaluate(
  Object.assign({}, flData, { insightsState: dState1 }),
  T1 + 13 * D
);
console.log('  T1+13d evaluate →', ruleIds(midCards));
assert.equal(midCards.some((c) => c.ruleId === 'fast_loss'), false,
  'now − lastDismissed < 14 天，不得出新卡');

// T1 + 14 天：冷却满，可再次触发
const laterCards = insight.evaluate(
  Object.assign({}, flData, { insightsState: dState1 }),
  T1 + 14 * D
);
console.log('  T1+14d evaluate →', ruleIds(laterCards));
assert.equal(laterCards.some((c) => c.ruleId === 'fast_loss'), true,
  '冷却从 dismiss 时刻算，满 14 天应可再次触发');

// ===========================================================================
section('streak：连续 7 天 completedAt → streak:7（once）');

const stCheckins = {};
for (let i = 0; i < 7; i++) {
  stCheckins[ad(TODAY, -i)] = { date: ad(TODAY, -i), completedAt: NOW - i * D, symptoms: {} };
}
const stData = baseData({ checkins: stCheckins });
const stCards = insight.evaluate(stData, NOW);
console.log('  首次 evaluate →', stCards.map((c) => c.key));
const stCard = stCards.find((c) => c.ruleId === 'streak');
assert.ok(stCard, '连续 7 天应触发 streak');
assert.equal(stCard.key, 'streak:7', 'key 应带天数后缀');
assert.equal(stCard.title, '连续打卡 7 天 🎉');
assert.equal(stCard.askPrompt, null, 'streak 规格无 askPrompt');
assert.equal(stCard.cta, null);

// once：合并后再次 evaluate 不再触发
const stState = insight.merge(stData.insightsState, stCards, NOW);
const stCards2 = insight.evaluate(Object.assign({}, stData, { insightsState: stState }), NOW);
console.log('  合并后再次 evaluate →', ruleIds(stCards2));
assert.equal(stCards2.some((c) => c.ruleId === 'streak'), false, 'once：同一天数不得重复触发');

// ===========================================================================
section('merge：同 key 未关闭不重复；超 14 天未关闭自动移除');

// 同 key 未关闭：merge 重复的新卡应被忽略，且不刷新 lastFired
const mBase = insight.merge(emptyState, [mkCard('fast_loss', 80, NOW)], NOW);
const mAgain = insight.merge(mBase, [mkCard('fast_loss', 80, NOW + D)], NOW + D);
assert.equal(mAgain.active.length, 1, '同 key 未关闭不得重复');
assert.equal(mAgain.active[0].createdAt, NOW, '保留首次出现的卡');
assert.equal(mAgain.lastFired.fast_loss, NOW, 'lastFired 保持首次合并时刻');

// 超 14 天未关闭 → 自动移除（§7.1）
const mExpired = insight.merge(mBase, [], NOW + 14 * D + H);
console.log('  14 天后 active →', mExpired.active.map((c) => c.key));
assert.equal(mExpired.active.length, 0, '超 14 天未关闭的卡应被自动移除');

// 已 dismiss 超 14 天 → 一并清理，防 active 无限增长
const mDismissed = insight.dismiss(mBase, 'fast_loss', NOW + D);
const mCleaned = insight.merge(mDismissed, [], NOW + 20 * D);
assert.equal(mCleaned.active.length, 0, '已关闭超 14 天的卡应被清理');
assert.equal(mCleaned.lastDismissed.fast_loss, NOW + D, 'lastDismissed 保留（冷却依据）');

// insightsState 缺省时 evaluate 不崩
const robust = insight.evaluate(Object.assign({}, flData, { insightsState: null }), NOW);
assert.ok(Array.isArray(robust), 'insightsState 为 null 时应返回数组');

console.log('\ninsight.test.js 全部通过 ✓');
