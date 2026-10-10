package io.github.iamv123.codexandroid;

import javax.net.ssl.HttpsURLConnection;
import javax.net.ssl.SSLException;
import java.io.*;
import java.net.*;
import java.util.Locale;

/** Shared by Android and the JVM network smoke test; never logs credentials. */
final class PhoneHttp {
    static final String USER_AGENT="CodexAndroidControl/0.1.6";
    static HttpsURLConnection open(String endpoint,String token,int length)throws IOException{
        return open(endpoint,"/phone/v2/exchange",token,length);
    }
    static HttpsURLConnection open(String endpoint,String path,String token,int length)throws IOException{
        if(!path.equals("/phone/v2/connect")&&!path.equals("/phone/v2/exchange"))throw new IOException("invalid_phone_path");
        HttpsURLConnection c=(HttpsURLConnection)new URL(endpoint+path).openConnection();
        c.setInstanceFollowRedirects(false);c.setConnectTimeout(10000);c.setReadTimeout(25000);
        c.setRequestMethod("POST");c.setDoOutput(true);
        c.setRequestProperty("User-Agent",USER_AGENT);
        c.setRequestProperty("Accept","application/json");
        c.setRequestProperty("Content-Type","application/json");
        c.setRequestProperty("Authorization","Bearer "+token);c.setFixedLengthStreamingMode(length);
        return c;
    }
    static byte[] read(HttpsURLConnection c)throws IOException{
        int status=c.getResponseCode();
        if(status!=200)throw new HttpFailure(status);
        String type=c.getContentType();
        if(type==null||!type.toLowerCase(Locale.ROOT).startsWith("application/json"))throw new HttpFailure(200);
        ByteArrayOutputStream out=new ByteArrayOutputStream();byte[] block=new byte[8192];int n;
        try(InputStream in=c.getInputStream()){while((n=in.read(block))!=-1){if(out.size()+n>360000)throw new IOException("response_too_large");out.write(block,0,n);}}
        return out.toByteArray();
    }
    static final class HttpFailure extends IOException {
        final int status;
        HttpFailure(int status){super("http_"+status);this.status=status;}
    }
    static String describe(Exception e){
        if(e instanceof HttpFailure){int code=((HttpFailure)e).status;
            if(code==401||code==403)return "配对已失效，请在电脑重新配对后复制新配对码";
            if(code==409)return "电脑仍有操作待确认，或连接已被替换；请让 Codex 检查状态后再开始";
            if(code==511||code==200)return "中继返回了网页，请使用新版助手或检查连接入口";
            return "服务器连接失败（HTTP "+code+"），请重新配对";
        }
        if(e instanceof UnknownHostException)return "手机无法解析连接地址，请检查手机网络";
        if(e instanceof SocketTimeoutException)return "连接超时，请检查手机网络并重新配对";
        if(e instanceof SSLException)return "手机无法建立安全连接，请检查网络和系统时间";
        if(e instanceof IOException)return "网络连接中断，请重新配对";
        return "连接或数据验证失败，请重新配对";
    }
}
