/**
 * pages/me — 我的（真相源：docs/02-UX.md §3.4；docs/05-DATA.md §2.3、§2.4、§3.4、§5.2）
 *
 * 硬性约定：tab 页 —— onLoad 第一行 ensureOnboarded；onShow 设 tab selected:3 并刷新统计。
 * 档案头可改：昵称（≤10 字）、身高、目标体重（两个连续 showModal editable + 数字校验）；
 * 起始体重为 onboarding 快照，任何入口都不可改（§3.4 第 1 条）。
 */
const storage = require('../../utils/storage.js');
const plan = require('../../utils/plan.js');
const date = require('../../utils/date.js');
const pk = require('../../utils/pk.js');

const VERSION = 'v1.0.0';

function fmt1(n) {
  return (Math.round(n * 10) / 10).toFixed(1);
}
/** 正负都显示：-3.6 / +2.1 / 0.0（03-VISUAL §7 体重 1 位小数） */
function signed1(n) {
  return (n > 0 ? '+' : '') + fmt1(n);
}

Page({
  data: {
    nickname: '',
    profileMeta: '',
    weekValue: '--',
    weekUnit: '周',
    changeValue: '--',
    streakValue: '0',
    planExtra: '未设置',
    targetsExtra: '',
    version: VERSION,
  },

  onLoad() {
    if (!getApp().ensureOnboarded()) return;
  },

  onShow() {
    this.getTabBar && this.getTabBar().setData({ selected: 3 });
    this.refresh();
  },

  // -------------------------------------------------------------------------
  // 统计与右侧灰字（onShow 重算：打卡 / 改方案后切回来即更新）
  // -------------------------------------------------------------------------

  refresh() {
    const profile = storage.get(storage.KEYS.PROFILE) || {};
    const med = storage.get(storage.KEYS.MED) || {};
    const checkins = storage.get(storage.KEYS.CHECKINS) || {};
    const now = Date.now();

    const stage = plan.computeStage(med, checkins, now); // §5.1
    const latest = plan.latestWeight(checkins, profile); // 无体重时回落起始体重
    const startKg = typeof profile.startWeightKg === 'number' ? profile.startWeightKg : null;
    const changeKg = latest && startKg !== null
      ? Math.round((latest.kg - startKg) * 10) / 10
      : null;
    const targets = plan.computeTargets(profile, latest ? latest.kg : startKg, stage.key);
    const medInfo = med && med.medId ? pk.MEDS[med.medId] : null;

    // 右侧灰字：有药物 + 剂量才拼全串；打针日未设则只到 mg（补充判断：不因缺周几而整行显示「未设置」）
    let planExtra = '未设置';
    if (medInfo && typeof med.currentDoseMg === 'number') {
      planExtra = medInfo.name + ' ' + med.currentDoseMg + 'mg'
        + (typeof med.injectWeekday === 'number' ? ' · 每周' + date.weekdayCn(med.injectWeekday) : '');
    }

    this.setData({
      nickname: profile.nickname || '',
      profileMeta: this.metaText(profile),
      weekValue: stage.week ? String(stage.week) : '观望中',
      weekUnit: stage.week ? '周' : '',
      changeValue: changeKg === null ? '--' : signed1(changeKg),
      streakValue: String(plan.streak(checkins, date.dateKey(now))),
      planExtra,
      targetsExtra: '蛋白 ' + targets.proteinServings + ' 份 · 水 ' + targets.waterCups + ' 杯',
    });
  },

  /** 「{165cm · 起始 92.0kg · 目标 80.0kg}」；为空时给引导文案 */
  metaText(profile) {
    const parts = [];
    if (typeof profile.heightCm === 'number') parts.push(Math.round(profile.heightCm) + 'cm');
    if (typeof profile.startWeightKg === 'number') parts.push('起始 ' + fmt1(profile.startWeightKg) + 'kg');
    if (typeof profile.goalWeightKg === 'number') parts.push('目标 ' + fmt1(profile.goalWeightKg) + 'kg');
    return parts.length ? parts.join(' · ') : '点击补充身高与目标体重';
  },

  saveProfile(patch) {
    storage.update(storage.KEYS.PROFILE, (p) => Object.assign(
      { createdAt: Date.now() },
      p || {},
      patch,
      { updatedAt: Date.now() }
    ));
    this.refresh();
  },

  // -------------------------------------------------------------------------
  // ① 档案头编辑（wx.showModal editable；起始体重不在可改项里）
  // -------------------------------------------------------------------------

  onEditNickname() {
    const profile = storage.get(storage.KEYS.PROFILE) || {};
    wx.showModal({
      title: '怎么称呼你',
      content: profile.nickname || '',
      editable: true,
      placeholderText: '给自己起个名字（10 字以内）',
      success: (res) => {
        if (!res.confirm) return;
        const name = String(res.content || '').trim();
        if (name.length > 10) {
          wx.showToast({ title: '昵称最多 10 个字', icon: 'none' });
          return;
        }
        this.saveProfile({ nickname: name });
        wx.showToast({ title: '已保存', icon: 'none' });
      },
    });
  },

  /** 身高 → 目标体重，两个连续 modal；身高不合法时不进入第二个 */
  onEditBody() {
    const profile = storage.get(storage.KEYS.PROFILE) || {};
    wx.showModal({
      title: '身高（cm）',
      content: typeof profile.heightCm === 'number' ? String(profile.heightCm) : '',
      editable: true,
      placeholderText: '120–220',
      success: (res) => {
        if (!res.confirm) return;
        const h = Number(String(res.content || '').trim());
        if (!isFinite(h) || h < 120 || h > 220) {
          wx.showToast({ title: '身高请在 120–220cm 之间', icon: 'none' });
          return;
        }
        this.saveProfile({ heightCm: Math.round(h) });
        this.editGoal();
      },
    });
  },

  editGoal() {
    const profile = storage.get(storage.KEYS.PROFILE) || {};
    wx.showModal({
      title: '目标体重（kg）',
      content: typeof profile.goalWeightKg === 'number' ? String(profile.goalWeightKg) : '',
      editable: true,
      placeholderText: '20–300，留空表示暂不设定',
      success: (res) => {
        if (!res.confirm) return;
        const raw = String(res.content || '').trim();
        if (!raw) {
          this.saveProfile({ goalWeightKg: null }); // 清空目标 = 暂不设定
          return;
        }
        const g = Number(raw);
        if (!isFinite(g) || g < 20 || g > 300) {
          wx.showToast({ title: '目标体重请在 20–300kg 之间', icon: 'none' });
          return;
        }
        this.saveProfile({ goalWeightKg: Math.round(g * 10) / 10 });
        wx.showToast({ title: '已保存', icon: 'none' });
      },
    });
  },

  /** ③ 我的每日目标：computeTargets().basis 只读展示 */
  onShowTargets() {
    const profile = storage.get(storage.KEYS.PROFILE) || {};
    const med = storage.get(storage.KEYS.MED) || {};
    const checkins = storage.get(storage.KEYS.CHECKINS) || {};
    const stage = plan.computeStage(med, checkins, Date.now());
    const latest = plan.latestWeight(checkins, profile);
    const targets = plan.computeTargets(profile, latest ? latest.kg : profile.startWeightKg, stage.key);
    wx.showModal({
      title: '我的每日目标',
      content: targets.basis,
      showCancel: false,
      confirmText: '知道了',
    });
  },

  // -------------------------------------------------------------------------
  // 导航（§3.4 ③④）
  // -------------------------------------------------------------------------

  onGoPlan() {
    wx.navigateTo({ url: '/pages/plan/plan' });
  },
  onGoReport() {
    wx.navigateTo({ url: '/pages/report/report' });
  },
  onGoTrend() {
    wx.navigateTo({ url: '/pages/trend/trend' });
  },
  onGoSettings() {
    wx.navigateTo({ url: '/pages/settings/settings' });
  },
  onGoDisclaimer() {
    wx.navigateTo({ url: '/pages/article/article?id=disclaimer' });
  },
  onAbout() {
    wx.showToast({ title: '司美助手 ' + VERSION, icon: 'none' });
  },
});
