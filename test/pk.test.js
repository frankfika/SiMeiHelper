// test/pk.test.js — 在 Node 中运行: node test/pk.test.js
const assert = require('assert');
const pk = require('../utils/pk.js');

// 1. 三种药的峰值时间都应精确解在 Tmax
for (const id of Object.keys(pk.MEDS)) {
  const pt = pk.peakTimeH(id);
  assert.ok(Math.abs(pt - pk.MEDS[id].tmaxH) < 0.01, `${id} 峰值 ${pt} 应≈${pk.MEDS[id].tmaxH}`);
}

// 2. 单剂曲线形状
const t0 = Date.now();
const one = [{ medId: 'semaglutide', doseMg: 1.0, timeMs: t0 }];
const lv = (h) => pk.levelPct(one, t0 + h * 3600000);
assert.equal(lv(0), 0, '注射瞬间应为 0');
assert.ok(Math.abs(lv(36) - 100) < 0.01, 'Tmax 处单剂应为 100%');
assert.ok(lv(168) > 40 && lv(168) < 80, '7 天后应显著衰减');
assert.ok(lv(49 * 24) < 2, '7 个半衰期后应≈0');

// 3. 多剂蓄积（前 4 针历史 + 当前）
const five = [0, 7, 14, 21, 28].map((d) => ({ medId: 'semaglutide', doseMg: 1.0, timeMs: t0 - (28 - d) * 24 * 3600000 }));
const acc = pk.levelPct(five, t0);
assert.ok(acc > 100, `5 剂蓄积 ${acc} 应>100%`);

// 3b. 非 1mg 标准剂量的药：标准单剂在 Tmax 处也应为 100%
const tz = [{ medId: 'tirzepatide', doseMg: 2.5, timeMs: t0 }];
assert.ok(
  Math.abs(pk.levelPct(tz, t0 + pk.MEDS.tirzepatide.tmaxH * 3600000) - 100) < 0.01,
  '替尔泊肽 2.5mg 单剂 Tmax 应为 100%'
);

// 3c. 药代参数必须与 FDA 处方信息一致（防止参数漂移）
// 来源：Zepbound/Mounjaro PI（tmax median 24h, 8–72h；肥胖人群 t½ 5–6 天）
//       Trulicity PI（tmax median 48h, 24–72h；t½ ≈ 5 天 = 120h）
//       Ozempic/Wegovy PI（t½ ≈ 1 周；tmax 1–3 天）
assert.equal(pk.MEDS.tirzepatide.tmaxH, 24, '替尔泊肽 Tmax 应为 FDA 中位数 24h');
assert.equal(pk.MEDS.dulaglutide.tmaxH, 48, '度拉糖肽 Tmax 应为 FDA 中位数 48h');
assert.equal(pk.MEDS.dulaglutide.halfLifeH, 120, '度拉糖肽 t½ 应为 FDA 的 ~5 天 (120h)');
assert.equal(pk.MEDS.semaglutide.halfLifeH, 168, '司美格鲁肽 t½ 应为 ~1 周 (168h)');
assert.ok(
  pk.MEDS.tirzepatide.halfLifeH >= 120 && pk.MEDS.tirzepatide.halfLifeH <= 144,
  '替尔泊肽 t½ 应落在 Zepbound 肥胖人群标签的 5–6 天区间'
);

// 4. 边界
assert.equal(pk.levelPct([], t0), null, '空记录应返回 null');
assert.equal(pk.levelPct([{ medId: 'xxx', doseMg: 1, timeMs: t0 }], t0), null, '未知药应返回 null');
assert.equal(pk.nextDoseMs(null), null, '无末针应返回 null');
assert.equal(pk.nextDoseMs({ timeMs: t0 }), t0 + 7 * 24 * 3600000, '下次注射=末针+7天');

// 5. §4.6 测试向量（05-DATA.md，允许误差 ±0.5）
const T = Date.UTC(2026, 0, 5, 12);
const H = 3600000;
const D = 24 * H;
const near = (a, b, tag) => assert.ok(Math.abs(a - b) <= 0.5, `${tag}: ${a} 应≈${b}`);

near(pk.steadyPeakPct('semaglutide', 1), 205.11, '向量1 司美稳态峰值');
near(pk.steadyPeakPct('tirzepatide', 2.5), 173.22, '向量2 替尔稳态峰值');
near(pk.steadyPeakPct('dulaglutide', 1.5), 169.54, '向量3 度拉稳态峰值');

const tzSingle = [{ medId: 'tirzepatide', doseMg: 2.5, timeMs: T }];
assert.equal(pk.feltPct(tzSingle, T + 30 * H, 'tirzepatide', 2.5), 57, '向量4');   // T+30H
assert.equal(pk.feltPct(tzSingle, T + 72 * H, 'tirzepatide', 2.5), 47, '向量5');   // T+72H
assert.equal(pk.feltPct(tzSingle, T + 168 * H, 'tirzepatide', 2.5), 28, '向量6');  // T+168H

const semaTitrate = [
  { medId: 'semaglutide', doseMg: 0.25, timeMs: T },
  { medId: 'semaglutide', doseMg: 0.25, timeMs: T + 7 * D },
  { medId: 'semaglutide', doseMg: 0.25, timeMs: T + 14 * D },
  { medId: 'semaglutide', doseMg: 0.25, timeMs: T + 21 * D },
  { medId: 'semaglutide', doseMg: 0.5, timeMs: T + 28 * D },
];
assert.equal(pk.feltPct(semaTitrate, T + 684 * H, 'semaglutide', 0.5), 63, '向量7');
assert.equal(pk.feltPct(semaTitrate, T + 744 * H, 'semaglutide', 0.5), 65, '向量8');
assert.equal(pk.feltPct(semaTitrate, T + 828 * H, 'semaglutide', 0.5), 46, '向量9');

const semaSteady = [];
for (let i = 0; i < 12; i++) semaSteady.push({ medId: 'semaglutide', doseMg: 1, timeMs: T + i * 7 * D });
assert.equal(pk.feltPct(semaSteady, T + 77 * D + 36 * H, 'semaglutide', 1), 99, '向量10');
assert.equal(pk.feltPct(semaSteady, T + 77 * D + 167 * H, 'semaglutide', 1), 59, '向量11');

assert.equal(pk.phase(T, T + 50 * H).key, 'peak', '向量12');
assert.equal(pk.phase(T, T + 200 * H).key, 'overdue', '向量13');
assert.equal(pk.feltPct([], T, 'semaglutide', 1), null, '向量14 空记录');
assert.equal(pk.feltPct(semaSteady, T + 77 * D, 'semaglutide', 0), null, '剂量无效返回 null');

// 6. phase 全区间
assert.equal(pk.phase(T, T).key, 'rising');
assert.equal(pk.phase(T, T + 23.9 * H).key, 'rising');
assert.equal(pk.phase(T, T + 24 * H).key, 'peak');
assert.equal(pk.phase(T, T + 143.9 * H).key, 'steady');
assert.equal(pk.phase(T, T + 144 * H).key, 'trough');
assert.equal(pk.phase(T, T + 191.9 * H).key, 'trough');
assert.equal(pk.phase(T, T + 192 * H).key, 'overdue');
assert.equal(pk.phase(null, T), null);

console.log('pk.test.js 全部通过 ✓');
