---
"emdash": patch
---

Fixes republish failing with `CONTENT_PUBLISH_ERROR` on collections that have search enabled. The FTS5 update trigger used a plain `DELETE FROM <fts>` to remove the old row, which silently corrupts external-content FTS5 shadow tables and produces `SQLITE_CORRUPT_VTAB` ("database disk image is malformed") on subsequent writes. The trigger now uses the SQLite-recommended `INSERT INTO <fts>(<fts>, rowid, ...) VALUES('delete', ...)` form, and is split into two `WHEN`-guarded triggers so the delete command never fires for rows that were never indexed (e.g. when restoring a soft-deleted row), which would also corrupt the shadow tables. The delete trigger is likewise guarded to skip already-soft-deleted rows. Existing indexes built with the old single update trigger are detected at startup and rebuilt automatically.
