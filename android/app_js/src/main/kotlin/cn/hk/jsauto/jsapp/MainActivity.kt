package cn.hk.jsauto.jsapp

import android.app.Activity
import android.app.Application
import android.content.Context
import android.os.Bundle
import android.util.Log
import androidx.activity.ComponentActivity
import java.io.File
import com.didi.dimina.Dimina
import com.didi.dimina.bean.MiniProgram
import com.didi.dimina.common.LogUtils
import com.didi.dimina.push.requestNotificationPermission
import org.json.JSONArray
import org.json.JSONObject

/**
 * 启动页: 作为 LAUNCHER, 进入即拉起默认小程序, 并注册 AppList 扩展模块。
 * 复刻 app 模块的成功路径——默认小程序经 startMiniProgram 拉起, 使 JsCore 引擎在
 * DiminaActivity 之前(前台 Activity 阶段)创建, 修复发布版首冷启动白屏(二次才成功)的问题。
 * AppList 扩展模块由小程序首页(index.js)经 wx.extBridge 调用, 用于获取列表并拉起对应小程序。
 * 履历:
 *   2026-07-22 新增(由 SplashActivity 重命名), 替代 DiminaActivity 直接作为 LAUNCHER 的冷启动白屏问题
 *   2026-07-22 AppList 扩展模块与前台 Activity 跟踪由 App.kt 迁入本类, 默认小程序名称置为 " "
 *   2026-07-22 改用 ComponentActivity 基类, 在拉起默认小程序前先申请 POST_NOTIFICATIONS 权限
 *   2026-07-23 AppList 新增 remove 事件: 小程序首页左滑删除时直接删除(内存屏蔽+清理解压目录), 不持久化, 列表重新获取
 *   2026-07-23 整理: onCreate 统一经 registerExtensions() 注册前台 Activity 跟踪与 AppList 扩展模块
 *   2026-07-23 注册 MiniAppUpdate 扩展模块(UpMiniApp): 小程序经 wx.extBridge 检查更新, 更新源为 git 仓库
 */
class MainActivity : ComponentActivity() {

    companion object {
        private const val TAG = "DemoApp"
    }

    // 前台 Activity, 供 AppList 扩展模块拉起(其他)小程序
    private var currentActivity: Activity? = null

    // 本会话内已删除(隐藏)的小程序 appId, 仅内存不持久化; 重启后由 assets 重新载入, 已删项会再次出现
    private val deletedAppIds = mutableSetOf<String>()

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
        val miniProgram = Dimina.getInstance().getMiniProgram(AppConfig.MiniApp.DEFAULT_APP_ID)
        if (miniProgram == null) {
            LogUtils.e(TAG, "启动失败: 默认小程序 appId=${AppConfig.MiniApp.DEFAULT_APP_ID} 未读取到配置")
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

    // 统一注册入口: 前台 Activity 跟踪 + AppList 扩展模块(列表/拉起/删除) + 小程序检查更新模块
    private fun registerExtensions() {
        registerActivityLifecycle()
        registerAppListModule()
        UpMiniApp.register(this)
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
            callback.onFail(JSONObject().apply { put("errMsg", "remove fail: empty appId") })
            return
        }
        deletedAppIds.add(appId)
        // 清理已解压的小程序目录(filesDir/jsapp/<appId>), 释放空间; 内置 assets 不可删, 以内存集合屏蔽
        val dir = File(filesDir, "jsapp/$appId")
        if (dir.exists()) runCatching { dir.deleteRecursively() }
        LogUtils.i(TAG, "小程序已删除(本会话): appId=$appId")
        callback.onSuccess(JSONObject().apply { put("appId", appId) })
    }

    // 注册 AppList 扩展模块: 小程序首页(index.js)经 wx.extBridge 获取列表并拉起对应小程序
    private fun registerAppListModule() {
        Dimina.getInstance().registerExtModule("AppList") { event, data, callback ->
            when (event) {
                "getList" -> {
                    val arr = JSONArray()
                    for (mp in getMiniProgramsList()) {
                        // 排除清单内的小程序, 以及已删除(隐藏)的小程序
                        if (mp.appId in AppConfig.AppList.EXCLUDED_APP_IDS) continue
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
                "launch" -> {
                    val appId = data.optString("appId")
                    // 已删除的小程序禁止拉起
                    if (appId in deletedAppIds) {
                        callback.onFail(JSONObject().apply {
                            put("errMsg", "launch fail: appId=$appId has been removed")
                        })
                        null
                    } else {
                        val mp = Dimina.getInstance().getMiniProgram(appId)
                        if (mp != null && currentActivity != null) {
                            // 统一更新策略: 启动小程序即后台检查版本并下载新版本压缩包到落盘缓存(仅写缓存, 不动沙盒);
                            // 小程序关闭时(UpMiniApp 生命周期钩子)若下载完成则解压替换沙盒生效。
                            UpMiniApp.backgroundCheckAndDownload(appId, this)
                            Dimina.getInstance().startMiniProgram(currentActivity!!, mp)
                            callback.onSuccess(JSONObject())
                        } else {
                            callback.onFail(JSONObject().apply {
                                put("errMsg", "launch fail: appId=$appId not found or no activity")
                            })
                        }
                        null
                    }
                }
                "remove" -> {
                    removeMiniProgram(data.optString("appId"), callback)
                    null
                }
                else -> {
                    callback.onFail(JSONObject().apply { put("errMsg", "unknown event: $event") })
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
        Log.e("MainActivity", "Error reading config.json: ${e.message}")
        // 如果文件读取失败，则返回空列表
        emptyList()
    }
}
