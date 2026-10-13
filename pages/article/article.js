/**
 * pages/article — 知识卡阅读页（docs/02-UX.md §3.8 / docs/05-DATA.md §8、§9）
 * onLoad(options.id) → data/kb.js 找卡；未找到走空态「内容走丢了」。
 * onLoad 写已读：smh_kb_read[id] = Date.now()（05-DATA §3.2）。
 * 涉及剂量的篇目（kb_titration / kb_missed / kb_first_shot）正文末自动追加 notice（§3.8.3）。
 * 底部「问小美」：pendingAsk 以「：」结尾 → chat 页只填入输入框不自动发送（§3.8.4 / chat.consumePendingAsk）。
 */
const storage = require('../../utils/storage.js')

// 纯数据模块；try/catch 与 today.js 同款防御，加载失败时空态兜底
let kb = null
try { kb = require('../../data/kb.js') } catch (e) { kb = null }

const KEYS = storage.KEYS

// 涉及剂量的篇目：正文末自动追加「以处方医生为准」notice（02-UX §3.8.3）
const DOSE_CARD_IDS = ['kb_titration', 'kb_missed', 'kb_first_shot']

Page({
  data: {
    notFound: false,
    title: '',
    minutes: 2,
    // [{ h, items: [{ key, t }] }]——items 补 key 供 wx:key 用（条目可能重复）
    sections: [],
    showNotice: false,
  },

  onLoad(options) {
    const id = (options && options.id) || ''
    const card = (kb || []).find((k) => k && k.id === id)
    if (!card) {
      this.setData({ notFound: true })
      wx.setNavigationBarTitle({ title: '知识卡' })
      return
    }

    // 已读记录（02-UX §3.8.5）：读-改-写，只动本卡一个键
    storage.update(KEYS.KB_READ, (map) => {
      map = map || {}
      map[id] = Date.now()
      return map
    })

    this._id = id
    this._title = card.title
    wx.setNavigationBarTitle({ title: card.title })
    this.setData({
      title: card.title,
      minutes: card.minutes || 2,
      sections: (card.sections || []).map((s) => ({
        h: s.h || '',
        items: (s.p || []).map((t, i) => ({ key: i, t })),
      })),
      showNotice: DOSE_CARD_IDS.indexOf(id) >= 0,
    })
  },

  /** 分享：标题 = 卡标题，path 带 id（02-UX §3.8.6） */
  onShareAppMessage() {
    if (this.data.notFound || !this._id) {
      return { title: '司美助手', path: '/pages/today/today' }
    }
    return {
      title: this._title,
      path: '/pages/article/article?id=' + this._id,
    }
  },

  /** 「还有疑问？」→ pendingAsk 以「：」结尾（§3.8.4），chat 页填入输入框不发送 */
  askXiaomei() {
    getApp().globalData.pendingAsk = '关于《' + (this._title || this.data.title) + '》，我想问：'
    wx.switchTab({ url: '/pages/chat/chat' })
  },

  /** 空态「返回」：从分享卡片直达时没有上一页，回今天页 */
  goBack() {
    const pages = getCurrentPages()
    if (pages.length > 1) {
      wx.navigateBack()
    } else {
      wx.switchTab({ url: '/pages/today/today' })
    }
  },
})
