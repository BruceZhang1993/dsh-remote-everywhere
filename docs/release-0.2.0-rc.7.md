# 0.2.0-rc.7 发布说明

宿主基线为 DSH Desktop `0.2.1-rc.2`，六个公共 npm 包统一为 `0.2.0-rc.7`，Android versionCode 为 `9`。沿用已有正式证书及 applicationId，支持从正式签名旧版覆盖升级。

## APK 签名

- 本地 release 构建优先读取仓库内 `.signing/android/key.properties`；签名目录及 keystore 已被 Git 忽略，无需手动加载环境变量。
- CI 从 GitHub Actions Secrets 还原临时 keystore，退出时删除；普通 CI 和 tag 发布都生成正式签名 release APK。
- 移除 debug 签名回退。缺少签名配置时 release 任务失败；证书、包名/版本、v2 签名和 16 KiB 对齐校验不通过时拒绝产物。
- Fork 和 Dependabot PR 保留静态检查及测试，跳过需要 Secrets 的 APK 构建。

## 验证与发布

签名改动已通过本地正式 APK 构建和 CI 环境模拟，产物证书及哈希一致；错误环境变量不会覆盖本地文件，CI 缺少凭据时会失败。Flutter 静态检查、26 项 Flutter 测试和 50 项发布相关测试通过。

最终标签流水线重新检查、构建签名 APK，发布六个 npm 包到 `next`，验证匿名安装和真实 DSH 宿主管理 UI，再公开包含六个附件的 GitHub Release。预发布保留既有 `latest`；GitHub Packages 仍为独立可选渠道。以实际流水线结果、npm 确切版本与 Release 附件为发布完成依据。

发布入口：[v0.2.0-rc.7](https://github.com/BruceZhang1993/dsh-remote-everywhere/releases/tag/v0.2.0-rc.7)。

本版没有进行 Android 真机验收，独立安全、供应链及许可证审查、iOS/macOS、真实模型和完整网络切换等延期验收项继续保留。
