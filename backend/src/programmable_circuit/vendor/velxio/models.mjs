var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
/*! Adapted from Velxio, commit 25f3251c303e54acbf65b88e56af3052bfc072c3. AGPL-3.0-or-later. See LICENSE and PROVENANCE.json. */
class SSD1306Core {
  constructor() {
    /**
     * 1024-byte GDDRAM: 8 pages × 128 columns. Each byte = 8 vertical pixels.
     *
     * Byte `page * 128 + x` holds the column the glass shows at x. The RAM has
     * no read path here, so which way its columns are numbered is ours to pick;
     * this way round a driver that sends 0xA1 (Adafruit_SSD1306, U8g2 R0,
     * MicroPython ssd1306.py, SSD1306Ascii) addresses byte `page * 128 + col`,
     * as the buffer always was.
     */
    __publicField(this, "buffer", new Uint8Array(128 * 8));
    // GDDRAM cursor
    __publicField(this, "col", 0);
    __publicField(this, "page", 0);
    __publicField(this, "colStart", 0);
    __publicField(this, "colEnd", 127);
    __publicField(this, "pageStart", 0);
    __publicField(this, "pageEnd", 7);
    // 0=horizontal, 1=vertical, 2=page. SSD1306 power-on default is PAGE
    // addressing (datasheet 10b). Adafruit_SSD1306 overrides it to horizontal
    // via 0x20,0x00; page-mode drivers (Tiny4kOLED, U8g2 page buffer) rely on
    // this default and never send 0x20 — so the default MUST be 2 or their
    // setCursor (0xB0-0xB7 + 0x00-0x1F) renders garbled.
    __publicField(this, "memMode", 2);
    // What the glass shows (datasheet 10.1.6 to 10.1.15), at reset values.
    __publicField(this, "displayOn", false);
    __publicField(this, "contrast", 127);
    __publicField(this, "inverse", false);
    __publicField(this, "entireOn", false);
    __publicField(this, "segRemap", false);
    __publicField(this, "comRemap", false);
    __publicField(this, "displayOffset", 0);
    __publicField(this, "startLine", 0);
    // Multi-byte command accumulation
    __publicField(this, "cmdBuf", []);
    __publicField(this, "cmdWant", 0);
  }
  /** How many parameter bytes does this command require? */
  static cmdParams(cmd) {
    if (cmd === 32 || cmd === 129 || cmd === 141 || cmd === 168 || cmd === 211 || cmd === 213 || cmd === 216 || cmd === 217 || cmd === 218 || cmd === 219)
      return 1;
    if (cmd === 33 || cmd === 34 || cmd === 163) return 2;
    if (cmd === 41 || cmd === 42) return 5;
    if (cmd === 38 || cmd === 39) return 6;
    return 0;
  }
  /** Write a data byte to GDDRAM and advance cursor. */
  writeData(value) {
    if (this.col <= 127) {
      const x = this.segRemap ? this.col : 127 - this.col;
      this.buffer[this.page * 128 + x] = value;
    }
    this.advanceCursor();
  }
  /**
   * Drop a half-received command. The MCU restarting leaves the panel
   * powered, so its GDDRAM and its configuration survive (the glass keeps
   * showing the last frame); only the bytes of a command that will never be
   * completed have to go, or the first byte of the new init would be eaten
   * as their parameter.
   */
  resetCommand() {
    this.cmdBuf = [];
    this.cmdWant = 0;
  }
  /** Feed a command or parameter byte. Multi-byte commands are accumulated. */
  writeCommand(value) {
    if (this.cmdWant > 0) {
      this.cmdBuf.push(value);
      this.cmdWant--;
      if (this.cmdWant === 0) this.applyCmd();
      return;
    }
    this.cmdBuf = [value];
    this.cmdWant = SSD1306Core.cmdParams(value);
    if (this.cmdWant === 0) this.applyCmd();
  }
  applyCmd() {
    const [cmd, p1, p2] = this.cmdBuf;
    switch (cmd) {
      case 32:
        this.memMode = p1 & 3;
        break;
      case 33:
        this.colStart = p1 & 127;
        this.colEnd = p2 & 127;
        this.col = this.colStart;
        break;
      case 34:
        this.pageStart = p1 & 7;
        this.pageEnd = p2 & 7;
        this.page = this.pageStart;
        break;
      case 129:
        this.contrast = p1;
        break;
      case 211:
        this.displayOffset = p1 & 63;
        break;
      case 160:
      case 161:
        this.segRemap = cmd === 161;
        break;
      case 164:
      case 165:
        this.entireOn = cmd === 165;
        break;
      case 166:
      case 167:
        this.inverse = cmd === 167;
        break;
      case 174:
      case 175:
        this.displayOn = cmd === 175;
        break;
      case 192:
      case 200:
        this.comRemap = cmd === 200;
        break;
      default:
        if (cmd >= 176 && cmd <= 183) {
          this.page = cmd & 7;
        } else if (cmd <= 15) {
          this.col = this.col & 240 | cmd & 15;
        } else if (cmd >= 16 && cmd <= 31) {
          this.col = this.col & 15 | (cmd & 15) << 4;
        } else if (cmd >= 64 && cmd <= 127) {
          this.startLine = cmd & 63;
        }
        break;
    }
  }
  advanceCursor() {
    if (this.memMode === 0) {
      this.col++;
      if (this.col > this.colEnd) {
        this.col = this.colStart;
        this.page++;
        if (this.page > this.pageEnd) this.page = this.pageStart;
      }
    } else if (this.memMode === 1) {
      this.page++;
      if (this.page > this.pageEnd) {
        this.page = this.pageStart;
        this.col++;
        if (this.col > this.colEnd) this.col = this.colStart;
      }
    } else {
      this.col++;
      if (this.col > this.colEnd) this.col = this.colStart;
    }
  }
  /**
   * How bright a lit pixel is, 0..1, for the contrast register.
   *
   * The datasheet gives the contrast as 256 steps of segment current
   * (10.1.7), not as a luminance, and on a module the steps above the reset
   * value are hard to tell apart: Adafruit_SSD1306 dim() jumps straight to 0
   * because "the range of contrast is too small to be really useful". So the
   * reset value and every value above it paint at full brightness, the one the
   * panel always had, and that covers what every driver's init sends
   * (Adafruit 0x8F/0x9F/0xCF, U8g2 and ThingPulse 0xCF, SSD1306Ascii 0x7F,
   * MicroPython 0xFF). Below it the panel dims towards 0x00, which on the
   * bench is still readable.
   */
  brightness() {
    const DIMMEST = 0.3;
    if (this.contrast >= 127) return 1;
    return DIMMEST + (1 - DIMMEST) * this.contrast / 127;
  }
  /**
   * Push what the glass shows to the wokwi-ssd1306 web component.
   *
   * wokwi-ssd1306 API:
   *   - `element.imageData` — a 128×64 ImageData (RGBA, 4 bytes/pixel)
   *   - `element.redraw()` — flushes imageData to the internal canvas
   *
   * Glass row y is driven by COM(63-y), so the scan direction every driver
   * selects (0xC8) shows RAM row y there. A COM pin shows display row
   * (i + offset) mod 64 when scanning up and (63 - i + offset) mod 64 when
   * scanning down, and display row r reads RAM row (r + start line) mod 64
   * (datasheet Tables 10-1 and 10-2). Display off leaves the segments at VSS:
   * a dark panel over an intact RAM (10.1.12). Entire display on lights every
   * pixel whatever the RAM holds (10.1.9); inverse lights the zeros (10.1.10).
   */
  snapshot() {
    const visible = new Uint8Array(1024);
    for (let y = 0; y < 64; y++) {
      const com = 63 - y, row = (this.comRemap ? 63 - com : com) + this.displayOffset + this.startLine & 63;
      for (let x = 0; x < 128; x++) {
        const lit = this.displayOn && (this.entireOn || (this.buffer[(row >> 3) * 128 + x] >> (row & 7) & 1 ^ (this.inverse ? 1 : 0)) === 1);
        if (lit) visible[(y >> 3) * 128 + x] |= 1 << (y & 7);
      }
    }
    return { type: "ssd1306", width: 128, height: 64, display_on: this.displayOn, brightness: this.brightness(), buffer: Array.from(visible) };
  }
}
const BMP280_RULES = {
  /**
   * Every register powers on at 0x00 but the id and the msb of the two data
   * words, which hold 0x80000 until a measurement replaces it (4.2, table 18).
   * The calibration block 0x88-0x9F is the part's own.
   */
  power_on: { 208: 88, 247: 128, 250: 128 },
  /**
   * The registers a write changes: ctrl_meas and config. The calibration, the
   * id, status and the data registers are read-only, and the rest of the map
   * is reserved (4.2, the "Type" row of table 18).
   */
  writable: [244, 245],
  /**
   * The reset register (4.3.2) keeps nothing and reads 0x00. This one word
   * runs the power-on reset, any other does nothing.
   */
  reset: { 224: 182 },
  /**
   * Bits the chip sets by itself in status (4.3.3). `measuring` is 1 while a
   * conversion runs: the first read after one starts finds it, the next does
   * not. im_update, bit 0, is up for the NVM copy that is over before a
   * master can ask.
   */
  status: { 243: 8 },
  /** mode[1:0] of ctrl_meas (3.6, table 10): 01 and 10 are both forced mode. */
  mode: { register: 244, mask: 3, sleep: 0, normal: 3 },
  /** press and temp, 20 bits each, msb first (4.3.6, 4.3.7). */
  sample: [247, 252]
};
const BMP_RESET = 224;
const BMP_RESET_WORD = BMP280_RULES.reset[BMP_RESET];
const BMP_STATUS = 243;
const BMP_MEASURING = BMP280_RULES.status[BMP_STATUS];
const BMP_CTRL_MEAS = BMP280_RULES.mode.register;
const BMP_MODE = BMP280_RULES.mode.mask;
const BMP_SLEEP = BMP280_RULES.mode.sleep;
const BMP_NORMAL = BMP280_RULES.mode.normal;
const [BMP_SAMPLE_FIRST, BMP_SAMPLE_LAST] = BMP280_RULES.sample;
const BMP_WRITABLE = new Uint8Array(256);
for (const reg of BMP280_RULES.writable) BMP_WRITABLE[reg] = 1;
class VirtualBMP280 {
  constructor(address = 118) {
    __publicField(this, "address");
    /** The data registers were read before the chip ever measured, for the first time in this run. */
    __publicField(this, "onAsleepRead", null);
    __publicField(this, "registers", new Uint8Array(256));
    /** What a measurement taken now puts in the data registers. */
    __publicField(this, "live", new Uint8Array(BMP_SAMPLE_LAST - BMP_SAMPLE_FIRST + 1));
    __publicField(this, "regPtr", 0);
    /** The next byte written is a register address. */
    __publicField(this, "firstByte", true);
    /** A conversion started and status has not been read since. */
    __publicField(this, "measuring", false);
    /** The data registers hold a measurement and not their reset value. */
    __publicField(this, "measured", false);
    /** No START was heard for the read that comes next: latch on its first byte. */
    __publicField(this, "latchDue", true);
    __publicField(this, "asleepReadSaid", false);
    // ── BMP280 datasheet Section 8.2 example calibration ───────────────────
    __publicField(this, "DIG_T1", 27504);
    __publicField(this, "DIG_T2", 26435);
    __publicField(this, "DIG_T3", -1e3);
    __publicField(this, "DIG_P1", 36477);
    __publicField(this, "DIG_P2", -10685);
    __publicField(this, "DIG_P3", 3024);
    __publicField(this, "DIG_P4", 2855);
    __publicField(this, "DIG_P5", 140);
    __publicField(this, "DIG_P6", -7);
    __publicField(this, "DIG_P7", 15500);
    __publicField(this, "DIG_P8", -14600);
    __publicField(this, "DIG_P9", 6e3);
    // Where the sensor panel starts (sensorControlConfig, bmp280).
    __publicField(this, "_temperatureC", 24);
    __publicField(this, "_pressureHPa", 1013.25);
    this.address = address;
    this.initCalibration();
    this.powerOn();
    this.updateMeasurements();
  }
  // ── Public configurable properties ──────────────────────────────────────
  get temperatureC() {
    return this._temperatureC;
  }
  set temperatureC(v) {
    this._temperatureC = v;
    this.updateMeasurements();
  }
  get pressureHPa() {
    return this._pressureHPa;
  }
  set pressureHPa(v) {
    this._pressureHPa = v;
    this.updateMeasurements();
  }
  // ── I2CDevice interface ─────────────────────────────────────────────────
  start(read) {
    if (read) this.latch();
  }
  writeByte(value) {
    this.latchDue = true;
    if (this.firstByte) {
      this.regPtr = value & 255;
      this.firstByte = false;
      return true;
    }
    this.firstByte = true;
    this.writeRegister(this.regPtr, value & 255);
    return true;
  }
  readByte() {
    if (this.latchDue) this.latch();
    const reg = this.regPtr;
    this.regPtr = reg + 1 & 255;
    if (reg === BMP_STATUS) {
      const status = this.measuring ? BMP_MEASURING : 0;
      this.measuring = false;
      return status;
    }
    if (reg >= BMP_SAMPLE_FIRST && reg <= BMP_SAMPLE_LAST && !this.measured && !this.asleepReadSaid) {
      this.asleepReadSaid = true;
      this.onAsleepRead?.();
    }
    return this.registers[reg];
  }
  /** The pointer survives the STOP: Seeed_BMP280 writes it in one transaction and reads in the next. */
  stop() {
    this.firstByte = true;
    this.latchDue = true;
  }
  /** A new run reads a chip that still has not measured: its monitor is told as well. */
  boardReset() {
    this.asleepReadSaid = false;
  }
  /**
   * The registers as a read would find them now: in normal mode the data
   * registers encoded from the panel's values, and no `measuring`. A host
   * that answers its guest from a copy (the Raspberry Pi relay) mirrors this.
   */
  dumpRegisters() {
    const out = this.registers.slice();
    if (this.mode === BMP_NORMAL) out.set(this.live, BMP_SAMPLE_FIRST);
    return out;
  }
  get mode() {
    return this.registers[BMP_CTRL_MEAS] & BMP_MODE;
  }
  /** The power-on reset, which the reset word runs too. The calibration is NVM and the panel is not the chip's. */
  powerOn() {
    for (const reg of BMP280_RULES.writable) this.registers[reg] = 0;
    this.registers.fill(0, BMP_SAMPLE_FIRST, BMP_SAMPLE_LAST + 1);
    for (const [reg, value] of Object.entries(BMP280_RULES.power_on)) {
      this.registers[Number(reg)] = value;
    }
    this.measuring = false;
    this.measured = false;
  }
  writeRegister(reg, value) {
    if (reg === BMP_RESET) {
      if (value === BMP_RESET_WORD) this.powerOn();
      return;
    }
    if (!BMP_WRITABLE[reg]) return;
    if (reg !== BMP_CTRL_MEAS) {
      this.registers[reg] = value;
      return;
    }
    const mode = value & BMP_MODE;
    if (mode === BMP_SLEEP) {
      if (this.mode === BMP_NORMAL) this.measure();
      this.measuring = false;
      this.registers[reg] = value;
      return;
    }
    this.measuring = true;
    if (mode === BMP_NORMAL) {
      this.registers[reg] = value;
      return;
    }
    this.measure();
    this.registers[reg] = value & ~BMP_MODE;
  }
  measure() {
    this.registers.set(this.live, BMP_SAMPLE_FIRST);
    this.measured = true;
  }
  latch() {
    if (this.mode === BMP_NORMAL) this.measure();
    this.latchDue = false;
  }
  // ── Compensation formulas (Bosch 32-bit integer + double precision) ────
  /** Compute t_fine from a 20-bit raw temperature ADC value. */
  tFine(adcT) {
    const var1 = ((adcT >> 3) - (this.DIG_T1 << 1)) * this.DIG_T2 >> 11;
    const sub = (adcT >> 4) - this.DIG_T1;
    const var2 = (sub * sub >> 12) * this.DIG_T3 >> 14;
    return var1 + var2;
  }
  /** Compute temperature in 0.01 °C from a 20-bit raw ADC value. */
  compensateT(adcT) {
    return this.tFine(adcT) * 5 + 128 >> 8;
  }
  /**
   * Compute pressure in Pa (double precision) from raw ADC values.
   * Uses the Bosch floating-point compensation formula.
   */
  compensateP(adcP, adcT) {
    const tf = this.tFine(adcT);
    let var1 = tf / 2 - 64e3;
    let var2 = var1 * var1 * this.DIG_P6 / 32768;
    var2 = var2 + var1 * this.DIG_P5 * 2;
    var2 = var2 / 4 + this.DIG_P4 * 65536;
    var1 = (this.DIG_P3 * var1 * var1 / 524288 + this.DIG_P2 * var1) / 524288;
    var1 = (1 + var1 / 32768) * this.DIG_P1;
    if (var1 === 0) return 0;
    let p = 1048576 - adcP;
    p = (p - var2 / 4096) * 6250 / var1;
    const v1b = this.DIG_P9 * p * p / 2147483648;
    const v2b = p * this.DIG_P8 / 32768;
    return p + (v1b + v2b + this.DIG_P7) / 16;
  }
  /**
   * Binary-search for the 20-bit raw ADC value that produces the target
   * temperature (in 0.01 °C units after integer compensation).
   */
  findAdcT(targetCentidegrees) {
    let lo = 0, hi = (1 << 20) - 1;
    while (lo < hi) {
      const mid = lo + hi >> 1;
      if (this.compensateT(mid) < targetCentidegrees) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }
  /**
   * Binary-search for the 20-bit raw ADC value that produces the target
   * pressure (in Pa). Pressure is monotonically decreasing in adcP.
   */
  findAdcP(targetPa, adcT) {
    let lo = 0, hi = (1 << 20) - 1;
    while (lo < hi) {
      const mid = lo + hi >> 1;
      if (this.compensateP(mid, adcT) > targetPa) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }
  /** Encode a 20-bit ADC value into three register bytes (msb, lsb, xlsb). */
  static encodeAdc20(val) {
    return [val >> 12 & 255, val >> 4 & 255, (val & 15) << 4];
  }
  // ── Register initialisation ─────────────────────────────────────────────
  initCalibration() {
    const r = this.registers;
    const wu16 = (a, v) => {
      r[a] = v & 255;
      r[a + 1] = v >> 8 & 255;
    };
    const ws16 = (a, v) => wu16(a, v & 65535);
    wu16(136, this.DIG_T1);
    ws16(138, this.DIG_T2);
    ws16(140, this.DIG_T3);
    wu16(142, this.DIG_P1);
    ws16(144, this.DIG_P2);
    ws16(146, this.DIG_P3);
    ws16(148, this.DIG_P4);
    ws16(150, this.DIG_P5);
    ws16(152, this.DIG_P6);
    ws16(154, this.DIG_P7);
    ws16(156, this.DIG_P8);
    ws16(158, this.DIG_P9);
  }
  /**
   * Recompute the raw ADC values from current temperature / pressure. They
   * reach the data registers with a measurement, not here.
   */
  updateMeasurements() {
    const targetT = Math.round(this._temperatureC * 100);
    const targetP = this._pressureHPa * 100;
    const adcT = this.findAdcT(targetT);
    const adcP = this.findAdcP(targetP, adcT);
    this.live.set([...VirtualBMP280.encodeAdc20(adcP), ...VirtualBMP280.encodeAdc20(adcT)]);
  }
}
export {
  BMP280_RULES,
  SSD1306Core,
  VirtualBMP280
};
