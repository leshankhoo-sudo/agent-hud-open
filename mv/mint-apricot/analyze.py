import librosa, numpy as np, json
y,sr=librosa.load('song.mp3',sr=22050)
tempo,beats=librosa.beat.beat_track(y=y,sr=sr,units='time')
oenv=librosa.onset.onset_strength(y=y,sr=sr)
onsets=librosa.onset.onset_detect(onset_envelope=oenv,sr=sr,units='time')
rms=librosa.feature.rms(y=y)[0]; t=librosa.times_like(rms,sr=sr)
# per-30fps energy
fps=30; n=int(len(y)/sr*fps)+1
en=np.interp(np.arange(n)/fps,t,rms); en=(en-en.min())/(en.max()-en.min())
on=np.interp(np.arange(n)/fps,librosa.times_like(oenv,sr=sr),oenv); on=on/on.max()
# sections via agglomerative
chroma=librosa.feature.chroma_cqt(y=y,sr=sr)
mf=librosa.feature.mfcc(y=y,sr=sr)
bnd=librosa.segment.agglomerative(np.vstack([chroma,mf/50]),6)
bt=librosa.frames_to_time(bnd,sr=sr)
json.dump(dict(tempo=float(np.atleast_1d(tempo)[0]),beats=[round(float(b),3) for b in beats],onsets=[round(float(o),3) for o in onsets],energy=[round(float(e),3) for e in en],onset=[round(float(e),3) for e in on],sections=[round(float(b),2) for b in bt],duration=len(y)/sr),open('audio.json','w'))
print(tempo, len(beats), beats[:8], bt)
print('energy per sec', [round(float(en[i*30:(i+1)*30].mean()),2) for i in range(33)])
