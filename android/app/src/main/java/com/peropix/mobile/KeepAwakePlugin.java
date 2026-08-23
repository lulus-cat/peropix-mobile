package com.peropix.mobile;

import android.content.Intent;
import android.os.Build;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * 오래 걸리는 일 동안 앱이 안 재워지게 붙잡는다.
 *
 * ★반드시 짝을 맞춘다. start 해 놓고 stop 을 잊으면 알림이 안 사라지고 배터리를 먹는다.
 *   부르는 쪽(app.js)은 finally 에서 stop 한다.
 */
@CapacitorPlugin(name = "KeepAwake")
public class KeepAwakePlugin extends Plugin {

    @PluginMethod
    public void start(PluginCall call) {
        String text = call.getString("text", "그림을 뽑는 중입니다");
        try {
            Intent i = new Intent(getContext(), KeepAwakeService.class);
            i.putExtra(KeepAwakeService.EXTRA_TEXT, text);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                getContext().startForegroundService(i);
            } else {
                getContext().startService(i);
            }
            call.resolve();
        } catch (Exception e) {
            // ★여기서 실패해도 뽑는 것은 계속돼야 한다. 붙잡아 두지 못할 뿐이다.
            call.reject(e.getMessage() == null ? e.toString() : e.getMessage());
        }
    }

    @PluginMethod
    public void stop(PluginCall call) {
        try {
            getContext().stopService(new Intent(getContext(), KeepAwakeService.class));
        } catch (Exception ignore) { /* 이미 멈춰 있으면 그만이다 */ }
        call.resolve();
    }
}
