/* Bounded, explicit teaching models. Units SI unless named otherwise. */
export const PHYSICS_VERSION='microexplore-physics-v1';
export function uniform(seed,index){let x=(Math.imul((seed|0)^0x9e3779b9,(index|0)+1))>>>0;x^=x>>>16;x=Math.imul(x,0x7feb352d);x^=x>>>15;x=Math.imul(x,0x846ca68b);return((x^(x>>>16))>>>0)/4294967296;}
export function sensorVoltage(q,t,rail){const noise=(uniform(q.seed??1,Math.floor(t*1000))*2-1)*(q.noise_v??0);return Math.max(0,Math.min(rail,((q.temperature_c??25)*.01+.5)*(q.gain??1)+(q.bias_v??0)+(q.drift_v_s??0)*t+noise));}
export function sineVoltage(q,t){return q.offset_v+q.amplitude_v*Math.sin(2*Math.PI*q.frequency_hz*t);}
export function bounceSchedule(now,pressed,duration_ms,seed=1){if(!duration_ms)return[{t_us:now,pressed}];const out=[];let time=now,state=pressed;for(let i=0;i<8;i++){out.push({t_us:time,pressed:state});time+=duration_ms*1000*(.04+.06*uniform(seed,i));state=!state;}out.push({t_us:now+duration_ms*1000,pressed});return out.sort((a,b)=>a.t_us-b.t_us);}
export function i2cQuality({ohms,capacitance_pf,frequency_hz,volts,sink_ma=3,high_us}){
 const rc=ohms*capacitance_pf*1e-12,tr=rc*Math.log(7/3),limit=frequency_hz<=100000?1e-6:frequency_hz<=400000?300e-9:120e-9;
 const high=high_us===undefined?.5/frequency_hz:high_us*1e-6,threshold=rc*-Math.log(.3),low=Math.max(0,volts-sink_ma*.001*ohms);
 const valid=Number.isFinite(ohms)&&ohms>0&&frequency_hz>0&&frequency_hz<=1e6;
 return{pullup_ohms:Number.isFinite(ohms)?ohms:null,capacitance_pf,frequency_hz,rise_ns:valid?tr*1e9:null,rise_limit_ns:limit*1e9,high_us:high*1e6,time_to_high_ns:valid?threshold*1e9:null,low_voltage_v:valid?low:null,standard_compliant:valid&&tr<=limit&&low<=.4,usable:valid&&threshold<high&&low<=.3*volts,margin_us:valid?(high-threshold)*1e6:null};
}
const parity=(v,bits)=>{let n=0;for(let i=0;i<bits;i++)n^=(v>>i)&1;return n;};
export function uartFrame(value,tx,rx,{seed=1,index=0,noise_ppm=0}={}){
 const bits=[0,...Array.from({length:tx.bits??8},(_,i)=>(value>>i)&1)];if(tx.parity)bits.push(parity(value,tx.bits??8)^(tx.parity===2?1:0));for(let i=0;i<(tx.stop??1);i++)bits.push(1);
 if(!(tx.baud>0&&rx.baud>0))return{ok:false,reason:'clock not configured',value:null,samples:[]};
 const sample=t=>{const k=Math.floor(t*tx.baud),bit=k<0||k>=bits.length?1:bits[k];return uniform(seed,index*53+k+2)<noise_ppm/1e6?1-bit:bit;};
 const samples=Array.from({length:1+(rx.bits??8)+(rx.parity?1:0)+(rx.stop??1)},(_,i)=>{const times=[7,8,9].map(n=>(i+n/16)/rx.baud),levels=times.map(sample);return{t_us:times[1]*1e6,value:levels.reduce((a,b)=>a+b,0)>=2?1:0};});
 let decoded=0;for(let i=0;i<(rx.bits??8);i++)decoded|=samples[i+1].value<<i;
 const parityOK=!rx.parity||samples[1+(rx.bits??8)].value===(parity(decoded,rx.bits??8)^(rx.parity===2?1:0));
 const frameOK=samples[0].value===0&&samples.slice(1+(rx.bits??8)+(rx.parity?1:0)).every(x=>x.value===1);
 return{ok:frameOK&&parityOK,value:decoded,framing_error:!frameOK,parity_error:!parityOK,changed:decoded!==(value&((1<<(rx.bits??8))-1)),tx_baud:tx.baud,rx_baud:rx.baud,samples,duration_us:bits.length/tx.baud*1e6};
}
// Exact zero-order-hold two-state DC motor: L di/dt=V-Ri-ke*w,
// J dw/dt=kt*i-b*w-load. Real motor parameters must be identified separately.
export function motorStep(old,q,voltage,dt){
 if(!(dt>0))return old;const R=q.resistance_ohms,L=q.inductance_mh*.001,J=q.inertia_gcm2*1e-7,b=q.friction_uNms*1e-6,k=q.constant,load=q.load_mNm*.001;
 const a=-R/L,d=-b/J,bc=-k*k/(L*J),mu=(a+d)/2,delta2=((a-d)/2)**2+bc;
 const omega=(k*voltage/R-load)/(b+k*k/R),current=(voltage-k*omega)/R;
 let c,s;if(delta2>=0){const z=Math.sqrt(delta2),e1=Math.exp((mu+z)*dt),e2=Math.exp((mu-z)*dt);c=(e1+e2)/2;s=z>1e-12?(e1-e2)/(2*z):dt*Math.exp(mu*dt);}else{const z=Math.sqrt(-delta2),e=Math.exp(mu*dt);c=e*Math.cos(z*dt);s=e*Math.sin(z*dt)/z;}
 const x=(old.current_a??0)-current,y=(old.omega_rad_s??0)-omega;
 return{current_a:current+c*x+s*((a-mu)*x-k/L*y),omega_rad_s:omega+c*y+s*(k/J*x+(d-mu)*y)};
}
export function calibrateTwoPoint(a,b){if(![a.reference,b.reference,a.measured,b.measured].every(Number.isFinite)||Math.abs(b.reference-a.reference)<1e-9||Math.abs(b.measured-a.measured)<1e-9)throw Error('Two distinct reference and measured values are required.');const gain=(b.measured-a.measured)/(b.reference-a.reference),offset=a.measured-gain*a.reference;return{gain,offset,apply:x=>(x-offset)/gain};}
export function aliasFrequency(f,fs){if(!(f>=0&&fs>0))throw Error('Positive sample rate required.');const r=f%fs;return Math.min(r,fs-r);}
