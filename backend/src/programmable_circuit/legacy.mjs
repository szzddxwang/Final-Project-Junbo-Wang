import {boardProfile,isAVR} from './boards.mjs';
import {blank,example,validate,PARTS}from'./graph.mjs';
export function importLegacy(raw,selectedBoard='uno_r3'){
 const old=raw.board?.definition?raw.board:raw.snapshot?.board;
 if(!old?.definition||!Array.isArray(old.graph)||!['ADC','DIGITAL','LED','I2C','UART','PWM'].includes(old.scenario))throw Error('This is not a supported MicroExplore legacy capture.');
 const board=old.board_profile||old.definition.board?.id||selectedBoard,p=example(board,old.scenario),uno=isAVR(board),V=uno?5:3.3;const saved=old.definition;const physical=k=>{const pin=saved.pins.find(x=>x.id===k);return 'board:'+(pin?.physical_pin||pin?.label?.split(' / ')[0]||({'gpio':uno?'D3':'GP16',input:uno?'D2':'GP15',adc:uno?'A0':'GP26',pwm:uno?'D9':'GP16',gnd:'GND',vcc:uno?'3V3':'3V3',sda:uno?'A4':'GP4',scl:uno?'A5':'GP5',tx:uno?'D1':'GP0',ref:uno?'AREF':'ADC_VREF'})[k]);};
 p.name=('Imported '+old.title).slice(0,80);p.notes='Imported new editable definition from legacy capture '+old.capture_id+'. Original record and result remain unchanged. Review power/bias and compile or execute new firmware; old numerical results are not reinterpreted as this MCU run.';p.wires=[];
 const wire=(a,b)=>p.wires.push({id:'legacyw'+p.wires.length,a,b,color:'#32758b',points:[]});let map={};
 if(old.scenario==='LED'){map={gpio:physical('gpio'),gnd:physical('gnd'),r_in:'r1:1',r_out:'r1:2',anode:'led1:A',cathode:'led1:K'};p.source=uno?p.source.replace(/\b8\b/g,physical('gpio').slice(7)):p.source.replace(/\b16\b/g,physical('gpio').slice(8));}
 if(old.scenario==='ADC'){p.parts=[p.parts[0],...['signal','reference'].map((id,i)=>({id,type:'source',x:550+i*180,y:100,rotation:0,params:{volts:i?old.parameters.vref??V:old.parameters.vin??V/2}}))];map={adc:physical('adc'),ref:physical('ref'),gnd:'board:GND',out:'signal:OUT',vref:'reference:OUT',return:'signal:GND'};wire('reference:GND','signal:GND');if(uno)p.source=p.source.replace('Serial.begin(9600);','Serial.begin(9600);analogReference(EXTERNAL);');}
 if(old.scenario==='DIGITAL'){map={input:physical('input'),gnd:'board:GND',signal:'button1:1',return:'button1:2'};wire('board:'+(uno?'5V':'3V3'),'r1:1');wire('r1:2',physical('input'));}
 if(old.scenario==='I2C'){map={vcc:'board:'+(uno?'3V3':'3V3'),gnd:'board:GND',sda:physical('sda'),scl:physical('scl'),dvcc:'sensor1:VCC',dgnd:'sensor1:GND',dsda:'sensor1:SDA',dscl:'sensor1:SCL'};for(const [id,k]of[['r1','SDA'],['r2','SCL']]){wire(id+':1',map.vcc);wire(id+':2','sensor1:'+k);}}
 if(old.scenario==='UART'){map={tx:physical('tx'),gnd:'board:GND',rx:'uart1:RX',return:'uart1:GND'};wire('board:'+(uno?'5V':'3V3'),'uart1:VCC');p.notes+=' Legacy receiver had implicit power; an explicit board-rail connection is added and visible.';}
 if(old.scenario==='PWM'){p.parts=[p.parts[0],{id:'load1',type:'pwm',x:550,y:150,rotation:0,params:{ohms:10000}}];map={pwm:physical('pwm'),gnd:'board:GND',drive:'load1:IN',return:'load1:GND'};}
 for(const e of old.graph){if(!Array.isArray(e)||e.length!==2||!map[e[0]]||!map[e[1]])throw Error('Unsupported legacy terminal mapping. Original capture is retained.');wire(map[e[0]],map[e[1]]);}
 return validate(p);
}
