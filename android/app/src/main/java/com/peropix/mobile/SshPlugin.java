package com.peropix.mobile;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import com.jcraft.jsch.ChannelExec;
import com.jcraft.jsch.JSch;
import com.jcraft.jsch.Session;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.Properties;

/**
 * SSH 로 서버에 붙어 명령 하나를 돌린다.
 *
 * ★이걸 두는 이유는 하나다 — 사람이 터미널을 안 보게 하려고. 수신함을 깔려면 파일을
 *   올리고, 명령을 치고, 방화벽을 열어야 했는데, 그걸 앱이 대신 한다.
 * ★비밀번호는 여기서 안 들고 있는다. 한 번 쓰고 그 자리에서 버린다.
 * ★sudo 는 -S 로 비밀번호를 stdin 에서 읽는다. 그래서 명령을 시작하자마자 비밀번호를
 *   한 줄 써 넣는다. 명령이 sudo 를 안 쓰면 그 글자는 그냥 무시된다.
 */
@CapacitorPlugin(name = "Ssh")
public class SshPlugin extends Plugin {

    /** 한 번에 읽을 수 있는 양의 상한. 서버가 끝없이 뱉어도 앱이 안 죽게 한다. */
    private static final int MAX_OUT = 512 * 1024;

    @PluginMethod
    public void exec(final PluginCall call) {
        final String host = call.getString("host", "");
        final int port = call.getInt("port", 22);
        final String user = call.getString("user", "");
        final String password = call.getString("password", "");
        final String command = call.getString("command", "");
        final int timeout = call.getInt("timeoutMs", 180000);

        if (host == null || host.length() == 0) { call.reject("주소가 비어 있습니다."); return; }
        if (user == null || user.length() == 0) { call.reject("아이디가 비어 있습니다."); return; }
        if (command == null || command.length() == 0) { call.reject("보낼 명령이 없습니다."); return; }

        // ★네트워크를 부르는 일이라 따로 실을 판다. 화면 실에서 막으면 앱이 멈춘 것처럼 보인다.
        new Thread(new Runnable() {
            @Override
            public void run() {
                Session session = null;
                try {
                    JSch jsch = new JSch();
                    session = jsch.getSession(user, host, port);
                    session.setPassword(password);

                    Properties cfg = new Properties();
                    // ★처음 붙는 서버는 열쇠를 알 수 없다. 대신 붙고 나서 그 지문을 돌려주고,
                    //   다음부터 달라지면 앱이 알아채게 한다 (조용히 넘기지 않는다).
                    cfg.put("StrictHostKeyChecking", "no");
                    session.setConfig(cfg);
                    session.setTimeout(timeout);
                    session.connect(timeout);

                    String fingerprint = "";
                    try {
                        if (session.getHostKey() != null) {
                            fingerprint = session.getHostKey().getFingerPrint(jsch);
                        }
                    } catch (Exception ignore) { /* 지문을 못 얻어도 명령은 돌린다 */ }

                    ChannelExec channel = (ChannelExec) session.openChannel("exec");
                    channel.setCommand(command);

                    ByteArrayOutputStream errBuf = new ByteArrayOutputStream();
                    channel.setErrStream(errBuf);
                    InputStream in = channel.getInputStream();
                    OutputStream out = channel.getOutputStream();
                    channel.connect(timeout);

                    // sudo -S 가 기다리는 비밀번호. 안 쓰는 명령이면 그냥 버려진다.
                    out.write((password + "\n").getBytes(StandardCharsets.UTF_8));
                    out.flush();

                    ByteArrayOutputStream outBuf = new ByteArrayOutputStream();
                    byte[] buf = new byte[8192];
                    long deadline = System.currentTimeMillis() + timeout;
                    while (true) {
                        while (in.available() > 0) {
                            int n = in.read(buf, 0, buf.length);
                            if (n < 0) break;
                            if (outBuf.size() < MAX_OUT) outBuf.write(buf, 0, n);
                        }
                        if (channel.isClosed()) {
                            if (in.available() > 0) continue;
                            break;
                        }
                        if (System.currentTimeMillis() > deadline) {
                            throw new Exception("Connection timed out");
                        }
                        try { Thread.sleep(120); } catch (InterruptedException ie) { break; }
                    }

                    int code = channel.getExitStatus();
                    channel.disconnect();

                    JSObject ret = new JSObject();
                    ret.put("code", code);
                    ret.put("out", outBuf.toString("UTF-8"));
                    ret.put("err", errBuf.toString("UTF-8"));
                    ret.put("fingerprint", fingerprint);
                    call.resolve(ret);
                } catch (Exception e) {
                    String m = e.getMessage();
                    call.reject(m == null || m.length() == 0 ? e.toString() : m);
                } finally {
                    if (session != null) session.disconnect();
                }
            }
        }).start();
    }
}
