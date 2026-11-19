(() => {
  var __create = Object.create;
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __getProtoOf = Object.getPrototypeOf;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __commonJS = (cb, mod) => function __require() {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
    // If the importer is in node compatibility mode or this is not an ESM
    // file that has been converted to a CommonJS file using a Babel-
    // compatible transform (i.e. "__esModule" has not been set), then set
    // "default" to the CommonJS "module.exports" for node compatibility.
    isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
    mod
  ));

  // tools/programmable_simulator/node_modules/avr8js/dist/cjs/cpu/interrupt.js
  var require_interrupt = __commonJS({
    "tools/programmable_simulator/node_modules/avr8js/dist/cjs/cpu/interrupt.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", { value: true });
      exports.avrInterrupt = avrInterrupt;
      function avrInterrupt(cpu, addr) {
        const sp = cpu.dataView.getUint16(93, true);
        cpu.data[sp] = cpu.pc & 255;
        cpu.data[sp - 1] = cpu.pc >> 8 & 255;
        if (cpu.pc22Bits) {
          cpu.data[sp - 2] = cpu.pc >> 16 & 255;
        }
        cpu.dataView.setUint16(93, sp - (cpu.pc22Bits ? 3 : 2), true);
        cpu.data[95] &= 127;
        cpu.cycles += 2;
        cpu.pc = addr;
      }
    }
  });

  // tools/programmable_simulator/node_modules/avr8js/dist/cjs/cpu/cpu.js
  var require_cpu = __commonJS({
    "tools/programmable_simulator/node_modules/avr8js/dist/cjs/cpu/cpu.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", { value: true });
      exports.CPU = void 0;
      var interrupt_1 = require_interrupt();
      var registerSpace = 256;
      var MAX_INTERRUPTS = 128;
      var CPU2 = class {
        constructor(progMem, sramBytes = 8192) {
          this.progMem = progMem;
          this.sramBytes = sramBytes;
          this.data = new Uint8Array(this.sramBytes + registerSpace);
          this.data16 = new Uint16Array(this.data.buffer);
          this.dataView = new DataView(this.data.buffer);
          this.progBytes = new Uint8Array(this.progMem.buffer);
          this.readHooks = [];
          this.writeHooks = [];
          this.pendingInterrupts = new Array(MAX_INTERRUPTS);
          this.nextClockEvent = null;
          this.clockEventPool = [];
          this.pc22Bits = this.progBytes.length > 131072;
          this.gpioPorts = /* @__PURE__ */ new Set();
          this.gpioByPort = [];
          this.onWatchdogReset = () => {
          };
          this.pc = 0;
          this.cycles = 0;
          this.nextInterrupt = -1;
          this.maxInterrupt = 0;
          this.reset();
        }
        reset() {
          this.SP = this.data.length - 1;
          this.pc = 0;
          this.pendingInterrupts.fill(null);
          this.nextInterrupt = -1;
          this.nextClockEvent = null;
        }
        readData(addr) {
          if (addr >= 32 && this.readHooks[addr]) {
            return this.readHooks[addr](addr);
          }
          return this.data[addr];
        }
        writeData(addr, value, mask = 255) {
          const hook = this.writeHooks[addr];
          if (hook) {
            if (hook(value, this.data[addr], addr, mask)) {
              return;
            }
          }
          this.data[addr] = value;
        }
        get SP() {
          return this.dataView.getUint16(93, true);
        }
        set SP(value) {
          this.dataView.setUint16(93, value, true);
        }
        get SREG() {
          return this.data[95];
        }
        get interruptsEnabled() {
          return this.SREG & 128 ? true : false;
        }
        setInterruptFlag(interrupt) {
          const { flagRegister, flagMask, enableRegister, enableMask } = interrupt;
          if (interrupt.inverseFlag) {
            this.data[flagRegister] &= ~flagMask;
          } else {
            this.data[flagRegister] |= flagMask;
          }
          if (this.data[enableRegister] & enableMask) {
            this.queueInterrupt(interrupt);
          }
        }
        updateInterruptEnable(interrupt, registerValue) {
          const { enableMask, flagRegister, flagMask, inverseFlag } = interrupt;
          if (registerValue & enableMask) {
            const bitSet = this.data[flagRegister] & flagMask;
            if (inverseFlag ? !bitSet : bitSet) {
              this.queueInterrupt(interrupt);
            }
          } else {
            this.clearInterrupt(interrupt, false);
          }
        }
        queueInterrupt(interrupt) {
          const { address } = interrupt;
          this.pendingInterrupts[address] = interrupt;
          if (this.nextInterrupt === -1 || this.nextInterrupt > address) {
            this.nextInterrupt = address;
          }
          if (address > this.maxInterrupt) {
            this.maxInterrupt = address;
          }
        }
        clearInterrupt({ address, flagRegister, flagMask }, clearFlag = true) {
          if (clearFlag) {
            this.data[flagRegister] &= ~flagMask;
          }
          const { pendingInterrupts, maxInterrupt } = this;
          if (!pendingInterrupts[address]) {
            return;
          }
          pendingInterrupts[address] = null;
          if (this.nextInterrupt === address) {
            this.nextInterrupt = -1;
            for (let i = address + 1; i <= maxInterrupt; i++) {
              if (pendingInterrupts[i]) {
                this.nextInterrupt = i;
                break;
              }
            }
          }
        }
        clearInterruptByFlag(interrupt, registerValue) {
          const { flagRegister, flagMask } = interrupt;
          if (registerValue & flagMask) {
            this.data[flagRegister] &= ~flagMask;
            this.clearInterrupt(interrupt);
          }
        }
        addClockEvent(callback, cycles) {
          const { clockEventPool } = this;
          cycles = this.cycles + Math.max(1, cycles);
          const maybeEntry = clockEventPool.pop();
          const entry = maybeEntry !== null && maybeEntry !== void 0 ? maybeEntry : { cycles, callback, next: null };
          entry.cycles = cycles;
          entry.callback = callback;
          let { nextClockEvent: clockEvent } = this;
          let lastItem = null;
          while (clockEvent && clockEvent.cycles < cycles) {
            lastItem = clockEvent;
            clockEvent = clockEvent.next;
          }
          if (lastItem) {
            lastItem.next = entry;
            entry.next = clockEvent;
          } else {
            this.nextClockEvent = entry;
            entry.next = clockEvent;
          }
          return callback;
        }
        updateClockEvent(callback, cycles) {
          if (this.clearClockEvent(callback)) {
            this.addClockEvent(callback, cycles);
            return true;
          }
          return false;
        }
        clearClockEvent(callback) {
          let { nextClockEvent: clockEvent } = this;
          if (!clockEvent) {
            return false;
          }
          const { clockEventPool } = this;
          let lastItem = null;
          while (clockEvent) {
            if (clockEvent.callback === callback) {
              if (lastItem) {
                lastItem.next = clockEvent.next;
              } else {
                this.nextClockEvent = clockEvent.next;
              }
              if (clockEventPool.length < 10) {
                clockEventPool.push(clockEvent);
              }
              return true;
            }
            lastItem = clockEvent;
            clockEvent = clockEvent.next;
          }
          return false;
        }
        tick() {
          const { nextClockEvent } = this;
          if (nextClockEvent && nextClockEvent.cycles <= this.cycles) {
            nextClockEvent.callback();
            this.nextClockEvent = nextClockEvent.next;
            if (this.clockEventPool.length < 10) {
              this.clockEventPool.push(nextClockEvent);
            }
          }
          const { nextInterrupt } = this;
          if (this.interruptsEnabled && nextInterrupt >= 0) {
            const interrupt = this.pendingInterrupts[nextInterrupt];
            (0, interrupt_1.avrInterrupt)(this, interrupt.address);
            if (!interrupt.constant) {
              this.clearInterrupt(interrupt);
            }
          }
        }
      };
      exports.CPU = CPU2;
    }
  });

  // tools/programmable_simulator/node_modules/avr8js/dist/cjs/cpu/instruction.js
  var require_instruction = __commonJS({
    "tools/programmable_simulator/node_modules/avr8js/dist/cjs/cpu/instruction.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", { value: true });
      exports.avrInstruction = avrInstruction2;
      function isTwoWordInstruction(opcode) {
        return (
          /* LDS */
          (opcode & 65039) === 36864 || /* STS */
          (opcode & 65039) === 37376 || /* CALL */
          (opcode & 65038) === 37902 || /* JMP */
          (opcode & 65038) === 37900
        );
      }
      function avrInstruction2(cpu) {
        const opcode = cpu.progMem[cpu.pc];
        if ((opcode & 64512) === 7168) {
          const d = cpu.data[(opcode & 496) >> 4];
          const r = cpu.data[opcode & 15 | (opcode & 512) >> 5];
          const sum = d + r + (cpu.data[95] & 1);
          const R = sum & 255;
          cpu.data[(opcode & 496) >> 4] = R;
          let sreg = cpu.data[95] & 192;
          sreg |= R ? 0 : 2;
          sreg |= 128 & R ? 4 : 0;
          sreg |= (R ^ r) & (d ^ R) & 128 ? 8 : 0;
          sreg |= sreg >> 2 & 1 ^ sreg >> 3 & 1 ? 16 : 0;
          sreg |= sum & 256 ? 1 : 0;
          sreg |= 1 & (d & r | r & ~R | ~R & d) ? 32 : 0;
          cpu.data[95] = sreg;
        } else if ((opcode & 64512) === 3072) {
          const d = cpu.data[(opcode & 496) >> 4];
          const r = cpu.data[opcode & 15 | (opcode & 512) >> 5];
          const R = d + r & 255;
          cpu.data[(opcode & 496) >> 4] = R;
          let sreg = cpu.data[95] & 192;
          sreg |= R ? 0 : 2;
          sreg |= 128 & R ? 4 : 0;
          sreg |= (R ^ r) & (R ^ d) & 128 ? 8 : 0;
          sreg |= sreg >> 2 & 1 ^ sreg >> 3 & 1 ? 16 : 0;
          sreg |= d + r & 256 ? 1 : 0;
          sreg |= 1 & (d & r | r & ~R | ~R & d) ? 32 : 0;
          cpu.data[95] = sreg;
        } else if ((opcode & 65280) === 38400) {
          const addr = 2 * ((opcode & 48) >> 4) + 24;
          const value = cpu.dataView.getUint16(addr, true);
          const R = value + (opcode & 15 | (opcode & 192) >> 2) & 65535;
          cpu.dataView.setUint16(addr, R, true);
          let sreg = cpu.data[95] & 224;
          sreg |= R ? 0 : 2;
          sreg |= 32768 & R ? 4 : 0;
          sreg |= ~value & R & 32768 ? 8 : 0;
          sreg |= sreg >> 2 & 1 ^ sreg >> 3 & 1 ? 16 : 0;
          sreg |= ~R & value & 32768 ? 1 : 0;
          cpu.data[95] = sreg;
          cpu.cycles++;
        } else if ((opcode & 64512) === 8192) {
          const R = cpu.data[(opcode & 496) >> 4] & cpu.data[opcode & 15 | (opcode & 512) >> 5];
          cpu.data[(opcode & 496) >> 4] = R;
          let sreg = cpu.data[95] & 225;
          sreg |= R ? 0 : 2;
          sreg |= 128 & R ? 4 : 0;
          sreg |= sreg >> 2 & 1 ^ sreg >> 3 & 1 ? 16 : 0;
          cpu.data[95] = sreg;
        } else if ((opcode & 61440) === 28672) {
          const R = cpu.data[((opcode & 240) >> 4) + 16] & (opcode & 15 | (opcode & 3840) >> 4);
          cpu.data[((opcode & 240) >> 4) + 16] = R;
          let sreg = cpu.data[95] & 225;
          sreg |= R ? 0 : 2;
          sreg |= 128 & R ? 4 : 0;
          sreg |= sreg >> 2 & 1 ^ sreg >> 3 & 1 ? 16 : 0;
          cpu.data[95] = sreg;
        } else if ((opcode & 65039) === 37893) {
          const value = cpu.data[(opcode & 496) >> 4];
          const R = value >>> 1 | 128 & value;
          cpu.data[(opcode & 496) >> 4] = R;
          let sreg = cpu.data[95] & 224;
          sreg |= R ? 0 : 2;
          sreg |= 128 & R ? 4 : 0;
          sreg |= value & 1;
          sreg |= sreg >> 2 & 1 ^ sreg & 1 ? 8 : 0;
          sreg |= sreg >> 2 & 1 ^ sreg >> 3 & 1 ? 16 : 0;
          cpu.data[95] = sreg;
        } else if ((opcode & 65423) === 38024) {
          cpu.data[95] &= ~(1 << ((opcode & 112) >> 4));
        } else if ((opcode & 65032) === 63488) {
          const b = opcode & 7;
          const d = (opcode & 496) >> 4;
          cpu.data[d] = ~(1 << b) & cpu.data[d] | (cpu.data[95] >> 6 & 1) << b;
        } else if ((opcode & 64512) === 62464) {
          if (!(cpu.data[95] & 1 << (opcode & 7))) {
            cpu.pc = cpu.pc + (((opcode & 504) >> 3) - (opcode & 512 ? 64 : 0));
            cpu.cycles++;
          }
        } else if ((opcode & 64512) === 61440) {
          if (cpu.data[95] & 1 << (opcode & 7)) {
            cpu.pc = cpu.pc + (((opcode & 504) >> 3) - (opcode & 512 ? 64 : 0));
            cpu.cycles++;
          }
        } else if ((opcode & 65423) === 37896) {
          cpu.data[95] |= 1 << ((opcode & 112) >> 4);
        } else if ((opcode & 65032) === 64e3) {
          const d = cpu.data[(opcode & 496) >> 4];
          const b = opcode & 7;
          cpu.data[95] = cpu.data[95] & 191 | (d >> b & 1 ? 64 : 0);
        } else if ((opcode & 65038) === 37902) {
          const k = cpu.progMem[cpu.pc + 1] | (opcode & 1) << 16 | (opcode & 496) << 13;
          const ret = cpu.pc + 2;
          const sp = cpu.dataView.getUint16(93, true);
          const { pc22Bits } = cpu;
          cpu.data[sp] = 255 & ret;
          cpu.data[sp - 1] = ret >> 8 & 255;
          if (pc22Bits) {
            cpu.data[sp - 2] = ret >> 16 & 255;
          }
          cpu.dataView.setUint16(93, sp - (pc22Bits ? 3 : 2), true);
          cpu.pc = k - 1;
          cpu.cycles += pc22Bits ? 4 : 3;
        } else if ((opcode & 65280) === 38912) {
          const A = opcode & 248;
          const b = opcode & 7;
          const R = cpu.readData((A >> 3) + 32);
          const mask = 1 << b;
          cpu.writeData((A >> 3) + 32, R & ~mask, mask);
        } else if ((opcode & 65039) === 37888) {
          const d = (opcode & 496) >> 4;
          const R = 255 - cpu.data[d];
          cpu.data[d] = R;
          let sreg = cpu.data[95] & 225 | 1;
          sreg |= R ? 0 : 2;
          sreg |= 128 & R ? 4 : 0;
          sreg |= sreg >> 2 & 1 ^ sreg >> 3 & 1 ? 16 : 0;
          cpu.data[95] = sreg;
        } else if ((opcode & 64512) === 5120) {
          const val1 = cpu.data[(opcode & 496) >> 4];
          const val2 = cpu.data[opcode & 15 | (opcode & 512) >> 5];
          const R = val1 - val2;
          let sreg = cpu.data[95] & 192;
          sreg |= R ? 0 : 2;
          sreg |= 128 & R ? 4 : 0;
          sreg |= 0 !== ((val1 ^ val2) & (val1 ^ R) & 128) ? 8 : 0;
          sreg |= sreg >> 2 & 1 ^ sreg >> 3 & 1 ? 16 : 0;
          sreg |= val2 > val1 ? 1 : 0;
          sreg |= 1 & (~val1 & val2 | val2 & R | R & ~val1) ? 32 : 0;
          cpu.data[95] = sreg;
        } else if ((opcode & 64512) === 1024) {
          const arg1 = cpu.data[(opcode & 496) >> 4];
          const arg2 = cpu.data[opcode & 15 | (opcode & 512) >> 5];
          let sreg = cpu.data[95];
          const r = arg1 - arg2 - (sreg & 1);
          sreg = sreg & 192 | (!r && sreg >> 1 & 1 ? 2 : 0) | (arg2 + (sreg & 1) > arg1 ? 1 : 0);
          sreg |= 128 & r ? 4 : 0;
          sreg |= (arg1 ^ arg2) & (arg1 ^ r) & 128 ? 8 : 0;
          sreg |= sreg >> 2 & 1 ^ sreg >> 3 & 1 ? 16 : 0;
          sreg |= 1 & (~arg1 & arg2 | arg2 & r | r & ~arg1) ? 32 : 0;
          cpu.data[95] = sreg;
        } else if ((opcode & 61440) === 12288) {
          const arg1 = cpu.data[((opcode & 240) >> 4) + 16];
          const arg2 = opcode & 15 | (opcode & 3840) >> 4;
          const r = arg1 - arg2;
          let sreg = cpu.data[95] & 192;
          sreg |= r ? 0 : 2;
          sreg |= 128 & r ? 4 : 0;
          sreg |= (arg1 ^ arg2) & (arg1 ^ r) & 128 ? 8 : 0;
          sreg |= sreg >> 2 & 1 ^ sreg >> 3 & 1 ? 16 : 0;
          sreg |= arg2 > arg1 ? 1 : 0;
          sreg |= 1 & (~arg1 & arg2 | arg2 & r | r & ~arg1) ? 32 : 0;
          cpu.data[95] = sreg;
        } else if ((opcode & 64512) === 4096) {
          if (cpu.data[(opcode & 496) >> 4] === cpu.data[opcode & 15 | (opcode & 512) >> 5]) {
            const nextOpcode = cpu.progMem[cpu.pc + 1];
            const skipSize = isTwoWordInstruction(nextOpcode) ? 2 : 1;
            cpu.pc += skipSize;
            cpu.cycles += skipSize;
          }
        } else if ((opcode & 65039) === 37898) {
          const value = cpu.data[(opcode & 496) >> 4];
          const R = value - 1;
          cpu.data[(opcode & 496) >> 4] = R;
          let sreg = cpu.data[95] & 225;
          sreg |= R ? 0 : 2;
          sreg |= 128 & R ? 4 : 0;
          sreg |= 128 === value ? 8 : 0;
          sreg |= sreg >> 2 & 1 ^ sreg >> 3 & 1 ? 16 : 0;
          cpu.data[95] = sreg;
        } else if (opcode === 38169) {
          const retAddr = cpu.pc + 1;
          const sp = cpu.dataView.getUint16(93, true);
          const eind = cpu.data[92];
          cpu.data[sp] = retAddr & 255;
          cpu.data[sp - 1] = retAddr >> 8 & 255;
          cpu.data[sp - 2] = retAddr >> 16 & 255;
          cpu.dataView.setUint16(93, sp - 3, true);
          cpu.pc = (eind << 16 | cpu.dataView.getUint16(30, true)) - 1;
          cpu.cycles += 3;
        } else if (opcode === 37913) {
          const eind = cpu.data[92];
          cpu.pc = (eind << 16 | cpu.dataView.getUint16(30, true)) - 1;
          cpu.cycles++;
        } else if (opcode === 38360) {
          const rampz = cpu.data[91];
          cpu.data[0] = cpu.progBytes[rampz << 16 | cpu.dataView.getUint16(30, true)];
          cpu.cycles += 2;
        } else if ((opcode & 65039) === 36870) {
          const rampz = cpu.data[91];
          cpu.data[(opcode & 496) >> 4] = cpu.progBytes[rampz << 16 | cpu.dataView.getUint16(30, true)];
          cpu.cycles += 2;
        } else if ((opcode & 65039) === 36871) {
          const rampz = cpu.data[91];
          const i = cpu.dataView.getUint16(30, true);
          cpu.data[(opcode & 496) >> 4] = cpu.progBytes[rampz << 16 | i];
          cpu.dataView.setUint16(30, i + 1, true);
          if (i === 65535) {
            cpu.data[91] = (rampz + 1) % (cpu.progBytes.length >> 16);
          }
          cpu.cycles += 2;
        } else if ((opcode & 64512) === 9216) {
          const R = cpu.data[(opcode & 496) >> 4] ^ cpu.data[opcode & 15 | (opcode & 512) >> 5];
          cpu.data[(opcode & 496) >> 4] = R;
          let sreg = cpu.data[95] & 225;
          sreg |= R ? 0 : 2;
          sreg |= 128 & R ? 4 : 0;
          sreg |= sreg >> 2 & 1 ^ sreg >> 3 & 1 ? 16 : 0;
          cpu.data[95] = sreg;
        } else if ((opcode & 65416) === 776) {
          const v1 = cpu.data[((opcode & 112) >> 4) + 16];
          const v2 = cpu.data[(opcode & 7) + 16];
          const R = v1 * v2 << 1;
          cpu.dataView.setUint16(0, R, true);
          cpu.data[95] = cpu.data[95] & 252 | (65535 & R ? 0 : 2) | (v1 * v2 & 32768 ? 1 : 0);
          cpu.cycles++;
        } else if ((opcode & 65416) === 896) {
          const v1 = cpu.dataView.getInt8(((opcode & 112) >> 4) + 16);
          const v2 = cpu.dataView.getInt8((opcode & 7) + 16);
          const R = v1 * v2 << 1;
          cpu.dataView.setInt16(0, R, true);
          cpu.data[95] = cpu.data[95] & 252 | (65535 & R ? 0 : 2) | (v1 * v2 & 32768 ? 1 : 0);
          cpu.cycles++;
        } else if ((opcode & 65416) === 904) {
          const v1 = cpu.dataView.getInt8(((opcode & 112) >> 4) + 16);
          const v2 = cpu.data[(opcode & 7) + 16];
          const R = v1 * v2 << 1;
          cpu.dataView.setInt16(0, R, true);
          cpu.data[95] = cpu.data[95] & 252 | (65535 & R ? 2 : 0) | (v1 * v2 & 32768 ? 1 : 0);
          cpu.cycles++;
        } else if (opcode === 38153) {
          const retAddr = cpu.pc + 1;
          const sp = cpu.dataView.getUint16(93, true);
          const { pc22Bits } = cpu;
          cpu.data[sp] = retAddr & 255;
          cpu.data[sp - 1] = retAddr >> 8 & 255;
          if (pc22Bits) {
            cpu.data[sp - 2] = retAddr >> 16 & 255;
          }
          cpu.dataView.setUint16(93, sp - (pc22Bits ? 3 : 2), true);
          cpu.pc = cpu.dataView.getUint16(30, true) - 1;
          cpu.cycles += pc22Bits ? 3 : 2;
        } else if (opcode === 37897) {
          cpu.pc = cpu.dataView.getUint16(30, true) - 1;
          cpu.cycles++;
        } else if ((opcode & 63488) === 45056) {
          const i = cpu.readData((opcode & 15 | (opcode & 1536) >> 5) + 32);
          cpu.data[(opcode & 496) >> 4] = i;
        } else if ((opcode & 65039) === 37891) {
          const d = cpu.data[(opcode & 496) >> 4];
          const r = d + 1 & 255;
          cpu.data[(opcode & 496) >> 4] = r;
          let sreg = cpu.data[95] & 225;
          sreg |= r ? 0 : 2;
          sreg |= 128 & r ? 4 : 0;
          sreg |= 127 === d ? 8 : 0;
          sreg |= sreg >> 2 & 1 ^ sreg >> 3 & 1 ? 16 : 0;
          cpu.data[95] = sreg;
        } else if ((opcode & 65038) === 37900) {
          cpu.pc = (cpu.progMem[cpu.pc + 1] | (opcode & 1) << 16 | (opcode & 496) << 13) - 1;
          cpu.cycles += 2;
        } else if ((opcode & 65039) === 37382) {
          const r = (opcode & 496) >> 4;
          const clear = cpu.data[r];
          const value = cpu.readData(cpu.dataView.getUint16(30, true));
          cpu.writeData(cpu.dataView.getUint16(30, true), value & 255 - clear);
          cpu.data[r] = value;
        } else if ((opcode & 65039) === 37381) {
          const r = (opcode & 496) >> 4;
          const set = cpu.data[r];
          const value = cpu.readData(cpu.dataView.getUint16(30, true));
          cpu.writeData(cpu.dataView.getUint16(30, true), value | set);
          cpu.data[r] = value;
        } else if ((opcode & 65039) === 37383) {
          const r = cpu.data[(opcode & 496) >> 4];
          const R = cpu.readData(cpu.dataView.getUint16(30, true));
          cpu.writeData(cpu.dataView.getUint16(30, true), r ^ R);
          cpu.data[(opcode & 496) >> 4] = R;
        } else if ((opcode & 61440) === 57344) {
          cpu.data[((opcode & 240) >> 4) + 16] = opcode & 15 | (opcode & 3840) >> 4;
        } else if ((opcode & 65039) === 36864) {
          cpu.cycles++;
          const value = cpu.readData(cpu.progMem[cpu.pc + 1]);
          cpu.data[(opcode & 496) >> 4] = value;
          cpu.pc++;
        } else if ((opcode & 65039) === 36876) {
          cpu.cycles++;
          cpu.data[(opcode & 496) >> 4] = cpu.readData(cpu.dataView.getUint16(26, true));
        } else if ((opcode & 65039) === 36877) {
          const x = cpu.dataView.getUint16(26, true);
          cpu.cycles++;
          cpu.data[(opcode & 496) >> 4] = cpu.readData(x);
          cpu.dataView.setUint16(26, x + 1, true);
        } else if ((opcode & 65039) === 36878) {
          const x = cpu.dataView.getUint16(26, true) - 1;
          cpu.dataView.setUint16(26, x, true);
          cpu.cycles++;
          cpu.data[(opcode & 496) >> 4] = cpu.readData(x);
        } else if ((opcode & 65039) === 32776) {
          cpu.cycles++;
          cpu.data[(opcode & 496) >> 4] = cpu.readData(cpu.dataView.getUint16(28, true));
        } else if ((opcode & 65039) === 36873) {
          const y = cpu.dataView.getUint16(28, true);
          cpu.cycles++;
          cpu.data[(opcode & 496) >> 4] = cpu.readData(y);
          cpu.dataView.setUint16(28, y + 1, true);
        } else if ((opcode & 65039) === 36874) {
          const y = cpu.dataView.getUint16(28, true) - 1;
          cpu.dataView.setUint16(28, y, true);
          cpu.cycles++;
          cpu.data[(opcode & 496) >> 4] = cpu.readData(y);
        } else if ((opcode & 53768) === 32776 && opcode & 7 | (opcode & 3072) >> 7 | (opcode & 8192) >> 8) {
          cpu.cycles++;
          cpu.data[(opcode & 496) >> 4] = cpu.readData(cpu.dataView.getUint16(28, true) + (opcode & 7 | (opcode & 3072) >> 7 | (opcode & 8192) >> 8));
        } else if ((opcode & 65039) === 32768) {
          cpu.cycles++;
          cpu.data[(opcode & 496) >> 4] = cpu.readData(cpu.dataView.getUint16(30, true));
        } else if ((opcode & 65039) === 36865) {
          const z = cpu.dataView.getUint16(30, true);
          cpu.cycles++;
          cpu.data[(opcode & 496) >> 4] = cpu.readData(z);
          cpu.dataView.setUint16(30, z + 1, true);
        } else if ((opcode & 65039) === 36866) {
          const z = cpu.dataView.getUint16(30, true) - 1;
          cpu.dataView.setUint16(30, z, true);
          cpu.cycles++;
          cpu.data[(opcode & 496) >> 4] = cpu.readData(z);
        } else if ((opcode & 53768) === 32768 && opcode & 7 | (opcode & 3072) >> 7 | (opcode & 8192) >> 8) {
          cpu.cycles++;
          cpu.data[(opcode & 496) >> 4] = cpu.readData(cpu.dataView.getUint16(30, true) + (opcode & 7 | (opcode & 3072) >> 7 | (opcode & 8192) >> 8));
        } else if (opcode === 38344) {
          cpu.data[0] = cpu.progBytes[cpu.dataView.getUint16(30, true)];
          cpu.cycles += 2;
        } else if ((opcode & 65039) === 36868) {
          cpu.data[(opcode & 496) >> 4] = cpu.progBytes[cpu.dataView.getUint16(30, true)];
          cpu.cycles += 2;
        } else if ((opcode & 65039) === 36869) {
          const i = cpu.dataView.getUint16(30, true);
          cpu.data[(opcode & 496) >> 4] = cpu.progBytes[i];
          cpu.dataView.setUint16(30, i + 1, true);
          cpu.cycles += 2;
        } else if ((opcode & 65039) === 37894) {
          const value = cpu.data[(opcode & 496) >> 4];
          const R = value >>> 1;
          cpu.data[(opcode & 496) >> 4] = R;
          let sreg = cpu.data[95] & 224;
          sreg |= R ? 0 : 2;
          sreg |= value & 1;
          sreg |= sreg >> 2 & 1 ^ sreg & 1 ? 8 : 0;
          sreg |= sreg >> 2 & 1 ^ sreg >> 3 & 1 ? 16 : 0;
          cpu.data[95] = sreg;
        } else if ((opcode & 64512) === 11264) {
          cpu.data[(opcode & 496) >> 4] = cpu.data[opcode & 15 | (opcode & 512) >> 5];
        } else if ((opcode & 65280) === 256) {
          const r2 = 2 * (opcode & 15);
          const d2 = 2 * ((opcode & 240) >> 4);
          cpu.data[d2] = cpu.data[r2];
          cpu.data[d2 + 1] = cpu.data[r2 + 1];
        } else if ((opcode & 64512) === 39936) {
          const R = cpu.data[(opcode & 496) >> 4] * cpu.data[opcode & 15 | (opcode & 512) >> 5];
          cpu.dataView.setUint16(0, R, true);
          cpu.data[95] = cpu.data[95] & 252 | (65535 & R ? 0 : 2) | (32768 & R ? 1 : 0);
          cpu.cycles++;
        } else if ((opcode & 65280) === 512) {
          const R = cpu.dataView.getInt8(((opcode & 240) >> 4) + 16) * cpu.dataView.getInt8((opcode & 15) + 16);
          cpu.dataView.setInt16(0, R, true);
          cpu.data[95] = cpu.data[95] & 252 | (65535 & R ? 0 : 2) | (32768 & R ? 1 : 0);
          cpu.cycles++;
        } else if ((opcode & 65416) === 768) {
          const R = cpu.dataView.getInt8(((opcode & 112) >> 4) + 16) * cpu.data[(opcode & 7) + 16];
          cpu.dataView.setInt16(0, R, true);
          cpu.data[95] = cpu.data[95] & 252 | (65535 & R ? 0 : 2) | (32768 & R ? 1 : 0);
          cpu.cycles++;
        } else if ((opcode & 65039) === 37889) {
          const d = (opcode & 496) >> 4;
          const value = cpu.data[d];
          const R = 0 - value;
          cpu.data[d] = R;
          let sreg = cpu.data[95] & 192;
          sreg |= R ? 0 : 2;
          sreg |= 128 & R ? 4 : 0;
          sreg |= 128 === R ? 8 : 0;
          sreg |= sreg >> 2 & 1 ^ sreg >> 3 & 1 ? 16 : 0;
          sreg |= R ? 1 : 0;
          sreg |= 1 & (R | value) ? 32 : 0;
          cpu.data[95] = sreg;
        } else if (opcode === 0) {
        } else if ((opcode & 64512) === 10240) {
          const R = cpu.data[(opcode & 496) >> 4] | cpu.data[opcode & 15 | (opcode & 512) >> 5];
          cpu.data[(opcode & 496) >> 4] = R;
          let sreg = cpu.data[95] & 225;
          sreg |= R ? 0 : 2;
          sreg |= 128 & R ? 4 : 0;
          sreg |= sreg >> 2 & 1 ^ sreg >> 3 & 1 ? 16 : 0;
          cpu.data[95] = sreg;
        } else if ((opcode & 61440) === 24576) {
          const R = cpu.data[((opcode & 240) >> 4) + 16] | (opcode & 15 | (opcode & 3840) >> 4);
          cpu.data[((opcode & 240) >> 4) + 16] = R;
          let sreg = cpu.data[95] & 225;
          sreg |= R ? 0 : 2;
          sreg |= 128 & R ? 4 : 0;
          sreg |= sreg >> 2 & 1 ^ sreg >> 3 & 1 ? 16 : 0;
          cpu.data[95] = sreg;
        } else if ((opcode & 63488) === 47104) {
          cpu.writeData((opcode & 15 | (opcode & 1536) >> 5) + 32, cpu.data[(opcode & 496) >> 4]);
        } else if ((opcode & 65039) === 36879) {
          const value = cpu.dataView.getUint16(93, true) + 1;
          cpu.dataView.setUint16(93, value, true);
          cpu.data[(opcode & 496) >> 4] = cpu.data[value];
          cpu.cycles++;
        } else if ((opcode & 65039) === 37391) {
          const value = cpu.dataView.getUint16(93, true);
          cpu.data[value] = cpu.data[(opcode & 496) >> 4];
          cpu.dataView.setUint16(93, value - 1, true);
          cpu.cycles++;
        } else if ((opcode & 61440) === 53248) {
          const k = (opcode & 2047) - (opcode & 2048 ? 2048 : 0);
          const retAddr = cpu.pc + 1;
          const sp = cpu.dataView.getUint16(93, true);
          const { pc22Bits } = cpu;
          cpu.data[sp] = 255 & retAddr;
          cpu.data[sp - 1] = retAddr >> 8 & 255;
          if (pc22Bits) {
            cpu.data[sp - 2] = retAddr >> 16 & 255;
          }
          cpu.dataView.setUint16(93, sp - (pc22Bits ? 3 : 2), true);
          cpu.pc += k;
          cpu.cycles += pc22Bits ? 3 : 2;
        } else if (opcode === 38152) {
          const { pc22Bits } = cpu;
          const i = cpu.dataView.getUint16(93, true) + (pc22Bits ? 3 : 2);
          cpu.dataView.setUint16(93, i, true);
          cpu.pc = (cpu.data[i - 1] << 8) + cpu.data[i] - 1;
          if (pc22Bits) {
            cpu.pc |= cpu.data[i - 2] << 16;
          }
          cpu.cycles += pc22Bits ? 4 : 3;
        } else if (opcode === 38168) {
          const { pc22Bits } = cpu;
          const i = cpu.dataView.getUint16(93, true) + (pc22Bits ? 3 : 2);
          cpu.dataView.setUint16(93, i, true);
          cpu.pc = (cpu.data[i - 1] << 8) + cpu.data[i] - 1;
          if (pc22Bits) {
            cpu.pc |= cpu.data[i - 2] << 16;
          }
          cpu.cycles += pc22Bits ? 4 : 3;
          cpu.data[95] |= 128;
        } else if ((opcode & 61440) === 49152) {
          cpu.pc = cpu.pc + ((opcode & 2047) - (opcode & 2048 ? 2048 : 0));
          cpu.cycles++;
        } else if ((opcode & 65039) === 37895) {
          const d = cpu.data[(opcode & 496) >> 4];
          const r = d >>> 1 | (cpu.data[95] & 1) << 7;
          cpu.data[(opcode & 496) >> 4] = r;
          let sreg = cpu.data[95] & 224;
          sreg |= r ? 0 : 2;
          sreg |= 128 & r ? 4 : 0;
          sreg |= 1 & d ? 1 : 0;
          sreg |= sreg >> 2 & 1 ^ sreg & 1 ? 8 : 0;
          sreg |= sreg >> 2 & 1 ^ sreg >> 3 & 1 ? 16 : 0;
          cpu.data[95] = sreg;
        } else if ((opcode & 64512) === 2048) {
          const val1 = cpu.data[(opcode & 496) >> 4];
          const val2 = cpu.data[opcode & 15 | (opcode & 512) >> 5];
          let sreg = cpu.data[95];
          const R = val1 - val2 - (sreg & 1);
          cpu.data[(opcode & 496) >> 4] = R;
          sreg = sreg & 192 | (!R && sreg >> 1 & 1 ? 2 : 0) | (val2 + (sreg & 1) > val1 ? 1 : 0);
          sreg |= 128 & R ? 4 : 0;
          sreg |= (val1 ^ val2) & (val1 ^ R) & 128 ? 8 : 0;
          sreg |= sreg >> 2 & 1 ^ sreg >> 3 & 1 ? 16 : 0;
          sreg |= 1 & (~val1 & val2 | val2 & R | R & ~val1) ? 32 : 0;
          cpu.data[95] = sreg;
        } else if ((opcode & 61440) === 16384) {
          const val1 = cpu.data[((opcode & 240) >> 4) + 16];
          const val2 = opcode & 15 | (opcode & 3840) >> 4;
          let sreg = cpu.data[95];
          const R = val1 - val2 - (sreg & 1);
          cpu.data[((opcode & 240) >> 4) + 16] = R;
          sreg = sreg & 192 | (!R && sreg >> 1 & 1 ? 2 : 0) | (val2 + (sreg & 1) > val1 ? 1 : 0);
          sreg |= 128 & R ? 4 : 0;
          sreg |= (val1 ^ val2) & (val1 ^ R) & 128 ? 8 : 0;
          sreg |= sreg >> 2 & 1 ^ sreg >> 3 & 1 ? 16 : 0;
          sreg |= 1 & (~val1 & val2 | val2 & R | R & ~val1) ? 32 : 0;
          cpu.data[95] = sreg;
        } else if ((opcode & 65280) === 39424) {
          const target = ((opcode & 248) >> 3) + 32;
          const mask = 1 << (opcode & 7);
          cpu.writeData(target, cpu.readData(target) | mask, mask);
          cpu.cycles++;
        } else if ((opcode & 65280) === 39168) {
          const value = cpu.readData(((opcode & 248) >> 3) + 32);
          if (!(value & 1 << (opcode & 7))) {
            const nextOpcode = cpu.progMem[cpu.pc + 1];
            const skipSize = isTwoWordInstruction(nextOpcode) ? 2 : 1;
            cpu.cycles += skipSize;
            cpu.pc += skipSize;
          }
        } else if ((opcode & 65280) === 39680) {
          const value = cpu.readData(((opcode & 248) >> 3) + 32);
          if (value & 1 << (opcode & 7)) {
            const nextOpcode = cpu.progMem[cpu.pc + 1];
            const skipSize = isTwoWordInstruction(nextOpcode) ? 2 : 1;
            cpu.cycles += skipSize;
            cpu.pc += skipSize;
          }
        } else if ((opcode & 65280) === 38656) {
          const i = 2 * ((opcode & 48) >> 4) + 24;
          const a = cpu.dataView.getUint16(i, true);
          const l = opcode & 15 | (opcode & 192) >> 2;
          const R = a - l;
          cpu.dataView.setUint16(i, R, true);
          let sreg = cpu.data[95] & 192;
          sreg |= R ? 0 : 2;
          sreg |= 32768 & R ? 4 : 0;
          sreg |= a & ~R & 32768 ? 8 : 0;
          sreg |= sreg >> 2 & 1 ^ sreg >> 3 & 1 ? 16 : 0;
          sreg |= l > a ? 1 : 0;
          sreg |= 1 & (~a & l | l & R | R & ~a) ? 32 : 0;
          cpu.data[95] = sreg;
          cpu.cycles++;
        } else if ((opcode & 65032) === 64512) {
          if (!(cpu.data[(opcode & 496) >> 4] & 1 << (opcode & 7))) {
            const nextOpcode = cpu.progMem[cpu.pc + 1];
            const skipSize = isTwoWordInstruction(nextOpcode) ? 2 : 1;
            cpu.cycles += skipSize;
            cpu.pc += skipSize;
          }
        } else if ((opcode & 65032) === 65024) {
          if (cpu.data[(opcode & 496) >> 4] & 1 << (opcode & 7)) {
            const nextOpcode = cpu.progMem[cpu.pc + 1];
            const skipSize = isTwoWordInstruction(nextOpcode) ? 2 : 1;
            cpu.cycles += skipSize;
            cpu.pc += skipSize;
          }
        } else if (opcode === 38280) {
        } else if (opcode === 38376) {
        } else if (opcode === 38392) {
        } else if ((opcode & 65039) === 37376) {
          const value = cpu.data[(opcode & 496) >> 4];
          const addr = cpu.progMem[cpu.pc + 1];
          cpu.writeData(addr, value);
          cpu.pc++;
          cpu.cycles++;
        } else if ((opcode & 65039) === 37388) {
          cpu.writeData(cpu.dataView.getUint16(26, true), cpu.data[(opcode & 496) >> 4]);
          cpu.cycles++;
        } else if ((opcode & 65039) === 37389) {
          const x = cpu.dataView.getUint16(26, true);
          cpu.writeData(x, cpu.data[(opcode & 496) >> 4]);
          cpu.dataView.setUint16(26, x + 1, true);
          cpu.cycles++;
        } else if ((opcode & 65039) === 37390) {
          const i = cpu.data[(opcode & 496) >> 4];
          const x = cpu.dataView.getUint16(26, true) - 1;
          cpu.dataView.setUint16(26, x, true);
          cpu.writeData(x, i);
          cpu.cycles++;
        } else if ((opcode & 65039) === 33288) {
          cpu.writeData(cpu.dataView.getUint16(28, true), cpu.data[(opcode & 496) >> 4]);
          cpu.cycles++;
        } else if ((opcode & 65039) === 37385) {
          const i = cpu.data[(opcode & 496) >> 4];
          const y = cpu.dataView.getUint16(28, true);
          cpu.writeData(y, i);
          cpu.dataView.setUint16(28, y + 1, true);
          cpu.cycles++;
        } else if ((opcode & 65039) === 37386) {
          const i = cpu.data[(opcode & 496) >> 4];
          const y = cpu.dataView.getUint16(28, true) - 1;
          cpu.dataView.setUint16(28, y, true);
          cpu.writeData(y, i);
          cpu.cycles++;
        } else if ((opcode & 53768) === 33288 && opcode & 7 | (opcode & 3072) >> 7 | (opcode & 8192) >> 8) {
          cpu.writeData(cpu.dataView.getUint16(28, true) + (opcode & 7 | (opcode & 3072) >> 7 | (opcode & 8192) >> 8), cpu.data[(opcode & 496) >> 4]);
          cpu.cycles++;
        } else if ((opcode & 65039) === 33280) {
          cpu.writeData(cpu.dataView.getUint16(30, true), cpu.data[(opcode & 496) >> 4]);
          cpu.cycles++;
        } else if ((opcode & 65039) === 37377) {
          const z = cpu.dataView.getUint16(30, true);
          cpu.writeData(z, cpu.data[(opcode & 496) >> 4]);
          cpu.dataView.setUint16(30, z + 1, true);
          cpu.cycles++;
        } else if ((opcode & 65039) === 37378) {
          const i = cpu.data[(opcode & 496) >> 4];
          const z = cpu.dataView.getUint16(30, true) - 1;
          cpu.dataView.setUint16(30, z, true);
          cpu.writeData(z, i);
          cpu.cycles++;
        } else if ((opcode & 53768) === 33280 && opcode & 7 | (opcode & 3072) >> 7 | (opcode & 8192) >> 8) {
          cpu.writeData(cpu.dataView.getUint16(30, true) + (opcode & 7 | (opcode & 3072) >> 7 | (opcode & 8192) >> 8), cpu.data[(opcode & 496) >> 4]);
          cpu.cycles++;
        } else if ((opcode & 64512) === 6144) {
          const val1 = cpu.data[(opcode & 496) >> 4];
          const val2 = cpu.data[opcode & 15 | (opcode & 512) >> 5];
          const R = val1 - val2;
          cpu.data[(opcode & 496) >> 4] = R;
          let sreg = cpu.data[95] & 192;
          sreg |= R ? 0 : 2;
          sreg |= 128 & R ? 4 : 0;
          sreg |= (val1 ^ val2) & (val1 ^ R) & 128 ? 8 : 0;
          sreg |= sreg >> 2 & 1 ^ sreg >> 3 & 1 ? 16 : 0;
          sreg |= val2 > val1 ? 1 : 0;
          sreg |= 1 & (~val1 & val2 | val2 & R | R & ~val1) ? 32 : 0;
          cpu.data[95] = sreg;
        } else if ((opcode & 61440) === 20480) {
          const val1 = cpu.data[((opcode & 240) >> 4) + 16];
          const val2 = opcode & 15 | (opcode & 3840) >> 4;
          const R = val1 - val2;
          cpu.data[((opcode & 240) >> 4) + 16] = R;
          let sreg = cpu.data[95] & 192;
          sreg |= R ? 0 : 2;
          sreg |= 128 & R ? 4 : 0;
          sreg |= (val1 ^ val2) & (val1 ^ R) & 128 ? 8 : 0;
          sreg |= sreg >> 2 & 1 ^ sreg >> 3 & 1 ? 16 : 0;
          sreg |= val2 > val1 ? 1 : 0;
          sreg |= 1 & (~val1 & val2 | val2 & R | R & ~val1) ? 32 : 0;
          cpu.data[95] = sreg;
        } else if ((opcode & 65039) === 37890) {
          const d = (opcode & 496) >> 4;
          const i = cpu.data[d];
          cpu.data[d] = (15 & i) << 4 | (240 & i) >>> 4;
        } else if (opcode === 38312) {
          cpu.onWatchdogReset();
        } else if ((opcode & 65039) === 37380) {
          const r = (opcode & 496) >> 4;
          const val1 = cpu.data[r];
          const val2 = cpu.data[cpu.dataView.getUint16(30, true)];
          cpu.data[cpu.dataView.getUint16(30, true)] = val1;
          cpu.data[r] = val2;
        }
        cpu.pc = (cpu.pc + 1) % cpu.progMem.length;
        cpu.cycles++;
      }
    }
  });

  // tools/programmable_simulator/node_modules/avr8js/dist/cjs/peripherals/adc.js
  var require_adc = __commonJS({
    "tools/programmable_simulator/node_modules/avr8js/dist/cjs/peripherals/adc.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", { value: true });
      exports.AVRADC = exports.adcConfig = exports.atmega328Channels = exports.ADCMuxInputType = exports.ADCReference = void 0;
      var ADCReference;
      (function(ADCReference2) {
        ADCReference2[ADCReference2["AVCC"] = 0] = "AVCC";
        ADCReference2[ADCReference2["AREF"] = 1] = "AREF";
        ADCReference2[ADCReference2["Internal1V1"] = 2] = "Internal1V1";
        ADCReference2[ADCReference2["Internal2V56"] = 3] = "Internal2V56";
        ADCReference2[ADCReference2["Reserved"] = 4] = "Reserved";
      })(ADCReference || (exports.ADCReference = ADCReference = {}));
      var ADCMuxInputType;
      (function(ADCMuxInputType2) {
        ADCMuxInputType2[ADCMuxInputType2["SingleEnded"] = 0] = "SingleEnded";
        ADCMuxInputType2[ADCMuxInputType2["Differential"] = 1] = "Differential";
        ADCMuxInputType2[ADCMuxInputType2["Constant"] = 2] = "Constant";
        ADCMuxInputType2[ADCMuxInputType2["Temperature"] = 3] = "Temperature";
      })(ADCMuxInputType || (exports.ADCMuxInputType = ADCMuxInputType = {}));
      exports.atmega328Channels = {
        0: { type: ADCMuxInputType.SingleEnded, channel: 0 },
        1: { type: ADCMuxInputType.SingleEnded, channel: 1 },
        2: { type: ADCMuxInputType.SingleEnded, channel: 2 },
        3: { type: ADCMuxInputType.SingleEnded, channel: 3 },
        4: { type: ADCMuxInputType.SingleEnded, channel: 4 },
        5: { type: ADCMuxInputType.SingleEnded, channel: 5 },
        6: { type: ADCMuxInputType.SingleEnded, channel: 6 },
        7: { type: ADCMuxInputType.SingleEnded, channel: 7 },
        8: { type: ADCMuxInputType.Temperature },
        14: { type: ADCMuxInputType.Constant, voltage: 1.1 },
        15: { type: ADCMuxInputType.Constant, voltage: 0 }
      };
      var fallbackMuxInput = {
        type: ADCMuxInputType.Constant,
        voltage: 0
      };
      exports.adcConfig = {
        ADMUX: 124,
        ADCSRA: 122,
        ADCSRB: 123,
        ADCL: 120,
        ADCH: 121,
        DIDR0: 126,
        adcInterrupt: 42,
        numChannels: 8,
        muxInputMask: 15,
        muxChannels: exports.atmega328Channels,
        adcReferences: [
          ADCReference.AREF,
          ADCReference.AVCC,
          ADCReference.Reserved,
          ADCReference.Internal1V1
        ]
      };
      var ADPS_MASK = 7;
      var ADIE = 8;
      var ADIF = 16;
      var ADSC = 64;
      var ADEN = 128;
      var MUX_MASK = 31;
      var ADLAR = 32;
      var MUX5 = 8;
      var REFS2 = 8;
      var REFS_MASK = 3;
      var REFS_SHIFT = 6;
      var AVRADC2 = class {
        constructor(cpu, config) {
          this.cpu = cpu;
          this.config = config;
          this.channelValues = new Array(this.config.numChannels);
          this.avcc = 5;
          this.aref = 5;
          this.onADCRead = (input) => {
            var _a;
            let voltage = 0;
            switch (input.type) {
              case ADCMuxInputType.Constant:
                voltage = input.voltage;
                break;
              case ADCMuxInputType.SingleEnded:
                voltage = (_a = this.channelValues[input.channel]) !== null && _a !== void 0 ? _a : 0;
                break;
              case ADCMuxInputType.Differential:
                voltage = input.gain * ((this.channelValues[input.positiveChannel] || 0) - (this.channelValues[input.negativeChannel] || 0));
                break;
              case ADCMuxInputType.Temperature:
                voltage = 0.378125;
                break;
            }
            const rawValue = voltage / this.referenceVoltage * 1024;
            const result = Math.min(Math.max(Math.floor(rawValue), 0), 1023);
            this.cpu.addClockEvent(() => this.completeADCRead(result), this.sampleCycles);
          };
          this.converting = false;
          this.conversionCycles = 25;
          this.ADC = {
            address: this.config.adcInterrupt,
            flagRegister: this.config.ADCSRA,
            flagMask: ADIF,
            enableRegister: this.config.ADCSRA,
            enableMask: ADIE
          };
          cpu.writeHooks[config.ADCSRA] = (value, oldValue) => {
            var _a;
            if (value & ADEN && !(oldValue & ADEN)) {
              this.conversionCycles = 25;
            }
            cpu.data[config.ADCSRA] = value;
            cpu.updateInterruptEnable(this.ADC, value);
            if (!this.converting && value & ADSC) {
              if (!(value & ADEN)) {
                this.cpu.addClockEvent(() => this.completeADCRead(0), this.sampleCycles);
                return true;
              }
              let channel = this.cpu.data[this.config.ADMUX] & MUX_MASK;
              if (cpu.data[config.ADCSRB] & MUX5) {
                channel |= 32;
              }
              channel &= config.muxInputMask;
              const muxInput = (_a = config.muxChannels[channel]) !== null && _a !== void 0 ? _a : fallbackMuxInput;
              this.converting = true;
              this.onADCRead(muxInput);
              return true;
            }
          };
        }
        completeADCRead(value) {
          const { ADCL, ADCH, ADMUX, ADCSRA } = this.config;
          this.converting = false;
          this.conversionCycles = 13;
          if (this.cpu.data[ADMUX] & ADLAR) {
            this.cpu.data[ADCL] = value << 6 & 255;
            this.cpu.data[ADCH] = value >> 2;
          } else {
            this.cpu.data[ADCL] = value & 255;
            this.cpu.data[ADCH] = value >> 8 & 3;
          }
          this.cpu.data[ADCSRA] &= ~ADSC;
          this.cpu.setInterruptFlag(this.ADC);
        }
        get prescaler() {
          const { ADCSRA } = this.config;
          const adcsra = this.cpu.data[ADCSRA];
          const adps = adcsra & ADPS_MASK;
          switch (adps) {
            case 0:
            case 1:
              return 2;
            case 2:
              return 4;
            case 3:
              return 8;
            case 4:
              return 16;
            case 5:
              return 32;
            case 6:
              return 64;
            case 7:
            default:
              return 128;
          }
        }
        get referenceVoltageType() {
          var _a;
          const { ADMUX, adcReferences } = this.config;
          let refs = this.cpu.data[ADMUX] >> REFS_SHIFT & REFS_MASK;
          if (adcReferences.length > 4 && this.cpu.data[ADMUX] & REFS2) {
            refs |= 4;
          }
          return (_a = adcReferences[refs]) !== null && _a !== void 0 ? _a : ADCReference.Reserved;
        }
        get referenceVoltage() {
          switch (this.referenceVoltageType) {
            case ADCReference.AVCC:
              return this.avcc;
            case ADCReference.AREF:
              return this.aref;
            case ADCReference.Internal1V1:
              return 1.1;
            case ADCReference.Internal2V56:
              return 2.56;
            default:
              return this.avcc;
          }
        }
        get sampleCycles() {
          return this.conversionCycles * this.prescaler;
        }
      };
      exports.AVRADC = AVRADC2;
    }
  });

  // tools/programmable_simulator/node_modules/avr8js/dist/cjs/peripherals/clock.js
  var require_clock = __commonJS({
    "tools/programmable_simulator/node_modules/avr8js/dist/cjs/peripherals/clock.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", { value: true });
      exports.AVRClock = exports.clockConfig = void 0;
      var CLKPCE = 128;
      exports.clockConfig = {
        CLKPR: 97
      };
      var prescalers = [
        1,
        2,
        4,
        8,
        16,
        32,
        64,
        128,
        256,
        // The following values are "reserved" according to the datasheet, so we measured
        // with a scope to figure them out (on ATmega328p)
        2,
        4,
        8,
        16,
        32,
        64,
        128
      ];
      var AVRClock = class {
        constructor(cpu, baseFreqHz, config = exports.clockConfig) {
          this.cpu = cpu;
          this.baseFreqHz = baseFreqHz;
          this.config = config;
          this.clockEnabledCycles = 0;
          this.prescalerValue = 1;
          this.cyclesDelta = 0;
          this.cpu.writeHooks[this.config.CLKPR] = (clkpr) => {
            if ((!this.clockEnabledCycles || this.clockEnabledCycles < cpu.cycles) && clkpr === CLKPCE) {
              this.clockEnabledCycles = this.cpu.cycles + 4;
            } else if (this.clockEnabledCycles && this.clockEnabledCycles >= cpu.cycles) {
              this.clockEnabledCycles = 0;
              const index = clkpr & 15;
              const oldPrescaler = this.prescalerValue;
              this.prescalerValue = prescalers[index];
              this.cpu.data[this.config.CLKPR] = index;
              if (oldPrescaler !== this.prescalerValue) {
                this.cyclesDelta = (cpu.cycles + this.cyclesDelta) * (oldPrescaler / this.prescalerValue) - cpu.cycles;
              }
            }
            return true;
          };
        }
        get frequency() {
          return this.baseFreqHz / this.prescalerValue;
        }
        get prescaler() {
          return this.prescalerValue;
        }
        get timeNanos() {
          return (this.cpu.cycles + this.cyclesDelta) / this.frequency * 1e9;
        }
        get timeMicros() {
          return (this.cpu.cycles + this.cyclesDelta) / this.frequency * 1e6;
        }
        get timeMillis() {
          return (this.cpu.cycles + this.cyclesDelta) / this.frequency * 1e3;
        }
      };
      exports.AVRClock = AVRClock;
    }
  });

  // tools/programmable_simulator/node_modules/avr8js/dist/cjs/peripherals/eeprom.js
  var require_eeprom = __commonJS({
    "tools/programmable_simulator/node_modules/avr8js/dist/cjs/peripherals/eeprom.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", { value: true });
      exports.AVREEPROM = exports.eepromConfig = exports.EEPROMMemoryBackend = void 0;
      var EEPROMMemoryBackend = class {
        constructor(size) {
          this.memory = new Uint8Array(size);
          this.memory.fill(255);
        }
        readMemory(addr) {
          return this.memory[addr];
        }
        writeMemory(addr, value) {
          this.memory[addr] &= value;
        }
        eraseMemory(addr) {
          this.memory[addr] = 255;
        }
      };
      exports.EEPROMMemoryBackend = EEPROMMemoryBackend;
      exports.eepromConfig = {
        eepromReadyInterrupt: 44,
        EECR: 63,
        EEDR: 64,
        EEARL: 65,
        EEARH: 66,
        eraseCycles: 28800,
        // 1.8ms at 16MHz
        writeCycles: 28800
        // 1.8ms at 16MHz
      };
      var EERE = 1 << 0;
      var EEPE = 1 << 1;
      var EEMPE = 1 << 2;
      var EERIE = 1 << 3;
      var EEPM0 = 1 << 4;
      var EEPM1 = 1 << 5;
      var EECR_WRITE_MASK = EEPE | EEMPE | EERIE | EEPM0 | EEPM1;
      var AVREEPROM = class {
        constructor(cpu, backend, config = exports.eepromConfig) {
          this.cpu = cpu;
          this.backend = backend;
          this.config = config;
          this.writeEnabledCycles = 0;
          this.writeCompleteCycles = 0;
          this.EER = {
            address: this.config.eepromReadyInterrupt,
            flagRegister: this.config.EECR,
            flagMask: EEPE,
            enableRegister: this.config.EECR,
            enableMask: EERIE,
            constant: true,
            inverseFlag: true
          };
          this.cpu.writeHooks[this.config.EECR] = (eecr) => {
            const { EEARH, EEARL, EECR, EEDR } = this.config;
            const addr = this.cpu.data[EEARH] << 8 | this.cpu.data[EEARL];
            this.cpu.data[EECR] = this.cpu.data[EECR] & ~EECR_WRITE_MASK | eecr & EECR_WRITE_MASK;
            this.cpu.updateInterruptEnable(this.EER, eecr);
            if (eecr & EERE) {
              this.cpu.clearInterrupt(this.EER);
            }
            if (eecr & EEMPE) {
              const eempeCycles = 4;
              this.writeEnabledCycles = this.cpu.cycles + eempeCycles;
              this.cpu.addClockEvent(() => {
                this.cpu.data[EECR] &= ~EEMPE;
              }, eempeCycles);
            }
            if (eecr & EERE) {
              this.cpu.data[EEDR] = this.backend.readMemory(addr);
              this.cpu.cycles += 4;
              return true;
            }
            if (eecr & EEPE) {
              if (this.cpu.cycles >= this.writeEnabledCycles) {
                this.cpu.data[EECR] &= ~EEPE;
                return true;
              }
              if (this.cpu.cycles < this.writeCompleteCycles) {
                return true;
              }
              const eedr = this.cpu.data[EEDR];
              this.writeCompleteCycles = this.cpu.cycles;
              if (!(eecr & EEPM1)) {
                this.backend.eraseMemory(addr);
                this.writeCompleteCycles += this.config.eraseCycles;
              }
              if (!(eecr & EEPM0)) {
                this.backend.writeMemory(addr, eedr);
                this.writeCompleteCycles += this.config.writeCycles;
              }
              this.cpu.data[EECR] |= EEPE;
              this.cpu.addClockEvent(() => {
                this.cpu.setInterruptFlag(this.EER);
              }, this.writeCompleteCycles - this.cpu.cycles);
              this.cpu.cycles += 2;
            }
            return true;
          };
        }
      };
      exports.AVREEPROM = AVREEPROM;
    }
  });

  // tools/programmable_simulator/node_modules/avr8js/dist/cjs/peripherals/gpio.js
  var require_gpio = __commonJS({
    "tools/programmable_simulator/node_modules/avr8js/dist/cjs/peripherals/gpio.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", { value: true });
      exports.AVRIOPort = exports.PinOverrideMode = exports.PinState = exports.portLConfig = exports.portKConfig = exports.portJConfig = exports.portHConfig = exports.portGConfig = exports.portFConfig = exports.portEConfig = exports.portDConfig = exports.portCConfig = exports.portBConfig = exports.portAConfig = exports.PCINT2 = exports.PCINT1 = exports.PCINT0 = exports.INT1 = exports.INT0 = void 0;
      exports.INT0 = {
        EICR: 105,
        EIMSK: 61,
        EIFR: 60,
        index: 0,
        iscOffset: 0,
        interrupt: 2
      };
      exports.INT1 = {
        EICR: 105,
        EIMSK: 61,
        EIFR: 60,
        index: 1,
        iscOffset: 2,
        interrupt: 4
      };
      exports.PCINT0 = {
        PCIE: 0,
        PCICR: 104,
        PCIFR: 59,
        PCMSK: 107,
        pinChangeInterrupt: 6,
        mask: 255,
        offset: 0
      };
      exports.PCINT1 = {
        PCIE: 1,
        PCICR: 104,
        PCIFR: 59,
        PCMSK: 108,
        pinChangeInterrupt: 8,
        mask: 255,
        offset: 0
      };
      exports.PCINT2 = {
        PCIE: 2,
        PCICR: 104,
        PCIFR: 59,
        PCMSK: 109,
        pinChangeInterrupt: 10,
        mask: 255,
        offset: 0
      };
      exports.portAConfig = {
        PIN: 32,
        DDR: 33,
        PORT: 34,
        externalInterrupts: []
      };
      exports.portBConfig = {
        PIN: 35,
        DDR: 36,
        PORT: 37,
        // Interrupt settings
        pinChange: exports.PCINT0,
        externalInterrupts: []
      };
      exports.portCConfig = {
        PIN: 38,
        DDR: 39,
        PORT: 40,
        // Interrupt settings
        pinChange: exports.PCINT1,
        externalInterrupts: []
      };
      exports.portDConfig = {
        PIN: 41,
        DDR: 42,
        PORT: 43,
        // Interrupt settings
        pinChange: exports.PCINT2,
        externalInterrupts: [null, null, exports.INT0, exports.INT1]
      };
      exports.portEConfig = {
        PIN: 44,
        DDR: 45,
        PORT: 46,
        externalInterrupts: []
      };
      exports.portFConfig = {
        PIN: 47,
        DDR: 48,
        PORT: 49,
        externalInterrupts: []
      };
      exports.portGConfig = {
        PIN: 50,
        DDR: 51,
        PORT: 52,
        externalInterrupts: []
      };
      exports.portHConfig = {
        PIN: 256,
        DDR: 257,
        PORT: 258,
        externalInterrupts: []
      };
      exports.portJConfig = {
        PIN: 259,
        DDR: 260,
        PORT: 261,
        externalInterrupts: []
      };
      exports.portKConfig = {
        PIN: 262,
        DDR: 263,
        PORT: 264,
        externalInterrupts: []
      };
      exports.portLConfig = {
        PIN: 265,
        DDR: 266,
        PORT: 267,
        externalInterrupts: []
      };
      var PinState;
      (function(PinState2) {
        PinState2[PinState2["Low"] = 0] = "Low";
        PinState2[PinState2["High"] = 1] = "High";
        PinState2[PinState2["Input"] = 2] = "Input";
        PinState2[PinState2["InputPullUp"] = 3] = "InputPullUp";
      })(PinState || (exports.PinState = PinState = {}));
      var PinOverrideMode;
      (function(PinOverrideMode2) {
        PinOverrideMode2[PinOverrideMode2["None"] = 0] = "None";
        PinOverrideMode2[PinOverrideMode2["Enable"] = 1] = "Enable";
        PinOverrideMode2[PinOverrideMode2["Set"] = 2] = "Set";
        PinOverrideMode2[PinOverrideMode2["Clear"] = 3] = "Clear";
        PinOverrideMode2[PinOverrideMode2["Toggle"] = 4] = "Toggle";
      })(PinOverrideMode || (exports.PinOverrideMode = PinOverrideMode = {}));
      var InterruptMode;
      (function(InterruptMode2) {
        InterruptMode2[InterruptMode2["LowLevel"] = 0] = "LowLevel";
        InterruptMode2[InterruptMode2["Change"] = 1] = "Change";
        InterruptMode2[InterruptMode2["FallingEdge"] = 2] = "FallingEdge";
        InterruptMode2[InterruptMode2["RisingEdge"] = 3] = "RisingEdge";
      })(InterruptMode || (InterruptMode = {}));
      var AVRIOPort2 = class {
        constructor(cpu, portConfig) {
          var _a, _b, _c, _d;
          this.cpu = cpu;
          this.portConfig = portConfig;
          this.externalClockListeners = [];
          this.listeners = [];
          this.pinValue = 0;
          this.overrideMask = 255;
          this.overrideValue = 0;
          this.lastValue = 0;
          this.lastDdr = 0;
          this.lastPin = 0;
          this.openCollector = 0;
          cpu.gpioPorts.add(this);
          cpu.gpioByPort[portConfig.PORT] = this;
          cpu.writeHooks[portConfig.DDR] = (value) => {
            const portValue = cpu.data[portConfig.PORT];
            cpu.data[portConfig.DDR] = value;
            this.writeGpio(portValue, value);
            this.updatePinRegister(value);
            return true;
          };
          cpu.writeHooks[portConfig.PORT] = (value) => {
            const ddrMask = cpu.data[portConfig.DDR];
            cpu.data[portConfig.PORT] = value;
            this.writeGpio(value, ddrMask);
            this.updatePinRegister(ddrMask);
            return true;
          };
          cpu.writeHooks[portConfig.PIN] = (value, oldValue, addr, mask) => {
            const oldPortValue = cpu.data[portConfig.PORT];
            const ddrMask = cpu.data[portConfig.DDR];
            const portValue = oldPortValue ^ value & mask;
            cpu.data[portConfig.PORT] = portValue;
            this.writeGpio(portValue, ddrMask);
            this.updatePinRegister(ddrMask);
            return true;
          };
          const { externalInterrupts } = portConfig;
          this.externalInts = externalInterrupts.map((externalConfig) => externalConfig ? {
            address: externalConfig.interrupt,
            flagRegister: externalConfig.EIFR,
            flagMask: 1 << externalConfig.index,
            enableRegister: externalConfig.EIMSK,
            enableMask: 1 << externalConfig.index
          } : null);
          const EICR = new Set(externalInterrupts.map((item) => item === null || item === void 0 ? void 0 : item.EICR));
          for (const EICRx of EICR) {
            this.attachInterruptHook(EICRx || 0);
          }
          const EIMSK = (_b = (_a = externalInterrupts.find((item) => item && item.EIMSK)) === null || _a === void 0 ? void 0 : _a.EIMSK) !== null && _b !== void 0 ? _b : 0;
          this.attachInterruptHook(EIMSK, "mask");
          const EIFR = (_d = (_c = externalInterrupts.find((item) => item && item.EIFR)) === null || _c === void 0 ? void 0 : _c.EIFR) !== null && _d !== void 0 ? _d : 0;
          this.attachInterruptHook(EIFR, "flag");
          const { pinChange } = portConfig;
          this.PCINT = pinChange ? {
            address: pinChange.pinChangeInterrupt,
            flagRegister: pinChange.PCIFR,
            flagMask: 1 << pinChange.PCIE,
            enableRegister: pinChange.PCICR,
            enableMask: 1 << pinChange.PCIE
          } : null;
          if (pinChange) {
            const { PCIFR, PCMSK } = pinChange;
            cpu.writeHooks[PCIFR] = (value) => {
              for (const gpio of this.cpu.gpioPorts) {
                const { PCINT } = gpio;
                if (PCINT) {
                  cpu.clearInterruptByFlag(PCINT, value);
                }
              }
              return true;
            };
            cpu.writeHooks[PCMSK] = (value) => {
              cpu.data[PCMSK] = value;
              for (const gpio of this.cpu.gpioPorts) {
                const { PCINT } = gpio;
                if (PCINT) {
                  cpu.updateInterruptEnable(PCINT, value);
                }
              }
              return true;
            };
          }
        }
        addListener(listener) {
          this.listeners.push(listener);
        }
        removeListener(listener) {
          this.listeners = this.listeners.filter((l) => l !== listener);
        }
        /**
         * Get the state of a given GPIO pin
         *
         * @param index Pin index to return from 0 to 7
         * @returns PinState.Low or PinState.High if the pin is set to output, PinState.Input if the pin is set
         *   to input, and PinState.InputPullUp if the pin is set to input and the internal pull-up resistor has
         *   been enabled.
         */
        pinState(index) {
          const ddr = this.cpu.data[this.portConfig.DDR];
          const port = this.cpu.data[this.portConfig.PORT];
          const bitMask = 1 << index;
          const openState = port & bitMask ? PinState.InputPullUp : PinState.Input;
          const highValue = this.openCollector & bitMask ? openState : PinState.High;
          if (ddr & bitMask) {
            return this.lastValue & bitMask ? highValue : PinState.Low;
          } else {
            return openState;
          }
        }
        /**
         * Sets the input value for the given pin. This is the value that
         * will be returned when reading from the PIN register.
         */
        setPin(index, value) {
          const bitMask = 1 << index;
          this.pinValue &= ~bitMask;
          if (value) {
            this.pinValue |= bitMask;
          }
          this.updatePinRegister(this.cpu.data[this.portConfig.DDR]);
        }
        /**
         * Internal method - do not call this directly!
         * Used by the timer compare output units to override GPIO pins.
         */
        timerOverridePin(pin, mode) {
          const { cpu, portConfig } = this;
          const pinMask = 1 << pin;
          if (mode === PinOverrideMode.None) {
            this.overrideMask |= pinMask;
            this.overrideValue &= ~pinMask;
          } else {
            this.overrideMask &= ~pinMask;
            switch (mode) {
              case PinOverrideMode.Enable:
                this.overrideValue &= ~pinMask;
                this.overrideValue |= cpu.data[portConfig.PORT] & pinMask;
                break;
              case PinOverrideMode.Set:
                this.overrideValue |= pinMask;
                break;
              case PinOverrideMode.Clear:
                this.overrideValue &= ~pinMask;
                break;
              case PinOverrideMode.Toggle:
                this.overrideValue ^= pinMask;
                break;
            }
          }
          const ddrMask = cpu.data[portConfig.DDR];
          this.writeGpio(cpu.data[portConfig.PORT], ddrMask);
          this.updatePinRegister(ddrMask);
        }
        updatePinRegister(ddr) {
          var _a, _b;
          const newPin = this.pinValue & ~ddr | this.lastValue & ddr;
          this.cpu.data[this.portConfig.PIN] = newPin;
          if (this.lastPin !== newPin) {
            for (let index = 0; index < 8; index++) {
              if ((newPin & 1 << index) !== (this.lastPin & 1 << index)) {
                const value = !!(newPin & 1 << index);
                this.toggleInterrupt(index, value);
                (_b = (_a = this.externalClockListeners)[index]) === null || _b === void 0 ? void 0 : _b.call(_a, value);
              }
            }
            this.lastPin = newPin;
          }
        }
        toggleInterrupt(pin, risingEdge) {
          const { cpu, portConfig, externalInts, PCINT } = this;
          const { externalInterrupts, pinChange } = portConfig;
          const externalConfig = externalInterrupts[pin];
          const external = externalInts[pin];
          if (external && externalConfig) {
            const { EIMSK, index, EICR, iscOffset } = externalConfig;
            if (cpu.data[EIMSK] & 1 << index) {
              const configuration = cpu.data[EICR] >> iscOffset & 3;
              let generateInterrupt = false;
              external.constant = false;
              switch (configuration) {
                case InterruptMode.LowLevel:
                  generateInterrupt = !risingEdge;
                  external.constant = true;
                  break;
                case InterruptMode.Change:
                  generateInterrupt = true;
                  break;
                case InterruptMode.FallingEdge:
                  generateInterrupt = !risingEdge;
                  break;
                case InterruptMode.RisingEdge:
                  generateInterrupt = risingEdge;
                  break;
              }
              if (generateInterrupt) {
                cpu.setInterruptFlag(external);
              } else if (external.constant) {
                cpu.clearInterrupt(external, true);
              }
            }
          }
          if (pinChange && PCINT && pinChange.mask & 1 << pin) {
            const { PCMSK } = pinChange;
            if (cpu.data[PCMSK] & 1 << pin + pinChange.offset) {
              cpu.setInterruptFlag(PCINT);
            }
          }
        }
        attachInterruptHook(register, registerType = "other") {
          if (!register) {
            return;
          }
          const { cpu } = this;
          cpu.writeHooks[register] = (value) => {
            if (registerType !== "flag") {
              cpu.data[register] = value;
            }
            for (const gpio of cpu.gpioPorts) {
              for (const external of gpio.externalInts) {
                if (external && registerType === "mask") {
                  cpu.updateInterruptEnable(external, value);
                }
                if (external && !external.constant && registerType === "flag") {
                  cpu.clearInterruptByFlag(external, value);
                }
              }
              gpio.checkExternalInterrupts();
            }
            return true;
          };
        }
        checkExternalInterrupts() {
          const { cpu } = this;
          const { externalInterrupts } = this.portConfig;
          for (let pin = 0; pin < 8; pin++) {
            const external = externalInterrupts[pin];
            if (!external) {
              continue;
            }
            const pinValue = !!(this.lastPin & 1 << pin);
            const { EIFR, EIMSK, index, EICR, iscOffset, interrupt } = external;
            if (!(cpu.data[EIMSK] & 1 << index) || pinValue) {
              continue;
            }
            const configuration = cpu.data[EICR] >> iscOffset & 3;
            if (configuration === InterruptMode.LowLevel) {
              cpu.queueInterrupt({
                address: interrupt,
                flagRegister: EIFR,
                flagMask: 1 << index,
                enableRegister: EIMSK,
                enableMask: 1 << index,
                constant: true
              });
            }
          }
        }
        writeGpio(value, ddr) {
          const newValue = (value & this.overrideMask | this.overrideValue) & ddr | value & ~ddr;
          const prevValue = this.lastValue;
          if (newValue !== prevValue || ddr !== this.lastDdr) {
            this.lastValue = newValue;
            this.lastDdr = ddr;
            for (const listener of this.listeners) {
              listener(newValue, prevValue);
            }
          }
        }
      };
      exports.AVRIOPort = AVRIOPort2;
    }
  });

  // tools/programmable_simulator/node_modules/avr8js/dist/cjs/peripherals/spi.js
  var require_spi = __commonJS({
    "tools/programmable_simulator/node_modules/avr8js/dist/cjs/peripherals/spi.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", { value: true });
      exports.AVRSPI = exports.spiConfig = void 0;
      var SPCR_SPIE = 128;
      var SPCR_SPE = 64;
      var SPCR_DORD = 32;
      var SPCR_MSTR = 16;
      var SPCR_CPOL = 8;
      var SPCR_CPHA = 4;
      var SPCR_SPR1 = 2;
      var SPCR_SPR0 = 1;
      var SPSR_SPR_MASK = SPCR_SPR1 | SPCR_SPR0;
      var SPSR_SPIF = 128;
      var SPSR_WCOL = 64;
      var SPSR_SPI2X = 1;
      exports.spiConfig = {
        spiInterrupt: 34,
        SPCR: 76,
        SPSR: 77,
        SPDR: 78
      };
      var bitsPerByte = 8;
      var AVRSPI = class {
        constructor(cpu, config, freqHz) {
          this.cpu = cpu;
          this.config = config;
          this.freqHz = freqHz;
          this.onTransfer = () => 0;
          this.onByte = (value) => {
            const valueIn = this.onTransfer(value);
            this.cpu.addClockEvent(() => this.completeTransfer(valueIn), this.transferCycles);
          };
          this.transmissionActive = false;
          this.SPI = {
            address: this.config.spiInterrupt,
            flagRegister: this.config.SPSR,
            flagMask: SPSR_SPIF,
            enableRegister: this.config.SPCR,
            enableMask: SPCR_SPIE
          };
          const { SPCR, SPSR, SPDR } = config;
          cpu.writeHooks[SPDR] = (value) => {
            if (!(cpu.data[SPCR] & SPCR_SPE)) {
              return;
            }
            if (this.transmissionActive) {
              cpu.data[SPSR] |= SPSR_WCOL;
              return true;
            }
            cpu.data[SPSR] &= ~SPSR_WCOL;
            this.cpu.clearInterrupt(this.SPI);
            this.transmissionActive = true;
            this.onByte(value);
            return true;
          };
          cpu.writeHooks[SPCR] = (value) => {
            this.cpu.updateInterruptEnable(this.SPI, value);
          };
          cpu.writeHooks[SPSR] = (value) => {
            this.cpu.data[SPSR] = value;
            this.cpu.clearInterruptByFlag(this.SPI, value);
          };
        }
        reset() {
          this.transmissionActive = false;
        }
        /**
         * Completes an SPI transaction. Call this method only from the `onByte` callback.
         *
         * @param receivedByte Byte read from the SPI MISO line.
         */
        completeTransfer(receivedByte) {
          const { SPDR } = this.config;
          this.cpu.data[SPDR] = receivedByte;
          this.cpu.setInterruptFlag(this.SPI);
          this.transmissionActive = false;
        }
        get isMaster() {
          return this.cpu.data[this.config.SPCR] & SPCR_MSTR ? true : false;
        }
        get dataOrder() {
          return this.cpu.data[this.config.SPCR] & SPCR_DORD ? "lsbFirst" : "msbFirst";
        }
        get spiMode() {
          const CPHA = this.cpu.data[this.config.SPCR] & SPCR_CPHA;
          const CPOL = this.cpu.data[this.config.SPCR] & SPCR_CPOL;
          return (CPHA ? 2 : 0) | (CPOL ? 1 : 0);
        }
        /**
         * The clock divider is only relevant for Master mode
         */
        get clockDivider() {
          const base = this.cpu.data[this.config.SPSR] & SPSR_SPI2X ? 2 : 4;
          switch (this.cpu.data[this.config.SPCR] & SPSR_SPR_MASK) {
            case 0:
              return base;
            case 1:
              return base * 4;
            case 2:
              return base * 16;
            case 3:
              return base * 32;
          }
          throw new Error("Invalid divider value!");
        }
        /** Number of cycles to complete a single byte SPI transaction */
        get transferCycles() {
          return this.clockDivider * bitsPerByte;
        }
        /**
         * The SPI freqeuncy is only relevant to Master mode.
         * In slave mode, the frequency can be as high as F(osc) / 4.
         */
        get spiFrequency() {
          return this.freqHz / this.clockDivider;
        }
      };
      exports.AVRSPI = AVRSPI;
    }
  });

  // tools/programmable_simulator/node_modules/avr8js/dist/cjs/peripherals/timer.js
  var require_timer = __commonJS({
    "tools/programmable_simulator/node_modules/avr8js/dist/cjs/peripherals/timer.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", { value: true });
      exports.AVRTimer = exports.timer2Config = exports.timer1Config = exports.timer0Config = void 0;
      var gpio_1 = require_gpio();
      var timer01Dividers = {
        0: 0,
        1: 1,
        2: 8,
        3: 64,
        4: 256,
        5: 1024,
        6: 0,
        // External clock - see ExternalClockMode
        7: 0
        // Ditto
      };
      var ExternalClockMode;
      (function(ExternalClockMode2) {
        ExternalClockMode2[ExternalClockMode2["FallingEdge"] = 6] = "FallingEdge";
        ExternalClockMode2[ExternalClockMode2["RisingEdge"] = 7] = "RisingEdge";
      })(ExternalClockMode || (ExternalClockMode = {}));
      var defaultTimerBits = {
        // TIFR bits
        TOV: 1,
        OCFA: 2,
        OCFB: 4,
        OCFC: 0,
        // Unused
        // TIMSK bits
        TOIE: 1,
        OCIEA: 2,
        OCIEB: 4,
        OCIEC: 0
        // Unused
      };
      exports.timer0Config = Object.assign({ bits: 8, captureInterrupt: 0, compAInterrupt: 28, compBInterrupt: 30, compCInterrupt: 0, ovfInterrupt: 32, TIFR: 53, OCRA: 71, OCRB: 72, OCRC: 0, ICR: 0, TCNT: 70, TCCRA: 68, TCCRB: 69, TCCRC: 0, TIMSK: 110, dividers: timer01Dividers, compPortA: gpio_1.portDConfig.PORT, compPinA: 6, compPortB: gpio_1.portDConfig.PORT, compPinB: 5, compPortC: 0, compPinC: 0, externalClockPort: gpio_1.portDConfig.PORT, externalClockPin: 4 }, defaultTimerBits);
      exports.timer1Config = Object.assign({ bits: 16, captureInterrupt: 20, compAInterrupt: 22, compBInterrupt: 24, compCInterrupt: 0, ovfInterrupt: 26, TIFR: 54, OCRA: 136, OCRB: 138, OCRC: 0, ICR: 134, TCNT: 132, TCCRA: 128, TCCRB: 129, TCCRC: 130, TIMSK: 111, dividers: timer01Dividers, compPortA: gpio_1.portBConfig.PORT, compPinA: 1, compPortB: gpio_1.portBConfig.PORT, compPinB: 2, compPortC: 0, compPinC: 0, externalClockPort: gpio_1.portDConfig.PORT, externalClockPin: 5 }, defaultTimerBits);
      exports.timer2Config = Object.assign({ bits: 8, captureInterrupt: 0, compAInterrupt: 14, compBInterrupt: 16, compCInterrupt: 0, ovfInterrupt: 18, TIFR: 55, OCRA: 179, OCRB: 180, OCRC: 0, ICR: 0, TCNT: 178, TCCRA: 176, TCCRB: 177, TCCRC: 0, TIMSK: 112, dividers: {
        0: 0,
        1: 1,
        2: 8,
        3: 32,
        4: 64,
        5: 128,
        6: 256,
        7: 1024
      }, compPortA: gpio_1.portBConfig.PORT, compPinA: 3, compPortB: gpio_1.portDConfig.PORT, compPinB: 3, compPortC: 0, compPinC: 0, externalClockPort: 0, externalClockPin: 0 }, defaultTimerBits);
      var TimerMode2;
      (function(TimerMode3) {
        TimerMode3[TimerMode3["Normal"] = 0] = "Normal";
        TimerMode3[TimerMode3["PWMPhaseCorrect"] = 1] = "PWMPhaseCorrect";
        TimerMode3[TimerMode3["CTC"] = 2] = "CTC";
        TimerMode3[TimerMode3["FastPWM"] = 3] = "FastPWM";
        TimerMode3[TimerMode3["PWMPhaseFrequencyCorrect"] = 4] = "PWMPhaseFrequencyCorrect";
        TimerMode3[TimerMode3["Reserved"] = 5] = "Reserved";
      })(TimerMode2 || (TimerMode2 = {}));
      var TOVUpdateMode;
      (function(TOVUpdateMode2) {
        TOVUpdateMode2[TOVUpdateMode2["Max"] = 0] = "Max";
        TOVUpdateMode2[TOVUpdateMode2["Top"] = 1] = "Top";
        TOVUpdateMode2[TOVUpdateMode2["Bottom"] = 2] = "Bottom";
      })(TOVUpdateMode || (TOVUpdateMode = {}));
      var OCRUpdateMode;
      (function(OCRUpdateMode2) {
        OCRUpdateMode2[OCRUpdateMode2["Immediate"] = 0] = "Immediate";
        OCRUpdateMode2[OCRUpdateMode2["Top"] = 1] = "Top";
        OCRUpdateMode2[OCRUpdateMode2["Bottom"] = 2] = "Bottom";
      })(OCRUpdateMode || (OCRUpdateMode = {}));
      var TopOCRA = 1;
      var TopICR = 2;
      var OCToggle = 1;
      var { Normal, PWMPhaseCorrect, CTC, FastPWM, Reserved, PWMPhaseFrequencyCorrect } = TimerMode2;
      var wgmModes8Bit = [
        /*0*/
        [Normal, 255, OCRUpdateMode.Immediate, TOVUpdateMode.Max, 0],
        /*1*/
        [PWMPhaseCorrect, 255, OCRUpdateMode.Top, TOVUpdateMode.Bottom, 0],
        /*2*/
        [CTC, TopOCRA, OCRUpdateMode.Immediate, TOVUpdateMode.Max, 0],
        /*3*/
        [FastPWM, 255, OCRUpdateMode.Bottom, TOVUpdateMode.Max, 0],
        /*4*/
        [Reserved, 255, OCRUpdateMode.Immediate, TOVUpdateMode.Max, 0],
        /*5*/
        [PWMPhaseCorrect, TopOCRA, OCRUpdateMode.Top, TOVUpdateMode.Bottom, OCToggle],
        /*6*/
        [Reserved, 255, OCRUpdateMode.Immediate, TOVUpdateMode.Max, 0],
        /*7*/
        [FastPWM, TopOCRA, OCRUpdateMode.Bottom, TOVUpdateMode.Top, OCToggle]
      ];
      var wgmModes16Bit = [
        /*0 */
        [Normal, 65535, OCRUpdateMode.Immediate, TOVUpdateMode.Max, 0],
        /*1 */
        [PWMPhaseCorrect, 255, OCRUpdateMode.Top, TOVUpdateMode.Bottom, 0],
        /*2 */
        [PWMPhaseCorrect, 511, OCRUpdateMode.Top, TOVUpdateMode.Bottom, 0],
        /*3 */
        [PWMPhaseCorrect, 1023, OCRUpdateMode.Top, TOVUpdateMode.Bottom, 0],
        /*4 */
        [CTC, TopOCRA, OCRUpdateMode.Immediate, TOVUpdateMode.Max, 0],
        /*5 */
        [FastPWM, 255, OCRUpdateMode.Bottom, TOVUpdateMode.Top, 0],
        /*6 */
        [FastPWM, 511, OCRUpdateMode.Bottom, TOVUpdateMode.Top, 0],
        /*7 */
        [FastPWM, 1023, OCRUpdateMode.Bottom, TOVUpdateMode.Top, 0],
        /*8 */
        [PWMPhaseFrequencyCorrect, TopICR, OCRUpdateMode.Bottom, TOVUpdateMode.Bottom, 0],
        /*9 */
        [PWMPhaseFrequencyCorrect, TopOCRA, OCRUpdateMode.Bottom, TOVUpdateMode.Bottom, OCToggle],
        /*10*/
        [PWMPhaseCorrect, TopICR, OCRUpdateMode.Top, TOVUpdateMode.Bottom, 0],
        /*11*/
        [PWMPhaseCorrect, TopOCRA, OCRUpdateMode.Top, TOVUpdateMode.Bottom, OCToggle],
        /*12*/
        [CTC, TopICR, OCRUpdateMode.Immediate, TOVUpdateMode.Max, 0],
        /*13*/
        [Reserved, 65535, OCRUpdateMode.Immediate, TOVUpdateMode.Max, 0],
        /*14*/
        [FastPWM, TopICR, OCRUpdateMode.Bottom, TOVUpdateMode.Top, OCToggle],
        /*15*/
        [FastPWM, TopOCRA, OCRUpdateMode.Bottom, TOVUpdateMode.Top, OCToggle]
      ];
      function compToOverride(comp) {
        switch (comp) {
          case 1:
            return gpio_1.PinOverrideMode.Toggle;
          case 2:
            return gpio_1.PinOverrideMode.Clear;
          case 3:
            return gpio_1.PinOverrideMode.Set;
          default:
            return gpio_1.PinOverrideMode.Enable;
        }
      }
      var FOCA = 1 << 7;
      var FOCB = 1 << 6;
      var FOCC = 1 << 5;
      var AVRTimer2 = class {
        constructor(cpu, config) {
          this.cpu = cpu;
          this.config = config;
          this.MAX = this.config.bits === 16 ? 65535 : 255;
          this.lastCycle = 0;
          this.ocrA = 0;
          this.nextOcrA = 0;
          this.ocrB = 0;
          this.nextOcrB = 0;
          this.hasOCRC = this.config.OCRC > 0;
          this.ocrC = 0;
          this.nextOcrC = 0;
          this.ocrUpdateMode = OCRUpdateMode.Immediate;
          this.tovUpdateMode = TOVUpdateMode.Max;
          this.icr = 0;
          this.tcnt = 0;
          this.tcntNext = 0;
          this.tcntUpdated = false;
          this.updateDivider = false;
          this.countingUp = true;
          this.divider = 0;
          this.externalClockRisingEdge = false;
          this.highByteTemp = 0;
          this.OVF = {
            address: this.config.ovfInterrupt,
            flagRegister: this.config.TIFR,
            flagMask: this.config.TOV,
            enableRegister: this.config.TIMSK,
            enableMask: this.config.TOIE
          };
          this.OCFA = {
            address: this.config.compAInterrupt,
            flagRegister: this.config.TIFR,
            flagMask: this.config.OCFA,
            enableRegister: this.config.TIMSK,
            enableMask: this.config.OCIEA
          };
          this.OCFB = {
            address: this.config.compBInterrupt,
            flagRegister: this.config.TIFR,
            flagMask: this.config.OCFB,
            enableRegister: this.config.TIMSK,
            enableMask: this.config.OCIEB
          };
          this.OCFC = {
            address: this.config.compCInterrupt,
            flagRegister: this.config.TIFR,
            flagMask: this.config.OCFC,
            enableRegister: this.config.TIMSK,
            enableMask: this.config.OCIEC
          };
          this.count = (reschedule = true, external = false) => {
            const { divider, lastCycle, cpu: cpu2 } = this;
            const { cycles } = cpu2;
            const delta = cycles - lastCycle;
            if (divider && delta >= divider || external) {
              const counterDelta = external ? 1 : Math.floor(delta / divider);
              this.lastCycle += counterDelta * divider;
              const val = this.tcnt;
              const { timerMode, TOP } = this;
              const phasePwm = timerMode === PWMPhaseCorrect || timerMode === PWMPhaseFrequencyCorrect;
              const newVal = phasePwm ? this.phasePwmCount(val, counterDelta) : (val + counterDelta) % (TOP + 1);
              const overflow = val + counterDelta > TOP;
              if (!this.tcntUpdated) {
                this.tcnt = newVal;
                if (!phasePwm) {
                  this.timerUpdated(newVal, val);
                }
              }
              if (!phasePwm) {
                if (timerMode === FastPWM && overflow) {
                  const { compA, compB } = this;
                  if (compA) {
                    this.updateCompPin(compA, "A", true);
                  }
                  if (compB) {
                    this.updateCompPin(compB, "B", true);
                  }
                }
                if (this.ocrUpdateMode == OCRUpdateMode.Bottom && overflow) {
                  this.ocrA = this.nextOcrA;
                  this.ocrB = this.nextOcrB;
                  this.ocrC = this.nextOcrC;
                }
                if (overflow && (this.tovUpdateMode == TOVUpdateMode.Top || TOP === this.MAX)) {
                  cpu2.setInterruptFlag(this.OVF);
                }
              }
            }
            if (this.tcntUpdated) {
              this.tcnt = this.tcntNext;
              this.tcntUpdated = false;
              if (this.tcnt === 0 && this.ocrUpdateMode === OCRUpdateMode.Bottom || this.tcnt === this.TOP && this.ocrUpdateMode === OCRUpdateMode.Top) {
                this.ocrA = this.nextOcrA;
                this.ocrB = this.nextOcrB;
                this.ocrC = this.nextOcrC;
              }
            }
            if (this.updateDivider) {
              const { CS: CS2 } = this;
              const { externalClockPin } = this.config;
              const newDivider = this.config.dividers[CS2];
              this.lastCycle = newDivider ? this.cpu.cycles : 0;
              this.updateDivider = false;
              this.divider = newDivider;
              if (this.config.externalClockPort && !this.externalClockPort) {
                this.externalClockPort = this.cpu.gpioByPort[this.config.externalClockPort];
              }
              if (this.externalClockPort) {
                this.externalClockPort.externalClockListeners[externalClockPin] = null;
              }
              if (newDivider) {
                cpu2.addClockEvent(this.count, this.lastCycle + newDivider - cpu2.cycles);
              } else if (this.externalClockPort && (CS2 === ExternalClockMode.FallingEdge || CS2 === ExternalClockMode.RisingEdge)) {
                this.externalClockPort.externalClockListeners[externalClockPin] = this.externalClockCallback;
                this.externalClockRisingEdge = CS2 === ExternalClockMode.RisingEdge;
              }
              return;
            }
            if (reschedule && divider) {
              cpu2.addClockEvent(this.count, this.lastCycle + divider - cpu2.cycles);
            }
          };
          this.externalClockCallback = (value) => {
            if (value === this.externalClockRisingEdge) {
              this.count(false, true);
            }
          };
          this.updateWGMConfig();
          this.cpu.readHooks[config.TCNT] = (addr) => {
            this.count(false);
            if (this.config.bits === 16) {
              this.cpu.data[addr + 1] = this.tcnt >> 8;
            }
            return this.cpu.data[addr] = this.tcnt & 255;
          };
          this.cpu.writeHooks[config.TCNT] = (value) => {
            this.tcntNext = this.highByteTemp << 8 | value;
            this.countingUp = true;
            this.tcntUpdated = true;
            this.cpu.updateClockEvent(this.count, 0);
            if (this.divider) {
              this.timerUpdated(this.tcntNext, this.tcntNext);
            }
          };
          this.cpu.writeHooks[config.OCRA] = (value) => {
            this.nextOcrA = this.highByteTemp << 8 | value;
            if (this.ocrUpdateMode === OCRUpdateMode.Immediate) {
              this.ocrA = this.nextOcrA;
            }
          };
          this.cpu.writeHooks[config.OCRB] = (value) => {
            this.nextOcrB = this.highByteTemp << 8 | value;
            if (this.ocrUpdateMode === OCRUpdateMode.Immediate) {
              this.ocrB = this.nextOcrB;
            }
          };
          if (this.hasOCRC) {
            this.cpu.writeHooks[config.OCRC] = (value) => {
              this.nextOcrC = this.highByteTemp << 8 | value;
              if (this.ocrUpdateMode === OCRUpdateMode.Immediate) {
                this.ocrC = this.nextOcrC;
              }
            };
          }
          if (this.config.bits === 16) {
            this.cpu.writeHooks[config.ICR] = (value) => {
              this.icr = this.highByteTemp << 8 | value;
            };
            const updateTempRegister = (value) => {
              this.highByteTemp = value;
            };
            const updateOCRHighRegister = (value, old, addr) => {
              this.highByteTemp = value & this.ocrMask >> 8;
              cpu.data[addr] = this.highByteTemp;
              return true;
            };
            this.cpu.writeHooks[config.TCNT + 1] = updateTempRegister;
            this.cpu.writeHooks[config.OCRA + 1] = updateOCRHighRegister;
            this.cpu.writeHooks[config.OCRB + 1] = updateOCRHighRegister;
            if (this.hasOCRC) {
              this.cpu.writeHooks[config.OCRC + 1] = updateOCRHighRegister;
            }
            this.cpu.writeHooks[config.ICR + 1] = updateTempRegister;
          }
          cpu.writeHooks[config.TCCRA] = (value) => {
            this.cpu.data[config.TCCRA] = value;
            this.updateWGMConfig();
            return true;
          };
          cpu.writeHooks[config.TCCRB] = (value) => {
            if (!config.TCCRC) {
              this.checkForceCompare(value);
              value &= ~(FOCA | FOCB);
            }
            this.cpu.data[config.TCCRB] = value;
            this.updateDivider = true;
            this.cpu.clearClockEvent(this.count);
            this.cpu.addClockEvent(this.count, 0);
            this.updateWGMConfig();
            return true;
          };
          if (config.TCCRC) {
            cpu.writeHooks[config.TCCRC] = (value) => {
              this.checkForceCompare(value);
            };
          }
          cpu.writeHooks[config.TIFR] = (value) => {
            this.cpu.data[config.TIFR] = value;
            this.cpu.clearInterruptByFlag(this.OVF, value);
            this.cpu.clearInterruptByFlag(this.OCFA, value);
            this.cpu.clearInterruptByFlag(this.OCFB, value);
            return true;
          };
          cpu.writeHooks[config.TIMSK] = (value) => {
            this.cpu.updateInterruptEnable(this.OVF, value);
            this.cpu.updateInterruptEnable(this.OCFA, value);
            this.cpu.updateInterruptEnable(this.OCFB, value);
          };
        }
        reset() {
          this.divider = 0;
          this.lastCycle = 0;
          this.ocrA = 0;
          this.nextOcrA = 0;
          this.ocrB = 0;
          this.nextOcrB = 0;
          this.ocrC = 0;
          this.nextOcrC = 0;
          this.icr = 0;
          this.tcnt = 0;
          this.tcntNext = 0;
          this.tcntUpdated = false;
          this.countingUp = false;
          this.updateDivider = true;
        }
        get TCCRA() {
          return this.cpu.data[this.config.TCCRA];
        }
        get TCCRB() {
          return this.cpu.data[this.config.TCCRB];
        }
        get TIMSK() {
          return this.cpu.data[this.config.TIMSK];
        }
        get CS() {
          return this.TCCRB & 7;
        }
        get WGM() {
          const mask = this.config.bits === 16 ? 24 : 8;
          return (this.TCCRB & mask) >> 1 | this.TCCRA & 3;
        }
        get TOP() {
          switch (this.topValue) {
            case TopOCRA:
              return this.ocrA;
            case TopICR:
              return this.icr;
            default:
              return this.topValue;
          }
        }
        get ocrMask() {
          switch (this.topValue) {
            case TopOCRA:
            case TopICR:
              return 65535;
            default:
              return this.topValue;
          }
        }
        /** Expose the raw value of TCNT, for use by the unit tests */
        get debugTCNT() {
          return this.tcnt;
        }
        updateWGMConfig() {
          const { config, WGM } = this;
          const wgmModes = config.bits === 16 ? wgmModes16Bit : wgmModes8Bit;
          const TCCRA = this.cpu.data[config.TCCRA];
          const [timerMode, topValue, ocrUpdateMode, tovUpdateMode, flags] = wgmModes[WGM];
          this.timerMode = timerMode;
          this.topValue = topValue;
          this.ocrUpdateMode = ocrUpdateMode;
          this.tovUpdateMode = tovUpdateMode;
          const pwmMode = timerMode === FastPWM || timerMode === PWMPhaseCorrect || timerMode === PWMPhaseFrequencyCorrect;
          const prevCompA = this.compA;
          this.compA = TCCRA >> 6 & 3;
          if (this.compA === 1 && pwmMode && !(flags & OCToggle)) {
            this.compA = 0;
          }
          if (!!prevCompA !== !!this.compA) {
            this.updateCompA(this.compA ? gpio_1.PinOverrideMode.Enable : gpio_1.PinOverrideMode.None);
          }
          const prevCompB = this.compB;
          this.compB = TCCRA >> 4 & 3;
          if (this.compB === 1 && pwmMode) {
            this.compB = 0;
          }
          if (!!prevCompB !== !!this.compB) {
            this.updateCompB(this.compB ? gpio_1.PinOverrideMode.Enable : gpio_1.PinOverrideMode.None);
          }
          if (this.hasOCRC) {
            const prevCompC = this.compC;
            this.compC = TCCRA >> 2 & 3;
            if (this.compC === 1 && pwmMode) {
              this.compC = 0;
            }
            if (!!prevCompC !== !!this.compC) {
              this.updateCompC(this.compC ? gpio_1.PinOverrideMode.Enable : gpio_1.PinOverrideMode.None);
            }
          }
        }
        phasePwmCount(value, delta) {
          const { ocrA, ocrB, ocrC, hasOCRC, TOP, MAX, tcntUpdated } = this;
          if (!value && !TOP) {
            delta = 0;
            if (this.ocrUpdateMode === OCRUpdateMode.Top) {
              this.ocrA = this.nextOcrA;
              this.ocrB = this.nextOcrB;
              this.ocrC = this.nextOcrC;
            }
          }
          while (delta > 0) {
            if (this.countingUp) {
              value++;
              if (value === TOP && !tcntUpdated) {
                this.countingUp = false;
                if (this.ocrUpdateMode === OCRUpdateMode.Top) {
                  this.ocrA = this.nextOcrA;
                  this.ocrB = this.nextOcrB;
                  this.ocrC = this.nextOcrC;
                }
              }
            } else {
              value--;
              if (!value && !tcntUpdated) {
                this.countingUp = true;
                this.cpu.setInterruptFlag(this.OVF);
                if (this.ocrUpdateMode === OCRUpdateMode.Bottom) {
                  this.ocrA = this.nextOcrA;
                  this.ocrB = this.nextOcrB;
                  this.ocrC = this.nextOcrC;
                }
              }
            }
            if (!tcntUpdated) {
              if (value === ocrA) {
                this.cpu.setInterruptFlag(this.OCFA);
                if (this.compA) {
                  this.updateCompPin(this.compA, "A");
                }
              }
              if (value === ocrB) {
                this.cpu.setInterruptFlag(this.OCFB);
                if (this.compB) {
                  this.updateCompPin(this.compB, "B");
                }
              }
              if (hasOCRC && value === ocrC) {
                this.cpu.setInterruptFlag(this.OCFC);
                if (this.compC) {
                  this.updateCompPin(this.compC, "C");
                }
              }
            }
            delta--;
          }
          return value & MAX;
        }
        timerUpdated(value, prevValue) {
          const { ocrA, ocrB, ocrC, hasOCRC } = this;
          const overflow = prevValue > value;
          if ((prevValue < ocrA || overflow) && value >= ocrA || prevValue < ocrA && overflow) {
            this.cpu.setInterruptFlag(this.OCFA);
            if (this.compA) {
              this.updateCompPin(this.compA, "A");
            }
          }
          if ((prevValue < ocrB || overflow) && value >= ocrB || prevValue < ocrB && overflow) {
            this.cpu.setInterruptFlag(this.OCFB);
            if (this.compB) {
              this.updateCompPin(this.compB, "B");
            }
          }
          if (hasOCRC && ((prevValue < ocrC || overflow) && value >= ocrC || prevValue < ocrC && overflow)) {
            this.cpu.setInterruptFlag(this.OCFC);
            if (this.compC) {
              this.updateCompPin(this.compC, "C");
            }
          }
        }
        checkForceCompare(value) {
          if (this.timerMode == TimerMode2.FastPWM || this.timerMode == TimerMode2.PWMPhaseCorrect || this.timerMode == TimerMode2.PWMPhaseFrequencyCorrect) {
            return;
          }
          if (value & FOCA) {
            this.updateCompPin(this.compA, "A");
          }
          if (value & FOCB) {
            this.updateCompPin(this.compB, "B");
          }
          if (this.config.compPortC && value & FOCC) {
            this.updateCompPin(this.compC, "C");
          }
        }
        updateCompPin(compValue, pinName, bottom = false) {
          let newValue = gpio_1.PinOverrideMode.None;
          const invertingMode = compValue === 3;
          const isSet = this.countingUp === invertingMode;
          switch (this.timerMode) {
            case Normal:
            case CTC:
              newValue = compToOverride(compValue);
              break;
            case FastPWM:
              if (compValue === 1) {
                newValue = bottom ? gpio_1.PinOverrideMode.None : gpio_1.PinOverrideMode.Toggle;
              } else {
                newValue = invertingMode !== bottom ? gpio_1.PinOverrideMode.Set : gpio_1.PinOverrideMode.Clear;
              }
              break;
            case PWMPhaseCorrect:
            case PWMPhaseFrequencyCorrect:
              if (compValue === 1) {
                newValue = gpio_1.PinOverrideMode.Toggle;
              } else {
                newValue = isSet ? gpio_1.PinOverrideMode.Set : gpio_1.PinOverrideMode.Clear;
              }
              break;
          }
          if (newValue !== gpio_1.PinOverrideMode.None) {
            if (pinName === "A") {
              this.updateCompA(newValue);
            } else if (pinName === "B") {
              this.updateCompB(newValue);
            } else {
              this.updateCompC(newValue);
            }
          }
        }
        updateCompA(value) {
          const { compPortA, compPinA } = this.config;
          const port = this.cpu.gpioByPort[compPortA];
          port === null || port === void 0 ? void 0 : port.timerOverridePin(compPinA, value);
        }
        updateCompB(value) {
          const { compPortB, compPinB } = this.config;
          const port = this.cpu.gpioByPort[compPortB];
          port === null || port === void 0 ? void 0 : port.timerOverridePin(compPinB, value);
        }
        updateCompC(value) {
          const { compPortC, compPinC } = this.config;
          const port = this.cpu.gpioByPort[compPortC];
          port === null || port === void 0 ? void 0 : port.timerOverridePin(compPinC, value);
        }
      };
      exports.AVRTimer = AVRTimer2;
    }
  });

  // tools/programmable_simulator/node_modules/avr8js/dist/cjs/peripherals/timer-attiny.js
  var require_timer_attiny = __commonJS({
    "tools/programmable_simulator/node_modules/avr8js/dist/cjs/peripherals/timer-attiny.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", { value: true });
      exports.ATtinyTimer1 = exports.attinyTimer1Config = void 0;
      var gpio_1 = require_gpio();
      var CTC1 = 1 << 7;
      var PWM1A = 1 << 6;
      var CS_MASK = 15;
      var PWM1B_BIT = 1 << 6;
      var FOC1B = 1 << 3;
      var FOC1A = 1 << 2;
      var PSR1 = 1 << 1;
      exports.attinyTimer1Config = {
        TCCR1: 80,
        GTCCR: 76,
        TCNT1: 79,
        OCR1A: 78,
        OCR1B: 75,
        OCR1C: 77,
        TIFR: 88,
        TIMSK: 89,
        ovfInterrupt: 4,
        compAInterrupt: 3,
        compBInterrupt: 9,
        TOV1: 1 << 2,
        OCF1A: 1 << 6,
        OCF1B: 1 << 5,
        TOIE1: 1 << 2,
        OCIE1A: 1 << 6,
        OCIE1B: 1 << 5,
        compPortB: 56,
        compPinA: 1,
        // PB1
        compPinB: 4,
        // PB4
        dividers: {
          0: 0,
          1: 1,
          2: 2,
          3: 4,
          4: 8,
          5: 16,
          6: 32,
          7: 64,
          8: 128,
          9: 256,
          10: 512,
          11: 1024,
          12: 2048,
          13: 4096,
          14: 8192,
          15: 16384
        }
      };
      var ATtinyTimer1 = class {
        constructor(cpu, config) {
          this.cpu = cpu;
          this.config = config;
          this.lastCycle = 0;
          this.tcnt = 0;
          this.tcntNext = 0;
          this.tcntUpdated = false;
          this.ocrA = 0;
          this.ocrB = 0;
          this.ocrC = 0;
          this.divider = 0;
          this.updateDivider = false;
          this.countingUp = true;
          this.OVF = {
            address: this.config.ovfInterrupt,
            flagRegister: this.config.TIFR,
            flagMask: this.config.TOV1,
            enableRegister: this.config.TIMSK,
            enableMask: this.config.TOIE1
          };
          this.OCFA = {
            address: this.config.compAInterrupt,
            flagRegister: this.config.TIFR,
            flagMask: this.config.OCF1A,
            enableRegister: this.config.TIMSK,
            enableMask: this.config.OCIE1A
          };
          this.OCFB = {
            address: this.config.compBInterrupt,
            flagRegister: this.config.TIFR,
            flagMask: this.config.OCF1B,
            enableRegister: this.config.TIMSK,
            enableMask: this.config.OCIE1B
          };
          this.count = (reschedule = true) => {
            var _a;
            const { divider, lastCycle, cpu: cpu2 } = this;
            const { cycles } = cpu2;
            const delta = cycles - lastCycle;
            if (divider && delta >= divider) {
              const counterDelta = Math.floor(delta / divider);
              this.lastCycle += counterDelta * divider;
              const val = this.tcnt;
              const top = this.TOP;
              const phasePwm = (this.pwmA || this.pwmB) && !this.ctcMode;
              const newVal = phasePwm ? this.phasePwmCount(val, counterDelta) : (val + counterDelta) % (top + 1);
              const overflow = val + counterDelta > top;
              if (!this.tcntUpdated) {
                this.tcnt = newVal;
                if (!phasePwm) {
                  this.timerUpdated(newVal, val);
                }
              }
              if (!phasePwm && overflow) {
                cpu2.setInterruptFlag(this.OVF);
              }
            }
            if (this.tcntUpdated) {
              this.tcnt = this.tcntNext;
              this.tcntUpdated = false;
            }
            if (this.updateDivider) {
              const cs = this.CS;
              const newDivider = (_a = this.config.dividers[cs]) !== null && _a !== void 0 ? _a : 0;
              this.lastCycle = newDivider ? this.cpu.cycles : 0;
              this.updateDivider = false;
              this.divider = newDivider;
              if (newDivider) {
                cpu2.addClockEvent(this.count, this.lastCycle + newDivider - cpu2.cycles);
              }
              return;
            }
            if (reschedule && divider) {
              cpu2.addClockEvent(this.count, this.lastCycle + divider - cpu2.cycles);
            }
          };
          const { TCCR1, GTCCR, TCNT1, OCR1A, OCR1B, OCR1C, TIFR, TIMSK } = config;
          cpu.readHooks[TCNT1] = () => {
            this.count(false);
            return cpu.data[TCNT1] = this.tcnt & 255;
          };
          cpu.writeHooks[TCNT1] = (value) => {
            this.tcntNext = value;
            this.countingUp = true;
            this.tcntUpdated = true;
            cpu.updateClockEvent(this.count, 0);
            if (this.divider) {
              this.timerUpdated(this.tcntNext, this.tcntNext);
            }
          };
          cpu.writeHooks[OCR1A] = (value) => {
            this.ocrA = value;
          };
          cpu.writeHooks[OCR1B] = (value) => {
            this.ocrB = value;
          };
          cpu.writeHooks[OCR1C] = (value) => {
            this.ocrC = value;
          };
          cpu.writeHooks[TCCR1] = (value) => {
            cpu.data[TCCR1] = value;
            this.updateDivider = true;
            cpu.clearClockEvent(this.count);
            cpu.addClockEvent(this.count, 0);
            this.updateCompConfig();
            return true;
          };
          const prevGtccrHook = cpu.writeHooks[GTCCR];
          cpu.writeHooks[GTCCR] = (value, oldValue, addr, mask) => {
            if (value & FOC1A) {
              this.forceCompare("A");
            }
            if (value & FOC1B) {
              this.forceCompare("B");
            }
            if (value & PSR1) {
              this.lastCycle = this.cpu.cycles;
            }
            value &= ~(FOC1A | FOC1B | PSR1);
            if (prevGtccrHook) {
              prevGtccrHook(value, oldValue, addr, mask);
            } else {
              cpu.data[GTCCR] = value;
            }
            this.updateCompConfig();
            return true;
          };
          const prevTifrHook = cpu.writeHooks[TIFR];
          cpu.writeHooks[TIFR] = (value, oldValue, addr, mask) => {
            if (prevTifrHook) {
              prevTifrHook(value, oldValue, addr, mask);
            } else {
              cpu.data[TIFR] = value;
            }
            cpu.clearInterruptByFlag(this.OVF, value);
            cpu.clearInterruptByFlag(this.OCFA, value);
            cpu.clearInterruptByFlag(this.OCFB, value);
            return true;
          };
          const prevTimskHook = cpu.writeHooks[TIMSK];
          cpu.writeHooks[TIMSK] = (value, oldValue, addr, mask) => {
            if (prevTimskHook) {
              prevTimskHook(value, oldValue, addr, mask);
            }
            cpu.updateInterruptEnable(this.OVF, value);
            cpu.updateInterruptEnable(this.OCFA, value);
            cpu.updateInterruptEnable(this.OCFB, value);
          };
        }
        get tccr1() {
          return this.cpu.data[this.config.TCCR1];
        }
        get gtccr() {
          return this.cpu.data[this.config.GTCCR];
        }
        get CS() {
          return this.tccr1 & CS_MASK;
        }
        get ctcMode() {
          return !!(this.tccr1 & CTC1);
        }
        get pwmA() {
          return !!(this.tccr1 & PWM1A);
        }
        get pwmB() {
          return !!(this.gtccr & PWM1B_BIT);
        }
        get comA() {
          return this.tccr1 >> 4 & 3;
        }
        get comB() {
          return this.gtccr >> 4 & 3;
        }
        /** TOP = OCR1C in CTC/PWM modes, 0xFF in Normal mode */
        get TOP() {
          if (this.ctcMode || this.pwmA || this.pwmB) {
            return this.ocrC;
          }
          return 255;
        }
        phasePwmCount(value, delta) {
          const top = this.TOP;
          while (delta > 0) {
            if (this.countingUp) {
              value++;
              if (value >= top) {
                value = top;
                this.countingUp = false;
              }
            } else {
              value--;
              if (value <= 0) {
                value = 0;
                this.countingUp = true;
                this.cpu.setInterruptFlag(this.OVF);
              }
            }
            if (!this.tcntUpdated) {
              if (value === this.ocrA) {
                this.cpu.setInterruptFlag(this.OCFA);
                this.updateCompPinPwm("A");
              }
              if (value === this.ocrB) {
                this.cpu.setInterruptFlag(this.OCFB);
                this.updateCompPinPwm("B");
              }
            }
            delta--;
          }
          return value & 255;
        }
        timerUpdated(value, prevValue) {
          const { ocrA, ocrB } = this;
          const overflow = prevValue > value;
          if ((prevValue < ocrA || overflow) && value >= ocrA || prevValue < ocrA && overflow) {
            this.cpu.setInterruptFlag(this.OCFA);
            if (this.comA && !this.pwmA) {
              this.updateCompPinNonPwm("A");
            }
          }
          if ((prevValue < ocrB || overflow) && value >= ocrB || prevValue < ocrB && overflow) {
            this.cpu.setInterruptFlag(this.OCFB);
            if (this.comB && !this.pwmB) {
              this.updateCompPinNonPwm("B");
            }
          }
        }
        forceCompare(channel) {
          if (channel === "A" && !this.pwmA && this.comA) {
            this.updateCompPinNonPwm("A");
          } else if (channel === "B" && !this.pwmB && this.comB) {
            this.updateCompPinNonPwm("B");
          }
        }
        updateCompPinNonPwm(channel) {
          var _a;
          const com = channel === "A" ? this.comA : this.comB;
          const pin = channel === "A" ? this.config.compPinA : this.config.compPinB;
          let mode;
          switch (com) {
            case 1:
              mode = gpio_1.PinOverrideMode.Toggle;
              break;
            case 2:
              mode = gpio_1.PinOverrideMode.Clear;
              break;
            case 3:
              mode = gpio_1.PinOverrideMode.Set;
              break;
            default:
              return;
          }
          (_a = this.cpu.gpioByPort[this.config.compPortB]) === null || _a === void 0 ? void 0 : _a.timerOverridePin(pin, mode);
        }
        updateCompPinPwm(channel) {
          var _a;
          const com = channel === "A" ? this.comA : this.comB;
          const pin = channel === "A" ? this.config.compPinA : this.config.compPinB;
          const invertingMode = com === 3;
          const isSet = this.countingUp === invertingMode;
          let mode;
          switch (com) {
            case 1:
              mode = gpio_1.PinOverrideMode.Toggle;
              break;
            case 2:
            case 3:
              mode = isSet ? gpio_1.PinOverrideMode.Set : gpio_1.PinOverrideMode.Clear;
              break;
            default:
              return;
          }
          (_a = this.cpu.gpioByPort[this.config.compPortB]) === null || _a === void 0 ? void 0 : _a.timerOverridePin(pin, mode);
        }
        updateCompConfig() {
          const port = this.cpu.gpioByPort[this.config.compPortB];
          if (!port)
            return;
          port.timerOverridePin(this.config.compPinA, this.comA ? gpio_1.PinOverrideMode.Enable : gpio_1.PinOverrideMode.None);
          port.timerOverridePin(this.config.compPinB, this.comB ? gpio_1.PinOverrideMode.Enable : gpio_1.PinOverrideMode.None);
        }
      };
      exports.ATtinyTimer1 = ATtinyTimer1;
    }
  });

  // tools/programmable_simulator/node_modules/avr8js/dist/cjs/peripherals/twi.js
  var require_twi = __commonJS({
    "tools/programmable_simulator/node_modules/avr8js/dist/cjs/peripherals/twi.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", { value: true });
      exports.AVRTWI = exports.NoopTWIEventHandler = exports.twiConfig = void 0;
      var TWCR_TWINT = 128;
      var TWCR_TWEA = 64;
      var TWCR_TWSTA = 32;
      var TWCR_TWSTO = 16;
      var TWCR_TWEN = 4;
      var TWCR_TWIE = 1;
      var TWSR_TWS_MASK = 248;
      var TWSR_TWPS1 = 2;
      var TWSR_TWPS0 = 1;
      var TWSR_TWPS_MASK = TWSR_TWPS1 | TWSR_TWPS0;
      var STATUS_TWI_IDLE = 248;
      var STATUS_START = 8;
      var STATUS_REPEATED_START = 16;
      var STATUS_SLAW_ACK = 24;
      var STATUS_SLAW_NACK = 32;
      var STATUS_DATA_SENT_ACK = 40;
      var STATUS_DATA_SENT_NACK = 48;
      var STATUS_SLAR_ACK = 64;
      var STATUS_SLAR_NACK = 72;
      var STATUS_DATA_RECEIVED_ACK = 80;
      var STATUS_DATA_RECEIVED_NACK = 88;
      exports.twiConfig = {
        twiInterrupt: 48,
        TWBR: 184,
        TWSR: 185,
        TWAR: 186,
        TWDR: 187,
        TWCR: 188,
        TWAMR: 189
      };
      var NoopTWIEventHandler = class {
        constructor(twi) {
          this.twi = twi;
        }
        start() {
          this.twi.completeStart();
        }
        stop() {
          this.twi.completeStop();
        }
        connectToSlave() {
          this.twi.completeConnect(false);
        }
        writeByte() {
          this.twi.completeWrite(false);
        }
        readByte() {
          this.twi.completeRead(255);
        }
      };
      exports.NoopTWIEventHandler = NoopTWIEventHandler;
      var AVRTWI2 = class {
        constructor(cpu, config, freqHz) {
          this.cpu = cpu;
          this.config = config;
          this.freqHz = freqHz;
          this.eventHandler = new NoopTWIEventHandler(this);
          this.busy = false;
          this.TWI = {
            address: this.config.twiInterrupt,
            flagRegister: this.config.TWCR,
            flagMask: TWCR_TWINT,
            enableRegister: this.config.TWCR,
            enableMask: TWCR_TWIE
          };
          this.updateStatus(STATUS_TWI_IDLE);
          this.cpu.writeHooks[config.TWCR] = (value) => {
            this.cpu.data[config.TWCR] = value;
            const clearInt = value & TWCR_TWINT;
            this.cpu.clearInterruptByFlag(this.TWI, value);
            this.cpu.updateInterruptEnable(this.TWI, value);
            const { status } = this;
            if (clearInt && value & TWCR_TWEN && !this.busy) {
              const twdrValue = this.cpu.data[this.config.TWDR];
              this.cpu.addClockEvent(() => {
                if (value & TWCR_TWSTA) {
                  this.busy = true;
                  this.eventHandler.start(status !== STATUS_TWI_IDLE);
                } else if (value & TWCR_TWSTO) {
                  this.busy = true;
                  this.eventHandler.stop();
                } else if (status === STATUS_START || status === STATUS_REPEATED_START) {
                  this.busy = true;
                  this.eventHandler.connectToSlave(twdrValue >> 1, twdrValue & 1 ? false : true);
                } else if (status === STATUS_SLAW_ACK || status === STATUS_DATA_SENT_ACK) {
                  this.busy = true;
                  this.eventHandler.writeByte(twdrValue);
                } else if (status === STATUS_SLAR_ACK || status === STATUS_DATA_RECEIVED_ACK) {
                  this.busy = true;
                  const ack = !!(value & TWCR_TWEA);
                  this.eventHandler.readByte(ack);
                }
              }, 0);
              return true;
            }
          };
        }
        get prescaler() {
          switch (this.cpu.data[this.config.TWSR] & TWSR_TWPS_MASK) {
            case 0:
              return 1;
            case 1:
              return 4;
            case 2:
              return 16;
            case 3:
              return 64;
          }
          throw new Error("Invalid prescaler value!");
        }
        get sclFrequency() {
          return this.freqHz / (16 + 2 * this.cpu.data[this.config.TWBR] * this.prescaler);
        }
        completeStart() {
          this.busy = false;
          this.updateStatus(this.status === STATUS_TWI_IDLE ? STATUS_START : STATUS_REPEATED_START);
        }
        completeStop() {
          this.busy = false;
          this.cpu.data[this.config.TWCR] &= ~TWCR_TWSTO;
          this.updateStatus(STATUS_TWI_IDLE);
        }
        completeConnect(ack) {
          this.busy = false;
          if (this.cpu.data[this.config.TWDR] & 1) {
            this.updateStatus(ack ? STATUS_SLAR_ACK : STATUS_SLAR_NACK);
          } else {
            this.updateStatus(ack ? STATUS_SLAW_ACK : STATUS_SLAW_NACK);
          }
        }
        completeWrite(ack) {
          this.busy = false;
          this.updateStatus(ack ? STATUS_DATA_SENT_ACK : STATUS_DATA_SENT_NACK);
        }
        completeRead(value) {
          this.busy = false;
          const ack = !!(this.cpu.data[this.config.TWCR] & TWCR_TWEA);
          this.cpu.data[this.config.TWDR] = value;
          this.updateStatus(ack ? STATUS_DATA_RECEIVED_ACK : STATUS_DATA_RECEIVED_NACK);
        }
        get status() {
          return this.cpu.data[this.config.TWSR] & TWSR_TWS_MASK;
        }
        updateStatus(value) {
          const { TWSR } = this.config;
          this.cpu.data[TWSR] = this.cpu.data[TWSR] & ~TWSR_TWS_MASK | value;
          this.cpu.setInterruptFlag(this.TWI);
        }
      };
      exports.AVRTWI = AVRTWI2;
    }
  });

  // tools/programmable_simulator/node_modules/avr8js/dist/cjs/peripherals/usart.js
  var require_usart = __commonJS({
    "tools/programmable_simulator/node_modules/avr8js/dist/cjs/peripherals/usart.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", { value: true });
      exports.AVRUSART = exports.usart0Config = void 0;
      exports.usart0Config = {
        rxCompleteInterrupt: 36,
        dataRegisterEmptyInterrupt: 38,
        txCompleteInterrupt: 40,
        UCSRA: 192,
        UCSRB: 193,
        UCSRC: 194,
        UBRRL: 196,
        UBRRH: 197,
        UDR: 198
      };
      var UCSRA_RXC = 128;
      var UCSRA_TXC = 64;
      var UCSRA_UDRE = 32;
      var UCSRA_U2X = 2;
      var UCSRA_MPCM = 1;
      var UCSRA_CFG_MASK = UCSRA_U2X;
      var UCSRB_RXCIE = 128;
      var UCSRB_TXCIE = 64;
      var UCSRB_UDRIE = 32;
      var UCSRB_RXEN = 16;
      var UCSRB_TXEN = 8;
      var UCSRB_UCSZ2 = 4;
      var UCSRB_CFG_MASK = UCSRB_UCSZ2 | UCSRB_RXEN | UCSRB_TXEN;
      var UCSRC_UPM1 = 32;
      var UCSRC_UPM0 = 16;
      var UCSRC_USBS = 8;
      var UCSRC_UCSZ1 = 4;
      var UCSRC_UCSZ0 = 2;
      var rxMasks = {
        5: 31,
        6: 63,
        7: 127,
        8: 255,
        9: 255
      };
      var AVRUSART2 = class {
        constructor(cpu, config, freqHz) {
          this.cpu = cpu;
          this.config = config;
          this.freqHz = freqHz;
          this.onByteTransmit = null;
          this.onLineTransmit = null;
          this.onRxComplete = null;
          this.onConfigurationChange = null;
          this.rxBusyValue = false;
          this.rxByte = 0;
          this.lineBuffer = "";
          this.RXC = {
            address: this.config.rxCompleteInterrupt,
            flagRegister: this.config.UCSRA,
            flagMask: UCSRA_RXC,
            enableRegister: this.config.UCSRB,
            enableMask: UCSRB_RXCIE,
            constant: true
          };
          this.UDRE = {
            address: this.config.dataRegisterEmptyInterrupt,
            flagRegister: this.config.UCSRA,
            flagMask: UCSRA_UDRE,
            enableRegister: this.config.UCSRB,
            enableMask: UCSRB_UDRIE
          };
          this.TXC = {
            address: this.config.txCompleteInterrupt,
            flagRegister: this.config.UCSRA,
            flagMask: UCSRA_TXC,
            enableRegister: this.config.UCSRB,
            enableMask: UCSRB_TXCIE
          };
          this.reset();
          this.cpu.writeHooks[config.UCSRA] = (value, oldValue) => {
            var _a;
            cpu.data[config.UCSRA] = value & (UCSRA_MPCM | UCSRA_U2X);
            cpu.clearInterruptByFlag(this.TXC, value);
            if ((value & UCSRA_CFG_MASK) !== (oldValue & UCSRA_CFG_MASK)) {
              (_a = this.onConfigurationChange) === null || _a === void 0 ? void 0 : _a.call(this);
            }
            return true;
          };
          this.cpu.writeHooks[config.UCSRB] = (value, oldValue) => {
            var _a;
            cpu.updateInterruptEnable(this.RXC, value);
            cpu.updateInterruptEnable(this.UDRE, value);
            cpu.updateInterruptEnable(this.TXC, value);
            if (value & UCSRB_RXEN && oldValue & UCSRB_RXEN) {
              cpu.clearInterrupt(this.RXC);
            }
            if (value & UCSRB_TXEN && !(oldValue & UCSRB_TXEN)) {
              cpu.setInterruptFlag(this.UDRE);
            }
            cpu.data[config.UCSRB] = value;
            if ((value & UCSRB_CFG_MASK) !== (oldValue & UCSRB_CFG_MASK)) {
              (_a = this.onConfigurationChange) === null || _a === void 0 ? void 0 : _a.call(this);
            }
            return true;
          };
          this.cpu.writeHooks[config.UCSRC] = (value) => {
            var _a;
            cpu.data[config.UCSRC] = value;
            (_a = this.onConfigurationChange) === null || _a === void 0 ? void 0 : _a.call(this);
            return true;
          };
          this.cpu.readHooks[config.UDR] = () => {
            var _a;
            const mask = (_a = rxMasks[this.bitsPerChar]) !== null && _a !== void 0 ? _a : 255;
            const result = this.rxByte & mask;
            this.rxByte = 0;
            this.cpu.clearInterrupt(this.RXC);
            return result;
          };
          this.cpu.writeHooks[config.UDR] = (value) => {
            if (this.onByteTransmit) {
              this.onByteTransmit(value);
            }
            if (this.onLineTransmit) {
              const ch = String.fromCharCode(value);
              if (ch === "\n") {
                this.onLineTransmit(this.lineBuffer);
                this.lineBuffer = "";
              } else {
                this.lineBuffer += ch;
              }
            }
            this.cpu.addClockEvent(() => {
              cpu.setInterruptFlag(this.UDRE);
              cpu.setInterruptFlag(this.TXC);
            }, this.cyclesPerChar);
            this.cpu.clearInterrupt(this.TXC);
            this.cpu.clearInterrupt(this.UDRE);
          };
          this.cpu.writeHooks[config.UBRRH] = (value) => {
            var _a;
            this.cpu.data[config.UBRRH] = value;
            (_a = this.onConfigurationChange) === null || _a === void 0 ? void 0 : _a.call(this);
            return true;
          };
          this.cpu.writeHooks[config.UBRRL] = (value) => {
            var _a;
            this.cpu.data[config.UBRRL] = value;
            (_a = this.onConfigurationChange) === null || _a === void 0 ? void 0 : _a.call(this);
            return true;
          };
        }
        reset() {
          this.cpu.data[this.config.UCSRA] = UCSRA_UDRE;
          this.cpu.data[this.config.UCSRB] = 0;
          this.cpu.data[this.config.UCSRC] = UCSRC_UCSZ1 | UCSRC_UCSZ0;
          this.rxBusyValue = false;
          this.rxByte = 0;
          this.lineBuffer = "";
        }
        get rxBusy() {
          return this.rxBusyValue;
        }
        writeByte(value, immediate = false) {
          var _a;
          const { cpu } = this;
          if (this.rxBusyValue || !this.rxEnable) {
            return false;
          }
          if (immediate) {
            this.rxByte = value;
            cpu.setInterruptFlag(this.RXC);
            (_a = this.onRxComplete) === null || _a === void 0 ? void 0 : _a.call(this);
          } else {
            this.rxBusyValue = true;
            cpu.addClockEvent(() => {
              this.rxBusyValue = false;
              this.writeByte(value, true);
            }, this.cyclesPerChar);
            return true;
          }
        }
        get cyclesPerChar() {
          const symbolsPerChar = 1 + this.bitsPerChar + this.stopBits + (this.parityEnabled ? 1 : 0);
          return (this.UBRR + 1) * this.multiplier * symbolsPerChar;
        }
        get UBRR() {
          const { UBRRH, UBRRL } = this.config;
          return this.cpu.data[UBRRH] << 8 | this.cpu.data[UBRRL];
        }
        get multiplier() {
          return this.cpu.data[this.config.UCSRA] & UCSRA_U2X ? 8 : 16;
        }
        get rxEnable() {
          return !!(this.cpu.data[this.config.UCSRB] & UCSRB_RXEN);
        }
        get txEnable() {
          return !!(this.cpu.data[this.config.UCSRB] & UCSRB_TXEN);
        }
        get baudRate() {
          return Math.floor(this.freqHz / (this.multiplier * (1 + this.UBRR)));
        }
        get bitsPerChar() {
          const ucsz = (this.cpu.data[this.config.UCSRC] & (UCSRC_UCSZ1 | UCSRC_UCSZ0)) >> 1 | this.cpu.data[this.config.UCSRB] & UCSRB_UCSZ2;
          switch (ucsz) {
            case 0:
              return 5;
            case 1:
              return 6;
            case 2:
              return 7;
            case 3:
              return 8;
            default:
            // 4..6 are reserved
            case 7:
              return 9;
          }
        }
        get stopBits() {
          return this.cpu.data[this.config.UCSRC] & UCSRC_USBS ? 2 : 1;
        }
        get parityEnabled() {
          return this.cpu.data[this.config.UCSRC] & UCSRC_UPM1 ? true : false;
        }
        get parityOdd() {
          return this.cpu.data[this.config.UCSRC] & UCSRC_UPM0 ? true : false;
        }
      };
      exports.AVRUSART = AVRUSART2;
    }
  });

  // tools/programmable_simulator/node_modules/avr8js/dist/cjs/peripherals/usi.js
  var require_usi = __commonJS({
    "tools/programmable_simulator/node_modules/avr8js/dist/cjs/peripherals/usi.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", { value: true });
      exports.AVRUSI = void 0;
      var USICR = 45;
      var USISR = 46;
      var USIDR = 47;
      var USIBR = 48;
      var USICNT_MASK = 15;
      var USIDC = 1 << 4;
      var USIPF = 1 << 5;
      var USIOIF = 1 << 6;
      var USISIF = 1 << 7;
      var USITC = 1 << 0;
      var USICLK = 1 << 1;
      var USICS0 = 1 << 2;
      var USICS1 = 1 << 3;
      var USIWM0 = 1 << 4;
      var USIWM1 = 1 << 5;
      var USIOIE = 1 << 6;
      var USISIE = 1 << 7;
      var AVRUSI = class {
        constructor(cpu, port, portPin, dataPin, clockPin) {
          this.START = {
            address: 13,
            flagRegister: USISR,
            flagMask: USISIF,
            enableRegister: USICR,
            enableMask: USISIE
          };
          this.OVF = {
            address: 14,
            flagRegister: USISR,
            flagMask: USIOIF,
            enableRegister: USICR,
            enableMask: USIOIE
          };
          const PIN = portPin;
          const PORT = PIN + 2;
          port.addListener((value) => {
            const twoWire = (cpu.data[USICR] & USIWM1) === USIWM1;
            if (twoWire) {
              if (value & 1 << clockPin && !(value & 1 << dataPin)) {
                cpu.setInterruptFlag(this.START);
              }
              if (value & 1 << clockPin && value & 1 << dataPin) {
                cpu.data[USISR] |= USIPF;
              }
            }
          });
          const updateOutput = () => {
            const oldValue = cpu.data[PORT];
            const newValue = cpu.data[USIDR] & 128 ? oldValue | 1 << dataPin : oldValue & ~(1 << dataPin);
            cpu.writeHooks[PORT](newValue, oldValue, PORT, 255);
            if (newValue & 128 && !(cpu.data[PIN] & 128)) {
              cpu.data[USISR] |= USIDC;
            } else {
              cpu.data[USISR] &= ~USIDC;
            }
          };
          const count = () => {
            const counter = cpu.data[USISR] + 1 & USICNT_MASK;
            cpu.data[USISR] = cpu.data[USISR] & ~USICNT_MASK | counter;
            if (!counter) {
              cpu.data[USIBR] = cpu.data[USIDR];
              cpu.setInterruptFlag(this.OVF);
            }
          };
          const shift = (inputValue) => {
            cpu.data[USIDR] = cpu.data[USIDR] << 1 | inputValue;
            updateOutput();
          };
          cpu.writeHooks[USIDR] = (value) => {
            cpu.data[USIDR] = value;
            updateOutput();
            return true;
          };
          cpu.writeHooks[USISR] = (value) => {
            const writeClearMask = USISIF | USIOIF | USIPF;
            cpu.data[USISR] = cpu.data[USISR] & writeClearMask & ~value | value & 15;
            cpu.clearInterruptByFlag(this.START, value);
            cpu.clearInterruptByFlag(this.OVF, value);
            return true;
          };
          cpu.writeHooks[USICR] = (value) => {
            cpu.data[USICR] = value & ~(USICLK | USITC);
            cpu.updateInterruptEnable(this.START, value);
            cpu.updateInterruptEnable(this.OVF, value);
            const clockSrc = value & (USICS1 | USICS0) >> 2;
            const mode = value & (USIWM1 | USIWM0) >> 4;
            const usiClk = value & USICLK;
            port.openCollector = mode >= 2 ? 1 << dataPin : 0;
            const inputValue = cpu.data[PIN] & 1 << dataPin ? 1 : 0;
            if (usiClk && !clockSrc) {
              shift(inputValue);
              count();
            }
            if (value & USITC) {
              cpu.writeHooks[PIN](1 << clockPin, cpu.data[PIN], PIN, 255);
              const newValue = cpu.data[PIN] & 1 << clockPin;
              if (usiClk && (clockSrc === 2 || clockSrc === 3)) {
                if (clockSrc === 2 && newValue) {
                  shift(inputValue);
                }
                if (clockSrc === 3 && !newValue) {
                  shift(inputValue);
                }
                count();
              }
              return true;
            }
          };
        }
      };
      exports.AVRUSI = AVRUSI;
    }
  });

  // tools/programmable_simulator/node_modules/avr8js/dist/cjs/peripherals/watchdog.js
  var require_watchdog = __commonJS({
    "tools/programmable_simulator/node_modules/avr8js/dist/cjs/peripherals/watchdog.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", { value: true });
      exports.AVRWatchdog = exports.watchdogConfig = void 0;
      var MCUSR_WDRF = 8;
      var WDTCSR_WDIF = 128;
      var WDTCSR_WDIE = 64;
      var WDTCSR_WDP3 = 32;
      var WDTCSR_WDCE = 16;
      var WDTCSR_WDE = 8;
      var WDTCSR_WDP2 = 4;
      var WDTCSR_WDP1 = 2;
      var WDTCSR_WDP0 = 1;
      var WDTCSR_WDP210 = WDTCSR_WDP2 | WDTCSR_WDP1 | WDTCSR_WDP0;
      var WDTCSR_PROTECT_MASK = WDTCSR_WDE | WDTCSR_WDP3 | WDTCSR_WDP210;
      exports.watchdogConfig = {
        watchdogInterrupt: 12,
        MCUSR: 84,
        WDTCSR: 96
      };
      var AVRWatchdog = class {
        constructor(cpu, config, clock) {
          this.cpu = cpu;
          this.config = config;
          this.clock = clock;
          this.clockFrequency = 128e3;
          this.changeEnabledCycles = 0;
          this.watchdogTimeout = 0;
          this.enabledValue = false;
          this.scheduled = false;
          this.Watchdog = {
            address: this.config.watchdogInterrupt,
            flagRegister: this.config.WDTCSR,
            flagMask: WDTCSR_WDIF,
            enableRegister: this.config.WDTCSR,
            enableMask: WDTCSR_WDIE
          };
          this.checkWatchdog = () => {
            if (this.enabled && this.cpu.cycles >= this.watchdogTimeout) {
              const wdtcsr = this.cpu.data[this.config.WDTCSR];
              if (wdtcsr & WDTCSR_WDIE) {
                this.cpu.setInterruptFlag(this.Watchdog);
              }
              if (wdtcsr & WDTCSR_WDE) {
                if (wdtcsr & WDTCSR_WDIE) {
                  this.cpu.data[this.config.WDTCSR] &= ~WDTCSR_WDIE;
                } else {
                  this.cpu.reset();
                  this.scheduled = false;
                  this.cpu.data[this.config.MCUSR] |= MCUSR_WDRF;
                  return;
                }
              }
              this.resetWatchdog();
            }
            if (this.enabled) {
              this.scheduled = true;
              this.cpu.addClockEvent(this.checkWatchdog, this.watchdogTimeout - this.cpu.cycles);
            } else {
              this.scheduled = false;
            }
          };
          const { WDTCSR } = config;
          this.cpu.onWatchdogReset = () => {
            this.resetWatchdog();
          };
          cpu.writeHooks[WDTCSR] = (value, oldValue) => {
            if (value & WDTCSR_WDCE && value & WDTCSR_WDE) {
              this.changeEnabledCycles = this.cpu.cycles + 4;
              value = value & ~WDTCSR_PROTECT_MASK;
            } else {
              if (this.cpu.cycles >= this.changeEnabledCycles) {
                value = value & ~WDTCSR_PROTECT_MASK | oldValue & WDTCSR_PROTECT_MASK;
              }
              this.enabledValue = !!(value & WDTCSR_WDE || value & WDTCSR_WDIE);
              this.cpu.data[WDTCSR] = value;
            }
            if (this.enabled) {
              this.resetWatchdog();
            }
            if (this.enabled && !this.scheduled) {
              this.cpu.addClockEvent(this.checkWatchdog, this.watchdogTimeout - this.cpu.cycles);
            }
            this.cpu.clearInterruptByFlag(this.Watchdog, value);
            return true;
          };
        }
        resetWatchdog() {
          const cycles = Math.floor(this.clock.frequency / this.clockFrequency * this.prescaler);
          this.watchdogTimeout = this.cpu.cycles + cycles;
        }
        get enabled() {
          return this.enabledValue;
        }
        /**
         * The base clock frequency is 128KHz. Thus, a prescaler of 2048 gives 16ms timeout.
         */
        get prescaler() {
          const wdtcsr = this.cpu.data[this.config.WDTCSR];
          const value = (wdtcsr & WDTCSR_WDP3) >> 2 | wdtcsr & WDTCSR_WDP210;
          return 2048 << value;
        }
      };
      exports.AVRWatchdog = AVRWatchdog;
    }
  });

  // tools/programmable_simulator/node_modules/avr8js/dist/cjs/index.js
  var require_cjs = __commonJS({
    "tools/programmable_simulator/node_modules/avr8js/dist/cjs/index.js"(exports) {
      "use strict";
      var __createBinding = exports && exports.__createBinding || (Object.create ? (function(o, m, k, k2) {
        if (k2 === void 0) k2 = k;
        var desc = Object.getOwnPropertyDescriptor(m, k);
        if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
          desc = { enumerable: true, get: function() {
            return m[k];
          } };
        }
        Object.defineProperty(o, k2, desc);
      }) : (function(o, m, k, k2) {
        if (k2 === void 0) k2 = k;
        o[k2] = m[k];
      }));
      var __exportStar = exports && exports.__exportStar || function(m, exports2) {
        for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports2, p)) __createBinding(exports2, m, p);
      };
      Object.defineProperty(exports, "__esModule", { value: true });
      exports.watchdogConfig = exports.AVRWatchdog = exports.AVRUSI = exports.usart0Config = exports.AVRUSART = exports.attinyTimer1Config = exports.ATtinyTimer1 = exports.timer2Config = exports.timer1Config = exports.timer0Config = exports.AVRTimer = exports.spiConfig = exports.AVRSPI = exports.portLConfig = exports.portKConfig = exports.portJConfig = exports.portHConfig = exports.portGConfig = exports.portFConfig = exports.portEConfig = exports.portDConfig = exports.portCConfig = exports.portBConfig = exports.portAConfig = exports.PinState = exports.PCINT2 = exports.PCINT1 = exports.PCINT0 = exports.INT1 = exports.INT0 = exports.AVRIOPort = exports.eepromConfig = exports.EEPROMMemoryBackend = exports.AVREEPROM = exports.clockConfig = exports.AVRClock = exports.atmega328Channels = exports.adcConfig = exports.AVRADC = exports.ADCReference = exports.ADCMuxInputType = exports.avrInterrupt = exports.avrInstruction = exports.CPU = void 0;
      var cpu_1 = require_cpu();
      Object.defineProperty(exports, "CPU", { enumerable: true, get: function() {
        return cpu_1.CPU;
      } });
      var instruction_1 = require_instruction();
      Object.defineProperty(exports, "avrInstruction", { enumerable: true, get: function() {
        return instruction_1.avrInstruction;
      } });
      var interrupt_1 = require_interrupt();
      Object.defineProperty(exports, "avrInterrupt", { enumerable: true, get: function() {
        return interrupt_1.avrInterrupt;
      } });
      var adc_1 = require_adc();
      Object.defineProperty(exports, "ADCMuxInputType", { enumerable: true, get: function() {
        return adc_1.ADCMuxInputType;
      } });
      Object.defineProperty(exports, "ADCReference", { enumerable: true, get: function() {
        return adc_1.ADCReference;
      } });
      Object.defineProperty(exports, "AVRADC", { enumerable: true, get: function() {
        return adc_1.AVRADC;
      } });
      Object.defineProperty(exports, "adcConfig", { enumerable: true, get: function() {
        return adc_1.adcConfig;
      } });
      Object.defineProperty(exports, "atmega328Channels", { enumerable: true, get: function() {
        return adc_1.atmega328Channels;
      } });
      var clock_1 = require_clock();
      Object.defineProperty(exports, "AVRClock", { enumerable: true, get: function() {
        return clock_1.AVRClock;
      } });
      Object.defineProperty(exports, "clockConfig", { enumerable: true, get: function() {
        return clock_1.clockConfig;
      } });
      var eeprom_1 = require_eeprom();
      Object.defineProperty(exports, "AVREEPROM", { enumerable: true, get: function() {
        return eeprom_1.AVREEPROM;
      } });
      Object.defineProperty(exports, "EEPROMMemoryBackend", { enumerable: true, get: function() {
        return eeprom_1.EEPROMMemoryBackend;
      } });
      Object.defineProperty(exports, "eepromConfig", { enumerable: true, get: function() {
        return eeprom_1.eepromConfig;
      } });
      var gpio_1 = require_gpio();
      Object.defineProperty(exports, "AVRIOPort", { enumerable: true, get: function() {
        return gpio_1.AVRIOPort;
      } });
      Object.defineProperty(exports, "INT0", { enumerable: true, get: function() {
        return gpio_1.INT0;
      } });
      Object.defineProperty(exports, "INT1", { enumerable: true, get: function() {
        return gpio_1.INT1;
      } });
      Object.defineProperty(exports, "PCINT0", { enumerable: true, get: function() {
        return gpio_1.PCINT0;
      } });
      Object.defineProperty(exports, "PCINT1", { enumerable: true, get: function() {
        return gpio_1.PCINT1;
      } });
      Object.defineProperty(exports, "PCINT2", { enumerable: true, get: function() {
        return gpio_1.PCINT2;
      } });
      Object.defineProperty(exports, "PinState", { enumerable: true, get: function() {
        return gpio_1.PinState;
      } });
      Object.defineProperty(exports, "portAConfig", { enumerable: true, get: function() {
        return gpio_1.portAConfig;
      } });
      Object.defineProperty(exports, "portBConfig", { enumerable: true, get: function() {
        return gpio_1.portBConfig;
      } });
      Object.defineProperty(exports, "portCConfig", { enumerable: true, get: function() {
        return gpio_1.portCConfig;
      } });
      Object.defineProperty(exports, "portDConfig", { enumerable: true, get: function() {
        return gpio_1.portDConfig;
      } });
      Object.defineProperty(exports, "portEConfig", { enumerable: true, get: function() {
        return gpio_1.portEConfig;
      } });
      Object.defineProperty(exports, "portFConfig", { enumerable: true, get: function() {
        return gpio_1.portFConfig;
      } });
      Object.defineProperty(exports, "portGConfig", { enumerable: true, get: function() {
        return gpio_1.portGConfig;
      } });
      Object.defineProperty(exports, "portHConfig", { enumerable: true, get: function() {
        return gpio_1.portHConfig;
      } });
      Object.defineProperty(exports, "portJConfig", { enumerable: true, get: function() {
        return gpio_1.portJConfig;
      } });
      Object.defineProperty(exports, "portKConfig", { enumerable: true, get: function() {
        return gpio_1.portKConfig;
      } });
      Object.defineProperty(exports, "portLConfig", { enumerable: true, get: function() {
        return gpio_1.portLConfig;
      } });
      var spi_1 = require_spi();
      Object.defineProperty(exports, "AVRSPI", { enumerable: true, get: function() {
        return spi_1.AVRSPI;
      } });
      Object.defineProperty(exports, "spiConfig", { enumerable: true, get: function() {
        return spi_1.spiConfig;
      } });
      var timer_1 = require_timer();
      Object.defineProperty(exports, "AVRTimer", { enumerable: true, get: function() {
        return timer_1.AVRTimer;
      } });
      Object.defineProperty(exports, "timer0Config", { enumerable: true, get: function() {
        return timer_1.timer0Config;
      } });
      Object.defineProperty(exports, "timer1Config", { enumerable: true, get: function() {
        return timer_1.timer1Config;
      } });
      Object.defineProperty(exports, "timer2Config", { enumerable: true, get: function() {
        return timer_1.timer2Config;
      } });
      var timer_attiny_1 = require_timer_attiny();
      Object.defineProperty(exports, "ATtinyTimer1", { enumerable: true, get: function() {
        return timer_attiny_1.ATtinyTimer1;
      } });
      Object.defineProperty(exports, "attinyTimer1Config", { enumerable: true, get: function() {
        return timer_attiny_1.attinyTimer1Config;
      } });
      __exportStar(require_twi(), exports);
      var usart_1 = require_usart();
      Object.defineProperty(exports, "AVRUSART", { enumerable: true, get: function() {
        return usart_1.AVRUSART;
      } });
      Object.defineProperty(exports, "usart0Config", { enumerable: true, get: function() {
        return usart_1.usart0Config;
      } });
      var usi_1 = require_usi();
      Object.defineProperty(exports, "AVRUSI", { enumerable: true, get: function() {
        return usi_1.AVRUSI;
      } });
      var watchdog_1 = require_watchdog();
      Object.defineProperty(exports, "AVRWatchdog", { enumerable: true, get: function() {
        return watchdog_1.AVRWatchdog;
      } });
      Object.defineProperty(exports, "watchdogConfig", { enumerable: true, get: function() {
        return watchdog_1.watchdogConfig;
      } });
    }
  });

  // src/programmable_circuit/mega_config.mjs
  var import_cjs = __toESM(require_cjs(), 1);
  /*! Velxio register configuration adaptation; AGPL-3.0-or-later. See vendor/velxio/LICENSE. */
  var MEGA_PORT_BIT_MAP = {
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
  var megaExtInt = (n) => ({
    EICR: n < 4 ? 105 : 106,
    EIMSK: 61,
    EIFR: 60,
    index: n,
    iscOffset: n % 4 * 2,
    interrupt: 2 + 2 * n
  });
  var megaPinChange = (n, mask, offset) => ({
    PCIE: n,
    PCICR: 104,
    PCIFR: 59,
    PCMSK: 107 + n,
    pinChangeInterrupt: 18 + 2 * n,
    mask,
    offset
  });
  var megaPortRegs = (c) => ({
    PIN: c.PIN,
    DDR: c.DDR,
    PORT: c.PORT
  });
  var MEGA_PORT_CONFIGS = [
    { name: "PORTA", config: import_cjs.portAConfig },
    {
      name: "PORTB",
      config: {
        ...megaPortRegs(import_cjs.portBConfig),
        pinChange: megaPinChange(0, 255, 0),
        externalInterrupts: []
      }
    },
    { name: "PORTC", config: { ...megaPortRegs(import_cjs.portCConfig), externalInterrupts: [] } },
    {
      name: "PORTD",
      config: {
        ...megaPortRegs(import_cjs.portDConfig),
        externalInterrupts: [megaExtInt(0), megaExtInt(1), megaExtInt(2), megaExtInt(3)]
      }
    },
    {
      name: "PORTE",
      config: {
        ...megaPortRegs(import_cjs.portEConfig),
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
    { name: "PORTF", config: import_cjs.portFConfig },
    { name: "PORTG", config: import_cjs.portGConfig },
    { name: "PORTH", config: import_cjs.portHConfig },
    {
      name: "PORTJ",
      config: {
        ...megaPortRegs(import_cjs.portJConfig),
        pinChange: megaPinChange(1, 127, 1),
        externalInterrupts: []
      }
    },
    {
      name: "PORTK",
      config: {
        ...megaPortRegs(import_cjs.portKConfig),
        pinChange: megaPinChange(2, 255, 0),
        externalInterrupts: []
      }
    },
    { name: "PORTL", config: import_cjs.portLConfig }
  ];
  var MEGA_TIMER0_PINS = {
    compPortA: import_cjs.portBConfig.PORT,
    compPinA: 7,
    compPortB: import_cjs.portGConfig.PORT,
    compPinB: 5,
    externalClockPort: import_cjs.portDConfig.PORT,
    externalClockPin: 7
    // T0 → PD7
  };
  var MEGA_TIMER1_PINS = {
    compPortA: import_cjs.portBConfig.PORT,
    compPinA: 5,
    compPortB: import_cjs.portBConfig.PORT,
    compPinB: 6,
    compPortC: import_cjs.portBConfig.PORT,
    compPinC: 7,
    externalClockPort: import_cjs.portDConfig.PORT,
    externalClockPin: 6
    // T1 → PD6
  };
  var MEGA_TIMER2_PINS = {
    compPortA: import_cjs.portBConfig.PORT,
    compPinA: 4,
    compPortB: import_cjs.portHConfig.PORT,
    compPinB: 6,
    // Timer2 has no T2 input on the Mega — it clocks off TOSC1/TOSC2.
    externalClockPort: 0,
    externalClockPin: 0
  };
  var MEGA_TIMER1_CHANNEL_C = {
    OCRC: 140,
    compCInterrupt: 38,
    // _VECTOR(19) TIMER1_COMPC
    OCFC: 8,
    OCIEC: 8
  };
  var megaTimer3Config = {
    ...import_cjs.timer1Config,
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
    compPortA: import_cjs.portEConfig.PORT,
    compPinA: 3,
    compPortB: import_cjs.portEConfig.PORT,
    compPinB: 4,
    compPortC: import_cjs.portEConfig.PORT,
    compPinC: 5,
    externalClockPort: import_cjs.portEConfig.PORT,
    externalClockPin: 6
    // T3 → PE6
  };
  var megaTimer4Config = {
    ...import_cjs.timer1Config,
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
    compPortA: import_cjs.portHConfig.PORT,
    compPinA: 3,
    compPortB: import_cjs.portHConfig.PORT,
    compPinB: 4,
    compPortC: import_cjs.portHConfig.PORT,
    compPinC: 5,
    externalClockPort: import_cjs.portHConfig.PORT,
    externalClockPin: 7
    // T4 → PH7
  };
  var megaTimer5Config = {
    ...import_cjs.timer1Config,
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
    compPortA: import_cjs.portLConfig.PORT,
    compPinA: 3,
    compPortB: import_cjs.portLConfig.PORT,
    compPinB: 4,
    compPortC: import_cjs.portLConfig.PORT,
    compPinC: 5,
    externalClockPort: import_cjs.portLConfig.PORT,
    externalClockPin: 2
    // T5 → PL2
  };
  var MEGA_USART1 = {
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
  var MEGA_USART2 = {
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
  var MEGA_USART3 = {
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
  var ATMEGA2560_PERIPHERALS = {
    // The compare-output pads and the third channel of Timer1 are the Mega's,
    // not the 328P's: without them a sketch that sets OCR1A drives no pin (#356).
    timer0: {
      ...import_cjs.timer0Config,
      compAInterrupt: 42,
      compBInterrupt: 44,
      ovfInterrupt: 46,
      ...MEGA_TIMER0_PINS
    },
    timer1: {
      ...import_cjs.timer1Config,
      captureInterrupt: 32,
      compAInterrupt: 34,
      compBInterrupt: 36,
      ovfInterrupt: 40,
      ...MEGA_TIMER1_CHANNEL_C,
      ...MEGA_TIMER1_PINS
    },
    timer2: {
      ...import_cjs.timer2Config,
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
          ...import_cjs.usart0Config,
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
    spi: { ...import_cjs.spiConfig, spiInterrupt: 48 },
    twi: { ...import_cjs.twiConfig, twiInterrupt: 78 },
    adc: { ...import_cjs.adcConfig, adcInterrupt: 58 },
    eeprom: { ...import_cjs.eepromConfig, eepromReadyInterrupt: 60 }
  };

  // src/programmable_circuit/teaching_devices.mjs
  var DS1307 = class {
    constructor(q, clock = () => 0) {
      this.q = q;
      this.clock = clock;
      this.base = Date.UTC(2026, 0, 1, q.hour, q.minute, q.second);
      this.epoch = clock();
      this.reg = 0;
      this.ram = new Uint8Array(64);
      this.halted = false;
      this.hour12 = false;
      this.weekdayOffset = 0;
    }
    bcd(n) {
      return Math.floor(n / 10) << 4 | n % 10;
    }
    dec(n) {
      return (n >> 4) * 10 + (n & 15);
    }
    now() {
      return new Date(this.base + (this.halted ? 0 : (this.clock() - this.epoch) / 1e3));
    }
    refresh() {
      const d = this.now();
      this.ram.set([this.bcd(d.getUTCSeconds()) | (this.halted ? 128 : 0), this.bcd(d.getUTCMinutes()), this.hour12 ? 64 | (d.getUTCHours() >= 12 ? 32 : 0) | this.bcd(d.getUTCHours() % 12 || 12) : this.bcd(d.getUTCHours()), (d.getUTCDay() + this.weekdayOffset) % 7 + 1, this.bcd(d.getUTCDate()), this.bcd(d.getUTCMonth() + 1), this.bcd(d.getUTCFullYear() % 100)]);
    }
    start(read) {
      this.first = !read;
      this.refresh();
    }
    stop() {
    }
    writeByte(v) {
      if (this.first) {
        this.reg = v & 63;
        this.first = false;
        return true;
      }
      const r = this.reg, b = this.ram.slice();
      b[r] = v;
      if (r < 7) {
        const z = v & [127, 127, 63, 7, 63, 31, 255][r];
        const digits = r === 2 && v & 64 ? v & 31 : z;
        if (r !== 3 && ((digits & 15) > 9 || digits >> 4 > 9)) return false;
        const sec = this.dec(b[0] & 127), min = this.dec(b[1] & 127), raw = b[2], twelve = this.dec(raw & 31);
        let hour = this.dec(raw & 63);
        if (raw & 64) hour = twelve % 12 + (raw & 32 ? 12 : 0);
        const year = 2e3 + this.dec(b[6]), month = this.dec(b[5]), day = this.dec(b[4]);
        if (sec > 59 || min > 59 || hour > 23 || raw & 64 && (twelve < 1 || twelve > 12) || b[3] < 1 || b[3] > 7 || day < 1 || day > 31 || month < 1 || month > 12) return false;
        const base = Date.UTC(year, month - 1, day, hour, min, sec);
        if (new Date(base).getUTCMonth() !== month - 1) return false;
        this.weekdayOffset = (b[3] - 1 - new Date(base).getUTCDay() + 7) % 7;
        this.base = base;
        this.epoch = this.clock();
        this.halted = !!(b[0] & 128);
        this.hour12 = !!(b[2] & 64);
      }
      this.ram = b;
      this.reg = r + 1 & 63;
      return true;
    }
    readByte() {
      const v = this.ram[this.reg];
      this.reg = this.reg + 1 & 63;
      return v;
    }
    snapshot() {
      return { type: "ds1307", time: this.now().toISOString(), halted: this.halted, clock_source: "simulation time", limitations: "24/12-hour BCD registers and RAM; no battery aging or SQW output" };
    }
  };
  function dhtFrame(temperature, humidity) {
    const h = Math.round(humidity * 10), t = Math.round(Math.abs(temperature) * 10) | (temperature < 0 ? 32768 : 0), a = [h >> 8, h & 255, t >> 8, t & 255];
    return [...a, a.reduce((s, v) => s + v, 0) & 255];
  }
  function dhtEdges(t, bytes) {
    const out = [{ t: t + 20, value: 0 }, { t: t + 100, value: 1 }, { t: t + 180, value: 0 }];
    let now = t + 180;
    for (const b of bytes) for (let bit = 7; bit >= 0; bit--) {
      now += 50;
      out.push({ t: now, value: 1 });
      now += b >> bit & 1 ? 70 : 26;
      out.push({ t: now, value: 0 });
    }
    out.push({ t: now + 50, value: 1 });
    return out;
  }
  var DHT22 = class {
    constructor(q) {
      this.q = q;
      this.low = null;
      this.last = -Infinity;
      this.queue = [];
      this.value = null;
      this.frames = 0;
      this.reason = "Waiting for start pulse";
    }
    update(t, drive, powered, pullup) {
      if (!powered || !pullup) {
        this.queue = [];
        this.value = null;
        this.low = null;
        this.reason = "Connect supply, ground and DATA pull-up";
        return null;
      }
      if (drive === 0) {
        if (this.low === null) this.low = t;
      } else if (this.low !== null) {
        if (t - this.low >= 1e3 && t - this.last >= 2e6) {
          this.queue = dhtEdges(t, dhtFrame(this.q.temperature_c, this.q.humidity_pct));
          this.last = t;
          this.frames++;
          this.reason = "Responding to firmware start pulse";
        }
        this.low = null;
      }
      while (this.queue.length && this.queue[0].t <= t) this.value = this.queue.shift().value;
      if (!this.queue.length && this.value === 1) this.value = null;
      return this.value;
    }
    snapshot() {
      return { type: "dht22", frames: this.frames, reason: this.reason, reference_temperature_c: this.q.temperature_c, reference_humidity_pct: this.q.humidity_pct };
    }
  };
  var StepperDriver = class {
    constructor(q) {
      this.q = q;
      this.last = false;
      this.steps = 0;
      this.position = 0;
      this.pulses = 0;
      this.rejected = 0;
      this.lastRise = -Infinity;
      this.fault = "";
    }
    update(t, { step, dir, enabled, powered, microstep = 1 }) {
      if (step && !this.last) {
        this.pulses++;
        const dt = t - this.lastRise;
        this.lastRise = t;
        if (!powered || !enabled) {
          this.rejected++;
          this.fault = "Driver disabled or supply absent";
        } else if (dt < 2) {
          this.rejected++;
          this.fault = "STEP period below supported driver timing";
        } else {
          const sign = dir ? 1 : -1;
          this.steps += sign / microstep;
          this.position = this.steps * this.q.step_angle_deg;
          this.fault = "";
        }
      }
      this.last = step;
    }
    snapshot() {
      return { type: "a4988_stepper", position_deg: this.position, full_steps: this.steps, pulses: this.pulses, rejected_pulses: this.rejected, fault: this.fault, model: "Commanded position with driver timing; load torque, acceleration stalls and coil-current regulation are not modeled" };
    }
  };

  // src/programmable_circuit/active_solver.mjs
  var clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  function gaussian(A, b) {
    const n = b.length;
    for (let k = 0; k < n; k++) {
      let m = k;
      for (let i = k + 1; i < n; i++) if (Math.abs(A[i][k]) > Math.abs(A[m][k])) m = i;
      if (Math.abs(A[m][k]) < 1e-18) throw Error("Active circuit has a floating or singular node.");
      [A[k], A[m]] = [A[m], A[k]];
      [b[k], b[m]] = [b[m], b[k]];
      const d = A[k][k];
      for (let j = k; j < n; j++) A[k][j] /= d;
      b[k] /= d;
      for (let i = 0; i < n; i++) if (i !== k) {
        const f = A[i][k];
        for (let j = k; j < n; j++) A[i][j] -= f * A[k][j];
        b[i] -= f * b[k];
      }
    }
    return b;
  }
  function solveActive(p, drives, dynamic, ctx) {
    const { nl, pins: pins2, rail, profile } = ctx, net = nl.net, node = (id, pin) => net.get(id + ":" + pin), g = nl.ground, fixed = /* @__PURE__ */ new Map([[g, 0]]), used = /* @__PURE__ */ new Set(), warnings = [];
    const fix = (n, v) => {
      if (fixed.has(n) && Math.abs(fixed.get(n) - v) > 1e-6) throw Error("Conflicting voltage sources; correct the circuit.");
      fixed.set(n, v);
    };
    for (const pin of pins2) {
      const n = node(nl.board, pin.id);
      if (pin.mode === "power" && !["VBUS", "VSYS"].includes(pin.id)) fix(n, pin.id === "3V3" ? 3.3 : rail);
      if (pin.id === "ADC_VREF") fix(n, 3.3);
      if (drives[pin.id] === 0 || drives[pin.id] === 1) fix(n, drives[pin.id] * rail);
    }
    for (const a of p.parts) {
      if (a.type === "board") continue;
      for (const e of net.keys()) if (e.startsWith(a.id + ":")) used.add(net.get(e));
      if (!["resistor", "pot", "button", "capacitor", "meter", "scope", "logic", "digital", "pwm", "led", "npn", "nmos", "opamp", "source", "motor_supply", "rail", "breadboard"].includes(a.type)) throw Error("This active analog solver does not yet support mixing " + a.type + " into the same circuit.");
      if (a.type === "source" && node(a.id, "GND") === g) fix(node(a.id, "OUT"), a.params.volts);
      if (a.type === "motor_supply" && node(a.id, "GND") === g) fix(node(a.id, "OUT"), a.params.supply_v);
    }
    const unknown = [...used].filter((n) => !fixed.has(n)), ix = new Map(unknown.map((n, i) => [n, i]));
    let x = unknown.map(() => 0);
    function currents(v) {
      const out = new Map([...used].map((n) => [n, 0]));
      const put = (a, b, i) => {
        if (!Number.isFinite(i)) throw Error("Non-finite model current");
        out.set(a, (out.get(a) || 0) + i);
        out.set(b, (out.get(b) || 0) - i);
      };
      const val2 = (n) => fixed.has(n) ? fixed.get(n) : v[ix.get(n)] ?? 0;
      const R = (a, b, r, off = 0) => put(a, b, (val2(a) - val2(b) - off) / r);
      for (const pin of pins2) {
        if (drives[pin.id] === 3) R(node(nl.board, pin.id), node(nl.board, profile.power_pin), 5e4);
        if (drives[pin.id] === 4) R(node(nl.board, pin.id), g, 5e4);
      }
      for (const a of p.parts) {
        const q = a.params, n = (k) => node(a.id, k), V = (k) => val2(n(k)), diode = (d) => q.is_a * (Math.exp(clamp(d / 0.02585, -50, 35)) - 1);
        if (a.type === "resistor") R(n("1"), n("2"), q.ohms);
        if (a.type === "pot") {
          R(n("VCC"), n("OUT"), Math.max(1, q.ohms * (1 - q.position)));
          R(n("OUT"), n("GND"), Math.max(1, q.ohms * q.position));
        }
        if (a.type === "button" && q.pressed) R(n("1"), n("2"), 1);
        if (a.type === "capacitor" && dynamic) R(n("1"), n("2"), (dynamic.dt || 1e-9) / (q.capacitance_uf * 1e-6), dynamic.capacitors[a.id] ?? q.initial_v);
        if (["meter", "scope", "logic"].includes(a.type)) R(n(a.type === "meter" ? "PLUS" : a.type === "scope" ? "CH1" : "IN"), n(a.type === "meter" ? "COM" : "GND"), a.type === "scope" ? 1e6 : 1e7);
        if (["digital", "pwm"].includes(a.type)) R(n("IN"), n("GND"), q.ohms);
        if (a.type === "led") put(n("A"), n("K"), Math.max(0, (V("A") - V("K") - q.vf) / 10));
        if (a.type === "npn") {
          const f = diode(V("B") - V("E")), r = diode(V("B") - V("C")), af = q.beta / (q.beta + 1), ar = 0.5;
          put(n("C"), n("E"), af * f - ar * r);
          put(n("B"), n("E"), (1 - af) * f);
          put(n("B"), n("C"), (1 - ar) * r);
        }
        if (a.type === "nmos") {
          const aV = V("D"), bV = V("S"), reverse = aV < bV, vs = reverse ? aV : bV, vd = reverse ? bV : aV, over = V("G") - vs - q.threshold_v, d = vd - vs;
          const i = over <= 0 ? 0 : q.kp_a_v2 * (d < over ? over * d - d * d / 2 : over * over / 2);
          put(n("D"), n("S"), reverse ? -i : i);
          put(n("S"), n("D"), 1e-14 * (Math.exp(clamp((bV - aV) / 0.02585, -50, 35)) - 1));
          R(n("G"), n("S"), 1e12);
        }
        if (a.type === "opamp") {
          const low = V("GND"), high = V("VCC");
          if (high - low < 1) throw Error("Connect op-amp supply and ground.");
          const target = clamp(q.open_gain * (V("PLUS") - V("MINUS")), low + q.headroom_v, high - q.headroom_v);
          put(n("OUT"), n("GND"), (V("OUT") - target) / q.output_ohms);
          R(n("PLUS"), n("GND"), 1e12);
          R(n("MINUS"), n("GND"), 1e12);
        }
      }
      return out;
    }
    let converged = false, iterations = 0;
    const residual = (v) => {
      const c2 = currents(v);
      return unknown.map((n) => c2.get(n) || 0);
    }, norm = (r) => Math.max(0, ...r.map(Math.abs));
    for (; iterations < 120; iterations++) {
      const r = residual(x);
      if (norm(r) < 1e-9) {
        converged = true;
        break;
      }
      const J = unknown.map(() => unknown.map(() => 0));
      for (let j = 0; j < x.length; j++) {
        const y = x.slice(), h = 1e-6;
        y[j] += h;
        const rr = residual(y);
        for (let i = 0; i < x.length; i++) J[i][j] = (rr[i] - r[i]) / h;
      }
      const step = gaussian(J, r.map((v) => -v));
      let scale = Math.min(1, 0.2 / Math.max(0.2, ...step.map(Math.abs))), found = false;
      for (let k = 0; k < 18; k++, scale *= 0.5) {
        const y = x.map((v, i) => v + scale * step[i]);
        if (norm(residual(y)) < norm(r)) {
          x = y;
          found = true;
          break;
        }
      }
      if (!found) break;
    }
    if (!converged) throw Error("Active circuit did not converge; no valid result issued. Check bias and wiring.");
    const val = (n) => fixed.has(n) ? fixed.get(n) : ix.has(n) ? x[ix.get(n)] : null, values = Object.fromEntries([...net].map(([e, n]) => [e, val(n)])), leds = [], capacitors = {};
    for (const a of p.parts) {
      const V = (k) => values[a.id + ":" + k];
      if (a.type === "led") {
        const i = Math.max(0, (V("A") - V("K") - a.params.vf) / 10) * 1e3;
        if (i > 20.01) throw Error("LED current exceeds 20 mA teaching budget.");
        leds.push({ id: a.id, current_ma: i, on: i > 0.2 });
      }
      if (a.type === "capacitor") capacitors[a.id] = V("1") - V("2");
      if (a.type === "resistor" && (V("1") - V("2")) ** 2 / a.params.ohms > 0.25001) throw Error("Resistor exceeds 0.25 W teaching rating.");
    }
    const c = currents(x);
    let total = 0;
    for (const pin of pins2) {
      const n = node(nl.board, pin.id), v = val(n);
      if (["analog", "digital"].includes(pin.mode) && v !== null && (v < -0.05 || v > rail + 0.05)) throw Error("MCU pin voltage outside selected board rails.");
      if ([0, 1].includes(drives[pin.id])) {
        const i = Math.abs(c.get(n) || 0);
        if (i > (rail > 4 ? 0.02001 : 0.01201)) throw Error("MCU output current budget exceeded.");
        total += i;
      }
    }
    if (total > 0.05001) throw Error("Combined GPIO current budget exceeded.");
    warnings.push("Quasistatic teaching semiconductor models: no named-part, thermal, noise or high-frequency validation.");
    return { values, leds, capacitors, warnings, nets: nl.groups, ground: g, active_solver: { converged, iterations, max_kcl_error_a: norm(residual(x)) } };
  }

  // src/programmable_circuit/project_files.mjs
  function projectFiles(p) {
    const main = p.language === "arduino" ? "sketch.ino" : "main.py", extra = p.files || {};
    if (!extra || Array.isArray(extra) || typeof extra !== "object" || Object.keys(extra).length > 11) throw Error("Use at most 12 project files.");
    if (p.source.includes("\0")) throw Error("NUL is not valid source.");
    const names = /* @__PURE__ */ new Set([main.toLowerCase()]);
    let bytes = new TextEncoder().encode(p.source).length;
    for (const [name, text] of Object.entries(extra)) {
      const ext = p.language === "arduino" ? /^[A-Za-z][A-Za-z0-9_-]{0,47}\.(h|hpp|cpp|c|ino)$/ : /^[A-Za-z][A-Za-z0-9_]{0,47}\.py$/;
      if (names.has(name.toLowerCase()) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])\./i.test(name) || !ext.test(name) || name === main || ["__init__.py", "boot.py"].includes(name) || typeof text !== "string" || text.includes("\0")) throw Error("Invalid project file name or content.");
      names.add(name.toLowerCase());
      bytes += new TextEncoder().encode(text).length;
    }
    if (bytes > 24e3) throw Error("Combined source budget is 24 KB.");
    return { [main]: p.source, ...extra };
  }
  function picoProgram(p) {
    const files = projectFiles(p), extra = Object.entries(files).filter(([name]) => name !== "main.py");
    if (!extra.length) return p.source;
    return `import os,sys
class _ProjectDisk:
 def __init__(self): self.b=bytearray(65536)
 def readblocks(self,n,b,off=0): b[:]=self.b[n*512+off:n*512+off+len(b)]
 def writeblocks(self,n,b,off=0): self.b[n*512+off:n*512+off+len(b)]=b
 def ioctl(self,op,arg):
  if op==4: return 128
  if op==5: return 512
  if op==6: self.b[arg*512:(arg+1)*512]=b'\\xff'*512
  return 0
_disk=_ProjectDisk()
os.VfsLfs2.mkfs(_disk)
os.mount(os.VfsLfs2(_disk),'/project')
os.chdir('/project')
sys.path.insert(0,'/project')
` + extra.map(([name, text]) => `with open(${JSON.stringify(name)},'w') as f: f.write(${JSON.stringify(text)})`).join("\n") + "\nexec(compile(" + JSON.stringify(p.source) + ",'main.py','exec'))\n";
  }

  // src/programmable_circuit/boards.json
  var boards_default = {
    uno_r3: {
      name: "Arduino Uno R3",
      family: "atmega328p",
      language: "arduino",
      volts: 5,
      clock_hz: 16e6,
      adc_channels: 6,
      adc_bits: 10,
      power_pin: "5V",
      fqbn: "arduino:avr:uno",
      pins: [
        {
          id: "AREF",
          mode: "reference",
          x: 0,
          y: 0
        },
        {
          id: "GND_TOP",
          mode: "ground",
          x: 0,
          y: 20
        },
        {
          id: "D13",
          mode: "digital",
          x: 0,
          y: 40
        },
        {
          id: "D12",
          mode: "digital",
          x: 0,
          y: 60
        },
        {
          id: "D11",
          mode: "digital",
          x: 0,
          y: 80
        },
        {
          id: "D10",
          mode: "digital",
          x: 0,
          y: 100
        },
        {
          id: "D9",
          mode: "digital",
          x: 0,
          y: 120
        },
        {
          id: "D8",
          mode: "digital",
          x: 0,
          y: 140
        },
        {
          id: "D7",
          mode: "digital",
          x: 0,
          y: 160
        },
        {
          id: "D6",
          mode: "digital",
          x: 0,
          y: 180
        },
        {
          id: "D5",
          mode: "digital",
          x: 0,
          y: 200
        },
        {
          id: "D4",
          mode: "digital",
          x: 0,
          y: 220
        },
        {
          id: "D3",
          mode: "digital",
          x: 0,
          y: 240
        },
        {
          id: "D2",
          mode: "digital",
          x: 0,
          y: 260
        },
        {
          id: "D1",
          mode: "digital",
          x: 0,
          y: 280
        },
        {
          id: "D0",
          mode: "digital",
          x: 0,
          y: 300
        },
        {
          id: "IOREF",
          mode: "unsupported",
          x: 0,
          y: 320
        },
        {
          id: "RESET",
          mode: "unsupported",
          x: 0,
          y: 340
        },
        {
          id: "3V3",
          mode: "power",
          x: 0,
          y: 360
        },
        {
          id: "5V",
          mode: "power",
          x: 0,
          y: 380
        },
        {
          id: "GND",
          mode: "ground",
          x: 0,
          y: 400
        },
        {
          id: "GND2",
          mode: "ground",
          x: 0,
          y: 420
        },
        {
          id: "VIN",
          mode: "unsupported",
          x: 0,
          y: 440
        },
        {
          id: "A0",
          mode: "analog",
          x: 0,
          y: 460
        },
        {
          id: "A1",
          mode: "analog",
          x: 0,
          y: 480
        },
        {
          id: "A2",
          mode: "analog",
          x: 0,
          y: 500
        },
        {
          id: "A3",
          mode: "analog",
          x: 0,
          y: 520
        },
        {
          id: "A4",
          mode: "analog",
          x: 0,
          y: 540
        },
        {
          id: "A5",
          mode: "analog",
          x: 0,
          y: 560
        }
      ]
    },
    nano_atmega328p: {
      name: "Arduino Nano (classic)",
      family: "atmega328p",
      language: "arduino",
      volts: 5,
      clock_hz: 16e6,
      adc_channels: 8,
      adc_bits: 10,
      power_pin: "5V",
      fqbn: "arduino:avr:nano:cpu=atmega328",
      pins: [
        {
          id: "D1",
          mode: "digital",
          x: 0,
          y: 0
        },
        {
          id: "D0",
          mode: "digital",
          x: 0,
          y: 20
        },
        {
          id: "RESET",
          mode: "unsupported",
          x: 0,
          y: 40
        },
        {
          id: "GND",
          mode: "ground",
          x: 0,
          y: 60
        },
        {
          id: "D2",
          mode: "digital",
          x: 0,
          y: 80
        },
        {
          id: "D3",
          mode: "digital",
          x: 0,
          y: 100
        },
        {
          id: "D4",
          mode: "digital",
          x: 0,
          y: 120
        },
        {
          id: "D5",
          mode: "digital",
          x: 0,
          y: 140
        },
        {
          id: "D6",
          mode: "digital",
          x: 0,
          y: 160
        },
        {
          id: "D7",
          mode: "digital",
          x: 0,
          y: 180
        },
        {
          id: "D8",
          mode: "digital",
          x: 0,
          y: 200
        },
        {
          id: "D9",
          mode: "digital",
          x: 0,
          y: 220
        },
        {
          id: "D10",
          mode: "digital",
          x: 0,
          y: 240
        },
        {
          id: "D11",
          mode: "digital",
          x: 0,
          y: 260
        },
        {
          id: "D12",
          mode: "digital",
          x: 0,
          y: 280
        },
        {
          id: "VIN",
          mode: "unsupported",
          x: 0,
          y: 300
        },
        {
          id: "GND2",
          mode: "ground",
          x: 0,
          y: 320
        },
        {
          id: "RESET2",
          mode: "unsupported",
          x: 0,
          y: 340
        },
        {
          id: "5V",
          mode: "power",
          x: 0,
          y: 360
        },
        {
          id: "A7",
          mode: "analog",
          x: 0,
          y: 380
        },
        {
          id: "A6",
          mode: "analog",
          x: 0,
          y: 400
        },
        {
          id: "A5",
          mode: "analog",
          x: 0,
          y: 420
        },
        {
          id: "A4",
          mode: "analog",
          x: 0,
          y: 440
        },
        {
          id: "A3",
          mode: "analog",
          x: 0,
          y: 460
        },
        {
          id: "A2",
          mode: "analog",
          x: 0,
          y: 480
        },
        {
          id: "A1",
          mode: "analog",
          x: 0,
          y: 500
        },
        {
          id: "A0",
          mode: "analog",
          x: 0,
          y: 520
        },
        {
          id: "AREF",
          mode: "reference",
          x: 0,
          y: 540
        },
        {
          id: "3V3",
          mode: "power",
          x: 0,
          y: 560
        },
        {
          id: "D13",
          mode: "digital",
          x: 0,
          y: 580
        }
      ]
    },
    pro_mini_5v: {
      name: "Arduino Pro Mini (5 V / 16 MHz)",
      family: "atmega328p",
      language: "arduino",
      volts: 5,
      clock_hz: 16e6,
      adc_channels: 8,
      adc_bits: 10,
      power_pin: "VCC",
      fqbn: "arduino:avr:pro:cpu=16MHzatmega328",
      pins: [
        {
          id: "D1",
          mode: "digital",
          x: 0,
          y: 0
        },
        {
          id: "D0",
          mode: "digital",
          x: 0,
          y: 20
        },
        {
          id: "RESET",
          mode: "unsupported",
          x: 0,
          y: 40
        },
        {
          id: "GND",
          mode: "ground",
          x: 0,
          y: 60
        },
        {
          id: "D2",
          mode: "digital",
          x: 0,
          y: 80
        },
        {
          id: "D3",
          mode: "digital",
          x: 0,
          y: 100
        },
        {
          id: "D4",
          mode: "digital",
          x: 0,
          y: 120
        },
        {
          id: "D5",
          mode: "digital",
          x: 0,
          y: 140
        },
        {
          id: "D6",
          mode: "digital",
          x: 0,
          y: 160
        },
        {
          id: "D7",
          mode: "digital",
          x: 0,
          y: 180
        },
        {
          id: "D8",
          mode: "digital",
          x: 0,
          y: 200
        },
        {
          id: "D9",
          mode: "digital",
          x: 0,
          y: 220
        },
        {
          id: "RAW",
          mode: "unsupported",
          x: 0,
          y: 240
        },
        {
          id: "GND2",
          mode: "ground",
          x: 0,
          y: 260
        },
        {
          id: "RESET2",
          mode: "unsupported",
          x: 0,
          y: 280
        },
        {
          id: "VCC",
          mode: "power",
          x: 0,
          y: 300
        },
        {
          id: "A3",
          mode: "analog",
          x: 0,
          y: 320
        },
        {
          id: "A2",
          mode: "analog",
          x: 0,
          y: 340
        },
        {
          id: "A1",
          mode: "analog",
          x: 0,
          y: 360
        },
        {
          id: "A0",
          mode: "analog",
          x: 0,
          y: 380
        },
        {
          id: "D13",
          mode: "digital",
          x: 0,
          y: 400
        },
        {
          id: "D12",
          mode: "digital",
          x: 0,
          y: 420
        },
        {
          id: "D11",
          mode: "digital",
          x: 0,
          y: 440
        },
        {
          id: "D10",
          mode: "digital",
          x: 0,
          y: 460
        },
        {
          id: "A4",
          mode: "analog",
          x: 0,
          y: 480
        },
        {
          id: "A5",
          mode: "analog",
          x: 0,
          y: 500
        },
        {
          id: "A6",
          mode: "analog",
          x: 0,
          y: 520
        },
        {
          id: "A7",
          mode: "analog",
          x: 0,
          y: 540
        }
      ]
    },
    pico_rp2040: {
      name: "Raspberry Pi Pico",
      family: "rp2040",
      language: "micropython",
      volts: 3.3,
      clock_hz: 125e6,
      adc_channels: 3,
      adc_bits: 12,
      power_pin: "3V3",
      pins: [
        {
          id: "GP0",
          mode: "digital",
          x: 0,
          y: 0
        },
        {
          id: "GP1",
          mode: "digital",
          x: 0,
          y: 20
        },
        {
          id: "GND",
          mode: "ground",
          x: 0,
          y: 40
        },
        {
          id: "GP2",
          mode: "digital",
          x: 0,
          y: 60
        },
        {
          id: "GP3",
          mode: "digital",
          x: 0,
          y: 80
        },
        {
          id: "GP4",
          mode: "digital",
          x: 0,
          y: 100
        },
        {
          id: "GP5",
          mode: "digital",
          x: 0,
          y: 120
        },
        {
          id: "GND2",
          mode: "ground",
          x: 0,
          y: 140
        },
        {
          id: "GP6",
          mode: "digital",
          x: 0,
          y: 160
        },
        {
          id: "GP7",
          mode: "digital",
          x: 0,
          y: 180
        },
        {
          id: "GP8",
          mode: "digital",
          x: 0,
          y: 200
        },
        {
          id: "GP9",
          mode: "digital",
          x: 0,
          y: 220
        },
        {
          id: "GND3",
          mode: "ground",
          x: 0,
          y: 240
        },
        {
          id: "GP10",
          mode: "digital",
          x: 0,
          y: 260
        },
        {
          id: "GP11",
          mode: "digital",
          x: 0,
          y: 280
        },
        {
          id: "GP12",
          mode: "digital",
          x: 0,
          y: 300
        },
        {
          id: "GP13",
          mode: "digital",
          x: 0,
          y: 320
        },
        {
          id: "GND4",
          mode: "ground",
          x: 0,
          y: 340
        },
        {
          id: "GP14",
          mode: "digital",
          x: 0,
          y: 360
        },
        {
          id: "GP15",
          mode: "digital",
          x: 0,
          y: 380
        },
        {
          id: "VBUS",
          mode: "unsupported",
          x: 0,
          y: 400
        },
        {
          id: "VSYS",
          mode: "unsupported",
          x: 0,
          y: 420
        },
        {
          id: "GND5",
          mode: "ground",
          x: 0,
          y: 440
        },
        {
          id: "3V3_EN",
          mode: "unsupported",
          x: 0,
          y: 460
        },
        {
          id: "3V3",
          mode: "power",
          x: 0,
          y: 480
        },
        {
          id: "ADC_VREF",
          mode: "reference",
          x: 0,
          y: 500
        },
        {
          id: "GP28",
          mode: "analog",
          x: 0,
          y: 520
        },
        {
          id: "AGND",
          mode: "ground",
          x: 0,
          y: 540
        },
        {
          id: "GP27",
          mode: "analog",
          x: 0,
          y: 560
        },
        {
          id: "GP26",
          mode: "analog",
          x: 0,
          y: 580
        },
        {
          id: "RUN",
          mode: "unsupported",
          x: 0,
          y: 600
        },
        {
          id: "GP22",
          mode: "digital",
          x: 0,
          y: 620
        },
        {
          id: "GND6",
          mode: "ground",
          x: 0,
          y: 640
        },
        {
          id: "GP21",
          mode: "digital",
          x: 0,
          y: 660
        },
        {
          id: "GP20",
          mode: "digital",
          x: 0,
          y: 680
        },
        {
          id: "GP19",
          mode: "digital",
          x: 0,
          y: 700
        },
        {
          id: "GP18",
          mode: "digital",
          x: 0,
          y: 720
        },
        {
          id: "GND7",
          mode: "ground",
          x: 0,
          y: 740
        },
        {
          id: "GP17",
          mode: "digital",
          x: 0,
          y: 760
        },
        {
          id: "GP16",
          mode: "digital",
          x: 0,
          y: 780
        }
      ]
    },
    mega2560: {
      name: "Arduino Mega 2560",
      family: "atmega2560",
      language: "arduino",
      volts: 5,
      clock_hz: 16e6,
      adc_channels: 16,
      adc_bits: 10,
      power_pin: "5V",
      fqbn: "arduino:avr:mega:cpu=atmega2560",
      pins: [
        {
          id: "D0",
          mode: "digital",
          x: 0,
          y: 0
        },
        {
          id: "D1",
          mode: "digital",
          x: 0,
          y: 14
        },
        {
          id: "D2",
          mode: "digital",
          x: 0,
          y: 28
        },
        {
          id: "D3",
          mode: "digital",
          x: 0,
          y: 42
        },
        {
          id: "D4",
          mode: "digital",
          x: 0,
          y: 56
        },
        {
          id: "D5",
          mode: "digital",
          x: 0,
          y: 70
        },
        {
          id: "D6",
          mode: "digital",
          x: 0,
          y: 84
        },
        {
          id: "D7",
          mode: "digital",
          x: 0,
          y: 98
        },
        {
          id: "D8",
          mode: "digital",
          x: 0,
          y: 112
        },
        {
          id: "D9",
          mode: "digital",
          x: 0,
          y: 126
        },
        {
          id: "D10",
          mode: "digital",
          x: 0,
          y: 140
        },
        {
          id: "D11",
          mode: "digital",
          x: 0,
          y: 154
        },
        {
          id: "D12",
          mode: "digital",
          x: 0,
          y: 168
        },
        {
          id: "D13",
          mode: "digital",
          x: 0,
          y: 182
        },
        {
          id: "D14",
          mode: "digital",
          x: 0,
          y: 196
        },
        {
          id: "D15",
          mode: "digital",
          x: 0,
          y: 210
        },
        {
          id: "D16",
          mode: "digital",
          x: 0,
          y: 224
        },
        {
          id: "D17",
          mode: "digital",
          x: 0,
          y: 238
        },
        {
          id: "D18",
          mode: "digital",
          x: 0,
          y: 252
        },
        {
          id: "D19",
          mode: "digital",
          x: 0,
          y: 266
        },
        {
          id: "D20",
          mode: "digital",
          x: 0,
          y: 280
        },
        {
          id: "D21",
          mode: "digital",
          x: 0,
          y: 294
        },
        {
          id: "D22",
          mode: "digital",
          x: 0,
          y: 308
        },
        {
          id: "D23",
          mode: "digital",
          x: 0,
          y: 322
        },
        {
          id: "D24",
          mode: "digital",
          x: 0,
          y: 336
        },
        {
          id: "D25",
          mode: "digital",
          x: 0,
          y: 350
        },
        {
          id: "D26",
          mode: "digital",
          x: 0,
          y: 364
        },
        {
          id: "D27",
          mode: "digital",
          x: 0,
          y: 378
        },
        {
          id: "D28",
          mode: "digital",
          x: 0,
          y: 392
        },
        {
          id: "D29",
          mode: "digital",
          x: 0,
          y: 406
        },
        {
          id: "D30",
          mode: "digital",
          x: 0,
          y: 420
        },
        {
          id: "D31",
          mode: "digital",
          x: 0,
          y: 434
        },
        {
          id: "D32",
          mode: "digital",
          x: 0,
          y: 448
        },
        {
          id: "D33",
          mode: "digital",
          x: 0,
          y: 462
        },
        {
          id: "D34",
          mode: "digital",
          x: 0,
          y: 476
        },
        {
          id: "D35",
          mode: "digital",
          x: 0,
          y: 490
        },
        {
          id: "D36",
          mode: "digital",
          x: 0,
          y: 504
        },
        {
          id: "D37",
          mode: "digital",
          x: 0,
          y: 518
        },
        {
          id: "D38",
          mode: "digital",
          x: 0,
          y: 532
        },
        {
          id: "D39",
          mode: "digital",
          x: 0,
          y: 546
        },
        {
          id: "D40",
          mode: "digital",
          x: 0,
          y: 560
        },
        {
          id: "D41",
          mode: "digital",
          x: 0,
          y: 574
        },
        {
          id: "D42",
          mode: "digital",
          x: 0,
          y: 588
        },
        {
          id: "D43",
          mode: "digital",
          x: 0,
          y: 602
        },
        {
          id: "D44",
          mode: "digital",
          x: 0,
          y: 616
        },
        {
          id: "D45",
          mode: "digital",
          x: 0,
          y: 630
        },
        {
          id: "D46",
          mode: "digital",
          x: 0,
          y: 644
        },
        {
          id: "D47",
          mode: "digital",
          x: 0,
          y: 658
        },
        {
          id: "D48",
          mode: "digital",
          x: 0,
          y: 672
        },
        {
          id: "D49",
          mode: "digital",
          x: 0,
          y: 686
        },
        {
          id: "D50",
          mode: "digital",
          x: 0,
          y: 700
        },
        {
          id: "D51",
          mode: "digital",
          x: 0,
          y: 714
        },
        {
          id: "D52",
          mode: "digital",
          x: 0,
          y: 728
        },
        {
          id: "D53",
          mode: "digital",
          x: 0,
          y: 742
        },
        {
          id: "A0",
          mode: "analog",
          x: 0,
          y: 756
        },
        {
          id: "A1",
          mode: "analog",
          x: 0,
          y: 770
        },
        {
          id: "A2",
          mode: "analog",
          x: 0,
          y: 784
        },
        {
          id: "A3",
          mode: "analog",
          x: 0,
          y: 798
        },
        {
          id: "A4",
          mode: "analog",
          x: 0,
          y: 812
        },
        {
          id: "A5",
          mode: "analog",
          x: 0,
          y: 826
        },
        {
          id: "A6",
          mode: "analog",
          x: 0,
          y: 840
        },
        {
          id: "A7",
          mode: "analog",
          x: 0,
          y: 854
        },
        {
          id: "A8",
          mode: "analog",
          x: 0,
          y: 868
        },
        {
          id: "A9",
          mode: "analog",
          x: 0,
          y: 882
        },
        {
          id: "A10",
          mode: "analog",
          x: 0,
          y: 896
        },
        {
          id: "A11",
          mode: "analog",
          x: 0,
          y: 910
        },
        {
          id: "A12",
          mode: "analog",
          x: 0,
          y: 924
        },
        {
          id: "A13",
          mode: "analog",
          x: 0,
          y: 938
        },
        {
          id: "A14",
          mode: "analog",
          x: 0,
          y: 952
        },
        {
          id: "A15",
          mode: "analog",
          x: 0,
          y: 966
        },
        {
          id: "5V",
          mode: "power",
          x: 0,
          y: 980
        },
        {
          id: "3V3",
          mode: "power",
          x: 0,
          y: 994
        },
        {
          id: "GND",
          mode: "ground",
          x: 0,
          y: 1008
        },
        {
          id: "GND2",
          mode: "ground",
          x: 0,
          y: 1022
        },
        {
          id: "AREF",
          mode: "reference",
          x: 0,
          y: 1036
        },
        {
          id: "RESET",
          mode: "unsupported",
          x: 0,
          y: 1050
        },
        {
          id: "VIN",
          mode: "unsupported",
          x: 0,
          y: 1064
        },
        {
          id: "GND_TOP",
          mode: "ground",
          x: 0,
          y: 1100
        },
        {
          id: "IOREF",
          mode: "unsupported",
          x: 0,
          y: 1114
        },
        {
          id: "NC",
          mode: "unsupported",
          x: 0,
          y: 1128
        }
      ]
    }
  };

  // src/programmable_circuit/boards.mjs
  var BOARDS = Object.freeze(boards_default);
  function boardProfile(id) {
    if (!BOARDS[id]) throw Error("Unsupported board profile.");
    return BOARDS[id];
  }
  var isAVR = (id) => ["atmega328p", "atmega2560"].includes(boardProfile(id).family);

  // src/programmable_circuit/components.mjs
  var COMPONENTS = { "parts": { "breadboard": { "name": "Breadboard \xB7 8 rows", "pins": ["A1", "A2", "A3", "A4", "A5", "A6", "A7", "A8", "B1", "B2", "B3", "B4", "B5", "B6", "B7", "B8", "C1", "C2", "C3", "C4", "C5", "C6", "C7", "C8", "D1", "D2", "D3", "D4", "D5", "D6", "D7", "D8", "E1", "E2", "E3", "E4", "E5", "E6", "E7", "E8", "F1", "F2", "F3", "F4", "F5", "F6", "F7", "F8", "G1", "G2", "G3", "G4", "G5", "G6", "G7", "G8", "H1", "H2", "H3", "H4", "H5", "H6", "H7", "H8", "I1", "I2", "I3", "I4", "I5", "I6", "I7", "I8", "J1", "J2", "J3", "J4", "J5", "J6", "J7", "J8", "P1", "P2", "P3", "P4", "N1", "N2", "N3", "N4", "Q1", "Q2", "Q3", "Q4", "M1", "M2", "M3", "M4"], "defaults": {} }, "capacitor": { "name": "Capacitor", "pins": ["1", "2"], "defaults": { "capacitance_uf": 1, "initial_v": 0 } }, "sensor": { "name": "Analog temperature sensor", "pins": ["VCC", "OUT", "GND"], "defaults": { "temperature_c": 25, "gain": 1, "bias_v": 0, "noise_v": 0, "drift_v_s": 0, "seed": 1 } }, "generator": { "name": "Sine generator", "pins": ["OUT", "GND"], "defaults": { "offset_v": 1.65, "amplitude_v": 1, "frequency_hz": 100 } }, "motor": { "name": "DC motor + protected driver", "pins": ["VCC", "IN", "GND", "SPEED"], "defaults": { "resistance_ohms": 10, "inductance_mh": 1, "inertia_gcm2": 100, "friction_uNms": 10, "constant": 0.02, "load_mNm": 0, "feedback_rad_s_v": 50, "supply_v": 6 } }, "meter": { "name": "Voltmeter \xB7 10 M\u03A9", "pins": ["PLUS", "COM"], "defaults": {} }, "scope": { "name": "Oscilloscope \xB7 1 M\u03A9", "pins": ["CH1", "GND"], "defaults": {} }, "logic": { "name": "Logic analyzer \xB7 10 M\u03A9", "pins": ["IN", "GND"], "defaults": {} }, "display": { "name": "8-LED binary display", "pins": ["VCC", "GND", "D0", "D1", "D2", "D3", "D4", "D5", "D6", "D7"], "defaults": {} }, "ssd1306": { "name": "SSD1306 OLED \xB7 128 \xD7 64", "pins": ["GND", "VCC", "SCL", "SDA"], "defaults": { "address": 60, "capacitance_pf": 30, "sink_ma": 3 } }, "bmp280": { "name": "BMP280 \xB7 temperature / pressure", "pins": ["GND", "VCC", "SCL", "SDA"], "defaults": { "address": 118, "capacitance_pf": 30, "sink_ma": 3, "temperature_c": 25, "pressure_hpa": 1013.25 } }, "dht22": { "name": "DHT22 temperature / humidity", "pins": ["VCC", "DATA", "GND"], "defaults": { "temperature_c": 25, "humidity_pct": 50 } }, "ds1307": { "name": "DS1307 real-time clock", "pins": ["SDA", "SCL", "VCC", "GND"], "defaults": { "address": 104, "hour": 12, "minute": 0, "second": 0, "capacitance_pf": 20, "sink_ma": 3 } }, "a4988_stepper": { "name": "A4988 + bipolar stepper", "pins": ["STEP", "DIR", "ENABLE", "MS1", "MS2", "MS3", "VCC", "GND", "VMOT", "PGND"], "defaults": { "step_angle_deg": 1.8 } }, "opamp": { "name": "Finite-gain op-amp \xB7 low-voltage teaching model", "pins": ["PLUS", "MINUS", "OUT", "VCC", "GND"], "defaults": { "open_gain": 1e4, "output_ohms": 50, "headroom_v": 0.2 } }, "npn": { "name": "NPN transistor \xB7 teaching model", "pins": ["B", "C", "E"], "defaults": { "beta": 100, "is_a": 1e-14 } }, "nmos": { "name": "N-channel MOSFET \xB7 teaching model", "pins": ["G", "D", "S"], "defaults": { "threshold_v": 1.5, "kp_a_v2": 0.02 } }, "motor_supply": { "name": "External motor supply", "pins": ["OUT", "GND"], "defaults": { "supply_v": 12 } } }, "ranges": { "capacitance_uf": [1e-3, 1e4], "initial_v": [-5, 5], "temperature_c": [-40, 125], "gain": [0.5, 1.5], "bias_v": [-0.5, 0.5], "noise_v": [0, 0.2], "drift_v_s": [-0.1, 0.1], "seed": [1, 2147483647], "offset_v": [0, 5], "amplitude_v": [0, 2.5], "frequency_hz": [0.1, 1e3], "resistance_ohms": [1, 1e3], "inductance_mh": [0.01, 1e3], "inertia_gcm2": [1, 1e5], "friction_uNms": [1, 1e3], "constant": [1e-3, 0.2], "load_mNm": [0, 100], "feedback_rad_s_v": [1, 1e3], "bounce_ms": [0, 30], "capacitance_pf": [1, 2e3], "sink_ma": [1, 20], "bits": [5, 8], "parity": [0, 2], "stop": [1, 2], "clock_ppm": [-1e5, 1e5], "noise_ppm": [0, 1e5], "supply_v": [1, 24], "address": [8, 119], "pressure_hpa": [300, 1100], "humidity_pct": [0, 100], "hour": [0, 23], "minute": [0, 59], "second": [0, 59], "step_angle_deg": [0.9, 7.5], "open_gain": [100, 1e5], "output_ohms": [1, 1e3], "headroom_v": [0, 2], "beta": [10, 300], "is_a": [1e-16, 1e-10], "threshold_v": [0.5, 4], "kp_a_v2": [1e-3, 1] }, "optional": { "button": { "bounce_ms": 0, "seed": 1 }, "uart": { "bits": 8, "parity": 0, "stop": 1, "clock_ppm": 0, "noise_ppm": 0, "seed": 1 }, "i2c": { "capacitance_pf": 100, "sink_ma": 3, "temperature_c": 25 } } };

  // src/programmable_circuit/graph.mjs
  var VERSION = "microexplore-programmable-v1";
  var LIMITS = { parts: 24, wires: 96, source: 2e4, seconds: 8, events: 8e3, serial: 8192 };
  var pins = (names) => names.map((id, i) => ({ id, x: 0, y: 30 + i * 22 }));
  var boardPins = (board) => boardProfile(board).pins;
  var PARTS = {
    resistor: { name: "Resistor", pins: pins(["1", "2"]), defaults: { ohms: 330 } },
    led: { name: "LED", pins: pins(["A", "K"]), defaults: { vf: 2 } },
    button: { name: "Pushbutton", pins: pins(["1", "2"]), defaults: { pressed: false } },
    pot: { name: "Potentiometer", pins: pins(["VCC", "OUT", "GND"]), defaults: { ohms: 1e4, position: 0.5 } },
    source: { name: "Analog source", pins: pins(["OUT", "GND"]), defaults: { volts: 1.65 } },
    rail: { name: "Power rail", pins: pins(["VCC", "GND"]), defaults: {} },
    digital: { name: "Digital probe / load", pins: pins(["IN", "GND"]), defaults: { ohms: 1e5 } },
    uart: { name: "UART receiver / transmitter", pins: pins(["RX", "TX", "VCC", "GND"]), defaults: { baud: 9600 } },
    i2c: { name: "I2C register sensor", pins: pins(["SDA", "SCL", "VCC", "GND"]), defaults: { address: 72 } },
    pwm: { name: "PWM command load", pins: pins(["IN", "GND"]), defaults: { ohms: 1e4 } }
  };
  for (const [type, v] of Object.entries(COMPONENTS.parts)) PARTS[type] = { ...v, pins: pins(v.pins) };
  function params(part) {
    return { ...PARTS[part.type]?.defaults, ...COMPONENTS.optional[part.type], ...part.params };
  }
  var railVoltage = (b) => boardProfile(b).volts;
  var logicThresholds = (b) => isAVR(b) ? { low: 1.5, high: 3 } : { low: 0.8, high: 2 };
  function partPins(p, b) {
    return p.type === "board" ? boardPins(b) : PARTS[p.type]?.pins || [];
  }
  var endpoint = (part, pin) => part + ":" + pin;
  function validate(p) {
    if (!p || p.project_version !== VERSION || !Object.hasOwn(BOARDS, p.board_type)) throw Error("Unsupported project or board version.");
    const allowed = ["project_version", "board_profile_version", "board_type", "name", "revision", "parts", "wires", "source", "notes", "language", "task", "runs", "files", "peer", "network_connected"];
    if (Object.keys(p).some((k) => !allowed.includes(k)) || p.board_profile_version !== "vendor-pin-map-v1" || p.language !== (isAVR(p.board_type) ? "arduino" : "micropython")) throw Error("Unsupported project fields, profile or language.");
    if (typeof p.name !== "string" || p.name.length > 80 || typeof p.notes !== "string" || p.notes.length > 2600 || !Number.isInteger(p.revision) || p.revision < 1 || p.revision > 1e6 || !Array.isArray(p.runs) || p.runs.length) throw Error("Invalid project metadata; import definitions without claimed runs.");
    if (!Array.isArray(p.parts) || p.parts.length > LIMITS.parts || !Array.isArray(p.wires) || p.wires.length > LIMITS.wires) throw Error("Budget: 24 parts and 96 wires.");
    if (typeof p.source !== "string" || p.source.length > LIMITS.source) throw Error("Firmware source budget: 20,000 characters.");
    if (p.peer) {
      if (p.peer.peer || !isAVR(p.board_type) || !isAVR(p.peer.board_type) || typeof p.network_connected !== "boolean") throw Error("A UART pair requires exactly two AVR boards and an explicit cable state.");
      validate(p.peer);
    }
    projectFiles(p);
    if (p.parts.filter((x) => x.type === "board").length !== 1) throw Error("Use exactly one MCU board.");
    const ids = /* @__PURE__ */ new Set(), ends = /* @__PURE__ */ new Set();
    for (const a of p.parts) {
      if (!/^[a-zA-Z][a-zA-Z0-9_-]{0,31}$/.test(a.id) || ids.has(a.id) || !(a.type === "board" || PARTS[a.type])) throw Error("Invalid or duplicate supported part.");
      ids.add(a.id);
      if (![a.x, a.y, a.rotation].every(Number.isFinite) || Math.abs(a.x) > 3e3 || Math.abs(a.y) > 3e3 || ![0, 90, 180, 270].includes(a.rotation)) throw Error("Part placement is outside the canvas budget.");
      for (const pin of partPins(a, p.board_type)) if (pin.mode !== "unsupported") ends.add(endpoint(a.id, pin.id));
    }
    for (const a of p.parts) {
      if (Object.keys(a).some((k) => !["id", "type", "x", "y", "rotation", "params"].includes(k))) throw Error("Unsupported part fields.");
      const defaults = a.type === "board" ? {} : PARTS[a.type].defaults;
      if (!a.params || Object.keys(defaults).some((k) => !(k in a.params)) || Object.keys(a.params).some((k) => !(k in defaults) && !(k in (COMPONENTS.optional[a.type] || {})))) throw Error("Unsupported part parameters.");
      for (const [k, v] of Object.entries(a.params)) {
        if (k === "pressed") {
          if (typeof v !== "boolean") throw Error("Button state must be Boolean.");
        } else if (typeof v !== "number" || !Number.isFinite(v)) throw Error("Part parameters must be finite numeric measurements.");
      }
      const q = a.params;
      if (a.type === "ds1307" && q.address !== 104) throw Error("DS1307 address is fixed at 104.");
      if (a.type === "dht22" && (q.temperature_c < -40 || q.temperature_c > 80)) throw Error("DHT22 range is -40..80 C.");
      if (a.type === "ssd1306" && ![60, 61].includes(q.address)) throw Error("OLED address must be 60 or 61.");
      if (a.type === "bmp280" && (![118, 119].includes(q.address) || q.temperature_c < -40 || q.temperature_c > 85)) throw Error("BMP280 address 118/119, temperature -40..85 C.");
      for (const [k, v] of Object.entries(q)) {
        const range = COMPONENTS.ranges[k];
        if (range && (!(v >= range[0] && v <= range[1]) || ["seed", "bits", "parity", "stop"].includes(k) && !Number.isInteger(v))) throw Error("Invalid " + k + " parameter.");
      }
      if (a.type === "generator" && (q.offset_v - q.amplitude_v < 0 || q.offset_v + q.amplitude_v > railVoltage(p.board_type))) throw Error("Generator output must remain within board rails.");
      if ("ohms" in q && (q.ohms < 1 || q.ohms > 1e7) || "volts" in q && (q.volts < 0 || q.volts > railVoltage(p.board_type)) || "position" in q && (q.position < 0 || q.position > 1) || "vf" in q && (q.vf < 1 || q.vf > 3.6) || "address" in q && (!Number.isInteger(q.address) || q.address < 8 || q.address > 119) || "baud" in q && (!Number.isInteger(q.baud) || q.baud < 300 || q.baud > 115200)) throw Error("Part parameter outside the supported range.");
    }
    const wires = /* @__PURE__ */ new Set(), wireids = /* @__PURE__ */ new Set();
    for (const w of p.wires) {
      if (!/^[A-Za-z][A-Za-z0-9_-]{0,31}$/.test(w.id) || wireids.has(w.id) || Object.keys(w).some((k2) => !["id", "a", "b", "color", "points"].includes(k2))) throw Error("Invalid or duplicate wire fields.");
      wireids.add(w.id);
      if (!ends.has(w.a) || !ends.has(w.b) || w.a === w.b) throw Error("Wire endpoint is invalid.");
      const k = [w.a, w.b].sort().join("|");
      if (wires.has(k)) throw Error("Duplicate wire.");
      wires.add(k);
      if (!/^#[0-9a-fA-F]{6}$/.test(w.color)) throw Error("Choose a six-digit wire color.");
      if (!Array.isArray(w.points) || w.points.length > 12 || w.points.some((pt) => !Array.isArray(pt) || pt.length !== 2 || pt.some((n) => !Number.isFinite(n) || Math.abs(n) > 3e3))) throw Error("Invalid route.");
    }
    return p;
  }
  function netlist(p) {
    validate(p);
    const parent = /* @__PURE__ */ new Map();
    for (const a of p.parts) for (const pin of partPins(a, p.board_type)) parent.set(endpoint(a.id, pin.id), endpoint(a.id, pin.id));
    const find = (x) => {
      if (parent.get(x) !== x) parent.set(x, find(parent.get(x)));
      return parent.get(x);
    };
    for (const w of p.wires) parent.set(find(w.a), find(w.b));
    for (const a of p.parts.filter((x) => x.type === "breadboard")) {
      const join = (names) => names.slice(1).forEach((k) => parent.set(find(endpoint(a.id, k)), find(endpoint(a.id, names[0]))));
      for (let i = 1; i <= 8; i++) {
        join([..."ABCDE"].map((c) => c + i));
        join([..."FGHIJ"].map((c) => c + i));
      }
      for (const c of ["P", "N", "Q", "M"]) join([1, 2, 3, 4].map((i) => c + i));
    }
    const board = p.parts.find((x) => x.type === "board");
    const grounds = boardPins(p.board_type).filter((x) => x.mode === "ground").map((x) => endpoint(board.id, x.id));
    for (const g of grounds) parent.set(find(g), find(grounds[0]));
    const net = new Map([...parent.keys()].map((x) => [x, find(x)]));
    return { net, ground: net.get(grounds[0]), board: board.id, groups: [...new Set(net.values())].map((n) => ({ id: n, endpoints: [...net].filter((x) => x[1] === n).map((x) => x[0]) })) };
  }
  function linear(A, b) {
    const n = b.length;
    for (let k = 0; k < n; k++) {
      let m = k;
      for (let i = k + 1; i < n; i++) if (Math.abs(A[i][k]) > Math.abs(A[m][k])) m = i;
      if (Math.abs(A[m][k]) < 1e-13) throw Error("Floating or singular electrical net.");
      [A[k], A[m]] = [A[m], A[k]];
      [b[k], b[m]] = [b[m], b[k]];
      const q = A[k][k];
      for (let j = k; j < n; j++) A[k][j] /= q;
      b[k] /= q;
      for (let i = 0; i < n; i++) if (i !== k) {
        const f = A[i][k];
        if (f) {
          for (let j = k; j < n; j++) A[i][j] -= f * A[k][j];
          b[i] -= f * b[k];
        }
      }
    }
    return b;
  }
  function solve(p, drives = {}, dynamic = null) {
    if (p.parts.some((a) => ["opamp", "npn", "nmos"].includes(a.type))) return solveActive(p, drives, dynamic, { nl: netlist(p), pins: boardPins(p.board_type), rail: railVoltage(p.board_type), profile: boardProfile(p.board_type) });
    const nl = netlist(p), net = nl.net, V = railVoltage(p.board_type), gnd = nl.ground, known = /* @__PURE__ */ new Map([[gnd, 0]]), warnings = [], branches = [], leds = [];
    const node = (id, pin) => net.get(endpoint(id, pin));
    const set = (n, v, label) => {
      if (known.has(n) && Math.abs(known.get(n) - v) > 0.05) throw Error("Short / conflicting drivers at " + label + ". Stop and correct wiring.");
      known.set(n, v);
    };
    const resistor = (a, b, r, offset = 0) => {
      if (!Number.isFinite(r) || r <= 0 || r > 1e15) throw Error("Supported resistance is 1 ohm to 10 Mohm.");
      if (a !== b) branches.push({ a, b, r, offset });
    };
    for (const pin of boardPins(p.board_type)) {
      const n = node(nl.board, pin.id);
      if (p.board_type === "pico_rp2040" && pin.id === "ADC_VREF") set(n, 3.3, pin.id);
      if (pin.mode === "power") {
        if (["VSYS", "VBUS"].includes(pin.id)) continue;
        set(n, pin.id === "3V3" ? 3.3 : V, pin.id);
      }
      const d = drives[pin.id];
      if (d === 0 || d === 1) set(n, d * V, pin.id);
      else if (d === 3) resistor(n, node(nl.board, boardProfile(p.board_type).power_pin), 5e4);
      else if (d === 4) resistor(n, gnd, 5e4);
    }
    for (const a of p.parts) {
      const n = (k) => node(a.id, k), q = a.params || {};
      if (a.type === "capacitor" && dynamic) {
        const c = q.capacitance_uf * 1e-6, dt = dynamic.dt || 1e-9;
        resistor(n("1"), n("2"), dt / c, dynamic.capacitors[a.id] ?? q.initial_v);
      }
      if (["sensor", "generator", "motor"].includes(a.type) && dynamic?.outputs[a.id] !== void 0) {
        const out = a.type === "motor" ? "SPEED" : "OUT";
        if (n("GND") === gnd) set(n(out), dynamic.outputs[a.id], a.id);
      }
      if (a.type === "meter") resistor(n("PLUS"), n("COM"), 1e7);
      if (a.type === "scope") resistor(n("CH1"), n("GND"), 1e6);
      if (a.type === "logic") resistor(n("IN"), n("GND"), 1e7);
      if (a.type === "motor") resistor(n("IN"), n("GND"), 1e5);
      if (a.type === "display") {
        for (let i = 0; i < 8; i++) resistor(n("D" + i), n("GND"), 1e6);
      }
      if (a.type === "resistor") resistor(n("1"), n("2"), +q.ohms);
      if (a.type === "button" && q.pressed) resistor(n("1"), n("2"), 1);
      if (a.type === "pot") {
        const f = +q.position;
        if (!(f >= 0 && f <= 1)) throw Error("Potentiometer position must be 0\u20131.");
        resistor(n("VCC"), n("OUT"), Math.max(1, +q.ohms * (1 - f)));
        resistor(n("OUT"), n("GND"), Math.max(1, +q.ohms * f));
      }
      if (a.type === "motor_supply" && n("GND") === gnd) set(n("OUT"), q.supply_v, a.id);
      if (a.type === "source") {
        if (!Number.isFinite(+q.volts) || +q.volts < 0 || +q.volts > V) throw Error("Source exceeds the board logic rail.");
        if (n("GND") === gnd) set(n("OUT"), +q.volts, a.id);
        else warnings.push(a.id + ": source ground is not connected to board GND.");
      }
      if (["digital", "pwm"].includes(a.type)) resistor(n("IN"), n("GND"), +q.ohms);
      if (a.type === "led") {
        if (!(+q.vf >= 1 && +q.vf <= 3.6)) throw Error("LED forward drop must be 1\u20133.6 V.");
        leds.push({ id: a.id, a: n("A"), b: n("K"), vf: +q.vf, on: true });
      }
    }
    let volt = new Map(known), reachable = new Set(known.keys());
    for (let it = 0; it < 20; it++) {
      let change = false;
      for (const r of branches) if (reachable.has(r.a) || reachable.has(r.b)) {
        if (!reachable.has(r.a) || !reachable.has(r.b)) change = true;
        reachable.add(r.a);
        reachable.add(r.b);
      }
      for (const l of leds) {
        if (reachable.has(l.a) && !reachable.has(l.b) && l.b === gnd) {
          reachable.add(l.b);
          change = true;
        }
      }
      if (!change) break;
    }
    for (let pass = 0; pass < 12; pass++) {
      const active2 = [...branches, ...leds.filter((l) => l.on).map((l) => ({ a: l.a, b: l.b, r: 10, offset: l.vf }))];
      reachable = new Set(known.keys());
      for (let k = 0; k < 100; k++) {
        let changed2 = false;
        for (const r of active2) if (reachable.has(r.a) || reachable.has(r.b)) {
          if (!reachable.has(r.a) || !reachable.has(r.b)) changed2 = true;
          reachable.add(r.a);
          reachable.add(r.b);
        }
        if (!changed2) break;
      }
      const unknown = [...reachable].filter((n) => !known.has(n)), index = new Map(unknown.map((n, i) => [n, i])), A = unknown.map(() => unknown.map(() => 0)), b = unknown.map(() => 0);
      for (const r of active2) {
        if (!reachable.has(r.a) || !reachable.has(r.b)) continue;
        for (const [a, c, off] of [[r.a, r.b, r.offset], [r.b, r.a, -r.offset]]) {
          if (known.has(a)) continue;
          const i = index.get(a), g = 1 / r.r;
          A[i][i] += g;
          if (known.has(c)) b[i] += g * known.get(c);
          else A[i][index.get(c)] -= g;
          b[i] += g * off;
        }
      }
      const v = linear(A, b);
      volt = new Map(known);
      unknown.forEach((n, i) => volt.set(n, v[i]));
      let changed = false;
      for (const l of leds) {
        const va = volt.get(l.a), vb = volt.get(l.b);
        const on = Number.isFinite(va) && Number.isFinite(vb) && va - vb > l.vf + 1e-8;
        if (on !== l.on) {
          l.on = on;
          changed = true;
        }
      }
      if (!changed) break;
      if (pass === 11) throw Error("LED operating point did not converge. This topology is not supported; no valid measurements issued.");
    }
    const values = Object.fromEntries([...net].map(([e, n]) => [e, volt.get(n) ?? null]));
    const states = leds.map((l) => {
      const a = volt.get(l.a), b = volt.get(l.b), ma = Number.isFinite(a) && Number.isFinite(b) && l.on ? Math.max(0, (a - b - l.vf) / 10) * 1e3 : 0;
      if (ma > 20.01) throw Error("LED " + l.id + " exceeds 20 mA. Fit a series resistor.");
      return { id: l.id, current_ma: ma, on: ma > 0.2 };
    });
    for (const pin of boardPins(p.board_type)) {
      const v = values[endpoint(nl.board, pin.id)];
      if (["digital", "analog"].includes(pin.mode) && v !== null && (v < -0.05 || v > V + 0.05)) throw Error("Voltage at " + pin.id + " exceeds board limits.");
    }
    const active = [...branches, ...leds.filter((l) => l.on).map((l) => ({ a: l.a, b: l.b, r: 10, offset: l.vf }))], currentAt = (n) => active.reduce((sum, r) => {
      const a = volt.get(r.a), b = volt.get(r.b);
      if (!Number.isFinite(a) || !Number.isFinite(b)) return sum;
      const i = (a - b - r.offset) / r.r;
      return sum + (r.a === n ? i : r.b === n ? -i : 0);
    }, 0);
    const driven = /* @__PURE__ */ new Map();
    let total = 0;
    for (const pin of boardPins(p.board_type)) {
      if (drives[pin.id] !== 0 && drives[pin.id] !== 1) continue;
      const n = node(nl.board, pin.id);
      if (driven.has(n)) throw Error("Two ideal MCU output drivers share a net. Use separate nets or a modeled buffer.");
      driven.set(n, pin.id);
      const ma = Math.abs(currentAt(n)) * 1e3, limit = isAVR(p.board_type) ? 20 : 12;
      if (ma > limit + 0.01) throw Error("GPIO " + pin.id + " exceeds the " + limit + " mA simulator teaching budget. Reduce the load.");
      total += ma;
    }
    if (total > 50.01) throw Error("Combined GPIO current exceeds the 50 mA simulator teaching budget.");
    for (const a of p.parts.filter((x) => x.type === "resistor")) {
      const v1 = volt.get(node(a.id, "1")), v2 = volt.get(node(a.id, "2"));
      if (Number.isFinite(v1) && Number.isFinite(v2) && (v1 - v2) ** 2 / a.params.ohms > 0.25001) throw Error("Resistor " + a.id + " exceeds the assumed 0.25 W teaching rating.");
    }
    for (const pin of boardPins(p.board_type).filter((x) => x.mode === "power")) if (Math.abs(currentAt(node(nl.board, pin.id))) > 0.10001) throw Error("Board rail load exceeds the 100 mA simulator teaching budget.");
    const capacitors = {};
    for (const a of p.parts.filter((x) => x.type === "capacitor")) {
      const v1 = values[endpoint(a.id, "1")], v2 = values[endpoint(a.id, "2")];
      if (v1 !== null && v2 !== null) capacitors[a.id] = v1 - v2;
    }
    return { values, leds: states, warnings, nets: nl.groups, ground: gnd, capacitors };
  }
  function peripheralConnection(p, type, pins2) {
    const n = netlist(p), s = solve(p, {}), V = railVoltage(p.board_type);
    for (const part of p.parts.filter((x) => x.type === type)) {
      const pin = (k) => s.values[endpoint(part.id, k)];
      if (pin("GND") !== 0 || pin("VCC") === null || pin("VCC") < 2.7 || pin("VCC") > V + 0.2) continue;
      if (Object.entries(pins2).every(([a, b]) => n.net.get(endpoint(n.board, a)) === n.net.get(endpoint(part.id, b)))) return part;
    }
    return null;
  }

  // src/programmable_circuit/timed_peripherals.mjs
  var TimedPeripherals = class {
    constructor(p) {
      this.p = p;
      this.nl = netlist(p);
      this.devices = /* @__PURE__ */ new Map();
      this.override = {};
      for (const a of p.parts) {
        if (a.type === "dht22") this.devices.set(a.id, new DHT22(params(a)));
        if (a.type === "a4988_stepper") this.devices.set(a.id, new StepperDriver(params(a)));
      }
    }
    tick(t, states, electric) {
      if (!this.devices.size || !electric) return false;
      const next = {}, v = (a, k) => electric.values[a + ":" + k], high = (x) => x !== null && x >= 2;
      for (const [id, d] of this.devices) {
        const powered = v(id, "VCC") >= 2.7 && v(id, "GND") === 0;
        if (d instanceof DHT22) {
          const net = this.nl.net.get(id + ":DATA"), pin = boardPins(this.p.board_type).find((k) => this.nl.net.get(this.nl.board + ":" + k.id) === net);
          if (!pin) continue;
          const pulled = this.p.parts.some((a) => a.type === "resistor" && ["1", "2"].some((k) => this.nl.net.get(a.id + ":" + k) === net && v(a.id, k === "1" ? "2" : "1") >= 2.7));
          const level = d.update(t, states[pin.id], powered, pulled);
          if (level !== null && states[pin.id] >= 2) next[pin.id] = level;
        } else {
          const bits = (high(v(id, "MS1")) ? 1 : 0) | (high(v(id, "MS2")) ? 2 : 0) | (high(v(id, "MS3")) ? 4 : 0), microstep = { 0: 1, 1: 2, 2: 4, 3: 8, 7: 16 }[bits];
          if (!microstep) {
            d.fault = "Unsupported A4988 microstep combination";
            continue;
          }
          d.update(t, { step: high(v(id, "STEP")), dir: high(v(id, "DIR")), enabled: v(id, "ENABLE") !== null && v(id, "ENABLE") < 0.8, powered: powered && v(id, "VMOT") >= 8 && v(id, "VMOT") <= 24 && v(id, "PGND") === 0, microstep });
        }
      }
      const changed = JSON.stringify(next) !== JSON.stringify(this.override);
      this.override = next;
      return changed;
    }
    snapshot() {
      return Object.fromEntries([...this.devices].map(([id, d]) => [id, d.snapshot()]));
    }
  };

  // src/programmable_circuit/vendor/velxio/models.mjs
  var __defProp2 = Object.defineProperty;
  var __defNormalProp = (obj, key, value) => key in obj ? __defProp2(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
  var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
  /*! Adapted from Velxio, commit 25f3251c303e54acbf65b88e56af3052bfc072c3. AGPL-3.0-or-later. See LICENSE and PROVENANCE.json. */
  var SSD1306Core = class _SSD1306Core {
    constructor() {
      __publicField(this, "buffer", new Uint8Array(128 * 8));
      __publicField(this, "col", 0);
      __publicField(this, "page", 0);
      __publicField(this, "colStart", 0);
      __publicField(this, "colEnd", 127);
      __publicField(this, "pageStart", 0);
      __publicField(this, "pageEnd", 7);
      __publicField(this, "memMode", 2);
      __publicField(this, "displayOn", false);
      __publicField(this, "contrast", 127);
      __publicField(this, "inverse", false);
      __publicField(this, "entireOn", false);
      __publicField(this, "segRemap", false);
      __publicField(this, "comRemap", false);
      __publicField(this, "displayOffset", 0);
      __publicField(this, "startLine", 0);
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
      this.cmdWant = _SSD1306Core.cmdParams(value);
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
  };
  var BMP280_RULES = {
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
  var BMP_RESET = 224;
  var BMP_RESET_WORD = BMP280_RULES.reset[BMP_RESET];
  var BMP_STATUS = 243;
  var BMP_MEASURING = BMP280_RULES.status[BMP_STATUS];
  var BMP_CTRL_MEAS = BMP280_RULES.mode.register;
  var BMP_MODE = BMP280_RULES.mode.mask;
  var BMP_SLEEP = BMP280_RULES.mode.sleep;
  var BMP_NORMAL = BMP280_RULES.mode.normal;
  var [BMP_SAMPLE_FIRST, BMP_SAMPLE_LAST] = BMP280_RULES.sample;
  var BMP_WRITABLE = new Uint8Array(256);
  for (const reg of BMP280_RULES.writable) BMP_WRITABLE[reg] = 1;
  var VirtualBMP280 = class _VirtualBMP280 {
    constructor(address = 118) {
      __publicField(this, "address");
      __publicField(this, "onAsleepRead", null);
      __publicField(this, "registers", new Uint8Array(256));
      __publicField(this, "live", new Uint8Array(BMP_SAMPLE_LAST - BMP_SAMPLE_FIRST + 1));
      __publicField(this, "regPtr", 0);
      __publicField(this, "firstByte", true);
      __publicField(this, "measuring", false);
      __publicField(this, "measured", false);
      __publicField(this, "latchDue", true);
      __publicField(this, "asleepReadSaid", false);
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
      this.live.set([..._VirtualBMP280.encodeAdc20(adcP), ..._VirtualBMP280.encodeAdc20(adcT)]);
    }
  };

  // src/programmable_circuit/physics.mjs
  var PHYSICS_VERSION = "microexplore-physics-v1";
  function uniform(seed, index) {
    let x = Math.imul((seed | 0) ^ 2654435769, (index | 0) + 1) >>> 0;
    x ^= x >>> 16;
    x = Math.imul(x, 2146121005);
    x ^= x >>> 15;
    x = Math.imul(x, 2221713035);
    return ((x ^ x >>> 16) >>> 0) / 4294967296;
  }
  function sensorVoltage(q, t, rail) {
    const noise = (uniform(q.seed ?? 1, Math.floor(t * 1e3)) * 2 - 1) * (q.noise_v ?? 0);
    return Math.max(0, Math.min(rail, ((q.temperature_c ?? 25) * 0.01 + 0.5) * (q.gain ?? 1) + (q.bias_v ?? 0) + (q.drift_v_s ?? 0) * t + noise));
  }
  function sineVoltage(q, t) {
    return q.offset_v + q.amplitude_v * Math.sin(2 * Math.PI * q.frequency_hz * t);
  }
  function bounceSchedule(now, pressed, duration_ms, seed = 1) {
    if (!duration_ms) return [{ t_us: now, pressed }];
    const out = [];
    let time = now, state = pressed;
    for (let i = 0; i < 8; i++) {
      out.push({ t_us: time, pressed: state });
      time += duration_ms * 1e3 * (0.04 + 0.06 * uniform(seed, i));
      state = !state;
    }
    out.push({ t_us: now + duration_ms * 1e3, pressed });
    return out.sort((a, b) => a.t_us - b.t_us);
  }
  function i2cQuality({ ohms, capacitance_pf, frequency_hz, volts, sink_ma = 3, high_us }) {
    const rc = ohms * capacitance_pf * 1e-12, tr = rc * Math.log(7 / 3), limit = frequency_hz <= 1e5 ? 1e-6 : frequency_hz <= 4e5 ? 3e-7 : 12e-8;
    const high = high_us === void 0 ? 0.5 / frequency_hz : high_us * 1e-6, threshold = rc * -Math.log(0.3), low = Math.max(0, volts - sink_ma * 1e-3 * ohms);
    const valid = Number.isFinite(ohms) && ohms > 0 && frequency_hz > 0 && frequency_hz <= 1e6;
    return { pullup_ohms: Number.isFinite(ohms) ? ohms : null, capacitance_pf, frequency_hz, rise_ns: valid ? tr * 1e9 : null, rise_limit_ns: limit * 1e9, high_us: high * 1e6, time_to_high_ns: valid ? threshold * 1e9 : null, low_voltage_v: valid ? low : null, standard_compliant: valid && tr <= limit && low <= 0.4, usable: valid && threshold < high && low <= 0.3 * volts, margin_us: valid ? (high - threshold) * 1e6 : null };
  }
  var parity = (v, bits) => {
    let n = 0;
    for (let i = 0; i < bits; i++) n ^= v >> i & 1;
    return n;
  };
  function uartFrame(value, tx, rx, { seed = 1, index = 0, noise_ppm = 0 } = {}) {
    const bits = [0, ...Array.from({ length: tx.bits ?? 8 }, (_, i) => value >> i & 1)];
    if (tx.parity) bits.push(parity(value, tx.bits ?? 8) ^ (tx.parity === 2 ? 1 : 0));
    for (let i = 0; i < (tx.stop ?? 1); i++) bits.push(1);
    if (!(tx.baud > 0 && rx.baud > 0)) return { ok: false, reason: "clock not configured", value: null, samples: [] };
    const sample = (t) => {
      const k = Math.floor(t * tx.baud), bit = k < 0 || k >= bits.length ? 1 : bits[k];
      return uniform(seed, index * 53 + k + 2) < noise_ppm / 1e6 ? 1 - bit : bit;
    };
    const samples = Array.from({ length: 1 + (rx.bits ?? 8) + (rx.parity ? 1 : 0) + (rx.stop ?? 1) }, (_, i) => {
      const times = [7, 8, 9].map((n) => (i + n / 16) / rx.baud), levels = times.map(sample);
      return { t_us: times[1] * 1e6, value: levels.reduce((a, b) => a + b, 0) >= 2 ? 1 : 0 };
    });
    let decoded = 0;
    for (let i = 0; i < (rx.bits ?? 8); i++) decoded |= samples[i + 1].value << i;
    const parityOK = !rx.parity || samples[1 + (rx.bits ?? 8)].value === (parity(decoded, rx.bits ?? 8) ^ (rx.parity === 2 ? 1 : 0));
    const frameOK = samples[0].value === 0 && samples.slice(1 + (rx.bits ?? 8) + (rx.parity ? 1 : 0)).every((x) => x.value === 1);
    return { ok: frameOK && parityOK, value: decoded, framing_error: !frameOK, parity_error: !parityOK, changed: decoded !== (value & (1 << (rx.bits ?? 8)) - 1), tx_baud: tx.baud, rx_baud: rx.baud, samples, duration_us: bits.length / tx.baud * 1e6 };
  }
  function motorStep(old, q, voltage, dt) {
    if (!(dt > 0)) return old;
    const R = q.resistance_ohms, L = q.inductance_mh * 1e-3, J = q.inertia_gcm2 * 1e-7, b = q.friction_uNms * 1e-6, k = q.constant, load = q.load_mNm * 1e-3;
    const a = -R / L, d = -b / J, bc = -k * k / (L * J), mu = (a + d) / 2, delta2 = ((a - d) / 2) ** 2 + bc;
    const omega = (k * voltage / R - load) / (b + k * k / R), current = (voltage - k * omega) / R;
    let c, s;
    if (delta2 >= 0) {
      const z = Math.sqrt(delta2), e1 = Math.exp((mu + z) * dt), e2 = Math.exp((mu - z) * dt);
      c = (e1 + e2) / 2;
      s = z > 1e-12 ? (e1 - e2) / (2 * z) : dt * Math.exp(mu * dt);
    } else {
      const z = Math.sqrt(-delta2), e = Math.exp(mu * dt);
      c = e * Math.cos(z * dt);
      s = e * Math.sin(z * dt) / z;
    }
    const x = (old.current_a ?? 0) - current, y = (old.omega_rad_s ?? 0) - omega;
    return { current_a: current + c * x + s * ((a - mu) * x - k / L * y), omega_rad_s: omega + c * y + s * (k / J * x + (d - mu) * y) };
  }

  // src/programmable_circuit/i2c_devices.mjs
  var OLEDDevice = class {
    constructor() {
      this.core = new SSD1306Core();
      this.writes = 0;
      this.start(false);
    }
    start(read) {
      this.control = true;
      this.continue = false;
      this.data = false;
      return !read;
    }
    writeByte(v) {
      if (this.control) {
        if (v & 63) return false;
        this.data = !!(v & 64);
        this.continue = !!(v & 128);
        this.control = false;
        return true;
      }
      this.data ? this.core.writeData(v) : this.core.writeCommand(v);
      this.writes++;
      this.control = this.continue;
      return true;
    }
    stop() {
    }
    snapshot() {
      return { ...this.core.snapshot(), bytes_written: this.writes };
    }
  };
  var I2CDevices = class {
    constructor(project, clock = () => 0) {
      this.p = project;
      this.devices = /* @__PURE__ */ new Map();
      this.status = {};
      this.selected = null;
      for (const part of project.parts) {
        const q = params(part);
        let d;
        if (part.type === "ds1307") d = new DS1307(q, clock);
        if (part.type === "ssd1306") d = new OLEDDevice();
        if (part.type === "bmp280") {
          d = new VirtualBMP280(q.address);
          d.temperatureC = q.temperature_c;
          d.pressureHPa = q.pressure_hpa;
        }
        if (part.type === "i2c") d = { reg: 0, index: 0, first: true, start(read) {
          if (!read) this.first = true;
          this.index = 0;
        }, writeByte(v) {
          if (this.first) this.reg = v;
          this.first = false;
          return true;
        }, readByte() {
          const raw = Math.round(q.temperature_c * 256) & 65535;
          return this.reg === 0 ? this.index++ % 2 ? raw & 255 : raw >>> 8 : 0;
        }, stop() {
        } };
        if (d) {
          this.devices.set(part.id, d);
          this.status[part.id] = { connected: false, reason: "No addressed transaction yet", reads: 0, writes: 0 };
        }
      }
    }
    connect(address, read, electric, frequency, high, picoReady = true) {
      this.selected?.device.stop();
      this.selected = null;
      const nl = netlist(this.p), ground = nl.net.get(endpoint(nl.board, "GND")), pins2 = this.p.board_type === "pico_rp2040" ? ["GP4", "GP5"] : this.p.board_type === "mega2560" ? ["D20", "D21"] : ["A4", "A5"], same = (a, b) => nl.net.get(a) === nl.net.get(b), v = (k) => electric.values[k];
      const candidates = [];
      for (const [id, device] of this.devices) {
        const part = this.p.parts.find((a) => a.id === id), q = params(part), s = this.status[id];
        s.connected = false;
        if (!picoReady || !same(id + ":SDA", nl.board + ":" + pins2[0]) || !same(id + ":SCL", nl.board + ":" + pins2[1])) {
          s.reason = "Connect SDA/SCL to the hardware I2C pins";
          continue;
        }
        const volts = v(id + ":VCC"), min = part.type === "ds1307" ? 4.5 : 2.7, max = part.type === "ds1307" ? 5.5 : part.type === "i2c" ? railVoltage(this.p.board_type) + 0.2 : 3.6;
        if (nl.net.get(id + ":GND") !== ground || !Number.isFinite(volts) || volts < min || volts > max) {
          s.reason = "Check common ground and " + (part.type === "ds1307" ? "4.5\u20135.5 V" : part.type === "i2c" ? "device" : "2.7\u20133.6 V") + " supply";
          continue;
        }
        candidates.push({ id, device, part, q, volts });
        s.connected = true;
        s.reason = "Powered and wired";
      }
      const cap = candidates.reduce((s, d) => s + d.q.capacitance_pf, 0), sink = Math.min(3, ...candidates.map((d) => d.q.sink_ma)), qualities = [];
      for (const [i, line] of ["SDA", "SCL"].entries()) {
        const node = nl.net.get(nl.board + ":" + pins2[i]), rs = [];
        for (const r of this.p.parts.filter((p) => p.type === "resistor")) for (const [a, b] of [["1", "2"], ["2", "1"]]) if (nl.net.get(r.id + ":" + a) === node && Number.isFinite(v(r.id + ":" + b)) && v(r.id + ":" + b) > logicThresholds(this.p.board_type).high) rs.push({ ohms: params(r).ohms, volts: v(r.id + ":" + b) });
        const conductance = rs.reduce((s, r) => s + 1 / r.ohms, 0), volts = conductance ? rs.reduce((s, r) => s + r.volts / r.ohms, 0) / conductance : 0;
        const q = i2cQuality({ ohms: conductance ? 1 / conductance : Infinity, capacitance_pf: cap, frequency_hz: frequency, volts, sink_ma: sink, high_us: high });
        const voltageOK = rs.length > 0 && candidates.every((d) => volts <= d.volts + 0.3);
        qualities.push({ line, ...q, pullup_voltage_v: volts, usable: q.usable && voltageOK });
      }
      const matches = candidates.filter((d) => d.q.address === address), collision = matches.length > 1;
      let reason = collision ? "Address conflict: two powered devices have the same address" : matches.length === 0 ? "No powered device at this address" : qualities.some((q) => !q.usable) ? "Missing/unsafe pull-up or insufficient I2C timing margin" : "";
      if (!reason && matches[0].part.type === "ds1307" && frequency > 1e5) reason = "DS1307 supports at most 100 kHz";
      if (!reason && read && matches[0].part.type === "ssd1306") reason = "SSD1306 is write-only";
      if (reason) {
        for (const d of matches) this.status[d.id].reason = reason;
        return { ack: false, reason, qualities };
      }
      this.selected = matches[0];
      this.selected.device.start(read);
      this.status[this.selected.id].reason = "Address acknowledged";
      return { ack: true, device: this.selected.id, qualities };
    }
    write(v) {
      if (!this.selected) return false;
      const ack = this.selected.device.writeByte(v);
      if (ack) this.status[this.selected.id].writes++;
      return ack;
    }
    read() {
      if (!this.selected) return 255;
      this.status[this.selected.id].reads++;
      return this.selected.device.readByte();
    }
    stop() {
      this.selected?.device.stop();
      this.selected = null;
    }
    snapshot() {
      const out = {};
      for (const [id, d] of this.devices) {
        const p = this.p.parts.find((x) => x.id === id);
        if (p.type === "i2c") continue;
        out[id] = { ...this.status[id], ...["ssd1306", "ds1307"].includes(p.type) ? d.snapshot() : { type: "bmp280", reference_temperature_c: params(p).temperature_c, reference_pressure_hpa: params(p).pressure_hpa, chip_id: d.dumpRegisters()[208], registers: Array.from(d.dumpRegisters().slice(243, 253)) } };
      }
      return out;
    }
  };

  // src/programmable_circuit/dynamics.mjs
  var CircuitDynamics = class {
    constructor(p, duration) {
      this.p = p;
      this.time = 0;
      this.drives = {};
      this.capacitors = {};
      this.outputs = {};
      this.motors = {};
      this.queue = [];
      this.trace = [];
      this.edges = [];
      this.lastLogic = {};
      this.readings = {};
      this.nextSample = 0;
      this.samplePeriod = Math.max(50, duration * 1e6 / 1800);
      this.dynamic = p.parts.some((a) => ["capacitor", "sensor", "generator", "motor"].includes(a.type));
      this.enabled = this.dynamic || p.parts.some((a) => ["meter", "scope", "logic", "display"].includes(a.type) || params(a).bounce_ms > 0);
      this.current = null;
    }
    command(id, pressed, t) {
      const a = this.p.parts.find((x) => x.id === id), q = params(a);
      this.queue = this.queue.filter((x) => x.id !== id);
      this.queue.push(...bounceSchedule(t, pressed, q.bounce_ms, q.seed).map((x) => ({ ...x, id })));
      this.queue.sort((a2, b) => a2.t_us - b.t_us);
    }
    due(t) {
      return this.dynamic && t - this.time >= 50 || this.queue.length && this.queue[0].t_us <= t || this.enabled && t >= this.nextSample;
    }
    sources(t, dt) {
      const rail = railVoltage(this.p.board_type);
      for (const a of this.p.parts) {
        const q = params(a), v = (pin) => this.current?.values[endpoint(a.id, pin)];
        if (a.type === "sensor") this.outputs[a.id] = v("VCC") >= 2.7 && v("GND") === 0 ? sensorVoltage(q, t * 1e-6, rail) : void 0;
        if (a.type === "generator") this.outputs[a.id] = sineVoltage(q, t * 1e-6);
        if (a.type === "motor") {
          const powered = v("VCC") >= 2.7 && v("GND") === 0, logic = v("IN"), high = logic !== null && logic >= logicThresholds(this.p.board_type).high;
          const volts = powered && high ? q.supply_v : 0, old = this.motors[a.id] || { current_a: 0, omega_rad_s: 0 };
          const result = motorStep(old, q, volts, dt);
          if (result.omega_rad_s < 0 && volts >= 0) result.omega_rad_s = 0;
          this.motors[a.id] = { ...result, drive_v: volts, external_supply_v: q.supply_v };
          this.outputs[a.id] = powered ? Math.max(0, Math.min(rail, result.omega_rad_s / q.feedback_rad_s_v)) : void 0;
        }
      }
    }
    update(t, drives) {
      t = Math.max(0, t);
      if (!this.enabled) return solve(this.p, drives);
      if (!this.current) this.current = solve(this.p, drives);
      while (this.time < t - 1e-7) {
        const next = Math.min(t, this.time + 50, this.queue.length ? Math.max(this.time, this.queue[0].t_us) : Infinity), dt = (next - this.time) * 1e-6;
        if (dt > 0) {
          this.sources(next, dt);
          this.current = solve(this.p, this.drives, { dt, capacitors: this.capacitors, outputs: this.outputs });
          Object.assign(this.capacitors, this.current.capacitors);
          this.time = next;
        }
        while (this.queue.length && this.queue[0].t_us <= this.time + 1e-7) {
          const e = this.queue.shift();
          this.p.parts.find((a) => a.id === e.id).params.pressed = e.pressed;
        }
      }
      while (this.queue.length && this.queue[0].t_us <= t + 1e-7) {
        const e = this.queue.shift();
        this.p.parts.find((a) => a.id === e.id).params.pressed = e.pressed;
      }
      this.sources(t, 0);
      this.drives = { ...drives };
      this.current = solve(this.p, drives, { dt: 1e-9, capacitors: this.capacitors, outputs: this.outputs });
      const values = this.current.values, rail = railVoltage(this.p.board_type);
      for (const a of this.p.parts) {
        const v = (pin) => values[endpoint(a.id, pin)];
        if (["meter", "scope", "logic"].includes(a.type)) {
          const pin = a.type === "meter" ? "PLUS" : a.type === "scope" ? "CH1" : "IN", g = a.type === "meter" ? "COM" : "GND";
          const volts = Number.isFinite(v(pin)) && Number.isFinite(v(g)) ? v(pin) - v(g) : null;
          this.readings[a.id] = { kind: a.type, volts, input_ohms: a.type === "scope" ? 1e6 : 1e7 };
          if (a.type === "logic") {
            const th = logicThresholds(this.p.board_type), state = volts === null ? null : volts <= th.low ? 0 : volts >= th.high ? 1 : null;
            this.readings[a.id].logic = state;
            if (this.lastLogic[a.id] !== state && this.edges.length < 8e3) {
              this.edges.push({ id: a.id, t_us: t, value: state });
              this.lastLogic[a.id] = state;
            }
          }
        }
        if (a.type === "display") {
          const powered = v("GND") === 0 && v("VCC") >= 2.7, th = logicThresholds(this.p.board_type), bits = Array.from({ length: 8 }, (_, i) => !powered || v("D" + i) === null ? null : v("D" + i) >= th.high ? 1 : v("D" + i) <= th.low ? 0 : null);
          this.readings[a.id] = { kind: "display", powered, bits, value: bits.every((x) => x !== null) ? bits.reduce((v2, b, i) => v2 + (b << i), 0) : null };
        }
        if (a.type === "sensor") this.readings[a.id] = { kind: "sensor", volts: v("OUT"), reference_temperature_c: params(a).temperature_c, reference_kind: "controlled_virtual_condition" };
        if (a.type === "motor") this.readings[a.id] = { kind: "motor", ...this.motors[a.id], feedback_v: v("SPEED") };
      }
      if (t >= this.nextSample && this.trace.length < 2e3) {
        this.trace.push({ t_us: t, values: Object.fromEntries(Object.entries(this.readings).map(([id, r]) => [id, r.volts ?? r.feedback_v ?? r.value ?? null])) });
        this.nextSample = t + this.samplePeriod;
      }
      return this.current;
    }
    snapshot() {
      return { model_version: PHYSICS_VERSION, readings: this.readings, trace: this.trace, logic_edges: this.edges, sample_period_us: this.samplePeriod, integration_max_step_us: 50, trace_truncated: this.trace.length >= 2e3, motors: this.motors };
    }
  };

  // src/programmable_circuit/engine.mjs
  var import_cjs2 = __toESM(require_cjs(), 1);

  // tools/programmable_simulator/node_modules/rp2040js/dist/esm/irq.js
  var IRQ;
  (function(IRQ3) {
    IRQ3[IRQ3["TIMER_0"] = 0] = "TIMER_0";
    IRQ3[IRQ3["TIMER_1"] = 1] = "TIMER_1";
    IRQ3[IRQ3["TIMER_2"] = 2] = "TIMER_2";
    IRQ3[IRQ3["TIMER_3"] = 3] = "TIMER_3";
    IRQ3[IRQ3["PWM_WRAP"] = 4] = "PWM_WRAP";
    IRQ3[IRQ3["USBCTRL"] = 5] = "USBCTRL";
    IRQ3[IRQ3["XIP"] = 6] = "XIP";
    IRQ3[IRQ3["PIO0_IRQ0"] = 7] = "PIO0_IRQ0";
    IRQ3[IRQ3["PIO0_IRQ1"] = 8] = "PIO0_IRQ1";
    IRQ3[IRQ3["PIO1_IRQ0"] = 9] = "PIO1_IRQ0";
    IRQ3[IRQ3["PIO1_IRQ1"] = 10] = "PIO1_IRQ1";
    IRQ3[IRQ3["DMA_IRQ0"] = 11] = "DMA_IRQ0";
    IRQ3[IRQ3["DMA_IRQ1"] = 12] = "DMA_IRQ1";
    IRQ3[IRQ3["IO_BANK0"] = 13] = "IO_BANK0";
    IRQ3[IRQ3["IO_QSPI"] = 14] = "IO_QSPI";
    IRQ3[IRQ3["SIO_PROC0"] = 15] = "SIO_PROC0";
    IRQ3[IRQ3["SIO_PROC1"] = 16] = "SIO_PROC1";
    IRQ3[IRQ3["CLOCKS"] = 17] = "CLOCKS";
    IRQ3[IRQ3["SPI0"] = 18] = "SPI0";
    IRQ3[IRQ3["SPI1"] = 19] = "SPI1";
    IRQ3[IRQ3["UART0"] = 20] = "UART0";
    IRQ3[IRQ3["UART1"] = 21] = "UART1";
    IRQ3[IRQ3["ADC_FIFO"] = 22] = "ADC_FIFO";
    IRQ3[IRQ3["I2C0"] = 23] = "I2C0";
    IRQ3[IRQ3["I2C1"] = 24] = "I2C1";
    IRQ3[IRQ3["RTC"] = 25] = "RTC";
  })(IRQ || (IRQ = {}));
  var MAX_HARDWARE_IRQ = IRQ.RTC;

  // tools/programmable_simulator/node_modules/rp2040js/dist/esm/clock/simulation-clock.js
  var ClockAlarm = class {
    constructor(clock, callback) {
      this.clock = clock;
      this.callback = callback;
      this.next = null;
      this.nanos = 0;
      this.scheduled = false;
    }
    schedule(deltaNanos) {
      if (this.scheduled) {
        this.cancel();
      }
      this.clock.linkAlarm(deltaNanos, this);
    }
    cancel() {
      this.clock.unlinkAlarm(this);
      this.scheduled = false;
    }
  };
  var SimulationClock = class {
    constructor(frequency = 125e6) {
      this.frequency = frequency;
      this.nextAlarm = null;
      this.nanosCounter = 0;
    }
    get nanos() {
      return this.nanosCounter;
    }
    get micros() {
      return this.nanos / 1e3;
    }
    createAlarm(callback) {
      return new ClockAlarm(this, callback);
    }
    linkAlarm(nanos, alarm) {
      alarm.nanos = this.nanos + nanos;
      let alarmListItem = this.nextAlarm;
      let lastItem = null;
      while (alarmListItem && alarmListItem.nanos < alarm.nanos) {
        lastItem = alarmListItem;
        alarmListItem = alarmListItem.next;
      }
      if (lastItem) {
        lastItem.next = alarm;
        alarm.next = alarmListItem;
      } else {
        this.nextAlarm = alarm;
        alarm.next = alarmListItem;
      }
      alarm.scheduled = true;
      return alarm;
    }
    unlinkAlarm(alarm) {
      let alarmListItem = this.nextAlarm;
      if (!alarmListItem) {
        return false;
      }
      let lastItem = null;
      while (alarmListItem) {
        if (alarmListItem === alarm) {
          if (lastItem) {
            lastItem.next = alarmListItem.next;
          } else {
            this.nextAlarm = alarmListItem.next;
          }
          return true;
        }
        lastItem = alarmListItem;
        alarmListItem = alarmListItem.next;
      }
      return false;
    }
    tick(deltaNanos) {
      const targetNanos = this.nanosCounter + deltaNanos;
      let alarm = this.nextAlarm;
      while (alarm && alarm.nanos <= targetNanos) {
        this.nextAlarm = alarm.next;
        this.nanosCounter = alarm.nanos;
        alarm.callback();
        alarm = this.nextAlarm;
      }
      this.nanosCounter = targetNanos;
    }
    get nanosToNextAlarm() {
      if (this.nextAlarm) {
        return this.nextAlarm.nanos - this.nanos;
      }
      return 0;
    }
  };

  // tools/programmable_simulator/node_modules/rp2040js/dist/esm/utils/fifo.js
  var FIFO = class {
    constructor(size) {
      this.start = 0;
      this.used = 0;
      this.buffer = new Uint32Array(size);
    }
    get size() {
      return this.buffer.length;
    }
    get itemCount() {
      return this.used;
    }
    push(value) {
      const { length } = this.buffer;
      const { start, used } = this;
      if (this.used < length) {
        this.buffer[(start + used) % length] = value;
        this.used++;
      }
    }
    pull() {
      const { start, used } = this;
      const { length } = this.buffer;
      if (used) {
        this.start = (start + 1) % length;
        this.used--;
        return this.buffer[start];
      }
      return 0;
    }
    peek() {
      return this.used ? this.buffer[this.start] : 0;
    }
    reset() {
      this.used = 0;
    }
    get empty() {
      return this.used == 0;
    }
    get full() {
      return this.used === this.buffer.length;
    }
    get items() {
      const { start, used, buffer } = this;
      const { length } = buffer;
      const result = [];
      for (let i = 0; i < used; i++) {
        result[i] = buffer[(start + i) % length];
      }
      return result;
    }
  };

  // tools/programmable_simulator/node_modules/rp2040js/dist/esm/peripherals/peripheral.js
  var ATOMIC_NORMAL = 0;
  var ATOMIC_XOR = 1;
  var ATOMIC_SET = 2;
  var ATOMIC_CLEAR = 3;
  function atomicUpdate(currentValue, atomicType, newValue) {
    switch (atomicType) {
      case ATOMIC_XOR:
        return currentValue ^ newValue;
      case ATOMIC_SET:
        return currentValue | newValue;
      case ATOMIC_CLEAR:
        return currentValue & ~newValue;
      default:
        console.warn("Atomic update called with invalid writeType", atomicType);
        return newValue;
    }
  }
  var BasePeripheral = class {
    constructor(rp2040, name) {
      this.rp2040 = rp2040;
      this.name = name;
      this.rawWriteValue = 0;
    }
    readUint32(offset) {
      this.warn(`Unimplemented peripheral read from 0x${offset.toString(16)}`);
      if (offset > 4096) {
        this.warn("Unimplemented read from peripheral in the atomic operation region");
      }
      return 4294967295;
    }
    writeUint32(offset, value) {
      this.warn(`Unimplemented peripheral write to 0x${offset.toString(16)}: 0x${value.toString(16)}`);
    }
    writeUint32Atomic(offset, value, atomicType) {
      this.rawWriteValue = value;
      const newValue = atomicType != ATOMIC_NORMAL ? atomicUpdate(this.readUint32(offset), atomicType, value) : value;
      this.writeUint32(offset, newValue);
    }
    debug(msg) {
      this.rp2040.logger.debug(this.name, msg);
    }
    info(msg) {
      this.rp2040.logger.info(this.name, msg);
    }
    warn(msg) {
      this.rp2040.logger.warn(this.name, msg);
    }
    error(msg) {
      this.rp2040.logger.error(this.name, msg);
    }
  };
  var UnimplementedPeripheral = class extends BasePeripheral {
  };

  // tools/programmable_simulator/node_modules/rp2040js/dist/esm/peripherals/dma.js
  var DREQChannel;
  (function(DREQChannel2) {
    DREQChannel2[DREQChannel2["DREQ_PIO0_TX0"] = 0] = "DREQ_PIO0_TX0";
    DREQChannel2[DREQChannel2["DREQ_PIO0_TX1"] = 1] = "DREQ_PIO0_TX1";
    DREQChannel2[DREQChannel2["DREQ_PIO0_TX2"] = 2] = "DREQ_PIO0_TX2";
    DREQChannel2[DREQChannel2["DREQ_PIO0_TX3"] = 3] = "DREQ_PIO0_TX3";
    DREQChannel2[DREQChannel2["DREQ_PIO0_RX0"] = 4] = "DREQ_PIO0_RX0";
    DREQChannel2[DREQChannel2["DREQ_PIO0_RX1"] = 5] = "DREQ_PIO0_RX1";
    DREQChannel2[DREQChannel2["DREQ_PIO0_RX2"] = 6] = "DREQ_PIO0_RX2";
    DREQChannel2[DREQChannel2["DREQ_PIO0_RX3"] = 7] = "DREQ_PIO0_RX3";
    DREQChannel2[DREQChannel2["DREQ_PIO1_TX0"] = 8] = "DREQ_PIO1_TX0";
    DREQChannel2[DREQChannel2["DREQ_PIO1_TX1"] = 9] = "DREQ_PIO1_TX1";
    DREQChannel2[DREQChannel2["DREQ_PIO1_TX2"] = 10] = "DREQ_PIO1_TX2";
    DREQChannel2[DREQChannel2["DREQ_PIO1_TX3"] = 11] = "DREQ_PIO1_TX3";
    DREQChannel2[DREQChannel2["DREQ_PIO1_RX0"] = 12] = "DREQ_PIO1_RX0";
    DREQChannel2[DREQChannel2["DREQ_PIO1_RX1"] = 13] = "DREQ_PIO1_RX1";
    DREQChannel2[DREQChannel2["DREQ_PIO1_RX2"] = 14] = "DREQ_PIO1_RX2";
    DREQChannel2[DREQChannel2["DREQ_PIO1_RX3"] = 15] = "DREQ_PIO1_RX3";
    DREQChannel2[DREQChannel2["DREQ_SPI0_TX"] = 16] = "DREQ_SPI0_TX";
    DREQChannel2[DREQChannel2["DREQ_SPI0_RX"] = 17] = "DREQ_SPI0_RX";
    DREQChannel2[DREQChannel2["DREQ_SPI1_TX"] = 18] = "DREQ_SPI1_TX";
    DREQChannel2[DREQChannel2["DREQ_SPI1_RX"] = 19] = "DREQ_SPI1_RX";
    DREQChannel2[DREQChannel2["DREQ_UART0_TX"] = 20] = "DREQ_UART0_TX";
    DREQChannel2[DREQChannel2["DREQ_UART0_RX"] = 21] = "DREQ_UART0_RX";
    DREQChannel2[DREQChannel2["DREQ_UART1_TX"] = 22] = "DREQ_UART1_TX";
    DREQChannel2[DREQChannel2["DREQ_UART1_RX"] = 23] = "DREQ_UART1_RX";
    DREQChannel2[DREQChannel2["DREQ_PWM_WRAP0"] = 24] = "DREQ_PWM_WRAP0";
    DREQChannel2[DREQChannel2["DREQ_PWM_WRAP1"] = 25] = "DREQ_PWM_WRAP1";
    DREQChannel2[DREQChannel2["DREQ_PWM_WRAP2"] = 26] = "DREQ_PWM_WRAP2";
    DREQChannel2[DREQChannel2["DREQ_PWM_WRAP3"] = 27] = "DREQ_PWM_WRAP3";
    DREQChannel2[DREQChannel2["DREQ_PWM_WRAP4"] = 28] = "DREQ_PWM_WRAP4";
    DREQChannel2[DREQChannel2["DREQ_PWM_WRAP5"] = 29] = "DREQ_PWM_WRAP5";
    DREQChannel2[DREQChannel2["DREQ_PWM_WRAP6"] = 30] = "DREQ_PWM_WRAP6";
    DREQChannel2[DREQChannel2["DREQ_PWM_WRAP7"] = 31] = "DREQ_PWM_WRAP7";
    DREQChannel2[DREQChannel2["DREQ_I2C0_TX"] = 32] = "DREQ_I2C0_TX";
    DREQChannel2[DREQChannel2["DREQ_I2C0_RX"] = 33] = "DREQ_I2C0_RX";
    DREQChannel2[DREQChannel2["DREQ_I2C1_TX"] = 34] = "DREQ_I2C1_TX";
    DREQChannel2[DREQChannel2["DREQ_I2C1_RX"] = 35] = "DREQ_I2C1_RX";
    DREQChannel2[DREQChannel2["DREQ_ADC"] = 36] = "DREQ_ADC";
    DREQChannel2[DREQChannel2["DREQ_XIP_STREAM"] = 37] = "DREQ_XIP_STREAM";
    DREQChannel2[DREQChannel2["DREQ_XIP_SSITX"] = 38] = "DREQ_XIP_SSITX";
    DREQChannel2[DREQChannel2["DREQ_XIP_SSIRX"] = 39] = "DREQ_XIP_SSIRX";
    DREQChannel2[DREQChannel2["DREQ_MAX"] = 40] = "DREQ_MAX";
  })(DREQChannel || (DREQChannel = {}));
  var TREQ;
  (function(TREQ2) {
    TREQ2[TREQ2["Timer0"] = 59] = "Timer0";
    TREQ2[TREQ2["Timer1"] = 60] = "Timer1";
    TREQ2[TREQ2["Timer2"] = 61] = "Timer2";
    TREQ2[TREQ2["Timer3"] = 62] = "Timer3";
    TREQ2[TREQ2["Permanent"] = 63] = "Permanent";
  })(TREQ || (TREQ = {}));
  var CHn_READ_ADDR = 0;
  var CHn_WRITE_ADDR = 4;
  var CHn_TRANS_COUNT = 8;
  var CHn_CTRL_TRIG = 12;
  var CHn_AL1_CTRL = 16;
  var CHn_AL1_READ_ADDR = 20;
  var CHn_AL1_WRITE_ADDR = 24;
  var CHn_AL1_TRANS_COUNT_TRIG = 28;
  var CHn_AL2_CTRL = 32;
  var CHn_AL2_TRANS_COUNT = 36;
  var CHn_AL2_READ_ADDR = 40;
  var CHn_AL2_WRITE_ADDR_TRIG = 44;
  var CHn_AL3_CTRL = 48;
  var CHn_AL3_WRITE_ADDR = 52;
  var CHn_AL3_TRANS_COUNT = 56;
  var CHn_AL3_READ_ADDR_TRIG = 60;
  var CHn_DBG_CTDREQ = 2048;
  var CHn_DBG_TCR = 2052;
  var CHANNEL_REGISTERS_SIZE = 12 * 64;
  var CHANNEL_REGISTERS_MASK = 2111;
  var INTR = 1024;
  var INTE0 = 1028;
  var INTF0 = 1032;
  var INTS0 = 1036;
  var INTE1 = 1044;
  var INTF1 = 1048;
  var INTS1 = 1052;
  var TIMER0 = 1056;
  var TIMER1 = 1060;
  var TIMER2 = 1064;
  var TIMER3 = 1068;
  var MULTI_CHAN_TRIGGER = 1072;
  var CHAN_ABORT = 1092;
  var N_CHANNELS = 1096;
  var AHB_ERROR = 1 << 31;
  var READ_ERROR = 1 << 30;
  var WRITE_ERROR = 1 << 29;
  var BUSY = 1 << 24;
  var SNIFF_EN = 1 << 23;
  var BSWAP = 1 << 22;
  var IRQ_QUIET = 1 << 21;
  var TREQ_SEL_MASK = 63;
  var TREQ_SEL_SHIFT = 15;
  var CHAIN_TO_MASK = 15;
  var CHAIN_TO_SHIFT = 11;
  var RING_SEL = 1 << 10;
  var RING_SIZE_MASK = 15;
  var RING_SIZE_SHIFT = 6;
  var INCR_WRITE = 1 << 5;
  var INCR_READ = 1 << 4;
  var DATA_SIZE_MASK = 3;
  var DATA_SIZE_SHIFT = 2;
  var HIGH_PRIORITY = 1 << 1;
  var EN = 1 << 0;
  var CHn_CTRL_TRIG_WRITE_MASK = 16777215;
  var CHn_CTRL_TRIG_WC_MASK = READ_ERROR | WRITE_ERROR;
  var RPDMAChannel = class {
    constructor(dma, rp2040, index) {
      this.dma = dma;
      this.rp2040 = rp2040;
      this.index = index;
      this.ctrl = 0;
      this.readAddr = 0;
      this.writeAddr = 0;
      this.transCount = 0;
      this.dreqCounter = 0;
      this.transCountReload = 0;
      this.treqValue = 0;
      this.dataSize = 1;
      this.chainTo = 0;
      this.ringMask = 0;
      this.transferFn = () => 0;
      this.transfer8 = () => {
        const { rp2040: rp20402 } = this;
        rp20402.writeUint8(this.writeAddr, rp20402.readUint8(this.readAddr));
      };
      this.transfer16 = () => {
        const { rp2040: rp20402 } = this;
        rp20402.writeUint16(this.writeAddr, rp20402.readUint16(this.readAddr));
      };
      this.transferSwap16 = () => {
        const { rp2040: rp20402 } = this;
        const input = rp20402.readUint16(this.readAddr);
        rp20402.writeUint16(this.writeAddr, (input & 255) << 8 | input >> 8);
      };
      this.transfer32 = () => {
        const { rp2040: rp20402 } = this;
        rp20402.writeUint32(this.writeAddr, rp20402.readUint32(this.readAddr));
      };
      this.transferSwap32 = () => {
        const { rp2040: rp20402 } = this;
        const input = rp20402.readUint32(this.readAddr);
        rp20402.writeUint32(this.writeAddr, (input & 255) << 24 | (input & 65280) << 8 | (input & 16711680) >> 8 | input >> 24 & 255);
      };
      this.transfer = () => {
        var _a;
        const { ctrl, dataSize, ringMask } = this;
        this.transferFn();
        if (ctrl & INCR_READ) {
          if (ringMask && !(ctrl & RING_SEL)) {
            this.readAddr = this.readAddr & ~ringMask | this.readAddr + dataSize & ringMask;
          } else {
            this.readAddr += dataSize;
          }
        }
        if (ctrl & INCR_WRITE) {
          if (ringMask && ctrl & RING_SEL) {
            this.writeAddr = this.writeAddr & ~ringMask | this.writeAddr + dataSize & ringMask;
          } else {
            this.writeAddr += dataSize;
          }
        }
        this.transCount--;
        if (this.transCount > 0) {
          this.scheduleTransfer();
        } else {
          this.ctrl &= ~BUSY;
          if (!(this.ctrl & IRQ_QUIET)) {
            this.dma.intRaw |= 1 << this.index;
            this.dma.checkInterrupts();
          }
          if (this.chainTo !== this.index) {
            (_a = this.dma.channels[this.chainTo]) === null || _a === void 0 ? void 0 : _a.start();
          }
        }
      };
      this.transferAlarm = rp2040.clock.createAlarm(this.transfer);
      this.reset();
    }
    start() {
      if (!(this.ctrl & EN) || this.ctrl & BUSY) {
        return;
      }
      this.ctrl |= BUSY;
      this.transCount = this.transCountReload;
      if (this.transCount) {
        this.scheduleTransfer();
      }
    }
    get treq() {
      return this.treqValue;
    }
    get active() {
      return this.ctrl & EN && this.ctrl & BUSY;
    }
    scheduleTransfer() {
      if (this.dma.dreq[this.treqValue] || this.treqValue === TREQ.Permanent) {
        this.transferAlarm.schedule(0);
      } else {
        const delay = this.dma.getTimer(this.treqValue);
        if (delay) {
          this.transferAlarm.schedule(delay * 1e3);
        }
      }
    }
    abort() {
      this.ctrl &= ~BUSY;
      this.transferAlarm.cancel();
    }
    readUint32(offset) {
      switch (offset) {
        case CHn_READ_ADDR:
        case CHn_AL1_READ_ADDR:
        case CHn_AL2_READ_ADDR:
        case CHn_AL3_READ_ADDR_TRIG:
          return this.readAddr;
        case CHn_WRITE_ADDR:
        case CHn_AL1_WRITE_ADDR:
        case CHn_AL2_WRITE_ADDR_TRIG:
        case CHn_AL3_WRITE_ADDR:
          return this.writeAddr;
        case CHn_TRANS_COUNT:
        case CHn_AL1_TRANS_COUNT_TRIG:
        case CHn_AL2_TRANS_COUNT:
        case CHn_AL3_TRANS_COUNT:
          return this.transCount;
        case CHn_CTRL_TRIG:
        case CHn_AL1_CTRL:
        case CHn_AL2_CTRL:
        case CHn_AL3_CTRL:
          return this.ctrl;
        case CHn_DBG_CTDREQ:
          return this.dreqCounter;
        case CHn_DBG_TCR:
          return this.transCountReload;
      }
      return 0;
    }
    writeUint32(offset, value) {
      switch (offset) {
        case CHn_READ_ADDR:
        case CHn_AL1_READ_ADDR:
        case CHn_AL2_READ_ADDR:
        case CHn_AL3_READ_ADDR_TRIG:
          this.readAddr = value;
          break;
        case CHn_WRITE_ADDR:
        case CHn_AL1_WRITE_ADDR:
        case CHn_AL2_WRITE_ADDR_TRIG:
        case CHn_AL3_WRITE_ADDR:
          this.writeAddr = value;
          break;
        case CHn_TRANS_COUNT:
        case CHn_AL1_TRANS_COUNT_TRIG:
        case CHn_AL2_TRANS_COUNT:
        case CHn_AL3_TRANS_COUNT:
          this.transCountReload = value;
          break;
        case CHn_CTRL_TRIG:
        case CHn_AL1_CTRL:
        case CHn_AL2_CTRL:
        case CHn_AL3_CTRL: {
          this.ctrl = this.ctrl & ~CHn_CTRL_TRIG_WRITE_MASK | value & CHn_CTRL_TRIG_WRITE_MASK;
          this.ctrl &= ~(value & CHn_CTRL_TRIG_WC_MASK);
          this.treqValue = this.ctrl >> TREQ_SEL_SHIFT & TREQ_SEL_MASK;
          this.chainTo = this.ctrl >> CHAIN_TO_SHIFT & CHAIN_TO_MASK;
          const ringSize = this.ctrl >> RING_SIZE_SHIFT & RING_SIZE_MASK;
          this.ringMask = ringSize ? (1 << ringSize) - 1 : 0;
          switch (this.ctrl >> DATA_SIZE_SHIFT & DATA_SIZE_MASK) {
            case 1:
              this.dataSize = 2;
              this.transferFn = this.ctrl & BSWAP ? this.transferSwap16 : this.transfer16;
              break;
            case 2:
              this.dataSize = 4;
              this.transferFn = this.ctrl & BSWAP ? this.transferSwap32 : this.transfer32;
              break;
            case 0:
            default:
              this.transferFn = this.transfer8;
              this.dataSize = 1;
          }
          if (this.ctrl & EN && this.ctrl & BUSY) {
            this.scheduleTransfer();
          }
          if (!(this.ctrl & EN)) {
            this.transferAlarm.cancel();
          }
          break;
        }
        case CHn_DBG_CTDREQ:
          this.dreqCounter = 0;
          break;
      }
      if (offset === CHn_AL3_READ_ADDR_TRIG || offset === CHn_AL2_WRITE_ADDR_TRIG || offset === CHn_AL1_TRANS_COUNT_TRIG || offset === CHn_CTRL_TRIG) {
        if (value) {
          this.start();
        } else if (this.ctrl & IRQ_QUIET) {
          this.dma.intRaw |= 1 << this.index;
          this.dma.checkInterrupts();
        }
      }
    }
    reset() {
      this.writeUint32(CHn_CTRL_TRIG, this.index << CHAIN_TO_SHIFT);
    }
  };
  var RPDMA = class extends BasePeripheral {
    constructor() {
      super(...arguments);
      this.channels = [
        new RPDMAChannel(this, this.rp2040, 0),
        new RPDMAChannel(this, this.rp2040, 1),
        new RPDMAChannel(this, this.rp2040, 2),
        new RPDMAChannel(this, this.rp2040, 3),
        new RPDMAChannel(this, this.rp2040, 4),
        new RPDMAChannel(this, this.rp2040, 5),
        new RPDMAChannel(this, this.rp2040, 6),
        new RPDMAChannel(this, this.rp2040, 7),
        new RPDMAChannel(this, this.rp2040, 8),
        new RPDMAChannel(this, this.rp2040, 9),
        new RPDMAChannel(this, this.rp2040, 10),
        new RPDMAChannel(this, this.rp2040, 11)
      ];
      this.intRaw = 0;
      this.intEnable0 = 0;
      this.intForce0 = 0;
      this.intEnable1 = 0;
      this.intForce1 = 0;
      this.timer0 = 0;
      this.timer1 = 0;
      this.timer2 = 0;
      this.timer3 = 0;
      this.dreq = Array(DREQChannel.DREQ_MAX);
    }
    get intStatus0() {
      return this.intRaw & this.intEnable0 | this.intForce0;
    }
    get intStatus1() {
      return this.intRaw & this.intEnable1 | this.intForce1;
    }
    readUint32(offset) {
      if ((offset & 2047) < CHANNEL_REGISTERS_SIZE) {
        const channelIndex = (offset & 2047) >> 6;
        return this.channels[channelIndex].readUint32(offset & CHANNEL_REGISTERS_MASK);
      }
      switch (offset) {
        case TIMER0:
          return this.timer0;
        case TIMER1:
          return this.timer1;
        case TIMER2:
          return this.timer2;
        case TIMER3:
          return this.timer3;
        case INTR:
          return this.intRaw;
        case INTE0:
          return this.intEnable0;
        case INTF0:
          return this.intForce0;
        case INTS0:
          return this.intStatus0;
        case INTE1:
          return this.intEnable1;
        case INTF1:
          return this.intForce1;
        case INTS1:
          return this.intStatus1;
        case N_CHANNELS:
          return this.channels.length;
      }
      return super.readUint32(offset);
    }
    writeUint32(offset, value) {
      if ((offset & 2047) < CHANNEL_REGISTERS_SIZE) {
        const channelIndex = (offset & 2047) >> 6;
        this.channels[channelIndex].writeUint32(offset & CHANNEL_REGISTERS_MASK, value);
        return;
      }
      switch (offset) {
        case TIMER0:
          this.timer0 = value;
          return;
        case TIMER1:
          this.timer1 = value;
          return;
        case TIMER2:
          this.timer2 = value;
          return;
        case TIMER3:
          this.timer3 = value;
          return;
        case INTR:
        case INTS0:
        case INTS1:
          this.intRaw &= ~this.rawWriteValue;
          this.checkInterrupts();
          return;
        case INTE0:
          this.intEnable0 = value & 65535;
          this.checkInterrupts();
          return;
        case INTF0:
          this.intForce0 = value & 65535;
          this.checkInterrupts();
          return;
        case INTE1:
          this.intEnable1 = value & 65535;
          this.checkInterrupts();
          return;
        case INTF1:
          this.intForce1 = value & 65535;
          this.checkInterrupts();
          return;
        case MULTI_CHAN_TRIGGER:
          for (const chan of this.channels) {
            if (value & 1 << chan.index) {
              chan.start();
            }
          }
          return;
        case CHAN_ABORT:
          for (const chan of this.channels) {
            if (value & 1 << chan.index) {
              chan.abort();
            }
          }
          return;
        default:
          super.writeUint32(offset, value);
      }
    }
    setDREQ(dreqChannel) {
      const { dreq } = this;
      if (!dreq[dreqChannel]) {
        dreq[dreqChannel] = true;
        for (const channel of this.channels) {
          if (channel.treq === dreqChannel && channel.active) {
            channel.scheduleTransfer();
          }
        }
      }
    }
    clearDREQ(dreqChannel) {
      this.dreq[dreqChannel] = false;
    }
    /**
     * Returns the number of microseconds for a cycle of the given DMA timer, or 0 if the timer is disabled.
     */
    getTimer(treq) {
      let dividend = 0, divisor = 1;
      switch (treq) {
        case TREQ.Permanent:
          dividend = 1;
          divisor = 1;
          break;
        case TREQ.Timer0:
          dividend = this.timer0 >>> 16;
          divisor = this.timer0 & 65535;
          break;
        case TREQ.Timer1:
          dividend = this.timer1 >>> 16;
          divisor = this.timer1 & 65535;
          break;
        case TREQ.Timer2:
          dividend = this.timer2 >>> 16;
          divisor = this.timer2 & 65535;
          break;
        case TREQ.Timer3:
          dividend = this.timer3 >>> 36;
          divisor = this.timer3 & 65535;
          break;
      }
      if (divisor === 0) {
        return 0;
      }
      return dividend / divisor * 1e6 / this.rp2040.clkSys;
    }
    checkInterrupts() {
      this.rp2040.setInterrupt(IRQ.DMA_IRQ0, !!this.intStatus0);
      this.rp2040.setInterrupt(IRQ.DMA_IRQ1, !!this.intStatus1);
    }
  };

  // tools/programmable_simulator/node_modules/rp2040js/dist/esm/peripherals/pio.js
  var CTRL = 0;
  var FSTAT = 4;
  var FDEBUG = 8;
  var FLEVEL = 12;
  var IRQ2 = 48;
  var IRQ_FORCE = 52;
  var INPUT_SYNC_BYPASS = 56;
  var DBG_PADOUT = 60;
  var DBG_PADOE = 64;
  var DBG_CFGINFO = 68;
  var INSTR_MEM0 = 72;
  var INSTR_MEM31 = 196;
  var INTR2 = 296;
  var IRQ0_INTE = 300;
  var IRQ0_INTF = 304;
  var IRQ0_INTS = 308;
  var IRQ1_INTE = 312;
  var IRQ1_INTF = 316;
  var IRQ1_INTS = 320;
  var TXF0 = 16;
  var TXF1 = 20;
  var TXF2 = 24;
  var TXF3 = 28;
  var RXF0 = 32;
  var RXF1 = 36;
  var RXF2 = 40;
  var RXF3 = 44;
  var SM0_CLKDIV = 200;
  var SM0_EXECCTRL = 204;
  var SM0_SHIFTCTRL = 208;
  var SM0_ADDR = 212;
  var SM0_INSTR = 216;
  var SM0_PINCTRL = 220;
  var SM1_CLKDIV = 224;
  var SM1_PINCTRL = 244;
  var SM2_CLKDIV = 248;
  var SM2_PINCTRL = 268;
  var SM3_CLKDIV = 272;
  var SM3_PINCTRL = 292;
  var FSTAT_TXEMPTY = 1 << 24;
  var FSTAT_TXFULL = 1 << 16;
  var FSTAT_RXEMPTY = 1 << 8;
  var FSTAT_RXFULL = 1 << 0;
  var FDEBUG_TXSTALL = 1 << 24;
  var FDEBUG_TXOVER = 1 << 16;
  var FDEBUG_RXUNDER = 1 << 8;
  var FDEBUG_RXSTALL = 1 << 0;
  var SHIFTCTRL_AUTOPUSH = 1 << 16;
  var SHIFTCTRL_AUTOPULL = 1 << 17;
  var SHIFTCTRL_IN_SHIFTDIR = 1 << 18;
  var SHIFTCTRL_OUT_SHIFTDIR = 1 << 19;
  var EXECCTRL_STATUS_SEL = 1 << 4;
  var EXECCTRL_SIDE_PINDIR = 1 << 29;
  var EXECCTRL_SIDE_EN = 1 << 30;
  var EXECCTRL_EXEC_STALLED = 1 << 31;
  var WaitType;
  (function(WaitType2) {
    WaitType2[WaitType2["None"] = 0] = "None";
    WaitType2[WaitType2["Pin"] = 1] = "Pin";
    WaitType2[WaitType2["rxFIFO"] = 2] = "rxFIFO";
    WaitType2[WaitType2["txFIFO"] = 3] = "txFIFO";
    WaitType2[WaitType2["IRQ"] = 4] = "IRQ";
    WaitType2[WaitType2["Out"] = 5] = "Out";
  })(WaitType || (WaitType = {}));
  function bitReverse(x) {
    x = (x & 1431655765) << 1 | (x & 2863311530) >>> 1;
    x = (x & 858993459) << 2 | (x & 3435973836) >>> 2;
    x = (x & 252645135) << 4 | (x & 4042322160) >>> 4;
    x = (x & 16711935) << 8 | (x & 4278255360) >>> 8;
    x = (x & 65535) << 16 | (x & 4294901760) >>> 16;
    return x >>> 0;
  }
  function irqIndex(irq, machineIndex) {
    const rel = !!(irq & 16);
    return rel ? irq & 4 | (irq & 3) + machineIndex & 3 : irq & 7;
  }
  var dreqRx0 = [
    DREQChannel.DREQ_PIO0_RX0,
    DREQChannel.DREQ_PIO0_RX1,
    DREQChannel.DREQ_PIO0_RX2,
    DREQChannel.DREQ_PIO0_RX3
  ];
  var dreqTx0 = [
    DREQChannel.DREQ_PIO0_TX0,
    DREQChannel.DREQ_PIO0_TX1,
    DREQChannel.DREQ_PIO0_TX2,
    DREQChannel.DREQ_PIO0_TX3
  ];
  var dreqRx1 = [
    DREQChannel.DREQ_PIO1_RX0,
    DREQChannel.DREQ_PIO1_RX1,
    DREQChannel.DREQ_PIO1_RX2,
    DREQChannel.DREQ_PIO1_RX3
  ];
  var dreqTx1 = [
    DREQChannel.DREQ_PIO1_TX0,
    DREQChannel.DREQ_PIO1_TX1,
    DREQChannel.DREQ_PIO1_TX2,
    DREQChannel.DREQ_PIO1_TX3
  ];
  var StateMachine = class {
    constructor(rp2040, pio, index) {
      this.rp2040 = rp2040;
      this.pio = pio;
      this.index = index;
      this.enabled = false;
      this.x = 0;
      this.y = 0;
      this.pc = 0;
      this.inputShiftReg = 0;
      this.inputShiftCount = 0;
      this.outputShiftReg = 0;
      this.outputShiftCount = 0;
      this.cycles = 0;
      this.execOpcode = 0;
      this.execValid = false;
      this.updatePC = true;
      this.clockDivInt = 1;
      this.clockDivFrac = 0;
      this.execCtrl = 31 << 12;
      this.shiftCtrl = 3 << 18;
      this.pinCtrl = 5 << 26;
      this.rxFIFO = new FIFO(4);
      this.txFIFO = new FIFO(4);
      this.outPinValues = 0;
      this.outPinDirection = 0;
      this.waiting = false;
      this.waitType = WaitType.None;
      this.waitIndex = 0;
      this.waitPolarity = false;
      this.waitDelay = -1;
      this.dreqRx = this.pio.dreqRx[this.index];
      this.dreqTx = this.pio.dreqTx[this.index];
      this.updateDMARx();
      this.updateDMATx();
    }
    updateDMATx() {
      if (this.txFIFO.full) {
        this.rp2040.dma.clearDREQ(this.dreqTx);
      } else {
        this.rp2040.dma.setDREQ(this.dreqTx);
      }
    }
    updateDMARx() {
      if (this.rxFIFO.empty) {
        this.rp2040.dma.clearDREQ(this.dreqRx);
      } else {
        this.rp2040.dma.setDREQ(this.dreqRx);
      }
    }
    writeFIFO(value) {
      if (this.txFIFO.full) {
        this.pio.fdebug |= FDEBUG_TXOVER << this.index;
        return;
      }
      this.txFIFO.push(value);
      this.pio.txStall &= ~(FDEBUG_TXSTALL << this.index);
      this.updateDMATx();
      this.checkWait();
      if (this.txFIFO.full) {
        this.pio.checkInterrupts();
      }
    }
    readFIFO() {
      if (this.rxFIFO.empty) {
        this.pio.fdebug |= FDEBUG_RXUNDER << this.index;
        return 0;
      }
      const result = this.rxFIFO.pull();
      this.pio.rxStall &= ~(FDEBUG_RXSTALL << this.index);
      this.updateDMARx();
      this.checkWait();
      if (this.rxFIFO.empty) {
        this.pio.checkInterrupts();
      }
      return result;
    }
    get status() {
      const statusN = this.execCtrl & 15;
      if (this.execCtrl & EXECCTRL_STATUS_SEL) {
        return this.rxFIFO.itemCount < statusN ? 4294967295 : 0;
      } else {
        return this.txFIFO.itemCount < statusN ? 4294967295 : 0;
      }
    }
    jmpCondition(condition) {
      switch (condition) {
        // (no condition): Always
        case 0:
          return true;
        // !X: scratch X zero
        case 1:
          return this.x === 0;
        // X--: scratch X non-zero, post-decrement
        case 2: {
          const oldX = this.x;
          this.x = this.x - 1 >>> 0;
          return oldX !== 0;
        }
        // !Y: scratch Y zero
        case 3:
          return this.y === 0;
        // Y--: scratch Y non-zero, post-decrement
        case 4: {
          const oldY = this.y;
          this.y = this.y - 1 >>> 0;
          return oldY !== 0;
        }
        // X!=Y: scratch X not equal scratch Y
        case 5:
          return this.x >>> 0 !== this.y >>> 0;
        // PIN: branch on input pin
        case 6: {
          const { gpio } = this.rp2040;
          const { jmpPin } = this;
          return jmpPin < gpio.length ? gpio[jmpPin].inputValue : false;
        }
        // !OSRE: output shift register not empty
        case 7:
          return this.outputShiftCount < this.pullThreshold;
      }
      this.pio.error(`jmpCondition with unsupported condition: ${condition}`);
      return false;
    }
    get inPins() {
      const { gpioValues } = this.rp2040;
      const { inBase } = this;
      return inBase ? gpioValues << 32 - inBase | gpioValues >>> inBase : gpioValues;
    }
    inSourceValue(source) {
      switch (source) {
        // PINS
        case 0:
          return this.inPins;
        // X (scratch register X)
        case 1:
          return this.x;
        // Y (scratch register Y)
        case 2:
          return this.y;
        // NULL (all zeroes)
        case 3:
          return 0;
        // Reserved
        case 4:
          return 0;
        // Reserved for IN, STATUS for MOV
        case 5:
          return this.status;
        // ISR
        case 6:
          return this.inputShiftReg;
        // OSR
        case 7:
          return this.outputShiftReg;
      }
      this.pio.error(`inSourceValue with unsupported source: ${source}`);
      return 0;
    }
    writeOutValue(destination, value, bitCount) {
      switch (destination) {
        // PINS
        case 0:
          this.setOutPins(value);
          break;
        // X (scratch register X)
        case 1:
          this.x = value;
          break;
        // Y (scratch register Y)
        case 2:
          this.y = value;
          break;
        // NULL (discard data)
        case 3:
          break;
        // PINDIRS
        case 4:
          this.setOutPinDirs(value);
          break;
        // PC
        case 5:
          this.pc = value & 31;
          this.updatePC = false;
          break;
        // ISR (also sets ISR shift counter to Bit count)
        case 6:
          this.inputShiftReg = value;
          this.inputShiftCount = bitCount;
          break;
        // EXEC (Execute OSR shift data as instruction)
        case 7:
          this.execOpcode = value;
          this.execValid = true;
          break;
      }
    }
    get pushThreshold() {
      const value = this.shiftCtrl >> 20 & 31;
      return value ? value : 32;
    }
    get pullThreshold() {
      const value = this.shiftCtrl >> 25 & 31;
      return value ? value : 32;
    }
    get sidesetCount() {
      return this.pinCtrl >> 29 & 7;
    }
    get setCount() {
      return this.pinCtrl >> 26 & 7;
    }
    get outCount() {
      return this.pinCtrl >> 20 & 63;
    }
    get inBase() {
      return this.pinCtrl >> 15 & 31;
    }
    get sidesetBase() {
      return this.pinCtrl >> 10 & 31;
    }
    get setBase() {
      return this.pinCtrl >> 5 & 31;
    }
    get outBase() {
      return this.pinCtrl >> 0 & 31;
    }
    get jmpPin() {
      return this.execCtrl >> 24 & 31;
    }
    get wrapTop() {
      return this.execCtrl >> 12 & 31;
    }
    get wrapBottom() {
      return this.execCtrl >> 7 & 31;
    }
    setOutPinDirs(value) {
      this.outPinDirection = value;
      this.pio.pinDirectionsChanged(value, this.outBase, this.outCount);
    }
    setOutPins(value) {
      this.outPinValues = value;
      this.pio.pinValuesChanged(value, this.outBase, this.outCount);
    }
    outInstruction(arg) {
      const bitCount = arg & 31;
      const destination = arg >> 5;
      if (bitCount === 0) {
        this.writeOutValue(destination, this.outputShiftReg, 32);
        this.outputShiftCount = 32;
      } else {
        if (this.shiftCtrl & SHIFTCTRL_OUT_SHIFTDIR) {
          const value = this.outputShiftReg & (1 << bitCount) - 1;
          this.outputShiftReg >>>= bitCount;
          this.writeOutValue(destination, value, bitCount);
        } else {
          const value = this.outputShiftReg >>> 32 - bitCount;
          this.outputShiftReg <<= bitCount;
          this.writeOutValue(destination, value, bitCount);
        }
        this.outputShiftCount += bitCount;
        if (this.outputShiftCount > 32) {
          this.outputShiftCount = 32;
        }
      }
    }
    executeInstruction(opcode) {
      const arg = opcode & 255;
      switch (opcode >>> 13) {
        /* JMP */
        case 0:
          if (this.jmpCondition(arg >> 5)) {
            this.pc = arg & 31;
            this.updatePC = false;
          }
          break;
        /* WAIT */
        case 1: {
          const polarity = !!(arg & 128);
          const source = arg >> 5 & 3;
          const index = arg & 31;
          switch (source) {
            // GPIO:
            case 0:
              this.wait(WaitType.Pin, polarity, index);
              break;
            // PIN:
            case 1:
              this.wait(WaitType.Pin, polarity, (index + this.inBase) % 32);
              break;
            // IRQ:
            case 2:
              this.wait(WaitType.IRQ, polarity, irqIndex(index, this.index));
              break;
          }
          break;
        }
        /* IN */
        case 2: {
          const bitCount = arg & 31;
          let sourceValue = this.inSourceValue(arg >> 5);
          if (bitCount == 0) {
            this.inputShiftReg = sourceValue;
            this.inputShiftCount = 32;
          } else {
            sourceValue &= (1 << bitCount) - 1;
            if (this.shiftCtrl & SHIFTCTRL_IN_SHIFTDIR) {
              this.inputShiftReg >>>= bitCount;
              this.inputShiftReg |= sourceValue << 32 - bitCount;
            } else {
              this.inputShiftReg <<= bitCount;
              this.inputShiftReg |= sourceValue;
            }
            this.inputShiftCount += bitCount;
            if (this.inputShiftCount > 32) {
              this.inputShiftCount = 32;
            }
          }
          if (this.shiftCtrl & SHIFTCTRL_AUTOPUSH && this.inputShiftCount >= this.pushThreshold) {
            if (!this.rxFIFO.full) {
              this.rxFIFO.push(this.inputShiftReg);
              this.updateDMARx();
              this.pio.checkInterrupts();
            } else {
              this.pio.rxStall |= FDEBUG_RXSTALL << this.index;
              this.pio.fdebug |= this.pio.rxStall;
              this.wait(WaitType.rxFIFO, false, this.inputShiftReg);
            }
            this.inputShiftCount = 0;
            this.inputShiftReg = 0;
          }
          break;
        }
        /* OUT */
        case 3: {
          if (this.shiftCtrl & SHIFTCTRL_AUTOPULL && this.outputShiftCount >= this.pullThreshold) {
            this.outputShiftCount = 0;
            if (!this.txFIFO.empty) {
              this.outputShiftReg = this.txFIFO.pull();
              this.updateDMATx();
              this.pio.checkInterrupts();
            } else {
              this.pio.txStall |= FDEBUG_TXSTALL << this.index;
              this.pio.fdebug |= this.pio.txStall;
              this.wait(WaitType.Out, false, arg);
            }
          }
          if (!this.waiting) {
            this.outInstruction(arg);
          }
          break;
        }
        /* PUSH/PULL */
        case 4: {
          const block = !!(arg & 1 << 5);
          const ifFullOrEmpty = !!(arg & 1 << 6);
          if (arg & 31) {
            break;
          }
          if (arg & 128) {
            if (ifFullOrEmpty && this.shiftCtrl & SHIFTCTRL_AUTOPULL && this.outputShiftCount < this.pullThreshold) {
              break;
            }
            if (!this.txFIFO.empty) {
              this.outputShiftReg = this.txFIFO.pull();
              this.updateDMATx();
              this.pio.checkInterrupts();
            } else {
              this.pio.txStall |= FDEBUG_TXSTALL << this.index;
              this.pio.fdebug |= this.pio.txStall;
              if (block) {
                this.wait(WaitType.txFIFO, false, 0);
              } else {
                this.outputShiftReg = this.x;
              }
            }
            this.outputShiftCount = 0;
          } else {
            if (ifFullOrEmpty && this.shiftCtrl & SHIFTCTRL_AUTOPUSH && this.inputShiftCount < this.pushThreshold) {
              break;
            }
            if (!this.rxFIFO.full) {
              this.rxFIFO.push(this.inputShiftReg);
              this.updateDMARx();
              this.pio.checkInterrupts();
            } else {
              this.pio.rxStall |= FDEBUG_RXSTALL << this.index;
              this.pio.fdebug |= this.pio.rxStall;
              if (block) {
                this.wait(WaitType.rxFIFO, false, this.inputShiftReg);
              }
            }
            this.inputShiftReg = 0;
            this.inputShiftCount = 0;
          }
          break;
        }
        /* MOV */
        case 5: {
          const source = arg & 7;
          const op = arg >> 3 & 3;
          const destination = arg >> 5 & 7;
          const value = this.inSourceValue(source);
          const transformedValue = this.transformMovValue(value, op) >>> 0;
          this.setMovDestination(destination, transformedValue);
          break;
        }
        /* IRQ */
        case 6: {
          if (arg & 128) {
            break;
          }
          const clear = !!(arg & 64);
          const wait = !!(arg & 32);
          const irq = irqIndex(arg & 31, this.index);
          if (clear) {
            this.pio.irq &= ~(1 << irq);
            this.pio.irqUpdated();
          } else {
            this.pio.irq |= 1 << irq;
            this.pio.irqUpdated();
            if (wait) {
              this.wait(WaitType.IRQ, false, irq);
            }
          }
          break;
        }
        /* SET */
        case 7: {
          const data = arg & 31;
          const destination = arg >> 5;
          switch (destination) {
            case 0:
              this.setSetPins(data);
              break;
            case 1:
              this.x = data;
              break;
            case 2:
              this.y = data;
              break;
            case 4:
              this.setSetPinDirs(data);
              break;
          }
          break;
        }
      }
      this.cycles++;
      const { sidesetCount, execCtrl } = this;
      const delaySideset = opcode >> 8 & 31;
      const sideEn = !!(execCtrl & EXECCTRL_SIDE_EN);
      const delay = delaySideset & (1 << 5 - sidesetCount) - 1;
      if (sidesetCount && (!sideEn || delaySideset & 16)) {
        const sideset = delaySideset >> 5 - sidesetCount;
        this.setSideset(sideset, sideEn ? sidesetCount - 1 : sidesetCount);
      }
      if (this.execValid) {
        this.execValid = false;
        this.executeInstruction(this.execOpcode);
      } else if (this.waiting) {
        if (this.waitDelay < 0) {
          this.waitDelay = delay;
        }
        this.checkWait();
      } else {
        this.cycles += delay;
      }
    }
    wait(type, polarity, index) {
      this.waiting = true;
      this.waitType = type;
      this.waitPolarity = polarity;
      this.waitIndex = index;
      this.waitDelay = -1;
      this.updatePC = false;
    }
    nextPC() {
      if (this.pc === this.wrapTop) {
        this.pc = this.wrapBottom;
      } else {
        this.pc = this.pc + 1 & 31;
      }
    }
    step() {
      if (this.waiting) {
        this.checkWait();
        if (this.waiting) {
          return;
        }
      }
      this.updatePC = true;
      this.executeInstruction(this.pio.instructions[this.pc]);
      if (this.updatePC) {
        this.nextPC();
      }
    }
    setSetPinDirs(value) {
      this.pio.pinDirectionsChanged(value, this.setBase, this.setCount);
    }
    setSetPins(value) {
      this.pio.pinValuesChanged(value, this.setBase, this.setCount);
    }
    setSideset(value, count) {
      if (this.execCtrl & EXECCTRL_SIDE_PINDIR) {
        this.pio.pinDirectionsChanged(value, this.sidesetBase, count);
      } else {
        this.pio.pinValuesChanged(value, this.sidesetBase, count);
      }
    }
    transformMovValue(value, op) {
      switch (op) {
        case 0:
          return value;
        case 1:
          return ~value;
        case 2:
          return bitReverse(value);
        case 3:
        default:
          return value;
      }
    }
    setMovDestination(destination, value) {
      switch (destination) {
        // PINS
        case 0:
          this.setOutPins(value);
          break;
        // X (scratch register X)
        case 1:
          this.x = value;
          break;
        // Y (scratch register Y)
        case 2:
          this.y = value;
          break;
        // reserved (discard data)
        case 3:
          break;
        // EXEC
        case 4:
          this.execOpcode = value;
          this.execValid = true;
          break;
        // PC
        case 5:
          this.pc = value & 31;
          this.updatePC = false;
          break;
        // ISR (Input shift counter is reset to 0 by this operation, i.e. empty)
        case 6:
          this.inputShiftReg = value;
          this.inputShiftCount = 0;
          break;
        // OSR (Output shift counter is reset to 0 by this operation, i.e. full)
        case 7:
          this.outputShiftReg = value;
          this.outputShiftCount = 0;
          break;
      }
    }
    readUint32(offset) {
      switch (offset + SM0_CLKDIV) {
        case SM0_CLKDIV:
          return this.clockDivInt << 16 | this.clockDivFrac << 8;
        case SM0_EXECCTRL:
          return this.execCtrl;
        case SM0_SHIFTCTRL:
          return this.shiftCtrl;
        case SM0_ADDR:
          return this.pc;
        case SM0_INSTR:
          return this.pio.instructions[this.pc];
        case SM0_PINCTRL:
          return this.pinCtrl;
      }
      this.pio.error(`Read from invalid state machine register: ${offset}`);
      return 0;
    }
    writeUint32(offset, value) {
      switch (offset + SM0_CLKDIV) {
        case SM0_CLKDIV:
          this.clockDivFrac = value >>> 8 & 255;
          this.clockDivInt = value >>> 16;
          break;
        case SM0_EXECCTRL:
          this.execCtrl = (value & 2147483647 | this.execCtrl & 2147483648) >>> 0;
          break;
        case SM0_SHIFTCTRL:
          this.shiftCtrl = value;
          break;
        case SM0_ADDR:
          break;
        case SM0_INSTR:
          this.executeInstruction(value & 65535);
          if (this.waiting) {
            this.execCtrl |= EXECCTRL_EXEC_STALLED;
          }
          break;
        case SM0_PINCTRL:
          this.pinCtrl = value;
          break;
        default:
          this.pio.error(`Write to invalid state machine register: ${offset}`);
      }
    }
    get fifoStat() {
      const result = (this.txFIFO.empty ? FSTAT_TXEMPTY : 0) | (this.txFIFO.full ? FSTAT_TXFULL : 0) | (this.rxFIFO.empty ? FSTAT_RXEMPTY : 0) | (this.rxFIFO.full ? FSTAT_RXFULL : 0);
      return result << this.index;
    }
    restart() {
      this.cycles = 0;
      this.inputShiftCount = 0;
      this.outputShiftCount = 32;
      this.inputShiftReg = 0;
      this.waiting = false;
    }
    clkDivRestart() {
      this.pio.warn("clkDivRestart not implemented");
    }
    checkWait() {
      if (!this.waiting) {
        return;
      }
      switch (this.waitType) {
        case WaitType.IRQ: {
          const irqValue = !!(this.pio.irq & 1 << this.waitIndex);
          if (irqValue === this.waitPolarity) {
            this.waiting = false;
            if (irqValue) {
              this.pio.irq &= ~(1 << this.waitIndex);
            }
          }
          break;
        }
        case WaitType.Pin: {
          if (this.waitIndex < this.rp2040.gpio.length && this.rp2040.gpio[this.waitIndex].inputValue === this.waitPolarity) {
            this.waiting = false;
          }
          break;
        }
        case WaitType.rxFIFO: {
          if (!this.rxFIFO.full) {
            this.rxFIFO.push(this.waitIndex);
            this.waiting = false;
            this.updateDMARx();
            this.pio.checkInterrupts();
          }
          break;
        }
        case WaitType.txFIFO: {
          if (!this.txFIFO.empty) {
            this.outputShiftReg = this.txFIFO.pull();
            this.waiting = false;
            this.updateDMATx();
            this.pio.checkInterrupts();
          }
          break;
        }
        case WaitType.Out: {
          if (!this.txFIFO.empty) {
            this.outputShiftReg = this.txFIFO.pull();
            this.outInstruction(this.waitIndex);
            this.waiting = false;
            this.updateDMATx();
            this.pio.checkInterrupts();
          }
          break;
        }
      }
      if (!this.waiting) {
        this.nextPC();
        this.cycles += this.waitDelay;
        this.execCtrl &= ~EXECCTRL_EXEC_STALLED;
      }
    }
  };
  var RPPIO = class extends BasePeripheral {
    constructor(rp2040, name, firstIrq, index) {
      super(rp2040, name);
      this.firstIrq = firstIrq;
      this.index = index;
      this.instructions = new Uint32Array(32);
      this.dreqRx = this.index ? dreqRx1 : dreqRx0;
      this.dreqTx = this.index ? dreqTx1 : dreqTx0;
      this.machines = [
        new StateMachine(this.rp2040, this, 0),
        new StateMachine(this.rp2040, this, 1),
        new StateMachine(this.rp2040, this, 2),
        new StateMachine(this.rp2040, this, 3)
      ];
      this.stopped = true;
      this.fdebug = 0;
      this.txStall = 0;
      this.rxStall = 0;
      this.inputSyncBypass = 0;
      this.irq = 0;
      this.pinValues = 0;
      this.pinDirections = 0;
      this.oldPinValues = 0;
      this.oldPinDirections = 0;
      this.runTimer = null;
      this.irq0IntEnable = 0;
      this.irq0IntForce = 0;
      this.irq1IntEnable = 0;
      this.irq1IntForce = 0;
    }
    get intRaw() {
      return (this.irq & 15) << 8 | (!this.machines[3].txFIFO.full ? 128 : 0) | (!this.machines[2].txFIFO.full ? 64 : 0) | (!this.machines[1].txFIFO.full ? 32 : 0) | (!this.machines[0].txFIFO.full ? 16 : 0) | (!this.machines[3].rxFIFO.empty ? 8 : 0) | (!this.machines[2].rxFIFO.empty ? 4 : 0) | (!this.machines[1].rxFIFO.empty ? 2 : 0) | (!this.machines[0].rxFIFO.empty ? 1 : 0);
    }
    get irq0IntStatus() {
      return this.intRaw & this.irq0IntEnable | this.irq0IntForce;
    }
    get irq1IntStatus() {
      return this.intRaw & this.irq1IntEnable | this.irq1IntForce;
    }
    readUint32(offset) {
      if (offset >= SM0_CLKDIV && offset <= SM0_PINCTRL) {
        return this.machines[0].readUint32(offset - SM0_CLKDIV);
      }
      if (offset >= SM1_CLKDIV && offset <= SM1_PINCTRL) {
        return this.machines[1].readUint32(offset - SM1_CLKDIV);
      }
      if (offset >= SM2_CLKDIV && offset <= SM2_PINCTRL) {
        return this.machines[2].readUint32(offset - SM2_CLKDIV);
      }
      if (offset >= SM3_CLKDIV && offset <= SM3_PINCTRL) {
        return this.machines[3].readUint32(offset - SM3_CLKDIV);
      }
      switch (offset) {
        case CTRL:
          return (this.machines[0].enabled ? 1 << 0 : 0) | (this.machines[1].enabled ? 1 << 1 : 0) | (this.machines[2].enabled ? 1 << 2 : 0) | (this.machines[3].enabled ? 1 << 3 : 0);
        case FSTAT:
          return this.machines[0].fifoStat | this.machines[1].fifoStat | this.machines[2].fifoStat | this.machines[3].fifoStat;
        case FDEBUG:
          return this.fdebug;
        case FLEVEL:
          return this.machines[0].txFIFO.itemCount & 15 | (this.machines[0].rxFIFO.itemCount & 15) << 4 | (this.machines[1].txFIFO.itemCount & 15) << 8 | (this.machines[1].rxFIFO.itemCount & 15) << 12 | (this.machines[2].txFIFO.itemCount & 15) << 16 | (this.machines[2].rxFIFO.itemCount & 15) << 20 | (this.machines[3].txFIFO.itemCount & 15) << 24 | (this.machines[3].rxFIFO.itemCount & 15) << 28;
        case RXF0:
          return this.machines[0].readFIFO();
        case RXF1:
          return this.machines[1].readFIFO();
        case RXF2:
          return this.machines[2].readFIFO();
        case RXF3:
          return this.machines[3].readFIFO();
        case IRQ2:
          return this.irq;
        case IRQ_FORCE:
          return 0;
        case INPUT_SYNC_BYPASS:
          return this.inputSyncBypass;
        case DBG_PADOUT:
          return this.pinValues;
        case DBG_PADOE:
          return this.pinDirections;
        case DBG_CFGINFO:
          return 2098180;
        case INTR2:
          return this.intRaw;
        case IRQ0_INTE:
          return this.irq0IntEnable;
        case IRQ0_INTF:
          return this.irq0IntForce;
        case IRQ0_INTS:
          return this.irq0IntStatus;
        case IRQ1_INTE:
          return this.irq1IntEnable;
        case IRQ1_INTF:
          return this.irq1IntForce;
        case IRQ1_INTS:
          return this.irq1IntStatus;
      }
      return super.readUint32(offset);
    }
    writeUint32(offset, value) {
      if (offset >= INSTR_MEM0 && offset <= INSTR_MEM31) {
        const index = offset - INSTR_MEM0 >> 2;
        this.instructions[index] = value & 65535;
        return;
      }
      if (offset >= SM0_CLKDIV && offset <= SM0_PINCTRL) {
        this.machines[0].writeUint32(offset - SM0_CLKDIV, value);
        return;
      }
      if (offset >= SM1_CLKDIV && offset <= SM1_PINCTRL) {
        this.machines[1].writeUint32(offset - SM1_CLKDIV, value);
        return;
      }
      if (offset >= SM2_CLKDIV && offset <= SM2_PINCTRL) {
        this.machines[2].writeUint32(offset - SM2_CLKDIV, value);
        return;
      }
      if (offset >= SM3_CLKDIV && offset <= SM3_PINCTRL) {
        this.machines[3].writeUint32(offset - SM3_CLKDIV, value);
        return;
      }
      switch (offset) {
        case CTRL: {
          for (let index = 0; index < 4; index++) {
            this.machines[index].enabled = value & 1 << index ? true : false;
            if (value & 1 << 4 + index) {
              this.machines[index].restart();
            }
            if (value & 1 << 8 + index) {
              this.machines[index].clkDivRestart();
            }
          }
          const shouldRun = value & 15;
          if (this.stopped && shouldRun) {
            this.stopped = false;
            this.run();
          }
          if (!shouldRun) {
            this.stopped = true;
          }
          break;
        }
        case FDEBUG:
          this.fdebug &= ~this.rawWriteValue;
          this.fdebug |= this.txStall | this.rxStall;
          break;
        case TXF0:
          this.machines[0].writeFIFO(value);
          break;
        case TXF1:
          this.machines[1].writeFIFO(value);
          break;
        case TXF2:
          this.machines[2].writeFIFO(value);
          break;
        case TXF3:
          this.machines[3].writeFIFO(value);
          break;
        case IRQ2:
          this.irq &= ~this.rawWriteValue;
          this.irqUpdated();
          break;
        case INPUT_SYNC_BYPASS:
          this.inputSyncBypass = value;
          break;
        case IRQ_FORCE:
          this.irq |= value;
          this.irqUpdated();
          break;
        case IRQ0_INTE:
          this.irq0IntEnable = value & 4095;
          this.checkInterrupts();
          break;
        case IRQ0_INTF:
          this.irq0IntForce = value & 4095;
          this.checkInterrupts();
          break;
        case IRQ1_INTE:
          this.irq1IntEnable = value & 4095;
          this.checkInterrupts();
          break;
        case IRQ1_INTF:
          this.irq1IntForce = value & 4095;
          this.checkInterrupts();
          break;
        default:
          super.writeUint32(offset, value);
      }
    }
    pinValuesChanged(value, firstPin, count) {
      const mask = count > 31 ? 4294967295 : (1 << count) - 1 << firstPin;
      const newValue = (this.pinValues & ~mask | value << firstPin & mask) & 1073741823;
      this.pinValues = newValue;
    }
    pinDirectionsChanged(value, firstPin, count) {
      const mask = count > 31 ? 4294967295 : (1 << count) - 1 << firstPin;
      const newValue = (this.pinDirections & ~mask | value << firstPin & mask) & 1073741823;
      this.pinDirections = newValue;
    }
    checkInterrupts() {
      const { firstIrq } = this;
      this.rp2040.setInterrupt(firstIrq, !!this.irq0IntStatus);
      this.rp2040.setInterrupt(firstIrq + 1, !!this.irq1IntStatus);
    }
    irqUpdated() {
      for (const machine of this.machines) {
        machine.checkWait();
      }
      this.checkInterrupts();
    }
    checkChangedPins() {
      const changedPins = this.oldPinDirections ^ this.pinDirections | this.oldPinValues ^ this.pinValues;
      if (changedPins) {
        this.oldPinDirections = this.pinDirections;
        this.oldPinValues = this.pinValues;
        const { gpio } = this.rp2040;
        for (let gpioIndex = 0; gpioIndex < gpio.length; gpioIndex++) {
          if (changedPins & 1 << gpioIndex) {
            gpio[gpioIndex].checkForUpdates();
          }
        }
      }
    }
    step() {
      for (const machine of this.machines) {
        machine.step();
      }
      this.checkChangedPins();
    }
    run() {
      for (let i = 0; i < 1e3 && !this.stopped; i++) {
        this.step();
      }
      if (!this.stopped) {
        this.runTimer = setTimeout(() => this.run(), 0);
      }
    }
    stop() {
      for (const machine of this.machines) {
        machine.enabled = false;
      }
      this.stopped = true;
      if (this.runTimer) {
        clearTimeout(this.runTimer);
        this.runTimer = null;
      }
    }
  };

  // tools/programmable_simulator/node_modules/rp2040js/dist/esm/gpio-pin.js
  var GPIOPinState;
  (function(GPIOPinState2) {
    GPIOPinState2[GPIOPinState2["Low"] = 0] = "Low";
    GPIOPinState2[GPIOPinState2["High"] = 1] = "High";
    GPIOPinState2[GPIOPinState2["Input"] = 2] = "Input";
    GPIOPinState2[GPIOPinState2["InputPullUp"] = 3] = "InputPullUp";
    GPIOPinState2[GPIOPinState2["InputPullDown"] = 4] = "InputPullDown";
    GPIOPinState2[GPIOPinState2["InputBusKeeper"] = 5] = "InputBusKeeper";
  })(GPIOPinState || (GPIOPinState = {}));
  var FUNCTION_PWM = 4;
  var FUNCTION_SIO = 5;
  var FUNCTION_PIO0 = 6;
  var FUNCTION_PIO1 = 7;
  function applyOverride(value, overrideType) {
    switch (overrideType) {
      case 0:
        return value;
      case 1:
        return !value;
      case 2:
        return false;
      case 3:
        return true;
    }
    console.error("applyOverride received invalid override type", overrideType);
    return value;
  }
  var IRQ_EDGE_HIGH = 1 << 3;
  var IRQ_EDGE_LOW = 1 << 2;
  var IRQ_LEVEL_HIGH = 1 << 1;
  var IRQ_LEVEL_LOW = 1 << 0;
  var GPIOPin = class {
    constructor(rp2040, index, name = index.toString()) {
      this.rp2040 = rp2040;
      this.index = index;
      this.name = name;
      this.rawInputValue = false;
      this.lastValue = this.value;
      this.ctrl = 31;
      this.padValue = 54;
      this.irqEnableMask = 0;
      this.irqForceMask = 0;
      this.irqStatus = 0;
      this.listeners = /* @__PURE__ */ new Set();
    }
    get rawInterrupt() {
      return !!(this.irqStatus & this.irqEnableMask | this.irqForceMask);
    }
    get isSlewFast() {
      return !!(this.padValue & 1);
    }
    get schmittEnabled() {
      return !!(this.padValue & 2);
    }
    get pulldownEnabled() {
      return !!(this.padValue & 4);
    }
    get pullupEnabled() {
      return !!(this.padValue & 8);
    }
    get driveStrength() {
      return this.padValue >> 4 & 3;
    }
    get inputEnable() {
      return !!(this.padValue & 64);
    }
    get outputDisable() {
      return !!(this.padValue & 128);
    }
    get functionSelect() {
      return this.ctrl & 31;
    }
    get outputOverride() {
      return this.ctrl >> 8 & 3;
    }
    get outputEnableOverride() {
      return this.ctrl >> 12 & 3;
    }
    get inputOverride() {
      return this.ctrl >> 16 & 3;
    }
    get irqOverride() {
      return this.ctrl >> 28 & 3;
    }
    get rawOutputEnable() {
      const { index, rp2040, functionSelect } = this;
      const bitmask = 1 << index;
      switch (functionSelect) {
        case FUNCTION_PWM:
          return !!(rp2040.pwm.gpioDirection & bitmask);
        case FUNCTION_SIO:
          return !!(rp2040.sio.gpioOutputEnable & bitmask);
        case FUNCTION_PIO0:
          return !!(rp2040.pio[0].pinDirections & bitmask);
        case FUNCTION_PIO1:
          return !!(rp2040.pio[1].pinDirections & bitmask);
        default:
          return false;
      }
    }
    get rawOutputValue() {
      const { index, rp2040, functionSelect } = this;
      const bitmask = 1 << index;
      switch (functionSelect) {
        case FUNCTION_PWM:
          return !!(rp2040.pwm.gpioValue & bitmask);
        case FUNCTION_SIO:
          return !!(rp2040.sio.gpioValue & bitmask);
        case FUNCTION_PIO0:
          return !!(rp2040.pio[0].pinValues & bitmask);
        case FUNCTION_PIO1:
          return !!(rp2040.pio[1].pinValues & bitmask);
        default:
          return false;
      }
    }
    get inputValue() {
      return applyOverride(this.rawInputValue && this.inputEnable, this.inputOverride);
    }
    get irqValue() {
      return applyOverride(this.rawInterrupt, this.irqOverride);
    }
    get outputEnable() {
      return applyOverride(this.rawOutputEnable, this.outputEnableOverride);
    }
    get outputValue() {
      return applyOverride(this.rawOutputValue, this.outputOverride);
    }
    /**
     * Returns the STATUS register value for the pin, as outlined in section 2.19.6 of the datasheet
     */
    get status() {
      const irqToProc = this.irqValue ? 1 << 26 : 0;
      const irqFromPad = this.rawInterrupt ? 1 << 24 : 0;
      const inToPeri = this.inputValue ? 1 << 19 : 0;
      const inFromPad = this.rawInputValue ? 1 << 17 : 0;
      const oeToPad = this.outputEnable ? 1 << 13 : 0;
      const oeFromPeri = this.rawOutputEnable ? 1 << 12 : 0;
      const outToPad = this.outputValue ? 1 << 9 : 0;
      const outFromPeri = this.rawOutputValue ? 1 << 8 : 0;
      return irqToProc | irqFromPad | inToPeri | inFromPad | oeToPad | oeFromPeri | outToPad | outFromPeri;
    }
    get value() {
      if (this.outputEnable) {
        return this.outputValue ? GPIOPinState.High : GPIOPinState.Low;
      } else {
        if (this.pulldownEnabled && this.pullupEnabled) {
          return GPIOPinState.InputBusKeeper;
        } else if (this.pulldownEnabled) {
          return GPIOPinState.InputPullDown;
        } else if (this.pullupEnabled) {
          return GPIOPinState.InputPullUp;
        }
        return GPIOPinState.Input;
      }
    }
    setInputValue(value) {
      this.rawInputValue = value;
      const prevIrqValue = this.irqValue;
      if (value && this.inputEnable) {
        this.irqStatus |= IRQ_EDGE_HIGH | IRQ_LEVEL_HIGH;
        this.irqStatus &= ~IRQ_LEVEL_LOW;
      } else {
        this.irqStatus |= IRQ_EDGE_LOW | IRQ_LEVEL_LOW;
        this.irqStatus &= ~IRQ_LEVEL_HIGH;
      }
      if (this.irqValue !== prevIrqValue) {
        this.rp2040.updateIOInterrupt();
      }
      if (this.functionSelect === FUNCTION_PWM) {
        this.rp2040.pwm.gpioOnInput(this.index);
      }
      for (const pio of this.rp2040.pio) {
        for (const machine of pio.machines) {
          if (machine.enabled && machine.waiting && machine.waitType === WaitType.Pin && machine.waitIndex === this.index) {
            machine.checkWait();
          }
        }
      }
    }
    checkForUpdates() {
      const { lastValue, value } = this;
      if (value !== lastValue) {
        this.lastValue = value;
        for (const listener of this.listeners) {
          listener(value, lastValue);
        }
      }
    }
    refreshInput() {
      this.setInputValue(this.rawInputValue);
    }
    updateIRQValue(value) {
      if (value & IRQ_EDGE_LOW && this.irqStatus & IRQ_EDGE_LOW) {
        this.irqStatus &= ~IRQ_EDGE_LOW;
        this.rp2040.updateIOInterrupt();
      }
      if (value & IRQ_EDGE_HIGH && this.irqStatus & IRQ_EDGE_HIGH) {
        this.irqStatus &= ~IRQ_EDGE_HIGH;
        this.rp2040.updateIOInterrupt();
      }
    }
    addListener(callback) {
      this.listeners.add(callback);
      return () => this.listeners.delete(callback);
    }
  };

  // tools/programmable_simulator/node_modules/rp2040js/dist/esm/peripherals/adc.js
  var CS = 0;
  var RESULT = 4;
  var FCS = 8;
  var FIFO_REG = 12;
  var DIV = 16;
  var INTR3 = 20;
  var INTE = 24;
  var INTF = 28;
  var INTS = 32;
  var CS_RROBIN_MASK = 31;
  var CS_RROBIN_SHIFT = 16;
  var CS_AINSEL_MASK = 7;
  var CS_AINSEL_SHIFT = 12;
  var CS_ERR_STICKY = 1 << 10;
  var CS_ERR = 1 << 9;
  var CS_READY = 1 << 8;
  var CS_START_MANY = 1 << 3;
  var CS_START_ONE = 1 << 2;
  var CS_TS_EN = 1 << 1;
  var CS_EN = 1 << 0;
  var CS_WRITE_MASK = CS_RROBIN_MASK << CS_RROBIN_SHIFT | CS_AINSEL_MASK << CS_AINSEL_SHIFT | CS_START_MANY | CS_START_ONE | CS_TS_EN | CS_EN;
  var FCS_THRES_MASK = 15;
  var FCS_THRESH_SHIFT = 24;
  var FCS_LEVEL_MASK = 15;
  var FCS_LEVEL_SHIFT = 16;
  var FCS_OVER = 1 << 11;
  var FCS_UNDER = 1 << 10;
  var FCS_FULL = 1 << 9;
  var FCS_EMPTY = 1 << 8;
  var FCS_DREQ_EN = 1 << 3;
  var FCS_ERR = 1 << 2;
  var FCS_SHIFT = 1 << 1;
  var FCS_EN = 1 << 0;
  var FCS_WRITE_MASK = FCS_THRES_MASK << FCS_THRESH_SHIFT | FCS_DREQ_EN | FCS_ERR | FCS_SHIFT | FCS_EN;
  var FIFO_ERR = 1 << 15;
  var DIV_INT_MASK = 65535;
  var DIV_INT_SHIFT = 8;
  var DIV_FRAC_MASK = 255;
  var DIV_FRAC_SHIFT = 0;
  var FIFO_INT = 1 << 0;
  var RPADC = class extends BasePeripheral {
    get temperatueEnable() {
      return this.cs & CS_TS_EN;
    }
    get enabled() {
      return this.cs & CS_EN;
    }
    get divider() {
      return 1 + (this.clockDiv >> DIV_INT_SHIFT & DIV_INT_MASK) + (this.clockDiv >> DIV_FRAC_SHIFT & DIV_FRAC_MASK) / 256;
    }
    get intRaw() {
      const thres = this.fcs >> FCS_THRESH_SHIFT & FCS_THRES_MASK;
      return this.fifo.itemCount >= thres ? FIFO_INT : 0;
    }
    get intStatus() {
      return this.intRaw & this.intEnable | this.intForce;
    }
    get activeChannel() {
      return this.cs >> CS_AINSEL_SHIFT & CS_AINSEL_MASK;
    }
    set activeChannel(channel) {
      this.cs &= ~(CS_AINSEL_MASK << CS_AINSEL_SHIFT);
      this.cs |= (channel & CS_AINSEL_SHIFT) << CS_AINSEL_SHIFT;
    }
    constructor(rp2040, name) {
      super(rp2040, name);
      this.numChannels = 5;
      this.resolution = 12;
      this.sampleTime = 2;
      this.channelValues = [0, 0, 0, 0, 0];
      this.onADCRead = (channel) => {
        this.currentChannel = channel;
        this.sampleAlarm.schedule(this.sampleTime * 1e3);
      };
      this.fifo = new FIFO(4);
      this.dreq = DREQChannel.DREQ_ADC;
      this.cs = 0;
      this.fcs = 0;
      this.clockDiv = 0;
      this.intEnable = 0;
      this.intForce = 0;
      this.result = 0;
      this.busy = false;
      this.err = false;
      this.currentChannel = 0;
      this.sampleAlarm = this.rp2040.clock.createAlarm(() => this.completeADCRead(this.channelValues[this.currentChannel], false));
      this.multiShotAlarm = this.rp2040.clock.createAlarm(() => {
        if (this.cs & CS_START_MANY) {
          this.startADCRead();
        }
      });
    }
    checkInterrupts() {
      this.rp2040.setInterrupt(IRQ.ADC_FIFO, !!this.intStatus);
    }
    startADCRead() {
      this.busy = true;
      this.onADCRead(this.activeChannel);
    }
    updateDMA() {
      if (this.fcs & FCS_DREQ_EN) {
        const thres = this.fcs >> FCS_THRESH_SHIFT & FCS_THRES_MASK;
        if (this.fifo.itemCount >= thres) {
          this.rp2040.dma.setDREQ(this.dreq);
        } else {
          this.rp2040.dma.clearDREQ(this.dreq);
        }
      }
    }
    completeADCRead(value, error) {
      this.busy = false;
      this.result = value;
      if (error) {
        this.cs |= CS_ERR_STICKY | CS_ERR;
      } else {
        this.cs &= ~CS_ERR;
      }
      if (this.fcs & FCS_EN) {
        if (this.fifo.full) {
          this.fcs |= FCS_OVER;
        } else {
          value &= 4095;
          if (this.fcs & FCS_SHIFT) {
            value >>= 4;
          }
          if (error && this.fcs & FCS_ERR) {
            value |= FIFO_ERR;
          }
          this.fifo.push(value);
          this.updateDMA();
          this.checkInterrupts();
        }
      }
      const round = this.cs >> CS_RROBIN_SHIFT & CS_RROBIN_MASK;
      if (round) {
        let channel = this.activeChannel + 1;
        while (!(round & 1 << channel)) {
          channel = (channel + 1) % this.numChannels;
        }
        this.activeChannel = channel;
      }
      if (this.cs & CS_START_MANY) {
        const clockMHZ = 48;
        const sampleTicks = clockMHZ * this.sampleTime;
        if (this.divider > sampleTicks) {
          const micros = (this.divider - sampleTicks) / clockMHZ;
          this.multiShotAlarm.schedule(micros * 1e3);
        } else {
          this.startADCRead();
        }
      }
    }
    readUint32(offset) {
      switch (offset) {
        case CS:
          return this.cs | (this.err ? CS_ERR : 0) | (this.busy ? 0 : CS_READY);
        case RESULT:
          return this.result;
        case FCS:
          return this.fcs | (this.fifo.itemCount & FCS_LEVEL_MASK) << FCS_LEVEL_SHIFT | (this.fifo.full ? FCS_FULL : 0) | (this.fifo.empty ? FCS_EMPTY : 0);
        case FIFO_REG:
          if (this.fifo.empty) {
            this.fcs |= FCS_UNDER;
            return 0;
          } else {
            const value = this.fifo.pull();
            this.updateDMA();
            return value;
          }
        case DIV:
          return this.clockDiv;
        case INTR3:
          return this.intRaw;
        case INTE:
          return this.intEnable;
        case INTF:
          return this.intForce;
        case INTS:
          return this.intStatus;
      }
      return super.readUint32(offset);
    }
    writeUint32(offset, value) {
      switch (offset) {
        case CS:
          this.fcs &= ~(value & CS_ERR_STICKY);
          this.cs = this.cs & ~CS_WRITE_MASK | value & CS_WRITE_MASK;
          if (value & CS_EN && !this.busy && (value & CS_START_ONE || value & CS_START_MANY)) {
            this.startADCRead();
          }
          break;
        case FCS:
          this.fcs &= ~(value & (FCS_OVER | FCS_UNDER));
          this.fcs = this.fcs & ~FCS_WRITE_MASK | value & FCS_WRITE_MASK;
          this.checkInterrupts();
          break;
        case DIV:
          this.clockDiv = value;
          break;
        case INTE:
          this.intEnable = value & FIFO_INT;
          this.checkInterrupts();
          break;
        case INTF:
          this.intForce = value & FIFO_INT;
          this.checkInterrupts();
          break;
        default:
          super.writeUint32(offset, value);
      }
    }
  };

  // tools/programmable_simulator/node_modules/rp2040js/dist/esm/peripherals/busctrl.js
  var BUS_PRIORITY_ACK = 4;
  var PERFCTR0 = 8;
  var PERFSEL0 = 12;
  var PERFCTR1 = 16;
  var PERFSEL1 = 20;
  var PERFCTR2 = 24;
  var PERFSEL2 = 28;
  var PERFCTR3 = 32;
  var PERFSEL3 = 36;
  var RPBUSCTRL = class extends BasePeripheral {
    constructor(rp2040, name) {
      super(rp2040, name);
      this.voltageSelect = 0;
      this.perfCtr = [0, 0, 0, 0];
      this.perfSel = [31, 31, 31, 31];
    }
    readUint32(offset) {
      switch (offset) {
        case BUS_PRIORITY_ACK:
          return 1;
        case PERFCTR0:
          return this.perfCtr[0];
        case PERFSEL0:
          return this.perfSel[0];
        case PERFCTR1:
          return this.perfCtr[1];
        case PERFSEL1:
          return this.perfSel[1];
        case PERFCTR2:
          return this.perfCtr[2];
        case PERFSEL2:
          return this.perfSel[2];
        case PERFCTR3:
          return this.perfCtr[3];
        case PERFSEL3:
          return this.perfSel[3];
      }
      return super.readUint32(offset);
    }
    writeUint32(offset, value) {
      switch (offset) {
        case PERFCTR0:
          this.perfCtr[0] = 0;
          break;
        case PERFSEL0:
          this.perfSel[0] = value & 31;
          break;
        case PERFCTR1:
          this.perfCtr[1] = 0;
          break;
        case PERFSEL1:
          this.perfSel[1] = value & 31;
          break;
        case PERFCTR2:
          this.perfCtr[2] = 0;
          break;
        case PERFSEL2:
          this.perfSel[2] = value & 31;
          break;
        case PERFCTR3:
          this.perfCtr[3] = 0;
          break;
        case PERFSEL3:
          this.perfSel[3] = value & 31;
          break;
        default:
          super.writeUint32(offset, value);
      }
    }
  };

  // tools/programmable_simulator/node_modules/rp2040js/dist/esm/peripherals/clocks.js
  var CLK_GPOUT0_CTRL = 0;
  var CLK_GPOUT0_DIV = 4;
  var CLK_GPOUT0_SELECTED = 8;
  var CLK_GPOUT1_CTRL = 12;
  var CLK_GPOUT1_DIV = 16;
  var CLK_GPOUT1_SELECTED = 20;
  var CLK_GPOUT2_CTRL = 24;
  var CLK_GPOUT2_DIV = 28;
  var CLK_GPOUT2_SELECTED = 32;
  var CLK_GPOUT3_CTRL = 36;
  var CLK_GPOUT3_DIV = 40;
  var CLK_GPOUT3_SELECTED = 44;
  var CLK_REF_CTRL = 48;
  var CLK_REF_DIV = 52;
  var CLK_REF_SELECTED = 56;
  var CLK_SYS_CTRL = 60;
  var CLK_SYS_DIV = 64;
  var CLK_SYS_SELECTED = 68;
  var CLK_PERI_CTRL = 72;
  var CLK_PERI_DIV = 76;
  var CLK_PERI_SELECTED = 80;
  var CLK_USB_CTRL = 84;
  var CLK_USB_DIV = 88;
  var CLK_USB_SELECTED = 92;
  var CLK_ADC_CTRL = 96;
  var CLK_ADC_DIV = 100;
  var CLK_ADC_SELECTED = 104;
  var CLK_RTC_CTRL = 108;
  var CLK_RTC_DIV = 112;
  var CLK_RTC_SELECTED = 116;
  var CLK_SYS_RESUS_CTRL = 120;
  var CLK_SYS_RESUS_STATUS = 124;
  var CLK_REF_CTRL_SRC_MASK = 3;
  var CLK_REF_CTRL_SRC_ROSC = 0;
  var CLK_REF_CTRL_SRC_AUX = 1;
  var CLK_REF_CTRL_SRC_XOSC = 2;
  var CLK_REF_CTRL_AUXSRC_SHIFT = 5;
  var CLK_REF_CTRL_AUXSRC_MASK = 3;
  var CLK_REF_CTRL_AUXSRC_PLL_USB = 0;
  var CLK_REF_DIV_INT_BITS = 768;
  var CLK_SYS_CTRL_SRC_MASK = 1;
  var CLK_SYS_CTRL_SRC_REF = 0;
  var CLK_SYS_CTRL_AUXSRC_SHIFT = 5;
  var CLK_SYS_CTRL_AUXSRC_MASK = 7;
  var CLK_SYS_CTRL_AUXSRC_PLL_SYS = 0;
  var CLK_SYS_CTRL_AUXSRC_PLL_USB = 1;
  var CLK_SYS_CTRL_AUXSRC_ROSC = 2;
  var CLK_SYS_CTRL_AUXSRC_XOSC = 3;
  var CLK_PERI_CTRL_ENABLE = 1 << 11;
  var CLK_PERI_CTRL_KILL = 1 << 10;
  var CLK_PERI_CTRL_AUXSRC_SHIFT = 5;
  var CLK_PERI_CTRL_AUXSRC_MASK = 7;
  var CLK_PERI_CTRL_AUXSRC_CLK_SYS = 0;
  var CLK_PERI_CTRL_AUXSRC_PLL_SYS = 1;
  var CLK_PERI_CTRL_AUXSRC_PLL_USB = 2;
  var CLK_PERI_CTRL_AUXSRC_ROSC = 3;
  var CLK_PERI_CTRL_AUXSRC_XOSC = 4;
  var CLK_DIV_INT_SHIFT = 8;
  var CLK_DIV_FRAC_MASK = 255;
  function clockDivisor(div) {
    const int = div >>> CLK_DIV_INT_SHIFT;
    return int ? int + (div & CLK_DIV_FRAC_MASK) / 256 : 65536;
  }
  var RPClocks = class extends BasePeripheral {
    constructor(rp2040, name) {
      super(rp2040, name);
      this.gpout0Ctrl = 0;
      this.gpout0Div = 256;
      this.gpout1Ctrl = 0;
      this.gpout1Div = 256;
      this.gpout2Ctrl = 0;
      this.gpout2Div = 256;
      this.gpout3Ctrl = 0;
      this.gpout3Div = 256;
      this.refCtrl = 0;
      this.refDiv = 256;
      this.periCtrl = 0;
      this.periDiv = 256;
      this.usbCtrl = 0;
      this.usbDiv = 256;
      this.sysCtrl = 0;
      this.sysDiv = 256;
      this.adcCtrl = 0;
      this.adcDiv = 256;
      this.rtcCtrl = 0;
      this.rtcDiv = 256;
    }
    /** clk_ref frequency, in Hz. GPIN0/GPIN1 are not modelled and yield 0. */
    get refFreq() {
      return this.refSourceFreq / clockDivisor(this.refDiv & CLK_REF_DIV_INT_BITS);
    }
    /** clk_sys frequency, in Hz. GPIN0/GPIN1 are not modelled and yield 0. */
    get sysFreq() {
      return this.sysSourceFreq / clockDivisor(this.sysDiv);
    }
    /**
     * clk_peri frequency, in Hz. Feeds the UART and SPI baud rate generators. Returns 0 while
     * the clock generator is stopped, and for the GPIN0/GPIN1 sources we do not model.
     */
    get periFreq() {
      const { rp2040 } = this;
      if (!(this.periCtrl & CLK_PERI_CTRL_ENABLE) || this.periCtrl & CLK_PERI_CTRL_KILL) {
        return 0;
      }
      switch (this.periCtrl >>> CLK_PERI_CTRL_AUXSRC_SHIFT & CLK_PERI_CTRL_AUXSRC_MASK) {
        case CLK_PERI_CTRL_AUXSRC_CLK_SYS:
          return this.sysFreq;
        case CLK_PERI_CTRL_AUXSRC_PLL_SYS:
          return rp2040.pllSys.frequency;
        case CLK_PERI_CTRL_AUXSRC_PLL_USB:
          return rp2040.pllUsb.frequency;
        case CLK_PERI_CTRL_AUXSRC_ROSC:
          return rp2040.roscFreq;
        case CLK_PERI_CTRL_AUXSRC_XOSC:
          return rp2040.xoscFreq;
        default:
          return 0;
      }
    }
    get refSourceFreq() {
      const { rp2040 } = this;
      switch (this.refCtrl & CLK_REF_CTRL_SRC_MASK) {
        case CLK_REF_CTRL_SRC_ROSC:
          return rp2040.roscFreq;
        case CLK_REF_CTRL_SRC_XOSC:
          return rp2040.xoscFreq;
        case CLK_REF_CTRL_SRC_AUX: {
          const auxsrc = this.refCtrl >>> CLK_REF_CTRL_AUXSRC_SHIFT & CLK_REF_CTRL_AUXSRC_MASK;
          return auxsrc === CLK_REF_CTRL_AUXSRC_PLL_USB ? rp2040.pllUsb.frequency : 0;
        }
        default:
          return 0;
      }
    }
    get sysSourceFreq() {
      const { rp2040 } = this;
      if ((this.sysCtrl & CLK_SYS_CTRL_SRC_MASK) === CLK_SYS_CTRL_SRC_REF) {
        return this.refFreq;
      }
      switch (this.sysCtrl >>> CLK_SYS_CTRL_AUXSRC_SHIFT & CLK_SYS_CTRL_AUXSRC_MASK) {
        case CLK_SYS_CTRL_AUXSRC_PLL_SYS:
          return rp2040.pllSys.frequency;
        case CLK_SYS_CTRL_AUXSRC_PLL_USB:
          return rp2040.pllUsb.frequency;
        case CLK_SYS_CTRL_AUXSRC_ROSC:
          return rp2040.roscFreq;
        case CLK_SYS_CTRL_AUXSRC_XOSC:
          return rp2040.xoscFreq;
        default:
          return 0;
      }
    }
    readUint32(offset) {
      switch (offset) {
        case CLK_GPOUT0_CTRL:
          return this.gpout0Ctrl & 1252832;
        case CLK_GPOUT0_DIV:
          return this.gpout0Div;
        case CLK_GPOUT0_SELECTED:
          return 1;
        case CLK_GPOUT1_CTRL:
          return this.gpout1Ctrl & 1252832;
        case CLK_GPOUT1_DIV:
          return this.gpout1Div;
        case CLK_GPOUT1_SELECTED:
          return 1;
        case CLK_GPOUT2_CTRL:
          return this.gpout2Ctrl & 1252832;
        case CLK_GPOUT2_DIV:
          return this.gpout2Div;
        case CLK_GPOUT2_SELECTED:
          return 1;
        case CLK_GPOUT3_CTRL:
          return this.gpout3Ctrl & 1252832;
        case CLK_GPOUT3_DIV:
          return this.gpout3Div;
        case CLK_GPOUT3_SELECTED:
          return 1;
        case CLK_REF_CTRL:
          return this.refCtrl & 99;
        case CLK_REF_DIV:
          return this.refDiv & 48;
        // b8..9 = int divisor. no frac divisor present
        case CLK_REF_SELECTED:
          return 1 << (this.refCtrl & 3);
        case CLK_SYS_CTRL:
          return this.sysCtrl & 225;
        case CLK_SYS_DIV:
          return this.sysDiv;
        case CLK_SYS_SELECTED:
          return 1 << (this.sysCtrl & 1);
        case CLK_PERI_CTRL:
          return this.periCtrl & 3296;
        case CLK_PERI_DIV:
          return this.periDiv;
        case CLK_PERI_SELECTED:
          return 1;
        case CLK_USB_CTRL:
          return this.usbCtrl & 1248480;
        case CLK_USB_DIV:
          return this.usbDiv;
        case CLK_USB_SELECTED:
          return 1;
        case CLK_ADC_CTRL:
          return this.adcCtrl & 1248480;
        case CLK_ADC_DIV:
          return this.adcDiv & 48;
        case CLK_ADC_SELECTED:
          return 1;
        case CLK_RTC_CTRL:
          return this.rtcCtrl & 1248480;
        case CLK_RTC_DIV:
          return this.rtcDiv & 48;
        case CLK_RTC_SELECTED:
          return 1;
        case CLK_SYS_RESUS_CTRL:
          return 255;
        case CLK_SYS_RESUS_STATUS:
          return 0;
      }
      return super.readUint32(offset);
    }
    writeUint32(offset, value) {
      switch (offset) {
        case CLK_GPOUT0_CTRL:
          this.gpout0Ctrl = value;
          break;
        case CLK_GPOUT0_DIV:
          this.gpout0Div = value;
          break;
        case CLK_GPOUT1_CTRL:
          this.gpout1Ctrl = value;
          break;
        case CLK_GPOUT1_DIV:
          this.gpout1Div = value;
          break;
        case CLK_GPOUT2_CTRL:
          this.gpout2Ctrl = value;
          break;
        case CLK_GPOUT2_DIV:
          this.gpout2Div = value;
          break;
        case CLK_GPOUT3_CTRL:
          this.gpout3Ctrl = value;
          break;
        case CLK_GPOUT3_DIV:
          this.gpout3Div = value;
          break;
        case CLK_REF_CTRL:
          this.refCtrl = value;
          this.rp2040.updateClocks();
          break;
        case CLK_REF_DIV:
          this.refDiv = value;
          this.rp2040.updateClocks();
          break;
        case CLK_SYS_CTRL:
          this.sysCtrl = value;
          this.rp2040.updateClocks();
          break;
        case CLK_SYS_DIV:
          this.sysDiv = value;
          this.rp2040.updateClocks();
          break;
        case CLK_PERI_CTRL:
          this.periCtrl = value;
          this.rp2040.updateClocks();
          break;
        case CLK_PERI_DIV:
          this.periDiv = value;
          break;
        case CLK_USB_CTRL:
          this.usbCtrl = value;
          break;
        case CLK_USB_DIV:
          this.usbDiv = value;
          break;
        case CLK_ADC_CTRL:
          this.adcCtrl = value;
          break;
        case CLK_ADC_DIV:
          this.adcDiv = value;
          break;
        case CLK_RTC_CTRL:
          this.rtcCtrl = value;
          break;
        case CLK_RTC_DIV:
          this.rtcDiv = value;
          break;
        case CLK_SYS_RESUS_CTRL:
          return;
        /* clock resus not implemented */
        default:
          super.writeUint32(offset, value);
          break;
      }
    }
  };

  // tools/programmable_simulator/node_modules/rp2040js/dist/esm/peripherals/i2c.js
  var IC_CON = 0;
  var IC_TAR = 4;
  var IC_SAR = 8;
  var IC_DATA_CMD = 16;
  var IC_SS_SCL_HCNT = 20;
  var IC_SS_SCL_LCNT = 24;
  var IC_FS_SCL_HCNT = 28;
  var IC_FS_SCL_LCNT = 32;
  var IC_INTR_STAT = 44;
  var IC_INTR_MASK = 48;
  var IC_RAW_INTR_STAT = 52;
  var IC_RX_TL = 56;
  var IC_TX_TL = 60;
  var IC_CLR_INTR = 64;
  var IC_CLR_RX_UNDER = 68;
  var IC_CLR_RX_OVER = 72;
  var IC_CLR_TX_OVER = 76;
  var IC_CLR_RD_REQ = 80;
  var IC_CLR_TX_ABRT = 84;
  var IC_CLR_RX_DONE = 88;
  var IC_CLR_ACTIVITY = 92;
  var IC_CLR_STOP_DET = 96;
  var IC_CLR_START_DET = 100;
  var IC_CLR_GEN_CALL = 104;
  var IC_ENABLE = 108;
  var IC_STATUS = 112;
  var IC_TXFLR = 116;
  var IC_RXFLR = 120;
  var IC_SDA_HOLD = 124;
  var IC_TX_ABRT_SOURCE = 128;
  var IC_ENABLE_STATUS = 156;
  var IC_FS_SPKLEN = 160;
  var IC_COMP_PARAM_1 = 244;
  var IC_COMP_VERSION = 248;
  var IC_COMP_TYPE = 252;
  var STOP_DET_IF_MASTER_ACTIVE = 1 << 10;
  var RX_FIFO_FULL_HLD_CTRL = 1 << 9;
  var TX_EMPTY_CTRL = 1 << 8;
  var STOP_DET_IFADDRESSED = 1 << 7;
  var IC_SLAVE_DISABLE = 1 << 6;
  var IC_RESTART_EN = 1 << 5;
  var IC_10BITADDR_MASTER = 1 << 4;
  var IC_10BITADDR_SLAVE = 1 << 3;
  var SPEED_SHIFT = 1;
  var SPEED_MASK = 3;
  var MASTER_MODE = 1 << 0;
  var SPECIAL = 1 << 11;
  var GC_OR_START = 1 << 10;
  var SLV_ACTIVITY = 1 << 6;
  var MST_ACTIVITY = 1 << 5;
  var RFF = 1 << 4;
  var RFNE = 1 << 3;
  var TFE = 1 << 2;
  var TFNF = 1 << 1;
  var ACTIVITY = 1 << 0;
  var TX_CMD_BLOCK = 1 << 2;
  var ABORT = 1 << 1;
  var ENABLE = 1 << 0;
  var TX_FLUSH_CNT_MASK = 511;
  var TX_FLUSH_CNT_SHIFT = 23;
  var ABRT_USER_ABRT = 1 << 16;
  var ABRT_SLVRD_INT = 1 << 15;
  var ABRT_SLV_ARBLOST = 1 << 14;
  var ABRT_SLVFLUSH_TXFIFO = 1 << 13;
  var ARB_LOST = 1 << 12;
  var ABRT_MASTER_DIS = 1 << 11;
  var ABRT_10B_RD_NORSTRT = 1 << 10;
  var ABRT_SBYTE_NORSTRT = 1 << 9;
  var ABRT_HS_NORSTRT = 1 << 8;
  var ABRT_SBYTE_ACKDET = 1 << 7;
  var ABRT_HS_ACKDET = 1 << 6;
  var ABRT_GCALL_READ = 1 << 5;
  var ABRT_GCALL_NOACK = 1 << 4;
  var ABRT_TXDATA_NOACK = 1 << 3;
  var ABRT_10ADDR2_NOACK = 1 << 2;
  var ABRT_10ADDR1_NOACK = 1 << 1;
  var ABRT_7B_ADDR_NOACK = 1 << 0;
  var I2CMode;
  (function(I2CMode2) {
    I2CMode2[I2CMode2["Write"] = 0] = "Write";
    I2CMode2[I2CMode2["Read"] = 1] = "Read";
  })(I2CMode || (I2CMode = {}));
  var I2CSpeed;
  (function(I2CSpeed2) {
    I2CSpeed2[I2CSpeed2["Invalid"] = 0] = "Invalid";
    I2CSpeed2[I2CSpeed2["Standard"] = 1] = "Standard";
    I2CSpeed2[I2CSpeed2["FastMode"] = 2] = "FastMode";
    I2CSpeed2[I2CSpeed2["HighSpeedMode"] = 3] = "HighSpeedMode";
  })(I2CSpeed || (I2CSpeed = {}));
  var I2CState;
  (function(I2CState2) {
    I2CState2[I2CState2["Idle"] = 0] = "Idle";
    I2CState2[I2CState2["Start"] = 1] = "Start";
    I2CState2[I2CState2["Connect"] = 2] = "Connect";
    I2CState2[I2CState2["Connected"] = 3] = "Connected";
    I2CState2[I2CState2["Stop"] = 4] = "Stop";
  })(I2CState || (I2CState = {}));
  var R_RESTART_DET = 1 << 12;
  var R_GEN_CALL = 1 << 11;
  var R_START_DET = 1 << 10;
  var R_STOP_DET = 1 << 9;
  var R_ACTIVITY = 1 << 8;
  var R_RX_DONE = 1 << 7;
  var R_TX_ABRT = 1 << 6;
  var R_RD_REQ = 1 << 5;
  var R_TX_EMPTY = 1 << 4;
  var R_TX_OVER = 1 << 3;
  var R_RX_FULL = 1 << 2;
  var R_RX_OVER = 1 << 1;
  var R_RX_UNDER = 1 << 0;
  var FIRST_DATA_BYTE = 1 << 10;
  var RESTART = 1 << 10;
  var STOP = 1 << 9;
  var CMD = 1 << 8;
  var RPI2C = class extends BasePeripheral {
    get intStatus() {
      return this.intRaw & this.intEnable;
    }
    get speed() {
      return this.control >> SPEED_SHIFT & SPEED_MASK;
    }
    get sclLowPeriod() {
      return this.speed === I2CSpeed.Standard ? this.ssClockLowPeriod : this.fsClockLowPeriod;
    }
    get sclHighPeriod() {
      return this.speed === I2CSpeed.Standard ? this.ssClockHighPeriod : this.fsClockHighPeriod;
    }
    get masterBits() {
      return this.control & IC_10BITADDR_MASTER ? 10 : 7;
    }
    constructor(rp2040, name, irq) {
      super(rp2040, name);
      this.irq = irq;
      this.state = I2CState.Idle;
      this.busy = false;
      this.stop = false;
      this.pendingRestart = false;
      this.firstByte = false;
      this.rxFIFO = new FIFO(16);
      this.txFIFO = new FIFO(16);
      this.onStart = () => this.completeStart();
      this.onConnect = () => this.completeConnect(false);
      this.onWriteByte = () => this.completeWrite(false);
      this.onReadByte = () => this.completeRead(255);
      this.onStop = () => this.completeStop();
      this.enable = 0;
      this.rxThreshold = 0;
      this.txThreshold = 0;
      this.control = IC_SLAVE_DISABLE | IC_RESTART_EN | I2CSpeed.FastMode << SPEED_SHIFT | MASTER_MODE;
      this.ssClockHighPeriod = 40;
      this.ssClockLowPeriod = 47;
      this.fsClockHighPeriod = 6;
      this.fsClockLowPeriod = 13;
      this.targetAddress = 85;
      this.slaveAddress = 85;
      this.abortSource = 0;
      this.intRaw = 0;
      this.intEnable = 0;
      this.spikelen = 7;
    }
    checkInterrupts() {
      this.rp2040.setInterrupt(this.irq, !!this.intStatus);
    }
    clearInterrupts(mask) {
      if (this.intRaw & mask) {
        this.intRaw &= ~mask;
        this.checkInterrupts();
        return 1;
      } else {
        return 0;
      }
    }
    setInterrupts(mask) {
      if (!(this.intRaw & mask)) {
        this.intRaw |= mask;
        this.checkInterrupts();
      }
    }
    abort(reason) {
      this.abortSource &= ~TX_FLUSH_CNT_MASK;
      this.abortSource |= reason | this.txFIFO.itemCount << TX_FLUSH_CNT_SHIFT;
      this.txFIFO.reset();
      this.setInterrupts(R_TX_ABRT);
    }
    nextCommand() {
      const enabled = this.enable & ENABLE;
      const blocked = this.enable & TX_CMD_BLOCK;
      if (this.txFIFO.empty || this.busy || blocked || !enabled) {
        return;
      }
      this.busy = true;
      const restart = !!(this.txFIFO.peek() & RESTART) && !this.pendingRestart && !this.stop;
      if (this.state === I2CState.Idle || restart) {
        this.pendingRestart = restart;
        this.stop = false;
        this.state = I2CState.Start;
        this.onStart(restart);
        return;
      }
      this.pendingRestart = false;
      const cmd = this.txFIFO.pull();
      const readMode = !!(cmd & CMD);
      this.stop = !!(cmd & STOP);
      if (readMode) {
        this.onReadByte(!this.stop);
      } else {
        this.onWriteByte(cmd & 255);
      }
      if (this.txFIFO.itemCount <= this.txThreshold) {
        this.setInterrupts(R_TX_EMPTY);
      }
    }
    pushRX(value) {
      if (this.rxFIFO.full) {
        this.setInterrupts(R_RX_OVER);
        return;
      }
      this.rxFIFO.push(value);
      if (this.rxFIFO.itemCount > this.rxThreshold) {
        this.setInterrupts(R_RX_FULL);
      }
    }
    completeStart() {
      if (this.txFIFO.empty || this.state !== I2CState.Start || this.stop) {
        this.onStop();
        return;
      }
      const mode = this.txFIFO.peek() & CMD ? I2CMode.Read : I2CMode.Write;
      this.state = I2CState.Connect;
      this.setInterrupts(R_START_DET);
      const addressMask = this.masterBits === 10 ? 1023 : 255;
      this.onConnect(this.targetAddress & addressMask, mode);
    }
    completeConnect(ack, nackByte = 0) {
      if (!ack || this.stop) {
        if (!ack) {
          if (!this.targetAddress) {
            this.abort(ABRT_GCALL_NOACK);
          } else if (this.control & IC_10BITADDR_MASTER) {
            this.abort(nackByte === 0 ? ABRT_10ADDR1_NOACK : ABRT_10ADDR2_NOACK);
          } else {
            this.abort(ABRT_7B_ADDR_NOACK);
          }
        }
        this.state = I2CState.Stop;
        this.onStop();
        return;
      }
      this.state = I2CState.Connected;
      this.busy = false;
      this.firstByte = true;
      this.nextCommand();
    }
    completeWrite(ack) {
      if (!ack || this.stop) {
        if (!ack) {
          this.abort(ABRT_TXDATA_NOACK);
        }
        this.state = I2CState.Stop;
        this.onStop();
        return;
      }
      this.busy = false;
      this.nextCommand();
    }
    completeRead(value) {
      this.pushRX(value | (this.firstByte ? FIRST_DATA_BYTE : 0));
      if (this.stop) {
        this.state = I2CState.Stop;
        this.onStop();
        return;
      }
      this.firstByte = false;
      this.busy = false;
      this.nextCommand();
    }
    completeStop() {
      this.state = I2CState.Idle;
      this.setInterrupts(R_STOP_DET);
      this.busy = false;
      this.pendingRestart = false;
      if (this.enable & ABORT) {
        this.enable &= ~ABORT;
      } else {
        this.nextCommand();
      }
    }
    arbitrationLost() {
      this.state = I2CState.Idle;
      this.busy = false;
      this.abort(ARB_LOST);
    }
    readUint32(offset) {
      switch (offset) {
        case IC_CON:
          return this.control;
        case IC_TAR:
          return this.targetAddress;
        case IC_SAR:
          return this.slaveAddress;
        case IC_DATA_CMD:
          if (this.rxFIFO.empty) {
            this.setInterrupts(R_RX_UNDER);
            return 0;
          }
          this.clearInterrupts(R_RX_FULL);
          return this.rxFIFO.pull();
        case IC_SS_SCL_HCNT:
          return this.ssClockHighPeriod;
        case IC_SS_SCL_LCNT:
          return this.ssClockLowPeriod;
        case IC_FS_SCL_HCNT:
          return this.fsClockHighPeriod;
        case IC_FS_SCL_LCNT:
          return this.fsClockLowPeriod;
        case IC_INTR_STAT:
          return this.intStatus;
        case IC_INTR_MASK:
          return this.intEnable;
        case IC_RAW_INTR_STAT:
          return this.intRaw;
        case IC_RX_TL:
          return this.rxThreshold;
        case IC_TX_TL:
          return this.txThreshold;
        case IC_CLR_INTR:
          this.abortSource &= ABRT_SBYTE_NORSTRT;
          return this.clearInterrupts(R_RX_UNDER | R_RX_OVER | R_TX_OVER | R_RD_REQ | R_TX_ABRT | R_RX_DONE | R_ACTIVITY | R_STOP_DET | R_START_DET | R_GEN_CALL);
        case IC_CLR_RX_UNDER:
          return this.clearInterrupts(R_RX_UNDER);
        case IC_CLR_RX_OVER:
          return this.clearInterrupts(R_RX_OVER);
        case IC_CLR_TX_OVER:
          return this.clearInterrupts(R_TX_OVER);
        case IC_CLR_RD_REQ:
          return this.clearInterrupts(R_RD_REQ);
        case IC_CLR_TX_ABRT:
          this.abortSource &= ABRT_SBYTE_NORSTRT;
          return this.clearInterrupts(R_TX_ABRT);
        case IC_CLR_RX_DONE:
          return this.clearInterrupts(R_RX_DONE);
        case IC_CLR_ACTIVITY:
          return this.clearInterrupts(R_ACTIVITY);
        case IC_CLR_STOP_DET:
          return this.clearInterrupts(R_STOP_DET);
        case IC_CLR_START_DET:
          return this.clearInterrupts(R_START_DET);
        case IC_CLR_GEN_CALL:
          return this.clearInterrupts(R_GEN_CALL);
        case IC_ENABLE:
          return this.enable;
        case IC_STATUS:
          return (this.state !== I2CState.Idle ? MST_ACTIVITY | ACTIVITY : 0) | (this.rxFIFO.full ? RFF : 0) | (!this.rxFIFO.empty ? RFNE : 0) | (this.txFIFO.empty ? TFE : 0) | (!this.txFIFO.full ? TFNF : 0);
        case IC_TXFLR:
          return this.txFIFO.itemCount;
        case IC_RXFLR:
          return this.rxFIFO.itemCount;
        case IC_SDA_HOLD:
          return 1;
        case IC_TX_ABRT_SOURCE: {
          const value = this.abortSource;
          this.abortSource &= ABRT_SBYTE_NORSTRT;
          return value;
        }
        case IC_ENABLE_STATUS:
          return this.enable & 1;
        case IC_FS_SPKLEN:
          return this.spikelen & 255;
        case IC_COMP_PARAM_1:
          return 0;
        case IC_COMP_VERSION:
          return 842019114;
        case IC_COMP_TYPE:
          return 1146552640;
      }
      return super.readUint32(offset);
    }
    writeUint32(offset, value) {
      switch (offset) {
        case IC_CON:
          if ((value >> SPEED_SHIFT & SPEED_MASK) === I2CSpeed.Invalid) {
            value = value & ~(SPEED_MASK << SPEED_SHIFT) | I2CSpeed.HighSpeedMode << SPEED_SHIFT;
          }
          this.control = value;
          return;
        case IC_TAR:
          this.targetAddress = value & 1023;
          return;
        case IC_SAR:
          this.slaveAddress = value & 1023;
          return;
        case IC_DATA_CMD:
          if (this.txFIFO.full) {
            this.setInterrupts(R_TX_OVER);
          } else {
            this.txFIFO.push(value);
            this.clearInterrupts(R_TX_EMPTY);
            this.nextCommand();
          }
          return;
        case IC_SS_SCL_HCNT:
          this.ssClockHighPeriod = value & 65535;
          return;
        case IC_SS_SCL_LCNT:
          this.ssClockLowPeriod = value & 65535;
          return;
        case IC_FS_SCL_HCNT:
          this.fsClockHighPeriod = value & 65535;
          return;
        case IC_FS_SCL_LCNT:
          this.fsClockLowPeriod = value & 65535;
          return;
        case IC_SDA_HOLD:
          if (!(value & ENABLE)) {
            if (value != 1) {
              this.warn("Unimplemented write to IC_SDA_HOLD");
            }
          }
          return;
        case IC_RX_TL:
          this.rxThreshold = value & 255;
          if (this.rxThreshold > this.rxFIFO.size) {
            this.rxThreshold = this.rxFIFO.size;
          }
          return;
        case IC_TX_TL:
          this.txThreshold = value & 255;
          if (this.txThreshold > this.txFIFO.size) {
            this.txThreshold = this.txFIFO.size;
          }
          return;
        case IC_ENABLE:
          value |= this.enable & ABORT;
          if (value & ABORT) {
            if (this.state === I2CState.Idle) {
              value &= ~ABORT;
            } else {
              this.abort(ABRT_USER_ABRT);
              this.stop = true;
            }
          }
          if (!(value & ENABLE)) {
            this.txFIFO.reset();
            this.rxFIFO.reset();
          }
          this.enable = value;
          this.nextCommand();
          return;
        case IC_FS_SPKLEN:
          if (!(value & ENABLE) && value > 0) {
            this.spikelen = value;
          }
          return;
        default:
          super.writeUint32(offset, value);
      }
    }
  };

  // tools/programmable_simulator/node_modules/rp2040js/dist/esm/peripherals/io.js
  var GPIO_CTRL_LAST = 236;
  var INTR0 = 240;
  var PROC0_INTE0 = 256;
  var PROC0_INTF0 = 272;
  var PROC0_INTS0 = 288;
  var PROC0_INTS3 = 300;
  var RPIO = class extends BasePeripheral {
    constructor(rp2040, name) {
      super(rp2040, name);
    }
    getPinFromOffset(offset) {
      const gpioIndex = offset >>> 3;
      return {
        gpio: this.rp2040.gpio[gpioIndex],
        isCtrl: !!(offset & 4)
      };
    }
    readUint32(offset) {
      if (offset <= GPIO_CTRL_LAST) {
        const { gpio, isCtrl } = this.getPinFromOffset(offset);
        return isCtrl ? gpio.ctrl : gpio.status;
      }
      if (offset >= INTR0 && offset <= PROC0_INTS3) {
        const startIndex = (offset & 15) * 2;
        const register = offset & ~15;
        const { gpio } = this.rp2040;
        let result = 0;
        for (let index = 7; index >= 0; index--) {
          const pin = gpio[index + startIndex];
          if (!pin) {
            continue;
          }
          result <<= 4;
          switch (register) {
            case INTR0:
              result |= pin.irqStatus;
              break;
            case PROC0_INTE0:
              result |= pin.irqEnableMask;
              break;
            case PROC0_INTF0:
              result |= pin.irqForceMask;
              break;
            case PROC0_INTS0:
              result |= pin.irqStatus & pin.irqEnableMask | pin.irqForceMask;
              break;
          }
        }
        return result;
      }
      return super.readUint32(offset);
    }
    writeUint32(offset, value) {
      if (offset <= GPIO_CTRL_LAST) {
        const { gpio, isCtrl } = this.getPinFromOffset(offset);
        if (isCtrl) {
          gpio.ctrl = value;
          gpio.checkForUpdates();
        }
        return;
      }
      if (offset >= INTR0 && offset <= PROC0_INTS3) {
        const startIndex = (offset & 15) * 2;
        const register = offset & ~15;
        const { gpio } = this.rp2040;
        for (let index = 0; index < 8; index++) {
          const pin = gpio[index + startIndex];
          if (!pin) {
            continue;
          }
          const pinValue = value >> index * 4 & 15;
          const pinRawWriteValue = this.rawWriteValue >> index * 4 & 15;
          switch (register) {
            case INTR0:
              pin.updateIRQValue(pinRawWriteValue);
              break;
            case PROC0_INTE0:
              if (pin.irqEnableMask !== pinValue) {
                pin.irqEnableMask = pinValue;
                this.rp2040.updateIOInterrupt();
              }
              break;
            case PROC0_INTF0:
              if (pin.irqForceMask !== pinValue) {
                pin.irqForceMask = pinValue;
                this.rp2040.updateIOInterrupt();
              }
              break;
          }
        }
        return;
      }
      super.writeUint32(offset, value);
    }
  };

  // tools/programmable_simulator/node_modules/rp2040js/dist/esm/peripherals/pads.js
  var VOLTAGE_SELECT = 0;
  var GPIO_FIRST = 4;
  var GPIO_LAST = 120;
  var QSPI_FIRST = 4;
  var QSPI_LAST = 24;
  var RPPADS = class extends BasePeripheral {
    constructor(rp2040, name, bank) {
      super(rp2040, name);
      this.bank = bank;
      this.voltageSelect = 0;
      this.firstPadRegister = this.bank === "qspi" ? QSPI_FIRST : GPIO_FIRST;
      this.lastPadRegister = this.bank === "qspi" ? QSPI_LAST : GPIO_LAST;
    }
    getPinFromOffset(offset) {
      const gpioIndex = offset - this.firstPadRegister >>> 2;
      if (this.bank === "qspi") {
        return this.rp2040.qspi[gpioIndex];
      } else {
        return this.rp2040.gpio[gpioIndex];
      }
    }
    readUint32(offset) {
      if (offset >= this.firstPadRegister && offset <= this.lastPadRegister) {
        const gpio = this.getPinFromOffset(offset);
        return gpio.padValue;
      }
      switch (offset) {
        case VOLTAGE_SELECT:
          return this.voltageSelect;
      }
      return super.readUint32(offset);
    }
    writeUint32(offset, value) {
      if (offset >= this.firstPadRegister && offset <= this.lastPadRegister) {
        const gpio = this.getPinFromOffset(offset);
        const oldInputEnable = gpio.inputEnable;
        gpio.padValue = value;
        gpio.checkForUpdates();
        if (oldInputEnable !== gpio.inputEnable) {
          gpio.refreshInput();
        }
        return;
      }
      switch (offset) {
        case VOLTAGE_SELECT:
          this.voltageSelect = value & 1;
          break;
        default:
          super.writeUint32(offset, value);
      }
    }
  };

  // tools/programmable_simulator/node_modules/rp2040js/dist/esm/peripherals/pll.js
  var PLL_CS = 0;
  var PLL_PWR = 4;
  var PLL_FBDIV_INT = 8;
  var PLL_PRIM = 12;
  var PLL_CS_LOCK = 1 << 31;
  var PLL_CS_BYPASS = 1 << 8;
  var PLL_CS_REFDIV_MASK = 63;
  var PLL_FBDIV_INT_MASK = 4095;
  var PLL_PRIM_POSTDIV1_SHIFT = 16;
  var PLL_PRIM_POSTDIV2_SHIFT = 12;
  var PLL_PRIM_POSTDIV_MASK = 7;
  var RPPLL = class extends BasePeripheral {
    constructor() {
      super(...arguments);
      this.cs = 1;
      this.pwr = 45;
      this.fbdivInt = 0;
      this.prim = 487424;
    }
    get refdiv() {
      return this.cs & PLL_CS_REFDIV_MASK;
    }
    get fbdiv() {
      return this.fbdivInt & PLL_FBDIV_INT_MASK;
    }
    get postdiv1() {
      return this.prim >>> PLL_PRIM_POSTDIV1_SHIFT & PLL_PRIM_POSTDIV_MASK;
    }
    get postdiv2() {
      return this.prim >>> PLL_PRIM_POSTDIV2_SHIFT & PLL_PRIM_POSTDIV_MASK;
    }
    /** PLL output frequency, in Hz, derived from the current register values. */
    get frequency() {
      const refFreq = this.rp2040.xoscFreq / (this.refdiv || 1);
      if (this.cs & PLL_CS_BYPASS) {
        return refFreq;
      }
      const postdiv = (this.postdiv1 || 1) * (this.postdiv2 || 1);
      return refFreq * this.fbdiv / postdiv;
    }
    readUint32(offset) {
      switch (offset) {
        case PLL_CS:
          return this.cs | PLL_CS_LOCK;
        case PLL_PWR:
          return this.pwr;
        case PLL_FBDIV_INT:
          return this.fbdivInt;
        case PLL_PRIM:
          return this.prim;
        default:
          return super.readUint32(offset);
      }
    }
    writeUint32(offset, value) {
      switch (offset) {
        case PLL_CS:
          this.cs = value;
          break;
        case PLL_PWR:
          this.pwr = value;
          break;
        case PLL_FBDIV_INT:
          this.fbdivInt = value;
          break;
        case PLL_PRIM:
          this.prim = value;
          break;
        default:
          super.writeUint32(offset, value);
          return;
      }
      this.rp2040.updateClocks();
    }
  };

  // tools/programmable_simulator/node_modules/rp2040js/dist/esm/utils/timer32.js
  var TimerMode;
  (function(TimerMode2) {
    TimerMode2[TimerMode2["Increment"] = 0] = "Increment";
    TimerMode2[TimerMode2["Decrement"] = 1] = "Decrement";
    TimerMode2[TimerMode2["ZigZag"] = 2] = "ZigZag";
  })(TimerMode || (TimerMode = {}));
  var Timer32 = class {
    constructor(clock, baseFreq) {
      this.clock = clock;
      this.baseFreq = baseFreq;
      this.baseValue = 0;
      this.baseNanos = 0;
      this.topValue = 4294967295;
      this.prescalerValue = 1;
      this.timerMode = TimerMode.Increment;
      this.enabled = true;
      this.listeners = [];
    }
    reset() {
      this.baseNanos = this.clock.nanos;
      this.baseValue = 0;
      this.updated();
    }
    set(value, zigZagDown = false) {
      this.baseValue = zigZagDown ? this.topValue * 2 - value : value;
      this.baseNanos = this.clock.nanos;
      this.updated();
    }
    /**
     * Advances the counter by the given amount. Note that this will
     * decrease the counter if the timer is running in Decrement mode.
     *
     * @param delta The value to add to the counter. Can be negative.
     */
    advance(delta) {
      this.baseValue += delta;
      if (this.topValue !== 4294967295) {
        const topModulo = this.timerMode === TimerMode.ZigZag ? this.topValue * 2 : this.topValue + 1;
        this.baseValue = (this.baseValue % topModulo + topModulo) % topModulo;
      }
      this.updated();
    }
    get rawCounter() {
      const { baseFreq, prescalerValue, baseNanos, baseValue, enabled, timerMode } = this;
      if (!baseFreq || !prescalerValue || !enabled) {
        return this.baseValue;
      }
      const zigzag = timerMode == TimerMode.ZigZag;
      const ticks = (this.clock.nanos - baseNanos) / 1e9 * (baseFreq / prescalerValue);
      const topModulo = zigzag ? this.topValue * 2 : this.topValue + 1;
      const delta = timerMode == TimerMode.Decrement ? topModulo - ticks % topModulo : ticks;
      let currentValue = Math.round(baseValue + delta);
      if (this.topValue != 4294967295) {
        currentValue %= topModulo;
      }
      return currentValue;
    }
    get counter() {
      let currentValue = this.rawCounter;
      if (this.timerMode == TimerMode.ZigZag && currentValue > this.topValue) {
        currentValue = this.topValue * 2 - currentValue;
      }
      return currentValue >>> 0;
    }
    get top() {
      return this.topValue;
    }
    set top(value) {
      const { counter } = this;
      this.topValue = value;
      this.set(counter <= this.topValue ? counter : 0);
    }
    get frequency() {
      return this.baseFreq;
    }
    set frequency(value) {
      this.baseValue = this.counter;
      this.baseNanos = this.clock.nanos;
      this.baseFreq = value;
      this.updated();
    }
    get prescaler() {
      return this.prescalerValue;
    }
    set prescaler(value) {
      this.baseValue = this.counter;
      this.baseNanos = this.clock.nanos;
      this.enabled = this.prescalerValue !== 0;
      this.prescalerValue = value;
      this.updated();
    }
    toNanos(cycles) {
      const { baseFreq, prescalerValue } = this;
      return cycles * 1e9 / (baseFreq / prescalerValue);
    }
    get enable() {
      return this.enabled;
    }
    set enable(value) {
      if (value !== this.enabled) {
        if (value) {
          this.baseNanos = this.clock.nanos;
        } else {
          this.baseValue = this.counter;
        }
        this.enabled = value;
        this.updated();
      }
    }
    get mode() {
      return this.timerMode;
    }
    set mode(value) {
      if (this.timerMode !== value) {
        const { counter } = this;
        this.timerMode = value;
        this.set(counter);
      }
    }
    updated() {
      for (const listener of this.listeners) {
        listener();
      }
    }
  };
  var Timer32PeriodicAlarm = class {
    constructor(timer2, callback) {
      this.timer = timer2;
      this.callback = callback;
      this.targetValue = 0;
      this.enabled = false;
      this.handleAlarm = () => {
        this.callback();
        if (this.enabled && this.timer.enable) {
          this.schedule();
        }
      };
      this.update = () => {
        this.cancel();
        if (this.enabled && this.timer.enable) {
          this.schedule();
        }
      };
      this.clockAlarm = this.timer.clock.createAlarm(this.handleAlarm);
      timer2.listeners.push(this.update);
    }
    get enable() {
      return this.enabled;
    }
    set enable(value) {
      if (value !== this.enabled) {
        this.enabled = value;
        if (value && this.timer.enable) {
          this.schedule();
        } else {
          this.cancel();
        }
      }
    }
    get target() {
      return this.targetValue;
    }
    set target(value) {
      if (value === this.targetValue) {
        return;
      }
      this.targetValue = value;
      if (this.enabled && this.timer.enable) {
        this.cancel();
        this.schedule();
      }
    }
    schedule() {
      const { timer: timer2, targetValue } = this;
      const { top, mode, rawCounter } = timer2;
      let cycleDelta = targetValue - rawCounter;
      if (mode === TimerMode.ZigZag && cycleDelta < 0) {
        if (cycleDelta < -top) {
          cycleDelta += 2 * top;
        } else {
          cycleDelta = top * 2 - targetValue - rawCounter;
        }
      }
      if (top != 4294967295) {
        if (cycleDelta <= 0) {
          cycleDelta += top + 1;
        }
        if (targetValue > top) {
          return;
        }
      }
      if (mode === TimerMode.Decrement) {
        cycleDelta = top + 1 - cycleDelta;
      }
      const cyclesToAlarm = cycleDelta >>> 0;
      const nanosToAlarm = timer2.toNanos(cyclesToAlarm);
      this.clockAlarm.schedule(nanosToAlarm);
    }
    cancel() {
      this.clockAlarm.cancel();
    }
  };

  // tools/programmable_simulator/node_modules/rp2040js/dist/esm/peripherals/ppb.js
  var CPUID = 3328;
  var ICSR = 3332;
  var VTOR = 3336;
  var SHPR2 = 3356;
  var SHPR3 = 3360;
  var SYST_CSR = 16;
  var SYST_RVR = 20;
  var SYST_CVR = 24;
  var SYST_CALIB = 28;
  var NVIC_ISER = 256;
  var NVIC_ICER = 384;
  var NVIC_ISPR = 512;
  var NVIC_ICPR = 640;
  var NVIC_IPR0 = 1024;
  var NVIC_IPR1 = 1028;
  var NVIC_IPR2 = 1032;
  var NVIC_IPR3 = 1036;
  var NVIC_IPR4 = 1040;
  var NVIC_IPR5 = 1044;
  var NVIC_IPR6 = 1048;
  var NVIC_IPR7 = 1052;
  var NMIPENDSET = 1 << 31;
  var PENDSVSET = 1 << 28;
  var PENDSVCLR = 1 << 27;
  var PENDSTSET = 1 << 26;
  var PENDSTCLR = 1 << 25;
  var ISRPREEMPT = 1 << 23;
  var ISRPENDING = 1 << 22;
  var VECTPENDING_SHIFT = 12;
  var VECTACTIVE_MASK = 511;
  var VECTACTIVE_SHIFT = 0;
  var RPPPB = class extends BasePeripheral {
    constructor(rp2040, name) {
      super(rp2040, name);
      this.systickCountFlag = false;
      this.systickClkSource = false;
      this.systickIntEnable = false;
      this.systickReload = 0;
      this.systickTimer = new Timer32(this.rp2040.clock, this.rp2040.clkSys);
      this.systickAlarm = new Timer32PeriodicAlarm(this.systickTimer, () => {
        this.systickCountFlag = true;
        if (this.systickIntEnable) {
          this.rp2040.core.pendingSystick = true;
          this.rp2040.core.interruptsUpdated = true;
        }
        this.systickTimer.set(this.systickReload);
      });
      this.systickTimer.top = 16777215;
      this.systickTimer.mode = TimerMode.Decrement;
      this.systickAlarm.target = 0;
      this.systickAlarm.enable = true;
      this.reset();
    }
    reset() {
      this.writeUint32(SYST_CSR, 0);
      this.writeUint32(SYST_RVR, 16777215);
      this.systickTimer.set(16777215);
    }
    readUint32(offset) {
      const { rp2040 } = this;
      const { core } = rp2040;
      switch (offset) {
        case CPUID:
          return 1091356161;
        /* Verified against actual hardware */
        case ICSR: {
          const pendingInterrupts = core.pendingInterrupts || core.pendingPendSV || core.pendingSystick || core.pendingSVCall;
          const vectPending = core.vectPending;
          return (core.pendingNMI ? NMIPENDSET : 0) | (core.pendingPendSV ? PENDSVSET : 0) | (core.pendingSystick ? PENDSTSET : 0) | (pendingInterrupts ? ISRPENDING : 0) | vectPending << VECTPENDING_SHIFT | (core.IPSR & VECTACTIVE_MASK) << VECTACTIVE_SHIFT;
        }
        case VTOR:
          return core.VTOR;
        /* NVIC */
        case NVIC_ISPR:
          return core.pendingInterrupts >>> 0;
        case NVIC_ICPR:
          return core.pendingInterrupts >>> 0;
        case NVIC_ISER:
          return core.enabledInterrupts >>> 0;
        case NVIC_ICER:
          return core.enabledInterrupts >>> 0;
        case NVIC_IPR0:
        case NVIC_IPR1:
        case NVIC_IPR2:
        case NVIC_IPR3:
        case NVIC_IPR4:
        case NVIC_IPR5:
        case NVIC_IPR6:
        case NVIC_IPR7: {
          const regIndex = offset - NVIC_IPR0 >> 2;
          let result = 0;
          for (let byteIndex = 0; byteIndex < 4; byteIndex++) {
            const interruptNumber = regIndex * 4 + byteIndex;
            for (let priority = 0; priority < core.interruptPriorities.length; priority++) {
              if (core.interruptPriorities[priority] & 1 << interruptNumber) {
                result |= priority << 8 * byteIndex + 6;
              }
            }
          }
          return result;
        }
        case SHPR2:
          return core.SHPR2;
        case SHPR3:
          return core.SHPR3;
        /* SysTick */
        case SYST_CSR: {
          const countFlagValue = this.systickCountFlag ? 1 << 16 : 0;
          const clkSourceValue = this.systickClkSource ? 1 << 2 : 0;
          const tickIntValue = this.systickIntEnable ? 1 << 1 : 0;
          const enableFlagValue = this.systickTimer.enable ? 1 << 0 : 0;
          this.systickCountFlag = false;
          return countFlagValue | clkSourceValue | tickIntValue | enableFlagValue;
        }
        case SYST_CVR:
          return this.systickTimer.counter;
        case SYST_RVR:
          return this.systickReload;
        case SYST_CALIB:
          return 9999;
      }
      return super.readUint32(offset);
    }
    writeUint32(offset, value) {
      const { rp2040 } = this;
      const { core } = rp2040;
      const hardwareInterruptMask = (1 << MAX_HARDWARE_IRQ) - 1;
      switch (offset) {
        case ICSR:
          if (value & NMIPENDSET) {
            core.pendingNMI = true;
            core.interruptsUpdated = true;
          }
          if (value & PENDSVSET) {
            core.pendingPendSV = true;
            core.interruptsUpdated = true;
          }
          if (value & PENDSVCLR) {
            core.pendingPendSV = false;
          }
          if (value & PENDSTSET) {
            core.pendingSystick = true;
            core.interruptsUpdated = true;
          }
          if (value & PENDSTCLR) {
            core.pendingSystick = false;
          }
          return;
        case VTOR:
          core.VTOR = value;
          return;
        /* NVIC */
        case NVIC_ISPR:
          core.pendingInterrupts |= value;
          core.interruptsUpdated = true;
          return;
        case NVIC_ICPR:
          core.pendingInterrupts &= ~value | hardwareInterruptMask;
          return;
        case NVIC_ISER:
          core.enabledInterrupts |= value;
          core.interruptsUpdated = true;
          return;
        case NVIC_ICER:
          core.enabledInterrupts &= ~value;
          return;
        case NVIC_IPR0:
        case NVIC_IPR1:
        case NVIC_IPR2:
        case NVIC_IPR3:
        case NVIC_IPR4:
        case NVIC_IPR5:
        case NVIC_IPR6:
        case NVIC_IPR7: {
          const regIndex = offset - NVIC_IPR0 >> 2;
          for (let byteIndex = 0; byteIndex < 4; byteIndex++) {
            const interruptNumber = regIndex * 4 + byteIndex;
            const newPriority = value >> 8 * byteIndex + 6 & 3;
            for (let priority = 0; priority < core.interruptPriorities.length; priority++) {
              core.interruptPriorities[priority] &= ~(1 << interruptNumber);
            }
            core.interruptPriorities[newPriority] |= 1 << interruptNumber;
          }
          core.interruptsUpdated = true;
          return;
        }
        case SHPR2:
          core.SHPR2 = value;
          return;
        case SHPR3:
          core.SHPR3 = value;
          return;
        // SysTick
        case SYST_CSR:
          this.systickClkSource = value & 1 << 2 ? true : false;
          this.systickIntEnable = value & 1 << 1 ? true : false;
          this.systickTimer.enable = value & 1 << 0 ? true : false;
          return;
        case SYST_CVR:
          this.systickTimer.set(0);
          return;
        case SYST_RVR:
          this.systickReload = value;
          return;
        default:
          super.writeUint32(offset, value);
      }
    }
  };

  // tools/programmable_simulator/node_modules/rp2040js/dist/esm/peripherals/psm.js
  var FRCE_ON = 0;
  var FRCE_OFF = 4;
  var WDSEL = 8;
  var DONE = 12;
  var PSM_BITS_MASK = 131071;
  var RPPSM = class extends BasePeripheral {
    constructor() {
      super(...arguments);
      this.frceOn = 0;
      this.frceOff = 0;
      this.wdsel = 0;
    }
    readUint32(offset) {
      switch (offset) {
        case FRCE_ON:
          return this.frceOn;
        case FRCE_OFF:
          return this.frceOff;
        case WDSEL:
          return this.wdsel;
        case DONE:
          return PSM_BITS_MASK & ~this.frceOff | this.frceOn & this.frceOff;
      }
      return super.readUint32(offset);
    }
    writeUint32(offset, value) {
      switch (offset) {
        case FRCE_ON:
          this.frceOn = value & PSM_BITS_MASK;
          break;
        case FRCE_OFF:
          this.frceOff = value & PSM_BITS_MASK;
          break;
        case WDSEL:
          this.wdsel = value & PSM_BITS_MASK;
          break;
        default:
          super.writeUint32(offset, value);
          break;
      }
    }
  };

  // tools/programmable_simulator/node_modules/rp2040js/dist/esm/peripherals/pwm.js
  var CHn_CSR = 0;
  var CHn_DIV = 4;
  var CHn_CTR = 8;
  var CHn_CC = 12;
  var CHn_TOP = 16;
  var EN2 = 160;
  var INTR4 = 164;
  var INTE2 = 168;
  var INTF2 = 172;
  var INTS2 = 176;
  var INT_MASK = 255;
  var CSR_PH_ADV = 1 << 7;
  var CSR_PH_RET = 1 << 6;
  var CSR_DIVMODE_SHIFT = 4;
  var CSR_DIVMODE_MASK = 3;
  var CSR_B_INV = 1 << 3;
  var CSR_A_INV = 1 << 2;
  var CSR_PH_CORRECT = 1 << 1;
  var CSR_EN = 1 << 0;
  var PWMDivMode;
  (function(PWMDivMode2) {
    PWMDivMode2[PWMDivMode2["FreeRunning"] = 0] = "FreeRunning";
    PWMDivMode2[PWMDivMode2["BGated"] = 1] = "BGated";
    PWMDivMode2[PWMDivMode2["BRisingEdge"] = 2] = "BRisingEdge";
    PWMDivMode2[PWMDivMode2["BFallingEdge"] = 3] = "BFallingEdge";
  })(PWMDivMode || (PWMDivMode = {}));
  var PWMChannel = class {
    constructor(pwm, clock, index) {
      this.pwm = pwm;
      this.clock = clock;
      this.index = index;
      this.timer = new Timer32(this.clock, this.pwm.clockFreq);
      this.alarmA = new Timer32PeriodicAlarm(this.timer, () => {
        this.setA(false);
      });
      this.alarmB = new Timer32PeriodicAlarm(this.timer, () => {
        this.setB(false);
      });
      this.alarmBottom = new Timer32PeriodicAlarm(this.timer, () => this.wrap());
      this.csr = 0;
      this.div = 0;
      this.cc = 0;
      this.top = 0;
      this.lastBValue = false;
      this.countingUp = true;
      this.ccUpdated = false;
      this.topUpdated = false;
      this.tickCounter = 0;
      this.divMode = PWMDivMode.FreeRunning;
      this.pinA1 = this.index * 2;
      this.pinB1 = this.index * 2 + 1;
      this.pinA2 = this.index < 7 ? 16 + this.index * 2 : -1;
      this.pinB2 = this.index < 7 ? 16 + this.index * 2 + 1 : -1;
      this.alarmA.enable = true;
      this.alarmB.enable = true;
      this.alarmBottom.enable = true;
    }
    readRegister(offset) {
      switch (offset) {
        case CHn_CSR:
          return this.csr;
        case CHn_DIV:
          return this.div;
        case CHn_CTR:
          return this.timer.counter;
        case CHn_CC:
          return this.cc;
        case CHn_TOP:
          return this.top;
      }
      return 0;
    }
    writeRegister(offset, value) {
      switch (offset) {
        case CHn_CSR:
          if (value & CSR_EN && !(this.csr & CSR_EN)) {
            this.updateDoubleBuffered();
          }
          this.csr = value & ~(CSR_PH_ADV | CSR_PH_RET);
          if (value & CSR_EN) {
            if (value & CSR_PH_ADV) {
              this.timer.advance(1);
            }
            if (value & CSR_PH_RET) {
              this.timer.advance(-1);
            }
          }
          this.divMode = this.csr >> CSR_DIVMODE_SHIFT & CSR_DIVMODE_MASK;
          this.setBDirection(this.divMode === PWMDivMode.FreeRunning);
          this.updateEnable();
          this.lastBValue = this.gpioBValue;
          this.timer.mode = value & CSR_PH_CORRECT ? TimerMode.ZigZag : TimerMode.Increment;
          break;
        case CHn_DIV: {
          this.div = value & 1048575;
          const intValue = value >> 4 & 255;
          const fracValue = value & 15;
          this.timer.prescaler = (intValue ? intValue : 256) + fracValue / 16;
          break;
        }
        case CHn_CTR:
          this.timer.set(value & 65535);
          break;
        case CHn_CC:
          this.cc = value;
          this.ccUpdated = true;
          break;
        case CHn_TOP:
          this.top = value & 65535;
          this.topUpdated = true;
          break;
      }
    }
    reset() {
      this.writeRegister(CHn_CSR, 0);
      this.writeRegister(CHn_DIV, 1 << 4);
      this.writeRegister(CHn_CTR, 0);
      this.writeRegister(CHn_CC, 0);
      this.writeRegister(CHn_TOP, 65535);
      this.countingUp = true;
      this.timer.enable = false;
      this.timer.reset();
    }
    updateDoubleBuffered() {
      if (this.ccUpdated) {
        this.alarmB.target = this.cc >>> 16;
        this.alarmA.target = this.cc & 65535;
        this.ccUpdated = false;
      }
      if (this.topUpdated) {
        this.timer.top = this.top;
        this.topUpdated = false;
      }
    }
    wrap() {
      this.pwm.channelInterrupt(this.index);
      this.updateDoubleBuffered();
      if (!(this.csr & CSR_PH_CORRECT)) {
        this.setA(this.alarmA.target > 0);
        this.setB(this.alarmB.target > 0);
      }
    }
    setA(value) {
      if (this.csr & CSR_A_INV) {
        value = !value;
      }
      this.pwm.gpioSet(this.pinA1, value);
      if (this.pinA2 >= 0) {
        this.pwm.gpioSet(this.pinA2, value);
      }
    }
    setB(value) {
      if (this.csr & CSR_B_INV) {
        value = !value;
      }
      this.pwm.gpioSet(this.pinB1, value);
      if (this.pinB2 >= 0) {
        this.pwm.gpioSet(this.pinB2, value);
      }
    }
    get gpioBValue() {
      return this.pwm.gpioRead(this.pinB1) || (this.pinB2 > 0 ? this.pwm.gpioRead(this.pinB2) : false);
    }
    setBDirection(value) {
      this.pwm.gpioSetDir(this.pinB1, value);
      if (this.pinB2 >= 0) {
        this.pwm.gpioSetDir(this.pinB2, value);
      }
    }
    gpioBChanged() {
      const value = this.gpioBValue;
      if (value === this.lastBValue) {
        return;
      }
      this.lastBValue = value;
      switch (this.divMode) {
        case PWMDivMode.BGated:
          this.updateEnable();
          break;
        case PWMDivMode.BRisingEdge:
          if (value) {
            this.tickCounter++;
          }
          break;
        case PWMDivMode.BFallingEdge:
          if (!value) {
            this.tickCounter++;
          }
          break;
      }
      if (this.tickCounter >= this.timer.prescaler) {
        this.timer.advance(1);
        this.tickCounter -= this.timer.prescaler;
      }
    }
    updateEnable() {
      const { csr, divMode } = this;
      const enable = !!(csr & CSR_EN);
      this.timer.enable = enable && (divMode === PWMDivMode.FreeRunning || divMode === PWMDivMode.BGated && this.gpioBValue);
    }
    set en(value) {
      if (value && !(this.csr & CSR_EN)) {
        this.updateDoubleBuffered();
      }
      if (value) {
        this.csr |= CSR_EN;
      } else {
        this.csr &= ~CSR_EN;
      }
      this.updateEnable();
    }
  };
  var RPPWM = class extends BasePeripheral {
    constructor() {
      super(...arguments);
      this.channels = [
        new PWMChannel(this, this.rp2040.clock, 0),
        new PWMChannel(this, this.rp2040.clock, 1),
        new PWMChannel(this, this.rp2040.clock, 2),
        new PWMChannel(this, this.rp2040.clock, 3),
        new PWMChannel(this, this.rp2040.clock, 4),
        new PWMChannel(this, this.rp2040.clock, 5),
        new PWMChannel(this, this.rp2040.clock, 6),
        new PWMChannel(this, this.rp2040.clock, 7)
      ];
      this.intRaw = 0;
      this.intEnable = 0;
      this.intForce = 0;
      this.gpioValue = 0;
      this.gpioDirection = 0;
    }
    get intStatus() {
      return this.intRaw & this.intEnable | this.intForce;
    }
    readUint32(offset) {
      if (offset < EN2) {
        const channel = Math.floor(offset / 20);
        return this.channels[channel].readRegister(offset % 20);
      }
      switch (offset) {
        case EN2:
          return this.channels[7].en << 7 | this.channels[6].en << 6 | this.channels[5].en << 5 | this.channels[4].en << 4 | this.channels[3].en << 3 | this.channels[2].en << 2 | this.channels[1].en << 1 | this.channels[0].en << 0;
        case INTR4:
          return this.intRaw;
        case INTE2:
          return this.intEnable;
        case INTF2:
          return this.intForce;
        case INTS2:
          return this.intStatus;
      }
      return super.readUint32(offset);
    }
    writeUint32(offset, value) {
      if (offset < EN2) {
        const channel = Math.floor(offset / 20);
        return this.channels[channel].writeRegister(offset % 20, value);
      }
      switch (offset) {
        case EN2:
          this.channels[7].en = value & 1 << 7;
          this.channels[6].en = value & 1 << 6;
          this.channels[5].en = value & 1 << 5;
          this.channels[4].en = value & 1 << 4;
          this.channels[3].en = value & 1 << 3;
          this.channels[2].en = value & 1 << 2;
          this.channels[1].en = value & 1 << 1;
          this.channels[0].en = value & 1 << 0;
          break;
        case INTR4:
          this.intRaw &= ~(value & INT_MASK);
          this.checkInterrupts();
          break;
        case INTE2:
          this.intEnable = value & INT_MASK;
          this.checkInterrupts();
          break;
        case INTF2:
          this.intForce = value & INT_MASK;
          this.checkInterrupts();
          break;
        default:
          super.writeUint32(offset, value);
      }
    }
    get clockFreq() {
      return this.rp2040.clkSys;
    }
    channelInterrupt(index) {
      this.intRaw |= 1 << index;
      this.checkInterrupts();
      this.rp2040.dma.setDREQ(DREQChannel.DREQ_PWM_WRAP0 + index);
    }
    checkInterrupts() {
      this.rp2040.setInterrupt(IRQ.PWM_WRAP, !!this.intStatus);
    }
    gpioSet(index, value) {
      const bit = 1 << index;
      const newGpioValue = value ? this.gpioValue | bit : this.gpioValue & ~bit;
      if (this.gpioValue != newGpioValue) {
        this.gpioValue = newGpioValue;
        this.rp2040.gpio[index].checkForUpdates();
      }
    }
    gpioSetDir(index, output) {
      const bit = 1 << index;
      const newGpioDirection = output ? this.gpioDirection | bit : this.gpioDirection & ~bit;
      if (this.gpioDirection != newGpioDirection) {
        this.gpioDirection = newGpioDirection;
        this.rp2040.gpio[index].checkForUpdates();
      }
    }
    gpioRead(index) {
      return this.rp2040.gpio[index].inputValue;
    }
    gpioOnInput(index) {
      if (this.gpioDirection && 1 << index) {
        return;
      }
      for (const channel of this.channels) {
        if (channel.pinB1 === index || channel.pinB2 === index) {
          channel.gpioBChanged();
        }
      }
    }
    reset() {
      this.gpioDirection = 4294967295;
      for (const channel of this.channels) {
        channel.reset();
      }
    }
  };

  // tools/programmable_simulator/node_modules/rp2040js/dist/esm/peripherals/reset.js
  var RESET = 0;
  var WDSEL2 = 4;
  var RESET_DONE = 8;
  var RPReset = class extends BasePeripheral {
    constructor() {
      super(...arguments);
      this.reset = 0;
      this.wdsel = 0;
      this.reset_done = 33554431;
    }
    readUint32(offset) {
      switch (offset) {
        case RESET:
          return this.reset;
        case WDSEL2:
          return this.wdsel;
        case RESET_DONE:
          return this.reset_done;
      }
      return super.readUint32(offset);
    }
    writeUint32(offset, value) {
      switch (offset) {
        case RESET:
          this.reset = value & 33554431;
          break;
        case WDSEL2:
          this.wdsel = value & 33554431;
          break;
        default:
          super.writeUint32(offset, value);
          break;
      }
    }
  };

  // tools/programmable_simulator/node_modules/rp2040js/dist/esm/peripherals/rtc.js
  var RTC_SETUP0 = 4;
  var RTC_SETUP1 = 8;
  var RTC_CTRL = 12;
  var IRQ_SETUP_0 = 16;
  var RTC_RTC1 = 24;
  var RTC_RTC0 = 28;
  var RTC_ENABLE_BITS = 1;
  var RTC_ACTIVE_BITS = 2;
  var RTC_LOAD_BITS = 16;
  var SETUP_0_YEAR_SHIFT = 12;
  var SETUP_0_YEAR_MASK = 4095;
  var SETUP_0_MONTH_SHIFT = 8;
  var SETUP_0_MONTH_MASK = 15;
  var SETUP_0_DAY_SHIFT = 0;
  var SETUP_0_DAY_MASK = 31;
  var SETUP_1_HOUR_SHIFT = 16;
  var SETUP_1_HOUR_MASK = 31;
  var SETUP_1_MIN_SHIFT = 8;
  var SETUP_1_MIN_MASK = 63;
  var SETUP_1_SEC_SHIFT = 0;
  var SETUP_1_SEC_MASK = 63;
  var RTC_0_YEAR_SHIFT = 12;
  var RTC_0_YEAR_MASK = 4095;
  var RTC_0_MONTH_SHIFT = 8;
  var RTC_0_MONTH_MASK = 15;
  var RTC_0_DAY_SHIFT = 0;
  var RTC_0_DAY_MASK = 31;
  var RTC_1_DOTW_SHIFT = 24;
  var RTC_1_DOTW_MASK = 7;
  var RTC_1_HOUR_SHIFT = 16;
  var RTC_1_HOUR_MASK = 31;
  var RTC_1_MIN_SHIFT = 8;
  var RTC_1_MIN_MASK = 63;
  var RTC_1_SEC_SHIFT = 0;
  var RTC_1_SEC_MASK = 63;
  var RP2040RTC = class extends BasePeripheral {
    constructor() {
      super(...arguments);
      this.setup0 = 0;
      this.setup1 = 0;
      this.ctrl = 0;
      this.baseline = new Date(2021, 0, 1);
      this.baselineNanos = 0;
    }
    readUint32(offset) {
      const date = new Date(this.baseline.getTime() + (this.rp2040.clock.nanos - this.baselineNanos) / 1e6);
      switch (offset) {
        case RTC_SETUP0:
          return this.setup0;
        case RTC_SETUP1:
          return this.setup1;
        case RTC_CTRL:
          return this.ctrl;
        case IRQ_SETUP_0:
          return 0;
        case RTC_RTC1:
          return (date.getFullYear() & RTC_0_YEAR_MASK) << RTC_0_YEAR_SHIFT | (date.getMonth() + 1 & RTC_0_MONTH_MASK) << RTC_0_MONTH_SHIFT | (date.getDate() & RTC_0_DAY_MASK) << RTC_0_DAY_SHIFT;
        case RTC_RTC0:
          return (date.getDay() & RTC_1_DOTW_MASK) << RTC_1_DOTW_SHIFT | (date.getHours() & RTC_1_HOUR_MASK) << RTC_1_HOUR_SHIFT | (date.getMinutes() & RTC_1_MIN_MASK) << RTC_1_MIN_SHIFT | (date.getSeconds() & RTC_1_SEC_MASK) << RTC_1_SEC_SHIFT;
        default:
          break;
      }
      return super.readUint32(offset);
    }
    writeUint32(offset, value) {
      switch (offset) {
        case RTC_SETUP0:
          this.setup0 = value;
          break;
        case RTC_SETUP1:
          this.setup1 = value;
          break;
        case RTC_CTRL:
          if (value & RTC_LOAD_BITS) {
            this.ctrl |= RTC_LOAD_BITS;
          }
          if (value & RTC_ENABLE_BITS) {
            this.ctrl |= RTC_ENABLE_BITS;
            this.ctrl |= RTC_ACTIVE_BITS;
            if (this.ctrl & RTC_LOAD_BITS) {
              const year = this.setup0 >> SETUP_0_YEAR_SHIFT & SETUP_0_YEAR_MASK;
              const month = this.setup0 >> SETUP_0_MONTH_SHIFT & SETUP_0_MONTH_MASK;
              const day = this.setup0 >> SETUP_0_DAY_SHIFT & SETUP_0_DAY_MASK;
              const hour = this.setup1 >> SETUP_1_HOUR_SHIFT & SETUP_1_HOUR_MASK;
              const min = this.setup1 >> SETUP_1_MIN_SHIFT & SETUP_1_MIN_MASK;
              const sec = this.setup1 >> SETUP_1_SEC_SHIFT & SETUP_1_SEC_MASK;
              this.baseline = new Date(year, month - 1, day, hour, min, sec);
              this.baselineNanos = this.rp2040.clock.nanos;
              this.ctrl &= ~RTC_LOAD_BITS;
            }
          } else {
            this.ctrl &= ~RTC_ENABLE_BITS;
            this.ctrl &= ~RTC_ACTIVE_BITS;
          }
          break;
        default:
          super.writeUint32(offset, value);
      }
    }
  };

  // tools/programmable_simulator/node_modules/rp2040js/dist/esm/peripherals/spi.js
  var SSPCR0 = 0;
  var SSPCR1 = 4;
  var SSPDR = 8;
  var SSPSR = 12;
  var SSPCPSR = 16;
  var SSPIMSC = 20;
  var SSPRIS = 24;
  var SSPMIS = 28;
  var SSPICR = 32;
  var SSPDMACR = 36;
  var SSPPERIPHID0 = 4064;
  var SSPPERIPHID1 = 4068;
  var SSPPERIPHID2 = 4072;
  var SSPPERIPHID3 = 4076;
  var SSPPCELLID0 = 4080;
  var SSPPCELLID1 = 4084;
  var SSPPCELLID2 = 4088;
  var SSPPCELLID3 = 4092;
  var SCR_MASK = 255;
  var SCR_SHIFT = 8;
  var SPH = 1 << 7;
  var SPO = 1 << 6;
  var DSS_MASK = 15;
  var DSS_SHIFT = 0;
  var SOD = 1 << 3;
  var MS = 1 << 2;
  var SSE = 1 << 1;
  var LBM = 1 << 0;
  var BSY = 1 << 4;
  var RFF2 = 1 << 3;
  var RNE = 1 << 2;
  var TNF = 1 << 1;
  var TFE2 = 1 << 0;
  var CPSDVSR_MASK = 254;
  var TXDMAE = 1 << 1;
  var RXDMAE = 1 << 0;
  var SSPTXINTR = 1 << 3;
  var SSPRXINTR = 1 << 2;
  var SSPRTINTR = 1 << 1;
  var SSPRORINTR = 1 << 0;
  var RPSPI = class extends BasePeripheral {
    get intStatus() {
      return this.intRaw & this.intEnable;
    }
    get enabled() {
      return !!(this.control1 & SSE);
    }
    /** Data size in bits: 4 to 16 bits */
    get dataBits() {
      return (this.control0 >> DSS_SHIFT & DSS_MASK) + 1;
    }
    get masterMode() {
      return !(this.control0 & MS);
    }
    get spiMode() {
      const cpol = this.control0 & SPO;
      const cpha = this.control0 & SPH;
      return cpol ? cpha ? 2 : 3 : cpha ? 1 : 0;
    }
    get clockFrequency() {
      if (!this.clockDivisor) {
        return 0;
      }
      const scr = this.control0 >> SCR_SHIFT & SCR_MASK;
      return this.rp2040.clkPeri / (this.clockDivisor * (1 + scr));
    }
    updateDMATx() {
      if (this.txFIFO.full) {
        this.rp2040.dma.clearDREQ(this.dreq.tx);
      } else {
        this.rp2040.dma.setDREQ(this.dreq.tx);
      }
    }
    updateDMARx() {
      if (this.rxFIFO.empty) {
        this.rp2040.dma.clearDREQ(this.dreq.rx);
      } else {
        this.rp2040.dma.setDREQ(this.dreq.rx);
      }
    }
    constructor(rp2040, name, irq, dreq) {
      super(rp2040, name);
      this.irq = irq;
      this.dreq = dreq;
      this.rxFIFO = new FIFO(8);
      this.txFIFO = new FIFO(8);
      this.onTransmit = () => this.completeTransmit(0);
      this.busy = false;
      this.control0 = 0;
      this.control1 = 0;
      this.dmaControl = 0;
      this.clockDivisor = 0;
      this.intRaw = 0;
      this.intEnable = 0;
      this.updateDMATx();
      this.updateDMARx();
    }
    doTX() {
      if (!this.busy && !this.txFIFO.empty) {
        const value = this.txFIFO.pull();
        this.busy = true;
        this.onTransmit(value);
        this.fifosUpdated();
      }
    }
    completeTransmit(rxValue) {
      this.busy = false;
      if (!this.rxFIFO.full) {
        this.rxFIFO.push(rxValue);
      } else {
        this.intRaw |= SSPRORINTR;
      }
      this.fifosUpdated();
      this.doTX();
    }
    checkInterrupts() {
      this.rp2040.setInterrupt(this.irq, !!this.intStatus);
    }
    fifosUpdated() {
      const prevStatus = this.intStatus;
      if (this.txFIFO.itemCount <= this.txFIFO.size / 2) {
        this.intRaw |= SSPTXINTR;
      } else {
        this.intRaw &= ~SSPTXINTR;
      }
      if (this.rxFIFO.itemCount >= this.rxFIFO.size / 2) {
        this.intRaw |= SSPRXINTR;
      } else {
        this.intRaw &= ~SSPRXINTR;
      }
      if (this.intStatus !== prevStatus) {
        this.checkInterrupts();
      }
      this.updateDMATx();
      this.updateDMARx();
    }
    readUint32(offset) {
      switch (offset) {
        case SSPCR0:
          return this.control0;
        case SSPCR1:
          return this.control1;
        case SSPDR:
          if (!this.rxFIFO.empty) {
            const value = this.rxFIFO.pull();
            this.fifosUpdated();
            return value;
          }
          return 0;
        case SSPSR:
          return (this.busy || !this.txFIFO.empty ? BSY : 0) | (this.rxFIFO.full ? RFF2 : 0) | (!this.rxFIFO.empty ? RNE : 0) | (!this.txFIFO.full ? TNF : 0) | (this.txFIFO.empty ? TFE2 : 0);
        case SSPCPSR:
          return this.clockDivisor;
        case SSPIMSC:
          return this.intEnable;
        case SSPRIS:
          return this.intRaw;
        case SSPMIS:
          return this.intStatus;
        case SSPDMACR:
          return this.dmaControl;
        case SSPPERIPHID0:
          return 34;
        case SSPPERIPHID1:
          return 16;
        case SSPPERIPHID2:
          return 52;
        case SSPPERIPHID3:
          return 0;
        case SSPPCELLID0:
          return 13;
        case SSPPCELLID1:
          return 240;
        case SSPPCELLID2:
          return 5;
        case SSPPCELLID3:
          return 177;
      }
      return super.readUint32(offset);
    }
    writeUint32(offset, value) {
      switch (offset) {
        case SSPCR0:
          this.control0 = value;
          return;
        case SSPCR1:
          this.control1 = value;
          return;
        case SSPDR:
          if (!this.txFIFO.full) {
            this.txFIFO.push(value & (1 << this.dataBits) - 1);
            this.doTX();
            this.fifosUpdated();
          }
          return;
        case SSPCPSR:
          this.clockDivisor = value & CPSDVSR_MASK;
          return;
        case SSPIMSC:
          this.intEnable = value;
          this.checkInterrupts();
          return;
        case SSPDMACR:
          this.dmaControl = value;
          return;
        case SSPICR:
          this.intRaw &= ~(value & (SSPRTINTR | SSPRORINTR));
          this.checkInterrupts();
          return;
        default:
          super.writeUint32(offset, value);
      }
    }
  };

  // tools/programmable_simulator/node_modules/rp2040js/dist/esm/peripherals/ssi.js
  var SSI_CTRLR0 = 0;
  var SSI_CTRLR1 = 4;
  var SSI_SSIENR = 8;
  var SSI_BAUDR = 20;
  var SSI_TXFLR = 32;
  var SSI_RXFLR = 36;
  var SSI_SR = 40;
  var SSI_SR_TFNF_BITS = 2;
  var SSI_SR_TFE_BITS = 4;
  var SSI_SR_RFNE_BITS = 8;
  var SSI_IDR = 88;
  var SSI_VERSION_ID = 92;
  var SSI_DR0 = 96;
  var SSI_RX_SAMPLE_DLY = 240;
  var SSI_SPI_CTRL_R0 = 244;
  var SSI_TXD_DRIVE_EDGE = 248;
  var CMD_READ_STATUS = 5;
  var RPSSI = class extends BasePeripheral {
    constructor() {
      super(...arguments);
      this.dr0 = 0;
      this.txflr = 0;
      this.rxflr = 0;
      this.baudr = 0;
      this.crtlr0 = 0;
      this.crtlr1 = 0;
      this.ssienr = 0;
      this.spictlr0 = 0;
      this.rxsampldly = 0;
      this.txddriveedge = 0;
    }
    readUint32(offset) {
      switch (offset) {
        case SSI_TXFLR:
          return this.txflr;
        case SSI_RXFLR:
          return this.rxflr;
        case SSI_CTRLR0:
          return this.crtlr0;
        /*  & 0x017FFFFF = b23,b25..31 reserved */
        case SSI_CTRLR1:
          return this.crtlr1;
        case SSI_SSIENR:
          return this.ssienr;
        case SSI_BAUDR:
          return this.baudr;
        case SSI_SR:
          return SSI_SR_TFE_BITS | SSI_SR_RFNE_BITS | SSI_SR_TFNF_BITS;
        case SSI_IDR:
          return 1364414537;
        case SSI_VERSION_ID:
          return 875573546;
        case SSI_RX_SAMPLE_DLY:
          return this.rxsampldly;
        case SSI_TXD_DRIVE_EDGE:
          return this.txddriveedge;
        case SSI_SPI_CTRL_R0:
          return this.spictlr0;
        /* b6,7,10,19..23 reserved */
        case SSI_DR0:
          return this.dr0;
      }
      return super.readUint32(offset);
    }
    writeUint32(offset, value) {
      switch (offset) {
        case SSI_TXFLR:
          this.txflr = value;
          return;
        case SSI_RXFLR:
          this.rxflr = value;
          return;
        case SSI_CTRLR0:
          this.crtlr0 = value;
          return;
        case SSI_CTRLR1:
          this.crtlr1 = value;
          return;
        case SSI_SSIENR:
          this.ssienr = value;
          return;
        case SSI_BAUDR:
          this.baudr = value;
          return;
        case SSI_RX_SAMPLE_DLY:
          this.rxsampldly = value & 255;
          return;
        case SSI_TXD_DRIVE_EDGE:
          this.txddriveedge = value & 255;
          return;
        case SSI_SPI_CTRL_R0:
          this.spictlr0 = value;
          return;
        case SSI_DR0:
          if (value === CMD_READ_STATUS) {
            this.dr0 = 0;
          }
          return;
        default:
          super.writeUint32(offset, value);
      }
    }
  };

  // tools/programmable_simulator/node_modules/rp2040js/dist/esm/peripherals/syscfg.js
  var PROC0_NMI_MASK = 0;
  var RP2040SysCfg = class extends BasePeripheral {
    readUint32(offset) {
      switch (offset) {
        case PROC0_NMI_MASK:
          return this.rp2040.core.interruptNMIMask;
      }
      return super.readUint32(offset);
    }
    writeUint32(offset, value) {
      switch (offset) {
        case PROC0_NMI_MASK:
          this.rp2040.core.interruptNMIMask = value;
          break;
        default:
          super.writeUint32(offset, value);
      }
    }
  };

  // tools/programmable_simulator/node_modules/rp2040js/dist/esm/peripherals/sysinfo.js
  var CHIP_ID = 0;
  var PLATFORM = 4;
  var GITREF_RP2040 = 64;
  var RP2040SysInfo = class extends BasePeripheral {
    readUint32(offset) {
      switch (offset) {
        case CHIP_ID:
          return 268445991;
        case PLATFORM:
          return 2;
        case GITREF_RP2040:
          return 3771273960;
      }
      return super.readUint32(offset);
    }
  };

  // tools/programmable_simulator/node_modules/rp2040js/dist/esm/peripherals/tbman.js
  var PLATFORM2 = 0;
  var ASIC = 1;
  var RPTBMAN = class extends BasePeripheral {
    readUint32(offset) {
      switch (offset) {
        case PLATFORM2:
          return ASIC;
        default:
          return super.readUint32(offset);
      }
    }
  };

  // tools/programmable_simulator/node_modules/rp2040js/dist/esm/peripherals/timer.js
  var TIMEHR = 8;
  var TIMELR = 12;
  var TIMERAWH = 36;
  var TIMERAWL = 40;
  var ALARM0 = 16;
  var ALARM1 = 20;
  var ALARM2 = 24;
  var ALARM3 = 28;
  var ARMED = 32;
  var PAUSE = 48;
  var INTR5 = 52;
  var INTE3 = 56;
  var INTF3 = 60;
  var INTS3 = 64;
  var ALARM_0 = 1 << 0;
  var ALARM_1 = 1 << 1;
  var ALARM_2 = 1 << 2;
  var ALARM_3 = 1 << 3;
  var timerInterrupts = [IRQ.TIMER_0, IRQ.TIMER_1, IRQ.TIMER_2, IRQ.TIMER_3];
  var RPTimerAlarm = class {
    constructor(bitValue, clockAlarm) {
      this.bitValue = bitValue;
      this.clockAlarm = clockAlarm;
      this.armed = false;
      this.targetMicros = 0;
    }
  };
  var RPTimer = class extends BasePeripheral {
    constructor(rp2040, name) {
      super(rp2040, name);
      this.latchedTimeHigh = 0;
      this.intRaw = 0;
      this.intEnable = 0;
      this.intForce = 0;
      this.paused = false;
      this.clock = rp2040.clock;
      this.alarms = [
        new RPTimerAlarm(ALARM_0, this.clock.createAlarm(() => this.fireAlarm(0))),
        new RPTimerAlarm(ALARM_1, this.clock.createAlarm(() => this.fireAlarm(1))),
        new RPTimerAlarm(ALARM_2, this.clock.createAlarm(() => this.fireAlarm(2))),
        new RPTimerAlarm(ALARM_3, this.clock.createAlarm(() => this.fireAlarm(3)))
      ];
    }
    get intStatus() {
      return this.intRaw & this.intEnable | this.intForce;
    }
    readUint32(offset) {
      const time = this.clock.nanos / 1e3;
      switch (offset) {
        case TIMEHR:
          return this.latchedTimeHigh;
        case TIMELR:
          this.latchedTimeHigh = Math.floor(time / 2 ** 32);
          return time >>> 0;
        case TIMERAWH:
          return Math.floor(time / 2 ** 32);
        case TIMERAWL:
          return time >>> 0;
        case ALARM0:
          return this.alarms[0].targetMicros;
        case ALARM1:
          return this.alarms[1].targetMicros;
        case ALARM2:
          return this.alarms[2].targetMicros;
        case ALARM3:
          return this.alarms[3].targetMicros;
        case PAUSE:
          return this.paused ? 1 : 0;
        case INTR5:
          return this.intRaw;
        case INTE3:
          return this.intEnable;
        case INTF3:
          return this.intForce;
        case INTS3:
          return this.intStatus;
        case ARMED:
          return (this.alarms[0].armed ? this.alarms[0].bitValue : 0) | (this.alarms[1].armed ? this.alarms[1].bitValue : 0) | (this.alarms[2].armed ? this.alarms[2].bitValue : 0) | (this.alarms[3].armed ? this.alarms[3].bitValue : 0);
      }
      return super.readUint32(offset);
    }
    writeUint32(offset, value) {
      switch (offset) {
        case ALARM0:
        case ALARM1:
        case ALARM2:
        case ALARM3: {
          const alarmIndex = (offset - ALARM0) / 4;
          const alarm = this.alarms[alarmIndex];
          const deltaMicros = value - this.clock.nanos / 1e3 >>> 0;
          alarm.armed = true;
          alarm.targetMicros = value;
          alarm.clockAlarm.schedule(deltaMicros * 1e3);
          break;
        }
        case ARMED:
          for (const alarm of this.alarms) {
            if (this.rawWriteValue & alarm.bitValue) {
              this.disarmAlarm(alarm);
            }
          }
          break;
        case PAUSE:
          this.paused = !!(value & 1);
          if (this.paused) {
            this.warn("Unimplemented Timer Pause");
          }
          break;
        case INTR5:
          this.intRaw &= ~this.rawWriteValue;
          this.checkInterrupts();
          break;
        case INTE3:
          this.intEnable = value & 15;
          this.checkInterrupts();
          break;
        case INTF3:
          this.intForce = value & 15;
          this.checkInterrupts();
          break;
        default:
          super.writeUint32(offset, value);
      }
    }
    fireAlarm(index) {
      const alarm = this.alarms[index];
      this.disarmAlarm(alarm);
      this.intRaw |= alarm.bitValue;
      this.checkInterrupts();
    }
    checkInterrupts() {
      const { intStatus } = this;
      for (let i = 0; i < this.alarms.length; i++) {
        this.rp2040.setInterrupt(timerInterrupts[i], !!(intStatus & 1 << i));
      }
    }
    disarmAlarm(alarm) {
      alarm.clockAlarm.cancel();
      alarm.armed = false;
    }
  };

  // tools/programmable_simulator/node_modules/rp2040js/dist/esm/peripherals/uart.js
  var UARTDR = 0;
  var UARTFR = 24;
  var UARTIBRD = 36;
  var UARTFBRD = 40;
  var UARTLCR_H = 44;
  var UARTCR = 48;
  var UARTIMSC = 56;
  var UARTIRIS = 60;
  var UARTIMIS = 64;
  var UARTICR = 68;
  var UARTPERIPHID0 = 4064;
  var UARTPERIPHID1 = 4068;
  var UARTPERIPHID2 = 4072;
  var UARTPERIPHID3 = 4076;
  var UARTPCELLID0 = 4080;
  var UARTPCELLID1 = 4084;
  var UARTPCELLID2 = 4088;
  var UARTPCELLID3 = 4092;
  var TXFE = 1 << 7;
  var RXFF = 1 << 6;
  var RXFE = 1 << 4;
  var FEN = 1 << 4;
  var RXE = 1 << 9;
  var TXE = 1 << 8;
  var UARTEN = 1 << 0;
  var UARTTXINTR = 1 << 5;
  var UARTRXINTR = 1 << 4;
  var RPUART = class extends BasePeripheral {
    constructor(rp2040, name, irq, dreq) {
      super(rp2040, name);
      this.irq = irq;
      this.dreq = dreq;
      this.ctrlRegister = RXE | TXE;
      this.lineCtrlRegister = 0;
      this.rxFIFO = new FIFO(32);
      this.interruptMask = 0;
      this.interruptStatus = 0;
      this.intDivisor = 0;
      this.fracDivisor = 0;
    }
    get enabled() {
      return !!(this.ctrlRegister & UARTEN);
    }
    get txEnabled() {
      return !!(this.ctrlRegister & TXE);
    }
    get rxEnabled() {
      return !!(this.ctrlRegister & RXE);
    }
    get fifosEnabled() {
      return !!(this.lineCtrlRegister & FEN);
    }
    /**
     * Number of bits per UART character
     */
    get wordLength() {
      switch (this.lineCtrlRegister >>> 5 & 3) {
        case 0:
          return 5;
        case 1:
          return 6;
        case 2:
          return 7;
        case 3:
          return 8;
      }
    }
    get baudDivider() {
      return this.intDivisor + this.fracDivisor / 64;
    }
    get baudRate() {
      return Math.round(this.rp2040.clkPeri / (this.baudDivider * 16));
    }
    /** Re-reports the baud rate, unless the firmware has not set the divider yet. */
    clkPeriChanged() {
      var _a;
      if (this.baudDivider) {
        (_a = this.onBaudRateChange) === null || _a === void 0 ? void 0 : _a.call(this, this.baudRate);
      }
    }
    get flags() {
      return (this.rxFIFO.full ? RXFF : 0) | (this.rxFIFO.empty ? RXFE : 0) | TXFE;
    }
    checkInterrupts() {
      this.interruptStatus |= UARTTXINTR;
      this.rp2040.setInterrupt(this.irq, !!(this.interruptStatus & this.interruptMask));
    }
    feedByte(value) {
      this.rxFIFO.push(value);
      this.interruptStatus |= UARTRXINTR;
      this.checkInterrupts();
    }
    readUint32(offset) {
      switch (offset) {
        case UARTDR: {
          const value = this.rxFIFO.pull();
          if (!this.rxFIFO.empty) {
            this.interruptStatus |= UARTRXINTR;
          } else {
            this.interruptStatus &= ~UARTRXINTR;
          }
          this.checkInterrupts();
          return value;
        }
        case UARTFR:
          return this.flags;
        case UARTIBRD:
          return this.intDivisor;
        case UARTFBRD:
          return this.fracDivisor;
        case UARTLCR_H:
          return this.lineCtrlRegister;
        case UARTCR:
          return this.ctrlRegister;
        case UARTIMSC:
          return this.interruptMask;
        case UARTIRIS:
          return this.interruptStatus;
        case UARTIMIS:
          return this.interruptStatus & this.interruptMask;
        case UARTPERIPHID0:
          return 17;
        case UARTPERIPHID1:
          return 16;
        case UARTPERIPHID2:
          return 52;
        case UARTPERIPHID3:
          return 0;
        case UARTPCELLID0:
          return 13;
        case UARTPCELLID1:
          return 240;
        case UARTPCELLID2:
          return 5;
        case UARTPCELLID3:
          return 177;
      }
      return super.readUint32(offset);
    }
    writeUint32(offset, value) {
      var _a, _b, _c;
      switch (offset) {
        case UARTDR:
          (_a = this.onByte) === null || _a === void 0 ? void 0 : _a.call(this, value & 255);
          break;
        case UARTIBRD:
          this.intDivisor = value & 65535;
          (_b = this.onBaudRateChange) === null || _b === void 0 ? void 0 : _b.call(this, this.baudRate);
          break;
        case UARTFBRD:
          this.fracDivisor = value & 63;
          (_c = this.onBaudRateChange) === null || _c === void 0 ? void 0 : _c.call(this, this.baudRate);
          break;
        case UARTLCR_H:
          this.lineCtrlRegister = value;
          break;
        case UARTCR:
          this.ctrlRegister = value;
          if (this.enabled) {
            this.rp2040.dma.setDREQ(this.dreq.tx);
          } else {
            this.rp2040.dma.clearDREQ(this.dreq.tx);
          }
          break;
        case UARTIMSC:
          this.interruptMask = value & 2047;
          this.checkInterrupts();
          break;
        case UARTICR:
          this.interruptStatus &= ~this.rawWriteValue;
          this.checkInterrupts();
          break;
        default:
          super.writeUint32(offset, value);
      }
    }
  };

  // tools/programmable_simulator/node_modules/rp2040js/dist/esm/usb/usb-device.js
  function parseSetupPacket(setup) {
    return {
      bmRequestType: setup[0],
      bRequest: setup[1],
      wValue: setup[2] | setup[3] << 8,
      wIndex: setup[4] | setup[5] << 8,
      wLength: setup[6] | setup[7] << 8,
      // Helpers
      direction: setup[0] & 128 ? "in" : "out",
      type: setup[0] >> 5 & 3,
      // 0=Standard, 1=Class, 2=Vendor
      recipient: setup[0] & 31
      // 0=Device, 1=Interface, 2=Endpoint, 3=Other
    };
  }

  // tools/programmable_simulator/node_modules/rp2040js/dist/esm/peripherals/usb.js
  var ENDPOINT_COUNT = 16;
  var USB_HOST_INTERRUPT_ENDPOINTS = 15;
  var EP1_IN_CONTROL = 8;
  var EP0_IN_BUFFER_CONTROL = 128;
  var EP0_OUT_BUFFER_CONTROL = 132;
  var EP15_OUT_BUFFER_CONTROL = 252;
  var HOST_SETUP_PACKET = 0;
  var HOST_INT_EP_CTRL_BASE = 8;
  var HOST_INT_EP_BUF_CTRL_BASE = 136;
  var HOST_EPX_BUF_CTRL = 128;
  var HOST_EPX_DATA = 384;
  var USB_CTRL_DOUBLE_BUF = 1 << 30;
  var USB_CTRL_INTERRUPT_PER_TRANSFER = 1 << 29;
  var EP_CTRL_ENABLE_BITS = 1 << 31;
  var EP_CTRL_HOST_INTERRUPT_INTERVAL_LSB = 16;
  var USB_BUF_CTRL_AVAILABLE = 1 << 10;
  var USB_BUF_CTRL_FULL = 1 << 15;
  var USB_BUF_CTRL_LEN_MASK = 1023;
  var USB_BUF_CTRL_DATA1_PID = 1 << 13;
  var USB_BUF_CTRL_LAST = 1 << 14;
  var USB_BUF1_SHIFT = 16;
  var USB_BUF1_OFFSET = 64;
  var ADDR_ENDP = 0;
  var ADDR_ENDP1 = 4;
  var ADDR_ENDP15 = 60;
  var MAIN_CTRL = 64;
  var SOF_WR = 68;
  var SOF_RD = 72;
  var SIE_CTRL = 76;
  var SIE_STATUS = 80;
  var INT_EP_CTRL = 84;
  var BUFF_STATUS = 88;
  var BUFF_CPU_SHOULD_HANDLE = 92;
  var EP_ABORT = 96;
  var EP_ABORT_DONE = 100;
  var EP_STALL_ARM = 104;
  var NAK_POLL = 108;
  var EP_STATUS_STALL_NAK = 112;
  var USB_MUXING = 116;
  var USB_PWR = 120;
  var INTR6 = 140;
  var INTE4 = 144;
  var INTF4 = 148;
  var INTS4 = 152;
  var SIM_TIMING = 1 << 31;
  var HOST_NDEVICE = 1 << 1;
  var CONTROLLER_EN = 1 << 0;
  var SIE_CTRL_EP0_INT_STALL = 1 << 31;
  var SIE_CTRL_EP0_DOUBLE_BUF = 1 << 30;
  var SIE_CTRL_EP0_INT_1BUF = 1 << 29;
  var SIE_CTRL_EP0_INT_2BUF = 1 << 28;
  var SIE_CTRL_EP0_INT_NAK = 1 << 27;
  var SIE_CTRL_DIRECT_EN = 1 << 26;
  var SIE_CTRL_DIRECT_DP = 1 << 25;
  var SIE_CTRL_DIRECT_DM = 1 << 24;
  var SIE_CTRL_TRANSCEIVER_PD = 1 << 18;
  var SIE_CTRL_RPU_OPT = 1 << 17;
  var SIE_CTRL_PULLUP_EN = 1 << 16;
  var SIE_CTRL_PULLDOWN_EN = 1 << 15;
  var SIE_CTRL_RESET_BUS = 1 << 13;
  var SIE_CTRL_RESUME = 1 << 12;
  var SIE_CTRL_VBUS_EN = 1 << 11;
  var SIE_CTRL_KEEP_ALIVE_EN = 1 << 10;
  var SIE_CTRL_SOF_EN = 1 << 9;
  var SIE_CTRL_SOF_SYNC = 1 << 8;
  var SIE_CTRL_PREAMBLE_EN = 1 << 6;
  var SIE_CTRL_STOP_TRANS = 1 << 4;
  var SIE_CTRL_RECEIVE_DATA = 1 << 3;
  var SIE_CTRL_SEND_DATA = 1 << 2;
  var SIE_CTRL_SEND_SETUP = 1 << 1;
  var SIE_CTRL_START_TRANS = 1 << 0;
  var SIE_DATA_SEQ_ERROR = 1 << 31;
  var SIE_ACK_REC = 1 << 30;
  var SIE_STALL_REC = 1 << 29;
  var SIE_NAK_REC = 1 << 28;
  var SIE_RX_TIMEOUT = 1 << 27;
  var SIE_RX_OVERFLOW = 1 << 26;
  var SIE_BIT_STUFF_ERROR = 1 << 25;
  var SIE_CRC_ERROR = 1 << 24;
  var SIE_BUS_RESET = 1 << 19;
  var SIE_TRANS_COMPLETE = 1 << 18;
  var SIE_SETUP_REC = 1 << 17;
  var SIE_CONNECTED = 1 << 16;
  var SIE_RESUME = 1 << 11;
  var SIE_VBUS_OVER_CURR = 1 << 10;
  var SIE_SPEED = 1 << 9;
  var SIE_SPEED_FS_VALUE = 2;
  var SIE_SUSPENDED = 1 << 4;
  var SIE_LINE_STATE_MASK = 3;
  var SIE_LINE_STATE_SHIFT = 2;
  var SIE_VBUS_DETECTED = 1 << 0;
  var SOFTCON = 1 << 3;
  var TO_DIGITAL_PAD = 1 << 2;
  var TO_EXTPHY = 1 << 1;
  var TO_PHY = 1 << 0;
  var PWR_VBUS_DETECT = 1 << 3;
  var PWR_VBUS_DETECT_OVERRIDE_EN = 1 << 2;
  var PWR_OVERCURR_DETECT = 1 << 1;
  var PWR_OVERCURR_DETECT_EN = 1 << 0;
  var INTR_EP_STALL_NAK = 1 << 19;
  var INTR_ABORT_DONE = 1 << 18;
  var INTR_DEV_SOF = 1 << 17;
  var INTR_SETUP_REQ = 1 << 16;
  var INTR_DEV_RESUME_FROM_HOST = 1 << 15;
  var INTR_DEV_SUSPEND = 1 << 14;
  var INTR_DEV_CONN_DIS = 1 << 13;
  var INTR_BUS_RESET = 1 << 12;
  var INTR_VBUS_DETECT = 1 << 11;
  var INTR_STALL = 1 << 10;
  var INTR_ERROR_CRC = 1 << 9;
  var INTR_ERROR_BIT_STUFF = 1 << 8;
  var INTR_ERROR_RX_OVERFLOW = 1 << 7;
  var INTR_ERROR_RX_TIMEOUT = 1 << 6;
  var INTR_ERROR_DATA_SEQ = 1 << 5;
  var INTR_BUFF_STATUS = 1 << 4;
  var INTR_TRANS_COMPLETE = 1 << 3;
  var INTR_HOST_SOF = 1 << 2;
  var INTR_HOST_RESUME = 1 << 1;
  var INTR_HOST_CONN_DIS = 1 << 0;
  var SIELineState;
  (function(SIELineState2) {
    SIELineState2[SIELineState2["SE0"] = 0] = "SE0";
    SIELineState2[SIELineState2["J"] = 1] = "J";
    SIELineState2[SIELineState2["K"] = 2] = "K";
    SIELineState2[SIELineState2["SE1"] = 3] = "SE1";
  })(SIELineState || (SIELineState = {}));
  var SIE_WRITECLEAR_MASK = SIE_DATA_SEQ_ERROR | SIE_ACK_REC | SIE_STALL_REC | SIE_NAK_REC | SIE_RX_TIMEOUT | SIE_RX_OVERFLOW | SIE_BIT_STUFF_ERROR | SIE_CONNECTED | SIE_CRC_ERROR | SIE_BUS_RESET | SIE_TRANS_COMPLETE | SIE_SETUP_REC | SIE_RESUME;
  var USBEndpointAlarm = class {
    constructor(alarm) {
      this.alarm = alarm;
      this.buffers = [];
    }
    schedule(buffer, delayNanos) {
      this.buffers.push(buffer);
      this.alarm.schedule(delayNanos);
    }
  };
  var RPUSBController = class extends BasePeripheral {
    get intStatus() {
      return this.intRaw & this.intEnable | this.intForce;
    }
    constructor(rp2040, name) {
      super(rp2040, name);
      this.addrEndp = 0;
      this.mainCtrl = 0;
      this.intRaw = 0;
      this.intEnable = 0;
      this.intForce = 0;
      this.sieStatus = 0;
      this.buffStatus = 0;
      this.sieCtrl = 0;
      this.sofFrameNumber = 0;
      this.devAddrCtrl = 0;
      this.intEpAddrCtrl = new Array(USB_HOST_INTERRUPT_ENDPOINTS).fill(0);
      this.intEpCtrl = 0;
      this.usbPwr = 0;
      this.nakPoll = 0;
      this.epAbort = 0;
      this.epAbortDone = 0;
      this.epStallArm = 0;
      this.epStatusStallNak = 0;
      this.hostMode = false;
      this.sofEnabled = false;
      this.connectedDevice = null;
      this.pendingSetupResponse = null;
      this.controlDataPid = 1;
      this.expectingStatusPhase = false;
      this.readDelayMicroseconds = 10;
      this.writeDelayMicroseconds = 10;
      this.hostTransactionDelayMicroseconds = 5;
      const clock = rp2040.clock;
      this.endpointReadAlarms = [];
      this.endpointWriteAlarms = [];
      for (let i = 0; i < ENDPOINT_COUNT; ++i) {
        this.endpointReadAlarms.push(new USBEndpointAlarm(clock.createAlarm(() => {
          const buffer = this.endpointReadAlarms[i].buffers.shift();
          if (buffer) {
            this.finishRead(i, buffer);
          }
        })));
        this.endpointWriteAlarms.push(new USBEndpointAlarm(clock.createAlarm(() => {
          var _a;
          for (const buffer of this.endpointWriteAlarms[i].buffers) {
            (_a = this.onEndpointWrite) === null || _a === void 0 ? void 0 : _a.call(this, i, buffer);
          }
          this.endpointWriteAlarms[i].buffers = [];
        })));
      }
      this.resetAlarm = clock.createAlarm(() => {
        this.sieStatus |= SIE_BUS_RESET;
        this.sieStatusUpdated();
      });
      this.sofAlarm = clock.createAlarm(() => {
        this.generateSOF();
      });
      this.hostTransactionAlarm = clock.createAlarm(() => {
        this.completeHostTransaction();
      });
    }
    readUint32(offset) {
      if (offset >= ADDR_ENDP1 && offset <= ADDR_ENDP15 && (offset & 3) === 0) {
        const epIndex = offset - ADDR_ENDP1 >> 2;
        return this.intEpAddrCtrl[epIndex];
      }
      switch (offset) {
        case ADDR_ENDP:
          return this.hostMode ? this.devAddrCtrl : this.addrEndp & 491647;
        case MAIN_CTRL:
          return this.mainCtrl;
        case SOF_WR:
          return 0;
        // Write-only
        case SOF_RD:
          return this.sofFrameNumber & 2047;
        case SIE_CTRL:
          return this.sieCtrl;
        case SIE_STATUS:
          if (this.hostMode && this.intRaw & INTR_HOST_CONN_DIS) {
            this.intRaw &= ~INTR_HOST_CONN_DIS;
            this.checkInterrupts();
          }
          return this.sieStatus;
        case INT_EP_CTRL:
          return this.intEpCtrl;
        case BUFF_STATUS:
          return this.buffStatus;
        case BUFF_CPU_SHOULD_HANDLE:
          return 0;
        case EP_ABORT:
          return this.epAbort;
        case EP_ABORT_DONE:
          return this.epAbortDone;
        case EP_STALL_ARM:
          return this.epStallArm;
        case NAK_POLL:
          return this.nakPoll;
        case EP_STATUS_STALL_NAK:
          return this.epStatusStallNak;
        case USB_PWR:
          return this.usbPwr;
        case INTR6:
          return this.intRaw;
        case INTE4:
          return this.intEnable;
        case INTF4:
          return this.intForce;
        case INTS4:
          return this.intStatus;
      }
      return super.readUint32(offset);
    }
    writeUint32(offset, value) {
      var _a, _b;
      if (offset >= ADDR_ENDP1 && offset <= ADDR_ENDP15 && (offset & 3) === 0) {
        const epIndex = offset - ADDR_ENDP1 >> 2;
        this.intEpAddrCtrl[epIndex] = value;
        return;
      }
      switch (offset) {
        case ADDR_ENDP:
          if (this.hostMode) {
            this.devAddrCtrl = value;
          } else {
            this.addrEndp = value;
          }
          break;
        case MAIN_CTRL:
          this.mainCtrl = value & (SIM_TIMING | CONTROLLER_EN | HOST_NDEVICE);
          this.hostMode = !!(value & HOST_NDEVICE);
          if (value & CONTROLLER_EN) {
            if (this.hostMode) {
              this.debug("USB Host mode enabled");
              if (this.connectedDevice) {
                this.onDeviceConnected();
              }
            } else {
              (_a = this.onUSBEnabled) === null || _a === void 0 ? void 0 : _a.call(this);
            }
          }
          break;
        case SOF_WR:
          this.sofFrameNumber = value & 2047;
          break;
        case SIE_CTRL:
          this.handleSieCtrlWrite(value);
          break;
        case INT_EP_CTRL:
          this.intEpCtrl = value;
          break;
        case BUFF_STATUS:
          this.buffStatus &= ~this.rawWriteValue;
          this.buffStatusUpdated();
          break;
        case EP_ABORT:
          this.epAbort = value;
          this.epAbortDone |= value;
          break;
        case EP_ABORT_DONE:
          this.epAbortDone &= ~this.rawWriteValue;
          break;
        case EP_STALL_ARM:
          this.epStallArm = value;
          break;
        case NAK_POLL:
          this.nakPoll = value;
          break;
        case EP_STATUS_STALL_NAK:
          this.epStatusStallNak &= ~this.rawWriteValue;
          break;
        case USB_MUXING:
          if (value & TO_DIGITAL_PAD && !(value & TO_PHY)) {
            this.sieStatus |= SIE_CONNECTED;
          }
          break;
        case USB_PWR:
          this.usbPwr = value;
          if (value & PWR_VBUS_DETECT_OVERRIDE_EN) {
            if (value & PWR_VBUS_DETECT) {
              this.sieStatus |= SIE_VBUS_DETECTED;
            } else {
              this.sieStatus &= ~SIE_VBUS_DETECTED;
            }
          }
          break;
        case SIE_STATUS:
          this.sieStatus &= ~(this.rawWriteValue & SIE_WRITECLEAR_MASK);
          if (this.rawWriteValue & SIE_BUS_RESET) {
            if (!this.hostMode) {
              (_b = this.onResetReceived) === null || _b === void 0 ? void 0 : _b.call(this);
            }
            this.sieStatus &= ~(SIE_LINE_STATE_MASK << SIE_LINE_STATE_SHIFT);
            this.sieStatus |= SIELineState.J << SIE_LINE_STATE_SHIFT | SIE_CONNECTED;
          }
          this.sieStatusUpdated();
          break;
        case INTE4:
          this.intEnable = value & 1048575;
          this.checkInterrupts();
          break;
        case INTF4:
          this.intForce = value & 1048575;
          this.checkInterrupts();
          break;
        default:
          super.writeUint32(offset, value);
      }
    }
    readEndpointControlReg(endpoint2, out) {
      const controlRegOffset = EP1_IN_CONTROL + 8 * (endpoint2 - 1) + (out ? 4 : 0);
      return this.rp2040.usbDPRAMView.getUint32(controlRegOffset, true);
    }
    getEndpointBufferOffset(endpoint2, out) {
      if (endpoint2 === 0) {
        return 256;
      }
      return this.readEndpointControlReg(endpoint2, out) & 65472;
    }
    DPRAMUpdated(offset, value) {
      var _a, _b;
      if (this.hostMode) {
        return;
      }
      if (value & USB_BUF_CTRL_AVAILABLE && offset >= EP0_IN_BUFFER_CONTROL && offset <= EP15_OUT_BUFFER_CONTROL) {
        const endpoint2 = offset - EP0_IN_BUFFER_CONTROL >> 3;
        const bufferOut = offset & 4 ? true : false;
        let doubleBuffer = false;
        let interrupt = true;
        if (endpoint2 != 0) {
          const control = this.readEndpointControlReg(endpoint2, bufferOut);
          doubleBuffer = !!(control & USB_CTRL_DOUBLE_BUF);
          interrupt = !!(control & USB_CTRL_INTERRUPT_PER_TRANSFER);
        }
        if (doubleBuffer && value >> USB_BUF1_SHIFT & USB_BUF_CTRL_AVAILABLE) {
          const bufferLength2 = value >> USB_BUF1_SHIFT & USB_BUF_CTRL_LEN_MASK;
          const bufferOffset2 = this.getEndpointBufferOffset(endpoint2, bufferOut) + USB_BUF1_OFFSET;
          this.debug(`Start USB transfer, endPoint=${endpoint2}, direction=${bufferOut ? "out" : "in"} buffer=${bufferOffset2.toString(16)} length=${bufferLength2}`);
          value &= ~(USB_BUF_CTRL_AVAILABLE << USB_BUF1_SHIFT);
          this.rp2040.usbDPRAMView.setUint32(offset, value, true);
          if (bufferOut) {
            (_a = this.onEndpointRead) === null || _a === void 0 ? void 0 : _a.call(this, endpoint2, bufferLength2);
          } else {
            value &= ~(USB_BUF_CTRL_FULL << USB_BUF1_SHIFT);
            this.rp2040.usbDPRAMView.setUint32(offset, value, true);
            const buffer = this.rp2040.usbDPRAM.slice(bufferOffset2, bufferOffset2 + bufferLength2);
            this.indicateBufferReady(endpoint2, false);
            this.endpointWriteAlarms[endpoint2].schedule(buffer, this.writeDelayMicroseconds * 1e3);
          }
        }
        const bufferLength = value & USB_BUF_CTRL_LEN_MASK;
        const bufferOffset = this.getEndpointBufferOffset(endpoint2, bufferOut);
        this.debug(`Start USB transfer, endPoint=${endpoint2}, direction=${bufferOut ? "out" : "in"} buffer=${bufferOffset.toString(16)} length=${bufferLength}`);
        value &= ~USB_BUF_CTRL_AVAILABLE;
        this.rp2040.usbDPRAMView.setUint32(offset, value, true);
        if (bufferOut) {
          (_b = this.onEndpointRead) === null || _b === void 0 ? void 0 : _b.call(this, endpoint2, bufferLength);
        } else {
          value &= ~USB_BUF_CTRL_FULL;
          this.rp2040.usbDPRAMView.setUint32(offset, value, true);
          const buffer = this.rp2040.usbDPRAM.slice(bufferOffset, bufferOffset + bufferLength);
          if (interrupt || !doubleBuffer) {
            this.indicateBufferReady(endpoint2, false);
          }
          this.endpointWriteAlarms[endpoint2].schedule(buffer, this.writeDelayMicroseconds * 1e3);
        }
      }
    }
    endpointReadDone(endpoint2, buffer, delay = this.readDelayMicroseconds) {
      this.endpointReadAlarms[endpoint2].schedule(buffer, delay * 1e3);
    }
    finishRead(endpoint2, buffer) {
      const bufferOffset = this.getEndpointBufferOffset(endpoint2, true);
      const bufControlReg = EP0_OUT_BUFFER_CONTROL + endpoint2 * 8;
      let bufControl = this.rp2040.usbDPRAMView.getUint32(bufControlReg, true);
      const requestedLength = bufControl & USB_BUF_CTRL_LEN_MASK;
      const newLength = Math.min(buffer.length, requestedLength);
      bufControl |= USB_BUF_CTRL_FULL;
      bufControl = bufControl & ~USB_BUF_CTRL_LEN_MASK | newLength & USB_BUF_CTRL_LEN_MASK;
      this.rp2040.usbDPRAMView.setUint32(bufControlReg, bufControl, true);
      this.rp2040.usbDPRAM.set(buffer.subarray(0, newLength), bufferOffset);
      this.indicateBufferReady(endpoint2, true);
    }
    checkInterrupts() {
      const { intStatus } = this;
      this.rp2040.setInterrupt(IRQ.USBCTRL, !!intStatus);
    }
    resetDevice() {
      this.resetAlarm.schedule(1e7);
    }
    sendSetupPacket(setupPacket) {
      this.rp2040.usbDPRAM.set(setupPacket);
      this.sieStatus |= SIE_SETUP_REC;
      this.sieStatusUpdated();
    }
    indicateBufferReady(endpoint2, out) {
      this.buffStatus |= 1 << endpoint2 * 2 + (out ? 1 : 0);
      this.buffStatusUpdated();
    }
    buffStatusUpdated() {
      if (this.buffStatus) {
        this.intRaw |= INTR_BUFF_STATUS;
      } else {
        this.intRaw &= ~INTR_BUFF_STATUS;
      }
      this.checkInterrupts();
    }
    sieStatusUpdated() {
      if (this.hostMode) {
        const intRegisterMap = [
          [SIE_TRANS_COMPLETE, INTR_TRANS_COMPLETE],
          [SIE_STALL_REC, INTR_STALL],
          [SIE_CRC_ERROR, INTR_ERROR_CRC],
          [SIE_BIT_STUFF_ERROR, INTR_ERROR_BIT_STUFF],
          [SIE_RX_OVERFLOW, INTR_ERROR_RX_OVERFLOW],
          [SIE_RX_TIMEOUT, INTR_ERROR_RX_TIMEOUT],
          [SIE_DATA_SEQ_ERROR, INTR_ERROR_DATA_SEQ]
        ];
        for (const [sieBit, intRawBit] of intRegisterMap) {
          if (this.sieStatus & sieBit) {
            this.intRaw |= intRawBit;
          } else {
            this.intRaw &= ~intRawBit;
          }
        }
      } else {
        const intRegisterMap = [
          [SIE_SETUP_REC, INTR_SETUP_REQ],
          [SIE_RESUME, INTR_DEV_RESUME_FROM_HOST],
          [SIE_SUSPENDED, INTR_DEV_SUSPEND],
          [SIE_CONNECTED, INTR_DEV_CONN_DIS],
          [SIE_BUS_RESET, INTR_BUS_RESET],
          [SIE_VBUS_DETECTED, INTR_VBUS_DETECT],
          [SIE_STALL_REC, INTR_STALL],
          [SIE_CRC_ERROR, INTR_ERROR_CRC],
          [SIE_BIT_STUFF_ERROR, INTR_ERROR_BIT_STUFF],
          [SIE_RX_OVERFLOW, INTR_ERROR_RX_OVERFLOW],
          [SIE_RX_TIMEOUT, INTR_ERROR_RX_TIMEOUT],
          [SIE_DATA_SEQ_ERROR, INTR_ERROR_DATA_SEQ]
        ];
        for (const [sieBit, intRawBit] of intRegisterMap) {
          if (this.sieStatus & sieBit) {
            this.intRaw |= intRawBit;
          } else {
            this.intRaw &= ~intRawBit;
          }
        }
      }
      this.checkInterrupts();
    }
    // ============ Host Mode Methods ============
    /**
     * Connect a simulated USB device to the host controller.
     */
    connectDevice(device) {
      this.connectedDevice = device;
      if (this.hostMode && this.mainCtrl & CONTROLLER_EN) {
        this.onDeviceConnected();
      }
    }
    /**
     * Disconnect the simulated USB device from the host controller.
     */
    disconnectDevice() {
      if (this.connectedDevice && this.hostMode) {
        this.connectedDevice = null;
        this.sieStatus &= ~(3 << 8);
        this.intRaw |= INTR_HOST_CONN_DIS;
        this.checkInterrupts();
      }
      this.connectedDevice = null;
    }
    onDeviceConnected() {
      this.sieStatus &= ~(3 << 8);
      this.sieStatus |= SIE_SPEED_FS_VALUE << 8;
      this.intRaw |= INTR_HOST_CONN_DIS;
      this.checkInterrupts();
      this.debug("USB device connected (full-speed)");
    }
    handleSieCtrlWrite(value) {
      this.sieCtrl = value;
      if (value & SIE_CTRL_SOF_EN && !this.sofEnabled) {
        this.sofEnabled = true;
        this.scheduleSofPacket();
        this.debug("SOF generation enabled");
      } else if (!(value & SIE_CTRL_SOF_EN) && this.sofEnabled) {
        this.sofEnabled = false;
        this.debug("SOF generation disabled");
      }
      if (value & SIE_CTRL_RESET_BUS) {
        this.debug("USB bus reset initiated");
        if (this.connectedDevice) {
          this.connectedDevice.onReset();
        }
        this.controlDataPid = 1;
      }
      if (value & SIE_CTRL_START_TRANS) {
        this.startHostTransaction();
      }
    }
    scheduleSofPacket() {
      if (this.sofEnabled) {
        this.sofAlarm.schedule(1e6);
      }
    }
    generateSOF() {
      this.sofFrameNumber = this.sofFrameNumber + 1 & 2047;
      this.intRaw |= INTR_HOST_SOF;
      this.checkInterrupts();
      this.pollInterruptEndpoints();
      this.scheduleSofPacket();
    }
    pollInterruptEndpoints() {
      var _a;
      if (this.intEpCtrl && this.sofFrameNumber % 100 === 0) {
        this.debug(`INT_EP poll: intEpCtrl=0x${this.intEpCtrl.toString(16)} sofFrame=${this.sofFrameNumber}`);
      }
      for (let i = 0; i < USB_HOST_INTERRUPT_ENDPOINTS; i++) {
        const epCtrlBit = 1 << i + 1;
        if (!(this.intEpCtrl & epCtrlBit))
          continue;
        const addrEndp = this.intEpAddrCtrl[i];
        const devAddr = addrEndp & 127;
        const epNum = addrEndp >> 16 & 15;
        const isOut = !!(addrEndp & 1 << 25);
        if (this.sofFrameNumber % 500 === 0) {
          this.debug(`INT_EP[${i}]: addrEndp=0x${addrEndp.toString(16)} devAddr=${devAddr} epNum=${epNum} connectedAddr=${(_a = this.connectedDevice) === null || _a === void 0 ? void 0 : _a.address}`);
        }
        if (!this.connectedDevice || this.connectedDevice.address !== devAddr)
          continue;
        const epCtrlOffset = HOST_INT_EP_CTRL_BASE + i * 8;
        const epCtrl = this.rp2040.usbDPRAMView.getUint32(epCtrlOffset, true);
        const interval = (epCtrl >> EP_CTRL_HOST_INTERRUPT_INTERVAL_LSB & 511) + 1;
        if (this.sofFrameNumber % interval !== 0)
          continue;
        const bufCtrlOffset = HOST_INT_EP_BUF_CTRL_BASE + i * 8;
        const bufCtrl = this.rp2040.usbDPRAMView.getUint32(bufCtrlOffset, true);
        if (this.sofFrameNumber % 500 === 0) {
          this.debug(`INT_EP[${i}]: bufCtrl=0x${bufCtrl.toString(16)} available=${!!(bufCtrl & USB_BUF_CTRL_AVAILABLE)}`);
        }
        if (!(bufCtrl & USB_BUF_CTRL_AVAILABLE))
          continue;
        if (!isOut) {
          const epAddr = 128 | epNum;
          const result = this.connectedDevice.handleDataIn(epAddr);
          if (result.status === "ack" && result.data) {
            const bufferOffset = epCtrl & 65472;
            this.rp2040.usbDPRAM.set(result.data, bufferOffset);
            let newBufCtrl = bufCtrl & ~USB_BUF_CTRL_AVAILABLE;
            newBufCtrl |= USB_BUF_CTRL_FULL;
            newBufCtrl = newBufCtrl & ~USB_BUF_CTRL_LEN_MASK | result.data.length & USB_BUF_CTRL_LEN_MASK;
            this.rp2040.usbDPRAMView.setUint32(bufCtrlOffset, newBufCtrl, true);
            this.buffStatus |= 1 << (i + 1) * 2;
            this.buffStatusUpdated();
          }
        }
      }
    }
    startHostTransaction() {
      if (!this.hostMode)
        return;
      const devAddr = this.devAddrCtrl & 127;
      const epNum = this.devAddrCtrl >> 16 & 15;
      this.debug(`Host transaction: dev=${devAddr} ep=${epNum} sieCtrl=0x${this.sieCtrl.toString(16)}`);
      if (!this.connectedDevice) {
        this.sieStatus |= SIE_RX_TIMEOUT;
        this.sieStatusUpdated();
        return;
      }
      if (this.sieCtrl & SIE_CTRL_SEND_SETUP) {
        this.handleSetupTransaction(devAddr);
      } else if (this.sieCtrl & SIE_CTRL_RECEIVE_DATA) {
        this.handleInTransaction(devAddr, epNum);
      } else if (this.sieCtrl & SIE_CTRL_SEND_DATA) {
        this.handleOutTransaction(devAddr, epNum);
      }
    }
    handleSetupTransaction(_devAddr) {
      var _a, _b;
      const setupPacket = this.rp2040.usbDPRAM.slice(HOST_SETUP_PACKET, HOST_SETUP_PACKET + 8);
      const setup = parseSetupPacket(setupPacket);
      this.debug(`SETUP: bmRequestType=0x${setup.bmRequestType.toString(16)} bRequest=${setup.bRequest} wValue=0x${setup.wValue.toString(16)} wIndex=${setup.wIndex} wLength=${setup.wLength}`);
      const result = this.connectedDevice.handleSetupPacket(setupPacket);
      if (setup.bRequest === 5 && setup.type === 0) {
        const newAddr = setup.wValue & 127;
        this.connectedDevice.address = newAddr;
        (_b = (_a = this.connectedDevice).onAddressAssigned) === null || _b === void 0 ? void 0 : _b.call(_a, newAddr);
        this.debug(`Device address set to ${newAddr}`);
      }
      if (setup.direction === "in" && result.data) {
        this.pendingSetupResponse = result.data;
        this.expectingStatusPhase = false;
      } else {
        this.pendingSetupResponse = null;
        this.expectingStatusPhase = true;
      }
      this.controlDataPid = 1;
      this.sieStatus |= SIE_ACK_REC;
      this.hostTransactionAlarm.schedule(this.hostTransactionDelayMicroseconds * 1e3);
    }
    handleInTransaction(devAddr, epNum) {
      const epAddr = 128 | epNum;
      let result;
      if (epNum === 0 && this.expectingStatusPhase) {
        result = { status: "ack", data: new Uint8Array(0) };
        this.expectingStatusPhase = false;
        this.debug("Control OUT status phase (ZLP)");
      } else if (epNum === 0 && this.pendingSetupResponse) {
        result = { status: "ack", data: this.pendingSetupResponse };
        const bufCtrl = this.rp2040.usbDPRAMView.getUint32(HOST_EPX_BUF_CTRL, true);
        const maxLen = bufCtrl & USB_BUF_CTRL_LEN_MASK;
        if (result.data && result.data.length > maxLen) {
          result.data = result.data.slice(0, maxLen);
        }
        if (!result.data || result.data.length <= maxLen) {
          this.pendingSetupResponse = null;
        }
      } else {
        result = this.connectedDevice.handleDataIn(epAddr);
      }
      if (result.status === "ack" && result.data) {
        this.rp2040.usbDPRAM.set(result.data, HOST_EPX_DATA);
        let bufCtrl = this.rp2040.usbDPRAMView.getUint32(HOST_EPX_BUF_CTRL, true);
        bufCtrl &= ~USB_BUF_CTRL_LEN_MASK;
        bufCtrl |= result.data.length & USB_BUF_CTRL_LEN_MASK;
        bufCtrl |= USB_BUF_CTRL_FULL;
        bufCtrl &= ~USB_BUF_CTRL_AVAILABLE;
        if (this.controlDataPid) {
          bufCtrl |= USB_BUF_CTRL_DATA1_PID;
        } else {
          bufCtrl &= ~USB_BUF_CTRL_DATA1_PID;
        }
        this.controlDataPid ^= 1;
        this.rp2040.usbDPRAMView.setUint32(HOST_EPX_BUF_CTRL, bufCtrl, true);
        this.buffStatus |= 1;
        this.buffStatusUpdated();
        this.sieStatus |= SIE_ACK_REC;
      } else if (result.status === "nak") {
        this.sieStatus |= SIE_NAK_REC;
      } else if (result.status === "stall") {
        this.sieStatus |= SIE_STALL_REC;
      }
      this.hostTransactionAlarm.schedule(this.hostTransactionDelayMicroseconds * 1e3);
    }
    handleOutTransaction(devAddr, epNum) {
      const epAddr = epNum;
      const bufCtrl = this.rp2040.usbDPRAMView.getUint32(HOST_EPX_BUF_CTRL, true);
      const dataLen = bufCtrl & USB_BUF_CTRL_LEN_MASK;
      const data = this.rp2040.usbDPRAM.slice(HOST_EPX_DATA, HOST_EPX_DATA + dataLen);
      let result;
      if (epNum === 0 && dataLen === 0) {
        result = { status: "ack" };
      } else {
        result = this.connectedDevice.handleDataOut(epAddr, data);
      }
      let newBufCtrl = bufCtrl;
      newBufCtrl &= ~USB_BUF_CTRL_AVAILABLE;
      if (this.controlDataPid) {
        newBufCtrl |= USB_BUF_CTRL_DATA1_PID;
      } else {
        newBufCtrl &= ~USB_BUF_CTRL_DATA1_PID;
      }
      this.controlDataPid ^= 1;
      this.rp2040.usbDPRAMView.setUint32(HOST_EPX_BUF_CTRL, newBufCtrl, true);
      if (result.status === "ack") {
        this.sieStatus |= SIE_ACK_REC;
        this.buffStatus |= 1;
        this.buffStatusUpdated();
      } else if (result.status === "nak") {
        this.sieStatus |= SIE_NAK_REC;
      } else if (result.status === "stall") {
        this.sieStatus |= SIE_STALL_REC;
      }
      this.hostTransactionAlarm.schedule(this.hostTransactionDelayMicroseconds * 1e3);
    }
    completeHostTransaction() {
      this.sieCtrl &= ~SIE_CTRL_START_TRANS;
      this.sieStatus |= SIE_TRANS_COMPLETE;
      this.sieStatusUpdated();
      this.debug("Host transaction complete");
    }
  };

  // tools/programmable_simulator/node_modules/rp2040js/dist/esm/peripherals/watchdog.js
  var CTRL2 = 0;
  var LOAD = 4;
  var REASON = 8;
  var SCRATCH0 = 12;
  var SCRATCH1 = 16;
  var SCRATCH2 = 20;
  var SCRATCH3 = 24;
  var SCRATCH4 = 28;
  var SCRATCH5 = 32;
  var SCRATCH6 = 36;
  var SCRATCH7 = 40;
  var TICK = 44;
  var TRIGGER = 1 << 31;
  var ENABLE2 = 1 << 30;
  var PAUSE_DBG1 = 1 << 26;
  var PAUSE_DBG0 = 1 << 25;
  var PAUSE_JTAG = 1 << 24;
  var TIME_MASK = 16777215;
  var TIME_SHIFT = 0;
  var LOAD_MASK = 16777215;
  var LOAD_SHIFT = 0;
  var FORCE = 1 << 1;
  var TIMER = 1 << 0;
  var RUNNING = 1 << 10;
  var TICK_ENABLE = 1 << 9;
  var TICK_FREQUENCY = 2e6;
  var RPWatchdog = class extends BasePeripheral {
    // User provided
    constructor(rp2040, name) {
      super(rp2040, name);
      this.scratchData = new Uint32Array(8);
      this.enable = false;
      this.tickEnable = true;
      this.reason = 0;
      this.pauseDbg0 = true;
      this.pauseDbg1 = true;
      this.pauseJtag = true;
      this.onWatchdogTrigger = () => {
        this.rp2040.logger.warn(this.name, "Watchdog triggered, but no reset handler provided");
      };
      this.timer = new Timer32(rp2040.clock, TICK_FREQUENCY);
      this.timer.mode = TimerMode.Decrement;
      this.timer.enable = false;
      this.alarm = new Timer32PeriodicAlarm(this.timer, () => {
        var _a;
        this.reason = TIMER;
        (_a = this.onWatchdogTrigger) === null || _a === void 0 ? void 0 : _a.call(this);
      });
      this.alarm.target = 0;
      this.alarm.enable = false;
    }
    readUint32(offset) {
      switch (offset) {
        case CTRL2:
          return (this.timer.enable ? ENABLE2 : 0) | (this.pauseDbg0 ? PAUSE_DBG0 : 0) | (this.pauseDbg1 ? PAUSE_DBG1 : 0) | (this.pauseJtag ? PAUSE_JTAG : 0) | (this.timer.counter & TIME_MASK) << TIME_SHIFT;
        case REASON:
          return this.reason;
        case SCRATCH0:
        case SCRATCH1:
        case SCRATCH2:
        case SCRATCH3:
        case SCRATCH4:
        case SCRATCH5:
        case SCRATCH6:
        case SCRATCH7:
          return this.scratchData[offset - SCRATCH0 >> 2];
        case TICK:
          return this.tickEnable ? RUNNING | TICK_ENABLE : 0;
      }
      return super.readUint32(offset);
    }
    writeUint32(offset, value) {
      var _a;
      switch (offset) {
        case CTRL2:
          if (value & TRIGGER) {
            this.reason = FORCE;
            (_a = this.onWatchdogTrigger) === null || _a === void 0 ? void 0 : _a.call(this);
          }
          this.enable = !!(value & ENABLE2);
          this.timer.enable = this.enable && this.tickEnable;
          this.alarm.enable = this.enable && this.tickEnable;
          this.pauseDbg0 = !!(value & PAUSE_DBG0);
          this.pauseDbg1 = !!(value & PAUSE_DBG1);
          this.pauseJtag = !!(value & PAUSE_JTAG);
          break;
        case LOAD:
          this.timer.set(value >>> LOAD_SHIFT & LOAD_MASK);
          break;
        case SCRATCH0:
        case SCRATCH1:
        case SCRATCH2:
        case SCRATCH3:
        case SCRATCH4:
        case SCRATCH5:
        case SCRATCH6:
        case SCRATCH7:
          this.scratchData[offset - SCRATCH0 >> 2] = value;
          break;
        case TICK:
          this.tickEnable = !!(value & TICK_ENABLE);
          this.timer.enable = this.enable && this.tickEnable;
          this.alarm.enable = this.enable && this.tickEnable;
          break;
        default:
          super.writeUint32(offset, value);
      }
    }
  };

  // tools/programmable_simulator/node_modules/rp2040js/dist/esm/peripherals/xosc.js
  var XOSC_CTRL = 0;
  var XOSC_STATUS = 4;
  var XOSC_DORMANT = 8;
  var XOSC_STARTUP = 12;
  var XOSC_COUNT = 28;
  var CTRL_ENABLE_LSB = 12;
  var CTRL_ENABLE_BITS = 16773120;
  var CTRL_FREQ_RANGE_BITS = 4095;
  var CTRL_ENABLE_DISABLE = 3358;
  var CTRL_ENABLE_ENABLE = 4011;
  var STATUS_STABLE = 2147483648;
  var STATUS_BADWRITE = 16777216;
  var STATUS_ENABLED = 4096;
  var DORMANT_VALUE = 1668246881;
  var WAKE_VALUE = 2002873189;
  var STARTUP_X4 = 1048576;
  var STARTUP_DELAY_BITS = 16383;
  var RPXOSC = class extends BasePeripheral {
    constructor() {
      super(...arguments);
      this.ctrl = 0;
      this.status = 0;
      this.dormant = 0;
      this.startup = 0;
      this.count = 0;
      this.enabled = false;
      this.stable = false;
      this.isDormant = false;
    }
    readUint32(offset) {
      switch (offset) {
        case XOSC_CTRL:
          return this.ctrl;
        case XOSC_STATUS: {
          let status = this.status;
          if (this.stable) {
            status |= STATUS_STABLE;
          }
          if (this.enabled) {
            status |= STATUS_ENABLED;
          }
          return status;
        }
        case XOSC_DORMANT:
          return this.dormant;
        case XOSC_STARTUP:
          return this.startup;
        case XOSC_COUNT:
          return this.count;
      }
      return super.readUint32(offset);
    }
    writeUint32(offset, value) {
      switch (offset) {
        case XOSC_CTRL: {
          this.ctrl = value;
          const enableValue = (value & CTRL_ENABLE_BITS) >>> CTRL_ENABLE_LSB;
          const freqRange = value & CTRL_FREQ_RANGE_BITS;
          void freqRange;
          if (enableValue === CTRL_ENABLE_ENABLE) {
            if (!this.isDormant) {
              this.enabled = true;
              this.stable = true;
            }
          } else if (enableValue === CTRL_ENABLE_DISABLE) {
            this.enabled = false;
            this.stable = false;
          } else if (enableValue !== 0) {
            this.status |= STATUS_BADWRITE;
            this.warn(`Invalid ENABLE value written: 0x${enableValue.toString(16)}`);
          }
          break;
        }
        case XOSC_STATUS:
          if (value & STATUS_BADWRITE) {
            this.status &= ~STATUS_BADWRITE;
          }
          break;
        case XOSC_DORMANT:
          if (value === DORMANT_VALUE) {
            this.isDormant = true;
            this.stable = false;
          } else if (value === WAKE_VALUE) {
            this.isDormant = false;
            if (this.enabled) {
              this.stable = true;
            }
          }
          this.dormant = value;
          break;
        case XOSC_STARTUP:
          this.startup = value & (STARTUP_X4 | STARTUP_DELAY_BITS);
          break;
        case XOSC_COUNT:
          this.count = value & 255;
          break;
        default:
          super.writeUint32(offset, value);
      }
    }
  };

  // tools/programmable_simulator/node_modules/rp2040js/dist/esm/utils/bit.js
  function s32(n) {
    return n | 0;
  }
  function u32(n) {
    return n >>> 0;
  }

  // tools/programmable_simulator/node_modules/rp2040js/dist/esm/interpolator.js
  var InterpolatorConfig = class {
    constructor(value) {
      this.shift = 0;
      this.maskLSB = 0;
      this.maskMSB = 0;
      this.signed = false;
      this.crossInput = false;
      this.crossResult = false;
      this.addRaw = false;
      this.forceMSB = 0;
      this.blend = false;
      this.clamp = false;
      this.overf0 = false;
      this.overf1 = false;
      this.overf = false;
      this.shift = value >>> 0 & 31;
      this.maskLSB = value >>> 5 & 31;
      this.maskMSB = value >>> 10 & 31;
      this.signed = Boolean(value >>> 15 & 1);
      this.crossInput = Boolean(value >>> 16 & 1);
      this.crossResult = Boolean(value >>> 17 & 1);
      this.addRaw = Boolean(value >>> 18 & 1);
      this.forceMSB = value >>> 19 & 3;
      this.blend = Boolean(value >>> 21 & 1);
      this.clamp = Boolean(value >>> 22 & 1);
      this.overf0 = Boolean(value >>> 23 & 1);
      this.overf1 = Boolean(value >>> 24 & 1);
      this.overf = Boolean(value >>> 25 & 1);
    }
    toUint32() {
      return (this.shift & 31) << 0 | (this.maskLSB & 31) << 5 | (this.maskMSB & 31) << 10 | (Number(this.signed) & 1) << 15 | (Number(this.crossInput) & 1) << 16 | (Number(this.crossResult) & 1) << 17 | (Number(this.addRaw) & 1) << 18 | (this.forceMSB & 3) << 19 | (Number(this.blend) & 1) << 21 | (Number(this.clamp) & 1) << 22 | (Number(this.overf0) & 1) << 23 | (Number(this.overf1) & 1) << 24 | (Number(this.overf) & 1) << 25;
    }
  };
  var Interpolator = class {
    constructor(index) {
      this.index = index;
      this.accum0 = 0;
      this.accum1 = 0;
      this.base0 = 0;
      this.base1 = 0;
      this.base2 = 0;
      this.ctrl0 = 0;
      this.ctrl1 = 0;
      this.result0 = 0;
      this.result1 = 0;
      this.result2 = 0;
      this.smresult0 = 0;
      this.smresult1 = 0;
      this.update();
    }
    update() {
      const N = this.index;
      const ctrl0 = new InterpolatorConfig(this.ctrl0);
      const ctrl1 = new InterpolatorConfig(this.ctrl1);
      const do_clamp = ctrl0.clamp && N == 1;
      const do_blend = ctrl0.blend && N == 0;
      ctrl0.clamp = do_clamp;
      ctrl0.blend = do_blend;
      ctrl1.clamp = false;
      ctrl1.blend = false;
      ctrl1.overf0 = false;
      ctrl1.overf1 = false;
      ctrl1.overf = false;
      const input0 = s32(ctrl0.crossInput ? this.accum1 : this.accum0);
      const input1 = s32(ctrl1.crossInput ? this.accum0 : this.accum1);
      const msbmask0 = ctrl0.maskMSB == 31 ? 4294967295 : (1 << ctrl0.maskMSB + 1) - 1;
      const msbmask1 = ctrl1.maskMSB == 31 ? 4294967295 : (1 << ctrl1.maskMSB + 1) - 1;
      const mask0 = msbmask0 & ~((1 << ctrl0.maskLSB) - 1);
      const mask1 = msbmask1 & ~((1 << ctrl1.maskLSB) - 1);
      const uresult0 = input0 >>> ctrl0.shift & mask0;
      const uresult1 = input1 >>> ctrl1.shift & mask1;
      const overf0 = Boolean(input0 >>> ctrl0.shift & ~msbmask0);
      const overf1 = Boolean(input1 >>> ctrl1.shift & ~msbmask1);
      const overf = overf0 || overf1;
      const sextmask0 = uresult0 & 1 << ctrl0.maskMSB ? -1 << ctrl0.maskMSB : 0;
      const sextmask1 = uresult1 & 1 << ctrl1.maskMSB ? -1 << ctrl1.maskMSB : 0;
      const sresult0 = uresult0 | sextmask0;
      const sresult1 = uresult1 | sextmask1;
      const result0 = ctrl0.signed ? sresult0 : uresult0;
      const result1 = ctrl1.signed ? sresult1 : uresult1;
      const addresult0 = this.base0 + (ctrl0.addRaw ? input0 : result0);
      const addresult1 = this.base1 + (ctrl1.addRaw ? input1 : result1);
      const addresult2 = this.base2 + result0 + (do_blend ? 0 : result1);
      const uclamp0 = u32(result0) < u32(this.base0) ? this.base0 : u32(result0) > u32(this.base1) ? this.base1 : result0;
      const sclamp0 = s32(result0) < s32(this.base0) ? this.base0 : s32(result0) > s32(this.base1) ? this.base1 : result0;
      const clamp0 = ctrl0.signed ? sclamp0 : uclamp0;
      const alpha1 = result1 & 255;
      const ublend1 = u32(this.base0) + (Math.floor(alpha1 * (u32(this.base1) - u32(this.base0)) / 256) | 0);
      const sblend1 = s32(this.base0) + (Math.floor(alpha1 * (s32(this.base1) - s32(this.base0)) / 256) | 0);
      const blend1 = ctrl1.signed ? sblend1 : ublend1;
      this.smresult0 = u32(result0);
      this.smresult1 = u32(result1);
      this.result0 = u32(do_blend ? alpha1 : (do_clamp ? clamp0 : addresult0) | ctrl0.forceMSB << 28);
      this.result1 = u32((do_blend ? blend1 : addresult1) | ctrl0.forceMSB << 28);
      this.result2 = u32(addresult2);
      ctrl0.overf0 = overf0;
      ctrl0.overf1 = overf1;
      ctrl0.overf = overf;
      this.ctrl0 = ctrl0.toUint32();
      this.ctrl1 = ctrl1.toUint32();
    }
    writeback() {
      const ctrl0 = new InterpolatorConfig(this.ctrl0);
      const ctrl1 = new InterpolatorConfig(this.ctrl1);
      this.accum0 = u32(ctrl0.crossResult ? this.result1 : this.result0);
      this.accum1 = u32(ctrl1.crossResult ? this.result0 : this.result1);
      this.update();
    }
    setBase01(value) {
      const N = this.index;
      const ctrl0 = new InterpolatorConfig(this.ctrl0);
      const ctrl1 = new InterpolatorConfig(this.ctrl1);
      const do_blend = ctrl0.blend && N == 0;
      const input0 = value & 65535;
      const input1 = value >>> 16 & 65535;
      const sextmask0 = input0 & 1 << 15 ? -1 << 15 : 0;
      const sextmask1 = input1 & 1 << 15 ? -1 << 15 : 0;
      const base0 = (do_blend ? ctrl1.signed : ctrl0.signed) ? input0 | sextmask0 : input0;
      const base1 = ctrl1.signed ? input1 | sextmask1 : input1;
      this.base0 = u32(base0);
      this.base1 = u32(base1);
      this.update();
    }
  };

  // tools/programmable_simulator/node_modules/rp2040js/dist/esm/sio.js
  var CPUID2 = 0;
  var GPIO_IN = 4;
  var GPIO_HI_IN = 8;
  var GPIO_OUT = 16;
  var GPIO_OUT_SET = 20;
  var GPIO_OUT_CLR = 24;
  var GPIO_OUT_XOR = 28;
  var GPIO_OE = 32;
  var GPIO_OE_SET = 36;
  var GPIO_OE_CLR = 40;
  var GPIO_OE_XOR = 44;
  var GPIO_HI_OUT = 48;
  var GPIO_HI_OUT_SET = 52;
  var GPIO_HI_OUT_CLR = 56;
  var GPIO_HI_OUT_XOR = 60;
  var GPIO_HI_OE = 64;
  var GPIO_HI_OE_SET = 68;
  var GPIO_HI_OE_CLR = 72;
  var GPIO_HI_OE_XOR = 76;
  var GPIO_MASK = 1073741823;
  var DIV_UDIVIDEND = 96;
  var DIV_UDIVISOR = 100;
  var DIV_SDIVIDEND = 104;
  var DIV_SDIVISOR = 108;
  var DIV_QUOTIENT = 112;
  var DIV_REMAINDER = 116;
  var DIV_CSR = 120;
  var INTERP0_ACCUM0 = 128;
  var INTERP0_ACCUM1 = 132;
  var INTERP0_BASE0 = 136;
  var INTERP0_BASE1 = 140;
  var INTERP0_BASE2 = 144;
  var INTERP0_POP_LANE0 = 148;
  var INTERP0_POP_LANE1 = 152;
  var INTERP0_POP_FULL = 156;
  var INTERP0_PEEK_LANE0 = 160;
  var INTERP0_PEEK_LANE1 = 164;
  var INTERP0_PEEK_FULL = 168;
  var INTERP0_CTRL_LANE0 = 172;
  var INTERP0_CTRL_LANE1 = 176;
  var INTERP0_ACCUM0_ADD = 180;
  var INTERP0_ACCUM1_ADD = 184;
  var INTERP0_BASE_1AND0 = 188;
  var INTERP1_ACCUM0 = 192;
  var INTERP1_ACCUM1 = 196;
  var INTERP1_BASE0 = 200;
  var INTERP1_BASE1 = 204;
  var INTERP1_BASE2 = 208;
  var INTERP1_POP_LANE0 = 212;
  var INTERP1_POP_LANE1 = 216;
  var INTERP1_POP_FULL = 220;
  var INTERP1_PEEK_LANE0 = 224;
  var INTERP1_PEEK_LANE1 = 228;
  var INTERP1_PEEK_FULL = 232;
  var INTERP1_CTRL_LANE0 = 236;
  var INTERP1_CTRL_LANE1 = 240;
  var INTERP1_ACCUM0_ADD = 244;
  var INTERP1_ACCUM1_ADD = 248;
  var INTERP1_BASE_1AND0 = 252;
  var SPINLOCK_ST = 92;
  var SPINLOCK0 = 256;
  var SPINLOCK31 = 380;
  var RPSIO = class {
    constructor(rp2040) {
      this.rp2040 = rp2040;
      this.gpioValue = 0;
      this.gpioOutputEnable = 0;
      this.qspiGpioValue = 0;
      this.qspiGpioOutputEnable = 0;
      this.divDividend = 0;
      this.divDivisor = 1;
      this.divQuotient = 0;
      this.divRemainder = 0;
      this.divCSR = 0;
      this.spinLock = 0;
      this.interp0 = new Interpolator(0);
      this.interp1 = new Interpolator(1);
    }
    updateHardwareDivider(signed) {
      if (this.divDivisor == 0) {
        this.divQuotient = this.divDividend > 0 ? -1 : 1;
        this.divRemainder = this.divDividend;
      } else {
        if (signed) {
          this.divQuotient = (this.divDividend | 0) / (this.divDivisor | 0);
          this.divRemainder = (this.divDividend | 0) % (this.divDivisor | 0);
        } else {
          this.divQuotient = (this.divDividend >>> 0) / (this.divDivisor >>> 0);
          this.divRemainder = (this.divDividend >>> 0) % (this.divDivisor >>> 0);
        }
      }
      this.divCSR = 3;
      this.rp2040.core.cycles += 8;
    }
    readUint32(offset) {
      if (offset >= SPINLOCK0 && offset <= SPINLOCK31) {
        const bitIndexMask = 1 << (offset - SPINLOCK0) / 4;
        if (this.spinLock & bitIndexMask) {
          return 0;
        } else {
          this.spinLock |= bitIndexMask;
          return bitIndexMask;
        }
      }
      switch (offset) {
        case GPIO_IN:
          return this.rp2040.gpioValues;
        case GPIO_HI_IN: {
          const { qspi } = this.rp2040;
          let result = 0;
          for (let qspiIndex = 0; qspiIndex < qspi.length; qspiIndex++) {
            if (qspi[qspiIndex].inputValue) {
              result |= 1 << qspiIndex;
            }
          }
          return result;
        }
        case GPIO_OUT:
          return this.gpioValue;
        case GPIO_OE:
          return this.gpioOutputEnable;
        case GPIO_HI_OUT:
          return this.qspiGpioValue;
        case GPIO_HI_OE:
          return this.qspiGpioOutputEnable;
        case GPIO_OUT_SET:
        case GPIO_OUT_CLR:
        case GPIO_OUT_XOR:
        case GPIO_OE_SET:
        case GPIO_OE_CLR:
        case GPIO_OE_XOR:
        case GPIO_HI_OUT_SET:
        case GPIO_HI_OUT_CLR:
        case GPIO_HI_OUT_XOR:
        case GPIO_HI_OE_SET:
        case GPIO_HI_OE_CLR:
        case GPIO_HI_OE_XOR:
          return 0;
        // TODO verify with silicone
        case CPUID2:
          return 0;
        case SPINLOCK_ST:
          return this.spinLock;
        case DIV_UDIVIDEND:
          return this.divDividend;
        case DIV_SDIVIDEND:
          return this.divDividend;
        case DIV_UDIVISOR:
          return this.divDivisor;
        case DIV_SDIVISOR:
          return this.divDivisor;
        case DIV_QUOTIENT:
          this.divCSR &= ~2;
          return this.divQuotient;
        case DIV_REMAINDER:
          return this.divRemainder;
        case DIV_CSR:
          return this.divCSR;
        case INTERP0_ACCUM0:
          return this.interp0.accum0;
        case INTERP0_ACCUM1:
          return this.interp0.accum1;
        case INTERP0_BASE0:
          return this.interp0.base0;
        case INTERP0_BASE1:
          return this.interp0.base1;
        case INTERP0_BASE2:
          return this.interp0.base2;
        case INTERP0_CTRL_LANE0:
          return this.interp0.ctrl0;
        case INTERP0_CTRL_LANE1:
          return this.interp0.ctrl1;
        case INTERP0_PEEK_LANE0:
          return this.interp0.result0;
        case INTERP0_PEEK_LANE1:
          return this.interp0.result1;
        case INTERP0_PEEK_FULL:
          return this.interp0.result2;
        case INTERP0_POP_LANE0: {
          const value = this.interp0.result0;
          this.interp0.writeback();
          return value;
        }
        case INTERP0_POP_LANE1: {
          const value = this.interp0.result1;
          this.interp0.writeback();
          return value;
        }
        case INTERP0_POP_FULL: {
          const value = this.interp0.result2;
          this.interp0.writeback();
          return value;
        }
        case INTERP0_ACCUM0_ADD:
          return this.interp0.smresult0;
        case INTERP0_ACCUM1_ADD:
          return this.interp0.smresult1;
        case INTERP1_ACCUM0:
          return this.interp1.accum0;
        case INTERP1_ACCUM1:
          return this.interp1.accum1;
        case INTERP1_BASE0:
          return this.interp1.base0;
        case INTERP1_BASE1:
          return this.interp1.base1;
        case INTERP1_BASE2:
          return this.interp1.base2;
        case INTERP1_CTRL_LANE0:
          return this.interp1.ctrl0;
        case INTERP1_CTRL_LANE1:
          return this.interp1.ctrl1;
        case INTERP1_PEEK_LANE0:
          return this.interp1.result0;
        case INTERP1_PEEK_LANE1:
          return this.interp1.result1;
        case INTERP1_PEEK_FULL:
          return this.interp1.result2;
        case INTERP1_POP_LANE0: {
          const value = this.interp1.result0;
          this.interp1.writeback();
          return value;
        }
        case INTERP1_POP_LANE1: {
          const value = this.interp1.result1;
          this.interp1.writeback();
          return value;
        }
        case INTERP1_POP_FULL: {
          const value = this.interp1.result2;
          this.interp1.writeback();
          return value;
        }
        case INTERP1_ACCUM0_ADD:
          return this.interp1.smresult0;
        case INTERP1_ACCUM1_ADD:
          return this.interp1.smresult1;
      }
      console.warn(`Read from invalid SIO address: ${offset.toString(16)}`);
      return 4294967295;
    }
    writeUint32(offset, value) {
      if (offset >= SPINLOCK0 && offset <= SPINLOCK31) {
        const bitIndexMask = ~(1 << (offset - SPINLOCK0) / 4);
        this.spinLock &= bitIndexMask;
        return;
      }
      const prevGpioValue = this.gpioValue;
      const prevGpioOutputEnable = this.gpioOutputEnable;
      switch (offset) {
        case GPIO_OUT:
          this.gpioValue = value & GPIO_MASK;
          break;
        case GPIO_OUT_SET:
          this.gpioValue |= value & GPIO_MASK;
          break;
        case GPIO_OUT_CLR:
          this.gpioValue &= ~value;
          break;
        case GPIO_OUT_XOR:
          this.gpioValue ^= value & GPIO_MASK;
          break;
        case GPIO_OE:
          this.gpioOutputEnable = value & GPIO_MASK;
          break;
        case GPIO_OE_SET:
          this.gpioOutputEnable |= value & GPIO_MASK;
          break;
        case GPIO_OE_CLR:
          this.gpioOutputEnable &= ~value;
          break;
        case GPIO_OE_XOR:
          this.gpioOutputEnable ^= value & GPIO_MASK;
          break;
        case GPIO_HI_OUT:
          this.qspiGpioValue = value & GPIO_MASK;
          break;
        case GPIO_HI_OUT_SET:
          this.qspiGpioValue |= value & GPIO_MASK;
          break;
        case GPIO_HI_OUT_CLR:
          this.qspiGpioValue &= ~value;
          break;
        case GPIO_HI_OUT_XOR:
          this.qspiGpioValue ^= value & GPIO_MASK;
          break;
        case GPIO_HI_OE:
          this.qspiGpioOutputEnable = value & GPIO_MASK;
          break;
        case GPIO_HI_OE_SET:
          this.qspiGpioOutputEnable |= value & GPIO_MASK;
          break;
        case GPIO_HI_OE_CLR:
          this.qspiGpioOutputEnable &= ~value;
          break;
        case GPIO_HI_OE_XOR:
          this.qspiGpioOutputEnable ^= value & GPIO_MASK;
          break;
        case DIV_UDIVIDEND:
          this.divDividend = value;
          this.updateHardwareDivider(false);
          break;
        case DIV_SDIVIDEND:
          this.divDividend = value;
          this.updateHardwareDivider(true);
          break;
        case DIV_UDIVISOR:
          this.divDivisor = value;
          this.updateHardwareDivider(false);
          break;
        case DIV_SDIVISOR:
          this.divDivisor = value;
          this.updateHardwareDivider(true);
          break;
        case DIV_QUOTIENT:
          this.divQuotient = value;
          this.divCSR = 3;
          break;
        case DIV_REMAINDER:
          this.divRemainder = value;
          this.divCSR = 3;
          break;
        case INTERP0_ACCUM0:
          this.interp0.accum0 = value;
          this.interp0.update();
          break;
        case INTERP0_ACCUM1:
          this.interp0.accum1 = value;
          this.interp0.update();
          break;
        case INTERP0_BASE0:
          this.interp0.base0 = value;
          this.interp0.update();
          break;
        case INTERP0_BASE1:
          this.interp0.base1 = value;
          this.interp0.update();
          break;
        case INTERP0_BASE2:
          this.interp0.base2 = value;
          this.interp0.update();
          break;
        case INTERP0_CTRL_LANE0:
          this.interp0.ctrl0 = value;
          this.interp0.update();
          break;
        case INTERP0_CTRL_LANE1:
          this.interp0.ctrl1 = value;
          this.interp0.update();
          break;
        case INTERP0_ACCUM0_ADD:
          this.interp0.accum0 += value;
          this.interp0.update();
          break;
        case INTERP0_ACCUM1_ADD:
          this.interp0.accum1 += value;
          this.interp0.update();
          break;
        case INTERP0_BASE_1AND0:
          this.interp0.setBase01(value);
          break;
        case INTERP1_ACCUM0:
          this.interp1.accum0 = value;
          this.interp1.update();
          break;
        case INTERP1_ACCUM1:
          this.interp1.accum1 = value;
          this.interp1.update();
          break;
        case INTERP1_BASE0:
          this.interp1.base0 = value;
          this.interp1.update();
          break;
        case INTERP1_BASE1:
          this.interp1.base1 = value;
          this.interp1.update();
          break;
        case INTERP1_BASE2:
          this.interp1.base2 = value;
          this.interp1.update();
          break;
        case INTERP1_CTRL_LANE0:
          this.interp1.ctrl0 = value;
          this.interp1.update();
          break;
        case INTERP1_CTRL_LANE1:
          this.interp1.ctrl1 = value;
          this.interp1.update();
          break;
        case INTERP1_ACCUM0_ADD:
          this.interp1.accum0 += value;
          this.interp1.update();
          break;
        case INTERP1_ACCUM1_ADD:
          this.interp1.accum1 += value;
          this.interp1.update();
          break;
        case INTERP1_BASE_1AND0:
          this.interp1.setBase01(value);
          break;
        default:
          console.warn(`Write to invalid SIO address: ${offset.toString(16)}, value=${value.toString(16)}`);
      }
      const pinsToUpdate = this.gpioValue ^ prevGpioValue | this.gpioOutputEnable ^ prevGpioOutputEnable;
      if (pinsToUpdate) {
        const { gpio } = this.rp2040;
        for (let gpioIndex = 0; gpioIndex < gpio.length; gpioIndex++) {
          if (pinsToUpdate & 1 << gpioIndex) {
            gpio[gpioIndex].checkForUpdates();
          }
        }
      }
    }
  };

  // tools/programmable_simulator/node_modules/rp2040js/dist/esm/utils/time.js
  function getCurrentMicroseconds() {
    if (typeof performance != "undefined") {
      return Math.floor(performance.now() * 1e3);
    } else {
      return Math.floor(eval("require")("perf_hooks").performance.now() * 1e3);
    }
  }
  function leftPad(value, minLength, padChar = " ") {
    if (value.length < minLength) {
      value = padChar + value;
    }
    return value;
  }
  function rightPad(value, minLength, padChar = " ") {
    if (value.length < minLength) {
      value += padChar;
    }
    return value;
  }
  function formatTime(date) {
    const hours = leftPad(date.getHours().toString(), 2, "0");
    const minutes = leftPad(date.getMinutes().toString(), 2, "0");
    const seconds = leftPad(date.getSeconds().toString(), 2, "0");
    const milliseconds = rightPad(date.getMilliseconds().toString(), 3);
    return `${hours}:${minutes}:${seconds}.${milliseconds}`;
  }

  // tools/programmable_simulator/node_modules/rp2040js/dist/esm/utils/logging.js
  var LogLevel;
  (function(LogLevel2) {
    LogLevel2[LogLevel2["Debug"] = 0] = "Debug";
    LogLevel2[LogLevel2["Info"] = 1] = "Info";
    LogLevel2[LogLevel2["Warn"] = 2] = "Warn";
    LogLevel2[LogLevel2["Error"] = 3] = "Error";
  })(LogLevel || (LogLevel = {}));
  var ConsoleLogger = class {
    constructor(currentLogLevel, throwOnError = true) {
      this.currentLogLevel = currentLogLevel;
      this.throwOnError = throwOnError;
    }
    aboveLogLevel(logLevel) {
      return logLevel >= this.currentLogLevel ? true : false;
    }
    formatMessage(componentName, message) {
      const currentTime = formatTime(/* @__PURE__ */ new Date());
      return `${currentTime} [${componentName}] ${message}`;
    }
    debug(componetName, message) {
      if (this.aboveLogLevel(LogLevel.Debug)) {
        console.debug(this.formatMessage(componetName, message));
      }
    }
    warn(componetName, message) {
      if (this.aboveLogLevel(LogLevel.Warn)) {
        console.warn(this.formatMessage(componetName, message));
      }
    }
    error(componentName, message) {
      if (this.aboveLogLevel(LogLevel.Error)) {
        console.error(this.formatMessage(componentName, message));
        if (this.throwOnError) {
          throw new Error(`[${componentName}] ${message}`);
        }
      }
    }
    info(componentName, message) {
      if (this.aboveLogLevel(LogLevel.Info)) {
        console.info(this.formatMessage(componentName, message));
      }
    }
  };

  // tools/programmable_simulator/node_modules/rp2040js/dist/esm/rp2040.js
  var FLASH_START_ADDRESS = 268435456;
  var FLASH_END_ADDRESS = 335544320;
  var RAM_START_ADDRESS = 536870912;
  var APB_START_ADDRESS = 1073741824;
  var DPRAM_START_ADDRESS = 1343225856;
  var SIO_START_ADDRESS = 3489660928;
  var LOG_NAME = "RP2040";
  var KB = 1024;
  var MB = 1024 * KB;
  var MHz = 1e6;
  var RP2040 = class {
    constructor(clock = new SimulationClock()) {
      this.clock = clock;
      this.bootrom = new Uint32Array(4 * KB);
      this.sram = new Uint8Array(264 * KB);
      this.sramView = new DataView(this.sram.buffer);
      this.flash = new Uint8Array(16 * MB);
      this.flash16 = new Uint16Array(this.flash.buffer);
      this.flashView = new DataView(this.flash.buffer);
      this.usbDPRAM = new Uint8Array(4 * KB);
      this.usbDPRAMView = new DataView(this.usbDPRAM.buffer);
      this.core = new CortexM0Core(this);
      this.clkSys = 125 * MHz;
      this.clkPeri = 125 * MHz;
      this.xoscFreq = 12 * MHz;
      this.roscFreq = 6.5 * MHz;
      this.pllSys = new RPPLL(this, "PLL_SYS_BASE");
      this.pllUsb = new RPPLL(this, "PLL_USB_BASE");
      this.clocks = new RPClocks(this, "CLOCKS_BASE");
      this.ppb = new RPPPB(this, "PPB");
      this.sio = new RPSIO(this);
      this.uart = [
        new RPUART(this, "UART0", IRQ.UART0, {
          rx: DREQChannel.DREQ_UART0_RX,
          tx: DREQChannel.DREQ_UART0_TX
        }),
        new RPUART(this, "UART1", IRQ.UART1, {
          rx: DREQChannel.DREQ_UART1_RX,
          tx: DREQChannel.DREQ_UART1_TX
        })
      ];
      this.i2c = [new RPI2C(this, "I2C0", IRQ.I2C0), new RPI2C(this, "I2C1", IRQ.I2C1)];
      this.pwm = new RPPWM(this, "PWM_BASE");
      this.adc = new RPADC(this, "ADC");
      this.gpio = [
        new GPIOPin(this, 0),
        new GPIOPin(this, 1),
        new GPIOPin(this, 2),
        new GPIOPin(this, 3),
        new GPIOPin(this, 4),
        new GPIOPin(this, 5),
        new GPIOPin(this, 6),
        new GPIOPin(this, 7),
        new GPIOPin(this, 8),
        new GPIOPin(this, 9),
        new GPIOPin(this, 10),
        new GPIOPin(this, 11),
        new GPIOPin(this, 12),
        new GPIOPin(this, 13),
        new GPIOPin(this, 14),
        new GPIOPin(this, 15),
        new GPIOPin(this, 16),
        new GPIOPin(this, 17),
        new GPIOPin(this, 18),
        new GPIOPin(this, 19),
        new GPIOPin(this, 20),
        new GPIOPin(this, 21),
        new GPIOPin(this, 22),
        new GPIOPin(this, 23),
        new GPIOPin(this, 24),
        new GPIOPin(this, 25),
        new GPIOPin(this, 26),
        new GPIOPin(this, 27),
        new GPIOPin(this, 28),
        new GPIOPin(this, 29)
      ];
      this.qspi = [
        new GPIOPin(this, 0, "SCLK"),
        new GPIOPin(this, 1, "SS"),
        new GPIOPin(this, 2, "SD0"),
        new GPIOPin(this, 3, "SD1"),
        new GPIOPin(this, 4, "SD2"),
        new GPIOPin(this, 5, "SD3")
      ];
      this.dma = new RPDMA(this, "DMA");
      this.pio = [
        new RPPIO(this, "PIO0", IRQ.PIO0_IRQ0, 0),
        new RPPIO(this, "PIO1", IRQ.PIO1_IRQ0, 1)
      ];
      this.usbCtrl = new RPUSBController(this, "USB");
      this.spi = [
        new RPSPI(this, "SPI0", IRQ.SPI0, {
          rx: DREQChannel.DREQ_SPI0_RX,
          tx: DREQChannel.DREQ_SPI0_TX
        }),
        new RPSPI(this, "SPI1", IRQ.SPI1, {
          rx: DREQChannel.DREQ_SPI1_RX,
          tx: DREQChannel.DREQ_SPI1_TX
        })
      ];
      this.logger = new ConsoleLogger(LogLevel.Debug, true);
      this.clockListeners = /* @__PURE__ */ new Set();
      this.peripherals = {
        98304: new RPSSI(this, "SSI"),
        262144: new RP2040SysInfo(this, "SYSINFO_BASE"),
        262148: new RP2040SysCfg(this, "SYSCFG"),
        262152: this.clocks,
        262156: new RPReset(this, "RESETS_BASE"),
        262160: new RPPSM(this, "PSM_BASE"),
        262164: new RPIO(this, "IO_BANK0_BASE"),
        262168: new UnimplementedPeripheral(this, "IO_QSPI_BASE"),
        262172: new RPPADS(this, "PADS_BANK0_BASE", "bank0"),
        262176: new RPPADS(this, "PADS_QSPI_BASE", "qspi"),
        262180: new RPXOSC(this, "XOSC_BASE"),
        262184: this.pllSys,
        262188: this.pllUsb,
        262192: new RPBUSCTRL(this, "BUSCTRL_BASE"),
        262196: this.uart[0],
        262200: this.uart[1],
        262204: this.spi[0],
        262208: this.spi[1],
        262212: this.i2c[0],
        262216: this.i2c[1],
        262220: this.adc,
        262224: this.pwm,
        262228: new RPTimer(this, "TIMER_BASE"),
        262232: new RPWatchdog(this, "WATCHDOG_BASE"),
        262236: new RP2040RTC(this, "RTC_BASE"),
        262240: new UnimplementedPeripheral(this, "ROSC_BASE"),
        262244: new UnimplementedPeripheral(this, "VREG_AND_CHIP_RESET_BASE"),
        262252: new RPTBMAN(this, "TBMAN_BASE"),
        327680: this.dma,
        327952: this.usbCtrl,
        328192: this.pio[0],
        328448: this.pio[1]
      };
      this.onBreak = (code) => {
      };
      this.reset();
    }
    loadBootrom(bootromData) {
      this.bootrom.set(bootromData);
      this.reset();
    }
    reset() {
      this.core.reset();
      this.pwm.reset();
      this.flash.fill(255);
    }
    readUint32(address) {
      address = address >>> 0;
      if (address & 3) {
        this.logger.error(LOG_NAME, `read from address ${address.toString(16)}, which is not 32 bit aligned`);
      }
      const { bootrom } = this;
      if (address < bootrom.length * 4) {
        return bootrom[address / 4];
      } else if (address >= FLASH_START_ADDRESS && address < FLASH_END_ADDRESS) {
        const offset = address & 16777215;
        if (offset + 3 < this.flash.length) {
          return this.flashView.getUint32(offset, true);
        }
      } else if (address >= RAM_START_ADDRESS && address + 3 < RAM_START_ADDRESS + this.sram.length) {
        return this.sramView.getUint32(address - RAM_START_ADDRESS, true);
      } else if (address >= DPRAM_START_ADDRESS && address + 3 < DPRAM_START_ADDRESS + this.usbDPRAM.length) {
        return this.usbDPRAMView.getUint32(address - DPRAM_START_ADDRESS, true);
      } else if (address >>> 12 === 917518) {
        return this.ppb.readUint32(address & 4095);
      } else if (address >= SIO_START_ADDRESS && address < SIO_START_ADDRESS + 268435456) {
        return this.sio.readUint32(address - SIO_START_ADDRESS);
      }
      const peripheral = this.findPeripheral(address);
      if (peripheral) {
        return peripheral.readUint32(address & 16383);
      }
      this.logger.warn(LOG_NAME, `Read from invalid memory address: ${address.toString(16)}`);
      return 4294967295;
    }
    /**
     * Recomputes `clkSys` and `clkPeri` from the PLL and CLOCKS registers and updates the
     * peripherals derived from them. Until firmware configures the clock tree, each keeps its default.
     */
    updateClocks() {
      this.updateClkSys();
      this.updateClkPeri();
    }
    updateClkSys() {
      const clkSys = this.clocks.sysFreq;
      if (!clkSys || clkSys === this.clkSys) {
        return;
      }
      const oldClkSys = this.clkSys;
      this.clkSys = clkSys;
      this.ppb.systickTimer.frequency = clkSys;
      for (const channel of this.pwm.channels) {
        channel.timer.frequency = this.pwm.clockFreq;
      }
      for (const listener of this.clockListeners) {
        listener(clkSys, oldClkSys);
      }
    }
    updateClkPeri() {
      const clkPeri = this.clocks.periFreq;
      if (!clkPeri || clkPeri === this.clkPeri) {
        return;
      }
      this.clkPeri = clkPeri;
      for (const uart of this.uart) {
        uart.clkPeriChanged();
      }
    }
    /** Registers a listener to be notified whenever clk_sys changes. Returns an unsubscribe function. */
    addClockListener(listener) {
      this.clockListeners.add(listener);
      return () => this.clockListeners.delete(listener);
    }
    findPeripheral(address) {
      return this.peripherals[address >>> 14 << 2];
    }
    /** We assume the address is 16-bit aligned */
    readUint16(address) {
      if (address >= FLASH_START_ADDRESS && address + 1 < FLASH_START_ADDRESS + this.flash.length) {
        return this.flashView.getUint16(address - FLASH_START_ADDRESS, true);
      } else if (address >= RAM_START_ADDRESS && address + 1 < RAM_START_ADDRESS + this.sram.length) {
        return this.sramView.getUint16(address - RAM_START_ADDRESS, true);
      }
      const value = this.readUint32(address & 4294967292);
      return address & 2 ? (value & 4294901760) >>> 16 : value & 65535;
    }
    readUint8(address) {
      if (address >= FLASH_START_ADDRESS && address < FLASH_START_ADDRESS + this.flash.length) {
        return this.flash[address - FLASH_START_ADDRESS];
      } else if (address >= RAM_START_ADDRESS && address < RAM_START_ADDRESS + this.sram.length) {
        return this.sram[address - RAM_START_ADDRESS];
      }
      const value = this.readUint16(address & 4294967294);
      return (address & 1 ? (value & 65280) >>> 8 : value & 255) >>> 0;
    }
    writeUint32(address, value) {
      address = address >>> 0;
      const { bootrom } = this;
      const peripheral = this.findPeripheral(address);
      if (peripheral) {
        const atomicType = (address & 12288) >> 12;
        const offset = address & 4095;
        peripheral.writeUint32Atomic(offset, value, atomicType);
      } else if (address < bootrom.length * 4) {
        bootrom[address / 4] = value;
      } else if (address >= FLASH_START_ADDRESS && address + 3 < FLASH_START_ADDRESS + this.flash.length) {
        this.flashView.setUint32(address - FLASH_START_ADDRESS, value, true);
      } else if (address >= RAM_START_ADDRESS && address + 3 < RAM_START_ADDRESS + this.sram.length) {
        this.sramView.setUint32(address - RAM_START_ADDRESS, value, true);
      } else if (address >= DPRAM_START_ADDRESS && address + 3 < DPRAM_START_ADDRESS + this.usbDPRAM.length) {
        const offset = address - DPRAM_START_ADDRESS;
        this.usbDPRAMView.setUint32(offset, value, true);
        this.usbCtrl.DPRAMUpdated(offset, value);
      } else if (address >= SIO_START_ADDRESS && address < SIO_START_ADDRESS + 268435456) {
        this.sio.writeUint32(address - SIO_START_ADDRESS, value);
      } else if (address >>> 12 === 917518) {
        this.ppb.writeUint32(address & 4095, value);
      } else {
        this.logger.warn(LOG_NAME, `Write to undefined address: ${address.toString(16)}`);
      }
    }
    writeUint8(address, value) {
      if (address >= RAM_START_ADDRESS && address < RAM_START_ADDRESS + this.sram.length) {
        this.sram[address - RAM_START_ADDRESS] = value;
        return;
      }
      const alignedAddress = (address & 4294967292) >>> 0;
      const offset = address & 3;
      const peripheral = this.findPeripheral(address);
      if (peripheral) {
        const atomicType = (alignedAddress & 12288) >> 12;
        const offset2 = alignedAddress & 4095;
        peripheral.writeUint32Atomic(offset2, value & 255 | (value & 255) << 8 | (value & 255) << 16 | (value & 255) << 24, atomicType);
        return;
      }
      const originalValue = this.readUint32(alignedAddress);
      const newValue = new Uint32Array([originalValue]);
      new DataView(newValue.buffer).setUint8(offset, value);
      this.writeUint32(alignedAddress, newValue[0]);
    }
    writeUint16(address, value) {
      if (address >= RAM_START_ADDRESS && address + 1 < RAM_START_ADDRESS + this.sram.length) {
        this.sramView.setUint16(address - RAM_START_ADDRESS, value, true);
        return;
      }
      const alignedAddress = (address & 4294967292) >>> 0;
      const offset = address & 3;
      const peripheral = this.findPeripheral(address);
      if (peripheral) {
        const atomicType = (alignedAddress & 12288) >> 12;
        const offset2 = alignedAddress & 4095;
        peripheral.writeUint32Atomic(offset2, value & 65535 | (value & 65535) << 16, atomicType);
        return;
      }
      if (offset === 3) {
        this.writeUint8(address, value & 255);
        this.writeUint8(address + 1, value >> 8 & 255);
        return;
      }
      const originalValue = this.readUint32(alignedAddress);
      const newValue = new Uint32Array([originalValue]);
      new DataView(newValue.buffer).setUint16(offset, value, true);
      this.writeUint32(alignedAddress, newValue[0]);
    }
    get gpioValues() {
      const { gpio } = this;
      let result = 0;
      for (let gpioIndex = 0; gpioIndex < gpio.length; gpioIndex++) {
        if (gpio[gpioIndex].inputValue) {
          result |= 1 << gpioIndex;
        }
      }
      return result;
    }
    setInterrupt(irq, value) {
      this.core.setInterrupt(irq, value);
    }
    updateIOInterrupt() {
      let interruptValue = false;
      for (const pin of this.gpio) {
        if (pin.irqValue) {
          interruptValue = true;
        }
      }
      this.setInterrupt(IRQ.IO_BANK0, interruptValue);
    }
    step() {
      this.core.executeInstruction();
    }
  };

  // tools/programmable_simulator/node_modules/rp2040js/dist/esm/cortex-m0-core.js
  var EXC_RESET = 1;
  var EXC_NMI = 2;
  var EXC_HARDFAULT = 3;
  var EXC_SVCALL = 11;
  var EXC_PENDSV = 14;
  var EXC_SYSTICK = 15;
  var SYSM_APSR = 0;
  var SYSM_XPSR = 3;
  var SYSM_IPSR = 5;
  var SYSM_MSP = 8;
  var SYSM_PSP = 9;
  var SYSM_PRIMASK = 16;
  var SYSM_CONTROL = 20;
  var LOWEST_PRIORITY = 4;
  var ExecutionMode;
  (function(ExecutionMode2) {
    ExecutionMode2[ExecutionMode2["Mode_Thread"] = 0] = "Mode_Thread";
    ExecutionMode2[ExecutionMode2["Mode_Handler"] = 1] = "Mode_Handler";
  })(ExecutionMode || (ExecutionMode = {}));
  function signExtend8(value) {
    return value << 24 >> 24;
  }
  function signExtend16(value) {
    return value << 16 >> 16;
  }
  var spRegister = 13;
  var pcRegister = 15;
  var StackPointerBank;
  (function(StackPointerBank2) {
    StackPointerBank2[StackPointerBank2["SPmain"] = 0] = "SPmain";
    StackPointerBank2[StackPointerBank2["SPprocess"] = 1] = "SPprocess";
  })(StackPointerBank || (StackPointerBank = {}));
  var LOG_NAME2 = "CortexM0Core";
  var CortexM0Core = class {
    constructor(rp2040) {
      this.rp2040 = rp2040;
      this.registers = new Uint32Array(16);
      this.bankedSP = 0;
      this.cycles = 0;
      this.eventRegistered = false;
      this.waiting = false;
      this.N = false;
      this.C = false;
      this.Z = false;
      this.V = false;
      this.breakRewind = 0;
      this.PM = false;
      this.SPSEL = StackPointerBank.SPmain;
      this.nPRIV = false;
      this.currentMode = ExecutionMode.Mode_Thread;
      this.IPSR = 0;
      this.interruptNMIMask = 0;
      this.pendingInterrupts = 0;
      this.enabledInterrupts = 0;
      this.interruptPriorities = [4294967295, 0, 0, 0];
      this.pendingNMI = false;
      this.pendingPendSV = false;
      this.pendingSVCall = false;
      this.pendingSystick = false;
      this.interruptsUpdated = false;
      this.VTOR = 0;
      this.SHPR2 = 0;
      this.SHPR3 = 0;
      this.blTaken = (core, blx) => {
        void core;
        void blx;
      };
      this.SP = 4294967292;
      this.bankedSP = 4294967292;
    }
    get logger() {
      return this.rp2040.logger;
    }
    reset() {
      this.SP = this.rp2040.readUint32(this.VTOR);
      this.PC = this.rp2040.readUint32(this.VTOR + 4) & 4294967294;
      this.cycles = 0;
    }
    get SP() {
      return this.registers[13];
    }
    set SP(value) {
      this.registers[13] = value & ~3;
    }
    get LR() {
      return this.registers[14];
    }
    set LR(value) {
      this.registers[14] = value;
    }
    get PC() {
      return this.registers[15];
    }
    set PC(value) {
      this.registers[15] = value;
    }
    get APSR() {
      return (this.N ? 2147483648 : 0) | (this.Z ? 1073741824 : 0) | (this.C ? 536870912 : 0) | (this.V ? 268435456 : 0);
    }
    set APSR(value) {
      this.N = !!(value & 2147483648);
      this.Z = !!(value & 1073741824);
      this.C = !!(value & 536870912);
      this.V = !!(value & 268435456);
    }
    get xPSR() {
      return this.APSR | this.IPSR | 1 << 24;
    }
    set xPSR(value) {
      this.APSR = value;
      this.IPSR = value & 63;
    }
    checkCondition(cond) {
      let result = false;
      switch (cond >> 1) {
        case 0:
          result = this.Z;
          break;
        case 1:
          result = this.C;
          break;
        case 2:
          result = this.N;
          break;
        case 3:
          result = this.V;
          break;
        case 4:
          result = this.C && !this.Z;
          break;
        case 5:
          result = this.N === this.V;
          break;
        case 6:
          result = this.N === this.V && !this.Z;
          break;
        case 7:
          result = true;
          break;
      }
      return cond & 1 && cond != 15 ? !result : result;
    }
    readUint32(address) {
      return this.rp2040.readUint32(address);
    }
    readUint16(address) {
      return this.rp2040.readUint16(address);
    }
    readUint8(address) {
      return this.rp2040.readUint8(address);
    }
    writeUint32(address, value) {
      this.rp2040.writeUint32(address, value);
    }
    writeUint16(address, value) {
      this.rp2040.writeUint16(address, value);
    }
    writeUint8(address, value) {
      this.rp2040.writeUint8(address, value);
    }
    switchStack(stack) {
      if (this.SPSEL !== stack) {
        const temp = this.SP;
        this.SP = this.bankedSP;
        this.bankedSP = temp;
        this.SPSEL = stack;
      }
    }
    get SPprocess() {
      return this.SPSEL === StackPointerBank.SPprocess ? this.SP : this.bankedSP;
    }
    set SPprocess(value) {
      if (this.SPSEL === StackPointerBank.SPprocess) {
        this.SP = value;
      } else {
        this.bankedSP = value >>> 0;
      }
    }
    get SPmain() {
      return this.SPSEL === StackPointerBank.SPmain ? this.SP : this.bankedSP;
    }
    set SPmain(value) {
      if (this.SPSEL === StackPointerBank.SPmain) {
        this.SP = value;
      } else {
        this.bankedSP = value >>> 0;
      }
    }
    exceptionEntry(exceptionNumber) {
      let framePtr = 0;
      let framePtrAlign = 0;
      if (this.SPSEL && this.currentMode === ExecutionMode.Mode_Thread) {
        framePtrAlign = this.SPprocess & 4 ? 1 : 0;
        this.SPprocess = this.SPprocess - 32 & ~4;
        framePtr = this.SPprocess;
      } else {
        framePtrAlign = this.SPmain & 4 ? 1 : 0;
        this.SPmain = this.SPmain - 32 & ~4;
        framePtr = this.SPmain;
      }
      this.writeUint32(framePtr, this.registers[0]);
      this.writeUint32(framePtr + 4, this.registers[1]);
      this.writeUint32(framePtr + 8, this.registers[2]);
      this.writeUint32(framePtr + 12, this.registers[3]);
      this.writeUint32(framePtr + 16, this.registers[12]);
      this.writeUint32(framePtr + 20, this.LR);
      this.writeUint32(framePtr + 24, this.PC & ~1);
      this.writeUint32(framePtr + 28, this.xPSR & ~(1 << 9) | framePtrAlign << 9);
      if (this.currentMode == ExecutionMode.Mode_Handler) {
        this.LR = 4294967281;
      } else {
        if (!this.SPSEL) {
          this.LR = 4294967289;
        } else {
          this.LR = 4294967293;
        }
      }
      this.currentMode = ExecutionMode.Mode_Handler;
      this.IPSR = exceptionNumber;
      this.switchStack(StackPointerBank.SPmain);
      this.eventRegistered = true;
      const vectorTable = this.VTOR;
      this.PC = this.readUint32(vectorTable + 4 * exceptionNumber);
    }
    exceptionReturn(excReturn) {
      let framePtr = this.SPmain;
      switch (excReturn & 15) {
        case 1:
          this.currentMode = ExecutionMode.Mode_Handler;
          this.switchStack(StackPointerBank.SPmain);
          break;
        case 9:
          this.currentMode = ExecutionMode.Mode_Thread;
          this.switchStack(StackPointerBank.SPmain);
          break;
        case 13:
          framePtr = this.SPprocess;
          this.currentMode = ExecutionMode.Mode_Thread;
          this.switchStack(StackPointerBank.SPprocess);
          break;
      }
      this.registers[0] = this.readUint32(framePtr);
      this.registers[1] = this.readUint32(framePtr + 4);
      this.registers[2] = this.readUint32(framePtr + 8);
      this.registers[3] = this.readUint32(framePtr + 12);
      this.registers[12] = this.readUint32(framePtr + 16);
      this.LR = this.readUint32(framePtr + 20);
      this.PC = this.readUint32(framePtr + 24);
      const psr = this.readUint32(framePtr + 28);
      const framePtrAlign = psr & 1 << 9 ? 4 : 0;
      switch (excReturn & 15) {
        case 1:
          this.SPmain = this.SPmain + 32 | framePtrAlign;
          break;
        case 9:
          this.SPmain = this.SPmain + 32 | framePtrAlign;
          break;
        case 13:
          this.SPprocess = this.SPprocess + 32 | framePtrAlign;
          break;
      }
      this.APSR = psr & 4026531840;
      const forceThread = this.currentMode == ExecutionMode.Mode_Thread && this.nPRIV;
      this.IPSR = forceThread ? 0 : psr & 63;
      this.interruptsUpdated = true;
      this.eventRegistered = true;
    }
    get pendSVPriority() {
      return this.SHPR3 >> 22 & 3;
    }
    get svCallPriority() {
      return this.SHPR2 >>> 30;
    }
    get systickPriority() {
      return this.SHPR3 >>> 30;
    }
    exceptionPriority(n) {
      switch (n) {
        case EXC_RESET:
          return -3;
        case EXC_NMI:
          return -2;
        case EXC_HARDFAULT:
          return -1;
        case EXC_SVCALL:
          return this.svCallPriority;
        case EXC_PENDSV:
          return this.pendSVPriority;
        case EXC_SYSTICK:
          return this.systickPriority;
        default: {
          if (n < 16) {
            return LOWEST_PRIORITY;
          }
          const intNum = n - 16;
          for (let priority = 0; priority < 4; priority++) {
            if (this.interruptPriorities[priority] & 1 << intNum) {
              return priority;
            }
          }
          return LOWEST_PRIORITY;
        }
      }
    }
    get vectPending() {
      if (this.pendingNMI) {
        return EXC_NMI;
      }
      const { svCallPriority, systickPriority, pendSVPriority, pendingInterrupts } = this;
      for (let priority = 0; priority < LOWEST_PRIORITY; priority++) {
        const levelInterrupts = pendingInterrupts & this.interruptPriorities[priority];
        if (this.pendingSVCall && priority === svCallPriority) {
          return EXC_SVCALL;
        }
        if (this.pendingPendSV && priority === pendSVPriority) {
          return EXC_PENDSV;
        }
        if (this.pendingSystick && priority === systickPriority) {
          return EXC_SYSTICK;
        }
        if (levelInterrupts) {
          for (let interruptNumber = 0; interruptNumber < 32; interruptNumber++) {
            if (levelInterrupts & 1 << interruptNumber) {
              return 16 + interruptNumber;
            }
          }
        }
      }
      return 0;
    }
    setInterrupt(irq, value) {
      const irqBit = 1 << irq;
      if (value && !(this.pendingInterrupts & irqBit)) {
        this.pendingInterrupts |= irqBit;
        this.interruptsUpdated = true;
        if (this.waiting && this.checkForInterrupts()) {
          this.waiting = false;
        }
      } else if (!value) {
        this.pendingInterrupts &= ~irqBit;
      }
    }
    checkForInterrupts() {
      const currentPriority = this.waiting ? this.PM ? this.exceptionPriority(this.IPSR) : LOWEST_PRIORITY : Math.min(this.exceptionPriority(this.IPSR), this.PM ? 0 : LOWEST_PRIORITY);
      const interruptSet = this.pendingInterrupts & this.enabledInterrupts;
      const { svCallPriority, systickPriority, pendSVPriority } = this;
      if (this.pendingNMI) {
        this.pendingNMI = false;
        this.exceptionEntry(EXC_NMI);
        return true;
      }
      for (let priority = 0; priority < currentPriority; priority++) {
        const levelInterrupts = interruptSet & this.interruptPriorities[priority];
        if (this.pendingSVCall && priority === svCallPriority) {
          this.pendingSVCall = false;
          this.exceptionEntry(EXC_SVCALL);
          return true;
        }
        if (this.pendingPendSV && priority === pendSVPriority) {
          this.pendingPendSV = false;
          this.exceptionEntry(EXC_PENDSV);
          return true;
        }
        if (this.pendingSystick && priority === systickPriority) {
          this.pendingSystick = false;
          this.exceptionEntry(EXC_SYSTICK);
          return true;
        }
        if (levelInterrupts) {
          for (let interruptNumber = 0; interruptNumber < 32; interruptNumber++) {
            if (levelInterrupts & 1 << interruptNumber) {
              if (interruptNumber > MAX_HARDWARE_IRQ) {
                this.pendingInterrupts &= ~(1 << interruptNumber);
              }
              this.exceptionEntry(16 + interruptNumber);
              return true;
            }
          }
        }
      }
      this.interruptsUpdated = false;
      return false;
    }
    readSpecialRegister(sysm) {
      switch (sysm) {
        case SYSM_APSR:
          return this.APSR;
        case SYSM_XPSR:
          return this.xPSR;
        case SYSM_IPSR:
          return this.IPSR;
        case SYSM_PRIMASK:
          return this.PM ? 1 : 0;
        case SYSM_MSP:
          return this.SPmain;
        case SYSM_PSP:
          return this.SPprocess;
        case SYSM_CONTROL:
          return (this.SPSEL === StackPointerBank.SPprocess ? 2 : 0) | (this.nPRIV ? 1 : 0);
        default:
          this.logger.warn(LOG_NAME2, `MRS with unimplemented SYSm value: ${sysm}`);
          return 0;
      }
    }
    writeSpecialRegister(sysm, value) {
      switch (sysm) {
        case SYSM_APSR:
          this.APSR = value;
          break;
        case SYSM_XPSR:
          this.xPSR = value;
          break;
        case SYSM_IPSR:
          this.IPSR = value;
          break;
        case SYSM_PRIMASK:
          this.PM = !!(value & 1);
          this.interruptsUpdated = true;
          break;
        case SYSM_MSP:
          this.SPmain = value;
          break;
        case SYSM_PSP:
          this.SPprocess = value;
          break;
        case SYSM_CONTROL:
          this.nPRIV = !!(value & 1);
          if (this.currentMode === ExecutionMode.Mode_Thread) {
            this.switchStack(value & 2 ? StackPointerBank.SPprocess : StackPointerBank.SPmain);
          }
          break;
        default:
          this.logger.warn(LOG_NAME2, `MRS with unimplemented SYSm value: ${sysm}`);
          return 0;
      }
    }
    BXWritePC(address) {
      if (this.currentMode == ExecutionMode.Mode_Handler && address >>> 28 == 15) {
        this.exceptionReturn(address & 268435455);
      } else {
        this.PC = address & ~1;
      }
    }
    substractUpdateFlags(minuend, subtrahend) {
      const result = minuend - subtrahend;
      this.N = !!(result & 2147483648);
      this.Z = (result & 4294967295) === 0;
      this.C = minuend >= subtrahend;
      this.V = !!(result & 2147483648) && !(minuend & 2147483648) && !!(subtrahend & 2147483648) || !(result & 2147483648) && !!(minuend & 2147483648) && !(subtrahend & 2147483648);
      return result;
    }
    addUpdateFlags(addend1, addend2) {
      const unsignedSum = addend1 + addend2 >>> 0;
      const signedSum = (addend1 | 0) + (addend2 | 0);
      const result = addend1 + addend2;
      this.N = !!(result & 2147483648);
      this.Z = (result & 4294967295) === 0;
      this.C = result === unsignedSum ? false : true;
      this.V = (result | 0) === signedSum ? false : true;
      return result & 4294967295;
    }
    cyclesIO(addr, write = false) {
      addr = addr >>> 0;
      if (addr >= SIO_START_ADDRESS && addr < SIO_START_ADDRESS + 268435456) {
        return 0;
      }
      if (addr >= APB_START_ADDRESS && addr < APB_START_ADDRESS + 268435456) {
        return write ? 4 : 3;
      }
      return 1;
    }
    executeInstruction() {
      if (this.interruptsUpdated) {
        if (this.checkForInterrupts()) {
          this.waiting = false;
        }
      }
      const opcodePC = this.PC & ~1;
      const opcode = this.readUint16(opcodePC);
      const wideInstruction = opcode >> 12 === 15 || opcode >> 11 === 29;
      const opcode2 = wideInstruction ? this.readUint16(opcodePC + 2) : 0;
      this.PC += 2;
      let deltaCycles = 1;
      if (opcode >> 6 === 261) {
        const Rm = opcode >> 3 & 7;
        const Rdn = opcode & 7;
        this.registers[Rdn] = this.addUpdateFlags(this.registers[Rm], this.registers[Rdn] + (this.C ? 1 : 0));
      } else if (opcode >> 11 === 21) {
        const imm8 = opcode & 255;
        const Rd = opcode >> 8 & 7;
        this.registers[Rd] = this.SP + (imm8 << 2);
      } else if (opcode >> 7 === 352) {
        const imm32 = (opcode & 127) << 2;
        this.SP += imm32;
      } else if (opcode >> 9 === 14) {
        const imm3 = opcode >> 6 & 7;
        const Rn = opcode >> 3 & 7;
        const Rd = opcode & 7;
        this.registers[Rd] = this.addUpdateFlags(this.registers[Rn], imm3);
      } else if (opcode >> 11 === 6) {
        const imm8 = opcode & 255;
        const Rdn = opcode >> 8 & 7;
        this.registers[Rdn] = this.addUpdateFlags(this.registers[Rdn], imm8);
      } else if (opcode >> 9 === 12) {
        const Rm = opcode >> 6 & 7;
        const Rn = opcode >> 3 & 7;
        const Rd = opcode & 7;
        this.registers[Rd] = this.addUpdateFlags(this.registers[Rn], this.registers[Rm]);
      } else if (opcode >> 8 === 68) {
        const Rm = opcode >> 3 & 15;
        const Rdn = (opcode & 128) >> 4 | opcode & 7;
        const leftValue = Rdn === pcRegister ? this.PC + 2 : this.registers[Rdn];
        const rightValue = Rm === pcRegister ? this.PC + 2 : this.registers[Rm];
        const result = leftValue + rightValue;
        if (Rdn !== spRegister && Rdn !== pcRegister) {
          this.registers[Rdn] = result;
        } else if (Rdn === pcRegister) {
          this.registers[Rdn] = result & ~1;
          deltaCycles++;
        } else if (Rdn === spRegister) {
          this.registers[Rdn] = result & ~3;
        }
      } else if (opcode >> 11 === 20) {
        const imm8 = opcode & 255;
        const Rd = opcode >> 8 & 7;
        this.registers[Rd] = (opcodePC & 4294967292) + 4 + (imm8 << 2);
      } else if (opcode >> 6 === 256) {
        const Rm = opcode >> 3 & 7;
        const Rdn = opcode & 7;
        const result = this.registers[Rdn] & this.registers[Rm];
        this.registers[Rdn] = result;
        this.N = !!(result & 2147483648);
        this.Z = (result & 4294967295) === 0;
      } else if (opcode >> 11 === 2) {
        const imm5 = opcode >> 6 & 31;
        const Rm = opcode >> 3 & 7;
        const Rd = opcode & 7;
        const input = this.registers[Rm];
        const shiftN = imm5 ? imm5 : 32;
        const result = shiftN < 32 ? input >> shiftN : (input & 2147483648) >> 31;
        this.registers[Rd] = result;
        this.N = !!(result & 2147483648);
        this.Z = (result & 4294967295) === 0;
        this.C = input & 1 << shiftN - 1 ? true : false;
      } else if (opcode >> 6 === 260) {
        const Rm = opcode >> 3 & 7;
        const Rdn = opcode & 7;
        const input = this.registers[Rdn];
        const shiftN = (this.registers[Rm] & 255) < 32 ? this.registers[Rm] & 255 : 32;
        const result = shiftN < 32 ? input >> shiftN : (input & 2147483648) >> 31;
        this.registers[Rdn] = result;
        this.N = !!(result & 2147483648);
        this.Z = (result & 4294967295) === 0;
        this.C = input & 1 << shiftN - 1 ? true : false;
      } else if (opcode >> 12 === 13 && (opcode >> 9 & 7) !== 7) {
        let imm8 = (opcode & 255) << 1;
        const cond = opcode >> 8 & 15;
        if (imm8 & 1 << 8) {
          imm8 = (imm8 & 511) - 512;
        }
        if (this.checkCondition(cond)) {
          this.PC += imm8 + 2;
          deltaCycles++;
        }
      } else if (opcode >> 11 === 28) {
        let imm11 = (opcode & 2047) << 1;
        if (imm11 & 1 << 11) {
          imm11 = (imm11 & 2047) - 2048;
        }
        this.PC += imm11 + 2;
        deltaCycles++;
      } else if (opcode >> 6 === 270) {
        const Rm = opcode >> 3 & 7;
        const Rdn = opcode & 7;
        const result = this.registers[Rdn] &= ~this.registers[Rm];
        this.N = !!(result & 2147483648);
        this.Z = result === 0;
      } else if (opcode >> 8 === 190) {
        const imm8 = opcode & 255;
        this.breakRewind = 2;
        this.rp2040.onBreak(imm8);
      } else if (opcode >> 11 === 30 && opcode2 >> 14 === 3 && (opcode2 >> 12 & 1) == 1) {
        const imm11 = opcode2 & 2047;
        const J2 = opcode2 >> 11 & 1;
        const J1 = opcode2 >> 13 & 1;
        const imm10 = opcode & 1023;
        const S = opcode >> 10 & 1;
        const I1 = 1 - (S ^ J1);
        const I2 = 1 - (S ^ J2);
        const imm32 = (S ? 255 : 0) << 24 | (I1 << 23 | I2 << 22 | imm10 << 12 | imm11 << 1);
        this.LR = this.PC + 2 | 1;
        this.PC += 2 + imm32;
        deltaCycles += 2;
        this.blTaken(this, false);
      } else if (opcode >> 7 === 143 && (opcode & 7) === 0) {
        const Rm = opcode >> 3 & 15;
        this.LR = this.PC | 1;
        this.PC = this.registers[Rm] & ~1;
        deltaCycles++;
        this.blTaken(this, true);
      } else if (opcode >> 7 === 142 && (opcode & 7) === 0) {
        const Rm = opcode >> 3 & 15;
        this.BXWritePC(this.registers[Rm]);
        deltaCycles++;
      } else if (opcode >> 6 === 267) {
        const Rm = opcode >> 3 & 7;
        const Rn = opcode & 7;
        this.addUpdateFlags(this.registers[Rn], this.registers[Rm]);
      } else if (opcode >> 11 === 5) {
        const Rn = opcode >> 8 & 7;
        const imm8 = opcode & 255;
        this.substractUpdateFlags(this.registers[Rn], imm8);
      } else if (opcode >> 6 === 266) {
        const Rm = opcode >> 3 & 7;
        const Rn = opcode & 7;
        this.substractUpdateFlags(this.registers[Rn], this.registers[Rm]);
      } else if (opcode >> 8 === 69) {
        const Rm = opcode >> 3 & 15;
        const Rn = opcode >> 4 & 8 | opcode & 7;
        this.substractUpdateFlags(this.registers[Rn], this.registers[Rm]);
      } else if (opcode === 46706) {
        this.PM = true;
      } else if (opcode === 46690) {
        this.PM = false;
        this.interruptsUpdated = true;
      } else if (opcode === 62399 && (opcode2 & 65520) === 36688) {
        this.PC += 2;
        deltaCycles += 2;
      } else if (opcode === 62399 && (opcode2 & 65520) === 36672) {
        this.PC += 2;
        deltaCycles += 2;
      } else if (opcode >> 6 === 257) {
        const Rm = opcode >> 3 & 7;
        const Rdn = opcode & 7;
        const result = this.registers[Rm] ^ this.registers[Rdn];
        this.registers[Rdn] = result;
        this.N = !!(result & 2147483648);
        this.Z = result === 0;
      } else if (opcode === 62399 && (opcode2 & 65520) === 36704) {
        this.PC += 2;
        deltaCycles += 2;
      } else if (opcode >> 11 === 25) {
        const Rn = opcode >> 8 & 7;
        const registers = opcode & 255;
        let address = this.registers[Rn];
        for (let i = 0; i < 8; i++) {
          if (registers & 1 << i) {
            this.registers[i] = this.readUint32(address);
            address += 4;
            deltaCycles++;
          }
        }
        if (!(registers & 1 << Rn)) {
          this.registers[Rn] = address;
        }
      } else if (opcode >> 11 === 13) {
        const imm5 = (opcode >> 6 & 31) << 2;
        const Rn = opcode >> 3 & 7;
        const Rt = opcode & 7;
        const addr = this.registers[Rn] + imm5;
        deltaCycles += this.cyclesIO(addr);
        this.registers[Rt] = this.readUint32(addr);
      } else if (opcode >> 11 === 19) {
        const Rt = opcode >> 8 & 7;
        const imm8 = opcode & 255;
        const addr = this.SP + (imm8 << 2);
        deltaCycles += this.cyclesIO(addr);
        this.registers[Rt] = this.readUint32(addr);
      } else if (opcode >> 11 === 9) {
        const imm8 = (opcode & 255) << 2;
        const Rt = opcode >> 8 & 7;
        const nextPC = this.PC + 2;
        const addr = (nextPC & 4294967292) + imm8;
        deltaCycles += this.cyclesIO(addr);
        this.registers[Rt] = this.readUint32(addr);
      } else if (opcode >> 9 === 44) {
        const Rm = opcode >> 6 & 7;
        const Rn = opcode >> 3 & 7;
        const Rt = opcode & 7;
        const addr = this.registers[Rm] + this.registers[Rn];
        deltaCycles += this.cyclesIO(addr);
        this.registers[Rt] = this.readUint32(addr);
      } else if (opcode >> 11 === 15) {
        const imm5 = opcode >> 6 & 31;
        const Rn = opcode >> 3 & 7;
        const Rt = opcode & 7;
        const addr = this.registers[Rn] + imm5;
        deltaCycles += this.cyclesIO(addr);
        this.registers[Rt] = this.readUint8(addr);
      } else if (opcode >> 9 === 46) {
        const Rm = opcode >> 6 & 7;
        const Rn = opcode >> 3 & 7;
        const Rt = opcode & 7;
        const addr = this.registers[Rm] + this.registers[Rn];
        deltaCycles += this.cyclesIO(addr);
        this.registers[Rt] = this.readUint8(addr);
      } else if (opcode >> 11 === 17) {
        const imm5 = opcode >> 6 & 31;
        const Rn = opcode >> 3 & 7;
        const Rt = opcode & 7;
        const addr = this.registers[Rn] + (imm5 << 1);
        deltaCycles += this.cyclesIO(addr);
        this.registers[Rt] = this.readUint16(addr);
      } else if (opcode >> 9 === 45) {
        const Rm = opcode >> 6 & 7;
        const Rn = opcode >> 3 & 7;
        const Rt = opcode & 7;
        const addr = this.registers[Rm] + this.registers[Rn];
        deltaCycles += this.cyclesIO(addr);
        this.registers[Rt] = this.readUint16(addr);
      } else if (opcode >> 9 === 43) {
        const Rm = opcode >> 6 & 7;
        const Rn = opcode >> 3 & 7;
        const Rt = opcode & 7;
        const addr = this.registers[Rm] + this.registers[Rn];
        deltaCycles += this.cyclesIO(addr);
        this.registers[Rt] = signExtend8(this.readUint8(addr));
      } else if (opcode >> 9 === 47) {
        const Rm = opcode >> 6 & 7;
        const Rn = opcode >> 3 & 7;
        const Rt = opcode & 7;
        const addr = this.registers[Rm] + this.registers[Rn];
        deltaCycles += this.cyclesIO(addr);
        this.registers[Rt] = signExtend16(this.readUint16(addr));
      } else if (opcode >> 11 === 0) {
        const imm5 = opcode >> 6 & 31;
        const Rm = opcode >> 3 & 7;
        const Rd = opcode & 7;
        const input = this.registers[Rm];
        const result = input << imm5;
        this.registers[Rd] = result;
        this.N = !!(result & 2147483648);
        this.Z = result === 0;
        this.C = imm5 ? !!(input & 1 << 32 - imm5) : this.C;
      } else if (opcode >> 6 === 258) {
        const Rm = opcode >> 3 & 7;
        const Rdn = opcode & 7;
        const input = this.registers[Rdn];
        const shiftCount = this.registers[Rm] & 255;
        const result = shiftCount >= 32 ? 0 : input << shiftCount;
        this.registers[Rdn] = result;
        this.N = !!(result & 2147483648);
        this.Z = result === 0;
        this.C = shiftCount ? !!(input & 1 << 32 - shiftCount) : this.C;
      } else if (opcode >> 11 === 1) {
        const imm5 = opcode >> 6 & 31;
        const Rm = opcode >> 3 & 7;
        const Rd = opcode & 7;
        const input = this.registers[Rm];
        const result = imm5 ? input >>> imm5 : 0;
        this.registers[Rd] = result;
        this.N = !!(result & 2147483648);
        this.Z = result === 0;
        this.C = !!(input >>> (imm5 ? imm5 - 1 : 31) & 1);
      } else if (opcode >> 6 === 259) {
        const Rm = opcode >> 3 & 7;
        const Rdn = opcode & 7;
        const shiftAmount = this.registers[Rm] & 255;
        const input = this.registers[Rdn];
        const result = shiftAmount < 32 ? input >>> shiftAmount : 0;
        this.registers[Rdn] = result;
        this.N = !!(result & 2147483648);
        this.Z = result === 0;
        this.C = shiftAmount <= 32 ? !!(input >>> shiftAmount - 1 & 1) : false;
      } else if (opcode >> 8 === 70) {
        const Rm = opcode >> 3 & 15;
        const Rd = opcode >> 4 & 8 | opcode & 7;
        let value = Rm === pcRegister ? this.PC + 2 : this.registers[Rm];
        if (Rd === pcRegister) {
          deltaCycles++;
          value &= ~1;
        } else if (Rd === spRegister) {
          value &= ~3;
        }
        this.registers[Rd] = value;
      } else if (opcode >> 11 === 4) {
        const value = opcode & 255;
        const Rd = opcode >> 8 & 7;
        this.registers[Rd] = value;
        this.N = !!(value & 2147483648);
        this.Z = value === 0;
      } else if (opcode === 62447 && opcode2 >> 12 == 8) {
        const SYSm = opcode2 & 255;
        const Rd = opcode2 >> 8 & 15;
        this.registers[Rd] = this.readSpecialRegister(SYSm);
        this.PC += 2;
        deltaCycles += 2;
      } else if (opcode >> 4 === 3896 && opcode2 >> 8 == 136) {
        const SYSm = opcode2 & 255;
        const Rn = opcode & 15;
        this.writeSpecialRegister(SYSm, this.registers[Rn]);
        this.PC += 2;
        deltaCycles += 2;
      } else if (opcode >> 6 === 269) {
        const Rn = opcode >> 3 & 7;
        const Rdm = opcode & 7;
        const result = Math.imul(this.registers[Rn], this.registers[Rdm]);
        this.registers[Rdm] = result;
        this.N = !!(result & 2147483648);
        this.Z = (result & 4294967295) === 0;
      } else if (opcode >> 6 === 271) {
        const Rm = opcode >> 3 & 7;
        const Rd = opcode & 7;
        const result = ~this.registers[Rm];
        this.registers[Rd] = result;
        this.N = !!(result & 2147483648);
        this.Z = result === 0;
      } else if (opcode >> 6 === 268) {
        const Rm = opcode >> 3 & 7;
        const Rdn = opcode & 7;
        const result = this.registers[Rdn] | this.registers[Rm];
        this.registers[Rdn] = result;
        this.N = !!(result & 2147483648);
        this.Z = (result & 4294967295) === 0;
      } else if (opcode >> 9 === 94) {
        const P = opcode >> 8 & 1;
        let address = this.SP;
        for (let i = 0; i <= 7; i++) {
          if (opcode & 1 << i) {
            this.registers[i] = this.readUint32(address);
            address += 4;
            deltaCycles++;
          }
        }
        if (P) {
          this.SP = address + 4;
          this.BXWritePC(this.readUint32(address));
          deltaCycles += 2;
        } else {
          this.SP = address;
        }
      } else if (opcode >> 9 === 90) {
        let bitCount = 0;
        for (let i = 0; i <= 8; i++) {
          if (opcode & 1 << i) {
            bitCount++;
          }
        }
        let address = this.SP - 4 * bitCount;
        for (let i = 0; i <= 7; i++) {
          if (opcode & 1 << i) {
            this.writeUint32(address, this.registers[i]);
            deltaCycles++;
            address += 4;
          }
        }
        if (opcode & 1 << 8) {
          this.writeUint32(address, this.registers[14]);
        }
        this.SP -= 4 * bitCount;
      } else if (opcode >> 6 === 744) {
        const Rm = opcode >> 3 & 7;
        const Rd = opcode & 7;
        const input = this.registers[Rm];
        this.registers[Rd] = (input & 255) << 24 | (input >> 8 & 255) << 16 | (input >> 16 & 255) << 8 | input >> 24 & 255;
      } else if (opcode >> 6 === 745) {
        const Rm = opcode >> 3 & 7;
        const Rd = opcode & 7;
        const input = this.registers[Rm];
        this.registers[Rd] = (input >> 16 & 255) << 24 | (input >> 24 & 255) << 16 | (input & 255) << 8 | input >> 8 & 255;
      } else if (opcode >> 6 === 747) {
        const Rm = opcode >> 3 & 7;
        const Rd = opcode & 7;
        const input = this.registers[Rm];
        this.registers[Rd] = signExtend16((input & 255) << 8 | input >> 8 & 255);
      } else if (opcode >> 6 === 263) {
        const Rm = opcode >> 3 & 7;
        const Rdn = opcode & 7;
        const input = this.registers[Rdn];
        const shift = (this.registers[Rm] & 255) % 32;
        const result = input >>> shift | input << 32 - shift;
        this.registers[Rdn] = result;
        this.N = !!(result & 2147483648);
        this.Z = result === 0;
        this.C = !!(result & 2147483648);
      } else if (opcode >> 6 === 265) {
        const Rn = opcode >> 3 & 7;
        const Rd = opcode & 7;
        this.registers[Rd] = this.substractUpdateFlags(0, this.registers[Rn]);
      } else if (opcode === 48896) {
      } else if (opcode >> 6 === 262) {
        const Rm = opcode >> 3 & 7;
        const Rdn = opcode & 7;
        this.registers[Rdn] = this.substractUpdateFlags(this.registers[Rdn], this.registers[Rm] + (1 - (this.C ? 1 : 0)));
      } else if (opcode === 48960) {
        this.logger.info(LOG_NAME2, "SEV");
      } else if (opcode >> 11 === 24) {
        const Rn = opcode >> 8 & 7;
        const registers = opcode & 255;
        let address = this.registers[Rn];
        for (let i = 0; i < 8; i++) {
          if (registers & 1 << i) {
            this.writeUint32(address, this.registers[i]);
            address += 4;
            deltaCycles++;
          }
        }
        if (!(registers & 1 << Rn)) {
          this.registers[Rn] = address;
        }
      } else if (opcode >> 11 === 12) {
        const imm5 = (opcode >> 6 & 31) << 2;
        const Rn = opcode >> 3 & 7;
        const Rt = opcode & 7;
        const address = this.registers[Rn] + imm5;
        deltaCycles += this.cyclesIO(address, true);
        this.writeUint32(address, this.registers[Rt]);
      } else if (opcode >> 11 === 18) {
        const Rt = opcode >> 8 & 7;
        const imm8 = opcode & 255;
        const address = this.SP + (imm8 << 2);
        deltaCycles += this.cyclesIO(address, true);
        this.writeUint32(address, this.registers[Rt]);
      } else if (opcode >> 9 === 40) {
        const Rm = opcode >> 6 & 7;
        const Rn = opcode >> 3 & 7;
        const Rt = opcode & 7;
        const address = this.registers[Rm] + this.registers[Rn];
        deltaCycles += this.cyclesIO(address, true);
        this.writeUint32(address, this.registers[Rt]);
      } else if (opcode >> 11 === 14) {
        const imm5 = opcode >> 6 & 31;
        const Rn = opcode >> 3 & 7;
        const Rt = opcode & 7;
        const address = this.registers[Rn] + imm5;
        deltaCycles += this.cyclesIO(address, true);
        this.writeUint8(address, this.registers[Rt]);
      } else if (opcode >> 9 === 42) {
        const Rm = opcode >> 6 & 7;
        const Rn = opcode >> 3 & 7;
        const Rt = opcode & 7;
        const address = this.registers[Rm] + this.registers[Rn];
        deltaCycles += this.cyclesIO(address, true);
        this.writeUint8(address, this.registers[Rt]);
      } else if (opcode >> 11 === 16) {
        const imm5 = (opcode >> 6 & 31) << 1;
        const Rn = opcode >> 3 & 7;
        const Rt = opcode & 7;
        const address = this.registers[Rn] + imm5;
        deltaCycles += this.cyclesIO(address, true);
        this.writeUint16(address, this.registers[Rt]);
      } else if (opcode >> 9 === 41) {
        const Rm = opcode >> 6 & 7;
        const Rn = opcode >> 3 & 7;
        const Rt = opcode & 7;
        const address = this.registers[Rm] + this.registers[Rn];
        deltaCycles += this.cyclesIO(address, true);
        this.writeUint16(address, this.registers[Rt]);
      } else if (opcode >> 7 === 353) {
        const imm32 = (opcode & 127) << 2;
        this.SP -= imm32;
      } else if (opcode >> 9 === 15) {
        const imm3 = opcode >> 6 & 7;
        const Rn = opcode >> 3 & 7;
        const Rd = opcode & 7;
        this.registers[Rd] = this.substractUpdateFlags(this.registers[Rn], imm3);
      } else if (opcode >> 11 === 7) {
        const imm8 = opcode & 255;
        const Rdn = opcode >> 8 & 7;
        this.registers[Rdn] = this.substractUpdateFlags(this.registers[Rdn], imm8);
      } else if (opcode >> 9 === 13) {
        const Rm = opcode >> 6 & 7;
        const Rn = opcode >> 3 & 7;
        const Rd = opcode & 7;
        this.registers[Rd] = this.substractUpdateFlags(this.registers[Rn], this.registers[Rm]);
      } else if (opcode >> 8 === 223) {
        this.pendingSVCall = true;
        this.interruptsUpdated = true;
      } else if (opcode >> 6 === 713) {
        const Rm = opcode >> 3 & 7;
        const Rd = opcode & 7;
        this.registers[Rd] = signExtend8(this.registers[Rm]);
      } else if (opcode >> 6 === 712) {
        const Rm = opcode >> 3 & 7;
        const Rd = opcode & 7;
        this.registers[Rd] = signExtend16(this.registers[Rm]);
      } else if (opcode >> 6 == 264) {
        const Rm = opcode >> 3 & 7;
        const Rn = opcode & 7;
        const result = this.registers[Rn] & this.registers[Rm];
        this.N = !!(result & 2147483648);
        this.Z = result === 0;
      } else if (opcode >> 8 == 222) {
        const imm8 = opcode & 255;
        this.breakRewind = 2;
        this.rp2040.onBreak(imm8);
      } else if (opcode >> 4 === 3967 && opcode2 >> 12 === 10) {
        const imm4 = opcode & 15;
        const imm12 = opcode2 & 4095;
        this.breakRewind = 4;
        this.rp2040.onBreak(imm4 << 12 | imm12);
        this.PC += 2;
      } else if (opcode >> 6 == 715) {
        const Rm = opcode >> 3 & 7;
        const Rd = opcode & 7;
        this.registers[Rd] = this.registers[Rm] & 255;
      } else if (opcode >> 6 == 714) {
        const Rm = opcode >> 3 & 7;
        const Rd = opcode & 7;
        this.registers[Rd] = this.registers[Rm] & 65535;
      } else if (opcode === 48928) {
        deltaCycles++;
        if (this.eventRegistered) {
          this.eventRegistered = false;
        } else {
          this.waiting = true;
        }
      } else if (opcode === 48944) {
        deltaCycles++;
        this.waiting = true;
      } else if (opcode === 48912) {
        this.logger.info(LOG_NAME2, "Yield");
      } else {
        this.logger.warn(LOG_NAME2, `Warning: Instruction at ${opcodePC.toString(16)} is not implemented yet!`);
        this.logger.warn(LOG_NAME2, `Opcode: 0x${opcode.toString(16)} (0x${opcode2.toString(16)})`);
      }
      this.cycles += deltaCycles;
      return deltaCycles;
    }
  };

  // tools/programmable_simulator/node_modules/rp2040js/dist/esm/simulator.js
  var Simulator = class {
    constructor(clock = new SimulationClock()) {
      this.clock = clock;
      this.executeTimer = null;
      this.stopped = true;
      this.rp2040 = new RP2040(clock);
      this.rp2040.onBreak = () => this.stop();
    }
    execute() {
      const { rp2040, clock } = this;
      this.executeTimer = null;
      this.stopped = false;
      const cycleNanos = 1e9 / 125e6;
      for (let i = 0; i < 1e6 && !this.stopped; i++) {
        if (rp2040.core.waiting) {
          const { nanosToNextAlarm } = clock;
          clock.tick(nanosToNextAlarm);
          i += nanosToNextAlarm / cycleNanos;
        } else {
          const cycles = rp2040.core.executeInstruction();
          clock.tick(cycles * cycleNanos);
        }
      }
      if (!this.stopped) {
        this.executeTimer = setTimeout(() => this.execute(), 0);
      }
    }
    stop() {
      this.stopped = true;
      if (this.executeTimer != null) {
        clearTimeout(this.executeTimer);
        this.executeTimer = null;
      }
    }
    get executing() {
      return !this.stopped;
    }
  };

  // tools/programmable_simulator/node_modules/rp2040js/dist/esm/usb/interfaces.js
  var DataDirection;
  (function(DataDirection2) {
    DataDirection2[DataDirection2["HostToDevice"] = 0] = "HostToDevice";
    DataDirection2[DataDirection2["DeviceToHost"] = 1] = "DeviceToHost";
  })(DataDirection || (DataDirection = {}));
  var SetupType;
  (function(SetupType2) {
    SetupType2[SetupType2["Standard"] = 0] = "Standard";
    SetupType2[SetupType2["Class"] = 1] = "Class";
    SetupType2[SetupType2["Vendor"] = 2] = "Vendor";
    SetupType2[SetupType2["Reserved"] = 3] = "Reserved";
  })(SetupType || (SetupType = {}));
  var SetupRecipient;
  (function(SetupRecipient2) {
    SetupRecipient2[SetupRecipient2["Device"] = 0] = "Device";
    SetupRecipient2[SetupRecipient2["Interface"] = 1] = "Interface";
    SetupRecipient2[SetupRecipient2["Endpoint"] = 2] = "Endpoint";
    SetupRecipient2[SetupRecipient2["Other"] = 3] = "Other";
  })(SetupRecipient || (SetupRecipient = {}));
  var SetupRequest;
  (function(SetupRequest2) {
    SetupRequest2[SetupRequest2["GetStatus"] = 0] = "GetStatus";
    SetupRequest2[SetupRequest2["ClearFeature"] = 1] = "ClearFeature";
    SetupRequest2[SetupRequest2["Reserved1"] = 2] = "Reserved1";
    SetupRequest2[SetupRequest2["SetFeature"] = 3] = "SetFeature";
    SetupRequest2[SetupRequest2["Reserved2"] = 4] = "Reserved2";
    SetupRequest2[SetupRequest2["SetAddress"] = 5] = "SetAddress";
    SetupRequest2[SetupRequest2["GetDescriptor"] = 6] = "GetDescriptor";
    SetupRequest2[SetupRequest2["SetDescriptor"] = 7] = "SetDescriptor";
    SetupRequest2[SetupRequest2["GetConfiguration"] = 8] = "GetConfiguration";
    SetupRequest2[SetupRequest2["SetDeviceConfiguration"] = 9] = "SetDeviceConfiguration";
    SetupRequest2[SetupRequest2["GetInterface"] = 10] = "GetInterface";
    SetupRequest2[SetupRequest2["SetInterface"] = 11] = "SetInterface";
    SetupRequest2[SetupRequest2["SynchFrame"] = 12] = "SynchFrame";
  })(SetupRequest || (SetupRequest = {}));
  var DescriptorType;
  (function(DescriptorType2) {
    DescriptorType2[DescriptorType2["Device"] = 1] = "Device";
    DescriptorType2[DescriptorType2["Configration"] = 2] = "Configration";
    DescriptorType2[DescriptorType2["String"] = 3] = "String";
    DescriptorType2[DescriptorType2["Interface"] = 4] = "Interface";
    DescriptorType2[DescriptorType2["Endpoint"] = 5] = "Endpoint";
  })(DescriptorType || (DescriptorType = {}));

  // tools/programmable_simulator/node_modules/rp2040js/dist/esm/usb/setup.js
  function createSetupPacket(params2) {
    const setupPacket = new Uint8Array(8);
    setupPacket[0] = params2.dataDirection << 7 | params2.type << 5 | params2.recipient;
    setupPacket[1] = params2.bRequest;
    setupPacket[2] = params2.wValue & 255;
    setupPacket[3] = params2.wValue >> 8 & 255;
    setupPacket[4] = params2.wIndex & 255;
    setupPacket[5] = params2.wIndex >> 8 & 255;
    setupPacket[6] = params2.wLength & 255;
    setupPacket[7] = params2.wLength >> 8 & 255;
    return setupPacket;
  }
  function setDeviceAddressPacket(address) {
    return createSetupPacket({
      dataDirection: DataDirection.HostToDevice,
      type: SetupType.Standard,
      recipient: SetupRecipient.Device,
      bRequest: SetupRequest.SetAddress,
      wValue: address,
      wIndex: 0,
      wLength: 0
    });
  }
  function getDescriptorPacket(type, length, index = 0) {
    return createSetupPacket({
      dataDirection: DataDirection.DeviceToHost,
      type: SetupType.Standard,
      recipient: SetupRecipient.Device,
      bRequest: SetupRequest.GetDescriptor,
      wValue: type << 8,
      wIndex: index,
      wLength: length
    });
  }
  function setDeviceConfigurationPacket(configurationNumber) {
    return createSetupPacket({
      dataDirection: DataDirection.HostToDevice,
      type: SetupType.Standard,
      recipient: SetupRecipient.Device,
      bRequest: SetupRequest.SetDeviceConfiguration,
      wValue: configurationNumber,
      wIndex: 0,
      wLength: 0
    });
  }

  // tools/programmable_simulator/node_modules/rp2040js/dist/esm/usb/cdc.js
  var CDC_REQUEST_SET_CONTROL_LINE_STATE = 34;
  var CDC_DTR = 1 << 0;
  var CDC_RTS = 1 << 1;
  var CDC_DATA_CLASS = 10;
  var ENDPOINT_BULK = 2;
  var TX_FIFO_SIZE = 512;
  var ENDPOINT_ZERO = 0;
  var CONFIGURATION_DESCRIPTOR_SIZE = 9;
  function extractEndpointNumbers(descriptors) {
    let index = 0;
    let foundInterface = false;
    const result = {
      in: -1,
      out: -1
    };
    while (index < descriptors.length) {
      const len = descriptors[index];
      if (len < 2 || descriptors.length < index + len) {
        break;
      }
      const type = descriptors[index + 1];
      if (type === DescriptorType.Interface && len === 9) {
        const numEndpoints = descriptors[index + 4];
        const interfaceClass = descriptors[index + 5];
        foundInterface = numEndpoints === 2 && interfaceClass === CDC_DATA_CLASS;
      }
      if (foundInterface && type === DescriptorType.Endpoint && len === 7) {
        const address = descriptors[index + 2];
        const attributes = descriptors[index + 3];
        if ((attributes & 3) === ENDPOINT_BULK) {
          if (address & 128) {
            result.in = address & 15;
          } else {
            result.out = address & 15;
          }
        }
      }
      index += descriptors[index];
    }
    return result;
  }
  var USBCDC = class {
    constructor(usb) {
      this.usb = usb;
      this.txFIFO = new FIFO(TX_FIFO_SIZE);
      this.initialized = false;
      this.descriptorsSize = null;
      this.descriptors = [];
      this.outEndpoint = -1;
      this.inEndpoint = -1;
      this.usb.onUSBEnabled = () => {
        this.usb.resetDevice();
      };
      this.usb.onResetReceived = () => {
        this.usb.sendSetupPacket(setDeviceAddressPacket(1));
      };
      this.usb.onEndpointWrite = (endpoint2, buffer) => {
        var _a, _b;
        if (endpoint2 === ENDPOINT_ZERO && buffer.length === 0) {
          if (this.descriptorsSize == null) {
            this.usb.sendSetupPacket(getDescriptorPacket(DescriptorType.Configration, CONFIGURATION_DESCRIPTOR_SIZE));
          } else if (!this.initialized) {
            this.cdcSetControlLineState();
            (_a = this.onDeviceConnected) === null || _a === void 0 ? void 0 : _a.call(this);
          }
        }
        if (endpoint2 === ENDPOINT_ZERO && buffer.length > 1) {
          if (buffer.length === CONFIGURATION_DESCRIPTOR_SIZE && buffer[1] === DescriptorType.Configration && this.descriptorsSize == null) {
            this.descriptorsSize = buffer[3] << 8 | buffer[2];
            this.usb.sendSetupPacket(getDescriptorPacket(DescriptorType.Configration, this.descriptorsSize));
          } else if (this.descriptorsSize != null && this.descriptors.length < this.descriptorsSize) {
            this.descriptors.push(...buffer);
          }
          if (this.descriptorsSize === this.descriptors.length) {
            const endpoints = extractEndpointNumbers(this.descriptors);
            this.inEndpoint = endpoints.in;
            this.outEndpoint = endpoints.out;
            this.usb.sendSetupPacket(setDeviceConfigurationPacket(1));
          }
        }
        if (endpoint2 === this.inEndpoint) {
          (_b = this.onSerialData) === null || _b === void 0 ? void 0 : _b.call(this, buffer);
        }
      };
      this.usb.onEndpointRead = (endpoint2, size) => {
        if (endpoint2 === this.outEndpoint) {
          const buffer = new Uint8Array(Math.min(size, this.txFIFO.itemCount));
          for (let i = 0; i < buffer.length; i++) {
            buffer[i] = this.txFIFO.pull();
          }
          this.usb.endpointReadDone(this.outEndpoint, buffer);
        }
      };
    }
    cdcSetControlLineState(value = CDC_DTR | CDC_RTS, interfaceNumber = 0) {
      this.usb.sendSetupPacket(createSetupPacket({
        dataDirection: DataDirection.HostToDevice,
        type: SetupType.Class,
        recipient: SetupRecipient.Device,
        bRequest: CDC_REQUEST_SET_CONTROL_LINE_STATE,
        wValue: value,
        wIndex: interfaceNumber,
        wLength: 0
      }));
      this.initialized = true;
    }
    sendSerialByte(data) {
      this.txFIFO.push(data);
    }
  };

  // src/programmable_circuit/uart_bridge.mjs
  function attachPicoUART(m, uart, onByte) {
    const TX = 1 << 5;
    uart.checkInterrupts = () => m.setInterrupt(uart.irq, !!(uart.interruptStatus & uart.interruptMask));
    uart.onByte = (value) => {
      onByte(value);
      const baud = uart.baudRate;
      if (baud > 0) m.clock.createAlarm(() => {
        uart.interruptStatus |= TX;
        uart.checkInterrupts();
      }).schedule(1e9 * 10 / baud);
    };
  }

  // src/programmable_circuit/engine.mjs
  var ENGINE = "avr8js-0.21.1+rp2040js-1.4.1/me-6-expanded-projects";
  function loadHex(text, flash = 32768) {
    const mem = new Uint8Array(flash);
    let upper = 0, end = false;
    for (const line of text.trim().split(/\r?\n/)) {
      if (!/^:[0-9a-f]+$/i.test(line) || line.length % 2 !== 1) throw Error("Invalid Intel HEX record.");
      const b = Uint8Array.from(line.slice(1).match(/../g).map((x) => parseInt(x, 16)));
      if (b.length !== b[0] + 5 || b.reduce((a2, x) => a2 + x, 0) % 256) throw Error("Intel HEX checksum failed.");
      const a = upper + (b[1] << 8 | b[2]);
      if (b[3] === 0) {
        if (a + b[0] > mem.length) throw Error("HEX exceeds selected MCU flash.");
        mem.set(b.slice(4, 4 + b[0]), a);
      } else if (b[3] === 1) end = true;
      else if (b[3] === 4) upper = (b[4] << 8 | b[5]) * 65536;
      else if (![2, 3, 5].includes(b[3])) throw Error("Unsupported HEX record.");
    }
    if (!end) throw Error("Missing HEX EOF.");
    return new Uint16Array(mem.buffer);
  }
  function loadUF2(m, buffer) {
    const bytes = new Uint8Array(buffer), v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (bytes.length % 512) throw Error("Invalid UF2 length.");
    for (let i = 0; i < bytes.length; i += 512) {
      if (v.getUint32(i, true) !== 171066965 || v.getUint32(i + 4, true) !== 2656915799 || v.getUint32(i + 508, true) !== 179400496) throw Error("Invalid UF2 magic.");
      const a = v.getUint32(i + 12, true) - 268435456, n = v.getUint32(i + 16, true);
      if (a < 0 || a + n > m.flash.length || n > 476) throw Error("UF2 flash range.");
      m.flash.set(bytes.subarray(i + 32, i + 32 + n), a);
    }
  }
  var CircuitRuntime = class {
    constructor(project, firmware, emit = () => {
    }) {
      this.p = JSON.parse(JSON.stringify(validate(project)));
      if (firmware.board_type && firmware.board_type !== project.board_type) throw Error("Compiled firmware belongs to a different board target.");
      this.fw = firmware;
      this.emit = emit;
      this.active = false;
      this.paused = false;
      this.events = [];
      this.adcReads = [];
      this.ledTrace = [];
      this.lastLED = {};
      this.inputEvents = [];
      this.i2c = [];
      this.serial = "";
      this.receiver = "";
      this.error = "";
      this.inputs = {};
      this.connectedPins = new Set(this.p.wires.flatMap((w) => [w.a, w.b]));
      this.startMicros = 0;
      this.serialInput = [];
      this.lastStates = {};
      this.stopReason = "";
      this.duration = Math.max(0.05, Math.min(LIMITS.seconds, firmware.seconds || 2));
      this.physics = new CircuitDynamics(this.p, this.duration);
      this.teaching = new TimedPeripherals(this.p);
      this.uartFrames = [];
      this.uartCount = 0;
      this.solving = false;
      this.dirty = true;
      this.lastPublish = 0;
      this.lastInput = 0;
      this.nextRX = 0;
      this.maxInstructions = 1e8;
      this.instructions = 0;
      this.analogUnknown = /* @__PURE__ */ new Set();
      this.analogVoltages = [];
      this.wallStart = Date.now();
    }
    time() {
      return this.uno ? this.cpu.cycles / 16 : this.sim.clock.micros - this.startMicros;
    }
    states() {
      if (this.mega) return Object.fromEntries(Object.entries(this.pinMap).map(([id, p]) => [id, p.port.pinState(p.bit)]));
      if (this.uno) {
        const v = {};
        for (let i = 0; i < 14; i++) v["D" + i] = (i < 8 ? this.ports.D : this.ports.B).pinState(i < 8 ? i : i - 8);
        for (let i = 0; i < 6; i++) v["A" + i] = this.ports.C.pinState(i);
        return v;
      }
      return Object.fromEntries(this.m.gpio.slice(0, 29).map((x, i) => ["GP" + i, x.value]));
    }
    electrical() {
      if (this.solving) return;
      this.solving = true;
      try {
        const s = this.states();
        this.electric = this.physics.update(this.time(), { ...s, ...this.teaching.override });
        for (const l of this.electric.leds) {
          const old = this.lastLED[l.id];
          this.lastLED[l.id] = l;
          if ((!old || Math.abs(old.current_ma - l.current_ma) > 1e-3) && this.ledTrace.length < 8e3) this.ledTrace.push({ t_us: this.time(), ...l });
        }
        const ground = this.electric.ground, nl = netlist(this.p), V = railVoltage(this.p.board_type);
        for (const [pin, state] of Object.entries(s)) {
          const v = this.electric.values[endpoint(nl.board, pin)];
          if (state >= 2) {
            const thresholds = logicThresholds(this.p.board_type), value = v === null ? null : v <= thresholds.low ? false : v >= thresholds.high ? true : null;
            if (v === null && this.connectedPins.has(endpoint(nl.board, pin)) && (pin.startsWith("D") || pin.startsWith("GP") && Number(pin.slice(2)) < 26)) this.electric.warnings.push(pin + ": connected input net is floating. A retained MCU bit is not valid logic evidence; add a defined bias and ground.");
            if (Number.isFinite(v) && value === null && (pin.startsWith("D") || pin.startsWith("GP") && Number(pin.slice(2)) < 26)) this.electric.warnings.push(pin + ": voltage is between defined LOW/HIGH thresholds; any retained digital read is not reliable logic evidence.");
            if (value !== null) {
              if (this.uno) {
                const i = pin[0] === "A" ? +pin.slice(1) : +pin.slice(1);
                this.mega ? this.pinMap[pin]?.port.setPin(this.pinMap[pin].bit, value) : (pin[0] === "A" ? this.ports.C : i < 8 ? this.ports.D : this.ports.B).setPin(pin[0] === "A" ? i : i < 8 ? i : i - 8, value);
              } else this.m.gpio[+pin.slice(2)].setInputValue(value);
            }
          }
          if (this.lastStates[pin] !== state) {
            if (this.events.length < LIMITS.events) this.events.push({ t_us: this.time(), pin, state });
            else this.truncated = true;
            this.lastStates[pin] = state;
          }
        }
        for (let i = 0; i < boardProfile(this.p.board_type).adc_channels; i++) {
          const k = this.uno ? "A" + i : "GP" + (26 + i), v = this.electric.values[endpoint(nl.board, k)];
          if (v === null) this.analogUnknown.add(k);
          else this.analogUnknown.delete(k);
          this.analogVoltages[i] = v;
          this.adc.channelValues[i] = this.uno ? v ?? 0 : Math.max(0, Math.min(4095, Math.floor((v ?? 0) / 3.3 * 4096 + 1e-9)));
        }
        if (this.uno) {
          const aref = this.electric.values[endpoint(nl.board, "AREF")];
          this.adc.aref = aref ?? 0;
        }
      } catch (e) {
        this.error = e.message;
        this.stop("Electrical error");
      } finally {
        this.solving = false;
        this.dirty = false;
      }
    }
    append(s) {
      if (this.serial.length < LIMITS.serial) this.serial = (this.serial + s).slice(0, LIMITS.serial);
    }
    uartConfig() {
      if (this.uno) return { baud: this.uart.baudRate, bits: this.uart.bitsPerChar, stop: this.uart.stopBits, parity: this.uart.parityEnabled ? this.uart.parityOdd ? 2 : 1 : 0 };
      const c = this.uart.lineCtrlRegister;
      return { baud: this.uart.baudRate, bits: this.uart.wordLength, stop: c & 8 ? 2 : 1, parity: c & 2 ? c & 4 ? 1 : 2 : 0 };
    }
    uartTransfer(value, part, inbound = false) {
      const q = params(part), device = { baud: q.baud * (1 + q.clock_ppm / 1e6), bits: q.bits, parity: q.parity, stop: q.stop }, mcu = this.uartConfig();
      const frame = uartFrame(value, inbound ? device : mcu, inbound ? mcu : device, { seed: q.seed, index: this.uartCount++, noise_ppm: q.noise_ppm });
      if (this.uartFrames.length < 256) this.uartFrames.push({ t_us: this.time(), direction: inbound ? "device_to_mcu" : "mcu_to_device", ...frame });
      return frame;
    }
    uartTx(value, baud) {
      const pin = this.uno ? "D1" : "GP0";
      this.append(this.uno ? String.fromCharCode(value) : "");
      const part = peripheralConnection(this.p, "uart", { [pin]: "RX" });
      if (part) {
        const frame = this.uartTransfer(value, part);
        if (frame.ok) this.receiver = (this.receiver + String.fromCharCode(frame.value)).slice(0, LIMITS.serial);
      }
    }
    setupI2C(bus) {
      this.devices = new I2CDevices(this.p, () => this.time());
      const stamp = (kind, x) => {
        if (this.i2c.length < 256) this.i2c.push({ t_us: this.time(), kind, ...x });
      };
      const start = () => {
        stamp("start", {});
        bus.completeStart();
      };
      const connect = (address, mode) => {
        this.electrical();
        const frequency = this.uno ? bus.sclFrequency : this.m.clkSys / (bus.sclHighPeriod + bus.sclLowPeriod), high = this.uno ? 5e5 / frequency : bus.sclHighPeriod / this.m.clkSys * 1e6;
        const result = this.devices.connect(address, this.uno ? !mode : mode === 1, this.electric, frequency, high, this.uno || this.m.gpio[4].functionSelect === 3 && this.m.gpio[5].functionSelect === 3);
        for (const q of result.qualities) stamp("electrical_margin", q);
        stamp("address", { address, ack: result.ack, reason: result.reason, device: result.device });
        bus.completeConnect(result.ack);
      };
      const write = (value) => {
        const ack = this.devices.write(value);
        stamp("write", { value, ack });
        bus.completeWrite(ack);
      };
      const read = () => {
        const value = this.devices.read();
        stamp("read", { value });
        bus.completeRead(value);
      };
      const stop = () => {
        this.devices.stop();
        stamp("stop", {});
        bus.completeStop();
      };
      if (this.uno) bus.eventHandler = { start, connectToSlave: connect, writeByte: write, readByte: read, stop };
      else {
        bus.onStart = start;
        bus.onConnect = connect;
        bus.onWriteByte = write;
        bus.onReadByte = read;
        bus.onStop = stop;
      }
    }
    start() {
      if (this.active) throw Error("Already running.");
      this.uno = isAVR(this.p.board_type);
      this.active = true;
      this.wallStart = Date.now();
      if (this.uno) {
        this.mega = this.p.board_type === "mega2560";
        this.cpu = new import_cjs2.CPU(loadHex(this.fw.hex, this.mega ? 262144 : 32768), this.mega ? 8448 : 2048);
        this.ports = this.mega ? {} : { B: new import_cjs2.AVRIOPort(this.cpu, import_cjs2.portBConfig), C: new import_cjs2.AVRIOPort(this.cpu, import_cjs2.portCConfig), D: new import_cjs2.AVRIOPort(this.cpu, import_cjs2.portDConfig) };
        if (this.mega) {
          this.ports = Object.fromEntries(MEGA_PORT_CONFIGS.map((x) => [x.name, new import_cjs2.AVRIOPort(this.cpu, x.config)]));
          this.pinMap = {};
          for (const [port, ids] of Object.entries(MEGA_PORT_BIT_MAP)) ids.forEach((n, bit) => {
            if (n >= 0) this.pinMap[n >= 54 ? "A" + (n - 54) : "D" + n] = { port: this.ports[port], bit };
          });
        }
        const cfg = this.mega ? ATMEGA2560_PERIPHERALS : { timer0: import_cjs2.timer0Config, timer1: import_cjs2.timer1Config, timer2: import_cjs2.timer2Config, usarts: [{ config: import_cjs2.usart0Config }], adc: import_cjs2.adcConfig, twi: import_cjs2.twiConfig };
        this.timers = [cfg.timer0, cfg.timer1, cfg.timer2, ...this.mega ? [megaTimer3Config, megaTimer4Config, megaTimer5Config] : []].map((x) => new import_cjs2.AVRTimer(this.cpu, x));
        this.uart = new import_cjs2.AVRUSART(this.cpu, cfg.usarts[0].config, 16e6);
        this.uart.onByteTransmit = (v) => this.uartTx(v, this.uart.baudRate);
        this.adc = new import_cjs2.AVRADC(this.cpu, this.mega ? { ...cfg.adc, numChannels: 16, muxInputMask: 63, muxChannels: Object.fromEntries(Array.from({ length: 16 }, (_, i) => [i < 8 ? i : 32 + i - 8, { type: 0, channel: i }])) } : cfg.adc);
        const orig = this.adc.onADCRead;
        this.adc.onADCRead = (input) => {
          this.electrical();
          if (input.type !== 0 || input.channel >= boardProfile(this.p.board_type).adc_channels) throw Error("Only the external ADC pins of the selected board are supported.");
          this.adcReads.push({ t_us: this.time(), channel: input.channel ?? 0, volts: this.adc.channelValues[input.channel ?? 0], reference: this.adc.referenceVoltage, unknown: this.analogUnknown.has("A" + (input.channel ?? 0)) });
          if (this.adcReads.length > 256) this.adcReads.shift();
          if (this.analogUnknown.has("A" + (input.channel ?? 0)) || !(this.adc.referenceVoltage > 0)) throw Error("ADC input/reference is floating or undefined; no valid measurement captured.");
          orig(input);
        };
        this.twi = new import_cjs2.AVRTWI(this.cpu, cfg.twi, 16e6);
        this.setupI2C(this.twi);
        Object.values(this.ports).forEach((p) => p.addListener(() => {
          this.dirty = true;
        }));
      } else {
        this.sim = new Simulator();
        this.m = this.sim.rp2040;
        this.m.logger = new ConsoleLogger(LogLevel.Error);
        this.m.loadBootrom(this.fw.bootrom);
        loadUF2(this.m, this.fw.uf2);
        this.adc = this.m.adc;
        const orig = this.adc.onADCRead;
        this.adc.onADCRead = (ch) => {
          this.electrical();
          if (ch > 2) throw Error("Only external Pico ADC pins GP26\u2013GP28 are supported.");
          this.adcReads.push({ t_us: this.time(), channel: ch, volts: this.analogVoltages[ch], code: this.adc.channelValues[ch], reference: 3.3, unknown: this.analogUnknown.has("GP" + (26 + ch)), native_bits: 12 });
          if (this.adcReads.length > 256) this.adcReads.shift();
          if (this.analogUnknown.has("GP" + (26 + ch))) throw Error("ADC input is floating; no valid measurement captured.");
          orig(ch);
        };
        this.m.gpio.forEach((pin) => pin.addListener(() => {
          this.dirty = true;
        }));
        this.uart = this.m.uart[0];
        attachPicoUART(this.m, this.uart, (v) => this.uartTx(v, this.uart.baudRate));
        this.setupI2C(this.m.i2c[0]);
        this.rawStage = 0;
        let consoleText = "";
        this.cdc = new USBCDC(this.m.usbCtrl);
        this.cdc.onDeviceConnected = () => this.cdc.sendSerialByte(13);
        this.cdc.onSerialData = (bytes) => {
          const txt = String.fromCharCode(...bytes);
          consoleText += txt;
          if (this.rawStage === 0 && consoleText.includes(">>>")) {
            this.rawStage = 1;
            this.cdc.sendSerialByte(1);
          } else if (this.rawStage === 1 && consoleText.includes("raw REPL")) {
            this.rawStage = 2;
            this.startMicros = this.sim.clock.micros;
            this.sendQueue = [...new TextEncoder().encode(picoProgram(this.p)), 4];
          } else if (this.rawStage === 2) this.append(txt);
        };
        this.m.core.PC = 268435456;
      }
      this.electrical();
      return this;
    }
    input(id, value) {
      const part = this.p.parts.find((x) => x.id === id);
      if (!part) throw Error("Part unavailable.");
      if (part.type === "button") {
        if (params(part).bounce_ms) this.physics.command(id, !!value, this.time());
        else part.params.pressed = !!value;
      } else if (part.type === "pot") part.params.position = Math.max(0, Math.min(1, +value));
      else if (part.type === "source") part.params.volts = +value;
      else if (part.type === "sensor") part.params.temperature_c = Math.max(-40, Math.min(125, +value));
      else throw Error("This part has no live input.");
      this.dirty = true;
      if (this.inputEvents.length < 100) this.inputEvents.push({ t_us: this.time(), id, value });
      this.inputs[id] = value;
      this.electrical();
    }
    rx(text) {
      const map = this.uno ? { D0: "TX" } : { GP1: "TX" }, part = peripheralConnection(this.p, "uart", map);
      if (!part) throw Error("Connect and power the UART transmitter TX to MCU RX first.");
      for (const value of new TextEncoder().encode(text).slice(0, 128)) {
        const frame = this.uartTransfer(value, part, true);
        if (frame.ok) this.serialInput.push(frame.value);
      }
    }
    step(budget = 3e4) {
      if (!this.active || this.paused) return this.snapshot();
      try {
        for (let i = 0; i < budget && this.active; i++) {
          if (this.teaching.devices.size && (this.dirty || this.time() >= (this.nextTeaching || 0))) {
            if (this.teaching.tick(this.time(), this.states(), this.electric)) this.dirty = true;
            this.nextTeaching = this.time() + 1;
          }
          if (this.dirty || this.physics.due(Math.max(0, this.time()))) this.electrical();
          if (!this.active) break;
          if (this.uno) {
            (0, import_cjs2.avrInstruction)(this.cpu);
            this.cpu.tick();
            if (this.serialInput.length && !this.uart.rxBusy) this.uart.writeByte(this.serialInput.shift());
          } else {
            const c = this.sim.clock;
            if (this.m.core.waiting) c.tick(Math.min(c.nanosToNextAlarm, 1e6));
            else c.tick(this.m.core.executeInstruction() * 8);
            if (this.sendQueue?.length && i % 500 === 0) {
              this.cdc.sendSerialByte(this.sendQueue.shift());
            }
            if (this.serialInput.length && this.time() >= this.nextRX) {
              this.uart.feedByte(this.serialInput.shift());
              this.nextRX = this.time() + 1e6 * 10 / this.uart.baudRate;
            }
          }
          this.instructions++;
          if (this.instructions > this.maxInstructions || Date.now() - this.wallStart > 6e4) this.stop("Resource budget reached");
          if ((this.uno || this.rawStage === 2) && this.time() >= this.duration * 1e6) this.stop("Capture time complete");
        }
      } catch (e) {
        this.error = e.message;
        this.stop("Emulator error");
      }
      return this.snapshot();
    }
    stop(reason = "Stopped by learner") {
      this.active = false;
      this.stopReason = reason;
      this.sim?.stop();
    }
    snapshot() {
      return { peripherals: { ...this.devices?.snapshot(), ...this.teaching.snapshot() }, source_type: "CONTROLLED_SIMULATION", firmware_executed: true, hardware_measured: false, simulator_version: ENGINE, project_version: VERSION, board: this.p.board_type, t_us: Math.max(0, this.time() || 0), active: this.active, paused: this.paused, stop_reason: this.stopReason, error: this.error, serial: this.serial, uart_receiver: this.receiver, uart_frames: this.uartFrames.slice(), instruments: this.physics.snapshot(), events: this.events.slice(), adc: this.adcReads.slice(), i2c: this.i2c.slice(), electrical: this.electric, led_trace: this.ledTrace.slice(), input_events: this.inputEvents.slice(), inputs: { ...this.inputs }, trace_truncated: !!this.truncated, unknown_adc: [...this.analogUnknown], instructions: this.instructions };
    }
  };

  // src/programmable_circuit/network.mjs
  var UartPairRuntime = class {
    constructor(p, fw) {
      validate(p);
      if (!p.peer || !fw.peer) throw Error("Compile both boards before running.");
      this.p = p;
      this.messages = [];
      this.queue = [];
      this._paused = false;
      this.wallStart = Date.now();
      const { peer, network_connected, ...main } = p;
      this.r = [new CircuitRuntime(main, fw), new CircuitRuntime(peer, fw.peer)];
    }
    start() {
      this.r.forEach((r) => r.start());
      this.r.forEach((r, i) => {
        const original = r.uartTx.bind(r);
        r.uartTx = (value, baud) => {
          original(value, baud);
          this.transfer(i, value);
        };
      });
      return this;
    }
    transfer(i, value) {
      const a = this.r[i], b = this.r[1 - i], time = a.time();
      let reason = "";
      if (!this.p.network_connected) reason = "UART cable disconnected";
      else if (!peripheralConnection(a.p, "uart", { D1: "RX", D0: "TX" }) || !peripheralConnection(b.p, "uart", { D1: "RX", D0: "TX" })) reason = "Wire both UART terminals: MCU TX to RX, MCU RX to TX, power and common ground";
      const frame = uartFrame(value, a.uartConfig(), b.uartConfig(), { seed: 1, index: this.messages.length, noise_ppm: 0 });
      if (!reason && !frame.ok) reason = "UART frame settings incompatible";
      if (this.messages.length < 256) this.messages.push({ t_us: time, from: i, to: 1 - i, sent: value, received: reason ? null : frame.value, reason: reason || "Delivered to receiving MCU UART", ...{ frame } });
      if (!reason && this.queue.length < 128) this.queue.push({ t: time, to: 1 - i, value: frame.value });
    }
    get active() {
      return this.r.some((r) => r.active);
    }
    get paused() {
      return this._paused;
    }
    set paused(x) {
      this._paused = x;
    }
    step(budget = 3e4) {
      if (this.paused) return this.snapshot();
      for (let n = 0; n < budget && this.active; n += 100) {
        const choices = this.r.map((r2, i2) => ({ r: r2, i: i2 })).filter((x) => x.r.active).sort((a, b) => a.r.time() - b.r.time()), { r, i } = choices[0];
        for (let k = 0; k < this.queue.length; ) {
          const q = this.queue[k];
          if (q.to === i && q.t <= r.time() && !r.uart.rxBusy) {
            if (!r.uart.writeByte(q.value)) {
              if (this.messages.length < 256) this.messages.push({ t_us: r.time(), to: i, reason: "Receiver disabled; byte not accepted" });
            }
            this.queue.splice(k, 1);
          } else k++;
        }
        r.step(100);
        if (r.error) {
          this.stop("One board failed");
          break;
        }
        if (Date.now() - this.wallStart > 6e4) {
          this.stop("Pair wall-time budget reached");
          break;
        }
      }
      return this.snapshot();
    }
    stop(reason = "Stopped by learner") {
      this.r.forEach((r) => r.stop(reason));
    }
    input(id, value) {
      const peer = id.startsWith("peer:");
      this.r[peer ? 1 : 0].input(peer ? id.slice(5) : id, value);
    }
    rx(text) {
      this.r[0].rx(text);
    }
    snapshot() {
      return { ...this.r[0].snapshot(), active: this.active, paused: this.paused, peer: this.r[1].snapshot(), network: { protocol: "UART0", connected: this.p.network_connected, mode: "Two independently executing AVR firmwares; crossed terminal cable with common ground", messages: this.messages, pending: this.queue.length, limits: "Two AVR boards; UART byte/frame coupling, bounded cooperative scheduling; not shared analog power, SPI or multi-master I2C." } };
    }
  };

  // src/programmable_circuit/worker.mjs
  var runtime = null;
  var timer = null;
  var last = 0;
  function pump() {
    if (!runtime || !runtime.active || runtime.paused) return;
    const out = runtime.step(3e4);
    if (!out.active || Date.now() - last > 100) {
      postMessage({ type: "state", state: out });
      last = Date.now();
    }
    if (out.active) timer = setTimeout(pump, 0);
  }
  self.onmessage = (e) => {
    try {
      const q = e.data;
      if (q.action === "start") {
        clearTimeout(timer);
        runtime?.stop("New run");
        runtime = new (q.project.peer ? UartPairRuntime : CircuitRuntime)(q.project, q.firmware).start();
        pump();
      } else if (q.action === "stop") {
        clearTimeout(timer);
        runtime?.stop();
        if (runtime) postMessage({ type: "state", state: runtime.snapshot() });
      } else if (q.action === "pause") {
        clearTimeout(timer);
        runtime.paused = !runtime.paused;
        if (!runtime.paused) pump();
        else postMessage({ type: "state", state: runtime.snapshot() });
      } else if (q.action === "input") {
        runtime.input(q.id, q.value);
      } else if (q.action === "rx") runtime.rx(q.text);
    } catch (e2) {
      runtime?.stop("Error");
      postMessage({ type: "error", message: e2.message });
    }
  };
})();
