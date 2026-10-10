package io.github.iamv123.codexandroid;

import android.app.Activity;
import android.app.KeyguardManager;
import android.content.Intent;
import android.os.Bundle;
import android.view.WindowManager;
import android.widget.*;

public final class ApprovalActivity extends Activity {
    private String request;
    @Override public void onCreate(Bundle saved){super.onCreate(saved);getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);getWindow().setHideOverlayWindows(true);
        request=getIntent().getStringExtra("request");Approval a=Approval.pending;
        if(a==null||!a.id.equals(request)){finishAndRemoveTask();return;}
        ScrollView scroll=new ScrollView(this);LinearLayout box=new LinearLayout(this);box.setOrientation(LinearLayout.VERTICAL);box.setPadding(32,48,32,32);scroll.addView(box);setContentView(scroll);
        TextView title=new TextView(this);title.setText("检查本次操作");title.setTextSize(26);box.addView(title);
        TextView detail=new TextView(this);detail.setText(getString(R.string.approval_detail,a.detail));detail.setTextSize(17);box.addView(detail);
        Button deny=new Button(this);deny.setText("拒绝");deny.setOnClickListener(v->{Approval.cancel("rejected_on_phone");finishAndRemoveTask();});box.addView(deny);
        Button approve=new Button(this);approve.setText("本机身份确认并执行");approve.setFilterTouchesWhenObscured(true);approve.setOnClickListener(v->{KeyguardManager km=getSystemService(KeyguardManager.class);Intent i=km.createConfirmDeviceCredentialIntent("确认本次 Codex 操作","请核对上一页的应用、目标和操作内容");if(i==null){Approval.cancel("device_credential_unavailable");finishAndRemoveTask();}else startActivityForResult(i,9);});box.addView(approve);
    }
    @Override protected void onActivityResult(int req,int res,Intent data){super.onActivityResult(req,res,data);if(req==9){if(res==RESULT_OK){finishAndRemoveTask();Approval.accept(request);}else{Approval.cancel("confirmation_cancelled");finishAndRemoveTask();}}}
}
