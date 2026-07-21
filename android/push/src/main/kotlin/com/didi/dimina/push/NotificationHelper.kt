package com.didi.dimina.push

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.os.Build
import android.util.Base64
import android.view.View
import android.widget.RemoteViews
import androidx.core.app.NotificationCompat
import com.didi.dimina.Dimina
import com.didi.dimina.bean.MiniProgram
import com.didi.dimina.common.LogUtils
import com.didi.dimina.ui.container.DiminaActivity
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import java.net.URL
import java.net.URLEncoder
import org.json.JSONObject

/**
 * 通知展示助手, 复用系统 NotificationManager
 * 履历: 2026-07-17 创建, 构建通知并支持点击跳转小程序
 * 履历: 2026-07-18 增加 5 档级别/文字+图片(支持 custom/custom_big/bigpicture 三种 style)/文字+URL 跳转
 * 履历: 2026-07-18 默认级别改 HIGH 并显式开启声音+震动, 高/最高绕过勿扰, 升级渠道 v4
 * 履历: 2026-07-18 新建渠道时主动唤醒声音/震动服务, 应对 ROM 渠道属性变更后不响的问题
 * 履历: 2026-07-18 bigpicture 收起态回退标准图标+文字(横幅有图标), 仅下拉展开显示大图
 * 履历: 2026-07-18 新增 custom_thumb 模式(收起缩略图/展开大图)
 * 履历: 2026-07-18 新增 close 选项, 点击仅关闭横幅不跳转 app(优先级高于 url/小程序)
 * 履历: 2026-07-20 新增 miniProgram 字段, 点击打开指定小程序并把原始 JSON 作为启动参数(query.payload)传入
 * 履历: 2026-07-21 落地页 root 动态判定: 跳转 path 命中小程序首页则 root=true(回后台), 否则 root=false(可回退到首页)
 */
object NotificationHelper {
    /** 渠道版本, 调整通知行为后自增以强制重建渠道(渠道创建后不可变) */
    private const val CHANNEL_VERSION = 4
    /** 级别 -> (渠道ID, 渠道名, 重要性), 渠道按级别隔离以便动态控制提醒强度
     *  default 映射为 HIGH, 保证默认推送即有声音又有震动(DEFAULT 级别按规范不震动) */
    private val LEVELS = mapOf(
        "min" to Triple("push_min_v$CHANNEL_VERSION", "推送-最低", NotificationManager.IMPORTANCE_MIN),
        "low" to Triple("push_low_v$CHANNEL_VERSION", "推送-低", NotificationManager.IMPORTANCE_LOW),
        "default" to Triple("push_default_v$CHANNEL_VERSION", "推送-默认", NotificationManager.IMPORTANCE_HIGH),
        "high" to Triple("push_high_v$CHANNEL_VERSION", "推送-高", NotificationManager.IMPORTANCE_HIGH),
        "max" to Triple("push_max_v$CHANNEL_VERSION", "推送-最高", NotificationManager.IMPORTANCE_MAX),
    )

    private fun levelOf(data: Map<String, String>): Triple<String, String, Int> {
        val key = data["level"]?.lowercase() ?: "default"
        return LEVELS[key] ?: LEVELS["default"]!!
    }

    private fun ensureChannel(context: Context, triple: Triple<String, String, Int>) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            // 记录渠道是否已存在: 已存在的渠道配置不可变, 重复 create 无效
            val existed = nm.getNotificationChannel(triple.first) != null
            val channel = NotificationChannel(triple.first, triple.second, triple.third)
            channel.setDescription("Dimina 推送通知渠道")
            // default 及以上级别开启声音与震动; min/low 保持静默
            if (triple.third >= NotificationManager.IMPORTANCE_DEFAULT) {
                channel.setSound(
                    android.provider.Settings.System.DEFAULT_NOTIFICATION_URI,
                    android.media.AudioAttributes.Builder()
                        .setUsage(android.media.AudioAttributes.USAGE_NOTIFICATION).build()
                )
                channel.enableVibration(true)
                // 显式震动模式, 仅 enableVibration(true) 在部分版本不触发震动
                channel.vibrationPattern = longArrayOf(0, 300, 200, 300)
                // 高/最高级别绕过勿扰, 避免系统 DND 吞掉声音/震动
                if (triple.third >= NotificationManager.IMPORTANCE_HIGH) {
                    channel.setBypassDnd(true)
                }
            }
            nm.createNotificationChannel(channel)
            // 打印渠道真实配置, 便于排查: 已存在的渠道不可变, 改代码不生效需重装
            nm.getNotificationChannel(triple.first)?.let {
                LogUtils.d("NotificationHelper",
                    "channel ${it.id} importance=${it.importance} sound=${it.sound} vibrate=${it.shouldVibrate()} bypassDnd=${it.canBypassDnd()}")
            }
            // 新建渠道时主动唤醒一次声音+震动服务(部分 ROM 渠道属性变更后服务无响应, 需先触发一次)
            if (!existed && triple.third >= NotificationManager.IMPORTANCE_DEFAULT) {
                wakeUpSoundAndVibration(context)
            }
        }
    }

    /** 主动播放提示音 + 震动一次, 唤醒系统通知音频/震动服务(应对渠道属性变更后不响的 ROM 行为) */
    private fun wakeUpSoundAndVibration(context: Context) {
        try {
            val uri = android.media.RingtoneManager.getDefaultUri(android.media.RingtoneManager.TYPE_NOTIFICATION)
            android.media.RingtoneManager.getRingtone(context, uri)?.play()
        } catch (e: Exception) {
            LogUtils.e("NotificationHelper", "wake up ringtone failed: ${e.message}")
        }
        try {
            val vibrator = context.getSystemService(Context.VIBRATOR_SERVICE) as android.os.Vibrator
            val pattern = longArrayOf(0, 180, 80, 120)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                vibrator.vibrate(android.os.VibrationEffect.createWaveform(pattern, -1))
            } else {
                @Suppress("DEPRECATION") vibrator.vibrate(pattern, -1)
            }
        } catch (e: Exception) {
            LogUtils.e("NotificationHelper", "wake up vibrate failed: ${e.message}")
        }
    }

    fun showNotification(
        context: Context,
        title: String,
        content: String,
        miniProgram: MiniProgram?,
        data: Map<String, String> = emptyMap(),
    ) {
        val triple = levelOf(data)
        ensureChannel(context, triple)
        val (channelId, _, importance) = triple
        val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        LogUtils.d("NotificationHelper", "show level=${data["level"]} channel=$channelId importance=$importance")

        val priority = when (importance) {
            NotificationManager.IMPORTANCE_MIN -> NotificationCompat.PRIORITY_MIN
            NotificationManager.IMPORTANCE_LOW -> NotificationCompat.PRIORITY_LOW
            NotificationManager.IMPORTANCE_HIGH -> NotificationCompat.PRIORITY_HIGH
            NotificationManager.IMPORTANCE_MAX -> NotificationCompat.PRIORITY_MAX
            else -> NotificationCompat.PRIORITY_DEFAULT
        }

        val builder = NotificationCompat.Builder(context, channelId)
            .setContentTitle(title)
            .setContentText(content)
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setPriority(priority)
            .setCategory(NotificationCompat.CATEGORY_MESSAGE)
            .setAutoCancel(true)
        // Android 8 以下无渠道, 需 builder 显式指定声音+震动
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O && importance >= NotificationManager.IMPORTANCE_DEFAULT) {
            builder.setDefaults(NotificationCompat.DEFAULT_SOUND or NotificationCompat.DEFAULT_VIBRATE)
        }

        val id = System.currentTimeMillis().toInt()
        val closeOnly = data["close"]?.lowercase() == "true" || data["close"] == "1"
        if (closeOnly) {
            // 点击仅关闭横幅, 不跳转 app: 发送无接收者的广播 PendingIntent, 配合 autoCancel 关闭
            builder.setContentIntent(
                PendingIntent.getBroadcast(
                    context,
                    id,
                    Intent("com.didi.dimina.push.ACTION_DISMISS_ONLY").setPackage(context.packageName),
                    PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
                )
            )
        } else {
            buildIntent(context, miniProgram, data)?.let { intent ->
                builder.setContentIntent(
                    PendingIntent.getActivity(
                        context,
                        id,
                        intent,
                        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
                    )
                )
            }
        }

        val image = data["image"]
        val style = data["style"]?.lowercase() ?: "custom"

        if (!image.isNullOrEmpty()) {
            LogUtils.d("NotificationHelper", "loading image from: $image style=$style")
            CoroutineScope(Dispatchers.IO).launch {
                val bitmap = loadBitmap(image)
                if (bitmap != null) {
                    // 缩放避免 RemoteViews 跨进程传输过大导致不显示/TransactionTooLargeException
                    val bmp = scaleBitmap(bitmap, 400, 240)
                    LogUtils.d("NotificationHelper", "image loaded ${bmp.width}x${bmp.height}, apply style=$style")
                    when (style) {
                        "bigpicture" -> applyBigPicture(builder, title, content, bmp)
                        "custom_big" -> applyCustomBigView(builder, context, title, content, bmp)
                        "custom_thumb" -> applyCustomThumbView(builder, context, title, content, bmp)
                        else -> applyCustomView(builder, context, title, content, bmp)
                    }
                } else {
                    LogUtils.e("NotificationHelper", "image load failed, keep text only")
                }
                // 单次发布: 图片成功则带图, 失败则纯文字. 避免二次 notify 吞掉声音/震动
                postNotification(nm, id, builder)
            }
        } else {
            postNotification(nm, id, builder)
        }
    }

    /** 发布通知, 统一捕获 POST_NOTIFICATIONS 权限异常(Android 13+) */
    private fun postNotification(nm: NotificationManager, id: Int, builder: NotificationCompat.Builder) {
        try {
            nm.notify(id, builder.build())
        } catch (e: SecurityException) {
            LogUtils.e("NotificationHelper", "post notification failed: ${e.message}")
        }
    }

    /** 方式一: 系统 BigPictureStyle 大图 (收起显示标准图标+文字, 下拉展开显示大图) */
    private fun applyBigPicture(builder: NotificationCompat.Builder, title: String, content: String, bitmap: Bitmap) {
        builder.setStyle(
            NotificationCompat.BigPictureStyle()
                .bigPicture(bitmap)
                .setBigContentTitle(title)
                .setSummaryText(content)
        )
    }

    /** 方式二: 自定义 RemoteViews UI (收起/展开均显示图, 无需下拉) */
    private fun applyCustomView(builder: NotificationCompat.Builder, context: Context, title: String, content: String, bitmap: Bitmap) {
        // 自定义布局必须配合 DecoratedCustomViewStyle 才会被系统渲染
        builder.setStyle(NotificationCompat.DecoratedCustomViewStyle())
        // 收起态与展开态都显示自定义大图, 无需下拉即可见
        builder.setCustomContentView(buildCustomView(R.layout.notification_custom_collapsed, context, title, content, bitmap))
        builder.setCustomBigContentView(buildCustomView(R.layout.notification_custom, context, title, content, bitmap))
    }

    /** 方式三: 自定义 RemoteViews UI, 仅展开态显示大图 (收起为纯文字, 需下拉) */
    private fun applyCustomBigView(builder: NotificationCompat.Builder, context: Context, title: String, content: String, bitmap: Bitmap) {
        // 仅设大视图, 收起态保持系统标准文字, 下拉展开后显示自定义大图
        builder.setStyle(NotificationCompat.DecoratedCustomViewStyle())
        builder.setCustomBigContentView(buildCustomView(R.layout.notification_custom, context, title, content, bitmap))
    }

    /** 方式四: 自定义 RemoteViews UI, 收起态显示缩略图, 展开态显示大图 */
    private fun applyCustomThumbView(builder: NotificationCompat.Builder, context: Context, title: String, content: String, bitmap: Bitmap) {
        // 收起态: 左侧缩略图 + 文字; 展开态: 大图 + 文字
        builder.setStyle(NotificationCompat.DecoratedCustomViewStyle())
        builder.setCustomContentView(buildCustomView(R.layout.notification_custom_thumb, context, title, content, bitmap))
        builder.setCustomBigContentView(buildCustomView(R.layout.notification_custom, context, title, content, bitmap))
    }

    /** 限制位图尺寸, 避免 RemoteViews 传输过大导致不显示/TransactionTooLargeException */
    private fun scaleBitmap(src: Bitmap, maxW: Int, maxH: Int): Bitmap {
        val ratio = minOf(maxW.toFloat() / src.width, maxH.toFloat() / src.height, 1f)
        if (ratio >= 1f) return src
        return Bitmap.createScaledBitmap(src, (src.width * ratio).toInt(), (src.height * ratio).toInt(), true)
    }

    /** 构建自定义视图: 图片 + 标题 + 正文 (RemoteViews 不支持 WebView, 仅静态图文) */
    private fun buildCustomView(layoutRes: Int, context: Context, title: String, content: String, bitmap: Bitmap?): RemoteViews {
        val rv = RemoteViews(context.packageName, layoutRes)
        rv.setTextViewText(R.id.notif_title, title)
        rv.setTextViewText(R.id.notif_content, content)
        if (bitmap != null) {
            rv.setViewVisibility(R.id.notif_image, View.VISIBLE)
            rv.setImageViewBitmap(R.id.notif_image, bitmap)
        } else {
            rv.setViewVisibility(R.id.notif_image, View.GONE)
        }
        return rv
    }

    /** 点击意图优先级: url > 小程序(payload 指定) > 当前小程序 > 启动 App (close 由调用方处理) */
    private fun buildIntent(context: Context, miniProgram: MiniProgram?, data: Map<String, String>): Intent? {
        val url = data["url"]
        if (!url.isNullOrEmpty()) {
            return Intent(Intent.ACTION_VIEW, android.net.Uri.parse(url)).apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
        }
        // payload 指定要打开的小程序, 并把原始 JSON 作为启动参数(query.payload)传入
        val mpJson = data["miniProgram"]
        if (!mpJson.isNullOrEmpty()) {
            parseMiniProgram(mpJson, data["raw"])?.let { return buildDiminaIntent(context, it) }
        }
        if (miniProgram != null) return buildDiminaIntent(context, miniProgram)
        return context.packageManager.getLaunchIntentForPackage(context.packageName)
    }

    /** 解析 payload 中的 miniProgram 对象, 并把原始 JSON 作为 query.payload 附加到 path */
    private fun parseMiniProgram(mpJson: String, raw: String?): MiniProgram? {
        return try {
            val obj = JSONObject(mpJson)
            val appId = obj.optString("appId")
            if (appId.isEmpty()) {
                LogUtils.e("NotificationHelper", "miniProgram.appId is empty, skip")
                return null
            }
            // 跳转 path 命中小程序首页(config.json 的 path)则作为根页启动, 否则作为二级页(可回退回首页)
            val targetPath = obj.optString("path", null)
            val homePath = Dimina.getInstance().getMiniProgram(appId)?.path
            val isRoot = normalizePath(targetPath) == normalizePath(homePath)
            MiniProgram(
                appId = appId,
                name = obj.optString("name", ""),
                root = isRoot,
                path = buildPathWithPayload(targetPath, raw),
                versionCode = obj.optInt("versionCode", 0),
                versionName = obj.optString("versionName", ""),
                updateManifestUrl = obj.optString("updateManifestUrl", ""),
            )
        } catch (e: Exception) {
            LogUtils.e("NotificationHelper", "parse miniProgram failed: ${e.message}")
            null
        }
    }

    /** 规范化页面路径: 去掉前导 '/' 与 query, 便于与首页 path 做等值比较 */
    private fun normalizePath(path: String?): String =
        path?.substringBefore('?')?.trim('/') ?: ""

    /** 将原始 JSON 作为 query.payload 附加到小程序 path, 供 onLaunch options.query.payload 获取 */
    private fun buildPathWithPayload(basePath: String?, raw: String?): String? {
        if (basePath.isNullOrEmpty() || raw.isNullOrEmpty()) return basePath
        val encoded = try {
            URLEncoder.encode(raw, "UTF-8")
        } catch (e: Exception) {
            LogUtils.e("NotificationHelper", "encode payload failed: ${e.message}")
            return basePath
        }
        return if (basePath.contains("?")) "$basePath&payload=$encoded" else "$basePath?payload=$encoded"
    }

    /** 构造启动小程序的 Intent, 复用官方 DiminaActivity 的 MINI_PROGRAM_KEY */
    private fun buildDiminaIntent(context: Context, miniProgram: MiniProgram): Intent {
        return Intent(context, DiminaActivity::class.java).apply {
            putExtra(DiminaActivity.MINI_PROGRAM_KEY, miniProgram)
        }
    }

    /** 支持 http(s) URL 与 data:image base64 两种图片来源 */
    private fun loadBitmap(src: String): Bitmap? = try {
        val bitmap = if (src.startsWith("data:image")) {
            val bytes = Base64.decode(src.substringAfter(","), Base64.DEFAULT)
            BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
        } else {
            (URL(src).openConnection() as java.net.HttpURLConnection).run {
                connectTimeout = 10000
                readTimeout = 10000
                doInput = true
                connect()
                inputStream.use { BitmapFactory.decodeStream(it) }
            }
        }
        if (bitmap == null) {
            LogUtils.e("NotificationHelper", "decode bitmap failed (null), src=${src.take(40)}...")
        }
        bitmap
    } catch (e: Exception) {
        LogUtils.e("NotificationHelper", "load bitmap failed from ${src.take(40)}...: ${e.message}")
        null
    }
}
