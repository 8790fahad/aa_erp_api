const db = require("../models");
// const moment = require('moment');

exports.newService = (req, res) => {
  const { title, description, cost, accHead, facilityId } = req.body;
  db.sequelize
    .query(
      "call new_service(:title,:description,:cost, :accHead, :facilityId)",
      {
        replacements: { title, description, cost, accHead, facilityId },
      }
    )
    .then((results) => res.json({ results }))
    .catch((err) => res.status(500).json({ err }));
};

exports.getAllServices = (req, res) => {
  const { facilityId } = req.params;
  db.sequelize
    .query("call get_all_services(:facilityId)", {
      replacements: { facilityId },
    })
    .then((results) => res.json({ results }))
    .catch((err) => res.status(500).json({ err }));
};

exports.updateService = (req, res) => {
  const { description, title, cost, facilityId } = req.body;
  const { serviceId } = req.params;
  db.sequelize
    .query(
      "call update_services(:title,:description,:cost,:serviceId,:facilityId);",
      {
        replacements: { title, description, cost, serviceId, facilityId },
      }
    )
    .then((results) => res.json({ results }))
    .catch((err) => res.status(500).json({ err }));
};

exports.saveBatchPaidServices = (req, res) => {
  const { data, amount, accountNo, mode, user, receiptDateSN, receiptNo } =
    req.body;
  // console.log(data);
  // if(mode === 'deposit'){
  // const sqlstmt1 = `insert into transactions(description,debited,credited,debit,amount,credit,transaction_source,destination,enteredBy,receiptDateSN,receiptNo,modeOfPayment,paymentStatus,patient_id,facilityId) values ${data
  const sqlstmt1 = `insert into transactions(description,acct,debit,credit,enteredBy,receiptDateSN,receiptNo,modeOfPayment,paymentStatus,patient_id,facilityId,createdAt) values ${data
    .map((a) => "(?)")
    .join(",")};`;

  const sqlstmt2 = `UPDATE chartofaccount set balance = chartofaccount.balance + ${amount} WHERE chartofaccount.code = 'CLN';`;
  const sqlstmt3 = `UPDATE patientfileno set balance = patientfileno.balance - ${
    mode === "deposit" ? amount : 0
  } WHERE patientfileno.accountNo = '${accountNo}';`;
  // const callstmt = 'call save_batch_paid_services()'

  db.sequelize
    .query(sqlstmt1, {
      replacements: data,
      type: db.sequelize.QueryTypes.INSERT,
    })
    .then((results1) => {
      db.sequelize
        .query(sqlstmt2, { type: db.sequelize.QueryTypes.UPDATE })
        .then((results2) => {
          db.sequelize
            .query(sqlstmt3, { type: db.sequelize.QueryTypes.UPDATE })
            .then((results3) => res.json({ results3 }))
            .catch((err3) => {
              console.log(err3);
              res.status(500).json({ err3 });
            });
        })
        .catch((err2) => {
          console.log(err2);
          res.status(500).json({ err2 });
        });
    })
    .catch((err1) => {
      console.log(err1);
      res.status(500).json({ err1 });
    });
  // } else {
  // const depositstmt = `INSERT into transactions (transaction_source,destination,debited,credited,enteredBy,receiptDateSN,receiptNo,description,modeOfPayment) VALUES ("Deposit",${accountNo},${amount},0,${user},${receiptDateSN},${receiptNo},"Deposit",${mode});`
  // const sqlstmt1 = `insert into transactions(description,debited,credited,transaction_source,destination,enteredBy,receiptDateSN,receiptNo,modeOfPayment,paymentStatus,patient_id) values ${data
  //   .map(a => '(?)')
  //   .join(',')};`;
  // const sqlstmt1 = `insert into transactions(description,debited,credited,transaction_source,destination,enteredBy,receiptDateSN,receiptNo,modeOfPayment,paymentStatus,patient_id) values ${data
  //   .map(a => '(?)')
  //   .join(',')};`;

  // const sqlstmt2 = `UPDATE chartofaccount set balance = chartofaccount.balance + ${amount} WHERE chartofaccount.code = 'CLN';`;
  // const sqlstmt3 = `UPDATE patientfileno set balance = patientfileno.balance - ${mode==='deposit' ? amount : 0} WHERE patientfileno.accountNo = '${accountNo}';`;
  // const callstmt = 'call save_batch_paid_services()'

  // db.sequelize
  //   .query('call patient_deposit(:accountNo,:amount,:user,:receiptNo,:receiptId,:description,:mode)', {
  //     replacements: { accountNo,amount,user,receiptNo,receiptId: receiptNo,description,mode }
  //   })
  //   .then(result => {

  //   })
  //   .catch(err => res.status(500).json({ err }))
  // db.sequelize
  //   .query(sqlstmt1, {
  //     replacements: data,
  //     type: db.sequelize.QueryTypes.INSERT,
  //   })
  //   .then(results1 => {
  //     db.sequelize
  //       .query(sqlstmt2, { type: db.sequelize.QueryTypes.UPDATE })
  //       .then(results2 => {
  //         db.sequelize
  //           .query(sqlstmt3, { type: db.sequelize.QueryTypes.UPDATE })
  //           .then(results3 => res.json({ results3 }))
  //           .catch(err3 => res.status(500).json({ err3 }));
  //       })
  //       .catch(err2 => res.status(500).json({ err2 }));
  //   })
  //   .catch(err1 => res.status(500).json({ err1 }));
  // }
};

exports.prepareBill = (req, res) => {
  const { data } = req.body;
  const billstmt = `insert into transactions(description,debited,credited,transaction_source,destination,enteredBy,modeOfPayment,paymentStatus,patient_id,facilityId,createdAt) values ${data
    .map((a) => "(?)")
    .join(",")};`;

  db.sequelize
    .query(billstmt, {
      replacements: data,
      type: db.sequelize.QueryTypes.INSERT,
    })
    .then((results) => res.json({ results }));
};
export function settleSupplier(itemAmount, supplierBalance, paymentMade) {
  
  let totalAvailable = supplierBalance + paymentMade;
  let balanceAfter = totalAvailable - itemAmount;

  let result = {
    newBalance: balanceAfter,
    amountToPayOrReturn: 0,
    status: ""
  };

  if (balanceAfter === 0) {
    result.status = "settled";
  } else if (balanceAfter > 0) {
    // Advance still left after purchase
    result.status = "advance_remaining";
    result.amountToPayOrReturn = balanceAfter; // returnable or carry forward
  } else {
    // Negative = payable balance
    result.status = "still_owed";
    result.amountToPayOrReturn = Math.abs(balanceAfter); // extra to be paid
  }

  return result;
}

exports.payOutstanding = (req, res) => {
  const {
    outstandingServices,
    amount,
    accountNo,
    mode,
    receiptDateSN,
    receiptNo,
    facilityId,
  } = req.body;
  console.log(outstandingServices);
  const outstandingstmt = `UPDATE transactions set paymentStatus = "paid", receiptDateSN="${receiptDateSN}", receiptNo="${receiptNo}" where transaction_id IN(${outstandingServices.join(
    ","
  )}) and facilityId=${facilityId}`;
  const outstandingstmt2 = `UPDATE chartofaccount set balance = chartofaccount.balance + ${amount} WHERE chartofaccount.code = 'CLN';`;
  const outstandingstmt3 = `UPDATE patientfileno set balance = patientfileno.balance - ${
    mode === "deposit" ? amount : 0
  } WHERE patientfileno.accountNo = '${accountNo}' and facilityId=${facilityId};`;

  db.sequelize
    .query(outstandingstmt, { type: db.sequelize.QueryTypes.UPDATE })
    .then((outResult) => {
      db.sequelize
        .query(outstandingstmt2, { type: db.sequelize.QueryTypes.UPDATE })
        .then((results2) => {
          db.sequelize
            .query(outstandingstmt3, { type: db.sequelize.QueryTypes.UPDATE })
            .then((results3) => res.json({ results3 }))
            .catch((err3) => res.status(500).json({ err3 }));
        })
        .catch((err2) => res.status(500).json({ err2 }));
    })
    .catch((outErr) => res.status(500).json({ outErr }));
};

exports.saveBatchUnpaidServices = (req, res) => {
  const { data, amount, accountNo, mode, facilityId } = req.body;
  let newData = [];
  data.forEach((item) => newData.push(item.slice(0, 10)));

  const sqlstmt1 = `insert into transactions(description,debited,credited,transaction_source,destination,enteredBy,receiptDateSN,receiptNo,modeOfPayment,facilityId,createdAt) values ${data
    .map((a) => "(?)")
    .join(",")};`;
  const sqlstmt2 = `UPDATE chartofaccount set balance = chartofaccount.balance + ${amount} WHERE chartofaccount.code = 'CLN';`;
  const sqlstmt3 = `UPDATE patientfileno set balance = patientfileno.balance - ${
    mode === "deposit" ? amount : 0
  } WHERE patientfileno.accountNo = '${accountNo}' AND facilityId='${facilityId}';`;

  db.sequelize
    .query(sqlstmt1, {
      replacements: newData,
      type: db.sequelize.QueryTypes.INSERT,
    })
    .then((results1) => {
      db.sequelize
        .query(sqlstmt2, { type: db.sequelize.QueryTypes.UPDATE })
        .then((results2) => {
          db.sequelize
            .query(sqlstmt3, { type: db.sequelize.QueryTypes.UPDATE })
            .then((results3) => res.json({ results3 }))
            .catch((err3) => res.status(500).json({ err3 }));
        })
        .catch((err2) => res.status(500).json({ err2 }));
    })
    .catch((err1) => res.status(500).json({ err1 }));
};

exports.deleteService = (req, res) => {
  const { serviceId, facilityId } = req.params;
  console.log(serviceId);
  db.sequelize
    .query("call delete_service(:serviceId,:facilityId)", {
      replacements: { serviceId, facilityId },
    })
    .then((results) => res.json({ results }))
    .catch((err) => res.status(500).json({ err }));
};

// const puppeteer = require('puppeteer');

// async function printPDF() {
//   const browser = await puppeteer.launch({ headless: true });
//   const page = await browser.newPage();
//   await page.goto('https://blog.risingstack.com', {waitUntil: 'networkidle2'});
//   // await page.screenshot({path: 'risingstack.png'});
//   // page.addStyleTag({ content: '.nav { display: none} .navbar { border: 0px} #print-button {display: none}' })
//   let pdf = await page.pdf({path: 'hn.pdf', format: 'A4'});

//   await browser.close();
//   return pdf;
// }

// exports.printPage = (req, res) => {
//   // const { url } = req.params;
//   printPDF().then(pdf => {
//     res.set({ 'Content-Type': 'application/pdf', 'Content-Length': pdf.length });
//     res.send(pdf)
//   })
// }
