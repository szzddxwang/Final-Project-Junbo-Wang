import {blank,PARTS} from './graph.mjs';
import {isAVR} from './boards.mjs';
export const MODULE_EXPERIMENTS={
 OLED:{title:'OLED pixels from firmware',system:'I2C_SENSOR',lab:'I2C',aim:'Write a 128 × 64 display through real I2C commands.',try:'Change the bar width in your program. Run again and compare the pixels. The OLED address is 0x3C.'},
 BMP280:{title:'BMP280 sensor registers + calibration',system:'I2C_SENSOR',lab:'Sensor',aim:'Read chip identity, calibration bytes and temperature/pressure with actual firmware.',try:'Select the sensor, change temperature_c or pressure_hpa, then run again. Compare Serial output with your controlled reference.'},
 I2C_MULTI:{title:'Sensor + OLED on one bus',system:'I2C_SENSOR',lab:'I2C',aim:'Read a BMP280 and draw the temperature as an OLED bar using the same two signal wires.',try:'Compare 10 °C and 40 °C. The program changes bar width from the sensor reading. Disconnect sensor power and check the error message.'}
};
const avrSensor=`
bool readRegs(byte reg,byte *b,byte n){Wire.beginTransmission(0x76);Wire.write(reg);if(Wire.endTransmission(false))return false;if(Wire.requestFrom(0x76,(int)n)!=n)return false;for(byte i=0;i<n;i++)b[i]=Wire.read();return true;}
unsigned int readU16(byte *b){return b[0]|((unsigned int)b[1]<<8);}
double temperature=0,pressure=0;
bool measure(){byte c[24],b[6],id;
 if(!readRegs(0xD0,&id,1)||id!=0x58||!readRegs(0x88,c,24))return false;
 Wire.beginTransmission(0x76);Wire.write(0xF4);Wire.write(0x27);if(Wire.endTransmission())return false;delay(10);
 if(!readRegs(0xF7,b,6))return false;
 long ap=((long)b[0]<<12)|((long)b[1]<<4)|(b[2]>>4),at=((long)b[3]<<12)|((long)b[4]<<4)|(b[5]>>4);
 double t1=readU16(c),t2=(int)readU16(c+2),t3=(int)readU16(c+4);
 double v1=(at/16384.0-t1/1024.0)*t2,v2=(at/131072.0-t1/8192.0);double fine=v1+v2*v2*t3;temperature=fine/5120.0;
 double p[9];p[0]=readU16(c+6);for(byte i=1;i<9;i++)p[i]=(int)readU16(c+6+2*i);
 v1=fine/2-64000;v2=v1*v1*p[5]/32768+v1*p[4]*2;v2=v2/4+p[3]*65536;
 v1=(p[2]*v1*v1/524288+p[1]*v1)/524288;v1=(1+v1/32768)*p[0];if(v1==0)return false;
 double pa=(1048576-ap-v2/4096)*6250/v1;pa+=(p[8]*pa*pa/2147483648.0+pa*p[7]/32768+p[6])/16;pressure=pa/100;
 Serial.print("BMP280 T=");Serial.print(temperature,2);Serial.print(" C P=");Serial.print(pressure,2);Serial.println(" hPa");return true;
}
`;
const avrOLED=`
void command(byte c){Wire.beginTransmission(0x3C);Wire.write(0);Wire.write(c);Wire.endTransmission();}
void displayBar(byte width){command(0xAE);command(0xA1);command(0xC8);command(0x20);command(0);command(0x21);command(0);command(127);command(0x22);command(0);command(7);command(0xAF);
 for(int offset=0;offset<1024;){Wire.beginTransmission(0x3C);Wire.write(0x40);for(byte n=0;n<28&&offset<1024;n++,offset++){byte page=offset/128,x=offset%128;Wire.write((page>=2&&page<=5&&x<width)?0xFF:0);}if(Wire.endTransmission()){Serial.println("OLED unavailable: check power, wires and address");return;}}
 Serial.print("OLED bar pixels=");Serial.println(width);
}
`;
const pySensor=`
def measure():
 import struct
 if i2c.readfrom_mem(0x76,0xD0,1)[0]!=0x58: raise ValueError('BMP280 chip ID')
 c=i2c.readfrom_mem(0x76,0x88,24)
 t1,t2,t3=struct.unpack('<Hhh',c[:6]);p=struct.unpack('<Hhhhhhhhh',c[6:])
 i2c.writeto_mem(0x76,0xF4,b'\\x27');time.sleep_ms(10)
 b=i2c.readfrom_mem(0x76,0xF7,6);ap=(b[0]<<12)|(b[1]<<4)|(b[2]>>4);at=(b[3]<<12)|(b[4]<<4)|(b[5]>>4)
 v1=(at/16384-t1/1024)*t2;v2=at/131072-t1/8192;fine=v1+v2*v2*t3;t=fine/5120
 v1=fine/2-64000;v2=v1*v1*p[5]/32768+v1*p[4]*2;v2=v2/4+p[3]*65536
 v1=(p[2]*v1*v1/524288+p[1]*v1)/524288;v1=(1+v1/32768)*p[0]
 if not v1: raise ValueError('Invalid calibration')
 pa=(1048576-ap-v2/4096)*6250/v1;pa+=(p[8]*pa*pa/2147483648+pa*p[7]/32768+p[6])/16
 print('BMP280 T=%.2f C P=%.2f hPa'%(t,pa/100));return t
`;
const pyOLED=`
def command(c): i2c.writeto(0x3C,bytes([0,c]))
def display_bar(width):
 for c in [0xAE,0xA1,0xC8,0x20,0,0x21,0,127,0x22,0,7,0xAF]: command(c)
 buf=bytearray(1025);buf[0]=0x40
 for n in range(1024):
  if 2<=n//128<=5 and n%128<width: buf[n+1]=255
 i2c.writeto(0x3C,buf);print('OLED bar pixels=',width)
`;
export function moduleExample(board,task){
 const p=blank(board),avr=isAVR(board),sensor=task!=='OLED',oled=task!=='BMP280';p.task=task;p.name=MODULE_EXPERIMENTS[task].title;
 const add=(id,type,x,y,q={})=>p.parts.push({id,type,x,y,rotation:0,params:{...PARTS[type].defaults,...q}}),w=(a,b,color='#378457')=>p.wires.push({id:'w'+p.wires.length,a,b,color,points:[]});
 p.parts[0].x=avr?60:100;p.parts[0].y=avr?280:180;
 add('supply','source',480,55,{volts:3.3});w('supply:GND','board:GND','#354451');
 for(const [i,pin]of ['SDA','SCL'].entries()){add('pull'+i,'resistor',480,180+i*70,{ohms:4700});w('supply:OUT','pull'+i+':1','#d4514b');w('pull'+i+':2','board:'+(avr?['A4','A5'][i]:['GP4','GP5'][i]),i?'#4669b3':'#378457');}
 for(const [id,type,x,y]of [...(sensor?[['sensor1','bmp280',760,340]]:[]),...(oled?[['oled1','ssd1306',740,70]]:[])]){add(id,type,x,y);w('supply:OUT',id+':VCC','#d4514b');w('board:GND',id+':GND','#354451');w('pull0:2',id+':SDA');w('pull1:2',id+':SCL','#4669b3');}
 p.notes='Controlled simulation: 3.3 V devices, common ground, two 4.7 kΩ pull-ups. BMP280 0x76; OLED 0x3C. Register/pixel model; conversion delay, sensor noise, OLED scrolling and photometric brightness are not modeled. No extra Arduino libraries required.';
 p.source=avr?'#include <Wire.h>\n'+(sensor?avrSensor:'')+(oled?avrOLED:'')+'\nvoid setup(){Serial.begin(115200);Wire.begin();Wire.setClock(100000);}\nvoid loop(){'+(sensor?'if(!measure()){Serial.println("BMP280 unavailable: check power, address and wiring");delay(500);return;}':'')+(oled?'displayBar('+(sensor?'constrain((int)(temperature*2+0.5),0,128)':'64')+');':'')+'delay(250);}\n':
 'from machine import Pin,I2C\nimport time\ni2c=I2C(0,sda=Pin(4),scl=Pin(5),freq=100000)\n'+(sensor?pySensor:'')+(oled?pyOLED:'')+'\nwhile True:\n try:\n'+(sensor?'  temperature=measure()\n':'')+(oled?'  display_bar('+(sensor?'max(0,min(128,round(temperature*2)))':'64')+')\n':'')+' except OSError:\n  print("I2C device unavailable: check power, wires and address")\n time.sleep_ms(250)\n';
 return p;
}
