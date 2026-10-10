package io.github.iamv123.codexandroid;

import android.app.*;
import android.content.*;
import android.os.*;
import org.json.JSONObject;
import javax.net.ssl.HttpsURLConnection;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.TimeUnit;

public final class BridgeService extends Service {
    private Thread worker;
    private volatile HttpsURLConnection connection;
    private Session active;
    private volatile long lastSuccess;
    private Notification.Builder sessionNote;
    private boolean connected;
    private final Handler main=new Handler(Looper.getMainLooper());
    private final BroadcastReceiver lock=new BroadcastReceiver(){@Override public void onReceive(Context c,Intent i){stopNow();}};
    @Override public void onCreate(){super.onCreate();registerReceiver(lock,new IntentFilter(Intent.ACTION_SCREEN_OFF),Context.RECEIVER_NOT_EXPORTED);}
    @Override public int onStartCommand(Intent intent,int flags,int startId){
        if(intent!=null&&"STOP".equals(intent.getAction())){stopNow();return START_NOT_STICKY;}
        if(worker!=null)return START_NOT_STICKY;
        active=Session.current;
        if(active==null||!active.live()){stopSelf();return START_NOT_STICKY;}
        NotificationManager nm=getSystemService(NotificationManager.class);nm.createNotificationChannel(new NotificationChannel("session","远程会话（可随时停止）",NotificationManager.IMPORTANCE_LOW));
        PendingIntent stop=PendingIntent.getService(this,1,new Intent(this,BridgeService.class).setAction("STOP"),PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
        PendingIntent open=PendingIntent.getActivity(this,0,new Intent(this,MainActivity.class),PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
        nm.cancel(3);Session.lastStatus="正在连接电脑，请保持手机解锁";
        sessionNote=new Notification.Builder(this,"session").setSmallIcon(R.drawable.ic_app).setContentTitle("Codex 手机正在连接").setContentText("仅限勾选应用 · 锁屏自动停止").setContentIntent(open).addAction(new Notification.Action.Builder(null,"立即停止",stop).build()).setOngoing(true).setOnlyAlertOnce(true).setVisibility(Notification.VISIBILITY_PUBLIC);
        try{startForeground(1,sessionNote.build());}catch(RuntimeException e){reportFailure(e);stopNow();return START_NOT_STICKY;}
        lastSuccess=SystemClock.elapsedRealtime();worker=new Thread(this::loop,"codex-phone-channel");worker.start();
        main.post(new Runnable(){@Override public void run(){if(active==null||!active.live()||!active.unlocked(BridgeService.this)||SystemClock.elapsedRealtime()-lastSuccess>65000){stopNow();return;}main.postDelayed(this,1000);}});
        return START_NOT_STICKY;
    }
    private void loop(){JSONObject response=null;try{
        while(active.live()){
            active.requireLive(this);
            try{
                JSONObject payload=new JSONObject().put("event",response==null?"poll":"result").put("phone",active.status());
                if(response!=null)payload.put("response",response);
                JSONObject returned=exchange(payload);lastSuccess=SystemClock.elapsedRealtime();response=null;
                if(active.live()){Session.lastStatus="已连接电脑；可按 Home 键返回已授权应用。锁屏或点停止可撤销";if(!connected){connected=true;getSystemService(NotificationManager.class).notify(1,sessionNote.setContentTitle("Codex 手机会话已连接").build());}}
                JSONObject command=returned.optJSONObject("command");
                if(command==null)continue;
                String id=command.getString("id");response=new JSONObject().put("id",id);
                try{
                    ControlService control=ControlService.instance;if(control==null)throw new SecurityException("accessibility_disabled");
                    JSONObject result=control.execute(command.getString("tool"),command.getJSONObject("args")).get(62000,TimeUnit.MILLISECONDS);
                    response.put("ok",true).put("data",result);
                }catch(Exception e){Throwable cause=e.getCause()==null?e:e.getCause();response.put("ok",false).put("error",cause.getMessage()==null?"operation_rejected":cause.getMessage());}
            }catch(SecurityException e){throw e;}
            catch(IOException e){throw e;} // Never replay a possibly delivered request.
        }
    }catch(Exception e){reportFailure(e);}finally{main.post(this::stopNow);}}
    private void reportFailure(Exception error){
        if(active==null||!active.live())return;
        Session.lastStatus="连接失败："+PhoneHttp.describe(error);
        NotificationManager nm=getSystemService(NotificationManager.class);
        nm.createNotificationChannel(new NotificationChannel("connection_errors","连接问题",NotificationManager.IMPORTANCE_DEFAULT));
        PendingIntent open=PendingIntent.getActivity(this,0,new Intent(this,MainActivity.class),PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
        nm.notify(3,new Notification.Builder(this,"connection_errors").setSmallIcon(R.drawable.ic_app).setContentTitle("Codex 连接未成功").setContentText(Session.lastStatus).setStyle(new Notification.BigTextStyle().bigText(Session.lastStatus)).setContentIntent(open).setAutoCancel(true).setVisibility(Notification.VISIBILITY_PRIVATE).build());
    }
    private JSONObject exchange(JSONObject payload)throws Exception{
        long seq=++active.tx;Crypto.Envelope enc=Crypto.seal(active.key,active.id,"phone",seq,payload.toString());
        byte[] bytes=new JSONObject().put("session",active.id).put("seq",seq).put("nonce",enc.nonce).put("data",enc.data).toString().getBytes(StandardCharsets.UTF_8);
        HttpsURLConnection c=PhoneHttp.open(active.endpoint,active.token,bytes.length);connection=c;
        try{
            try(OutputStream out=c.getOutputStream()){out.write(bytes);}
            JSONObject frame=new JSONObject(new String(PhoneHttp.read(c),StandardCharsets.UTF_8));long received=frame.getLong("seq");
            if(!active.id.equals(frame.getString("session"))||received<=active.rx)throw new SecurityException("replay_or_wrong_session");
            JSONObject data=new JSONObject(Crypto.open(active.key,active.id,"desktop",received,frame.getString("nonce"),frame.getString("data")));active.rx=received;return data;
        }finally{connection=null;c.disconnect();}
    }
    private void stopNow(){if(active!=null)active.stop();stopSelf();}
    @Override public void onDestroy(){if(active!=null)active.stop();if(connection!=null)connection.disconnect();if(worker!=null)worker.interrupt();main.removeCallbacksAndMessages(null);unregisterReceiver(lock);getSystemService(NotificationManager.class).cancel(2);stopForeground(STOP_FOREGROUND_REMOVE);super.onDestroy();}
    @Override public IBinder onBind(Intent intent){return null;}
}
