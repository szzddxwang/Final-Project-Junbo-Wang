package myfirstmodule.learning;
import com.mendix.core.Core;
import com.mendix.systemwideinterfaces.core.*;
import com.mendix.thirdparty.org.json.*;
/** Authenticated programmable workbench; retired finite-task entry removed. */
public final class LearningBoard {
 private LearningBoard(){}
 public static JSONObject initial(IContext c)throws Exception{return LearningProgrammable.initial(c);}
 public static JSONObject command(IContext c,IMendixObject workspace,JSONObject q)throws Exception{
  LearningWorkspace.user(c);String action=q.optString("action");
  if(action.startsWith("program"))return LearningProgrammable.command(c,workspace,q);
  if(action.equals("relatedLab"))LearningActivities.openLab(c,q.optString("lab"));
  else if(action.equals("labHome"))Core.microflowCall("MyFirstModule.ACT_Learning_ShowLabHome").execute(c);
  else if(action.equals("glossary"))Core.microflowCall("MyFirstModule.ACT_Learning_ShowGlossary").execute(c);
  else throw new IllegalArgumentException("The old peripheral tasks have been retired. Reopen Circuit Workbench. Saved records remain available.");
  return new JSONObject().put("ok",true).put("mode","Board");
 }
}