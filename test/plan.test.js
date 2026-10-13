// test/plan.test.js — 在 Node 中运行: node test/plan.test.js
const assert = require('assert');
const plan = require('../utils/plan.js');
const date = require('../utils/date.js');

const NOW = Date.UTC(2026, 9, 5, 12); // 2026-10-05 周一（本地时区下按日期字符串运算，不受时区影响）
const TODAY = date.dateKey(NOW);

function medOf(status, startDate) {
  return { status, medId: 'tirzepatide', startDate: startDate || null, currentDoseMg: 5, stopWeightKg: 80 };
}
function checkin(dateKey, weightKg, extra) {
  return Object.assign({ date: dateKey, weightKg: weightKg === null ? null : weightKg, completedAt: weightKg === null ? null : 1 }, extra);
}

// 1. computeStage 五阶段
assert.deepEqual(
  { ...plan.computeStage(medOf('considering'), {}, NOW), week: null },
  { key: 'explore', name: '观望期', week: null },
  '观望期');
const startMed = medOf('active', date.addDays(TODAY, -20)); // 第 3 周
assert.equal(plan.computeStage(startMed, {}, NOW).key, 'start', '起始期（≤4 周）');
const titrateMed = medOf('active', date.addDays(TODAY, -40)); // 第 6 周
assert.equal(plan.computeStage(titrateMed, {}, NOW).key, 'titrate', '递增期');
const maintainMed = medOf('stopped', date.addDays(TODAY, -100));
assert.equal(plan.computeStage(maintainMed, {}, NOW).key, 'maintain', '停药 → 维持期');
// 平台期边界：≥12 周且 28 天体重变化 <1%
const plateauMed = medOf('active', date.addDays(TODAY, -14 * 7));
const pc = {};
for (let i = 0; i < 35; i++) pc[date.addDays(TODAY, -i)] = checkin(date.addDays(TODAY, -i), 85 + (i % 2) * 0.1);
assert.equal(plan.computeStage(plateauMed, pc, NOW).key, 'plateau', '平台期（均值几乎不动）');
for (let i = 0; i < 35; i++) pc[date.addDays(TODAY, -i)] = checkin(date.addDays(TODAY, -i), 85 - i * 0.1);
assert.equal(plan.computeStage(plateauMed, pc, NOW).key, 'titrate', '持续下降不是平台期');

// 2. computeTargets（05-DATA §9.1 校验算式）
const profile = { heightCm: 165, startWeightKg: 92, conditions: [] };
const t = plan.computeTargets(profile, 92, 'titrate');
assert.equal(t.proteinG, 80, 'proteinG');
assert.equal(t.proteinServings, 4, 'proteinServings');
assert.equal(t.waterMl, 2800, 'waterMl');
assert.equal(t.waterCups, 11, 'waterCups');
assert.ok(Math.abs(t.refWeightKg - 68.1) < 0.1, 'refWeightKg≈68.1');
assert.equal(t.cardioMinDaily, 30, 'titrate 有氧');
assert.equal(t.strengthPerWeek, 2, 'titrate 力量');
// explore 阶段
const t2 = plan.computeTargets(profile, 92, 'explore');
assert.equal(t2.cardioMinDaily, 20);
// kidney 提示
const t3 = plan.computeTargets({ heightCm: 165, startWeightKg: 92, conditions: ['kidney'] }, 92, 'titrate');
assert.ok(t3.basis.includes('肾脏'), 'kidney 提示写入 basis');

// 3. weeklyRatePct：每天恒定 -0.1kg，92 起步 → 14 天斜率 -0.1kg/天
const wc = {};
for (let i = 0; i < 14; i++) wc[date.addDays(TODAY, -i)] = checkin(date.addDays(TODAY, -i), 92 - (14 - i) * 0.1);
const rate = plan.weeklyRatePct(wc, TODAY, 14);
assert.ok(Math.abs(rate - 0.8) < 0.15, `每周约 -0.8%，实际 ${rate}`);
assert.equal(plan.weeklyRatePct({ '2026-10-05': checkin(TODAY, 88) }, TODAY, 14), null, '少于 3 点返回 null');
assert.equal(plan.rateBand(0.9), 'steady');
assert.equal(plan.rateBand(1.2), 'fastish');
assert.equal(plan.rateBand(1.7), 'fast');
assert.equal(plan.rateBand(-0.2), 'flat');

// 4. nextSite / siteLastUsed
assert.equal(plan.nextSite([]), 'abd_ul', '空记录取第一个');
const used = [
  { site: 'abd_ul', timeMs: 1000 },
  { site: 'abd_ur', timeMs: 2000 },
];
assert.equal(plan.nextSite(used), 'abd_ll', '没用过的按顺序');
const allUsed = plan.SITES.map((s, i) => ({ site: s.key, timeMs: s.key === 'thigh_r' ? 500 : 1000 + i }));
assert.equal(plan.nextSite(allUsed), 'thigh_r', '都用过取最久未用');
assert.equal(plan.siteLastUsed(used).abd_ul, 1000);
assert.equal(plan.siteName('abd_ll'), '腹部 左下');

// 5. doseIntervalWarn
const last = Date.UTC(2026, 9, 5, 8);
assert.deepEqual(plan.doseIntervalWarn('semaglutide', last, last + 40 * 3600000), { warn: true, hours: 40, minH: 48 }, '司美 40h < 48h 警告');
assert.equal(plan.doseIntervalWarn('tirzepatide', last, last + 80 * 3600000).warn, false, '替尔 80h > 72h 不警告');
assert.equal(plan.doseIntervalWarn('dulaglutide', last, last + 60 * 3600000).warn, true, '度拉 60h < 72h 警告');

// 6. isBadDay
assert.equal(plan.isBadDay({ feel: 'bad' }), true, 'feel=bad');
assert.equal(plan.isBadDay({ symptoms: { nausea: 2 } }), true, '重度症状');
assert.equal(plan.isBadDay({ symptoms: { vomiting: 1 } }), true, '呕吐即难受日');
assert.equal(plan.isBadDay({ symptoms: { nausea: 1 } }), false, '轻度不触发');
assert.equal(plan.isBadDay(null), false);

// 7. streak（今天未完成则从昨天起）
const sc = {};
for (let i = 1; i <= 7; i++) sc[date.addDays(TODAY, -i)] = checkin(date.addDays(TODAY, -i), 88, { completedAt: 1 });
assert.equal(plan.streak(sc, TODAY), 7, '昨天起连续 7 天');
sc[TODAY] = checkin(TODAY, 88, { completedAt: 1 });
assert.equal(plan.streak(sc, TODAY), 8, '今天已完成含今天');
sc[date.addDays(TODAY, -3)] = checkin(date.addDays(TODAY, -3), null, { completedAt: null });
assert.equal(plan.streak(sc, TODAY), 3, '断签截断');

// 8. checkinProgress
const targets = { proteinServings: 4, waterCups: 11, cardioMinDaily: 30 };
assert.deepEqual(
  plan.checkinProgress({ proteinServings: 4, waterCups: 6, cardioMin: 20, strength: true }, targets),
  { protein: true, water: false, move: true, strengthToday: true },
  '力量算达标 move');

// 9. latestWeight 回落
assert.equal(plan.latestWeight({ '2026-10-01': checkin('2026-10-01', 88.4) }, profile).kg, 88.4);
assert.equal(plan.latestWeight({}, profile).kg, 92, '无记录回落起始体重');

console.log('plan.test.js 全部通过 ✓');

// 10. movingAvg（7 日日历日窗口）
const pts = [
  { date: '2026-10-01', kg: 90 },
  { date: '2026-10-03', kg: 89 },
  { date: '2026-10-08', kg: 88 },
];
const ma = plan.movingAvg(pts, 7);
assert.equal(ma.length, 3, 'movingAvg 等长');
assert.equal(ma[0].kg, 90, '首点自身');
assert.equal(ma[1].kg, 89.5, '10-03 窗口含 10-01 与 10-03');
assert.equal(ma[2].kg, 88.5, "10-08 窗口含 10-03（距 5 天）与自身，不含 10-01（距 7 天）");
console.log('movingAvg ✓');
