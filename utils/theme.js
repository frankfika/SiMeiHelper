/**
 * theme.js — 给 canvas 用的颜色 token（JS 版）
 * 值与 app.wxss 的 CSS 变量一致（03-VISUAL §3.1）。组件 attached 时读 getApp().globalData.theme。
 * 键名固定：primary, primarySoft, surface, surface2, border, text1, text2, text3,
 *           success, warning, danger, accent, onPrimary
 */

const light = {
  primary: '#1F7A6E',
  primarySoft: '#E3F1EE',
  surface: '#FFFFFF',
  surface2: '#EFECE6',
  border: '#E4E0D8',
  text1: '#1C2624',
  text2: '#5B6B70',
  text3: '#6B7A7E',
  success: '#2F855A',
  warning: '#B7791F',
  danger: '#D14343',
  accent: '#E8835A',
  onPrimary: '#FFFFFF',
};

const dark = {
  primary: '#4FBFAE',
  primarySoft: '#18332F',
  surface: '#1C2120',
  surface2: '#252B2A',
  border: '#2E3534',
  text1: '#E6EDEB',
  text2: '#A9B5B3',
  text3: '#8C9997',
  success: '#5CC28A',
  warning: '#E0A84A',
  danger: '#F07171',
  accent: '#F08C6A',
  onPrimary: '#0E1F1C',
};

/** colors(theme) → 画布用色对象；theme 取 getApp().globalData.theme */
function colors(theme) {
  return theme === 'dark' ? Object.assign({}, dark) : Object.assign({}, light);
}

module.exports = { light, dark, colors };
