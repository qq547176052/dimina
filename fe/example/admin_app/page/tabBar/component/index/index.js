// page/tabBar/component/index/index.js
// 简介: 组件 Tab 首页, 展示宿主侧小程序列表, 点击经 wx.extBridge 拉起对应小程序.
// 履历:
//   2026-07-21 由空页面填充为基础组件展示页
//   2026-07-21 增加跳转 max_image 按钮
//   2026-07-21 增加带推送参数跳转按钮
//   2026-07-21 精简为仅保留标题, 移除按钮与示例数据
//   2026-07-22 改为展示宿主小程序列表(经 wx.extBridge AppList.getList), 点击经 AppList.launch 拉起
Page({
  data: {
    keywords: '',
    list: [],        // 全量列表(来自宿主)
    displayList: [], // 过滤后展示列表
  },

  onLoad() {
    const that = this
    wx.extBridge({
      module: 'AppList',
      event: 'getList',
      success: (res) => {
        const list = (res.list || []).map((it) => ({
          appId: it.appId,
          name: it.name,
          path: it.path,
          avatar: it.name ? it.name.substring(0, 1) : '?',
          color: colorFromName(it.name || ''),
        }))
        that.setData({ list, displayList: filterList(list, that.data.keywords) })
      },
      fail: (err) => {
        console.error('[index] getList fail:', err)
      },
    })
  },

  onSearchInput(e) {
    const keywords = e.detail.value || ''
    this.setData({ keywords, displayList: filterList(this.data.list, keywords) })
  },

  onTapItem(e) {
    const appId = e.currentTarget.dataset.appid
    wx.extBridge({
      module: 'AppList',
      event: 'launch',
      data: { appId },
      success: () => {},
      fail: (err) => {
        console.error('[index] launch fail:', err)
      },
    })
  },
})

// 按关键字过滤(名称包含匹配)
function filterList(list, keywords) {
  if (!keywords) return list
  return list.filter((it) => it.name.indexOf(keywords) !== -1)
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
