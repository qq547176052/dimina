/**
 * 小程序配置文件
 */

// 此处主机域名是腾讯云解决方案分配的域名
// 小程序后台服务解决方案：https://www.qcloud.com/solution/la

// 履历: 2026-07-24 新增 config.login(account, password)→config.登录(账号, 密码): 封装登录 API(内部 sha256 哈希 + 保存 token/user/userName), 供登录页与 token 过期时其它文件直接调用重新登录
//   2026-07-25 新增 本地数据(模板)/读取本地数据()/保存本地数据(数据): 合并到单一对象; 读取同步返回本地整对象, 并异步经 兼容.宿主读取本地数据/宿主保存本地数据 读写宿主共享文件(module=本小程序 appId, 多小程序共享); 微信环境无 extBridge 时仅本地 storage
//   2026-07-27 修复"打开小程序读取/写入本地数据过多次": 读取本地数据() 原每次调用都经 .then 写回 wx.setStorageSync(读一次写一次放大, api.js 每条请求取 token 即触发一次); 新增模块级内存缓存 本地缓存, 仅首次读 storage/宿主并条件写回(合并无变化不写), 之后命中缓存直接返回; 保存本地数据() 统一刷新缓存并集中落盘, 消除保存时的读放大
//   2026-07-27 [调试-临时] 读取本地数据() 入口加 _读取调试(): 打印调用计数/cache命中(未命中=真实读storage或宿主)/调用栈, 定位"读取过多次"的触发代码位置; 问题确认后删除本段落与 _读取调试 调用
const sha256 = require('./utils/sha256.js') // 纯 JS SHA-256(无第三方依赖)
const 兼容 = require('./compatibility.js') // 运行环境兼容层(含 宿主读取本地数据/宿主保存本地数据)

// [调试-临时] 统计 读取本地数据 的来源与命中: 排查"打开小程序读取本地数据过多次"; 稳定后删除
let _读取计数 = 0
function _读取调试() {
  _读取计数++
  let caller = ''
  try {
    // 取调用栈中 读取本地数据 之上两帧(跳过 Error 本身与本函数), 定位实际触发代码位置
    const frames = (new Error().stack || '').split('\n').slice(3, 5)
    caller = frames.join(' <- ').trim() || '未知'
  } catch (e) { caller = '解析栈失败' }
  console.log(`[调试][读取本地数据] #${_读取计数} cache=${本地缓存 ? '命中' : '未命中(真实读storage/宿主)'} caller="${caller}"`)
}

// 内存缓存: 本地数据整对象(读一次后常驻, 消除"读一次写一次"的 storage 放大); 仅经 读取本地数据/保存本地数据 维护
let 本地缓存 = null

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
    // 读取本地数据: 同步返回; 内存缓存命中直接返回, 不读 storage/宿主/不写回, 杜绝每次读都触发 setStorageSync
    // 仅首次(无缓存)读本地 storage 并异步合并宿主共享数据一次; 合并有变化才写回本地, 避免"读一次写一次"放大
    读取本地数据() {
      _读取调试()
      if (本地缓存) return 本地缓存
      if (兼容.isDimina()) {
        const 数据 = wx.getStorageSync('本地数据')
        const 本地 = Object.assign({}, this.本地数据, 数据 && typeof 数据 === 'object' ? 数据 : {})
        本地缓存 = 本地
        // 仅首次异步把宿主共享数据合并进本地缓存(不阻塞); 合并有变化才落盘, 避免每次读都写回
        兼容.宿主读取本地数据().then((宿主数据) => {
          if (宿主数据 && typeof 宿主数据 === 'object') {
            const 合并 = Object.assign({}, 本地缓存, 宿主数据)
            if (JSON.stringify(合并) !== JSON.stringify(本地缓存)) {
              wx.setStorageSync('本地数据', 合并)
              本地缓存 = 合并
            }
          }
        }).catch(() => {})
        return 本地
      }
      // 微信/开发者工具环境: 无宿主, 直接读本地 storage 返回
      const 数据 = wx.getStorageSync('本地数据')
      return Object.assign({}, this.本地数据, 数据 && typeof 数据 === 'object' ? 数据 : {})
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
