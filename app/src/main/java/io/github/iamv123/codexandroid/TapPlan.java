package io.github.iamv123.codexandroid;

/** One finger tap in the visible part of an already validated app target. */
public record TapPlan(float x,float y) {
    public static TapPlan create(int left,int top,int right,int bottom) {
        long width=(long)right-left,height=(long)bottom-top;
        if(width<4 || height<4)throw new IllegalArgumentException("tap_area_too_small");
        return new TapPlan(left+width*.5f,top+height*.5f);
    }
}
