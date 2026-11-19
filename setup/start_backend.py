"""Start the local backend with its own interpreter and a loopback listener."""
from pathlib import Path
import os,sys
root=Path(__file__).resolve().parents[1]/'backend'
if not (root/'config/programmable_worker.token').exists():
 raise SystemExit('Run setup/init_local.py first.')
os.chdir(root)
os.execv(sys.executable,[sys.executable,'-m','uvicorn','src.api:app','--host','127.0.0.1','--port','8000','--workers','1'])
