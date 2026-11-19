/* Original low-voltage modified nodal solver, quasistatic semiconductor models.
 * NPN: Ebers-Moll, MOS: square-law + body diode, op-amp: finite gain/output R.
 * No claim of named-part SPICE equivalence, temperature/noise or RF parasitics.
 */
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
function gaussian(A,b){const n=b.length;for(let k=0;k<n;k++){let m=k;for(let i=k+1;i<n;i++)if(Math.abs(A[i][k])>Math.abs(A[m][k]))m=i;if(Math.abs(A[m][k])<1e-18)throw Error('Active circuit has a floating or singular node.');[A[k],A[m]]=[A[m],A[k]];[b[k],b[m]]=[b[m],b[k]];const d=A[k][k];for(let j=k;j<n;j++)A[k][j]/=d;b[k]/=d;for(let i=0;i<n;i++)if(i!==k){const f=A[i][k];for(let j=k;j<n;j++)A[i][j]-=f*A[k][j];b[i]-=f*b[k];}}return b;}
export function solveActive(p,drives,dynamic,ctx){
 const {nl,pins,rail,profile}=ctx, net=nl.net,node=(id,pin)=>net.get(id+':'+pin),g=nl.ground,fixed=new Map([[g,0]]),used=new Set(),warnings=[];
 const fix=(n,v)=>{if(fixed.has(n)&&Math.abs(fixed.get(n)-v)>1e-6)throw Error('Conflicting voltage sources; correct the circuit.');fixed.set(n,v);};
 for(const pin of pins){const n=node(nl.board,pin.id);if(pin.mode==='power'&&!['VBUS','VSYS'].includes(pin.id))fix(n,pin.id==='3V3'?3.3:rail);if(pin.id==='ADC_VREF')fix(n,3.3);if(drives[pin.id]===0||drives[pin.id]===1)fix(n,drives[pin.id]*rail);}
 for(const a of p.parts){if(a.type==='board')continue;for(const e of net.keys())if(e.startsWith(a.id+':'))used.add(net.get(e));if(!['resistor','pot','button','capacitor','meter','scope','logic','digital','pwm','led','npn','nmos','opamp','source','motor_supply','rail','breadboard'].includes(a.type))throw Error('This active analog solver does not yet support mixing '+a.type+' into the same circuit.');if(a.type==='source'&&node(a.id,'GND')===g)fix(node(a.id,'OUT'),a.params.volts);if(a.type==='motor_supply'&&node(a.id,'GND')===g)fix(node(a.id,'OUT'),a.params.supply_v);}
 // Floating unused pins remain null; connected active-device pins require a DC path.
 const unknown=[...used].filter(n=>!fixed.has(n)),ix=new Map(unknown.map((n,i)=>[n,i]));let x=unknown.map(()=>0);
 function currents(v){const out=new Map([...used].map(n=>[n,0]));const put=(a,b,i)=>{if(!Number.isFinite(i))throw Error('Non-finite model current');out.set(a,(out.get(a)||0)+i);out.set(b,(out.get(b)||0)-i);};const val=n=>fixed.has(n)?fixed.get(n):v[ix.get(n)]??0;const R=(a,b,r,off=0)=>put(a,b,(val(a)-val(b)-off)/r);
  for(const pin of pins){if(drives[pin.id]===3)R(node(nl.board,pin.id),node(nl.board,profile.power_pin),50000);if(drives[pin.id]===4)R(node(nl.board,pin.id),g,50000);}
  for(const a of p.parts){const q=a.params,n=k=>node(a.id,k),V=k=>val(n(k)),diode=d=>q.is_a*(Math.exp(clamp(d/.02585,-50,35))-1);
   if(a.type==='resistor')R(n('1'),n('2'),q.ohms);
   if(a.type==='pot'){R(n('VCC'),n('OUT'),Math.max(1,q.ohms*(1-q.position)));R(n('OUT'),n('GND'),Math.max(1,q.ohms*q.position));}
   if(a.type==='button'&&q.pressed)R(n('1'),n('2'),1);
   if(a.type==='capacitor'&&dynamic)R(n('1'),n('2'),(dynamic.dt||1e-9)/(q.capacitance_uf*1e-6),dynamic.capacitors[a.id]??q.initial_v);
   if(['meter','scope','logic'].includes(a.type))R(n(a.type==='meter'?'PLUS':a.type==='scope'?'CH1':'IN'),n(a.type==='meter'?'COM':'GND'),a.type==='scope'?1e6:1e7);
   if(['digital','pwm'].includes(a.type))R(n('IN'),n('GND'),q.ohms);
   if(a.type==='led')put(n('A'),n('K'),Math.max(0,(V('A')-V('K')-q.vf)/10));
   if(a.type==='npn'){const f=diode(V('B')-V('E')),r=diode(V('B')-V('C')),af=q.beta/(q.beta+1),ar=.5;put(n('C'),n('E'),af*f-ar*r);put(n('B'),n('E'),(1-af)*f);put(n('B'),n('C'),(1-ar)*r);}
   if(a.type==='nmos'){const aV=V('D'),bV=V('S'),reverse=aV<bV,vs=reverse?aV:bV,vd=reverse?bV:aV,over=V('G')-vs-q.threshold_v,d=vd-vs;const i=over<=0?0:q.kp_a_v2*(d<over?over*d-d*d/2:over*over/2);put(n('D'),n('S'),reverse?-i:i);put(n('S'),n('D'),1e-14*(Math.exp(clamp((bV-aV)/.02585,-50,35))-1));R(n('G'),n('S'),1e12);}
   if(a.type==='opamp'){const low=V('GND'),high=V('VCC');if(high-low<1)throw Error('Connect op-amp supply and ground.');const target=clamp(q.open_gain*(V('PLUS')-V('MINUS')),low+q.headroom_v,high-q.headroom_v);put(n('OUT'),n('GND'),(V('OUT')-target)/q.output_ohms);R(n('PLUS'),n('GND'),1e12);R(n('MINUS'),n('GND'),1e12);}
  }return out;
 }
 let converged=false,iterations=0;
 const residual=v=>{const c=currents(v);return unknown.map(n=>c.get(n)||0);},norm=r=>Math.max(0,...r.map(Math.abs));
 for(;iterations<120;iterations++){const r=residual(x);if(norm(r)<1e-9){converged=true;break;}const J=unknown.map(()=>unknown.map(()=>0));for(let j=0;j<x.length;j++){const y=x.slice(),h=1e-6;y[j]+=h;const rr=residual(y);for(let i=0;i<x.length;i++)J[i][j]=(rr[i]-r[i])/h;}const step=gaussian(J,r.map(v=>-v));let scale=Math.min(1,.2/Math.max(.2,...step.map(Math.abs))),found=false;for(let k=0;k<18;k++,scale*=.5){const y=x.map((v,i)=>v+scale*step[i]);if(norm(residual(y))<norm(r)){x=y;found=true;break;}}if(!found)break;}
 if(!converged)throw Error('Active circuit did not converge; no valid result issued. Check bias and wiring.');
 const val=n=>fixed.has(n)?fixed.get(n):ix.has(n)?x[ix.get(n)]:null,values=Object.fromEntries([...net].map(([e,n])=>[e,val(n)])),leds=[],capacitors={};
 for(const a of p.parts){const V=k=>values[a.id+':'+k];if(a.type==='led'){const i=Math.max(0,(V('A')-V('K')-a.params.vf)/10)*1000;if(i>20.01)throw Error('LED current exceeds 20 mA teaching budget.');leds.push({id:a.id,current_ma:i,on:i>.2});}if(a.type==='capacitor')capacitors[a.id]=V('1')-V('2');if(a.type==='resistor'&&(V('1')-V('2'))**2/a.params.ohms>.25001)throw Error('Resistor exceeds 0.25 W teaching rating.');}
 const c=currents(x);let total=0;for(const pin of pins){const n=node(nl.board,pin.id),v=val(n);if(['analog','digital'].includes(pin.mode)&&v!==null&&(v<-.05||v>rail+.05))throw Error('MCU pin voltage outside selected board rails.');if([0,1].includes(drives[pin.id])){const i=Math.abs(c.get(n)||0);if(i>(rail>4?.02001:.01201))throw Error('MCU output current budget exceeded.');total+=i;}}if(total>.05001)throw Error('Combined GPIO current budget exceeded.');
 warnings.push('Quasistatic teaching semiconductor models: no named-part, thermal, noise or high-frequency validation.');
 return{values,leds,capacitors,warnings,nets:nl.groups,ground:g,active_solver:{converged,iterations,max_kcl_error_a:norm(residual(x))}};
}
