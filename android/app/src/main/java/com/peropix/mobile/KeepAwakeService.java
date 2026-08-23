package com.peropix.mobile;

import android.app.Service;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;

/**
 * 뽑는 동안 · 모델 받는 동안 앱을 깨어 있게 붙잡아 두는 서비스.
 *
 * ★안드로이드는 화면에 안 보이는 앱을 재운다. 그러면 WebView 의 자바스크립트가 멈추고
 *   DNS 도 막혀서, 다른 앱을 잠깐 보고 돌아오면 「인터넷 연결이 끊겼습니다」 가 뜬다.
 *   몇 분씩 걸리는 일을 하면서 화면을 계속 켜 두라고 할 수는 없다.
 * ★안드로이드가 인정하는 방법은 이것뿐이다 — 알림을 하나 띄우고 포그라운드 서비스로
 *   도는 것. 사용자에게 「지금 이 앱이 일하고 있다」 를 보여 주는 대가로 안 재운다.
 * ★wake lock 도 같이 잡는다. 서비스만으로는 CPU 가 졸 수 있다.
 */
public class KeepAwakeService extends Service {

    public static final String CHANNEL = "peropix_work";
    public static final String EXTRA_TEXT = "text";
    public static final String EXTRA_PERCENT = "percent";
    private static final int NOTE_ID = 20260824;

    private PowerManager.WakeLock lock;
    private boolean started;

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String text = intent != null ? intent.getStringExtra(EXTRA_TEXT) : null;
        if (text == null || text.length() == 0) text = "작업 중입니다";
        int percent = intent != null ? intent.getIntExtra(EXTRA_PERCENT, -1) : -1;

        channel();
        Notification note = build(text, percent);

        if (started) {
            // ★이미 떠 있으면 **그 알림을 고쳐 쓴다.** 알림을 새로 띄우면 안드로이드가
            //   있던 것을 지우고 다시 그려서, 진행 중에 알림이 깜박이며 새로 뜬다.
            //   같은 id 로 notify 하면 자리에서 글자만 바뀐다.
            NotificationManager nm =
                    (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm != null) nm.notify(NOTE_ID, note);
        } else if (Build.VERSION.SDK_INT >= 34) {
            // ★안드로이드 14 부터는 무슨 일을 하는 서비스인지 밝혀야 한다. 안 밝히면
            //   시작하자마자 예외로 죽는다.
            startForeground(NOTE_ID, note, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC);
            started = true;
        } else {
            startForeground(NOTE_ID, note);
            started = true;
        }

        if (lock == null) {
            PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
            if (pm != null) {
                lock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "peropix:work");
                // ★상한을 둔다. 어딘가에서 멈추기를 잊어도 배터리를 밤새 먹지 않는다.
                try { lock.acquire(3 * 60 * 60 * 1000L); } catch (Exception ignore) { }
            }
        }
        // 죽었다 살아나도 다시 시작하지 않는다. 그때는 이미 하던 일이 끊긴 뒤다.
        return START_NOT_STICKY;
    }

    @Override
    public void onDestroy() {
        if (lock != null && lock.isHeld()) {
            try { lock.release(); } catch (Exception ignore) { }
        }
        lock = null;
        started = false;
        super.onDestroy();
    }

    private void channel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null || nm.getNotificationChannel(CHANNEL) != null) return;
        // ★소리 없이 조용히. 진행 알림이 소리를 내면 수십 번 울린다.
        NotificationChannel ch = new NotificationChannel(CHANNEL, "생성 중",
                NotificationManager.IMPORTANCE_LOW);
        ch.setDescription("그림을 뽑거나 모델을 받는 동안 떠 있습니다");
        ch.setSound(null, null);
        ch.enableVibration(false);
        nm.createNotificationChannel(ch);
    }

    private Notification build(String text, int percent) {
        Intent open = new Intent(this, MainActivity.class);
        open.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        int flag = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) flag |= PendingIntent.FLAG_IMMUTABLE;
        PendingIntent tap = PendingIntent.getActivity(this, 0, open, flag);

        Notification.Builder b = (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O)
                ? new Notification.Builder(this, CHANNEL)
                : new Notification.Builder(this);
        b.setContentTitle("PeroPix")
                .setContentText(text)
                .setSmallIcon(android.R.drawable.stat_sys_download)
                .setContentIntent(tap)
                .setOngoing(true)
                .setOnlyAlertOnce(true);
        // 퍼센트를 알면 막대도 같이. 모르면 흐르는 막대로 둔다.
        if (percent >= 0) b.setProgress(100, Math.min(100, percent), false);
        return b.build();
    }
}
