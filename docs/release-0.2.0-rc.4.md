# 0.2.0-rc.4 发布记录

目标宿主为 DSH Desktop `0.2.1-rc.2`；六个公共 npm 包 `@brucezhang1993/dsh-remote-{protocol,core,tunnel,cli,ui,everywhere}` 统一使用 `0.2.0-rc.4`。Android 沿用正式证书与包名，versionCode 为 `6`。

## 本版范围

- 主插件六个 DSH peer 依赖更新为 `0.2.1-rc.2`，Cordis 对齐宿主 `~4.0.5`；打包安装使用真实宿主兼容检查器，旧 alpha 声明仍被拒绝。
- 增加公网二维码地址切换、旧码失效和关闭隧道回退的回归，以及可选真实公网管理 UI 配对/重连验收。本机 Desktop、Web UI 与手机共用 Dart 协议的公网实测通过；未修改生产二维码逻辑，用户手机无法连接的原因尚未复现。
- npm 预发布只更新 `next`，保留原有 `latest`；六包统一安装应指定确切版本，不能依赖旧 `latest` 获得本版。

## 验证与发布状态

本地 Node 74 项、发布门禁测试、静态检查、全新 npm 候选安装、DSH `0.2.1-rc.2` 真实双宿主、Desktop/Web 管理 UI 验收通过。公网实测包含新码 WSS 地址、双侧安全码确认和重连后的会话查询，浏览器控制台错误为 0。模型使用确定性 fixture，Dart 测试不代表 Android 真机扫描验收。

正式发布等待干净提交的同次 CI 产物、签名 Android、公共 npm 匿名安装及 GitHub Release 附件校验。完成后在此回填来源 SHA、运行和下载证据；本地候选不能代替注册表发布。GitHub Packages 仍为独立渠道，历史元数据验收问题见 [rc.3 记录](release-0.2.0-rc.3.md#github-packages-补发)。

## 保留的延期项

独立 Noise 安全审查、完整供应链及许可证独立审查、Android ARM 真机、iOS/macOS、真实模型、完整 UI/网络切换与既有 profile 升级/回滚验收、私密漏洞报告收件验收和持续长期 fuzz 观察仍未完成。本次 RC 发布不代表这些检查通过。

安装与回滚见 [中文指引](install.md) / [English](install.en.md)。升级时保留 profile 的 `remote/` 身份与授权数据。
