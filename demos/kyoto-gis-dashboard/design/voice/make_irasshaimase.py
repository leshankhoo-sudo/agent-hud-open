# Make いらっしゃいませ with VOICEVOX (voicevox_core 0.17), offline. usage: python gen.py <vv dir> <out dir> [list]
import sys, os, glob, json
V, OUT = sys.argv[1], sys.argv[2]
sys.path.insert(0, os.path.join(V, 'py'))
from voicevox_core.blocking import Onnxruntime, OpenJtalk, Synthesizer, VoiceModelFile
ort = glob.glob(os.path.join(V, 'voicevox_core', 'onnxruntime', 'lib', '*.dll'))
ortlib = [p for p in ort if 'onnxruntime' in os.path.basename(p).lower()][0]
syn = Synthesizer(Onnxruntime.load_once(filename=ortlib), OpenJtalk(os.path.join(V, 'voicevox_core', 'dict', 'open_jtalk_dic_utf_8-1.11')))
with VoiceModelFile.open(os.path.join(V, 'voicevox_core', 'models', 'vvms', '0.vvm')) as m:
    syn.load_voice_model(m)
    metas = m.metas
for c in metas:
    print(c.name, [(s.name, s.id) for s in c.styles])
if len(sys.argv) > 3: sys.exit()
sid = next(s.id for c in metas if c.name == '春日部つむぎ' for s in c.styles if s.name == 'ノーマル')
os.makedirs(OUT, exist_ok=True)
for name, text, speed, pitch, inton in [('a', 'いらっしゃいませ！', 1.0, 0.0, 1.2), ('b', 'いらっしゃいませ〜！', 0.95, 0.03, 1.4), ('c', 'いらっしゃいませ！', 1.05, 0.05, 1.5)]:
    q = syn.create_audio_query(text, sid)
    q.speed_scale, q.pitch_scale, q.intonation_scale = speed, pitch, inton
    q.pre_phoneme_length, q.post_phoneme_length = 0.05, 0.12
    open(os.path.join(OUT, f'irasshaimase-{name}.wav'), 'wb').write(syn.synthesis(q, sid))
print('style', sid)
