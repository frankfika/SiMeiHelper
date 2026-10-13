// tools/wxml-check.js — WXML 标签平衡与基本语法校验
//
// 目的：CI 拦截 WXML 拼写错误（开合标签不匹配、属性值未闭合等）。
// 注意：这是轻量检查，不替代微信开发者工具的完整 WXML 编译。
//
// 用法：node tools/wxml-check.js [dir1] [dir2] ...
// 默认扫描 pages/ components/ custom-tab-bar/

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DIRS = process.argv.slice(2).length > 0
  ? process.argv.slice(2).map((p) => path.resolve(ROOT, p))
  : [path.join(ROOT, 'pages'), path.join(ROOT, 'components'), path.join(ROOT, 'custom-tab-bar')];

// WeChat WXML 自闭合标签（不需要成对的标签）
const VOID_ELEMENTS = new Set([
  'image', 'input', 'icon', 'switch', 'slider', 'progress',
  'audio', 'video', 'live-player', 'live-pusher', 'open-data', 'web-view',
  'ad', 'official-account',
]);

/**
 * 字符级扫描 WXML，识别开/合/自闭合标签，处理引号与属性。
 * 返回 { errors, stack }。
 */
function tokenize(wxml) {
  const errors = [];
  const stack = [];
  const n = wxml.length;
  let i = 0;
  let lineNo = 1;

  while (i < n) {
    const ch = wxml[i];
    if (ch === '\n') { lineNo++; i++; continue; }

    if (ch === '<') {
      // 跳过注释 <!-- ... -->
      if (wxml.slice(i, i + 4) === '<!--') {
        const end = wxml.indexOf('-->', i + 4);
        if (end === -1) {
          errors.push({ line: lineNo, msg: '未闭合的注释 <!-- ' });
          break;
        }
        // 跳过注释内部的换行
        for (let j = i; j <= end; j++) {
          if (wxml[j] === '\n') lineNo++;
        }
        i = end + 3;
        continue;
      }

      // 找标签结束 > （但要跳过引号内的 >）
      let j = i + 1;
      let inAttrQuote = null; // null | '"' | "'"
      while (j < n) {
        const c = wxml[j];
        if (inAttrQuote) {
          if (c === inAttrQuote) inAttrQuote = null;
        } else if (c === '"' || c === "'") {
          inAttrQuote = c;
        } else if (c === '>') {
          break;
        } else if (c === '\n') {
          lineNo++;
        }
        j++;
      }

      if (j >= n) {
        errors.push({ line: lineNo, msg: '标签未闭合（缺 >）' });
        break;
      }

      const inside = wxml.slice(i + 1, j).trim();
      // 自闭合（<tag />）
      const selfClose = inside.endsWith('/');
      const cleanInside = selfClose ? inside.slice(0, -1).trim() : inside;
      // 注释/处理指令 <!doctype>
      if (cleanInside.startsWith('!')) {
        i = j + 1;
        continue;
      }
      // 闭合标签 </tag>
      if (cleanInside.startsWith('/')) {
        const tagName = cleanInside.slice(1).split(/[\s]/)[0].trim();
        if (!tagName) {
          errors.push({ line: lineNo, msg: '空闭合标签 </>' });
        } else if (stack.length === 0 || stack[stack.length - 1].name !== tagName) {
          errors.push({
            line: lineNo,
            msg: '闭合标签 </' + tagName + '> 与栈顶 ' +
                 (stack.length ? '<' + stack[stack.length - 1].name + '>' : '(空)') + ' 不匹配',
          });
          // 尝试恢复：丢弃错位闭标签栈顶（让它继续找匹配）
          if (stack.length > 0) {
            stack.pop();
          }
        } else {
          stack.pop();
        }
      } else if (selfClose || VOID_ELEMENTS.has(cleanInside.split(/[\s]/)[0].toLowerCase())) {
        // 自闭合或 void 元素
        // 不入栈
      } else {
        // 起始标签
        const tagName = cleanInside.split(/[\s]/)[0];
        if (!tagName) {
          errors.push({ line: lineNo, msg: '空起始标签 <>' });
        } else {
          stack.push({ name: tagName, line: lineNo });
        }
      }
      i = j + 1;
      continue;
    }

    // 普通字符
    i++;
  }

  // 栈残留未闭合
  for (const r of stack) {
    errors.push({ line: r.line, msg: '起始标签 <' + r.name + '> 未闭合（缺 </' + r.name + '>）' });
  }
  return errors;
}

function stripExpressions(src) {
  // 剥离 {{ ... }} 表达式（避免表达式内 < > 等被误解析为标签）
  let s = src.replace(/<!--[\s\S]*?-->/g, ''); // 先剥离注释
  // {{ }} 可能跨多行，且内部可能有 { 或 }。简单做法：循环替换直到稳定
  let prev;
  do {
    prev = s;
    s = s.replace(/\{\{[\s\S]*?\}\}/g, '""');
  } while (s !== prev);
  return s;
}

function walkWxml(dir, results) {
  if (!fs.existsSync(dir)) return;
  const ents = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of ents) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      walkWxml(p, results);
    } else if (e.isFile() && e.name.endsWith('.wxml')) {
      const content = fs.readFileSync(p, 'utf8');
      const stripped = stripExpressions(content);
      const errors = tokenize(stripped);
      results.push({ path: path.relative(ROOT, p), errors, content: stripped.length });
    }
  }
}

const results = [];
for (const d of DIRS) walkWxml(d, results);

let failed = 0;
console.log('WXML 校验 — 扫描 ' + results.length + ' 个文件');
for (const r of results) {
  if (r.errors.length === 0) continue;
  failed++;
  console.log('\n✗ ' + r.path + '（' + r.content + ' 字节）：');
  for (const e of r.errors) {
    console.log('    L' + e.line + ': ' + e.msg);
  }
}

if (failed === 0) {
  console.log('\n✅ ' + results.length + ' 个 .wxml 文件标签平衡，无未闭合标签');
  process.exit(0);
} else {
  console.log('\n❌ ' + failed + ' 个文件有 WXML 错误');
  process.exit(1);
}