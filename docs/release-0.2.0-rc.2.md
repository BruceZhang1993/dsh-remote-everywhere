# 0.2.0-rc.2 发布记录

2026-10-16，用户确认修复签名工作流后发布 `0.2.0-rc.2`，保留失败的 `rc.1` 标签和既有延期验收项。

## 修复与范围

`release.yml` 调用 Android 可复用工作流时补充 `secrets: inherit`，使 `mobile-signing` environment 中既有签名 Secrets 能在任务中解析；不重新生成或复制签名凭据。此前 [rc.1](release-0.2.0-rc.1.md) 因签名 Secrets 为空而失败，未发布 npm 或公开 Release。

- 目标宿主 DSH Desktop `0.2.1-alpha.2`；包含桌面插件管理 UI 和自动化发布链路。
- 六个公共 npm 包 `@brucezhang1993/dsh-remote-{protocol,core,tunnel,cli,ui,everywhere}`，统一为 `0.2.0-rc.2`，使用 `next`，不晋级 `latest`。
- GitHub 预发布 `v0.2.0-rc.2`，分发原正式证书签名的 Android APK，versionCode 为 `4`；不发布 iOS IPA。

## 保留的延期项

独立 Noise 安全审查、完整供应链及许可证独立审查、Android ARM 真机、iOS/macOS、真实模型、完整 UI/网络切换与既有 profile 升级/回滚验收、私密漏洞报告收件验收和持续长期 fuzz 观察仍未完成。发布授权不代表这些检查通过。

本地 tarball、确定性模型 fixture、远端 CI、正式签名和注册表消费者验收各自只证明其覆盖范围。完整历史边界见 [M4 记录](m4-summary.md) 与 [发布前检查](release-preflight.md)。

## 执行状态

版本及修复已准备；正式标签、同标签 CI、签名 APK、npm 写入与匿名安装验收、GitHub Release 及附件校验待执行，不提前声明发布成功。

安装及回滚见 [中文指引](install.md) / [English](install.en.md)。
