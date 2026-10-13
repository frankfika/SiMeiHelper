#!/usr/bin/env node
/**
 * tools/check.js — SiMeiHelper 集成校验（node tools/check.js）
 * 检查：JSON 合法性、app.json 页面完整性、组件引用可解析、
 *       js 语法（node --check 等价的 new Function 不适用于模块，改用子进程）、
 *       纯 utils 模块可被 node require（顶层无 wx.*）、require 路径存在、全部测试通过。
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
let fail = 0;
const bad = (msg) => { fail++; console.log('  ✗ ' + msg); };
const ok = (msg) => console.log('  ✓ ' + msg);

const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const exists = (p) => fs.existsSync(path.join(ROOT, p));

function walk(dir, ext, out = []) {
  const abs = path.join(ROOT, dir);
  if (!fs.existsSync(abs)) return out;
  for (const name of fs.readdirSync(abs)) {
    const rel = path.join(dir, name);
    const a = path.join(ROOT, rel);
    if (fs.statSync(a).isDirectory()) {
      if (name === 'node_modules' || name === '.git') continue;
      walk(rel, ext, out);
    } else if (name.endsWith(ext)) out.push(rel);
  }
  return out;
}

console.log('== 1. JSON 合法性 ==');
const jsonFiles = walk('.', '.json').filter((p) => !p.startsWith('test') && !p.startsWith('docs'));
for (const f of jsonFiles) {
  try { JSON.parse(read(f)); ok(f); } catch (e) { bad(`${f}: ${e.message}`); }
}

console.log('== 2. app.json 页面完整性 ==');
if (!exists('app.json')) {
  bad('app.json 不存在（壳 agent 未完成）');
  console.log(`\n共 ${fail} 处失败`);
  process.exit(1);
}
const appJson = JSON.parse(read('app.json'));
for (const page of appJson.pages) {
  const missing = ['js', 'json', 'wxml', 'wxss'].filter((ext) => !exists(`${page}.${ext}`));
  if (missing.length) bad(`${page} 缺少: ${missing.join(',')}`);
  else ok(page);
}
if (appJson.tabBar && appJson.tabBar.custom) {
  const missing = ['js', 'json', 'wxml', 'wxss'].filter((ext) => !exists(`custom-tab-bar/index.${ext}`));
  if (missing.length) bad(`custom-tab-bar 缺少: ${missing.join(',')}`); else ok('custom-tab-bar');
}

console.log('== 3. 组件引用可解析 ==');
const compRoots = ['ring', 'line-chart', 'chip-group', 'cup-grid', 'insight-card'];
for (const c of compRoots) {
  const missing = ['js', 'json', 'wxml', 'wxss'].filter((ext) => !exists(`components/${c}/index.${ext}`));
  if (missing.length) bad(`components/${c} 缺少: ${missing.join(',')}`); else ok(`components/${c}`);
}
for (const page of appJson.pages) {
  const pj = path.join(ROOT, `${page}.json`);
  if (!fs.existsSync(pj)) continue;
  const cfg = JSON.parse(fs.readFileSync(pj, 'utf8'));
  for (const [tag, p] of Object.entries(cfg.usingComponents || {})) {
    const missing = ['js', 'json', 'wxml', 'wxss'].filter((ext) => !exists(`${p}.${ext}`));
    if (missing.length) bad(`${page} 引用组件 ${tag}(${p}) 缺少: ${missing.join(',')}`);
    else ok(`${page} -> ${tag}`);
  }
}

console.log('== 4. js 语法 ==');
const jsFiles = walk('.', '.js').filter((p) => !p.startsWith('test/') && !p.startsWith('tools/') && !p.startsWith('docs/'));
for (const f of jsFiles) {
  try { execFileSync(process.execPath, ['--check', path.join(ROOT, f)], { stdio: 'pipe' }); ok(f); }
  catch (e) { bad(`${f}: ${String(e.stderr).slice(0, 200)}`); }
}

console.log('== 5. require 路径存在 ==');
for (const f of jsFiles) {
  const src = read(f);
  const re = /require\(\s*['"](\.[^'"]+)['"]\s*\)/g;
  let m;
  while ((m = re.exec(src))) {
    const base = path.join(path.dirname(path.join(ROOT, f)), m[1]);
    if (!fs.existsSync(base) && !fs.existsSync(base + '.js')) bad(`${f} require('${m[1]}') 不存在`);
  }
}
ok('扫描完成');

console.log('== 6. 纯 utils 模块可在 node require（顶层无 wx.*）==');
for (const m of ['date', 'plan', 'pk', 'rules', 'insight', 'theme']) {
  try { require(path.join(ROOT, 'utils', m + '.js')); ok(`utils/${m}.js`); }
  catch (e) { bad(`utils/${m}.js: ${e.message}`); }
}
try { require(path.join(ROOT, 'data', 'kb.js')); ok('data/kb.js'); }
catch (e) { bad(`data/kb.js: ${e.message}`); }

console.log('== 7. 测试 ==');
const tests = walk('test', '.js');
for (const t of tests) {
  try {
    const out = execFileSync(process.execPath, [path.join(ROOT, t)], { stdio: 'pipe', timeout: 30000 }).toString().trim();
    ok(`${t}: ${out.split('\n').pop()}`);
  } catch (e) {
    bad(`${t}: ${String(e.stdout || '')} ${String(e.stderr || '')}`.slice(0, 300));
  }
}

console.log(fail ? `\n共 ${fail} 处失败` : '\n全部检查通过 ✓');
process.exit(fail ? 1 : 0);
