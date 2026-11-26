// SPDX-License-Identifier: AGPL-3.0-only
package app.caimack.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalResources
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import app.caimack.R

enum class SettingsCategory(val key: String, val title: Int) {
    Playback("playback", R.string.settings_playback),
    Equalizer("equalizer", R.string.settings_equalizer),
    Appearance("appearance", R.string.settings_appearance),
    Downloads("downloads", R.string.settings_downloads),
    Listening("listening", R.string.listening_title),
    Account("account", R.string.nav_account),
    Updates("updates", R.string.settings_updates);
    companion object { fun of(key: String) = entries.firstOrNull { it.key == key } }
}

@Composable
internal fun SettingsOverview(query: String = "") {
    val resources = LocalResources.current
    // Observe locale changes as well as the query (Resources itself can be reused).
    LocalConfiguration.current
    val recommendations = recommendationsEnabled()
    val matching = matchingSettings(query, resources).filter { recommendations || it != SettingKey.Tile }
    val categories = SettingsCategory.entries.filter { category ->
        query.isBlank() || matching.any { it.section == category.title }
    }
    Column {
        if (categories.isEmpty()) Empty(stringResource(R.string.settings_search_empty))
        categories.forEach { SettingsCategoryRow(it) }
    }
}

@Composable
internal fun SettingsCategoryRow(category: SettingsCategory) {
    val navigate = LocalNavigate.current
    val palette = LocalPalette.current
    Row(
        Modifier.fillMaxWidth().padding(horizontal = 16.dp)
            .clip(Radius.row)
            .clickable(role = Role.Button) {
                navigate(if (category == SettingsCategory.Listening) ListeningRoute() else SettingsSectionRoute(category.key))
            }
            .heightIn(min = 48.dp)
            .padding(horizontal = 8.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text(
            stringResource(category.title),
            modifier = Modifier.weight(1f),
            style = Type.body.copy(fontWeight = FontWeight.Medium),
        )
        Icon(Lucide.ChevronRight, null, Modifier.size(16.dp), tint = palette.muted)
    }
}
