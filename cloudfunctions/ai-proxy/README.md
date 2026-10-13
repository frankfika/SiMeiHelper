# 云函数 ai-proxy 部署文档

## 是什么

把 OpenAI 兼容接口调用从"用户手机直连"改为"小程序 → 微信云函数 → AI 服务商"。
**API Key 永远只在云函数环境变量**，用户手机本地不再保存。
这就是 RELEASE.md 里写的"合规 #1 — API Key 走云函数代理"。

## 支持的服务商

| provider | baseUrl | 所需环境变量 |
|---|---|---|
| `deepseek` | https://api.deepseek.com/v1/chat/completions | `DEEPSEEK_API_KEY` |
| `moonshot` / `kimi` | https://api.moonshot.cn/v1/chat/completions | `MOONSHOT_API_KEY` |
| `zhipu` | https://open.bigmodel.cn/api/paas/v4/chat/completions | `ZHIPU_API_KEY` |
| `openai` | https://api.openai.com/v1/chat/completions | `OPENAI_API_KEY` |

## 部署步骤（开发者工具）

1. 微信开发者工具 → 项目根目录 → 找到 `cloudfunctions/ai-proxy/`
2. 右键 → 选择"上传并部署：云端安装依赖"（首次会等约 30–60 秒）
4. 控制台 → 微信云开发 → 云函数 → `ai-proxy` → 配置 → 环境变量
5. 添加你需要的 key，比如 `DEEPSEEK_API_KEY = sk-xxxxxxxx`
6. 保存

## 小程序端调用

**用户不需要懂技术，只需要在设置里选「云函数代理」+ 模型（DeepSeek / Kimi / GLM / GPT）**。

底层调用：
```js
wx.cloud.callFunction({
  name: 'ai-proxy',
  data: {
    provider: 'deepseek',
    model: 'deepseek-chat',
    messages: [{ role: 'user', content: '...' }],
    temperature: 0.6,
    json: false,
    maxTokens: 600,
  },
  success(r) { /* r.result.content */ },
  fail(e) { /* 网络错误 */ },
})
```

## app.js 必须初始化

在 app.js onLaunch 加入：
```js
wx.cloud.init({ env: 'your-env-id', traceUser: false })
```

## 部署清单 checklist

- [ ] 已开通微信云开发
- [ ] 已部署 ai-proxy 云函数
- [ ] 已在环境变量填至少一个 API Key（推荐 DeepSeek，便宜且中文友好）
- [ ] app.js 已加 wx.cloud.init
- [ ] 已在 MP 后台「开发管理 → 服务器域名」配置 `request 合法域名`（包括云函数域名）
- [ ] 真机测试：在设置选「云函数代理」→ 选「DeepSeek」→ 「测试连接」显示「连接成功 · XXXms」

## 费用

- 微信云函数调用：每月前 1000 次免费
- API Key 实际费用按所选服务商计（DeepSeek-chat 约 ¥0.001/1k token）

## 安全

- API Key 仅存云端环境变量（微信侧管理）
- 云函数不在前端暴露任何 key
- 可在云函数里加"用户登录态校验"防滥用（context.OPENID）
- 单用户每天 N 次上限（建议在云函数内做）