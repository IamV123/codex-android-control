package io.github.iamv123.codexandroid;

/** Coordinates belong to one captured display and are never supplied as screen pixels. */
public record ScreenshotPlan(int screenWidth,int screenHeight,int width,int height) {
    public ScreenshotPlan {
        if(screenWidth<1||screenHeight<1||width<1||height<1||width>540)
            throw new SecurityException("invalid_screenshot_size");
    }
    public record Point(float x,float y) {}
    public Point point(double x,double y,int left,int top,int right,int bottom){
        if(!Double.isFinite(x)||!Double.isFinite(y)||x!=Math.rint(x)||y!=Math.rint(y)||x<0||y<0||x>=width||y>=height)
            throw new SecurityException("invalid_screenshot_coordinates");
        // Target the centre of this screenshot pixel, preserving the independently rounded axes.
        float sx=(float)((x+0.5)*screenWidth/width),sy=(float)((y+0.5)*screenHeight/height);
        if(sx<left||sx>=right||sy<top||sy>=bottom)
            throw new SecurityException("point_outside_authorized_window");
        return new Point(sx,sy);
    }
    public static boolean fitsPayload(int imageJsonBytes,int phoneStatusBytes){
        // Reserve space for both an exchange response and the larger reconnect receipt.
        long encrypted=(long)imageJsonBytes+phoneStatusBytes+4096+16;
        return imageJsonBytes>0&&phoneStatusBytes>=0&&encrypted<=260000&&4*((encrypted+2)/3)+512<=360000;
    }
}
