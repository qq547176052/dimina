// 首页: 展示 WeUI 组件示例入口; 底部 footer 展示版本号
// 履历:
//   2026-07-25 新增 版本号: onLoad 经 wx.getSystemInfoSync().appVersion 取宿主注入的版本(无注入时回退 APP_VERSION 兜底), footer 展示 v{{version}}
const APP_VERSION = '1.0.0' // 兜底版本号(无宿主 appVersion 注入时使用)

Page({
  mixins: [require('../mixin/common')],
  data: {
    version: '',
    list: [
      {
        id: 'form',
        name: '表单',
        open: false,
        pages: ['button', 'form', 'list', 'slideview', 'slider', 'uploader'],
      },
      {
        id: 'layout',
        name: '基础组件',
        open: false,
        pages: ['article', 'badge', 'flex', 'footer', 'gallery', 'grid', 'icons', 'loading', 'loadmore', 'panel', 'preview', 'progress', 'steps'],
      },
      {
        id: 'feedback',
        name: '操作反馈',
        open: false,
        pages: ['actionsheet', 'dialog', 'half-screen-dialog', 'msg', 'picker', 'toast', 'information-bar'],
      },
      {
        id: 'nav',
        name: '导航相关',
        open: false,
        pages: ['navigation-bar', 'tabbar'],
      },
      {
        id: 'search',
        name: '搜索相关',
        open: false,
        pages: ['searchbar'],
      },
    ],
  },
  kindToggle(e) {
    const { id } = e.currentTarget; const { list } = this.data;
    for (let i = 0, len = list.length; i < len; ++i) {
      if (list[i].id == id) {
        list[i].open = !list[i].open;
      } else {
        list[i].open = false;
      }
    }
    this.setData({
      list,
    });
  },
  onLoad() {
    // 版本号: 优先取宿主在 getSystemInfoSync 中注入的 appVersion, 无则回退兜底值
    let v = ''
    try {
      const sys = (typeof wx.getSystemInfoSync === 'function') ? wx.getSystemInfoSync() : {}
      v = (sys && sys.appVersion) || APP_VERSION
    } catch (e) {
      v = APP_VERSION
    }
    this.setData({ version: v })
  },
  changeTheme() {
    const theme = this.data.theme === 'light' ? 'dark' : 'light';
    getApp().onThemeChange({ theme });
  },
});
