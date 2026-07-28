// utils/base64.js
// 简介: 纯 JS 实现的标准 Base64 编解码(无第三方依赖, 不依赖宿主 btoa/atob/wx.* 环境 API).
//       用于跨页传参时把 UTF-8 JSON 编码为仅含 URI 安全字符的串, 规避 query 传输造成的二次 URL 编码.
// 履历:
//   2026-07-28 新增: index(onItemTap) 与 max_image(onLoad) 跨页传 payload 用; 配套 utf8ToBase64 / base64ToUtf8
//             与 index 已有的 base64Url解码(供 JWT) 思路一致, 均为手写实现以适配 dimina 自定义运行时(缺标准 base64 API)
const B64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
const B64_LUT = (function () {
  const lut = {}
  for (let i = 0; i < B64_CHARS.length; i++) lut[B64_CHARS[i]] = i
  return lut
})()

// 字符串 -> UTF-8 字节数组(支持多字节/代理对, 与 sha256 同一套编码)
function strToUtf8Bytes(str) {
  const bytes = []
  for (let i = 0; i < str.length; i++) {
    let c = str.charCodeAt(i)
    if (c < 0x80) {
      bytes.push(c)
    } else if (c < 0x800) {
      bytes.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f))
    } else if (c >= 0xd800 && c <= 0xdbff) {
      const c2 = str.charCodeAt(++i)
      const cp = 0x10000 + ((c & 0x3ff) << 10) + (c2 & 0x3ff)
      bytes.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3f), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f))
    } else {
      bytes.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f))
    }
  }
  return bytes
}

// UTF-8 字节数组 -> 字符串(支持多字节/代理对)
function utf8BytesToStr(bytes) {
  let str = ''
  let i = 0
  while (i < bytes.length) {
    const b = bytes[i++]
    if (b < 0x80) {
      str += String.fromCharCode(b)
    } else if (b >= 0xc0 && b < 0xe0) {
      const b2 = bytes[i++]
      str += String.fromCharCode(((b & 0x1f) << 6) | (b2 & 0x3f))
    } else if (b >= 0xe0 && b < 0xf0) {
      const b2 = bytes[i++]
      const b3 = bytes[i++]
      str += String.fromCharCode(((b & 0x0f) << 12) | ((b2 & 0x3f) << 6) | (b3 & 0x3f))
    } else {
      const b2 = bytes[i++]
      const b3 = bytes[i++]
      const b4 = bytes[i++]
      let cp = ((b & 0x07) << 18) | ((b2 & 0x3f) << 12) | ((b3 & 0x3f) << 6) | (b4 & 0x3f)
      cp -= 0x10000
      str += String.fromCharCode(0xd800 + ((cp >> 10) & 0x3ff), 0xdc00 + (cp & 0x3ff))
    }
  }
  return str
}

// UTF-8 字节数组 -> 标准 Base64(含 + / =, 调用方按需 encodeURIComponent)
function bytesToB64(bytes) {
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i]
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : 0
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : 0
    const n = (b0 << 16) | (b1 << 8) | b2
    out += B64_CHARS[(n >> 18) & 0x3f]
    out += B64_CHARS[(n >> 12) & 0x3f]
    out += i + 1 < bytes.length ? B64_CHARS[(n >> 6) & 0x3f] : '='
    out += i + 2 < bytes.length ? B64_CHARS[n & 0x3f] : '='
  }
  return out
}

// 标准 Base64 -> UTF-8 字节数组(忽略尾部 =); 按每组实际有效字符数输出字节, 避免填充位多吐垃圾字节
function b64ToBytes(b64) {
  const s = String(b64).replace(/=+$/, '')
  const bytes = []
  for (let i = 0; i < s.length; i += 4) {
    const c0 = B64_LUT[s[i]]
    const c1 = B64_LUT[s[i + 1]]
    const c2 = B64_LUT[s[i + 2]]
    const c3 = B64_LUT[s[i + 3]]
    const n = (c0 << 18) | (c1 << 12) | ((c2 || 0) << 6) | (c3 || 0)
    bytes.push((n >> 16) & 0xff)
    if (c2 !== undefined) bytes.push((n >> 8) & 0xff)
    if (c3 !== undefined) bytes.push(n & 0xff)
  }
  return bytes
}

// UTF-8 字符串 -> 标准 Base64
function utf8ToBase64(str) {
  return bytesToB64(strToUtf8Bytes(str))
}

// 标准 Base64 -> UTF-8 字符串
function base64ToUtf8(b64) {
  return utf8BytesToStr(b64ToBytes(b64))
}

module.exports = { utf8ToBase64, base64ToUtf8 }
