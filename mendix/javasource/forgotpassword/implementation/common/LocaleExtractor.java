package forgotpassword.implementation.common;

import com.mendix.core.Core;
import com.mendix.m2ee.api.IMxRuntimeRequest;
import forgotpassword.proxies.microflows.Microflows;
import org.apache.commons.lang3.StringUtils;


import java.util.Locale;


public final class LocaleExtractor {
    private static final String LOCALE_HEADER = "Accept-Language";
    public static final Locale DEFAULT_LANG = Locale.forLanguageTag("en-US");

    private LocaleExtractor() {}

    public static Locale getLocale(IMxRuntimeRequest request) {
        final String lang = request.getHeader(LOCALE_HEADER);
        if (StringUtils.isNotBlank(lang)) {
            final var languageRanges = Locale.LanguageRange.parse(lang);
            final var highestPriorityLang = languageRanges.get(0);

            Locale locale = Locale.forLanguageTag(highestPriorityLang.getRange());
            // Check if the locale is supported by the application
            String result = Microflows.retrieveLanguage(Core.createSystemContext(), getLanguageTag(locale));
            if (result != null) {
                return Locale.forLanguageTag(result.replace('_', '-'));
            } else {
                return DEFAULT_LANG;
            }
        }
        return DEFAULT_LANG;
    }

    public static String getLanguageTag(Locale locale) {
        return StringUtils.isNotBlank(locale.getCountry()) ? locale.getLanguage() + "_" + locale.getCountry() : locale.getLanguage();
    }
}
