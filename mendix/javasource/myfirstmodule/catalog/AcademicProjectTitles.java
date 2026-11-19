package myfirstmodule.catalog;

import com.mendix.core.Core;
import com.mendix.systemwideinterfaces.core.IContext;
import com.mendix.systemwideinterfaces.core.IMendixObject;
import java.util.*;

/** Display-title revision for the six original, public MicroExplore project guides. */
public final class AcademicProjectTitles {
    private AcademicProjectTitles() {}
    private static final Map<String,String> TITLES = Map.ofEntries(
        Map.entry("Build a non-blocking LED timer","LED Blinking Using an Independent Timer"),
        Map.entry("Build a debounced button-controlled LED","Pushbutton Debouncing and LED State Control"),
        Map.entry("Build a potentiometer-controlled servo","Potentiometer-Based Servo Position Control"),
        Map.entry("Build a three-channel SD data logger","Three-Channel Analog Data Logging to SD Card"),
        Map.entry("Build a Pico PIO logic analyser","Digital Signal Acquisition Using Raspberry Pi Pico PIO"),
        Map.entry("Build a Pico arcade-button MIDI controller","Raspberry Pi Pico USB MIDI Controller with Arcade Buttons"));
    public static String displayTitle(String title) { return TITLES.getOrDefault(title,title); }
    public static int migrate(IContext c) throws Exception {
        if(c==null || c.getSession()==null || Boolean.TRUE.equals(c.getSession().getUser(c).isAnonymous())
            || !c.getSession().getUserRolesNames().contains("Administrator"))
            throw new IllegalArgumentException("An authenticated administrator is required.");
        List<IMendixObject> all=Core.createXPathQuery("//MyFirstModule.Project").execute(c);
        List<IMendixObject> changed=new ArrayList<>();
        Set<String> titles=new HashSet<>();
        for(IMendixObject p:all)titles.add(p.getValue(c,"Title"));
        // Preflight every collision before changing any object. Record IDs and all other fields remain intact.
        for(IMendixObject p:all) {
            String old=p.getValue(c,"Title"),author=p.getValue(c,"PublicAuthorName");
            if(!TITLES.containsKey(old) || !"MicroExplore - source-backed build checklist".equals(author))continue;
            if(titles.contains(TITLES.get(old)))throw new IllegalStateException("Project title revision has a duplicate target.");
            String instructions=p.getValue(c,"Instructions");
            if(instructions==null || !instructions.contains("SOURCE\n"))continue;
            changed.add(p);
        }
        for(IMendixObject p:changed)p.setValue(c,"Title",displayTitle(p.getValue(c,"Title")));
        if(!changed.isEmpty())Core.commit(c,changed);
        return changed.size();
    }
}
