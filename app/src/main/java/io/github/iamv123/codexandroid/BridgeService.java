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
    private Notification.Builder sessionNote;
    private boolean connected;
    private final Handler main=new Handler(Looper.getMainLooper());
    private final BroadcastReceiver screen=new BroadcastReceiver(){@Override public void onReceive(Context c,Intent i){if(active!=null&&active.live())showState(connected?"已连接电脑":"等待电脑恢复连接");}};
    @Override public void onCreate(){super.onCreate();IntentFilter filter=new IntentFilter(Intent.ACTION_SCREEN_OFF);filter.addAction(Intent.ACTION_USER_PRESENT);registerReceiver(screen,filter,Context.RECEIVER_NOT_EXPORTED);}
    @Override public int onStartCommand(Intent intent,int flags,int startId){
        if(intent!=null&&"STOP".equals(intent.getAction())){stopNow();return START_NOT_STICKY;}
        if(worker!=null)return START_NOT_STICKY;active=Session.current;
        if(active==null||!active.live()){stopSelf();return START_NOT_STICKY;}
        NotificationManager nm=getSystemService(NotificationManager.class);nm.createNotificationChannel(new NotificationChannel("session","远程授权（可随时停止）",NotificationManager.IMPORTANCE_LOW));
        PendingIntent stop=PendingIntent.getService(this,1,new Intent(this,BridgeService.class).setAction("STOP"),PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
        PendingIntent open=PendingIntent.getActivity(this,0,new Intent(this,MainActivity.class),PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
        nm.cancel(2);nm.cancel(3);Session.lastStatus="正在连接电脑";
        sessionNote=new Notification.Builder(this,"session").setSmallIcon(R.drawable.ic_app).setContentTitle("Codex 手机正在连接").setContentText("仅限勾选应用 · 断线等待重连 · 锁屏暂停操作").setContentIntent(open).addAction(new Notification.Action.Builder(null,"立即停止",stop).build()).setOngoing(true).setOnlyAlertOnce(true).setVisibility(Notification.VISIBILITY_PUBLIC);
        try{startForeground(1,sessionNote.build());}catch(RuntimeException e){reportFailure(e);stopNow();return START_NOT_STICKY;}
        worker=new Thread(this::loop,"codex-phone-channel");worker.start();
        main.post(new Runnable(){@Override public void run(){if(active==null||!active.live()||ControlService.instance==null){stopNow();return;}main.postDelayed(this,1000);}});
        return START_NOT_STICKY;
    }
    private void showState(String value){
        if(Looper.myLooper()!=Looper.getMainLooper()){main.post(()->showState(value));return;}
        if(active==null||!active.live())return;
        String detail=!active.unlocked(this)?"；手机锁屏，暂停操作":active.recoveryRequired?"；上次操作未确认，电脑已暂停发送操作":"；可在已授权应用内操作";
        Session.lastStatus=value+detail;
        getSystemService(NotificationManager.class).notify(1,sessionNote.setContentTitle("Codex · "+value).setContentText("剩余 "+Duration.remaining((active.expires-SystemClock.elapsedRealtime())/1000)+" · 可随时停止").build());
    }
    private void loop(){
        JSONObject response=null,lastReceipt=null;int failures=0;boolean established=false;
        try{
            while(active.live()){
                try{
                    if(!established){connect(lastReceipt);established=true;connected=true;failures=0;response=null;showState("已连接电脑");}
                    JSONObject payload=new JSONObject().put("event",response==null?"poll":"result").put("phone",phoneStatus());if(response!=null)payload.put("response",response);
                    JSONObject returned=exchange(payload);response=null;failures=0;active.recoveryRequired=returned.optBoolean("recoveryRequired",false);showState("已连接电脑");
                    JSONObject command=returned.optJSONObject("command");if(command==null)continue;
                    String id=command.getString("id");response=new JSONObject().put("id",id);
                    if(lastReceipt!=null&&id.equals(lastReceipt.optString("id"))){response=lastReceipt;continue;}
                    try{
                        ControlService control=ControlService.instance;if(control==null)throw new SecurityException("accessibility_disabled");
                        JSONObject result=control.execute(command.getString("tool"),command.getJSONObject("args")).get(62000,TimeUnit.MILLISECONDS);response.put("ok",true).put("data",result);
                    }catch(Exception e){Throwable cause=e.getCause()==null?e:e.getCause();response.put("ok",false).put("error",cause.getMessage()==null?"operation_rejected":cause.getMessage());}
                    lastReceipt=response;
                }catch(IOException e){
                    int status=e instanceof PhoneHttp.HttpFailure?((PhoneHttp.HttpFailure)e).status:-1;
                    if(!RetryPolicy.recoverable(status,established))throw e;
                    // A possibly delivered frame is abandoned. Only its receipt
                    // may be included in a fresh handshake; no action is replayed.
                    established=false;connected=false;failures++;showState("网络中断，等待电脑恢复连接");
                    Thread.sleep(RetryPolicy.delayMillis(failures));
                }
            }
        }catch(InterruptedException e){Thread.currentThread().interrupt();}
        catch(Exception e){reportFailure(e);}finally{main.post(this::stopNow);}
    }
    private JSONObject phoneStatus()throws Exception{return active.status().put("locked",!active.unlocked(this));}
    private void reportFailure(Exception error){
        if(active==null||!active.live())return;Session.lastStatus="连接失败："+PhoneHttp.describe(error);
        NotificationManager nm=getSystemService(NotificationManager.class);nm.createNotificationChannel(new NotificationChannel("connection_errors","连接问题",NotificationManager.IMPORTANCE_DEFAULT));
        PendingIntent open=PendingIntent.getActivity(this,0,new Intent(this,MainActivity.class),PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
        nm.notify(3,new Notification.Builder(this,"connection_errors").setSmallIcon(R.drawable.ic_app).setContentTitle("Codex 连接已停止").setContentText(Session.lastStatus).setStyle(new Notification.BigTextStyle().bigText(Session.lastStatus)).setContentIntent(open).setAutoCancel(true).setVisibility(Notification.VISIBILITY_PRIVATE).build());
    }
    private JSONObject request(String path,String token,Crypto.Envelope enc,String id,long seq)throws Exception{
        byte[] bytes=new JSONObject().put("session",id).put("seq",seq).put("nonce",enc.nonce).put("data",enc.data).toString().getBytes(StandardCharsets.UTF_8);
        HttpsURLConnection c=PhoneHttp.open(active.endpoint,path,token,bytes.length);connection=c;
        // Keep-alive: PhoneHttp.read fully consumes the stream, so a successful
        // exchange returns the pooled connection for the next long-poll. Only a
        // failed request discards it.
        try{try(OutputStream out=c.getOutputStream()){out.write(bytes);}return new JSONObject(new String(PhoneHttp.read(c),StandardCharsets.UTF_8));}
        catch(Exception e){c.disconnect();throw e;}
        finally{connection=null;}
    }
    private JSONObject exchange(JSONObject payload)throws Exception{
        ConnectionKeys keys=active.connection;long seq=++active.tx;
        JSONObject frame=request("/phone/v3/exchange",keys.token,Crypto.seal(keys.key,keys.id,"phone",seq,payload.toString()),keys.id,seq);long received=frame.getLong("seq");
        if(!keys.id.equals(frame.getString("session"))||received<=active.rx)throw new SecurityException("replay_or_wrong_session");
        JSONObject data=new JSONObject(Crypto.open(keys.key,keys.id,"desktop",received,frame.getString("nonce"),frame.getString("data")));active.rx=received;return data;
    }
    private void connect(JSONObject receipt)throws Exception{
        ConnectionKeys keys=active.nextConnection();
        JSONObject request=new JSONObject().put("event","challenge").put("protocol",3).put("client",keys.clientId);
        JSONObject challengeFrame=request("/phone/v3/challenge",active.pairToken,Crypto.seal(active.pairKey,active.pairId,"phone-challenge",1,request.toString()),active.pairId,1);
        if(!keys.id.equals(challengeFrame.getString("session"))||challengeFrame.getLong("seq")!=1)throw new SecurityException("invalid_challenge_response");
        JSONObject challenge=new JSONObject(Crypto.open(keys.key,keys.id,"desktop-challenge",1,challengeFrame.getString("nonce"),challengeFrame.getString("data")));
        if(!"challenge".equals(challenge.optString("event"))||!keys.clientId.equals(challenge.optString("client"))||!challenge.getString("challenge").matches("[A-Za-z0-9_-]{43}"))throw new SecurityException("invalid_challenge_response");
        JSONObject payload=new JSONObject().put("event","connect").put("protocol",3).put("client",keys.clientId).put("challenge",challenge.getString("challenge")).put("phone",phoneStatus());if(receipt!=null)payload.put("receipt",receipt);
        JSONObject frame=request("/phone/v3/connect",active.pairToken,Crypto.seal(active.pairKey,active.pairId,"phone-connect",1,payload.toString()),active.pairId,1);
        if(!keys.id.equals(frame.getString("session"))||frame.getLong("seq")!=1)throw new SecurityException("invalid_connect_response");
        JSONObject result=new JSONObject(Crypto.open(keys.key,keys.id,"desktop",1,frame.getString("nonce"),frame.getString("data")));
        if(!"connected".equals(result.optString("event"))||!keys.clientId.equals(result.optString("client")))throw new SecurityException("invalid_connect_response");
        active.rx=1;active.recoveryRequired=result.optBoolean("recoveryRequired",false);
    }
    private void stopNow(){if(active!=null)active.stop();stopSelf();}
    @Override public void onDestroy(){if(active!=null)active.stop();if(connection!=null)connection.disconnect();if(worker!=null)worker.interrupt();main.removeCallbacksAndMessages(null);unregisterReceiver(screen);getSystemService(NotificationManager.class).cancel(2);stopForeground(STOP_FOREGROUND_REMOVE);super.onDestroy();}
    @Override public IBinder onBind(Intent intent){return null;}
}
