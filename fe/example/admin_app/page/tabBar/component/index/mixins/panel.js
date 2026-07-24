// page/tabBar/component/index/mixins/panel.js
// 简介: 顶部下拉添加小程序面板(手势关闭)与添加表单相关方法
// 履历:
//   2026-07-24 从 index.js 抽出, 按功能拆分多文件
const PANEL_CLOSE_PX = 15  // 面板上滑收起的位移阈值(px)

const { filterList, colorFromName } = require('../utils/helpers.js')

module.exports = {
  _drag: null,

  // ===== 下拉面板: 原生 refresher 触发 + 面板自定义上滑关闭 =====
  // 列表顶部下拉由 scroll-view 原生 refresher 触发(见 bindrefresherrefresh),
  // 面板打开期间保持刷新中(列表被遮罩覆盖无感), 关闭时收起, 避免 setTimeout 竞态导致下拉失效
  onRefresherRefresh() {
    // 原生下拉刷新触发: 打开添加小程序面板
    this._setPanel(true)
  },

  // 仅面板(role=panel)使用自定义手势: 上滑收起面板
  onPullStart(e) {
    if (e.currentTarget.dataset.role !== 'panel') return
    if (!this.data.panelOpen) return
    const t = e.touches[0]
    if (!t) return
    this._drag = {
      startY: t.clientY,
      baseY: this.data.panelY,
      time: Date.now(),
      role: 'panel',
    }
    this.setData({ panelTransition: false })
  },

  onPullMove(e) {
    const d = this._drag
    if (!d) return
    const t = e.touches[0]
    const delta = t.clientY - d.startY
    const h = this.data.panelHeight
    const min = -h
    let y = d.baseY + delta
    // 越过边界时施加橡皮筋阻力, 手感更自然
    if (y > 0) y = y * 0.3
    if (y < min) y = min + (y - min) * 0.3
    const clamped = Math.max(min, Math.min(0, y))
    const opacity = (h + clamped) / h
    this.setData({ panelY: y, panelOpacity: Math.max(0, Math.min(1, opacity)) })
  },

  onPullEnd(e) {
    const d = this._drag
    if (!d) return
    const t = e.changedTouches && e.changedTouches[0]
    if (!t) return
    this._drag = null
    this.setData({ panelTransition: true })
    // 平均速度(px/ms): >0 向下, <0 向上; 用于快速甩动手势
    const v = (t.clientY - d.startY) / Math.max(1, Date.now() - d.time)
    if (v < -0.4) {
      this._setPanel(false)         // 向上快速甩 -> 关闭
    } else if (v > 0.4) {
      this._setPanel(true)          // 向下快速甩 -> 打开
    } else if (this.data.panelY > -PANEL_CLOSE_PX) {
      this._setPanel(true)          // 上滑未超过 PANEL_CLOSE_PX -> 吸附打开
    } else {
      this._setPanel(false)         // 否则 -> 吸附关闭
    }
  },

  _setPanel(open) {
    const h = this.data.panelHeight
    this.setData({
      panelTransition: true,
      panelY: open ? 0 : -h,
      panelOpacity: open ? 1 : 0,
      panelOpen: open,
      triggered: open, // 面板打开期间保持 refresher 刷新态, 关闭时收起, 防止列表卡在顶部下拉位置
    })
  },

  closePanel() {
    this._setPanel(false)
  },

  // ===== 下拉面板: 添加小程序表单 =====
  onAppIdInput(e) { this.setData({ newAppId: e.detail.value }) },
  onNameInput(e) { this.setData({ newName: e.detail.value }) },
  onPathInput(e) { this.setData({ newPath: e.detail.value }) },

  onAddMiniProgram() {
    const { newAppId, newName, newPath } = this.data
    if (!newAppId) {
      wx.showToast({ title: '请输入 appId', icon: 'none' })
      return
    }
    const name = newName || newAppId
    const item = {
      appId: newAppId,
      name,
      path: newPath || '',
      avatar: name.substring(0, 1),
      color: colorFromName(name),
      translateX: 0,
    }
    const list = [item, ...this.data.list]
    this.setData({
      list,
      displayList: filterList(list, this.data.keywords),
      newAppId: '',
      newName: '',
      newPath: '',
    })
    wx.showToast({ title: '已添加', icon: 'success' })
    this.closePanel()
  },
}
