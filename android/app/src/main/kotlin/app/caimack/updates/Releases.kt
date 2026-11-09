// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich
package app.caimack.updates

import java.io.IOException
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.OkHttpClient
import okhttp3.Request

/** Matches the stable versions and versionCode scheme used by scripts/release.mjs. */
internal fun releaseVersion(value: String): Int? {
    val match = Regex("v?(0|[1-9][0-9]?)\\.(0|[1-9][0-9]?)\\.(0|[1-9][0-9]?)").matchEntire(value) ?: return null
    return match.groupValues.drop(1).map(String::toInt).fold(0) { code, part -> code * 100 + part }
}

@Serializable
data class AppRelease(
    val tag: String,
    val notes: String,
    val apkUrl: String,
    val pageUrl: String,
) {
    val version: String get() = tag.removePrefix("v")
}

@Serializable
internal data class GitHubRelease(
    @SerialName("tag_name") val tag: String,
    val body: String? = null,
    val draft: Boolean = false,
    val prerelease: Boolean = false,
    val assets: List<GitHubAsset> = emptyList(),
)

@Serializable
internal data class GitHubAsset(
    val name: String,
    val state: String = "",
    val size: Long = 0,
    @SerialName("browser_download_url") val url: String,
)

fun interface ReleaseSource {
    suspend fun latest(): AppRelease?
}

class GitHubReleases(
    private val repository: String,
    // A separate client: music server interceptors, authentication and cookies must never reach GitHub.
    private val client: OkHttpClient = OkHttpClient.Builder()
        .callTimeout(15, TimeUnit.SECONDS)
        .connectTimeout(10, TimeUnit.SECONDS)
        .cache(null)
        .build(),
    private val api: HttpUrl = "https://api.github.com/".toHttpUrl(),
) : ReleaseSource {
    private val json = Json { ignoreUnknownKeys = true }

    override suspend fun latest(): AppRelease? = withContext(Dispatchers.IO) {
        val request = Request.Builder()
            .url(api.newBuilder().addPathSegments("repos/$repository/releases/latest").build())
            .header("Accept", "application/vnd.github+json")
            .header("User-Agent", "Caimack-Android")
            .build()
        client.newCall(request).execute().use { response ->
            if (response.code == 404) return@withContext null
            if (!response.isSuccessful) throw IOException("Release check failed (${response.code})")
            val body = response.body
            val content = body.source()
            content.request(2_000_001)
            if (content.buffer.size > 2_000_000) throw IOException("Release response is too large")
            val raw = content.readUtf8()
            parse(raw)
        }
    }

    internal fun parse(raw: String): AppRelease? {
        val release = json.decodeFromString<GitHubRelease>(raw)
        if (release.draft || release.prerelease || releaseVersion(release.tag) == null) return null
        val asset = release.assets.firstOrNull {
            it.name == "caimack-${release.tag}-arm64.apk" && it.state == "uploaded" && it.size > 0 &&
                trustedDownload(it.url, repository, release.tag, it.name)
        } ?: throw IOException("Android APK is not published yet")
        return AppRelease(
            tag = release.tag,
            notes = release.body.orEmpty().take(12_000),
            apkUrl = asset.url,
            pageUrl = "https://github.com/$repository/releases/tag/${release.tag}",
        )
    }
}

internal fun trustedRelease(release: AppRelease, repository: String): Boolean =
    releaseVersion(release.tag) != null &&
        release.pageUrl == "https://github.com/$repository/releases/tag/${release.tag}" &&
        trustedDownload(release.apkUrl, repository, release.tag, "caimack-${release.tag}-arm64.apk")

private fun trustedDownload(value: String, repository: String, tag: String, name: String): Boolean {
    val url = value.toHttpUrlOrNull() ?: return false
    return url.scheme == "https" && url.host == "github.com" && url.port == 443 &&
        url.username.isEmpty() && url.password.isEmpty() && url.query == null && url.fragment == null &&
        url.pathSegments.take(2).zip(repository.split('/')).all { (actual, expected) -> actual.equals(expected, ignoreCase = true) } &&
        url.pathSegments.size == 6 && url.pathSegments.drop(2) == listOf("releases", "download", tag, name)
}
