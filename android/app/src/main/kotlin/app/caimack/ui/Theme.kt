// SPDX-License-Identifier: AGPL-3.0-only

package app.caimack.ui

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.lerp
import androidx.compose.ui.graphics.compositeOver
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontVariation
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import app.caimack.R

@Immutable
data class Palette(
    val background: Color,
    val card: Color,
    val popover: Color,
    val raised: Color,
    val accent: Color,
    val foreground: Color,
    val muted: Color,
    val faint: Color,
    val primary: Color,
    val onPrimary: Color,
    val primarySoft: Color,
    val action: Color,
    val onAction: Color,
    val destructive: Color,
    val warning: Color,
    val success: Color,
    val sleeves: List<Color>,
    val dark: Boolean,
) {
    val selection: Color get() = primarySoft.compositeOver(card)
    val cabinet: Color get() = lerp(card, raised, if (dark) 0.3f else 0.18f)
    val cabinetEdge: Color get() = foreground.copy(alpha = if (dark) 0.09f else 0.11f)
    val border = foreground.copy(alpha = 0.12f)
    val borderStrong = foreground.copy(alpha = 0.24f)
    val controlBorder = foreground.copy(alpha = if (dark) 0.40f else 0.55f)
}

enum class Colorway(val key: String) {
    Coffee("coffee"),
    Graphite("graphite"),
    Midnight("midnight"),
    Plum("plum"),
    Studio("studio"),
    Dodo("dodo"),
    Cover("cover");

    companion object {
        fun of(key: String?) = entries.firstOrNull { it.key == key } ?: Coffee
    }
}
private val CoffeeDark = Palette(
    background = Color(0xFF1D1916),
    card = Color(0xFF29221D),
    popover = Color(0xFF342A23),
    raised = Color(0xFF3C3027),
    accent = Color(0xFF493A30),
    foreground = Color(0xFFF7EFE4),
    muted = Color(0xFFC8B6A5),
    faint = Color(0xFFB9A898),
    primary = Color(0xFFE7BC78),
    onPrimary = Color(0xFF291D12),
    primarySoft = Color(0x1FE7BC78),
    action = Color(0xFFEBD8BB),
    onAction = Color(0xFF291D12),
    destructive = Color(0xFFFF9487),
    warning = Color(0xFFF3C268),
    success = Color(0xFFA6CB8C),
    sleeves = listOf(
        Color(0xFF543628), Color(0xFF494127), Color(0xFF364039),
        Color(0xFF5A4728), Color(0xFF583423), Color(0xFF443338),
    ),
    dark = true,
)

private val CoffeeLight = Palette(
    background = Color(0xFFF3E9DC),
    card = Color(0xFFFBF4E9),
    popover = Color(0xFFFFFAF2),
    raised = Color(0xFFFFF8ED),
    accent = Color(0xFFE9DAC8),
    foreground = Color(0xFF32261E),
    muted = Color(0xFF5E4C3D),
    faint = Color(0xFF6B5645),
    primary = Color(0xFF79501E),
    onPrimary = Color(0xFFFFFAF0),
    primarySoft = Color(0x1779501E),
    action = Color(0xFF4A403A),
    onAction = Color(0xFFFFF7EB),
    destructive = Color(0xFFA13026),
    warning = Color(0xFF775000),
    success = Color(0xFF416729),
    sleeves = listOf(
        Color(0xFFD9B7A1), Color(0xFFD5C5A0), Color(0xFFBBC5B3),
        Color(0xFFE0C994), Color(0xFFDFB496), Color(0xFFCBB5BA),
    ),
    dark = false,
)

private val GraphiteDark = Palette(
    background = Color(0xFF000000),
    card = Color(0xFF111111),
    popover = Color(0xFF1D1D1D),
    raised = Color(0xFF262626),
    accent = Color(0xFF343434),
    foreground = Color(0xFFF4F4F4),
    muted = Color(0xFFBBBBBB),
    faint = Color(0xFFA9A9A9),
    primary = Color(0xFFE0E0E0),
    onPrimary = Color(0xFF161616),
    primarySoft = Color(0x24E0E0E0),
    action = Color(0xFFF4F4F4),
    onAction = Color(0xFF161616),
    destructive = Color(0xFFFF8A9D),
    warning = Color(0xFFEEC264),
    success = Color(0xFF83CE9D),
    sleeves = listOf(
        Color(0xFF3D302C), Color(0xFF33372E), Color(0xFF28343D),
        Color(0xFF393428), Color(0xFF372D35), Color(0xFF2C2D3B),
    ),
    dark = true,
)

private val GraphiteLight = Palette(
    background = Color(0xFFEEEEEE),
    card = Color(0xFFF8F8F8),
    popover = Color(0xFFFFFFFF),
    raised = Color(0xFFFCFCFC),
    accent = Color(0xFFE0E0E0),
    foreground = Color(0xFF202020),
    muted = Color(0xFF505050),
    faint = Color(0xFF5C5C5C),
    primary = Color(0xFF383838),
    onPrimary = Color(0xFFFFFFFF),
    primarySoft = Color(0x1A383838),
    action = Color(0xFF202020),
    onAction = Color(0xFFFFFFFF),
    destructive = Color(0xFFA32640),
    warning = Color(0xFF755100),
    success = Color(0xFF24653F),
    sleeves = listOf(
        Color(0xFFE0D0C9), Color(0xFFD7DCCF), Color(0xFFCBD7DF),
        Color(0xFFE1D9C5), Color(0xFFDDCED7), Color(0xFFD1D3DF),
    ),
    dark = false,
)

private val MidnightDark = Palette(
    background = Color(0xFF151E2C),
    card = Color(0xFF202C3E),
    popover = Color(0xFF2A384C),
    raised = Color(0xFF304057),
    accent = Color(0xFF384B64),
    foreground = Color(0xFFEFF5FD),
    muted = Color(0xFFBDCBDB),
    faint = Color(0xFFB2C2D5),
    primary = Color(0xFFABC9F2),
    onPrimary = Color(0xFF17263C),
    primarySoft = Color(0x1FABC9F2),
    action = Color(0xFFD4E4F7),
    onAction = Color(0xFF17263C),
    destructive = Color(0xFFFFA5A5),
    warning = Color(0xFFF5CB78),
    success = Color(0xFF91D5B7),
    sleeves = listOf(
        Color(0xFF3D3049), Color(0xFF303C4D), Color(0xFF24445B),
        Color(0xFF494339), Color(0xFF334743), Color(0xFF343B5E),
    ),
    dark = true,
)

private val MidnightLight = Palette(
    background = Color(0xFFE8EFF8),
    card = Color(0xFFF3F7FD),
    popover = Color(0xFFFDFEFF),
    raised = Color(0xFFF9FCFF),
    accent = Color(0xFFD4E4F7),
    foreground = Color(0xFF192940),
    muted = Color(0xFF425772),
    faint = Color(0xFF4A5E79),
    primary = Color(0xFF355784),
    onPrimary = Color(0xFFFFFFFF),
    primarySoft = Color(0x1A355784),
    action = Color(0xFF283F61),
    onAction = Color(0xFFF4F8FF),
    destructive = Color(0xFFA12935),
    warning = Color(0xFF714E0B),
    success = Color(0xFF24664A),
    sleeves = listOf(
        Color(0xFFDED0E3), Color(0xFFD1D9E7), Color(0xFFB9D4EA),
        Color(0xFFE1D8C5), Color(0xFFC7DFDD), Color(0xFFC9D2EE),
    ),
    dark = false,
)

private val PlumDark = Palette(
    background = Color(0xFF241A2F),
    card = Color(0xFF30233C),
    popover = Color(0xFF392B48),
    raised = Color(0xFF423351),
    accent = Color(0xFF4E3C5F),
    foreground = Color(0xFFF4EBF8),
    muted = Color(0xFFCDBBD8),
    faint = Color(0xFFC1AFCA),
    primary = Color(0xFFCCB7E5),
    onPrimary = Color(0xFF2B1E3E),
    primarySoft = Color(0x1FCCB7E5),
    action = Color(0xFFE0CCF2),
    onAction = Color(0xFF2B1E3E),
    destructive = Color(0xFFFF9AB0),
    warning = Color(0xFFF4C779),
    success = Color(0xFF9BD3AD),
    sleeves = listOf(
        Color(0xFF5D2E46), Color(0xFF423B50), Color(0xFF37365A),
        Color(0xFF4E3B2F), Color(0xFF5C3C35), Color(0xFF493660),
    ),
    dark = true,
)

private val PlumLight = Palette(
    background = Color(0xFFF2E9F3),
    card = Color(0xFFFBF5FC),
    popover = Color(0xFFFFFBFF),
    raised = Color(0xFFFDF8FE),
    accent = Color(0xFFEADBEA),
    foreground = Color(0xFF30203A),
    muted = Color(0xFF5C4866),
    faint = Color(0xFF66516F),
    primary = Color(0xFF664485),
    onPrimary = Color(0xFFFFFFFF),
    primarySoft = Color(0x1A664485),
    action = Color(0xFF684279),
    onAction = Color(0xFFFFF7FF),
    destructive = Color(0xFFA22648),
    warning = Color(0xFF744E0E),
    success = Color(0xFF2D6540),
    sleeves = listOf(
        Color(0xFFEAC7D7), Color(0xFFDCD4E9), Color(0xFFD0CDEB),
        Color(0xFFEBD8BD), Color(0xFFEFCBBD), Color(0xFFDECBED),
    ),
    dark = false,
)

private val StudioDark = Palette(
    background = Color(0xFF172219),
    card = Color(0xFF212D22),
    popover = Color(0xFF29372A),
    raised = Color(0xFF303E30),
    accent = Color(0xFF3A4B3A),
    foreground = Color(0xFFF2F4E8),
    muted = Color(0xFFBDC9B7),
    faint = Color(0xFFB0BEA9),
    primary = Color(0xFFC4D589),
    onPrimary = Color(0xFF242D19),
    primarySoft = Color(0x1AC4D589),
    action = Color(0xFFDEE6C9),
    onAction = Color(0xFF222B18),
    destructive = Color(0xFFFF9C8A),
    warning = Color(0xFFF0C76D),
    success = Color(0xFF9BD2AE),
    sleeves = listOf(
        Color(0xFF473630), Color(0xFF3A492C), Color(0xFF284237),
        Color(0xFF4A4328), Color(0xFF4C3829), Color(0xFF363C47),
    ),
    dark = true,
)

private val StudioLight = Palette(
    background = Color(0xFFEBEEE3),
    card = Color(0xFFF5F7EE),
    popover = Color(0xFFFAFBF4),
    raised = Color(0xFFF9FAF1),
    accent = Color(0xFFDFE7D5),
    foreground = Color(0xFF253126),
    muted = Color(0xFF4B5A48),
    faint = Color(0xFF52614F),
    primary = Color(0xFF486026),
    onPrimary = Color(0xFFFFFFF7),
    primarySoft = Color(0x17486026),
    action = Color(0xFF2D4A2B),
    onAction = Color(0xFFF8FAEF),
    destructive = Color(0xFF992E25),
    warning = Color(0xFF704E00),
    success = Color(0xFF235D49),
    sleeves = listOf(
        Color(0xFFE4CFC5), Color(0xFFD4E0BD), Color(0xFFBFD8C8),
        Color(0xFFE2DCB9), Color(0xFFE4CDB9), Color(0xFFCFD7E0),
    ),
    dark = false,
)

private val DodoDark = Palette(
    background = Color(0xFF201813),
    card = Color(0xFF2D2119),
    popover = Color(0xFF382820),
    raised = Color(0xFF413028),
    accent = Color(0xFF503B2F),
    foreground = Color(0xFFFFF2E7),
    muted = Color(0xFFD9C1B0),
    faint = Color(0xFFC7AD9D),
    primary = Color(0xFFF4A261),
    onPrimary = Color(0xFF331B0C),
    primarySoft = Color(0x1AF4A261),
    action = Color(0xFFFF6900),
    onAction = Color(0xFF291508),
    destructive = Color(0xFFFF9B90),
    warning = Color(0xFFFAD079),
    success = Color(0xFF9AD2A8),
    sleeves = listOf(
        Color(0xFF633820), Color(0xFF574229), Color(0xFF464626),
        Color(0xFF59362F), Color(0xFF34443E), Color(0xFF49333B),
    ),
    dark = true,
)

private val DodoLight = Palette(
    background = Color(0xFFFFF0E2),
    card = Color(0xFFFFF8F0),
    popover = Color(0xFFFFFDF9),
    raised = Color(0xFFFFFAF4),
    accent = Color(0xFFFFE2C9),
    foreground = Color(0xFF341F15),
    muted = Color(0xFF654B3A),
    faint = Color(0xFF735643),
    primary = Color(0xFF923B07),
    onPrimary = Color(0xFFFFFAF6),
    primarySoft = Color(0x17923B07),
    action = Color(0xFFAA460C),
    onAction = Color(0xFFFFF7EB),
    destructive = Color(0xFFA32A26),
    warning = Color(0xFF754B00),
    success = Color(0xFF24674D),
    sleeves = listOf(
        Color(0xFFFFD2AC), Color(0xFFF3DCA4), Color(0xFFDFD9AD),
        Color(0xFFF5C4B9), Color(0xFFC9DDD2), Color(0xFFE8CCD6),
    ),
    dark = false,
)

fun paletteOf(colorway: Colorway, dark: Boolean): Palette = when (colorway) {
    Colorway.Coffee, Colorway.Cover -> if (dark) CoffeeDark else CoffeeLight
    Colorway.Graphite -> if (dark) GraphiteDark else GraphiteLight
    Colorway.Midnight -> if (dark) MidnightDark else MidnightLight
    Colorway.Plum -> if (dark) PlumDark else PlumLight
    Colorway.Studio -> if (dark) StudioDark else StudioLight
    Colorway.Dodo -> if (dark) DodoDark else DodoLight
}

/** The cover supplies the stage colour; library palette and light mode never tint its controls. */
val PlayerPalette = Palette(
    background = Color(0xFF171819), card = Color(0xFF232527), popover = Color(0xFF2D3032),
    raised = Color(0xFF343739), accent = Color(0xFF414547),
    foreground = Color(0xFFF5F5F5), muted = Color(0xFFD6D6D6), faint = Color(0xFFBCBCBC),
    primary = Color(0xFFF5F5F5), onPrimary = Color(0xFF171819),
    primarySoft = Color(0x24F5F5F5),
    action = Color(0xFFF5F5F5), onAction = Color(0xFF171819),
    destructive = Color(0xFFFF6680), warning = Color(0xFFF2C14E), success = Color(0xFF6FCF97),
    sleeves = listOf(Color(0xFF282828), Color(0xFF343434), Color(0xFF404040)),
    dark = true,
)

object Radius {
    val cover = RoundedCornerShape(2.dp)
    val tile = RoundedCornerShape(4.dp)
    val row = RoundedCornerShape(6.dp)
    val panel = RoundedCornerShape(8.dp)
    val hero = RoundedCornerShape(12.dp)
}

private fun onest(weight: Int) = Font(
    R.font.onest_variable,
    FontWeight(weight),
    variationSettings = FontVariation.Settings(FontVariation.weight(weight)),
)

val Onest = FontFamily(onest(400), onest(500), onest(600), onest(700))

val Unbounded = FontFamily(Font(R.font.unbounded_medium, FontWeight.Medium))

object Type {
    val display = TextStyle(
        fontFamily = Unbounded, fontWeight = FontWeight.Medium,
        fontSize = 30.sp, lineHeight = 32.sp, letterSpacing = (-0.02).em,
    )
    val title = TextStyle(
        fontFamily = Unbounded, fontWeight = FontWeight.Medium,
        fontSize = 24.sp, lineHeight = 32.sp, letterSpacing = (-0.015).em,
    )
    val section = TextStyle(
        fontFamily = Onest, fontWeight = FontWeight.SemiBold,
        fontSize = 18.sp, lineHeight = 23.sp, letterSpacing = (-0.01).em,
    )
    val heading = TextStyle(
        fontFamily = Onest, fontWeight = FontWeight.SemiBold,
        fontSize = 17.sp, lineHeight = 22.sp, letterSpacing = (-0.01).em,
    )
    val body = TextStyle(fontFamily = Onest, fontSize = 15.sp, lineHeight = 22.sp)
    val small = TextStyle(fontFamily = Onest, fontSize = 14.sp, lineHeight = 20.sp)
    val tiny = TextStyle(fontFamily = Onest, fontSize = 12.sp, lineHeight = 16.sp)
    val micro = TextStyle(fontFamily = Onest, fontSize = 12.sp, lineHeight = 16.sp)
}

val LocalPalette = compositionLocalOf { CoffeeDark }

@Composable
fun CaimackTheme(
    dark: Boolean = isSystemInDarkTheme(),
    colorway: Colorway = Colorway.Coffee,
    palette: Palette = paletteOf(colorway, dark),
    content: @Composable () -> Unit,
) {
    val base = if (dark) darkColorScheme() else lightColorScheme()
    val colors = base.copy(
        primary = palette.action,
        onPrimary = palette.onAction,
        secondary = palette.primary,
        onSecondary = palette.onPrimary,
        background = palette.background,
        onBackground = palette.foreground,
        surface = palette.background,
        onSurface = palette.foreground,
        surfaceVariant = palette.raised,
        onSurfaceVariant = palette.muted,
        surfaceContainer = palette.card,
        surfaceContainerHigh = palette.popover,
        surfaceContainerHighest = palette.raised,
        outline = palette.controlBorder,
        outlineVariant = palette.border,
        error = palette.destructive,
    )

    val typography = Typography(
        displaySmall = Type.display,
        headlineSmall = Type.title,
        titleMedium = Type.section,
        bodyLarge = Type.body,
        bodyMedium = Type.small,
        bodySmall = Type.tiny,
        labelLarge = Type.small.copy(fontWeight = FontWeight.Medium),
        labelMedium = Type.tiny.copy(fontWeight = FontWeight.Medium),
        labelSmall = Type.micro.copy(fontWeight = FontWeight.Medium),
    )

    CompositionLocalProvider(LocalPalette provides palette, LocalColorway provides colorway) {
        MaterialTheme(
            colorScheme = colors,
            typography = typography,
            shapes = Shapes(
                extraSmall = Radius.cover,
                small = Radius.row,
                medium = Radius.row,
                large = Radius.panel,
                extraLarge = Radius.panel,
            ),
            content = content,
        )
    }
}
