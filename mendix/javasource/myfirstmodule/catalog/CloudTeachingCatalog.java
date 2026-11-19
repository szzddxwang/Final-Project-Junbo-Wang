package myfirstmodule.catalog;

import com.mendix.core.Core;
import com.mendix.systemwideinterfaces.core.IContext;
import com.mendix.systemwideinterfaces.core.IMendixObject;
import com.mendix.thirdparty.org.json.JSONArray;
import com.mendix.thirdparty.org.json.JSONObject;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.security.MessageDigest;
import java.util.HashMap;
import java.util.HexFormat;
import java.util.Map;
import java.util.Set;

/** Adds the fixed public catalog using an existing authenticated administrator context. */
public final class CloudTeachingCatalog {
    private static final String DIGEST = "2563c6c9583334badb746cc3c1cde40c119f61ef76251c9c758e099fba279776";
    private static final Set<String> TOPIC_FIELDS = Set.of("Name", "ShortDescription", "FullDescription",
            "LearningOrder", "IsActive", "AISection", "RelatedToolCode", "CatalogCode", "AITags");
    private static final Set<String> RESOURCE_FIELDS = Set.of("Title", "Description", "SourceName", "SourceURL",
            "EstimatedStudyTime", "Difficulty", "ResourceType", "IsFeatured", "IsActive", "Attribution",
            "ContentSHA256", "ContentKey", "LicenseName", "ArticleBody", "LicenseURL", "PublicAuthorName", "IsDeleted");
    private static final Set<String> PROJECT_FIELDS = Set.of("Title", "Description", "RequiredHardware",
            "Instructions", "EstimatedTime", "Difficulty", "IsActive", "PublicAuthorName", "IsDeleted");

    private CloudTeachingCatalog() {}

    public static synchronized String importCatalog(IContext context) throws Exception {
        if (context == null || context.getSession() == null
                || Boolean.TRUE.equals(context.getSession().getUser(context).isAnonymous())
                || !context.getSession().getUserRolesNames().contains("Administrator")) {
            throw new IllegalArgumentException("An authenticated administrator is required.");
        }
        byte[] bytes = Files.readAllBytes(Core.getConfiguration().getResourcesPath().toPath()
                .resolve("microexplore/public-teaching-catalog.json"));
        String digest = HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes));
        if (!DIGEST.equals(digest)) throw new IllegalStateException("Public catalog integrity check failed.");
        JSONObject catalog = new JSONObject(new String(bytes, StandardCharsets.UTF_8));
        if (!"microexplore-public-catalog-v1".equals(catalog.getString("schema"))
                || catalog.getJSONArray("topics").length() != 19
                || catalog.getJSONArray("resources").length() != 38
                || catalog.getJSONArray("projects").length() != 6) {
            throw new IllegalStateException("Unexpected public catalog version.");
        }
        int revised = AcademicProjectTitles.migrate(context);
        Map<String, IMendixObject> topics = existing(context, "Topic", "CatalogCode");
        Map<String, IMendixObject> resources = existing(context, "Resource", "ContentKey");
        Map<String, IMendixObject> projects = existing(context, "Project", "Title");
        context.startTransaction();
        try {
            int added = add(context, catalog.getJSONArray("topics"), "Topic", TOPIC_FIELDS, topics, topics);
            added += add(context, catalog.getJSONArray("resources"), "Resource", RESOURCE_FIELDS, resources, topics);
            added += add(context, catalog.getJSONArray("projects"), "Project", PROJECT_FIELDS, projects, topics);
            context.endTransaction();
            return "Public teaching catalog: " + added + " records added; " + revised + " curated project titles revised.";
        } catch (Exception failure) {
            context.rollbackTransaction();
            throw failure;
        }
    }

    private static Map<String, IMendixObject> existing(IContext context, String entity, String key) throws Exception {
        Map<String, IMendixObject> records = new HashMap<>();
        for (IMendixObject record : Core.createXPathQuery("//MyFirstModule." + entity).execute(context)) {
            String value = record.getValue(context, key);
            if (value != null && !value.isBlank() && records.putIfAbsent(value, record) != null) {
                throw new IllegalStateException("Ambiguous public catalog key in " + entity + ".");
            }
        }
        return records;
    }

    private static int add(IContext context, JSONArray entries, String entity, Set<String> allowed,
                           Map<String, IMendixObject> existing, Map<String, IMendixObject> topics) throws Exception {
        int added = 0;
        for (int index = 0; index < entries.length(); index++) {
            JSONObject entry = entries.getJSONObject(index);
            String key = entity.equals("Project") ? AcademicProjectTitles.displayTitle(entry.getString("key")) : entry.getString("key");
            if (existing.containsKey(key)) continue;
            JSONObject values = entry.getJSONObject("values");
            String[] fields = JSONObject.getNames(values);
            if (fields == null || !allowed.containsAll(Set.of(fields))) {
                throw new IllegalStateException("Unexpected catalog field.");
            }
            IMendixObject record = Core.instantiate(context, "MyFirstModule." + entity);
            for (String name : fields) record.setValue(context, name, entity.equals("Project") && name.equals("Title") ? key : values.get(name));
            if (!entry.isNull("topic")) {
                IMendixObject topic = topics.get(entry.getString("topic"));
                if (topic == null) throw new IllegalStateException("Required catalog topic is missing.");
                record.setValue(context, "MyFirstModule." + entity + "_Topic", topic.getId());
            }
            Core.commit(context, record);
            existing.put(key, record);
            added++;
        }
        return added;
    }
}
