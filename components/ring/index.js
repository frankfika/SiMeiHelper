/**
 * ring — 体感浓度进度环（03-VISUAL §4.6）
 * canvas type="2d"：轨道 surface2 整圆 + 进度弧（-90° 起顺时针，round lineCap）
 * 取色走 utils/theme.js（attached 读 globalData.theme，wx.onThemeChange 重绘）
 * 中心文字在 WXML 覆盖层；value 变化 300ms ease-out 过渡
 */
const themeUtil = require('../../utils/theme.js')

/** rpx→px：以 750 设计稿为基准（§4.6） */
function rpx2px(rpx) {
  let winWidth = 375
  try {
    const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()
    winWidth = info.windowWidth || 375
  } catch (e) {
    // 取不到窗口信息时按 iPhone 标准宽兜底
  }
  return rpx * winWidth / 750
}

/** 色名 → theme.js 颜色键 */
const COLOR_KEYS = { primary: 'primary', accent: 'accent', success: 'success' }

Component({
  properties: {
    value: { type: null, value: null },                 // 0–100 或 null（显示 --）
    size: { type: Number, value: 160 },                 // 直径 rpx
    stroke: { type: Number, value: 14 },                // 弧宽 rpx
    color: { type: String, value: 'primary' },          // 'primary'|'accent'|'success'
    label: { type: String, value: '' }                  // 中心下方小字
  },

  data: {
    numSize: 44,      // 中心数字字号 rpx（size=160 时恰为 --fs-h1）
    pctText: '--',
    ariaLabel: '体感浓度 --%'
  },

  lifetimes: {
    attached() {
      // 主题：attached 时读全局，系统切换深浅色时重绘（03-VISUAL §3.7 第 4 条）
      const app = typeof getApp === 'function' ? getApp() : null
      this._theme = (app && app.globalData && app.globalData.theme) || 'light'
      this._onThemeChange = (res) => {
        this._theme = (res && res.theme) || 'light'
        if (this._ctx) this._draw(this._display == null ? 0 : this._display)
      }
      if (wx.onThemeChange) wx.onThemeChange(this._onThemeChange)

      // 中心字号随 size 等比缩放
      this.setData({ numSize: Math.round(44 * (this.data.size || 160) / 160) })
      this._display = this._normalize(this.data.value)
    },
    detached() {
      if (wx.offThemeChange) wx.offThemeChange(this._onThemeChange)
      this._stopAnim()
    },
    ready() {
      this._initCanvas()
    }
  },

  observers: {
    value(v) {
      const n = this._normalize(v)
      this.setData({
        pctText: n == null ? '--' : String(Math.round(n)),
        ariaLabel: '体感浓度 ' + (n == null ? '--' : Math.round(n)) + '%'
      })
      this._animateTo(n == null ? 0 : n)
    },
    'size, stroke'() {
      this.setData({ numSize: Math.round(44 * (this.data.size || 160) / 160) })
      if (this._ctx) this._draw(this._display == null ? 0 : this._display)
    },
    color() {
      if (this._ctx) this._draw(this._display == null ? 0 : this._display)
    }
  },

  methods: {
    /** 归一化：非法 / null → null，越界截断到 0–100 */
    _normalize(v) {
      if (v == null || v === '' || isNaN(Number(v))) return null
      return Math.max(0, Math.min(100, Number(v)))
    },

    /** 拿 canvas 节点，按 size × dpr 设置画布 */
    _initCanvas() {
      const query = this.createSelectorQuery()
      query.select('#ring-canvas').fields({ node: true, size: true }).exec((res) => {
        if (!res || !res[0] || !res[0].node) return
        const node = res[0].node
        const width = res[0].width
        const height = res[0].height
        let dpr = 2
        try {
          dpr = (wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()).pixelRatio || 2
        } catch (e) { /* 兜底 2 */ }
        node.width = width * dpr
        node.height = height * dpr
        const ctx = node.getContext('2d')
        ctx.scale(dpr, dpr)
        this._canvas = node
        this._ctx = ctx
        this._cssW = width
        this._cssH = height
        // 首次直接画到目标值（不做动画）
        const target = this._pending != null ? this._pending : (this._display == null ? 0 : this._display)
        this._display = target
        this._pending = null
        this._draw(target)
      })
    },

    _stopAnim() {
      if (this._raf && this._canvas && this._canvas.cancelAnimationFrame) {
        this._canvas.cancelAnimationFrame(this._raf)
      }
      this._raf = null
    },

    /** value 变化 → 300ms ease-out 过渡（§4.6） */
    _animateTo(target) {
      if (!this._ctx) {
        this._pending = target // canvas 未就绪：ready 后直接画目标值
        return
      }
      const from = this._display == null ? 0 : this._display
      if (Math.abs(target - from) < 0.01) {
        this._display = target
        this._draw(target)
        return
      }
      this._stopAnim()
      const startAt = Date.now()
      const dur = 300
      const step = () => {
        const k = Math.min(1, (Date.now() - startAt) / dur)
        const ease = 1 - Math.pow(1 - k, 3) // ease-out
        const cur = from + (target - from) * ease
        this._display = cur
        this._draw(cur)
        if (k < 1) {
          this._raf = this._canvas.requestAnimationFrame(step)
        } else {
          this._raf = null
        }
      }
      this._raf = this._canvas.requestAnimationFrame(step)
    },

    /** 画轨道 + 进度弧 */
    _draw(pct) {
      const ctx = this._ctx
      if (!ctx) return
      const c = themeUtil.colors(this._theme)
      const stroke = rpx2px(this.data.stroke)
      const cx = this._cssW / 2
      const cy = this._cssH / 2
      const r = Math.min(this._cssW, this._cssH) / 2 - stroke / 2
      const progressColor = c[COLOR_KEYS[this.data.color] || 'primary']

      ctx.clearRect(0, 0, this._cssW, this._cssH)
      ctx.lineWidth = stroke
      ctx.lineCap = 'round'

      // 轨道：surface2 整圆
      ctx.beginPath()
      ctx.strokeStyle = c.surface2
      ctx.arc(cx, cy, r, 0, Math.PI * 2)
      ctx.stroke()

      // 进度弧：-90° 起顺时针
      const p = Math.max(0, Math.min(1, (pct || 0) / 100))
      if (p > 0) {
        ctx.beginPath()
        ctx.strokeStyle = progressColor
        ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * p)
        ctx.stroke()
      }
    }
  }
})
