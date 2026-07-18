package com.didi.dimina.ui.container

import org.junit.Assert.assertEquals
import org.junit.Test

class MiniProgramActivityRegistryTest {
    @Test
    fun `closeAll closes every page of the requested mini program from top to root`() {
        val registry = MiniProgramActivityRegistry<String>()
        registry.register("app-a", "root")
        registry.register("app-a", "page-1")
        registry.register("app-a", "page-2")
        registry.register("app-b", "other-app-root")

        val closed = mutableListOf<String>()
        registry.closeAll("app-a", closed::add)
        registry.closeAll("app-b", closed::add)

        assertEquals(listOf("page-2", "page-1", "root", "other-app-root"), closed)
    }

    @Test
    fun `unregistered pages are not closed`() {
        val registry = MiniProgramActivityRegistry<String>()
        registry.register("app", "root")
        registry.register("app", "page")
        registry.unregister("app", "page")

        val closed = mutableListOf<String>()
        registry.closeAll("app", closed::add)

        assertEquals(listOf("root"), closed)
    }
}
