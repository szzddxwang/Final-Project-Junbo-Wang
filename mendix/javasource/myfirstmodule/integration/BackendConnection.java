package myfirstmodule.integration;

import com.mendix.core.Core;
import com.mendix.systemwideinterfaces.core.IContext;
import java.net.URI;
import java.net.http.HttpRequest;

/** Server-side connection for native API calls. Browser requests never receive credentials. */
public final class BackendConnection {
    public static final String CREDENTIAL_HEADER = "X-MicroExplore-Gateway";
    private static final String API = "MyFirstModule.DiagnosisAPIBaseURL";
    private static final URI LOCAL_RESEARCH = URI.create("http://127.0.0.1:8003");

    private BackendConnection() {}

    private static URI endpoint() {
        URI uri = URI.create(String.valueOf(Core.getConfiguration().getConstantValue(API)));
        if (uri.getHost() == null || uri.getUserInfo() != null || uri.getQuery() != null
                || uri.getFragment() != null || !uri.getPath().matches("/?")) {
            throw new IllegalStateException("The backend address must be an origin");
        }
        if (!"https".equalsIgnoreCase(uri.getScheme()) && !("http".equalsIgnoreCase(uri.getScheme())
                && ("127.0.0.1".equals(uri.getHost()) || "localhost".equalsIgnoreCase(uri.getHost())))) {
            throw new IllegalStateException("The backend requires HTTPS outside local development");
        }
        return uri;
    }

    public static boolean cloud() {
        return "https".equalsIgnoreCase(endpoint().getScheme());
    }

    public static HttpRequest.Builder request(IContext caller, String path) throws Exception {
        if (!path.matches("/[A-Za-z0-9_/-]+") || path.startsWith("//")) {
            throw new IllegalArgumentException("Invalid backend route");
        }
        boolean cloud = cloud();
        URI base = !cloud && path.startsWith("/research/") ? LOCAL_RESEARCH : endpoint();
        var builder = HttpRequest.newBuilder(base.resolve(path));
        if (cloud) {
            String credential = Core.microflowCall("MyFirstModule.SUB_ReadBackendCredential").execute(caller);
            if (credential == null || !credential.matches("[0-9a-f]{64}")) {
                throw new IllegalStateException("The cloud backend credential requires administrator configuration");
            }
            builder.header(CREDENTIAL_HEADER, credential);
        }
        return builder;
    }
}
