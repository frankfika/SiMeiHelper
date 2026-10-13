/**
 * line-chart — 体重趋势折线图（03-VISUAL §4.7）
 * properties:
 *   points  [{date:'YYYY-MM-DD', kg:Number}] 原始测量点
 *   avg     同结构均值序列（均线 / 面积数据源）
 *   markers [{date, label}] 竖虚线 + 顶部标签
 *   goal    目标体重 kg（Number|null）
 *   mode    'full' 完整图 | 'mini' 迷你图（无轴无点）
 *   height  画布高 rpx（默认 320）
 * 取色走 utils/theme.js；系统切换深浅色时重绘。
 * 事件：无（点按交互为组件内 tooltip 展示）
 */
const themeUtil = require('../../utils/theme.js')

const DAY_MS = 24 * 60 * 60 * 1000

/** 窗口信息（windowWidth / pixelRatio），带兜底 */
function getWindow() {
  try {
    return wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()
  } catch (e) {
    return { windowWidth: 375, pixelRatio: 2 }
  }
}

/** rpx→px：以 750 设计稿为基准 */
function rpx2px(rpx) {
  return rpx * (getWindow().windowWidth || 375) / 750
}

/** '#RRGGBB' → 'r,g,b'（拼 rgba 用） */
function hexToRgb(hex) {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex || '')
  if (!m) return '0,0,0'
  const n = parseInt(m[1], 16)
  return ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255)
}

/** '2026-10-05' → Date.parse 毫秒（UTC 中午避免时区偏移） */
function dateToMs(d) {
  return Date.parse(d + 'T12:00:00Z')
}

/** '2026-10-05' → '10/5' */
function fmtDate(d) {
  const parts = String(d || '').split('-')
  if (parts.length < 3) return String(d || '')
  return parseInt(parts[1], 10) + '/' + parseInt(parts[2], 10)
}

/** kg → 显示值：88.4 → '88.4'，88 → '88' */
function fmtKg(kg) {
  return String(Math.round(kg * 10) / 10)
}

/** 按 date 升序拷贝排序 */
function sortByDate(list) {
  return (list || []).slice().sort((a, b) => dateToMs(a.date) - dateToMs(b.date))
}

Component({
  properties: {
    points: { type: Array, value: [] },
    avg: { type: Array, value: [] },
    markers: { type: Array, value: [] },
    goal: { type: null, value: null },
    mode: { type: String, value: 'full' },
    height: { type: Number, value: 320 }
  },

  data: {
    empty: false,                               // 无任何数据 → 「暂无数据」
    tip: { show: false, x: 0, y: 0, text: '' }  // tooltip 浮层
  },

  lifetimes: {
    attached() {
      const app = typeof getApp === 'function' ? getApp() : null
      this._theme = (app && app.globalData && app.globalData.theme) || 'light'
      this._onThemeChange = (res) => {
        this._theme = (res && res.theme) || 'light'
        this._refresh()
      }
      if (wx.onThemeChange) wx.onThemeChange(this._onThemeChange)
    },
    detached() {
      if (wx.offThemeChange) wx.offThemeChange(this._onThemeChange)
    },
    ready() {
      this._initCanvas()
    }
  },

  observers: {
    'points, avg, markers, goal, mode'() {
      this._refresh()
    },
    height() {
      // 高度变化会改变布局尺寸，需要重设画布缓冲
      this._initCanvas()
    }
  },

  methods: {
    /** 数据 / 主题变化入口：判空并重绘 */
    _refresh() {
      const points = this.data.points || []
      const avg = this.data.avg || []
      const empty = points.length === 0 && avg.length === 0
      if (empty !== this.data.empty) this.setData({ empty })
      if (empty) {
        // 清空数据时隐藏 tooltip 并清除高亮
        this._tap = null
        if (this.data.tip.show) this.setData({ tip: { show: false, x: 0, y: 0, text: '' } })
      }
      if (this._ctx) this._draw()
    },

    /** 初始化 canvas：按布局尺寸 × dpr 设缓冲 */
    _initCanvas() {
      const query = this.createSelectorQuery()
      query.select('#chart-canvas').fields({ node: true, size: true }).exec((res) => {
        if (!res || !res[0] || !res[0].node) return
        const node = res[0].node
        const width = res[0].width
        const height = res[0].height
        if (!width || !height) return
        const dpr = getWindow().pixelRatio || 2
        node.width = width * dpr
        node.height = height * dpr
        const ctx = node.getContext('2d')
        ctx.scale(dpr, dpr)
        this._canvas = node
        this._ctx = ctx
        this._w = width
        this._h = height
        this._refresh()
      })
    },

    /** 点按：找最近的可见点，展示 / 隐藏 tooltip（仅 full 模式） */
    onTap(e) {
      if (this.data.mode !== 'full' || this.data.empty) return
      const touch = (e.changedTouches && e.changedTouches[0]) || (e.touches && e.touches[0])
      if (!touch) return
      // 实时测量 canvas 位置（页面滚动会影响 clientY 映射）
      this.createSelectorQuery().select('#chart-canvas').boundingClientRect((rect) => {
        if (!rect) return
        this._hitTest(touch.clientX - rect.left, touch.clientY - rect.top)
      }).exec()
    },

    /** 命中检测：x 距离最近且 ≤ 32px 命中；再点同一点隐藏 */
    _hitTest(x, y) {
      const scale = this._scale
      if (!scale) return
      const candidates = (this._lineSeries || []).concat(this._rawSorted || [])
      let best = null
      let bestDx = Infinity
      candidates.forEach((p) => {
        const px = this._xOf(p.date)
        const dx = Math.abs(px - x)
        if (dx < bestDx) {
          bestDx = dx
          best = p
        }
      })
      const THRESHOLD = 32
      if (!best || bestDx > THRESHOLD) {
        this._tap = null
        this._draw()
        if (this.data.tip.show) this.setData({ tip: { show: false, x: 0, y: 0, text: '' } })
        return
      }
      if (this._tap && this._tap.date === best.date && Math.abs(this._tap.kg - best.kg) < 0.001) {
        // 再点同一点 → 收起
        this._tap = null
        this._draw()
        this.setData({ tip: { show: false, x: 0, y: 0, text: '' } })
        return
      }
      this._tap = { date: best.date, kg: best.kg }
      this._draw()
      const py = this._yOf(best.kg)
      const xPx = Math.min(Math.max(this._xOf(best.date), 40), this._w - 40)
      this.setData({
        tip: {
          show: true,
          x: xPx,
          y: py,
          text: fmtDate(best.date) + ' · ' + fmtKg(best.kg) + 'kg'
        }
      })
    },

    /** 由缓存的比例尺换算坐标（命中检测与 tooltip 定位用） */
    _xOf(date) {
      const s = this._scale
      return s.padL + (dateToMs(date) - s.minX) / (s.maxX - s.minX) * s.plotW
    },
    _yOf(kg) {
      const s = this._scale
      return s.padT + (1 - (kg - s.minY) / (s.maxY - s.minY)) * s.plotH
    },

    /** 主绘制流程 */
    _draw() {
      const ctx = this._ctx
      if (!ctx) return
      const c = themeUtil.colors(this._theme)
      const mini = this.data.mode === 'mini'
      const w = this._w
      const h = this._h

      ctx.clearRect(0, 0, w, h)
      if (this.data.empty) return

      // full：内边距 左64/右24/上32/下48 rpx；mini：四边小留白
      const padL = mini ? rpx2px(8) : rpx2px(64)
      const padR = mini ? rpx2px(8) : rpx2px(24)
      const padT = mini ? rpx2px(8) : rpx2px(32)
      const padB = mini ? rpx2px(8) : rpx2px(48)
      const plotW = w - padL - padR
      const plotH = h - padT - padB
      if (plotW <= 0 || plotH <= 0) return

      const points = sortByDate(this.data.points)
      const avg = sortByDate(this.data.avg)
      const markers = this.data.markers || []
      const goal = this.data.goal == null || isNaN(Number(this.data.goal))
        ? null : Number(this.data.goal)

      // 均线数据源：avg 不足 2 点时回退到原始点（min 早期数据也有线可看）
      const lineSeries = avg.length >= 2
        ? avg
        : (points.length >= 2 ? points : [])
      // mini：点 < 7 画原始折线，否则均线；无 avg 时回退原始点
      const miniSeries = (points.length > 0 && points.length < 7)
        ? points
        : (avg.length > 0 ? avg : points)
      const series = mini ? miniSeries : lineSeries
      this._lineSeries = series
      this._rawSorted = mini ? [] : points // full 模式原始点参与命中检测

      // —— 比例尺 ——
      // X 域：数据 ∪ markers 的日期范围
      let minX = Infinity
      let maxX = -Infinity
      ;[].concat(points, avg, markers).forEach((p) => {
        if (!p || !p.date) return
        const t = dateToMs(p.date)
        if (isNaN(t)) return
        if (t < minX) minX = t
        if (t > maxX) maxX = t
      })
      if (!isFinite(minX)) return
      if (maxX - minX < DAY_MS) { minX -= DAY_MS / 2; maxX += DAY_MS / 2 } // 单点时居中

      // Y 域：[min−1, max+1] 取整（含目标线）
      let minKg = Infinity
      let maxKg = -Infinity
      ;[].concat(points, avg, goal == null ? [] : [goal]).forEach((kg) => {
        const n = Number(kg)
        if (kg == null || isNaN(n)) return
        if (n < minKg) minKg = n
        if (n > maxKg) maxKg = n
      })
      if (!isFinite(minKg)) return
      const minY = Math.floor(minKg - 1)
      const maxY = Math.ceil(maxKg + 1)

      this._scale = { minX, maxX, minY, maxY, padL, padT, plotW, plotH }
      const xOf = (date) => this._xOf(date)
      const yOf = (kg) => this._yOf(kg)
      const fsCaption = rpx2px(24) // --fs-caption 等值 px

      ctx.font = fsCaption + 'px -apple-system, "PingFang SC", sans-serif'

      // —— 网格 + Y 轴标签（full）：3 条水平线 [minY, 中位, maxY] ——
      if (!mini) {
        const midY = Math.round((minY + maxY) / 2)
        ctx.strokeStyle = c.border
        ctx.lineWidth = 1
        ctx.setLineDash([])
        ctx.fillStyle = c.text3
        ctx.textAlign = 'right'
        ctx.textBaseline = 'middle'
        ;[minY, midY, maxY].forEach((kg) => {
          const y = yOf(kg)
          ctx.beginPath()
          ctx.moveTo(padL, y)
          ctx.lineTo(padL + plotW, y)
          ctx.stroke()
          ctx.fillText(String(kg), padL - rpx2px(8), y)
        })

        // —— X 轴标签：首 / 中 / 尾「10/5」 ——
        const dateList = []
        ;[].concat(points, avg).forEach((p) => {
          if (p && p.date && dateList.indexOf(p.date) === -1) dateList.push(p.date)
        })
        dateList.sort((a, b) => dateToMs(a) - dateToMs(b))
        if (dateList.length > 0) {
          const picks = dateList.length === 1
            ? [dateList[0]]
            : [dateList[0], dateList[Math.floor((dateList.length - 1) / 2)], dateList[dateList.length - 1]]
          const uniq = []
          picks.forEach((d) => {
            if (uniq.indexOf(d) === -1) uniq.push(d)
          })
          ctx.fillStyle = c.text3
          ctx.textAlign = 'center'
          ctx.textBaseline = 'top'
          uniq.forEach((d) => {
            ctx.fillText(fmtDate(d), Math.min(Math.max(xOf(d), padL + 8), padL + plotW - 8), padT + plotH + rpx2px(12))
          })
        }
      }

      // —— 均线下方面积：primary 18% → 0% 竖向渐变 ——
      if (series.length >= 2) {
        const grad = ctx.createLinearGradient(0, padT, 0, padT + plotH)
        const rgb = hexToRgb(c.primary)
        grad.addColorStop(0, 'rgba(' + rgb + ',0.18)')
        grad.addColorStop(1, 'rgba(' + rgb + ',0)')
        ctx.beginPath()
        ctx.moveTo(xOf(series[0].date), padT + plotH)
        series.forEach((p) => ctx.lineTo(xOf(p.date), yOf(p.kg)))
        ctx.lineTo(xOf(series[series.length - 1].date), padT + plotH)
        ctx.closePath()
        ctx.fillStyle = grad
        ctx.fill()
      }

      // —— 目标线：success 虚线 [6,6] + 右端标签「目标 80」（full） ——
      if (!mini && goal != null) {
        const gy = yOf(goal)
        ctx.save()
        ctx.strokeStyle = c.success
        ctx.lineWidth = 1
        ctx.setLineDash([6, 6])
        ctx.beginPath()
        ctx.moveTo(padL, gy)
        ctx.lineTo(padL + plotW, gy)
        ctx.stroke()
        ctx.restore()
        ctx.fillStyle = c.success
        ctx.textAlign = 'right'
        ctx.textBaseline = 'bottom'
        ctx.fillText('目标 ' + fmtKg(goal), padL + plotW, gy - 4)
      }

      // —— markers：text-3 1px 虚线竖线（full） ——
      if (!mini) {
        markers.forEach((m) => {
          if (!m || !m.date) return
          const t = dateToMs(m.date)
          if (isNaN(t) || t < minX || t > maxX) return
          const mx = xOf(m.date)
          ctx.save()
          ctx.strokeStyle = c.text3
          ctx.lineWidth = 1
          ctx.setLineDash([4, 4])
          ctx.beginPath()
          ctx.moveTo(mx, padT)
          ctx.lineTo(mx, padT + plotH)
          ctx.stroke()
          ctx.restore()
        })
      }

      // —— 均线：primary，直线连接（无平滑） ——
      if (series.length >= 2) {
        ctx.strokeStyle = c.primary
        ctx.lineWidth = mini ? 2 : 2.5
        ctx.lineJoin = 'round'
        ctx.lineCap = 'round'
        ctx.setLineDash([])
        ctx.beginPath()
        series.forEach((p, i) => {
          if (i === 0) ctx.moveTo(xOf(p.date), yOf(p.kg))
          else ctx.lineTo(xOf(p.date), yOf(p.kg))
        })
        ctx.stroke()
      }

      // —— 原始点：3px text-3 60% 透明（full） ——
      if (!mini) {
        ctx.save()
        ctx.fillStyle = c.text3
        ctx.globalAlpha = 0.6
        points.forEach((p) => {
          ctx.beginPath()
          ctx.arc(xOf(p.date), yOf(p.kg), 3, 0, Math.PI * 2)
          ctx.fill()
        })
        ctx.restore()
      }

      // —— marker 顶部标签：surface 底圆角矩形防遮挡（full，最后画） ——
      if (!mini) {
        markers.forEach((m) => {
          if (!m || !m.date || !m.label) return
          const t = dateToMs(m.date)
          if (isNaN(t) || t < minX || t > maxX) return
          const label = String(m.label)
          const tw = ctx.measureText(label).width
          const bw = tw + rpx2px(16)
          const bh = fsCaption + rpx2px(8)
          const bx = Math.min(Math.max(xOf(m.date) - bw / 2, padL), padL + plotW - bw)
          const by = padT + 2
          ctx.fillStyle = c.surface
          this._roundRect(ctx, bx, by, bw, bh, rpx2px(8))
          ctx.fill()
          ctx.fillStyle = c.text3
          ctx.textAlign = 'center'
          ctx.textBaseline = 'middle'
          ctx.fillText(label, bx + bw / 2, by + bh / 2)
        })
      }

      // —— 点中高亮：text-1 4px 实心圆（full） ——
      if (!mini && this._tap) {
        ctx.save()
        ctx.fillStyle = c.text1
        ctx.beginPath()
        ctx.arc(xOf(this._tap.date), yOf(this._tap.kg), 4, 0, Math.PI * 2)
        ctx.fill()
        ctx.restore()
      }
    },

    /** 圆角矩形路径（marker 标签底） */
    _roundRect(ctx, x, y, w, h, r) {
      ctx.beginPath()
      ctx.moveTo(x + r, y)
      ctx.arcTo(x + w, y, x + w, y + h, r)
      ctx.arcTo(x + w, y + h, x, y + h, r)
      ctx.arcTo(x, y + h, x, y, r)
      ctx.arcTo(x, y, x + w, y, r)
      ctx.closePath()
    }
  }
})
