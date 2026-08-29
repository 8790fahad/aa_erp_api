"use strict";

const { cloudinary } = require("./cloudinary");
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
    const isImage = /^image\//i.test(file.mimetype);
    const original = String(file.originalname || "document");
    const ext = original.includes(".")
      ? original.split(".").pop().toLowerCase()
      : "";
    const base = original
      .replace(/\.[^.]+$/, "")
      .replace(/[^a-zA-Z0-9_-]/g, "_")
      .slice(0, 60);
    return {
      folder: "aa_erp/purchase_orders",
      resource_type: isImage ? "image" : "raw",
      public_id: `${Date.now()}_${base}`,
      ...(isImage ? {} : { format: ext || undefined }),
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
  exports.poDocumentStorage.fields([{ name: "po_documents", maxCount: 1000 }])(
    req,
    res,
    (err) => {
      if (!err) return next();
      const message = err.message || String(err);
      const cloudDisabled =
        /cloud_name is disabled/i.test(message) || Number(err.http_code) === 401;
      return res.status(cloudDisabled ? 503 : 400).json({
        success: false,
        message: cloudDisabled
          ? "Cloudinary cloud is disabled. Enable this cloud in the Cloudinary dashboard, or put a working CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET in aa_erp_api/.env, then restart the API."
          : message || "Failed to upload documents to Cloudinary",
      });
    },
  );
};
