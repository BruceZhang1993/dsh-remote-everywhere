---
name: remote-control
description: Control an explicitly paired DSH instance and follow real sessions with human approvals.
---

Use `remote_devices` to identify the exact target selected by the user. Do not infer a target or pair an unknown device.
Use `remote_call` for session list/search/create/fork/rename/cancel/queue operations and authorized file reads.
Use `remote_operation` for an exact workspace text write or bounded terminal command; a human must approve each operation.
Use `remote_run` to send a prompt and follow a bounded output window. Preserve its requestId when retrying the same prompt.
Approvals and questions must be presented to the human by the host interaction services. Never call approval.decide to approve on the human's behalf.
If the output window is truncated, explain that the target may still be running. Do not resend the prompt as a way to fetch output.
Remote-driven sessions may not initiate another remote-control hop. Use a local user-controlled session to avoid control cycles.
