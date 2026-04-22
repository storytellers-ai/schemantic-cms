import { sql } from "kysely";
import type { Kysely } from "kysely";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ContentRepository } from "../../../src/database/repositories/content.js";
import type { Database } from "../../../src/database/types.js";
import { SchemaRegistry } from "../../../src/schema/registry.js";
import { FTSManager } from "../../../src/search/fts-manager.js";
import { searchWithDb } from "../../../src/search/query.js";
import { setupTestDatabase, teardownTestDatabase } from "../../utils/test-db.js";

describe("FTS repair", () => {
	let db: Kysely<Database>;
	let registry: SchemaRegistry;
	let repo: ContentRepository;
	let ftsManager: FTSManager;
	let gameId: string;

	beforeEach(async () => {
		db = await setupTestDatabase();
		registry = new SchemaRegistry(db);
		repo = new ContentRepository(db);
		ftsManager = new FTSManager(db);

		await registry.createCollection({
			slug: "game",
			label: "Games",
			labelSingular: "Game",
			supports: ["search"],
		});
		await registry.createField("game", {
			slug: "title",
			label: "Title",
			type: "string",
			searchable: true,
		});
		await registry.createField("game", {
			slug: "blurb",
			label: "Blurb",
			type: "text",
			searchable: true,
		});

		const created = await repo.create({
			type: "game",
			slug: "trail-of-cthulhu",
			status: "published",
			publishedAt: new Date().toISOString(),
			data: {
				title: "Trail of Cthulhu",
				blurb: "Investigative horror in the Cthulhu mythos.",
			},
		});
		gameId = created.id;

		await ftsManager.enableSearch("game");
	});

	afterEach(async () => {
		await teardownTestDatabase(db);
	});

	it("recreates a missing FTS table when search remains enabled", async () => {
		expect(await ftsManager.ftsTableExists("game")).toBe(true);

		await ftsManager.dropFtsTable("game");

		expect(await ftsManager.ftsTableExists("game")).toBe(false);
		expect(
			await searchWithDb(db, "cthulhu", {
				collections: ["game"],
				status: "published",
			}),
		).toEqual({ items: [] });

		await expect(ftsManager.verifyAndRepairAll()).resolves.toBe(1);
		expect(await ftsManager.ftsTableExists("game")).toBe(true);

		const repaired = await searchWithDb(db, "cthulhu", {
			collections: ["game"],
			status: "published",
		});

		expect(repaired.items).toHaveLength(1);
		expect(repaired.items[0]?.slug).toBe("trail-of-cthulhu");
	});

	it("keeps the FTS index in sync after soft delete", async () => {
		await expect(repo.delete("game", gameId)).resolves.toBe(true);
		await expect(ftsManager.verifyAndRepairAll()).resolves.toBe(0);
	});

	it("rebuilds indexes that still use the legacy buggy update trigger", async () => {
		// Replace the current (fixed) update triggers with a single legacy
		// buggy trigger that corrupts external-content FTS5 shadow tables.
		await sql.raw(`DROP TRIGGER IF EXISTS "_emdash_fts_game_update_active"`).execute(db);
		await sql.raw(`DROP TRIGGER IF EXISTS "_emdash_fts_game_update_restore"`).execute(db);
		await sql
			.raw(`
			CREATE TRIGGER "_emdash_fts_game_update"
			AFTER UPDATE ON "ec_game"
			BEGIN
				DELETE FROM "_emdash_fts_game" WHERE rowid = OLD.rowid;
				INSERT INTO "_emdash_fts_game"(rowid, id, locale, title, blurb)
				SELECT NEW.rowid, NEW.id, NEW.locale, NEW.title, NEW.blurb
				WHERE NEW.deleted_at IS NULL;
			END
		`)
			.execute(db);

		await expect(ftsManager.verifyAndRepairAll()).resolves.toBe(1);

		// After rebuild, the legacy single trigger should be gone and the
		// split triggers should be in place.
		const triggers = await sql<{ name: string }>`
			SELECT name FROM sqlite_master
			WHERE type = 'trigger' AND name LIKE '_emdash_fts_game_%'
			ORDER BY name
		`.execute(db);
		const names = triggers.rows.map((r) => r.name);
		expect(names).not.toContain("_emdash_fts_game_update");
		expect(names).toContain("_emdash_fts_game_update_active");
		expect(names).toContain("_emdash_fts_game_update_restore");

		const result = await searchWithDb(db, "cthulhu", {
			collections: ["game"],
			status: "published",
		});
		expect(result.items).toHaveLength(1);
	});

	it("handles soft-delete followed by restore without corrupting the index", async () => {
		// Soft-delete the row. The update_active trigger should remove the
		// FTS entry via the external-content 'delete' command.
		await repo.delete("game", gameId);
		let result = await searchWithDb(db, "cthulhu", {
			collections: ["game"],
			status: "published",
		});
		expect(result.items).toEqual([]);

		// Restore the row. The update_restore trigger should re-insert it
		// without trying to delete a non-existent FTS entry (which would
		// corrupt the shadow tables).
		await sql`UPDATE ${sql.ref("ec_game")} SET deleted_at = NULL WHERE id = ${gameId}`.execute(db);

		result = await searchWithDb(db, "cthulhu", {
			collections: ["game"],
			status: "published",
		});
		expect(result.items).toHaveLength(1);

		// A subsequent update on the restored row should not corrupt the
		// index — this is the regression from the interim fix.
		await sql`UPDATE ${sql.ref("ec_game")} SET title = ${"Trail of Cthulhu (Revised)"} WHERE id = ${gameId}`.execute(
			db,
		);

		result = await searchWithDb(db, "revised", {
			collections: ["game"],
			status: "published",
		});
		expect(result.items).toHaveLength(1);
	});
});
