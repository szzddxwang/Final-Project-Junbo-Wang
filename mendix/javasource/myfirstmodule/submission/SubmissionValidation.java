package myfirstmodule.submission;

import java.util.*;

/** Shared, pure required-field rules. No persistence or execution of submitted content. */
public final class SubmissionValidation {
    public record Issue(String field,String message){}
    public record File(String name,boolean ready,SubmissionFilePolicy.Result result){}
    private SubmissionValidation(){}
    private static String value(Map<String,String> data,String key){return data.getOrDefault(key,"");}
    public static List<Issue> inspect(Map<String,String> v,boolean consent,Map<String,String> topic,List<File> files){
        List<Issue> errors=new ArrayList<>();
        String title=value(v,"Title"),description=value(v,"Description"),kind=value(v,"ContentKind"),destination=value(v,"Destination"),body=value(v,"BodyText"),code=value(v,"CodeText"),rights=value(v,"RightsDetails");
        if(title.isBlank()||title.length()>200)errors.add(new Issue("Title","Enter a title of 1 to 200 characters."));
        if(description.isBlank()||description.length()>200)errors.add(new Issue("Description","Enter a short description of 1 to 200 characters."));
        if(SubmissionFilePolicy.allowed(kind).isEmpty())errors.add(new Issue("ContentKind","Choose a Content type."));
        if(!Set.of("Resources","Topics","AITopics","Projects").contains(destination))errors.add(new Issue("Destination","Choose a Publish to destination."));
        else if(Set.of("Topics","AITopics").contains(destination)){
            if(topic==null)errors.add(new Issue("Submission_Topic","Choose an active Topic / category for this destination."));
            else if(destination.equals("Topics")&&(!topic.getOrDefault("code","").startsWith("FOUNDATION_")||!topic.getOrDefault("section","").equals("Microelectronics Foundations")))errors.add(new Issue("Submission_Topic","Choose a Microelectronics Foundations category for Topics."));
            else if(destination.equals("AITopics")&&!Set.of("circuit-design","semiconductor","vision","edge-ai","sensors","robotics","maintenance","digital-twin","troubleshooting","power").contains(topic.getOrDefault("code","")))errors.add(new Issue("Submission_Topic","Choose an AI Applications category for AI Topics."));
        }else if(topic!=null)errors.add(new Issue("Submission_Topic","Clear the optional Topic / category for general Resources or Projects."));
        if(Set.of("Resources","Topics","AITopics","Projects").contains(destination)&&!SubmissionFilePolicy.allowed(kind).isEmpty()&&destination.equals("Projects")!=kind.equals("Project"))errors.add(new Issue("Destination","Project content uses Projects; other types use Resources, Topics or AI Topics."));
        if(!consent)errors.add(new Issue("RightsConfirmed","Confirm the rights / ownership declaration."));
        if(rights.isBlank()||rights.length()>2000)errors.add(new Issue("RightsDetails","Give source, license and credit details (1 to 2000 characters)."));
        if(body.length()>100000)errors.add(new Issue("BodyText","Article / project body must be at most 100000 characters."));
        if(code.length()>200000)errors.add(new Issue("CodeText","Source code must be at most 200000 characters."));
        for(var limit:Map.of("PublicAuthorName",100,"Tags",500,"SuggestedTopicText",200,"URL",200).entrySet())if(value(v,limit.getKey()).length()>limit.getValue())errors.add(new Issue(limit.getKey(),limit.getKey()+" exceeds "+limit.getValue()+" characters."));
        String url=value(v,"URL");if(!url.isBlank())try{var uri=java.net.URI.create(url);if(!Set.of("http","https").contains(uri.getScheme())||uri.getHost()==null||uri.getRawUserInfo()!=null)throw new IllegalArgumentException();}catch(Exception ex){errors.add(new Issue("URL","Use a valid ordinary HTTP or HTTPS source URL without credentials, or leave it blank."));}
        if(files.size()>8)errors.add(new Issue("ContentKind","Use no more than eight original files."));
        int valid=0;
        for(File file:files){
            if(!file.ready())errors.add(new Issue("ContentKind",file.name()+": finish uploading and server validation, or explicitly remove this draft file."));
            if(!file.result().valid())errors.add(new Issue("ContentKind",file.name()+": "+file.result().message()));
            else if(!SubmissionFilePolicy.allowed(kind).contains(SubmissionFilePolicy.extension(file.name())))errors.add(new Issue("ContentKind",file.name()+" is incompatible with "+SubmissionFilePolicy.typeLabel(kind)+". Allowed files: "+SubmissionFilePolicy.allowedDescription(kind)+". Remove or replace it; no file was deleted."));
            else if(file.ready())valid++;
        }
        switch(kind){
            case "Article" -> {if(body.trim().length()<20&&valid==0)errors.add(new Issue("BodyText","Write an article body of at least 20 characters or upload one valid TXT / MD file."));}
            case "Document" -> {if(valid==0)errors.add(new Issue("BodyText","Upload one real PDF or DOCX document."));}
            case "Image" -> {if(valid==0)errors.add(new Issue("BodyText","Upload one real PNG, JPG, JPEG or WEBP image."));}
            case "Video" -> {if(valid==0)errors.add(new Issue("BodyText","Upload one real MP4 video."));}
            case "SourceCode" -> {if(code.trim().length()<20&&valid==0)errors.add(new Issue("CodeText","Provide source code of at least 20 characters or upload one permitted source file. Code is displayed only, never executed."));}
            case "Project" -> {if(body.trim().length()<20)errors.add(new Issue("BodyText","Provide the project description / steps (at least 20 characters) and any relevant supporting files. Only the 16 permitted formats are accepted."));}
            default -> errors.add(new Issue("BodyText","Choose a content type and provide its required real body, source code or file."));
        }
        return errors;
    }
    public static String message(List<Issue> errors){return errors.isEmpty()?"READY":"Cannot submit yet. Please complete:\n"+String.join("\n",errors.stream().map(e->"["+e.field()+"] "+e.message()).toList());}
}
