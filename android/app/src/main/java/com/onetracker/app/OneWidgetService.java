package com.onetracker.app;

import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
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
        private final String category;
        private final List<Item> items = new ArrayList<>();
        private OneWidgetProvider.ThemeColors th = new OneWidgetProvider.ThemeColors();

        // small cross-row bitmap cache so scrolling doesn't re-download posters
        private static final LruCache<String, Bitmap> POSTERS = new LruCache<>(40);

        Factory(Context ctx, Intent intent) {
            this.ctx = ctx;
            String cat = intent.getStringExtra(OneWidgetProvider.EXTRA_CATEGORY);
            this.category = cat == null ? "series" : cat;
        }

        @Override
        public void onCreate() {
        }

        @Override
        public void onDataSetChanged() {
            items.clear();
            SharedPreferences prefs = ctx.getSharedPreferences(OneWidgetProvider.PREFS, Context.MODE_PRIVATE);
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

        @Override
        public RemoteViews getViewAt(int position) {
            RemoteViews row = new RemoteViews(ctx.getPackageName(), R.layout.widget_row);
            if (position < 0 || position >= items.size()) return row;
            Item it = items.get(position);
            row.setInt(R.id.row_root, "setBackgroundColor", th.card);
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
            row.setOnClickFillInIntent(R.id.row_root, open);

            // ✓ button → queue a "mark" the app applies when it next runs
            if (it.mark != null && !it.mark.isEmpty()) {
                row.setViewVisibility(R.id.row_check, View.VISIBLE);
                row.setInt(R.id.row_check, "setColorFilter", th.accent);
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
