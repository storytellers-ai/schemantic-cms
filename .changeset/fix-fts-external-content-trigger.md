---
"emdash": patch
---

Fixes republish failing with `CONTENT_PUBLISH_ERROR` on collections that have search enabled. The FTS5 update trigger used a plain `DELETE FROM <fts>` to remove the old row, which silently corrupts external-content FTS5 shadow tables and produces `SQLITE_CORRUPT_VTAB` ("database disk image is malformed") on subsequent writes. The trigger now uses the SQLite-recommended `INSERT INTO <fts>(<fts>, rowid, ...) VALUES('delete', ...)` form, and is split into two `WHEN`-guarded triggers so the delete command never fires for rows that were never indexed (e.g. when restoring a soft-deleted row), which would also corrupt the shadow tables. The delete trigger is likewise guarded to skip already-soft-deleted rows. Existing indexes built with the old single update trigger are detected at startup and rebuilt automatically.

Content write handlers (create, update, publish, unpublish, delete, restore, permanent-delete, duplicate, schedule, unschedule, discard-draft) now invoke `ensureSearchHealthy()` before operating, so auto-repair fires on the write path even in workers that never receive a search request. `dropFtsTable` also falls back to dropping FTS5 shadow tables by name when the virtual table itself cannot be dropped because of pre-existing corruption.
