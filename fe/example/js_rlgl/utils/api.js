// 抓拍记录/人脸库 API 封装(原生小程序, 不依赖 uni-app 运行时)
// 履历:
//   2026-07-25 新增: 以 mp-weixin 的 faceRecordsApi/faceLibraryWxApi 为参考, 实现原生 wx.request 封装; 鉴权用 config 本地数据的 token(Bearer); 抓拍图相对路径拼接 BASE 后由 downloadFile 带鉴权下载为临时文件
const config = require('../config.js')

const BASE = `https://${config.host}`

// 取本地数据中的 token, 组装鉴权头(同时带 Cookie 与 Authorization, 与后端/auth 约定一致)
function authHeaders() {
  const { token } = config.读取本地数据()
  const h = { 'content-type': 'application/json' }
  if (token) {
    h.Cookie = `token=${token}`
    h.Authorization = `Bearer ${token}`
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

function request({ url, method = 'GET', data = {}, params = {} }) {
  return new Promise((resolve, reject) => {
    wx.request({
      url: buildUrl(url, params),
      method,
      data,
      header: authHeaders(),
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
  return { ok: true, message: '', list: Array.isArray(rows) ? rows : [], total: Number(data.total != null ? data.total : 0) || 0 }
}

const faceRecords = {
  // 抓拍记录列表
  list(params = {}) {
    return request({ url: '/dd/face-records', method: 'GET', params }).then(unwrapList)
  },
  // 抓拍图展示地址: 绝对/本地/内联直接返回; 相对路径拼 BASE 成绝对地址(<image> 网络图需绝对地址)
  imageUrl(filePath) {
    const path = String(filePath || '').trim()
    if (!path) return ''
    if (/^https?:\/\//i.test(path) || path.indexOf('wxfile://') === 0 || path.indexOf('data:') === 0) return path
    return `${BASE}/dd/face-records/image?path=${encodeURIComponent(path)}`
  },
}

const faceLibrary = {
  // 从抓拍记录加入人脸库
  addFromRecord(data) {
    return request({ url: '/dd/face-library/wx-from-record', method: 'POST', data })
  },
}

module.exports = { BASE, authHeaders, faceRecords, faceLibrary }

/*

## 获取人脸记录列表

**GET** `/dd/face-records`

分页查询人脸抓拍记录，筛选、搜索、分页均由后端完成。

### 请求参数（Query）

| 参数名 | 类型 | 必填 | 默认值 | 说明 |
|--------|------|------|--------|------|
| page | number | 否 | `1` | 页码，从 1 开始 |
| pageSize | number | 否 | `20` | 每页条数 |
| faceLibrary | string | 否 | — | 人员类型精确匹配 |
| name | string | 否 | — | 姓名，模糊匹配 |
| employeeNo | string | 否 | — | 工号，模糊匹配 |
| phone | string | 否 | — | 电话号码，模糊匹配 |
| idCard | string | 否 | — | 身份证号，模糊匹配 |
| alias | string | 否 | — | 抓拍摄像头别名，模糊匹配 |
| startTime | string | 否 | — | 抓拍时间起始，`yyyy-MM-dd HH:mm:ss` |
| endTime | string | 否 | — | 抓拍时间结束，`yyyy-MM-dd HH:mm:ss` |

**筛选逻辑：** 各条件 AND 组合；`faceLibrary` 精确匹配；文本字段模糊匹配；时间闭区间 `time >= startTime AND time <= endTime`；默认按 `time` 降序。

### 请求示例

```
GET /dd/face-records?page=1&pageSize=20&faceLibrary=whitelist&name=张&alias=大门&startTime=2026-07-01%2000:00:00&endTime=2026-07-08%2023:59:59
```

### 响应示例

```json
{
  "code": 200,
  "success": true,
  "message": "查询成功",
  "data": {
    "list": [
      {
        "id": 1001,
        "name": "林佩传",
        "alias": "大门摄像头",
        "time": "2026-07-08 14:32:15",
        "faceLibrary": "whitelist",
        "employeeNo": "02473565382326135214",
        "jpeg_url_face": "http://192.168.88.189:8899/static/faces/1001_face.jpg",
        "jpeg_url_body": "http://192.168.88.189:8899/static/faces/1001_body.jpg",
        "faceLibraryPersonId": 26
      }
    ],
    "total": 156,
    "page": 1,
    "pageSize": 20
  }
}
```

> `faceLibraryPersonId` 为新增字段（**【待实现】**）。未关联人脸库人员时返回 `null`。

---

*/
