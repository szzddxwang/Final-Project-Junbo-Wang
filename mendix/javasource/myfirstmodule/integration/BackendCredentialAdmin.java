package myfirstmodule.integration;

import com.mendix.core.Core;
import com.mendix.externalinterface.connector.RequestHandler;
import com.mendix.m2ee.api.IMxRuntimeRequest;
import com.mendix.m2ee.api.IMxRuntimeResponse;
import com.mendix.systemwideinterfaces.core.IContext;
import com.mendix.systemwideinterfaces.core.ISession;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.HexFormat;
import java.util.Objects;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

/** Native administrator enrollment of the deployment-scoped backend credential. */
public final class BackendCredentialAdmin extends RequestHandler {
    private static final String STORE = "MyFirstModule.BackendCredential";
    private static final String FORM = "/backend-connection/";
    private static final SecureRandom RANDOM = new SecureRandom();
    private static final ConcurrentHashMap<UUID, Ticket> TICKETS = new ConcurrentHashMap<>();
    private static boolean registered;

    private record Ticket(String value, long expires) {}

    public static synchronized void register() {
        if (registered) return;
        Core.addRequestHandler("backend-connection/", new BackendCredentialAdmin());
        Core.getLogger("MicroExploreBackendEnrollment").info("Administrator enrollment handler registered");
        registered = true;
    }

    @Override
    protected boolean enableOptionsResponse() { return false; }

    @Override
    protected void processRequest(IMxRuntimeRequest request, IMxRuntimeResponse response, String path) throws Exception {
        response.addHeader("Cache-Control", "private, no-store");
        response.addHeader("X-Content-Type-Options", "nosniff");
        response.addHeader("Referrer-Policy", "same-origin");
        response.addHeader("Content-Security-Policy", "default-src 'none'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'");
        if (!path.isEmpty() && !path.equals("/")) {
            reply(response, 404, "Page unavailable.");
            return;
        }
        ISession session;
        try { session = getSessionFromRequest(request); }
        catch (Exception unavailable) { session = null; }
        if (session == null || !session.getUserRolesNames().contains("Administrator")
                || Boolean.TRUE.equals(session.getUser(session.createContext()).isAnonymous())
                || "cross-site".equalsIgnoreCase(request.getHeader("Sec-Fetch-Site"))) {
            Core.getLogger("MicroExploreBackendEnrollment").info(
                "Enrollment rejected: sessionPresent=" + (session != null)
                + ", administratorRole=" + (session != null && session.getUserRolesNames().contains("Administrator"))
                + ", crossSite=" + "cross-site".equalsIgnoreCase(request.getHeader("Sec-Fetch-Site")));
            reply(response, 403, "An administrator session is required.");
            return;
        }
        IContext context = session.createContext();
        String method = request.getHttpServletRequest().getMethod();
        long now = System.currentTimeMillis();
        TICKETS.entrySet().removeIf(entry -> entry.getValue().expires < now);
        if (method.equals("GET")) {
            byte[] nonce = new byte[24];
            RANDOM.nextBytes(nonce);
            String encoded = HexFormat.of().formatHex(nonce);
            TICKETS.put(session.getId(), new Ticket(encoded, now + 600_000));
            response.setStatus(200);
            response.setContentType("text/html; charset=utf-8");
            response.getOutputStream().write(("<!doctype html><html lang=\"en\"><meta charset=\"utf-8\">"
                    + "<title>Backend connection</title><h1>Backend connection</h1>"
                    + "<form method=\"post\" action=\"" + FORM + "\">"
                    + "<input type=\"hidden\" name=\"csrf\" value=\"" + encoded + "\">"
                    + "<label>Deployment credential <input name=\"credential\" type=\"password\" "
                    + "autocomplete=\"off\" required minlength=\"64\" maxlength=\"64\"></label> "
                    + "<button>Save connection</button></form><p><a href=\"/\">Return to MicroExplore</a></p></html>")
                    .getBytes(StandardCharsets.UTF_8));
            return;
        }
        if (!method.equals("POST")) {
            reply(response, 405, "This method is not supported.");
            return;
        }
        if (!sameOrigin(request.getHeader("Origin"))) {
            Core.getLogger("MicroExploreBackendEnrollment").info("Enrollment rejected: originMismatch=true");
            reply(response, 403, "The connection change must come from this application.");
            return;
        }
        String contentType = request.getHeader("Content-Type");
        if (contentType == null || !contentType.startsWith("application/x-www-form-urlencoded")) {
            reply(response, 415, "Submit the connection settings form.");
            return;
        }
        String form = new String(request.getHttpServletRequest().getInputStream().readNBytes(513), StandardCharsets.UTF_8);
        if (!form.matches("csrf=[0-9a-f]{48}&credential=[0-9a-f]{64}")) {
            reply(response, 400, "Enter the 64-character deployment credential.");
            return;
        }
        Ticket ticket = TICKETS.remove(session.getId());
        String submittedTicket = form.substring(5, 53);
        if (ticket == null || ticket.expires < now || !MessageDigest.isEqual(ticket.value.getBytes(StandardCharsets.US_ASCII),
                submittedTicket.getBytes(StandardCharsets.US_ASCII))) {
            Core.getLogger("MicroExploreBackendEnrollment").info("Enrollment rejected: invalidOrExpiredTicket=true");
            reply(response, 403, "This setup form expired. Open it again.");
            return;
        }
        save(context, form.substring(65));
        reply(response, 200, "Backend connection saved. Return to MicroExplore to verify the connection.");
    }

    private static synchronized void save(IContext context, String credential) throws Exception {
        if (!credential.matches("[0-9a-f]{64}")) throw new IllegalArgumentException("Invalid deployment credential");
        var previous = Core.createXPathQuery("//" + STORE).setAmount(2).execute(context);
        if (previous.size() > 1) throw new IllegalStateException("Only one backend connection is supported");
        var row = previous.isEmpty() ? Core.instantiate(context, STORE) : previous.get(0);
        row.setValue(context, "AccessToken", credential);
        Core.commit(context, row);
    }

    private static boolean sameOrigin(String origin) {
        try {
            URI request = URI.create(origin);
            URI app = URI.create(Core.getConfiguration().getApplicationRootUrl());
            return Objects.equals(request.getScheme(), app.getScheme()) && Objects.equals(request.getAuthority(), app.getAuthority());
        } catch (RuntimeException invalid) { return false; }
    }

    private static void reply(IMxRuntimeResponse response, int status, String text) throws Exception {
        response.setStatus(status);
        response.setContentType("text/plain; charset=utf-8");
        response.getOutputStream().write(text.getBytes(StandardCharsets.UTF_8));
    }
}
