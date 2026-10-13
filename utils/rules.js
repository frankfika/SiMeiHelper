/**
 * rules.js — AI 规则引擎（红旗守卫、剂量守卫、意图对话、一句话解析、简报、反馈）
 * 零依赖纯函数模块：不 require 任何模块、不调用 wx.*，一切数据通过参数传入。
 * 规范见 docs/05-DATA.md §6。安全守卫顺序：screenRedFlags → (LLM 或 rules.reply) → guardOutput。
 */

// ---------------------------------------------------------------------------
// §6.1 红旗守卫（在任何 LLM 调用之前执行）
// ---------------------------------------------------------------------------

const SAFETY_TAIL = '这种情况不适合等，也不适合在这里聊。如果症状很重，请直接拨打 120。';

const RED_FLAGS = [
  {
    id: 'pancreatitis',
    level: 'emergency',
    re: /(剧烈|剧痛|很疼|很痛|绞痛|痉挛|阵痛|疼得厉害|痛得厉害|疼得不行|痛得不行|受不了).{0,6}(肚子|腹|胃|上腹|剑突)|(肚子|腹|胃|上腹).{0,4}(部)?(剧烈|剧痛|绞痛|很疼|很痛|痉挛|阵痛|疼得厉害|痛得厉害|疼得不行|痛得不行|疼得受不了|痛得受不了|疼到后背|痛到背)|(胃|腹|肚子).{0,15}(疼到|痛到|疼得|疼)(一阵|到)?(到?后(背|背也)|背部)|(胃|腹|肚子).{0,10}后背(也|都|一直)?疼|剧烈上腹痛|剑突下剧痛/,
    reply: '⚠️ 持续剧烈腹痛（尤其放射到后背）可能是急性胰腺炎等急症。\n请停止进食，立即就医。\n' + SAFETY_TAIL,
  },
  {
    id: 'allergy',
    level: 'emergency',
    re: /呼吸(困难|急促|费力)|喘(不过来|不上气|不过气)|喉咙(肿|发紧|紧)|嘴唇肿|脸肿|全身.{0,6}(风团|起疹|皮疹|荨麻疹|痒|瘙痒)|全身痒(感觉|得厉害)/,
    reply: '⚠️ 这可能是严重过敏。\n立即拨打 120，不要等待。\n' + SAFETY_TAIL,
  },
  {
    id: 'dehydration',
    level: 'emergency',
    re: /(一直|不停|停不下来).{0,4}吐|喝(水)?(都|也|就)吐|吐了.{0,4}(一天|整天|好几次)|(没有|几乎没|很少)(小便|尿)|少尿|(小便|尿)(不出来?|很少|少)|喝不(进|下)水|不(能|会)喝水|喝啥都吐啥|吐了好?几个小时|水(都)(?!(份|杯))(吐不出来|咽不下|吞不下)|连水都吐(不出来|不了)|(胃|肚)里(水也|连水都)(吐不出来|咽不下)/,
    reply: '⚠️ 持续呕吐、喝不进水或尿很少，有脱水和肾损伤风险。\n请尽快去急诊。\n' + SAFETY_TAIL,
  },
  {
    id: 'hypoglycemia',
    level: 'emergency',
    re: /低血糖|(心(慌|发慌|怦怦跳)|手抖).{0,6}(出汗|冒汗|冷汗)|血糖[^\d]{0,4}([0-2]\.\d|3\.[0-8]|很低)|(冒冷汗|冷汗).{0,6}(心跳|心慌|心怦)|心跳(得)?(很快|很厉害).{0,6}(慌|出冷汗|发虚)/,
    reply: '⚠️ 可能是低血糖。\n立即吃 15g 快速糖（3–4 块方糖或半杯果汁），15 分钟后复测；意识不清立即拨打 120。之后联系你的医生。\n' + SAFETY_TAIL,
  },
  {
    id: 'gallbladder',
    level: 'urgent',
    re: /右上腹.{0,4}(疼|痛)|(皮肤|眼睛|眼白).{0,2}(发黄|变黄)|陶土(色)?便/,
    reply: '⚠️ 这可能与胆囊有关。\n请今天就去医院。\n' + SAFETY_TAIL,
  },
  {
    id: 'thyroid',
    level: 'urgent',
    re: /甲状腺.{0,2}(肿块|包块|肿大|硬块|肿)|(脖子|颈部|颈).{0,8}(肿块|包块|鼓包|硬块|疙瘩|包)|(声音(嘶哑|哑)|嗓子哑|声嘶|嗓音哑).{0,8}(吞咽|咽东西|吃饭)|吞咽困难|咽不下去|吃东西咽不下|嗓子哑.{0,4}(好久|一直|很久|几周|半个月|一个月)/,
    reply: '⚠️ 需要尽快检查。\n请尽快就诊，并告诉医生你在用的药。\n' + SAFETY_TAIL,
  },
  {
    id: 'vision',
    level: 'urgent',
    re: /视力(突然|下降|模糊)|突然.{0,4}(看不清|看东西模糊|眼睛.{0,2}看不清)|眼前(发黑|一阵发黑|突然发黑)|看不清|看东西模糊不清/,
    reply: '⚠️ 视力变化需要重视（尤其有糖尿病时）。\n请尽快去眼科或内分泌科。\n' + SAFETY_TAIL,
  },
  {
    id: 'mental',
    level: 'emergency',
    re: /不想活|想死|自杀|自残|轻生|寻死|一了百了|跳楼|割腕|不想醒来|活(着|得|的)(真|好|太|很|都)?没(意思|意义|劲|奔头)|活在世上没意义|活不下去|活够了|活着(好|真|太|很)累|活下去的意义|自我了断|结束.{0,3}(自己|我的).{0,2}生命|想结束.{0,2}生命/,
    reply: '⚠️ 你的感受很重要，你并不孤单。\n请拨打全国心理援助热线 12356，或马上联系身边信任的人。\n这种情况不适合等，你的安全最要紧。',
  },
];

/**
 * 红旗筛查。按顺序匹配第一条命中即作为 primary 回复（保持物理急症的处置指引优先）。
 * 但若同时命中 mental（自伤/自杀意念），**必须**追加 12356 热线按钮 + 一行心理援助补充文，
 * 不让 mental 提示被物理急症的回复吞掉。
 * 未命中返回 { level:'none' }。
 */
function screenRedFlags(text) {
  const t = String(text || '');
  let primary = null;
  for (const rf of RED_FLAGS) {
    if (rf.re.test(t)) {
      primary = rf;
      break;
    }
  }
  if (!primary) return { level: 'none' };

  const actions = [];
  if (primary.level === 'emergency') {
    actions.push({ label: '拨打 120', kind: 'call', payload: '120' });
  } else {
    actions.push({ label: '查看就医提醒', kind: 'navigate', payload: '/pages/sos/sos' });
  }

  // 安全关键（P0-1 / Claude Code review）：若主命中不是 mental，但 mental 正则也匹配，
  // 追加 12356 按钮 + 心理援助补充文。用户同时说身体症状和轻生念头时（如"低血糖 活着没意思"），
  // 不能让 mental 提示被吞掉。
  let reply = primary.reply;
  if (primary.id !== 'mental') {
    const mental = RED_FLAGS.find((rf) => rf.id === 'mental');
    if (mental && mental.re.test(t)) {
      actions.push({ label: '拨打 12356', kind: 'call', payload: '12356' });
      reply = reply + '\n——\n' + mental.reply;
    }
  } else {
    actions.push({ label: '拨打 12356', kind: 'call', payload: '12356' });
  }
  return { level: primary.level, id: primary.id, reply, actions, type: 'safety' };
}

// ---------------------------------------------------------------------------
// §6.2 剂量守卫（只作用于 LLM 输出）
// ---------------------------------------------------------------------------

const DOSE_PATTERNS = [
  // 显式剂量数字 + 单位
  /(加|减|增|升|降|调|提高|增加|降低|减少|改)(量|剂量)?(到|至|成)\s*\d+(\.\d+)?\s*(mg|毫克)/i,
  // 推荐动词 + 具体剂量数字+单位
  /(建议|可以|应该|不妨|试试|最好|直接)[^。\n]{0,12}(打|注射|用|换成)\s*\d+(\.\d+)?\s*(mg|毫克)/i,
  // 剂量动作动词（不加数字也应该拦）
  /(加量|减量)(试试|看看|一下吧|怎么?办|怎么?调整)/,
  /(改成|调成|调至|改为|调为|改成打|改为打|改成)\s*\d+(\.\d+)?\s*(mg|毫克)/,
  // 推荐动词 + 停药/加量/减量（宽字符窗口，兼容"试试"作为建议动词前的否定也算）
  /(建议|可以|应该|直接|不妨|试试|最好).{0,80}(停药|停掉|停用|减量|加量|暂停)/,
  // 每周/一周 + 多次（含/不含打/减一词）
  /(每周|一周)\s*(打|注射)?\s*(两针|2针|三针|3针|两次|2次|三次|3次)/,
  /(每周|一周)\s*(打|注射)?\s*多\s*(针|次|打)/,
  // 补打/再打一针/打两针/暂停
  /(补打|补一针|补量|多打|多吃一针|多服一针|多(吃|服|打)一(针|支|瓶)|再打一针|再打一次|停一针|暂停一周|打两针|一拳打两针)/,
  // 一次打两针类（含剂量瓶/笔的多支）— 含否定时不拦
  /(打|注射)?(两针|2针|两支|三针|3针|两瓶|2瓶)/,
  // 一次打半瓶 / 半支（部分剂量风险——剂量不稳；含否定时不拦）
  /(?!.*?(不要|别|千万|不准)).{0,8}(半瓶|半支)/,
  // 剂量 + 提高一档/调档
  /剂量.{0,2}(提|升|加|改|调).{0,2}(一档|两档|档)/,
  /(剂量|量).{0,2}(提|升|加|改|调).{0,2}\d/,
  /(提|升|降|改|调).{0,2}(剂量|量).{0,4}\d/,
  // 翻倍/加倍/减半
  /(翻一倍|翻倍|加倍|加一倍|加量一倍|剂量加一倍|剂量减半|剂量翻一倍|剂量翻一翻|剂量加一加|一倍以上|减半|成两倍)/,
  // 购药/可疑渠道
  /(来源不明|自配|复方|海淘|水光(针|素)?)/,
  /(代购|代购司美|代购替尔)/,
  /(网上|代购|淘宝|海外)[^。\n]{0,8}(买|购)/,
  // 句内"加"/"减" 作为剂量动词且后接量词
  /加.{0,2}(一针|一次|一档|两针|三针|剂量)/,
  /减.{0,2}(一针|一次|一档|两针|三针|剂量)/,
];

const GUARD_TEXT = [
  '这个问题涉及剂量或用药调整，我不能替你做决定——这一步需要你的处方医生根据你的情况来判断。',
  '我可以帮你把最近的体重、反应和打卡情况整理成就诊摘要，复诊时直接给医生看。',
].join('\n');

/** 不 ok 时 text 为安全模板 */
function guardOutput(text) {
  const t = String(text || '');
  for (const re of DOSE_PATTERNS) {
    if (re.test(t)) return { ok: false, text: GUARD_TEXT };
  }
  return { ok: true, text: t };
}

// ---------------------------------------------------------------------------
// 工具：模板填充
// ---------------------------------------------------------------------------

/** {name} 占位替换；缺失变量替换为空串 */
function fill(tpl, vars) {
  return String(tpl).replace(/\{([^{}]+)\}/g, (m, k) => (vars && vars[k] !== undefined && vars[k] !== null ? String(vars[k]) : ''));
}

function ctxVars(ctx) {
  const c = ctx || {};
  return {
    name: c.name || '你',
    proteinServings: c.targets && c.targets.proteinServings,
    proteinG: c.targets && c.targets.proteinG,
    waterCups: c.targets && c.targets.waterCups,
    waterMl: c.targets && c.targets.waterMl,
    moveText: c.targets && c.targets.moveText,
    medName: c.med && c.med.medName,
    doseMg: c.med && c.med.doseMg,
    stageName: c.stage && c.stage.name,
    phaseLabel: c.pk && c.pk.phaseLabel,
    missedRule: c.med && c.med.missedRule,
    labelSchedule: c.med && c.med.labelSchedule,
    nextSiteName: c.nextSiteName,
    bmi: c.profile && c.profile.bmi,
    weeksSinceStop: c.weeksSinceStop,
    dayN: c.pk && c.pk.hoursSinceDose !== undefined && c.pk.hoursSinceDose !== null ? Math.floor(c.pk.hoursSinceDose / 24) + 1 : undefined,
  };
}

// ---------------------------------------------------------------------------
// §6.3 意图表（规则对话）
// ---------------------------------------------------------------------------

const ACTIONS = {
  report: { label: '生成就诊摘要', kind: 'navigate', payload: '/pages/report/report' },
  kbStop: { label: '看「停药会反弹吗」', kind: 'navigate', payload: '/pages/article/article?id=kb_stop' },
  kbFirstShot: { label: '看「第一针怎么打」', kind: 'navigate', payload: '/pages/article/article?id=kb_first_shot' },
  kbFace: { label: '看「司美脸怎么防」', kind: 'navigate', payload: '/pages/article/article?id=kb_face' },
  kbEat: { label: '看「用药期间怎么吃」', kind: 'navigate', payload: '/pages/article/article?id=kb_eat' },
  kbMove: { label: '看「要不要运动」', kind: 'navigate', payload: '/pages/article/article?id=kb_move' },
  kbPlateau: { label: '看「平台期」', kind: 'navigate', payload: '/pages/article/article?id=kb_plateau' },
  kbWhat: { label: '看「这药是什么」', kind: 'navigate', payload: '/pages/article/article?id=kb_what' },
  kbFit: { label: '看「我适合用吗」', kind: 'navigate', payload: '/pages/article/article?id=kb_fit' },
  goDose: { label: '去记录注射', kind: 'navigate', payload: '/pages/dose/dose' },
  goLog: { label: '去打卡', kind: 'switchTab', payload: '/pages/log/log' },
};

const INTENTS = [
  {
    id: 'dose_change',
    re: /(加量|减量|加到|减到|调量)(?![\u4e00-\u9fa5]{0,2}(后|之后|以后))|剂量.{0,4}(多少|几)|打几(毫克|mg)|多打|少打/,
    tpl: '想调整剂量的心情我懂。不过加不加量、加多少，得由你的处方医生根据你的反应和效果来定，我不能替你决定。\n一般说明书上的节奏是：{labelSchedule}这只是参考，具体以医生为准。\n复诊前我可以帮你把最近的数据整理好👇',
    actions: [ACTIONS.report],
  },
  {
    id: 'stop_drug',
    re: /停药|不打了|能停|什么时候停|停了会/,
    tpl: '停药是个大决定，一定要和医生一起商量，最好不要自己突然停。\n研究显示，很多人停药后一年内会回升相当一部分体重（司美格鲁肽的研究里大约回升了减掉部分的 2/3）。所以停不停、怎么停，医生会看你的体重、血糖和习惯是否稳定。\n你现在就能做的：把蛋白、力量训练和每周称重变成习惯——这些是停药后守住体重最靠谱的东西。',
    actions: [ACTIONS.kbStop, ACTIONS.report],
  },
  {
    id: 'buy_source',
    re: /哪(里|儿)买|代购|便宜.{0,4}(药|针)|没(有)?处方|网上买|复方|仿制|水光|自配/,
    tpl: '这个我帮不了你，也不建议这么做：来源不明的药可能剂量不准、甚至不是真药。请通过医院处方、正规药房获取。可以挂内分泌科、减重门诊或营养科。',
    actions: [],
  },
  {
    id: 'missed_dose',
    re: /漏打|忘(了|记)打|没打|错过/,
    tpl: '别慌，漏一针很常见。\n{missedRule}\n不要一次打两针来补。不确定的话，打电话问问医生或药师最稳妥。',
    actions: [ACTIONS.goDose],
  },
  {
    id: 'injection_how',
    re: /怎么打|注射方法|打哪|部位|针头|笔怎么用|第一针/,
    tpl: '第一次打别紧张，大多数人说"比想象中轻"。\n1. 洗手，检查药液澄清、在有效期内；\n2. 选部位：腹部（离肚脐 5cm 外）、大腿前外侧或上臂，每次换个位置；\n3. 按你手上这支笔的说明书操作，注射后按住停留几秒再拔出；\n4. 用过的针头放进硬质容器。\n你下次推荐打：{nextSiteName}。',
    actions: [ACTIONS.kbFirstShot, ACTIONS.goDose],
  },
  {
    id: 'nausea',
    re: /恶心|想吐|反胃|没胃口|吃不下|饱胀|吐了/,
    tpl: '恶心是最常见的反应，多出现在打针后 1–3 天和刚加量时，通常几周内会减轻。试试：\n· 少量多餐，吃到七分饱就停\n· 先吃蛋白，少油炸、少甜\n· 小口慢慢喝水，别一次猛灌\n· 吃完别马上躺下\n如果吐到喝水都留不住、或伴随剧烈腹痛，请马上就医。',
    actions: [{ label: '记到今天打卡', kind: 'apply_checkin', payload: { symptoms: { nausea: 1 } } }],
  },
  {
    id: 'constipation',
    re: /便秘|拉不出|大便干|几天没(大便|拉)/,
    tpl: '便秘很常见，因为吃得少、喝得少、肠子也变慢了。\n· 今天把水喝到 {waterCups} 杯（约 {waterMl}ml）\n· 每餐有一拳蔬菜，加点燕麦、奇亚籽\n· 饭后走 10–15 分钟\n超过 3–4 天没排便、或肚子很胀很痛，跟医生说一声。',
    actions: [{ label: '记到今天打卡', kind: 'apply_checkin', payload: { symptoms: { constipation: 1 } } }],
  },
  {
    id: 'diarrhea',
    re: /腹泻|拉肚子|拉稀/,
    tpl: '腹泻时最重要的是补水和电解质：少量多次喝水，可以喝口服补液盐。暂时少吃油腻、辛辣和乳制品。\n如果一天拉很多次、出现头晕、尿少，或持续 2 天以上，请就医。',
    actions: [{ label: '记到今天打卡', kind: 'apply_checkin', payload: { symptoms: { diarrhea: 1 } } }],
  },
  {
    id: 'simei_face',
    re: /司美脸|脸(凹|垮|塌|松|老)|显老|面部/,
    tpl: '"司美脸"不是药直接伤脸，而是减得快时面部脂肪也跟着变少、皮肤来不及回缩。能做的：\n1. 掉得稳一点：每周 0.5–1% 体重比较理想\n2. 蛋白吃够：你每天约 {proteinServings} 份（{proteinG}g）\n3. 每周 2–3 次力量训练，保住肌肉\n4. 喝够水、睡够、做好防晒\n我会帮你盯着减重速度，太快会提醒你。',
    actions: [ACTIONS.kbFace],
  },
  {
    id: 'protein',
    re: /蛋白|吃什么|怎么吃|吃多少|饮食|食谱|餐盘/,
    tpl: '你每天的蛋白目标约 {proteinG}g，差不多 {proteinServings} 份。1 份大概是：一掌心大小的肉/鱼，或 2 个鸡蛋，或 300ml 牛奶加 1 个蛋。\n每餐顺序：先吃蛋白 → 再吃蔬菜 → 最后吃一点主食。胃口小的时候，优先保证蛋白。',
    actions: [ACTIONS.kbEat],
  },
  {
    id: 'water',
    re: /喝水|喝多少水|水分/,
    tpl: '你每天的饮水目标约 {waterMl}ml，也就是 {waterCups} 杯。用药后口渴感会变弱，最好定时小口喝，别等渴了再喝。',
    actions: [],
  },
  {
    id: 'exercise',
    re: /运动|锻炼|健身|力量|跑步|走路|步数|撸铁/,
    tpl: '要动，而且力量训练比你想的更重要——它帮你减脂不减肌肉，也让脸和身体不那么"垮"。\n你现在是{stageName}，建议：{moveText}。\n刚打完针那两天如果头晕没力气，就换成散步，别硬撑。',
    actions: [ACTIONS.kbMove],
  },
  {
    id: 'plateau',
    re: /平台期|不掉(秤|了)|体重不动|不降了|瓶颈/,
    tpl: '体重停一停很正常，身体在适应。先看三件事：蛋白够不够、力量练没练、睡得好不好。还有，别只看秤——腰围和衣服松紧也算数。\n至于要不要调整用药，请复诊时和医生聊，我可以帮你整理这几周的数据。',
    actions: [ACTIONS.kbPlateau, ACTIONS.report],
  },
  {
    id: 'hair_loss',
    re: /掉发|脱发|掉头发/,
    tpl: '减重期间掉头发多数和体重下降快、蛋白不足有关，通常是暂时的。先把蛋白吃够（{proteinG}g/天），别节食过猛。持续 3 个月以上或成片脱落，去看看皮肤科。',
    actions: [],
  },
  {
    id: 'alcohol',
    re: /喝酒|酒精|聚餐|应酬|啤酒/,
    tpl: '能少喝就少喝。酒精会让恶心、反酸更明显；如果你同时在用降糖药，还会增加低血糖风险。实在要喝：先吃点蛋白垫肚子，慢慢喝、配着水喝。',
    actions: [],
  },
  {
    id: 'fatigue',
    re: /乏力|没力气|累|头晕|犯困/,
    tpl: '吃得少了，累和头晕挺常见。检查一下：水喝够了吗？蛋白和主食是不是吃太少了？起身慢一点。\n如果头晕到站不稳、心慌出冷汗，尤其你在用降糖药，请立刻测血糖或就医。',
    actions: [{ label: '记到今天打卡', kind: 'apply_checkin', payload: { symptoms: { fatigue: 1 } } }],
  },
  {
    id: 'pregnancy',
    re: /怀孕|备孕|哺乳|避孕|喂奶/,
    tpl: '这个很重要：怀孕、备孕、哺乳期间一般不建议使用这类药，司美格鲁肽说明书建议计划怀孕前至少停药 2 个月。用替尔泊肽时口服避孕药效果可能下降，开始和每次加量后的 4 周建议加用其他避孕方式。请务必和医生确认。',
    actions: [],
  },
  {
    id: 'what_is',
    re: /是什么|原理|怎么起作用|GLP|多久(起效|见效)/,
    tpl: '{medName}属于 GLP-1 类药物（替尔泊肽还同时作用于 GIP），通过增加饱腹感、减慢胃排空、调节食欲来帮助减重。多数人头几周就能感到胃口变小，体重明显变化一般在 1–3 个月。它是"帮你更容易吃少"，不是"不用改习惯"。',
    actions: [ACTIONS.kbWhat],
  },
  {
    id: 'fit',
    re: /适合|能不能用|BMI|挂什么科|哪个科/,
    tpl: '国内减重适应症一般是：BMI ≥ 28，或 BMI ≥ 24 且合并高血压、高血糖、脂肪肝等体重相关问题。你的 BMI 约 {bmi}。适不适合要医生判断，可以挂内分泌科、减重门诊或营养科。',
    actions: [ACTIONS.kbFit],
  },
  {
    id: 'greeting',
    re: /^(你好|hi|hello|在吗|嗨)/i,
    tpl: '我在～今天感觉怎么样？想聊吃、动、副作用，还是想先打个卡？',
    actions: [ACTIONS.goLog],
  },
];

const FALLBACK = '这个问题我还没把握答好🙏 你可以换个说法，或者看看下面这些我比较擅长的：';

/** 情绪低落词（规则模式兜底时先共情） */
const EMOTION_RE = /难|放弃|崩溃|焦虑|烦/;

function matchIntent(text) {
  const t = String(text || '');
  for (const it of INTENTS) {
    if (it.re.test(t)) return it.id;
  }
  return null;
}

/** 红旗 → 意图 → 兜底 */
function reply(text, ctx) {
  const rf = screenRedFlags(text);
  if (rf.level !== 'none') {
    return { content: rf.reply, actions: rf.actions, type: 'safety', intentId: null };
  }
  const vars = ctxVars(ctx);
  const t = String(text || '');
  for (const it of INTENTS) {
    if (it.re.test(t)) {
      return { content: fill(it.tpl, vars), actions: it.actions || [], type: 'text', intentId: it.id };
    }
  }
  let content = FALLBACK;
  if (EMOTION_RE.test(t)) content = '辛苦了，愿意跟我说说是哪里最难吗？\n' + content;
  return { content, actions: suggestedQuestions(ctx).map((q) => ({ label: q, kind: 'ask', payload: q })), type: 'text', intentId: null };
}

// ---------------------------------------------------------------------------
// §6.4 一句话打卡解析 parseCheckin(text, ctx) → Partial<Checkin>
// ---------------------------------------------------------------------------

const CN_DIGIT = { 零: 0, 一: 1, 两: 2, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
const CN_UNIT = { 十: 10, 百: 100 };

/**
 * 解析阿拉伯数字或中文数字（支持 1–999：'10' / '十' / '二十' / '两' / '三十五' / '一百'）。
 * 无法识别时返回 null（调用方必须处理 null，绝不让 NaN 外泄）。
 */
function cnNum(s) {
  const str = String(s == null ? '' : s).trim();
  if (!str) return null;
  if (/^[0-9]+(\.[0-9]+)?$/.test(str)) return parseFloat(str);
  if (!/^[零一二两三四五六七八九十百]+$/.test(str)) return null;
  let total = 0;
  let section = 0;
  for (const ch of str) {
    if (CN_DIGIT[ch] !== undefined) {
      section = CN_DIGIT[ch];
    } else if (CN_UNIT[ch] !== undefined) {
      total += (section || 1) * CN_UNIT[ch];
      section = 0;
    } else {
      return null;
    }
  }
  return total + section;
}

const SYMPTOM_PATTERNS = [
  { key: 'nausea', re: /恶心|想吐|反胃/ },
  { key: 'vomiting', re: /吐了|呕吐/ },
  { key: 'diarrhea', re: /拉肚子|腹泻/ },
  { key: 'constipation', re: /便秘|拉不出/ },
  { key: 'reflux', re: /反酸|烧心/ },
  { key: 'bloating', re: /胀气|胀/ },
  { key: 'fatigue', re: /累|乏力|没力气/ },
  { key: 'dizziness', re: /头晕/ },
  { key: 'hair_loss', re: /掉头发|脱发/ },
];
const SEVERE_RE = /很|特别|非常|严重|厉害/;

function parseCheckin(text, ctx) {
  const t = String(text || '');
  const out = {};
  if (!t) return out;
  const c = ctx || {};
  const clauses = t.split(/[，。,\.；;！!？?\s]+/).filter(Boolean);

  // 体重
  const mKg = t.match(/(\d{2,3}(?:\.\d)?)\s*(kg|公斤|千克)/i);
  const mJin = t.match(/(\d{2,3}(?:\.\d)?)\s*斤/);
  let weight = null;
  if (mKg) weight = parseFloat(mKg[1]);
  else if (mJin) weight = Math.round((parseFloat(mJin[1]) / 2) * 10) / 10;
  if (weight !== null && weight >= 30 && weight <= 300) {
    if (c.latestWeightKg === undefined || c.latestWeightKg === null || Math.abs(weight - c.latestWeightKg) <= 10) {
      out.weightKg = weight;
    }
  }

  // 蛋白（份）
  const mServings = t.match(/([0-9一二两三四五六七八]+)\s*份蛋白/);
  if (mServings) {
    const n = cnNum(mServings[1]);
    if (n !== null) out.proteinServings = Math.min(8, Math.max(0, n));
  } else {
    let p = 0;
    let found = false;
    const egg = t.match(/(\d+|[一二两三四五六七八九十百]+)个(鸡)?蛋/g);
    if (egg) {
      found = true;
      for (const e of egg) {
        const n = cnNum(e.match(/(\d+|[一二两三四五六七八九十百]+)/)[1]);
        if (n !== null) p += n / 2;
      }
    }
    if (/(一|1)杯(牛)?奶/.test(t)) {
      found = true;
      p += 0.5;
    }
    const foods = t.match(/鸡胸|牛肉|鱼|虾|瘦肉|豆腐/g);
    if (foods) {
      found = true;
      p += foods.length;
    }
    if (found && p > 0) out.proteinServings = Math.min(8, Math.round(p * 2) / 2);
  }

  // 水（杯）
  const mCups = t.match(/(\d+|[一二两三四五六七八九十]+)\s*杯水/);
  const mMl = t.match(/(\d{3,4})\s*(ml|毫升)/i);
  const mL = t.match(/(\d(?:\.\d)?)\s*(升|L)/i);
  if (mCups) {
    const n = cnNum(mCups[1]);
    if (n !== null) out.waterCups = Math.min(16, n);
  } else if (mMl) {
    out.waterCups = Math.min(16, Math.round(parseInt(mMl[1], 10) / 250));
  } else if (mL) {
    out.waterCups = Math.min(16, Math.round(parseFloat(mL[1]) * 4));
  }

  // 有氧（分钟）
  const mMin = t.match(/(走|跑|骑|游|跳|爬|散步|快走|有氧)[^，。,\.]{0,6}?(\d+|半)\s*(个)?(分钟|小时)/);
  if (mMin) {
    let v = null;
    if (mMin[2] === '半') {
      // 规格 §6.4 只定义「半小时 = 30」。对「半分钟」取字面值 0.5。
      // 关键不变量：任何分支都不得产生 NaN —— NaN 写进 smh_checkins 会污染
      // 7 日均值、达标判定与趋势图（NaN 在 JSON 里还会退化成 null，掩盖故障）。
      v = mMin[4] === '小时' ? 30 : 0.5;
    } else {
      const n = cnNum(mMin[2]);
      if (n !== null) v = mMin[4] === '小时' ? n * 60 : n;
    }
    if (v !== null && Number.isFinite(v)) out.cardioMin = Math.min(300, v);
  } else {
    const mStep = t.match(/(\d{4,5})\s*步/);
    if (mStep) out.cardioMin = Math.min(300, Math.round(parseInt(mStep[1], 10) / 100));
  }

  // 力量
  if (/力量|撸铁|深蹲|哑铃|器械|弹力带|俯卧撑|健身房/.test(t)) out.strength = true;

  // 症状（子句内判断程度与否定）
  const symptoms = {};
  for (const clause of clauses) {
    for (const sp of SYMPTOM_PATTERNS) {
      const m = clause.match(sp.re);
      if (!m) continue;
      const before = clause.slice(0, m.index);
      const after = clause.slice(m.index + m[0].length);
      // 否定形式（"不恶心"/"没恶心"/"没有恶心"/"无恶心"）：同一子句内关键字前 2 字内含 不/没/无 则不计
      if (/(不|没|没有|无)$/.test(before.trim().slice(-2))) continue;
      symptoms[sp.key] = SEVERE_RE.test(before) || SEVERE_RE.test(after) ? 2 : 1;
    }
  }
  if (Object.keys(symptoms).length) out.symptoms = symptoms;

  // 感觉
  if (/舒服|不错|挺好|很好/.test(t)) out.feel = 'good';
  else if (/难受|不舒服|很差|好难/.test(t)) out.feel = 'bad';
  else if (Object.keys(symptoms).length) out.feel = 'ok';

  // 食欲
  if (/没胃口|吃不下|不饿/.test(t)) out.appetite = 'low';
  else if (/嘴馋|很饿|想吃|饿得快/.test(t)) out.appetite = 'high';

  return out;
}

// ---------------------------------------------------------------------------
// §6.6 今日简报（规则版）
// ---------------------------------------------------------------------------

function isDoseDay(ctx) {
  const c = ctx || {};
  const pk = c.pk || {};
  const med = c.med || {};
  if (pk.daysToNextDose !== undefined && pk.daysToNextDose !== null && pk.daysToNextDose <= 0) return true;
  if (med.injectWeekday !== undefined && med.injectWeekday !== null && c.todayDate !== undefined) {
    const wd = new Date(c.todayDate).getDay();
    if (wd === med.injectWeekday && !c.injectedToday) return true;
  }
  return false;
}

/**
 * 规则版简报：返回 { headline, tasks:[{key,text}], note:'' }
 * headline 按优先级取第一个命中；tasks 固定 3 条。
 * "本周力量次数"用 ctx.last7.strengthCount（AiContext 未单独提供周一起算字段）。
 */
function dailyBrief(ctx) {
  const c = ctx || {};
  const med = c.med || {};
  const pk = c.pk || {};
  const stage = c.stage || {};
  const targets = c.targets || {};
  const last7 = c.last7 || {};
  const v = ctxVars(ctx);
  const doseDay = isDoseDay(ctx);
  const phaseKey = pk.phase || null;
  const weekStrength = last7.strengthCount || 0;

  const kidneyFlag = c.profile && Array.isArray(c.profile.conditions) && c.profile.conditions.indexOf('kidney') >= 0
  const proteinText = kidneyFlag
    ? '蛋白按医生建议吃（肾病限蛋白，请先和医生确认量）'
    : fill('吃够 {proteinServings} 份蛋白（约 {proteinG}g）', v)
  const proteinTask = { key: 'protein', text: proteinText };
  const waterTask = { key: 'water', text: fill('喝够 {waterCups} 杯水', v) };
  const moveTask = { key: 'move', text: fill('走 {cardioMinDaily} 分钟', Object.assign({}, v, { cardioMinDaily: targets.cardioMinDaily })) };
  const strengthTask = { key: 'strength', text: '做一次 20 分钟力量训练' };

  let headline = null;
  let tasks = null;

  if (c.badDay) {
    headline = '今天身体不太舒服，目标都先放一放，照顾好自己最要紧。';
    tasks = [
      { key: 'rest', text: '小口喝水，每 15 分钟喝几口' },
      { key: 'protein', text: '能吃就吃一点，清淡、少量多餐' },
      { key: 'rest', text: '出现剧烈腹痛或喝水都吐，马上就医' },
    ];
  } else if (stage.key === 'explore') {
    headline = fill('{name}，先把这药了解清楚，再和医生一起决定，一点都不晚。', v);
    tasks = [proteinTask, { key: 'move', text: '每天快走 20 分钟' }, { key: 'weigh', text: '每周固定一天称体重' }];
  } else if (stage.key === 'maintain') {
    headline = fill('维持期第 {weeksSinceStop} 周，守住就是赢。今天也称一下体重吧。', v);
    tasks = [
      { key: 'weigh', text: '今天称一下体重' },
      proteinTask,
      weekStrength < (targets.strengthPerWeek || 0) ? strengthTask : moveTask,
    ];
  } else if (doseDay) {
    headline = '今天是打针日 💉 打完记得记一下，接下来两天胃口会小一些。';
    tasks = [
      { key: 'dose', text: fill('打针并记录（推荐部位：{nextSiteName}）', v) },
      proteinTask,
      waterTask,
    ];
  } else if (med.daysOnDose !== undefined && med.daysOnDose !== null && med.daysOnDose <= 7 && med.hasDoseChange) {
    headline = fill('刚换到 {doseMg}mg，这周身体可能需要重新适应，慢慢来。', v);
    tasks = [proteinTask, waterTask, weekStrength < (targets.strengthPerWeek || 0) && phaseKey !== 'peak' ? strengthTask : moveTask];
  } else if (phaseKey === 'peak') {
    headline = fill('打针后第 {dayN} 天，胃口小是正常的，先把蛋白吃够。', v);
    tasks = [proteinTask, waterTask, weekStrength < (targets.strengthPerWeek || 0) && phaseKey !== 'peak' ? strengthTask : moveTask];
  } else if (phaseKey === 'trough') {
    headline = '快到打针日了，嘴馋一点很正常，提前备好鸡蛋、酸奶。';
    tasks = [proteinTask, waterTask, weekStrength < (targets.strengthPerWeek || 0) && phaseKey !== 'peak' ? strengthTask : moveTask];
  } else if (stage.key === 'plateau') {
    headline = '体重歇一歇不代表没效果，今天把力量练上。';
    tasks = [proteinTask, waterTask, strengthTask];
  } else {
    headline = fill('{stageName}第 {week} 周，按节奏来，你做得挺好。', Object.assign({}, v, { week: stage.week }));
    tasks = [proteinTask, waterTask, weekStrength < (targets.strengthPerWeek || 0) && phaseKey !== 'peak' ? strengthTask : moveTask];
  }

  return { headline, tasks, note: '' };
}

// ---------------------------------------------------------------------------
// §6.8 打卡即时反馈
// ---------------------------------------------------------------------------

function checkinFeedback(checkin, targets, ctx) {
  const c = checkin || {};
  const t = targets || {};
  const hitProtein = typeof c.proteinServings === 'number' && t.proteinServings && c.proteinServings >= t.proteinServings;
  const hitWater = typeof c.waterCups === 'number' && t.waterCups && c.waterCups >= t.waterCups;
  const hitMove = (typeof c.cardioMin === 'number' && t.cardioMinDaily && c.cardioMin >= t.cardioMinDaily) || c.strength === true;
  const sym = c.symptoms || {};
  const bad = (ctx && ctx.badDay) || (c.feel === 'bad') || Object.keys(sym).some((k) => sym[k] === 2) || !!sym.vomiting;

  if (bad) return '今天辛苦了，好好休息。明天会好一些的 🌱';
  if (hitProtein && hitWater && hitMove) return '三项全达标！今天的你很稳 💪';
  if (
    typeof c.proteinServings === 'number' && t.proteinServings &&
    t.proteinServings - c.proteinServings > 0 && t.proteinServings - c.proteinServings <= 1
  ) {
    return fill('蛋白 {p}/{P} 份，晚饭加个鸡蛋就齐了 👍', { p: c.proteinServings, P: t.proteinServings });
  }
  if (typeof c.waterCups === 'number' && t.waterCups && c.waterCups < t.waterCups * 0.6) {
    return fill('水才 {w}/{W} 杯，睡前再喝两杯吧', { w: c.waterCups, W: t.waterCups });
  }
  if (c.strength === true) return '练了力量，肌肉在帮你守住线条 💪';
  return '记下了！坚持记录本身就很了不起。';
}

// ---------------------------------------------------------------------------
// §6.9 复诊问题
// ---------------------------------------------------------------------------

function visitQuestions(ctx) {
  const c = ctx || {};
  const out = [];
  const last7 = c.last7 || {};
  const nauseaDays = (last7.symptomDays && (last7.symptomDays.nausea || 0) + (last7.symptomDays.vomiting || 0)) || 0;
  if (nauseaDays >= 7) out.push(fill('我这几周胃肠反应比较多（{n} 天），需要调整什么吗？', { n: nauseaDays }));
  if (c.med && c.med.daysOnDose !== undefined && c.med.daysOnDose >= 28) {
    out.push(fill('我现在的剂量用了 {w} 周，下一步是维持还是调整？', { w: Math.floor(c.med.daysOnDose / 7) }));
  }
  if (c.stage && c.stage.key === 'plateau') out.push('体重这几周变化不大，接下来怎么安排？');
  if (c.weight && typeof c.weight.weeklyRatePct === 'number' && c.weight.weeklyRatePct > 1.5) {
    out.push(fill('我掉得比较快（每周约 {r}%），需要注意肌肉流失吗？', { r: c.weight.weeklyRatePct }));
  }
  if (c.profile && Array.isArray(c.profile.conditions) && (c.profile.conditions.includes('t2d') || c.profile.conditions.includes('insulin_su'))) {
    out.push('我的降糖药需要配合调整吗？');
  }
  if ((c.stage && c.stage.key === 'maintain') || (c.med && c.med.daysOnDose !== undefined && c.med.daysOnDose >= 280)) {
    out.push('我什么时候可以考虑减量或停药？停药后怎么防反弹？');
  }
  const generic = [
    '我需要定期查哪些指标（血糖、血脂、肝肾功能）？',
    '哪些情况需要我马上停药就医？',
    '我的饮食和运动安排有什么需要调整的？',
  ];
  for (const g of generic) {
    if (out.length >= 3) break;
    if (!out.includes(g)) out.push(g);
  }
  return out.slice(0, 5);
}

// ---------------------------------------------------------------------------
// §6.10 推荐问题（对话空态 / 兜底 chip）
// ---------------------------------------------------------------------------

const SUGGESTED = {
  explore: ['这药是怎么起作用的？', '我适合用吗？', '挂什么科？', '会有什么副作用？'],
  start: ['第一针怎么打？', '打完恶心怎么办？', '每天该吃多少蛋白？', '要不要运动？'],
  titrate: ['怎么预防司美脸？', '加量后又恶心了怎么办？', '力量训练怎么开始？', '便秘怎么办？'],
  plateau: ['平台期怎么办？', '体重不动还要坚持吗？', '怎么预防司美脸？', '我该练多少力量？'],
  maintain: ['停药会反弹吗？', '维持期怎么吃？', '体重回升了怎么办？', '每周要运动多久？'],
};
const SUGGESTED_BAD = ['打完恶心怎么办？', '便秘怎么办？', '什么情况要去医院？', '吃不下东西怎么办？'];

function suggestedQuestions(ctx) {
  const c = ctx || {};
  if (c.badDay) return SUGGESTED_BAD.slice();
  const key = (c.stage && c.stage.key) || 'explore';
  return (SUGGESTED[key] || SUGGESTED.explore).slice();
}

module.exports = {
  RED_FLAGS,
  screenRedFlags,
  guardOutput,
  fill,
  matchIntent,
  reply,
  parseCheckin,
  dailyBrief,
  isDoseDay,
  checkinFeedback,
  visitQuestions,
  suggestedQuestions,
  GUARD_TEXT,
};
