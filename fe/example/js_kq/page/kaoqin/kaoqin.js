// 考勤统计页(考勤系统"考勤统计"tab)
// 功能: 按日统计卡 + 考勤明细(先到→最晚到升序) + 迟到黄/红标记 + 姓名/来源筛选
// 履历:
//   2026-08-03 精简: 去掉周/月周期选择, 只保留按日统计
//   2026-08-03 修复: 加 onUnload 标记 _destroyed, _loadList/onShow 异步回调判活, 规避页面卸载后 setData 内部错误
//   2026-08-03 修复 wxml 编译错误: 全部 data 字段名改为英文/拼音, 避免微信编译器对中文标识符的潜在限制与不可见字符问题
//   2026-08-03 初版: 改造自原"抓拍记录"页, 复用 确保Token/分页/筛选抽屉 骨架; 接入 attendance 接口(列表 asc 升序 + summary 统计卡)
const config = require('../../config.js')
const api = require('../../utils/api.js')
const { 确保Token } = require('../../utils/auth.js')

const sourceOptions = ['全部', '钉钉推送', '摄像头抓拍']

Page({
  data: {
    dateText: '',
    maxDate: '',
    summary: null,
    list: [],
    page: 1,
    pageSize: 20,
    total: 0,
    loading: false,
    noMore: false,
    error: '',
    drawerShow: false,
    filterName: '',
    filterSourceIdx: 0,
    sourceOptions: sourceOptions,
    tempName: '',
    tempSourceIdx: 0,
    personalUserId: '',
    personalName: '',
    // 图片查看器（交互同 js_rlgl/page/max_image）
    viewerShow: false,
    viewerUrl: '',
    viewerScale: 1,
    viewerRotate: 0,
    viewerX: 0,
    viewerY: 0,
    viewerAnim: false,
  },

  onLoad(opts) {
    if (opts && opts.userId) {
      this.setData({ personalUserId: opts.userId, personalName: opts.name || '' })
    }
    this._refreshDateText()
    确保Token(this)
  },

  onShow() {
    if (this._inited && !this._destroyed) {
      this._loadSummary()
      this._resetList()
    }
  },

  onUnload() {
    this._destroyed = true
  },

  onPullDownRefresh() {
    this._loadSummary()
    this._resetList(() => wx.stopPullDownRefresh())
  },

  onReachBottom() {
    if (this.data.noMore || this.data.loading) return
    this._loadMore()
  },

  _today() {
    const d = new Date()
    const p = (n) => (n < 10 ? '0' + n : '' + n)
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
  },

  _fmt(d) {
    const p = (n) => (n < 10 ? '0' + n : '' + n)
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
  },

  _refreshDateText() {
    const today = this._today()
    this.setData({ dateText: this.data.dateText || today, maxDate: today })
  },

  onDateChange(e) {
    const v = e.detail.value
    if (!v || v === this.data.dateText) return
    this.setData({ dateText: v })
    this._loadSummary()
    this._resetList()
  },

  _loadSummary() {
    api.attendance.summary({
      type: 'day',
      date: this.data.dateText || this._today(),
    }).then((r) => {
      if (r && r.success) {
        const s = r.data || {}
        this.setData({
          summary: {
            shouldArrive: s.shouldArrive != null ? s.shouldArrive : s.V应到,
            arrived: s.arrived,
            notArrived: s.notArrived,
            late: s.late,
            seriousLate: s.seriousLate,
            lateThreshold: s.lateThreshold,
            seriousLateThreshold: s.seriousLateThreshold,
            rangeText: s.rangeText,
          },
        })
      }
    }).catch((err) => {
      console.error('summary load fail', err)
    })
  },

  _query(page) {
    const p = {
      page: page,
      pageSize: this.data.pageSize,
      order: 'asc',
      type: 'day',
      date: this.data.dateText || this._today(),
    }
    if (this.data.filterName) p.name = this.data.filterName
    if (this.data.filterSourceIdx > 0) p.source = sourceOptions[this.data.filterSourceIdx]
    if (this.data.personalUserId) p.userId = this.data.personalUserId
    return p
  },

  _resetList(done) {
    this.setData({ list: [], page: 1, total: 0, noMore: false, error: '' })
    this._inited = true
    this._loadList(done)
  },

  _loadMore() {
    this._loadList(null, true)
  },

  _loadList(done, append) {
    if (this.data.loading || this._destroyed) return
    this.setData({ loading: true, error: '' })
    const page = append ? this.data.page + 1 : 1
    api.attendance.list(this._query(page))
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
        const next = (append ? this.data.list.concat(r.list) : r.list).map((it) => ({
          ...it,
          faceSrc: it.hasFaceImg ? api.attendance.imageUrlById(it.id, 'face') : '',
        }))
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

  avatarUrl(filePath) {
    return filePath ? api.attendance.imageUrl(filePath) : ''
  },

  onPreview(e) {
    const id = e.currentTarget.dataset.id
    const type = e.currentTarget.dataset.type || 'frame'
    if (!id) return
    // 按考勤记录 id + 类型取图, 免去前端传中文路径
    this.setData({
      viewerShow: true,
      viewerUrl: api.attendance.imageUrlById(id, type),
      viewerScale: 1,
      viewerRotate: 0,
      viewerX: 0,
      viewerY: 0,
      viewerAnim: false,
    })
  },

  onViewerClose() {
    this.setData({ viewerShow: false })
  },

  onViewerRotate() {
    this.setData({ viewerRotate: (this.data.viewerRotate + 90) % 360, viewerAnim: true })
  },

  // ===== 放大层自定义手势: 单指拖动 + 双指缩放（同 js_rlgl max_image）=====
  onViewerTouchStart(e) {
    const t = e.touches
    const pt = (this._pt = this._pt || {})
    this.setData({ viewerAnim: false })
    if (t.length >= 2) {
      pt.mode = 'pinch'
      pt.startDist = touchDist(t[0], t[1])
      pt.baseScale = this.data.viewerScale
    } else {
      const p = t[0]
      pt.mode = 'pan'
      pt.startX = p.clientX
      pt.startY = p.clientY
      pt.baseX = this.data.viewerX
      pt.baseY = this.data.viewerY
    }
  },

  onViewerTouchMove(e) {
    const pt = this._pt
    if (!pt) return
    const t = e.touches
    if (t.length >= 2) {
      const d = touchDist(t[0], t[1])
      const s = pt.baseScale * (d / (pt.startDist || d))
      this.setData({ viewerScale: Math.max(1, Math.min(4, s)) })
    } else if (t.length === 1) {
      if (pt.mode !== 'pan') {
        // 双指松一根 -> 切回单指拖动, 重新打底避免跳变
        pt.mode = 'pan'
        pt.startX = t[0].clientX
        pt.startY = t[0].clientY
        pt.baseX = this.data.viewerX
        pt.baseY = this.data.viewerY
      }
      const dx = t[0].clientX - pt.startX
      const dy = t[0].clientY - pt.startY
      this.setData({ viewerX: pt.baseX + dx, viewerY: pt.baseY + dy })
    }
  },

  onViewerTouchEnd(e) {
    const pt = this._pt
    if (!pt) return
    if (e.touches.length === 0) {
      this._pt = null
    } else if (e.touches.length === 1) {
      // 还剩一根手指(双指松开一根): 切回 pan 并打底
      pt.mode = 'pan'
      pt.startX = e.touches[0].clientX
      pt.startY = e.touches[0].clientY
      pt.baseX = this.data.viewerX
      pt.baseY = this.data.viewerY
    }
  },

  onFilterOpen() {
    this.setData({
      drawerShow: true,
      tempName: this.data.filterName,
      tempSourceIdx: this.data.filterSourceIdx,
    })
  },

  onMaskTap() {
    this.setData({ drawerShow: false })
  },

  onNameInput(e) {
    this.setData({ tempName: e.detail.value })
  },

  onSourceChange(e) {
    this.setData({ tempSourceIdx: Number(e.detail.value) })
  },

  onFilterReset() {
    this.setData({ tempName: '', tempSourceIdx: 0 })
  },

  onFilterApply() {
    this.setData({
      drawerShow: false,
      filterName: this.data.tempName,
      filterSourceIdx: this.data.tempSourceIdx,
    })
    this._loadSummary()
    this._resetList()
  },

  onStopPropagation() {},
})

// 两指间距（同 js_rlgl max_image）
function touchDist(a, b) {
  const dx = a.clientX - b.clientX
  const dy = a.clientY - b.clientY
  return Math.sqrt(dx * dx + dy * dy)
}
