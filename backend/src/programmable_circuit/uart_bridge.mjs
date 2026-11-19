/* PL011 bounded byte adapter: an empty TX FIFO interrupt clears with TXIC.
 * Upstream rp2040js 1.4.1 unconditionally reasserts TX on every ICR write,
 * causing MicroPython UART IRQ starvation. Preserve RX, rearm TX only after
 * a real firmware DR write completes one configured 8N1 byte interval.
 * Byte/event model, not an analog UART waveform or FIFO fidelity claim.
 */
export function attachPicoUART(m,uart,onByte){
 const TX=1<<5;
 uart.checkInterrupts=()=>m.setInterrupt(uart.irq,!!(uart.interruptStatus&uart.interruptMask));
 uart.onByte=value=>{
  onByte(value);
  const baud=uart.baudRate;
  if(baud>0)m.clock.createAlarm(()=>{uart.interruptStatus|=TX;uart.checkInterrupts();}).schedule(1e9*10/baud);
 };
}
