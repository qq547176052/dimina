package cn.hk.jsauto.jsapp

import android.app.Activity
import android.app.Application
import android.content.Context
import android.os.Bundle
import android.util.Log
import androidx.activity.ComponentActivity
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
 */
class MainActivity : ComponentActivity() {

    companion object {
        private const val TAG = "DemoApp"
    }

    // 前台 Activity, 供 AppList 扩展模块拉起(其他)小程序
    private var currentActivity: Activity? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        registerActivityLifecycle()
        registerAppListModule()
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

    // 注册 AppList 扩展模块: 小程序首页(index.js)经 wx.extBridge 获取列表并拉起对应小程序
    private fun registerAppListModule() {
        Dimina.getInstance().registerExtModule("AppList") { event, data, callback ->
            when (event) {
                "getList" -> {
                    val arr = JSONArray()
                    for (mp in getMiniProgramsList()) {
                        if (mp.appId in AppConfig.EXCLUDED_LIST_APP_IDS) continue // 排除清单内的小程序
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
                    val mp = Dimina.getInstance().getMiniProgram(appId)
                    if (mp != null && currentActivity != null) {
                        Dimina.getInstance().startMiniProgram(currentActivity!!, mp)
                        callback.onSuccess(JSONObject())
                    } else {
                        callback.onFail(JSONObject().apply {
                            put("errMsg", "launch fail: appId=$appId not found or no activity")
                        })
                    }
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
