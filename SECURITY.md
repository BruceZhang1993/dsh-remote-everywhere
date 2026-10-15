# Security policy / 安全披露策略

The initial `0.1.0` npm publication is authorized for the `next` channel. Local tarballs alone do not prove publication. Independent Noise/supply-chain review, sustained fuzz and deferred platform acceptance remain incomplete; this version does not claim independent security approval. See the publication record in `docs/release-readiness.md`.
Private vulnerability reporting is enabled for this repository as of 2026-10-14. Receipt and maintainer notification have not been verified and remain open follow-up requirements.
The public GitHub repository [BruceZhang1993/dsh-remote-everywhere](https://github.com/BruceZhang1993/dsh-remote-everywhere) has been created. A private reporting form is prepared in `.github/VULNERABILITY_REPORT.yml`; the file alone does not enable reporting. The repository API now confirms it is enabled; maintainers still need to verify receipt and notifications. For a private repository, establish a reachable private maintainer channel instead. See [GitHub configuration](https://docs.github.com/en/code-security/how-tos/report-and-fix-vulnerabilities/configure-vulnerability-reporting/configure-for-a-repository).
Use [Report a vulnerability](https://github.com/BruceZhang1993/dsh-remote-everywhere/security/advisories/new) for private disclosure. If the form is unavailable, use an existing private contact with the maintainer. Do not open a public issue with an exploit or sensitive logs.

Include the package/App version, DSH version, operating system, affected capability, and a minimal reproduction using synthetic data.
Do not send identity keys, pairing QR/sid/SAS, provider credentials, chat text, attachments, or unredacted production traces.
Coordinate disclosure privately after the maintainer can reproduce the issue and prepare a fix. No response-time commitment is made before a reporting channel is operational.

The security boundary is pinned Noise authentication plus explicit device capabilities and human approval.
TLS and tunnels do not replace those checks. Local host compromise, traffic metadata and already-granted capabilities are outside the stated threat model.
See `docs/security.md` and `docs/m4-summary.md` for the model, validation evidence and remaining independent review.

用户已授权 `0.1.0` npm 首发至 `next`。本地 tarball 不证明注册表发布；独立 Noise/供应链审查、持续长期 fuzz 和延期平台验收仍未完成，此版本不宣称获得独立安全认可。发布状态见 `docs/release-readiness.md`。
仓库 Private vulnerability reporting 已于 2026-10-14 启用，API 已核验；实际收件与维护者通知尚未验收，继续保留为后续要求。
公开远程仓库 `BruceZhang1993/dsh-remote-everywhere` 已创建。已准备 `.github/VULNERABILITY_REPORT.yml` 私密报告表单，该文件不会自动开启报告功能；当前已启用，仍需维护者验证收件与通知，私有仓库则需落实可达的私密维护者渠道。
请使用 [Report a vulnerability](https://github.com/BruceZhang1993/dsh-remote-everywhere/security/advisories/new) 私密入口；若无法使用，联系已有私密维护者渠道。不要在公开 issue 中贴利用方法或敏感日志。

报告应包含包/App 版本、DSH 版本、操作系统、受影响能力及使用模拟数据的最小复现。
不要发送身份私钥、配对二维码/sid/SAS、模型凭据、会话正文、附件或未经脱敏的生产 trace。
维护者复现并准备修复后，再私下协商披露安排；有效报告渠道落实前不承诺响应时限。

安全边界为固定公钥 Noise 认证、显式设备能力与人工审批。TLS/隧道不能替代上述检查。
宿主本机已被攻陷、流量元数据及已授予能力的使用不在承诺的防护范围内。
威胁模型、已验证行为和未完成的独立审查见 `docs/security.md` 与 `docs/m4-summary.md`。
