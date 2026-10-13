/**
 * plan.js — 阶段判定、每日目标、体重统计、注射部位轮换（纯函数，禁止调用 wx.*）
 * 规范见 docs/05-DATA.md §3.4、§5。依赖 pk.js 与 date.js。
 */

const pk = require('./pk.js');
const date = require('./date.js');

const STAGES = {
  explore: { name: '观望期' },
  start: { name: '起始期' },
  titrate: { name: '递增期' },
  plateau: { name: '平台期' },
  maintain: { name: '维持期' },
};

/** 1 份蛋白 ≈ 20g 优质蛋白的对照示例（打卡页 ? 弹层与知识卡复用） */
const PROTEIN_SERVING_EXAMPLES = [
  '一掌心大小、一指厚的瘦肉/鸡胸/鱼虾（约 100g 生重）',
  '2 个鸡蛋',
  '1 盒（200–250g）北豆腐 半盒 ≈ 1 份',
  '300ml 牛奶 + 1 个鸡蛋',
  '1 杯（约 200g）希腊酸奶',
  '1 勺乳清蛋白粉',
];

// ---------------------------------------------------------------------------
// §5.1 阶段判定
// ---------------------------------------------------------------------------

function isPlateau(checkins, todayKey) {
  const win = (from, to) => {
    const arr = [];
    for (let i = from; i <= to; i++) {
      const k = date.addDays(todayKey, i);
      const w = checkins[k] && checkins[k].weightKg;
      if (typeof w === 'number') arr.push(w);
    }
    return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null;
  };
  const recent = win(-6, 0);
  const past = win(-34, -28);
  let total = 0;
  for (let i = -27; i <= 0; i++) {
    if (checkins[date.addDays(todayKey, i)] && typeof checkins[date.addDays(todayKey, i)].weightKg === 'number') total++;
  }
  if (recent === null || past === null || total < 4) return false;
  if (!past) return false;
  return Math.abs(recent - past) / past < 0.01;
}

/**
 * @returns {{key, name, week:number|null}} week = 用药第几周（未用药 null）
 */
function computeStage(med, checkins, now) {
  const todayKey = date.dateKey(now);
  const status = (med && med.status) || 'considering';
  if (status === 'considering' || status === 'prescribed' || !med || !med.startDate) {
    return { key: 'explore', name: STAGES.explore.name, week: null };
  }
  const week = Math.floor(date.daysBetween(med.startDate, todayKey) / 7) + 1;
  if (status === 'tapering' || status === 'stopped') {
    return { key: 'maintain', name: STAGES.maintain.name, week };
  }
  if (week <= 4) return { key: 'start', name: STAGES.start.name, week };
  if (week >= 12 && isPlateau(checkins || {}, todayKey)) {
    return { key: 'plateau', name: STAGES.plateau.name, week };
  }
  return { key: 'titrate', name: STAGES.titrate.name, week };
}

// ---------------------------------------------------------------------------
// §5.2 每日目标
// ---------------------------------------------------------------------------

function round5(n) {
  return Math.round(n / 5) * 5;
}
function round100(n) {
  return Math.round(n / 100) * 100;
}
function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

const MOVE_PLAN = {
  explore: { cardioMinDaily: 20, strengthPerWeek: 0, moveText: '每天快走 20 分钟，先动起来' },
  start: { cardioMinDaily: 20, strengthPerWeek: 1, moveText: '每天轻快走 20–30 分钟；身体允许的话每周 1 次简单力量' },
  titrate: { cardioMinDaily: 30, strengthPerWeek: 2, moveText: '每周 150 分钟中等强度 + 力量 2 次' },
  plateau: { cardioMinDaily: 40, strengthPerWeek: 3, moveText: '每周 150–300 分钟 + 力量 2–3 次' },
  maintain: { cardioMinDaily: 40, strengthPerWeek: 3, moveText: '每周 200–300 分钟 + 力量 2–3 次，这是不反弹的关键' },
};

function computeTargets(profile, weightKg, stageKey) {
  const h = (profile && profile.heightCm ? profile.heightCm : 165) / 100;
  const w = typeof weightKg === 'number' && weightKg > 0 ? weightKg : (profile && profile.startWeightKg) || 70;
  const refWeightKg = Math.min(w, 25 * h * h);
  const proteinG = clamp(round5(1.2 * refWeightKg), 60, 120);
  const proteinServings = Math.max(3, Math.round(proteinG / 20));
  const waterMl = clamp(round100(30 * w), 1500, 3000);
  const waterCups = Math.round(waterMl / 250);
  const move = MOVE_PLAN[stageKey] || MOVE_PLAN.titrate;
  let basis = '蛋白按 1.2g × 参考体重 ' + Math.round(refWeightKg) + 'kg 计算；水按 30ml × 当前体重计算。肾病/心衰等需限水限蛋白的情况，以医生为准。';
  if (profile && Array.isArray(profile.conditions) && profile.conditions.includes('kidney')) {
    basis += '你有肾脏情况，蛋白和饮水量请先和医生确认';
  }
  return Object.assign({
    proteinG,
    proteinServings,
    waterMl,
    waterCups,
    refWeightKg: Math.round(refWeightKg * 10) / 10,
    basis,
  }, move);
}

// ---------------------------------------------------------------------------
// §5.3 减重速度（最小二乘，正数 = 下降，单位 %/周）
// ---------------------------------------------------------------------------

function weeklyRatePct(checkins, endKey, days) {
  days = days || 14;
  const pts = [];
  for (let i = days - 1; i >= 0; i--) {
    const k = date.addDays(endKey, -i);
    const w = checkins[k] && checkins[k].weightKg;
    if (typeof w === 'number') pts.push({ x: days - 1 - i, y: w });
  }
  if (pts.length < 3) return null;
  const n = pts.length;
  const meanX = pts.reduce((s, p) => s + p.x, 0) / n;
  const meanY = pts.reduce((s, p) => s + p.y, 0) / n;
  let num = 0;
  let den = 0;
  for (const p of pts) {
    num += (p.x - meanX) * (p.y - meanY);
    den += (p.x - meanX) * (p.x - meanX);
  }
  if (den === 0 || meanY === 0) return null;
  const slope = num / den; // kg/天
  const rate = (-slope * 7) / meanY * 100;
  return Math.round(rate * 10) / 10;
}

/** 展示分档：'flat'|'steady'|'fastish'|'fast' */
function rateBand(rate) {
  if (rate === null || rate === undefined || rate <= 0) return 'flat';
  if (rate <= 1.0) return 'steady';
  if (rate <= 1.5) return 'fastish';
  return 'fast';
}

// ---------------------------------------------------------------------------
// §5.4 注射部位轮换
// ---------------------------------------------------------------------------

const SITES = [
  { key: 'abd_ul', name: '腹部 左上' },
  { key: 'abd_ur', name: '腹部 右上' },
  { key: 'abd_ll', name: '腹部 左下' },
  { key: 'abd_lr', name: '腹部 右下' },
  { key: 'thigh_l', name: '左大腿' },
  { key: 'thigh_r', name: '右大腿' },
  { key: 'arm_l', name: '左上臂' },
  { key: 'arm_r', name: '右上臂' },
];

/** { [siteKey]: ms|null } */
function siteLastUsed(doses) {
  const out = {};
  for (const s of SITES) out[s.key] = null;
  for (const d of doses || []) {
    if (d && d.site && (out[d.site] === null || d.timeMs > out[d.site])) out[d.site] = d.timeMs;
  }
  return out;
}

/** 从未用过按 SITES 顺序取第一个；都用过取最久未用 */
function nextSite(doses) {
  const last = siteLastUsed(doses);
  for (const s of SITES) {
    if (last[s.key] === null) return s.key;
  }
  let best = SITES[0].key;
  for (const s of SITES) {
    if (last[s.key] < last[best]) best = s.key;
  }
  return best;
}

function siteName(siteKey) {
  const s = SITES.find((x) => x.key === siteKey);
  return s ? s.name : siteKey;
}

// ---------------------------------------------------------------------------
// §5.5 注射间隔警告
// ---------------------------------------------------------------------------

function doseIntervalWarn(medId, lastDoseMs, newDoseMs) {
  const med = pk.MEDS[medId];
  const minH = med ? med.minIntervalH : 72;
  const hours = (newDoseMs - lastDoseMs) / 3600000;
  return { warn: hours < minH, hours, minH };
}

// ---------------------------------------------------------------------------
// §5.6 难受模式 / 打卡统计
// ---------------------------------------------------------------------------

function isBadDay(checkin) {
  if (!checkin) return false;
  if (checkin.feel === 'bad') return true;
  const sym = checkin.symptoms || {};
  return Object.keys(sym).some((k) => sym[k] === 2) || !!sym.vomiting;
}

/**
 * 连续 completedAt 天数：今天已完成则含今天，否则从昨天起往前数
 */
function streak(checkins, todayKey) {
  let n = 0;
  let k = todayKey;
  const done = (key) => !!(checkins[key] && checkins[key].completedAt);
  if (!done(todayKey)) k = date.addDays(todayKey, -1);
  while (done(k)) {
    n++;
    k = date.addDays(k, -1);
  }
  return n;
}

/** 简报任务打勾 */
function checkinProgress(checkin, targets) {
  const c = checkin || {};
  return {
    protein: typeof c.proteinServings === 'number' && c.proteinServings >= targets.proteinServings,
    water: typeof c.waterCups === 'number' && c.waterCups >= targets.waterCups,
    move: (typeof c.cardioMin === 'number' && c.cardioMin >= targets.cardioMinDaily) || c.strength === true,
    strengthToday: c.strength === true,
  };
}

/**
 * 7 日均线（按日历日窗口）：对每个点，取 [该日 − (window−1), 该日] 内全部体重的均值。
 * @param {Array<{date:'YYYY-MM-DD', kg:number}>} points 按日期升序
 * @returns {Array<{date:string, kg:number}>} 与入参等长对齐
 */
function movingAvg(points, window) {
  window = window || 7;
  const out = [];
  for (let i = 0; i < points.length; i++) {
    const from = date.addDays(points[i].date, -(window - 1));
    let sum = 0;
    let n = 0;
    for (let j = 0; j <= i; j++) {
      if (points[j].date >= from) {
        sum += points[j].kg;
        n++;
      }
    }
    out.push({ date: points[i].date, kg: n ? Math.round((sum / n) * 100) / 100 : points[i].kg });
  }
  return out;
}

/** 最近一次体重（无打卡体重回落起始体重） */
function latestWeight(checkins, profile) {
  let best = null;
  for (const k of Object.keys(checkins || {})) {
    const w = checkins[k] && checkins[k].weightKg;
    if (typeof w === 'number' && (!best || k > best.date)) best = { kg: w, date: k };
  }
  if (best) return best;
  if (profile && typeof profile.startWeightKg === 'number') {
    return { kg: profile.startWeightKg, date: profile.startWeightDate || '' };
  }
  return null;
}

module.exports = {
  STAGES,
  PROTEIN_SERVING_EXAMPLES,
  computeStage,
  isPlateau,
  latestWeight,
  computeTargets,
  weeklyRatePct,
  rateBand,
  movingAvg,
  SITES,
  siteLastUsed,
  nextSite,
  siteName,
  doseIntervalWarn,
  isBadDay,
  streak,
  checkinProgress,
};
