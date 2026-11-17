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
import androidx.compose.runtime.staticCompositionLocalOf
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
    Studio("studio");

    companion object {
        fun of(key: String?) = entries.firstOrNull { it.key == key } ?: Coffee
    }
}
private val CoffeeDark = Palette(
    background = Color(0xFF171819),
    card = Color(0xFF232527),
    popover = Color(0xFF2D3032),
    raised = Color(0xFF343739),
    accent = Color(0xFF414547),
    foreground = Color(0xFFF2EEE7),
    muted = Color(0xFFAAA9A4),
    faint = Color(0xFFA0A19B),
    primary = Color(0xFFD3B278),
    onPrimary = Color(0xFF201E1A),
    primarySoft = Color(0x1FD3B278),
    action = Color(0xFFEEE6D7),
    onAction = Color(0xFF201E1A),
    destructive = Color(0xFFF07A6A),
    warning = Color(0xFFE0A93A),
    success = Color(0xFF8FC27A),
    sleeves = listOf(
        Color(0xFF4C2A26), Color(0xFF403E28), Color(0xFF2E3B38),
        Color(0xFF574422), Color(0xFF583320), Color(0xFF402C36),
    ),
    dark = true,
)

private val CoffeeLight = Palette(
    background = Color(0xFFEEEFEC),
    card = Color(0xFFF8F8F5),
    popover = Color(0xFFFFFEFB),
    raised = Color(0xFFFFFEFB),
    accent = Color(0xFFE0E3DD),
    foreground = Color(0xFF252729),
    muted = Color(0xFF5B625E),
    faint = Color(0xFF646B65),
    primary = Color(0xFF7C5A24),
    onPrimary = Color(0xFFFFFAF0),
    primarySoft = Color(0x177C5A24),
    action = Color(0xFF292B2D),
    onAction = Color(0xFFF8F7F2),
    destructive = Color(0xFFAE362A),
    warning = Color(0xFF8A5D00),
    success = Color(0xFF3F7A2C),
    sleeves = listOf(
        Color(0xFFD4B7AD), Color(0xFFC9C4A6), Color(0xFFB7C4BB),
        Color(0xFFDCC592), Color(0xFFD9B194), Color(0xFFC8B1B9),
    ),
    dark = false,
)

private val GraphiteDark = Palette(
    background = Color(0xFF000000),
    card = Color(0xFF101010),
    popover = Color(0xFF202020),
    raised = Color(0xFF282828),
    accent = Color(0xFF363636),
    foreground = Color(0xFFF2F2F2),
    muted = Color(0xFFADADAD),
    faint = Color(0xFFA0A0A0),
    primary = Color(0xFFEEEEEE),
    onPrimary = Color(0xFF000000),
    primarySoft = Color(0x24EEEEEE),
    action = Color(0xFFF2F2F2),
    onAction = Color(0xFF000000),
    destructive = Color(0xFFFF6680),
    warning = Color(0xFFF2C14E),
    success = Color(0xFF6FCF97),
    sleeves = listOf(
        Color(0xFF3D2621), Color(0xFF2F3428), Color(0xFF23303A),
        Color(0xFF3B3322), Color(0xFF3A2A33), Color(0xFF2B2B38),
    ),
    dark = true,
)

private val GraphiteLight = Palette(
    background = Color(0xFFF1F1EF),
    card = Color(0xFFFAFAF9),
    popover = Color(0xFFFFFFFF),
    raised = Color(0xFFFFFFFF),
    accent = Color(0xFFE2E2DF),
    foreground = Color(0xFF191919),
    muted = Color(0xFF575754),
    faint = Color(0xFF656562),
    primary = Color(0xFF363636),
    onPrimary = Color(0xFFFFFFFF),
    primarySoft = Color(0x1A363636),
    action = Color(0xFF191919),
    onAction = Color(0xFFFAFAF9),
    destructive = Color(0xFFB0203A),
    warning = Color(0xFF875F00),
    success = Color(0xFF2B7546),
    sleeves = listOf(
        Color(0xFFE8CFC6), Color(0xFFD8DCCB), Color(0xFFCBD7DF),
        Color(0xFFE8DCC0), Color(0xFFE3CFD8), Color(0xFFD3D3E0),
    ),
    dark = false,
)

private val MidnightDark = Palette(
    background = Color(0xFF14171C),
    card = Color(0xFF22272E),
    popover = Color(0xFF2C323B),
    raised = Color(0xFF343C46),
    accent = Color(0xFF424C58),
    foreground = Color(0xFFEDF0F4),
    muted = Color(0xFFB0B5BD),
    faint = Color(0xFFA6ADB7),
    primary = Color(0xFF94B5ED),
    onPrimary = Color(0xFF171B22),
    primarySoft = Color(0x1F94B5ED),
    action = Color(0xFFEDF0F4),
    onAction = Color(0xFF171B22),
    destructive = Color(0xFFFF7B7B),
    warning = Color(0xFFF0C060),
    success = Color(0xFF7CCF9A),
    sleeves = listOf(
        Color(0xFF3A2530), Color(0xFF2C3526), Color(0xFF1F3340),
        Color(0xFF3C3423), Color(0xFF3D2B24), Color(0xFF2E2A45),
    ),
    dark = true,
)

private val MidnightLight = Palette(
    background = Color(0xFFEFF0F2),
    card = Color(0xFFFAFBFC),
    popover = Color(0xFFFFFFFF),
    raised = Color(0xFFFFFFFF),
    accent = Color(0xFFDFE3E8),
    foreground = Color(0xFF20242B),
    muted = Color(0xFF59616B),
    faint = Color(0xFF646D78),
    primary = Color(0xFF365F9E),
    onPrimary = Color(0xFFFFFFFF),
    primarySoft = Color(0x1A365F9E),
    action = Color(0xFF242A33),
    onAction = Color(0xFFFAFBFC),
    destructive = Color(0xFFB42318),
    warning = Color(0xFF8A5A00),
    success = Color(0xFF26734A),
    sleeves = listOf(
        Color(0xFFE3CBD3), Color(0xFFD3DCC8), Color(0xFFC6D8E3),
        Color(0xFFE5DBBF), Color(0xFFE5CDC3), Color(0xFFD4D0E8),
    ),
    dark = false,
)

private val PlumDark = Palette(
    background = Color(0xFF19171B),
    card = Color(0xFF28242A),
    popover = Color(0xFF332D35),
    raised = Color(0xFF3D3540),
    accent = Color(0xFF4C4350),
    foreground = Color(0xFFF3EDF0),
    muted = Color(0xFFB8B0B5),
    faint = Color(0xFFAFA5AC),
    primary = Color(0xFFC5A4D3),
    onPrimary = Color(0xFF261D2A),
    primarySoft = Color(0x1FC5A4D3),
    action = Color(0xFFF0D6C5),
    onAction = Color(0xFF291D18),
    destructive = Color(0xFFFF6B86),
    warning = Color(0xFFF3C35A),
    success = Color(0xFF8FD19E),
    sleeves = listOf(
        Color(0xFF45242F), Color(0xFF363626), Color(0xFF253442),
        Color(0xFF43361F), Color(0xFF452A27), Color(0xFF33284A),
    ),
    dark = true,
)

private val PlumLight = Palette(
    background = Color(0xFFF2EFF0),
    card = Color(0xFFFCFAFB),
    popover = Color(0xFFFFFFFF),
    raised = Color(0xFFFFFFFF),
    accent = Color(0xFFE4DDE1),
    foreground = Color(0xFF2B232A),
    muted = Color(0xFF655B63),
    faint = Color(0xFF756A72),
    primary = Color(0xFF775486),
    onPrimary = Color(0xFFFFFFFF),
    primarySoft = Color(0x1A775486),
    action = Color(0xFF8A4D31),
    onAction = Color(0xFFFFF7F0),
    destructive = Color(0xFFB0203A),
    warning = Color(0xFF875F00),
    success = Color(0xFF2B7546),
    sleeves = listOf(
        Color(0xFFECC9D2), Color(0xFFD9DCCB), Color(0xFFC9D6E3),
        Color(0xFFECDCBD), Color(0xFFEFCDC4), Color(0xFFD9CDEA),
    ),
    dark = false,
)

private val StudioDark = Palette(
    background = Color(0xFF151A17),
    card = Color(0xFF242B26),
    popover = Color(0xFF2D3730),
    raised = Color(0xFF354139),
    accent = Color(0xFF435147),
    foreground = Color(0xFFEDF1ED),
    muted = Color(0xFFAEB8B0),
    faint = Color(0xFFABB5AD),
    primary = Color(0xFFBBD589),
    onPrimary = Color(0xFF1C2614),
    primarySoft = Color(0x1ABBD589),
    action = Color(0xFFEDF1ED),
    onAction = Color(0xFF151A17),
    destructive = Color(0xFFFF7A6B),
    warning = Color(0xFFF2C14E),
    success = Color(0xFF82C6AE),
    sleeves = listOf(
        Color(0xFF3B2724), Color(0xFF2F3A24), Color(0xFF1F3436),
        Color(0xFF3B3622), Color(0xFF3A2C22), Color(0xFF2B2C40),
    ),
    dark = true,
)

private val StudioLight = Palette(
    background = Color(0xFFEFF2EF),
    card = Color(0xFFFAFCF9),
    popover = Color(0xFFFFFFFF),
    raised = Color(0xFFFFFFFF),
    accent = Color(0xFFDFE6DC),
    foreground = Color(0xFF202820),
    muted = Color(0xFF576357),
    faint = Color(0xFF657065),
    primary = Color(0xFF4E6D29),
    onPrimary = Color(0xFFFFFFFF),
    primarySoft = Color(0x174E6D29),
    action = Color(0xFF252E26),
    onAction = Color(0xFFFAFCF9),
    destructive = Color(0xFFB42318),
    warning = Color(0xFF875F00),
    success = Color(0xFF23745B),
    sleeves = listOf(
        Color(0xFFE5CDC6), Color(0xFFD4E0C6), Color(0xFFC4DADB),
        Color(0xFFE5DEC0), Color(0xFFE5D1C3), Color(0xFFD2D3E6),
    ),
    dark = false,
)

fun paletteOf(colorway: Colorway, dark: Boolean): Palette = when (colorway) {
    Colorway.Coffee -> if (dark) CoffeeDark else CoffeeLight
    Colorway.Graphite -> if (dark) GraphiteDark else GraphiteLight
    Colorway.Midnight -> if (dark) MidnightDark else MidnightLight
    Colorway.Plum -> if (dark) PlumDark else PlumLight
    Colorway.Studio -> if (dark) StudioDark else StudioLight
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

val LocalPalette = staticCompositionLocalOf { CoffeeDark }

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
