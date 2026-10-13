/**
 * pages/chat — 小美（AI 对话）
 * 真相源：docs/02-UX.md §3.3、§4.3；docs/03-VISUAL.md §4.8、§5.3；docs/05-DATA.md §2.7、§6.7
 *
 * 布局：safety-strip 吸顶 + scroll-view 消息区（flex:1）+ 底部输入区（自定义 tab bar 之上）。
 * 发送流程：appendChat(user) → typing 气泡 → ai.chat（15s 超时在 ai 层处理）→ appendChat(assistant)。
 * actions kind：navigate / switchTab / apply_checkin / call / ask 全部实现（§3.3 ②）。
 */
const storage = require('../../utils/storage.js');
const ai = require('../../utils/ai.js');
const rules = require('../../utils/rules.js');
const date = require('../../utils/date.js');

const STRIP_TEXT = '小美是 AI 陪伴助手，不是医生。不提供诊断和剂量建议。';
const EMPTY_SUB = '用药、吃饭、运动、身体反应，都可以问我。\n我会记得你的情况，回答更贴近你。';

let seq = 0;
function nextId(role) {
  seq = (seq + 1) % 1000;
  return 'm_' + Date.now() + '_' + role + '_' + seq;
}

/** 日期分隔小字（§3.3：跨天时插入居中小字，跨年补年份） */
function dateSepLabel(ms) {
  const d = new Date(ms);
  const label = (d.getMonth() + 1) + '月' + d.getDate() + '日';
  if (d.getFullYear() !== new Date().getFullYear()) return d.getFullYear() + '年' + label;
  return label;
}

/**
 * storage 消息 → 渲染列表（含日期分隔行与间距类）。
 * @param {Array} messages smh_chat.messages
 * @param {Object} appliedMap { [msgId]: { [actionIdx]: true } } apply_checkin 已记录状态（内存态）
 */
function buildDisplay(messages, appliedMap) {
  const out = [];
  let lastDateKey = '';
  let prev = null;
  for (const m of messages || []) {
    if (!m || !m.id) continue;
    const key = date.dateKey(m.createdAt || 0);
    if (key !== lastDateKey) {
      lastDateKey = key;
      out.push({ kind: 'date', id: 'sep_' + m.id, label: dateSepLabel(m.createdAt || 0) });
      prev = null;
    }
    const applied = (appliedMap && appliedMap[m.id]) || {};
    const actions = (m.actions || []).map((a, i) => Object.assign({}, a, { applied: !!applied[i] }));
    let sourceLabel = '';
    if (m.role === 'assistant') {
      if (m.offline) sourceLabel = '离线回答';
      else if (m.source === 'guard') sourceLabel = '已按安全规则改写';
    }
    // 间距（03-VISUAL §4.8）：同角色 sp-2，换角色 sp-3
    let gap = 'gap-3';
    if (!prev) gap = '';
    else if (prev === m.role) gap = 'gap-2';
    out.push({
      kind: 'msg',
      id: m.id,
      role: m.role,
      type: m.type || 'text',
      content: m.content || '',
      actions,
      sourceLabel,
      gap,
    });
    prev = m.role;
  }
  return out;
}

Page({
  data: {
    stripText: STRIP_TEXT,
    emptySub: EMPTY_SUB,
    display: [],
    empty: true,
    suggestions: [],       // 空态 4 个推荐问题（rules.suggestedQuestions）
    sugOptions: [],        // 空态 chip-group 数据：label 加「💬」前缀（03-VISUAL §5.3）
    quickChips: [],        // 输入区上方横滑快捷 chip（同一组）
    input: '',
    sending: false,
    typing: false,
    scrollInto: 'bot_a',
    scrollAnim: false,
    keyboardUp: false,
    dockStyle: '',
  },

  onLoad() {
    if (!getApp().ensureOnboarded()) return;
    this._applied = {};   // apply_checkin 已记录状态（§3.3：本次会话内置灰）
    this._anchorFlip = false;
    // 自定义 tab bar 高度（px）：100rpx + 底部安全区，用于键盘抬升量换算（03-VISUAL §5.3）
    try {
      const info = wx.getSystemInfoSync();
      const safeBottom = info.safeArea ? Math.max(0, info.screenHeight - info.safeArea.bottom) : 0;
      this._tabPx = (info.windowWidth || 375) / 750 * 100 + safeBottom;
    } catch (e) {
      this._tabPx = 50;
    }
    this.reloadMessages();
    this.refreshSuggestions();
  },

  onShow() {
    if (this.getTabBar) {
      const tb = this.getTabBar();
      tb && tb.setData({ selected: 2 });
    }
    this.setData({ stripText: STRIP_TEXT + (ai.isLLM() ? '' : ' · 离线模式') });
    this.reloadMessages(); // 设置页可能清空过对话
    this.refreshSuggestions();
    this.consumePendingAsk();
  },

  // -------------------------------------------------------------------------
  // 数据
  // -------------------------------------------------------------------------

  refreshSuggestions() {
    const qs = rules.suggestedQuestions(ai.buildContext());
    this.setData({
      suggestions: qs,
      quickChips: qs,
      sugOptions: qs.map((q) => ({ value: q, label: '💬 ' + q })),
    });
  },

  reloadMessages() {
    const chatState = storage.get(storage.KEYS.CHAT);
    const display = buildDisplay((chatState && chatState.messages) || [], this._applied);
    this.setData({ display, empty: display.length === 0 && !this.data.typing });
    this.scrollBottom(false);
  },

  /** 滚到底部锚点：两个锚点交替赋值，保证同值重复也能触发（§5.3 scroll-into-view） */
  scrollBottom(animate) {
    this._anchorFlip = !this._anchorFlip;
    this.setData({ scrollInto: this._anchorFlip ? 'bot_b' : 'bot_a', scrollAnim: !!animate });
  },

  /** 全局「问小美」入口（§4.3 落点 4）：以「：」结尾只填入输入框不发送（article 页约定） */
  consumePendingAsk() {
    const app = getApp();
    const pend = app.globalData && app.globalData.pendingAsk;
    if (!pend) return;
    app.globalData.pendingAsk = null;
    if (/[:：]$/.test(pend)) {
      this.setData({ input: pend });
      return;
    }
    if (!this.data.sending) this.sendMessage(pend);
    else this.setData({ input: pend }); // 正在回复中：先放进输入框，不丢内容
  },

  // -------------------------------------------------------------------------
  // 发送
  // -------------------------------------------------------------------------

  onInput(e) {
    this.setData({ input: e.detail.value });
  },

  onSend() {
    const text = (this.data.input || '').trim();
    if (!text || this.data.sending) return;
    this.setData({ input: '' });
    this.sendMessage(text);
  },

  onQuickTap(e) {
    const q = e.currentTarget.dataset.q;
    if (q) this.sendMessage(q);
  },

  onSugChange(e) {
    const q = e.detail && e.detail.value;
    if (q) this.sendMessage(q);
  },

  sendMessage(text) {
    const t = String(text || '').trim();
    if (!t || this.data.sending) return;

    const userMsg = {
      id: nextId('u'),
      role: 'user',
      type: 'text',
      content: t,
      actions: [],
      source: null,
      createdAt: Date.now(),
    };
    storage.appendChat(userMsg);
    this.setData({ input: '', sending: true, typing: true });
    this.reloadMessages();

    const ctx = ai.buildContext();
    // 无论成功 / 失败 / 连 catch 处理器自身再抛错，sending/typing 都必须复位；
    // 否则 onSend() 的 `if (this.data.sending) return` 会永久拦掉后续所有发送，输入框一直转圈。
    // .then(finish, finish) 与 .finally(finish) 等价，且不依赖基础库是否实现 Promise.prototype.finally。
    const finish = () => {
      this.setData({ sending: false, typing: false });
      this.reloadMessages();
    };
    ai.chat(t, ctx)
      .then((res) => {
        storage.appendChat({
          id: nextId('a'),
          role: 'assistant',
          type: (res && res.type) || 'text',
          content: (res && res.content) || '',
          actions: (res && res.actions) || [],
          source: (res && res.source) || null,
          offline: !!(res && res.offline),
          createdAt: Date.now(),
        });
      })
      .catch(() => {
        // ai.chat 内部已兜底为规则回复；此处只防御意外 reject
        storage.appendChat({
          id: nextId('a'),
          role: 'assistant',
          type: 'text',
          content: '刚才走神了，你再问一次好吗？',
          actions: [],
          source: 'rules',
          offline: true,
          createdAt: Date.now(),
        });
      })
      .then(finish, finish);
  },

  // -------------------------------------------------------------------------
  // actions（§3.3 ②）
  // -------------------------------------------------------------------------

  handleAction(e) {
    const mid = e.currentTarget.dataset.mid;
    const aidx = Number(e.currentTarget.dataset.aidx);
    const row = this.data.display.find((m) => m.kind === 'msg' && m.id === mid);
    if (!row) return;
    const act = row.actions[aidx];
    if (!act) return;

    if (act.kind === 'navigate') {
      wx.navigateTo({ url: act.payload });
    } else if (act.kind === 'switchTab') {
      wx.switchTab({ url: act.payload });
    } else if (act.kind === 'call') {
      wx.makePhoneCall({ phoneNumber: String(act.payload) });
    } else if (act.kind === 'apply_checkin') {
      const k = date.dateKey(Date.now())
      const cur = storage.getCheckin(k)
      const patch = Object.assign({}, act.payload || {})
      if (patch.symptoms) {
        // §P1-2：upsertCheckin 默认整体替换 symptoms，与手动三态切换不一致；
        // apply_checkin 路径先合并到现有症状（保留用户已记录的其他症状）。
        patch.symptoms = Object.assign({}, cur.symptoms || {}, patch.symptoms)
      }
      storage.upsertCheckin(k, patch)
      wx.showToast({ title: '已记到今天 ✓', icon: 'none' })
      this._applied[mid] = this._applied[mid] || {};
      this._applied[mid][aidx] = true
      this.reloadMessages()
    } else if (act.kind === 'ask') {
      this.sendMessage(act.payload);
    }
  },

  /** 长按小美气泡复制（§3.3：长按 → wx.setClipboardData，系统自带「已复制」提示） */
  onCopy(e) {
    const mid = e.currentTarget.dataset.mid;
    const row = this.data.display.find((m) => m.kind === 'msg' && m.id === mid);
    if (row && row.content) wx.setClipboardData({ data: row.content });
  },

  // -------------------------------------------------------------------------
  // 键盘（§3.3 ④：adjust-position=false + 手动抬升）
  // -------------------------------------------------------------------------

  onKeyboard(e) {
    const h = (e.detail && e.detail.height) || 0;
    const lift = Math.max(0, h - this._tabPx);
    this.setData({
      keyboardUp: h > 0,
      dockStyle: lift > 0 ? 'transform: translateY(-' + Math.round(lift) + 'px);' : '',
    });
    if (h > 0) this.scrollBottom(false);
  },
});
