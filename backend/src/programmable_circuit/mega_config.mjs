/*! Velxio register configuration adaptation; AGPL-3.0-or-later. See vendor/velxio/LICENSE. */
import { portAConfig, portBConfig, portCConfig, portDConfig, portEConfig, portFConfig, portGConfig, portHConfig, portJConfig, portKConfig, portLConfig, timer0Config, timer1Config, timer2Config, usart0Config, spiConfig, twiConfig, adcConfig, eepromConfig } from "../../tools/programmable_simulator/node_modules/avr8js/dist/cjs/index.js";
const MEGA_PORT_BIT_MAP = {
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
  PORTL: [49, 48, 47, 46, 45, 44, 43, 42]
};
const megaExtInt = (n) => ({
  EICR: n < 4 ? 105 : 106,
  EIMSK: 61,
  EIFR: 60,
  index: n,
  iscOffset: n % 4 * 2,
  interrupt: 2 + 2 * n
});
const megaPinChange = (n, mask, offset) => ({
  PCIE: n,
  PCICR: 104,
  PCIFR: 59,
  PCMSK: 107 + n,
  pinChangeInterrupt: 18 + 2 * n,
  mask,
  offset
});
const megaPortRegs = (c) => ({
  PIN: c.PIN,
  DDR: c.DDR,
  PORT: c.PORT
});
const MEGA_PORT_CONFIGS = [
  { name: "PORTA", config: portAConfig },
  {
    name: "PORTB",
    config: {
      ...megaPortRegs(portBConfig),
      pinChange: megaPinChange(0, 255, 0),
      externalInterrupts: []
    }
  },
  { name: "PORTC", config: { ...megaPortRegs(portCConfig), externalInterrupts: [] } },
  {
    name: "PORTD",
    config: {
      ...megaPortRegs(portDConfig),
      externalInterrupts: [megaExtInt(0), megaExtInt(1), megaExtInt(2), megaExtInt(3)]
    }
  },
  {
    name: "PORTE",
    config: {
      ...megaPortRegs(portEConfig),
      pinChange: megaPinChange(1, 1, 0),
      externalInterrupts: [
        null,
        null,
        null,
        null,
        megaExtInt(4),
        megaExtInt(5),
        megaExtInt(6),
        megaExtInt(7)
      ]
    }
  },
  { name: "PORTF", config: portFConfig },
  { name: "PORTG", config: portGConfig },
  { name: "PORTH", config: portHConfig },
  {
    name: "PORTJ",
    config: {
      ...megaPortRegs(portJConfig),
      pinChange: megaPinChange(1, 127, 1),
      externalInterrupts: []
    }
  },
  {
    name: "PORTK",
    config: {
      ...megaPortRegs(portKConfig),
      pinChange: megaPinChange(2, 255, 0),
      externalInterrupts: []
    }
  },
  { name: "PORTL", config: portLConfig }
];
const MEGA_TIMER0_PINS = {
  compPortA: portBConfig.PORT,
  compPinA: 7,
  compPortB: portGConfig.PORT,
  compPinB: 5,
  externalClockPort: portDConfig.PORT,
  externalClockPin: 7
  // T0 → PD7
};
const MEGA_TIMER1_PINS = {
  compPortA: portBConfig.PORT,
  compPinA: 5,
  compPortB: portBConfig.PORT,
  compPinB: 6,
  compPortC: portBConfig.PORT,
  compPinC: 7,
  externalClockPort: portDConfig.PORT,
  externalClockPin: 6
  // T1 → PD6
};
const MEGA_TIMER2_PINS = {
  compPortA: portBConfig.PORT,
  compPinA: 4,
  compPortB: portHConfig.PORT,
  compPinB: 6,
  // Timer2 has no T2 input on the Mega — it clocks off TOSC1/TOSC2.
  externalClockPort: 0,
  externalClockPin: 0
};
const MEGA_TIMER1_CHANNEL_C = {
  OCRC: 140,
  compCInterrupt: 38,
  // _VECTOR(19) TIMER1_COMPC
  OCFC: 8,
  OCIEC: 8
};
const megaTimer3Config = {
  ...timer1Config,
  captureInterrupt: 62,
  // _VECTOR(31)
  compAInterrupt: 64,
  // _VECTOR(32)
  compBInterrupt: 66,
  // _VECTOR(33)
  compCInterrupt: 68,
  // _VECTOR(34)
  ovfInterrupt: 70,
  // _VECTOR(35)
  TIFR: 56,
  TIMSK: 113,
  TCCRA: 144,
  TCCRB: 145,
  TCCRC: 146,
  TCNT: 148,
  ICR: 150,
  OCRA: 152,
  OCRB: 154,
  OCRC: 156,
  OCFC: 8,
  OCIEC: 8,
  compPortA: portEConfig.PORT,
  compPinA: 3,
  compPortB: portEConfig.PORT,
  compPinB: 4,
  compPortC: portEConfig.PORT,
  compPinC: 5,
  externalClockPort: portEConfig.PORT,
  externalClockPin: 6
  // T3 → PE6
};
const megaTimer4Config = {
  ...timer1Config,
  captureInterrupt: 82,
  // _VECTOR(41)
  compAInterrupt: 84,
  // _VECTOR(42)
  compBInterrupt: 86,
  // _VECTOR(43)
  compCInterrupt: 88,
  // _VECTOR(44)
  ovfInterrupt: 90,
  // _VECTOR(45)
  TIFR: 57,
  TIMSK: 114,
  TCCRA: 160,
  TCCRB: 161,
  TCCRC: 162,
  TCNT: 164,
  ICR: 166,
  OCRA: 168,
  OCRB: 170,
  OCRC: 172,
  OCFC: 8,
  OCIEC: 8,
  compPortA: portHConfig.PORT,
  compPinA: 3,
  compPortB: portHConfig.PORT,
  compPinB: 4,
  compPortC: portHConfig.PORT,
  compPinC: 5,
  externalClockPort: portHConfig.PORT,
  externalClockPin: 7
  // T4 → PH7
};
const megaTimer5Config = {
  ...timer1Config,
  captureInterrupt: 92,
  // _VECTOR(46)
  compAInterrupt: 94,
  // _VECTOR(47)
  compBInterrupt: 96,
  // _VECTOR(48)
  compCInterrupt: 98,
  // _VECTOR(49)
  ovfInterrupt: 100,
  // _VECTOR(50)
  TIFR: 58,
  TIMSK: 115,
  // Timer5 lives in extended I/O (0x120+) — reachable via cpu.data / write
  // hooks exactly like the low registers, just not via IN/OUT.
  TCCRA: 288,
  TCCRB: 289,
  TCCRC: 290,
  TCNT: 292,
  ICR: 294,
  OCRA: 296,
  OCRB: 298,
  OCRC: 300,
  OCFC: 8,
  OCIEC: 8,
  compPortA: portLConfig.PORT,
  compPinA: 3,
  compPortB: portLConfig.PORT,
  compPinB: 4,
  compPortC: portLConfig.PORT,
  compPinC: 5,
  externalClockPort: portLConfig.PORT,
  externalClockPin: 2
  // T5 → PL2
};
const MEGA_USART1 = {
  rxCompleteInterrupt: 72,
  dataRegisterEmptyInterrupt: 74,
  txCompleteInterrupt: 76,
  UCSRA: 200,
  UCSRB: 201,
  UCSRC: 202,
  UBRRL: 204,
  UBRRH: 205,
  UDR: 206
};
const MEGA_USART2 = {
  rxCompleteInterrupt: 102,
  dataRegisterEmptyInterrupt: 104,
  txCompleteInterrupt: 106,
  UCSRA: 208,
  UCSRB: 209,
  UCSRC: 210,
  UBRRL: 212,
  UBRRH: 213,
  UDR: 214
};
const MEGA_USART3 = {
  rxCompleteInterrupt: 108,
  dataRegisterEmptyInterrupt: 110,
  txCompleteInterrupt: 112,
  UCSRA: 304,
  UCSRB: 305,
  UCSRC: 306,
  UBRRL: 308,
  UBRRH: 309,
  UDR: 310
};
const ATMEGA2560_PERIPHERALS = {
  // The compare-output pads and the third channel of Timer1 are the Mega's,
  // not the 328P's: without them a sketch that sets OCR1A drives no pin (#356).
  timer0: {
    ...timer0Config,
    compAInterrupt: 42,
    compBInterrupt: 44,
    ovfInterrupt: 46,
    ...MEGA_TIMER0_PINS
  },
  timer1: {
    ...timer1Config,
    captureInterrupt: 32,
    compAInterrupt: 34,
    compBInterrupt: 36,
    ovfInterrupt: 40,
    ...MEGA_TIMER1_CHANNEL_C,
    ...MEGA_TIMER1_PINS
  },
  timer2: {
    ...timer2Config,
    compAInterrupt: 26,
    compBInterrupt: 28,
    ovfInterrupt: 30,
    ...MEGA_TIMER2_PINS
  },
  usarts: [
    // PE1 TXD0 / PE0 RXD0 (1 / 0), PD3 TXD1 / PD2 RXD1 (18 / 19),
    // PH1 TXD2 / PH0 RXD2 (16 / 17), PJ1 TXD3 / PJ0 RXD3 (14 / 15).
    {
      config: {
        ...usart0Config,
        rxCompleteInterrupt: 50,
        dataRegisterEmptyInterrupt: 52,
        txCompleteInterrupt: 54
      },
      txPin: 1,
      rxPin: 0
    },
    { config: MEGA_USART1, txPin: 18, rxPin: 19 },
    { config: MEGA_USART2, txPin: 16, rxPin: 17 },
    { config: MEGA_USART3, txPin: 14, rxPin: 15 }
  ],
  spi: { ...spiConfig, spiInterrupt: 48 },
  twi: { ...twiConfig, twiInterrupt: 78 },
  adc: { ...adcConfig, adcInterrupt: 58 },
  eeprom: { ...eepromConfig, eepromReadyInterrupt: 60 }
};
export {
  ATMEGA2560_PERIPHERALS,
  MEGA_PORT_BIT_MAP,
  MEGA_PORT_CONFIGS,
  megaTimer3Config,
  megaTimer4Config,
  megaTimer5Config
};
