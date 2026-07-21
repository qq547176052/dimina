package com.didi.dimina.bean

import android.webkit.WebView
import com.didi.dimina.core.JsCore
import org.json.JSONObject

/**
 * Author: Doslin
 */

data class PathInfo(
    val pagePath: String,
    val query: JSONObject?
)

// 合并后的页面配置结果
data class MergedPageConfig(
    val navigationBarTitleText: String,
    val navigationBarBackgroundColor: String,
    val navigationBarTextStyle: String,
    val backgroundColor: String,
    val navigationStyle: String,
    val capsuleStyle: String,
    val canClose: Boolean,
    val usingComponents: Map<String, String>
)

data class BridgeOptions(
    var pathInfo: PathInfo,
    val scene: Int?,
    val jscore: JsCore,
    val webview: WebView,
    val isRoot: Boolean,
    var root: String,
    val appId: String,
    val pages: List<String>,
    var configInfo: MergedPageConfig,
)