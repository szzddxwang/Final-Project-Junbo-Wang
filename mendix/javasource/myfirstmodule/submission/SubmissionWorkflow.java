package myfirstmodule.submission;

import com.mendix.core.Core;
import com.mendix.systemwideinterfaces.core.*;
import com.mendix.thirdparty.org.json.JSONObject;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.*;
import static myfirstmodule.submission.SubmissionFiles.*;

/** Generic server-owned lifecycle. No system/sudo context, raw SQL, physical deletion or code execution. */
public final class SubmissionWorkflow {
    private static final Set<String> OPERATIONS=Set.of("submit","approve","reject","revision","remove-publication","remove-record","remove-both","remove-history","recall","restart");
    private static final Set<String> KINDS=Set.of("Article","Document","Image","Video","SourceCode","Project");
    private static final Set<String> AI_CODES=Set.of("circuit-design","semiconductor","vision","edge-ai","sensors","robotics","maintenance","digital-twin","troubleshooting","power");
    private SubmissionWorkflow(){}
    public static String execute(IContext caller,IMendixObject input,String command)throws Exception{
        actor(caller);long id=id(input,"Submission");
        if(command==null||command.length()>6000)throw unavailable();
        if(command.equals("preflight")){
            if(inWorker(caller,"workflow",id))return runWorker(caller);
            // The existing private native worker can inspect server-owned digest
            // metadata without granting those members to the client. It repeats
            // authenticated ownership/state checks before any file inspection.
            return transaction(caller,id,"workflow",id,Map.of("Submission",input,"Command",command),(c,a)->preflight(c,input));
        }
        boolean aiApproval=command.equals("approve-ai");
        JSONObject request=command.startsWith("{")?new JSONObject(command):new JSONObject().put("operation",aiApproval?"approve":command);
        String operation=request.optString("operation","");if(!OPERATIONS.contains(operation))throw unavailable();
        if(Set.of("approve","reject","remove-history").contains(operation)&&!actor(caller).admin())throw unavailable();
        if(inWorker(caller,"workflow",id))return runWorker(caller);
        // Only explicitly editable metadata is copied from the input. The worker
        // first re-fetches and authorizes the persisted owner/state, then applies it.
        // No client-controlled status, owner, provenance or publication link is read.
        if(operation.equals("submit"))request.put("draftInput",draftInput(caller,input));
        if(!command.startsWith("{")&&Set.of("approve","reject").contains(operation)){
            String note=text(caller,input,"RejectionReason");
            request.put("reason",note).put("classificationReason",note);
            if(operation.equals("approve")){
                request.put("destination",text(caller,input,"Destination"));
                var topic=reference(caller,input,"Submission_Topic");
                request.put("topicId",topic==null?"":Long.toString(topic.toLong()));
                request.put("aiApplicationConfirmed",aiApproval);
            }
        }
        return transaction(caller,id,"workflow",id,Map.of("Submission",input,"Command",command),(c,a)->{
            boolean adminOperation=Set.of("approve","reject","remove-history").contains(operation);
            if(adminOperation&&!a.admin())throw unavailable();
            IMendixObject s=submission(c,a,id,adminOperation||operation.startsWith("remove-"),operation.startsWith("remove-"));
            if(flag(c,s,"IsDeleted")&&!operation.startsWith("remove-"))throw unavailable();
            var resource=reference(c,s,"Submission_Resource");var project=reference(c,s,"Submission_Project");
            if(resource!=null&&project!=null)throw unavailable();
            if(resource!=null||project!=null)lockPublication(c,(resource!=null?resource:project).toLong());
            return switch(operation){
                case "submit" -> submit(c,a,s,request);
                case "approve" -> approve(c,a,s,request);
                case "reject" -> reject(c,a,s,request);
                case "revision" -> revision(c,a,s);
                case "recall" -> recall(c,a,s);
                case "restart" -> restart(c,a,s);
                case "remove-history" -> removeHistory(c,a,s,request);
                default -> remove(c,a,s,operation);
            };
        });
    }
    private static JSONObject draftInput(IContext c,IMendixObject input){
        JSONObject data=new JSONObject();
        for(String field:List.of("Title","Description","URL","SuggestedTopicText","Destination","ContentKind","PublicAuthorName","Tags","BodyText","CodeText","RightsDetails"))data.put(field,text(c,input,field));
        data.put("RightsConfirmed",flag(c,input,"RightsConfirmed"));
        var topic=reference(c,input,"Submission_Topic");data.put("topicId",topic==null?"":Long.toString(topic.toLong()));
        return data;
    }
    private static String submit(IContext c,Actor a,IMendixObject s,JSONObject request)throws Exception{
        String status=text(c,s,"SubmissionStatus");if(status.equals("Pending"))return "This submission is already awaiting review.";
        draft(c,s);
        if(request.has("draftInput")){
            JSONObject data=request.getJSONObject("draftInput");
            String limitError=draftInputLimits(data);
            if(limitError!=null)return "Cannot submit: "+limitError+" The existing saved draft is unchanged.";
            for(String field:List.of("Title","Description","URL","SuggestedTopicText","Destination","ContentKind","PublicAuthorName","Tags","BodyText","CodeText","RightsDetails")){String value=data.getString(field);s.setValue(c,field,Set.of("ContentKind","Destination").contains(field)&&value.isEmpty()?null:value);}
            s.setValue(c,"RightsConfirmed",data.getBoolean("RightsConfirmed"));
            String topic=data.getString("topicId");s.setValue(c,PREFIX+"Submission_Topic",topic.isEmpty()?null:one(c,"Topic","[id="+positiveId(topic)+"][IsActive=true()]").getId());
        }
        String error=validateContent(c,s);if(error!=null){Core.commit(c,s);return "Saved privately as a draft. Cannot submit: "+error;}
        s.setValue(c,"SubmissionStatus","Pending");s.setValue(c,"SubmittedDate",new Date());s.setValue(c,"ReviewedAt",null);s.setValue(c,"RejectionReason","");s.setValue(c,"RemovalNotice","");Core.commit(c,s);
        decision(c,a,s,"Submitted","Submitted for administrator review.",false);
        return "Submitted for review. Your originals remain private until an administrator publishes them.";
    }
    public static String draftInputLimits(JSONObject data){
        Map<String,Integer> limits=Map.ofEntries(Map.entry("Title",200),Map.entry("Description",200),Map.entry("URL",200),Map.entry("SuggestedTopicText",200),Map.entry("PublicAuthorName",100),Map.entry("Tags",500),Map.entry("RightsDetails",2000),Map.entry("BodyText",100000),Map.entry("CodeText",200000));
        List<String> errors=new ArrayList<>();for(var entry:limits.entrySet())if(data.optString(entry.getKey(),"").length()>entry.getValue())errors.add(entry.getKey()+" exceeds the allowed form limit.");
        if(!data.optString("ContentKind","").isEmpty()&&!KINDS.contains(data.optString("ContentKind","")))errors.add("Choose a supported content type.");
        if(!data.optString("Destination","").isEmpty()&&!Set.of("Resources","Topics","AITopics","Projects").contains(data.optString("Destination","")))errors.add("Choose a supported publishing destination.");
        return errors.isEmpty()?null:String.join(" ",errors);
    }
    private static String reject(IContext c,Actor a,IMendixObject s,JSONObject request)throws Exception{
        if(text(c,s,"SubmissionStatus").equals("Rejected"))return "Already declined. The existing feedback and history are unchanged.";
        if(!text(c,s,"SubmissionStatus").equals("Pending"))return "This contribution is no longer awaiting review. Refresh the review queue before making a decision.";
        requireState(c,s,"Pending");String reason=request.optString("reason","");
        if(reason.isBlank()||reason.length()>2000)return "Enter a rejection reason between 1 and 2000 characters.";
        s.setValue(c,"SubmissionStatus","Rejected");s.setValue(c,"RejectionReason",reason);s.setValue(c,"ReviewedAt",new Date());Core.commit(c,s);
        decision(c,a,s,"Rejected",reason,true);return "Rejected. The contributor will see your exact reason in My Submissions.";
    }
    private static String approve(IContext c,Actor a,IMendixObject s,JSONObject request)throws Exception{
        var owner=reference(c,s,"Submission_UserProfile");
        if(owner==null)throw unavailable();
        var profile=one(c,"UserProfile","[id="+owner.toLong()+"]");
        if(Objects.equals(reference(c,profile,"UserProfile_Account"),c.getSession().getUserId()))return "Cannot approve: a contribution must be approved by a different authorized administrator.";
        if(text(c,s,"SubmissionStatus").equals("Approved"))return publicationIsActive(c,s)?"Already published. No duplicate publication was created.":"The publication is removed. This action cannot republish it.";
        if(!text(c,s,"SubmissionStatus").equals("Pending"))return "This contribution is no longer awaiting review. Refresh the review queue before making a decision.";
        requireState(c,s,"Pending");
        String proposed=text(c,s,"Destination"),destination=request.optString("destination",proposed);
        IMendixIdentifier previousTopic=reference(c,s,"Submission_Topic"),topic=previousTopic;
        if(request.has("topicId")){String topicId=request.optString("topicId","");topic=topicId.isEmpty()?null:one(c,"Topic","[id="+positiveId(topicId)+"][IsActive=true()]").getId();}
        String note=request.optString("classificationReason","");
        if((!destination.equals(proposed)||!Objects.equals(topic,previousTopic))&&note.isBlank())return "Explain the destination or topic correction before publication.";
        if(note.length()>2000)return "The classification note must be 2000 characters or fewer.";
        if(destination.equals("AITopics")&&(!request.optBoolean("aiApplicationConfirmed",false)||note.trim().length()<30))return "Inspect the original material and record its real AI task, electronic system, inputs and outcome before approving AI Topics content.";
        s.setValue(c,"Destination",destination);s.setValue(c,PREFIX+"Submission_Topic",topic);
        String error=validateContent(c,s);if(error!=null){s.setValue(c,"Destination",proposed);s.setValue(c,PREFIX+"Submission_Topic",previousTopic);return "Cannot publish: "+error+" The contribution remains pending.";}
        boolean project=destination.equals("Projects");String entity=project?"Project":"Resource",link=project?"Submission_Project":"Submission_Resource";
        if(reference(c,s,project?"Submission_Resource":"Submission_Project")!=null)return "A moderated revision must retain its existing Resource or Project publication type. Create a separate contribution to change that type.";
        IMendixIdentifier existing=reference(c,s,link);IMendixObject publication;
        if(existing==null){publication=Core.instantiate(c,PREFIX+entity);if(!project)publication.setValue(c,"ContentKey","USER_CONTRIBUTION_"+s.getId().toLong());}
        else {publication=one(c,entity,"[id="+existing.toLong()+"]");requireManaged(c,s,publication,project);if(flag(c,publication,"IsDeleted"))throw unavailable();
            if(((Number)s.getValue(c,"RevisionNumber")).intValue()<=latestApprovedRevision(c,link,existing.toLong()))return "A current or newer revision is already published. This stale review cannot replace it. Create a fresh moderated revision from the latest approved submission.";
        }
        // Newly moderated library submissions have an explicit section marker.
        // Existing legacy publications are never reclassified in bulk.
        if(!project)publication.setValue(c,"ContentKey",(destination.equals("Resources")?"USER_CONTRIBUTION_LIBRARY_":"USER_CONTRIBUTION_")+s.getId().toLong());
        publication.setValue(c,"Title",text(c,s,"Title"));publication.setValue(c,"Description",text(c,s,"Description"));publication.setValue(c,"PublicAuthorName",text(c,s,"PublicAuthorName"));
        publication.setValue(c,"IsActive",true);publication.setValue(c,"IsDeleted",false);publication.setValue(c,"Difficulty","Beginner");
        publication.setValue(c,PREFIX+entity+"_Contributor",reference(c,s,"Submission_UserProfile"));publication.setValue(c,PREFIX+entity+"_Topic",topic);
        if(project){publication.setValue(c,"Instructions","Read the full project description and supplied files below. Steps and components are included only when supplied by the contributor.");publication.setValue(c,"EstimatedTime",0);}
        else {
            String body=article(text(c,s,"BodyText"),text(c,s,"CodeText"),text(c,s,"RightsDetails"));
            publication.setValue(c,"ArticleBody",body);publication.setValue(c,"ContentSHA256",HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(body.getBytes(StandardCharsets.UTF_8))));
            publication.setValue(c,"SourceName","Community contribution");publication.setValue(c,"SourceURL",text(c,s,"URL"));publication.setValue(c,"Attribution",text(c,s,"RightsDetails"));publication.setValue(c,"LicenseName","Contributor-declared rights");
            publication.setValue(c,"ResourceType",switch(text(c,s,"ContentKind")){case "Video"->"Video";case "Document"->"Documentation";case "SourceCode"->"Tutorial";default->"Article";});publication.setValue(c,"EstimatedStudyTime",0);
        }
        Core.commit(c,publication);
        // Retire only the old public copies of this contribution; staged originals and historic decisions remain.
        for(IMendixObject old:query(c,"SubmissionAttachment","[MyFirstModule.SubmissionAttachment_"+entity+"="+publication.getId().toLong()+"][IsPublished=true()][IsRemoved=false()]"))retire(c,old);
        for(IMendixObject original:originals(c,s.getId().toLong()))copyFile(c,s,original,publication,project,true);
        if(project){
            publishText(c,s,publication,"project-description.txt","Project description",text(c,s,"BodyText"),-3);
            if(!text(c,s,"CodeText").isEmpty())publishText(c,s,publication,"project-code.txt","Source code",text(c,s,"CodeText"),-2);
            publishText(c,s,publication,"source-and-rights.txt","Source and rights",text(c,s,"RightsDetails")+(text(c,s,"URL").isEmpty()?"":"\n\nSource URL: "+text(c,s,"URL")),-1);
        }
        s.setValue(c,PREFIX+link,publication.getId());s.setValue(c,"SubmissionStatus","Approved");s.setValue(c,"ReviewedAt",new Date());s.setValue(c,"RejectionReason","");Core.commit(c,s);
        decision(c,a,s,"Approved",note.isBlank()?"Administrator inspected the originals and confirmed the proposed destination.":note,true);
        return "Approved and published. Originals and review history are retained; retrying will not create another publication.";
    }
    public static String validateContent(IContext c,IMendixObject s)throws Exception{
        String result=inspectContent(c,s,s.getId().toLong());return result.equals("READY")?null:result;
    }
    /** Read-only server preflight: explicit existing-owner and Draft state checks.
     * New unsaved form objects can be inspected, but this command never persists them. */
    private static String preflight(IContext caller,IMendixObject input)throws Exception{
        Actor a=actor(caller);IContext c=caller;
        var rows=query(c,"Submission","[id="+input.getId().toLong()+"]");long parent=0;
        if(!rows.isEmpty()){var s=submission(c,a,input.getId().toLong(),false,false);draft(c,s);parent=s.getId().toLong();}
        return inspectContent(c,input,parent);
    }
    private static String inspectContent(IContext c,IMendixObject input,long parentId)throws Exception{
        Map<String,String> values=new HashMap<>();for(String field:List.of("Title","Description","URL","SuggestedTopicText","Destination","ContentKind","PublicAuthorName","Tags","BodyText","CodeText","RightsDetails"))values.put(field,text(c,input,field));
        Map<String,String> topic=null;var topicRef=reference(c,input,"Submission_Topic");
        try{topic=topicData(c,topicRef);}catch(Exception e){if(topicRef!=null)topic=Map.of("code","INVALID","section","");}
        List<SubmissionValidation.File> files=new ArrayList<>();
        if(parentId>0)for(IMendixObject file:originals(c,parentId)){
            SubmissionFilePolicy.Result result;
            try{result=SubmissionFilePolicy.validate(text(c,file,"Name"),originalBytes(c,file));}
            catch(Exception e){result=new SubmissionFilePolicy.Result(false,"","","","",e.getMessage());}
            boolean ready=flag(c,file,"HasContents")&&flag(c,file,"IsValidated")&&result.valid()&&result.digest().equals(text(c,file,"Digest"))&&result.mime().equals(text(c,file,"MediaType"));
            files.add(new SubmissionValidation.File(text(c,file,"Name"),ready,result));
        }
        return SubmissionValidation.message(SubmissionValidation.inspect(values,flag(c,input,"RightsConfirmed"),topic,files));
    }
    private static Map<String,String> topicData(IContext c,IMendixIdentifier id)throws Exception{
        if(id==null)return null;IMendixObject topic=one(c,"Topic","[id="+id.toLong()+"][IsActive=true()]");return Map.of("code",text(c,topic,"CatalogCode"),"section",text(c,topic,"AISection"));
    }
    public static String target(String destination,String kind,Map<String,String> topic){
        if(!Set.of("Resources","Topics","AITopics","Projects").contains(destination))return "Choose a legitimate publishing destination.";
        if(destination.equals("Projects")!=kind.equals("Project"))return "Project content must use the Projects destination; other content belongs in Resources, Topics or AI Topics.";
        if(Set.of("Resources","Projects").contains(destination))return topic==null?null:"Clear the topic for general Resources or Projects.";
        if(topic==null)return "Choose an existing active topic for this destination.";
        if(destination.equals("Topics")&&(!topic.get("code").startsWith("FOUNDATION_")||!topic.get("section").equals("Microelectronics Foundations")))return "Topics requires a real microelectronics foundation category.";
        if(destination.equals("AITopics")&&!AI_CODES.contains(topic.get("code")))return "AI Topics requires an existing AI application category.";
        return null;
    }
    public static String escape(String text){return text.replace("&","&amp;").replace("<","&lt;").replace(">","&gt;").replace("\"","&quot;").replace("'","&#39;");}
    public static String article(String body,String code,String credit){
        StringBuilder html=new StringBuilder("<div class=\"mx-user-contribution\">");
        for(String p:body.replace("\r\n","\n").replace('\r','\n').split("\n\n",-1))if(!p.isEmpty())html.append("<p>").append(escape(p).replace("\n","<br/>\n")).append("</p>");
        if(!code.isEmpty())html.append("<h2>Source code</h2><pre><code>").append(escape(code)).append("</code></pre>");
        if(!credit.isBlank())html.append("<h2>Source and rights</h2><p>").append(escape(credit).replace("\n","<br/>\n")).append("</p>");return html.append("</div>").toString();
    }
    private static void requireState(IContext c,IMendixObject s,String state){if(flag(c,s,"IsDeleted")||!text(c,s,"SubmissionStatus").equals(state))throw unavailable();}
    private static boolean publicationIsActive(IContext c,IMendixObject s)throws Exception{
        boolean project=text(c,s,"Destination").equals("Projects");IMendixIdentifier id=reference(c,s,project?"Submission_Project":"Submission_Resource");if(id==null)return false;
        var list=query(c,project?"Project":"Resource","[id="+id.toLong()+"][IsActive=true()][IsDeleted=false()]");return list.size()==1;
    }
    private static void requireManaged(IContext c,IMendixObject s,IMendixObject post,boolean project){
        if(!Objects.equals(reference(c,s,"Submission_UserProfile"),reference(c,post,(project?"Project":"Resource")+"_Contributor")))throw unavailable();
        if(!project&&!text(c,post,"ContentKey").startsWith("USER_CONTRIBUTION_"))throw unavailable();
    }
    private static void decision(IContext c,Actor a,IMendixObject s,String result,String reason,boolean reviewed)throws Exception{
        IMendixObject d=Core.instantiate(c,PREFIX+"SubmissionDecision");d.setValue(c,"Decision",result);d.setValue(c,"Reason",reason);d.setValue(c,"DecisionDate",new Date());d.setValue(c,"RevisionNumber",s.getValue(c,"RevisionNumber"));d.setValue(c,"IsDeleted",false);d.setValue(c,PREFIX+"SubmissionDecision_Submission",s.getId());d.setValue(c,PREFIX+"SubmissionDecision_Contributor",reference(c,s,"Submission_UserProfile"));if(reviewed)d.setValue(c,PREFIX+"SubmissionDecision_Reviewer",c.getSession().getUserId());Core.commit(c,d);
        Core.getLogger("MicroExploreContributionAudit").info("Contribution operation: "+result+"; account="+a.account()+"; submission="+s.getId().toLong()+"; time="+new Date().toInstant());
    }
    private static void retire(IContext c,IMendixObject file)throws Exception{file.setValue(c,"IsPublished",false);file.setValue(c,"IsRemoved",true);file.setValue(c,"RemovedAt",new Date());Core.commit(c,file);}
    private static void copyFile(IContext c,IMendixObject target,IMendixObject source,IMendixObject post,boolean project,boolean published)throws Exception{
        byte[] bytes=originalBytes(c,source);var result=SubmissionFilePolicy.validate(text(c,source,"Name"),bytes);if(!result.valid())throw new IllegalArgumentException("The original file must be validated again before publication.");
        IMendixObject clone=Core.instantiate(c,PREFIX+"SubmissionAttachment");
        for(String field:List.of("Caption","SequenceNumber","IsCover"))clone.setValue(c,field,source.getValue(c,field));
        clone.setValue(c,PREFIX+"SubmissionAttachment_Submission",target.getId());clone.setValue(c,PREFIX+"SubmissionAttachment_Contributor",reference(c,target,"Submission_UserProfile"));if(post!=null)clone.setValue(c,PREFIX+"SubmissionAttachment_"+(project?"Project":"Resource"),post.getId());
        clone.setValue(c,"IsPublished",published);clone.setValue(c,"IsRemoved",false);clone.setValue(c,"IsValidated",true);clone.setValue(c,"MediaType",result.mime());clone.setValue(c,"PreviewKind",result.kind());clone.setValue(c,"PreviewText",result.preview());clone.setValue(c,"Digest",result.digest());clone.setValue(c,"ValidationMessage",result.message());Core.storeFileDocumentContent(c,clone,text(c,source,"Name"),new ByteArrayInputStream(bytes));
    }
    private static void publishText(IContext c,IMendixObject s,IMendixObject post,String name,String caption,String text,int sequence)throws Exception{
        byte[] bytes=text.getBytes(StandardCharsets.UTF_8);var result=SubmissionFilePolicy.validate(name,bytes);if(!result.valid())throw new IllegalArgumentException("The project text could not be published without truncation.");
        IMendixObject file=Core.instantiate(c,PREFIX+"SubmissionAttachment");file.setValue(c,PREFIX+"SubmissionAttachment_Submission",s.getId());file.setValue(c,PREFIX+"SubmissionAttachment_Project",post.getId());file.setValue(c,PREFIX+"SubmissionAttachment_Contributor",reference(c,s,"Submission_UserProfile"));
        file.setValue(c,"Caption",caption);file.setValue(c,"SequenceNumber",sequence);file.setValue(c,"IsCover",false);file.setValue(c,"IsPublished",true);file.setValue(c,"IsRemoved",false);file.setValue(c,"IsValidated",true);file.setValue(c,"MediaType",result.mime());file.setValue(c,"PreviewKind",name.equals("project-code.txt")?"code":"text");file.setValue(c,"PreviewText",result.preview());file.setValue(c,"Digest",result.digest());file.setValue(c,"ValidationMessage","UTF-8 copy of the contributor's saved text. Original text remains in the submission.");Core.storeFileDocumentContent(c,file,name,new ByteArrayInputStream(bytes));
    }
    private static String revision(IContext c,Actor a,IMendixObject s)throws Exception{
        requireState(c,s,"Approved");if(!publicationIsActive(c,s))throw unavailable();boolean project=text(c,s,"Destination").equals("Projects");String link=project?"Submission_Project":"Submission_Resource";var post=one(c,project?"Project":"Resource","[id="+reference(c,s,link).toLong()+"]");requireManaged(c,s,post,project);
        if(((Number)s.getValue(c,"RevisionNumber")).intValue()<latestApprovedRevision(c,link,post.getId().toLong()))return "Open the latest approved submission to create a revision. This older version will not overwrite the current publication.";
        if(!query(c,"Submission","["+PREFIX+link+"="+post.getId().toLong()+"][IsDeleted=false()][SubmissionStatus='Draft' or SubmissionStatus='Rejected' or SubmissionStatus='Pending']["+ownerPath()+"="+a.account()+"]").isEmpty())return "A moderated revision already exists in My Submissions. The current publication is unchanged.";
        IMendixObject next=Core.instantiate(c,PREFIX+"Submission");for(String field:List.of("Title","Description","URL","SuggestedTopicText","Destination","ContentKind","RightsDetails","RightsConfirmed","Tags","CodeText","BodyText","PublicAuthorName"))next.setValue(c,field,s.getValue(c,field));
        next.setValue(c,PREFIX+"Submission_Topic",reference(c,s,"Submission_Topic"));next.setValue(c,PREFIX+"Submission_UserProfile",reference(c,s,"Submission_UserProfile"));next.setValue(c,PREFIX+link,post.getId());next.setValue(c,"RevisionNumber",((Number)s.getValue(c,"RevisionNumber")).intValue()+1);next.setValue(c,"SubmissionStatus","Draft");next.setValue(c,"IsDeleted",false);Core.commit(c,next);
        for(IMendixObject original:originals(c,s.getId().toLong()))copyFile(c,next,original,null,project,false);
        decision(c,a,next,"Revision draft","Created a private revision. The existing publication remains unchanged until approval.",false);return "Private revision created. Reopen it in My Submissions; the published version remains unchanged until approval.";
    }
    /** Owner-only recall is checked on the fresh persisted object under the same lock
     * as approval. A stale admin page cannot approve a recalled submission. */
    private static String recall(IContext c,Actor a,IMendixObject s)throws Exception{
        if(text(c,s,"SubmissionStatus").equals("Draft"))return "Already a private draft. No duplicate recall was recorded.";
        if(!text(c,s,"SubmissionStatus").equals("Pending"))return "Only a contribution awaiting review can be recalled. Published content uses Withdraw publication.";
        s.setValue(c,"SubmissionStatus","Draft");Core.commit(c,s);
        decision(c,a,s,"Review recalled","The contributor recalled this submission for private editing. Any existing approved version is unchanged.",false);
        return "Review recalled. Open Edit draft in My Submissions to make changes, then send it for review again. Existing publications are unchanged.";
    }
    /** Restart creates a fresh owned draft, not a restoration of a deleted public post.
     * Private originals are cloned; the old withdrawal and its history remain. */
    private static String restart(IContext c,Actor a,IMendixObject s)throws Exception{
        if(!text(c,s,"SubmissionStatus").equals("Withdrawn"))return "Only a withdrawn contribution can be copied into a fresh draft.";
        String prefix="Private restart draft id: ";
        for(var d:query(c,"SubmissionDecision","[MyFirstModule.SubmissionDecision_Submission="+s.getId().toLong()+"][Decision='Restart draft']")){
            String reason=text(c,d,"Reason");if(!reason.startsWith(prefix))continue;
            String key=reason.substring(prefix.length());if(!key.matches("[1-9][0-9]{0,18}"))continue;
            if(!query(c,"Submission","[id="+positiveId(key)+"][IsDeleted=false()]["+ownerPath()+"="+a.account()+"]").isEmpty())return "A private copy already exists in My Submissions. No duplicate draft was created.";
        }
        IMendixObject next=Core.instantiate(c,PREFIX+"Submission");
        for(String field:List.of("Title","Description","URL","SuggestedTopicText","Destination","ContentKind","RightsDetails","RightsConfirmed","Tags","CodeText","BodyText","PublicAuthorName"))next.setValue(c,field,s.getValue(c,field));
        var topic=reference(c,s,"Submission_Topic");if(topic!=null&&query(c,"Topic","[id="+topic.toLong()+"][IsActive=true()]").isEmpty())topic=null;
        next.setValue(c,PREFIX+"Submission_Topic",topic);next.setValue(c,PREFIX+"Submission_UserProfile",reference(c,s,"Submission_UserProfile"));next.setValue(c,"RevisionNumber",1);next.setValue(c,"SubmissionStatus","Draft");next.setValue(c,"IsDeleted",false);Core.commit(c,next);
        for(var file:originals(c,s.getId().toLong()))if(flag(c,file,"HasContents"))copyFile(c,next,file,null,text(c,s,"Destination").equals("Projects"),false);
        decision(c,a,s,"Restart draft",prefix+next.getId().toLong(),false);
        decision(c,a,next,"Draft copied","A fresh private draft copied from a withdrawn contribution. A new review is required; the original publication remains withdrawn.",false);
        return "Private copy created. Open the newest draft in My Submissions. It must be reviewed again; the old publication remains withdrawn.";
    }
    private static int latestApprovedRevision(IContext c,String link,long publicationId)throws Exception{
        // Tombstones also count: removing a submission alone must not make an old
        // revision eligible to overwrite the still-active publication.
        var latest=Core.createXPathQuery("//"+PREFIX+"Submission["+PREFIX+link+"="+publicationId+"][SubmissionStatus='Approved']").addSort("RevisionNumber",false).setAmount(1).execute(c);
        return latest.isEmpty()?-1:((Number)latest.get(0).getValue(c,"RevisionNumber")).intValue();
    }
    private static String removeHistory(IContext c,Actor a,IMendixObject s,JSONObject request)throws Exception{
        long decisionId=positiveId(request.optString("decisionId",""));IMendixObject d=one(c,"SubmissionDecision","[id="+decisionId+"][MyFirstModule.SubmissionDecision_Submission="+s.getId().toLong()+"]");
        if(flag(c,d,"IsDeleted"))return "This history entry is already removed.";d.setValue(c,"IsDeleted",true);d.setValue(c,"DeletedAt",new Date());Core.commit(c,d);
        Core.getLogger("MicroExploreContributionAudit").info("Review-history entry removed by authorized administrator; account="+a.account()+"; decision="+decisionId);return "Review-history entry removed. The submission, publication and unrelated decisions are unchanged. A minimal server security event is retained.";
    }
    private static String remove(IContext c,Actor a,IMendixObject s,String operation)throws Exception{
        boolean publicPart=!operation.equals("remove-record"),recordPart=!operation.equals("remove-publication");
        if((!publicPart&&flag(c,s,"IsDeleted"))||(publicPart&&!publicationIsActive(c,s)&&text(c,s,"SubmissionStatus").equals("Withdrawn")&&(!recordPart||flag(c,s,"IsDeleted"))))return "This removal scope is already applied. No duplicate decision was created.";
        if(publicPart){boolean project=text(c,s,"Destination").equals("Projects");var id=reference(c,s,project?"Submission_Project":"Submission_Resource");if(id!=null){IMendixObject post=one(c,project?"Project":"Resource","[id="+id.toLong()+"]");requireManaged(c,s,post,project);post.setValue(c,"IsActive",false);post.setValue(c,"IsDeleted",true);post.setValue(c,"DeletedAt",new Date());Core.commit(c,post);for(IMendixObject file:query(c,"SubmissionAttachment","[MyFirstModule.SubmissionAttachment_"+(project?"Project":"Resource")+"="+id.toLong()+"][IsPublished=true()][IsRemoved=false()]"))retire(c,file);}
            s.setValue(c,"SubmissionStatus","Withdrawn");s.setValue(c,"RemovalNotice","The publication has been withdrawn. Historic decisions and diagnosis records are retained.");}
        if(recordPart&&!flag(c,s,"IsDeleted")){s.setValue(c,"IsDeleted",true);s.setValue(c,"DeletedAt",new Date());for(IMendixObject file:originals(c,s.getId().toLong()))retire(c,file);if(!text(c,s,"SubmissionStatus").equals("Approved"))s.setValue(c,"SubmissionStatus","Withdrawn");}
        Core.commit(c,s);decision(c,a,s,publicPart?(recordPart?"Publication and submission removed":"Publication removed"):"Submission removed","Requested removal scope: "+operation+". No physical purge or unrelated history deletion.",a.admin());
        return publicPart?(recordPart?"Publication and submission removed. Review history and unrelated records remain.":"Publication withdrawn. The submission and review history remain."):"Submission record removed. Its active publication and review history remain.";
    }
    private static long positiveId(String value){try{long id=Long.parseLong(value);if(id<=0)throw unavailable();return id;}catch(NumberFormatException e){throw unavailable();}}
}
