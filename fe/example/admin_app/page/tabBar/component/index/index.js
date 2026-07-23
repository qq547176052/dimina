// page/tabBar/component/index/index.js
// 简介: 组件 Tab 首页, 展示宿主侧小程序列表, 支持左滑置顶/删除、右滑开抽屉、顶部下拉添加小程序面板.
// 履历:
//   2026-07-22 页面基于宿主列表重构(搜索/头像/版本号), 仿 QQ 顶栏+左侧抽屉+下拉菜单
//   2026-07-23 左滑改用 movable-view(bindchange 跟踪实时位移), 阈值吸附展开/复位; 删除通知宿主不持久化, 成功后重拉列表
//   2026-07-23 重写整理: 右滑开抽屉挂根容器, 下拉面板用原生 refresher, 统一手势收口, 修复"滑哪停哪"无吸附 bug
//   2026-07-23 优化: 未展开按钮 opacity 隐藏防缝隙透出; 展开项回拖 1/5 即收起(关闭阀值调小)
//   2026-07-23 抽屉手势: 列表区右滑开抽屉(起点有展开项时让位给关闭); 抽屉打开时右滑关闭抽屉
//   2026-07-23 阈值定死 px: 列表项开/关、抽屉开/关、面板上滑收起均改用固定 px, 不再用比例(比例在不同屏宽手感不一致)
//   2026-07-23 修复: const 常量移出 Page({}) 对象字面量(原写法导致 SyntaxError 整页不可用); 左滑位移改用路径更新降渲染开销; 补面板手势空触摸点保护
//   2026-07-23 关闭列表项阀值调小(SWIPE_CLOSE_PX 30→15, 更易收起); 抽屉面板挂专属右滑手势关闭
//   2026-07-23 开抽屉判定改为"当前项"展开(非任意项): 右滑未展开项仍可正常开抽屉, 仅右滑已展开项才让位关闭
//   2026-07-23 关闭判定改以"展开位"为基准(原以闭合位为基准需几乎拖回原位才收起, 右滑易吸附回开); SWIPE_CLOSE_PX 15→20
//   2026-07-23 展开阀值调小(SWIPE_OPEN_PX 60→15): 实测自然左滑仅约 21px, 60px 几乎无法触发展开
//   2026-07-23 抽屉关闭方向修正: 抽屉从左侧滑出, 关闭应为"左滑"推回(原误写右滑); 新增 DRAWER_CLOSE_PX=40
//   2026-07-23 接入登录: 顶栏/抽屉昵称头像取登录账号(storage.userName); 抽屉"退出登录"清 token 后 reLaunch 回登录页
//   2026-07-23 抽屉"我的收藏/设置"合并为"检查更新", 接入 wx.getUpdateManager() 触发小程序远程更新(配合宿主 updateManifestUrl)
//   2026-07-23 检查更新改经 wx.extBridge(MiniAppUpdate) 触发宿主从 git 仓库更新; 首页手动流程分三步:
//               check 比对版本 -> 确认下载(download, progress 进度条实时展示) -> 确认重启(install: 关闭小程序->解压替换沙盒->冷重启)
//   2026-07-23 下载/校验在运行期完成(只写暂存不动沙盒), 解压替换延后到小程序关闭后, 避开运行期替换卡死的 ANR
// 手势阈值(固定 px, 不随屏幕/比例变化), 置于模块作用域供 Page 方法闭包访问
// const SWIPE_OPEN_PX = 15    // 列表项左滑展开所需最小位移(px)
// const SWIPE_CLOSE_PX = 15   // 展开项从"展开位"右拖超过该 px 即收起(以展开位为基准, 非以闭合位为基准)
// const DRAWER_EDGE_PX = 60   // 列表区右滑开抽屉的横向位移阈值(px)
// const DRAWER_CLOSE_PX = 40  // 抽屉内左滑关闭的横向位移阈值(px, 实测自然左滑约 54px)
// const PANEL_CLOSE_PX = 150  // 面板上滑收起的位移阈值(px)


const SWIPE_OPEN_PX = 15    // 列表项左滑展开所需最小位移(px)
const SWIPE_CLOSE_PX = 15   // 展开项从"展开位"右拖超过该 px 即收起(以展开位为基准, 非以闭合位为基准)
const DRAWER_EDGE_PX = 15   // 列表区右滑开抽屉的横向位移阈值(px)
const DRAWER_CLOSE_PX = 15  // 抽屉内左滑关闭的横向位移阈值(px, 实测自然左滑约 54px)
const PANEL_CLOSE_PX = 15  // 面板上滑收起的位移阈值(px)

Page({
  data: {
    keywords: '',
    list: [],        // 全量列表(来自宿主)
    displayList: [], // 过滤后展示列表
    version: '',     // 当前小程序版本名(取自 wx.getSystemInfoSync.appVersion)
    actionWidth: 0,  // 左滑操作区总宽度(px), 按屏幕宽度动态计算
    swipeLock: false, // 横向滑动进行中锁定 scroll-view 垂直滚动, 避免原生滚动抢手势
    // 下拉面板状态
    panelHeight: 0,      // 面板可视高度(px)
    panelY: -2000,       // 面板 translateY(px), 关闭时为 -panelHeight
    panelOpacity: 0,     // 面板(含遮罩)透明度
    panelTransition: false, // 是否启用过渡动画(拖拽时关闭, 吸附时开启)
    panelOpen: false,
    triggered: false, // 原生下拉刷新状态, 触发面板后置 false 收起刷新动画(否则 scroll-view 卡在顶部下拉位置)
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
    // 更新进度: 覆盖层显隐/阶段/百分比(percent=-1 表示未知, 走不确定态)
    showProgress: false,
    updateStage: 'check',
    updatePercent: 0,
  },

  // 拖拽/手势临时状态(不放进 data, 避免无谓渲染)
  _swipeX: 0,
  _swipeStartVal: 0,
  _swipeMoved: false,
  _pageStartX: 0,
  _pageStartY: 0,
  _drag: null,

  onLoad() {
    const that = this
    // 取当前小程序版本号与状态栏高度(宿主 SystemApi 在 getSystemInfoSync 中注入 appVersion)
    try {
      const sys = (typeof wx.getSystemInfoSync === 'function') ? wx.getSystemInfoSync() : {}
      const h = sys.windowHeight || 600
      that.setData({
        version: sys.appVersion || '',
        statusBarHeight: sys.statusBarHeight || 0,
        panelHeight: h,
        panelY: -h,
        // 操作区总宽 320rpx(置顶160rpx + 删除160rpx), 转换为 px 供左滑位移 clamp 使用(按钮实际宽 320rpx)
        actionWidth: Math.round((sys.windowWidth || 375) / 750 * 320),
      })
    } catch (e) {
      console.error('[index] getSystemInfoSync fail:', e)
    }
    // 顶栏/抽屉昵称与头像取登录账号(登录页写入 storage)
    try {
      const userName = wx.getStorageSync('userName')
      if (userName) that.setData({ nickName: userName, avatarText: userName.substring(0, 1).toUpperCase() })
    } catch (e) {}
    // 订阅宿主更新进度(extOnBridge 持续推送): 检查/下载/安装阶段的真实百分比
    if (typeof wx.extOnBridge === 'function') {
      wx.extOnBridge({
        module: 'MiniAppUpdate',
        event: 'progress',
        callBack: (res) => that.onUpdateProgress(res),
      })
    }
    that._fetchList()
  },

  // 更新进度回调: 由宿主 downloadZip 按字节/总大小流式上报, 实时刷新进度条
  onUpdateProgress(res) {
    if (!res) return
    this.setData({
      updateStage: res.stage || 'download',
      updatePercent: typeof res.percent === 'number' ? res.percent : -1,
    })
  },

  // 从宿主获取小程序列表(宿主会屏蔽本会话已删除项), 作为列表唯一数据源
  _fetchList() {
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
      module: 'AppList',
      event: 'launch',
      data: { appId },
      fail: (err) => {
        console.error('[index] launch fail:', err)
      },
    })
  },

  // ===== 列表项左滑: 置顶 / 删除 =====
  // 直接由 touch 事件(clientX/Y 差)计算位移并 apply 到 content 的 translateX,
  // 不依赖 movable-view(其在 dimina 下 bindchange 回报的 x 恒为 0, 导致阈值与吸附全部失效);
  // 纵向意图不干预(交给 scroll-view 原生滚动); 横向意图确定后锁定 scroll-view 垂直滚动, 避免抢手势/取消触摸
  onSwipeTouchStart(e) {
    // 每个触摸周期开始重置滑动状态, 避免上一轮滑动残留导致后续点击被吞
    const t = e.touches[0]
    this._sx = t ? t.clientX : 0
    this._sy = t ? t.clientY : 0
    this._startTranslate = this._lookupTranslateX(e.currentTarget.dataset.appid)
    this._swipeWasOpen = this._startTranslate < 0   // 记录本次手势作用于的"当前项"是否原本展开
    this._dir = null        // 'h' 横向 | 'v' 纵向 | null 未定
    this._moved = false
    this._curX = this._startTranslate
  },

  onSwipeTouchMove(e) {
    const t = e.touches[0]
    if (!t) return
    const dx = t.clientX - this._sx
    const dy = t.clientY - this._sy
    if (Math.abs(dx) > 4 || Math.abs(dy) > 4) this._moved = true
    // 意图判定: 位移超过 8px 且横向为主才视为左滑; 否则交由原生滚动
    if (this._dir === null && (Math.abs(dx) > 8 || Math.abs(dy) > 8)) {
      this._dir = Math.abs(dx) > Math.abs(dy) ? 'h' : 'v'
      if (this._dir === 'h' && !this.data.swipeLock) this.setData({ swipeLock: true })
    }
    if (this._dir !== 'h') return // 纵向滚动或尚未确定: 不干预
    const appId = e.currentTarget.dataset.appid
    // 跟随手指计算位移并约束在 [-actionWidth, 0]
    this._curX = Math.max(-this.data.actionWidth, Math.min(0, this._startTranslate + dx))
    this._setItemTranslateX(appId, this._curX)
  },

  onSwipeTouchEnd(e) {
    const appId = e.currentTarget.dataset.appid
    if (this.data.swipeLock) this.setData({ swipeLock: false })
    if (this._dir === 'h') {
      const { actionWidth } = this.data
      const x = typeof this._curX === 'number' ? this._curX : 0
      // 展开态(x 起点为负): 从展开位右拖超过 SWIPE_CLOSE_PX(px)即收起(以展开位为基准, 否则需几乎拖回原位才收起); 收起态: 左滑超过 SWIPE_OPEN_PX(px)才展开; 纯位置判定不认速度
      const target = this._startTranslate < 0
        ? (x > this._startTranslate + SWIPE_CLOSE_PX ? 0 : -actionWidth)
        : (x < -SWIPE_OPEN_PX ? -actionWidth : 0)
      if (target < 0) this._closeOthers(appId) // 打开时先关闭其它项, 保证最多一个展开
      this._setItemTranslateX(appId, target)
      // 横向手势落在"已展开项"上: 让位给该项自身的关闭, 抑制根容器开抽屉(仅针对当前项, 不影响其它项)
      this._pageSuppressDrawer = this._swipeWasOpen
      this._dir = null
      return
    }
    // 非横向(纵向滚动或轻点): 不在松手处理点击, 交由 onSwipeTap
    this._dir = null
  },

  onSwipeTap(e) {
    if (this._moved) return // 横向滑动/纵向滚动后补发的 tap 不触发点击
    const hasOpen = this.data.displayList.some((it) => it.translateX < 0)
    if (hasOpen) {
      this._closeAllSwipes()
      return
    }
    this.onTapItem(e)
  },

  _lookupTranslateX(appId) {
    const it = this.data.displayList.find((x) => x.appId === appId)
    return it ? it.translateX : 0
  },

  // 点击列表空白(非操作按钮)区域: 若有展开项则收起(按钮 catchtap 不冒泡, 不受影响)
  onListTap() {
    const hasOpen = this.data.displayList.some((it) => it.translateX < 0)
    if (hasOpen) this._closeAllSwipes()
  },

  // 列表滚动时自动收起展开项, 避免按钮跟着滚动显得突兀
  onListScroll() {
    const hasOpen = this.data.displayList.some((it) => it.translateX < 0)
    if (hasOpen) this._closeAllSwipes()
  },

  // 页面级手势(挂根容器, 接收冒泡触摸): 列表右滑(以水平为主)打开左侧抽屉
  // 垂直滚动因 dy 远大于 dx 不会误触发; 仅当本次右滑落在"已展开当前项"上才让位关闭该项(见 onSwipeTouchEnd), 不影响其它项
  onPageTouchStart(e) {
    const t = e.touches[0]
    this._pageStartX = t ? t.clientX : 0
    this._pageStartY = t ? t.clientY : 0
    // 每个触摸周期重置: 是否抑制开抽屉由本次手势是否落在"已展开列表项"上决定(见 onSwipeTouchEnd),
    // 而非"列表里任意项展开", 这样右滑未展开项仍可正常打开抽屉
    this._pageSuppressDrawer = false
  },

  onPageTouchEnd(e) {
    const t = e.changedTouches && e.changedTouches[0]
    if (!t) return
    const dx = t.clientX - this._pageStartX
    const dy = t.clientY - this._pageStartY
    const rightSwipe = dx > DRAWER_EDGE_PX && Math.abs(dx) > Math.abs(dy) * 1.5
    // 抽屉已打开: 关闭由抽屉自身手势(onDrawerTouchEnd)处理, 此处不再抢手势(避免重复关闭/误判)
    if (this.data.drawerOpen) return
    // 本次横向手势落在"已展开"的当前列表项上: 仅用于关闭该项, 不触发开抽屉
    if (this._pageSuppressDrawer) return
    // 列表区右滑打开左侧抽屉
    if (rightSwipe) this.openDrawer()
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
        module: 'AppList',
        event: 'remove',
        data: { appId },
        success: () => { this._fetchList() },
        fail: () => {},
      })
    }
  },

  _setItemTranslateX(appId, x) {
    // 仅路径更新被滑动那一项的 translateX, 避免 touchmove 每帧重建并序列化整个列表, 减少渲染开销
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

  // ===== 下拉面板: 原生 refresher 触发 + 面板自定义上滑关闭 =====
  // 列表顶部下拉由 scroll-view 原生 refresher 触发(见 bindrefresherrefresh),
  // 不再自行抢 touch, 避免与原生滚动冲突; 面板内上滑关闭用自定义手势(catchtouch, role=panel)
  onRefresherRefresh() {
    // 原生下拉刷新触发: 打开添加小程序面板
    // refresher 刷新态由 _setPanel 随面板生命周期管理(triggered = open),
    // 面板打开期间保持刷新中(列表被遮罩覆盖无感), 关闭时收起, 避免 setTimeout 竞态导致下拉失效
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
    const t = e.changedTouches && e.changedTouches[0]
    if (!t) return
    this._drag = null
    this.setData({ panelTransition: true })
    // 平均速度(px/ms): >0 向下, <0 向上; 用于快速甩动手势(已是 px 量级, 无需改比例)
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

  // ===== 顶栏: 左侧抽屉 / 右侧加号菜单 =====
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
    if (key === 'exit') {
      this._logout()
      return
    }
    if (key === 'update') {
      this.onCheckUpdate()
      return
    }
    wx.showToast({ title: `点击: ${key}`, icon: 'none' })
  },

  // 检查更新(首页 admin_app 手动流程):
  //   1) check   : 仅比对版本号
  //   2) 确认下载 -> download: 宿主后台下载并校验到暂存(运行期只写 cache, 不动沙盒),
  //      经 progress 订阅流式上报真实百分比, 进度条实时展示
  //   3) 确认重启 -> install : 宿主关闭当前小程序 -> 解压替换沙盒 -> 冷重启加载新包
  // 下载/校验在运行期完成, 解压替换延后到小程序关闭后, 彻底避开运行期替换卡死的 ANR。
  onCheckUpdate() {
    if (typeof wx.extBridge !== 'function') {
      wx.showToast({ title: '当前环境不支持更新', icon: 'none' })
      return
    }
    wx.showLoading({ title: '检查更新中...' })
    wx.extBridge({
      module: 'MiniAppUpdate',
      event: 'check',
      data: {},
      success: (res) => {
        wx.hideLoading()
        if (!res.hasUpdate) {
          wx.showToast({ title: '已是最新版本', icon: 'none' })
          return
        }
        // 第一确认: 是否下载更新
        wx.showModal({
          title: '更新提示',
          content: `发现新版本 ${res.versionName || ''}, 是否下载更新?`,
          success: (r) => { if (r.confirm) this._downloadUpdate() },
        })
      },
      fail: (err) => {
        wx.hideLoading()
        console.error('[index] check update fail:', err)
        wx.showToast({ title: '检查更新失败', icon: 'none' })
      },
    })
  },

  // 第二步: 下载并校验到暂存(运行期安全), 进度条实时展示; 完成后提示重启
  _downloadUpdate() {
    this.setData({ showProgress: true, updateStage: 'download', updatePercent: 0 })
    wx.extBridge({
      module: 'MiniAppUpdate',
      event: 'download',
      data: {},
      success: (res) => {
        this.setData({ showProgress: false })
        if (!res.downloaded) {
          wx.showToast({ title: '已是最新版本', icon: 'none' })
          return
        }
        // 第二确认: 是否重启小程序生效
        wx.showModal({
          title: '更新完成',
          content: `新版本 ${res.versionName || ''} 已下载, 是否重启小程序生效?`,
          success: (r) => { if (r.confirm) this._installUpdate() },
        })
      },
      fail: (err) => {
        this.setData({ showProgress: false })
        console.error('[index] download update fail:', err)
        const msg = (err && err.errMsg) || ''
        wx.showToast({ title: msg.indexOf('updating') >= 0 ? '正在下载更新...' : '下载失败', icon: 'none' })
      },
    })
  },

  // 第三步: 关闭当前小程序 -> 解压替换沙盒 -> 冷重启(宿主侧主线程执行, 当前小程序将被销毁)
  _installUpdate() {
    if (typeof wx.extBridge !== 'function') return
    wx.extBridge({
      module: 'MiniAppUpdate',
      event: 'install',
      data: {},
      success: () => {},
      fail: (err) => { console.error('[index] install update fail:', err) },
    })
  },

  // 退出登录: 确认后清登录态并 reLaunch 回登录页(清空页面栈)
  _logout() {
    wx.showModal({
      title: '退出登录',
      content: '确定要退出登录吗?',
      success: (res) => {
        if (!res.confirm) return
        try {
          wx.removeStorageSync('token')
          wx.removeStorageSync('userName')
        } catch (e) {}
        const app = getApp()
        if (app && app.globalData) app.globalData.hasLogin = false
        wx.reLaunch({ url: '/page/login/login' })
      },
    })
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

// 按关键字过滤(名称包含匹配), 过滤后重置所有项的滑动状态
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
