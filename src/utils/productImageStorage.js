const fs = require("fs");
const path = require("path");

const DATA_URL_RE = /^data:([^;]+);base64,(.+)$/i;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

const extFromMime = (mime) => {
  const normalized = String(mime || "").toLowerCase();
  if (normalized === "image/jpeg" || normalized === "image/jpg") return ".jpg";
  if (normalized === "image/png") return ".png";
  if (normalized === "image/webp") return ".webp";
  if (normalized === "image/gif") return ".gif";
  return ".img";
};

const isDataUrl = (value) => DATA_URL_RE.test(String(value || "").trim());

const isPersistedUploadPath = (value) => {
  const text = String(value || "").trim();
  return text.startsWith("/public/uploads/");
};

const parseDataUrl = (value) => {
  const match = String(value || "").trim().match(DATA_URL_RE);
  if (!match) return null;
  const buffer = Buffer.from(match[2], "base64");
  if (!buffer.length || buffer.length > MAX_IMAGE_BYTES) return null;
  return { mime: match[1], buffer };
};

const getUploadsRoot = () =>
  path.join(__dirname, "..", "..", "public", "uploads", "product-images");

/** Public URL prefix for /public/uploads (must match Apache alias / BASE_PATH). */
const getStaticPublicBasePath = () => {
  if (process.env.PUBLIC_STATIC_BASE_PATH) {
    const configured = String(process.env.PUBLIC_STATIC_BASE_PATH).trim();
    const withSlash = configured.startsWith("/") ? configured : `/${configured}`;
    return withSlash.replace(/\/$/, "") || "/aa_erp";
  }

  const basePath = String(process.env.BASE_PATH || "/aa_erp").replace(/\/$/, "");
  return basePath || "/aa_erp";
};

const getStaticPublicOrigin = (req) => {
  if (req) {
    const host = req.get("host");
    if (host) {
      const isLocalHost =
        host.includes("localhost") || host.startsWith("127.0.0.1");
      const forwardedProto = req.get("x-forwarded-proto");
      const protocol = forwardedProto
        ? String(forwardedProto).split(",")[0].trim()
        : req.protocol || (isLocalHost ? "http" : "https");
      if (isLocalHost) {
        return `${protocol}://${host}`;
      }
    }
  }

  const appUrl = String(process.env.APP_URL || "").replace(/\/$/, "");
  if (appUrl) {
    try {
      return new URL(appUrl).origin;
    } catch {
      // fall through
    }
  }

  if (req) {
    const host = req.get("host");
    if (host) {
      const forwardedProto = req.get("x-forwarded-proto");
      const protocol = forwardedProto
        ? String(forwardedProto).split(",")[0].trim()
        : req.protocol || "https";
      return `${protocol}://${host}`;
    }
  }

  return "";
};

const getApiPublicRoot = () => {
  const origin = getStaticPublicOrigin();
  const basePath = getStaticPublicBasePath();
  return origin ? `${origin}${basePath}` : basePath;
};

const buildPublicUploadUrl = (req, relativePath) => {
  const normalizedPath = relativePath.startsWith("/")
    ? relativePath
    : `/${relativePath}`;
  const origin = getStaticPublicOrigin(req);
  const basePath = getStaticPublicBasePath();

  if (origin) {
    return `${origin}${basePath}${normalizedPath}`;
  }

  return `${basePath}${normalizedPath}`;
};

const persistProductImage = async (value, { facilityId, productId, index, req }) => {
  const trimmed = String(value || "").trim();
  if (!trimmed) return null;
  if (!isDataUrl(trimmed)) return trimmed;

  const parsed = parseDataUrl(trimmed);
  if (!parsed) {
    throw new Error(
      `Image ${index + 1} is invalid or exceeds the ${MAX_IMAGE_BYTES / (1024 * 1024)}MB limit`,
    );
  }

  const uploadDir = path.join(getUploadsRoot(), String(facilityId));
  fs.mkdirSync(uploadDir, { recursive: true });

  const filename = `product-${productId}-${Date.now()}-${index}${extFromMime(parsed.mime)}`;
  const absolutePath = path.join(uploadDir, filename);
  fs.writeFileSync(absolutePath, parsed.buffer);

  const relativePath = `/public/uploads/product-images/${facilityId}/${filename}`;
  return buildPublicUploadUrl(req, relativePath);
};

const persistProductImages = async (images, options) => {
  const list = Array.isArray(images) ? images : [];
  const results = [];

  for (let index = 0; index < list.length; index += 1) {
    const item = list[index];
    if (!item) continue;
    const persisted = await persistProductImage(item, { ...options, index });
    if (persisted && !results.includes(persisted)) {
      results.push(persisted);
    }
  }

  return results;
};

const resolvePublicAssetUrl = (value, req) => {
  const trimmed = String(value || "").trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("data:") || trimmed.startsWith("blob:")) return trimmed;

  const uploadsIndex = trimmed.indexOf("/public/uploads/");
  if (uploadsIndex !== -1) {
    const uploadPath = trimmed.slice(uploadsIndex);
    return buildPublicUploadUrl(req, uploadPath);
  }

  if (/^https?:\/\//i.test(trimmed)) return trimmed;

  if (trimmed.startsWith("/")) {
    return buildPublicUploadUrl(req, trimmed);
  }

  return trimmed;
};

module.exports = {
  isDataUrl,
  isPersistedUploadPath,
  persistProductImage,
  persistProductImages,
  buildPublicUploadUrl,
  getApiPublicRoot,
  resolvePublicAssetUrl,
};
