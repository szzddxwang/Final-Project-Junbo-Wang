package myfirstmodule.actions;

import java.util.Locale;
import java.util.regex.Pattern;

/** Presentation-only text boundary. Never used for inference or audit storage. */
public final class PublicAIText {
    private PublicAIText() {}
    private static final Pattern PRIVATE = Pattern.compile(
        "(?i)(?:\\b[a-f0-9]{32,64}\\b|\\b[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}\\b|"
        + "\\b[\\w.-]+-[a-f0-9]{10,}\\b|\\b\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}[^\\s]*|"
        + "(?:[A-Z]:[\\\\/]|/(?:mnt|home|Users|tmp|app|models|ai)/)[^\\s]*|"
        + "(?:https?://)?(?:127\\.0\\.0\\.1|localhost):\\d+[^\\s]*|"
        + "(?:model_version|artifact_hash|artifact_sha256|input_hash|invocation_id|trace_id|request_id|artifact_path|raw_json|debug_json)\\s*[:=]|"
        + "SHA-?256|Traceback \\(most recent|java\\.[a-z]+\\..*Exception|\\{[\\s\\S]*[:=][\\s\\S]*\\})");

    public static String clean(String value) {
        if (value == null || value.isBlank()) return "";
        String text = value.strip();
        if (PRIVATE.matcher(text).find()) return "Additional technical information is retained in the internal audit record.";
        text = text.replaceAll("\\b(?:EXECUTED|NOT_RUN_MISSING_INPUT|MODEL_UNAVAILABLE|INFERENCE_FAILED|NOT_SUPPORTED_FOR_SYSTEM)\\b", "See execution status")
                   .replace("PYTHON_SIMULATION", "Simulated evidence").replace("SIMULATION", "Simulation")
                   .replace("ANALOG_ADC", "Analog ADC").replace("UART_DEVICE", "UART device")
                   .replace("I2C_SENSOR", "I2C sensor").replace("LED_GPIO", "LED / GPIO")
                   .replace("PWM_MOTOR_SERVO", "PWM motor / servo").replace("DIGITAL_INPUT", "Digital input");
        return text.length() > 600 ? text.substring(0, 597).stripTrailing() + "…" : text;
    }

    public static String name(String original, String version, String title) {
        if (original.startsWith("Run A: ") || original.startsWith("Run B: "))
            return original.substring(0, 7) + name(original.substring(7), version, title);
        String n = original.toLowerCase(Locale.ROOT), v = version.toLowerCase(Locale.ROOT);
        if (v.startsWith("adc-raw-")) return "ADC Evidence Model";
        if (n.contains("structured diagnosis") || v.startsWith("stable-xgboost")) return "Structured Diagnosis — XGBoost";
        if (n.contains("isolation")) return "Sensor Anomaly Detection — Isolation Forest";
        if (n.contains("temporal") && title.toLowerCase(Locale.ROOT).contains("sensor")) return "Sensor Temporal AI";
        if (n.contains("fusion") || n.contains("combination") || n.contains("gate"))
            return v.startsWith("paired-") ? "Multimodal Fusion — Paired Evidence" : "Multimodal Fusion";
        if (n.contains("unknown") || n.contains("ood") || n.contains("uncertainty")) return "Unknown Pattern Assessment";
        if (n.contains("waveform") || n.contains("cnn")) return "Waveform AI — Temporal Analysis";
        if (v.startsWith("revised-expert")) return "System Expert — Structured Evidence";
        if (n.contains("random forest")) return "Physics-Based Analysis — Random Forest";
        if (n.contains("physics") || n.contains("engineering") || n.contains("physical") || n.contains("rules")) return "Physics-Based Analysis";
        if (n.contains("reference") || n.contains("estimate") || n.contains("inversion")) return "ADC Reference Estimate";
        return clean(original.replaceAll("(?i)\\s*[·-]?\\s*v\\d+(?:\\.\\d+)*\\b", "").strip());
    }

    public static String how(String name) {
        if (name.contains("PWM timing")) return "Calculates period, pulse widths and average output voltage from the chosen frequency, duty cycle and output level.";
        if (name.contains("GPIO state")) return "Applies the configured drive, external level and pull setting to determine the simulated pin state.";
        if (name.contains("XGBoost")) return "Compares your available measurements with learned fault patterns to rank possible root causes.";
        if (name.contains("ADC Evidence")) return "Uses observable ADC readings and the declared circuit settings to rank possible root faults.";
        if (name.contains("Multimodal")) return "Combines the available measurement and physical evidence. A missing waveform contributes no waveform evidence.";
        if (name.contains("Isolation Forest")) return "Looks for sensor readings that differ from familiar patterns. Its anomaly score is not a fault probability.";
        if (name.contains("Sensor Temporal")) return "Examines changes over the sensor capture to recognize learned signal patterns.";
        if (name.contains("Random Forest")) return "Uses learned decision trees on physical features extracted from the captured signal. The result is a learned pattern score, not a deterministic engineering rule or an independently verified fault.";
        if (name.contains("Waveform")) return "Examines the captured signal over time. Signal-pattern probabilities describe patterns, not root causes.";
        if (name.contains("Unknown")) return "Checks whether the observed signal is sufficiently different from familiar examples to merit a warning.";
        if (name.contains("System Expert")) return "Compares structured observations with system-specific learned fault patterns.";
        if (name.contains("Estimate")) return "Uses measured voltage, ADC count and declared resolution to estimate a reference voltage consistent with quantization.";
        return "Checks the observed electrical or protocol behavior against the applicable physical relationships.";
    }

    public static String limitations(String name, boolean experimental, String state, String scope) {
        if (!state.equals("EXECUTED")) return "This method did not produce a new prediction for the current evidence.";
        if (name.contains("PWM timing")) return "Ideal timing and voltage calculation. Physical switching behavior and load effects were not measured.";
        if (name.contains("GPIO state")) return "Simulated logic only. Physical pin voltage and electrical faults were not measured.";
        if (name.contains("Isolation Forest")) return "Normal operating changes can trigger false alarms. Confirm with the signal and engineering checks.";
        if (name.contains("Unknown")) return "Validated only on limited simulated dynamic signals. A warning does not establish a new fault or block the stable diagnosis.";
        if (name.contains("System Expert")) return "This experimental candidate did not pass the improvement gate. The stable diagnosis remains authoritative.";
        if (name.contains("Estimate")) return "The displayed interval reflects ADC quantization, not a statistical confidence interval. Measurement error is not fully represented.";
        if (experimental) return "Experimental result based on simulated evidence. Performance on real hardware has not been validated.";
        return "A model score is not proof of a fault. Missing or ambiguous measurements can change the ranking.";
    }

    public static String next(String state, String name) {
        if (state.equals("NOT_RUN_MISSING_INPUT")) return "Supply the missing measurement or waveform, then run analysis again.";
        if (state.equals("NOT_SUPPORTED_FOR_SYSTEM")) return "Use a supported method for this system or follow the next measurement check.";
        if (!state.equals("EXECUTED")) return "Keep the saved result, check the inputs and retry the analysis when the service is available.";
        if (name.contains("PWM timing")) return "Change the duty cycle and compare pulse width and average voltage before checking hardware.";
        if (name.contains("GPIO state")) return "Change the external level or pull setting and compare the expected and simulated states.";
        if (name.contains("Unknown")) return "Inspect the signal and collect another independent measurement before drawing a conclusion.";
        return "Compare this result with the other evidence and follow the suggested next check.";
    }
}
