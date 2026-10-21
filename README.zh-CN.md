# DSH Remote Everywhere

[![CI](https://github.com/BruceZhang1993/dsh-remote-everywhere/actions/workflows/ci.yml/badge.svg?branch=master)](https://github.com/BruceZhang1993/dsh-remote-everywhere/actions/workflows/ci.yml)
[![Fuzz](https://github.com/BruceZhang1993/dsh-remote-everywhere/actions/workflows/fuzz.yml/badge.svg?branch=master)](https://github.com/BruceZhang1993/dsh-remote-everywhere/actions/workflows/fuzz.yml)
[![MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![DSH Desktop 0.2.1-rc.2](https://img.shields.io/badge/DSH_Desktop-0.2.1--rc.2-blue)](docs/install.md)

[English](README.md) | 中文

一个 DeepSeek Harness（DSH）插件，让**任意 DSH 实例同时具备远端访问的两端**：既能主动连接
其他已启用该插件的 DSH 实例，也能接受它们的连接。同一套协议由 Android / iOS 原生 Flutter App
实现，因此手机可以配对任意开启该能力的被控端。被控端支持免费、一键开启的公网隧道。

> **状态：早期实现，M3 首版开发实现完成，M4 审查尚未完成。** Flutter 控制端位于
> [apps/mobile](apps/mobile/README.md)，见 [M3 证据与延期项](docs/m3-summary.md) 和 [M4 首批记录](docs/m4-summary.md)。独立安全审查、iOS 编译和移动端真实模型验收仍待完成，真机验收按用户要求暂缓。历史 `0.1.0` 首发位于 GitHub Packages；npmjs 与正式 APK 采用新发布流程。
> 实际进度以 [docs/roadmap.md](docs/roadmap.md) 为准。

## 安装

请使用 **DSH Desktop 0.2.1-rc.2**。版本发布后，在 **插件 → 添加插件** 选择 npm 官方源，填写 `@brucezhang1993/dsh-remote-everywhere@next` 安装预发布版；入口为侧栏 **远程设备**。Android 需单独从 [Releases 列表](https://github.com/BruceZhang1993/dsh-remote-everywhere/releases) 下载 APK，注意查看 Pre-release；iOS 暂无 IPA 分发。

[完整安装指引](docs/install.md) 包含固定版本、稳定版、APK 校验、首次配对与回滚。目标版本或附件尚未出现时请等待发布。历史 GitHub Packages `0.1.0` 使用旧宿主且不含管理 UI。CI badge 反映远端 `master` 的检查结果，不代表包已发布或真机验收通过。

## 解决什么问题

DSH 在本地和自带 Web GUI 中很好用，但缺少以下能力：

- 从机器 B 的 DSH 实例驱动机器 A 上运行的 DSH 会话；
- 用手机查看并审批 agent 的工作；
- 不搭 VPN、不租服务器就访问 NAT/CGNAT 之后的机器。

本项目用一个插件、一套协议补齐这些能力，且**不引入账号体系**、**不让明文经过第三方**。

## 文档

npmjs 自动发布、版本 PR、Android 正式签名 APK 与 GitHub Release 配置见 [CI 与版本发布](docs/ci-release.md)。

管理 UI 面向 **DSH Desktop 0.2.1-rc.2**，入口为侧栏「远程设备」或插件详情页。见 [UI 功能与本地验收说明](docs/plugin-ui.md) 和 [实施规划](docs/plugin-ui-plan.md)。已发布版本以安装指引为准；历史 `0.1.0` 不含此界面。

历史 GitHub Packages 流程与 `0.1.0` 记录见 [历史发布说明](docs/release.md)，当前发布前状态见 [链路检查记录](docs/release-preflight.md)。发布状态及验收范围与 CI badge 分别记录。安全披露策略见 [SECURITY.md](SECURITY.md)。

M1 诊断入口：`pnpm install --frozen-lockfile` 后运行 `pnpm remote` 查看用法。公钥绑定、
两进程加密通信、事件恢复和可选公网隧道见 [开发手册](docs/development.md#301-两进程诊断-cli)。
此诊断 CLI 使用诊断事件源；真实 DSH 会话使用[当前插件](docs/install.md)或 Flutter 控制端。

| 文档 | 内容 |
|---|---|
| [docs/roadmap.md](docs/roadmap.md) | 目标、里程碑、验收标准、风险登记、当前状态 |
| [docs/m1-summary.md](docs/m1-summary.md) | **M1 交付与验收** —— 正式包、CLI、验证证据和下一阶段边界 |
| [docs/m3-summary.md](docs/m3-summary.md) | **M3 首版实现与验证** —— 移动端产物、证据与延期验收 |
| [docs/m0-summary.md](docs/m0-summary.md) | **M0 验证结果** —— 证明了什么、推翻了什么、以及它逼出的架构修正 |
| [docs/architecture.md](docs/architecture.md) | 组件划分、与 DSH 的集成缝隙、会话能力映射、仓库结构 |
| [docs/protocol.md](docs/protocol.md) | 线上协议：配对、Noise 握手、分帧、方法、重连语义 |
| [docs/security.md](docs/security.md) | 威胁模型、信任边界、配对、设备授权、吊销、审批模型 |
| [docs/technology-decisions.md](docs/technology-decisions.md) | 每一项技术选型及其证据与被否决的替代方案 |
| [docs/development.md](docs/development.md) | 环境事实、构建命令、spike 复现方式、CI 说明 |
| [spikes/](spikes/) | M0 验证 spike 与实测报告 |

另见 [CHANGELOG.md](CHANGELOG.md)，其中记录了**已被推翻的假设** —— 项目早期环境调研的部分结论
是错的，这些修正对后续接手者很重要。

## 三种角色

```
   被控端 DSH 实例                        控制端 DSH 实例
   （本插件的 host half）  ◄───────────►  （controller half：MCP 工具 + skill）
              ▲                                       ▲
              │          一套协议、一个端口            │
              └──────────────┬────────────────────────┘
                             ▼
                    Flutter App（Android / iOS）
```

- **被控端** —— 一个普通 DSH 实例，启用本插件后暴露其**真实会话**：对话、流式输出、工具调用、
  审批、文件。它不是旁挂服务：插件是运行在宿主进程内的 in-process Cordis 插件。
- **控制端** —— 另一个 DSH 实例。它的 agent 获得原生 MCP 工具（`remote_*`）与一个 bundled
  skill，于是"连上我的台式机看看构建结果"就是一次普通工具调用。
- **移动端** —— 说同一套协议的 Flutter App。配对是二维码 + 人工比对的 6 位短认证串（SAS）。
  **移动端只做控制端**：手机可以驱动 DSH 实例，但手机**永远不会被控**。理由见
  [docs/security.md](docs/security.md) §5.4。

## 安全姿态

- 端到端加密采用 Noise Protocol Framework；隧道或中继只能看到密文。
- 每设备独立 X25519 密钥对；被控端维护显式设备表，可吊销任意设备。
- 审批双向可用且**绝不静默放行**；被控端原有的失败闭合（fail-closed）语义完整保留。
- 无账号体系、无遥测、除可选隧道外无云依赖。

## 许可证

MIT。见 [LICENSE](LICENSE)（M4 添加）。
