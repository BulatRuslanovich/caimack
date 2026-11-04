// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

package app.caimack.ui

import android.content.Context
import androidx.core.content.edit
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow

class RecentSearches(context: Context) {
    private val preferences = context.getSharedPreferences(FILE, Context.MODE_PRIVATE)
    private val current = MutableStateFlow(
        preferences.getString(QUERIES, null)?.split(SEPARATOR)?.filter { it.isNotBlank() }?.take(LIMIT).orEmpty(),
    )

    val queries: StateFlow<List<String>> = current

    fun remember(query: String) {
        val trimmed = query.trim().takeIf { it.isNotEmpty() } ?: return
        save((listOf(trimmed) + current.value.filterNot { it.equals(trimmed, ignoreCase = true) }).take(LIMIT))
    }

    fun forget(query: String) = save(current.value - query)

    fun clear() = save(emptyList())

    private fun save(next: List<String>) {
        preferences.edit { if (next.isEmpty()) remove(QUERIES) else putString(QUERIES, next.joinToString(SEPARATOR)) }
        current.value = next
    }

    private companion object {
        const val FILE = "search"
        const val QUERIES = "recent"
        const val LIMIT = 8

        const val SEPARATOR = "\u001F"
    }
}
