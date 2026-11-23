Kyoto Prefecture Travel Atlas · 京都府 旅の地図（完整版）—— Windows 使用说明
==========================================================

完整版和在线预览版的区别：完整版有真实底图（地理院瓦片 / OpenStreetMap），
也能请求 Open-Meteo 实时天气。使用时电脑需要连上网络。


方法一：双击启动（推荐，不需要安装任何软件）
------------------------------------------------
1. 在下载好的 ZIP 上按右键 → 选择"全部解压缩(Extract All)"。
   注意：必须先解压。不要在 ZIP 预览窗口里直接双击文件。
2. 打开解压出来的 Kyoto-Prefecture-Travel-Atlas 文件夹，
   双击 Start-Dashboard.bat。
3. 会弹出一个黑色窗口，浏览器随后会自动打开
   http://localhost:8765/ （端口被占用时会自动改用 8766、8767……）。
4. 使用期间请保持黑色窗口打开。用完关掉这个窗口即可。

可能遇到的提示：
- 出现"Windows 已保护你的电脑"（蓝色窗口）：
  点"更多信息(More info)"→"仍要运行(Run anyway)"。
  原因是这个文件是从网上下载的，Windows 默认会先拦一下。
- 黑色窗口一闪就关掉了：
  在 ZIP 文件上按右键 →"属性"→ 勾选"解除锁定(Unblock)"→"确定"，
  然后重新解压，再双击一次。
- 浏览器没有自动打开：
  自己打开 Edge 或 Chrome，输入黑色窗口里显示的网址。
- 页面一直显示 Loading：
  确认你是用 http://localhost:... 打开的。
  直接双击 site\index.html 是打不开的，浏览器会阻止网页读取本地的数据文件。


方法二：电脑已经装了 Python
--------------------------
在 site 文件夹的空白处按住 Shift 再按右键 →"在此处打开 PowerShell 窗口"，输入：
    python -m http.server 8000
然后在浏览器打开 http://localhost:8000/


方法三：修改代码（需要安装 Node.js 和 Git）
------------------------------------------------
这个 ZIP 只包含构建好的网站。源代码在 GitHub 仓库 leshankhoo-sudo/agent-hud-open 的
ccr-bd068911-ydjxlc 分支，demos/kyoto-gis-dashboard 文件夹里：
    npm install
    npm run dev          然后打开 http://localhost:5173/
    npm run build        生成新的网站（dist 文件夹），复制过来替换 site 文件夹即可


助手（Ask）：连上 Google Gemini
--------------------------------
地图左边工具栏的 Ask the atlas，或行程规划左下角 Support 里的 Ask the assistant，会打开助手。
它回答景点问题、帮你把地点加进行程的某一天、解释数据，也会替你打开对应的面板。
它用你自己的 Gemini API key，key 只放在这台电脑里：
1. 打开 https://aistudio.google.com/ ，按 Get API key → Create API key。
2. 在开始菜单打开 PowerShell，输入（引号里换成你的 key）：
       setx GEMINI_API_KEY "你的key"
3. 回到助手按 Check again。如果还是显示没连上，关掉黑色窗口，再双击 Start-Dashboard.bat。
- 想换模型：setx GEMINI_MODEL "模型名"（默认 gemini-4-hydrogen）。
- key 不会出现在网页里，也不在这个文件夹的任何文件里：网页把问题交给 serve.ps1，
  serve.ps1 加上 key 再转给 Google。不要把 key 发给别人或贴进聊天。
- 费用和额度按 Google 的规定，请在 AI Studio 查看。
- 在线预览版没有这个本机服务器，所以助手只能在这个 ZIP（或开发服务器）里用。

文件夹说明
----------
Start-Dashboard.bat   双击启动（会调用 serve.ps1）
serve.ps1             本机小网页服务器，只有你自己的电脑能访问，不会开放给网络；
                      也负责把助手的问题加上你的 key 转给 Gemini
site\                 已经构建好的完整网站，包括 data\ 里全部运行用的数据、开场视频和四季图片

需要知道的事
------------
- 底图和天气都不需要账号或 API key（只有助手需要你自己的 Gemini key，见上面）。但它们都有免费使用额度，并且要求注明出处。
- 天气是 Open-Meteo 的模型预报，不是景点现场的实测。
  如果显示"Weather unavailable"，等一会儿再点 Refresh。
- 右上角的茶室小窗是背景音乐：左右拖动玻璃透镜调音量（往右拖会开始播放），按一下透镜是播放或暂停。音量同时推进窗里的像素风小故事「紅葉の小さな奇跡」；音乐播放时风铃会按节拍发出声波，还有动作音效。点窗里的猫、蜡烛、枫树、风铃也有反应。
- 最右边的明暗开关可以点、拖或用键盘切换；拖到一半松手会弹回最近的一端。
- 四季页后面的全景页是为本项目画的示意图，不是地图数据；在电脑上左右移动鼠标可以“转头”看。
- 步行路线覆盖京都府全部 523 个景点记录（按道路类别假设能否步行，没有逐条人工核对）。
- 开场第 2 页的四季图片来自 Pinterest，原作者不明，只限课业使用，不要公开发布。
- 道路原始资料（大约 80 MB）没有放进这个 ZIP。
  需要重新计算步行路线时，参照仓库里 README.md 第 4 节。
