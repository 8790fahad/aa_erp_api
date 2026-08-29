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
require("dotenv").config();
const cloudinary = require("cloudinary").v2;

const cloudName = String(process.env.CLOUDINARY_CLOUD_NAME || "").trim();
const apiKey = String(process.env.CLOUDINARY_API_KEY || "").trim();
const apiSecret = String(process.env.CLOUDINARY_API_SECRET || "").trim();

if (!cloudName || !apiKey || !apiSecret) {
  console.warn(
    "[cloudinary] CLOUDINARY_CLOUD_NAME / CLOUDINARY_API_KEY / CLOUDINARY_API_SECRET are not fully set. Uploads will fail until configured in .env.",
  );
}

cloudinary.config({
  cloud_name: cloudName,
  api_key: apiKey,
  api_secret: apiSecret,
  secure: true,
});

exports.cloudinary = cloudinary;

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

  const parsed = parseCloudinaryDeliveryUrl(filePath);
  if (!parsed) return filePath;

  const isPdf = String(parsed.format || "").toLowerCase() === "pdf";
  const needsSigned =
    attachment || parsed.resource_type === "raw" || isPdf;
  if (!needsSigned) return filePath;

  try {
    const format =
      parsed.resource_type === "raw"
        ? parsed.format || undefined
        : parsed.format || "pdf";
    const publicId =
      parsed.resource_type === "raw" && parsed.format
        ? parsed.public_id.replace(new RegExp(`\\.${parsed.format}$`, "i"), "")
        : parsed.public_id;
    return cloudinary.utils.private_download_url(publicId, format, {
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
