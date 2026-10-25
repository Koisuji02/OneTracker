package com.onetracker.app;

import android.content.ContentResolver;
import android.content.ContentValues;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.OutputStream;
import java.nio.charset.StandardCharsets;

/**
 * "Esporta backup (JSON)" on Android: the file goes to the phone's Download
 * folder, where a browser download would land. A WebView can't follow an
 * {@code <a download>} link, so the export used to go nowhere.
 *
 * Android 10+ writes through MediaStore.Downloads, no permission needed. Below
 * that it answers saved=false and the app hands the file to the share sheet.
 */
@CapacitorPlugin(name = "BackupFile")
public class BackupFilePlugin extends Plugin {
    @PluginMethod
    public void saveToDownloads(PluginCall call) {
        JSObject ret = new JSObject();
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
            ret.put("saved", false);
            call.resolve(ret);
            return;
        }
        String name = call.getString("name", "onetracker-backup.json");
        String data = call.getString("data", "");
        ContentResolver resolver = getContext().getContentResolver();
        ContentValues values = new ContentValues();
        values.put(MediaStore.Downloads.DISPLAY_NAME, name);
        values.put(MediaStore.Downloads.MIME_TYPE, "application/json");
        values.put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS);
        // hidden from other apps until it is fully written
        values.put(MediaStore.Downloads.IS_PENDING, 1);
        Uri uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
        if (uri == null) {
            call.reject("insert-failed");
            return;
        }
        try (OutputStream out = resolver.openOutputStream(uri)) {
            if (out == null) throw new java.io.IOException("no-stream");
            out.write(data.getBytes(StandardCharsets.UTF_8));
        } catch (Exception e) {
            resolver.delete(uri, null, null);
            call.reject("write-failed", e);
            return;
        }
        values.clear();
        values.put(MediaStore.Downloads.IS_PENDING, 0);
        resolver.update(uri, values, null, null);
        ret.put("saved", true);
        call.resolve(ret);
    }
}
