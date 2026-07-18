package com.didi.dimina.push

import com.didi.dimina.api.APIResult
import com.didi.dimina.api.AsyncResult
import com.didi.dimina.api.BaseApiHandler
import com.didi.dimina.api.NoneResult
import com.didi.dimina.common.ApiUtils
import com.didi.dimina.ui.container.DiminaActivity
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import org.json.JSONObject

/**
 * 小程序侧 MQTT 推送 API
 * 履历: 2026-07-17 创建, 暴露 wx.mqttConnect/Subscribe/Unsubscribe/Disconnect/Publish
 */
class MqttPushApi : BaseApiHandler() {
    companion object {
        const val MQTT_CONNECT = "mqttConnect"
        const val MQTT_SUBSCRIBE = "mqttSubscribe"
        const val MQTT_UNSUBSCRIBE = "mqttUnsubscribe"
        const val MQTT_DISCONNECT = "mqttDisconnect"
        const val MQTT_PUBLISH = "mqttPublish"
    }

    override val apiNames = setOf(
        MQTT_CONNECT,
        MQTT_SUBSCRIBE,
        MQTT_UNSUBSCRIBE,
        MQTT_DISCONNECT,
        MQTT_PUBLISH,
    )

    override fun handleAction(
        activity: DiminaActivity,
        appId: String,
        apiName: String,
        params: JSONObject,
        responseCallback: (String) -> Unit,
    ): APIResult {
        return when (apiName) {
            MQTT_CONNECT -> {
                PushModule.setCurrentMiniProgram(activity.getMiniProgram())
                val config = PushModule.getConfig()
                if (config == null) {
                    ApiUtils.invokeFail(
                        params,
                        JSONObject().apply { put("errMsg", "$MQTT_CONNECT:fail push not initialized") },
                        responseCallback,
                    )
                    return NoneResult()
                }
                PushModule.ensureServiceStarted(activity)
                CoroutineScope(Dispatchers.IO).launch {
                    val res = MqttManager.getInstance().connect(config)
                    val msg = "$MQTT_CONNECT:${if (res.isSuccess) "ok" else "fail ${res.exceptionOrNull()?.message}"}"
                    val result = JSONObject().apply { put("errMsg", msg) }
                    if (res.isSuccess) {
                        ApiUtils.invokeSuccess(params, result, responseCallback)
                    } else {
                        ApiUtils.invokeFail(params, result, responseCallback)
                    }
                }
                NoneResult()
            }

            MQTT_SUBSCRIBE -> {
                val topic = params.optString("topic")
                if (topic.isEmpty()) {
                    ApiUtils.invokeFail(
                        params,
                        JSONObject().apply { put("errMsg", "$MQTT_SUBSCRIBE:fail topic is empty") },
                        responseCallback,
                    )
                    return NoneResult()
                }
                val qos = params.optInt("qos", 1)
                CoroutineScope(Dispatchers.IO).launch {
                    val res = MqttManager.getInstance().subscribe(topic, qos)
                    val msg = "$MQTT_SUBSCRIBE:${if (res.isSuccess) "ok" else "fail ${res.exceptionOrNull()?.message}"}"
                    val result = JSONObject().apply { put("errMsg", msg) }
                    if (res.isSuccess) {
                        ApiUtils.invokeSuccess(params, result, responseCallback)
                    } else {
                        ApiUtils.invokeFail(params, result, responseCallback)
                    }
                }
                NoneResult()
            }

            MQTT_UNSUBSCRIBE -> {
                val topic = params.optString("topic")
                CoroutineScope(Dispatchers.IO).launch {
                    val res = MqttManager.getInstance().unsubscribe(topic)
                    val msg = "$MQTT_UNSUBSCRIBE:${if (res.isSuccess) "ok" else "fail ${res.exceptionOrNull()?.message}"}"
                    val result = JSONObject().apply { put("errMsg", msg) }
                    if (res.isSuccess) {
                        ApiUtils.invokeSuccess(params, result, responseCallback)
                    } else {
                        ApiUtils.invokeFail(params, result, responseCallback)
                    }
                }
                NoneResult()
            }

            MQTT_DISCONNECT -> {
                MqttManager.getInstance().disconnect()
                ApiUtils.invokeSuccess(
                    params,
                    JSONObject().apply { put("errMsg", "$MQTT_DISCONNECT:ok") },
                    responseCallback,
                )
                NoneResult()
            }

            MQTT_PUBLISH -> {
                val topic = params.optString("topic")
                val payload = params.optString("payload")
                val qos = params.optInt("qos", 1)
                CoroutineScope(Dispatchers.IO).launch {
                    val res = MqttManager.getInstance().publish(topic, payload, qos)
                    val msg = "$MQTT_PUBLISH:${if (res.isSuccess) "ok" else "fail ${res.exceptionOrNull()?.message}"}"
                    val result = JSONObject().apply { put("errMsg", msg) }
                    if (res.isSuccess) {
                        ApiUtils.invokeSuccess(params, result, responseCallback)
                    } else {
                        ApiUtils.invokeFail(params, result, responseCallback)
                    }
                }
                NoneResult()
            }

            else -> super.handleAction(activity, appId, apiName, params, responseCallback)
        }
    }
}
