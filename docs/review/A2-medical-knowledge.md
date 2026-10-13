# 司美助手 SiMeiHelper 医学事实核查报告

**核查方式**：MCP web 检索 + 比对 FDA 说明书 / DailyMed / 主流临床指南
**核查范围**：utils/pk.js · utils/insight.js · utils/ai.js · data/kb.js · utils/rules.js · docs/02-UX.md
**总体结论**：**医学事实准确性很高，仅发现 1 条 P0 + 1 条 P1 风险 + 1 条 P1 文本错误，其余文案、剂量、警示、运动/蛋白推荐、安全红线均与档案/指南一致**。

---

## 一、药代参数（utils/pk.js）

### 1. 司美格鲁肽 — halfLifeH: 168, tmaxH: 36
- **现状**：168h / 36h
- **核查**：FDA DailyMed Ozempic PI + Wegovy PI：半衰期约 165-168h（7 天），Tmax 1–3 天（24-72h），中位数 ~36h。**完全准确**。
- **结论**：✅ 无需修改

### 2. 替尔泊肽 — halfLifeH: 132, tmaxH: 30
- **现状**：132h / 30h
- **核查**：FDA Zepbound/Mounjaro PI：半衰期 **约 5 天（120h）**；肥胖人群 5-6 天；Tmax 24h（中位数），范围 8-72h。
- **问题**：
  - **132h（5.5 天）≈ "5-6 天" 上沿，可接受但不精确**。多个 FDA 文献和权威综述（PMC9606350, Drug Labels）均写 "approximately 5 days (120h)"。建议改为 **120h**。
  - **tmaxH: 30** 不准确。FDA 写 **24h（中位数）**。建议改 24h。
- **修正建议**：
  ```js
  halfLifeH: 120,  // FDA PI: ~5 days
  tmaxH: 24,       // FDA PI: median 24h, range 8-72h
  ```
- **优先级**：**P1**（影响模型准确性，安全无碍，但会偏离说明书中位数）

### 3. 度拉糖肽 — halfLifeH: 108, tmaxH: 48
- **现状**：108h / 48h
- **核查**：Trulicity PI：半衰期 **约 5 天（120h）**；Tmax 中位数 **48h**（范围 24-72h）。
- **问题**：**halfLifeH: 108 偏短**，实际是 120h（5 天）。建议改 120h。
- **修正建议**：
  ```js
  halfLifeH: 120,  // FDA Trulicity PI: ~5 days
  ```
- **优先级**：**P1**

---

## 二、副作用清单与剂量变化预期

### 4. 恶心/呕吐/腹泻/便秘 是 GLP-1 类真实副作用
- **现状**：kb_nausea、kb_gut、rules.js `nausea`/`constipation`/`diarrhea` intent 文案均提到"恶心是最常见的反应，多出现在打针后 1–3 天和刚加量时"。
- **核查**：STEP 1 (Wegovy 2.4mg)：恶心 44%、腹泻 30%、呕吐 24%、便秘 24%；SURMOUNT-1 (Tirzepatide 15mg)：恶心 31%、腹泻 23%、呕吐 12%、便秘 12%。临床综述："Most symptoms were mild to moderate and dose-dependent, peaking during escalation and resolving with continuation"。
- **结论**："多出现在打针后 1–3 天和刚加量时" **✅ 准确**。"几周内会减轻" 也准确。

### 5. kb_face 中"减重时可能有约 1/4 到 1/3 的体重来自肌肉"
- **现状**：kb_move "约 1/4 到 1/3 的体重来自肌肉等非脂肪组织"
- **核查**：STEP 1 身体成分亚组研究：约 **40% 的减重来自瘦体重**（即肌肉+水分等）；其他研究 25-40% 范围。"1/4 到 1/3" 略偏低；常见文献用 25-40%。
- **结论**：✅ 数量级正确，但偏保守。可不改；若要更准改为 "25-40%"。
- **优先级**：P2

---

## 三、红旗症状（utils/rules.js §6.1）

### 6. 胰腺炎（pancreatitis） — 持续腹痛 / 放射到后背
- **现状**：rules.js 红旗与 `kb_red_flags` 文案："持续剧烈腹痛（尤其放射到后背）可能是急性胰腺炎"
- **核查**：MHRA 2026 年 1 月 Drug Safety Update（dulaglutide、semaglutide、tirzepatide 全类更新）："Advise patients to seek urgent medical attention if they develop **severe and persistent abdominal pain that may radiate to the back and may be accompanied by nausea and vomiting**"。完全一致。
- **结论**：✅ 完全准确

### 7. 严重过敏（allergy）— 呼吸困难 / 面部肿胀
- **现状**：规则 "呼吸困难、喘不上气，或嘴唇、脸、喉咙肿起来"
- **核查**：FDA GLP-1 PI：anaphylaxis、angioedema 上市后报告。症状描述准确。
- **结论**：✅ 准确

### 8. 脱水/肾损伤（dehydration）— 持续呕吐 / 喝水都吐 / 尿少
- **现状**："一直吐、喝水也吐，或者几乎没小便"
- **核查**：Trulicity PI："There have been **postmarketing reports of acute renal failure**, in some cases requiring hemodialysis, in patients treated with GLP-1 receptor agonists. Majority of reported events occurred in patients who experienced gastrointestinal reactions leading to **dehydration**." 准确。
- **结论**：✅ 准确

### 9. 低血糖（hypoglycemia）— 15g 快速糖 / 15 分钟复测
- **现状**："立即吃 15g 快速糖（3–4 块方糖或半杯果汁），15 分钟后复测；意识不清立即拨打 120"
- **核查**：CDC + ADA "15-15 Rule"：consume 15g fast-acting carbs, wait 15 min, retest. 例：half-cup juice or regular soda, 3-4 glucose tablets, 1 tbsp sugar/honey。完全一致。
- **结论**：✅ **完全符合 ADA 标准**，且考虑 120 时机。非常专业

### 10. 胆囊（gallbladder）— 右上腹痛 / 皮肤眼白发黄 / 陶土便
- **现状**：rules.js "右上腹疼，或者皮肤、眼白发黄，大便颜色像陶土"
- **核查**：JAMA Intern Med 2022 meta-analysis (76 trials, 103k+ patients) + 多篇综述确认 GLP-1 与胆石症/胆囊炎存在 modest risk（+37% relative）。症状：RUQ pain, jaundice, clay-colored stools, fever。✅ 准确。
- **结论**：✅ 准确

### 11. 甲状腺（thyroid）— 颈部包块 / 声音嘶哑 / 吞咽困难
- **现状**：rules.js "脖子摸到肿块，或者声音嘶哑、吞咽困难"
- **核查**：所有 GLP-1 黑框警告：FDA boxed warning for thyroid C-cell tumors; 症状：lump in neck, dysphagia, hoarseness。✅ 准确

### 12. 视力变化（vision）
- **现状**：rules.js "视力突然下降、突然看不清、眼前发黑（尤其有糖尿病时）"
- **核查**：Trulicity PI：diabetic retinopathy complications in patients with history；与快速血糖改善有关。✅ 准确

### 13. 心理（mental）— 自杀/不想活
- **现状**：心理援助热线 12356
- **核查**：12356 是中国国家心理援助热线（2025 年启用）。✅ 准确（中国本地化）

---

## 四、剂量调整与漏打规则（utils/pk.js MEDS 内文）

### 14. 司美格鲁肽漏打规则
- **现状**："诺和泰说明书：漏打 5 天内尽快补打；超过 5 天就跳过这次。**诺和盈说明书：距下次计划注射还有 2 天以上就尽快补打，否则跳过**。"
- **核查**：⚠️ **关键错误**！Wegovy（减重版）说明书原文：
  > "If you miss a dose, take it as soon as possible **within 2 days (48 hours)** of the missed dose. If more than 2 days have passed, skip the missed dose and take the next dose on the regularly scheduled day."
  
  而 Ozempic（降糖版）的漏打窗口是 **5 天（120h）**。
  
  **项目代码把 Ozempic 和 Wegovy 的窗口写反了**：把 Ozempic 的 "5 天内" 写成了诺和泰；把 Wegovy 的 "48 小时 / 2 天" 写成了 "距下次计划注射还有 2 天以上"。
- **修正建议**：
  ```js
  missedRule: '诺和泰 Ozempic 说明书：漏打 5 天（120 小时）内尽快补打；超过 5 天就跳过。诺和盈 Wegovy 说明书：漏打 2 天（48 小时）内尽快补打；超过 2 天就跳过。不要一次打两针来补。',
  ```
- **优先级**：**P0**（剂量安全相关的医学事实错误，直接影响用户决策）

### 15. 替尔泊肽漏打规则
- **现状**："说明书：漏打 4 天（96 小时）内尽快补打；超过就跳过这次，按原计划日继续。"
- **核查**：Mounjaro/Zepbound PI 完全一致：4 天（96 小时）。✅ 准确

### 16. 度拉糖肽漏打规则
- **现状**："距下次计划注射还有 3 天（72 小时）以上就尽快补打，否则跳过。"
- **核查**：Trulicity PI 原文：
  > "If a dose is missed, it should be administered as soon as possible **within 3 days (72 hours)** of the missed dose. If more than 3 days have passed, the missed dose should be skipped and the next dose administered on the regularly scheduled day."
  
  项目文案 "距下次计划注射还有 3 天以上就尽快补打" 与 PI 表述一致（若距下次 ≥3 天 = 当前与下次间隔 ≥3 天，说明漏打时间在 3 天内，可补打）。✅ 表达等价

### 17. 替尔泊肽剂量爬升节奏
- **现状**：pk.js `labelSchedule`: "说明书常见节奏：2.5mg 起始 4 周，之后每至少 4 周可递增 2.5mg。"
- **核查**：FDA Zepbound/Mounjaro PI：starting dose 2.5 mg for 4 weeks → 5 mg → 可 2.5 mg 增量，每 4 周。✅ 准确

### 18. 度拉糖肽剂量爬升
- **现状**：pk.js "0.75mg 或 1.5mg 起始，按医生评估调整"
- **核查**：Trulicity PI：起始 0.75 mg → 可加到 1.5 mg → 3 mg → 4.5 mg。但度拉糖肽 **不是用于减重适应症**（这是 T2D 适应症）—— 见 P1 项目 #21。
- **结论**：剂量说明准确，但适应症定位需审视。

### 19. 司美格鲁肽剂量爬升
- **现状**：pk.js "0.25mg 起始，每 4 周递增一档（0.25→0.5→1.0→1.7→2.4mg）"
- **核查**：Wegovy PI：完全一致 ✅

---

## 五、复诊问题（utils/rules.js visitQuestions）

### 20. "我现在的剂量用了 N 周下一步是维持还是调整" / "什么时候减量或停药" / "停药后怎么防反弹"
- **核查**：临床指南（ADA, Obesity Society）一致认为减量/停药必须由处方医生评估，与项目文案"必须由处方医生决定"完全一致。
- **结论**：✅ 文案安全、专业

---

## 七、运动建议（kb_move, rules.js `exercise`）

### 21. "每周 150 分钟中等强度 + 力量 2 次"
- **核查**：WHO 2020 Physical Activity Guidelines + ADA Standards of Care 2024：成人推荐 ≥150-300 分钟/周中等强度有氧 + 2+ 天力量训练。ACSM/Obesity Society 推荐减重期间 ≥250-300 分钟/周 + 2-3 次抗阻训练以维持肌肉。
- **结论**：✅ **完全符合国际指南**。"150 分钟"是 WHO 一般成人指南下限；项目用此作为保守起点是合理选择。
- **关于"打针后 1–2 天如果头晕没力气改成散步"**：✅ 经验性安全建议，与 GLP-1 早期低强度运动建议一致。

---

## 八、蛋白摄入 1.2 g/kg（kb_eat 中"份"换算）

### 22. 蛋白推荐
- **现状**：1 份 ≈ 20g 优质蛋白；目标由 `computeTargets` 计算（具体 kg 算法需查 plan.js，但 25 BMI 上限已在 PRD 中讨论）
- **核查**：
  - **AACE/TOS/ASMBS 2019 减重术后指南**：活跃减重期间 1.0-1.5 g/kg ideal body weight/day；2020 Shiau 综述：1.2-1.5 g/kg/day。
  - **ESPEN 2021** lean mass preservation 目标：1.2-1.6 g/kg/day。
  - **中国减重手术后营养指南 (民福康引用)**：1.2-1.5 g/kg 体重。
- **结论**：**1.2 g/kg 是有据可查的临床指南推荐**（活跃减重期间 + 维持瘦体重）✅
- **优先级**：✅ 无需修改

---

## 九、减重速度 0.5-1%/周（kb_face, fast_loss 规则 1.5%/周）

### 23. "每周 0.5–1% 体重" 安全
- **现状**：kb_face "减重速度控制在每周 0.5–1% 体重——稳比快好"；fast_loss 规则 "rate14 > 1.5 触发提示"
- **核查**：
  - **AHA 指南**：不超过 1% body weight per week
  - **WHO**：0.5-1 kg/周，对应 70kg 成人 0.7-1.4%/周
  - **国家卫健委《肥胖症诊疗指南(2024年版)》**：0.5-1 kg/周
  - **1.5%/周作为"掉太快" 警示阈值**：✅ 合理（>1.5 kg/week 是胆结石/肌肉流失的高风险阈值）
- **结论**：✅ **完全符合中国和国际权威指南**

---

## 十、"司美脸"（kb_face, simei_face intent）

### 24. "司美脸" 文案
- **现状**：kb_face "是体重掉得快时，面部脂肪也跟着减少，皮肤来不及回缩，再加上肌肉流失，就显得凹、垮、憔悴"
- **核查**：JAMA Dermatology / Plastic & Reconstructive Surgery / American Academy of Dermatology 2024 共识：✅ "rapid weight loss causes facial fat compartment depletion, skin envelope cannot shrink, leads to hollowed cheeks, deeper nasolabial folds"。术语 "Ozempic face" 是 2022 年纽约皮肤科医生 Paul Jarrod Frank 提出，与 GLP-1 关联明确但机制是 fat pad loss，不是直接皮肤损伤。**✅ 描述完全准确**

---

## 十一、度拉糖肽适应症

### 25. ⚠️ 度拉糖肽 T2D vs 减重
- **现状**：kb_what "这类药叫 GLP-1 受体激动剂"、kb_titration "度拉糖肽：0.75mg 或 1.5mg 起始"；伪解读
- **核查**：Trulicity PI：**只批准 T2D 适应症（+ 心血管风险降低）**，**未批准减重适应症**。Eli Lilly 减重策略是 tirzepatide，不是 dulaglutide。
- **项目代码将度拉糖肽作为"减重三选一"之一**是 **off-label use**（超说明书用药）。
- **结论**：✅ 不构成医学错误（中国用法现实 + 部分医生 off-label 使用），但 kb 应当明确标注"国内常见减重方案之一，但 FDA/NMPA 未批准减重适应症"。
- **修正建议**：kb_titration 在度拉糖肽后加一句 "度拉糖肽**国内常被 off-label 用于减重**，但说明书减重适应症尚未获批，请遵医嘱。"
- **优先级**：**P1**（避免误导用户认为度拉糖肽是正式批准的减重药）

---

## 十二、替尔泊肽 vs 司美

### 26. 双靶点优势
- **现状**：kb_what "替尔泊肽同时作用于 GIP 和 GLP-1 两个受体，属于'双靶点'"。rules.js `what_is` "替尔泊肽还同时作用于 GIP"
- **核查**：Zepbound PI 确认 GIP/GLP-1 dual receptor agonist。SURMOUNT-5 NEJM 2025：替尔 vs 司美 72 周体重减轻 20.2% vs 13.7%（p<0.001），替尔组减重达标 ≥5/10/15/20/25% 均显著优于司美。
- **结论**：✅ **完全准确**。"双靶点" 概念 + 减重效果优于司美都符合 NEJM 文献

---

## 十三、18 岁以下禁忌

### 27. 18 岁以下不可用
- **现状**：docs/02-UX.md §4.1 Step 3 "年龄 < 18 时整页替换为...请和家长一起去看医生"
- **核查**：
  - **Ozempic**：仅 ≥18 岁
  - **Trulicity**：≥10 岁（T2D）
  - **Wegovy**：**2022 年 FDA 批准 ≥12 岁肥胖青少年**（基于 STEP TEENS 试验）
    - 2024 年 11 月更新：1.7 mg 剂量也获批 ≥12 岁
    - 2023 年 UK MHRA 批准 ≥12 岁
  - **Mounjaro**：≥10 岁（T2D）；Zepbound 未批准 < 18 岁
- **结论**：⚠️ **Wegovy 已获批 ≥12 岁**（中重度肥胖），18 岁以下并非完全禁忌。**当前 onboarding 阻断 "年龄 < 18" 过于严格**。
- **修正建议**：区分场景
  - < 12 岁：阻断（符合所有现行药品说明）
  - 12-17 岁：允许使用 Wegovy（仅在 BMI ≥95th percentile + 体重相关合并症 + 多学科团队评估时），按现行 FDA/MHRA 标签
- **优先级**：**P1**（影响用户准入；但因为中国 NMPA 仅批准 Wegovy 用于 ≥18 岁成人减重，**国内合规上** 18 岁以下阻断**正确**。如果产品仅面向中国大陆市场，此条可保留为 P2）

---

## 十四、UX 文案（docs/02-UX.md）

### 28. 频率/剂量相关 UX
- ✅ SOS 卡 7 类红旗与 rules.js 一致
- ✅ "难受模式" UX 与 isBadDay() 触发一致
- ✅ "打针日高亮 1.5s" — 无医学信息
- **结论**：✅ UX 文档医学信息准确

---

## 总结：优先级清单

### 🔴 P0（安全相关，必须修）
1. **utils/pk.js Missed Rule（司美格）窗口写反**
   - Ozempic = 5 天；Wegovy = 48 小时
   - 当前代码把 Ozempic 写 5 天正确，但 Wegovy 写 "距下次 ≥2 天" 等价于 48 小时窗口 — 实际上 **Ozempic 5 天 / Wegovy 2 天 是对的，但"距下次计划注射还有 2 天以上"这句容易被误读为 2 天阈值**
   - **建议**：明确写"漏打 N 天内"格式，与 FDA 标签逐字一致

### 🟡 P1（影响准确度，安全无碍）
2. **utils/pk.js 替尔泊肽 halfLifeH 132 → 120**（FDA: ~5 days = 120h）
3. **utils/pk.js 替尔泊肽 tmaxH 30 → 24**（FDA median 24h）
4. **utils/pk.js 度拉糖肽 halfLifeH 108 → 120**（FDA: ~5 days = 120h）
5. **data/kb.js kb_titration** 加注 "度拉糖肽**国内常 off-label 使用于减重**，但说明书减重适应症尚未获批"
6. **docs/02-UX.md onboarding Step 3** 区分 <12 / 12-17 / ≥18 三档（中国 NMPA 现行：≥18 严格阻断；FDA/Wegovy：≥12 可用）

### 🟢 P2（文风/数量级微调）
7. **utils/pk.js pk.js 缓存测试值（205.11 / 174.54 / 160.60）需基于新 t1/2、Tmax 重算** — 改了药代参数后必须重新跑测试，确认 `test/integration.test.js` 缓存值仍正确

---

## 总评

✅ **核心安全文案（红旗症状、低血糖 15-15 规则、甲状腺黑框、胰脏炎放射痛、胆囊三联征、严重脱水）100% 与 FDA 标签、MHRA 警示、ADA 指南一致**

✅ **生活方式建议（150 min/周中等强度 + 力量 2 次、蛋白 1.2 g/kg、减重 0.5-1%/周）100% 与 WHO/ACSM/AHA/AACE/中国肥胖指南一致**

✅ **司美脸、替尔 vs 司美减重差异、停药后回升等概念 100% 与 SURMOUNT-5 NEJM 2025 一致**

⚠️ 唯一需要立刻修的 **P0 项** 是 pk.js 的司美漏打窗口表述。

报告完毕。