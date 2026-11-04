// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

package app.caimack.ui

import android.graphics.Bitmap
import androidx.compose.animation.Crossfade
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.produceState
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.blur
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.draw.BlurredEdgeTreatment
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.ColorFilter
import androidx.compose.ui.graphics.ColorMatrix
import androidx.compose.ui.graphics.FilterQuality
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.ImageShader
import androidx.compose.ui.graphics.ShaderBrush
import androidx.compose.ui.graphics.TileMode
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.unit.dp
import coil3.SingletonImageLoader
import coil3.compose.LocalPlatformContext
import coil3.request.ImageRequest
import coil3.request.SuccessResult
import coil3.request.allowHardware
import coil3.toBitmap
import kotlin.random.Random

enum class BackdropMode { Stage, Header }

private const val BACKDROP_PX = 48

private val saturate = ColorFilter.colorMatrix(ColorMatrix().apply { setToSaturation(1.4f) })

@Composable
fun ArtBackdrop(
    url: String?,
    mode: BackdropMode,
    modifier: Modifier = Modifier,
    grainStrength: Float = 1f,
) {
    if (url == null) return
    val palette = LocalPalette.current
    val context = LocalPlatformContext.current

    val art by produceState<ImageBitmap?>(null, url) {
        val request = ImageRequest.Builder(context).data(url).size(BACKDROP_PX).allowHardware(false).build()
        val result = SingletonImageLoader.get(context).execute(request)
        (result as? SuccessResult)?.let { value = it.image.toBitmap().asImageBitmap() }
    }

    Box(modifier.clipToBounds()) {
        Crossfade(art, animationSpec = tween(600), label = "backdrop") { bitmap ->
            if (bitmap != null) {
                Image(
                    bitmap,
                    contentDescription = null,
                    contentScale = ContentScale.Crop,
                    filterQuality = FilterQuality.Low,
                    colorFilter = saturate,
                    modifier = Modifier
                        .fillMaxSize()
                        .graphicsLayer { scaleX = 1.2f; scaleY = 1.2f }
                        .blur(32.dp, BlurredEdgeTreatment.Rectangle),
                )
            }
        }

        Canvas(Modifier.fillMaxSize()) {
            val background = palette.background
            when (mode) {
                BackdropMode.Stage -> drawRect(
                    Brush.verticalGradient(
                        0f to background.copy(alpha = 0.58f),
                        0.6f to background.copy(alpha = 0.72f),
                        1f to background.copy(alpha = 0.9f),
                    ),
                )
                BackdropMode.Header -> {
                    drawRect(
                        Brush.linearGradient(
                            0f to background.copy(alpha = 0.2f),
                            0.5f to background.copy(alpha = 0.58f),
                            0.92f to background,
                            start = Offset.Zero,
                            end = Offset(size.width * 0.36f, size.height),
                        ),
                    )
                }
            }
            drawRect(ShaderBrush(ImageShader(grain, TileMode.Repeated, TileMode.Repeated)), alpha = (if (palette.dark) GRAIN_DARK else GRAIN_LIGHT) * grainStrength)
            if (mode == BackdropMode.Header) drawRect(Brush.verticalGradient(0.45f to background.copy(alpha = 0f), 1f to background))
        }
    }
}

private const val GRAIN_DARK = 0.4f
private const val GRAIN_LIGHT = 0.25f

private val grain: ImageBitmap by lazy {
    val edge = 128
    val random = Random(7)
    val pixels = IntArray(edge * edge) {
        val tone = if (random.nextBoolean()) 0xFFFFFF else 0x000000
        (random.nextInt(0, 20) shl 24) or tone
    }
    Bitmap.createBitmap(pixels, edge, edge, Bitmap.Config.ARGB_8888).asImageBitmap()
}
