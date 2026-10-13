// 自定义底部 Tab（docs/03-VISUAL.md §4.10）
// 数据驱动：list 数组渲染 4 个 tab（emoji + 文字，无需图片资源，暗色下表现一致）
// 选中态主机制：各 tab 页 onShow 里 this.getTabBar().setData({ selected: <index> })；
// attached 里用 getCurrentPages 最后一个页面 route 兜底匹配一次，避免首帧高亮错位。
Component({
  data: {
    selected: 0,
    list: [
      { pagePath: '/pages/today/today', text: '今天', icon: '☀️' },
      { pagePath: '/pages/log/log', text: '记录', icon: '📝' },
      { pagePath: '/pages/chat/chat', text: '小美', icon: '✨', ai: true },
      { pagePath: '/pages/me/me', text: '我的', icon: '🙂' }
    ]
  },

  lifetimes: {
    attached() {
      // 兜底：按页面栈最后一页的 route 匹配选中项（仍以页面 onShow 的 setData 为主）
      const pages = getCurrentPages()
      const current = pages[pages.length - 1]
      if (!current || !current.route) return
      const index = this.data.list.findIndex((item) => item.pagePath === '/' + current.route)
      if (index >= 0 && index !== this.data.selected) {
        this.setData({ selected: index })
      }
    }
  },

  methods: {
    onTabTap(e) {
      const { path, index } = e.currentTarget.dataset
      const next = Number(index)
      // 已在当前页：不重复跳转
      if (next === this.data.selected) return
      // 不在这里 setData(selected)：由目标页 onShow 设置，避免切换期间高亮闪烁（§4.10）
      wx.switchTab({ url: path })
    }
  }
})
