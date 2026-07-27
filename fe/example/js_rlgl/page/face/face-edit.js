// page/face/face-edit.js
// 简介: 人脸库新增/编辑表单页; 添加走 wx.uploadFile(必传照片), 编辑可只改字段或换照; 复用 api.faceLibrary
// 履历:
//   2026-07-27 新建: 姓名/工号/部门/类型/性别/年龄/证件/电话/IC卡/有效期 表单 + 选照片;
//             编辑模式按 name 拉取当前值回填; 保存成功返回列表并刷新
//   2026-07-27 索引改 pid: originalPid 可靠索引(协议 /person/* 主键); 提交带 pid 走 camera 端点
//             (api.faceLibraryCamera.update), 不再仅依赖 name(避免重名/改名/非 ASCII 名传输丢字段)
//   2026-07-27 修复"pid 或 name 必填": 编辑回填时按 pid/name 精确定位行并同步写回 originalName/originalPid,
//             提交前双空则直接拦截提示, 避免 query 缺字段导致后端校验失败
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
      validityType: '',
      validityStartTime: '',
      validityEndTime: '',
      other: '',
    },
    photoPath: '',      // 选中/当前照片的本地临时路径
    previewUrl: '',     // 头像预览(选图或下载当前图)
    submitting: false,
    placeholderAvatar,
  },
  onLoad(query) {
    const mode = query.mode === 'edit' ? 'edit' : 'add'
    this.setData({ mode })
    wx.setNavigationBarTitle({ title: mode === 'edit' ? '编辑人员' : '新增人员' })
    if (mode === 'edit') {
      const name = decodeURIComponent(query.name || '')
      const pid = decodeURIComponent(query.pid || '')
      this.setData({ originalName: name, originalPid: pid })
      this.拉取并回填(name, pid)
    }
  },
  // 编辑模式: 按姓名(或 pid)取当前值回填
  // 注: 摄像头固件未必返回 pid, 故 name 与 pid 互补; 回填后一定把 originalName/originalPid 写回,
  //     防止 query 缺字段导致提交时"pid 或 name(原姓名) 必填"
  拉取并回填(name, pid) {
    if (!name && !pid) return
    api.faceLibraryCamera.list({ name: name || '', pageSize: 100 })
      .then((payload) => {
        const rows = (payload && payload.list) || []
        let row = null
        if (pid) {
          row = rows.find((r) => r.pid === pid) || null
        }
        if (!row && name) {
          row = rows.find((r) => r.name === name) || null
        }
        if (!row) return
        // 把查询到的 name/pid 写回原始索引(优先行记录, 兜底 query 传入值)
        this.setData({
          originalName: row.name || this.data.originalName || '',
          originalPid: row.pid || this.data.originalPid || '',
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
          validityType: row.validityType || '',
          validityStartTime: row.validityStartTime || '',
          validityEndTime: row.validityEndTime || '',
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
            url: api.faceLibraryCamera.imageUrl(row.imageName),
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

    if (this.data.mode === 'edit' && !this.data.originalPid && !this.data.originalName) {
      wx.showToast({ title: '页面参数异常，请返回列表重新进入编辑', icon: 'none' })
      return
    }
    const formData = { faceLibrary: type.value }
    if (this.data.mode === 'edit') {
      // 编辑: pid(可靠索引) 优先定位, name 作兜底; 改名时另带 newName
      if (this.data.originalPid) formData.pid = this.data.originalPid
      if (this.data.originalName) formData.name = this.data.originalName
      if (name !== this.data.originalName) formData.newName = name
    } else {
      formData.name = name
    }
    // 其余字段: 空字符串不发送(后端沿用现有值)
    ;['employeeNo', 'department', 'gender', 'age', 'idCard', 'phone', 'icCardNo', 'validityType', 'validityStartTime', 'validityEndTime', 'other'].forEach((k) => {
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
      api.faceLibraryCamera.update(formData, this.data.photoPath).then(done).catch(fail)
    } else {
      api.faceLibrary.add(formData, this.data.photoPath).then(done).catch(fail)
    }
  },
  取消() {
    if (this.data.submitting) return
    wx.navigateBack()
  },
})
