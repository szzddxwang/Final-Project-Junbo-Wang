package myfirstmodule.learning;
import com.mendix.core.Core;
import com.mendix.systemwideinterfaces.core.*;
import com.mendix.thirdparty.org.json.*;
import java.util.*;
import static myfirstmodule.learning.LearningWorkspace.*;
import static myfirstmodule.learning.LearningActivities.*;

/** Concept-level next steps from the caller's latest actual quiz per system.
 * No diagnosis/model routing, cross-user records, inferred mastery or writes.
 */
public final class LearningCoach {
 private LearningCoach(){}
 static JSONObject concept(String code){
  for(JSONObject s:objects(catalog().getJSONArray("systems")))for(JSONObject q:objects(s.getJSONArray("quiz")))if(q.getString("concept").equals(code))return new JSONObject(q.toString()).put("system",s.getString("code")).put("system_name",s.getString("name")).put("lab",s.getString("lab"));
  throw new IllegalArgumentException("Choose a current learning suggestion.");
 }
 static int depth(String level){return switch(level){case "Advanced"->2;case "Intermediate"->1;default->0;};}
 static List<JSONObject> rank(String level,JSONArray attempts){return rank(level,attempts,"");}
 static List<JSONObject> rank(String level,JSONArray attempts,String focus){
  Map<String,JSONObject> latest=new HashMap<>();
  for(JSONObject a:objects(attempts)){
   String system=a.optString("system");long at=a.optLong("at",0L);
   if(!a.optString("version").equals(version())||at<=0||a.optJSONArray("feedback")==null)continue;
   int position=0; JSONObject sys;try{sys=system(system);}catch(IllegalArgumentException invalid){continue;}
   for(JSONObject f:objects(a.getJSONArray("feedback"))){
    String code=f.optString("concept",position<sys.getJSONArray("quiz").length()?sys.getJSONArray("quiz").getJSONObject(position).getString("concept"):"");position++;
    if(code.isBlank()||!(f.opt("correct") instanceof Boolean))continue;
    String key=system+":"+code;JSONObject prior=latest.get(key);
    if(prior==null||at>prior.getLong("at"))latest.put(key,new JSONObject().put("correct",f.getBoolean("correct")).put("at",at));
   }
  }
  long latestTime=0;for(JSONObject a:latest.values())latestTime=Math.max(latestTime,a.getLong("at"));
  List<JSONObject> ranked=new ArrayList<>();String pathSystem=focus.isBlank()?path(level).getString("system"):focus;
  for(JSONObject s:objects(catalog().getJSONArray("systems"))){
   for(JSONObject q:objects(s.getJSONArray("quiz"))){
    JSONObject f=latest.get(s.getString("code")+":"+q.getString("concept"));
    boolean wrong=f!=null&&!f.getBoolean("correct");
    if(f!=null&&!wrong)continue;
    int target=depth(q.getString("level")),learner=depth(level),gap=Math.abs(learner-target);
    // Do not send a beginner directly to advanced evidence interpretation.
    // Missing foundation checks are prerequisites, not evidence of failure.
    boolean prerequisitesReady=true;
    for(JSONObject prerequisite:objects(s.getJSONArray("quiz")))if(depth(prerequisite.getString("level"))<target){
     JSONObject pf=latest.get(s.getString("code")+":"+prerequisite.getString("concept"));
     if(pf==null||!pf.getBoolean("correct"))prerequisitesReady=false;
    }
    if(target>learner&&!prerequisitesReady)continue;
    double recency=f==null?0:3/(1+Math.max(0,latestTime-f.optLong("at",0L))/86400000.0);
    double score=(wrong?80:30)-gap*4-target*2+recency+(s.getString("code").equals(pathSystem)?3:0);
    JSONObject item=concept(q.getString("concept"));item.remove("answer");item.remove("options");item.remove("prompt");item.remove("explanation");
    item.put("score",score).put("source",wrong?"Latest saved check":"Suggested starting point").put("reason",wrong?"Your latest answer on this concept needs another look. Read the explanation, then try the suggested experiment.":(target<learner?"Check this foundation before a harder experiment.":target>learner?"You answered the prerequisite checks correctly; try this next challenge.":"A starting activity at your current recommendation level."))
      .put("evidence_at",f==null?0:f.optLong("at")).put("prerequisite_review",target<learner);
    ranked.add(item);
   }
  }
  ranked.sort(Comparator.<JSONObject>comparingDouble(x->x.getDouble("score")).reversed().thenComparing(x->x.getString("concept")));
  return ranked;
 }
 static JSONArray attempts(IContext c)throws Exception{
  JSONArray rows=new JSONArray();long actor=user(c);
  var saved=Core.createXPathQuery("//MyFirstModule.LearningEvidence[System.owner="+actor+"][Kind='Quiz']").addSort("RecordedAt",false).setAmount(500).execute(c);
  for(var e:saved){String key=text(c,e,"EvidenceKey");if(!key.startsWith(version()+":"))continue;Object at=e.getValue(c,"RecordedAt");if(!(at instanceof Date))continue;
   try{JSONObject data=new JSONObject(text(c,e,"DataJson"));rows.put(data.put("version",version()).put("system",key.substring(version().length()+1)).put("at",((Date)at).getTime()));}catch(IllegalArgumentException invalid){/* Malformed historic evidence is never invented or rewritten. */}
  }return rows;
 }
 static boolean exactHeading(String body,String heading){
  var pattern=java.util.regex.Pattern.compile("(?is)<h[1-6]\\b[^>]*>(.*?)</h[1-6]>");var matcher=pattern.matcher(body);
  String wanted=heading.replaceAll("\\s+"," ").trim();while(matcher.find()){String text=matcher.group(1).replaceAll("<[^>]+>","").replace("&amp;","&").replace("&#39;","'").replace("&nbsp;"," ").replaceAll("\\s+"," ").trim();if(text.equalsIgnoreCase(wanted))return true;}return false;
 }
 static JSONObject mini(JSONObject q){for(JSONObject term:objects(catalog().getJSONArray("glossary")))if(term.getString("term").equals(q.getString("heading"))&&term.has("mini_lesson"))return term.getJSONObject("mini_lesson");throw new IllegalArgumentException("The matching learning explanation is unavailable.");}
 static JSONObject recommend(IContext c)throws Exception{return recommend(c,"");}
 static JSONObject recommend(IContext c,String focus)throws Exception{
  String level=LearningAssessment.effectiveLevel(c);JSONArray evidence=attempts(c);JSONArray assessed=LearningAssessment.attempts(c);for(JSONObject a:objects(assessed))evidence.put(a);List<JSONObject> candidates=rank(level,evidence,focus);
  Map<String,IMendixObject> progress=new HashMap<>();for(IMendixObject e:mine(c,"LearningEvidence"))if(text(c,e,"Kind").equals("Project")&&text(c,e,"EvidenceKey").startsWith(version()+":")){String code=text(c,e,"EvidenceKey").substring(version().length()+1);IMendixObject prior=progress.get(code);Date at=e.getValue(c,"RecordedAt"),before=prior==null?null:prior.getValue(c,"RecordedAt");if(prior==null||at!=null&&(before==null||at.after(before)))progress.put(code,e);}
  for(JSONObject project:objects(catalog().getJSONArray("projects"))){String code=project.getString("system");IMendixObject saved=progress.get(code);String status=saved==null?"Not started":text(c,saved,"Status");if(status.equals("Completed"))continue;boolean resume=saved!=null;int gap=Math.abs(depth(level)-depth(project.getString("level")));if(gap>0)continue;JSONObject item=new JSONObject().put("concept","project:"+code).put("system",code).put("concept_title",project.getString("title")).put("level",project.getString("level")).put("lab",project.getString("lab")).put("score",resume?90:25-gap*5).put("source",resume?"Continue saved work":"Apply what you learn").put("reason",resume?"You have unfinished saved steps in this project.":"A practical "+level.toLowerCase(Locale.ROOT)+" project with a defined goal and checks.").put("practice",project.getString("goal")).put("resource_key","").put("heading",code).put("reading_kind","Guided simulation project").put("project",true);candidates.add(item);}
  candidates.sort(Comparator.<JSONObject>comparingDouble(x->x.getDouble("score")).reversed().thenComparing(x->x.getString("concept")));JSONArray items=new JSONArray();Set<String> seen=new HashSet<>();Map<String,IMendixObject> publicArticles=new HashMap<>();Set<String> unavailable=new HashSet<>();
  boolean hasProject=candidates.stream().anyMatch(x->x.optBoolean("project",false));int readingCount=0,projectCount=0;
  for(JSONObject q:candidates){if(q.optBoolean("project",false)&&projectCount>=1||!q.optBoolean("project",false)&&hasProject&&readingCount>=2)continue;String key=q.getString("resource_key");String destination=key+":"+q.getString("heading");if(!seen.add(destination))continue;
   if(q.optBoolean("project",false)){}
   else if(key.isBlank()){q.put("mini_lesson",mini(q)).put("reading_kind","Original explanation");}
   else {if(unavailable.contains(key))continue;IMendixObject article=publicArticles.get(key);if(article==null){try{article=resource(c,key);publicArticles.put(key,article);}catch(IllegalArgumentException notPublished){unavailable.add(key);continue;}}
    if(!exactHeading(text(c,article,"ArticleBody"),q.getString("heading")))continue;
    q.put("reading_title",text(c,article,"Title")).put("reading_kind","Published section");}
   q.remove("score");items.put(q);if(q.optBoolean("project",false))projectCount++;else readingCount++;if(items.length()==3)break;
  }
  return new JSONObject().put("items",items).put("saved_level",level).put("note",items.length()==0?"No suitable next reading is currently available. Your saved progress is retained.":"Uses your chosen recommendation level and latest answers for each concept. Correct answers retire old retry suggestions; they do not certify mastery.");
 }
 static boolean handle(IContext c,JSONObject request)throws Exception{
  String action=request.optString("action");if(!Set.of("openCoachReading","openCoachLab","openCoachProject").contains(action))return false;user(c);String id=request.optString("concept");
  if(id.startsWith("project:")){String code=id.substring(8);JSONObject guide=LearningDiscovery.guide(code);if(action.equals("openCoachLab"))openLab(c,guide.getString("lab"));else{LearningDiscovery.remember(c,"Project",code);Core.microflowCall("MyFirstModule.ACT_Learning_ShowProjects").execute(c);}return true;}
  JSONObject q=concept(id);
  if(action.equals("openCoachLab"))openLab(c,q.getString("lab"));
  else {String key=q.getString("resource_key");if(key.isBlank())throw new IllegalArgumentException("Read the original explanation in this suggestion.");IMendixObject article=resource(c,key);if(!exactHeading(text(c,article,"ArticleBody"),q.getString("heading")))throw new IllegalArgumentException("The matching published section is no longer available.");openResource(c,Long.toString(article.getId().toLong()));}
  return true;
 }
}
