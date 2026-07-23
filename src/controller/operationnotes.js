const db = require("../models");
// const moment = require('moment');

exports.newNote = (req, res) => {
  const { title, description, cost } = req.body;
  const stmt =
    'INSERT INTO services(title, description, cost) VALUES ("' +
    title +
    '","' +
    description +
    '","' +
    cost +
    '")';
  db.sequelize
    .query(stmt, { type: db.sequelize.QueryTypes.INSERT })
    .then((results) => res.json({ results }))
    .catch((err) => res.status(500).json({ err }));
};

exports.getAll = (req, res) => {
  const { facilityId } = req.params;
  db.sequelize
    .query("call get_all_op_notes(:facilityId)", {
      replacements: { facilityId },
    })
    .then((results) => res.json({ results }))
    .catch((err) => res.status(500).json({ err }));
};

exports.updateNote = (req, res) => {
  const {
    id,
    name,
    date,
    patientId,
    diagnosis,
    surgery,
    surgeons,
    anesthetist,
    anesthetic,
    scrubNurse,
    pintsGiven,
    bloodLoss,
    intraOpAntibiotics,
    procedureNotes,
    intraOpFindings,
    remarks,
    postOpOrder,
    pathologyRequest,
  } = req.body;
  db.sequelize
    .query(
      `UPDATE operationnotes SET date="${date}",patientId="${patientId}",diagnosis="${diagnosis}",surgery="${surgery}",surgeons="${surgeons}",anesthetist="${anesthetist}",anesthetic="${anesthetic}",scrubNurse="${scrubNurse}",remarks="${remarks}", name="${name}",pintsGiven="${pintsGiven}",bloodLoss="${bloodLoss}",intraOpAntibiotics="${intraOpAntibiotics}",intraOpFindings="${intraOpFindings}",procedureNotes="${procedureNotes}", pathologyRequest="${pathologyRequest}",postOpOrder="${postOpOrder}" WHERE id="${id}"`,
      { type: db.sequelize.QueryTypes.UPDATE }
    )
    .then((results) => res.json({ results }))
    .then((err) => res.status(500).json({ err }));
};

exports.newSurgeons = (req, res) => {
  const { name, type, facilityId, userId } = req.body;
  const stmt = `INSERT INTO surgeons_list(name, type, created_by, facilityId) VALUES ('${name}', '${type}', '${userId}', '${facilityId}')`;
  db.sequelize
    .query(stmt)
    .then((results) => res.json({ success: true, results }))
    .catch((err) => res.status(500).json({ err }));
};

exports.getSurgeonsList = (req, res) => {
  const { facilityId } = req.params;
  const stmt = `SELECT name, type, id FROM surgeons_list WHERE facilityId = "${facilityId}"`;
  db.sequelize
    .query(stmt)
    .then((results) => res.json({ success: true, results: results[0] }))
    .catch((err) => res.status(500).json({ err }));
};

exports.deleteSurgeon = (req, res) => {
  const { facilityId, id } = req.body;
  const stmt = `DELETE FROM surgeons_list WHERE facilityId = "${facilityId}" AND id="${id}"`;
  db.sequelize
    .query(stmt)
    .then((results) => res.json({ success: true }))
    .catch((err) => res.status(500).json({ err }));
};
