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
    folder: "inventria/logos",
    format: "png",
    public_id: (req, file) => file.originalname,
  },
});

exports.profileStorage = multer({ storage: profile });
exports.transactionsStorage = multer({ storage: transactions });
exports.labStorage = multer({ storage: lab });
exports.logoStorage = multer({ storage: logos });
