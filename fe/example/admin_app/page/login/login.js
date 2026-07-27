// page/login/login.js
// 简介: 登录页(启动页). onLoad 自检登录态: 已登录直接 switchTab 首页(tabBar 页), 未登录停留输入账号密码.
//       调用后端登录接口(config.api登录链接)校验账号密码, 成功写入 token 与账号名到 storage, 供首页与退出登录使用.
// 履历:
//   2026-07-23 新建: 账号密码登录 + 登录态自检跳转(启动页), 用 redirectTo 避免返回键回到登录页
//   2026-07-24 新增"保存账号密码"开关: 开启则登录成功记住账号密码(saveAccount/savedAccount/savedPassword), 关闭则清除
//   2026-07-24 接入真实后端: onLogin 改为 wx.request 调用 config.api登录链接 登录, 不再用本地演示账号校验
//   2026-07-24 登录密码经 SHA-256 哈希后再上报(请求体 username + password(哈希)), 不传明文
//   2026-07-24 onToggleSave 关闭时立即清除已存账号密码(storage)并清空表单; onLoad 回填/onLogin 落盘逻辑已就位
//   2026-07-24 登录成功保存完整 user 对象(storage 键 user), userName 优先取 user.name/user.username
//   2026-07-24 登录逻辑封装到 config.登录(含 sha256/请求/保存 token+user), login.js 仅调用并在成功后保存账号密码
//   2026-07-24 "保存账号密码" storage 键常量(是否保存/已保存的账号/已保存的密码)迁移至 config.js, 引用统一走 config
//   2026-07-24 onLoad 自检: token 快过期(5分钟内)时用保存的账号密码调用 config.登录 自动刷新, 否则直接进首页
//   2026-07-25 本地数据统一封装为整对象(config.读取本地数据/保存本地数据), 所有 storage 操作走该对象(单一键'本地数据')
//   2026-07-25 新增 onShow: 每次显示登录页复位 loading=false, 解除登录按钮禁用, 避免残留登录中状态卡住按钮
//   2026-07-27 登录/刷新跳转由 reLaunch 改为 redirectTo: reLaunch 会销毁全部 bridge 并重建(换桥空窗, extBridge 请求被静默丢弃); redirectTo 复用同一 bridge 实例(不换桥), 且本场景栈仅单页, 语义等价且规避该 bug
//   2026-07-27 登录/刷新/直进首页跳转由 redirectTo 改为 switchTab: app.json 补齐 tabBar 配置(首页为 tab), redirectTo 跳 tabBar 页会被容器拦截失败(can not redirectTo a tabbar page) 且底层 updatePath 必 destroy+init 当前 bridge(换桥丢回调); switchTab 进入 tabBar 容器后首页 bridge 常驻不复建, 后续请求稳定(对齐 js_rlgl)
//   2026-07-27 登录 5 秒超时收口到 config.登录 内部(单一来源, 覆盖 onLogin 与 onLoad 自动刷新两条路径): Promise 内置 setTimeout(5000) reject + wx.request timeout 选项; 超时/失败均 reject→.catch 复位 loading 并提示, 避免卡在"登录中"; 前端 JS 定时器随 JsCore 销毁会失效, 真·换桥空窗丢回调需框架方案 B 根治
//   2026-07-27 login 纳入 tabBar(三页皆 tab): app.json tabBar list 新增 page/login/login; onShow 调 wx.hideTabBar 隐藏底部 tab 栏(仅为 bridge 常驻稳定); 首页/抽屉回登录页改用 switchTab 跳本 tab
const config = require('../../config.js') // 后端配置(含 api登录链接/login 函数 与 storage 键常量)
const HOME_PATH = '/page/index/index'

Page({
  data: {
    account: '',
    password: '',
    saveAccount: true, // 默认保存账号密码
    statusBarHeight: 0,
    loading: false, // 登录中禁用按钮防重复提交
  },

  // 检查 storage 是否有 token, 有则直接跳转到首页
  // 检查 storage 是否有保存的账号密码, 有则回填
  onLoad() {
    // 沉浸式(custom)导航下预留状态栏高度
    try {
      const info = wx.getSystemInfoSync()
      this.setData({ statusBarHeight: info.statusBarHeight || 0 })
    } catch (e) {}
    // 读取本地持久化数据(整对象: token/user/是否保存/用户名/密码); 优先宿主共享数据(异步同步到本地缓存, 不阻塞)
    const 本地 = config.读取本地数据()
    // 回填已保存的账号密码(仅当开启保存时)
    const saveAccount = 本地.是否保存 === true
    if (saveAccount) {
      this.setData({
        saveAccount: true,
        account: 本地.用户名,
        password: 本地.密码,
      })
    }
    // 已登录: 校验 token 是否快过期, 快过期则用保存的账号密码重新登录刷新
    if (本地.token) {
      // 这里解析打印一下token 这里面有过期时间 可以通过这个过期时间判断是否需要重新登录
      const 令牌 = 本地.token
      let 快过期 = false
      try {
        const 载荷 = JSON.parse(atob(令牌.split('.')[1] || ''))
        console.log('token解析:', 载荷, '过期时间:', 载荷 && 载荷.exp ? new Date(载荷.exp * 1000).toLocaleString() : '未知')
        if (载荷 && 载荷.exp) {
          const 剩余毫秒 = 载荷.exp * 1000 - Date.now()
          快过期 = 剩余毫秒 < 10 * 60 * 60 * 1000 // 10小时内过期视为快过期
        }
      } catch (错误) {
        console.log('token解析失败:', 错误)
      }
      if (!快过期) {
        wx.switchTab({ url: HOME_PATH }) // 未快过期: 直接进首页
        return
      }
      // 快过期: 用保存的账号密码重新登录刷新 token
      const 账号 = 本地.用户名
      const 密码 = 本地.密码
      if (账号 && 密码) {
        console.log('token快过期, 自动重新登录刷新')
        this.setData({ loading: true })
        // config.登录 内部含 5 秒超时, 超时/失败均 reject
        config.登录(账号, 密码)
          .then(() => {
            const app = getApp()
            if (app && app.globalData) app.globalData.hasLogin = true
            wx.switchTab({ url: HOME_PATH })
          })
          .catch((错误) => {
            this.setData({ loading: false })
            wx.showToast({ title: 错误.message || '登录失败', icon: 'none' })
          })
        return
      }
      // 无保存的账号密码, 无法刷新, 直接进入首页
      wx.switchTab({ url: HOME_PATH })
    }
  },

  // 每次显示页面时解除登录按钮禁用(复位 loading), 避免残留登录中状态卡住按钮
  onShow() {
    this.setData({ loading: false })
    // 隐藏原生 tabBar: 本页为 tabBar 页(仅为 bridge 常驻稳定), UI 不显示底部 tab 栏
    if (typeof wx.hideTabBar === 'function') wx.hideTabBar()
  },

  onAccountInput(e) {
    this.setData({ account: e.detail.value })
  },
  onPasswordInput(e) {
    this.setData({ password: e.detail.value })
  },

  // 切换"保存账号密码": 开启仅置位(登录成功时才落盘); 关闭则立即清除已存账号密码并清空表单
  onToggleSave(e) {
    const checked = (e && e.detail && typeof e.detail.value === 'boolean')
      ? e.detail.value
      : !this.data.saveAccount
    if (checked) {
      this.setData({ saveAccount: true })
    } else {
      config.保存本地数据({ 是否保存: false, 用户名: '', 密码: '' })
      this.setData({ saveAccount: false, account: '', password: '' })
    }
  },

  // 当saveAccount为true时，保存账号密码到 storage
  onLogin() {
    const { account, password, loading, saveAccount } = this.data
    if (loading) return
    if (!account || !password) {
      wx.showToast({ title: '请输入账号和密码', icon: 'none' })
      return
    }
    this.setData({ loading: true })
    // 调用 config.登录 完成登录(内部含 5 秒超时, 超时/失败均 reject); 成功后按开关保存账号密码并重进首页
    config.登录(account, password)
      .then(() => {
        // 登录成功: 直接按开关保存账号密码, 置登录态并进入首页
        if (saveAccount) {
          config.保存本地数据({ 是否保存: true, 用户名: account, 密码: password })
        } else {
          config.保存本地数据({ 是否保存: false, 用户名: '', 密码: '' })
        }
        const app = getApp()
        if (app && app.globalData) app.globalData.hasLogin = true
        wx.switchTab({ url: HOME_PATH })
      })
      .catch((err) => {
        this.setData({ loading: false })
        wx.showToast({ title: err.message || '登录失败', icon: 'none' })
      })
  },
})
