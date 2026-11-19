package myfirstmodule.submission;

import com.mendix.core.Core;
import com.mendix.systemwideinterfaces.core.*;
import java.io.*;
import java.util.*;
import java.util.concurrent.locks.ReentrantLock;

/** Trusted server operations. Uses the caller's existing authenticated session, never sudo/system. */
public final class SubmissionFiles {
    public static final String PREFIX="MyFirstModule.";
    private static final Object[] LOCKS=new Object[128];
    private static final ReentrantLock[] PUBLICATION_LOCKS=new ReentrantLock[128];
    static {for(int i=0;i<LOCKS.length;i++){LOCKS[i]=new Object();PUBLICATION_LOCKS[i]=new ReentrantLock();}}
    private SubmissionFiles(){}
    public record Actor(long account,boolean admin){}
    @FunctionalInterface public interface Work<T>{T run(IContext context,Actor actor)throws Exception;}
    public static Actor actor(IContext caller){
        if(caller==null||caller.getSession()==null||Boolean.TRUE.equals(caller.getSession().getUser(caller).isAnonymous()))throw unavailable();
        var roles=caller.getSession().getUserRolesNames();boolean admin=roles.contains("Administrator");
        if(!admin&&!roles.contains("Learner"))throw unavailable();
        return new Actor(caller.getSession().getUserId().toLong(),admin);
    }
    public static IllegalArgumentException unavailable(){return new IllegalArgumentException("This contribution is unavailable or this action is not permitted.");}
    public static long id(IMendixObject input,String entity){if(input==null||!input.isInstanceOf(PREFIX+entity)||input.getId().toLong()<=0)throw unavailable();return input.getId().toLong();}
    public static Object lock(long id){return LOCKS[(int)Math.floorMod(id,LOCKS.length)];}
    private static final ThreadLocal<WorkerScope> WORKER=new ThreadLocal<>();
    static boolean trustedWorker(IContext c){var scope=WORKER.get();return scope!=null&&scope.executed&&scope.account==actor(c).account();}
    private static final class WorkerScope {
        final String kind;final long inputId,account;final Work<?> work;boolean executed;ReentrantLock publicationLock;
        WorkerScope(String kind,long inputId,long account,Work<?> work){this.kind=kind;this.inputId=inputId;this.account=account;this.work=work;}
    }
    public static boolean inWorker(IContext caller,String kind,long inputId){
        var scope=WORKER.get();if(scope==null)return false;
        if(scope.executed||!scope.kind.equals(kind)||scope.inputId!=inputId||scope.account!=actor(caller).account())throw unavailable();
        return true;
    }
    @SuppressWarnings("unchecked") public static <T>T runWorker(IContext nativeServerContext)throws Exception{
        var scope=WORKER.get();if(scope==null||scope.executed||scope.account!=actor(nativeServerContext).account())throw unavailable();
        scope.executed=true;return (T)scope.work.run(nativeServerContext,actor(nativeServerContext));
    }
    /** Hold the canonical publication lock through the native transaction commit.
     * Called only inside an authenticated worker, after persisted ownership is checked.
     * This serializes revisions of different submissions for one post in this runtime.
     */
    public static void lockPublication(IContext context,long publicationId){
        var scope=WORKER.get();
        if(scope==null||!scope.executed||!scope.kind.equals("workflow")||publicationId<=0||scope.account!=actor(context).account())throw unavailable();
        var lock=PUBLICATION_LOCKS[(int)Math.floorMod(publicationId,PUBLICATION_LOCKS.length)];
        if(scope.publicationLock!=null){if(scope.publicationLock!=lock)throw unavailable();return;}
        lock.lock();scope.publicationLock=lock;
    }
    /**
     * User-approved fixed native server flows own protected writes. Java never creates
     * a system/sudo context. A new ordinary same-user context invokes exactly one
     * private native worker. Its transaction finishes before the stripe is released.
     * No target commit is allowed in the outer caller before this dispatch.
     */
    public static <T>T transaction(IContext caller,long submissionId,String kind,long inputId,Map<String,Object> args,Work<T> work)throws Exception{
        Actor actor=actor(caller);
        synchronized(lock(submissionId)){
            if(WORKER.get()!=null)throw unavailable();
            String worker=switch(kind){case "factory"->"SUB_Submission_AttachmentFactory";case "file"->"SUB_Submission_FileWorker";case "workflow"->"SUB_Submission_LifecycleWorker";default->throw unavailable();};
            IContext context=caller.getSession().createContext();
            if(context.isInTransaction())throw new IllegalStateException("The submission worker requires an independent transaction.");
            var scope=new WorkerScope(kind,inputId,actor.account(),work);WORKER.set(scope);
            try{
                T result=Core.microflowCall(PREFIX+worker).withParams(args).inTransaction(true).execute(context);
                if(!scope.executed)throw new IllegalStateException("The native submission worker did not execute.");
                return result;
            }finally{if(scope.publicationLock!=null)scope.publicationLock.unlock();WORKER.remove();}
        }
    }
    public static List<IMendixObject> query(IContext c,String entity,String constraints)throws Exception{
        return Core.createXPathQuery("//"+PREFIX+entity+constraints).setAmount(1000).execute(c);
    }
    public static IMendixObject one(IContext c,String entity,String constraints)throws Exception{
        var rows=Core.createXPathQuery("//"+PREFIX+entity+constraints).setAmount(2).execute(c);
        if(rows.size()!=1)throw unavailable();return rows.get(0);
    }
    public static String ownerPath(){return "MyFirstModule.Submission_UserProfile/MyFirstModule.UserProfile/MyFirstModule.UserProfile_Account";}
    public static IMendixObject submission(IContext c,Actor actor,long id,boolean adminMayReview,boolean includeRemoved)throws Exception{
        String constraint="[id="+id+"]"+(includeRemoved?"":"[IsDeleted=false()]");
        if(!adminMayReview||!actor.admin)constraint+="["+ownerPath()+"="+actor.account+"]";
        return one(c,"Submission",constraint);
    }
    public static IMendixObject profile(IContext c,Actor actor)throws Exception{return one(c,"UserProfile","[MyFirstModule.UserProfile_Account="+actor.account+"]");}
    public static String text(IContext c,IMendixObject o,String field){Object v=o.getValue(c,field);return v==null?"":v.toString();}
    public static boolean flag(IContext c,IMendixObject o,String field){return Boolean.TRUE.equals(o.getValue(c,field));}
    public static IMendixIdentifier reference(IContext c,IMendixObject o,String field){return o.getValue(c,PREFIX+field);}
    public static void draft(IContext c,IMendixObject submission){if(!text(c,submission,"SubmissionStatus").equals("Draft")||flag(c,submission,"IsDeleted"))throw unavailable();}
    public static List<IMendixObject> originals(IContext c,long id)throws Exception{return query(c,"SubmissionAttachment","[MyFirstModule.SubmissionAttachment_Submission="+id+"][IsRemoved=false()][IsPublished=false()]");}

    public static IMendixObject newAttachment(IContext caller,IMendixObject input)throws Exception{
        long id=id(input,"Submission");
        if(inWorker(caller,"factory",id))return runWorker(caller);
        return transaction(caller,id,"factory",id,Map.of("Submission",input),(c,a)->{
            IMendixObject submission=submission(c,a,id,false,false);draft(c,submission);
            String kind=text(c,submission,"ContentKind");
            if(SubmissionFilePolicy.allowed(kind).isEmpty())throw new IllegalArgumentException("Choose and save a Content type before adding files.");
            var files=originals(c,id);
            for(IMendixObject existing:files)if(flag(c,existing,"HasContents")&&!SubmissionFilePolicy.allowed(kind).contains(SubmissionFilePolicy.extension(text(c,existing,"Name"))))throw new IllegalArgumentException(text(c,existing,"Name")+" is incompatible with "+SubmissionFilePolicy.typeLabel(kind)+". Allowed files: "+SubmissionFilePolicy.allowedDescription(kind)+". Explicitly remove or replace it before another upload; no file has been deleted.");
            // Reuse an owned empty upload slot after cancellation/re-entry.
            // Persisted parent/type/state checks above still run before this path.
            // Never remove or replace an existing original implicitly.
            for(IMendixObject existing:files)if(!flag(c,existing,"HasContents"))return existing;
            if(files.size()>=8)throw new IllegalArgumentException("A draft can contain up to eight original files. Remove an unused file before adding another.");
            IMendixObject file=Core.instantiate(c,PREFIX+"SubmissionAttachment");
            file.setValue(c,PREFIX+"SubmissionAttachment_Submission",submission.getId());
            file.setValue(c,PREFIX+"SubmissionAttachment_Contributor",reference(c,submission,"Submission_UserProfile"));
            file.setValue(c,"Name","");file.setValue(c,"Caption","");file.setValue(c,"SequenceNumber",files.size()+1);
            file.setValue(c,"IsValidated",false);file.setValue(c,"IsPublished",false);file.setValue(c,"IsRemoved",false);file.setValue(c,"IsCover",false);
            file.setValue(c,"ValidationMessage","Choose an original file, then validate it before submission.");
            Core.commit(c,file);return file;
        });
    }
    public static byte[] originalBytes(IContext c,IMendixObject file)throws Exception{
        if(!flag(c,file,"HasContents"))throw new IllegalArgumentException("Choose a nonempty original file first.");
        try(InputStream stream=Core.getFileDocumentContent(c,file)){
            if(stream==null)throw new IllegalArgumentException("The original file is unavailable.");
            return SubmissionFilePolicy.readBounded(stream);
        }
    }
    public static SubmissionFilePolicy.Result validate(IContext c,IMendixObject file)throws Exception{
        SubmissionFilePolicy.Result result;
        try{var parent=reference(c,file,"SubmissionAttachment_Submission");if(parent==null)throw unavailable();var s=one(c,"Submission","[id="+parent.toLong()+"]");result=SubmissionFilePolicy.validateFor(text(c,s,"ContentKind"),text(c,file,"Name"),originalBytes(c,file));}
        catch(IOException|IllegalArgumentException error){result=new SubmissionFilePolicy.Result(false,"","","","",error.getMessage());}
        file.setValue(c,"IsValidated",result.valid());file.setValue(c,"MediaType",result.mime());file.setValue(c,"PreviewKind",result.kind());file.setValue(c,"PreviewText",result.preview());file.setValue(c,"Digest",result.digest());file.setValue(c,"ValidationMessage",result.message());Core.commit(c,file);return result;
    }
    /** Native FileDocument before-commit boundary. Upload bytes are inspected before
     * the attachment transaction can become staged content. No recursive commit,
     * physical deletion, elevated context or client-owned authorization fields. */
    public static boolean beforeCommit(IContext c,IMendixObject input)throws Exception{
        actor(c);
        if(trustedWorker(c))return true; // Already authorized fixed factory/lifecycle/file worker.
        long fileId=id(input,"SubmissionAttachment");
        IContext fresh=c.getSession().createContext();Actor a=actor(c);
        var persisted=one(fresh,"SubmissionAttachment","[id="+fileId+"][IsPublished=false()][IsRemoved=false()][MyFirstModule.SubmissionAttachment_Contributor/MyFirstModule.UserProfile/MyFirstModule.UserProfile_Account="+a.account()+"]");
        var parent=reference(fresh,persisted,"SubmissionAttachment_Submission");if(parent==null)throw unavailable();
        var s=submission(fresh,a,parent.toLong(),false,false);draft(fresh,s);
        if(!Objects.equals(parent,reference(c,input,"SubmissionAttachment_Submission"))||!Objects.equals(reference(fresh,persisted,"SubmissionAttachment_Contributor"),reference(c,input,"SubmissionAttachment_Contributor"))||flag(c,input,"IsPublished")||flag(c,input,"IsRemoved"))throw unavailable();
        String kind=text(fresh,s,"ContentKind");
        for(IMendixObject other:originals(fresh,parent.toLong()))if(!other.getId().equals(input.getId())&&flag(fresh,other,"HasContents")&&!SubmissionFilePolicy.allowed(kind).contains(SubmissionFilePolicy.extension(text(fresh,other,"Name"))))throw new IllegalArgumentException("Remove or replace incompatible draft attachment "+text(fresh,other,"Name")+" before uploading. Allowed files: "+SubmissionFilePolicy.allowedDescription(kind)+". No file was deleted.");
        if(!flag(c,input,"HasContents"))throw new IllegalArgumentException("Choose a nonempty original file. Allowed files: "+SubmissionFilePolicy.allowedDescription(kind));
        var result=SubmissionFilePolicy.validateFor(kind,text(c,input,"Name"),originalBytes(c,input));
        if(!result.valid()){
            var feedback=new com.mendix.core.objectmanagement.DataValidationInfo(fileId);
            feedback.addErrorField("Name",text(c,input,"Name")+": "+result.message()+" Allowed files: "+SubmissionFilePolicy.allowedDescription(kind));
            c.addDataValidation(feedback);
            return false;
        }
        input.setValue(c,"IsValidated",true);input.setValue(c,"MediaType",result.mime());input.setValue(c,"PreviewKind",result.kind());input.setValue(c,"PreviewText",result.preview());input.setValue(c,"Digest",result.digest());input.setValue(c,"ValidationMessage",result.message());
        return true;
    }
    public static String command(IContext caller,IMendixObject input,String command)throws Exception{
        actor(caller);
        if(command==null||!Set.of("validate","remove","cover","uncover","edit").contains(command))throw unavailable();
        long attachmentId=id(input,"SubmissionAttachment");Actor actor=actor(caller);
        if(inWorker(caller,"file",attachmentId))return runWorker(caller);
        IContext lookup=caller.getSession().createContext();
        String owner=actor.admin?"":"[MyFirstModule.SubmissionAttachment_Contributor/MyFirstModule.UserProfile/MyFirstModule.UserProfile_Account="+actor.account+"]";
        IMendixObject found=one(lookup,"SubmissionAttachment","[id="+attachmentId+"][IsRemoved=false()]"+owner);
        IMendixIdentifier parent=reference(lookup,found,"SubmissionAttachment_Submission");if(parent==null)throw unavailable();
        return transaction(caller,parent.toLong(),"file",attachmentId,Map.of("Attachment",input,"Command",command),(c,a)->{
            IMendixObject submission=submission(c,a,parent.toLong(),true,false);
            IMendixObject file=one(c,"SubmissionAttachment","[id="+attachmentId+"][IsRemoved=false()][MyFirstModule.SubmissionAttachment_Submission="+parent.toLong()+"]"+owner);
            if(!a.admin)draft(c,submission);
            if(command.equals("edit")){
                // Even an administrator uses a separate read-only review surface
                // for somebody else's originals; this editor is an owner's draft.
                submission(c,a,parent.toLong(),false,false);draft(c,submission);
                if(flag(c,file,"IsPublished"))throw unavailable();
                return "Owned draft file is available for editing.";
            }
            if(command.equals("validate")){
                if(flag(c,file,"IsPublished"))throw unavailable();
                var result=validate(c,file);return result.valid()?"File validated. "+result.message():"File rejected: "+result.message();
            }
            if(command.equals("remove")){
                file.setValue(c,"IsRemoved",true);file.setValue(c,"RemovedAt",new Date());file.setValue(c,"IsPublished",false);Core.commit(c,file);return "This file has been removed. Other files and review decisions are unchanged.";
            }
            draft(c,submission);
            if(!flag(c,file,"IsValidated")||!text(c,file,"MediaType").startsWith("image/"))throw new IllegalArgumentException("Validate a supported still image before choosing a cover.");
            for(IMendixObject other:originals(c,parent.toLong())){if(command.equals("uncover")&&!other.getId().equals(file.getId()))continue;other.setValue(c,"IsCover",command.equals("cover")&&other.getId().equals(file.getId()));Core.commit(c,other);}
            return command.equals("cover")?"Cover image selected.":"Cover image cleared.";
        });
    }
}
