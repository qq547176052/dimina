package cn.hk.jsauto.jsapp

import android.content.Context
import android.provider.Settings
import com.didi.dimina.push.PushConfig
import java.io.File

/**
 * 宿主统一配置: 集中管理默认小程序、MQTT 推送、小程序远程更新(cnb 源)等配置, 按环境统一修改此处即可
 * 履历:
 *   2026-07-22 创建, 从 App.kt/PushModule.kt 汇集默认配置, 统一存放于 config 目录
 *   2026-07-24 新增分类: 小程序远程更新(cnb 仓库 raw), 含 cnb 源地址/鉴权与下载目录
 */
object AppConfig {
    // ---- 默认启动小程序 ----
    /** 默认启动小程序 appId, DiminaActivity 作为 LAUNCHER 时兜底使用 */
    const val DEFAULT_APP_ID = "wxd58cedf6d1e1c52c"

    // ---- 列表排除的小程序 ----
    /** 小程序管理扩展模块(获取列表)不展示的小程序 appId(含默认启动小程序自身), 按实际环境维护 */
    val EXCLUDED_LIST_APP_IDS = setOf(
        "2145"
//        "wx1c01b35002d3ba14",
        // "wx6d707864656d6f01",
        // "wx92269e3b2f304afc",
        // "wxa87711629f79170c",
        // "wxbaf4b47de04f1d8a",
        // "wxd58cedf6d1e1c52c",
        // "wxe5f52902cf4de896",
        // "wxe5f52902cf4dejs1",
    )

    // ---- MQTT 推送, 按实际环境替换 ----
    /** broker 地址, 如 "ssl://host:8883" 或 "tcp://host:1883" */
    const val PUSH_BROKER = "tcp://mqtt.jsauto.hk.cn:1883"
    /** clientId 前缀, 与设备标识拼接保证唯一 */
    const val PUSH_CLIENT_PREFIX = "dimina_demo_"
    val PUSH_USERNAME: String? = null
    val PUSH_PASSWORD: String? = null
    const val PUSH_USE_SSL = false
    /** 启动后自动订阅的主题 */
    val PUSH_TOPICS = listOf("dimina/push")

    // ================= 小程序远程更新(cnb 仓库 raw) =================
    /** cnb raw 地址前缀(仓库: dimina/jsapp, 分支: master) */
    const val UPDATE_CNB_BASE = "https://api.cnb.cool/547176052/dimina/jsapp/-/git/raw/master"
    /** Basic Auth 用户名(固定为 cnb) */
    const val UPDATE_CNB_USER = "cnb"
    /**
     * Basic Auth 令牌。
     * 注意: 真实部署令牌不应硬编码进版本库; 此处取自设计文档, 生产应改为安全存储或 BuildConfig 注入
     */
    const val UPDATE_CNB_TOKEN = "a5OKKY78zuK3d51yZ4BEdr4EOYC"
    /** 下载新版本小程序压缩包(及其暂存)的根目录名(位于 cacheDir 下, 安装到 .pending 后由引擎清理) */
    const val UPDATE_DOWNLOAD_DIR_NAME = "dimina-updates"
    /** 下载新版本小程序压缩包的存放目录(基于 cacheDir(下载用, 安装后清理); 安装暂存由引擎 RemoteUpdateManager 落 .pending) */
    fun updateDownloadDir(context: Context): File =
        File(context.cacheDir, UPDATE_DOWNLOAD_DIR_NAME).apply { mkdirs() }

    /** 用设备 ANDROID_ID 生成唯一 clientId, 构造推送配置 */
    fun buildPushConfig(context: Context): PushConfig {
        val deviceId = Settings.Secure.getString(context.contentResolver, Settings.Secure.ANDROID_ID)
        return PushConfig(
            broker = PUSH_BROKER,
            clientId = "$PUSH_CLIENT_PREFIX$deviceId",
            username = PUSH_USERNAME,
            password = PUSH_PASSWORD,
            useSsl = PUSH_USE_SSL,
            topics = PUSH_TOPICS,
        )
    }
}
