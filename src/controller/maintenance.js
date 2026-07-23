const db = require("../models");
const  moment =  require("moment");

exports.addDieselUsage = (req, res) => {
  const { date, gen, time_started, time_stopped } = req.body;
  const stmt =
    "call save_new_diesel_usage(:date,:gen,:time_started,:time_stopped)";
  db.sequelize
    .query(stmt, { replacements: { date, gen, time_started, time_stopped } })
    .then((results) => res.json({ results }))
    .catch((err) => res.status(500).json({ err }));
};
exports.addDieselRefuel = (req, res) => {
  const { date, gen, quantity } = req.body;
  const stmt = "call save_new_diesel_refuel(:date,:gen,:quantity)   ";
  db.sequelize
    .query(stmt, { replacements: { date, gen, quantity } })
    .then((results) => res.json({ results }))
    .catch((err) => res.status(500).json({ err }));
};
exports.addServiceLog = (req, res) => {
  const { date, next_service_date } = req.body;
  const stmt = "call save_new_service_log(:date,:next_service_date)   ";
  db.sequelize
    .query(stmt, { replacements: { date, next_service_date } })
    .then((results) => res.json({ results }))
    .catch((err) => res.status(500).json({ err }));
};
exports.addErrorRepairLog = (req, res) => {
  const { date, time, repaired_by, nature } = req.body;
  const stmt =
    "call save_new_error_repair_log(:date,:time,:repaired_by,:nature)   ";
  db.sequelize
    .query(stmt, { replacements: { date, time, repaired_by, nature } })
    .then((results) => res.json({ results }))
    .catch((err) => res.status(500).json({ err }));
};

