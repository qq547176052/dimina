/**
 * 小程序配置文件
 */

// 此处主机域名是腾讯云解决方案分配的域名
// 小程序后台服务解决方案：https://www.qcloud.com/solution/la

// 履历: 2026-07-24 新增 config.login(account, password)→config.登录(账号, 密码): 封装登录 API(内部 sha256 哈希 + 保存 token/user/userName), 供登录页与 token 过期时其它文件直接调用重新登录
//   2026-07-25 新增 本地数据(模板)/读取本地数据()/保存本地数据(数据): 合并到单一对象; 读取同步返回本地整对象, 并异步经 兼容.宿主读取本地数据/宿主保存本地数据 读写宿主共享文件(module=本小程序 appId, 多小程序共享); 微信环境无 extBridge 时仅本地 storage
const sha256 = require('./utils/sha256.js') // 纯 JS SHA-256(无第三方依赖)
const 兼容 = require('./compatibility.js') // 运行环境兼容层(含 宿主读取本地数据/宿主保存本地数据)

var host = "wx2.jsauto.hk.cn:8899"
var config = {
    // 下面的地址配合云端 Server 工作
    host,
    // 登录地址
    api登录链接: `https://${host}/api/auth/login`,
    // 本地数据模板: 定义所有需持久化字段的默认形状(单一对象)
    本地数据: {
      token: '',
      user: {},
      是否保存: true,
      用户名: '',
      密码: '',
    },
    // 读取本地数据: 同步返回; 按运行环境 if/else 分支, 微信与 dimina 两条路径互不干扰
    读取本地数据() {
      if (兼容.isDimina()) {
        // dimina 宿主环境: 同步返回本地缓存, 并异步把宿主共享数据合并进本地(不阻塞, 下次读取即最新)
        const 数据 = wx.getStorageSync('本地数据')
        const 本地 = Object.assign({}, this.本地数据, 数据 && typeof 数据 === 'object' ? 数据 : {})
        兼容.宿主读取本地数据().then((宿主数据) => {
          if (宿主数据 && typeof 宿主数据 === 'object') {
            wx.setStorageSync('本地数据', Object.assign({}, 本地, 宿主数据))
          }
        }).catch(() => {})
        return 本地
      }
      // 微信/开发者工具环境: 无宿主, 直接读本地 storage 返回
      const 数据 = wx.getStorageSync('本地数据')
      return Object.assign({}, this.本地数据, 数据 && typeof 数据 === 'object' ? 数据 : {})
    },
    // 保存本地数据: 同步合并落盘本地并返合并对象; dimina 环境额外异步推送到宿主共享(多小程序共享), 微信环境仅本地
    保存本地数据(数据) {
      const 合并 = Object.assign({}, this.读取本地数据(), 数据)
      wx.setStorageSync('本地数据', 合并) // 本地缓存(离线/降级即时可用)
      if (兼容.isDimina()) {
        // dimina 宿主环境: 推送到宿主共享文件(多小程序共享)
        兼容.宿主保存本地数据(合并).catch(() => {})
      }
      return 合并
    },
}


/**
 * 登录并保存登录态(供登录页与 token 过期时其它文件直接调用重新登录).
 * @param {string} username  账号(username)
 * @param {string} password 明文密码(内部 SHA-256 哈希后上报, 不传明文)
 * @returns {Promise<{token:string, user:object}>} 成功 resolve 登录结果, 失败 reject(Error, message 为后端提示)
 */
config.登录 = function (username, password) {
  return new Promise((resolve, reject) => {
    wx.request({
      url: config.api登录链接,
      method: 'POST',
      header: { 'content-type': 'application/json' },
      data: { username: username, password: sha256(password) },
      success: (res) => {
        // 兼容 { token, user } 或 { data: { token, user } } 结构; 按后端实际返回调整
        const body = res.data || {}
        const data = body.data || {}
        const token = body.token || data.token
        const user = body.user || data.user // 登录返回的用户信息对象(id/name/role/phone/email/avatar/customerId...)
        if (res.statusCode === 200 && token) {
          // 保存公共登录态: 合并到本地数据对象整对象落盘
          config.保存本地数据({ token: token, user: user })
          resolve({ token, user })
        } else {
          const msg = body.message || body.msg || data.message || '账号或密码错误'
          reject(new Error(msg))
        }
      },
      fail: () => {
        reject(new Error('网络错误, 请稍后重试'))
      },
    })
  })
}

module.exports = config
