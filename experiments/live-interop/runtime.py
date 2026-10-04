import json, os, queue, signal, subprocess, threading, time

class Process:
 def __init__(self,argv,**kwargs):
  self.proc=subprocess.Popen(argv,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,start_new_session=True,**kwargs)
  self.events=queue.Queue(); self.pending={}; self.lock=threading.Lock(); self.counter=0
  self.messages=[]; self.errors=[]
  def errors():
   for line in self.proc.stderr:
    self.errors.append(line)
  threading.Thread(target=errors,daemon=True).start()
  threading.Thread(target=self._read,daemon=True).start()
 def _read(self):
  for line in self.proc.stdout:
   try:m=json.loads(line)
   except ValueError:continue
   rid=m.get('id')
   with self.lock: p=self.pending.get(rid) if rid is not None else None
   if p is not None and 'method' not in m:p.put(m)
   else:self.events.put(m)
 def write(self,message):
  with self.lock:
   self.proc.stdin.write(json.dumps(message)+'\n');self.proc.stdin.flush()
 def call(self,method,params):
  with self.lock:
   self.counter+=1;rid=self.counter;p=queue.Queue();self.pending[rid]=p
  try:
   self.write({'id':rid,'method':method,'params':params})
   
   try:m=p.get(timeout=45)
   except queue.Empty:raise TimeoutError('RPC '+method+'; child exit='+str(self.proc.poll())+'; stderr lines='+str(len(self.errors)))
   if 'error' in m:raise RuntimeError(json.dumps(m['error']))
   return m['result']
  finally:
   with self.lock:self.pending.pop(rid,None)
 def wait(self,predicate,timeout=90):
  deadline=time.monotonic()+timeout
  while time.monotonic()<deadline:
   m=self.events.get(timeout=max(.01,deadline-time.monotonic()))
   self.messages.append(m)
   if predicate(m):return m
  raise TimeoutError('event')
 def close(self):
  try:os.killpg(self.proc.pid,signal.SIGTERM)
  except (ProcessLookupError,PermissionError):pass
  try:self.proc.wait(timeout=4)
  except subprocess.TimeoutExpired:self.proc.kill();self.proc.wait()
  try:os.killpg(self.proc.pid,signal.SIGKILL)
  except (ProcessLookupError,PermissionError):pass
