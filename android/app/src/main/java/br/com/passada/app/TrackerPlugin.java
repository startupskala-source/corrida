package br.com.passada.app;

import android.Manifest;
import android.annotation.SuppressLint;
import android.content.Context;
import android.content.Intent;
import android.location.LocationManager;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.provider.Settings;

import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import org.json.JSONObject;

import java.io.File;
import java.nio.charset.StandardCharsets;
import java.io.ByteArrayOutputStream;
import java.io.FileInputStream;
import java.io.InputStream;

/** Ponte entre a tela (JS) e o TrackingService. */
@CapacitorPlugin(
    name = "Tracker",
    permissions = {
        @Permission(alias = "location", strings = { Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION }),
        @Permission(alias = "notifications", strings = { Manifest.permission.POST_NOTIFICATIONS })
    }
)
public class TrackerPlugin extends Plugin {

    /** Garante que o serviço existe (e o GPS está ligado). Chamado com o app aberto. */
    private TrackingService service() {
        if (TrackingService.instance == null) {
            Context ctx = getContext();
            ctx.startService(new Intent(ctx, TrackingService.class));
            for (int i = 0; i < 60 && TrackingService.instance == null; i++) {
                try { Thread.sleep(50); } catch (InterruptedException ignored) {}
            }
        }
        TrackingService s = TrackingService.instance;
        if (s != null) s.startGps();
        return s;
    }

    private JSObject status() {
        JSObject r = new JSObject();
        r.put("location", getPermissionState("location") == PermissionState.GRANTED);
        r.put("notifications", Build.VERSION.SDK_INT < 33 || getPermissionState("notifications") == PermissionState.GRANTED);
        LocationManager lm = (LocationManager) getContext().getSystemService(Context.LOCATION_SERVICE);
        r.put("gpsEnabled", lm != null && lm.isProviderEnabled(LocationManager.GPS_PROVIDER));
        PowerManager pm = (PowerManager) getContext().getSystemService(Context.POWER_SERVICE);
        r.put("batteryUnrestricted", pm != null && pm.isIgnoringBatteryOptimizations(getContext().getPackageName()));
        return r;
    }

    @PluginMethod public void checkSetup(PluginCall call) { call.resolve(status()); }

    @PluginMethod public void requestPermissions(PluginCall call) {
        if (getPermissionState("location") != PermissionState.GRANTED) {
            requestPermissionForAlias("location", call, "afterLocation");
        } else afterLocation(call);
    }

    @PermissionCallback private void afterLocation(PluginCall call) {
        if (Build.VERSION.SDK_INT >= 33 && getPermissionState("notifications") != PermissionState.GRANTED) {
            requestPermissionForAlias("notifications", call, "afterNotif");
        } else afterNotif(call);
    }

    @PermissionCallback private void afterNotif(PluginCall call) { call.resolve(status()); }

    /** Pede para o Android não "economizar bateria" matando o app no meio da corrida. */
    @SuppressLint("BatteryLife")
    @PluginMethod public void requestBatteryUnrestricted(PluginCall call) {
        try {
            Intent i = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:" + getContext().getPackageName()));
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(i);
        } catch (Exception e) {
            Intent i = new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(i);
        }
        call.resolve();
    }

    @PluginMethod public void openLocationSettings(PluginCall call) {
        getContext().startActivity(new Intent(Settings.ACTION_LOCATION_SOURCE_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        call.resolve();
    }

    @PluginMethod public void warmup(PluginCall call) {
        if (getPermissionState("location") != PermissionState.GRANTED) { call.reject("sem permissão de localização"); return; }
        service(); call.resolve();
    }

    @PluginMethod public void start(PluginCall call) {
        if (getPermissionState("location") != PermissionState.GRANTED) { call.reject("sem permissão de localização"); return; }
        TrackingService s = service();
        if (s == null) { call.reject("serviço não iniciou"); return; }
        s.start(call.getBoolean("voice", true));
        call.resolve();
    }

    @PluginMethod public void pause(PluginCall call) {
        TrackingService s = TrackingService.instance; if (s != null) s.pause(); call.resolve();
    }

    @PluginMethod public void resume(PluginCall call) {
        TrackingService s = service();
        if (s == null) { call.reject("serviço não iniciou"); return; }
        s.voice = call.getBoolean("voice", s.voice);
        s.resume(); call.resolve();
    }

    @PluginMethod public void setVoice(PluginCall call) {
        TrackingService s = TrackingService.instance; if (s != null) s.voice = call.getBoolean("voice", true); call.resolve();
    }

    @PluginMethod public void stop(PluginCall call) {
        TrackingService s = TrackingService.instance;
        if (s == null) { call.reject("nenhuma corrida em andamento"); return; }
        try { call.resolve(JSObject.fromJSONObject(s.stop())); } catch (Exception e) { call.reject(e.getMessage()); }
    }

    @PluginMethod public void getState(PluginCall call) {
        TrackingService s = TrackingService.instance;
        if (s == null) { JSObject r = new JSObject(); r.put("state", "off"); call.resolve(r); return; }
        try { call.resolve(JSObject.fromJSONObject(s.getState(call.getInt("from", 0)))); } catch (Exception e) { call.reject(e.getMessage()); }
    }

    // ---- recuperação de corrida não finalizada ----
    /** Lê o arquivo inteiro (compatível com Android 7, sem java.nio.file). */
    private static String readText(File f) throws Exception {
        try (InputStream in = new FileInputStream(f); ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            byte[] buf = new byte[8192]; int n;
            while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
            return new String(out.toByteArray(), StandardCharsets.UTF_8);
        }
    }

    private File snapFile() { return new File(getContext().getFilesDir(), "corrida_atual.json"); }

    @PluginMethod public void getSnapshot(PluginCall call) {
        JSObject r = new JSObject();
        TrackingService s = TrackingService.instance;
        File f = snapFile();
        if ((s == null || "idle".equals(s.state)) && f.exists()) {
            try {
                JSONObject o = new JSONObject(readText(f));
                r.put("exists", true);
                r.put("distance", o.optDouble("distance"));
                r.put("savedAt", o.optLong("savedAt"));
            } catch (Exception e) { r.put("exists", false); }
        } else r.put("exists", false);
        call.resolve(r);
    }

    @PluginMethod public void restoreSnapshot(PluginCall call) {
        try {
            JSONObject o = new JSONObject(readText(snapFile()));
            TrackingService s = service();
            if (s == null || !s.restore(o)) { call.reject("não consegui recuperar"); return; }
            call.resolve();
        } catch (Exception e) { call.reject(e.getMessage()); }
    }

    @PluginMethod public void discardSnapshot(PluginCall call) { snapFile().delete(); call.resolve(); }
}
