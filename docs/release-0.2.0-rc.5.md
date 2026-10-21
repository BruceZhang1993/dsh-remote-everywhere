# 0.2.0-rc.5 发布说明

宿主基线为 DSH Desktop `0.2.1-rc.2`，六个公共 npm 包统一为 `0.2.0-rc.5`，Android versionCode 为 `7`，沿用正式签名与包名。

## 修复范围

- 修复配对成功后加载会话列表报 `invalid-argument: payload requires chunking`：宿主列表和搜索支持可选 `streamId`，使用现有 32 KiB 分片，手机完整接收后更新列表，保留单值 4 MiB 限制。
- 手机优先使用分片列表；旧宿主拒绝分片参数或仅授予会话权限时使用普通 RPC。大列表修复需要电脑插件与手机 App 都升级到本版；旧手机仍使用普通单帧响应。
- 列表读取沿用流的取消、超时和权限检查；主动断开后不会写回旧结果，不重试会话写入。
- 修复 GitHub 发布脚本创建草稿后按标签查询返回 404 时的空值错误：通过已认证发布列表有界查找原草稿，继续校验附件后公开，不覆盖旧版本或不同内容的附件。

## 验证与发布

本地 JavaScript 80 项、Flutter 19 项、Flutter/Node 跨语言回归 4 项和发布流程回归 47 项通过，静态检查通过。跨语言回归覆盖约 260 KiB 中文列表与搜索、空结果、下游失败隔离、旧宿主回退、仅会话权限和加载中断开；Node 回归覆盖 4 MiB 上限、授权与流回收。

发布流水线针对最终标签重新验证，生成正式签名 APK，发布六个 npm 包到 `next`，验证匿名安装和管理 UI，再校验六个附件后公开 GitHub Release。预发布保留既有 `latest`；GitHub Packages 仍为独立可选渠道。

发布入口：[v0.2.0-rc.5](https://github.com/BruceZhang1993/dsh-remote-everywhere/releases/tag/v0.2.0-rc.5)。该链接及源码说明不代替流水线完成证明；以实际 Release 附件和 npm 确切版本为准。

## 升级与验收边界

先更新电脑插件 `@brucezhang1993/dsh-remote-everywhere@0.2.0-rc.5`，再安装同版 Android APK。保留 profile 的 `remote/` 身份与授权数据；沿用正式签名升级不需要清除 App 数据或重新配对。

本地测试不代表用户真机已验收。本版仍保留独立 Noise 安全审查、完整供应链及许可证独立审查、Android ARM 真机、iOS/macOS、真实模型、完整 UI/网络切换、既有 profile 升级/回滚及持续长期 fuzz 等延期项。
