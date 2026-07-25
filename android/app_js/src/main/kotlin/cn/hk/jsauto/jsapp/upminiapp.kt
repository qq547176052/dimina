package cn.hk.jsauto.jsapp

import android.content.Context
import android.util.Base64
import com.didi.dimina.Dimina
import com.didi.dimina.common.LogUtils
import com.didi.dimina.common.VersionUtils
import com.didi.dimina.core.RemoteUpdateManager
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.ConcurrentHashMap
import java.util.zip.ZipEntry
import java.util.zip.ZipInputStream
import java.util.zip.ZipOutputStream

/**
 * 非常驻小程序后台更新: 在"启动"时后台检查更新并下载新包到缓存目录, "关闭"时若已下载完整则静默装包激活(不重启宿主)。
 * 与常驻小程序(DEFAULT_APP_ID)经 extBridge "更新小程序" 即时下载+装包+冷重启不同, 本类为非阻塞式后台更新,
 * 下载在子线程进行不卡前台; 关闭时仅对已落盘的完整包做装包激活, 失败/缺失均跳过, 不影响常驻小程序与前台体验。
 * 履历:
 *   2026-07-25 新建, 实现非常驻小程序(除 AppConfig.DEFAULT_APP_ID)的后台更新: onMiniAppStart 检查+下载 / onMiniAppClose 装包激活
 */
object UpMiniApp {

    private const val TAG = "UpMiniApp"

    // 进行中的下载(按 appId 去重, 避免同一小程序并发下载写同一临时文件)
    private val downloading = ConcurrentHashMap.newKeySet<String>()

    /**
     * 小程序启动: 非常驻才处理; 后台检查更新, 有新版且本地无完整包时下载到缓存目录。
     * 下载过程写入 <appId>.zip.tmp, 仅全部完成后重命名为 <appId>.zip, 避免被关闭流程当作完整半包装入。
     */
    fun onMiniAppStart(context: Context, appId: String) {
        if (appId.isBlank() || appId == AppConfig.DEFAULT_APP_ID) return
        Thread {
            if (!downloading.add(appId)) {
                LogUtils.i(TAG, "启动检查更新: 下载进行中, 跳过重复触发 appId=$appId")
                return@Thread
            }
            try {
                val check = checkUpdate(appId)
                if (!check.hasUpdate) {
                    LogUtils.i(TAG, "启动检查更新: 无新版本 appId=$appId")
                    return@Thread
                }
                // 本地已有完整包(可能上次下载未装上)则跳过重复下载
                if (hasCompleteZip(context, appId)) {
                    LogUtils.i(TAG, "启动检查更新: 已存在完整更新包, 跳过下载 appId=$appId")
                    return@Thread
                }
                downloadZip(context, appId)
                LogUtils.i(TAG, "启动检查更新: 已下载新版本到缓存 appId=$appId versionCode=${check.remoteVersion}")
            } catch (e: Exception) {
                LogUtils.e(TAG, "启动检查更新异常 appId=$appId: ${e.message}")
            } finally {
                downloading.remove(appId)
            }
        }.start()
    }

    /**
     * 小程序关闭: 非常驻才处理; 若缓存中存在完整更新包则静默装包+激活(不重启宿主)。
     * 与 applyMiniAppUpdate 区别: 不关闭小程序(已关闭)、不冷重启 LAUNCHER(常驻小程序需保持运行)。
     */
    fun onMiniAppClose(context: Context, appId: String) {
        if (appId.isBlank() || appId == AppConfig.DEFAULT_APP_ID) return
        Thread {
            try {
                val zipFile = completeZipOrNull(context, appId) ?: run {
                    LogUtils.i(TAG, "关闭检查更新: 无完整更新包, 跳过 appId=$appId")
                    return@Thread
                }
                // 装包前按需补 config.json(cnb 源 zip 仅含 main/* 时校验会失败)
                val pkg = ensureZipHasConfig(appId, zipFile)
                if (!RemoteUpdateManager.installPendingFromZip(context, appId, pkg)) {
                    throw IOException("安装更新包失败(校验未通过) appId=$appId")
                }
                if (!RemoteUpdateManager.activatePendingUpdate(context, appId)) {
                    throw IOException("激活更新包失败(版本不高于当前) appId=$appId")
                }
                LogUtils.i(TAG, "关闭检查更新: 后台更新完成 appId=$appId")
            } catch (e: Exception) {
                LogUtils.e(TAG, "关闭检查更新异常 appId=$appId: ${e.message}")
            }
        }.start()
    }

    // ---- 内部: cnb 检查/下载/配置注入(与 MainActivity 的 cnb 源逻辑保持一致, 独立封装供后台更新复用) ----

    private data class UpdateCheck(val hasUpdate: Boolean, val remoteVersion: Int)

    // 检查更新: GET {base}/{appId}/config.json, 以当前运行版本为准比较 versionCode
    private fun checkUpdate(appId: String): UpdateCheck {
        val url = "${AppConfig.UPDATE_CNB_BASE}/$appId/config.json"
        val conn = openCnbConnection(url)
        try {
            if (conn.responseCode != HttpURLConnection.HTTP_OK) {
                throw IOException("config.json HTTP ${conn.responseCode}")
            }
            val json = JSONObject(conn.inputStream.bufferedReader().use { it.readText() })
            val remoteVersion = json.optInt("versionCode", 0)
            // 以当前运行中的小程序版本为准(回退到 StoreUtils 记录版本), 避免与入参版本错位
            val localVersion = Dimina.getInstance().getMiniProgram(appId)?.versionCode
                ?: VersionUtils.getAppVersion(appId)
            return UpdateCheck(remoteVersion > localVersion, remoteVersion)
        } finally {
            conn.disconnect()
        }
    }

    // 完整包文件名: <appId>.zip; 下载中转: <appId>.zip.tmp(规避半包被装入)
    private fun zipFile(context: Context, appId: String) =
        File(AppConfig.updateDownloadDir(context), "$appId.zip")
    private fun zipTmp(context: Context, appId: String) =
        File(AppConfig.updateDownloadDir(context), "$appId.zip.tmp")

    private fun hasCompleteZip(context: Context, appId: String): Boolean {
        val f = zipFile(context, appId)
        return f.exists() && f.length() > 0
    }

    // 返回完整包文件, 不存在返回 null
    private fun completeZipOrNull(context: Context, appId: String): File? {
        val f = zipFile(context, appId)
        return if (f.exists() && f.length() > 0) f else null
    }

    // 下载 zip 到缓存: 先写 .tmp, 完成后重命名为正式名, 异常时清理临时文件
    private fun downloadZip(context: Context, appId: String) {
        val url = "${AppConfig.UPDATE_CNB_BASE}/$appId/$appId.zip"
        LogUtils.i(TAG, "下载更新开始 appId=$appId 鉴权=BasicAuth(${AppConfig.UPDATE_CNB_USER}:***) url=$url")
        val tmp = zipTmp(context, appId)
        val conn = openCnbConnection(url)
        try {
            if (conn.responseCode != HttpURLConnection.HTTP_OK) {
                throw IOException("zip HTTP ${conn.responseCode}")
            }
            conn.inputStream.use { input ->
                FileOutputStream(tmp).use { output -> input.copyTo(output) }
            }
            // 下载完成才落为正式包名, 避免被 onMiniAppClose 当作完整包装半包
            val final = zipFile(context, appId)
            if (final.exists()) final.delete()
            if (!tmp.renameTo(final)) {
                // 跨存储重命名失败时退化为复制
                tmp.inputStream().use { input -> FileOutputStream(final).use { output -> input.copyTo(output) } }
                tmp.delete()
            }
            LogUtils.i(TAG, "下载更新完成 appId=$appId 大小=${final.length()} 路径=${final.absolutePath}")
        } finally {
            conn.disconnect()
            if (tmp.exists()) tmp.delete() // 异常残留清理
        }
    }

    // 以 Basic Auth 打开 cnb raw 连接(用户名/令牌见 AppConfig.UPDATE_CNB_*)
    private fun openCnbConnection(url: String): HttpURLConnection {
        return (URL(url).openConnection() as HttpURLConnection).apply {
            val auth = Base64.encodeToString(
                "${AppConfig.UPDATE_CNB_USER}:${AppConfig.UPDATE_CNB_TOKEN}".toByteArray(),
                Base64.NO_WRAP,
            )
            setRequestProperty("Authorization", "Basic $auth")
            connectTimeout = 15_000
            readTimeout = 60_000
        }
    }

    // cnb 源 zip 仅含 main/*, 缺根级 config.json 致 installPendingFromZip 校验未通过; 按需自 cnb 补抓 config.json 重新打包
    private fun ensureZipHasConfig(appId: String, zipFile: File): File {
        val hasConfig = ZipInputStream(zipFile.inputStream()).use { zis ->
            var entry = zis.nextEntry
            while (entry != null) {
                if (entry.name == "config.json") {
                    zis.closeEntry()
                    return@use true
                }
                zis.closeEntry()
                entry = zis.nextEntry
            }
            false
        }
        if (hasConfig) return zipFile
        LogUtils.i(TAG, "zip 缺根级 config.json, 自 cnb 补抓并注入 appId=$appId")
        val configText = downloadCnbText("${AppConfig.UPDATE_CNB_BASE}/$appId/config.json")
        val outFile = File(zipFile.parentFile, "$appId.update.zip")
        ZipOutputStream(FileOutputStream(outFile)).use { zos ->
            ZipInputStream(zipFile.inputStream()).use { zis ->
                var entry = zis.nextEntry
                while (entry != null) {
                    zos.putNextEntry(ZipEntry(entry.name))
                    zis.copyTo(zos)
                    zos.closeEntry()
                    zis.closeEntry()
                    entry = zis.nextEntry
                }
            }
            zos.putNextEntry(ZipEntry("config.json"))
            zos.write(configText.toByteArray())
            zos.closeEntry()
        }
        zipFile.delete()
        return outFile
    }

    // 下载 cnb 文本资源(config.json 等), 复用 Basic Auth 连接
    private fun downloadCnbText(url: String): String {
        val conn = openCnbConnection(url)
        try {
            if (conn.responseCode != HttpURLConnection.HTTP_OK) {
                throw IOException("config.json HTTP ${conn.responseCode}")
            }
            return conn.inputStream.bufferedReader().use { it.readText() }
        } finally {
            conn.disconnect()
        }
    }
}
