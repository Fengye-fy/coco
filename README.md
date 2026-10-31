# coco

一个只在自己工作区里干活的视觉 agent。窗口左边是 coco，右边是它的工作区：网页、桌面应用和 WSA 安卓应用以拼贴的方式排在 coco 窗口里。coco 靠截图看这些拼贴，用鼠标和键盘操作它们完成任务，看不到也碰不到工作区以外的东西。

Electron + React + TypeScript，Windows 10/11。给使用者看的完整说明（含 WSA 安装）见 [coco使用说明.md](coco使用说明.md)。

## 启动

需要 Node.js 22.12+（推荐 24 LTS）。

```powershell
npm install
npm run dev
```

也可以双击 `启动coco.cmd`：有打包好的 `release/win-unpacked/coco.exe` 就直接打开，否则安装依赖、构建并启动。

## 使用

- **工作区**：标题栏上的标签。每个工作区有自己的 coco 和自己的拼贴，可以多开、同时工作。双击标签改名，`Ctrl+Shift+N` 新建。
- **拼贴**：空拼贴里可以打开网页、开始菜单里的应用、WSA 安卓应用，或接入一个已经打开的窗口。拼贴按列排布、列内上下堆叠：标题栏按钮向右 / 向下拆分、最大化、关闭，拖动缝隙调整大小，`Ctrl+Shift+T` 新建拼贴。
- **嵌入的应用**会去掉标题栏，跟随 coco 移动、缩放和最小化，被拖出拼贴或最大化会自动弹回，切换工作区时隐藏。关闭拼贴会关闭其中的应用；退出 coco 时窗口会带着原来的标题栏和位置还给桌面。
- **和 coco 对话**：说清要做什么。它工作时可以暂停，你直接在拼贴里动手后再继续；遇到需要你决定的事它会提问。同一工作区里的后续消息会接着上文。

## coco 的视野

- 工具只有四个：`tiles`（列出 / 打开 / 关闭拼贴）、`look`（截图）、`act`（点击、拖动、滚动、输入、按键、等待）、`web`（网页拼贴的导航、读取页面和按编号点击 / 填写）。没有桌面截图、文件或终端工具。
- 截图只截拼贴本身：网页用 `capturePage`，应用用 `PrintWindow`。只有当画面确实属于该窗口时才退回屏幕取像，被别的窗口挡住就拒绝。每次操作后自动附上新截图，coco 以看到的画面为准。
- 坐标是拼贴截图内 0–1000 的归一化坐标；点击前检查该点确实属于目标窗口。
- 网页拼贴的输入直接送进页面，后台工作区也能操作；桌面和安卓应用用真实鼠标键盘，操作前会把所属工作区切到前台，多个工作区的这类操作排队进行。文字用逐字 Unicode 按键输入，中文同样适用（WSA 安卓应用已验证）。

## 配置模型

在「设置」里填写 API 地址（例如 `https://api.openai.com/v1`，自动请求 `/responses`）、API Key 和模型 ID。模型需支持 Responses API、图片输入和函数工具调用。先「测试连接」再「测试视觉」，然后保存。

Key 用 Electron `safeStorage`（Windows 系统加密）保存，界面读不到已保存的 Key。拼贴截图和任务会发送给你配置的模型服务；视觉测试只截取 coco 自己的窗口。任务记录保存在用户数据目录，截图只留在当前会话里。网页下载保存在「下载/coco」。

## 目录

```text
electron/
  main.cjs             窗口、IPC、退出时归还嵌入窗口
  workspaces.cjs       工作区与拼贴：网页视图、应用接管与位置跟随、截图、输入
  native.cjs           常驻 PowerShell 窗口服务的客户端
  native/host.ps1      Win32：窗口枚举、去边框与所有者、定位、PrintWindow、鼠标键盘、开始菜单与 WSA 应用
  tools.cjs            agent 可用的工具，全部限定在所属工作区
  agent.cjs            对话循环、暂停 / 接管 / 提问、上下文与截图裁剪
  provider.cjs         Responses API 适配
  config.cjs           设置校验与密钥加密
  history.cjs          任务记录
src/
  App.tsx              标题栏工作区标签、左右分栏、布局同步
  layout.ts            列 + 堆叠的拼贴布局（纯函数）
  components/          AgentPanel、TileArea、Launcher、设置与历史
scripts/               开发启动、冒烟测试、原生嵌入验证、图标生成
tests/                 引擎、服务、布局的单元测试
```

## 测试

```powershell
npm test              # 引擎、服务、布局、窗口服务协议
npm run test:smoke    # 用本地模拟模型跑完整流程：网页拼贴 + 嵌入记事本
npm run test:native   # 嵌入窗口跟随移动 / 缩放、随工作区隐藏、退出时归还
npm run test:dev      # 开发服务器与预加载
npm run build         # 类型检查与界面构建
npm run dist:dir      # 生成免安装目录 release/win-unpacked
npm run dist          # 生成 NSIS 安装包
npm run icon          # 重新生成 build/icon.png 与 icon.ico
```

## 已知限制

- 嵌入用的是「coco 窗口作为所有者 + 去边框 + 位置跟随」，不是 `SetParent`，对 UWP 和 WSA 更稳。自绘标题栏的应用（如 WSA、部分 UWP）仍会显示自己的标题区域。
- 以管理员权限运行的应用无法接管或操作。
- 单实例桌面应用已经在运行时，启动不会出现新窗口，需要在「窗口」里接入；安卓应用已在运行时会按包名直接找到。
- WSA 已由微软停止支持，需要本机已安装 WSA；首次启动较慢。
- 后台工作区里的桌面 / 安卓应用要切到前台才能看和操作；网页拼贴不受影响。
