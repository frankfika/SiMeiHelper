#!/usr/bin/env node
/**
 * tools/run-all.js — 一键运行所有质量门（本地 + CI 用）
 *
 * 共 17 道闸门：
 *   1. test/*.js — 12 个测试套件
 *   2. tools/wxml-check.js — WXML 平衡校验
 *   3. tools/page-contract.js — 页面 wxml/js 引用一致性
 *   4. tools/check.js — 集成校验
 *   5. tools/simulator.js — 端到端用户会话
 *   6. tools/demo-runner.js — 60 天用户旅程 narrative + 5 项不变量
 *
 * 任何失败即退出非 0；输出表格。
 */

const { execFileSync } = require('child_process')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
const results = []
const summary = []

function run(label, cmd, args, opts) {
  const start = Date.now()
  let status = '✓'
  let output = ''
  let timedOut = false
  try {
    output = execFileSync(cmd, args, {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: opts && opts.timeout ? opts.timeout : 60000,
      killSignal: 'SIGKILL',
      maxBuffer: 8 * 1024 * 1024,
    }).toString().trim()
  } catch (e) {
    status = '✗'
    output = ((e.stdout || '') + (e.stderr || '')).toString().trim()
    if (e.signal === 'SIGKILL' || /ETIMEDOUT/.test(String(e))) {
      timedOut = true
      status = '✗ (TIMEOUT)'
    }
  }
  const ms = Date.now() - start
  results.push({ label, status, ms, output })
  summary.push({ label, status, ms })
  return status === '✓'
}

function summarize() {
  const passed = summary.filter((r) => r.status === '✓').length
  const failed = summary.filter((r) => r.status === '✗').length
  console.log('\n=====================================')
  console.log('SiMeiHelper 质量门 — 一键检查')
  console.log('=====================================')
  console.log('| 闸门 | 状态 | 耗时 |')
  console.log('|---|---|---|')
  for (const r of summary) {
    console.log('| ' + r.label + ' | ' + r.status + ' | ' + (r.ms + 'ms').padEnd(8) + ' |')
  }
  console.log('')
  console.log(passed + '/' + summary.length + ' 通过')
  if (failed > 0) {
    console.log('❌ ' + failed + ' 项失败')
    console.log('\n=== 失败详情 ===')
    for (const r of results.filter((x) => x.status === '✗')) {
      console.log('\n--- ' + r.label + ' ---')
      console.log(r.output.split('\n').slice(-15).join('\n'))
    }
    return 1
  }
  console.log('✅ 全部通过')
  return 0
}

// ============================================================================
// 1. 单元测试套件
// ============================================================================
console.log('\n→ 运行 12 个测试套件 + WXML + 页面引用...')
run('corpus.test.js',     'node', ['test/corpus.test.js'])
run('insight.test.js',    'node', ['test/insight.test.js'])
run('integration.test.js','node', ['test/integration.test.js'])
run('llm.test.js',        'node', ['test/llm.test.js'], { timeout: 30000 })
run('pk.test.js',         'node', ['test/pk.test.js'])
run('plan.test.js',       'node', ['test/plan.test.js'])
run('rules.test.js',      'node', ['test/rules.test.js'])
run('storage-contract.test.js', 'node', ['test/storage-contract.test.js'])
run('regression.test.js', 'node', ['test/regression.test.js'])
run('sos.test.js',         'node', ['test/sos.test.js'])
run('dose-flow.test.js',   'node', ['test/dose-flow.test.js'])
run('kb-contract.test.js', 'node', ['test/kb-contract.test.js'])

// WXML 平衡 / 自闭合校验
run('wxml-check.js (WXML 平衡)', 'node', ['tools/wxml-check.js'], { timeout: 30000 })

// 页面 wxml/js 引用一致性
run('page-contract.js (页面引用)', 'node', ['tools/page-contract.js'], { timeout: 30000 })

// ============================================================================
// 2. 集成校验
// ============================================================================
console.log('\n→ 运行集成校验...')
run('check.js (集成校验)', 'node', ['tools/check.js'])

// ============================================================================
// 3. 端到端用户会话模拟
// ============================================================================
console.log('\n→ 运行端到端用户会话模拟...')
run('simulator.js (端到端)', 'node', ['tools/simulator.js'])

// ============================================================================
// 4. 60 天用户旅程演示 + 数据不变量
//    Round 24 曾靠它捕获「med.history 缺 start 事件」的真实 bug，
//    但一直没接进闸门（已交付未串接 = CI 漏检）。此处在 CI 中固化。
// ============================================================================
console.log('\n→ 运行 60 天用户旅程演示...')
run('demo-runner.js (60 天旅程)', 'node', ['tools/demo-runner.js', '--fast'])

// ============================================================================
// 退出
// ============================================================================
process.exit(summarize())