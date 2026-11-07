// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

package app.caimack.api

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.EncodeDefault
import kotlinx.serialization.ExperimentalSerializationApi

@Serializable
data class ConnectDevice(val id: String, val name: String, val connectionId: String, val kind: String = "web")

@OptIn(ExperimentalSerializationApi::class)
@Serializable
data class ConnectRadio(
    val seedTrackId: String? = null,
    val focus: String? = null,
    @EncodeDefault val reasons: Map<String, RecommendationReason> = emptyMap(),
)

@Serializable
data class ConnectSleep(val kind: String, val minutes: Int = 0, val endsAt: Long = 0)

@OptIn(ExperimentalSerializationApi::class)
@Serializable
data class ConnectState(
    val deviceId: String = "",
    val queueRevision: Long = 0,
    val reportedAt: String = "",
    val trackIds: List<String> = emptyList(),
    val index: Int = 0,
    val order: List<Int> = emptyList(),
    val positionSeconds: Double = 0.0,
    val isPlaying: Boolean = false,
    val buffering: Boolean = false,
    @EncodeDefault val volume: Double = 1.0,
    val muted: Boolean = false,
    val shuffle: Boolean = false,
    @EncodeDefault val repeat: String = "off",
    val radio: ConnectRadio? = null,
    val crossfade: Double = 0.0,
    @EncodeDefault val smartTransitions: Boolean = true,
    val normalizeVolume: Boolean = false,
    @EncodeDefault val autoplay: Boolean = true,
    val sleepTimer: ConnectSleep? = null,
)

@Serializable
data class ConnectSnapshot(val epoch: String = "", val version: Long = 0, val devices: List<ConnectDevice> = emptyList(), val playback: ConnectState? = null)

@Serializable
sealed interface ConnectCommand {
    @Serializable @SerialName("setPlaying") data class SetPlaying(val playing: Boolean) : ConnectCommand
    @Serializable @SerialName("next") data object Next : ConnectCommand
    @Serializable @SerialName("previous") data object Previous : ConnectCommand
    @Serializable @SerialName("seek") data class Seek(val positionSeconds: Double) : ConnectCommand
    @Serializable @SerialName("setVolume") data class SetVolume(val volume: Double) : ConnectCommand
    @Serializable @SerialName("setMuted") data class SetMuted(val muted: Boolean) : ConnectCommand
    @Serializable @SerialName("setShuffle") data class SetShuffle(val shuffle: Boolean) : ConnectCommand
    @Serializable @SerialName("setRepeat") data class SetRepeat(val repeat: String) : ConnectCommand
    @Serializable @SerialName("play") data class Play(
        val trackIds: List<String>, val index: Int, val positionSeconds: Double,
        val playing: Boolean, val shuffle: Boolean, val repeat: String, val source: String? = null,
        val order: List<Int>? = null, val radio: ConnectRadio? = null,
    ) : ConnectCommand
    @Serializable @SerialName("enqueue") data class Enqueue(val trackId: String, val next: Boolean) : ConnectCommand
    @Serializable @SerialName("remove") data class Remove(val index: Int, val trackId: String) : ConnectCommand
    @Serializable @SerialName("jump") data class Jump(val index: Int, val trackId: String) : ConnectCommand
    @Serializable @SerialName("move") data class Move(val from: Int, val to: Int, val trackId: String) : ConnectCommand
    @Serializable @SerialName("clear") data object Clear : ConnectCommand
    @Serializable @SerialName("clearUpcoming") data object ClearUpcoming : ConnectCommand
    @Serializable @SerialName("startRadio") data class StartRadio(val seedTrackId: String? = null) : ConnectCommand
    @Serializable @SerialName("setRadioFocus") data class SetRadioFocus(val focus: String) : ConnectCommand
    @Serializable @SerialName("setCrossfade") data class SetCrossfade(val seconds: Double) : ConnectCommand
    @Serializable @SerialName("setSmartTransitions") data class SetSmartTransitions(val enabled: Boolean) : ConnectCommand
    @Serializable @SerialName("setNormalizeVolume") data class SetNormalizeVolume(val enabled: Boolean) : ConnectCommand
    @Serializable @SerialName("setAutoplay") data class SetAutoplay(val enabled: Boolean) : ConnectCommand
    @Serializable @SerialName("setSleepTimer") data class SetSleepTimer(val minutes: Int?, val trackEnd: Boolean) : ConnectCommand
}

@Serializable
data class ConnectEnvelope(
    val id: String, val connectionId: String, val expiresAt: String,
    val queueRevision: Long? = null, val command: ConnectCommand,
)

@Serializable
data class ConnectReport(val deviceId: String, val connectionId: String, val state: ConnectState)

@Serializable
data class ConnectRequest(val id: String, val deviceId: String, val command: ConnectCommand, val queueRevision: Long? = null)

@Serializable
data class ConnectAck(val deviceId: String, val connectionId: String, val error: String? = null)

@Serializable
data class ConnectHeartbeat(val deviceId: String, val connectionId: String)
