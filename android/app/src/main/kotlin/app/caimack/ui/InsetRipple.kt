// SPDX-License-Identifier: AGPL-3.0-only
package app.caimack.ui

import androidx.compose.foundation.indication
import androidx.compose.foundation.interaction.InteractionSource
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.PressInteraction
import androidx.compose.material3.ripple
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.isSpecified
import androidx.compose.ui.layout.LayoutCoordinates
import androidx.compose.ui.layout.onGloballyPositioned
import kotlinx.coroutines.flow.flow

/** Keeps the full touch target while drawing feedback only on its inset, clipped surface. */
internal class InsetRipple {
    val interactions = MutableInteractionSource()
    private var target: LayoutCoordinates? = null
    private var surface: LayoutCoordinates? = null

    private val mappedInteractions = object : InteractionSource {
        override val interactions = flow {
            val presses = mutableMapOf<PressInteraction.Press, PressInteraction.Press>()
            this@InsetRipple.interactions.interactions.collect { interaction ->
                emit(when (interaction) {
                    is PressInteraction.Press -> PressInteraction.Press(surfacePosition(interaction.pressPosition))
                        .also { presses[interaction] = it }
                    is PressInteraction.Release -> PressInteraction.Release(presses.remove(interaction.press) ?: interaction.press)
                    is PressInteraction.Cancel -> PressInteraction.Cancel(presses.remove(interaction.press) ?: interaction.press)
                    else -> interaction
                })
            }
        }
    }

    val targetModifier = Modifier.onGloballyPositioned { target = it }
    // Apply after the surface's clip/background and before its content padding.
    val indicationModifier = Modifier.onGloballyPositioned { surface = it }
        .indication(mappedInteractions, ripple())

    private fun surfacePosition(position: Offset): Offset {
        val target = target ?: return position
        val surface = surface ?: return position
        if (!position.isSpecified || !target.isAttached || !surface.isAttached) return position
        val local = surface.localPositionOf(target, position)
        // A press in the extra touch area should start at the nearest point of the surface.
        return Offset(local.x.coerceIn(0f, surface.size.width.toFloat()), local.y.coerceIn(0f, surface.size.height.toFloat()))
    }
}
