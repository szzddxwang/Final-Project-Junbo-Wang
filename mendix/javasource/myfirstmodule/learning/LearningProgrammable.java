package myfirstmodule.learning;
import com.mendix.core.Core;
import com.mendix.systemwideinterfaces.core.*;
import com.mendix.thirdparty.org.json.*;
import myfirstmodule.integration.BackendConnection;
import java.net.http.*;
import java.nio.file.*;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Duration;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;

/** Current-owner notebook projects; no new entity/member permission or system context. */
public final class LearningProgrammable {
 static final String VERSION="microexplore-programmable-v1",LAB="Programmable Circuit";
 private static final Map<String,JSONObject> BUILD=new ConcurrentHashMap<>();
 private static final Map<Long,String> OPEN=new ConcurrentHashMap<>();
 private static final HttpClient HTTP=HttpClient.newBuilder().version(HttpClient.Version.HTTP_1_1).connectTimeout(Duration.ofSeconds(3)).followRedirects(HttpClient.Redirect.NEVER).build();
 private static String sha(String s)throws Exception{return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(s.getBytes(StandardCharsets.UTF_8)));}
 private static JSONObject api(IContext caller,String action,JSONObject body)throws Exception{
  var builder=BackendConnection.request(caller,"/ai/programmable/"+action).timeout(Duration.ofSeconds(55)).header("Content-Type","application/json");
  if(!BackendConnection.cloud()){
   String token=Files.readString(myfirstmodule.integration.BackendPaths.config("programmable_worker.token")).trim();
   builder.header("X-MicroExplore-Worker",token);
  }
  var req=builder.POST(HttpRequest.BodyPublishers.ofString(body.toString())).build();
  try{var r=HTTP.send(req,HttpResponse.BodyHandlers.ofInputStream());byte[] b;try(var in=r.body()){b=in.readNBytes(1000001);}if(b.length>1000000)throw new IllegalArgumentException("Optional simulator response exceeded its size budget.");JSONObject result=new JSONObject(new String(b,StandardCharsets.UTF_8));if(r.statusCode()!=200)throw new IllegalArgumentException(result.opt("detail")instanceof String?result.getString("detail"):"Project validation refused unsupported fields or wiring. Check the supported parts and limits.");if(result.opt("diagnostics") instanceof String)result.put("diagnostics",plainDiagnostics(result.getString("diagnostics")));return result;}catch(java.io.IOException e){throw new IllegalArgumentException("The Circuit Workbench service is unavailable. Compilation and saving are temporarily unavailable; existing saved projects are unchanged. Please retry later or contact the site administrator.",e);}
 }
 // Terminal styling is not part of a compiler message; preserve source locations and line breaks.
 static String plainDiagnostics(String value){
  return value.replaceAll("\\x1B\\[[0-?]*[ -/]*[@-~]","");
 }
 private static JSONArray sourceFiles(JSONObject project){
  JSONArray files=new JSONArray();files.put(new JSONObject().put("name",project.getString("language").equals("arduino")?"sketch.ino":"main.py").put("content",project.getString("source")));
  JSONObject extra=project.optJSONObject("files");if(extra!=null){Iterator<?> keys=extra.keys();while(keys.hasNext()){String name=String.valueOf(keys.next());files.put(new JSONObject().put("name",name).put("content",extra.getString(name)));}}
  JSONObject peer=project.optJSONObject("peer");if(peer!=null){JSONArray ps=sourceFiles(peer);for(int i=0;i<ps.length();i++){JSONObject f=ps.getJSONObject(i);f.put("name","receiver/"+f.getString("name"));files.put(f);}}return files;
 }
 public static JSONObject initial(IContext c)throws Exception{JSONObject out=catalog(c);String record=OPEN.remove(LearningWorkspace.user(c));if(record!=null){IMendixObject n=LearningWorkspace.owned(c,"LearningNotebook",record);if(!LAB.equals(LearningWorkspace.text(c,n,"Lab"))||Boolean.TRUE.equals(n.getValue(c,"IsDeleted")))return out.put("message","This saved revision was deleted. Start a new draft or choose another saved revision.");JSONObject snap=new JSONObject(LearningWorkspace.text(c,n,"SnapshotJson"));out.getJSONObject("program").put("opened",snap.getJSONObject("programmable")).put("opened_capture",snap.optJSONObject("results"));}return out.put("message","Add parts, connect supported pins, edit firmware, then Run. Save drafts or captures in your private My Experiments.");}
 private static JSONObject catalog(IContext c)throws Exception{
  LearningWorkspace.user(c);JSONArray rows=new JSONArray();for(IMendixObject n:LearningWorkspace.mine(c,"LearningNotebook"))if(LAB.equals(LearningWorkspace.text(c,n,"Lab"))&&!Boolean.TRUE.equals(n.getValue(c,"IsDeleted"))){rows.put(new JSONObject().put("id",Long.toString(n.getId().toLong())).put("name",LearningWorkspace.namedNote(LearningWorkspace.text(c,n,"Note"))[0]).put("saved_at",LearningWorkspace.text(c,n,"SavedAt")));}
  return new JSONObject().put("ok",true).put("mode","Board").put("program",new JSONObject().put("version",VERSION).put("projects",rows).put("engine","avr8js 0.21.1 / rp2040js 1.4.1").put("compiler","Isolated Arduino CLI 1.2.2 / AVR core 1.8.6").put("pico_firmware_sha256","d9d97d8b495da476006125e73dc203a428ce7b6be27a5a76eda1dd85b2efe99d"));
 }
 public static JSONObject command(IContext c,IMendixObject workspace,JSONObject q)throws Exception{
  long owner=LearningWorkspace.user(c);String key=owner+":"+workspace.getId().toLong();String action=q.optString("action");JSONObject out=catalog(c),program=out.getJSONObject("program");
  if(action.equals("programCatalog"))return out;
  if(action.equals("programNavigate")){
   IMendixObject n=LearningWorkspace.owned(c,"LearningNotebook",q.optString("id"));if(!LAB.equals(LearningWorkspace.text(c,n,"Lab"))||Boolean.TRUE.equals(n.getValue(c,"IsDeleted")))throw new IllegalArgumentException("This circuit project is unavailable.");OPEN.put(owner,q.optString("id"));Core.microflowCall("MyFirstModule.ACT_Learning_ShowCircuitBoard").execute(c);return out;
  }
  if(action.equals("programCompile")){
   String source=q.getString("source");if(source.length()>20000||source.isBlank())throw new IllegalArgumentException("Enter an Arduino sketch of at most 20,000 characters.");
   JSONObject r=api(c,"submit",new JSONObject().put("source",source).put("files",q.optJSONObject("files")==null?new JSONObject():q.getJSONObject("files")).put("board_type",q.optString("board_type","uno_r3")).put("owner",Long.toString(owner)));r.put("at",System.currentTimeMillis());if(BUILD.size()>128)BUILD.clear();BUILD.put(key,r);program.put("compiled",r);return out.put("message","Compiling in a restricted worker. You can cancel this build; existing projects remain safe.");
  }
  if(action.equals("programPoll")||action.equals("programCancel")){
   JSONObject old=BUILD.get(key);if(old==null)throw new IllegalArgumentException("This build session expired. Start a new isolated compile.");
   JSONObject r=api(c,action.equals("programCancel")?"cancel":"poll",new JSONObject().put("owner",Long.toString(owner)).put("job_id",old.getString("job_id")));r.put("at",System.currentTimeMillis());BUILD.put(key,r);program.put("compiled",r);return out.put("message",r.optBoolean("pending")?(r.optBoolean("cancel_requested")?"Cancellation requested; waiting for isolated process shutdown.":"Isolated compilation is running."):r.optBoolean("ok")?"Real HEX compiled. Run executes MCU instructions.":"No firmware accepted. Check diagnostics; earlier saved revisions remain safe.");
  }
  if(action.equals("programDelete")){
   if(!Boolean.TRUE.equals(q.opt("confirmed")))throw new IllegalArgumentException("Confirm deletion of the selected saved revision.");
   String id=q.optString("id");IMendixObject n=LearningWorkspace.owned(c,"LearningNotebook",id);
   if(!LAB.equals(LearningWorkspace.text(c,n,"Lab")))throw new IllegalArgumentException("Select a saved Circuit Workbench revision.");
   if(!Boolean.TRUE.equals(n.getValue(c,"IsDeleted"))){n.setValue(c,"IsDeleted",true);LearningWorkspace.commitOwned(c,n);}
   OPEN.remove(owner,id);out=catalog(c);out.getJSONObject("program").put("deleted_id",id);
   return out.put("message","Saved revision moved to Deleted experiments in My Experiments. You can restore it there. Your open draft and other revisions are unchanged.");
  }
  if(action.equals("programOpen")){
   IMendixObject n=LearningWorkspace.owned(c,"LearningNotebook",q.optString("id"));if(!LAB.equals(LearningWorkspace.text(c,n,"Lab"))||Boolean.TRUE.equals(n.getValue(c,"IsDeleted")))throw new IllegalArgumentException("This circuit project is unavailable.");JSONObject snap=new JSONObject(LearningWorkspace.text(c,n,"SnapshotJson"));program.put("opened",snap.getJSONObject("programmable")).put("opened_capture",snap.optJSONObject("results"));return out.put("message","Opened your saved circuit and code. No simulation reran and no original record changed.");
  }
  if(action.equals("programSave")){
   JSONObject qproject=q.getJSONObject("project");if(qproject.toString().length()>60000)throw new IllegalArgumentException("Project is too large.");JSONObject checked=api(c,"validate",qproject),project=checked.getJSONObject("project");project.put("owner",Long.toString(owner));
   String capture=UUID.randomUUID().toString(),name=LearningWorkspace.bounded(project,"name",80),notes=LearningWorkspace.bounded(project,"notes",2600);JSONObject run=q.optJSONObject("run");if(run!=null&&run.toString().length()>180000)throw new IllegalArgumentException("Stored capture exceeds its declared trace budget.");
   // Browser worker output is explicitly a local simulation record, never hardware or a server-certified diagnosis.
   JSONObject result=new JSONObject().put("capture_state",run==null?"DRAFT_NOT_EXECUTED":"BROWSER_MCU_SIMULATION").put("server_certified_measurements",false);if(run!=null)result.put("run",run);
   JSONObject snapshot=new JSONObject().put("native_capture_id",capture).put("source_type","CONTROLLED_SIMULATION").put("captured_at",java.time.Instant.now().toString()).put("lab",LAB).put("parameters",new JSONObject().put("board",project.getString("board_type")).put("revision",project.getInt("revision"))).put("results",result).put("programmable",project).put("project_sha256",checked.getString("sha256")).put("source_sha256",checked.getString("source_sha256")).put("source_files",sourceFiles(project)).put("model_version_note",VERSION+"; original graph + actual browser MCU execution when captured. Not hardware; no production diagnosis classifier executed.");
   JSONObject build=BUILD.get(key);if(build!=null&&build.optBoolean("ok")&&project.getString("board_type").equals(build.optString("board_type"))&&System.currentTimeMillis()-build.optLong("at")<1800000&&checked.getString("source_sha256").equals(build.optString("source_sha256")))snapshot.put("compiled_artifact",new JSONObject().put("source_sha256",build.getString("source_sha256")).put("firmware_sha256",build.optString("firmware_sha256")).put("compiler",build.optString("compiler")).put("board_type",build.optString("board_type")).put("fqbn",build.optString("fqbn")));
   IMendixObject n=Core.instantiate(c,"MyFirstModule.LearningNotebook");n.setValue(c,"CaptureId",capture);n.setValue(c,"Lab",LAB);n.setValue(c,"SnapshotJson",snapshot.toString());n.setValue(c,"Note",LearningWorkspace.composeNote(name,notes));n.setValue(c,"ComparisonRefs","[]");n.setValue(c,"SavedAt",new Date());n.setValue(c,"IsDeleted",false);LearningWorkspace.commitOwned(c,n);out=catalog(c);return out.put("message","Saved a new immutable project revision to your private My Experiments. Earlier records and captured runs are retained.");
  }
  throw new IllegalArgumentException("Unsupported programmable action.");
 }
}
