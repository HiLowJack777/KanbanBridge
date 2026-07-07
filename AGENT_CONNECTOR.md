# Project Board Agent Connector

This repo includes a small connector that any local coding agent can use to update Project Board.

Use this when Codex, Claude Code, Cursor, or another agent notices something worth saving or needs to create/update cards while working in any project.

When Project Board is open, connector changes go through the running Electron app and the open window refreshes automatically.

## Preferred Commands

From this repo:

```powershell
node scripts/agent-bridge.mjs observe "Observation text here" --source codex --project-path "C:\path\to\project"
node scripts/agent-bridge.mjs card "Fix the empty-state layout" --column Backlog --priority Medium --observation-id <observation-id>
node scripts/agent-bridge.mjs update-card <card-id> --priority High
```

Or through pnpm:

```powershell
pnpm agent:observe -- "Observation text here" --source claude-code --project-path "C:\path\to\project"
pnpm agent:card -- "Fix the empty-state layout" --column Backlog --priority Medium --observation-id <observation-id>
pnpm agent:card:update -- <card-id> --priority High
```

## How It Works

- If Project Board is running, commands post to `http://127.0.0.1:38731`.
- Card and observation changes are written through the app's own service layer, then the app broadcasts a live refresh event to the open window.
- If Project Board is closed, the command queues the observation in `%LOCALAPPDATA%\ProjectBoard\agent-inbox.jsonl`.
- The app imports queued observations the next time it opens or refreshes its snapshot.
- Card changes require Project Board to be open so agents do not edit the SQLite database while the app is closed.
- Work created from an observation should use `--observation-id <id>`. This creates the first-class card-to-observation link and also applies a short visual tag like `Obs: 5bd9c675`.

## CLI Commands

Read the live app snapshot:

```powershell
node scripts/agent-bridge.mjs snapshot
pnpm agent:snapshot
```

Create a card:

```powershell
node scripts/agent-bridge.mjs card "Card title" --column Backlog --description "Details" --priority High --observation-id <observation-id> --checklist "First step|Second step"
pnpm agent:card -- "Card title" --column Backlog --priority High --observation-id <observation-id>
```

Update a card:

```powershell
node scripts/agent-bridge.mjs update-card <card-id> --title "New title" --priority Medium
pnpm agent:card:update -- <card-id> --description "Updated details"
```

Move a card:

```powershell
node scripts/agent-bridge.mjs move-card <card-id> --column "In Progress"
pnpm agent:card:move -- <card-id> --column Review
```

Add a checklist item:

```powershell
node scripts/agent-bridge.mjs checklist <card-id> "Checklist item text"
pnpm agent:checklist -- <card-id> "Checklist item text"
```

Link or unlink a card to a specific observation:

```powershell
node scripts/agent-bridge.mjs link-observation <card-id> <observation-id>
node scripts/agent-bridge.mjs unlink-observation <card-id> <observation-id>
pnpm agent:observation:link -- <card-id> <observation-id>
pnpm agent:observation:unlink -- <card-id> <observation-id>
```

Tag or untag an existing card:

```powershell
node scripts/agent-bridge.mjs tag-card <card-id> --name "Obs: 5bd9c675"
node scripts/agent-bridge.mjs untag-card <card-id> --name Observation
pnpm agent:card:tag -- <card-id> --name "Obs: 5bd9c675"
pnpm agent:card:untag -- <card-id> --name Observation
```

Archive a card:

```powershell
node scripts/agent-bridge.mjs archive-card <card-id>
pnpm agent:card:archive -- <card-id>
```

## HTTP API

Health check:

```powershell
curl http://127.0.0.1:38731/health
```

Read snapshot:

```powershell
curl http://127.0.0.1:38731/snapshot
```

Create observation:

```powershell
curl -Method POST http://127.0.0.1:38731/observations `
  -ContentType "application/json" `
  -Body '{"body":"Observation text","source":"cursor","projectPath":"C:\\repo","kind":"observation"}'
```

List observations:

```powershell
curl http://127.0.0.1:38731/observations
```

Create card:

```powershell
curl -Method POST http://127.0.0.1:38731/cards `
  -ContentType "application/json" `
  -Body '{"title":"Card title","columnName":"Backlog","priority":"High","observationId":"5bd9c675-06b9-4973-8c51-76ec605ddba7","checklist":["First step","Second step"]}'
```

Update card:

```powershell
curl -Method PATCH http://127.0.0.1:38731/cards/<card-id> `
  -ContentType "application/json" `
  -Body '{"priority":"Medium"}'
```

Move card:

```powershell
curl -Method POST http://127.0.0.1:38731/cards/<card-id>/move `
  -ContentType "application/json" `
  -Body '{"columnName":"In Progress"}'
```

Tag card:

```powershell
curl -Method POST http://127.0.0.1:38731/cards/<card-id>/tags `
  -ContentType "application/json" `
  -Body '{"name":"Obs: 5bd9c675"}'
```

Remove tag:

```powershell
curl -Method POST http://127.0.0.1:38731/cards/<card-id>/tags/remove `
  -ContentType "application/json" `
  -Body '{"name":"Observation"}'
```

Link observation:

```powershell
curl -Method POST http://127.0.0.1:38731/cards/<card-id>/observations `
  -ContentType "application/json" `
  -Body '{"observationId":"5bd9c675-06b9-4973-8c51-76ec605ddba7"}'
```

Unlink observation:

```powershell
curl -Method POST http://127.0.0.1:38731/cards/<card-id>/observations/remove `
  -ContentType "application/json" `
  -Body '{"observationId":"5bd9c675-06b9-4973-8c51-76ec605ddba7"}'
```

Archive observation:

```powershell
node scripts/agent-bridge.mjs archive <observation-id>
pnpm agent:archive -- <observation-id>
```
