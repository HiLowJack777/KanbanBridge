# Local Desktop Project Board

An offline-first desktop project board based on the supplied blueprint.

The first cut uses Electron, React, TypeScript, dnd-kit, and a local SQLite file managed through `sql.js`.

## Run

```powershell
pnpm install
pnpm build
pnpm start
```

## Desktop Shortcut

To build a shell-free Windows app and place a shortcut on the Desktop:

```powershell
pnpm install:desktop
```

The shortcut launches `desktop-release/win-unpacked/Project Board.exe` directly, so no terminal window opens.

For active development:

```powershell
pnpm dev
```

## Local Data

The app stores data under the user's local app data folder in `ProjectBoard/workspace.sqlite`.
Manual backups are written to `ProjectBoard/backups/manual/`.
