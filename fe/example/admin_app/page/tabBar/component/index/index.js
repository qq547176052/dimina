// page/tabBar/component/index/index.js
// 简介: 组件 Tab 首页, 展示宿主侧小程序列表, 点击经 wx.extBridge 拉起对应小程序.
// 履历:
//   2026-07-21 由空页面填充为基础组件展示页
//   2026-07-21 增加跳转 max_image 按钮
//   2026-07-21 增加带推送参数跳转按钮
//   2026-07-21 精简为仅保留标题, 移除按钮与示例数据
//   2026-07-22 改为展示宿主小程序列表(经 wx.extBridge AppList.getList), 点击经 AppList.launch 拉起
//   2026-07-22 页面底板展示当前小程序版本号(经 wx.getSystemInfoSync 取 appVersion)
//   2026-07-22 新增 QQ 式下拉面板: 顶部把手下拉唤出添加小程序页面, 松手过半吸附开/合, 可下拉关闭
//   2026-07-22 新增仿 QQ 顶栏: 左上角头像/昵称/在线状态(点开抽屉), 右上角加号(下拉菜单含扫一扫)
//   2026-07-22 优化下拉/上滑交互: 橡皮筋阻尼 + 速度甩动 + 点击展开 + 关闭按钮 + 方向修正
//   2026-07-22 沉浸式状态栏: navbar 顶部用 statusBarHeight(px) 预留系统状态栏高度
//   2026-07-22 下拉交互改为: 列表滚到顶下拉唤出面板 / 面板整体上滑关闭(移除把手) / 滚动增强
Page({
  data: {
    keywords: '',
    list: [],        // 全量列表(来自宿主)
    displayList: [], // 过滤后展示列表
    version: '',     // 当前小程序版本名(取自 wx.getSystemInfoSync.appVersion)
    // 下拉面板状态
    panelHeight: 0,      // 面板可视高度(px)
    panelY: -2000,       // 面板 translateY(px), 关闭时为 -panelHeight
    panelOpacity: 0,     // 面板(含遮罩)透明度
    panelTransition: false, // 是否启用过渡动画(拖拽时关闭, 吸附时开启)
    panelOpen: false,
    newAppId: '',
    newName: '',
    newPath: '',
    // 顶栏用户信息
    nickName: '我的昵称',
    onlineStatus: '在线',
    avatarText: '我',
    // 系统状态栏高度(px), 沉浸式(custom)下需手动预留, 否则导航栏与状态栏重叠
    statusBarHeight: 0,
    // 抽屉与下拉菜单
    drawerOpen: false,
    menuOpen: false,
  },

  // 拖拽过程临时状态(不放进 data, 避免无谓渲染)
  _drag: null,
  _scrollTop: 0, // 列表当前滚动位置, 用于判断是否滚到顶以触发下拉面板

  onLoad() {
    const that = this
    // 取当前小程序版本号(宿主 SystemApi 在 getSystemInfoSync 中注入 appVersion)
    try {
      const sys = (typeof wx.getSystemInfoSync === 'function') ? wx.getSystemInfoSync() : {}
      that.setData({ version: sys.appVersion || '' })
      that.setData({ statusBarHeight: sys.statusBarHeight || 0 })
      const h = sys.windowHeight || 600
      that.setData({ panelHeight: h, panelY: -h })
    } catch (e) {
      console.error('[index] getSystemInfoSync fail:', e)
    }
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

  // ===== 下拉面板: 拖拽(橡皮筋阻尼 + 速度甩动) =====
  // 列表滚到顶下拉、面板整体上滑, 共用同一套拖拽逻辑, 由 data-role 区分触发源
  onPullStart(e) {
    const role = e.currentTarget.dataset.role
    if (role === 'list') {
      // 仅当列表在顶部且面板未开时, 下拉才唤出面板
      if (this._scrollTop > 0 || this.data.panelOpen) return
    } else if (role === 'panel') {
      // 仅当面板已开时, 上滑才收起面板
      if (!this.data.panelOpen) return
    }
    const t = e.touches[0]
    this._drag = {
      startY: t.clientY,
      baseY: this.data.panelY,
      time: Date.now(),
      role,
    }
    this.setData({ panelTransition: false })
  },

  // 列表滚动位置上报, 供下拉触发判断
  onPageScroll(e) {
    this._scrollTop = e.detail.scrollTop
  },

  onPullMove(e) {
    const d = this._drag
    if (!d) return
    const t = e.touches[0]
    const delta = t.clientY - d.startY
    // 列表侧向下滚动由 scroll-view 自身处理, 不干扰面板
    if (d.role === 'list' && delta < 0) return
    const h = this.data.panelHeight
    const min = -h
    let y = d.baseY + delta
    // 越过边界时施加橡皮筋阻力, 手感更自然(硬截断会显得生硬)
    if (y > 0) y = y * 0.3
    if (y < min) y = min + (y - min) * 0.3
    const clamped = Math.max(min, Math.min(0, y))
    const opacity = (h + clamped) / h
    this.setData({ panelY: y, panelOpacity: Math.max(0, Math.min(1, opacity)) })
  },

  onPullEnd(e) {
    const d = this._drag
    if (!d) return
    this._drag = null
    this.setData({ panelTransition: true })
    const h = this.data.panelHeight
    const shown = (h + this.data.panelY) / h
    // 平均速度(px/ms): >0 向下, <0 向上; 用于快速甩动手势
    const v = (e.changedTouches[0].clientY - d.startY) / Math.max(1, Date.now() - d.time)
    if (v < -0.4) {
      this._setPanel(false)         // 向上快速甩 -> 关闭
    } else if (v > 0.4) {
      this._setPanel(true)          // 向下快速甩 -> 打开
    } else if (shown > 0.4) {
      this._setPanel(true)          // 露出过半 -> 吸附打开
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

  // ===== 顶栏: 左侧抽屉 / 右侧加号菜单 =====
  openDrawer() {
    this.setData({ drawerOpen: true, menuOpen: false })
  },
  closeDrawer() {
    this.setData({ drawerOpen: false })
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
    wx.showToast({ title: `点击: ${key}`, icon: 'none' })
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
