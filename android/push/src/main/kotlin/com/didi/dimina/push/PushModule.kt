package com.didi.dimina.push

import android.content.Context
import android.content.Intent
import com.didi.dimina.bean.MiniProgram
import com.didi.dimina.core.MiniApp

/**
 * MQTT 推送模块入口, 宿主一行调用启用
 * 履历: 2026-07-17 创建, 初始化推送配置/注册 API/启动前台服务
 */
object PushModule {
    private var config: PushConfig? = null
    private var currentMiniProgram: MiniProgram? = null

    fun init(context: Context, config: PushConfig) {
        this.config = config
        MiniApp.getInstance().registerApi(MqttPushApi())
        ensureServiceStarted(context)
    }

    fun getConfig(): PushConfig? = config

    fun setCurrentMiniProgram(miniProgram: MiniProgram?) {
        currentMiniProgram = miniProgram
    }

    fun getCurrentMiniProgram(): MiniProgram? = currentMiniProgram

    fun ensureServiceStarted(context: Context) {
        context.startForegroundService(Intent(context, MqttPushService::class.java))
    }

    const val NOTIFICATION_CHANNEL_ID = "dimina_push"
}
