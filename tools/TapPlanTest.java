package io.github.iamv123.codexandroid;

public final class TapPlanTest {
    private static int checks;
    private static void check(boolean condition,String detail){if(!condition)throw new AssertionError(detail);checks++;}
    private static void reject(Runnable action,String detail){try{action.run();throw new AssertionError(detail);}catch(IllegalArgumentException expected){checks++;}}
    public static void main(String[] args){
        TapPlan p=TapPlan.create(0,0,100,80);
        check(p.x()==50,"horizontal center");check(p.y()==40,"vertical center");
        TapPlan visible=TapPlan.create(330,1974,903,2022);
        check(visible.x()==616.5f,"use target horizontal offset");
        check(visible.y()==1998 && visible.y()<2022,"tap visible title above overlapping footer");
        TapPlan negative=TapPlan.create(-20,-40,20,40);
        check(negative.x()==0 && negative.y()==0,"negative window offset");
        TapPlan wide=TapPlan.create(Integer.MIN_VALUE,0,Integer.MAX_VALUE,80);
        check(Float.isFinite(wide.x()),"width subtraction does not overflow");
        reject(()->TapPlan.create(0,0,3,80),"narrow area");
        reject(()->TapPlan.create(0,0,80,3),"short area");
        reject(()->TapPlan.create(100,100,0,0),"inverted area");
        reject(()->TapPlan.create(0,0,0,80),"empty area");
        System.out.println("tap_plan_checks="+checks);
    }
}
