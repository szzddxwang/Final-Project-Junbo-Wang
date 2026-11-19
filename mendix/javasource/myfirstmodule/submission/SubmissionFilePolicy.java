package myfirstmodule.submission;

import java.io.*;
import java.nio.*;
import java.nio.charset.*;
import java.security.MessageDigest;
import java.util.*;
import java.util.zip.*;
import javax.imageio.*;
import javax.imageio.stream.ImageInputStream;
import javax.xml.XMLConstants;
import javax.xml.parsers.DocumentBuilderFactory;
import org.w3c.dom.*;
import org.apache.pdfbox.Loader;
import org.apache.pdfbox.cos.*;
import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.pdfbox.text.PDFTextStripper;

/** Bounded file inspection. Does not execute content, extract files or claim antivirus scanning. */
public final class SubmissionFilePolicy {
    public static final int MAX_BYTES = 20 * 1024 * 1024;
    private static final int MAX_PREVIEW = 200_000;
    private static final Set<String> CODE = Set.of("txt","md","c","cpp","h","ino","py","js","json");
    private static final Map<String,List<String>> TYPES = Map.of(
        "Article",List.of("txt","md"), "Document",List.of("pdf","docx"),
        "Image",List.of("png","jpg","jpeg","webp"), "Video",List.of("mp4"),
        "SourceCode",List.of("c","cpp","h","ino","py","js","json","txt","md"),
        "Project",List.of("txt","md","pdf","docx","png","jpg","jpeg","webp","mp4","c","cpp","h","ino","py","js","json"));
    private static final Set<String> PDF_KEYS = Set.of("JavaScript","JS","OpenAction","AA","Launch","EmbeddedFile","EmbeddedFiles","RichMedia","RichMediaContent","XFA");
    private static final Set<String> PDF_ACTIONS = Set.of("JavaScript","Launch","GoToR","GoToE","SubmitForm","ImportData","RichMediaExecute");
    public record Result(boolean valid, String mime, String kind, String preview, String digest, String message) {}
    private SubmissionFilePolicy() {}

    public static List<String> allowed(String kind){return TYPES.getOrDefault(kind,List.of());}
    public static String extension(String name){int dot=name==null?-1:name.lastIndexOf('.');return dot<1?"":name.substring(dot+1).toLowerCase(Locale.ROOT);}
    public static String allowedDescription(String kind){return String.join(", ",allowed(kind).stream().map(x->"."+x).toList());}
    public static String typeLabel(String kind){return switch(kind){case "Article"->"Learning article / text";case "Document"->"Document / learning resource";case "Image"->"Image / diagram";case "Video"->"Video";case "SourceCode"->"Source code / example";case "Project"->"Project";default->"an unselected content type";};}
    public static Result validateFor(String kind,String filename,byte[] bytes){
        if(!allowed(kind).contains(extension(filename)))return new Result(false,"","","","",String.valueOf(filename)+" is not allowed for "+typeLabel(kind)+". Allowed files: "+allowedDescription(kind)+". Choose a replacement; the original is unchanged.");
        return validate(filename,bytes);
    }

    public static Result validate(String filename, byte[] bytes) {
        String digest = "";
        try {
            if (bytes == null || bytes.length == 0) throw new IOException("Choose a nonempty original file.");
            if (bytes.length > MAX_BYTES) throw new IOException("Files must be 20 MiB or smaller.");
            digest = HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes));
            if (filename == null || filename.isBlank() || filename.length() > 180 || filename.contains("/") || filename.contains("\\") || filename.chars().anyMatch(c -> c < 32))
                throw new IOException("Use a plain filename of at most 180 characters.");
            require(!filename.toLowerCase(Locale.ROOT).matches(".*\\.(exe|dll|com|bat|cmd|scr|msi|ps1|vbs|hta|jar|zip|rar|7z|svg|html?)\\..*"),"Disguised executable, active-content or archive double extensions are not accepted.");
            int dot=filename.lastIndexOf('.');
            if (dot < 1) throw new IOException("A supported filename extension is required.");
            String ext=filename.substring(dot+1).toLowerCase(Locale.ROOT), mime, kind, preview="";
            switch (ext) {
                case "pdf" -> { require(starts(bytes,"%PDF-"),"The bytes do not match a PDF file."); preview=pdf(bytes); mime="application/pdf";kind="pdf"; }
                case "docx" -> { require(bytes.length>4 && bytes[0]=='P' && bytes[1]=='K' && bytes[2]==3 && bytes[3]==4,"The bytes do not match a DOCX archive."); preview=docx(bytes);mime="application/vnd.openxmlformats-officedocument.wordprocessingml.document";kind="docx"; }
                case "png" -> { require(bytes.length>8 && Arrays.equals(Arrays.copyOf(bytes,8),new byte[]{(byte)137,80,78,71,13,10,26,10}),"The bytes do not match PNG."); preview=image(bytes,"png");mime="image/png";kind="image"; }
                case "jpg","jpeg" -> { require(bytes.length>4 && (bytes[0]&255)==255 && (bytes[1]&255)==216 && (bytes[2]&255)==255,"The bytes do not match JPEG.");preview=image(bytes,"jpeg");mime="image/jpeg";kind="image"; }
                case "webp" -> { preview=webp(bytes);mime="image/webp";kind="image"; }
                case "mp4" -> { preview=mp4(bytes);mime="video/mp4";kind="video"; }
                default -> {
                    require(CODE.contains(ext),"Unsupported file type. Executables, HTML, SVG, macros and arbitrary archives are not accepted.");
                    require(!starts(bytes,"%PDF-")&&!starts(bytes,"PK\u0003\u0004")&&!starts(bytes,"MZ")&&!starts(bytes,"\u007fELF")&&!starts(bytes,"RIFF")&&!starts(bytes,"\u0089PNG")&&!(bytes.length>2&&(bytes[0]&255)==255&&(bytes[1]&255)==216)&&!(bytes.length>8&&new String(bytes,4,4,StandardCharsets.ISO_8859_1).equals("ftyp")),"The bytes identify a binary/document format, not the selected text/source extension.");
                    require(bytes.length<=1024*1024,"Text and code files must be 1 MiB or smaller.");
                    preview=utf8(bytes);require(preview.chars().noneMatch(c->c==0 || (c<32 && c!='\n' && c!='\r' && c!='\t' && c!='\f')),"The file contains binary control bytes.");
                    mime="text/plain; charset=utf-8";kind=Set.of("txt","md").contains(ext)?"text":"code";
                }
            }
            return new Result(true,mime,kind,shorten(preview),digest,"File structure and size validated. No antivirus scan is available.");
        } catch (Exception e) {
            String message=e instanceof IOException?e.getMessage():"The original file could not be parsed safely.";
            return new Result(false,"","","",digest,message);
        }
    }
    public static byte[] readBounded(InputStream input) throws IOException {
        byte[] b=input.readNBytes(MAX_BYTES+1);require(b.length<=MAX_BYTES,"Files must be 20 MiB or smaller.");return b;
    }
    private static void require(boolean ok,String error)throws IOException{if(!ok)throw new IOException(error);}
    private static boolean starts(byte[] b,String s){byte[] t=s.getBytes(StandardCharsets.ISO_8859_1);if(b.length<t.length)return false;for(int i=0;i<t.length;i++)if(b[i]!=t[i])return false;return true;}
    private static String utf8(byte[] b)throws CharacterCodingException{return StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT).onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(b)).toString();}
    private static String shorten(String s){return s.length()>MAX_PREVIEW?s.substring(0,MAX_PREVIEW)+"\n\n[Preview shortened. Download the original file to inspect all content.]":s;}

    private static String pdf(byte[] b)throws IOException {
        try(PDDocument document=Loader.loadPDF(b)){
            require(!document.isEncrypted(),"Encrypted PDFs cannot be reviewed; upload an unencrypted original.");
            require(document.getNumberOfPages()>0 && document.getNumberOfPages()<=500,"PDFs must contain between 1 and 500 pages.");
            Set<COSBase> seen=Collections.newSetFromMap(new IdentityHashMap<>());ArrayDeque<COSBase> queue=new ArrayDeque<>();queue.add(document.getDocument().getTrailer());int objects=0;long inflated=0;
            while(!queue.isEmpty()){
                COSBase value=queue.removeFirst();if(value==null||!seen.add(value))continue;
                require(++objects<=100_000,"PDF structure exceeds the review limit.");
                if(value instanceof COSObject o){COSBase v=o.getObject();if(v!=null)queue.add(v);}
                else if(value instanceof COSArray a){for(COSBase v:a)if(v!=null)queue.add(v);}
                else if(value instanceof COSDictionary d){
                    for(COSName key:d.keySet()){
                        require(!PDF_KEYS.contains(key.getName()),"PDF scripts, automatic actions, embedded files and XFA are not accepted.");
                        COSBase v=d.getDictionaryObject(key);
                        if(key.getName().equals("S") && v instanceof COSName n)require(!PDF_ACTIONS.contains(n.getName()),"This PDF contains an active or external action.");
                        if(v!=null)queue.add(v);
                    }
                    if(d instanceof COSStream stream)try(InputStream in=stream.createInputStream()){
                        byte[] buffer=new byte[8192];int count;while((count=in.read(buffer))!=-1){inflated+=count;require(inflated<=50L*1024*1024,"PDF decoded streams exceed the review limit.");}
                    }
                }
            }
            return shorten(new PDFTextStripper().getText(document));
        }
    }
    private static Document xml(byte[] b)throws Exception {
        // Use the JDK JAXP implementation, whose external-access restrictions are
        // supported even when an older XML provider is present in app libraries.
        // Never drop the DTD/entity/schema restrictions to accommodate a provider.
        DocumentBuilderFactory f=DocumentBuilderFactory.newDefaultInstance();f.setNamespaceAware(true);
        f.setFeature("http://apache.org/xml/features/disallow-doctype-decl",true);
        f.setFeature("http://xml.org/sax/features/external-general-entities",false);
        f.setFeature("http://xml.org/sax/features/external-parameter-entities",false);
        f.setAttribute(XMLConstants.ACCESS_EXTERNAL_DTD,"");f.setAttribute(XMLConstants.ACCESS_EXTERNAL_SCHEMA,"");f.setXIncludeAware(false);f.setExpandEntityReferences(false);
        var builder=f.newDocumentBuilder();
        builder.setErrorHandler(new org.xml.sax.helpers.DefaultHandler(){
            @Override public void error(org.xml.sax.SAXParseException e)throws org.xml.sax.SAXException{throw e;}
            @Override public void fatalError(org.xml.sax.SAXParseException e)throws org.xml.sax.SAXException{throw e;}
        });
        return builder.parse(new ByteArrayInputStream(b));
    }
    private static String docx(byte[] b)throws Exception {
        Map<String,byte[]> docs=new HashMap<>();Set<String> names=new HashSet<>();int entries=0,total=0;
        try(ZipInputStream zip=new ZipInputStream(new ByteArrayInputStream(b))){ZipEntry entry;
            while((entry=zip.getNextEntry())!=null){
                String name=entry.getName();String lower=name.toLowerCase(Locale.ROOT);
                require(++entries<=2048 && names.add(name),"DOCX has too many or duplicate ZIP entries.");
                require(!name.startsWith("/")&&!name.contains("\\")&&Arrays.stream(name.split("/")).noneMatch(".."::equals),"Unsafe DOCX archive path.");
                require(!lower.contains("vbaproject")&&!lower.contains("activex")&&!lower.startsWith("word/embeddings/"),"Macros, ActiveX and embedded objects are not accepted.");
                ByteArrayOutputStream content=new ByteArrayOutputStream();byte[] buffer=new byte[8192];int count;
                while((count=zip.read(buffer))!=-1){total+=count;require(total<=50*1024*1024 && content.size()+count<=20*1024*1024,"DOCX expanded size exceeds the review limit.");content.write(buffer,0,count);}
                if(name.equals("[Content_Types].xml")||name.equals("word/document.xml")||lower.endsWith(".rels"))docs.put(name,content.toByteArray());
            }
        }
        require(docs.containsKey("[Content_Types].xml")&&docs.containsKey("word/document.xml"),"The archive is not a Word DOCX document.");
        Document types=xml(docs.get("[Content_Types].xml"));require(types.getDocumentElement().getTextContent()!=null,"Invalid DOCX content types.");
        String typeText=utf8(docs.get("[Content_Types].xml")).toLowerCase(Locale.ROOT);
        require(typeText.contains("wordprocessingml.document.main+xml")&&!typeText.contains("macroenabled")&&!typeText.contains("vbaproject"),"Only ordinary DOCX documents without macros are accepted.");
        for(var e:docs.entrySet())if(e.getKey().toLowerCase(Locale.ROOT).endsWith(".rels")){
            NodeList list=xml(e.getValue()).getElementsByTagNameNS("*","Relationship");
            for(int i=0;i<list.getLength();i++){Element rel=(Element)list.item(i);String type=rel.getAttribute("Type").toLowerCase(Locale.ROOT);
                require(!type.contains("oleobject")&&!type.contains("attachedtemplate")&&!type.contains("afchunk"),"Active DOCX relationships are not accepted.");
                require(!"External".equalsIgnoreCase(rel.getAttribute("TargetMode"))||type.endsWith("/hyperlink"),"External DOCX media, templates and linked objects are not accepted.");
                if("External".equalsIgnoreCase(rel.getAttribute("TargetMode"))){
                    String scheme=java.net.URI.create(rel.getAttribute("Target")).getScheme();
                    require(scheme!=null&&Set.of("https","http","mailto").contains(scheme.toLowerCase(Locale.ROOT)),"Unsafe external DOCX hyperlink scheme.");
                }
            }
        }
        Document body=xml(docs.get("word/document.xml"));StringBuilder text=new StringBuilder();
        NodeList paras=body.getElementsByTagNameNS("http://schemas.openxmlformats.org/wordprocessingml/2006/main","p");
        for(int i=0;i<paras.getLength();i++){appendWordText(paras.item(i),text);text.append('\n');}
        return shorten(text.toString());
    }
    private static void appendWordText(Node node,StringBuilder out){
        if(node instanceof Element e){String local=e.getLocalName();if("t".equals(local)){out.append(e.getTextContent());return;}if("tab".equals(local)){out.append('\t');return;}if("br".equals(local)||"cr".equals(local)){out.append('\n');return;}}
        for(Node c=node.getFirstChild();c!=null;c=c.getNextSibling())appendWordText(c,out);
    }
    private static void dimensions(int w,int h)throws IOException{require(w>0&&h>0&&w<=8192&&h<=8192&&(long)w*h<=24_000_000,"Image dimensions exceed 8192 pixels per side or 24 megapixels.");}
    private static String image(byte[] b,String format)throws IOException{
        try(ImageInputStream input=ImageIO.createImageInputStream(new ByteArrayInputStream(b))){Iterator<ImageReader> readers=ImageIO.getImageReaders(input);require(readers.hasNext(),"The image cannot be decoded.");ImageReader reader=readers.next();
            try{reader.setInput(input,true,true);int w=reader.getWidth(0),h=reader.getHeight(0);dimensions(w,h);require(reader.read(0)!=null,"The original image cannot be decoded.");return w+" × "+h+" pixels";}finally{reader.dispose();}
        }
    }
    private static int le24(byte[] b,int p){return(b[p]&255)|((b[p+1]&255)<<8)|((b[p+2]&255)<<16);}
    private static String webp(byte[] b)throws IOException{
        require(b.length>=30 && starts(b,"RIFF") && new String(b,8,4,StandardCharsets.ISO_8859_1).equals("WEBP"),"The bytes do not match WebP.");
        long declared=Integer.toUnsignedLong(ByteBuffer.wrap(b,4,4).order(ByteOrder.LITTLE_ENDIAN).getInt());require(declared+8==b.length,"Invalid WebP container length.");
        String chunk=new String(b,12,4,StandardCharsets.ISO_8859_1);int w,h;
        if(chunk.equals("VP8X")){w=le24(b,24)+1;h=le24(b,27)+1;}
        else if(chunk.equals("VP8 ")){require((b[23]&255)==157&&(b[24]&255)==1&&(b[25]&255)==42,"Invalid WebP frame header.");w=((b[26]&255)|((b[27]&255)<<8))&16383;h=((b[28]&255)|((b[29]&255)<<8))&16383;}
        else if(chunk.equals("VP8L")){require((b[20]&255)==47,"Invalid lossless WebP header.");int bits=ByteBuffer.wrap(b,21,4).order(ByteOrder.LITTLE_ENDIAN).getInt();w=(bits&16383)+1;h=((bits>>>14)&16383)+1;}
        else throw new IOException("Unsupported WebP frame container.");
        dimensions(w,h);
        int p=12,frames=0,chunks=0;
        while(p<b.length){
            require(b.length-p>=8 && ++chunks<=1024,"Invalid WebP chunk structure.");
            String type=new String(b,p,4,StandardCharsets.ISO_8859_1);
            long size=Integer.toUnsignedLong(ByteBuffer.wrap(b,p+4,4).order(ByteOrder.LITTLE_ENDIAN).getInt());
            require(size<=b.length-p-8,"WebP chunk extends beyond the original file.");
            require(!Set.of("ANIM","ANMF").contains(type),"Animated WebP is not supported; upload a still image.");
            if(type.equals("VP8 ")){require(size>=11,"Missing WebP image payload.");require((b[p+11]&255)==157&&(b[p+12]&255)==1&&(b[p+13]&255)==42,"Invalid WebP frame signature.");frames++;}
            if(type.equals("VP8L")){require(size>=6&&(b[p+8]&255)==47,"Missing lossless WebP image payload.");frames++;}
            long next=p+8+size+(size&1);require(next<=b.length,"Invalid WebP chunk padding.");p=(int)next;
        }
        require(frames==1,"WebP must contain exactly one still-image frame.");
        return w+" × "+h+" pixels. WebP container checked; pixel decoding is performed by the browser preview.";
    }
    private static String mp4(byte[] b)throws IOException{
        boolean ftyp=false,moov=false,mdat=false;int p=0,boxes=0;
        while(p<b.length){require(b.length-p>=8 && ++boxes<=10000,"Invalid MP4 box structure.");long size=Integer.toUnsignedLong(ByteBuffer.wrap(b,p,4).getInt());String type=new String(b,p+4,4,StandardCharsets.ISO_8859_1);int header=8;
            if(size==1){require(b.length-p>=16,"Invalid MP4 extended box.");size=ByteBuffer.wrap(b,p+8,8).getLong();header=16;}else if(size==0)size=b.length-p;
            require(size>=header && size<=b.length-p,"MP4 box size exceeds the original file.");
            if(type.equals("ftyp")){require(size>=16,"Invalid MP4 brand box.");String brand=new String(b,p+header,4,StandardCharsets.ISO_8859_1);require(Set.of("isom","iso2","iso4","iso5","iso6","mp41","mp42","avc1","M4V ","dash").contains(brand),"Unsupported MP4 container brand.");ftyp=true;}
            if(type.equals("moov")){require(hasVideoTrack(b,p+header,p+(int)size),"MP4 must contain a video track with sample metadata.");moov=true;}
            if(type.equals("mdat")){require(size>header,"MP4 media payload is empty.");mdat=true;}p+=(int)size;
        }
        require(ftyp&&moov&&mdat,"MP4 must include its brand, movie metadata and media data.");return "MP4 container validated. Browser playback and codec compatibility must be checked in the preview.";
    }
    private record Box(String type,int from,int end){}
    private static List<Box> children(byte[] b,int p,int end)throws IOException{
        List<Box> list=new ArrayList<>();while(p<end){require(end-p>=8&&list.size()<10000,"Invalid MP4 child boxes.");
            long size=Integer.toUnsignedLong(ByteBuffer.wrap(b,p,4).getInt());int header=8;
            if(size==1){require(end-p>=16,"Invalid MP4 extended child box.");size=ByteBuffer.wrap(b,p+8,8).getLong();header=16;}
            else if(size==0)size=end-p;
            require(size>=header&&size<=end-p,"Invalid MP4 child length.");
            list.add(new Box(new String(b,p+4,4,StandardCharsets.ISO_8859_1),p+header,p+(int)size));p+=(int)size;
        }return list;
    }
    private static boolean hasVideoTrack(byte[] b,int from,int end)throws IOException{
        for(Box track:children(b,from,end))if(track.type.equals("trak"))for(Box media:children(b,track.from,track.end))if(media.type.equals("mdia")){
            boolean video=false,samples=false;
            for(Box child:children(b,media.from,media.end)){
                if(child.type.equals("hdlr")){require(child.end-child.from>=12,"Invalid MP4 handler.");video=new String(b,child.from+8,4,StandardCharsets.ISO_8859_1).equals("vide");}
                if(child.type.equals("minf"))for(Box table:children(b,child.from,child.end))if(table.type.equals("stbl"))for(Box desc:children(b,table.from,table.end))if(desc.type.equals("stsd")){
                    require(desc.end-desc.from>=8,"Invalid MP4 sample descriptions.");
                    int count=ByteBuffer.wrap(b,desc.from+4,4).getInt();
                    List<Box> entries=children(b,desc.from+8,desc.end);require(count==entries.size(),"MP4 sample count mismatch.");
                    for(Box entry:entries)if(Set.of("avc1","avc3","hvc1","hev1","av01","vp09","mp4v").contains(entry.type)){
                        require(entry.end-entry.from>=78,"Invalid MP4 visual sample entry.");
                        int width=Short.toUnsignedInt(ByteBuffer.wrap(b,entry.from+24,2).getShort());
                        int height=Short.toUnsignedInt(ByteBuffer.wrap(b,entry.from+26,2).getShort());dimensions(width,height);samples=true;
                    }
                }
            }if(video&&samples)return true;
        }return false;
    }
}
