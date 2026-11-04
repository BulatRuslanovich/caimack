// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

package app.caimack.playback

data class PlaybackDelivery(
    val trackId: String,
    val adaptive: Boolean,
    val bitrateKbps: Int? = null,
    val reason: String? = null,
)
