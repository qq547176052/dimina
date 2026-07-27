// page/face/face.js
// 简介: 人脸库列表页(tab 之二): 筛选/分页列表、同步、新增入口、行内编辑/删除; 风格参考 page/index
// 履历:
//   2026-07-27 新建: 列表(姓名/类型/部门 筛选 + 分页上拉加载)、行操作 action sheet(编辑/删除)、
//             同步按钮(发起全量同步并轮询状态)、FAB 新增跳转 face-edit; 人脸照经 wx.downloadFile 带鉴权取临时文件
//   2026-07-27 头像改直显: 后端 list 现直出摄像头照片直链 photoUrl(已加白域名), 前端优先 <image> 直显(同 index 抓拍图),
//             去掉不可靠的 wx.downloadFile 主路径(后端域名未加白 downloadFile 合法域名导致拉不到)
//   2026-07-27 头像修正: 实测人脸库相机 IP(192.168.88.233)未加白到 image 合法域名, 直链 <image> 拉不到(列表期间无 /image 请求);
//             改回后端代理 + wx.downloadFile(同 face-edit 回填预览, 后端域名已验证可用); 移除未用的 photoUrl 直显分支
//   2026-07-27 索引改 pid: normalizeRecord 增 pid(可靠主键); 跳转编辑/删除均传 pid, 删除走 camera 端点(api.faceLibraryCamera.remove),
//             不再以 name 为主键(避免重名/改名/非 ASCII 名传输丢字段)
//   2026-07-27 标题副行: 列表响应 data.cameraAlias 透传(第一台摄像头别名), 标题下方展示"当前操作摄像头"
//             后端 F摄像头人脸列表 在 data 返回 cameraIP/cameraAlias, api.unwrapList 透传 meta, 本页写入 cameraAlias
//   2026-07-27 交互改左滑删除: 列表项改为可左滑展开"删除"按钮(参考 admin_app/page/index 手势, 适配人脸库 pid 索引),
//             点击列表项直接进入编辑(去掉 action sheet); 顶栏"同步"前加"添加"按钮, 移除旧 FAB 悬浮加号
//   2026-07-27 pid-only: 列表项 wx:key 改 pid, swipe-item/删除按钮均挂 data-pid; onTapItem/确认删除 直接读
//             dataset.pid(不再用 name 反查), 重名也不会串号丢 pid; 没有 pid 直接提示无法编辑/删除
const config = require('../../config.js')
const api = require('../../utils/api.js')

const PAGE_SIZE = 20
// 左滑手势阈值(px): 闭合态左滑超过该值展开, 展开态从该位右拖超过该值收起
const SWIPE_OPEN_PX = 15
const SWIPE_CLOSE_PX = 15
// 人员类型筛选词典(含"全部"); 人脸库仅 4 类, 无陌生人
const FACE_LIBRARY_FILTER_OPTIONS = [
  { value: '', label: '全部' },
  { value: 'whitelist', label: '白名单' },
  { value: 'blacklist', label: '黑名单' },
  { value: 'vip', label: 'VIP' },
  { value: 'visitor', label: '访客' },
]
// 类型中文映射(标签展示)
const FACE_LIBRARY_MAP = {
  whitelist: '白名单',
  blacklist: '黑名单',
  vip: 'VIP',
  visitor: '访客',
}
// 类型标签配色(与 index 一致)
const FACE_LIBRARY_COLOR = {
  whitelist: '#07c160',
  blacklist: '#e64340',
  vip: '#f0883e',
  visitor: '#276ff5',
}
// 无图占位(内联 SVG, 不依赖外部资源)
const placeholderAvatar = 'data:image/svg+xml,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="72" height="72"><rect width="72" height="72" fill="#e5e7eb"/><text x="50%" y="52%" text-anchor="middle" fill="#9ca3af" font-size="12">无图</text></svg>'
)

// token 剩余有效期低于该秒数视为"快过期", 触发重新登录(10 小时)
const TOKEN_EXPIRE_THRESHOLD = 36000

// 自包含 base64url 解码为 UTF-8 字符串(解析 JWT payload)
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
function 取Token过期时间(token) {
  if (!token || token.indexOf('.') < 0) return 0
  try {
    const payload = JSON.parse(base64Url解码(token.split('.')[1]))
    return payload.exp || 0
  } catch (e) {
    return 0
  }
}

// 把一行原始记录规范化为列表项
function normalizeRecord(row) {
  if (!row || typeof row !== 'object') return null
  const faceLibrary = row.faceLibrary || ''
  const name = row.name || ''
  return {
    id: (row.id != null) ? row.id : '',
    pid: row.pid || '', // 人员唯一标识(可靠索引, 协议 /person/* 主键; 可能是 "name_xxx" 字符串)
    name,
    gender: row.gender || '',
    age: (row.age != null) ? row.age : '',
    idCard: row.idCard || '',
    faceLibrary,
    faceLibraryLabel: faceLibrary ? (FACE_LIBRARY_MAP[faceLibrary] || faceLibrary) : '-',
    faceLibraryColor: FACE_LIBRARY_COLOR[faceLibrary] || '#999',
    imageName: row.imageName || '',
    phone: row.phone || '',
    icCardNo: row.icCardNo || '',
    other: row.other || '',
    department: row.department || '',
    validityType: row.validityType || '',
    validityStartTime: row.validityStartTime || '',
    validityEndTime: row.validityEndTime || '',
    employeeNo: row.employeeNo || '',
    faceDisplayUrl: '', // 经 wx.downloadFile 带鉴权取临时文件后填入
    translateX: 0,      // 左滑位移(px), 由触摸手势写入; <0 表示已展开删除按钮
  }
}

Page({
  mixins: [require('../../mixin/common')],
  data: {
    list: [],
    token: '',
    loading: false,
    loadingMore: false,
    refreshing: false,
    loadError: '',
    cameraAlias: '', // 第一台摄像头别名(标题副行展示)
    page: 1,
    total: 0,
    hasMore: true,
    placeholderAvatar,
    faceLibraryFilterOptions: FACE_LIBRARY_FILTER_OPTIONS,
    filterTypeIndex: 0,
    filters: { name: '', faceLibrary: '', department: '' },
    filterOpen: false,
    filterCount: 0,
    // 同步弹窗
    syncOpen: false,
    syncing: false,
    syncMessage: '',
    syncCode: -1,
    // 左滑手势
    actionWidth: 0,   // 删除按钮区宽度(px), onShow 按屏幕宽度计算
    swipeLock: false, // 横向滑动进行中锁定滚动, 避免抢手势
  },
  onShow() {
    this.确保Token()
    try {
      const sys = (typeof wx.getSystemInfoSync === 'function') ? wx.getSystemInfoSync() : {}
      // 单删除按钮宽 160rpx → px
      this.setData({ actionWidth: Math.round((sys.windowWidth || 375) / 750 * 160) })
    } catch (e) { /* 计算失败用默认 0, 手势不展开 */ }
  },
  // 读取本地数据->校验账号密码与 token 有效期->必要时重新登录->加载列表
  确保Token() {
    const data = config.读取本地数据()
    const { 用户名, 密码, token } = data
    this.setData({ token })
    api.setToken(token)
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
    config.登录(用户名, 密码)
      .then((res) => {
        api.setToken(res.token)
        this.setData({ token: res.token })
        this.加载列表(true)
      })
      .catch((e) => {
        this.setData({ loadError: '登录失败: ' + (e && e.message || '未知错误'), list: [], loading: false, loadingMore: false, refreshing: false })
        wx.showToast({ title: this.data.loadError, icon: 'none' })
      })
  },
  // 加载人脸库列表(reset=true 重置分页/刷新)
  加载列表(reset) {
    if (reset) {
      this.setData({ page: 1, hasMore: true, loadError: '' })
    }
    if (!this.data.hasMore && !reset) return
    const isFirst = this.data.page === 1
    this.setData(isFirst ? { loading: true } : { loadingMore: true })
    api.faceLibraryCamera.list(Object.assign(
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
        // 第一台摄像头别名(后端列表 data.cameraAlias 透传): 标题副行展示
        const meta = payload.meta || {}
        this.setData({ cameraAlias: meta.cameraAlias || '' })
        this.setData({
          list,
          total: payload.total,
          hasMore,
          page: rows.length > 0 ? this.data.page + 1 : this.data.page,
        })
        rows.forEach((row) => this.加载人脸照(row))
      })
      .catch((err) => {
        this.setData({ loadError: (err && err.message) || '加载失败' })
        if (isFirst && !this.data.list.length) wx.showToast({ title: this.data.loadError, icon: 'none' })
      })
      .finally(() => this.setData({ loading: false, loadingMore: false, refreshing: false }))
  },
  // 按 name 定位更新展示图
  设置展示图(name, url) {
    const idx = this.data.list.findIndex((r) => r.name === name)
    if (idx < 0) return
    const list = this.data.list.slice()
    list[idx] = Object.assign({}, list[idx], { faceDisplayUrl: url })
    this.setData({ list })
  },
  // 人脸照: 经后端代理 + wx.downloadFile 带鉴权取临时文件(同 face-edit 回填预览, 后端域名已加白);
  //   注: 摄像头直链 photoUrl(http://相机IP/...) 在本环境未加白到 image 合法域名, <image> 直拉会失败,
  //       故统一走后端代理(已在 edit 页验证可用), 不直接用直链
  加载人脸照(item) {
    const path = item.imageName
    if (!path || !item.name) return
    wx.downloadFile({
      url: api.faceLibraryCamera.imageUrl(path),
      header: api.authHeaders(),
      success: (res) => {
        if (res.statusCode === 200 && res.tempFilePath) this.设置展示图(item.name, res.tempFilePath)
      },
      fail: () => { /* 下载失败保持占位 */ },
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
  // 由 data.filters 拼接后端查询参数(空值不发送)
  构建筛选参数() {
    const f = this.data.filters
    const p = {}
    if (f.name) p.name = f.name
    if (f.faceLibrary) p.faceLibrary = f.faceLibrary
    if (f.department) p.department = f.department
    return p
  },
  // ===== 筛选抽屉 =====
  openFilter() { this.setData({ filterOpen: true }) },
  closeFilter() { this.setData({ filterOpen: false }) },
  noop() {},
  onFilterInput(e) {
    const field = e.currentTarget.dataset.field
    this.setData({ ['filters.' + field]: e.detail.value })
  },
  onFilterTypePick(e) {
    const idx = Number(e.detail.value) || 0
    this.setData({ filterTypeIndex: idx, 'filters.faceLibrary': FACE_LIBRARY_FILTER_OPTIONS[idx].value })
  },
  resetFilter() {
    this.setData({ filters: { name: '', faceLibrary: '', department: '' }, filterTypeIndex: 0 })
  },
  applyFilter() {
    const f = this.data.filters
    let count = 0
    ;['name', 'faceLibrary', 'department'].forEach((k) => { if (f[k]) count++ })
    this.setData({ filterCount: count, filterOpen: false })
    this.加载列表(true)
  },
  // ===== 列表项左滑: 删除(参考 admin_app/page/index 手势实现, 适配人脸库列表) =====
  // 直接由 touch 事件(clientX/Y 差)计算位移写回 item.translateX, 不依赖 movable-view
  onSwipeTouchStart(e) {
    const t = e.touches[0]
    this._sx = t ? t.clientX : 0
    this._sy = t ? t.clientY : 0
    this._startTranslate = this._lookupTranslateX(e.currentTarget.dataset.name)
    this._swipeWasOpen = this._startTranslate < 0
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
    if (this._dir === null && (Math.abs(dx) > 8 || Math.abs(dy) > 8)) {
      this._dir = Math.abs(dx) > Math.abs(dy) ? 'h' : 'v'
      if (this._dir === 'h' && !this.data.swipeLock) this.setData({ swipeLock: true })
    }
    if (this._dir !== 'h') return // 纵向滚动或尚未确定: 交回原生滚动
    const name = e.currentTarget.dataset.name
    this._curX = Math.max(-this.data.actionWidth, Math.min(0, this._startTranslate + dx))
    this._setItemTranslateX(name, this._curX)
  },
  onSwipeTouchEnd(e) {
    const name = e.currentTarget.dataset.name
    if (this.data.swipeLock) this.setData({ swipeLock: false })
    if (this._dir === 'h') {
      const { actionWidth } = this.data
      const x = typeof this._curX === 'number' ? this._curX : 0
      const target = this._startTranslate < 0
        ? (x > this._startTranslate + SWIPE_CLOSE_PX ? 0 : -actionWidth)
        : (x < -SWIPE_OPEN_PX ? -actionWidth : 0)
      if (target < 0) this._closeOthers(name)
      this._setItemTranslateX(name, target)
      this._dir = null
      return
    }
    this._dir = null
  },
  onSwipeTap(e) {
    if (this._moved) return // 滑动/滚动后补发的 tap 不触发
    const hasOpen = this.data.list.some((it) => it.translateX < 0)
    if (hasOpen) { this._closeAllSwipes(); return }
    this.onTapItem(e)
  },
  // 点击列表项直接进编辑(pid 唯一索引, 不再用 name 反查避免重名串号)
  onTapItem(e) {
    const ds = e.currentTarget.dataset
    const name = ds.name
    const pid = ds.pid
    if (!pid) {
      wx.showToast({ title: '该人员缺少标识(pid)，无法编辑', icon: 'none' })
      return
    }
    this.跳转编辑(name, pid)
  },
  _lookupTranslateX(name) {
    const it = this.data.list.find((x) => x.name === name)
    return it ? it.translateX : 0
  },
  _setItemTranslateX(name, x) {
    const i = this.data.list.findIndex((it) => it.name === name)
    if (i >= 0) this.setData({ ['list[' + i + '].translateX']: x })
  },
  _closeAllSwipes() {
    if (!this.data.list.some((it) => it.translateX < 0)) return
    this.setData({ list: this.data.list.map((it) => ({ ...it, translateX: 0 })) })
  },
  _closeOthers(exceptName) {
    this.setData({ list: this.data.list.map((it) => (it.name !== exceptName && it.translateX < 0 ? { ...it, translateX: 0 } : it)) })
  },
  // 点击列表空白区域: 有展开则收起
  onListTap() {
    const hasOpen = this.data.list.some((it) => it.translateX < 0)
    if (hasOpen) this._closeAllSwipes()
  },
  // 列表滚动时自动收起展开项
  onListScroll() {
    const hasOpen = this.data.list.some((it) => it.translateX < 0)
    if (hasOpen) this._closeAllSwipes()
  },
  // FAB/顶栏 新增
  onAdd() {
    wx.navigateTo({ url: '/page/face/face-edit?mode=add' })
  },
  跳转编辑(name, pid) {
    wx.navigateTo({ url: '/page/face/face-edit?mode=edit&name=' + encodeURIComponent(name) + '&pid=' + encodeURIComponent(pid || '') })
  },
  确认删除(e) {
    const ds = (typeof e === 'string') ? {} : e.currentTarget.dataset
    const name = (typeof e === 'string') ? e : ds.name
    const pid = (typeof e === 'string') ? '' : ds.pid
    this._closeAllSwipes()
    wx.showModal({
      title: '删除确认',
      content: `确定从人脸库删除「${name}」吗？\n将同时删除所有摄像头中的该人员。`,
      confirmText: '删除',
      confirmColor: '#e64340',
      success: (res) => {
        if (!res.confirm) return
        wx.showLoading({ title: '删除中...', mask: true })
        api.faceLibraryCamera.remove(pid, '')
          .then(() => {
            wx.showToast({ title: '已删除', icon: 'success' })
            this.加载列表(true)
          })
          .catch((err) => {
            wx.showToast({ title: (err && err.message) || '删除失败', icon: 'none' })
          })
          .finally(() => wx.hideLoading())
      },
    })
  },
  // ===== 同步弹窗 =====
  openSync() {
    this.setData({ syncOpen: true, syncing: false, syncMessage: '', syncCode: -1 })
  },
  closeSync() {
    this.setData({ syncOpen: false, syncing: false })
  },
  stopPropagation() {},
  // 发起全量同步并轮询状态(data.code: 0成功/1同步中/2异常)
  开始同步() {
    if (this.data.syncing) return
    this.setData({ syncing: true, syncMessage: '正在发起同步...', syncCode: 1 })
    api.faceLibrary.syncStart()
      .then(() => this.轮询同步())
      .catch((err) => {
        this.setData({ syncing: false, syncMessage: (err && err.message) || '同步发起失败', syncCode: 2 })
      })
  },
  轮询同步() {
    if (!this.data.syncing) return
    api.faceLibrary.syncStatus()
      .then((res) => {
        const body = res || {}
        const code = (body.data && typeof body.data === 'object') ? Number(body.data.code) : (body.code != null ? Number(body.code) : -1)
        const msg = body.message || ''
        if (code === 0) {
          this.setData({ syncing: false, syncMessage: '同步成功', syncCode: 0 })
          this.加载列表(true)
          return
        }
        if (code === 2) {
          this.setData({ syncing: false, syncMessage: (msg || '同步异常'), syncCode: 2 })
          return
        }
        // 1 同步中: 继续轮询
        this.setData({ syncMessage: (msg || '同步中...'), syncCode: 1 })
        setTimeout(() => this.轮询同步(), 2500)
      })
      .catch((err) => {
        this.setData({ syncing: false, syncMessage: (err && err.message) || '查询同步状态失败', syncCode: 2 })
      })
  },
})
