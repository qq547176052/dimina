// page/index/mixins/drawer.js
// 简介: 顶栏左侧抽屉 / 右侧加号菜单相关方法
// 履历:
//   2026-07-24 从 index.js 抽出, 按功能拆分多文件
//   2026-07-24 抽屉"退出登录"(data-key=exit)实现: 清除 token/userName、重置全局 hasLogin、redirectTo 回登录页
//   2026-07-25 退出登录改用 config.保存本地数据({ token: '' }) 清登录态(保留 user, 首页抽屉仍需展示)
//   2026-07-25 退出登录修正: 清空 token+用户名+密码+user(回到默认空对象), 且 await 宿主清空成功后再 redirectTo 登录页, 杜绝异步回写污染导致登录页自动登录弹回首页
//   2026-07-25 退出结果区分: 成功打日记并跳登录页; 失败打日记并弹"退出失败"提示, 不跳登录页(停留在当前页)
//   2026-07-25 onScan 改为 async/await 摊平嵌套: 识别 "cnb下载小程序=<appId>" 后由 _getMiniAppName 取友好名称(本地列表→宿主查 cnb config.json name, 空则回退 appId)再弹确认框, 用户确认后调 _downloadByScan 经宿主下载; _getMiniAppName 打印宿主返回便于排查; 其余内容仍原样提示
//   2026-07-27 退出登录跳转由 reLaunch 改为 redirectTo: 复用同一 bridge 不换桥, 规避 reLaunch 销毁全部 bridge 重建导致的换桥空窗 bug(抽屉在首页, 栈仅单页, 语义等价)
//   2026-07-27 退出回登录页保留 redirectTo 的约束: 登录页非 tabBar 页, 无法 switchTab 到达; 从 tabBar 容器 redirectTo 到非 tab 页底层走 updatePath 会 destroy+init 当前 bridge(换桥), 但退出时无在途请求竞争无回调丢失风险; 若要求登录页完全纯净重置, 可改用 reLaunch 重启小程序(整栈重建)
//   2026-07-27 login 纳入 tabBar(三页皆 tab): 回登录页的 redirectTo 改为 switchTab(redirectTo 跳 tab 页会被容器拦截 can not redirectTo a tabbar page); 登录页已是 tab, 原"非 tab 无法 switchTab"约束解除, 全程走 tab 容器复用常驻 bridge 不换桥
const config = require('../../../config.js') // 后端配置(含 读取/保存本地数据)
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

  // 退出登录: 清空 token/用户名/密码/user(回到默认空对象), 等宿主清空成功后再切登录页(避免异步回写污染/自动登录弹回);
  // 是否保存(记住账号开关, 非登录态)保持默认 true, 不影响已退出判定; 不销毁小程序(仅 switchTab 切到登录 tab, 复用常驻 bridge 不换桥)
  _logout() {
    const app = getApp()
    if (app && app.globalData) app.globalData.hasLogin = false
    // 保存本地数据: 同步清本地 + 异步清宿主, 返回 Promise; 无论宿主成败都切到登录页
    Promise.resolve(config.保存本地数据({ token: '', 用户名: '', 密码: '', user: {} }))
      .then(() => {
        console.log('[退出登录] 清空本地数据成功, 跳登录页')
        // 切换到登录页面(登录页已配为 tab, switchTab 切到登录 tab, 复用常驻 bridge 不换桥)
        wx.switchTab({ url: '/page/login/login' })

      })
      .catch((错误) => {
        console.error('[退出登录] 清空本地数据失败:', 错误 && 错误.errMsg ? 错误.errMsg : 错误)
        wx.showToast({ title: '退出失败, 请重试', icon: 'none' })
      })
  },

  async onScan() {
    this.setData({ menuOpen: false })
    // 优先调用扫码 API, 无则演示提示
    if (typeof wx.scanCode !== 'function') {
      wx.showToast({ title: '扫一扫', icon: 'none' })
      return
    }
    // 包装为 Promise: 成功回 res, 取消/失败回 null
    const res = await new Promise((resolve) => {
      wx.scanCode({ success: resolve, fail: () => resolve(null) })
    })
    if (!res) {
      wx.showToast({ title: '扫码已取消', icon: 'none' })
      return
    }
    const content = (res.result || '').trim()
    // 识别到 "cnb下载小程序=<appId>" 先取友好名称再弹确认框, 用户确认后下载; 其余按原样提示
    if (content.indexOf('cnb下载小程序=') !== 0) {
      wx.showToast({ title: '扫码: ' + content, icon: 'none' })
      return
    }
    const appId = content.slice('cnb下载小程序='.length)
    const name = await this._getMiniAppName(appId)
    wx.showModal({
      title: '下载小程序',
      content: '确认从云端下载并安装小程序?\n名称: ' + (name || appId),
      confirmText: '下载',
      cancelText: '取消',
      success: (m) => { if (m.confirm) this._downloadByScan(content) },
    })
  },

  // 解析展示名称: 优先本地列表已安装名称, 其次向宿主查 cnb config.json 的 name; 均无返回空串(调用处回退 appId)
  _getMiniAppName(appId) {
    const local = (this.data.list || []).find((it) => it.appId === appId)
    if (local && local.name) return Promise.resolve(local.name)
    if (typeof this._callAppList !== 'function') return Promise.resolve('')
    return this._callAppList('获取小程序信息', { appId })
      .then((r) => {
        const name = r && r.name ? r.name : ''
        console.log('[drawer] 获取小程序信息', appId, JSON.stringify(r))
        return name
      })
      .catch((e) => {
        console.log('[drawer] 获取小程序信息失败', appId, e && e.errMsg)
        return ''
      })
  },
}
