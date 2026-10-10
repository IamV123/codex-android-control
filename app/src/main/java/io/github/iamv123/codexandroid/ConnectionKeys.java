package io.github.iamv123.codexandroid;

import java.security.SecureRandom;
import java.util.Arrays;
import java.util.Base64;

/** A locally authorized start always gets its own transport keys and counters. */
public final class ConnectionKeys {
    public final String pairId, clientId, id, pairToken, token;
    public final byte[] pairKey, key;
    public ConnectionKeys(byte[] master, String pairId, String clientId) throws Exception {
        if(master.length!=32 || !pairId.matches("[a-f0-9]{32}") || !clientId.matches("[a-f0-9]{32}"))throw new SecurityException("invalid_connection_identity");
        this.pairId=pairId;this.clientId=clientId;id=pairId+":"+clientId;
        pairKey=Crypto.derive(master,pairId,"encryption");pairToken=token(master,pairId);
        key=Crypto.derive(master,id,"encryption");token=token(master,id);
    }
    private static String token(byte[] master,String id)throws Exception{return Base64.getUrlEncoder().withoutPadding().encodeToString(Crypto.derive(master,id,"auth"));}
    public static String newClientId(){byte[] bytes=new byte[16];new SecureRandom().nextBytes(bytes);StringBuilder out=new StringBuilder(32);for(byte b:bytes)out.append(Integer.toHexString((b&255)+256).substring(1));return out.toString();}
    public void clear(){Arrays.fill(pairKey,(byte)0);Arrays.fill(key,(byte)0);}
}
