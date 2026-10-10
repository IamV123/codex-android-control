package io.github.iamv123.codexandroid;

public final class SwipePlanTest {
    private static int checks;
    private static void check(boolean condition,String detail){if(!condition)throw new AssertionError(detail);checks++;}
    private static void reject(Runnable action,String detail){try{action.run();throw new AssertionError(detail);}catch(IllegalArgumentException expected){checks++;}}
    public static void main(String[] args){
        for(String direction:new String[]{"up","down","left","right"}){
            SwipePlan p=SwipePlan.create(10,100,410,900,direction);
            check(p.startX()>10 && p.startX()<410 && p.endX()>10 && p.endX()<410,"horizontal bounds "+direction);
            check(p.startY()>100 && p.startY()<900 && p.endY()>100 && p.endY()<900,"vertical bounds "+direction);
            switch(direction){
                case "up" -> check(p.startY()>p.endY() && p.startX()==p.endX(),"finger moves upward");
                case "down" -> check(p.startY()<p.endY() && p.startX()==p.endX(),"finger moves downward");
                case "left" -> check(p.startX()>p.endX() && p.startY()==p.endY(),"finger moves left");
                case "right" -> check(p.startX()<p.endX() && p.startY()==p.endY(),"finger moves right");
            }
        }
        SwipePlan offset=SwipePlan.create(300,500,348,548,"up");
        check(offset.startX()==324 && offset.endX()==324,"use actual node offset");
        reject(()->SwipePlan.create(0,0,47,100,"up"),"reject narrow region");
        reject(()->SwipePlan.create(0,0,100,47,"up"),"reject short region");
        reject(()->SwipePlan.create(100,100,0,0,"up"),"reject inverted region");
        reject(()->SwipePlan.create(0,0,100,100,"forward"),"native scroll direction is not a touch direction");
        System.out.println("swipe_plan_checks="+checks);
    }
}
