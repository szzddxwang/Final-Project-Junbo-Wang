from pydantic import BaseModel,Field,ConfigDict,model_validator
import math,json
from pathlib import Path
COMPONENTS=json.loads(Path(__file__).with_name("components.json").read_text(encoding='utf8'))
BOARDS=json.loads(Path(__file__).with_name('boards.json').read_text(encoding='utf8'))
VERSION='microexplore-programmable-v1'
PINS={'resistor':['1','2'],'led':['A','K'],'button':['1','2'],'pot':['VCC','OUT','GND'],'source':['OUT','GND'],'rail':['VCC','GND'],'digital':['IN','GND'],'uart':['RX','TX','VCC','GND'],'i2c':['SDA','SCL','VCC','GND'],'pwm':['IN','GND']}
PINS.update({k:v['pins']for k,v in COMPONENTS['parts'].items()})
class Strict(BaseModel):model_config=ConfigDict(extra='forbid',allow_inf_nan=False)
class Part(Strict):
 id:str=Field(pattern=r'^[A-Za-z][A-Za-z0-9_-]{0,31}$')
 type:str
 x:float=Field(ge=-3000,le=3000)
 y:float=Field(ge=-3000,le=3000)
 rotation:int
 params:dict
 @model_validator(mode='after')
 def check(self):
  if self.type not in ['board',*PINS]or self.rotation not in [0,90,180,270]:raise ValueError('Unsupported part or rotation')
  allowed=({'board':{},'rail':{},'resistor':{'ohms':(1,1e7)},'led':{'vf':(1,3.6)},'button':{'pressed':None},'pot':{'ohms':(1,1e7),'position':(0,1)},'source':{'volts':(0,5)},'digital':{'ohms':(1,1e7)},'pwm':{'ohms':(1,1e7)},'uart':{'baud':(300,115200)},'i2c':{'address':(8,119)}}.get(self.type) or ({k:COMPONENTS['ranges'][k]for k in COMPONENTS['parts'][self.type]['defaults']} if self.type in COMPONENTS['parts'] else {}))
  optional={k:COMPONENTS['ranges'][k]for k in COMPONENTS['optional'].get(self.type,{})}
  if not set(allowed)<=set(self.params)or not set(self.params)<=set(allowed)|set(optional):raise ValueError('Unsupported part parameters')
  for k,v in {**allowed,**{k:v for k,v in optional.items()if k in self.params}}.items():
   n=self.params[k]
   if v is None:
    if not isinstance(n,bool):raise ValueError('Button value must be Boolean')
   elif isinstance(n,bool)or not isinstance(n,(int,float))or not math.isfinite(n)or not v[0]<=n<=v[1]or(k in ['address','baud','seed','bits','parity','stop']and int(n)!=n):raise ValueError('Parameter outside supported range')
  if self.type=="ssd1306" and self.params["address"] not in (60,61):raise ValueError("SSD1306 address must be 60 or 61")
  if self.type=="bmp280" and (self.params["address"] not in (118,119) or not -40<=self.params["temperature_c"]<=85):raise ValueError("BMP280: address 118/119, temperature -40..85 C")
  if self.type=='ds1307' and self.params['address']!=104:raise ValueError('DS1307 address is fixed at 104')
  if self.type=='dht22' and not -40<=self.params['temperature_c']<=80:raise ValueError('DHT22 range is -40..80 C')
  return self
class Wire(Strict):
 id:str=Field(pattern=r'^[A-Za-z][A-Za-z0-9_-]{0,31}$')
 a:str=Field(max_length=64)
 b:str=Field(max_length=64)
 color:str=Field(pattern=r'^#[0-9A-Fa-f]{6}$')
 points:list[list[float]]=Field(default_factory=list,max_length=12)
 @model_validator(mode='after')
 def check(self):
  if any(len(p)!=2 or any(abs(n)>3000 for n in p)for p in self.points):raise ValueError('Invalid routing coordinates')
  return self
def validate_files(source,files,language):
 import re
 main='sketch.ino' if language=='arduino' else 'main.py'
 pattern=r'^[A-Za-z][A-Za-z0-9_-]{0,47}\.(h|hpp|cpp|c|ino)$' if language=='arduino' else r'^[A-Za-z][A-Za-z0-9_]{0,47}\.py$'
 if len(set(n.lower() for n in [main,*files]))!=len(files)+1 or any(re.match(r'^(con|prn|aux|nul|com[1-9]|lpt[1-9])\.',n,re.I) for n in files):raise ValueError('Duplicate/reserved file name')
 if len(files)>11 or any(not re.fullmatch(pattern,n) or n==main or n in ('boot.py','__init__.py') or '\x00' in t for n,t in files.items()):raise ValueError('Invalid project file')
 if '\x00' in source or sum(len(t.encode('utf8')) for t in [source,*files.values()])>24000:raise ValueError('Combined source budget is 24 KB')
 return files
def compilation_source(source,files):
 return json.dumps({'files':files,'source':source},sort_keys=True,separators=(',',':'),ensure_ascii=False) if files else source
class Project(Strict):
 peer:'Project | None'=None
 network_connected:bool=False
 project_version:str
 board_profile_version:str
 board_type:str
 name:str=Field(max_length=80)
 revision:int=Field(ge=1,le=1000000)
 parts:list[Part]=Field(min_length=1,max_length=24)
 wires:list[Wire]=Field(max_length=96)
 source:str=Field(max_length=20000)
 files:dict[str,str]=Field(default_factory=dict)
 notes:str=Field(default='',max_length=2600)
 language:str
 task:str=Field(default='',max_length=16)
 runs:list=Field(default_factory=list,max_length=2)
 @model_validator(mode='after')
 def check(self):
  if self.project_version!=VERSION or self.board_profile_version!='vendor-pin-map-v1'or self.board_type not in BOARDS:raise ValueError('Unsupported schema/board profile')
  if self.language!=BOARDS[self.board_type]['language']:raise ValueError('Language does not match selected board')
  if self.runs:raise ValueError('Import project definition only; do not submit invented run records')
  if self.peer and(self.peer.peer or self.language!='arduino' or self.peer.language!='arduino'):raise ValueError('Only two AVR boards per UART pair')
  validate_files(self.source,self.files,self.language)
  ids=[x.id for x in self.parts]
  if len(set(ids))!=len(ids)or sum(x.type=='board'for x in self.parts)!=1:raise ValueError('Unique parts and exactly one board required')
  ends=set()
  for p in self.parts:
   if p.type=='board':
    pins=[x['id']for x in BOARDS[self.board_type]['pins']if x['mode']!='unsupported']
   else:pins=PINS[p.type]
   ends.update(p.id+':'+pin for pin in pins)
   if p.type=='generator'and(p.params['offset_v']-p.params['amplitude_v']<0 or p.params['offset_v']+p.params['amplitude_v']>BOARDS[self.board_type]['volts']):raise ValueError('Generator exceeds selected rails')
   if p.type=='source'and p.params['volts']>BOARDS[self.board_type]['volts']:raise ValueError('Source exceeds selected board rail')
  links=set();wireids=set()
  for w in self.wires:
   key=tuple(sorted([w.a,w.b]))
   if w.a==w.b or w.a not in ends or w.b not in ends or key in links or w.id in wireids:raise ValueError('Invalid/duplicate supported wire endpoint')
   links.add(key);wireids.add(w.id)
  return self
