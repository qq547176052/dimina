package cn.hk.jsauto.jsapp

import android.app.Application
import com.didi.dimina.Dimina
import com.didi.dimina.common.LogUtils
import com.didi.dimina.push.PushModule

/**
 * 宿主 Application, 仅负责初始化 Dimina 与推送模块。
 * 小程序拉起与 AppList 扩展模块已迁移至 MainActivity。
 * 履历:
 *   2026-07-18 集成 push 模块初始化
 *   2026-07-18 推送配置与使用文档下沉至 push 模块, 改为 PushModule.initDefault 一行接入
 *   2026-07-21 默认启动 admin_app, 将 DiminaActivity 设为 LAUNCHER
 *   2026-07-22 默认小程序配置提取为变量, 增加打开失败/成功日志便于排查
 *   2026-07-22 默认小程序配置经 copy 改名, 支持后期修改 name 等只读字段
 *   2026-07-22 源码包名由 com.didi.dimina.demo 迁移至 cn.hk.jsauto.jsapp, 与 applicationId 对齐
 *   2026-07-22 注册 AppList 扩展模块, 小程序首页经 wx.extBridge 获取小程序列表并拉起对应小程序
 *   2026-07-22 AppList.getList 排除默认启动小程序自身(defaultAppId), 避免首页列表重复显示当前应用
 *   2026-07-22 默认小程序与推送配置统一抽取至 config/AppConfig, 本类改为引用统一配置
 *   2026-07-22 LAUNCHER 改用 MainActivity, 进入即经 startMiniProgram 拉起默认小程序,
 *              复刻 app 模块成功路径, 修复发布版首冷启动白屏(二次才成功)的问题
 *   2026-07-22 AppList 扩展模块与前台 Activity 跟踪迁出至 MainActivity, 本类仅保留 Dimina/push 初始化
 */
class App : Application() {

    companion object {
        private const val TAG = "DemoApp"
    }

    override fun onCreate() {
        super.onCreate()
        Dimina.init(this, Dimina.DiminaConfig.Builder()
            .setDebugMode(true)
            .build()
        )
        val pushConfig = AppConfig.buildPushConfig(this)
        LogUtils.i(TAG, "mqtt clientId: ${pushConfig.clientId}")
        PushModule.init(this, pushConfig)
    }

}
