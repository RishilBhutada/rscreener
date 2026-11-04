package com.rishil.rscreener;

import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.MediaStore;
import android.util.Base64;

import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;

/**
 * Saves a file the site made - the CSV exports - for the app.
 *
 * Android's WebView ignores the blob-link download a browser would perform, so
 * the export buttons did nothing in the app. The site (web/src/lib/download.ts)
 * hands the file here instead, base64-encoded. Android 10 and later: written
 * straight into the phone's Downloads folder, no permission needed. Android 7
 * to 9 would need a storage permission for that, so there it goes to the share
 * sheet - Drive, Files, WhatsApp, email.
 *
 * Writes only the one file it is given: a cleaned-up name, text types, 20 MB.
 */
@CapacitorPlugin(name = "RsDownloads")
public class DownloadsPlugin extends Plugin {

    private static final int MAX_BYTES = 20 * 1024 * 1024;

    @PluginMethod
    public void save(PluginCall call) {
        String data = call.getString("data");
        String mime = call.getString("mime", "text/csv");
        String name = call.getString("name", "rscreener.csv").replaceAll("[^A-Za-z0-9._&-]", "_");
        if (name.length() > 80) name = name.substring(name.length() - 80);
        if (data == null || !mime.startsWith("text/")) {
            call.reject("nothing to save");
            return;
        }
        byte[] bytes;
        try {
            bytes = Base64.decode(data, Base64.DEFAULT);
        } catch (IllegalArgumentException e) {
            call.reject("not base64");
            return;
        }
        if (bytes.length > MAX_BYTES) {
            call.reject("too large");
            return;
        }
        try {
            JSObject ret = new JSObject();
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                ContentResolver resolver = getContext().getContentResolver();
                ContentValues values = new ContentValues();
                values.put(MediaStore.Downloads.DISPLAY_NAME, name);
                values.put(MediaStore.Downloads.MIME_TYPE, mime);
                values.put(MediaStore.Downloads.IS_PENDING, 1);
                Uri uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
                if (uri == null) throw new IllegalStateException("Downloads refused the file");
                try (OutputStream out = resolver.openOutputStream(uri)) {
                    if (out == null) throw new IllegalStateException("Downloads refused the file");
                    out.write(bytes);
                }
                values.clear();
                values.put(MediaStore.Downloads.IS_PENDING, 0);
                resolver.update(uri, values, null, null);
                ret.put("saved", "downloads");
            } else {
                File file = new File(getContext().getCacheDir(), name);
                try (FileOutputStream out = new FileOutputStream(file)) {
                    out.write(bytes);
                }
                Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", file);
                Intent send = new Intent(Intent.ACTION_SEND)
                        .setType(mime)
                        .putExtra(Intent.EXTRA_STREAM, uri)
                        .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                getActivity().startActivity(Intent.createChooser(send, name));
                ret.put("saved", "shared");
            }
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("could not save: " + e.getMessage());
        }
    }
}
