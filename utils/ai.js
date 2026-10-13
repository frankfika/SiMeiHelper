/**
 * ai.js — AI 门面层（页面只调用这里，不直接碰 rules/providers）
 * 规范见 docs/05-DATA.md §3.7、§6。
 *
 * 统一原则（01-PRD §7）：每个 AI 功能都先有规则引擎版本，LLM 只是增强层。
 * 无 key、断网、超时、输出不合法时，用户看到的仍是有价值的规则版内容。
 *
 * 依赖方向（§9）：ai → rules/plan/pk/date/storage；不依赖 insight.js
 * （ctx.insights 直接读 smh_insights.active 的 ruleId 列表，见 buildContext）。
 */

const storage = require('./storage.js');
const date = require('./date.js');
const pk = require('./pk.js');
const plan = require('./plan.js');
const rules = require('./rules.js'); // §3.6 函数签名契约；由并行任务实现

// ---------------------------------------------------------------------------
// 系统提示词（§6.7 原文逐字，不得改动）
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = [
  '你是「小美」，司美助手里的 AI 陪伴者，陪伴正在使用或考虑使用 GLP-1 类药物（司美格鲁肽、替尔泊肽等）减重的中国用户。',
  '你的风格：像一个懂行又温暖的朋友。口语、简短、具体，不说教，不评判身材，不用"管住嘴""自律"这类词。每次回复不超过 200 字，必要时用 2–4 个短条目。',
  '你必须遵守：',
  '1. 你不是医生，不做诊断。症状只区分：常见反应（给缓解建议）/ 需要尽快就医 / 需要立即拨打 120。',
  '2. 绝不给出剂量建议：不说"加到/减到/打多少 mg"，不建议自行加量、减量、停药、换药、补打两针。涉及这些，说明需要由处方医生决定，并提出可以帮用户整理就诊摘要。',
  '3. 不推荐任何购药渠道、代购、复配或来源不明的药物。',
  '4. 饮食和运动建议使用用户资料中【目标】的数值，用"份""杯""分钟"表达，不计算卡路里。',
  '5. 如果用户提到怀孕、备孕、哺乳、胰腺炎史、甲状腺髓样癌家族史，提醒其务必与医生确认。',
  '6. 不确定的事情直说不确定，并建议问医生或药师。',
  '以下是该用户的资料（仅供你个性化回答，不要复述）：',
].join('\n');

/** §6.6 LLM 版今日简报的任务说明（原文逐字） */
const BRIEF_TASK_PROMPT = [
  '任务：为用户写今天的简报。只输出 JSON，不要任何其他文字：',
  '{"headline":"不超过40个汉字，口语、有温度、具体到今天","tasks":[{"key":"protein|water|move|strength|dose|rest|weigh","text":"不超过24个汉字的具体行动"}],"note":"可选，不超过30字"}',
  '要求：tasks 恰好 3 条；数字必须使用【目标】里的数值；不得出现任何药物剂量数字；身体难受时只给休息和补水类任务。',
].join('\n');

/** 简报 tasks[].key 白名单（§2.9） */
const BRIEF_TASK_KEYS = ['protein', 'water', 'move', 'strength', 'dose', 'rest', 'weigh'];

/** 打卡症状 key 白名单（§2.6）与中文名（contextToText 用） */
const SYMPTOM_CN = {
  nausea: '恶心', vomiting: '呕吐', diarrhea: '腹泻', constipation: '便秘',
  reflux: '反酸', bloating: '胀气', fatigue: '乏力', dizziness: '头晕',
  injection_site: '注射处不适', hair_loss: '掉头发',
};
const SYMPTOM_KEYS = Object.keys(SYMPTOM_CN);

/** 健康情况 code → 中文（§6.5） */
const CONDITION_CN = {
  t2d: '2型糖尿病',
  insulin_su: '在用胰岛素或磺脲类',
  gallbladder: '胆囊疾病史',
  pancreatitis: '胰腺炎史',
  mtc_men2: '甲状腺髓样癌/MEN2',
  pregnancy: '怀孕/哺乳/备孕',
  kidney: '肾脏疾病',
};

/** 剂量守卫命中后的就诊摘要按钮（§6.2） */
const REPORT_ACTION = [{ label: '生成就诊摘要', kind: 'navigate', payload: '/pages/report/report' }];

// ---------------------------------------------------------------------------
// 内部小工具
// ---------------------------------------------------------------------------

function round1(n) {
  return Math.round(n * 10) / 10;
}

/** 读取 AI 设置（§2.10） */
function aiSettings() {
  const s = storage.get('smh_settings');
  const ai = (s && s.ai) || {};
  return {
    provider: ai.provider || 'rules',
    baseUrl: ai.baseUrl || '',
    model: ai.model || '',
    apiKey: ai.apiKey || '',
    temperature: typeof ai.temperature === 'number' ? ai.temperature : 0.6,
  };
}

/** ai-proxy 云函数内部用的服务商白名单 */
const CLOUD_PROVIDERS = ['deepseek', 'kimi', 'openai', 'moonshot', 'zhipu'];
const CLOUD_MODELS = {
  deepseek: ['deepseek-chat', 'deepseek-reasoner'],
  kimi: ['moonshot-v1-8k', 'moonshot-v1-32k', 'moonshot-v1-128k'],
  moonshot: ['moonshot-v1-8k', 'moonshot-v1-32k', 'moonshot-v1-128k'],
  zhipu: ['glm-4', 'glm-4-flash', 'glm-4-air'],
  openai: ['gpt-4o-mini', 'gpt-4o', 'gpt-3.5-turbo'],
};

/** 从 LLM 原始输出中截取「第一个 { 到最后一个 }」并 JSON.parse，失败返回 null */
function tryParseJson(raw) {
  const s = String(raw || '');
  const a = s.indexOf('{');
  const b = s.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  try {
    return JSON.parse(s.slice(a, b + 1));
  } catch (e) {
    return null;
  }
}

// ---------------------------------------------------------------------------
// providers（§3.7）：每个 provider 实现 complete({system, messages, json, timeoutMs})
// ---------------------------------------------------------------------------

const providers = {
  // 规则引擎不发网络请求：直接 reject，表示走规则分支
  rules: {
    complete() {
      return Promise.reject(new Error('rules provider 不发起网络请求'));
    },
  },

  /**
   * 云函数代理（合规 #1）：API Key 只存在云函数环境变量，
   * 小程序端只传 system/messages/model/json，云函数代行调用 OpenAI 兼容服务。
   *
   * 配置：用户在设置里只需选择"云函数代理"+ 服务商标识（如 'deepseek' / 'kimi' / 'openai'），
   * 无需填 API Key。
   *
   * 部署详见 cloudfunctions/ai-proxy/。
   */
  cloud_proxy: {
    complete(opts) {
      opts = opts || {};
      const s = aiSettings();
      const timeoutMs = opts.timeoutMs || 15000;
      return new Promise((resolve, reject) => {
        // 检查 wx.cloud 是否初始化（须在 app.js 显式 init）
        if (typeof wx === 'undefined' || !wx.cloud || typeof wx.cloud.callFunction !== 'function') {
          reject(new Error('云函数不可用：未在小程序 app.js 中初始化 wx.cloud（合规 #1 推荐方案）'));
          return;
        }
        if (!s.model) {
          reject(new Error('云函数代理需要选择模型（服务商 + 模型）'));
          return;
        }
        let messages = [];
        if (opts.system) messages.push({ role: 'system', content: opts.system });
        messages = messages.concat(Array.isArray(opts.messages) ? opts.messages : []);
        const t0 = Date.now();
        wx.cloud.callFunction({
          name: 'ai-proxy',
          data: {
            provider: s.provider || 'deepseek',
            model: s.model,
            messages,
            temperature: s.temperature,
            json: !!opts.json,
            maxTokens: 600,
          },
          timeout: timeoutMs,
          success(r) {
            const res = r && r.result;
            if (res && res.ok && typeof res.content === 'string') {
              resolve(res.content);
            } else {
              const msg = (res && res.error) || '云函数返回异常';
              const err = new Error('云函数代理失败：' + msg);
              err.ms = Date.now() - t0;
              reject(err);
            }
          },
          fail(err) {
            const e = new Error((err && err.errMsg) || '云函数调用失败');
            e.ms = Date.now() - t0;
            reject(e);
          },
        });
      });
    },
  },

  /**
   * OpenAI 兼容接口（§6.7）— 自填 key 模式（高级用户 / 内测用，不推荐生产）
   * json 参数：调用方声明期望 JSON 输出。
   */
  openai_compat: {
    complete(opts) {
      opts = opts || {};
      const s = aiSettings();
      const timeoutMs = opts.timeoutMs || 15000;
      return new Promise((resolve, reject) => {
        if (!s.baseUrl || !s.apiKey || !s.model) {
          reject(new Error('AI 服务未配置完整（需要 baseUrl / apiKey / model）'));
          return;
        }
        let messages = [];
        if (opts.system) messages.push({ role: 'system', content: opts.system });
        messages = messages.concat(Array.isArray(opts.messages) ? opts.messages : []);
        wx.request({
          url: s.baseUrl.replace(/\/$/, '') + '/chat/completions',
          method: 'POST',
          timeout: timeoutMs,
          header: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + s.apiKey },
          data: {
            model: s.model,
            messages,
            temperature: s.temperature,
            max_tokens: 600,
            stream: false,
          },
          success(res) {
            const ok = res.statusCode === 200 && res.data && Array.isArray(res.data.choices)
              && res.data.choices[0] && res.data.choices[0].message
              && typeof res.data.choices[0].message.content === 'string';
            if (ok) resolve(res.data.choices[0].message.content);
            else reject(new Error('AI 接口返回异常（HTTP ' + (res.statusCode || '未知') + '）'));
          },
          fail(err) {
            reject(new Error((err && err.errMsg) || 'AI 请求失败'));
          },
        });
      });
    },
  },
};

/** 统一入口：按设置选 provider */
function currentProvider() {
  const s = aiSettings();
  return providers[s.provider] || providers.rules;
}

// ---------------------------------------------------------------------------
// isLLM（§3.7）
// ---------------------------------------------------------------------------

function isLLM() {
  const s = aiSettings();
  if (s.provider === 'cloud_proxy') return true; // 云函数代理不需要 apiKey
  return s.provider === 'openai_compat' && !!s.apiKey && !!s.baseUrl && !!s.model;
}

// ---------------------------------------------------------------------------
// buildContext（§6.5）：读 storage 全量组装 AiContext
// ---------------------------------------------------------------------------

function buildContext(now) {
  now = typeof now === 'number' ? now : Date.now();
  const profile = storage.get('smh_profile');
  const med = storage.get('smh_med') || {};
  const doses = storage.get('smh_doses') || [];
  const checkins = storage.get('smh_checkins') || {};

  const todayKey = date.dateKey(now);
  const hour = new Date(now).getHours();
  const name = (profile && profile.nickname) || '';

  // 阶段
  const stage = plan.computeStage(med, checkins, now);

  // 体重
  const latest = plan.latestWeight(checkins, profile);
  const latestKg = latest ? latest.kg : null;
  const startKg = profile && typeof profile.startWeightKg === 'number' ? profile.startWeightKg : null;
  const changeKg = (latestKg !== null && startKg !== null) ? round1(latestKg - startKg) : null;
  const changePct = (changeKg !== null && startKg) ? round1((changeKg / startKg) * 100) : null;
  const weight = {
    latestKg,
    latestDate: latest ? latest.date : null,
    startKg,
    changeKg,
    changePct,
    weeklyRatePct: plan.weeklyRatePct(checkins, todayKey), // 正数 = 下降（§5.3）
  };

  // BMI（1 位小数）
  const heightM = profile && profile.heightCm ? profile.heightCm / 100 : null;
  const bmi = (latestKg !== null && heightM) ? round1(latestKg / (heightM * heightM)) : null;

  // 每日目标
  const targets = plan.computeTargets(profile, latestKg, stage.key);

  // 药物信息
  const medConst = med.medId ? pk.MEDS[med.medId] : null;
  const medInfo = {
    status: med.status || 'considering',
    medId: med.medId || null,
    medName: medConst ? medConst.name : '',
    doseMg: med.currentDoseMg || null,
    doseSince: med.doseSince || null,
    daysOnDose: med.doseSince ? date.daysBetween(med.doseSince, todayKey) : null,
    injectWeekday: typeof med.injectWeekday === 'number' ? med.injectWeekday : null,
    nextVisitDate: med.nextVisitDate || null,
    missedRule: medConst ? medConst.missedRule : '',
    labelSchedule: medConst ? medConst.labelSchedule : '',
  };

  // 药代：体感浓度 / 时相 / 下次打针
  const lastDose = doses.length ? doses[doses.length - 1] : null;
  const lastDoseMs = lastDose ? lastDose.timeMs : null;
  const ph = (lastDoseMs !== null) ? pk.phase(lastDoseMs, now) : null;
  let felt = null;
  if (med.medId && typeof med.currentDoseMg === 'number') {
    felt = pk.feltPct(doses, now, med.medId, med.currentDoseMg);
  }
  const nextMs = pk.nextDoseMs(lastDose);
  const nextDoseKey = nextMs ? date.dateKey(nextMs) : null;
  const pkInfo = {
    feltPct: felt,
    phase: ph ? ph.key : null,
    phaseLabel: ph ? ph.label : null,
    hoursSinceDose: ph ? Math.round(ph.hoursSince) : null,
    nextDoseKey,
    daysToNextDose: nextMs ? date.daysBetween(todayKey, nextDoseKey) : null,
    injectedToday: doses.some((d) => d && date.dateKey(d.timeMs) === todayKey),
  };

  // 今日打卡
  const today = storage.getCheckin(todayKey);

  // 近 7 天统计（含今天；达标定义见任务说明：≥ targets）
  const last7 = {
    checkinDays: 0,
    proteinHitDays: 0,
    waterHitDays: 0,
    strengthCount: 0,
    avgCardioMin: 0,
    symptomDays: {},
    badDays: 0,
  };
  let cardioSum = 0;
  let cardioDays = 0;
  for (let i = 6; i >= 0; i--) {
    const k = date.addDays(todayKey, -i);
    const c = checkins[k];
    if (!c) continue;
    last7.checkinDays++;
    if (typeof c.proteinServings === 'number' && c.proteinServings >= targets.proteinServings) last7.proteinHitDays++;
    if (typeof c.waterCups === 'number' && c.waterCups >= targets.waterCups) last7.waterHitDays++;
    if (c.strength === true) last7.strengthCount++;
    if (typeof c.cardioMin === 'number') {
      cardioSum += c.cardioMin;
      cardioDays++;
    }
    const sym = c.symptoms || {};
    for (const sk of Object.keys(sym)) {
      last7.symptomDays[sk] = (last7.symptomDays[sk] || 0) + 1;
    }
    if (plan.isBadDay(c)) last7.badDays++;
  }
  last7.avgCardioMin = cardioDays ? Math.round(cardioSum / cardioDays) : 0;

  // 洞察：不依赖 insight.js，直接读 active 卡的 ruleId（§2.8）
  const insightState = storage.get('smh_insights');
  const insights = ((insightState && insightState.active) || []).map((c) => c.ruleId);

  const todayForBad = storage.getCheckin(todayKey);
  return {
    now,
    todayKey,
    hour,
    name,
    latestWeightKg: latestKg, // 供 rules.parseCheckin 校验体重（±10kg）使用
    profile: {
      sex: profile ? profile.sex : null,
      age: profile && profile.birthYear ? new Date(now).getFullYear() - profile.birthYear : null,
      heightCm: profile ? profile.heightCm : null,
      bmi,
      goalWeightKg: profile ? profile.goalWeightKg : null,
      conditions: profile ? (profile.conditions || []) : [],
    },
    stage,
    med: medInfo,
    pk: pkInfo,
    weight,
    targets,
    today: todayForBad,
    last7,
    badDay: plan.isBadDay(todayForBad),
    nextSiteName: plan.siteName(plan.nextSite(doses)),
    insights,
  };
}

// ---------------------------------------------------------------------------
// contextToText（§6.5）：AiContext → 紧凑中文摘要（6–7 行）
// ---------------------------------------------------------------------------

function conditionsToCn(conditions) {
  const list = (conditions || []).filter((c) => c !== 'none' && CONDITION_CN[c]);
  return list.length ? list.map((c) => CONDITION_CN[c]).join('、') : '无特殊';
}

function feelToCn(feel) {
  if (feel === 'good') return '感觉不错';
  if (feel === 'ok') return '感觉一般';
  if (feel === 'bad') return '不太舒服';
  return '';
}

function sexToCn(sex) {
  if (sex === 'female') return '女';
  if (sex === 'male') return '男';
  if (sex === 'other') return '其他';
  return '';
}

function contextToText(ctx) {
  ctx = ctx || buildContext();
  const p = ctx.profile || {};
  const m = ctx.med || {};
  const k = ctx.pk || {};
  const w = ctx.weight || {};
  const t = ctx.targets || {};
  const l7 = ctx.last7 || {};
  const today = ctx.today || {};
  const lines = [];

  // 【用户】
  let u = (ctx.name || '你') + '，' + (sexToCn(p.sex) || '—');
  if (p.age !== null && p.age !== undefined) u += '，' + p.age + '岁';
  if (p.heightCm) u += '，' + p.heightCm + 'cm';
  if (p.bmi !== null && p.bmi !== undefined) u += '，BMI ' + p.bmi;
  if (p.goalWeightKg !== null && p.goalWeightKg !== undefined) u += '，目标 ' + p.goalWeightKg + 'kg';
  u += '；健康情况：' + conditionsToCn(p.conditions);
  lines.push('【用户】' + u);

  // 【阶段】
  let s = ctx.stage.name + (ctx.stage.week !== null && ctx.stage.week !== undefined ? ' 第' + ctx.stage.week + '周' : '');
  if (m.medName && m.doseMg) {
    s += '；' + m.medName + ' ' + m.doseMg + 'mg';
    if (m.daysOnDose !== null && m.daysOnDose <= 0) s += '（今天刚调整）';
    else if (m.daysOnDose !== null && m.daysOnDose <= 7) s += '（刚调整）';
  } else if (m.status === 'prescribed') {
    s += '；已开药未开始';
  } else {
    s += '；尚未开始用药';
  }
  if (m.injectWeekday !== null && m.injectWeekday !== undefined) s += '，每' + date.weekdayCn(m.injectWeekday) + '打针'; // weekdayCn 含"周"：'每'+'周日' → "每周日打针"
  if (m.nextVisitDate) s += '；下次复诊 ' + m.nextVisitDate.slice(5);
  lines.push('【阶段】' + s);

  // 【药物】
  if (k.hoursSinceDose !== null && k.hoursSinceDose !== undefined) {
    let d = '距上一针 ' + k.hoursSinceDose + ' 小时';
    if (k.phaseLabel) d += '，' + k.phaseLabel;
    if (k.feltPct !== null && k.feltPct !== undefined) d += '，体感浓度约 ' + k.feltPct + '%';
    lines.push('【药物】' + d);
  } else {
    lines.push('【药物】还没有注射记录');
  }

  // 【体重】
  if (w.latestKg !== null && w.latestKg !== undefined) {
    let wt = '最新 ' + w.latestKg + 'kg';
    if (w.startKg !== null && w.startKg !== undefined) {
      wt += '（起始 ' + w.startKg + 'kg';
      if (w.changePct !== null && w.changePct !== undefined) wt += '，' + w.changePct + '%';
      wt += '）';
    }
    if (w.weeklyRatePct !== null && w.weeklyRatePct !== undefined) {
      // ctx.weeklyRatePct 正数 = 下降；展示为体重变化方向（负 = 在掉）
      wt += w.weeklyRatePct > 0 ? '，近两周每周 -' + w.weeklyRatePct + '%' : '，近两周体重持平';
    }
    lines.push('【体重】' + wt);
  } else {
    lines.push('【体重】还没有体重记录');
  }

  // 【目标】
  lines.push('【目标】蛋白 ' + t.proteinServings + ' 份/' + t.proteinG + 'g，水 ' + t.waterCups + ' 杯，运动：' + (t.moveText || ''));

  // 【近7天】
  let l = '打卡 ' + l7.checkinDays + ' 天；蛋白达标 ' + l7.proteinHitDays + ' 天；喝水达标 ' + l7.waterHitDays + ' 天；力量 ' + l7.strengthCount + ' 次';
  const symParts = [];
  for (const sk of SYMPTOM_KEYS) {
    if (l7.symptomDays && l7.symptomDays[sk]) symParts.push(SYMPTOM_CN[sk] + ' ' + l7.symptomDays[sk] + ' 天');
  }
  if (symParts.length) l += '；' + symParts.join('、');
  l += '；难受 ' + l7.badDays + ' 天';
  lines.push('【近7天】' + l);

  // 【今天】
  const todayParts = [];
  const feelCn = feelToCn(today.feel);
  if (feelCn) todayParts.push(feelCn);
  const sym = today.symptoms || {};
  for (const sk of SYMPTOM_KEYS) {
    if (sym[sk]) todayParts.push(SYMPTOM_CN[sk] + (sym[sk] === 2 ? '(重)' : '(轻)'));
  }
  if (typeof today.proteinServings === 'number') todayParts.push('蛋白 ' + today.proteinServings + ' 份');
  if (typeof today.waterCups === 'number') todayParts.push('水 ' + today.waterCups + ' 杯');
  if (typeof today.cardioMin === 'number') todayParts.push('有氧 ' + today.cardioMin + ' 分钟');
  if (today.strength === true) todayParts.push('力量');
  lines.push('【今天】' + (todayParts.length ? todayParts.join('；') : '还没打卡'));

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// inputHash（§6.6）：任一变化则重新生成简报
// ---------------------------------------------------------------------------

function inputHash(ctx) {
  ctx = ctx || buildContext();
  const today = ctx.today || {};
  const k = ctx.pk || {};
  const m = ctx.med || {};

  const protein = typeof today.proteinServings === 'number' ? today.proteinServings : 0;
  const water = typeof today.waterCups === 'number' ? today.waterCups : 0;
  const cardio = typeof today.cardioMin === 'number' ? today.cardioMin : 0;
  const strength = today.strength === true ? 1 : 0;
  const bad = ctx.badDay ? 1 : 0;

  // isDoseDay：daysToNextDose ≤ 0，或今天星期 = 设定打针日且今天还没有注射记录。
  // 无针记录时 daysToNextDose 为 null → 只看星期。
  let isDoseDay = false;
  if (typeof k.daysToNextDose === 'number') isDoseDay = k.daysToNextDose <= 0;
  if (!isDoseDay && typeof m.injectWeekday === 'number' && ctx.todayKey) {
    const weekday = new Date(ctx.now).getDay();
    if (weekday === m.injectWeekday) {
      const doses = storage.get('smh_doses') || [];
      const shotToday = doses.some((d) => d && date.dateKey(d.timeMs) === ctx.todayKey);
      if (!shotToday) isDoseDay = true;
    }
  }

  return [
    ctx.stage ? ctx.stage.key : 'none',
    k.phase || 'none',
    bad,
    isDoseDay ? 1 : 0,
    'p' + protein,
    'w' + water,
    'c' + cardio,
    's' + strength,
  ].join('|');
}

// ---------------------------------------------------------------------------
// 对话（§6.7 八步流程）
// ---------------------------------------------------------------------------

/** 最近 10 条历史（仅 text 类型；排除与当前 userText 重复的最后一条 user） */
function recentHistory(userText) {
  const chatState = storage.get('smh_chat');
  const msgs = (chatState && chatState.messages) || [];
  let filtered = msgs.filter((msg) => msg && msg.type === 'text' && typeof msg.content === 'string' && msg.content);
  // 移除最后一条 role===user 且内容===userText 的重复（P1-3：chat.js 已先 append，避免发给 LLM 两次）
  if (userText && filtered.length && filtered[filtered.length - 1].role === 'user' && filtered[filtered.length - 1].content === userText) {
    filtered = filtered.slice(0, -1);
  }
  return filtered
    .slice(-10)
    .map((msg) => ({ role: msg.role, content: msg.content }));
}

function chat(userText, ctx) {
  ctx = ctx || buildContext();
  const text = String(userText || '');

  // 步骤 1：红旗守卫，先于一切 LLM 调用（§6.1）
  const rf = rules.screenRedFlags(text);
  if (rf.level !== 'none') {
    return Promise.resolve({
      content: rf.reply,
      actions: rf.actions || [],
      source: 'rules',
      type: 'safety',
    });
  }

  // 步骤 2：非 LLM（未配置）→ 规则回复
  if (!isLLM()) {
    return Promise.resolve(Object.assign({}, rules.reply(text, ctx), { source: 'rules', type: 'text' }));
  }

  // 步骤 3：剂量调整 / 购药两类意图强制走规则模板，不交给 LLM
  const intent = rules.matchIntent(text);
  if (intent === 'dose_change' || intent === 'buy_source') {
    return Promise.resolve(Object.assign({}, rules.reply(text, ctx), { source: 'rules', type: 'text' }));
  }

  // 步骤 4：messages = [system, 最近 10 条 text 历史, user]
  const messages = [{ role: 'system', content: SYSTEM_PROMPT + '\n' + contextToText(ctx) }]
    .concat(recentHistory(text));
  messages.push({ role: 'user', content: text });

  // 步骤 5：调用 LLM；失败/超时 → 规则回复，标记 offline:true
  return currentProvider().complete({ messages, timeoutMs: 15000 }).then((raw) => {
    // 步骤 6：剂量守卫，只作用于 LLM 输出（§6.2）
    const g = rules.guardOutput(raw);
    if (!g.ok) {
      return {
        content: g.text,
        actions: REPORT_ACTION.slice(),
        source: 'guard',
        type: 'text',
      };
    }
    // 步骤 7：intent 命中且规则表有 actions 时附上同样的 actions
    let actions = [];
    if (intent) {
      const rr = rules.reply(text, ctx);
      actions = rr.actions || [];
    }
    // 步骤 8：成功
    return {
      content: String(raw).trim().slice(0, 600),
      actions,
      source: 'llm',
      type: 'text',
    };
  }).catch(() => {
    const rr = rules.reply(text, ctx);
    return Object.assign({}, rr, { source: 'rules', type: 'text', offline: true });
  });
}

// ---------------------------------------------------------------------------
// 今日简报（§6.6）：规则版同步可得；isLLM 且当日次数 <3 才异步 LLM
// ---------------------------------------------------------------------------

/** 校验 LLM 简报：JSON、headline 1–40 字、tasks 恰好 3 条且 key 白名单、整段过剂量守卫 */
function validateBrief(raw, fallback) {
  const rawStr = String(raw || '');
  const g = rules.guardOutput(rawStr);
  if (!g.ok) return null;
  const obj = tryParseJson(rawStr);
  if (!obj || typeof obj !== 'object') return null;

  const headline = typeof obj.headline === 'string' ? obj.headline.trim() : '';
  if (!headline || headline.length > 40) return null;

  if (!Array.isArray(obj.tasks) || obj.tasks.length !== 3) return null;
  const tasks = [];
  for (let i = 0; i < obj.tasks.length; i++) {
    const t = obj.tasks[i];
    if (!t || typeof t !== 'object') return null;
    if (BRIEF_TASK_KEYS.indexOf(t.key) < 0) return null;
    const txt = typeof t.text === 'string' ? t.text.trim() : '';
    if (!txt) return null;
    tasks.push({ key: t.key, text: txt.slice(0, 24) }); // 超长截到 24 字（§2.9）
  }

  const note = typeof obj.note === 'string' ? obj.note.trim().slice(0, 30) : '';
  return Object.assign({}, fallback, {
    headline,
    tasks,
    note,
    source: 'llm',
  });
}

function dailyBrief(ctx) {
  ctx = ctx || buildContext();
  const now = Date.now();
  const todayKey = ctx.todayKey || date.dateKey(now);

  // 当日 LLM 生成次数（§2.9 llmCountToday，上限 3）
  const prev = storage.get('smh_brief');
  const countToday = (prev && prev.date === todayKey && typeof prev.llmCountToday === 'number')
    ? prev.llmCountToday : 0;

  // 规则版：调用方首屏先用 rules.dailyBrief 渲染，本函数的返回也可直接用（§3.7）
  const ruleRes = rules.dailyBrief(ctx) || {};
  const ruleBrief = {
    date: todayKey,
    inputHash: inputHash(ctx),
    headline: typeof ruleRes.headline === 'string' ? ruleRes.headline : '',
    tasks: Array.isArray(ruleRes.tasks) ? ruleRes.tasks : [],
    note: typeof ruleRes.note === 'string' ? ruleRes.note : '',
    source: 'rules',
    generatedAt: now,
    llmCountToday: countToday,
  };

  if (!isLLM() || countToday >= 3) {
    return Promise.resolve(ruleBrief);
  }

  return currentProvider().complete({
    system: SYSTEM_PROMPT + '\n' + contextToText(ctx),
    messages: [{ role: 'user', content: BRIEF_TASK_PROMPT }],
    json: true,
    timeoutMs: 15000,
  }).then((raw) => {
    const brief = validateBrief(raw, ruleBrief);
    if (!brief) return ruleBrief; // 校验失败 → 保持规则版
    brief.llmCountToday = countToday + 1;
    storage.set('smh_brief', brief);
    return brief;
  }).catch(() => ruleBrief); // 失败/超时 → 保持规则版
}

// ---------------------------------------------------------------------------
// 一句话打卡解析（§6.4）：LLM 输出 JSON → 字段白名单 + 类型校验；失败回落规则
// ---------------------------------------------------------------------------

const PARSE_SYSTEM_PROMPT = [
  '你是一句话打卡解析器。任务：把用户的一句话解析成今天的打卡数据。',
  '只输出一个 JSON 对象，不要输出任何解释、前后缀或代码块标记。',
  '解析不出或不明确的字段直接省略，不要猜测、不要编造。',
  '字段定义：',
  '- weightKg：体重（公斤），只能是数字；"斤"要除以 2。',
  '- feel："good"（舒服/不错/挺好）|"ok"（一般）|"bad"（难受/不舒服/很差）。',
  '- symptoms：对象，key 只能取 nausea（恶心）、vomiting（呕吐）、diarrhea（腹泻）、constipation（便秘）、reflux（反酸烧心）、bloating（胀气）、fatigue（乏力）、dizziness（头晕）、injection_site（注射处不适）、hair_loss（掉头发）；值 1=轻，2=重（前面有"很/特别/非常/严重/厉害"算重）。"不恶心""没恶心"这类否定不算。',
  '- proteinServings：蛋白份数，数字。2 个鸡蛋=1 份，1 杯牛奶=0.5 份，一次鸡胸/牛肉/鱼/虾/瘦肉/豆腐≈1 份。',
  '- waterCups：喝水杯数，数字。250ml 算 1 杯（1500ml≈6 杯），1 升≈4 杯。',
  '- cardioMin：有氧运动分钟数，数字。半小时=30，1 小时=60，8000 步≈80 分钟。',
  '- strength：提到力量训练/撸铁/深蹲/哑铃/器械/弹力带/俯卧撑/健身房时为 true。',
  '- appetite："low"（没胃口/吃不下/不饿）|"high"（嘴馋/很饿/想吃）。',
  '- note：不超过 30 字的一句话补充，没有就省略。',
].join('\n');

/** LLM 解析结果 → 白名单字段 + 基本类型校验（§6.4 与打卡 schema 对齐） */
function sanitizeParsedCheckin(obj, ctx) {
  const out = {};
  if (!obj || typeof obj !== 'object') return out;

  // 体重：30–300kg，且与当前体重差 ≤10kg 才采信（同规则版口径）
  if (typeof obj.weightKg === 'number' && isFinite(obj.weightKg) && obj.weightKg >= 30 && obj.weightKg <= 300) {
    const latest = ctx && typeof ctx.latestWeightKg === 'number' ? ctx.latestWeightKg : null;
    if (latest === null || Math.abs(obj.weightKg - latest) <= 10) {
      out.weightKg = round1(obj.weightKg);
    }
  }
  if (obj.feel === 'good' || obj.feel === 'ok' || obj.feel === 'bad') out.feel = obj.feel;
  if (obj.symptoms && typeof obj.symptoms === 'object' && !Array.isArray(obj.symptoms)) {
    const sym = {};
    for (const key of Object.keys(obj.symptoms)) {
      const v = obj.symptoms[key];
      if (SYMPTOM_KEYS.indexOf(key) >= 0 && (v === 1 || v === 2)) sym[key] = v;
    }
    if (Object.keys(sym).length) out.symptoms = sym;
  }
  if (typeof obj.proteinServings === 'number' && isFinite(obj.proteinServings) && obj.proteinServings >= 0) {
    out.proteinServings = Math.min(8, Math.round(obj.proteinServings * 2) / 2); // 0.5 精度，上限 8
  }
  if (typeof obj.waterCups === 'number' && isFinite(obj.waterCups) && obj.waterCups >= 0) {
    out.waterCups = Math.min(16, Math.round(obj.waterCups)); // 上限 16（§2.6）
  }
  if (typeof obj.cardioMin === 'number' && isFinite(obj.cardioMin) && obj.cardioMin >= 0) {
    out.cardioMin = Math.min(300, Math.round(obj.cardioMin)); // 上限 300
  }
  if (obj.strength === true) out.strength = true;
  if (obj.appetite === 'low' || obj.appetite === 'normal' || obj.appetite === 'high') out.appetite = obj.appetite;
  if (typeof obj.note === 'string' && obj.note.trim()) out.note = obj.note.trim().slice(0, 60);
  return out;
}

function parseCheckin(text, ctx) {
  ctx = ctx || buildContext();
  const textStr = String(text || '');
  const ruleParse = () => rules.parseCheckin(textStr, ctx);

  if (!isLLM()) return Promise.resolve(ruleParse());

  const latest = typeof ctx.latestWeightKg === 'number' ? ctx.latestWeightKg + 'kg' : '未知';
  const userMsg = '今天是 ' + ctx.todayKey + '，用户当前体重 ' + latest + '。用户输入：「' + textStr + '」';
  return currentProvider().complete({
    system: PARSE_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userMsg }],
    json: true,
    timeoutMs: 15000,
  }).then((raw) => {
    const g = rules.guardOutput(raw);
    if (!g.ok) return ruleParse();
    const parsed = sanitizeParsedCheckin(tryParseJson(raw), ctx);
    if (Object.keys(parsed).length === 0) return ruleParse(); // 什么都没解析出 → 规则版
    return parsed;
  }).catch(() => ruleParse());
}

// ---------------------------------------------------------------------------
// 打卡即时反馈（§6.8）：LLM 一句 ≤40 字；失败回落规则
// ---------------------------------------------------------------------------

function checkinFeedback(checkin, targets, ctx) {
  ctx = ctx || buildContext();
  const ruleFeedback = () => rules.checkinFeedback(checkin, targets, ctx);
  if (!isLLM()) return Promise.resolve(ruleFeedback());

  const userMsg = contextToText(ctx)
    + '\n\n用户刚完成今天的打卡，用一句话给出温暖、具体的反馈。只输出这一句话，不要任何其他文字，不超过 40 个字。';
  return currentProvider().complete({
    messages: [{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: userMsg }],
    timeoutMs: 15000,
  }).then((raw) => {
    const g = rules.guardOutput(raw);
    if (!g.ok) return ruleFeedback();
    const t = String(raw).trim().replace(/^["'「」]+|["'「」]+$/g, '');
    if (!t) return ruleFeedback();
    return t.slice(0, 40);
  }).catch(() => ruleFeedback());
}

// ---------------------------------------------------------------------------
// 复诊问题（§6.9）：LLM 3–5 条；失败回落规则
// ---------------------------------------------------------------------------

function visitQuestions(ctx) {
  ctx = ctx || buildContext();
  const ruleQuestions = () => rules.visitQuestions(ctx);
  if (!isLLM()) return Promise.resolve(ruleQuestions());

  const userMsg = contextToText(ctx)
    + '\n\n任务：为用户整理 3–5 条下次复诊时问医生的问题。问题要结合上面的数据（比如胃肠反应天数、减重速度、用药周数），口语、简短，每条不超过 40 个字。只输出 JSON：{"questions":["问题1","问题2",…]}';
  return currentProvider().complete({
    messages: [{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: userMsg }],
    json: true,
    timeoutMs: 15000,
  }).then((raw) => {
    const g = rules.guardOutput(raw);
    if (!g.ok) return ruleQuestions();
    const obj = tryParseJson(raw);
    if (!obj || !Array.isArray(obj.questions)) return ruleQuestions();
    const qs = obj.questions
      .filter((q) => typeof q === 'string' && q.trim())
      .map((q) => q.trim().slice(0, 40));
    if (qs.length < 3 || qs.length > 5) return ruleQuestions();
    return qs.slice(0, 5);
  }).catch(() => ruleQuestions());
}

// ---------------------------------------------------------------------------
// 测试连接（设置页）：max_tokens 1 的最小请求
// ---------------------------------------------------------------------------

function testConnection() {
  if (!isLLM()) {
    return Promise.resolve({ ok: false, ms: 0, error: '尚未配置 AI 服务：云函数代理需选择 cloud_proxy + 模型；自填 key 模式需选 openai_compat + 接口 + key' });
  }
  const s = aiSettings();
  const t0 = Date.now();

  // 云函数代理：最小 ping 通过云函数
  if (s.provider === 'cloud_proxy') {
    if (!wx.cloud || typeof wx.cloud.callFunction !== 'function') {
      return Promise.resolve({ ok: false, ms: 0, error: '云函数不可用：未在小程序 app.js 初始化 wx.cloud' });
    }
    return new Promise((resolve) => {
      wx.cloud.callFunction({
        name: 'ai-proxy',
        data: { provider: 'deepseek', model: s.model, messages: [{ role: 'user', content: 'ping' }], temperature: s.temperature, json: false, maxTokens: 1 },
        success(r) {
          const res = r && r.result;
          if (res && res.ok) resolve({ ok: true, ms: Date.now() - t0 });
          else resolve({ ok: false, ms: Date.now() - t0, error: (res && res.error) || '云函数返回异常' });
        },
        fail(err) {
          resolve({ ok: false, ms: Date.now() - t0, error: (err && err.errMsg) || '云函数调用失败' });
        },
      });
    });
  }

  // openai_compat 自填 key
  return new Promise((resolve) => {
    wx.request({
      url: s.baseUrl.replace(/\/$/, '') + '/chat/completions',
      method: 'POST',
      timeout: 15000,
      header: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + s.apiKey },
      data: {
        model: s.model,
        messages: [{ role: 'user', content: 'ping' }],
        max_tokens: 1,
        stream: false,
      },
      success(res) {
        const ok = res.statusCode === 200 && res.data && Array.isArray(res.data.choices)
          && res.data.choices[0] && res.data.choices[0].message;
        if (ok) resolve({ ok: true, ms: Date.now() - t0 });
        else resolve({ ok: false, ms: Date.now() - t0, error: '接口返回异常（HTTP ' + (res.statusCode || '未知') + '）' });
      },
      fail(err) {
        resolve({ ok: false, ms: Date.now() - t0, error: (err && err.errMsg) || '请求失败' });
      },
    });
  });
}

module.exports = {
  providers,
  SYSTEM_PROMPT,
  buildContext,
  contextToText,
  isLLM,
  inputHash,
  chat,
  dailyBrief,
  parseCheckin,
  checkinFeedback,
  visitQuestions,
  testConnection,
};
