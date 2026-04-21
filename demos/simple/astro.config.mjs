// @ts-check
import cloudflare from "@astrojs/cloudflare";
import react from "@astrojs/react";
import { d1, r2 } from "@emdash-cms/cloudflare";
import { defineConfig } from "astro/config";
import emdash from "emdash/astro";

const SITE_URL = process.env.EMDASH_SITE_URL ?? "https://cms.schemantic.io";

export default defineConfig({
	site: SITE_URL,
	output: "server",
	adapter: cloudflare({
		imageService: "cloudflare",
	}),
	integrations: [
		react(),
		emdash({
			database: d1({ binding: "DB", session: "auto" }),
			storage: r2({ binding: "MEDIA" }),
			siteUrl: SITE_URL,
		}),
	],
	devToolbar: { enabled: false },
	vite: {
		server: {
			allowedHosts: ["cms.schemantic.io"],
		},
	},
});
