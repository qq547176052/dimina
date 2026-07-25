// page/tabBar/component/index/mixins/drawer.js
// 简介: 顶栏左侧抽屉 / 右侧加号菜单相关方法
// 履历:
//   2026-07-24 从 index.js 抽出, 按功能拆分多文件
//   2026-07-24 抽屉"退出登录"(data-key=exit)实现: 清除 token/userName、重置全局 hasLogin、reLaunch 回登录页
//   2026-07-25 退出登录改用 config.保存本地数据({ token: '' }) 清登录态(保留 user, 首页抽屉仍需展示)
const config = require('../../../../../config.js') // 后端配置(含 读取/保存本地数据)
const DRAWER_CLOSE_PX = 15  // 抽屉内左滑关闭的横向位移阈值(px, 实测自然左滑约 54px)

module.exports = {
  openDrawer() {
    this.setData({ drawerOpen: true, menuOpen: false })
  },
  closeDrawer() {
    this.setData({ drawerOpen: false })
  },
  // 抽屉面板专属手势: 在抽屉遮罩(含抽屉面板)内右滑关闭抽屉, 不依赖根容器冒泡, 更稳健
  onDrawerTouchStart(e) {
    const t = e.touches[0]
    this._drawerStartX = t ? t.clientX : 0
    this._drawerStartY = t ? t.clientY : 0
  },
  onDrawerTouchEnd(e) {
    const t = e.changedTouches && e.changedTouches[0]
    if (!t) return
    const dx = t.clientX - this._drawerStartX
    const dy = t.clientY - this._drawerStartY
    // 抽屉从左侧滑出, 关闭方向为"从右往左"推回; 横向为主且位移超阈值即关闭(不认速度, 纯位置判定)
    const leftSwipe = dx < -DRAWER_CLOSE_PX && Math.abs(dx) > Math.abs(dy) * 1.5
    if (leftSwipe) this.closeDrawer()
  },
  toggleMenu() {
    this.setData({ menuOpen: !this.data.menuOpen, drawerOpen: false })
  },
  closeMenu() {
    this.setData({ menuOpen: false })
  },
  // 阻止冒泡到遮罩(避免点抽屉/菜单内部时关闭)
  noop() {},

  onDrawerItem(e) {
    const key = e.currentTarget.dataset.key
    this.setData({ drawerOpen: false })
    if (key === 'checkUpdate') {
      this._checkUpdate() // 检查更新
      return
    }
    if (key === 'exit') {
      this._logout() // 退出登录
      return
    }
    wx.showToast({ title: `点击: ${key}`, icon: 'none' })
  },

  // 退出登录: 清除登录态(token)与全局标志, 回到登录页(reLaunch 清空页面栈, 返回键不回首页); 保留 user 供首页抽屉展示
  _logout() {
    config.保存本地数据({ token: '' }) // 整对象落盘, 仅清 token(保留 user)
    const app = getApp()
    if (app && app.globalData) app.globalData.hasLogin = false
    wx.reLaunch({ url: '/page/login/login' })
  },

  onScan() {
    this.setData({ menuOpen: false })
    // 优先调用扫码 API, 无则演示提示
    if (typeof wx.scanCode === 'function') {
      wx.scanCode({
        success: (res) => wx.showToast({ title: '扫码: ' + (res.result || ''), icon: 'none' }),
        fail: () => wx.showToast({ title: '扫码已取消', icon: 'none' }),
      })
    } else {
      wx.showToast({ title: '扫一扫', icon: 'none' })
    }
  },

  onMenuAddFriend() {
    this.setData({ menuOpen: false })
    wx.showToast({ title: '添加好友', icon: 'none' })
  },
}
