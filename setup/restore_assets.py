"""Restore the checked-in, losslessly compressed runtime assets."""
from pathlib import Path
import gzip,hashlib,json,tempfile,shutil

ROOT=Path(__file__).resolve().parents[1]/'backend'
STORE=ROOT/'assets'
manifest=json.loads((STORE/'manifest.json').read_text(encoding='utf-8'))
for entry in manifest['files']:
 target=(ROOT/entry['path']).resolve()
 if not target.is_relative_to(ROOT.resolve()):raise ValueError('Asset path escapes backend')
 if target.is_file() and hashlib.sha256(target.read_bytes()).hexdigest()==entry['sha256']:continue
 target.parent.mkdir(parents=True,exist_ok=True)
 with tempfile.TemporaryFile() as combined:
  for part in entry['parts']:
   source=(STORE/part['file']).resolve()
   if not source.is_relative_to(STORE.resolve()):raise ValueError('Part path escapes assets')
   content=source.read_bytes()
   if hashlib.sha256(content).hexdigest()!=part['sha256']:raise ValueError('Corrupt asset part: '+part['file'])
   combined.write(content)
  combined.seek(0)
  temporary=target.with_name(target.name+'.restoring')
  with gzip.GzipFile(fileobj=combined) as src,temporary.open('wb') as dst:shutil.copyfileobj(src,dst)
  if hashlib.sha256(temporary.read_bytes()).hexdigest()!=entry['sha256']:raise ValueError('Restored asset hash mismatch')
  temporary.replace(target)
 print('Restored',entry['path'])
print('Runtime assets verified for',manifest['current_diagnostic_model'])
