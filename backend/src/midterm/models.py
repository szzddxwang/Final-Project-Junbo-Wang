"""Small multiscale temporal encoder and trainable reliability gate."""
import torch
from torch import nn
class TemporalNet(nn.Module):
    def __init__(self,channels,features,classes):
        super().__init__()
        self.branches=nn.ModuleList([nn.Sequential(nn.Conv1d(channels,12,k,padding=k//2),nn.GELU(),nn.Conv1d(12,12,5,padding=4,dilation=2),nn.GELU(),nn.AdaptiveAvgPool1d(4),nn.Flatten()) for k in (3,9,21)])
        self.aux=nn.Sequential(nn.Linear(features,32),nn.GELU())
        self.encode=nn.Sequential(nn.Linear(176,48),nn.GELU(),nn.Dropout(.1));self.head=nn.Linear(48,classes)
    def forward(self,x,f,embedding=False):
        h=self.encode(torch.cat([b(x) for b in self.branches]+[self.aux(f)],dim=1));z=self.head(h)
        return (z,h) if embedding else z
class ReliabilityGate(nn.Module):
    def __init__(self,dims,classes):
        super().__init__();self.dims=dims
        self.experts=nn.ModuleList([nn.Sequential(nn.Linear(d,32),nn.GELU(),nn.Linear(32,classes)) for d in dims])
        self.gate=nn.Sequential(nn.Linear(sum(dims)+6,24),nn.GELU(),nn.Linear(24,3))
    def forward(self,values,presence,quality,mode='gate'):
        parts=torch.split(values,self.dims,dim=1);logits=torch.stack([m(v) for m,v in zip(self.experts,parts)],dim=1)
        raw=self.gate(torch.cat([values,presence,quality],dim=1)) if mode=='gate' else torch.zeros_like(presence)
        weights=torch.softmax(raw.masked_fill(presence<.5,-1e9),dim=1)
        return (weights[:,:,None]*torch.softmax(logits,dim=2)).sum(dim=1),weights
