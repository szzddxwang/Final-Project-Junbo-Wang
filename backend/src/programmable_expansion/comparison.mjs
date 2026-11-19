/* Compare recorded MCU observations; never infer unobserved component faults. */
export function electricalDefinition(p){return {...(p.peer?{peer:electricalDefinition(p.peer),network_connected:p.network_connected}:{}),board:p.board_type,parts:p.parts.map(a=>({id:a.id,type:a.type,params:a.params})).sort((a,b)=>a.id.localeCompare(b.id)),wires:p.wires.map(w=>[w.a,w.b].sort()).sort((a,b)=>a.join('|').localeCompare(b.join('|')))};}
export function captureMetrics(run){
 const s=run.state,rows={};
 for(const [id,r] of Object.entries(s.instruments?.readings||{}))for(const [key,unit] of [['volts','V'],['feedback_v','V'],['current_a','A'],['omega_rad_s','rad/s']])if(Number.isFinite(r[key]))rows[id+' '+key+' ('+unit+')']=r[key];
 rows['UART framing or parity failures (frames)']=(s.uart_frames||[]).filter(r=>!r.ok).length;
 for(const a of s.adc||[])if(!a.unknown&&Number.isFinite(a.volts))rows['ADC channel '+a.channel+' (V)']=a.volts;
 for(const l of s.led_trace||[])if(Number.isFinite(l.current_ma))rows[l.id+' peak current (mA)']=Math.max(rows[l.id+' peak current (mA)']||0,l.current_ma);
 for(const pin of [...new Set((s.events||[]).filter(e=>e.state===0||e.state===1).map(e=>e.pin))]){
  const e=s.events.filter(e=>e.pin===pin&&(e.state===0||e.state===1)),r=e.filter((x,i)=>x.state===1&&(i===0||e[i-1].state===0));
  if(r.length>1){const periods=r.slice(1).map((x,i)=>x.t_us-r[i].t_us).filter(x=>x>0).sort((a,b)=>a-b);if(periods.length)rows[pin+' frequency (Hz)']=1e6/periods[Math.floor(periods.length/2)];}
 }
 rows['I2C acknowledged addresses (count)']=(s.i2c||[]).filter(e=>e.kind==='address'&&e.ack).length;
 rows['Wired UART received (bytes)']=(s.uart_receiver||'').length;
 if(s.peer)for(const [key,value]of Object.entries(captureMetrics({state:s.peer})))rows['Receiver · '+key]=value;
 if(s.peer)rows['Receiver serial output (characters)']=(s.peer.serial||'').length;
 return rows;
}
export function compareCaptures(a,b){
 const compatible=a.project.board_type===b.project.board_type&&a.state.simulator_version===b.state.simulator_version&&(a.project.peer?.board_type||null)===(b.project.peer?.board_type||null);
 const x=captureMetrics(a),y=captureMetrics(b),parameters=[];
 for(const part of b.project.parts){const old=a.project.parts.find(p=>p.id===part.id&&p.type===part.type);if(!old)continue;for(const key of new Set([...Object.keys(old.params),...Object.keys(part.params)]))if(old.params[key]!==part.params[key])parameters.push({part:part.id,parameter:key,before:old.params[key],after:part.params[key]});}
 const source_changed=a.source_sha256!==b.source_sha256||a.peer_source_sha256!==b.peer_source_sha256,topology_changed=JSON.stringify(electricalDefinition(a.project))!==JSON.stringify(electricalDefinition(b.project));
 return {compatible,source_changed,topology_changed,serial_changed:a.state.serial!==b.state.serial||a.state.peer?.serial!==b.state.peer?.serial,parameters,same_capture_duration:Math.abs(a.state.t_us-b.state.t_us)<1000,measurements:compatible?[...new Set([...Object.keys(x),...Object.keys(y)])].map(k=>({name:k,before:x[k]??null,after:y[k]??null,delta:Number.isFinite(x[k])&&Number.isFinite(y[k])?y[k]-x[k]:null})):[]};
}
