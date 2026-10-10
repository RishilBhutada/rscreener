package com.rishil.rscreener;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Before super.onCreate: that is where the bridge is built and the
        // site loaded, and a plugin registered later is not offered to it.
        registerPlugin(DownloadsPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
