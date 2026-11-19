'use strict';
const $ = id => document.getElementById(id);
const number = id => Number($(id).value);
const state = {adc:null, adcRequest:null, sensor:null, i2c:null, analysis:null};
function message(id, title, lines, bad=false) {
  const box = $(id); box.replaceChildren();
  const h = document.createElement('h3'); h.textContent = title; box.append(h);
  lines.forEach(line => { const p = document.createElement('p'); p.textContent = line; box.append(p); });
  box.classList.toggle('error', bad);
}
async function post(path, data) {
  const response = await fetch(path, {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(data)});
  const payload = await response.json();
  if (!response.ok) throw new Error(typeof payload.detail === 'string' ? payload.detail : JSON.stringify(payload.detail));
  return payload;
}
async function action(id, label, fn) {
  message(id, 'Running…', [label]);
  try { await fn(); } catch (error) { message(id, 'Could not complete the simulation', [error.message], true); }
}
function draw(canvasId, series) {
  const canvas=$(canvasId), ctx=canvas.getContext('2d'), w=canvas.width, h=canvas.height;
  ctx.clearRect(0,0,w,h); ctx.fillStyle='#fff';ctx.fillRect(0,0,w,h);
  const valid=series.flatMap(s=>s.values.filter(v=>v!==null && Number.isFinite(v)));
  if(!valid.length) return;
  let min=Math.min(...valid), max=Math.max(...valid); if(max-min<.001){min-=.5;max+=.5;} const pad=(max-min)*.08;min-=pad;max+=pad;
  const left=42,right=w-14,top=28,bottom=h-28;
  ctx.strokeStyle='#e7eef7';ctx.lineWidth=1;ctx.fillStyle='#74849b';ctx.font='11px Segoe UI';
  for(let i=0;i<=4;i++){let y=top+(bottom-top)*i/4;ctx.beginPath();ctx.moveTo(left,y);ctx.lineTo(right,y);ctx.stroke();ctx.fillText((max-(max-min)*i/4).toFixed(2),4,y+4);}
  series.forEach((s,k)=>{ctx.strokeStyle=s.color;ctx.lineWidth=1.8;ctx.beginPath();let drawing=false;
    s.values.forEach((value,i)=>{if(value===null || !Number.isFinite(value)){drawing=false;return;}const x=left+(right-left)*i/Math.max(s.values.length-1,1);const y=bottom-(value-min)/(max-min)*(bottom-top);if(!drawing){ctx.moveTo(x,y);drawing=true;}else ctx.lineTo(x,y);});ctx.stroke();
    const x=left+k*185;ctx.fillStyle=s.color;ctx.fillRect(x,8,11,3);ctx.fillStyle='#55667d';ctx.fillText(s.name,x+16,13);
  });
}
function adcRequest() {return {input_voltage:number('adc-input'),reference_voltage:number('adc-ref'),target_reference_voltage:number('adc-target-ref'),resolution_bits:number('adc-bits'),target_resolution_bits:number('adc-target-bits'),noise_rms_voltage:number('adc-noise'),gain:number('adc-gain'),offset_voltage:number('adc-offset'),signal_type:$('adc-signal').value};}
function showADC(data){message('adc-result',`${data.model_status.replaceAll('_',' ')} · simulated`,[
  `Simulated count: ${data.simulated_count}; intended count: ${data.expected_count}; residual: ${data.count_residual}.`,
  `Quantization step: ${data.quantization_step_v.toFixed(6)} V. Findings: ${data.engineering_findings.join(', ') || 'none'}.`,
  'Evidence source: Python simulation; analysis source: deterministic physics.']);
  draw('adc-chart',[{name:'Commanded',values:data.chart.commanded_v,color:'#2479c3'},{name:'ADC reconstructed',values:data.chart.adc_reconstructed_v,color:'#e28444'}]);}
$('adc-run').addEventListener('click',()=>action('adc-result','Computing ADC counts and waveform',async()=>{const request=adcRequest(),data=await post('/ai/device/adc/model',request);state.adc=data;state.adcRequest=request;showADC(data);}));
$('adc-estimate').addEventListener('click',()=>action('adc-result','Estimating a reference interval',async()=>{if(!state.adc)throw Error('Run the ADC model first.');const pin=state.adc.chart.pin_v[0];if(pin<=0)throw Error('The first pin voltage is at a boundary; choose a positive unsaturated sample.');const r=await post('/ai/device/adc/estimate',{input_voltage:pin,observed_count:state.adc.simulated_count,resolution_bits:state.adcRequest.resolution_bits});message('adc-result',r.status==='BOUNDED'?'Reference interval estimated':'Reference not identifiable',[r.status==='BOUNDED'?`Estimated Vref: ${r.estimate_v.toFixed(4)} V; interval: ${r.interval_v.map(x=>x.toFixed(4)).join('–')} V.`:'A boundary count cannot uniquely identify Vref.','Uses the same-sample ADC pin voltage and count; simulation only.']);}));
$('adc-compare').addEventListener('click',()=>action('adc-result','Running counterfactual simulation',async()=>{const before=adcRequest(),after={...before,reference_voltage:before.target_reference_voltage,resolution_bits:before.target_resolution_bits,gain:1,offset_voltage:0,noise_rms_voltage:.003};const r=await post('/ai/device/adc/counterfactual',{before,after});message('adc-result','Before / corrected comparison',[`Current residual: ${r.before.count_residual}; corrected residual: ${r.after.count_residual}.`,`Absolute residual improvement: ${r.absolute_residual_improvement}.`,'Both cases are software simulations.']);}));
$('sensor-run').addEventListener('click',()=>action('sensor-result','Generating and analyzing sensor signals',async()=>{const request={true_value:number('sensor-true'),step_change:number('sensor-step'),fault_type:$('sensor-fault').value,noise_rms:number('sensor-noise'),offset:number('sensor-offset'),response_seconds:number('sensor-response')};const sim=await post('/ai/sensor/simulate',request);state.sensor=sim;const result=await post('/ai/sensor/analyze',{ideal:sim.ideal,measured:sim.measured,sample_rate_hz:sim.sample_rate_hz,data_source:'PYTHON_SIMULATION'});message('sensor-result',`${result.anomaly_status} · ${result.engineering_pattern.replaceAll('_',' ')}`,[`Experimental anomaly score: ${result.anomaly_score.toFixed(3)}.`,`Injected fault: ${sim.fault_injection}; missing samples: ${(sim.dropout_fraction*100).toFixed(1)}%.`,'The fault pattern is a separate deterministic engineering interpretation.']);draw('sensor-chart',[{name:'Ideal',values:sim.ideal,color:'#1d77ba'},{name:'Measured',values:sim.measured,color:'#df7b47'}]);}));
$('pwm-run').addEventListener('click',()=>action('pwm-result','Calculating PWM behavior',async()=>{const r=await post('/ai/mcu/pwm/simulate',{frequency_hz:number('pwm-frequency'),duty_cycle:number('pwm-duty'),voltage:number('pwm-voltage')});message('pwm-result','PWM output',[`High time: ${(r.high_time_s*1000).toFixed(4)} ms; low time: ${(r.low_time_s*1000).toFixed(4)} ms.`,`Average voltage: ${r.average_voltage_v.toFixed(3)} V.`]);draw('pwm-chart',[{name:'PWM output',values:r.voltage_v,color:'#2479c3'}]);}));
$('gpio-run').addEventListener('click',()=>action('gpio-result','Resolving pin state',async()=>{const r=await post('/ai/mcu/gpio/simulate',{mode:$('gpio-mode').value,external_level:$('gpio-external').value,pull:$('gpio-pull').value});message('gpio-result',`GPIO: ${r.simulated_state}`,[`Source: ${r.state_source.replaceAll('_',' ')}.`,`Matches expected HIGH: ${r.matches_expected===null?'unknown':r.matches_expected?'yes':'no'}.`]);}));
$('i2c-run').addEventListener('click',()=>action('i2c-result','Generating I²C transaction',async()=>{const r=await post('/ai/mcu/i2c/simulate',{fault_type:$('i2c-fault').value});state.i2c=r;message('i2c-result',`I²C · ${r.engineering_status.replaceAll('_',' ')}`,[`Address: 0x${r.metadata.operating_point.address_7bit.toString(16)}; data: 0x${r.metadata.operating_point.data_byte.toString(16)}.`,`ACK observed: ${r.metadata.ack_observed?'yes':'no'}.`]);draw('i2c-chart',[{name:'SDA',values:r.sda,color:'#2479c3'},{name:'SCL',values:r.scl,color:'#df7b47'}]);}));
$('wave-run').addEventListener('click',()=>action('wave-result','Running experimental waveform model',async()=>{const source=$('wave-source').value;
  if(source==='sensor') { if(!state.sensor)throw Error('Run Sensor Simulator first.');const sim=state.sensor;const r=await post('/ai/sensor/analyze',{ideal:sim.ideal,measured:sim.measured,sample_rate_hz:sim.sample_rate_hz,data_source:'PYTHON_SIMULATION'});message('wave-result',`Sensor: ${r.anomaly_status}`,[`Experimental anomaly score: ${r.anomaly_score.toFixed(3)}.`,`Engineering pattern: ${r.engineering_pattern.replaceAll('_',' ')}.`]);return; }
  let req;if(source==='adc'){if(!state.adc)throw Error('Run ADC model first.');req={system_type:'ANALOG_ADC',samples:[state.adc.chart.commanded_v,state.adc.chart.pin_v,state.adc.chart.adc_reconstructed_v],sampling_rate_hz:state.adcRequest.sample_rate_hz||1024,data_source:'PYTHON_SIMULATION'};}else{if(!state.i2c)throw Error('Run I²C simulation first.');req={system_type:'I2C_SENSOR',samples:[state.i2c.ideal_sda,state.i2c.ideal_scl,state.i2c.sda,state.i2c.scl],sampling_rate_hz:state.i2c.metadata.sampling_rate,data_source:'PYTHON_SIMULATION'};}
  const r=await post('/ai/waveform/analyze',req);state.analysis=r;const sorted=Object.entries(r.waveform_model.probabilities).sort((a,b)=>b[1]-a[1]).slice(0,3);message('wave-result',`Predicted pattern: ${r.waveform_model.predicted_pattern.replaceAll('_',' ')}`,[`Top patterns: ${sorted.map(([name,p])=>`${name} ${(p*100).toFixed(1)}%`).join(' · ')}.`,`Measured RMS: ${r.signal_features.rms.toFixed(3)}; peak-to-peak: ${r.signal_features.peak_to_peak.toFixed(3)}.`,`OOD status: ${r.waveform_model.ood_status||'not evaluated for this model'}.`,'Experimental simulation-trained CNN; do not interpret as production confidence.']);}));
$('diagnosis-run').addEventListener('click',()=>action('diagnosis-result','Calling the retained ADC diagnosis mode',async()=>{if(!state.adc)throw Error('Run the ADC model first.');const payload=state.adc.diagnosis_evidence;const r=await post('/diagnose',{system_type:'ANALOG_ADC',symptom_type:'INCORRECT_OUTPUT',diagnostic_mode:payload.diagnostic_mode,measurements:payload.measurements,step_number:0});message('diagnosis-result',`Current hypothesis: ${r.diagnosis[0].fault}`,[`Model confidence: ${(r.confidence*100).toFixed(1)}%.`,`Next check: ${r.next_measurement?.question||'No further check requested.'}`,'Evidence origin: local Python simulation. This result is not physical validation.']);}));
function route(){const id=location.hash.slice(1)||'adc';const active=$(id)&&$(id).classList.contains('lab-section')?id:'adc';document.querySelectorAll('.lab-section').forEach(el=>el.classList.toggle('active',el.id===active));document.querySelectorAll('.lab-nav a').forEach(el=>el.classList.toggle('active',el.hash==='#'+active));}window.addEventListener('hashchange',route);route();
fetch('/ai/models/status').then(r=>r.json()).then(r=>{$('wave-status').textContent=`ADC ${r.waveform_adc?'ready':'pending'} · I²C ${r.waveform_i2c?'ready':'pending'}`;}).catch(()=>{$('wave-status').textContent='Unavailable';});
