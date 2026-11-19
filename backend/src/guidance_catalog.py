"""Presentation metadata for observable checks. No model or scoring logic lives here."""

from .config import load_config


# A step is an action. Keep observation, reference, and interpretation separate.
DETAILS = {
    "SUPPLY_VOLTAGE": ("Measure Device Supply Voltage", ["Power the low-voltage circuit.", "Place the DC probe on the device supply pin.", "Read the voltage relative to circuit ground."], "Enter the measured supply voltage"),
    "OUTPUT_VOLTAGE": ("Measure Sensor Output Voltage", ["Apply a stable input to the sensor.", "Probe the sensor output before the ADC signal wire.", "Read DC voltage relative to circuit ground."], "Enter the sensor output voltage"),
    "CURRENT": ("Read Device Supply Current", ["Open the device supply-current simulation probe.", "Read the current entering the device supply branch.", "Enter the result in amperes."], "Enter the simulated supply current"),
    "CONTINUITY": ("Check Signal-Path Continuity", ["Disconnect all power.", "Identify both ends of the intended wire on the schematic.", "Check that exact path with continuity mode or in simulation.", "Choose Yes only if the intended path is continuous."], "Is the intended path continuous?"),
    "POLARITY_OK": ("Check Connection Polarity", ["Disconnect power.", "Compare supply and ground connections with the schematic.", "Check device pin labels against the pinout.", "Choose Yes only if the inspected connections match."], "Does the inspected polarity match?"),
    "LOGIC_LEVEL": ("Measure Logic-High Voltage", ["Capture the intended high state.", "Probe the receiving device's signal pin.", "Read the high plateau relative to receiver ground."], "Enter the logic-high voltage"),
    "SIGNAL_PRESENT": ("Check ADC Input Activity", ["Apply the documented sensor stimulus.", "Observe the ADC input relative to circuit ground.", "Choose Yes only if the expected signal is visible."], "Is the expected signal present?"),
    "ADC_READING": ("Read Raw ADC Count", ["Hold the sensor input stable.", "Read the unscaled ADC data register or raw simulation output.", "Enter the integer count, not a converted voltage."], "Enter the raw ADC count"),
    "PULLUP_PRESENT": ("Inspect I2C Pull-Ups", ["Disconnect power.", "Inspect the SDA pull-up path to the bus supply.", "Inspect the SCL pull-up path to the bus supply.", "Choose Yes only if both paths exist."], "Are both required pull-ups connected?"),
    "SDA_STATE": ("Observe SDA Line State", ["Capture one requested I2C transaction.", "Observe SDA throughout the transaction.", "Select Toggling, High, or Low from the trace."], "Select the observed SDA state"),
    "SCL_STATE": ("Observe SCL Line State", ["Capture one requested I2C transaction.", "Observe SCL throughout the transaction.", "Select Toggling, High, or Low from the trace."], "Select the observed SCL state"),
    "ACK_RECEIVED": ("Check Target ACK", ["Capture a known address transaction.", "Inspect SDA on the ninth SCL clock.", "Choose Yes for an observed ACK.", "Choose No for a captured NACK."], "Was an ACK observed?"),
    "ADDRESS_CORRECT": ("Check I2C Target Address", ["Read the configured 7-bit address.", "Check the target's address-pin settings.", "Compare both with the device documentation."], "Does the configured address match?"),
    "CONFIGURATION_OK": ("Inspect Peripheral Configuration", ["Open the actual peripheral settings.", "Compare each setting with the exercise specification.", "Choose Yes only when the inspected settings match."], "Do the inspected settings match?"),
    "COMMUNICATION_SUCCESS": ("Run a Known I2C Transaction", ["Run a documented register transaction.", "Inspect the return code and response.", "Choose Yes only when the exchange completes as specified."], "Did the test transaction succeed?"),
    "ADC_INPUT_VOLTAGE": ("Measure ADC Input Voltage", ["Hold the sensor input stable.", "Probe the ADC input pin.", "Read DC voltage relative to the same circuit ground."], "Enter the ADC input voltage"),
    "ADC_REFERENCE": ("Measure ADC Reference Voltage", ["Probe the actual ADC reference pin or simulation output.", "Read voltage relative to circuit ground.", "Enter the measured value, not an assumed nominal value."], "Enter the actual reference voltage"),
    "ADC_REFERENCE_TARGET": ("Read Required ADC Reference", ["Open the exercise specification.", "Find the required ADC reference voltage.", "Enter that documented value."], "Enter the required reference voltage"),
    "ADC_RESOLUTION_BITS": ("Read Configured ADC Resolution", ["Open the peripheral configuration or simulation parameter.", "Find the configured ADC resolution.", "Enter the bit count."], "Enter the configured resolution"),
    "ADC_INTENDED_BITS": ("Read Required ADC Resolution", ["Open the exercise specification.", "Find the required ADC resolution.", "Enter the documented bit count."], "Enter the required resolution"),
    "ADC_NOISE_RMS_MV": ("Measure ADC Input RMS Noise", ["Capture a stable 20 ms signal window.", "Use a sampling rate of 50 kHz.", "Calculate the sample mean.", "Subtract the mean from each sample.", "Calculate the RMS of the remaining AC component.", "Convert volts to mV if needed."], "Enter the measured RMS noise"),
    "TX_SIGNAL_PRESENT": ("Check UART TX Activity", ["Capture a requested UART transmission.", "Observe TX at the transmitter.", "Choose Yes only if transmission activity is visible."], "Is TX activity present?"),
    "RX_SIGNAL_PRESENT": ("Check UART RX Activity", ["Capture a requested UART transmission.", "Observe RX at the receiver.", "Choose Yes only if transmission activity reaches RX."], "Is RX activity present?"),
    "BAUD_RATE_CORRECT": ("Compare UART Baud Rates", ["Read the baud-rate setting at both UART ends.", "Compare the two settings.", "Choose Yes only if they match."], "Do both UART ends use the same baud rate?"),
    "ACTUAL_BAUD": ("Read Configured UART Baud Rate", ["Open the transmitting device's UART settings.", "Read the configured baud rate.", "Enter the numeric setting."], "Enter the configured baud rate"),
    "EXPECTED_BAUD": ("Read Required UART Baud Rate", ["Open the exercise or device specification.", "Find the required baud rate.", "Enter that numeric value."], "Enter the required baud rate"),
    "PWM_PRESENT": ("Check PWM Activity", ["Run the requested motor command.", "Observe the PWM output trace.", "Choose Yes only if pulses are visible."], "Are PWM pulses present?"),
    "DUTY_CYCLE": ("Measure PWM Duty Cycle", ["Capture several complete PWM periods.", "Measure pulse on-time and period.", "Read the duty cycle as a percentage."], "Enter the measured duty cycle"),
    "EXPECTED_DUTY_CYCLE": ("Read Required PWM Duty Cycle", ["Open the exercise specification.", "Find the required duty cycle.", "Enter it as a percentage."], "Enter the required duty cycle"),
}

DETAIL_OVERRIDES = {
    "ADC_NOISE_RMS_MV": {
        "quantity": "ADC input AC RMS noise", "measurement_point": "ADC input pin",
        "reference_point": "Circuit ground",
        "why": "Checks whether excessive input noise may affect ADC conversion.",
        "formula_latex": [
            r"\bar{v}=\frac{1}{N}\sum_{i=1}^{N}v_i",
            r"V_{\mathrm{RMS}}=\sqrt{\frac{1}{N}\sum_{i=1}^{N}(v_i-\bar{v})^2}",
            r"V_{\mathrm{RMS,mV}}=1000V_{\mathrm{RMS}}",
        ],
        "formula_caption": "Mean, AC RMS, and millivolt conversion",
        "formula_plain": ["v_mean = sum(v_i) / N", "V_RMS = sqrt(sum((v_i - v_mean)^2) / N)", "V_RMS,mV = 1000 * V_RMS"],
        "formula_note": "Use RMS noise, not peak-to-peak voltage.",
        "input_hint": "Enter a nonnegative mV RMS value from the stable sample window.",
    },
    "ADC_READING": {"quantity": "Raw ADC integer count", "measurement_point": "ADC data register or logged raw output", "reference_point": "The same stable sensor input", "input_hint": "Enter a count, not a converted voltage or calculated expected count."},
    "ADC_INPUT_VOLTAGE": {"quantity": "ADC input DC voltage", "measurement_point": "ADC input pin", "reference_point": "Circuit ground", "why": "Separates the ADC input from the upstream sensor output."},
    "ADC_REFERENCE": {"quantity": "Actual ADC reference voltage", "measurement_point": "ADC reference pin", "reference_point": "Circuit ground", "why": "Checks the voltage used to scale raw ADC counts."},
    "ADC_REFERENCE_TARGET": {"quantity": "Required ADC reference voltage", "measurement_point": "Exercise specification", "reference_point": "Documented ADC design", "why": "Provides the specified value for comparison with the actual reference."},
    "ADC_RESOLUTION_BITS": {"quantity": "Configured ADC resolution", "measurement_point": "Peripheral configuration", "reference_point": "Actual ADC setting", "why": "Determines the number of possible raw ADC counts."},
    "ADC_INTENDED_BITS": {"quantity": "Required ADC resolution", "measurement_point": "Exercise specification", "reference_point": "Documented ADC design", "why": "Provides the bit count required for the exercise."},
    "ACK_RECEIVED": {"quantity": "Target acknowledgement", "measurement_point": "SDA on the ninth SCL clock", "reference_point": "The addressed target transaction", "why": "Shows whether the addressed target responded.", "input_hint": "No capture means I Don't Know, not No."},
    "SDA_STATE": {"input_hint": "A single voltage sample cannot establish Toggling."},
    "SCL_STATE": {"input_hint": "Do not classify an idle bus as an active transaction."},
    "TX_SIGNAL_PRESENT": {"measurement_point": "UART TX pin", "reference_point": "Circuit ground during a requested transmission"},
    "RX_SIGNAL_PRESENT": {"measurement_point": "UART RX pin", "reference_point": "Circuit ground during a requested transmission"},
    "ACTUAL_BAUD": {"measurement_point": "Transmitter UART settings", "reference_point": "Configured baud-rate field"},
    "EXPECTED_BAUD": {"measurement_point": "Exercise specification", "reference_point": "Required baud-rate field"},
    "BAUD_RATE_CORRECT": {"measurement_point": "Both UART configuration panels", "reference_point": "Matching baud-rate values"},
    "PWM_PRESENT": {"measurement_point": "PWM output pin", "reference_point": "Circuit ground during the motor command"},
    "DUTY_CYCLE": {"measurement_point": "PWM output trace", "reference_point": "One complete PWM period"},
    "EXPECTED_DUTY_CYCLE": {"measurement_point": "Exercise specification", "reference_point": "Required PWM duty cycle"},
}


def structured_guidance(system_type: str, code: str, available_tools: list[str] | None = None) -> dict:
    """Return optional UI fields without changing check selection or observations."""
    from .measurement_guidance import SAFETY_NOTE, TOOL_LABELS, learner_question, protocol_for
    from .system_registry import get_measurement

    definition = get_measurement(code)
    protocol = protocol_for(code, system_type)
    title, steps, input_prompt = DETAILS.get(code, (definition["question"].rstrip("?."), [definition["question"]], definition["question"].rstrip("?.")))
    tool_codes = (protocol["tools"] if protocol else definition.get("required_tools") or ["SIMULATION"])
    if available_tools is not None:
        tool_codes = [tool for tool in tool_codes if tool in available_tools]
    guidance = {
        "title": title,
        "summary": definition["question"].rstrip("?"),
        "quantity": protocol["quantity"] if protocol else title.replace("Measure ", "").replace("Read ", "").replace("Check ", ""),
        "measurement_point": protocol["point"] if protocol else None,
        "reference_point": protocol["reference"] if protocol else None,
        "recommended_tools": [TOOL_LABELS[tool] for tool in tool_codes],
        "why": protocol["why"] if protocol else None,
        "steps": steps,
        "formula_latex": None,
        "formula_plain": None,
        "formula_caption": None,
        "formula_note": None,
        "safety_note": SAFETY_NOTE,
        "input_prompt": input_prompt,
        "input_hint": "Choose Yes for an observed result and No for an observed absence." if definition["input_type"] == "boolean" else ("Select the state shown by the trace." if definition["input_type"] == "choice" else "Enter the observed value in the unit shown."),
    }
    guidance.update(DETAIL_OVERRIDES.get(code, {}))
    # Shared observable names must not impose an ADC procedure on another system.
    if system_type == "DIGITAL_INPUT" and code == "SIGNAL_PRESENT":
        guidance.update(
            title="Check whether the button toggles the input",
            summary=learner_question(system_type, code).rstrip("?"),
            steps=["Probe the configured button input and connect the instrument reference to circuit ground, or select the matching simulation probe.",
                   "Start a capture, press and release the button, then compare the idle and pressed logic states.",
                   "Choose Yes if the expected change and return are visible. Choose No if a valid capture shows the input does not respond as expected."],
            input_prompt=learner_question(system_type, code),
            input_hint="Choose Don't know for a missing or unreadable capture. A logic trace does not measure the high-state voltage.",
        )
    elif system_type != "ANALOG_ADC" and code in {"OUTPUT_VOLTAGE", "SIGNAL_PRESENT"}:
        points = {
            "DIGITAL_INPUT": ("Digital Input", "digital input pin", "Press and release the button or change the documented input state."),
            "LED_GPIO": ("GPIO Output", "GPIO output pin", "Command the documented GPIO high and low states."),
            "PWM_MOTOR_SERVO": ("PWM Output", "PWM output pin", "Run the documented PWM command at the specified duty cycle."),
            "UART_DEVICE": ("UART Output", "UART transmitter TX pin", "Transmit the documented UART test message."),
            "I2C_SENSOR": ("I2C Signal", "documented SDA or SCL test point", "Request the documented I2C transaction."),
        }
        label, point, stimulus = points.get(system_type, ("Signal", "documented signal test point", "Apply the documented input or command."))
        guidance.update(measurement_point=point, reference_point="Circuit ground", quantity=label + (" voltage" if code == "OUTPUT_VOLTAGE" else " activity"))
        guidance['why'] = 'Checks the observed signal at the specified pin independently of the software command.'
        if code == "OUTPUT_VOLTAGE":
            guidance.update(title="Measure " + label + " Voltage", steps=[stimulus, "Probe the " + point + " relative to circuit ground.", "Use the exercise's specified voltage statistic (DC, high plateau or period average).", "Enter the observed value in volts."], input_prompt="Enter the observed output voltage")
        else:
            guidance.update(title="Check " + label + " Activity", steps=[stimulus, "Capture the " + point + " relative to circuit ground.", "Choose Yes only if the expected activity is visible.", "Choose Don't know if no capture is available."], input_prompt="Is the expected signal activity present?")
    if system_type == "DIGITAL_INPUT" and code == "PULLUP_PRESENT":
        guidance.update(title="Inspect Digital Input Pull Resistor", quantity="Specified input pull-up path", measurement_point="Digital input pin and its configured pull-up path", reference_point="Input supply and circuit schematic", steps=["Disconnect power.", "Inspect the specified external pull-up or internal pull configuration for this input.", "Choose Yes only if the required pull-up path is configured and connected."], input_prompt="Is the required input pull-up present?")
    if system_type == "UART_DEVICE" and code == "COMMUNICATION_SUCCESS":
        guidance.update(
            title="Run a Known UART Exchange",
            quantity="Documented UART exchange result",
            measurement_point="UART receiver or application response log",
            reference_point="Documented command and expected response",
            steps=["Transmit the documented UART test command.",
                   "Inspect the received bytes and application response.",
                   "Choose Yes only when the exchange completes as specified."],
            input_prompt="Did the UART test exchange succeed?",
        )
    return guidance
