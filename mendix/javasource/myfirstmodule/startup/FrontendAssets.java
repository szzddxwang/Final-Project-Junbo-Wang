package myfirstmodule.startup;

import java.io.IOException;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.time.*;
import java.util.*;
import java.util.concurrent.TimeUnit;
import java.util.function.Consumer;
import java.util.regex.*;

/** A lifecycle readiness barrier, never an HTTP/static-handler replacement. */
public final class FrontendAssets {
    private FrontendAssets() {}
    private static final Pattern SCRIPT = Pattern.compile("<script\\b[^>]*\\bsrc=[\"']([^\"']+)[\"']", Pattern.CASE_INSENSITIVE);
    private static final Pattern STYLE = Pattern.compile("<link\\b(?=[^>]*\\brel=[\"']stylesheet[\"'])[^>]*\\bhref=[\"']([^\"']+)[\"']", Pattern.CASE_INSENSITIVE);
    private static final Pattern IMPORT = Pattern.compile("(?:\\bfrom\\s*|\\bimport\\s*\\(?\\s*)[\"'](\\.{1,2}/[^\"']+)[\"']");
    record State(boolean ready, boolean buildFinished, String why, int files) {}
    private static Path local(Path root, Path parent, String ref) throws IOException {
        URI uri;
        try { uri=URI.create(ref); } catch(IllegalArgumentException e) { throw new IOException("Invalid exported asset URL: "+ref,e); }
        if(uri.isAbsolute() || ref.startsWith("//")) throw new IOException("Startup asset must be local: "+ref);
        String path=uri.getPath();
        Path p=(path.startsWith("/") ? root.resolve(path.substring(1)) : parent.resolve(path)).normalize();
        if(!p.startsWith(root)) throw new IOException("Asset leaves public webroot: "+ref);
        return p;
    }
    static State inspect(Path root, Path bundleLog, boolean studioGeneration) throws IOException {
        Path index=root.resolve("index.html");
        if(!Files.isRegularFile(index) || Files.size(index)==0) return new State(false,false,"index.html not yet exported",0);
        boolean complete=!studioGeneration;
        if(studioGeneration) {
            if(!Files.isRegularFile(bundleLog)) return new State(false,false,"local bundler has not reported this generation",0);
            String last="";
            for(String line:Files.readAllLines(bundleLog,StandardCharsets.UTF_8)) {
                if(line.contains("Build started") || line.contains("Bundling started") || line.contains("Bundling finished") || line.contains(" ERROR ")) last=line;
            }
            if(last.contains(" ERROR ")) throw new IOException("Current frontend build failed: "+last);
            if(!last.contains("Bundling finished")) return new State(false,false,"current frontend bundling is in progress",0);
            Instant finished;
            try { finished=Instant.parse(last.substring(0,last.indexOf(' '))); }
            catch(RuntimeException e) { throw new IOException("Cannot identify bundler generation",e); }
            // Studio can export the HTML wrapper AFTER a completed JS bundle.
            // Match completion to actual bundler inputs, not wrapper mtime.
            Path entry=root.resolve("index.js");
            if(!Files.isRegularFile(entry)) return new State(false,false,"current frontend source entry not yet exported",0);
            Instant newest=Files.getLastModifiedTime(entry).toInstant();
            for(String folder:List.of("pages","layouts","nanoflows","widgets")) {
                Path dir=root.resolve(folder);
                if(Files.isDirectory(dir)) try(var files=Files.walk(dir)) {
                    for(Path input:files.filter(Files::isRegularFile).filter(p->p.toString().endsWith(".js")||p.toString().endsWith(".mjs")).toList()) {
                        Instant changed=Files.getLastModifiedTime(input).toInstant();
                        if(changed.isAfter(newest)) newest=changed;
                    }
                }
            }
            if(newest.isAfter(finished)) return new State(false,false,"current frontend source inputs await completed bundling",0);
            complete=true;
        }
        String html=Files.readString(index,StandardCharsets.UTF_8);
        Deque<Path> pending=new ArrayDeque<>();
        for(Pattern pattern:List.of(SCRIPT,STYLE)) {
            Matcher m=pattern.matcher(html);
            while(m.find()) pending.add(local(root,root,m.group(1)));
        }
        if(pending.stream().noneMatch(p->p.equals(root.resolve("dist/index.js")))) throw new IOException("Modern index lacks canonical dist/index.js entry");
        Set<Path> seen=new HashSet<>();
        while(!pending.isEmpty()) {
            Path p=pending.removeFirst();if(!seen.add(p)) continue;
            if(!Files.isRegularFile(p) || Files.size(p)==0) {
                if(complete) throw new IOException("Completed frontend generation has a missing/empty asset: "+root.relativize(p));
                return new State(false,false,"asset is not yet exported: "+root.relativize(p),seen.size());
            }
            // Mendix emits a small generated entry. Do not regex-parse library
            // chunk bodies: examples/docstrings can contain non-executable imports.
            if(p.equals(root.resolve("dist/index.js"))) {
                Matcher m=IMPORT.matcher(Files.readString(p,StandardCharsets.UTF_8));
                while(m.find()) pending.add(local(root,p.getParent(),m.group(1)));
            }
        }
        return new State(true,complete,"current frontend generation and generated entry dependencies complete",seen.size());
    }
    public static void awaitReady(Path webRoot, Path bundleLog, boolean studioGeneration, Duration limit, Consumer<String> log) throws Exception {
        Path root=webRoot.toAbsolutePath().normalize();long start=System.nanoTime(),end=start+limit.toNanos();String reported="";
        try(WatchService watcher=FileSystems.getDefault().newWatchService()) {
            Set<Path> registered=new HashSet<>();
            for(;;) {
                // Register before inspecting, avoiding a create/complete-event race.
                for(Path d:List.of(root,root.resolve("dist"),root.resolve("dist/chunks"),bundleLog.getParent())) {
                    if(Files.isDirectory(d) && registered.add(d)) d.register(watcher,StandardWatchEventKinds.ENTRY_CREATE,StandardWatchEventKinds.ENTRY_MODIFY,StandardWatchEventKinds.ENTRY_DELETE);
                }
                State state=inspect(root,bundleLog,studioGeneration);
                if(state.ready()) {log.accept("READY files="+state.files()+" elapsed_ms="+TimeUnit.NANOSECONDS.toMillis(System.nanoTime()-start));return;}
                if(!reported.equals(state.why())) {reported=state.why();log.accept("WAIT "+reported);}
                long remaining=end-System.nanoTime();if(remaining<=0) throw new IOException("Frontend readiness deadline exceeded: "+reported);
                // Long-lived Windows log writers can coalesce change events.
                // Recheck the actual condition while pending, never delay an
                // already-ready startup and never retry a failing HTTP request.
                WatchKey key=watcher.poll(Math.min(remaining,TimeUnit.MILLISECONDS.toNanos(250)),TimeUnit.NANOSECONDS);
                if(key!=null) {key.pollEvents();key.reset();}
            }
        }
    }
}
