// 司美助手 SiMeiHelper — 应用入口
// 职责（docs/05-DATA.md §1.4）：本地存储迁移、全局状态、启动守卫
// storage 是唯一允许读写 wx storage 的模块（§3.2）
const storage = require('./utils/storage.js')

App({
  onLaunch() {
    // 启动即迁移（§2.11）：首次启动写入 installedAt；
    // 之后按 meta.schemaVersion 逐级执行 MIGRATIONS
    storage.migrate()

    // 全局状态：
    // - pendingAsk：从洞察卡 / 简报跳入小美页时的预填问题（§9 依赖图）
    // - theme：系统主题，供 canvas 组件（ring / line-chart）经 utils/theme.js 取色
    //   theme 字段仅在 app.json 开启 darkmode 后返回，取不到时回落浅色
    this.globalData = {
      pendingAsk: null,
      theme: (wx.getSystemInfoSync().theme || 'light')
    }

    // 跟随系统深浅色切换（03-VISUAL §3.7 第 4 条）：
    // canvas 组件在各自 onThemeChange 监听里读 globalData.theme 重绘
    wx.onThemeChange((res) => {
      this.globalData.theme = res.theme
    })

    // 合规 #1：云函数代理 — 在 app.js 初始化 wx.cloud，使设置页可选"云函数代理"
    // ⚠️ 首次使用前：到微信公众平台 → 开发管理 → 开通云开发；获取 env id 后替换 'YOUR-ENV-ID'
    if (typeof wx.cloud !== 'undefined') {
      try {
        wx.cloud.init({ env: 'YOUR-ENV-ID', traceUser: false })
      } catch (e) {
        // 云开发未开通时静默失败，AI 服务走"内置规则"或"自填 key"模式
      }
    }
  },

  // 启动守卫（§1.4）：每个 tab 页 onLoad 第一行调用
  //   if (!app.ensureOnboarded()) return
  // 未同意当前版本免责声明 / 隐私政策 / 服务条款，或未完成 onboarding → reLaunch 并返回 false
  ensureOnboarded() {
    const meta = storage.get('smh_meta')
    if (
      meta.disclaimerAcceptedVersion !== storage.DISCLAIMER_VERSION ||
      meta.privacyAcceptedVersion !== storage.PRIVACY_VERSION ||
      meta.termsAcceptedVersion !== storage.TERMS_VERSION ||
      !meta.onboardedAt
    ) {
      wx.reLaunch({ url: '/pages/onboarding/onboarding' })
      return false
    }
    return true
  },

  globalData: {
    pendingAsk: null,
    theme: 'light'
  }
})
