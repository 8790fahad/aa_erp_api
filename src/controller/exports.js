exports.paySupplierBills = async (req, res) => {
    const {
      facilityId,
      payment_date,
      mode_of_payment, // cash | bank | cheque
      bankAccount, // { id }
      accountHead, // { head: "104" }
      cheque_number,
      remark = "Supplier Bill Payment",
      bills = [], // array of { invoice_ref, amount_to_pay }
    } = req.body;
  
    const userId = req.user?.id || req.body.user_id;
  
    // === VALIDATIONS ===
    if (!facilityId)
      return res
        .status(400)
        .json({ success: false, message: "facilityId is required" });
    if (!payment_date)
      return res
        .status(400)
        .json({ success: false, message: "payment_date is required" });
    if (!["cash", "bank", "cheque"].includes(mode_of_payment))
      return res
        .status(400)
        .json({ success: false, message: "Invalid mode_of_payment" });
    if (!Array.isArray(bills) || bills.length === 0)
      return res
        .status(400)
        .json({ success: false, message: "bills array is required" });
  
    // Validate payment source
    if (mode_of_payment === "cash") {
      if (!accountHead?.head?.trim())
        return res.status(400).json({
          success: false,
          message: "Account Head is required for cash payments",
        });
    } else if (["bank", "cheque"].includes(mode_of_payment)) {
      if (!bankAccount?.id)
        return res.status(400).json({
          success: false,
          message: "Bank Account is required for bank/cheque payments",
        });
    }
  
    if (mode_of_payment === "cheque" && !cheque_number)
      return res.status(400).json({
        success: false,
        message: "cheque_number is required for cheque payments",
      });
  
    let transaction;
    try {
      transaction = await db.sequelize.transaction();
  
      // Generate Payment Voucher Number
      const pvCodeResult = await getAndUpdateNumber("direct_p", facilityId);
      if (typeof pvCodeResult === "object" && pvCodeResult.message) {
        throw new Error(
          pvCodeResult.message || "Failed to generate payment voucher number"
        );
      }
      const pvCode =
        typeof pvCodeResult === "number"
          ? pvCodeResult
          : parseInt(pvCodeResult) || Date.now();
      const pvCodeString = String(pvCode);
      const paymentRef = `PAY/${moment().format("YY")}/${pvCodeString}`;
      const narration = remark || `Supplier Payment - ${paymentRef}`;
  
      let totalPaymentAmount = 0;
      const ledgerEntries = [];
      const paymentRecords = []; // To return which bills were paid
  
      // Determine Payment Source Account (Cash or Bank)
      let paymentAccount = null;
      let paymentAccountName = "Cash/Bank";
      let paymentHead = null;
  
      if (mode_of_payment === "cash") {
        paymentHead = accountHead.head.trim();
        paymentAccount = await db.Account.findOne({
          where: { head: paymentHead, facilityId },
          transaction,
        });
        if (!paymentAccount)
          throw new Error(`Cash account not found: ${paymentHead}`);
        paymentAccountName = paymentAccount.description || "Cash in Hand";
      } else if (["bank", "cheque"].includes(mode_of_payment)) {
        const bankAcc = await db.bank_account.findOne({
          where: { id: bankAccount.id, facilityId, status: "active" },
          transaction,
        });
        if (!bankAcc || !bankAcc.head)
          throw new Error("Bank account invalid or missing GL head");
  
        paymentHead = bankAcc.head;
        paymentAccountName = bankAcc.account_name;
  
        paymentAccount = await db.Account.findOne({
          where: { head: bankAcc.head, facilityId },
          transaction,
        });
        if (!paymentAccount)
          throw new Error(`GL account not found for bank head: ${bankAcc.head}`);
      }
      const supplierData = [];
      // Process each bill
      for (const bill of bills) {
        const { invoice_ref, amount_to_pay } = bill;
        if (!invoice_ref || !amount_to_pay || parseFloat(amount_to_pay) <= 0) {
          continue; // skip invalid
        }
  
        const amountPayable = parseFloat(amount_to_pay);
        totalPaymentAmount += amountPayable;
  
        const invoice = await db.Invoice.findOne({
          where: {
            invoice_ref,
            facility_id: facilityId,
            type: "purchase",
          },
          transaction,
        });
  
        if (!invoice) throw new Error(`Invoice ${invoice_ref} not found`);
  
        const supplier_no = invoice.ref_number;
        supplierData.push(supplier_no);
        // Update Supplier Balance (inside transaction)
        await db.SuppliersInfo.decrement(
          { balance: amountPayable },
          { where: { supplier_number: supplier_no, facilityId }, transaction }
        );
  
        const supplier = await db.SuppliersInfo.findOne({
          where: { supplier_number: supplier_no, facilityId },
          transaction,
        });
  
        if (!supplier?.payable_code)
          throw new Error(`No payable head for supplier ${supplier_no}`);
  
        // Find Accounts Payable Account
        const payableAcc = await db.Account.findOne({
          where: { head: supplier.payable_code, facilityId },
          transaction,
        });
        if (!payableAcc)
          throw new Error(`Payable account not found: ${supplier.payable_code}`);
  
        // Debit: Accounts Payable (Reduce Liability)
        ledgerEntries.push({
          account_code: payableAcc.head,
          account_subhead: payableAcc.subhead || null,
          dr: amountPayable,
          cr: 0,
          account_description: payableAcc.description,
          transaction_description: `Payment for Invoice ${invoice_ref}`,
          type: "payable",
          bank_account_id: mode_of_payment !== "cash" ? bankAccount.id : null,
          transaction_ref: supplier_no,
        });
  
        // Create Supplier Payment Entry
        await db.SupplierEntry.create(
          {
            supplier_number: supplier_no,
            description: `${narration} - Ref: ${invoice_ref}`,
            cost: amountPayable,
            qty_in: 1,
            qty_out: 0,
            link_id: invoice_ref,
            facilityId,
            mode_of_payment,
            bank_account_id:  bankAccount.id || accountHead?.head ,
            cheque_no: mode_of_payment === "cheque" ? cheque_number : null,
            type: "payment",
            receiptNo: pvCodeString,
            reference: paymentRef,
            created_by: userId,
            transaction_date: moment(payment_date).format("YYYY-MM-DD"),
          },
          { transaction }
        );
  
        paymentRecords.push({
          invoice_ref,
          amount_paid: amountPayable,
          supplier_no,
        });
        ledgerEntries.push({
          account_code: paymentAccount.head,
          account_subhead: paymentAccount.subhead || null,
          dr: 0,
          cr: amount_to_pay,
          account_description: paymentAccount.description,
          transaction_description: "Supplier Bill Payment",
          type: "payment",
          bank_account_id: mode_of_payment !== "cash" ? bankAccount.id : null,
          transaction_ref: supplier_no,
        });
      }
  
      if (totalPaymentAmount <= 0) {
        await transaction.rollback();
        return res
          .status(400)
          .json({ success: false, message: "No valid payments to process" });
      }
  
      // Save All Ledger Entries
      for (const entry of ledgerEntries) {
        await db.GeneralLedger.create(
          {
            transaction_date: moment(payment_date).format("YYYY-MM-DD"),
            account_code: entry.account_code,
            account_subhead: entry.account_subhead || 0,
            dr: entry.dr,
            cr: entry.cr,
            bank_account_id: entry.bank_account_id || null,
            account_description: entry.account_description,
            transaction_description: entry.transaction_description,
            transaction_ref: entry.transaction_ref,
            reference_number: pvCodeString,
            purpose_of_payment: narration,
            payee: "Multiple Suppliers",
            created_by: userId,
            facility_id: facilityId,
            status: "paid",
            type: entry.type,
            mode_of_payment,
            cheque_no: mode_of_payment === "cheque" ? cheque_number : null,
          },
          { transaction }
        );
      }
  
      await transaction.commit();
  
      return res.json({
        success: true,
        message: "Supplier bills paid successfully",
        data: {
          payment_ref: paymentRef,
          pv_code: pvCodeString,
          total_payment_amount: totalPaymentAmount,
          bills_paid_count: paymentRecords.length,
          mode_of_payment,
          payment_via: paymentAccountName,
          payment_account_head: paymentHead,
          payment_date: moment(payment_date).format("YYYY-MM-DD"),
          narration,
          bills: paymentRecords,
        },
      });
    } catch (err) {
      console.error("Pay Supplier Bills Error:", err);
      if (transaction)
        await transaction
          .rollback()
          .catch((e) => console.error("Rollback failed:", e));
      return res.status(500).json({
        success: false,
        message: "Failed to process payment",
        error: err.message,
      });
    }
  };