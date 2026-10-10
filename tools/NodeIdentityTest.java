package io.github.iamv123.codexandroid;

public final class NodeIdentityTest {
    private static int checks;
    private static void check(boolean condition,String detail){if(!condition)throw new AssertionError(detail);checks++;}
    public static void main(String[] args){
        NodeIdentity field=new NodeIdentity("selected.app","search","EditText","","",true,false);
        check(field.matches(field,"phone_type"),"unchanged input available");
        check(field.matches(new NodeIdentity("selected.app","search","EditText","","new suggestion",true,false),"phone_type"),"changing hint description does not block typing");
        check(field.matches(new NodeIdentity("selected.app","search","EditText","rotating hint","",true,false),"phone_type"),"replace the same input even when OEM exposes hint as text");
        NodeIdentity pager=new NodeIdentity("selected.app","feed","ViewPager","first video","first description",false,true);
        check(pager.matches(new NodeIdentity("selected.app","feed","ViewPager","new caption","new description",false,true),"phone_scroll"),"dynamic video text does not block scrolling");
        check(!pager.matches(new NodeIdentity("other.app","feed","ViewPager","first video","first description",false,true),"phone_scroll"),"package cannot change");
        check(!pager.matches(new NodeIdentity("selected.app","another","ViewPager","first video","first description",false,true),"phone_scroll"),"different target cannot be reused");
        NodeIdentity button=new NodeIdentity("selected.app","item","Button","天猫超市","商品",false,false);
        check(button.matches(button,"phone_click"),"same click target available");
        check(!button.matches(new NodeIdentity("selected.app","item","Button","other store","商品",false,false),"phone_click"),"recycled item content cannot silently change");
        check(!button.matches(new NodeIdentity("selected.app","item","Button","天猫超市","other item",false,false),"phone_click"),"target description cannot change");
        check(!button.matches(button,"phone_type"),"button cannot become input");
        check(!button.matches(button,"phone_scroll"),"button cannot become scroll target");
        check(!button.matches(button,"unknown"),"unknown action rejected");
        check(pager.matches(new NodeIdentity("selected.app","feed","ViewPager","new video","new description",false,true),"phone_swipe"),"swipe permits dynamic feed text");
        check(button.matches(button,"phone_swipe"),"swipe region need not expose native scrolling");
        check(!pager.matches(new NodeIdentity("other.app","feed","ViewPager","first video","first description",false,true),"phone_swipe"),"swipe cannot cross packages");
        check(!pager.matches(new NodeIdentity("selected.app","another","ViewPager","first video","first description",false,true),"phone_swipe"),"swipe cannot use a replaced target");
        System.out.println("node_identity_checks="+checks);
    }
}
