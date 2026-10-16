# v0.1.0 候选、安装与发布

> 本文保留 `0.1.0` GitHub Packages 发布记录和当时的流程。当前 npmjs 自动发布、版本 PR、Android 正式签名及 GitHub Release 流程见 [CI 与版本发布](ci-release.md)。

`0.1.0` 五包已于 2026-10-15 按用户授权完成 GitHub Packages 首发（命令 tag 为 `next`），来源为 `v0.1.0` / `5556e67`；注册表完整性及全新消费者安装验收通过，见 [发布记录](release-0.1.0.md)。公开仓库为 [BruceZhang1993/dsh-remote-everywhere](https://github.com/BruceZhang1993/dsh-remote-everywhere)，CI 使用 GitHub Actions，npm registry 为 `https://npm.pkg.github.com`。
此首发版本的独立 Noise/完整供应链审查、持续长期 fuzz、私密披露收件和 M3 平台验收仍未完成；本次发布授权不代表这些验证通过。此处仅涉及五个 npm 包，正式签名 App 分发仍保留。
源码包继续保留 alpha 版本与工作区名称。普通候选写入 `.cache/release-0.1.0`；GitHub Packages 候选写入 `.cache/github-packages-0.1.0`，只在 staging 改版本、包名、内部引用、Cordis patch 和发布元数据。
候选 manifest 记录源提交、工作区是否有未提交改动、锁文件及五个 tarball 的 SHA-256。首批本地验证曾为 sourceDirty=true；提交 `e4a1b32` 的远端候选已验证 sourceDirty=false，尚未创建发布标签。

## 本地门禁

```bash
tools/run-limited.sh pnpm check
tools/run-limited.sh pnpm test
tools/run-limited.sh pnpm test:release-candidate
# 只生成和测试本地候选，不推送或发布。
tools/run-limited.sh pnpm test:release-candidate --github-packages BruceZhang1993/dsh-remote-everywhere
tools/run-limited.sh node tools/publish-packages.mjs
```

候选测试命令生成五个 `0.1.0` 候选，在临时消费者中禁用 install scripts 安装，并执行诊断 CLI 和两个真实 DSH 的双向会话、审批、文件/终端回归。
DSH 支持基线为 **0.1.7-rc.2**，Node ≥22.19.0。宿主服务须同版，不能把 rc.1/rc.2 混装结果当兼容性验证。
Linux 管理 socket 已验证；Windows/macOS 管理入口尚未验收。

## 隔离安装与回滚

在具有同版 DSH 的新测试 profile 中同时安装 protocol、core、tunnel、cli 和插件候选 tarball；仓库入口会自动完成这一独立安装。
测试入口从候选 manifest 选择五个 tarball，一并安装，不向 GitHub Packages 查询或发布。`publish-packages.mjs` 默认只做离线来源、锁文件、顺序、大小和哈希校验。
GitHub Packages 要求包名使用所属账号的小写 scope，因此候选名称为：

```bash
@brucezhang1993/dsh-remote-protocol
@brucezhang1993/dsh-remote-core
@brucezhang1993/dsh-remote-tunnel
@brucezhang1993/dsh-remote-cli
@brucezhang1993/dsh-remote-everywhere
```

本地实际执行安装/测试时仍须套 `tools/run-limited.sh`。保留现用 profile、锁文件和设备状态，先在隔离 profile 验证；不要覆盖 identity.key 或 devices.json。
回滚时停止候选实例、恢复原 profile 与其锁文件/旧 tarball，保留原身份和信任记录。候选不改变 DR v1 或设备表格式；审计日志由新运行时管理，旧版本可能不保留新增审计事件。

配对仍需双方人工核对六位 SAS，默认权限为 session/stream/approval；files/terminal/admin 需显式授予，终端和写文件仍逐次审批。
更新隧道地址必须保持固定公钥。撤销在被控端本机管理 CLI 执行；具体命令见原安装手册。
核心通信格式兼容旧端，但新增接收保护只在升级端生效。先升级被控端插件，再升级控制端插件/App；双方都升级后才具有双向加固。

## 审计和故障行为

每个运行时拥有 `remote/audit.jsonl`；当前和 `.previous` 各最多 1 MiB，单条最多 4096 bytes，追加前轮转，文件权限 0600。
记录连接/鉴权、RPC 状态、配对/吊销、人工交互和敏感操作元数据，排除参数、响应正文、身份密钥、二维码/sid/SAS、地址 URL 和异常消息。
审计不是持久化业务数据库或防篡改账本；没有逐条 fsync 保证，宿主崩溃仍可能丢失未落盘记录。

文件不安全、被替换或写入失败时，审计锁定失败状态并告警，新的远程操作失败关闭，不自动重试写入；本机吊销与资源关闭仍可执行。
操作已执行后若结果审计失败，调用方可能收到失败/未知结果，不能据此重发写入。修复目录/磁盘后显式重启运行时，不提供隐式恢复。
旧审计文件若超过 1 MiB 或权限不符合要求，应先由维护者归档并修正；不会自动丢弃旧证据。

## GitHub Actions 与发布门禁

独立 Noise 审查、完整供应链复核、持续 fuzz 和私密披露收件验证仍未完成。首发按上述用户授权执行，保留这些已知限制；最新既有 CI 与产物证据见 [M4 记录](m4-summary.md)。发布必须重新验证最终标签的同一 SHA。
Android/iOS 最终产品验收仍按 M3 延期清单执行；此候选不宣称双端产品已验收。

- `ci.yml`：Node/Dart、安全回归、互通、两端覆盖率 fuzz 短跑、Dart 故障注入/回放、候选独立安装与 Android AOT。
- `mobile.yml`：GitHub 托管 Linux 容器检查 Flutter 并构建 Android；iOS 只在手动明确允许无 systemd 限额的 macOS 构建时运行。
- `fuzz.yml`：每天串行执行 Node DR/TCP 与 Dart DR/Noise/WS guard 覆盖率反馈 fuzz，各 900 秒/最多 100 万迭代，保存有界语料及报告；每次均有超时和容器限额。范围与盲区见 [Dart 入口](dart-fuzz.md)。
- `publish.yml`：只手动 dispatch，必须选 `v0.1.0` 标签。先重跑同一标签的 CI 与 Android App 门禁，再下载该次 CI 的确切 tarball。`publish-next` 依序上传 `next`；`promote-latest` 只晋级已发布且哈希匹配的五包，不重新打包或发布版本。两种操作均需 environment 人工审核。

`github-packages` environment 已配置审核人 `BruceZhang1993`，仅允许 tag `v0.1.0`。允许所有者审核自己的手动运行，这是维护者发布确认，不代表独立安全审查。将 environment 变量 `DSH_RELEASE_APPROVED_SHA` 设为本次授权发布的**完整提交 SHA**，同时记录尚未完成的审查和验证；变量未设置或不匹配时发布脚本拒绝执行。审批针对具体候选/哈希/账号/registry/tag，不能只凭绿灯放行。
仅发布 job 拥有 `packages:write`，使用该仓库 `GITHUB_TOKEN`；token 仅传入发布和注册表安装步骤，不写进源码或候选包。安装脚本禁用，安装完成后从诊断/DSH 子进程环境移除 token。manifest 必须 clean、与标签 SHA/仓库/锁文件一致。
发布顺序为 protocol → core → tunnel → cli → plugin。预先查询全部现有版本：只有 E404 视为缺失，鉴权/网络错误直接停止；已有版本须与本地 SHA-512 完全一致。每个包发布后核对注册表完整性再继续；中途失败保留已发布包，可对同一候选重新验证续发，不自动删除或回放不匹配的版本。
注册表不可用/短暂不可见时该次发布失败，维护者检查后再续发。上传后 `tools/package-smoke.sh --registry` 使用全新目录/缓存，经 registry 安装五包和固定 DSH，核对安装锁文件的下载来源及 SHA-512，再执行 CLI 诊断与模拟模型的真实双宿主回归。结果上传为独立验收产物；它不证明其他账号的读取权限或真实模型验收，也不覆盖已有版本升级/回滚。

注册表安装验收通过后，记录来源 SHA、五包 integrity、消费者环境、诊断/真实 DSH 回归及回滚结果，再将 environment 变量 `DSH_RELEASE_PROMOTION_APPROVED_SHA` 设为同一完整 SHA，并明确授权 `latest` 晋级。手动 dispatch 选择同一 `v0.1.0` 和 `promote-latest`；脚本先核对全部五个已发布版本，再按依赖顺序修改并读回 `latest`。缺少版本、哈希不同或批准变量不匹配时，在修改任何 tag 前拒绝。部分晋级失败保留已改 tag，停止后续包；核验后可对同一来源续跑，不自动回滚。本次首发不设置晋级批准变量。

发布前逐项核对见 [发布就绪清单](release-readiness.md)，Android 6 项声明补证见 [许可证复核](android-license-review.md)，Maven/native 与 JNI 来源见 [声明材料](android-notices.md)。

## 注册表安装（发布后）

即使包公开，GitHub npm registry 安装仍需要认证。本次五包已在未登录的 GitHub Public 筛选列表中核验可见，没有手动修改可见性；其他账号的 registry 认证/读取仍需单独核验。参见 [GitHub npm registry 官方说明](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-npm-registry)。
在隔离 profile 的 `.npmrc` 写入以下配置，scope 使用仓库账号的小写形式 `brucezhang1993`，保留 token 的环境变量引用：

```ini
@brucezhang1993:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}
```

在本机环境安全提供具有 `read:packages` 的 PAT classic 后安装 `@brucezhang1993/dsh-remote-everywhere@0.1.0`，禁用 install scripts。profile 的 `dsh.profile.bundles` 也必须使用该完整 scoped 包名，不能沿用无 scope 的源码名称。源包和注册表包使用同一 DR v1；升级 profile 时更新包名和锁文件，保留原 remote 状态目录。
账户/组织可禁用包权限自动继承，需实际核验 Actions 安装权限。诊断 CLI `@brucezhang1993/dsh-remote-cli` 可单独安装；插件与诊断包都提供 `dsh-remote` 可执行名，放在不同 profile 中使用。
