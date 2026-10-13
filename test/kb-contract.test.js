// test/kb-contract.test.js — 在 Node 中运行: node test/kb-contract.test.js
//
// 目的：data/kb.js 的 17 张知识卡此前只有「能不能 require」这一条语法级覆盖。
// 真实故障场景：删掉一张卡、或把某处 CTA 的 id 写错 → 用户点洞察卡/行动按钮
// 跳到 pages/article/article?id=kb_xxx 后走空态「内容走丢了」，是用户可见的产品故障。
//
// 本套件做三件事：
//   A. 卡片结构契约（必填字段 + sections 形状）
//   B. 卡 id 集合契约（唯一性 + 钉死清单，删卡/改名立即失败）
//   C. 交叉引用契约（全仓 article?id=X 必须都能在 kb.js 找到）—— 扫描源码，不依赖导出
//
// 零依赖：只用 node 内置 assert / fs / path。

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const kb = require('../data/kb.js');

// ---------------------------------------------------------------------------
// A. 卡片结构契约
// ---------------------------------------------------------------------------
assert.ok(Array.isArray(kb), 'data/kb.js 必须导出卡片数组');

const cards = kb;
assert.ok(cards.length >= 17, `知识卡至少 17 张，实际 ${cards.length}`);

const REQUIRED_PREFIX = 'kb_';

for (const card of cards) {
  assert.ok(card && typeof card === 'object', '每张卡必须是对象');
  assert.ok(typeof card.id === 'string' && card.id.length > 0, `卡缺 id: ${JSON.stringify(card).slice(0, 60)}`);
  assert.ok(typeof card.title === 'string' && card.title.length > 0, `卡 ${card.id} 缺 title`);
  assert.ok(Array.isArray(card.stages), `卡 ${card.id} 缺 stages 字段（阶段推荐依赖它）`);
  assert.ok(Array.isArray(card.sections) && card.sections.length > 0, `卡 ${card.id} 缺 sections`);

  for (const sec of card.sections) {
    assert.ok(typeof sec.h === 'string' && sec.h.length > 0, `卡 ${card.id} 的 section 缺 h`);
    assert.ok(Array.isArray(sec.p) && sec.p.length > 0, `卡 ${card.id} 的 section「${sec.h}」缺 p 段落`);
    for (const para of sec.p) {
      assert.ok(typeof para === 'string' && para.trim().length > 0, `卡 ${card.id}「${sec.h}」有空白段落`);
    }
  }

  // 卡渲染在 article 页，必须有可展示内容（防止「空卡」上线）
  const totalPara = card.sections.reduce((n, s) => n + s.p.length, 0);
  assert.ok(totalPara >= 2, `卡 ${card.id} 内容过少（仅 ${totalPara} 段），会渲染成空页`);
}

// ---------------------------------------------------------------------------
// B. 卡 id 集合契约（唯一性 + 钉死清单）
// ---------------------------------------------------------------------------
const ids = cards.map((c) => c.id);
const uniqueIds = new Set(ids);
assert.equal(uniqueIds.size, ids.length, `卡 id 必须唯一，发现重复：${ids.filter((x, i) => ids.indexOf(x) !== i).join(', ')}`);

// 钉死清单：任何一张卡被删除或改名都会让这条断言失败。
// 改这张清单需要同步确认所有 CTA 引用，属于有意的显式变更。
const PINNED_IDS = [
  'kb_what',
  'kb_fit',
  'kb_prepare',
  'kb_first_shot',
  'kb_nausea',
  'kb_gut',
  'kb_eat',
  'kb_move',
  'kb_face',
  'kb_titration',
  'kb_missed',
  'kb_plateau',
  'kb_stop',
  'kb_maintain',
  'kb_red_flags',
  'kb_special',
  'disclaimer',
];
for (const id of PINNED_IDS) {
  assert.ok(uniqueIds.has(id), `钉死的知识卡缺失或被改名: ${id}`);
}
assert.equal(ids.length, PINNED_IDS.length, `卡数量应为 ${PINNED_IDS.length}，实际 ${ids.length}（新增卡请同步 PINNED_IDS）`);

// kb_* 命名约定（disclaimer 是唯一的历史例外）
for (const id of ids) {
  if (id === 'disclaimer') {
    // 免责声明是全局入口（me / settings），不参与阶段推荐，stages 允许为空
    const card = cards.find((c) => c.id === id);
    assert.equal(card.stages.length, 0, 'disclaimer 不参与阶段推荐，stages 应为空');
    continue;
  }
  assert.ok(id.startsWith(REQUIRED_PREFIX), `卡 id 应以下划线前缀 ${REQUIRED_PREFIX} 开头: ${id}`);
  assert.ok(/^[a-z0-9_]+$/.test(id), `卡 id 只允许小写字母/数字/下划线: ${id}`);
  // 参与阶段推荐的知识卡必须声明阶段，否则「按阶段推荐」永远推不到它
  const card = cards.find((c) => c.id === id);
  assert.ok(card.stages.length > 0, `知识卡 ${id} 的 stages 不能为空（否则按阶段推荐推不到）`);
  for (const st of card.stages) {
    assert.ok(
      ['explore', 'start', 'titrate', 'plateau', 'maintain'].includes(st),
      `卡 ${id} 的 stage「${st}」不是合法阶段`
    );
  }
}

// ---------------------------------------------------------------------------
// C. 交叉引用契约
//    扫描全仓 JS 源码里的字面量 `article?id=X`，每个 X 必须能在 kb.js 找到。
//    之所以扫源码而不是 require 导出：rules.js 的 ACTIONS / insight.js 的 RULES
//    都是模块内部常量、未导出，扫描才能覆盖到真实引用点。
// ---------------------------------------------------------------------------
function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

const SCAN_DIRS = ['utils', 'pages', 'components', 'data', 'custom-tab-bar'];
const scanFiles = [];
for (const d of SCAN_DIRS) {
  const abs = path.join(ROOT, d);
  if (fs.existsSync(abs)) walk(abs, scanFiles);
}
assert.ok(scanFiles.length > 0, '交叉引用扫描未找到任何源文件（路径配置有误）');

// 排除本测试自身与测试目录，避免把断言样例当成真实引用
const RE = /article\?id=([a-z0-9_]+)/g;
const refs = [];
for (const file of scanFiles) {
  if (path.basename(file) === 'kb-contract.test.js') continue;
  const src = fs.readFileSync(file, 'utf8');
  let m;
  while ((m = RE.exec(src)) !== null) {
    refs.push({ id: m[1], file: path.relative(ROOT, file) });
  }
}

assert.ok(refs.length >= 10, `交叉引用扫描到的 article?id= 引用过少（${refs.length}），扫描可能失效`);

for (const { id, file } of refs) {
  assert.ok(uniqueIds.has(id), `交叉引用断裂：${file} 指向 article?id=${id}，但 kb.js 没有这张卡（用户会看到「内容走丢了」）`);
}

// 反向：每张卡都应至少被一个入口引用（或可被 article 页按 id 直接打开）。
// disclaimer 走 me/settings 两处入口，kb_* 走规则/洞察/清单入口。
for (const id of ids) {
  const hit = refs.some((r) => r.id === id);
  // kb_titration / kb_nausea / kb_gut 等由「知识卡列表」按 stage 推荐进入，不必然有字面量 CTA，
  // 因此这里只对已知有 CTA 的卡做强校验，其余仅记录。
  if (['kb_face', 'kb_eat', 'kb_move', 'kb_plateau', 'kb_stop', 'kb_what', 'kb_fit', 'kb_first_shot', 'disclaimer'].includes(id)) {
    assert.ok(hit, `卡 ${id} 应有明确的 article?id= 入口引用，但全仓未找到`);
  }
}

console.log(`kb-contract.test.js 全部通过 ✓（${cards.length} 张卡，${refs.length} 处交叉引用，${scanFiles.length} 个源文件）`);
