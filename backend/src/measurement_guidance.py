"""Low-voltage measurement protocols; no observations or diagnosis hints."""

from .config import load_config


DISABLED_LEARNER_CHECKS = {"NOISE_LEVEL"}
SAFETY_NOTE = "Use low-voltage educational circuits or simulation only. Do not probe mains circuits."

# Alternatives are OR, not a requirement to own every listed instrument.
PROTOCOLS = {
    "SUPPLY_VOLTAGE": {
        "quantity": "DC voltage", "point": "device VDD/VCC pin",
        "reference": "circuit ground", "tools": ["MULTIMETER", "SIMULATION"],
        "how": "With the low-voltage circuit powered, read DC volts between the supply pin and ground, or read the matching simulation probe. Enter volts.",
        "why": "Checks whether the device receives its supply at the device, not only at the power source.",
    },
    "OUTPUT_VOLTAGE": {
        "quantity": "DC voltage", "point": "sensor output pin before the ADC input",
        "reference": "circuit ground", "tools": ["MULTIMETER", "SIMULATION"],
        "how": "Read DC volts from the sensor output to ground at a steady input, or read the sensor-output simulation probe. Enter volts, not ADC counts.",
        "why": "Separates the sensor output from the downstream ADC reading.",
    },
    "CURRENT": {
        "quantity": "device supply current", "point": "device supply-current simulation probe",
        "reference": "the same device supply branch", "tools": ["SIMULATION"],
        "how": "Read the simulated current entering the device supply branch in amperes. Do not place a current-mode meter across a supply. Physical current measurement is outside this beginner protocol.",
        "why": "Checks device loading without asking a beginner to rewire a powered circuit.",
    },
    "CONTINUITY": {
        "quantity": "intended signal-path continuity", "point": "the two ends of the intended signal wire",
        "reference": "circuit schematic", "tools": ["MULTIMETER", "SIMULATION"],
        "how": "Disconnect all power before using continuity mode; check the intended wire end to end. In simulation inspect that exact connection. Confirm Yes only for the intended continuous path, not an unrelated parallel route.",
        "why": "Tests an open connection independently of software configuration.",
    },
    "POLARITY_OK": {
        "quantity": "connection polarity", "point": "device power and signal pin labels",
        "reference": "schematic and device pinout", "tools": ["VISUAL_SETTINGS", "SIMULATION"],
        "how": "With power disconnected, compare positive supply and ground connections with the schematic and pinout. In simulation compare the same ports. Confirm Yes or No only after inspection.",
        "why": "Checks reversed connections without inferring polarity from a zero reading.",
    },
    "LOGIC_LEVEL": {
        "quantity": "digital high-state voltage", "point": "signal pin at the receiving device",
        "reference": "receiver circuit ground", "tools": ["OSCILLOSCOPE", "SIMULATION"],
        "how": "During the intended high state, read the signal high plateau relative to receiver ground with an oscilloscope or simulation probe. Enter volts. A multimeter average of a toggling line is not this measurement.",
        "why": "Checks the voltage seen by the receiver rather than an average bus voltage.",
    },
    "SIGNAL_PRESENT": {
        "quantity": "expected signal activity", "point": "ADC input pin",
        "reference": "documented sensor stimulus and circuit ground", "tools": ["OSCILLOSCOPE", "SIMULATION"],
        "how": "Apply the documented sensor stimulus and observe the ADC input trace relative to ground. Confirm Yes if the expected activity is present; do not assume an unobserved input is zero.",
        "why": "Distinguishes a missing signal path from an ADC interpretation problem.",
    },
    "ADC_READING": {
        "quantity": "raw ADC integer count", "point": "ADC data register or logged raw output",
        "reference": "the same stable sensor input", "tools": ["VISUAL_SETTINGS", "SIMULATION"],
        "how": "Read an unscaled ADC register value or raw-count simulation output at the same stable input. Enter a count, not a converted voltage. Keep the configured resolution and reference available for later checks.",
        "why": "Provides the converter output before software voltage scaling.",
    },
    "PULLUP_PRESENT": {
        "quantity": "external pull-up connection", "point": "SDA and SCL pull-up paths",
        "reference": "bus supply rail and circuit schematic", "tools": ["VISUAL_SETTINGS", "SIMULATION"],
        "how": "With power disconnected, inspect whether both lines have the required pull-up paths to the bus supply in the schematic or simulation. A declared resistor value alone does not prove the connection exists.",
        "why": "I2C line release requires a pull-up path; this does not measure rise time.",
    },
    "SDA_STATE": {
        "quantity": "SDA line state", "point": "SDA at the sensor connector",
        "reference": "circuit ground and a known requested transaction", "tools": ["LOGIC_ANALYZER", "OSCILLOSCOPE", "SIMULATION"],
        "how": "Observe SDA over one requested I2C transaction. Enter Toggling if transitions occur, High if it stays high throughout, or Low if it stays low throughout. A single voltage sample cannot establish Toggling.",
        "why": "Distinguishes activity from a line held at one level.",
    },
    "SCL_STATE": {
        "quantity": "SCL line state", "point": "SCL at the sensor connector",
        "reference": "circuit ground and a known requested transaction", "tools": ["LOGIC_ANALYZER", "OSCILLOSCOPE", "SIMULATION"],
        "how": "Observe SCL over one requested I2C transaction. Enter Toggling if clock transitions occur, High if it stays high throughout, or Low if it stays low throughout. Do not classify an idle bus as an active transaction.",
        "why": "Checks whether the requested bus clock reaches the sensor.",
    },
    "ACK_RECEIVED": {
        "quantity": "target acknowledgement", "point": "SDA on the ninth clock of the addressed byte",
        "reference": "SCL and the requested target address", "tools": ["LOGIC_ANALYZER", "OSCILLOSCOPE", "SIMULATION"],
        "how": "Capture a known address transaction and inspect the acknowledgement bit. Confirm Yes for an ACK from the addressed target, No for a captured NACK. No capture is not a confirmed No.",
        "why": "Distinguishes a target acknowledgement from merely seeing clock activity.",
    },
    "ADDRESS_CORRECT": {
        "quantity": "configured target address", "point": "software address and sensor address pins",
        "reference": "device documentation", "tools": ["VISUAL_SETTINGS", "SIMULATION"],
        "how": "Compare the configured 7-bit target address and address-pin settings with the device documentation. Do not confuse a 7-bit address with the shifted address byte containing the read/write bit.",
        "why": "Checks addressing independently of power and bus continuity.",
    },
    "CONFIGURATION_OK": {
        "quantity": "documented settings comparison", "point": "peripheral settings",
        "reference": "the exercise specification and device documentation", "tools": ["VISUAL_SETTINGS", "SIMULATION"],
        "how": "In stable mode, compare the actual settings with the documented exercise requirements. Do not answer based on the predicted fault. This conclusion-style check will not be used by the experimental raw-evidence ADC mode.",
        "why": "Records an explicit inspected comparison in the retained stable workflow.",
    },
    "COMMUNICATION_SUCCESS": {
        "quantity": "known test-transaction result", "point": "I2C test read/write result",
        "reference": "a documented register transaction and expected response", "tools": ["VISUAL_SETTINGS", "SIMULATION"],
        "how": "Run one documented target-register transaction and inspect its return code and response. Confirm Yes only if it completes as specified; confirm No for an observed failure. Not attempting the transaction is unknown.",
        "why": "Checks actual end-to-end exchange, not only the presence of signals.",
    },
    "TX_SIGNAL_PRESENT": {
        "quantity": "UART TX transitions", "point": "transmitter TX pin",
        "reference": "circuit ground and a known transmitted byte",
        "tools": ["LOGIC_ANALYZER", "OSCILLOSCOPE", "SIMULATION"],
        "how": "Capture the TX pin while transmitting a known byte. Confirm activity only when start and data transitions are observed; an idle-high line alone is not activity.",
        "why": "Separates a silent transmitter from a downstream receive-path failure.",
    },
    "RX_SIGNAL_PRESENT": {
        "quantity": "UART RX transitions", "point": "receiver RX pin",
        "reference": "receiver ground and the same known transmitted byte",
        "tools": ["LOGIC_ANALYZER", "OSCILLOSCOPE", "SIMULATION"],
        "how": "Capture the RX pin during the known transmission. Confirm activity only if a start bit and data transitions reach the receiver.",
        "why": "Distinguishes TX activity from an open or misrouted receive path.",
    },
    "BAUD_RATE_CORRECT": {
        "quantity": "configured baud agreement", "point": "transmitter and receiver UART settings",
        "reference": "the exercise specification for both endpoints",
        "tools": ["VISUAL_SETTINGS", "SIMULATION"],
        "how": "Compare the configured baud, data bits, parity and stop bits on both endpoints with the exercise specification. A settings match is not a measured waveform match.",
        "why": "Finds a configuration mismatch before a higher-effort timing capture.",
    },
    "ACTUAL_BAUD": {
        "quantity": "measured UART bit rate", "point": "transmitter TX pin",
        "reference": "circuit ground and the configured baud rate",
        "tools": ["LOGIC_ANALYZER", "OSCILLOSCOPE", "SIMULATION"],
        "how": "Capture a known UART frame and measure the duration of several bit cells. Derive baud from bit duration; do not infer it from a single edge or the software setting alone.",
        "why": "Separates a physical timing error from a nominal setting discrepancy.",
    },
    "PWM_PRESENT": {
        "quantity": "PWM edge activity", "point": "controller PWM output pin",
        "reference": "controller ground and the active command",
        "tools": ["LOGIC_ANALYZER", "OSCILLOSCOPE", "SIMULATION"],
        "how": "Capture multiple PWM periods while the command is active. Confirm a repeating high-low waveform rather than a static level.",
        "why": "Separates missing drive from a load or motor response problem.",
    },
    "DUTY_CYCLE": {
        "quantity": "observed PWM duty cycle", "point": "controller PWM output pin",
        "reference": "controller ground and the commanded duty cycle",
        "tools": ["LOGIC_ANALYZER", "OSCILLOSCOPE", "SIMULATION"],
        "how": "Measure high time and total period over several cycles, then compute 100 × high time / period. A DC multimeter average is not a duty-cycle measurement.",
        "why": "Tests the actual command-response timing before attributing a motor fault.",
    },
}

TOOL_LABELS = {
    "VISUAL_SETTINGS": "Visual inspection / software settings",
    "MULTIMETER": "Multimeter", "LOGIC_ANALYZER": "Logic analyzer",
    "OSCILLOSCOPE": "Oscilloscope", "SIMULATION": "Simulation results",
}


BUTTON_ACTIVITY_PROTOCOL = {
    "quantity": "input logic transitions during a button press and release",
    "point": "the microcontroller GPIO pin configured as the button input",
    "reference": "circuit ground and a complete press-and-release cycle",
    "tools": ["LOGIC_ANALYZER", "OSCILLOSCOPE", "SIMULATION"],
    "how": "Capture the input while pressing and releasing the button. Check whether the logic state changes with the button. This does not measure the high-state voltage.",
    "why": "Shows whether the button action reaches the input pin before the program interprets it.",
}


def protocol_for(code: str, system_type: str | None = None) -> dict | None:
    if system_type == "DIGITAL_INPUT" and code == "SIGNAL_PRESENT":
        return BUTTON_ACTIVITY_PROTOCOL
    return PROTOCOLS.get(code)


def guidance_for(system_type: str, code: str) -> dict | None:
    if system_type not in {"ANALOG_ADC", "I2C_SENSOR"}:
        return None
    return PROTOCOLS.get(code)


def check_is_executable(code: str, available_tools: list[str] | None,
                        *, system_type: str | None = None) -> bool:
    if code in DISABLED_LEARNER_CHECKS:
        return False
    if available_tools is None:
        return True
    protocol = protocol_for(code, system_type)
    # Unspecified physical protocols remain simulation-only, not guessed safe.
    required = protocol["tools"] if protocol is not None else ["SIMULATION"]
    return bool(set(required) & set(available_tools))


def learner_question(system_type: str, code: str) -> str:
    if system_type == "DIGITAL_INPUT" and code == "SIGNAL_PRESENT":
        return "Does the input change logic state when you press and release the button?"
    definition = load_config("measurements")[code]
    return definition["question"]
