/**
 * storage.js — 本地存储 + 迁移（utils 中唯一允许调用 wx.* 的模块）
 * 规范见 docs/05-DATA.md §2、§3.2。所有 key 以 smh_ 为前缀。
 */

const KEYS = {
  META: 'smh_meta',
  PROFILE: 'smh_profile',
  MED: 'smh_med',
  DOSES: 'smh_doses',
  CHECKINS: 'smh_checkins',
  CHAT: 'smh_chat',
  INSIGHTS: 'smh_insights',
  BRIEF: 'smh_brief',
  KB_READ: 'smh_kb_read',
  SETTINGS: 'smh_settings',
  ONB_DRAFT: 'smh_onb_draft',
};

const DISCLAIMER_VERSION = '2026-10-v1';
const PRIVACY_VERSION = '2026-10-v1';
const TERMS_VERSION = '2026-10-v1';
const SCHEMA_VERSION = 1;

const DEFAULTS = {
  smh_meta: {
    schemaVersion: 1,
    installedAt: 0,
    disclaimerAcceptedVersion: null,
    disclaimerAcceptedAt: null,
    privacyAcceptedVersion: null,
    privacyAcceptedAt: null,
    termsAcceptedVersion: null,
    termsAcceptedAt: null,
    onboardingStep: 1,
    onboardedAt: null,
    lastOpenDate: '',
  },
  smh_profile: null,
  smh_med: {
    status: 'considering', medId: null, brand: '', startDate: null, currentDoseMg: null, doseSince: null,
    injectWeekday: null, doctor: { name: '', hospital: '' }, nextVisitDate: null, stopDate: null,
    stopWeightKg: null, calendarAdded: { inject: false, visit: false, checkin: false }, history: [], updatedAt: 0,
  },
  smh_doses: [],
  smh_checkins: {},
  smh_chat: { messages: [] },
  smh_insights: { active: [], lastFired: {}, lastDismissed: {} },
  smh_brief: null,
  smh_kb_read: {},
  smh_settings: {
    ai: { provider: 'rules', baseUrl: '', model: '', apiKey: '', temperature: 0.6 },
    reminders: { askedCalendar: false },
    updatedAt: 0,
  },
  // 合规 #1：API Key 不再存与用户手机本地，只在云函数环境变量保存
  // smh_settings.ai.provider 默认 'rules'（不调用 AI）
  // 选 'cloud_proxy' → 走云函数 ai-proxy（推荐）
  // 选 'openai_compat' → 自填 key（仅供高级用户 / 开发调试）
};

function clone(v) {
  return JSON.parse(JSON.stringify(v));
}

/** 无值时返回 DEFAULTS 的深拷贝 */
function get(key) {
  try {
    const v = wx.getStorageSync(key);
    if (v === '' || v === null || v === undefined) {
      return key in DEFAULTS ? clone(DEFAULTS[key]) : null;
    }
    return v;
  } catch (e) {
    return key in DEFAULTS ? clone(DEFAULTS[key]) : null;
  }
}

function set(key, value) {
  try {
    wx.setStorageSync(key, value);
    return true;
  } catch (e) {
    // 容量错误：截断 smh_chat 至 100 条重试一次
    if (key === KEYS.CHAT) {
      try {
        const chat = get(KEYS.CHAT);
        chat.messages = (chat.messages || []).slice(-100);
        wx.setStorageSync(KEYS.CHAT, chat);
        return true;
      } catch (e2) { /* 落到 toast */ }
    } else {
      // 其他 key 超限：尝试用同样手段清理对话后重试一次
      try {
        const chat = get(KEYS.CHAT);
        chat.messages = (chat.messages || []).slice(-100);
        wx.setStorageSync(KEYS.CHAT, chat);
        wx.setStorageSync(key, value);
        return true;
      } catch (e2) { /* 落到 toast */ }
    }
    try { wx.showToast({ title: '存储空间不足', icon: 'none' }); } catch (e3) { /* 忽略 */ }
    return false;
  }
}

/** 读-改-写 */
function update(key, fn) {
  const old = get(key);
  const next = fn(old);
  set(key, next);
  return next;
}

/** 每个迁移函数自行读写各 key；v2 起在此追加 */
const MIGRATIONS = {
  // 2: function (all) { ... }
};

function migrate() {
  const meta = get(KEYS.META);
  if (!meta || meta.installedAt === 0) {
    meta.installedAt = Date.now();
    meta.schemaVersion = SCHEMA_VERSION;
    set(KEYS.META, meta);
    return;
  }
  for (let v = (meta.schemaVersion || 1) + 1; v <= SCHEMA_VERSION; v++) {
    if (MIGRATIONS[v]) MIGRATIONS[v]();
    meta.schemaVersion = v;
    set(KEYS.META, meta);
  }
}

// ---------------------------------------------------------------------------
// Checkin
// ---------------------------------------------------------------------------

function emptyCheckin(dateKeyStr) {
  return {
    date: dateKeyStr,
    weightKg: null,
    feel: null,
    symptoms: {},
    proteinServings: null,
    waterCups: null,
    cardioMin: null,
    strength: null,
    appetite: null,
    nlText: '',
    note: '',
    updatedAt: 0,
    completedAt: null,
  };
}

function getCheckin(dateKeyStr) {
  const map = get(KEYS.CHECKINS) || {};
  return map[dateKeyStr] ? clone(map[dateKeyStr]) : emptyCheckin(dateKeyStr);
}

/** 浅合并（symptoms 整体替换），写 updatedAt */
function upsertCheckin(dateKeyStr, patch) {
  return update(KEYS.CHECKINS, (map) => {
    map = map || {};
    const cur = map[dateKeyStr] ? clone(map[dateKeyStr]) : emptyCheckin(dateKeyStr);
    const next = Object.assign({}, cur, patch);
    next.date = dateKeyStr;
    if (patch.symptoms !== undefined) next.symptoms = patch.symptoms; // 整体替换
    next.updatedAt = Date.now();
    map[dateKeyStr] = next;
    return map;
  });
}

function completeCheckin(dateKeyStr) {
  return update(KEYS.CHECKINS, (map) => {
    map = map || {};
    const cur = map[dateKeyStr] ? clone(map[dateKeyStr]) : emptyCheckin(dateKeyStr);
    cur.completedAt = Date.now();
    cur.updatedAt = Date.now();
    map[dateKeyStr] = cur;
    return map;
  });
}

/** 闭区间 [fromKey, toKey]，按日期升序，只返回存在的 */
function listCheckins(fromKey, toKey) {
  const map = get(KEYS.CHECKINS) || {};
  const out = [];
  const fromMs = new Date(fromKey.replace(/-/g, '/')).getTime();
  const toMs = new Date(toKey.replace(/-/g, '/')).getTime();
  for (const k of Object.keys(map)) {
    const ms = new Date(k.replace(/-/g, '/')).getTime();
    if (ms >= fromMs && ms <= toMs) out.push(map[k]);
  }
  out.sort((a, b) => (a.date < b.date ? -1 : 1));
  return out.map(clone);
}

// ---------------------------------------------------------------------------
// Dose
// ---------------------------------------------------------------------------

/** 插入并按 timeMs 升序；返回完整 Dose */
function addDose(dose) {
  const full = Object.assign({ id: 'd_' + Date.now(), createdAt: Date.now() }, dose);
  return update(KEYS.DOSES, (list) => {
    list = list || [];
    list.push(full);
    list.sort((a, b) => a.timeMs - b.timeMs);
    return list;
  }), full;
}

function deleteDose(id) {
  update(KEYS.DOSES, (list) => (list || []).filter((d) => d.id !== id));
}

// ---------------------------------------------------------------------------
// Med
// ---------------------------------------------------------------------------

/** 合并 patch；有 historyEvent 则追加 { date, ...historyEvent } */
function saveMed(patch, historyEvent) {
  return update(KEYS.MED, (med) => {
    med = Object.assign({}, DEFAULTS.smh_med, med || {});
    const merged = Object.assign({}, med, patch);
    merged.updatedAt = Date.now();
    if (historyEvent) {
      merged.history = (merged.history || []).concat([
        Object.assign({ date: '', event: '', note: '' }, historyEvent),
      ]);
    }
    return merged;
  });
}

// ---------------------------------------------------------------------------
// Chat
// ---------------------------------------------------------------------------

function appendChat(msg) {
  update(KEYS.CHAT, (chat) => {
    chat = chat && chat.messages ? chat : { messages: [] };
    chat.messages = chat.messages.concat([msg]);
    if (chat.messages.length > 200) chat.messages = chat.messages.slice(-200);
    return chat;
  });
}

function clearChat() {
  set(KEYS.CHAT, { messages: [] });
}

// ---------------------------------------------------------------------------
// 导出 / 清空
// ---------------------------------------------------------------------------

/** 所有 smh_ key 的 JSON；apiKey 替换为 '***' */
function exportAll() {
  const out = {};
  for (const k of Object.keys(DEFAULTS)) {
    const v = get(k);
    if (v !== null) out[k] = v;
  }
  if (out.smh_settings && out.smh_settings.ai) out.smh_settings.ai.apiKey = '***';
  out.smh_tip_sym = !!wx.getStorageSync('smh_tip_sym');
  return JSON.stringify(out, null, 2);
}

function clearAll() {
  for (const k of Object.keys(DEFAULTS)) {
    try { wx.removeStorageSync(k); } catch (e) { /* 忽略 */ }
  }
  try { wx.removeStorageSync('smh_tip_sym'); } catch (e) { /* 忽略 */ }
}

module.exports = {
  KEYS,
  DISCLAIMER_VERSION,
  PRIVACY_VERSION,
  TERMS_VERSION,
  SCHEMA_VERSION,
  get, set, update, migrate,
  getCheckin, upsertCheckin, completeCheckin, listCheckins,
  addDose, deleteDose,
  saveMed,
  appendChat, clearChat,
  exportAll, clearAll,
};
