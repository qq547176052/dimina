package com.didi.dimina.push

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import com.didi.dimina.common.LogUtils
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import org.json.JSONObject

/**
 * MQTT 推送前台服务, 维持长连接保活
 * 履历: 2026-07-17 创建, 前台服务承载 MQTT 长连接与消息分发
 * 履历: 2026-07-18 payload 改为 JSON 格式解析 (title/content/level/image/url)
 */
class MqttPushService : Service() {
    private val tag = "MqttPushService"
    private val manager = MqttManager.getInstance()

    override fun onCreate() {
        super.onCreate()
        startForeground(NOTIFY_ID, createForegroundNotification())

        manager.onMessage = { _, payload, _ ->
            val (title, content, data) = parsePushPayload(payload)
            NotificationHelper.showNotification(this, title, content, PushModule.getCurrentMiniProgram(), data)
        }

        val config = PushModule.getConfig()
        if (config == null) {
            LogUtils.e(tag, "push config is null, stop service")
            stopSelf()
            return
        }
        CoroutineScope(Dispatchers.IO).launch {
            manager.connect(config)
                .onFailure { LogUtils.e(tag, "mqtt connect failed: ${it.message}") }
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        return START_STICKY
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        manager.disconnect()
        super.onDestroy()
    }

    /**
     * 解析推送 payload:
     * 合法 JSON 时提取 title/content/level/image/url;
     * 非 JSON 时整段作为正文, 标题用 "通知"。
     */
    private fun parsePushPayload(payload: ByteArray): Triple<String, String, Map<String, String>> {
        val raw = String(payload, Charsets.UTF_8)
        return try {
            val json = JSONObject(raw)
            val title = json.optString("title", "通知")
            val content = json.optString("content", json.optString("body", ""))
            val data = mutableMapOf<String, String>()
            json.keys().forEach { key -> json.opt(key)?.let { data[key] = it.toString() } }
            Triple(title, content, data)
        } catch (e: Exception) {
            LogUtils.e(tag, "payload not json, treat as plain text: ${e.message}")
            Triple("通知", raw, emptyMap())
        }
    }

    private fun createForegroundNotification() = NotificationCompat.Builder(this, PushModule.NOTIFICATION_CHANNEL_ID).apply {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                PushModule.NOTIFICATION_CHANNEL_ID,
                "推送通知",
                NotificationManager.IMPORTANCE_LOW,
            )
            (getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager).createNotificationChannel(channel)
        }
        setContentTitle("推送服务")
        setContentText("正在接收推送消息")
        setSmallIcon(android.R.drawable.ic_dialog_info)
        setOngoing(true)
    }.build()

    companion object {
        private const val NOTIFY_ID = 1001
    }
}
