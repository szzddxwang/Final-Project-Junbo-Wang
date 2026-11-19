package myfirstmodule.research;

import com.mendix.core.Core;
import com.mendix.systemwideinterfaces.core.*;
import myfirstmodule.learning.GroundedLearningRanker;
import com.mendix.thirdparty.org.json.*;
import java.util.*;
import java.io.*;
import javax.swing.text.*;
import javax.swing.text.html.*;
import javax.swing.text.html.parser.ParserDelegator;

/** Current caller-authorized published resources only. No elevated context or writes. */
final class GuidedLearning {
 record Card(long id,String heading){}
 private static String text(IContext c,IMendixObject o,String k){Object v=o.getValue(c,k);return v==null?"":String.valueOf(v);}
 private static String publishedScope(IContext c){
  // The existing Learner entity rule already enforces IsDeleted=false. Learner
  // cannot read that member; CurrentLearningDisplay uses the same distinction.
  boolean admin=c.getSession().getUserRolesNames().contains("Administrator");
  return "[IsActive=true()]"+(admin?"[IsDeleted=false()]":"")+"[ArticleBody!=''][LicenseName!=''][Attribution!=''][SourceURL!='']";
 }
 static JSONObject recommend(IContext c,JSONObject q,Map<String,Card> cards)throws Exception{
  String system=q.getString("system"),fault=q.getString("fault"),next=q.optString("next","");
  if(!Set.of("ANALOG_ADC","DIGITAL_INPUT","LED_GPIO","I2C_SENSOR","UART_DEVICE","PWM_MOTOR_SERVO").contains(system)||!Set.of("Normal","ComponentFailure","ConfigurationFault","CommunicationFault","WiringFault","PolarityFault","PowerSupplyFault","SignalIntegrityFault","VoltageLevelFault").contains(fault)||next.length()>80)throw new IllegalArgumentException("Unsupported learning intent");
  Set<String> measured=new HashSet<>();JSONArray ma=q.optJSONArray("measured");if(ma!=null){if(ma.length()>80)throw new IllegalArgumentException("Too much evidence");for(int i=0;i<ma.length();i++)measured.add(ma.getString(i));}
  List<GroundedLearningRanker.Article> articles=new ArrayList<>();
  // Materialized Resource rows are the existing publication boundary; pending
  // and rejected Submission objects are never queried. Recheck at reading time.
  Map<IMendixIdentifier,IMendixObject> topics=new HashMap<>();
  for(IMendixObject r:Core.createXPathQuery("//MyFirstModule.Resource"+publishedScope(c)).setAmount(500).execute(c)){
   IMendixIdentifier ti=r.getValue(c,"MyFirstModule.Resource_Topic");IMendixObject topic=null;if(ti!=null){if(!topics.containsKey(ti))topics.put(ti,Core.retrieveId(c,ti));topic=topics.get(ti);}
   if(topic==null||!Boolean.TRUE.equals(topic.getValue(c,"IsActive")))continue;
   articles.add(new GroundedLearningRanker.Article(Long.toString(r.getId().toLong()),text(c,r,"Title"),text(c,r,"ArticleBody"),text(c,r,"ContentKey"),text(c,topic,"CatalogCode"),!text(c,topic,"AISection").equals("Microelectronics Foundations"),true,true,true,text(c,r,"LicenseName"),text(c,r,"Attribution")));
  }
  // The actual fault/next check is the request intent. A fixed system-wide
  // concept set incorrectly suggested addressing during an I2C power fault.
  // Unknown evidence has no invented fallback concept.
  Set<String> concepts=Set.of();
  var ranked=GroundedLearningRanker.rank(new GroundedLearningRanker.Diagnosis(system,fault,q.optDouble("probability",0.0),Set.of(),next,concepts,measured),articles).stream().limit(3).toList();
  cards.clear();JSONArray rows=new JSONArray();
  for(var r:ranked){String key=UUID.randomUUID().toString();cards.put(key,new Card(Long.parseLong(r.articleId()),r.heading()));rows.put(new JSONObject().put("title",r.articleTitle()).put("heading",r.heading()).put("reason",r.reason()).put("href","/two-stage-research/reading?card="+key));}
  return new JSONObject().put("recommendations",rows).put("message",rows.length()==0?"No current published accessible section matches this evidence. Your diagnosis is unchanged; use the available measurement guidance, if any.":"Current published sections; source and license are preserved. Human relevance review NOT VERIFIED.");
 }
 static String escape(String s){return s.replace("&","&amp;").replace("<","&lt;").replace(">","&gt;").replace("\"","&quot;").replace("'","&#39;");}
 static String reading(IContext c,Card card,long diagnosis)throws Exception{
  if(card==null)throw new IllegalArgumentException("Expired learning link");
  var rows=Core.createXPathQuery("//MyFirstModule.Resource[id="+card.id+"]"+publishedScope(c)).setAmount(1).execute(c);
  if(rows.size()!=1)throw new IllegalArgumentException("The publication is no longer available");IMendixObject r=rows.get(0);IMendixIdentifier ti=r.getValue(c,"MyFirstModule.Resource_Topic");IMendixObject topic=ti==null?null:Core.retrieveId(c,ti);if(topic==null||!Boolean.TRUE.equals(topic.getValue(c,"IsActive")))throw new IllegalArgumentException("Inactive topic");
  String section=section(text(c,r,"ArticleBody"),card.heading);if(section.isBlank())throw new IllegalArgumentException("This heading is no longer available");
  String url=text(c,r,"SourceURL");boolean safe=url.startsWith("https://")||url.startsWith("http://");
  return "<!doctype html><html lang='en'><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'><title>MicroExplore learning section</title><head><style nonce='reader-style'>main{max-width:850px;margin:auto;padding:24px;font:18px/1.6 system-ui;overflow-wrap:anywhere}pre{white-space:pre-wrap;font:inherit}</style></head><body><main><a target='_top' href='/p/diagnosis-session/"+diagnosis+"'>Return to Diagnosis</a><h1>"+escape(card.heading)+"</h1><p>Published reading: "+escape(text(c,r,"Title"))+"</p><p>This reading explains a concept; it does not confirm your circuit's fault. Return to the same saved diagnosis using the link above; its original readings remain unchanged.</p><pre>"+escape(section)+"</pre><p>License: "+escape(text(c,r,"LicenseName"))+"</p><p>"+escape(text(c,r,"Attribution"))+"</p>"+(safe?"<p><a rel='noopener noreferrer' href='"+escape(url)+"'>Original licensed source</a></p>":"")+"<a target='_top' href='/p/diagnosis-session/"+diagnosis+"'>Return to Diagnosis</a></main></body></html>";
 }
 private static String section(String html,String wanted)throws Exception{
  if(html.length()>1000000)throw new IllegalArgumentException("Reading too large");StringBuilder output=new StringBuilder();
  new ParserDelegator().parse(new StringReader(html),new HTMLEditorKit.ParserCallback(){StringBuilder heading;boolean selected,finished;int excluded;
   boolean head(HTML.Tag t){return t==HTML.Tag.H1||t==HTML.Tag.H2||t==HTML.Tag.H3||t==HTML.Tag.H4||t==HTML.Tag.H5||t==HTML.Tag.H6;}
   public void handleStartTag(HTML.Tag t,MutableAttributeSet a,int pos){if(t==HTML.Tag.SCRIPT||t==HTML.Tag.STYLE)excluded++;if(head(t)&&excluded==0){if(selected)finished=true;heading=new StringBuilder();}if(t==HTML.Tag.P&&selected&&!finished)output.append('\n');}
   public void handleText(char[] data,int pos){if(excluded==0){if(heading!=null)heading.append(data);else if(selected&&!finished&&output.length()<50000)output.append(data).append(' ');}}
   public void handleEndTag(HTML.Tag t,int pos){if(head(t)&&heading!=null){String v=heading.toString().trim();if(v.equalsIgnoreCase(wanted.trim())&&!finished){selected=true;output.append(v).append("\n\n");}heading=null;}if((t==HTML.Tag.SCRIPT||t==HTML.Tag.STYLE)&&excluded>0)excluded--;}
  },true);return output.toString().trim();
 }
}
