// 首页: 展示应用信息与主要入口
// 履历:
//   2026-07-21 新建首页
Page({
  data: {
    appVersion: '',
    entries: [
      { id: 'component', name: '组件', desc: '官方组件展示', url: '../component/index' },
      { id: 'API', name: '接口', desc: '开放能力接口', url: '../API/index' }
    ]
  },
  onLoad: function () {
    var info = wx.getSystemInfoSync()
    this.setData({ appVersion: info.appVersion || '' })
  },
  goPage: function (e) {
    wx.navigateTo({ url: e.currentTarget.dataset.url })
  }
})
