// 考勤系统 API 封装(原生小程序, 不依赖 uni-app 运行时)
// 履历:
//   2026-08-03 改造为考勤系统: 移除 faceRecords/faceLibrary(抓拍/人脸库已弃用), 新增 attendance(考勤明细/统计/图片) 与 staff(钉钉人员) 封装
//   2026-07-25 新增: 以 mp-weixin 的 faceRecordsApi/faceLibraryWxApi 为参考, 实现原生 wx.request 封装; 鉴权用 config 本地数据的 token(Bearer)
//   2026-07-27 token 缓存化: 新增模块级 _tokenCache + setToken(), authHeaders() 优先用缓存, 不再每条请求都调 config.读取本地数据()
const config = require('../config.js')

const BASE = config.host // host 已含协议(见 config.js 环境列表: dev=http://, prod=https://)

// token 缓存: 小程序打开时由页面读取一次本地数据写入(见 page/index/index.js 确保Token), 后续所有请求复用,
// 不再每条请求都调 config.读取本地数据() 取 token(消除"每读一次头像/每发一条请求就读一次本地数据"的放大)
let _tokenCache = null

// 写入/刷新 token 缓存: 页面 onLoad/onShow 读一次本地数据后调用; 登录成功换发新 token 后再次调用更新
function setToken(token) {
  _tokenCache = (token != null && token !== '') ? token : null
}

// 取本地数据中的 token, 组装鉴权头(同时带 Cookie 与 Authorization, 与后端/auth 约定一致)
// 优先用 _tokenCache(页面写入一次, 全程复用); 未写入时惰性从 config 读一次并缓存(兜底, 保证首请求也能带鉴权)
// opts.contentType: 默认 application/json; 传 false 表示不设置 content-type(供 wx.uploadFile/multipart 使用)
function authHeaders(opts = {}) {
  if (_tokenCache == null) {
    _tokenCache = (config.读取本地数据().token) || null
  }
  const h = {}
  if (opts.contentType !== false) {
    h['content-type'] = opts.contentType || 'application/json'
  }
  if (_tokenCache) {
    h.Cookie = `token=${_tokenCache}`
    h.Authorization = `Bearer ${_tokenCache}`
  }
  return h
}

// 拼接完整 URL(相对路径拼 BASE, 并追加 query 参数)
function buildUrl(path, params) {
  const url0 = /^https?:\/\//i.test(path) ? path : `${BASE}${path.startsWith('/') ? path : '/' + path}`
  const pairs = Object.keys(params || {})
    .filter((k) => params[k] !== undefined && params[k] !== null && params[k] !== '')
    .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(params[k])}`)
  if (!pairs.length) return url0
  return `${url0}${url0.indexOf('?') >= 0 ? '&' : '?'}${pairs.join('&')}`
}

function request({ url, method = 'GET', data = {}, params = {}, timeout } = {}) {
  return new Promise((resolve, reject) => {
    wx.request({
      url: buildUrl(url, params),
      method,
      data,
      header: authHeaders(),
      timeout: timeout || undefined, // 微信 wx.request 上限 60000ms; 长任务(如摄像头全量同步)显式拉长
      success(res) {
        const body = res.data || {}
        if (res.statusCode >= 200 && res.statusCode < 300) resolve(body)
        else if (res.statusCode === 401) reject(new Error(body.message || '登录已过期，请重新登录'))
        else reject(new Error(body.message || body.msg || `请求失败(${res.statusCode})`))
      },
      fail(err) {
        reject(new Error((err && err.errMsg) || '网络请求失败'))
      },
    })
  })
}

// 统一解包列表返回: { ok, message, list, total }
function unwrapList(result) {
  if (!result || typeof result !== 'object') return { ok: false, message: '返回数据为空', list: [], total: 0 }
  if (result.success === false || (result.code != null && Number(result.code) !== 200)) {
    return { ok: false, message: result.message || result.msg || '查询失败', list: [], total: 0 }
  }
  const data = (result.data && typeof result.data === 'object') ? result.data : result
  const rows = data.list || data.records || data.items || []
  return { ok: true, message: '', list: Array.isArray(rows) ? rows : [], total: Number(data.total != null ? data.total : 0) || 0, meta: data }
}

// 考勤系统(小程序"考勤统计"tab)
const attendance = {
  // 考勤明细列表: 支持 order=asc 先到→最晚到 / userId 个人明细 / source 过滤
  list(params = {}) {
    return request({ url: '/dd/attendance', method: 'GET', params }).then(unwrapList)
  },
  // 统计(日/周/月): type=day/week/month, date=yyyy-MM-dd
  summary(params = {}) {
    return request({ url: '/dd/attendance/summary', method: 'GET', params })
  },
  // 头像/全景照地址: 后端 face_url/bg_url 为绝对路径, 经 /dd/attendance/image 代理
  imageUrl(filePath) {
    const path = String(filePath || '').trim()
    if (!path) return ''
    if (/^https?:\/\//i.test(path) || path.indexOf('wxfile://') === 0 || path.indexOf('data:') === 0) return path
    return `${BASE}/dd/attendance/image?path=${encodeURIComponent(path)}`
  },
  // 按考勤记录 id + 类型取图(免中文路径): type=face|body|frame
  imageUrlById(id, type) {
    const vId = Number(id) || 0
    if (!vId) return ''
    return `${BASE}/dd/attendance/image-by-id?id=${vId}&type=${type || 'frame'}`
  },
}

// 人员管理(小程序"人员管理"tab, 对标 PC face_dingtalk_staff.html)
const staff = {
  // 人员列表(姓名模糊 + 分页)
  list(params = {}) {
    return request({ url: '/dd/dingtalk-staff', method: 'GET', params }).then(unwrapList)
  },
}

// 统一响应解析: 兼容 wx.uploadFile(string) 与 wx.request(parsed object)
//   成功 = statusCode 2xx 且 body.success !== false 且 (body.code 为空 或 ===200)
function parseResp(res) {
  let body = res.data
  if (typeof body === 'string') {
    try { body = JSON.parse(body) } catch (e) { body = {} }
  }
  const ok = res.statusCode >= 200 && res.statusCode < 300 &&
    body.success !== false && (body.code == null || Number(body.code) === 200)
  const err = ok ? null : new Error((body && (body.message || body.msg)) || `请求失败(${res.statusCode})`)
  return { ok, body, err }
}

// 上传文件(multipart)到指定路径: 文件字段名 photo, formData 为其它表单字段
//   header 不带 content-type(由微信自动设 multipart boundary), 避免 application/json 污染导致后端 PostForm 读不到字段
function uploadFileTo(path, formData, filePath) {
  return new Promise((resolve, reject) => {
    wx.uploadFile({
      url: `${BASE}${path}`,
      filePath,
      name: 'photo',
      formData: formData || {},
      header: authHeaders({ contentType: false }),
      success: (res) => {
        const r = parseResp(res)
        if (r.ok) resolve(r.body)
        else reject(r.err)
      },
      fail: (err) => reject(new Error((err && err.errMsg) || '网络请求失败')),
    })
  })
}

// 考勤系统 API 封装(原生小程序, 不依赖 uni-app 运行时)
// 履历:
//   2026-08-03 改造为考勤系统: 移除 faceRecords/faceLibrary(抓拍/人脸库已弃用), 新增 attendance(考勤明细/统计/图片) 与 staff(钉钉人员) 封装
module.exports = { BASE, authHeaders, setToken, attendance, staff }
