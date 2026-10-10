package io.github.iamv123.codexandroid;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.app.KeyguardManager;
import android.app.NotificationManager;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.graphics.Color;
import android.os.Bundle;
import android.provider.Settings;
import android.view.View;
import android.view.WindowManager;
import android.widget.*;
import java.util.*;

public final class MainActivity extends Activity {
    private EditText pairing;
    private TextView state;
    private final Map<String,CheckBox> apps = new LinkedHashMap<>();
    private Spinner duration;
    private Session proposed;
    private ScrollView scroll;
    private static final int AUTHORIZE=42;
    private final android.os.Handler statusHandler=new android.os.Handler(android.os.Looper.getMainLooper());
    private final Runnable updateStatus=new Runnable(){@Override public void run(){refresh();statusHandler.postDelayed(this,1000);}};
    @Override public void onCreate(Bundle saved) {
        super.onCreate(saved);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
        getWindow().setHideOverlayWindows(true);
        scroll = new ScrollView(this);
        LinearLayout page = new LinearLayout(this); page.setOrientation(LinearLayout.VERTICAL); page.setPadding(32,40,32,40);
        scroll.addView(page); setContentView(scroll);
        text(page,"Codex 安卓助手",28);
        text(page,"Android 13+ · 测试版 0.1.5\n你勾选的应用可连续读取和操作，不再逐次确认。默认无应用授权。",16);
        state=text(page,"",16);
        button(page,"1. 开启通知",v->requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS},7));
        button(page,"2. 开启无障碍服务",v->startActivity(new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)));
        text(page,"3. 粘贴电脑网页上的配对码（或用系统相机扫码打开）",16);
        pairing=new EditText(this); pairing.setHint("codexandroid://pair?data=…"); pairing.setSingleLine(false); pairing.setSaveEnabled(false); pairing.setImportantForAutofill(View.IMPORTANT_FOR_AUTOFILL_NO_EXCLUDE_DESCENDANTS); page.addView(pairing);
        text(page,"4. 勾选本次允许使用的应用",20);
        text(page,"未勾选的应用不能读取或操作，返回和回桌面也会拒绝。系统权限设置、安装器和本应用不列入可选应用。更改勾选时先停止旧会话，再重新授权。",14);
        Intent launcher=new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER);
        List<ResolveInfo> list=getPackageManager().queryIntentActivities(launcher,PackageManager.ResolveInfoFlags.of(0));
        list.sort(Comparator.comparing(r->r.loadLabel(getPackageManager()).toString()));
        for(ResolveInfo r:list) {
            String pkg=r.activityInfo.packageName;
            if(Policy.protectedPackage(pkg)||apps.containsKey(pkg))continue;
            CheckBox box=new CheckBox(this); box.setText(getString(R.string.app_choice,r.loadLabel(getPackageManager()),pkg));box.setSaveEnabled(false);box.setFilterTouchesWhenObscured(true);
            if(Session.current!=null&&Session.current.live())box.setChecked(Session.current.grants.contains(pkg));
            box.setOnCheckedChangeListener((b,checked)-> {if(Session.current!=null){Session.current.stop();stopService(new Intent(this,BridgeService.class));refresh();}});
            apps.put(pkg,box);page.addView(box);
        }
        text(page,"授权时长",16);
        duration=new Spinner(this); duration.setAdapter(new ArrayAdapter<>(this,android.R.layout.simple_spinner_dropdown_item,new String[]{"10 分钟","30 分钟"}));page.addView(duration);
        text(page,"开启后，Codex 可在已勾选应用内直接点击、输入和滚动，不按页面关键词拦截。屏幕文字会发送到你的电脑及当前使用的 AI 服务；系统标记的密码或敏感文字不回传。锁屏或点通知中的停止即可撤销。",15);
        button(page,"5. 本机确认并开始",v->prepare());
        button(page,"立即停止并撤销",v->{if(Session.current!=null)Session.current.stop();stopService(new Intent(this,BridgeService.class));refresh();});
        readIntent(getIntent());
    }
    private TextView text(LinearLayout parent,String value,int size){TextView t=new TextView(this);t.setText(value);t.setTextSize(size);t.setTextColor(Color.rgb(18,60,53));t.setPadding(0,12,0,12);parent.addView(t);return t;}
    private void button(LinearLayout parent,String label,View.OnClickListener action){Button b=new Button(this);b.setText(label);b.setFilterTouchesWhenObscured(true);b.setOnClickListener(action);parent.addView(b);}
    @Override public void onNewIntent(Intent intent){super.onNewIntent(intent);setIntent(intent);readIntent(intent);}
    private void readIntent(Intent intent){if(intent.getData()!=null){pairing.setText(intent.getData().toString());intent.setData(null);}}
    @Override public void onResume(){super.onResume();statusHandler.removeCallbacks(updateStatus);updateStatus.run();}
    @Override public void onPause(){statusHandler.removeCallbacks(updateStatus);super.onPause();}
    private void refresh(){if(state!=null)state.setText(Session.lastStatus);}
    private void fail(String message){new AlertDialog.Builder(this).setTitle("未开始").setMessage(message).setPositiveButton("知道了",null).show();}
    private void prepare(){
        if(Session.current!=null){fail("请先停止当前会话。");return;}
        if(ControlService.instance==null){fail("请先在无障碍设置中启用 Codex 安卓助手。若系统提示受限设置，请按设备官方说明手动允许；本程序不能代为开启。");return;}
        if(!getSystemService(NotificationManager.class).areNotificationsEnabled()){fail("请先允许通知，以便查看连接和随时停止。");return;}
        KeyguardManager km=getSystemService(KeyguardManager.class);
        if(!km.isDeviceSecure()){fail("请先为手机设置锁屏密码，授权需要本机身份确认。");return;}
        try{
            Set<String> grants=new HashSet<>();apps.forEach((p,b)->{if(b.isChecked())grants.add(p);});
            proposed=Session.create(pairing.getText().toString(),grants,duration.getSelectedItemPosition()==0?10:30);
            new AlertDialog.Builder(this).setTitle("确认连接你的电脑").setMessage("连接地址：\n"+proposed.endpoint+"\n\n授权应用数："+grants.size()+"\n仅在你确认后开始。请核对地址与电脑网页一致。")
                .setNegativeButton("取消",(d,w)->{proposed.stop();proposed=null;})
                .setPositiveButton("验证身份并开始",(d,w)->startActivityForResult(km.createConfirmDeviceCredentialIntent("开启 Codex 手机会话","确认你在手机上勾选的应用和授权时限"),AUTHORIZE)).show();
        }catch(Exception e){fail(e.getMessage()==null?"配对码无效":e.getMessage());}
    }
    @Override protected void onActivityResult(int request,int result,Intent data){super.onActivityResult(request,result,data);if(request==AUTHORIZE&&proposed!=null){if(result==RESULT_OK){Session.current=proposed;proposed=null;Session.lastStatus="正在启动连接";pairing.setText("");try{startForegroundService(new Intent(this,BridgeService.class));}catch(RuntimeException e){Session.lastStatus="连接失败：系统未允许启动连接服务";Session.current.stop();fail(Session.lastStatus);}refresh();scroll.post(()->scroll.smoothScrollTo(0,0));}else{proposed.stop();proposed=null;}}}
}
