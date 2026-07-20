package com.didi.dimina.demo

import android.app.Application
import com.didi.dimina.Dimina
import com.didi.dimina.push.PushModule

/**
 * 宿主 Application, 初始化 Dimina 与推送模块
 * 履历:
 *   2026-07-18 集成 push 模块初始化
 *   2026-07-18 推送配置与使用文档下沉至 push 模块, 改为 PushModule.initDefault 一行接入
 */
class App : Application() {
    override fun onCreate() {
        super.onCreate()
        Dimina.init(this, Dimina.DiminaConfig.Builder()
            .setDebugMode(true)
            .build()
        )
        PushModule.initDefault(this)
    }
}
