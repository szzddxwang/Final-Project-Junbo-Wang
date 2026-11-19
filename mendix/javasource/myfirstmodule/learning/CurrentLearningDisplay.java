package myfirstmodule.learning;

import com.mendix.core.Core;
import com.mendix.systemwideinterfaces.core.*;
import java.util.*;

/** Adapts fresh native EA=true retrievals to pure ranking. Never commits or uses an elevated context. */
public final class CurrentLearningDisplay {
    private CurrentLearningDisplay() {}
    private static String text(IContext c,IMendixObject o,String member){Object v=o==null?null:o.getValue(c,member);return v==null?"":String.valueOf(v);}
    private static double number(IContext c,IMendixObject o,String member){Object v=o.getValue(c,member);return v instanceof Number n?n.doubleValue():0;}
    public static boolean owned(IContext c,IMendixObject session)throws Exception{
        if(session==null||!"MyFirstModule.DiagnosticSession".equals(session.getType())||c.getSession()==null||Boolean.TRUE.equals(c.getSession().getUser(c).isAnonymous())||c.getSession().getUserRolesNames().stream().noneMatch(Set.of("Learner","Administrator")::contains))return false;
        IMendixIdentifier profileId=session.getValue(c,"MyFirstModule.DiagnosticSession_UserProfile");
        IMendixObject profile=profileId==null?null:Core.retrieveId(c,profileId);
        IMendixIdentifier owner=profile==null?null:profile.getValue(c,"MyFirstModule.UserProfile_Account");
        return profile!=null&&"MyFirstModule.UserProfile".equals(profile.getType())&&c.getSession().getUserId().equals(owner);
    }
    private static void related(IContext c,IMendixObject session,List<IMendixObject> rows,String type){
        if(rows==null||rows.size()>1000)throw new IllegalArgumentException("Learning evidence exceeds the supported display limit.");
        for(IMendixObject row:rows)if(!row.getType().equals("MyFirstModule."+type)||!session.getId().equals(row.getValue(c,"MyFirstModule."+type+"_Session")))throw new IllegalArgumentException("Learning evidence is unavailable.");
    }
    static String token(IMendixObject session,GroundedLearningRanker.Recommendation r){return session.getId().toLong()+"|"+r.articleId()+"|"+Base64.getUrlEncoder().withoutPadding().encodeToString(r.heading().getBytes(java.nio.charset.StandardCharsets.UTF_8));}
    public static List<IMendixObject> rank(IContext c,IMendixObject session,List<IMendixObject> resources,List<IMendixObject> topics,List<IMendixObject> results,List<IMendixObject> questions,List<IMendixObject> findings,List<IMendixObject> knowledge,List<IMendixObject> measurements)throws Exception{
        long began=System.nanoTime();if(!owned(c,session))return List.of();
        if(resources==null||topics==null||resources.size()>500||topics.size()>1000)throw new IllegalArgumentException("The learning catalog exceeds the supported display limit.");
        related(c,session,results,"DiagnosticResult");related(c,session,questions,"DiagnosticQuestion");related(c,session,findings,"DiagnosticRuleFinding");related(c,session,knowledge,"KnowledgeRecommendation");related(c,session,measurements,"DiagnosticMeasurement");
        IMendixObject first=results.stream().min(Comparator.comparingDouble(r->number(c,r,"Rank"))).orElse(null);
        String fault=first==null?text(c,session,"FinalFaultCode"):text(c,first,"FaultCode");double probability=first==null?0:number(c,first,"Probability");
        Set<String> strong=new HashSet<>(),concepts=new HashSet<>(),measured=new HashSet<>();
        for(IMendixObject f:findings)if(text(c,f,"Severity").equals("critical"))strong.add(text(c,f,"FaultCode"));
        for(IMendixObject k:knowledge)concepts.add(text(c,k,"KnowledgeCode"));
        for(IMendixObject m:measurements)measured.add(text(c,m,"MeasurementCode"));
        String next=questions.stream().min(Comparator.comparingDouble(q->number(c,q,"Sequence"))).map(q->text(c,q,"MeasurementCode")).orElse("");
        Map<Long,IMendixObject> topicById=new HashMap<>();for(IMendixObject t:topics)if(t.getType().equals("MyFirstModule.Topic")&&Boolean.TRUE.equals(t.getValue(c,"IsActive")))topicById.put(t.getId().toLong(),t);
        List<GroundedLearningRanker.Article> articles=new ArrayList<>();
        boolean admin=c.getSession().getUserRolesNames().contains("Administrator");
        for(IMendixObject r:resources){
            if(!r.getType().equals("MyFirstModule.Resource")||!Boolean.TRUE.equals(r.getValue(c,"IsActive")))continue;
            // Learner rows already satisfy the unchanged [IsDeleted=false] entity rule.
            // Administrators have unrestricted read access and need this explicit deletion check.
            if(admin&&Boolean.TRUE.equals(r.getValue(c,"IsDeleted")))continue;
            IMendixIdentifier topicId=r.getValue(c,"MyFirstModule.Resource_Topic");IMendixObject topic=topicId==null?null:topicById.get(topicId.toLong());if(topic==null)continue;
            boolean ai=!text(c,topic,"AISection").equals("Microelectronics Foundations");
            articles.add(new GroundedLearningRanker.Article(Long.toString(r.getId().toLong()),text(c,r,"Title"),text(c,r,"ArticleBody"),text(c,r,"ContentKey"),text(c,topic,"CatalogCode"),ai,true,true,true,text(c,r,"LicenseName"),text(c,r,"Attribution")));
        }
        long before=GroundedLearningRanker.parseCount(),rankStart=System.nanoTime();
        var ranked=GroundedLearningRanker.rank(new GroundedLearningRanker.Diagnosis(text(c,session,"SystemCode"),fault,probability,strong,next,concepts,measured),articles).stream().limit(3).toList();
        double rankMs=(System.nanoTime()-rankStart)/1_000_000.0;
        List<IMendixObject> output=LearningDisplayCards.create(c,session,ranked);
        Core.getLogger("MicroExploreLearning").info("Current learning display: system="+text(c,session,"SystemCode")+" candidates="+articles.size()+" results="+ranked.size()+" rank_ms="+rankMs+" display_ms="+((System.nanoTime()-began)/1_000_000.0)+" parsed="+(GroundedLearningRanker.parseCount()-before)+" native_db_retrieves=8 owner_profile_lookups=1 card_factory_calls=1");
        return output;
    }
    public static IMendixObject resolve(IContext c,IMendixObject session,IMendixObject selected,List<IMendixObject> current,List<IMendixObject> resources)throws Exception{
        if(!owned(c,session)||selected==null||!selected.getType().equals("MyFirstModule.NP_AIFinding")||current==null||current.size()>5||resources==null||resources.size()>500)return null;
        String key=text(c,selected,"Severity");if(key.length()>1800||current.stream().noneMatch(x->key.equals(text(c,x,"Severity"))))return null;
        String[] parts=key.split("\\|",3);if(parts.length!=3||!parts[0].equals(Long.toString(session.getId().toLong())))return null;
        for(IMendixObject resource:resources)if(resource.getType().equals("MyFirstModule.Resource")&&parts[1].equals(Long.toString(resource.getId().toLong()))&&Boolean.TRUE.equals(resource.getValue(c,"IsActive")))return resource;
        return null;
    }
}
