# Personal Tool

一个面向 Windows 的本地优先桌面应用，把可恢复的番茄钟、每日规划、科研 IDEA、活动日历和 Notion 数据库同步放在同一个工作流中。

## 当前功能

- 倒计时与正向计时
- 暂停、继续、完成、重置，以及系统休眠/应用重启后的计时恢复
- 自定义常用时长和默认预设
- 番茄钟自动生成日历记录
- 按日期管理每日 TODO，支持优先级、备注、完成进度和历史回看
- 汇总科研 IDEA，支持阶段、标签、搜索和编辑
- 周日历与手动活动记录
- 从已有 Notion 数据库读取日历事件
- 把番茄钟和手动活动写回 Notion 数据库
- 离线优先：未同步记录会保留在本机，之后可重试
- 持久在线：临时断网、超时、限流或 Notion 服务异常不会清除授权；请求会退避重试，并在启动、系统恢复及后台健康检查时自动补同步
- 可靠删除：本地立即移除，Notion 归档失败会进入持久化队列并自动重试
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

应用不会修改数据库结构，也不会覆盖未知字段。你可以在应用中删除本地或 Notion 活动；已同步活动会在 Notion 中归档。断网时删除仍会立即生效，归档操作会在联网后自动重试。

Notion 集成使用长期保存的 Token，并不是需要一直在线的长连接。网络波动只会暂时推迟同步，不会把已验证的连接标为断开；只有 Token 失效、数据库权限被撤销、数据库不存在或结构不符合要求时，应用才会提示重新检查连接。

每日规划与科研 IDEA 目前只保存在本机，不会上传到 Notion。普通数据位于应用数据目录，Notion Token 单独使用系统安全存储加密保存。

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

## 后续扩展方向

- Google Calendar / Microsoft Calendar 提供方
- 日/月视图、事件编辑和冲突处理
- 专注统计、项目与跨功能关联
- 可选的 TODO / IDEA Notion 同步
- 自动更新与签名发布流程
