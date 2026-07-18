# Push 模块混淆规则
# HiveMQ / Netty 在 R8 下需要保留, 避免运行时 NoClassDefFoundError
-keep class com.hivemq.client.** { *; }
-keep class io.netty.** { *; }
-dontwarn com.hivemq.client.**
-dontwarn io.netty.**
