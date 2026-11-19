import {DHT22,StepperDriver} from './teaching_devices.mjs';
import {netlist,boardPins,params} from './graph.mjs';
export class TimedPeripherals {
 constructor(p){this.p=p;this.nl=netlist(p);this.devices=new Map();this.override={};for(const a of p.parts){if(a.type==='dht22')this.devices.set(a.id,new DHT22(params(a)));if(a.type==='a4988_stepper')this.devices.set(a.id,new StepperDriver(params(a)));}}
 tick(t,states,electric){if(!this.devices.size||!electric)return false;const next={},v=(a,k)=>electric.values[a+':'+k], high=x=>x!==null&&x>=2;
  for(const [id,d]of this.devices){const powered=v(id,'VCC')>=2.7&&v(id,'GND')===0;if(d instanceof DHT22){const net=this.nl.net.get(id+':DATA'),pin=boardPins(this.p.board_type).find(k=>this.nl.net.get(this.nl.board+':'+k.id)===net);if(!pin)continue;const pulled=this.p.parts.some(a=>a.type==='resistor'&&['1','2'].some(k=>this.nl.net.get(a.id+':'+k)===net&&v(a.id,k==='1'?'2':'1')>=2.7));const level=d.update(t,states[pin.id],powered,pulled);if(level!==null&&states[pin.id]>=2)next[pin.id]=level;}
   else{const bits=(high(v(id,'MS1'))?1:0)|(high(v(id,'MS2'))?2:0)|(high(v(id,'MS3'))?4:0),microstep=({0:1,1:2,2:4,3:8,7:16})[bits];if(!microstep){d.fault='Unsupported A4988 microstep combination';continue;}d.update(t,{step:high(v(id,'STEP')),dir:high(v(id,'DIR')),enabled:v(id,'ENABLE')!==null&&v(id,'ENABLE')<.8,powered:powered&&v(id,'VMOT')>=8&&v(id,'VMOT')<=24&&v(id,'PGND')===0,microstep});}
  }
  const changed=JSON.stringify(next)!==JSON.stringify(this.override);this.override=next;return changed;
 }
 snapshot(){return Object.fromEntries([...this.devices].map(([id,d])=>[id,d.snapshot()]));}
}
