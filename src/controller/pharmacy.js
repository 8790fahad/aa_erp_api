const moment = require("moment");
const db = require("../models");

exports.createClientAccount = (req, res) => {
  const {
    accountType = "",
    firstname = "",
    surname = "",
    gender = "",
    dob = "",
    maritalStatus = "",
    occupation = "",
    clientAccount = "",
    clientBeneficiaryAcc = "",
    email = "",
    id = "",
    facilityId = "",
    depositAmount = 0,
    modeOfPayment = "",
    source = "",
    destination = "",
    userId = "",
    receiptsn = "",
    receiptno = "",
    description = "",
    status = "",
    name = "",
    contact = "",
    address = "",
    contactAddress = "",
    contactEmail = "",
    website = "",
    phone = "",
    contactPhone = "",
    bankName = "",
    guarantor_name = "",
    guarantor_address = "",
    guarantor_phoneNo = "",
    branch_name = "",
    credit_limit = 0,
    version_id,
    crm = "",
    business_name = "",
    store_name,
  } = req.body;
  console.log(req.body);

  db.sequelize
    .query("SELECT count(*) + 1 as version_id from customer_entries ")
    .then((val) => {
      let _version_id = val[0][0].version_id;
      db.sequelize
        .query(
          `CALL customer_deposit(:patientAcc,:amount,:userId,:receiptsn,:receiptno,:description,:payment_mode,
            :facilityId,:destination,:acc_name,:type,:in_date,:address,:phone,:email,:web,:paybles_head,:recievables_head,
            :guarantor_name,:guarantor_address,:guarantor_phoneNo,:bankName,:branch_name,:credit_limit,:version_id,:crm,:business_name)`,
          {
            replacements: {
              amount: depositAmount ? depositAmount : "0",
              patientAcc: clientAccount,
              description,
              source,
              userId,
              receiptsn,
              receiptno,
              payment_mode: modeOfPayment ? modeOfPayment : "cash",
              destination: modeOfPayment === "cash" ? "400021" : "400022",
              facilityId,
              acc_name: name,
              type: accountType,
              in_date: moment().format("YYYY-MM-DD hh:mm:ss"),
              address: address,
              phone: phone,
              email: email,
              web: website,
              paybles_head: "500021",
              recievables_head: "400023",
              guarantor_name: guarantor_name,
              guarantor_address: guarantor_address,
              guarantor_phoneNo: guarantor_phoneNo,
              bankName: bankName,
              branch_name: store_name ? store_name : branch_name,
              credit_limit: credit_limit ? credit_limit : 0,
              version_id: version_id ? version_id : _version_id,
              crm: crm,
              business_name: name,
            },
          }
        )
        .then(() => {
          db.sequelize.query(
            `SELECT ifnull(max(accountNo), 0) + 1 as id FROM customers WHERE facilityId="${facilityId}"`
          );
          // .then((resp) => {
          //   let _id = resp[0][0].id;
          //   if (_id) {
          //     db.sequelize
          //       .query(
          //         `CALL create_customer(:accountNo,:beneficiaryNo,:version_id,:fullname,:phoneNo,:email,:facilityId)`,
          //         {
          //           replacements: {
          //             accountNo: clientAccount,
          //             beneficiaryNo: clientBeneficiaryAcc,
          //             version_id: version_id ? version_id : _version_id,
          //             fullname: name,
          //             phoneNo: phone,
          //             email: contactEmail,
          //             facilityId: facilityId,
          //           },
          //         }
          //       )

          //       .then((results) => {
          //         res.json({ success: true, results });
          //       })
          //       .catch((err) => {
          //         console.log(err);
          //         res.status(500).json({ success: false, err });
          //       });
          //   }
          // });
        })
        .then((results) => {
          res.json({ success: true, results });
        })
        .catch((err) => {
          res.status(500).json({ success: false, err });
          console.log(err);
        });
    })
    .catch((err) => {
      console.log(err);
      res.status(500).json({ success: false, err });
      console.log(err);
    });
};

exports.addClientBeneficiary = (req, res) => {
  const {
    firstname,
    surname,
    gender,
    dob,
    maritalStatus,
    occupation,
    clientAccount,
    clientBeneficiaryAcc,
    email,
    id,
    facilityId,
    relation_with_app,
    year_relationship_with_app,
  } = req.body;

  db.sequelize
    .query(
      `INSERT INTO customer_records(id,accountNo,beneficiaryNo,firstname,surname,Gender,maritalstatus,DOB,email,occupation,facilityId,relation_with_app,year_relationship_with_app)
      VALUES("${id}","${clientAccount}","${clientBeneficiaryAcc}","${firstname}","${surname}","${gender}","${maritalStatus}","${dob}","${email}","${occupation}","${facilityId}", "${relation_with_app}","${year_relationship_with_app}")`
    )
    .then((results) => {
      res.json({ success: true, results });
    })
    .catch((err) => {
      res.json({ success: false, err });
      console.log(err);
    });
};
exports.internalTransfer = (req, res) => {
  const {
    item_name,
    cost,
    expiring_date,
    grm_no,
    from,
    to,
    quantity,
    n_price,
  } = req.body;
  console.log(req.body);
  db.sequelize
    .query(
      "call internal_transfer(:trn_number,:item_name,:qty_in,:n_price,:expiring_date,:selling_price,:location_to,:transaction_date,:branch,:location)",
      {
        replacements: {
          trn_number: grm_no,
          item_name: item_name,
          qty_in: quantity,
          n_price: n_price,
          expiring_date,
          selling_price: cost,
          location_to: from,
          transaction_date: moment().format("YYYY-MM-DD"),
          branch: from,
          location: to,
        },
      }
    )
    .then((results) => {
      res.json({ success: true, results: results });
    })
    .catch((err) => {
      console.log(err);
      res.status(500).json({ success: false, err });
    });
};

exports.getNextClientAccountNo = (req, res) => {
  const { facilityId } = req.params;
  db.sequelize
    .query(
      `select ifnull(max(accountNo), 0) + 1 AS accountNo from customers WHERE facilityId="${facilityId}"`
    )
    .then((results) => {
      res.json({ success: true, results: results[0][0] });
    })
    .catch((err) => {
      res.json({ success: false, err });
    });
};

// function saveFileNo(){
//   db.sequelize
// }

exports.getNextClientBeneficiaryNo = (req, res) => {
  const { facilityId, accountNo } = req.params;
  db.sequelize
    .query(
      `select ifnull(max(beneficiaryNo), 0) + 1 AS beneficiaryNo from patientrecords WHERE accountNo=${accountNo} AND facilityId="${facilityId}"`
    )
    .then((results) => {
      res.json({ success: true, results: results[0][0] });
    })
    .catch((err) => {
      res.json({ success: false, err });
    });
};

exports.getNextPatientNo = (req, res) => {
  const { facilityId } = req.params;
  db.sequelize
    .query(
      `select ifnull(max(patient_id), 0) + 1 AS id from patientrecords WHERE facilityId="${facilityId}"`
    )
    .then((results) => {
      res.json({ success: true, results: results[0][0] });
    })
    .catch((err) => {
      res.json({ success: false, err });
    });
};

exports.getDrugListByBatch = (req, res) => {
  const { facilityId } = req.params;
  db.sequelize
    .query(`SELECT * FROM drugpurchaserecords WHERE facilityId="${facilityId}"`)
    .then((results) => {
      res.json({ success: true, results: results[0] });
    })
    .catch((err) => {
      res.json({ success: false, err });
    });
};

exports.getReturnDrugs = (req, res) => {
  const { receipt, facilityId } = req.params;
  db.sequelize
    .query(
      `SELECT drug_code,drug,expiry_date,price,unit_of_issue, SUM(qty_in - qty_out) AS qty_in, 
        source,created_at,supplier, client_acct,
        receipt_no,created_by,genericName,trn_number,branch_name FROM drugs WHERE receipt_no='${receipt}' AND facilityId='${facilityId}' 
        AND source='sold_items' GROUP BY drug`
    )
    .then((results) => res.json({ results: results[0] }))
    .catch((err) => res.status(500).json({ err }));
};

const date = moment().format("YYYY-MM-DD");
exports.getSupplierId = (req, res) => {
  const { facilityId } = req.params;
  db.sequelize
    .query(`SELECT ifnull(max(id), 0) + 1 as id FROM suppliersinfo`)
    .then((results) => res.json({ success: true, results: results[0] }))
    .catch((err) => res.json({ success: false, err }));
};

exports.getPurchaseOrderList = (req, res) => {
  const { facilityId, id } = req.params;

  db.sequelize
    .query(`SELECT * FROM purchase_order_list where po_id IN (${id})`)
    .then((results) => res.json({ success: true, results: results[0] }))
    .catch((err) => {
      console.log(err);
      res.json({ success: false, err });
    });
};

exports.getApprovedAccount = (req, res) => {
  // const { facilityId,id } = req.params;
  db.sequelize
    .query(`call get_approved_account()`)
    .then((results) => res.json({ success: true, results: results }))
    .catch((err) => {
      console.log(err);
      res.json({ success: false, err });
    });
};

exports.RejectAuditor = (req, res) => {
  console.log(req.body);
  db.sequelize
    .query(`call purchase_status_update(:status,:po_id,:processed_by,:sup)`, {
      replacements: {
        status: "Rejected",
        po_id: req.body.data,
        processed_by: req.body.userId,
        sup: null,
      },
    })
    .then((results) => {
      res.json({
        success: true,
        results: results,
      });
    })
    .catch((err) => {
      console.log(err);
      res.status(500).json({ success: false, err });
    });
};

exports.UpdateAuditor = (req, res) => {
  console.log(req.body);
  db.sequelize
    .query(`call purchase_status_update(:status,:po_id,:processed_by,:sup)`, {
      replacements: {
        status: "Disburse",
        po_id: req.body.data,
        processed_by: req.userId,
        sup: null,
      },
    })
    .then((results) => {
      res.json({
        success: true,
        results: results,
      });
    })
    .catch((err) => {
      console.log(err);
      res.status(500).json({ success: false, err });
    });
};

exports.managerApproved = (req, res) => {
  console.log(req.body);
  db.sequelize
    .query(`call purchase_status_update(:status,:po_id,:processed_by,:sup)`, {
      replacements: {
        status: "Reviewer",
        po_id: req.body.data,
        processed_by: req.body.processed_by,
        sup: null,
      },
    })
    .then((results) => {
      res.json({
        success: true,
        results: results,
      });
    })
    .catch((err) => {
      console.log(err);
      res.status(500).json({ success: false, err });
    });
};

exports.managementReject = (req, res) => {
  console.log(req.body.processed_by);
  console.log("Here bhjdjfhdshfhsd");
  db.sequelize
    .query(`call purchase_status_update(:status,:po_id,:processed_by,:sup)`, {
      replacements: {
        status: "ManagementReject",
        po_id: req.body.data,
        processed_by: req.body.processed_by,
        sup: null,
      },
    })
    .then((results) => {
      res.json({
        success: true,
        results: results,
      });
    })
    .catch((err) => {
      console.log(err);
      res.status(500).json({ success: false, err });
    });
};

exports.approvedManagement = (req, res) => {
  console.log(req.body);
  db.sequelize
    .query(`call purchase_status_update(:status,:po_id,:processed_by,:sup)`, {
      replacements: {
        status: "ManagementApproved",
        po_id: req.body.data,
        processed_by: req.body.processed_by,
        sup: null,
      },
    })
    .then((results) => {
      res.json({
        success: true,
        results: results,
      });
    })
    .catch((err) => {
      console.log(err);
      res.status(500).json({ success: false, err });
    });
};

exports.UpdateAuditor = (req, res) => {
  console.log(req.body);
  db.sequelize
    .query(`call purchase_status_update(:status,:po_id,:processed_by,:sup)`, {
      replacements: {
        status: "Disburse",
        po_id: req.body.data,
        processed_by: req.body.processed_by,
        sup: null,
      },
    })
    .then((results) => {
      res.json({
        success: true,
        results: results,
      });
    })
    .catch((err) => {
      console.log(err);
      res.status(500).json({ success: false, err });
    });
};

exports.UpdateReviewer = (req, res) => {
  console.log(req.body);
  db.sequelize
    .query(`call purchase_status_update(:status,:po_id,:processed_by,:sup)`, {
      replacements: {
        status: req.body.status,
        po_id: req.body.po_id,
        processed_by: req.body.processed_by,
        sup: null,
      },
    })
    .then((results) => {
      res.json({
        success: true,
        results: results,
      });
    })
    .catch((err) => {
      console.log(err);
      res.status(500).json({ success: false, err });
    });
};

exports.getAccSupplierInfo = (req, res) => {
  const { supplier_code } = req.params;
  console.log(req.params, "wergfhjk");
  db.sequelize
    .query(`call get_supplier_acount(:supplier_code)`, {
      replacements: {
        supplier_code: supplier_code,
      },
    })
    .then((results) => res.json({ success: true, results }))
    .catch((err) => res.status(500).json({ err }));
};

exports.select_purchase_order_list = (req, res) => {
  const { facilityId } = req.params;
  db.sequelize
    .query(`call select_purchase_order_list(:facilityId)`, {
      replacements: {
        facilityId: facilityId,
      },
    })
    .then((results) => res.json({ success: true, results }))
    .catch((err) => res.status(500).json({ err }));
};

exports.getCustomerStockBalanceHistory = (req, res) => {
  const {
    item = "",
    trn = "",
    branch = "",
    facilityId = "",
    query_type = "",
  } = req.query;

  db.sequelize
    .query(
      `call get_stock_history(:branch,:item,:facilityId,:query_type,:trn)`,
      {
        replacements: {
          item,
          trn,
          branch,
          facilityId: facilityId,
          query_type,
        },
      }
    )
    .then((results) => res.json({ success: true, results }))
    .catch((err) => {
      console.log(err);
      res.status(500).json({ err });
    });
};

exports.newMarkup = (req, res) => {};

exports.newItemCategory = (req, res) => {
  const { cat_name = "", cat_description = "" } = req.body;
  const { facilityId = "", query_type = "" } = req.query;
  db.sequelize
    .query(
      "CALL new_item_category(:cat_name,:cat_description,:facilityId,:query_type)",
      {
        replacements: {
          cat_name,
          cat_description,
          facilityId,
          query_type,
        },
      }
    )
    .then((results) => res.json({ success: true, results }))
    .catch((err) => {
      console.log(err);
      res.status(500).json({ err });
    });
};
