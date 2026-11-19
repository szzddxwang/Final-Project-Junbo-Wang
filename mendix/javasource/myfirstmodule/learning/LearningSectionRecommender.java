package myfirstmodule.learning;
import java.util.*;
import java.io.StringReader;
import java.text.Normalizer;
import java.util.regex.Pattern;
import javax.swing.text.MutableAttributeSet;
import javax.swing.text.html.HTML;
import javax.swing.text.html.HTMLEditorKit;
import javax.swing.text.html.parser.ParserDelegator;
/** Deterministic reading guidance. Never asserts that a hardware fault is confirmed. */
public final class LearningSectionRecommender {
    private record Rule(String system,String heading,String faults,String measurements,String knowledge,String reason) {}
    private static final List<Rule> RULES=List.of(
        new Rule("ANALOG_ADC", "Relating ADC Value to Voltage", "VoltageLevelFault", "ADC_REFERENCE,ADC_READING,EXPECTED_ADC_READING,OUTPUT_VOLTAGE", "ADC_CONFIGURATION,GROUND_REFERENCE,SAFE_INPUT_VOLTAGE", "Compare voltage, reference and ADC counts using the source conversion relationship."),
        new Rule("ANALOG_ADC", "Arduino ADC Example", "ConfigurationFault", "CONFIGURATION_OK", "GPIO_CONFIGURATION", "Review analog input configuration and the source readout example."),
        new Rule("ANALOG_ADC", "Hooking Things Up Backward", "WiringFault", "CONTINUITY", "BASIC_WIRING,SIGNAL_PATH", "Check the analog-input connection against the source wiring cautions."),
        new Rule("DIGITAL_INPUT", "What is a Pull-up Resistor", "WiringFault,SignalIntegrityFault", "PULLUP_PRESENT,LOGIC_LEVEL", "PULLUP_RESISTORS,LOGIC_LEVELS,GROUNDING", "Review how a pull-up gives an otherwise floating input a defined level."),
        new Rule("DIGITAL_INPUT", "Calculating a Pull-up Resistor Value", "VoltageLevelFault", "EXPECTED_LOGIC_LEVEL", "SAFE_INPUT_VOLTAGE", "Use the resistor calculation to interpret the input voltage and bias."),
        new Rule("LED_GPIO", "1) Polarity Matters", "PolarityFault", "POLARITY_OK", "POLARITY,DIODE_DIRECTION", "Compare the LED orientation with the source polarity explanation."),
        new Rule("LED_GPIO", "Calculating Current Limiting Resistors", "PowerSupplyFault,VoltageLevelFault", "CURRENT,EXPECTED_CURRENT", "CURRENT_REQUIREMENTS,VOLTAGE_DIVIDER", "Review current limiting and the relationship between supply and LED voltage."),
        new Rule("LED_GPIO", "LED Voltage", "", "OUTPUT_VOLTAGE,EXPECTED_OUTPUT_VOLTAGE", "SAFE_INPUT_VOLTAGE", "Compare the output reading with the source LED voltage discussion."),
        new Rule("I2C_SENSOR", "Address Frame", "ConfigurationFault", "ADDRESS_CORRECT,ACK_RECEIVED", "ADDRESSING,COMMUNICATION_CONFIGURATION", "Inspect address and acknowledgement concepts before changing bus configuration."),
        new Rule("I2C_SENSOR", "Signals", "WiringFault,SignalIntegrityFault,VoltageLevelFault", "PULLUP_PRESENT,SDA_STATE,SCL_STATE", "PULLUP_RESISTORS,SIGNAL_INTEGRITY,LOGIC_LEVELS", "Review SDA/SCL pull-ups and electrical connections before interpreting bus activity."),
        new Rule("I2C_SENSOR", "Protocol", "CommunicationFault", "COMMUNICATION_SUCCESS", "I2C_BASICS", "Review I2C frames to separate communication failure from a confirmed component failure."),
        new Rule("UART_DEVICE", "Baud Rate Mismatch", "ConfigurationFault", "BAUD_RATE_CORRECT,ACTUAL_BAUD,EXPECTED_BAUD", "BAUD_RATE,COMMUNICATION_CONFIGURATION", "Compare the two endpoints' baud settings using the source mismatch example."),
        new Rule("UART_DEVICE", "RX-to-TX, TX-to-RX", "WiringFault", "TX_SIGNAL_PRESENT,RX_SIGNAL_PRESENT,CONTINUITY", "BASIC_WIRING,SIGNAL_PATH", "Compare transmitter-to-receiver wiring before interpreting missing receive activity."),
        new Rule("UART_DEVICE", "Framing the data", "CommunicationFault", "COMMUNICATION_SUCCESS", "UART_BASICS", "Review frame, parity and stop-bit agreement between the endpoints."),
        new Rule("PWM_MOTOR_SERVO", "Duty Cycle", "ConfigurationFault", "DUTY_CYCLE,EXPECTED_DUTY_CYCLE,PWM_PRESENT", "GPIO_CONFIGURATION", "Relate the measured duty cycle to the commanded pulse ratio."),
        new Rule("PWM_MOTOR_SERVO", "Examples", "", "OUTPUT_VOLTAGE,EXPECTED_OUTPUT_VOLTAGE", "COMPONENT_TESTING", "Background only: compare pulse examples with the output response. This source does not explain motor supply or driver faults."));
    private static boolean contains(String csv,String value) {return value!=null&&!value.isEmpty()&&Arrays.asList(csv.split(",")).contains(value);}
    private static final String UNAVAILABLE="No verified learning resource is currently available for this system. Continue with the next measurement guidance.";
    private static final String NO_SECTION="General background only: no verified section in the current reading matches this learning concept. Use the next measurement guidance.";
    private static final Pattern UNSUPPORTED_CONDITIONAL_MARKUP=Pattern.compile("(?i)<\\s*(?:template|noscript)\\b");

    /** Request-local, read-only evidence. Only a current eligible article body may create it. */
    public static final class ArticleEvidence {
        private final boolean available;
        private final Set<String> headings;
        private ArticleEvidence(boolean available,Set<String> headings) {
            this.available=available;
            this.headings=Set.copyOf(headings);
        }
    }
    private static String normalized(String value) {
        return Normalizer.normalize(value,Normalizer.Form.NFKC)
            .replace('\u00a0',' ').replaceAll("[\\s\\p{Z}]+"," ").trim().toLowerCase(Locale.ROOT);
    }
    private static boolean heading(HTML.Tag tag) {
        return tag==HTML.Tag.H1||tag==HTML.Tag.H2||tag==HTML.Tag.H3||tag==HTML.Tag.H4||tag==HTML.Tag.H5||tag==HTML.Tag.H6;
    }
    /** Parse markup as data; no script execution, network access or HTML rendering. */
    public static ArticleEvidence inspectArticle(String body) {
        if(body==null||body.isBlank()||body.length()>1_000_000)return new ArticleEvidence(false,Set.of());
        // The JDK parser is HTML 3.2 based. Do not infer visible headings from
        // HTML5 template/conditional content it cannot model reliably.
        if(UNSUPPORTED_CONDITIONAL_MARKUP.matcher(body).find())return new ArticleEvidence(true,Set.of());
        Set<String> headings=new HashSet<>();
        try {
            new ParserDelegator().parse(new StringReader(body),new HTMLEditorKit.ParserCallback() {
                private HTML.Tag current;
                private StringBuilder text;
                private boolean tooLong;
                private record Frame(String tag,boolean excluded) {}
                private final Deque<Frame> frames=new ArrayDeque<>();
                private int excludedDepth;
                @Override public void handleStartTag(HTML.Tag tag,MutableAttributeSet attributes,int position) {
                    String style=String.valueOf(attributes.getAttribute(HTML.Attribute.STYLE)).toLowerCase(Locale.ROOT);
                    boolean hidden=attributes.getAttribute("hidden")!=null
                        ||"true".equalsIgnoreCase(String.valueOf(attributes.getAttribute("aria-hidden")))
                        ||style.matches("(?s).*\\b(?:display\\s*:\\s*none|visibility\\s*:\\s*hidden)\\b.*");
                    boolean excluded=tag==HTML.Tag.SCRIPT||tag==HTML.Tag.STYLE||tag==HTML.Tag.PRE||tag==HTML.Tag.CODE||tag==HTML.Tag.TEXTAREA
                        ||Set.of("template","noscript").contains(tag.toString().toLowerCase(Locale.ROOT))||hidden;
                    frames.push(new Frame(tag.toString(),excluded));
                    if(excluded)excludedDepth++;
                    if(excludedDepth==0&&heading(tag)){current=tag;text=new StringBuilder();tooLong=false;}
                }
                @Override public void handleText(char[] value,int position) {
                    if(current!=null&&excludedDepth==0) {
                        if(text.length()+value.length<=512)text.append(value);else tooLong=true;
                    }
                }
                @Override public void handleEndTag(HTML.Tag tag,int position) {
                    if(current==tag) {
                        if(!tooLong&&headings.size()<512)headings.add(normalized(text.toString()));
                        current=null;text=null;
                    }
                    if(frames.stream().anyMatch(f->f.tag.equals(tag.toString()))) {
                        Frame frame;
                        do {frame=frames.pop();if(frame.excluded)excludedDepth--;}
                        while(!frame.tag.equals(tag.toString()));
                    }
                }
            },true);
            return new ArticleEvidence(true,headings);
        } catch(Exception invalidMarkup) {
            return new ArticleEvidence(false,Set.of());
        }
    }
    /** Compatibility overload deliberately makes no unverified source claim. */
    public static String explain(String system,String knowledge,String leadingFault,double probability,String next,Set<String> findingFaults,String fallback) {
        return UNAVAILABLE;
    }
    public static String explain(String system,String knowledge,String leadingFault,double probability,String next,Set<String> findingFaults,String fallback,String articleBody) {
        return explain(system,knowledge,leadingFault,probability,next,findingFaults,inspectArticle(articleBody));
    }
    public static String explain(String system,String knowledge,String leadingFault,double probability,String next,Set<String> findingFaults,ArticleEvidence article) {
        if(article==null||!article.available)return UNAVAILABLE;
        record Match(Rule rule,int score,String basis) {}
        List<Match> matches=new ArrayList<>();
        for(Rule r:RULES) {
            // Concept AND current source heading are eligibility gates. An unrelated
            // global finding cannot redirect every recommendation to the same section.
            if(!r.system.equals(system)||!contains(r.knowledge,knowledge)||!article.headings.contains(normalized(r.heading)))continue;
            int score=40;String basis="Concept: ";
            if(findingFaults!=null&&findingFaults.stream().anyMatch(f->contains(r.faults,f))){score+=30;basis="Finding: ";}
            else if(Double.isFinite(probability)&&probability>=0.60&&probability<=1.0&&contains(r.faults,leadingFault)){score+=20;basis="Hypothesis: ";}
            else if(contains(r.measurements,next)){score+=10;basis="Next check: ";}
            matches.add(new Match(r,score,basis));
        }
        matches.sort(Comparator.comparingInt(Match::score).reversed());
        if(matches.isEmpty())return NO_SECTION;
        // Existing native Reason is limited to 200 characters. One top section
        // satisfies the 1-3 limit without a domain/security migration.
        Match m=matches.get(0);
        String prefix="Recommended section: "+m.rule.heading+"\nWhy: "+m.basis;
        String reason=m.rule.reason;
        int room=200-prefix.length();
        if(reason.length()>room){int end=reason.lastIndexOf(' ',room-1);reason=reason.substring(0,end>0?end:room-1)+"…";}
        return prefix+reason;
    }
}
