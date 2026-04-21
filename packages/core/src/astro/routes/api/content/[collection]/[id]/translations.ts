/**
 * Content translations endpoint
 *
 * GET /_emdash/api/content/{collection}/{id}/translations
 *
 * Returns all locale variants linked to the same translation group.
 */

import type { APIRoute } from "astro";

import { requirePerm } from "#api/authorize.js";
import { apiError, unwrapResult } from "#api/error.js";

export const prerender = false;

export const GET: APIRoute = async ({ params, locals }) => {
	const { emdash, user } = locals;
	const denied = requirePerm(user, "content:read");
	if (denied) return denied;
	const collection = params.collection!;
	const id = params.id!;

	if (!emdash?.handleContentTranslations) {
		return apiError("NOT_CONFIGURED", "EmDash is not initialized", 500);
	}

	const result = await emdash.handleContentTranslations(collection, id);

	return unwrapResult(result);
};
