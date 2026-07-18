package com.didi.dimina.ui.container

/**
 * Tracks the Android activities that form a mini program's page stack.
 *
 * Every page is hosted by the same Activity class, so Android's component-based
 * CLEAR_TOP lookup cannot distinguish the root page from the current page.
 */
internal class MiniProgramActivityRegistry<T> {
    private val activitiesByAppId = mutableMapOf<String, LinkedHashSet<T>>()

    @Synchronized
    fun register(appId: String, activity: T) {
        activitiesByAppId.getOrPut(appId) { linkedSetOf() }.add(activity)
    }

    @Synchronized
    fun unregister(appId: String, activity: T) {
        val activities = activitiesByAppId[appId] ?: return
        activities.remove(activity)
        if (activities.isEmpty()) {
            activitiesByAppId.remove(appId)
        }
    }

    fun closeAll(appId: String, close: (T) -> Unit) {
        val activities = synchronized(this) {
            activitiesByAppId.remove(appId)?.toList().orEmpty()
        }
        activities.asReversed().forEach(close)
    }
}
