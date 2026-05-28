# Telegram Roster Agents Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Replace startup/session-driven office population with a Telegram-defined visible agent roster that Mike can control.

**Architecture:** Keep the existing browser-first standalone server as the authority. Reuse the current `AgentStateStore` + WebSocket `existingAgents`/`agentCreated` flow, but seed it from a Telegram roster source instead of Claude transcript discovery. Telegram message ingestion can update these roster-backed agents later, but the first milestone is static visible roster hydration.

**Tech Stack:** TypeScript, Fastify, existing standalone `server/src/*`, React webview client, file-backed adapter state.

---

## Inspection Notes

### What already exists and should be kept
- Standalone runtime entrypoint: `server/src/cli.ts`
- HTTP/WebSocket server boundary: `server/src/httpServer.ts`
- Client bootstrap/state sync: `server/src/clientMessageHandler.ts`
- Agent authority/store + persistence: `server/src/agentStateStore.ts`, `server/src/fileStateAdapter.ts`
- Browser rendering and message consumption: `webview-ui/src/hooks/useExtensionMessages.ts`

### Current seams that matter
- `handleWebviewReady()` already sends `existingAgents` to the browser.
- `AgentStateStore.set()` already emits `agentCreated` over WebSocket.
- Persisted agents already exist in `~/.pixel-agents/standalone-state.json`.
- `runtime.restoreExternalAgents()` is the current restore path for passive/external agents.
- `AgentState` already supports external/non-terminal agents via `isExternal: true` and `hooksOnly?: true`.

### What is too Claude-specific and should stop driving standalone population
- Claude hook install / uninstall toggle path in `server/src/cli.ts`
- Any startup/scanner/session restore assumptions in runtime/file watcher paths
- The idea that visible office agents must come from JSONL/session discovery

### Smallest browser-first MVP
1. Add a standalone Telegram roster source.
2. Seed visible agents from that roster on startup/webview connect.
3. Display roster names in-office even with no Claude session behind them.
4. Keep all agents passive until Telegram events are wired.

---

## Proposed data model

Create a roster file concept for standalone mode:

`~/.pixel-agents/telegram-roster.json`

Example shape:

```json
{
  "agents": [
    {
      "key": "backup",
      "label": "Backup",
      "telegramBot": "@Backupmik3bot",
      "kind": "bot"
    },
    {
      "key": "tony",
      "label": "Tony",
      "telegramBot": "@Miketest4bot",
      "kind": "bot"
    }
  ]
}
```

Runtime mapping rules:
- `key`: stable identifier used for persistence/event routing
- `label`: display name in the office
- `telegramBot`: later event-source identity
- `kind`: optional classification for future rendering/filtering

For MVP, each roster entry becomes one passive `AgentState` with:
- `isExternal: true`
- `hooksOnly: true`
- no terminal
- no JSONL dependency
- deterministic synthetic `sessionId` / `jsonlFile` placeholders

---

## Task 1: Add Telegram roster schema + file loader

**Objective:** Introduce a single source of truth for which Telegram agents should appear in the office.

**Files:**
- Create: `server/src/telegramRoster.ts`
- Test: `server/__tests__/telegramRoster.test.ts`

**Step 1: Write failing test**

Test cases:
- missing file returns empty roster
- valid file returns normalized entries
- duplicate `key` values are rejected or deduped deterministically
- blank `label` falls back to `key`

**Step 2: Run test to verify failure**

Run:
`npm test -- telegramRoster`

Expected: FAIL because loader does not exist.

**Step 3: Write minimal implementation**

Implement:
- roster file path resolver under `~/.pixel-agents/telegram-roster.json`
- JSON read/parse with safe fallback
- `TelegramRosterEntry` type
- normalization helper

**Step 4: Run test to verify pass**

Run:
`npm test -- telegramRoster`

Expected: PASS

**Step 5: Commit**

```bash
git add server/src/telegramRoster.ts server/__tests__/telegramRoster.test.ts
git commit -m "feat: add telegram roster loader"
```

---

## Task 2: Add roster-backed passive agent seeding

**Objective:** Convert roster entries into visible standalone agents without Claude sessions.

**Files:**
- Modify: `server/src/agentStateStore.ts`
- Modify: `server/src/types.ts`
- Modify: `server/src/cli.ts`
- Modify: `server/src/clientMessageHandler.ts`
- Modify: `server/src/agentRuntime.ts` (or the current runtime restore seam actually responsible for external-agent restore)
- Test: `server/__tests__/telegramRosterSeeding.test.ts`

**Step 1: Write failing test**

Test cases:
- roster entries create one passive external agent each
- repeated startup does not duplicate seeded agents
- seeded agents survive webview reconnect
- seeded agents do not require `watchAllSessions` or hooks enabled

**Step 2: Run test to verify failure**

Run:
`npm test -- telegramRosterSeeding`

Expected: FAIL because no seeding path exists.

**Step 3: Write minimal implementation**

Implementation notes:
- add optional roster identity fields to `AgentState` / `PersistedAgent`, e.g.:
  - `rosterKey?: string`
  - `displayLabel?: string`
  - `sourceKind?: 'telegram-roster' | 'claude'`
- seed via a dedicated method, not by abusing file-watcher restore logic
- ensure IDs remain local/internal numeric IDs, while `rosterKey` is the stable external identity
- skip seeding duplicates when an agent with the same `rosterKey` already exists

**Step 4: Run test to verify pass**

Run:
`npm test -- telegramRosterSeeding`

Expected: PASS

**Step 5: Commit**

```bash
git add server/src/types.ts server/src/agentStateStore.ts server/src/cli.ts server/src/clientMessageHandler.ts server/src/agentRuntime.ts server/__tests__/telegramRosterSeeding.test.ts
git commit -m "feat: seed passive agents from telegram roster"
```

---

## Task 3: Send roster metadata to the browser

**Objective:** Ensure the UI receives human-friendly labels for Telegram-seeded agents.

**Files:**
- Modify: `server/src/httpServer.ts`
- Modify: `server/src/clientMessageHandler.ts`
- Modify: `webview-ui/src/hooks/useExtensionMessages.ts`
- Test: `server/__tests__/server.test.ts`
- Test: `webview-ui/test/*` or a new targeted hook/unit test if coverage exists there

**Step 1: Write failing test**

Test cases:
- `existingAgents` includes label metadata for seeded agents
- `agentCreated` includes label metadata for new roster-backed agents
- reconnect shows the same names

**Step 2: Run test to verify failure**

Run:
`npm test -- server`

Expected: FAIL on missing metadata.

**Step 3: Write minimal implementation**

Implementation notes:
- extend outgoing messages with a stable field like `agentLabels`
- or enrich `agentCreated` with `agentName`/`displayLabel` for non-teammate roster agents
- in `useExtensionMessages.ts`, map those values onto in-office characters instead of only teammate labels

**Step 4: Run test to verify pass**

Run:
`npm test -- server && cd webview-ui && npm test`

Expected: PASS

**Step 5: Commit**

```bash
git add server/src/httpServer.ts server/src/clientMessageHandler.ts webview-ui/src/hooks/useExtensionMessages.ts
git commit -m "feat: show telegram roster agent labels in office"
```

---

## Task 4: Add a simple operator-controlled roster editing path

**Objective:** Make it easy to change which Telegram agents appear, without editing code.

**Files:**
- Create: `docs/telegram-roster.md`
- Optional create: `server/src/telegramRosterCli.ts` or a lightweight WebSocket message path for roster updates
- Optional modify: `server/src/clientMessageHandler.ts`
- Optional modify: `webview-ui/src/components/SettingsModal.tsx`

**Step 1: Start with documentation-only fallback**

If we want the fastest path, first support manual JSON file editing and document it.

**Step 2: Add a better mutation path if needed**

Possible follow-up options:
- small CLI to write the roster file
- browser settings panel for add/remove/reorder

**Step 3: Verify**

Verification:
- edit roster
- restart server or trigger reload path
- office reflects exactly the configured Telegram roster

---

## Task 5: Prepare for Telegram event wiring

**Objective:** Make roster-backed agents ready to receive message/activity events later.

**Files:**
- Create: `server/src/telegramEvents.ts`
- Modify: `server/src/types.ts`
- Modify: `server/src/httpServer.ts`
- Modify: `server/src/clientMessageHandler.ts`

**Step 1: Define normalized event shape**

Suggested shape:

```ts
interface TelegramOfficeEvent {
  rosterKey: string;
  eventType: 'message_received' | 'message_sent' | 'thinking' | 'waiting' | 'idle';
  chatLabel?: string;
  preview?: string;
  at: number;
}
```

**Step 2: Add a local injection path before real Telegram integration**

Suggested endpoint:
`POST /api/telegram/events`

**Step 3: Broadcast into current office mechanics**

Map normalized events to existing agent activity/status messages first, then evolve visuals later.

**Step 4: Verify**

Manual test:
- POST event for `backup`
- observe matching in-office agent animate/change status

---

## Recommended migration order

1. Loader only
2. Passive roster seeding
3. Browser label propagation
4. Manual roster editing path
5. Mock Telegram event injection
6. Real Telegram ingestion

This preserves the working browser-first base while swapping the product model incrementally.

---

## Acceptance criteria for Milestone 1

- No automatic Claude hook/session activity is needed for startup.
- Standalone startup shows exactly the Telegram agents Mike wants to see.
- The browser office stays usable with zero Claude sessions.
- Agent identity is stable across refresh/restart.
- This milestone does not require real Telegram connectivity yet.

---

## Mike-specific roster candidates already known from profile/memory

Known Telegram bot identities that may be candidates once Mike confirms:
- `@Miketest4bot` (Tony)
- `@Backupmik3bot` (Backup)
- `@Hermes2bitbot`
- `@Backup3bitbot`

Do not hardcode visibility from memory alone. Mike should explicitly choose which ones appear in this office.
