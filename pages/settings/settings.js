// pages/settings — 设置（docs/02-UX.md §3.11）
const storage = require('../../utils/storage.js')
const ai = require('../../utils/ai.js')

const KEYS = storage.KEYS
const H = 3600000

// 合规 #1：默认推荐云函数代理（API Key 存在云函数环境变量，不在本机）
const CLOUD_PROXY_MODELS = [
  { value: 'deepseek-chat', label: 'DeepSeek（推荐 · 中文友好）' },
  { value: 'moonshot-v1-8k', label: '月之暗面 Kimi' },
  { value: 'glm-4-flash', label: '智谱 GLM-4-Flash（免费）' },
  { value: 'gpt-4o-mini', label: 'OpenAI GPT-4o-mini' },
]

Page({
  data: {
    provider: 'rules',
    providerOptions: [
      { value: 'rules', label: '内置规则（免费、离线、稳定）' },
      { value: 'cloud_proxy', label: '云函数代理（推荐 · 无需填 Key）' },
      { value: 'openai_compat', label: '自填 Key（高级用户 / 开发调试）' },
    ],
    cloudProxyModels: CLOUD_PROXY_MODELS,
    baseUrl: '',
    model: '',
    apiKey: '',
    apiKeyDisplay: '',
    isLLM: false,
    testResult: '',
    testColor: '',
    reminders: {},
    showApiForm: false,
    showCloudForm: false,
  },

  onLoad() {
    this._load()
  },

  onShow() {
    this._load()
  },

  _load() {
    const s = storage.get(KEYS.SETTINGS)
    const ai0 = s.ai || {}
    const isLLM = ai.isLLM()
    const showApiForm = ai0.provider === 'openai_compat'
    const showCloudForm = ai0.provider === 'cloud_proxy'
    this.setData({
      provider: ai0.provider || 'rules',
      baseUrl: ai0.baseUrl || '',
      model: ai0.model || '',
      apiKey: ai0.apiKey || '',
      apiKeyDisplay: ai0.apiKey ? maskKey(ai0.apiKey) : '',
      isLLM,
      showApiForm,
      showCloudForm,
      reminders: s.reminders || {},
      testResult: '',
      testColor: '',
    })
  },

  onPickProvider(e) {
    const v = e.detail.value
    storage.update(KEYS.SETTINGS, (s) => {
      s.ai = s.ai || {}
      s.ai.provider = v
      // 切换到云函数代理 → 清空旧的自填 baseUrl/apiKey，避免误用
      if (v === 'cloud_proxy') {
        s.ai.baseUrl = ''
        s.ai.apiKey = ''
        if (!s.ai.model) s.ai.model = 'deepseek-chat'
      }
      s.updatedAt = Date.now()
      return s
    })
    this._load()
  },

  onBaseUrl(e) {
    const v = e.detail.value.trim()
    storage.update(KEYS.SETTINGS, (s) => {
      s.ai = s.ai || {}
      s.ai.baseUrl = v
      s.updatedAt = Date.now()
      return s
    })
    this._load()
  },

  // 云函数代理模式：选择服务商 + 模型
  onPickCloudModel(e) {
    const v = e.detail.value
    storage.update(KEYS.SETTINGS, (s) => {
      s.ai = s.ai || {}
      s.ai.model = v
      s.updatedAt = Date.now()
      return s
    })
    this._load()
  },

  onModel(e) {
    const v = e.detail.value.trim()
    storage.update(KEYS.SETTINGS, (s) => {
      s.ai = s.ai || {}
      s.ai.model = v
      s.updatedAt = Date.now()
      return s
    })
    this._load()
  },

  onApiKey(e) {
    const v = e.detail.value
    storage.update(KEYS.SETTINGS, (s) => {
      s.ai = s.ai || {}
      s.ai.apiKey = v
      s.updatedAt = Date.now()
      return s
    })
    this.setData({ apiKeyDisplay: v ? maskKey(v) : '' })
  },

  async onTest() {
    this.setData({ testResult: '测试中…', testColor: '' })
    try {
      const r = await ai.testConnection()
      if (r.ok) {
        this.setData({ testResult: '连接成功 · ' + r.ms + 'ms', testColor: 'success' })
      } else {
        this.setData({ testResult: '连接失败：' + (r.error || '未知错误'), testColor: 'danger' })
      }
    } catch (e) {
      this.setData({ testResult: '连接失败：' + (e && e.message || '未知错误'), testColor: 'danger' })
    }
  },

  // ---- 提醒 ----

  onToggleDailyCheckin(e) {
    const on = !!e.detail.value
    storage.update(KEYS.SETTINGS, (s) => {
      s.reminders = s.reminders || {}
      s.reminders.dailyCheckin = on
      s.updatedAt = Date.now()
      return s
    })
    if (on) {
      const startSec = Math.floor(nextSameHourAt(21) / 1000)
      wx.addPhoneRepeatCalendar({
        title: '🌱 花 30 秒和小美打个卡',
        startTime: startSec,
        repeatInterval: 'day',
        alarm: true,
        alarmOffset: 0,
        success: () => wx.showToast({ title: '已加到手机日历', icon: 'none' }),
        fail: () => wx.showToast({ title: '打开小程序时我会提醒你', icon: 'none' }),
      })
    }
    this._load()
  },

  // ---- 关于 ----

  onGoDisclaimer() { wx.navigateTo({ url: '/pages/article/article?id=disclaimer' }) },

  // ---- 数据 ----

  onExport() {
    const json = storage.exportAll()
    wx.setClipboardData({
      data: json,
      success: () => wx.showToast({ title: '已复制 JSON', icon: 'none' }),
    })
  },

  onClearChat() {
    wx.showModal({
      title: '清空对话记录？',
      content: '打卡、体重和方案不会被影响。',
      confirmText: '清空',
      confirmColor: '#D14343',
      success: (r) => {
        if (!r.confirm) return
        storage.clearChat()
        wx.showToast({ title: '已清空对话', icon: 'none' })
      },
    })
  },

  onClearAll() {
    wx.showModal({
      title: '清空所有数据',
      editable: true,
      placeholderText: '输入"清空"确认',
      content: '',
      confirmText: '清空',
      confirmColor: '#D14343',
      success: (r) => {
        if (!r.confirm) return
        if ((r.content || '').trim() !== '清空') {
          wx.showToast({ title: '已取消', icon: 'none' })
          return
        }
        storage.clearAll()
        wx.reLaunch({ url: '/pages/onboarding/onboarding' })
      },
    })
  },
})

function maskKey(k) {
  if (!k) return ''
  if (k.length <= 4) return '*'.repeat(k.length)
  return '*'.repeat(k.length - 4) + k.slice(-4)
}

function nextSameHourAt(hour) {
  const now = new Date()
  let d = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, 0, 0, 0)
  if (d.getTime() <= now.getTime()) d = new Date(d.getTime() + 86400000)
  return d.getTime()
}