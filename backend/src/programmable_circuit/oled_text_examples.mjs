/* Original 5 x 7 glyphs for the introductory numerical instrument examples. */
const glyphs=[[62,81,73,69,62],[0,66,127,64,0],[66,97,81,73,70],[33,65,69,75,49],[24,20,18,127,16],[39,69,69,69,57],[60,74,73,73,48],[1,113,9,5,3],[54,73,73,73,54],[6,73,73,41,30],[0,54,54,0,0],[0,96,96,0,0],[8,8,8,8,8],[1,1,127,1,1],[127,8,8,8,127]];
export const avrText=`
const byte glyphs[15][5]={${glyphs.map(g=>'{'+g.join(',')+'}').join(',')}};
byte column(char c,byte x){int k=c>='0'&&c<='9'?c-'0':c==':'?10:c=='.'?11:c=='-'?12:c=='T'?13:c=='H'?14:-1;return k<0||x>=5?0:glyphs[k][x];}
void displayNumbers(const char *top,const char *bottom){
 for(byte c: {0xAE,0xA1,0xC8,0x20,0,0x21,0,127,0x22,0,7,0xAF})command(c);
 for(int offset=0;offset<1024;){Wire.beginTransmission(0x3C);Wire.write(0x40);for(byte n=0;n<28&&offset<1024;n++,offset++){
  int x=offset%128,page=offset/128;byte bits=0;
  for(byte bit=0;bit<8;bit++){int y=page*8+bit;const char *line=y>=36?bottom:top;int row=(y-(y>=36?36:10))/2,col=(x-8)/12;
   if(x>=8&&((y>=10&&y<24)||(y>=36&&y<50))&&row>=0&&row<7&&col<(int)strlen(line)&&((column(line[col],((x-8)%12)/2)>>row)&1))bits|=1<<bit;
  }Wire.write(bits);
 }if(Wire.endTransmission()){Serial.println("OLED unavailable");return;}}
}
` .replace('for(byte c: {0xAE,0xA1,0xC8,0x20,0,0x21,0,127,0x22,0,7,0xAF})command(c);','const byte init[]={0xAE,0xA1,0xC8,0x20,0,0x21,0,127,0x22,0,7,0xAF};for(byte c:init)command(c);');
export const pyText=`
_glyphs=${JSON.stringify(glyphs)}
def display_numbers(top,bottom=''):
 for c in [0xAE,0xA1,0xC8,0x20,0,0x21,0,127,0x22,0,7,0xAF]: command(c)
 buf=bytearray(1025);buf[0]=0x40
 for line,y0 in [(top,10),(bottom,36)]:
  for j,c in enumerate(line[:10]):
   k='0123456789:.-TH'.find(c)
   if k<0: continue
   for col in range(5):
    for row in range(7):
     if (_glyphs[k][col]>>row)&1:
      for dx in [0,1]:
       for dy in [0,1]:
        x=8+j*12+col*2+dx;y=y0+row*2+dy
        if x<128: buf[1+(y//8)*128+x]|=1<<(y%8)
 i2c.writeto(0x3C,buf)
`;
