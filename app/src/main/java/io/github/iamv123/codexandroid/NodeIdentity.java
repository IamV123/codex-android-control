package io.github.iamv123.codexandroid;

/** Identity of one accessibility target, independent of unrelated page content. */
public record NodeIdentity(String pkg, String viewId, String className, String text,
                           String description, boolean editable, boolean scrollable) {
    public boolean matches(NodeIdentity current, String action) {
        if (!pkg.equals(current.pkg) || !viewId.equals(current.viewId)
                || !className.equals(current.className) || editable != current.editable
                || scrollable != current.scrollable) return false;
        if (action.equals("phone_scroll")) return scrollable;
        if (action.equals("phone_type")) return editable;
        return action.equals("phone_click") && text.equals(current.text)
                && description.equals(current.description);
    }
}
