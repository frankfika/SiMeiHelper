// tools/page-contract.js — 页面 wxml/js 引用一致性校验
//
// 目的：CI 拦截 wxml 中 bindtap/bindinput/bindchange 等引用的 handler 名在 js 中找不到。
//
// 已知盲区：
//   - 动态创建的方法（bindtap 拼字符串 + dataset 派发）
//   - 父组件传入的事件（this.triggerEvent）
//   - bind:xxx 形式（bind:change="yyy"）
//
// 用法：node tools/page-contract.js

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PAGE_DIR = path.join(ROOT, 'pages');

function walkJs(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const name of fs.readdirSync(dir)) {
    const a = path.join(dir, name);
    if (fs.statSync(a).isDirectory()) {
      if (name === 'node_modules' || name === '.git') continue;
      walkJs(a, out);
    } else if (name.endsWith('.js')) out.push(a);
  }
  return out;
}

const pageJsFiles = walkJs(PAGE_DIR);
let totalIssues = 0;
let totalPages = 0;

for (const jsPath of pageJsFiles) {
  const dir = path.dirname(jsPath);
  const name = path.basename(jsPath, '.js');
  const wxmlPath = path.join(dir, name + '.wxml');
  if (!fs.existsSync(wxmlPath)) continue;
  totalPages++;

  const js = fs.readFileSync(jsPath, 'utf8');
  const wxml = fs.readFileSync(wxmlPath, 'utf8');

  // 1. 抽取 wxml 引用的 handler 名（覆盖 bind:xxx / bindxxx / catchtap 三种）
  const wxmlHandlers = new Set();
  // bind:change="yyy" / bindtap="yyy" / bindinput="yyy" / bindblur / bindconfirm / bindfocus
  for (const m of wxml.matchAll(/(?:bind(?::?)(?:tap|change|input|blur|confirm|focus)|catchtap)\s*=\s*["']([a-zA-Z_$][\w$]*)["']/g)) {
    wxmlHandlers.add(m[1]);
  }

  // 2. 抽取 js 中所有方法名
  const jsMethods = new Set();
  // a) Page({ ... }) 中声明的方法
  // b) Class method shorthand：methodName(...) { ... } 或 async methodName(...) { ... }
  // c) 对象方法简写：{ methodName(...) { ... } } 或 async methodName(...) { ... }
  // d) methodName: function() { ... }
  // 注意：使用 \n 作为方法前缀锚点；不要用 { } 锚点（与中文/JSX 嵌套大括号冲突）
  for (const m of js.matchAll(/\n\s*(?:async\s+|static\s+)*([a-zA-Z_$][\w$]*)\s*\(/g)) {
    jsMethods.add(m[1]);
  }
  // 名: function(...) 形式（属性对象方法声明）
  for (const m of js.matchAll(/["']([a-zA-Z_$][\w$]*)["']\s*:\s*(?:async\s+)?function/g)) {
    jsMethods.add(m[1]);
  }

  // 3. 检查 wxml 引用但 js 未定义
  const issues = [];
  for (const h of wxmlHandlers) {
    if (!jsMethods.has(h)) issues.push('  handler 「' + h + '」在 wxml 引用但 js 未找到');
  }
  if (issues.length) {
    console.log('✗ ' + path.relative(ROOT, jsPath) + ':');
    for (const i of issues) console.log(i);
    totalIssues += issues.length;
  }
}

console.log('\nWXML/JS 引用一致性 — 扫描 ' + totalPages + ' 个页面');
if (totalIssues === 0) {
  console.log('✅ ' + totalPages + ' 个页面 wxml/js 引用一致');
  process.exit(0);
} else {
  console.log('❌ ' + totalIssues + ' 处不一致');
  process.exit(1);
}