/**
 * Auth CLI commands
 */

import { defineCommand } from "citty";
import { consola } from "consola";
import pc from "picocolors";

import { encodeBase64url } from "../../utils/base64.js";

/**
 * Generate a cryptographically secure auth secret
 */
function generateAuthSecret(): string {
	const bytes = new Uint8Array(32);
	crypto.getRandomValues(bytes);
	return encodeBase64url(bytes);
}

const secretCommand = defineCommand({
	meta: {
		name: "secret",
		description: "Generate a secure auth secret",
	},
	run() {
		const secret = generateAuthSecret();

		consola.log("");
		consola.log(pc.bold("Generated auth secret:"));
		consola.log("");
		consola.log(`  ${pc.cyan("EMDASH_AUTH_SECRET")}=${pc.green(secret)}`);
		consola.log("");
		consola.log(pc.dim("Add this to your environment variables."));
		consola.log("");
	},
});

export const authCommand = defineCommand({
	meta: {
		name: "auth",
		description: "Authentication utilities",
	},
	subCommands: {
		secret: secretCommand,
	},
});
