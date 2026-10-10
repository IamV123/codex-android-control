package io.github.iamv123.codexandroid;

public final class ScreenshotPlanTest {
    private static int checks;
    private static void check(boolean ok){if(!ok)throw new AssertionError();checks++;}
    private static void rejects(Runnable task,String code){try{task.run();throw new AssertionError("accepted: "+code);}catch(SecurityException e){check(e.getMessage().equals(code));}}
    public static void main(String[] args){
        ScreenshotPlan p=new ScreenshotPlan(1080,2400,540,1200);
        check(p.point(100,100,0,0,1080,2400).equals(new ScreenshotPlan.Point(201,201)));
        check(p.point(539,1199,0,0,1080,2400).equals(new ScreenshotPlan.Point(1079,2399)));
        for(double[] point:new double[][]{{-1,0},{0,-1},{540,1},{1,1200},{1.5,2},{Double.NaN,2},{1,Double.POSITIVE_INFINITY}})
            rejects(()->p.point(point[0],point[1],0,0,1080,2400),"invalid_screenshot_coordinates");
        rejects(()->p.point(0,0,0,80,1080,2300),"point_outside_authorized_window");
        rejects(()->p.point(539,1199,0,80,1080,2300),"point_outside_authorized_window");
        ScreenshotPlan rounded=new ScreenshotPlan(1440,3121,405,878);
        check(Math.abs(rounded.point(200,400,0,0,1440,3121).y()-400.5*3121/878)<0.001);
        rejects(()->new ScreenshotPlan(1080,2400,541,1200),"invalid_screenshot_size");
        check(ScreenshotPlan.fitsPayload(200000,1000));
        check(!ScreenshotPlan.fitsPayload(259000,1000));
        check(!ScreenshotPlan.fitsPayload(200000,60000));
        check(ScreenshotPlan.fitsPayload(130000,125500));
        check(!ScreenshotPlan.fitsPayload(Integer.MAX_VALUE,Integer.MAX_VALUE));
        check(!ScreenshotPlan.fitsPayload(-1,0));
        System.out.println("screenshot_plan_checks="+checks);
    }
}
