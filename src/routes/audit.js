
const fs = require("fs");
const path = require("path");
const multer = require("multer");
const audit = require("../controller/audit");

module.exports = (app) => {
  const uploadDir = path.join(__dirname, "../uploads");
  if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir);
  }

  const storage = multer.diskStorage({
    destination: function (req, file, cb) {
      cb(null, uploadDir);
    },
    filename: function (req, file, cb) {
      cb(null, Date.now() + "-" + file.originalname);
    },
  });

  const upload = multer({ storage });

  app.post("/audit/upload-statement", upload.single("file"), audit.uploadBankStatement);
};
