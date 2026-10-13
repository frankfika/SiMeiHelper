# CHANGELOG — 司美助手 SiMeiHelper

> 关键变更日志。Claude Code 主规划 + DS Harness 多 agent 并行实现，26 轮完成 MVP + 全面质量门。

## Round 1 — 主规划
- Claude Code 产出 4 份规格文档（2400 行）：01-PRD / 02-UX / 03-VISUAL / 05-DATA
- 顺带修复 `utils/pk.js` 的剂量归一 bug（替尔泊肽 2.5mg 数值被放大 6.25×）

## Round 2 — 多 agent 并行实现
- 壳 / 5 组件 / 服务层（rules/insight/ai+kb）
- 8 个页面一次性交付：onboarding / today / log / chat / me / dose / trend / plan / article / sos / report / settings
- 4 个测试套件覆盖：药代 14 向量、计划、规则、洞察

## Round 3 — Claude Code 最终评审修复
- DS Harness 兜底补齐 me / dose / plan / settings / report / chat.wxss / log
- Claude Code 最终评审：**1 blocker + 9 majors + 5 minors**，全部修复
  - **B1 blocker**：dose/plan 剂量 chip 改为 `{value:number, label:'Xmg'}` 对象数组
  - **S1–S8**：8 条安全守卫/正则加固（低血糖 13.5 误报、胰腺炎漏报、剂量守卫加翻倍/补打）
  - **P1–3**：injectedToday 字段、apply_checkin 合并症状、recentHistory 去重
  - **Q1–3**：注射间隔最近邻、calendarAdded 增量合并

## Round 4 — 安全语料库 Phase 1（191 断言）
- 8 类红旗真命中 / 53 真不命中 / 59 剂量拦截 / 24 剂量放行
- 语料库驱动的正则硬化（红旗下血糖/胰腺炎/过敏变体）

## Round 5 — 运营文档
- `RUNBOOK.md`（开发者运行手册）
- `E2E-CHECKLIST.md`（10 大场景 60+ 步骤真机走查清单）
- `CHANGELOG.md`（本文件）

## Round 6 — 跨模块集成测试
- `test/integration.test.js` — 7 个用户旅程 + 页面-服务签名 + storage key 一致性
- 捕获跨模块接线 bug（单元测试盲点）

## Round 7 — 端到端用户会话模拟器
- `tools/simulator.js` — 53 项端到端断言：onboarding → 注射 → 打卡 → 对话 → 报告 → 导出
- 用 wx-shim 在 node 下复现完整状态机

## Round 8 — GitHub Actions CI + 规格补遗
- `.github/workflows/ci.yml` — 3 job 自动化（test / static / sanity）
- 修正 `docs/05-DATA.md`：`upsertCheckin/completeCheckin` 实际返回 map（不是 Checkin）

## Round 9 — 安全语料库 Phase 2（238 断言）
- 新增 47 项：REAL_NOISE（错字/同音/闲聊）、REAL_NOISE_POS（隐晦红旗）、WEAK_NEG（弱信号管理）
- 确立 **避免 alert fatigue** 设计原则（弱信号故意不报警）
- 正则硬化：过敏变体、低血糖口语化、脱水新句式、胰腺炎延迟背部疼痛

## Round 10 — 模拟器危险场景（61 项）
- 8 项危险场景断言：dose_overdue / fast_loss / streak once 语义 / +100 天长期运行 / 未完成 onboarding
- 暴露 2 个真问题（数据方向语义、visible 默认 max=2 屏蔽低优先级卡）

## Round 11 — LLM Provider 路径测试（32 断言）
- `test/llm.test.js` — mock provider 验证完整 LLM 路径
  - T1: 合法简报写入 smh_brief
  - T2: LLM 含剂量 → guard 拦截
  - T3: 结构非法（5 种）→ 回落规则
  - T4: llmCountToday 上限（1-3 调 LLM，4-5 回落）
  - T5: 红旗/dose_change/buy_source 不进 LLM
  - T6: LLM 含剂量 → guard 替换 + 就诊摘要按钮
  - T7: 网络超时 → 离线标记回落规则

## Round 12 — 一键运行工具
- `tools/run-all.js` — 汇总所有质量门输出表格
- 支持单独运行 + 一键运行两种模式

## Round 13 — Storage 契约测试（24 断言）
- `test/storage-contract.test.js` — 锁住 `upsertCheckin/completeCheckin/addDose/saveMed` 返回值契约
- 防止未来 agent 改 `update()` 返回值造成静默 bug
- exportAll 用 `***` 替换 apiKey 验证

## Round 14 — CI 切换 + 当前状态
- CI YAML 切换到 `node tools/run-all.js`（单步即可）
- 质量门扩到 **10 道**：8 测试套件 + 集成校验 + 端到端模拟器
- 总断言数：**765+**（403 单元 + 7 集成 + 61 端到端 + 238 安全 + 32 LLM + 24 契约）

## Round 15 — Round 3 评审回归（45 项）
- 把 Claude Code 评审发现的 1 blocker + 9 majors + 5 minors **显式化**为回归测试
- 未来 agent 改回滚任一修复立即报警
- 发现 npm test 偶发卡顿 5-16 分钟；CI 改用 `node tools/run-all.js` 直接调用

## Round 16 — WXML 标签平衡校验
- `tools/wxml-check.js`：字符级 parser，正确处理属性内 `>`、`{{ }}` 表达式、注释
- 18 个 .wxml 全部通过

## Round 17 — 页面 wxml/js 引用一致性
- `tools/page-contract.js`：扫描所有页面，验证 wxml 的 `bindtap`/`bindinput` 等 handler 名在 js 中已声明
- 12 个页面全部通过
- 调试中发现正则陷阱：用 `{` `}` 作锚点会被中文 + 嵌套对象搞乱，改用 `\n` 锚点解决

## Round 18 — clearAll 重入路径（+7 项）
- 模拟器新增 G7 / G8：模拟"用了一段时间后清空数据 → 重新 onboarding → buildContext 正常"
- 端到端断言：61 → 68

## Round 19 — SOS 急症状态机（66 项）
- 锁定产品安全设计：**emergency 旗 → 仅拨打 120**（避免延误）；**urgent 旗 → 跳转 SOS 页**（让用户自查）
- 调试中暴露 emergency/urgent actions 分型原则

## Round 20 — 语料库品牌混淆 + 隐式意图（+14 项）
- "今天多吃一针" / "一次打半瓶" → dose_guard 之前漏报，硬化正则拦截

## Round 21-23 — Dose 状态机（34 项）
- 间隔检查 / 加日历 / prescribed→active 状态机 / 剂量变化 / 停药
- 接入 run-all → 15 道闸门

## Round 24 — 60 天用户旅程演示器
- `tools/demo-runner.js`：人类可读 narrative + 5 项不变量验证
- 调试中暴露 history 缺失 start 事件的真实 bug

## Round 25 — 发布就绪报告
- `RELEASE.md`（6KB）：汇总 25 轮交付、自动化质量门、人工检查清单
- 量化指标：108 文件 / 900+ 断言 / 4.7s 运行 / 0 npm 依赖
- 内测 → 正式上线的 10 步 checklist

## Round 26 — 多 agent 联网核查 + 全量 code review + 修复
- 4 个 agent 并行：医学知识联网核查（A2）/ utils+services（A1）/ tests+tools（A3）/ pages+UI（A4）
- 报告归档 `docs/review/`（4 份）
- **Lead 逐条实测复核，剔除误报**：A4「dose.js 间隔取到未来的针」（代码有 `< timeMs` 过滤）、
  A4「me.js week===0 误判」（computeStage 最小为 1）、A2「司美漏打窗口写反」（实测与 Wegovy 标签逐字一致）
  均为**假阳性**，未改
- 医学参数按 FDA 处方信息修正（Lead 独立联网复核，非直接采信 agent）：
  - 替尔泊肽 `tmaxH: 30 → 24`（Zepbound/Mounjaro PI：median 24h，8–72h）
  - 度拉糖肽 `halfLifeH: 108 → 120`（Trulicity PI：t½ ≈ 5 天）
  - 司美 `missedRule` 补官方单位「5 天（120 小时）」「2 天（48 小时）」
  - `docs/05-DATA.md §4.1/§4.6` 参数表与向量表同步，并注 FDA 出处
- 安全修复（实测漏报 → 已修 + 回归断言）：
  - **mental 红旗漏报**（`活着没意义`/`活不下去`/`活得没意思`/`活够了` 等变体）— 安全红线
  - **dehydration 红旗漏报**（`喝水就吐`/`尿不出来`/`尿很少`/`尿不出`）
  - **thyroid 红旗漏报**（`甲状腺肿块`/`甲状腺肿`/`甲状腺包块`）
  - **parseCheckin 多位数丢失**（`10个鸡蛋` 曾完全丢失），`cnNum` 扩展支持十/百
  - **`cardioMin: NaN`**（`走路半分钟`）— NaN 会污染 7 日均值与达标判定，现已保证永不 NaN
- 页面修复：
  - `chat.js` 发送状态在 catch 处理器抛错时会永久卡死 → 改为 `.then(finish, finish)` 保证复位
  - `dose.wxml` picker 的 `end` 绑成可变 `dateValue`，选过历史日期后补录被锁死 → 新增固定 `dateMax`
- CI 修复：
  - **`ci.yml` 的 `if: always run` 是非法 GitHub Actions 表达式**（应为 `always()`）→ 已修
  - `tools/demo-runner.js` 从「已交付未串接」接入闸门（Round 24 曾靠它捕获真实 bug）
  - 新增 `test/kb-contract.test.js`：17 张知识卡结构 + 钉死 id 清单 + 全仓 `article?id=` 交叉引用
  - 闸门 15 → **17 道**，run-all / RELEASE / RUNBOOK / README / ci.yml 计数统一
- **Claude Code 独立复核本轮医学改动**，发现 + 我已修：
  - **P0**：物理急症（胰腺炎 / 低血糖 / 脱水）吞掉 mental 红旗 → `screenRedFlags` 改为追加 mental 的 12356 + 文案
  - **P1**：mental 正则 `活(着|得|的)?` 可选量词导致「干活没劲」等误报 → 改为必选 + 补 `轻生/寻死/一了百了/跳楼/割腕/不想醒来` 等漏报
  - **P1**：thyroid 加 `颈部肿块/疙瘩/包` 等变体；「嗓子哑」加持久限定避免感冒误报
  - **P1**：Wegovy 漏打规则补「连续漏打 2 针先联系医生」
- README 按 github-readme-pro skill 重写（hero + badges + TOC + 全章节结构），中文优先

---

## 最终状态

- 17 道自动化闸门 · 900+ 断言 · 4.9s 一键
- 6 用户文档 + 4 规格文档 + 4 份 code review 报告
- 12 页面 + 5 组件 + 8 utils
- 6 工具（check / simulator / run-all / demo-runner / wxml-check / page-contract）
- 0 npm 依赖

可立即：**内测（10 用户内）**
需补充：**真机走查 + 医生审核 + 合规改造 + 隐私政策** → 正式上线