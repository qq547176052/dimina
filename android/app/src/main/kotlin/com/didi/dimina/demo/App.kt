package com.didi.dimina.demo

import android.app.Application
import com.didi.dimina.Dimina
import com.didi.dimina.common.LogUtils
import com.didi.dimina.push.PushModule

/**
 * 宿主 Application, 初始化 Dimina 与推送模块
 * 履历:
 *   2026-07-18 集成 push 模块初始化
 *   2026-07-18 推送配置与使用文档下沉至 push 模块, 改为 PushModule.initDefault 一行接入
 *   2026-07-21 默认启动 admin_app, 将 DiminaActivity 设为 LAUNCHER
 *   2026-07-22 默认小程序配置提取为变量, 增加打开失败/成功日志便于排查
 */
class App : Application() {
    // 默认启动小程序配置, 集中存放便于后期修改
    private val defaultAppId = "wxd58cedf6d1e1c52c"

    override fun onCreate() {
        super.onCreate()
        Dimina.init(this, Dimina.DiminaConfig.Builder()
            .setDebugMode(true)
            .build()
        )
        PushModule.initDefault(this)
        // 注册默认启动小程序（DiminaActivity 作为 LAUNCHER 时兜底使用）
        // 先从 config.json 读取参数配置存到变量, 再设置默认小程序, 便于后期修改配置
        val miniProgram = Dimina.getInstance().getMiniProgram(defaultAppId)
        if (miniProgram == null) {
            LogUtils.e(TAG, "打开小程序失败: appId=$defaultAppId 未读取到 config.json 或解析出错")
        } else {
            LogUtils.i(TAG, "打开小程序: appId=${miniProgram.appId}, name=${miniProgram.name}, path=${miniProgram.path}, version=${miniProgram.versionName}")
            miniProgram.name = ""
            Dimina.getInstance().setDefaultMiniProgram(miniProgram)
        }
    }

    companion object {
        private const val TAG = "DemoApp"
    }
}
