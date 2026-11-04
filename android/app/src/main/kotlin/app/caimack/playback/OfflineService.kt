// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

package app.caimack.playback

import android.app.Notification
import androidx.annotation.OptIn
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.offline.Download
import androidx.media3.exoplayer.offline.DownloadManager
import androidx.media3.exoplayer.offline.DownloadNotificationHelper
import androidx.media3.exoplayer.offline.DownloadService
import androidx.media3.exoplayer.scheduler.Scheduler
import app.caimack.CaimackApp
import app.caimack.R

@OptIn(UnstableApi::class)
class OfflineService : DownloadService(NOTIFICATION_ID, DEFAULT_FOREGROUND_NOTIFICATION_UPDATE_INTERVAL, CHANNEL, R.string.downloads_title, 0) {
    override fun getDownloadManager(): DownloadManager = (application as CaimackApp).container.downloads.manager

    override fun getScheduler(): Scheduler? = null

    override fun getForegroundNotification(downloads: MutableList<Download>, notMetRequirements: Int): Notification =
        DownloadNotificationHelper(this, CHANNEL)
            .buildProgressNotification(this, R.drawable.ic_notification, null, null, downloads, notMetRequirements)

    private companion object {
        const val NOTIFICATION_ID = 2002
        const val CHANNEL = "downloads"
    }
}
