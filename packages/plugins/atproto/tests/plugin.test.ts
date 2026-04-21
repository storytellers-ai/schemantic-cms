import { describe, it, expect } from "vitest";

import { atprotoPlugin, createPlugin } from "../src/index.js";

describe("atprotoPlugin descriptor", () => {
	it("returns a valid PluginDescriptor", () => {
		const descriptor = atprotoPlugin();
		expect(descriptor.id).toBe("atproto");
		expect(descriptor.version).toBe("0.1.0");
		expect(descriptor.entrypoint).toBe("@emdash-cms/plugin-atproto");
		expect(descriptor.adminPages).toHaveLength(1);
		expect(descriptor.adminWidgets).toHaveLength(1);
	});

	it("passes options through", () => {
		const descriptor = atprotoPlugin({});
		expect(descriptor.options).toEqual({});
	});
});

describe("createPlugin", () => {
	it("returns a valid ResolvedPlugin", () => {
		const plugin = createPlugin();
		expect(plugin.id).toBe("atproto");
		expect(plugin.version).toBe("0.1.0");
		expect(plugin.capabilities).toContain("read:content");
		expect(plugin.capabilities).toContain("network:fetch:any");
	});

	it("uses unrestricted network access (implies network:fetch)", () => {
		const plugin = createPlugin();
		expect(plugin.capabilities).toContain("network:fetch:any");
		// network:fetch:any implies network:fetch via definePlugin normalization
		expect(plugin.capabilities).toContain("network:fetch");
	});

	it("declares storage with records collection", () => {
		const plugin = createPlugin();
		expect(plugin.storage).toHaveProperty("records");
		expect(plugin.storage!.records!.indexes).toContain("contentId");
		expect(plugin.storage!.records!.indexes).toContain("status");
	});

	it("has content:afterSave hook with errorPolicy continue", () => {
		const plugin = createPlugin();
		const hook = plugin.hooks!["content:afterSave"];
		expect(hook).toBeDefined();
		// Hook is configured with full config object
		expect((hook as { errorPolicy: string }).errorPolicy).toBe("continue");
	});

	it("has content:afterDelete hook", () => {
		const plugin = createPlugin();
		expect(plugin.hooks!["content:afterDelete"]).toBeDefined();
	});

	it("has page:metadata hook", () => {
		const plugin = createPlugin();
		expect(plugin.hooks!["page:metadata"]).toBeDefined();
	});

	it("has settings schema with required fields", () => {
		const plugin = createPlugin();
		const schema = plugin.admin!.settingsSchema!;
		expect(schema).toHaveProperty("handle");
		expect(schema).toHaveProperty("appPassword");
		expect(schema).toHaveProperty("siteUrl");
		expect(schema).toHaveProperty("enableBskyCrosspost");
		expect(schema).toHaveProperty("crosspostTemplate");
		expect(schema).toHaveProperty("langs");
		expect(schema.appPassword!.type).toBe("secret");
	});

	it("has routes for status, test-connection, sync-publication", () => {
		const plugin = createPlugin();
		expect(plugin.routes).toHaveProperty("status");
		expect(plugin.routes).toHaveProperty("test-connection");
		expect(plugin.routes).toHaveProperty("sync-publication");
		expect(plugin.routes).toHaveProperty("recent-syncs");
		expect(plugin.routes).toHaveProperty("verification");
	});
});
