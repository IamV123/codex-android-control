package io.github.iamv123.codexandroid;
import java.util.Base64;

/** Synthetic v3 vectors only; no device or production credentials. */
public final class RecoveryCryptoTest {
    public static void main(String[] args)throws Exception{
        if(args.length>0){byte[] master=Base64.getUrlDecoder().decode(args[0]);String id=args[1],direction=args[2];System.out.println(Crypto.open(Crypto.derive(master,id,"encryption"),id,direction,1,args[3],args[4]));return;}
        byte[] master=new byte[32];for(int i=0;i<32;i++)master[i]=(byte)i;
        String pair="0123456789abcdef0123456789abcdef",client="11111111111111111111111111111111";
        byte[] key=Crypto.derive(master,pair,"encryption");
        Crypto.Envelope challenge=Crypto.seal(key,pair,"phone-challenge",1,"{\"event\":\"challenge\",\"protocol\":3,\"client\":\""+client+"\"}");
        System.out.println(challenge.nonce);System.out.println(challenge.data);
        Crypto.Envelope connect=Crypto.seal(key,pair,"phone-connect",1,"{\"event\":\"connect\",\"protocol\":3,\"client\":\""+client+"\",\"challenge\":\""+"a".repeat(43)+"\"}");
        System.out.println(connect.nonce);System.out.println(connect.data);
    }
}
