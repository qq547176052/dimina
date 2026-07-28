// page/face/face-edit.js
// 简介: 人脸库新增/编辑表单页; 添加走 wx.uploadFile(必传照片), 编辑可只改字段或换照; 复用 api.faceLibrary
// 履历:
//   2026-07-27 删除有效期三类字段(类型/开始/结束)录入: wxml 删除三项 form-field; js 同步清理 data/form 初始化、编辑回填、提交遍历数组, 避免无录入途径的死字段
//             编辑模式按 name 拉取当前值回填; 保存成功返回列表并刷新
//   2026-07-27 索引改 pid: originalPid 可靠索引(协议 /person/* 主键); 提交带 pid 走 camera 端点
//             (api.faceLibrary.update), 不再仅依赖 name(避免重名/改名/非 ASCII 名传输丢字段)
//   2026-07-27 编辑改 POST+JSON(非 PUT+urlencoded): 绕开 dimina 代理转发 PUT 表单参数丢失,
//             走代理最可靠的 JSON 原生通路; 后端 F摄像头人脸编辑 用 c.ShouldBind 兼容 JSON/表单
//   2026-07-27 onLoad 开头重置所有可变数据(表单/照片/预览/原索引): 页面实例被框架复用,
//             不清除会残留上次输入; 同时移除两处排查 console.log
const config = require('../../config.js')
const api = require('../../utils/api.js')

const TYPE_OPTIONS = [
  { value: 'whitelist', label: '白名单' },
  { value: 'blacklist', label: '黑名单' },
  { value: 'vip', label: 'VIP' },
  { value: 'visitor', label: '访客' },
]
const GENDER_OPTIONS = [
  { value: '男', label: '男' },
  { value: '女', label: '女' },
]
// 无图占位
const placeholderAvatar = 'data:image/svg+xml,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="72" height="72"><rect width="72" height="72" fill="#e5e7eb"/><text x="50%" y="52%" text-anchor="middle" fill="#9ca3af" font-size="12">无图</text></svg>'
)

Page({
  data: {
    mode: 'add',        // add | edit
    originalName: '',   // 编辑时定位用(原姓名, 兜底; 优先用 originalPid)
    originalPid: '',    // 编辑时定位用(原人员唯一标识, 可靠索引)
    typeOptions: TYPE_OPTIONS,
    typeIndex: 0,
    genderOptions: GENDER_OPTIONS,
    genderIndex: 0,
    form: {
      name: '',
      employeeNo: '',
      department: '',
      gender: '',
      age: '',
      idCard: '',
      phone: '',
      icCardNo: '',
      other: '',
    },
    photoPath: '',      // 选中/当前照片的本地临时路径
    previewUrl: '',     // 头像预览(选图或下载当前图)
    submitting: false,
    placeholderAvatar,
  },
  // 进入页面先清零可变数据(页面实例会被框架复用, 否则残留上次输入/照片/预览)
  重置数据() {
    this.setData({
      originalName: '',
      originalPid: '',
      typeIndex: 0,
      genderIndex: 0,
      form: {
        name: '', employeeNo: '', department: '', gender: '', age: '',
        idCard: '', phone: '', icCardNo: '', other: '',
      },
      photoPath: '',
      previewUrl: '',
      submitting: false,
    })
  },
  onLoad(query) {
    this.重置数据()
    const mode = query.mode === 'edit' ? 'edit' : 'add'
    this.setData({ mode })
    wx.setNavigationBarTitle({ title: mode === 'edit' ? '编辑人员' : '新增人员' })
    if (mode === 'edit') {
      const name = decodeURIComponent(query.name || '').trim()
      const pid = decodeURIComponent(query.pid || '').trim()
      // pid 为可靠唯一索引; 缺失(pid 丢失/旧包)直接报错, 不再用 name 兜底
      if (!pid) {
        wx.showToast({ title: '缺少人员标识(pid)，无法编辑，请返回列表重试', icon: 'none' })
        return
      }
      this.setData({ originalName: name, originalPid: pid })
      this.拉取并回填(pid)
    }
  },
  // 编辑模式: 仅按 pid 取当前值回填(协议 /person/* 主键, 可靠; 不使用 name 索引避免重名串号)
  拉取并回填(pid) {
    if (!pid) return
    api.faceLibrary.list({ pageSize: 100 })
      .then((payload) => {
        const rows = (payload && payload.list) || []
        const row = rows.find((r) => r.pid === pid) || null
        if (!row) return
        // 把查询到的 name 写回(仅用于改名检测; 索引只用 pid)
        this.setData({
          originalName: row.name || this.data.originalName || '',
          originalPid: pid,
        })
        const typeIdx = TYPE_OPTIONS.findIndex((o) => o.value === row.faceLibrary)
        const genderIdx = GENDER_OPTIONS.findIndex((o) => o.value === (row.gender || ''))
        const form = {
          name: row.name || '',
          employeeNo: row.employeeNo || '',
          department: row.department || '',
          gender: row.gender || '',
          age: row.age != null ? String(row.age) : '',
          idCard: row.idCard || '',
          phone: row.phone || '',
          icCardNo: row.icCardNo || '',
          other: row.other || '',
        }
        this.setData({
          form,
          typeIndex: typeIdx >= 0 ? typeIdx : 0,
          genderIndex: genderIdx >= 0 ? genderIdx : 0,
        })
        // 当前头像: 带鉴权下载为临时文件预览
        if (row.imageName) {
          wx.downloadFile({
            url: api.faceLibrary.imageUrl(row.imageName),
            header: api.authHeaders(),
            success: (res) => { if (res.statusCode === 200 && res.tempFilePath) this.setData({ previewUrl: res.tempFilePath }) },
          })
        }
      })
      .catch(() => { /* 回填失败不阻断, 用户手动填写 */ })
  },
  onNameInput(e) { this.setData({ 'form.name': e.detail.value }) },
  onInput(e) {
    const field = e.currentTarget.dataset.field
    this.setData({ ['form.' + field]: e.detail.value })
  },
  onTypePick(e) { this.setData({ typeIndex: Number(e.detail.value) || 0 }) },
  onGenderPick(e) { this.setData({ genderIndex: Number(e.detail.value) || 0 }) },
  // 选照片
  选择照片() {
    wx.chooseImage({
      count: 1,
      sizeType: ['compressed'],
      sourceType: ['album', 'camera'],
      success: (res) => {
        const p = res.tempFilePaths && res.tempFilePaths[0]
        if (p) this.setData({ photoPath: p, previewUrl: p })
      },
    })
  },
  // 提交
  提交() {
    const f = this.data.form
    const name = String(f.name || '').trim()
    if (!name) {
      wx.showToast({ title: '请填写姓名', icon: 'none' })
      return
    }
    const type = this.data.typeOptions[this.data.typeIndex]
    if (!type || !type.value) {
      wx.showToast({ title: '请选择人员类型', icon: 'none' })
      return
    }
    if (this.data.mode === 'add' && !this.data.photoPath) {
      wx.showToast({ title: '请选择人脸照片', icon: 'none' })
      return
    }

    const origPid = String(this.data.originalPid || '').trim()
    const origName = String(this.data.originalName || '').trim()
    // pid 为唯一索引; 缺失直接报错, 不回退 name(避免重名串号/丢失标识)
    if (this.data.mode === 'edit' && !origPid) {
      wx.showToast({ title: '缺少人员标识(pid)，无法保存', icon: 'none' })
      return
    }
    const formData = { faceLibrary: type.value }
    if (this.data.mode === 'edit') {
      // 编辑: 仅用 pid 定位原记录; 改名时另带 newName(不再发送原 name 作索引)
      formData.pid = origPid
      if (name !== origName) formData.newName = name
    } else {
      formData.name = name
    }
    // 其余字段: 空字符串不发送(后端沿用现有值)
    ;['employeeNo', 'department', 'gender', 'age', 'idCard', 'phone', 'icCardNo', 'other'].forEach((k) => {
      const v = String(f[k] || '').trim()
      if (v) formData[k] = v
    })

    this.setData({ submitting: true })
    wx.showLoading({ title: this.data.mode === 'edit' ? '保存中...' : '添加中...', mask: true })

    const done = () => {
      wx.hideLoading()
      this.setData({ submitting: false })
      wx.showToast({ title: this.data.mode === 'edit' ? '已保存' : '已添加', icon: 'success' })
      setTimeout(() => wx.navigateBack(), 600)
    }
    const fail = (err) => {
      wx.hideLoading()
      this.setData({ submitting: false })
      wx.showToast({ title: (err && err.message) || '提交失败', icon: 'none' })
    }

    if (this.data.mode === 'edit') {
      api.faceLibrary.update(formData, this.data.photoPath).then(done).catch(fail)
    } else {
      api.faceLibrary.add(formData, this.data.photoPath).then(done).catch(fail)
    }
  },
  取消() {
    if (this.data.submitting) return
    wx.navigateBack()
  },
})
