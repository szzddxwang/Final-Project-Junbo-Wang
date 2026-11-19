package myfirstmodule.learning;

import com.mendix.core.Core;
import com.mendix.systemwideinterfaces.core.*;
import com.mendix.thirdparty.org.json.*;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;

/** Owned website learning records. Ordinary caller context only; no privileged context or model routing. */
public final class LearningWorkspace {
    private static final String M="MyFirstModule.";
    private static final long CAPTURE_TTL=30*60*1000L;
    private record Capture(long owner,long workbench,long at,JSONObject value){}
    private static final Map<String,Capture> CAPTURES=new ConcurrentHashMap<>();
    private record WriteScope(long actor,long objectId){}
    private static final ThreadLocal<WriteScope> WRITING=new ThreadLocal<>();
    private LearningWorkspace(){}
    static long user(IContext c){
        if(c==null||c.getSession()==null||Boolean.TRUE.equals(c.getSession().getUser(c).isAnonymous()))throw new SecurityException("Sign in to use your private learning records.");
        var r=c.getSession().getUserRolesNames();if(!r.contains("Learner")&&!r.contains("Administrator"))throw new SecurityException("This learning action is unavailable for your role.");
        return c.getSession().getUserId().toLong();
    }
    static boolean admin(IContext c){user(c);return c.getSession().getUserRolesNames().contains("Administrator");}
    static String text(IContext c,IMendixObject o,String key){Object v=o.getValue(c,key);return v==null?"":String.valueOf(v);}
    private static long id(String value){if(value==null||!value.matches("[1-9][0-9]{0,18}"))throw new IllegalArgumentException("The selected record is unavailable.");return Long.parseLong(value);}
    static IMendixObject owned(IContext c,String entity,String value)throws Exception{
        long u=user(c),record=id(value);var list=Core.createXPathQuery("//"+M+entity+"[id="+record+"][System.owner="+u+"]").setAmount(1).execute(c);
        if(list.isEmpty())throw new SecurityException("The selected record is unavailable.");return list.get(0);
    }
    static List<IMendixObject> mine(IContext c,String entity)throws Exception{
        var query=Core.createXPathQuery("//"+M+entity+"[System.owner="+user(c)+"]");
        if(entity.equals("LearningNotebook"))query.addSort("SavedAt",false);
        return query.setAmount(500).execute(c);
    }
    static String bounded(JSONObject q,String key,int length){String s=q.optString(key,"").trim();if(s.length()>length)throw new IllegalArgumentException(key+" is too long.");return s;}
    static void commitOwned(IContext c,IMendixObject o)throws Exception{
        if(WRITING.get()!=null)throw new IllegalStateException("Nested learning write refused.");
        WRITING.set(new WriteScope(user(c),o.getId().toLong()));try{Core.commit(c,o);}finally{WRITING.remove();}
    }
    public static Boolean validateWrite(IContext c,IMendixObject o){
        WriteScope scope=WRITING.get();if(o==null||scope==null||scope.actor()!=user(c)||scope.objectId()!=o.getId().toLong())throw new SecurityException("Use the authorized learning action. Direct record changes are not accepted.");
        if(o.getType().equals(M+"LearningNotebook")){
            JSONObject snapshot=new JSONObject(text(c,o,"SnapshotJson"));
            if(!text(c,o,"CaptureId").equals(snapshot.optString("native_capture_id"))||!text(c,o,"Lab").equals(snapshot.optString("lab"))||!"CONTROLLED_SIMULATION".equals(snapshot.optString("source_type"))||!snapshot.has("parameters")||!snapshot.has("results")||text(c,o,"Note").length()>3000)throw new IllegalArgumentException("Invalid captured experiment record.");
            java.time.Instant.parse(snapshot.getString("captured_at"));
        }
        return true;
    }
    public static IMendixObject create(IContext c,String mode)throws Exception{
        if(!Set.of("Notebook","Guided","Tutorials","Projects","Search","Progress","Glossary","Feedback","AdminFeedback","ReaderCheck","ProjectSteps","TopicFilters","Library","SubmissionFilter","Board","Applications").contains(mode))throw new IllegalArgumentException("Unknown learning page.");
        if(!Set.of("Search","Glossary","ReaderCheck","ProjectSteps","Tutorials","Projects","Feedback","TopicFilters","Library","Applications").contains(mode))user(c);
        if(mode.equals("AdminFeedback")&&!admin(c))throw new SecurityException("Administrator access required.");
        IMendixObject w=Core.instantiate(c,M+"NP_LearningWorkspace");w.setValue(c,"Mode",mode);w.setValue(c,"RequestJson","{}");
        w.setValue(c,"ResponseJson",initial(c,mode).toString());return w;
    }
    private static JSONObject initial(IContext c,String mode)throws Exception{
        if(mode.equals("Applications"))return LearningApplications.run(c,new JSONObject());
        if(mode.equals("Board"))return LearningBoard.initial(c);
        if(mode.equals("Notebook"))return notebook(c,new JSONObject().put("action","list"));
        if(mode.equals("Guided"))return LearningActivities.guided(c,new JSONObject().put("action","list"));
        if(mode.equals("Tutorials"))return LearningActivities.tutorials(c,new JSONObject().put("action","list"));
        if(mode.equals("Projects"))return LearningDiscovery.projects(c,new JSONObject().put("action","list"));
        if(mode.equals("Glossary"))return LearningDiscovery.glossary(c,new JSONObject().put("action","list"));
        if(mode.equals("Search"))return LearningDiscovery.search(c,new JSONObject().put("action","list"));
        if(mode.equals("SubmissionFilter"))return submissionFilter(c,new JSONObject());
        if(mode.equals("Library"))return LearningDiscovery.library(c,new JSONObject().put("action","list"));
        if(mode.equals("TopicFilters"))return LearningDiscovery.topicFilters(c);
        if(mode.equals("Progress"))return LearningDiscovery.progress(c,new JSONObject().put("action","list"));
        if(mode.equals("Feedback")||mode.equals("AdminFeedback"))return LearningFeedback.run(c,new JSONObject().put("action","list"),mode.equals("AdminFeedback"));
        return new JSONObject().put("mode",mode).put("message","This learning component has not been installed yet.");
    }
    public static Boolean command(IContext c,IMendixObject w)throws Exception{
        if(w==null||!w.getType().equals(M+"NP_LearningWorkspace"))throw new IllegalArgumentException("Reopen the learning page.");
        String raw=text(c,w,"RequestJson");if(raw.length()>300000)throw new IllegalArgumentException("Request too large.");
        JSONObject q=new JSONObject(raw),answer;
        if(raw.length()>20000&&!q.optString("area").equals("Board"))throw new IllegalArgumentException("Request too large.");
        try{answer=switch(q.optString("area","Notebook")){case "Applications" -> LearningApplications.run(c,q);case "Board" -> LearningBoard.command(c,w,q);case "Notebook" -> notebook(c,q);case "Guided" -> LearningActivities.guided(c,q);case "Tutorials" -> LearningActivities.tutorials(c,q);case "ReaderCheck" -> LearningActivities.reader(c,q);case "Projects" -> LearningDiscovery.projects(c,q);case "Glossary" -> LearningDiscovery.glossary(c,q);case "Search" -> LearningDiscovery.search(c,q);case "Library" -> LearningDiscovery.library(c,q);case "SubmissionFilter" -> submissionFilter(c,q);case "Progress" -> LearningDiscovery.progress(c,q);case "Feedback" -> LearningFeedback.run(c,q,false);case "AdminFeedback" -> LearningFeedback.run(c,q,true);default -> throw new IllegalArgumentException("Unknown learning action.");};}
        catch(SecurityException|IllegalArgumentException e){answer=new JSONObject(text(c,w,"ResponseJson")).put("ok",false).put("message",e.getMessage());}
        w.setValue(c,"ResponseJson",answer.put("request_id",q.optString("request_id","")).toString());return true;
    }
    private static JSONObject submissionFilter(IContext c,JSONObject q){user(c);String status=bounded(q,"status",20);if(!Set.of("","Draft","Pending","Approved","Rejected","Withdrawn").contains(status))throw new IllegalArgumentException("Choose a current submission status.");return new JSONObject().put("ok",true).put("mode","SubmissionFilter").put("status",status).put("message",status.isBlank()?"All your private submission records. Public contributions and retained decisions are listed separately below.":"Your "+status+" submissions. Other private records are retained.");}
    public static List<IMendixObject> filteredSubmissions(IContext c,IMendixObject workspace)throws Exception{
        user(c);if(workspace==null||!workspace.getType().equals(M+"NP_LearningWorkspace"))throw new IllegalArgumentException("Reopen My Submissions.");JSONObject q=new JSONObject(text(c,workspace,"RequestJson"));String status=submissionFilter(c,q).getString("status");List<IMendixObject> rows=Core.microflowCall("MyFirstModule.DS_Submission_OwnedRecords").execute(c);return rows.stream().filter(x->status.isBlank()||status.equals(text(c,x,myfirstmodule.proxies.Submission.MemberNames.SubmissionStatus.toString()))).toList();
    }
    public static IMendixObject readerContext(IContext c,IMendixObject resource)throws Exception{
        if(resource==null||!resource.getType().equals(M+"Resource"))throw new IllegalArgumentException("Select a published article.");
        IMendixObject w=create(c,"ReaderCheck");JSONObject q=new JSONObject().put("resource_id",Long.toString(resource.getId().toLong())).put("action","list");w.setValue(c,"RequestJson",q.toString());w.setValue(c,"ResponseJson",LearningActivities.reader(c,q).toString());return w;
    }
    public static String lab(IContext c,IMendixObject workbench,String operation,String lab)throws Exception{
        long u=user(c);if(workbench==null||!Set.of(M+"NP_ADCWorkbench",M+"NP_SensorWorkbench",M+"NP_WaveformWorkbench",M+"NP_MCUWorkbench").contains(workbench.getType()))throw new IllegalArgumentException("Reopen this Lab.");
        String key=u+":"+workbench.getId().toLong()+":"+lab;
        if(operation.equals("capture")){
            long now=System.currentTimeMillis();CAPTURES.entrySet().removeIf(e->now-e.getValue().at()>CAPTURE_TTL);
            if(CAPTURES.size()>2000)return "Simulation result retained. The optional notebook capture cache is full; reopen this Lab before saving a fresh run.";
            if(!text(c,workbench,"ErrorMessage").isBlank())return "No completed result to capture.";
            JSONObject v=new JSONObject().put("native_capture_id",UUID.randomUUID().toString()).put("source_type","CONTROLLED_SIMULATION").put("captured_at",new Date(now).toInstant().toString()).put("lab",lab).put("workbench_id",Long.toString(workbench.getId().toLong()));
            JSONObject params=new JSONObject(),results=new JSONObject();
            Set<String> inputs=switch(lab){case "ADC" -> Set.of("InputVoltage","ReferenceVoltage","ResolutionBits","Gain","OffsetVolts","NoiseStdVolts","SampleCount");case "Sensor" -> Set.of("TrueValue","StepChange","SampleRateHz","DurationSeconds","NoiseRms","Offset","DriftPerSecond","ResponseSeconds","FaultType");case "Waveform" -> Set.of("SystemType","SamplesJson","SamplingRateHz","ReferenceAvailable","DCLevel","ADCSignalType");case "PWM" -> Set.of("Peripheral","FrequencyHz","DutyCycle","Voltage","SampleCount","Periods");case "GPIO" -> Set.of("Peripheral","Mode","ExternalLevel","OutputLevel","Pull","ExpectedLevel");case "I2C" -> Set.of("Peripheral","I2CFaultType","Voltage","SampleCount");default -> throw new IllegalArgumentException("Unknown Lab.");};
            for(String k:inputs){Object value=workbench.getValue(c,k);params.put(k,value==null?JSONObject.NULL:value);}
            List<String> resultFields=lab.equals("ADC")?List.of("WaveformJson","AIAnalysisReport","EngineeringAnalysis","ExpectedCount","SimulatedCount","ResidualCounts","QuantizationStepVolts","Saturated"):lab.equals("Sensor")?List.of("WaveformJson","AIAnalysisReport","ResponseText"):List.of("WaveformJson","ResponseText");
            for(String k:resultFields){Object value=workbench.getValue(c,k);if(value!=null)results.put(k,value);}
            if(results.optString("WaveformJson","").isBlank())return "No completed capture to save.";
            v.put("parameters",params).put("results",results).put("parameter_units",units()).put("model_version_note","Exact API-returned model/version fields, if present, remain in the original result JSON. No model ID has been inferred.");
            CAPTURES.put(key,new Capture(u,workbench.getId().toLong(),now,v));return "Completed simulation captured.";
        }
        if(!operation.equals("save"))throw new IllegalArgumentException("Unknown notebook operation.");
        Capture capture=CAPTURES.get(key);if(capture==null||System.currentTimeMillis()-capture.at()>CAPTURE_TTL)return "Run a simulation first. Unsaved captures expire after 30 minutes; earlier saved experiments remain safe.";
        String captureId=capture.value().getString("native_capture_id");
        for(IMendixObject old:mine(c,"LearningNotebook"))if(text(c,old,"CaptureId").equals(captureId))return "This exact capture is already saved in My Experiments. Run again to create a distinct comparison.";
        IMendixObject note=Core.instantiate(c,M+"LearningNotebook");note.setValue(c,"CaptureId",captureId);note.setValue(c,"Lab",lab);note.setValue(c,"SnapshotJson",capture.value().toString());note.setValue(c,"Note","");note.setValue(c,"ComparisonRefs","[]");note.setValue(c,"SavedAt",new Date());note.setValue(c,"IsDeleted",false);commitOwned(c,note);
        return "Saved to My Experiments. The captured inputs and result are preserved, even if you now edit the controls. This is a simulation, not a hardware measurement.";
    }
    private static JSONObject units(){return new JSONObject().put("InputVoltage","V").put("ReferenceVoltage","V").put("Voltage","V").put("OffsetVolts","V").put("NoiseStdVolts","V RMS").put("FrequencyHz","Hz").put("SamplingRateHz","Hz").put("SampleRateHz","Hz").put("DurationSeconds","s").put("ResponseSeconds","s").put("DutyCycle","fraction 0–1").put("ResolutionBits","bits").put("SampleCount","samples").put("Periods","periods").put("TrueValue","°C").put("StepChange","°C").put("NoiseRms","°C RMS").put("Offset","°C").put("DriftPerSecond","°C/s");}
    static String[] namedNote(String raw){if(raw.startsWith("@name: ")&&raw.contains("\n")){int end=raw.indexOf('\n');return new String[]{raw.substring(7,end),raw.substring(end+1)};}return new String[]{"",raw};}
    static String composeNote(String name,String note){String value=name.isBlank()?note:"@name: "+name+"\n"+note;if(value.length()>3000)throw new IllegalArgumentException("Keep the experiment name and note within3000 characters.");return value;}
    private static JSONObject item(IContext c,IMendixObject n,boolean full){return new JSONObject().put("id",Long.toString(n.getId().toLong())).put("capture_id",text(c,n,"CaptureId")).put("lab",text(c,n,"Lab")).put("saved_at",text(c,n,"SavedAt")).put("saved_at_ms",n.getValue(c,"SavedAt") instanceof Date?((Date)n.getValue(c,"SavedAt")).getTime():0).put("name",namedNote(text(c,n,"Note"))[0]).put("note",namedNote(text(c,n,"Note"))[1]).put("snapshot",full?new JSONObject(text(c,n,"SnapshotJson")):JSONObject.NULL);}
    private static JSONObject notebook(IContext c,JSONObject q)throws Exception{
        user(c);String action=q.optString("action","list");if(action.equals("labHome")){Core.microflowCall("MyFirstModule.ACT_Learning_ShowLabHome").execute(c);return new JSONObject().put("ok",true).put("mode","Notebook");}if(action.equals("myLearning")){Core.microflowCall("MyFirstModule.ACT_Learning_ShowProgress").execute(c);return new JSONObject().put("ok",true).put("mode","Notebook");}JSONObject out=new JSONObject().put("ok",true).put("mode","Notebook");
        if(action.equals("list")){
            String query=bounded(q,"query",100).toLowerCase(Locale.ROOT),lab=bounded(q,"lab",30);boolean trash=q.optBoolean("trash");JSONArray rows=new JSONArray();
            for(IMendixObject n:mine(c,"LearningNotebook"))if(Boolean.TRUE.equals(n.getValue(c,"IsDeleted"))==trash&&(lab.isEmpty()||text(c,n,"Lab").equals(lab))&&(text(c,n,"Lab")+" "+text(c,n,"Note")+" "+text(c,n,"CaptureId")).toLowerCase(Locale.ROOT).contains(query))rows.put(item(c,n,false));
            return out.put("items",rows).put("query",bounded(q,"query",100)).put("lab",lab).put("trash",trash).put("message",trash?"Deleted experiments are private. Restore any record to your notebook.":rows.length()==0?"No saved experiments match. Run a Lab, then choose Save Experiment.":"Your newest 500 saved controlled simulations are searched; newest records appear first.");
        }
        IMendixObject n=owned(c,"LearningNotebook",q.optString("id"));if(action.equals("restore")){n.setValue(c,"IsDeleted",false);commitOwned(c,n);return notebook(c,new JSONObject().put("action","list").put("query",q.optString("query")).put("lab",q.optString("lab"))).put("message","Experiment restored. Original capture and notes are unchanged.");}if(Boolean.TRUE.equals(n.getValue(c,"IsDeleted")))throw new IllegalArgumentException("This notebook entry has been removed.");
        switch(action){
            case "open":return out.put("selected",item(c,n,true));
            case "rename":n.setValue(c,"Note",composeNote(bounded(q,"name",80).replace("\n"," ").replace("\r"," "),namedNote(text(c,n,"Note"))[1]));commitOwned(c,n);return out.put("selected",item(c,n,true)).put("message","Experiment name saved. Capture and result bytes are unchanged.");
            case "note":n.setValue(c,"Note",composeNote(namedNote(text(c,n,"Note"))[0],bounded(q,"note",3000)));commitOwned(c,n);return out.put("selected",item(c,n,true)).put("message","Note saved. The captured result is unchanged.");
            case "remove":if(!q.optBoolean("confirmed"))throw new IllegalArgumentException("Confirm removal of this notebook entry.");n.setValue(c,"IsDeleted",true);commitOwned(c,n);return notebook(c,new JSONObject().put("action","list").put("query",q.optString("query")).put("lab",q.optString("lab"))).put("message","Experiment moved to Deleted experiments. You can restore it at any time.").put("removed_id",q.optString("id"));
            case "compare":{
                IMendixObject other=owned(c,"LearningNotebook",q.optString("other_id"));if(n.getId().equals(other.getId())||Boolean.TRUE.equals(other.getValue(c,"IsDeleted")))throw new IllegalArgumentException("Select two distinct retained captures.");
                JSONObject a=new JSONObject(text(c,n,"SnapshotJson")),b=new JSONObject(text(c,other,"SnapshotJson"));
                if(!text(c,n,"Lab").equals(text(c,other,"Lab"))||!Objects.equals(a.getJSONObject("parameters").optString("SystemType"),b.getJSONObject("parameters").optString("SystemType"))||!Objects.equals(a.getJSONObject("parameters").optString("Peripheral"),b.getJSONObject("parameters").optString("Peripheral")))throw new IllegalArgumentException("Choose compatible runs from the same Lab and system.");
                for(IMendixObject x:List.of(n,other)){JSONArray refs=new JSONArray(text(c,x,"ComparisonRefs"));String peer=Long.toString((x==n?other:n).getId().toLong());boolean seen=false;for(int i=0;i<refs.length();i++)seen|=peer.equals(refs.getString(i));if(!seen){refs.put(peer);x.setValue(c,"ComparisonRefs",refs.toString());commitOwned(c,x);}}
                return out.put("comparison",new JSONArray().put(item(c,n,true)).put(item(c,other,true))).put("message","Two existing saved captures; no simulation was rerun.");
            }
            default:throw new IllegalArgumentException("Unknown notebook action.");
        }
    }
}
