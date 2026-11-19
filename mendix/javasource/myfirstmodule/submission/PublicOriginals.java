package myfirstmodule.submission;

import com.mendix.core.Core;
import com.mendix.externalinterface.connector.RequestHandler;
import com.mendix.m2ee.api.*;
import com.mendix.systemwideinterfaces.core.*;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;

/** Read-only delivery of originals the unchanged native public entity rules allow.
 * No FileID exposure, system context, database writes, private-file fallback,
 * browser security workaround, arbitrary path, external redirect or CORS grant. */
public final class PublicOriginals {
    private static final String GUARD="MyFirstModule.SUB_Submission_PublicOriginalGuard";
    private static final String ROUTE="published-original/";
    private static final ConcurrentHashMap<String,Ticket> TICKETS=new ConcurrentHashMap<>();
    private static final SecureRandom RANDOM=new SecureRandom();
    private static boolean registered;
    private record Ticket(UUID session,long attachment,long expires){}
    private PublicOriginals(){}

    private static IMendixObject authorized(IContext c,long id)throws Exception{
        if(c==null||c.getSession()==null||id<=0)throw new IllegalArgumentException("Original unavailable.");
        // Exact-object EA=true query first. A fixed private read then restricts
        // every role (including owner/admin) to active public originals only.
        IMendixObject candidate=Core.retrieveId(c,Core.createMendixIdentifier(id));
        if(candidate==null||!candidate.isInstanceOf("MyFirstModule.SubmissionAttachment"))throw new IllegalArgumentException("Original unavailable.");
        IMendixObject allowed;
        try{allowed=Core.microflowCall(GUARD).withParam("Attachment",candidate).execute(c);}
        catch(Exception error){Core.getLogger("MicroExplorePublicOriginal").warn("Public entity guard failed: "+cause(error));throw error;}
        if(allowed==null||allowed.getId().toLong()!=id)throw new IllegalArgumentException("Original unavailable.");
        IMendixObject file;
        try{file=Core.microflowCall("MyFirstModule.SUB_Submission_PublicOriginalState").withParam("Attachment",allowed).execute(c);}
        catch(Exception error){Core.getLogger("MicroExplorePublicOriginal").warn("Public state guard failed: "+cause(error));throw error;}
        if(file==null||file.getId().toLong()!=id)throw new IllegalArgumentException("Original unavailable.");
        return file;
    }
    private static String cause(Throwable error){for(int i=0;i<16&&error.getCause()!=null;i++)error=error.getCause();return error.getClass().getSimpleName()+": "+error.getMessage();}
    public static synchronized String link(IContext c,IMendixObject input)throws Exception{
        if(input==null||!input.isInstanceOf("MyFirstModule.SubmissionAttachment"))throw new IllegalArgumentException("Original unavailable.");
        long id=input.getId().toLong();authorized(c,id);
        if(!registered){Core.addRequestHandler(ROUTE,new Handler());registered=true;}
        long now=System.currentTimeMillis();TICKETS.entrySet().removeIf(e->e.getValue().expires<now);
        if(TICKETS.size()>=1024||TICKETS.values().stream().filter(t->t.session.equals(c.getSession().getId())).count()>=32)throw new IllegalStateException("Please retry this download shortly.");
        byte[] random=new byte[32];RANDOM.nextBytes(random);String token=HexFormat.of().formatHex(random);
        TICKETS.put(token,new Ticket(c.getSession().getId(),id,now+120000));
        String root=Core.getConfiguration().getApplicationRootUrl();
        return root+(root.endsWith("/")?"":"/")+ROUTE+token;
    }
    private static final class Handler extends RequestHandler {
        @Override protected boolean enableOptionsResponse(){return false;}
        @Override protected void processRequest(IMxRuntimeRequest request,IMxRuntimeResponse response,String path)throws Exception{
            response.addHeader("Cache-Control","no-store, private");response.addHeader("X-Content-Type-Options","nosniff");
            if(!"GET".equals(request.getHttpServletRequest().getMethod())){response.setStatus(405);return;}
            String token=path.startsWith("/")?path.substring(1):path;
            if(!token.matches("[0-9a-f]{64}")){response.setStatus(404);return;}
            Ticket ticket=TICKETS.get(token);
            if(ticket==null||ticket.expires<System.currentTimeMillis()){response.setStatus(404);return;}
            ISession session;try{session=getSessionFromRequest(request);}catch(Exception denied){response.setStatus(404);return;}
            if(session==null||!ticket.session.equals(session.getId())){response.setStatus(404);return;}
            if("cross-site".equalsIgnoreCase(request.getHeader("Sec-Fetch-Site"))){response.setStatus(404);return;}
            String origin=request.getHeader("Origin");
            if(origin!=null){URI expected=URI.create(Core.getConfiguration().getApplicationRootUrl()),actual;
                try{actual=URI.create(origin);}catch(Exception bad){response.setStatus(404);return;}
                if(!Objects.equals(expected.getScheme(),actual.getScheme())||!Objects.equals(expected.getAuthority(),actual.getAuthority())){response.setStatus(404);return;}}
            // Claim once after checking the session/origin; concurrent GETs must
            // not consume the same capability more than once.
            if(!TICKETS.remove(token,ticket)){response.setStatus(404);return;}
            IContext context=session.createContext();IMendixObject file;
            try{file=authorized(context,ticket.attachment);}catch(Exception denied){response.setStatus(404);return;}
            byte[] bytes;
            // The Core content API has no implicit authorization: the fixed native
            // EA-enabled, active-public guard above must succeed on EVERY GET.
            try(InputStream stream=Core.getFileDocumentContent(context,file)){if(stream==null)throw new IOException();bytes=SubmissionFilePolicy.readBounded(stream);}
            catch(Exception unavailable){Core.getLogger("MicroExplorePublicOriginal").warn("Public original storage read failed: "+cause(unavailable));response.setStatus(404);return;}
            // Check again after bounded reading, before the first response byte.
            try{authorized(session.createContext(),ticket.attachment);}catch(Exception denied){response.setStatus(404);return;}
            // getValue is generic: passing it directly to overloaded valueOf
            // infers char[] and fails at runtime for an ordinary String name.
            Object originalName=file.getValue(context,"Name");
            String name=String.valueOf(originalName);
            String encoded=URLEncoder.encode(name,StandardCharsets.UTF_8).replace("+","%20");
            response.setContentType("application/octet-stream");
            response.addHeader("Content-Disposition","attachment; filename=\"original\"; filename*=UTF-8''"+encoded);
            response.addHeader("Content-Length",Integer.toString(bytes.length));response.setStatus(200);
            try(OutputStream output=response.getOutputStream()){output.write(bytes);}
        }
    }
}
