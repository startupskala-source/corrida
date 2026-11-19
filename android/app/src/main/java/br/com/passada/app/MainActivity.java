package br.com.passada.app;

import android.os.Bundle;

import androidx.activity.OnBackPressedCallback;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(TrackerPlugin.class);
        super.onCreate(savedInstanceState);

        // Voltar: fecha a tela de cima (resumo, números, aba Você); senão minimiza em vez de fechar.
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                if (getBridge() == null || getBridge().getWebView() == null) { moveTaskToBack(true); return; }
                getBridge().getWebView().evaluateJavascript(
                    "(window.passadaBack && window.passadaBack()) ? 'ok' : 'min'",
                    value -> { if (value == null || !value.contains("ok")) moveTaskToBack(true); });
            }
        });
    }
}
