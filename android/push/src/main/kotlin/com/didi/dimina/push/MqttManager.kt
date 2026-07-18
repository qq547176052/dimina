package com.didi.dimina.push

import com.didi.dimina.common.LogUtils
import com.hivemq.client.mqtt.MqttClient
import com.hivemq.client.mqtt.MqttClientState
import com.hivemq.client.mqtt.datatypes.MqttQos
import com.hivemq.client.mqtt.mqtt5.message.publish.Mqtt5Publish
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.future.await
import kotlinx.coroutines.withContext
import java.nio.ByteBuffer

/**
 * MQTT 连接管理 (基于 HiveMQ Client 封装)
 * 履历: 2026-07-17 创建, 封装 connect/subscribe/unsubscribe/publish/disconnect, 内置自动重连
 * 履历: 2026-07-18 增加订阅/取消订阅/重连主题日志打印
 */
class MqttManager {
    companion object {
        private val instance = MqttManager()
        fun getInstance() = instance
    }

    private val tag = "MqttManager"
    private var client: com.hivemq.client.mqtt.mqtt5.Mqtt5AsyncClient? = null
    private val subscribedTopics = mutableSetOf<String>()

    /** 消息到达回调: topic / payload / MQTT5 用户属性(用于携带 title 等元数据) */
    var onMessage: ((topic: String, payload: ByteArray, userProperties: Map<String, String>) -> Unit)? = null

    suspend fun connect(config: PushConfig): Result<Unit> = withContext(Dispatchers.IO) {
        runCatching {
            val (host, port) = parseBroker(config.broker)
            val builder = MqttClient.builder()
                .useMqttVersion5()
                .identifier(config.clientId)
                .serverHost(host)
                .serverPort(port)
            if (config.useSsl) builder.sslWithDefaultConfig()
            builder.automaticReconnectWithDefaultConfig()
            val client = builder.buildAsync()
            this@MqttManager.client = client

            val connectBuilder = client.connectWith()
                .keepAlive(config.keepAlive)
                .cleanStart(config.cleanStart)
            if (!config.username.isNullOrEmpty()) {
                connectBuilder.simpleAuth()
                    .username(config.username)
                    .password(ByteBuffer.wrap((config.password ?: "").toByteArray()))
                    .applySimpleAuth()
            }
            connectBuilder.send().await()

            // 预置默认订阅主题, 由下方统一订阅并在重连时自动恢复
            subscribedTopics.addAll(config.topics)

            // 订阅已记录的主题 (含默认主题), 重连时自动恢复
            subscribedTopics.forEach { topic ->
                LogUtils.i(tag, "subscribe topic=$topic")
                client.subscribeWith()
                    .topicFilter(topic)
                    .qos(MqttQos.AT_LEAST_ONCE)
                    .callback { publish -> dispatch(publish) }
                    .send().await()
            }
        }
    }

    suspend fun subscribe(topic: String, qos: Int = 1): Result<Unit> = withContext(Dispatchers.IO) {
        runCatching {
            val client = client ?: throw IllegalStateException("mqtt not connected")
            client.subscribeWith()
                .topicFilter(topic)
                .qos(MqttQos.fromCode(qos) ?: MqttQos.AT_LEAST_ONCE)
                .callback { publish -> dispatch(publish) }
                .send().await()
            subscribedTopics.add(topic)
            LogUtils.i(tag, "subscribed topic=$topic qos=$qos, total=${subscribedTopics.size}")
        }.map { Unit }
    }

    suspend fun unsubscribe(topic: String): Result<Unit> = withContext(Dispatchers.IO) {
        runCatching {
            client?.unsubscribeWith()
                ?.topicFilter(topic)
                ?.send()
                ?.await()
            subscribedTopics.remove(topic)
            LogUtils.i(tag, "unsubscribed topic=$topic, total=${subscribedTopics.size}")
        }.map { Unit }
    }

    suspend fun publish(topic: String, payload: String, qos: Int = 1): Result<Unit> = withContext(Dispatchers.IO) {
        runCatching {
            val client = client ?: throw IllegalStateException("mqtt not connected")
            client.publishWith()
                .topic(topic)
                .qos(MqttQos.fromCode(qos) ?: MqttQos.AT_LEAST_ONCE)
                .payload(ByteBuffer.wrap(payload.toByteArray()))
                .send().await()
        }.map { Unit }
    }

    fun disconnect() {
        runCatching { client?.disconnect() }
        client = null
    }

    fun isConnected(): Boolean = client?.state == MqttClientState.CONNECTED

    private fun dispatch(publish: Mqtt5Publish) {
        val bytes = publish.getPayloadAsBytes() ?: byteArrayOf()
        val props = mutableMapOf<String, String>()
        for (up in publish.getUserProperties().asList()) {
            props[up.name.toString()] = up.value.toString()
        }
        LogUtils.i(tag, "message received, topic=${publish.getTopic()} props=$props")
        onMessage?.invoke(publish.getTopic().toString(), bytes, props)
    }

    private fun parseBroker(broker: String): Pair<String, Int> {
        val isSsl = broker.startsWith("ssl") || broker.startsWith("tls")
        val withoutScheme = broker.removePrefix("ssl://")
            .removePrefix("tls://")
            .removePrefix("tcp://")
        val parts = withoutScheme.split(":", limit = 2)
        val host = parts[0]
        val port = parts.getOrNull(1)?.toIntOrNull() ?: if (isSsl) 8883 else 1883
        return host to port
    }
}
