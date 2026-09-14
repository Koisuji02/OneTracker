package com.onetracker.app;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.res.ColorStateList;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.widget.RemoteViews;

import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Home-screen widget (phase 1): a resizable, themed "Continue" list mirroring
 * the app. Data + theme are pushed from the WebView through {@link OneWidgetPlugin}
 * into SharedPreferences; this provider renders it with RemoteViews.
 *
 * - 1 row tall  → a compact cycle button on the left (current media icon
 *                 between two accent triangles) rotates through the 4 media
 * - ≥2 rows     → a 4-icon media bar (Series/Movies/Books/Games) that filters
 *                 the list below; the list grows as the widget is stretched.
 * Tapping a row opens the app on that item (deep link handled in MainActivity).
 */
public class OneWidgetProvider extends AppWidgetProvider {
    public static final String PREFS = "onetracker_widget";
    public static final String KEY_DATA = "data";           // JSON {theme, items}
    public static final String KEY_FILTER = "filter_";      // + appWidgetId
    public static final String KEY_PENDING = "pending";     // \n-joined ✓ taps
    public static final String ACTION_FILTER = "com.onetracker.app.WIDGET_FILTER";
    public static final String ACTION_ITEM = "com.onetracker.app.WIDGET_ITEM";
    public static final String EXTRA_CATEGORY = "category";
    /** below this height (dp) the media bar collapses into the cycle button. */
    private static final int BAR_MIN_HEIGHT_DP = 110;
    /** tap order of the 1-row cycle button. */
    private static final String[] CYCLE = {"series", "movies", "books", "games"};

    private static int iconOf(String cat) {
        switch (cat) {
            case "movies": return R.drawable.ic_widget_film;
            case "books": return R.drawable.ic_widget_books;
            case "games": return R.drawable.ic_widget_games;
            default: return R.drawable.ic_widget_tv;
        }
    }

    private static String nextCategory(String cat) {
        for (int i = 0; i < CYCLE.length; i++) {
            if (CYCLE[i].equals(cat)) return CYCLE[(i + 1) % CYCLE.length];
        }
        return CYCLE[0];
    }

    @Override
    public void onUpdate(Context ctx, AppWidgetManager mgr, int[] ids) {
        for (int id : ids) updateWidget(ctx, mgr, id);
    }

    @Override
    public void onAppWidgetOptionsChanged(Context ctx, AppWidgetManager mgr, int id, Bundle newOptions) {
        updateWidget(ctx, mgr, id);
    }

    // NOTE: no custom action is handled here. This provider is exported (the
    // launcher must be able to send it APPWIDGET_UPDATE), and an exported
    // receiver accepts explicit intents from any app on the device — so the
    // widget's own taps live in the private OneWidgetActionReceiver instead.

    static synchronized void appendPending(Context ctx, String payload) {
        SharedPreferences p = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        String cur = p.getString(KEY_PENDING, "");
        p.edit().putString(KEY_PENDING, cur.isEmpty() ? payload : cur + "\n" + payload).apply();
    }

    /** Return all queued ✓ taps (\n-joined) and clear them. */
    static synchronized String drainPending(Context ctx) {
        SharedPreferences p = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        String cur = p.getString(KEY_PENDING, "");
        if (!cur.isEmpty()) p.edit().remove(KEY_PENDING).apply();
        return cur;
    }

    /**
     * Optimistic advance after a ✓ tap: shift the row to its next pre-computed
     * step (pushed by the app as "next": [{sub, mark}, …]) or drop it when the
     * queue is empty, and bump it to the top (most-recently-watched order, like
     * the app). Matching on route+mark makes stale taps — a second press before
     * the list re-renders — a no-op, so one tap advances exactly one unit. The
     * app's next data push overwrites all of this with the real state.
     */
    static synchronized void advanceOptimistic(Context ctx, String route, String mark) {
        if (route.isEmpty() || mark.isEmpty()) return;
        SharedPreferences p = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        String json = p.getString(KEY_DATA, null);
        if (json == null) return;
        try {
            JSONObject root = new JSONObject(json);
            JSONArray items = root.optJSONArray("items");
            if (items == null) return;
            int idx = -1;
            for (int i = 0; i < items.length(); i++) {
                JSONObject o = items.getJSONObject(i);
                if (route.equals(o.optString("route")) && mark.equals(o.optString("mark"))) {
                    idx = i;
                    break;
                }
            }
            if (idx < 0) return;
            JSONObject row = items.getJSONObject(idx);
            JSONArray next = row.optJSONArray("next");
            JSONArray out = new JSONArray();
            if (next != null && next.length() > 0) {
                JSONObject head = next.getJSONObject(0);
                row.put("sub", head.optString("sub"));
                row.put("mark", head.optString("mark"));
                JSONArray rest = new JSONArray();
                for (int i = 1; i < next.length(); i++) rest.put(next.getJSONObject(i));
                row.put("next", rest);
                out.put(row);
            }
            for (int i = 0; i < items.length(); i++) {
                if (i != idx) out.put(items.getJSONObject(i));
            }
            root.put("items", out);
            p.edit().putString(KEY_DATA, root.toString()).apply();
        } catch (Exception ignored) {
        }
    }

    /** Re-render every live widget instance (called after the app pushes data). */
    static void updateAll(Context ctx) {
        AppWidgetManager mgr = AppWidgetManager.getInstance(ctx);
        int[] ids = mgr.getAppWidgetIds(new ComponentName(ctx, OneWidgetProvider.class));
        for (int id : ids) updateWidget(ctx, mgr, id);
    }

    static void updateWidget(Context ctx, AppWidgetManager mgr, int id) {
        SharedPreferences prefs = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        ThemeColors th = ThemeColors.from(prefs.getString(KEY_DATA, null));

        RemoteViews rv = new RemoteViews(ctx.getPackageName(), R.layout.widget_root);
        // Theme the ROUNDED background instead of replacing it with a flat
        // colour: setBackgroundColor would drop the drawable and leave square
        // corners on launchers that don't clip widgets themselves (HyperOS).
        rv.setInt(R.id.widget_root, "setBackgroundResource", R.drawable.widget_bg);
        if (Build.VERSION.SDK_INT >= 31) {
            rv.setColorStateList(R.id.widget_root, "setBackgroundTintList",
                    ColorStateList.valueOf(th.surface));
        } else {
            // pre-12 launchers don't round widgets at all — a flat fill is fine
            rv.setInt(R.id.widget_root, "setBackgroundColor", th.surface);
        }

        Bundle opts = mgr.getAppWidgetOptions(id);
        int minH = opts.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT, 0);
        boolean showBar = minH == 0 || minH >= BAR_MIN_HEIGHT_DP;
        rv.setViewVisibility(R.id.widget_bar, showBar ? View.VISIBLE : View.GONE);
        rv.setViewVisibility(R.id.widget_cycle, showBar ? View.GONE : View.VISIBLE);

        String filter = prefs.getString(KEY_FILTER + id, "series");

        setupIcon(ctx, rv, id, R.id.icon_series, "series", filter, th);
        setupIcon(ctx, rv, id, R.id.icon_movies, "movies", filter, th);
        setupIcon(ctx, rv, id, R.id.icon_books, "books", filter, th);
        setupIcon(ctx, rv, id, R.id.icon_games, "games", filter, th);

        if (!showBar) {
            // compact cycle button: current media icon between two triangles;
            // one tap = switch the list to the next media in the rotation
            rv.setImageViewResource(R.id.cycle_icon, iconOf(filter));
            rv.setInt(R.id.cycle_icon, "setColorFilter", th.accent);
            rv.setInt(R.id.cycle_left, "setColorFilter", th.accent);
            rv.setInt(R.id.cycle_right, "setColorFilter", th.accent);
            Intent cyc = new Intent(ctx, OneWidgetActionReceiver.class);
            cyc.setAction(ACTION_FILTER);
            cyc.putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, id);
            cyc.putExtra(EXTRA_CATEGORY, nextCategory(filter));
            cyc.setData(Uri.parse("onetracker://cycle/" + id + "/" + filter));
            int cflags = PendingIntent.FLAG_UPDATE_CURRENT
                    | (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S ? PendingIntent.FLAG_IMMUTABLE : 0);
            rv.setOnClickPendingIntent(R.id.widget_cycle,
                    PendingIntent.getBroadcast(ctx, 0, cyc, cflags));
        }

        // Collection adapter. The data URI is per WIDGET only, deliberately
        // WITHOUT the selected media: setRemoteAdapter keeps the existing
        // adapter when the intent still filterEquals the old one, so tapping
        // Games no longer tears the ListView down and builds a new one — which
        // is what made the widget pop in and out on every switch. The category
        // is read from SharedPreferences by the factory instead, and
        // notifyAppWidgetViewDataChanged below rebinds the rows in place.
        Intent svc = new Intent(ctx, OneWidgetService.class);
        svc.putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, id);
        svc.setData(Uri.parse("onetracker://widget/" + id));
        rv.setRemoteAdapter(R.id.widget_list, svc);

        rv.setEmptyView(R.id.widget_list, R.id.widget_empty);
        rv.setTextColor(R.id.widget_empty, th.ink3);

        // One template dispatches BOTH the row tap (open) and the ✓ tap (mark);
        // each row fills in the "t"/route/payload extras. It must be MUTABLE
        // for the fill-in to work — which is safe because the component is
        // pinned to our own private receiver and a fill-in intent can never
        // change it.
        Intent dispatch = new Intent(ctx, OneWidgetActionReceiver.class).setAction(ACTION_ITEM);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT
                | (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S ? PendingIntent.FLAG_MUTABLE : 0);
        PendingIntent template = PendingIntent.getBroadcast(ctx, 1, dispatch, flags);
        rv.setPendingIntentTemplate(R.id.widget_list, template);

        mgr.updateAppWidget(id, rv);
        mgr.notifyAppWidgetViewDataChanged(id, R.id.widget_list);
    }

    private static void setupIcon(Context ctx, RemoteViews rv, int id, int viewId,
                                  String cat, String selected, ThemeColors th) {
        rv.setInt(viewId, "setColorFilter", cat.equals(selected) ? th.accent : th.ink3);
        Intent i = new Intent(ctx, OneWidgetActionReceiver.class);
        i.setAction(ACTION_FILTER);
        i.putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, id);
        i.putExtra(EXTRA_CATEGORY, cat);
        i.setData(Uri.parse("onetracker://filter/" + id + "/" + cat));
        int flags = PendingIntent.FLAG_UPDATE_CURRENT
                | (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S ? PendingIntent.FLAG_IMMUTABLE : 0);
        PendingIntent pi = PendingIntent.getBroadcast(ctx, 0, i, flags);
        rv.setOnClickPendingIntent(viewId, pi);
    }

    /** Theme colors mirrored from the app (dark preset as the safe fallback). */
    static class ThemeColors {
        int surface = Color.parseColor("#0b0b0e");
        int card = Color.parseColor("#17171c");
        int card2 = Color.parseColor("#1f1f26");
        int line = Color.parseColor("#2a2a33");
        int ink = Color.parseColor("#f4f4f5");
        int ink2 = Color.parseColor("#a1a1aa");
        int ink3 = Color.parseColor("#71717a");
        int accent = Color.parseColor("#ffd60a");

        static ThemeColors from(String json) {
            ThemeColors t = new ThemeColors();
            if (json == null) return t;
            try {
                JSONObject theme = new JSONObject(json).optJSONObject("theme");
                if (theme != null) {
                    t.surface = parse(theme.optString("surface"), t.surface);
                    t.card = parse(theme.optString("card"), t.card);
                    t.card2 = parse(theme.optString("card2"), t.card2);
                    t.line = parse(theme.optString("line"), t.line);
                    t.ink = parse(theme.optString("ink"), t.ink);
                    t.ink2 = parse(theme.optString("ink2"), t.ink2);
                    t.ink3 = parse(theme.optString("ink3"), t.ink3);
                    t.accent = parse(theme.optString("accent"), t.accent);
                }
            } catch (Exception ignored) {
            }
            return t;
        }

        private static int parse(String hex, int fallback) {
            try {
                return (hex != null && hex.startsWith("#")) ? Color.parseColor(hex) : fallback;
            } catch (Exception e) {
                return fallback;
            }
        }
    }
}
