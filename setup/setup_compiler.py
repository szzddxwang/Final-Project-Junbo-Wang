"""Install the pinned compiler into this checkout without administrator access."""
from pathlib import Path
import json,platform,shutil,subprocess,tarfile
ROOT=Path(__file__).resolve().parents[1]/'backend'
DOWNLOAD=ROOT/'compiler_downloads'
TARGET=ROOT/'tools/programmable_simulator'
if platform.system()!='Linux' or platform.machine() not in ('x86_64','amd64'):
 raise SystemExit('Run this installer in x86_64 Ubuntu 22.04 or its WSL distribution.')
def extract(archive,destination):
 destination.mkdir(parents=True,exist_ok=True)
 with tarfile.open(archive) as handle:handle.extractall(destination,filter='data')
def tool(archive,dest):
 if dest.exists():return
 scratch=TARGET/'setup-cache'/dest.name
 extract(DOWNLOAD/archive,scratch)
 roots=list(scratch.iterdir());source=roots[0] if len(roots)==1 and roots[0].is_dir() else scratch
 dest.parent.mkdir(parents=True,exist_ok=True);shutil.copytree(source,dest)
TARGET.mkdir(parents=True,exist_ok=True)
cli=TARGET/'cli'
if not (cli/'arduino-cli').exists():extract(DOWNLOAD/'arduino-cli.tar.gz',cli)
data=TARGET/'arduino-data';data.mkdir(exist_ok=True)
for name in ('package_index.json','library_index.json'):shutil.copy2(DOWNLOAD/name,data/name)
tool('arduino-core.tar.gz',data/'packages/arduino/hardware/avr/1.8.6')
tool('avr-gcc.tar.bz2',data/'packages/arduino/tools/avr-gcc/7.3.0-atmel3.6.1-arduino7')
tool('ctags.tar.bz2',data/'packages/builtin/tools/ctags/5.8-arduino11')
for name,version in [('serial-discovery','1.5.2'),('mdns-discovery','1.1.0'),('serial-monitor','0.15.0'),('dfu-discovery','0.1.2')]:tool(name+'.tar.gz',data/'packages/builtin/tools'/name/version)
subprocess.run(['dpkg-deb','-x',str(DOWNLOAD/'bubblewrap.deb'),str(TARGET/'rootfs')],check=True)
bwrap=TARGET/'rootfs/usr/bin/bwrap'
subprocess.run([str(bwrap),'--unshare-all','--die-with-parent','--ro-bind','/usr','/usr','--ro-bind','/lib','/lib','--ro-bind','/lib64','/lib64','--proc','/proc','--dev','/dev','--tmpfs','/tmp','--uid','65534','--gid','65534','--cap-drop','ALL','/usr/bin/id'],check=True)
(TARGET/'jobs').mkdir(exist_ok=True)
print('Pinned Arduino compiler and isolated user-namespace execution are ready.')
