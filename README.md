<p align="center">
  <img src="assets/logo/logo-256x256.png" width="160" alt="lnwjud logo" />
</p>

<h1 align="center">lnwjud</h1>

<p align="center">
  <strong>Cross-platform local AI-agent runtime and MCP gateway</strong><br />
  <em>276 total tool definitions for local files, Git, processes, Windows automation, WSL, browser control, durable goal continuation, native Goal automation, context capsules, indexing, observability, Office semantic automation, ECC integration, and extensibility; 264 are advertised by default and all 276 when Codex delegation plus Agent Swarm is enabled.</em>
</p>

<p align="center">
  <em>อ่านที่เหลือใน Readme ได้เลยครับ ติดปัญหาทักมาได้ใน <a href="https://url.in.th/rEZiG"><strong>Line</strong></a> ได้ตลอดครับ / กำลังพัฒนาให้เรื่อยๆครับ ท่านที่ถามหาช่องสนับสนุนค่ากาแฟ แปะลิงก์ไว้ให้แล้วครับ ขอบคุณครับ — <a href="https://easydonate.app/abcz"><strong>Donate</strong></a></em>
</p>

<p align="center">
  <a href="https://github.com/engasnm111/lnwjud/releases/latest"><img alt="GitHub Release" src="https://img.shields.io/github/v/release/engasnm111/lnwjud" /></a>
  <a href="LICENSE"><img alt="License" src="https://img.shields.io/badge/license-MIT-blue.svg" /></a>
  <img alt="Platform" src="https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-0078D4" />
  <img alt="Node" src="https://img.shields.io/badge/Node.js-24.x-339933" />
  <img alt="MCP" src="https://img.shields.io/badge/MCP-276%20tools-6f42c1" />
</p>

<h2 align="center">Download lnwjud</h2>
<p align="center">Choose your platform and download the current v5.4.3 release directly.</p>

<table align="center">
  <tr>
    <td align="center" width="33%">
      <a href="https://github.com/engasnm111/lnwjud/releases/latest/download/lnwjud-Setup-5.4.3.exe">
        <img src="assets/download/download-windows.svg" width="300" alt="Download lnwjud for Windows" />
      </a><br />
      <sub><a href="https://github.com/engasnm111/lnwjud/releases/latest/download/lnwjud-Portable-5.4.3.exe">Portable x64</a></sub>
    </td>
    <td align="center" width="33%">
      <a href="https://github.com/engasnm111/lnwjud/releases/latest/download/lnwjud-5.4.3-arm64.dmg">
        <img src="assets/download/download-macos.svg" width="300" alt="Download lnwjud for macOS" />
      </a><br />
      <sub><a href="https://github.com/engasnm111/lnwjud/releases/latest/download/lnwjud-5.4.3-x64.dmg">Intel x64 DMG</a> · <a href="docs/INSTALL_MACOS.md">Install guide</a></sub>
    </td>
    <td align="center" width="33%">
      <a href="https://github.com/engasnm111/lnwjud/releases/latest/download/lnwjud-5.4.3-x64.deb">
        <img src="assets/download/download-linux.svg" width="300" alt="Download lnwjud for Linux" />
      </a><br />
      <sub><a href="https://github.com/engasnm111/lnwjud/releases/latest/download/lnwjud-5.4.3-x64.AppImage">x64 AppImage</a> · <a href="docs/INSTALL_LINUX.md">Other architectures</a></sub>
    </td>
  </tr>
</table>

<p align="center"><a href="https://github.com/engasnm111/lnwjud/releases/latest"><strong>View all release files →</strong></a></p>

---

## Current published version: v5.4.3

## Current source version: v5.5.0

Latest published release: **v5.4.3**. The download buttons above point directly to the published v5.4.3 assets. The release is built from the verified v5.4.3 source line and published only after the exact tagged main commit passes the target-native release gates.

### v5.5.0 source candidate on `dev`

v5.5.0 is being prepared as one additive release without changing the currently published v5.4.3 download links until a real release is tagged.

- **Office Suite semantic runtime:** adds truthful Word, Excel, PowerPoint, Outlook, Calendar, Contacts and Tasks surfaces while preserving legacy Office tools. Windows COM actions are advertised only when implemented; macOS/Linux local parity, Microsoft Graph, Access/Visio/Project/Publisher and other optional providers remain not-ready when no verified provider exists. See [Office Suite v5.5.0](docs/OFFICE_SUITE.md).
- **Office safety and real-provider acceptance:** Office mutations stay inside Active Project, permission, recovery and dangerous-action confirmation boundaries. Macros remain disabled/unsupported and sending remains confirmation-gated. The Windows acceptance harness exercises synthetic Word/Excel/PowerPoint files with bounded per-action timeouts; Outlook proceeds into bounded read/draft checks only when its COM status probe proves ready, otherwise readiness is reported as degraded instead of being faked.
- **What's New:** a separate focusable `?` button beside the title-bar version opens bundled Thai/English release notes for the exact installed version without replacing the existing update/check/install button. See [What's New maintenance](docs/development/WHATS_NEW.md).
- **Scheduled continuation hardening:** scheduled wakes bind back to the connected lnwjud connector and claim the durable goal before user-visible prose or workspace mutation; ordinary recurring wakes reuse the same task and stale-worker recovery happens within the firing when safe.
- **Search/edit recovery hardening:** `search_text` now treats the query as a literal fixed string by default and enables ripgrep regex syntax only with explicit `regex: true`. `edit_file` keeps exact-match safety but returns recoverable conflict metadata, CRLF/LF or whitespace mismatch hints, bounded candidate context, and a re-read/retry action instead of a dead-end non-recoverable error.
- **More Remote MCP transport choices:** ngrok remains the default/backward-compatible transport. Cloudflare and Custom URL are opt-in externally managed HTTPS reverse-proxy modes, and Local MCP can run without ngrok or public OAuth. Existing OAuth, OpenAI Secure MCP Tunnel, API-key tunnel and Persistent Tunnel Runtime flows remain separate and supported.
- **Remote MCP persistence/recovery:** pending Dynamic Client Registration survives Desktop restart, v1/v2 saved state migrates to v3 without losing existing trusted clients/refresh grants, and stale ngrok cleanup is restricted to processes proven to be lnwjud-owned.

### What's new in v5.4.3

- **Remote MCP public OAuth boundary hardened:** unauthenticated dynamic registrations and transient OAuth state are bounded, expired state is pruned, and first-use ChatGPT-compatible OAuth clients require an explicit local approval instead of treating redirect-URI shape as identity.
- **Release supply chain is immutable:** privileged third-party GitHub Actions used for release publication and cosign setup are pinned to full commit SHAs, with a repository hygiene regression preventing mutable third-party action tags from returning.
- **PDF archive extraction is containment-safe:** the vulnerable production `extract-zip@2.0.1` path is removed. Archive validation rejects path traversal, absolute paths, symlink/special-file entries, encrypted entries, and duplicate/colliding names before extraction; `pnpm audit --prod` is clean.
- **Electron native ZIP binding is packaged explicitly:** the Desktop build stages the target-specific `@electron-internal/extract-zip` N-API binding beside the bundled main process and unpacks `.node` files from ASAR, preventing the startup `Cannot find native binding` crash on packaged Windows while preserving macOS/Linux target selection.
- **Multi-file mutations are all-or-rollback:** `apply_patch` and checkpoint restore automatically restore earlier writes when a later write or cancellation fails, and report explicit rollback failure details instead of silently leaving a mixed tree.
- **Workspace writes revalidate at publication time:** guarded writes detect symlink/junction/path swaps between initial validation and the final atomic rename, strengthening the workspace boundary against TOCTOU races.
- **Dashboard idle work is reduced:** the full dashboard snapshot no longer rebuilds every 2 seconds. A 30-second reconciliation fallback is combined with focus/visibility wakeups and immediate refresh after explicit user actions.
- **Durable checkpoints now carry reconstruction-grade resume state:** milestone checkpoints can atomically persist changed files, exact command outcomes, decisions, failed attempts, pending validation, resume prerequisites, state facts, and artifacts. `session_handoff` prefers this checkpoint resume context before Git diff or legacy trackers and surfaces acceptance/checkpoint evidence plus tracked task IDs so a new worker can continue without guessing.
- **Roadmap drafts stay out of product commits:** `docs/roadmap/` is ignored for new draft plans; historical tracked roadmap documents remain historical Git content.

### Historical: What's new in v5.4.2

- **Remote MCP survives Local MCP listener rebinding and transient listener loss:** every authorized `/mcp` request now ensures the Desktop MCP listener is available before proxying, so a stopped/rebinding automatic-port listener is recovered and the live URL is used instead of returning an avoidable transport failure. If the listener cannot be started, the gateway returns an explicit `503 local_mcp_unavailable` response.
- **Remote MCP reconnect and startup are race-safe:** unexpected owned ngrok exits schedule bounded automatic reconnects with exponential backoff capped at 30 seconds. Manual Stop, Desktop shutdown, and OAuth reset cancel pending retries, while concurrent manual/automatic starts share one in-flight start operation so duplicate gateways/ngrok children are not spawned.
- **ChatGPT host failures are diagnosed at the correct boundary:** Settings now explains that “conversation does not support developer MCPs” / missing plugin-tool states can be rejected by ChatGPT before a request reaches lnwjud, instead of presenting them as Windows filesystem-permission failures.
- **Search and audit diagnostics are more reliable:** `search_text` accepts a specific file path without using the file as ripgrep's working directory; access-denied ripgrep failures map to recoverable `PERMISSION_DENIED`, malformed regex/glob input remains `INVALID_INPUT`, and unexpected exceptions persist redacted diagnostic detail while the external MCP response stays generic.
- **Persistent tunnel first-run/runtime intent is preserved:** first-time profile configuration no longer conflicts with an already-running persistent tunnel runtime, and configure/reconfigure flows preserve the saved stopped/running intent instead of silently changing the operator's desired state.
- **Durable shell completion resists PID reuse and finalization races:** process identity reconciliation distinguishes a reused PID from the original worker, gives worker-owned terminal metadata a bounded finalization grace, and avoids overwriting a completed result with stale `termination_unverified` metadata while keeping cancellation/kill identity checks strict.
- **Windows-heavy application tests are serialized without loosening timeouts:** the application package disables Vitest file-level parallelism for filesystem/process/SQLite-heavy suites, eliminating runner contention while keeping existing per-test timeout limits unchanged.
- **Issue #114 fixed — Windows PowerShell 5.1 native input compatibility:** `type_text` / `paste_text` enumerate text with `ToCharArray()` instead of attempting to cast a multi-character string to one `[char]`; hotkey modifier release no longer uses unsupported `Select-Object -Reverse`, and pressed modifiers are released in reverse order from a `finally` block.
- **Release accounting:** v5.4.2 is a hardening release following v5.4.1 and includes the Issue #114 Windows native-bridge compatibility fix. Issue #104 remains the v5.4.1 closure.

### Historical: What's new in v5.4.1

- **Issue #104 fixed — Windows MCP localhost/tunnel/update hardening:** loopback HTTP handling was hardened for Windows `localhost`/IPv6 behavior, reverse-proxy/tunnel Host validation can use explicitly configured external hostnames instead of requiring ad-hoc Host rewrites, and the Windows updater/installer path was hardened against the silent old-uninstaller stall reported in v5.3.1.
- **Automatic local MCP ports by default:** ordinary users no longer need to choose or understand a fixed MCP port during setup. lnwjud selects a free local port automatically to avoid collisions, while an advanced/manual port override remains available for users who need a fixed value.
- **Browser tools start only when needed:** managed browser/CDP readiness now follows lazy startup instead of opening Chrome during normal app startup. Browser navigation stays available when requested without making an unused browser dependency block the rest of lnwjud.
- **Concurrent browser startup is cancellation-safe:** multiple callers still share one browser launch, but cancellation from one caller no longer cancels the shared startup for another caller that is still waiting.
- **Global install/update progress lock:** application updates, ngrok installation, and the PDF Provider installation now publish one shared install-activity state to Desktop. While an install/update is active, the UI is blocked by a progress modal with phase/status feedback so users do not mistake a real installation for a frozen app or click conflicting actions mid-install.
- **Cleaner application/storage architecture:** automation and Agent Swarm application services now depend on domain-facing repository contracts instead of importing storage adapters directly, reducing cross-layer coupling and making maintenance/testing boundaries clearer.
- **Desktop CI builds the real CLI dependency closure:** release verification now builds the dependencies required by the packaged CLI/Desktop path instead of relying on ambient or previously built output.
- **Transient native-package downloads are retried safely:** target-native packaging retries `electron-builder` only for recognized transient network failures such as connection resets, timeouts, DNS failures, and socket interruptions. Deterministic packaging errors still fail immediately, so CI resilience does not hide real release defects.
- **Windows release tests are stabilized without relaxing timeouts:** the `@lnwjud/mcp-server` test files run serially in the release gate to avoid Windows filesystem contention. The default 5-second test timeout remains unchanged; the previously flaky ECC/runtime-state tests complete normally when not starved by parallel file I/O.
- **Chat execution routing is connector-name agnostic:** when the connected lnwjud MCP server exposes the required coding, repository, filesystem, shell, build, test, Git, CI, browser, or local-computer capability, the MCP instructions tell the assistant to use those tools directly in the current conversation instead of suggesting a switch to ChatGPT Work/Codex solely because of task type. The rule is generic and does not depend on a user-specific connector instance name such as `lnwjud_o`.
- **Published from verified cross-platform evidence:** final main CI `35584627254` passed on commit `e8d26d45953dd13a77559ab0303ad7b7ee022653`, including Windows authoritative release verification, macOS x64/arm64 and Linux x64/arm64 native package verification, packaged Electron smoke tests, and macOS 26 compatibility checks. Release workflow `35586799494` then re-verified the exact artifacts/provenance and published the v5.4.1 GitHub Release.
- **Closed in this release:** [Issue #104](https://github.com/engasnm111/lnwjud/issues/104). No other GitHub issue is being claimed as closed specifically by the v5.4.1 cycle; the remaining v5.4.1 work is hardening/refactoring found during review and release preparation.

### What's new in v5.4.0

- **Crash-safe native Goal automation:** v5.4.0 adds persisted automation runs, milestone dispatch/verification, Goal-owned lifecycle control, scheduled resume, exact durable-shell recovery, and cross-restart reconciliation.
- **Issue #100 fixed:** durable shell task history no longer grows linearly with historical background-task records; active-task indexing and bounded history reads keep long-lived installations responsive.
- **Automation safety hardening:** finalize/cancel operations recover cleanly across partial persistence failures, `automation_finalize` now uses destructive confirmation semantics, paused runs are not advertised as resumable work, and Windows verbatim-argument mode is part of immutable dispatch identity.
- **Verified cross-platform release pipeline:** Windows x64, macOS arm64/x64, and Linux arm64/x64 packages are published only from the exact successful main CI commit with per-target provenance, aggregate manifest, and SHA-256 evidence.
- **Settings cleanup:** the Factory Reset action spacing/layout cleanup is included in the published desktop build.

### Historical: What's new in v5.3.1

- **Issue #98 fixed:** `dom_cdp.navigate` now decodes the real `Page.navigate` response shape and always returns structured navigation acknowledgement instead of succeeding in Chrome but failing MCP output validation.
- **Persistent logs and readable session history:** Desktop keeps prior Work Log/Live Log sessions across restarts, uses human-readable session timestamps, and shows project name + path in workspace filters.
- **Safer reset and setup flow:** Factory Reset clears lnwjud state without deleting unrelated tunnel-client profiles, then returns to the first-run setup guide. The guide now calls out ChatGPT Plugin Developer mode and the Settings connection cards link directly to the relevant ChatGPT/tunnel/API-key setup pages.
- **Input and log UX fixes:** text inputs no longer lose focus after each character, clearing Work Log also removes already-loaded historical entries, and startup log replay drains the bounded history immediately instead of taking tens of seconds to catch up.
- **Lower dashboard cost:** activity-session history is loaded once and updated incrementally instead of rescanning/aggregating the full audit table every 2-second dashboard refresh.
- **Shared skill routing and runtime cleanup:** skill selection is centralized, Serena/skill preflight behavior is more consistent, and the 5.3.1 runtime keeps the lifecycle and crash-diagnostic hardening from 5.3.0.
- **CI/runtime maintenance:** GitHub Actions use the current Node 24-capable action runtimes, and the optional Dev Windows Installer workflow is manual-only so ordinary `dev` pushes do not build installers in GitHub Actions.

### Historical: What's new in v5.3.0

- **Issue #94 RAM leak fixed:** successful modern MCP requests now tear down their per-request `McpServer` lifecycle, unsubscribe `toolAvailabilityService` listeners, and release retained tool registries/schemas; pagination continuations are also bounded as secondary hardening.
- **Crash evidence survives hard exits:** Desktop session heartbeats distinguish clean shutdown from abrupt termination. A recent unclean previous session is reported after restart only when stronger current failure evidence is absent. Local-only Crashpad evidence adds bounded crash-dump metadata plus per-process memory diagnostics, while a bounded 6-hour runtime trend samples memory, Electron process groups, CPU/event-loop pressure, active Node resources, retained log-buffer/dedupe counters, MCP activity/errors, and tool-availability listener counts once per minute.
- **Electron 45 crash diagnostics:** Desktop v5.3.0 targets Electron `45.0.0-alpha.7` so the packaged Windows runtime includes `electron_wer.dll` in addition to local-only Crashpad/session diagnostics. Crash reports stay local and bounded; no automatic crash upload is enabled.

### Historical: What's new in v5.2.1

- **Responsive Git summaries:** untracked directories stay collapsed, and dashboard refresh no longer reads every untracked file to count lines.
- **Bounded filesystem scans:** backup and portable-scheduler discovery no longer starts an unbounded batch of file reads.
- **Generated artifacts stay out of Git and automatic context:** `artifacts/` now follows the existing generated-directory ignore policy.

### Historical: What's new in v5.2.0

- **Remote MCP reliability:** fixed ngrok restart failures and made Static/Custom Domain handling explicit and stable.
- **Better incident diagnostics:** crash and lifecycle evidence now survives app restarts, making previous failures easier to investigate.
- **Lower idle CPU and more reliable cleanup:** fixed an External MCP idle-sweeper race that could suppress later cleanup passes and leave sessions running.

## Install

### Windows 10 / 11

1. Open [GitHub Releases](https://github.com/engasnm111/lnwjud/releases/latest).
2. Download `lnwjud-Setup-<version>.exe` for the normal installer, or `lnwjud-Portable-<version>.exe` if you prefer a portable executable.
3. Launch lnwjud, add the project/workspace you want to use, then configure the MCP connection method you need.

Community Windows artifacts may be unsigned when production code-signing credentials are not configured. Release verification still checks the declared signing mode, SHA-256 manifests, runtime provenance, and packaged-app smoke evidence; verify the release assets if Windows shows an unknown-publisher warning.

Windows-only features such as WSL, Registry, Windows Sandbox, Windows OCR and Outlook/COM remain available only where the Windows provider is supported.

### macOS 13+

Download the artifact that matches the Mac architecture (`arm64` for Apple silicon or `x64` for Intel). Do not swap architectures just because both filenames contain the word “Mac”. Computers remain unusually literal about this.

See [Install lnwjud on macOS](docs/INSTALL_MACOS.md) for DMG/ZIP installation, permissions, MCP launcher paths, Gatekeeper/signing expectations, and troubleshooting.

### Linux

Choose the release artifact that matches the Linux architecture and package type. Ubuntu 24.04 LTS x64 is the primary Linux release target; arm64 remains architecture-specific and evidence-gated.

See [Install lnwjud on Linux](docs/INSTALL_LINUX.md) for AppImage/DEB installation, Wayland/X11 behavior, secure storage, MCP, and platform limits.

### Local data vs workspace metadata

Installed lnwjud keeps per-user runtime data outside your source repository: `%APPDATA%\lnwjud` on Windows, `~/Library/Application Support/lnwjud` on macOS, and `$XDG_DATA_HOME/lnwjud` (or `~/.local/share/lnwjud`) on Linux unless `LNWJUD_DATA_PATH` is explicitly set. A workspace may contain `.lnwjud/project-profile.json` for project-scoped policy such as Ponytail mode; `.lnwjud/` is local metadata and is ignored by this repository.

## What can lnwjud do?

lnwjud exposes **259 tool definitions** through one local runtime and MCP gateway. The default advertised set is 247; all 259 are available when Codex delegation plus Agent Swarm is enabled.

| Area | Examples |
| --- | --- |
| Workspace & files | read/search/edit files, paging, full scans, project indexing, recovery trash |
| Git | status, diff, history, blame, guarded Git mutations |
| Processes | shell, managed processes, durable background tasks, Goal-owned native automation, logs, cancellation |
| MCP | local HTTP/stdio MCP, External MCP discovery/describe/call, live tool availability |
| Development | test, lint, typecheck, build, affected-test context, Codex integration |
| Browser | managed Chrome/CDP, DOM inspection, Set-of-Marks, screenshots |
| Recovery | backups, checkpoints, restore, crash/session recovery, durable-goal state |
| Observability | Work Log, Live Logs, Doctor, incident reports, trace/audit metadata |
| Native capabilities | UI/input/media/Office/scheduler providers when the current OS supports them |
| Windows-specific | WSL, Registry, Windows Sandbox, Windows Event Log/OCR, Outlook/COM |

For the complete generated catalog, see [MCP Tool Catalog](docs/mcp/MCP_TOOL_CATALOG.md). For the broader capability explanation, see [lnwjud capabilities](docs/LNWJUD_CAPABILITIES.md).

## Platform compatibility

lnwjud composes providers for the detected host instead of instantiating a Windows provider everywhere and hoping for the best.

| Feature | Windows | macOS | Linux |
| --- | --- | --- | --- |
| Core MCP / files / Git / processes | ✅ | ✅ | ✅ |
| External MCP | ✅ | ✅ | ✅ |
| OpenAI Secure MCP Tunnel client | target-native | target-native | target-native |
| Remote MCP with ngrok | ✅ | ✅ | ✅ |
| Managed browser / CDP | dependency-gated | dependency-gated | dependency-gated |
| Native PDF text provider | dependency-gated | dependency-gated | dependency-gated |
| Automatic Poppler install | Windows x64 | hidden | hidden |
| WSL / Registry / Windows Sandbox | ✅ | unsupported | unsupported |
| Outlook COM | ✅ | unsupported | unsupported |

The authoritative matrix is [Native platform support contract](docs/architecture/PLATFORM_SUPPORT.md).

## MCP connection choices

- **Local MCP:** use the packaged stdio launcher or Desktop loopback MCP endpoint directly. The Local transport starts the local listener without ngrok, a public URL, or Remote MCP OAuth.
- **Remote MCP via ngrok + OAuth:** remains the default/backward-compatible Remote MCP transport. lnwjud owns the protected loopback OAuth gateway and ngrok child runtime.
- **Remote MCP via Cloudflare:** opt-in for a Cloudflare Tunnel/reverse proxy that you manage. lnwjud provides a stable local OAuth-gateway target and verifies the configured public HTTPS origin; it does not claim to create or manage the Cloudflare tunnel.
- **Remote MCP via Custom URL:** opt-in for another externally managed HTTPS reverse proxy. No ngrok token/install is required; the public origin must route to the stable local protected gateway.
- **OpenAI Secure MCP Tunnel:** separate outbound-only OpenAI tunnel path using the verified target-native bundled `tunnel-client`. One lnwjud tunnel endpoint is intended to serve multiple simultaneous ChatGPT chats/workspaces; do not create one tunnel/profile per chat. v4.62.0 explicitly gives the tunnel transport 32 active MCP-request slots so normal multi-chat tool fan-out does not hit tunnel-client's lower default ceiling. If several physical lnwjud hosts (for example Mac + Windows) must be independently selectable, give each host a distinct Tunnel ID/ChatGPT connection: HTTP replicas sharing one Tunnel ID are work-sharing replicas, so a request goes to whichever replica polls it first rather than to a chat-selected host.
- **External MCP servers:** lnwjud can discover supported Cursor/Claude Desktop/custom MCP definitions and keep child MCP servers separate from the first-party catalog.

See the [Thai usage guide](docs/USAGE_TH.md) and [full expanded README](FULL_README.md) for the long-form setup and architecture notes.

## Durable goals + scheduled continuation / Goal แบบทำงานต่อเนื่อง

lnwjud can keep long-running work alive across chat turns with a **durable goal** plus the bundled `lnwjud-scheduled-continuation` skill. The intended model is simple: one stable goal, one recurring Native ChatGPT Scheduled Task, periodic checkpoints, and an explicit finish only when the work is genuinely complete.

lnwjud สามารถทำงานยาวข้ามหลายรอบแชทได้ด้วย **durable goal** ร่วมกับสกิล `lnwjud-scheduled-continuation` แนวทางที่ควรใช้คือ: 1 งาน = 1 goal ที่ใช้ `goalKey` เดิม, มี Native ChatGPT Scheduled Task แบบ recurring เพียง 1 ตัว, บันทึก checkpoint ระหว่างทาง และปิด goal เมื่อทุกอย่างเสร็จจริงเท่านั้น

The scheduled continuation should be a **Native ChatGPT Scheduled Task running in cloud mode every 1 hour**. It is a watchdog that wakes the workflow back up; the durable goal remains the source of truth for plan state, progress, blockers, evidence, and tracked background tasks. Do not create a new goal or timer on every wake.

ตัว Scheduled Task ควรเป็น **Native ChatGPT Scheduled Task ที่รันบน cloud ทุก 1 ชั่วโมง** มีหน้าที่ปลุกงานกลับมาทำต่อเท่านั้น ส่วนสถานะจริงของงานให้ยึด durable goal เป็นหลัก ห้ามสร้าง goal ใหม่หรือตัวตั้งเวลาใหม่ทุกครั้งที่ถูกปลุก

### Recommended prompt — English

```text
@lnwjud

Workspace:
C:\path\to\my-project

Continue this task until it is genuinely complete. Do not stop only because the current chat turn ends.

- Use the lnwjud-scheduled-continuation skill.
- Create or resume the same durable goal using one stable goalKey. Never create duplicate goals for the same job.
- Create exactly one recurring Native ChatGPT Scheduled Task, run it in cloud mode every 1 hour, and reuse that same scheduled continuation for this goal.
- Checkpoint the goal after every meaningful milestone. Persist the current phase, step status, next action, blockers, evidence, and any background tasks that are still running.
- When the scheduled task wakes the workflow, claim the continuation for the same goal and resume from the latest checkpoint instead of starting over.
- If CI, build, test, deployment, or another process is still running, keep tracking the same task until its terminal result is known, then record that result in the checkpoint.
- Do not finish the goal while any planned step, blocker, or blocking task remains unresolved.
- When the work is truly complete, cancel the scheduled continuation, make the exact Native ChatGPT Scheduled Task non-runnable, then call finish_goal with the final status and evidence.
```

### Prompt แนะนำ — ภาษาไทย

```text
@lnwjud

Workspace:
C:\path\to\my-project

ทำงานนี้ต่อเนื่องจนเสร็จจริง ห้ามหยุดกลางทางเพียงเพราะแชทจบรอบ

- ใช้สกิล lnwjud-scheduled-continuation
- สร้างหรือ resume durable goal เดิมด้วย goalKey ที่คงที่ ห้ามสร้าง goal ซ้ำสำหรับงานเดียวกัน
- สร้าง Native ChatGPT Scheduled Task แบบ recurring เพียง 1 ตัว ให้รันบน cloud ทุก 1 ชั่วโมง และใช้ scheduled continuation ตัวเดิมกับ goal นี้ไปตลอด
- หลังจบ milestone สำคัญทุกครั้ง ให้ checkpoint goal โดยบันทึก current phase, step status, next action, blockers, evidence และ background task ที่ยังรันอยู่
- เมื่อ scheduled task ปลุกขึ้นมา ให้ claim continuation ของ goal เดิม แล้วทำงานต่อจาก checkpoint ล่าสุด ห้ามเริ่มงานใหม่ตั้งแต่ต้น
- หากมี CI, build, test, deploy หรือ process ที่ยังรันอยู่ ให้ติดตาม task เดิมจนได้ terminal result แล้วบันทึกผลลง checkpoint
- ห้าม finish goal หากยังมี step ที่ไม่เสร็จ, blocker ที่ยังไม่เคลียร์ หรือ blocking task ที่ยังทำงานอยู่
- เมื่อทุกอย่างเสร็จจริง ให้ cancel scheduled continuation, ทำให้ Native ChatGPT Scheduled Task ตัวเดิมไม่สามารถรันต่อได้ แล้วค่อย finish_goal พร้อม final status และ evidence
```

### Goal lifecycle / วงจรของ Goal

1. **Start / resume — `run_goal`**
   - English: Use one stable `goalKey`; resume the existing goal instead of creating a duplicate.
   - ไทย: ใช้ `goalKey` เดิมสำหรับงานเดียวกัน ถ้ามี goal อยู่แล้วให้ resume ห้ามสร้างซ้ำ

2. **Checkpoint — `checkpoint_goal`**
   - English: Save meaningful progress: current phase, completed/pending steps, next action, blockers, evidence, and tracked background tasks. A checkpoint records progress; it is **not** an instruction to stop working.
   - ไทย: บันทึกความคืบหน้าที่สำคัญ เช่น phase, step ที่เสร็จ/ค้าง, งานถัดไป, blocker, evidence และ task ที่กำลังรันอยู่ การ checkpoint คือการเซฟสถานะ ไม่ใช่การสั่งให้หยุดงาน

3. **Prepare + wake — `prepare_scheduled_continuation` / `claim_scheduled_continuation`**
   - English: Keep exactly one hourly Native ChatGPT recurring task for the goal. Every wake resumes the same durable goal from its latest checkpoint.
   - ไทย: ให้มี scheduled task แบบรายชั่วโมงเพียง 1 ตัวต่อ goal และทุกครั้งที่ถูกปลุกให้กลับมาทำ goal เดิมต่อจาก checkpoint ล่าสุด

4. **Stop watchdog — `cancel_scheduled_continuation`**
   - English: Once the goal is genuinely terminal, make the exact recurring Native ChatGPT task non-runnable so a completed job is not awakened again.
   - ไทย: เมื่องานจบจริง ให้ปิด scheduled continuation และทำให้ task ตัวเดิมรันต่อไม่ได้ เพื่อไม่ให้ปลุกงานที่เสร็จแล้วขึ้นมาอีก

5. **Finish — `finish_goal`**
   - English: Finish only after all planned steps are complete, blockers are cleared, blocking tasks are terminal, acceptance criteria are satisfied, and scheduled continuation cleanup is complete. Record final evidence instead of merely declaring success in chat.
   - ไทย: ปิด goal หลังจากทุก step เสร็จ, blocker ถูกเคลียร์, blocking task จบแล้ว, acceptance criteria ผ่านครบ และ cleanup ตัวตั้งเวลาเรียบร้อย พร้อมบันทึกหลักฐานสุดท้าย

### v5 Goal state / สถานะ Goal ใน v5

- **Plan:** `get_goal_plan` projects the authoritative plan; `update_goal_plan` changes that same durable plan instead of creating a second planner.
- **Acceptance:** `update_goal_acceptance` records explicit completion evidence. `finish_goal(status=completed)` is rejected while any criterion is still pending or blocked.
- **Newest intent wins:** `revise_goal_intent` increments `userIntentRevision`; stale checkpoints or delivery receipts from older accepted user intent are fenced/retired rather than replayed.
- **Context Capsule:** `create_context_capsule` stores a bounded immutable objective/decision/result summary for compact/resume or handoff. It stores task state, not private chain-of-thought, and does not drive ChatGPT through browser/DOM automation.
- **Pressure + iteration:** `context_pressure` reports a local estimate when exact provider usage is unavailable, while `advance_goal_iteration` is explicitly bounded by `maxIterations` and can stop when no new evidence appears.

ภาษาไทยแบบสั้น: v5 แยก **plan / acceptance / user intent / context capsule / bounded iteration** ออกจากกันชัดเจน โดย Durable Goal ยังเป็น source of truth เพียงชุดเดียว ถ้าผู้ใช้เปลี่ยนคำสั่งใหม่ งานเก่าต้องแพ้ revision ใหม่ และ Context Capsule ใช้เก็บสรุปสถานะเพื่อกลับมาทำต่อ ไม่ใช่เก็บ chain-of-thought หรือใช้ browser ไปสร้างแชทใหม่เอง

### Short prompt — English

```text
Use lnwjud-scheduled-continuation. Create or resume one durable goal for this job, keep exactly one Native ChatGPT Scheduled Task running in cloud mode every 1 hour, and resume from the latest checkpoint until the goal is genuinely complete. Checkpoint every meaningful milestone, never duplicate the goal or timer, and when all steps are complete with no blockers or blocking tasks left, cancel the scheduled continuation first and then finish_goal with final evidence.
```

### Prompt แบบสั้น — ภาษาไทย

```text
ใช้สกิล lnwjud-scheduled-continuation สร้างหรือ resume durable goal เดิมสำหรับงานนี้ และสร้าง Native ChatGPT Scheduled Task บน cloud แบบ recurring ทุก 1 ชั่วโมงเพียง 1 ตัว เพื่อกลับมาทำงานต่อจาก checkpoint ล่าสุดจน goal เสร็จจริง ระหว่างทางให้ checkpoint ทุก milestone สำคัญ ห้ามสร้าง goal หรือตัวตั้งเวลาซ้ำ และเมื่อทุก step เสร็จ ไม่มี blocker หรือ blocking task ค้าง ให้ปิด scheduled continuation ก่อน แล้ว finish_goal พร้อมหลักฐานสุดท้าย
```

This pattern is especially useful for long CI/release jobs, multi-stage refactors, deployments, packaging, migrations, or any task where “continue later” should be backed by durable state rather than wishful thinking.

รูปแบบนี้เหมาะกับงาน CI/Release ที่ใช้เวลานาน, refactor หลายขั้น, deploy, packaging, migration หรืองานใดก็ตามที่ต้องทำต่อหลายรอบ เพราะคำว่า “เดี๋ยวมาทำต่อ” ถ้าไม่มี state เก็บไว้ก็เป็นระบบ persistence ที่น่าเชื่อถือพอ ๆ กับกระดาษโน้ตที่ติดหน้าพัดลม

## Documentation

- [Full expanded README / historical detail](FULL_README.md)
- [คู่มือใช้งานภาษาไทย](docs/USAGE_TH.md)
- [macOS installation](docs/INSTALL_MACOS.md)
- [Linux installation](docs/INSTALL_LINUX.md)
- [Platform support matrix](docs/architecture/PLATFORM_SUPPORT.md)
- [Complete capabilities](docs/LNWJUD_CAPABILITIES.md)
- [MCP Tool Catalog](docs/mcp/MCP_TOOL_CATALOG.md)
- [Tool contract](docs/architecture/TOOL_CONTRACT.md)
- [Release process](docs/development/RELEASE_PROCESS.md)
- [Security](SECURITY.md)
- [Contributing](CONTRIBUTING.md)

## Security boundary

lnwjud is intentionally powerful because it operates on the local machine. Tool availability does **not** bypass Active Project scope, permission policy, mutation approval, recovery, host OS permissions, or platform capability gates. Unknown/unsupported platforms and missing native providers should fail closed rather than silently substituting a different OS implementation.

## Community

ติดปัญหา อยากแชร์วิธีใช้ หรือเจอบัค สามารถเข้ากลุ่มพูดคุยได้ที่ [Line](https://url.in.th/rEZiG).

## License

[MIT](LICENSE)
