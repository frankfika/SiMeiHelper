/**
 * insight.js — 洞察引擎（docs/05-DATA.md §7）
 *
 * 13 条规则，按条件生成洞察卡（InsightCard）。
 *
 * 纯函数边界（硬性规则）：
 *   - evaluate / merge / visible / dismiss 为纯函数，所有数据从参数传入，不读写 storage、不碰 wx。
 *   - refresh() 是本模块唯一读写 storage 的函数（惰性 require('./storage.js')，允许间接调用 wx.*）。
 *
 * 依赖方向：insight → plan / pk / date / storage（禁止 plan/pk/date/rules 反向依赖 insight）。
 *
 * 文案约束（§7.2 / PRD R2、R8）：不出现"该加量了""效果不好""失败"等措辞。
 */

const pk = require('./pk.js');
const date = require('./date.js');
const plan = require('./plan.js');

const DAY = 24 * 3600000;
const EXPIRE_DAYS = 14; // §7.1：active 中超过 14 天未关闭的卡自动移除

// ---------------------------------------------------------------------------
// 依赖别名（保持文件内部原命名，便于阅读）
// ---------------------------------------------------------------------------

const dateKey = date.dateKey;
const addDays = date.addDays;
const daysBetween = date.daysBetween;
const weeklyRatePct = plan.weeklyRatePct;
const streakOf = plan.streak;
const latestWeightOf = plan.latestWeight;
const isBadDay = plan.isBadDay;

/** 近 N 天（含今天往前 N 个日历日，§7.2）内有记录的打卡数组 */
function recentCheckins(checkins, todayKey, n) {
  const out = [];
  if (!checkins) return out;
  for (let i = 0; i < n; i++) {
    const k = addDays(todayKey, -i);
    const c = checkins[k];
    if (c) out.push(c);
  }
  return out;
}

/** 文案变量格式化：保留 1 位小数 */
function fmt1(x) {
  return typeof x === 'number' && isFinite(x) ? String(Math.round(x * 10) / 10) : '';
}

// ---------------------------------------------------------------------------
// 私有模板替换（fill 风格；不 require rules.js）
// 缺失变量替换为空串（与 §3.6 fill 行为一致）
// ---------------------------------------------------------------------------

function replace(tpl, vars) {
  return String(tpl).replace(/\{(\w+)\}/g, (m, k) => {
    const v = vars ? vars[k] : undefined;
    return v === null || v === undefined ? '' : String(v);
  });
}

// ---------------------------------------------------------------------------
// CTA 常量（payload 形式参照 §2.8 示例与 §6.2 actions）
// ---------------------------------------------------------------------------

const CTA_DOSE = { label: '去记录注射', kind: 'navigate', payload: '/pages/dose/dose' };
const CTA_REPORT = { label: '生成就诊摘要', kind: 'navigate', payload: '/pages/report/report' };
const CTA_KB_FACE = { label: '看「司美脸怎么防」', kind: 'navigate', payload: '/pages/article/article?id=kb_face' };
const CTA_KB_PLATEAU = { label: '看「平台期」', kind: 'navigate', payload: '/pages/article/article?id=kb_plateau' };
const CTA_KB_EAT = { label: '看「用药期间怎么吃」', kind: 'navigate', payload: '/pages/article/article?id=kb_eat' };
const CTA_KB_MOVE = { label: '看「要不要运动」', kind: 'navigate', payload: '/pages/article/article?id=kb_move' };

// ---------------------------------------------------------------------------
// InsightData 派生量（evaluate 内部统一预计算，cond/vars 只读不写）
// ---------------------------------------------------------------------------

/** 是否在用（§7.2 中"med.active"指 med.status === 'active'） */
function medActive(data) {
  return !!(data && data.med && data.med.status === 'active');
}

function lastDoseMs(doses) {
  if (!Array.isArray(doses)) return null;
  let max = null;
  for (const d of doses) {
    if (d && typeof d.timeMs === 'number' && (max === null || d.timeMs > max)) max = d.timeMs;
  }
  return max;
}

function enrich(data, now) {
  const d = Object.assign({}, data || {});
  d.now = now;
  d.lastDoseMs = lastDoseMs(d.doses);
  d.lastDoseKey = d.lastDoseMs !== null ? dateKey(d.lastDoseMs) : null;
  d.phase = d.lastDoseMs !== null ? pk.phase(d.lastDoseMs, now) : null;
  d.rate14 = weeklyRatePct(d.checkins, d.todayKey, 14);
  d.streakN = streakOf(d.checkins, d.todayKey);
  d.latest = latestWeightOf(d.checkins, d.profile);
  d.medsInfo = d.med && d.med.medId ? pk.MEDS[d.med.medId] : null;
  return d;
}

// ---------------------------------------------------------------------------
// 规则表（§7.2，13 条）
// 每条：{ ruleId, priority, cond(ctx), vars?(ctx), cooldownDays, once?, suffixKey?(ctx),
//         title, body, askPrompt, cta }（title/body/askPrompt 为模板字符串，cta 为常量或 null）
// ---------------------------------------------------------------------------

const RULES = [
  {
    // 1. 漏打/未记录：phase=overdue；once，key 带上次注射日期后缀
    ruleId: 'dose_overdue', priority: 95, cooldownDays: 14, once: true,
    suffixKey: (d) => d.lastDoseKey,
    cond: (d) => medActive(d) && !!d.phase && d.phase.key === 'overdue' && !!d.lastDoseKey,
    vars: (d) => ({ missedRule: d.medsInfo ? d.medsInfo.missedRule : '' }),
    // §4.5 约束：missedRule 文字出现的段落必须跟随"以你的医生为准"，并补"不要一次打两针来补"
    title: '这周的针还没记录',
    body: '如果已经打了，记一下就好；如果漏打了，{missedRule}不要一次打两针来补。具体剂量和节奏以你的医生为准。',
    askPrompt: '我漏打了一针，该怎么办？',
    cta: CTA_DOSE,
  },
  {
    // 2. 停药后回升：maintain 且最新体重 > 停药体重 × 1.03
    ruleId: 'regain', priority: 90, cooldownDays: 14,
    cond: (d) => !!(d.stage && d.stage.key === 'maintain' && d.med && typeof d.med.stopWeightKg === 'number'
      && d.latest && typeof d.latest.kg === 'number' && d.latest.kg > d.med.stopWeightKg * 1.03),
    vars: (d) => ({ deltaKg: fmt1(d.latest.kg - d.med.stopWeightKg) }),
    title: '体重在往回走',
    body: '比停药时高了 {deltaKg}kg。别慌，这正是该约个复诊的信号，早点和医生聊比等它涨上去好。',
    askPrompt: '停药后体重回升了怎么办？',
    cta: CTA_REPORT,
  },
  {
    // 3. 掉太快：近 14 天周减重率 > 1.5%
    ruleId: 'fast_loss', priority: 80, cooldownDays: 14,
    cond: (d) => typeof d.rate14 === 'number' && d.rate14 > 1.5,
    vars: (d) => ({ rate: fmt1(d.rate14) }),
    title: '这两周掉得有点快',
    body: '近两周平均每周 -{rate}%。掉太快更容易掉肌肉、脸也容易"垮"，蛋白和力量要跟上。',
    askPrompt: '减重太快会不会有司美脸？我该注意什么？',
    cta: CTA_KB_FACE,
  },
  {
    // 4. 便秘连续：近 4 天中 ≥ 3 天有 constipation 症状
    ruleId: 'constipation_streak', priority: 75, cooldownDays: 7,
    cond: (d) => {
      const days = recentCheckins(d.checkins, d.todayKey, 4);
      const n = days.filter((c) => !!(c.symptoms && c.symptoms.constipation)).length;
      return n >= 3;
    },
    vars: (d) => ({ waterCups: d.targets ? d.targets.waterCups : '' }),
    title: '便秘好几天了',
    body: '试试今天把水喝到 {waterCups} 杯，每餐加一拳蔬菜，饭后走 15 分钟。超过 3–4 天没排便请告诉医生。',
    askPrompt: '便秘好几天了怎么办？',
    cta: null,
  },
  {
    // 5. 喝水少：近 3 天有记录 ≥ 2 天、平均 < 目标 × 0.6、且近 3 天有恶心或便秘
    ruleId: 'water_low', priority: 70, cooldownDays: 5,
    cond: (d) => {
      if (!d.targets || typeof d.targets.waterCups !== 'number') return false;
      const days = recentCheckins(d.checkins, d.todayKey, 3);
      const recorded = days.filter((c) => typeof c.waterCups === 'number');
      if (recorded.length < 2) return false;
      const avg = recorded.reduce((s, c) => s + c.waterCups, 0) / recorded.length;
      if (!(avg < d.targets.waterCups * 0.6)) return false;
      const gutSymptom = days.some((c) => !!(c.symptoms && (c.symptoms.nausea || c.symptoms.constipation)));
      return gutSymptom;
    },
    vars: (d) => {
      const days = recentCheckins(d.checkins, d.todayKey, 3).filter((c) => typeof c.waterCups === 'number');
      const avg = days.reduce((s, c) => s + c.waterCups, 0) / days.length;
      return { avg: fmt1(avg), waterCups: d.targets ? d.targets.waterCups : '' };
    },
    title: '水可能喝少了',
    body: '最近几天平均 {avg} 杯，离 {waterCups} 杯还差不少。恶心、便秘都和喝水少有关。',
    askPrompt: '喝水总是忘怎么办？',
    cta: null,
  },
  {
    // 6. 刚加量：history 最近一条 dose_change 高于前一剂量且距今 ≤ 7 天；once，key 带变更日期
    ruleId: 'post_increase', priority: 70, cooldownDays: 7, once: true,
    suffixKey: (d) => {
      const e = lastDoseChange(d.med);
      return e ? e.date : null;
    },
    cond: (d) => {
      const h = d.med && Array.isArray(d.med.history) ? d.med.history : [];
      const i = lastDoseChangeIndex(h);
      if (i <= 0) return false;
      const e = h[i];
      const prev = h[i - 1];
      if (!(typeof e.doseMg === 'number' && typeof prev.doseMg === 'number')) return false;
      if (!(e.doseMg > prev.doseMg)) return false;
      const diff = daysBetween(e.date, d.todayKey);
      return diff >= 0 && diff <= 7;
    },
    vars: () => ({}),
    title: '刚加量，这周温柔一点',
    body: '加量后的一周最容易又恶心、没力气，通常会慢慢好起来。少量多餐，运动强度先降一档。',
    askPrompt: '加量后又恶心了怎么办？',
    cta: null,
  },
  {
    // 7. 平台期：stage=plateau
    ruleId: 'plateau', priority: 65, cooldownDays: 21,
    cond: (d) => !!(d.stage && d.stage.key === 'plateau'),
    vars: () => ({}),
    title: '体重在休息，不是你的错',
    body: '平台期很常见。先检查蛋白、力量、睡眠；用药要不要调整，复诊时和医生聊。',
    askPrompt: '平台期怎么办？',
    cta: CTA_KB_PLATEAU,
  },
  {
    // 8. 蛋白跟不上：近 7 天有记录 ≥ 3 天，且达标天数 < 有记录天数的一半
    ruleId: 'protein_low', priority: 60, cooldownDays: 7,
    cond: (d) => {
      if (!d.targets || typeof d.targets.proteinServings !== 'number') return false;
      const p = proteinStats(d);
      return p.n >= 3 && p.hit * 2 < p.n;
    },
    vars: (d) => {
      const p = proteinStats(d);
      return { hit: p.hit, n: p.n };
    },
    title: '蛋白有点跟不上',
    body: '近 7 天只有 {hit}/{n} 天吃够蛋白。胃口小的时候，先吃蛋白再吃别的。',
    askPrompt: '胃口小怎么吃够蛋白？',
    cta: CTA_KB_EAT,
  },
  {
    // 9. 复诊临近：nextVisitDate 在今天起 0–3 天内；once，key 带复诊日期
    ruleId: 'visit_soon', priority: 60, cooldownDays: 7, once: true,
    suffixKey: (d) => (d.med && d.med.nextVisitDate ? d.med.nextVisitDate : null),
    cond: (d) => {
      if (!d.med || !d.med.nextVisitDate) return false;
      const diff = daysBetween(d.todayKey, d.med.nextVisitDate);
      return diff >= 0 && diff <= 3;
    },
    vars: (d) => ({ days: daysBetween(d.todayKey, d.med.nextVisitDate) }),
    // 0/1 天时文案更自然（"0天后复诊"不通顺），其余按规格模板 {days}天后复诊
    title: (d) => {
      const n = daysBetween(d.todayKey, d.med.nextVisitDate);
      if (n === 0) return '今天复诊';
      if (n === 1) return '明天复诊';
      return replace('{days}天后复诊', { days: n });
    },
    body: '提前把这几周的数据整理好，复诊时给医生看，省时又说得清。',
    askPrompt: '复诊时我该问医生什么？',
    cta: CTA_REPORT,
  },
  {
    // 10. 力量不足：递增期及以后、近 14 天打卡 ≥ 5 天、strength=true 天数 < 2
    ruleId: 'strength_low', priority: 55, cooldownDays: 14,
    cond: (d) => {
      const sk = d.stage && d.stage.key;
      if (!(sk === 'titrate' || sk === 'plateau' || sk === 'maintain')) return false;
      const completed = recentCheckins(d.checkins, d.todayKey, 14).filter((c) => !!c.completedAt);
      if (completed.length < 5) return false;
      const strengthDays = recentCheckins(d.checkins, d.todayKey, 14)
        .filter((c) => c.strength === true).length;
      return strengthDays < 2;
    },
    vars: (d) => ({ n: recentCheckins(d.checkins, d.todayKey, 14).filter((c) => c.strength === true).length }),
    title: '加点力量训练吧',
    body: '近两周力量训练 {n} 次。每周 2 次、每次 20 分钟，就能帮你少掉肌肉。',
    askPrompt: '力量训练怎么在家开始？',
    cta: CTA_KB_MOVE,
  },
  {
    // 11. 低谷期嘴馋：phase=trough 且今日 appetite='high'
    ruleId: 'trough_appetite', priority: 50, cooldownDays: 7,
    cond: (d) => {
      const today = d.checkins && d.todayKey ? d.checkins[d.todayKey] : null;
      return !!(d.phase && d.phase.key === 'trough' && today && today.appetite === 'high');
    },
    vars: () => ({}),
    title: '嘴馋是药效低谷，正常',
    body: '快到打针日了，药效在低谷，饿得快很正常。备点鸡蛋、酸奶、豆干，饿了先吃蛋白。',
    askPrompt: '打针前几天特别饿怎么办？',
    cta: null,
  },
  {
    // 12. 当前剂量满 4 周：daysOnDose ≥ 28、未到最大档、近 7 天无难受日
    ruleId: 'titration_4w', priority: 40, cooldownDays: 28,
    cond: (d) => {
      if (!medActive(d) || !d.medsInfo) return false;
      const med = d.med;
      if (!med.doseSince || typeof med.currentDoseMg !== 'number') return false;
      const opts = Array.isArray(d.medsInfo.doseOptionsMg) ? d.medsInfo.doseOptionsMg : [];
      const maxMg = opts.length ? Math.max.apply(null, opts) : null;
      if (maxMg === null || !(med.currentDoseMg < maxMg)) return false;
      const daysOnDose = daysBetween(med.doseSince, d.todayKey);
      if (!(daysOnDose >= 28)) return false;
      const bad = recentCheckins(d.checkins, d.todayKey, 7).some((c) => isBadDay(c));
      return !bad;
    },
    vars: (d) => ({ weeks: Math.floor(daysBetween(d.med.doseSince, d.todayKey) / 7) }),
    title: '当前剂量已经 {weeks} 周了',
    body: '是维持还是调整，下次复诊时可以和医生聊聊。我帮你把这几周的反应和体重整理好。',
    askPrompt: '复诊时我该问医生什么？',
    cta: CTA_REPORT,
  },
  {
    // 13. 打卡里程碑：streak ∈ {7, 30, 100}；once，key 带天数
    ruleId: 'streak', priority: 30, cooldownDays: 7, once: true,
    suffixKey: (d) => (d.streakN ? String(d.streakN) : null),
    cond: (d) => d.streakN === 7 || d.streakN === 30 || d.streakN === 100,
    vars: (d) => ({ n: d.streakN }),
    title: '连续打卡 {n} 天 🎉',
    body: '记录本身就是改变的开始。谢谢你认真对待自己。',
    askPrompt: null,
    cta: null,
  },
];

/** med.history 中最后一条 dose_change 的下标（无则 -1） */
function lastDoseChangeIndex(history) {
  if (!Array.isArray(history)) return -1;
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i] && history[i].event === 'dose_change') return i;
  }
  return -1;
}

function lastDoseChange(med) {
  const h = med && Array.isArray(med.history) ? med.history : [];
  const i = lastDoseChangeIndex(h);
  return i >= 0 ? h[i] : null;
}

/** protein_low 用：近 7 天 proteinServings 有记录天数 n、达标天数 hit */
function proteinStats(d) {
  const goal = d.targets ? d.targets.proteinServings : null;
  const days = recentCheckins(d.checkins, d.todayKey, 7).filter((c) => typeof c.proteinServings === 'number');
  const hit = goal === null ? 0 : days.filter((c) => c.proteinServings >= goal).length;
  return { n: days.length, hit };
}

// ---------------------------------------------------------------------------
// 卡片构造与核心纯函数
// ---------------------------------------------------------------------------

/** 由规则生成卡对象（§2.8 结构） */
function buildCard(rule, key, ctx) {
  const base = { name: (ctx.profile && ctx.profile.nickname) || '你' };
  const vars = Object.assign(base, rule.vars ? rule.vars(ctx) : {});
  const render = (tpl) => {
    if (tpl === null || tpl === undefined) return null;
    if (typeof tpl === 'function') return tpl(ctx);
    return replace(tpl, vars);
  };
  return {
    key,
    ruleId: rule.ruleId,
    title: render(rule.title),
    body: render(rule.body),
    askPrompt: render(rule.askPrompt),
    cta: rule.cta ? Object.assign({}, rule.cta) : null,
    priority: rule.priority,
    createdAt: ctx.now,
    dismissedAt: null,
  };
}

function normalize(state) {
  const s = state && typeof state === 'object' ? state : {};
  return {
    active: Array.isArray(s.active) ? s.active.filter((c) => c && c.key) : [],
    lastFired: s.lastFired && typeof s.lastFired === 'object' ? s.lastFired : {},
    lastDismissed: s.lastDismissed && typeof s.lastDismissed === 'object' ? s.lastDismissed : {},
  };
}

/**
 * evaluate(data, now) — 纯函数：返回本次应新出现的卡（已过滤冷却，§7.1/§3.5）。
 * 冷却：now − max(lastFired[key], lastDismissed[key]) ≥ cooldownDays × 24H；
 * once 类规则 key 带唯一后缀，只要 lastFired[key] 已存在就不再触发。
 */
function evaluate(data, now) {
  const ctx = enrich(data, now);
  const state = normalize(data && data.insightsState);
  const out = [];
  for (const rule of RULES) {
    const suffix = rule.once && rule.suffixKey ? rule.suffixKey(ctx) : null;
    if (rule.once && !suffix) continue; // once 规则缺后缀信息时无法构造唯一 key，跳过
    const key = rule.once ? rule.ruleId + ':' + suffix : rule.ruleId;
    if (rule.once) {
      if (state.lastFired[key] !== undefined && state.lastFired[key] !== null) continue;
    } else {
      const last = Math.max(state.lastFired[key] || 0, state.lastDismissed[key] || 0);
      if (now - last < rule.cooldownDays * DAY) continue;
    }
    if (!rule.cond(ctx)) continue;
    out.push(buildCard(rule, key, ctx));
  }
  // priority 降序；同分新者在前（与 visible 一致，便于调用方直接使用）
  return out.sort((a, b) => (b.priority - a.priority) || (b.createdAt - a.createdAt));
}

/**
 * merge(state, newCards, now) — 纯函数：合并进 active，更新 lastFired。
 * - 同 key 已在 active 且未关闭 → 不重复（也不刷新其 lastFired，保持首次出现时刻）；
 * - 同 key 旧卡已关闭（dismissed）→ 用新卡替换；
 * - active 中超过 14 天未关闭的卡自动移除；已关闭超 14 天的卡一并清理（防止 active 无限增长）。
 */
function merge(state, newCards, now) {
  const s = normalize(state);
  const expireMs = EXPIRE_DAYS * DAY;
  let active = s.active.filter((c) => {
    if (c.dismissedAt) return now - c.dismissedAt < expireMs;
    return now - c.createdAt < expireMs;
  });
  const lastFired = Object.assign({}, s.lastFired);
  const byKey = {};
  active.forEach((c) => { byKey[c.key] = c; });
  const cards = Array.isArray(newCards) ? newCards : [];
  for (const card of cards) {
    if (!card || !card.key) continue;
    const existing = byKey[card.key];
    if (existing && !existing.dismissedAt) continue; // 未关闭，不重复
    if (existing) active = active.filter((c) => c.key !== card.key);
    const copy = Object.assign({}, card);
    active = active.concat([copy]);
    byKey[card.key] = copy;
    lastFired[card.key] = now;
  }
  return { active, lastFired, lastDismissed: Object.assign({}, s.lastDismissed) };
}

/**
 * visible(state, max=2) — 纯函数：未 dismiss 的卡，priority 降序、同分 createdAt 新者在前，取前 max。
 */
function visible(state, max) {
  const s = normalize(state);
  const m = max === null || max === undefined ? 2 : max;
  return s.active
    .filter((c) => !c.dismissedAt)
    .sort((a, b) => (b.priority - a.priority) || (b.createdAt - a.createdAt))
    .slice(0, m);
}

/**
 * dismiss(state, key, now) — 纯函数：写 dismissedAt 与 lastDismissed（§3.5）。
 * 卡不在 active（可能已被清理）时也记录 lastDismissed，保证冷却从 dismiss 时刻起算。
 */
function dismiss(state, key, now) {
  const s = normalize(state);
  const lastDismissed = Object.assign({}, s.lastDismissed);
  if (key) lastDismissed[key] = now;
  return {
    active: s.active.map((c) => (c.key === key && !c.dismissedAt
      ? Object.assign({}, c, { dismissedAt: now }) : c)),
    lastFired: Object.assign({}, s.lastFired),
    lastDismissed,
  };
}

/**
 * refresh(now?) — 本模块唯一非纯函数：读 storage → evaluate → merge → 写回 → 返回 visible。
 * today.onShow / 完成打卡 / 保存注射后调用（§7.1）。
 */
function refresh(now) {
  const t = typeof now === 'number' ? now : Date.now();
  // 惰性 require：纯函数测试（node 环境）不会触发 wx storage
  const storage = require('./storage.js'); // eslint-disable-line global-require
  const profile = storage.get('smh_profile');
  const med = storage.get('smh_med');
  const doses = storage.get('smh_doses');
  const checkins = storage.get('smh_checkins');
  const state = storage.get('smh_insights');
  const todayKey = dateKey(t);
  const stage = plan.computeStage(med, checkins, t);
  const lw = latestWeightOf(checkins, profile);
  const targets = profile && lw ? plan.computeTargets(profile, lw.kg, stage.key) : null;
  const data = { profile, med, doses, checkins, insightsState: state, targets, stage, todayKey };
  const merged = merge(state, evaluate(data, t), t);
  // §S4：条件已不成立的活动卡立即移除（否则 dose_overdue 等会挂着不消失）
  const cleanedActive = cleanupExpired(merged.active, data, t);
  const cleaned = Object.assign({}, merged, { active: cleanedActive });
  storage.set('smh_insights', cleaned);
  return visible(cleaned, 2);
}

/** 移除条件已不成立的未关闭卡；条件数据须可重现（doses/checkins/med/profile/todayKey） */
function cleanupExpired(active, data, now) {
  const ctx = enrich(data, now);
  return active.filter((c) => {
    if (c.dismissedAt) return true;
    const rule = RULES.find((r) => r.ruleId === c.ruleId);
    if (!rule) return true;
    try { return rule.cond(ctx); } catch (e) { return true; }
  });
}


module.exports = { RULES, evaluate, merge, visible, dismiss, refresh };
