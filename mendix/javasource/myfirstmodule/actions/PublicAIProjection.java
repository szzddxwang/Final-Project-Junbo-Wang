package myfirstmodule.actions;

import com.mendix.thirdparty.org.json.JSONArray;
import com.mendix.thirdparty.org.json.JSONObject;

/** Allowlisted presentation snapshot. Raw research records never pass this boundary. */
public final class PublicAIProjection {
    private PublicAIProjection() {}

    public static java.util.Map<String,String> sections(JSONObject raw) {
        JSONObject safe=new JSONObject(create(raw));
        java.util.Map<String,String> result=new java.util.LinkedHashMap<>();
        JSONObject summary=safe.getJSONObject("summary");
        result.put("PublicSummaryText", join(summary,"message agreement next_action source"));
        result.put("PublicMeasurementsText", rows(safe,"simulation_summary","label display description"));
        StringBuilder models=new StringBuilder();
        JSONArray executions=raw.optJSONArray("model_executions");
        if(executions!=null)for(int i=0;i<Math.min(20,executions.length());i++) {
            JSONObject item=executions.optJSONObject(i);if(item==null)continue;
            String name=PublicAIText.name(item.optString("name",""),item.optString("model_version",""),summary.optString("title",""));
            String state=item.optString("state","");
            models.append(name).append(" — ").append(state.equals("EXECUTED")?"Executed":"Not executed").append('\n');
            models.append(join(fields(item,"result score scope"),"result score scope"));
            models.append('\n').append(PublicAIText.how(name));
            models.append('\n').append(PublicAIText.limitations(name,item.optBoolean("experimental",true),state,item.optString("scope","")));
            models.append("\n\n");
        }
        result.put("PublicModelsText",bounded(models.toString()));
        result.put("PublicExplanationText",bounded(rows(safe,"learning_cards","title text")+"\n"+
            rows(safe,"findings","title description evidence")+"\n"+
            rows(safe,"calculations","title formula substitution result assumptions")));
        JSONObject comparison=safe.optJSONObject("comparison");
        result.put("PublicComparisonText",comparison!=null && comparison.optString("status","").equals("AVAILABLE")?
            comparison.optString("conclusion",""):"");
        StringBuilder reliability=new StringBuilder();
        for(String key:new String[]{"limitations","recommendations"}) {
            JSONArray values=safe.optJSONArray(key);
            if(values!=null)for(int i=0;i<values.length();i++)reliability.append(values.optString(i)).append("\n\n");
        }
        result.put("PublicReliabilityText",bounded(reliability.toString()));
        return result;
    }

    private static String bounded(String text) {return text.strip().length()>29000?text.strip().substring(0,29000):text.strip();}
    private static String join(JSONObject object,String keys) {
        StringBuilder out=new StringBuilder();
        for(String key:keys.split(" ")) {
            String value=object.optString(key,"");
            if(!value.isBlank()){if(!out.isEmpty())out.append('\n');out.append(value);}
        }
        return bounded(out.toString());
    }
    private static String rows(JSONObject data,String key,String keys) {
        JSONArray values=data.optJSONArray(key);StringBuilder out=new StringBuilder();
        if(values!=null)for(int i=0;i<values.length();i++) {
            JSONObject item=values.optJSONObject(i);
            if(item!=null)out.append(join(item,keys)).append("\n\n");
        }
        return bounded(out.toString());
    }

    public static String create(JSONObject raw) {
        JSONObject out = new JSONObject().put("schema_version", "native-ai-view-v2");
        out.put("summary", fields(raw.optJSONObject("summary"),
            "title verdict message status agreement next_action source stale"));
        copyRows(raw, out, "simulation_summary", "label value unit display description", 40);
        copyRows(raw, out, "candidates", "label probability display score_type rank group", 100);
        copyRows(raw, out, "findings", "title description severity evidence", 100);
        copyRows(raw, out, "model_executions", "name state result score scope experimental short_name method_kind input_modality", 20);
        copyRows(raw, out, "policy_comparison", "name check benefit benefit_unit benefit_display relative_cost cost_display status", 20);
        copyRows(raw, out, "learning_cards", "title text", 20);
        copyRows(raw, out, "calculations", "title formula substitution result assumptions", 40);
        for (String key : new String[]{"recommendations", "limitations"}) {
            JSONArray values = raw.optJSONArray(key), safe = new JSONArray();
            if (values != null) for (int i=0; i<Math.min(values.length(),40); i++)
                if (values.opt(i) instanceof String text) safe.put(PublicAIText.clean(text));
            out.put(key,safe);
        }
        JSONObject comparison=raw.optJSONObject("comparison");
        if (comparison!=null) out.put("comparison",fields(comparison,"status conclusion"));
        JSONObject signal=raw.optJSONObject("signal_series");
        if (signal!=null) out.put("signal_series",signal(signal));
        return out.toString();
    }

    private static JSONObject fields(JSONObject input,String keys) {
        JSONObject out=new JSONObject();
        if(input==null)return out;
        for(String key:keys.split(" ")) {
            Object value=input.opt(key);
            if(value instanceof String text) {
                if(key.equals("state")) {
                    if(java.util.Set.of("EXECUTED","NOT_RUN_MISSING_INPUT","NOT_SUPPORTED_FOR_SYSTEM","MODEL_UNAVAILABLE","INFERENCE_FAILED").contains(text))out.put(key,text);
                } else out.put(key,PublicAIText.clean(text));
            }
            else if(value instanceof Boolean) out.put(key,value);
            else if(value instanceof Number n && Double.isFinite(n.doubleValue()))out.put(key,value);
            else if(value==JSONObject.NULL)out.put(key,JSONObject.NULL);
        }
        return out;
    }

    private static void copyRows(JSONObject raw,JSONObject out,String key,String keys,int maximum) {
        JSONArray input=raw.optJSONArray(key),result=new JSONArray();
        if(input!=null)for(int i=0;i<Math.min(input.length(),maximum);i++) {
            JSONObject row=input.optJSONObject(i);
            if(row!=null)result.put(fields(row,keys));
        }
        out.put(key,result);
    }

    private static JSONObject signal(JSONObject input) {
        JSONObject out=new JSONObject();
        JSONArray traces=input.optJSONArray("traces"),safe=new JSONArray();
        if(traces!=null) for(int i=0;i<Math.min(traces.length(),8);i++) {
            JSONObject trace=traces.optJSONObject(i);
            if(trace==null)continue;
            JSONArray x=trace.optJSONArray("x"),y=trace.optJSONArray("y");
            if(x==null || y==null || x.length()!=y.length() || x.length()<2 || x.length()>4096)continue;
            JSONArray tx=new JSONArray(),ty=new JSONArray();boolean valid=true;
            for(int j=0;j<x.length();j++) {
                Object xv=x.opt(j),yv=y.opt(j);
                if(!(xv instanceof Number n) || !Double.isFinite(n.doubleValue())) {valid=false;break;}
                tx.put(xv);
                if(yv==JSONObject.NULL)ty.put(JSONObject.NULL);
                else if(yv instanceof Number yn && Double.isFinite(yn.doubleValue()))ty.put(yv);
                else {valid=false;break;}
            }
            if(valid)safe.put(new JSONObject().put("x",tx).put("y",ty)
                .put("name",PublicAIText.clean(trace.optString("name")))
                .put("type","scatter").put("mode","lines").put("connectgaps",false));
        }
        out.put("traces",safe);
        JSONObject layout=new JSONObject().put("height",340).put("showlegend",true);
        JSONObject rawLayout=input.optJSONObject("layout");
        if(rawLayout!=null)for(String axis:new String[]{"xaxis","yaxis"}) {
            JSONObject rawAxis=rawLayout.optJSONObject(axis);
            JSONObject target=new JSONObject();
            if(rawAxis!=null) {
                Object title=rawAxis.opt("title");
                if(title instanceof JSONObject object)title=object.optString("text");
                if(title instanceof String text)target.put("title",PublicAIText.clean(text));
            }
            layout.put(axis,target);
        }
        out.put("layout",layout);
        if(input.opt("title") instanceof String title)out.put("title",PublicAIText.clean(title));
        return out;
    }
}
