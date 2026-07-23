const db = require("../models");
// const moment = require('moment');

// .query(`insert into dispensary(drug,quantity_dispensed,amount,expiry_date,by_whom,payment_status,receipt_no,facilityId) VALUES ${data
exports.dispense = (req, res) => {
  const { patientId } = req.params;
  db.sequelize
    .query("call get_diagnoses_by_id(:patientId)", {
      replacements: { patientId },
    })
    .then((results) => res.json({ results }))
    .catch((err) => res.status(500).json({ err }));
};

exports.newPrescription = (req, res) => {
  const { data } = req.body;

  db.sequelize
    .query(
      `insert into dispensary(drug,dosage,period,duration,frequency,patient_id,prescribed_by,facilityId,status) VALUES ${data
        .map((a) => "(?)")
        .join(",")};`,
      { replacements: data }
    )
    .then((results) => res.json({ results }))
    .catch((err) => res.json({ err }));
};

exports.getPendingPrescriptions = (req, res) => {
  const { facilityId } = req.params;
  db.sequelize
    .query(
      `SELECT a.patient_id, count(drug) as count, prescribed_by, concat(b.firstname, ' ', b.surname) as name FROM dispensary a JOIN patientrecords b ON (a.patient_id=b.accountNo) WHERE a.status='request' and a.facilityId="${facilityId}"`
    )
    .then((results) => {
      res.json({
        success: true,
        results: results[0],
      });
    })
    .catch((err) => {
      console.log(err);
      res.status(500).json({ success: false, err });
    });
};

exports.getAll = (req, res) => {
  const { facilityId } = req.params;
  db.sequelize
    .query("call get_all_prescriptions(:facilityId)", {
      replacements: { facilityId },
    })
    .then((results) => res.send(200).json({ results }))
    .catch((err) => res.send(500).json({ err }));
};

exports.getPendingRequestPharm = (req, res) => {
  const { patient_id, facilityId } = req.params;
  db.sequelize
    .query(
      `SELECT a.id,a.drug,b.cost_price+b.markUp as price, b.generic_name,b.drug_code,b.markUp,b.supplier,b.expiry_date,a.patient_id FROM dispensary a join drugpurchaserecords b ON a.drug=b.drug WHERE patient_id="${patient_id}" AND a.facilityId='${facilityId}' AND a.status="request"`
    )
    .then((results) => {
      res.json({
        success: true,
        results: results[0],
      });
    })
    .catch((err) => {
      console.log(err);
      res.status(500).json({ success: false, err });
    });
};

exports.updateDispense = (req, res) => {
  const { id, facilityId } = req.body;
  db.sequelize
    .query(
      `UPDATE dispensary SET status="Dispense" where id="${id}" and facilityId="${facilityId}"`
    )
    .then((results) => {
      res.json({
        success: true,
        results: results[0],
      });
    })
    .catch((err) => {
      console.log(err);
      res.status(500).json({ success: false, err });
    });
};
