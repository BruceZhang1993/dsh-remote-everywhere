# M2 安装与操作

支持基线是完整同版 DSH **0.1.7-rc.2**，Node ≥22.19。M2 未发布 npm；以下使用本地 tarball 与隔离 profile，不替换现用 profile。Linux 管理 socket 已验证；Windows/macOS 管理入口未验收。

## 隔离安装

先在仓库打包（不需要构建宿主）：

```bash
tools/run-limited.sh bash -lc 'pnpm install --frozen-lockfile && pnpm test:package'
```

此命令打包五个包，在临时消费者目录以 `--ignore-scripts` 安装，并运行两个真实 DSH 进程；结束后删除临时消费者。tarball 留在 `.cache/packages/`。

手工试用可创建新的隔离 home；在仓库根目录执行：

```bash
TASK_DSH_HOME="$PWD/.cache/manual-m2"
TASK_PROFILE="$TASK_DSH_HOME/profiles/remote-m2"
mkdir -p "$TASK_PROFILE"
cat > "$TASK_PROFILE/package.json" <<'JSON'
{"name":"dsh-profile-remote-m2","private":true,"dsh":{"profile":{"bundles":["@deepseek-ai/dsh-base","@deepseek-ai/dsh-web-app","dsh-remote-everywhere"]}}}
JSON
tools/run-limited.sh bash -lc 'npm install --prefix .cache/manual-m2/profiles/remote-m2 --ignore-scripts --no-audit --no-fund .cache/packages/dsh-remote-protocol-0.1.0-alpha.1.tgz .cache/packages/dsh-remote-core-0.1.0-alpha.1.tgz .cache/packages/dsh-remote-tunnel-0.1.0-alpha.1.tgz .cache/packages/dsh-remote-everywhere-0.1.0-alpha.2.tgz @deepseek-ai/dsh@0.1.7-rc.2'
DSH_HOME="$TASK_DSH_HOME" "$TASK_PROFILE/node_modules/.bin/dsh" --profile remote-m2
```

首次启动后在这个隔离 profile 配置自己可用的模型。自动测试中的 `m2-fixture` 仅是测试夹具，不随插件包交付。WorkBuddy 实测模型 `deepseek-v4.1-flash` 在 provider 初始化完成、查询到支持 low 后选择 `reasoningEffort: low` 验证通过；测试使用已有 provider，不复制或输出凭据。

## 配对和设备管理

CLI 在 profile 的 `node_modules/.bin/dsh-remote`。下面的 `$TASK_STATE` 指该实例的 `<profile>/remote`。

```bash
TASK_STATE="$TASK_PROFILE/remote"
"$TASK_PROFILE/node_modules/.bin/dsh-remote" status --state "$TASK_STATE"
"$TASK_PROFILE/node_modules/.bin/dsh-remote" pair-begin --state "$TASK_STATE" > /tmp/m2-qr.json
```

二维码显示在 stderr，JSON 写到指定文件。控制端执行 `pair --state <控制端状态目录> --qr <二维码JSON文件>`，人工比较两端同一组 6 位 SAS；被控端用 `pair-pending` 查看，再 `pair-confirm --sas <同一数字>` 确认。双方都确认才存储授权，随后普通连接使用固定公钥。

二维码仅有效 180 秒且一次使用；连接失败后重新 `pair-begin`。默认权限为 `session,stream,approval`。要允许文件/终端，开始配对时显式加 `--caps session,stream,approval,files,terminal`；`admin` 单独选择。A 控制 B 不会自动允许 B 控制 A，双向控制需各配对一次。

`devices` 查看授权，`rename --device <id> --name <名字>` 改名，`revoke --device <id>` 立即断开入站及出站连接。被吊销的设备不能自动恢复，需要重新人工配对。

## 控制会话与审批

插件注册原生工具 `remote_devices`、`remote_call`、`remote_run`、`remote_operation`，附带 `remote-control` skill。目标 deviceId 必须明确。`remote_run` 的 requestId 在重试时保持相同；返回 `truncated:true` 只表示结果窗口结束，目标可能仍在运行。

- 原生 `remote_run` / `remote_operation`：控制端与被控端原生 GUI 同时呈现审批，先到先得，另一端撤回。
- 标准 MCP / CLI operation：审批由被控端原生 GUI 处理。人工 CLI `follow --device <id> --session <id>` 也可响应该订阅的审批和提问。
- 没有 GUI 或人工响应时，审批超时失败关闭；模型不能调用审批决定来自己放行。
- `remote_operation` 的方法只能是 `files.write` 或 `terminal.exec`。先绑定完整参数，得到 60 秒、仅一次使用的许可后执行；参数替换和重放均拒绝。

标准 MCP（本机 stdio）配置示例：

```json
{"mcpServers":{"dsh_remote":{"command":"/绝对路径/profile/node_modules/.bin/dsh-remote","args":["mcp","--state","/绝对路径/profile/remote"]}}}
```

MCP 提供同名四工具。`remote_call` 支持工作区、会话、子代理目录/取消、队列、投影、文件读取和变更摘要。完整历史、附件上传、子代理提示、代码 diff 与终端/文件流可使用插件导出的 `RemoteClient`；线上参数以协议 schema 为准。

宿主默认关闭会话内容全文搜索，`session.search` 会沿用宿主返回 `gateway/internal`；会话列表仍可用。需要全文搜索时，在目标 profile 的 `cordis.patch.yml` 显式启用并重启该实例：

```yaml
- id: session-query-sqlite
  config:
    path: ":memory:"
    openAt: first-search
```

插件不会自动启用搜索索引，也不会把所有宿主内部错误误判为搜索关闭。

## 公网隧道

先把官方 cloudflared 安装到 PATH，或在 `cordis.patch.yml` 的 `remote-everywhere` 配置 `cloudflared` 为绝对路径。然后执行 `tunnel-start --state <状态目录>`，就绪后再开始配对；`tunnel-stop` 结束隧道。

隧道重启后旧 URL 失效；需重新分享端点或重新配对。更新端点不能更换固定公钥。插件没有把长期密钥交给隧道方，也不把本地管理 socket 挂到公网。

## 当前边界与回滚

文件围栏使用宿主 fs 的真实路径身份，拒绝工作区外路径和指向外部的 symlink。文件读取为 32 KiB 窗口或最大 4 MiB 流；直接写入为最大 32 KiB UTF-8。附件上传可为二进制，最大 4 MiB，每连接最多四项，不等于任意二进制工作区写入。终端每次审批、30 秒时限，输出超限有明确截断/错误；cwd 必须在工作区内，命令本身继承宿主用户权限。

图片提示及 `session.attachment` 回读受单个 RPC 的 64 KiB 帧上限约束；提示中的 base64 图片字段最多 60000 字符，还需为其余参数留出空间。4 MiB 上传限额仅适用于分块附件接口。

代码 diff 使用宿主 `workspaceChanges` 的逐 turn 快照；宿主已释放或重启导致快照消失时返回 `history/unavailable`，不会伪造历史比较。直接远端文件/终端操作的审计在 `remote/audit.jsonl`（1 MiB 滚动），模型工具审批仍由宿主写入会话。

远端驱动会话及其子代理/fork 后代不能再次调用本插件远程控制工具；祖先检查有循环和深度限制，避免两个实例互相派发成逻辑环。

回滚隔离试用：正常停止 DSH；保留或归档隔离 home 即可。若已安装到现用 profile，先停止该实例，从 profile 的 bundles 移除 `dsh-remote-everywhere`，再通过 `dsh plugin --profile <名称> remove dsh-remote-everywhere` 移除包，恢复安装前的 patch/package.json 备份。保留 `remote/` 可保留密钥和设备记录；它不会自行连接。正式 profile 的安装与回滚未在本次操作中执行。
