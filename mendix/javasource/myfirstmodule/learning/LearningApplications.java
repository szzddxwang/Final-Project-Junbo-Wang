package myfirstmodule.learning;
import com.mendix.core.Core;
import com.mendix.systemwideinterfaces.core.*;
import com.mendix.thirdparty.org.json.*;
import java.util.*;
import static myfirstmodule.learning.LearningWorkspace.*;
import static myfirstmodule.learning.LearningActivities.*;
public final class LearningApplications {
 static boolean hasTag(JSONArray values,String tag){for(int i=0;i<values.length();i++)if(values.getString(i).equals(tag))return true;return false;}
 static JSONObject run(IContext c,JSONObject q)throws Exception{
  String action=q.optString("action","list"),query=bounded(q,"query",100),subject=bounded(q,"subject",100),tag=bounded(q,"tag",80);Map<String,JSONObject> metadata=new HashMap<>();for(JSONObject x:objects(new JSONArray(ApplicationMetadata.RAW)))metadata.put(x.getString("key"),x);
  JSONArray result=new JSONArray();Set<String> subjects=new TreeSet<>(),tags=new TreeSet<>();boolean opened=false;
  var rows=Core.createXPathQuery("//MyFirstModule.Resource"+publishedFilter(c)).addSort("Title",true).setAmount(1000).execute(c);
  for(var r:rows){String key=text(c,r,"ContentKey");JSONObject meta=metadata.get(key);if(meta==null||text(c,r,"ArticleBody").isBlank())continue;String category=meta.getString("category");subjects.add(category);for(int i=0;i<meta.getJSONArray("tags").length();i++)tags.add(meta.getJSONArray("tags").getString(i));String id=Long.toString(r.getId().toLong());
   if(action.equals("open")&&id.equals(q.optString("id"))){openResource(c,id);opened=true;}
   if(!subject.isBlank()&&!subject.equals(category)||!tag.isBlank()&&!hasTag(meta.getJSONArray("tags"),tag)||!LearningDiscovery.matches(query,text(c,r,"Title"),text(c,r,"Description"),category,meta.getJSONArray("tags").toString()))continue;
   result.put(new JSONObject().put("id",id).put("title",text(c,r,"Title")).put("summary",text(c,r,"Description")).put("source",text(c,r,"SourceName")).put("category",category).put("tags",meta.getJSONArray("tags")).put("level",text(c,r,"Difficulty")).put("license",text(c,r,"LicenseName")).put("cover",meta.optString("cover")).put("cover_credit",meta.optString("cover_credit")).put("cover_alt",meta.optString("cover_alt")));
  }
  if(action.equals("open")&&!opened)throw new IllegalArgumentException("This AI application article is no longer available.");if(!Set.of("list","open").contains(action))throw new IllegalArgumentException("Unknown application action.");
  return new JSONObject().put("ok",true).put("mode","Applications").put("items",result).put("subjects",new JSONArray(subjects)).put("tags",new JSONArray(tags)).put("message",result.length()+" published AI electronics readings");
 }
}
