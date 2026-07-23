package cn.hk.jsauto.jsapp

import android.content.Context
import android.provider.Settings
import com.didi.dimina.push.PushConfig
import java.io.File

/**
 * 宿主统一配置: 集中管理默认小程序、小程序更新仓库、列表排除与 MQTT 推送配置, 按环境统一修改此处即可
 * 履历:
 *   2026-07-22 创建, 从 App.kt/PushModule.kt 汇集默认配置, 统一存放于 config 目录
 *   2026-07-23 新增小程序更新仓库(cnb.cool git raw)地址与部署令牌, 供 UpMiniApp 检查/下载新版本
 *   2026-07-23 按业务域拆分为 MiniApp / UpdateRepo / Push 嵌套对象, 配置分类不再堆叠
 *   2026-07-23 新增 UpdateCache: 统一小程序更新落盘目录(下载包/暂存/沙盒/备份), 全部位于
 *              filesDir/jsapp 持久区, 替代易失的 cacheDir, 避免更新包被系统回收丢失
 */
object AppConfig {
    // ---- 默认启动小程序 ----
    object MiniApp {
        /** 默认启动小程序 appId, DiminaActivity 作为 LAUNCHER 时兜底使用 */
        const val DEFAULT_APP_ID = "wxd58cedf6d1e1c52c"
    }

    // ---- 小程序更新仓库(git raw), 供 UpMiniApp 使用 ----
    object UpdateRepo {
        /** 仓库 raw 文件根地址, 更新源为 {base}/{appId}/config.json 与 {base}/{appId}/{appId}.zip */
        const val RAW_BASE = "https://api.cnb.cool/547176052/dimina/jsapp/-/git/raw/master"
        /** Basic Auth 用户名(cnb.cool 固定为 cnb) */
        const val USER = "cnb"
        /** 部署令牌(只读权限即可), 按实际环境替换 */
        const val TOKEN = "a5OKKY78zuK3d51yZ4BEdr4EOYC"
    }

    // ---- 小程序更新落盘目录(全部位于 filesDir/jsapp 持久区, 不随系统清理 cache 丢失) ----
    // 下载包 / 暂存(已校验待生效) / 沙盒(已生效) / 备份(回滚) 均集中于此, 供 UpMiniApp 统一读写。
    object UpdateCache {
        /** 更新根目录名 */
        private const val ROOT = "jsapp"
        /** 下载的 zip 包子目录(持久, 替代易失的 cacheDir) */
        private const val DOWNLOAD_DIR = "downloads"
        /** 备份(回滚)目录前缀 */
        private const val BACKUP_PREFIX = ".backup-"

        /** 更新根目录: filesDir/jsapp, 不存在则创建 */
        fun getRootDir(context: Context): File =
            File(context.filesDir, ROOT).apply { mkdirs() }

        /** 下载 zip 包目录: filesDir/jsapp/downloads(持久, 不随系统清理 cache 丢失) */
        fun getDownloadDir(context: Context): File =
            File(getRootDir(context), DOWNLOAD_DIR).apply { mkdirs() }

        /** 沙盒(已生效)目录: filesDir/jsapp/<appId> */
        fun getSandboxDir(context: Context, appId: String): File =
            File(getRootDir(context), appId)

        /** 备份目录: filesDir/jsapp/.backup-<appId>(替换失败用于回滚) */
        fun getBackupDir(context: Context, appId: String): File =
            File(getRootDir(context), "$BACKUP_PREFIX$appId")
    }

    // ---- 列表排除的小程序 ----
    object AppList {
        /** AppList.getList 不展示的小程序 appId(含默认启动小程序自身), 按实际环境维护 */
        val EXCLUDED_APP_IDS = setOf(
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
    }

    // ---- MQTT 推送, 按实际环境替换 ----
    object Push {
        /** broker 地址, 如 "ssl://host:8883" 或 "tcp://host:1883" */
        const val BROKER = "tcp://mqtt.jsauto.hk.cn:1883"
        /** clientId 前缀, 与设备标识拼接保证唯一 */
        const val CLIENT_PREFIX = "dimina_demo_"
        val USERNAME: String? = null
        val PASSWORD: String? = null
        const val USE_SSL = false
        /** 启动后自动订阅的主题 */
        val TOPICS = listOf("dimina/push")
    }

    /** 用设备 ANDROID_ID 生成唯一 clientId, 构造推送配置 */
    fun buildPushConfig(context: Context): PushConfig {
        val deviceId = Settings.Secure.getString(context.contentResolver, Settings.Secure.ANDROID_ID)
        return PushConfig(
            broker = Push.BROKER,
            clientId = "${Push.CLIENT_PREFIX}$deviceId",
            username = Push.USERNAME,
            password = Push.PASSWORD,
            useSsl = Push.USE_SSL,
            topics = Push.TOPICS,
        )
    }
}
