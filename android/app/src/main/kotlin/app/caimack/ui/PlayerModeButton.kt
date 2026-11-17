// SPDX-License-Identifier: AGPL-3.0-only
package app.caimack.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Icon
import androidx.compose.material3.ripple
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.unit.dp

/** Shape, inverse icon and a persistent dot distinguish modes even in monochrome. */
@Composable
internal fun PlayerModeButton(
    icon: ImageVector,
    label: String,
    active: Boolean,
    mode: String,
    enabled: Boolean = true,
    onClick: () -> Unit,
) {
    val palette = LocalPalette.current
    val tint = if (active) palette.onPrimary else palette.muted
    val interactions = remember { MutableInteractionSource() }
    Box(
        Modifier.size(48.dp).alpha(if (enabled) 1f else 0.38f).clip(CircleShape)
            .semantics { selected = active; stateDescription = mode }
            .clickable(interactionSource = interactions, indication = ripple(color = tint),
                enabled = enabled, role = Role.Button, onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        Box(
            Modifier.size(40.dp).clip(CircleShape)
                .then(if (active) Modifier.background(palette.primary) else Modifier),
            contentAlignment = Alignment.Center,
        ) {
            Icon(icon, label, tint = tint, modifier = Modifier.size(22.dp))
            if (active) Box(Modifier.align(Alignment.BottomCenter).padding(bottom = 3.dp)
                .size(4.dp).clip(CircleShape).background(tint))
        }
    }
}
