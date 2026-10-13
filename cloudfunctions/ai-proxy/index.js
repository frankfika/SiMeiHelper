// 云函数 ai-proxy — 合规 #1：API Key 存在云端环境变量，小程序端只转发消息
// 部署：右键 cloudfunctions/ai-proxy → 上传并部署：云端安装依赖
// 环境变量（在云函数控制台「配置 → 环境变量」添加）：
//   DEEPSEEK_API_KEY    = sk-xxxxxxxxxxxx
//   MOONSHOT_API_KEY     = sk-xxxxxxxxxxxx
//   ZHIPU_API_KEY       = xxxxxxxx.xxxxxxxx
//   OPENAI_API_KEY      = sk-xxxxxxxxxxxx
//
// 小程序端调用：
//   wx.cloud.callFunction({
//     name: 'ai-proxy',
//     data: { provider: 'deepseek', model: 'deepseek-chat', messages: [...], temperature: 0.6, json: true, maxTokens: 600 }
//   })

const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const PROVIDERS = {
  deepseek: {
    baseUrl: 'https://api.deepseek.com/v1/chat/completions',
    envKey: 'DEEPSEEK_API_KEY',
    name: 'DeepSeek',
  },
  moonshot: {
    baseUrl: 'https://api.moonshot.cn/v1/chat/completions',
    envKey: 'MOONSHOT_API_KEY',
    name: '月之暗面 Kimi',
  },
  kimi: {
    baseUrl: 'https://api.moonshot.cn/v1/chat/completions',
    envKey: 'MOONSHOT_API_KEY',
    name: '月之暗面 Kimi',
  },
  zhipu: {
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4/chat/completions',
    envKey: 'ZHIPU_API_KEY',
    name: '智谱',
  },
  openai: {
    baseUrl: 'https://api.openai.com/v1/chat/completions',
    envKey: 'OPENAI_API_KEY',
    name: 'OpenAI',
  },
}

exports.main = async (event, context) => {
  const t0 = Date.now()
  const provider = String(event.provider || '').toLowerCase()
  const model = String(event.model || '')
  const messages = Array.isArray(event.messages) ? event.messages : []
  const temperature = typeof event.temperature === 'number' ? event.temperature : 0.6
  const json = !!event.json
  const maxTokens = typeof event.maxTokens === 'number' ? event.maxTokens : 600

  const cfg = PROVIDERS[provider]
  if (!cfg) return { ok: false, error: '不支持的服务商：' + provider, provider, model }
  if (!model) return { ok: false, error: '缺少模型名', provider }
  if (!messages.length) return { ok: false, error: '缺少消息', provider, model }

  const apiKey = process.env[cfg.envKey]
  if (!apiKey) {
    return {
      ok: false,
      error: '云函数未配置环境变量 ' + cfg.envKey + '（请到云函数控制台 → 配置 → 环境变量添加对应服务商的 API Key）',
      provider,
      model,
    }
  }

  // 请求体（OpenAI 兼容）
  const body = {
    model,
    messages,
    temperature,
    max_tokens: maxTokens,
    stream: false,
  }
  if (json) body.response_format = { type: 'json_object' }

  try {
    const resp = await cloud.fetch({
      url: cfg.baseUrl,
      method: 'POST',
      header: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + apiKey,
      },
      data: body,
      timeout: 20000,
    })

    if (resp.statusCode !== 200) {
      return {
        ok: false,
        error: cfg.name + ' 接口返回 HTTP ' + resp.statusCode + '：' + (resp.data || '').toString().slice(0, 200),
        provider,
        model,
        ms: Date.now() - t0,
      }
    }

    const data = resp.data || {}
    const content = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content
    if (typeof content !== 'string') {
      return {
        ok: false,
        error: cfg.name + ' 返回结构异常：' + JSON.stringify(data).slice(0, 200),
        provider,
        model,
        ms: Date.now() - t0,
      }
    }

    return {
      ok: true,
      content,
      provider,
      model,
      usage: data.usage || null,
      ms: Date.now() - t0,
    }
  } catch (e) {
    return {
      ok: false,
      error: '网络错误：' + (e && e.errMsg || e && e.message || '未知'),
      provider,
      model,
      ms: Date.now() - t0,
    }
  }
}