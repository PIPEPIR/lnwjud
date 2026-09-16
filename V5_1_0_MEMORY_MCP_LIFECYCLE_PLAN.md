# แผน v5.1.0: คืนหน่วยความจำ, ปิด External MCP/Serena ให้ครบ tree และแก้ log ANSI

วันที่วิเคราะห์: 2026-09-16  
เป้าหมายรุ่น: `v5.1.0`  
สถานะ: แผนหลัก — Phase A/B ลงโค้ดและ regression แล้ว; เหลือ target-native CI/package evidence ก่อนประกาศผล release ครบทุก architecture

## 1. สรุปผู้บริหาร

รายงานนี้มีสามอาการที่เกี่ยวข้องกัน แต่ไม่ใช่ปัญหาเดียวกัน:

1. **RAM ของ lnwjud สูงและดูเหมือนไม่คืน** — พบ retention จริงสองจุด: ประวัติ managed process เดิมโตได้ไม่จำกัด และ Live Logs แม้จำกัดจำนวนบรรทัด แต่เพดานเดิมสูงและข้อความ MCP/process ไม่มีเพดานต่อบรรทัดที่จุดรวม
2. **Serena/External MCP ไม่ปิดหลังใช้** — lnwjud มี idle timeout อยู่แล้ว (ค่าเริ่มต้น 5 นาที) และเรียก `session.close()` เมื่อ idle/ปิด runtime แต่ transport SDK รับรองเพียง process ตรงตัว ไม่ได้รับรอง descendant ทั้ง tree โดยเฉพาะโปรแกรมที่แตก Python, language server, dashboard หรือ process แบบ detached
3. **Log เป็น “ภาษาเอเลี่ยน”** — ข้อความมี ANSI/VT escape sequence เช่น `ESC[33m`, `ESC[22m`, `ESC[39m` และ OSC hyperlink ซึ่ง UI เว็บไม่ได้แปลเป็นสี จึงแสดงเป็นอักขระควบคุม

สิ่งที่ลงแล้วในชุดแก้ v5.1.0 นี้:

- ตัด ANSI/VT ด้วย `node:util.stripVTControlCharacters()` ทั้งที่ `LogHub` และ audit redaction boundary ก่อนข้อความแถวหลัก/รายละเอียดไป UI, Copy และ Export
- จำกัดข้อความ log ทุก source ที่ 8 KiB ต่อรายการ
- จำกัด serialized Live Log ที่ 8 MiB ต่อ source นอกเหนือจากเพดาน 10,000 รายการเดิม
- จำกัด Live Log ฝั่ง renderer ที่ 24 MiB ต่อหน้าต่าง นอกเหนือจากเพดาน 30,000 รายการเดิม
- จำกัด partial record จากไฟล์ log ที่ยังไม่มี newline ไว้ 8 KiB เพื่อไม่ให้ `pending` โตตามไฟล์เสีย/producer ที่ไม่จบบรรทัด
- เมื่อ managed process จบ บีบ log เหลือ tail ไม่เกิน 256 KiB และเก็บ terminal process ล่าสุดไม่เกิน 32 รายการ
- กวาด ownership/tracking entry ที่ process record ถูกปล่อยแล้ว
- เพิ่ม regression test ยืนยันว่า External MCP session ปกติถูกปิดเมื่อครบ idle timeout
- External MCP stdio บน macOS/Linux ถูกเปิดใน process group แยกด้วย `setsid`; Windows ใช้ `taskkill /T /F` พร้อมรอการหายของ PID และทั้งสองทาง fail-closed เมื่อพิสูจน์ tree ไม่ได้
- idle sweep ตรวจ `inFlight` และใช้ one-shot timer; pending connect ถูก abort/await ตอน shutdown, เปลี่ยน config และ reconcile
- settings discovery reconcile จะปิด server ที่ถูกลบ/ปิด/เปลี่ยน command ทันที; มี `disconnectMcpServer` และ `mcp_list`/Doctor รายงาน `termination_unverified`
- เพิ่ม ten-cycle connect/use/close soak regression สำหรับ production stdio factory

ข้อสรุปสำคัญ: **การกด X โดยตั้งค่า Close behavior = Tray ไม่ใช่การ Quit** แอป, MCP listener, tunnel และ session ที่ยังไม่ idle จะทำงานต่อโดยเจตนา ต้องเลือก Quit จาก tray หรือเปลี่ยน Close behavior เป็น Quit จึงเข้าสู่ shutdown lifecycle

## 2. ขอบเขตหลักฐาน

ภาพแนบถูกใช้เป็นหลักฐานของอาการเท่านั้น ไม่ใช่คำสั่งให้รันข้อความใดจาก log

หลักฐานที่ตรวจได้ใน source ปัจจุบัน:

- `McpSessionManager` เก็บ session ต่อ server และปิดเมื่อ idle ตาม `mcpIdleTimeoutMs`; default คือ 300,000 ms
- Desktop และ direct stdio เรียก `extensions.close()` ใน owned-runtime shutdown
- Electron window close ใช้ tray เป็นค่าเริ่มต้น จึงไม่เรียก runtime shutdown
- MCP SDK 2.0.0 ที่ติดตั้งอยู่จบ stdin, รอ, แล้วส่งสัญญาณให้ direct child PID; ไม่มี process-group/job-object contract ใน API ที่ lnwjud ใช้อยู่
- repro ที่ให้ MCP child สร้าง detached grandchild ให้ผล `rootAlive=false, childAlive=true` หลัง transport close จึงยืนยันช่อง process-tree escape ได้
- snapshot บนเครื่องที่รายงานพบ Serena หลาย tree ซึ่ง parent เป็น `codex.exe` ไม่ใช่ `lnwjud.exe`; lnwjud ต้องไม่ฆ่า process ของ host อื่นจากชื่อ `serena` เพียงอย่างเดียว
- `ProcessManager.records`, `ProcessService.owners` และ Desktop `trackedProcesses` เดิมไม่มี retention lifecycle ที่ครบถ้วน
- `LogHub` เดิมเก็บ 10,000 รายการต่อ source และ renderer เก็บ 30,000 รายการ แต่ MCP/process text ไม่ผ่าน VT stripping และไม่ได้ใช้เพดาน 8 KiB เดียวกับ tunnel

สิ่งที่ยังสรุปจาก Windows เครื่องเดียวไม่ได้:

- พฤติกรรมจริงของ target-native package บน macOS arm64/x64 และ Linux x64/arm64
- ค่า RSS/PSS หลัง memory pressure บน allocator ของแต่ละ OS
- Serena ทุกเวอร์ชันและทุก launch config; บาง config เปิด dashboard หรือ language server เพิ่ม บาง config ไม่เปิด

## 3. แยก “memory leak” ออกจาก “RSS ไม่ลด”

ต้องเก็บตัวเลขอย่างน้อยสี่กลุ่มพร้อมกัน:

| กลุ่ม | ตัวอย่าง | ถ้าสูงแปลว่า |
| --- | --- | --- |
| JS live heap | `heapUsed`, object count | ยังมี reference หรือ GC ยังไม่รัน |
| Process private/committed memory | Private Bytes, anonymous RSS/PSS | process ยังถือ page จริง |
| Working set / RSS | Task Manager Working Set, `ps rss` | page ยัง resident แต่อาจพร้อม reuse/evict |
| Child-process tree | PID/PPID/PGID/job owner | RAM อยู่ใน Serena/Python/Node/WebView ไม่ใช่ Electron heap |

เกณฑ์วินิจฉัย:

- ถ้า session/process/log count คงที่และ heap ลด แต่ RSS ไม่ลด: เป็น allocator/OS reuse มากกว่า object leak
- ถ้า count หรือ retained bytes เพิ่มทุก cycle: เป็น application retention
- ถ้า lnwjud heap คงที่ แต่ descendant RSS ยังอยู่หลัง idle/quit: เป็น child lifecycle leak
- ถ้ากระบวนการนั้นมี owner เป็น Codex/Claude/Cursor: เป็น lifecycle ของ host นั้น ไม่ใช่ process ที่ lnwjud มีสิทธิ์ปิด

ห้ามใช้ Task Manager ตัวเลขเดียวเป็น pass/fail เพราะ V8, Chromium, Python และ libc สามารถคืน memory ให้ allocator ภายในก่อนคืน page ให้ OS

## 4. Current-state flow

### 4.1 External MCP

```text
mcp_describe / mcp_resources / mcp_call
        │
        ▼
LocalExtensionsService
        │
        ▼
McpSessionManager.ensure(server, config)
        │  cache ต่อ server + launch fingerprint
        ▼
SDK StdioClientTransport
        │  spawn direct child
        ▼
serena wrapper → Python runtime → language servers / dashboard / WebView
```

เส้นทางปิดปัจจุบัน:

- idle sweep ทุกไม่เกิน 30 วินาที; ปิดเมื่อ `now - lastUsedAt >= idleTimeoutMs`
- call/describe/list failure จะ `drop()` session
- Desktop Quit และ stdio peer close จะ `extensions.close()`
- config fingerprint เปลี่ยนจะปิด session เก่าก่อนสร้างใหม่

ช่องว่าง:

- `close()` ของ child session ถูก best-effort และ error ถูกกลืน จึงอาจแสดง disconnected ทั้งที่ descendant ยังอยู่
- direct child PID ไม่เท่ากับ process tree ownership
- pending connection ตอน shutdown ถูก fence ไม่ให้กลับเข้า map แต่ shutdown ไม่ได้มีหลักฐาน tree-empty
- background inspection ของ server ที่เชื่อมอยู่สามารถเลื่อน `lastUsedAt`; ต้องแยก “user/tool activity” จาก passive health/catalog refresh
- idle sweep มี `inFlight` counter และ one-shot timer; timeout สั้นกว่าระยะ call จะเลื่อนการปิดจนงานคิวหมด

### 4.2 Managed process memory

ก่อน v5.1.0:

- active process สูงสุด 24
- log ต่อ process สูงสุด 10 MiB
- terminal record ไม่มีเพดานจำนวนและไม่ compact log
- owner map ชั้น application และ tracking map ชั้น Desktop อยู่ได้นานกว่าตัว process

หลัง mitigation v5.1.0:

- active process ยังใช้เพดาน 24 และ log 10 MiB เพื่อไม่ตัด output ของงานที่ยังรัน
- terminal process เก็บล่าสุด 32 รายการ
- terminal log เก็บ tail ไม่เกิน 256 KiB ต่อ process (รวม raw payload โดยประมาณไม่เกิน 8 MiB สำหรับ terminal history)
- record เก่าถูกลบจาก manager และ owner/tracking map กวาดตาม

### 4.3 Live Logs

ก่อน v5.1.0:

- main: 10,000 รายการต่อ source (`tunnel`, `mcp`, `process`)
- renderer: 30,000 รายการ
- process/MCP text อาจยาวและมี terminal control sequence
- main และ renderer ถือคนละ copy ผ่าน IPC

หลัง mitigation v5.1.0:

- 8 KiB ต่อข้อความทุก source
- 8 MiB serialized payload ต่อ source และ 10,000 รายการ แล้วแต่ว่าเพดานใดถึงก่อน
- สูงสุดประมาณ 24 MiB serialized payload ฝั่ง main; renderer รับชุดที่ถูกจำกัดแล้ว
- renderer แต่ละหน้าต่างเก็บ newest contiguous tail ไม่เกิน 24 MiB และ 30,000 รายการ
- raw tunnel/activity file ไม่ถูกเขียนทับ การ sanitize ทำเฉพาะ presentation/copy/export buffer

## 5. Root causes และระดับความมั่นใจ

| ลำดับ | Root cause | ความมั่นใจ | หลักฐาน/คำทำนาย |
| --- | --- | --- | --- |
| 1 | terminal process/log retention ไม่มีเพดาน | ยืนยัน | test 33 process เดิมเหลือ 33 record; หลังแก้เหลือ 32 และ log tail ≤256 KiB |
| 2 | Live Log payload budget เดิมอิงจำนวนบรรทัดอย่างเดียว | ยืนยัน | 1,100 รายการขนาด 8 KiB เดิมเก็บ ~9 MiB ใน source เดียว; หลังแก้ ≤8 MiB |
| 2a | renderer เดิมจำกัด 30,000 รายการแต่ไม่จำกัด byte | ยืนยัน | regression burst เดิมเก็บเกิน byte budget; หลังแก้เก็บ newest tail ≤24 MiB ต่อหน้าต่าง |
| 2b | file tailer เดิมสะสมบรรทัดที่ไม่มี newline ใน `pending` ได้ไม่จำกัด | ยืนยัน | fixture 200,000 bytes เดิมค้างครบ 200,000 bytes; หลังแก้ pending ≤8 KiB |
| 3 | ANSI/VT ถูกเก็บดิบทั้งใน `LogLine.text` และ expandable audit detail | ยืนยัน | regression เดิมเห็น `ESC[33m...`; หลังแก้แถวหลักและรายละเอียดได้ `warning link` |
| 4 | External MCP transport ไม่รับรอง descendant cleanup | ยืนยันเชิง contract/repro | detached grandchild อยู่หลัง direct root ปิด |
| 5 | Serena ทุกตัวในรายงานเป็นของ lnwjud | หักล้างสำหรับ snapshot ที่ตรวจ | Serena ที่พบมี parent เป็น Codex; ต้องทำ owner attribution ก่อน kill |
| 6 | RSS ไม่ลดทั้งหมดคือ leak | ยังไม่ยืนยัน | ต้องเทียบ heap, retained bytes, PID tree และ memory pressure |

## 6. Process-tree ownership ที่ต้องทำก่อนประกาศ “Serena ปิดครบ”

### 6.1 หลักการ

1. ฆ่าได้เฉพาะ process ที่สร้างผ่าน spawn boundary ของ runtime instance ปัจจุบัน
2. ห้ามค้นแล้วฆ่าจาก executable name เช่น `serena`, `python`, `node`
3. เก็บ identity ตั้งแต่ spawn: root PID, start identity, server name, runtime instance ID, launch fingerprint และ platform group/job identity
4. สถานะ `disconnected` ต้องหมายถึง transport ปิด; สถานะ `treeStopped` ต้องหมายถึงตรวจแล้วไม่เหลือ owned descendant สองสถานะนี้ห้ามรวมกัน
5. ถ้าตรวจไม่ได้ให้เป็น `termination_unverified`; ห้ามรายงาน success

### 6.2 โครงสร้างที่ลงจริงใน v5.1.0

เพิ่ม internal owned handle ที่ transport factory คืนพร้อม session:

```ts
interface OwnedExternalMcpSession {
  session: McpClientSession;
  rootPid: number;
  close(): Promise<void>;
}
```

`McpSessionManager` เก็บ launch/catalog fingerprint, queue และ `inFlight`; wrapper จะเรียก process-tree terminator ผ่าน PID ก่อน SDK close, เก็บ close failure เป็น `termination_unverified`, และปล่อย lifecycle ผ่าน `mcp_list`/Doctor โดยไม่เปิด command/args/env

### 6.3 Teardown algorithm

1. เปลี่ยน state เป็น `closing`; ไม่รับ call ใหม่
2. abort pending connect/request ของ server นั้น
3. รอ queue/in-flight ให้จบแบบ bounded; idle sweep ห้ามเข้าขณะ `inFlight > 0`
4. ส่ง authoritative tree termination (process group หรือ `taskkill /T /F`) ก่อนที่ SDK จะปิด root เดี่ยว
5. ปิด MCP client/stdin และตรวจ root/tree
6. ถ้ายังอยู่หรือ identity เปลี่ยน ให้ fail closed
7. process-group terminator ใช้ SIGTERM → grace → SIGKILL; Windows taskkill รอ PID หาย
8. ตรวจซ้ำด้วย PID + start identity เพื่อกัน PID reuse
9. ปล่อย stderr listener, timer, queue, catalog และ session map
10. emit lifecycle log ที่ sanitize แล้ว
11. ถ้ายังตรวจไม่ได้ ให้เก็บ `termination_unverified` สำหรับ retry/Doctor แทนการลืม ownership

### 6.4 Idle semantics ใหม่

- ใช้ one-shot timer ต่อเวลาสิ้นสุด operation ล่าสุด แทน interval ที่ตื่นตลอด
- `lastUsedAt` อัปเดตเมื่อ explicit child operation เริ่ม/จบ ไม่ใช่ passive UI read ที่ไม่ควรต่ออายุ process
- `inFlight` มากกว่า 0 ยกเลิก/เลื่อน idle close
- default คง 5 นาทีเพื่อไม่ทำลาย latency/state ของ server; ผู้ใช้ตั้ง 1–1,440 นาทีได้
- มี disconnect boundary ต่อ server (และ settings reconcile ทำหน้าที่เทียบเท่า Disconnect all สำหรับรายการที่หาย/ถูกปิด)
- save settings ที่ disable/remove/change command ต้อง reconcile และปิด session เก่าทันที ไม่รอ idle

## 7. กลยุทธ์เฉพาะ OS

### 7.1 Windows 10/11 x64

ทางเลือกหลัก:

- spawn External MCP ด้วย ownership boundary ต่อ platform: Windows ใช้ `taskkill /T /F` ที่ PID ซึ่ง transport คืนให้และรอ verify; macOS/Linux ใช้ `setsid` + process group
- graceful SDK close จะตามด้วย tree terminator ที่ authoritative; ถ้า verification ล้มเหลวจะไม่ซ่อนเป็น success
- ตรวจ root liveness/start identity (POSIX) และ PID exit (Windows) ก่อน/หลัง signal เพื่อกัน PID reuse และรายงาน unverified

fallback/implementation ปัจจุบัน:

- ใช้ `taskkill.exe /PID <owned-root> /T /F` เฉพาะ root ที่ identity ยังตรง
- บันทึก exit code และตรวจ descendant ซ้ำ
- ห้ามใช้ `taskkill /IM serena.exe`

ถ้าต้องการ Job Object ในอนาคต ให้เพิ่ม native helper ที่ composition root; v5.1.0 ไม่เพิ่ม binary ใหม่และใช้ tree primitive ที่มีอยู่แล้ว

Acceptance:

- `.exe`, `.cmd`, `uvx`, `serena.exe → python.exe → node.exe/WebView` fixture
- graceful, stubborn root, detached child, root exits before child และ PID-reuse simulation
- Quit ต้องไม่ออกจน owned tree verified หรือแสดง deferred shutdown

ตัววัด: Private Bytes, Working Set, Commit Size, handle count และ owned process count

### 7.2 macOS 13+ arm64/x64

ทางเลือกหลัก:

- spawn leader ใน process group/session ที่ lnwjud เป็นเจ้าของ (`detached`/PGID แยก)
- graceful close แล้ว `kill(-pgid, SIGTERM)`; รอ; ตามด้วย `SIGKILL`
- ตรวจ PID start identity ด้วย `ps` ก่อน signal และตรวจ group ว่างหลัง signal
- reap direct child เพื่อไม่ให้เกิด zombie

ข้อควรระวัง:

- ห้าม signal process group ของ Electron เอง
- helper/dashboard ที่ daemonize สองชั้นอาจหนี PGID; fixture ต้องครอบคลุม และถ้าพบจริงต้องใช้ wrapper host ที่คุมลูกก่อน exec
- App window close บน macOS โดยธรรมเนียมอาจไม่เท่ากับ Quit; UI ต้องบอกสถานะชัด

Acceptance แยก arm64 และ x64 บน target host จริง

ตัววัด: `phys_footprint`/resident size, compressed memory, heap used และ PGID member count

### 7.3 Linux x64 / arm64 preview

baseline ที่รองรับ: Ubuntu 24.04 LTS; desktop Wayland/X11 และ headless stdio

ทางเลือกหลัก:

- ใช้ process group แยกเหมือน macOS
- graceful → `SIGTERM` group → grace → `SIGKILL` group
- ตรวจ `/proc/<pid>/stat` start time เพื่อกัน PID reuse; fallback `ps` ต้อง fail closed
- reap direct child ทุกครั้ง

optional hardening:

- ถ้า runtime อยู่ใน cgroup v2 ที่สร้าง sub-cgroup ได้ ให้ใช้ cgroup ต่อ external server และ `cgroup.kill` เป็น escalation
- ห้ามบังคับ systemd/cgroup เพราะ AppImage, DEB และ headless environment ไม่รับรองสิทธิ์เดียวกัน

Acceptance:

- AppImage และ DEB x64
- arm64 preview package
- desktop Wayland, X11 และ headless stdio
- fixture ที่ fork/daemonize และ process ที่ ignore SIGTERM

ตัววัด: RSS, PSS (`smaps_rollup`), cgroup memory เมื่อมี, FD count, PID/PGID member count

## 8. Observability/Doctor ที่ต้องเพิ่ม

เพิ่มข้อมูลแบบไม่เปิดเผย command args/env secret:

- runtime instance ID
- external server name/source
- owner (`desktop`, `direct_stdio`, หรือ foreign/unknown)
- state: disconnected, connecting, connected, idle, closing, termination_unverified
- root PID + start identity แบบ diagnostic เท่านั้น
- descendant count และ aggregate RSS เมื่อ platform รองรับ
- connectedAt, lastUsedAt, idleDeadline
- inFlight count
- last close reason/result/duration/escalation
- managed process counts: active, terminal retained, terminal log bytes
- Live Log counts/bytes ต่อ source
- main `rss`, `heapUsed`, `external`, `arrayBuffers`; renderer metric แยก process

Live Logs/Doctor ต้องแสดงข้อความสำคัญ:

- “Window hidden to tray; runtime is still active”
- “External MCP will disconnect after N minutes idle”
- “This Serena process is owned by another host; lnwjud will not terminate it”
- “Transport closed but process-tree termination is unverified”

## 9. Test matrix

### 9.1 Portable unit/integration

- ANSI CSI/OSC hyperlink ในข้อความหลักและ expandable audit detail รวมทั้ง UTF-8 หลาย byte ไม่เสีย
- UI, copy และ export ได้ข้อความสะอาดเหมือนกัน
- Live Log ต่อ source ไม่เกิน 8 MiB และเก็บ newest entries
- renderer Live Log ต่อหน้าต่างไม่เกิน 24 MiB และเก็บ newest contiguous tail
- partial tailed-file record ที่ไม่มี newline ไม่เกิน 8 KiB
- terminal process history ไม่เกิน 32; retained tail ไม่เกิน 256 KiB
- owner maps ถูกกวาดเมื่อ manager record หาย
- idle session ปิดหนึ่งครั้ง, reconnect ได้, timer ไม่ซ้ำ
- idle sweep ไม่ปิด active/in-flight call
- close ระหว่าง pending connect abort และรอ bounded settlement
- config change/disable/remove ปิด session เก่า
- close failure สร้าง `termination_unverified` ไม่ใช่ disconnected-success

### 9.2 Real child fixtures

อย่างน้อยห้าแบบต่อ OS:

1. child ปกติที่ออกเมื่อ stdin EOF
2. child ignore EOF แต่รับ soft signal
3. child ignore soft signal ต้อง hard kill
4. child สร้าง grandchild/detached helper
5. root ออกก่อนแต่ descendant ยังอยู่

ตรวจทั้ง idle, manual disconnect, settings reconcile, app Quit, stdio peer close และ call timeout

### 9.3 Target-native release gate

| Target | Gate |
| --- | --- |
| Windows x64 | Setup + Portable, Job Object/taskkill tree fixture, local unsigned Authenticode stateรายงานตามจริง, SHA/provenance ผ่าน |
| macOS arm64 | DMG/ZIP บน target host, PGID fixture, signature/notarization policy ตาม credential |
| macOS x64 | แยกจาก arm64; ห้ามใช้ผล arm64 แทน |
| Linux x64 | AppImage + DEB, PGID fixture บน headless และ desktop |
| Linux arm64 | preview artifact + native fixture; ห้ามใช้ emulation เป็น release evidence |

## 10. Performance/soak protocol

Scenario มาตรฐาน:

1. cold start และบันทึก baseline หลังนิ่ง 60 วินาที
2. เรียก Serena describe + tool call 20 รอบ
3. ปล่อย idle จนเกิน deadline + sweep margin
4. ยืนยัน session/tree count เป็นศูนย์
5. บังคับ memory pressure แบบ platform-safe แล้ววัดอีกครั้ง
6. ทำซ้ำ 10 cycle
7. ทำ managed process สั้น 500 งานและ log burst
8. เปิด/ปิด Live Logs และ standalone viewer
9. Quit จริง ไม่ใช่ hide-to-tray

Pass criteria:

- owned External MCP tree = 0 ภายใน grace + escalation deadline
- `termination_unverified` = 0 ใน happy path
- heap หลัง cycle 10 ไม่โตตามจำนวน cycle; ใช้แนวโน้มและ retained object count ไม่ใช้ RSS จุดเดียว
- terminal process count ≤32 และ terminal log payload ≤8 MiB โดยประมาณ
- Live Log serialized payload ≤8 MiB/source
- renderer serialized Live Log payload ≤24 MiB/window
- ไม่มี ANSI/VT control sequence ใน UI/copy/export
- ไม่มี process ของ host อื่นถูกปิด

## 11. Rollout plan

### Phase A — landed ใน change นี้

- [x] ANSI/VT stripping ที่ shared LogHub boundary
- [x] per-line และ per-source Live Log budget
- [x] renderer Live Log byte budget
- [x] unterminated tailed-file record budget
- [x] terminal managed-process retention/compaction
- [x] owner/tracking cleanup ตาม retained manager records
- [x] idle-session regression test
- [x] เอกสารวิเคราะห์ทุก target OS

### Phase B — ownership transport ก่อน claim Serena fix

- [x] Owned external MCP close boundary with lifecycle evidence/status
- [x] Windows verified taskkill tree fallback (native Job Object remains an optional future optimization)
- [x] POSIX process-group ownership via `setsid`, SIGTERM/SIGKILL escalation, and identity checks
- [x] in-flight-aware idle scheduler
- [x] pending-connect abort/await
- [x] settings reconcile + manual disconnect boundary
- [x] `termination_unverified` in MCP list, Doctor, and MCP log on settings save

### Phase C — target-native evidence

- [ ] Windows package gate
- [ ] macOS arm64 gate
- [ ] macOS x64 gate
- [ ] Linux x64 gate
- [ ] Linux arm64 preview gate
- [ ] 10-cycle soak resultsแนบกับ release evidence

## 12. Release wording ที่ซื่อสัตย์

จนกว่า Phase C จะผ่าน ห้ามเขียนว่า “lnwjud kills every Serena process on every OS”

ข้อความที่ใช้ได้สำหรับ code ปัจจุบัน:

> v5.1.0 bounds retained process/log memory, strips terminal escape sequences from Live Logs, and closes lnwjud-owned External MCP trees through platform process-group/taskkill boundaries. A failed ownership/exit proof remains `termination_unverified`; the every-architecture claim is made only after target-native gates pass.

เมื่อ Phase B/C ผ่านครบ จึงเปลี่ยนเป็น:

> v5.1.0 closes lnwjud-owned External MCP process trees after idle, disconnect, reconfiguration, and verified shutdown on every supported target, without touching same-name processes owned by other hosts.

## 13. Rollback

- ANSI stripping rollback ได้เฉพาะ presentation boundary; raw source filesยังอยู่
- ถ้า Live Log budget ต่ำเกินไป ปรับ byte budgetจุดเดียว ไม่ยกเลิก bounding
- ถ้า terminal tail 256 KiB ไม่พอ ให้เพิ่ม budget แบบวัดจาก incident export; ห้ามกลับไป unbounded
- ถ้า native tree terminator ตรวจ ownership ไม่ได้ ให้ fail closed และคง `termination_unverified`; ห้าม fallback เป็น kill-by-name
- feature flag ใช้ได้เฉพาะ rollout ของ native terminator; security/ownership verification ห้ามปิดเพื่อให้ test ผ่าน

## 14. Definition of done สำหรับ v5.1.0

- version/package/docs ตรงกันเป็น 5.1.0
- portable tests, lint, typecheck, packaging/release gates ผ่าน
- regression ของ ANSI, Live Log bytes, terminal retention และ idle close ผ่าน
- Phase B implementation and local regression evidence complete
- Phase C มีผลจาก target host จริงทุก architecture ที่จะ publish
- release notes แยก “heap released” ออกจาก “RSS may remain cached”
- clean-machine smoke ยืนยัน Quit ปิด owned children; hide-to-tray ยังคง runtime ตามที่ UI แจ้ง
