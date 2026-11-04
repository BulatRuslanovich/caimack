// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

package app.caimack.playback

import app.caimack.api.Track
import kotlin.math.pow

object Loudness {
    const val TARGET_LUFS = -18.0

    fun gain(track: Track?, enabled: Boolean): Float {
        val lufs = track?.loudness?.lufs
        if (!enabled || lufs == null || !lufs.isFinite()) return 1f
        return 10.0.pow((TARGET_LUFS - lufs) / 20).coerceAtMost(1.0).toFloat()
    }
}
