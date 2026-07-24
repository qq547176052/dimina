// page/tabBar/component/index/utils/helpers.js
// 简介: 列表过滤与颜色生成等纯函数, 被各 mixin 共用; 颜色与宿主 Utils.generateColorFromName 保持一致
// 履历:
//   2026-07-24 从 index.js 抽出, 按功能拆分多文件
function filterList(list, keywords) {
  const filtered = !keywords ? list : list.filter((it) => it.name.indexOf(keywords) !== -1)
  return filtered.map((it) => ({ ...it, translateX: 0 }))
}

// 由名称生成稳定颜色(与宿主 Utils.generateColorFromName 一致)
function colorFromName(name) {
  if (!name) return '#2196F3'
  let hash = 0
  for (let i = 0; i < name.length; i++) {
    hash = ((hash << 5) - hash) + name.charCodeAt(i)
    hash |= 0
  }
  const hue = Math.abs(hash % 360)
  const saturation = 0.7 + (Math.abs(hash % 3000) / 10000)
  const value = 0.8 + (Math.abs(hash % 2000) / 10000)
  return hsvToHex(hue, saturation, value)
}

function hsvToHex(h, s, v) {
  const i = Math.floor(h / 60) % 6
  const f = h / 60 - Math.floor(h / 60)
  const p = v * (1 - s)
  const q = v * (1 - f * s)
  const t = v * (1 - (1 - f) * s)
  const r = [v, q, p, p, t, v][i]
  const g = [t, v, v, q, p, p][i]
  const b = [p, p, t, v, v, q][i]
  const toHex = (x) => {
    const hex = Math.round(x * 255).toString(16)
    return hex.length === 1 ? '0' + hex : hex
  }
  return '#' + toHex(r) + toHex(g) + toHex(b)
}

module.exports = { filterList, colorFromName, hsvToHex }
