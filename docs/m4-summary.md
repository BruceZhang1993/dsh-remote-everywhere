# M4 加固与验证记录

日期：2026-10-14。基线 `475ea94`，分支 `feature/20261013-m4Hardening`。
状态：**接收加固、统一审计、本地 scoped 候选与 GitHub 发布流程已收口；独立/平台审查、持续长期 fuzz 与实际发布未完成**。
用户已创建公开仓库 `BruceZhang1993/dsh-remote-everywhere`，origin 已接入；远端为空、默认 master、Actions 已启用但没有运行记录。用户已明确授权提交 M4 并首次推送 origin/master 以启动 CI，执行结果待复核。
远端只读核验：private vulnerability reporting 未启用，environment 列表为空，默认 workflow token 权限为 read。发布 job 的 packages:write 声明已准备；保护 environment/批准 SHA 与私密收件验收仍需落实，仓库创建不代表已可正式发布。

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
- V8 覆盖率反馈短跑及 10 分钟运行通过：**147123 次变异**，执行范围 34 → 38，语料 21 条。只覆盖 Node DR/TCP；每日入口未远端执行，不声明 Dart/Noise/WS 长期覆盖完成。
- 私密漏洞报告表单和 [独立 Noise 审查交接](noise-review.md) 已准备，渠道未启用，也没有第三方签署报告。
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
| 真机、iOS、真实模型、远端 CI | 未执行，延期项保留 |

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
候选目录 `.cache/release-0.1.0`，来源与哈希见 `manifest.json`，当前 sourceDirty=true；本轮未提交、推送或发布。
详细覆盖与库存见 [安全验证矩阵](security-validation.md)，安装、回滚和发布门禁见 [中文发布说明](release.md) / [English](release.en.md)。
GitHub Packages 候选目录 `.cache/github-packages-0.1.0`，入口与环境配置见 [发布说明](release.md)；仓库归属已确认，正式发布仍需独立审查、保护 environment、批准 SHA 与有效披露渠道，不能由仓库创建推断已获发布授权。
仓库接入复验：实际 scope 五包独立安装、诊断 CLI、两个真实同版 DSH 双向闭环与 MCP metadata 通过；离线发布校验、mock 门禁 **9/9** 和 actionlint 再次通过。日志 `.cache/m4/github-repo-{candidate,offline,release-guards,actionlint}.log`。没有推送、触发远端运行或发布包。
已授权首次同步：在当前 M4 feature 分支提交 `feat: 完成 M4 安全加固与 GitHub 发布准备`，将该提交及 M1–M3 历史首次推送到空仓库的 `origin/master` 并触发 CI；用户已确认执行；正式发布门禁保留，不创建发布标签。
剩余：Node 持续长期结果、Dart/Noise/WS 长期覆盖、独立 Noise 与平台二进制审查、私密渠道实际启用/验证，以及未来仓库的 CI 执行、environment/包权限和正式发布；M3 延期项不变。
