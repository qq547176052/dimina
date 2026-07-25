// page/tabBar/component/index/index.js
// 简介: 组件 Tab 首页, 展示宿主侧小程序列表, 支持左滑置顶/删除、右滑开抽屉、顶部下拉添加小程序面板.
//   各功能方法按职责拆入 mixins/(list/swipe/panel/drawer/update), 工具函数拆入 utils/helpers.js, 本文件仅保留 data/onLoad 与合并入口.
// 履历:
//   2026-07-24 抽屉新增"检查更新"入口(data-key=checkUpdate): 经宿主管理扩展模块走 cnb 源更新(方案1), 引擎 applyUpdate 冷重启
//   2026-07-24 检查更新链路改用 async/await + Promise 封装(_callAppList/_confirmModal)消除回调嵌套; 保留 _hideLoadingSafe 双 tick 关 loading 防御时序竞争
//   2026-07-24 extBridge 调用 module 改用本小程序 appId(宿主以 AppConfig.DEFAULT_APP_ID 注册模块, 二者相等); data 仍携带 appId; 事件名改为中文(获取列表/拉起/删除/检查更新/下载更新)
//   2026-07-24 按功能拆分多文件: 列表/手势/面板/抽屉/更新拆入 mixins/*, 工具函数拆入 utils/helpers.js, 本文件仅保留 data/onLoad 与 Object.assign 合并入口
//   2026-07-24 onLoad 从 storage 的 user 对象回填抽屉信息: name→nickName, 首字→avatarText, role→onlineStatus(工程师/客户)
//   2026-07-25 抽屉用户信息回显改用 config.读取本地数据().user 统一取 user(整对象)
//   2026-07-25 版本号取值改 wx.getAccountInfoSync().miniProgram.version(原生微信与 dimina 统一), 不再用 getSystemInfoSync().appVersion; 新增 APP_VERSION 兜底(开发者工具/体验版 version 为空)
//   2026-07-25 新增登录态守卫: 首页为宿主冷启动入口(覆盖 app.json 首屏登录页), onLoad 自检 token, 未登录直接 reLaunch 登录页, 修复"退出后冷启动仍显示已登录界面"

const listMixin = require('./mixins/list.js')
const swipeMixin = require('./mixins/swipe.js')
const panelMixin = require('./mixins/panel.js')
const drawerMixin = require('./mixins/drawer.js')
const updateMixin = require('./mixins/update.js')
const config = require('../../../../config.js') // 后端配置(含 读取/保存本地数据)

const APP_VERSION = '1.0.0' // 兜底版本号(开发者工具/体验版 getAccountInfoSync.miniProgram.version 为空时使用)

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
      version: '',     // 当前小程序版本名(取自 wx.getAccountInfoSync().miniProgram.version, 兜底 APP_VERSION)
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
      onlineStatus: '在线109',
      avatarText: '我',
      // 系统状态栏高度(px), 沉浸式(custom)下需手动预留, 否则导航栏与状态栏重叠
      statusBarHeight: 0,
      // 抽屉与下拉菜单
      drawerOpen: false,
      menuOpen: false,
    },

    onLoad() {
      // 登录态守卫: 首页是宿主冷启动入口(覆盖 app.json 首屏登录页), 必须自检登录态;
      // token 为空(未登录/已退出)时跳登录页, 由登录页 onLoad 回填/自动刷新后跳回首页
      const 本地 = config.读取本地数据()
      if (!本地.token) {
        wx.reLaunch({ url: '/page/login/login' })
        return
      }

      /*
        const accountInfo = wx.getAccountInfoSync();
        // 小程序自定义版本号（上传代码时填写的版本）
        const version = accountInfo.miniProgram.version;
        // 运行环境：develop开发版 / trial体验版 / release正式版
        const envVersion = accountInfo.miniProgram.envVersion;
      */
      const that = this
      // 记录本小程序 appId 与版本号: 经 wx.getAccountInfoSync 取 miniProgram.appId / version(原生微信与 dimina 统一字段)
      let version = APP_VERSION
      try {
        const info = (typeof wx.getAccountInfoSync === 'function') ? wx.getAccountInfoSync() : {}
        this._myAppId = (info.miniProgram && info.miniProgram.appId) || ''
        // 小程序版本号: 原生微信/ dimina 均在 miniProgram.version 返回; 开发者工具/体验版为空, 回退兜底
        const mpVer = info.miniProgram && info.miniProgram.version
        version = (typeof mpVer === 'string' && mpVer) ? mpVer : APP_VERSION
      } catch (e) {
        this._myAppId = ''
        console.error('[index] getAccountInfoSync fail:', e)
      }
      // 取状态栏高度等系统信息(宿主 SystemApi 注入)
      try {
        const sys = (typeof wx.getSystemInfoSync === 'function') ? wx.getSystemInfoSync() : {}
        const h = sys.windowHeight || 600
        that.setData({
          version,
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
      // 从登录保存的 user 对象填充抽屉用户信息(name→昵称, 首字→头像, role→状态标签)
      /*
        工程师: "engineer",
        客户:  "customer",
        管理员: "admin",
        超级管理员: "super_admin",
       */
      try {
        const user = config.读取本地数据().user || {}
        const uname = user.name || user.username || ''
        const roleLabel = user.role === 'engineer' ? '工程师'
          : user.role === 'customer' ? '客户'
          : user.role === 'admin' ? '管理员'
          : user.role === 'super_admin' ? '超级管理员'
          : (user.role || that.data.onlineStatus)
        that.setData({
          nickName: uname || that.data.nickName,
          avatarText: uname ? uname.substring(0, 1) : that.data.avatarText,
          onlineStatus: roleLabel,
        })
      } catch (e) {
        console.error('[index] read user fail:', e)
      }
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
