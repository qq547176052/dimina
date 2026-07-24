// page/tabBar/component/index/mixins/list.js
// 简介: 列表相关方法(获取/搜索/点击/置顶/删除/滑动态管理), 经宿主管理扩展模块(模块名=本小程序 appId)通信
// 履历:
//   2026-07-24 从 index.js 抽出, 按功能拆分多文件
const { filterList, colorFromName } = require('../utils/helpers.js')

module.exports = {
  // 从宿主获取小程序列表(宿主会屏蔽本会话已删除项), 作为列表唯一数据源
  _fetchList() {
    const that = this
    wx.extBridge({
      module: this._myAppId,
      event: '获取列表',
      data: { appId: this._myAppId },
      success: (res) => {
        const list = (res.list || []).map((it) => ({
          appId: it.appId,
          name: it.name,
          path: it.path,
          avatar: it.name ? it.name.substring(0, 1) : '?',
          color: colorFromName(it.name || ''),
          translateX: 0,
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
      module: this._myAppId,
      event: '拉起',
      data: { appId },
      fail: (err) => {
        console.error('[index] launch fail:', err)
      },
    })
  },

  onTopItem(e) {
    const appId = e.currentTarget.dataset.appid
    const idx = this.data.list.findIndex((it) => it.appId === appId)
    if (idx > 0) {
      const item = this.data.list[idx]
      const list = [item, ...this.data.list.slice(0, idx), ...this.data.list.slice(idx + 1)]
      this.setData({ list, displayList: filterList(list, this.data.keywords) })
    }
    this._closeAllSwipes()
    wx.showToast({ title: '已置顶', icon: 'success' })
  },

  onDeleteItem(e) {
    const appId = e.currentTarget.dataset.appid
    wx.showModal({
      title: '确认删除',
      content: '确定要删除这个小程序吗?',
      confirmColor: '#FF4D4F',
      success: (res) => {
        if (res.confirm) {
          this._doDelete(appId)
        } else {
          this._closeAllSwipes()
        }
      },
    })
  },

  _doDelete(appId) {
    // 乐观更新: 立即从本地列表移除, 给出即时反馈
    const list = this.data.list.filter((it) => it.appId !== appId)
    this.setData({ list, displayList: filterList(list, this.data.keywords) })
    this._closeAllSwipes()
    wx.showToast({ title: '已删除', icon: 'success' })
    // 通知宿主真正删除小程序(内存屏蔽+清理解压目录, 不持久化), 成功后重新获取列表以同步宿主与前端
    if (typeof wx.extBridge === 'function') {
      wx.extBridge({
        module: this._myAppId,
        event: '删除',
        data: { appId },
        success: () => { this._fetchList() },
        fail: () => {},
      })
    }
  },

  _setItemTranslateX(appId, x) {
    // 仅更新被滑动那一项的 translateX, 避免 touchmove 每帧重建并序列化整个列表
    const li = this.data.list.findIndex((it) => it.appId === appId)
    const di = this.data.displayList.findIndex((it) => it.appId === appId)
    const patch = {}
    if (li >= 0) patch[`list[${li}].translateX`] = x
    if (di >= 0) patch[`displayList[${di}].translateX`] = x
    this.setData(patch)
  },

  _closeAllSwipes() {
    if (!this.data.displayList.some((it) => it.translateX < 0)) return
    this.setData({
      list: this.data.list.map((it) => ({ ...it, translateX: 0 })),
      displayList: this.data.displayList.map((it) => ({ ...it, translateX: 0 })),
    })
  },

  _closeOthers(exceptAppId) {
    const apply = (arr) => arr.map((it) =>
      (it.appId !== exceptAppId && it.translateX < 0 ? { ...it, translateX: 0 } : it)
    )
    this.setData({ list: apply(this.data.list), displayList: apply(this.data.displayList) })
  },

  // 点击列表空白(非操作按钮)区域: 若有展开项则收起
  onListTap() {
    const hasOpen = this.data.displayList.some((it) => it.translateX < 0)
    if (hasOpen) this._closeAllSwipes()
  },

  // 列表滚动时自动收起展开项
  onListScroll() {
    const hasOpen = this.data.displayList.some((it) => it.translateX < 0)
    if (hasOpen) this._closeAllSwipes()
  },
}
