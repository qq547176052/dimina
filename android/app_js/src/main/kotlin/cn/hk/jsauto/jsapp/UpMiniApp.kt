package cn.hk.jsauto.jsapp

import android.app.Activity
import android.app.Application
import android.content.Context
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.util.Base64
import com.didi.dimina.Dimina
import com.didi.dimina.api.ext.ExtCallback
import com.didi.dimina.common.LogUtils
import com.didi.dimina.common.VersionUtils
import com.didi.dimina.ui.container.DiminaActivity
import org.json.JSONObject
import java.io.File
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.ConcurrentHashMap
import java.util.zip.ZipInputStream

/*
id为DEFAULT_APP_ID的小程序更新方式,流程是:点击检查更新->提示有新版本确认更新->下载新版本的压缩包->实时显示下载进度->提示重启小程序->关闭(MainActivity.kt)->解压->启动小程序
因为id为DEFAULT_APP_ID的小程序是首页 小程序一直有运行的 所以不适合后台自动更新,其他小程序不是首页 适合后台自动更新

其他小程序更新方式,流程是:启动小程序时自动检测新版本 后台自动下载新版本 下载好后不要解压替换 等待小程序关闭后解压替换 要注意考虑小程序关闭后立即启动的场景解决方案

 */

/**
 * 小程序更新模块: 以 git 仓库(cnb.cool)为更新源。
 *
 * 统一更新模型(只在小程序【未运行】时替换沙盒, 彻底避开运行期替换导致的 ANR/卡死):
 *  - 启动小程序时: 后台检查版本 + 下载新版本压缩包到落盘缓存(filesDir/jsapp/downloads), 仅写缓存, 不动沙盒
 *  - 关闭小程序时: 若本地存在已下载完成的新版本(zip + 配套描述文件齐备且版本更高), 删除旧沙盒并解压新版本到沙盒
 *    关闭时刻小程序已停止运行, 替换沙盒安全无卡死。
 * 关闭时判定依据为落盘缓存中的 zip 与 <appId>-<version>.config.json(下载完整后才写, 半包不会误装)。
 *
 * 履历:
 *   2026-07-23 创建, 仓库地址与令牌取自 AppConfig, HTTP Basic Auth
 *   2026-07-23 区分首页(手动)与非常驻(后台自动)两类更新策略 + 待生效暂存目录
 *   2026-07-23 更新落盘目录统一收敛至 AppConfig.UpdateCache(持久区)
 *   2026-07-23 重构为统一模型: 启动后台下载 zip(落盘缓存), 关闭时若下载完成则解压替换沙盒;
 *              移除内存 pending/暂存目录, 改以磁盘 zip + 描述文件判定, 跨进程重启仍有效
 */
object UpMiniApp {
    private const val TAG = "MiniApp"
    private const val MODULE = "MiniAppUpdate"
    private const val BUFFER_SIZE = 8192
    private const val STAGE_DOWNLOAD = "download"

    // 新包必须包含的关键文件, 与框架解压校验(DiminaActivity)一致
    private val REQUIRED_PATHS = listOf("main/app-config.json", "main/logic.js")

    // 进度订阅回调(extOnBridge "progress"): 前端订阅后保存, 下载中流式上报百分比
    @Volatile
    private var progressCallback: ExtCallback? = null

    // 防重入: 同一 appId 不并发下载(避免重复拉包与缓存竞争)
    private val checking = ConcurrentHashMap<String, Boolean>()

    // 跟踪当前前台 DiminaActivity, 供 install(手动重启)时安全关闭并冷重启
    @Volatile
    private var currentActivity: DiminaActivity? = null

    fun register(context: Context) {
        val appContext = context.applicationContext
        (appContext as Application).registerActivityLifecycleCallbacks(
            object : Application.ActivityLifecycleCallbacks {
                override fun onActivityCreated(a: Activity, b: Bundle?) {
                    if (a is DiminaActivity) currentActivity = a
                }
                override fun onActivityStarted(a: Activity) {
                    if (a is DiminaActivity) currentActivity = a
                }
                override fun onActivityResumed(a: Activity) {
                    if (a is DiminaActivity) currentActivity = a
                }
                override fun onActivityPaused(a: Activity) {}
                override fun onActivityStopped(a: Activity) {}
                override fun onActivitySaveInstanceState(a: Activity, b: Bundle) {}
                override fun onActivityDestroyed(a: Activity) {
                    if (a === currentActivity) currentActivity = null
                    // 小程序关闭: 此刻已停止运行, 若本地已下载完成新版本则解压替换沙盒(安全无卡死)
                    val appId = (a as? DiminaActivity)?.appId ?: return
                    applyPendingOnClose(appId, appContext)
                }
            },
        )
        Dimina.getInstance().registerExtModule(MODULE) { event, data, callback ->
            val appId = data.optString("appId").ifBlank { AppConfig.MiniApp.DEFAULT_APP_ID }
            when (event) {
                "check" -> {
                    Thread { checkVersionOnly(appContext, appId, callback) }.start()
                    null
                }
                "download" -> {
                    if (checking.putIfAbsent(appId, true) != null) {
                        callback.onFail(JSONObject().apply { put("errMsg", "updating") })
                        return@registerExtModule null
                    }
                    Thread { downloadUpdate(appContext, appId, callback) }.start()
                    null
                }
                "install" -> {
                    installUpdate(appContext, appId, callback)
                    null
                }
                "progress" -> {
                    progressCallback = callback
                    java.lang.Runnable { progressCallback = null }
                }
                else -> {
                    callback.onFail(JSONObject().apply { put("errMsg", "unknown event: $event") })
                    null
                }
            }
        }
    }

    // 仅比对版本号, 不下载(供首页"检查更新"快速判断)
    private fun checkVersionOnly(context: Context, appId: String, callback: ExtCallback) {
        try {
            val remoteConfig = fetchRemoteConfig(appId)
            val remoteVersion = remoteConfig.getInt("versionCode")
            val localVersion = localVersion(appId)
            if (remoteVersion <= localVersion) {
                callback.onSuccess(JSONObject().apply { put("hasUpdate", false) })
                return
            }
            callback.onSuccess(JSONObject().apply {
                put("hasUpdate", true)
                put("versionCode", remoteVersion)
                put("versionName", remoteConfig.optString("versionName"))
            })
        } catch (e: Exception) {
            LogUtils.e(TAG, "检查版本失败: appId=$appId, ${e.message}")
            callback.onFail(JSONObject().apply { put("errMsg", "check fail: ${e.message}") })
        }
    }

    // 启动小程序时调用: 后台检查版本并下载新版本 zip 到落盘缓存(仅写缓存, 不动沙盒)。
    // 下载成功后写配套描述文件, 供关闭时判定"下载完成且版本更新"。
    fun backgroundCheckAndDownload(appId: String, context: Context) {
        if (checking.putIfAbsent(appId, true) != null) return
        Thread {
            try {
                val (zip, _) = downloadAndStage(context, appId)
                if (zip != null) {
                    LogUtils.d(TAG, "后台下载就绪(待关闭时生效): appId=$appId, file=${zip.name}")
                }
            } catch (e: Exception) {
                LogUtils.e(TAG, "后台检查/下载失败: appId=$appId, ${e.message}")
            } finally {
                checking.remove(appId)
            }
        }.start()
    }

    // 手动下载事件: 检查+下载到缓存, 进度条实时展示; 完成后提示重启
    private fun downloadUpdate(context: Context, appId: String, callback: ExtCallback) {
        try {
            reportProgress(STAGE_DOWNLOAD, 0)
            val (zip, remoteConfig) = downloadAndStage(context, appId) { p -> reportProgress(STAGE_DOWNLOAD, p) }
            if (zip == null || remoteConfig == null) {
                callback.onSuccess(JSONObject().apply { put("downloaded", false) })
                return
            }
            callback.onSuccess(JSONObject().apply {
                put("downloaded", true)
                put("versionCode", remoteConfig.getInt("versionCode"))
                put("versionName", remoteConfig.optString("versionName"))
            })
        } catch (e: Exception) {
            LogUtils.e(TAG, "下载失败: appId=$appId, ${e.message}")
            callback.onFail(JSONObject().apply { put("errMsg", "download fail: ${e.message}") })
        } finally {
            checking.remove(appId)
        }
    }

    // 检查版本 + 下载 zip 到落盘缓存; 下载成功后才写配套描述文件。返回 (zip, remoteConfig), 无更新返回 (null, null)
    private fun downloadAndStage(context: Context, appId: String, onProgress: (Int) -> Unit = {}): Pair<File?, JSONObject?> {
        val remoteConfig = fetchRemoteConfig(appId)
        val remoteVersion = remoteConfig.getInt("versionCode")
        if (remoteVersion <= localVersion(appId)) return Pair(null, null)
        val zip = downloadZip(context, appId, remoteVersion, onProgress)
        // 仅在下载完整成功后写描述文件, 供关闭时判定"下载完成"(半包不会出现描述文件, 不会误装)
        val desc = File(AppConfig.UpdateCache.getDownloadDir(context), "$appId-$remoteVersion.config.json")
        desc.writeText(remoteConfig.toString())
        return Pair(zip, remoteConfig)
    }

    // 手动重启事件: 关闭当前小程序 -> 关后解压替换沙盒(已下载完成的新版本) -> 冷重启
    private fun installUpdate(context: Context, appId: String, callback: ExtCallback) {
        val (zip, remoteConfig) = consumePendingZip(context, appId)
        if (zip == null || remoteConfig == null) {
            callback.onFail(JSONObject().apply { put("errMsg", "no pending update") })
            return
        }
        val act = currentActivity
        if (act == null) {
            callback.onFail(JSONObject().apply { put("errMsg", "mini app not running") })
            return
        }
        Handler(Looper.getMainLooper()).post {
            // 小程序已关闭后, 在主线程安全解压替换沙盒
            act.applyUpdateWithInstall {
                applyZipToSandbox(context, appId, zip, remoteConfig)
            }
            callback.onSuccess(JSONObject().apply { put("restarting", true) })
        }
    }

    // 小程序关闭时调用(后台线程): 若本地存在已下载完成且版本更高的 zip, 解压替换沙盒
    private fun applyPendingOnClose(appId: String, context: Context) {
        Thread {
            try {
                val (zip, remoteConfig) = consumePendingZip(context, appId)
                if (zip == null || remoteConfig == null) return@Thread
                applyZipToSandbox(context, appId, zip, remoteConfig)
            } catch (e: Exception) {
                LogUtils.e(TAG, "关闭时替换沙盒失败: appId=$appId, ${e.message}")
            }
        }.start()
    }

    // 在落盘缓存中查找 appId 已下载完成(含描述文件)且版本高于本地的 zip 及其配置; 取版本最高者
    private fun consumePendingZip(context: Context, appId: String): Pair<File?, JSONObject?> {
        val dir = AppConfig.UpdateCache.getDownloadDir(context)
        val prefix = "$appId-"
        var best: Pair<File, JSONObject>? = null
        dir.listFiles { f -> f.name.startsWith(prefix) && f.name.endsWith(".zip") }?.forEach { zip ->
            val ver = runCatching { zip.name.removePrefix(prefix).removeSuffix(".zip").toInt() }.getOrNull() ?: return@forEach
            if (ver <= localVersion(appId)) return@forEach
            val desc = File(dir, "$appId-$ver.config.json")
            if (!desc.isFile) return@forEach // 下载未完成(无描述文件), 跳过半包
            val cfg = runCatching { JSONObject(desc.readText()) }.getOrNull() ?: return@forEach
            if (best == null || ver > best!!.second.optInt("versionCode", -1)) {
                best = Pair(zip, cfg)
            }
        }
        return if (best != null) Pair(best!!.first, best!!.second) else Pair(null, null)
    }

    // 解压 zip 替换沙盒: 备份旧沙盒 -> 解压新版本 -> 校验 -> 写 config.json -> 清备份; 失败回滚。
    // 仅在小程序未运行时调用(关闭后/手动重启关后)。完成后清理落盘缓存的 zip 与描述文件。
    private fun applyZipToSandbox(context: Context, appId: String, zipFile: File, remoteConfig: JSONObject) {
        val sandbox = AppConfig.UpdateCache.getSandboxDir(context, appId)
        val backup = AppConfig.UpdateCache.getBackupDir(context, appId)
        val version = remoteConfig.optInt("versionCode", -1)
        backup.deleteRecursively()
        try {
            if (sandbox.exists() && !sandbox.renameTo(backup)) {
                throw IOException("无法备份旧版本目录")
            }
            unzip(zipFile, sandbox)
            REQUIRED_PATHS.forEach { path ->
                if (!File(sandbox, path).isFile) throw IOException("更新包缺少关键文件: $path")
            }
            File(sandbox, "config.json").writeText(remoteConfig.toString())
            VersionUtils.setAppVersion(appId, version)
            backup.deleteRecursively()
            // 清理落盘缓存, 避免重复安装
            zipFile.delete()
            File(AppConfig.UpdateCache.getDownloadDir(context), "$appId-$version.config.json").delete()
            LogUtils.d(TAG, "沙盒已更新: appId=$appId, version=$version")
        } catch (e: Exception) {
            backup.renameTo(sandbox) // 回滚旧版本
            LogUtils.e(TAG, "替换沙盒失败, 已回滚: appId=$appId, ${e.message}")
        } finally {
            zipFile.delete()
        }
    }

    // 本地当前版本: 优先取框架记录(解压/更新时写入), 兜底读 config.json(沙盒优先, 回退 assets)
    private fun localVersion(appId: String): Int {
        val stored = VersionUtils.getAppVersion(appId)
        if (stored > 0) return stored
        return Dimina.getInstance().getMiniProgram(appId)?.versionCode ?: 0
    }

    // 流式上报下载进度: 经 progress 订阅回调推给前端; 无订阅时静默跳过
    private fun reportProgress(stage: String, percent: Int) {
        progressCallback?.onSuccess(JSONObject().apply {
            put("stage", stage)
            put("percent", percent)
        })
    }

    // 拉取仓库内小程序配置 {rawBase}/{appId}/config.json, 并校验 appId 一致
    private fun fetchRemoteConfig(appId: String): JSONObject {
        val conn = openConnection("${AppConfig.UpdateRepo.RAW_BASE}/$appId/config.json")
        try {
            if (conn.responseCode != HttpURLConnection.HTTP_OK) {
                throw IOException("config.json 请求失败: HTTP ${conn.responseCode}")
            }
            val config = JSONObject(conn.inputStream.bufferedReader().use { it.readText() })
            val remoteAppId = config.optString("appId")
            if (remoteAppId != appId) {
                throw IOException("config.json appId 不匹配: $remoteAppId != $appId")
            }
            return config
        } finally {
            conn.disconnect()
        }
    }

    // 下载新版本包 {rawBase}/{appId}/{appId}.zip 至落盘缓存目录, 按已读字节/总字节回调百分比
    // (onProgress 仅在已知总大小时上报 0~100; 服务端未给 Content-Length 时上报 -1 表示未知)
    private fun downloadZip(context: Context, appId: String, versionCode: Int, onProgress: (Int) -> Unit): File {
        val dir = AppConfig.UpdateCache.getDownloadDir(context)
        val target = File(dir, "$appId-$versionCode.zip")
        val conn = openConnection("${AppConfig.UpdateRepo.RAW_BASE}/$appId/$appId.zip")
        try {
            if (conn.responseCode != HttpURLConnection.HTTP_OK) {
                throw IOException("更新包下载失败: HTTP ${conn.responseCode}")
            }
            val total = conn.contentLength
            conn.inputStream.buffered().use { input ->
                target.outputStream().buffered().use { output ->
                    val buf = ByteArray(BUFFER_SIZE)
                    var downloaded = 0L
                    var lastPercent = -2 // 与 -1(未知) 区分, 确保首帧 0% 也能发出
                    var read: Int
                    while (input.read(buf).also { read = it } != -1) {
                        output.write(buf, 0, read)
                        downloaded += read
                        if (total > 0) {
                            val percent = (downloaded * 100 / total).toInt()
                            if (percent != lastPercent) {
                                lastPercent = percent
                                onProgress(percent)
                            }
                        }
                    }
                }
            }
            if (total <= 0) onProgress(-1)
        } finally {
            conn.disconnect()
        }
        return target
    }

    // 解压 zip(带 zip-slip 路径穿越防护)
    private fun unzip(zipFile: File, targetDir: File) {
        targetDir.mkdirs()
        val canonicalTarget = targetDir.canonicalPath + File.separator
        ZipInputStream(zipFile.inputStream().buffered()).use { zis ->
            var entry = zis.nextEntry
            while (entry != null) {
                val out = File(targetDir, entry.name)
                if (!out.canonicalPath.startsWith(canonicalTarget)) {
                    throw IOException("非法 zip 条目路径: ${entry.name}")
                }
                if (entry.isDirectory) {
                    out.mkdirs()
                } else {
                    out.parentFile?.mkdirs()
                    out.outputStream().use { zis.copyTo(it) }
                }
                zis.closeEntry()
                entry = zis.nextEntry
            }
        }
    }

    // 打开带 Basic Auth 的连接(等价 curl -u cnb:<token>)
    private fun openConnection(url: String): HttpURLConnection {
        val conn = URL(url).openConnection() as HttpURLConnection
        conn.connectTimeout = 15_000
        conn.readTimeout = 60_000
        val credential = "${AppConfig.UpdateRepo.USER}:${AppConfig.UpdateRepo.TOKEN}"
        val encoded = Base64.encodeToString(credential.toByteArray(), Base64.NO_WRAP)
        conn.setRequestProperty("Authorization", "Basic $encoded")
        return conn
    }
}
