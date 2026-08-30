# 应用启动器 (AppLauncher)

一个基于 Electron 的 Windows 桌面应用启动器。将常用软件按分组管理，一键启动，并配有可拖拽的桌面悬浮球，让启动应用快人一步。

## 功能特性

- 🗂️ **分组管理** — 将应用按「系统文件 / 实用工具 / 文档处理 / 浏览器 / 通讯工具 / 代码开发」等分组归类，自由增删改
- 🎯 **一键启动** — 点击即启动本地程序、URI 协议（如 `ms-outlook:`）或系统 Shell 目录（如 `shell:::{20D04FE0-...}` 直接打开此电脑、回收站、控制面板）
- 🖱️ **桌面悬浮球** — 常驻桌面的小球，拖拽到任意位置，单击弹出快捷面板，双击直达常用应用
- 📍 **位置记忆** — 悬浮球自动记住上次关闭时的位置，重启后原样恢复
- 📌 **系统托盘** — 最小化到托盘，右键菜单快捷退出，不占用任务栏
- 🚀 **开机自启** — 可选开机自动启动并隐藏主窗口，仅显示悬浮球
- 🧭 **桌面快捷方式** — 一键创建带自定义图标的桌面快捷方式
- 📊 **使用统计** — 记录每个应用的启动次数和最近使用时间

## 下载安装

### 方式一：直接下载安装包（推荐）

1. 前往本仓库的 [Releases](../../releases) 页面
2. 下载最新的 `AppLauncher-Setup-v1.0.0.zip`
3. 解压后双击运行 `install.bat`，脚本会自动：
   - 安装程序到 `%LOCALAPPDATA%\AppLauncher`
   - 创建桌面快捷方式
   - 创建开始菜单快捷方式
   - 注册「设置 - 应用」中的卸载入口

### 方式二：从源码运行

```bash
git clone https://github.com/MoonOfRuinCramorant/AppLauncher.git
cd AppLauncher
npm install
npm start
```

> 要求：Node.js ≥ 18，Windows 10/11

## 从源码构建安装包

```bash
npm install
node build.js
```

构建产物在 `dist/` 目录：

- `应用启动器-win32-x64/` — 免安装版，进入目录直接运行 `应用启动器.exe`
- `应用启动器-安装包.zip` — 完整安装包（内含 install.bat 安装脚本）

## 使用说明

- **添加应用** — 主界面点击「添加应用」，选择本地 exe / 快捷方式 / 开始菜单项，或直接填写 URI 协议
- **悬浮球** — 拖拽移动位置（自动记忆）；单击打开快捷面板；主窗口关闭后悬浮球仍在
- **开机自启** — 设置中开启「开机自动启动」
- **配置文件位置**
  - 安装版：`%APPDATA%\应用启动器\config.json`（或 AppLauncher）
  - 开发版：项目根目录 `config.json`（若存在 `config.local.json` 则优先加载）

## 技术栈

- [Electron](https://www.electronjs.org/) 33.x
- 原生 HTML / CSS / JavaScript（无前端框架）
- 手动构建流水线（`build.js`）：Electron 运行时 + asar 打包 + rcedit 图标替换 + 7z 压缩

## 项目结构

```
├── main.js          # Electron 主进程（窗口、托盘、悬浮球、IPC）
├── preload.js       # IPC 桥接层
├── renderer.js      # 主界面渲染逻辑
├── index.html       # 主界面
├── styles.css       # 主界面样式
├── floatball.js     # 悬浮球渲染逻辑
├── floatball.html   # 悬浮球页面
├── floatball.css    # 悬浮球样式
├── config.json      # 默认应用配置（公开默认，可自定义）
├── build.js         # 安装包构建脚本
├── app-icon.ico     # 应用图标
└── package.json
```

## License

[MIT](LICENSE)
