import {CircuitRuntime} from './engine.mjs';
import {validate,peripheralConnection} from './graph.mjs';
import {uartFrame} from './physics.mjs';
export class UartPairRuntime{
 constructor(p,fw){validate(p);if(!p.peer||!fw.peer)throw Error('Compile both boards before running.');this.p=p;this.messages=[];this.queue=[];this._paused=false;this.wallStart=Date.now();const {peer,network_connected,...main}=p;this.r=[new CircuitRuntime(main,fw),new CircuitRuntime(peer,fw.peer)];}
 start(){this.r.forEach(r=>r.start());this.r.forEach((r,i)=>{const original=r.uartTx.bind(r);r.uartTx=(value,baud)=>{original(value,baud);this.transfer(i,value);};});return this;}
 transfer(i,value){const a=this.r[i],b=this.r[1-i],time=a.time();let reason='';
  if(!this.p.network_connected)reason='UART cable disconnected';
  else if(!peripheralConnection(a.p,'uart',{D1:'RX',D0:'TX'})||!peripheralConnection(b.p,'uart',{D1:'RX',D0:'TX'}))reason='Wire both UART terminals: MCU TX to RX, MCU RX to TX, power and common ground';
  const frame=uartFrame(value,a.uartConfig(),b.uartConfig(),{seed:1,index:this.messages.length,noise_ppm:0});if(!reason&&!frame.ok)reason='UART frame settings incompatible';
  if(this.messages.length<256)this.messages.push({t_us:time,from:i,to:1-i,sent:value,received:reason?null:frame.value,reason:reason||'Delivered to receiving MCU UART',...{frame}});
  if(!reason&&this.queue.length<128)this.queue.push({t:time,to:1-i,value:frame.value});
 }
 get active(){return this.r.some(r=>r.active);}get paused(){return this._paused;}set paused(x){this._paused=x;}
 step(budget=30000){if(this.paused)return this.snapshot();for(let n=0;n<budget&&this.active;n+=100){
  const choices=this.r.map((r,i)=>({r,i})).filter(x=>x.r.active).sort((a,b)=>a.r.time()-b.r.time()),{r,i}=choices[0];
  for(let k=0;k<this.queue.length;){const q=this.queue[k];if(q.to===i&&q.t<=r.time()&&!r.uart.rxBusy){if(!r.uart.writeByte(q.value)){if(this.messages.length<256)this.messages.push({t_us:r.time(),to:i,reason:'Receiver disabled; byte not accepted'});}this.queue.splice(k,1);}else k++;}
  r.step(100);if(r.error){this.stop('One board failed');break;}if(Date.now()-this.wallStart>60000){this.stop('Pair wall-time budget reached');break;}
 }return this.snapshot();}
 stop(reason='Stopped by learner'){this.r.forEach(r=>r.stop(reason));}
 input(id,value){const peer=id.startsWith('peer:');this.r[peer?1:0].input(peer?id.slice(5):id,value);}
 rx(text){this.r[0].rx(text);}
 snapshot(){return{...this.r[0].snapshot(),active:this.active,paused:this.paused,peer:this.r[1].snapshot(),network:{protocol:'UART0',connected:this.p.network_connected,mode:'Two independently executing AVR firmwares; crossed terminal cable with common ground',messages:this.messages,pending:this.queue.length,limits:'Two AVR boards; UART byte/frame coupling, bounded cooperative scheduling; not shared analog power, SPI or multi-master I2C.'}};}
}
