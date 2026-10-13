/**
 * pk.js — GLP-1 药代动力学（Bateman 单室模型）
 *
 * 参考开源项目 navidmosleminiya/glp1-pk（纯 TS 药代动力学，Bateman one-compartment）
 * 与 GLP-1 Tracker ADR-002 的实现思路，参数以 FDA 处方信息（Prescribing Information）为准：
 *   司美格鲁肽 semaglutide: t½ ≈ 168h (Ozempic/Wegovy PI: ~1 周), Tmax ≈ 36h (PI: 1–3 天)
 *   替尔泊肽 tirzepatide:   t½ ≈ 132h (Zepbound PI 肥胖人群: 5–6 天), Tmax ≈ 24h (PI: median 24h, 8–72h)
 *   度拉糖肽 dulaglutide:   t½ ≈ 120h (Trulicity PI: ~5 天), Tmax ≈ 48h (PI: median 48h, 24–72h)
 *
 * 模型：注射后浓度 C(t) ∝ e^(-Ke·t) − e^(-Ka·t)
 *   Ke = ln2 / t½（消除速率）
 *   Ka 由「峰值出现在 Tmax」反解：t_peak = ln(Ka/Ke) / (Ka − Ke)
 *
 * 仅用于体感趋势展示与打卡陪伴，不构成医学建议。
 */

const LN2 = Math.log(2);

const MEDS = {
  semaglutide: {
    id: 'semaglutide',
    name: '司美格鲁肽',
    brands: ['诺和泰', 'Ozempic', 'Wegovy'],
    halfLifeH: 168,
    tmaxH: 36,
    standardDoseMg: 1.0,
    maxDoseMg: 2.4,
    weekly: true,
    doseOptionsMg: [0.25, 0.5, 1, 1.7, 2, 2.4],
    minIntervalH: 48,
    missedRule: '诺和泰 Ozempic 说明书：漏打 5 天（120 小时）内尽快补打；超过 5 天就跳过这次。诺和盈 Wegovy 说明书：距下次计划注射还有 2 天（48 小时）以上就尽快补打，否则跳过。连续漏打 2 针及以上时不要自行按原剂量重启，先联系你的医生决定从哪一档重新开始。',
    labelSchedule: '减重适应症说明书常见节奏：0.25mg 起始，每 4 周递增一档（0.25→0.5→1.0→1.7→2.4mg）。',
  },
  tirzepatide: {
    id: 'tirzepatide',
    name: '替尔泊肽',
    brands: ['穆峰达', 'Mounjaro', 'Zepbound'],
    halfLifeH: 132, // Zepbound PI（超重/肥胖人群）：elimination half-life ≈ 5–6 天
    tmaxH: 24, // Zepbound/Mounjaro PI：median tmax 24h（范围 8–72h）
    standardDoseMg: 2.5,
    maxDoseMg: 15,
    weekly: true,
    doseOptionsMg: [2.5, 5, 7.5, 10, 12.5, 15],
    minIntervalH: 72,
    missedRule: '说明书：漏打 4 天（96 小时）内尽快补打；超过就跳过这次，按原计划日继续。',
    labelSchedule: '说明书常见节奏：2.5mg 起始 4 周，之后每至少 4 周可递增 2.5mg。',
  },
  dulaglutide: {
    id: 'dulaglutide',
    name: '度拉糖肽',
    brands: ['度易达', 'Trulicity'],
    halfLifeH: 120, // Trulicity PI：elimination half-life ≈ 5 天
    tmaxH: 48, // Trulicity PI：median tmax 48h（范围 24–72h）
    standardDoseMg: 1.5,
    maxDoseMg: 4.5,
    weekly: true,
    doseOptionsMg: [0.75, 1.5, 3, 4.5],
    minIntervalH: 72,
    missedRule: '说明书：距下次计划注射还有 3 天（72 小时）以上就尽快补打，否则跳过。',
    labelSchedule: '说明书常见节奏：0.75mg 或 1.5mg 起始，按医生评估调整。',
  },
};

/** 二分解 Ka：使 Bateman 曲线峰值恰好在 tmaxH 小时出现 */
function solveKa(halfLifeH, tmaxH) {
  const ke = LN2 / halfLifeH;
  // t_peak = ln(Ka/Ke)/(Ka-Ke)，Ka > Ke 时单调递减趋于 Ke；Ka 必须大于 Ke 才有吸收峰
  const peakAt = (ka) => Math.log(ka / ke) / (ka - ke);
  let lo = ke * 1.0000001;
  let hi = ke * 1000;
  for (let i = 0; i < 100; i++) {
    const mid = (lo + hi) / 2;
    if (peakAt(mid) > tmaxH) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

const kaCache = {};

/** 单剂归一化峰值系数（用于把多剂叠加浓度归一到 0-100%+） */
function singleDosePeak(medId) {
  const med = MEDS[medId];
  if (!med) return null;
  const ke = LN2 / med.halfLifeH;
  const ka = kaCache[medId] || (kaCache[medId] = solveKa(med.halfLifeH, med.tmaxH));
  const peakT = Math.log(ka / ke) / (ka - ke);
  return Math.exp(-ke * peakT) - Math.exp(-ka * peakT); // ∝ 峰值
}

/**
 * 某一时刻的相对体感浓度（0-100，超过 100 表示多剂蓄积，调用方可自行钳制）
 * @param {Array<{medId: string, doseMg: number, timeMs: number}>} doses 历史注射记录
 * @param {number} tMs 目标时刻（毫秒时间戳）
 * @returns {number|null} 无记录返回 null
 */
function levelPct(doses, tMs) {
  if (!Array.isArray(doses) || doses.length === 0) return null;
  const medId = doses[0].medId;
  const med = MEDS[medId];
  if (!med) return null;
  const ke = LN2 / med.halfLifeH;
  const ka = kaCache[medId] || (kaCache[medId] = solveKa(med.halfLifeH, med.tmaxH));
  const refPeak = singleDosePeak(medId) * med.standardDoseMg; // 标准单剂峰值 = 100%

  let raw = 0;
  for (const d of doses) {
    if (!d || typeof d.timeMs !== "number") continue;
    const dtH = (tMs - d.timeMs) / 3600000;
    if (dtH <= 0) continue;
    // 浓度贡献 ∝ doseMg × (e^(-ke·dt) − e^(-ka·dt))，7 个半衰期后忽略（<1%）
    if (dtH > med.halfLifeH * 7) continue;
    raw += (d.doseMg || med.standardDoseMg) * (Math.exp(-ke * dtH) - Math.exp(-ka * dtH));
  }
  return (raw / refPeak) * 100;
}

/** 单剂曲线峰值出现时间（小时），用于校验 */
function peakTimeH(medId) {
  const med = MEDS[medId];
  if (!med) return null;
  const ke = LN2 / med.halfLifeH;
  const ka = kaCache[medId] || (kaCache[medId] = solveKa(med.halfLifeH, med.tmaxH));
  return Math.log(ka / ke) / (ka - ke);
}

/** 距下次建议注射的时间（按 7 天间隔） */
function nextDoseMs(lastDose) {
  if (!lastDose || !lastDose.timeMs) return null;
  return lastDose.timeMs + 7 * 24 * 3600000;
}

// ---------------------------------------------------------------------------
// §4.3–4.4 体感浓度（相对用户当前剂量稳态峰值的百分比）与时相
// ---------------------------------------------------------------------------

const steadyPeakCache = {};

/**
 * 稳态峰值（与 levelPct 同一标尺）：标准剂量每 7 天注射 1 次共 12 针，
 * 取第 12 个间隔内逐小时 levelPct 的最大值，再按目标剂量线性缩放。
 * 首次调用时模拟并缓存（不硬编码；测试比对值：司美 1mg≈205.11、替尔 2.5mg≈174.54、度拉 1.5mg≈160.60）。
 */
function steadyPeakPct(medId, doseMg) {
  const med = MEDS[medId];
  if (!med || typeof doseMg !== 'number' || !(doseMg > 0)) return null;
  if (!steadyPeakCache[medId]) {
    const T0 = Date.UTC(2020, 0, 1, 8);
    const intervalH = 168; // 每周一次
    const doses = [];
    for (let i = 0; i < 12; i++) doses.push({ medId, doseMg: med.standardDoseMg, timeMs: T0 + i * intervalH * 3600000 });
    const startT = T0 + 11 * intervalH * 3600000; // 第 12 个间隔起点
    let maxV = 0;
    for (let h = 0; h <= intervalH; h++) {
      const v = levelPct(doses, startT + h * 3600000);
      if (v > maxV) maxV = v;
    }
    steadyPeakCache[medId] = maxV;
  }
  return (doseMg / med.standardDoseMg) * steadyPeakCache[medId];
}

/**
 * 体感浓度 0–100（整数）：相对「当前剂量吃满（稳态）峰值」的百分比。
 * 换药后只统计当前药的注射记录；无记录或剂量无效返回 null。
 * 起始期前几针数值偏低是事实（药效在慢慢建立），文案上不得表述为"浓度不够"。
 */
function feltPct(doses, tMs, medId, currentDoseMg) {
  if (!Array.isArray(doses) || !MEDS[medId]) return null;
  if (typeof currentDoseMg !== 'number' || !(currentDoseMg > 0)) return null;
  const ds = doses.filter((d) => d && d.medId === medId && typeof d.timeMs === 'number');
  if (ds.length === 0) return null;
  const v = levelPct(ds, tMs);
  if (v === null) return null;
  const peak = steadyPeakPct(medId, currentDoseMg);
  if (!peak) return null;
  return Math.round(Math.max(0, Math.min(100, (v / peak) * 100)));
}

/**
 * 时相（按距上一针小时数，与药物无关，便于文案统一）。
 * @returns {{key,label,hint,hoursSince}|null}
 */
function phase(lastDoseMs, tMs) {
  if (typeof lastDoseMs !== 'number' || !isFinite(lastDoseMs) || typeof tMs !== 'number') return null;
  const hoursSince = (tMs - lastDoseMs) / 3600000;
  if (hoursSince < 0) return null;
  if (hoursSince < 24) return { key: 'rising', label: '吸收上升', hint: '药物正在吸收，接下来两天胃口可能会变小', hoursSince };
  if (hoursSince < 72) return { key: 'peak', label: '高峰期', hint: '恶心、饱胀最常出现在这几天，少量多餐、蛋白优先', hoursSince };
  if (hoursSince < 144) return { key: 'steady', label: '平稳期', hint: '身体状态通常最稳，适合安排运动', hoursSince };
  if (hoursSince < 192) return { key: 'trough', label: '低谷期', hint: '快到打针日了，嘴馋一点是正常的，提前备好高蛋白零食', hoursSince };
  return { key: 'overdue', label: '已过打针日', hint: '超过计划时间了，记得看看漏打怎么处理', hoursSince };
}

/** 药物卡迷你曲线用：从 fromMs 到 toMs 按 stepH 采样 feltPct */
function curve(doses, fromMs, toMs, stepH, medId, currentDoseMg) {
  const out = [];
  if (!Array.isArray(doses) || !MEDS[medId] || !(stepH > 0) || !(toMs > fromMs)) return out;
  for (let t = fromMs; t <= toMs; t += stepH * 3600000) {
    out.push({ t, v: feltPct(doses, t, medId, currentDoseMg) });
  }
  return out;
}

module.exports = {
  MEDS, solveKa, singleDosePeak, levelPct, peakTimeH, nextDoseMs,
  steadyPeakPct, feltPct, phase, curve,
};
