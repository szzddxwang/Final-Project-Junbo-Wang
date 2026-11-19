"""Linux-only restricted worker. Student C++ is compiled, never run on host."""
from pathlib import Path
import os,sys,re,subprocess,resource,json,hashlib,time,signal
T=Path(__file__).resolve().parent
if len(sys.argv)!=2 or not re.fullmatch('[a-f0-9]{32}',sys.argv[1]):raise SystemExit('Invalid job identity')
job=T/'jobs'/sys.argv[1];source=job/'sketch/sketch.ino'
assert job.is_dir() and source.stat().st_size<=24000
files={p.name:p.read_text(encoding='utf8') for p in (job/'sketch').iterdir() if p.name!='sketch.ino'}
assert len(files)<=11 and sum(p.stat().st_size for p in (job/'sketch').iterdir())<=24000
assert all(re.fullmatch(r'[A-Za-z][A-Za-z0-9_-]{0,47}\.(h|hpp|cpp|c|ino)',n) for n in files)
bundle=json.dumps({'files':files,'source':source.read_text(encoding='utf8')},sort_keys=True,separators=(',',':'),ensure_ascii=False) if files else source.read_text(encoding='utf8')
boards=json.loads((T.parent.parent/'src/programmable_circuit/boards.json').read_text())
target=json.loads((job/'TARGET.json').read_text())['board_type']if(job/'TARGET.json').exists()else'uno_r3'
assert target in boards and boards[target]['family']in ('atmega328p','atmega2560'),'Unsupported board target'
profile=boards[target]
def phase(value):
 tmp=job/'PHASE.tmp';tmp.write_text(json.dumps({'phase':value}));tmp.replace(job/'PHASE.json')
phase('Preparing isolated compiler')
os.chmod(job,0o777);os.chmod(job/'sketch',0o755)
(job/'config.yaml').write_text('directories:\n  data: /packages\n  downloads: /tmp/downloads\n  user: /tmp/user\n')
args=[str(T/'rootfs/usr/bin/bwrap'),'--unshare-all','--die-with-parent','--new-session','--ro-bind','/usr','/usr','--ro-bind','/lib','/lib','--ro-bind','/lib64','/lib64','--ro-bind',str(T/'cli'),'/cli','--tmpfs','/packages','--ro-bind',str(T/'arduino-data/packages'),'/packages/packages','--ro-bind',str(T/'arduino-data/package_index.json'),'/packages/package_index.json','--bind',str(job),'/job','--proc','/proc','--dev','/dev','--tmpfs','/tmp','--uid','65534','--gid','65534','--cap-drop','ALL','--clearenv','--setenv','HOME','/tmp','--setenv','PATH','/usr/bin:/bin','--setenv','GOMEMLIMIT','128MiB','--chdir','/job','/cli/arduino-cli','compile','--config-file','/job/config.yaml','--fqbn',profile['fqbn'],'--build-path','/job/build','/job/sketch']
lib=T/'arduino-data/library_index.json'
wirelib=T/'allowlisted-libraries';assert (wirelib/'Wire/src/Wire.h').is_file(),'Pinned allowlisted Wire library missing'
i=args.index('--bind');args[i:i]=['--ro-bind',str(wirelib),'/packages/packages/arduino/hardware/avr/1.8.6/libraries']
if lib.exists():
 i=args.index('--bind');args[i:i]=['--ro-bind',str(lib),'/packages/library_index.json']
def limits():
 resource.setrlimit(resource.RLIMIT_CPU,(30,32));resource.setrlimit(resource.RLIMIT_AS,(3*1024**3,3*1024**3));resource.setrlimit(resource.RLIMIT_FSIZE,(16*1024**2,16*1024**2));resource.setrlimit(resource.RLIMIT_NOFILE,(128,128));os.setsid()
i=args.index('/cli/arduino-cli');args[i:i]=['/usr/bin/prlimit','--nproc=64','--'];args+=['--jobs','1']
i=args.index('--chdir');args[i:i]=['--setenv','GOMAXPROCS','2']
t=time.monotonic();log=job/'compiler.log'
phase('Compiling and linking sketch')
with log.open('wb')as out:
 p=subprocess.Popen(args,stdout=out,stderr=subprocess.STDOUT,preexec_fn=limits)
 deadline=time.monotonic()+45
 while p.poll()is None and time.monotonic()<deadline and not(job/'CANCEL').exists():time.sleep(.05)
 if p.poll()is None:
  os.killpg(p.pid,signal.SIGTERM)
  try:p.wait(timeout=2)
  except subprocess.TimeoutExpired:os.killpg(p.pid,signal.SIGKILL);p.wait()
  code=130 if(job/'CANCEL').exists()else 124
 else:code=p.returncode
raw=log.read_bytes();hexfile=job/'build/sketch.ino.hex';elf=job/'build/sketch.ino.elf'
phase('Checking compiled firmware')
result=dict(board_type=target,fqbn=profile['fqbn'],clock_hz=profile['clock_hz'],ok=code==0 and hexfile.exists(),exit_code=code,elapsed_s=time.monotonic()-t,diagnostics=raw[:60000].decode(errors='replace'),source_sha256=hashlib.sha256(bundle.encode()).hexdigest(),compiler='arduino-cli-1.2.2/arduino-avr-1.8.6/avr-gcc-7.3.0',isolation='bubblewrap-0.6.1-1ubuntu0.3; user+pid+net+mount+ipc+uts namespaces; uid65534; read-only tools; no host home/mnt; no capabilities',network=False)
if code in (124,130):
 reason='Compilation reached its 45-second time limit. Your sketch and circuit are unchanged. Wait for other builds to finish, then compile again.' if code==124 else 'Compilation cancelled. Your sketch and circuit are unchanged.'
 result['diagnostics']=reason+ ('\n'+result['diagnostics'] if result['diagnostics'] else '')
if result['ok']:
 result.update(hex=hexfile.read_text(),firmware_sha256=hashlib.sha256(hexfile.read_bytes()).hexdigest(),elf_sha256=hashlib.sha256(elf.read_bytes()).hexdigest())
(job/'RESULT.json').write_text(json.dumps(result));print(json.dumps({k:v for k,v in result.items()if k not in ['hex','diagnostics']}))
raise SystemExit(0)
