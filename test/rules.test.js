// test/rules.test.js — 在 Node 中运行: node test/rules.test.js
const assert = require('assert');
const rules = require('../utils/rules.js');

// ---------------------------------------------------------------------------
// 1. §6.1 红旗守卫
// ---------------------------------------------------------------------------
const redFlagCases = [
  ['肚子疼得厉害还疼到后背', 'pancreatitis', 'emergency'],
  ['喝水都吐', 'dehydration', 'emergency'],
  ['心慌手抖出冷汗', 'hypoglycemia', 'emergency'],
  ['眼睛发黄', 'gallbladder', 'urgent'],
  ['嘴唇肿了喘不上气', 'allergy', 'emergency'],
  ['有点恶心', 'none', 'none'],
  ['今天便秘', 'none', 'none'],
  ['最近不想活了', 'mental', 'emergency'],
];
for (const [text, id, level] of redFlagCases) {
  const r = rules.screenRedFlags(text);
  assert.equal(r.level, level, `红旗 level: ${text}`);
  if (id === 'none') assert.ok(!r.id, `${text} 不应命中`);
  else assert.equal(r.id, id, `红旗 id: ${text}`);
}
// emergency 有拨打 120，urgent 跳 sos，mental 双热线
assert.deepEqual(rules.screenRedFlags('喝水都吐').actions, [{ label: '拨打 120', kind: 'call', payload: '120' }]);
assert.deepEqual(rules.screenRedFlags('眼睛发黄').actions, [{ label: '查看就医提醒', kind: 'navigate', payload: '/pages/sos/sos' }]);
const mental = rules.screenRedFlags('想死');
assert.ok(mental.actions.some((a) => a.payload === '12356'), 'mental 含 12356');
assert.ok(mental.reply.includes('12356'), 'mental 文案含热线');

// ---------------------------------------------------------------------------
// 2. §6.2 剂量守卫
// ---------------------------------------------------------------------------
assert.equal(rules.guardOutput('你可以加到1mg试试').ok, false);
assert.equal(rules.guardOutput('建议你打 2.5mg').ok, false);
assert.equal(rules.guardOutput('你可以自己停药').ok, false);
assert.equal(rules.guardOutput('每周打两针效果更好').ok, false, '每周两针');
assert.equal(rules.guardOutput('网上买便宜药').ok, false, '购药渠道');
assert.equal(rules.guardOutput('多吃蛋白质，每份约 20g').ok, true);
assert.equal(rules.guardOutput('说明书起始剂量通常是 0.25mg，具体以医生为准').ok, true);
const g = rules.guardOutput('你可以加到5mg');
assert.ok(g.text.includes('处方医生'), '守卫替换文案提到医生');
assert.ok(g.text.includes('就诊摘要'), '守卫替换文案提到摘要');

// ---------------------------------------------------------------------------
// 3. §6.3 意图
// ---------------------------------------------------------------------------
const intentCases = [
  ['想加量可以吗', 'dose_change'],
  ['什么时候能停药', 'stop_drug'],
  ['哪里买便宜', 'buy_source'],
  ['昨天漏打了一针', 'missed_dose'],
  ['第一针怎么打', 'injection_how'],
  ['打完恶心怎么办', 'nausea'],
  ['便秘了怎么办', 'constipation'],
  ['拉肚子两天了', 'diarrhea'],
  ['司美脸能预防吗', 'simei_face'],
  ['每天吃什么', 'protein'],
  ['每天要喝多少水', 'water'],
  ['要不要锻炼', 'exercise'],
  ['平台期怎么办', 'plateau'],
  ['最近掉头发', 'hair_loss'],
  ['能喝酒吗', 'alcohol'],
  ['总觉得乏力', 'fatigue'],
  ['备孕能用吗', 'pregnancy'],
  ['这药是什么原理', 'what_is'],
  ['我BMI 31适合用吗', 'fit'],
  ['你好', 'greeting'],
  ['今天天气怎么样', null],
];
for (const [text, id] of intentCases) {
  assert.equal(rules.matchIntent(text), id, `意图: ${text} → ${id}`);
}
// 关键意图的回复内容
const ctxBase = {
  name: '王姐',
  stage: { key: 'titrate', name: '递增期', week: 5 },
  med: {
    medId: 'tirzepatide', medName: '替尔泊肽', doseMg: 5, daysOnDose: 0,
    injectWeekday: 0, missedRule: '漏打 4 天内尽快补打', labelSchedule: '2.5mg 起始 4 周',
  },
  pk: { phase: 'peak', phaseLabel: '高峰期', hoursSinceDose: 50 },
  profile: { sex: 'female', age: 38, heightCm: 165, bmi: 32.5, conditions: ['t2d'] },
  targets: { proteinG: 80, proteinServings: 4, waterMl: 2700, waterCups: 11, cardioMinDaily: 30, strengthPerWeek: 2, moveText: '每周 150 分钟 + 力量 2 次' },
  nextSiteName: '腹部 右上',
  last7: { strengthCount: 1 },
  todayDate: Date.UTC(2026, 9, 5, 12),
  injectedToday: false,
};
const rDose = rules.reply('想加量到10mg行吗', ctxBase);
assert.ok(rDose.content.includes('以医生为准'), 'dose_change 回复含"以医生为准"');
assert.ok(rDose.content.includes('2.5mg 起始'), 'dose_change 回复含 labelSchedule 变量填充');
assert.ok(rDose.actions.some((a) => a.kind === 'navigate' && a.payload.includes('report')), 'dose_change 附生成就诊摘要');
const rBuy = rules.reply('有没有代购渠道', ctxBase);
assert.ok(rBuy.content.includes('正规药房'), 'buy_source 回复');
const rMissed = rules.reply('漏打了怎么办', ctxBase);
assert.ok(rMissed.content.includes('漏打 4 天'), 'missed_dose 回复含 missedRule');
assert.ok(rMissed.content.includes('不要一次打两针'), 'missed_dose 含安全句');
// fill 缺失变量 → 空串
assert.equal(rules.fill('你好{name}，{不存在}啊', { name: '王姐' }), '你好王姐，啊');
// 兜底：情绪词先共情 + 4 个 ask
const rFall = rules.reply('最近好难坚持不住了', ctxBase);
assert.ok(rFall.content.startsWith('辛苦了'), '情绪兜底先共情');
assert.equal(rFall.actions.length, 4, '兜底 4 个推荐问题');
assert.ok(rFall.actions.every((a) => a.kind === 'ask'), '兜底 actions 全为 ask');
// 红旗优先于意图
const rRF = rules.reply('我肚子疼得厉害', ctxBase);
assert.equal(rRF.type, 'safety', '红旗优先于意图');

// ---------------------------------------------------------------------------
// 4. §6.4 一句话解析
// ---------------------------------------------------------------------------
const p1 = rules.parseCheckin('今天88.5公斤，有点恶心，吃了3份蛋白，喝了6杯水', { latestWeightKg: 88.4 });
assert.equal(p1.weightKg, 88.5, 'p1 体重');
assert.deepEqual(p1.symptoms, { nausea: 1 }, 'p1 恶心轻');
assert.equal(p1.proteinServings, 3, 'p1 蛋白');
assert.equal(p1.waterCups, 6, 'p1 水');
assert.equal(p1.feel, 'ok', 'p1 感觉');

const p2 = rules.parseCheckin('177斤，走了半小时，没胃口', { latestWeightKg: 88.4 });
assert.equal(p2.weightKg, 88.5, 'p2 斤转 kg');
assert.equal(p2.cardioMin, 30, 'p2 半小时');
assert.equal(p2.appetite, 'low', 'p2 食欲');
assert.equal(p2.symptoms, undefined, 'p2 无症状');

const p3 = rules.parseCheckin('便秘很严重，喝了1500ml水', { latestWeightKg: 88.4 });
assert.deepEqual(p3.symptoms, { constipation: 2 }, 'p3 便秘重');
assert.equal(p3.waterCups, 6, 'p3 1500ml→6杯');
assert.equal(p3.feel, 'ok', 'p3 感觉');

const p4 = rules.parseCheckin('去健身房练了深蹲，今天状态不错', { latestWeightKg: 88.4 });
assert.equal(p4.strength, true, 'p4 力量');
assert.equal(p4.feel, 'good', 'p4 感觉');

const p5 = rules.parseCheckin('早上两个鸡蛋，中午鸡胸，晚上一杯牛奶，走了8000步', { latestWeightKg: 88.4 });
assert.equal(p5.proteinServings, 2.5, 'p5 蛋白 1+1+0.5');
assert.equal(p5.cardioMin, 80, 'p5 8000步→80分');

const p6 = rules.parseCheckin('今天挺好的', { latestWeightKg: 88.4 });
assert.deepEqual(p6, { feel: 'good' }, 'p6 只有 feel');

// 边界：体重超差丢弃；否定不计症状
const p7 = rules.parseCheckin('今天200公斤', { latestWeightKg: 88.4 });
assert.equal(p7.weightKg, undefined, '相差>10kg 丢弃');
const p8 = rules.parseCheckin('今天不恶心了，88公斤', { latestWeightKg: 88.4 });
assert.equal(p8.weightKg, 88, 'p8 体重');
assert.equal(p8.symptoms, undefined, 'p8 否定形式不计症状');

// ---------------------------------------------------------------------------
// 5. §6.6 dailyBrief 优先级
// ---------------------------------------------------------------------------
// 优先级 1：badDay
const b1 = rules.dailyBrief({ ...ctxBase, badDay: true });
assert.ok(b1.headline.includes('照顾好自己'), 'badDay headline');
assert.deepEqual(b1.tasks.map((t) => t.key), ['rest', 'protein', 'rest'], 'badDay tasks');
// 优先级 4：打针日（daysToNextDose<=0）
const b4 = rules.dailyBrief({ ...ctxBase, pk: { ...ctxBase.pk, daysToNextDose: 0 } });
assert.ok(b4.headline.includes('打针日'), '打针日 headline');
assert.deepEqual(b4.tasks.map((t) => t.key), ['dose', 'protein', 'water'], '打针日 tasks');
assert.ok(b4.tasks[0].text.includes('腹部 右上'), '打针日任务含推荐部位');
// 优先级 6：peak
const b6 = rules.dailyBrief(ctxBase);
assert.ok(b6.headline.includes('第 3 天'), 'peak dayN=2+1（hoursSinceDose=50）');
assert.ok(b6.headline.includes('蛋白'), 'peak headline');
// explore 分支
const b2 = rules.dailyBrief({ ...ctxBase, stage: { key: 'explore', name: '观望期', week: null } });
assert.ok(b2.headline.includes('王姐'), 'explore headline 含昵称');
assert.deepEqual(b2.tasks.map((t) => t.key), ['protein', 'move', 'weigh'], 'explore tasks');
// 默认分支（steady 非打针日）
const b9 = rules.dailyBrief({ ...ctxBase, pk: { ...ctxBase.pk, phase: 'steady', phaseLabel: '平稳期', hoursSinceDose: 100, daysToNextDose: 3 } });
assert.ok(b9.headline.includes('递增期第 5 周'), '默认 headline');
assert.ok(b9.headline.includes('做得挺好'), '默认 headline 尾');

// ---------------------------------------------------------------------------
// 6. checkinFeedback 六级
// ---------------------------------------------------------------------------
const T = { proteinServings: 4, waterCups: 11, cardioMinDaily: 30 };
assert.ok(rules.checkinFeedback({ feel: 'bad' }, T).includes('辛苦了'), 'f1 难受日');
assert.ok(rules.checkinFeedback({ proteinServings: 4, waterCups: 11, cardioMin: 30 }, T).includes('全达标'), 'f2 全达标');
assert.ok(rules.checkinFeedback({ proteinServings: 3.5, waterCups: 2, cardioMin: 0 }, T).includes('加个鸡蛋'), 'f3 蛋白差1份内');
assert.ok(rules.checkinFeedback({ proteinServings: 2, waterCups: 5, cardioMin: 0 }, T).includes('睡前'), 'f4 水太少');
assert.ok(rules.checkinFeedback({ proteinServings: 1, waterCups: 8, cardioMin: 10, strength: true }, T).includes('力量'), 'f5 力量');
assert.ok(rules.checkinFeedback({ proteinServings: 1, waterCups: 8, cardioMin: 10 }, T).includes('记下了'), 'f6 兜底');

// ---------------------------------------------------------------------------
// 7. visitQuestions / suggestedQuestions
// ---------------------------------------------------------------------------
const vq = rules.visitQuestions({
  ...ctxBase,
  med: { ...ctxBase.med, daysOnDose: 35 },
  weight: { weeklyRatePct: 1.7 },
  last7: { symptomDays: { nausea: 8 } },
});
assert.ok(vq.some((q) => q.includes('胃肠反应')), 'visitQuestions 恶心');
assert.ok(vq.some((q) => q.includes('维持还是调整')), 'visitQuestions 剂量周数');
assert.ok(vq.some((q) => q.includes('肌肉流失')), 'visitQuestions 掉太快');
assert.ok(vq.length <= 5 && vq.length >= 3, 'visitQuestions 3-5 条');
assert.ok(rules.visitQuestions(ctxBase).some((q) => q.includes('定期查')), '不足3条补通用');

assert.deepEqual(rules.suggestedQuestions({ ...ctxBase, badDay: true }), ['打完恶心怎么办？', '便秘怎么办？', '什么情况要去医院？', '吃不下东西怎么办？']);
assert.equal(rules.suggestedQuestions(ctxBase)[0], '怎么预防司美脸？', 'titrate 问题组');
assert.equal(rules.suggestedQuestions({ stage: { key: 'explore' } })[1], '我适合用吗？', 'explore 问题组');

// ---------------------------------------------------------------------------
// 8. 安全回归（Round 25 code review 修复）— 红旗漏报变体
//    这些都是实测漏报过的真实口语变体，任何一条回归都是 safety 红线。
// ---------------------------------------------------------------------------
const mentalVariants = [
  '活着没意义',
  '觉得活着没意义',
  '活不下去',
  '活得没意思',
  '活够了',
  '不想活了', // 既有覆盖，防回归
  '活着没意思', // 既有覆盖，防回归
  '我想死', // 既有覆盖，防回归
];
for (const text of mentalVariants) {
  const r = rules.screenRedFlags(text);
  assert.equal(r.level, 'emergency', `mental 变体须命中 emergency: ${text}`);
  assert.equal(r.id, 'mental', `mental 变体须命中 mental: ${text}`);
  assert.ok(r.actions.some((a) => a.payload === '12356'), `mental 变体须给 12356 热线: ${text}`);
}
// 不得误伤正常陈述
for (const text of ['今天感觉挺好', '吃嘛嘛香', '我想减肥', '恶心好多了']) {
  assert.equal(rules.screenRedFlags(text).level, 'none', `正常文本不得误报: ${text}`);
}

const dehydrationVariants = ['喝水都吐', '喝水就吐', '尿不出来', '尿不出', '尿很少', '几乎没小便'];
for (const text of dehydrationVariants) {
  const r = rules.screenRedFlags(text);
  assert.equal(r.level, 'emergency', `脱水变体须命中 emergency: ${text}`);
  assert.equal(r.id, 'dehydration', `脱水变体须命中 dehydration: ${text}`);
}

const thyroidVariants = ['甲状腺肿块', '甲状腺肿', '甲状腺包块', '脖子摸到肿块'];
for (const text of thyroidVariants) {
  const r = rules.screenRedFlags(text);
  assert.equal(r.level, 'urgent', `甲状腺变体须命中 urgent: ${text}`);
  assert.equal(r.id, 'thyroid', `甲状腺变体须命中 thyroid: ${text}`);
}
// 颈部（说明书原文措辞）+ 各种包 / 疙瘩）
for (const text of ['颈部肿块', '脖子上有个包', '脖子左边长了个疙瘩']) {
  assert.equal(rules.screenRedFlags(text).id, 'thyroid', `甲状腺变体（颈部）须命中: ${text}`);
}
// 单独「嗓子哑」（可能只是感冒）不应触发 → 现在加了「持久」限定
assert.equal(rules.screenRedFlags('嗓子哑了').level, 'none', '单次嗓子哑不得误报 thyroid');

// ---------------------------------------------------------------------------
// 8b. Claude Code Round 26 复核修复 — mental 误报 / 漏报
// ---------------------------------------------------------------------------
// P1-1：旧正则 `活(着|得|的)?没...` 的可选量词导致「干活没劲」「这活没意思」误报。
// 新正则要求「着 / 得 / 的」必选。实测以下都不能误报。
for (const text of ['干活没意思', '这活没劲', '干活没劲', '这份活没意义', '今天的活没意思']) {
  const r = rules.screenRedFlags(text);
  assert.notEqual(r.id, 'mental', `mental 不得误报（干 / 活）: ${text}`);
}
// 新增的精神危机口语变体（P1-2）
for (const text of ['活着真没意思', '活着好累', '想一了百了', '想跳楼', '割腕', '不想醒来', '没有活下去的意义']) {
  assert.equal(rules.screenRedFlags(text).id, 'mental', `mental 须命中新增变体: ${text}`);
}

// P0-1：用户同时表达身体急症 + 轻生念头时，必须同时出现 12356 按钮，不能被物理急症吞掉。
// 这三条来自 Claude Code 实测：旧代码会把 mental 跳过。
for (const [text, primaryId] of [
  ['肚子疼得厉害，不想活了', 'pancreatitis'],
  ['低血糖了，活着没意思', 'hypoglycemia'],
  ['吐了一整天不想活了', 'dehydration'],
]) {
  const r = rules.screenRedFlags(text);
  assert.equal(r.id, primaryId, `主红旗应为 ${primaryId}: ${text}`);
  assert.ok(
    r.actions.some((a) => a.payload === '12356'),
    `mental 不能被吞掉，必须有 12356 按钮: ${text}`
  );
  assert.ok(r.reply.includes('12356'), `reply 必须含 12356 文案: ${text}`);
}

// ---------------------------------------------------------------------------
// 9. 安全回归 — parseCheckin 多位数与「半」不得产生 NaN
//    NaN 一旦写进 smh_checkins 会污染 7 日均值 / 达标判定 / 趋势图，
//    且经 JSON 序列化后退化成 null，掩盖故障（曾真实发生）。
// ---------------------------------------------------------------------------
assert.equal(rules.parseCheckin('今天吃了10个鸡蛋', {}).proteinServings, 5, '10 个鸡蛋 = 5 份');
assert.equal(rules.parseCheckin('今天吃了20个鸡蛋', {}).proteinServings, 8, '20 个鸡蛋封顶 8 份');
assert.equal(rules.parseCheckin('今天吃了3个鸡蛋', {}).proteinServings, 1.5, '3 个鸡蛋 = 1.5 份（防回归）');
assert.equal(rules.parseCheckin('今天吃了二十个鸡蛋', {}).proteinServings, 8, '中文数字二十');
assert.equal(rules.parseCheckin('今天吃了两个鸡蛋', {}).proteinServings, 1, '中文数字两');

for (const text of ['今天走路半分钟', '跑了半分钟', '今天走了半小时', '今天走路30分钟', '今天走2小时']) {
  const r = rules.parseCheckin(text, {});
  assert.ok(
    r.cardioMin === undefined || (typeof r.cardioMin === 'number' && Number.isFinite(r.cardioMin)),
    `cardioMin 绝不可为 NaN: ${text} → ${r.cardioMin}`
  );
}
assert.equal(rules.parseCheckin('今天走了半小时', {}).cardioMin, 30, '半小时 = 30（规格 §6.4）');
assert.equal(rules.parseCheckin('今天走路30分钟', {}).cardioMin, 30, '30 分钟');
assert.equal(rules.parseCheckin('今天走2小时', {}).cardioMin, 120, 'N 小时 = N×60（规格 §6.4）');
assert.equal(rules.parseCheckin('今天走路半分钟', {}).cardioMin, 0.5, '半分钟按字面 = 0.5 分钟');

// 中文数字解析支持十/百（cnNum）
assert.equal(rules.parseCheckin('今天喝了两杯水', {}).waterCups, 2, '中文两杯水');
assert.equal(rules.parseCheckin('今天喝了十杯水', {}).waterCups, 10, '中文十杯水');

console.log('rules.test.js 全部通过 ✓');
