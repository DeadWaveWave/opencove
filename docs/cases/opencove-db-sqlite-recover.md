# OpenCove DB SQLite Recover

Use `pnpm recover:opencove-db` when SQLite can still produce a `.recover` dump and you need to rebuild an OpenCove profile database offline.

## Inputs

- `--recover-sql`: output from `sqlite3 /path/to/opencove.db ".recover"`.
- `--source-db`: original damaged database, used to preserve `app_settings`, browser profile data, and current app metadata.
- `--output-db`: rebuilt database path.

## Selector

Pick the target workspace with one of:

- `--workspace-id`
- `--workspace-name` plus `--workspace-path`

## Example

```bash
sqlite3 /path/to/opencove.db ".recover" > /path/to/opencove-recover.sql
pnpm recover:opencove-db -- \
  --recover-sql /path/to/opencove-recover.sql \
  --source-db /path/to/opencove.db \
  --output-db /path/to/opencove-rebuilt.db \
  --workspace-name cove \
  --workspace-path /path/to/workspace
```

## Notes

- The script writes a fresh SQLite database; it does not modify the source file.
- It keeps the selected workspace and related nodes/spaces, plus browser profile tables when present.
- If the source database contains multiple workspaces, the selector must be unambiguous.
