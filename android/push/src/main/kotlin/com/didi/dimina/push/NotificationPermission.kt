/**
 * 通知运行时权限(POST_NOTIFICATIONS)申请辅助
 * 将 Android 13+ 通知权限申请收敛到 push 模块, 由宿主 Activity 在 onCreate 中调用
 * 履历: 2026-07-18 新增, 替代 MainActivity 中的权限申请逻辑
 */
package com.didi.dimina.push

import android.Manifest
import android.os.Build
import android.util.Log
import androidx.activity.ComponentActivity
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat

/**
 * 在 Android 13+ 上运行时申请 POST_NOTIFICATIONS 权限
 * 必须在 Activity 的 onStart 之前(通常 onCreate 内)调用, 以满足 Activity Result API 的注册要求
 * @param onResult 授权结果回调, 低于 Android 13 时直接回调 true
 */
fun ComponentActivity.requestNotificationPermission(
    onResult: ((granted: Boolean) -> Unit)? = null
) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
        onResult?.invoke(true)
        return
    }
    if (ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS)
        == android.content.pm.PackageManager.PERMISSION_GRANTED
    ) {
        onResult?.invoke(true)
        return
    }
    val launcher = registerForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { granted ->
        if (!granted) {
            Log.w("NotificationPermission", "POST_NOTIFICATIONS 未授予, 推送通知可能无法展示")
        }
        onResult?.invoke(granted)
    }
    launcher.launch(Manifest.permission.POST_NOTIFICATIONS)
}
