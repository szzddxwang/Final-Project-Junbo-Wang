package forgotpassword.implementation.common;

import com.mendix.core.Core;
import org.apache.velocity.app.VelocityEngine;
import org.apache.velocity.runtime.RuntimeConstants;
import org.apache.velocity.runtime.resource.loader.ClasspathResourceLoader;

import java.io.File;
import java.util.Properties;

import static org.apache.velocity.runtime.RuntimeConstants.*;

public class HTTPUtils {
    private final static String ModuleName = "forgotpassword";
    private final static String Templates = "templates";
    private final static String FILE_RESOURCE_PATH = "file.resource.loader.path";
    private final static String FILE_MODIFICATION_CHECK_INTERVAL = "resource.loader.file.modification_check_interval";
    private final static String RUNTIME_LOG = "runtime.log";
    private final static String VELOCITY_LOG = "velocity.log";
    private static VelocityEngine engine;

    private HTTPUtils() {}

    public static synchronized VelocityEngine getEngine() {

        if (engine == null) {
            engine = new VelocityEngine();
            final String templateDir = Core.getConfiguration().getResourcesPath().getAbsolutePath() + File.separator + ModuleName+ File.separator+ Templates+ File.separator;
            engine.setProperty(FILE_RESOURCE_PATH, templateDir);

            engine.setProperty(FILE_RESOURCE_LOADER_CACHE, "true");
            engine.setProperty(FILE_MODIFICATION_CHECK_INTERVAL, "60");
            engine.setProperty(RUNTIME_LOG, Core.getConfiguration().getTempPath().getAbsolutePath() + File.separator + VELOCITY_LOG);
            engine.init();
        }
        return engine;
    }
}
