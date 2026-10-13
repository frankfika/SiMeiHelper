/**
 * insight-card — 洞察卡（03-VISUAL §4.9；数据结构 docs/05-DATA §2.8 InsightCard）
 * 事件：
 *   dismiss  detail { key }                 「知道了」，收起动画 200ms 后抛出
 *   ask      detail { prompt: card.askPrompt } 「✨ 问小美」
 *   cta      detail { cta: card.cta }        右侧 cta 文字按钮（有才显示）
 */
Component({
  properties: {
    card: { type: null, value: null } // InsightCard 对象
  },

  data: {
    closing: false // 「知道了」按下后的收起动画状态
  },

  methods: {
    /** 知道了：先播 200ms 收起动画，再通知页面移除 */
    onDismiss() {
      if (this.data.closing) return
      this.setData({ closing: true })
      setTimeout(() => {
        this.triggerEvent('dismiss', { key: this.data.card ? this.data.card.key : null })
      }, 200)
    },

    /** cta 按钮（如「看看怎么防」） */
    onCta() {
      const card = this.data.card
      if (!card || !card.cta) return
      this.triggerEvent('cta', { cta: card.cta })
    },

    /** ✨ 问小美：把预填问题交给页面 */
    onAsk() {
      const card = this.data.card
      if (!card) return
      this.triggerEvent('ask', { prompt: card.askPrompt })
    }
  }
})
