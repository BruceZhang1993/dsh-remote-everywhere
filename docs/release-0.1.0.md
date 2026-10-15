# 0.1.0 首次 npm 发布记录

2026-10-15 首发完成：五个 npm 包均已上传 GitHub Packages，发布命令使用 `next`。全部逐包核验 SHA-512，并从注册表完成全新目录/缓存的安装验收。

- 标签：[v0.1.0](https://github.com/BruceZhang1993/dsh-remote-everywhere/tree/v0.1.0)。来源 `5556e674941b01451e90c428b20b44e1c24e4eae`；标签保持固定。
- [发布 workflow](https://github.com/BruceZhang1993/dsh-remote-everywhere/actions/runs/38692126864) 整体 success；协议/安全、Android AOT、Flutter Android、发布和消费者安装均通过，iOS skipped 不计通过。
- 实际上传时间：06:39:45–06:39:49 UTC（北京时间 14:39:45–14:39:49）。注册表验收于 06:40:49 UTC 完成。
- 机器可读的来源、五包哈希及验收记录见 [release-0.1.0.json](release-0.1.0.json)。

| 包名 | 版本 | 用途 |
|---|---|---|
| `@brucezhang1993/dsh-remote-protocol` | 0.1.0 | DR 协议定义与校验 |
| `@brucezhang1993/dsh-remote-core` | 0.1.0 | Noise、连接与逻辑流 |
| `@brucezhang1993/dsh-remote-tunnel` | 0.1.0 | 隧道管理 |
| `@brucezhang1993/dsh-remote-cli` | 0.1.0 | 独立诊断 CLI |
| `@brucezhang1993/dsh-remote-everywhere` | 0.1.0 | DSH 插件 |

## 安装与证据边界

五包已在 GitHub 未登录状态的 [Public 包列表](https://github.com/BruceZhang1993?tab=packages&visibility=public) 中核验可见；未手动修改可见性。注册表安装仍需要 GitHub Packages 认证，先按 [安装说明](release.md#注册表安装发布后) 配置 scope 和 `read:packages` 凭据，再在独立 DSH profile 安装：

```bash
npm install --ignore-scripts @brucezhang1993/dsh-remote-everywhere@0.1.0
```

本次验证环境为 Node v22.23.3、固定 DSH 0.1.7-rc.2、Ubuntu 24.04 容器，安装脚本禁用。安装锁文件中的五包版本、GitHub registry 下载来源和 SHA-512 均匹配同次 CI 的候选；随后 CLI 加密诊断和模拟模型的真实双宿主回归通过，包括配对、会话、审批/提问、附件、子代理/队列、文件/终端、重启历史与吊销。
临时 profile 在退出时清理；其他账号权限、真实模型、已有版本升级/回滚未验收。安装 token 在诊断/DSH 子进程启动前移除。

本机凭据仍缺 `read:packages`，独立读取 registry dist-tags 返回 E403；`next` 依据成功的发布命令日志记录。本次没有执行 `promote-latest`，晋级批准变量仍未设置；GitHub 网页的 Latest 版本标记不作为 npm dist-tags 的核验结果。

## 保留项

独立 Noise/完整供应链审查、长期 fuzz、私密报告收件/通知、M3 真机/真实模型/完整 UI 与 iOS/macOS 验收继续保留。本次不分发正式签名 App，也不将这些检查标记为完成。后续 `latest` 晋级仍需要单独授权。

原始证据在 `.cache/m4/first-release-0.1.0/`；workflow 的 `github-packages-0.1.0-consumer` artifact 保留验收 JSON 与 manifest。验收记录 SHA-256：`08acf8fd3b09cf6d257b801af4ab04374886de0ad76ae306371ec58545a9bcce`。
