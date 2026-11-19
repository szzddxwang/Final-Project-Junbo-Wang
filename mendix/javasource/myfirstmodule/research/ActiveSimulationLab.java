package myfirstmodule.research;

import com.mendix.core.Core;
import myfirstmodule.integration.BackendConnection;
import com.mendix.externalinterface.connector.RequestHandler;
import com.mendix.m2ee.api.*;
import com.mendix.systemwideinterfaces.core.*;
import java.io.*;
import java.net.*;
import java.net.http.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.time.Duration;
import java.security.SecureRandom;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;

/** Native authenticated virtual Lab bridge. No entities, permission changes or elevated context. */
public final class ActiveSimulationLab {
 private static final Path SWITCH=myfirstmodule.integration.BackendPaths.config("research.enabled");
 private static final ConcurrentHashMap<UUID,Ticket> TICKETS=new ConcurrentHashMap<>();
 private static final SecureRandom RANDOM=new SecureRandom();
 private static final HttpClient HTTP=HttpClient.newBuilder().version(HttpClient.Version.HTTP_1_1).connectTimeout(Duration.ofSeconds(3)).followRedirects(HttpClient.Redirect.NEVER).build();
 private record Ticket(String csrf,long expires){}
 private static boolean registered;
 public static synchronized void register(){if(!registered){Core.addRequestHandler("active-simulation-lab/",new Handler());registered=true;}}
 private static boolean authorized(ISession s)throws Exception{return s!=null&&!Boolean.TRUE.equals(s.getUser(s.createContext()).isAnonymous())&&s.getUserRolesNames().stream().anyMatch(Set.of("Learner","Administrator")::contains);}
 private static String random(){byte[] b=new byte[24];RANDOM.nextBytes(b);return HexFormat.of().formatHex(b);}
 private static boolean sameOrigin(String origin){try{URI a=URI.create(origin),b=URI.create(Core.getConfiguration().getApplicationRootUrl());return Objects.equals(a.getScheme(),b.getScheme())&&Objects.equals(a.getAuthority(),b.getAuthority());}catch(Exception e){return false;}}
 private static void reply(IMxRuntimeResponse r,int code,String body)throws Exception{r.setStatus(code);r.setContentType("application/json; charset=utf-8");r.getOutputStream().write(body.getBytes(StandardCharsets.UTF_8));}
 private static void denied(IMxRuntimeRequest q,IMxRuntimeResponse r,String path)throws Exception{
  if("GET".equals(q.getHttpServletRequest().getMethod())&&(path.isEmpty()||path.equals("/"))){
   r.setStatus(403);r.setContentType("text/html; charset=utf-8");r.addHeader("Content-Security-Policy","default-src 'none'; base-uri 'none'; frame-ancestors 'self'");
   r.getOutputStream().write("<!doctype html><html lang=\"en\"><meta charset=\"utf-8\"><title>Lab session ended</title><h1>Your native Lab session has ended</h1><p>Return to MicroExplore, sign in normally, then reopen Active simulation experiments. Expired captures cannot be replayed.</p><a href=\"/\" target=\"_top\">Return to MicroExplore</a></html>".getBytes(StandardCharsets.UTF_8));
  }else reply(r,403,"{\"detail\":\"Native sign-in required. Return to AI Lab and sign in normally; expired captures cannot be replayed.\"}");
 }
 private static final class Handler extends RequestHandler {
  @Override protected boolean enableOptionsResponse(){return false;}
  @Override protected void processRequest(IMxRuntimeRequest q,IMxRuntimeResponse r,String path)throws Exception{
   r.addHeader("Cache-Control","no-store, private");r.addHeader("X-Content-Type-Options","nosniff");r.addHeader("Referrer-Policy","same-origin");
   if(!BackendConnection.cloud()&&!Files.isRegularFile(SWITCH)){reply(r,503,"{\"detail\":\"Active experiments disabled. Existing Labs remain available.\"}");return;}
   ISession s;try{s=getSessionFromRequest(q);}catch(Exception noSession){denied(q,r,path);return;}
   if(!authorized(s)||"cross-site".equalsIgnoreCase(q.getHeader("Sec-Fetch-Site"))){denied(q,r,path);return;}
   String method=q.getHttpServletRequest().getMethod(),route=path.startsWith("/")?path.substring(1):path;long now=System.currentTimeMillis();
   TICKETS.entrySet().removeIf(e->e.getValue().expires<now);
   if("GET".equals(method)&&(route.isEmpty()||route.equals("renew")||route.equals("evidence"))){
    if(TICKETS.size()>=128&&!TICKETS.containsKey(s.getId())){reply(r,429,"{\"detail\":\"Lab capacity reached.\"}");return;}
    Ticket t=new Ticket(random(),now+900000);TICKETS.put(s.getId(),t);
    if(route.equals("renew")){reply(r,200,"{\"csrf\":\""+t.csrf+"\",\"expires_in_seconds\":900}");return;}
    String nonce=random();
    r.addHeader("Content-Security-Policy","default-src 'none'; script-src 'nonce-"+nonce+"'; style-src 'nonce-"+nonce+"'; connect-src 'self'; base-uri 'none'; frame-ancestors 'self'; form-action 'none'");
    r.setContentType("text/html; charset=utf-8");r.setStatus(200);r.getOutputStream().write((route.equals("evidence")?TwoCaptureHtml.VALUE:ActiveSimulationHtml.VALUE).replace("__NONCE__",nonce).replace("__CSRF__",t.csrf).getBytes(StandardCharsets.UTF_8));return;
   }
   Ticket t=TICKETS.get(s.getId());if(t==null||t.expires<now){reply(r,403,"{\"detail\":\"Lab session expired. Start a new virtual device; old captures cannot be replayed.\"}");return;}
   boolean get="GET".equals(method)&&Set.of("catalog","evidence/catalog").contains(route),post="POST".equals(method)&&Set.of("start","capture","evidence/start","evidence/capture","evidence/analyze","evidence/intervene").contains(route);
   if(!get&&!post){reply(r,405,"{\"detail\":\"Unsupported Lab operation.\"}");return;}
   byte[] body=new byte[0];
   if(post){String csrf=q.getHeader("X-Active-CSRF");if(csrf==null||!java.security.MessageDigest.isEqual(csrf.getBytes(StandardCharsets.UTF_8),t.csrf.getBytes(StandardCharsets.UTF_8))||!sameOrigin(q.getHeader("Origin"))||q.getHeader("Content-Type")==null||!q.getHeader("Content-Type").startsWith("application/json")){reply(r,403,"{\"detail\":\"Lab request authorization failed.\"}");return;}
    try(InputStream in=q.getHttpServletRequest().getInputStream()){body=in.readNBytes(route.startsWith("evidence/")?262145:8193);}if(body.length>(route.startsWith("evidence/")?262144:8192)){reply(r,413,"{\"detail\":\"Lab request too large.\"}");return;}}
   try{
    var request=BackendConnection.request(s.createContext(),route.startsWith("evidence/")?"/ai/"+route:"/ai/active-simulation/"+route).timeout(Duration.ofSeconds(12)).header("X-Native-Session",s.getId().toString()+":"+t.csrf);
    if(get)request.GET();else request.header("Content-Type","application/json").POST(HttpRequest.BodyPublishers.ofByteArray(body));
    HttpResponse<InputStream> result=HTTP.send(request.build(),HttpResponse.BodyHandlers.ofInputStream());byte[] bytes;try(InputStream in=result.body()){bytes=in.readNBytes(262145);}if(bytes.length>262144)throw new IOException("Oversized Lab response");
    r.setStatus(result.statusCode());r.setContentType("application/json; charset=utf-8");r.getOutputStream().write(bytes);
   }catch(Exception unavailable){reply(r,503,"{\"detail\":\"Active experiments temporarily unavailable. Existing Labs and stable diagnosis are preserved.\"}");}
  }
 }
}
