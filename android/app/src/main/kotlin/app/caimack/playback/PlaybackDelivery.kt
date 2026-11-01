// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bulat Ruslanovich

package app.caimack.playback

data class PlaybackDelivery(
    val trackId: String,
    val adaptive: Boolean,
    val bitrateKbps: Int? = null,
    val reason: String? = null,
)
