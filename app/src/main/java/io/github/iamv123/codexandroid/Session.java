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
    static volatile String lastStatus="未授权 / 未连接";
    final String endpoint,pairId,pairToken;
    final byte[] master,pairKey;
    final Set<String> grants;
    final long expires;
    volatile boolean stopped,recoveryRequired;
    volatile ConnectionKeys connection;
    long tx,rx;
    private Session(JSONObject pair,Set<String> grants,long minutes)throws Exception{
        if(pair.getInt("v")!=3)throw new IllegalArgumentException("请刷新电脑配对页，使用v0.1.8新版二维码");
        URI url=new URI(pair.getString("url"));
        if(!"https".equals(url.getScheme())||url.getHost()==null||url.getRawUserInfo()!=null||url.getPort()!=-1||(url.getPath()!=null&&!url.getPath().isEmpty()&&!url.getPath().equals("/"))||url.getRawQuery()!=null||url.getRawFragment()!=null)throw new SecurityException("配对地址必须是HTTPS域名");
        endpoint="https://"+url.getHost();pairId=pair.getString("session");
        if(!pairId.matches("[a-f0-9]{32}"))throw new SecurityException("配对会话格式错误");
        master=Base64.getUrlDecoder().decode(pair.getString("key"));if(master.length!=32)throw new SecurityException("配对密钥格式错误");
        if(minutes<1||minutes>Duration.MAX_MINUTES){Arrays.fill(master,(byte)0);throw new SecurityException("invalid_duration");}
        long pairRemaining=pair.getLong("expiresAt")-System.currentTimeMillis();
        if(pairRemaining<=0||pairRemaining>Duration.MAX_MINUTES*60000L+120000){Arrays.fill(master,(byte)0);throw new SecurityException("电脑配对已到期，或手机时间不正确，请重新配对");}
        this.grants=Set.copyOf(grants);
        for(String p:grants)if(Policy.protectedPackage(p)){Arrays.fill(master,(byte)0);throw new SecurityException("protected_package");}
        pairKey=Crypto.derive(master,pairId,"encryption");byte[] auth=Crypto.derive(master,pairId,"auth");
        try{pairToken=Base64.getUrlEncoder().withoutPadding().encodeToString(auth);}finally{Arrays.fill(auth,(byte)0);}
        expires=SystemClock.elapsedRealtime()+Math.min(minutes*60000L,pairRemaining);
    }
    static JSONObject decode(String raw)throws Exception{
        if(raw.length()>4096)throw new IllegalArgumentException("配对码过长");
        Uri uri=Uri.parse(raw.trim());if(!"codexandroid".equals(uri.getScheme())||!"pair".equals(uri.getHost()))throw new IllegalArgumentException("请粘贴完整配对码");
        String data=uri.getQueryParameter("data");if(data==null)throw new IllegalArgumentException("配对码缺少数据");
        return new JSONObject(new String(Base64.getUrlDecoder().decode(data),StandardCharsets.UTF_8));
    }
    static Session create(String raw,Set<String> grants,long minutes)throws Exception{return new Session(decode(raw),grants,minutes);}
    synchronized ConnectionKeys nextConnection()throws Exception{
        if(!live())throw new SecurityException("session_ended");
        if(connection!=null)connection.clear();connection=new ConnectionKeys(master,pairId,ConnectionKeys.newClientId());tx=0;rx=0;return connection;
    }
    boolean live(){return !stopped&&current==this&&SystemClock.elapsedRealtime()<expires;}
    boolean unlocked(Context ctx){return !ctx.getSystemService(KeyguardManager.class).isDeviceLocked();}
    void requireLive(Context ctx){if(!live())throw new SecurityException("session_ended");if(!unlocked(ctx))throw new SecurityException("phone_locked_unlock_locally");}
    synchronized void stop(){
        stopped=true;Arrays.fill(master,(byte)0);Arrays.fill(pairKey,(byte)0);if(connection!=null)connection.clear();
        if(current==this){current=null;if(!lastStatus.startsWith("连接失败"))lastStatus="已停止并撤销授权；可调整勾选后重新确认开始";}
    }
    JSONObject status()throws Exception{return new JSONObject().put("apps",new org.json.JSONArray(grants)).put("version","0.1.8").put("remainingSeconds",Math.max(0,(expires-SystemClock.elapsedRealtime())/1000));}
}
