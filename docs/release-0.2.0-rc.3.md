# 0.2.0-rc.3 发布记录

2026-10-16，沿用保留失败标签的策略，修复真实 npm 首发发现的问题后准备发布 `0.2.0-rc.3`。历史 rc.1、rc.2 标签和失败记录保留，不覆盖既有版本。

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

发布准备中；正式标签、同标签 CI、签名 APK、六包 npm 发布、匿名安装/UI 验收和 GitHub Release 及附件校验待执行。完成后回填实际证据。

安装及回滚见 [中文指引](install.md) / [English](install.en.md)。
