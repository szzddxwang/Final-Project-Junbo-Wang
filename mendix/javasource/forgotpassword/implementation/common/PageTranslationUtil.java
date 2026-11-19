package forgotpassword.implementation.common;

import forgotpassword.proxies.Labels;
import forgotpassword.proxies.Messages;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;

public class PageTranslationUtil {

    public static Map<String, String> getTranslations(Locale locale) {
        String languageTag = LocaleExtractor.getLanguageTag(locale);
        Map<String, String> map = new HashMap<>();

        for (Labels label : Labels.values()) {
            String caption = label.getCaption(languageTag);
            map.put(label.name(), caption);
        }

        for (Messages message : Messages.values()) {
            String caption = message.getCaption(languageTag);
            map.put(message.name(), caption);
        }

        return map;
    }
}
