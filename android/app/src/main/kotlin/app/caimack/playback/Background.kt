// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

package app.caimack.playback

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.job.JobInfo
import android.app.job.JobParameters
import android.app.job.JobScheduler
import android.app.job.JobService
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import app.caimack.CaimackApp
import app.caimack.MainActivity
import app.caimack.R
import app.caimack.session.SessionState
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import java.time.LocalDate
import java.time.format.TextStyle
import java.util.Locale
import java.util.concurrent.TimeUnit

object Background {
    private const val AUTO_DOWNLOAD_JOB = 1
    private const val RECAP_JOB = 2

    const val LIKED_LIMIT = 100

    const val RECAP_CHANNEL = "recap"
    const val EXTRA_OPEN = "app.caimack.OPEN"
    const val OPEN_RECAP = "recap"

    fun schedule(context: Context) {
        val app = context.applicationContext
        val jobs = app.getSystemService(JobScheduler::class.java)
        val prefs = (app as CaimackApp).container.playbackPrefs

        if (prefs.autoDownloads.value && !app.container.syncStore.enabled) {
            jobs.schedule(
                JobInfo.Builder(AUTO_DOWNLOAD_JOB, ComponentName(app, AutoDownloadJob::class.java))
                    .setRequiredNetworkType(JobInfo.NETWORK_TYPE_UNMETERED)
                    .setRequiresCharging(true)
                    .setPeriodic(TimeUnit.HOURS.toMillis(6))
                    .setPersisted(true)
                    .build(),
            )
        } else {
            jobs.cancel(AUTO_DOWNLOAD_JOB)
        }

        if (prefs.recapReminder.value) {
            jobs.schedule(
                JobInfo.Builder(RECAP_JOB, ComponentName(app, RecapReminderJob::class.java))
                    .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
                    .setPeriodic(TimeUnit.HOURS.toMillis(12))
                    .setPersisted(true)
                    .build(),
            )
        } else {
            jobs.cancel(RECAP_JOB)
        }
    }

    fun canNotify(context: Context) =
        ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED
}

abstract class ContainerJob : JobService() {
    private var work: Job? = null

    protected abstract suspend fun run()

    override fun onStartJob(params: JobParameters): Boolean {
        val container = (application as CaimackApp).container
        work = container.scope.launch {
            val session = container.session.state.first { it !is SessionState.Restoring }
            if (session is SessionState.SignedIn) {
                runCatching { run() }.onFailure { Log.w("Caimack", "${javaClass.simpleName} failed", it) }
            }
            jobFinished(params, false)
        }
        return true
    }

    override fun onStopJob(params: JobParameters): Boolean {
        work?.cancel()
        return true
    }
}

class AutoDownloadJob : ContainerJob() {
    override suspend fun run() {
        val container = (application as CaimackApp).container
        val prefs = container.playbackPrefs
        if (!prefs.autoDownloads.value || container.syncStore.enabled) return

        val settings = runCatching { container.api.settings() }.getOrDefault(container.settings.value)
        val daily = runCatching { container.api.homeMix("daily").tracks }.getOrDefault(emptyList())
        val liked = runCatching { container.api.favorites(1, Background.LIKED_LIMIT).items }.getOrDefault(emptyList())
        if (daily.isEmpty() && liked.isEmpty()) return

        val wanted = (daily + liked).distinctBy { it.id }
        val wantedIds = wanted.map { it.id }.toSet()

        val stale = prefs.autoDownloaded - wantedIds
        container.downloads.removeInBackground(stale)
        val added = container.downloads.addInBackground(wanted, settings)
        prefs.autoDownloaded = prefs.autoDownloaded - stale + added

        container.downloads.awaitIdle()
    }
}

class RecapReminderJob : ContainerJob() {
    override suspend fun run() {
        val container = (application as CaimackApp).container
        val prefs = container.playbackPrefs
        val today = LocalDate.now()
        val month = today.toString().take(7)

        if (!prefs.recapReminder.value || today.dayOfMonth > 7 || prefs.recapNotifiedMonth == month) return
        if (!Background.canNotify(this)) return

        val response = container.api.recap()
        val recap = response.body()?.takeIf { response.code() == 200 } ?: return

        val locale = resources.configuration.locales[0] ?: Locale.getDefault()
        val monthName = LocalDate.of(recap.year, recap.month, 1).month.getDisplayName(TextStyle.FULL_STANDALONE, locale).lowercase(locale)
        notify(getString(R.string.recap_reminder_title, monthName), getString(R.string.recap_reminder_text))
        prefs.recapNotifiedMonth = month
    }

    private fun notify(title: String, text: String) {
        val manager = getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(
            NotificationChannel(Background.RECAP_CHANNEL, getString(R.string.recap_reminder_channel), NotificationManager.IMPORTANCE_DEFAULT),
        )
        val open = PendingIntent.getActivity(
            this,
            0,
            Intent(this, MainActivity::class.java)
                .putExtra(Background.EXTRA_OPEN, Background.OPEN_RECAP)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        manager.notify(
            RECAP_NOTIFICATION,
            NotificationCompat.Builder(this, Background.RECAP_CHANNEL)
                .setSmallIcon(R.drawable.ic_notification)
                .setContentTitle(title)
                .setContentText(text)
                .setContentIntent(open)
                .setAutoCancel(true)
                .build(),
        )
    }

    private companion object {
        const val RECAP_NOTIFICATION = 7
    }
}
