import {solve,params,railVoltage,endpoint,logicThresholds} from './graph.mjs';
import {sensorVoltage,sineVoltage,motorStep,bounceSchedule,PHYSICS_VERSION} from './physics.mjs';
export class CircuitDynamics {
 constructor(p,duration){this.p=p;this.time=0;this.drives={};this.capacitors={};this.outputs={};this.motors={};this.queue=[];this.trace=[];this.edges=[];this.lastLogic={};this.readings={};this.nextSample=0;this.samplePeriod=Math.max(50,duration*1e6/1800);this.dynamic=p.parts.some(a=>['capacitor','sensor','generator','motor'].includes(a.type));this.enabled=this.dynamic||p.parts.some(a=>['meter','scope','logic','display'].includes(a.type)||params(a).bounce_ms>0);this.current=null;}
 command(id,pressed,t){const a=this.p.parts.find(x=>x.id===id),q=params(a);this.queue=this.queue.filter(x=>x.id!==id);this.queue.push(...bounceSchedule(t,pressed,q.bounce_ms,q.seed).map(x=>({...x,id})));this.queue.sort((a,b)=>a.t_us-b.t_us);}
 due(t){return(this.dynamic&&t-this.time>=50)||(this.queue.length&&this.queue[0].t_us<=t)||(this.enabled&&t>=this.nextSample);}
 sources(t,dt){const rail=railVoltage(this.p.board_type);for(const a of this.p.parts){const q=params(a),v=pin=>this.current?.values[endpoint(a.id,pin)];
  if(a.type==='sensor')this.outputs[a.id]=v('VCC')>=2.7&&v('GND')===0?sensorVoltage(q,t*1e-6,rail):undefined;
  if(a.type==='generator')this.outputs[a.id]=sineVoltage(q,t*1e-6);
  if(a.type==='motor'){
   const powered=v('VCC')>=2.7&&v('GND')===0,logic=v('IN'),high=logic!==null&&logic>=logicThresholds(this.p.board_type).high;
   const volts=powered&&high?q.supply_v:0,old=this.motors[a.id]||{current_a:0,omega_rad_s:0};
   const result=motorStep(old,q,volts,dt);if(result.omega_rad_s<0&&volts>=0)result.omega_rad_s=0;
   this.motors[a.id]={...result,drive_v:volts,external_supply_v:q.supply_v};this.outputs[a.id]=powered?Math.max(0,Math.min(rail,result.omega_rad_s/q.feedback_rad_s_v)):undefined;
  }
 }}
 update(t,drives){t=Math.max(0,t);if(!this.enabled)return solve(this.p,drives);if(!this.current)this.current=solve(this.p,drives);
  while(this.time<t-1e-7){const next=Math.min(t,this.time+50,this.queue.length?Math.max(this.time,this.queue[0].t_us):Infinity),dt=(next-this.time)*1e-6;
   if(dt>0){this.sources(next,dt);this.current=solve(this.p,this.drives,{dt,capacitors:this.capacitors,outputs:this.outputs});Object.assign(this.capacitors,this.current.capacitors);this.time=next;}
   while(this.queue.length&&this.queue[0].t_us<=this.time+1e-7){const e=this.queue.shift();this.p.parts.find(a=>a.id===e.id).params.pressed=e.pressed;}
  }
  while(this.queue.length&&this.queue[0].t_us<=t+1e-7){const e=this.queue.shift();this.p.parts.find(a=>a.id===e.id).params.pressed=e.pressed;}
  this.sources(t,0);this.drives={...drives};this.current=solve(this.p,drives,{dt:1e-9,capacitors:this.capacitors,outputs:this.outputs});
  const values=this.current.values,rail=railVoltage(this.p.board_type);for(const a of this.p.parts){const v=pin=>values[endpoint(a.id,pin)];
   if(['meter','scope','logic'].includes(a.type)){const pin=a.type==='meter'?'PLUS':a.type==='scope'?'CH1':'IN',g=a.type==='meter'?'COM':'GND';const volts=Number.isFinite(v(pin))&&Number.isFinite(v(g))?v(pin)-v(g):null;this.readings[a.id]={kind:a.type,volts,input_ohms:a.type==='scope'?1e6:1e7};if(a.type==='logic'){const th=logicThresholds(this.p.board_type),state=volts===null?null:volts<=th.low?0:volts>=th.high?1:null;this.readings[a.id].logic=state;if(this.lastLogic[a.id]!==state&&this.edges.length<8000){this.edges.push({id:a.id,t_us:t,value:state});this.lastLogic[a.id]=state;}}}
   if(a.type==='display'){const powered=v('GND')===0&&v('VCC')>=2.7,th=logicThresholds(this.p.board_type),bits=Array.from({length:8},(_,i)=>!powered||v('D'+i)===null?null:v('D'+i)>=th.high?1:v('D'+i)<=th.low?0:null);this.readings[a.id]={kind:'display',powered,bits,value:bits.every(x=>x!==null)?bits.reduce((v,b,i)=>v+(b<<i),0):null};}
   if(a.type==='sensor')this.readings[a.id]={kind:'sensor',volts:v('OUT'),reference_temperature_c:params(a).temperature_c,reference_kind:'controlled_virtual_condition'};
   if(a.type==='motor')this.readings[a.id]={kind:'motor',...this.motors[a.id],feedback_v:v('SPEED')};
  }
  if(t>=this.nextSample&&this.trace.length<2000){this.trace.push({t_us:t,values:Object.fromEntries(Object.entries(this.readings).map(([id,r])=>[id,r.volts??r.feedback_v??r.value??null]))});this.nextSample=t+this.samplePeriod;}
  return this.current;
 }
 snapshot(){return{model_version:PHYSICS_VERSION,readings:this.readings,trace:this.trace,logic_edges:this.edges,sample_period_us:this.samplePeriod,integration_max_step_us:50,trace_truncated:this.trace.length>=2000,motors:this.motors};}
}
