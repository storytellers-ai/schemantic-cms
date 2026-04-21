/**
 * SSRF protection for import URLs.
 *
 * Validates that URLs don't target internal/private network addresses.
 * Applied before any fetch() call in the import pipeline.
 */

const IPV4_MAPPED_IPV6_DOTTED_PATTERN = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i;
const IPV4_MAPPED_IPV6_HEX_PATTERN = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i;
const IPV4_TRANSLATED_HEX_PATTERN = /^::ffff:0:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i;
const IPV6_EXPANDED_MAPPED_PATTERN =
	/^0{0,4}:0{0,4}:0{0,4}:0{0,4}:0{0,4}:ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i;

/**
 * IPv4-compatible (deprecated) addresses: ::XXXX:XXXX
 *
 * The WHATWG URL parser normalizes [::127.0.0.1] to [::7f00:1] (no ffff prefix).
 * These are deprecated but still parsed, and bypass the ffff-based checks.
 */
const IPV4_COMPATIBLE_HEX_PATTERN = /^::([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i;

/**
 * NAT64 prefix (RFC 6052): 64:ff9b::XXXX:XXXX
 *
 * Used by NAT64 gateways to embed IPv4 addresses in IPv6.
 * [64:ff9b::127.0.0.1] normalizes to [64:ff9b::7f00:1].
 */
const NAT64_HEX_PATTERN = /^64:ff9b::([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i;

const IPV6_BRACKET_PATTERN = /^\[|\]$/g;

/**
 * Private and reserved IP ranges that should never be fetched.
 *
 * Includes:
 * - Loopback (127.0.0.0/8)
 * - Private (10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16)
 * - Link-local (169.254.0.0/16)
 * - Cloud metadata (169.254.169.254 — AWS/GCP/Azure)
 * - IPv6 loopback and link-local
 */
const BLOCKED_PATTERNS: Array<{ start: number; end: number }> = [
	// 127.0.0.0/8 — loopback
	{ start: ip4ToNum(127, 0, 0, 0), end: ip4ToNum(127, 255, 255, 255) },
	// 10.0.0.0/8 — private
	{ start: ip4ToNum(10, 0, 0, 0), end: ip4ToNum(10, 255, 255, 255) },
	// 172.16.0.0/12 — private
	{ start: ip4ToNum(172, 16, 0, 0), end: ip4ToNum(172, 31, 255, 255) },
	// 192.168.0.0/16 — private
	{ start: ip4ToNum(192, 168, 0, 0), end: ip4ToNum(192, 168, 255, 255) },
	// 169.254.0.0/16 — link-local (includes cloud metadata endpoint)
	{ start: ip4ToNum(169, 254, 0, 0), end: ip4ToNum(169, 254, 255, 255) },
	// 0.0.0.0/8 — current network
	{ start: ip4ToNum(0, 0, 0, 0), end: ip4ToNum(0, 255, 255, 255) },
];

const BLOCKED_HOSTNAMES = new Set([
	"localhost",
	"metadata.google.internal",
	"metadata.google",
	"[::1]",
]);

/** Blocked URL schemes */
const ALLOWED_SCHEMES = new Set(["http:", "https:"]);

function ip4ToNum(a: number, b: number, c: number, d: number): number {
	return ((a << 24) | (b << 16) | (c << 8) | d) >>> 0;
}

function parseIpv4(ip: string): number | null {
	const parts = ip.split(".");
	if (parts.length !== 4) return null;

	const nums = parts.map(Number);
	if (nums.some((n) => isNaN(n) || n < 0 || n > 255)) return null;

	return ip4ToNum(nums[0], nums[1], nums[2], nums[3]);
}

/**
 * Convert IPv4-mapped/translated IPv6 addresses from hex form back to IPv4.
 *
 * The WHATWG URL parser normalizes dotted-decimal to hex:
 *   [::ffff:127.0.0.1] -> [::ffff:7f00:1]
 *   [::ffff:169.254.169.254] -> [::ffff:a9fe:a9fe]
 *
 * Without this conversion, the hex forms bypass isPrivateIp() regex checks.
 */
export function normalizeIPv6MappedToIPv4(ip: string): string | null {
	// Match hex-form IPv4-mapped IPv6: ::ffff:XXXX:XXXX
	let match = ip.match(IPV4_MAPPED_IPV6_HEX_PATTERN);
	if (!match) {
		// Match IPv4-translated (RFC 6052): ::ffff:0:XXXX:XXXX
		match = ip.match(IPV4_TRANSLATED_HEX_PATTERN);
	}
	if (!match) {
		// Match fully expanded form: 0000:0000:0000:0000:0000:ffff:XXXX:XXXX
		match = ip.match(IPV6_EXPANDED_MAPPED_PATTERN);
	}
	if (!match) {
		// Match IPv4-compatible (deprecated) form: ::XXXX:XXXX (no ffff prefix)
		match = ip.match(IPV4_COMPATIBLE_HEX_PATTERN);
	}
	if (!match) {
		// Match NAT64 prefix (RFC 6052): 64:ff9b::XXXX:XXXX
		match = ip.match(NAT64_HEX_PATTERN);
	}
	if (match) {
		const high = parseInt(match[1] ?? "", 16);
		const low = parseInt(match[2] ?? "", 16);
		return `${(high >> 8) & 0xff}.${high & 0xff}.${(low >> 8) & 0xff}.${low & 0xff}`;
	}
	return null;
}

function isPrivateIp(ip: string): boolean {
	// Handle IPv6 loopback
	if (ip === "::1" || ip === "::ffff:127.0.0.1") return true;

	// Handle IPv4-mapped IPv6 in hex form (WHATWG URL parser normalizes to this)
	// e.g. ::ffff:7f00:1 -> 127.0.0.1, ::ffff:a9fe:a9fe -> 169.254.169.254
	const hexIpv4 = normalizeIPv6MappedToIPv4(ip);
	if (hexIpv4) return isPrivateIp(hexIpv4);

	// Handle IPv4-mapped IPv6 in dotted-decimal form
	const v4Match = ip.match(IPV4_MAPPED_IPV6_DOTTED_PATTERN);
	const ipv4 = v4Match ? v4Match[1] : ip;

	const num = parseIpv4(ipv4);
	if (num === null) {
		// If we can't parse it, block IPv6 addresses that look internal
		return ip.startsWith("fe80:") || ip.startsWith("fc") || ip.startsWith("fd");
	}

	return BLOCKED_PATTERNS.some((range) => num >= range.start && num <= range.end);
}

/**
 * Error thrown when SSRF protection blocks a URL.
 */
export class SsrfError extends Error {
	code = "SSRF_BLOCKED" as const;

	constructor(message: string) {
		super(message);
		this.name = "SsrfError";
	}
}

/**
 * Validate that a URL is safe to fetch (not targeting internal networks).
 *
 * Checks:
 * 1. URL is well-formed with http/https scheme
 * 2. Hostname is not a known internal name (localhost, metadata endpoints)
 * 3. If hostname is an IP literal, it's not in a private range
 *
 * Note: DNS rebinding attacks are not fully mitigated (hostname could resolve
 * to a private IP). Full protection requires resolving DNS and checking the IP
 * before connecting, which needs a custom fetch implementation. This covers
 * the most common SSRF vectors.
 *
 * @throws SsrfError if the URL targets an internal address
 */
/** Maximum number of redirects to follow in ssrfSafeFetch */
const MAX_REDIRECTS = 5;

export function validateExternalUrl(url: string): URL {
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		throw new SsrfError("Invalid URL");
	}

	// Only allow http/https
	if (!ALLOWED_SCHEMES.has(parsed.protocol)) {
		throw new SsrfError(`Scheme '${parsed.protocol}' is not allowed`);
	}

	// Strip brackets from IPv6 hostname
	const hostname = parsed.hostname.replace(IPV6_BRACKET_PATTERN, "");

	// Check against known internal hostnames
	if (BLOCKED_HOSTNAMES.has(hostname.toLowerCase())) {
		throw new SsrfError("URLs targeting internal hosts are not allowed");
	}

	// Check if hostname is an IP address in a private range
	if (isPrivateIp(hostname)) {
		throw new SsrfError("URLs targeting private IP addresses are not allowed");
	}

	return parsed;
}

/**
 * Fetch a URL with SSRF protection on redirects.
 *
 * Uses `redirect: "manual"` to intercept redirects and re-validate each
 * redirect target against SSRF rules before following it. This prevents
 * an attacker from setting up an allowed external URL that redirects to
 * an internal IP (e.g. 169.254.169.254 for cloud metadata).
 *
 * @throws SsrfError if the initial URL or any redirect target is internal
 */
/** Headers that must be stripped when a redirect crosses origins */
const CREDENTIAL_HEADERS = ["authorization", "cookie", "proxy-authorization"];

export async function ssrfSafeFetch(url: string, init?: RequestInit): Promise<Response> {
	let currentUrl = url;
	let currentInit = init;

	for (let i = 0; i <= MAX_REDIRECTS; i++) {
		validateExternalUrl(currentUrl);

		const response = await globalThis.fetch(currentUrl, {
			...currentInit,
			redirect: "manual",
		});

		// Not a redirect -- return directly
		if (response.status < 300 || response.status >= 400) {
			return response;
		}

		// Extract redirect target
		const location = response.headers.get("Location");
		if (!location) {
			return response;
		}

		// Resolve relative redirects against the current URL
		const previousOrigin = new URL(currentUrl).origin;
		currentUrl = new URL(location, currentUrl).href;
		const nextOrigin = new URL(currentUrl).origin;

		// Strip credential headers on cross-origin redirects
		if (previousOrigin !== nextOrigin && currentInit) {
			currentInit = stripCredentialHeaders(currentInit);
		}
	}

	throw new SsrfError(`Too many redirects (max ${MAX_REDIRECTS})`);
}

/**
 * Return a copy of init with credential headers removed.
 */
export function stripCredentialHeaders(init: RequestInit): RequestInit {
	if (!init.headers) return init;

	const headers = new Headers(init.headers);
	for (const name of CREDENTIAL_HEADERS) {
		headers.delete(name);
	}

	return { ...init, headers };
}
