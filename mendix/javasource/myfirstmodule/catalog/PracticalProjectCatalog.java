package myfirstmodule.catalog;

import com.mendix.core.Core;
import com.mendix.systemwideinterfaces.core.*;
import java.util.*;

/** Fixed source-backed project catalog. Additive, caller-context, Administrator only. */
public final class PracticalProjectCatalog {
    private PracticalProjectCatalog() {}
    private record Entry(String title,String level,int minutes,String summary,String hardware,String instructions,String topic) {}
    private static final List<Entry> ENTRIES=List.of(
        new Entry("LED Blinking Using an Independent Timer", "Beginner", 30,
            "Make an LED blink while your program stays responsive. Learn to schedule work with elapsed time instead of pausing the whole program.",
            "Arduino Uno or compatible board, USB cable, Arduino IDE. Optional external LED, 220 ohm resistor and breadboard.",
            "GOAL\nCreate a repeating LED timer without delay().\n\nBEFORE YOU START\nSelect your board and port in Arduino IDE. Use the built-in LED first. Disconnect USB before changing wiring.\n\nBUILD\n1. Open File > Examples > 02.Digital > BlinkWithoutDelay.\n2. Upload the original sketch and observe several on/off cycles.\n3. Change the interval, upload again and time ten cycles.\n4. Compare this with the standard Blink sketch. Explain why a long delay can miss another input.\n\nCHECK YOUR BUILD\nRecord the requested interval and measured period. An on/off period contains two intervals. A working compile alone does not prove the LED timing is correct.\n\nIF IT DOES NOT WORK\nCheck board selection, port and LED pin. Add an external LED only with the specified series resistor.\n\nTRY NEXT\nAdd a button-reading task without adding a blocking delay.\n\nSOURCE\nArduino, Blink Without Delay. Original example code is public domain. This is a MicroExplore build checklist; use the source button for the original circuit and code.",
            "FOUNDATION_GPIO"),
        new Entry("Pushbutton Debouncing and LED State Control", "Beginner", 45,
            "Wire a button that toggles an LED once per press. Compare raw contact changes with a stable, debounced input.",
            "Arduino Uno, USB cable, breadboard, pushbutton, 10 kohm resistor and wires. Use the built-in LED or an LED with a 220 ohm resistor.",
            "GOAL\nMake a button toggle the LED once, rather than reacting to every contact bounce.\n\nBEFORE YOU START\nUse the Uno circuit in the original example. The button connects pin 2 to 5 V; a 10 kohm resistor pulls pin 2 to ground. Disconnect power before wiring.\n\nBUILD\n1. Open File > Examples > 02.Digital > Debounce.\n2. Compare every connection with the source diagram before applying USB power.\n3. Upload the sketch and press the button slowly ten times.\n4. Try quick presses and record missed or extra toggles.\n\nCHECK YOUR BUILD\nThe LED should change once for each accepted press. Observe the released and pressed input levels; do not assume every unexpected transition is a damaged component.\n\nIF IT DOES NOT WORK\nCheck the button's internal terminal pairs, resistor connection and input pin. A floating input is not a debounce measurement.\n\nTRY NEXT\nExperiment with the debounce interval and compare response against extra toggles.\n\nSOURCE\nArduino Debounce, by David A. Mellis and contributors. Example code is public domain. Original wiring and code are available through the source button.",
            "FOUNDATION_GPIO"),
        new Entry("Potentiometer-Based Servo Position Control", "Intermediate", 60,
            "Turn a knob to control a hobby servo. Connect an analog measurement to a physical output and check the usable motion range.",
            "Arduino Uno, supported hobby servo, 10 kohm potentiometer, wires and a servo-rated regulated supply. Check current and voltage ratings first.",
            "GOAL\nControl a servo position with a potentiometer.\n\nBEFORE YOU START\nComplete a basic input/output project. Check your servo's voltage, current and travel limits. Never power a servo from a GPIO pin; use a suitable supply and a common signal ground.\n\nBUILD\n1. Follow the original Knob circuit: potentiometer wiper to A0 and servo signal to pin 9 on Uno.\n2. Verify the potentiometer end connections and servo supply before powering.\n3. Open Servo > Knob in the IDE examples and upload.\n4. Move the knob slowly through a conservative, unobstructed range.\n\nCHECK YOUR BUILD\nRecord input counts and requested angle at several positions. Compare requested position with observed movement; no position feedback is measured by this sketch.\n\nIF IT DOES NOT WORK\nStop if the servo stalls, heats or repeatedly resets the board. Recheck supply capacity and shared ground before changing code.\n\nTRY NEXT\nLimit the mapped angles to your mechanism's safe travel.\n\nSOURCE\nArduino Servo Motor Basics and the Servo library Knob example, by Michal Rinott and contributors. Open the source for the wiring and original code.",
            "FOUNDATION_PWM"),
        new Entry("Three-Channel Analog Data Logging to SD Card", "Intermediate", 90,
            "Save three analog inputs to a removable SD card, then compare the saved rows with the serial output.",
            "Arduino Uno, compatible level-shifted SD module or shield, formatted SD card, three 10 kohm potentiometers, breadboard, wires and USB cable.",
            "GOAL\nRecord three analog channels in a file you can reopen on a computer.\n\nBEFORE YOU START\nUse an SD module rated for your board's signal voltage. A bare SD card is not 5 V tolerant. Back up the card and follow its formatting requirements.\n\nBUILD\n1. Wire potentiometer wipers to A0, A1 and A2, with input voltages within board limits.\n2. Follow your module's SPI wiring; the source example uses chip-select pin 10 on Uno.\n3. Open SD > Datalogger and match the chipSelect constant to your module.\n4. Upload, open Serial Monitor at 9600 baud and check initialization.\n5. Vary one input at a time. Stop acquisition before removing the card.\n\nCHECK YOUR BUILD\nOpen datalog.txt on a computer. Compare its three comma-separated counts with the serial observations. Record missing rows; this example does not supply precision timestamps.\n\nIF IT DOES NOT WORK\nCheck card format, CS selection, power and SPI direction against module documentation.\n\nTRY NEXT\nAdd elapsed timestamps and a deliberate recording interval.\n\nSOURCE\nArduino SD library Datalogger, Tom Igoe. Original example code is public domain; open the source for the complete sketch.",
            "FOUNDATION_ADC"),
        new Entry("Digital Signal Acquisition Using Raspberry Pi Pico PIO", "Advanced", 150,
            "Use PIO and DMA to capture digital transitions on a Raspberry Pi Pico. Compare the captured trace with a known PWM test signal.",
            "Raspberry Pi Pico, USB cable, computer with the Pico C/C++ SDK toolchain. Optional 3.3 V logic source; never connect 5 V GPIO signals.",
            "GOAL\nCapture a digital trace using a peripheral and DMA rather than polling each sample in software.\n\nBEFORE YOU START\nBe comfortable compiling a Pico SDK example. Start with the example's internal PWM test. Pico GPIO is 3.3 V only; external circuits need compatible levels and common ground.\n\nBUILD\n1. Configure the official pico-examples repository for your Pico board.\n2. Build pio/logic_analyser and flash its generated firmware.\n3. Open the configured USB serial output.\n4. Inspect the captured lines for pins 16 and 17 in the original example.\n5. Compare the trace with the source's two PWM duty settings.\n\nCHECK YOUR BUILD\nRecord capture length, pin count, sample clock and observed transitions. Calculate the time represented by each sample; a short digital trace cannot establish analog signal integrity.\n\nIF IT DOES NOT WORK\nCheck SDK setup, board selection and serial configuration. Keep the initial example unchanged until you reproduce its capture.\n\nTRY NEXT\nCapture a slower, known 3.3 V signal and investigate sampling limits.\n\nSOURCE\nRaspberry Pi pico-examples, PIO logic_analyser, BSD-3-Clause. This checklist links to the original source; it is not a claim of a locally measured build.",
            "FOUNDATION_INTERFACES"),
        new Entry("Raspberry Pi Pico USB MIDI Controller with Arcade Buttons", "Advanced", 240,
            "Assemble a USB MIDI instrument with an arcade-button grid. Progress from input wiring to note events, enclosure assembly and optional display feedback.",
            "Pico, USB cable, arcade buttons, wires and compatible CircuitPython setup. Full build: AW9523 LED driver, OLED, navigation switch and case; see source BOM.",
            "GOAL\nBuild a playable USB MIDI controller from the published Raspberry Pi Pico project.\n\nBEFORE YOU START\nRead the source bill of materials and circuit diagram. You need confident wiring and soldering skills. Keep power disconnected while assembling and use the source's voltage-compatible components.\n\nBUILD\n1. Follow the guide's CircuitPython installation and library requirements.\n2. Install its MIDI controller code and confirm USB device detection.\n3. Follow the button and common-ground wiring diagram; check each input before final assembly.\n4. Add the optional LED driver, display and navigation controls only after the input stage works.\n5. Finish the enclosure and test with a MIDI monitor or DAW.\n\nCHECK YOUR BUILD\nPress and release each button. Record note-on, note-off and assigned note numbers. Confirm that no note remains active after release.\n\nIF IT DOES NOT WORK\nInspect wiring continuity and library versions before closing the case. Reduce to one verified input when isolating a problem.\n\nTRY NEXT\nAdjust note mappings for your instrument.\n\nSOURCE\nLiz Clark and Noe Ruiz, Adafruit Learning System. Original code, diagrams, files and their licenses remain at the source. This is an original MicroExplore build checklist, not a copied tutorial.",
            "FOUNDATION_GPIO")
    );
    public static String importCatalog(IContext c) throws Exception {
        if(c==null || c.getSession()==null || Boolean.TRUE.equals(c.getSession().getUser(c).isAnonymous()) || !c.getSession().getUserRolesNames().contains("Administrator"))
            throw new IllegalArgumentException("An authenticated administrator is required.");
        int revised=AcademicProjectTitles.migrate(c);
        Map<String,IMendixObject> topics=new HashMap<>();
        for(IMendixObject t:Core.createXPathQuery("//MyFirstModule.Topic[IsActive=true()]").execute(c)) {
            String code=t.getValue(c,"CatalogCode");
            if(topics.put(code,t)!=null && ENTRIES.stream().anyMatch(e->e.topic().equals(code)))
                throw new IllegalStateException("Ambiguous active topic: "+code);
        }
        for(Entry e:ENTRIES)if(!topics.containsKey(e.topic()))throw new IllegalStateException("Required active topic missing: "+e.topic());
        Map<String,Integer> existing=new HashMap<>();
        for(IMendixObject p:Core.createXPathQuery("//MyFirstModule.Project").execute(c))existing.merge(p.getValue(c,"Title"),1,Integer::sum);
        List<IMendixObject> created=new ArrayList<>();
        for(Entry e:ENTRIES) {
            if(existing.containsKey(e.title()))continue; // Never overwrite, reactivate, or delete an existing project.
            IMendixObject p=Core.instantiate(c,"MyFirstModule.Project");
            p.setValue(c,"Title",e.title());p.setValue(c,"Description",e.summary());
            p.setValue(c,"RequiredHardware",e.hardware());p.setValue(c,"Instructions",e.instructions());
            p.setValue(c,"Difficulty",e.level());p.setValue(c,"EstimatedTime",e.minutes());
            p.setValue(c,"IsActive",true);p.setValue(c,"IsDeleted",false);
            p.setValue(c,"PublicAuthorName","MicroExplore - source-backed build checklist");
            p.setValue(c,"MyFirstModule.Project_Topic",topics.get(e.topic()).getId());created.add(p);
        }
        if(!created.isEmpty())Core.commit(c,created);
        String report="Practical projects: "+created.size()+" added; "+(ENTRIES.size()-created.size())+" already present. Existing project content retained. Titles revised: "+revised+".";
        Core.getLogger("PracticalProjectCatalog").info(report);return report;
    }
}
