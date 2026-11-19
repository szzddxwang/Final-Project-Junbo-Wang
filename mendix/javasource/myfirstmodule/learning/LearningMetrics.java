package myfirstmodule.learning;
import com.mendix.thirdparty.org.json.*;
import java.net.URI;
import java.util.*;
/** Deterministic activity accounting, separate from mastery or legacy topic progress. */
public final class LearningMetrics {
 private LearningMetrics(){}
 public static JSONObject pathProgress(JSONArray records,String version,String level,int total){
  Set<String> keys=new HashSet<>();String prefix=version+":"+level+":";
  for(int i=0;i<records.length();i++){JSONObject r=records.getJSONObject(i);String key=r.optString("key");if(r.optString("kind").equals("PathStep")&&r.optString("status").equals("Completed")&&key.startsWith(prefix)&&Set.of("read","experiment","quiz","reflect").contains(key.substring(prefix.length())))keys.add(key);}
  return new JSONObject().put("completed",keys.size()).put("total",total).put("scope","current saved-level guided path; explicit completion only");
 }
 public static String safeReference(String value){
  if(!value.matches("(?i)^https?://.*"))return value;
  try{URI u=URI.create(value);if(u.getHost()==null||u.getUserInfo()!=null)throw new IllegalArgumentException();return new URI(u.getScheme(),null,u.getHost(),u.getPort(),u.getPath(),null,null).toString();}
  catch(Exception e){throw new IllegalArgumentException("Use a page title or a valid web page URL without credentials.");}
 }
}
