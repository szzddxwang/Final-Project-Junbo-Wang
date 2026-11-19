import {example,isAVR} from './graph.mjs';
export function uartPair(board='uno_r3'){
 if(!isAVR(board))throw Error('Two-board UART currently supports AVR boards.');
 const p=example(board,'UART'),peer=example('uno_r3','UART');p.name='Two boards: message and acknowledgement';p.task='UART_PAIR';p.source='void setup(){Serial.begin(9600);}\nvoid loop(){Serial.println("HELLO");delay(100);}\n';
 peer.name='Receiver board';peer.source='void setup(){Serial.begin(9600);}\nvoid loop(){while(Serial.available()){if(Serial.read()==10)Serial.println("ACK");}}\n';p.peer=peer;p.network_connected=true;return p;
}
