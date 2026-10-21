# DSH Remote Everywhere

让 DSH 实例互相查看和继续真实会话，使用 Noise 加密连接、二维码与人工 SAS 配对，并保留原生 GUI 审批。

本版本面向宿主 **DSH Desktop 0.2.1-rc.2**。宿主依赖须保持同版；已发布的 0.1.0 使用旧宿主 0.1.7-rc.2，不包含管理 UI。

启用后，从侧栏「远程设备」或「插件 → DSH Remote Everywhere」进入，完成双向人工配对、设备管理和公网隧道控制。主插件自动加载 UI 伴生包，原 Node SDK 的 `./client` 导出保持不变。版本发布后，在宿主「添加插件」选择 npm 官方源，安装 `@brucezhang1993/dsh-remote-everywhere@next`（预发布）或确切版本。使用与安装说明见附带的 `INSTALL.zh-CN.md` / `INSTALL.md` 或[仓库安装指引](https://github.com/BruceZhang1993/dsh-remote-everywhere/blob/master/docs/install.md)。

安装、回滚及配对见上述安装指引；MCP 配置与能力说明见仓库的 `docs/m2-install.md`，该文的安装段保留旧 M2 宿主基线，不用于当前版本。默认仅监听 loopback，公网隧道需显式开启；配对默认授予会话、流与审批权限，文件、终端和设备管理需显式选择。

控制端提供 `remote_devices`、`remote_call`、`remote_run`、`remote_operation` 及 `remote-control` skill。审批必须由人处理：原生 DSH 工具可同时在控制端和被控端呈现，标准 MCP 运行由被控端 GUI 处理，CLI follow 还可人工响应。

发布包附带 `INSTALL.md` / `INSTALL.zh-CN.md`、MIT `LICENSE` 和 `SECURITY.md`；源码或本地候选不表示 npm 已发布，私密披露渠道及独立安全审查仍是发布门禁。
运行时审计文件最多保留两个 1 MiB 文件；只记录元数据。审计不可用时新的远程操作失败关闭，本机吊销和资源清理仍可执行。
