const db = require("../models");
const { Op } = require("sequelize");
const {
  validateJournalEntry,
  calculateBaseAmounts,
  JournalValidationError,
} = require("../utils/journalValidation");
const {
  ensureDraftTables,
  mapDraftToApi,
} = require("./journalDraftStore");

/**
 * Service layer for Journal Entry business logic.
 * Pending journals are stored in aa_journal_drafts / aa_journal_draft_lines.
 * General ledger rows are created ONLY on approval.
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
   * Create AR/AP side entries — only called when approving into the ledger.
   */
  static async createPartyEntries(linesWithBaseAmounts, data, transactionRef, facilityId, userId, transaction) {
    for (const line of linesWithBaseAmounts) {
      if (!line.account_code || !line.number_id) continue;

      const accountCheck = await this.isARorAPAccount(
        line.account_code,
        facilityId
      );

      const supplierCustomerType = (
        line.supplier_customer_type ||
        line.type ||
        ""
      ).toLowerCase();

      const amount = parseFloat(line.debit) || parseFloat(line.credit) || 0;
      if (amount <= 0) continue;

      if (accountCheck.isAR && supplierCustomerType === "customer") {
        const customer = await db.Customer.findOne({
          where: {
            customerNo: line.number_id.toString(),
            facilityId: facilityId.toString(),
          },
          transaction,
        });
        if (!customer) continue;

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

      if (accountCheck.isAP && supplierCustomerType === "supplier") {
        const supplier = await db.SuppliersInfo.findOne({
          where: {
            supplier_number: line.number_id.toString(),
            facilityId: facilityId.toString(),
          },
          transaction,
        });
        if (!supplier) continue;

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
  }

  /**
   * Create a pending journal (draft tables only — no general_ledger yet).
   */
  static async createJournalEntry(data, facilityId, userId) {
    await ensureDraftTables();
    const transaction = await db.sequelize.transaction();
    const notes = data.notes || data.description || "Journal Entry";
    try {
      if (!data.reference_number) {
        throw new Error(
          "Reference number is required. Please use the number generator."
        );
      }

      const validation = await validateJournalEntry(data, facilityId, userId);
      if (!validation.valid) {
        throw new JournalValidationError(
          "Validation failed",
          validation.errors
        );
      }

      const linesWithBaseAmounts = calculateBaseAmounts(
        data.lines,
        data.currency || "NGN"
      );
      const transactionRef = this.generateTransactionRef();

      let totalDebit = 0;
      let totalCredit = 0;
      linesWithBaseAmounts.forEach((line) => {
        totalDebit += parseFloat(line.debit) || 0;
        totalCredit += parseFloat(line.credit) || 0;
      });

      await db.JournalDraft.create(
        {
          transaction_ref: transactionRef,
          reference_number: data.reference_number,
          entry_date: data.entry_date,
          currency: data.currency || "NGN",
          exchange_rate: data.exchange_rate || 1,
          description: data.description || notes,
          notes,
          total_debit: totalDebit,
          total_credit: totalCredit,
          status: "draft",
          facility_id: String(facilityId),
          created_by: String(userId),
        },
        { transaction }
      );

      const draftLines = linesWithBaseAmounts.map((line, index) => ({
        transaction_ref: transactionRef,
        facility_id: String(facilityId),
        line_number: index + 1,
        account_code: line.account_code,
        account_name: line.account_name || "",
        line_date: line.line_date || data.entry_date,
        line_description:
          line.line_description || line.description || data.description || "",
        debit: line.debit || 0,
        credit: line.credit || 0,
        number_id: line.number_id || null,
        supplier_customer_id: line.supplier_customer_id || line.number_id || null,
        supplier_customer_name: line.supplier_customer_name || "",
        supplier_customer_type: line.supplier_customer_type || line.type || "",
      }));

      await db.JournalDraftLine.bulkCreate(draftLines, { transaction });
      await transaction.commit();

      const createdByName = await this.resolveUserDisplayName(
        userId,
        facilityId
      );
      return mapDraftToApi(
        {
          transaction_ref: transactionRef,
          reference_number: data.reference_number,
          entry_date: data.entry_date,
          currency: data.currency || "NGN",
          exchange_rate: data.exchange_rate || 1,
          description: data.description || notes,
          notes,
          total_debit: totalDebit,
          total_credit: totalCredit,
          status: "draft",
          facility_id: String(facilityId),
          created_by: String(userId),
          created_at: new Date(),
          updated_at: new Date(),
        },
        draftLines,
        createdByName
      );
    } catch (error) {
      if (transaction && !transaction.finished) {
        await transaction.rollback();
      }
      throw error;
    }
  }

  /**
   * Update a pending journal (draft tables only).
   */
  static async updateJournalEntry(transactionRef, data, facilityId, userId) {
    await ensureDraftTables();
    const transaction = await db.sequelize.transaction();
    try {
      const draft = await db.JournalDraft.findOne({
        where: {
          transaction_ref: transactionRef,
          facility_id: String(facilityId),
        },
        transaction,
      });

      if (!draft) {
        // Legacy: draft was wrongly saved into GL as status=saved
        const existingLines = await db.GeneralLedger.findAll({
          where: {
            transaction_ref: transactionRef,
            facility_id: facilityId,
            type: { [Op.in]: ["journal_entry", "inventory"] },
          },
          transaction,
        });
        if (existingLines.length === 0) {
          throw new Error("Journal entry not found");
        }
        if (existingLines[0].status === "posted") {
          throw new Error("Posted journal entries cannot be modified");
        }
        if (existingLines[0].status === "reversed") {
          throw new Error("Reversed journal entries cannot be modified");
        }
        // Move legacy GL draft into draft tables, then continue as normal update
        await db.GeneralLedger.destroy({
          where: { transaction_ref: transactionRef, facility_id: facilityId },
          transaction,
        });
      } else if (draft.status !== "draft") {
        throw new Error("Only pending journal entries can be modified");
      }

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

      const linesWithBaseAmounts = calculateBaseAmounts(
        data.lines,
        data.currency || "NGN"
      );
      const notes = data.notes || data.description || "Journal Entry";

      let totalDebit = 0;
      let totalCredit = 0;
      linesWithBaseAmounts.forEach((line) => {
        totalDebit += parseFloat(line.debit) || 0;
        totalCredit += parseFloat(line.credit) || 0;
      });

      if (draft) {
        await draft.update(
          {
            reference_number: data.reference_number,
            entry_date: data.entry_date,
            currency: data.currency || "NGN",
            exchange_rate: data.exchange_rate || 1,
            description: data.description || notes,
            notes,
            total_debit: totalDebit,
            total_credit: totalCredit,
            updated_by: String(userId),
          },
          { transaction }
        );
      } else {
        await db.JournalDraft.create(
          {
            transaction_ref: transactionRef,
            reference_number: data.reference_number,
            entry_date: data.entry_date,
            currency: data.currency || "NGN",
            exchange_rate: data.exchange_rate || 1,
            description: data.description || notes,
            notes,
            total_debit: totalDebit,
            total_credit: totalCredit,
            status: "draft",
            facility_id: String(facilityId),
            created_by: String(userId),
            updated_by: String(userId),
          },
          { transaction }
        );
      }

      await db.JournalDraftLine.destroy({
        where: {
          transaction_ref: transactionRef,
          facility_id: String(facilityId),
        },
        transaction,
      });

      const draftLines = linesWithBaseAmounts.map((line, index) => ({
        transaction_ref: transactionRef,
        facility_id: String(facilityId),
        line_number: index + 1,
        account_code: line.account_code,
        account_name: line.account_name || "",
        line_date: line.line_date || data.entry_date,
        line_description:
          line.line_description || line.description || data.description || "",
        debit: line.debit || 0,
        credit: line.credit || 0,
        number_id: line.number_id || null,
        supplier_customer_id: line.supplier_customer_id || line.number_id || null,
        supplier_customer_name: line.supplier_customer_name || "",
        supplier_customer_type: line.supplier_customer_type || line.type || "",
      }));
      await db.JournalDraftLine.bulkCreate(draftLines, { transaction });
      await transaction.commit();

      return await this.getJournalEntryByRef(transactionRef, facilityId);
    } catch (error) {
      if (transaction && !transaction.finished) {
        await transaction.rollback();
      }
      throw error;
    }
  }

  /**
   * Approve pending journal → write general_ledger (posted) + party entries.
   */
  static async postJournalEntry(transactionRef, facilityId, userId) {
    await ensureDraftTables();
    const transaction = await db.sequelize.transaction();

    try {
      const draft = await db.JournalDraft.findOne({
        where: {
          transaction_ref: transactionRef,
          facility_id: String(facilityId),
        },
        transaction,
      });

      if (draft) {
        if (draft.status !== "draft") {
          throw new Error("Only pending (draft) entries can be approved");
        }

        const draftLines = await db.JournalDraftLine.findAll({
          where: {
            transaction_ref: transactionRef,
            facility_id: String(facilityId),
          },
          order: [["line_number", "ASC"]],
          transaction,
        });

        if (!draftLines.length) {
          throw new Error("Journal entry has no lines");
        }

        const notes = draft.notes || draft.description || "Journal Entry";
        const ledgerEntries = draftLines.map((line) => ({
          transaction_date: line.line_date || draft.entry_date,
          account_code: line.account_code,
          account_subhead: line.account_name || "",
          dr: line.debit || 0,
          cr: line.credit || 0,
          transaction_description:
            line.line_description || line.account_name || "",
          account_description: line.account_name || "",
          reference_number: draft.reference_number,
          purpose_of_payment: notes,
          created_by: userId,
          updated_by: userId,
          facility_id: facilityId,
          status: "posted",
          type: "journal_entry",
          // Keep one shared ref for the whole journal (do not split by number_id)
          transaction_ref: transactionRef,
        }));

        await db.GeneralLedger.bulkCreate(ledgerEntries, { transaction });

        const linesForParty = draftLines.map((line) => ({
          account_code: line.account_code,
          account_name: line.account_name,
          debit: parseFloat(line.debit || 0),
          credit: parseFloat(line.credit || 0),
          number_id: line.number_id,
          supplier_customer_type: line.supplier_customer_type,
          type: line.supplier_customer_type,
        }));

        await this.createPartyEntries(
          linesForParty,
          {
            reference_number: draft.reference_number,
            notes: draft.notes,
            description: draft.description,
          },
          transactionRef,
          facilityId,
          userId,
          transaction
        );

        await draft.update(
          {
            status: "approved",
            approved_by: String(userId),
            approved_at: new Date(),
            updated_by: String(userId),
          },
          { transaction }
        );

        await transaction.commit();
        return await this.getJournalEntryByRef(transactionRef, facilityId);
      }

      // Legacy path: pending rows already sitting in GL as status=saved
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
        throw new Error("Only pending (draft) entries can be approved");
      }

      await db.GeneralLedger.update(
        {
          status: "posted",
          updated_by: userId,
        },
        {
          where: {
            transaction_ref: transactionRef,
            facility_id: facilityId,
          },
          transaction,
        }
      );

      await transaction.commit();
      return await this.getJournalEntryByRef(transactionRef, facilityId);
    } catch (error) {
      if (transaction && !transaction.finished) {
        await transaction.rollback();
      }
      throw error;
    }
  }

  /**
   * Reverse a posted journal entry (GL only)
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
          status: "posted",
        },
      });

      if (originalLines.length === 0) {
        throw new Error("Posted journal entry not found");
      }

      const existingReversal = await db.GeneralLedger.findOne({
        where: {
          purpose_of_payment: {
            [Op.like]: `%Reversal of ${originalLines[0].reference_number}%`,
          },
          facility_id: facilityId,
        },
      });
      if (existingReversal) {
        throw new Error("This journal entry has already been reversed");
      }

      const reversalRef = this.generateTransactionRef();
      const reversalNumber = `REV-${originalLines[0].reference_number}`;
      const date = reversalDate || new Date().toISOString().slice(0, 10);

      const reversalLines = originalLines.map((line) => ({
        transaction_date: date,
        account_code: line.account_code,
        account_subhead: line.account_subhead,
        dr: line.cr || 0,
        cr: line.dr || 0,
        transaction_description: `Reversal: ${line.transaction_description || ""}`,
        account_description: line.account_description,
        reference_number: reversalNumber,
        purpose_of_payment: `Reversal of ${line.reference_number}`,
        created_by: userId,
        updated_by: userId,
        facility_id: facilityId,
        status: "posted",
        type: "journal_entry",
        transaction_ref: reversalRef,
      }));

      await db.GeneralLedger.bulkCreate(reversalLines, { transaction });

      await db.GeneralLedger.update(
        { status: "reversed", updated_by: userId },
        {
          where: {
            transaction_ref: transactionRef,
            facility_id: facilityId,
          },
          transaction,
        }
      );

      await transaction.commit();
      return await this.getJournalEntryByRef(reversalRef, facilityId);
    } catch (error) {
      if (transaction && !transaction.finished) {
        await transaction.rollback();
      }
      throw error;
    }
  }

  /**
   * Delete a pending journal (draft only)
   */
  static async deleteJournalEntry(transactionRef, facilityId) {
    await ensureDraftTables();
    const transaction = await db.sequelize.transaction();

    try {
      const draft = await db.JournalDraft.findOne({
        where: {
          transaction_ref: transactionRef,
          facility_id: String(facilityId),
        },
        transaction,
      });

      if (draft) {
        if (draft.status !== "draft") {
          throw new Error("Only pending journal entries can be deleted");
        }
        await db.JournalDraftLine.destroy({
          where: {
            transaction_ref: transactionRef,
            facility_id: String(facilityId),
          },
          transaction,
        });
        await draft.destroy({ transaction });
        await transaction.commit();
        return { message: "Journal entry deleted successfully" };
      }

      // Legacy GL saved drafts
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

      await db.GeneralLedger.destroy({
        where: { transaction_ref: transactionRef, facility_id: facilityId },
        transaction,
      });
      await db.CustomerEntry.destroy({
        where: { link_id: transactionRef },
        transaction,
      }).catch(() => {});
      await db.SupplierEntry.destroy({
        where: { link_id: transactionRef },
        transaction,
      }).catch(() => {});

      await transaction.commit();
      return { message: "Journal entry deleted successfully" };
    } catch (error) {
      if (transaction && !transaction.finished) {
        await transaction.rollback();
      }
      throw error;
    }
  }

  /**
   * Get journal entry by transaction reference (draft or posted GL)
   */
  static async getJournalEntryByRef(transactionRef, facilityId) {
    await ensureDraftTables();

    const draft = await db.JournalDraft.findOne({
      where: {
        transaction_ref: transactionRef,
        facility_id: String(facilityId),
      },
    });

    if (draft && draft.status === "draft") {
      const lines = await db.JournalDraftLine.findAll({
        where: {
          transaction_ref: transactionRef,
          facility_id: String(facilityId),
        },
        order: [["line_number", "ASC"]],
      });
      const createdByName = await this.resolveUserDisplayName(
        draft.created_by,
        facilityId
      );
      return mapDraftToApi(draft, lines, createdByName);
    }

    // Approved draft or pure GL entry
    const lines = await db.GeneralLedger.findAll({
      where: {
        transaction_ref: transactionRef,
        facility_id: facilityId,
      },
      order: [["transaction_id", "ASC"]],
    });

    if (lines.length === 0) {
      if (draft) {
        const draftLines = await db.JournalDraftLine.findAll({
          where: {
            transaction_ref: transactionRef,
            facility_id: String(facilityId),
          },
          order: [["line_number", "ASC"]],
        });
        const createdByName = await this.resolveUserDisplayName(
          draft.created_by,
          facilityId
        );
        return mapDraftToApi(draft, draftLines, createdByName);
      }
      throw new Error("Journal entry not found");
    }

    let totalDebit = 0;
    let totalCredit = 0;
    lines.forEach((line) => {
      totalDebit += parseFloat(line.dr || 0);
      totalCredit += parseFloat(line.cr || 0);
    });

    const status =
      lines[0].status === "saved"
        ? "draft"
        : lines[0].status === "posted"
          ? "posted"
          : lines[0].status;

    const createdByName = await this.resolveUserDisplayName(
      lines[0].created_by,
      facilityId
    );
    const updatedByName = lines[0].updated_by
      ? await this.resolveUserDisplayName(lines[0].updated_by, facilityId)
      : null;

    return {
      transaction_ref: transactionRef,
      reference_number: lines[0].reference_number,
      entry_date: lines[0].transaction_date,
      description: lines[0].purpose_of_payment,
      notes: lines[0].purpose_of_payment,
      status,
      total_debit: totalDebit.toFixed(2),
      total_credit: totalCredit.toFixed(2),
      facility_id: facilityId,
      created_by: createdByName || lines[0].created_by,
      updated_by: updatedByName || lines[0].updated_by,
      created_at: lines[0].created_at,
      updated_at: lines[0].updated_at,
      currency: "NGN",
      lines: lines.map((line, index) => ({
        id: line.transaction_id,
        line_number: index + 1,
        account_code: line.account_code,
        account_name: line.account_subhead,
        line_date: line.transaction_date,
        line_description: line.transaction_description,
        description: line.transaction_description,
        debit: parseFloat(line.dr).toFixed(2),
        credit: parseFloat(line.cr).toFixed(2),
        number_id: line.number_id || null,
      })),
    };
  }

  /**
   * List journals: pending drafts + posted/reversed from GL
   */
  static async getJournalEntries(facilityId, filters = {}) {
    await ensureDraftTables();
    const {
      status,
      startDate,
      endDate,
      referenceNumber,
      page = 1,
      limit = 50,
      sortOrder = "DESC",
    } = filters;

    const wantDraft =
      !status || status === "draft" || status === "saved" || status === "pending";
    const wantPosted =
      !status || status === "posted" || status === "approved";
    const wantReversed = !status || status === "reversed";

    const mapped = [];

    if (wantDraft) {
      const draftWhere = {
        facility_id: String(facilityId),
        status: "draft",
      };
      if (startDate || endDate) {
        draftWhere.entry_date = {};
        if (startDate) draftWhere.entry_date[Op.gte] = startDate;
        if (endDate) draftWhere.entry_date[Op.lte] = endDate;
      }
      if (referenceNumber) {
        draftWhere.reference_number = { [Op.like]: `%${referenceNumber}%` };
      }

      const drafts = await db.JournalDraft.findAll({
        where: draftWhere,
        order: [["entry_date", sortOrder]],
        raw: true,
      });

      for (const d of drafts) {
        mapped.push({
          transaction_ref: d.transaction_ref,
          reference_number: d.reference_number,
          entry_date: d.entry_date,
          description: d.notes || d.description,
          status: "draft",
          total_debit: parseFloat(d.total_debit || 0).toFixed(2),
          total_credit: parseFloat(d.total_credit || 0).toFixed(2),
          created_by:
            (await this.resolveUserDisplayName(d.created_by, facilityId)) ||
            d.created_by,
          created_at: d.created_at,
        });
      }

      // Legacy pending still in GL as saved
      const legacyWhere = {
        facility_id: facilityId,
        type: { [Op.in]: ["journal_entry", "inventory"] },
        status: "saved",
        [Op.or]: [
          { reference_number: { [Op.like]: "JE%" } },
          { reference_number: { [Op.like]: "REV%" } },
        ],
      };
      if (referenceNumber) {
        legacyWhere.reference_number = { [Op.like]: `%${referenceNumber}%` };
        delete legacyWhere[Op.or];
      }
      if (startDate || endDate) {
        legacyWhere.transaction_date = {};
        if (startDate)
          legacyWhere.transaction_date[Op.gte] = `${startDate} 00:00:00`;
        if (endDate)
          legacyWhere.transaction_date[Op.lte] = `${endDate} 23:59:59`;
      }

      const legacy = await db.GeneralLedger.findAll({
        attributes: [
          "transaction_ref",
          "reference_number",
          "status",
          [
            db.sequelize.fn("MIN", db.sequelize.col("transaction_date")),
            "transaction_date",
          ],
          [
            db.sequelize.fn("MAX", db.sequelize.col("purpose_of_payment")),
            "purpose_of_payment",
          ],
          [
            db.sequelize.fn("MIN", db.sequelize.col("created_by")),
            "created_by",
          ],
          [
            db.sequelize.fn("MIN", db.sequelize.col("created_at")),
            "created_at",
          ],
          [db.sequelize.fn("SUM", db.sequelize.col("dr")), "total_debit"],
          [db.sequelize.fn("SUM", db.sequelize.col("cr")), "total_credit"],
        ],
        where: legacyWhere,
        group: ["transaction_ref", "reference_number", "status"],
        raw: true,
      });

      const draftRefs = new Set(mapped.map((m) => m.transaction_ref));
      for (const entry of legacy) {
        if (draftRefs.has(entry.transaction_ref)) continue;
        mapped.push({
          transaction_ref: entry.transaction_ref,
          reference_number: entry.reference_number,
          entry_date: entry.transaction_date,
          description: entry.purpose_of_payment,
          status: "draft",
          total_debit: parseFloat(entry.total_debit || 0).toFixed(2),
          total_credit: parseFloat(entry.total_credit || 0).toFixed(2),
          created_by:
            (await this.resolveUserDisplayName(
              entry.created_by,
              facilityId
            )) || entry.created_by,
          created_at: entry.created_at,
        });
      }
    }

    if (wantPosted || wantReversed) {
      const statuses = [];
      if (wantPosted) statuses.push("posted");
      if (wantReversed) statuses.push("reversed");

      const glWhere = {
        facility_id: facilityId,
        type: { [Op.in]: ["journal_entry", "inventory"] },
        status: { [Op.in]: statuses },
        [Op.or]: [
          { reference_number: { [Op.like]: "JE%" } },
          { reference_number: { [Op.like]: "REV%" } },
        ],
      };
      if (referenceNumber) {
        glWhere.reference_number = { [Op.like]: `%${referenceNumber}%` };
        delete glWhere[Op.or];
      }
      if (startDate || endDate) {
        glWhere.transaction_date = {};
        if (startDate) glWhere.transaction_date[Op.gte] = `${startDate} 00:00:00`;
        if (endDate) glWhere.transaction_date[Op.lte] = `${endDate} 23:59:59`;
      }

      const entries = await db.GeneralLedger.findAll({
        attributes: [
          "transaction_ref",
          "reference_number",
          "status",
          [
            db.sequelize.fn("MIN", db.sequelize.col("transaction_date")),
            "transaction_date",
          ],
          [
            db.sequelize.fn("MAX", db.sequelize.col("purpose_of_payment")),
            "purpose_of_payment",
          ],
          [
            db.sequelize.fn("MIN", db.sequelize.col("created_by")),
            "created_by",
          ],
          [
            db.sequelize.fn("MIN", db.sequelize.col("created_at")),
            "created_at",
          ],
          [db.sequelize.fn("SUM", db.sequelize.col("dr")), "total_debit"],
          [db.sequelize.fn("SUM", db.sequelize.col("cr")), "total_credit"],
        ],
        where: glWhere,
        group: ["transaction_ref", "reference_number", "status"],
        raw: true,
      });

      for (const entry of entries) {
        mapped.push({
          transaction_ref: entry.transaction_ref,
          reference_number: entry.reference_number,
          entry_date: entry.transaction_date,
          description: entry.purpose_of_payment,
          status: entry.status,
          total_debit: parseFloat(entry.total_debit || 0).toFixed(2),
          total_credit: parseFloat(entry.total_credit || 0).toFixed(2),
          created_by:
            (await this.resolveUserDisplayName(
              entry.created_by,
              facilityId
            )) || entry.created_by,
          created_at: entry.created_at,
        });
      }
    }

    mapped.sort((a, b) => {
      const da = new Date(a.entry_date).getTime();
      const db_ = new Date(b.entry_date).getTime();
      return sortOrder === "ASC" ? da - db_ : db_ - da;
    });

    const total = mapped.length;
    const pageNum = parseInt(page, 10) || 1;
    const limitNum = parseInt(limit, 10) || 50;
    const start = (pageNum - 1) * limitNum;
    const pageRows = mapped.slice(start, start + limitNum);

    return {
      entries: pageRows,
      pagination: {
        total,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(total / limitNum) || 1,
      },
    };
  }

}

module.exports = JournalEntryService;
