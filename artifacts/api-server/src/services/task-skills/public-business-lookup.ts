import { registerSkill, type BusinessCandidate, type Skill } from "./types.js";
import { logger } from "../../lib/logger.js";

export interface PublicBusinessLookupInput {
  query: string;
  location?: string;
  lat?: number;
  lng?: number;
  radiusMeters?: number;
  limit?: number;
}

function placesApiKey(): string | null {
  return (
    process.env["GOOGLE_PLACES_API_KEY"]?.trim() ||
    process.env["GOOGLE_MAPS_API_KEY"]?.trim() ||
    process.env["GOOGLE_API_KEY"]?.trim() ||
    null
  );
}

/** Normalize Indian / international phones toward E.164 when possible. */
function normalizeListingPhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/[^\d+]/g, "");
  if (!digits) return null;
  if (digits.startsWith("+")) return digits;
  const bare = digits.replace(/\D/g, "");
  if (bare.length === 10) return `+91${bare}`;
  if (bare.length === 12 && bare.startsWith("91")) return `+${bare}`;
  if (bare.length >= 8) return `+${bare}`;
  return null;
}

async function geocodeLocation(location: string, key: string, signal?: AbortSignal): Promise<{ lat: number; lng: number } | null> {
  const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
  url.searchParams.set("address", location);
  url.searchParams.set("key", key);
  const resp = await fetch(url.toString(), { signal });
  if (!resp.ok) return null;
  const data = (await resp.json()) as {
    results?: Array<{ geometry?: { location?: { lat: number; lng: number } } }>;
  };
  const loc = data.results?.[0]?.geometry?.location;
  if (!loc) return null;
  return { lat: loc.lat, lng: loc.lng };
}

async function placeDetailsPhone(placeId: string, key: string, signal?: AbortSignal): Promise<string | null> {
  const url = new URL("https://maps.googleapis.com/maps/api/place/details/json");
  url.searchParams.set("place_id", placeId);
  url.searchParams.set("fields", "formatted_phone_number,international_phone_number,url");
  url.searchParams.set("key", key);
  const resp = await fetch(url.toString(), { signal });
  if (!resp.ok) return null;
  const data = (await resp.json()) as {
    result?: {
      international_phone_number?: string;
      formatted_phone_number?: string;
      url?: string;
    };
  };
  return normalizeListingPhone(
    data.result?.international_phone_number ?? data.result?.formatted_phone_number ?? null,
  );
}

/**
 * Public business lookup via Google Places (Text Search + Details for phones).
 * Returns only publicly listed name / phone / address — no scraping.
 */
export const publicBusinessLookupSkill: Skill<PublicBusinessLookupInput, BusinessCandidate[]> = {
  id: "public_business_lookup",
  description: "Find publicly listed businesses and phone numbers near a location (Google Places).",
  async execute(input, ctx) {
    const key = placesApiKey();
    if (!key) {
      throw new Error(
        "Google Places is not configured. Set GOOGLE_PLACES_API_KEY (or GOOGLE_MAPS_API_KEY) to enable business lookup.",
      );
    }

    const limit = Math.min(Math.max(input.limit ?? 5, 1), 10);
    const radius = Math.min(Math.max(input.radiusMeters ?? 5000, 500), 50000);
    let lat = input.lat;
    let lng = input.lng;

    if ((lat == null || lng == null) && input.location?.trim()) {
      const geo = await geocodeLocation(input.location.trim(), key, ctx.signal);
      if (geo) {
        lat = geo.lat;
        lng = geo.lng;
      }
    }

    const textQuery = [input.query.trim(), input.location?.trim()].filter(Boolean).join(" near ");
    const searchUrl = new URL("https://maps.googleapis.com/maps/api/place/textsearch/json");
    searchUrl.searchParams.set("query", textQuery || input.query);
    searchUrl.searchParams.set("key", key);
    if (lat != null && lng != null) {
      searchUrl.searchParams.set("location", `${lat},${lng}`);
      searchUrl.searchParams.set("radius", String(radius));
    }

    const searchResp = await fetch(searchUrl.toString(), { signal: ctx.signal });
    if (!searchResp.ok) {
      const body = await searchResp.text().catch(() => "");
      logger.warn({ status: searchResp.status, body: body.slice(0, 200), taskId: ctx.taskId }, "Places text search failed");
      throw new Error(`Places search failed (${searchResp.status})`);
    }

    const searchData = (await searchResp.json()) as {
      status?: string;
      error_message?: string;
      results?: Array<{
        place_id?: string;
        name?: string;
        formatted_address?: string;
        geometry?: { location?: { lat: number; lng: number } };
      }>;
    };

    if (searchData.status && searchData.status !== "OK" && searchData.status !== "ZERO_RESULTS") {
      throw new Error(searchData.error_message || `Places API status: ${searchData.status}`);
    }

    const rows = (searchData.results ?? []).slice(0, limit);
    const candidates: BusinessCandidate[] = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]!;
      const placeId = row.place_id ?? null;
      let phone: string | null = null;
      let sourceUrl: string | null = placeId
        ? `https://www.google.com/maps/place/?q=place_id:${placeId}`
        : null;

      if (placeId) {
        try {
          phone = await placeDetailsPhone(placeId, key, ctx.signal);
        } catch (err) {
          logger.warn({ err, placeId, taskId: ctx.taskId }, "Place details phone lookup failed");
        }
      }

      candidates.push({
        name: row.name?.trim() || "Unknown business",
        phone,
        address: row.formatted_address ?? null,
        sourceUrl,
        placeId,
        rank: i + 1,
        meta: {
          lat: row.geometry?.location?.lat,
          lng: row.geometry?.location?.lng,
        },
      });
    }

    logger.info(
      { evt: "task_skill_lookup", taskId: ctx.taskId, userId: ctx.userId, query: input.query, count: candidates.length },
      "public_business_lookup completed",
    );

    return candidates;
  },
};

registerSkill(publicBusinessLookupSkill);
