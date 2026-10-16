# 安装与升级

[English](https://github.com/BruceZhang1993/dsh-remote-everywhere/blob/master/docs/install.en.md)

本指引适用于带「远程设备」管理 UI 的版本，宿主基线为 **DSH Desktop 0.2.1-alpha.2**。插件和 Android App 分别安装：电脑从公共 npmjs 安装插件，手机从本仓库 GitHub Releases 下载 APK。GitHub Packages 的旧 `0.1.0` 不含此 UI，使用旧宿主，不能代替本指引中的版本。

先查看 [GitHub Releases](https://github.com/BruceZhang1993/dsh-remote-everywhere/releases) 和对应版本的发布说明。未出现目标版本/附件时，该版本尚不可下载安装；本地候选或源码版本号不代表正式发布。预发布显示为 **Pre-release**，不要只依赖 `/releases/latest`。

## 电脑：安装 DSH 插件

1. 在桌面端「关于」确认版本为 **0.2.1-alpha.2**，切换到准备使用的 profile。先备份该 profile 的配置、package/lock 文件和 `remote/` 状态目录。
2. 打开 **插件 → 添加插件**，在「包名或地址」填写以下内容，registry 选择 **npm 官方源 `https://registry.npmjs.org`**：

   ```text
   @brucezhang1993/dsh-remote-everywhere@next
   ```

   `next` 用于预发布。`0.2.0-rc.3` 按维护者决定保留了主插件的 `latest`，此时 `@latest` 也会安装该 RC，仍属预发布；以对应发布说明为准。要固定版本，将 `next` 替换为发布说明中的完整版本（不含 tag 的 `v` 前缀）；不要省略版本后缀，否则首次仅有 `next` 时可能找不到 `latest`。
3. 等待宿主完成安装，按宿主提示启用或重载插件。主插件会自动安装同版 UI 伴生包及协议依赖，无需逐个手工添加六个 npm 包，也无需向系统安装目录复制文件。
4. 打开侧栏 **远程设备**，或 **插件 → DSH Remote Everywhere** 详情页；首次启用也会提供「打开远程管理」。看到本机身份与设备页面，即完成入口检查。

公共 npmjs 发布后的读取不需要 GitHub PAT。若 profile 为 `@brucezhang1993` 配置了旧 GitHub Packages scope registry，请先移除或调整该 scope 映射，避免默认请求 `npm.pkg.github.com`。不要向 npmjs 发送 GitHub token。

找不到入口时，依次确认：安装的版本包含 UI、主插件已启用、宿主版本匹配、UI 伴生包安装完整，并按宿主提示重载。不要为消除报错强装到旧宿主或忽略 peer dependency 冲突。若 registry 报缺少 `dsh.bundle`，参见对应发布的 registry 验收结果；把 tarball 安装成功不能替代 registry 验收。

## 手机：安装 Android APK

1. 手机需 **Android 7.0 / API 24 或更新版本**。从同一仓库的 [Releases 列表](https://github.com/BruceZhang1993/dsh-remote-everywhere/releases) 选择版本，包括需要的 Pre-release。
2. 下载该版本全部六个附件：`dsh-remote-android-VERSION.apk`、`SHA256SUMS`、`release-manifest.json`、`LICENSE.txt`、`ANDROID-NOTICES.md`、`ANDROID-LICENSE-REVIEW.md`，放在同一目录。
3. Linux 执行 `sha256sum --check SHA256SUMS`；macOS 执行 `shasum -a 256 --check SHA256SUMS`。Windows 可用 `Get-FileHash .\dsh-remote-android-VERSION.apk -Algorithm SHA256`，将结果与 `SHA256SUMS` 中该 APK 对应行比较。`VERSION` 替换为所选版本。任何不匹配都应重新下载并核对来源。
4. 打开 APK，按 Android 提示允许该安装来源后安装（新版 Android 按下载应用/文件管理器授权）。无需 root；npm 插件不会向手机安装 App。APK 是 universal 包，无需自己选择 ABI。
5. 如已安装调试签名包，它与正式发布证书不同，通常不能直接覆盖。先在宿主保留可用配对入口，按需吊销旧手机授权，再卸载旧测试包并安装正式包、重新配对。正常正式版升级应沿用同一证书和 applicationId，并增加 versionCode。

Android 包名为 `dev.dshremote.dsh_remote_mobile`。有 Android SDK 时，可用 `apksigner verify --verbose --print-certs <APK>` 核对签名证书 SHA-256，与所选 Release 的 `release-manifest.json` 比较；首次信任还应核对[发布配置中登记的证书](https://github.com/BruceZhang1993/dsh-remote-everywhere/blob/master/docs/ci-release.md)。校验和证明文件一致，不能代替对发布来源及证书的信任。

iOS 暂无可安装 IPA 分发；仓库的 unsigned `.app` 是开发检查产物，不可按 Android APK 方式安装。

## 首次配对

1. 在被连接的电脑打开「远程设备」。跨电脑/手机连接时，先在「公网访问」开启隧道并等待就绪；默认 loopback 地址只能本机访问。可选公网隧道需要按 [Cloudflare 官方下载说明](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/downloads/) 安装 `cloudflared`，也可使用自己管理的可达 WebSocket 端点。
2. 选择「让其他设备连接本机」，勾选所需权限，生成配对码。另一个桌面端选择「连接其他 DSH」并粘贴/导入 JSON；Android App 扫码或粘贴完整 JSON。
3. 人工比较两端六位安全码，双方分别确认。配对码最多有效 180 秒；超时重新生成。A 控制 B 与 B 控制 A 分别授权，不会自动双向授信。
4. 在控制端 DSH 对话中使用 `remote-control`，指定设备并列出会话；Android 在 App 内选择或新建远端会话。管理页面不是完整远端聊天页。文件写入、终端与会话审批仍由人响应。

默认只授予 `session,stream,approval`；文件、终端和设备管理按需显式选择。更改权限时先吊销再配对。Quick Tunnel 地址更换后，重连只能更新地址，原公钥仍须匹配；不要通过删除身份文件绕过公钥冲突。

## 升级、回滚与移除

升级电脑插件前停止相关连接并备份 profile，安装所选**确切版本**；主插件依赖会同步 UI 和协议版本。保留 `<profile>/remote/identity.key` 与 `devices.json`，不要把其他设备身份复制过来。升级后复核设备列表、两端身份和一次会话/审批操作；已有 profile 跨宿主版本升级、真机及其他操作系统仍需单独验收。

回滚时停止实例，恢复原宿主对应的包版本、配置与锁文件；只有在理解设备授权变化后才恢复旧信任快照，以免恢复已吊销授权。先在被控端本机吊销不再使用的设备，再卸载插件或手机 App。删除手机本机记录不等于宿主吊销；原状态目录不要未经备份就清空。

## 仅需诊断 CLI

诊断 CLI 需要 Node.js ≥22.19。发布到 npmjs 后，可在独立目录安装诊断包；它不提供桌面管理 UI，也不安装手机 App：

```bash
npm install --ignore-scripts --registry=https://registry.npmjs.org @brucezhang1993/dsh-remote-cli@next
./node_modules/.bin/dsh-remote help
```

通常 `latest` 用于已通过注册表验收并晋级的稳定版；`0.2.0-rc.3` 本次保留已有 `latest`，CLI 的 `latest` 也指向该 RC。六包统一安装请显式指定 `0.2.0-rc.3`，具体标签见[发布记录](release-0.2.0-rc.3.md)。旧 GitHub Packages 安装流程与凭据要求保留在[历史发布文档](https://github.com/BruceZhang1993/dsh-remote-everywhere/blob/master/docs/release.md)。
