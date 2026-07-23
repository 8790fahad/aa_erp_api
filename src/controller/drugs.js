const db = require("../models");
const moment = require("moment");
const UUIDV4 = require("uuid").v4;

exports.addDrug = (req, res) => {
  const { facilityId } = req.body;
  const stmt =
    "call save_new_drug(:date,:drug,:unit_of_issue,:quantity,:price,:expiry_date,:facilityId)";
  db.sequelize
    .query(stmt, { replacements: { title, description, cost, facilityId } })
    .then((results) => res.json({ success: true, results }))
    .catch((err) => res.status(500).json({ err }));
};

function addDrugUpdateStmt(drugs = [], facilityId = "") {
  let drugNames = [];
  let change = "";

  drugs.forEach((d) => {
    change = change.concat(
      ' WHEN "' + d.drug + '" THEN quantity + ' + d.quantity
    );
    drugNames.push(d.drug);
  });

  let stmt = `UPDATE drugs
      SET quantity = (
        CASE drug ${change}
        END
      )
    WHERE drug IN("${drugNames.join('","')}") AND facilityId="${facilityId}";`;

  return stmt;
}

exports.batchAddDrug = (req, res) => {
  const { records, drugList, facilityId } = req.body;
  // console.log(records, drugList, facilityId)
  let stmt = addDrugUpdateStmt(drugList, facilityId);

  db.sequelize
    .query(
      `INSERT INTO drugpurchaserecords(
        date,drug,quantity,cost,expiry_date,supplier,generic_name,unit_of_issue,reorder_level,cost_price,markUp,selling_price,by_whom,payment_status,receipt_no,facilityId
      ) VALUES ${records.map((a) => "(?)").join(",")};`,
      {
        replacements: records,
      }
    )
    .then(() => {
      db.sequelize
        .query(stmt)
        .then((results) => {
          res.json({ success: true, results });
        })
        .catch((err) => {
          res.status(500).json({ success: false, err });
          console.log(err);
        });
    })
    .catch((err) => {
      res.status(500).json({ success: false, err });
      console.log(err);
    });
};

exports.getAll = (req, res) => {
  const { facilityId } = req.params;
  db.sequelize
    .query("call get_drugs_list(:facilityId)", {
      replacements: { facilityId },
    })
    .then((results) => res.json({ success: true, results }))
    .catch((err) => res.status(500).json({ err }));
};

exports.getDrugList = (req, res) => {
  db.sequelize
    .query("call get_list_of_drugs()")
    .then((results) => res.json({ success: true, results }))
    .catch((err) => res.status(500).json({ err }));
};

exports.getReceiptData = (req, res) => {
  const { repno, facilityId } = req.params;
  db.sequelize
    .query(
      "call add_sales(:in_query_type,:in_ref_no,:in_customer,:in_amount,:in_discount,:in_invoice,:in_operator,:in_facilityId)",
      {
        replacements: {
          in_query_type: "details",
          in_ref_no: repno,
          in_customer: "",
          in_amount: 0,
          in_discount: 0,
          in_invoice: "",
          in_operator: "system",
          in_facilityId: facilityId,
        },
      }
    )
    .then((results) => res.json({ success: true, results }))
    .catch((err) => {
      res.status(500).json({ success: false, err });
      console.log(err);
    });
};
exports.getReceiptData1 = (req, res) => {
  const { repno, facilityId } = req.params;
  db.sequelize
    .query("call getReceiptData(:repno,:facilityId)", {
      replacements: {
        repno: repno,
        facilityId,
      },
    })
    .then((results) => res.json({ success: true, results }))
    .catch((err) => {
      res.status(500).json({ success: false, err });
      console.log(err);
    });
};

exports.getDiscount = (req, res) => {
  const { reqno } = req.params;
  console.log(reqno);
  db.sequelize
    .query("call get_discount(:reqno)", {
      replacements: {
        reqno: reqno,
      },
    })
    .then((results) => res.json({ success: true, results }))
    .catch((err) => res.status(500).json({ err }));
};
exports.getOtherExpenses = (req, res) => {
  const { reqno } = req.params;
  console.log(reqno);
  db.sequelize
    .query("call get_other_expenses(:reqno)", {
      replacements: {
        reqno: reqno,
      },
    })
    .then((results) => res.json({ success: true, results }))
    .catch((err) => res.status(500).json({ err }));
};

exports.addNewDrug = (req, res) => {
  const {
    drug,
    unit_of_issue,
    quantity,
    price,
    expiry_date,
    genericName,
    reorder_level,
    expiryAlert,
    facilityId,
  } = req.body;
  // console.log(reorder_level)
  const stmt =
    "call add_new_drug(:drug,:unit_of_issue,:quantity,:price,:expiry_date,:genericName,:reorderlevel,:expiryalert,:facilityId)";
  db.sequelize
    .query(stmt, {
      replacements: {
        drug,
        unit_of_issue,
        quantity,
        price,
        expiry_date,
        genericName,
        reorderlevel: reorder_level,
        expiryalert: expiryAlert,
        facilityId,
      },
    })
    .then((results) => res.json({ success: true, results }))
    .catch((err) => {
      res.status(500).json({ success: false, err });
      console.log(err);
    });
};

// exports.updateDrug = (req, res) => {
//   const {
//     drug,
//     unit_of_issue,
//     quantity,
//     price,
//     expiry_date,
//     reorder_level,
//     genericName,
//     expiryAlert,
//     facilityId,
//   } = req.body;
//   const { drugId } = req.params;

//   db.sequelize
//     .query(
//       `UPDATE drugpurchaserecords
//         SET drug="${drug}",expiry_date="${expiry_date}",quantity="${quantity}",price="${price}",unit_of_issue="${unit_of_issue}",
//         reorder_level="${reorder_level}",expiryAlert="${expiryAlert}",genericName="${genericName}",
//         facilityId="${facilityId}" WHERE drug_id = "${drugId}";`
//       // 'call update_drug(:drugId,:drug,:generic,:expiry_date,:quantity,:price,:unit_of_issue,:rLevel,:expiryAlert,:facilityId)',
//       // {
//       //   replacements: {
//       //     drugId,
//       //     drug,
//       //     unit_of_issue,
//       //     quantity,
//       //     price,
//       //     expiry_date,
//       //     rLevel: reorder_level,
//       //     expiryAlert,
//       //     generic: genericName,
//       //     facilityId,
//       //   },
//       // },
//     )
//     .then((results) => res.json({ success:true, results }))
//     .catch((err) => res.status(500).json({ err }));
// };

exports.updateDrug = (req, res) => {
  const {
    drug,
    unit_of_issue,
    quantity,
    price,
    expiry_date,
    reorder_level,
    genericName,
    expiryAlert,
    facilityId,
  } = req.body;
  const { drugId } = req.params;

  db.sequelize
    .query(
      `UPDATE drugpurchaserecords
        SET drug="${drug}",quantity="${quantity}",cost_price="${price}",unit_of_issue="${unit_of_issue}",
        reorder_level="${reorder_level}",expiryAlert="${expiryAlert}",genericName="${genericName}",
         WHERE drug="${drug}" AND expiry_date = "${expiry_date}" AND facilityId="${facilityId}";`
    )
    .then((results) => res.json({ success: true, results }))
    .catch((err) => res.status(500).json({ err }));
};

exports.deleteDrug = (req, res) => {
  const { facilityId } = req.body;
  const { drugId } = req.params;
  db.sequelize
    .query("call delete_drug(:drugId,:facilityId)", {
      replacements: { drugId, facilityId },
    })
    .then((results) => res.json({ success: true, results }))
    .catch((err) => res.status(500).json({ err }));
};

exports.updateDrugQttyById = (req, res) => {
  const { quantity, drugId } = req.params;
  const { facilityId } = req.body;
  db.sequelize
    .query("call update_drug_qtty(:drugId,:quantity,:facilityId)", {
      replacements: { drugId, quantity, facilityId },
    })
    .then((results) => res.json({ success: true, results }))
    .catch((err) => res.status(500).json({ err }));
};

function drugQttyUpdateStmt(drugList, facilityId) {
  let drugNames = [];

  let change = "";

  drugList.forEach((d) => {
    change = change.concat(
      ' WHEN "' +
        d.drug +
        '" AND expiry_date="' +
        d.expiry_date +
        '" THEN quantity - ' +
        d.quantity
    );
    drugNames.push(d.drug);
  });
  // drugpurchase
  let stmt = `UPDATE drugpurchaserecords
      SET quantity = (
        CASE drug ${change}
        END
      )
    WHERE drug IN("${drugNames.join('","')}") AND facilityId="${facilityId}";`;

  return stmt;
}

exports.dispenseDrugs = (req, res) => {
  const { data, facilityId } = req.body;
  console.log(data);
  // console.log(finalData)
  let finalData = [];

  data.dispense &&
    data.dispense.forEach((item) => {
      finalData.push([...item, facilityId]);
      console.log(finalData);
    });

  let updateStmt = drugQttyUpdateStmt(data.drugs, facilityId);
  db.sequelize
    .query(
      `INSERT INTO dispensary(drug, dosage, quantity_dispensed, unit_of_issue, amount,discount,price,total, patient_id, dispensed_by, facilityId) VALUES ${finalData
        .map((a) => "(?)")
        .join(",")};`,
      {
        replacements: finalData,
      }
    )
    .then(() => {
      console.log(updateStmt);
      db.sequelize
        .query(updateStmt)
        .then((results) => {
          res.json({ success: true, results });
        })
        .catch((err) => {
          res.status(500).json({ success: false, err });
          console.log(err);
        });
    })
    .catch((err) => {
      res.status(500).json({ success: false, err });
      console.log(err);
    });
};

exports.getDrugPriceById = (req, res) => {
  const { drugId, facilityId } = req.params;
  db.sequelize
    .query("call get_drug_price_by_id(:id, :facilityId)", {
      replacements: { id: drugId, facilityId },
    })
    .then((results) => res.json({ price: results[0].price }))
    .catch((err) => res.status(500).json({ err }));
};

exports.getExpiryAlert = (req, res) => {
  const { facilityId } = req.params;
  db.sequelize
    .query("call drug_expiry_alert(:facilityId)", {
      replacements: { facilityId },
    })
    .then((results) => res.json({ success: true, results }))
    .catch((err) => res.status(500).json({ err }));
};

exports.getExpiredDrugs = (req, res) => {
  const { facilityId } = req.params;
  db.sequelize
    .query("call get_expired_drugs(:facilityId)", {
      replacements: { facilityId },
    })
    .then((results) => res.json({ success: true, results }))
    .catch((err) => res.status(500).json({ err }));
};

exports.getQttyAlert = (req, res) => {
  const { facilityId } = req.params;
  db.sequelize
    .query("call drug_qtty_alert(:facilityId)", {
      replacements: { facilityId },
    })
    .then((results) => res.json({ success: true, results }))
    .catch((err) => res.status(500).json({ err }));
};

exports.newDrugPurchase = (req, res) => {
  const {
    drug_code,
    drug,
    cost,
    expiry,
    generic,
    unit_of_issue,
    reorder,
    markup,
    quantity,
    userId,
    supplierId,
    paymentStatus,
    date,
    receipt_image,
    expiry_alert,
    description,
    source,
    amount,
    receiptsn,
    receiptno,
    modeOfPayment,
    destination,
    sourceAcct,
    facilityId,
    selling_price,
  } = req.body;
  console.log(req.body);

  db.sequelize
    .query(
      `CALL new_drug_purchase(:drug,:cost,:expiry,:generic,:unit_of_issue,:reorder,:markup,
        :quantity,:userId,:supplierId,:paymentStatus,:date,:receipt_image,:expiry_alert,:description,
        :source,:amount,:receiptsn,:receiptno,:modeOfPayment,:destination,:facilityId,:drug_code,
        :selling_price,:in_date)`,
      {
        replacements: {
          drug_code,
          drug,
          cost,
          expiry,
          generic,
          unit_of_issue,
          reorder,
          markup,
          quantity,
          userId,
          supplierId,
          paymentStatus,
          date,
          receipt_image,
          expiry_alert,
          description,
          source: "30001",
          amount,
          receiptsn,
          receiptno,
          modeOfPayment,
          destination: sourceAcct ? sourceAcct : "",
          // destination: '30004',
          // modeOfPayment && modeOfPayment.toLowerCase() === 'cash'
          //   ? '400021'
          //   : '400022',
          facilityId,
          selling_price,
          in_date: moment().format("YYYY-MM-DD hh:mm:ss"),
        },
      }
    )
    .then((results) => {
      res.json({ success: true, results });
    })
    .catch((err) => {
      res.status(500).json({ success: false, err });
    });
};

exports.getDrugInfoFromDrugCode = (req, res) => {
  const { drugCode, facilityId } = req.params;

  db.sequelize
    .query(
      `SELECT drug,drug_code,generic_name,cost_price,balance,dispensary_balance,
        expiry_date,markup,supplier,unit_of_issue,supplier
        FROM drugpurchaserecords
        WHERE drug_code="${drugCode}" AND facilityId="${facilityId}"`
    )
    .then((results) => {
      res.json({ success: true, results: results[0] });
    })
    .catch((err) => {
      res.status(500).json({ success: false, err });
    });
};

exports.getDrugInfoFromDrugCodeForSale = (req, res) => {
  const { drugCode, facilityId } = req.params;

  db.sequelize
    .query(
      `SELECT drug,drug_code,(price + markup) as price,genericName as generic_name,
        unit_of_issue,expiry_date,supplier,
        expiry_date,markup
        FROM drugs
        WHERE drug_code="${drugCode}" AND facilityId="${facilityId}" AND source='dispensary'`
    )
    .then((results) => {
      res.json({ success: true, results: results[0] });
    })
    .catch((err) => {
      res.status(500).json({ success: false, err });
    });
};

exports.drugSearch = (req, res) => {
  let drug = req.query.drug || "";
  const { facilityId } = req.params;
  // drug like '%${drug}' OR drug like '${drug}%' OR drug_code like '%${drug}' OR drug_code like '${drug}%'
  db.sequelize
    .query(
      `
      SELECT drug,drug_code,generic_name,cost_price,cost_price+markUp as price,balance,dispensary_balance as d_balance,
        supplier,unit_of_issue,supplier, expiry_date,markUp as markup
        FROM drugpurchaserecords
        WHERE facilityId="${facilityId}" AND date(created_at) = (
          SELECT MIN(date(created_at)) FROM drugpurchaserecords WHERE drug like '%${drug}%' OR drug_code like '%${drug}%'
        ) AND (drug like '%${drug}%' OR drug_code like '%${drug}%')`
    )
    .then((results) => {
      res.json({ success: true, drugInfo: results[0] });
    })
    .catch((err) => {
      res.status(500).json({ success: false, err });
    });
};

exports.drugSearchForSale = (req, res) => {
  let item = req.query.item || "";
  // let branch=req.query.branch ||''
  const { facilityId, branch } = req.params;
  db.sequelize
    .query(
      `SELECT distinct  item_name,trn_number,quantity,location_to,expiring_date,selling_price,location_to FROM point_sale_table
    WHERE quantity>0  AND item_name like '%${item}%' and location_to="${branch}" group by item_name,expiring_date`
    )
    .then((results) => {
      res.json({ success: true, drugInfo: results[0] });
    })
    .catch((err) => {
      res.status(500).json({ success: false, err });
    });
};

exports.select_reviewer_expenses = (req, res) => {
  const { facilityId } = req.params;
  db.sequelize
    .query(`call select_reviewer_expenses(:facilityId)`, {
      replacements: {
        facilityId,
      },
    })
    .then((results) => {
      res.json({ success: true, results });
    })
    .catch((err) => {
      res.status(500).json({ success: false, err });
    });
};

exports.getReviewer = (req, res) => {
  const { facilityId } = req.params;
  db.sequelize
    .query(
      `call getReviewer(:facilityId)
    `,
      {
        replacements: {
          facilityId,
        },
      }
    )
    .then((results) => {
      res.json({ success: true, results });
    })
    .catch((err) => {
      res.status(500).json({ success: false, err });
    });
};

exports.getDrugQtty = (req, res) => {
  const { facilityId } = req.params;
  let drug = req.query.drugName || "";
  let code = req.query.drugCode || "";
  let expiry_date = req.query.expiry_date || "";

  db.sequelize
    .query(
      `SELECT dispensary_balance as balance, cost_price + markUp as price from drugpurchaserecords 
      WHERE drug='${drug}'  AND expiry_date='${expiry_date}'  and dispensary_balance>0
      AND facilityId="${facilityId}"`
    )
    .then((results) => {
      res.json({ success: true, results: results[0][0] });
    })
    .catch((err) => {
      res.status(500).json({ success: false, err });
    });
};

exports.getFactoryDrugQtty = (req, res) => {
  const { facilityId } = req.params;
  let drug = req.query.drugName || "";

  db.sequelize
    .query(
      `SELECT sum(qty_in - qty_out) as balance from drugs 
      WHERE drug='${drug}' AND source='dispensary' 
      AND facilityId="${facilityId}"`
    )
    .then((results) => {
      res.json({ success: true, results: results[0][0] });
    })
    .catch((err) => {
      res.status(500).json({ success: false, err });
    });
};

exports.moveDrugsToDispensary = (req, res) => {
  const {
    drug_code,
    drug,
    cost,
    expiry,
    generic,
    unit_of_issue,
    quantity,
    userId,
    facilityId,
    selling_price,
    supplierId,
    markup,
    itemSource,
    receiptsn,
    shift,
  } = req.body;
  // console.log(req.body);

  db.sequelize
    .query(
      `CALL move_items_to_dispensary(:drug,:cost,:expiry,:drug_code,:price,
        :unit_of_issue,:quantity,:userId,:generic,:facilityId,:supplierId,
        :itemSource,:markup,:receiptsn,:shift)`,
      {
        replacements: {
          drug_code,
          drug,
          cost: cost ? cost : 0,
          expiry,
          generic: generic ? generic : "",
          unit_of_issue: unit_of_issue ? unit_of_issue : 0,
          quantity,
          userId,
          facilityId,
          price: selling_price ? selling_price : 0,
          supplierId,
          markup,
          itemSource,
          receiptsn,
          shift: shift ? shift : "",
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

exports.newPurchaseFromSupplier = (req, res) => {
  const {
    supplierId,
    amountPaid,
    receiptsn,
    receiptno,
    description,
    payment_mode,
    facId,
    destination,
    paymentStatus,
    goodsAmount,
    goodsHead,
    userId,
  } = req.body;
  //   CALL move_items_to_dispensary('DUSA ALKAMA',NULL,'','',NULL,
  //         '','50','admin-user','','d8d7a732-1832-4e25-9a98-e68ddc3f0b26','Production',
  //         'dispensary',0,'041120779','morning')
  // Executing (default): CALL new_purchase_from_supplier('Production',NULL,'admin-user','041120779',7,
  //             'Drugs Purchased from Production','Cash','d8d7a732-1832-4e25-9a98-e68ddc3f0b26','400021','Full Payment',NULL,'30001',
  //             '2020-11-04 02:36:28','500021')
  db.sequelize
    .query(
      `CALL new_purchase_from_supplier(:supplierAcc,:amountPaid,:userId,:receiptsn,:receiptno,
            :description,:payment_mode,:facId,:destination,:paymentStatus,:goodsAmount,:goodsHead,
            :in_date,:in_payables_head)`,
      {
        replacements: {
          supplierAcc: supplierId,
          amountPaid: amountPaid ? amountPaid : "0",
          receiptsn,
          receiptno,
          description,
          payment_mode,
          facId,
          paymentStatus,
          goodsAmount: goodsAmount ? goodsAmount : "0",
          destination,
          // payment_mode && payment_mode.toLowerCase() === 'cash'
          //   ? '400021'
          //   : '400022',
          goodsHead: "30001",
          userId,
          in_date: moment().format("YYYY-MM-DD hh:mm:ss"),
          in_payables_head: "500021",
        },
      }
    )
    .then((resp) => {
      res.json({ success: true, resp });
    })
    .catch((err) => {
      res.status(500).json({ success: false, err });
    });
};

exports.getInstantPayment = (req, res) => {
  const { facilityId } = req.params;
  db.sequelize
    .query(
      `SELECT accountNo FROM customers where accName="Instant Payment" AND facilityId="${facilityId}"`
    )
    .then((results) => {
      res.json({ success: true, results: results[0][0] });
    })
    .catch((err) => {
      res.status(500).json({ success: false, err });
    });
};

function getInstantAcc(facilityId, cb, error) {
  db.sequelize
    .query(
      `SELECT accountNo FROM customers where accName="Instant Payment" AND facilityId="${facilityId}"`
    )
    .then((resp) => {
      let instaAccNo = resp[0][0].accountNo;
      cb(instaAccNo);
    })
    .catch((err) => {
      error(err);
      console.log(err);
    });
}

exports.returnDrug = (req, res) => {
  const {
    drug,
    drug_code,
    genericName,
    cost,
    price,
    supplier,
    unit_of_issue,
    expiry_date,
    markup,
    quantityReturned,
    facilityId,
    userId,
    receipt_no,
    modeOfPayment,
    patientAcc,
    client_acct,
    bank,
    transaction_date,
    branch_name,
    trn_number,
    version_id = UUIDV4(),
    phone = "",
    customer_bank = "",
    customer_acc_no = "",
    transaction_amount = "",
    business_bank = "",
    business_bank_acc_no = "",
    _ref = "",
    receiptNo = "",
    amountPaid = 0,
    truckNo = "",
    waybillNo = "",
    itemList = "",
    txn_type = "",
  } = req.body;

  // getInstantAcc(
  //   facilityId,
  //   (instaAccNo) => {
  db.sequelize
    .query(
      "CALL record_returned_drugs(:quantityReturned,:receiptno,:d_code,:cost,:expiry_date,:facilityId,:userId,:drug,:price,:unit_of_issue,:supplier, :generic_name,:client_acc,:in_trn_number,:branch_name,:in_transaction_date)",
      {
        replacements: {
          drug,
          d_code: drug_code,
          generic_name: genericName,
          cost: price,
          price,
          supplier,
          unit_of_issue,
          expiry_date,
          markup,
          quantityReturned,
          facilityId,
          userId,
          receiptno: receipt_no,
          client_acc: patientAcc ? patientAcc : "",
          in_trn_number: trn_number ? trn_number : null,
          branch_name: branch_name ? branch_name : null,
          in_transaction_date: transaction_date ? transaction_date : null,
        },
      }
    )
    .then((results) => {
      db.sequelize
        .query(
          `CALL service_transaction(:description,:accNo,:amount,:receiptsn,:receiptno,:modeOfPayment,
            :accNo,:facilityId,:sourceAcct,:userId,:serviceHead,:transactionType,:in_date,
            :payables_head,:recievables_head,:bank,:txn_date,:in_discount,:in_discount_head,
            :in_customer_name, :branch_name,:quantity,:version_id,:phone,:customer_bank,:customer_acc_no,
            :transaction_amount,:business_bank,:business_bank_acc_no,:amountPaid,:truckNo,:waybillNo,
            :itemList,:txn_type)`,
          {
            replacements: {
              // drug_code,
              drug,
              cost,
              expiry: expiry_date,
              generic: genericName,
              unit_of_issue,
              quantity: quantityReturned ? quantityReturned : "",
              userId,
              supplierId: supplier,
              description: `Returned Drugs (${drug})`,
              amount: price * quantityReturned,
              receiptsn: receipt_no,
              receiptno: "",
              modeOfPayment,
              facilityId,
              selling_price: price,
              accNo: client_acct,
              transactionType: "insta",
              sourceAcct: "20001",
              serviceHead:
                modeOfPayment && modeOfPayment.toLowerCase() === "cash"
                  ? "400021"
                  : "400022",
              in_date: moment().format("YYYY-MM-DD hh:mm:ss"),
              payables_head: "500021",
              recievables_head: "400023",
              bank: bank ? bank : "",
              txn_date: transaction_date
                ? transaction_date
                : moment().format("YYYY-MM-DD"),
              branch_name: branch_name ? branch_name : "",
              in_discount: 0,
              in_discount_head: 0,
              in_customer_name: null,
              version_id,
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
          res.json({ success: true, results });
        })
        .catch((err) => {
          res.status(500).json({ success: false, err });
          console.log(err);
        });
    })
    .catch((err) => {
      res.status(500).json({ success: false, err });
      console.log(err);
    });
};

exports.newDrugSale = (req, res) => {
  console.log(req.body, "ADEWALE MURITALA");
  const {
    drug_code,
    account_name,
    drug,
    cost,
    expiry,
    generic,
    unit_of_issue,
    quantity,
    userId,
    supplierId,
    description,
    source,
    amount,
    trn_number,
    receiptsn,
    receiptno,
    modeOfPayment,
    destination,
    facilityId,
    selling_price,
    patientAcc,
    transactionType,
    sourceAcct,
    serviceHead,
    price,
    transaction_date,
    bank,
    amount1,
    amount2,
    discount,
    branch_name,
    item_code,
    version_id = UUIDV4(),
    phone = "",
    customer_bank = "",
    customer_acc_no = "",
    transaction_amount = "",
    business_bank = "",
    business_bank_acc_no = "",
    _ref = "",
    receiptNo = "",
    amountPaid = 0,
    truckNo = "",
    waybillNo = "",
    itemList,
    txn_type = "",
  } = req.body;

  db.sequelize
    .query(
      `SELECT accountNo FROM customers where accName="Instant Payment" AND facilityId="${facilityId}"`
    )
    .then((resp) => {
      let instaAccNo =
        (resp &&
          resp.length &&
          resp[0] &&
          resp[0][0] &&
          resp[0][0].accountNo) ||
        "";
      db.sequelize
        .query(
          `CALL new_drug_sale(:drug,:cost,:expiry,:generic,:unit_of_issue,
            :quantity,:userId,:supplierId,:description,:source,:amount,:receiptsn,
            :receiptno,:modeOfPayment,:destination,:facilityId,:drug_code,
            :selling_price,:accNo,:transactionType,:trn_number,:branch_name)`,
          {
            replacements: {
              drug: drug ? drug : "",
              cost: cost ? cost : 0,
              expiry: expiry ? expiry : "",
              generic: generic ? generic : "",
              unit_of_issue: unit_of_issue ? unit_of_issue : "",
              quantity: quantity ? quantity : "",
              userId: userId ? userId : "",
              supplierId: supplierId ? supplierId : "",
              description: description ? description : "",
              source: source ? source : "",
              amount: amount ? amount : "",
              receiptsn: receiptsn ? receiptsn : "",
              receiptno: receiptno ? receiptno : "",
              modeOfPayment: modeOfPayment ? modeOfPayment : "",
              destination: destination ? destination : "",
              facilityId: facilityId ? facilityId : "",
              drug_code: item_code ? item_code : "",
              selling_price: price ? price : 0,
              accNo: patientAcc ? patientAcc : instaAccNo,
              transactionType: transactionType ? transactionType : "",
              trn_number: trn_number ? trn_number : null,
              branch_name: branch_name ? branch_name : null,
            },
          }
        )
        .then((results) => {
          db.sequelize
            .query(
              `CALL service_transaction(:description,:accNo,:amount,:receiptsn,:receiptno,:modeOfPayment,
                  :accNo,:facilityId,:sourceAcct,:userId,:serviceHead,:transactionType,:in_date,
                  :payables_head,:recievables_head,:bank,:txn_date,:in_discount,:in_discount_head,
                  :account_name, :branch_name,:quantity,:version_id,:phone,:customer_bank,:customer_acc_no,
                  :transaction_amount,:business_bank,:business_bank_acc_no,:amountPaid,:truckNo,:waybillNo,
                  :itemList,:txn_type)`,
              {
                replacements: {
                  drug_code: drug_code ? drug_code : "",
                  drug: drug ? drug : "",
                  cost: cost ? cost : "",
                  expiry: expiry ? expiry : "",
                  generic: generic ? generic : "",
                  unit_of_issue: unit_of_issue ? unit_of_issue : "",
                  quantity: quantity ? quantity : "",
                  userId: userId ? userId : "",
                  supplierId: supplierId ? supplierId : "",
                  description: description ? description : "",
                  source: source ? source : "",
                  amount: amount ? amount : "",
                  receiptsn: receiptsn ? receiptsn : "",
                  receiptno: receiptno ? receiptno : "",
                  modeOfPayment: modeOfPayment ? modeOfPayment : "",
                  destination: destination ? destination : "",
                  facilityId: facilityId ? facilityId : "",
                  selling_price: selling_price ? selling_price : "",
                  accNo: patientAcc ? patientAcc : instaAccNo,
                  transactionType: transactionType ? transactionType : "",
                  sourceAcct:
                    modeOfPayment.toLowerCase() === "cash"
                      ? "400021"
                      : "400022",
                  serviceHead: "20025",
                  in_date: moment().format("YYYY-MM-DD hh:mm:ss"),
                  payables_head: "500021",
                  recievables_head: "400023",
                  bank: bank ? bank : "",
                  txn_date: moment().format("YYYY-MM-DD"),
                  in_discount: discount,
                  in_discount_head: "30002",
                  account_name: account_name,
                  branch_name: branch_name ? branch_name : "",
                  quantity: quantity ? quantity : "",
                  version_id,
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
    })
    .then(
      db.sequelize.query(
        `call add_items_in_branch_store(:in_trn_number,:in_item_name,:in_qty_out,:in_expiring_date,:in_selling_price,:in_transaction_date,:cash_pos,:bank_bank_tranfer,:receiptsn,:in_location_from, :in_location_to,:in_item_code,:version_id)`,
        {
          replacements: {
            in_trn_number: trn_number ? trn_number : 0,
            in_item_name: drug,
            in_qty_out: quantity,
            in_expiring_date: expiry ? expiry : null,
            in_selling_price: price,
            in_transaction_date: moment().format("YYYY-MM-DD"),
            cash_pos: amount1,
            bank_bank_tranfer: amount2 || 0,
            receiptsn,
            in_location_from: branch_name ? branch_name : "",
            in_location_to: "pos",
            in_item_code: item_code,
            version_id,
          },
        }
      )
    )
    .catch((err) => {
      console.log(err);
      res.status(500).json({ success: false, err });
    });
};

exports.getPurchaseRecords = (req, res) => {
  const { facilityId } = req.params;
  db.sequelize
    .query("call get_purchase_records(:facilityId)", {
      replacements: { facilityId },
    })
    .then((results) => res.json({ success: true, results }))
    .catch((err) => res.status(500).json({ err }));
};

exports.getDispensaryRecords = (req, res) => {
  const { facilityId } = req.params;
  db.sequelize
    .query("call get_dispensary_records(:facilityId)", {
      replacements: { facilityId },
    })
    .then((results) => res.json({ success: true, results }))
    .catch((err) => res.status(500).json({ err }));
};

exports.getPendingPurchase = (req, res) => {
  const { facilityId } = req.params;
  db.sequelize
    .query("call get_pending_purchases(:facilityId)", {
      replacements: { facilityId },
    })
    .then((results) => res.json({ success: true, results }))
    .catch((err) => res.status(500).json({ err }));
};

exports.batchAddDrugsWithoutPurchase = (req, res) => {
  db.sequelize
    .query(
      `insert into drugs(drug,unit_of_issue,quantity,expiry_date,price,facilityId) VALUES ${data
        .map((a) => "(?)")
        .join(",")};`,
      {
        replacements: data,
      }
    )
    .then((results) => {
      res.json({ results });
    })
    .catch((err) => res.status(500).json({ err }));
};

exports.addNewSupplier = async (req, res) => {
  const {
    _id = 0,
    _rev = "",
    name,
    head,
    subhead,
    facilityID,
    address,
    phone,
    supplier_type = "",
    tinnumber = "",
    // accountInfo,
    query_type = "create",
    vat = "",
    website = "",
    email = "",
    other_info = "",
    element = [],
    phone2 = "",
    balance = 0,
    // version_id=""
  } = req.body;
  console.log(req.body);

  let data = await db.sequelize.query(
    `select * from supplier_contact where head = '${head}'`
  );
  console.log(data.length, "data");
  if (data.length > 0) {
    db.sequelize
      .query(
        `update supplier_contact set phone = '${phone}',email = '${email}', address = '${address}' where head = '${head}'`
      )
      .then((data) => {
        console.log(data);
        if (element.length) {
          for (let k = 0; k < element.length; k++) {
            let item = element[k];
            console.log({ item });
            db.sequelize.query(
              `call supplier_account_info(:in_account_name,:in_account_number,:in_bank_name,:in_status,:in_sort_code,:in_facilityId,:in_head,:in_subhead)`,
              {
                replacements: {
                  in_account_name: item.acctName ? item.acctName : "",
                  in_account_number: item.acctNo ? item.acctNo : "",
                  in_bank_name: item.bank_name ? item.bank_name : "",
                  in_status: item.status ? item.status : "",
                  in_sort_code: item.sort_code ? item.sort_code : "",
                  in_facilityId: facilityID ? facilityID : "",
                  in_head: head,
                  in_subhead: subhead,
                },
              }
            );
          }
        }
      })
      .then((results) => {
        console.log(results);
        return res.json({ success: true, results });
      })
      .catch((err) => {
        res.status(500).json({ err });
        console.log(err);
      });
  }

  db.sequelize
    .query(
      `insert into supplier_contact(head,subhead,phone,email,address) values('${head}','${subhead}','${phone}','${email}','${address}')`
    )
    .then((data) => {
      console.log(data);
      if (element.length) {
        for (let k = 0; k < element.length; k++) {
          let item = element[k];
          console.log({ item });
          db.sequelize.query(
            `call supplier_account_info(:in_account_name,:in_account_number,:in_bank_name,:in_status,:in_sort_code,:in_facilityId,:in_supplier_code)`,
            {
              replacements: {
                in_account_name: item.acctName ? item.acctName : "",
                in_account_number: item.acctNo ? item.acctNo : "",
                in_bank_name: item.bank_name ? item.bank_name : "",
                in_status: item.status ? item.status : "",
                in_sort_code: item.sort_code ? item.sort_code : "",
                in_facilityId: facilityID ? facilityID : "",
                in_supplier_code: _id ? _id : altSupplierCode,
              },
            }
          );
        }
      }
    })
    .then((results) => res.json({ success: true, results }))
    .catch((err) => {
      res.status(500).json({ err });
      console.log(err);
    });
};

exports.getAllSuppliers = (req, res) => {
  const { facilityId } = req.params;
  db.sequelize
    .query("call get_all_suppliers(:facilityId)", {
      replacements: { facilityId },
    })
    .then((results) => res.json({ success: true, results }))
    .catch((err) => res.status(500).json({ err }));
};

exports.getSupplier = async (req, res) => {
  const { facilityId } = req.params;
  const { supplierId } = req.params;
  db.sequelize
    .query("call get_supplier(:facilityId,:supplierId)", {
      replacements: { facilityId, supplierId },
    })
    .then(async (results) => {
      // const banks = await db.sequelize.query(
      //   `select * from supplier_account_information where head = '${supplierId}'`,
      //   {
      //     replacements: { head: supplierId },
      //   }
      // );
      let supplier;
      let bankDetails;

      if (results.length > 0) {
        supplier = results[0];
      }

      // if (banks.length > 0) {
      //   console.log(banks[0]);
      //   bankDetails = banks[0];
      // }

      res.json({ success: true, supplier });
    })
    .catch((err) => console.log(err));
};

exports.getAllBanks = (req, res) => {
  const { facilityId } = req.params;

  if (!facilityId) {
    return res
      .status(400)
      .json({ success: false, error: "Facility ID is required" });
  }

  db.sequelize
    .query("CALL get_all_banks(:facilityId)", {
      replacements: { facilityId },
    })
    .then((results) => {
      const suppliersMap = new Map();

      console.log(results);
      results.forEach((row) => {
        if (!suppliersMap.has(row.supplier_number)) {
          suppliersMap.set(row.supplier_number, {
            facilityId: row.facilityId,
            supplier_code: row.supplier_number,
            supplier_name: `${row.supplier_name} - ${row.supplier_code}`,
            bankDetails: [],
          });
        }

        // Add bank details to the existing supplier entry
        suppliersMap.get(row.supplier_number)?.bankDetails.push({
          bankName: row.bank_name,
          accountNumber: row.account_number,
          accountName: row.account_name,
          sortCode: row.sort_code,
          status: row.status,
        });
      });

      const formattedResults = Array.from(suppliersMap.values());

      res.json({ success: true, results: formattedResults });
    })
    .catch((err) => {
      console.error("Database error:", err);
      res.status(500).json({ success: false, error: "Internal server error" });
    });
};

exports.updateSupplier = (req, res) => {
  console.log(req.body);

  const {
    facilityId,
    id,
    supplier_name,
    address,
    phone,
    supplier_code,
    website,
    tinnumber,
    supplier_type,
    vat,
    email,
    other_info,
  } = req.body.currentSupplier;
  const { accountInfo } = req.body;
  db.sequelize
    .query(
      "call update_supplier( :in_supplier_name, :in_address, :in_phone,:in_website,:in_tinnumber,:in_supplier_type,:in_vat,:in_email,:in_other_info,:supplierId,:facId)",
      {
        replacements: {
          in_supplier_name: supplier_name,
          in_address: address,
          in_phone: phone,
          in_website: website,
          in_tinnumber: tinnumber,
          in_supplier_type: supplier_type,
          in_vat: vat,
          in_email: email,
          in_other_info: other_info,
          supplierId: supplier_code,
          facId: facilityId,
        },
      }
    )
    .then(
      accountInfo.forEach((item) => {
        db.sequelize.query(
          `call update_supplier_bank_info(:in_status,:in_bank_name,:in_account_number,:in_account_name,:in_sort_code,:in_supplier_code,:in_id,:in_facilityId)`,
          {
            replacements: {
              in_status: item.status,
              in_bank_name: item.bank_name,
              in_account_number: item.account_number,
              in_account_name: item.account_name,
              in_sort_code: item.sort_code,
              in_supplier_code: item.supplier_code,
              in_id: item.id ? item.id : 0,
              in_facilityId: facilityId,
            },
          }
        );
      })
    )
    .then((results) => res.json({ success: true, results }))
    .catch((err) => {
      res.status(500).json({ err });
      console.log(err);
    });
};

exports.deleteSupplier = (req, res) => {
  const {
    body: { facilityId },
    params: { supplierId },
  } = req;
  db.sequelize
    .query("call delete_supplier(:supplierId, :facilityId)", {
      replacements: { facilityId, supplierId },
    })
    .then((results) => res.json({ success: true, results }))
    .catch((err) => res.status(500).json({ err }));
};

exports.getUnitOfIssue = (req, res) => {
  const {
    params: { facilityId, drugName },
  } = req;
  db.sequelize
    .query("call getUnitOfIssue(:drugName,:facilityId)", {
      replacements: {
        drugName,
        facilityId,
      },
    })
    .then((results) => res.json({ success: true, results }))
    .catch((err) => res.status(500).json({ err }));
};

exports.getSaleSummary = (req, res) => {
  const { facilityId, from, to } = req.params;
  let today = moment().format("YYYY-MM-DD");
  db.sequelize
    .query("call get_pharm_sales_summary(:facilityId, :from, :to)", {
      replacements: { facilityId, from, to },
    })
    .then((results) => res.json({ success: true, results }))
    .catch((err) => res.status(500).json({ err }));
};

exports.getPharmTotalStock = (req, res) => {
  const { facilityId } = req.params;
  db.sequelize
    .query("call get_pharm_total_stock(:facilityId)", {
      replacements: { facilityId },
    })
    .then((results) => res.json({ results: results[0] }))
    .catch((err) => res.status(500).json({ err }));
};

exports.getDrugsSoldWithinRange = (req, res) => {
  const { facilityId, from, to } = req.params;

  db.sequelize
    .query("call get_drugs_sold(:facilityId,:from,:to)", {
      replacements: { facilityId, from, to },
    })
    .then((results) => res.json({ success: true, results }))
    .catch((err) => res.status(500).json({ success: false, err }));
};

exports.getBestSellingStaff = (req, res) => {
  const { facilityId, from, to } = req.params;

  db.sequelize
    .query(
      `SELECT SUM(a.qty_out) + SUM(a.price) AS amount, concat(b.firstname, ' ', b.lastname) as staff 
        FROM drugs a JOIN users b on a.created_by = b.username WHERE date(a.created_at) 
        BETWEEN date("${from}") AND date("${to}") AND a.source='dispensary' 
        AND a.facilityId="${facilityId}" GROUP BY staff ORDER BY amount DESC`
    )
    // .query('call get_best_selling_staff(:facilityId,:from,:to)', {
    //   replacements: { facilityId, from, to },
    // })
    .then((results) => res.json({ success: true, results: results[0] }))
    .catch((err) => res.status(500).json({ success: false, err }));
};

exports.getTopFivePopularDrugsForToday = (req, res) => {
  const { facilityId } = req.params;
  const today = moment().format("YYYY-MM-DD");
  db.sequelize
    .query("call get_top_5_popular_drugs(:facilityId, :today)", {
      replacements: { facilityId, today },
    })
    .then((results) => res.json({ success: true, results }))
    .catch((err) => {
      res.status(500).json({ success: false, err });
      console.log(err);
    });
};

exports.getAllDrugs = (req, res) => {
  db.sequelize
    .query("SELECT DISTINCT drug from drugs")
    .then((results) => res.json({ success: true, results: results[0] }))
    .catch((err) => {
      console.log(err);
      res.status(500).json({ success: false, err });
    });
};

exports.getFastSellingItems = (req, res) => {
  const { from, to } = req.params;

  db.sequelize
    .query("call get_fast_selling_items(:from, :to)", {
      replacements: {
        from,
        to,
      },
    })
    .then((results) => res.json({ success: true, results }))
    .catch((err) => res.json({ success: false, err }));
};

exports.getMostProfitableItems = (req, res) => {
  const { from, to } = req.params;
  db.sequelize
    .query("CALL get_most_profitable(:from, :to)", {
      replacements: {
        from,
        to,
      },
    })
    .then((results) => res.json({ success: true, results }))
    .catch((err) => res.json({ success: false, err }));
};

exports.getDispensaryBalanceWithoutStore = (req, res) => {
  const { facilityId } = req.params;
  db.sequelize
    .query(
      `
  SELECT a.drug,a.qty_in as dispensary_quantity, a.qty_out ,a.price as cost_price, a.expiry_date,a.created_at,b.supplier_name as supplier 
    FROM drugs a JOIN suppliersinfo b ON a.supplier=b.id WHERE a.facilityId="${facilityId}" AND source='dispensary' ORDER BY created_at`
    )
    .then((results) => res.json({ success: true, results: results[0] }))
    .catch((err) => res.json({ success: false, err }));
};
// SELECT drug, SUM(qty_in)- SUM(qty_out) AS quantity_in_shelf, SUM(qty_in*(price+markup)) AS amount_in_shelf, SUM(qty_out) AS quantity_sold, sum(qty_out*(price+markup)) as amount_sold, source FROM drugs WHERE source='dispensary' GROUP BY drug

exports.getReturnedDrugs = (req, res) => {
  const { code, receiptNo } = req.params;
  db.sequelize
    .query(
      `SELECT (debit) as dr,description,quantity,transaction_id 
        FROM transactions 
        WHERE source = "${code}" And receipt_number = "${receiptNo}"`
    )
    .then((results) => res.json({ success: true, results: results[0] }))
    .catch((err) => res.status(500).json({ success: false, err }));
};

exports.updateDrugDispensaryMarkupAndQuantity = (req, res) => {
  const { drug, cost_price, markUp, quantity_in_shelf, expiry_date } = req.body;

  db.sequelize
    .query(
      `UPDATE drugpurchaserecords SET markUp='${markUp}', dispensary_balance='${quantity_in_shelf}' 
        WHERE drug='${drug}' AND cost_price='${cost_price}' AND expiry_date='${expiry_date}'`
    )
    .then((results) => {
      res.json({
        success: true,
        results,
      });
    })
    .catch((err) => res.json({ success: false, err }));
};

exports.deleteDrugsPurchase = (req, res) => {
  let drug = req.query.drug || "";
  let cost_price = req.query.cost_price || "";
  let expiry_date = req.query.expiry_date || "";
  db.sequelize
    .query(`call suspend_drugs(:drug,:cost_price,:expiry_date) `, {
      replacements: {
        drug,
        cost_price,
        expiry_date,
      },
    })
    .then((results) => res.json({ success: true, results: results }))
    .catch((err) => {
      console.log(err);
      res.status(500).json({ success: false, err });
    });
};

exports.suppliersAccountInfo = (req, res) => {
  const { suppliercode, facilityId } = req.params;
  db.sequelize
    .query("call get_supplier_account(:facilityId,:supplier_code)", {
      replacements: {
        facilityId: facilityId,
        supplier_code: suppliercode,
      },
    })
    .then((results) => res.json({ success: true, results: results }))
    .catch((err) => {
      console.log(err);
      res.status(500).json({ success: false, err });
    });
};
exports.filterPurchase = (req, res) => {
  const { status } = req.params;
  db.sequelize
    .query(`call filter_purchase(:status) `, {
      replacements: {
        status,
      },
    })
    .then((results) => res.json({ success: true, results: results }))
    .catch((err) => {
      console.log(err);
      res.status(500).json({ success: false, err });
    });
};
