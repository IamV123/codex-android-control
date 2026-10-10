package io.github.iamv123.codexandroid;

import android.app.KeyguardManager;
import android.content.Context;
import android.net.Uri;
import android.os.SystemClock;
import org.json.JSONObject;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.Base64;
import java.util.Set;

final class Session {
    static volatile Session current;
    final String endpoint, id, token;
    final byte[] key;
    final Set<String> grants;
    final long expires;
    volatile boolean stopped;
    long tx, rx;
    private Session(JSONObject pair, Set<String> grants, int minutes) throws Exception {
        if (pair.getInt("v") != 1) throw new IllegalArgumentException("不支持的配对版本");
        URI url = new URI(pair.getString("url"));
        if (!"https".equals(url.getScheme()) || url.getHost() == null || url.getRawUserInfo() != null || url.getPort() != -1 || (url.getPath() != null && !url.getPath().isEmpty() && !url.getPath().equals("/")) || url.getRawQuery() != null || url.getRawFragment() != null) throw new SecurityException("配对地址必须是 HTTPS 域名");
        endpoint = "https://" + url.getHost(); id = pair.getString("session");
        if (!id.matches("[a-f0-9]{32}")) throw new SecurityException("配对会话格式错误");
        byte[] master = Base64.getUrlDecoder().decode(pair.getString("key"));
        if (master.length != 32) throw new SecurityException("配对密钥格式错误");
        try { key = Crypto.derive(master, id, "encryption"); token = Base64.getUrlEncoder().withoutPadding().encodeToString(Crypto.derive(master,id,"auth")); }
        finally { Arrays.fill(master, (byte) 0); }
        if (minutes != 10 && minutes != 30) throw new SecurityException("invalid_duration");
        this.grants = Set.copyOf(grants);
        for (String p : grants) if (Policy.protectedPackage(p)) throw new SecurityException("protected_package");
        expires = SystemClock.elapsedRealtime() + minutes * 60000L;
    }
    static JSONObject decode(String raw) throws Exception {
        if (raw.length() > 4096) throw new IllegalArgumentException("配对码过长");
        Uri uri = Uri.parse(raw.trim());
        if (!"codexandroid".equals(uri.getScheme()) || !"pair".equals(uri.getHost())) throw new IllegalArgumentException("请粘贴完整配对码");
        String data = uri.getQueryParameter("data");
        if (data == null) throw new IllegalArgumentException("配对码缺少数据");
        return new JSONObject(new String(Base64.getUrlDecoder().decode(data), StandardCharsets.UTF_8));
    }
    static Session create(String raw, Set<String> grants, int minutes) throws Exception { return new Session(decode(raw), grants, minutes); }
    boolean live() { return !stopped && current == this && SystemClock.elapsedRealtime() < expires; }
    boolean unlocked(Context ctx) { return !ctx.getSystemService(KeyguardManager.class).isDeviceLocked(); }
    void requireLive(Context ctx) {
        if (!live()) throw new SecurityException("session_ended");
        if (!unlocked(ctx)) { stop(); throw new SecurityException("phone_locked_session_revoked"); }
    }
    synchronized void stop() { stopped = true; Arrays.fill(key, (byte) 0); if (current == this) current = null; Approval.cancel("session_ended"); }
    JSONObject status() throws Exception { return new JSONObject().put("apps", new org.json.JSONArray(grants)).put("remainingSeconds", Math.max(0, (expires-SystemClock.elapsedRealtime())/1000)); }
}
