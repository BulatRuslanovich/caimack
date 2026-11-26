// SPDX-License-Identifier: AGPL-3.0-only

package app.caimack.ui

import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.lerp
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import app.caimack.R

@Composable
internal fun <T : Any> LoadCollection(
    key: String,
    load: suspend () -> T,
    onBack: () -> Unit,
    account: @Composable () -> Unit,
    content: @Composable (T) -> Unit,
) {
    val background = LocalPalette.current.background
    Load(key, load, error = { retry ->
        Column {
            CollectionToolbar(null, background, onBack, account)
            Failure(retry)
        }
    }, loading = {
        Column {
            CollectionToolbar(null, background, onBack, account)
            Loading()
        }
    }, staleContentModifier = Modifier.statusBarsPadding(), content = content)
}

@Composable
internal fun CollectionPage(
    kind: String,
    title: String,
    facts: List<String>,
    backdrop: String?,
    onBack: () -> Unit,
    account: @Composable () -> Unit,
    description: String? = null,
    selectionBar: @Composable () -> Unit = {},
    cover: @Composable (Modifier) -> Unit,
    actions: @Composable () -> Unit,
    content: LazyListScope.() -> Unit,
) {
    val palette = LocalPalette.current
    val toneEnabled = LocalToneEnabled.current
    val coverTone = rememberPlayerCoverTone(backdrop.takeIf { toneEnabled })
    val top by animateColorAsState(
        coverTone?.let { oklch(if (palette.dark) 0.38 else 0.89, it.chroma.coerceAtMost(0.105), it.hue) }
            ?: palette.raised,
        tween(400), label = "collection backdrop",
    )
    val listState = rememberLazyListState()
    val heroProgress by remember(listState) {
        derivedStateOf {
            if (listState.firstVisibleItemIndex > 0) 1f else {
                val hero = listState.layoutInfo.visibleItemsInfo.firstOrNull { it.index == 0 }
                val height = hero?.size?.coerceAtLeast(1) ?: 1
                (listState.firstVisibleItemScrollOffset.toFloat() / height).coerceIn(0f, 1f)
            }
        }
    }

    BoxWithConstraints(Modifier.fillMaxSize()) {
        val sideBySide = maxWidth >= 540.dp && maxHeight < 500.dp
        val coverSize = if (sideBySide) 156.dp else minOf(
            (maxWidth - 64.dp).coerceAtLeast(1.dp),
            (maxHeight * 0.39f).coerceAtLeast(148.dp),
            256.dp,
        )
        val artwork: @Composable () -> Unit = {
            cover(Modifier.size(coverSize).shadow(14.dp, Radius.tile))
        }
        val metadata: @Composable () -> Unit = {
            Column(Modifier.padding(horizontal = 20.dp), verticalArrangement = Arrangement.spacedBy(5.dp)) {
                Text(kind, style = Type.tiny.copy(fontWeight = FontWeight.SemiBold), color = palette.muted)
                Text(title, style = displayStyle(title), modifier = Modifier.semantics { heading() })
                Text(facts.joinToString(" · "), style = Type.small, color = palette.muted)
                description?.takeIf(String::isNotBlank)?.let { Text(it, style = Type.small, color = palette.muted) }
            }
        }

        Column(Modifier.fillMaxSize()) {
            val toolbarColor = lerp(top, lerp(palette.background, top, 0.3f), (heroProgress * 1.6f).coerceAtMost(1f))
            CollectionToolbar(title, toolbarColor, onBack, account, showTitle = heroProgress >= 0.66f)
            selectionBar()
            LazyColumn(Modifier.weight(1f), state = listState, contentPadding = playerContentPadding(bottom = 24.dp)) {
                item {
                    Column(
                        Modifier.fillMaxWidth()
                            .background(Brush.verticalGradient(0f to top, 0.48f to top, 1f to palette.background))
                            .padding(top = 6.dp, bottom = 4.dp),
                    ) {
                        if (sideBySide) {
                            Row(Modifier.padding(start = 20.dp), verticalAlignment = Alignment.CenterVertically) {
                                artwork()
                                Column(Modifier.weight(1f)) { metadata() }
                            }
                        } else {
                            Box(Modifier.fillMaxWidth().padding(bottom = 18.dp), contentAlignment = Alignment.Center) {
                                artwork()
                            }
                            metadata()
                        }
                        Box(Modifier.padding(top = 4.dp)) { actions() }
                    }
                }
                content()
            }
        }
    }
}

@Composable
private fun CollectionToolbar(
    title: String?,
    background: Color,
    onBack: () -> Unit,
    account: @Composable () -> Unit,
    showTitle: Boolean = title != null,
) {
    val palette = LocalPalette.current
    Row(
        Modifier.fillMaxWidth().background(background).statusBarsPadding()
            .heightIn(min = 52.dp).padding(horizontal = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        IconButton(onClick = onBack) {
            Icon(Lucide.ArrowLeft, stringResource(R.string.nav_back), tint = palette.foreground)
        }
        Box(Modifier.weight(1f).padding(horizontal = 8.dp)) {
            androidx.compose.animation.AnimatedVisibility(visible = showTitle, enter = fadeIn(), exit = fadeOut()) {
                Text(title.orEmpty(), style = Type.heading, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
        }
        account()
    }
}
