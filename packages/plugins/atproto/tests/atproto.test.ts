import { describe, it, expect } from "vitest";

import { rkeyFromUri } from "../src/atproto.js";

describe("rkeyFromUri", () => {
	it("extracts rkey from a standard AT-URI", () => {
		const rkey = rkeyFromUri("at://did:plc:abc123/site.standard.document/3lwafzkjqm25s");
		expect(rkey).toBe("3lwafzkjqm25s");
	});

	it("extracts rkey from a Bluesky post URI", () => {
		const rkey = rkeyFromUri("at://did:plc:abc123/app.bsky.feed.post/3k4duaz5vfs2b");
		expect(rkey).toBe("3k4duaz5vfs2b");
	});

	it("throws on empty URI", () => {
		expect(() => rkeyFromUri("")).toThrow("Invalid AT-URI");
	});
});
