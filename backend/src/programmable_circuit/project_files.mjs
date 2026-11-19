/* Bounded project files; names never become shell commands or host paths. */
export function projectFiles(p){
 const main=p.language==='arduino'?'sketch.ino':'main.py', extra=p.files||{};
 if(!extra||Array.isArray(extra)||typeof extra!=='object'||Object.keys(extra).length>11)throw Error('Use at most 12 project files.');
 if(p.source.includes('\0'))throw Error('NUL is not valid source.');const names=new Set([main.toLowerCase()]);let bytes=new TextEncoder().encode(p.source).length;
 for(const [name,text]of Object.entries(extra)){
  const ext=p.language==='arduino'?/^[A-Za-z][A-Za-z0-9_-]{0,47}\.(h|hpp|cpp|c|ino)$/:/^[A-Za-z][A-Za-z0-9_]{0,47}\.py$/;
  if(names.has(name.toLowerCase())||/^(con|prn|aux|nul|com[1-9]|lpt[1-9])\./i.test(name)||!ext.test(name)||name===main||['__init__.py','boot.py'].includes(name)||typeof text!=='string'||text.includes('\0'))throw Error('Invalid project file name or content.');
  names.add(name.toLowerCase());bytes+=new TextEncoder().encode(text).length;
 }
 if(bytes>24000)throw Error('Combined source budget is 24 KB.');
 return {[main]:p.source,...extra};
}
export function compilationSource(p){projectFiles(p);const files=p.files||{};return Object.keys(files).length?JSON.stringify({files:Object.fromEntries(Object.entries(files).sort(([a],[b])=>a<b?-1:a>b?1:0)),source:p.source}):p.source;}
export function picoProgram(p){const files=projectFiles(p),extra=Object.entries(files).filter(([name])=>name!=='main.py');if(!extra.length)return p.source;return `import os,sys
class _ProjectDisk:
 def __init__(self): self.b=bytearray(65536)
 def readblocks(self,n,b,off=0): b[:]=self.b[n*512+off:n*512+off+len(b)]
 def writeblocks(self,n,b,off=0): self.b[n*512+off:n*512+off+len(b)]=b
 def ioctl(self,op,arg):
  if op==4: return 128
  if op==5: return 512
  if op==6: self.b[arg*512:(arg+1)*512]=b'\\xff'*512
  return 0
_disk=_ProjectDisk()
os.VfsLfs2.mkfs(_disk)
os.mount(os.VfsLfs2(_disk),'/project')
os.chdir('/project')
sys.path.insert(0,'/project')
`+extra.map(([name,text])=>`with open(${JSON.stringify(name)},'w') as f: f.write(${JSON.stringify(text)})`).join('\n')+'\nexec(compile('+JSON.stringify(p.source)+",'main.py','exec'))\n";}
