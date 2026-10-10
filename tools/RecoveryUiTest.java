package io.github.iamv123.codexandroid;
import java.util.*;

public final class RecoveryUiTest {
    private static int checks;
    private static void check(boolean value){if(!value)throw new AssertionError("check "+checks);checks++;}
    private static void invalid(String value,int unit){try{Duration.minutes(value,unit);throw new AssertionError("accepted duration");}catch(IllegalArgumentException expected){checks++;}}
    public static void main(String[] args){
        check(Duration.minutes("7",2)==10080);check(Duration.minutes("2",1)==120);check(Duration.minutes("1",0)==1);check(Duration.minutes("30",2)==43200);
        for(String value:new String[]{"","0","-1","1.5","7天","9999999"," 7"})invalid(value,2);invalid("31",2);invalid("721",1);invalid("43201",0);invalid("1",3);
        List<AppPage.Entry> all=new ArrayList<>();for(int i=0;i<23;i++)all.add(new AppPage.Entry("应用"+i,"com.example.app"+i));all.add(new AppPage.Entry("抖音","com.ss.android.ugc.aweme"));
        AppPage.Page page=AppPage.filter(all,"",0);check(page.entries().size()==10&&page.pages()==3&&page.matches()==24);
        check(AppPage.filter(all,"",1).entries().get(0).label().equals("应用10"));check(AppPage.filter(all,"",2).entries().size()==4);check(AppPage.filter(all,"",99).index()==2);check(AppPage.filter(all,"",-3).index()==0);
        check(AppPage.filter(all," 抖音 ",0).entries().size()==1);check(AppPage.filter(all,"UGC.AWEME",0).entries().get(0).label().equals("抖音"));check(AppPage.filter(all,"没有的应用",3).entries().isEmpty());check(all.size()==24);
        List<AppPage.Entry> apps26=new ArrayList<>();for(int i=0;i<26;i++)apps26.add(new AppPage.Entry("应用"+i,"com.example.app"+i));
        Set<String> picked=new HashSet<>(Arrays.asList("com.example.app0","com.example.app1","com.example.app25"));
        AppPage.Page chosen=AppPage.filter(apps26,"",0,e->picked.contains(e.pkg()));check(chosen.pages()==1&&chosen.entries().size()==3&&chosen.matches()==3);
        AppPage.Page rest=AppPage.filter(apps26,"",0,e->!picked.contains(e.pkg()));check(rest.matches()==23&&rest.pages()==3);
        AppPage.Page last=AppPage.filter(apps26,"",2,e->!picked.contains(e.pkg()));check(last.entries().size()==3&&last.entries().stream().noneMatch(e->picked.contains(e.pkg())));
        check(AppPage.filter(apps26,"应用25",0,e->!picked.contains(e.pkg())).matches()==0);
        check(AppPage.filter(apps26,"应用25",0,e->picked.contains(e.pkg())).entries().get(0).pkg().equals("com.example.app25"));
        check(AppPage.filter(apps26,"",99,e->!picked.contains(e.pkg())).index()==2);check(AppPage.filter(apps26,"应用2",0,e->!picked.contains(e.pkg())).matches()==6);
        check(RetryPolicy.recoverable(-1,false));check(RetryPolicy.recoverable(503,false));check(RetryPolicy.recoverable(401,true));check(!RetryPolicy.recoverable(401,false));check(!RetryPolicy.recoverable(400,true));check(!RetryPolicy.recoverable(302,true));check(RetryPolicy.recoverable(409,false));
        check(RetryPolicy.delayMillis(1)==2000);check(RetryPolicy.delayMillis(100)==30000);
        System.out.println("Duration, application paging and reconnection policy: "+checks+" checks passed.");
    }
}
