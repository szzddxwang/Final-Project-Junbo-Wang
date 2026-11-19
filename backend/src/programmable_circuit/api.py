"""Private loopback compiler bridge. Does not change production diagnosis paths."""
from pathlib import Path
import hashlib,json,secrets,subprocess,threading,uuid,os
from fastapi import APIRouter,Request,HTTPException
from pydantic import BaseModel,Field,ConfigDict,field_validator,model_validator
from .schema import Project,BOARDS,validate_files,compilation_source
from .worker_process import command as worker_command
T=Path(__file__).resolve().parents[2]/'tools/programmable_simulator'
TOKEN=Path(__file__).resolve().parents[2]/'config/programmable_worker.token'
router=APIRouter(prefix='/ai/programmable',tags=['controlled-programmable-simulation'])
_slot=threading.BoundedSemaphore(1)
_jobs={}
_jobs_lock=threading.Lock()
class Sketch(BaseModel):
 model_config=ConfigDict(extra='forbid')
 source:str=Field(min_length=1,max_length=20000)
 files:dict[str,str]=Field(default_factory=dict)
 board_type:str='uno_r3'
 @model_validator(mode='after')
 def file_check(self):
  validate_files(self.source,self.files,'arduino');return self
 @field_validator('board_type')
 @classmethod
 def supported_target(cls,v):
  if v not in BOARDS or BOARDS[v]['family']not in ('atmega328p','atmega2560'):raise ValueError('Unsupported AVR compilation target')
  return v
class Submit(Sketch):owner:str=Field(pattern=r'^[1-9][0-9]{0,18}$')
class Job(BaseModel):
 model_config=ConfigDict(extra='forbid')
 owner:str=Field(pattern=r'^[1-9][0-9]{0,18}$')
 job_id:str=Field(pattern=r'^[a-f0-9]{32}$')
def authorize(r:Request):
 if not TOKEN.is_file()or not secrets.compare_digest(r.headers.get('X-MicroExplore-Worker',''),TOKEN.read_text().strip()):raise HTTPException(403,'Use the authenticated native Circuit Workbench.')
@router.post('/validate')
def validate_project(q:Project,request:Request):
 authorize(request);p=q.model_dump();return {'project':p,'source_sha256':hashlib.sha256(compilation_source(q.source,q.files).encode()).hexdigest(),'sha256':hashlib.sha256(json.dumps(p,sort_keys=True,separators=(',',':'),ensure_ascii=False).encode()).hexdigest()}
def _job_result(q):
 with _jobs_lock:
  entry=_jobs.get(q.job_id)
  if not entry or entry['owner']!=q.owner:raise HTTPException(404,'This compiler job is unavailable.')
  r=dict(entry['result'])
  if r.get('pending'):
   phase=T/'jobs'/q.job_id/'PHASE.json'
   try:r['phase']=json.loads(phase.read_text())['phase']
   except (OSError,ValueError,KeyError):pass
  return r
@router.post('/submit')
def submit(q:Submit,request:Request):
 authorize(request)
 if '\x00'in q.source:raise HTTPException(422,'NUL is not valid sketch input.')
 if len(q.source.encode('utf8'))>24000:raise HTTPException(422,'Sketch exceeds the 24 KB UTF-8 compiler source budget.')
 if not _slot.acquire(blocking=False):raise HTTPException(429,'The isolated compiler is busy; wait for its current job.')
 jobid=uuid.uuid4().hex;job=T/'jobs'/jobid;(job/'sketch').mkdir(parents=True);(job/'sketch/sketch.ino').write_text(q.source,encoding='utf8',newline='\n')
 for name,content in q.files.items():(job/'sketch'/name).write_text(content,encoding='utf8',newline='\n')
 (job/'TARGET.json').write_text(json.dumps({'board_type':q.board_type}))
 result={'board_type':q.board_type,'fqbn':BOARDS[q.board_type]['fqbn'],'phase':'Preparing isolated compiler','pending':True,'ok':False,'job_id':jobid,'source_sha256':hashlib.sha256(compilation_source(q.source,q.files).encode()).hexdigest()}
 with _jobs_lock:
  if len(_jobs)>128:
   for key in list(_jobs):
    if not _jobs[key]['result'].get('pending'):_jobs.pop(key)
  _jobs[jobid]={'owner':q.owner,'result':result}
 def execute():
  try:
   argv=worker_command('compile_worker.py',jobid)
   completed=subprocess.run(argv,capture_output=True,timeout=55,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
   r=json.loads((job/'RESULT.json').read_text())if completed.returncode==0 and(job/'RESULT.json').exists()else {'ok':False,'diagnostics':'Restricted worker unavailable. No unrestricted fallback was used.'}
   r.update(pending=False,job_id=jobid,board_type=q.board_type,fqbn=BOARDS[q.board_type]['fqbn'])
  except Exception:r={'pending':False,'ok':False,'job_id':jobid,'diagnostics':'Worker deadline or process failure. Retry a safe isolated build.'}
  finally:_slot.release()
  with _jobs_lock:_jobs[jobid]['result']=r
 threading.Thread(target=execute,daemon=True,name='isolated-avr-'+jobid[:8]).start()
 return result
@router.post('/poll')
def poll(q:Job,request:Request):authorize(request);return _job_result(q)
@router.post('/cancel')
def cancel(q:Job,request:Request):
 authorize(request);r=_job_result(q)
 if r.get('pending'):(T/'jobs'/q.job_id/'CANCEL').write_text('cancel requested by authenticated job owner')
 return {**r,'cancel_requested':True}
@router.post('/compile')
def compile_sketch(q:Sketch,request:Request):
 authorize(request)
 if '\x00'in q.source:raise HTTPException(422,'NUL is not valid sketch input.')
 if len(q.source.encode('utf8'))>24000:raise HTTPException(422,'Sketch exceeds the 24 KB UTF-8 compiler source budget.')
 if not _slot.acquire(blocking=False):raise HTTPException(429,'One isolated compiler job is active. Try again after it finishes.')
 try:
  jobid=uuid.uuid4().hex;job=T/'jobs'/jobid;(job/'sketch').mkdir(parents=True)
  (job/'sketch/sketch.ino').write_text(q.source,encoding='utf8',newline='\n')
  for name,content in q.files.items():(job/'sketch'/name).write_text(content,encoding='utf8',newline='\n')
  (job/'TARGET.json').write_text(json.dumps({'board_type':q.board_type}))
  # Fixed executable/arguments; neither source, filenames nor options enter a shell.
  argv=worker_command('compile_worker.py',jobid)
  proc=subprocess.run(argv,capture_output=True,timeout=55,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
  if proc.returncode or not (job/'RESULT.json').exists():raise HTTPException(503,'Isolated compiler unavailable. Existing Labs remain available; no unrestricted fallback is used.')
  r=json.loads((job/'RESULT.json').read_text());r['job_id']=jobid;r['source_sha256']=hashlib.sha256(compilation_source(q.source,q.files).encode()).hexdigest();return r
 except subprocess.TimeoutExpired:raise HTTPException(504,'Compiler wall-time limit reached; no firmware was accepted.')
 finally:_slot.release()
