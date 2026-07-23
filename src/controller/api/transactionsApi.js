const db = require("../../models");
const moment = require("moment");
const UUIDV4 = require("uuid").v4;

exports.sellingApi = (
  {
    trn = "",
    expiring_date = "",
    expiry_date = "",
    receive_date = "",
    query_type = "",
    facilityId = "",
    facilityID,
    amount = "",
    modeOfPayment = "",
    source = "",
    destination = "",
    userId = "",
    patientId = "",
    debit = "",
    serviceHead = "",
    bank = "",
    branch_name = "",
    discount = "",
    customerName = "",
    qty_out = 0,
    trn_number = "",
    item_code = "",
    status = "",
    req_no = "",
    phone = "0",
    customer_bank = "",
    customer_acc_no = "",
    transaction_amount = "0",
    business_bank = "",
    business_bank_acc_no = "",
    _rev,
    _id = "",
    receiptNo = "",
    customerId = "",
    createdAt,
    amountPaid = 0,
    cost_price = 0,
    truckNo = "",
    waybillNo = "",
    otherInfo = "",
    itemList = "",
    txn_type = "",
    supplier_code = "",
    supplier_name = "",
    salesFrom = "",
    quantity = "",
    description = "",
    clientAccount = "",
    financialEntries = [], // Destructure financialEntries from input
  },
  callback = (f) => f,
  error = (f) => f
) => {
  let selling_price = parseFloat(amount) / parseFloat(quantity);
  let version_id = _rev ? _rev : Date.now();
  let receiptno = receiptNo;
  const generatedPVCode = `REF/${moment().format("YY")}/${Math.floor(
    Math.random() * 1000
  )}`;

  console.log(
    financialEntries,
    "===============================>financialEntries"
  );
        if (Array.isArray(financialEntries) && financialEntries.length > 0) {

  db.sequelize.query(
    `CALL add_sales(
    :in_query_type,
    :in_ref_no,
    :in_customer,
    :in_amount,
    :in_discount,
    :in_invoice,
    :in_operator,
    :in_facilityId
    )`,
    {
      replacements: {
        in_query_type: "create",
        in_ref_no: generatedPVCode,
        in_customer: customerId || "Walk-in",
        in_amount: financialEntries.reduce(
          (total, entry) => total + entry.depositAmount,
          0
        ),
        in_discount: discount,
        in_invoice: receiptno,
        in_operator: userId,
        in_facilityId: facilityID || facilityId,
      },
    }
  );}

  // db.sequelize

  //     }
  //   )
  // .then((results1) => {
  db.sequelize
    .query(
      `CALL store_entries(
            :query_type,
            :item_name,
            :qty_in,
            :selling_price,
            :transaction_date,
            :item_category,
            :item_code,
            :version_id,
            :facilityId,
            :qty_out,
            :req_no,
            :user_id,
            :cost_price,
            :supplier_code,
            :supplier_name,
            :sales_type,
            :store_name,
            :mark_up,
            :truck_no,
            :waybill_no,
            :reorder_level,
            :inserted_by,
            :branch_name,
            :po_no,
            :expire_date,
            :unit_price,
            :reference_number,
            :subhead,
            :category,
            :unit
          )`,
      {
        replacements: {
          query_type: "sales",
          item_name: description,
          qty_in: 0,
          selling_price: selling_price || 0,
          transaction_date: receive_date,
          item_category: "",
          item_code: item_code || "",
          version_id,
          facilityId: facilityID || facilityId,
          qty_out: quantity || 0,
          req_no: req_no || "",
          user_id: userId,
          cost_price: cost_price,
          supplier_code: "",
          supplier_name: "",
          sales_type: "",
          store_name: "",
          mark_up: null,
          truck_no: null,
          waybill_no: null,
          reorder_level: null,
          inserted_by: null,
          branch_name: null,
          po_no: null,
          expire_date: null,
          unit_price: null,
          reference_number: generatedPVCode,
          subhead: null,
          category: null,
          unit: null,
        },
      }
    )
    .then(async (results2) => {
      //  Insert financial (journal) entries, if any
      if (Array.isArray(financialEntries) && financialEntries.length > 0) {
        const momentDate = moment().format("YYYY-MM-DD");

        try {
          await Promise.all(
            financialEntries.map((entry) => {
              const generatedPVCode = `REF/${moment().format(
                "YY"
              )}/${Math.floor(Math.random() * 1000)}`;
              return db.sequelize.query(
                `CALL general_ledger(
                  :query_type, :entries_date, :amount, :destination_name, :head,
                  :account_description, :facility_id, :refrence_number, :cheque_no,
                  :created_by, :pv_no, :account_type, :balance_type, :payee, :purpose_of_payment,:account_subhead)`,
                {
                  replacements: {
                    query_type: entry.query_type || "net",
                    entries_date: momentDate,
                    amount: entry.depositAmount || 0,
                    destination_name: entry.description,
                    head: entry.payable_code,
                    account_description: entry.payable_description,
                    facility_id: entry.facilityId,
                    refrence_number: generatedPVCode,
                    cheque_no: null,
                    created_by: entry.store_name,
                    pv_no: null,
                    account_type: entry.account_type || "Expense",
                    balance_type: entry.balance_type || "Debit",
                    payee: customerName,
                    purpose_of_payment: entry.description,
                    account_subhead: entry.account_subhead || null,
                  },
                }
              );
            })
          );
        } catch (err) {
          console.error("Error inserting general ledger entries:", err);
          return error(err);
        }
      }

      // ✅ Final success callback
      callback(results2);
    })
    .catch((err) => {
      console.error("Error in store_entries:", err);
      error(err);
    });
};

exports.getJournalEntries = (req, res) => {
  db.sequelize
    .query(`SELECT * FROM journal_entries where status = "Pending"`)
    .then((results) => {
      res.json({ success: true, results: results[0] });
    })
    .catch((err) => res.status(500).json({ err }));
};

exports.processGeneralLedgerEntries = async (req, res) => {
  const generatedPVCode = `REF/${moment().format("YY")}/${Math.floor(
    Math.random() * 1000
  )}`;
  try {
    const {
      firstEntry,
      secondEntry,
      thirdEntry,
      fourthEntry,
      fifthEntry,
      sixthEntry,
      entryData,
    } = req.body;

    console.log(req.body, "req.body==========================>");

    const entries = [];

    if (firstEntry) {
      entries.push({
        query_type: "net",
        entries_date: moment().format("YYYY-MM-DD"),
        amount: firstEntry.depositAmount,
        destination_name: firstEntry.description,
        head: firstEntry.payable_code,
        account_description: firstEntry.payable_description,
        facility_id: firstEntry.facilityId,
        refrence_number: generatedPVCode,
        cheque_no: null,
        created_by: firstEntry.store_name,
        pv_no: null,
        account_type: "Inventory",
        balance_type: "Debit",
        // transaction_id: entryData.transaction_id,
      });
    }

    if (secondEntry) {
      entries.push({
        query_type: "tax",
        entries_date: moment().format("YYYY-MM-DD"),
        amount: secondEntry.depositAmount,
        destination_name: secondEntry.description,
        head: secondEntry.payable_code,
        account_description: secondEntry.payable_description,
        facility_id: secondEntry.facilityId,
        refrence_number: generatedPVCode,
        cheque_no: null,
        created_by: secondEntry.store_name,
        pv_no: null,
        account_type: "Asset",
        balance_type: "Credit",
        // transaction_id: entryData.transaction_id,
      });
    }

    if (thirdEntry) {
      entries.push({
        query_type: "tax",
        entries_date: moment().format("YYYY-MM-DD"),
        amount: thirdEntry.depositAmount,
        destination_name: thirdEntry.description,
        head: thirdEntry.payable_code,
        account_description: thirdEntry.payable_description,
        facility_id: thirdEntry.facilityId,
        refrence_number: generatedPVCode,
        cheque_no: null,
        created_by: thirdEntry.store_name,
        pv_no: null,
        account_type: "Receivable",
        balance_type: "Credit",
        // transaction_id: entryData.transaction_id,
      });
    }

    if (fourthEntry) {
      entries.push({
        query_type: "net",
        entries_date: moment().format("YYYY-MM-DD"),
        amount: fourthEntry.depositAmount,
        destination_name: fourthEntry.description,
        head: fourthEntry.payable_code,
        account_description: fourthEntry.payable_description,
        facility_id: fourthEntry.facilityId,
        refrence_number: generatedPVCode,
        cheque_no: null,
        created_by: fourthEntry.store_name,
        pv_no: null,
        account_type: "Payable",
        balance_type: "Credit",
        // transaction_id: entryData.transaction_id,
      });
    }

    if (fifthEntry) {
      entries.push({
        query_type: "net",
        entries_date: moment().format("YYYY-MM-DD"),
        amount: fifthEntry.depositAmount,
        destination_name: fifthEntry.description,
        head: fifthEntry.payable_code,
        account_description: fifthEntry.payable_description,
        facility_id: fifthEntry.facilityId,
        refrence_number: generatedPVCode,
        cheque_no: null,
        created_by: fifthEntry.store_name,
        pv_no: null,
        account_type: "Expense",
        balance_type: "Debit",
        // transaction_id: entryData.transaction_id,
      });
    }

    if (sixthEntry) {
      entries.push({
        query_type: "tax",
        entries_date: moment().format("YYYY-MM-DD"),
        amount: sixthEntry.depositAmount,
        destination_name: sixthEntry.description,
        head: sixthEntry.payable_code,
        account_description: sixthEntry.payable_description,
        facility_id: sixthEntry.facilityId,
        refrence_number: generatedPVCode,
        cheque_no: null,
        created_by: sixthEntry.store_name,
        pv_no: null,
        account_type: "Expense",
        balance_type: "Debit",
        payee: '',
        // transaction_id: entryData.transaction_id,
      });
    }

    // If no valid entries exist, return an error
    if (entries.length === 0) {
      return res.status(400).json({
        success: false,
        message: "At least one valid journal entry is required.",
      });
    }

    // Execute queries for non-empty entries
    await Promise.all(
      entries.map((entry) =>
        db.sequelize.query(
          `CALL general_ledger(
            :query_type, :entries_date, :amount, :destination_name, :head,
            :account_description, :facility_id, :refrence_number, :cheque_no,
            :created_by, :pv_no, :account_type, :balance_type, :payee, :purpose_of_payment,:account_subhead)`,
          { replacements: entry }
        )
      )
    );

    res.status(200).json({
      success: true,
      message: "Valid journal entries inserted successfully.",
    });
  } catch (err) {
    console.error("Error processing journal entries:", err);
    res.status(500).json({ success: false, error: err.message });
  }
};
