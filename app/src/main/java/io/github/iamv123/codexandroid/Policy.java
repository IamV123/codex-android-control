package io.github.iamv123.codexandroid;

import java.util.Locale;
import java.util.Set;

public final class Policy {
    public static final String OWN = "io.github.iamv123.codexandroid";
    private static final Set<String> PROTECTED = Set.of(OWN, "android", "com.android.systemui", "com.android.settings");
    private Policy() {}
    public static boolean protectedPackage(String pkg) {
        if (pkg == null || pkg.isBlank()) return true;
        String p = pkg.toLowerCase(Locale.ROOT);
        return PROTECTED.contains(p) || p.contains("permissioncontroller") || p.contains("packageinstaller") || p.endsWith(".securitycenter") || p.endsWith(".settings") || p.equals("com.coloros.safecenter") || p.equals("com.iqoo.secure") || p.equals("com.vivo.permissionmanager");
    }
    public static boolean allowed(Set<String> grants, String pkg) { return !protectedPackage(pkg) && grants.contains(pkg); }
    public static void check(Set<String> grants, String pkg, boolean unlocked, boolean live) {
        if (!live) throw new SecurityException("session_ended");
        if (!unlocked) throw new SecurityException("phone_locked");
        if (!allowed(grants, pkg)) throw new SecurityException("app_not_authorized");
    }
}
