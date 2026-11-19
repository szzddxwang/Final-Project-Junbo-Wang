"""Build fixed argument lists for the Linux-only isolated compiler."""
from pathlib import Path
import os,re,subprocess,sys

TOOLS=Path(__file__).resolve().parents[2]/'tools/programmable_simulator'
def command(script_name,job_id):
 if script_name not in ('compile_worker.py','compile_worker_expansion.py') or not re.fullmatch('[a-f0-9]{32}',job_id):
  raise ValueError('Invalid compiler job command')
 script=TOOLS/script_name
 if os.name!='nt':return [sys.executable,str(script),job_id]
 distro=os.environ.get('MICROEXPLORE_WSL_DISTRO','Ubuntu-22.04')
 result=subprocess.run(['wsl.exe','-d',distro,'--exec','wslpath','-a',str(script)],capture_output=True,text=True,timeout=10,check=True,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
 path=result.stdout.strip()
 if not path.startswith('/'):raise RuntimeError('Linux compiler path could not be resolved')
 return ['wsl.exe','-d',distro,'--exec','python3',path,job_id]
