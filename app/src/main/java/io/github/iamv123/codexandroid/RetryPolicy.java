package io.github.iamv123.codexandroid;

/** Reconnect with a fresh handshake; never resend an old transport frame. */
public final class RetryPolicy {
    private RetryPolicy(){}
    public static boolean recoverable(int status,boolean established){
        if(status==401||status==403)return established;
        return status==-1||status==200||status==404||status==408||status==409||status==425||status==429||status>=500;
    }
    public static long delayMillis(int failures){return Math.min(30000,1000L<<Math.min(5,Math.max(0,failures)));}
}
