const parseData = require("../utilities/parser");

exports.uploadBankStatement = async (req, res) => {
  try {
    if (!req.file) {
      return res
        .status(400)
        .json({ success: false, message: "No file uploaded" });
    }
    const transactions = await parseData.extractStatementOfAccount(
      req.file.path
    );
    res.json({
      success: true,
      message: "Statement parsed successfully",
      transactions,
    });
  } catch (err) {
    console.error("Error parsing PDF:", err);
    res.status(500).json({
      success: false,
      message: "Failed to process PDF",
      error: err.toString(),
    });
  }
};
