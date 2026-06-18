# Project Graph Web 内网版

这是当前仓库里的 Web 适配 MVP。它不是实时协同白板，而是一个内网 Web 服务：浏览器访问同一个地址，项目文件统一保存在运行服务的这台电脑上。

## 日常使用

启动：

```powershell
.\start-web.cmd
```

启动后窗口会打印两个地址：

- `Local`：本机访问地址。
- `LAN`：同一局域网其他设备访问地址。
- `Data`：服务端数据目录，也就是服务器项目实际保存的位置。
- `User` / `Pass`：浏览器访问时需要输入的账号密码。

停止：

```powershell
.\stop-web.cmd
```

重启：

```powershell
.\restart-web.cmd -SkipBuild
```

查看状态：

```powershell
.\status-web.cmd
```

状态命令也会显示当前账号密码。密码保存在：

```text
<DataDir>\auth.json
```

放行 Windows 防火墙端口，需要管理员 PowerShell：

```powershell
.\open-firewall.cmd
```

默认端口是 `37820`。如果端口被占用，启动脚本会从 `37820` 往后找可用端口。

如果确实只想裸跑内网服务，可以显式关闭访问密码：

```powershell
.\start-web.cmd -NoAuth
```

## 自定义数据位置

默认数据目录是：

```text
server\data
```

也可以启动时指定服务端数据目录：

```powershell
.\start-web.cmd -DataDir D:\ProjectGraphData
```

`-DataDir` 可以是绝对路径，也可以是相对当前仓库根目录的路径：

```powershell
.\start-web.cmd -DataDir ..\project-graph-data
```

启动脚本会把最近一次使用的数据目录记录到：

```text
server\web-runtime.json
```

后续运行 `status-web.cmd`、`smoke-web.cmd`、`backup-data.cmd` 时，如果不显式传 `-DataDir`，会优先沿用这个记录。要切回默认目录，可以显式启动：

```powershell
.\start-web.cmd -DataDir .\server\data
```

## 开机登录自启

注册当前用户登录时自动启动：

```powershell
.\install-startup.cmd
```

如果使用自定义数据目录，自启任务也要带上同一个目录：

```powershell
.\install-startup.cmd -DataDir D:\ProjectGraphData
```

删除自启任务：

```powershell
.\uninstall-startup.cmd
```

这个任务使用 Windows 计划任务，默认在当前用户登录时执行：

```text
Project Graph Web
```

它会运行 `scripts\start-web.ps1 -SkipBuild -Port 37820`，不会重新构建前端。

## 数据位置

默认主数据目录：

```text
server\data
```

项目文件默认在：

```text
server\data\projects
```

项目元数据默认在：

```text
server\data\projects.json
```

历史备份默认在：

```text
server\data\backups
```

如果启动时指定了 `-DataDir`，上面这些路径里的 `server\data` 都替换成实际的 `<DataDir>`。

日志：

```text
<DataDir>\logs
```

`server\data` 和 `server\web-runtime.json` 已加入 `.gitignore`，不会被提交。自定义到仓库外的目录也不会被 Git 管理。

## 数据备份和恢复

创建数据备份包：

```powershell
.\backup-data.cmd
```

备份指定数据目录：

```powershell
.\backup-data.cmd -DataDir D:\ProjectGraphData
```

默认备份目录：

```text
web-backups
```

备份脚本默认保留最近 10 份 `project-graph-web-data-*.zip`，旧备份会自动删除。

恢复备份包：

```powershell
.\restore-data.cmd .\web-backups\project-graph-web-data-YYYYMMDD-HHMMSS.zip
```

恢复到指定数据目录：

```powershell
.\restore-data.cmd .\web-backups\project-graph-web-data-YYYYMMDD-HHMMSS.zip -DataDir D:\ProjectGraphData
```

只校验备份包、不恢复：

```powershell
.\restore-data.cmd .\web-backups\project-graph-web-data-YYYYMMDD-HHMMSS.zip -ValidateOnly
```

恢复脚本会：

- 先校验备份包结构。
- 先给当前 `<DataDir>` 再创建一份预恢复备份。
- 停止当前 Web 服务。
- 替换 `<DataDir>`。
- 重置 `locks.json`，避免恢复后残留旧编辑锁。

恢复后如果要立即启动：

```powershell
.\restore-data.cmd .\web-backups\project-graph-web-data-YYYYMMDD-HHMMSS.zip -Restart
```

## 多设备编辑规则

- 打开服务器项目时会申请编辑锁。
- 项目被其他设备编辑时，列表会显示锁定状态。
- 保存时会检查锁和 ETag，避免静默覆盖别人已经保存的版本。
- 关闭标签页或刷新页面时会尝试释放锁。
- 锁默认会自动续期；异常断开后会在过期后自动释放。

当前版本只做文件级保护，不做多人实时协同。

## 项目管理

Web 欢迎页的服务器项目列表支持：

- 打开项目。
- 重命名项目。
- 删除项目，删除时会同时删除该项目的历史备份。
- 查看历史备份。
- 恢复到某个历史备份，恢复前当前版本会再次写入备份。

如果项目被其他设备锁定，重命名、删除和恢复会被阻止。

## 常见问题

其他设备打不开：

1. 先在本机运行 `.\status-web.cmd`，确认服务在跑。
2. 确认其他设备和本机在同一个局域网。
3. 用管理员 PowerShell 运行 `.\open-firewall.cmd`。
4. 如果当前 Windows 网络是 Public，把网络改成 Private，或用管理员 PowerShell 执行：

```powershell
.\scripts\open-firewall.ps1 -Profile Any
```

页面能打开但项目列表失败：

- 确认访问的是启动脚本打印的单端口地址，例如 `http://10.x.x.x:37820`。
- 不要访问旧的 Vite 开发地址 `:5173`。

需要备份或迁移：

- 优先使用 `.\backup-data.cmd` 生成 zip 备份包。

## 冒烟测试

本机快速测试服务是否可用：

```powershell
.\smoke-web.cmd
```

测试内容包括：

- health 是否正常。
- 启用密码时，未认证访问是否返回 401。
- 正确密码是否能访问首页和 API。
- 临时项目创建、重命名、删除是否正常。
