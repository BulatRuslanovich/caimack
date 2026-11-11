// SPDX-License-Identifier: AGPL-3.0-only
package app.caimack.ui

import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.test.junit4.v2.createComposeRule
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test

class ToneInvalidationTest {
    @get:Rule val compose = createComposeRule()

    @Test fun animatedToneDoesNotRecomposeUnrelatedScreenContent() {
        val tone = mutableStateOf(Color.Red)
        val unrelatedCompositions = java.util.concurrent.atomic.AtomicInteger()
        var observed = Color.Unspecified
        val content: @Composable () -> Unit = {
            Unrelated { unrelatedCompositions.incrementAndGet() }
            ObserveTone { observed = it }
        }
        compose.setContent {
            CompositionLocalProvider(LocalNowPlayingTone provides tone.value, content = content)
        }
        compose.runOnIdle {
            assertEquals(1, unrelatedCompositions.get())
            tone.value = Color.Blue
        }
        compose.runOnIdle {
            assertEquals(Color.Blue, observed)
            assertEquals(1, unrelatedCompositions.get())
        }
    }
}

@Composable private fun Unrelated(onComposition: () -> Unit) {
    SideEffect(onComposition)
    Text("Screen content")
}

@Composable private fun ObserveTone(onTone: (Color) -> Unit) {
    val current = LocalNowPlayingTone.current
    SideEffect { onTone(current) }
}
