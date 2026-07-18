package com.didi.dimina.demo

import android.app.Application
import android.provider.Settings
import android.util.Log
import com.didi.dimina.Dimina
import com.didi.dimina.push.PushConfig
import com.didi.dimina.push.PushModule

/**
 * 宿主 Application, 初始化 Dimina 与推送模块
 * 履历: 2026-07-18 集成 push 模块初始化
 */
class App : Application() {
    override fun onCreate() {
        super.onCreate()
        Dimina.init(this, Dimina.DiminaConfig.Builder()
            .setDebugMode(true)
            .build()
        )
        initPush()
    }

    /** 初始化推送模块, broker 等配置按实际环境替换 */
    private fun initPush() {
        val deviceId = Settings.Secure.getString(contentResolver, Settings.Secure.ANDROID_ID)
        val config = PushConfig(
            broker = PUSH_BROKER,
            clientId = "dimina_demo_$deviceId",
            username = PUSH_USERNAME,
            password = PUSH_PASSWORD,
            useSsl = false,
            topics = PUSH_TOPICS,
        )
        Log.d("App", "mqtt id: $config.clientId")
        PushModule.init(this, config)
    }

    companion object {
        /** MQTT broker 地址, 如 "ssl://host:8883" 或 "tcp://host:1883" */
        private const val PUSH_BROKER = "tcp://mqtt.jsauto.hk.cn:1883"
        private val PUSH_USERNAME: String? = null
        private val PUSH_PASSWORD: String? = null
        /** 启动后自动订阅的主题, 按实际业务替换 */
        private val PUSH_TOPICS = listOf("dimina/push")
    }
    /*
推送通知使用文档 (payload 为 JSON 格式):
业务服务端往 PUSH_TOPICS 主题发布一条 MQTT 消息, payload 为如下 JSON:
{
  "title":   "通知标题",
  "content": "通知正文",
  "level":   "high",
  "image":   "https://pc.jsauto.hk.cn:8899/api/files/upload/file-1783845229893-aaaf98ca.png"
}

{
  "title":   "通知标题",
  "content": "通知正文",
  "level":   "high",
  "image":   "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAIAAAD8GO2jAAAAOUlEQVR42u3NMQ0AIBAEwZezmlCCMGqUfI0ONFz5ySbTTzVE2B0pAwMDA4MRAWdF3iViYGBgYDAi+MoOqkz2a0leAAAAAElFTkSuQmCC"
}

大缩略图+下拉
{
  "title":   "通知标题",
  "content": "模式=custom",
  "level":   "high",
  "style": "custom",
  "image":   "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAIAAAD8GO2jAAAAOUlEQVR42u3NMQ0AIBAEwZezmlCCMGqUfI0ONFz5ySbTTzVE2B0pAwMDA4MRAWdF3iViYGBgYDAi+MoOqkz2a0leAAAAAElFTkSuQmCC"
}

需要下拉
{
  "title":   "通知标题",
  "content": "模式=custom_big",
  "level":   "high",
  "style": "custom_big",
  "image":   "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAIAAAD8GO2jAAAAOUlEQVR42u3NMQ0AIBAEwZezmlCCMGqUfI0ONFz5ySbTTzVE2B0pAwMDA4MRAWdF3iViYGBgYDAi+MoOqkz2a0leAAAAAElFTkSuQmCC"
}


小缩略图+下拉展开大图
{
  "title":   "通知标题",
  "content": "模式=custom_thumb",
  "level":   "high",
  "style":   "custom_thumb",
  "image":   "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAIAAAD8GO2jAAAAOUlEQVR42u3NMQ0AIBAEwZezmlCCMGqUfI0ONFz5ySbTTzVE2B0pAwMDA4MRAWdF3iViYGBgYDAi+MoOqkz2a0leAAAAAElFTkSuQmCC"
}




小缩略图+下拉 通知时没有图片
{
  "title":   "通知标题",
  "content": "模式=bigpicture",
  "level":   "high",
  "style": "bigpicture",
  "image":   "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAIAAAD8GO2jAAAAOUlEQVR42u3NMQ0AIBAEwZezmlCCMGqUfI0ONFz5ySbTTzVE2B0pAwMDA4MRAWdF3iViYGBgYDAi+MoOqkz2a0leAAAAAElFTkSuQmCC"
}


{
  "title":   "通知标题",        // 可选, 缺省 "通知"
  "content": "通知正文",         // 正文内容 (也可用 "body")
  "level":   "high",            // 可选 min/low/default/high/max, 缺省 default
  "image":   "https://...png",  // 可选 图片URL 或 data:image base64, 带图通知
                             //   base64 内嵌不依赖网络下载, 适合内网/证书不可达场景
  "style":   "custom",        // 可选 图片展示方式: custom(默认, 自定义UI 收起即显示图) / custom_big(自定义UI 仅展开显示图, 需下拉) / bigpicture(系统大图样式)
  "url":     "https://..."      // 可选 点击跳转网页, 优先于小程序跳转
}


说明:
1. 被动接收 (推荐): 服务端发布上述 JSON, App 自动弹通知。
2. 小程序侧: wx.mqttPublish({ topic, payload, qos }), payload 同上 JSON 字符串。
3. 宿主主动: NotificationHelper.showNotification(context, title, content,
   miniProgram, data) 直接弹通知, miniProgram 非空时点击跳转对应小程序。
示例 (MQTTX 往 dimina/push 发布):
   topic  : dimina/push
   payload: {"title":"新版本发布","content":"Dimina 2.0 已上线","level":"high",
             "image":"https://host/cover.png","url":"https://example.com/release"}
效果: 高重要级横幅通知, 带大图, 点击跳转示例网页。
注: payload 非合法 JSON 时, 整段作为正文, 标题用 "通知"。
     */
}