// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bulat Ruslanovich

package app.caimack.ui

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathParser
import androidx.compose.ui.unit.dp

object Lucide {
    val ArrowLeft by lazy { icon(false, "m12 19-7-7 7-7", "M5 12h14") }
    val House by lazy { icon(false, "M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8", "M3 10a2 2 0 0 1 .709-1.528l7-6a2 2 0 0 1 2.582 0l7 6A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z") }
    val Search by lazy { icon(false, "m21 21-4.34-4.34", "M3 11a8 8 0 1 0 16 0a8 8 0 1 0 -16 0") }
    val AudioLines by lazy { icon(false, "M2 10v3", "M6 6v11", "M10 3v18", "M14 8v7", "M18 5v13", "M22 10v3") }
    val ListMusic by lazy { icon(false, "M16 5H3", "M11 12H3", "M11 19H3", "M21 16V5", "M15 16a3 3 0 1 0 6 0a3 3 0 1 0 -6 0") }
    val Heart by lazy { icon(false, "M2 9.5a5.5 5.5 0 0 1 9.591-3.676.56.56 0 0 0 .818 0A5.49 5.49 0 0 1 22 9.5c0 2.29-1.5 4-3 5.5l-5.492 5.313a2 2 0 0 1-3 .019L5 15c-1.5-1.5-3-3.2-3-5.5") }
    val HeartFilled by lazy { icon(true, "M2 9.5a5.5 5.5 0 0 1 9.591-3.676.56.56 0 0 0 .818 0A5.49 5.49 0 0 1 22 9.5c0 2.29-1.5 4-3 5.5l-5.492 5.313a2 2 0 0 1-3 .019L5 15c-1.5-1.5-3-3.2-3-5.5") }
    val CornerDownRight by lazy { icon(false, "m15 10 5 5-5 5", "M4 4v7a4 4 0 0 0 4 4h12") }
    val LibraryBig by lazy { icon(false, "M4 3h4a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z", "M7 3v18", "M20.4 18.9c.2.5-.1 1.1-.6 1.3l-1.9.7c-.5.2-1.1-.1-1.3-.6L11.1 5.1c-.2-.5.1-1.1.6-1.3l1.9-.7c.5-.2 1.1.1 1.3.6Z") }
    val Disc3 by lazy { icon(false, "M2 12a10 10 0 1 0 20 0a10 10 0 1 0 -20 0", "M6 12c0-1.7.7-3.2 1.8-4.2", "M10 12a2 2 0 1 0 4 0a2 2 0 1 0 -4 0", "M18 12c0 1.7-.7 3.2-1.8 4.2") }
    val UsersRound by lazy { icon(false, "M18 21a8 8 0 0 0-16 0", "M5 8a5 5 0 1 0 10 0a5 5 0 1 0 -10 0", "M22 20c0-3.37-2-6.5-4-8a5 5 0 0 0-.45-8.3") }
    val Tags by lazy { icon(false, "M13.172 2a2 2 0 0 1 1.414.586l6.71 6.71a2.4 2.4 0 0 1 0 3.408l-4.592 4.592a2.4 2.4 0 0 1-3.408 0l-6.71-6.71A2 2 0 0 1 6 9.172V3a1 1 0 0 1 1-1z", "M2 7v6.172a2 2 0 0 0 .586 1.414l6.71 6.71a2.4 2.4 0 0 0 3.191.193", "M10 6.5a0.5 0.5 0 1 0 1 0a0.5 0.5 0 1 0 -1 0") }
    val History by lazy { icon(false, "M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8", "M3 3v5h5", "M12 7v5l4 2") }
    val EllipsisVertical by lazy { icon(true, "M11 12a1 1 0 1 0 2 0a1 1 0 1 0 -2 0", "M11 5a1 1 0 1 0 2 0a1 1 0 1 0 -2 0", "M11 19a1 1 0 1 0 2 0a1 1 0 1 0 -2 0") }
    val Play by lazy { icon(true, "M5 5a2 2 0 0 1 3.008-1.728l11.997 6.998a2 2 0 0 1 .003 3.458l-12 7A2 2 0 0 1 5 19z") }
    val Pause by lazy { icon(true, "M15 3h3a1 1 0 0 1 1 1v16a1 1 0 0 1 -1 1h-3a1 1 0 0 1 -1 -1v-16a1 1 0 0 1 1 -1Z", "M6 3h3a1 1 0 0 1 1 1v16a1 1 0 0 1 -1 1h-3a1 1 0 0 1 -1 -1v-16a1 1 0 0 1 1 -1Z") }
    val Shuffle by lazy { icon(false, "m18 14 4 4-4 4", "m18 2 4 4-4 4", "M2 18h1.973a4 4 0 0 0 3.3-1.7l5.454-8.6a4 4 0 0 1 3.3-1.7H22", "M2 6h1.972a4 4 0 0 1 3.6 2.2", "M22 18h-6.041a4 4 0 0 1-3.3-1.8l-.359-.45") }
    val SkipBack by lazy { icon(true, "M17.971 4.285A2 2 0 0 1 21 6v12a2 2 0 0 1-3.029 1.715l-9.997-5.998a2 2 0 0 1-.003-3.432z", "M3 20V4") }
    val SkipForward by lazy { icon(true, "M21 4v16", "M6.029 4.285A2 2 0 0 0 3 6v12a2 2 0 0 0 3.029 1.715l9.997-5.998a2 2 0 0 0 .003-3.432z") }
    val Repeat by lazy { icon(false, "m17 2 4 4-4 4", "M3 11v-1a4 4 0 0 1 4-4h14", "m7 22-4-4 4-4", "M21 13v1a4 4 0 0 1-4 4H3") }
    val Repeat1 by lazy { icon(false, "m17 2 4 4-4 4", "M3 11v-1a4 4 0 0 1 4-4h14", "m7 22-4-4 4-4", "M21 13v1a4 4 0 0 1-4 4H3", "M11 10h1v4") }
    val ChevronRight by lazy { icon(false, "m9 18 6-6-6-6") }
    val ChevronDown by lazy { icon(false, "m6 9 6 6 6-6") }
    val Layers by lazy { icon(false, "m12 3 10 5-10 5L2 8z", "m2 12 10 5 10-5", "m2 16 10 5 10-5") }
    val ChevronUp by lazy { icon(false, "m18 15-6-6-6 6") }
    val MicVocal by lazy { icon(false, "m11 7.601-5.994 8.19a1 1 0 0 0 .1 1.298l.817.818a1 1 0 0 0 1.314.087L15.09 12", "M16.5 21.174C15.5 20.5 14.372 20 13 20c-2.058 0-3.928 2.356-6 2-2.072-.356-2.775-3.369-1.5-4.5", "M11 7a5 5 0 1 0 10 0a5 5 0 1 0 -10 0") }
    val ListVideo by lazy { icon(false, "M21 5H3", "M10 12H3", "M10 19H3", "M15 12.003a1 1 0 0 1 1.517-.859l4.997 2.997a1 1 0 0 1 0 1.718l-4.997 2.997a1 1 0 0 1-1.517-.86z") }
    val Radio by lazy { icon(false, "M16.247 7.761a6 6 0 0 1 0 8.478", "M19.075 4.933a10 10 0 0 1 0 14.134", "M4.925 19.067a10 10 0 0 1 0-14.134", "M7.753 16.239a6 6 0 0 1 0-8.478", "M10 12a2 2 0 1 0 4 0a2 2 0 1 0 -4 0") }
    val Settings by lazy { icon(false, "M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915", "M9 12a3 3 0 1 0 6 0a3 3 0 1 0 -6 0") }
    val LogOut by lazy { icon(false, "m16 17 5-5-5-5", "M21 12H9", "M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4") }
    val Plus by lazy { icon(false, "M5 12h14", "M12 5v14") }
    val Minus by lazy { icon(false, "M5 12h14") }
    val Check by lazy { icon(false, "M20 6 9 17l-5-5") }
    val Music by lazy { icon(false, "M9 18V5l12-2v13", "M3 18a3 3 0 1 0 6 0a3 3 0 1 0 -6 0", "M15 16a3 3 0 1 0 6 0a3 3 0 1 0 -6 0") }
    val TriangleAlert by lazy { icon(false, "m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3", "M12 9v4", "M12 17h.01") }
    val Download by lazy { icon(false, "M12 15V3", "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4", "m7 10 5 5 5-5") }
    val CircleCheck by lazy { icon(false, "M2 12a10 10 0 1 0 20 0a10 10 0 1 0 -20 0", "m9 12 2 2 4-4") }
    val MonitorSpeaker by lazy { icon(false, "M5.5 20H8", "M17 9h.01", "M14 4h6a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z", "M8 6H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h4", "M16 15a1 1 0 1 0 2 0a1 1 0 1 0 -2 0") }
    val Trash2 by lazy { icon(false, "M10 11v6", "M14 11v6", "M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6", "M3 6h18", "M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2") }
    val GripVertical by lazy { icon(true, "M8 5a1 1 0 1 0 2 0a1 1 0 1 0 -2 0", "M8 12a1 1 0 1 0 2 0a1 1 0 1 0 -2 0", "M8 19a1 1 0 1 0 2 0a1 1 0 1 0 -2 0", "M14 5a1 1 0 1 0 2 0a1 1 0 1 0 -2 0", "M14 12a1 1 0 1 0 2 0a1 1 0 1 0 -2 0", "M14 19a1 1 0 1 0 2 0a1 1 0 1 0 -2 0") }
    val X by lazy { icon(false, "M18 6 6 18", "m6 6 12 12") }
    val Eye by lazy { icon(false, "M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0", "M9 12a3 3 0 1 0 6 0a3 3 0 1 0 -6 0") }
    val EyeOff by lazy { icon(false, "M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49", "M14.084 14.158a3 3 0 0 1-4.242-4.242", "M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143", "m2 2 20 20") }
    val Dumbbell by lazy { icon(false, "M17.596 12.768a2 2 0 1 0 2.829-2.829l-1.768-1.767a2 2 0 0 0 2.828-2.829l-2.828-2.828a2 2 0 0 0-2.829 2.828l-1.767-1.768a2 2 0 1 0-2.829 2.829z", "m2.5 21.5 1.4-1.4", "m20.1 3.9 1.4-1.4", "M5.343 21.485a2 2 0 1 0 2.829-2.828l1.767 1.768a2 2 0 1 0 2.829-2.829l-6.364-6.364a2 2 0 1 0-2.829 2.829l1.768 1.767a2 2 0 0 0-2.828 2.829z", "m9.6 14.4 4.8-4.8") }
    val Car by lazy { icon(false, "M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.4 2.9A3.7 3.7 0 0 0 2 12v4c0 .6.4 1 1 1h2", "M5 17a2 2 0 1 0 4 0a2 2 0 1 0 -4 0", "M9 17h6", "M15 17a2 2 0 1 0 4 0a2 2 0 1 0 -4 0") }
    val PartyPopper by lazy { icon(false, "M5.8 11.3 2 22l10.7-3.79", "M4 3h.01", "M22 8h.01", "M15 2h.01", "M22 20h.01", "m22 2-2.24.75a2.9 2.9 0 0 0-1.96 3.12c.1.86-.57 1.63-1.45 1.63h-.38c-.86 0-1.6.6-1.76 1.44L14 10", "m22 13-.82-.33c-.86-.34-1.82.2-1.98 1.11c-.11.7-.72 1.22-1.43 1.22H17", "m11 2 .33.82c.34.86-.2 1.82-1.11 1.98C9.52 4.9 9 5.52 9 6.23V7", "M11 13c1.93 1.93 2.83 4.17 2 5-.83.83-3.07-.07-5-2-1.93-1.93-2.83-4.17-2-5 .83-.83 3.07.07 5 2Z") }
    val Target by lazy { icon(false, "M2 12a10 10 0 1 0 20 0a10 10 0 1 0 -20 0", "M6 12a6 6 0 1 0 12 0a6 6 0 1 0 -12 0", "M10 12a2 2 0 1 0 4 0a2 2 0 1 0 -4 0") }
    val Coffee by lazy { icon(false, "M10 2v2", "M14 2v2", "M16 8a1 1 0 0 1 1 1v8a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4V9a1 1 0 0 1 1-1h14a4 4 0 1 1 0 8h-1", "M6 2v2") }
    val Moon by lazy { icon(false, "M20.985 12.486a9 9 0 1 1-9.473-9.472c.405-.022.617.46.402.803a6 6 0 0 0 8.268 8.268c.344-.215.825-.004.803.401") }
    val Sun by lazy { icon(false, "M8 12a4 4 0 1 0 8 0a4 4 0 1 0 -8 0", "M12 2v2", "M12 20v2", "m4.93 4.93 1.41 1.41", "m17.66 17.66 1.41 1.41", "M2 12h2", "M20 12h2", "m6.34 17.66-1.41 1.41", "m19.07 4.93-1.41 1.41") }
    val Map by lazy { icon(false, "M14.106 5.553a2 2 0 0 0 1.788 0l3.659-1.83A1 1 0 0 1 21 4.619v12.764a1 1 0 0 1-.553.894l-4.553 2.277a2 2 0 0 1-1.788 0l-4.212-2.106a2 2 0 0 0-1.788 0l-3.659 1.83A1 1 0 0 1 3 19.381V6.618a1 1 0 0 1 .553-.894l4.553-2.277a2 2 0 0 1 1.788 0z", "M15 5.764v15", "M9 3.236v15") }
    val Scan by lazy { icon(false, "M3 7V5a2 2 0 0 1 2-2h2", "M17 3h2a2 2 0 0 1 2 2v2", "M21 17v2a2 2 0 0 1-2 2h-2", "M7 21H5a2 2 0 0 1-2-2v-2") }
    val Crosshair by lazy { icon(false, "M2 12a10 10 0 1 0 20 0a10 10 0 1 0 -20 0", "M22 12h-4", "M6 12H2", "M12 6V2", "M12 22v-4") }
    val Pencil by lazy { icon(false, "M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z", "m15 5 4 4") }
    val Image by lazy { icon(false, "M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z", "M7 9a2 2 0 1 0 4 0a2 2 0 1 0 -4 0", "m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21") }
    val Share2 by lazy { icon(false, "M15 5a3 3 0 1 0 6 0a3 3 0 1 0 -6 0", "M3 12a3 3 0 1 0 6 0a3 3 0 1 0 -6 0", "M15 19a3 3 0 1 0 6 0a3 3 0 1 0 -6 0", "m8.59 13.51 6.83 3.98", "m15.41 6.51-6.82 3.98") }
    val CloudRain by lazy { icon(false, "M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242", "M16 14v6", "M8 14v6", "M12 16v6") }

    private fun icon(filled: Boolean, vararg paths: String): ImageVector {
        val builder = ImageVector.Builder(defaultWidth = 20.dp, defaultHeight = 20.dp, viewportWidth = 24f, viewportHeight = 24f)
        for (path in paths) {
            builder.addPath(
                pathData = PathParser().parsePathString(path).toNodes(),
                fill = if (filled) SolidColor(Color.Black) else null,
                stroke = SolidColor(Color.Black),
                strokeLineWidth = 2.4f,
                strokeLineCap = StrokeCap.Round,
                strokeLineJoin = StrokeJoin.Round,
            )
        }
        return builder.build()
    }
}
