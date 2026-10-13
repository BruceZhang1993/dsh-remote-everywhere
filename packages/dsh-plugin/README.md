# DSH Remote Everywhere

让 DSH 实例互相查看和继续真实会话，使用 Noise 加密连接、二维码与人工 SAS 配对，并保留原生 GUI 审批。

支持宿主 **DSH 0.1.7-rc.2**。请保证宿主依赖同版；混装 rc.1/rc.2 会使原有工具预设失效。当前管理 CLI 在 Linux 验证，移动端仍属于 M3。

安装和回滚、配对、MCP 配置及能力限制见仓库的 `docs/m2-install.md`。默认仅监听 loopback，公网隧道需显式开启；配对默认授予会话、流与审批权限，文件、终端和设备管理需显式选择。

控制端提供 `remote_devices`、`remote_call`、`remote_run`、`remote_operation` 及 `remote-control` skill。审批必须由人处理：原生 DSH 工具可同时在控制端和被控端呈现，标准 MCP 运行由被控端 GUI 处理，CLI follow 还可人工响应。
