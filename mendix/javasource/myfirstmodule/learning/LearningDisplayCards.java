package myfirstmodule.learning;
import com.mendix.core.Core;
import com.mendix.systemwideinterfaces.core.*;
import java.util.*;
/** Fixed private NP factory. No query, commit, entity choice, caller command or elevated Java context. */
public final class LearningDisplayCards {
    private LearningDisplayCards(){}
    private static long actor(IContext c)throws Exception{
        if(c.getSession()==null||Boolean.TRUE.equals(c.getSession().getUser(c).isAnonymous())||c.getSession().getUserRolesNames().stream().noneMatch(Set.of("Learner","Administrator")::contains))throw new IllegalStateException("Learning display unavailable.");
        return c.getSession().getUserId().toLong();
    }
    // Only CurrentLearningDisplay's owner-validated path calls this package-private entry.
    static List<IMendixObject> create(IContext caller,IMendixObject ownedSession,List<GroundedLearningRanker.Recommendation> cards)throws Exception{
        LearningDisplayBinding.open(actor(caller),ownedSession.getId().toLong(),cards,System.nanoTime());
        try{
            List<IMendixObject> result=Core.microflowCall("MyFirstModule.SUB_Learning_CreateDisplayCards").inTransaction(true).execute(caller);
            if(!LearningDisplayBinding.consumed()||result==null||result.size()>5)throw new IllegalStateException("Learning display unavailable.");
            for(IMendixObject row:result){Object title=row.getValue(caller,"Title");if(!(title instanceof String text)||text.isBlank())throw new IllegalStateException("Learning display values were not retained in the caller request.");}
            return result;
        }finally{LearningDisplayBinding.clear();}
    }
    public static List<IMendixObject> worker(IContext caller)throws Exception{
        var binding=LearningDisplayBinding.consume(actor(caller),System.nanoTime());List<IMendixObject> out=new ArrayList<>();int rank=1;
        for(var value:binding.cards()){
            IMendixObject card=Core.instantiate(caller,"MyFirstModule.NP_AIFinding");
            card.setValue(caller,"Title",value.heading());card.setValue(caller,"Description",value.reason());card.setValue(caller,"Evidence",value.articleTitle());
            String token=binding.diagnosis()+"|"+value.articleId()+"|"+Base64.getUrlEncoder().withoutPadding().encodeToString(value.heading().getBytes(java.nio.charset.StandardCharsets.UTF_8));
            card.setValue(caller,"Severity",token);card.setValue(caller,"SortOrder",(long)rank++);out.add(card);
        }
        if(out.isEmpty()){
            IMendixObject card=Core.instantiate(caller,"MyFirstModule.NP_AIFinding");card.setValue(caller,"Title","No suitable reading is currently available");card.setValue(caller,"Description","Your diagnosis is unchanged. No current published section matches this evidence; use the available measurement guidance, if any.");card.setValue(caller,"Evidence","");card.setValue(caller,"Severity","");card.setValue(caller,"SortOrder",0L);out.add(card);
        }
        return out;
    }
}
