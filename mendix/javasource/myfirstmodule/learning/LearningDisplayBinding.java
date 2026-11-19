package myfirstmodule.learning;
import java.util.*;
/** One-shot guard independent of Mendix APIs; never accepts client input. */
final class LearningDisplayBinding {
    record Values(long account,long diagnosis,List<GroundedLearningRanker.Recommendation> cards,long created) {}
    private static final class Scope {final Values value;boolean used;Scope(Values v){value=v;}}
    private static final ThreadLocal<Scope> CURRENT=new ThreadLocal<>();
    static void open(long account,long diagnosis,List<GroundedLearningRanker.Recommendation> cards,long now){
        if(account<=0||diagnosis<=0||cards==null||cards.size()>5||CURRENT.get()!=null)throw new IllegalStateException("Learning display unavailable.");
        CURRENT.set(new Scope(new Values(account,diagnosis,List.copyOf(cards),now)));
    }
    static Values consume(long account,long now){
        Scope s=CURRENT.get();if(s==null||s.used||account<=0||s.value.account!=account||now<s.value.created||now-s.value.created>5_000_000_000L)throw new IllegalStateException("Learning display unavailable.");
        s.used=true;return s.value;
    }
    static boolean consumed(){return CURRENT.get()!=null&&CURRENT.get().used;}
    static void clear(){CURRENT.remove();}
}
