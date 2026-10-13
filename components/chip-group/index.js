/**
 * chip-group — 选项 chip（03-VISUAL §4.4）
 * mode: 'single' 单选（value=单值） | 'multi' 多选（value=数组）
 *       | 'tri' 三态（value={key:1|2}：点一次=轻，再点=重，第三次取消）
 * 事件 change，detail { value }
 */
Component({
  properties: {
    options: { type: Array, value: [] },        // [{value, label}]
    value: { type: null, value: null },         // 当前选中（随 mode 结构不同）
    mode: { type: String, value: 'single' },
    size: { type: String, value: 'md' },        // 'md' | 'lg'
    columns: { type: Number, value: 0 }         // >0 固定列数网格
  },

  data: {
    items: [],      // 渲染用：[{idx, value, label, state: 'off'|'on'|'light', badge}]
    gridStyle: ''   // columns > 0 时的容器样式
  },

  lifetimes: {
    attached() {
      this._rebuild()
      this._applyColumns()
    }
  },

  observers: {
    'options, value, mode'() {
      this._rebuild()
    },
    columns() {
      this._applyColumns()
    }
  },

  methods: {
    _applyColumns() {
      const n = Number(this.data.columns) || 0
      this.setData({
        gridStyle: n > 0
          ? 'display:grid;grid-template-columns:repeat(' + n + ',1fr);'
          : ''
      })
    },

    /** 由 options + value + mode 计算每个 chip 的状态 */
    _rebuild() {
      const options = this.data.options || []
      const value = this.data.value
      const mode = this.data.mode
      const items = options.map((opt, idx) => {
        let state = 'off'
        let badge = false
        if (mode === 'single') {
          state = opt.value === value ? 'on' : 'off'
        } else if (mode === 'multi') {
          const arr = Array.isArray(value) ? value : []
          state = arr.indexOf(opt.value) > -1 ? 'on' : 'off'
        } else if (mode === 'tri') {
          const v = (value && typeof value === 'object' && !Array.isArray(value))
            ? value[opt.value]
            : undefined
          if (v === 1) {
            state = 'light'
          } else if (v === 2) {
            state = 'on'
            badge = true
          }
        }
        return { idx, value: opt.value, label: opt.label, state, badge }
      })
      this.setData({ items })
    },

    /** 点击：按 mode 计算下一个值并抛出（自身不存状态，以页面数据为准） */
    onTap(e) {
      const idx = Number(e.currentTarget.dataset.idx)
      const item = this.data.items[idx]
      if (!item) return
      const mode = this.data.mode
      const cur = this.data.value
      let next

      if (mode === 'single') {
        next = item.value
      } else if (mode === 'multi') {
        const arr = Array.isArray(cur) ? cur.slice() : []
        const i = arr.indexOf(item.value)
        if (i > -1) {
          arr.splice(i, 1)
        } else {
          arr.push(item.value)
        }
        next = arr
      } else {
        // tri：轻(1) → 重(2) → 取消（移除该 key）
        const obj = (cur && typeof cur === 'object' && !Array.isArray(cur))
          ? Object.assign({}, cur)
          : {}
        const v = obj[item.value]
        if (v === 1) {
          obj[item.value] = 2
        } else if (v === 2) {
          delete obj[item.value]
        } else {
          obj[item.value] = 1
        }
        next = obj
      }

      this.triggerEvent('change', { value: next })
    }
  }
})
