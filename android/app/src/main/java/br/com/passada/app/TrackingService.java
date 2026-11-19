package br.com.passada.app;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ServiceInfo;
import android.location.GnssStatus;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.media.AudioAttributes;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import android.os.SystemClock;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.speech.tts.TextToSpeech;

import androidx.core.app.NotificationCompat;
import androidx.core.content.ContextCompat;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/**
 * Motor de rastreamento nativo. Roda como serviço em primeiro plano (notificação fixa) para continuar
 * gravando com a tela apagada. Lê o GPS do chip (GPS_PROVIDER) a cada 1 s e calcula tudo aqui:
 * a tela web só lê o estado (getState) e desenha.
 *
 * Distância: integra a velocidade Doppler do chip (não soma o "tremido" da posição); quando o chip
 * não informa velocidade, usa a posição suavizada por filtro de Kalman com limiar de ruído.
 */
public class TrackingService extends Service implements LocationListener {

    // ---- Parâmetros (iguais aos da versão web, testados com GPS simulado) ----
    static final float MAX_ACCURACY = 65f;     // m
    static final float MAX_ACC_SPEED = 40f;    // m — só confia na velocidade com precisão até isso
    static final double MIN_STEP = 2.0;        // m
    static final double MAX_SPEED = 12.0;      // m/s
    static final double STOP_SPEED = 0.5;      // m/s
    static final double KF_Q = 3.0;            // m/s

    static final String CH_ID = "corrida";
    static final int NOTIF_ID = 42;

    static TrackingService instance;

    public static class Pt {
        double lat, lon, d; long t; boolean brk;
        Pt(double lat, double lon, long t, double d, boolean brk) { this.lat = lat; this.lon = lon; this.t = t; this.d = d; this.brk = brk; }
    }
    public static class Split {
        int km; long ms; Double lat, lon;
        Split(int km, long ms, Double lat, Double lon) { this.km = km; this.ms = ms; this.lat = lat; this.lon = lon; }
    }

    // ---- Estado ----
    String state = "idle";               // idle | running | paused
    final List<Pt> points = new ArrayList<>();
    final List<Split> splits = new ArrayList<>();
    double distance = 0;
    long elapsedAccum = 0;               // ms acumulados até a última pausa
    long runStartRt = 0;                 // SystemClock.elapsedRealtime() do início/retomada
    long lastSplitMs = 0; double lastSplitDist = 0;
    boolean segBreak = false, voice = true;

    // filtro / medição
    double kLat, kLon, kVar = -1; long kTs;
    Pt lastFix; long lastFixRt;
    double prevV = -1; long prevVRt;
    final ArrayDeque<double[]> speeds = new ArrayDeque<>();   // {rtMs, v}

    // diagnóstico
    int recv = 0, used = 0, sats = 0, satsTotal = 0; float lastAcc = -1; String why = "";
    double posLat, posLon; long posRt; boolean hasPos = false;

    LocationManager lm;
    PowerManager.WakeLock wakeLock;
    TextToSpeech tts; boolean ttsOk = false;
    final Handler ui = new Handler(Looper.getMainLooper());
    boolean gpsOn = false;
    long lastSave = 0;

    GnssStatus.Callback gnssCb;

    // ================= ciclo de vida =================
    @Override public void onCreate() {
        super.onCreate();
        instance = this;
        lm = (LocationManager) getSystemService(Context.LOCATION_SERVICE);
        createChannel();
        tts = new TextToSpeech(this, s -> {
            if (s == TextToSpeech.SUCCESS) {
                tts.setLanguage(new Locale("pt", "BR"));
                tts.setAudioAttributes(new AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_ASSISTANCE_NAVIGATION_GUIDANCE)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build());
                ttsOk = true;
            }
        });
        if (Build.VERSION.SDK_INT >= 24) {
            gnssCb = new GnssStatus.Callback() {
                @Override public void onSatelliteStatusChanged(GnssStatus st) {
                    int u = 0; for (int i = 0; i < st.getSatelliteCount(); i++) if (st.usedInFix(i)) u++;
                    sats = u; satsTotal = st.getSatelliteCount();
                }
            };
        }
    }

    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        startGps();
        return START_STICKY;
    }

    @Override public IBinder onBind(Intent intent) { return null; }

    @Override public void onDestroy() {
        stopGps();
        ui.removeCallbacksAndMessages(null);
        releaseWake();
        if (tts != null) tts.shutdown();
        instance = null;
        super.onDestroy();
    }

    // ================= GPS =================
    @SuppressLint("MissingPermission")
    void startGps() {
        if (gpsOn) return;
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
            why = "sem permissão de localização"; return;
        }
        lm.requestLocationUpdates(LocationManager.GPS_PROVIDER, 1000, 0, this, Looper.getMainLooper());
        if (gnssCb != null) lm.registerGnssStatusCallback(gnssCb, ui);
        gpsOn = true;
    }

    void stopGps() {
        if (!gpsOn) return;
        lm.removeUpdates(this);
        if (gnssCb != null) lm.unregisterGnssStatusCallback(gnssCb);
        gpsOn = false;
    }

    long nowElapsed() {
        return "running".equals(state) ? elapsedAccum + (SystemClock.elapsedRealtime() - runStartRt) : elapsedAccum;
    }

    @Override public synchronized void onLocationChanged(Location loc) {
        float acc = loc.hasAccuracy() ? loc.getAccuracy() : 999f;
        long rt = loc.getElapsedRealtimeNanos() / 1_000_000L;
        lastAcc = acc;
        posLat = loc.getLatitude(); posLon = loc.getLongitude(); posRt = rt; hasPos = true;
        if (!"running".equals(state)) return;
        recv++;

        if (acc > MAX_ACCURACY) { why = "sinal fraco, ignorada"; return; }

        boolean speedOk = loc.hasSpeed() && acc <= MAX_ACC_SPEED;
        if (speedOk && Build.VERSION.SDK_INT >= 26 && loc.hasSpeedAccuracy() && loc.getSpeedAccuracyMetersPerSecond() > 1.5f) speedOk = false;
        double v = speedOk ? loc.getSpeed() : -1;
        if (speedOk) {
            speeds.addLast(new double[]{rt, v});
            while (!speeds.isEmpty() && rt - speeds.peekFirst()[0] > 10000) speeds.pollFirst();
        }

        if (segBreak) { kVar = -1; prevV = -1; }
        kalman(loc.getLatitude(), loc.getLongitude(), acc, rt);
        // instante (tempo de corrida) da leitura, pelo relógio do próprio fix
        long t = elapsedAccum + Math.max(0, rt - runStartRt);
        Pt p = new Pt(kLat, kLon, t, distance, false);

        if (lastFix == null || segBreak) {
            p.brk = segBreak && lastFix != null; segBreak = false;
            if (speedOk) { prevV = v; prevVRt = rt; }
            lastFix = p; lastFixRt = rt; points.add(p); used++; why = "início"; return;
        }

        double step;
        if (speedOk) {
            double pv = prevV; long pvRt = prevVRt;
            prevV = v; prevVRt = rt;
            double dtv = pv >= 0 ? (rt - pvRt) / 1000.0 : 0;
            double vAvg = pv >= 0 ? (v + pv) / 2 : v;
            if (pv < 0 || dtv <= 0 || dtv > 10) { why = "aguardando"; return; }
            if (vAvg < STOP_SPEED) { why = "parado"; return; }
            if (vAvg > MAX_SPEED) { why = "salto, ignorada"; return; }
            step = vAvg * dtv;
        } else {
            prevV = -1;
            step = haversine(lastFix.lat, lastFix.lon, p.lat, p.lon);
            double dt = (rt - lastFixRt) / 1000.0;
            if (step < Math.max(MIN_STEP, acc)) { why = "parado"; return; }
            if (dt > 0 && step / dt > MAX_SPEED) { why = "salto, ignorada"; return; }
        }

        distance += step;
        p.d = distance;
        lastFix = p; lastFixRt = rt;
        points.add(p);
        used++; why = "";
        checkSplit(t);
        if (SystemClock.elapsedRealtime() - lastSave > 15000) saveSnapshot();
    }

    @Override public void onProviderEnabled(String provider) {}
    @Override public void onProviderDisabled(String provider) { why = "GPS desligado no celular"; }
    @Override public void onStatusChanged(String provider, int status, Bundle extras) {}

    void kalman(double lat, double lon, float acc, long rt) {
        double a = Math.max(acc, 1);
        if (kVar < 0) { kLat = lat; kLon = lon; kVar = a * a; kTs = rt; return; }
        double dt = (rt - kTs) / 1000.0;
        if (dt > 0) { kVar += dt * KF_Q * KF_Q; kTs = rt; }
        double k = kVar / (kVar + a * a);
        kLat += k * (lat - kLat); kLon += k * (lon - kLon);
        kVar = (1 - k) * kVar;
    }

    static double haversine(double lat1, double lon1, double lat2, double lon2) {
        double R = 6371000, r = Math.PI / 180;
        double dLat = (lat2 - lat1) * r, dLon = (lon2 - lon1) * r;
        double x = Math.pow(Math.sin(dLat / 2), 2) + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.pow(Math.sin(dLon / 2), 2);
        return 2 * R * Math.asin(Math.sqrt(x));
    }

    // ================= parciais por km =================
    void checkSplit(long t) {
        while (distance - lastSplitDist >= 1000) {
            double target = lastSplitDist + 1000;
            double tCross = t; Double cLat = null, cLon = null;
            for (int i = points.size() - 1; i > 0; i--) {
                Pt a = points.get(i - 1), b = points.get(i);
                if (a.d <= target && b.d >= target) {
                    double f = (target - a.d) / (b.d - a.d == 0 ? 1 : (b.d - a.d));
                    tCross = a.t + (b.t - a.t) * f;
                    cLat = a.lat + (b.lat - a.lat) * f; cLon = a.lon + (b.lon - a.lon) * f; break;
                }
            }
            long ms = Math.round(tCross) - lastSplitMs;
            splits.add(new Split(splits.size() + 1, ms, cLat, cLon));
            lastSplitMs = Math.round(tCross); lastSplitDist = target;
            announce(splits.size(), ms);
        }
    }

    void announce(int km, long ms) {
        vibrate();
        if (!voice || !ttsOk) return;
        long s = Math.round(ms / 1000.0);
        double avg = nowElapsed() / 1000.0 / (distance / 1000.0);
        String txt = km + (km > 1 ? " quilômetros" : " quilômetro") + ". Parcial " + (s / 60) + " minutos e " + (s % 60) +
                " segundos. Pace médio " + ((long) avg / 60) + " e " + Math.round(avg % 60) + ".";
        tts.speak(txt, TextToSpeech.QUEUE_ADD, null, "km" + km);
    }

    void vibrate() {
        Vibrator vib = (Vibrator) getSystemService(Context.VIBRATOR_SERVICE);
        if (vib == null) return;
        if (Build.VERSION.SDK_INT >= 26) vib.vibrate(VibrationEffect.createWaveform(new long[]{0, 200, 100, 200}, -1));
        else vib.vibrate(new long[]{0, 200, 100, 200}, -1);
    }

    double paceNow() {
        if (!"running".equals(state)) return Double.NaN;
        long now = SystemClock.elapsedRealtime();
        if (!speeds.isEmpty() && now - speeds.peekLast()[0] < 8000) {
            double lastT = speeds.peekLast()[0], sum = 0; int n = 0;
            for (double[] s : speeds) if (lastT - s[0] <= 6000) { sum += s[1]; n++; }
            if (n >= 2) { double v = sum / n; return v > STOP_SPEED ? 1000 / v : Double.NaN; }
        }
        // reserva: distância dos últimos ~20 s
        if (points.size() < 2) return Double.NaN;
        Pt last = points.get(points.size() - 1);
        if (nowElapsed() - last.t > 10000) return Double.NaN;
        int i = points.size() - 1;
        while (i > 0 && last.t - points.get(i - 1).t <= 20000 && !points.get(i).brk) i--;
        Pt first = points.get(i);
        double dd = last.d - first.d, dt = (last.t - first.t) / 1000.0;
        if (dd < 10 || dt < 3) return Double.NaN;
        return dt / (dd / 1000);
    }

    // ================= comandos =================
    synchronized void start(boolean voiceOn) {
        points.clear(); splits.clear(); distance = 0; elapsedAccum = 0; lastSplitMs = 0; lastSplitDist = 0;
        lastFix = null; kVar = -1; prevV = -1; speeds.clear(); segBreak = false;
        recv = 0; used = 0; why = "";
        voice = voiceOn;
        state = "running"; runStartRt = SystemClock.elapsedRealtime();
        goForeground(); acquireWake(); startGps(); tickNotif();
    }

    synchronized void pause() {
        if (!"running".equals(state)) return;
        elapsedAccum = nowElapsed(); state = "paused";
        releaseWake(); updateNotif(); saveSnapshot();
    }

    synchronized void resume() {
        if (!"paused".equals(state)) return;
        segBreak = true; state = "running"; runStartRt = SystemClock.elapsedRealtime();
        goForeground(); acquireWake(); startGps(); tickNotif();
    }

    synchronized JSONObject stop() {
        if ("running".equals(state)) elapsedAccum = nowElapsed();
        JSONObject run = new JSONObject();
        try {
            run.put("distance", distance);
            run.put("elapsed", elapsedAccum);
            run.put("splits", splitsJson());
            run.put("points", pointsJson(0));
        } catch (Exception ignored) {}
        state = "idle";
        releaseWake();
        ui.removeCallbacksAndMessages(null);
        stopForeground(true);
        snapshotFile().delete();
        return run;
    }

    // ================= estado para a tela =================
    synchronized JSONObject getState(int fromPoint) {
        JSONObject o = new JSONObject();
        try {
            o.put("state", state);
            o.put("elapsed", nowElapsed());
            o.put("distance", distance);
            double pn = paceNow();
            o.put("paceNow", Double.isNaN(pn) ? JSONObject.NULL : pn);
            o.put("lastSplitMs", lastSplitMs);
            o.put("lastSplitDist", lastSplitDist);
            o.put("recv", recv); o.put("used", used); o.put("why", why);
            o.put("sats", sats); o.put("satsTotal", satsTotal);
            o.put("acc", lastAcc);
            o.put("gpsOn", gpsOn);
            if (hasPos) { o.put("posLat", posLat); o.put("posLon", posLon); o.put("posAge", SystemClock.elapsedRealtime() - posRt); }
            o.put("splits", splitsJson());
            o.put("pointCount", points.size());
            o.put("points", pointsJson(Math.max(0, Math.min(fromPoint, points.size()))));
        } catch (Exception ignored) {}
        return o;
    }

    JSONArray splitsJson() throws Exception {
        JSONArray a = new JSONArray();
        for (Split s : splits) {
            JSONObject j = new JSONObject();
            j.put("km", s.km); j.put("ms", s.ms);
            if (s.lat != null) { j.put("lat", s.lat); j.put("lon", s.lon); }
            a.put(j);
        }
        return a;
    }

    JSONArray pointsJson(int from) throws Exception {
        JSONArray a = new JSONArray();
        for (int i = from; i < points.size(); i++) {
            Pt p = points.get(i);
            JSONObject j = new JSONObject();
            j.put("lat", Math.round(p.lat * 1e6) / 1e6); j.put("lon", Math.round(p.lon * 1e6) / 1e6);
            j.put("t", p.t); j.put("d", Math.round(p.d * 10) / 10.0);
            if (p.brk) j.put("brk", true);
            a.put(j);
        }
        return a;
    }

    // ================= recuperação (se o Android matar o app) =================
    File snapshotFile() { return new File(getFilesDir(), "corrida_atual.json"); }

    synchronized void saveSnapshot() {
        lastSave = SystemClock.elapsedRealtime();
        try {
            JSONObject o = new JSONObject();
            o.put("savedAt", System.currentTimeMillis());
            o.put("distance", distance); o.put("elapsed", nowElapsed());
            o.put("lastSplitMs", lastSplitMs); o.put("lastSplitDist", lastSplitDist);
            o.put("splits", splitsJson()); o.put("points", pointsJson(0));
            try (FileOutputStream f = new FileOutputStream(snapshotFile())) { f.write(o.toString().getBytes(StandardCharsets.UTF_8)); }
        } catch (Exception ignored) {}
    }

    /** Recarrega uma corrida salva como pausada. */
    synchronized boolean restore(JSONObject o) {
        try {
            points.clear(); splits.clear();
            distance = o.getDouble("distance"); elapsedAccum = o.getLong("elapsed");
            lastSplitMs = o.getLong("lastSplitMs"); lastSplitDist = o.getDouble("lastSplitDist");
            JSONArray sp = o.getJSONArray("splits");
            for (int i = 0; i < sp.length(); i++) {
                JSONObject j = sp.getJSONObject(i);
                splits.add(new Split(j.getInt("km"), j.getLong("ms"), j.has("lat") ? j.getDouble("lat") : null, j.has("lon") ? j.getDouble("lon") : null));
            }
            JSONArray pt = o.getJSONArray("points");
            for (int i = 0; i < pt.length(); i++) {
                JSONObject j = pt.getJSONObject(i);
                points.add(new Pt(j.getDouble("lat"), j.getDouble("lon"), j.getLong("t"), j.getDouble("d"), j.optBoolean("brk")));
            }
            lastFix = points.isEmpty() ? null : points.get(points.size() - 1);
            segBreak = true; state = "paused";
            return true;
        } catch (Exception e) { return false; }
    }

    // ================= notificação / energia =================
    void createChannel() {
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationChannel ch = new NotificationChannel(CH_ID, "Corrida em andamento", NotificationManager.IMPORTANCE_LOW);
            ch.setShowBadge(false);
            ((NotificationManager) getSystemService(NOTIFICATION_SERVICE)).createNotificationChannel(ch);
        }
    }

    Notification buildNotif() {
        Intent open = new Intent(this, MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent pi = PendingIntent.getActivity(this, 0, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        double km = distance / 1000.0;
        long el = nowElapsed();
        double avg = km > 0.02 ? el / 1000.0 / km : Double.NaN;
        String title = ("paused".equals(state) ? "Pausada · " : "") + String.format(Locale.US, "%.2f km", km).replace('.', ',') + " · " + fmtTime(el);
        String text = "Pace " + fmtPace(paceNow()) + " /km · médio " + fmtPace(avg) + " /km";
        return new NotificationCompat.Builder(this, CH_ID)
                .setSmallIcon(R.drawable.ic_stat_run)
                .setContentTitle(title)
                .setContentText(text)
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .setSilent(true)
                .setCategory(NotificationCompat.CATEGORY_WORKOUT)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .setContentIntent(pi)
                .build();
    }

    void goForeground() {
        Notification n = buildNotif();
        if (Build.VERSION.SDK_INT >= 29) startForeground(NOTIF_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION);
        else startForeground(NOTIF_ID, n);
    }

    void updateNotif() {
        if ("idle".equals(state)) return;
        ((NotificationManager) getSystemService(NOTIFICATION_SERVICE)).notify(NOTIF_ID, buildNotif());
    }

    void tickNotif() {
        ui.removeCallbacksAndMessages(null);
        ui.post(new Runnable() {
            @Override public void run() {
                if (!"running".equals(state)) return;
                updateNotif();
                ui.postDelayed(this, 1000);
            }
        });
    }

    @SuppressLint("WakelockTimeout")
    void acquireWake() {
        if (wakeLock == null) {
            PowerManager pm = (PowerManager) getSystemService(POWER_SERVICE);
            wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "passada:corrida");
        }
        if (!wakeLock.isHeld()) wakeLock.acquire();
    }

    void releaseWake() { if (wakeLock != null && wakeLock.isHeld()) wakeLock.release(); }

    static String fmtTime(long ms) {
        long s = ms / 1000, h = s / 3600, m = (s % 3600) / 60, ss = s % 60;
        return h > 0 ? String.format(Locale.US, "%d:%02d:%02d", h, m, ss) : String.format(Locale.US, "%02d:%02d", m, ss);
    }

    static String fmtPace(double secPerKm) {
        if (Double.isNaN(secPerKm) || Double.isInfinite(secPerKm) || secPerKm <= 0 || secPerKm > 3600) return "--:--";
        long m = (long) (secPerKm / 60); long s = Math.round(secPerKm % 60);
        if (s == 60) { m++; s = 0; }
        return String.format(Locale.US, "%d:%02d", m, s);
    }
}
