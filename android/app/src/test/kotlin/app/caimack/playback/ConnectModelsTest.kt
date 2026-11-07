// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

package app.caimack.playback

import app.caimack.api.ConnectCommand
import app.caimack.api.ConnectRadio
import app.caimack.api.ConnectState
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.*
import org.junit.Test

class ConnectModelsTest {
    private val json = Json { ignoreUnknownKeys = true; explicitNulls = false }

    @Test fun defaultPlayValuesArePresentInTheCrossPlatformCommand() {
        val command: ConnectCommand = ConnectCommand.Play(listOf("track"), 0, 0.0, false, false, "off")
        val wire = json.parseToJsonElement(json.encodeToString(command)).jsonObject
        assertEquals("play", wire.getValue("type").jsonPrimitive.content)
        assertEquals("0", wire.getValue("index").jsonPrimitive.content)
        assertEquals("false", wire.getValue("playing").jsonPrimitive.content)
        assertEquals("false", wire.getValue("shuffle").jsonPrimitive.content)
        assertEquals("off", wire.getValue("repeat").jsonPrimitive.content)
    }

    @Test fun nativeReportsKeepTheSharedDefaultsAndEmptyRadioReasons() {
        val state = ConnectState(trackIds = listOf("track"), order = listOf(0), radio = ConnectRadio())
        val wire = json.parseToJsonElement(json.encodeToString(state)).jsonObject
        assertEquals("1.0", wire.getValue("volume").jsonPrimitive.content)
        assertEquals("off", wire.getValue("repeat").jsonPrimitive.content)
        assertEquals("true", wire.getValue("smartTransitions").jsonPrimitive.content)
        assertTrue(wire.getValue("radio").jsonObject.containsKey("reasons"))
    }

    @Test fun browserQueueAndSleepCommandsDecodeWithoutLosingTheirIdentity() {
        val move = json.decodeFromString<ConnectCommand>("""{"type":"move","from":2,"to":0,"trackId":"track"}""")
        assertEquals(ConnectCommand.Move(2, 0, "track"), move)
        val timer = json.decodeFromString<ConnectCommand>("""{"type":"setSleepTimer","minutes":null,"trackEnd":true}""")
        assertEquals(ConnectCommand.SetSleepTimer(null, true), timer)
    }
}
