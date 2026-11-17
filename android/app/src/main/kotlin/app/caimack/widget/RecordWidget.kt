// SPDX-License-Identifier: AGPL-3.0-only
package app.caimack.widget

import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.Context

/** A separate 2×2 provider; shares playback and appearance with the wide widget. */
class RecordWidget : AppWidgetProvider() {
    override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) = NowPlayingWidget.refresh(context)
}
