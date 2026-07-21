package com.didi.dimina.demo

import android.app.Application
import com.didi.dimina.Dimina
import com.didi.dimina.push.PushModule

/**
 * 宿主 Application, 初始化 Dimina 与推送模块
 * 履历:
 *   2026-07-18 集成 push 模块初始化
 *   2026-07-18 推送配置与使用文档下沉至 push 模块, 改为 PushModule.initDefault 一行接入
 *   2026-07-21 默认启动 admin_app, 将 DiminaActivity 设为 LAUNCHER
 */
class App : Application() {
    override fun onCreate() {
        super.onCreate()
        Dimina.init(this, Dimina.DiminaConfig.Builder()
            .setDebugMode(true)
            .build()
        )
        PushModule.initDefault(this)
        // 注册默认启动小程序（DiminaActivity 作为 LAUNCHER 时兜底使用）
        // 根据 appId 从 config.json 动态读取, 避免写死版本与入口
        Dimina.getInstance().getMiniProgram("wxd58cedf6d1e1c52c")?.let {
            Dimina.getInstance().setDefaultMiniProgram(it)
        }
    }
}
