/* Register/pin configs adapted from Velxio commit 25f3251c303e54acbf65b88e56af3052bfc072c3, AGPL-3.0-or-later. See vendor/velxio/LICENSE. */
import {portAConfig,portBConfig,portCConfig,portDConfig,portEConfig,portFConfig,portGConfig,portHConfig,portJConfig,portKConfig,portLConfig,timer0Config,timer1Config,timer2Config,usart0Config,spiConfig,twiConfig,adcConfig,eepromConfig} from '../../tools/programmable_simulator/node_modules/avr8js/dist/cjs/index.js';
const MEGA_PORT_BIT_MAP: Record<string, number[]> = {
  // PA0-PA7 → D22-D29
  PORTA: [22, 23, 24, 25, 26, 27, 28, 29],
  // PB0=D53(SS), PB1=D52(SCK), PB2=D51(MOSI), PB3=D50(MISO), PB4-PB7=D10-D13
  PORTB: [53, 52, 51, 50, 10, 11, 12, 13],
  // PC0-PC7 → D37, D36, D35, D34, D33, D32, D31, D30  (reversed)
  PORTC: [37, 36, 35, 34, 33, 32, 31, 30],
  // PD0=D21(SCL), PD1=D20(SDA), PD2=D19(RX1), PD3=D18(TX1), PD7=D38
  PORTD: [21, 20, 19, 18, -1, -1, -1, 38],
  // PE0=D0(RX0), PE1=D1(TX0), PE3=D5, PE4=D2, PE5=D3
  PORTE: [0, 1, -1, 5, 2, 3, -1, -1],
  // PF0-PF7 → A0-A7 (pin numbers 54-61)
  PORTF: [54, 55, 56, 57, 58, 59, 60, 61],
  // PG0=D41, PG1=D40, PG2=D39, PG5=D4
  PORTG: [41, 40, 39, -1, -1, 4, -1, -1],
  // PH0=D17(RX2), PH1=D16(TX2), PH3=D6, PH4=D7, PH5=D8, PH6=D9
  PORTH: [17, 16, -1, 6, 7, 8, 9, -1],
  // PJ0=D15(RX3), PJ1=D14(TX3)
  PORTJ: [15, 14, -1, -1, -1, -1, -1, -1],
  // PK0-PK7 → A8-A15 (pin numbers 62-69)
  PORTK: [62, 63, 64, 65, 66, 67, 68, 69],
  // PL0=D49, PL1=D48, PL2=D47, PL3=D46, PL4=D45, PL5=D44, PL6=D43, PL7=D42
  PORTL: [49, 48, 47, 46, 45, 44, 43, 42],
};
const megaExtInt = (n: number): AVRExternalInterrupt => ({
  EICR: n < 4 ? 0x69 : 0x6a,
  EIMSK: 0x3d,
  EIFR: 0x3c,
  index: n,
  iscOffset: (n % 4) * 2,
  interrupt: 2 + 2 * n,
});
const megaPinChange = (n: number, mask: number, offset: number): AVRPinChangeInterrupt => ({
  PCIE: n,
  PCICR: 0x68,
  PCIFR: 0x3b,
  PCMSK: 0x6b + n,
  pinChangeInterrupt: 18 + 2 * n,
  mask,
  offset,
});
const megaPortRegs = (c: AVRPortConfig): Pick<AVRPortConfig, 'PIN' | 'DDR' | 'PORT'> => ({
  PIN: c.PIN,
  DDR: c.DDR,
  PORT: c.PORT,
});
const MEGA_PORT_CONFIGS: Array<{ name: string; config: AVRPortConfig }> = [
  { name: 'PORTA', config: portAConfig },
  {
    name: 'PORTB',
    config: {
      ...megaPortRegs(portBConfig),
      pinChange: megaPinChange(0, 0xff, 0),
      externalInterrupts: [],
    },
  },
  { name: 'PORTC', config: { ...megaPortRegs(portCConfig), externalInterrupts: [] } },
  {
    name: 'PORTD',
    config: {
      ...megaPortRegs(portDConfig),
      externalInterrupts: [megaExtInt(0), megaExtInt(1), megaExtInt(2), megaExtInt(3)],
    },
  },
  {
    name: 'PORTE',
    config: {
      ...megaPortRegs(portEConfig),
      pinChange: megaPinChange(1, 0x01, 0),
      externalInterrupts: [
        null,
        null,
        null,
        null,
        megaExtInt(4),
        megaExtInt(5),
        megaExtInt(6),
        megaExtInt(7),
      ],
    },
  },
  { name: 'PORTF', config: portFConfig },
  { name: 'PORTG', config: portGConfig },
  { name: 'PORTH', config: portHConfig },
  {
    name: 'PORTJ',
    config: {
      ...megaPortRegs(portJConfig),
      pinChange: megaPinChange(1, 0x7f, 1),
      externalInterrupts: [],
    },
  },
  {
    name: 'PORTK',
    config: {
      ...megaPortRegs(portKConfig),
      pinChange: megaPinChange(2, 0xff, 0),
      externalInterrupts: [],
    },
  },
  { name: 'PORTL', config: portLConfig },
];
const MEGA_TIMER0_PINS = {
  compPortA: portBConfig.PORT,
  compPinA: 7,
  compPortB: portGConfig.PORT,
  compPinB: 5,
  externalClockPort: portDConfig.PORT,
  externalClockPin: 7, // T0 → PD7
} as const;
const MEGA_TIMER1_PINS = {
  compPortA: portBConfig.PORT,
  compPinA: 5,
  compPortB: portBConfig.PORT,
  compPinB: 6,
  compPortC: portBConfig.PORT,
  compPinC: 7,
  externalClockPort: portDConfig.PORT,
  externalClockPin: 6, // T1 → PD6
} as const;
const MEGA_TIMER2_PINS = {
  compPortA: portBConfig.PORT,
  compPinA: 4,
  compPortB: portHConfig.PORT,
  compPinB: 6,
  // Timer2 has no T2 input on the Mega — it clocks off TOSC1/TOSC2.
  externalClockPort: 0,
  externalClockPin: 0,
} as const;
const MEGA_TIMER1_CHANNEL_C = {
  OCRC: 0x8c,
  compCInterrupt: 0x26, // _VECTOR(19) TIMER1_COMPC
  OCFC: 0b1000,
  OCIEC: 0b1000,
} as const;
const megaTimer3Config: AVRTimerConfig = {
  ...timer1Config,
  captureInterrupt: 0x3e, // _VECTOR(31)
  compAInterrupt: 0x40, // _VECTOR(32)
  compBInterrupt: 0x42, // _VECTOR(33)
  compCInterrupt: 0x44, // _VECTOR(34)
  ovfInterrupt: 0x46, // _VECTOR(35)
  TIFR: 0x38,
  TIMSK: 0x71,
  TCCRA: 0x90,
  TCCRB: 0x91,
  TCCRC: 0x92,
  TCNT: 0x94,
  ICR: 0x96,
  OCRA: 0x98,
  OCRB: 0x9a,
  OCRC: 0x9c,
  OCFC: 0b1000,
  OCIEC: 0b1000,
  compPortA: portEConfig.PORT,
  compPinA: 3,
  compPortB: portEConfig.PORT,
  compPinB: 4,
  compPortC: portEConfig.PORT,
  compPinC: 5,
  externalClockPort: portEConfig.PORT,
  externalClockPin: 6, // T3 → PE6
};
const megaTimer4Config: AVRTimerConfig = {
  ...timer1Config,
  captureInterrupt: 0x52, // _VECTOR(41)
  compAInterrupt: 0x54, // _VECTOR(42)
  compBInterrupt: 0x56, // _VECTOR(43)
  compCInterrupt: 0x58, // _VECTOR(44)
  ovfInterrupt: 0x5a, // _VECTOR(45)
  TIFR: 0x39,
  TIMSK: 0x72,
  TCCRA: 0xa0,
  TCCRB: 0xa1,
  TCCRC: 0xa2,
  TCNT: 0xa4,
  ICR: 0xa6,
  OCRA: 0xa8,
  OCRB: 0xaa,
  OCRC: 0xac,
  OCFC: 0b1000,
  OCIEC: 0b1000,
  compPortA: portHConfig.PORT,
  compPinA: 3,
  compPortB: portHConfig.PORT,
  compPinB: 4,
  compPortC: portHConfig.PORT,
  compPinC: 5,
  externalClockPort: portHConfig.PORT,
  externalClockPin: 7, // T4 → PH7
};
const megaTimer5Config: AVRTimerConfig = {
  ...timer1Config,
  captureInterrupt: 0x5c, // _VECTOR(46)
  compAInterrupt: 0x5e, // _VECTOR(47)
  compBInterrupt: 0x60, // _VECTOR(48)
  compCInterrupt: 0x62, // _VECTOR(49)
  ovfInterrupt: 0x64, // _VECTOR(50)
  TIFR: 0x3a,
  TIMSK: 0x73,
  // Timer5 lives in extended I/O (0x120+) — reachable via cpu.data / write
  // hooks exactly like the low registers, just not via IN/OUT.
  TCCRA: 0x120,
  TCCRB: 0x121,
  TCCRC: 0x122,
  TCNT: 0x124,
  ICR: 0x126,
  OCRA: 0x128,
  OCRB: 0x12a,
  OCRC: 0x12c,
  OCFC: 0b1000,
  OCIEC: 0b1000,
  compPortA: portLConfig.PORT,
  compPinA: 3,
  compPortB: portLConfig.PORT,
  compPinB: 4,
  compPortC: portLConfig.PORT,
  compPinC: 5,
  externalClockPort: portLConfig.PORT,
  externalClockPin: 2, // T5 → PL2
};
const MEGA_USART1: USARTConfig = {
  rxCompleteInterrupt: 0x48,
  dataRegisterEmptyInterrupt: 0x4a,
  txCompleteInterrupt: 0x4c,
  UCSRA: 0xc8,
  UCSRB: 0xc9,
  UCSRC: 0xca,
  UBRRL: 0xcc,
  UBRRH: 0xcd,
  UDR: 0xce,
};
const MEGA_USART2: USARTConfig = {
  rxCompleteInterrupt: 0x66,
  dataRegisterEmptyInterrupt: 0x68,
  txCompleteInterrupt: 0x6a,
  UCSRA: 0xd0,
  UCSRB: 0xd1,
  UCSRC: 0xd2,
  UBRRL: 0xd4,
  UBRRH: 0xd5,
  UDR: 0xd6,
};
const MEGA_USART3: USARTConfig = {
  rxCompleteInterrupt: 0x6c,
  dataRegisterEmptyInterrupt: 0x6e,
  txCompleteInterrupt: 0x70,
  UCSRA: 0x130,
  UCSRB: 0x131,
  UCSRC: 0x132,
  UBRRL: 0x134,
  UBRRH: 0x135,
  UDR: 0x136,
};
const ATMEGA2560_PERIPHERALS: AtmegaPeripheralConfigs = {
  // The compare-output pads and the third channel of Timer1 are the Mega's,
  // not the 328P's: without them a sketch that sets OCR1A drives no pin (#356).
  timer0: {
    ...timer0Config,
    compAInterrupt: 0x2a,
    compBInterrupt: 0x2c,
    ovfInterrupt: 0x2e,
    ...MEGA_TIMER0_PINS,
  },
  timer1: {
    ...timer1Config,
    captureInterrupt: 0x20,
    compAInterrupt: 0x22,
    compBInterrupt: 0x24,
    ovfInterrupt: 0x28,
    ...MEGA_TIMER1_CHANNEL_C,
    ...MEGA_TIMER1_PINS,
  },
  timer2: {
    ...timer2Config,
    compAInterrupt: 0x1a,
    compBInterrupt: 0x1c,
    ovfInterrupt: 0x1e,
    ...MEGA_TIMER2_PINS,
  },
  usarts: [
    // PE1 TXD0 / PE0 RXD0 (1 / 0), PD3 TXD1 / PD2 RXD1 (18 / 19),
    // PH1 TXD2 / PH0 RXD2 (16 / 17), PJ1 TXD3 / PJ0 RXD3 (14 / 15).
    {
      config: {
        ...usart0Config,
        rxCompleteInterrupt: 0x32,
        dataRegisterEmptyInterrupt: 0x34,
        txCompleteInterrupt: 0x36,
      },
      txPin: 1,
      rxPin: 0,
    },
    { config: MEGA_USART1, txPin: 18, rxPin: 19 },
    { config: MEGA_USART2, txPin: 16, rxPin: 17 },
    { config: MEGA_USART3, txPin: 14, rxPin: 15 },
  ],
  spi: { ...spiConfig, spiInterrupt: 0x30 },
  twi: { ...twiConfig, twiInterrupt: 0x4e },
  adc: { ...adcConfig, adcInterrupt: 0x3a },
  eeprom: { ...eepromConfig, eepromReadyInterrupt: 0x3c },
};
export {MEGA_PORT_BIT_MAP,MEGA_PORT_CONFIGS,ATMEGA2560_PERIPHERALS,megaTimer3Config,megaTimer4Config,megaTimer5Config};
