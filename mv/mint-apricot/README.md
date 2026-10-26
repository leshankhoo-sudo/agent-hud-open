# Mint & Apricot：AI 小精灵恋爱 MV

一支 32.7 秒、130.6 BPM 的黏土质感 Q 版 3D MV，用 three.js 制作，每一帧都对准拍点，逐帧离线渲染。

- **GPT**：奶白色身体、薄荷绿光环和小芽，性格活泼，会主动靠近
- **Claude**：杏桃色身体、橙色太阳星芒，性格温柔、有点害羞，会偷偷回应

## 分镜（单位：拍，1 拍约 0.459 秒）
| 拍 | 剧情 |
|---|---|
| 0–8 | 奶油色微缩小岛，标题淡入，Claude 独自随拍轻晃 |
| 8–16 | GPT 每拍跳一下进场，落在第 15 拍并挥手打招呼 |
| 16–24 | GPT 在第 16/18/20 拍挪近一步，Claude 在第 17/19/21 拍偷看、脸红，第 22 拍害羞发光（^ ^ 眼） |
| 24–32 | 近景：GPT 的手在第 24/25/26 拍一点点靠近，Claude 在第 27 拍回应，第 28 拍牵上，闪光并冒出一颗小爱心 |
| 32–40 | 靠肩随拍摇摆，天色转为黄昏，星星每拍亮起一颗，第 38 拍划过一颗流星 |
| 40–56 | 手牵手追星星：每拍跳一下、每拍摘到一颗星并爆出火花，第 47 拍原地转身 |
| 56–64 | 大星星缓缓降落，第 60 拍两人一起接住，星芒绽开，第 62 拍 GPT 开心转圈 |
| 64– | 依偎在一起，镜头拉远，片尾字卡，淡出 |

## 重新渲染
```bash
pip install librosa && python3 analyze.py           # 节拍分析，需要同目录下的 song.mp3
mkdir lib && (cd lib && npm i three@0.169.0)
python3 -m http.server 8765 &                       # 在本目录下运行
NODE_PATH=$(npm root -g) node render.js . 1280 30 0 982 frames   # 需要 playwright
ffmpeg -framerate 30 -i frames/%05d.jpg -i song.mp3 -c:v libx264 -crf 18 -pix_fmt yuv420p -c:a aac -shortest out.mp4
```
