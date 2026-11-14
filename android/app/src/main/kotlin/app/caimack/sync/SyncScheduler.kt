// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

package app.caimack.sync

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.app.job.JobInfo
import android.app.job.JobParameters
import android.app.job.JobScheduler
import android.app.job.JobService
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import app.caimack.CaimackApp
import app.caimack.MainActivity
import app.caimack.R
import app.caimack.session.SessionState
import java.util.concurrent.ConcurrentHashMap
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch

object SyncScheduler {
    private const val PERIODIC = 3
    private const val SOON = 4

    fun schedule(context: Context, soon: Boolean = false) {
        val app = context.applicationContext as CaimackApp
        val store = app.container.syncStore
        val jobs = app.getSystemService(JobScheduler::class.java)
        if (!store.enabled || store.paused) {
            jobs.cancel(PERIODIC)
            jobs.cancel(SOON)
            return
        }
        val network =
            NetworkRequest.Builder()
                .addTransportType(NetworkCapabilities.TRANSPORT_WIFI)
                .addTransportType(NetworkCapabilities.TRANSPORT_ETHERNET)
                .addCapability(NetworkCapabilities.NET_CAPABILITY_NOT_VPN)
                .build()
        if (jobs.getPendingJob(PERIODIC) == null)
            jobs.schedule(
                JobInfo.Builder(PERIODIC, ComponentName(app, SyncJob::class.java))
                    .setRequiredNetwork(network)
                    .setPeriodic(15 * 60_000L)
                    .setPersisted(true)
                    .build()
            )
        if (soon && jobs.getPendingJob(SOON) == null)
            jobs.schedule(
                JobInfo.Builder(SOON, ComponentName(app, SyncJob::class.java))
                    .setRequiredNetwork(network)
                    .setMinimumLatency(2_000)
                    .setBackoffCriteria(30_000, JobInfo.BACKOFF_POLICY_EXPONENTIAL)
                    .build()
            )
    }

    fun observe(context: Context) {
        val connectivity = context.getSystemService(ConnectivityManager::class.java)
        val request =
            NetworkRequest.Builder()
                .addTransportType(NetworkCapabilities.TRANSPORT_WIFI)
                .addTransportType(NetworkCapabilities.TRANSPORT_ETHERNET)
                .build()
        connectivity.registerNetworkCallback(
            request,
            object : ConnectivityManager.NetworkCallback() {
                override fun onAvailable(network: Network) {
                    schedule(context, soon = true)
                }
            },
        )
        schedule(context)
    }

    fun start(context: Context) {
        val store = (context.applicationContext as CaimackApp).container.syncStore
        store.paused = false
        ContextCompat.startForegroundService(context, Intent(context, SyncService::class.java))
        schedule(context)
    }
}

class SyncJob : JobService() {
    private val work = ConcurrentHashMap<JobParameters, Job>()

    override fun onStartJob(params: JobParameters): Boolean {
        val app = (application as CaimackApp).container
        val task =
            app.scope.launch(start = CoroutineStart.LAZY) {
                try {
                    val state = app.session.state.first { it !is SessionState.Restoring }
                    if (state is SessionState.SignedIn) {
                        app.syncStore.session(state.user)
                        app.sync.run()
                    }
                } finally {
                    work.remove(params)
                    jobFinished(params, false)
                }
            }
        work[params] = task
        task.start()
        return true
    }

    override fun onStopJob(params: JobParameters): Boolean {
        work.remove(params)?.cancel()
        return true
    }
}

class SyncService : Service() {
    private var work: Job? = null
    private var updates: Job? = null

    override fun onBind(intent: Intent?) = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val container = (application as CaimackApp).container
        if (intent?.action == "pause") {
            container.sync.pause()
            stopSelf()
            return START_NOT_STICKY
        }
        val manager = getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(
            NotificationChannel(
                CHANNEL,
                getString(R.string.sync_title),
                NotificationManager.IMPORTANCE_LOW,
            )
        )
        startForeground(NOTIFICATION, notification(container.syncStore.status.value))
        if (work?.isActive == true) return START_NOT_STICKY
        updates =
            container.scope.launch {
                container.syncStore.status.collect {
                    manager.notify(NOTIFICATION, notification(it))
                }
            }
        work =
            container.scope.launch {
                try {
                    val state = container.session.state.first { it !is SessionState.Restoring }
                    if (state is SessionState.SignedIn) {
                        container.syncStore.session(state.user)
                        container.sync.run()
                    }
                } finally {
                    updates?.cancel()
                    stopSelf()
                }
            }
        return START_NOT_STICKY
    }

    private fun notification(status: SyncStatus): android.app.Notification {
        val open =
            PendingIntent.getActivity(
                this,
                0,
                Intent(this, MainActivity::class.java),
                PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
            )
        val pause =
            PendingIntent.getService(
                this,
                1,
                Intent(this, SyncService::class.java).setAction("pause"),
                PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
            )
        return NotificationCompat.Builder(this, CHANNEL)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(getString(R.string.sync_title))
            .setContentText(
                status.message ?: getString(R.string.sync_progress, status.completed, status.total)
            )
            .setContentIntent(open)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setProgress(status.total, status.completed, status.total == 0)
            .addAction(0, getString(R.string.sync_pause), pause)
            .build()
    }

    override fun onTimeout(startId: Int, fgsType: Int) {
        work?.cancel()
        stopSelf()
    }

    override fun onDestroy() {
        work?.cancel()
        updates?.cancel()
        super.onDestroy()
    }

    companion object {
        private const val CHANNEL = "library-sync"
        private const val NOTIFICATION = 9
    }
}
