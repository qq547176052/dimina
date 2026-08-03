// 人员管理页(考勤系统"人员管理"tab, 对标 PC face_dingtalk_staff.html)
// 履历:
//   2026-08-03 修复: 加 onUnload 标记 _destroyed, _loadList 异步回调判活, 规避页面卸载后 setData 内部错误
//   2026-08-03 修复: data 字段名改为英文/拼音, 规避微信编译器对中文标识符的潜在限制
//   2026-08-03 初版: 复用 确保Token/分页骨架; 接入 staff 接口; 点击人员携带 userId 跳 kaoqin 个人明细
const config = require('../../config.js')
const api = require('../../utils/api.js')
const { 确保Token } = require('../../utils/auth.js')

Page({
  data: {
    list: [],
    page: 1,
    pageSize: 20,
    total: 0,
    loading: false,
    noMore: false,
    error: '',
    searchName: '',
    tempSearch: '',
  },

  onLoad() {
    确保Token(this)
  },

  onUnload() {
    this._destroyed = true
  },

  onPullDownRefresh() {
    this._resetList(() => wx.stopPullDownRefresh())
  },

  onReachBottom() {
    if (this.data.noMore || this.data.loading) return
    this._loadMore()
  },

  _query(page) {
    const p = { page: page, pageSize: this.data.pageSize }
    if (this.data.searchName) p.name = this.data.searchName
    return p
  },

  _resetList(done) {
    this.setData({ list: [], page: 1, total: 0, noMore: false, error: '' })
    this._loadList(done)
  },

  _loadMore() {
    this._loadList(null, true)
  },

  _loadList(done, append) {
    if (this.data.loading || this._destroyed) return
    this.setData({ loading: true, error: '' })
    const page = append ? this.data.page + 1 : 1
    api.staff.list(this._query(page))
      .then((r) => {
        if (this._destroyed) {
          if (done) done()
          return
        }
        if (!r.ok) {
          this.setData({ loading: false, error: r.message || '加载失败' })
          if (done) done()
          return
        }
        const next = append ? this.data.list.concat(r.list) : r.list
        this.setData({
          list: next,
          page: page,
          total: r.total,
          noMore: next.length >= r.total,
          loading: false,
        })
        if (done) done()
      })
      .catch((err) => {
        if (this._destroyed) {
          if (done) done()
          return
        }
        this.setData({ loading: false, error: (err && err.message) || '网络错误' })
        if (done) done()
      })
  },

  onSearchInput(e) {
    this.setData({ tempSearch: e.detail.value })
  },

  onSearchConfirm() {
    this.setData({ searchName: this.data.tempSearch })
    this._resetList()
  },

  onSearchClear() {
    this.setData({ searchName: '', tempSearch: '' })
    this._resetList()
  },

  onStaffTap(e) {
    const id = e.currentTarget.dataset.id
    const name = e.currentTarget.dataset.name
    wx.navigateTo({
      url: '/page/kaoqin/kaoqin?userId=' + id + '&name=' + encodeURIComponent(name || ''),
    })
  },
})
