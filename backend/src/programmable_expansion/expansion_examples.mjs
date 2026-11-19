import {avrText,pyText} from './oled_text_examples.mjs';
import {blank,PARTS,isAVR,boardProfile} from './graph.mjs';
import {moduleExample} from './module_examples.mjs';
export const EXPANSION_EXPERIMENTS={
 DHT_OLED:{title:'Temperature + humidity station',system:'I2C_SENSOR',lab:'Sensor',aim:'Read DHT22 temperature and humidity through firmware, then display both values on the OLED.',try:'Change humidity_pct from 50 to 75. Compare the OLED numbers with the serial output.'},
 RTC_OLED:{title:'Clock + OLED display',system:'I2C_SENSOR',lab:'I2C',aim:'Read BCD time over I2C and display hours, minutes and seconds on the OLED.',try:'Start near a minute boundary; observe the counter wrap.'},
 STEPPER:{title:'Step / direction motor positioning',system:'PWM_MOTOR_SERVO',lab:'PWM',aim:'Count firmware STEP pulses and observe commanded angle.',try:'Reverse DIR, change the step count, or disable the driver. Mechanical load/stall is outside this model.'},
 OPAMP:{title:'Op-amp gain and saturation',system:'ANALOG_ADC',lab:'ADC',aim:'Measure a non-inverting gain-of-two amplifier using ADC.',try:'Change the input from 0.5 to 3 V; observe the supply-limited output.'},
 BJT:{title:'NPN low-side LED switch',system:'LED_GPIO',lab:'GPIO',aim:'Control base current and inspect LED current.',try:'Change the base resistor and compare the turn-on behavior.'},
 MOSFET:{title:'MOSFET low-side LED switch',system:'LED_GPIO',lab:'GPIO',aim:'Compare gate voltage, drain voltage and LED current.',try:'Sweep the gate source around the threshold; do not infer named-part accuracy.'},
 MULTIFILE:{title:'Modular firmware: main + helper',system:'LED_GPIO',lab:'GPIO',aim:'Compile or import a helper module from the project file tabs.',try:'Change the helper pulse duration and compare the captured waveform.'}
};
export function expansionExample(board,task){
 const avr=isAVR(board),power=boardProfile(board).power_pin,gpio=avr?'D8':'GP16',input=avr?'A0':'GP26';
 let p=['DHT_OLED','RTC_OLED'].includes(task)?moduleExample(board,'OLED'):blank(board);p.name=EXPANSION_EXPERIMENTS[task].title;p.task=task;p.notes='Controlled simulation. '+EXPANSION_EXPERIMENTS[task].aim+' '+EXPANSION_EXPERIMENTS[task].try;
 const add=(id,type,x,y,q={})=>p.parts.push({id,type,x,y,rotation:0,params:{...PARTS[type].defaults,...q}}),w=(a,b)=>p.wires.push({id:'w'+p.wires.length,a,b,color:'#347b65',points:[]}),powered=(id,pin=power)=>{w('board:'+pin,id+':VCC');w('board:GND',id+':GND');};
 if(task==='DHT_OLED'){
  add('dht1','dht22',620,320,{humidity_pct:50});powered('dht1');add('pullD','resistor',480,300,{ohms:10000});w('pullD:1','board:'+power);w('pullD:2','dht1:DATA');w('dht1:DATA','board:'+(avr?'D2':'GP15'));
  const driver=`bool readDHT(float &t,float &h){byte b[5]={0};pinMode(2,OUTPUT);digitalWrite(2,LOW);delay(2);pinMode(2,INPUT);if(!pulseIn(2,HIGH,1000))return false;for(byte i=0;i<40;i++){unsigned long us=pulseIn(2,HIGH,1000);if(!us)return false;b[i/8]=(b[i/8]<<1)|(us>45);}if((byte)(b[0]+b[1]+b[2]+b[3])!=b[4])return false;h=((unsigned int)b[0]*256+b[1])/10.0;t=(((unsigned int)(b[2]&127)*256+b[3])/10.0)*(b[2]&128?-1:1);return true;}\n`;
  if(avr){p.files={'dht_reader.h':driver};p.source='#include "dht_reader.h"\n'+p.source.replace('displayBar(64);','float t,h;if(readDHT(t,h)){Serial.print("DHT T=");Serial.print(t,1);Serial.print(" H=");Serial.println(h,1);displayBar((int)h);}else Serial.println("DHT unavailable");').replace('delay(250);','delay(2100);');}
  else{p.files={'dht_reader.py':`from machine import Pin,time_pulse_us\nimport time\ndef measure():\n p=Pin(15,Pin.OUT);p.value(0);time.sleep_ms(2);p.init(Pin.IN)\n if time_pulse_us(p,0,1000)<0: raise OSError('No response low')\n if time_pulse_us(p,1,1000)<0: raise OSError('No response')\n b=[0]*5\n for i in range(40):\n  us=time_pulse_us(p,1,1000)\n  if us<0: raise OSError('Timeout')\n  b[i//8]=(b[i//8]<<1)|(1 if us>45 else 0)\n if (sum(b[:4])&255)!=b[4]: raise OSError('Checksum')\n return ((b[2]&127)*256+b[3])/10*(-1 if b[2]&128 else 1),(b[0]*256+b[1])/10\n`};p.source='from dht_reader import measure\n'+p.source.replace('display_bar(64)','t,h=measure(); print("DHT T=",t," H=",h); display_bar(round(h))').replace('time.sleep_ms(250)','time.sleep_ms(2100)');}
 }
 if(task==='RTC_OLED'){
  add('rtc1','ds1307',640,320,{hour:12,minute:59,second:58});if(avr)powered('rtc1');else{add('rtc_supply','motor_supply',860,460,{supply_v:5});w('rtc_supply:OUT','rtc1:VCC');w('rtc_supply:GND','board:GND');w('rtc1:GND','board:GND');}w('rtc1:SDA','oled1:SDA');w('rtc1:SCL','oled1:SCL');
  if(avr)p.source=p.source.replace('displayBar(64);','Wire.beginTransmission(0x68);Wire.write(0);if(Wire.endTransmission(false)==0&&Wire.requestFrom(0x68,3)==3){byte s=Wire.read()&127,m=Wire.read(),h=Wire.read();int sec=(s>>4)*10+(s&15);Serial.print("CLOCK ");Serial.print((h>>4)*10+(h&15));Serial.print(":");Serial.print((m>>4)*10+(m&15));Serial.print(":");Serial.println(sec);displayBar(sec*2);}');
  else p.source=p.source.replace('display_bar(64)','b=i2c.readfrom_mem(0x68,0,3); vals=[(x>>4)*10+(x&15) for x in b]; print("CLOCK",vals[2],vals[1],vals[0]); display_bar(vals[0]*2)');
 }
 if(task==='STEPPER'){
  add('step1','a4988_stepper',570,160);powered('step1');add('supply1','motor_supply',830,390);w('supply1:OUT','step1:VMOT');w('supply1:GND','board:GND');w('step1:PGND','board:GND');for(const k of ['ENABLE','MS1','MS2','MS3'])w('step1:'+k,'board:GND');w('step1:STEP','board:'+gpio);w('step1:DIR','board:'+(avr?'D7':'GP17'));
  p.source=avr?'void setup(){pinMode(8,OUTPUT);pinMode(7,OUTPUT);digitalWrite(7,HIGH);for(int i=0;i<100;i++){digitalWrite(8,HIGH);delayMicroseconds(500);digitalWrite(8,LOW);delayMicroseconds(500);}}\nvoid loop(){}':'from machine import Pin\nimport time\ns=Pin(16,Pin.OUT);d=Pin(17,Pin.OUT,value=1)\nfor i in range(100):\n s.value(1);time.sleep_us(500);s.value(0);time.sleep_us(500)\n';
 }
 if(task==='OPAMP'){
  add('amp1','opamp',540,170);powered('amp1');add('vin','source',290,50,{volts:.5});w('vin:GND','board:GND');w('vin:OUT','amp1:PLUS');add('rf','resistor',750,130,{ohms:10000});add('rg','resistor',750,280,{ohms:10000});w('amp1:OUT','rf:1');w('rf:2','amp1:MINUS');w('amp1:MINUS','rg:1');w('rg:2','board:GND');w('amp1:OUT','board:'+input);add('meter1','meter',850,440);w('meter1:PLUS','amp1:OUT');w('meter1:COM','board:GND');
  p.source=avr?'void setup(){Serial.begin(9600);}\nvoid loop(){Serial.println(analogRead(A0)*5.0/1024.0,3);delay(100);}':'from machine import ADC\nimport time\na=ADC(26)\nwhile True:\n print(a.read_u16()*3.3/65535);time.sleep_ms(100)\n';
 }
 if(task==='BJT'||task==='MOSFET'){
  const npn=task==='BJT';add('q1',npn?'npn':'nmos',650,300);add('vin','source',310,100,{volts:npn?3:3.3});w('vin:GND','board:GND');add('rb','resistor',480,80,{ohms:10000});w('vin:OUT','rb:1');w('rb:2','q1:'+(npn?'B':'G'));w('q1:'+(npn?'E':'S'),'board:GND');add('r1','resistor',520,200,{ohms:330});add('led1','led',760,130);w('board:'+power,'r1:1');w('r1:2','led1:A');w('led1:K','q1:'+(npn?'C':'D'));p.source=avr?'void setup(){}\nvoid loop(){}':'import time\nwhile True: time.sleep_ms(100)\n';
 }
 if(task==='MULTIFILE'){
  add('r1','resistor',500,80);add('led1','led',680,100);w('board:'+gpio,'r1:1');w('r1:2','led1:A');w('led1:K','board:GND');
  p.source=avr?'#include "blink.h"\nvoid setup(){pinMode(8,OUTPUT);}\nvoid loop(){blinkOnce();}':'from blink import blink_once\nwhile True: blink_once()\n';
  p.files=avr?{'blink.h':'#pragma once\nvoid blinkOnce();\n','blink.cpp':'#include <Arduino.h>\nvoid blinkOnce(){digitalWrite(8,HIGH);delay(100);digitalWrite(8,LOW);delay(100);}\n'}:{'blink.py':'from machine import Pin\nimport time\np=Pin(16,Pin.OUT)\ndef blink_once():\n p.value(1);time.sleep_ms(100);p.value(0);time.sleep_ms(100)\n'};
 }

 if(['DHT_OLED','RTC_OLED'].includes(task)){
  p.source=avr?p.source.replace('void setup()',avrText+'\nvoid setup()'):p.source.replace('\nwhile True:',pyText+'\nwhile True:');
  if(task==='RTC_OLED')p.source=avr?p.source.replace('displayBar(sec*2);','char clock[9];snprintf(clock,sizeof(clock),"%02d:%02d:%02d",(h>>4)*10+(h&15),(m>>4)*10+(m&15),sec);displayNumbers(clock,"");'):p.source.replace('display_bar(vals[0]*2)',"display_numbers('%02d:%02d:%02d'%(vals[2],vals[1],vals[0]))");
  else p.source=avr?p.source.replace('displayBar((int)h);','char tv[9],hv[9],a[12],b[12];dtostrf(t,1,1,tv);dtostrf(h,1,1,hv);snprintf(a,sizeof(a),"T%s",tv);snprintf(b,sizeof(b),"H%s",hv);displayNumbers(a,b);'):p.source.replace('display_bar(round(h))',"display_numbers('T%.1f'%t,'H%.1f'%h)");
 }
 return p;
}
