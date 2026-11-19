package myfirstmodule.learning;
import com.mendix.core.Core;
import com.mendix.systemwideinterfaces.core.*;
import com.mendix.thirdparty.org.json.*;
import java.util.*;
import static myfirstmodule.learning.LearningWorkspace.*;
import static myfirstmodule.learning.LearningActivities.*;

/** Provisional course placement, not a certification. Server-graded owned evidence. */
public final class LearningAssessment {
 static final String V="skills-v2-20261111";
 static final String LEGACY="skills-v1-20261109";
 static boolean acceptsEvidence(String v){return V.equals(v)||LEGACY.equals(v);}
 static void requireCurrentBank(String v){if(!V.equals(v))throw new IllegalArgumentException("This question set has changed. Reopen the check before submitting; your saved results are preserved.");}
 static List<JSONObject> questions(String form,String system){List<JSONObject> out=new ArrayList<>();for(JSONObject q:objects(new JSONArray(AssessmentBank.RAW)))if(q.getString("form").equals(form)&&(system.isBlank()||q.getString("system").equals(system)))out.add(q);return out;}
 static JSONArray publicQuestions(String form,String system){JSONArray out=new JSONArray();for(JSONObject x:questions(form,system)){JSONObject q=new JSONObject(x.toString());q.remove("answer");q.remove("explanation");out.put(q);}return out;}
 static String placement(int score,int foundation,int evidence){return score>=15&&foundation>=5&&evidence>=4?"Advanced":score>=10&&foundation>=4?"Intermediate":"Beginner";}
 static JSONObject grade(String form,String system,JSONArray answers){
  var bank=questions(form,system);if(bank.isEmpty()||answers==null||answers.length()!=bank.size())throw new IllegalArgumentException("Answer every question before submitting.");
  int score=0,f=0,e=0;JSONArray feedback=new JSONArray();JSONObject domains=new JSONObject();
  for(int i=0;i<bank.size();i++){JSONObject q=bank.get(i);Object raw=answers.get(i);if(!(raw instanceof Integer)||((Integer)raw)<0||((Integer)raw)>=q.getJSONArray("options").length())throw new IllegalArgumentException("Choose a valid answer for every question.");int a=(Integer)raw;boolean correct=a==q.getInt("answer");if(correct){score++;if(q.getString("tier").equals("Foundation"))f++;if(q.getString("tier").equals("Evidence"))e++;}String code=q.getString("system");domains.put(code,domains.optInt(code,0)+(correct?1:0));feedback.put(new JSONObject().put("id",q.getString("id")).put("system",code).put("concept",q.getString("concept")).put("correct",correct).put("answer",q.getInt("answer")).put("explanation",q.getString("explanation")));}
  JSONObject result=new JSONObject().put("version",V).put("form",form).put("score",score).put("total",bank.size()).put("foundation",f).put("evidence",e).put("domains",domains).put("feedback",feedback).put("answers",answers);
  if(form.equals("baseline"))result.put("level",placement(score,f,e));return result;
 }
 static JSONObject latest(IContext c,String kind,String key)throws Exception{
  JSONObject result=null;long newest=-1;
  if(!Set.of("Assessment","SkillsPractice","LearningPreference").contains(kind)||!key.matches("[A-Za-z0-9_]+"))throw new IllegalArgumentException("Unknown assessment evidence.");
  var rows=Core.createXPathQuery("//MyFirstModule.LearningEvidence[System.owner="+user(c)+"][Kind='"+kind+"'][EvidenceKey='"+V+":"+key+"' or EvidenceKey='"+LEGACY+":"+key+"']").addSort("RecordedAt",false).setAmount(5).execute(c);
  for(IMendixObject row:rows){Object time=row.getValue(c,"RecordedAt");if(time instanceof Date&&((Date)time).getTime()>newest){try{JSONObject d=new JSONObject(text(c,row,"DataJson"));if(!acceptsEvidence(d.optString("version")))continue;result=d.put("at",((Date)time).getTime());newest=((Date)time).getTime();}catch(IllegalArgumentException invalid){}}}return result;
 }
 static String recommendationSource(IContext c)throws Exception{JSONObject p=latest(c,"LearningPreference","recommendation");return p!=null&&p.optString("source").equals("selected")?"selected":"assessment";}
 static String chooseLevel(String selected,JSONObject assessment,String source){return assessment==null||source.equals("selected")?selected:assessment.getString("level");}
 static String effectiveLevel(IContext c)throws Exception{return chooseLevel(level(c),latest(c,"Assessment","baseline"),recommendationSource(c));}
 static void preference(IContext c,String source)throws Exception{save(c,"LearningPreference",V+":recommendation","Recommendation level source",source,0,0,new JSONObject().put("version",V).put("source",source),false);}
 static JSONArray attempts(IContext c)throws Exception{
  JSONArray result=new JSONArray();JSONObject baseline=latest(c,"Assessment","baseline");
  for(JSONObject s:objects(catalog().getJSONArray("systems"))){
   String code=s.getString("code");JSONObject practice=latest(c,"SkillsPractice",code);
   for(JSONObject source:new JSONObject[]{baseline,practice}){
    if(source==null)continue;JSONArray f=new JSONArray();
    for(JSONObject x:objects(source.getJSONArray("feedback")))if(x.getString("system").equals(code))f.put(x);
    if(f.length()>0)result.put(new JSONObject().put("version",version()).put("system",code).put("at",source.getLong("at")).put("feedback",f));
   }
  }return result;
 }
 static JSONObject run(IContext c,JSONObject q,boolean practice)throws Exception{
  boolean signed=signedIn(c);String action=q.optString("action","list"),code=q.optString("system","");String form=practice?"practice":"baseline";JSONObject graded=null;
  if(action.equals("submitAssessment")||action.equals("submitPractice")){
   user(c);if(practice){system(code);if(!action.equals("submitPractice"))throw new IllegalArgumentException("Use this practice form.");}else if(!action.equals("submitAssessment"))throw new IllegalArgumentException("Use this baseline form.");
   requireCurrentBank(q.optString("assessment_version"));graded=grade(form,practice?code:"",q.optJSONArray("answers"));save(c,practice?"SkillsPractice":"Assessment",V+":"+(practice?code:"baseline"),practice?system(code).getString("name")+" skills practice":"Electronics baseline assessment",practice?"Reviewed":"Assessed",graded.getInt("score"),graded.getInt("total"),graded,true);if(!practice)preference(c,"assessment");
  }else if(action.equals("useSelectedLevel")||action.equals("useAssessmentLevel")){user(c);if(action.equals("useAssessmentLevel")&&latest(c,"Assessment","baseline")==null)throw new IllegalArgumentException("Complete a baseline check first.");preference(c,action.equals("useSelectedLevel")?"selected":"assessment");
  }else if(action.equals("openReading")||action.equals("open")){system(code);openResource(c,reading(c,system(code).getString("resource_key")).getString("id"));}
  else if(action.equals("openPractice")){user(c);Core.microflowCall("MyFirstModule.ACT_Learning_ShowTutorials").execute(c);}
  else if(LearningCoach.handle(c,q)){}
  else if(!Set.of("list","start","practice").contains(action))throw new IllegalArgumentException("Unknown assessment action.");
  JSONObject out=new JSONObject().put("ok",true).put("mode",practice?"Tutorials":"Guided").put("signed_in",signed).put("assessment_version",V).put("message",signed?"Your answers guide the next reading and virtual project. Your self-selected level remains available.":"Sign in to take checks and save a personal recommendation. Full articles remain public.");
  if(signed){JSONObject last=latest(c,"Assessment","baseline");if(last!=null)out.put("assessment",last);out.put("saved_level",level(c)).put("effective_level",effectiveLevel(c)).put("recommendation_source",recommendationSource(c)).put("coach",LearningCoach.recommend(c));}
  boolean showing=(action.equals("start")&&!practice)||(practice&&(action.equals("practice")||action.equals("submitPractice")));
  if(showing){if(practice)system(code);out.put("questions",publicQuestions(form,practice?code:"")).put("selected_system",code).put("form",form);}
  JSONArray cards=new JSONArray();for(JSONObject s:objects(catalog().getJSONArray("systems"))){JSONObject item=reading(c,s.getString("resource_key")).put("system",s.getString("code")).put("system_name",s.getString("name"));if(signed){JSONObject last=latest(c,"SkillsPractice",s.getString("code"));if(last!=null)item.put("last_score",last.getInt("score")).put("last_total",last.getInt("total"));}cards.put(item);}out.put("items",cards);if(graded!=null)out.put("graded",graded);return out;
 }
}
