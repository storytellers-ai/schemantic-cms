/**
 * Auth Provider Types
 *
 * Defines the interfaces for pluggable authentication providers.
 * Providers like Cloudflare Access implement these interfaces.
 */

/**
 * Result of authenticating a request via an external auth provider
 */
export interface AuthResult {
	/** User's email address */
	email: string;
	/** User's display name */
	name: string;
	/** Resolved role level (e.g., 50 for Admin, 30 for Editor) */
	role: number;
	/** Provider-specific subject ID */
	subject?: string;
	/** Additional provider-specific data */
	metadata?: Record<string, unknown>;
}

/**
 * Auth descriptor - returned by auth adapter functions (e.g., access())
 *
 * Similar to DatabaseDescriptor and StorageDescriptor, this allows
 * auth providers to be configured at build time and loaded at runtime.
 */
export interface AuthDescriptor {
	/**
	 * Auth provider type identifier
	 * @example "cloudflare-access", "okta", "auth0"
	 */
	type: string;

	/**
	 * Module specifier to import at runtime
	 * The module must export an `authenticate` function.
	 * @example "@emdash-cms/cloudflare/auth"
	 */
	entrypoint: string;

	/**
	 * Provider-specific configuration (JSON-serializable)
	 */
	config: unknown;
}

/**
 * Auth provider module interface
 *
 * Modules specified by AuthDescriptor.entrypoint must export
 * an `authenticate` function matching this signature.
 */
export interface AuthProviderModule {
	/**
	 * Authenticate a request using the provider
	 *
	 * @param request - The incoming HTTP request
	 * @param config - Provider-specific configuration from AuthDescriptor
	 * @returns Authentication result if valid, throws if invalid
	 */
	authenticate(request: Request, config: unknown): Promise<AuthResult>;
}

/**
 * Configuration options common to external auth providers
 */
export interface ExternalAuthConfig {
	/**
	 * Automatically create EmDash users on first login
	 * @default true
	 */
	autoProvision?: boolean;

	/**
	 * Role level for users not matching any group in roleMapping
	 * @default 30 (Editor)
	 */
	defaultRole?: number;

	/**
	 * Update user's role on each login based on current IdP groups
	 * When false, role is only set on first provisioning
	 * @default false
	 */
	syncRoles?: boolean;

	/**
	 * Map IdP group names to EmDash role levels
	 * First match wins if user is in multiple groups
	 *
	 * @example
	 * ```ts
	 * roleMapping: {
	 *   "Admins": 50,        // Admin
	 *   "Developers": 40,    // Developer
	 *   "Content Team": 30,  // Editor
	 * }
	 * ```
	 */
	roleMapping?: Record<string, number>;
}
