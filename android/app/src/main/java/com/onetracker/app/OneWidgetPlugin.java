package com.onetracker.app;

import android.content.Context;
import android.content.SharedPreferences;

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
}
