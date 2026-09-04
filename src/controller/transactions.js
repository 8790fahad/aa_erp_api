import {
  getCurrentUnitCost,
  getCurrentUnitCostWithMultiplier,
} from "./inventory";

const db = require("../models");
const moment = require("moment");
const UUIDV4 = require("uuid").v4;
const { Op } = require("sequelize");
const { sellingApi } = require("./api/transactionsApi");
const { getAndUpdateNumber } = require("../services/numberGen");
const { getSellableQtyAtBranch, listSellableBranchesForSku } = require("../services/sellableStock");
const { assertProductSalesLimits } = require("../services/salesLimits");
const { STORE_ENTRY_TYPE, saleStoreEntryType, salesTypesSqlList } = require("../constants/storeEntryTypes");
const { isProductTaxable } = require("../constants/taxableStatus");
const { getCustomerLedgerBalances } = require("../utils/customerLedgerBalances");
const { isWalkInCustomer } = require("../utils/customerKind");
const getBalance = async (customerNo, facilityId) => {
  const { deposit } = await getCustomerLedgerBalances(facilityId, customerNo);
  return deposit;
};
const { CustomerEntry, Discount, Tax, Customer, CustomerCopy } = db;
// const getTxnVersionId = require('./helpers').getTxnVersionId

//INSERT into transactions (transaction_source,destination,debited,credited,enteredBy,receiptDateSN,receiptNo) VALUES ('2200-1','PSCPRIME',0,50000,'Mustapha','0910190001','0000001')
// UPDATE customers set balance = 20000 + 50000 WHERE accountNo = '1';
// INSERT into transactions (transaction_source,destination,debited,credited,enteredBy,receiptDateSN,receiptNo,description,modeOfPayment) VALUES ('1','deposit',0,50000,'Mustapha','11091978','7','Account deposit','cash')

exports.getDailySalesReport = (req, res) => {
  const {
    facilityId = "",
    from = "",
    to = "",
    query_type = "",
    businessType = "",
  } = req.query;

  db.sequelize
    .query(
      "CALL get_daily_sales(:query_type,:from,:to,:facilityId,:businessType)",
      {
        replacements: {
          query_type,
          from,
          to,
          facilityId,
          businessType,
        },
      }
    )
    .then((results) => {
      res.json({ success: true, results });
    })
    .catch((err) => {
      res.json({ success: false, err });
    });
};

exports.getApprovedAccounts = (req, res) => {
  const { facilityId } = req.params;

  db.sequelize
    .query(
      `SELECT accountNo as account_no, accName as account_name, contactPhone, contactAddress,
        guarantor_name,guarantor_phone,guarantor_address
        FROM customers WHERE facilityId="${facilityId}"`
    )
    .then((results) => {
      res.json({ success: true, results: results[0] });
    })
    .catch((err) => {
      res.json({ success: false, err });
    });
};

exports.supplierPayment = async (req, res) => {
  const {
    facilityID,
    userId = "",
    supplierId,
    amount,
    supplier_code,
    receiptsn = "",
    receiptno = "",
    receiptNo = "",
    modeOfPayment,
    createdAt,
    account = {},
    accountHead,
    bankAccount,
    narration,
    _rev,
  } = req.body;
  console.log(req.body);

  const modeLower = String(modeOfPayment || "").toLowerCase();
  const isCash = modeLower === "cash";
  let sourceAcct = account && account.acctNo ? account.acctNo : "";
  const hasNewPaymentSource =
    (accountHead && accountHead.head) || (bankAccount && bankAccount.id);

  try {
    if (hasNewPaymentSource) {
      if (isCash) {
        const h = accountHead?.head?.trim();
        if (!h) {
          return res.status(400).json({
            success: false,
            message: "Account Head is required for cash payments",
          });
        }
        sourceAcct = h;
      } else if (facilityID && bankAccount?.id) {
        const bankAcc = await db.bank_account.findOne({
          where: { id: bankAccount.id, facilityId: facilityID, status: "active" },
        });
        if (!bankAcc?.head) {
          return res.status(400).json({
            success: false,
            message: "Bank account invalid or missing GL head",
          });
        }
        sourceAcct = bankAcc.head;
      } else {
        return res.status(400).json({
          success: false,
          message: "Bank account is required for this payment mode",
        });
      }
    }
  } catch (e) {
    console.log(e);
    return res.status(500).json({ success: false, err: e.message });
  }

  db.sequelize
    .query(
      `CALL supplier_payment(:facilityId,:userId,:supplierId,:amount,:receiptsn,:receiptno,
        :modeOfPayment,:sourceAcct,:description,:in_date,:in_payables,:version_id)`,
      {
        replacements: {
          facilityId: facilityID,
          userId,
          supplierId,
          amount,
          receiptsn: receiptNo,
          receiptno,
          modeOfPayment,
          sourceAcct,
          description: narration,
          in_date: moment.utc(createdAt).format("YYYY-MM-DD hh:mm:ss"),
          in_payables: "500021",
          version_id: _rev || `1-${UUIDV4()}`,
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

exports.deposit = async (req, res) => {
  const {
    clientAccount,
    facilityId,
    depositAmount = 0,
    modeOfPayment,
    source,
    destination: destinationBody,
    userId,
    receiptsn = "",
    receiptno = "",
    description,
    name,
    accountType,
    guarantor_name,
    guarantor_address,
    guarantor_phoneNo,
    bankName,
    branch_name,
    version_id,
    credit_limit,
    address,
    phone,
    email,
    web,
    crm = "",
    business_name = "",
    store_name,
    accountHead,
    bankAccount,
  } = req.body;
  console.log(req.body);
  let temp_version_id = UUIDV4();

  const modeLower = String(modeOfPayment || "cash").toLowerCase();
  const isCash = modeLower === "cash";
  let destinationValue = isCash ? "400021" : "400022";
  const hasNewPaymentSource =
    (accountHead && accountHead.head) || (bankAccount && bankAccount.id);

  if (destinationBody !== undefined && destinationBody !== null && destinationBody !== "") {
    destinationValue = String(destinationBody);
  } else if (hasNewPaymentSource) {
    try {
      if (isCash) {
        const h = accountHead?.head?.trim();
        if (!h) {
          return res.status(400).json({
            success: false,
            message: "Account Head is required for cash payments",
          });
        }
        destinationValue = h;
      } else if (facilityId && bankAccount?.id) {
        const bankAcc = await db.bank_account.findOne({
          where: { id: bankAccount.id, facilityId, status: "active" },
        });
        if (!bankAcc?.head) {
          return res.status(400).json({
            success: false,
            message: "Bank account invalid or missing GL head",
          });
        }
        destinationValue = bankAcc.head;
      } else {
        return res.status(400).json({
          success: false,
          message: "Bank account is required for this payment mode",
        });
      }
    } catch (e) {
      console.log(e);
      return res.status(500).json({ success: false, err: e.message });
    }
  }

  db.sequelize
    .query(
      `CALL customer_deposit(:patientId,:amount,:userId,:receiptsn,:receiptno,:description,:payment_mode,
        :facId,:destination,:name,:type,:in_date,:address,:phone,:email,:web,:paybles_head,:recievables_head,
        :guarantor_name,:guarantor_address,:guarantor_phoneNo,:bankName,:branch_name,:credit_limit,
        :version_id,:crm,:business_name)`,
      {
        replacements: {
          amount: depositAmount ? depositAmount : "0",
          patientId: clientAccount ? clientAccount : "",
          description: description ? description : "",
          source,
          userId: userId ? userId : "",
          receiptsn: receiptsn ? receiptsn : "",
          receiptno: receiptno ? receiptno : "",
          payment_mode: modeOfPayment ? modeOfPayment : "cash",
          destination: destinationValue,
          facId: facilityId ? facilityId : "",
          name: name ? name : "",
          type: accountType ? accountType : "",
          in_date: moment().format("YYYY-MM-DD hh:mm:ss"),
          address: address ? address : "",
          phone: phone ? phone : "",
          email: email ? email : "",
          web: web ? web : "",
          paybles_head: "500021",
          recievables_head: "400023",
          guarantor_name: guarantor_name ? guarantor_name : "",
          guarantor_address: guarantor_address ? guarantor_address : "",
          guarantor_phoneNo: guarantor_phoneNo ? guarantor_phoneNo : "",
          bankName: bankName ? bankName : "",
          branch_name: store_name
            ? store_name
            : branch_name
            ? branch_name
            : business_name,
          credit_limit: credit_limit ? credit_limit : 0,
          version_id: version_id ? version_id : temp_version_id,
          crm: crm ? crm : "",
          business_name: business_name ? business_name : "",
        },
      }
    )
    .then((results) => {
      res.json({ success: true, results });
    })
    .catch((err) => {
      res.status(500).json({ success: false, err });
      console.log(err);
    });
};

// OLD DEPOSIT CODE
// exports.deposit = (req, res) => {
//   const {
//     accountNo,
//     amount,
//     description,
//     receiptNo,
//     user,
//     receiptId,
//     mode,
//     facilityId,
//   } = req.body;
//   // let sqlstmt1 = `UPDATE customers set balance = customers.balance + ${amount} WHERE customers.accountNo = '${accountNo}';`;
//   // let sqlstmt2 = `INSERT into transactions (transaction_source,destination,debited,credited,enteredBy,receiptDateSN,receiptNo,description,modeOfPayment) VALUES ("${accountNo}","Deposit",0,"${amount}","${user}", "${receiptNo}", "${receiptId}", "${description}", "${mode}");`;
//   // let sqlstmt3 = `UPDATE chartofaccount set balance = chartofaccount.balance + ${amount} WHERE chartofaccount.code = 'clinic';`;
//   // const sql = sqlstmt1 + sqlstmt2 + sqlstmt3;

//   // const chain = new db.Sequelize.Utils.QueryChainer();

//   // db.sequelize
//   //   .query(sqlstmt1, {
//   //     type: db.sequelize.QueryTypes.UPDATE,
//   //   })
//   //   .then(results1 => {
//   //     // res.json({ results });
//   //     db.sequelize
//   //       .query(sqlstmt2, { type: db.sequelize.QueryTypes.INSERT })
//   //       .then(results2 => {
//   //           res.json({ results: results2 });
//   //       })
//   //       .catch(err2 => res.status(500).json({ err2 }));
//   //   })
//   //   .catch(err => res.status(500).json({ err }));

//   let callStmt =
//     'call patient_deposit(:accountNo,:amount,:user,:receiptNo,:receiptId,:description,:mode,:facilityId)';
//   db.sequelize
//     .query(callStmt, {
//       replacements: {
//         accountNo,
//         amount,
//         user,
//         receiptNo,
//         receiptId,
//         description,
//         mode,
//         facilityId,
//       },
//     })
//     .then((results) => res.json({ results }))
//     .then((err) => res.status(500).json({ err }));
// };

exports.getReceiptDateSN = (req, res) => {
  let dateAppend = moment().format("DDMMYY");
  db.sequelize
    .query("call get_receipt_date_sn(:dateAppend,:facilityId)", {
      replacements: { dateAppend },
    })
    .then((results) => res.json({ results }))
    .catch((err) => res.status(500).json({ err }));
};

exports.getAvailReceiptNo = (req, res) => {
  const { facilityId } = req.params;
  db.sequelize
    .query("call get_avail_receipt_no(:facilityId)", {
      replacements: { facilityId },
    })
    .then((results) =>
      res.json({ receiptNo: results[0]["max(receiptNo) + 1"] })
    )
    .catch((err) => res.status(500).json({ err }));
};

exports.getNextTransactionID = (req, res) => {
  const { facilityId } = req.params;
  db.sequelize
    .query("call get_next_transaction_id(:facilityId)", {
      replacements: { facilityId },
    })
    .then((results) =>
      res.json({ transactionId: results[0]["max(transaction_id) + 1"] })
    )
    .catch((err) => res.status(500).json({ err }));
};

exports.getBalance = (req, res) => {
  const { accountNo, facilityId } = req.params;
  db.sequelize
    .query("call get_balance(:accountNo, :facilityId)", {
      replacements: { accountNo, facilityId },
    })
    .then((results) => res.json({ results }))
    .catch((err) => {
      res.status(500).json({ err });
      console.log(err);
    });
};

exports.getAllTransactions = (req, res) => {
  // const {} = req.body;
  const { facilityId } = req.params;
  db.sequelize
    .query("call get_all_transactions(:facilityId)", {
      replacements: { facilityId },
    })
    .then((results) => res.json({ results }))
    .catch((err) => res.status(500).json({ err }));
};

exports.getReports = (req, res) => {
  const { from, to, facilityId } = req.params;
  let toDate = moment(to).add(1, "days").format("YYYY-MM-DD");
  db.sequelize
    .query("call get_reports(:from, :to, :facilityId)", {
      replacements: { from, to, facilityId },
    })
    .then((results) => res.json({ results }))
    .catch((err) => res.status(500).json({ err }));
};

// exports.getIndividualReport = (req, res) => {
//   const { account, from, to, facilityId } = req.params;
//   let toDate = moment(to)
//     .add(1, 'days')
//     .format('YYYY-MM-DD');
//   db.sequelize
//     .query(
//       'call get_individual_report(:account, :from, :to, facilityId)',
//       {
//         replacements: { account, from, to, facilityId }
//       }
//     )
//     .then(results => res.json({ results }))
//     .catch(err => res.status(500).json({ err }));
// };

// _id: '86bb80cd-51e5-49cb-89dd-55e18cf03ef6',
//   amount: '2000',
//   quantity: 0,
//   description: 'Supplier Payment',
//   receiptNo: '2111262453',
//   narration: 'some narr',
//   modeOfPayment: 'CASH',
//   supplierName: '',
//   transaction_type: 'SUPPLIER PAYMENT',
//   account: '',
//   supplierAccount: '',
//   chequeNo: '',
//   createdAt: '2021-11-26T13:04:55.363Z',
//   receive_date: '2021-11-26',
//   facilityID: '968b853c-e2de-4690-8b69-fcd5aa375227',
//   userId: 44,
//   userName: 'NewMe',
//   facilityId: '968b853c-e2de-4690-8b69-fcd5aa375227'

function queryExpenses(
  {
    dr = 0,
    description = "",
    source = "",
    userId = "",
    receiptNo = "",
    modeOfPayment = "Cash",
    destination = "",
    facilityId,
    facilityID,
    collectedBy = "",
    _rev = Date.now(),
  },
  success = (f) => f,
  error = (f) => f
) {
  db.sequelize
    .query(
      `CALL new_expense(:facId,:description,:source,:destination,:receiptsn,:receiptno,
      :payment_mode,:userId,:amount,:client_acct,:in_date,:t_type,:batch_narration,:_rev)`,
      {
        replacements: {
          amount: dr,
          description,
          source,
          // modeOfPayment.toLowerCase() === 'cash' ? '400021' : '400022',
          userId,
          receiptsn: receiptNo,
          receiptno: receiptNo,
          payment_mode: modeOfPayment,
          destination,
          facId: facilityId ? facilityId : facilityID,
          client_acct: collectedBy,
          in_date: moment().format("YYYY-MM-DD hh:mm:ss"),
          t_type: "Expenditure",
          batch_narration: "",
          _rev,
        },
      }
    )
    .then((results) => success(results))
    .catch((err) => error(err));
}

exports.batchExpenses = (req, res) => {
  const { data } = req.body;

  for (let i = 0; i < data.length; i++) {
    let item = data[i];
    queryExpenses(
      item,
      () => console.log("success"),
      () => console.log("Err")
    );
  }

  res.json({ success: true, msg: "Batch Expenses recorded" });
  res.status(500).json({ success: false, err: "Error Occur" });
};

exports.expenditure = (req, res) => {
  queryExpenses(
    req.body,
    (results) => {
      res.json({ success: true, results, msg: "Expenses recorded" });
    },
    (err) => {
      console.log(err);
      res.status(500).json({ success: false, err });
    }
  );

  // db.sequelize
  //   .query(
  //     `CALL new_expense(:facId,:description,:source,:destination,:receiptsn,:receiptno,
  //     :payment_mode,:userId,:amount,:client_acct,:in_date,:t_type,:batch_narration,:_rev)`,
  //     {
  //       replacements: {
  //         amount: dr,
  //         description,
  //         source,
  //         // modeOfPayment.toLowerCase() === 'cash' ? '400021' : '400022',
  //         userId,
  //         receiptsn: receiptNo,
  //         receiptno,
  //         payment_mode: modeOfPayment,
  //         destination,
  //         facId: facilityId ? facilityId : facilityID,
  //         client_acct: collectedBy,
  //         in_date: moment().format('YYYY-MM-DD hh:mm:ss'),
  //         t_type: 'Expenditure',
  //         batch_narration: '',
  //         _rev,
  //       },
  //     },
  //   )
  //   .then((results) => {
  //     // db.sequelize
  //     //   .query(sqlstmt2, { type: db.sequelize.QueryTypes.UPDATE })
  //     // .then((results2) =>
  //     res.json({ success: true, results, msg: 'Expenses recorded' })
  //     // )
  //     // .catch((err2) => res.status(500).json({ err2 }));
  //   })
  //   .catch((err) => {
  //     console.log(err)
  //     res.status(500).json({ success: false, err })
  //   })
};

exports.getPendingTransactions = (req, res) => {
  const { facilityId } = req.params;
  db.sequelize
    .query("call get_pending_transactions(:facilityId)", {
      replacements: { facilityId },
    })
    .then((results) => res.json({ results }))
    .catch((err) => res.status(500).json({ err }));
};

exports.review = (req, res) => {
  const { finalist, facilityId } = req.body;
  db.sequelize
    .query(
      `UPDATE transactions SET status = "approved" WHERE transaction_id IN(${finalist.join(
        ","
      )}) and facilityId=${facilityId}`,
      { type: db.sequelize.QueryTypes.UPDATE }
    )
    .then((results) => res.json({ results }))
    .catch((err) => res.status(500).json({ err }));
};

exports.getPatientPaymentPendingTransaction = (req, res) => {
  const { accountNo, facilityId } = req.params;
  // let sqlstmt = `SELECT * FROM transactions WHERE transaction_source="${accountNo}" and paymentStatus="pending"`
  db.sequelize
    .query(
      `SELECT transaction_id, description as service, debit as amount, patient_id as patientId  FROM transactions WHERE acct="${accountNo}" and paymentStatus="pending" and facilityId=${facilityId}`,
      { type: db.sequelize.QueryTypes.SELECT }
    )
    .then((results) => res.json({ results }))
    .catch((err) => res.status(500).json({ err }));
};

exports.getGeneralReport = (req, res) => {
  const { facilityId } = req.params;
  db.sequelize
    .query("call report_general(:facilityId)", {
      replacements: { facilityId },
    })
    .then((results) => res.json({ results }))
    .catch((err) => res.status(500).json({ err }));
};

exports.getGeneralReportByDate = (req, res) => {
  const { from, to, facilityId } = req.params;
  // let toDate = moment(to)
  // .add(1, 'days')
  // .format('YYYY-MM-DD');
  db.sequelize
    .query(
      `SELECT * FROM transaction_view WHERE facilityId="${facilityId}", createdAt BETWEEN date("${from}") AND date("${to}")`
    )
    // .query('call report_general_by_date(:from,:to, :facilityId)', {
    //   replacements: { from, to, facilityId },
    // })
    .then((results) => res.json({ results }))
    .catch((err) => res.status(500).json({ err }));
};

exports.getGeneralReportByAccHead = (req, res) => {
  const { from, to, accHead, facilityId } = req.params;

  db.sequelize
    .query("call report_general_by_accHead(:from,:to,:accHead,:facilityId)", {
      replacements: { from, to, accHead, facilityId },
    })
    .then((results) => res.json({ results }))
    .catch((err) => res.status(500).json({ err }));
};

exports.getRevenueReport = (req, res) => {
  const { from, to, facilityId } = req.params;

  db.sequelize
    .query(`call report(:from,:to,'20000',:facilityId)`, {
      replacements: { from, to, facilityId },
    })
    .then((results) => res.json({ results }))
    .catch((err) => res.status(500).json({ err }));
};

exports.getRevenueReportByAccHead = (req, res) => {
  const { from, to, accHead, facilityId } = req.params;

  db.sequelize
    .query("call report_revenue_by_accHead(:from,:to,:accHead,:facilityId)", {
      replacements: { from, to, accHead, facilityId },
    })
    .then((results) => res.json({ results }))
    .catch((err) => res.status(500).json({ err }));
};

exports.getExpenditureReport = (req, res) => {
  const { from, to, facilityId } = req.params;

  db.sequelize
    .query(`call report(:from,:to,'40000',:facilityId)`, {
      replacements: { from, to, facilityId },
    })
    .then((results) => res.json({ results }))
    .catch((err) => res.status(500).json({ err }));
};

exports.getExpenditureReportByAccHead = (req, res) => {
  const { from, to, accHead, facilityId } = req.params;

  db.sequelize
    .query(
      "call report_expenditure_by_accHead(:from,:to,:accHead,:facilityId)",
      {
        replacements: { from, to, accHead, facilityId },
      }
    )
    .then((results) => res.json({ results }))
    .catch((err) => res.status(500).json({ err }));
};

exports.getClientAccStatement = (req, res) => {
  const { patientId, from, to, facilityId } = req.params;

  db.sequelize
    .query("call get_client_acc_stmt(:patientId,:from,:to,:facilityId)", {
      replacements: { from, to, patientId, facilityId },
    })
    .then((results) => res.json({ results }))
    .catch((err) => {
      console.log(err);
      res.status(500).json({ err });
    });
};

const today = moment().format("YYYY-MM-DD");
exports.getClientAccStatement2 = (req, res) => {
  const {
    clientId = "",
    from = today,
    to = today,
    facilityId = "",
    query_type = "",
  } = req.query;

  db.sequelize
    .query("call get_customer_statement(:clientId,:from,:to)", {
      replacements: { clientId, from, to },
    })
    .then((results) => res.json({ success: true, results }))
    .catch((err) => {
      console.log(err);
      res.status(500).json({ err });
    });
};

// Transaction setup

exports.setupNewTransaction = (req, res) => {
  const { title, debit, credit, user, facilityId } = req.body;

  db.sequelize
    .query(
      `INSERT INTO transactionSetup (title, debit, credit, createdBy, facilityId) VALUES ("${title}", "${debit}", "${credit}", "${user}", "${facilityId}")`
    )
    .then((results) => res.json({ success: true, results }))
    .catch((err) => {
      res.status(500).json({ success: false, err });
      console.log(err);
    });
};

function returnTxn(
  {
    _id = "",
    client_acct = "",
    item_name = "",
    quantity = 0,
    type = "",
    createdAt = "",
    facilityID = "",
    userName = "",
    amountPaid = 0,
    transaction_id,
    source = "",
    destination = "",
    description = "",
    transaction_type = "",
    totalAmount = 0,
    modeOfPayment = "",
    acct = "",
    amount = 0,
    expiring_date = "1111-11-11",
    location_from = "",
    location_to = "",
    supplyName = "",
    supply_code = "",
    qty_in = 0,
    _rev,
    receiptNo = "",
    expiry_date,
  },
  callback = (f) => f,
  error = (f) => f
) {
  db.sequelize
    .query(
      "call new_return_items(:amountPaid,:description,:amount,:type,:acct,:_id,:facilityID,:expiring_date,:location_from,:location_to,:supplyName,:supply_code,:qty_in,:receiptNo)",
      {
        replacements: {
          amountPaid,
          description,
          amount,
          type,
          acct,
          _id,
          facilityID,
          expiring_date:
            expiry_date === "0000-00-00" ||
            expiry_date === "" ||
            expiry_date === null ||
            expiry_date === undefined
              ? "1111-11-11"
              : moment(expiring_date).format("YYYY-MM-DD"),
          location_from,
          location_to,
          supplyName,
          supply_code,
          qty_in,
          receiptNo,
        },
      }
    )
    .then((results) => callback(results))
    .catch((err) => error(err));
}

exports.returnBatchTxns = (req, res) => {
  console.log(req.body);
  const { data } = req.body;

  for (let i = 0; i < data.length; i++) {
    let item = data[i];

    returnTxn(
      item,
      (results) => {
        console.log(results);
      },
      (err) => {
        // res.status(500).json({ success: false, err });
        console.log(err);
      }
    );
  }

  res.json({ success: true, msg: "Items returned successfully" });
};

exports.returnItemsTransaction = (req, res) => {
  returnTxn(
    req.body,
    (results) => {
      res.json({ success: true, results });
    },
    (err) => {
      console.log(err);
      res.status(500).json({ success: false, err });
    }
  );

  // const {
  //   _id = '',
  //   client_acct = '',
  //   item_name = '',
  //   quantity = 0,
  //   type = '',
  //   receiptNo = '',
  //   createdAt = '',
  //   facilityID = '',
  //   userName = '',
  //   amountPaid = 0,
  //   transaction_id,
  //   source = '',
  //   destination = '',
  //   description = '',
  //   transaction_type = '',
  //   totalAmount = 0,
  //   modeOfPayment = '',
  //   acct = '',
  //   amount = 0,
  //   _rev,
  // } = req.body
  // console.log(req.body)

  // db.sequelize
  //   .query(
  //     'call return_item2(:amountPaid,:description,:amount,:type,:acct,:_id,:facilityID)',
  //     {
  //       replacements: {
  //         amountPaid,
  //         description,
  //         amount,
  //         type,
  //         acct,
  //         _id,
  //         facilityID,
  //       },
  //     },
  //   )
  //   .then((results) => res.json({ success: true, results }))
  //   .catch((err) => {
  //     res.status(500).json({ success: false, err })
  //     console.log(err)
  //   })
};

exports.getTransactionsSetupList = (req, res) => {
  const { facilityId } = req.params;
  db.sequelize
    .query(
      `SELECT title, debit, credit FROM transactionSetup WHERE facilityId="${facilityId}"`
    )
    .then((results) => res.json({ success: true, results: results[0] }))
    .catch((err) => {
      res.status(500).json({ success: false, err });
      console.log(err);
    });
};

exports.newServiceFromDeposit = (req, res) => {
  const {
    facilityId,
    amount,
    modeOfPayment,
    source,
    destination,
    description,
    userId,
    receiptsn = "",
    receiptno = "",
    patientId,
    debit,
    credit,
    bank,
    transaction_source,
  } = req.body;
  console.log(req.body);
  // { description: '20001',
  // debited: 4000,
  // credited: 0,
  // debit: '2',
  // amount: 4000,
  // credit: '20001',
  // transaction_source: '2',
  // userId: 'emaitee',
  // user: 'emaitee',
  // receiptsn: '02122011',
  // receiptno: 1,
  // modeOfPayment: 'deposit',
  // status: 'paid',
  // patientId: '2-3',
  // facilityId: '1be0a9da-bff9-4ab6-a36c-edfd8ca88f1a',
  // destination: 'Deposit' }
  db.sequelize
    .query(
      "CALL new_service_from_deposit(:facId,:patientId,:amount,:source,:destination,:userId,:receiptsn,:receiptno,:payment_mode,:description,:in_date)",
      {
        replacements: {
          amount,
          accNo: transaction_source,
          description,
          source: credit,
          userId,
          receiptsn,
          receiptno,
          payment_mode: modeOfPayment,
          destination,
          facId: facilityId,
          client_acct: debit,
          patientId: debit,
          in_date: moment().format("YYYY-MM-DD hh:mm:ss"),
        },
      }
    )
    .then((results) => {
      res.json({ success: true, results });
    })
    .catch((err1) => {
      console.log(err1);
      res.status(500).json({ success: false, err1 });
    });
};

exports.newServiceInstantPayment = (req, res) => {
  const today = moment.utc().format("YYYY-MM-DD");
  const {
    facilityId = "",
    amount = "",
    modeOfPayment = "",
    source = "",
    destination = "",
    description = "",
    userId = "",
    receiptsn = "",
    receiptno = "",
    patientId = "",
    credit = "",
    debit = "",
    clientAccount = "",
    serviceHead = "",
    transactionType = "",
    bank = "",
    branch_name = "",
    quantity = "",
    txn_date = today,
    discount = 0,
    customerName = "",
    version_id = "",
    qty_in = 0,
    phone = "",
    customer_bank = "",
    customer_acc_no = "",
    transaction_amount = "0",
    business_bank = "",
    business_bank_acc_no = "",
    _rev = "",
    receiptNo = "",
    amountPaid = 0,
    truckNo = "",
    waybillNo = "",
  } = req.body;
  // console.log(req.body);
  db.sequelize
    .query(
      `CALL service_transaction(:description,:accNo,:amount,:receiptsn,:receiptno,:payment_mode,
        :patientId,:facId,:sourceAcct,:userId,:serviceHead,:transactionType,:in_date,
        :payables_head,:recievables_head,:bank,:txn_date,:discount,:discount_head,:in_customer_name,
       :branch_name,:quantity,:version_id,:phone,:customer_bank,:customer_acc_no,
       :transaction_amount,:business_bank,:business_bank_acc_no,:amountPaid,:truckNo,:waybillNo,
       :itemList,:txn_type)`,
      //  :branch_name,:quantity,:version_id,:qty_in)`,
      {
        replacements: {
          amount: amount ? amount : 0,
          accNo: clientAccount,
          description,
          source: credit,
          userId,
          receiptsn,
          receiptno,
          payment_mode: modeOfPayment,
          destination,
          facId: facilityId,
          client_acct: debit,
          patientId,
          sourceAcct:
            modeOfPayment.toLowerCase() === "cash" ? "400021" : "400022",
          serviceHead: serviceHead ? serviceHead : credit,
          transactionType,
          in_date: moment().format("YYYY-MM-DD hh:mm:ss"),
          payables_head: "500021",
          recievables_head: "400023",
          bank: bank ? bank : "",
          branch_name: branch_name ? branch_name : "",
          quantity: quantity ? quantity : "",
          txn_date,
          discount: discount ? discount : 0,
          discount_head: "",
          in_customer_name: customerName,
          version_id,
          qty_in: qty_in ? qty_in : 0,
          phone,
          customer_bank,
          customer_acc_no,
          transaction_amount,
          business_bank,
          business_bank_acc_no,
          amountPaid: amountPaid !== "" ? amountPaid : 0,
          truckNo: truckNo ? truckNo : "",
          waybillNo: waybillNo ? waybillNo : "",
          itemList,
          txn_type,
        },
      }
    )
    .then((results) => {
      // record items sold here
      res.json({ success: true, results });
    })
    .catch((err) => res.status(500).json({ err }));
};

exports.batchSelling = (req, res) => {
  const { data = [] } = req.body;
  console.log(data, "===================>Data1");

  for (let i = 0; i < data.length; i++) {
    let item = data[i];
    console.log(item, "========================>Data2");
    sellingApi(
      item,
      (resp) => {
        console.log(resp);
      },
      (err) => {
        console.log(err);
        res.status(500).json({ success: false, err });
      }
    );
  }

  res.json({ success: true, msg: "Success" });
};

// -----------------------------------------------------------------------------
// GET SALE BY CODE
// -----------------------------------------------------------------------------
exports.getSaleByCode = async (req, res) => {
  try {
    const { sale_code: saleCode, facility_id: facilityId } = req.query;

    if (!saleCode || !facilityId) {
      return res.status(400).json({
        success: false,
        message: "sale_code and facility_id are required",
      });
    }

    const customerEntries = await CustomerEntry.findAll({
      where: {
        receiptNo: saleCode,
        facilityId,
      },
    });

    if (!customerEntries.length) {
      return res.status(404).json({
        success: false,
        message: "No sale found for the provided sale code",
      });
    }

    const entries = customerEntries.map((entry) =>
      entry.get ? entry.get({ plain: true }) : entry
    );
    const baseEntry = entries[0];

    const customer = baseEntry?.customerNo
      ? await db.Customer.findOne({
          where: {
            customerNo: baseEntry.customerNo,
            facilityId,
          },
          raw: true,
        })
      : null;

    const business = await db.business.findOne({
      where: { id: facilityId },
      raw: true,
    });

    const taxEntries = entries.filter(
      (item) => typeof item.type === "string" && item.type.includes("tax")
    );
    const discountEntries = entries.filter(
      (item) => typeof item.type === "string" && item.type.includes("discount")
    );

    const discounts = await Promise.all(
      discountEntries.map(async (item) => {
        const discountRecord = item.link_id
          ? await Discount.findOne({
              where: {
                discount_id: item.link_id,
                facilityId,
              },
            })
          : null;

        return {
          ...item,
          amount: Number(item.cost || 0),
          ...(discountRecord ? discountRecord.get({ plain: true }) : {}),
        };
      })
    );

    const taxes = await Promise.all(
      taxEntries.map(async (item) => {
        const taxRecord = item.link_id
          ? await Tax.findOne({
              where: {
                id: item.link_id,
                facilityId,
              },
            })
          : null;

        return {
          ...item,
          amount: Number(item.cost || 0),
          ...(taxRecord ? taxRecord.get({ plain: true }) : {}),
        };
      })
    );

    const mapEntryToSaleItem = async (item) => {
      const product = item.link_id
        ? await db.Product.findOne({
            where: {
              sku: item.link_id,
              facility_id: facilityId,
            },
            raw: true,
          })
        : null;

      const quantity =
        Number(item.qty_out || 0) > 0
          ? Number(item.qty_out || 0)
          : Number(item.qty_in || 0);
      const unitCost = Number(item.cost || 0);
      const unitPrice = unitCost;
      const amount = unitCost * quantity;
      const entryType = String(item.type || "").toLowerCase();

      return {
        id: product?.id || item.entry_id,
        created_by: item.created_by,
        entry_id: item.entry_id,
        type: item.type,
        link_id: item.link_id,
        item_name: product?.name || item.description,
        taxable: product?.taxable,
        unit_of_measure: product?.unit_of_measure || null,
        description: item.description,
        item_type:
          product?.item_type ||
          (entryType.includes("service") ? "Service" : "Finished Good"),
        uom_category: product?.unit_of_measure || null,
        quantity_sold: quantity,
        selling_price: unitPrice,
        amount: amount,
        mode_of_payment: item.mode_of_payment,
        line_of_business: item.line_of_business,
        created_at: item.created_at,
        branch_id: item.branch_id != null ? Number(item.branch_id) : null,
        branchId: item.branch_id != null ? Number(item.branch_id) : null,
      };
    };

    const isInvoiceLineType = (type) => {
      const entryType = String(type || "").toLowerCase();
      return (
        entryType.includes("service") ||
        entryType.includes("sales") ||
        entryType.includes("pro-bono")
      );
    };

    const isServiceLineItem = (item) => {
      const type = String(item?.type || "").toLowerCase();
      const itemType = String(item?.item_type || "").toLowerCase();
      if (type.includes("service") || itemType === "service") {
        return true;
      }
      const label = `${item?.item_name || ""} ${item?.description || ""}`.toLowerCase();
      return (
        label.includes("handling & transport") ||
        label.includes("handling and transport") ||
        (label.includes("handling") && label.includes("transport")) ||
        label.includes("service charge") ||
        label.includes("delivery charge")
      );
    };

    const isDeliveryLineItem = (item) => {
      if (isServiceLineItem(item)) return false;
      const entryType = String(item?.type || "").toLowerCase();
      if (entryType.includes("tax") || entryType.includes("discount")) {
        return false;
      }
      return (
        entryType.includes("sales") ||
        entryType.includes("purchase") ||
        entryType.includes("pro-bono")
      );
    };

    const productEntries = entries.filter(
      (item) => typeof item.type === "string",
    );

    const items = await Promise.all(
      productEntries
        .filter((item) => isInvoiceLineType(item.type))
        .map((item) => mapEntryToSaleItem(item)),
    );

    let deliveryItems = (
      await Promise.all(
        productEntries
          .filter((item) => {
            const entryType = String(item.type || "").toLowerCase();
            return !entryType.includes("tax") && !entryType.includes("discount");
          })
          .map((item) => mapEntryToSaleItem(item)),
      )
    ).filter((item) => isDeliveryLineItem(item));

    const subtotal = items.reduce((sum, item) => sum + (item.amount || 0), 0);
    const totalDiscount = discounts.reduce(
      (sum, discount) => sum + Number(discount.amount || 0),
      0
    );
    const totalTax = taxes.reduce(
      (sum, tax) => sum + Number(tax.amount || 0),
      0
    );
    const totalAmount = subtotal + totalTax - totalDiscount;

    const invoiceDiscount =
      discounts.length > 0
        ? {
            ...discounts[0],
            amount: Number(discounts[0].amount || 0),
            type:
              discounts[0].discount_type?.toLowerCase() ||
              discounts[0].type ||
              "discount",
            name:
              discounts[0].discount_name ||
              discounts[0].description ||
              "Discount",
          }
        : null;

    const createdAt =
      entries
        .map(
          (item) => new Date(item.created_at || item.createdAt || Date.now())
        )
        .sort((a, b) => a - b)[0] || new Date();

    const user = await db.users.findOne({
      where: {
        id: items[0]?.created_by || baseEntry?.created_by,
      },
    });
    const customerCopy = await db.CustomerCopy.findOne({
      where: {
        facilityId,
        customerNo: baseEntry.customerNo,
        reference_id: saleCode,
      },
    });
    const customerCopyRecord = customerCopy
      ? customerCopy.get({ plain: true })
      : null;
    const customerCopyDataRaw = customerCopyRecord?.data;
    let customerCopyData = [];
    if (customerCopyDataRaw) {
      try {
        const parsed =
          typeof customerCopyDataRaw === "string"
            ? JSON.parse(customerCopyDataRaw)
            : customerCopyDataRaw;
        if (Array.isArray(parsed)) {
          customerCopyData = parsed;
        } else if (parsed && Array.isArray(parsed.items)) {
          customerCopyData = parsed.items;
        }
      } catch (error) {
        console.warn(
          "Failed to parse customer copy data for sale",
          saleCode,
          error
        );
        customerCopyData = [];
      }
    }
    const customerCopyItems = Array.isArray(customerCopyData)
      ? customerCopyData
      : [];

    // Enrich line branch from store_entries when customer_entries lack branch_id
    let enrichedItems = items;
    try {
      if (db.StoreEntry) {
        const storeRows = await db.StoreEntry.findAll({
          where: {
            facilityId,
            reference_number: saleCode,
            qty_out: { [Op.gt]: 0 },
          },
          attributes: ["id", "product_id", "branchId", "qty_out"],
          raw: true,
        });
        if (storeRows.length) {
          const bySku = new Map();
          for (const se of storeRows) {
            const key = String(se.product_id || "");
            if (!bySku.has(key)) bySku.set(key, []);
            bySku.get(key).push(se);
          }
          enrichedItems = items.map((it) => {
            if (it.branch_id != null || it.branchId != null) return it;
            const list = bySku.get(String(it.link_id || "")) || [];
            const match = list.shift();
            if (!match) return it;
            const bid = match.branchId != null ? Number(match.branchId) : null;
            return { ...it, branch_id: bid, branchId: bid };
          });
        }
      }
    } catch (enrichErr) {
      console.warn("getSaleByCode branch enrich:", enrichErr.message);
    }

    // Resolve warehouse / branch names for line items
    let warehouseNames = [];
    let warehouseLabel = "";
    try {
      const branchIds = [
        ...new Set(
          enrichedItems
            .map((it) => Number(it.branch_id ?? it.branchId))
            .filter((id) => Number.isFinite(id) && id > 0),
        ),
      ];
      if (branchIds.length && db.Branch) {
        const branchRows = await db.Branch.findAll({
          where: { id: { [Op.in]: branchIds } },
          attributes: ["id", "branch_name"],
          raw: true,
        });
        const nameById = {};
        branchRows.forEach((b) => {
          nameById[b.id] = b.branch_name;
        });
        enrichedItems = enrichedItems.map((it) => {
          const bid = Number(it.branch_id ?? it.branchId);
          const warehouse =
            Number.isFinite(bid) && nameById[bid] ? nameById[bid] : null;
          return { ...it, warehouse, warehouse_name: warehouse };
        });
        warehouseNames = branchIds
          .map((id) => nameById[id])
          .filter(Boolean);
        warehouseLabel = warehouseNames.join(", ");

        // Also tag delivery lines with warehouse names
        deliveryItems = deliveryItems.map((it) => {
          const bid = Number(it.branch_id ?? it.branchId);
          const warehouse =
            Number.isFinite(bid) && nameById[bid] ? nameById[bid] : null;
          return { ...it, warehouse, warehouse_name: warehouse };
        });
      }
    } catch (whErr) {
      console.warn("getSaleByCode warehouse resolve:", whErr.message);
    }

    // Mode of payment + amount paid (deposit / sale payment lines + workflow)
    const paymentEntries = entries.filter((item) => {
      const t = String(item.type || "").toLowerCase();
      const desc = String(item.description || "").toLowerCase();
      return (
        t === "deposit" ||
        t.includes("payment") ||
        desc.includes("sale payment")
      );
    });
    const amountPaidFromEntries = paymentEntries.reduce(
      (sum, item) => sum + Number(item.cost || item.amount_paid || 0),
      0,
    );

    // Resolve bank names for transfer/bank payment lines
    const bankIds = [
      ...new Set(
        paymentEntries
          .map((p) => String(p.bank_account_id || "").trim())
          .filter((id) => id && /^\d+$/.test(id)),
      ),
    ];
    const bankNameById = {};
    if (bankIds.length && db.bank_account) {
      try {
        const banks = await db.bank_account.findAll({
          where: { id: { [Op.in]: bankIds.map((id) => Number(id)) } },
          attributes: ["id", "account_name", "bank_code", "account_number", "head"],
          raw: true,
        });
        banks.forEach((b) => {
          bankNameById[String(b.id)] =
            b.account_name || b.bank_code || b.account_number || `Bank #${b.id}`;
        });
      } catch (bankErr) {
        console.warn("getSaleByCode bank resolve:", bankErr.message);
      }
    }

    const paymentBreakdown = paymentEntries
      .map((p) => {
        const modeRaw = String(p.mode_of_payment || "").toLowerCase();
        const desc = String(p.description || "").toLowerCase();
        let mode = "other";
        if (
          modeRaw === "cash" ||
          desc.includes("(cash)") ||
          desc.includes("payment (cash)")
        ) {
          mode = "cash";
        } else if (
          modeRaw === "bank" ||
          modeRaw === "transfer" ||
          modeRaw.includes("bank") ||
          desc.includes("(bank)") ||
          desc.includes("payment (bank)") ||
          desc.includes("transfer")
        ) {
          mode = "transfer";
        } else if (modeRaw === "cheque" || desc.includes("cheque")) {
          mode = "cheque";
        } else if (modeRaw && modeRaw !== "credit") {
          mode = modeRaw;
        }
        const bankId = String(p.bank_account_id || "").trim();
        const bankName =
          mode === "transfer" || mode === "bank" || mode === "cheque"
            ? bankNameById[bankId] || null
            : null;
        return {
          mode,
          amount: Number(p.cost || p.amount_paid || 0),
          bank_account_id: bankId || null,
          bank_name: bankName,
          description: p.description || null,
        };
      })
      .filter((p) => p.amount > 0);

    const cashPaid = paymentBreakdown
      .filter((p) => p.mode === "cash")
      .reduce((s, p) => s + p.amount, 0);
    const transferPaid = paymentBreakdown
      .filter((p) => p.mode === "transfer" || p.mode === "bank")
      .reduce((s, p) => s + p.amount, 0);
    const transferBanks = [
      ...new Set(
        paymentBreakdown
          .filter((p) => (p.mode === "transfer" || p.mode === "bank") && p.bank_name)
          .map((p) => p.bank_name),
      ),
    ];

    let workflowPaymentType = null;
    let workflowAmount = null;
    let workflowHistory = [];
    let creditPaidFromWorkflow = 0;
    let originalInvoiceFromWorkflow = null;
    try {
      if (db.SaleWorkflow) {
        const wf = await db.SaleWorkflow.findOne({
          where: { facility_id: facilityId, sale_code: saleCode },
          attributes: ["payment_type", "amount", "status", "history"],
          raw: true,
        });
        if (wf) {
          workflowPaymentType = wf.payment_type || null;
          workflowAmount =
            wf.amount != null ? Number(wf.amount) : null;
          workflowHistory = Array.isArray(wf.history) ? wf.history : [];
          // Prefer latest credit_remainder from Credit + Cash + Transfer flow
          for (let i = workflowHistory.length - 1; i >= 0; i -= 1) {
            const cr = workflowHistory[i]?.credit_remainder;
            if (cr && Number(cr.remainder) > 0) {
              creditPaidFromWorkflow = Number(cr.remainder) || 0;
              if (cr.original_amount != null) {
                originalInvoiceFromWorkflow = Number(cr.original_amount);
              }
              break;
            }
          }
        }
      }
    } catch (wfErr) {
      console.warn("getSaleByCode workflow:", wfErr.message);
    }

    const salesMode =
      enrichedItems.find((it) => it.mode_of_payment)?.mode_of_payment ||
      paymentEntries.find((it) => it.mode_of_payment)?.mode_of_payment ||
      null;

    let modeOfPayment =
      workflowPaymentType ||
      salesMode ||
      baseEntry?.mode_of_payment ||
      "CREDIT";

    const invoiceTotalAmount = Number(totalAmount) || 0;
    // Credit portion: explicit remainder, or unpaid balance on credit / credit_split
    let creditPaid = creditPaidFromWorkflow;
    if (creditPaid <= 0.05) {
      const unpaid = Number(
        (invoiceTotalAmount - cashPaid - transferPaid).toFixed(2),
      );
      const pt = String(modeOfPayment || "").toLowerCase();
      if (
        unpaid > 0.05 &&
        (pt === "credit" ||
          pt === "credit_split" ||
          pt.includes("credit") ||
          String(workflowPaymentType || "")
            .toLowerCase()
            .includes("credit"))
      ) {
        creditPaid = unpaid;
      }
    }

    // Prefer derived label when we have concrete payment lines
    if (cashPaid > 0.05 && transferPaid > 0.05 && creditPaid > 0.05) {
      modeOfPayment = "credit_split";
    } else if (cashPaid > 0.05 && transferPaid > 0.05) {
      modeOfPayment = "split";
    } else if (cashPaid > 0.05 && transferPaid <= 0.05 && creditPaid > 0.05) {
      modeOfPayment = "credit_split";
    } else if (transferPaid > 0.05 && cashPaid <= 0.05 && creditPaid > 0.05) {
      modeOfPayment = "credit_split";
    } else if (cashPaid > 0 && transferPaid <= 0 && paymentBreakdown.length && creditPaid <= 0.05) {
      modeOfPayment = "cash";
    } else if (transferPaid > 0 && cashPaid <= 0 && creditPaid <= 0.05) {
      modeOfPayment = "transfer";
    } else if (creditPaid > 0.05 && cashPaid <= 0.05 && transferPaid <= 0.05) {
      modeOfPayment = "credit";
    }

    const amountPaid =
      amountPaidFromEntries > 0
        ? amountPaidFromEntries
        : String(modeOfPayment).toUpperCase() === "CREDIT" ||
            String(modeOfPayment).toLowerCase() === "credit_split"
          ? cashPaid + transferPaid
          : workflowAmount != null && Number.isFinite(workflowAmount)
            ? workflowAmount
            : 0;

    if (creditPaid > 0.05) {
      paymentBreakdown.push({
        mode: "credit",
        amount: creditPaid,
        bank_account_id: null,
        bank_name: null,
        description: "Credit",
      });
    }

    const transaction = {
      id: saleCode,
      reference: saleCode,
      mode_of_payment: modeOfPayment,
      amount_paid: amountPaid,
      payment_type: modeOfPayment,
      cash_paid: cashPaid,
      transfer_paid: transferPaid,
      credit_paid: creditPaid,
      transfer_banks: transferBanks,
      payment_breakdown: paymentBreakdown,
      invoice_total_amount:
        originalInvoiceFromWorkflow != null &&
        Number.isFinite(originalInvoiceFromWorkflow)
          ? originalInvoiceFromWorkflow
          : invoiceTotalAmount,
      created_by: baseEntry?.created_by,
    };

    return res.json({
      success: true,
      data: {
        items: enrichedItems,
        deliveryItems,
        user: {
          name: user?.firstname + " " + user?.lastname,
          id: user?.id,
          signature: user?.signature,
        },
        customerCopy: JSON.stringify(customerCopyItems),
        customerCopyItems,
        taxes,
        discounts,
        discount: invoiceDiscount,
        subtotal,
        totalTax,
        totalAmount,
        discountAmount: totalDiscount,
        warehouse: warehouseLabel || null,
        warehouse_name: warehouseLabel || null,
        warehouses: warehouseNames,
        mode_of_payment: modeOfPayment,
        amount_paid: amountPaid,
        cash_paid: cashPaid,
        transfer_paid: transferPaid,
        credit_paid: creditPaid,
        transfer_banks: transferBanks,
        payment_breakdown: paymentBreakdown,
        invoice_total_amount: transaction.invoice_total_amount,
        transaction,
        date: createdAt,
        customer: customer
          ? {
              customer_name: customer.fullname,
              customerNo: customer.customerNo,
              address: customer.address,
              phone: customer.phone,
              email: customer.email,
            }
          : null,
        business: {
          id: business.id,
          business_name: business.business_name,
          business_address: business.business_address,
          business_phone: business.business_phone,
          fax: business.fax,
          email: business.business_email,
          description: business.description,
          business_email: business.business_email,
          rc: business.rc,
          default_receipt_type: business.default_receipt_type,
          print_delivery_order: business.print_delivery_order,
          delivery_order_format: business.delivery_order_format,
          delivery_document_type: business.delivery_document_type,
          document_header_style: business.document_header_style,
          business_logo: business.business_logo,
          customer_notes: business.customer_notes,
          terms_conditions: business.terms_conditions,
        },
        customPricing: false,
        customPrices: {},
      },
    });
  } catch (error) {
    console.error("getSaleByCode error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch sale",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

exports.saveCustomerCopy = async (req, res) => {
  try {
    const {
      facilityId,
      customerNo,
      reference_id: referenceId,
      data,
      created_by: createdBy,
    } = req.body;

    if (!facilityId || !customerNo || !referenceId || !data || !createdBy) {
      return res.status(400).json({
        success: false,
        message:
          "facilityId, customerNo, reference_id, data, and created_by are required",
      });
    }

    let parsedData = data;
    if (typeof parsedData === "string") {
      try {
        parsedData = JSON.parse(parsedData);
      } catch (error) {
        return res.status(400).json({
          success: false,
          message: "data must be a valid JSON array",
        });
      }
    }

    if (
      parsedData &&
      typeof parsedData === "object" &&
      Array.isArray(parsedData.items)
    ) {
      parsedData = parsedData.items;
    }

    if (!Array.isArray(parsedData)) {
      return res.status(400).json({
        success: false,
        message: "data must be an array of customer copy items",
      });
    }

    const sanitizedItems = parsedData.map((item) => ({
      id: item?.id ?? null,
      created_by: item?.created_by ?? null,
      entry_id: item?.entry_id ?? null,
      type: item?.type ?? null,
      link_id: item?.link_id ?? null,
      item_name: item?.item_name ?? "",
      description: item?.description ?? "",
      item_type: item?.item_type ?? "",
      uom_category: item?.uom_category ?? null,
      quantity_sold: Number(item?.quantity_sold) || 0,
      selling_price: Number(item?.selling_price) || 0,
      amount: Number(item?.amount) || 0,
      original_price: Number(item?.original_price) || 0,
      original_amount: Number(item?.original_amount) || 0,
      mode_of_payment: item?.mode_of_payment ?? null,
      line_of_business: item?.line_of_business ?? null,
      created_at: item?.created_at ?? null,
    }));

    const [record, created] = await CustomerCopy.findOrCreate({
      where: {
        facilityId,
        customerNo,
        reference_id: referenceId,
      },
      defaults: {
        id: UUIDV4(),
        facilityId,
        customerNo,
        reference_id: referenceId,
        data: sanitizedItems,
        created_by: createdBy,
      },
    });

    if (!created) {
      await record.update({
        data: sanitizedItems,
        created_by: createdBy,
      });
    }

    const responsePayload = record.get ? record.get({ plain: true }) : record;

    return res.status(created ? 201 : 200).json({
      success: true,
      message: created
        ? "Customer copy created successfully"
        : "Customer copy updated successfully",
      data: responsePayload,
    });
  } catch (error) {
    console.error("saveCustomerCopy error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to save customer copy",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

// Simplified single endpoint for creating a complete sale transaction
// ─────────────────────────────────────────────────────────────────────────────
//  CREATE CREDIT SALE – FINAL CORRECTED VERSION
//  (COGS only for item_type === "Finished Good")
// ─────────────────────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────
//  CREATE CREDIT SALE – FULLY ALIGNED WITH createDeposit
//  (receivable_accural_code handling + validation)
// ─────────────────────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────
//  CREATE CREDIT SALE – FIXED & SAFE (No undefined WHERE)
// ─────────────────────────────────────────────────────────────────────────────
// export const createSale = async (req, res) => {
//   const t = await db.sequelize.transaction();
//   let saleRef, saleDate;

//   try {
//     // -------------------------------------------------------------------------
//     // 1. EXTRACT & VALIDATE INPUT
//     // -------------------------------------------------------------------------
//     const {
//       customer_id,
//       items = [],
//       discount_amount = 0,
//       discount_info = {},
//       tax_amount = 0,
//       total_amount = 0,
//       modeOfPayment = "CREDIT",
//       txn_type = "Credit Sale",
//       facilityId,
//       created_by,
//       receivable_code,
//       receivable_accural_code,
//       cost_of_sale,
//       sale_revenue_code,
//       finished_goods_code,
//       taxes = [],
//     } = req.body;

//     if (
//       !customer_id ||
//       !items.length ||
//       !facilityId ||
//       !created_by ||
//       txn_type !== "Credit Sale" ||
//       modeOfPayment !== "CREDIT"
//     ) {
//       return res.status(400).json({
//         success: false,
//         message: "Invalid request: Must be Credit Sale with required fields",
//       });
//     }

//     // -------------------------------------------------------------------------
//     // 2. INITIALIZE
//     // -------------------------------------------------------------------------
//     saleDate = moment().format("YYYY-MM-DD");
//     saleRef = `SALE-${await getAndUpdateNumber("sale", facilityId)}`;
//     const transactionRef = `SALE-${saleRef}`;

//     // -------------------------------------------------------------------------
//     // 3. CUSTOMER & ACCOUNT RESOLUTION
//     // -------------------------------------------------------------------------
//     const customer = await db.Customer.findOne({
//       where: { customerNo: customer_id, facilityId },
//     });
//     if (!customer) {
//       await t.rollback();
//       return res
//         .status(404)
//         .json({ success: false, message: "Customer not found" });
//     }

//     const customerReceivable = customer.receivable_code;
//     const customerAccrual = customer.receivable_accural_code;

//     const receivableHead = customerReceivable || receivable_code;
//     if (!receivableHead) {
//       await t.rollback();
//       return res
//         .status(400)
//         .json({ success: false, message: "Receivable account head required" });
//     }

//     const receivableAccount = await db.Account.findOne({
//       where: { head: receivableHead, facilityId },
//     });
//     if (!receivableAccount) {
//       await t.rollback();
//       return res.status(404).json({
//         success: false,
//         message: `Receivable account not found: ${receivableHead}`,
//       });
//     }

//     let accrualAccount = null;
//     if (customerAccrual || receivable_accural_code) {
//       const accrualHead = customerAccrual || receivable_accural_code;
//       accrualAccount = await db.Account.findOne({
//         where: { head: accrualHead, facilityId },
//       });
//       if (!accrualAccount) {
//         await t.rollback();
//         return res.status(404).json({
//           success: false,
//           message: `Accrual account not found: ${accrualHead}`,
//         });
//       }
//     }

//     // Discount Account
//     let discountAccount = null;
//     if (discount_amount > 0 && discount_info?.discount_id) {
//       discountAccount = await db.Discount.findOne({
//         where: { discount_id: discount_info.discount_id, facilityId },
//       });
//       if (!discountAccount || !discountAccount.discount_account_head) {
//         await t.rollback();
//         return res
//           .status(400)
//           .json({ success: false, message: "Invalid discount configuration" });
//       }
//       const discountAcc = await db.Account.findOne({
//         where: { head: discountAccount.discount_account_head, facilityId },
//       });
//       if (!discountAcc) {
//         await t.rollback();
//         return res
//           .status(404)
//           .json({ success: false, message: "Discount account not found" });
//       }
//       discountAccount = discountAcc;
//     }

//     // -------------------------------------------------------------------------
//     // 4. HELPER: SAFE ACCOUNT LOOKUP
//     // -------------------------------------------------------------------------
//     const getAccount = async (headFromProduct, headFromBody, type) => {
//       const head = headFromProduct || headFromBody;
//       if (!head) throw new Error(`Missing ${type} account head`);
//       const account = await db.Account.findOne({ where: { head, facilityId } });
//       if (!account) throw new Error(`${type} account not found: ${head}`);
//       return account;
//     };

//     // -------------------------------------------------------------------------
//     // 5. PROCESS ITEMS & CALCULATE TOTALS
//     // -------------------------------------------------------------------------
//     const saleEntries = [];
//     const storeEntries = [];
//     const ledgerEntries = [];
//     const customerEntries = [];

//     let subtotal = 0;
//     let totalCOGS = 0;

//     for (const itm of items) {
//       const qty = Number(itm.quantity_sold || itm.quantity || 0);
//       const price = Number(itm.selling_price || itm.price || 0);
//       const lineTotal = qty * price;
//       const productId = itm.product_id;
//       const itemType = itm.item_type || "Finished Good";

//       if (!productId || qty <= 0 || price <= 0) {
//         await t.rollback();
//         return res
//           .status(400)
//           .json({ success: false, message: `Invalid item: ${productId}` });
//       }

//       const product = await db.Product.findOne({
//         where: { sku: productId, facility_id: facilityId },
//       });
//       if (!product) {
//         await t.rollback();
//         return res
//           .status(404)
//           .json({ success: false, message: `Product not found: ${productId}` });
//       }

//       const costPrice = Number(
//         itm.cost_price || product.cost_price || price * 0.8
//       );
//       subtotal += lineTotal;

//       // Sale Record
//       const sale = await db.Sale.create(
//         {
//           description: itm.item_name || product.name,
//           productId: product.id,
//           customerId: customer_id,
//           quantity: qty,
//           price,
//           total: lineTotal,
//           saleDate,
//           status: "completed",
//           createdAt: saleDate,
//           updatedAt: saleDate,
//         },
//         { transaction: t }
//       );
//       saleEntries.push(sale);

//       // Customer Entry (Sale)
//       await db.CustomerEntry.create(
//         {
//           customerNo: customer.customerNo,
//           description: itm.item_name || product.name,
//           qty_in: 0,
//           qty_out: qty,
//           bank_account_id: 0,
//           cost: costPrice,
//           facilityId,
//           mode_of_payment: modeOfPayment,
//           link_id: product.sku,
//           receiptNo: saleRef,
//           type: product.item_type === "Service" ? "service" : "purchase",
//           created_by,
//         },
//         { transaction: t }
//       );

//       // Revenue (Credit)
//       let revenueAccount;
//       try {
//         revenueAccount = await getAccount(
//           product.revenue_account,
//           sale_revenue_code,
//           "Revenue"
//         );
//       } catch (err) {
//         await t.rollback();
//         return res.status(400).json({ success: false, message: err.message });
//       }

//       ledgerEntries.push({
//         transaction_date: saleDate,
//         account_code: revenueAccount.head,
//         account_subhead: revenueAccount.subhead || 0,
//         dr: 0,
//         cr: lineTotal,
//         account_description: revenueAccount.description,
//         transaction_description: `Credit Sale - ${
//           itm.item_name || product.name
//         }`,
//         reference_number: saleRef,
//         purpose_of_payment: "Credit Sale",
//         payee: customer.fullname,
//         mode_of_payment: modeOfPayment,
//         created_by,
//         facility_id: facilityId,
//         status: "posted",
//         type: "revenue",
//         transaction_ref: `${transactionRef}-REV-${sale.id}`,
//       });

//       // COGS & Inventory (Only for Finished Goods)
//       if (itemType === "Finished Good") {
//         const cogsAmount = qty * costPrice;
//         totalCOGS += cogsAmount;

//         let cogsAccount, inventoryAccount;
//         try {
//           cogsAccount = await getAccount(
//             product.cogs_head,
//             cost_of_sale,
//             "COGS"
//           );
//           inventoryAccount = await getAccount(
//             product.inventory_account,
//             finished_goods_code,
//             "Inventory"
//           );
//         } catch (err) {
//           await t.rollback();
//           return res.status(400).json({ success: false, message: err.message });
//         }

//         // Debit COGS
//         ledgerEntries.push({
//           transaction_date: saleDate,
//           account_code: cogsAccount.head,
//           account_subhead: cogsAccount.subhead || 0,
//           dr: cogsAmount,
//           cr: 0,
//           account_description: cogsAccount.description,
//           transaction_description: `COGS - ${saleRef}`,
//           reference_number: saleRef,
//           purpose_of_payment: "COGS",
//           payee: customer.fullname,
//           mode_of_payment: modeOfPayment,
//           created_by,
//           facility_id: facilityId,
//           status: "posted",
//           type: "expenses",
//           transaction_ref: `${transactionRef}-COGS-${sale.id}`,
//         });

//         // Credit Inventory
//         ledgerEntries.push({
//           transaction_date: saleDate,
//           account_code: inventoryAccount.head,
//           account_subhead: inventoryAccount.subhead || 0,
//           dr: 0,
//           cr: cogsAmount,
//           account_description: inventoryAccount.description,
//           transaction_description: `Inventory Reduction - ${saleRef}`,
//           reference_number: saleRef,
//           purpose_of_payment: "Inventory",
//           payee: customer.fullname,
//           mode_of_payment: modeOfPayment,
//           created_by,
//           facility_id: facilityId,
//           status: "posted",
//           type: "inventory",
//           transaction_ref: `${transactionRef}-INV-${sale.id}`,
//         });
//       }

//       // Store Entry
//       const store = await db.StoreEntry.create(
//         {
//           receive_date: saleDate,
//           reference_number: saleRef,
//           qty_in: 0,
//           qty_out: qty,
//           sale_no: saleRef,
//           cost_price: costPrice,
//           selling_price: price,
//           branch_name: "Sales",
//           inserted_by: created_by,
//           facilityId,
//           trn_number: saleRef,
//           item_category: product.category,
//           customer_code: customer_id,
//           customer_name: customer.fullname,
//           sales_type: "credit",
//           source: "Finished Good",
//           destination: "Customer",
//           status: "approved",
//           activation: "active",
//           product_id: productId,
//         },
//         { transaction: t }
//       );
//       storeEntries.push(store);
//     }

//     // -------------------------------------------------------------------------
//     // 6. CALCULATE NET AMOUNT (A/R Impact)
//     // -------------------------------------------------------------------------
//     const netAmount = subtotal - discount_amount + tax_amount;

//     if (netAmount <= 0) {
//       await t.rollback();
//       return res
//         .status(400)
//         .json({ success: false, message: "Net sale amount must be positive" });
//     }

//     // -------------------------------------------------------------------------
//     // 7. GET CUSTOMER BALANCE & DECIDE A/R vs ACCRUAL
//     // -------------------------------------------------------------------------
//     const previousBalance =
//       parseFloat(await getBalance(customer_id, facilityId)) || 0;
//     console.log(
//       await getBalance(customer_id, facilityId),
//       "===================>Previous balance"
//     );
//     // If customer has prepayment (positive balance), reduce it first
//     if (previousBalance > 0 && accrualAccount) {
//       const appliedToPrepayment = Math.min(previousBalance, netAmount);
//       const remainingToReceivable = netAmount - appliedToPrepayment;

//       // Reduce Accrual (Credit Accrual, Debit A/R indirectly via net)
//       if (appliedToPrepayment > 0) {
//         ledgerEntries.push({
//           transaction_date: saleDate,
//           account_code: accrualAccount.head,
//           account_subhead: accrualAccount.subhead || 0,
//           dr: appliedToPrepayment,
//           cr: 0,
//           account_description: accrualAccount.description,
//           transaction_description: `Prepayment Applied - ${saleRef}`,
//           reference_number: saleRef,
//           purpose_of_payment: "Prepayment Utilization",
//           payee: customer.fullname,
//           mode_of_payment: modeOfPayment,
//           created_by,
//           facility_id: facilityId,
//           status: "posted",
//           type: "accrued",
//           transaction_ref: `${transactionRef}-PREPAY`,
//         });

//         await db.CustomerEntry.create(
//           {
//             customerNo: customer.customerNo,
//             description: `Prepayment Applied - ${saleRef}`,
//             qty_in: 0,
//             qty_out: 1,
//             link_id: 0,
//             bank_account_id: 0,
//             cost: appliedToPrepayment,
//             facilityId,
//             mode_of_payment: modeOfPayment,
//             receiptNo: saleRef,

//             created_by,
//           },
//           { transaction: t }
//         );
//       }

//       // Remaining goes to A/R
//       if (remainingToReceivable > 0) {
//         ledgerEntries.push({
//           transaction_date: saleDate,
//           account_code: receivableAccount.head,
//           account_subhead: receivableAccount.subhead || 0,
//           dr: remainingToReceivable,
//           cr: 0,
//           account_description: receivableAccount.description,
//           transaction_description: `Credit Sale - A/R - ${saleRef}`,
//           reference_number: saleRef,
//           purpose_of_payment: "Credit Sale",
//           payee: customer.fullname,
//           mode_of_payment: modeOfPayment,
//           created_by,
//           facility_id: facilityId,
//           status: "posted",
//           type: "receivable",
//           transaction_ref: `${transactionRef}-AR`,
//         });
//       }
//     } else {
//       // Normal case: full amount to A/R
//       ledgerEntries.push({
//         transaction_date: saleDate,
//         account_code: receivableAccount.head,
//         account_subhead: receivableAccount.subhead || 0,
//         dr: netAmount,
//         cr: 0,
//         account_description: receivableAccount.description,
//         transaction_description: `Credit Sale - ${saleRef}`,
//         reference_number: saleRef,
//         purpose_of_payment: "Credit Sale",
//         payee: customer.fullname,
//         mode_of_payment: modeOfPayment,
//         created_by,
//         facility_id: facilityId,
//         status: "posted",
//         type: "receivable",
//         transaction_ref: `${transactionRef}-AR`,
//       });
//     }

//     // -------------------------------------------------------------------------
//     // 8. DISCOUNT & TAX ENTRIES
//     // -------------------------------------------------------------------------
//     if (discount_amount > 0 && discountAccount) {
//       ledgerEntries.push({
//         transaction_date: saleDate,
//         account_code: discountAccount.head,
//         account_subhead: discountAccount.subhead || 0,
//         dr: discount_amount,
//         cr: 0,
//         account_description: discountAccount.description,
//         transaction_description: `Sales Discount - ${saleRef}`,
//         reference_number: saleRef,
//         purpose_of_payment: "Sales Discount",
//         payee: customer.fullname,
//         mode_of_payment: modeOfPayment,
//         created_by,
//         facility_id: facilityId,
//         status: "posted",
//         type: "expenses",
//         transaction_ref: `${transactionRef}-DISC`,
//       });

//       await db.CustomerEntry.create(
//         {
//           customerNo: customer.customerNo,
//           description: `${discount_info.discount_name || "Discount"} (${
//             discount_info.value
//           }${discount_info.discount_type})`,
//           qty_in: 1,
//           qty_out: 0,
//           cost: discount_amount,
//           bank_account_id: 0,
//           receiptNo: saleRef,
//           facilityId,
//           created_by,
//           type: "discount",
//           link_id: discount_info?.discount_id,
//           mode_of_payment: modeOfPayment,
//         },
//         { transaction: t }
//       );
//     }

//     if (tax_amount > 0 && taxes.length > 0) {
//       for (const tax of taxes) {
//         const taxRecord = await db.Tax.findOne({
//           where: { id: tax.id, facilityId },
//         });
//         if (!taxRecord || !taxRecord.account_sub_head) {
//           await t.rollback();
//           return res
//             .status(400)
//             .json({ success: false, message: "Invalid tax config" });
//         }

//         const taxAccount = await db.Account.findOne({
//           where: { head: taxRecord.account_sub_head, facilityId },
//         });
//         if (!taxAccount) {
//           await t.rollback();
//           return res
//             .status(404)
//             .json({ success: false, message: "Tax account not found" });
//         }

//         ledgerEntries.push({
//           transaction_date: saleDate,
//           account_code: taxAccount.head,
//           account_subhead: taxAccount.subhead || 0,
//           dr: 0,
//           cr: tax.amount || tax_amount,
//           account_description: taxAccount.description,
//           transaction_description: `Output Tax - ${saleRef}`,
//           reference_number: saleRef,
//           purpose_of_payment: "Sales Tax",
//           payee: customer.fullname,
//           mode_of_payment: modeOfPayment,
//           created_by,
//           facility_id: facilityId,
//           status: "posted",
//           type: "tax",
//           transaction_ref: `${transactionRef}-TAX-${tax.id}`,
//         });

//         await db.CustomerEntry.create(
//           {
//             customerNo: customer.customerNo,
//             description: `${tax.description} (${tax.rate}${tax.rate_type})`,
//             qty_in: 0,
//             qty_out: 1,
//             cost: tax.amount,
//             bank_account_id: 0,
//             created_by,
//             receiptNo: saleRef,
//             facilityId,
//             type: "tax",
//             link_id: tax.id,
//             mode_of_payment: modeOfPayment,
//           },
//           { transaction: t }
//         );
//       }
//     }

//     // -------------------------------------------------------------------------
//     // 9. SAVE ALL LEDGER ENTRIES
//     // -------------------------------------------------------------------------
//     for (const entry of ledgerEntries) {
//       await db.GeneralLedger.create(entry, { transaction: t });
//     }

//     await t.commit();

//     // -------------------------------------------------------------------------
//     // 10. SUCCESS RESPONSE
//     // -------------------------------------------------------------------------
//     return res.status(200).json({
//       success: true,
//       message: "Credit sale processed successfully",
//       sale_code: saleRef,
//       net_amount: netAmount,
//       applied_to_prepayment:
//         previousBalance > 0 ? Math.min(previousBalance, netAmount) : 0,
//       subtotal,
//       discount: discount_amount,
//       tax: tax_amount,
//     });
//   } catch (err) {
//     console.error("createSale error:", {
//       message: err.message,
//       stack: err.stack,
//       body: req.body,
//       saleRef,
//     });
//     await t.rollback();
//     return res.status(500).json({
//       success: false,
//       message: "Error processing credit sale",
//       error: process.env.NODE_ENV === "development" ? err.message : undefined,
//     });
//   }
// };

// At the top with other imports
// const { calculateValuation } = require("../utils/valuation"); // adjust path as needed
export const calculateValuation = async (
  product_id,
  facility_id,
  qty_out,
  valuation_method
) => {
  try {
    // --- VALIDATION ---
    if (!product_id || !facility_id || !qty_out || !valuation_method) {
      return { totalCost: 0, avgCost: 0, error: "Missing required fields" };
    }

    // ================================
    // STEP 1: GET STORE LAYERS (SQL)
    // ================================
    // For FIFO: order ASC
    // For LIFO: order DESC
    const order = valuation_method === "LIFO" ? "DESC" : "ASC";

    const [layersRaw] = await db.sequelize.query(
      `
      SELECT
        (qty_in - qty_out) AS qty,
        cost_price AS cost
      FROM store_entries
      WHERE product_id = :product_id
        AND facilityId = :facility_id
        AND (qty_in - qty_out) > 0
      ORDER BY createdAt ${order}
      `,
      {
        replacements: { product_id, facility_id },
      }
    );

    let layers = layersRaw.map((x) => ({
      qty: Number(x.qty),
      cost: Number(x.cost),
    }));

    if (layers.length === 0) {
      return { totalCost: 0, avgCost: 0, error: "No inventory available" };
    }

    // ================================
    // STEP 2: VALUATION METHODS
    // ================================

    function fifoValuation(layers, qtyOut) {
      let remaining = qtyOut;
      let totalCost = 0;

      for (let layer of layers) {
        if (remaining <= 0) break;
        const take = Math.min(layer.qty, remaining);
        totalCost += take * layer.cost;
        layer.qty -= take;
        remaining -= take;
      }

      return { totalCost, updatedLayers: layers };
    }

    function lifoValuation(layers, qtyOut) {
      let remaining = qtyOut;
      let totalCost = 0;

      for (let i = layers.length - 1; i >= 0; i--) {
        if (remaining <= 0) break;
        const layer = layers[i];
        const take = Math.min(layer.qty, remaining);
        totalCost += take * layer.cost;
        layer.qty -= take;
        remaining -= take;
      }

      return { totalCost, updatedLayers: layers };
    }

    function weightedAverageValuation(layers, qtyOut) {
      let totalQty = 0;
      let totalValue = 0;

      layers.forEach((x) => {
        totalQty += x.qty;
        totalValue += x.qty * x.cost;
      });

      const avgCost = totalValue / totalQty;
      const totalCost = qtyOut * avgCost;

      return { totalCost, avgCost };
    }

    // ================================
    // STEP 3: APPLY THE METHOD
    // ================================

    let result;

    if (valuation_method === "FIFO") {
      result = fifoValuation(layers, qty_out);
    } else if (valuation_method === "LIFO") {
      result = lifoValuation(layers, qty_out);
    } else if (valuation_method === "WAC") {
      result = weightedAverageValuation(layers, qty_out);
    } else {
      return { totalCost: 0, avgCost: 0, error: "Invalid valuation method" };
    }

    // ================================
    // RESPONSE
    // ================================
    return { totalCost: result.totalCost, avgCost: result.avgCost };
  } catch (error) {
    console.log("valuation error:", error);
    return { totalCost: 0, avgCost: 0, error: error.message };
  }
};

/**
 * ============================================================================
 * CREDIT SALE CONTROLLER - PRODUCTION ERP SYSTEM
 * ============================================================================
 *
 * This controller handles mixed sales (goods + services) with:
 * - Item-by-item posting (each item = separate revenue entry)
 * - Inventory valuation (WAC/FIFO/LIFO)
 * - Inclusive/Exclusive VAT
 * - Multiple taxes (array support)
 * - Customer prepayments (advance balance)
 * - Discounts
 * - Credit sales (A/R)
 *
 * ACCOUNTING RULES:
 * 1. Goods: Dr COGS, Cr Inventory, Cr Revenue (net of VAT if inclusive)
 * 2. Services: Cr Service Revenue only (no COGS, no Inventory)
 * 3. Taxes: Each tax gets its own ledger entry
 * 4. Discount: Applied to subtotal, then VAT calculated
 * 5. Prepayment: Applied before A/R posting
 * 6. Ledger must always balance (Dr = Cr)
 * 7. Revenue, COGS, and inventory accounts come only from the product row
 *    (product.sku as product code). One GL line per cart line — no merging.
 *    Each product can have a different revenue_account (e.g. 40128 vs 40129);
 *    credits are posted separately per line to that product’s revenue account.
 * 8. A/R and customer advance use only the customer’s receivable_code /
 *    receivable_accural_code (no request/business fallbacks).
 * ============================================================================
 */
exports.createSale = async (req, res) => {
  const t = await db.sequelize.transaction();
  let saleRef, saleDate;
  console.log(req.body, "=============> req.body");
  try {
    const {
      customer_id,
      items = [],
      discount_amount: discountAmountRaw = 0,
      discount_info = {},
      pro_bono_code,
      tax_amount = 0,
      total_amount = null,
      txn_type = "Credit Sale",
      modeOfPayment,
      payment_modes = [],
      accountHead,
      bankAccount,
      cheque_number,
      payment_splits = [],
      facilityId,
      created_by,
      receivable_code,
      receivable_accural_code,
      cost_of_sale,
      sale_revenue_code,
      finished_goods_code,
      inventory_account,
      taxes: taxesRaw = [],
      transaction_date,
      saleDate: saleDateFromClient,
      sale_branch_id = 0,
      apply_prepayment = false,
      amountPaid: amountPaidFromClient = 0,
      defer_payment = false,
      assigned_cashier_id = null,
      assigned_cashier_name = null,
      cashier_user_id = null,
      cashier_name = null,
    } = req.body;

    let discount_amount =
      Number(String(discountAmountRaw ?? "").replace(/,/g, "")) ||
      (typeof req.body.discount === "number" ||
      typeof req.body.discount === "string"
        ? Number(String(req.body.discount).replace(/,/g, "")) || 0
        : 0);

    console.log(req.body, "=============> req.body");

    /** Drop duplicate tax ids; if inclusive+exclusive Output VAT clones share a rate, keep exclusive. */
    const normalizeSaleTaxes = (taxList) => {
      if (!Array.isArray(taxList) || !taxList.length) return [];
      const byId = new Map();
      taxList.forEach((tax, idx) => {
        const id = tax?.id ?? tax?.tax_id;
        const key = id != null ? String(id) : `anon-${idx}`;
        if (!byId.has(key)) byId.set(key, tax);
      });
      let list = Array.from(byId.values());

      const isOutputVat = (t) => {
        const d = String(t?.description || t?.name || "").toLowerCase();
        return d.includes("vat");
      };
      const isExclusiveTax = (t) => {
        const inc = String(t?.inclusive_type || "").toLowerCase();
        const typ = String(t?.tax_type || "").toLowerCase();
        if (inc === "exclusive") return true;
        if (inc === "inclusive") return false;
        return typ === "exclusive";
      };

      const outputVat = list.filter(isOutputVat);
      if (outputVat.length > 1) {
        const byRate = new Map();
        for (const t of outputVat) {
          const rate = String(Number(t.rate) || 0);
          if (!byRate.has(rate)) byRate.set(rate, []);
          byRate.get(rate).push(t);
        }
        const dropIds = new Set();
        for (const group of byRate.values()) {
          if (group.length < 2) continue;
          const keep =
            group.find((t) => isExclusiveTax(t)) || group[0];
          const keepId = String(keep.id ?? keep.tax_id);
          for (const t of group) {
            const tid = String(t.id ?? t.tax_id);
            if (tid !== keepId) dropIds.add(tid);
          }
        }
        if (dropIds.size) {
          console.warn(
            "createSale: dropping duplicate Output VAT variants",
            [...dropIds],
          );
          list = list.filter(
            (t) => !dropIds.has(String(t.id ?? t.tax_id)),
          );
        }
      }
      return list;
    };

    const taxes = normalizeSaleTaxes(taxesRaw);

    const isCashSale = txn_type === "Cash Sale";
    const isCreditSale = txn_type === "Credit Sale";
    /** Paid invoices go to cashier — do not settle cash/bank on create. */
    const deferPaymentToCashier = Boolean(defer_payment) || isCashSale;

    // ===================================================================
    // VALIDATION
    // ===================================================================
    if (
      !customer_id ||
      !items.length ||
      !facilityId ||
      !created_by ||
      (!isCreditSale && !isCashSale)
    ) {
      await t.rollback();
      return res
        .status(400)
        .json({ success: false, message: "Invalid request data" });
    }

    // Normalize / validate cash payment mode + resolve debit (cash/bank) account
    let cashBankAccount = null;
    let resolvedBankAccountId = "";
    let cashModeOfPayment = "CREDIT";
    const salePurpose = isCashSale ? "Cash Sale" : "Credit Sale";
    /** @type {{ mode: string, amount: number, account: any, bankAccountId: string }[]} */
    let resolvedPaymentSplits = [];

    if (isCashSale) {
      const rawSplits = Array.isArray(payment_splits)
        ? payment_splits.filter((s) => s && Number(s.amount) > 0)
        : [];

      // Capture intended payment mode for Sales Management → Cashier.
      // Settlement happens when the cashier confirms, not on invoice create.
      if (deferPaymentToCashier) {
        const rawMode = String(modeOfPayment || "")
          .toLowerCase()
          .trim();
        if (
          rawMode === "credit_split" ||
          rawMode === "credit+cash+transfer" ||
          rawMode === "credit + cash + transfer" ||
          rawMode === "credit_cash_transfer"
        ) {
          cashModeOfPayment = "credit_split";
        } else if (rawMode === "split" || rawMode === "both") {
          cashModeOfPayment = "split";
        } else if (
          rawMode === "bank" ||
          rawMode === "bank transfer" ||
          rawMode === "transfer"
        ) {
          cashModeOfPayment = "bank";
        } else {
          cashModeOfPayment = "cash";
        }
        resolvedPaymentSplits = [];
        cashBankAccount = null;
        resolvedBankAccountId = "";
      } else {
      const resolvePaymentAccount = async (mode, splitAccountHead, splitBank) => {
        let codeData = null;
        let bankId = "";
        if (mode === "cash") {
          const head = splitAccountHead?.head || accountHead?.head;
          codeData = head ? { head } : null;
          bankId = head || "";
        } else {
          const bank = splitBank || bankAccount;
          if (!bank?.id) {
            throw new Error("Bank account is required for transfer payments");
          }
          const getBankAccount = await db.bank_account.findOne({
            where: { id: bank.id, facilityId, status: "active" },
          });
          if (!getBankAccount) {
            throw new Error("Bank account not found or inactive");
          }
          codeData = { head: getBankAccount.head };
          bankId = String(bank.id);
        }
        if (!codeData?.head) {
          throw new Error(
            mode === "cash"
              ? "Cash account head is required"
              : "Bank account head is required",
          );
        }
        const acct = await db.AccountCategory.findOne({
          where: { code: codeData.head, facility_id: facilityId },
        });
        if (!acct) {
          throw new Error(`Cash/Bank account not found: ${codeData.head}`);
        }
        return { account: acct, bankAccountId: bankId };
      };

      try {
        if (rawSplits.length > 0) {
          cashModeOfPayment = rawSplits.length > 1 ? "split" : rawSplits[0].mode;
          for (const split of rawSplits) {
            const modeRaw = String(split.mode || "")
              .toLowerCase()
              .trim();
            const mode =
              modeRaw === "cash" || modeRaw === "c"
                ? "cash"
                : modeRaw === "bank" ||
                    modeRaw === "transfer" ||
                    modeRaw === "bank transfer"
                  ? "bank"
                  : null;
            if (!mode) {
              await t.rollback();
              return res.status(400).json({
                success: false,
                message: "Each payment split must be cash or bank/transfer",
              });
            }
            const resolved = await resolvePaymentAccount(
              mode,
              split.accountHead,
              split.bankAccount,
            );
            resolvedPaymentSplits.push({
              mode,
              amount: Number(split.amount) || 0,
              account: resolved.account,
              bankAccountId: resolved.bankAccountId,
            });
          }
          cashBankAccount = resolvedPaymentSplits[0]?.account || null;
          resolvedBankAccountId =
            resolvedPaymentSplits.find((s) => s.mode === "bank")
              ?.bankAccountId ||
            resolvedPaymentSplits[0]?.bankAccountId ||
            "";
        } else {
          const rawMode = String(modeOfPayment || "")
            .toLowerCase()
            .trim();
          if (rawMode === "cash" || rawMode === "c") {
            cashModeOfPayment = "cash";
          } else if (
            rawMode === "bank" ||
            rawMode === "bank transfer" ||
            rawMode === "transfer"
          ) {
            cashModeOfPayment = "bank";
          } else if (rawMode === "cheque" || rawMode === "check") {
            cashModeOfPayment = "cheque";
          } else if (rawMode === "split") {
            await t.rollback();
            return res.status(400).json({
              success: false,
              message: "Split payment requires payment_splits with amounts",
            });
          } else {
            await t.rollback();
            return res.status(400).json({
              success: false,
              message:
                "Cash Sale requires modeOfPayment of cash, bank, cheque, or payment_splits",
            });
          }

          if (cashModeOfPayment === "cheque" && !String(cheque_number || "").trim()) {
            await t.rollback();
            return res.status(400).json({
              success: false,
              message: "Cheque number is required for cheque payments",
            });
          }

          const resolved = await resolvePaymentAccount(
            cashModeOfPayment === "cheque" ? "bank" : cashModeOfPayment,
            accountHead,
            bankAccount,
          );
          cashBankAccount = resolved.account;
          resolvedBankAccountId = resolved.bankAccountId;
          resolvedPaymentSplits = [
            {
              mode: cashModeOfPayment === "cheque" ? "cheque" : cashModeOfPayment,
              amount: 0, // filled later with amountToAR
              account: resolved.account,
              bankAccountId: resolved.bankAccountId,
            },
          ];
        }
      } catch (err) {
        await t.rollback();
        return res.status(400).json({
          success: false,
          message: err.message || "Invalid payment accounts",
        });
      }
      } // end !deferPaymentToCashier
    }

    saleDate = transaction_date || saleDateFromClient
      ? moment(transaction_date || saleDateFromClient).format("YYYY-MM-DD")
      : moment().format("YYYY-MM-DD");
    saleRef = `INV-${await getAndUpdateNumber("sale", facilityId)}`;

    // branchId comes directly from the frontend (integer)
    let saleBranchId = parseInt(sale_branch_id, 10) || 0;
    if (!saleBranchId && Array.isArray(items) && items.length > 0) {
      for (const line of items) {
        const bid = parseInt(line.branchId ?? line.branch_id, 10);
        if (Number.isFinite(bid) && bid > 0) {
          saleBranchId = bid;
          break;
        }
      }
    }

    // ===================================================================
    // GET BUSINESS VALUATION METHOD AND VAT POLICY
    // ===================================================================
    const business = await db.business.findOne({
      where: { id: facilityId },
      attributes: [
        "inv_ev_m",
        "vat_policy",
        "allow_sales_without_stock",
        "vat_account_code",
      ],
      raw: true,
    });

    // ===================================================================
    // CUSTOMER & ACCOUNTS SETUP
    // ===================================================================
    const customer = await Customer.findOne({
      where: { customerNo: customer_id, facilityId },
          });
    if (!customer) {
      await t.rollback();
      return res
        .status(404)
        .json({ success: false, message: "Customer not found" });
    }

    // Credit / deposit coverage on create — skipped when cash or transfer is also selected.
    {
      const modes = (
        Array.isArray(payment_modes) ? payment_modes : []
      ).map((m) => String(m || "").toLowerCase().trim());
      const rawMode = String(modeOfPayment || "").toLowerCase();
      const hasCash =
        modes.includes("cash") ||
        rawMode === "cash" ||
        rawMode === "split" ||
        rawMode === "credit_split";
      const hasTransfer =
        modes.includes("transfer") ||
        rawMode === "transfer" ||
        rawMode === "bank" ||
        rawMode === "split" ||
        rawMode === "credit_split";
      const hasCredit =
        modes.includes("credit") ||
        rawMode === "credit" ||
        rawMode === "credit_split";
      const hasDeposit =
        modes.includes("deposit") ||
        apply_prepayment === true ||
        apply_prepayment === "true" ||
        rawMode === "deposit";

      if (isWalkInCustomer(customer) && hasCredit) {
        await t.rollback();
        return res.status(400).json({
          success: false,
          message: "Walk-in customers cannot be invoiced on credit.",
        });
      }

      if ((hasCredit || hasDeposit) && !hasCash && !hasTransfer) {
        const bals = await getCustomerLedgerBalances(facilityId, customer_id);
        const invoiceTotal = Number(total_amount);
        const due = Number.isFinite(invoiceTotal) && invoiceTotal > 0
          ? invoiceTotal
          : 0;
        const limit = parseFloat(customer.credit_limit) || 0;
        const unlimitedCredit = !(limit > 0);
        const creditLeft = unlimitedCredit
          ? Infinity
          : Math.max(0, limit - bals.receivables);
        const deposit = bals.deposit;
        const over = (cap) => due > cap + 0.009;

        let coverageMessage = null;
        if (hasCredit && hasDeposit) {
          if (!unlimitedCredit && over(creditLeft + deposit)) {
            coverageMessage = `Invoice (${due.toFixed(2)}) exceeds credit available (${creditLeft.toFixed(2)}) plus deposit (${deposit.toFixed(2)}).`;
          }
        } else if (hasCredit && !unlimitedCredit && over(creditLeft)) {
          coverageMessage = `Invoice (${due.toFixed(2)}) exceeds credit available (${creditLeft.toFixed(2)}).`;
        } else if (hasDeposit && !hasCredit && over(deposit)) {
          coverageMessage = `Invoice (${due.toFixed(2)}) exceeds deposit available (${deposit.toFixed(2)}).`;
        }
        if (coverageMessage) {
          await t.rollback();
          return res.status(400).json({
            success: false,
            message: coverageMessage,
          });
        }
      }
    }

    // ===================================================================
    // STOP SALES + SALES TARGET (early, before ledger / stock work)
    // Aggregates qty by SKU + warehouse so multi-line carts cannot bypass limits.
    // ===================================================================
    {
      const earlyQtyByKey = new Map();
      for (const itm of items) {
        const sku = itm.product_id || itm.sku;
        const qty = Number(itm.quantity || itm.qty || 0);
        if (!sku || !(qty > 0)) continue;
        const bid =
          parseInt(itm.branchId ?? itm.branch_id ?? saleBranchId, 10) ||
          saleBranchId ||
          0;
        const key = `${sku}|${bid}`;
        earlyQtyByKey.set(key, (earlyQtyByKey.get(key) || 0) + qty);
      }
      for (const [key, qty] of earlyQtyByKey.entries()) {
        const [sku, branchPart] = key.split("|");
        const branchId = parseInt(branchPart, 10) || 0;
        const product = await db.Product.findOne({
          where: { sku, facility_id: facilityId },
          attributes: [
            "id",
            "sku",
            "name",
            "daily_sales_limit",
            "weekly_sales_limit",
            "monthly_sales_limit",
            "sales_stopped",
          ],
          transaction: t,
        });
        if (!product) {
          await t.rollback();
          return res.status(400).json({
            success: false,
            message: `Product not found: ${sku}`,
          });
        }
        try {
          await assertProductSalesLimits({
            product,
            sku,
            facilityId,
            qty,
            saleDate,
            transaction: t,
            branchId,
          });
        } catch (limitErr) {
          await t.rollback();
          return res.status(400).json({
            success: false,
            message: limitErr.message || "Sales limit exceeded",
          });
        }
      }
    }

    if (!customer.receivable_code) {
      await t.rollback();
      return res.status(400).json({
        success: false,
        message: `Customer ${customer.customerNo} has no receivable_code (A/R account). Set it on the customer record.`,
      });
    }

    async function getAccountSafe(head, type) {
      if (!head) throw new Error(`${type} account head missing`);
      const acc = await db.AccountCategory.findOne({
        where: { code: head, facility_id: facilityId },
      });
      if (!acc) throw new Error(`${type} account not found: ${head}`);
      return acc;
    }

    const receivableAccount = await getAccountSafe(
      customer.receivable_code,
      "Receivable"
    );

    let accrualAccount = null;
    if (customer.receivable_accural_code) {
      accrualAccount = await getAccountSafe(
        customer.receivable_accural_code,
        "Accrual"
      );
    }

    let discountAccount = null;
    if (discount_amount > 0 && discount_info?.discount_id) {
      const disc = await db.Discount.findOne({
        where: { discount_id: discount_info.discount_id, facilityId },
      });
      if (disc?.discount_account_head) {
        discountAccount = await getAccountSafe(
          disc.discount_account_head,
          "Discount"
        );
      }
    }

    // ===================================================================
    // GET PRO-BONO EXPENSE ACCOUNT
    // ===================================================================
    let proBonoAccount = null;
    if (pro_bono_code) {
      proBonoAccount = await getAccountSafe(pro_bono_code, "Pro-bono Expense");
    }

    // ===================================================================
    // PRE-FETCH TAX ACCOUNTS
    // ===================================================================
    const taxAccounts = [];
    if (taxes && taxes.length > 0) {
      const defaultVatHead = String(business?.vat_account_code || "").trim();
      for (const tax of taxes) {
        const taxHead =
          tax.account_head ||
          tax.account_sub_head ||
          tax.head ||
          tax.tax_account_head ||
          defaultVatHead;

        if (!taxHead) {
          console.warn(
            `Tax "${tax.name || "Unknown"}" is missing account_head. Skipping.`,
            tax
          );
          continue;
        }

        const taxAcc = await db.AccountCategory.findOne({
          where: { code: taxHead, facility_id: facilityId },
        });

        if (!taxAcc) {
          const errMsg = `Tax code "${taxHead}" does not exist in Chart of Accounts. Tax: "${tax.name || "Unknown"}". Please create account ${taxHead} in Account Category or update the tax configuration.`;
          console.error(errMsg);
          throw new Error(errMsg);
        }

        taxAccounts.push({ tax, account: taxAcc });
      }
    }

    // ===================================================================
    // INITIALIZE VARIABLES
    // ===================================================================
    const ledgerEntries = [];
    const itemDetails = [];
    let subtotal = 0;
    let totalCOGS = 0;
    let totalProBonoValue = 0;
    let valuationMethod = "Weighted Average Cost";

    // ===================================================================
    // HELPER: CREATE LEDGER ENTRY
    // ===================================================================
    function createLedgerEntry(account, dr, cr, type, desc, transaction_ref, extras = {}) {
      return {
        transaction_date: saleDate,
        account_code: account.code,
        account_subhead: account.parent_code || account.code,
        dr: Number(dr.toFixed(2)),
        cr: Number(cr.toFixed(2)),
        account_description: account.description,
        transaction_description: desc || account.description,
        bank_account_id: extras.bank_account_id ?? "",
        reference_number: saleRef,
        purpose_of_payment: extras.purpose_of_payment ?? salePurpose,
        payee: `${customer.customerNo} — ${customer.fullname || ""}`.trim(),
        mode_of_payment:
          extras.mode_of_payment ??
          (isCashSale ? cashModeOfPayment : "CREDIT"),
        created_by: created_by,
        facility_id: facilityId,
        branch_id: saleBranchId || null,
        status: "posted",
        type,
        transaction_ref: transaction_ref || "",
      };
    }

    /** Product code for GL text — always the product’s sku from DB (no client item_code). */
    function productCodeLabel(product, sku) {
      const code = String(product?.sku ?? "").trim();
      if (code) return code;
      const fallback = String(sku ?? "").trim();
      if (fallback) return fallback;
      throw new Error("Product code (sku) is missing on the product record");
    }

    const customerCodeLabel = customer.customerNo;

    /** Enforce chart codes from the product tied to this item code (no request fallbacks). */
    function assertRevenueAccountForItem(product, label) {
      if (!product.revenue_account) {
        throw new Error(
          `Revenue account is not configured for item code ${label}. Set revenue_account on the product.`
        );
      }
    }

    function assertGoodsCogsInventoryForItem(product, label, isProBono) {
      if (!product.inventory_account) {
        throw new Error(
          `Inventory account is not configured for item code ${label}. Set inventory_account on the product.`
        );
      }
      if (!isProBono && !product.cogs_head) {
        throw new Error(
          `Cost of sales account (cogs_head) is not configured for item code ${label}. Set cogs_head on the product.`
        );
      }
    }

    // ===================================================================
    // HELPER: CALCULATE NET AND VAT FOR INCLUSIVE VAT (PER ITEM)
    // ===================================================================
    function calculateItemNetAndVATFullAmount(grossAmount, taxes, vatPolicy) {
      if (!taxes || taxes.length === 0) {
        return {
          netAmount: grossAmount,
          totalVAT: 0,
          taxBreakdown: [],
        };
      }

      // If vat_policy is "all", separate taxes by their individual inclusive_type
      let inclusiveTaxes = [];
      let exclusiveTaxes = [];

      if (vatPolicy === "all") {
        inclusiveTaxes = taxes.filter((tax) => {
          return tax.inclusive_type === "inclusive" ||
                 (tax.inclusive_type === undefined && tax.tax_type === "inclusive");
        });
        exclusiveTaxes = taxes.filter((tax) => {
          return tax.inclusive_type === "exclusive" ||
                 (tax.inclusive_type === undefined && tax.tax_type === "exclusive");
        });
      } else {
        // Use all taxes (they're all inclusive in this function)
        inclusiveTaxes = taxes;
      }

      // Calculate VAT from inclusive taxes only
      let netAmount = grossAmount;
      for (const tax of inclusiveTaxes) {
        const taxRate = (tax.rate || 0) / 100;
        if (taxRate > 0) {
          netAmount = netAmount / (1 + taxRate);
        }
      }

      const totalVAT = grossAmount - netAmount;

      let taxBreakdown = [];

      // Add inclusive tax breakdown
      if (inclusiveTaxes.length === 1) {
        const tax = inclusiveTaxes[0];
        taxBreakdown.push({ tax, amount: Number(totalVAT.toFixed(2)) });
      } else if (inclusiveTaxes.length > 1) {
        let totalRate = 0;
        for (const tax of inclusiveTaxes) {
          const taxRate = (tax.rate || 0) / 100;
          if (taxRate > 0) totalRate += taxRate;
        }
        if (totalRate > 0) {
          for (const tax of inclusiveTaxes) {
            const taxRate = (tax.rate || 0) / 100;
            if (taxRate > 0) {
              const taxAmount = (totalVAT * taxRate) / totalRate;
              taxBreakdown.push({ tax, amount: Number(taxAmount.toFixed(2)) });
            }
          }
        }
      }

      // Add exclusive tax breakdown (calculated on net amount)
      for (const tax of exclusiveTaxes) {
        const taxRate = (tax.rate || 0) / 100;
        if (taxRate > 0) {
          const taxAmount = netAmount * taxRate;
          taxBreakdown.push({ tax, amount: Number(taxAmount.toFixed(2)) });
        } else if (tax.amount) {
          taxBreakdown.push({ tax, amount: Number(parseFloat(tax.amount).toFixed(2)) });
        }
      }

      return {
        netAmount: Number(netAmount.toFixed(2)),
        totalVAT: Number(totalVAT.toFixed(2)),
        taxBreakdown,
      };
    }

    // ===================================================================
    // HELPER: CALCULATE EXCLUSIVE VAT (PER ITEM)
    // ===================================================================
    function calculateExclusiveVAT(amount, taxes, vatPolicy) {
      if (!taxes || taxes.length === 0) {
        return {
          netAmount: amount,
          totalVAT: 0,
          taxBreakdown: [],
        };
      }

      // If vat_policy is "all", separate taxes by their individual inclusive_type
      let inclusiveTaxes = [];
      let exclusiveTaxes = [];

      if (vatPolicy === "all") {
        inclusiveTaxes = taxes.filter((tax) => {
          return tax.inclusive_type === "inclusive" ||
                 (tax.inclusive_type === undefined && tax.tax_type === "inclusive");
        });
        exclusiveTaxes = taxes.filter((tax) => {
          return tax.inclusive_type === "exclusive" ||
                 (tax.inclusive_type === undefined && tax.tax_type === "exclusive");
        });
      } else {
        // Use all taxes (they're all exclusive in this function)
        exclusiveTaxes = taxes;
      }

      let totalVAT = 0;
      const taxBreakdown = [];

      // Calculate exclusive taxes on the amount
      for (const tax of exclusiveTaxes) {
        const taxRate = (tax.rate || 0) / 100;
        if (taxRate > 0) {
          const vatAmount = amount * taxRate;
          const vatValue = Number(vatAmount.toFixed(2));
          taxBreakdown.push({ tax, amount: vatValue });
          totalVAT += vatValue;
        } else if (tax.amount) {
          const vatValue = Number(parseFloat(tax.amount).toFixed(2));
          taxBreakdown.push({ tax, amount: vatValue });
          totalVAT += vatValue;
        }
      }

      // Calculate inclusive taxes (extract VAT from amount)
      if (inclusiveTaxes.length > 0) {
        let totalInclusiveRate = 0;
        for (const tax of inclusiveTaxes) {
          const taxRate = (tax.rate || 0) / 100;
          if (taxRate > 0) totalInclusiveRate += taxRate;
        }

        if (totalInclusiveRate > 0) {
          const netAmount = amount / (1 + totalInclusiveRate);
          const inclusiveVAT = amount - netAmount;

          // Distribute VAT proportionally among inclusive taxes
          for (const tax of inclusiveTaxes) {
            const taxRate = (tax.rate || 0) / 100;
            if (taxRate > 0) {
              const taxAmount = (inclusiveVAT * taxRate) / totalInclusiveRate;
              const vatValue = Number(taxAmount.toFixed(2));
              taxBreakdown.push({ tax, amount: vatValue });
              totalVAT += vatValue;
            }
          }
        }
      }

      return {
        netAmount: Number(amount.toFixed(2)),
        totalVAT: Number(totalVAT.toFixed(2)),
        taxBreakdown,
      };
    }

    // ===================================================================
    // HELPER: CALCULATE INVOICE-LEVEL VAT AFTER DISCOUNT
    // Ensures VAT is always based on (subtotal - discount_amount), and then
    // applies inclusive or exclusive logic (or mixed "all" policy).
    // This value is used for the invoice tax_amount and response tax field.
    // ===================================================================
    function calculateInvoiceVAT(subtotal, discount_amount, taxes, vatPolicy) {
      if (!taxes || taxes.length === 0) return 0;

      const taxableSubtotal = Math.max(subtotal - (discount_amount || 0), 0);

      let inclusiveTaxes = [];
      let exclusiveTaxes = [];

      if (vatPolicy === "all") {
        inclusiveTaxes = taxes.filter((tax) => {
          return (
            tax.inclusive_type === "inclusive" ||
            (tax.inclusive_type === undefined && tax.tax_type === "inclusive")
          );
        });
        exclusiveTaxes = taxes.filter((tax) => {
          return (
            tax.inclusive_type === "exclusive" ||
            (tax.inclusive_type === undefined && tax.tax_type === "exclusive")
          );
        });
      } else if (vatPolicy === "vat_inclusive") {
        inclusiveTaxes = taxes;
      } else {
        // vat_exclusive
        exclusiveTaxes = taxes;
      }

      // Sum percentage rates for inclusive / exclusive taxes
      let inclusiveRate = 0;
      let exclusiveRate = 0;

      for (const tax of inclusiveTaxes) {
        const rate = (tax.rate || 0) / 100;
        if (rate > 0) inclusiveRate += rate;
      }

      for (const tax of exclusiveTaxes) {
        const rate = (tax.rate || 0) / 100;
        if (rate > 0) exclusiveRate += rate;
      }

      let inclusiveVAT = 0;
      let exclusiveVAT = 0;

      // Inclusive: 37,000 already includes 7.5% → extract VAT = 37,000 - 37,000/1.075 = 2,581.40
      if (inclusiveRate > 0) {
        const netBase = taxableSubtotal / (1 + inclusiveRate);
        inclusiveVAT = taxableSubtotal - netBase;
      }

      // Exclusive: 7.5% added on 37,000 = 2,775.00

      // Exclusive VAT: applied on net base (after removing inclusive VAT portion, if any)
      if (exclusiveRate > 0) {
        const baseForExclusive =
          inclusiveRate > 0 ? taxableSubtotal - inclusiveVAT : taxableSubtotal;
        exclusiveVAT = baseForExclusive * exclusiveRate;
      }

      const totalVAT = inclusiveVAT + exclusiveVAT;
      return Number(totalVAT.toFixed(2));
    }

    // Returns invoice-level VAT breakdown (after discount) for ledger posting.
    function getInvoiceVATBreakdown(subtotal, discount_amount, taxes, vatPolicy) {
      if (!taxes || taxes.length === 0) return { totalVAT: 0, breakdown: [] };

      const taxableBase = Math.max(subtotal - (discount_amount || 0), 0);
      const breakdown = [];
      let inclusiveTaxes = [];
      let exclusiveTaxes = [];

      if (vatPolicy === "all") {
        inclusiveTaxes = taxes.filter((t) =>
          t.inclusive_type === "inclusive" ||
          (t.inclusive_type === undefined && t.tax_type === "inclusive")
        );
        exclusiveTaxes = taxes.filter((t) =>
          t.inclusive_type === "exclusive" ||
          (t.inclusive_type === undefined && t.tax_type === "exclusive")
        );
      } else if (vatPolicy === "vat_inclusive") {
        inclusiveTaxes = taxes;
      } else {
        exclusiveTaxes = taxes;
      }

      let inclusiveRate = 0;
      let exclusiveRate = 0;
      for (const t of inclusiveTaxes) inclusiveRate += (t.rate || 0) / 100;
      for (const t of exclusiveTaxes) exclusiveRate += (t.rate || 0) / 100;

      let inclusiveVAT = 0;
      if (inclusiveRate > 0 && taxableBase > 0) {
        const netBase = taxableBase / (1 + inclusiveRate);
        inclusiveVAT = taxableBase - netBase;
        if (inclusiveTaxes.length === 1) {
          breakdown.push({ tax: inclusiveTaxes[0], amount: Number(inclusiveVAT.toFixed(2)) });
        } else {
          for (const t of inclusiveTaxes) {
            const r = (t.rate || 0) / 100;
            if (r > 0) breakdown.push({ tax: t, amount: Number((inclusiveVAT * (r / inclusiveRate)).toFixed(2)) });
          }
        }
      }

      const baseForExclusive = inclusiveRate > 0 ? taxableBase - inclusiveVAT : taxableBase;
      let exclusiveVAT = 0;
      if (exclusiveRate > 0 && baseForExclusive > 0) {
        exclusiveVAT = baseForExclusive * exclusiveRate;
        if (exclusiveTaxes.length === 1) {
          breakdown.push({ tax: exclusiveTaxes[0], amount: Number(exclusiveVAT.toFixed(2)) });
        } else {
          for (const t of exclusiveTaxes) {
            const r = (t.rate || 0) / 100;
            if (r > 0) breakdown.push({ tax: t, amount: Number((exclusiveVAT * (r / exclusiveRate)).toFixed(2)) });
          }
        }
      }

      const totalVAT = inclusiveVAT + exclusiveVAT;
      return { totalVAT: Number(totalVAT.toFixed(2)), breakdown };
    }

    // ===================================================================
    // HELPER: ALLOCATE DISCOUNT PROPORTIONALLY
    // ===================================================================
    function allocateDiscount(itemAmount, totalAmount, totalDiscount) {
      if (totalAmount <= 0 || totalDiscount <= 0) return 0;
      const proportion = itemAmount / totalAmount;
      return Number((totalDiscount * proportion).toFixed(2));
    }

    // ===================================================================
    // HELPER: PROCESS GOODS ITEM
    // ===================================================================
    async function processGoodsItem(
      itm,
      product,
      grossAmount,
      itemDiscount,
      revenueAmount,
      qty,
      sku,
      isProBono
    ) {
      const pcode = productCodeLabel(product, sku);
      assertGoodsCogsInventoryForItem(product, pcode, isProBono);

      valuationMethod = business?.inv_ev_m || "Weighted Average Cost";
      const methodKey =
        valuationMethod === "Weighted Average Cost" ? "WAC" : valuationMethod;

      const allowSalesWithoutStock = business?.allow_sales_without_stock || false;

      const valuationResult = await getCurrentUnitCostWithMultiplier(
        sku,
        facilityId,
        methodKey,
        itm.multiplier_id
      );

      let unitCost = valuationResult?.calculatedCostPrice || 0;

      // If no cost price calculated and allow_sales_without_stock is enabled, use fallback
      if (unitCost <= 0) {
        if (allowSalesWithoutStock) {
          // Use product's cost_price as fallback when inventory is not available
          const productForCost = await db.Product.findOne({
            where: { sku: sku, facility_id: facilityId },
            attributes: ['cost_price'],
          });

          unitCost = parseFloat(productForCost?.cost_price || 0);

          // Never invent a placeholder cost of 1 — use 0 COGS if no cost exists
          if (unitCost <= 0) {
            unitCost = 0;
            console.log(
              `Warning: No inventory/cost for ${sku}. Using unit cost 0 (allow_sales_without_stock).`
            );
          } else {
            console.log(
              `Warning: No inventory available for ${sku}. Using product cost_price: ${unitCost.toFixed(2)}`
            );
          }
        } else {
        throw new Error(
          `Unable to calculate cost price for ${sku}. No inventory available.`
        );
        }
      }

      const cogsAmount = Number((unitCost * qty).toFixed(2));
      totalCOGS += cogsAmount;

      const inventoryAccount = await getAccountSafe(
        product.inventory_account,
        "Inventory"
      );
      const cogsAccount = !isProBono
        ? await getAccountSafe(product.cogs_head, "COGS")
        : null;

      if (isProBono) {
        // PRO-BONO: Dr Pro-bono Expense, Cr Inventory (NO COGS)
        if (!proBonoAccount) {
          throw new Error("Pro-bono expense account not configured");
        }

        ledgerEntries.push(
          createLedgerEntry(
            proBonoAccount,
            cogsAmount,
            0,
            "expenses",
            `Pro-bono service [${pcode}] – ${product.name}`,
            pcode
          )
        );

        ledgerEntries.push(
          createLedgerEntry(
            inventoryAccount,
            0,
            cogsAmount,
            "inventory",
            `Pro-bono inventory reduction [${pcode}] – ${product.name}`,
            pcode
          )
        );

        totalProBonoValue += cogsAmount;
      } else {
        // REGULAR SALE: Dr COGS, Cr Inventory — one pair per line (item code)
        ledgerEntries.push(
          createLedgerEntry(
            cogsAccount,
            cogsAmount,
            0,
            "expenses",
            `COGS [${pcode}] – ${product.name}`,
            pcode
          )
        );
        ledgerEntries.push(
          createLedgerEntry(
            inventoryAccount,
            0,
            cogsAmount,
            "inventory",
            `Inventory reduction [${pcode}] – ${product.name}`,
            pcode
          )
        );
      }

      // Create StoreEntry
      const sellingPrice = Number(itm.selling_price) || 0;
      const multiplierValue = itm.multiplier_id
        ? await db.product_multipliers.findOne({
            where: { id: itm.multiplier_id },
          })
        : null;

      let markUpValue = 1;
      if (unitCost > 0 && sellingPrice > 0) {
        const calculatedMarkUp = Number((sellingPrice / unitCost).toFixed(4));
        markUpValue = calculatedMarkUp > 0 ? calculatedMarkUp : 1;
      }

      const lineBranchId =
        parseInt(itm.branchId ?? itm.branch_id ?? saleBranchId, 10) ||
        saleBranchId ||
        0;

      await db.StoreEntry.create(
        {
          receive_date: saleDate,
          reference_number: saleRef,
          qty_in: 0,
          qty_out: qty,
          multiplier_id: multiplierValue
            ? multiplierValue.id
            : itm.multiplier_id,
          cost_price: unitCost,
          mark_up: markUpValue,
          selling_price: sellingPrice,
          // Store zone is always "for sales"; branchId tracks the physical branch.
          branch_name: "for sales",
          branchId: lineBranchId,
          inserted_by: created_by,
          facilityId,
          trn_number: saleRef,
          item_category: product.category,
          customer_code: customer_id,
          customer_name: customer.fullname,
          type: saleStoreEntryType({
            isProBono,
            isService: product.item_type === "Service",
          }),
          source: "for sales",
          destination: "sold",
          status: "approved",
          activation: "active",
          product_id: sku,
        },
        { transaction: t }
      );
    }

    // ===================================================================
    // HELPER: PROCESS SERVICE ITEM
    // ===================================================================
    async function processServiceItem(itm, product, revenueAmount, isProBono) {
      const qty = Number(itm.quantity);
      const sku = itm.product_id;
      const sellingPrice = Number(itm.selling_price) || 0;

      // Services: NO COGS, NO INVENTORY — record line on store_entries for reporting
      if (isProBono && proBonoAccount) {
        const fairMarketValue = sellingPrice * qty;
        totalProBonoValue += fairMarketValue;
      }

      const lineBranchId =
        parseInt(itm.branchId ?? itm.branch_id ?? saleBranchId, 10) ||
        saleBranchId ||
        0;

      await db.StoreEntry.create(
        {
          receive_date: saleDate,
          reference_number: saleRef,
          qty_in: 0,
          qty_out: qty,
          cost_price: 0,
          mark_up: 1,
          selling_price: sellingPrice,
          branch_name: "for sales",
          branchId: lineBranchId,
          inserted_by: created_by,
          facilityId,
          type: saleStoreEntryType({ isProBono, isService: true }),
          source: "for sales",
          destination: "sold",
          status: "approved",
          product_id: sku,
        },
        { transaction: t },
      );
    }

    // ===================================================================
    // FIRST PASS: CALCULATE SUBTOTAL AND VALIDATE ITEMS
    // ===================================================================
    // Aggregate qty by SKU + warehouse so multi-line carts cannot bypass limits
    const qtyBySku = new Map();
    const qtyBySkuBranch = new Map();
    const remainingSellableByKey = new Map();
    const assertedLimitKeys = new Set();
    for (const itm of items) {
      const sku = itm.product_id;
      const qty = Number(itm.quantity);
      if (!sku || !(qty > 0)) continue;
      qtyBySku.set(sku, (qtyBySku.get(sku) || 0) + qty);
      const bid =
        parseInt(itm.branchId ?? itm.branch_id ?? saleBranchId, 10) ||
        saleBranchId ||
        0;
      const key = `${sku}|${bid}`;
      qtyBySkuBranch.set(key, (qtyBySkuBranch.get(key) || 0) + qty);
    }
    const productBySku = new Map();

    for (const itm of items) {
      const qty = Number(itm.quantity);
      const price = Number(itm.selling_price);
      const sku = itm.product_id;

      const isProBono = itm.type === "Pro-bono" || itm.type === "pro-bono";

      if (!sku || qty <= 0) {
        throw new Error(`Invalid item: ${sku}`);
      }

      if (!isProBono && price <= 0) {
        throw new Error(`Invalid item: ${sku} - price must be greater than 0`);
      }

      let product = productBySku.get(sku);
      if (!product) {
        product = await db.Product.findOne({
          where: { sku, facility_id: facilityId },
          attributes: [
            "id",
            "sku",
            "name",
            "item_type",
            "category",
            "inventory_account",
            "cogs_head",
            "revenue_account",
            "taxable",
            "daily_sales_limit",
            "weekly_sales_limit",
            "monthly_sales_limit",
            "sales_stopped",
          ],
        });
        if (!product) throw new Error(`Product not found: ${sku}`);
        productBySku.set(sku, product);
      }

      const lineLimitBranchId =
        parseInt(itm.branchId ?? itm.branch_id ?? saleBranchId, 10) ||
        saleBranchId ||
        0;
      const limitKey = `${sku}|${lineLimitBranchId}`;
      if (!assertedLimitKeys.has(limitKey)) {
        assertedLimitKeys.add(limitKey);
        // Sales target / limit / stop — block even when stock remains (aggregated qty)
        await assertProductSalesLimits({
          product,
          sku,
          facilityId,
          qty: qtyBySkuBranch.get(limitKey) || qty,
          saleDate,
          transaction: t,
          branchId: lineLimitBranchId,
        });
      }

      // Check inventory for goods — branch total from store_entries (same as Goods List)
      if (["Finished Good", "Resalable", ""].includes(product.item_type)) {
        const allowSalesWithoutStock =
          business?.allow_sales_without_stock || false;

        const rawLineBranch = itm.branchId ?? itm.branch_id;
        const hasExplicitLineBranch =
          rawLineBranch != null &&
          String(rawLineBranch).trim() !== "" &&
          Number.isFinite(parseInt(String(rawLineBranch), 10)) &&
          parseInt(String(rawLineBranch), 10) > 0;

        let stockBranchId = hasExplicitLineBranch
          ? parseInt(String(rawLineBranch), 10)
          : parseInt(saleBranchId, 10) || 0;

        const stockKey = `${sku}|${stockBranchId}`;

        if (!remainingSellableByKey.has(stockKey)) {
          let currentBalance = await getSellableQtyAtBranch({
            sku,
            facilityId,
            branchId: stockBranchId,
            transaction: t,
          });

          // Sales are warehouse-bound: never pull stock from another store.
          const mayRetarget = false;

          if (
            !allowSalesWithoutStock &&
            currentBalance < qty &&
            mayRetarget
          ) {
            const alts = await listSellableBranchesForSku({
              sku,
              facilityId,
              transaction: t,
            });
            const fit = alts.find((a) => a.balance >= qty);
            if (fit && fit.branchId > 0) {
              stockBranchId = fit.branchId;
              currentBalance = fit.balance;
              itm.branchId = fit.branchId;
              itm.branch_id = fit.branchId;
            }
          }

          remainingSellableByKey.set(
            `${sku}|${stockBranchId}`,
            currentBalance,
          );
        }

        stockBranchId =
          parseInt(itm.branchId ?? itm.branch_id ?? stockBranchId, 10) ||
          stockBranchId;
        const resolvedKey = `${sku}|${stockBranchId}`;
        const available = remainingSellableByKey.get(resolvedKey) ?? 0;

        if (!allowSalesWithoutStock && available < qty) {
          const productLabel = (product.name || sku).trim();
          let branchHint =
            stockBranchId > 0 ? ` (branch id ${stockBranchId})` : "";
          try {
            const alts = await listSellableBranchesForSku({
              sku,
              facilityId,
              transaction: t,
            });
            if (alts.length) {
              const where = alts
                .slice(0, 3)
                .map(
                  (a) =>
                    `${a.branch_name || `branch ${a.branchId}`}: ${a.balance}`,
                )
                .join("; ");
              branchHint += `. Stock is at: ${where}`;
            }
          } catch (_) {
            /* ignore */
          }
          throw new Error(
            `Insufficient quantity for ${productLabel}${branchHint}. Available: ${available}, Requested: ${qty}`,
          );
        }
        remainingSellableByKey.set(resolvedKey, available - qty);
      }

      const lineTotal = qty * price;

      // Only add to subtotal if NOT Pro-bono
      if (!isProBono) {
        subtotal += lineTotal;
      }

      const isTaxable =
        !isProBono &&
        isProductTaxable(
          itm?.taxable != null && String(itm.taxable).trim() !== ""
            ? itm.taxable
            : product?.taxable,
        );

      itemDetails.push({
        item: itm,
        product,
        lineTotal,
        qty,
        price,
        sku,
        isProBono,
        isTaxable,
      });
    }

    if (discount_amount < 0) discount_amount = 0;
    if (discount_amount > subtotal + 0.009) {
      await t.rollback();
      return res.status(400).json({
        success: false,
        message: "Discount cannot be more than the invoice total.",
      });
    }
    const discountTypeHint = String(
      discount_info?.discount_type || discount_info?.type || "",
    ).toLowerCase();
    const catalogDiscountValue = parseFloat(discount_info?.value);
    if (
      (discountTypeHint.includes("percent") || discountTypeHint === "%") &&
      Number.isFinite(catalogDiscountValue) &&
      catalogDiscountValue > 100.009
    ) {
      await t.rollback();
      return res.status(400).json({
        success: false,
        message: "Discount cannot be more than 100%.",
      });
    }

    const goodsTaxableSubtotal = itemDetails.reduce(
      (sum, d) => sum + (d.isTaxable ? d.lineTotal : 0),
      0,
    );
    const taxableDiscountShare =
      subtotal > 0 && discount_amount > 0
        ? Number(
            ((discount_amount * goodsTaxableSubtotal) / subtotal).toFixed(2),
          )
        : 0;

    // ===================================================================
    // DETERMINE TAX TYPE FROM BUSINESS VAT POLICY
    // ===================================================================
    const vatPolicy = business?.vat_policy || "vat_exclusive";
    const isInclusiveTax = vatPolicy === "vat_inclusive";

    console.log("\n=== TAX CONFIGURATION ===");
    console.log("VAT Policy:", vatPolicy);
    console.log("Is Inclusive Tax:", isInclusiveTax);
    console.log("Taxes Configured:", taxes.length > 0 ? "Yes" : "No");
    if (vatPolicy === "all" && taxes.length > 0) {
      const inclusiveCount = taxes.filter((tax) =>
        tax.inclusive_type === "inclusive" ||
        (tax.inclusive_type === undefined && tax.tax_type === "inclusive")
      ).length;
      const exclusiveCount = taxes.filter((tax) =>
        tax.inclusive_type === "exclusive" ||
        (tax.inclusive_type === undefined && tax.tax_type === "exclusive")
      ).length;
      console.log("Inclusive Taxes:", inclusiveCount);
      console.log("Exclusive Taxes:", exclusiveCount);
    }

    // ===================================================================
    // SECOND PASS: PROCESS EACH ITEM
    // ===================================================================
    const allItemTaxBreakdowns = [];
    let totalCalculatedVAT = 0;
    let totalRevenue = 0;

    for (const itemDetail of itemDetails) {
      const {
        item: itm,
        price,
        product,
        lineTotal,
        qty,
        sku,
        isProBono,
        isTaxable: itemIsTaxable,
      } = itemDetail;

      let itemDiscount = 0;
      if (discount_amount > 0 && !isProBono) {
        itemDiscount = allocateDiscount(lineTotal, subtotal, discount_amount);
      }

      const discountedGross = lineTotal - itemDiscount;

      const isTaxable = itemIsTaxable;

      let revenueAmount, itemVAT, itemTaxBreakdown;

      if (isProBono) {
        // PRO-BONO: No revenue, no VAT, no receivable
        revenueAmount = 0;
        itemVAT = 0;
        itemTaxBreakdown = [];
      } else if (isTaxable && taxes && taxes.length > 0) {
        // When vat_policy is "all", use each tax's individual inclusive_type
        // Otherwise, use the global vat_policy

        if (vatPolicy === "all") {
          // Separate taxes by their individual inclusive_type
          const inclusiveTaxes = taxes.filter((tax) => {
            return tax.inclusive_type === "inclusive" ||
                   (tax.inclusive_type === undefined && tax.tax_type === "inclusive");
          });
          const exclusiveTaxes = taxes.filter((tax) => {
            return tax.inclusive_type === "exclusive" ||
                   (tax.inclusive_type === undefined && tax.tax_type === "exclusive");
          });

          // If we have both inclusive and exclusive taxes, handle them separately
          if (inclusiveTaxes.length > 0 && exclusiveTaxes.length > 0) {
            // Remove discount first (discountedGross), then apply tax
            const inclusiveResult = calculateItemNetAndVATFullAmount(discountedGross, inclusiveTaxes, vatPolicy);
            const inclusiveVAT = inclusiveResult.totalVAT;
            const netAfterInclusive = inclusiveResult.netAmount;

            const exclusiveResult = calculateExclusiveVAT(netAfterInclusive, exclusiveTaxes, vatPolicy);
            const exclusiveVAT = exclusiveResult.totalVAT;

            itemTaxBreakdown = [...inclusiveResult.taxBreakdown, ...exclusiveResult.taxBreakdown];
            itemVAT = inclusiveVAT + exclusiveVAT;

            // Revenue = ex-VAT amount after discount (exclusive VAT is on top, not part of revenue)
            revenueAmount = exclusiveResult.netAmount;
          } else if (inclusiveTaxes.length > 0) {
            // All taxes inclusive: remove discount then tax; revenue = ex-VAT on discounted amount
            const result = calculateItemNetAndVATFullAmount(discountedGross, inclusiveTaxes, vatPolicy);
            itemVAT = result.totalVAT;
            itemTaxBreakdown = result.taxBreakdown;
            revenueAmount = result.netAmount;
          } else {
            // All taxes are exclusive
            const result = calculateExclusiveVAT(discountedGross, exclusiveTaxes, vatPolicy);
            revenueAmount = result.netAmount;
            itemVAT = result.totalVAT;
            itemTaxBreakdown = result.taxBreakdown;
          }
        } else if (isInclusiveTax) {
          // VAT INCLUSIVE: remove discount first, then apply tax. Revenue = ex-VAT on (line - discount)
          const result = calculateItemNetAndVATFullAmount(discountedGross, taxes, vatPolicy);
          itemVAT = result.totalVAT;
          itemTaxBreakdown = result.taxBreakdown;
          revenueAmount = result.netAmount;
        } else {
          // VAT EXCLUSIVE (global policy): Calculate on discounted amount, then add VAT
          const result = calculateExclusiveVAT(discountedGross, taxes, vatPolicy);
        revenueAmount = result.netAmount;
        itemVAT = result.totalVAT;
        itemTaxBreakdown = result.taxBreakdown;
        }
      } else {
        // Non-taxable: remove discount first; revenue = amount after discount
        revenueAmount = discountedGross;
        itemVAT = 0;
        itemTaxBreakdown = [];
      }

      // Process based on item type
      if (["Finished Good", "Resalable","By-Product"].includes(product.item_type)) {
        await processGoodsItem(
          itm,
          product,
          lineTotal,
          itemDiscount,
          revenueAmount,
          qty,
          sku,
          isProBono
        );
      } else if (product.item_type === "Service") {
        await processServiceItem(itm, product, revenueAmount, isProBono);
      }

      // Create Sale record
      await db.Sale.create(
        {
          description: itm.item_name || product.name,
          productId: product.id,
          customerId: customer_id,
          quantity: qty,
          price: isProBono ? 0 : Number(itm.selling_price),
          total: isProBono ? 0 : lineTotal,
          saleDate,
          status: "completed",
        },
        { transaction: t }
      );

      // Cr Revenue (only for non-Pro-bono items) — one line per cart line (item code)
      if (!isProBono && revenueAmount > 0) {
        const pcode = productCodeLabel(product, sku);
        assertRevenueAccountForItem(product, pcode);

        const revenueAccount = await getAccountSafe(
          product.revenue_account,
          "Revenue"
        );

        let revenueDesc;
        if (vatPolicy === "all" && taxes && taxes.length > 0) {
          const allTaxesInclusive = taxes.every((tax) =>
            tax.inclusive_type === "inclusive" ||
            (tax.inclusive_type === undefined && tax.tax_type === "inclusive")
          );
          revenueDesc = allTaxesInclusive
            ? `Sales revenue [${pcode}] – ${product.name}`
            : `Sales revenue [${pcode}] – ${product.name} (after line discount)`;
        } else {
          revenueDesc = isInclusiveTax
            ? `Sales revenue [${pcode}] – ${product.name}`
            : `Sales revenue [${pcode}] – ${product.name} (after line discount)`;
        }

        ledgerEntries.push(
          createLedgerEntry(
            revenueAccount,
            0,
            revenueAmount,
            "revenue",
            revenueDesc,
            pcode
          )
        );
      }

      const lineBranchId =
        parseInt(itm.branchId ?? itm.branch_id ?? saleBranchId, 10) ||
        saleBranchId ||
        null;

      // Create CustomerEntry
      await db.CustomerEntry.create(
        {
          customerNo: customer_id,
          description:
            `${itm.item_name} ${
              itm.multiplier_type ? itm.multiplier_type : ""
            }:${itm.multiplier_value ? itm.multiplier_value : ""}${
              isProBono ? " (Pro-bono)" : ""
            }` || product.name,
          qty_in: 0,
          qty_out: product.item_type === "Service" ? qty : qty,
          bank_account_id: "",
          cost: price,
          facilityId,
          mode_of_payment: isProBono
            ? "PRO-BONO"
            : isCashSale
            ? cashModeOfPayment
            : "CREDIT",
          link_id: sku,
          receiptNo: saleRef,
          type: isProBono
            ? "pro-bono"
            : product.item_type === "Service"
            ? "service"
            : "sales",
          created_by,
          branch_id: lineBranchId,
        },
        { transaction: t }
      );

      const costValue = isProBono ? 0 : lineTotal;
      console.log(
        `\n=== ITEM: ${product.name} ${isProBono ? "(PRO-BONO)" : ""} ===`
      );
      console.log(
        `Gross: ${lineTotal.toFixed(2)}, Discount: ${itemDiscount.toFixed(2)}`
      );
      console.log(
        `Revenue: ${revenueAmount.toFixed(2)}, VAT: ${itemVAT.toFixed(2)}`
      );
      console.log(`Cost: ${costValue.toFixed(2)}`);

      totalCalculatedVAT += itemVAT;
      totalRevenue += revenueAmount;
      if (itemTaxBreakdown) {
        allItemTaxBreakdowns.push(...itemTaxBreakdown);
      }
    }

    // VAT for invoice: taxable lines only (not the full subtotal).
    // Exclusive 7.5% on ₦210,000 taxable ≠ 7.5% on ₦330,000 invoice total.
    totalCalculatedVAT = calculateInvoiceVAT(
      goodsTaxableSubtotal,
      taxableDiscountShare,
      taxes,
      vatPolicy
    );

    // ===================================================================
    // CALCULATE NET AMOUNT (AMOUNT TO A/R)
    // ===================================================================
    // For VAT INCLUSIVE: A/R = subtotal (discount shown separately as Cr A/R)
    // For VAT EXCLUSIVE: A/R = subtotal - discount + VAT (discount already deducted from revenue)
    // For VAT "all": Check if all taxes are inclusive or if we have mixed taxes
    let netAmount;
    let arDebitAmount; // The amount to debit to A/R before discount adjustment

    if (vatPolicy === "all" && taxes && taxes.length > 0) {
      // Check if all taxes are inclusive
      const allTaxesInclusive = taxes.every((tax) => {
        return tax.inclusive_type === "inclusive" ||
               (tax.inclusive_type === undefined && tax.tax_type === "inclusive");
      });

      const allTaxesExclusive = taxes.every((tax) => {
        return tax.inclusive_type === "exclusive" ||
               (tax.inclusive_type === undefined && tax.tax_type === "exclusive");
      });

      if (allTaxesInclusive) {
        // All taxes are inclusive: Customer owes net amount after discount (subtotal - discount)
        netAmount = subtotal - discount_amount;
        arDebitAmount = netAmount; // Debit A/R at net amount; discount already reduces A/R
      } else if (allTaxesExclusive) {
        // All taxes are exclusive: A/R = subtotal - discount + VAT
        netAmount = subtotal - discount_amount + totalCalculatedVAT;
        arDebitAmount = netAmount; // For exclusive, A/R is at net amount
      } else {
        // Mixed taxes: Separate inclusive and exclusive VAT
        const inclusiveTaxes = taxes.filter((tax) => {
          return tax.inclusive_type === "inclusive" ||
                 (tax.inclusive_type === undefined && tax.tax_type === "inclusive");
        });
        const exclusiveTaxes = taxes.filter((tax) => {
          return tax.inclusive_type === "exclusive" ||
                 (tax.inclusive_type === undefined && tax.tax_type === "exclusive");
        });

        // Calculate inclusive VAT from taxable lines only
        let inclusiveVAT = 0;
        if (inclusiveTaxes.length > 0) {
          const taxableNet = Math.max(
            goodsTaxableSubtotal - taxableDiscountShare,
            0,
          );
          let totalInclusiveRate = 0;
          for (const tax of inclusiveTaxes) {
            const taxRate = (tax.rate || 0) / 100;
            if (taxRate > 0) totalInclusiveRate += taxRate;
          }
          if (totalInclusiveRate > 0) {
            const netOfInclusive = taxableNet / (1 + totalInclusiveRate);
            inclusiveVAT = taxableNet - netOfInclusive;
          }
        }

        // Calculate exclusive VAT on taxable net (after extracting inclusive VAT)
        let exclusiveVAT = 0;
        if (exclusiveTaxes.length > 0) {
          const taxableNet = Math.max(
            goodsTaxableSubtotal - taxableDiscountShare,
            0,
          );
          const netAfterInclusive = taxableNet - inclusiveVAT;
          for (const tax of exclusiveTaxes) {
            const taxRate = (tax.rate || 0) / 100;
            if (taxRate > 0) {
              exclusiveVAT += netAfterInclusive * taxRate;
            }
          }
        }

        // Net amount = subtotal - discount + exclusive VAT (inclusive VAT is already in subtotal)
        netAmount = subtotal - discount_amount + exclusiveVAT;
        arDebitAmount = subtotal; // Debit A/R at subtotal, discount and exclusive VAT handled separately
      }
    } else if (isInclusiveTax) {
      // VAT inclusive: Customer owes net amount after discount
      netAmount = subtotal - discount_amount;
      arDebitAmount = netAmount; // Debit A/R at net amount; discount already reduces A/R
    } else {
      // VAT exclusive: A/R = subtotal - discount + VAT
      netAmount = subtotal - discount_amount + totalCalculatedVAT;
      arDebitAmount = netAmount; // For exclusive, A/R is at net amount
    }

    // Net amount can be zero if all items are Pro-bono
    if (netAmount < 0) {
      throw new Error("Net amount cannot be negative");
    }

    // Invoice-level VAT (after discount) — reused for A/R and tax CRs
    const invoiceVATBreakdown = getInvoiceVATBreakdown(
      goodsTaxableSubtotal,
      taxableDiscountShare,
      taxes,
      vatPolicy
    );

    const exclusiveVatToPost = Number(
      (
        invoiceVATBreakdown.breakdown || []
      )
        .reduce((sum, { tax, amount }) => {
          const taxType =
            tax.inclusive_type === "inclusive"
              ? "Inclusive"
              : tax.inclusive_type === "exclusive"
                ? "Exclusive"
                : tax.tax_type === "inclusive"
                  ? "Inclusive"
                  : "Exclusive";
          return taxType === "Exclusive" ? sum + Number(amount || 0) : sum;
        }, 0)
        .toFixed(2)
    );

    // Prefer Invoice Total from the UI (Total NGN) so Cashier Point /
    // A/R due matches what was shown on New Invoice — but never drop
    // exclusive output VAT from A/R. Exclusive VAT is posted as a
    // separate CR; A/R must include it or the ledger will not balance.
    const clientTotal = Number(total_amount);
    if (Number.isFinite(clientTotal) && clientTotal > 0) {
      netAmount = clientTotal;
      arDebitAmount = clientTotal;
    }

    if (exclusiveVatToPost > 0.004) {
      const expectedWithExclusiveVat = Number(
        (totalRevenue + exclusiveVatToPost).toFixed(2)
      );
      const expectedFromSubtotal = Number(
        (subtotal - discount_amount + exclusiveVatToPost).toFixed(2)
      );
      const roundedNet = Number(Number(netAmount).toFixed(2));
      const alreadyIncludesExclusiveVat =
        Math.abs(roundedNet - expectedWithExclusiveVat) <= 0.05 ||
        Math.abs(roundedNet - expectedFromSubtotal) <= 0.05;

      if (!alreadyIncludesExclusiveVat) {
        netAmount = Number((roundedNet + exclusiveVatToPost).toFixed(2));
        arDebitAmount = netAmount;
      }
    }

    console.log("\n=== NET AMOUNT CALCULATION ===");
    console.log("Subtotal (excluding Pro-bono):", subtotal.toFixed(2));
    console.log("Discount:", discount_amount.toFixed(2));
    console.log("Total Revenue:", totalRevenue.toFixed(2));
    console.log("Total VAT:", totalCalculatedVAT.toFixed(2));
    console.log("Net Amount (Customer owes):", netAmount.toFixed(2));
    console.log("A/R Debit Amount:", arDebitAmount.toFixed(2));
    console.log("Pro-bono Value:", totalProBonoValue.toFixed(2));

    // ===================================================================
    // PREPAYMENT LOGIC (customer deposit applied to this credit sale)
    // ===================================================================
    const depositBalance =
      parseFloat(await getBalance(customer_id, facilityId)) || 0;
    let amountToAR = netAmount;
    let prepaymentApplied = 0;

    const shouldApplyPrepayment =
      !isCashSale &&
      (apply_prepayment === true ||
        apply_prepayment === "true" ||
        apply_prepayment === 1 ||
        apply_prepayment === "1");

    if (shouldApplyPrepayment && depositBalance > 0 && netAmount > 0) {
      if (!accrualAccount) {
        throw new Error(
          `Customer ${customerCodeLabel} has a deposit balance but no receivable_accural_code (advance / customer deposit account). Set it on the customer record to apply prepayments.`
        );
      }

      const clientAmount = parseFloat(amountPaidFromClient) || 0;
      const maxApplicable = Math.min(depositBalance, netAmount);
      prepaymentApplied =
        clientAmount > 0
          ? Math.min(clientAmount, maxApplicable)
          : maxApplicable;
      amountToAR = netAmount - prepaymentApplied;

      if (prepaymentApplied > 0) {
        // Extract product names for description
        const itemNames = itemDetails
          .filter((item) => !item.isProBono)
          .map((item) => {
            const name = item.product?.name || item.item?.item_name || "";
            const pcode = item.product
              ? productCodeLabel(item.product, item.sku)
              : "";
            if (name && pcode) return `${name} [${pcode}]`;
            return name || pcode || "";
          })
          .filter(Boolean)
          .slice(0, 3)
          .join(", ");
        const productNamesText = itemNames
          ? ` — ${itemNames}${itemDetails.length > 3 ? "..." : ""}`
          : "";

        ledgerEntries.push(
          createLedgerEntry(
            accrualAccount,
            prepaymentApplied,
            0,
            "deposit",
            `Advance applied [${customerCodeLabel}] — ${saleRef}${productNamesText}`,
            customerCodeLabel
          )
        );

        await db.CustomerEntry.create(
          {
            customerNo: customer_id,
            description: `Advance applied [${customerCodeLabel}] — ${saleRef}${productNamesText}`,
            cost: prepaymentApplied,
            qty_in: 0,
            qty_out: 1,
            type: "deposit",
            mode_of_payment: "CREDIT",
            link_id: saleRef,
            bank_account_id: "",
            receiptNo: saleRef,
            facilityId,
            branch_id: saleBranchId || null,
            created_by,
          },
          { transaction: t }
        );
      }
    }

    // ===================================================================
    // DR ACCOUNTS RECEIVABLE
    // ===================================================================
    // Post A/R only for amount remaining AFTER prepayment (amountToAR)
    // When prepayment fully covers the sale, amountToAR = 0, so no A/R entry
    if (amountToAR > 0) {
      const itemNames = itemDetails
        .filter((item) => !item.isProBono)
        .map((item) => {
          const name = item.product?.name || item.item?.item_name || "";
          const pcode = item.product
            ? productCodeLabel(item.product, item.sku)
            : "";
          if (name && pcode) return `${name} [${pcode}]`;
          return name || pcode || "";
        })
        .filter(Boolean)
        .slice(0, 3)
        .join(", ");
      const vatText = totalCalculatedVAT > 0 ? " (incl. VAT)" : "";
      const saleLabel = isCashSale ? "Cash sale" : "Credit sale";
      const saleDescription = itemNames
        ? `${saleLabel} [${customerCodeLabel}] — ${itemNames}${
            itemDetails.filter((i) => !i.isProBono).length > 3 ? "..." : ""
          }${vatText}`
        : `${saleLabel} [${customerCodeLabel}] — ${saleRef}${vatText}`;

      ledgerEntries.push(
        createLedgerEntry(
          receivableAccount,
          amountToAR,
          0,
          "receivable",
          saleDescription,
          customerCodeLabel
        )
      );
    }

    // ===================================================================
    // DISCOUNT ENTRIES (Dr Sales Discounts, Cr A/R)
    // ===================================================================
    // Apply discount entries if there's a discount amount and net amount > 0
    // Standard accounting: Dr Sales Discounts (Contra-Revenue), Cr Accounts Receivable
    // Both legs MUST happen - this is critical for balancing the ledger
    if (discount_amount > 0 && netAmount > 0) {
      // Ensure discount account exists
      if (!discountAccount) {
        throw new Error(
          "Discount account is required but not configured. Please configure discount account in discount settings."
        );
      }

      // Dr Sales Discounts (Contra-Revenue account)
      // This shows the discount given as a contra-revenue entry
      ledgerEntries.push(
        createLedgerEntry(
          discountAccount,
          discount_amount,
          0,
          "expenses",
          `Discount ${discount_info.value || ""}${
            discount_info.discount_type === "Percentage" ? "%" : ""
          } given on credit sale`,
          ""
        )
      );

      // Cr A/R for discount (to reduce A/R for discount amount)
      // This is the other leg of the discount entry - MUST happen
      const discountItemNames = itemDetails
        .filter((item) => !item.isProBono)
        .map((item) => {
          const name = item.product?.name || item.item?.item_name || "";
          const pcode = item.product
            ? productCodeLabel(item.product, item.sku)
            : "";
          if (name && pcode) return `${name} [${pcode}]`;
          return name || pcode || "";
        })
        .filter(Boolean)
        .slice(0, 3)
        .join(", ");
      const discountDescription = discountItemNames
        ? `Discount to AR [${customerCodeLabel}] — ${discountItemNames}${
            itemDetails.filter((i) => !i.isProBono).length > 3 ? "..." : ""
          }`
        : `Discount to AR [${customerCodeLabel}] — ${saleRef}`;

      ledgerEntries.push(
        createLedgerEntry(
          receivableAccount,
          0,
          discount_amount,
          "receivable",
          discountDescription,
          customerCodeLabel
        )
      );

      // Create CustomerEntry for discount tracking
      await db.CustomerEntry.create(
        {
          customerNo: customer_id,
          description: `${discount_info.discount_name || "Discount"} ${
            discount_info.value || ""
          }${
            discount_info.discount_type === "Percentage" ? "%" : ""
          } - ${saleRef}`,
          qty_in: 0,
          qty_out: 0,
          bank_account_id: "",
          cost: discount_amount,
          facilityId,
          mode_of_payment: "CREDIT",
          link_id: discount_info.discount_id || "",
          receiptNo: saleRef,
          type: "discount",
          created_by,
        },
        { transaction: t }
      );
    }

    // ===================================================================
    // CR TAX PAYABLE (invoice-level: remove discount then apply tax)
    // ===================================================================
    const taxCustomerEntries = [];

    if (totalCalculatedVAT > 0 && invoiceVATBreakdown.breakdown.length > 0) {
      console.log("=== PROCESSING TAX ENTRIES (after discount) ===");

      for (const { tax, amount } of invoiceVATBreakdown.breakdown) {
        const taxAccountInfo = taxAccounts.find(
          (ta) =>
            ta.tax.id === tax.id ||
            ta.tax.tax_id === tax.tax_id ||
            ta.tax.description === tax.description
        );

        if (!taxAccountInfo) {
          const taxCode =
            tax.account_head ||
            tax.account_sub_head ||
            tax.head ||
            tax.tax_account_head ||
            String(business?.vat_account_code || "").trim() ||
            "N/A";
          const errMsg = `Tax code "${taxCode}" does not exist in Chart of Accounts for tax "${tax.name || tax.description}". Please create the account or update the tax configuration.`;
          console.error(errMsg);
          throw new Error(errMsg);
        }

        const finalTaxAmount = Number((amount || 0).toFixed(2));
        if (finalTaxAmount > 0) {
          const taxType = tax.inclusive_type === "inclusive"
            ? "Inclusive"
            : tax.inclusive_type === "exclusive"
            ? "Exclusive"
            : tax.tax_type === "inclusive"
            ? "Inclusive"
            : "Exclusive";

          ledgerEntries.push(
            createLedgerEntry(
              taxAccountInfo.account,
              0,
              finalTaxAmount,
              "tax",
              `Output VAT @${tax.rate || ""}% (${taxType})`
            )
          );

          taxCustomerEntries.push({
            customerNo: customer_id,
            description: `${tax.name || tax.description} - ${saleRef}`,
            qty_in: 0,
            qty_out: 0,
            bank_account_id: "",
            cost: finalTaxAmount,
            facilityId,
            branch_id: saleBranchId || null,
            mode_of_payment: "CREDIT",
            link_id: tax.id || tax.tax_id || "",
            receiptNo: saleRef,
            type: "tax",
            created_by,
          });
        }
      }

      if (taxCustomerEntries.length > 0) {
        await db.CustomerEntry.bulkCreate(taxCustomerEntries, {
          transaction: t,
        });
      }
    }

    // ===================================================================
    // CASH SALE: immediately settle A/R (Dr Cash/Bank, Cr A/R)
    // Supports a single payment or split cash + transfer.
    // ===================================================================
    if (isCashSale && amountToAR > 0 && resolvedPaymentSplits.length > 0) {
      const splits =
        resolvedPaymentSplits.length === 1 &&
        !(Number(resolvedPaymentSplits[0].amount) > 0)
          ? [{ ...resolvedPaymentSplits[0], amount: amountToAR }]
          : resolvedPaymentSplits;

      const splitTotal = splits.reduce((s, p) => s + (Number(p.amount) || 0), 0);
      if (Math.abs(splitTotal - amountToAR) > 0.05) {
        await t.rollback();
        return res.status(400).json({
          success: false,
          message: `Payment split total (${splitTotal}) must equal amount due (${amountToAR})`,
        });
      }

      for (const split of splits) {
        const payAmt = Number(split.amount) || 0;
        if (payAmt <= 0 || !split.account) continue;
        const modeLabel =
          split.mode === "cash"
            ? "cash"
            : split.mode === "cheque"
              ? "cheque"
              : "bank";

        ledgerEntries.push(
          createLedgerEntry(
            split.account,
            payAmt,
            0,
            "bank",
            `Sale payment (${modeLabel}) [${customerCodeLabel}] — ${saleRef}`,
            customerCodeLabel,
            {
              bank_account_id: split.bankAccountId || "",
              purpose_of_payment: "Cash Sale",
              mode_of_payment: modeLabel,
            },
          ),
        );

        ledgerEntries.push(
          createLedgerEntry(
            receivableAccount,
            0,
            payAmt,
            "receivable",
            `Sale settlement (${modeLabel}) [${customerCodeLabel}] — ${saleRef}`,
            customerCodeLabel,
            {
              purpose_of_payment: "Cash Sale",
              mode_of_payment: modeLabel,
            },
          ),
        );

        await db.CustomerEntry.create(
          {
            customerNo: customer_id,
            description: `Sale payment (${modeLabel}) — ${saleRef}`,
            qty_in: 0,
            qty_out: 0,
            cost: payAmt,
            amount_paid: payAmt,
            facilityId,
            branch_id: saleBranchId || null,
            mode_of_payment: modeLabel,
            link_id: saleRef,
            type: "deposit",
            receiptNo: saleRef,
            bank_account_id: split.bankAccountId || "",
            cheque_no:
              modeLabel === "cheque"
                ? String(cheque_number || "").trim()
                : null,
            created_by,
          },
          { transaction: t },
        );
      }
    } else if (isCashSale && amountToAR > 0 && cashBankAccount) {
      ledgerEntries.push(
        createLedgerEntry(
          cashBankAccount,
          amountToAR,
          0,
          "bank",
          `Cash sale payment [${customerCodeLabel}] — ${saleRef}`,
          customerCodeLabel,
          {
            bank_account_id: resolvedBankAccountId || "",
            purpose_of_payment: "Cash Sale",
            mode_of_payment: cashModeOfPayment,
          }
        )
      );

      ledgerEntries.push(
        createLedgerEntry(
          receivableAccount,
          0,
          amountToAR,
          "receivable",
          `Cash sale settlement [${customerCodeLabel}] — ${saleRef}`,
          customerCodeLabel,
          {
            purpose_of_payment: "Cash Sale",
            mode_of_payment: cashModeOfPayment,
          }
        )
      );

      await db.CustomerEntry.create(
        {
          customerNo: customer_id,
          description: `Cash sale payment — ${saleRef}`,
          qty_in: 0,
          qty_out: 0,
          cost: amountToAR,
          amount_paid: amountToAR,
          facilityId,
          branch_id: saleBranchId || null,
          mode_of_payment: cashModeOfPayment,
          link_id: saleRef,
          type: "deposit",
          receiptNo: saleRef,
          bank_account_id: resolvedBankAccountId || "",
          cheque_no:
            cashModeOfPayment === "cheque"
              ? String(cheque_number || "").trim()
              : null,
          created_by,
        },
        { transaction: t }
      );
    }

    // If A/R includes exclusive VAT but no tax CR was posted (e.g. Input VAT
    // selected on the invoice, or taxes omitted), credit VAT payable so the
    // ledger still balances.
    {
      const taxCredits = ledgerEntries.reduce((sum, entry) => {
        const desc = String(entry.transaction_description || "").toLowerCase();
        if (
          desc.includes("output vat") ||
          desc.includes("input vat") ||
          desc.includes("vat @") ||
          desc.includes("value added")
        ) {
          return sum + Number(entry.cr || 0);
        }
        return sum;
      }, 0);
      const impliedExclusiveVat = Number(
        (
          Number(arDebitAmount || netAmount || 0) -
          (subtotal - discount_amount)
        ).toFixed(2),
      );
      const vatGap = Number((impliedExclusiveVat - taxCredits).toFixed(2));
      if (impliedExclusiveVat > 0.05 && vatGap > 0.05) {
        let vatAcc = taxAccounts[0]?.account || null;
        const vatHead = String(business?.vat_account_code || "").trim();
        if (!vatAcc && vatHead) {
          vatAcc = await db.AccountCategory.findOne({
            where: { code: vatHead, facility_id: facilityId },
            transaction: t,
          });
        }
        if (vatAcc) {
          ledgerEntries.push(
            createLedgerEntry(
              vatAcc,
              0,
              vatGap,
              "tax",
              `Output VAT (${vatGap.toFixed(2)})`,
            ),
          );
        }
      }
    }

    // ===================================================================
    // VALIDATE LEDGER BALANCE
    // ===================================================================
    const totalDebits = ledgerEntries.reduce((sum, entry) => sum + entry.dr, 0);
    const totalCredits = ledgerEntries.reduce(
      (sum, entry) => sum + entry.cr,
      0
    );
    console.log(ledgerEntries)
    const difference = Math.abs(totalDebits - totalCredits);

    console.log("\n=== LEDGER VALIDATION ===");
    console.log("Total Debits:", totalDebits.toFixed(2));
    console.log("Total Credits:", totalCredits.toFixed(2));
    console.log("Difference:", difference.toFixed(2));

    console.log("\n=== LEDGER ENTRIES ===");
    ledgerEntries.forEach((entry, idx) => {
      console.log(
        `${idx + 1}. ${entry.transaction_description} | DR: ${entry.dr.toFixed(
          2
        )} | CR: ${entry.cr.toFixed(2)}`
      );
    });

    if (difference > 0.02) {
      console.error("\n=== LEDGER IMBALANCE DETECTED ===");
      throw new Error(
        `Ledger entries do not balance! Debits: ${totalDebits.toFixed(
          2
        )}, Credits: ${totalCredits.toFixed(
          2
        )}, Difference: ${difference.toFixed(2)}`
      );
    }

    // ===================================================================
    // SAVE ALL LEDGER ENTRIES
    // ===================================================================
    await db.GeneralLedger.bulkCreate(ledgerEntries, { transaction: t });

    // ===================================================================
    // CREATE INVOICE RECORD
    // ===================================================================
    let invoiceDescription = "";
    if (items.length > 0) {
      const regularItems = itemDetails.filter((item) => !item.isProBono);
      const proBonoItems = itemDetails.filter((item) => item.isProBono);

      if (regularItems.length > 0) {
        invoiceDescription = regularItems
          .map(
            (detail) =>
              `${
                detail.item.item_name || detail.item.product_id || "Item"
              } (Qty: ${detail.item.quantity || 1})`
          )
          .join(", ");

        if (discount_amount > 0 && discount_info?.discount_name) {
          invoiceDescription += ` | Discount: ${discount_info.discount_name} ${
            discount_info.value || ""
          }${
            discount_info.discount_type === "Percentage" ? "%" : ""
          } (${discount_amount.toFixed(2)})`;
        }
      }

      if (proBonoItems.length > 0) {
        const proBonoDesc = proBonoItems
          .map(
            (detail) =>
              `${
                detail.item.item_name || detail.item.product_id || "Item"
              } (Qty: ${detail.item.quantity || 1}) - Pro-bono`
          )
          .join(", ");

        invoiceDescription = invoiceDescription
          ? `${invoiceDescription} | ${proBonoDesc}`
          : proBonoDesc;
      }
    } else {
      invoiceDescription = `${salePurpose} to ${customer.fullname} - ${saleRef}`;
      if (discount_amount > 0) {
        invoiceDescription += ` | Discount: ${discount_amount.toFixed(2)}`;
      }
    }

    // Only create invoice if there's a net amount (non-zero receivable)
    if (netAmount > 0) {
      // amount = receivable: what the customer is to pay
      // - VAT inclusive: subtotal - discount (tax already in prices, leave as-is)
      // - VAT exclusive: subtotal - discount + tax (sum together)
      // Cash sales: due on sale date (already settled). Credit: +30 days.
      const invoiceDueDate = isCashSale
        ? new Date(`${saleDate}T12:00:00`)
        : new Date(new Date(saleDate).getTime() + 30 * 24 * 60 * 60 * 1000);

      await db.Invoice.create(
        {
          ref_number: customer_id,
          invoice_ref: saleRef,
          transaction_date: saleDate,
          due_date: invoiceDueDate,
          description: invoiceDescription,
          amount: Number(netAmount.toFixed(2)),
          created_by: created_by,
          facility_id: facilityId,
          customerNo: customer_id,
          branchId: saleBranchId || null,
          type: "sales",
        },
        { transaction: t }
      );

      console.log(
        `Invoice created: ${saleRef} for amount ${netAmount.toFixed(2)}`
      );
    } else {
      console.log(`No invoice created - all items are Pro-bono (${saleRef})`);
    }

    await t.commit();

    // Sales Management workflow (Cash/Transfer confirm or Credit approval → fulfillment)
    try {
      const {
        createSaleWorkflowRecord,
        normalizePaymentType,
      } = require("./saleWorkflow");
      await createSaleWorkflowRecord({
        facilityId,
        saleCode: saleRef,
        customerNo: customer_id,
        customerName:
          customer?.fullname ||
          customer?.company_name ||
          [customer?.first_name, customer?.last_name].filter(Boolean).join(" ") ||
          null,
        paymentType: normalizePaymentType(
          isCashSale
            ? cashModeOfPayment
            : String(modeOfPayment || "").toLowerCase().includes("deposit")
              ? "deposit"
              : "CREDIT",
          isCashSale,
          payment_modes,
        ),
        paymentModes: Array.isArray(payment_modes) ? payment_modes : [],
        amount:
          String(modeOfPayment || "").toLowerCase().includes("deposit")
            ? amountToAR
            : netAmount,
        branchId: saleBranchId,
        createdBy: created_by,
        discountAmount: discount_amount,
        assignedCashierId: assigned_cashier_id || cashier_user_id || null,
        assignedCashierName: assigned_cashier_name || cashier_name || null,
      });
    } catch (wfErr) {
      console.error("Sale workflow create skipped:", wfErr?.message || wfErr, wfErr?.stack || "");
    }

    // In-app notification (business members except actor)
    try {
      const { notifyBusinessMembers } = require("../services/notifications");
      const customerLabel =
        customer?.fullname ||
        customer?.company_name ||
        [customer?.first_name, customer?.last_name].filter(Boolean).join(" ") ||
        customer_id ||
        "customer";
      const amountLabel = Number(netAmount || 0).toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
      void notifyBusinessMembers({
        facilityId,
        excludeUserId: created_by,
        actorUserId: created_by,
        type: "invoice_created",
        title: `Invoice ${saleRef} created`,
        body: `${isCashSale ? "Cash" : "Credit"} sale for ${customerLabel} — ₦${amountLabel}`,
        link: "/app/sales/invoices",
        entityType: "invoice",
        entityId: saleRef,
      });
    } catch (notifErr) {
      console.warn("Invoice notification skipped:", notifErr?.message || notifErr);
    }

    // ===================================================================
    // RESPONSE
    // ===================================================================
    const hasProBonoItems = itemDetails.some((item) => item.isProBono);
    const hasRegularItems = itemDetails.some((item) => !item.isProBono);
    const successBase = isCashSale ? "Cash sale" : "Credit sale";

    return res.status(200).json({
      success: true,
      message: hasProBonoItems
        ? hasRegularItems
          ? `${successBase} with Pro-bono items processed successfully`
          : "Pro-bono transaction processed successfully"
        : `${successBase} processed successfully`,
      sale_code: saleRef,
      txn_type,
      mode_of_payment: isCashSale ? cashModeOfPayment : "CREDIT",
      workflow_started: true,
      net_amount: netAmount,
      cogs_amount: totalCOGS,
      pro_bono_value: totalProBonoValue,
      prepayment_applied: prepaymentApplied,
      amount_to_receivable: amountToAR,
      valuation_method: valuationMethod,
      subtotal,
      discount: discount_amount,
      tax: totalCalculatedVAT,
      tax_type: vatPolicy === "all"
        ? "mixed"
        : isInclusiveTax
        ? "inclusive"
        : "exclusive",
      taxable_amount: vatPolicy === "all"
        ? (() => {
            // For "all" policy, calculate based on tax types
            const allTaxesInclusive = taxes.every((tax) =>
              tax.inclusive_type === "inclusive" ||
              (tax.inclusive_type === undefined && tax.tax_type === "inclusive")
            );
            if (allTaxesInclusive) {
              return subtotal - discount_amount - totalCalculatedVAT;
            } else {
              return subtotal - discount_amount;
            }
          })()
        : isInclusiveTax
        ? subtotal - discount_amount - totalCalculatedVAT
        : subtotal - discount_amount,
      ledger_balance_check: {
        debits: totalDebits.toFixed(2),
        credits: totalCredits.toFixed(2),
        balanced: Math.abs(totalDebits - totalCredits) < 0.02,
      },
      items_summary: {
        total_items: items.length,
        regular_items: itemDetails.filter((item) => !item.isProBono).length,
        pro_bono_items: itemDetails.filter((item) => item.isProBono).length,
      },
    });
  } catch (err) {
    await t.rollback();
    console.error("createSale error:", err.message, err.stack);
    const isClientError =
      /Insufficient quantity|Invalid item|not found|required|limit reached|sales .+ limit|sales are stopped|credit limit|cannot be sold/i.test(
        String(err.message || ""),
      );
    return res.status(isClientError ? 400 : 500).json({
      success: false,
      message: err.message || "Failed to process sale",
      error: err.message || "Failed to process sale",
    });
  }
};

// Get taxes for a specific sale
exports.getSaleTaxes = async (req, res) => {
  try {
    const { saleReference } = req.params;
    const { facilityId } = req.query;

    if (!saleReference) {
      return res.status(400).json({
        success: false,
        message: "Sale reference is required",
      });
    }

    const taxes = await db.sequelize.query(
      `SELECT
        st.*,
        t.description as tax_description,
        t.rate_type,
        t.account_sub_head
      FROM sales_taxes st
      LEFT JOIN taxes t ON st.tax_id = t.id
      WHERE st.sale_reference = :saleReference
      ${facilityId ? "AND st.facilityId = :facilityId" : ""}
      ORDER BY st.created_at ASC`,
      {
        replacements: { saleReference, facilityId },
        type: db.Sequelize.QueryTypes.SELECT,
      }
    );

    res.json({
      success: true,
      data: taxes,
      count: taxes.length,
    });
  } catch (err) {
    console.error("Error fetching sale taxes:", err);
    res.status(500).json({
      success: false,
      message: "Failed to fetch sale taxes",
      error: err.message,
    });
  }
};

exports.selling = (req, res) => {
  console.log(req.body);
  // let txn_date = "";

  sellingApi(
    req.body,
    (results) => {
      res.json({ success: true, results });
    },
    (err) => {
      console.log(err);
      res.status(500).json({ success: false, err });
    }
  );
};

exports.newServiceTransaction = (req, res) => {
  console.log(req.body);
  // let txn_date = "";
  const {
    trn = "",
    expiring_date = "",
    receive_date = "",
    query_type = "",
    facilityID = "",
    amount = "",
    modeOfPayment = "",
    source = "",
    destination = "",
    description = "",
    userId = "",
    receiptsn = "",
    patientId = "",
    debit = "",
    serviceHead = "CASH",
    bank = "",
    branch_name = "",
    quantity = "",
    discount = "",
    customerName = "",
    qty_out = 0,
    trn_number = "",
    item_code = "",
    status = "",
    req_no = "",
    phone = "",
    customer_bank = "",
    customer_acc_no = "",
    transaction_amount = "",
    business_bank = "",
    business_bank_acc_no = "",
    _rev = "",
    _id = "",
    receiptNo = "",
    customerId,
    createdAt,
    amountPaid = 0,
    truckNo = "",
    waybillNo = "",
    itemList = "",
    txn_type = "",
  } = req.body;

  let selling_price = parseFloat(amount) / parseFloat(quantity);
  let qty_in = quantity;
  let default_version_id = UUIDV4();
  let version_id = _rev && _rev != "" ? _rev : default_version_id;
  let clientAccount = customerId ? customerId : "CASH";
  let receiptno = receiptNo;
  let credit = destination;
  let transaction_source = customerId;
  let transaction_date = moment(createdAt).format("YYYY-MM-DD");
  let transaction_id = _id;
  let transactionType = customerId && customerId !== "" ? "deposit" : "insta";
  let item_name = description;
  let location_from = branch_name;

  db.sequelize
    .query(
      `CALL service_transaction(:description,:accNo,:amount,:receiptsn,:receiptno,:payment_mode,
        :patientId,:facId,:sourceAcct,:userId,:serviceHead,:transactionType,:in_date,
        :payables_head,:recievables_head,:bank,:txn_date,:discount,:discount_head,:in_customer_name,
        :branch_name,:quantity,:version_id,:phone,:customer_bank,:customer_acc_no,
        :transaction_amount,:business_bank,:business_bank_acc_no,:amountPaid,:truckNo,:waybillNo,
        :itemList,:txn_type)`,
      {
        replacements: {
          amount: amount ? amount : 0,
          accNo: "CASH",
          description,
          source: credit,
          userId,
          receiptsn: receiptNo,
          receiptno,
          payment_mode: modeOfPayment,
          destination,
          facId: facilityID,
          client_acct: debit,
          patientId,
          sourceAcct:
            modeOfPayment.toLowerCase() === "cash" ? "400021" : "400022",
          serviceHead: serviceHead ? serviceHead : credit,
          transactionType: "insta",
          in_date: moment().format("YYYY-MM-DD hh:mm:ss"),
          payables_head: "500021",
          recievables_head: "400023",
          bank: bank ? bank : "",
          branch_name: branch_name ? branch_name : "",
          quantity: qty_in ? qty_in : 0,
          txn_date: transaction_date
            ? moment(transaction_date).format("YYYY-MM-DD")
            : moment().format("YYYY-MM-DD"),
          discount: discount ? discount : 0,
          discount_head: "",
          in_customer_name: customerName,
          version_id: version_id,
          transaction_date,

          phone,
          customer_bank,
          customer_acc_no,
          transaction_amount,
          business_bank,
          business_bank_acc_no,
          amountPaid: amountPaid !== "" ? amountPaid : 0,
          truckNo: truckNo ? truckNo : "",
          waybillNo: waybillNo ? waybillNo : "",
          itemList,
          txn_type,
        },
      }
    )
    .then((results) => res.json({ success: true, results }))
    .catch((err) => {
      console.log(err);
      res.status(500).json({ success: false, err });
    });
};

exports.deliveryList = (req, res) => {
  console.log(req.body);
  const { deliveryList, facilityId, userId } = req.body;

  deliveryList.forEach((item) => {
    db.sequelize
      .query(
        `CALL service_transaction(:description,:accNo,:amount,:receiptsn,:receiptno,:payment_mode,
        :patientId,:facId,:sourceAcct,:userId,:serviceHead,:transactionType,:in_date,
        :payables_head,:recievables_head,:bank,:txn_date,:discount,:discount_head,:in_customer_name,
        :branch_name,:quantity,:version_id,:phone,:customer_bank,:customer_acc_no,
        :transaction_amount,:business_bank,:business_bank_acc_no,:amountPaid,:truckNo,:waybillNo,
        :itemList,:txn_type)`,
        {
          replacements: {
            amount: item.commission ? item.commission : 0,
            accNo: item.barberId,
            description: item.service ? item.service : null,
            source: "full Payment",
            userId: userId,
            receiptsn: item.receiptNo ? item.receiptNo : null,
            receiptno: item.receiptNo ? item.receiptNo : null,
            payment_mode: "Cash",
            destination: "",
            facId: facilityId,
            client_acct: "",
            patientId: item.barber ? item.barber : null,
            sourceAcct: "Cash",
            serviceHead: "",
            transactionType: "insta",
            in_date: moment().format("YYYY-MM-DD hh:mm:ss"),
            payables_head: "500021",
            recievables_head: "400023",
            bank: "",
            branch_name: "",
            quantity: 1,
            txn_date: moment().format("YYYY-MM-DD"),
            discount: 0,
            discount_head: "",
            in_customer_name: item.barber ? item.barber : null,
            version_id: item.version_id ? item.version_id : null,
            transaction_date: moment().format("YYYY-MM-DD"),
            phone: "",
            customer_bank: "",
            customer_acc_no: "",
            transaction_amount: item.service_cost ? item.service_cost : 0,
            business_bank: "",
            business_bank_acc_no: "",
            amountPaid: item.service_cost ? item.service_cost : 0,
            truckNo: "",
            waybillNo: "",
            commission: item.commission ? item.commission : 0,
            itemList: "",
            txn_type: "",
          },
        }
      )
      // .then((results) => res.json({ success: true, results }))
      .catch((err) => {
        console.log(err);
        res.status(500).json({ success: false, err });
      });
  });

  res.json({ success: true, results: "Submitted successfully" });
};

exports.agentPayment = (req, res) => {
  const uid = UUIDV4();
  const {
    facilityId,
    userId,
    id,
    amount,
    receiptsn = "",
    receiptno = "",
    receiptNo = "",
    modeOfPayment = "CASH",
    sourceAcct,

    description,
    createdAt,
    account = {},
    narration,
    _rev = uid,
  } = req.body;
  console.log(req.body);

  db.sequelize
    .query(
      `CALL agent_payment(:facilityId,:userId,:agentId,:amount,:receiptsn,:receiptno,
        :modeOfPayment,:sourceAcct,:description,:in_date,:in_payables,:version_id)`,
      {
        replacements: {
          facilityId,
          userId,
          agentId: id,
          amount,
          receiptsn: receiptNo,
          receiptno,
          modeOfPayment,
          sourceAcct: account && account.acctNo ? account.acctNo : "",
          // modeOfPayment.toLowerCase() === 'cash' ? '400021' : '400022',
          description: narration,
          in_date: moment.utc(createdAt).format("YYYY-MM-DD hh:mm:ss"),
          in_payables: "500021",
          version_id: _rev,
        },
      }
    )
    .then((results) => {
      res.json({ success: true, results });
    })
    .catch((err) => {
      res.json({ success: false, err });
    });
};

// Insert Transaction
exports.insertTransaction = (req, res) => {
  const {
    invoice_number,
    transaction_type,
    customer_id,
    customer_name,
    vendor_id,
    vendor_name,
    employee_id,
    employee_name,
    approver_id,
    approver_name,
    work_hours,
    hourly_rate,
    invoice_date,
    due_date = null,
    description,
    subtotal,
    tax,
    total,
    status,
    items = [],
    attachments = [],
  } = req.body;

  db.sequelize
    .query(
      "CALL insert_transaction_with_items(:invoice_number, :transaction_type, :customer_id, :customer_name, :vendor_id, :vendor_name, :employee_id, :employee_name, :approver_id, :approver_name, :work_hours, :hourly_rate, :invoice_date, :due_date, :description, :subtotal, :tax, :total, :status)",
      {
        replacements: {
          invoice_number,
          transaction_type,
          customer_id,
          customer_name,
          vendor_id,
          vendor_name,
          employee_id,
          employee_name,
          approver_id,
          approver_name,
          work_hours,
          hourly_rate,
          invoice_date,
          due_date,
          description,
          subtotal,
          tax,
          total,
          status,
        },
      }
    )
    .then(async ([result]) => {
      const transaction_id = result.transaction_id;

      // Insert items
      for (const item of items) {
        await db.sequelize.query(
          `INSERT INTO transaction_data_items
           (transaction_id, description, account_code, quantity, unit_price, amount)
           VALUES (:transaction_id, :description, :account_code, :quantity, :unit_price, :amount)`,
          { replacements: { transaction_id, ...item } }
        );
      }

      // Insert attachments
      for (const file of attachments) {
        await db.sequelize.query(
          `INSERT INTO memo_documents
           (memo_id, document_name, file_path, original_name, file_size, mime_type, transaction_id)
           VALUES (:memo_id, :document_name, :file_path, :original_name, :file_size, :mime_type, :transaction_id)`,
          {
            replacements: {
              memo_id: invoice_number, // or another mapping
              document_name: file.document_name,
              file_path: file.file_path,
              original_name: file.original_name,
              file_size: file.file_size,
              mime_type: file.mime_type,
              transaction_id,
            },
          }
        );
      }

      res.json({ success: true, transaction_id });
    })
    .catch((err) => {
      res.status(500).json({ err });
      console.error(err);
    });
};

exports.getAllTransactionsData = async (req, res) => {
  try {
    const {
      facilityId,
      customerNo,
      supplierNo,
      type,
      search,
      page,
      pageSize,
      branchId,
      fromDate,
      toDate,
    } = req.query;
    const { Op } = db.Sequelize;

    if (!facilityId) {
      return res.status(400).json({
        success: false,
        message: "facilityId is required",
      });
    }

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(pageSize, 10) || 10));
    const offset = (pageNum - 1) * limitNum;

    // Optional branch filter — supports one or many branches. `branchId` may be
    // a single value, a comma-separated list ("1,2,3") or a repeated query param.
    const branchIdList = [...new Set(
      (Array.isArray(branchId) ? branchId : [branchId])
        .filter((v) => v != null)
        .flatMap((v) => String(v).split(","))
        .map((v) => parseInt(String(v).trim(), 10))
        .filter((v) => Number.isFinite(v) && v > 0)
    )];
    const hasBranchFilter = branchIdList.length > 0;
    const branchIdWhere = branchIdList.length === 1
      ? branchIdList[0]
      : { [Op.in]: branchIdList };

    // Normalize type parameter based on actual database types
    // Database contains: "customer deposit", "sales", "supplier payment", "purchase"
    let typeFilter = null;
    if (type) {
      const typeLower = type.toLowerCase().trim();
      // Map query types to actual database types
      if (
        typeLower === "customer deposit" ||
        typeLower === "customer_deposit"
      ) {
        typeFilter = ["customer deposit"]; // Query for customer deposit type
      } else if (typeLower === "sales") {
        typeFilter = ["sales"]; // Query for sales type
      } else if (
        typeLower === "supplier payment" ||
        typeLower === "supplier_deposit"
      ) {
        typeFilter = ["supplier payment"]; // Query for supplier payment type
      } else if (typeLower === "purchase") {
        typeFilter = ["purchase"]; // Query for purchase type
      } else {
        // If unknown type, try to match exactly
        typeFilter = [type];
      }
    }

    // Build where clause dynamically based on query parameters
    const whereClause = {
      facility_id: facilityId,
    };

    // Filter by branch if provided (column may not yet exist on legacy DBs)
    if (hasBranchFilter) {
      whereClause.branchId = branchIdWhere;
    }

    // Filter by customer number if provided
    if (customerNo) {
      whereClause.customerNo = customerNo;
      // If type is not specified but customerNo is, include both customer deposit and sales
      if (!typeFilter) {
        typeFilter = ["customer deposit", "sales"];
      }
    }

    // Filter by supplier number if provided
    if (supplierNo) {
      whereClause.ref_number = supplierNo;
      // If type is not specified but supplierNo is, include both supplier payment and purchase
      if (!typeFilter) {
        typeFilter = ["supplier payment", "purchase"];
      }
    }

    // Filter by invoice type(s) if provided
    if (typeFilter && typeFilter.length > 0) {
      if (typeFilter.length === 1) {
        whereClause.type = typeFilter[0];
      } else {
        // Use Sequelize Op.in for multiple types
        whereClause.type = { [Op.in]: typeFilter };
      }
    }

    // Sales Invoices page: only real sale invoices (INV-123), not credit notes (CN-*)
    // or opening-balance docs (OP-*, INV-OB-*, OB-*).
    const salesOnlyList =
      typeFilter &&
      typeFilter.length === 1 &&
      String(typeFilter[0]).toLowerCase() === "sales" &&
      !customerNo;
    if (salesOnlyList) {
      whereClause.invoice_ref = { [Op.regexp]: "^INV-[0-9]+$" };
    }

    // Optional transaction_date range (YYYY-MM-DD) — compare by calendar date
    const fromDateStr =
      fromDate && String(fromDate).trim()
        ? String(fromDate).trim().slice(0, 10)
        : null;
    const toDateStr =
      toDate && String(toDate).trim()
        ? String(toDate).trim().slice(0, 10)
        : null;
    if (fromDateStr || toDateStr) {
      const dateParts = [];
      if (fromDateStr) {
        dateParts.push(
          db.Sequelize.where(
            db.Sequelize.fn("DATE", db.Sequelize.col("transaction_date")),
            { [Op.gte]: fromDateStr },
          ),
        );
      }
      if (toDateStr) {
        dateParts.push(
          db.Sequelize.where(
            db.Sequelize.fn("DATE", db.Sequelize.col("transaction_date")),
            { [Op.lte]: toDateStr },
          ),
        );
      }
      whereClause[Op.and] = [...(whereClause[Op.and] || []), ...dateParts];
    }

    // Optional text search across invoice_ref, description, ref_number (customer no)
    const finalWhere = search && String(search).trim()
      ? {
          [Op.and]: [
            whereClause,
            {
              [Op.or]: [
                { invoice_ref: { [Op.like]: `%${String(search).trim()}%` } },
                { description: { [Op.like]: `%${String(search).trim()}%` } },
                { ref_number: { [Op.like]: `%${String(search).trim()}%` } },
              ],
            },
          ],
        }
      : whereClause;

    // Debug logging (can be removed in production)
    console.log("Query parameters:", {
      facilityId,
      customerNo,
      supplierNo,
      type,
      typeFilter,
      search,
      branchId: hasBranchFilter ? branchIdList : null,
      fromDate: fromDateStr,
      toDate: toDateStr,
      page: pageNum,
      pageSize: limitNum,
    });

    // Fetch from invoices table with proper error handling (count first for pagination)
    let invoices = [];
    let totalCount = 0;
    try {
      const { count, rows } = await db.Invoice.findAndCountAll({
        where: finalWhere,
        order: [["created_at", "DESC"]],
        raw: true,
        limit: limitNum,
        offset,
      });
      totalCount = count;
      invoices = rows;
      console.log(`Found ${invoices.length} invoices (total ${totalCount})`);
    } catch (queryError) {
      console.error("Error executing invoice query:", queryError);
      // If ENUM constraint error, try querying without type filter first
      if (queryError.message && queryError.message.includes("ENUM")) {
        console.log(
          "ENUM constraint error detected, trying without type filter..."
        );
        const fallbackWhereClause = {
          facility_id: facilityId,
        };
        if (hasBranchFilter) {
          fallbackWhereClause.branchId = branchIdWhere;
        }
        if (customerNo) {
          fallbackWhereClause.ref_number = customerNo;
        } else if (supplierNo) {
          fallbackWhereClause.ref_number = supplierNo;
        }

        invoices = await db.Invoice.findAll({
          where: fallbackWhereClause,
          order: [["created_at", "DESC"]],
          raw: true,
        });

        // Filter by type in memory
        if (typeFilter && typeFilter.length > 0) {
          invoices = invoices.filter((inv) => typeFilter.includes(inv.type));
        }
      } else {
        throw queryError;
      }
    }

    // If no invoices found and we have a customerNo/supplierNo, try without type filter as fallback
    if (invoices.length === 0 && (customerNo || supplierNo)) {
      console.log(
        "No invoices found with type filter, trying without type filter..."
      );
      const fallbackWhereClause = {
        facility_id: facilityId,
      };
      if (hasBranchFilter) {
        fallbackWhereClause.branchId = branchIdWhere;
      }
      if (customerNo) {
        fallbackWhereClause.ref_number = customerNo;
      } else if (supplierNo) {
        fallbackWhereClause.ref_number = supplierNo;
      }

      try {
        const fallbackInvoices = await db.Invoice.findAll({
          where: fallbackWhereClause,
          order: [["created_at", "DESC"]],
          raw: true,
        });

        console.log(
          `Found ${fallbackInvoices.length} invoices without type filter`
        );

        // Use fallback results if found
        if (fallbackInvoices.length > 0) {
          // Filter by type in memory as fallback
          const filteredInvoices =
            typeFilter && typeFilter.length > 0
              ? fallbackInvoices.filter((inv) => typeFilter.includes(inv.type))
              : fallbackInvoices;

          if (filteredInvoices.length > 0) {
            console.log(
              `Using ${filteredInvoices.length} invoices from fallback query`
            );
            invoices = filteredInvoices;
          }
        }
      } catch (fallbackError) {
        console.error("Error in fallback query:", fallbackError);
        // Continue with empty invoices array
      }
    }

    // For sales type: resolve customer names from ref_number (customer no)
    let customerNameMap = {};
    if (typeFilter && typeFilter.includes("sales") && invoices.length > 0) {
      const customerNos = [...new Set(invoices.map((inv) => inv.ref_number).filter(Boolean))];
      if (customerNos.length > 0) {
        try {
          const customers = await db.Customer.findAll({
            where: {
              customerNo: { [Op.in]: customerNos },
              facilityId,
            },
            attributes: ["customerNo", "fullname"],
            raw: true,
          });
          customers.forEach((c) => {
            customerNameMap[c.customerNo] = c.fullname || c.customerNo;
          });
        } catch (err) {
          console.error("Error fetching customer names:", err);
        }
      }
    }

    // Resolve branch names for the returned invoices so the table can show them
    let branchNameMap = {};
    if (invoices.length > 0) {
      const branchIds = [
        ...new Set(
          invoices
            .map((inv) => inv.branchId)
            .filter((id) => Number.isFinite(id) && id > 0)
        ),
      ];
      if (branchIds.length > 0) {
        try {
          const branchRows = await db.Branch.findAll({
            where: { id: { [Op.in]: branchIds } },
            attributes: ["id", "branch_name"],
            raw: true,
          });
          branchRows.forEach((b) => {
            branchNameMap[b.id] = b.branch_name;
          });
        } catch (err) {
          console.error("Error fetching branch names:", err);
        }
      }
    }

    // Join sale workflow stage (pay → separate → warehouse → …) for sales invoices
    let workflowBySaleCode = {};
    let warehousesBySaleCode = {};
    const isSalesList =
      Array.isArray(typeFilter) &&
      typeFilter.some((t) => String(t).toLowerCase() === "sales");
    if (isSalesList && invoices.length > 0 && db.SaleWorkflow) {
      try {
        const saleCodes = [
          ...new Set(
            invoices.map((inv) => inv.invoice_ref).filter(Boolean),
          ),
        ];
        if (saleCodes.length) {
          const workflows = await db.SaleWorkflow.findAll({
            where: {
              facility_id: facilityId,
              sale_code: { [Op.in]: saleCodes },
            },
            attributes: [
              "sale_code",
              "status",
              "payment_type",
              "hold_overnight",
            ],
            raw: true,
          });
          const {
            SALE_WORKFLOW_STAGES,
          } = require("../models/sale_workflows");
          workflows.forEach((w) => {
            const meta =
              SALE_WORKFLOW_STAGES.find((s) => s.id === w.status) || null;
            workflowBySaleCode[w.sale_code] = {
              workflow_status: w.status,
              workflow_status_label: meta?.label || w.status,
              workflow_status_color: meta?.color || "slate",
              payment_type: w.payment_type,
              hold_overnight: Boolean(w.hold_overnight),
            };
          });

          // Warehouse / branch packs for each sale (names for Warehouse stage UI)
          if (db.SaleFulfillment) {
            const packs = await db.SaleFulfillment.findAll({
              where: {
                facility_id: facilityId,
                sale_code: { [Op.in]: saleCodes },
              },
              attributes: ["sale_code", "branch_id"],
              raw: true,
            });
            const packBranchIds = [
              ...new Set(
                packs
                  .map((p) => parseInt(p.branch_id, 10))
                  .filter((id) => Number.isFinite(id) && id > 0),
              ),
            ];
            const packBranchNameMap = { ...branchNameMap };
            const missingBranchIds = packBranchIds.filter(
              (id) => !packBranchNameMap[id],
            );
            if (missingBranchIds.length > 0 && db.Branch) {
              try {
                const extraBranches = await db.Branch.findAll({
                  where: { id: { [Op.in]: missingBranchIds } },
                  attributes: ["id", "branch_name"],
                  raw: true,
                });
                extraBranches.forEach((b) => {
                  packBranchNameMap[b.id] = b.branch_name;
                });
              } catch (err) {
                console.error(
                  "Error fetching fulfillment branch names:",
                  err,
                );
              }
            }
            packs.forEach((p) => {
              const name =
                packBranchNameMap[p.branch_id] ||
                (p.branch_id ? `Warehouse ${p.branch_id}` : null);
              if (!name) return;
              if (!warehousesBySaleCode[p.sale_code]) {
                warehousesBySaleCode[p.sale_code] = [];
              }
              if (!warehousesBySaleCode[p.sale_code].includes(name)) {
                warehousesBySaleCode[p.sale_code].push(name);
              }
            });
          }
        }
      } catch (err) {
        console.error("Error fetching sale workflows for invoices:", err);
      }
    }

    // Transform data to match frontend expectations
    const formattedInvoices = invoices.map((invoice) => {
      const wf = workflowBySaleCode[invoice.invoice_ref] || null;
      const warehouseNames =
        warehousesBySaleCode[invoice.invoice_ref] || [];
      return {
        id: invoice.invoice_id,
        invoice_id: invoice.invoice_id,
        first_document: invoice.ref_number || invoice.invoice_ref,
        invoice_ref: invoice.invoice_ref,
        ref_number: invoice.ref_number,
        transactionTypeName: invoice.type?.toUpperCase() || "N/A",
        type: invoice.type,
        customerName: customerNameMap[invoice.ref_number] || null,
        vendorName: null,
        employeeName: null,
        invoice_date: invoice.transaction_date || invoice.created_at,
        transaction_date: invoice.transaction_date,
        due_date: invoice.due_date,
        description: invoice.description,
        amount: parseFloat(invoice.amount || 0),
        total: parseFloat(invoice.amount || 0),
        status: invoice.payment_method === "posted" ? "posted" : "pending",
        payment_method: invoice.payment_method,
        branchId: invoice.branchId || null,
        branch_name: branchNameMap[invoice.branchId] || null,
        warehouse_names: warehouseNames,
        warehouse_name: warehouseNames.join(", ") || null,
        created_by: invoice.created_by,
        created_at: invoice.created_at,
        workflow_status: wf?.workflow_status || null,
        workflow_status_label: wf?.workflow_status_label || null,
        workflow_status_color: wf?.workflow_status_color || null,
        workflow_payment_type: wf?.payment_type || null,
        hold_overnight: wf?.hold_overnight || false,
      };
    });

    return res.json({
      success: true,
      results: formattedInvoices,
      count: formattedInvoices.length,
      totalCount: totalCount,
    });
  } catch (err) {
    console.error("Error fetching transactions:", err);
    return res.status(500).json({
      success: false,
      message: "Error fetching transactions",
      error: err.message,
    });
  }
};

/**
 * Flat sales line report — one row per store_entries sale line (qty_out).
 * GET /api/v1/transactions/sales-line-report?facilityId=&userId=&fromDate=&toDate=&branchId=&search=&category=
 */
exports.getSalesLineReport = async (req, res) => {
  try {
    const {
      facilityId,
      userId,
      fromDate,
      toDate,
      branchId,
      search = "",
      category = "",
      page,
      pageSize,
    } = req.query;

    if (!facilityId) {
      return res.status(400).json({
        success: false,
        message: "facilityId is required",
      });
    }
    if (!userId) {
      return res.status(400).json({
        success: false,
        message: "userId is required",
      });
    }

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(500, Math.max(1, parseInt(pageSize, 10) || 100));
    const offset = (pageNum - 1) * limitNum;

    const replacements = {
      facilityId,
      userId: String(userId),
      limit: limitNum,
      offset,
    };

    const salesTypes = salesTypesSqlList();

    const whereParts = [
      "se.facilityId = :facilityId",
      "se.qty_out > 0",
      `(
        se.type IN (${salesTypes})
        OR se.destination = 'sold'
        OR LOWER(TRIM(se.source)) = 'for sales'
      )`,
      "se.reference_number IS NOT NULL",
      "TRIM(se.reference_number) != ''",
    ];

    if (fromDate && String(fromDate).trim()) {
      whereParts.push(
        "DATE(COALESCE(i.transaction_date, se.createdAt, se.receive_date)) >= :fromDate",
      );
      replacements.fromDate = String(fromDate).trim();
    }
    if (toDate && String(toDate).trim()) {
      whereParts.push(
        "DATE(COALESCE(i.transaction_date, se.createdAt, se.receive_date)) <= :toDate",
      );
      replacements.toDate = String(toDate).trim();
    }

    const branchIdList = [...new Set(
      (Array.isArray(branchId) ? branchId : [branchId])
        .filter((v) => v != null)
        .flatMap((v) => String(v).split(","))
        .map((v) => parseInt(String(v).trim(), 10))
        .filter((v) => Number.isFinite(v) && v > 0),
    )];

    if (branchIdList.length > 0) {
      replacements.branchIds = branchIdList;
      whereParts.push("COALESCE(se.branchId, i.branchId, 0) IN (:branchIds)");
    } else {
      const userBranches = await db.sequelize.query(
        `SELECT branch_id
         FROM user_branches
         WHERE user_id = :userId
           AND facility_id = :facilityId`,
        {
          replacements: { userId: String(userId), facilityId },
          type: db.sequelize.QueryTypes.SELECT,
        },
      );
      if (userBranches.length > 0) {
        replacements.branchIds = userBranches.map((r) => r.branch_id);
        whereParts.push(
          "(COALESCE(se.branchId, i.branchId, 0) IN (:branchIds) OR COALESCE(se.branchId, i.branchId) IS NULL)",
        );
      }
    }

    const searchTerm = String(search || "").trim();
    if (searchTerm) {
      whereParts.push(`(
        se.reference_number LIKE :search
        OR COALESCE(c_inv.fullname, c_ce.fullname, c_gl.fullname, '') LIKE :search
        OR COALESCE(c_inv.customerNo, ce_sales.customerNo, gl_recv.customer_no, '') LIKE :search
        OR COALESCE(p.name, se.product_id, '') LIKE :search
        OR COALESCE(p.category, '') LIKE :search
      )`);
      replacements.search = `%${searchTerm}%`;
    }

    const categoryTerm = String(category || "").trim();
    if (categoryTerm) {
      if (
        categoryTerm.toLowerCase() === "uncategorized" ||
        categoryTerm === "-"
      ) {
        whereParts.push(
          "(p.category IS NULL OR TRIM(p.category) = '')",
        );
      } else {
        whereParts.push(
          "LOWER(TRIM(COALESCE(p.category, ''))) = LOWER(TRIM(:category))",
        );
        replacements.category = categoryTerm;
      }
    }

    const whereSql = whereParts.join(" AND ");

    const lineAmountSql = `se.qty_out * COALESCE(NULLIF(se.selling_price, 0), se.cost_price, 0)`;

    const fromSql = `
      FROM store_entries se
      LEFT JOIN invoices i
        ON i.facility_id = se.facilityId
       AND i.type = 'sales'
       AND i.invoice_ref = se.reference_number
      LEFT JOIN customers c_inv
        ON c_inv.facilityId = se.facilityId
       AND c_inv.customerNo = i.ref_number
      LEFT JOIN (
        SELECT ce.receiptNo, ce.facilityId, MIN(ce.customerNo) AS customerNo
        FROM customer_entries ce
        WHERE ce.type IN ('sales', 'service', 'pro-bono', 'discount', 'tax')
          AND ce.customerNo IS NOT NULL
          AND TRIM(ce.customerNo) != ''
        GROUP BY ce.receiptNo, ce.facilityId
      ) ce_sales
        ON ce_sales.receiptNo = se.reference_number
       AND ce_sales.facilityId = se.facilityId
      LEFT JOIN customers c_ce
        ON c_ce.facilityId = se.facilityId
       AND c_ce.customerNo = ce_sales.customerNo
      LEFT JOIN (
        SELECT gl.reference_number,
               gl.facility_id,
               MAX(CASE WHEN gl.dr > 0 THEN gl.transaction_ref END) AS customer_no,
               MAX(CASE WHEN gl.dr > 0 THEN gl.payee END) AS payee
        FROM general_ledger gl
        WHERE LOWER(gl.type) IN ('receivable', 'recevable')
        GROUP BY gl.reference_number, gl.facility_id
      ) gl_recv
        ON gl_recv.reference_number = se.reference_number
       AND gl_recv.facility_id = se.facilityId
      LEFT JOIN customers c_gl
        ON c_gl.facilityId = se.facilityId
       AND c_gl.customerNo = gl_recv.customer_no
      LEFT JOIN products p
        ON p.facility_id = se.facilityId
       AND p.sku = se.product_id
      LEFT JOIN branches b
        ON b.id = COALESCE(NULLIF(se.branchId, 0), NULLIF(i.branchId, 0))
      LEFT JOIN users u_sp
        ON CAST(u_sp.id AS CHAR) = CAST(COALESCE(NULLIF(TRIM(se.user_id), ''), NULLIF(TRIM(se.inserted_by), '')) AS CHAR)
      LEFT JOIN (
        SELECT
          ce.receiptNo,
          ce.facilityId,
          COALESCE(SUM(ce.cost), 0) AS vat_amount
        FROM customer_entries ce
        WHERE LOWER(TRIM(ce.type)) = 'tax'
        GROUP BY ce.receiptNo, ce.facilityId
      ) inv_vat
        ON inv_vat.receiptNo = se.reference_number
       AND inv_vat.facilityId = se.facilityId
      LEFT JOIN (
        SELECT
          se2.reference_number,
          se2.facilityId,
          COALESCE(SUM(
            se2.qty_out * COALESCE(NULLIF(se2.selling_price, 0), se2.cost_price, 0)
          ), 0) AS goods_total
        FROM store_entries se2
        WHERE se2.qty_out > 0
          AND se2.reference_number IS NOT NULL
          AND TRIM(se2.reference_number) != ''
        GROUP BY se2.reference_number, se2.facilityId
      ) inv_goods
        ON inv_goods.reference_number = se.reference_number
       AND inv_goods.facilityId = se.facilityId
    `;

    const countRows = await db.sequelize.query(
      `SELECT COUNT(*) AS total ${fromSql} WHERE ${whereSql}`,
      {
        replacements,
        type: db.sequelize.QueryTypes.SELECT,
      },
    );
    const totalCount = parseInt(countRows[0]?.total || 0, 10);

    const rows = await db.sequelize.query(
      `SELECT
         se.reference_number AS invoice_no,
         COALESCE(i.transaction_date, se.createdAt, se.receive_date) AS invoice_date,
         COALESCE(
           c_inv.fullname,
           c_ce.fullname,
           c_gl.fullname,
           CASE
             WHEN gl_recv.payee LIKE '%—%'
               THEN TRIM(SUBSTRING_INDEX(gl_recv.payee, '—', -1))
             WHEN gl_recv.payee IS NOT NULL AND TRIM(gl_recv.payee) != ''
               THEN TRIM(gl_recv.payee)
             ELSE NULL
           END,
           '—'
         ) AS customer_name,
         COALESCE(
           c_inv.customerNo,
           ce_sales.customerNo,
           gl_recv.customer_no,
           ''
         ) AS customer_no,
         COALESCE(p.name, se.product_id, '—') AS product_name,
         COALESCE(p.sku, se.product_id, '') AS product_sku,
         COALESCE(p.category, '') AS product_category,
         COALESCE(p.item_type, '') AS item_type,
         CASE
           WHEN LOWER(TRIM(COALESCE(se.type, ''))) IN ('pro-bono', 'pro_bono')
             THEN 'pro-bono'
           WHEN LOWER(TRIM(COALESCE(se.type, ''))) = 'service'
             OR LOWER(TRIM(COALESCE(p.item_type, ''))) = 'service'
             THEN 'service'
           ELSE 'sales'
         END AS line_type,
         se.qty_out AS qty,
         COALESCE(NULLIF(se.selling_price, 0), se.cost_price, 0) AS unit_price,
         ${lineAmountSql} AS line_total,
         CASE
           WHEN COALESCE(inv_goods.goods_total, 0) > 0.0001
           THEN COALESCE(inv_vat.vat_amount, 0) * ((${lineAmountSql}) / inv_goods.goods_total)
           ELSE 0
         END AS vat_amount,
         COALESCE(NULLIF(se.branchId, 0), i.branchId) AS branch_id,
         COALESCE(b.branch_name, se.branch_name, '') AS branch_name,
         COALESCE(NULLIF(TRIM(se.user_id), ''), NULLIF(TRIM(se.inserted_by), ''), '') AS salesperson_id,
         COALESCE(
           NULLIF(TRIM(CONCAT(IFNULL(u_sp.firstname, ''), ' ', IFNULL(u_sp.lastname, ''))), ''),
           NULLIF(TRIM(u_sp.username), ''),
           NULLIF(TRIM(se.inserted_by), ''),
           '—'
         ) AS salesperson_name,
         se.id AS store_entry_id
       ${fromSql}
       WHERE ${whereSql}
       ORDER BY
         COALESCE(i.transaction_date, se.createdAt, se.receive_date) DESC,
         se.reference_number DESC,
         se.id ASC
       LIMIT :limit OFFSET :offset`,
      {
        replacements,
        type: db.sequelize.QueryTypes.SELECT,
      },
    );

    const results = rows.map((row) => {
      const lineTotal = parseFloat(row.line_total || 0) || 0;
      const vatAmount = parseFloat(row.vat_amount || 0) || 0;
      return {
        invoice_no: row.invoice_no,
        invoice_date: row.invoice_date,
        customer_name: row.customer_name || "",
        customer_no: row.customer_no || "",
        product_name: row.product_name || "—",
        product_sku: row.product_sku || "",
        product_category: row.product_category || "",
        item_type: row.item_type || "",
        category: row.product_category || row.item_type || "",
        line_type: row.line_type || "sales",
        basis: "sales",
        qty: parseFloat(row.qty || 0) || 0,
        unit_price: parseFloat(row.unit_price || 0) || 0,
        line_total: lineTotal,
        vat_amount: vatAmount,
        vat: vatAmount,
        total_incl_vat: lineTotal + vatAmount,
        branch_id: row.branch_id,
        branch_name: row.branch_name || "",
        salesperson_id: row.salesperson_id || "",
        salesperson_name: row.salesperson_name || "—",
        store_entry_id: row.store_entry_id,
      };
    });

    const lineTotalSum = results.reduce((s, r) => s + r.line_total, 0);
    const vatTotalSum = results.reduce((s, r) => s + r.vat_amount, 0);

    return res.json({
      success: true,
      results,
      count: results.length,
      totalCount,
      page: pageNum,
      pageSize: limitNum,
      totalPages: Math.ceil(totalCount / limitNum) || 0,
      summary: {
        line_total: lineTotalSum,
        vat_total: vatTotalSum,
        total_incl_vat: lineTotalSum + vatTotalSum,
      },
      userId: String(userId),
      source: "store_entries",
    });
  } catch (err) {
    console.error("getSalesLineReport error:", err);
    return res.status(500).json({
      success: false,
      message: "Error fetching sales line report",
      error: err.message,
    });
  }
};

/**
 * Flat purchase line report — one row per store_entries purchase line (qty_in).
 * GET /api/v1/transactions/purchase-line-report?facilityId=&userId=&fromDate=&toDate=&branchId=&search=
 */
exports.getPurchaseLineReport = async (req, res) => {
  try {
    const {
      facilityId,
      userId,
      fromDate,
      toDate,
      branchId,
      search = "",
      page,
      pageSize,
    } = req.query;

    if (!facilityId) {
      return res.status(400).json({
        success: false,
        message: "facilityId is required",
      });
    }
    if (!userId) {
      return res.status(400).json({
        success: false,
        message: "userId is required",
      });
    }

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(500, Math.max(1, parseInt(pageSize, 10) || 100));
    const offset = (pageNum - 1) * limitNum;

    const replacements = {
      facilityId,
      userId: String(userId),
      limit: limitNum,
      offset,
    };

    const whereParts = [
      "se.facilityId = :facilityId",
      "se.qty_in > 0",
      `(
        LOWER(TRIM(COALESCE(se.type, ''))) = 'purchase'
        OR LOWER(TRIM(COALESCE(se.source, ''))) LIKE '%purchase%'
      )`,
      "se.reference_number IS NOT NULL",
      "TRIM(se.reference_number) != ''",
    ];

    if (fromDate && String(fromDate).trim()) {
      whereParts.push(
        "DATE(COALESCE(i.transaction_date, se.createdAt, se.receive_date)) >= :fromDate",
      );
      replacements.fromDate = String(fromDate).trim();
    }
    if (toDate && String(toDate).trim()) {
      whereParts.push(
        "DATE(COALESCE(i.transaction_date, se.createdAt, se.receive_date)) <= :toDate",
      );
      replacements.toDate = String(toDate).trim();
    }

    const branchIdList = [
      ...new Set(
        (Array.isArray(branchId) ? branchId : [branchId])
          .filter((v) => v != null)
          .flatMap((v) => String(v).split(","))
          .map((v) => parseInt(String(v).trim(), 10))
          .filter((v) => Number.isFinite(v) && v > 0),
      ),
    ];

    if (branchIdList.length > 0) {
      replacements.branchIds = branchIdList;
      whereParts.push("COALESCE(se.branchId, i.branchId, 0) IN (:branchIds)");
    } else {
      const userBranches = await db.sequelize.query(
        `SELECT branch_id
         FROM user_branches
         WHERE user_id = :userId
           AND facility_id = :facilityId`,
        {
          replacements: { userId: String(userId), facilityId },
          type: db.sequelize.QueryTypes.SELECT,
        },
      );
      if (userBranches.length > 0) {
        replacements.branchIds = userBranches.map((r) => r.branch_id);
        whereParts.push(
          "(COALESCE(se.branchId, i.branchId, 0) IN (:branchIds) OR COALESCE(se.branchId, i.branchId) IS NULL)",
        );
      }
    }

    const searchTerm = String(search || "").trim();
    if (searchTerm) {
      whereParts.push(`(
        se.reference_number LIKE :search
        OR COALESCE(s_inv.supplier_name, s_code.supplier_name, '') LIKE :search
        OR COALESCE(i.ref_number, se.supplier_code, '') LIKE :search
        OR COALESCE(p.name, se.product_id, '') LIKE :search
      )`);
      replacements.search = `%${searchTerm}%`;
    }

    const whereSql = whereParts.join(" AND ");

    const fromSql = `
      FROM store_entries se
      LEFT JOIN invoices i
        ON i.facility_id = se.facilityId
       AND i.type = 'purchase'
       AND i.invoice_ref = se.reference_number
      LEFT JOIN suppliersinfo s_inv
        ON s_inv.facilityId = se.facilityId
       AND s_inv.supplier_number = i.ref_number
      LEFT JOIN suppliersinfo s_code
        ON s_code.facilityId = se.facilityId
       AND s_code.supplier_number = se.supplier_code
      LEFT JOIN products p
        ON p.facility_id = se.facilityId
       AND p.sku = se.product_id
      LEFT JOIN branches b
        ON b.id = COALESCE(NULLIF(se.branchId, 0), NULLIF(i.branchId, 0))
    `;

    const countRows = await db.sequelize.query(
      `SELECT COUNT(*) AS total ${fromSql} WHERE ${whereSql}`,
      {
        replacements,
        type: db.sequelize.QueryTypes.SELECT,
      },
    );
    const totalCount = parseInt(countRows[0]?.total || 0, 10);

    const rows = await db.sequelize.query(
      `SELECT
         se.reference_number AS invoice_no,
         COALESCE(i.transaction_date, se.createdAt, se.receive_date) AS invoice_date,
         COALESCE(
           s_inv.supplier_name,
           s_code.supplier_name,
           se.supplier_code,
           '—'
         ) AS supplier_name,
         COALESCE(
           i.ref_number,
           se.supplier_code,
           ''
         ) AS supplier_no,
         COALESCE(p.name, se.product_id, '—') AS product_name,
         COALESCE(p.sku, se.product_id, '') AS product_sku,
         COALESCE(p.category, '') AS product_category,
         COALESCE(p.item_type, '') AS item_type,
         'purchase' AS line_type,
         se.qty_in AS qty,
         COALESCE(NULLIF(se.cost_price, 0), se.selling_price, 0) AS unit_price,
         se.qty_in * COALESCE(NULLIF(se.cost_price, 0), se.selling_price, 0) AS line_total,
         COALESCE(NULLIF(se.branchId, 0), i.branchId) AS branch_id,
         COALESCE(b.branch_name, se.branch_name, '') AS branch_name,
         se.id AS store_entry_id
       ${fromSql}
       WHERE ${whereSql}
       ORDER BY
         COALESCE(i.transaction_date, se.createdAt, se.receive_date) DESC,
         se.reference_number DESC,
         se.id ASC
       LIMIT :limit OFFSET :offset`,
      {
        replacements,
        type: db.sequelize.QueryTypes.SELECT,
      },
    );

    const results = rows.map((row) => ({
      invoice_no: row.invoice_no,
      invoice_date: row.invoice_date,
      // Aliases so rebate ledger can reuse the same field names as sales
      customer_name: row.supplier_name || "",
      customer_no: row.supplier_no || "",
      supplier_name: row.supplier_name || "",
      supplier_no: row.supplier_no || "",
      product_name: row.product_name || "—",
      product_sku: row.product_sku || "",
      product_category: row.product_category || "",
      item_type: row.item_type || "",
      category: row.product_category || row.item_type || "",
      line_type: "purchase",
      basis: "purchase",
      qty: parseFloat(row.qty || 0) || 0,
      unit_price: parseFloat(row.unit_price || 0) || 0,
      line_total: parseFloat(row.line_total || 0) || 0,
      branch_id: row.branch_id,
      branch_name: row.branch_name || "",
      store_entry_id: row.store_entry_id,
    }));

    const lineTotalSum = results.reduce((s, r) => s + r.line_total, 0);

    return res.json({
      success: true,
      results,
      count: results.length,
      totalCount,
      page: pageNum,
      pageSize: limitNum,
      totalPages: Math.ceil(totalCount / limitNum) || 0,
      summary: { line_total: lineTotalSum },
      userId: String(userId),
      source: "store_entries",
      basis: "purchase",
    });
  } catch (err) {
    console.error("getPurchaseLineReport error:", err);
    return res.status(500).json({
      success: false,
      message: "Error fetching purchase line report",
      error: err.message,
    });
  }
};
