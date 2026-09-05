"use strict";

const { cloudinary, applyCloudinaryConfig, isCloudinaryConfigured } = require("./cloudinary");
const { CloudinaryStorage } = require("multer-storage-cloudinary");
const multer = require("multer");

const profile = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: "mylikita/profile_images",
    format: "png",
    public_id: (req, file) => file.originalname,
  },
});

const transactions = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: "mylikita/transaction_receipts",
    format: "png",
    public_id: (req, file) => file.originalname,
  },
});

const lab = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: "mylikita/lab_uploads",
    format: "png",
    public_id: (req, file) => file.originalname,
  },
});

const logos = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: "aa_erp/logos",
    format: "png",
    public_id: (req, file) => file.originalname,
  },
});

const poDocAllowedTypes = [
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/jpg",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
];

const poDocuments = new CloudinaryStorage({
  cloudinary,
  params: async (req, file) => {
    applyCloudinaryConfig();
    const isImage = /^image\//i.test(file.mimetype);
    const original = String(file.originalname || "document");
    const ext = original.includes(".")
      ? original.split(".").pop().toLowerCase()
      : "";
    const base = original
      .replace(/\.[^.]+$/, "")
      .replace(/[^a-zA-Z0-9_-]/g, "_")
      .slice(0, 60);
    const stamp = Date.now();
    const kindRaw = String(req.query?.kind || "purchase_orders")
      .toLowerCase()
      .trim();
    const folderKind = ["purchase_orders", "payments", "memos"].includes(
      kindRaw,
    )
      ? kindRaw
      : "purchase_orders";
    const folder = `aa_erp/${folderKind}`;
    if (isImage) {
      return {
        folder,
        resource_type: "image",
        public_id: `${stamp}_${base}`,
      };
    }
    // Raw public_ids MUST include the extension. Passing `format` separately
    // makes Cloudinary store `{id}.{ext}` while the returned URL may omit it,
    // so later raw/download looks up the wrong public_id (Resource not found).
    return {
      folder,
      resource_type: "raw",
      public_id: `${stamp}_${base}${ext ? `.${ext}` : ""}`,
    };
  },
});

exports.profileStorage = multer({ storage: profile });
exports.transactionsStorage = multer({ storage: transactions });
exports.labStorage = multer({ storage: lab });
exports.logoStorage = multer({ storage: logos });
exports.poDocumentStorage = multer({
  storage: poDocuments,
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter(req, file, cb) {
    if (poDocAllowedTypes.includes(file.mimetype)) {
      cb(null, true);
      return;
    }
    cb(new Error("Only PDF, PNG, JPG, and DOCX files are allowed"), false);
  },
});

/** Cloudinary-only upload. Never writes PO files to local disk. */
exports.handlePoDocumentUpload = (req, res, next) => {
  applyCloudinaryConfig();
  if (!isCloudinaryConfigured()) {
    return res.status(503).json({
      success: false,
      message:
        "Cloudinary is not configured. Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET in aa_erp_api/.env, then restart the API.",
    });
  }

  exports.poDocumentStorage.fields([{ name: "po_documents", maxCount: 1000 }])(
    req,
    res,
    (err) => {
      if (!err) {
        const files = req?.files?.po_documents || [];
        files.forEach((file) => {
          console.log("[po-docs] Cloudinary upload ok", {
            originalname: file.originalname,
            public_id: file.filename,
            path: file.path,
            mimetype: file.mimetype,
            bytes: file.size,
          });
        });
        return next();
      }
      console.error("[po-docs] Cloudinary upload failed:", err.message || err);
      const message = err.message || String(err);
      const missingKey = /missing required parameter - api_key/i.test(message);
      const cloudDisabled =
        /cloud_name is disabled/i.test(message) || Number(err.http_code) === 401;
      return res.status(cloudDisabled || missingKey ? 503 : 400).json({
        success: false,
        message: missingKey
          ? "Cloudinary api_key is missing at upload time. Confirm CLOUDINARY_API_KEY is in aa_erp_api/.env and restart the API."
          : cloudDisabled
            ? "Cloudinary cloud is disabled. Enable this cloud in the Cloudinary dashboard, or put a working CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET in aa_erp_api/.env, then restart the API."
            : message || "Failed to upload documents to Cloudinary",
      });
    },
  );
};
