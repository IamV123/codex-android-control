package io.github.iamv123.codexandroid;

/** One finger stroke inside an already validated, visible app node. */
public record SwipePlan(float startX,float startY,float endX,float endY) {
    public static SwipePlan create(int left,int top,int right,int bottom,String direction) {
        long width=(long)right-left,height=(long)bottom-top;
        if(width<48 || height<48)throw new IllegalArgumentException("swipe_area_too_small");
        float cx=left+width*.5f,cy=top+height*.5f;
        float x1=left+width*.22f,x2=left+width*.78f;
        float y1=top+height*.22f,y2=top+height*.78f;
        return switch(direction){
            case "up" -> new SwipePlan(cx,y2,cx,y1);
            case "down" -> new SwipePlan(cx,y1,cx,y2);
            case "left" -> new SwipePlan(x2,cy,x1,cy);
            case "right" -> new SwipePlan(x1,cy,x2,cy);
            default -> throw new IllegalArgumentException("invalid_swipe_direction");
        };
    }
}
