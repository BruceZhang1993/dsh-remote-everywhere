# v0.1.0 发布就绪清单

日期：2026-10-15。目标为 GitHub Packages 的五个 `@brucezhang1993/dsh-remote-*` npm 包；正式 App 分发另有签名与平台门禁。本清单不代表发布授权。

| 门禁 | 状态 | 完成证据 |
|---|---|---|
| 仓库与首次 CI | 已完成 | `e4a1b32` 两条 workflow 成功，clean 候选及 APK 校验见 [M4](m4-summary.md)；后续修改须验证最终 SHA |
| 发布及晋级脚本 | 本地通过 | 15 个 mock 回归、本地 actionlint 通过；`9669955` 协议/安全及 Android AOT CI 全绿；尚未实际写注册表 |
| 发布 environment | 已配置 | `github-packages`；审核人 BruceZhang1993；只允许 tag `v0.1.0`；未设置两个批准 SHA |
| 私密披露渠道 | 已开启，验收未完成 | API enabled=true，公开网页 Report a vulnerability 入口可见；实际收件、通知与维护者处理仍待验证 |
| 独立 Noise 审查 | 未完成 | [交接材料](noise-review.md) 已准备，缺第三方书面结论 |
| Android 许可证声明 | 材料已准备，完整审查未完成 | [六项补证](android-license-review.md)及 [Maven/native 声明材料](android-notices.md)；Camera BSD 来源、条款/隐私、最终二进制与 Apple 审查仍保留 |
| 持续 fuzz | 入口扩展完成，长期验证未完成 | Node 首次远端 900 秒通过；新增 Dart DR/Noise/WS guard 覆盖反馈及故障回放，10 秒 CI 通过；新串行长跑结果见 [M4](m4-summary.md) |
| 最终标签与批准 | 未执行 | 审查固定最终 SHA、重新通过门禁、核对 manifest，然后授权创建 `v0.1.0`；不能预填批准变量 |
| GitHub Packages next 发布 | 未执行 | 五包依赖顺序上传，逐包核对 SHA-512；须获得具体发布授权 |
| 注册表消费者验收 | 未执行 | 隔离 profile 经 registry 安装；诊断、配对、会话、审批、文件/终端与回滚记录 |
| latest 晋级 | 未执行 | 消费者验收后单独批准同 SHA，再运行 `promote-latest` 并核对五包标签 |

## fuzz 的证据边界

每日 workflow 串行执行 Node 和 Dart，各预算 900 秒/最多 100 万迭代，容器限制 8 GiB 内存与 4 GiB swap。成功标准为进程正常退出、无非预期异常/往返差异，且报告与有界语料上传成功；运行记录固定来源 SHA，报告保留源码哈希、运行方法和范围/位置数。
Node 入口覆盖 DR/TCP；[Dart 入口](dart-fuzz.md)覆盖 DR、WebSocket receive guard 和 Noise 握手/transport。Dart token-position 数与 V8 执行范围不可直接比较，也不是覆盖百分比。SDK socket/control callback、RemoteConnection 生命周期/重连竞速和 Node Noise 未纳入这些覆盖反馈入口。
单次或若干次绿色运行不能称为长期验证完成。发布前仍需确定持续观察周期、覆盖范围和残余风险，由审查结论记录。

## 账号与平台

仓库已配置 `GITHUB_TOKEN` 发布权限，但尚未实际验证注册表写入。当前本机 GitHub 凭据缺 `read:packages`，包列表查询返回 403；不能据此认定账号下没有同名版本。正式发布前的 workflow 会预查版本与 integrity；消费者须安全提供 `read:packages` PAT classic，不把 token 写入文档或源码。
首次发布后须核验五包可见性和消费者权限，不能由公开仓库推断包已公开。

M3 真机、iOS/macOS、真实模型及其余 UI 验收继续延期。Android 正式分发需要正式签名及真机验收；iOS 需要明确授权 macOS 构建、平台验收与签名分发。当前调试签名 APK 和跳过的 iOS job 不满足这些门禁。
