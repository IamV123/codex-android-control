package io.github.iamv123.codexandroid;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.app.KeyguardManager;
import android.app.NotificationManager;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.graphics.Color;
import android.graphics.Insets;
import android.os.Bundle;
import android.os.SystemClock;
import android.provider.Settings;
import android.text.Editable;
import android.text.InputFilter;
import android.text.TextWatcher;
import android.text.InputType;
import android.view.View;
import android.view.WindowManager;
import android.view.WindowInsets;
import android.widget.*;
import java.text.Collator;
import java.util.*;

public final class MainActivity extends Activity {
    private EditText pairing,search,durationValue;
    private TextView state,pageNumber,selectedCount;
    private Spinner durationUnit;
    private LinearLayout choices;
    private Button previous,next,start,stop;
    private final Set<String> selected=new HashSet<>();
    private final List<AppPage.Entry> allApps=new ArrayList<>();
    private int pageIndex;
    private Session proposed;
    private SharedPreferences preferences;
    private static final int AUTHORIZE=42;
    private final android.os.Handler statusHandler=new android.os.Handler(android.os.Looper.getMainLooper());
    private final Runnable updateStatus=new Runnable(){@Override public void run(){refresh();statusHandler.postDelayed(this,1000);}};
    @Override public void onCreate(Bundle saved){
        super.onCreate(saved);getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);getWindow().setHideOverlayWindows(true);
        preferences=getSharedPreferences("local_choices",MODE_PRIVATE);
        Session active=Session.current;if(active!=null&&active.live())selected.addAll(active.grants);else selected.addAll(preferences.getStringSet("apps",Set.of()));
        getWindow().setDecorFitsSystemWindows(false);
        LinearLayout root=new LinearLayout(this);root.setOrientation(LinearLayout.VERTICAL);root.setBackgroundColor(Color.rgb(237,244,240));
        root.setOnApplyWindowInsetsListener((view,insets)->{Insets bars=insets.getInsets(WindowInsets.Type.systemBars()|WindowInsets.Type.displayCutout()),keyboard=insets.getInsets(WindowInsets.Type.ime());view.setPadding(bars.left,bars.top,bars.right,Math.max(bars.bottom,keyboard.bottom));return insets;});
        ScrollView scroll=new ScrollView(this);LinearLayout page=new LinearLayout(this);page.setOrientation(LinearLayout.VERTICAL);page.setPadding(dp(20),dp(20),dp(20),dp(16));scroll.addView(page);
        root.addView(scroll,new LinearLayout.LayoutParams(-1,0,1));setContentView(root);root.requestApplyInsets();
        text(page,"Codex 安卓助手",27);text(page,"Android 13+ · 测试版 0.1.8\n仅允许你勾选的应用。电脑端运行期间断网会自动等待重连；电脑或电脑端程序重启后地址会变，需要用新配对码重新连接。",15);
        button(page,"开启通知",v->requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS},7));
        button(page,"开启无障碍服务",v->startActivity(new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)));
        text(page,"电脑配对码",19);
        pairing=new EditText(this);pairing.setHint("粘贴配对码，或用系统相机扫码");pairing.setSingleLine(false);pairing.setSaveEnabled(false);pairing.setImportantForAutofill(View.IMPORTANT_FOR_AUTOFILL_NO_EXCLUDE_DESCENDANTS);page.addView(pairing);
        text(page,"选择允许使用的应用",20);
        text(page,"更改勾选会停止当前授权。搜索或换页会保留你的勾选，不会增加或撤销授权。",14);
        search=new EditText(this);search.setHint("搜索应用名称，例如：抖音");search.setSingleLine(true);search.setInputType(InputType.TYPE_CLASS_TEXT);page.addView(search);
        selectedCount=text(page,"",14);choices=new LinearLayout(this);choices.setOrientation(LinearLayout.VERTICAL);page.addView(choices);
        LinearLayout navigation=new LinearLayout(this);navigation.setOrientation(LinearLayout.HORIZONTAL);page.addView(navigation);
        previous=button(navigation,"上一页",v->{pageIndex--;renderApps();});pageNumber=text(navigation,"",14);next=button(navigation,"下一页",v->{pageIndex++;renderApps();});
        Intent launcher=new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER);
        Set<String> seen=new HashSet<>();List<ResolveInfo> list=getPackageManager().queryIntentActivities(launcher,PackageManager.ResolveInfoFlags.of(0));
        for(ResolveInfo r:list){String pkg=r.activityInfo.packageName;if(!Policy.protectedPackage(pkg)&&seen.add(pkg))allApps.add(new AppPage.Entry(r.loadLabel(getPackageManager()).toString(),pkg));}
        Collator collator=Collator.getInstance();allApps.sort((a,b)->collator.compare(a.label(),b.label()));
        search.addTextChangedListener(new TextWatcher(){@Override public void beforeTextChanged(CharSequence s,int st,int count,int after){}@Override public void onTextChanged(CharSequence s,int st,int before,int count){pageIndex=0;renderApps();}@Override public void afterTextChanged(Editable e){}});renderApps();
        text(page,"本次授权时长（1分钟至30天）",19);
        LinearLayout timing=new LinearLayout(this);timing.setOrientation(LinearLayout.HORIZONTAL);page.addView(timing);
        durationValue=new EditText(this);durationValue.setInputType(InputType.TYPE_CLASS_NUMBER);durationValue.setFilters(new InputFilter[]{new InputFilter.LengthFilter(6)});durationValue.setText(preferences.getString("duration_value","30"));durationValue.setHint("时长");timing.addView(durationValue,new LinearLayout.LayoutParams(0,-2,1));
        durationUnit=new Spinner(this);durationUnit.setAdapter(new ArrayAdapter<>(this,android.R.layout.simple_spinner_dropdown_item,new String[]{"分钟","小时","天"}));durationUnit.setSelection(Math.max(0,Math.min(2,preferences.getInt("duration_unit",0))));timing.addView(durationUnit,new LinearLayout.LayoutParams(0,-2,1));
        text(page,"例如：输入7，选择“天”。授权不会因重连而延长，手机与电脑配对以先到期者为准。",14);
        text(page,"断网会等待重连；锁屏暂停操作，解锁后恢复。点停止、改勾选、停用无障碍或到期会撤销。程序不能解锁手机；手机重启或服务被系统结束后，需要本机重新授权。屏幕文字会发送到你的电脑及当前AI服务。",14);
        LinearLayout footer=new LinearLayout(this);footer.setOrientation(LinearLayout.VERTICAL);footer.setPadding(dp(16),dp(8),dp(16),dp(10));footer.setBackgroundColor(Color.WHITE);root.addView(footer,new LinearLayout.LayoutParams(-1,-2));
        state=text(footer,"",15);state.setPadding(0,0,0,dp(6));LinearLayout actions=new LinearLayout(this);actions.setOrientation(LinearLayout.HORIZONTAL);footer.addView(actions);
        start=button(actions,"确认并开始",v->prepare());stop=button(actions,"立即停止",v->stopLocal());start.setLayoutParams(new LinearLayout.LayoutParams(0,-2,1));stop.setLayoutParams(new LinearLayout.LayoutParams(0,-2,1));
        readIntent(getIntent());refresh();
    }
    private int dp(int n){return Math.round(n*getResources().getDisplayMetrics().density);}
    private TextView text(LinearLayout parent,String value,int size){TextView t=new TextView(this);t.setText(value);t.setTextSize(size);t.setTextColor(Color.rgb(18,60,53));t.setPadding(0,dp(8),0,dp(8));parent.addView(t);return t;}
    private Button button(LinearLayout parent,String label,View.OnClickListener action){Button b=new Button(this);b.setText(label);b.setMinHeight(dp(48));b.setFilterTouchesWhenObscured(true);b.setOnClickListener(action);parent.addView(b);return b;}
    private void renderApps(){
        AppPage.Page result=AppPage.filter(allApps,search.getText().toString(),pageIndex);pageIndex=result.index();choices.removeAllViews();
        for(AppPage.Entry app:result.entries()){
            CheckBox box=new CheckBox(this);box.setText(getString(R.string.app_choice,app.label(),app.pkg()));box.setTextSize(15);box.setSaveEnabled(false);box.setFilterTouchesWhenObscured(true);box.setChecked(selected.contains(app.pkg()));
            box.setOnCheckedChangeListener((b,checked)->{if(checked)selected.add(app.pkg());else selected.remove(app.pkg());selectedCount.setText(getString(R.string.selected_apps,selected.size()));if(Session.current!=null)stopLocal();});choices.addView(box);
        }
        if(result.matches()==0)text(choices,"没有找到该应用",15);
        pageNumber.setText(getString(R.string.page_counter,pageIndex+1,result.pages()));previous.setEnabled(pageIndex>0);next.setEnabled(pageIndex+1<result.pages());selectedCount.setText(getString(R.string.app_matches,selected.size(),result.matches()));
    }
    private void stopLocal(){if(Session.current!=null)Session.current.stop();stopService(new Intent(this,BridgeService.class));Session.lastStatus="已停止并撤销授权";refresh();Toast.makeText(this,"已停止并撤销授权",Toast.LENGTH_SHORT).show();}
    @Override public void onNewIntent(Intent intent){super.onNewIntent(intent);setIntent(intent);readIntent(intent);}
    private void readIntent(Intent intent){if(intent.getData()!=null){pairing.setText(intent.getData().toString());intent.setData(null);}}
    @Override public void onResume(){super.onResume();statusHandler.removeCallbacks(updateStatus);updateStatus.run();}
    @Override public void onPause(){statusHandler.removeCallbacks(updateStatus);super.onPause();}
    private void refresh(){
        Session active=Session.current;if(active!=null&&!active.live()){active.stop();stopService(new Intent(this,BridgeService.class));Session.lastStatus="授权已到期，已停止";active=null;}
        boolean live=active!=null&&active.live();if(state!=null)state.setText(live?getString(R.string.session_remaining,Session.lastStatus,Duration.remaining((active.expires-SystemClock.elapsedRealtime())/1000)):Session.lastStatus);if(start!=null)start.setEnabled(!live);if(stop!=null)stop.setEnabled(live);
    }
    private void fail(String message){new AlertDialog.Builder(this).setTitle("未开始").setMessage(message).setPositiveButton("知道了",null).show();}
    private void prepare(){
        if(Session.current!=null){fail("请先停止当前会话。");return;}
        if(ControlService.instance==null){fail("请先在无障碍设置中启用Codex安卓助手。若系统提示受限设置，请按设备官方说明手动允许。");return;}
        if(!getSystemService(NotificationManager.class).areNotificationsEnabled()){fail("请先允许通知，以便查看连接和随时停止。");return;}
        KeyguardManager km=getSystemService(KeyguardManager.class);if(!km.isDeviceSecure()){fail("请先设置锁屏密码，授权需要本机身份确认。");return;}
        try{
            if(selected.isEmpty()||selected.size()>500)throw new IllegalArgumentException("请勾选1至500个允许使用的应用");
            proposed=Session.create(pairing.getText().toString(),selected,Duration.minutes(durationValue.getText().toString(),durationUnit.getSelectedItemPosition()));
            new AlertDialog.Builder(this).setTitle("确认连接你的电脑").setMessage("连接地址：\n"+proposed.endpoint+"\n\n授权应用数："+selected.size()+"\n有效时长："+Duration.remaining((proposed.expires-SystemClock.elapsedRealtime())/1000)+"\n\n电脑或电脑端程序重启后地址会变，需用新配对码重新连接。请核对地址与电脑网页一致。")
                .setNegativeButton("取消",(d,w)->{proposed.stop();proposed=null;})
                .setPositiveButton("验证身份并开始",(d,w)->startActivityForResult(km.createConfirmDeviceCredentialIntent("开启Codex手机会话","确认你勾选的应用和授权时限"),AUTHORIZE)).show();
        }catch(Exception e){if(proposed!=null){proposed.stop();proposed=null;}fail(e.getMessage()==null?"配对码无效":e.getMessage());}
    }
    @Override protected void onActivityResult(int request,int result,Intent data){
        super.onActivityResult(request,result,data);if(request==AUTHORIZE&&proposed!=null){
            if(result==RESULT_OK){Session.current=proposed;proposed=null;preferences.edit().putStringSet("apps",new HashSet<>(selected)).putString("duration_value",durationValue.getText().toString()).putInt("duration_unit",durationUnit.getSelectedItemPosition()).apply();Session.lastStatus="正在启动连接";
                try{startForegroundService(new Intent(this,BridgeService.class));}catch(RuntimeException e){Session.lastStatus="连接失败：系统未允许启动连接服务";Session.current.stop();fail(Session.lastStatus);}refresh();
            }else{proposed.stop();proposed=null;}
        }
    }
}
