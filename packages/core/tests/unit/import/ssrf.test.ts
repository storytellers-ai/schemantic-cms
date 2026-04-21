/**
 * Tests for SSRF protection in import/ssrf.ts
 *
 * Covers:
 * - IPv4-mapped IPv6 hex normalization (#58)
 * - Private IP detection across all forms
 * - validateExternalUrl blocking internal targets
 */

import { describe, it, expect } from "vitest";

import {
	validateExternalUrl,
	SsrfError,
	normalizeIPv6MappedToIPv4,
} from "../../../src/import/ssrf.js";

describe("validateExternalUrl", () => {
	// =========================================================================
	// Basic validation
	// =========================================================================

	it("accepts valid external URLs", () => {
		expect(validateExternalUrl("https://example.com")).toBeInstanceOf(URL);
		expect(validateExternalUrl("https://wordpress.org/feed")).toBeInstanceOf(URL);
		expect(validateExternalUrl("http://93.184.216.34/path")).toBeInstanceOf(URL);
	});

	it("rejects non-http schemes", () => {
		expect(() => validateExternalUrl("ftp://example.com")).toThrow(SsrfError);
		expect(() => validateExternalUrl("file:///etc/passwd")).toThrow(SsrfError);
		expect(() => validateExternalUrl("javascript:alert(1)")).toThrow(SsrfError);
	});

	it("rejects invalid URLs", () => {
		expect(() => validateExternalUrl("not a url")).toThrow(SsrfError);
		expect(() => validateExternalUrl("")).toThrow(SsrfError);
	});

	// =========================================================================
	// Blocked hostnames
	// =========================================================================

	it("blocks localhost", () => {
		expect(() => validateExternalUrl("http://localhost/path")).toThrow(SsrfError);
		expect(() => validateExternalUrl("http://localhost:8080")).toThrow(SsrfError);
	});

	it("blocks metadata endpoints", () => {
		expect(() => validateExternalUrl("http://metadata.google.internal/")).toThrow(SsrfError);
	});

	// =========================================================================
	// IPv4 private ranges
	// =========================================================================

	it("blocks loopback (127.0.0.0/8)", () => {
		expect(() => validateExternalUrl("http://127.0.0.1/")).toThrow(SsrfError);
		expect(() => validateExternalUrl("http://127.255.255.255/")).toThrow(SsrfError);
	});

	it("blocks private 10.0.0.0/8", () => {
		expect(() => validateExternalUrl("http://10.0.0.1/")).toThrow(SsrfError);
		expect(() => validateExternalUrl("http://10.255.255.255/")).toThrow(SsrfError);
	});

	it("blocks private 172.16.0.0/12", () => {
		expect(() => validateExternalUrl("http://172.16.0.1/")).toThrow(SsrfError);
		expect(() => validateExternalUrl("http://172.31.255.255/")).toThrow(SsrfError);
	});

	it("blocks private 192.168.0.0/16", () => {
		expect(() => validateExternalUrl("http://192.168.0.1/")).toThrow(SsrfError);
		expect(() => validateExternalUrl("http://192.168.255.255/")).toThrow(SsrfError);
	});

	it("blocks link-local (169.254.0.0/16) including cloud metadata", () => {
		expect(() => validateExternalUrl("http://169.254.169.254/latest/meta-data/")).toThrow(
			SsrfError,
		);
		expect(() => validateExternalUrl("http://169.254.0.1/")).toThrow(SsrfError);
	});

	// =========================================================================
	// IPv6 loopback
	// =========================================================================

	it("blocks IPv6 loopback [::1]", () => {
		expect(() => validateExternalUrl("http://[::1]/")).toThrow(SsrfError);
		expect(() => validateExternalUrl("http://[::1]:8080/")).toThrow(SsrfError);
	});

	// =========================================================================
	// Issue #58: IPv4-mapped IPv6 in hex form
	//
	// The WHATWG URL parser normalizes [::ffff:127.0.0.1] to [::ffff:7f00:1].
	// Before the fix, the hex form bypassed isPrivateIp() because the regex
	// only matched dotted-decimal.
	// =========================================================================

	it("blocks IPv4-mapped IPv6 loopback in hex form [::ffff:7f00:1]", () => {
		// This is the normalized form of [::ffff:127.0.0.1]
		expect(() => validateExternalUrl("http://[::ffff:7f00:1]/evil")).toThrow(SsrfError);
	});

	it("blocks IPv4-mapped IPv6 cloud metadata [::ffff:a9fe:a9fe]", () => {
		// This is the normalized form of [::ffff:169.254.169.254]
		expect(() => validateExternalUrl("http://[::ffff:a9fe:a9fe]/latest/meta-data/")).toThrow(
			SsrfError,
		);
	});

	it("blocks IPv4-mapped IPv6 private 10.x [::ffff:a00:1]", () => {
		// This is the normalized form of [::ffff:10.0.0.1]
		expect(() => validateExternalUrl("http://[::ffff:a00:1]/")).toThrow(SsrfError);
	});

	it("blocks IPv4-mapped IPv6 private 192.168.x [::ffff:c0a8:1]", () => {
		// This is the normalized form of [::ffff:192.168.0.1]
		expect(() => validateExternalUrl("http://[::ffff:c0a8:1]/")).toThrow(SsrfError);
	});

	it("blocks IPv4-mapped IPv6 private 172.16.x [::ffff:ac10:1]", () => {
		// This is the normalized form of [::ffff:172.16.0.1]
		expect(() => validateExternalUrl("http://[::ffff:ac10:1]/")).toThrow(SsrfError);
	});

	it("blocks IPv4-mapped IPv6 in dotted-decimal form", () => {
		// The dotted-decimal form should also be blocked (it worked before too)
		// The URL parser normalizes this to hex, so this exercises the same path
		expect(() => validateExternalUrl("http://[::ffff:127.0.0.1]/")).toThrow(SsrfError);
		expect(() => validateExternalUrl("http://[::ffff:169.254.169.254]/")).toThrow(SsrfError);
		expect(() => validateExternalUrl("http://[::ffff:10.0.0.1]/")).toThrow(SsrfError);
	});

	it("allows IPv4-mapped IPv6 for public IPs", () => {
		// [::ffff:93.184.216.34] -> hex form after URL parsing
		// 93 = 0x5d, 184 = 0xb8 -> 0x5db8
		// 216 = 0xd8, 34 = 0x22 -> 0xd822
		// So [::ffff:5db8:d822] should be allowed
		expect(validateExternalUrl("http://[::ffff:5db8:d822]/")).toBeInstanceOf(URL);
	});

	// =========================================================================
	// IPv4-compatible (deprecated) addresses: ::XXXX:XXXX (no ffff prefix)
	//
	// [::127.0.0.1] normalizes to [::7f00:1] which has no ffff prefix.
	// Without the fix, these bypass all ffff-based checks.
	// =========================================================================

	it("blocks IPv4-compatible loopback [::7f00:1]", () => {
		// Normalized form of [::127.0.0.1]
		expect(() => validateExternalUrl("http://[::7f00:1]/evil")).toThrow(SsrfError);
	});

	it("blocks IPv4-compatible cloud metadata [::a9fe:a9fe]", () => {
		// Normalized form of [::169.254.169.254]
		expect(() => validateExternalUrl("http://[::a9fe:a9fe]/latest/meta-data/")).toThrow(SsrfError);
	});

	it("blocks IPv4-compatible private 10.x [::a00:1]", () => {
		// Normalized form of [::10.0.0.1]
		expect(() => validateExternalUrl("http://[::a00:1]/")).toThrow(SsrfError);
	});

	it("blocks IPv4-compatible private 192.168.x [::c0a8:1]", () => {
		// Normalized form of [::192.168.0.1]
		expect(() => validateExternalUrl("http://[::c0a8:1]/")).toThrow(SsrfError);
	});

	it("allows IPv4-compatible public IPs [::5db8:d822]", () => {
		// 93.184.216.34 in hex
		expect(validateExternalUrl("http://[::5db8:d822]/")).toBeInstanceOf(URL);
	});

	// =========================================================================
	// NAT64 prefix: 64:ff9b::XXXX:XXXX
	//
	// [64:ff9b::127.0.0.1] normalizes to [64:ff9b::7f00:1].
	// NAT64 gateways embed IPv4 in IPv6 using this well-known prefix.
	// =========================================================================

	it("blocks NAT64 loopback [64:ff9b::7f00:1]", () => {
		expect(() => validateExternalUrl("http://[64:ff9b::7f00:1]/evil")).toThrow(SsrfError);
	});

	it("blocks NAT64 cloud metadata [64:ff9b::a9fe:a9fe]", () => {
		expect(() => validateExternalUrl("http://[64:ff9b::a9fe:a9fe]/latest/meta-data/")).toThrow(
			SsrfError,
		);
	});

	it("blocks NAT64 private 10.x [64:ff9b::a00:1]", () => {
		expect(() => validateExternalUrl("http://[64:ff9b::a00:1]/")).toThrow(SsrfError);
	});

	it("blocks NAT64 private 192.168.x [64:ff9b::c0a8:1]", () => {
		expect(() => validateExternalUrl("http://[64:ff9b::c0a8:1]/")).toThrow(SsrfError);
	});

	it("allows NAT64 public IPs [64:ff9b::5db8:d822]", () => {
		expect(validateExternalUrl("http://[64:ff9b::5db8:d822]/")).toBeInstanceOf(URL);
	});

	// =========================================================================
	// IPv6 link-local and ULA
	// =========================================================================

	it("blocks IPv6 link-local (fe80::)", () => {
		expect(() => validateExternalUrl("http://[fe80::1]/")).toThrow(SsrfError);
	});

	it("blocks IPv6 unique local (fc00::/fd00::)", () => {
		expect(() => validateExternalUrl("http://[fc00::1]/")).toThrow(SsrfError);
		expect(() => validateExternalUrl("http://[fd00::1]/")).toThrow(SsrfError);
	});

	it("blocks 0.0.0.0/8 range", () => {
		expect(() => validateExternalUrl("http://0.0.0.0/")).toThrow(SsrfError);
		expect(() => validateExternalUrl("http://0.0.0.1/")).toThrow(SsrfError);
	});
});

// =============================================================================
// normalizeIPv6MappedToIPv4 — direct unit tests (#58)
//
// This function converts IPv4-mapped/translated IPv6 hex addresses back to
// dotted-decimal IPv4 so they can be checked against private ranges. Without
// it, the WHATWG URL parser's hex normalization bypasses SSRF protection.
// =============================================================================

describe("normalizeIPv6MappedToIPv4", () => {
	// =========================================================================
	// Standard hex-form: ::ffff:XXXX:XXXX
	// =========================================================================

	it("converts loopback ::ffff:7f00:1 -> 127.0.0.1", () => {
		expect(normalizeIPv6MappedToIPv4("::ffff:7f00:1")).toBe("127.0.0.1");
	});

	it("converts cloud metadata ::ffff:a9fe:a9fe -> 169.254.169.254", () => {
		expect(normalizeIPv6MappedToIPv4("::ffff:a9fe:a9fe")).toBe("169.254.169.254");
	});

	it("converts private 10.x ::ffff:a00:1 -> 10.0.0.1", () => {
		expect(normalizeIPv6MappedToIPv4("::ffff:a00:1")).toBe("10.0.0.1");
	});

	it("converts private 192.168.x ::ffff:c0a8:1 -> 192.168.0.1", () => {
		expect(normalizeIPv6MappedToIPv4("::ffff:c0a8:1")).toBe("192.168.0.1");
	});

	it("converts private 172.16.x ::ffff:ac10:1 -> 172.16.0.1", () => {
		expect(normalizeIPv6MappedToIPv4("::ffff:ac10:1")).toBe("172.16.0.1");
	});

	it("converts public IP ::ffff:5db8:d822 -> 93.184.216.34", () => {
		expect(normalizeIPv6MappedToIPv4("::ffff:5db8:d822")).toBe("93.184.216.34");
	});

	// =========================================================================
	// Edge values
	// =========================================================================

	it("converts ::ffff:0:0 -> 0.0.0.0", () => {
		expect(normalizeIPv6MappedToIPv4("::ffff:0:0")).toBe("0.0.0.0");
	});

	it("converts ::ffff:ffff:ffff -> 255.255.255.255", () => {
		expect(normalizeIPv6MappedToIPv4("::ffff:ffff:ffff")).toBe("255.255.255.255");
	});

	it("converts 4-digit hex groups correctly ::ffff:c612:e3a -> 198.18.14.58", () => {
		// 0xc612 = 198*256 + 18 = 50706
		// 0x0e3a = 14*256 + 58 = 3642
		expect(normalizeIPv6MappedToIPv4("::ffff:c612:e3a")).toBe("198.18.14.58");
	});

	// =========================================================================
	// Case insensitivity
	// =========================================================================

	it("handles uppercase hex digits", () => {
		expect(normalizeIPv6MappedToIPv4("::FFFF:7F00:1")).toBe("127.0.0.1");
	});

	it("handles mixed case hex digits", () => {
		expect(normalizeIPv6MappedToIPv4("::ffff:A9FE:a9fe")).toBe("169.254.169.254");
	});

	// =========================================================================
	// Bracket-wrapped form returns null (brackets stripped by caller)
	// validateExternalUrl strips brackets before calling isPrivateIp,
	// so normalizeIPv6MappedToIPv4 never receives bracketed input.
	// =========================================================================

	it("returns null for bracketed input (brackets stripped by caller)", () => {
		expect(normalizeIPv6MappedToIPv4("[::ffff:7f00:1]")).toBeNull();
		expect(normalizeIPv6MappedToIPv4("[::ffff:a9fe:a9fe]")).toBeNull();
	});

	// =========================================================================
	// IPv4-translated (RFC 6052): ::ffff:0:XXXX:XXXX
	// =========================================================================

	it("converts translated form ::ffff:0:7f00:1 -> 127.0.0.1", () => {
		expect(normalizeIPv6MappedToIPv4("::ffff:0:7f00:1")).toBe("127.0.0.1");
	});

	it("converts translated form ::ffff:0:a9fe:a9fe -> 169.254.169.254", () => {
		expect(normalizeIPv6MappedToIPv4("::ffff:0:a9fe:a9fe")).toBe("169.254.169.254");
	});

	// =========================================================================
	// Fully expanded form: 0000:0000:0000:0000:0000:ffff:XXXX:XXXX
	// =========================================================================

	it("converts expanded form 0:0:0:0:0:ffff:7f00:1 -> 127.0.0.1", () => {
		expect(normalizeIPv6MappedToIPv4("0:0:0:0:0:ffff:7f00:1")).toBe("127.0.0.1");
	});

	it("converts expanded form 0000:0000:0000:0000:0000:ffff:a9fe:a9fe -> 169.254.169.254", () => {
		expect(normalizeIPv6MappedToIPv4("0000:0000:0000:0000:0000:ffff:a9fe:a9fe")).toBe(
			"169.254.169.254",
		);
	});

	it("converts expanded form with mixed zero lengths", () => {
		expect(normalizeIPv6MappedToIPv4("0:00:000:0000:0:ffff:a00:1")).toBe("10.0.0.1");
	});

	// =========================================================================
	// IPv4-compatible (deprecated) form: ::XXXX:XXXX (no ffff prefix)
	// =========================================================================

	it("converts IPv4-compatible loopback ::7f00:1 -> 127.0.0.1", () => {
		expect(normalizeIPv6MappedToIPv4("::7f00:1")).toBe("127.0.0.1");
	});

	it("converts IPv4-compatible metadata ::a9fe:a9fe -> 169.254.169.254", () => {
		expect(normalizeIPv6MappedToIPv4("::a9fe:a9fe")).toBe("169.254.169.254");
	});

	it("converts IPv4-compatible private ::a00:1 -> 10.0.0.1", () => {
		expect(normalizeIPv6MappedToIPv4("::a00:1")).toBe("10.0.0.1");
	});

	it("converts IPv4-compatible public ::5db8:d822 -> 93.184.216.34", () => {
		expect(normalizeIPv6MappedToIPv4("::5db8:d822")).toBe("93.184.216.34");
	});

	// =========================================================================
	// NAT64 prefix (RFC 6052): 64:ff9b::XXXX:XXXX
	// =========================================================================

	it("converts NAT64 loopback 64:ff9b::7f00:1 -> 127.0.0.1", () => {
		expect(normalizeIPv6MappedToIPv4("64:ff9b::7f00:1")).toBe("127.0.0.1");
	});

	it("converts NAT64 metadata 64:ff9b::a9fe:a9fe -> 169.254.169.254", () => {
		expect(normalizeIPv6MappedToIPv4("64:ff9b::a9fe:a9fe")).toBe("169.254.169.254");
	});

	it("converts NAT64 private 64:ff9b::a00:1 -> 10.0.0.1", () => {
		expect(normalizeIPv6MappedToIPv4("64:ff9b::a00:1")).toBe("10.0.0.1");
	});

	it("converts NAT64 public 64:ff9b::5db8:d822 -> 93.184.216.34", () => {
		expect(normalizeIPv6MappedToIPv4("64:ff9b::5db8:d822")).toBe("93.184.216.34");
	});

	// =========================================================================
	// Non-matching inputs -> null
	// =========================================================================

	it("returns null for plain IPv4", () => {
		expect(normalizeIPv6MappedToIPv4("127.0.0.1")).toBeNull();
	});

	it("returns null for IPv6 loopback ::1", () => {
		expect(normalizeIPv6MappedToIPv4("::1")).toBeNull();
	});

	it("returns null for regular IPv6 address", () => {
		expect(normalizeIPv6MappedToIPv4("2001:db8::1")).toBeNull();
	});

	it("returns null for link-local IPv6", () => {
		expect(normalizeIPv6MappedToIPv4("fe80::1")).toBeNull();
	});

	it("returns null for hostnames", () => {
		expect(normalizeIPv6MappedToIPv4("example.com")).toBeNull();
		expect(normalizeIPv6MappedToIPv4("localhost")).toBeNull();
	});

	it("returns null for empty string", () => {
		expect(normalizeIPv6MappedToIPv4("")).toBeNull();
	});

	it("returns null for dotted-decimal mapped form (handled separately)", () => {
		// ::ffff:127.0.0.1 uses the dotted-decimal regex, not hex normalization
		expect(normalizeIPv6MappedToIPv4("::ffff:127.0.0.1")).toBeNull();
	});
});
