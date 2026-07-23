const db = require("../models");
const moment = require("moment");
exports.SaveEquipmentRegistrationForm = (req, res) => {
  console.log(req.body);
  const {
    registrationFee,
    address,
    number,
    name,
    equipment,
    brand,
    remarks,
    finding,
    fault,
    model,
    serialno,
    contact,
    formNumber,
    date,
    status,
    phone,
    // facilityId
  } = req.body.state;
  const {
    amount,
    collectedBy,
    description,
    destination,
    receiptsn,
    receiptno,
    facilityId,
    modeOfPayment,
    source,
    userId,
  } = req.body;
  db.sequelize
    .query(
      "call equipment_registration(:form_no,:date,:registration_fee,:address,:name,:equipment,:brand,:model,:status,:serial_number,:fault,:remark,:findings,:facilityId)",
      {
        replacements: {
          form_no: formNumber,
          date: date,
          registration_fee: registrationFee,
          address: address,
          name: name,
          equipment: equipment,
          brand: brand,
          model: model,
          status: status,
          serial_number: serialno,
          fault: fault,
          remark: remarks,
          findings: finding,
          facilityId: facilityId,
        },
      }
    )
    .then(
      db.sequelize.query(
        "CALL new_expense(:facId,:description,:source,:destination,:receiptsn,:receiptno,:payment_mode,:userId,:amount,:client_acct,:in_date,:t_type,:batch_narration)",
        {
          replacements: {
            facId: facilityId,
            amount: amount,
            description: description,
            source: source,
            userId: userId,
            receiptsn: receiptsn,
            receiptno: receiptno,
            payment_mode: modeOfPayment,
            destination: destination,

            client_acct: collectedBy,
            in_date: moment().format("YYYY-MM-DD hh:mm:ss"),
            t_type: 'Equipment Registration',
            batch_narration:''
          },
        }
      )
    )
    .then((results) => {
      res.json({ success: true, results });
    })
    .catch((err) => {
      console.log(err);
      res.status(500).json({ success: false, err });
    });
};
exports.getEquipmentRegistration = (req, res) => {
  const { facilityId } = req.params;
  console.log(req.params);
  db.sequelize
    .query("call get_equipment_registration(:facilityId)", {
      replacements: {
        facilityId: facilityId,
      },
    })
    .then((results) => {
      res.json({
        success: true,
        results: results,
      });
    })
    .catch((err) => {
      res.status(500).json({
        success: false,
        err,
      });
      console.log(err);
    });
};

exports.SaveEquipmentInstalationForm = (req, res) => {
  const {
    formNumber,
    date,
    nameOfInstitution,
    address,
    department,
    equipment,
    make,
    model,
    NameOfCertifyingEndUser,
    serialno,
    NameOfServiceEngineer,
    dateOfService,
    recomendation,
    facilityId,
  } = req.body;
  db.sequelize
    .query(
      "call equipment_installation(:in_form_no,:in_date,:in_institution_name,:in_address,:in_department,:in_equipment,:in_make,:in_model,:in_name_of_certify_end_user,:in_serial_number,:in_name_of_service_engineer,:in_date_of_service,:in_recommendation,:in_facilityId)",
      {
        replacements: {
          in_form_no: formNumber,
          in_date: date,
          in_institution_name: nameOfInstitution,
          in_address: address,
          in_department: department,
          in_equipment: equipment,
          in_make: make,
          in_model: model,
          in_name_of_certify_end_user: NameOfCertifyingEndUser,
          in_serial_number: serialno,
          in_name_of_service_engineer: NameOfServiceEngineer,
          in_date_of_service: dateOfService,
          in_recommendation: recomendation,
          in_facilityId: facilityId,
        },
      }
    )
    .then((results) => {
      res.json({ success: true, results });
    })
    .catch((err) => {
      console.log(err);
      res.status(500).json({ success: false, err });
    });
};
exports.getEquipmentInstallation = (req, res) => {
  const { facilityId } = req.params;
  db.sequelize
    .query("call get_equipment_installation(:facilityId)", {
      replacements: {
        facilityId: facilityId,
      },
    })
    .then((results) => {
      res.json({
        success: true,
        results: results,
      });
    })
    .catch((err) => {
      res.status(500).json({
        success: false,
        err,
      });
      console.log(err);
    });
};
exports.RepairForm = (req, res) => {
  console.log(req.body);
  const {
    formNumber,
    date,
    nameOfInstitution,
    address,
    department,
    equipment,
    make,
    model,
    serialno,
    NameOfCertifyingEndUser,
    equipmentStatusBeforeRepair,

    modeOfPayment,
    status,
    facilityId,
  } = req.body;
  db.sequelize
    .query(
      "call repair(:in_form_no,:in_date,:in_institution_name,:in_address,:in_department,:in_equipment,:in_make,:in_model,:in_serial_number,:in_equipment_status_before_repair,:in_status,:in_name_of_certify_end_user,:modeOfPayment,:in_facilityId)",
      {
        replacements: {
          in_form_no: formNumber,
          in_date: date,
          in_institution_name: nameOfInstitution,
          in_address: address,
          in_department: department,
          in_equipment: equipment,
          in_make: make,
          in_model: model,
          in_serial_number: serialno,
          in_name_of_certify_end_user: NameOfCertifyingEndUser,
          in_equipment_status_before_repair: equipmentStatusBeforeRepair,
          modeOfPayment,
          in_status: status,
          in_facilityId: facilityId,
        },
      }
    )
    .then((results) => {
      res.json({ success: true, results });
    })
    .catch((err) => {
      console.log(err);
      res.status(500).json({ success: false, err });
    });
};

exports.getRepair = (req, res) => {
  const { facilityId } = req.params;
  db.sequelize
    .query("call get_repair(:facilityId)", {
      replacements: {
        facilityId,
      },
    })
    .then((results) => {
      res.json({
        success: true,
        results: results,
      });
    })
    .catch((err) => {
      res.status(500).json({
        success: false,
        err,
      });
      console.log(err);
    });
};

exports.StatusForm = (req, res) => {
  db.sequelize
    .query(
      `
    INSERT INTO status_form
(form_no,
date,
status_date,
institution_name,
address,
department,
equipment,
make,
model,
serial_number,
equipment_status_before_repair,
status,
name_of_certify_end_user,
status_after_repair,
service_perform)
VALUES
("${req.body.formnumber}",
"${req.body.date}",
"${req.body.dateAfterServicePerform}",
"${req.body.institution}",
"${req.body.address}",
"${req.body.department}",
"${req.body.equipment}",
"${req.body.make}",
"${req.body.model}",
"${req.body.serialno}",
"${req.body.status}",
"${req.body.statusAfter}",
"${req.body.nameofcertifyenduser}",
"${req.body.statusAfter}",
"${req.body.servicePerform}");`
    )
    .then((results) => {
      res.json({ success: true, results });
    })
    .catch((err) => {
      console.log(err);
      res.status(500).status(500).json({ success: false, err });
    });
};

exports.getFormNumber = (req, res) => {
  const { facilityId, query_type } = req.params;
  console.log(facilityId, query_type);
  db.sequelize
    .query(`call get_form_no(:query_type,:facilityId)`, {
      replacements: {
        query_type,
        facilityId,
      },
    })
    .then((results) => res.json({ success: true, results: results[0] }))
    .catch((err) => res.json({ success: false, err }));
};
