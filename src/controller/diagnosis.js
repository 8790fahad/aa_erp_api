const db = require("../models");
// const moment = require('moment');

exports.newDiagnosis = (req, res) => {
  const {
    BMR,
    LLL,
    RLL,
    RUL,
    abdomen,
    allergy,
    drugAllergy,
    asthmatic,
    athropometry_height,
    athropometry_weight,
    bloodpressure,
    cns,
    cvs,
    date,
    dehydration,
    development,
    diabetic,
    dresswith,
    drugHistory,
    eye_opening,
    generalexamination,
    headcircumference,
    pastSurgicalHistory,
    hypertensive,
    patient_id,
    immunization,
    management_plan,
    mss,
    muac,
    nutrition,
    observation_request,
    obtsGyneaHistory,
    otherAllergies,
    otherSocialHistory,
    otherSysExamination,
    others,
    palor,
    partToDress,
    pastMedicalHistory,
    pbnh,
    problem1,
    problem2,
    problem3,
    problem4,
    problem5,
    provisionalDiagnosis1,
    provisionalDiagnosis2,
    provisionalDiagnosis3,
    provisionalDiagnosis4,
    provisionalDiagnosis5,
    pulse,
    respiratory,
    respiratoryRate,
    seen_by,
    social,
    tempreture,
    vital_height,
    vital_weight,
    hypertensiveDuration,
    optimalSugarControl,
    hypertensiveRegularOnMedication,
    facilityId,
    presenting_complaints,
  } = req.body;

  console.log(req.body);

  const stmt = `insert into diagnosis (presenting_complaints,BMR, LLL, RLL, RUL, abdomen, allergy, drugAllergy, asthmatic, athropometry_height, athropometry_weight, bloodpressure, cns, cvs, dehydration, development, diabetic, dresswith, drugHistory, eye_opening, generalexamination, headcircumference, pastSurgicalHistory, hypertensive, patient_id, immunization, management_plan, mss, muac, nutrition, observation_request, obtsGyneaHistory, otherAllergies, otherSocialHistory, otherSysExamination, others, palor, partToDress, pastMedicalHistory, pbnh, problem1, problem2, problem3, problem4, problem5, provisionalDiagnosis1, provisionalDiagnosis2, provisionalDiagnosis3, provisionalDiagnosis4, provisionalDiagnosis5, pulse, respiratory, respiratoryRate, seen_by, social, tempreture, vital_height, vital_weight,hypertensiveDuration,hypertensiveRegularOnMedication,optimalSugarControl,status,facilityId) 
      values("${presenting_complaints}","${BMR}","${LLL}","${RLL}","${RUL}","${abdomen}","${allergy}",
      "${drugAllergy}","${asthmatic}","${athropometry_height}","${athropometry_weight}","${bloodpressure}",
      "${cns}","${cvs}","${dehydration}","${development}","${diabetic}","${dresswith}","${drugHistory}",
      "${eye_opening}","${generalexamination}","${headcircumference}","${pastSurgicalHistory}","${hypertensive}",
      "${patient_id}","${immunization}","${management_plan}","${mss}","${muac}","${nutrition}","${observation_request}",
      "${obtsGyneaHistory}","${otherAllergies}","${otherSocialHistory}","${otherSysExamination}","${others}","${palor}",
      "${partToDress}","${pastMedicalHistory}","${pbnh}","${problem1}","${problem2}","${problem3}","${problem4}",
      "${problem5}","${provisionalDiagnosis1}","${provisionalDiagnosis2}","${provisionalDiagnosis3}",
      "${provisionalDiagnosis4}","${provisionalDiagnosis5}","${pulse}","${respiratory}","${respiratoryRate}",
      "${seen_by}","${social}","${tempreture}","${vital_height}","${vital_weight}","${hypertensiveDuration}","${hypertensiveRegularOnMedication}","${optimalSugarControl}","seen","${facilityId}")`;
  const stmt2 = `UPDATE patientrecords set assigned_to="" and date_assigned=null where id="${patient_id}" and facilityId="${facilityId}"`;
  db.sequelize
    .query(stmt)
    .then(() => {
      db.sequelize
        .query(stmt2)
        .then((results) => res.json({ results }))
        .catch((err) => res.status(500).json({ err }));
    })
    .catch((err) => res.status(500).json({ err }));
};

exports.getDiagnosisByPatientID = (req, res) => {
  const { patientId, facilityId } = req.params;
  db.sequelize
    .query("call get_diagnoses_by_id(:patientId,:facilityId)", {
      replacements: { patientId, facilityId },
    })
    .then((results) => res.json({ results }))
    .catch((err) => res.status(500).json({ err }));
};

exports.saveNewInventory = (req, res) => {
  const {
    batchCode,
    itemType,
    supplier,
    price,
    quantity,
    invoiceNo,
    reorderLevel,
    facilityId,
    userId,
  } = req.body;

  db.sequelize
    .query(
      `INSERT INTO lab_inventory_table (batch_code,item_name,supplier,price,
        quantity,invoice_no,re_order_level,facilityId,created_by) 
        VALUES ("${batchCode}","${itemType}","${supplier}","${price}",
        "${quantity}","${invoiceNo}","${reorderLevel}","${facilityId}","${userId}")`
    )
    .then((results) => res.json({ success: true, results }))
    .catch((err) => res.status(500).json({ err }));
};
exports.getLabInventoryAll = (req, res) => {
  const { facilityId } = req.params;

  db.sequelize
    .query(`SELECT * FROM lab_inventory_table WHERE facilityId="${facilityId}"`)
    .then((results) => res.json({ success: true, results: results[0] }))
    .catch((err) => res.status(500).json({ err, success: false }));
};
