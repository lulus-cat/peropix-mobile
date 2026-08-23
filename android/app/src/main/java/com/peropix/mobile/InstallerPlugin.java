package com.peropix.mobile;

import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;

/**
 * 받아 둔 APK 의 설치 화면을 띄운다.
 *
 * ★조용히 알아서 깔지는 못한다. 안드로이드는 스토어를 안 거친 APK 를 설치할 때 반드시
 *   사람이 확인 화면을 눌러야 한다. 이 플러그인이 하는 일은 그 화면까지 데려다주는 것,
 *   딱 거기까지다.
 * ★설치 화면을 띄우려면 "출처를 알 수 없는 앱" 권한이 필요하다. 안드로이드 8 부터는
 *   앱마다 따로 받는다. 그래서 물어보는 방법(canInstall)과 설정으로 보내는 방법
 *   (openSettings)을 함께 둔다. 없는 채로 띄우면 아무 일도 안 일어나 고장으로 보인다.
 * ★파일은 content:// 로 넘겨야 한다. Android 7 부터 file:// 을 다른 앱에 넘기면
 *   FileUriExposedException 으로 앱이 죽는다. FileProvider 가 그 변환을 맡는다
 *   (AndroidManifest 의 ${applicationId}.fileprovider, res/xml/file_paths.xml).
 */
@CapacitorPlugin(name = "Installer")
public class InstallerPlugin extends Plugin {

    /** 이 기기에서 설치 화면을 띄울 수 있는가. */
    @PluginMethod
    public void canInstall(PluginCall call) {
        JSObject ret = new JSObject();
        boolean granted = true;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            granted = getContext().getPackageManager().canRequestPackageInstalls();
        }
        ret.put("granted", granted);
        call.resolve(ret);
    }

    /** "출처를 알 수 없는 앱" 설정 화면으로 보낸다. */
    @PluginMethod
    public void openSettings(PluginCall call) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            Intent i = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                    Uri.parse("package:" + getContext().getPackageName()));
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(i);
        }
        call.resolve();
    }

    /**
     * 캐시 폴더에 받아 둔 APK 의 설치 화면을 띄운다.
     * @param name 캐시 폴더 안의 파일 이름 (경로가 아니다)
     */
    @PluginMethod
    public void install(PluginCall call) {
        String name = call.getString("name");
        if (name == null || name.length() == 0) {
            call.reject("파일 이름이 없습니다.");
            return;
        }
        // ★이름만 받는다. 경로를 그대로 받으면 앱 밖의 파일을 넘겨 달라고 할 수 있다.
        name = new File(name).getName();

        File apk = new File(getContext().getCacheDir(), name);
        if (!apk.exists()) {
            call.reject("받아 둔 파일을 찾지 못했습니다: " + name);
            return;
        }

        try {
            Uri uri = FileProvider.getUriForFile(
                    getContext(), getContext().getPackageName() + ".fileprovider", apk);
            Intent i = new Intent(Intent.ACTION_VIEW);
            i.setDataAndType(uri, "application/vnd.android.package-archive");
            i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(i);
            call.resolve();
        } catch (Exception e) {
            call.reject("설치 화면을 띄우지 못했습니다: " + e.getMessage());
        }
    }
}
