// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

package app.caimack.audiobooks

import kotlinx.serialization.Serializable
import okhttp3.HttpUrl
import retrofit2.Response
import retrofit2.http.Body
import retrofit2.http.DELETE
import retrofit2.http.GET
import retrofit2.http.PUT
import retrofit2.http.Url

@Serializable
data class Audiobook(
    val id: String,
    val title: String,
    val author: String? = null,
    val narrator: String? = null,
    val coverUrl: String? = null,
    val durationMs: Long,
    val chapters: List<AudiobookChapter>,
    val saved: Boolean = false,
    val savedAtMs: Long? = null,
    val progress: AudiobookProgress? = null,
) {
    fun elapsedMs(progress: AudiobookProgress): Long {
        if (progress.completed) return durationMs
        val index = chapters.indexOfFirst { it.id == progress.chapterId }
        if (index < 0) return 0
        return chapters.take(index).sumOf { it.durationMs } + progress.positionMs
    }
}

@Serializable
data class AudiobookChapter(val id: String, val title: String, val durationMs: Long, val sizeBytes: Long, val streamUrl: String)

@Serializable
data class AudiobookProgress(val chapterId: String, val positionMs: Long, val updatedAtMs: Long, val completed: Boolean = false)

interface AudiobookApi {
    @GET suspend fun catalog(@Url url: HttpUrl): Response<List<Audiobook>>
    @GET suspend fun book(@Url url: HttpUrl): Response<Audiobook>
    @PUT suspend fun progress(@Url url: HttpUrl, @Body progress: AudiobookProgress): Response<AudiobookProgress>
    @PUT suspend fun save(@Url url: HttpUrl)
    @DELETE suspend fun unsave(@Url url: HttpUrl)
}
