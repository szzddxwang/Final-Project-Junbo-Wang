"""Matched-observation and stimulus-response features; no simulator imports."""
import math
import numpy as np
CHANNELS=('supply_ratio','terminal_ratio','current_ratio','response_ratio','wire_resistance','noise_fraction','reference_ratio','adc_code_fraction','baud_ratio','frame_error','ack_fraction','frequency_ratio','driver_duty','speed_probe','motor_current_ratio')
EXTRA_NAMES=tuple(f'extended:{c}:{k}'for c in CHANNELS for k in ('repeat_change','repeat_z','repeat_count','quadratic_residual','range_z'))

def features(packet):
    if len(packet.captures)<4:
        result=np.full(len(EXTRA_NAMES),np.nan,dtype=np.float32)
        result[np.arange(len(CHANNELS))*5+2]=0
        return result
    out=[]
    for key in CHANNELS:
        rows=[(c.command_fraction,c.time_s,c.channels[key],c.uncertainty.get(key,0.))for c in packet.captures if key in c.channels]
        pairs=[(a,b)for i,a in enumerate(rows)for b in rows[i+1:]if abs(a[0]-b[0])<1e-8 and abs(a[1]-b[1])>1e-8]
        change=z=np.nan
        if pairs:
            a,b=max(pairs,key=lambda pair:abs(pair[1][1]-pair[0][1]));change=b[2]-a[2]
            z=abs(change)/max(math.hypot(a[3],b[3]),.002*max(abs(a[2]),abs(b[2])),1e-8)
        residual=spread=np.nan
        if len(rows)>=2:
            v=np.array([r[2]for r in rows]);u=np.array([r[3]for r in rows]);spread=float(np.ptp(v))/max(float(np.sqrt(np.sum(u*u))),.002*max(abs(v).max(),1e-4),1e-8)
        if len(rows)>=3 and len(set(r[0]for r in rows))>=3:
            x=np.array([r[0]for r in rows]);v=np.array([r[2]for r in rows]);a=np.c_[np.ones(len(x)),x]
            residual=float(np.sqrt(np.mean((v-a@np.linalg.lstsq(a,v,rcond=None)[0])**2)))/max(float(np.std(v)),.01)
        out.extend([change,z,len(pairs),residual,spread])
    return np.asarray(out,dtype=np.float32)

def plan(packet,result=None):
    """Four explicitly requested observations, including a matched-input repeat."""
    n=len(packet.captures)
    tools=packet.available_tools
    if n>=4 or (tools is not None and not set(tools)&{'SIMULATION','OSCILLOSCOPE','LOGIC_ANALYZER','MULTIMETER','CURRENT_PROBE','RPM_ENCODER'}):return None
    end=float(np.clip(7*packet.declared.get('nominal_tau_s',.25),.3,12))if packet.system=='PWM_MOTOR_SERVO'else .2
    steps=[('low',.2,max(.005,end*.08),'Measure a low-input baseline.'),('high',.85,end,'Measure the high-input response and available configuration readbacks.'),('transient'if packet.system=='PWM_MOTOR_SERVO'else 'repeat',.6,min(20,end*1.25),'Use a third input level to check whether one cause explains the response.'),('repeat',.85,min(29,end*2),'Repeat the high-input measurement later to expose drift or intermittent behavior.')]
    action,cmd,t,why=steps[n]
    return dict(number=n+1,action=action,stimulus_fraction=cmd,time_s=t,samples=64,instruction=why,tools_required=['SIMULATION']if tools is None or 'SIMULATION'in tools else tools,uses_only_acquired_evidence=True,cost=dict(requested_acquisitions=1,base_signal_samples=64,virtual_duration_s=t))
