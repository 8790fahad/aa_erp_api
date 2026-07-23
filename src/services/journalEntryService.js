const db = require("../models");
const { Op } = require("sequelize");
const {
  validateJournalEntry,
  calculateBaseAmounts,
  JournalValidationError,
} = require("../utils/journalValidation");

/**
 * Service layer for Journal Entry business logic
 * Uses GeneralLedger table directly
 */

class JournalEntryService {
  static async resolveUserDisplayName(createdBy, facilityId = null) {
    if (createdBy == null || String(createdBy).trim() === "") return null;
    const raw = String(createdBy).trim();
    const upper = raw.toUpperCase();

    const candidates = [raw];
    if (/^\d+$/.test(raw)) {
      candidates.push(Number(raw));
    }
    // Handle legacy values like USER-57.
    const userSuffix = raw.match(/^USER-(\d+)$/i);
    if (userSuffix) {
      candidates.push(Number(userSuffix[1]));
    }

    const orConditions = [
      { id: { [Op.in]: candidates.filter((v) => typeof v === "number") } },
      { username: { [Op.in]: candidates.map((v) => String(v)) } },
      { email: { [Op.in]: candidates.map((v) => String(v)) } },
      { code: { [Op.in]: candidates.map((v) => String(v)) } },
    ];
    const where = { [Op.or]: orConditions };
    if (facilityId) where.facilityId = String(facilityId);

    const user = await db.users.findOne({
      where,
      attributes: ["firstname", "lastname", "username", "email", "code"],
    });

    if (!user) {
      // Fallback for legacy databases that keep user names in sign_up table.
      try {
        const suffix = userSuffix ? userSuffix[1] : null;
        const [rows] = await db.sequelize.query(
          `SELECT fullname, username, id
           FROM sign_up
           WHERE username = :raw
              OR CAST(id AS CHAR) = :raw
              OR (:suffix IS NOT NULL AND CAST(id AS CHAR) = :suffix)
           LIMIT 1`,
          {
            replacements: { raw, suffix },
          }
        );
        if (Array.isArray(rows) && rows.length > 0) {
          const row = rows[0];
          return row.fullname || row.username || upper;
        }
      } catch (_) {
        // Ignore legacy-table lookup failure.
      }
      return upper;
    }

    const fullName = [user.firstname, user.lastname]
      .filter(Boolean)
      .join(" ")
      .trim();

    return fullName || user.username || user.email || upper;
  }

  /**
   * Note: Reference number generation is now handled by the number generator service
   * Use /get-and-update/JE/:facilityId endpoint to get auto-generated reference numbers
   */

  /**
   * Generate unique transaction reference for grouping lines
   */
  static generateTransactionRef() {
    return `JE-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Helper function to check if an account is A/R or A/P
   */
  static async isARorAPAccount(accountCode, facilityId) {
    if (!accountCode) return { isAR: false, isAP: false };

    try {
      // Fetch account details from Account table
      const account = await db.Account.findOne({
        where: {
          head: accountCode,
          facilityId: facilityId.toString(),
        },
      });

      if (!account) return { isAR: false, isAP: false };

      const accountName = (account.description || "").toUpperCase();
      const accountType = (account.account_type || "").toUpperCase();
      const typeMnemonic = (account.type_mnemonic || "").toUpperCase();
      const typeDetails = (account.type_details || "").toUpperCase();

      const isAR =
        accountName.includes("A/R") ||
        accountName.includes("ACCOUNTS RECEIVABLE") ||
        accountType.includes("RECEIVABLE") ||
        typeMnemonic.includes("AR") ||
        typeMnemonic.includes("RECEIVABLE") ||
        typeDetails.includes("RECEIVABLE");

      const isAP =
        accountName.includes("A/P") ||
        accountName.includes("ACCOUNTS PAYABLE") ||
        accountType.includes("PAYABLE") ||
        typeMnemonic.includes("AP") ||
        typeMnemonic.includes("PAYABLE") ||
        typeDetails.includes("PAYABLE");

      return { isAR, isAP };
    } catch (error) {
      console.error("Error checking account type:", error);
      return { isAR: false, isAP: false };
    }
  }

  /**
   * Create a new journal entry
   */
  static async createJournalEntry(data, facilityId, userId) {
    const transaction = await db.sequelize.transaction();
    const notes = data.notes || data.description || "Journal Entry";
    try {
      // Reference number must be provided from frontend (generated via number generator)
      if (!data.reference_number) {
        throw new Error(
          "Reference number is required. Please use the number generator."
        );
      }

      // Validate the journal entry
      const validation = await validateJournalEntry(data, facilityId, userId);
      if (!validation.valid) {
        throw new JournalValidationError(
          "Validation failed",
          validation.errors
        );
      }

      // Calculate base amounts for lines
      const linesWithBaseAmounts = calculateBaseAmounts(
        data.lines,
        data.currency || "NGN"
      );

      // Generate unique transaction reference for grouping
      const transactionRef = this.generateTransactionRef();

      // Create general ledger entries (one for each line)
      // If a line is linked to a customer/supplier (number_id), store that ID in transaction_ref
      // so balance reports can use it. Otherwise, use the journal-wide transactionRef.
      const ledgerEntries = linesWithBaseAmounts.map((line, index) => ({
        transaction_date: line.line_date || data.entry_date,
        account_code: line.account_code,
        account_subhead:0 ,
        dr: line.debit || 0,
        cr: line.credit || 0,
        transaction_description:
          line.line_description ||
          line.description ||
          data.description ||
          line.account_name ||
          "",
        account_description: line.account_name || "",
        reference_number: data.reference_number,
        purpose_of_payment: notes || "Journal Entry",
        payee: data.payee || null,
        created_by: userId,
        facility_id: facilityId,
        status: "saved", // Draft status
        type: "journal_entry", // Use valid ENUM value - inventory for general journal entries
        transaction_ref: line.number_id || transactionRef,
      }));

      console.log("Creating journal entry lines:", ledgerEntries);

      await db.GeneralLedger.bulkCreate(ledgerEntries, { transaction });

      // Calculate totals for summary
      let totalDebit = 0;
      let totalCredit = 0;
      linesWithBaseAmounts.forEach((line) => {
        totalDebit += parseFloat(line.debit) || 0;
        totalCredit += parseFloat(line.credit) || 0;
      });

      // Create summary entry in journal_entries table (optional - table may not exist)
      // Using raw query to avoid model definition issues
      try {
        await db.sequelize.query(
          `INSERT INTO journal_entries
           (reference_number, transaction_ref, entry_date, currency, description, total_debit, total_credit, status, created_by, facility_id, created_at, updated_at)
           VALUES (:reference_number, :transaction_ref, :entry_date, :currency, :description, :total_debit, :total_credit, :status, :created_by, :facility_id, NOW(), NOW())`,
          {
            replacements: {
              reference_number: data.reference_number,
              transaction_ref: transactionRef,
              entry_date: data.entry_date,
              currency: data.currency || "NGN",
              description: data.notes || data.description || "Journal Entry",
              total_debit: totalDebit,
              total_credit: totalCredit,
              status: "draft",
              created_by: userId,
              facility_id: facilityId,
            },
            type: db.sequelize.QueryTypes.INSERT,
            transaction,
          }
        );
        console.log("Created journal entry summary:", transactionRef);
      } catch (journalError) {
        // Journal entry summary table may not exist or have different structure
        // Continue without it - the main entry is in general_ledger
        console.warn("Could not create journal entry summary:", journalError.message);
      }

      // Check for A/R and A/P accounts and create entries in customer_entries or supplier_entries
      for (const line of linesWithBaseAmounts) {
        if (!line.account_code || !line.number_id) continue;

        const accountCheck = await this.isARorAPAccount(
          line.account_code,
          facilityId
        );

        // Get the supplier/customer type from the line data
        const supplierCustomerType = (
          line.supplier_customer_type ||
          line.type ||
          ""
        ).toLowerCase();

        const amount = parseFloat(line.debit) || parseFloat(line.credit) || 0;
        if (amount <= 0) continue;

        // For A/R accounts: Create customer entry if type is "Customer"
        if (accountCheck.isAR && supplierCustomerType === "customer") {
          // Verify customer exists
          const customer = await db.Customer.findOne({
            where: {
              customerNo: line.number_id.toString(),
              facilityId: facilityId.toString(),
            },
            transaction,
          });

          if (!customer) {
            console.warn(
              `Customer ${line.number_id} not found, skipping customer entry`
            );
            continue;
          }

          await db.CustomerEntry.create(
            {
              customerNo: line.number_id.toString(),
              description: data.notes || data.description || "Journal Entry",
              cost: amount,
              facilityId: facilityId.toString(),
              mode_of_payment: "Journal Entry",
              receiptNo: data.reference_number,
              link_id: transactionRef,
              type: line.debit > 0 ? "deposit" : "purchase", // Debit = deposit, Credit = purchase
              created_by: userId.toString(),
            },
            { transaction }
          );
          console.log(
            `Created customer entry for A/R account: ${line.account_code}, Customer: ${line.number_id}`
          );
        }

        // For A/P accounts: Create supplier entry if type is "Supplier"
        if (accountCheck.isAP && supplierCustomerType === "supplier") {
          // Verify supplier exists
          const supplier = await db.SuppliersInfo.findOne({
            where: {
              supplier_number: line.number_id.toString(),
              facilityId: facilityId.toString(),
            },
            transaction,
          });

          if (!supplier) {
            console.warn(
              `Supplier ${line.number_id} not found, skipping supplier entry`
            );
            continue;
          }

          await db.SupplierEntry.create(
            {
              supplier_number: line.number_id.toString(),
              description: data.notes || data.description || "Journal Entry",
              cost: amount,
              facilityId: facilityId.toString(),
              mode_of_payment: "Journal Entry",
              cheque_no: data.reference_number,
              link_id: transactionRef,
              type: line.credit > 0 ? "payment" : "purchase", // Credit = payment, Debit = purchase
              created_by: userId.toString(),
            },
            { transaction }
          );
          console.log(
            `Created supplier entry for A/P account: ${line.account_code}, Supplier: ${line.number_id}`
          );
        }
      }

      await transaction.commit();

      console.log(
        `✓ Journal entry created with transaction_ref: ${transactionRef}`
      );

      // Fetch and return the created entry (after commit, so errors won't rollback)
      try {
        return await this.getJournalEntryByRef(transactionRef, facilityId);
      } catch (fetchError) {
        // If fetch fails, we still return success since the entry was created
        console.warn("Could not fetch created journal entry:", fetchError.message);
        // Return minimal data
        return {
          transaction_ref: transactionRef,
          reference_number: data.reference_number,
          entry_date: data.entry_date,
          description: data.notes || data.description || "Journal Entry",
          status: "draft",
          total_debit: totalDebit.toFixed(2),
          total_credit: totalCredit.toFixed(2),
          facility_id: facilityId,
          created_by: userId,
          lines: linesWithBaseAmounts.map((line, index) => ({
            id: index + 1,
            line_number: index + 1,
            account_code: line.account_code,
            account_name: line.account_name || "",
            description: line.description || "",
            debit: parseFloat(line.debit || 0).toFixed(2),
            credit: parseFloat(line.credit || 0).toFixed(2),
            number_id: line.number_id || null,
          })),
        };
      }
    } catch (error) {
      // Only rollback if transaction is still active
      if (transaction && !transaction.finished) {
        await transaction.rollback();
      }
      throw error;
    }
  }

  /**
   * Update an existing journal entry (only drafts can be updated)
   */
  static async updateJournalEntry(transactionRef, data, facilityId, userId) {
    const transaction = await db.sequelize.transaction();

    try {
      // Find existing entry lines
      const existingLines = await db.GeneralLedger.findAll({
        where: {
          transaction_ref: transactionRef,
          facility_id: facilityId,
        },
      });

      if (existingLines.length === 0) {
        throw new Error("Journal entry not found");
      }

      // Validate that entry is not posted
      if (existingLines[0].status === "posted") {
        throw new Error("Posted journal entries cannot be modified");
      }

      if (existingLines[0].status === "reversed") {
        throw new Error("Reversed journal entries cannot be modified");
      }

      // Validate the updated journal entry
      const validation = await validateJournalEntry(
        data,
        facilityId,
        userId,
        true,
        transactionRef
      );
      if (!validation.valid) {
        throw new JournalValidationError(
          "Validation failed",
          validation.errors
        );
      }

      // Calculate base amounts for lines
      const linesWithBaseAmounts = calculateBaseAmounts(
        data.lines,
        data.currency || "NGN"
      );

      // Delete existing lines
      await db.GeneralLedger.destroy({
        where: { transaction_ref: transactionRef },
        transaction,
      });

      // Create new lines
      const ledgerEntries = linesWithBaseAmounts.map((line) => ({
        transaction_date: line.line_date || data.entry_date,
        account_code: line.account_code,
        account_subhead: line.account_name || "",
        dr: line.debit || 0,
        cr: line.credit || 0,
        account_description: line.account_name || "",
        transaction_description:
          line.line_description || line.description || data.description || "",
        reference_number: data.reference_number,
        purpose_of_payment: data.description || "Journal Entry",
        payee: data.payee || null,
        created_by: userId,
        updated_by: userId,
        facility_id: facilityId,
        status: "saved",
        type: "inventory", // Use valid ENUM value
        transaction_ref: line.number_id || transactionRef,
      }));

      await db.GeneralLedger.bulkCreate(ledgerEntries, { transaction });

      // Calculate totals for summary
      let totalDebit = 0;
      let totalCredit = 0;
      linesWithBaseAmounts.forEach((line) => {
        totalDebit += parseFloat(line.debit) || 0;
        totalCredit += parseFloat(line.credit) || 0;
      });

      // Update or create summary entry in journal_entries table
      const existingSummary = await db.JournalEntry.findOne({
        where: {
          transaction_ref: transactionRef,
          facility_id: facilityId,
        },
        transaction,
      });

      if (existingSummary) {
        await db.JournalEntry.update(
          {
            reference_number: data.reference_number,
            entry_date: data.entry_date,
            currency: data.currency || "NGN",
            description: data.notes || data.description || "Journal Entry",
            total_debit: totalDebit,
            total_credit: totalCredit,
            updated_by: userId,
          },
          {
            where: { transaction_ref: transactionRef },
            transaction,
          }
        );
      } else {
        await db.JournalEntry.create(
          {
            reference_number: data.reference_number,
            transaction_ref: transactionRef,
            entry_date: data.entry_date,
            currency: data.currency || "NGN",
            description: data.notes || data.description || "Journal Entry",
            total_debit: totalDebit,
            total_credit: totalCredit,
            status: "draft",
            created_by: userId,
            facility_id: facilityId,
          },
          { transaction }
        );
      }

      // Delete existing customer/supplier entries for this transaction
      await db.CustomerEntry.destroy({
        where: { link_id: transactionRef },
        transaction,
      });
      await db.SupplierEntry.destroy({
        where: { link_id: transactionRef },
        transaction,
      });

      // Recreate A/R and A/P entries
      for (const line of linesWithBaseAmounts) {
        if (!line.account_code || !line.number_id) continue;

        const accountCheck = await this.isARorAPAccount(
          line.account_code,
          facilityId
        );

        // Get the supplier/customer type from the line data
        const supplierCustomerType = (
          line.supplier_customer_type ||
          line.type ||
          ""
        ).toLowerCase();

        const amount = parseFloat(line.debit) || parseFloat(line.credit) || 0;
        if (amount <= 0) continue;

        // For A/R accounts: Create customer entry if type is "Customer"
        if (accountCheck.isAR && supplierCustomerType === "customer") {
          // Verify customer exists
          const customer = await db.Customer.findOne({
            where: {
              customerNo: line.number_id.toString(),
              facilityId: facilityId.toString(),
            },
            transaction,
          });

          if (!customer) {
            console.warn(
              `Customer ${line.number_id} not found, skipping customer entry`
            );
            continue;
          }

          await db.CustomerEntry.create(
            {
              customerNo: line.number_id.toString(),
              description: data.notes || data.description || "Journal Entry",
              cost: amount,
              facilityId: facilityId.toString(),
              mode_of_payment: "Journal Entry",
              receiptNo: data.reference_number,
              link_id: transactionRef,
              type: line.debit > 0 ? "deposit" : "purchase",
              created_by: userId.toString(),
            },
            { transaction }
          );
        }

        // For A/P accounts: Create supplier entry if type is "Supplier"
        if (accountCheck.isAP && supplierCustomerType === "supplier") {
          // Verify supplier exists
          const supplier = await db.SuppliersInfo.findOne({
            where: {
              supplier_number: line.number_id.toString(),
              facilityId: facilityId.toString(),
            },
            transaction,
          });

          if (!supplier) {
            console.warn(
              `Supplier ${line.number_id} not found, skipping supplier entry`
            );
            continue;
          }

          await db.SupplierEntry.create(
            {
              supplier_number: line.number_id.toString(),
              description: data.notes || data.description || "Journal Entry",
              cost: amount,
              facilityId: facilityId.toString(),
              mode_of_payment: "Journal Entry",
              cheque_no: data.reference_number,
              link_id: transactionRef,
              type: line.credit > 0 ? "payment" : "purchase",
              created_by: userId.toString(),
            },
            { transaction }
          );
        }
      }

      await transaction.commit();

      // Fetch updated entry (after commit, so errors won't rollback)
      try {
        return await this.getJournalEntryByRef(transactionRef, facilityId);
      } catch (fetchError) {
        console.warn("Could not fetch updated journal entry:", fetchError.message);
        // Return success anyway since the update was committed
        return {
          transaction_ref: transactionRef,
          reference_number: data.reference_number,
          entry_date: data.entry_date,
          description: data.notes || data.description || "Journal Entry",
          status: "draft",
          message: "Journal entry updated successfully",
        };
      }
    } catch (error) {
      // Only rollback if transaction is still active
      if (transaction && !transaction.finished) {
        await transaction.rollback();
      }
      throw error;
    }
  }

  /**
   * Post (approve) a journal entry
   */
  static async postJournalEntry(transactionRef, facilityId, userId) {
    const transaction = await db.sequelize.transaction();

    try {
      const lines = await db.GeneralLedger.findAll({
        where: {
          transaction_ref: transactionRef,
          facility_id: facilityId,
        },
      });

      if (lines.length === 0) {
        throw new Error("Journal entry not found");
      }

      if (lines[0].status !== "saved") {
        throw new Error("Only draft entries can be posted");
      }

      // Update all lines to posted status
      await db.GeneralLedger.update(
        {
          status: "posted",
          updated_by: userId,
        },
        {
          where: { transaction_ref: transactionRef },
          transaction,
        }
      );

      // Update summary entry status
      await db.JournalEntry.update(
        {
          status: "posted",
          updated_by: userId,
        },
        {
          where: { transaction_ref: transactionRef },
          transaction,
        }
      );

      await transaction.commit();

      // Fetch posted entry (after commit, so errors won't rollback)
      try {
        return await this.getJournalEntryByRef(transactionRef, facilityId);
      } catch (fetchError) {
        console.warn("Could not fetch posted journal entry:", fetchError.message);
        // Return success anyway since the post was committed
        return {
          transaction_ref: transactionRef,
          status: "posted",
          message: "Journal entry posted successfully",
        };
      }
    } catch (error) {
      // Only rollback if transaction is still active
      if (transaction && !transaction.finished) {
        await transaction.rollback();
      }
      throw error;
    }
  }

  /**
   * Reverse a posted journal entry
   */
  static async reverseJournalEntry(
    transactionRef,
    facilityId,
    userId,
    reversalDate
  ) {
    const transaction = await db.sequelize.transaction();

    try {
      const originalLines = await db.GeneralLedger.findAll({
        where: {
          transaction_ref: transactionRef,
          facility_id: facilityId,
        },
      });

      if (originalLines.length === 0) {
        throw new Error("Journal entry not found");
      }

      if (originalLines[0].status !== "posted") {
        throw new Error("Only posted entries can be reversed");
      }

      // Check if already reversed
      const existingReversal = await db.GeneralLedger.findOne({
        where: {
          facility_id: facilityId,
          type: "inventory",
          reference_number: {
            [Op.like]: `REV-${originalLines[0].reference_number}%`,
          },
        },
      });

      if (existingReversal) {
        throw new Error("This entry has already been reversed");
      }

      // Get original summary entry for currency
      const originalSummary = await db.JournalEntry.findOne({
        where: {
          transaction_ref: transactionRef,
          facility_id: facilityId,
        },
        transaction,
      });

      // Create reversal entry with mirrored lines
      // Use REV prefix + original reference number
      const reversalRefNumber = `REV-${originalLines[0].reference_number}`;
      const reversalTransactionRef = this.generateTransactionRef();

      const reversalEntries = originalLines.map((line) => ({
        transaction_date: reversalDate || new Date(),
        account_code: line.account_code,
        account_subhead: line.account_subhead,
        dr: line.cr, // Swap debit and credit
        cr: line.dr,
        account_description: line.account_description,
        transaction_description: `Reversal: ${line.transaction_description}`,
        reference_number: reversalRefNumber,
        purpose_of_payment: `Reversal of ${originalLines[0].reference_number}: ${originalLines[0].purpose_of_payment}`,
        payee: line.payee,
        created_by: userId,
        facility_id: facilityId,
        status: "posted",
        type: "inventory", // Use valid ENUM value
        transaction_ref: reversalTransactionRef,
      }));

      await db.GeneralLedger.bulkCreate(reversalEntries, { transaction });

      // Update original entry status to reversed
      await db.GeneralLedger.update(
        {
          status: "reversed",
          updated_by: userId,
        },
        {
          where: { transaction_ref: transactionRef },
          transaction,
        }
      );

      // Update original summary entry status to reversed
      if (originalSummary) {
        await db.JournalEntry.update(
          {
            status: "reversed",
            updated_by: userId,
          },
          {
            where: { transaction_ref: transactionRef },
            transaction,
          }
        );
      }

      // Create reversal summary entry
      const reversalTotalDebit = originalLines.reduce(
        (sum, line) => sum + (parseFloat(line.cr) || 0),
        0
      );
      const reversalTotalCredit = originalLines.reduce(
        (sum, line) => sum + (parseFloat(line.dr) || 0),
        0
      );

      await db.JournalEntry.create(
        {
          reference_number: reversalRefNumber,
          transaction_ref: reversalTransactionRef,
          entry_date: reversalDate || new Date(),
          currency: originalSummary?.currency || "NGN",
          description: `Reversal: ${
            originalSummary?.description || originalLines[0].purpose_of_payment
          }`,
          total_debit: reversalTotalDebit,
          total_credit: reversalTotalCredit,
          status: "posted",
          created_by: userId,
          facility_id: facilityId,
        },
        { transaction }
      );

      await transaction.commit();

      // Fetch reversal entry (after commit, so errors won't rollback)
      try {
        return await this.getJournalEntryByRef(
          reversalTransactionRef,
          facilityId
        );
      } catch (fetchError) {
        console.warn("Could not fetch reversal journal entry:", fetchError.message);
        // Return success anyway since the reversal was committed
        return {
          transaction_ref: reversalTransactionRef,
          reference_number: reversalRefNumber,
          status: "posted",
          message: "Journal entry reversed successfully",
        };
      }
    } catch (error) {
      // Only rollback if transaction is still active
      if (transaction && !transaction.finished) {
        await transaction.rollback();
      }
      throw error;
    }
  }

  /**
   * Delete a journal entry (only drafts)
   */
  static async deleteJournalEntry(transactionRef, facilityId) {
    const transaction = await db.sequelize.transaction();

    try {
      const lines = await db.GeneralLedger.findAll({
        where: {
          transaction_ref: transactionRef,
          facility_id: facilityId,
        },
        transaction,
      });

      if (lines.length === 0) {
        throw new Error("Journal entry not found");
      }

      if (lines[0].status !== "saved") {
        throw new Error("Only draft entries can be deleted");
      }

      // Delete general ledger entries
      await db.GeneralLedger.destroy({
        where: { transaction_ref: transactionRef },
        transaction,
      });

      // Delete summary entry
      await db.JournalEntry.destroy({
        where: {
          transaction_ref: transactionRef,
          facility_id: facilityId,
        },
        transaction,
      });

      // Delete customer/supplier entries
      await db.CustomerEntry.destroy({
        where: { link_id: transactionRef },
        transaction,
      });
      await db.SupplierEntry.destroy({
        where: { link_id: transactionRef },
        transaction,
      });

      await transaction.commit();

      return { message: "Journal entry deleted successfully" };
    } catch (error) {
      // Only rollback if transaction is still active
      if (transaction && !transaction.finished) {
        await transaction.rollback();
      }
      throw error;
    }
  }

  /**
   * Get journal entry by transaction reference
   */
  static async getJournalEntryByRef(transactionRef, facilityId) {
    // First try to get from journal_entries summary table (optional - may not exist)
    let summary = null;
    try {
      summary = await db.JournalEntry.findOne({
        where: {
          transaction_ref: transactionRef,
          facility_id: facilityId,
        },
      });
    } catch (summaryError) {
      // Journal entry summary table may not exist or have issues
      console.warn("Could not fetch journal entry summary:", summaryError.message);
      summary = null;
    }

    const lines = await db.GeneralLedger.findAll({
      where: {
        transaction_ref: transactionRef,
        facility_id: facilityId,
      },
      order: [["transaction_id", "ASC"]],
    });

    if (lines.length === 0 && !summary) {
      throw new Error("Journal entry not found");
    }

    // Use summary data if available, otherwise calculate from lines
    let totalDebit = 0;
    let totalCredit = 0;
    let status = "draft";
    let reference_number = "";
    let entry_date = "";
    let description = "";
    let created_by = null;
    let updated_by = null;
    let created_at = null;
    let updated_at = null;

    if (summary) {
      totalDebit = parseFloat(summary.total_debit) || 0;
      totalCredit = parseFloat(summary.total_credit) || 0;
      status = summary.status;
      reference_number = summary.reference_number;
      entry_date = summary.entry_date;
      description = summary.description;
      created_by = summary.created_by;
      updated_by = summary.updated_by;
      created_at = summary.created_at;
      updated_at = summary.updated_at;
    } else {
      // Fallback to calculating from lines
      lines.forEach((line) => {
        totalDebit += parseFloat(line.dr) || 0;
        totalCredit += parseFloat(line.cr) || 0;
      });
      if (lines.length > 0) {
        reference_number = lines[0].reference_number;
        entry_date = lines[0].transaction_date;
        description = lines[0].purpose_of_payment;
        status = lines[0].status;
        created_by = lines[0].created_by;
        updated_by = lines[0].updated_by;
        created_at = lines[0].created_at;
        updated_at = lines[0].updated_at;
      }
    }

    const createdByName = await this.resolveUserDisplayName(created_by, facilityId);
    const updatedByName = await this.resolveUserDisplayName(updated_by, facilityId);

    // Format as journal entry
    return {
      transaction_ref: transactionRef,
      reference_number: reference_number,
      entry_date: entry_date,
      description: description,
      status: status === "saved" ? "draft" : status,
      total_debit: totalDebit.toFixed(2),
      total_credit: totalCredit.toFixed(2),
      facility_id: facilityId,
      created_by: createdByName || created_by,
      updated_by: updatedByName || updated_by,
      created_at: created_at,
      updated_at: updated_at,
      lines: lines.map((line, index) => ({
        id: line.transaction_id,
        line_number: index + 1,
        account_code: line.account_code,
        account_name: line.account_subhead,
        line_date: line.transaction_date,
        line_description: line.transaction_description,
        description: line.transaction_description, // backward compatibility
        debit: parseFloat(line.dr).toFixed(2),
        credit: parseFloat(line.cr).toFixed(2),
        number_id: line.number_id || null,
      })),
    };
  }

  /**
   * Get list of journal entries with filters
   */
  static async getJournalEntries(facilityId, filters = {}) {
    const {
      status,
      startDate,
      endDate,
      accountCode,
      referenceNumber,
      page = 1,
      limit = 50,
      sortBy = "transaction_date",
      sortOrder = "DESC",
    } = filters;

    const whereClause = {
      facility_id: facilityId,
      // Support legacy rows (inventory) and current rows (journal_entry).
      type: { [Op.in]: ["journal_entry", "inventory"] },
      [Op.or]: [
        { reference_number: { [Op.like]: "JE%" } }, // Journal entries (flexible - with or without dash)
        { reference_number: { [Op.like]: "REV%" } }, // Reversal entries
      ],
    };

    // Add search filter if provided
    if (referenceNumber) {
      whereClause.reference_number = {
        [Op.like]: `%${referenceNumber}%`,
      };
      delete whereClause[Op.or]; // Remove OR condition when searching
    }

    // Apply filters
    if (status) {
      whereClause.status = status === "draft" ? "saved" : status;
    }

    if (startDate || endDate) {
      whereClause.transaction_date = {};
      // Use full-day boundaries so DATETIME rows on endDate are included.
      if (startDate) whereClause.transaction_date[Op.gte] = `${startDate} 00:00:00`;
      if (endDate) whereClause.transaction_date[Op.lte] = `${endDate} 23:59:59`;
    }

    if (accountCode) {
      whereClause.account_code = accountCode;
    }

    console.log("Fetching journal entries with whereClause:", whereClause);

    // Get unique transaction refs
    const entries = await db.GeneralLedger.findAll({
      attributes: [
        "transaction_ref",
        "reference_number",
        "transaction_date",
        "purpose_of_payment",
        "status",
        "created_by",
        "created_at",
        [db.sequelize.fn("SUM", db.sequelize.col("dr")), "total_debit"],
        [db.sequelize.fn("SUM", db.sequelize.col("cr")), "total_credit"],
      ],
      where: whereClause,
      group: [
        "transaction_ref",
        "reference_number",
        "transaction_date",
        "purpose_of_payment",
        "status",
        "created_by",
        "created_at",
      ],
      order: [
        [sortBy === "entry_date" ? "transaction_date" : sortBy, sortOrder],
      ],
      limit: parseInt(limit),
      offset: (page - 1) * limit,
      raw: true,
    });

    console.log(`Found ${entries.length} journal entries`);

    // Get count for pagination
    const countResult = await db.GeneralLedger.findAll({
      attributes: ["transaction_ref"],
      where: whereClause,
      group: ["transaction_ref"],
      raw: true,
    });

    const total = countResult.length;
    console.log(`Total unique journal entries: ${total}`);

    const mappedEntries = await Promise.all(
      entries.map(async (entry) => ({
        transaction_ref: entry.transaction_ref,
        reference_number: entry.reference_number,
        entry_date: entry.transaction_date,
        description: entry.purpose_of_payment,
        status: entry.status === "saved" ? "draft" : entry.status,
        total_debit: parseFloat(entry.total_debit || 0).toFixed(2),
        total_credit: parseFloat(entry.total_credit || 0).toFixed(2),
        created_by:
          (await this.resolveUserDisplayName(entry.created_by, facilityId)) ||
          entry.created_by,
        created_at: entry.created_at,
      }))
    );

    console.log("Returning journal entries:", mappedEntries);

    return {
      entries: mappedEntries,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(total / limit),
      },
    };
  }
}

module.exports = JournalEntryService;
