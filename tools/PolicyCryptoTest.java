package io.github.iamv123.codexandroid;

import java.util.Base64;
import java.util.Set;
public final class PolicyCryptoTest {
    public static void main(String[] args)throws Exception{
        if(args.length>0 && args[0].equals("decrypt")){
            byte[] master=Base64.getUrlDecoder().decode(args[1]);String id=args[2];
            System.out.print(Crypto.open(Crypto.derive(master,id,"encryption"),id,"desktop",1,args[3],args[4]));return;
        }
        int checks=0;
        Set<String> empty=Set.of(),selected=Set.of("com.tencent.mm","com.xingin.xhs","com.example.other","com.android.settings");
        for(String p: new String[]{"com.tencent.mm","com.xingin.xhs","com.example.other"}) {if(Policy.allowed(empty,p))throw new AssertionError("default grant");checks++;if(!Policy.allowed(selected,p))throw new AssertionError("selected app unavailable");checks++;}
        for(String p:new String[]{Policy.OWN,"com.android.settings","com.android.systemui","com.google.android.permissioncontroller","com.android.packageinstaller"}){if(Policy.allowed(Set.of(p),p))throw new AssertionError("protected surface");checks++;}
        for(String text:new String[]{"转账","验证码","Password","wallet","付款"}){if(!Policy.sensitive(text))throw new AssertionError("sensitive pattern");checks++;}
        for(int kind=0;kind<3;kind++){try{Policy.check(selected,kind==0?"com.unselected.app":"com.tencent.mm",kind!=1,kind!=2);throw new AssertionError("gate bypass");}catch(SecurityException expected){checks++;}}
        byte[] master=new byte[32];for(int i=0;i<32;i++)master[i]=(byte)i;
        String id="0123456789abcdef0123456789abcdef";byte[] key=Crypto.derive(master,id,"encryption");
        Crypto.Envelope e=Crypto.seal(key,id,"phone",1,"{\"message\":\"你好\"}");
        if(!Crypto.open(key,id,"phone",1,e.nonce,e.data).contains("你好"))throw new AssertionError("roundtrip");checks++;
        try{Crypto.open(key,id,"desktop",1,e.nonce,e.data);throw new AssertionError("direction");}catch(javax.crypto.AEADBadTagException expected){checks++;}
        System.out.println("policy_and_crypto_checks="+checks);
        System.out.println(Base64.getEncoder().encodeToString(key));System.out.println(e.nonce);System.out.println(e.data);
    }
}
