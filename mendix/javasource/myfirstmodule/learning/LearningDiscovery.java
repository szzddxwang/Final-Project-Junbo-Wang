package myfirstmodule.learning;
import com.mendix.core.Core;
import com.mendix.systemwideinterfaces.core.*;
import com.mendix.thirdparty.org.json.*;
import java.util.*;
import static myfirstmodule.learning.LearningWorkspace.*;
import static myfirstmodule.learning.LearningActivities.*;

/** Public discovery and owned progress. Queries are evaluated in the ordinary caller context. */
public final class LearningDiscovery {
 private LearningDiscovery(){}
 static JSONObject topicFilters(IContext c)throws Exception{
  Set<String> subjects=new TreeSet<>(String.CASE_INSENSITIVE_ORDER),tags=new TreeSet<>(String.CASE_INSENSITIVE_ORDER);
  for(var t:Core.createXPathQuery("//MyFirstModule.Topic[IsActive=true()]").setAmount(1000).execute(c)){
   if(!text(c,t,"CatalogCode").startsWith("FOUNDATION_"))continue;
   subjects.add(text(c,t,"Name"));for(String tag:text(c,t,"AITags").split("[,;]"))if(!tag.isBlank())tags.add(tag.trim());
  }
  JSONArray a=new JSONArray(),b=new JSONArray();subjects.forEach(a::put);tags.forEach(b::put);return new JSONObject().put("ok",true).put("subjects",a).put("tags",b);
 }
 static JSONObject library(IContext c,JSONObject q)throws Exception{
  String action=q.optString("action","list"),query=bounded(q,"query",100),type=bounded(q,"type",30),level=bounded(q,"level",30),time=bounded(q,"time",20);if(!Set.of("list","open").contains(action))throw new IllegalArgumentException("Unknown library action.");
  String scope="[(starts-with(ContentKey,'COURSE_RESOURCE_') and MyFirstModule.Resource_Topic/MyFirstModule.Topic/IsActive=true()) or starts-with(ContentKey,'USER_CONTRIBUTION_LIBRARY_')]";
  var resources=Core.createXPathQuery("//MyFirstModule.Resource"+publishedFilter(c)+scope).setAmount(1000).execute(c);JSONArray rows=new JSONArray();Set<String> types=new TreeSet<>(),levels=new TreeSet<>();boolean opened=false;
  for(var r:resources){String id=Long.toString(r.getId().toLong()),title=text(c,r,"Title"),summary=text(c,r,"Description"),rt=text(c,r,"ResourceType"),dl=text(c,r,"Difficulty"),body=text(c,r,"ArticleBody"),url=text(c,r,"SourceURL");Object rawTime=r.getValue(c,"EstimatedStudyTime");int minutes=rawTime instanceof Number?((Number)rawTime).intValue():0;if(body.isBlank()&&url.isBlank())continue;if(!rt.isBlank())types.add(rt);if(!dl.isBlank())levels.add(dl);
   if(action.equals("open")&&id.equals(q.optString("id"))){openResource(c,id);opened=true;}
   if(!matches(query,title,summary,text(c,r,"SourceName"))||!type.isBlank()&&!type.equals(rt)||!level.isBlank()&&!level.equals(dl)||!studyTimeMatches(minutes,time))continue;
   rows.put(new JSONObject().put("id",id).put("title",title).put("summary",summary).put("type",rt).put("display_type",title.toLowerCase(Locale.ROOT).contains("textbook")?"Textbook":rt.equals("Video")?"Lecture video":title.toLowerCase(Locale.ROOT).contains("course")?"Course":rt).put("prerequisite",title.contains("6.012")?"Prior circuit analysis and basic semiconductor concepts":title.contains("6.002")?"Basic algebra and calculus; start with the syllabus and Lecture 1":"Check the source introduction for prerequisites").put("level",dl).put("source",text(c,r,"SourceName")).put("access",!body.isBlank()?"Read inside MicroExplore":rt.equals("Video")?"Open the video reader":"Read the abstract, then open the source").put("minutes",minutes).put("duration",minutes>0?minutes+" min suggested study session (website estimate)":"Study time not specified"));
  }
  if(action.equals("open")&&!opened)throw new IllegalArgumentException("This course resource is no longer available.");JSONArray ts=new JSONArray(),ls=new JSONArray();types.forEach(ts::put);levels.forEach(ls::put);return new JSONObject().put("ok",true).put("mode","Library").put("items",rows).put("types",ts).put("levels",ls).put("message",rows.length()+" published course resources. Study time is the saved website estimate, not the full course or source-video duration.");
 }
 static boolean studyTimeMatches(int minutes,String filter){return switch(filter){case ""->true;case "short"->minutes>0&&minutes<=30;case "medium"->minutes>30&&minutes<=60;case "long"->minutes>60;case "unknown"->minutes<=0;default->false;};}
 private record Destination(String kind,String key,long expires){}
 private static final Map<String,Destination> NEXT=new java.util.concurrent.ConcurrentHashMap<>();
 private static String sessionKey(IContext c){return c.getSession().getId().toString();}
 static void remember(IContext c,String kind,String key){long now=System.currentTimeMillis();NEXT.entrySet().removeIf(e->e.getValue().expires()<now);if(NEXT.size()<2000)NEXT.put(sessionKey(c),new Destination(kind,key,now+120000));}
 private static String consume(IContext c,String kind){Destination d=NEXT.get(sessionKey(c));if(d==null||!d.kind().equals(kind))return "";NEXT.remove(sessionKey(c));return d.expires()>=System.currentTimeMillis()?d.key():"";}
 static JSONObject guide(String code){for(JSONObject p:objects(catalog().getJSONArray("projects")))if(p.getString("system").equals(code))return p;throw new IllegalArgumentException("Choose a guided project.");}
 static JSONObject projects(IContext c,JSONObject q)throws Exception{
  String action=q.optString("action","list"),code=q.optString("system","");boolean signed=signedIn(c);if(code.isBlank()&&action.equals("list"))code=consume(c,"Project");JSONObject out=new JSONObject().put("ok",true).put("mode","Projects").put("signed_in",signed);
  if(action.equals("save")){
   user(c);JSONObject p=guide(code);JSONArray checks=q.optJSONArray("checks");if(checks==null||checks.length()!=p.getJSONArray("steps").length())throw new IllegalArgumentException("Confirm each project step explicitly.");int done=0;for(int i=0;i<checks.length();i++){if(!(checks.get(i) instanceof Boolean))throw new IllegalArgumentException("Invalid step confirmation.");if(checks.getBoolean(i))done++;}
   String note=bounded(q,"note",3000);boolean completed=done==checks.length()&&note.length()>=20;
   save(c,"Project",version()+":"+code,p.getString("title"),completed?"Completed":"In progress",done,checks.length(),new JSONObject().put("checks",checks).put("note",note).put("system",code),false);out.put("message",completed?"Project completion saved from your explicit step confirmations and reflection.":"Progress saved. Finish every step and add an observation with a limitation to complete.");
  }else if(action.equals("openReading"))openResource(c,reading(c,system(code).getString("resource_key")).getString("id"));
  else if(action.equals("openLab"))openLab(c,guide(code).getString("lab"));
  else if(action.equals("openOriginal")){
   String title=guide(code).getString("related_project_title");if(title.isBlank())throw new IllegalArgumentException("This is an original virtual-first extension; no older project is claimed.");
   var list=Core.createXPathQuery("//MyFirstModule.Project"+publishedFilter(c)).setAmount(500).execute(c);IMendixObject found=null;for(var p:list)if(text(c,p,"Title").equals(title))found=p;if(found==null)throw new IllegalArgumentException("The related published project is unavailable.");Core.microflowCall("MyFirstModule.ACT_Learning_ShowProject").withParam("Project",found).execute(c);
  }else if(!Set.of("list","open").contains(action))throw new IllegalArgumentException("Unknown project action.");
  JSONArray items=new JSONArray();for(JSONObject p:objects(catalog().getJSONArray("projects"))){JSONObject r=reading(c,system(p.getString("system")).getString("resource_key"));p.put("reading",r);IMendixObject e=signed?evidence(c,"Project",version()+":"+p.getString("system")):null;p.put("progress",e==null?new JSONObject():new JSONObject(text(c,e,"DataJson"))).put("status",e==null?"Not started":text(c,e,"Status"));items.put(p);}
  return out.put("items",items).put("selected_system",code);
 }
 static JSONObject glossary(IContext c,JSONObject q)throws Exception{return LearningGlossary.run(c,q,consume(c,"Glossary"));}
 static boolean matches(String query,String...parts){String hay=LearningRelevance.normalize(String.join(" ",parts));for(String token:LearningRelevance.normalize(query).split("\\s+"))if(!hay.contains(token))return false;return true;}
 static String publishedProjectId(String key){
  if(!key.startsWith("published:"))return "";
  String id=key.substring("published:".length());
  if(!id.matches("[1-9][0-9]{0,18}"))throw new IllegalArgumentException("Select a current published project.");
  return id;
 }
 static void openPublishedProject(IContext c,String key)throws Exception{
  String id=publishedProjectId(key);if(id.isEmpty())throw new IllegalArgumentException("Select a published project.");
  var rows=Core.createXPathQuery("//MyFirstModule.Project[id="+id+"]"+publishedFilter(c)).setAmount(1).execute(c);
  if(rows.isEmpty())throw new IllegalArgumentException("This project is no longer published.");
  Core.microflowCall("MyFirstModule.ACT_Learning_ShowProject").withParam("Project",rows.get(0)).execute(c);
 }
 static JSONObject search(IContext c,JSONObject q)throws Exception{
  String action=q.optString("action","list"),query=bounded(q,"query",100),type=bounded(q,"type",30),category=bounded(q,"category",80);JSONArray rows=new JSONArray();
  if(action.equals("open")){
   String kind=q.optString("kind"),key=q.optString("key");switch(kind){case "Resource":openResource(c,key);break;case "Project":if(!publishedProjectId(key).isEmpty()){openPublishedProject(c,key);break;}guide(key);remember(c,"Project",key);Core.microflowCall("MyFirstModule.ACT_Learning_ShowProjects").execute(c);break;case "Tutorial":system(key);openResource(c,reading(c,system(key).getString("resource_key")).getString("id"));break;case "Glossary":boolean found=false;for(JSONObject e:objects(catalog().getJSONArray("glossary")))found|=e.getString("term").equals(key);if(!found)throw new IllegalArgumentException("Choose a current term.");remember(c,"Glossary",key);Core.microflowCall("MyFirstModule.ACT_Learning_ShowGlossary").execute(c);break;case "Lab":openLab(c,key);break;default:throw new IllegalArgumentException("Select a current public search result.");}
  }else if(!action.equals("list"))throw new IllegalArgumentException("Unknown search action.");
  // No contributor/private entity is queried. Current public Resource access still enforces its existing entity rules.
  if(query.length()>=2){
   if(type.isEmpty()||type.equals("Resource"))for(var r:Core.createXPathQuery("//MyFirstModule.Resource"+publishedFilter(c)).setAmount(1000).execute(c)){
    String title=text(c,r,"Title"),body=text(c,r,"ArticleBody"),description=text(c,r,"Description"),key=text(c,r,"ContentKey"),source=text(c,r,"SourceName");if(body.isBlank()&&text(c,r,"SourceURL").isBlank())continue;
    if(matches(query,title,body,description,key)&&matches(category,key,source,text(c,r,"ResourceType")))rows.put(new JSONObject().put("kind","Resource").put("key",Long.toString(r.getId().toLong())).put("title",title).put("summary",LearningRelevance.snippet(query,description,body)).put("category",text(c,r,"ResourceType")).put("source",source).put("match_score",LearningRelevance.score(query,title,body,description)));
   }
   if(type.isEmpty()||type.equals("Project")){
    for(var p:Core.createXPathQuery("//MyFirstModule.Project"+publishedFilter(c)).setAmount(1000).execute(c)){
     String title=text(c,p,"Title"),description=text(c,p,"Description"),instructions=text(c,p,"Instructions"),level=text(c,p,"Difficulty");
     if(!instructions.isBlank()&&matches(query,title,description,instructions,text(c,p,"RequiredHardware"))&&matches(category,title,level))rows.put(new JSONObject().put("kind","Project").put("key","published:"+p.getId().toLong()).put("title",title).put("summary",description).put("category",level));
    }
    for(JSONObject p:objects(catalog().getJSONArray("projects")))if(matches(query,p.toString())&&matches(category,p.getString("system"),p.getString("level")))rows.put(new JSONObject().put("kind","Project").put("key",p.getString("system")).put("title",p.getString("title")).put("summary",p.getString("goal")).put("category",p.getString("system")));
   }
   if(type.isEmpty()||type.equals("Tutorial"))for(JSONObject s:objects(catalog().getJSONArray("systems")))if(matches(query,s.getString("name"),s.getString("resource_title"),s.getString("code"))&&matches(category,s.getString("code"))){JSONObject r=reading(c,s.getString("resource_key"));rows.put(new JSONObject().put("kind","Tutorial").put("key",s.getString("code")).put("title",r.getString("title")+" — knowledge check").put("summary","Full published lesson with three optional questions.").put("category",s.getString("code")));}
   if(type.isEmpty()||type.equals("Glossary"))for(JSONObject e:objects(catalog().getJSONArray("glossary")))if(matches(query,e.getString("term"),e.getString("definition"))&&matches(category,e.getString("resource_key")))rows.put(new JSONObject().put("kind","Glossary").put("key",e.getString("term")).put("title",e.getString("term")).put("summary",e.getString("definition")).put("category",e.getString("resource_key")));
   if(signedIn(c)&&(type.isEmpty()||type.equals("Lab")))for(JSONObject s:objects(catalog().getJSONArray("systems")))if(matches(query,s.getString("code"),s.getString("name"),s.getString("lab"))&&matches(category,s.getString("code")))rows.put(new JSONObject().put("kind","Lab").put("key",s.getString("lab")).put("title",s.getString("name")+" virtual experiment").put("summary","Open the existing controlled-simulation workbench. Private outputs are not searched.").put("category",s.getString("code")));
  }
  List<JSONObject> sorted=objects(rows);sorted.sort(Comparator.<JSONObject>comparingDouble(x->x.optDouble("match_score",LearningRelevance.score(query,x.optString("title"),"",x.optString("summary")))).reversed().thenComparing(x->x.getString("title")));rows=new JSONArray();for(JSONObject item:sorted){item.remove("match_score");rows.put(item);}
  return new JSONObject().put("ok",true).put("mode","Search").put("items",rows).put("message",query.length()<2?"Enter at least two characters to search current public learning material.":rows.length()+" accessible results. No draft submissions or private experiment outputs are searched.");
 }
 static JSONObject progress(IContext c,JSONObject q)throws Exception{
  user(c);String action=q.optString("action","list");if(LearningCoach.handle(c,q)){}else if(action.equals("openNotebook"))Core.microflowCall("MyFirstModule.ACT_Learning_ShowNotebook").execute(c);else if(action.equals("openReading"))openResource(c,q.optString("id"));else if(action.equals("resume"))Core.microflowCall("MyFirstModule.ACT_Learning_ShowStart").execute(c);else if(!action.equals("list"))throw new IllegalArgumentException("Unknown progress action.");
  JSONArray items=new JSONArray();for(var e:mine(c,"LearningEvidence")){
   String kind=text(c,e,"Kind"),key=text(c,e,"EvidenceKey");if(kind.equals("Bookmark")&&text(c,e,"Status").equals("Removed"))continue;
   if(kind.equals("Bookmark")||kind.equals("Recent")){try{publicResource(c,key);}catch(IllegalArgumentException ex){continue;}}
   items.put(new JSONObject().put("kind",kind).put("key",key).put("title",text(c,e,"Title")).put("status",text(c,e,"Status")).put("score",(Object)e.getValue(c,"Score")).put("total",(Object)e.getValue(c,"Total")).put("at",text(c,e,"RecordedAt")).put("at_ms",e.getValue(c,"RecordedAt") instanceof Date?((Date)e.getValue(c,"RecordedAt")).getTime():0).put("resource_id",Set.of("Bookmark","Recent").contains(kind)?key:""));
  }
  List<JSONObject> ordered=objects(items);ordered.sort(Comparator.<JSONObject>comparingLong(x->x.optLong("at_ms")).reversed());items=new JSONArray();for(JSONObject item:ordered)items.put(item);
  int captures=0;for(var n:mine(c,"LearningNotebook"))if(!Boolean.TRUE.equals(n.getValue(c,"IsDeleted")))captures++;
  return new JSONObject().put("ok",true).put("mode","Progress").put("items",items).put("experiments",captures).put("path_progress",LearningMetrics.pathProgress(items,version(),level(c),path(level(c)).getJSONArray("steps").length())).put("coach",LearningCoach.recommend(c)).put("saved_level",level(c)).put("effective_level",LearningAssessment.effectiveLevel(c)).put("assessment",LearningAssessment.latest(c,"Assessment","baseline")).put("message","Your assessment, practice and saved experiments help choose your next activity. Reading history and earlier guided activity remain separate.");
 }
}

