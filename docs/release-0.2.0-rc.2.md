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

本次发布未完成，标签 `v0.2.0-rc.2` 保留在 `567f189f1e79ce9123f80bcdbaa7a1a61fe71a39`。[完整 CI 与正式签名任务](https://github.com/BruceZhang1993/dsh-remote-everywhere/actions/runs/38854250674) 通过，原正式证书的 Android APK versionCode 为 4，本地下载后重新核验五个附件校验和、v2 签名、证书、包名和 16 KiB 对齐均通过。

npm 只接受了 `@brucezhang1993/dsh-remote-protocol@0.2.0-rc.2`，其 SHA-512 与同次候选一致。发布后处理延迟导致立即读回 404；恢复时又发现 npm 12 单元素数组被旧代码当作字符串比较，误报完整性不一致。其余五包未发布，匿名安装验收与公开 GitHub Release 未执行。注册表还为首个包生成了指向 RC 的 `latest`，后续需清理，不能声明仅有 `next`。

沿用保留失败标签的处理方式，发布工具修复后改发 [0.2.0-rc.3](release-0.2.0-rc.3.md)；不修改或覆盖 rc.2 已发布包。

安装及回滚见 [中文指引](install.md) / [English](install.en.md)。
