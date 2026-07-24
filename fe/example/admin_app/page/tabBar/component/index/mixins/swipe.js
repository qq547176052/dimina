// page/tabBar/component/index/mixins/swipe.js
// 简介: 列表项左滑(置顶/删除)手势与页面级右滑开抽屉手势相关方法
// 履历:
//   2026-07-24 从 index.js 抽出, 按功能拆分多文件
const SWIPE_OPEN_PX = 15    // 列表项左滑展开所需最小位移(px)
const SWIPE_CLOSE_PX = 15   // 展开项从"展开位"右拖超过该 px 即收起(以展开位为基准, 非以闭合位为基准)
const DRAWER_EDGE_PX = 15   // 列表区右滑开抽屉的横向位移阈值(px)

module.exports = {
  // 页面级手势临时状态(不放进 data, 避免无谓渲染)
  _pageStartX: 0,
  _pageStartY: 0,
  _pageSuppressDrawer: false,

  // ===== 列表项左滑: 置顶 / 删除 =====
  // 直接由 touch 事件(clientX/Y 差)计算位移并 apply 到 content 的 translateX,
  // 不依赖 movable-view(其在 dimina 下 bindchange 回报的 x 恒为 0, 导致阈值与吸附全部失效);
  // 纵向意图不干预(交给 scroll-view 原生滚动); 横向意图确定后锁定 scroll-view 垂直滚动, 避免抢手势/取消触摸
  onSwipeTouchStart(e) {
    const t = e.touches[0]
    this._sx = t ? t.clientX : 0
    this._sy = t ? t.clientY : 0
    this._startTranslate = this._lookupTranslateX(e.currentTarget.dataset.appid)
    this._swipeWasOpen = this._startTranslate < 0   // 记录本次手势作用于的"当前项"是否原本展开
    this._dir = null        // 'h' 横向 | 'v' 纵向 | null 未定
    this._moved = false
    this._curX = this._startTranslate
  },

  onSwipeTouchMove(e) {
    const t = e.touches[0]
    if (!t) return
    const dx = t.clientX - this._sx
    const dy = t.clientY - this._sy
    if (Math.abs(dx) > 4 || Math.abs(dy) > 4) this._moved = true
    // 意图判定: 位移超过 8px 且横向为主才视为左滑; 否则交由原生滚动
    if (this._dir === null && (Math.abs(dx) > 8 || Math.abs(dy) > 8)) {
      this._dir = Math.abs(dx) > Math.abs(dy) ? 'h' : 'v'
      if (this._dir === 'h' && !this.data.swipeLock) this.setData({ swipeLock: true })
    }
    if (this._dir !== 'h') return // 纵向滚动或尚未确定: 不干预
    const appId = e.currentTarget.dataset.appid
    // 跟随手指计算位移并约束在 [-actionWidth, 0]
    this._curX = Math.max(-this.data.actionWidth, Math.min(0, this._startTranslate + dx))
    this._setItemTranslateX(appId, this._curX)
  },

  onSwipeTouchEnd(e) {
    const appId = e.currentTarget.dataset.appid
    if (this.data.swipeLock) this.setData({ swipeLock: false })
    if (this._dir === 'h') {
      const { actionWidth } = this.data
      const x = typeof this._curX === 'number' ? this._curX : 0
      // 展开态(x 起点为负): 从展开位右拖超过 SWIPE_CLOSE_PX(px)即收起(以展开位为基准, 否则需几乎拖回原位才收起); 收起态: 左滑超过 SWIPE_OPEN_PX(px)才展开; 纯位置判定不认速度
      const target = this._startTranslate < 0
        ? (x > this._startTranslate + SWIPE_CLOSE_PX ? 0 : -actionWidth)
        : (x < -SWIPE_OPEN_PX ? -actionWidth : 0)
      if (target < 0) this._closeOthers(appId) // 打开时先关闭其它项, 保证最多一个展开
      this._setItemTranslateX(appId, target)
      // 横向手势落在"已展开项"上: 让位给该项自身的关闭, 抑制根容器开抽屉(仅针对当前项, 不影响其它项)
      this._pageSuppressDrawer = this._swipeWasOpen
      this._dir = null
      return
    }
    // 非横向(纵向滚动或轻点): 不在松手处理点击, 交由 onSwipeTap
    this._dir = null
  },

  onSwipeTap(e) {
    if (this._moved) return // 横向滑动/纵向滚动后补发的 tap 不触发点击
    const hasOpen = this.data.displayList.some((it) => it.translateX < 0)
    if (hasOpen) {
      this._closeAllSwipes()
      return
    }
    this.onTapItem(e)
  },

  _lookupTranslateX(appId) {
    const it = this.data.displayList.find((x) => x.appId === appId)
    return it ? it.translateX : 0
  },

  // ===== 页面级手势(挂根容器, 接收冒泡触摸): 列表右滑(以水平为主)打开左侧抽屉 =====
  // 垂直滚动因 dy 远大于 dx 不会误触发; 仅当本次右滑落在"已展开"的当前列表项上才让位关闭该项
  onPageTouchStart(e) {
    const t = e.touches[0]
    this._pageStartX = t ? t.clientX : 0
    this._pageStartY = t ? t.clientY : 0
    // 每个触摸周期重置: 是否抑制开抽屉由本次手势是否落在"已展开列表项"上决定,
    // 而非"列表里任意项展开", 这样右滑未展开项仍可正常打开抽屉
    this._pageSuppressDrawer = false
  },

  onPageTouchEnd(e) {
    const t = e.changedTouches && e.changedTouches[0]
    if (!t) return
    const dx = t.clientX - this._pageStartX
    const dy = t.clientY - this._pageStartY
    const rightSwipe = dx > DRAWER_EDGE_PX && Math.abs(dx) > Math.abs(dy) * 1.5
    // 抽屉已打开: 关闭由抽屉自身手势处理, 此处不再抢手势
    if (this.data.drawerOpen) return
    // 本次横向手势落在"已展开"的当前列表项上: 仅用于关闭该项, 不触发开抽屉
    if (this._pageSuppressDrawer) return
    // 列表区右滑打开左侧抽屉
    if (rightSwipe) this.openDrawer()
  },
}
