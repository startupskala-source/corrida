# Correções da revisão independente (Android). Rodar da raiz do projeto.
B = 'android/app/src/main/java/br/com/passada/app/'

def edit(p, pairs):
    s = open(p, encoding='utf-8').read()
    for a, b in pairs:
        assert a in s, (p, a[:80])
        s = s.replace(a, b, 1)
    open(p, 'w', encoding='utf-8').write(s)

edit(B + 'TrackingService.java', [
    # aparelho sem provedor de GPS não pode derrubar o app
    ("""        lm.requestLocationUpdates(LocationManager.GPS_PROVIDER, 1000, 0, this, Looper.getMainLooper());
        if (gnssCb != null) lm.registerGnssStatusCallback(gnssCb, ui);
        gpsOn = true;""",
     """        try {
            lm.requestLocationUpdates(LocationManager.GPS_PROVIDER, 1000, 0, this, Looper.getMainLooper());
            if (gnssCb != null) lm.registerGnssStatusCallback(gnssCb, ui);
            gpsOn = true;
        } catch (IllegalArgumentException | SecurityException e) {
            why = "este aparelho não tem GPS disponível";
        }"""),
    # sinal perdido > 10 s: mede o trecho pela posição em vez de descartar
    ("""            if (pv < 0 || dtv <= 0 || dtv > 10) { why = "aguardando"; return; }
            if (vAvg < STOP_SPEED) { why = "parado"; return; }
            if (vAvg > MAX_SPEED) { why = "salto, descartada"; return; }
            step = vAvg * dtv;""",
     """            if (pv < 0 || dtv <= 0 || dtv > 10) {
                // voltou depois de um buraco no sinal: conta o trecho pela distância em linha reta
                double gap = haversine(lastFix.lat, lastFix.lon, p.lat, p.lon), gdt = (rt - lastFixRt) / 1000.0;
                if (gap < Math.max(MIN_STEP, acc) || (gdt > 0 && gap / gdt > MAX_SPEED)) { why = "aguardando"; return; }
                step = gap;
            } else {
                if (vAvg < STOP_SPEED) { why = "parado"; return; }
                if (vAvg > MAX_SPEED) { why = "salto, descartada"; return; }
                step = vAvg * dtv;
            }"""),
    # hora real do início
    ("    boolean segBreak = false, voice = true;", "    boolean segBreak = false, voice = true;\n    long startedAt = 0;              // System.currentTimeMillis() do início"),
    ("        voice = voiceOn;\n        state = \"running\"; runStartRt = SystemClock.elapsedRealtime();",
     "        voice = voiceOn;\n        startedAt = System.currentTimeMillis();\n        state = \"running\"; runStartRt = SystemClock.elapsedRealtime();"),
    # retomar só se estava pausado (o JS precisa saber se não deu)
    ("    synchronized void resume() {\n        if (!\"paused\".equals(state)) return;",
     "    synchronized boolean resume() {\n        if (!\"paused\".equals(state)) return false;"),
    ("        goForeground(); acquireWake(); startGps(); tickNotif();\n    }\n\n    synchronized JSONObject stop() {",
     "        goForeground(); acquireWake(); startGps(); tickNotif();\n        return true;\n    }\n\n    synchronized JSONObject stop() {\n        if (\"idle\".equals(state)) return null;"),
    ("            run.put(\"elapsed\", elapsedAccum);", "            run.put(\"elapsed\", elapsedAccum);\n            run.put(\"startedAt\", startedAt);"),
    # depois de encerrar, nada da corrida antiga fica para trás
    ("        snapshotFile().delete();\n        return run;",
     "        snapshotFile().delete();\n        points.clear(); splits.clear(); distance = 0; elapsedAccum = 0; lastFix = null;\n        return run;"),
    # snapshot leva a hora de início; corrida recuperada vira serviço em primeiro plano (não é morta em 1 min)
    ("            o.put(\"distance\", distance); o.put(\"elapsed\", nowElapsed());",
     "            o.put(\"distance\", distance); o.put(\"elapsed\", nowElapsed()); o.put(\"startedAt\", startedAt);"),
    ("            lastFix = points.isEmpty() ? null : points.get(points.size() - 1);\n            segBreak = true; state = \"paused\";\n            return true;",
     "            lastFix = points.isEmpty() ? null : points.get(points.size() - 1);\n            startedAt = o.optLong(\"startedAt\", o.optLong(\"savedAt\") - elapsedAccum);\n            segBreak = true; state = \"paused\";\n            goForeground(); updateNotif();\n            return true;"),
])

edit(B + 'TrackerPlugin.java', [
    ("        s.resume(); call.resolve();", "        if (!s.resume()) { call.reject(\"a corrida não estava pausada\"); return; }\n        call.resolve();"),
    ("        try { call.resolve(JSObject.fromJSONObject(s.stop())); } catch (Exception e) { call.reject(e.getMessage()); }",
     "        try {\n            JSONObject run = s.stop();\n            if (run == null) { call.reject(\"nenhuma corrida em andamento\"); return; }\n            call.resolve(JSObject.fromJSONObject(run));\n        } catch (Exception e) { call.reject(e.getMessage()); }"),
])

# Botão voltar: pergunta à tela; se ela não tratar, minimiza (o serviço segue gravando, nada se perde)
open(B + 'MainActivity.java', 'w', encoding='utf-8').write('''package br.com.passada.app;

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
''')
print('ok')
