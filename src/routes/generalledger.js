const record = require("../controller/record");
const generalledger = require('../controller/generalledger')

module.exports = (app) => {
  app.post("/get_cash_report", generalledger.getTrailBalance);
  app.post("/expenditure/record-expenses", generalledger.insertLedger);
};
