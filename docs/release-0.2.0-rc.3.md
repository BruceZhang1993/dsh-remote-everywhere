# 0.2.0-rc.3 发布记录

2026-10-16，沿用保留失败标签的策略，修复真实 npm 首发发现的问题后已发布 `0.2.0-rc.3`。历史 rc.1、rc.2 标签和失败记录保留，不覆盖既有版本。

## 修复与发布范围

- 兼容 npm 12 的 `view --json` 单元素数组和 `pack --json` 按包名索引对象；多结果查询仍拒绝作为单一版本验收。
- 固定依赖顺序上传全部候选，再逐包有界等待注册表可见，等待上限每包 6 分钟；只重试处理中的 404，认证、网络、哈希与 DSH 元数据错误继续立即失败。
- 公共 npm 预发布完成逐包验收后，清理首次发布或旧失败 RC 遗留的预发布 `latest`；保留既有稳定 `latest`，不移除更新版本的标签。
- 目标 DSH Desktop `0.2.1-alpha.2`；六个公共 npm 包 `@brucezhang1993/dsh-remote-{protocol,core,tunnel,cli,ui,everywhere}` 使用统一版本 `0.2.0-rc.3` 与 `next`。
- GitHub 预发布分发原正式证书签名的 Android APK，versionCode 为 `5`；不发布 iOS IPA。

## 保留的延期项

独立 Noise 安全审查、完整供应链及许可证独立审查、Android ARM 真机、iOS/macOS、真实模型、完整 UI/网络切换与既有 profile 升级/回滚验收、私密漏洞报告收件验收和持续长期 fuzz 观察仍未完成。发布不代表这些检查通过。

本地 tarball、确定性模型 fixture、远端 CI、正式签名和注册表消费者验收各自只证明其覆盖范围。历史边界见 [M4 记录](m4-summary.md) 与 [发布前检查](release-preflight.md)。

## 执行状态

- [GitHub Release](https://github.com/BruceZhang1993/dsh-remote-everywhere/releases/tag/v0.2.0-rc.3) 已公开，标记为预发布；六个附件全部上传且服务端 SHA-256 与原 CI 产物一致。
- 来源固定为 `v0.2.0-rc.3` / `cf2e4d817b21012e306f1e7a89e086bd2ec54bfa`，未重建、覆盖包版本或移动历史标签。
- [原发布运行](https://github.com/BruceZhang1993/dsh-remote-everywhere/actions/runs/38857029144) 的协议/安全、移动 Android CI 与正式签名通过；npm 六包上传及逐包校验通过，随后清理 `latest` 返回 403，npm job 保持失败，GitHub Release job 跳过。交互登录后的删除尝试也返回 400，未改变标签。
- 用户随后明确决定“就用 latest 标签吧，不用改了”，因此停止删除且未重跑会强制清理的原任务。保留实际标签：六包 `next=0.2.0-rc.3`；主插件、UI、CLI、core、tunnel 的 `latest=0.2.0-rc.3`，protocol 的 `latest=0.2.0-rc.2`。需要统一版本时显式指定 `0.2.0-rc.3`。本次保留 RC 的 latest 不表示稳定版验收完成。
- 在本机 8 GiB 内存 / 4 GiB swap scope 中，以全新目录/缓存、匿名身份且禁用安装脚本，从公共 npm 安装六包；来源与 SHA-512 全部匹配。CLI 加密连接、两个真实 DSH 宿主与管理 UI 回归通过，浏览器控制台错误为 0；模型使用确定性 fixture。这是本机消费者证据，`runId=null`，不冒充远端发布 job 通过。
- 复用同次 CI 的正式签名 APK 与声明材料，人工逐个上传、比对全部服务端 digest 后公开 Release。最终再次匿名读回六包元数据及标签，核对六附件大小/digest、APK 来源、签名和版本，全部通过。临时 npm CLI 会话已 logout，临时凭据配置已删除。
- Android：`dev.dshremote.dsh_remote_mobile`，versionName `0.2.0-rc.3`，versionCode `5`，APK v2 签名通过；APK SHA-256：`dc5f0fefcb3a608e292c2c83257f8cea7c09a17f49c30b6156491042c9105b74`；证书 SHA-256：`eb1947fa347d7363d27fc04809d69da753212f422900368ac9c05a5cd7f76a95`。

机器可读结果见 [发布验收证据](release-0.2.0-rc.3.json)。完整自动发布流水线仍为 failure；公开分发和人工补充验收已完成，两者分别记录。

安装及回滚见 [中文指引](install.md) / [English](install.en.md)。

## GitHub Packages 补发

此前自动版本发布仅覆盖公共 npm 与 GitHub Release，GitHub Packages 保留独立手动流程，因此仍停留在 `0.1.0`。用户指出差异后，使用原 `v0.2.0-rc.3` / `cf2e4d8` 启动[补发运行](https://github.com/BruceZhang1993/dsh-remote-everywhere/actions/runs/38861638500)。同标签完整 CI 通过，重新生成的 GitHub Packages 六包清单和哈希与原 rc.3 CI 完全一致；更新环境批准 SHA、仅增加该确切 tag 的允许规则，并按本次授权通过既有环境审批，保留 reviewer 保护。

六个包于 2026-10-16 06:39:28–06:39:31 UTC 上传成功，均使用 `next`；没有覆盖旧版本或执行 latest 晋级。protocol、core、tunnel、CLI 的注册表完整性核验通过，随后 UI 的 `dsh` 元数据校验失败，未进入该渠道的消费者安装。

[独立检查](https://github.com/BruceZhang1993/dsh-remote-everywhere/actions/runs/38862544843) 确认 UI 已是 `0.2.0-rc.3` / `next`，下载包的 SHA-512 与候选及注册表一致，包内含完整 `dsh.client`，但注册表响应缺少 `dsh`。因此“GitHub Packages 六包版本已补发”成立，“该渠道 DSH 安装验收通过”仍不成立；未删除检查或改桌面端绕过。桌面插件继续使用已通过验收的公共 npm 渠道。

机器可读的上传及失败证据见 [GitHub Packages 记录](release-0.2.0-rc.3-github-packages.json)。该补发不改变前文公共 npm、APK 和 GitHub Release 的成功证据。
