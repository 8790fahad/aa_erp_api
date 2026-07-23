"use strict";

const TINYURL_API_BASE =
  process.env.TINYURL_API_BASE || "https://api.tinyurl.com";
const TINYURL_API_TOKEN = process.env.TINYURL_API_TOKEN || "";

const isValidHttpUrl = (value) => {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
};

const sanitizeAlias = (value) =>
  String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, "")
    .slice(0, 30);

const extractTinyUrl = (payload) => {
  const data = payload?.data;
  const record = Array.isArray(data) ? data[0] : data;

  const shortUrl =
    record?.tiny_url ||
    record?.tinyUrl ||
    record?.short_url ||
    record?.shortUrl ||
    payload?.tiny_url ||
    payload?.url;

  if (!shortUrl || !isValidHttpUrl(shortUrl)) {
    return null;
  }

  return shortUrl;
};

const extractApiError = (payload, status) => {
  const errors = payload?.errors;
  if (Array.isArray(errors) && errors.length > 0) {
    const messages = errors
      .map((entry) => {
        if (typeof entry === "string") return entry;
        return entry?.message || entry?.error || entry?.detail;
      })
      .filter(Boolean);
    if (messages.length > 0) {
      return messages.join("; ");
    }
  }
  if (payload?.message) return payload.message;
  if (payload?.error) return payload.error;
  return `TinyURL API responded with status ${status}`;
};

const isAliasUnavailableError = (message) =>
  /alias is not available/i.test(String(message || ""));

const requestTinyUrl = async (body) => {
  const res = await fetch(
    `${TINYURL_API_BASE}/create?disable_long_url_duplicates=account`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${TINYURL_API_TOKEN}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(body),
    },
  );

  let payload = {};
  try {
    payload = await res.json();
  } catch {
    payload = {};
  }

  return { res, payload };
};

const buildAliasCandidates = (alias, facilityId) => {
  const normalized = sanitizeAlias(alias);
  if (!normalized) return [null];

  const candidates = [normalized];
  if (facilityId) {
    const suffix = String(facilityId).replace(/[^a-z0-9]/gi, "").slice(-4);
    if (suffix) {
      candidates.push(`${normalized}${suffix}`.slice(0, 30));
      candidates.push(`${normalized}-${suffix}`.slice(0, 30));
    }
  }

  return [...new Set(candidates)];
};

/**
 * Create a shortened URL via TinyURL API.
 * @param {{ url: string, domain?: string, alias?: string, facilityId?: string }} options
 * @returns {Promise<string>}
 */
exports.createTinyLink = async ({ url, domain, alias, facilityId }) => {
  if (!TINYURL_API_TOKEN) {
    throw new Error(
      "TinyURL API token is not configured. Set TINYURL_API_TOKEN in the server environment.",
    );
  }

  if (!isValidHttpUrl(url)) {
    throw new Error("A valid http(s) URL is required to create a tiny link");
  }

  const aliasCandidates = buildAliasCandidates(alias, facilityId);
  let lastError = "Failed to create tiny link";

  for (let index = 0; index < aliasCandidates.length; index += 1) {
    const candidate = aliasCandidates[index];
    const body = {
      url,
      domain: domain || "tinyurl.com",
    };

    if (candidate) {
      if (candidate.length < 5) {
        continue;
      }
      body.alias = candidate;
    }

    const { res, payload } = await requestTinyUrl(body);

    if (res.ok) {
      const shortUrl = extractTinyUrl(payload);
      if (shortUrl) {
        return shortUrl;
      }
      lastError = "TinyURL API returned an invalid short URL";
      continue;
    }

    lastError = extractApiError(payload, res.status);

    const hasMoreAliasCandidates = index < aliasCandidates.length - 1;
    if (res.status === 422 && isAliasUnavailableError(lastError) && hasMoreAliasCandidates) {
      continue;
    }

    throw new Error(lastError);
  }

  throw new Error(lastError);
};

exports.sanitizeAlias = sanitizeAlias;
