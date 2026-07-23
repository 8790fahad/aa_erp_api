const db = require("../models");
const PatientRecords = db.Patientrecords;
// const moment = require("moment");

exports.getPatientList = (req, res) => {
  const { facilityId } = req.params;
  db.sequelize
    .query("call get_patient_records(:facilityId)", {
      replacements: { facilityId },
    })
    .then((results) => res.json({ results }))
    .catch((err) => res.status(500).json({ err }));
};

// exports.getPatientList = (req, res) => {
//     db.sequelize
//     .query('select max(id) + 1 from patients', {
//       type: db.sequelize.QueryTypes.SELECT,
//     })
//     .then(results => res.json({ results }))sfdrfwerfsd
//     .catch(err => res.status(500).json({ err }));
// }

// exports.getUnassignedPatients = (req, res) => {
//   const { facilityId } = req.params;
//   db.sequelize
//     .query("call get_unassigned(:facilityId)", {
//       replacements: { facilityId },
//     })
//     .then((results) => res.json({ results }))
//     .catch((err) => res.status(500).json({ err }));
// };

// exports.patientClarking = (req, res) => {
//   const { facilityId } = req.params;
//   db.sequelize
//     .query(
//       'select * from patientrecords where id=1 and facilityId="' +
//         facilityId +
//         '"',
//       {
//         type: db.sequelize.QueryTypes.SELECT,
//       }
//     )
//     .then((results) => res.json({ results }))
//     .catch((err) => res.status(500).json({ err }));
// };

// exports.getUsersById = (req, res) => {
//   const { id, facilityId } = req.params;
//   db.sequelize
//     .query("call get_user_by_id(:id, :facilityId)", {
//       replacements: { id, facilityId },
//     })
//     .then((results) => res.json({ results }))
//     .catch((err) => res.status(500).json({ err }));
// };

// exports.doctor = (req, res) => {
//   const { doctor, facilityId } = req.params;

//   db.sequelize
//     .query("call get_patients_by_doctor(:doctor, :facilityId)", {
//       replacements: { doctor, facilityId },
//     })
//     .then((results) => res.json({ results }))
//     .catch((err) => res.status(500).json({ err }));
// };

// exports.getId = (req, res) => {
//   const { facilityId } = req.params;
//   db.sequelize
//     .query("call get_id(:facilityId)", {
//       replacements: { facilityId },
//     })
//     .then((results) => res.json({ id: results[0]["max(accountNo) + 1"] }))
//     .catch((err) => res.status(500).json({ err }));
// };

// exports.getAccount = (req, res) => {
//   const { facilityId } = req.params;
//   db.sequelize
//     .query("call get_account(:facilityId)", {
//       replacements: { facilityId },
//     })
//     .then((results) =>
//       res.json({ accountNo: results[0]["max(accountNo) + 1"] })
//     )
//     .catch((err) => res.status(500).json({ err }));
// };

// exports.newRecord = (req, res) => {
//   const {
//     id,
//     accountNo,
//     beneficiaryNo,
//     title,
//     firstname,
//     surname,
//     other,
//     Gender,
//     age,
//     maritalstatus,
//     DOB,
//     phoneNo,
//     email,
//     state,
//     lga,
//     occupation,
//     address,
//     kinName,
//     kinRelationship,
//     kinPhone,
//     kinEmail,
//     kinAddress,
//     enteredBy,
//     facilityId,
//   } = req.body;
//   const today = moment().format("YYYY-MM-DD");
//   db.sequelize
//     .query(
//       `INSERT INTO customer_records(id,accountNo,beneficiaryNo,title,firstname,surname,other,Gender,age,maritalstatus,DOB,phoneNo,email,state,lga,occupation,address,kinName,kinRelationship,kinPhone,kinEmail,kinAddress,dateCreated,enteredBy,facilityId) values("' +
//     "${id}"
// 	"${accountNo ? accountNo : ""}"
// 	"${beneficiaryNo ? beneficiaryNo : ""}"
//     "${title}"
//     "${firstname}"
//     "${surname}"
//     "${other}"
//     "${Gender}"
//     "${age}"
//     "${maritalstatus}"
//     "${DOB}"
//     "${phoneNo}"
//     "${email}"
//     "${state}"
//     "${lga}"
//     "${occupation}"
//     "${address}"
//     "${kinName}"
//     "${kinRelationship}"
//     "${kinPhone}"
//     "${kinEmail}"
//     "${kinAddress}"
//     ${today}
//     "${enteredBy}"
//     "${facilityId}")`,
//       {
//         type: db.sequelize.QueryTypes.INSERT,
//       }
//     )
//     .then((results) => {
//       // res.json({ results })
//       db.sequelize
//         .query(
//           `UPDATE patientfileno set beneficiaries = beneficiaries + 1 where accountNo = ${req.body.accountNo}`,
//           {
//             type: db.sequelize.QueryTypes.UPDATE,
//           }
//         )
//         .then((results2) => res.json({ results2 }))
//         .catch((err2) => res.status(500).json({ err2 }));
//     })
//     .catch((err) => {
//       res.status(500).json({ err });
//       console.log(err);
//     });
// };

// exports.upload = (req, res) => {
//   db.sequelize
//     .query(
//       'INSERT INTO customer_records(passport) values("' + req.body.fd + '")',
//       {
//         type: db.sequelize.QueryTypes.INSERT,
//       }
//     )
//     .then((results) => res.json({ results }))
//     .catch((err) => res.status(500).json({ err }));
// };

// exports.edit = (req, res) => {
//   db.sequelize
//     .query(
//       'update patientrecords set  title = "' +
//         req.body.title +
//         '",firstname = "' +
//         req.body.firstname +
//         '",surname = "' +
//         req.body.surname +
//         '",other = "' +
//         req.body.other +
//         '",Gender = "' +
//         req.body.Gender +
//         '",age = "' +
//         req.body.age +
//         '", maritalstatus = "' +
//         req.body.maritalstatus +
//         '",DOB = "' +
//         req.body.DOB +
//         '",phoneNo = "' +
//         req.body.phoneNo +
//         '",email = "' +
//         req.body.email +
//         '",state = "' +
//         req.body.state +
//         '",lga = "' +
//         req.body.lga +
//         '",occupation = "' +
//         req.body.occupation +
//         '",address = "' +
//         req.body.address +
//         '",kinName = "' +
//         req.body.kinName +
//         '",kinRelationship = "' +
//         req.body.kinRelationship +
//         '",kinPhone = "' +
//         req.body.kinPhone +
//         '",kinEmail = "' +
//         req.body.kinEmail +
//         '",kinAddress = "' +
//         req.body.kinAddress +
//         '" where id = "' +
//         req.body.id +
//         '"',
//       {
//         type: db.sequelize.QueryTypes.UPDATE,
//       }
//     )
//     .then((results) => res.json({ results }))
//     .catch((err) => res.status(500).json({ err }));
// };

// exports.delete = (req, res) => {
//   db.sequelize
//     .query('delete from patientrecords where id= "' + req.body.id + '"', {
//       type: db.sequelize.QueryTypes.DELETE,
//     })
//     .then((results) => res.json({ results }))
//     .catch((err) => res.status(500).json({ err }));
// };

// exports.assign = (req, res) => {
//   const { id, assigned_to, facilityId } = req.body;

//   db.sequelize
//     .query(`call assign(:assigned_to,:id, :facilityId)`, {
//       replacements: { assigned_to, id, facilityId },
//     })
//     .then((results) => res.json({ results }))
//     .catch((err) => res.status(500).json({ err }));
// };

// exports.patientAssignedToday = (req, res) => {
//   const { facilityId } = req.params;
//   const today = moment().format("YYYY-MM-DD");
//   db.sequelize
//     .query("call patients_assigned_today(:today, :facilityId)", {
//       replacements: { today, facilityId },
//     })
//     .then((results) => res.json({ results }))
//     .catch((err) => res.status(500).json({ err }));
// };

// exports.fetchByDoctor = (req, res) => {
//   const { assigned_to } = req.body;
//   const { facilityId } = req.params;
//   db.sequelize
//     .query(`call fetch_by_doctor(:assigned_to, :facilityId)`, {
//       replacements: { assigned_to, facilityId },
//     })
//     .then((results) => res.json({ results }))
//     .catch((err) => res.status(500).json({ err }));
// };

// exports.getAll = (req, res) => {
//   const { facilityId } = req.params;
//   db.sequelize
//     .query("call get_all(:facilityId)", {
//       replacements: { facilityId },
//     })
//     .then((results) => res.json({ results }))
//     .catch((err) => res.status(500).json({ err }));
// };

// exports.getIds = (req, res) => {
//   const { facilityId } = req.params;
//   db.sequelize
//     .query("call get_ids(:facilityId)", {
//       replacements: { facilityId },
//     })
//     .then((results) => {
//       const arr = [];
//       results.forEach((i) => arr.push(i.accountNo));
//       res.json({ arr });
//     })
//     .catch((err) => res.status(500).json({ err }));
// };

// exports.getBeneficiaryNo = (req, res) => {
//   const { accountNo, facilityId } = req.params;
//   db.sequelize
//     .query("call get_beneficiary_no(:accountNo,:facilityId)", {
//       replacements: { accountNo, facilityId },
//     })
//     .then((results) =>
//       res.json({ beneficiaryNo: results[0]["MAX(beneficiaryNo) + 1"] })
//     )
//     .catch((err) => res.status(500).json({ err }));
// };
// exports.operationNote = (req, res) => {
//   const {
//     date,
//     name,
//     patientId,
//     diagnosis,
//     surgery,
//     surgeons,
//     anesthetist,
//     anesthetic,
//     scrubNurse,
//     pintsGiven,
//     bloodLoss,
//     intraOpAntibiotics,
//     procedureNotes,
//     intraOpFindings,
//     remarks,
//     postOpOrder,
//     pathologyRequest,
//     facilityId,
//   } = req.body;
//   //  db.sequelize
//   //   .query(`INSERT INTO operationnotes(date,patientId, diagnosis, surgery, surgeons, anesthetist, anesthetic, scrubNurse, remarks, name, pintsGiven, bloodLoss, intraOpAntibiotics, intraOpFindings, procedureNotes, pathologyRequest, postOpOrder,facilityId) VALUES ("${date}","${patientId}","${diagnosis}","${surgery}","${surgeons.length ? surgeons.join(', ') : ''}","${anesthetist ? anesthetist.length ? anesthetist.join(', ') : '' : ''}","${anesthetic}","${scrubNurse.length ? scrubNurse.join(', ') : ''}","${remarks}","${name}","${pintsGiven}","${bloodLoss}","${intraOpAntibiotics}","${intraOpFindings}","${procedureNotes}","${pathologyRequest}","${postOpOrder}","${facilityId}")`,
//   //   { type: db.sequelize.QueryTypes.INSERT })
//   //   .then(results => res.json({ results }))
//   //   .catch(err => {
//   //     res.status(500).json({ err })
//   //     console.log(err)
//   //   })
//   db.sequelize
//     .query(
//       "call save_operation_note(:date,:patientId,:diagnosis, :surgery, :surgeons, :anesthetist, :anesthetic, :scrubNurse, :remarks, :name, :pintsGiven, :bloodLoss, :intraOpAntibiotics, :intraOpFindings, :procedureNotes,:pathologyRequest, :postOpOrder, :facilityId)",
//       {
//         replacements: {
//           date,
//           patientId,
//           diagnosis,
//           surgery,
//           surgeons,
//           anesthetist,
//           anesthetic,
//           scrubNurse,
//           remarks,
//           name,
//           pintsGiven,
//           bloodLoss,
//           intraOpAntibiotics,
//           intraOpFindings,
//           procedureNotes,
//           pathologyRequest,
//           postOpOrder,
//           facilityId,
//         },
//       }
//     )
//     .then((results) => res.json({ results }))
//     .catch((err) => {
//       console.log(err);
//       res.status(500).json({ err });
//     });
// };

//android-studio/bin$ sudo ./studio.sh
