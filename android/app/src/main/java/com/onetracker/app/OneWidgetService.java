package com.onetracker.app;

import android.appwidget.AppWidgetManager;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.res.ColorStateList;
import android.os.Build;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.util.LruCache;
import android.view.View;
import android.widget.RemoteViews;
import android.widget.RemoteViewsService;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.ArrayList;
import java.util.List;

/** Feeds the widget's scrollable "Continue" list from the pushed JSON. */
public class OneWidgetService extends RemoteViewsService {
    @Override
    public RemoteViewsFactory onGetViewFactory(Intent intent) {
        return new Factory(getApplicationContext(), intent);
    }

    static class Factory implements RemoteViewsService.RemoteViewsFactory {
        private final Context ctx;
        private final int widgetId;
        /**
         * Selected media. NOT taken from the adapter intent: that intent is
         * fixed for the life of this factory, and keeping it fixed is exactly
         * what stops the ListView from being rebuilt (and the widget from
         * popping) when the user taps another medium. It is re-read from
         * SharedPreferences on every onDataSetChanged instead.
         */
        private String category = "series";
        private final List<Item> items = new ArrayList<>();
        private OneWidgetProvider.ThemeColors th = new OneWidgetProvider.ThemeColors();

        // small cross-row bitmap cache so scrolling doesn't re-download posters
        private static final LruCache<String, Bitmap> POSTERS = new LruCache<>(40);

        Factory(Context ctx, Intent intent) {
            this.ctx = ctx;
            this.widgetId = intent.getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID,
                    AppWidgetManager.INVALID_APPWIDGET_ID);
        }

        @Override
        public void onCreate() {
        }

        @Override
        public void onDataSetChanged() {
            items.clear();
            SharedPreferences prefs = ctx.getSharedPreferences(OneWidgetProvider.PREFS, Context.MODE_PRIVATE);
            category = prefs.getString(OneWidgetProvider.KEY_FILTER + widgetId, "series");
            String json = prefs.getString(OneWidgetProvider.KEY_DATA, null);
            th = OneWidgetProvider.ThemeColors.from(json);
            if (json == null) return;
            try {
                JSONArray arr = new JSONObject(json).optJSONArray("items");
                if (arr == null) return;
                for (int i = 0; i < arr.length(); i++) {
                    JSONObject o = arr.getJSONObject(i);
                    if (!category.equals(o.optString("category"))) continue;
                    Item it = new Item();
                    it.title = o.optString("title");
                    it.sub = o.optString("sub");
                    it.poster = o.optString("poster", null);
                    it.route = o.optString("route");
                    it.mark = o.isNull("mark") ? null : o.optString("mark", null);
                    items.add(it);
                }
            } catch (Exception ignored) {
            }
        }

        @Override
        public void onDestroy() {
            items.clear();
        }

        @Override
        public int getCount() {
            return items.size();
        }

        /**
         * Root view id this item's row is inflated with (Android 12+).
         *
         * A row view is only RECYCLED onto a new RemoteViews when both share the
         * layout AND the root id. With one stable id per item, a row that now
         * shows a DIFFERENT item (a ✓ bumped another title to the top) is
         * inflated fresh instead of patched in place: the launcher on HyperOS
         * patched the texts but kept the previous item's poster. The same item
         * in the same place still recycles, so a plain refresh doesn't flicker.
         */
        private static int rootIdOf(Item it) {
            String key = it.route == null ? "" : it.route;
            // a small positive range, clear of R.id (0x7f…) and android.R.id (0x01…)
            return 0x00100000 + (key.hashCode() & 0x000fffff);
        }

        @Override
        public RemoteViews getViewAt(int position) {
            if (position < 0 || position >= items.size()) {
                return new RemoteViews(ctx.getPackageName(), R.layout.widget_row);
            }
            Item it = items.get(position);
            final int rootId;
            final RemoteViews row;
            if (Build.VERSION.SDK_INT >= 31) {
                rootId = rootIdOf(it);
                row = new RemoteViews(ctx.getPackageName(), R.layout.widget_row, rootId);
            } else {
                rootId = R.id.row_root;
                row = new RemoteViews(ctx.getPackageName(), R.layout.widget_row);
            }
            // rounded, bordered row: `line` frame around a `card2` card (see
            // widget_row.xml). Tinting keeps the corners; pre-12 has no
            // setColorStateList, so there it degrades to flat square fills.
            row.setInt(rootId, "setBackgroundResource", R.drawable.widget_row_border);
            row.setInt(R.id.row_card, "setBackgroundResource", R.drawable.widget_row_bg);
            if (Build.VERSION.SDK_INT >= 31) {
                row.setColorStateList(rootId, "setBackgroundTintList",
                        ColorStateList.valueOf(th.line));
                row.setColorStateList(R.id.row_card, "setBackgroundTintList",
                        ColorStateList.valueOf(th.card2));
            } else {
                row.setInt(rootId, "setBackgroundColor", th.line);
                row.setInt(R.id.row_card, "setBackgroundColor", th.card2);
            }
            row.setTextViewText(R.id.row_title, it.title);
            row.setTextColor(R.id.row_title, th.ink);
            row.setTextViewText(R.id.row_sub, it.sub);
            row.setTextColor(R.id.row_sub, th.ink3);

            Bitmap bmp = loadPoster(it.poster);
            if (bmp != null) row.setImageViewBitmap(R.id.row_poster, bmp);
            else row.setImageViewResource(R.id.row_poster, R.drawable.widget_poster_placeholder);

            // tap the row → open the app on that item (dispatched by the provider)
            Intent open = new Intent();
            open.putExtra("t", "open");
            open.putExtra("route", it.route == null ? "" : it.route);
            row.setOnClickFillInIntent(rootId, open);

            // ✓ button → queue a "mark" the app applies when it next runs
            if (it.mark != null && !it.mark.isEmpty()) {
                row.setViewVisibility(R.id.row_check, View.VISIBLE);
                // grey, not accent: an accent-filled tick looks like the unit
                // is already watched. ink2 matches the app's unchecked button.
                row.setInt(R.id.row_check, "setColorFilter", th.ink2);
                Intent mark = new Intent();
                mark.putExtra("t", "mark");
                mark.putExtra("payload", it.route + "##" + it.mark);
                row.setOnClickFillInIntent(R.id.row_check, mark);
            } else {
                row.setViewVisibility(R.id.row_check, View.GONE);
            }
            return row;
        }

        @Override
        public RemoteViews getLoadingView() {
            return null;
        }

        @Override
        public int getViewTypeCount() {
            return 1;
        }

        @Override
        public long getItemId(int position) {
            return position;
        }

        @Override
        public boolean hasStableIds() {
            return false;
        }

        private Bitmap loadPoster(String url) {
            if (url == null || url.isEmpty()) return null;
            Bitmap cached = POSTERS.get(url);
            if (cached != null) return cached;
            HttpURLConnection conn = null;
            try {
                conn = (HttpURLConnection) new URL(url).openConnection();
                conn.setConnectTimeout(4000);
                conn.setReadTimeout(4000);
                conn.setInstanceFollowRedirects(true);
                InputStream in = conn.getInputStream();
                BitmapFactory.Options opts = new BitmapFactory.Options();
                opts.inSampleSize = 2; // posters render small in the row
                Bitmap bmp = BitmapFactory.decodeStream(in, null, opts);
                in.close();
                if (bmp != null) POSTERS.put(url, bmp);
                return bmp;
            } catch (Exception e) {
                return null;
            } finally {
                if (conn != null) conn.disconnect();
            }
        }
    }

    static class Item {
        String title;
        String sub;
        String poster;
        String route;
        String mark;
    }
}
