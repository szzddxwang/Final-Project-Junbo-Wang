package myfirstmodule.learning;
import java.util.*;
import java.util.regex.*;
/** Deterministic public-content retrieval; no private records or inferred labels. */
public final class LearningRelevance {
 private LearningRelevance(){}
 static String plain(String text){return text.replaceAll("(?is)<[^>]+>"," ").replace("&nbsp;"," ").replace("&amp;","&").replaceAll("\\s+"," ").trim();}
 static String normalize(String text){return plain(text).toLowerCase(Locale.ROOT).replace("i²c","i2c").replace("i2 c","i2c").replace('‑','-').replace('–','-');}
 static double score(String query,String title,String body,String summary){
  String q=normalize(query),t=normalize(title),d=normalize(summary);if(q.isBlank())return 0;
  double score=t.equals(q)?200:t.startsWith(q)?120:t.contains(q)?90:0;
  Matcher headings=Pattern.compile("(?is)<h[1-6]\\b[^>]*>(.*?)</h[1-6]>").matcher(body);
  while(headings.find())if(normalize(headings.group(1)).contains(q)){score+=40;break;}
  for(String token:q.split("\\s+")){if(t.contains(token))score+=12;if(d.contains(token))score+=3;}
  return score;
 }
 static String snippet(String query,String summary,String body){
  String text=plain(body),q=normalize(query);int pos=normalize(text).indexOf(q);
  if(pos<0||normalize(summary).contains(q))return summary;
  int start=Math.max(0,pos-55),end=Math.min(text.length(),pos+165);
  return (start>0?"…":"")+text.substring(start,end)+(end<text.length()?"…":"");
 }
}
