// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bulat Ruslanovich

package app.caimack.playback

import android.app.Notification
import android.content.Context
import androidx.compose.ui.graphics.toArgb
import androidx.media3.common.util.UnstableApi
import androidx.media3.session.CommandButton
import androidx.media3.session.DefaultMediaNotificationProvider
import androidx.media3.session.MediaNotification
import androidx.media3.session.MediaSession
import app.caimack.R
import app.caimack.ui.Appearance
import com.google.common.collect.ImmutableList

@UnstableApi
internal class PlaybackNotificationProvider(
    private val context: Context,
    private val appearance: Appearance,
    private val delegate: DefaultMediaNotificationProvider = DefaultMediaNotificationProvider.Builder(context)
        .build().apply { setSmallIcon(R.drawable.ic_notification) },
) : MediaNotification.Provider by delegate {
    override fun createNotification(
        mediaSession: MediaSession,
        mediaButtonPreferences: ImmutableList<CommandButton>,
        actionFactory: MediaNotification.ActionFactory,
        onNotificationChangedCallback: MediaNotification.Provider.Callback,
    ): MediaNotification = themed(delegate.createNotification(
        mediaSession, mediaButtonPreferences, actionFactory,
        { notification -> onNotificationChangedCallback.onNotificationChanged(themed(notification)) },
    ))

    private fun themed(media: MediaNotification): MediaNotification {
        val notification = Notification.Builder.recoverBuilder(context, media.notification)
            .setColor(appearance.palette().background.toArgb())
            .setColorized(true)
            .build()
        return MediaNotification(media.notificationId, notification)
    }
}
