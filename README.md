# Personal Tool

一个面向 Windows 的本地优先桌面应用。首个版本把可恢复的番茄钟、活动日历和 Notion 数据库同步放在同一个工作流中，并为后续增加统计、任务、更多日历提供方预留了清晰的模块边界。

## 当前功能

- 倒计时与正向计时
- 暂停、继续、完成、重置，以及系统休眠/应用重启后的计时恢复
- 自定义常用时长和默认预设
- 番茄钟自动生成日历记录
- 周日历与手动活动记录
- 从已有 Notion 数据库读取日历事件
- 把番茄钟和手动活动写回 Notion 数据库
- 离线优先：未同步记录会保留在本机，之后可重试
- Windows 通知、系统托盘与单实例运行
- Notion Token 使用 Electron `safeStorage` 调用系统加密能力保存，不进入普通数据文件

## Notion Calendar 的连接方式

Notion Calendar 没有独立的公开事件写入 API。Personal Tool 连接的是 **Notion Calendar 中展示的 Notion 数据库**：应用向数据库创建带日期的页面，这些页面会出现在 Notion Calendar 中。

如果你在 Notion Calendar 中看到的事件来自 Google Calendar，而不是 Notion 数据库，则需要后续增加 Google Calendar 提供方；当前版本不会读取那部分事件。

### 准备连接

1. 在 Notion 的集成设置中创建一个 Internal Integration，并复制它的 Token。
2. 打开目标日历数据库，通过“连接/Connections”把该数据库共享给刚创建的集成。
3. 确认数据库至少有一个“标题（Title）”属性和一个“日期（Date）”属性。
4. 在 Personal Tool 的“设置”页填入 Token 和数据库链接（或数据库 ID），保存后测试连接。
5. 在 Notion Calendar 中确保这个 Notion 数据库已经被添加为日历来源。

应用不会修改数据库结构，也不会覆盖未知字段。目标数据库中原有页面在应用里作为外部事件只读展示。

## 本地开发

需要 Node.js 22 或更新版本。

```powershell
npm install
npm run dev
```

质量检查：

```powershell
npm run typecheck
npm test
npm run build
```

## 构建 Windows 安装包

在 Windows 上运行：

```powershell
npm run dist:win
```

产物位于 `release/`：

- NSIS 安装程序
- 免安装便携版

首次分发的未签名安装包可能触发 Windows SmartScreen 提示。正式发布前建议配置 Authenticode 代码签名。

## 目录结构

```text
src/
  main/       Electron 主进程、持久化、计时命令、Notion 同步
  preload/    最小权限 IPC 桥
  renderer/   React 界面
  shared/     跨进程类型与纯计时逻辑
```

计时器不会依赖 `setInterval` 累加秒数。应用只在状态切换时保存时间戳，显示时间由时间戳推导，因此窗口隐藏、系统休眠或进程重启后仍能正确恢复。

## 下一步建议

- Google Calendar / Microsoft Calendar 提供方
- SQLite 与可审计的同步 outbox
- 日/月视图、事件编辑和冲突处理
- 专注统计、标签与项目
- 自动更新与签名发布流程
