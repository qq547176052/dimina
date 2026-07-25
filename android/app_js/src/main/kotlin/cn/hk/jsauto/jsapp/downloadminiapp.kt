package cn.hk.jsauto.jsapp

import android.content.Context
import android.util.Base64
import com.didi.dimina.Dimina
import com.didi.dimina.api.ext.ExtCallback
import com.didi.dimina.common.LogUtils
import com.didi.dimina.core.MiniApp
import com.didi.dimina.core.RemoteUpdateManager
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.util.zip.ZipEntry
import java.util.zip.ZipInputStream
import java.util.zip.ZipOutputStream

/**
 * 扫码下载小程序: 识别二维码 "cnb下载小程序=<appId>" 后, 经 cnb 源下载小程序压缩包并静默装包激活,
 * 使其加入小程序列表可供拉起(与 upminiapp 后台更新、MainActivity "更新小程序" 冷重启不同, 本类不重启宿主)。
 * 复用 AppConfig.UPDATE_CNB_* 配置(与既有更新链路同源), 下载落 cacheDir/dimina-updates, 装包后由引擎清理源 zip。
 * 履历:
 *   2026-07-25 新建, 实现扫码下载小程序: parseAppIdFromQr 解析二维码 / download 下载+装包激活(不重启宿主)
 *   2026-07-25 download 改为强制装包(activatePendingUpdate force=true): 扫码下载为显式安装, 覆盖安装不受版本守卫限制, 保证每次扫码都能装到(已安装同版本也不再跳过)
 */
object DownloadMiniApp {

    private const val TAG = "DownloadMiniApp"

    // 二维码内容前缀: "cnb下载小程序=<appId>"
    private const val QR_PREFIX = "cnb下载小程序="

    /**
     * 从扫码内容解析小程序 appId。格式: "cnb下载小程序=<appId>"; 不匹配返回 null。
     */
    fun parseAppIdFromQr(content: String?): String? {
        if (content.isNullOrBlank()) return null
        if (!content.startsWith(QR_PREFIX)) return null
        val id = content.substring(QR_PREFIX.length).trim()
        return if (id.isBlank()) null else id
    }

    /**
     * 下载并装包激活指定小程序(不重启宿主)。成功经 callback.onSuccess 回传 appId; 失败经 onFail 回传 errMsg。
     * 流程: 下载 zip(缓存) → 按需补 config.json → installPendingFromZip → activatePendingUpdate。
     * 若小程序正在运行先释放其 JS 运行时与文件占用, 避免装包时文件被锁; 版本不高于当前则视为已最新, 不报错。
     */
    fun download(context: Context, appId: String, callback: ExtCallback) {
        if (appId.isBlank()) {
            callback.onFail(JSONObject().apply { put("errMsg", "下载小程序失败: 空的 appId") })
            return
        }
        Thread {
            try {
                val zipFile = downloadZip(context, appId)
                val pkg = ensureZipHasConfig(appId, zipFile)
                // 若小程序正在运行, 先释放其 JS 运行时与文件占用, 避免装包时文件被锁
                runCatching { MiniApp.getInstance().clear(appId) }
                if (!RemoteUpdateManager.installPendingFromZip(context, appId, pkg)) {
                    throw IOException("安装更新包失败(校验未通过) appId=$appId")
                }
                // 扫码下载为显式安装: 强制装包(覆盖安装), 不受版本守卫限制, 保证每次扫码都能装到
                val activated = RemoteUpdateManager.activatePendingUpdate(context, appId, force = true)
                LogUtils.i(TAG, "下载小程序: 装包激活=$activated appId=$appId")
                LogUtils.i(TAG, "下载小程序: 完成 appId=$appId")
                callback.onSuccess(JSONObject().apply { put("appId", appId) })
            } catch (e: Exception) {
                LogUtils.e(TAG, "下载小程序异常 appId=$appId: ${e.message}")
                callback.onFail(JSONObject().apply { put("errMsg", "下载小程序失败: ${e.message}") })
            }
        }.start()
    }

    // ---- 内部: cnb 下载/配置注入(与 upminiapp.kt / MainActivity 的 cnb 源逻辑保持一致) ----

    private fun downloadZip(context: Context, appId: String): File {
        val url = "${AppConfig.UPDATE_CNB_BASE}/$appId/$appId.zip"
        LogUtils.i(TAG, "下载开始 appId=$appId 鉴权=BasicAuth(${AppConfig.UPDATE_CNB_USER}:***) url=$url")
        val dir = AppConfig.updateDownloadDir(context)
        val zipFile = File(dir, "$appId.zip")
        val conn = openCnbConnection(url)
        try {
            if (conn.responseCode != HttpURLConnection.HTTP_OK) {
                throw IOException("zip HTTP ${conn.responseCode}")
            }
            conn.inputStream.use { input -> FileOutputStream(zipFile).use { output -> input.copyTo(output) } }
            LogUtils.i(TAG, "下载完成 appId=$appId 大小=${zipFile.length()} 路径=${zipFile.absolutePath}")
        } finally {
            conn.disconnect()
        }
        return zipFile
    }

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
