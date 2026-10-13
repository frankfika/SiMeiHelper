/**
 * date.js — 本地时区日期工具（纯函数，禁止调用 wx.*）
 * 规范：存储一律毫秒时间戳；"哪一天"一律用 'YYYY-MM-DD' 本地日期字符串。
 */

function pad2(n) {
  return n < 10 ? '0' + n : '' + n;
}

/** 毫秒时间戳 → 本地日期 'YYYY-MM-DD' */
function dateKey(ms) {
  const d = new Date(ms);
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
}

/** 'YYYY-MM-DD' → 当天 00:00 本地时间的毫秒时间戳 */
function parseKey(key) {
  const [y, m, d] = String(key).split('-').map(Number);
  return new Date(y, m - 1, d, 0, 0, 0, 0).getTime();
}

/** 日期字符串加 n 天（n 可为负） */
function addDays(key, n) {
  const ms = parseKey(key) + n * 86400000;
  return dateKey(ms);
}

/** b − a，整数天（按日历日差，不受时分秒影响） */
function daysBetween(aKey, bKey) {
  return Math.round((parseKey(bKey) - parseKey(aKey)) / 86400000);
}

/** 0..6 → '周日'…'周六' */
function weekdayCn(n) {
  return ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][n];
}

/**
 * 友好时间：
 *   同一天 → '今天 21:30'；昨天 → '昨天 21:30'；
 *   今年其他 → '10月3日'；跨年 → '2025年12月3日'
 * （"昨天"是否带时刻是文档未覆盖的补充判断：带，信息更有用。）
 */
function friendly(ms, now) {
  const d = new Date(ms);
  const n = new Date(now);
  const sameDay = dateKey(ms) === dateKey(now);
  const sameDayYesterday = dateKey(ms) === dateKey(now - 86400000);
  const hm = pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  if (sameDay) return '今天 ' + hm;
  if (sameDayYesterday) return '昨天 ' + hm;
  if (d.getFullYear() === n.getFullYear()) return (d.getMonth() + 1) + '月' + d.getDate() + '日';
  return d.getFullYear() + '年' + (d.getMonth() + 1) + '月' + d.getDate() + '日';
}

module.exports = { dateKey, parseKey, addDays, daysBetween, weekdayCn, friendly };
