// page/tabBar/component/max_image/max_image.js
// 简介: 推送落地页. 通知被点击后跳转至此, 接收 query.payload(原始推送 JSON),
//       按推送字段结构化展示: 标题/内容/全景图/人脸图.
// 履历:
//   2026-07-21 创建, onLoad 解码 payload 展示大图与全部参数
//   2026-07-21 修复: URLEncoder 把空格编码为 '+', decodeURIComponent 不会还原,
//             需先 '+'->' ' 再解码, 否则 JSON.parse 失败导致参数/图片全空
//   2026-07-21 按推送字段重构界面, 仅展示 标题/内容/全景图/人脸图, 移除返回按钮与调试区
//   2026-07-22 onLoad 增加 console.log 打印原始 options 与解析后 payload, 便于排查接收参数
//   2026-07-22 修复全景图显示不对: payload.max_image 含未编码中文导致加载失败,
//             改 encodeURI 编码; 并去掉回退人脸图的误导逻辑(二者非同图), 失败仅标记 imgError
//   2026-07-22 全景图加载失败增加点击重试(附带缓存刷新参数强制重载);
//             点击全景图打开自建放大层(movable 双指缩放+拖动), 替代 previewImage 以获得更可控体验
//   2026-07-23 放大层改自定义手势(单指拖动+双指缩放, inline transform 驱动),
//             去掉点击图片关闭避免误触, 仅保留×关闭; 拖动更跟手
Page({
  data: {
    received: false,   // 是否成功解析到 payload
    title: '',         // 标题
    content: '',       // 内容
    panoRaw: '',       // 全景图原始地址(已编码, 不含重试参数)
    panoImage: '',     // 全景图实际 src(panoRaw + 重试缓存参数)
    faceImage: '',     // 人脸图(payload.image)
    fallbackImage: '', // 回退图(base64, 离线可用)
    imgError: false,   // 全景图是否加载失败
    retry: 0,          // 重试次数, 用于生成缓存刷新参数
    preview: false,    // 放大层是否显示
    rotate: 0,          // 放大层图片旋转角度(90 的倍数)
    imgX: 0,            // 放大层图片水平位移(px)
    imgY: 0,            // 放大层图片垂直位移(px)
    imgScale: 1,        // 放大层图片缩放倍数
    imgAnim: false,     // 是否启用变换过渡(旋转时开, 拖拽/缩放时关)
    scrollIntoView: '', // 默认滚动到底部的锚点 id
  },

  // 放大层手势临时状态(不放进 data, 避免无谓渲染)
  _pt: null,

  onLoad(options) {
    console.log('[max_image] onLoad options:', options)
    const payload = this.parsePayload(options && options.payload)
    // console.log('[max_image] parsed payload:', payload)
    console.log('[max_image] 全景图:', payload.max_image) // [JS] [max_image] 全景图: https://pc.jsauto.hk.cn:8899/dd/face-records/image?path=数据/人脸抓拍库/2026-07-22/陌生人_陌生人_1784690390_全景图.jpg
    // console.log('[max_image] 人脸图:', payload.image)
    console.log('[max_image] 标题:', payload.title)
    console.log('[max_image] 内容:', payload.content)

    if (!payload) {
      this.setData({ received: false })
      return
    }
    const panoRaw = payload.max_image ? encodeURI(payload.max_image) : ''
    this.setData({
      received: true,
      title: payload.title || '',
      content: payload.content || '',
      panoRaw,
      panoImage: panoRaw,
      faceImage: typeof payload.image === 'string' ? payload.image : '',
      fallbackImage: typeof payload.image === 'string' ? payload.image : '',
      imgError: false,
      retry: 0,
    })
  },

  // 渲染完成后默认滚动到底部(全景图), 长内容也能停在底部且可向上回滚
  onReady() {
    this.setData({ scrollIntoView: 'maxBottom' })
  },

  // 全景图加载失败: 仅标记错误, 不回退人脸图(两者是不同图, 回退会误导)
  onImageError() {
    if (!this.data.imgError) {
      this.setData({ imgError: true })
    }
  },

  // 点击重试: 清除错误标记, 追加缓存刷新参数强制 image 重新加载
  onRetry() {
    const raw = this.data.panoRaw
    if (!raw) return
    const retry = this.data.retry + 1
    const sep = raw.indexOf('?') >= 0 ? '&' : '?'
    this.setData({
      imgError: false,
      retry,
      panoImage: `${raw}${sep}_r=${retry}`,
    })
  },

  // 点击全景图: 打开自建放大层, 复位旋转/位移/缩放
  openPreview() {
    if (!this.data.panoImage || this.data.imgError) return
    this.setData({ preview: true, rotate: 0, imgX: 0, imgY: 0, imgScale: 1, imgAnim: false })
  },

  // 旋转 90 度(带过渡动画)
  onRotate() {
    this.setData({ rotate: (this.data.rotate + 90) % 360, imgAnim: true })
  },

  // 关闭放大层
  closePreview() {
    if (this.data.preview) {
      this.setData({ preview: false })
    }
  },

  // ===== 放大层自定义手势: 单指拖动 + 双指缩放 =====
  onImgTouchStart(e) {
    const t = e.touches
    const pt = (this._pt = this._pt || {})
    pt.moved = false
    pt.time = Date.now()
    this.setData({ imgAnim: false })
    if (t.length >= 2) {
      pt.mode = 'pinch'
      pt.startDist = touchDist(t[0], t[1])
      pt.baseScale = this.data.imgScale
    } else {
      const p = t[0]
      pt.mode = 'pan'
      pt.startX = p.clientX
      pt.startY = p.clientY
      pt.baseX = this.data.imgX
      pt.baseY = this.data.imgY
    }
  },

  onImgTouchMove(e) {
    const pt = this._pt
    if (!pt) return
    const t = e.touches
    if (t.length >= 2) {
      const d = touchDist(t[0], t[1])
      const s = pt.baseScale * (d / (pt.startDist || d))
      this.setData({ imgScale: Math.max(1, Math.min(4, s)) })
    } else if (t.length === 1) {
      if (pt.mode !== 'pan') {
        // 双指松一根 -> 切回单指拖动, 重新打底避免跳变
        pt.mode = 'pan'
        pt.startX = t[0].clientX
        pt.startY = t[0].clientY
        pt.baseX = this.data.imgX
        pt.baseY = this.data.imgY
      }
      const dx = t[0].clientX - pt.startX
      const dy = t[0].clientY - pt.startY
      if (Math.abs(dx) + Math.abs(dy) > 4) pt.moved = true
      this.setData({ imgX: pt.baseX + dx, imgY: pt.baseY + dy })
    }
  },

  onImgTouchEnd(e) {
    const pt = this._pt
    if (!pt) return
    if (e.touches.length === 0) {
      this._pt = null
    } else if (e.touches.length === 1) {
      // 还剩一根手指(双指松开一根): 切回 pan 并打底
      pt.mode = 'pan'
      pt.startX = e.touches[0].clientX
      pt.startY = e.touches[0].clientY
      pt.baseX = this.data.imgX
      pt.baseY = this.data.imgY
    }
  },

  // 解析 payload: 框架不自动解码; URLEncoder 把空格编为 '+', 需先转回空格再解码
  parsePayload(raw) {
    if (!raw) return null
    let text = raw
    try {
      text = decodeURIComponent(raw.replace(/\+/g, ' '))
    } catch (e) {
      text = raw
    }
    try {
      return JSON.parse(text)
    } catch (e) {
      return null
    }
  },
})

// 两指间距
function touchDist(a, b) {
  const dx = a.clientX - b.clientX
  const dy = a.clientY - b.clientY
  return Math.sqrt(dx * dx + dy * dy)
}
