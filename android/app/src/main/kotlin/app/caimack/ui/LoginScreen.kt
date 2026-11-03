// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bulat Ruslanovich

package app.caimack.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.translate
import androidx.compose.ui.graphics.drawscope.scale
import androidx.compose.ui.graphics.vector.PathParser
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import app.caimack.R
import app.caimack.session.LoginFailure
import app.caimack.session.Session
import kotlinx.coroutines.launch

@Composable
fun LoginScreen(session: Session, lastAddress: String, expired: Boolean) {
    val palette = LocalPalette.current
    var address by rememberSaveable { mutableStateOf(lastAddress) }
    var username by rememberSaveable { mutableStateOf("") }
    var password by rememberSaveable { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var failure by remember { mutableStateOf<LoginFailure?>(null) }
    val scope = rememberCoroutineScope()

    val ready = !busy && address.isNotBlank() && username.isNotBlank() && password.isNotEmpty()
    val submit = {
        if (ready) {
            busy = true
            scope.launch {
                failure = session.login(address, username, password)
                busy = false
            }
        }
    }

    Box(
        modifier = Modifier.fillMaxSize().systemBarsPadding().imePadding().verticalScroll(rememberScrollState()).padding(24.dp),
        contentAlignment = Alignment.Center,
    ) {
        Column(
            modifier = Modifier.widthIn(max = 384.dp).fillMaxWidth().clip(Radius.panel).background(palette.card).padding(20.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            Column(
                modifier = Modifier.fillMaxWidth().padding(bottom = 8.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                BrandMark(palette.foreground, palette.primary, Modifier.size(72.dp))
                BrandWordmark(palette.foreground, Modifier.width(127.dp).height(24.dp))
            }

            Field(
                label = stringResource(R.string.auth_server),
                value = address,
                onValueChange = { address = it },
                keyboard = KeyboardOptions(keyboardType = KeyboardType.Uri, imeAction = ImeAction.Next),
            )
            Field(
                label = stringResource(R.string.auth_username),
                value = username,
                onValueChange = { username = it },
                keyboard = KeyboardOptions(imeAction = ImeAction.Next),
            )
            Field(
                label = stringResource(R.string.auth_password),
                value = password,
                onValueChange = { password = it },
                keyboard = KeyboardOptions(keyboardType = KeyboardType.Password, imeAction = ImeAction.Done),
                actions = KeyboardActions(onDone = { submit() }),
                hidden = true,
            )

            val message = when (val shown = failure) {
                LoginFailure.BadAddress -> stringResource(R.string.auth_bad_address)
                LoginFailure.Unreachable -> stringResource(R.string.auth_unreachable)
                is LoginFailure.Refused -> shown.reason ?: stringResource(R.string.auth_failed)
                null -> if (expired) stringResource(R.string.session_expired) else null
            }
            message?.let { Text(it, style = Type.small, color = palette.destructive) }

            Button(
                onClick = { submit() },
                enabled = ready,
                modifier = Modifier.fillMaxWidth().padding(top = 8.dp).height(40.dp),
                colors = ButtonDefaults.buttonColors(
                    disabledContainerColor = palette.action.copy(alpha = 0.5f),
                    disabledContentColor = palette.onAction,
                ),
            ) {
                Text(
                    stringResource(if (busy) R.string.auth_signing_in else R.string.auth_sign_in),
                    style = Type.small.copy(fontWeight = FontWeight.SemiBold),
                )
            }
        }
    }
}

@Composable
internal fun Field(
    label: String,
    value: String,
    onValueChange: (String) -> Unit,
    keyboard: KeyboardOptions,
    actions: KeyboardActions = KeyboardActions.Default,
    hidden: Boolean = false,
) {
    val palette = LocalPalette.current
    var revealed by rememberSaveable { mutableStateOf(false) }

    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Text(label, style = Type.small.copy(fontWeight = FontWeight.Medium), color = palette.muted)
        BasicTextField(
            value = value,
            onValueChange = onValueChange,
            singleLine = true,
            textStyle = Type.body.copy(color = palette.foreground),
            cursorBrush = SolidColor(palette.foreground),
            keyboardOptions = keyboard,
            keyboardActions = actions,
            visualTransformation = if (hidden && !revealed) PasswordVisualTransformation() else VisualTransformation.None,
            modifier = Modifier
                .fillMaxWidth()
                .height(40.dp)
                .clip(Radius.row)
                .background(palette.raised)
                .border(1.dp, palette.controlBorder, Radius.row)
                .padding(start = 12.dp, end = if (hidden) 0.dp else 12.dp),
            decorationBox = { field ->
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Box(Modifier.weight(1f), contentAlignment = Alignment.CenterStart) { field() }
                    if (hidden) {
                        val description = stringResource(if (revealed) R.string.auth_hide_password else R.string.auth_show_password)
                        Box(
                            contentAlignment = Alignment.Center,
                            modifier = Modifier
                                .size(40.dp)
                                .clickable(role = Role.Button, onClickLabel = description) { revealed = !revealed }
                                .semantics { contentDescription = description },
                        ) {
                            Icon(if (revealed) Lucide.EyeOff else Lucide.Eye, null, tint = palette.muted, modifier = Modifier.size(18.dp))
                        }
                    }
                }
            },
        )
    }
}

@Composable
fun BrandMark(ink: Color, brass: Color, modifier: Modifier = Modifier) {
    val letter = remember { PathParser().parsePathString("M 841,396 C 822,399 812,392 826,374 C 851,343 875,310 871,286 C 867,256 822,248 779,250 C 624,256 461,352 382,492 C 333,580 318,678 345,755 C 379,855 475,913 589,918 C 740,925 907,838 1025,735 C 1045,718 1054,730 1040,752 C 955,897 814,1006 658,1034 C 492,1065 344,1022 262,907 C 197,815 193,688 226,575 C 271,417 374,299 521,225 C 641,164 771,151 862,174 C 925,189 967,223 970,270 C 974,319 929,365 880,388 C 866,394 851,396 841,396 Z").toPath() }
    val grooves = remember { PathParser().parsePathString("M 394,661 C 406,512 502,384 702,327 M 470,627 C 485,535 552,456 669,415").toPath() }
    val label = remember { PathParser().parsePathString("M 782,636 A 90,90 0 1 1 602,636 A 90,90 0 1 1 782,636 Z M 713,636 A 21,21 0 1 0 671,636 A 21,21 0 1 0 713,636 Z").toPath().apply { fillType = androidx.compose.ui.graphics.PathFillType.EvenOdd } }

    Canvas(modifier) {
        scale(size.minDimension / 960f, pivot = Offset.Zero) {
            translate(-150f, -120f) {
                drawPath(letter, ink)
                drawPath(grooves, ink, style = Stroke(width = 19f, cap = StrokeCap.Round))
                drawPath(label, brass)
            }
        }
    }
}

@Composable
fun BrandWordmark(ink: Color, modifier: Modifier = Modifier) {
    val lettering = remember {
        PathParser().parsePathString("M47.63 7.88Q48.5 6.75 50 6.75Q51.5 6.75 51.63 7Q51.75 7.25 51.63 8Q51.5 8.75 50.75 9.5Q50 10.25 48.5 10.13Q47 10 46.88 9.5Q46.75 9 47.63 7.88ZM113.63 8.25Q114.5 6.75 115.63 6.75Q116.75 6.75 116.88 7.88Q117 9 115.13 12.88Q113.25 16.75 113.38 17.5Q113.5 18.25 113.88 18.25Q114.25 18.25 117 15.75Q119.75 13.25 121.13 13.25Q122.5 13.25 122.5 14Q122.5 14.75 118.88 17.63Q115.25 20.5 115.75 21.75Q116.25 23 117.25 24Q118.25 25 120 24.5Q121.75 24 125.63 20.38Q129.5 16.75 130.13 16.88Q130.75 17 130.63 17.63Q130.5 18.25 128.38 20.63Q126.25 23 124.63 24.38Q123 25.75 121.13 26.75Q119.25 27.75 117.38 27.63Q115.5 27.5 114.13 25.38Q112.75 23.25 111.75 23.63Q110.75 24 109.88 25.88Q109 27.75 107.75 27.5Q106.5 27.25 107.13 25.38Q107.75 23.5 103.88 25.63Q100 27.75 97.75 27.75Q95.5 27.75 94.75 27.13Q94 26.5 93.75 25.75Q93.5 25 90.88 25.5Q88.25 26 87.38 25Q86.5 24 83.5 25.88Q80.5 27.75 79.13 27.75Q77.75 27.75 77.13 26.38Q76.5 25 75.38 25.5Q74.25 26 73.38 26Q72.5 26 72 25.63Q71.5 25.25 71.25 22.5Q71 19.75 67.88 23.25Q64.75 26.75 63.63 26.75Q62.5 26.75 62.25 25.13Q62 23.5 62.5 21.5Q63 19.5 62.5 19.5Q62 19.5 58.5 23.63Q55 27.75 53.88 27.63Q52.75 27.5 52.63 25.88Q52.5 24.25 49.63 26Q46.75 27.75 45.13 27.75Q43.5 27.75 42.75 27.13Q42 26.5 41.75 25.13Q41.5 23.75 41.13 23.75Q40.75 23.75 38.63 24.88Q36.5 26 35.13 25.88Q33.75 25.75 33.38 25.13Q33 24.5 32.5 24.38Q32 24.25 29.38 26Q26.75 27.75 25.13 27.63Q23.5 27.5 23.25 25.88Q23 24.25 22.63 24.25Q22.25 24.25 18.13 26.38Q14 28.5 11.38 28.63Q8.75 28.75 7.25 27.63Q5.75 26.5 5.75 24.38Q5.75 22.25 6.75 20.13Q7.75 18 9 16.38Q10.25 14.75 12.75 12.63Q15.25 10.5 18.38 9.13Q21.5 7.75 23.63 7.75Q25.75 7.75 26.25 9.38Q26.75 11 25.13 12.88Q23.5 14.75 22.13 14.5Q20.75 14.25 21 13.25Q21.25 12.25 22.13 11.63Q23 11 22.5 10.63Q22 10.25 19.75 11.25Q17.5 12.25 15.25 14.13Q13 16 11.13 19.13Q9.25 22.25 9.25 23.63Q9.25 25 9.88 25.5Q10.5 26 11.5 26Q12.5 26 14.25 25.5Q16 25 19.63 23.13Q23.25 21.25 26.13 18.63Q29 16 30.75 15Q32.5 14 34.75 14.25Q37 14.5 37.25 15.63Q37.5 16.75 36.5 18.75Q35.5 20.75 35.88 22Q36.25 23.25 38.63 22.25Q41 21.25 41.75 20.5Q42.5 19.75 43.63 17.5Q44.75 15.25 46 15.13Q47.25 15 47.13 16.5Q47 18 46.13 19.88Q45.25 21.75 45.25 23.25Q45.25 24.75 46.13 24.88Q47 25 50.75 22.25Q54.5 19.5 54.63 18.63Q54.75 17.75 55.63 16.38Q56.5 15 57.75 15.25Q59 15.5 58.5 17.38Q58 19.25 57.63 19.5Q57.25 19.75 57.38 20.25Q57.5 20.75 60.13 18.38Q62.75 16 64.25 16Q65.75 16 66.13 16.75Q66.5 17.5 66.13 19.75Q65.75 22 68.5 19Q71.25 16 72.38 15.5Q73.5 15 74.25 15.63Q75 16.25 74.75 19.5Q74.5 22.75 75.13 22.88Q75.75 23 76.63 22.5Q77.5 22 78.38 20.75Q79.25 19.5 81.75 17.25Q84.25 15 85.38 14.5Q86.5 14 88.38 14Q90.25 14 90.75 14.75Q91.25 15.5 91.25 16.25Q91.25 17 90.38 18.5Q89.5 20 89.38 21Q89.25 22 89.38 22.5Q89.5 23 90.25 23.13Q91 23.25 92.13 22.75Q93.25 22.25 95.13 19.63Q97 17 99.5 15Q102 13 103.13 13.25Q104.25 13.5 104.63 15.13Q105 16.75 104.5 17.63Q104 18.5 103.25 18.5Q102.5 18.5 102 17.63Q101.5 16.75 101 16.88Q100.5 17 100.13 18.38Q99.75 19.75 98.25 21.5Q96.75 23.25 97 24Q97.25 24.75 98.38 24.88Q99.5 25 102.5 23.63Q105.5 22.25 107.63 20.5Q109.75 18.75 111.25 14.25Q112.75 9.75 113.63 8.25ZM33.63 16.88Q33.25 16.75 31.5 17.75Q29.75 18.75 28.38 20.38Q27 22 26.5 23Q26 24 26.38 24.5Q26.75 25 27.88 24.5Q29 24 30.75 22.38Q32.5 20.75 33.25 19.38Q34 18 34 17.5Q34 17 33.63 16.88ZM87.38 16.75Q87 16.75 85.5 17.63Q84 18.5 82.63 20Q81.25 21.5 80.63 22.63Q80 23.75 80 24.25Q80 24.75 80.38 24.88Q80.75 25 83.38 23Q86 21 86.88 19.63Q87.75 18.25 87.75 17.5Q87.75 16.75 87.38 16.75Z").toPath().apply {
            fillType = androidx.compose.ui.graphics.PathFillType.EvenOdd
        }
    }
    val label = stringResource(R.string.app_name)
    Canvas(modifier.semantics { contentDescription = label }) {
        scale(minOf(size.width / 127f, size.height / 24f), pivot = Offset.Zero) {
            translate(-4.75f, -5.75f) { drawPath(lettering, ink) }
        }
    }
}
