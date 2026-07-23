const db = require("../models");
const moment =require("moment");

exports.saveRecordInfo = (req, res) => {
  const {
    accountType,
    clientAccount,
    clientBeneficiaryAcc,
    patientNo,
    patientId,
    patientHospitalId,
    firstname,
    surname,
    gender,
    dob,
    maritalStatus,
    occupation,
    phone,
    email,
    address,
    nextOfKinName,
    nextOfKinRelationship,
    nextOfKinPhone,
    nextOfKinEmail,
    nextOfKinAddress,
    contact,
    depositAmount,
    modeOfPayment,
    website,
    contactName,
    contactPhone,
    contactEmail,
    contactAddress,
    receiptsn,
    receiptno,
    description,
    facilityId,
    userId,
    bankName = "",
    guarantor_phoneNo = "",
    guarantor_name = "",
    guarantor_address = "",
  } = req.body;
  db.sequelize
    .query(
      `CALL customer_deposit(:patientId,:amount,:userId,:receiptsn,:receiptno,
        :description,:payment_mode,:facId,:destination,:name,:type,:in_date,
        :address,:phone,:email,:web,:paybles_head,:recievables_head,:guarantor_name,
        :guarantor_address,:guarantor_phoneNo,:bankName
        )`,
      {
        replacements: {
          patientId: clientAccount,
          amount: depositAmount && depositAmount !== "" ? depositAmount : 0,
          userId,
          receiptsn,
          receiptno,
          description,
          payment_mode: modeOfPayment,
          bankName: bankName ? bankName : "",
          facId: facilityId,
          destination:
            modeOfPayment.toLowerCase() === "cash" ? "400021" : "400022",
          type: accountType,
          name: `${surname} ${firstname}`,
          in_date: moment().format("YYYY-MM-DD hh:mm:ss"),
          address: contact === "self" ? address : contactAddress,
          phone: contactPhone ? contactPhone : phone,
          web: website ? website : "",
          email: contactEmail ? contactEmail : "",
          paybles_head: "500021",
          recievables_head: "400023",
          guarantor_name: guarantor_name ? guarantor_name : "",
          guarantor_address: guarantor_address ? guarantor_address : "",
          guarantor_phoneNo: guarantor_phoneNo ? guarantor_phoneNo : "",
          bankName: bankName ? bankName : "",
        },
      }
    )
    .then(() => {
      db.sequelize
        .query(
          `INSERT INTO patientrecords(facilityId,title,surname,firstname,other,Gender,age,maritalstatus,DOB,dateCreated,phoneNo,email,state,lga,occupation,address,kinName,kinRelationship,kinPhone,kinEmail,kinAddress,accountNo,beneficiaryNo,balance,id) VALUES ("${facilityId}","","${surname}","${firstname}","${contactName}","${gender}",0,"${maritalStatus}","${dob}","${moment().format(
            "YYYY-MM-DD"
          )}","${phone}","${email}","","","${occupation}","","${nextOfKinName}","${nextOfKinRelationship}","${nextOfKinPhone}","${nextOfKinEmail}","${nextOfKinAddress}","${clientAccount}","${clientBeneficiaryAcc}",0,"${
            clientAccount + "-" + clientBeneficiaryAcc
          }")`
        )
        .then((results) => {
          res.json({ success: true, results });
        })
        .catch((err) => {
          console.log(err);
          res.status(500).json({ success: false, err });
        });
    })
    .catch((err) => {
      console.log(err);
      res.status(500).json({ success: false, err });
    });
};

exports.getPatient = (req, res) => {
  const { facId } = req.params;
  db.sequelize
    .query(
      `SELECT concat(surname," ", firstname)as name, address,Gender,DOB,patient_id,email,id,
    accountNo FROM patientrecords WHERE facilityId="${facId}" ORDER BY dateCreated DESC`
    )
    .then((results) => {
      res.json({ success: true, results: results[0] });
    })
    .catch((err) => {
      res.json({ success: false, err });
    });
};
