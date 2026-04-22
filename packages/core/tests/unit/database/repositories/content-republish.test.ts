import type { Kysely } from "kysely";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ContentRepository } from "../../../../src/database/repositories/content.js";
import { RevisionRepository } from "../../../../src/database/repositories/revision.js";
import type { Database } from "../../../../src/database/types.js";
import { SchemaRegistry } from "../../../../src/schema/registry.js";
import { FTSManager } from "../../../../src/search/fts-manager.js";
import { createPostFixture } from "../../../utils/fixtures.js";
import { setupTestDatabaseWithCollections, teardownTestDatabase } from "../../../utils/test-db.js";

describe("ContentRepository republish", () => {
	let db: Kysely<Database>;
	let repo: ContentRepository;

	beforeEach(async () => {
		db = await setupTestDatabaseWithCollections();
		repo = new ContentRepository(db);
	});

	afterEach(async () => {
		await teardownTestDatabase(db);
	});

	async function enableSearchOnPosts(): Promise<void> {
		const registry = new SchemaRegistry(db);
		await registry.updateField("post", "title", { searchable: true });
		await registry.updateField("post", "content", { searchable: true });
		await registry.updateCollection("post", {
			supports: ["drafts", "revisions", "search"],
		});
		const ftsManager = new FTSManager(db);
		await ftsManager.enableSearch("post");
	}

	it("should allow republishing without edits", async () => {
		const post = await repo.create(createPostFixture());
		const first = await repo.publish("post", post.id);
		expect(first.status).toBe("published");

		const second = await repo.publish("post", post.id);
		expect(second.status).toBe("published");
	});

	it("should allow republishing with a draft revision staged after publish", async () => {
		const post = await repo.create(createPostFixture());
		await repo.publish("post", post.id);

		const revisionRepo = new RevisionRepository(db);
		const draft = await revisionRepo.create({
			collection: "post",
			entryId: post.id,
			data: { ...post.data, title: "Updated after publish" },
		});
		await repo.setDraftRevision("post", post.id, draft.id);

		const republished = await repo.publish("post", post.id);
		expect(republished.status).toBe("published");
		expect(republished.data.title).toBe("Updated after publish");
	});

	it("should allow republishing after plain update", async () => {
		const post = await repo.create(createPostFixture());
		await repo.publish("post", post.id);

		await repo.update("post", post.id, {
			data: { title: "Updated after publish" },
		});

		const republished = await repo.publish("post", post.id);
		expect(republished.status).toBe("published");
	});

	it("should allow republishing without edits when FTS search is enabled", async () => {
		await enableSearchOnPosts();

		const post = await repo.create(createPostFixture());
		const first = await repo.publish("post", post.id);
		expect(first.status).toBe("published");

		const second = await repo.publish("post", post.id);
		expect(second.status).toBe("published");
	});

	it("should allow republishing with draft revision when FTS search is enabled", async () => {
		await enableSearchOnPosts();

		const post = await repo.create(createPostFixture());
		await repo.publish("post", post.id);

		const revisionRepo = new RevisionRepository(db);
		const draft = await revisionRepo.create({
			collection: "post",
			entryId: post.id,
			data: { ...post.data, title: "Updated after publish" },
		});
		await repo.setDraftRevision("post", post.id, draft.id);

		const republished = await repo.publish("post", post.id);
		expect(republished.status).toBe("published");
		expect(republished.data.title).toBe("Updated after publish");
	});
});
