import {boardProfile,isAVR} from './boards.mjs';
/* Display-only geometry. Electrical IDs and MCU implementation are unchanged. */
import {partPins,PARTS,example} from './graph.mjs';
import {experimentExample,EXPERIMENTS} from './experiments.mjs';
export const CANVAS_SIZE={width:1000,height:620};
export function shape(part,board){
 if(part.type==='board'&&board==='mega2560')return{x:-24,y:-10,w:630,h:330};
 if(part.type==='board'&&board==='nano_atmega328p')return{x:-8,y:-12,w:162,h:368};
 if(part.type==='board'&&board==='pro_mini_5v')return{x:-8,y:-10,w:162,h:292};
 if(part.type==='board')return board==='uno_r3'?{x:-24,y:-10,w:438,h:326}:{x:-7,y:-12,w:140,h:324};
 if(['dht22','ds1307','a4988_stepper','opamp','npn','nmos','motor_supply'].includes(part.type))return{x:-8,y:-8,w:240,h:150};
 if(part.type==='ssd1306')return{x:-4,y:-4,w:200,h:132};
 if(part.type==='bmp280')return{x:-4,y:-4,w:148,h:118};
 if(part.type==='breadboard')return{x:-8,y:-12,w:320,h:250};
 if(part.type==='display')return{x:-8,y:-8,w:250,h:120};
 if(['meter','scope','logic','motor','sensor','generator','capacitor'].includes(part.type))return{x:-8,y:-8,w:160,h:130};
 return ({resistor:{x:-6,y:-9,w:116,h:54},led:{x:0,y:-8,w:68,h:102},button:{x:-8,y:-6,w:104,h:82},pot:{x:-3,y:-4,w:102,h:105},rail:{x:-2,y:0,w:118,h:68},source:{x:0,y:-4,w:110,h:94},i2c:{x:-2,y:-3,w:130,h:116},uart:{x:-2,y:-3,w:130,h:116},digital:{x:0,y:-3,w:110,h:94},pwm:{x:0,y:-3,w:110,h:94}})[part.type];
}
export function displayPins(part,board){
 const physical=partPins(part,board),by=new Map(physical.map(p=>[p.id,p]));
 const at=(id,x,y,nx,ny,label=id)=>({...by.get(id),id,x,y,nx,ny,label});
 if(part.type==='board'&&board==='mega2560')return physical.map(pin=>{
  const id=pin.id;
  if(/^D\d+$/.test(id)){
   const n=+id.slice(1),label=n===20?'20/SDA':n===21?'21/SCL':id.slice(1);
   if(n<14)return at(id,141+(13-n)*14,10,0,-1,label);
   if(n<22)return at(id,359+(n-14)*17,10,0,-1,label);
   return at(id,560+(n%2)*22,42+Math.floor((n-22)/2)*16,1,0,label);
  }
  if(/^A\d+$/.test(id))return at(id,272+(+id.slice(1))*16,300,0,1);
  if(id==='AREF')return at(id,113,10,0,-1);
  if(id==='GND_TOP')return at(id,127,10,0,-1,'GND');
  const ids=['NC','IOREF','RESET','3V3','5V','GND','GND2','VIN'];
  return at(id,112+ids.indexOf(id)*18,300,0,1,id==='GND2'?'GND':id==='3V3'?'3.3V':id);
 });
 if(part.type==='board'&&board==='uno_r3'){
  const top=['AREF','GND_TOP',...Array.from({length:14},(_,i)=>'D'+(13-i))];
  const bottom=['IOREF','RESET','3V3','5V','GND','GND2','VIN'];
  return [...top.map((id,i)=>at(id,128+i*15+(i>=8?9:0),12,0,-1,id==='GND_TOP'?'GND':id==='AREF'?id:id.slice(1)+([3,5,6,9,10,11].includes(Number(id.slice(1)))?'~':''))),
   ...bottom.map((id,i)=>at(id,145+i*15,298,0,1,id==='GND2'?'GND':id==='3V3'?'3.3V':id)),
   ...Array.from({length:6},(_,i)=>at('A'+i,284+i*15,298,0,1))];
 }
 if(part.type==='board'&&board==='nano_atmega328p')return physical.map((p,i)=>at(p.id,i<15?6:140,24+(i%15)*22,i<15?-1:1,0,/^GND/.test(p.id)?'GND':p.id==='RESET2'?'RST':p.id));
 if(part.type==='board'&&board==='pro_mini_5v')return physical.map((p,i)=>i<24?at(p.id,i<12?6:140,32+(i%12)*21,i<12?-1:1,0,/^GND/.test(p.id)?'GND':p.id==='RESET2'?'RST':p.id):at(p.id,112,[126,147,212,233][i-24],1,0));
 if(part.type==='board')return physical.map((p,i)=>at(p.id,i<20?7:119,14+(i%20)*14.5,i<20?-1:1,0,/^GND/.test(p.id)?'GND':p.id==='3V3'?'3V3(OUT)':p.id));
 if(['dht22','ds1307','a4988_stepper','opamp','npn','nmos','motor_supply'].includes(part.type))return physical.map((pin,i)=>at(pin.id,12+i*22,130,0,1));
 if(part.type==='ssd1306'||part.type==='bmp280')return physical.map((pin,i)=>at(pin.id,24+i*32,part.type==='ssd1306'?118:104,0,1));
 if(part.type==='breadboard')return physical.map(pin=>{const letter=pin.id[0],row=Number(pin.id.slice(1))-1,col='ABCDEFGHIJ'.indexOf(letter);return col>=0?at(pin.id,38+col*22+(col>=5?16:0),32+row*22,0,-1,''):at(pin.id,15+row*88,({P:8,N:218,Q:230,M:242})[letter]-4,0,letter==='P'?-1:1,'');});
 if(part.type==='display')return physical.map((pin,i)=>at(pin.id,12+i*24,108,0,1));
 if(['meter','scope','logic','motor','sensor','generator','capacitor'].includes(part.type))return physical.map((pin,i)=>at(pin.id,24+i*32,110,0,1));
 const map={resistor:[[0,18,-1,0],[104,18,1,0]],led:[[22,84,0,1],[46,84,0,1]],button:[[0,36,-1,0],[88,36,1,0]],pot:[[24,86,0,1],[48,86,0,1],[72,86,0,1]],rail:[[20,62,0,1],[92,62,0,1]],source:[[30,78,0,1],[80,78,0,1]],digital:[[30,78,0,1],[80,78,0,1]],pwm:[[30,78,0,1],[80,78,0,1]],uart:[[20,100,0,1],[50,100,0,1],[80,100,0,1],[110,100,0,1]],i2c:[[20,100,0,1],[50,100,0,1],[80,100,0,1],[110,100,0,1]]};
 return physical.map((pin,i)=>at(pin.id,...map[part.type][i]));
}
export function transformPoint(part,p){const r=part.rotation*Math.PI/180,c=Math.round(Math.cos(r)),s=Math.round(Math.sin(r));return {...p,x:part.x+p.x*c-p.y*s,y:part.y+p.x*s+p.y*c,nx:(p.nx||0)*c-(p.ny||0)*s,ny:(p.nx||0)*s+(p.ny||0)*c};}
export function displayEndpoint(p,key){const k=key.indexOf(':'),part=p.parts.find(a=>a.id===key.slice(0,k)),pin=part&&displayPins(part,p.board_type).find(a=>a.id===key.slice(k+1));return pin?{...transformPoint(part,pin),part:part.id}:null;}
export function bounds(part,board){const b=shape(part,board),c=[[b.x,b.y],[b.x+b.w,b.y],[b.x,b.y+b.h],[b.x+b.w,b.y+b.h]].map(([x,y])=>transformPoint(part,{x,y}));return {x:Math.min(...c.map(p=>p.x)),y:Math.min(...c.map(p=>p.y)),right:Math.max(...c.map(p=>p.x)),bottom:Math.max(...c.map(p=>p.y))};}
const same=(a,b)=>Math.abs(a.x-b.x)<.001&&Math.abs(a.y-b.y)<.001;
export function simplify(points){const a=points.filter((p,i)=>!i||!same(p,points[i-1]));for(let i=a.length-2;i>0;i--)if((a[i-1].x===a[i].x&&a[i].x===a[i+1].x)||(a[i-1].y===a[i].y&&a[i].y===a[i+1].y))a.splice(i,1);return a;}
function crosses(a,b,r){if(a.x===b.x)return a.x>r.x&&a.x<r.right&&Math.max(a.y,b.y)>r.y&&Math.min(a.y,b.y)<r.bottom;if(a.y===b.y)return a.y>r.y&&a.y<r.bottom&&Math.max(a.x,b.x)>r.x&&Math.min(a.x,b.x)<r.right;return true;}
function routeBetween(a,b,obstacles,occupied=[]){
 const candidates=[[a,{x:b.x,y:a.y},b],[a,{x:a.x,y:b.y},b]],margin=22;
 const xs=[(a.x+b.x)/2,...obstacles.flatMap(r=>[r.x-margin,r.right+margin]),...occupied.filter(([c,d])=>c.x===d.x).flatMap(([c])=>[c.x-12,c.x+12])],ys=[(a.y+b.y)/2,...obstacles.flatMap(r=>[r.y-margin,r.bottom+margin]),...occupied.filter(([c,d])=>c.y===d.y).flatMap(([c])=>[c.y-12,c.y+12])];
 for(const x of new Set(xs))candidates.push([a,{x,y:a.y},{x,y:b.y},b]);for(const y of new Set(ys))candidates.push([a,{x:a.x,y},{x:b.x,y},b]);
 // Separate leads that leave adjacent headers in the same direction. A
 // two-corridor detour can avoid a shared long segment without moving pins.
 const outerY=new Set([Math.min(a.y,b.y,...obstacles.map(r=>r.y))-margin,Math.max(a.y,b.y,...obstacles.map(r=>r.bottom))+margin,...(occupied.length?[Math.min(...occupied.flatMap(([c,d])=>[c.y,d.y]))-12,Math.max(...occupied.flatMap(([c,d])=>[c.y,d.y]))+12]:[])]);
 for(const x of new Set(xs))for(const y of outerY){candidates.push([a,{x,y:a.y},{x,y},{x:b.x,y},b]);candidates.push([a,{x:a.x,y},{x,y},{x,y:b.y},b]);}
 const overlap=(a,b,c,d)=>a.x===b.x&&c.x===d.x&&a.x===c.x?Math.max(0,Math.min(Math.max(a.y,b.y),Math.max(c.y,d.y))-Math.max(Math.min(a.y,b.y),Math.min(c.y,d.y))):a.y===b.y&&c.y===d.y&&a.y===c.y?Math.max(0,Math.min(Math.max(a.x,b.x),Math.max(c.x,d.x))-Math.max(Math.min(a.x,b.x),Math.min(c.x,d.x))):0;
 const score=path=>path.slice(1).reduce((s,q,i)=>s+Math.abs(q.x-path[i].x)+Math.abs(q.y-path[i].y)+obstacles.filter(r=>crosses(path[i],q,r)).length*10000+occupied.reduce((v,[c,d])=>v+overlap(path[i],q,c,d)*12,0),0)+path.length*8;
 let best=null,bestScore=Infinity;for(const candidate of candidates){const path=simplify(candidate),value=score(path);if(value<bestScore){best=path;bestScore=value;}}return best;
}
const routesCache=new WeakMap();
export function wirePoints(p,w){
 const signature=JSON.stringify([p.board_type,p.parts.map(q=>[q.id,q.type,q.x,q.y,q.rotation]),p.wires.map(q=>[q.id,q.a,q.b,q.points])]);
 let cached=routesCache.get(p);if(cached?.signature===signature)return cached.paths.get(w.id)||[];
 const paths=new Map(),occupied=[],obs=p.parts.map(q=>bounds(q,p.board_type));
 for(const wire of p.wires){const a=displayEndpoint(p,wire.a),b=displayEndpoint(p,wire.b);if(!a||!b){paths.set(wire.id,[]);continue;}
  const al={x:a.x+a.nx*30,y:a.y+a.ny*30},bl={x:b.x+b.nx*30,y:b.y+b.ny*30};let points=[a,al],anchors=[al,...wire.points.map(([x,y])=>({x,y})),bl];
  for(let i=1;i<anchors.length;i++)points.push(...routeBetween(anchors[i-1],anchors[i],obs,occupied).slice(1));points.push(b);points=simplify(points);paths.set(wire.id,points);for(let i=1;i<points.length;i++)occupied.push([points[i-1],points[i]]);
 }
 routesCache.set(p,{signature,paths});return paths.get(w.id)||[];
}
export function roundedPath(points,radius=5){if(!points.length)return'';let d=`M${points[0].x} ${points[0].y}`;for(let i=1;i<points.length-1;i++){const a=points[i-1],b=points[i],c=points[i+1],l1=Math.hypot(b.x-a.x,b.y-a.y),l2=Math.hypot(c.x-b.x,c.y-b.y),r=Math.min(radius,l1/2,l2/2);if(!l1||!l2)continue;const p={x:b.x-(b.x-a.x)*r/l1,y:b.y-(b.y-a.y)*r/l1},q={x:b.x+(c.x-b.x)*r/l2,y:b.y+(c.y-b.y)*r/l2};d+=` L${p.x} ${p.y} Q${b.x} ${b.y} ${q.x} ${q.y}`;}if(points.length>1)d+=` L${points.at(-1).x} ${points.at(-1).y}`;return d;}
export function fitDrawing(p){const a=p.parts.map(x=>bounds(x,p.board_type));for(const w of p.wires)for(const q of wirePoints(p,w))a.push({x:q.x,y:q.y,right:q.x,bottom:q.y});const x=Math.min(...a.map(b=>b.x))-35,y=Math.min(...a.map(b=>b.y))-35,r=Math.max(...a.map(b=>b.right))+35,b=Math.max(...a.map(b=>b.bottom))+35,zoom=Math.min(1.75,940/Math.max(120,r-x),560/Math.max(120,b-y));return {zoom,pan:{x:(1000-(x+r)*zoom)/2,y:(620-(y+b)*zoom)/2}};}
export function wireColor(...keys){const pins=keys.map(k=>k.split(':')[1]||'');return pins.some(k=>/GND/.test(k))?'#273442':pins.some(k=>/^(5V|3V3|VCC)$/.test(k))?'#d64545':pins.includes('SCL')?'#2864bf':pins.includes('SDA')?'#20834b':pins.includes('TX')?'#a052b6':pins.includes('RX')?'#c07817':pins.some(k=>/^(A[0-5]|GP2[6-8])$/.test(k))?'#9c6b25':'#20834b';}
export function displayedName(part,board){if(part.type==='board')return boardProfile(board).name;return PARTS[part.type].name;}

export function arrangedExample(board,task){const p=experimentExample(board,task),coords={board:board==='uno_r3'?[110,250]:[180,150],r1:[600,150],r2:[600,250],led1:[800,180],button1:[780,180],pot1:[740,190],sensor1:[790,220],uart1:[740,190]};if(!EXPERIMENTS[task])for(const a of p.parts)if(coords[a.id])[a.x,a.y]=coords[a.id];if(board==='mega2560'){for(const a of p.parts){if(a.type==='board'){a.x=45;a.y=420;}else a.x+=300;}}for(const w of p.wires){if(board==='mega2560'&&['I2C','OLED','BMP280','I2C_MULTI','DHT_OLED','RTC_OLED','BUS_QUALITY'].includes(task)){w.a=w.a.replace('board:A4','board:D20').replace('board:A5','board:D21');w.b=w.b.replace('board:A4','board:D20').replace('board:A5','board:D21');}w.color=wireColor(w.a,w.b);}return p;}
