# M2 执行记录

基线：M1 本地提交 `c3f64df`；分支 `feature/20261012-m2Plugin`；宿主支持基线 `0.1.7-rc.2`。

## 实施顺序和门禁

1. 核查已安装宿主公开服务及完整调用链；固定版本，不导入宿主内部实现。
2. 插件加载、隔离监听、profile 设备存储、首次配对和吊销。
3. 真实会话提示、流式输出、取消和一次本机/远端审批闭环。
4. 完整会话映射、历史恢复、子代理、附件、队列及提问。
5. 工作区内文件读写及逐次审批终端；控制端工具和随包 skill。
6. 单测、真实宿主双实例、独立安装、断线/重启、公网隧道验收。

## 已核查的宿主边界

- 本机已安装 DSH 和 session-controller/user-approval 为 `0.1.7-rc.2`，不同于 M0 的版本。
- `follow` 的实际类型仍无 `sinceSeq`，需冻结 opening cursor 后通过 `page` 补齐。
- `fork` 使用精确 `atSeq`，不能直接透传设计文档中的 `throughTurn`。
- `workspaceFiles` 是只读服务，且文件读取允许工作区外路径，远端需额外围栏。
- `terminalController.create` 不经过 Agent 审批，不适合直接暴露为远端执行接口。
- `approval.request` 要求 Agent 有打开的 turn；不能用空闲 Agent 伪造审计审批。

## 调用链和资源所有权

- 控制端工具 → 单个连接 RPC → 设备权限校验 → 宿主 sessionController → 返回；不把本机远端工具转发成对端工具调用。
- `follow/page/control` 只读并下行；事件处理不触发 prompt、写入或再次远程调用。
- 宿主 approval/request → 插件代理（只处理已订阅会话）→ 远端决定/本机 next → 一次结算 → 宿主审计；远端决定不重新调用 approval.request。
- 配对连接仅有 pair.confirm；双方人工确认后持久化信任并重新建立普通连接。
- server 拥有入站连接，控制端拥有出站连接；每条流拥有独立取消信号，插件卸载统一停止流、连接和隧道。
- 所有队列、分页、输出及并发设上限；测试串行且全进程树 8 GiB 内存 / 4 GiB swap。

## 验收状态

Linux / DSH 0.1.7-rc.2 本地验收完成：真实模型双向互控、原生 GUI 竞速及提问、子代理/队列/附件/diff、独立 tarball 和公网 WSS 均已验证。M2 已纳入本地提交 `7967cae`；2026-10-13 完成度复核再次通过，证据及边界见 [m2-summary.md](m2-summary.md)。当前仓库未配置 Git remote，本轮未推送或发布。
