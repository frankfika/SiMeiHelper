/**
 * pages/sos — 身体很不舒服（docs/02-UX.md §3.10 / docs/05-DATA.md §6.1、§9）
 * 红旗清单 = 05-DATA §6.1 除 mental 外的 7 项口语版；说明文案直接取自
 * rules.RED_FLAGS 的 reply（去「⚠️」与尾部兜底句），与守卫同一来源，语义一致不弱化。
 * 任一「有」→ 顶部 bubble-safety 急症卡（拨打 120 / 看就诊摘要）；
 * 全部「没有」→ 常见反应缓解卡：按今日 checkin.symptoms 取 kb_nausea / kb_gut 条目。
 */
const storage = require('../../utils/storage.js')
const rules = require('../../utils/rules.js')
const date = require('../../utils/date.js')

let kb = null
try { kb = require('../../data/kb.js') } catch (e) { kb = null }

const KEYS = storage.KEYS

// 7 条红旗：文案为 02-UX §3.10 原句；id 对应 rules.RED_FLAGS（不含 mental）
const FLAGS = [
  { id: 'pancreatitis', text: '肚子剧烈疼痛，或者疼到后背' },
  { id: 'dehydration', text: '吐得停不下来 / 喝水都吐 / 尿很少' },
  { id: 'hypoglycemia', text: '心慌、手抖、出冷汗（尤其在用降糖药）' },
  { id: 'allergy', text: '呼吸困难，或者脸、嘴唇、喉咙肿' },
  { id: 'gallbladder', text: '右上腹疼，或者皮肤、眼白发黄' },
  { id: 'thyroid', text: '脖子摸到肿块，或者声音嘶哑、吞咽困难' },
  { id: 'vision', text: '视力突然下降' },
].map((f) => Object.assign({}, f, { answer: '' })) // answer: '' | 'yes' | 'no'

const RED_FLAG_MAP = {}
;(rules.RED_FLAGS || []).forEach((rf) => { if (rf && rf.id) RED_FLAG_MAP[rf.id] = rf })

// rules.js 未就绪时的兜底说明（同样引导就医 / 120，不弱化）
const FALLBACK_NOTICE = '这种情况不适合等，请尽快就医；症状严重时请直接拨打 120。'

/** 今日打卡症状 key → 中文标签（05-DATA §6.4 词表） */
const SYMPTOM_CN = {
  nausea: '恶心', vomiting: '呕吐', diarrhea: '腹泻', constipation: '便秘',
  reflux: '反酸烧心', bloating: '胀气', fatigue: '乏力', dizziness: '头晕',
  injection_site: '注射处不适', hair_loss: '掉头发',
}

/** rules.RED_FLAGS.reply → 急症卡一句话说明：去「⚠️ 」前缀与尾部兜底句，其余原样拼接 */
function replyToNotice(reply) {
  const lines = String(reply || '').split('\n').filter((l) => l && l.indexOf('这种情况不适合等') !== 0)
  const text = lines.map((l) => l.replace(/^⚠️\s*/, '')).join('')
  return text || FALLBACK_NOTICE
}

/** kb 指定卡指定小标题的条目（kb.js 未就绪返回空数组） */
function kbSection(cardId, heading) {
  const card = (kb || []).find((k) => k && k.id === cardId)
  if (!card) return []
  const sec = (card.sections || []).find((s) => s && s.h === heading)
  return (sec && sec.p) ? sec.p.slice() : []
}

/** 缓解要点只取做法，最多 3 条；「何时就医」句由卡底固定一行统一给（02-UX §3.10.4） */
function reliefItems(lines) {
  return lines.filter((l) => !/就医|告诉医生|拨打/.test(l)).slice(0, 3)
}

function toLines(arr) {
  return arr.map((t, i) => ({ key: i, t }))
}

Page({
  data: {
    flags: FLAGS,
    emergency: null,   // { text } 任一「有」时置顶显示
    showRelief: false, // 全部「没有」时显示
    relief: [],        // [{ key, label, items: [{ key, t }] }]
  },

  /** 红旗行点「有 / 没有」（§3.10.2–3）：互斥更新该行，顶部急症卡 / 缓解卡随之切换 */
  onFlag(e) {
    const idx = e.currentTarget.dataset.idx
    const val = e.currentTarget.dataset.val
    if (typeof idx !== 'number' || (val !== 'yes' && val !== 'no')) return
    const row = this.data.flags[idx]
    if (!row || row.answer === val) return

    const flags = this.data.flags.slice()
    flags[idx] = Object.assign({}, row, { answer: val })
    const yes = flags.find((f) => f.answer === 'yes')
    const allNo = !yes && flags.every((f) => f.answer === 'no')

    const patch = { flags, emergency: null, showRelief: false }
    if (yes) {
      patch.emergency = { text: replyToNotice((RED_FLAG_MAP[yes.id] || {}).reply) }
    } else if (allNo) {
      patch.showRelief = true
      patch.relief = this.buildRelief()
    }
    this.setData(patch)
  },

  /** 全部「没有」→ 缓解卡内容：按今日 symptoms 取 kb_nausea / kb_gut 条目（§3.10.4） */
  buildRelief() {
    const today = storage.getCheckin(date.dateKey(Date.now()))
    const sym = (today && today.symptoms) || {}
    const groups = []
    Object.keys(sym).forEach((k) => {
      if (!sym[k]) return
      let items = []
      if (k === 'nausea' || k === 'vomiting') {
        items = reliefItems(kbSection('kb_nausea', '可以这样试'))
      } else if (k === 'constipation') {
        items = reliefItems(kbSection('kb_gut', '便秘怎么办'))
      } else if (k === 'diarrhea') {
        items = reliefItems(kbSection('kb_gut', '腹泻怎么办'))
      }
      if (!items.length) {
        // kb 未覆盖的症状（reflux / bloating / 乏力等）：给通用一句，同样不弱化
        items = ['多数会在身体适应后减轻；持续或加重，请告诉医生。']
      }
      groups.push({ key: k, label: (SYMPTOM_CN[k] || k) + '可以这样缓解', items: toLines(items) })
    })
    // 今天还没记录症状：按最常见的胃肠反应给通用要点（仍取 kb_nausea）
    if (!groups.length) {
      const items = reliefItems(kbSection('kb_nausea', '可以这样试'))
      groups.push({ key: 'general', label: '先试试这些', items: toLines(items.length ? items : ['多休息，小口慢慢喝水。']) })
    }
    return groups
  },

  /** 「拨打 120」：取消弹窗不报错 */
  call120() {
    wx.makePhoneCall({ phoneNumber: '120', fail: () => {} })
  },

  /** 看就诊摘要（给医生看） */
  goReport() {
    wx.navigateTo({ url: '/pages/report/report' })
  },

  /** 记到今天打卡：不代写 checkin，直接去记录页（§3.10.4） */
  goLog() {
    wx.switchTab({ url: '/pages/log/log' })
  },

  /** 问小美：不以「：」结尾 → chat 页会作为消息直接发送 */
  askMe() {
    getApp().globalData.pendingAsk = '我今天不太舒服'
    wx.switchTab({ url: '/pages/chat/chat' })
  },
})
