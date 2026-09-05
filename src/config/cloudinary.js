"use strict";

/**
 * Cloudinary config — credentials MUST come from environment variables.
 * Never hardcode api_key / api_secret in source.
 *
 * Required:
 *   CLOUDINARY_CLOUD_NAME
 *   CLOUDINARY_API_KEY
 *   CLOUDINARY_API_SECRET
 */
const path = require("path");
require("dotenv").config({
  path: path.join(__dirname, "..", "..", ".env"),
});
const cloudinary = require("cloudinary").v2;

function readCloudinaryEnv() {
  return {
    cloud_name: String(process.env.CLOUDINARY_CLOUD_NAME || "").trim(),
    api_key: String(process.env.CLOUDINARY_API_KEY || "").trim(),
    api_secret: String(process.env.CLOUDINARY_API_SECRET || "").trim(),
  };
}

function applyCloudinaryConfig() {
  const cfg = readCloudinaryEnv();
  if (!cfg.cloud_name || !cfg.api_key || !cfg.api_secret) {
    console.warn(
      "[cloudinary] CLOUDINARY_CLOUD_NAME / CLOUDINARY_API_KEY / CLOUDINARY_API_SECRET are not fully set. Uploads will fail until configured in aa_erp_api/.env.",
    );
    return cfg;
  }

  // Prefer the official URL form so upload_stream always receives api_key.
  process.env.CLOUDINARY_URL = `cloudinary://${cfg.api_key}:${cfg.api_secret}@${cfg.cloud_name}`;
  cloudinary.config(true); // reload from CLOUDINARY_URL / env
  cloudinary.config({
    cloud_name: cfg.cloud_name,
    api_key: cfg.api_key,
    api_secret: cfg.api_secret,
    secure: true,
  });
  console.log(
    `[cloudinary] configured for cloud "${cfg.cloud_name}" (api_key present)`,
  );
  return cfg;
}

applyCloudinaryConfig();

exports.cloudinary = cloudinary;
exports.applyCloudinaryConfig = applyCloudinaryConfig;
exports.isCloudinaryConfigured = function isCloudinaryConfigured() {
  const cfg = readCloudinaryEnv();
  return Boolean(cfg.cloud_name && cfg.api_key && cfg.api_secret);
};

/**
 * Parse a Cloudinary delivery URL into public_id / resource_type / format.
 * Example:
 *   https://res.cloudinary.com/demo/image/upload/v123/aa_erp/purchase_orders/file.pdf
 */
function parseCloudinaryDeliveryUrl(url) {
  if (!url || typeof url !== "string") return null;
  const match = url.match(
    /res\.cloudinary\.com\/[^/]+\/(image|raw|video)\/upload\/(?:v\d+\/)?(.+?)(?:\?|$)/i,
  );
  if (!match) return null;
  const resource_type = match[1].toLowerCase();
  const rest = decodeURIComponent(match[2]);
  const lastSlash = rest.lastIndexOf("/");
  const filePart = lastSlash >= 0 ? rest.slice(lastSlash + 1) : rest;
  const lastDot = filePart.lastIndexOf(".");
  const format = lastDot >= 0 ? filePart.slice(lastDot + 1) : "";
  const public_id =
    resource_type === "raw"
      ? rest
      : lastDot >= 0
        ? rest.slice(0, rest.length - (filePart.length - lastDot))
        : rest;
  return { resource_type, public_id, format };
}

function sanitizeDownloadName(filename) {
  const name = String(filename || "")
    .replace(/[/\\?%*:|"<>]/g, "_")
    .trim();
  return name || undefined;
}

function extensionFromFilename(filename) {
  const name = String(filename || "");
  const dot = name.lastIndexOf(".");
  if (dot <= 0 || dot === name.length - 1) return "";
  return name.slice(dot + 1).toLowerCase();
}

function leafHasExtension(publicId) {
  const leaf = String(publicId || "").split("/").pop() || "";
  return leaf.includes(".");
}

/**
 * Raw assets store the extension IN the public_id. If the delivery URL omitted
 * it (common when upload used public_id without ext + format: "pdf"), append it
 * so raw/download matches the stored resource.
 */
function rawPublicIdForDownload(parsed, filename) {
  const id = parsed?.public_id || "";
  const ext = String(
    parsed?.format || extensionFromFilename(filename) || "pdf",
  ).toLowerCase();
  if (!id) return id;
  if (id.toLowerCase().endsWith(`.${ext}`)) return id;
  if (leafHasExtension(id)) return id;
  return `${id}.${ext}`;
}

function privateDownloadUrl(
  publicId,
  format,
  resourceType,
  { attachment = false, filename } = {},
) {
  applyCloudinaryConfig();
  const options = {
    resource_type: resourceType,
    type: "upload",
    attachment: !!attachment,
    target_filename: attachment ? sanitizeDownloadName(filename) : undefined,
    expires_at: Math.floor(Date.now() / 1000) + 60 * 60 * 6,
  };
  if (resourceType === "raw") {
    return cloudinary.utils.private_download_url(publicId, "", options);
  }
  return cloudinary.utils.private_download_url(
    publicId,
    format || "pdf",
    options,
  );
}

function signedPoDocumentUrl(filePath, { attachment = false, filename } = {}) {
  if (!filePath || typeof filePath !== "string") return filePath || "";
  if (!/^https?:\/\/res\.cloudinary\.com\//i.test(filePath)) return filePath;

  applyCloudinaryConfig();

  const parsed = parseCloudinaryDeliveryUrl(filePath);
  if (!parsed) return filePath;

  const isPdf = String(parsed.format || "").toLowerCase() === "pdf";
  // Public images can stay on the CDN. Raw/PDF delivery is often restricted (401).
  if (
    !attachment &&
    parsed.resource_type === "image" &&
    !isPdf
  ) {
    return filePath;
  }

  try {
    if (parsed.resource_type === "raw") {
      return privateDownloadUrl(
        rawPublicIdForDownload(parsed, filename),
        "",
        "raw",
        { attachment, filename },
      );
    }

    const format = parsed.format || extensionFromFilename(filename) || "pdf";
    return privateDownloadUrl(parsed.public_id, format, parsed.resource_type, {
      attachment,
      filename,
    });
  } catch (err) {
    console.error("[cloudinary] signedPoDocumentUrl:", err.message);
    return filePath;
  }
}

function lookupHttpCode(err) {
  return Number(err?.http_code || err?.error?.http_code || 0);
}

/**
 * Confirm the Cloudinary asset exists, trying public_id / resource_type variants
 * that commonly diverge between upload and download.
 */
async function resolveSignedPoDocumentUrl(
  filePath,
  { attachment = false, filename } = {},
) {
  if (!filePath || typeof filePath !== "string") {
    return { missing: true, public_id: "", resource_type: "" };
  }
  if (!/^https?:\/\/res\.cloudinary\.com\//i.test(filePath)) {
    return { url: filePath };
  }

  applyCloudinaryConfig();
  const parsed = parseCloudinaryDeliveryUrl(filePath);
  if (!parsed) return { url: filePath };

  const ext = String(
    parsed.format || extensionFromFilename(filename) || "pdf",
  ).toLowerCase();
  const rawId = rawPublicIdForDownload(parsed, filename);
  const withoutExt = leafHasExtension(rawId)
    ? rawId.replace(/\.[^.]+$/, "")
    : parsed.public_id;

  const candidates = [];
  if (parsed.resource_type === "raw") {
    candidates.push({ id: rawId, resource_type: "raw", format: "" });
    if (parsed.public_id !== rawId) {
      candidates.push({ id: parsed.public_id, resource_type: "raw", format: "" });
    }
    candidates.push({
      id: withoutExt,
      resource_type: "image",
      format: ext,
    });
  } else {
    candidates.push({
      id: parsed.public_id,
      resource_type: parsed.resource_type,
      format: parsed.format || ext,
    });
    candidates.push({ id: rawId, resource_type: "raw", format: "" });
  }

  const seen = new Set();
  for (const candidate of candidates) {
    const key = `${candidate.resource_type}:${candidate.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    try {
      await cloudinary.api.resource(candidate.id, {
        resource_type: candidate.resource_type,
      });
      return {
        url: privateDownloadUrl(
          candidate.id,
          candidate.format,
          candidate.resource_type,
          { attachment, filename },
        ),
        public_id: candidate.id,
        resource_type: candidate.resource_type,
      };
    } catch (err) {
      if (lookupHttpCode(err) === 404) continue;
      console.error("[cloudinary] resource lookup failed:", err.message);
    }
  }

  console.warn("[cloudinary] PO document missing", {
    public_id: parsed.public_id,
    resource_type: parsed.resource_type,
    filePath,
  });
  return {
    missing: true,
    public_id: parsed.public_id,
    resource_type: parsed.resource_type,
  };
}

/**
 * Public `/image/upload/*.pdf` URLs return 401 on many Cloudinary plans
 * (PDF delivery is restricted). Return a time-limited API URL that opens
 * inline in the browser. Leave public images on the CDN.
 */
exports.viewablePoDocumentUrl = function viewablePoDocumentUrl(
  filePath,
  filename,
) {
  return signedPoDocumentUrl(filePath, { attachment: false, filename });
};

/** Force the browser to download the file instead of opening it. */
exports.downloadablePoDocumentUrl = function downloadablePoDocumentUrl(
  filePath,
  filename,
) {
  return signedPoDocumentUrl(filePath, { attachment: true, filename });
};

exports.parseCloudinaryDeliveryUrl = parseCloudinaryDeliveryUrl;
exports.resolveSignedPoDocumentUrl = resolveSignedPoDocumentUrl;

exports.uploads = (file) => {
  return new Promise((resolve, reject) => {
    cloudinary.uploader.upload(
      file,
      { resource_type: "auto" },
      (err, result) => {
        if (err) return reject(err);
        resolve({ url: result.url, id: result.public_id });
      },
    );
  });
};
