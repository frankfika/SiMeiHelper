/**
 * cup-grid — 打卡格子（喝水 / 蛋白，0.5 步进）（03-VISUAL §4.5）
 * 交互：点空格 / 「+」格 +0.5（上限 max）；点已填的最后一格 −0.5
 * 跨过 target 的瞬间：整组 scale(1.04) 回弹 200ms + 轻震动（只触发一次）
 * 事件 change，detail { value }
 */
const ROW = 8 // 一行最多 8 个

Component({
  properties: {
    target: { type: Number, value: 0 },   // 目标格数
    value: { type: Number, value: 0 },    // 当前值（0.5 步进）
    icon: { type: String, value: '💧' },  // '💧' | '🥚' 等
    max: { type: Number, value: 16 }      // 上限
  },

  data: {
    rows: [],         // 按每行 ROW 个切好的格子：[[{i, state}]]
    countText: '0/0',
    unit: '份',       // 💧 用「杯」，其余「份」
    reached: false,
    pop: false        // 跨过目标时的回弹动画开关
  },

  lifetimes: {
    attached() {
      this._rebuild()
    }
  },

  observers: {
    'target, value, icon, max'() {
      this._rebuild()
    }
  },

  methods: {
    /** 数值显示：整数不带小数位，其余保留 1 位（6.5 → '6.5'） */
    _fmt(n) {
      const r = Math.round(n * 10) / 10
      return String(r)
    },

    /** 由 target / value / max 计算格子与计数行 */
    _rebuild() {
      const target = Math.max(0, Number(this.data.target) || 0)
      const max = Math.max(1, Number(this.data.max) || 16)
      const v = Math.max(0, Math.min(max, Number(this.data.value) || 0))

      const filled = Math.floor(v)
      const hasHalf = v - filled >= 0.5
      // 格子总数：至少铺满 target；超出目标时按实际值铺
      const total = Math.max(target, Math.ceil(v), 1)
      const cells = []
      for (let i = 0; i < total; i++) {
        let state = 'empty'
        if (i < filled) {
          state = 'full'
        } else if (i === filled && hasHalf) {
          state = 'half'
        }
        cells.push({ i, state })
      }
      // value ≥ target 后末尾加「+」格
      const reached = target > 0 && v >= target
      if (reached && total < max) {
        cells.push({ i: cells.length, state: 'plus' })
      }

      // 一行最多 ROW 个，切成多行（带行号供 wx:key 使用）
      const rows = []
      for (let i = 0; i < cells.length; i += ROW) {
        rows.push({ ri: rows.length, cells: cells.slice(i, i + ROW) })
      }

      this.setData({
        rows,
        reached,
        unit: this.data.icon === '💧' ? '杯' : '份',
        countText: this._fmt(v) + '/' + this._fmt(target)
      })
    },

    /** 跨过目标瞬间：回弹 + 轻震动（只触发一次） */
    _celebrate() {
      if (this._celebrating) return
      this._celebrating = true
      if (wx.vibrateShort) {
        try {
          wx.vibrateShort({ type: 'light' })
        } catch (e) { /* 部分机型不支持时静默 */ }
      }
      this.setData({ pop: true })
      setTimeout(() => {
        this.setData({ pop: false })
        this._celebrating = false
      }, 200)
    },

    onTap(e) {
      const idx = Number(e.currentTarget.dataset.i)
      const state = e.currentTarget.dataset.state
      const target = Math.max(0, Number(this.data.target) || 0)
      const max = Math.max(1, Number(this.data.max) || 16)
      const v = Math.max(0, Math.min(max, Number(this.data.value) || 0))
      let next = v

      if (state === 'plus' || state === 'empty') {
        // 点空格 / 「+」格：+0.5，上限 max
        next = Math.min(max, v + 0.5)
      } else {
        // 已填（含半格）：只有最后一格可减
        const filled = Math.floor(v)
        const lastIdx = (v - filled >= 0.5) ? filled : filled - 1
        if (idx === lastIdx) {
          next = Math.max(0, v - 0.5)
        }
      }

      if (next === v) return

      // 跨过 target 的那一刻触发（向下离开不触发）
      if (target > 0 && v < target && next >= target) {
        this._celebrate()
      }

      // 同步自身属性（父组件未回传前 UI 也要即时响应）
      this.setData({ value: next })
      this.triggerEvent('change', { value: next })
    }
  }
})
