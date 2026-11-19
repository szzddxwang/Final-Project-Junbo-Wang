/* Original bounded models. Simulated time only; no hidden hardware measurements. */
export class DS1307 {
 constructor(q,clock=()=>0){this.q=q;this.clock=clock;this.base=Date.UTC(2026,0,1,q.hour,q.minute,q.second);this.epoch=clock();this.reg=0;this.ram=new Uint8Array(64);this.halted=false;this.hour12=false;this.weekdayOffset=0;}
 bcd(n){return ((Math.floor(n/10)<<4)|(n%10));} dec(n){return (n>>4)*10+(n&15);}
 now(){return new Date(this.base+(this.halted?0:(this.clock()-this.epoch)/1000));}
 refresh(){const d=this.now();this.ram.set([this.bcd(d.getUTCSeconds())|(this.halted?128:0),this.bcd(d.getUTCMinutes()),this.hour12?(64|(d.getUTCHours()>=12?32:0)|this.bcd(d.getUTCHours()%12||12)):this.bcd(d.getUTCHours()),(d.getUTCDay()+this.weekdayOffset)%7+1,this.bcd(d.getUTCDate()),this.bcd(d.getUTCMonth()+1),this.bcd(d.getUTCFullYear()%100)]);}
 start(read){this.first=!read;this.refresh();} stop(){}
 writeByte(v){if(this.first){this.reg=v&63;this.first=false;return true;}const r=this.reg,b=this.ram.slice();b[r]=v;
  if(r<7){const z=v&([127,127,63,7,63,31,255][r]);const digits=r===2&&(v&64)?v&31:z;if(r!==3&&((digits&15)>9||(digits>>4)>9))return false;
   const sec=this.dec(b[0]&127),min=this.dec(b[1]&127),raw=b[2],twelve=this.dec(raw&31);let hour=this.dec(raw&63);if(raw&64)hour=(twelve%12)+(raw&32?12:0);
   const year=2000+this.dec(b[6]),month=this.dec(b[5]),day=this.dec(b[4]);
   if(sec>59||min>59||hour>23||((raw&64)&&(twelve<1||twelve>12))||b[3]<1||b[3]>7||day<1||day>31||month<1||month>12)return false;
   const base=Date.UTC(year,month-1,day,hour,min,sec);if(new Date(base).getUTCMonth()!==month-1)return false;
   this.weekdayOffset=(b[3]-1-new Date(base).getUTCDay()+7)%7;
   this.base=base;this.epoch=this.clock();this.halted=!!(b[0]&128);this.hour12=!!(b[2]&64);
  }this.ram=b;this.reg=(r+1)&63;return true;
 }
 readByte(){const v=this.ram[this.reg];this.reg=(this.reg+1)&63;return v;}
 snapshot(){return{type:'ds1307',time:this.now().toISOString(),halted:this.halted,clock_source:'simulation time',limitations:'24/12-hour BCD registers and RAM; no battery aging or SQW output'};}
}
export function dhtFrame(temperature,humidity){const h=Math.round(humidity*10),t=Math.round(Math.abs(temperature)*10)|(temperature<0?0x8000:0),a=[h>>8,h&255,t>>8,t&255];return [...a,a.reduce((s,v)=>s+v,0)&255];}
export function dhtEdges(t,bytes){const out=[{t:t+20,value:0},{t:t+100,value:1},{t:t+180,value:0}];let now=t+180;for(const b of bytes)for(let bit=7;bit>=0;bit--){now+=50;out.push({t:now,value:1});now+=(b>>bit)&1?70:26;out.push({t:now,value:0});}out.push({t:now+50,value:1});return out;}
export class DHT22 {
 constructor(q){this.q=q;this.low=null;this.last=-Infinity;this.queue=[];this.value=null;this.frames=0;this.reason='Waiting for start pulse';}
 update(t,drive,powered,pullup){
  if(!powered||!pullup){this.queue=[];this.value=null;this.low=null;this.reason='Connect supply, ground and DATA pull-up';return null;}
  if(drive===0){if(this.low===null)this.low=t;}else if(this.low!==null){if(t-this.low>=1000&&t-this.last>=2e6){this.queue=dhtEdges(t,dhtFrame(this.q.temperature_c,this.q.humidity_pct));this.last=t;this.frames++;this.reason='Responding to firmware start pulse';}this.low=null;}
  while(this.queue.length&&this.queue[0].t<=t)this.value=this.queue.shift().value;
  if(!this.queue.length&&this.value===1)this.value=null;
  return this.value;
 }
 snapshot(){return{type:'dht22',frames:this.frames,reason:this.reason,reference_temperature_c:this.q.temperature_c,reference_humidity_pct:this.q.humidity_pct};}
}
export class StepperDriver {
 constructor(q){this.q=q;this.last=false;this.steps=0;this.position=0;this.pulses=0;this.rejected=0;this.lastRise=-Infinity;this.fault='';}
 update(t,{step,dir,enabled,powered,microstep=1}){if(step&&!this.last){this.pulses++;const dt=t-this.lastRise;this.lastRise=t;if(!powered||!enabled){this.rejected++;this.fault='Driver disabled or supply absent';}else if(dt<2){this.rejected++;this.fault='STEP period below supported driver timing';}else{const sign=dir?1:-1;this.steps+=sign/microstep;this.position=this.steps*this.q.step_angle_deg;this.fault='';}}this.last=step;}
 snapshot(){return{type:'a4988_stepper',position_deg:this.position,full_steps:this.steps,pulses:this.pulses,rejected_pulses:this.rejected,fault:this.fault,model:'Commanded position with driver timing; load torque, acceleration stalls and coil-current regulation are not modeled'};}
}
