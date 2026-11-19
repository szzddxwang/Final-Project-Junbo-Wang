package forgotpassword.implementation.handlers;

import com.mendix.core.Core;
import com.mendix.core.CoreException;
import com.mendix.externalinterface.connector.RequestHandler;
import com.mendix.m2ee.api.IMxRuntimeRequest;
import com.mendix.m2ee.api.IMxRuntimeResponse;
import com.mendix.systemwideinterfaces.core.IContext;
import com.mendix.systemwideinterfaces.core.IMendixObject;
import encryption.actions.EncryptString;
import forgotpassword.implementation.common.HTTPUtils;
import forgotpassword.implementation.common.LocaleExtractor;
import forgotpassword.implementation.common.PageTranslationUtil;
import forgotpassword.proxies.AccountPasswordData;
import org.apache.velocity.VelocityContext;
import org.apache.velocity.context.Context;

import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;
import java.io.Writer;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;
import java.util.Objects;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

public class ForgotPasswordHandler extends RequestHandler {
    public ForgotPasswordHandler(IContext context) {
    }

    private static final Pattern GUID_PATTERN = Pattern.compile("^/?([a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12})$");

    @Override
    protected void processRequest(IMxRuntimeRequest request, IMxRuntimeResponse response, String path) throws Exception {

        Matcher matcher = GUID_PATTERN.matcher(path);

        if (matcher.find()) {
            String guid = matcher.group(1);

            Core.getLogger(this.getClass().getName()).info("Extracted GUID: " + guid);

            IContext context = Core.createSystemContext(); // System context for security
            try {
                Map<String, Object> params = new HashMap<>();
                params.put("GUID", guid);

                Object result = Core.microflowCall("ForgotPassword.Step3_DL_SetNewPassword")
                        .inTransaction(true).withParams(params).execute(context);

                response.setContentType("text/html");
                response.setStatus(HttpServletResponse.SC_OK);

                VelocityContext velocityContext = new VelocityContext();

                // Writer to render the output
                Writer writer = response.getWriter();

                assert request != null;
                java.util.Locale locale = LocaleExtractor.getLocale(request);
                // Fetch translations
                Map<String, String> translations = PageTranslationUtil.getTranslations(locale);

                // Add translations to context
                for (Map.Entry<String, String> entry : translations.entrySet()) {
                    velocityContext.put(entry.getKey(), entry.getValue());
                }

                if(Objects.equals(result, "Failed"))
                    HTTPUtils.getEngine().mergeTemplate("invalidlink.vm", StandardCharsets.UTF_8.name(), velocityContext, writer);
                else if(Objects.equals(result, "Expired"))
                    HTTPUtils.getEngine().mergeTemplate("expiredlink.vm", StandardCharsets.UTF_8.name(), velocityContext, writer);
                else
                {
                    velocityContext.put("GUID", result);
                    HTTPUtils.getEngine().mergeTemplate("setnewpassword.vm", StandardCharsets.UTF_8.name(), velocityContext, writer);
                }

                writer.flush();

            } finally {
                if (context != null && context.isInTransaction()) {
                    context.endTransaction();
                }
            }

        } else {
            Core.getLogger(this.getClass().getName()).warn("GUID not found in path: " + path);
            response.setStatus(HttpServletResponse.SC_BAD_REQUEST); // 400
            response.getWriter().write("Invalid or missing GUID in the URL.");
        }
    }
}
