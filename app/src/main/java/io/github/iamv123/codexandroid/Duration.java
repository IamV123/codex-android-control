package io.github.iamv123.codexandroid;

/** Shared duration rules for the UI and a locally authorized session. */
public final class Duration {
    public static final long MAX_MINUTES=30L*24*60;
    private Duration(){}
    public static long minutes(String value,int unit){
        if(value==null||!value.matches("[0-9]{1,6}")||unit<0||unit>2)throw new IllegalArgumentException("时长请输入整数，并选择分钟、小时或天");
        long number=Long.parseLong(value),result=number*(unit==0?1:unit==1?60:1440);
        if(result<1||result>MAX_MINUTES)throw new IllegalArgumentException("授权时长范围为1分钟至30天");
        return result;
    }
    public static String remaining(long seconds){
        if(seconds<60)return Math.max(0,seconds)+" 秒";
        long minutes=seconds/60;if(minutes<60)return minutes+" 分钟";
        long hours=minutes/60;if(hours<24)return hours+" 小时 "+(minutes%60)+" 分钟";
        return (hours/24)+" 天 "+(hours%24)+" 小时";
    }
}
