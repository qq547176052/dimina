package com.didi.dimina.push

/**
 * MQTT 推送配置
 * 履历: 2026-07-17 创建, 承载 broker/clientId/鉴权/保活配置
 */
data class PushConfig(
    /** broker 地址, 如 "ssl://broker.example.com:8883" 或 "tcp://host:1883" */
    val broker: String,
    /** 客户端标识, 建议 appId + 设备标识, 保证唯一 */
    val clientId: String,
    val username: String? = null,
    val password: String? = null,
    val useSsl: Boolean = true,
    val keepAlive: Int = 30,
    val cleanStart: Boolean = true,
    /** 启动后自动订阅的主题列表, 断线重连时自动恢复 */
    val topics: List<String> = emptyList(),
)
