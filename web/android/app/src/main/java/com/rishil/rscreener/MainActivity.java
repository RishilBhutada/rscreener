package com.rishil.rscreener;

import android.os.Bundle;
import android.webkit.WebView;

import androidx.activity.OnBackPressedCallback;

import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Before super.onCreate: that is where the bridge is built and the
        // site loaded, and a plugin registered later is not offered to it.
        registerPlugin(DownloadsPlugin.class);
        super.onCreate(savedInstanceState);

        // Back = the previous page in the app, the way a browser does it.
        //
        // Capacitor has no Back handling of its own, and the WebView never
        // receives the Back key, so Android's default ran: leave the app.
        // This asks the WebView first. Its history holds every page visited
        // in the app, including the site's in-page moves (Next.js links), so
        // Back steps through them. Only on the first page, with nothing
        // behind it, does Back leave the app the normal Android way
        // (Android 12 and later: to the background, still open; older: closed).
        //
        // An OnBackPressedCallback, not onBackPressed(): this app targets
        // Android 16 (targetSdk 36), where onBackPressed() is no longer
        // called, while this callback always is.
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                Bridge capBridge = getBridge();
                WebView web = capBridge == null ? null : capBridge.getWebView();
                if (web != null && web.canGoBack()) {
                    web.goBack();
                    return;
                }
                // Nothing to go back to: step aside for this one press and
                // let Android do what it would have done without this callback.
                setEnabled(false);
                try {
                    getOnBackPressedDispatcher().onBackPressed();
                } finally {
                    setEnabled(true);
                }
            }
        });
    }
}
