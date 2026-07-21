package com.didi.dimina

import android.app.Activity
import android.content.Context
import com.didi.dimina.api.ext.ExtModuleHandler
import com.didi.dimina.bean.MiniProgram
import com.didi.dimina.common.LogUtils
import com.didi.dimina.common.StoreUtils
import com.didi.dimina.core.MiniApp
import org.json.JSONObject
import java.io.File

/**
 * Author: Doslin
 */
class Dimina private constructor(context: Context) {
    // 伴生对象用于实现单例模式和提供初始化入口
    companion object {
        @Volatile
        private var instance: Dimina? = null

        /**
         * 初始化 SDK
         * @param context 应用上下文
         * @param config 配置参数
         * @return Dimina 实例
         */
        fun init(context: Context, config: DiminaConfig): Dimina {
            return instance ?: synchronized(this) {
                instance ?: Dimina(context.applicationContext).also { instance = it }.apply {
                    // 应用配置
                    applyConfig(config)
                }
            }
        }

        /**
         * 获取 Dimina 实例
         * @throws IllegalStateException 如果尚未初始化
         */
        fun getInstance(): Dimina {
            return instance ?: throw IllegalStateException("Dimina SDK not initialized. Please call init() first.")
        }
    }

    // 配置类
    class DiminaConfig private constructor(builder: Builder) {
        val debugMode: Boolean = builder.debugMode
        val apiNamespaces: List<String> = builder.apiNamespaces

        class Builder {
            var debugMode: Boolean = false
            internal var apiNamespaces: MutableList<String> = mutableListOf()

            fun setDebugMode(debugMode: Boolean): Builder {
                this.debugMode = debugMode
                return this
            }

            fun addApiNamespace(name: String): Builder {
                apiNamespaces.add(name)
                return this
            }

            fun build(): DiminaConfig {
                return DiminaConfig(this)
            }
        }
    }

    /**
     * 检查当前是否处于调试模式
     * @return 是否为调试模式
     */
    fun isDebugMode(): Boolean {
        return BuildConfig.DEBUG && config.debugMode
    }

    fun getApiNamespaces(): List<String> = config.apiNamespaces

    private val appContext: Context = context
    private lateinit var config: DiminaConfig

    init {
        // 基础初始化逻辑
        setupCoreComponents()
    }

    // 初始化核心组件
    private fun setupCoreComponents() {
        StoreUtils.initialize(context = appContext)
    }

    // 默认小程序（LAUNCHER 启动时使用）
    private var defaultMiniProgram: MiniProgram? = null

    /**
     * 设置默认小程序，在 DiminaActivity 作为 LAUNCHER 时使用。
     */
    fun setDefaultMiniProgram(miniProgram: MiniProgram) {
        defaultMiniProgram = miniProgram
    }

    /**
     * 获取默认小程序。
     */
    fun getDefaultMiniProgram(): MiniProgram? = defaultMiniProgram

    /**
     * 根据 appId 动态读取小程序元信息（config.json），构建 MiniProgram。
     * 优先读取已解压目录 filesDir/jsapp/<appId>/config.json，
     * 回退到内置资源 assets/jsapp/<appId>/config.json。
     * 该小程序作为首页（root=true）。
     */
    fun getMiniProgram(appId: String): MiniProgram? {
        val extracted = File(appContext.filesDir, "jsapp/$appId/config.json")
        val configText = if (extracted.exists()) {
            runCatching { extracted.readText() }.getOrNull()
        } else {
            runCatching {
                appContext.assets.open("jsapp/$appId/config.json").bufferedReader().use { it.readText() }
            }.getOrNull()
        }
        if (configText == null) {
            LogUtils.e("Dimina", "config.json not found for appId: $appId")
            return null
        }
        return runCatching {
            val obj = JSONObject(configText)
            MiniProgram(
                appId = obj.optString("appId", appId),
                name = obj.optString("name", ""),
                versionCode = obj.optInt("versionCode", 0),
                versionName = obj.optString("versionName", ""),
                root = true,
                path = obj.optString("path", null),
            )
        }.getOrNull()
    }

    // 应用配置
    private fun applyConfig(config: DiminaConfig) {
        // 存储配置到类属性
        this.config = config

		// A mini-program setting must never enable host logs in a release build.
		LogUtils.initialize(isDebugMode())
    }

    /**
     * 启动小程序
     * @param context 上下文
     * @param miniProgram 要启动的小程序对象
     */
    fun startMiniProgram(context: Activity, miniProgram: MiniProgram) {
        val miniApp = MiniApp.getInstance()
        miniApp.openApp(context, miniProgram)
    }

    /**
     * 注册第三方扩展 bridge 模块。
     *
     * 小程序通过 `wx.extBridge` / `wx.extOnBridge` / `wx.extOffBridge` 与 native 模块通信，
     * 宿主通过此方法向框架注册对应的处理器。建议在 [init] 之后、[startMiniProgram] 之前调用。
     *
     * 示例：
     * ```kotlin
     * Dimina.getInstance().registerExtModule("MyModule") { event, data, callback ->
     *     when (event) {
     *         "doSomething" -> {
     *             // 一次性调用
     *             callback.onSuccess(JSONObject().apply { put("result", 42) })
     *             null
     *         }
     *         "onDataChange" -> {
     *             // 持续订阅，返回取消函数
     *             val listener = registerListener { res -> callback.onSuccess(res) }
     *             Runnable { unregisterListener(listener) }
     *         }
     *         else -> { callback.onFail(JSONObject().apply { put("errMsg", "unknown event") }); null }
     *     }
     * }
     * ```
     *
     * @param moduleName 模块名，与小程序侧 `module` 参数一致
     * @param handler    处理器，参见 [ExtModuleHandler]
     */
    fun registerExtModule(moduleName: String, handler: ExtModuleHandler) {
        MiniApp.getInstance().registerExtModule(moduleName, handler)
    }
}
