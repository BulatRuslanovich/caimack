// SPDX-License-Identifier: AGPL-3.0-only
package app.caimack.ui

import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.runtime.key
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import app.caimack.api.MapPoint
import kotlin.math.min
import kotlin.math.roundToInt

@Composable
internal fun MapCoverTiles(points: List<MapPoint>, view: MapView, size: Size, currentId: String?, pickedId: String?, animate: Boolean) {
    val edge = with(LocalDensity.current) { 32.dp.toPx() }
    val visible = remember(points, view, size, edge, currentId, pickedId) {
        visibleMapCovers(points, view, size.width, size.height, edge, currentId, pickedId)
    }
    val media = LocalContainer.current.media
    val palette = LocalPalette.current
    val alpha = ((view.k - 4f) / 2f).coerceIn(0f, 1f)
    visible.forEach { point -> key(point.id) {
        val at = toScreen(Spot(point.x, point.y), view, min(size.width, size.height))
        val frame = if (point.id == currentId || point.id == pickedId)
            Modifier.border(2.dp, if (point.id == currentId) palette.primary else palette.foreground, Radius.cover)
        else Modifier
        Box(Modifier.offset { IntOffset((at.x - edge / 2).roundToInt(), (at.y - edge / 2).roundToInt()) }
            .size(32.dp).graphicsLayer { this.alpha = alpha }) {
            Cover(media.cover(point.albumId, point.id, point.hasCover, small = true), point.title,
                Modifier.size(32.dp).then(frame), fadeIn = animate)
        }
    } }
}
