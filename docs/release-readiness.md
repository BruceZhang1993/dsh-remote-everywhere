# v0.1.0 发布就绪清单

> 本文保留 `0.1.0` 的历史授权与验收记录。下个版本的当前状态见 [完整发布链路检查](release-preflight.md)，用户安装见 [安装指引](install.md)。

日期：2026-10-15。用户已明确要求首次发布 `0.1.0`，本次按既定流程向 GitHub Packages 上传五个 `@brucezhang1993/dsh-remote-*` npm 包，使用 `next`。正式 App 分发另有签名与平台门禁，`latest` 晋级仍需单独授权。
下表的未完成审查/验收继续如实保留；本次发布授权不代表它们已通过，也不声称获得独立安全认可。
首发已完成，具体来源、五包与验收结果见 [0.1.0 发布记录](release-0.1.0.md)。

| 门禁 | 状态 | 完成证据 |
|---|---|---|
| 仓库与 CI | 最终标签验证通过 | `v0.1.0` / `5556e67` 的协议/安全、Android AOT 与 Flutter Android 均成功，iOS skipped；此前一次 MCP 失败未定因，保留诊断 |
| 发布及晋级脚本 | 首发已实证，晋级未执行 | 15 个 mock 回归、actionlint 和实际五包上传/安装通过；未运行 `promote-latest` |
| 发布 environment | 已配置并完成本次审批 | 仅允许 `v0.1.0`，审核人 BruceZhang1993；发布批准 SHA 为 `5556e674941b01451e90c428b20b44e1c24e4eae`，晋级批准变量未设置 |
| 私密披露渠道 | 已开启，验收未完成 | API enabled=true，公开网页 Report a vulnerability 入口可见；实际收件、通知与维护者处理仍待验证 |
| 独立 Noise 审查 | 未完成 | [交接材料](noise-review.md) 已准备，缺第三方书面结论 |
| Android 许可证声明 | 材料已准备，完整审查未完成 | [六项补证](android-license-review.md)及 [Maven/native 声明材料](android-notices.md)；Camera BSD 来源、条款/隐私、最终二进制与 Apple 审查仍保留 |
| 持续 fuzz | 入口及首次双端长跑通过，长期验证未完成 | Node/Dart 各 900 秒串行通过，分别 403806/178070 次变异；Dart 故障回放与卡死终止验证通过；范围与证据见 [M4](m4-summary.md) |
| 最终标签与批准 | 已完成 | `v0.1.0` 固定 `5556e67`；同次 CI 和 manifest/哈希核验后设置批准 SHA，按用户授权完成环境审批 |
| GitHub Packages next 发布 | 已完成 | 五包 `0.1.0` 依赖顺序上传，命令 tag 为 next，逐包 registry SHA-512 匹配；[运行记录](release-0.1.0.md) |
| 注册表消费者验收 | 本次 workflow 验收通过 | 全新目录/缓存安装，来源与 SHA-512、CLI 诊断、模拟模型的真实双宿主回归通过；不覆盖其他账号权限、真实模型或旧版本升级/回滚 |
| latest 晋级 | 未执行 | 消费者验收后单独批准同 SHA，再运行 `promote-latest` 并核对五包标签 |

## fuzz 的证据边界

每日 workflow 串行执行 Node 和 Dart，各预算 900 秒/最多 100 万迭代，容器限制 8 GiB 内存与 4 GiB swap。成功标准为进程正常退出、无非预期异常/往返差异，且报告与有界语料上传成功；运行记录固定来源 SHA，报告保留源码哈希、运行方法和范围/位置数。
Node 入口覆盖 DR/TCP；[Dart 入口](dart-fuzz.md)覆盖 DR、WebSocket receive guard 和 Noise 握手/transport。Dart token-position 数与 V8 执行范围不可直接比较，也不是覆盖百分比。SDK socket/control callback、RemoteConnection 生命周期/重连竞速和 Node Noise 未纳入这些覆盖反馈入口。
单次或若干次绿色运行不能称为长期验证完成。发布前仍需确定持续观察周期、覆盖范围和残余风险，由审查结论记录。

## 账号与平台

本次仓库 `GITHUB_TOKEN` 已完成五包写入和全新注册表安装。当前本机 GitHub 凭据仍缺 `read:packages`，包 API/registry 读取返回 403；消费者须安全提供 `read:packages` PAT classic，不把 token 写入文档或源码。
五包在 GitHub 未登录的 Public 筛选列表中核验可见；本次没有手动修改可见性。公开页面不证明外部消费者已具备 registry 认证和读取权限，该项尚未验收。
`next` 按成功的发布命令记录；本机尚未独立读回 dist-tags，未执行 latest 晋级，晋级批准变量未设置。

M3 真机、iOS/macOS、真实模型及其余 UI 验收继续延期。Android 正式分发需要正式签名及真机验收；iOS 需要明确授权 macOS 构建、平台验收与签名分发。当前调试签名 APK 和跳过的 iOS job 不满足这些门禁。
