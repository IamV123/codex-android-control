package io.github.iamv123.codexandroid;

import java.io.*;
import java.nio.charset.StandardCharsets;
import javax.net.ssl.HttpsURLConnection;

/** Explicit network smoke test. Secrets are supplied on stdin, never argv/logs. */
public final class PhoneHttpProbe {
    public static void main(String[] args)throws Exception{
        BufferedReader in=new BufferedReader(new InputStreamReader(System.in,StandardCharsets.UTF_8));
        String endpoint=in.readLine(),path=in.readLine(),token=in.readLine();
        byte[] body=in.readLine().getBytes(StandardCharsets.UTF_8);
        HttpsURLConnection connection=PhoneHttp.open(endpoint,path,token,body.length);
        try{
            try(OutputStream out=connection.getOutputStream()){out.write(body);}
            System.out.write(PhoneHttp.read(connection));
        }catch(PhoneHttp.HttpFailure e){System.err.println("HTTP "+e.status);System.exit(2);}
        catch(Exception e){System.err.println(e.getClass().getSimpleName());System.exit(3);}
        finally{connection.disconnect();}
    }
}
