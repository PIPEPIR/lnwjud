<p align="center">
  <img src="assets/logo/logo-256x256.png" width="160" alt="lnwjud logo" />
</p>

<h1 align="center">lnwjud</h1>

<p align="center">
  <strong>Cross-platform local AI-agent runtime and MCP gateway</strong><br />
  <em>253 total tool definitions for local files, Git, processes, Windows automation, WSL, browser control, durable goal continuation, context capsules, indexing, observability, ECC integration, and extensibility; 246 are advertised by default and all 253 when Codex delegation plus Agent Swarm is enabled.</em>
</p>

<p align="center">
  <em>อ่านที่เหลือใน Readme ได้เลยครับ ติดปัญหาทักมาได้ใน <a href="https://url.in.th/rEZiG"><strong>Line</strong></a> ได้ตลอดครับ / กำลังพัฒนาให้เรื่อยๆครับ ท่านที่ถามหาช่องสนับสนุนค่ากาแฟ แปะลิงก์ไว้ให้แล้วครับ ขอบคุณครับ — <a href="https://easydonate.app/abcz"><strong>Donate</strong></a></em>
</p>

<p align="center">
  <a href="https://github.com/engasnm111/lnwjud/releases/latest"><img alt="GitHub Release" src="https://img.shields.io/github/v/release/engasnm111/lnwjud" /></a>
  <a href="LICENSE"><img alt="License" src="https://img.shields.io/badge/license-MIT-blue.svg" /></a>
  <img alt="Platform" src="https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-0078D4" />
  <img alt="Node" src="https://img.shields.io/badge/Node.js-24.x-339933" />
  <img alt="MCP" src="https://img.shields.io/badge/MCP-253%20tools-6f42c1" />
</p>

<h2 align="center">Download lnwjud</h2>
<p align="center">Choose your platform and download the current v5.0.1 release directly.</p>

<table align="center">
  <tr>
    <td align="center" width="33%">
      <a href="https://github.com/engasnm111/lnwjud/releases/latest/download/lnwjud-Setup-5.0.1.exe">
        <img src="assets/download/download-windows.svg" width="300" alt="Download lnwjud for Windows" />
      </a><br />
      <sub><a href="https://github.com/engasnm111/lnwjud/releases/latest/download/lnwjud-Portable-5.0.1.exe">Portable x64</a></sub>
    </td>
    <td align="center" width="33%">
      <a href="https://github.com/engasnm111/lnwjud/releases/latest/download/lnwjud-5.0.1-arm64.dmg">
        <img src="assets/download/download-macos.svg" width="300" alt="Download lnwjud for macOS" />
      </a><br />
      <sub><a href="https://github.com/engasnm111/lnwjud/releases/latest/download/lnwjud-5.0.1-x64.dmg">Intel x64 DMG</a> · <a href="docs/INSTALL_MACOS.md">Install guide</a></sub>
    </td>
    <td align="center" width="33%">
      <a href="https://github.com/engasnm111/lnwjud/releases/latest/download/lnwjud-5.0.1-x64.deb">
        <img src="assets/download/download-linux.svg" width="300" alt="Download lnwjud for Linux" />
      </a><br />
      <sub><a href="https://github.com/engasnm111/lnwjud/releases/latest/download/lnwjud-5.0.1-x64.AppImage">x64 AppImage</a> · <a href="docs/INSTALL_LINUX.md">Other architectures</a></sub>
    </td>
  </tr>
</table>

<p align="center"><a href="https://github.com/engasnm111/lnwjud/releases/latest"><strong>View all release files →</strong></a></p>

---

## Current version: v5.0.1

`v5.0.1` is the current release line. The platform cards above point to the matching v5.0.1 assets, while [GitHub Releases](https://github.com/engasnm111/lnwjud/releases/latest) contains every published architecture, package format, checksum, and provenance file. Development artifacts from `dev` remain testing-only until they are merged and released through the verified `dev → main → tag → Release` flow.

### What's new in v5.0.1

- **Tunnel incident diagnostics v2:** exported incidents now preserve process exit/restart evidence, OAuth refresh diagnostics, transport/network clues, client-version probe results, and sanitized tunnel log messages without storing credentials.
- **Reconnect evidence:** persistent tunnel supervision records restart attempts, outcomes, last known process IDs, and managed-runtime limitations so disconnects can be diagnosed instead of collapsing into a generic stopped state.
- **Version probing fallback:** Windows tunnel-client inspection falls back to the runtime `--version` command when file-version metadata is unavailable.
- **Consistent timestamps:** UI/log copy and incident evidence use the shared Asia/Bangkok 24-hour display contract, while incident JSON records its timezone and offset-aware timestamps explicitly.

### Historical: What's new in v5.0.0

- **Durable Goal Plan + acceptance:** authoritative goal state now exposes a user-facing plan projection, explicit acceptance criteria/evidence, and completion gates instead of treating prose checkpoints as the finish line.
- **Newest user intent wins:** `userIntentRevision` fences stale generated work, while durable delivery receipts track reserved, attempted, ambiguous-dispatch, confirmed, completed, cancelled, and retired states without blind replay.
- **Context Capsule / compact state:** bounded immutable capsules preserve objective, steering, completed/remaining work, decisions, validation, changed files, artifacts, blockers, and next action without storing private chain-of-thought.
- **Goal-first handoff:** `session_handoff` uses Durable Goal + the latest Context Capsule first, then Git/workspace state and only then the optional legacy phase tracker.
- **Native-only ChatGPT continuation:** compact/resume state never clicks, types into, scrapes, or creates ChatGPT browser conversations. Long-running continuation stays on supported Native ChatGPT Scheduled Tasks plus local durable state.
- **Bounded review loops:** iteration has explicit limits and stale-intent fences instead of an unbounded autonomous browser-message loop; context-pressure reporting is explicitly an estimate unless the provider exposes exact usage.
- **Settings text editing fix:** multiline configuration fields keep newlines while editing, and `LSP Commands — LANGUAGE=COMMAND` accepts incomplete draft text such as `typescript=` before validation/save.
- **253-tool contract:** the MCP registry contains 253 definitions, advertises 246 by default, and advertises all 253 when Codex delegation plus Agent Swarm are enabled.

### Historical: What's new in v4.70.1

- **Progressive log rendering:** Work Log and Live Logs render bounded batches while scrolling instead of mounting thousands of rows at once; Recovery lists use the same progressive pattern for large histories.
- **Fresh visible log sessions:** reopening the desktop starts Work Log and file-backed Live Log views from the new session boundary without deleting persisted SQLite audit history or existing log files.
- **Human-readable log exports:** exported Work Log and Live Log files default to `.log`, retain optional `.txt` output, and use structured headers, numbered entries, localized labels, readable spacing, and preserved technical metadata/detail.
- **Clearer tunnel settings:** Persistent Tunnel Runtime now lives inside the Tunnel block instead of appearing as a third top-level connection method beside OAuth and Tunnel.

### Historical: What's new in v4.70.0

- **Full ECC provider integration:** lnwjud can inventory and selectively load pinned ECC agents, skills, command shims, layered rules, hooks, workflows, MCP templates, instincts, and supporting resources without granting imported content extra runtime authority.
- **ECC Memory Vault:** new `ecc_memory_*` tools provide bounded local `ecc.memory.v1` save/search/read/doctor workflows with create-only unreviewed memory, explicit user-scope opt-in, completeness checks, and no automatic promotion into policy.
- **AgentShield security boundary:** `ecc_security_scan` runs the pinned bundled AgentShield scanner with bounded JSON output and no auto-fix, network expansion, or imported hook/workflow execution.
- **Packaged ECC provenance:** Windows, macOS, and Linux packaging materialize the pinned ECC runtime and security scanner as verified resources with third-party/license provenance instead of depending on ambient global installs.
- **Historical v4.70.0 242-tool contract:** that release contained 242 definitions, advertised 235 by default, and advertised all 242 when Codex delegation plus Agent Swarm were enabled.

### Historical: What's new in v4.62.2

- **OAuth-aware Doctor:** when OAuth-protected Remote MCP is the active ChatGPT connection, Doctor no longer reports Secure MCP Tunnel runtime/auth/health failures for the intentionally unused transport.
- **macOS 26 community-package launch fix:** ad-hoc Electron main/helper process signatures keep hardened runtime but add the scoped `disable-library-validation` entitlement required for ad-hoc Electron Framework loading on macOS 26. Developer ID builds keep normal Library Validation and must retain one Team ID.
- **macOS 26 exact-artifact release gate:** macOS arm64/x64 packages continue to build on macOS 15, then the same DMG/ZIP bytes are downloaded, provenance-verified, signature-policy-verified, launched through LaunchServices, and smoke-tested on `macos-26` / `macos-26-intel` before publication.
- **Ponytail FULL activation fix:** the canonical bundled `skills_read` path now carries workspace/goal scope and counts as activation evidence, so a correct Ponytail load no longer loops on the same mutation-blocking error.
- **Cross-platform capture completion:** carries forward the pending Windows/macOS/Linux window/display capture, DPI/coordinate mapping, native capture, and MCP image-delivery hardening that was present locally but had not been committed into v4.62.1.

### Historical: What's new in v4.62.1

- **External MCP error passthrough:** child `tools/call` now bypasses the SDK layer's eager output-schema validation so a real `isError: true` result reaches lnwjud unchanged; successful structured output and the MCP result envelope are still validated, with regression coverage for the exact SDK-layer failure path reported in Issue #53.
- **Image payload delivery:** native Vision captures now return the screenshot as first-class MCP `image` content without duplicating the full Base64 payload into text/structured metadata, preventing successful captures from being lost behind oversized tool-result JSON.
- **Image integrity guard:** Windows Vision validates the encoded PNG before returning it and attaches byte-length/SHA-256 metadata; the MCP result mapper rejects truncated, malformed, dimension-mismatched, or checksum-mismatched image payloads instead of silently handing a corrupted image to the model.
- **Stable search during live refresh:** Work Log and Live Logs now freeze workspace metadata together with the visible log snapshot, so background dashboard polling cannot restart full-detail search or flash between results, loading, and empty states while a query is active. New activity resumes when search is cleared.
- **External MCP image passthrough:** `mcp_call` now preserves child MCP `image` and `text` content blocks instead of flattening the child `CallToolResult` into JSON text, so screenshots from Serena/custom MCP servers can reach the model as images.
- **Window capture targeting:** `vision:capture_window` now accepts natural `app.name` selectors, prefers a visible non-minimized matching HWND when apps expose several helper windows, and reports minimized/hidden-window states directly instead of collapsing them into generic `Operation failed` errors.
- **Manual Tunnel stop precedence:** an explicit **Stop Tunnel** persists the desired stopped state and now stays visually stopped even when an external liveness probe is temporarily unverifiable; Auto Reconnect does not override that operator stop, while the next explicit Start still fails closed if duplicate-process liveness cannot be proven.
- **Calmer Tunnel startup UX:** transient managed-runtime readiness retries stay internal while the Home card simply shows the normal starting state; only genuine Tunnel failures are surfaced as red alerts.
- **Zero-click ChatGPT OAuth:** Business custom apps using supported `chatgpt.com` OAuth callbacks—including newly created Plugin/App callbacks shaped as `/connector/oauth/<redirect_id>`—complete DCR + Authorization Code + PKCE through a one-time browser handoff to an ephemeral `127.0.0.1` Desktop approval listener, so workspace members press **Connect** without copying a PIN. The public gateway never grants trust from the callback URI alone; the 6-digit PIN remains only as a fail-closed fallback for non-ChatGPT OAuth clients.
- **Simpler Home UX:** Home now presents one **ChatGPT Connection** area with Remote MCP OAuth as the primary path and Secure MCP Tunnel as an advanced option, moves Desktop Agent stop/restart/incident actions behind an overflow menu, labels the sidebar **Desktop Agent · Windows/macOS/Linux**, and removes the redundant `MODE / WORK` status card.
- **Stable Remote MCP public URL:** ngrok Free already provides an assigned development domain. lnwjud now remembers the first successful HTTPS origin in encrypted Remote MCP state and reuses that origin through ngrok `--url` on later starts/updates, refusing to silently switch the ChatGPT endpoint if it drifts. Users do not need to buy/register their own domain; custom domains remain optional, and re-saving the ngrok authtoken intentionally resets the remembered origin for account/domain changes.
- **Secure Tunnel multi-chat headroom:** one lnwjud Desktop + one Secure Tunnel can serve multiple simultaneous ChatGPT chats without creating a profile per chat. v4.62.0 raises the bundled tunnel transport's active MCP-request allowance from tunnel-client's default 10 to 32 and adds a real 3-session/12-request concurrency regression. Multi-host routing is separate: Mac/Windows hosts that must be independently selectable should use distinct Tunnel IDs/ChatGPT connections because replicas sharing one Tunnel ID consume queued work from whichever host polls first.
- **macOS signing normalization (superseded by v4.62.2 for macOS 26):** v4.62.1 normalized Electron's nested ad-hoc signatures and rejected mixed Team-ID state, but Issue #59 proved that normalization alone was insufficient for community ad-hoc packages on macOS 26.
- **Regression coverage:** mapper, External MCP bridge, MCP HTTP transport, and Windows native bridge tests cover image delivery and reliable window targeting.

### Historical: What's new in v4.61.0

- **Stable log search and pause:** Work Log and every Live Logs tab freeze the visible feed while a search is active, so newly arriving events cannot jump into or reorder the result list while you type or inspect matches. Clearing search resumes the current live feed. Live Logs **Pause** now freezes the feed itself, and **Follow** resumes only when no search is holding the snapshot.
- **Durable background-task lifecycle:** shell tasks finalize from the direct command's terminal state instead of being stranded by detached descendants that keep inherited stdio handles open.
- **External MCP lifecycle hardening:** pending child connections are fenced during shutdown, so a late Serena/custom MCP connection cannot resurrect a session after the session manager has closed.
- **Windows and WSL correctness:** Windows Event Log runtime-contract checks use deterministic runtime evidence, while WSL translates supported Windows working directories before Linux execution.
- **Persistence and diagnostics:** secret recovery, SQLite close ownership, tunnel restart/terminal handling, Doctor applicability, and bounded/path-guarded Git diff behavior are hardened for the release.
- **External MCP compatibility:** child MCP servers auto-negotiate their protocol version, covering legacy/2025-era servers such as Serena as well as current MCP `2026-07-28`, while lnwjud's own inbound MCP contract remains unchanged. External MCP definitions saved in Settings are applied live, so adding or changing Serena/custom servers does not require restarting lnwjud.
- **Cross-platform hardening:** Windows, macOS, and Linux now use explicit host/architecture capability gates instead of Windows-shaped fallbacks. Unsupported OS/architecture combinations fail closed.
- **Native Ponytail coding policy:** optional `OFF / LITE / FULL / ULTRA` modes default to OFF, resolve `Current Goal > Workspace > Global`, and use exact bundled Ponytail skills rather than relying on discovery ranking. Active modes require the exact bundled primary skill before code mutation; FULL/ULTRA durable coding goals additionally require a fresh bundled Ponytail review before completion. Full Bypass does not bypass this correctness gate, while explicit session suppression remains available without changing persisted policy.
- **macOS package verification:** release checks stage the app from the actual DMG, launch it through macOS LaunchServices, verify nested code signing, and distinguish Developer ID Team-ID requirements from development ad-hoc signing.
- **Runtime dependencies:** target-native assets are selected by exact `(platform, architecture)` tuples. Current pins include OpenAI `tunnel-client 0.0.14`, `ripgrep 15.2.0`, and Windows Poppler `26.07.0-0`, with checksum/provenance/version checks before packaging.
- **Remote MCP / ngrok:** ngrok discovery now works across Windows, macOS, and Linux. Automatic installation is shown only when the host has a supported installer path; unsupported installer actions are hidden instead of pretending they work.
- **PDF providers:** PDF tooling can use a configured native `pdftotext` where supported; the bundled Poppler auto-installer remains Windows x64-only and is hidden on unsupported hosts.
- **Recovery and persistence:** MCP settings, backup/checkpoint/recovery paths, secret-storage boundaries, tunnel state, cross-host restore metadata, and data-root selection were audited for Windows/macOS/Linux semantics. Recovery Trash/checkpoint retention now defaults to **30 days only when the user has never configured it**; existing explicit values, including `Never` (`0`), are preserved.
- **Unified timestamps:** Thai UI uses Bangkok time with 24-hour display; English uses the host timezone with AM/PM presentation, while machine timestamps remain absolute internally.
- **Responsiveness:** heavy ripgrep output and Live Log traffic are bounded/batched to reduce Electron `Not Responding` hangs and runaway memory churn.
- **Release verification:** v4.61.0 is gated by full workspace tests, Electron acceptance/E2E, packaging and release-gate suites, plus exact-commit target-native Windows/macOS/Linux CI before tagging.

> Public `v4.61.0` should be tagged only after the exact-main Windows/macOS/Linux release matrix, SHA-scoped artifacts, and packaged-app smoke checks are green for the exact commit.

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

lnwjud exposes **253 tool definitions** through one local runtime and MCP gateway. The default advertised set is 246; all 253 are available when Codex delegation plus Agent Swarm is enabled.

| Area | Examples |
| --- | --- |
| Workspace & files | read/search/edit files, paging, full scans, project indexing, recovery trash |
| Git | status, diff, history, blame, guarded Git mutations |
| Processes | shell, managed processes, durable background tasks, logs, cancellation |
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

- **Local MCP clients:** use the packaged stdio launcher or Desktop loopback MCP endpoint.
- **Remote MCP via ngrok + OAuth:** useful for a remote ChatGPT/MCP client when you want lnwjud to run the protected OAuth gateway and ngrok runtime.
- **OpenAI Secure MCP Tunnel:** outbound-only OpenAI tunnel path using the verified target-native bundled `tunnel-client`. One lnwjud tunnel endpoint is intended to serve multiple simultaneous ChatGPT chats/workspaces; do not create one tunnel/profile per chat. v4.62.0 explicitly gives the tunnel transport 32 active MCP-request slots so normal multi-chat tool fan-out does not hit tunnel-client's lower default ceiling. If several physical lnwjud hosts (for example Mac + Windows) must be independently selectable, give each host a distinct Tunnel ID/ChatGPT connection: HTTP replicas sharing one Tunnel ID are work-sharing replicas, so a request goes to whichever replica polls it first rather than to a chat-selected host.
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
