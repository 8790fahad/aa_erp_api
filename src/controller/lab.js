const db = require("../models");
const moment = require("moment");
// const transport = require('../config/nodemailer');
const { newMail } = require("../services/emailApi");
const { sendSMS } = require("../services/smsApi");
const lab = require("../routes/lab");

exports.addLabHead = (req, res) => {
  const { head, subhead, description, facilityId, specimen, noOfLabels } =
    req.body;
  console.log(req.body);
  const stmt =
    "call add_new_lab_head(:labhead,:labsubhead,:specimen,:facId,:description,:noOfLabels)";
  db.sequelize
    .query(stmt, {
      replacements: {
        labhead: head,
        labsubhead: subhead,
        description,
        specimen,
        facId: facilityId,
        noOfLabels,
      },
    })
    .then((results) => res.json({ results }))
    .catch((err) => res.status(500).json({ err }));
};

exports.getLabByHead = (req, res) => {
  const { head, facilityId } = req.params;

  db.sequelize
    .query(
      `SELECT id, sort_index, subhead, head, description as test_name, unit, range_from, range_to, other_range
        specimen, price, percentage, noOfLabels, created_at, facilityId
        FROM lab_setup where head="${head}" AND facilityId="${facilityId}"`
    )
    .then((results) => res.json({ success: true, results: results[0] }))
    .catch((err) => res.status(500).json({ err }));
};

exports.updateLabHead = (req, res) => {
  const {
    head,
    facilityId,
    subhead,
    description,
    specimen,
    price,
    noOfLabels,
  } = req.body;
  console.log("head", req.body);

  db.sequelize
    .query(
      `UPDATE lab_setup SET head="${head}", description="${description}", 
        specimen="${specimen}", price="${price}", noOfLabels="${noOfLabels}"
        WHERE subhead="${subhead}" AND facilityId="${facilityId}"`
    )
    .then((results) => res.json({ success: true, results: results[0] }))
    .catch((err) => res.status(500).json({ err }));
};

exports.updateLabTest = (req, res) => {
  const {
    test_name,
    subhead,
    specimen,
    price,
    noOfLabels,
    range_from,
    range_to,
    unit,
    head,
    facilityId,
    description,
    sort_index,
  } = req.body;
  // let _test_name = test_name && test_name!=='' ? test_name : description

  db.sequelize
    .query(
      `UPDATE lab_setup SET sort_index="${sort_index}", head="${head}", description="${test_name}", 
      specimen="${specimen}", price="${price}", noOfLabels="${noOfLabels}",
      range_from="${range_from}", range_to="${range_to}", unit="${
        unit ? unit : ""
      }"
      WHERE subhead="${subhead}" AND facilityId="${facilityId}"`
    )
    .then((results) => res.json({ success: true, results: results[0] }))
    .catch((err) => res.status(500).json({ err }));
};

exports.addLab = (req, res) => {
  const {
    head,
    subhead,
    unit,
    test_name,
    range_to,
    range_from,
    price,
    facilityId,
    specimen,
    userId,
    description,
    noOfLabels,
    percentage,
    sort_index,
  } = req.body;
  // console.log(req.body)
  const stmt = `call add_new_lab_service(:labhead,:labsubhead,:unit,:test,:facilityId,:range_from,
      :range_to,:specimen,:price,:userId,:description,:noOfLabels,:percentage,:sort_index)`;
  db.sequelize
    .query(stmt, {
      replacements: {
        labhead: head,
        labsubhead: subhead,
        unit,
        range_from,
        range_to,
        test: test_name,
        specimen,
        facilityId,
        price: price && price !== "" ? price : 0,
        userId,
        description,
        noOfLabels: noOfLabels && noOfLabels !== "" ? noOfLabels : 0,
        percentage: percentage && percentage !== "" ? percentage : 0,
        sort_index: sort_index ? sort_index : 1,
      },
    })
    .then((results) => res.json({ results }))
    .catch((err) => {
      console.log(err);
      res.status(500).json({ err });
    });
};

exports.deleteLabService = (req, res) => {
  const { head, facilityId } = req.body;

  db.sequelize
    .query(
      `DELETE FROM lab_setup WHERE subhead="${head}" OR head="${head}" AND facilityId="${facilityId}"`
    )
    .then((results) => res.json({ success: true, results }))
    .catch((err) => res.status(500).json({ err }));
};

exports.createLabService = (req, res) => {
  const {} = req.body;
};

exports.getLabServicesTree = (req, res) => {
  const { facilityId } = req.params;
  const stmt = "call get_lab_services_tree(:facilityId)";
  db.sequelize
    .query(stmt, { replacements: { facilityId } })
    .then((results) => res.json({ success: true, results }))
    .catch((err) => res.status(500).json({ err }));
};

exports.getLabServicesHeads = (req, res) => {
  const { facilityId } = req.params;

  db.sequelize
    .query(
      `SELECT subhead, description, account FROM lab_setup WHERE facilityId="${facilityId}"`
    )
    .then((results) => res.json({ success: true, results: results[0] }))
    .catch((err) => res.status(500).json({ err }));
};

exports.getAllLabServices = (req, res) => {
  const { facilityId } = req.params;
  // const stmt = 'call get_all_lab_services(:facilityId)';
  const stmt = `SELECT head as subhead,subhead as title, account, description,price,noOfLabels,specimen,percentage,sort_index 
  FROM lab_setup WHERE facilityId="${facilityId}";`;
  db.sequelize
    .query(stmt, { replacements: { facilityId } })
    .then((results) => res.json({ success: true, results: results[0] }))
    .catch((err) => res.status(500).json({ err }));
};

exports.getAllPossibleLabServices = (req, res) => {
  const { facilityId } = req.params;
  // const stmt = 'call get_all_lab_services(:facilityId)';
  const stmt = `SELECT distinct description, head as subhead,subhead as title,price,noOfLabels,specimen,percentage FROM lab_setup`;
  db.sequelize
    .query(stmt, { replacements: { facilityId } })
    .then((results) => res.json({ success: true, results: results[0] }))
    .catch((err) => res.status(500).json({ err }));
};

exports.getNextLabChartCode = (req, res) => {
  const { facilityId, head } = req.params;
  db.sequelize
    .query(
      `SELECT ifnull(max(subhead), 0) + 1 as nextCode FROM lab_setup where head="${head}"
        AND facilityId="${facilityId}"`
    )
    .then((results) => {
      let nextCode = results[0][0].nextCode;
      res.json({
        success: true,
        results: nextCode === 1 ? parseInt(head) + 1 : nextCode,
      });
    })
    .catch((err) => {
      console.log(err);
      res.status(500).json({ success: false, err });
    });
};

exports.getAllLabRequestPending = (req, res) => {
  const { facilityId } = req.params;
  const stmt = "call get_pending_lab_request(:facilityId)";
  db.sequelize
    .query(stmt, { replacements: { facilityId } })
    .then((results) => res.json({ success: true, results }))
    .catch((err) => res.status(500).json({ err }));
};

exports.getLabRequisitions = (req, res) => {
  const { facilityId } = req.params;
  const stmt = "call get_lab_requisitions(:facilityId)";
  db.sequelize
    .query(stmt, { replacements: { facilityId } })
    .then((results) => res.json({ success: true, results }))
    .catch((err) => res.status(500).json({ err }));
};

exports.newLabRequest = (req, res) => {
  const { data } = req.body;
  // console.log(req.body);
  db.sequelize
    .query(
      `INSERT INTO lab_requisition(test,patient_id,facilityId,booking_no,price,percentage,department,test_group,code,status,created_by,receiptNo) 
        VALUES ${data.map((a) => "(?)").join(",")};`,
      { replacements: data }
    )
    .then((results) => res.json({ results }))
    .catch((err) => {
      console.log(err);
      res.status(500).json({ err });
    });
};

exports.getLabReqByPatient = (req, res) => {
  const { id, facilityId } = req.params;
  db.sequelize
    .query(`call get_test_by_patient(:patientId, :facilityId)`, {
      replacements: { patientId: id, facilityId },
    })
    .then((results) => res.json({ success: true, results }))
    .catch((err) => res.status(500).json({ err }));
};

exports.getNextLabNo = (req, res) => {
  const { facilityId } = req.params;

  db.sequelize
    .query("CALL get_next_lab_id(:facId)", {
      replacements: {
        facId: facilityId,
      },
    })
    .then((results) => res.json({ success: true, results: results[0] }))
    .catch((err) => res.status(500).json({ err }));
};

exports.getNextLabNoForCurrentMonth = (req, res) => {
  const { facilityId } = req.params;
  const startOfMonth = moment().startOf("month").format("YYYY-MM-DD");
  const endOfMonth = moment().endOf("month").format("YYYY-MM-DD");
  db.sequelize
    .query(
      `SELECT IFNULL(max(id),0) + 1 AS labId from lab_requisition WHERE facilityId="${facilityId}" and date(created_at) between date("${startOfMonth}") and date("${endOfMonth}")`
    )
    .then((results) => res.json({ success: true, results: results[0][0] }))
    .catch((err) => res.status(500).json({ err }));
};

exports.getLab = (req, res) => {
  const { facilityId } = req.params;
  // const {status,query_type,labno,department,facilityId } = req.params;

  db.sequelize
    // .query(`Call get_lab(:query_type, :facilityId, :status)`, {
    //   replacements: {
    //     status: 'pending',
    //     query_type: 'sample collection',
    //     facility
    //   }
    //})
    .query(
      `SELECT DISTINCT concat(b.surname, ' ', b.firstname) as name,a.booking_no as labno,  code,
        COUNT(DISTINCT department) AS no_of_tests, department_head AS department, a.patient_id
        FROM lab_process a JOIN patientrecords b ON a.patient_id=b.id 
        WHERE a.status = 'pending' AND a.facilityId="${facilityId}" AND b.facilityId="${facilityId}"
        GROUP BY name`
      // GROUP BY booking_no, ...
    )
    .then((results) => res.json({ success: true, results: results[0] }))
    .catch((err) => res.status(500).json({ err }));
};

exports.getSampleCollectionHistory = (req, res) => {
  const { facilityId } = req.params;

  db.sequelize
    .query(
      `SELECT DISTINCT a.booking_no as labno, concat(b.surname, ' ', b.firstname) as name, a.status,
        COUNT(DISTINCT department) AS no_of_tests, a.patient_id,code,department_head AS department
        FROM lab_process a JOIN patientrecords b ON a.patient_id=b.id 
        WHERE a.status IN ('Sample Collected') AND a.facilityId="${facilityId}" 
        AND b.facilityId="${facilityId}" 
        GROUP BY booking_no
        ORDER BY a.sample_collected_at DESC`
    )
    .then((results) => res.json({ success: true, results: results[0] }))
    .catch((err) => res.status(500).json({ err }));
};

exports.getPendingAnalysis = (req, res) => {
  const { facilityId, department } = req.params;

  db.sequelize
    .query(
      `SELECT DISTINCT a.booking_no as labno, concat(b.surname, ' ', b.firstname) as name, a.code,
        a.patient_id,a.status, department_head AS department, head, group_head as test_group, description, subhead
        FROM lab_process a JOIN patientrecords b ON a.patient_id=b.id 
        WHERE a.status IN ('Sample Collected', 'saved') ${
          department === "All" ? "" : 'AND department_head="' + department + '"'
        } 
        AND a.facilityId="${facilityId}" AND b.facilityId="${facilityId}"
        GROUP BY booking_no,a.patient_id`
    )
    .then((results) => res.json({ success: true, results: results[0] }))
    .catch((err) => {
      console.log(err);
      res.status(500).json({ err });
    });

  // getDepartmentCode(
  //   {department, facilityId},
  //   departmentCode => {
  //     db.sequelize
  //   .query(
  //     `SELECT DISTINCT a.booking_no as labno, concat(b.surname, ' ', b.firstname) as name, a.id
  //       FROM lab_requisition a JOIN patientrecords b ON a.id=b.patient_id
  //       WHERE a.status = 'Sample Collected' AND department="${departmentCode}"
  //       AND a.facilityId="${facilityId}" AND b.facilityId="${facilityId}"
  //       GROUP BY booking_no`,
  //   )
  //   .then((results) => res.json({ success: true, results: results[0] }))
  //   .catch((err) => res.status(500).json({ err }));
  //   },
  //   err => {
  //     console.log(err)
  //   }
  // )
};

exports.getAnalysisHistory = (req, res) => {
  const { facilityId, department } = req.params;

  db.sequelize
    .query(
      `SELECT DISTINCT a.booking_no as labno, concat(b.surname, ' ', b.firstname) as name,
        a.status, a.patient_id, a.code, a.department_head,a.department, a.group_head as test_group
        FROM lab_process a JOIN patientrecords b ON a.patient_id=b.id 
        WHERE a.status IN ('analyzed', 'result', 'printed') AND department_head="${department}" 
        AND a.facilityId="${facilityId}" AND b.facilityId="${facilityId}"
        GROUP BY booking_no
        ORDER BY a.analyzed_at DESC`
    )
    .then((results) => res.json({ success: true, results: results[0] }))
    .catch((err) => res.status(500).json({ err }));
};

// exports.getPendingMicrobiologyAnalysis = (req, res) => {
//   const { facilityId, labno } = req.params;

//   db.sequelize
//     .query(
//       `SELECT DISTINCT a.booking_no as labno, concat(b.surname, ' ', b.firstname) as name,
//       a.id, booking_no, department, status, test, result FROM lab_requisition
//         WHERE booking_no="${labno}" AND department="microbiology" AND facilityId="${facilityId}"`
//     )
//     .then((results) => res.json({ success: true, results: results[0] }))
//     .catch((err) => res.status(500).json({ err }));
// };

exports.getPendingDocComment = (req, res) => {
  const { facilityId } = req.params;

  db.sequelize
    .query(
      `SELECT DISTINCT a.booking_no as labno, concat(b.surname, ' ', b.firstname) as name,
        a.status, a.patient_id,a.department_head, department,a.code
        FROM lab_process a JOIN patientrecords b ON a.patient_id=b.id 
        WHERE a.status='analyzed'AND a.facilityId="${facilityId}"
        AND b.facilityId="${facilityId}";
    `
    )
    .then((results) => res.json({ success: true, results: results[0] }))
    .catch((err) => res.status(500).json({ err }));
};

exports.getDocReportHistory = (req, res) => {
  const { facilityId } = req.params;

  db.sequelize
    .query(
      `SELECT DISTINCT a.booking_no as labno, concat(b.surname, ' ', b.firstname) as name, 
        a.status, a.patient_id,a.department_head, department, result_by, a.status, a.code
        FROM lab_process a JOIN patientrecords b ON a.patient_id=b.id 
        WHERE a.status IN ('result', 'printed') AND a.facilityId="${facilityId}"
        AND b.facilityId="${facilityId}"
        ORDER BY a.result_at DESC;
    `
    )
    .then((results) => res.json({ success: true, results: results[0] }))
    .catch((err) => res.status(500).json({ err }));
};

exports.getAnalyzedTest = (req, res) => {
  const { facilityId, labno, department } = req.params;

  db.sequelize
    .query(
      `SELECT booking_no, subhead test, description, ifnull(result) result, department, department_head, 
        analyzed_by, unit, range_from, range_to, status, appearance, serology, culture_yielded,
        commission_type, percentage, price,
        sensitivity, resistivity, intermediaryTo FROM lab_process 
        WHERE status IN ('analyzed', 'result') AND booking_no="${labno}" 
        AND department="${department}" AND facilityId="${facilityId}"
      `
    )
    .then((results) => res.json({ success: true, results: results[0] }))
    .catch((err) => res.status(500).json({ err }));
};

// exports.getAnalyzedTest = (req, res) => {
//   const { facilityId, labno, department } = req.params;

//   db.sequelize
//     .query(
//       `SELECT booking_no, subhead test, description, result, department, department_head,
//         analyzed_by, unit, range_from, range_to, status, appearance, serology, culture_yielded,
//         sensitivity, resistivity, intermediaryTo FROM lab_process
//         WHERE status='analyzed' AND booking_no="${labno}" AND department="${department}"
//         AND facilityId="${facilityId}"
//       `
//     )
//     .then((results) => res.json({ success: true, results: results[0] }))
//     .catch((err) => res.status(500).json({ err }));
// };

exports.getPendingMicrobiologySample = (req, res) => {
  const { facilityId, department } = req.params;

  db.sequelize
    .query(
      `SELECT DISTINCT a.booking_no as labno, concat(b.surname, ' ', b.firstname) as name, 
        a.department_head AS department,
        COUNT(distinct description) AS no_of_tests, a.patient_id, description,a.subhead,a.code
        FROM lab_process a JOIN patientrecords b ON a.patient_id=b.id 
        WHERE a.status = 'Sample Collected' AND a.department_head='${department}' 
        AND a.facilityId="${facilityId}" AND b.facilityId="${facilityId}"
        GROUP by labno, description,a.patient_id`
    )
    .then((results) => res.json({ success: true, results: results[0] }))
    .catch((err) => res.status(500).json({ err }));
};

exports.getMicrobiologyAnalysisHistory = (req, res) => {
  const { facilityId, department } = req.params;

  db.sequelize
    .query(
      `SELECT DISTINCT a.booking_no as labno, concat(b.surname, ' ', b.firstname) as name, 
        COUNT(distinct description) AS no_of_tests, a.patient_id, description,a.subhead,
        a.status, a.department_head, a.department, a.code
        FROM lab_process a JOIN patientrecords b ON a.patient_id=b.id 
        WHERE a.status IN ('analyzed','result','printed') AND a.department_head='${department}' 
        AND a.facilityId="${facilityId}" AND b.facilityId="${facilityId}"
        GROUP by labno, description,a.patient_id
        ORDER BY a.analyzed_at DESC`
    )
    .then((results) => res.json({ success: true, results: results[0] }))
    .catch((err) => res.status(500).json({ err }));
};

exports.getLabPatients = (req, res) => {
  const { facilityId, condition, type } = req.params;

  db.sequelize
    .query(`call get_patient_list(:facilityId,:condition,:type)`, {
      replacements: {
        facilityId,
        condition,
        type,
      },
    })
    .then((results) => res.json({ success: true, results }))
    .catch((err) => res.status(500).json({ err }));
};

exports.saveLabNumber = (req, res) => {
  const { facilityId, id, labno, accountNo } = req.body;

  db.sequelize
    .query(
      `INSERT INTO lab_numbers (facilityId,patient_id,lab_no,patient_acc_no) 
        VALUES ("${facilityId}","${id}","${labno}","${accountNo}"); `
    )
    .then((results) => {
      res.json({ success: true, results });
    })
    .catch((err) => {
      console.log(err);
      res.status(500).json({ success: false, err });
    });
};

exports.createLabNewClient = (req, res) => {
  const {
    firstname,
    surname,
    gender,
    dob,
    clientAccount,
    clientBeneficiaryAcc,
    email,
    id,
    facId,
    booking,
    status,
    phone,
    other,
    // hemaStatus,
    // pathoStatus,
    // microStatus,
    // radioStatus,
  } = req.body;
  // console.log(req.body)

  db.sequelize
    .query(
      `call create_new_lab_client(:id,:accountNo,:beneficiaryNo,:firstname,:surname,:other,
        :gender,:dob,:email,:facId,:booking,:phone)`,
      {
        replacements: {
          id,
          firstname,
          surname,
          gender,
          dob,
          accountNo: clientAccount,
          beneficiaryNo: clientBeneficiaryAcc,
          email: email ? email : "",
          // id,
          facId,
          booking,
          status,
          other,
          phone: phone ? phone : "",
          // hemaStatus,
          // pathoStatus,
          // microStatus,
          // radioStatus,
        },
      }
    )
    .then((results) => {
      db.sequelize
        .query(`SELECT * FROM hospitals WHERE id="${facId}"`)
        .then((resp) => {
          let facility = resp[0];

          // if (phone) {
          //   sendSMS(
          //     phone,
          //     `Welcome to ${facility.name}, Feel free to reach out to us through this number`
          //   );
          // }
          if (email) {
            newMail(
              email,
              `
                <center>
                  <img src='https://res.cloudinary.com/emaitee/image/upload/v1590845025/logo.png' height='30px' width='100px' />
                </center>
    
                <h1>Warm welcome,</h1>
                <h4>Thank you for registering with ${facility.name}</h4>
    
                <p>
                  You would be contacted once your Laboratory Test Result is ready through this email.
                </p>
                <p>Please visit <a href='${facility.website}'>our website</a> to know more about what we do.</p>
                <br />
    
                <p>Best regards.</p>
                <p>${facility.name}.</p>
    
                <center>
                  <p style='text-align:center'>Follow us on: </p>
                  <a href="https://www.facebook.com/mylikitaNG" target="_blank">
                    <img src='https://cdn3.iconfinder.com/data/icons/capsocial-round/500/facebook-512.png' height='25px' width='25px' />
                  </a>
                  <a href="https://www.twitter.com/mylikitaNG" target="_blank">
                    <img src='https://cdn4.iconfinder.com/data/icons/social-media-icons-the-circle-set/48/twitter_circle-512.png' height='25px' width='25px' />
                  </a>
                  <a href="https://www.instagram.com/mylikitaNG" target="_blank" >
                    <img src='https://i.pinimg.com/originals/a2/5f/4f/a25f4f58938bbe61357ebca42d23866f.png' height='25px' width='25px' />
                  </a>
                </center>
              `
            );
          }

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

exports.createNewClientAccount = (req, res) => {
  const {
    firstname,
    surname,
    gender,
    dob,
    deposit,
    maritalStatus,
    occupation,
    clientAccount,
    clientBeneficiaryAcc,
    depositAmount,
    modeOfPayment,
    date,
    donorNo,
    donorName,
    address,
    contactName,
    phone,
    email,
    website,
    contactAddress,
    accountType,
    contact,
    facId,
    patientId,
    userId,
    nextOfKinName,
    nextOfKinRelationship,
    nextOfKinPhone,
    nextOfKinEmail,
    nextOfKinAddress,
    receiptsn,
    receiptno,
    description,
    type,
  } = req.body;

  db.sequelize
    .query(
      `CALL create_new_client_acc(:accountType,:surname,:firstname,:gender,:dob,:maritalStatus,:occupation,
        :address,:depositAmount,:modeOfPayment,:contactName,:contactAddress,:phone,:email,:website,:facilityId,
        :userId,:customerId)`,
      {
        replacements: {
          firstname: firstname ? firstname : "",
          surname: surname ? surname : "",
          gender: gender ? gender : "",
          dob: dob ? dob : "",
          deposit: deposit ? deposit : "",
          maritalStatus: maritalStatus ? maritalStatus : "",
          occupation: occupation ? occupation : "",
          clientAccount: clientAccount ? clientAccount : "",
          clientBeneficiaryAcc: clientBeneficiaryAcc
            ? clientBeneficiaryAcc
            : "",
          depositAmount: depositAmount ? depositAmount : "",
          modeOfPayment: modeOfPayment ? modeOfPayment : "",
          date: date ? date : "",
          donorNo: donorNo ? donorNo : "",
          donorName: donorName ? donorName : "",
          address: address ? address : "",
          contactName: contactName ? contactName : "",
          phone: phone ? phone : "",
          email: email ? email : "",
          website: website ? website : "",
          contactAddress: contactAddress ? contactAddress : "",
          accountType: accountType ? accountType : "",
          contact: contact ? contact : "",
          facilityId: facId,
          userId: userId ? userId : "",
          customerId: patientId ? patientId : "",
          nextOfKinName: nextOfKinName ? nextOfKinName : "",
          nextOfKinRelationship: nextOfKinRelationship
            ? nextOfKinRelationship
            : "",
          nextOfKinPhone: nextOfKinPhone ? nextOfKinPhone : "",
          nextOfKinEmail: nextOfKinEmail ? nextOfKinEmail : "",
          nextOfKinAddress: nextOfKinAddress ? nextOfKinAddress : "",
          destination:
            modeOfPayment.toLowerCase() === "cash" ? "400021" : "400022",
          paybles_head: "500021",
          recievables_head: "400023",
          receiptsn,
          receiptno,
          description,
          type: type ? type : "insert",
        },
      }
    )
    .then((results) => {
      db.sequelize
        .query(`SELECT * FROM patientrecords where patient_id="${patientId}"`)
        .then((resp) => {
          let patient = resp[0].length ? resp[0][0] : {};
          res.json({ success: true, results: patient });
        })
        .catch((err) => {
          console.log(err);
          res.status(500).json({ err });
        });
    })
    .catch((err) => {
      console.log(err);
      res.status(500).json({ err });
    });
};

exports.getPendingClientAccApproval = (req, res) => {
  const { facilityId } = req.params;
  db.sequelize
    .query(
      `SELECT * FROM patientfileno WHERE status='pending' AND facilityId="${facilityId}" ORDER BY createdAt desc`
    )
    .then((results) => res.json({ success: true, results: results[0] }))
    .catch((err) => res.status(500).json({ err }));
};

exports.approveClientAccount = (req, res) => {
  const { applicationId, nextAccNo, userId, status, facilityId } = req.body;

  db.sequelize
    .query(
      `select ifnull(max(accountNo), 0) + 1 AS accountNo from patientfileno WHERE facilityId="${facilityId}"`
    )
    .then((results) => {
      // res.json({ success: true, results })
      const newAvailableId = results[0][0].accountNo;
      db.sequelize
        .query(
          `UPDATE patientfileno SET status="approved", accountNo="${newAvailableId}", approved_by="${userId}", 
            approved_at="${moment().format(
              "YYYY-MM-DD hh:mm:ss"
            )}", status="${status}" 
            WHERE id="${applicationId}" AND facilityId="${facilityId}"`
        )
        .then((resp) => res.json({ success: true, resp }))
        .catch((err) => res.status(500).json({ err }));
    })
    .catch((err) => res.status(500).json({ err }));
};

exports.getAccountTypes = (req, res) => {
  const { facilityId } = req.params;

  db.sequelize
    .query(
      `SELECT DISTINCT accountType FROM patientfileno WHERE facilityId="${facilityId}"`
    )
    .then((results) => res.json({ success: true, results: results[0] }))
    .catch((err) => res.status(500).json({ err }));
};

exports.getAccountsByType = (req, res) => {
  const { facilityId, type } = req.params;

  db.sequelize
    .query(
      `SELECT * FROM patientfileno WHERE facilityId="${facilityId}" AND status="approved" AND accountType="${type}"`
    )
    .then((results) => res.json({ success: true, results: results[0] }))
    .catch((err) => res.status(500).json({ err }));
};

exports.getPatientInfo = (req, res) => {
  const { patientId, facilityId } = req.params;

  db.sequelize
    .query(
      `SELECT a.id AS id, concat(a.surname, ' ', a.firstname) as name, a.dob, a.Gender as gender, 
        ifnull(a.phoneNo,'') as phone, a.email, b.accountNo,b.accountType
        FROM patientrecords a JOIN patientfileno b ON a.accountNo = b.accountNo
        WHERE a.id = "${patientId}" AND a.facilityId="${facilityId}"`
    )
    .then((results) => res.json({ success: true, results: results[0] }))
    .catch((err) => {
      res.status(500).json({ err });
      console.log(err);
    });
};

exports.getLabHistory = (req, res) => {
  const { facilityId, labno, patientId } = req.params;

  db.sequelize
    .query(
      `
      SELECT concat(a.surname, ' ', a.firstname) as name, a.dob, a.Gender as gender, a.id,
        DOB as dob, ifnull(a.phoneNo,'') as phoneNo,b.history 
        FROM patientrecords a JOIN lab_numbers b
        WHERE a.id = "${patientId}" AND b.lab_no="${labno}" AND a.facilityId="${facilityId}"`
    )
    .then((results) => res.json({ success: true, results: results[0] }))
    .catch((err) => res.status(500).json({ err }));
};

exports.getPatientLabDetails = (req, res) => {
  const { facilityId, patientId } = req.params;

  db.sequelize
    .query(
      `SELECT concat(surname, ' ', firstname) as name, dob, Gender as gender, 
        ifnull(phoneNo,'') as phoneNo FROM patientrecords 
        WHERE patient_id = "${patientId}" AND facilityId="${facilityId}"`
    )
    .then((results1) => {
      db.sequelize
        .query(
          `SELECT distinct department, created_at, booking_no, status FROM lab_requisition 
            WHERE patient_id="${patientId}" AND facilityId="${facilityId}"`
        )
        .then((results) =>
          res.json({
            success: true,
            patientInfo: results1[0][0],
            labs: results[0],
          })
        )
        .catch((err) => res.status(500).json({ err }));
    })
    .catch((err) => res.status(500).json({ err }));
};

exports.getPendingLab = (req, res) => {
  const { labno, facilityId } = req.params;

  db.sequelize
    .query(
      `SELECT DISTINCT specimen, booking_no, department_head as department, group_head, 
        specimen, description, created_at,
        status FROM lab_process 
        WHERE patient_id="${labno}" AND status IN ('pending','Sample Collected') 
          AND facilityId="${facilityId}"`
    )
    .then((labInfo) => {
      db.sequelize
        .query(
          `SELECT history FROM lab_numbers WHERE patient_id="${labno}" AND facilityId="${facilityId}"`
        )
        .then((results) => {
          res.json({
            success: true,
            labInfo: labInfo[0],
            labHistory: results[0][0].history,
          });
        })
        .catch((err) => {
          console.log(err);
          res.status(500).json({ err });
        });
    })
    .catch((err) => {
      console.log(err);
      res.status(500).json({ err });
    });
};

exports.getSampleCollectedLabsForDept = (req, res) => {
  const { labno, facilityId, department } = req.params;

  db.sequelize
    .query(
      `SELECT distinct booking_no, department, status, specimen, description, subhead as test,group_head, sn, sop_instance_id,
        unit, range_from, range_to, ifnull(result,'') result, appearance, serology,culture_yielded,IFNULL(sensitivity, '') 
        AS sensitiveTo, IFNULL(intermediaryTo, '') AS intermediaryTo, IFNULL(resistivity, '') AS resistantTo, 
        sample_collected_by, sample_collected_at,department_head, commission_type, percentage
        FROM lab_process 
        WHERE booking_no="${labno}" ${
        department === "All"
          ? ""
          : 'AND (department_head="' +
            department +
            '" OR department="' +
            department +
            '")'
      } 
        # AND (result='' OR result IS NULL)
        AND status IN ('Sample Collected', 'analyzed', 'result','saved', "printed", "uploaded") AND facilityId='${facilityId}'`
    )
    .then((results) => {
      res.json({
        success: true,
        results: results[0],
      });
    })
    .catch((err) => {
      console.log(err);
      res.status(500).json({ err });
    });
};

function getDepartmentCode({ department, facilityId }, success, error) {
  db.sequelize
    .query(
      `SELECT subhead FROM lab_setup WHERE description="${department}" OR subhead="${department}"
    AND facilityId="${facilityId}"`
    )
    .then((results) => {
      let departmentCode = results[0][0].subhead;
      success(departmentCode);
    })
    .catch((err) => {
      error(err);
    });
}

exports.updateLabRequest = (req, res) => {
  const { status, booking_no, department, facilityId, userId } = req.body;
  const sample_collected_at = moment().format("YYYY-MM-DD hh:mm:ss");

  getDepartmentCode(
    { department, facilityId },
    (departmentCode) => {
      db.sequelize
        .query(
          `UPDATE lab_requisition SET status="${status}"${
            status === "Sample Collected"
              ? ',sample_collected_by="' +
                userId +
                '", sample_collected_at="' +
                sample_collected_at +
                '"'
              : ""
          }
            WHERE department="${departmentCode}" AND booking_no="${booking_no}" 
            AND facilityId="${facilityId}"`
        )
        .then((results) => res.json({ success: true, results }))
        .catch((err) => res.status(500).json({ err }));
    },
    (err) => {
      console.log(err);
    }
  );
};

exports.saveTestResult = (req, res) => {
  const {
    booking_no = "",
    department = "",
    facilityId = "",
    test = "",
    result = "",
    userId = "",
    status = "",
  } = req.body;
  const timeNow = moment().format("YYYY-MM-DD hh:mm:ss");
  db.sequelize
    .query(
      `UPDATE lab_requisition SET result="${result}", analyzed_by="${userId}", analyzed_at="${timeNow}",
      status="${status}"
      WHERE department="${department}" AND test="${test}"
      AND booking_no="${booking_no}" AND facilityId="${facilityId}"`
      // `CALL new_test_result(:facilityId,:result,:department,:test,:booking_no,:userId)`,
      // {
      //   replacements: {
      //     booking_no,
      //     department,
      //     facilityId,
      //     test,
      //     result,
      //     userId,
      //   },
      // },
    )
    .then((results) => res.json({ success: true, results }))
    .catch((err) => {
      res.status(500).json({ err });
      console.log(err);
    });
};

exports.updateTestResult = (req, res) => {
  const {
    booking_no,
    department,
    facilityId,
    test,
    result = "",
    appearance = "",
    serology = "",
    culture_yielded = "",
    sensitivity = "",
    resistivity = "",
    intermediaryTo = "",
    userId,
  } = req.body;
  const timeNow = moment().format("YYYY-MM-DD hh:mm:ss");

  // console.log(req.body);
  db.sequelize
    .query(
      `UPDATE lab_requisition SET result="${result}", appearance="${appearance}", serology="${serology}",
        culture_yielded="${culture_yielded}", sensitivity="${sensitivity}", resistivity="${resistivity}",
        intermediaryTo="${intermediaryTo}", analyzed_by="${userId}", analyzed_at="${timeNow}",
        status='analyzed'
        WHERE department="${department}" AND test="${test}"
        AND booking_no="${booking_no}" AND facilityId="${facilityId}"`
    )
    .then((results) => res.json({ success: true, results }))
    .catch((err) => {
      res.status(500).json({ err });
      console.log(err);
    });
};

// this controller has been replaced by the one below it
// exports.getCompletedLabTests = (req, res) => {
//   const { facilityId } = req.params;
//   db.sequelize
//     .query(
//       `SELECT a.booking_no, concat(b.firstname, ' ', b.surname) as name,a.id,a.created_at,
//         a.department,count(a.status) as tests,(select count(*) from lab_requisiton where status!='result') as pending
//         FROM lab_requisition a JOIN patientrecords b ON a.id=b.patient_id AND a.status='result'
//         AND a.facilityId="${facilityId}"`,
//     )
//     .then((results) => res.json({ success: true, results: results[0] }))
//     .catch((err) => res.status(500).json({ err }));
// };

exports.getCompletedLabTests = (req, res) => {
  const { facilityId } = req.params;
  db.sequelize
    .query(
      `SELECT a.booking_no, concat(b.firstname, ' ', b.surname) as name,a.patient_id,a.created_at,
        a.department,count(a.status) as tests,
        (
          SELECT COUNT(*) FROM lab_requisition 
            WHERE status='result' AND booking_no=a.booking_no AND facilityId="${facilityId}"
        ) as completed
        FROM lab_requisition a JOIN patientrecords b ON a.patient_id=b.id WHERE
        a.facilityId="${facilityId}" AND b.facilityId="${facilityId}" 
        GROUP BY booking_no,a.patient_id,a.created_at,a.department,name
        order by count(a.status)-completed, a.created_at DESC`
    )
    .then((results) => res.json({ success: true, results: results[0] }))
    .catch((err) => {
      console.log(err);
      res.status(500).json({ err });
    });
};

exports.getLabResults = (req, res) => {
  const { labNo, facilityId } = req.params;
  db.sequelize
    .query(
      `SELECT result, specimen,code,receiptNo,booking_no, description as test, group_head as test_group, a.department, a.result, unit, 
        range_from, range_to, appearance,serology,culture_yielded,resistivity,sensitivity, intermediaryTo,
        a.status, a.created_by, a.created_at, a.sample_collected_by,
        CONCAT(b.firstname, ' ', b.lastname) AS result_by,
        result_at, reviewed_by 
        FROM lab_process 
        a JOIN users b ON a.result_by = b.username
        WHERE booking_no='${labNo}' AND a.facilityId="${facilityId}" 
        AND b.facilityId="${facilityId}" 
        # GROUP BY test,booking_no,group_head
        ORDER BY created_at DESC`
    )
    .then((results) => res.json({ success: true, results: results[0] }))
    .catch((err) => res.status(500).json({ err }));
};

exports.getUnCompletedLabResults = (req, res) => {
  const { labNo, facilityId } = req.params;
  db.sequelize
    .query(
      `SELECT specimen,code,receiptNo,booking_no, description as test, group_head as test_group, department, ifnull(result,'') result, unit, 
        range_from, range_to, appearance,serology,culture_yielded,resistivity,sensitivity, intermediaryTo,
        status, created_by, created_at, sample_collected_by, result_by, result_at, reviewed_by 
        FROM lab_process 
        WHERE booking_no='${labNo}' AND facilityId="${facilityId}" 
        ORDER BY group_head`
    )
    .then((results) => res.json({ success: true, results: results[0] }))
    .catch((err) => res.status(500).json({ err }));
};

exports.getSensitivities = (req, res) => {
  const { facilityId } = req.params;

  db.sequelize
    .query(
      `SELECT antibiotic from sensitivity_list WHERE facilityId="${facilityId}"`
    )
    .then((results) => res.json({ success: true, results: results[0] }))
    .catch((err) => res.status(500).json({ err }));
};

exports.saveNewSensitivity = (req, res) => {
  const { facilityId, antibiotic, userId } = req.body;

  db.sequelize
    .query(
      `INSERT INTO sensitivity_list (antibiotic,facilityId,created_by) VALUES ("${antibiotic}","${facilityId}","${userId}")`
    )
    .then((results) => res.json({ success: true, results }))
    .catch((err) => res.status(500).json({ err }));
};

exports.deleteSensitivities = (req, res) => {
  const { facilityId, antibiotic } = req.body;

  db.sequelize
    .query(
      `DELETE FROM sensitivity_list WHERE antibiotic="${antibiotic}" AND facilityId="${facilityId}"`
    )
    .then((results) => res.json({ success: true, results: results[0] }))
    .catch((err) => res.status(500).json({ err }));
};

exports.getReportTemplatesList = (req, res) => {
  const { facilityId } = req.params;

  db.sequelize
    .query(
      `SELECT id, name,department,header,body FROM report_templates WHERE facilityId="${facilityId}"`
    )
    .then((results) => res.json({ success: true, results: results[0] }))
    .catch((err) => res.status(500).json({ err }));
};

exports.saveNewReportTemplate = (req, res) => {
  const { facilityId, reportName, department, header, body, userId } = req.body;
  let _body = body.replace(/"/g, '\\"').replace(/'/g, '\\"');
  // console.log(_body)

  db.sequelize
    .query(
      `INSERT INTO report_templates (name,department,header,body,facilityId,created_by) 
        VALUES ('${reportName}','${department}','${header}','${_body}','${facilityId}','${userId}')`
    )
    .then((results) => res.json({ success: true, results }))
    .catch((err) => {
      res.status(500).json({ err });
      console.log(err);
    });
};

exports.updateReportTemplate = (req, res) => {
  const { facilityId, reportName, department, header, body } = req.body;
  const { id } = req.params;

  db.sequelize
    .query(
      `UPDATE report_templates SET name="${reportName}", department="${department}",header="${header}",
        body="${body}" WHERE id="${id}" AND facilityId="${facilityId}"`
    )
    .then((results) => res.json({ success: true, results }))
    .catch((err) => {
      res.status(500).json({ err });
      console.log(err);
    });
};

exports.getDepartmentList = (req, res) => {
  const { facilityId } = req.params;

  db.sequelize
    .query(
      `SELECT DISTINCT subhead, description from lab_setup WHERE head=1000 AND facilityId="${facilityId}"`
    )
    .then((results) => res.json({ success: true, results: results[0] }))
    .catch((err) => res.status(500).json({ err }));
};

exports.saveMicrobiologyResult = (req, res) => {
  const {
    appearance,
    serology,
    culture_yielded,
    labno,
    facilityId,
    comment,
    userId,
    userFullname,
    userSignation,
    department,
    test,
    sensitivity,
    resistivity,
    intermediaryTo,
    useTemplate,
  } = req.body;

  const timeNow = moment().format("YYYY-MM-DD hh:mm:ss");

  // Lorem ipsum dolor sit, amet consectetur adipisicing elit. Odio nobis saepe nostrum quos voluptatem mollitia, voluptatibus nihil modi, a similique nam distinctio temporibus accusamus culpa aliquid in sunt dolorem laboriosam eius eveniet ipsam. Nulla distinctio, blanditiis quis ex id perferendis modi consequatur ipsa voluptates quisquam officiis repellendus, laborum rem aut. Vitae, deleniti ipsa repellendus dignissimos aut facere dolor aliquid tenetur perspiciatis? Mollitia eveniet quibusdam modi quos, neque, ipsam fugiat at perspiciatis, rerum atque nam officiis blanditiis dolor ipsum aliquid repudiandae. Nisi nobis quam inventore nam, fuga itaque! Est totam necessitatibus corrupti. Quod, quis. Debitis quam est, praesentium error voluptatibus quisquam nisi aperiam repellendus repudiandae aspernatur aut blanditiis corrupti sed, accusamus doloremque eligendi nam velit, maiores iure earum. Ipsa expedita ratione mollitia quia sed iure quidem molestiae consequuntur unde nesciunt, beatae minima non est minus doloribus magni earum soluta deserunt et officia alias amet atque. Fugiat molestiae voluptatem nesciunt recusandae minus, itaque perferendis optio quae earum voluptate. Sequi, quis deleniti dolores cum consectetur eum a. Eos atque ipsam cumque doloremque, accusamus ex delectus reprehenderit possimus! Itaque velit commodi tempore vero repellat magni, repudiandae similique sed harum exercitationem odio ut laudantium adipisci nisi? Aliquid dolores rem consectetur, quo impedit illo eum, neque mollitia ducimus voluptatum sapiente unde ratione tenetur ea commodi nam ut! Ad corporis nemo id maiores debitis et rem. Accusantium vero pariatur dolore quo praesentium sunt veritatis mollitia, cumque, provident animi omnis, distinctio eum asperiores numquam ipsum quibusdam quidem ratione? Animi exercitationem sapiente esse ad alias harum perferendis porro aspernatur. Quas itaque similique, dolores cupiditate delectus inventore obcaecati voluptatem ratione, sit excepturi perspiciatis blanditiis quis, nobis pariatur eos quibusdam iusto! Temporibus quasi est expedita adipisci optio eius ut iusto accusamus consequatur nihil, sunt dolorum explicabo alias ratione eum, voluptatem odit possimus ab voluptate excepturi labore veritatis architecto velit. Voluptas, pariatur cumque. Ipsa, hic sapiente. Unde mollitia, impedit libero amet dolor sunt molestias rerum velit saepe numquam distinctio possimus sint labore? Earum rem totam esse sapiente facilis error, nisi dolores tenetur, asperiores necessitatibus quia itaque harum at maxime magnam, voluptatem possimus quaerat ut eaque ipsa eos! Nobis at, officia magnam quod veniam a nesciunt repellat unde doloremque consequuntur exercitationem, deserunt eum nam. Blanditiis, dignissimos iusto, magni dolore, similique doloribus quidem aspernatur itaque impedit labore nihil veritatis quia suscipit totam eveniet asperiores perferendis consequatur voluptatibus excepturi. Aperiam commodi dolores eaque! Porro veniam, dolorum facilis minima cum ipsam! Nihil rem nesciunt commodi adipisci accusamus, iure omnis blanditiis suscipit hic ratione molestias aspernatur reprehenderit necessitatibus? Aut harum quam deleniti, laborum aperiam deserunt placeat nam, debitis perspiciatis vero reprehenderit nemo neque quibusdam, dicta itaque unde quisquam totam voluptates. Suscipit facilis quasi aliquid voluptatum, natus rem, aspernatur maiores, veritatis commodi consequuntur nihil dicta quae accusamus hic quia blanditiis quod facere culpa error veniam quas porro? Ex est nesciunt, ipsam beatae placeat fugit quae atque modi aspernatur cupiditate quisquam eius quos praesentium quidem ipsum? Doloribus praesentium sed est porro non accusamus quisquam vel maiores quod, dicta temporibus ex explicabo omnis. Voluptatibus, laboriosam eum! Ipsam qui similique perspiciatis, suscipit tenetur consectetur omnis, quod mollitia facere amet minima explicabo numquam fugiat architecto cumque! Perferendis ad itaque a eos saepe eligendi perspiciatis quaerat magni suscipit velit at deserunt quibusdam sint, numquam possimus. Maxime molestias autem delectus dolores beatae! Voluptas hic nemo velit. Ducimus molestiae debitis vero reprehenderit exercitationem facilis, voluptas, autem neque harum voluptates illum libero, iure fugiat nulla maiores at cum dolore animi. Dolor rem officia cupiditate perspiciatis minima autem in a at temporibus! Aut, ratione impedit et sed architecto voluptas quisquam aliquid illo dolor animi quaerat aspernatur est consectetur hic id dolore nobis tenetur minus perferendis voluptatibus, eligendi perspiciatis fugit cum debitis? Sapiente maiores atque modi repudiandae nesciunt autem quaerat? Cum dolorem atque sit nemo repudiandae molestias eaque nihil, vel ad voluptas hic porro optio? Assumenda, nisi nam illum quod itaque similique voluptatibus blanditiis modi fuga nostrum cum ea nulla eaque aspernatur dolorum delectus est laborum sint mollitia doloremque! Obcaecati, facilis nisi assumenda voluptates porro cum exercitationem nam temporibus, eligendi repudiandae quae fugiat recusandae enim deleniti suscipit laudantium perspiciatis accusantium vero rerum magnam animi? Autem nemo eos eaque earum. Rem alias ad, incidunt repellat aliquam dicta hic sequi dignissimos adipisci illo iste beatae reprehenderit architecto velit illum impedit dolores ut magnam explicabo molestiae! Repellat tempore, reiciendis amet nostrum, dicta at sequi laboriosam ipsa facilis eum quis! Reprehenderit, doloribus amet nemo aliquid ex porro nulla cum, sit ea repellendus exercitationem sint harum molestiae unde tempore libero quos.
  db.sequelize
    .query(
      `UPDATE lab_requisition SET appearance="${appearance}", serology="${serology}", 
        culture_yielded="${culture_yielded}", status="analyzed", sensitivity="${sensitivity}", 
        resistivity="${resistivity}", intermediaryTo="${intermediaryTo}", analyzed_by="${userId}", 
        analyzed_at="${timeNow}"
        WHERE booking_no="${labno}" AND department="${department}" AND test="${test}" 
        AND facilityId="${facilityId}"`
    )
    .then(() => {
      // db.sequelize
      //   .query(`INSERT INTO sensitivity_results (antibiotic,isolates,labno,created_by)
      //     VALUES ${sensitivity.map((a) => "(?)").join(",")};`,
      //     { replacements: sensitivity })
      //   .then(() => {
      db.sequelize
        .query(
          "CALL new_comment(:facilityId,:labno,:userId,:comment,:labName,:type,:useTemplate)",
          {
            replacements: {
              labno,
              userId,
              comment,
              department,
              facilityId,
              labName: department,
              type: "doctors_comment",
              useTemplate: useTemplate ? useTemplate : "no",
            },
          }
        )
        .then((results) => res.json({ success: true, results }))
        .catch((err) => {
          res.status(500).json({ err });
          console.log(err);
        });
      // })
      // .catch((err) => {res.status(500).json({ err })
      //   console.log(err)
      // });
    })
    .catch((err) => {
      res.status(500).json({ err });
      console.log(err);
    });
};

exports.saveDoctorsComment = (req, res) => {
  const {
    labno,
    comment,
    facilityId,
    userId,
    userFullname,
    userTitle,
    department,
    tests,
    amount,
    useTemplate,
  } = req.body;
  console.log(req.body);

  const timeNow = moment().format("YYYY-MM-DD hh:mm:ss");

  db.sequelize
    .query(``)
    .then(() => {
      db.sequelize
        .query(
          "CALL new_comment(:facilityId,:labno,:userId,:comment,:labName,:type,:useTemplate)",
          {
            replacements: {
              labno,
              userId,
              comment,
              department,
              facilityId,
              labName: department,
              type: "doctors_comment",
              useTemplate: useTemplate ? useTemplate : "no",
            },
          }
        )
        .then(() => {
          // res.json({ success: true, results })
          db.sequelize
            .query(
              `INSERT INTO doctor_entries (doc_acct, dr, cr, reference_no, facilityId, createdAt) 
                VALUES ("${userId}", "${amount}", "0", "${labno}", "${facilityId}", "${timeNow}")`
            )
            .then((results) => res.json({ success: true, results }))
            .catch((err) => {
              console.log(err);
              res.status(500).json({ err });
            });
        })
        .catch((err) => {
          console.log(err);
          res.status(500).json({ err });
        });
    })
    .catch((err) => {
      console.log(err);
      res.status(500).json({ err });
    });
};

exports.savePatientHistory = (req, res) => {
  const { history, labno, facilityId } = req.body;
  db.sequelize
    .query(
      `UPDATE lab_numbers SET history="${history}" 
        WHERE lab_no="${labno}" AND facilityId="${facilityId}"`
    )
    .then((results) => res.json({ success: true, results }))
    .catch((err) => res.status(500).json({ err }));
};

exports.saveTestRemark = (req, res) => {
  const { comment, labno, facilityId, userId, labName, useTemplate } = req.body;
  console.log(req.body);
  db.sequelize
    .query(
      "CALL new_comment(:facilityId,:labno,:userId,:comment,:labName,:type,:useTemplate)",
      {
        replacements: {
          comment,
          labno,
          facilityId,
          userId,
          labName,
          type: "lab_scientiest_remark",
          useTemplate: useTemplate ? useTemplate : "no",
        },
      }
    )
    .then((results) => res.json({ success: true, results }))
    .catch((err) => {
      res.status(500).json({ err });
      console.log(err);
    });
};

exports.updateTestRemark = (req, res) => {
  const { comment, labno, facilityId, id } = req.body;
  // console.log(req.body);
  const timeNow = moment().format("YYYY-MM-DD hh:mm:ss");

  db.sequelize
    .query(
      `UPDATE comment SET comment="${comment}", updated_at="${timeNow}"
        WHERE facilityId="${facilityId}" AND booking_no="${labno}" AND id="${id}"`
    )
    .then((results) => res.json({ success: true, results }))
    .catch((err) => res.status(500).json({ err }));
};

exports.deleteTestRemark = (req, res) => {
  const { labno, facilityId, id } = req.body;

  db.sequelize
    .query(
      `DELETE FROM comment 
        WHERE facilityId="${facilityId}" AND id="${id}"`
    )
    .then((results) => res.json({ success: true, results }))
    .catch((err) => res.status(500).json({ err }));
};

exports.getLabComment = (req, res) => {
  const { facilityId, department, labno } = req.params;

  db.sequelize
    .query(
      `SELECT distinct a.comment, concat(b.firstname,' ', b.lastname) AS user, created_at, 
        username, a.id, a.booking_no as labno 
        FROM comment a JOIN users b ON a.user_id=b.username
        WHERE a.booking_no="${labno}" 
        AND a.comment !=''
        # AND a.lab_name="${department}" 
        AND a.facilityId="${facilityId}"`
    )
    .then((results) => {
      res.json({
        success: true,
        results: results[0],
      });
    })
    .catch((err) => res.status(500).json({ err }));
};

exports.createPatiencesReg = (req, res) => {
  const { patientInfo } = req.body;
  console.log(req.body);
  db.sequelize
    .query(
      `INSERT INTO customer_records(firstname,surname,age,gender,phoneNo,diagnosis ) 
        VALUES ("${req.body.first_name}","${req.body.name}","${req.body.age}","${req.body.gender}",
        "${req.body.phone}","${req.body.diagnosis}")`
    )
    .then((results) => {
      res.json({ results });
    })
    .catch((err) => res.json({ err }));
};

exports.getPendingMicrobiologyAnalysis = (req, res) => {
  const { facilityId } = req.params;

  db.sequelize
    .query(
      `SELECT DISTINCT a.booking_no as labno, concat(b.surname, ' ', b.firstname) as name, 
        COUNT(DISTINCT department) AS no_of_tests, a.patient_id
        FROM lab_requisition a JOIN patientrecords b ON a.patient_id=b.id 
        WHERE a.status = 'pending' AND a.facilityId="${facilityId}" AND b.facilityId="${facilityId}"
        AND department="microbiology"
        GROUP BY booking_no,name`
    )
    .then((results) => res.json({ success: true, results: results[0] }))
    .catch((err) => res.status(500).json({ err }));
};

exports.savePrintMode = (req, res) => {
  const { facilityId, labno, userId } = req.body;
  let dateNow = moment().format("YYYY-MM-DD hh:mm:ss");

  db.sequelize
    .query(
      `UPDATE lab_requisition set status='printed', printed_by="${userId}", printed_at="${dateNow}"
        WHERE booking_no="${labno}" AND facilityId="${facilityId}"`
    )
    .then((results) => res.json({ success: true, results }))
    .catch((err) => {
      console.log(err);
      res.status(500).json({ err });
    });
};

exports.getArchived = (req, res) => {
  const { facilityId } = req.params;

  db.sequelize
    .query(
      `SELECT a.booking_no, concat(b.firstname, ' ', b.surname) as name,a.patient_id,a.created_at,
        a.department,a.result_at,a.printed_at
        FROM lab_requisition a JOIN patientrecords b ON a.patient_id=b.id 
        WHERE a.status='printed' AND
        a.facilityId="${facilityId}" AND b.facilityId="${facilityId}" 
        GROUP BY booking_no,a.patient_id,a.created_at,a.department,name
        order by a.result_at DESC`
    )
    .then((results) => res.json({ success: true, results: results[0] }))
    .catch((err) => {
      res.status(500).json({ err });
      console.log(err);
    });
};

exports.getSpecimenList = (req, res) => {
  const { facilityId } = req.params;

  db.sequelize
    .query(
      `SELECT DISTINCT sample specimen FROM specimen 
        WHERE facilityId="${facilityId}"`
    )
    .then((results) => res.json({ success: true, results: results[0] }))
    .catch((err) => res.status(500).json({ err }));
};

exports.getNextLabSetupNo = (req, res) => {
  const { facilityId } = req.params;

  db.sequelize
    .query(``)
    .then((results) => res.json({ success: true, results: results[0] }))
    .catch((err) => res.status(500).json({ err }));
};

// exports.getNextAvailbleId = (req, res) => {
//   const { facilityId } = req.params;

//   db.sequelize.query(`SELECT max(id) `)
//     .then((results) => res.json({ success: true, results: results[0] }))
//     .catch((err) => res.status(500).json({ err }));
// }

exports.labSearch = (req, res) => {
  let lab = req.query.lab || "";
  const { facilityId } = req.params;

  db.sequelize
    .query(
      `SELECT head as subhead, subhead as title, description, price, specimen, noOfLabels FROM lab_setup
        WHERE facilityId="${facilityId}" AND description like '%${lab}%'`
    )
    .then((results) => {
      res.json({ success: true, labInfo: results[0] });
    })
    .catch((err) => {
      res.status(500).json({ success: false, err });
    });
};

exports.labUnitSearch = (req, res) => {
  let lab = req.query.lab || "";
  const { facilityId, unit } = req.params;
  // let _unit = unit.substr(0, 3);
  let _unit = unit[0];

  db.sequelize
    .query(
      `SELECT head as subhead, subhead as title, description, price, specimen, noOfLabels FROM lab_setup
        WHERE facilityId="${facilityId}" AND head like "${_unit}%" AND description like '%${lab}%'`
    )
    .then((results) => {
      res.json({ success: true, labInfo: results[0] });
    })
    .catch((err) => {
      res.status(500).json({ success: false, err });
    });
};

exports.getLabChildren = (req, res) => {
  const { head, facilityId } = req.params;

  db.sequelize
    .query(
      `SELECT head as subhead, subhead as title, description, price, specimen, noOfLabels FROM lab_setup
        WHERE facilityId="${facilityId}" AND head = '${head}'`
    )
    .then((results) => {
      res.json({ success: true, results: results[0] });
    })
    .catch((err) => {
      res.status(500).json({ success: false, err });
    });
};

exports.getDocComment = (req, res) => {
  const { labno, facilityId } = req.params;

  db.sequelize
    .query(
      `SELECT user_id, comment FROM comment 
        WHERE facilityId="${facilityId}" AND booking_no="${labno}" AND comment_type='doctors_comment'
      `
    )
    .then((results) => {
      res.json({ success: true, results: results[0] });
    })
    .catch((err) => {
      res.status(500).json({ success: false, err });
    });
};

exports.getPatientHistory = (req, res) => {
  const { labno, facilityId } = req.params;

  db.sequelize
    .query(
      `select history from lab_numbers WHERE facilityId="${facilityId}" AND lab_no="${labno}" `
    )
    .then((results) => {
      res.json({ success: true, results: results[0] });
    })
    .catch((err) => {
      res.status(500).json({ success: false, err });
    });
};

exports.doctorsCharges = (req, res) => {
  const { labno, facilityId } = req.params;

  db.sequelize
    .query(
      `CALL service_transaction(:description,:accNo,:amount,:receiptsn,:receiptno,:modeOfPayment,
        :accNo,:facilityId,:sourceAcct,:userId,:serviceHead,:transactionType,:in_date,
        :payables_head, :recievables_head,:bank,:txn_date,:discount,:discount_head,:quantity)`
      // `select history from lab_numbers WHERE facilityId="${facilityId}" AND lab_no="${labno}" `,
    )
    .then((results) => {
      res.json({ success: true, results: results[0] });
    })
    .catch((err) => {
      res.status(500).json({ success: false, err });
    });
};

exports.deleteTestTransaction = (req, res) => {
  const { transaction_id } = req.params;

  db.sequelize
    .query(
      `DELETE FROM transactions
        WHERE transaction_id="${transaction_id}"`
    )
    .then((results) => res.json({ success: true, results }))
    .catch((err) => {
      res.status(500).json({ err });
      console.log(err);
    });
};

exports.getLabReceipt = (req, res) => {
  const { receiptNo, facilityId } = req.params;

  db.sequelize
    .query(`Call getLabReceipt(:receiptDateSN, :facilityId)`, {
      replacements: {
        receiptDateSN: receiptNo,
        facilityId: facilityId,
      },
    })
    .then((results) => res.json({ success: true, results }))
    .catch((err) => {
      res.status(500).json({ err });
      console.log(err);
    });
};
