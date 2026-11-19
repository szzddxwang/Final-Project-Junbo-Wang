/*! Adapted from Velxio, commit 25f3251c303e54acbf65b88e56af3052bfc072c3. AGPL-3.0-or-later. See LICENSE and PROVENANCE.json. */
export class SSD1306Core {
  /**
   * 1024-byte GDDRAM: 8 pages × 128 columns. Each byte = 8 vertical pixels.
   *
   * Byte `page * 128 + x` holds the column the glass shows at x. The RAM has
   * no read path here, so which way its columns are numbered is ours to pick;
   * this way round a driver that sends 0xA1 (Adafruit_SSD1306, U8g2 R0,
   * MicroPython ssd1306.py, SSD1306Ascii) addresses byte `page * 128 + col`,
   * as the buffer always was.
   */
  readonly buffer = new Uint8Array(128 * 8);

  // GDDRAM cursor
  private col = 0;
  private page = 0;
  private colStart = 0;
  private colEnd = 127;
  private pageStart = 0;
  private pageEnd = 7;
  // 0=horizontal, 1=vertical, 2=page. SSD1306 power-on default is PAGE
  // addressing (datasheet 10b). Adafruit_SSD1306 overrides it to horizontal
  // via 0x20,0x00; page-mode drivers (Tiny4kOLED, U8g2 page buffer) rely on
  // this default and never send 0x20 — so the default MUST be 2 or their
  // setCursor (0xB0-0xB7 + 0x00-0x1F) renders garbled.
  private memMode = 2;

  // What the glass shows (datasheet 10.1.6 to 10.1.15), at reset values.
  private displayOn = false;
  private contrast = 0x7f;
  private inverse = false;
  private entireOn = false;
  private segRemap = false;
  private comRemap = false;
  private displayOffset = 0;
  private startLine = 0;

  // Multi-byte command accumulation
  private cmdBuf: number[] = [];
  private cmdWant = 0;

  /** How many parameter bytes does this command require? */
  static cmdParams(cmd: number): number {
    if (
      cmd === 0x20 ||
      cmd === 0x81 ||
      cmd === 0x8d ||
      cmd === 0xa8 ||
      cmd === 0xd3 ||
      cmd === 0xd5 ||
      cmd === 0xd8 ||
      cmd === 0xd9 ||
      cmd === 0xda ||
      cmd === 0xdb
    )
      return 1;
    if (cmd === 0x21 || cmd === 0x22 || cmd === 0xa3) return 2;
    // Scroll setup (datasheet 10.2.1, 10.2.2). Their parameters carry values
    // such as 0x40 and 0x00-0x0F that would otherwise be taken for the start
    // line and column commands.
    if (cmd === 0x29 || cmd === 0x2a) return 5;
    if (cmd === 0x26 || cmd === 0x27) return 6;
    return 0;
  }

  /** Write a data byte to GDDRAM and advance cursor. */
  writeData(value: number): void {
    // Segment re-map acts on the write, not on the display: "Data already
    // stored in GDDRAM will have no changes" (datasheet 10.1.8). With 0xA1,
    // column address c drives SEG127-c; the glass is wired so that this is
    // the column at x = c (the orientation every driver's init selects).
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
  resetCommand(): void {
    this.cmdBuf = [];
    this.cmdWant = 0;
  }

  /** Feed a command or parameter byte. Multi-byte commands are accumulated. */
  writeCommand(value: number): void {
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

  private applyCmd(): void {
    const [cmd, p1, p2] = this.cmdBuf;
    switch (cmd) {
      case 0x20:
        this.memMode = p1 & 0x03;
        break;
      case 0x21:
        this.colStart = p1 & 0x7f;
        this.colEnd = p2 & 0x7f;
        this.col = this.colStart;
        break;
      case 0x22:
        this.pageStart = p1 & 0x07;
        this.pageEnd = p2 & 0x07;
        this.page = this.pageStart;
        break;
      case 0x81:
        this.contrast = p1;
        break;
      case 0xd3:
        this.displayOffset = p1 & 0x3f;
        break;
      case 0xa0:
      case 0xa1:
        this.segRemap = cmd === 0xa1;
        break;
      case 0xa4:
      case 0xa5:
        this.entireOn = cmd === 0xa5;
        break;
      case 0xa6:
      case 0xa7:
        this.inverse = cmd === 0xa7;
        break;
      case 0xae:
      case 0xaf:
        this.displayOn = cmd === 0xaf;
        break;
      case 0xc0:
      case 0xc8:
        this.comRemap = cmd === 0xc8;
        break;
      default:
        // Page-addressing-mode cursor commands (single-byte). Used by
        // Tiny4kOLED / U8g2 page buffer / classic SSD1306 drivers whose
        // setCursor() does NOT use the 0x21/0x22 column/page-range commands.
        if (cmd >= 0xb0 && cmd <= 0xb7) {
          // set page start address (B0..B7 → page 0..7)
          this.page = cmd & 0x07;
        } else if (cmd <= 0x0f) {
          // set lower column nibble (0x00..0x0F)
          this.col = (this.col & 0xf0) | (cmd & 0x0f);
        } else if (cmd >= 0x10 && cmd <= 0x1f) {
          // set higher column nibble (0x10..0x1F)
          this.col = (this.col & 0x0f) | ((cmd & 0x0f) << 4);
        } else if (cmd >= 0x40 && cmd <= 0x7f) {
          this.startLine = cmd & 0x3f;
        }
        break;
    }
  }

  private advanceCursor(): void {
    if (this.memMode === 0) {
      // horizontal addressing
      this.col++;
      if (this.col > this.colEnd) {
        this.col = this.colStart;
        this.page++;
        if (this.page > this.pageEnd) this.page = this.pageStart;
      }
    } else if (this.memMode === 1) {
      // vertical addressing
      this.page++;
      if (this.page > this.pageEnd) {
        this.page = this.pageStart;
        this.col++;
        if (this.col > this.colEnd) this.col = this.colStart;
      }
    } else {
      // page addressing
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
  private brightness(): number {
    const DIMMEST = 0.3;
    if (this.contrast >= 0x7f) return 1;
    return DIMMEST + ((1 - DIMMEST) * this.contrast) / 0x7f;
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
    for (let y=0;y<64;y++) {
      const com=63-y, row=(((this.comRemap?63-com:com)+this.displayOffset)+this.startLine)&63;
      for(let x=0;x<128;x++) {
        const lit=this.displayOn&&(this.entireOn||(((this.buffer[(row>>3)*128+x]>>(row&7))&1)^(this.inverse?1:0))===1);
        if(lit)visible[(y>>3)*128+x]|=1<<(y&7);
      }
    }
    return {type:'ssd1306',width:128,height:64,display_on:this.displayOn,brightness:this.brightness(),buffer:Array.from(visible)};
  }
}

export const BMP280_RULES = {
  /**
   * Every register powers on at 0x00 but the id and the msb of the two data
   * words, which hold 0x80000 until a measurement replaces it (4.2, table 18).
   * The calibration block 0x88-0x9F is the part's own.
   */
  power_on: { 0xd0: 0x58, 0xf7: 0x80, 0xfa: 0x80 },
  /**
   * The registers a write changes: ctrl_meas and config. The calibration, the
   * id, status and the data registers are read-only, and the rest of the map
   * is reserved (4.2, the "Type" row of table 18).
   */
  writable: [0xf4, 0xf5],
  /**
   * The reset register (4.3.2) keeps nothing and reads 0x00. This one word
   * runs the power-on reset, any other does nothing.
   */
  reset: { 0xe0: 0xb6 },
  /**
   * Bits the chip sets by itself in status (4.3.3). `measuring` is 1 while a
   * conversion runs: the first read after one starts finds it, the next does
   * not. im_update, bit 0, is up for the NVM copy that is over before a
   * master can ask.
   */
  status: { 0xf3: 0x08 },
  /** mode[1:0] of ctrl_meas (3.6, table 10): 01 and 10 are both forced mode. */
  mode: { register: 0xf4, mask: 0x03, sleep: 0, normal: 3 },
  /** press and temp, 20 bits each, msb first (4.3.6, 4.3.7). */
  sample: [0xf7, 0xfc],
} as const;

const BMP_RESET = 0xe0;
const BMP_RESET_WORD = BMP280_RULES.reset[BMP_RESET];
const BMP_STATUS = 0xf3;
const BMP_MEASURING = BMP280_RULES.status[BMP_STATUS];
const BMP_CTRL_MEAS = BMP280_RULES.mode.register;
const BMP_MODE = BMP280_RULES.mode.mask;
const BMP_SLEEP = BMP280_RULES.mode.sleep;
const BMP_NORMAL = BMP280_RULES.mode.normal;
const [BMP_SAMPLE_FIRST, BMP_SAMPLE_LAST] = BMP280_RULES.sample;
const BMP_WRITABLE = new Uint8Array(256);
for (const reg of BMP280_RULES.writable) BMP_WRITABLE[reg] = 1;

/**
 * Virtual BMP280 barometric pressure / temperature sensor, modelled where a
 * driver can tell the difference from the chip.
 *
 * Supports I2C addresses 0x76 (SDO=0) or 0x77 (SDO=1).
 *
 * Register map (subset):
 *   0x88–0x9F  Calibration data (trimming parameters)
 *   0xD0       chip_id  = 0x58  (BMP280 production; BME280 = 0x60)
 *   0xE0       reset: 0xB6 runs the power-on reset, reads 0x00
 *   0xF3       status: measuring (bit 3)
 *   0xF4       ctrl_meas (mode, osrs_t, osrs_p) — writable
 *   0xF5       config    — writable
 *   0xF7–0xF9  press_msb / press_lsb / press_xlsb  (20-bit ADC)
 *   0xFA–0xFC  temp_msb  / temp_lsb  / temp_xlsb   (20-bit ADC)
 *
 *  - It powers on in sleep mode and measures nothing there (3.6.1): until
 *    the sketch selects a mode, the data registers hold their reset value
 *    0x80000.
 *  - Forced mode is one measurement, and the chip is back in sleep mode when
 *    it is done (3.6.2). A conversion takes no time here, so the mode bits
 *    read 00 at once and the measurement is what the panel said at the write.
 *    esp-idf-lib and M5Unit-ENV wait for those bits, BMP280_DEV starts the
 *    next conversion only from sleep mode.
 *  - In normal mode the chip measures by itself (3.6.3): a read finds what
 *    the panel says when it begins, and the whole burst is answered from that
 *    one measurement (3.10), so a slider moving while it is read cannot mix
 *    two of them.
 *  - `measuring` reads 1 once after a mode write that starts a conversion.
 *    SparkFun's and pocketBME280's examples wait for it to rise with no
 *    timeout, Adafruit's takeForcedMeasurement() waits for it to fall.
 *    Without a clock the cycles of normal mode that follow are not seen in
 *    status.
 *  - A write is pairs of register address and register data, and the address
 *    does not count up (5.2.1, figure 7). A read counts up from the last
 *    address written (5.2.2).
 *  - What the panel sets is the world around the chip, not a register: it
 *    survives a soft reset.
 *
 * The calibration parameters are the BMP280 datasheet example values (Section 8.2).
 * They produce T ≈ 25°C, P ≈ 1006 hPa from the corresponding raw ADC values.
 *
 * Setting `temperature` (°C) and `pressure` (hPa) properties recomputes the
 * raw ADC values using a binary search over the Bosch compensation formulas so that
 * Arduino sketches using the Adafruit_BMP280 / Bosch driver get realistic values.
 */
export class VirtualBMP280 {
  public address: number;
  /** The data registers were read before the chip ever measured, for the first time in this run. */
  onAsleepRead: (() => void) | null = null;

  private readonly registers = new Uint8Array(256);
  /** What a measurement taken now puts in the data registers. */
  private readonly live = new Uint8Array(BMP_SAMPLE_LAST - BMP_SAMPLE_FIRST + 1);
  private regPtr = 0;
  /** The next byte written is a register address. */
  private firstByte = true;
  /** A conversion started and status has not been read since. */
  private measuring = false;
  /** The data registers hold a measurement and not their reset value. */
  private measured = false;
  /** No START was heard for the read that comes next: latch on its first byte. */
  private latchDue = true;
  private asleepReadSaid = false;

  // ── BMP280 datasheet Section 8.2 example calibration ───────────────────
  private readonly DIG_T1 = 27504;
  private readonly DIG_T2 = 26435;
  private readonly DIG_T3 = -1000;
  private readonly DIG_P1 = 36477;
  private readonly DIG_P2 = -10685;
  private readonly DIG_P3 = 3024;
  private readonly DIG_P4 = 2855;
  private readonly DIG_P5 = 140;
  private readonly DIG_P6 = -7;
  private readonly DIG_P7 = 15500;
  private readonly DIG_P8 = -14600;
  private readonly DIG_P9 = 6000;

  // Where the sensor panel starts (sensorControlConfig, bmp280).
  private _temperatureC = 24.0;
  private _pressureHPa = 1013.25;

  constructor(address = 0x76) {
    this.address = address;
    this.initCalibration();
    this.powerOn();
    this.updateMeasurements();
  }

  // ── Public configurable properties ──────────────────────────────────────

  get temperatureC(): number {
    return this._temperatureC;
  }
  set temperatureC(v: number) {
    this._temperatureC = v;
    this.updateMeasurements();
  }

  get pressureHPa(): number {
    return this._pressureHPa;
  }
  set pressureHPa(v: number) {
    this._pressureHPa = v;
    this.updateMeasurements();
  }

  // ── I2CDevice interface ─────────────────────────────────────────────────

  start(read: boolean): void {
    if (read) this.latch();
  }

  writeByte(value: number): boolean {
    // For a host that does not say where a read begins: after a write, the
    // next byte read is the first of a new read.
    this.latchDue = true;
    if (this.firstByte) {
      this.regPtr = value & 0xff;
      this.firstByte = false;
      return true;
    }
    // The byte after a register's data is the next register's address. The
    // pointer stays where the pair put it: esp-idf-lib's bmp280_is_measuring
    // sends 0xF3 0xF4 and reads status and ctrl_meas back.
    this.firstByte = true;
    this.writeRegister(this.regPtr, value & 0xff);
    return true;
  }

  readByte(): number {
    if (this.latchDue) this.latch();
    const reg = this.regPtr;
    this.regPtr = (reg + 1) & 0xff;
    if (reg === BMP_STATUS) {
      const status = this.measuring ? BMP_MEASURING : 0;
      this.measuring = false;
      return status;
    }
    if (
      reg >= BMP_SAMPLE_FIRST &&
      reg <= BMP_SAMPLE_LAST &&
      !this.measured &&
      !this.asleepReadSaid
    ) {
      this.asleepReadSaid = true;
      this.onAsleepRead?.();
    }
    return this.registers[reg];
  }

  /** The pointer survives the STOP: Seeed_BMP280 writes it in one transaction and reads in the next. */
  stop(): void {
    this.firstByte = true;
    this.latchDue = true;
  }

  /** A new run reads a chip that still has not measured: its monitor is told as well. */
  boardReset(): void {
    this.asleepReadSaid = false;
  }

  /**
   * The registers as a read would find them now: in normal mode the data
   * registers encoded from the panel's values, and no `measuring`. A host
   * that answers its guest from a copy (the Raspberry Pi relay) mirrors this.
   */
  dumpRegisters(): Uint8Array {
    const out = this.registers.slice();
    if (this.mode === BMP_NORMAL) out.set(this.live, BMP_SAMPLE_FIRST);
    return out;
  }

  private get mode(): number {
    return this.registers[BMP_CTRL_MEAS] & BMP_MODE;
  }

  /** The power-on reset, which the reset word runs too. The calibration is NVM and the panel is not the chip's. */
  private powerOn(): void {
    for (const reg of BMP280_RULES.writable) this.registers[reg] = 0;
    this.registers.fill(0, BMP_SAMPLE_FIRST, BMP_SAMPLE_LAST + 1);
    for (const [reg, value] of Object.entries(BMP280_RULES.power_on)) {
      this.registers[Number(reg)] = value;
    }
    this.measuring = false;
    this.measured = false;
  }

  private writeRegister(reg: number, value: number): void {
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
      // The chip measured until now, so what it holds asleep is this instant.
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

  private measure(): void {
    this.registers.set(this.live, BMP_SAMPLE_FIRST);
    this.measured = true;
  }

  private latch(): void {
    if (this.mode === BMP_NORMAL) this.measure();
    this.latchDue = false;
  }

  // ── Compensation formulas (Bosch 32-bit integer + double precision) ────

  /** Compute t_fine from a 20-bit raw temperature ADC value. */
  private tFine(adcT: number): number {
    const var1 = (((adcT >> 3) - (this.DIG_T1 << 1)) * this.DIG_T2) >> 11;
    const sub = (adcT >> 4) - this.DIG_T1;
    const var2 = (((sub * sub) >> 12) * this.DIG_T3) >> 14;
    return var1 + var2;
  }

  /** Compute temperature in 0.01 °C from a 20-bit raw ADC value. */
  private compensateT(adcT: number): number {
    return (this.tFine(adcT) * 5 + 128) >> 8;
  }

  /**
   * Compute pressure in Pa (double precision) from raw ADC values.
   * Uses the Bosch floating-point compensation formula.
   */
  private compensateP(adcP: number, adcT: number): number {
    const tf = this.tFine(adcT);
    let var1 = tf / 2.0 - 64000.0;
    let var2 = (var1 * var1 * this.DIG_P6) / 32768.0;
    var2 = var2 + var1 * this.DIG_P5 * 2.0;
    var2 = var2 / 4.0 + this.DIG_P4 * 65536.0;
    var1 = ((this.DIG_P3 * var1 * var1) / 524288.0 + this.DIG_P2 * var1) / 524288.0;
    var1 = (1.0 + var1 / 32768.0) * this.DIG_P1;
    if (var1 === 0) return 0;
    let p = 1048576.0 - adcP;
    p = ((p - var2 / 4096.0) * 6250.0) / var1;
    const v1b = (this.DIG_P9 * p * p) / 2147483648.0;
    const v2b = (p * this.DIG_P8) / 32768.0;
    return p + (v1b + v2b + this.DIG_P7) / 16.0;
  }

  /**
   * Binary-search for the 20-bit raw ADC value that produces the target
   * temperature (in 0.01 °C units after integer compensation).
   */
  private findAdcT(targetCentidegrees: number): number {
    let lo = 0,
      hi = (1 << 20) - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.compensateT(mid) < targetCentidegrees) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  /**
   * Binary-search for the 20-bit raw ADC value that produces the target
   * pressure (in Pa). Pressure is monotonically decreasing in adcP.
   */
  private findAdcP(targetPa: number, adcT: number): number {
    let lo = 0,
      hi = (1 << 20) - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.compensateP(mid, adcT) > targetPa) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  /** Encode a 20-bit ADC value into three register bytes (msb, lsb, xlsb). */
  private static encodeAdc20(val: number): [number, number, number] {
    return [(val >> 12) & 0xff, (val >> 4) & 0xff, (val & 0xf) << 4];
  }

  // ── Register initialisation ─────────────────────────────────────────────

  private initCalibration(): void {
    const r = this.registers;
    const wu16 = (a: number, v: number) => {
      r[a] = v & 0xff;
      r[a + 1] = (v >> 8) & 0xff;
    };
    const ws16 = (a: number, v: number) => wu16(a, v & 0xffff);

    wu16(0x88, this.DIG_T1);
    ws16(0x8a, this.DIG_T2);
    ws16(0x8c, this.DIG_T3);
    wu16(0x8e, this.DIG_P1);
    ws16(0x90, this.DIG_P2);
    ws16(0x92, this.DIG_P3);
    ws16(0x94, this.DIG_P4);
    ws16(0x96, this.DIG_P5);
    ws16(0x98, this.DIG_P6);
    ws16(0x9a, this.DIG_P7);
    ws16(0x9c, this.DIG_P8);
    ws16(0x9e, this.DIG_P9);
  }

  /**
   * Recompute the raw ADC values from current temperature / pressure. They
   * reach the data registers with a measurement, not here.
   */
  private updateMeasurements(): void {
    const targetT = Math.round(this._temperatureC * 100);
    const targetP = this._pressureHPa * 100; // hPa → Pa

    const adcT = this.findAdcT(targetT);
    const adcP = this.findAdcP(targetP, adcT);

    this.live.set([...VirtualBMP280.encodeAdc20(adcP), ...VirtualBMP280.encodeAdc20(adcT)]);
  }
}
