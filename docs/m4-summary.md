# M4 加固与验证记录

日期：2026-10-15。基线 `475ea94`，分支 `feature/20261013-m4Hardening`。
状态：**接收加固、统一审计、scoped 候选、远端 CI、Dart 覆盖率反馈入口与 Android 声明材料已准备；五包 0.1.0 首发及注册表安装验收已完成；独立/平台审查、持续长期 fuzz 与 latest 晋级未完成**。
用户已创建公开仓库 `BruceZhang1993/dsh-remote-everywhere`，origin 已接入；默认 master，Actions 已启用。用户明确授权后，M4 实现提交 `f266b56` 首次推送至 origin/master，远端 SHA 已核对一致。CI 首轮结果及修复见下方。
远端初次核验时 private vulnerability reporting 未启用、environment 列表为空；2026-10-14 后续已启用报告并配置 `github-packages` environment，见下方发布收口记录。批准 SHA 和私密收件验收仍未完成，尚未发布。

## M3 复核结论

M3 首版代码已提交，工作区在开工时干净。原有 Node **44/44**、Dart **46/46**、Flutter **19/19** 与静态分析本轮复验通过。
现有 APK 的 SHA-256 与 M3 记录一致，模拟器报告包含配对、聊天、人工审批/提问、前后台恢复和冷启动身份保留的通过记录；本轮未重新操作模拟器。
用户确认按开发完成进入 M4，Android 真机、iOS/macOS、真实模型与其余 UI 验收继续延期。

## 已实现

- Dart 原生 `WebSocket.fromUpgradedSocket` 支持 `maxPayloadLength`，但本机 Dart 3.13.5 源码的 `_lengthDone` 只检查当前 frame 长度，不能限制未 FIN 的多帧累计值。新增 socket 接收 guard，帧头最多 10 字节，累计消息 65551 字节，最多 1024 个数据分片；同时设置 SDK 单帧限额。后续专项测试复现并修复 SDK 带载荷 ping 丢前片问题：adapter 有界重组一条 DR，控制载荷独立，SDK 继续处理 masked pong/写回压。
- malformed、masked、compressed、非法续帧和异常控制帧失败闭合。SDK 的协议关闭映射为 `invalid-argument`；网络 EOF 截断仍为 `transport/lost`，保留自动恢复语义，连接 owner 保留原有资源结算行为。
- Node 控制端、被控端和隧道就绪探针统一限制 `maxFragments/maxBufferedChunks=1024`，保留原有 `maxPayload` 与禁用压缩。
- 安全回归验证同连接写重放、同身份新连接的旧密文、物理流混淆、版本降级、角色/身份混淆、能力交集为空，以及两方向 1025 个小分片的提前拒绝。
- 首批 Node/Dart 共 24000 样本；本轮加有效 DR 头变异，默认共 **34000**，放大压力验证 **340000** 样本通过。均为固定 seed，不声称已完成长期覆盖率引导模糊测试。
- runtime 单一审计 owner 记录连接/鉴权、通用 RPC 状态、配对/吊销、人工交互与敏感操作。白名单排除参数/正文/二维码/密钥/异常消息；追加前轮转，当前与 previous 各 ≤1 MiB、单条 ≤4096 bytes、0600。不安全/被替换文件拒绝；失败锁定并告警，阻止新远程操作但保留本机吊销和清理。无逐条 fsync 承诺。
- 握手 10 次/分钟后返回 429 并审计 busy；补物理连接容量释放恢复和真实宿主工作区外 symlink 读/写审批拒绝。
- 添加 MIT LICENSE、安全披露策略和双语发布说明；五个 `0.1.0` 候选只在 staging 改版本，源码包继续 alpha。候选携带许可证/策略，插件携带双语安装说明；包内容排除测试夹具、私钥与状态文件，manifest 记录来源和 SHA-256。
- GitHub Packages 候选从实际 `owner/repo` 生成五个 scoped 包名，并同步重写内部 imports/dependencies、Cordis patch 和 repository/publishConfig；先前测试使用 `local-validation` 占位账号，本轮已按真实仓库生成并复验 `@brucezhang1993` 五包。MCP serverInfo 从实际 package.json 读取名称/版本，候选不再错误声明 alpha。
- GitHub Actions 四个 workflow 已准备，action 引用锁定为官方 tag 解析的 commit SHA：CI、托管容器 Android App、每日有界 fuzz、手动受保护标签发布。发布只下载同次 CI 产物，校验来源/锁文件/哈希/批准 SHA，并用最小权限 GITHUB_TOKEN 依次发布 next；中途失败保留已发布版本并核对完整性续发。
- V8 覆盖率反馈短跑及 10 分钟运行通过：**147123 次变异**，执行范围 34 → 38，语料 21 条。只覆盖 Node DR/TCP；每日入口后续首次远端运行已通过，见下；不声明 Dart/Noise/WS 长期覆盖完成。
- 私密漏洞报告表单和 [独立 Noise 审查交接](noise-review.md) 已准备；后续已启用私密入口，但收件未验收，也没有第三方签署报告。
- Android 外部 release 依赖 **91 个产物 / 86 个坐标**，artifact/POM 哈希均已记录；官方 Maven 源补齐 POM，OSV 当前匹配 **0**。80 个直接许可证声明、6 个声明缺口及本地 Flutter project 排除项均明确记录，完整平台/许可证独立审查仍待完成。

## 依赖公告复核

首轮 `pnpm audit --prod --json` 退出 1：**1 high / 2 moderate**；修复后退出 0：所有级别 **0**。
原始 JSON 在 `.cache/m4/pnpm-audit.json` 与 `pnpm-audit-after.json`，为本次注册表查询快照。

| 依赖 | 精确版本变更 | 公告与项目判断 |
|---|---|---|
| `ws` | 8.18.3 → 8.22.0，core/tunnel 同步 | [小分片内存耗尽](https://github.com/websockets/ws/security/advisories/GHSA-96hv-2xvq-fx4p) 的修复版本下限为 8.21.0；本项目已有字节限额，仍补结构数量限额 |
| `ws` | 同上 | [TypedArray close reason 内存披露](https://github.com/websockets/ws/security/advisories/GHSA-58qx-3vcg-4xpx) 下限 8.20.1；当前 transport 用 terminate，未发现该参数调用路径，升级消除依赖公告 |
| `ajv` | 8.17.1 → 8.18.0 | [动态 `$data` 正则 ReDoS](https://github.com/advisories/GHSA-2g4f-4pwh-qvx6)；项目 `new Ajv({strict:true})` 未启用 `$data`，未认定可利用，仍升级到修复版本 |

更新通过禁用 install scripts 的安装完成，锁文件仅变更上述依赖及失去引用的旧版本。
未改密码学原语依赖、Noise 协商版本或包的 alpha 版本；没有注册表发布。

## 验证

全部本地分析、测试与构建限制在用户 systemd scope：8 GiB 内存 / 4 GiB swap，串行执行。

| 门禁 | 结果 |
|---|---|
| 仓库 check / Node test | 静态、生成、TS 和宿主边界检查通过；**68/68**，含统一审计、失败闭合、洪泛/容量与变异回归 |
| Dart analyze / test | 无问题；**58/58**，含接收、网络 EOF 和控制帧交错回归 |
| Flutter analyze / test | 无问题；**19/19** |
| Node 生产依赖 audit | **0** 条当前公告；不覆盖 Dart、系统或密码学审计 |
| Node↔Dart 向量 / 互通 | 通过冻结 Noise 向量、第三方 BLAKE2b oracle、加密 DR RPC、重放及错误 prologue 拒绝 |
| 真实 DSH↔Dart 本地 WS | 通过双方 SAS、会话/流式归并、compact、审批/提问、上传/读取、故障隔离、双订阅恢复、宿主重启与吊销拒绝 |
| 独立 npm tarball 安装 | **五个 0.1.0 候选**禁用 install scripts 安装，通过诊断 CLI 与两个真实同版 DSH 的双向会话、文件/终端审批闭环及 symlink 围栏 |
| GitHub Packages scoped 候选 | 五包独立安装与真实 DSH 双向回归通过，MCP 名称/版本与实际打包 manifest 一致 |
| GitHub workflow / 发布门禁 | actionlint 1.7.12（校验官方 checksum）通过，缺失的 shellcheck/pyflakes 未启用；shell 语法另行通过，mock 发布回归 **9/9**；没有实际 registry 写入 |
| 覆盖率 fuzz | Node DR/TCP 600 秒、**147123** 次变异通过；报告、语料与源码哈希已记录 |
| Android 外部供应链库存 | 91 artifacts / 86 坐标；artifact/POM 哈希齐全，OSV 快照 0，6 个直接许可证声明缺口保留 |
| Android APK | 加固版本 release 构建通过，APK 签名与 zipalign 4 字节校验通过；仍为本地调试签名，未安装设备 |
| 真机、iOS、真实模型 | 未执行，延期项保留 |
| 远端 CI | 验证提交 `e4a1b32` 的协议/安全、Android AOT 与移动 Android job 全部通过；iOS 按条件跳过 |

加固版本保存在 `.cache/m4/dsh-remote-release.apk`，M3 的 `.cache/mobile/dsh-remote-release.apk` 保留原版本与证据。
APK 已因控制帧修复重新构建，SHA-256：`703ff02ea4cd4fb08bcda2062e7f2ee1f78ebd1d2bc83a12e4045f761a3229b8`；首批 hash 不再作为当前候选依据。
构建日志 `.cache/m4/android-build.log`；Dart/Flutter 测试、互通与 tarball 安装日志同目录。

## 复现与后续

```bash
tools/run-limited.sh bash -lc 'pnpm check && pnpm test'
tools/run-limited.sh pnpm test:security
tools/run-limited.sh bash -lc 'cd packages/core/dart && dart analyze && dart test'
DSH_FLUTTER_BIN=/home/bruce/Android/flutter/bin/flutter tools/mobile-check.sh check
tools/run-limited.sh pnpm audit --prod
tools/run-limited.sh pnpm test:release-candidate
tools/run-limited.sh pnpm test:release-candidate --github-packages BruceZhang1993/dsh-remote-everywhere
tools/run-limited.sh node tools/publish-packages.mjs
tools/run-limited.sh node --test --test-concurrency=1 tools/test-release.mjs
tools/run-limited.sh env DSH_FUZZ_SECONDS=600 pnpm test:fuzz-coverage
tools/run-limited.sh node tools/dependency-inventory.mjs
```

`dart` 命令应指向已锁定的 Flutter 3.47.7 / Dart 3.13.5。互通与打包入口沿用开发手册。
首轮本地候选目录 `.cache/release-0.1.0`，来源与哈希见 `manifest.json`，当时 sourceDirty=true；该本地验证阶段未提交、推送或发布，后续同步见远端执行记录。
详细覆盖与库存见 [安全验证矩阵](security-validation.md)，安装、回滚和发布门禁见 [中文发布说明](release.md) / [English](release.en.md)。
GitHub Packages 候选目录 `.cache/github-packages-0.1.0`，入口与环境配置见 [发布说明](release.md)；仓库归属已确认，正式发布仍需独立审查、保护 environment、批准 SHA 与有效披露渠道，不能由仓库创建推断已获发布授权。
仓库接入复验：实际 scope 五包独立安装、诊断 CLI、两个真实同版 DSH 双向闭环与 MCP metadata 通过；离线发布校验、mock 门禁 **9/9** 和 actionlint 再次通过。日志 `.cache/m4/github-repo-{candidate,offline,release-guards,actionlint}.log`。该阶段没有推送、触发远端运行或发布包。
已授权首次同步：在当前 M4 feature 分支提交 `feat: 完成 M4 安全加固与 GitHub 发布准备`，将该提交及 M1–M3 历史首次推送到空仓库的 `origin/master` 并触发 CI；用户已确认执行；正式发布门禁保留，不创建发布标签。
剩余：Node 持续长期结果、Dart/Noise/WS 长期覆盖、独立 Noise、平台二进制及完整分发许可证审查、私密收件验证、批准 SHA/包权限和正式发布；M3 延期项不变。

## 首次 GitHub Actions 执行

提交 `f266b56` 的 [协议/安全 workflow](https://github.com/BruceZhang1993/dsh-remote-everywhere/actions/runs/38508880850) 与 [移动 workflow](https://github.com/BruceZhang1993/dsh-remote-everywhere/actions/runs/38508880939) 已实际触发，但首轮失败。
协议 job 已通过 Node/Dart 检查、短跑覆盖率 fuzz、互通和生产依赖 audit；候选生成读取 Git 来源时被容器工作区 ownership 检查拒绝。两处 Android job 均在 Flutter action 安装前因缺少 jq 失败，未运行 Android 构建。
修复只补齐 Android 容器 jq，并为需要 Git 来源的 CI/publish job 通过 GIT_CONFIG 环境变量信任准确的 github.workspace 路径，避免扩展到全部目录或依赖子进程 HOME；不更改 Git 来源/哈希校验逻辑。后续结果见下。

提交 `cba3ad4` 的 [协议 workflow](https://github.com/BruceZhang1993/dsh-remote-everywhere/actions/runs/38509381539) 中 protocol-core **成功**，包含 clean 来源的 scoped 候选安装、真实 DSH 回归、9/9 发布门禁与产物上传；该 workflow 的 Android AOT 及 [移动 workflow](https://github.com/BruceZhang1993/dsh-remote-everywhere/actions/runs/38509381630) 仍失败。
Android setup action 默认请求已撤下的 SDK `tools` 包，报 Failed to find package 'tools'。进一步只将两处 packages 明确为 platform-tools、platforms;android-36、build-tools;36.0.0，与本机 Flutter 3.47.7 的 compileSdk=36 及已验证 SDK 一致；SDK/构建门禁未绕过，后续结果见下。

提交 `31ec871` 的 [协议 workflow](https://github.com/BruceZhang1993/dsh-remote-everywhere/actions/runs/38509733494) 中 protocol-core 再次成功；SDK 组件安装也已通过，但 Android 构建命令在 Flutter SDK 的 Git ownership 检查处失败，[移动 workflow](https://github.com/BruceZhang1993/dsh-remote-everywhere/actions/runs/38509733543) 同样失败。
SDK 归档保留了与容器运行用户不同的 owner；仅在 Android 构建步骤将准确的 github.workspace 和 action 导出的 FLUTTER_ROOT 纳入 Git protected config，不信任其他目录。源码所有权和校验逻辑不改。

### 最终复核

验证提交 `e4a1b328366e7ec7f88fd9c02ac472d18d6b1b19` 的 [协议/安全 workflow](https://github.com/BruceZhang1993/dsh-remote-everywhere/actions/runs/38510064374) 与 [移动 workflow](https://github.com/BruceZhang1993/dsh-remote-everywhere/actions/runs/38510063090) 均为 **success**。protocol-core、android-aot、移动 android job 全部通过；iOS 未满足手动执行条件，状态为 skipped，不能计为 iOS 验收通过。

- 远端候选 `github-packages-0.1.0-candidates` 已下载至 `.cache/m4/ci-candidates-e4a1b32/`；manifest 来源为上述完整 SHA，sourceDirty=false，repository 与锁文件哈希正确，五个 `@brucezhang1993` 包的文件大小和 SHA-256 全部匹配。未发布到注册表。
- 远端 APK `m3-android-local-signing-apk` 已下载至 `.cache/m4/ci-android-e4a1b32/dsh-remote-release.apk`；名称沿用 M3，源码来自上述 M4 验证提交。文件大小 **69109931 bytes**，SHA-256：`0f4528c254ab4be6d0204bce80c652f11fa5471eed2a2b289889b6dd68dca8bf`。本机 apksigner 与 zipalign 4 字节复核通过；仍为调试签名，未安装设备。
- 完整 CI 日志保存在 `.cache/m4/ci-protocol-e4a1b32.log`、`.cache/m4/ci-mobile-e4a1b32.log`，APK 签名日志为 `.cache/m4/ci-android-e4a1b32-signature.log`。

本次证据回填仅修改文档，以 `[skip ci]` 同步；以上 CI 和产物均对应 `e4a1b32`，不是后续文档提交。正式发布和延期验收项继续保留。


## 发布门禁后续收口

用户确认继续推进发布准备，未授权创建发布标签或实际发布。已落实：

- `github-packages` environment 配置 required reviewer `BruceZhang1993`，只允许 tag `v0.1.0`。允许维护者审批自己的手动运行；不将这一确认视为独立安全审查。`DSH_RELEASE_APPROVED_SHA` 与 `DSH_RELEASE_PROMOTION_APPROVED_SHA` 均未设置。
- private vulnerability reporting API 确认为 enabled=true，公开 Advisories 页已显示 Report a vulnerability；尚未提交测试报告或发送消息，实际收件/通知仍待验收。
- 新增独立 `promote-latest` 操作：同标签重跑门禁、校验来源与批准 SHA，预查五包 SHA-512，再按依赖顺序修改/读回 latest。晋级还要求注册表安装验收后的第二个批准 SHA。缺失版本、哈希不符及鉴权/网络错误不修改标签；部分失败可对相同来源续跑。
- 发布/晋级 mock 回归 **15/15** 与 actionlint 本地通过；后续 CI 也通过 15/15，不代表 registry 写入已验证。
- Android 六项直接声明缺口已找到补充证据：两个准确 parent POM 链、四个匹配 engine 的官方聚合许可证。远端 APK 包含 engine 全部 1593 个许可证块；Maven/native notice、Apple 和平台独立审查仍未完成，见 [许可证补证](android-license-review.md)。
- 首次 [900 秒 Node fuzz](https://github.com/BruceZhang1993/dsh-remote-everywhere/actions/runs/38523450716) **success**，来源为文档提交 `7e8053b`：447076 次变异、执行范围 32 → 38、4 次发现、21 条语料。报告/语料的源码哈希与当前两个目标文件一致；语料数量和每条输入大小在限额内，无 failure.json。单次通过不能计为持续长期或 Dart/Noise/WS 覆盖完成。

完整顺序与未完成项见 [发布就绪清单](release-readiness.md)。当前本机凭据缺 `read:packages`，包列表查询返回 403；尚未核验包可见性和消费者安装权限。


### 后续远端验证

代码提交 `9669955e697dbcc1e6ce9ae928497f777c887a26` 的 [协议/安全 CI](https://github.com/BruceZhang1993/dsh-remote-everywhere/actions/runs/38524452361) **success**，protocol-core 与 android-aot 全部通过；日志确认发布/晋级门禁 **15/15**。本轮没有修改 App 或 Dart，移动 workflow 的路径过滤未触发重跑；其已有 `e4a1b32` 成功记录保留，不能称为 `9669955` 的移动 App 构建。
五个新候选已下载至 `.cache/m4/ci-candidates-9669955/`，sourceDirty=false，完整 SHA、仓库、锁文件哈希、五包大小和 SHA-256 全部匹配。完整 CI 日志 `.cache/m4/ci-protocol-9669955.log`。

首次远端 fuzz 产物位于 `.cache/m4/fuzz-7e8053b/`，日志 `.cache/m4/fuzz-7e8053b.log`。Node v22.23.3，实际 900002 ms；report SHA-256 为 `57441ab120ed292351259c15b600fd7edbd0cfb7018046359942f2a8854f4e95`，corpus SHA-256 为 `40d5357688c9dbf657c02ca43db0d08fed8ee0d4145d17ee96b1ca20c5f663e6`。运行范围仅 Node DR/TCP。
此次结果回填仅修改文档并跳过重复 CI；代码验证对应 `9669955`，fuzz 对应 `7e8053b`。没有创建发布标签、设置批准 SHA、发布 npm 版本或修改 registry 的 latest。

## 2026-10-15 Dart 覆盖率反馈与 native 声明材料

新增 `packages/core/dart/bin/coverage_fuzz.dart` 和 `tools/dart-fuzz.sh`，不改变生产实现/依赖。以 VM 累计 token-position Coverage 反馈 DR、WebSocket receive guard、Noise 握手/transport 的合成输入；仅保留种子或新增命中输入，失败前保存当前输入/状态并支持回放。范围、资源预算及未覆盖部分见 [Dart fuzz](dart-fuzz.md)。

本机 scope 内验证：Dart format/analyze、58/58 测试、10 秒短跑（960 次变异、623 个命中位置、35 条复用语料），以及 4 项隔离故障注入/恢复回放检查全部通过。命中位置为 frame 60、guard 169、Noise 394，不是覆盖百分比。`pnpm check`、actionlint 和 shell 语法检查通过；生产文件未因故障注入被修改。
日志 `.cache/m4/dart-fuzz-{regression,gates,smoke}.log`。曾发现跨会话测试夹具复用临时密钥，现已按合成 sid 派生不同临时密钥并显式断言不同 transport keys；这是夹具修正，不计为生产漏洞。

提交 `b1f2200` 增加入口与 CI；[移动 Android workflow](https://github.com/BruceZhang1993/dsh-remote-everywhere/actions/runs/38687135971) 成功，iOS 不计通过。首次扩展长跑在安装 Dart 时因缺 unzip 失败，目标尚未运行；提交 `46a3dc5c4eda455230dfa01f4dd140528b24a82e` 补齐工具后，[协议/安全与 Android AOT workflow](https://github.com/BruceZhang1993/dsh-remote-everywhere/actions/runs/38687371586) 成功，含两端短跑和 Dart 故障回放检查。
该次 CI 的五个候选包来源为 clean 的 `46a3dc5`，下载后大小、SHA-256、包名/版本和锁文件均匹配 manifest；Dart 短跑产物为 1812 次变异、623 个命中位置、35 条语料，源码/夹具/锁文件哈希均匹配。`b1f2200` 移动 APK SHA-256 为 `c302ec7b22c3883015a8410570ddabec7b01f5a4c2af470696355eda86fd99a8`，v2 签名和 16 KiB zipalign 校验通过，但签名仍为 Android Debug。新 APK 不冒充下述 `e4a1b32` native 审查基线。

每日 workflow 现串行 Node/Dart 各 900 秒，8 GiB / 4 GiB swap 容器、job 40 分钟上限；手动 [长跑](https://github.com/BruceZhang1993/dsh-remote-everywhere/actions/runs/38687371773) 对应 `46a3dc5`，整体 **success**，两份报告与语料均已下载核验。单次成功也不关闭持续长期门禁；SDK socket/control callback、RemoteConnection 生命周期/重连竞速和 Node Noise 仍不在新增覆盖反馈范围内。

| 900 秒入口 | 变异次数 | 执行覆盖反馈 | 最终语料 | 实际时长 |
|---|---:|---|---:|---:|
| Node DR/TCP | 403806 | V8 范围 38 → 38，新增覆盖输入 0 | 21 | 900001 ms |
| Dart DR/guard/Noise | 178070 | VM token-position 621 → 623，新增覆盖输入 2 | 35 | 900003 ms |

Dart 三个目标命中位置分别为 60/169/394；位置/范围不是百分比，新增覆盖输入不代表漏洞。源码、Dart 夹具/锁文件哈希均匹配；输入大小、语料数与文件大小在预算内，Node 无 failure.json。下载目录 `.cache/m4/fuzz-46a3dc5/{node,dart}`，完整日志 `.cache/m4/fuzz-46a3dc5.log`。
Node report/corpus SHA-256 为 `7332d31545ab3855a47f67c2ed01ed2a5b615a9d648eabed0b160f81e9e20697` / `40d5357688c9dbf657c02ca43db0d08fed8ee0d4145d17ee96b1ca20c5f663e6`；Dart report/corpus 为 `d5a6f44f3d347158133839e9ef1155e3dbbb5498a9829dbc0f65d61c9cd937ae` / `1a7c5123529c515e393f8edd4ae64a9dba01d2641303b948126a6d6e88f458a4`。

`tools/android-notices.py` 对当前 91 个产物/86 个坐标逐一核验哈希后扫描声明：11 个坐标有内嵌声明，保留 4 份不同文本及 15 个原始 native 条目，一层扫描无未检查 JAR。已有 `e4a1b32` APK 的 18 个 native 文件中，9 个与 Maven 原始条目一致，3 个 Flutter engine 串起 Maven → merged → stripped → APK 链；其余应用/JNI 的跨环境字节一致性未证明。
`jni 1.1.0` 官方 archive 与锁文件哈希一致，181 个文件与安装源码全部匹配，JNI 构建入口与混合 BSD/Apache 声明已整理。详细边界和复现入口见 [Android 声明材料](android-notices.md)。Camera BSD 来源、ML Kit/SDK 条款与隐私、最终签名二进制、其余 plugin/Apple 和独立审查继续保留。

本机材料包 `.cache/m4/android-notice-review-20261015.zip` 已准备，未对外发送。生成材料的 `independentlyApproved` 为 false，不能视为分发批准。声明文本包 SHA-256 `5cbbfcfa7051781df653cbc6e56eb316426a55bf6d0bbba99678fc1f63b5a20b`，manifest SHA-256 `305d80f2e6bd389bc87c3c1d8558670a65b35ac0ca773b163373e61d9aeb5d67`。

材料提交 `b0a97f7` 的 [协议 CI](https://github.com/BruceZhang1993/dsh-remote-everywhere/actions/runs/38688529442) 在候选安装后的真实 DSH MCP 断言失败，Android AOT 通过；前面的协议/安全、Dart fuzz 与故障注入均通过。该断言原来未输出错误码，本轮增加仅含失败请求编号/有界错误码的断言诊断。本机完整候选安装回归未复现；暂不认定原因或宣称已修复，重跑结果见下一段。

诊断提交 `74c271afc601b07fa2242a8a84f4480ecd2f41cb` 的 [完整 CI](https://github.com/BruceZhang1993/dsh-remote-everywhere/actions/runs/38689068341) **success**：protocol-core 与 android-aot 均通过，包括 Node 68/68、Dart 58/58、4 项故障回放、真实 DSH 候选安装和 15/15 发布门禁。五包 clean 来源/大小/哈希与新短跑报告已下载核验；该短跑为 1662 次变异。本机另连续 3 次双宿主回归通过，日志 `.cache/m4/mcp-host-repeat.log`。此前一次 MCP 失败尚未定因，保留诊断和观察项；后续绿色结果不视为已证明修复该次失败。

本机另做一次临时副本的同步卡死故障注入，执行实际 `dart-fuzz.sh` watchdog（10 秒预算 +60 秒宽限）。约 70.3 秒后退出 124；report 保持 `passed=false/status=running`，最后合成输入完整保留，生产文件未修改。证据 `.cache/m4/dart-watchdog-evidence.json` 与 `.cache/m4/dart-watchdog.log`。这是本机补验，不计入 CI 的四项 oracle 检查。
审查 ZIP SHA-256 `426472656b5a292d4852852aab46cbe1fad9b8461b9be5ea1e2dd775cf940af3`，233202 bytes；ZIP 条目与原始库存、补证、生成工具和 README 均已比对一致。再次只读确认私密报告仍启用，environment 变量列表为空，远端不存在 `v0.1.0`；没有进行注册表写入。

最终证据回填仅修改文档并以 `[skip ci]` 同步；完整 CI 对应 `74c271a`，移动 APK 对应 `b1f2200`，串行长跑对应 `46a3dc5`，native 材料的 APK 基线为 `e4a1b32`。以上不混用为最终正式标签/签名产物；M3 延期项、独立审查与实际发布仍待完成。

## 2026-10-15 0.1.0 首发

用户随后明确要求首次发布版本包 `0.1.0`。按此授权执行五个 npm 包的 `next` 首发，继续如实保留上述独立审查、持续观察、私密收件和 M3 平台延期项；不将发布授权视为这些验证通过。
提交 `5556e674941b01451e90c428b20b44e1c24e4eae` 增加发布后全新 registry 安装、来源/SHA-512 核对和验收产物；本机候选安装/双宿主回归、15 项发布门禁、actionlint、缺少安装凭据时的拒绝检查通过。使用 `[skip ci]` 避免重复 push 检查，随后在固定 `v0.1.0` 标签的手动发布流程中重新执行全部 CI/Android 门禁，未跳过发布验证。

[首次发布 workflow](https://github.com/BruceZhang1993/dsh-remote-everywhere/actions/runs/38692126864) **success**，最终标签的协议/安全、Android AOT、Flutter Android 均通过；iOS skipped。下载同次五包后核对 clean 来源、锁文件、大小、SHA-256、包名/版本及 LICENSE/SECURITY，再固定发布批准 SHA 并按授权完成环境审批。五包依赖顺序上传 `0.1.0`，成功日志 tag 为 `next`，逐包 registry SHA-512 一致。
全新目录/缓存注册表安装后的五包下载来源与 SHA-512、CLI 加密诊断和模拟模型的真实双宿主回归通过。已下载并比对最终验收 JSON 与上传前五包哈希，来源、manifest 完全匹配；五包公开页面在未登录 Public 筛选中可见。其他账号 registry 权限、真实模型和已有版本升级/回滚未验收。
`DSH_RELEASE_APPROVED_SHA` 固定为 `5556e67` 完整 SHA；晋级批准变量未设置，没有执行 `promote-latest`，本机独立读回 dist-tags 仍因权限不足返回 E403。完整来源与证据见 [首发记录](release-0.1.0.md)及 [JSON](release-0.1.0.json)。后续仅回填文档，不移动标签或修改已发布版本。
