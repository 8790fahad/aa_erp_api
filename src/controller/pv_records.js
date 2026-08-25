const db = require("../models");
const { getAndUpdateNumber } = require("../services/numberGen");
const moment = require("moment");
exports.postPvRecords = (req, res) => {
  const {
    id = 0,
    pv_no = "",
    date = "",
    cheque_no = "",
    amount = "",
    payee = "",
    purpose = "",
    payment_req_by = "",
    cheque_recieve_by = "",
    check_approved_by = "",
    supporting_document = "",
    payment_reviewed = "",
    payment_approved = "",
    status = "",
    mode_of_payment = "",
  } = req.body;

  db.sequelize
    .query(
      "CALL ManagePVRecords(:queryType,:id,:pv_no,:date,:cheque_no,:amount,:payee,:purpose,:payment_req_by,:cheque_recieve_by,:check_approved_by,:supporting_document,:payment_reviewed,:payment_approved,:status,:mode_of_payment)",
      {
        replacements: {
          id,
          pv_no,
          date,
          cheque_no,
          amount,
          payee,
          purpose,
          payment_req_by,
          cheque_recieve_by,
          check_approved_by,
          supporting_document,
          payment_reviewed,
          payment_approved,
          status,
          mode_of_payment,
        },
      }
    )
    .then((results) => res.json({ results }))
    .catch((err) => res.status(500).json({ err }));
};

// exports.pvCollectionNewData = async (req, res) => {
//   const {
//     mda_name = "",
//     query_type = "new_insert",
//     pv_code = "",
//     memo_id = "",
//     mode_code = "",
//     mode_of_payment = "",
//     narration = "",
//     purpose = "",
//     reference_number = "",
//     source_account_name = "",
//     supplier_name = "",
//     head_description = "",
//     expenditure_head = "",
//     expenditure_description = "",
//     date = "",
//     cheque_number = "",
//     bank_name = "",
//     amount = "",
//     status = "pending",
//     account_number = "",
//     account_name = "",
//     imageId = "",
//     account_type = "",
//     balance_type = "",
//     mode_account_type = "",
//     mode_Balance_Type = "",
//     payableHead = "",
//     payableDescription = "",
//     payableAccountType = "",
//   } = req.body.form;

//   console.log(req.body.form, "<===== req.body.form");

//   const list = req.body.list || [];

//   console.log(list, "<===== req.body.list");

//   const taxesApplied = req.body.taxesApplied || [];

//   // Generate PV Code only if it's an insert operation and no PV code exists
//   const generatedPVCode = `${Math.floor(Math.random() * 1000)}`;

//   if (list.length > 1) {
//     const queue = list.map((item, index) =>
//       db.sequelize.query(
//         `CALL pv_collection (
//             :query_type,
//             :pv_code,
//             :memo_id,
//             :pv_date,
//             :expenditure_description,
//             :exp_head,
//             :reference_number,
//             :amount,
//             :supplier_name,
//             :supplier_account_number,
//             :supplier_account_name,
//             :supplier_bank_name,
//             :method_of_payment,
//             :status,
//             :bank_name,
//             :cheque_number,
//             :account_number,
//             :imageId,
//             :note_description,
//             :source_account,
//             :purpose
//         )`,
//         {
//           replacements: {
//             query_type,
//             pv_code: generatedPVCode,
//             memo_id: item.memo_id || "",
//             pv_date: item.date || "",
//             expenditure_description: item.expenditure_description || "",
//             exp_head: item.expenditure_head || "",
//             reference_number: item.reference_number || "",
//             amount: item.amount || "",
//             supplier_name: item.supplier_name || "",
//             supplier_account_number: item.account_number || "",
//             supplier_account_name: item.account_name || "",
//             supplier_bank_name: item.bank_name || "",
//             method_of_payment: item.mode_of_payment || "",
//             status: item.status || "",
//             bank_name: item.bank_name || "",
//             cheque_number: item.cheque_number || "",
//             account_number: item.account_number || "",
//             imageId: item.imageId || "",
//             note_description: item.purpose || "",
//             source_account: source_account_name || "",
//             purpose,
//           },
//         }
//       )
//     );

//     Promise.all(queue)
//       .then((result) => {
//         console.log("data result", result);
//         res.json({
//           success: true,
//           result,
//           pv_code: generatedPVCode,
//         });
//       })
//       .catch((err) => {
//         console.log("data error", err);
//         res.json({
//           success: false,
//           err,
//         });
//       });
//   } else {
//     db.sequelize
//       .query(
//         `CALL pv_collection (
//           :query_type,
//           :pv_code,
//           :memo_id,
//           :pv_date,
//           :expenditure_description,
//           :exp_head,
//           :reference_number,
//           :amount,
//           :supplier_name,
//           :supplier_account_number,
//           :supplier_account_name,
//           :supplier_bank_name,
//           :method_of_payment,
//           :status,
//           :bank_name,
//           :cheque_number,
//           :account_number,
//           :imageId,
//           :note_description,
//           :source_account,
//           :purpose
//         )`,
//         {
//           replacements: {
//             query_type,
//             pv_code: generatedPVCode,
//             memo_id,
//             pv_date: date,
//             expenditure_description,
//             exp_head: expenditure_head,
//             reference_number: reference_number || "",
//             amount,
//             supplier_name,
//             supplier_account_number: account_number,
//             supplier_account_name: account_name,
//             supplier_bank_name: bank_name,
//             method_of_payment: mode_of_payment,
//             status,
//             bank_name,
//             cheque_number,
//             account_number,
//             imageId,
//             note_description: narration,
//             source_account: source_account_name || "",
//             purpose,
//           },
//         }
//       )
//       .then(async (result) => {
//         if (taxesApplied.length) {
//           const taxesQueue = [];
//           const totalPvAmount = parseFloat(amount) || 0;
//           const totalTaxAmount =
//             totalPvAmount -
//             taxesApplied.reduce(
//               (sum, tax) => sum + parseFloat(tax.amount || 0),
//               0
//             );

//           // Insert main tax deductions
//           taxesQueue.push(
//             db.sequelize.query(
//               `CALL new_tax_deduction(
//                     :query_type,
//                     :pv_code,
//                     :deduction_description,
//                     :dr,
//                     :cr,
//                     :status,
//                     :deduction_type
//                 )`,
//               {
//                 replacements: {
//                   query_type: "insert",
//                   pv_code: generatedPVCode,
//                   deduction_description: "Contract Sum",
//                   dr: 0,
//                   cr: totalPvAmount,
//                   status: "Pending",
//                   deduction_type: "tax",
//                 },
//               }
//             )
//           );

//           taxesQueue.push(
//             db.sequelize.query(
//               `CALL new_tax_deduction(
//                     :query_type,
//                     :pv_code,
//                     :deduction_description,
//                     :dr,
//                     :cr,
//                     :status,
//                     :deduction_type
//                 )`,
//               {
//                 replacements: {
//                   query_type: "insert",
//                   pv_code: generatedPVCode,
//                   deduction_description: "Net Amount",
//                   dr: totalTaxAmount,
//                   cr: 0,
//                   status: "Pending",
//                   deduction_type: "tax",
//                 },
//               }
//             )
//           );

//           //net general ledger
//           taxesQueue.push(
//             db.sequelize.query(
//               `CALL general_ledger(
//                     :query_type,
//                     :entries_date,
//                     :amount,
//                     :destination_name,
//                     :head,
//                     :account_description,
//                     :facility_id,
//                     :refrence_number,
//                     :cheque_no,
//                     :created_by,
//                     :pv_no,
//                     :account_type,
//                     :balance_type
//               )`,
//               {
//                 replacements: {
//                   query_type: "net",
//                   entries_date: date,
//                   amount: totalPvAmount,
//                   destination_name: purpose,
//                   head: mode_code,
//                   account_description: head_description,
//                   facility_id: req.body.facilityId,
//                   refrence_number: reference_number,
//                   cheque_no: cheque_number ? cheque_number : null,
//                   created_by: "braimstorm",
//                   pv_no: generatedPVCode,
//                   account_type: mode_account_type,
//                   balance_type: mode_Balance_Type,
//                   // transaction_id: ""
//                 },
//               }
//             )
//           );

//           //expenditure general ledger
//           taxesQueue.push(
//             db.sequelize.query(
//               `CALL general_ledger(
//                     :query_type,
//                     :entries_date,
//                     :amount,
//                     :destination_name,
//                     :head,
//                     :account_description,
//                     :facility_id,
//                     :refrence_number,
//                     :cheque_no,
//                     :created_by,
//                     :pv_no,
//                     :account_type,
//                     :balance_type
//               )`,
//               {
//                 replacements: {
//                   query_type: "tax",
//                   entries_date: date,
//                   amount: totalTaxAmount,
//                   destination_name: purpose,
//                   head: payableHead,
//                   account_description: payableDescription,
//                   facility_id: req.body.facilityId,
//                   refrence_number: reference_number,
//                   cheque_no: cheque_number ? cheque_number : null,
//                   created_by: "braimstorm",
//                   pv_no: generatedPVCode,
//                   account_type: payableAccountType,
//                   balance_type,
//                   // transaction_id: ""
//                 },
//               }
//             )
//           );

//           // Insert each tax entry

//           taxesApplied.forEach((tax) => {
//             taxesQueue.push(
//               db.sequelize.query(
//                 `CALL new_tax_deduction (
//                   :query_type,
//                   :pv_code,
//                   :deduction_description,
//                   :dr,
//                   :cr,
//                   :status,
//                   :deduction_type
//                 )`,
//                 {
//                   replacements: {
//                     query_type: "insert",
//                     pv_code: generatedPVCode,
//                     deduction_description: tax.description,
//                     dr: tax.amount,
//                     cr: 0,
//                     status: "Pending",
//                     deduction_type: "tax",
//                   },
//                 }
//               )
//             );
//           });
//           console.log(taxesApplied);

//           //tax general ledger
//           taxesApplied.forEach((tax) => {
//             db.sequelize.query(
//               `CALL general_ledger(
//                     :query_type,
//                     :entries_date,
//                     :amount,
//                     :destination_name,
//                     :head,
//                     :account_description,
//                     :facility_id,
//                     :refrence_number,
//                     :cheque_no,
//                     :created_by,
//                     :pv_no,
//                     :account_type,
//                     :balance_type
//               )`,
//               {
//                 replacements: {
//                   query_type: "tax",
//                   entries_date: date,
//                   amount: tax.amount,
//                   destination_name: purpose,
//                   head: tax.head ? tax.head : "21000",
//                   account_description: tax.description,
//                   facility_id: req.body.facilityId,
//                   refrence_number: reference_number,
//                   cheque_no: cheque_number ? cheque_number : null,
//                   created_by: tax.created_by ? created_by : "braimstorm",
//                   pv_no: generatedPVCode,
//                   account_type: account_type,
//                   balance_type: balance_type,
//                   // transaction_id: ""
//                 },
//               }
//             );
//           });

//           Promise.all(taxesQueue)
//             .then((result) => {
//               res.json({
//                 success: true,
//                 result,
//                 pv_code: generatedPVCode,
//               });
//             })
//             .catch((err) => {
//               console.log("data error", err);
//               res.json({
//                 success: false,
//                 err,
//               });
//             });
//         } else if (taxesApplied.length === 0 && taxesApplied.length < 0) {
//           const taxesQueue = [];
//           const totalPvAmount = parseFloat(amount) || 0;
//           taxesQueue.push(
//             db.sequelize.query(
//               `CALL general_ledger(
//                       :query_type,
//                       :entries_date,
//                       :amount,
//                       :destination_name,
//                       :head,
//                       :account_description,
//                       :facility_id,
//                       :refrence_number,
//                       :cheque_no,
//                       :created_by,
//                       :pv_no,
//                       :account_type,
//                       :balance_type
//                 )`,
//               {
//                 replacements: {
//                   query_type: "net",
//                   entries_date: date,
//                   amount: totalPvAmount,
//                   destination_name: purpose,
//                   head: mode_code,
//                   account_description: head_description,
//                   facility_id: req.body.facilityId,
//                   refrence_number: reference_number,
//                   cheque_no: cheque_number ? cheque_number : null,
//                   created_by: "braimstorm",
//                   pv_no: generatedPVCode,
//                   account_type: mode_account_type,
//                   balance_type: mode_Balance_Type,
//                   // transaction_id: ""
//                 },
//               }
//             )
//           );

//           //expenditure general ledger
//           taxesQueue.push(
//             db.sequelize.query(
//               `CALL general_ledger(
//                       :query_type,
//                       :entries_date,
//                       :amount,
//                       :destination_name,
//                       :head,
//                       :account_description,
//                       :facility_id,
//                       :refrence_number,
//                       :cheque_no,
//                       :created_by,
//                       :pv_no,
//                       :account_type,
//                       :balance_type
//                 )`,
//               {
//                 replacements: {
//                   query_type: "tax",
//                   entries_date: date,
//                   amount: totalPvAmount,
//                   destination_name: purpose,
//                   head: payableHead,
//                   account_description: payableDescription,
//                   facility_id: req.body.facilityId,
//                   refrence_number: reference_number,
//                   cheque_no: cheque_number ? cheque_number : null,
//                   created_by: "braimstorm",
//                   pv_no: generatedPVCode,
//                   account_type: payableAccountType,
//                   balance_type,
//                   // transaction_id: ""
//                 },
//               }
//             )
//           );

//           Promise.all(taxesQueue)
//             .then((result) => {
//               res.json({
//                 success: true,
//                 result,
//                 pv_code: generatedPVCode,
//               });
//             })
//             .catch((err) => {
//               console.log("data error", err);
//               res.json({
//                 success: false,
//                 err,
//               });
//             });
//         } else {
//           res.json({
//             success: true,
//             pv_code: generatedPVCode,
//             result,
//           });
//         }
//       })
//       .catch((err) => {
//         console.log("data error data", err);
//         res.json({
//           success: false,
//           err,
//         });
//       });
//   }
// };
// Sequelize database models

exports.pvCollectionNewData = async (req, res) => {
  console.log("req.pv_data:", req.files);
  try {
    // Parse PV data
    let pvData;
    try {
      pvData = JSON.parse(req.body.pv_data);
    } catch (e) {
      console.error("Failed to parse PV data:", e.message);
      return res
        .status(400)
        .json({ success: false, error: "Invalid PV data format" });
    }

    // Destructure form data
    const {
      date = null,
      amount = "0",
      mode_of_payment = "",
      narration = null,
      supplier_name = "Unknown Supplier",
      supplier_code = "",
      supplier_number = "",
      account_code = "",
      memo_id = "",
      bankAccountCode = "",
      bankAccountDescription = "",
      bankAccountSubhead = "",
      mod_account_code = "",
      mod_item_name = "",
      mod_sub_account = "",
      cheque_no = "",
      sup_bank_account_id = null,
    } = pvData.form || {};

    // Destructure critical PV data
    const {
      account_payable,
      prepayment_code,
      accruedPayment,
      expense,
      userId,
      facilityId,
      taxesApplied = [],
      status: pendingStatus,
    } = pvData;
    console.log({ pvData });
    console.log({ taxesApplied: taxesApplied[0] });

    // Validate critical fields
    if (!userId) throw new Error("Missing userId");
    if (!facilityId) throw new Error("Missing facilityId");
    if (!expense?.unitCost || !expense?.quantity)
      throw new Error("Missing expense unitCost or quantity");
    if (!account_payable) throw new Error("Missing account payable code");
    if (!prepayment_code) throw new Error("Missing prepayment account code");
    if (!accruedPayment)
      throw new Error("Missing accrued payment account code");

    const pv_documents = req?.files?.pv_documents || [];
    const document_names = req.body.document_names || [];
    const generatedPVCode = await getAndUpdateNumber("pv", facilityId);
    if (pv_documents && pv_documents.length > 0) {
      for (let i = 0; i < pv_documents.length; i++) {
        const file = pv_documents[i];
        const customName = Array.isArray(document_names)
          ? document_names[i]
          : document_names;

        await db.sequelize.query(
          `INSERT INTO memo_documents
              (memo_id, document_name, file_path, original_name, file_size, mime_type,facilityId)
              VALUES (:memo_id, :document_name, :file_path, :original_name, :file_size, :mime_type,:facilityId)`,
          {
            replacements: {
              memo_id: generatedPVCode,
              document_name: customName || file.originalname,
              file_path: file.filename,
              original_name: file.originalname,
              file_size: file.size,
              mime_type: file.mimetype,
              facilityId,
            },
          }
        );
      }
    }
    // Helper function for GL insert
    const insertGL = async (entry, transaction) => {
      const insertQuery = `
        INSERT INTO general_ledger (
          transaction_date, account_code, account_subhead, dr, cr, account_description,
          transaction_description, reference_number, purpose_of_payment, payee, cheque_no,
          created_by, facility_id, status, type, transaction_ref,mode_of_payment,  bank_account_id
        ) VALUES (
          :transaction_date, :account_code, :account_subhead, :dr, :cr, :account_description,
          :transaction_description, :reference_number, :purpose_of_payment, :payee, :cheque_no,
          :created_by, :facility_id, :status, :type, :transaction_ref,:mode_of_payment,:bank_account_id
        )`;
      return await db.sequelize.query(insertQuery, {
        replacements: entry,
        type: db.Sequelize.QueryTypes.INSERT,
        transaction,
      });
    };

    // Start database transaction
    const transaction = await db.sequelize.transaction();

    try {
      // Fetch accounts
      const accounts = await db.sequelize.query(
        `SELECT * FROM account WHERE head IN (:account_payable, :prepayment_code, :accruedPayment) and facilityId = :facilityId`,
        {
          replacements: {
            account_payable,
            prepayment_code,
            accruedPayment,
            facilityId,
          },
          type: db.Sequelize.QueryTypes.SELECT,
          transaction,
        }
      );

      // if (!accounts || accounts.length < 3) {
      //   throw new Error(
      //     "Required accounts (payable, prepayment, accrued) not found"
      //   );
      // }

      const payableAcc = accounts.find((a) => a.head === account_payable);
      const prepaymentAcc = accounts.find((a) => a.head === prepayment_code);
      const accruedAcc = accounts.find((a) => a.head === accruedPayment);

      // Calculate net amount and taxes
      const purchaseAmount =
        parseFloat(expense.unitCost) * parseInt(expense.quantity); // 200,000
      let netAmount = purchaseAmount;
      let taxTotal = 0;

      taxesApplied.forEach((tax) => {
        const taxAmount = parseFloat(tax.amount) || 0;
        const taxRate = parseFloat(tax.rate) / 100;
        if (!tax.tax_type)
          throw new Error(`Missing tax type for ${tax.description}`);
        if (tax.tax_type === "exclusive") {
          const calculatedTax = purchaseAmount * taxRate; // 200,000 * 0.075 = 15,000
          if (Math.abs(calculatedTax - taxAmount) > 0.01) {
            throw new Error(
              `Invalid exclusive tax amount for ${
                tax.description
              }: expected ${calculatedTax.toFixed(2)}, got ${taxAmount}`
            );
          }
          taxTotal += calculatedTax;
        } else if (tax.tax_type === "inclusive") {
          const netBeforeTax = purchaseAmount / (1 + taxRate);
          const calculatedTax = netBeforeTax * taxRate;
          if (Math.abs(calculatedTax - taxAmount) > 0.01) {
            throw new Error(
              `Invalid inclusive tax amount for ${
                tax.description
              }: expected ${calculatedTax.toFixed(2)}, got ${taxAmount}`
            );
          }
          netAmount = netBeforeTax;
          taxTotal += calculatedTax;
        } else {
          throw new Error(
            `Invalid tax type for ${tax.description}: ${tax.type}`
          );
        }
      });

      const grossAmount = netAmount + taxTotal; // 200,000 + 15,000 = 215,000
      const paymentMade = parseFloat(amount) || 0;

      // Validate account codes
      // if (!expense.chart_code && !account_code)
      //   throw new Error("Missing expense account code");
      // if (!expense.item_code && !account_code)
      //   throw new Error("Missing expense account subhead");

      // Prepare Journal Entries
      let journalEntries = [];

      // Record expense and VAT for all cases
      // 1. Expense DR
      const expenseEntry = {
        transaction_date: date,
        account_code: expense.item_code,
        account_subhead: expense.chart_code,
        dr: netAmount,
        cr: 0.0,
        account_description: expense.item,
        transaction_description: expense.description,
        reference_number: supplier_number,
        purpose_of_payment: narration,
        payee: supplier_name,
        cheque_no: cheque_no,
        created_by: userId,
        facility_id: facilityId,
        status:
          paymentMade >= grossAmount ? "paid" : pendingStatus || "pending",
        type: "expenses",

        transaction_ref: `PV-${generatedPVCode}`,
        mode_of_payment,
        bank_account_id: sup_bank_account_id,
      };
      journalEntries.push(expenseEntry);

      // 2. VAT DR entries (if applicable)
      taxesApplied.forEach((tax) => {
        const taxEntry = {
          transaction_date: date,
          account_code: tax.head,
          account_subhead: tax.account_sub_head,
          dr: parseFloat(tax.amount),
          cr: 0.0,
          account_description: `${tax.description}: ${tax.tax_type}`,
          transaction_description: `${tax.description}: ${tax.tax_type}`,
          reference_number: supplier_number,
          purpose_of_payment: narration,
          payee: supplier_name,
          cheque_no: cheque_no || null,
          created_by: userId,
          facility_id: facilityId,
          status:
            paymentMade >= grossAmount ? "paid" : pendingStatus || "pending",
          type: "tax",
          transaction_ref: `PV-${generatedPVCode}`,
          mode_of_payment,
          bank_account_id: sup_bank_account_id,
        };
        journalEntries.push(taxEntry);
      });

      // 3. Payment and Balance Handling
      if (
        paymentMade === grossAmount &&
        mode_of_payment.includes(["bank", "cash", "cheque"])
      ) {
        // Full cash payment
        const bankAccount = mod_account_code || bankAccountCode;
        const bankName =
          mod_item_name || bankAccountDescription || "Bank Account";
        const bankSubhead = mod_sub_account || bankAccountSubhead;

        if (!bankAccount)
          throw new Error("Missing bank account code for cash payment");

        const bankEntry = {
          transaction_date: date,
          account_code: bankAccount,
          account_subhead: bankSubhead,
          dr: 0.0,
          cr: grossAmount,
          account_description: bankName,
          transaction_description: "Cash Purchase Payment",
          reference_number: supplier_number,
          purpose_of_payment: narration,
          payee: supplier_name,
          cheque_no: cheque_no || null,
          created_by: userId,
          facility_id: facilityId,
          status: "paid",
          type: "bank",
          transaction_ref: `PV-${generatedPVCode}`,
          mode_of_payment,
          bank_account_id: sup_bank_account_id,
        };
        journalEntries.push(bankEntry);
      } else if (paymentMade === 0) {
        // Zero payment: Balance to Accounts Payable
        const liabilityEntry = {
          transaction_date: date,
          account_code: payableAcc.head,
          account_subhead: payableAcc.subhead,
          dr: 0.0,
          cr: grossAmount,
          account_description: payableAcc.description || "Supplier Payable",
          transaction_description: "Supplier Payable",
          reference_number: supplier_number,
          purpose_of_payment: narration,
          payee: supplier_name,
          cheque_no: cheque_no || null,
          created_by: userId,
          facility_id: facilityId,
          status: pendingStatus || "pending",
          type: "payable",
          transaction_ref: `PV-${generatedPVCode}`,
          mode_of_payment,
          bank_account_id: sup_bank_account_id,
        };
        journalEntries.push(liabilityEntry);
      } else {
        // Partial payment or overpayment
        const bankAccount = mod_account_code || bankAccountCode;
        const bankName =
          mod_item_name || bankAccountDescription || "Bank Account";
        const bankSubhead = mod_sub_account || bankAccountSubhead;

        if (!bankAccount)
          throw new Error("Missing bank account code for payment");

        // Bank/Cash CR for payment made
        const bankEntry = {
          transaction_date: date,
          account_code: bankAccount,
          account_subhead: bankSubhead,
          dr: 0.0,
          cr: paymentMade,
          account_description: bankName,
          transaction_description: "Payment Out",
          reference_number: supplier_number,
          purpose_of_payment: narration,
          payee: supplier_name,
          cheque_no: cheque_no || null,
          created_by: userId,
          facility_id: facilityId,
          status: "paid",
          type: "bank",
          transaction_ref: `PV-${generatedPVCode}`,
          mode_of_payment,
          bank_account_id: sup_bank_account_id,
        };
        journalEntries.push(bankEntry);

        if (paymentMade < grossAmount) {
          // Partial payment: Net balance to Accrued Expenses
          const balance = grossAmount - paymentMade; // 115,000
          const accruedEntry = {
            transaction_date: date,
            account_code: accruedAcc.head,
            account_subhead: accruedAcc.subhead,
            dr: 0.0,
            cr: balance,
            account_description: accruedAcc.description || "Accrued Expenses",
            transaction_description: "Accrued Expense",
            reference_number: supplier_number,
            purpose_of_payment: narration,
            payee: supplier_name,
            cheque_no: cheque_no || null,
            created_by: userId,
            facility_id: facilityId,
            status: "partial",
            type: "accrued",
            transaction_ref: `PV-${generatedPVCode}`,
            mode_of_payment,
            bank_account_id: sup_bank_account_id,
          };
          journalEntries.push(accruedEntry);
        } else if (paymentMade > grossAmount) {
          // Overpayment: Excess to Prepayment
          const advance = paymentMade - grossAmount; // 35,000
          const prepaymentEntry = {
            transaction_date: date,
            account_code: prepaymentAcc.head,
            account_subhead: prepaymentAcc.subhead,
            dr: advance,
            cr: 0.0,
            account_description: prepaymentAcc.description || "Prepayment",
            transaction_description: "Supplier Advance",
            reference_number: supplier_number,
            purpose_of_payment: narration,
            payee: supplier_name,
            mode_of_payment,
            cheque_no: cheque_no || null,
            created_by: userId,
            facility_id: facilityId,
            status: "paid",
            type: "prepayment",
            transaction_ref: `PV-${generatedPVCode}`,
            mode_of_payment,
            bank_account_id: sup_bank_account_id,
          };
          journalEntries.push(prepaymentEntry);
        }
      }

      // Validate and insert journal entries
      console.log("Inserting journal entries:", journalEntries.length);
      for (let i = 0; i < journalEntries.length; i++) {
        const entry = journalEntries[i];
        console.log(`Inserting entry ${i + 1}:`, {
          account_code: entry.account_code,
          account_subhead: entry.account_subhead,
          dr: entry.dr,
          cr: entry.cr,
          description: entry.transaction_description,
        });

        if (!entry.account_code)
          throw new Error(`Entry ${i + 1}: Missing account_code`);
        if (!entry.account_subhead)
          throw new Error(`Entry ${i + 1}: Missing account_subhead`);

        await insertGL(entry, transaction);
        console.log(`Successfully inserted entry ${i + 1}`);
      }
      await db.sequelize.query(
        `INSERT INTO supplier_entries (
          supplier_number,
          cost,
          qty_in,
          receiptNo,
          facilityId,
          created_at,
          created_by,
          description
        ) VALUES (
          :supplier_number,
          :cost,
          :qty_in,
          :receiptNo,
          :facilityId,
          :created_at,
          :created_by,
          :description
        )`,
        {
          replacements: {
            // supplier_code: supplier_code,
            supplier_number: supplier_number,
            cost: expense.unitCost,
            qty_in: expense.quantity,
            receiptNo: `PV-${generatedPVCode}`,
            facilityId: facilityId,
            created_at: date || moment().format("YYYY-MM-DD"),
            created_by: userId,
            description: expense.description,
          },
        }
      );
      await db.sequelize.query(
        `update  memo  set reference_number=:reference_number,status="Pv Generated" where memo_id=:memo_id`,
        {
          replacements: {
            memo_id,
            reference_number: `PV-${generatedPVCode}`,
          },
        }
      );

      // Commit transaction
      await transaction.commit();

      return res.json({
        success: true,
        pv_code: `PV-${generatedPVCode}`,
        journal_entries: journalEntries,
        documents:
          pv_documents.length > 0
            ? {
                count: pv_documents.length,
                files: pv_documents.map((file) => ({
                  original_name: file.originalname,
                  file_path: file.filename,
                  size: file.size,
                  type: file.mimetype,
                })),
              }
            : null,
        message: "PV, taxes, and GL entries added successfully",
      });
    } catch (err) {
      await transaction.rollback();
      console.error("Unexpected error:", err.message);
      return res.status(500).json({
        success: false,
        error: err.message,
        message: "Error while processing PV",
      });
    }
  } catch (err) {
    console.error("Unexpected error:", err.message);
    return res.status(500).json({
      success: false,
      error: err.message,
      message: "Error while processing PV",
    });
  }
};

exports.createNewTaxes = (req, res) => {
  const {
    query_type = "",
    taxes_head = "",
    taxes_name = "",
    rate = "",
    rate_type = "",
  } = req.body.form;

  console.log(req.body);

  db.sequelize
    .query(
      `CALL create_taxes(
        :query_type,
        :head,
        :taxes_name,
        :rate_type,
        :rate
      )`,
      {
        replacements: {
          query_type,
          head: taxes_head,
          taxes_name,
          rate_type,
          rate,
        },
      }
    )
    .then((results) => res.json({ results }))
    .catch((err) => res.status(500).json({ err }));
};

exports.getPaymentVoucher = async (req, res) => {
  try {
    const { pv = "", facilityId = "", memo_id = "" } = req.query;

    // Fetch general ledger entries
    const [data] = await db.sequelize.query(
      `SELECT *
       FROM general_ledger
       WHERE facility_id = :facilityId
       AND transaction_ref = :pv`,
      { replacements: { pv, facilityId } }
    );

    if (!data || data.length === 0) {
      return res.status(404).json({
        success: false,
        message: "PV not found",
      });
    }

    // Filter ledger entry for bank transaction
    const bankEntries = data.filter((item) => item.type === "bank");
    if (!bankEntries.length) {
      return res.status(404).json({
        success: false,
        message: "No bank entry found for this PV",
      });
    }

    const bank = bankEntries[0];
    const {
      transaction_date,
      account_code,
      mode_of_payment,
      bank_account_id,
      purpose_of_payment,
      cr,
      dr,
    } = bank;

    const amount = cr || dr;

    // Run parallel queries
    const [source_acc, ben_acc, logDataFull, bus_data] = await Promise.all([
      db.sequelize.query(
        `SELECT b.bank_name,a.account_bank_type,a.account_number
         FROM bank_accounts a JOIN bank_list b on a.bank_code= b.bank_code
         WHERE head = :head AND facility_id = :facilityId`,
        { replacements: { head: account_code, facilityId } }
      ),
      db.sequelize.query(
        `SELECT
            a.account_number,
            a.bank_name,
            a.bank_code AS sort_code,
            b.email,
            b.supplier_name,
            b.address,
            a.code
         FROM supplier_account_information a
         JOIN suppliersinfo b
           ON a.supplier_number = b.supplier_number
          AND a.facilityId = b.facilityId
         WHERE a.id = :bank_account_id
           AND a.facilityId = :facilityId`,
        { replacements: { bank_account_id, facilityId } }
      ),
      db.sequelize.query(
        `SELECT
  CONCAT(u.firstname, " ", u.lastname) AS name,
  u.role,
  u.signature,
  a.date,
  a.status
FROM logs a
JOIN users u ON a.user_id = u.id
         WHERE a.id_link = :memo_id AND a.facilityId = :facilityId`,
        { replacements: { memo_id, facilityId } }
      ),
      db.sequelize.query(
        `SELECT *
         FROM business
         WHERE id = :facilityId`,
        { replacements: { facilityId } }
      ),
    ]);

    const source_account = source_acc[0][0] || {};
    const beneficiary_account = ben_acc[0][0] || {};
    const logData = logDataFull[0] || [];
    const business_data = bus_data[0][0] || {};

    // Extract logs by status
    const requestedLog =
      logData
        .filter((log) => log.status?.toLowerCase() === "requested")
        .sort((a, b) => new Date(b.date) - new Date(a.date))[0] || null;

    const reviewByLog =
      logData
        .filter((log) => log.status?.toLowerCase() === "reviewed")
        .sort((a, b) => new Date(b.date) - new Date(a.date))[0] || null;

    const approvedByLog =
      logData
        .filter((log) => log.status?.toLowerCase() === "approved")
        .sort((a, b) => new Date(b.date) - new Date(a.date))[0] || null;

    const _data = {
      voucherNo: pv,
      date: transaction_date,
      amount,
      currency: "NGN",
      mode_of_payment,
      business_name: business_data?.business_name || "N/A",
      source: {
        name: business_data?.business_name || "N/A",
        address: business_data?.address || "N/A",
        accountNo: source_account?.account_number || "N/A",
        bank: source_account?.bank_name || "N/A",
        taxId: source_account?.account_bank_type || "N/A",
        contactPerson: "Finance Director",
      },
      beneficiary: {
        name: beneficiary_account?.supplier_name || "N/A",
        address: beneficiary_account?.address || "No address",
        accountNo: beneficiary_account?.account_number || "N/A",
        bank: beneficiary_account?.bank_name || "N/A",
        sortCode: beneficiary_account?.sort_code || "N/A",
        taxId: beneficiary_account?.code || "N/A",
        email: beneficiary_account?.email || "No email",
      },
      paymentMethod: mode_of_payment,
      purpose: purpose_of_payment,
      reference: memo_id,
      requestedBy: {
        name: requestedLog?.name || "N/A",
        signature: requestedLog?.signature || null,
        title: requestedLog?.role || "N/A",
        date: requestedLog?.date
          ? moment(requestedLog.date).format("DD/MM/YYYY")
          : "N/A",
      },
      reviewedBy: {
        name: reviewByLog?.name || "N/A",
        signature: reviewByLog?.signature || null,
        title: reviewByLog?.role || "N/A",
        date: reviewByLog?.date
          ? moment(reviewByLog.date).format("DD/MM/YYYY")
          : "N/A",
      },
      approvedBy: {
        name: approvedByLog?.name || "N/A",
        signature: approvedByLog?.signature || null,
        title: approvedByLog?.role || "N/A",
        date: approvedByLog?.date
          ? moment(approvedByLog.date).format("DD/MM/YYYY")
          : "N/A",
      },
    };

    return res.json({
      success: true,
      data: _data,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, err: err.message });
  }
};

exports.getBulkPaymentVouchers = async (req, res) => {
  try {
    const { facilityId } = req.query;
    const { vouchers } = req.body;

    if (!vouchers || !Array.isArray(vouchers) || vouchers.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Vouchers array is required and must not be empty",
      });
    }

    if (!facilityId) {
      return res.status(400).json({
        success: false,
        message: "Facility ID is required",
      });
    }

    const results = [];
    const errors = [];

    // Process each voucher
    for (const voucher of vouchers) {
      const { pv, memo_id } = voucher;

      try {
        // Fetch general ledger entries for this PV
        const [data] = await db.sequelize.query(
          `SELECT *
           FROM general_ledger
           WHERE facility_id = :facilityId
           AND transaction_ref = :pv`,
          { replacements: { pv, facilityId } }
        );

        if (!data || data.length === 0) {
          errors.push({
            memo_id,
            pv,
            error: "PV not found in general ledger",
          });
          continue;
        }

        // Filter ledger entry for bank transaction
        const bankEntries = data.filter((item) => item.type === "bank");
        if (!bankEntries.length) {
          errors.push({
            memo_id,
            pv,
            error: "No bank entry found for this PV",
          });
          continue;
        }

        const bank = bankEntries[0];

        const {
          transaction_date,
          account_code,
          mode_of_payment,
          bank_account_id,
          purpose_of_payment,
          cr,
          dr,
        } = bank;

        const amount = cr || dr;

        // Run parallel queries for this voucher
        const [source_acc, ben_acc, logDataFull, bus_data] = await Promise.all([
          db.sequelize.query(
            `SELECT b.bank_name,a.account_bank_type,a.account_number
             FROM bank_accounts a JOIN bank_list b on a.bank_code= b.bank_code
             WHERE head = :head AND facilityId = :facilityId`,
            { replacements: { head: account_code, facilityId } }
          ),
          db.sequelize.query(
            `SELECT
                a.account_number,
                a.bank_name,
                a.bank_code AS sort_code,
                b.email,
                b.supplier_name,
                b.address,
                a.code
             FROM supplier_account_information a
             JOIN suppliersinfo b
               ON a.supplier_number = b.supplier_number
              AND a.facilityId = b.facilityId
             WHERE a.id = :bank_account_id
               AND a.facilityId = :facilityId`,
            { replacements: { bank_account_id, facilityId } }
          ),
          db.sequelize.query(
            `SELECT
              CONCAT(u.firstname, " ", u.lastname) AS name,
              u.role,
              a.date,
              a.status
            FROM logs a
            JOIN users u ON a.user_id = u.id
             WHERE a.id_link = :memo_id AND a.facilityId = :facilityId`,
            { replacements: { memo_id, facilityId } }
          ),
          db.sequelize.query(
            `SELECT *
             FROM business
             WHERE id = :facilityId`,
            { replacements: { facilityId } }
          ),
        ]);

        const source_account = source_acc[0][0] || {};
        const beneficiary_account = ben_acc[0][0] || {};
        const logData = logDataFull[0] || [];
        const business_data = bus_data[0][0] || {};

        // Extract logs by status
        const requestedLog =
          logData
            .filter((log) => log.status?.toLowerCase() === "requested")
            .sort((a, b) => new Date(b.date) - new Date(a.date))[0] || null;

        const reviewByLog =
          logData
            .filter((log) => log.status?.toLowerCase() === "reviewed")
            .sort((a, b) => new Date(b.date) - new Date(a.date))[0] || null;

        const approvedByLog =
          logData
            .filter((log) => log.status?.toLowerCase() === "approved")
            .sort((a, b) => new Date(b.date) - new Date(a.date))[0] || null;

        const voucherData = {
          voucherNo: pv,
          date: transaction_date,
          amount,
          currency: "NGN",
          mode_of_payment,
          business_name: business_data?.business_name || "N/A",
          source: {
            name: business_data?.business_name || "N/A",
            address: business_data?.address || "N/A",
            accountNo: source_account?.account_number || "N/A",
            bank: source_account?.bank_name || "N/A",
            taxId: source_account?.account_bank_type || "N/A",
            contactPerson: "Finance Director",
          },
          beneficiary: {
            name: beneficiary_account?.supplier_name || "N/A",
            address: beneficiary_account?.address || "No address",
            accountNo: beneficiary_account?.account_number || "N/A",
            bank: beneficiary_account?.bank_name || "N/A",
            sortCode: beneficiary_account?.sort_code || "N/A",
            taxId: beneficiary_account?.code || "N/A",
            email: beneficiary_account?.email || "No email",
          },
          paymentMethod: mode_of_payment,
          purpose: purpose_of_payment,
          reference: memo_id,
          requestedBy: {
            name: requestedLog?.name || "N/A",
            title: requestedLog?.role || "N/A",
            date: requestedLog?.date
              ? moment(requestedLog.date).format("DD/MM/YYYY")
              : "N/A",
          },
          reviewedBy: {
            name: reviewByLog?.name || "N/A",
            title: reviewByLog?.role || "N/A",
            date: reviewByLog?.date
              ? moment(reviewByLog.date).format("DD/MM/YYYY")
              : "N/A",
          },
          approvedBy: {
            name: approvedByLog?.name || "N/A",
            title: approvedByLog?.role || "N/A",
            date: approvedByLog?.date
              ? moment(approvedByLog.date).format("DD/MM/YYYY")
              : "N/A",
          },
        };

        results.push({
          success: true,
          data: voucherData,
          memo_id,
          pv,
        });
      } catch (voucherError) {
        console.error(`Error processing voucher ${pv}:`, voucherError);
        errors.push({
          memo_id,
          pv,
          error: voucherError.message,
        });
      }
    }

    return res.json({
      success: true,
      message: `Processed ${results.length} vouchers successfully${
        errors.length > 0 ? `, ${errors.length} failed` : ""
      }`,
      data: {
        successful: results,
        failed: errors,
        summary: {
          total: vouchers.length,
          successful: results.length,
          failed: errors.length,
        },
      },
    });
  } catch (err) {
    console.error("Bulk voucher processing error:", err);
    return res.status(500).json({
      success: false,
      message: "Internal server error during bulk processing",
      error: err.message,
    });
  }
};

exports.getPurchaseOrderPdf = async (req, res) => {
  try {
    const { pr_no = "", facilityId = "" } = req.query;

    // Fetch purchase requisition data
    const [purchaseRequisition] = await db.sequelize.query(
      `SELECT *
       FROM purchase_requisition
       WHERE pr_no = :pr_no AND facilityId = :facilityId`,
      { replacements: { pr_no, facilityId } }
    );

    if (!purchaseRequisition || purchaseRequisition.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Purchase requisition not found",
      });
    }

    const requisition = purchaseRequisition[0];
    const {
      created_at,
      requisitor,
      memo_id,
      amount,
      total,
      reason,
      branch,
      supplier_name,
      supplier_code,
      account_code,
      status,
    } = requisition;

    // Fetch requisition details (items)
    const [requisitionDetails] = await db.sequelize.query(
      `SELECT *
       FROM requisition_details
       WHERE pr_no = :pr_no AND facilityId = :facilityId`,
      { replacements: { pr_no, facilityId } }
    );

    if (!requisitionDetails || requisitionDetails.length === 0) {
      return res.status(404).json({
        success: false,
        message: "No requisition details found for this purchase order",
      });
    }

    // Run parallel queries for additional data
    const [businessData, logDataFull] = await Promise.all([
      db.sequelize.query(
        `SELECT *
         FROM business
         WHERE id = :facilityId`,
        { replacements: { facilityId } }
      ),
      db.sequelize.query(
        `SELECT
          CONCAT(u.firstname, " ", u.lastname) AS name,
          u.role,
          u.signature,
          a.date,
          a.status
        FROM logs a
        JOIN users u ON a.user_id = u.id
        WHERE a.id_link = :memo_id AND a.facilityId = :facilityId`,
        { replacements: { memo_id:pr_no, facilityId } }
      ),
    ]);

    const business = businessData[0][0] || {};
    const logData = logDataFull[0] || [];

    // Extract logs by status
    const requestedLog =
      logData
        .filter((log) => log.status?.toUpperCase() === "PENDING")
        .sort((a, b) => new Date(b.date) - new Date(a.date))[0] || null;

    const approvedByLog =
      logData
        .filter((log) => log.status?.toUpperCase() === "APPROVED")
        .sort((a, b) => new Date(b.date) - new Date(a.date))[0] || null;

    // Format items for the PDF
    const items = requisitionDetails.map((item) => ({
      itemCode: item.item_code,
      description: item.item_name,
      quantity: item.quantity.toString(),
      unit: item.unit_measure,
      remarks: item.unit_category,
      unitCost: parseFloat(item.est_cost),
      totalCost: parseFloat(item.est_cost) * item.quantity,
    }));

    // Calculate total amount
    const totalAmount = items.reduce((sum, item) => sum + item.totalCost, 0);

    // Fetch supplier information
    const supplierData = await db.SuppliersInfo.findOne({
      where: {
        supplier_number: supplier_code,
        facilityId: facilityId,
      },
    });

    if (!supplierData) {
      return res.status(404).json({
        success: false,
        message: "Supplier not found",
      });
    }

    const _data = {
      // Company information from activeBusiness state
      company: {
        name: business?.business_name || "AA_ERP MANUFACTURING LTD",
        address:
          business?.address ||
          "Plot 25, Industrial Complex, Phase III, Lagos, Nigeria",
        phone: business?.phone || "+234 803 555 0123",
        email: business?.email || "procurement@aa_erp.app",
      },

      // Purchase order details
      pr_no: pr_no,
      requestDate: created_at ? moment(created_at).format("YYYY-MM-DD") : "N/A",
      requestedBy: requisitor || "N/A",
      requiredDate: created_at
        ? moment(created_at).format("YYYY-MM-DD")
        : "N/A",
      branch: branch,

      // Supplier information
      supplier: {
        name: supplierData.supplier_name || "N/A",
        code: supplierData.supplier_number || "N/A",
        address: supplierData.address || "N/A",
      },

      // Items
      items: items,
      totalAmount: totalAmount,
      currency: "NGN",

      // Purpose/Reason
      purpose: reason || "Purchase requisition",

      // Status
      status: status || "pending",

      // Authorization workflow
      requestedBy: {
        name: requestedLog?.name || requisitor || "N/A",
        signature: requestedLog?.signature || null,
        title: requestedLog?.role || "N/A",
        date: requestedLog?.date
          ? moment(requestedLog.date).format("DD MMM, YYYY")
          : "N/A",
      },
      approvedBy: {
        name: approvedByLog?.name || "N/A",
        signature: approvedByLog?.signature || null,
        title: approvedByLog?.role || "N/A",
        date: approvedByLog?.date
          ? moment(approvedByLog.date).format("DD MMM, YYYY")
          : "N/A",
      },
    };

    return res.json({
      success: true,
      data: _data,
    });
  } catch (err) {
    console.error("Purchase order PDF error:", err);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: err.message,
    });
  }
};
