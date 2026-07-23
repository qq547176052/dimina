// page/login/login.js
// 简介: 登录页(启动页). onLoad 自检登录态: 已登录直接 reLaunch 首页, 未登录停留输入账号密码.
//       演示账号 admin/123456, 校验通过写入 token 与账号名到 storage, 供首页与退出登录使用.
// 履历:
//   2026-07-23 新建: 账号密码登录 + 登录态自检跳转(启动页), 用 reLaunch 避免返回键回到登录页
const VALID_ACCOUNT = 'admin'   // 演示账号(接入后端后替换为接口校验)
const VALID_PASSWORD = '123456' // 演示密码
const HOME_PATH = '/page/tabBar/component/index/index'

Page({
  data: {
    account: '',
    password: '',
    statusBarHeight: 0,
    loading: false, // 登录中禁用按钮防重复提交
  },

  onLoad() {
    // 沉浸式(custom)导航下预留状态栏高度
    try {
      const info = wx.getSystemInfoSync()
      this.setData({ statusBarHeight: info.statusBarHeight || 0 })
    } catch (e) {}
    // 已登录直接进首页(reLaunch 清空页面栈, 返回键不会回到登录页)
    if (wx.getStorageSync('token')) {
      wx.reLaunch({ url: HOME_PATH })
    }
  },

  onAccountInput(e) {
    this.setData({ account: e.detail.value })
  },
  onPasswordInput(e) {
    this.setData({ password: e.detail.value })
  },

  onLogin() {
    const { account, password, loading } = this.data
    if (loading) return
    if (!account || !password) {
      wx.showToast({ title: '请输入账号和密码', icon: 'none' })
      return
    }
    this.setData({ loading: true })
    // 本地演示校验; 接入后端时替换为 wx.request 登录接口, 成功回调里写 token
    if (account === VALID_ACCOUNT && password === VALID_PASSWORD) {
      wx.setStorageSync('token', `tk_${Date.now()}`)
      wx.setStorageSync('userName', account)
      const app = getApp()
      if (app && app.globalData) app.globalData.hasLogin = true
      wx.reLaunch({ url: HOME_PATH })
    } else {
      this.setData({ loading: false })
      wx.showToast({ title: '账号或密码错误', icon: 'none' })
    }
  },
})
