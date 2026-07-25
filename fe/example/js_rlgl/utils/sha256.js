// utils/sha256.js
// 简介: 纯 JS 实现的 SHA-256(无第三方依赖), 用于小程序端对密码做哈希后再上报后端.
//       输入字符串按 UTF-8 编码, 返回 64 位十六进制小写串.
// 履历: 2026-07-25 由 admin_app/utils/sha256.js 复用至 js_rlgl(目录重组时该文件被误删, config.js 依赖它)
function sha256(message) {
  // 字符串转 UTF-8 字节(支持多字节/代理对)
  var bytes = []
  for (var i = 0; i < message.length; i++) {
    var c = message.charCodeAt(i)
    if (c < 0x80) {
      bytes.push(c)
    } else if (c < 0x800) {
      bytes.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f))
    } else if (c >= 0xd800 && c <= 0xdbff) {
      var c2 = message.charCodeAt(++i)
      var code = 0x10000 + ((c & 0x3ff) << 10) + (c2 & 0x3ff)
      bytes.push(
        0xf0 | (code >> 18),
        0x80 | ((code >> 12) & 0x3f),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f)
      )
    } else {
      bytes.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f))
    }
  }

  // 初始哈希值(前 8 个质数的平方根小数部分取前 32 位)
  var H = [
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]
  // 轮常量(前 64 个质数的立方根小数部分取前 32 位)
  var K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5,
    0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
    0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc,
    0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
    0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
    0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3,
    0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5,
    0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
    0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ]

  // 预处理: 追加 0x80, 补零至 56 字节模 64, 再追加 64 位大端长度(比特数)
  var len = bytes.length
  bytes.push(0x80)
  while (bytes.length % 64 !== 56) bytes.push(0x00)
  var bitLen = len * 8
  var bitHi = Math.floor(bitLen / 0x100000000)
  var bitLo = bitLen >>> 0
  bytes.push(
    (bitHi >>> 24) & 0xff, (bitHi >>> 16) & 0xff, (bitHi >>> 8) & 0xff, bitHi & 0xff,
    (bitLo >>> 24) & 0xff, (bitLo >>> 16) & 0xff, (bitLo >>> 8) & 0xff, bitLo & 0xff
  )

  function rotr(x, n) { return (x >>> n) | (x << (32 - n)) }

  for (var i = 0; i < bytes.length; i += 64) {
    var w = new Array(64)
    for (var j = 0; j < 16; j++) {
      var idx = i + j * 4
      w[j] = (bytes[idx] << 24) | (bytes[idx + 1] << 16) | (bytes[idx + 2] << 8) | bytes[idx + 3]
    }
    for (var j = 16; j < 64; j++) {
      var s0 = rotr(w[j - 15], 7) ^ rotr(w[j - 15], 18) ^ (w[j - 15] >>> 3)
      var s1 = rotr(w[j - 2], 17) ^ rotr(w[j - 2], 19) ^ (w[j - 2] >>> 10)
      w[j] = (w[j - 16] + s0 + w[j - 7] + s1) | 0
    }
    var a = H[0], b = H[1], c = H[2], d = H[3]
    var e = H[4], f = H[5], g = H[6], h = H[7]
    for (var j = 0; j < 64; j++) {
      var S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)
      var ch = (e & f) ^ (~e & g)
      var temp1 = (h + S1 + ch + K[j] + w[j]) | 0
      var S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)
      var maj = (a & b) ^ (a & c) ^ (b & c)
      var temp2 = (S0 + maj) | 0
      h = g; g = f; f = e; e = (d + temp1) | 0
      d = c; c = b; b = a; a = (temp1 + temp2) | 0
    }
    H[0] = (H[0] + a) | 0; H[1] = (H[1] + b) | 0
    H[2] = (H[2] + c) | 0; H[3] = (H[3] + d) | 0
    H[4] = (H[4] + e) | 0; H[5] = (H[5] + f) | 0
    H[6] = (H[6] + g) | 0; H[7] = (H[7] + h) | 0
  }

  function hex(n) {
    return ('00000000' + (n >>> 0).toString(16)).slice(-8)
  }
  return hex(H[0]) + hex(H[1]) + hex(H[2]) + hex(H[3]) +
    hex(H[4]) + hex(H[5]) + hex(H[6]) + hex(H[7])
}

module.exports = sha256
