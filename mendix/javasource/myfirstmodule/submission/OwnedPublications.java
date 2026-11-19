package myfirstmodule.submission;

import com.mendix.core.Core;
import com.mendix.systemwideinterfaces.core.*;
import java.util.*;

/** Fixed, bounded owner reads. Never accepts client ownership, XPath or IDs. */
public final class OwnedPublications {
    private OwnedPublications() {}
    private static final ThreadLocal<Scope> SCOPES = new ThreadLocal<>();
    private static final class Scope {
        final long account; final String entity; boolean used;
        Scope(long account,String entity){this.account=account;this.entity=entity;}
    }
    private static String entity(String entity) {
        if(!Set.of("Resource","Project").contains(entity))throw SubmissionFiles.unavailable();
        return entity;
    }
    public static List<IMendixObject> worker(IContext caller,String requested) throws Exception {
        final String entity=entity(requested);
        final var actor=SubmissionFiles.actor(caller);
        var scope=SCOPES.get();
        if(scope==null||scope.used||scope.account!=actor.account()||!scope.entity.equals(entity))throw SubmissionFiles.unavailable();
        scope.used=true;
        return Core.createXPathQuery("//MyFirstModule."+entity+
            "[MyFirstModule."+entity+"_Contributor/MyFirstModule.UserProfile/MyFirstModule.UserProfile_Account="+actor.account()+"]"+
            "[IsActive=true()][IsDeleted=false()]")
            .setAmount(1000).execute(caller);
    }
    public static List<IMendixObject> read(IContext caller,String requested) throws Exception {
        final String entity=entity(requested);
        final var actor=SubmissionFiles.actor(caller);
        if(SCOPES.get()!=null)throw SubmissionFiles.unavailable();
        // The native worker remains private, has no client roles and runs exactly this read.
        var fresh=caller.getSession().createContext();
        var binding=new Scope(actor.account(),entity);
        SCOPES.set(binding);
        List<IMendixObject> owned;
        try {
            owned=Core.microflowCall("MyFirstModule.SUB_Submission_ReadOwned"+entity+"s")
                .inTransaction(true).execute(fresh);
            if(!binding.used)throw SubmissionFiles.unavailable();
        } finally { SCOPES.remove(); }
        if(owned==null||owned.isEmpty())return List.of();
        if(owned.size()>1000)throw SubmissionFiles.unavailable();
        StringJoiner ids=new StringJoiner(" or ");
        for(var row:owned) {
            if(row==null||!row.isInstanceOf("MyFirstModule."+entity)||row.getId().toLong()<=0)throw SubmissionFiles.unavailable();
            ids.add("id="+row.getId().toLong());
        }
        // Reapply the caller's existing entity access before returning any public objects.
        return Core.createXPathQuery("//MyFirstModule."+entity+"["+ids+"][IsActive=true()]")
            .setAmount(1000).execute(caller);
    }
}
