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
      // Raw public_ids normally include the extension (…/file.pdf).
      const withExt = parsed.public_id;
      const withoutExt =
        parsed.format && withExt.toLowerCase().endsWith(`.${parsed.format}`)
          ? withExt.slice(0, -(parsed.format.length + 1))
          : withExt;

      // Prefer public_id WITH extension + empty format (Cloudinary raw convention).
      try {
        return cloudinary.utils.private_download_url(withExt, "", {
          resource_type: "raw",
          type: "upload",
          attachment: !!attachment,
          target_filename: attachment
            ? sanitizeDownloadName(filename)
            : undefined,
          expires_at: Math.floor(Date.now() / 1000) + 60 * 60 * 6,
        });
      } catch (_) {
        return cloudinary.utils.private_download_url(
          withoutExt,
          parsed.format || undefined,
          {
            resource_type: "raw",
            type: "upload",
            attachment: !!attachment,
            target_filename: attachment
              ? sanitizeDownloadName(filename)
              : undefined,
            expires_at: Math.floor(Date.now() / 1000) + 60 * 60 * 6,
          },
        );
      }
    }

    const format = parsed.format || "pdf";
    return cloudinary.utils.private_download_url(parsed.public_id, format, {
      resource_type: parsed.resource_type,
      type: "upload",
      attachment: !!attachment,
      target_filename: attachment ? sanitizeDownloadName(filename) : undefined,
      expires_at: Math.floor(Date.now() / 1000) + 60 * 60 * 6,
    });
  } catch (err) {
    console.error("[cloudinary] signedPoDocumentUrl:", err.message);
    return filePath;
  }
}

/**
 * Public `/image/upload/*.pdf` URLs return 401 on many Cloudinary plans
 * (PDF delivery is restricted). Return a time-limited API URL that opens
 * inline in the browser. Leave public images on the CDN.
 */
exports.viewablePoDocumentUrl = function viewablePoDocumentUrl(filePath) {
  return signedPoDocumentUrl(filePath, { attachment: false });
};

/** Force the browser to download the file instead of opening it. */
exports.downloadablePoDocumentUrl = function downloadablePoDocumentUrl(
  filePath,
  filename,
) {
  return signedPoDocumentUrl(filePath, { attachment: true, filename });
};

exports.parseCloudinaryDeliveryUrl = parseCloudinaryDeliveryUrl;

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
