"""Network definition used by the packaged waveform inference weights."""

def _torch():
    import torch
    from torch import nn
    return torch, nn

def make_model(channels: int, classes: int):
    torch, nn = _torch()

    class ConvNet(nn.Module):
        def __init__(self):
            super().__init__()
            self.encoder = nn.Sequential(
                nn.Conv1d(channels, 16, 9, padding=4), nn.BatchNorm1d(16), nn.GELU(), nn.AvgPool1d(2),
                nn.Conv1d(16, 32, 5, padding=2), nn.BatchNorm1d(32), nn.GELU(), nn.AvgPool1d(2),
                nn.Conv1d(32, 32, 5, padding=2), nn.BatchNorm1d(32), nn.GELU(), nn.AdaptiveAvgPool1d(1),
                nn.Flatten(),
            )
            self.classifier = nn.Linear(32, classes)

        def forward(self, x, return_embedding=False):
            embedding = self.encoder(x)
            logits = self.classifier(embedding)
            return (logits, embedding) if return_embedding else logits

    return ConvNet()
