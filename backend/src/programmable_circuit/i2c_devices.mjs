import {DS1307} from './teaching_devices.mjs';
/* MicroExplore adapter for the AGPL Velxio device models. See vendor/velxio/LICENSE. */
import {SSD1306Core,VirtualBMP280} from './vendor/velxio/models.mjs';
import {netlist,endpoint,params,logicThresholds,railVoltage} from './graph.mjs';
import {i2cQuality} from './physics.mjs';
export class OLEDDevice {
 constructor(){this.core=new SSD1306Core();this.writes=0;this.start(false);}
 start(read){this.control=true;this.continue=false;this.data=false;return !read;}
 writeByte(v){if(this.control){if(v&0x3f)return false;this.data=!!(v&0x40);this.continue=!!(v&0x80);this.control=false;return true;}this.data?this.core.writeData(v):this.core.writeCommand(v);this.writes++;this.control=this.continue;return true;}
 stop(){} snapshot(){return {...this.core.snapshot(),bytes_written:this.writes};}
}
export class I2CDevices {
 constructor(project,clock=()=>0){this.p=project;this.devices=new Map();this.status={};this.selected=null;
  for(const part of project.parts){const q=params(part);let d;
   if(part.type==='ds1307')d=new DS1307(q,clock);
   if(part.type==='ssd1306')d=new OLEDDevice();
   if(part.type==='bmp280'){d=new VirtualBMP280(q.address);d.temperatureC=q.temperature_c;d.pressureHPa=q.pressure_hpa;}
   if(part.type==='i2c')d={reg:0,index:0,first:true,start(read){if(!read)this.first=true;this.index=0;},writeByte(v){if(this.first)this.reg=v;this.first=false;return true;},readByte(){const raw=Math.round(q.temperature_c*256)&65535;return this.reg===0?(this.index++%2?raw&255:raw>>>8):0;},stop(){}};
   if(d){this.devices.set(part.id,d);this.status[part.id]={connected:false,reason:'No addressed transaction yet',reads:0,writes:0};}
  }
 }
 connect(address,read,electric,frequency,high,picoReady=true){
  this.selected?.device.stop();this.selected=null;
  const nl=netlist(this.p),ground=nl.net.get(endpoint(nl.board,'GND')),pins=this.p.board_type==='pico_rp2040'?['GP4','GP5']:this.p.board_type==='mega2560'?['D20','D21']:['A4','A5'],same=(a,b)=>nl.net.get(a)===nl.net.get(b),v=k=>electric.values[k];
  const candidates=[];
  for(const [id,device]of this.devices){const part=this.p.parts.find(a=>a.id===id),q=params(part),s=this.status[id];s.connected=false;
   if(!picoReady||!same(id+':SDA',nl.board+':'+pins[0])||!same(id+':SCL',nl.board+':'+pins[1])){s.reason='Connect SDA/SCL to the hardware I2C pins';continue;}
   const volts=v(id+':VCC'),min=part.type==='ds1307'?4.5:2.7,max=part.type==='ds1307'?5.5:part.type==='i2c'?railVoltage(this.p.board_type)+.2:3.6;
   if(nl.net.get(id+':GND')!==ground||!Number.isFinite(volts)||volts<min||volts>max){s.reason='Check common ground and '+(part.type==='ds1307'?'4.5–5.5 V':part.type==='i2c'?'device':'2.7–3.6 V')+' supply';continue;}
   candidates.push({id,device,part,q,volts});s.connected=true;s.reason='Powered and wired';
  }
  // Each device contributes capacitance; all parallel pull-ups share the bus.
  const cap=candidates.reduce((s,d)=>s+d.q.capacitance_pf,0),sink=Math.min(3,...candidates.map(d=>d.q.sink_ma)),qualities=[];
  for(const [i,line]of ['SDA','SCL'].entries()){
   const node=nl.net.get(nl.board+':'+pins[i]),rs=[];
   for(const r of this.p.parts.filter(p=>p.type==='resistor'))for(const [a,b]of [['1','2'],['2','1']])if(nl.net.get(r.id+':'+a)===node&&Number.isFinite(v(r.id+':'+b))&&v(r.id+':'+b)>logicThresholds(this.p.board_type).high)rs.push({ohms:params(r).ohms,volts:v(r.id+':'+b)});
   const conductance=rs.reduce((s,r)=>s+1/r.ohms,0),volts=conductance?rs.reduce((s,r)=>s+r.volts/r.ohms,0)/conductance:0;
   const q=i2cQuality({ohms:conductance?1/conductance:Infinity,capacitance_pf:cap,frequency_hz:frequency,volts,sink_ma:sink,high_us:high});
   const voltageOK=rs.length>0&&candidates.every(d=>volts<=d.volts+.3);
   qualities.push({line,...q,pullup_voltage_v:volts,usable:q.usable&&voltageOK});
  }
  const matches=candidates.filter(d=>d.q.address===address),collision=matches.length>1;
  let reason=collision?'Address conflict: two powered devices have the same address':matches.length===0?'No powered device at this address':qualities.some(q=>!q.usable)?'Missing/unsafe pull-up or insufficient I2C timing margin':'';
  if(!reason&&matches[0].part.type==='ds1307'&&frequency>100000)reason='DS1307 supports at most 100 kHz';
  if(!reason&&read&&matches[0].part.type==='ssd1306')reason='SSD1306 is write-only';
  if(reason){for(const d of matches)this.status[d.id].reason=reason;return {ack:false,reason,qualities};}
  this.selected=matches[0];this.selected.device.start(read);this.status[this.selected.id].reason='Address acknowledged';return {ack:true,device:this.selected.id,qualities};
 }
 write(v){if(!this.selected)return false;const ack=this.selected.device.writeByte(v);if(ack)this.status[this.selected.id].writes++;return ack;}
 read(){if(!this.selected)return 255;this.status[this.selected.id].reads++;return this.selected.device.readByte();}
 stop(){this.selected?.device.stop();this.selected=null;}
 snapshot(){const out={};for(const [id,d]of this.devices){const p=this.p.parts.find(x=>x.id===id);if(p.type==='i2c')continue;out[id]={...this.status[id],...(['ssd1306','ds1307'].includes(p.type)?d.snapshot():{type:'bmp280',reference_temperature_c:params(p).temperature_c,reference_pressure_hpa:params(p).pressure_hpa,chip_id:d.dumpRegisters()[0xd0],registers:Array.from(d.dumpRegisters().slice(0xf3,0xfd))})};}return out;}
}
