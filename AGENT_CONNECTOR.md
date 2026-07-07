# KanbanBridge Agent Connector

KanbanBridge includes a local connector that coding agents can use to capture observations and update cards while the desktop app is open.

The connector listens on `127.0.0.1:38731`. It is intended for local automation only.

## Safety Model

Card-changing commands require an explicit project target:

- `--project-id <id>`
- `--project-name "Project name"`

The connector refuses ambiguous card creation, move, tag, and untag requests. This prevents an agent from accidentally using whichever project is active in the UI.

Start by listing projects:

```powershell
node scripts/agent-bridge.mjs projects
```

## Preferred CLI Usage

Create an observation:

```powershell
node scripts/agent-bridge.mjs observe "Observation text here" --source codex --project-name "My Project"
```

Create a linked card:

```powershell
node scripts/agent-bridge.mjs card "Fix the empty-state layout" `
  --project-name "My Project" `
  --column Backlog `
  --priority Medium `
  --observation-id <observation-id>
```

Move a card:

```powershell
node scripts/agent-bridge.mjs move-card <card-id> --project-name "My Project" --column "In Progress"
```

Update a card by ID:

```powershell
node scripts/agent-bridge.mjs update-card <card-id> --priority High
```

## pnpm Aliases

```powershell
pnpm agent -- projects
pnpm agent:observe -- "Observation text here" --source claude-code --project-name "My Project"
pnpm agent:card -- "Fix the empty-state layout" --project-name "My Project" --column Backlog
pnpm agent:card:move -- <card-id> --project-name "My Project" --column Review
pnpm agent:card:update -- <card-id> --priority High
```

## How It Works

- If KanbanBridge is running, commands post to `http://127.0.0.1:38731`.
- Changes go through the app service layer, then the app broadcasts a live refresh event to open windows.
- Observations can be queued while the app is closed in `%LOCALAPPDATA%\ProjectBoard\agent-inbox.jsonl`.
- Card changes require KanbanBridge to be open so agents do not edit the SQLite database directly.
- Work created from an observation should use `--observation-id <id>`. This creates the card-to-observation link and applies a short visual tag like `Obs: 5bd9c675`.

The `ProjectBoard` local data folder name is retained for compatibility with earlier builds.

## CLI Commands

List projects:

```powershell
node scripts/agent-bridge.mjs projects
```

Read the live snapshot:

```powershell
node scripts/agent-bridge.mjs snapshot --project-name "My Project"
```

List observations:

```powershell
node scripts/agent-bridge.mjs list --project-name "My Project" --limit 20
```

Create a card:

```powershell
node scripts/agent-bridge.mjs card "Card title" `
  --project-name "My Project" `
  --column Backlog `
  --description "Details" `
  --priority High `
  --observation-id <observation-id> `
  --checklist "First step|Second step"
```

Update a card:

```powershell
node scripts/agent-bridge.mjs update-card <card-id> --title "New title" --priority Medium
```

Move a card:

```powershell
node scripts/agent-bridge.mjs move-card <card-id> --project-name "My Project" --column "In Progress"
```

Add a checklist item:

```powershell
node scripts/agent-bridge.mjs checklist <card-id> "Checklist item text"
```

Link or unlink a card to a specific observation:

```powershell
node scripts/agent-bridge.mjs link-observation <card-id> <observation-id>
node scripts/agent-bridge.mjs unlink-observation <card-id> <observation-id>
```

Tag or untag an existing card:

```powershell
node scripts/agent-bridge.mjs tag-card <card-id> --project-name "My Project" --name "Obs: 5bd9c675"
node scripts/agent-bridge.mjs untag-card <card-id> --project-name "My Project" --name Observation
```

Archive a card:

```powershell
node scripts/agent-bridge.mjs archive-card <card-id>
```

Archive an observation:

```powershell
node scripts/agent-bridge.mjs archive <observation-id>
```

## HTTP API

Health check:

```powershell
curl http://127.0.0.1:38731/health
```

List projects:

```powershell
curl http://127.0.0.1:38731/projects
```

Read snapshot:

```powershell
curl "http://127.0.0.1:38731/snapshot?projectName=My%20Project"
```

Create observation:

```powershell
curl -Method POST http://127.0.0.1:38731/observations `
  -ContentType "application/json" `
  -Body '{"body":"Observation text","source":"cursor","projectName":"My Project","kind":"observation"}'
```

Create card:

```powershell
curl -Method POST http://127.0.0.1:38731/cards `
  -ContentType "application/json" `
  -Body '{"projectName":"My Project","title":"Card title","columnName":"Backlog","priority":"High","observationId":"<observation-id>","checklist":["First step","Second step"]}'
```

Move card:

```powershell
curl -Method POST http://127.0.0.1:38731/cards/<card-id>/move `
  -ContentType "application/json" `
  -Body '{"projectName":"My Project","columnName":"In Progress"}'
```

Tag card:

```powershell
curl -Method POST http://127.0.0.1:38731/cards/<card-id>/tags `
  -ContentType "application/json" `
  -Body '{"projectName":"My Project","name":"Obs: 5bd9c675"}'
```

Remove tag:

```powershell
curl -Method POST http://127.0.0.1:38731/cards/<card-id>/tags/remove `
  -ContentType "application/json" `
  -Body '{"projectName":"My Project","name":"Observation"}'
```

Update card:

```powershell
curl -Method PATCH http://127.0.0.1:38731/cards/<card-id> `
  -ContentType "application/json" `
  -Body '{"priority":"Medium"}'
```

Link observation:

```powershell
curl -Method POST http://127.0.0.1:38731/cards/<card-id>/observations `
  -ContentType "application/json" `
  -Body '{"observationId":"<observation-id>"}'
```

Unlink observation:

```powershell
curl -Method POST http://127.0.0.1:38731/cards/<card-id>/observations/remove `
  -ContentType "application/json" `
  -Body '{"observationId":"<observation-id>"}'
```
