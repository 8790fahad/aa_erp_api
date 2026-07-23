const db = require("../models");
const moment = require('moment')

const _convertArrOfObjToArr = (arr) => {
  let result = [];
  for (let o of arr) {
    result.push(Object.values(o));
  }
  return result;
};

exports.getDailyPatientCount = (req, res) => {
  const { username, facilityId } = req.params;
  db.sequelize
    .query(
      `SELECT count(DISTINCT patient_id) AS count 
        FROM lab_requisition 
        WHERE created_by="${username}" AND facilityId="${facilityId}" AND date(created_at) = date(NOW())
    `
    )
    .then((results) => {
      res.json({ success: true, count: results[0][0].count });
    })
    .catch((err) => {
      console.log(err);
      res.status(500).json({ success: false, err });
    });
};

exports.getLabDetailsByLabNo = (req, res) => {
  const { labNo, facilityId } = req.params;
  db.sequelize
    .query(
      `SELECT a.booking_no, department, b.description, test_group, test, b.percentage, b.price, code 
        FROM lab_requisition a JOIN lab_setup b ON a.test = b.subhead 
        AND a.facilityId=b.facilityId AND a.facilityId="${facilityId}" AND a.booking_no="${labNo}"
    `
    )
    .then((results) => {
      res.json({ success: true, results: results[0] });
    })
    .catch((err) => {
      console.log(err);
      res.status(500).json({ success: false, err });
    });
};

exports.getLabDetailsByReceiptNo = (req, res) => {
  const { receiptNo, facilityId } = req.params;
  db.sequelize
    .query(
      `SELECT a.booking_no, department, b.description, test_group, test, b.percentage, b.price, code 
        FROM lab_requisition a JOIN lab_setup b ON a.test = b.subhead 
        AND a.facilityId=b.facilityId AND a.facilityId="${facilityId}" 
        WHERE a.receiptNo="${receiptNo}"
    `
    )
    .then((results) => {
      res.json({ success: true, results: results[0] });
    })
    .catch((err) => {
      console.log(err);
      res.status(500).json({ success: false, err });
    });
};
// exports.getSampleHistory = (req, res) => {
//   const { facilityId, labno, patientId } = req.params;

// }
exports.getSampleHistory = (req, res) => {
  const { labno, facilityId, patientId } = req.params;
  db.sequelize
    .query(
      `SELECT created_by, created_at, sample_collected_by, sample_collected_at, analyzed_by, 
        analyzed_at, result_by, result_at, reviewed_by, reviewed_at
        FROM sample_history
        WHERE facilityId="${facilityId}" AND booking_no="${labno}"
        LIMIT 1
    `
    )
    .then((results) => {
      res.json({ success: true, results: results[0] });
    })
    .catch((err) => {
      console.log(err);
      res.status(500).json({ success: false, err });
    });
};

exports.saveDoctorsCommission = (req, res) => {
  const { userId, facilityId, data } = req.body;

  db.sequelize
    .query(
      `INSERT INTO doctor_entries (doc_acct, dr, cr, reference_no, facilityId, createdAt) 
        VALUES ${data.map((a) => "(?)").join(",")};`,
      {
        replacements: data,
      }
    )
    .then((results) => {
      res.json({ success: true, results: results[0] });
    })
    .catch((err) => {
      console.log(err);
      res.status(500).json({ success: false, err });
    });
};

exports.getDoctorAccountBalance = (req, res) => {
  const { userId, facilityId } = req.params;

  db.sequelize
    .query(
      `SELECT SUM(dr) as amt_generated, SUM(cr) as collected, SUM(dr - cr) as balance 
        FROM doctor_entries 
        WHERE doc_acct="${userId}" AND facilityId="${facilityId}" 
        `
    )
    // #AND date(createdAt) BETWEEN date("${from}") AND date("${to}");
    .then((results) => {
      res.json({ success: true, results: results[0][0] });
    })
    .catch((err) => {
      console.log(err);
      res.status(500).json({ success: false, err });
    });
};

exports.getDoctorAccountSummary = (req, res) => {
  const { userId, facilityId, from, to } = req.params;

  db.sequelize
    .query(
      `SELECT sum(dr) generated, sum(cr) collected, sum(cr - dr) balance FROM doctor_entries as balance 
        FROM doctor_entries 
        WHERE doc_acct="${userId}" AND facilityId="${facilityId}" AND date(createdAt) 
        BETWEEN "${from}" AND "${to}";
      `
    )
    .then((results) => {
      res.json({ success: true, results: results[0] });
    })
    .catch((err) => {
      console.log(err);
      res.status(500).json({ success: false, err });
    });
};

exports.getLabSummary = (req, res) => {
  // console.log('here guys....')
  const query_type = req.query.type || "";
  const report_by = req.query.report_by
  const facilityId = req.query.facilityId || "";
  const from = req.query.from || "";
  const to = req.query.to || "";

  db.sequelize
    .query("CALL lab_summary(:query_type, :facilityId, :from, :to, :report_by)", {
      replacements: { query_type, facilityId, from, to, report_by },
    })
    .then((results) => {
      res.json({ success: true, results });
    })
    .catch((err) => {
      console.log(err);
      res.status(500).json({ success: false, err });
    });
};

exports.updateTestWithDicomSOP = (req, res) => {
  const { query_type = "" } = req.query;
  const {
    sopInstanceUid = "",
    labno = "",
    facilityId = "",
    userId = "",
  } = req.body;

  db.sequelize
    .query(
      "CALL update_dicom_test(:labno,:sopInstanceUid,:query_type,:userId,:facilityId)",
      {
        replacements: {
          query_type,
          sopInstanceUid,
          labno,
          facilityId,
          userId,
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

exports.getLabByStatus = (req, res) => {
const today = moment().format('YYYY-MM-DD')
  const { query_type = "", facilityId = "", status = "", from=today,to=today } = req.query;
  db.sequelize
    .query("CALL get_lab_by_status(:query_type,:status,:facilityId)", {
      replacements: {
        query_type,
        facilityId,
        status,
      },
    })
    .then((results) => {
      res.json({ success: true, results });
    })
    .catch((err) => {
      console.log(err);
      res.status(500).json({ success: false, err });
    });
};

exports.getPendingTest = (req, res) => {
  const today = moment().format('YYYY-MM-DD')
  const { query_type = "", facilityId = "", dept = "", from=today,to=today } = req.query;

  db.sequelize
    .query("CALL get_pending_lab(:query_type, :dept, :facilityId, :from, :to)", {
      replacements: {
        query_type,
        dept,
        facilityId,
        from,
        to
      },
    })
    .then((results) => {
      res.json({ success: true, results });
    })
    .catch((err) => {
      console.log(err);
      res.status(500).json({ success: false, err });
    });
};

exports.saveLabResult = (req, res) => {
  const { labs, facilityId = "", userId = "" } = req.body;

  const timeNow = moment().format("YYYY-MM-DD hh:mm:ss");

  labs.forEach((item) => {
    const {
      appearance = "",
      serology = "",
      culture_yielded = "",
      booking_no = "",
      comment = "",
      department = "",
      test = "",
      sensitiveTo = "",
      resistantTo = "",
      intermediaryTo = "",
      useTemplate = "",
      result = "",
      o_value="",
      h_value=""
    } = item;

    db.sequelize
      .query(
        `UPDATE lab_requisition SET appearance="${appearance}", serology="${serology}", 
        culture_yielded="${culture_yielded}", result="${result}", status="analyzed", sensitivity="${sensitiveTo}", 
        resistivity="${resistantTo}", intermediaryTo="${intermediaryTo}", analyzed_by="${userId}", 
        analyzed_at="${timeNow}", o_value="${o_value}", h_value="${h_value}"
        WHERE booking_no="${booking_no}" AND department="${department}" AND test="${test}" 
        AND facilityId="${facilityId}"`
      )
      .then(() => {
        console.log("success");
        // db.sequelize
        //   .query(
        //     "CALL new_comment(:facilityId,:labno,:userId,:comment,:labName,:type,:useTemplate)",
        //     {
        //       replacements: {
        //         labno,
        //         userId,
        //         comment,
        //         department,
        //         facilityId,
        //         labName: department,
        //         type: "doctors_comment",
        //         useTemplate: useTemplate ? useTemplate : "no",
        //       },
        //     }
        //   )
        // .then((results) => res.json({ success: true, results }))
        // .catch((err) => {
        //   res.status(500).json({ err });
        //   console.log(err);
        // });
      })
      .catch((err) => {
        res.status(500).json({ status: "success", err });
        console.log(err);
      });
  });

  res.json({
    status: "success",
    results: "Successfully submitted results",
  });
};


function saveBatchLabNo (list) {
  db.sequelize
    .query(
      `INSERT INTO lab_numbers (facilityId,patient_id,lab_no,patient_acc_no) 
        VALUES ${list.map((a) => "(?)").join(",")};`
        // ("${facilityId}","${id}","${labno}","${accountNo}"); 
    )
    .then((results) => {
      res.json({ success: true, results });
    })
    .catch((err) => {
      console.log(err);
      res.status(500).json({ success: false, err });
    });
}

async function generateBookingNo (facilityId) {
  try {
    const startOfMonth = moment().startOf("month").format("YYYY-MM-DD");
    const endOfMonth = moment().endOf("month").format("YYYY-MM-DD");
    const monthCode = moment().format("MM");
    const yearCode = moment().format("YY");

    let sn = await db.sequelize.query("CALL get_next_lab_id(:facId)", {
      replacements: {
        facId: facilityId,
      },
    })

    let monthsn = await db.sequelize.query(
      `SELECT IFNULL(max(id),0) + 1 AS labId from lab_requisition 
        WHERE facilityId="${facilityId}" and date(created_at) between date("${startOfMonth}") and date("${endOfMonth}")`
    )

    const booking_no = sn[0].labId +'-'+ monthCode+'-'+yearCode+'-'+monthsn[0][0].labId;

    return booking_no;
  } catch (err) {
    return err;
  }

}

async function saveBatchLabRequests (grouped, single, receiptno, facilityId) {
  try {
    // grouped.forEach(item => {
      // { test: '202010',
      //  patient_id: '1-7',
      //  facilityId: '1be0a9da-bff9-4ab6-a36c-edfd8ca88f1a',
      //  price: 650,
      //  percentage: 0,
      //  department: '2000',
      //  group: '2020',
      //  code: '210414101314',
      //  status: 'Sample Collected',
      //  userId: 'abdurrahman' }

      if(grouped.length) {
        
        let booking_no = await generateBookingNo(facilityId)
        
        let newArr = []
        grouped.forEach(item => newArr.push({ 
          test: item.test, patient_id: item.patient_id, facilityId: item.facilityId,
          price: item.price, percentage: item.percentage, department: item.department, group: item.group, code: item.code,
          status: item.status, userId: item.userId, receiptno, booking_no 
        }))

          const final_grouped = _convertArrOfObjToArr(newArr)

          // let newList = ''
          // grouped.forEach(item => {
            db.sequelize
            .query(
              `INSERT INTO lab_requisition(test,patient_id,facilityId,price,percentage,
                department,test_group,code,status,created_by,receiptNo,booking_no) 
                VALUES ${final_grouped.map((a) => "(?)").join(",")};`,
              { replacements: final_grouped }
            )
          // })
          
      }

      if(single.length) {
        single.forEach(async item => {
          let booking_no = await generateBookingNo(facilityId)

          db.sequelize.query( `INSERT INTO lab_requisition(test,patient_id,facilityId,price,percentage,
                department,test_group,code,status,created_by,receiptNo,booking_no) 
                VALUES ("${item.test}", "${item.patient_id}", "${item.facilityId}","${item.price}", "${item.percentage}", 
                "${item.department}", "${item.group}", "${item.code}","${item.status}", "${item.userId}", "${receiptno}", 
                "${booking_no}" )`)
        })
      }

    return {
      success: true
    }
    // })
  } catch(err) {
    return err
  }
  
  // .then((results) => res.json({ results }))
  // .catch((err) => {
  //   console.log(err);
  //   res.status(500).json({ err });
  // });
}

async function getReceiptNo (facId) {
  try {
    let resp = await db.sequelize.query("call get_avail_receipt_no(:facId)", {replacements: { facId }})
    return resp[0]["max(receiptNo) + 1"]
  } catch (err) {
    return err
  }
}

const getInstantAccount = async () => {
  try {
    const resp = await db.sequelize
    .query(
      `SELECT accountNo FROM patientfileno where accName="Instant Payment" AND facilityId="${facilityId}"`
    )

    return await (resp[0] &&
              resp[0][0] &&
              resp[0][0].accountNo) ||
        "";

  } catch (err) {
    return err
  }
}

const newBatchServiceInstantPayment = async (data, userId, facilityId) => {
  try {
  let instantAcc = await getInstantAccount()
  
  data.forEach(item => {
    let {
      facilityId,
      amount,
      modeOfPayment,
      source,
      destination,
      description,
      userId,
      receiptsn,
      receiptno,
      patientId,
      credit,
      debit,
      serviceHead,
      transactionType,
      bank,
      transaction_source,
      transaction_date,
      discount,
      clientAccount
    } = item;

    db.sequelize.query(
        `CALL service_transaction(:description,:accNo,:amount,:receiptsn,:receiptno,:payment_mode,
        :patientId,:facId,:sourceAcct,:userId,:serviceHead,:transactionType,:in_date,
        :payables_head,:recievables_head,:bank,:in_txn_date,:discount,:discount_head)`,
          // 'CALL new_service_instant_payment(:facId,:patientId,:description,:source,:destination,
          // :receiptsn,:receiptno,:payment_mode,:userId,:amount,:client_acct)',
          // :source,:destination,:client_acct
          {
            replacements: {
              amount,
              accNo:
                transactionType === "insta" ? instantAcc :  clientAccount,
              description,
              source: credit,
              userId,
              receiptsn,
              receiptno,
              payment_mode: modeOfPayment,
              // clientAccount,
              destination,
              facId: facilityId,
              client_acct: debit,
              patientId,
              sourceAcct:
                modeOfPayment.toLowerCase() === "cash" ? "400021" : "400022",
              serviceHead: serviceHead ? serviceHead : credit,
              transactionType,
              in_date: moment().format("YYYY-MM-DD hh:mm:ss"),
              in_txn_date: transaction_date
                ? transaction_date
                : moment().format("YYYY-MM-DD"),
              payables_head: "500021",
              recievables_head: "400023",
              bank: bank ? bank : "",
              discount: discount ? discount : 0,
              discount_head: "30030",
              phone,
              customer_bank,
              customer_acc_no,
              transaction_amount,
              business_bank,
              business_bank_acc_no
            },
          }
        )
    })

  return {
    success: true
  }
} catch (err) {
  return err
  
    // .then((resp) => {
    //   let instaAccNo =
    //     (resp &&
    //       resp.length &&
    //       resp[0] &&
    //       resp[0][0] &&
    //       resp[0][0].accountNo) ||
    //     "";

      // console.log(req.body);
      
        // .then((results) => {
        //   res.json({ success: true, results });
        // })
        // .catch((err) => {
        //   console.log(err);
        //   res.status(500).json({ err });
        // });
    // });
}
};

// async function saveBatchTransactions(facId, data, type) {
//   try {

//     // if(transactionType === "insta") {
//     //   let receiptno = await getReceiptNo(facId)
//     //   // if(receiptno) {

//     //   // }
//     //   // console.log(receiptno)


//     // }
//   } catch (err) {
//     return err;
//   }
// }


/** 
Save new lab request
- Save each request accordingly
- Save transaction attached to each request
- Return with list of barcodes

  *Insert to lab requisition
  - grouped test
  - single test

  - save lab history
  - save lab-number

*/
exports.newLabRequest2 = (req, res) => {
  const { grouped,
        singular,
        transactionsList,
        patient, userId, facilityId } = req.body;

        let receiptno = transactionsList[0].receiptsn;

        saveBatchLabRequests(grouped, singular, receiptno, facilityId)
        .then(results => {
          console.log(results)
        }).catch(err => {
          console.log(err)
        })

        // console.log(req.body)



  // newBatchServiceInstantPayment(transactionsList, userId, facilityId)
  // .then(results => {
  //   console.log(results)
  // })
  // .catch(err => {
  //   console.log('Error', err)
  // })

  // db.sequelize
  //   .query(
  //     `INSERT INTO lab_requisition(test,patient_id,facilityId,booking_no,price,percentage,department,test_group,code,status,created_by,receiptNo) 
  //       VALUES ${data.map((a) => "(?)").join(",")};`,
  //     { replacements: data }
  //   )
  //   .then((results) => res.json({ results }))
  //   .catch((err) => {
  //     console.log(err);
  //     res.status(500).json({ err });
  //   });
};

exports.updateLabStatus = (req, res) => {
  const { query_type='', userId='', facilityId='', status='', newStatus='', labno='' } = req.body

  // db.sequelize.query('CALL update_lab(:query_type, :userId, :facilityId)', {
  db.sequelize.query(`UPDATE lab_requisition SET status="${newStatus}" WHERE 
    booking_no="${labno}" AND facilityId="${facilityId}"`
    // , {
    // replacements: {
    //   query_type, userId, facilityId
    // }
  // }
  )
  .then((results) => res.json({ results }))
    .catch((err) => {
      console.log(err);
      res.status(500).json({ err });
    });
}

exports.refundRequest = (req,res) => {
  const { query_type='',
    patient_id='',
    user='',
    labno='',
    amount_paid='',
    refund_amount='',
    reasons='',
    approved_by='',
    approved_at='',
    time='',
    selectedTests=[],
    facilityId } = req.body

    selectedTests.forEach(item => {
      db.sequelize.query('CALL refund_requests(:query_type, :patient_id,:user,:labno,:amount_paid,:refund_amount,:reasons,:approved_by,:approved_at,:time,:facilityId)', {
        replacements: {
          query_type,
          patient_id,
          user,
          labno,
          amount_paid,
          refund_amount,
          reasons,
          approved_by,
          approved_at,
          time,
          facilityId
        }
      })
    })

  // .then(resp => {
  //   res.json({ success: true, results: resp })
  // }) .catch((err) => {
  //     console.log(err);
  //     res.status(500).json({ err });
  //   });
}

exports.getPatientTests = (req,res) => {
  const { query_type='', patientId='', facilityId='' } = req.query;
  db.sequelize.query('CALL get_patient_txn(:query_type,:patientId, :facilityId)', {
    replacements: {
      query_type, patientId, facilityId
    }
  })
  .then(resp => {
    res.json({ success: true, results: resp })
  }) .catch((err) => {
      console.log(err);
      res.status(500).json({ err });
    });
}
