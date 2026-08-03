// 登录态校验模块(原生小程序)
// 履历:
//   2026-08-03 修复: 确保Token 异步回调加 page._destroyed 判活, 避免页面卸载后 setData 触发 __subPageFrameEndTime__ 内部错误
//   2026-08-03 新增: 从原 page/index 内联 确保Token 抽取为公共模块, 供 kaoqin/staff 等页面复用
const config = require('../config.js')
const api = require('./api.js')

const TOKEN_EXPIRE_THRESHOLD = 36000 // 秒(10 小时), 低于此视为快过期

// 自包含 base64url 解码 UTF-8(解析 JWT payload)
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
    if (b < 0x80) str += String.fromCharCode(b)
    else if (b >= 0xc0 && b < 0xe0) str += String.fromCharCode(((b & 0x1f) << 6) | (bytes[++i] & 0x3f))
    else {
      const cp = ((b & 0x0f) << 12) | ((bytes[++i] & 0x3f) << 6) | (bytes[++i] & 0x3f)
      if (cp >= 0x10000) str += String.fromCharCode(0xd800 + ((cp - 0x10000) >> 10), 0xdc00 + ((cp - 0x10000) & 0x3ff))
      else str += String.fromCharCode(cp)
    }
  }
  return str
}

function 取Token过期时间(token) {
  if (!token || token.indexOf('.') < 0) return 0
  try {
    const payload = JSON.parse(base64Url解码(token.split('.')[1]))
    return payload.exp || 0
  } catch (e) { return 0 }
}

// 确保Token(page): 校验登录态, 必要时用本地账号密码重新登录, 成功后刷新页面 token 缓存并触发加载
//   page 需提供: _resetList() 加载方法(本模块在登录态 OK 后调用)
//   注意: 读取本地数据为异步, 回调时页面可能已销毁; 统一用 page._destroyed 判活, 避免向已卸载页 setData
function 确保Token(page) {
  config.读取本地数据异步().then((data) => {
    if (page._destroyed) return
    const { 用户名, 密码, token } = data
    page.setData({ token })
    api.setToken(token)
    if (!用户名 || !密码) {
      wx.redirectTo({ url: '/page/login/login' })
      return
    }
    const now = Math.floor(Date.now() / 1000)
    const exp = 取Token过期时间(token)
    const 即将过期 = !token || exp === 0 || (exp - now) <= TOKEN_EXPIRE_THRESHOLD
    if (!即将过期) {
      if (page._loadSummary) page._loadSummary()
      if (page._resetList) page._resetList()
      return
    }
    config.登录(用户名, 密码)
      .then((res) => {
        if (page._destroyed) return
        api.setToken(res.token)
        page.setData({ token: res.token })
        if (page._loadSummary) page._loadSummary()
        if (page._resetList) page._resetList()
      })
      .catch((e) => {
        if (page._destroyed) return
        wx.showToast({ title: '登录失败: ' + ((e && e.message) || '未知错误'), icon: 'none' })
        page.setData({ error: '登录失败' })
      })
  })
}

module.exports = { 确保Token }
