# 下个版本发布链路检查

检查日期：2026-10-16；仓库 `BruceZhang1993/dsh-remote-everywhere`，默认分支 `master`。本报告是此时的配置快照，账号、注册表、remote refs 和检查结果在发布前需刷新。历史 `0.1.0` 授权不代表下个版本已经获得发布授权。

**结论：本地验证通过，GitHub 基础发布配置已补齐，仍不能把整个链路标记为“可直接发布”。** 新 UI 和发布流程待通过 `feature/20261016-pluginUi` 功能 PR 合入 `master`；npm 首发身份尚未补齐，新流程也未在远端最终 tag 上执行。

## 按发布顺序核对

| 环节 | 当前事实 | 发布前动作 |
|---|---|---|
| 源码与版本 | 功能分支基于 `24287f72bacc8cd020f4f723ab4d20696a1ca70f`；release-config 与 mobile 为 `0.2.0-dev.0` / build 2 | 审查功能 PR 及远端 CI；本报告不替代最终 SHA/tag 的 CI |
| 版本 PR | workflow 会同步 npm 与 Android 版本、递增 build；手改 build 不增时拒绝自动打 tag | 已启用 `can_approve_pull_request_reviews=true`，默认 workflow token 仍为 read，各 job 单独声明写权限 |
| tag 与调度 | 首次合并 release-config 不打 tag；后续版本提高才打 tag。默认 token 创建的 tag 用 workflow_dispatch 显式调度 | 版本 PR 合并后核对 tag 指向最终 SHA；不对已有 tag 强推改写 |
| 完整 CI | 类型/单测、Dart/互操作/fuzz、审计、真实宿主 tarball/UI 与实际 mobile 检查均有入口 | 新流程尚无远端运行记录，需验证同次 tag CI 及其产物 |
| Android 正式签名 | 本地长期签名存在且被 Git 忽略，RSA-3072，有效期至 2054；`mobile-signing` 已有 4 Secrets、匹配指纹及仅 `v*` tag 策略 | 正式证书的本地 APK 验证见下文；发布前仍须最终 tag 构建及既定平台验收 |
| npm 首发身份 | 用户已确认 npm 账号为 `brucezhang1993`，浏览器登录可见；六个公共包尚不可见。本机 CLI 未认证，`npm` environment 已创建并仅允许 `v*` tag | 在 npm environment 配置首发引导 Token，首次建包后逐包配置 Trusted Publisher；不将 token 发到聊天或写入源码 |
| npm 写入与验收 | 发布/恢复顺序固定为 protocol → core → tunnel → cli → ui → everywhere；先 next，逐包校验 integrity 与 dsh，再匿名安装和 UI 验收 | 目前只有本地 tarball 与 mock 证据；不能声称新版本已在 npmjs 验收通过 |
| latest 晋级 | 仅稳定版；先检查所有包 integrity/dsh 和现有 latest，拒绝降级，然后逐包晋级并读回 | 不把预发布晋级 latest；部分失败重跑原 tag，不覆盖包版本 |
| GitHub Release | 先 draft、上传且核对全部附件 digest，才公开；重复运行不覆盖异内容资产；正文含安装/校验说明 | 当前无 GitHub Release；`github-release` environment 已创建并仅允许 `v*` tag，最终发布需原 tag 的签名 APK |

此次按“自动完成发布前准备”的授权配置并读回了版本 PR 开关、`npm` 与 `github-release` environments；两者均仅允许 tag `v*`，不允许分支部署，未添加人工 environment reviewer，以保留已约定的自动发布路径。旧 `github-packages` 的独立审批保持原样。配置回执位于忽略目录 `.cache/release-preparation/github-config.json`，不含秘密。

## 首次发布顺序

1. 先审查并提交这批 UI/CI/文档，合并到默认分支；首次加入 release-config 不会发布。
2. 版本 PR 创建权限、`npm` 与 `github-release` environments 已配置并读回。Android 签名已在 `mobile-signing`，不用重新生成或放到仓库级 Secrets；发布前由维护者将 `.signing/android/` 整目录加密备份到仓库之外，并确认可恢复，GitHub Secrets 无法取回私钥。
3. 确认 npm 账号拥有 `@brucezhang1993` scope。当前公共包尚不可见，不能假定 OIDC 首发已配置：可在 `npm` environment 安全设置具有目标六包写权限、满足账户 2FA 策略的 granular `NPM_TOKEN` 做首次引导；包建立后逐包配置 Trusted Publisher，再删除引导 token。不要把 token 放入 issue、日志或聊天记录。
4. Trusted Publisher 精确匹配 owner `BruceZhang1993`、repo `dsh-remote-everywhere`、workflow filename `release.yml`、environment `npm`，允许 **publish 与 dist-tag**。新配置需在两天内首次成功发布；参见 [npm 官方要求](https://docs.npmjs.com/trusted-publishers/)。
5. 选择下个版本并准备版本 PR。当前版本必须提高；本文不预设或修改下个版本。先确保已满足项目保留的审查/延期项决策，再合并启动发布。
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

日志为忽略目录中的 `.cache/full-release-preflight.log` 与 `.cache/release-docs-check.json`；本地正式证书候选附件位于 `.cache/mobile-release/`，版本 `0.2.0-dev.0`、versionCode 2，对应当前未提交工作区，**尚未公开发布**。本地 tarball、mock 与正式证书本地 APK 都不能证明 npm OIDC、远端最终提交 CI、正式注册表消费者或真机已验收。

## 延期项与历史 CI

独立 Noise/供应链及许可证审查、真机、iOS/macOS、真实模型等既有延期项继续保留，见 [M4](m4-summary.md) 与 [历史就绪记录](release-readiness.md)；不能用测试 badge 消除这些边界。

远端 [registry-install-check 失败记录](https://github.com/BruceZhang1993/dsh-remote-everywhere/actions/runs/38697483691) 证实旧 GitHub Packages `0.1.0` 的 registry 缺失 `dsh`，尽管 tarball 含该字段。该失败继续作为真实差异保留，不删除断言让旧发布变绿。最近通过的主 CI 为 [74c271a](https://github.com/BruceZhang1993/dsh-remote-everywhere/actions/runs/38689068341)，每日 fuzz 为 [24287f7](https://github.com/BruceZhang1993/dsh-remote-everywhere/actions/runs/38699390279)；它们不覆盖本工作区新增发布代码。
