package myfirstmodule.learning;
import com.mendix.core.Core;
import com.mendix.systemwideinterfaces.core.*;
import com.mendix.thirdparty.org.json.*;
import java.util.*;
import static myfirstmodule.learning.LearningWorkspace.*;

/** Original learning activities, independently graded on the server. No diagnostic model changes. */
public final class LearningActivities {
 static final String M="MyFirstModule.";
 static JSONObject catalog(){return new JSONObject(LearningContent.RAW);}
 static boolean signedIn(IContext c){try{user(c);return true;}catch(SecurityException e){return false;}}
 static List<JSONObject> objects(JSONArray a){List<JSONObject> out=new ArrayList<>();for(int i=0;i<a.length();i++)out.add(a.getJSONObject(i));return out;}
 static String version(){return catalog().getString("version");}
 static JSONObject system(String code){for(JSONObject s:objects(catalog().getJSONArray("systems")))if(s.getString("code").equals(code))return s;throw new IllegalArgumentException("Select a supported electronics system.");}
 static String publishedFilter(IContext c){
  // Existing Guest/Learner entity access already enforces IsDeleted=false, while denying
  // direct access to that administrative member. Administrators have a broader existing
  // entity rule, so explicitly constrain their public discovery query. Never widen access.
  return "[IsActive=true()]"+(signedIn(c)&&admin(c)?"[IsDeleted=false()]":"");
 }
 static IMendixObject resource(IContext c,String code)throws Exception{
  // The route is resolved from current public records, never a stale client index or a submission table.
  if(!code.matches("[A-Z0-9_]+"))throw new IllegalArgumentException("Invalid article key.");
  var list=Core.createXPathQuery("//"+M+"Resource[ContentKey='"+code+"']"+publishedFilter(c)).setAmount(2).execute(c);
  if(list.size()!=1||text(c,list.get(0),"ArticleBody").isBlank())throw new IllegalArgumentException("A suitable published reading is not currently available.");return list.get(0);
 }
 static JSONObject reading(IContext c,String code)throws Exception{IMendixObject r=resource(c,code);return new JSONObject().put("id",Long.toString(r.getId().toLong())).put("title",text(c,r,"Title")).put("key",code);}
 static IMendixObject publicResource(IContext c,String value)throws Exception{
  if(!value.matches("[1-9][0-9]{0,18}"))throw new IllegalArgumentException("Select a published article.");var list=Core.createXPathQuery("//"+M+"Resource[id="+value+"]"+publishedFilter(c)).setAmount(1).execute(c);if(list.isEmpty())throw new IllegalArgumentException("This resource is no longer published.");return list.get(0);
 }
 static JSONObject tutorials(IContext c,JSONObject q)throws Exception{
  return LearningAssessment.run(c,q,true);
 }
 static JSONObject reader(IContext c,JSONObject q)throws Exception{
  String value=q.optString("resource_id","");IMendixObject r=publicResource(c,value);String key=text(c,r,"ContentKey"),action=q.optString("action","list");boolean signed=signedIn(c);JSONObject selected=null;for(JSONObject s:objects(catalog().getJSONArray("systems")))if(s.getString("resource_key").equals(key))selected=s;
  JSONObject out=new JSONObject().put("ok",true).put("mode","ReaderCheck").put("resource_id",value).put("title",text(c,r,"Title")).put("signed_in",signed).put("available",selected!=null).put("message",signed?"Optional knowledge check. Your article, source credits and diagnosis return remain unchanged.":"Read freely. You can try this check without signing in; sign in to save your attempts.");
  if(signed&&LearningCoach.handle(c,q)){}
  else if(action.equals("quiz")){if(selected==null)throw new IllegalArgumentException("This article has no knowledge check yet.");out.put("graded",grade(c,selected.getString("code"),q.optJSONArray("answers"),signed));}
  else if(action.equals("bookmark")){user(c);IMendixObject prior=evidence(c,"Bookmark",value);boolean adding=prior==null||!text(c,prior,"Status").equals("Saved");save(c,"Bookmark",value,text(c,r,"Title"),adding?"Saved":"Removed",0,0,new JSONObject().put("resource_id",value),false);out.put("message",adding?"Bookmark saved to My Learning.":"Bookmark removed. Your reading and quiz history remain.");}
  else if(action.equals("savePosition")){user(c);String heading=bounded(q,"heading",150);if(!LearningCoach.exactHeading(text(c,r,"ArticleBody"),heading))throw new IllegalArgumentException("Choose a current section of this published article.");save(c,"ReadingPosition",value,text(c,r,"Title"),"Saved",0,0,new JSONObject().put("heading",heading).put("resource_id",value),false);out.put("message","Reading section saved privately. This does not mark the lesson complete.");}
  else if(action.equals("openGlossary")){String term=bounded(q,"term",100);boolean matches=false;for(JSONObject g:objects(catalog().getJSONArray("glossary")))if(g.getString("term").equals(term)&&g.optString("resource_key").equals(key))matches=true;if(!matches)throw new IllegalArgumentException("Choose a term linked to this article.");LearningDiscovery.remember(c,"Glossary",term);Core.microflowCall("MyFirstModule.ACT_Learning_ShowGlossary").execute(c);}
  else if(action.equals("openLab")){if(selected==null)throw new IllegalArgumentException("No related Lab is defined for this article.");openLab(c,selected.getString("lab"));}
  else if(!action.equals("list"))throw new IllegalArgumentException("Unknown article learning action.");
  if(signed){if(action.equals("list"))save(c,"Recent",value,text(c,r,"Title"),"Opened",0,0,new JSONObject().put("resource_id",value),false);IMendixObject bookmark=evidence(c,"Bookmark",value);out.put("bookmarked",bookmark!=null&&text(c,bookmark,"Status").equals("Saved"));}
  if(signed&&action.equals("quiz"))out.put("coach",LearningCoach.recommend(c,selected.getString("code")));
  if(signed){IMendixObject position=evidence(c,"ReadingPosition",value);if(position!=null)out.put("reading_position",new JSONObject(text(c,position,"DataJson")));}
  JSONArray help=new JSONArray();for(JSONObject g:objects(catalog().getJSONArray("glossary")))if(g.optString("resource_key").equals(key)&&help.length()<2)help.put(new JSONObject().put("term",g.getString("term")).put("definition",g.getString("definition")));out.put("glossary_help",help);
  if(selected!=null)out.put("quiz",publicQuiz(selected.getString("code"))).put("lab",selected.getString("lab"));return out;
 }
 static String level(IContext c)throws Exception{
  long u=user(c);var rows=Core.createXPathQuery("//"+M+"UserProfile[MyFirstModule.UserProfile_Account="+u+"]").setAmount(2).execute(c);
  if(rows.size()!=1)return "Beginner";String level=text(c,rows.get(0),"LearningLevel");return Set.of("Beginner","Intermediate","Advanced").contains(level)?level:"Beginner";
 }
 static JSONObject path(String level){for(JSONObject p:objects(catalog().getJSONArray("paths")))if(p.getString("level").equals(level))return p;throw new IllegalArgumentException("Unknown learning level.");}
 static IMendixObject evidence(IContext c,String kind,String key)throws Exception{for(IMendixObject e:mine(c,"LearningEvidence"))if(text(c,e,"Kind").equals(kind)&&text(c,e,"EvidenceKey").equals(key))return e;return null;}
 static IMendixObject save(IContext c,String kind,String key,String title,String status,int score,int total,JSONObject data,boolean append)throws Exception{
  user(c);IMendixObject e=append?null:evidence(c,kind,key);if(e==null)e=Core.instantiate(c,M+"LearningEvidence");
  e.setValue(c,"Kind",kind);e.setValue(c,"EvidenceKey",key);e.setValue(c,"Title",title);e.setValue(c,"Status",status);e.setValue(c,"Score",score);e.setValue(c,"Total",total);e.setValue(c,"DataJson",data.toString());e.setValue(c,"RecordedAt",new Date());commitOwned(c,e);return e;
 }
 static JSONObject publicQuiz(String code){JSONObject s=system(code),q=new JSONObject().put("system",code).put("title",s.getString("name")+" knowledge check").put("version",version());JSONArray items=new JSONArray();for(JSONObject x:objects(s.getJSONArray("quiz")))items.put(new JSONObject().put("prompt",x.getString("prompt")).put("options",x.getJSONArray("options")));return q.put("questions",items);}
 static JSONObject grade(IContext c,String code,JSONArray answers,boolean persist)throws Exception{
  JSONArray qs=system(code).getJSONArray("quiz");if(answers==null||answers.length()!=qs.length())throw new IllegalArgumentException("Answer all three questions before checking.");int score=0;JSONArray feedback=new JSONArray();
  for(int i=0;i<qs.length();i++){JSONObject q=qs.getJSONObject(i);int a=answers.optInt(i,-1);if(a<0||a>=q.getJSONArray("options").length())throw new IllegalArgumentException("Choose one answer for every question.");boolean correct=a==q.getInt("answer");if(correct)score++;feedback.put(new JSONObject().put("correct",correct).put("answer",q.getInt("answer")).put("explanation",q.getString("explanation")).put("concept",q.getString("concept")).put("concept_title",q.getString("concept_title")));}
  boolean passed=score>=2;JSONObject result=new JSONObject().put("score",score).put("total",qs.length()).put("passed",passed).put("feedback",feedback).put("answers",answers);
  if(persist)save(c,"Quiz",version()+":"+code,system(code).getString("name")+" knowledge check",passed?"Passed":"Retry",score,qs.length(),result,true);
  return result.put("saved",persist);
 }
 static boolean quizPassed(IContext c,String code)throws Exception{for(IMendixObject e:mine(c,"LearningEvidence"))if(text(c,e,"Kind").equals("Quiz")&&text(c,e,"EvidenceKey").equals(version()+":"+code)&&text(c,e,"Status").equals("Passed"))return true;return false;}
 static String stepKey(String level,String step){return version()+":"+level+":"+step;}
 static boolean hasPair(IContext c,String lab)throws Exception{
  List<JSONObject> captures=new ArrayList<>();for(IMendixObject e:mine(c,"LearningNotebook"))if(!Boolean.TRUE.equals(e.getValue(c,"IsDeleted"))&&text(c,e,"Lab").equals(lab))captures.add(new JSONObject(text(c,e,"SnapshotJson")));
  for(int i=0;i<captures.size();i++)for(int j=i+1;j<captures.size();j++){
   JSONObject a=captures.get(i).getJSONObject("parameters"),b=captures.get(j).getJSONObject("parameters");if(captures.get(i).getString("native_capture_id").equals(captures.get(j).getString("native_capture_id")))continue;
   if(controlledPair(lab,a,b))return true;
   if(lab.equals("I2C")&&!a.optString("I2CFaultType").equals(b.optString("I2CFaultType"))&&(a.optString("I2CFaultType").equals("NORMAL")||b.optString("I2CFaultType").equals("NORMAL")))return true;
  }return false;
 }
 static boolean sameNumber(JSONObject a,JSONObject b,String key){
  // Mendix's bundled JSON library returns boxed Double/Integer values. Reference
  // equality rejects equal recorded voltages; missing values must not compare equal.
  Double x=a.optDouble(key),y=b.optDouble(key);
  return x!=null&&y!=null&&Double.isFinite(x)&&Double.isFinite(y)&&Double.compare(x,y)==0;
 }
 static boolean changedNumber(JSONObject a,JSONObject b,String key){
  Double x=a.optDouble(key),y=b.optDouble(key);
  return x!=null&&y!=null&&Double.isFinite(x)&&Double.isFinite(y)&&Double.compare(x,y)!=0;
 }
 static boolean controlledPair(String lab,JSONObject a,JSONObject b){
  return lab.equals("ADC")?sameNumber(a,b,"ReferenceVoltage")&&sameNumber(a,b,"ResolutionBits")&&changedNumber(a,b,"InputVoltage"):
   lab.equals("PWM")&&sameNumber(a,b,"FrequencyHz")&&sameNumber(a,b,"Voltage")&&changedNumber(a,b,"DutyCycle");
 }
 static JSONObject guided(IContext c,JSONObject q)throws Exception{
  return LearningAssessment.run(c,q,false);
 }

 static void openResource(IContext c,String value)throws Exception{
  IMendixObject selected=publicResource(c,value);
  Core.microflowCall(M+"ACT_Learning_ShowResource").withParam("Resource",selected).execute(c);
 }
 static void openLab(IContext c,String lab)throws Exception{
  user(c);String flow=switch(lab){case "ADC"->"ACT_OpenADCWorkbench";case "Sensor"->"ACT_Learning_ShowSensor";case "Waveform"->"ACT_Learning_ShowWaveform";case "PWM"->"ACT_Learning_ShowPWM";case "GPIO"->"ACT_Learning_ShowGPIO";case "I2C"->"ACT_Learning_ShowI2C";case "Active"->"ACT_Learning_ShowLabHome";default->throw new IllegalArgumentException("Unknown Lab.");};Core.microflowCall(M+flow).execute(c);
 }
}
