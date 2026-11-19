package myfirstmodule.learning;
import com.mendix.core.Core;
import com.mendix.systemwideinterfaces.core.*;
import com.mendix.thirdparty.org.json.*;
import java.util.*;
import static myfirstmodule.learning.LearningWorkspace.*;
import static myfirstmodule.learning.LearningActivities.*;

/** Reports stay in the local website. Internal notes never enter a reporter response. */
public final class LearningFeedback {
 private LearningFeedback(){}
 static final Set<String> TYPES=Set.of("Incorrect content","Broken link","Accessibility / display","Technical issue","General suggestion");
 static JSONObject run(IContext c,JSONObject q,boolean management)throws Exception{
  if(!signedIn(c))return new JSONObject().put("ok",true).put("mode","Feedback").put("signed_in",false).put("message","Sign in through Account to send a report and privately follow its response. Do not include passwords or sensitive personal information.");
  if(management&&!admin(c))throw new SecurityException("Administrator access required.");
  String action=q.optString("action","list");JSONObject out=new JSONObject().put("ok",true).put("mode",management?"AdminFeedback":"Feedback").put("signed_in",true);
  if(action.equals("submit")){
   if(management)throw new IllegalArgumentException("Use the reporter form to create a report.");String type=bounded(q,"type",50),summary=bounded(q,"summary",160),body=bounded(q,"description",6000),reference=bounded(q,"reference",300);
   reference=LearningMetrics.safeReference(reference);
   List<String> missing=new ArrayList<>();if(!TYPES.contains(type))missing.add("Choose a problem type.");if(summary.length()<5)missing.add("Write a summary of at least five characters.");if(body.length()<20)missing.add("Describe the issue in at least twenty characters.");if(!missing.isEmpty())throw new IllegalArgumentException(String.join(" ",missing));
   if(reference.toLowerCase(Locale.ROOT).matches(".*(javascript:|data:|file:).*"))throw new IllegalArgumentException("Use a page title or a normal web page reference.");
   IMendixObject r=Core.instantiate(c,"MyFirstModule.LearningFeedbackReport");r.setValue(c,"ProblemType",type);r.setValue(c,"Summary",summary);r.setValue(c,"Description",body);r.setValue(c,"PageReference",reference);r.setValue(c,"Status","New");r.setValue(c,"Response","");r.setValue(c,"ReportedAt",new Date());r.setValue(c,"UpdatedAt",new Date());commitOwned(c,r);out.put("message","Report saved. Its status and any administrator response appear below. No external email was sent.");
  }else if(action.equals("update")){
   if(!management||!admin(c))throw new SecurityException("Administrator access required.");String value=q.optString("id","");if(!value.matches("[1-9][0-9]{0,18}"))throw new IllegalArgumentException("Select a report.");var rows=Core.createXPathQuery("//MyFirstModule.LearningFeedbackReport[id="+value+"]").setAmount(1).execute(c);if(rows.isEmpty())throw new IllegalArgumentException("Report unavailable.");var r=rows.get(0);String status=bounded(q,"status",30);if(!Set.of("New","In Review","Resolved").contains(status))throw new IllegalArgumentException("Select an allowed status.");r.setValue(c,"Status",status);r.setValue(c,"Response",bounded(q,"response",3000));r.setValue(c,"InternalNote",bounded(q,"internal_note",3000));r.setValue(c,"UpdatedAt",new Date());commitOwned(c,r);out.put("message","Report status and response saved. Internal notes remain administrator-only.");
  }else if(!action.equals("list"))throw new IllegalArgumentException("Unknown feedback action.");
  var records=management?Core.createXPathQuery("//MyFirstModule.LearningFeedbackReport").setAmount(500).execute(c):mine(c,"LearningFeedbackReport");JSONArray rows=new JSONArray();
  for(var r:records){JSONObject item=new JSONObject().put("id",Long.toString(r.getId().toLong())).put("type",text(c,r,"ProblemType")).put("summary",text(c,r,"Summary")).put("description",text(c,r,"Description")).put("reference",text(c,r,"PageReference")).put("status",text(c,r,"Status")).put("response",text(c,r,"Response")).put("at",text(c,r,"ReportedAt"));if(management)item.put("internal_note",text(c,r,"InternalNote"));rows.put(item);}
  return out.put("items",rows);
 }
}
