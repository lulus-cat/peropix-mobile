package com.peropix.mobile;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // ★플러그인은 super.onCreate 앞에서 등록한다. 뒤에서 부르면 브리지가 이미
        //   만들어진 뒤라 JS 에서 Installer 를 못 찾는다.
        registerPlugin(InstallerPlugin.class);
        registerPlugin(SshPlugin.class);
        registerPlugin(KeepAwakePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
