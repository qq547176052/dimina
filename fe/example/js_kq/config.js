/**
 * 小程序配置文件
 */

// 此处主机域名是腾讯云解决方案分配的域名
// 小程序后台服务解决方案：https://www.qcloud.com/solution/la

// 履历: 2026-07-24 新增 config.login(account, password)→config.登录(账号, 密码): 封装登录 API(内部 sha256 哈希 + 保存 token/user/userName), 供登录页与 token 过期时其它文件直接调用重新登录
//   2026-07-25 新增 本地数据(模板)/读取本地数据()/保存本地数据(数据): 合并到单一对象; 读取同步返回本地整对象, 并异步经 兼容.宿主读取本地数据/宿主保存本地数据 读写宿主共享文件(module=本小程序 appId, 多小程序共享); 微信环境无 extBridge 时仅本地 storage
//   2026-07-27 修复"打开小程序读取/写入本地数据过多次": 读取本地数据() 原每次调用都经 .then 写回 wx.setStorageSync(读一次写一次放大, api.js 每条请求取 token 即触发一次); 新增模块级内存缓存 本地缓存, 仅首次读 storage/宿主并条件写回(合并无变化不写), 之后命中缓存直接返回; 保存本地数据() 统一刷新缓存并集中落盘, 消除保存时的读放大
//   2026-07-27 新增 环境切换: 顶部 环境列表 + 环境变量('dev'/'prod') 取代写死 host; host 约定不含协议(由 api.js/登录链接 预拼 https://), 并暴露 config.环境变量 供界面读取
//   2026-07-28 新增 读取本地数据异步(): 首次等待宿主共享数据合并完成再 resolve, 修复"本地 storage 空/旧但宿主有账号密码"时,
//        同步读取在宿主合并前误判未登录 → index/face/login 误跳/显示登录页 的时序竞争; 登录态判断统一改用本方法
const sha256 = require('./utils/sha256.js') // 纯 JS SHA-256(无第三方依赖)
const 兼容 = require('./compatibility.js') // 运行环境兼容层(含 宿主读取本地数据/宿主保存本地数据)

// 内存缓存: 本地数据整对象(读一次后常驻, 消除"读一次写一次"的 storage 放大); 仅经 读取本地数据/保存本地数据 维护
let 本地缓存 = null
// 首次宿主共享数据合并的 Promise: 仅 dimina 首次读取时创建, 供 读取本地数据异步() await, 完成后置 null
let 宿主同步任务 = null

// 环境切换: 改 环境变量 为 'dev'(开发) / 'prod'(生产) 即可切换后端地址(只需改这一处)
// 约定: host 不含协议(统一由 api.js / 登录链接 预拼 https://), 故此处不要带 http(s)://
const 环境列表 = {
  dev:  'http://192.168.88.189:8899',   // 开发: 局域网后端(http)
  prod: 'https://wx2.jsauto.hk.cn:8899', // 生产: 腾讯云域名(https)
}
const 环境变量 = 'prod' // 'dev' | 'prod'
const host = 环境列表[环境变量]


var config = {
    // 下面的地址配合云端 Server 工作
    host,
    // 当前环境: 'dev' 开发 | 'prod' 生产(由顶部 环境变量 决定), 供界面展示/运行切换读取
    环境变量,
    // 登录地址
    api登录链接: `${host}/api/auth/login`,
    // 本地数据模板: 定义所有需持久化字段的默认形状(单一对象)
    本地数据: {
      token: '',
      user: {},
      是否保存: true,
      用户名: '',
      密码: '',
    },
    // 读取本地数据: 同步返回; 内存缓存命中直接返回, 不读 storage/宿主/不写回, 杜绝每次读都触发 setStorageSync
    // 仅首次(无缓存)读本地 storage 并异步合并宿主共享数据一次; 合并有变化才写回本地, 避免"读一次写一次"放大
    读取本地数据() {
      if (本地缓存) return 本地缓存
      if (兼容.isDimina()) {
        const 数据 = wx.getStorageSync('本地数据')
        const 本地 = Object.assign({}, this.本地数据, 数据 && typeof 数据 === 'object' ? 数据 : {})
        本地缓存 = 本地
        // 首次异步把宿主共享数据合并进本地缓存; 记录 Promise 供 读取本地数据异步() await, 完成后置 null
        宿主同步任务 = 兼容.宿主读取本地数据().then((宿主数据) => {
          if (宿主数据 && typeof 宿主数据 === 'object') {
            const 合并 = Object.assign({}, 本地缓存, 宿主数据)
            if (JSON.stringify(合并) !== JSON.stringify(本地缓存)) {
              wx.setStorageSync('本地数据', 合并)
              本地缓存 = 合并
            }
          }
          宿主同步任务 = null
          return 本地缓存
        }).catch(() => { 宿主同步任务 = null; return 本地缓存 })
        return 本地
      }
      // 微信/开发者工具环境: 无宿主, 读本地 storage 并建内存缓存(与 dimina 分支一致, 避免每次读都真实读 storage)
      const 数据 = wx.getStorageSync('本地数据')
      本地缓存 = Object.assign({}, this.本地数据, 数据 && typeof 数据 === 'object' ? 数据 : {})
      return 本地缓存
    },
    // 异步读取本地数据: 返回 Promise; dimina 环境首次等待宿主共享数据合并完成后再 resolve.
    // 解决"本地 storage 空/旧但宿主有账号密码"时, 同步读取在宿主合并前误判未登录 → 误跳登录页的时序竞争;
    // 登录态判断(index/face/login 的 确保Token/onLoad)应改用本方法. 宿主同步完成后命中缓存立即 resolve, 不重复等待.
    读取本地数据异步() {
      this.读取本地数据() // 确保缓存已建并触发宿主同步任务
      if (宿主同步任务) return 宿主同步任务.then(() => 本地缓存)
      return Promise.resolve(本地缓存)
    },
    // 保存本地数据: 更新内存缓存 + 同步落盘本地并返合并对象; dimina 环境额外异步推送到宿主共享(多小程序共享)
    // 复用 读取本地数据() 取基线(命中缓存, 不再触发宿主读与写回), 仅此处集中落盘, 消除保存时的读放大
    保存本地数据(数据) {
      const 合并 = Object.assign({}, this.读取本地数据(), 数据)
      本地缓存 = 合并
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
