package myfirstmodule.learning;

import java.io.StringReader;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.text.Normalizer;
import java.util.*;
import java.util.regex.Pattern;
import java.util.concurrent.atomic.AtomicLong;
import javax.swing.text.MutableAttributeSet;
import javax.swing.text.html.HTML;
import javax.swing.text.html.HTMLEditorKit;
import javax.swing.text.html.parser.ParserDelegator;

/** Pure deterministic ranking of current, separately authorized article snapshots. No database writes. */
public final class GroundedLearningRanker {
    private GroundedLearningRanker() {}
    public record Diagnosis(String system,String fault,double probability,Set<String> findings,String next,Set<String> concepts,Set<String> measurements) {}
    public record Article(String id,String title,String body,String key,String topic,boolean ai,boolean active,boolean current,boolean accessible,String license,String attribution) {}
    public record Recommendation(String articleId,String articleTitle,String heading,String reason,int score,String basis) {}
    private record Intent(String system,String heading,String faults,String next,String concepts,String terms,String reason) {}
    private static final Set<String> SYSTEMS=Set.of("ANALOG_ADC","DIGITAL_INPUT","LED_GPIO","I2C_SENSOR","UART_DEVICE","PWM_MOTOR_SERVO");
    private static final String SHARED_KEY="TROUBLESHOOTING", SHARED_TOPIC="FOUNDATION_TROUBLESHOOTING";
    private static final List<Intent> INTENTS=List.of(
        // Match an actual next check, never infer a fault from an article.
        new Intent("*","• Is there continuity between the pins, and is the connection secure?","","CONTINUITY,UART_TX_RX_CONTINUITY,UART_RX_TX_CONTINUITY","","continuity,connection,wire","This section explains checking the intended signal path. Disconnect virtual or circuit power before a continuity check; a good connection does not prove every component is healthy."),
        new Intent("*","• Why is my code not working even though it compiles?","","GPIO_MODE_READBACK,INPUT_MODE_READBACK","","pin,initialized,code","Review pin initialization before reading back the configured pin mode. This is configuration guidance, not evidence of a damaged device."),
        new Intent("PWM_MOTOR_SERVO","Examples","","PWM_LOAD_RESPONSE,PWM_ENABLE_READBACK","","duty cycle,servo,brightness","Compare the commanded PWM with the observed virtual load response. These examples explain output behavior; they do not establish a failed motor or driver."),
        new Intent("*","• Is your power supply sufficient enough?","PowerSupplyFault","SUPPLY_VOLTAGE,EXPECTED_SUPPLY_VOLTAGE","POWER_SUPPLY_BASICS,VOLTAGE_REGULATION","power supply,brown out,current","Learn why insufficient power can stop a circuit. Compare its voltage and current needs with your readings; this reading does not confirm a failed supply."),
        new Intent("ANALOG_ADC","Relating ADC Value to Voltage","VoltageLevelFault","ADC_REFERENCE,ADC_READING,EXPECTED_ADC_READING,OUTPUT_VOLTAGE,ADC_VREF_MEASURED,ADC_BITS_READBACK,ADC_GAIN_READBACK,ADC_PIN_VOLTAGE","ADC_CONFIGURATION,GROUND_REFERENCE,SAFE_INPUT_VOLTAGE","resolution,reference,adc counts,quantization","Use the voltage-to-count relationship to check the suspected ADC scaling or reference mismatch."),
        new Intent("ANALOG_ADC","Arduino ADC Example","ConfigurationFault","CONFIGURATION_OK","GPIO_CONFIGURATION","analog input,analogread,adc configuration","Compare the analog-input configuration with the source example before changing the setup."),
        new Intent("ANALOG_ADC","Hooking Things Up Backward","WiringFault","CONTINUITY","BASIC_WIRING,SIGNAL_PATH","analog input,wiring,connection","Check the analog-input wiring against this section before interpreting an unexpected reading."),
        new Intent("DIGITAL_INPUT","What is a Pull-up Resistor","WiringFault,SignalIntegrityFault","PULLUP_PRESENT,LOGIC_LEVEL","PULLUP_RESISTORS,LOGIC_LEVELS,GROUNDING","pull-up,pull up,floating input","Use the pull-up explanation to check whether a floating input has a defined logic level."),
        new Intent("DIGITAL_INPUT","What is a Pull-up Resistor","PowerSupplyFault","","","vcc,ground,pull-up","This section explains how an input is biased from VCC or ground. Confirm the intended supply before interpreting the input level."),
        new Intent("DIGITAL_INPUT","Calculating a Pull-up Resistor Value","VoltageLevelFault","EXPECTED_LOGIC_LEVEL","SAFE_INPUT_VOLTAGE","pull-up resistor,pull up resistor,input voltage","Compare the input bias and resistor value before treating an uncertain logic level as a failed component."),
        new Intent("LED_GPIO","1) Polarity Matters","PolarityFault","POLARITY_OK","POLARITY,DIODE_DIRECTION","led polarity,anode,cathode","Compare the LED orientation with this section before replacing an LED that does not light."),
        new Intent("LED_GPIO","Calculating Current Limiting Resistors","PowerSupplyFault,VoltageLevelFault","CURRENT,EXPECTED_CURRENT","CURRENT_REQUIREMENTS,VOLTAGE_DIVIDER","current limiting,led current,series resistor","Use the current-limiting calculation to check the suspected supply or LED current mismatch."),
        new Intent("LED_GPIO","LED Voltage","VoltageLevelFault","OUTPUT_VOLTAGE,EXPECTED_OUTPUT_VOLTAGE","SAFE_INPUT_VOLTAGE","forward voltage,led voltage","Compare the measured LED voltage with the source explanation before changing the supply."),
        new Intent("I2C_SENSOR","Address Frame","ConfigurationFault","ADDRESS_CORRECT,ACK_RECEIVED,I2C_ADDRESS_READBACK,I2C_OBSERVED_ADDRESS,I2C_ACK_FRACTION,I2C_ACK_COUNT,I2C_ATTEMPT_COUNT","ADDRESSING,COMMUNICATION_CONFIGURATION","i2c address,address frame,acknowledg","Check the address and acknowledgement explanation before changing the I2C configuration."),
        new Intent("I2C_SENSOR","Signals","WiringFault,SignalIntegrityFault,VoltageLevelFault","PULLUP_PRESENT,SDA_STATE,SCL_STATE","PULLUP_RESISTORS,SIGNAL_INTEGRITY,LOGIC_LEVELS","sda,scl,pull-up","Inspect the SDA/SCL connections and pull-ups before interpreting missing I2C activity."),
        new Intent("I2C_SENSOR","Protocol","CommunicationFault","COMMUNICATION_SUCCESS,I2C_ACK_FRACTION,I2C_ACK_COUNT,I2C_ATTEMPT_COUNT","I2C_BASICS","i2c frame,i2c protocol,start condition","Review the I2C frames to plan the next communication check without assuming the sensor has failed."),
        new Intent("UART_DEVICE","Baud Rate Mismatch","ConfigurationFault","BAUD_RATE_CORRECT,ACTUAL_BAUD,EXPECTED_BAUD","BAUD_RATE,COMMUNICATION_CONFIGURATION","baud rate,baud mismatch,baud settings","Compare the two endpoints' baud settings with this section when received data is incorrect."),
        new Intent("UART_DEVICE","RX-to-TX, TX-to-RX","WiringFault","TX_SIGNAL_PRESENT,RX_SIGNAL_PRESENT,CONTINUITY","BASIC_WIRING,SIGNAL_PATH","rx-to-tx,transmitter,receiver,tx and rx","Check transmitter-to-receiver wiring before interpreting missing UART receive activity."),
        new Intent("UART_DEVICE","Framing the data","CommunicationFault","COMMUNICATION_SUCCESS,UART_FRAME_ERROR_RATE,UART_FRAME_COUNT,UART_ERROR_COUNT,UART_PARITY_READBACK,UART_STOP_BITS_READBACK","UART_BASICS","parity,stop bit,uart frame","Compare data, parity and stop-bit agreement before repeating the UART communication check."),
        new Intent("UART_DEVICE","Hardware Implementation","PowerSupplyFault","","","voltage supply,vcc,ttl","This section relates UART logic levels to the supply rail. Confirm the intended supply before interpreting TX and RX levels."),
        new Intent("PWM_MOTOR_SERVO","Duty Cycle","ConfigurationFault","DUTY_CYCLE,EXPECTED_DUTY_CYCLE,PWM_PRESENT","GPIO_CONFIGURATION","duty cycle,pulse ratio,pulse width","Relate the measured duty cycle to the commanded pulse ratio before changing the PWM configuration.")
    );
    private record Section(String heading,String normalizedHeading,String text) {}
    private record Index(String text,List<Section> sections) {}
    // Only immutable text indexes are cached. Eligibility, actor and publication state are NEVER cached.
    private static final Map<String,Index> CACHE=Collections.synchronizedMap(new LinkedHashMap<>(128,.75f,true){
        @Override protected boolean removeEldestEntry(Map.Entry<String,Index> e){return size()>32;}
    });
    private static final AtomicLong PARSES=new AtomicLong();
    private static final Pattern SPACE=Pattern.compile("\\s+");
    private static final Map<String,String> INTENT_HEADINGS=Map.copyOf(INTENTS.stream().collect(java.util.stream.Collectors.toMap(Intent::heading,i->norm(i.heading),(a,b)->a)));
    public static long parseCount(){return PARSES.get();}
    public static void clearCache(){CACHE.clear();PARSES.set(0);}
    private static String norm(String s){return Normalizer.normalize(s==null?"":s,Normalizer.Form.NFKC).toLowerCase(Locale.ROOT).transform(v->SPACE.matcher(v).replaceAll(" ")).trim();}
    private static boolean csv(String list,String s){return s!=null&&!s.isBlank()&&Arrays.asList(list.split(",")).contains(s);}
    private static boolean intersects(String csv,Set<String> values){return values!=null&&values.stream().anyMatch(v->csv(csv,v));}
    private static int terms(String text,String csv){int n=0;for(String t:csv.split(","))if(text.contains(t))n++;return n;}
    private static String digest(String body){try{return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(body.getBytes(StandardCharsets.UTF_8)));}catch(Exception e){throw new IllegalStateException(e);}}
    private static Index index(String body){
        String hash=digest(body);Index cached=CACHE.get(hash);if(cached!=null)return cached;
        if(body.matches("(?is).*<\\s*(?:template|noscript)\\b.*"))return new Index("",List.of());
        PARSES.incrementAndGet();List<Section> sections=new ArrayList<>();StringBuilder full=new StringBuilder();
        try{new ParserDelegator().parse(new StringReader(body),new HTMLEditorKit.ParserCallback(){
            record Frame(String tag,boolean excluded){}
            final Deque<Frame> stack=new ArrayDeque<>();int excluded;
            StringBuilder heading;String currentHeading;StringBuilder text=new StringBuilder();
            boolean isHeading(HTML.Tag t){return Set.of(HTML.Tag.H1,HTML.Tag.H2,HTML.Tag.H3,HTML.Tag.H4,HTML.Tag.H5,HTML.Tag.H6).contains(t);}
            void finish(){if(currentHeading!=null&&sections.size()<512)sections.add(new Section(currentHeading,norm(currentHeading),norm(text.toString())));text=new StringBuilder();}
            @Override public void handleStartTag(HTML.Tag t,MutableAttributeSet a,int pos){
                String style=String.valueOf(a.getAttribute(HTML.Attribute.STYLE)).toLowerCase(Locale.ROOT);
                boolean hidden=a.getAttribute("hidden")!=null||"true".equalsIgnoreCase(String.valueOf(a.getAttribute("aria-hidden")))||style.matches("(?s).*\\b(?:display\\s*:\\s*none|visibility\\s*:\\s*hidden)\\b.*");
                boolean skip=hidden||Set.of(HTML.Tag.SCRIPT,HTML.Tag.STYLE,HTML.Tag.PRE,HTML.Tag.CODE,HTML.Tag.TEXTAREA).contains(t);
                stack.push(new Frame(t.toString(),skip));if(skip)excluded++;
                if(excluded==0&&isHeading(t)){finish();currentHeading=null;heading=new StringBuilder();}
            }
            @Override public void handleText(char[] value,int pos){if(excluded>0)return;String v=new String(value);if(full.length()<1_000_000)full.append(' ').append(v);if(heading!=null&&heading.length()<512)heading.append(v);else if(text.length()<16000)text.append(' ').append(v);}
            @Override public void handleEndTag(HTML.Tag t,int pos){
                if(isHeading(t)&&heading!=null){currentHeading=heading.toString().trim();heading=null;}
                if(stack.stream().anyMatch(f->f.tag.equals(t.toString()))){Frame f;do{f=stack.pop();if(f.excluded)excluded--;}while(!f.tag.equals(t.toString()));}
                if(t==HTML.Tag.HTML)finish();
            }
        },true);}catch(Exception e){return new Index("",List.of());}
        Index out=new Index(norm(full.toString()),List.copyOf(sections));CACHE.put(hash,out);return out;
    }
    private static boolean systemScope(Diagnosis d,Article a,Index idx){
        if(a.key.equals(SHARED_KEY))return a.topic.equals(SHARED_TOPIC);
        if(SYSTEMS.contains(a.key))return a.key.equals(d.system);
        if(!a.key.startsWith("USER_CONTRIBUTION_"))return false;
        String text=norm(a.title)+" "+idx.text;
        boolean foundation=switch(d.system){
            case "ANALOG_ADC"->a.topic.equals("FOUNDATION_ADC");
            case "DIGITAL_INPUT","LED_GPIO"->a.topic.equals("FOUNDATION_GPIO");
            case "I2C_SENSOR","UART_DEVICE"->a.topic.equals("FOUNDATION_INTERFACES");
            case "PWM_MOTOR_SERVO"->a.topic.equals("FOUNDATION_PWM");default->false;};
        boolean explicit=switch(d.system){
            case "ANALOG_ADC"->text.matches("(?s).*\\badc\\b.*")||text.contains("analog-to-digital");
            case "DIGITAL_INPUT"->text.contains("digital input")||text.contains("floating input")||text.contains("pull-up resistor");
            case "LED_GPIO"->text.contains("led ")||text.contains("light-emitting diode");
            case "I2C_SENSOR"->text.contains("i2c")&&(text.contains("sda")||text.contains("scl")||text.contains("address"));
            case "UART_DEVICE"->text.contains("uart")&&(text.contains("baud")||text.contains("rx")||text.contains("serial"));
            case "PWM_MOTOR_SERVO"->text.contains("pwm")&&(text.contains("duty cycle")||text.contains("pulse width"));default->false;};
        // AI posts need explicit system evidence too; their category alone is never enough.
        return explicit&&(foundation||a.ai&&Set.of("troubleshooting","digital-twin","sensors","robotics").contains(a.topic));
    }
    public static List<Recommendation> rank(Diagnosis d,List<Article> articles){
        if(d==null||!SYSTEMS.contains(d.system)||articles==null)return List.of();
        List<Recommendation> found=new ArrayList<>();Set<String> seenArticle=new HashSet<>();
        for(Article a:articles){
            if(a==null||!a.active||!a.current||!a.accessible||a.title==null||a.title.isBlank()||a.body==null||a.body.isBlank()||a.body.length()>1_000_000||a.license==null||a.license.isBlank()||a.attribution==null||a.attribution.isBlank()||!seenArticle.add(a.id))continue;
            if(SYSTEMS.contains(a.key)&&!a.key.equals(d.system))continue;
            if(!SYSTEMS.contains(a.key)&&!a.key.startsWith("USER_CONTRIBUTION_")&&!a.key.equals(SHARED_KEY))continue;
            if(a.key.startsWith("USER_CONTRIBUTION_")&&!a.ai){String expected=switch(d.system){case "ANALOG_ADC"->"FOUNDATION_ADC";case "DIGITAL_INPUT","LED_GPIO"->"FOUNDATION_GPIO";case "I2C_SENSOR","UART_DEVICE"->"FOUNDATION_INTERFACES";case "PWM_MOTOR_SERVO"->"FOUNDATION_PWM";default->"";};if(!a.topic.equals(expected))continue;}
            Index idx=index(a.body);if(idx.text.isBlank()||!systemScope(d,a,idx))continue;
            for(Intent intent:INTENTS){
                boolean shared=intent.system.equals("*");
                if(shared!=a.key.equals(SHARED_KEY)||(!shared&&!intent.system.equals(d.system)))continue;
                boolean concept=intersects(intent.concepts,d.concepts),next=csv(intent.next,d.next),finding=intersects(intent.faults,d.findings),hypothesis=Double.isFinite(d.probability)&&d.probability>=.6&&d.probability<=1&&csv(intent.faults,d.fault);
                if(!concept&&!next&&!finding&&!hypothesis)continue;
                // A shared supply section is not a generic system fallback.
                // Completed diagnoses still qualify through the actual finding/hypothesis.
                if(shared&&!next&&!finding&&!hypothesis)continue;
                Section exact=idx.sections.stream().filter(s->s.normalizedHeading.equals(INTENT_HEADINGS.get(intent.heading))).findFirst().orElse(null);
                String heading;int relevance;
                if(exact!=null&&!exact.text.isBlank()){heading=exact.heading;relevance=35;}
                else if(a.key.startsWith("USER_CONTRIBUTION_")&&!a.ai){
                    Section best=idx.sections.stream().filter(s->!s.normalizedHeading.matches(".*(?:rights|source|credit|reference).*")).max(Comparator.comparingInt(s->terms(s.normalizedHeading+" "+s.text,intent.terms))).orElse(null);
                    if(best!=null&&terms(best.normalizedHeading+" "+best.text,intent.terms)>=2){heading=best.heading;relevance=25;}
                    else if(terms(idx.text,intent.terms)>=2){heading=a.title;relevance=15;}else continue;
                }else continue;
                int score=relevance+(finding?45:0)+(next?35:0)+(hypothesis?25:0)+(concept?15:0)+(intersects(intent.next,d.measurements)?5:0)-(a.ai?65:0);
                // Generic AI applications never displace actionable foundational explanations.
                String explanation=intent.reason;
                if(!finding&&!hypothesis)explanation=explanation.replace("suspected ","possible ");
                String why=a.ai?"Background after the immediate check: "+explanation:!finding&&!hypothesis&&!next?"Background for this investigation: "+explanation:!finding&&!hypothesis?"Before the next measurement: "+explanation:explanation;
                found.add(new Recommendation(a.id,a.title,heading,why,score,finding?"strong finding":next?"next measurement":hypothesis?"plausible cause":"stable concept"));
            }
        }
        found.sort(Comparator.comparingInt(Recommendation::score).reversed().thenComparing(Recommendation::articleId).thenComparing(Recommendation::heading));
        LinkedHashMap<String,Recommendation> unique=new LinkedHashMap<>();Set<String> contentSections=new HashSet<>();
        Map<String,Article> byId=new HashMap<>();for(Article a:articles)if(a!=null)byId.put(a.id,a);
        for(Recommendation r:found){Article a=byId.get(r.articleId);String key=digest(a.body)+"|"+norm(r.heading);if(contentSections.add(key))unique.putIfAbsent(r.articleId+"|"+norm(r.heading),r);if(unique.size()==5)break;}
        return List.copyOf(unique.values());
    }
}
