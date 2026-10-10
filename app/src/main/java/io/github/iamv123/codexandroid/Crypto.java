package io.github.iamv123.codexandroid;

import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.util.Base64;
import javax.crypto.Cipher;
import javax.crypto.Mac;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;

public final class Crypto {
    private Crypto() {}
    public static byte[] derive(byte[] master, String session, String label) throws Exception {
        Mac hmac = Mac.getInstance("HmacSHA256");
        hmac.init(new SecretKeySpec(session.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
        byte[] extracted = hmac.doFinal(master);
        hmac.init(new SecretKeySpec(extracted, "HmacSHA256"));
        hmac.update(("codex-android-control/v1/" + label).getBytes(StandardCharsets.UTF_8));
        byte[] out = hmac.doFinal(new byte[]{1});
        java.util.Arrays.fill(extracted, (byte) 0);
        return out;
    }
    public static final class Envelope {
        public final String nonce, data;
        Envelope(String nonce, String data) { this.nonce = nonce; this.data = data; }
    }
    public static Envelope seal(byte[] key, String session, String direction, long seq, String text) throws Exception {
        byte[] nonce = new byte[12]; new SecureRandom().nextBytes(nonce);
        byte[] data = crypt(Cipher.ENCRYPT_MODE, key, session, direction, seq, nonce, text.getBytes(StandardCharsets.UTF_8));
        return new Envelope(Base64.getEncoder().encodeToString(nonce), Base64.getEncoder().encodeToString(data));
    }
    public static String open(byte[] key, String session, String direction, long seq, String nonce, String data) throws Exception {
        byte[] iv = Base64.getDecoder().decode(nonce), bytes = Base64.getDecoder().decode(data);
        if (iv.length != 12 || bytes.length < 17 || bytes.length > 260000) throw new SecurityException("invalid_frame");
        return new String(crypt(Cipher.DECRYPT_MODE, key, session, direction, seq, iv, bytes), StandardCharsets.UTF_8);
    }
    private static byte[] crypt(int mode, byte[] key, String session, String direction, long seq, byte[] iv, byte[] data) throws Exception {
        if (seq < 1 || seq > 9007199254740991L) throw new SecurityException("invalid_sequence");
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(mode, new SecretKeySpec(key, "AES"), new GCMParameterSpec(128, iv));
        cipher.updateAAD((session + "|" + direction + "|" + seq).getBytes(StandardCharsets.UTF_8));
        return cipher.doFinal(data);
    }
}
