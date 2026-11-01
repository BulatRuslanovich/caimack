// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bulat Ruslanovich

package app.caimack.ui

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class SettingsSearchTest {
    @Test
    fun `search ignores case whitespace and the spelling of yo`() {
        assertTrue(settingsSearchMatches("  ТЕМНАЯ  ", listOf("Тёмная тема")))
    }

    @Test
    fun `wifi matches the label with a hyphen`() {
        assertTrue(settingsSearchMatches("wifi", listOf("Загружать по Wi-Fi")))
    }

    @Test
    fun `query words can match both the setting and its explanation`() {
        assertTrue(settingsSearchMatches("качество aac", listOf("Качество звука", "При медленном соединении используется AAC")))
        assertFalse(settingsSearchMatches("качество эквалайзер", listOf("Качество звука", "Предпочитаемое качество")))
    }

    @Test
    fun `an empty query shows all settings`() {
        assertTrue(settingsSearchMatches(" \n ", listOf("Theme")))
    }
}
