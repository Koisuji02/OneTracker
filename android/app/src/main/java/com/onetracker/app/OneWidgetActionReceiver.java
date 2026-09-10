package com.onetracker.app;

import android.appwidget.AppWidgetManager;
import android.content.BroadcastReceiver;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;

/**
 * The widget's own taps (media filter, row open, ✓ mark) land HERE and not on
 * {@link OneWidgetProvider}.
 *
 * Why a second receiver: an AppWidgetProvider has to be exported so the
 * launcher can send it APPWIDGET_UPDATE — and an exported receiver accepts
 * explicit intents from ANY app on the device. Handling the tap actions there
 * meant any installed app could broadcast a "mark" payload and write into the
 * user's library, or force the app to the foreground on a route of its
 * choosing. This receiver is NOT exported, and it doesn't need to be: the
 * PendingIntents the widget hands the launcher are created by us and fire with
 * our own identity, so they reach a private component just fine — while an
 * outside broadcast is refused by the system before any code runs.
 */
public class OneWidgetActionReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context ctx, Intent intent) {
        String action = intent.getAction();
        if (OneWidgetProvider.ACTION_FILTER.equals(action)) {
            int id = intent.getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, -1);
            String cat = intent.getStringExtra(OneWidgetProvider.EXTRA_CATEGORY);
            if (id != -1 && cat != null) {
                ctx.getSharedPreferences(OneWidgetProvider.PREFS, Context.MODE_PRIVATE)
                        .edit().putString(OneWidgetProvider.KEY_FILTER + id, cat).apply();
                AppWidgetManager mgr = AppWidgetManager.getInstance(ctx);
                mgr.notifyAppWidgetViewDataChanged(id, R.id.widget_list);
                OneWidgetProvider.updateWidget(ctx, mgr, id);
            }
        } else if (OneWidgetProvider.ACTION_ITEM.equals(action)) {
            String type = intent.getStringExtra("t");
            if ("open".equals(type)) {
                String route = intent.getStringExtra("route");
                Intent a = new Intent(ctx, MainActivity.class);
                a.setAction(Intent.ACTION_VIEW);
                a.setData(Uri.parse("com.onetracker.app://open" + (route == null ? "" : route)));
                a.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                ctx.startActivity(a);
            } else if ("mark".equals(type)) {
                // queue the ✓ tap for the app AND advance the widget's own copy
                // so the row updates instantly; the app reconciles on next run
                String payload = intent.getStringExtra("payload");
                if (payload != null && !payload.isEmpty()) {
                    OneWidgetProvider.appendPending(ctx, payload);
                    int sep = payload.indexOf("##");
                    if (sep > 0) {
                        OneWidgetProvider.advanceOptimistic(
                                ctx, payload.substring(0, sep), payload.substring(sep + 2));
                    }
                    AppWidgetManager mgr = AppWidgetManager.getInstance(ctx);
                    int[] ids = mgr.getAppWidgetIds(new ComponentName(ctx, OneWidgetProvider.class));
                    for (int id : ids) mgr.notifyAppWidgetViewDataChanged(id, R.id.widget_list);
                }
            }
        }
    }
}
