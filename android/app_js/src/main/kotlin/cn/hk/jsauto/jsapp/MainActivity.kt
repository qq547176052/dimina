package cn.hk.jsauto.jsapp

import android.app.Activity
import android.app.Application
import android.content.Context
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.content.Intent
import android.util.Base64
import android.util.Log
import androidx.activity.ComponentActivity
import com.didi.dimina.Dimina
import com.didi.dimina.bean.MiniProgram
import com.didi.dimina.common.LogUtils
import com.didi.dimina.common.VersionUtils
import com.didi.dimina.core.RemoteUpdateManager
import com.didi.dimina.push.requestNotificationPermission
import com.didi.dimina.ui.container.DiminaActivity
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.CountDownLatch
import java.util.zip.ZipEntry
import java.util.zip.ZipInputStream
import java.util.zip.ZipOutputStream

/**
 * 启动页: 作为 LAUNCHER, 进入即拉起默认小程序, 并注册小程序管理扩展模块(模块名取默认小程序 appId)。
 * 复刻 app 模块的成功路径——默认小程序经 startMiniProgram 拉起, 使 JsCore 引擎在
 * DiminaActivity 之前(前台 Activity 阶段)创建, 修复发布版首冷启动白屏(二次才成功)的问题。
 * 小程序管理扩展模块(模块名=默认小程序 appId)由首页(index.js)经 wx.extBridge 调用, 用于获取列表并拉起对应小程序。
 * 履历:
 *   2026-07-22 新增(由 SplashActivity 重命名), 替代 DiminaActivity 直接作为 LAUNCHER 的冷启动白屏问题
 *   2026-07-22 AppList 扩展模块与前台 Activity 跟踪由 App.kt 迁入本类, 默认小程序名称置为 " "
 *   2026-07-22 改用 ComponentActivity 基类, 在拉起默认小程序前先申请 POST_NOTIFICATIONS 权限
 *   2026-07-23 AppList 新增 remove 事件: 小程序首页左滑删除时直接删除(内存屏蔽+清理解压目录), 不持久化, 列表重新获取
 *   2026-07-23 整理: onCreate 统一经 registerExtensions() 注册前台 Activity 跟踪与 AppList 扩展模块
 *   2026-07-24 小程序管理扩展模块: 注册名由 "AppList" 改为默认小程序 appId(AppConfig.DEFAULT_APP_ID), 前端以本小程序 appId 经 wx.extBridge 调用; 事件名改为中文(获取列表/拉起/删除); 检查更新/下载更新经 cnb 源实现(检查更新比 versionCode/下载更新装 .pending 后 applyUpdate 冷重启)
 *   2026-07-24 所有回调统一 JSON 返回消息: 失败经 failMsg() 统一 errMsg 字段(并修正 empty appId 等英文残留); 成功按事件返回对应 JSON 数据
 *   2026-07-24 下载更新(downloadMiniAppUpdate)加日记: 打印 Basic Auth(cnb+部署令牌)、保存位置、包大小(头部 Content-Length 与实际字节), 便于核对 cnb 鉴权与排查校验失败
 *   2026-07-24 下载更新拆分为两步(对齐 更新小程序.md 的 下载更新/应用更新 命令): "下载新小程序压缩包" 仅落盘 zip 并回调成功(appId/size/path); 新增 "应用更新" 事件负责装 .pending→激活→冷重启; 二者经 extBridge 分两次调用
 *   2026-07-24 "应用更新" 流程改为三步且严格顺序: 先 closeMiniProgramOnly(经 CountDownLatch 等关闭真正完成)→ 同步 installPendingFromZip+activatePendingUpdate(装包激活完成才继续)→ startMiniProgram 重新打开; 去掉 sleep 硬等, 改为等待完成回调
 *   2026-07-24 "应用更新" 第三步改为重建 LAUNCHER(MainActivity, FLAG_ACTIVITY_NEW_TASK|CLEAR_TASK), 经 onCreate→launchDefaultMiniProgram 冷重启拉起最新版本; 不再用已 finish 的 MainActivity 实例作 startMiniProgram 上下文(onCreate 不会重跑且上下文已销毁)
 *   2026-07-24 "应用更新" 装包前补抓 config.json 注入 zip: cnb 源 zip 仅含 main 目录内容, 缺根级 config.json 致 installPendingFromZip 校验未通过; 新增 ensureUpdateZipHasConfig 自 cnb 拉取 config.json 重新打包, 使校验(appId/versionCode)通过
 *   2026-07-24 "应用更新" 的更新压缩包清理由 installPendingFromZip 的 finally 负责(装包后即删除, 注入 config 后为 update.zip); 移除 MainActivity 内冗余删除(原因文件已被删而误报"删除失败")
 *   2026-07-24 小程序更新合并为单步 "更新小程序": 下载 zip 后直接关闭小程序→装包(.pending)→激活→冷重启, 去掉原 "下载新小程序压缩包"+"应用更新" 两次 extBridge 调用; 抽出 downloadUpdateZip 落盘辅助(原 downloadMiniAppUpdate 仅落盘部分)供合并流程复用
 */
class MainActivity : ComponentActivity() {

    companion object {
        private const val TAG = "MiniApp App"
    }

    // 前台 Activity, 供 AppList 扩展模块拉起(其他)小程序
    private var currentActivity: Activity? = null

    // 主线程 Handler: 跨线程(网络/解压)完成后, 经此把 extBridge 回调/冷重启切回主线程投递
    private val mainHandler = Handler(Looper.getMainLooper())

    // 本会话内已删除(隐藏)的小程序 appId, 仅内存不持久化; 重启后由 assets 重新载入, 已删项会再次出现
    private val deletedAppIds = mutableSetOf<String>()

    // 统一构建失败回调的 JSON 消息(errMsg 字段), 所有 onFail 共用此格式, 避免各处重复拼接且中英文混杂
    private fun failMsg(msg: String) = JSONObject().apply { put("errMsg", msg) }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // 统一在此注册所有扩展能力(前台 Activity 跟踪 + AppList 扩展模块)
        registerExtensions()
        // 先申请通知权限(Android 13+ 为运行时权限), 结果回调后再拉起默认小程序并 finish,
        // 避免权限对话框因 Activity 过早 finish 而失效
        requestNotificationPermission { launchDefaultMiniProgram() }
    }

    // 拉起默认小程序(名称置为 " ")后结束启动页
    private fun launchDefaultMiniProgram() {
        val miniProgram = Dimina.getInstance().getMiniProgram(AppConfig.DEFAULT_APP_ID)
        if (miniProgram == null) {
            LogUtils.e(TAG, "启动失败: 默认小程序 appId=${AppConfig.DEFAULT_APP_ID} 未读取到配置")
            finish()
            return
        }
        LogUtils.i(
            TAG,
            "启动默认小程序: appId=${miniProgram.appId}, name=${miniProgram.name}, " +
                "path=${miniProgram.path}, version=${miniProgram.versionName}",
        )
        // 经 startMiniProgram(openApp) 拉起, 引擎在此阶段创建, 与 app 模块点击进入一致
        // 名称置为 " ", 支持后期修改只读字段 name
        Dimina.getInstance().startMiniProgram(this, miniProgram.copy(name = " "))
        finish()
    }

    // 统一注册入口: 前台 Activity 跟踪 + AppList 扩展模块(列表/拉起/删除)
    private fun registerExtensions() {
        registerActivityLifecycle()
        registerAppListModule()
    }

    // 跟踪前台 Activity, 供 AppList 扩展模块拉起(其他)小程序使用
    // 注: registerActivityLifecycleCallbacks 属 Application, 故经 application 调用
    private fun registerActivityLifecycle() {
        application.registerActivityLifecycleCallbacks(object : Application.ActivityLifecycleCallbacks {
            override fun onActivityCreated(a: Activity, s: Bundle?) { currentActivity = a }
            override fun onActivityStarted(a: Activity) { currentActivity = a }
            override fun onActivityResumed(a: Activity) { currentActivity = a }
            override fun onActivityPaused(a: Activity) {}
            override fun onActivityStopped(a: Activity) {}
            override fun onActivitySaveInstanceState(a: Activity, o: Bundle) {}
            override fun onActivityDestroyed(a: Activity) {
                if (currentActivity == a) currentActivity = null
            }
        })
    }

    // 直接删除小程序: 加入内存屏蔽集合(仅本会话)并清理解压目录, 随后列表重新获取时不再包含该项
    // 不持久化: 重启后由 assets 重新载入, 已删项会再次出现(assets 为只读, 运行期不可真正删除内置包)
    // appId 来自小程序首页左滑删除时 wx.extBridge 的 remove 事件
    private fun removeMiniProgram(appId: String, callback: com.didi.dimina.api.ext.ExtCallback) {
        if (appId.isBlank()) {
            callback.onFail(failMsg("删除失败: 空的 appId"))
            return
        }
        deletedAppIds.add(appId)
        // 清理已解压的小程序目录(filesDir/jsapp/<appId>), 释放空间; 内置 assets 不可删, 以内存集合屏蔽
        val dir = File(filesDir, "jsapp/$appId")
        if (dir.exists()) runCatching { dir.deleteRecursively() }
        LogUtils.i(TAG, "小程序已删除(本会话): appId=$appId")
        callback.onSuccess(JSONObject().apply { put("appId", appId) })
    }

    // ---- 小程序远程更新(cnb 源, 见 更新小程序.md: 仓库连接+/{appId}/config.json 与 /{appid}/{appid}.zip) ----
    // 鉴权与源地址集中在 AppConfig.UPDATE_CNB_*; 此处仅做"拉取-比较-下载-装包-冷重启"

    // 以 Basic Auth 打开 cnb raw 连接(用户名/令牌见 AppConfig.UPDATE_CNB_*)
    private fun openCnbConnection(url: String): HttpURLConnection {
        val conn = (URL(url).openConnection() as HttpURLConnection).apply {
            val auth = Base64.encodeToString(
                "${AppConfig.UPDATE_CNB_USER}:${AppConfig.UPDATE_CNB_TOKEN}".toByteArray(),
                Base64.NO_WRAP,
            )
            setRequestProperty("Authorization", "Basic $auth")
            connectTimeout = 15_000
            readTimeout = 60_000
        }
        return conn
    }

    // 检查更新: GET {base}/{appId}/config.json, 以当前运行版本为准比较 versionCode, 返回 hasUpdate/versionName
    private fun checkMiniAppUpdate(
        appId: String,
        callback: com.didi.dimina.api.ext.ExtCallback,
    ) {
        if (appId.isBlank()) {
            callback.onFail(failMsg("检查更新失败: 空的 appId"))
            return
        }
        Thread {
            try {
                val url = "${AppConfig.UPDATE_CNB_BASE}/$appId/config.json"
                val conn = openCnbConnection(url)
                try {
                    if (conn.responseCode != HttpURLConnection.HTTP_OK) {
                        throw IOException("config.json HTTP ${conn.responseCode}")
                    }
                    val json = JSONObject(conn.inputStream.bufferedReader().use { it.readText() })
                    val remoteVersion = json.optInt("versionCode", 0)
                val versionName = json.optString("versionName", "")
                // 以当前运行中的小程序版本为准(回退到 StoreUtils 记录版本), 避免与入参版本错位
                val localVersion = Dimina.getInstance().getMiniProgram(appId)?.versionCode
                    ?: VersionUtils.getAppVersion(appId)
                val result = JSONObject().apply {
                    put("hasUpdate", remoteVersion > localVersion)
                    put("versionName", versionName)
                    put("versionCode", remoteVersion)
                }
                mainHandler.post { callback.onSuccess(result) }
                } finally {
                    conn.disconnect()
                }
            } catch (e: Exception) {
                LogUtils.e(TAG, "检查更新异常 appId=$appId: ${e.message}")
                mainHandler.post {
                    callback.onFail(failMsg("检查更新失败: ${e.message}"))
                }
            }
        }.start()
    }

    // 下载更新 zip 到 cacheDir/dimina-updates/<appId>.zip, 返回落盘文件(失败抛异常)
    // 仅负责落盘, 装包(.pending)/激活/冷重启由 applyMiniAppUpdate 负责
    private fun downloadUpdateZip(appId: String): File {
        val url = "${AppConfig.UPDATE_CNB_BASE}/$appId/$appId.zip"
        // 鉴权: Basic Auth(用户=${AppConfig.UPDATE_CNB_USER}, 已带部署令牌); 源地址与令牌见 更新小程序.md
        LogUtils.i(TAG, "下载更新开始 appId=$appId 鉴权=BasicAuth(${AppConfig.UPDATE_CNB_USER}:***) url=$url")
        val dir = File(cacheDir, AppConfig.UPDATE_DOWNLOAD_DIR_NAME).apply { mkdirs() }
        val zipFile = File(dir, "$appId.zip")
        LogUtils.i(TAG, "下载更新保存位置: ${zipFile.absolutePath}")
        val conn = openCnbConnection(url)
        try {
            if (conn.responseCode != HttpURLConnection.HTTP_OK) {
                throw IOException("zip HTTP ${conn.responseCode}")
            }
            val declaredLen = conn.contentLengthLong
            LogUtils.i(TAG, "下载更新响应 HTTP_OK appId=$appId 头部Content-Length=${if (declaredLen >= 0) declaredLen else "未知(可能为分块传输)"}")
            conn.inputStream.use { input -> FileOutputStream(zipFile).use { output -> input.copyTo(output) } }
            LogUtils.i(TAG, "下载更新完成 appId=$appId 实际大小=${zipFile.length()} 字节 路径=${zipFile.absolutePath}")
        } finally {
            conn.disconnect()
        }
        return zipFile
    }

    // 更新小程序(一步到位): 下载 zip → 关闭小程序 → 装包(.pending) → 激活 → 冷重启 → 删包
    // 合并原 "下载新小程序压缩包" + "应用更新" 两步, 详见 更新小程序.md
    private fun downloadAndApplyMiniAppUpdate(
        appId: String,
        callback: com.didi.dimina.api.ext.ExtCallback,
    ) {
        if (appId.isBlank()) {
            callback.onFail(failMsg("更新小程序失败: 空的 appId"))
            return
        }
        Thread {
            try {
                downloadUpdateZip(appId)  // 仅落盘, 失败抛异常
                // 下载完成即进入应用更新: 关闭小程序→装包→激活→冷重启(逻辑复用 applyMiniAppUpdate)
                applyMiniAppUpdate(appId, callback)
            } catch (e: Exception) {
                LogUtils.e(TAG, "更新小程序异常(下载阶段) appId=$appId: ${e.message}")
                mainHandler.post {
                    callback.onFail(failMsg("更新小程序失败: ${e.message}"))
                }
            }
        }.start()
    }

    // 应用更新: 取已下载的 zip(cacheDir/dimina-updates/<appId>.zip) 装到 .pending → 激活 → 冷重启加载新版本
    // 与 "下载更新" 拆分: 下载只落盘, 真正解压替换/重启由本事件触发(详见 更新小程序.md 的 应用更新 命令)
    private fun applyMiniAppUpdate(
        appId: String,
        callback: com.didi.dimina.api.ext.ExtCallback,
    ) {
        if (appId.isBlank()) {
            callback.onFail(failMsg("应用更新失败: 空的 appId"))
            return
        }
        Thread {
            try {
                var zipFile = File(File(cacheDir, AppConfig.UPDATE_DOWNLOAD_DIR_NAME), "$appId.zip")
                if (!zipFile.exists()) {
                    throw IOException("未找到已下载的更新包: ${zipFile.absolutePath}")
                }
                // 校验要求 zip 根目录含 config.json(供 installPendingFromZip 校验 appId/versionCode);
                // cnb 源 zip 仅含 main/*, 故按需补抓 config.json 重新打包, 使校验通过
                zipFile = ensureUpdateZipHasConfig(appId, zipFile)
                // 1. 先关闭当前运行的小程序, 等关闭真正完成(释放文件占用)后再继续装包, 避免解压替换时文件被占用
                val closedLatch = CountDownLatch(1)
                val act = currentActivity as? DiminaActivity
                if (act != null) {
                    mainHandler.post { act.closeMiniProgramOnly { closedLatch.countDown() } }
                } else {
                    closedLatch.countDown() // 当前无运行中的小程序, 直接继续
                }
                closedLatch.await() // 阻塞至关闭完成回调
                LogUtils.i(TAG, "应用更新: 小程序已关闭, 开始装包 appId=$appId 包路径=${zipFile.absolutePath} 大小=${zipFile.length()}")
                // 2. 装包(.pending) + 激活(同步执行, 完成后再继续打开)
                if (!RemoteUpdateManager.installPendingFromZip(this, appId, zipFile)) {
                    throw IOException("安装更新包失败(校验未通过)")
                }
                if (!RemoteUpdateManager.activatePendingUpdate(this, appId)) {
                    throw IOException("激活更新包失败(版本不高于当前)")
                }
                LogUtils.i(TAG, "应用更新: 装包激活完成 appId=$appId, 准备重建 LAUNCHER 重新拉起")
                // 3. 重建 LAUNCHER(MainActivity): 经 onCreate→launchDefaultMiniProgram 以最新 config 冷重启拉起,
                //    不使用已 finish 的 MainActivity 实例作上下文(否则 onCreate 不会重新执行, 且上下文已销毁)
                val intent = Intent(applicationContext, MainActivity::class.java).apply {
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK)
                }
                mainHandler.post { applicationContext.startActivity(intent) }
                mainHandler.post { callback.onSuccess(JSONObject().apply { put("appId", appId) }) }
                // 注: 更新压缩包的清理由 installPendingFromZip 的 finally 负责(装包后即删除), 此处无需再删,
                //     否则会因文件已被删除而返回 false, 误报"删除更新压缩包失败"
            } catch (e: Exception) {
                LogUtils.e(TAG, "应用更新异常 appId=$appId: ${e.message}")
                mainHandler.post {
                    callback.onFail(failMsg("应用更新失败: ${e.message}"))
                }
            }
        }.start()
    }

    // 下载 cnb 文本资源(config.json 等), 复用 Basic Auth 连接(见 openCnbConnection)
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

    // installPendingFromZip 以 requiredPackagePaths 校验根级 config.json/main/app-config.json/main/logic.js,
    // 并读 config.json 的 appId 与 versionCode。cnb 源 zip 仅含 main/*, 缺根级 config.json 会"校验未通过";
    // 故按需自 cnb 补抓 config.json 重新打包进 zip, 使校验通过且 versionCode 可被正确读取。
    private fun ensureUpdateZipHasConfig(appId: String, zipFile: File): File {
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
        LogUtils.i(TAG, "应用更新: zip 缺根级 config.json, 自 cnb 补抓并注入 appId=$appId")
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
    private fun registerAppListModule() {
        // 模块名取默认小程序 appId(见 AppConfig.DEFAULT_APP_ID), 前端以本小程序 appId 经 wx.extBridge 调用
        Dimina.getInstance().registerExtModule(AppConfig.DEFAULT_APP_ID) { event, data, callback ->
            when (event) {
                "获取列表" -> {
                    // data.appId 为调用方小程序(当前不作区分, 列表为全量)
                    val arr = JSONArray()
                    for (mp in getMiniProgramsList()) {
                        // 排除清单内的小程序, 以及已删除(隐藏)的小程序
                        if (mp.appId in AppConfig.EXCLUDED_LIST_APP_IDS) continue
                        if (mp.appId in deletedAppIds) continue
                        arr.put(JSONObject().apply {
                            put("appId", mp.appId)
                            put("name", mp.name)
                            put("path", mp.path ?: "")
                            put("versionName", mp.versionName)
                        })
                    }
                    callback.onSuccess(JSONObject().apply { put("list", arr) })
                    null
                }
                "拉起" -> {
                    val appId = data.optString("appId")
                    // 已删除的小程序禁止拉起
                    if (appId in deletedAppIds) {
                        callback.onFail(failMsg("拉起失败: appId=$appId 已被删除"))
                        null
                    } else {
                        val mp = Dimina.getInstance().getMiniProgram(appId)
                        if (mp != null && currentActivity != null) {
                            Dimina.getInstance().startMiniProgram(currentActivity!!, mp)
                            callback.onSuccess(JSONObject())
                        } else {
                            callback.onFail(failMsg("拉起失败: appId=$appId 未找到或无可用页面"))
                        }
                        null
                    }
                }
                "删除" -> {
                    removeMiniProgram(data.optString("appId"), callback)
                    null
                }
                // ----- 小程序远程更新(方案1: 宿主从 cnb 下载并装到 .pending, 引擎 applyUpdate 冷重启) -----
                // 事件名与前端 index.js 对齐; 更新目标即 data.appId(等于 module=调用方自身 appId)
                // 合并为单步 "更新小程序": 下载 zip → 关闭小程序 → 装包(.pending) → 激活 → 冷重启, 详见 更新小程序.md
                "检查更新" -> {
                    checkMiniAppUpdate(data.optString("appId"), callback)
                    null
                }
                "更新小程序" -> {
                    downloadAndApplyMiniAppUpdate(data.optString("appId"), callback)
                    null
                }
                else -> {
                    callback.onFail(failMsg("未知事件: $event"))
                    null
                }
            }
        }
    }
}

// 从 assets/jsapp 各小程序 config.json 读取小程序列表
fun Context.getMiniProgramsList(): List<MiniProgram> {
    return try {
        // 从资源中读取JSON文件
        val configResults = assets.list("jsapp")?.map { folder ->
            try {
                val jsonString = assets.open("jsapp/$folder/config.json").bufferedReader().use { it.readText() }
                JSONObject(jsonString)
            } catch (_: Exception) {
                null
            }
        } ?: emptyList()

        val miniPrograms = mutableListOf<MiniProgram>()

        // 转换为MiniProgram对象
        for (jsonObject in configResults) {
            if (jsonObject == null) {
                continue
            }
            val name = jsonObject.getString("name")

            miniPrograms.add(MiniProgram(
                appId = jsonObject.getString("appId"),
                name = name,
                versionCode = jsonObject.getInt("versionCode"),
                versionName = jsonObject.getString("versionName"),
                path = jsonObject.getString("path"),
                updateManifestUrl = jsonObject.optString("updateManifestUrl", ""),
            ))
        }

        miniPrograms
    } catch (e: Exception) {
        Log.e("MainActivity", "读取 config.json 出错: ${e.message}")
        // 如果文件读取失败，则返回空列表
        emptyList()
    }
}
