# 司美助手 SiMeiHelper 🌱

> **GLP-1（司美格鲁肽 / 替尔泊肽）减重全周期陪伴微信小程序** · 极简 + AI native · 零 npm 依赖

「司美助手」陪伴你走完用 GLP-1 药物减重的整个周期：**观望 → 起始 → 递增 → 平台 → 维持 / 停药**。吃多少、怎么动、身体反应正不正常、什么时候该找医生——AI「小美」全程陪你。

数据全部存在你手机本地（`wx.setStorageSync`），默认不上传任何服务器。

<div align="center">

[![License](https://img.shields.io/badge/license-MIT-blue.svg?style=flat-square)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-WeChat%20%E5%BE%AE%E4%BF%A1%E5%B0%8F%E7%A8%8B%E5%BA%8F-07C160?style=flat-square)](https://developers.weixin.qq.com/miniprogram/dev/devtools/download.html)
[![Deps](https://img.shields.io/badge/deps-0%20npm-2ea44f?style=flat-square)](#-%E7%83%AD%E7%88%B1-0-npm-%E4%BE%9D%E8%B5%96)
[![Gates](https://img.shields.io/badge/%E9%97%A8%E9%98%80-17%20%E9%81%93%20%C2%B7%20900%2B%20%E6%96%AD%E8%A8%80%20%C2%B7%204.9s-1f6feb?style=flat-square)](#-%E8%87%AA%E5%8A%A8%E5%8C%96%E8%B4%A8%E9%87%8F%E9%97%A8)
[![Node](https://img.shields.io/badge/node-%E2%89%A518-339933?style=flat-square)](package.json)

</div>

---

## 目录

1. [项目是什么 & 为什么](#-项目是什么--为什么)
2. [功能一览](#-功能一览)
3. [运行](#-运行)
4. [接入大模型（可选）](#-接入大模型可选)
5. [自动化质量门](#-自动化质量门)
6. [开发与测试](#-开发与测试)
7. [项目结构](#-项目结构)
8. [架构概览](#-架构概览)
9. [文档导航](#-文档导航)
11. [工程约定](#-工程约定贡献者必读)
12. [开源引用](#-开源引用)
13. [License](#-license)
14. [人工 follow-up](#-人工-follow-up迁移到-git-之后必须补)

---

## 💊 项目是什么 & 为什么

GLP-1 类减重药周期长（4–12 周递增、再用 6–12 个月维持），用户全程要：
- **吃**：精确到 0.25mg 的剂量调整、注射部位轮换、漏打补打规则
- **动**：蛋白 / 水 / 运动达标，副作用（恶心 / 便秘 / 掉太快）监测
- **看**：体重曲线、阶段进度、什么时候该问医生
- **应**：红旗急症（胰腺炎、胆囊、脱水、过敏、甲状腺、严重低血糖）必须立刻 120

「司美助手」把这四件事压在一个**本地优先、零 npm 依赖、AI native** 的微信小程序里——六步 onboarding 走完就开始 60 天全周期陪伴。

---

## ✨ 功能一览

| 模块 | 说明 |
|---|---|
| 🤖 **AI 今日简报** | 每天一句话 + 三件事（规则引擎即时生成；可接大模型让语言更自然） |
| 💉 **注射记录** | 10 秒记一针，**8 个部位**自动轮换推荐，间隔安全提醒 |
| 📊 **体感浓度环** | Bateman 药代动力学模型估算「药效在身体里的相对水平」（仅示意） |
| 📝 **30 秒打卡** | 体重 / 感觉 / 症状 / 蛋白 / 喝水 / 运动；**一句话打卡**（"今天 88.5 公斤，有点恶心，吃了 3 份蛋白"） |
| 💬 **小美对话** | **红旗急症守卫 → 意图识别 → 规则模板 / 大模型回复**；能「帮你做事」（记打卡 / 去记针 / 出摘要） |
| 🔍 **洞察卡** | 13 条规则主动发现问题：掉太快、水喝少了、加量后不适、连续打卡… |
| 📈 **体重趋势** | 7 日均线 + 目标线 + 剂量变更标记 |
| 📋 **就诊摘要** | 一键生成给医生看的结构化摘要 + 复诊问题清单 |
| 🚨 **SOS 页** | 7 类红旗症状自查，急症**直接拨打 120**；心理热线 **12356** |
| 📚 **阶段知识卡** | **17 张**知识卡按用药阶段推荐（受 Cross-Reference 契约保护，删卡 / 错 id 立即 CI 失败） |
| 🌿 **难受模式** | 副作用重灾期界面自动降级 |
| 🌙 **暗色模式** | 完整支持 |

> 📷 **截图说明**：本 README 暂无截图。**所有截图需手动补**（见 [人工 follow-up](#-人工-follow-up迁移到-git-之后必须补)）。建议用微信开发者工具抓 today / log / chat / trend / sos 五个页面的深/浅色对比。

---

## 🚀 运行

```bash
# 1. 下载并安装微信开发者工具
#    https://developers.weixin.qq.com/miniprogram/dev/devtools/download.html

# 2. 「导入项目」选择本目录，AppID 选「测试号」（或留空游客模式）

# 3. 基础库选 ≥ 3.5.0，编译即可预览
```

数据全部存在手机本地（`wx.setStorageSync`），默认不上传任何服务器。

---

## 🤖 接入大模型（可选）

默认使用内置规则引擎（**离线、免费、稳定**）。想接入大模型让小美的语言更自然：

「我的 → 设置 → AI 服务 → 接入大模型」，填入 OpenAI 兼容接口信息：

- **Base URL**：`https://api.deepseek.com/v1`
- **模型名**：`deepseek-chat`
- **API Key**：你的 key

> ⚠️ **内测说明**：MVP 的 API Key 存在手机本地并直接请求服务商，仅适合开发与内测。**正式上线前必须改为自有后端 / 云函数代理**，并在小程序后台配置 request 合法域名。

---

## 🛡 自动化质量门

```bash
# 本地 / CI 一键跑完所有 17 道闸门（4.9s）
node tools/run-all.js
# 或：npm test
```

| # | 闸门 | 内容 |
|---|---:|---|
| 1 | `corpus.test.js` | **252 安全断言**（红旗 / 剂量拦截） |
| 2 | `insight.test.js` | 13 洞察规则 + 阶段推荐 |
| 3 | `integration.test.js` | 7 跨模块 + 签名 / storage |
| 4 | `llm.test.js` | 32 LLM 路径 + sanitize |
| 5 | `pk.test.js` | 14 药代向量 + **FDA 处方信息钉死** |
| 6 | `plan.test.js` | 5 阶段 + movingAvg |
| 7 | `rules.test.js` | 60+ 单元 + **安全回归断言** |
| 8 | `storage-contract.test.js` | 24 storage 契约 |
| 9 | `regression.test.js` | 45 Round 3 评审回归 |
| 10 | `sos.test.js` | 66 SOS 状态机 |
| 11 | `dose-flow.test.js` | 34 dose 状态机 |
| 12 | `kb-contract.test.js` | **17 知识卡结构 + 钉死 id + 全仓交叉引用** |
| 13 | `wxml-check.js` | 18 WXML 标签平衡 |
| 14 | `page-contract.js` | 12 页面引用一致性 |
| 15 | `check.js` | JSON / 页面 / 组件 / 语法 |
| 16 | `simulator.js` | 68 端到端 |
| 17 | `demo-runner.js` | **60 天用户旅程 + 5 项数据不变量**（Round 24 曾真实捕获 `med.history` 缺 `start` 事件） |

最近一次运行：**17 / 17 通过 ✅**

---

## 🛠 开发与测试

```bash
# 跑单个套件（< 100ms 即时反馈）
node test/pk.test.js       # 药代模型（FDA 参数钉死）
node test/rules.test.js    # 红旗 / 剂量守卫 / 意图 / 一句话解析
node test/insight.test.js  # 洞察卡触发 / 冷却 / once 语义
node test/plan.test.js     # 阶段判定 / 每日目标 / 减重速度
node test/kb-contract.test.js  # 知识卡契约（删卡 / 错 id 立即失败）

# 跑独立工具
node tools/check.js        # 集成校验：JSON / 页面完整性 / 组件引用 / 语法
node tools/simulator.js    # 端到端 68 项
node tools/demo-runner.js --fast  # 60 天用户旅程人类可读 narrative
node tools/wxml-check.js   # WXML 平衡（属性内 > / {{ }} 表达式 / 注释都正确处理）
node tools/page-contract.js  # 页面 wxml/js 引用一致性

# 真实用户体验（演示用，非 CI）
node tools/demo-runner.js --fast
# → Day 0 cold boot + 6 步 onboarding
# → Day 1 today 页 + 体重打卡
# → Day 7 连续打卡 → 首次洞察
# → Day 12 剂量递增 2.5 → 5mg
# → Day 30 体重平台 → plateau 阶段
# → Day 60 停药 → maintain 阶段
# + 5 项不变量：med 状态机迁移合法、体重轨迹、doses 有序、未触发聊天、未触发红旗
```

---

## 📂 项目结构

```
SiMeiHelper/
├── app.js / app.json / app.wxss            全局壳（启动守卫、主题、设计系统）
├── custom-tab-bar/                         自定义底部导航（emoji 版）
├── components/                             5 个公共组件
│   ├── ring/        体感浓度环（canvas）
│   ├── line-chart/  体重曲线（canvas）
│   ├── chip-group/  三态选择
│   ├── cup-grid/    水杯 0.5 步进
│   └── insight-card/洞察卡
├── pages/                                  12 个页面
│   ├── onboarding / today / log / chat / me / dose
│   ├── trend / plan / article / sos / report / settings
├── utils/                                  8 个零依赖纯函数模块
│   ├── date     — 日期工具
│   ├── storage  — wx.setStorageSync 封装
│   ├── pk       — Bateman 药代（FDA 处方信息钉死）
│   ├── plan     — 阶段 / 目标 / 减重速度
│   ├── rules    — 红旗 / 剂量守卫 / 意图 / 一句话解析
│   ├── insight  — 13 条洞察规则
│   ├── ai       — LLM 门面 + system prompt
│   └── theme    — canvas 取色（与 app.wxss 同步）
├── data/kb.js                              17 张知识卡内容（kb-contract 测试保护）
├── docs/                                   4 份规格（Claude Code 产出）
│   ├── 01-PRD.md  产品需求
│   ├── 02-UX.md   用户体验
│   ├── 03-VISUAL.md 视觉设计
│   └── 05-DATA.md 数据 / 安全规则权威源
└── docs/review/                            Round 26 code review 报告归档
```

---

## 🏗 架构概览

```
┌─────────────────────────────────────────────────────────────┐
│  pages (12)                                                  │
│  onLoad → buildContext (utils/ai.js) → screenRedFlags       │
│         → 红旗命中 → SOS / 120×3                            │
│         else → isLLM ? ai.chat(t, ctx) : rules.reply(t, ctx)  │
│         → guardOutput → 渲染                                 │
└─────────────────────────────────────────────────────────────┘
       ↓ writes
┌─────────────────────────────────────────────────────────────┐
│  utils/storage (wx.setStorageSync 封装)                      │
│  smh_profile / smh_doses / smh_checkins / smh_chat          │
│  smh_med / smh_insights / smh_meta                          │
└─────────────────────────────────────────────────────────────┘
       ↑ feeds
┌─────────────────────────────────────────────────────────────┐
│  utils/pk (Bateman 药代) ─→ utils/plan (阶段) ─→ utils/rules│
│  utils/insight (13 条规则) ─→ utils/ai (LLM 门面)          │
└─────────────────────────────────────────────────────────────┘
```

**关键设计原则：**
1. **零 npm 依赖**：所有逻辑都是 ≤ 30KB 纯 JS（文末统一了 console.log 占 99% 的依赖）。
2. **utils 零依赖纯函数**：任何 utils/* 模块都可以 `node test/*.test.js` 直接验证（不污染 IDE）。
3. **安全守卫不可绕过**：`screenRedFlags` 永远先于 LLM 调用；剂量不会越过 `guardOutput`。
4. **数据本地优先**：默认 `wx.setStorageSync`；接 LLM 仅发「必要摘要」。

---

## 📚 文档导航

| 文档 | 受众 | 内容 |
|---|---|---|
| [README.md](README.md) | 所有人 | 你正在读的 |
| [AGENTS.md](AGENTS.md) | 贡献者 | 项目协作约定（Claude Code 主规划 / DS Harness 并行 / 纯函数约束） |
| [RUNBOOK.md](RUNBOOK.md) | 开发者 | 本地开发 / 测试 / 工具使用手册 |
| [E2E-CHECKLIST.md](E2E-CHECKLIST.md) | 真机测试 | 60+ 步骤、10 大场景真机走查清单 |
| [CHANGELOG.md](CHANGELOG.md) | 所有人 | 26 轮变更日志 |
| [RELEASE.md](RELEASE.md) | 发布负责人 | 上线检查清单 + 人工 follow-up |
| [docs/01-PRD.md](docs/01-PRD.md) | PM / Claude Code | 产品需求规格 |
| [docs/02-UX.md](docs/02-UX.md) | 设计师 / Claude Code | 用户体验规格 |
| [docs/03-VISUAL.md](docs/03-VISUAL.md) | 设计师 / Claude Code | 视觉设计规格 |
| [docs/05-DATA.md](docs/05-DATA.md) | 数据 / 安全 / Claude Code | 数据模型、安全规则、状态机的**权威源** |
| [docs/review/A1~A4.md](docs/review/) | 评审者 | Round 26 code review 4 份完整报告 |

---

## 🤝 工程约定（贡献者必读）

见 [AGENTS.md](AGENTS.md)：

- **高维度决策**（规划 / 架构 / 主视觉 / UX / 最终审核）：Claude Code 承担
- **具体实现**（按 docs/ 规格写代码 / 跑测试 / 修 bug）：DS Harness 主 agent + 并行 subagent 承担
- **安全守卫**（红旗 / 剂量）不可绕过：顺序与测试样例以 `docs/05-DATA.md` 为准，改动必须回 Claude Code 审核
- **纯函数可测**：`utils/` 下模块不得调用 `wx.*`，必须能 `node test/*.test.js` 验证
- **多 agent 并行**：写范围冲突的文件（`app.json` / `app.wxss` / `components/` 公共件）由单一 owner 负责

---

## 🔗 开源引用

| 项目 | 用途 | 许可证 |
|---|---|---|
| [navidmosleminiya/glp1-pk](https://github.com/navidmosleminiya/glp1-pk) | Bateman 单室药代模型与参数思路（t½ / Tmax） | MIT |
| [My GLP Shot](https://myglpshot.com/) | 注射部位轮换、医生摘要、本地优先等产品特性参考 | 开源 |
| [xiaoxiaocheng416/GLP-1 Tracker](https://github.com/xiaoxiaocheng416/8-19-macpro) | Bateman 模型产品化思路（ADR-002） | — |
| [frankiegu/weight-loss-clock](https://github.com/frankiegu/weight-loss-clock) · [marlonluo2018/weightapp](https://github.com/marlonluo2018/weightapp) | 微信原生小程序工程结构参考 | MIT |

**药代参数**：以 FDA 处方信息为准（`docs/05-DATA.md §4.1`）：

| 药物 | t½ | Tmax | FDA 出处 |
|---|---:|---:|---|
| 司美格鲁肽 semaglutide | 168h (1 周) | 36h (1–3 天) | Ozempic / Wegovy PI |
| 替尔泊肽 tirzepatide | 132h (5–6 天) | 24h (8–72h) | Zepbound / Mounjaro PI |
| 度拉糖肽 dulaglutide | 120h (5 天) | 48h (24–72h) | Trulicity PI |

本应用的模型输出仅用于趋势示意，不是血药浓度检测。

---

## 📄 License

[MIT](LICENSE) — 使用、修改、商业用途均欢迎，详见 LICENSE 文件。

---

## 📌 人工 follow-up（迁移到 git 之后必须补）

- [ ] 把项目迁入 GitHub 仓库，补 live badges（`version`、`CI`、`release date`、`repo size`）
- [ ] 截图：today / log / chat / trend / sos 五页深 / 浅色共 10 张，放 `docs/assets/` 并在本文档 § 功能一览处插入
- [ ] 录制一段 60 秒 GIF 演示 onboarding → today → 注射记录 → 红旗 → SOS
- [ ] README_EN.md（按需）：本 README 全量英译
- [ ] Mermaid 架构图：把 § 架构概览 的 ASCII 图替换为 mermaid block
- [ ] CONTRIBUTING.md：把 [AGENTS.md](AGENTS.md) 的核心条款转为 Conventional Commits 风格 + PR template