// page/tabBar/component/index/mixins/update.js
// 简介: 小程序远程更新(方案1: 宿主从 cnb 下载并装到 .pending, 引擎 applyUpdate 冷重启)
// 履历:
//   2026-07-24 从 index.js 抽出, 按功能拆分多文件
//   2026-07-24 删除 _hideLoadingSafe 双 tick 关 loading 封装(宿主已拆分 loading/toast 视图, 该封装会误关后续弹窗且难排查), 统一改用直接 wx.hideLoading()
//   2026-07-24 所有关闭 loading 处前加 console.log('[update] 关闭loading: ...') 日记, 便于定位误关弹窗的位置
//   2026-07-24 下载完成文案改为"下载完成 是否更新"; 下载后弹确认框, 确认则经宿主 "应用更新" 事件装包+激活+冷重启(原 updateready 内置流程不再使用); 修正 loading 关闭时序避免误关后续弹窗
module.exports = {
  // 将宿主管理扩展模块的 extBridge 调用封装为 Promise, 配合 async/await 消除回调嵌套
  // data 统一注入调用方 appId, 使宿主分辨是哪个小程序发起(更新场景即更新目标)
  _callAppList(event, data) {
    return new Promise((resolve, reject) => {
      wx.extBridge({
        module: this._myAppId,
        event,
        data: Object.assign({ appId: this._myAppId }, data || {}),
        success: (res) => resolve(res),
        fail: (err) => reject(err),
      })
    })
  },

  // 将 showModal 封装为 Promise(确认/取消经 resolve 返回)
  _confirmModal(title, content) {
    return new Promise((resolve) => {
      wx.showModal({ title, content, success: (r) => resolve(r) })
    })
  },

  async _checkUpdate() {
    wx.showLoading({ title: '检查更新...', mask: true })
    try {
      const res = await this._callAppList('检查更新')
      console.log('[update] 关闭loading: 检查更新成功')
      wx.hideLoading()
      if (!res || !res.hasUpdate) {
        wx.showToast({ title: '已是最新版本', icon: 'none', duration: 1000 })
        return
      }
      const r = await this._confirmModal(
        '发现新版本' + (res.versionName ? '(' + res.versionName + ')' : ''),
        '是否下载并更新?',
      )
      console.log('[update] 关闭loading: 版本确认弹窗结束')
      wx.hideLoading()
      if (r.confirm) this._downloadUpdate()
    } catch (e) {
      console.log('[update] 关闭loading: 检查更新异常', e)
      wx.hideLoading()
      wx.showToast({ title: '检查更新失败', icon: 'none', duration: 1000 })
    }
  },

  async _downloadUpdate() {
    wx.showLoading({ title: '下载新小程序压缩包中...', mask: true })
    try {
      await this._callAppList('下载新小程序压缩包')
      console.log('[update] 关闭loading: 下载新小程序压缩包结束')
      wx.hideLoading()
      wx.showToast({ title: '下载完成 是否更新', icon: 'none', duration: 1000 })
      // 下载完成: 询问是否立即应用更新(经宿主 "应用更新" 事件装包+激活+冷重启)
      const r = await this._confirmModal('下载完成', '是否更新?')
      if (r.confirm) {
        wx.showLoading({ title: '应用更新中...', mask: true })
        try {
          await this._callAppList('应用更新')
        } catch (e) {
          wx.showToast({ title: '应用更新失败', icon: 'none', duration: 1000 })
        } finally {
          console.log('[update] 关闭loading: 应用更新结束')
          wx.hideLoading()
        }
      }
    } catch (e) {
      console.log('[update] 关闭loading: 下载新小程序压缩包异常', e)
      wx.hideLoading()
      wx.showToast({ title: '下载失败', icon: 'none', duration: 1000 })
    }
  },

  // 引擎推送 updateready: 弹重启确认, 确认后调用内置更新管理器冷重启加载新版本
  _onUpdateReady() {
    wx.showModal({
      title: '更新就绪',
      content: '是否重启小程序应用更新?',
      success: (r) => {
        if (r.confirm && typeof wx.getUpdateManager === 'function') {
          wx.getUpdateManager().applyUpdate()
        }
      },
    })
  },
}
