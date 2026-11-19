package myfirstmodule.research;
import com.mendix.core.Core;
import com.mendix.externalinterface.connector.RequestHandler;
import com.mendix.m2ee.api.IMxRuntimeRequest;
import com.mendix.m2ee.api.IMxRuntimeResponse;
import com.mendix.systemwideinterfaces.core.IContext;
import com.mendix.systemwideinterfaces.core.IMendixObject;
import com.mendix.systemwideinterfaces.core.ISession;
import java.nio.charset.StandardCharsets;
import java.util.Set;
/** Compatibility entry for the current V15 simulator, not a historical model. */
public final class TwoStageResearch {
 private static boolean registered;
 private static boolean authorized(ISession s) throws Exception {
  return s != null && !Boolean.TRUE.equals(s.getUser(s.createContext()).isAnonymous())
   && s.getUserRolesNames().stream().anyMatch(Set.of("Learner","Administrator")::contains);
 }
 public static synchronized String prepare(IContext context, IMendixObject diagnosis) throws Exception {
  if (context == null || !authorized(context.getSession())) throw new IllegalArgumentException("An authenticated learner is required.");
  if (!myfirstmodule.learning.CurrentLearningDisplay.owned(context,diagnosis)) throw new IllegalArgumentException("Open the simulator from your own diagnosis.");
  ActiveSimulationLab.register();
  if (!registered) { Core.addRequestHandler("two-stage-research/",new Handler()); registered=true; }
  return "Current V15 Circuit Diagnosis Simulator prepared. Original diagnosis readings remain unchanged.";
 }
 private static final class Handler extends RequestHandler {
  @Override protected boolean enableOptionsResponse() { return false; }
  @Override protected void processRequest(IMxRuntimeRequest request, IMxRuntimeResponse response, String path) throws Exception {
   response.addHeader("Cache-Control","no-store, private");
   response.addHeader("X-Content-Type-Options","nosniff");
   ISession session;
   try { session=getSessionFromRequest(request); } catch (Exception denied) { response.setStatus(403); return; }
   if (!authorized(session)) { response.setStatus(403); return; }
   String method=request.getHttpServletRequest().getMethod();
   if ("GET".equals(method) && (path.isEmpty() || "/".equals(path))) {
    response.setStatus(302); response.addHeader("Location","/active-simulation-lab/evidence"); return;
   }
   response.setStatus(410); response.setContentType("application/json; charset=utf-8");
   response.getOutputStream().write("{\"detail\":\"Use the current V15 Circuit Diagnosis Simulator. Historical research inference is not included in this release.\"}".getBytes(StandardCharsets.UTF_8));
  }
 }
}
