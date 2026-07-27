// 抓拍记录 tab 页: 人脸抓拍记录列表(参考 mp-weixin/pages/face-records); 保留 ensureToken 校验登录态
// 履历:
//   2026-07-25 清空小程序: 首页由 example/index 迁移至 page/index, 作为底部 tab 抓拍记录; token 校验/无账号跳转登录页
//   2026-07-25 以 mp-weixin/pages/face-records 为参考, 改造成人脸抓拍记录列表: 分页加载/下拉刷新/上拉加载更多/抓拍图下载/点击记录"添加人脸库"入库; 数据键全部 ASCII 命名(避开 WXML 中文标识符报错)
//   2026-07-27 筛选时间默认初始化为当前日期: startTime=今天(拼 00:00:00)、endTime=今天(拼 23:59:59), 打开即按"今天 0 点~今天"筛选, 无需手动选
//   2026-07-27 token 改为打开时读一次(确保Token 读本地数据写入 this.data.token 与 api.setToken 缓存), 后续所有请求经 api.authHeaders 复用缓存, 不再每条请求(尤其每读一张抓拍图)都读本地数据; 登录换发新 token 后同步刷新 data 与 api 缓存
const config = require('../../config.js')
const api = require('../../utils/api.js')

const PAGE_SIZE = 20
// 右侧筛选抽屉手势阈值(px): 页面右到左滑超阈值开; 抽屉内左到右滑超阈值关
const DRAWER_EDGE_PX = 15
const DRAWER_CLOSE_PX = 15
// 人员类型筛选词典(含"全部")
const FACE_LIBRARY_FILTER_OPTIONS = [
  { value: '', label: '全部' },
  { value: 'whitelist', label: '白名单' },
  { value: 'blacklist', label: '黑名单' },
  { value: 'vip', label: 'VIP名单' },
  { value: 'visitor', label: '访客' },
  { value: 'stranger', label: '陌生人' },
]
// 人员类型词典(抓拍记录/人脸库共用)
const FACE_LIBRARY_MAP = {
  whitelist: '白名单',
  blacklist: '黑名单',
  vip: 'VIP名单',
  visitor: '访客',
  stranger: '陌生人',
}
const faceLibraryOptions = [
  { value: 'whitelist', label: '白名单' },
  { value: 'blacklist', label: '黑名单' },
  { value: 'vip', label: 'VIP名单' },
  { value: 'visitor', label: '访客' },
]
// 无图占位(内联 SVG, 不依赖外部资源)
const placeholderAvatar = 'data:image/svg+xml,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="72" height="72"><rect width="72" height="72" fill="#e5e7eb"/><text x="50%" y="52%" text-anchor="middle" fill="#9ca3af" font-size="12">无图</text></svg>'
)

// token 剩余有效期低于该秒数视为"快过期", 触发重新登录(10 小时)
const TOKEN_EXPIRE_THRESHOLD = 36000

// 自包含 base64url 解码为 UTF-8 字符串(解析 JWT payload, 不依赖宿主环境 API)
function base64Url解码(text) {
  const b64 = text.replace(/-/g, '+').replace(/_/g, '/')
  const pad = b64.length % 4 === 0 ? 0 : 4 - (b64.length % 4)
  const s = b64 + '='.repeat(pad)
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
  const lut = {}
  for (let i = 0; i < chars.length; i++) lut[chars[i]] = i
  const bytes = []
  for (let i = 0; i < s.length; i += 4) {
    const n = (lut[s[i]] << 18) | (lut[s[i + 1]] << 12) | (lut[s[i + 2]] << 6) | lut[s[i + 3]]
    bytes.push((n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff)
  }
  if (pad === 1) bytes.length -= 1; else if (pad === 2) bytes.length -= 2
  let str = ''
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i]
    if (b < 0x80) {
      str += String.fromCharCode(b)
    } else if (b >= 0xc0 && b < 0xe0) {
      str += String.fromCharCode(((b & 0x1f) << 6) | (bytes[++i] & 0x3f))
    } else {
      const cp = ((b & 0x0f) << 12) | ((bytes[++i] & 0x3f) << 6) | (bytes[++i] & 0x3f)
      if (cp >= 0x10000) {
        str += String.fromCharCode(0xd800 + ((cp - 0x10000) >> 10), 0xdc00 + ((cp - 0x10000) & 0x3ff))
      } else {
        str += String.fromCharCode(cp)
      }
    }
  }
  return str
}

// 取 JWT payload 的 exp(秒级时间戳); 非 JWT 或解析失败返回 0
function 取Token过期时间(token) {
  if (!token || token.indexOf('.') < 0) return 0
  try {
    const payload = JSON.parse(base64Url解码(token.split('.')[1]))
    return payload.exp || 0
  } catch (e) {
    return 0
  }
}

// 当前日期 YYYY-MM-DD(本地时区), 用于筛选时间默认初始化(今天 00:00:00 ~ 23:59:59)
function 今天日期() {
  const d = new Date()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

// 把一行原始记录规范化为列表项
function normalizeRecord(row) {
  if (!row || typeof row !== 'object') return null
  const facePath = row.jpeg_url_face || row.jpegUrlFace || ''
  const alias = row.alias || row.cameraAlias || row.Alias || ''
  const cameraIp = row.camera_ip || row.cameraIp || ''
  const faceLibrary = row.faceLibrary || ''
  return {
    id: (row.id != null) ? row.id : row.ID,
    name: row.name || '',
    time: row.time || '',
    alias,
    cameraIp,
    cameraLabel: alias || cameraIp || '',
    faceLibrary,
    faceLibraryLabel: faceLibrary ? (FACE_LIBRARY_MAP[faceLibrary] || faceLibrary) : '-',
    jpeg_url_face: facePath,
    faceDisplayUrl: '',
  }
}

Page({
  mixins: [require('../../mixin/common')],
  data: {
    list: [],
    token: '',       // 鉴权 token(打开时由 确保Token 读一次本地数据写入, 后续请求复用, 不重复读本地)
    loading: false,
    loadingMore: false,
    refreshing: false,
    loadError: '',
    page: 1,
    total: 0,
    hasMore: true,
    formVisible: false,
    formName: '',
    formTypeIndex: 0,
    formPreviewUrl: '',
    formRecordId: '',
    submitting: false,
    placeholderAvatar,
    faceLibraryOptions,
    // 筛选条件(对应 /dd/face-records 查询参数)
    filters: {
      name: '',
      alias: '',
      faceLibrary: '',
      startTime: 今天日期(),
      endTime: 今天日期(),
    },
    filterTypeIndex: 0,
    faceLibraryFilterOptions: FACE_LIBRARY_FILTER_OPTIONS,
    filterOpen: false,
    filterCount: 0,
  },
  onLoad() {
    // 版本号: 优先取宿主注入的 appVersion, 无则回退兜底值
    const v = this.宿主版本()
    this.setData({ version: v })
  },
  onShow() {
    // 每次进入 tab 都校验登录态并刷新列表
    this.确保Token()
  },
  宿主版本() {
    let v = '1.0.0'
    try {
      const sys = (typeof wx.getSystemInfoSync === 'function') ? wx.getSystemInfoSync() : {}
      v = (sys && sys.appVersion) || v
    } catch (e) { /* 忽略 */ }
    return v
  },
  // 读取本地数据->校验账号密码与 token 有效期->必要时重新登录->加载列表
  确保Token() {
    const data = config.读取本地数据()
    const { 用户名, 密码, token } = data
    // 打开时读一次本地 token: 存页面 data + 写入 api 缓存, 后续所有请求直接复用, 不再每条请求读本地数据
    this.setData({ token })
    api.setToken(token)
    // 无用户名或密码: 跳转到登录页面
    if (!用户名 || !密码) {
      wx.redirectTo({ url: '/page/login/login' })
      return
    }
    const now = Math.floor(Date.now() / 1000)
    const exp = 取Token过期时间(token)
    const 即将过期 = !token || exp === 0 || (exp - now) <= TOKEN_EXPIRE_THRESHOLD
    if (!即将过期) {
      this.加载列表(true)
      return
    }
    // token 缺失或快过期: 用本地账号密码重新登录后再加载
    config.登录(用户名, 密码)
      .then((res) => {
        // 登录换发新 token: 同步刷新页面 data 与 api 缓存
        api.setToken(res.token)
        this.setData({ token: res.token })
        this.加载列表(true)
      })
      .catch((e) => {
        this.setData({ loadError: '登录失败: ' + (e && e.message || '未知错误'), list: [], loading: false, loadingMore: false, refreshing: false })
        wx.showToast({ title: this.data.loadError, icon: 'none' })
      })
  },
  // 加载抓拍记录列表(reset=true 重置分页/刷新)
  加载列表(reset) {
    if (reset) {
      this.setData({ page: 1, hasMore: true, loadError: '' })
    }
    if (!this.data.hasMore && !reset) return
    const isFirst = this.data.page === 1
    this.setData(isFirst ? { loading: true } : { loadingMore: true })
    api.faceRecords.list(Object.assign(
      { page: this.data.page, pageSize: PAGE_SIZE },
      this.构建筛选参数()
    ))
      .then((payload) => {
        if (!payload.ok) {
          this.setData({ loadError: payload.message || '加载失败' })
          if (isFirst) this.setData({ list: [] })
          wx.showToast({ title: this.data.loadError, icon: 'none' })
          return
        }
        const rows = payload.list.map(normalizeRecord).filter(Boolean)
        const list = isFirst ? rows : this.data.list.concat(rows)
        const hasMore = list.length < payload.total
        this.setData({
          list,
          total: payload.total,
          hasMore,
          page: rows.length > 0 ? this.data.page + 1 : this.data.page,
        })
        rows.forEach((row) => this.加载抓拍图(row))
      })
      .catch((err) => {
        this.setData({ loadError: (err && err.message) || '加载失败' })
        if (isFirst && !this.data.list.length) wx.showToast({ title: this.data.loadError, icon: 'none' })
      })
      .finally(() => this.setData({ loading: false, loadingMore: false, refreshing: false }))
  },
  // 更新某条记录的展示图(按 id 定位)
  设置展示图(recordId, url) {
    const idx = this.data.list.findIndex((r) => r.id === recordId)
    if (idx < 0) return
    const list = this.data.list.slice()
    list[idx] = Object.assign({}, list[idx], { faceDisplayUrl: url })
    this.setData({ list })
  },
  // 加载抓拍图: 绝对/本地/内联直接展示; 相对路径需带鉴权下载为临时文件
  加载抓拍图(item) {
    const path = item.jpeg_url_face
    if (!path || item.id == null) return
    if (/^https?:\/\//i.test(path) || path.indexOf('wxfile://') === 0) {
      this.设置展示图(item.id, path)
      return
    }
    wx.downloadFile({
      url: api.faceRecords.imageUrl(path),
      header: api.authHeaders(),
      success: (res) => {
        if (res.statusCode === 200 && res.tempFilePath) this.设置展示图(item.id, res.tempFilePath)
      },
      fail: () => { /* 抓拍图下载失败, 保持占位 */ },
    })
  },
  onRefresh() {
    this.setData({ refreshing: true })
    this.加载列表(true)
  },
  onLoadMore() {
    if (this.data.loading || this.data.loadingMore || !this.data.hasMore) return
    this.加载列表(false)
  },
  reloadList() {
    this.加载列表(true)
  },
  // 由 data.filters 拼接到后端的查询参数(空值不发送; 日期补足时分秒闭区间)
  构建筛选参数() {
    const f = this.data.filters
    const p = {}
    if (f.name) p.name = f.name
    if (f.alias) p.alias = f.alias
    if (f.faceLibrary) p.faceLibrary = f.faceLibrary
    if (f.startTime) p.startTime = f.startTime + ' 00:00:00'
    if (f.endTime) p.endTime = f.endTime + ' 23:59:59'
    return p
  },
  // ===== 筛选抽屉手势 =====
  // 页面级右到左滑(横向为主且位移超阈值)打开右侧筛选抽屉
  onPageTouchStart(e) {
    const t = e.touches[0]
    this._pageStartX = t ? t.clientX : 0
    this._pageStartY = t ? t.clientY : 0
  },
  onPageTouchEnd(e) {
    if (this.data.filterOpen) return
    const t = e.changedTouches && e.changedTouches[0]
    if (!t) return
    const dx = t.clientX - this._pageStartX
    const dy = t.clientY - this._pageStartY
    if (dx < -DRAWER_EDGE_PX && Math.abs(dx) > Math.abs(dy) * 1.5) this.openFilter()
  },
  openFilter() {
    this.setData({ filterOpen: true })
  },
  closeFilter() {
    this.setData({ filterOpen: false })
  },
  // 抽屉内左到右滑(横向为主且位移超阈值)关闭
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
    if (dx > DRAWER_CLOSE_PX && Math.abs(dx) > Math.abs(dy) * 1.5) this.closeFilter()
  },
  noop() { /* 阻止抽屉内部点击冒泡到遮罩关闭 */ },
  // ===== 筛选字段交互 =====
  onFilterInput(e) {
    const field = e.currentTarget.dataset.field
    this.setData({ ['filters.' + field]: e.detail.value })
  },
  onFilterTypePick(e) {
    const idx = Number(e.detail.value) || 0
    this.setData({ filterTypeIndex: idx, 'filters.faceLibrary': FACE_LIBRARY_FILTER_OPTIONS[idx].value })
  },
  onFilterDate(e) {
    const field = e.currentTarget.dataset.field
    this.setData({ ['filters.' + field]: e.detail.value })
  },
  resetFilter() {
    this.setData({
      filters: { name: '', alias: '', faceLibrary: '', startTime: '', endTime: '' },
      filterTypeIndex: 0,
    })
  },
  applyFilter() {
    const f = this.data.filters
    let count = 0
    ;['name', 'alias', 'faceLibrary', 'startTime', 'endTime'].forEach((k) => { if (f[k]) count++ })
    this.setData({ filterCount: count, filterOpen: false })
    this.加载列表(true)
  },
  // 打开"添加人脸库"弹窗
  onAdd(e) {
    const id = e.currentTarget.dataset.id
    const item = this.data.list.find((r) => r.id === id)
    if (!item) return
    const typeIdx = faceLibraryOptions.findIndex((o) => o.value === item.faceLibrary)
    this.setData({
      formVisible: true,
      formRecordId: item.id,
      formName: item.name || '',
      formTypeIndex: typeIdx >= 0 ? typeIdx : 0,
      formPreviewUrl: item.faceDisplayUrl || '',
    })
  },
  closeForm() {
    if (this.data.submitting) return
    this.setData({ formVisible: false, formRecordId: '' })
  },
  stopPropagation() { /* 阻止弹窗内部点击穿透关闭 */ },
  onNameInput(e) {
    this.setData({ formName: e.detail.value })
  },
  onTypePick(e) {
    this.setData({ formTypeIndex: Number(e.detail.value) || 0 })
  },
  // 提交入库
  submitAdd() {
    const recordId = this.data.formRecordId
    if (!recordId) {
      wx.showToast({ title: '记录无效', icon: 'none' })
      return
    }
    const name = String(this.data.formName || '').trim()
    if (!name) {
      wx.showToast({ title: '请填写姓名', icon: 'none' })
      return
    }
    const opt = this.data.faceLibraryOptions[this.data.formTypeIndex]
    const faceLibrary = opt && opt.value
    if (!faceLibrary) {
      wx.showToast({ title: '请选择人员类型', icon: 'none' })
      return
    }
    this.setData({ submitting: true })
    wx.showLoading({ title: '入库中...', mask: true })
    api.faceLibrary.addFromRecord({ id: recordId, name, faceLibrary })
      .then((res) => {
        if (res && res.success === false) throw new Error(res.message || res.msg || '入库失败')
        if (res && res.code != null && Number(res.code) !== 200) throw new Error(res.message || res.msg || '入库失败')
        wx.showToast({ title: (res && res.message) || '入库成功', icon: 'success' })
        this.setData({ formVisible: false, formRecordId: '' })
      })
      .catch((err) => {
        wx.showToast({ title: (err && err.message) || '入库失败', icon: 'none' })
      })
      .finally(() => {
        this.setData({ submitting: false })
        wx.hideLoading()
      })
  },
})
