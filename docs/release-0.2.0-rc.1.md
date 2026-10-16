# 0.2.0-rc.1 发布记录

2026-10-16，用户授权发布 `0.2.0-rc.1`，保留并披露既有延期项。

## 发布范围

- 桌面插件管理 UI 和自动化发布链路；目标宿主为 DSH Desktop `0.2.1-alpha.2`。
- 六个公共 npm 包：`@brucezhang1993/dsh-remote-{protocol,core,tunnel,cli,ui,everywhere}`，统一版本 `0.2.0-rc.1`，使用 `next`。
- GitHub 预发布 `v0.2.0-rc.1`，分发正式证书签名的 Android APK，versionCode 为 `3`，沿用既有 applicationId 和发布证书。
- 本次为 RC，不执行 `latest` 晋级，不发布 iOS IPA。

## 保留的延期项

独立 Noise 安全审查、完整供应链及许可证独立审查、Android ARM 真机、iOS/macOS、真实模型、完整 UI/网络切换与既有 profile 升级/回滚验收、私密漏洞报告收件验收和持续长期 fuzz 观察仍未完成。发布授权不代表这些检查通过。

本地 tarball、确定性模型 fixture、远端 CI、正式签名和注册表消费者验收各自只证明其覆盖范围。完整历史边界见 [M4 记录](m4-summary.md) 与 [发布前检查](release-preflight.md)。

## 执行状态

本次发布失败，未公开分发：标签 `v0.2.0-rc.1` 固定在 `cbe82bbe374003bfa45472397b7948ea39a20492`；同标签完整 CI 通过，但正式签名任务因调用可复用工作流时未传递 Secrets 而失败。四个签名 Secrets 在运行时为空；npm 与 GitHub Release 发布 job 均跳过，草稿无附件。

- [版本 PR #2](https://github.com/BruceZhang1993/dsh-remote-everywhere/pull/2) 与 [失败发布运行](https://github.com/BruceZhang1993/dsh-remote-everywhere/actions/runs/38852184916) 保留。
- 用户选择修复后发布 `0.2.0-rc.2`，保留失败的 `rc.1` 标签；不移动或重建旧标签。后续见 [rc.2 记录](release-0.2.0-rc.2.md)。

安装及回滚见 [中文指引](install.md) / [English](install.en.md)。
