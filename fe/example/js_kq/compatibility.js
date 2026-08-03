// compatibility.js
// 简介: 运行环境兼容层. Dimina 引擎会在 wx 上注入 extBridge(小程序与宿主扩展模块通信,
//       用于 获取列表/拉起/删除/检查更新/下载更新 等); 微信原生小程序/开发者工具环境无此 API.
//       此处先集中判定运行环境(isDimina), 再在其缺失时提供降级实现, 使同一份前端代码可在微信环境中运行而不抛 "wx.extBridge is not a function".
// 履历: 2026-07-24 新建: wx.extBridge 缺失时创建降级实现; 获取列表返回 3 个模拟小程序条目便于微信环境预览, 其余事件回调 success 空对象
//   2026-07-25 新增 宿主读取本地数据()/宿主保存本地数据(): dimina 环境经 wx.extBridge 读写宿主共享文件(固定模块名 "小程序共享数据", 与宿主 MainActivity 注册名对齐, 多小程序共享同一份), 非 dimina 环境 resolve 空(走本地 storage); 供 config.js 读取/保存本地数据内调用
//   2026-07-25 新增 isDimina(): 集中判定运行环境(微信/dimina), 先于降级实现捕获真实 extBridge 是否存在, 避免到处重复 typeof 判断

// ---- 运行环境判定 ----
// dimina 宿主会注入原生 wx.extBridge; 微信/开发者工具无此 API.
// IS_DIMINA 为「一次性快照」: 在可能安装降级实现之前求值并冻结为 const.
// 之所以必须冻结: 装完 polyfill 后 wx.extBridge 恒为 function, 若之后再探测它就会失真; 故全程只读此快照, 绝不重新探测 wx.extBridge.
const IS_DIMINA = (typeof wx !== 'undefined' && typeof wx.extBridge === 'function')

// 运行环境判断: true=dimina 宿主(原生 extBridge, 可经 extBridge 读写宿主); false=微信/开发者工具(无宿主, 走本地 storage 降级)
// 返回冻结快照, 不受下方 polyfill 影响
function isDimina() {
  return IS_DIMINA
}

// 仅当非 dimina 时安装降级实现(读上方冻结的 IS_DIMINA, 不重新探测 wx.extBridge)
if (!IS_DIMINA) {
  // 微信环境无宿主: 仅做安全降级, 保证各调用点的 success/fail/complete 回调不报错
  wx.extBridge = function (opt) {
    opt = opt || {}
    var success = opt.success
    var fail = opt.fail
    var complete = opt.complete
    if (opt.event === '获取列表') {
      // 无宿主可管理的小程序, 返回几个模拟条目便于在微信环境预览列表页(每项仅需 appId + name)
      if (typeof success === 'function') success({
        list: [
          { appId: 'wx_demo_001', name: '演示小程序A' },
          { appId: 'wx_demo_002', name: '演示小程序B' },
          { appId: 'wx_demo_003', name: '演示小程序C' },
        ],
      })
    } else if (typeof success === 'function') {
      // 拉起/删除/检查更新/下载更新等需宿主动作, 微信环境无法执行, 视为成功空对象使流程继续
      success({})
    }
    if (typeof complete === 'function') complete({})
  }
}







// ---- 宿主共享本地数据(多小程序共享)兼容函数 ----
// dimina 环境(固定模块名 "小程序共享数据", 与宿主 MainActivity 注册名一致)经 wx.extBridge 读写宿主共享文件; 非 dimina 环境(无 wx.extBridge)直接 resolve, 走本地 storage, 不影响流程
// 供 config.js 的 读取本地数据/保存本地数据 内部调用

// 读取宿主共享数据: 返回 Promise<object>(宿主整对象, 失败/非 dimina 返回 {})
function 宿主读取本地数据() {
  return new Promise((resolve) => {
    if (!isDimina()) { resolve({}); return } // 微信/开发者工具环境: 不调宿主, 走本地 storage
    wx.extBridge({
      module: "小程序共享数据",
      event: '读取本地数据',
      data: {},
      success: (res) => resolve((res && res.数据) || {}),
      fail: () => resolve({}),
    })
  })
}

// 保存宿主共享数据: 数据 为合并后整对象; 返回 Promise(成功/失败均 resolve, 不阻塞调用方)
function 宿主保存本地数据(数据) {
  return new Promise((resolve) => {
    if (!isDimina()) { resolve(); return } // 微信/开发者工具环境: 不调宿主, 仅本地 storage
    wx.extBridge({
      module: "小程序共享数据",
      event: '保存本地数据',
      data: { 数据 },
      success: () => resolve(),
      fail: () => resolve(),
    })
  })
}

module.exports = { isDimina, 宿主读取本地数据, 宿主保存本地数据 }
