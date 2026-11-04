// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

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
    faint = Color(0xFF93958F),
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
    faint = Color(0xFF6A706B),
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
    popover = Color(0xFF191919),
    raised = Color(0xFF242424),
    accent = Color(0xFF333334),
    foreground = Color(0xFFF2EFE9),
    muted = Color(0xFFAAA6A0),
    faint = Color(0xFF97938C),
    primary = Color(0xFFEEEEEE),
    onPrimary = Color(0xFF000000),
    primarySoft = Color(0x24EEEEEE),
    action = Color(0xFFF2EFE9),
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
    background = Color(0xFFF2F0EB),
    card = Color(0xFFFBFAF7),
    popover = Color(0xFFFFFFFF),
    raised = Color(0xFFFFFFFF),
    accent = Color(0xFFE4E0D8),
    foreground = Color(0xFF191919),
    muted = Color(0xFF55524C),
    faint = Color(0xFF6A665F),
    primary = Color(0xFFC23E17),
    onPrimary = Color(0xFFFFFFFF),
    primarySoft = Color(0x1CC23E17),
    action = Color(0xFF191919),
    onAction = Color(0xFFFBFAF7),
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
    background = Color(0xFF0E121A),
    card = Color(0xFF161C27),
    popover = Color(0xFF1D2431),
    raised = Color(0xFF232B39),
    accent = Color(0xFF2B3445),
    foreground = Color(0xFFE9EDF5),
    muted = Color(0xFFA3ADC0),
    faint = Color(0xFF8892A6),
    primary = Color(0xFF79A7FF),
    onPrimary = Color(0xFF0E121A),
    primarySoft = Color(0x2479A7FF),
    action = Color(0xFFE9EDF5),
    onAction = Color(0xFF0E121A),
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
    background = Color(0xFFECEFF5),
    card = Color(0xFFF7F8FB),
    popover = Color(0xFFFFFFFF),
    raised = Color(0xFFFFFFFF),
    accent = Color(0xFFDBE1EB),
    foreground = Color(0xFF111827),
    muted = Color(0xFF475266),
    faint = Color(0xFF5C677D),
    primary = Color(0xFF285BC4),
    onPrimary = Color(0xFFFFFFFF),
    primarySoft = Color(0x1C285BC4),
    action = Color(0xFF111827),
    onAction = Color(0xFFF7F8FB),
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
    background = Color(0xFF161119),
    card = Color(0xFF201923),
    popover = Color(0xFF29212E),
    raised = Color(0xFF2F2635),
    accent = Color(0xFF382E3F),
    foreground = Color(0xFFF4EAEF),
    muted = Color(0xFFB9A9B6),
    faint = Color(0xFF9E8F9B),
    primary = Color(0xFFDF92FF),
    onPrimary = Color(0xFF1D0F12),
    primarySoft = Color(0x24DF92FF),
    action = Color(0xFFF4EAEF),
    onAction = Color(0xFF161119),
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
    background = Color(0xFFF5EEF0),
    card = Color(0xFFFCF8F9),
    popover = Color(0xFFFFFFFF),
    raised = Color(0xFFFFFFFF),
    accent = Color(0xFFEAD9DF),
    foreground = Color(0xFF24161F),
    muted = Color(0xFF5D4956),
    faint = Color(0xFF735F6C),
    primary = Color(0xFF8540AC),
    onPrimary = Color(0xFFFFFFFF),
    primarySoft = Color(0x1C8540AC),
    action = Color(0xFF24161F),
    onAction = Color(0xFFFCF8F9),
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
    background = Color(0xFF0F1311),
    card = Color(0xFF171C19),
    popover = Color(0xFF1E2521),
    raised = Color(0xFF242C27),
    accent = Color(0xFF2C352F),
    foreground = Color(0xFFE9F0EA),
    muted = Color(0xFFA3B0A6),
    faint = Color(0xFF88958B),
    primary = Color(0xFFC5EF5C),
    onPrimary = Color(0xFF0F1311),
    primarySoft = Color(0x24C5EF5C),
    action = Color(0xFFE9F0EA),
    onAction = Color(0xFF0F1311),
    destructive = Color(0xFFFF7A6B),
    warning = Color(0xFFF2C14E),
    success = Color(0xFFC5EF5C),
    sleeves = listOf(
        Color(0xFF3B2724), Color(0xFF2F3A24), Color(0xFF1F3436),
        Color(0xFF3B3622), Color(0xFF3A2C22), Color(0xFF2B2C40),
    ),
    dark = true,
)

private val StudioLight = Palette(
    background = Color(0xFFEDF1ED),
    card = Color(0xFFF8FAF8),
    popover = Color(0xFFFFFFFF),
    raised = Color(0xFFFFFFFF),
    accent = Color(0xFFDBE4DD),
    foreground = Color(0xFF121A15),
    muted = Color(0xFF4A594F),
    faint = Color(0xFF5E6E63),
    primary = Color(0xFF3C7A10),
    onPrimary = Color(0xFFFFFFFF),
    primarySoft = Color(0x1C3C7A10),
    action = Color(0xFF121A15),
    onAction = Color(0xFFF8FAF8),
    destructive = Color(0xFFB42318),
    warning = Color(0xFF875F00),
    success = Color(0xFF3C7A10),
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
        fontSize = 22.sp, lineHeight = 25.sp, letterSpacing = (-0.015).em,
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
    val micro = TextStyle(fontFamily = Onest, fontSize = 11.sp, lineHeight = 16.sp)
}

val LocalPalette = staticCompositionLocalOf { CoffeeDark }

@Composable
fun CaimackTheme(
    dark: Boolean = isSystemInDarkTheme(),
    colorway: Colorway = Colorway.Coffee,
    content: @Composable () -> Unit,
) {
    val palette = paletteOf(colorway, dark)

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
