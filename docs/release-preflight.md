# 下个版本发布链路检查

后续执行结果（2026-10-16）：用户已授权发布 RC 并保留、披露延期项；rc.1/rc.2 失败标签保留，最终 `0.2.0-rc.3` 已完成公共 npm 与签名 APK 分发。原自动任务因 latest 清理失败，用户决定保留既有标签后人工完成验收与 Release。实际状态及证据见 [rc.3 发布记录](release-0.2.0-rc.3.md)。下文保留发布前历史快照，不代表当前发布状态。

检查日期：2026-10-16；仓库 `BruceZhang1993/dsh-remote-everywhere`，默认分支 `master`。本报告是此时的配置快照，账号、注册表、remote refs 和检查结果在发布前需刷新。历史 `0.1.0` 授权不代表下个版本已经获得发布授权。

**结论：本地验证通过，GitHub 基础配置与 npm 首发凭据已准备；远端最终代码 CI、功能 PR 审查及延期项决策仍未完成，不能标记为“可直接发布”。** 计划首个公共 npmjs / Android 版本为 **`0.2.0-rc.1`**，用户选择先完成 CI 和材料，发布前再决定既有延期项；本次没有修改发布版本、合并 PR、创建 tag 或发布。

## 按发布顺序核对

| 环节 | 当前事实 | 发布前动作 |
|---|---|---|
| 源码与版本 | 功能分支基于 `24287f72bacc8cd020f4f723ab4d20696a1ca70f`；release-config 与 mobile 为 `0.2.0-dev.0` / build 2 | 审查功能 PR 及远端 CI；本报告不替代最终 SHA/tag 的 CI |
| 版本 PR | workflow 会同步 npm 与 Android 版本、递增 build；手改 build 不增时拒绝自动打 tag | 已启用 `can_approve_pull_request_reviews=true`，默认 workflow token 仍为 read，各 job 单独声明写权限 |
| tag 与调度 | 首次合并 release-config 不打 tag；后续版本提高才打 tag。默认 token 创建的 tag 用 workflow_dispatch 显式调度 | 版本 PR 合并后核对 tag 指向最终 SHA；不对已有 tag 强推改写 |
| 完整 CI | 类型/单测、Dart/互操作/fuzz、审计、真实宿主 tarball/UI 与实际 mobile 检查均有入口 | 新流程尚无远端运行记录，需验证同次 tag CI 及其产物 |
| Android 正式签名 | 本地长期签名存在且被 Git 忽略，RSA-3072，有效期至 2054；`mobile-signing` 已有 4 Secrets、匹配指纹及仅 `v*` tag 策略 | 正式证书的本地 APK 验证见下文；发布前仍须最终 tag 构建及既定平台验收 |
| npm 首发身份 | 用户已确认 npm 账号为 `brucezhang1993`；六个公共包尚不可见。本机 CLI 未认证；`npm` environment 仅允许 `v*` tag，已读回 `NPM_TOKEN` 名称与更新时间 | 首发 Token 的实际认证仍待发布验证；首次建包后逐包配置 Trusted Publisher，再撤销引导 Token |
| npm 写入与验收 | 发布/恢复顺序固定为 protocol → core → tunnel → cli → ui → everywhere；先 next，逐包校验 integrity 与 dsh，再匿名安装和 UI 验收 | 目前只有本地 tarball 与 mock 证据；不能声称新版本已在 npmjs 验收通过 |
| latest 晋级 | 仅稳定版；先检查所有包 integrity/dsh 和现有 latest，拒绝降级，然后逐包晋级并读回 | 不把预发布晋级 latest；部分失败重跑原 tag，不覆盖包版本 |
| GitHub Release | 先 draft、上传且核对全部附件 digest，才公开；重复运行不覆盖异内容资产；正文含安装/校验说明 | 当前无 GitHub Release；`github-release` environment 已创建并仅允许 `v*` tag，最终发布需原 tag 的签名 APK |

此次按“自动完成发布前准备”的授权配置并读回了版本 PR 开关、`npm` 与 `github-release` environments；两者均仅允许 tag `v*`，不允许分支部署，未添加人工 environment reviewer，以保留已约定的自动发布路径。旧 `github-packages` 的独立审批保持原样。配置回执位于忽略目录 `.cache/release-preparation/github-config.json`，不含秘密。

## 当前准备进度

- [x] GitHub 自动版本 PR 权限、三个发布 environments 的 tag 限制核对。
- [x] Android 四个签名 Secrets 与公有指纹读回核对；本地正式证书 APK 验证通过。
- [x] 用户确认 `.signing/android/` 已在仓库之外加密备份，并确认可解密恢复；这是用户确认，未索取备份或密码。
- [x] 用户在 npm 页面自行生成并直接保存 `NPM_TOKEN` 到 GitHub `npm` environment。生成前表单核对为仅 `@brucezhang1993` scope、read/write publish、Bypass 2FA、无组织权限、7 天有效（2026-10-23 到期）；未读取或保存 Token 值。
- [x] 确认计划版本 `0.2.0-rc.1`；配置仍为 `0.2.0-dev.0` / build 2，后续版本 PR 才递增。
- [ ] 功能 PR 的最终提交远端完整 CI 与人工审查；通过后才合入 `master`。首次加入 release-config 不发布。
- [ ] 发布前由用户决定独立 Noise/完整许可证审查、真机/真实模型、私密漏洞收件验收的处理；当前没有豁免或外部审查通过记录。
- [ ] 另行明确启动版本发布；最终 tag、签名 APK、npm 匿名安装与 GitHub Release 是发布执行证据，不能提前勾选。

首发凭据只用于引导。六个包存在后，依次进入各包 Settings → Trusted publishing，按下文配置同一仓库、`release.yml` 和 `npm` environment，允许 publish / dist-tag；配置保存不证明 OIDC 已通过。需在配置有效期内完成后续授权发布验证，再撤销 npm Token 并移除 GitHub 的引导 Secret。不要在尚未验证替代路径前删除唯一发布凭据。

## 首次发布顺序

1. 先审查并提交这批 UI/CI/文档，合并到默认分支；首次加入 release-config 不会发布。
2. 版本 PR 创建权限、`npm` 与 `github-release` environments 已配置并读回。Android 签名已在 `mobile-signing`，不用重新生成或放到仓库级 Secrets；发布前由维护者将 `.signing/android/` 整目录加密备份到仓库之外，并确认可恢复，GitHub Secrets 无法取回私钥。
3. npm 账号与 scope 已核对，首发引导 `NPM_TOKEN` 已存入 `npm` environment。当前公共包尚不可见，不能假定 OIDC 首发已配置；包建立后逐包配置并验证 Trusted Publisher，再撤销引导 token。不要把 token 放入 issue、日志或聊天记录。
4. Trusted Publisher 精确匹配 owner `BruceZhang1993`、repo `dsh-remote-everywhere`、workflow filename `release.yml`、environment `npm`，允许 **publish 与 dist-tag**。新配置需在两天内首次成功发布；参见 [npm 官方要求](https://docs.npmjs.com/trusted-publishers/)。
5. 计划下个版本已选为 `0.2.0-rc.1`；功能 PR 合入且发布前决策完成后，再通过版本流程准备对应 PR。当前版本必须提高、Android build 自动递增；合并版本 PR 会启动发布，不能把这一步当普通准备操作自动执行。
6. 确切 tag 的完整 CI、正式签名、next 发布、匿名 registry 安装、UI、必要的 stable promotion 与 GitHub Release 都通过后，才记录“该版本发布完成”。核对 Release 六个附件、manifest commit/证书/versionCode、npm 的确切版本与 dist-tags，以及真实用户安装。

完整设置、失败重跑与证据边界见 [CI 与版本发布](ci-release.md)。`Re-run failed jobs` 优先复用原次 artifacts；不要重建后强行覆盖已公开的 APK。

## 本轮修正与验证

- README 的 `0.1.0` 渠道改为真实的 GitHub Packages，增加中英文安装入口；badge 只展示远端 master CI/fuzz、MIT 与目标宿主版本。当前 npm/GitHub Release 未存在，不用版本/下载量 badge 表示未发生的分发。
- 独立 [中文](install.md) / [English](install.en.md) 安装指引覆盖 Desktop 官方 registry、next/latest/固定版本、APK/证书/校验和、配对、旧调试包迁移、升级与回滚。发布包的 INSTALL 文件改为这些用户指引，保留本地 UI 文档作为开发验收记录。
- 打 tag 前额外核对 Android build 递增；Release 正文提供确切版本安装指引及 APK 校验命令；打包拒绝 JKS/keystore、签名环境文件及 `.signing` 目录。

本轮在每次 8 GiB 内存 / 4 GiB swap 的 systemd scope 中串行执行，完整本地检查通过：

| 检查 | 结果 |
|---|---|
| frozen lockfile 安装、类型/语法、actionlint 与 shell 语法 | 通过 |
| Node 单测 / 发布故障与重试回归 | 73 / 39 项通过 |
| Dart analyze / 单测 / 向量与自检 | 无诊断，58 项通过，向量与自检通过 |
| Node↔Dart 加密互操作 | 通过，包括密文重放与错误 prologue 拒绝 |
| 双端各 10 秒覆盖率 fuzz / Dart fuzz oracle | Node 5376 次、Dart 959 次；4 项 oracle 通过 |
| npmjs 与 GitHub Packages 候选 | 各六包打包与离线发布校验通过；未写入 registry |
| npm 候选独立消费者 | 禁用安装脚本的 CLI、双端真实 DSH 控制与固定 Playwright 浏览器 UI 通过，控制台错误为 0；模型使用确定性 fixture |
| 生产依赖审计 | 未发现已知漏洞 |
| Flutter analyze / 单测 | 无诊断，19 项通过 |
| 长期正式证书签名的本地 Android APK | universal release APK 69.1 MB；证书、包名、版本、v2 签名与 16 KiB 对齐通过 |
| GitHub Release 六附件 | 离线发布检查通过，`SHA256SUMS` 覆盖的五个文件全部匹配 |
| 文档与分发内容 | 72 个本地链接目标及 4 个在线 SVG badge 通过；12 个候选 tarball 均无签名材料，主插件附带新版中英文安装指引 |

日志为忽略目录中的 `.cache/full-release-preflight.log` 与 `.cache/release-docs-check.json`；本地正式证书候选附件位于 `.cache/mobile-release/`，版本 `0.2.0-dev.0`、versionCode 2，对应当时尚未提交的工作区，**尚未公开发布**。本地 tarball、mock 与正式证书本地 APK 都不能证明 npm OIDC、远端最终提交 CI、正式注册表消费者或真机已验收。

后续发布准备时，实际 tarball 回归发现候选构建脚本的目录变量遮蔽 registry 选择，导致 `publishConfig.registry` 丢失。已修正，并补充同时读取两种渠道全部十二个 tarball 的回归断言；原产物能复现失败，重新打包、两个渠道离线发布检查、类型检查及 **40 项发布回归**全部通过。显式传入 registry 的发布脚本不依赖该缺失字段，但候选包自身也必须保留正确渠道。日志为 `.cache/release-preparation/registry-regression-before.log` / `registry-regression-after.log`。

## 延期项与历史 CI

独立 Noise/供应链及许可证审查、真机、iOS/macOS、真实模型等既有延期项继续保留，见 [M4](m4-summary.md) 与 [历史就绪记录](release-readiness.md)；不能用测试 badge 消除这些边界。

远端 [registry-install-check 失败记录](https://github.com/BruceZhang1993/dsh-remote-everywhere/actions/runs/38697483691) 证实旧 GitHub Packages `0.1.0` 的 registry 缺失 `dsh`，尽管 tarball 含该字段。该失败继续作为真实差异保留，不删除断言让旧发布变绿。最近通过的主 CI 为 [74c271a](https://github.com/BruceZhang1993/dsh-remote-everywhere/actions/runs/38689068341)，每日 fuzz 为 [24287f7](https://github.com/BruceZhang1993/dsh-remote-everywhere/actions/runs/38699390279)；它们不覆盖本工作区新增发布代码。
