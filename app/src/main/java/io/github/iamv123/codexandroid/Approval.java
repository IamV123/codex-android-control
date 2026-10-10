package io.github.iamv123.codexandroid;

import android.app.Notification;
import android.app.Application;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Handler;
import android.os.Looper;
import org.json.JSONObject;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;

final class Approval {
    static volatile Approval pending;
    final String id=UUID.randomUUID().toString(),detail;
    final CompletableFuture<JSONObject> result;
    final Runnable execute;
    final Application app;
    private Approval(Context c,String d,CompletableFuture<JSONObject> r,Runnable e){app=(Application)c.getApplicationContext();detail=d;result=r;execute=e;}
    static synchronized void request(Context ctx,String detail,CompletableFuture<JSONObject> result,Runnable execute){
        if(pending!=null)throw new SecurityException("confirmation_pending");
        Approval a=new Approval(ctx,detail,result,execute);pending=a;
        NotificationManager nm=ctx.getSystemService(NotificationManager.class);
        nm.createNotificationChannel(new NotificationChannel("approval","操作确认",NotificationManager.IMPORTANCE_HIGH));
        Intent intent=new Intent(ctx,ApprovalActivity.class).putExtra("request",a.id).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        PendingIntent pi=PendingIntent.getActivity(ctx,2,intent,PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
        nm.notify(2,new Notification.Builder(ctx,"approval").setSmallIcon(io.github.iamv123.codexandroid.R.drawable.ic_app).setContentTitle("Codex 请求操作，请在手机确认").setContentText("点击查看具体操作；55 秒后自动拒绝").setContentIntent(pi).setAutoCancel(true).setVisibility(Notification.VISIBILITY_SECRET).build());
        new Handler(Looper.getMainLooper()).postDelayed(()->{synchronized(Approval.class){if(pending==a)cancel("phone_confirmation_timeout");}},55000);
    }
    static synchronized void cancel(String reason){Approval a=pending;pending=null;if(a!=null){a.app.getSystemService(NotificationManager.class).cancel(2);a.result.completeExceptionally(new SecurityException(reason));}}
    static synchronized void accept(String id){Approval a=pending;if(a==null||!a.id.equals(id))return;pending=null;a.app.getSystemService(NotificationManager.class).cancel(2);a.execute.run();}
}
