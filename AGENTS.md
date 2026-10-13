# SiMeiHelper 协作约定（所有 Agent 必读）

本项目的分工规则（由用户指定，必须遵守）：

## 职责划分

| 角色 | 承担方 | 负责内容 |
|------|--------|----------|
| 高维度决策 | **Claude Code**（`claude --print` 委托） | 产品规划、PRD、架构决策、主代码结构设计、主视觉设计、UX 设计 |
| 具体实现 | **DS Harness**（主 agent + 并行 subagent） | 按 docs/ 规格写代码、跑测试、修 bug |
| 最终审核 | **Claude Code** | 实现完成后必须交给 Claude Code 做 code review，审核意见由 DS Harness 落实修复 |

## 硬性流程

1. **先规划后实现**：任何新模块，先有 docs/ 里的规格（由 Claude Code 产出），DS Harness 只做规格内的实现；规格外的临时决策，小问题自行决定并在 PR 说明，大问题回给 Claude Code 补文档。
2. **安全守卫不可绕过**：涉及医疗安全的守卫逻辑（红旗守卫、剂量守卫）的顺序与测试样例以 docs/05-DATA.md 为准，改动必须回 Claude Code 审核。
3. **纯函数可测**：utils/ 下模块不得调用 `wx.*`，必须能 `node test/*.test.js` 验证。
4. **多 agent 并行**：实现阶段按互不重叠的文件范围拆分给并行 subagent；写范围冲突的文件（app.json、app.wxss、components/ 公共件）由单一 owner 负责。

## 参考的开源项目（原则：不重复造轮子）

- `navidmosleminiya/glp1-pk` — Bateman 药代模型与参数（utils/pk.js 已按此实现）
- `My GLP Shot` — 注射部位轮换、医生 PDF 导出等特性参考
- `frankiegu/weight-loss-clock`、`marlonluo2018/weightapp` — 微信原生小程序工程结构参考
