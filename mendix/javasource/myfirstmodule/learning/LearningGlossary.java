package myfirstmodule.learning;
import com.mendix.systemwideinterfaces.core.*;
import com.mendix.thirdparty.org.json.*;
import java.util.*;
import static myfirstmodule.learning.LearningActivities.*;
import static myfirstmodule.learning.LearningWorkspace.*;

/** Public, original term explanations; optional links resolve current published chapters. */
public final class LearningGlossary {
 private LearningGlossary(){}
 static String normalized(String s){return java.text.Normalizer.normalize(s,java.text.Normalizer.Form.NFKD).replaceAll("\\p{M}","").toLowerCase(Locale.ROOT).replaceAll("[^a-z0-9]+"," ").trim();}
 static boolean matches(JSONObject e,String query,String category,String level,String letter){
  if(!category.isBlank()&&!category.equals(e.optString("category")))return false;
  if(!level.isBlank()&&!level.equals(e.optString("level")))return false;
  if(!letter.isBlank()&&!e.getString("term").toUpperCase(Locale.ROOT).startsWith(letter))return false;
  String hay=normalized(e.getString("term")+" "+e.optString("definition")+" "+e.optJSONArray("aliases"));
  for(String token:normalized(query).split("\\s+"))if(!hay.contains(token))return false;return true;
 }
 static JSONObject term(String name){for(JSONObject e:objects(catalog().getJSONArray("glossary")))if(e.getString("term").equals(name))return e;throw new IllegalArgumentException("Choose a current glossary term.");}
 static JSONObject run(IContext c,JSONObject q,String selectedTerm)throws Exception{
  String action=q.optString("action","list");
  if(action.equals("open")){
   JSONObject e=term(q.optString("term"));String key=e.optString("resource_key"),heading=e.optString("heading");
   if(key.isBlank()||heading.isBlank())throw new IllegalArgumentException("Read this term's complete explanation here; no matching external chapter is claimed.");
   IMendixObject article=resource(c,key);if(!LearningCoach.exactHeading(text(c,article,"ArticleBody"),heading))throw new IllegalArgumentException("The matching published chapter is no longer available.");
   openResource(c,Long.toString(article.getId().toLong()));
  }else if(!action.equals("list"))throw new IllegalArgumentException("Unknown glossary action.");
  // Only public catalog/filter state is returned; no learning history or submissions.
  bounded(q,"query",100);bounded(q,"category",32);bounded(q,"level",24);
  Map<String,IMendixObject> cache=new HashMap<>();Set<String> missing=new HashSet<>();JSONArray items=new JSONArray();var terms=objects(catalog().getJSONArray("glossary"));terms.sort(Comparator.comparing(e->e.getString("term")));
  for(JSONObject e:terms){boolean available=false;String key=e.optString("resource_key");
   if(!key.isBlank()&&!missing.contains(key)){
    IMendixObject article=cache.get(key);if(article==null){try{article=resource(c,key);cache.put(key,article);}catch(IllegalArgumentException unavailable){missing.add(key);}}
    if(article!=null){available=LearningCoach.exactHeading(text(c,article,"ArticleBody"),e.optString("heading"));if(available)e.put("lesson_title",text(c,article,"Title"));}
   }
   e.put("lesson_available",available);items.put(e);
  }
  return new JSONObject().put("ok",true).put("mode","Glossary").put("items",items).put("selected_term",selectedTerm).put("query",q.optString("query","")).put("message",items.length()+" electronics terms. Find a term, read its own explanation, then try an example.");
 }
}
