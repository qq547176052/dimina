// page/tabBar/component/index/index.js
// 简介: 组件 Tab 首页, 展示宿主侧小程序列表, 支持左滑置顶/删除、右滑开抽屉、顶部下拉添加小程序面板.
//   各功能方法按职责拆入 mixins/(list/swipe/panel/drawer/update), 工具函数拆入 utils/helpers.js, 本文件仅保留 data/onLoad 与合并入口.
// 履历:
//   2026-07-24 抽屉新增"检查更新"入口(data-key=checkUpdate): 经宿主管理扩展模块走 cnb 源更新(方案1), 引擎 applyUpdate 冷重启
//   2026-07-24 检查更新链路改用 async/await + Promise 封装(_callAppList/_confirmModal)消除回调嵌套; 保留 _hideLoadingSafe 双 tick 关 loading 防御时序竞争
//   2026-07-24 extBridge 调用 module 改用本小程序 appId(宿主以 AppConfig.DEFAULT_APP_ID 注册模块, 二者相等); data 仍携带 appId; 事件名改为中文(获取列表/拉起/删除/检查更新/下载更新)
//   2026-07-24 按功能拆分多文件: 列表/手势/面板/抽屉/更新拆入 mixins/*, 工具函数拆入 utils/helpers.js, 本文件仅保留 data/onLoad 与 Object.assign 合并入口

const listMixin = require('./mixins/list.js')
const swipeMixin = require('./mixins/swipe.js')
const panelMixin = require('./mixins/panel.js')
const drawerMixin = require('./mixins/drawer.js')
const updateMixin = require('./mixins/update.js')

Page(Object.assign(
  {},
  listMixin,
  swipeMixin,
  panelMixin,
  drawerMixin,
  updateMixin,
  {
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
      onlineStatus: '在线108',
      avatarText: '我',
      // 系统状态栏高度(px), 沉浸式(custom)下需手动预留, 否则导航栏与状态栏重叠
      statusBarHeight: 0,
      // 抽屉与下拉菜单
      drawerOpen: false,
      menuOpen: false,
    },

    onLoad() {
      const that = this
      // 记录本小程序 appId, 经 extBridge 调用宿主时作为 module 名(与宿主 AppConfig.DEFAULT_APP_ID 注册对齐)
      try {
        const info = (typeof wx.getAccountInfoSync === 'function') ? wx.getAccountInfoSync() : {}
        this._myAppId = (info.miniProgram && info.miniProgram.appId) || ''
      } catch (e) {
        this._myAppId = ''
        console.error('[index] getAccountInfoSync fail:', e)
      }
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
      that._fetchList()
      // 注册内置更新管理器: 宿主下载并安装到 .pending 后推送 updateready, 此处弹重启确认
      try {
        if (typeof wx.getUpdateManager === 'function') {
          const um = wx.getUpdateManager()
          um.onUpdateReady(() => this._onUpdateReady())
          um.onUpdateFailed(() => wx.showToast({ title: '更新失败', icon: 'none' }))
        }
      } catch (e) {
        console.error('[index] getUpdateManager init fail:', e)
      }
    },
  },
))
