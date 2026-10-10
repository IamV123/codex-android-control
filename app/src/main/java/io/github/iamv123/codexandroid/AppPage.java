package io.github.iamv123.codexandroid;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/** Filtering and paging never change the user's selected packages. */
public final class AppPage {
    public record Entry(String label,String pkg){}
    public record Page(List<Entry> entries,int index,int pages,int matches){}
    public static Page filter(List<Entry> all,String query,int requested){
        String needle=query==null?"":query.trim().toLowerCase(Locale.ROOT);
        List<Entry> matches=new ArrayList<>();
        for(Entry entry:all)if(entry.label().toLowerCase(Locale.ROOT).contains(needle)||entry.pkg().toLowerCase(Locale.ROOT).contains(needle))matches.add(entry);
        int pages=Math.max(1,(matches.size()+9)/10),index=Math.max(0,Math.min(requested,pages-1)),start=index*10;
        return new Page(List.copyOf(matches.subList(start,Math.min(start+10,matches.size()))),index,pages,matches.size());
    }
}
