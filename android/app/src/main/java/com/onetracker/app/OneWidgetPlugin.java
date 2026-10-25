package com.onetracker.app;

import android.appwidget.AppWidgetManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.SharedPreferences;
import android.os.Build;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Bridge the WebView uses to feed the home-screen widget. The app calls
 * OneWidget.update({ data }) with a JSON string {theme, items}; we persist it
 * where the widget's RemoteViewsFactory can read it, then refresh every live
 * widget instance so changes show up without waiting for the update period.
 */
@CapacitorPlugin(name = "OneWidget")
public class OneWidgetPlugin extends Plugin {
    @PluginMethod
    public void update(PluginCall call) {
        String data = call.getString("data", "{}");
        Context ctx = getContext();
        SharedPreferences prefs = ctx.getSharedPreferences(OneWidgetProvider.PREFS, Context.MODE_PRIVATE);
        prefs.edit().putString(OneWidgetProvider.KEY_DATA, data).apply();
        OneWidgetProvider.updateAll(ctx);
        call.resolve();
    }

    /** Hand the app the ✓ taps queued on the widget while it was closed. */
    @PluginMethod
    public void drain(PluginCall call) {
        String pending = OneWidgetProvider.drainPending(getContext());
        JSArray actions = new JSArray();
        if (!pending.isEmpty()) {
            for (String line : pending.split("\n")) {
                if (!line.isEmpty()) actions.put(line);
            }
        }
        JSObject ret = new JSObject();
        ret.put("actions", actions);
        call.resolve(ret);
    }

    /**
     * "Add to Home screen" from Settings: the launcher shows its own sheet with
     * the widget (Android 8+). pinned=false when it can't, so the app explains
     * the long-press way instead.
     */
    @PluginMethod
    public void requestPin(PluginCall call) {
        boolean pinned = false;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            Context ctx = getContext();
            AppWidgetManager mgr = AppWidgetManager.getInstance(ctx);
            if (mgr.isRequestPinAppWidgetSupported()) {
                pinned = mgr.requestPinAppWidget(new ComponentName(ctx, OneWidgetProvider.class), null, null);
            }
        }
        JSObject ret = new JSObject();
        ret.put("pinned", pinned);
        call.resolve(ret);
    }
}
