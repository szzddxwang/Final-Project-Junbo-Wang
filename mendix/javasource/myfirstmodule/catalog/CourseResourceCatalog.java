package myfirstmodule.catalog;

import com.mendix.core.Core;
import com.mendix.systemwideinterfaces.core.*;
import java.util.*;

/** Fixed, Administrator-only additive import. Uses the caller context and existing access rules. */
public final class CourseResourceCatalog {
    private CourseResourceCatalog() {}
    private record Entry(String key,String title,String summary,String url,String kind,String topic,String level,int minutes,String source,String author,String license,String licenseUrl,String origin,String hash) {}
    private static final List<Entry> ENTRIES=List.of(
        new Entry("COURSE_RESOURCE_20261101_MIT_6002", "MIT 6.002: Circuits and Electronics (Full Course)", "A complete undergraduate course on circuit models, analysis, digital logic and amplifiers. Start with the syllabus, then follow the lectures and assignments.", "https://ocw.mit.edu/courses/6-002-circuits-and-electronics-spring-2007/", "Tutorial", "FOUNDATION_GPIO", "Beginner", 60, "MIT OpenCourseWare", "Anant Agarwal and Jeffrey H. Lang; MIT OpenCourseWare", "CC BY-NC-SA 4.0", "https://creativecommons.org/licenses/by-nc-sa/4.0/", "https://ocw.mit.edu/courses/6-002-circuits-and-electronics-spring-2007/", "6f97343642fa3105e12d406d29982e2946689d036e4b0044fcc086b4f965efe7"),
        new Entry("COURSE_RESOURCE_20261101_MIT_6012", "MIT 6.012: Microelectronic Devices and Circuits (Full Course)", "Study semiconductor devices, MOS and bipolar transistors, and circuit models through lecture notes and problems. Prior circuit analysis knowledge is recommended.", "https://ocw.mit.edu/courses/6-012-microelectronic-devices-and-circuits-spring-2009/", "Tutorial", "FOUNDATION_SEMICONDUCTORS", "Intermediate", 60, "MIT OpenCourseWare", "MIT 6.012 teaching team; MIT OpenCourseWare", "CC BY-NC-SA 4.0", "https://creativecommons.org/licenses/by-nc-sa/4.0/", "https://ocw.mit.edu/courses/6-012-microelectronic-devices-and-circuits-spring-2009/", "d21d84d94a69c6bcc61fbcc91ec96f23324329bf9aabba64c3777425899d6e24"),
        new Entry("COURSE_RESOURCE_20261101_BOOK_DC", "Textbook: Lessons in Electric Circuits - DC", "An open textbook on voltage, current, Ohm's law, circuit analysis and measurement. Read the abstract here, then choose a chapter in the original book.", "https://www.ibiblio.org/kuphaldt/electricCircuits/DC/index.html", "Documentation", "FOUNDATION_POWER", "Beginner", 30, "ibiblio / Lessons in Electric Circuits", "Tony R. Kuphaldt and listed contributors", "CC BY 4.0", "https://creativecommons.org/licenses/by/4.0/", "https://www.ibiblio.org/kuphaldt/electricCircuits/DC/index.html", "0ae8198f1d9abd951f65897fa92882670251e8949809101f1c04e79cac524692"),
        new Entry("COURSE_RESOURCE_20261101_BOOK_SEMICONDUCTORS", "Textbook: Lessons in Electric Circuits - Semiconductors", "An open textbook on diodes, bipolar transistors and amplifiers. Some FET and practical-circuit chapters are incomplete; see the original contents before reading.", "https://www.ibiblio.org/kuphaldt/electricCircuits/Semi/index.html", "Documentation", "FOUNDATION_SEMICONDUCTORS", "Intermediate", 30, "ibiblio / Lessons in Electric Circuits", "Tony R. Kuphaldt and listed contributors", "CC BY 4.0", "https://creativecommons.org/licenses/by/4.0/", "https://www.ibiblio.org/kuphaldt/electricCircuits/Semi/index.html", "7995586a1e38228f01f875828d32885050afb9c7580ca22ab39323702e2216ce"),
        new Entry("COURSE_RESOURCE_20261101_VIDEO_MIT_6002_L01", "MIT 6.002 Lecture 1: Lumped Circuit Abstraction", "Watch the introductory circuit lecture inside this reader. Learn when a lumped circuit model is useful and what its assumptions mean. Instructor: Anant Agarwal.", "https://archive.org/download/MIT6.002S07/mit-6.002-lec1-04sep2003-220k.mp4", "Video", "FOUNDATION_GPIO", "Beginner", 45, "MIT OpenCourseWare", "Anant Agarwal; MIT OpenCourseWare", "CC BY-NC-SA 4.0", "https://creativecommons.org/licenses/by-nc-sa/4.0/", "https://ocw.mit.edu/courses/6-002-circuits-and-electronics-spring-2007/resources/lecture-1/", "6b8ccc31315cc60e7bceb6fda43ff75678895e3e277a825ecf42ae32e87c65a2"),
        new Entry("COURSE_RESOURCE_20261101_VIDEO_MIT_6002_L02", "MIT 6.002 Lecture 2: Basic Circuit Analysis", "Watch the circuit-analysis lecture inside this reader. Practice applying voltage and current laws to simple circuits. Instructor: Anant Agarwal.", "https://archive.org/download/MIT6.002S07/mit-6.002-lec2-09sep2003-220k.mp4", "Video", "FOUNDATION_GPIO", "Beginner", 45, "MIT OpenCourseWare", "Anant Agarwal; MIT OpenCourseWare", "CC BY-NC-SA 4.0", "https://creativecommons.org/licenses/by-nc-sa/4.0/", "https://ocw.mit.edu/courses/6-002-circuits-and-electronics-spring-2007/resources/lecture-2/", "36509da99e51ddafaa6c740d9ce0d3a6fdabfabbc9bcfb4e13fb14c66834acb9")
    );
    public static synchronized String importCatalog(IContext c) throws Exception {
        if(c==null || c.getSession()==null || Boolean.TRUE.equals(c.getSession().getUser(c).isAnonymous()) || !c.getSession().getUserRolesNames().contains("Administrator"))
            throw new IllegalArgumentException("An authenticated administrator is required.");
        String publicReport = CloudTeachingCatalog.importCatalog(c);
        var topics=new HashMap<String,IMendixObject>();
        for(IMendixObject t:Core.createXPathQuery("//MyFirstModule.Topic[IsActive = true()]").execute(c)) {
            String code=t.getValue(c,"CatalogCode");
            if(topics.put(code,t)!=null && ENTRIES.stream().anyMatch(e->e.topic().equals(code)))
                throw new IllegalStateException("Ambiguous topic code; import stopped: "+code);
        }
        var existing=new HashSet<String>();
        for(IMendixObject r:Core.createXPathQuery("//MyFirstModule.Resource[starts-with(ContentKey, 'COURSE_RESOURCE_20261101_')]").execute(c))
            existing.add(r.getValue(c,"ContentKey"));
        // Validate all required topic associations before creating any record.
        for(Entry e:ENTRIES)if(!topics.containsKey(e.topic()))throw new IllegalStateException("Required active topic missing: "+e.topic());
        var created=new ArrayList<IMendixObject>();
        for(Entry e:ENTRIES) {
            if(existing.contains(e.key()))continue; // Never overwrite, reactivate or delete an existing entry.
            IMendixObject r=Core.instantiate(c,"MyFirstModule.Resource");
            r.setValue(c,"Title",e.title()); r.setValue(c,"Description",e.summary());
            r.setValue(c,"SourceName",e.source());r.setValue(c,"SourceURL",e.url());
            r.setValue(c,"ResourceType",e.kind());r.setValue(c,"Difficulty",e.level());
            r.setValue(c,"EstimatedStudyTime",e.minutes());r.setValue(c,"IsFeatured",false);
            r.setValue(c,"IsActive",true);r.setValue(c,"IsDeleted",false);
            r.setValue(c,"ContentKey",e.key());r.setValue(c,"ContentSHA256",e.hash());
            r.setValue(c,"ArticleBody","");r.setValue(c,"PublicAuthorName",e.author());
            r.setValue(c,"Attribution",e.author()+". Original: "+e.origin()+". MicroExplore summary; original work unchanged.");
            r.setValue(c,"LicenseName",e.license());r.setValue(c,"LicenseURL",e.licenseUrl());
            r.setValue(c,"MyFirstModule.Resource_Topic",topics.get(e.topic()).getId());
            created.add(r);
        }
        if(!created.isEmpty())Core.commit(c,created);
        String projectReport=PracticalProjectCatalog.importCatalog(c)+" "+AIApplicationCatalog.importCatalog(c);
        String report="Course catalog: "+created.size()+" added; "+(ENTRIES.size()-created.size())+" already present. Existing resources unchanged. "+projectReport;
        Core.getLogger("CourseResourceCatalog").info(report);
        return publicReport + " " + report;
    }
}
