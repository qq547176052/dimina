package com.didi.dimina.push

import android.content.Context
import android.content.Intent
import android.provider.Settings
import android.util.Log
import com.didi.dimina.bean.MiniProgram
import com.didi.dimina.core.MiniApp

/**
 * MQTT 推送模块入口, 宿主一行调用启用
 * 履历:
 *   2026-07-17 创建, 初始化推送配置/注册 API/启动前台服务
 *   2026-07-18 新增 initDefault 默认初始化, 内聚 broker 等默认配置, 宿主一行接入
 */
object PushModule {
    private var config: PushConfig? = null
    private var currentMiniProgram: MiniProgram? = null

    /** 使用默认配置初始化推送模块, clientId 由设备 ANDROID_ID 生成保证唯一 */
    fun initDefault(context: Context) {
        val deviceId = Settings.Secure.getString(context.contentResolver, Settings.Secure.ANDROID_ID)
        val config = PushConfig(
            broker = DEFAULT_BROKER,
            clientId = "${DEFAULT_CLIENT_PREFIX}$deviceId",
            username = DEFAULT_USERNAME,
            password = DEFAULT_PASSWORD,
            useSsl = false,
            topics = DEFAULT_TOPICS,
        )
        Log.d("PushModule", "mqtt id: ${config.clientId}")
        init(context, config)
    }

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

    // ---- 默认配置, 按实际环境替换 ----
    /** MQTT broker 地址, 如 "ssl://host:8883" 或 "tcp://host:1883" */
    private const val DEFAULT_BROKER = "tcp://mqtt.jsauto.hk.cn:1883"
    /** clientId 前缀, 与设备标识拼接保证唯一 */
    private const val DEFAULT_CLIENT_PREFIX = "dimina_demo_"
    private val DEFAULT_USERNAME: String? = null
    private val DEFAULT_PASSWORD: String? = null
    /** 启动后自动订阅的主题, 按实际业务替换 */
    private val DEFAULT_TOPICS = listOf("dimina/push")
}

/*
推送通知使用文档 (payload 为 JSON 格式):
业务服务端往 topics 主题发布一条 MQTT 消息, payload 为如下 JSON:
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

***使用这个模式
https://www.lddgo.net/convert/imagebasesix
上面链接能将图片转为 base64
小缩略图+下拉展开大图
{
  "title":   "通知标题",
  "content": "模式=custom_thumb",
  "level":   "high",
  "style":   "custom_thumb",
  "image":   "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAIAAAD8GO2jAAAAOUlEQVR42u3NMQ0AIBAEwZezmlCCMGqUfI0ONFz5ySbTTzVE2B0pAwMDA4MRAWdF3iViYGBgYDAi+MoOqkz2a0leAAAAAElFTkSuQmCC",
  "close":   "true"
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
  "url":     "https://...",     // 可选 点击跳转网页
  "miniProgram": {              // 可选 点击打开指定小程序(优先级 url > miniProgram > 当前小程序 > app)
    "appId": "wxpushjpg0001",  //   小程序 appId (必填, 见 miniapp/pushjpg 示例: 接收通知并展示图片)
    "name":  "示例小程序",       //   可选 名称
    "path":  "pages/index/index" //   可选 入口页, 原始 JSON 作为启动参数经 query.payload 传入
  },
  "close":   "true"             // 可选 点击仅关闭横幅不跳转 app(优先级最高, 默认 false)
}

说明:
1. 被动接收 (推荐): 服务端发布上述 JSON, App 自动弹通知。
2. 小程序侧: wx.mqttPublish({ topic, payload, qos }), payload 同上 JSON 字符串。
3. 宿主主动: NotificationHelper.showNotification(context, title, content,
   miniProgram, data) 直接弹通知, miniProgram 非空时点击跳转对应小程序。
4. 打开小程序并传参: payload 含 miniProgram 字段时, 点击打开该小程序,
   原始 JSON 经 path 的 query.payload 传入, 小程序侧通过 onLaunch(options.query.payload) 获取。
示例 (MQTTX 往 dimina/push 发布):
   topic  : dimina/push
   payload: {"title":"新版本发布","content":"Dimina 2.0 已上线","level":"high",
             "image":"https://host/cover.png","url":"https://example.com/release"}
效果: 高重要级横幅通知, 带大图, 点击跳转示例网页。
注: payload 非合法 JSON 时, 整段作为正文, 标题用 "通知"。
 */
