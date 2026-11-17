// SPDX-License-Identifier: AGPL-3.0-only

package app.caimack.playback

data class PlaybackDelivery(
    val trackId: String,
    val adaptive: Boolean,
    val bitrateKbps: Int? = null,
    val reason: String? = null,
)
