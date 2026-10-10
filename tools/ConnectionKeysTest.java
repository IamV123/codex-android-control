package io.github.iamv123.codexandroid;
import java.util.*;

public final class ConnectionKeysTest {
    public static void main(String[] args)throws Exception{
        byte[] master=new byte[32];for(int i=0;i<32;i++)master[i]=(byte)i;
        String pair="0123456789abcdef0123456789abcdef",client="11111111111111111111111111111111";
        ConnectionKeys first=new ConnectionKeys(master,pair,client),second=new ConnectionKeys(master,pair,"22222222222222222222222222222222");int checks=0;
        if(first.id.equals(second.id)||Arrays.equals(first.key,second.key)||first.token.equals(second.token))throw new AssertionError("connection key reuse");checks+=3;
        if(!Arrays.equals(first.pairKey,second.pairKey)||!first.pairToken.equals(second.pairToken))throw new AssertionError("pair credential drift");checks+=2;
        if(Arrays.equals(first.key,first.pairKey)||first.token.equals(first.pairToken))throw new AssertionError("bootstrap/transport collision");checks+=2;
        Set<String> ids=new HashSet<>();for(int i=0;i<20;i++){String id=ConnectionKeys.newClientId();if(!id.matches("[a-f0-9]{32}")||!ids.add(id))throw new AssertionError("client id");}checks++;
        for(String bad:new String[]{"",pair+"x","G".repeat(32)}){try{new ConnectionKeys(master,pair,bad);throw new AssertionError("invalid client");}catch(SecurityException expected){checks++;}}
        Crypto.Envelope connect=Crypto.seal(first.pairKey,pair,"phone-connect",1,"{\"event\":\"connect\",\"client\":\""+client+"\"}");
        Crypto.Envelope poll=Crypto.seal(first.key,first.id,"phone",1,"{\"message\":\"新连接\"}");
        String key=Base64.getEncoder().encodeToString(first.key),token=first.token;
        first.clear();if(!Arrays.equals(first.key,new byte[32])||!Arrays.equals(first.pairKey,new byte[32]))throw new AssertionError("key wipe");checks+=2;
        System.out.println("connection_key_checks="+checks);System.out.println(key);System.out.println(token);System.out.println(connect.nonce);System.out.println(connect.data);System.out.println(poll.nonce);System.out.println(poll.data);
    }
}
