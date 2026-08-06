const db = require("../models");
const moment = require("moment");
const { Op } = require("sequelize");
const { getAndUpdateNumber } = require("../services/numberGen");
const {
  buildAddressLine,
  syncSupplierContacts,
  syncSupplierAddresses,
} = require("./supplierNormalize");
const {
  recordActivity,
  pickActor,
} = require("../services/activityAuditService");
// const { getAndUpdateNumber } = require("../services/numberGen");

exports.createSupplier = async (req, res) => {
  const transaction = await db.sequelize.transaction();

  try {
    const {
      name,
      email,
      phone,
      address,
      tin,
      facilityId,
      payable_code,
      advance_code,
      opening_balance_equity,
      opening_balance = 0,
      obdate,
      created_by,
      branch_id = null,
      company_name,
      salutation,
      first_name,
      last_name,
      mobile,
      language,
      currency,
      payment_terms,
      remarks,
      billing_address,
      shipping_address,
      contact_persons = [],
    } = req.body;

    const userId = created_by || req.user?.id || null;
    const fullname = name;
    const parsedBranchId =
      branch_id == null || branch_id === "" || branch_id === "all"
        ? null
        : parseInt(branch_id, 10) || null;

    if (!fullname || !facilityId || !payable_code || !opening_balance_equity) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: "fullname, facilityId and payable_code are required",
      });
    }

    // ====================================================
    // CREATE SUPPLIER
    // ====================================================
    const code = await getAndUpdateNumber("sup", facilityId);
    const supplierNo = `SUP-${String(code).padStart(3, "0")}`;

    const billing = billing_address || null;
    const shipping = shipping_address || null;
    const addressLine =
      address || (billing ? buildAddressLine(billing) : null) || null;

    const supplier = await db.SuppliersInfo.create(
      {
        facilityId,
        supplier_number: supplierNo,
        supplier_name: fullname,
        company_name: company_name || fullname || null,
        salutation: salutation || null,
        first_name: first_name || null,
        last_name: last_name || null,
        address: addressLine,
        phone: phone || null,
        mobile: mobile || null,
        email: email || null,
        tin: tin || null,
        language: language || "English",
        currency: currency || "NGN - Nigerian Naira",
        payment_terms: payment_terms || "Due on Receipt",
        remarks: remarks || null,
        status: "active",
        balance: opening_balance,
        payable_code: payable_code || null,
        payable_accural_code: advance_code || null,
        branch_id: parsedBranchId,
        date: moment().format("YYYY-MM-DD"),
      },
      { transaction },
    );

    await syncSupplierContacts(
      db,
      {
        facilityId,
        supplier_number: supplierNo,
        primary: {
          salutation,
          first_name,
          last_name,
          email,
          work_phone: phone,
          mobile,
        },
        contactPersons: contact_persons,
      },
      transaction,
    );

    await syncSupplierAddresses(
      db,
      {
        facilityId,
        supplier_number: supplierNo,
        billing,
        shipping,
      },
      transaction,
    );

    // ====================================================
    // OPENING BALANCE LOGIC FOR SUPPLIER
    // ====================================================
    const OB = Number(opening_balance);

    if (OB !== 0) {
      const ap = await db.AccountCategory.findOne({
        where: { code: payable_code, facility_id: facilityId },
        transaction,
      });

      const obe = await db.AccountCategory.findOne({
        where: { code: opening_balance_equity, facility_id: facilityId },
        transaction,
      });

      const advance = await db.AccountCategory.findOne({
        where: { code: advance_code, facility_id: facilityId },
        transaction,
      });

      if (!ap || !obe || !advance) {
        await transaction.rollback();
        return res.status(404).json({
          success: false,
          message:
            "One or more required accounts not found (Payable, Equity, or Advance)",
        });
      }

      const billRef = `OB-${await getAndUpdateNumber("OB", facilityId)}`;

      // -------------------------------------------------
      // CASE 1: POSITIVE OB → YOU OWE SUPPLIER (A/P)
      // -------------------------------------------------
      if (OB > 0) {
        // Ledger → Credit A/P
        await db.GeneralLedger.create(
          {
            transaction_date: obdate || new Date(),
            account_code: ap.code,
            account_subhead: ap.parent_code || 0,
            account_description: ap.description,
            dr: 0,
            cr: OB,
            transaction_description:
              `opening balance for ${fullname}` || ap.description,
            purpose_of_payment: "opening_balance",
            reference_number: billRef,
            mode_of_payment: "opening_balance",
            created_by: userId,
            facility_id: facilityId,
            type: "payable",
            transaction_ref: supplierNo,
          },
          { transaction },
        );

        // Ledger → Debit Opening Balance Equity
        await db.GeneralLedger.create(
          {
            transaction_date: obdate || new Date(),
            account_code: obe.code,
            account_subhead: obe.parent_code || 0,
            account_description: obe.description,
            dr: OB,
            cr: 0,
            transaction_description:
              `opening balance for ${fullname}` || obe.description,
            purpose_of_payment: "opening_balance",
            reference_number: billRef,
            mode_of_payment: "opening_balance",
            created_by: userId,
            facility_id: facilityId,
            type: "opening_balance",
            transaction_ref: "",
          },
          { transaction },
        );

        // -------------------------------------------------
        // CREATE PURCHASE BILL (ONLY FOR OB > 0)
        // -------------------------------------------------
        await db.Invoice.create(
          {
            ref_number: supplierNo,
            invoice_ref: billRef,
            description: "Opening Balance",
            transaction_date: obdate || new Date(),
            due_date: obdate || new Date(),
            amount: OB,
            created_by: userId,
            discount_amount: 0,
            tax_amount: 0,
            facility_id: facilityId,
            type: "purchase",
          },
          { transaction },
        );

        // Supplier ledger → qty_in means payable
        await db.SupplierEntry.create(
          {
            supplier_number: supplierNo,
            description: "Opening Balance (Payable)",
            qty_in: 1,
            qty_out: 0,
            cost: OB,
            facilityId,
            mode_of_payment: "opening_balance",
            receiptNo: billRef,
            link_id: supplierNo,
            created_by: userId,
            type: "opening_balance",
          },
          { transaction },
        );
      }
      if (OB < 0) {
        const amount = Math.abs(OB);

        // Debit Advance to Supplier (asset)
        await db.GeneralLedger.create(
          {
            transaction_date: obdate || new Date(),
            account_code: advance.code,
            account_subhead: advance.parent_code || 0,
            account_description: advance.description,
            dr: amount,
            cr: 0,
            transaction_description:
              `opening balance for ${fullname}` || advance.description,
            purpose_of_payment: "opening_balance",
            reference_number: billRef,
            mode_of_payment: "opening_balance",
            created_by: userId,
            facility_id: facilityId,
            type: "payable",
            transaction_ref: supplierNo,
          },
          { transaction },
        );

        // Credit Opening Balance Equity
        await db.GeneralLedger.create(
          {
            transaction_date: obdate || new Date(),
            account_code: obe.code,
            account_subhead: obe.parent_code || 0,
            account_description: obe.description,
            dr: 0,
            cr: amount,
            transaction_description:
              `opening balance for ${fullname}` || obe.description,
            purpose_of_payment: "opening_balance",
            reference_number: billRef,
            mode_of_payment: "opening_balance",
            created_by: userId,
            facility_id: facilityId,
            type: "opening_balance",
            transaction_ref: "",
          },
          { transaction },
        );

        // Supplier entry → qty_out represents advance
        // Include receiptNo to satisfy NOT NULL constraint on that column
        await db.SupplierEntry.create(
          {
            supplier_number: supplierNo,
            description: "Opening Balance (Advance)",
            qty_in: 0,
            qty_out: 1,
            cost: amount,
            facilityId,
            mode_of_payment: "opening_balance",
            type: "opening_balance",
            receiptNo: billRef,
            link_id: billRef,
            created_by: userId,
          },
          { transaction },
        );
      }
    }

    await transaction.commit();

    await recordActivity({
      facilityId,
      userId: pickActor(req) || userId,
      action: "create",
      entityType: "supplier",
      entityId: supplierNo,
      entityLabel: supplier.supplier_name || name,
      after: {
        supplier_number: supplierNo,
        supplier_name: supplier.supplier_name,
        status: supplier.status,
      },
      remark: "Supplier created",
    });

    return res.status(201).json({
      success: true,
      message: "Supplier created successfully",
      data: {
        supplier_number: supplierNo,
        ...supplier.toJSON(),
      },
      supplier,
    });
  } catch (error) {
    await transaction.rollback();
    console.error("CreateSupplier error:", error);
    return res.status(500).json({
      success: false,
      message: "Error creating/updating supplier",
      error: error.message,
    });
  }
};

/**
 * Get all suppliers for a facility
 */
exports.getAllSuppliers = async (req, res) => {
  try {
    const { facilityId, status, search, page = 1, limit = 50 } = req.query;

    if (!facilityId) {
      return res.status(400).json({
        success: false,
        message: "facilityId is required",
      });
    }

    const offset = (page - 1) * limit;
    const whereClause = { facilityId };

    // Add status filter if provided
    if (status) {
      whereClause.status = status;
    }

    // Add search filter if provided
    if (search) {
      whereClause[Op.or] = [
        { supplier_name: { [Op.like]: `%${search}%` } },
        { supplier_number: { [Op.like]: `%${search}%` } },
        { phone: { [Op.like]: `%${search}%` } },
        { email: { [Op.like]: `%${search}%` } },
      ];
    }

    const { count, rows: suppliers } = await db.SuppliersInfo.findAndCountAll({
      where: whereClause,
      limit: parseInt(limit),
      offset: parseInt(offset),
      order: [["date", "DESC"]],
      // Remove include for now - can add back later if needed
      // include: [
      //   {
      //     model: db.Business,
      //     as: "facility",
      //     attributes: ["business_name", "id"],
      //   },
      // ],
    });

    res.json({
      success: true,
      message: "Suppliers retrieved successfully",
      data: {
        suppliers,
        pagination: {
          total: count,
          page: parseInt(page),
          limit: parseInt(limit),
          totalPages: Math.ceil(count / limit),
        },
      },
    });
  } catch (error) {
    console.error("Get Suppliers Error:", error);
    res.status(500).json({
      success: false,
      message: "Error retrieving suppliers",
      error: error.message,
    });
  }
};

/**
 * Get a single supplier by supplier_number and facilityId
 */
exports.getSupplierById = async (req, res) => {
  try {
    const { supplier_number, facilityId } = req.params;

    if (!supplier_number || !facilityId) {
      return res.status(400).json({
        success: false,
        message: "supplier_number and facilityId are required",
      });
    }

    const include = [];
    if (db.SupplierContact) {
      include.push({
        model: db.SupplierContact,
        as: "contacts",
        required: false,
        where: { facility_id: facilityId },
      });
    }
    if (db.SupplierAddress) {
      include.push({
        model: db.SupplierAddress,
        as: "addresses",
        required: false,
        where: { facility_id: facilityId },
      });
    }

    const supplier = await db.SuppliersInfo.findOne({
      where: { supplier_number, facilityId },
      include,
    });

    if (!supplier) {
      return res.status(404).json({
        success: false,
        message: "Supplier not found",
      });
    }

    res.json({
      success: true,
      message: "Supplier retrieved successfully",
      data: supplier,
    });
  } catch (error) {
    console.error("Get Supplier Error:", error);
    res.status(500).json({
      success: false,
      message: "Error retrieving supplier",
      error: error.message,
    });
  }
};

/**
 * Update a supplier
 */
exports.updateSupplier = async (req, res) => {
  const transaction = await db.sequelize.transaction();
  try {
    const { supplier_number, facilityId } = req.params;
    const {
      name,
      email,
      phone,
      address,
      tin,
      payable_code,
      payable_accural_code,
      advance_code,
      branch_id,
      company_name,
      salutation,
      first_name,
      last_name,
      mobile,
      language,
      currency,
      payment_terms,
      remarks,
      billing_address,
      shipping_address,
      contact_persons = [],
    } = req.body;

    if (!supplier_number || !facilityId) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: "supplier_number and facilityId are required",
      });
    }

    // Find the supplier
    const supplier = await db.SuppliersInfo.findOne({
      where: { supplier_number, facilityId },
      transaction,
    });

    if (!supplier) {
      await transaction.rollback();
      return res.status(404).json({
        success: false,
        message: "Supplier not found",
      });
    }

    const beforeSnapshot = {
      supplier_name: supplier.supplier_name,
      email: supplier.email,
      phone: supplier.phone,
      address: supplier.address,
      tin: supplier.tin,
      payable_code: supplier.payable_code,
      payable_accural_code: supplier.payable_accural_code,
      branch_id: supplier.branch_id,
      status: supplier.status,
    };

    const billing = billing_address || null;
    const shipping = shipping_address || null;
    const addressLine =
      address !== undefined
        ? address
        : billing
          ? buildAddressLine(billing)
          : undefined;

    // Update supplier - basic identity/contact + payable mappings + profile
    const updateData = {};
    if (name !== undefined) updateData.supplier_name = name;
    if (company_name !== undefined) updateData.company_name = company_name;
    if (salutation !== undefined) updateData.salutation = salutation || null;
    if (first_name !== undefined) updateData.first_name = first_name || null;
    if (last_name !== undefined) updateData.last_name = last_name || null;
    if (email !== undefined) updateData.email = email || null;
    if (phone !== undefined) updateData.phone = phone;
    if (mobile !== undefined) updateData.mobile = mobile || null;
    if (addressLine !== undefined) updateData.address = addressLine;
    if (tin !== undefined) updateData.tin = tin || null;
    if (language !== undefined) updateData.language = language || null;
    if (currency !== undefined) updateData.currency = currency || null;
    if (payment_terms !== undefined)
      updateData.payment_terms = payment_terms || null;
    if (remarks !== undefined) updateData.remarks = remarks || null;
    if (payable_code !== undefined) updateData.payable_code = payable_code;

    // Support both payable_accural_code and legacy advance_code naming
    const accrualCode = payable_accural_code || advance_code;
    if (accrualCode !== undefined) {
      updateData.payable_accural_code = accrualCode;
    }

    if (branch_id !== undefined) {
      updateData.branch_id =
        branch_id == null || branch_id === "" || branch_id === "all"
          ? null
          : parseInt(branch_id, 10) || null;
    }

    await supplier.update(updateData, { transaction });

    await syncSupplierContacts(
      db,
      {
        facilityId,
        supplier_number,
        primary: {
          salutation: salutation ?? supplier.salutation,
          first_name: first_name ?? supplier.first_name,
          last_name: last_name ?? supplier.last_name,
          email: email ?? supplier.email,
          work_phone: phone ?? supplier.phone,
          mobile: mobile ?? supplier.mobile,
        },
        contactPersons: contact_persons,
      },
      transaction,
    );

    if (billing || shipping) {
      await syncSupplierAddresses(
        db,
        {
          facilityId,
          supplier_number,
          billing,
          shipping,
        },
        transaction,
      );
    }

    await transaction.commit();

    await recordActivity({
      facilityId,
      userId: pickActor(req),
      action: "update",
      entityType: "supplier",
      entityId: supplier_number,
      entityLabel: supplier.supplier_name || name,
      before: beforeSnapshot,
      after: updateData,
      remark: "Supplier updated",
    });

    res.json({
      success: true,
      message: "Supplier updated successfully",
      data: supplier,
    });
  } catch (error) {
    await transaction.rollback();
    console.error("Update Supplier Error:", error);
    res.status(500).json({
      success: false,
      message: "Error updating supplier",
      error: error.message,
    });
  }
};

/**
 * Delete/Deactivate a supplier
 */
exports.deleteSupplier = async (req, res) => {
  try {
    const { supplier_number, facilityId } = req.params;
    const { permanent = false } = req.query;

    if (!supplier_number || !facilityId) {
      return res.status(400).json({
        success: false,
        message: "supplier_number and facilityId are required",
      });
    }

    const supplier = await db.SuppliersInfo.findOne({
      where: { supplier_number, facilityId },
    });

    if (!supplier) {
      return res.status(404).json({
        success: false,
        message: "Supplier not found",
      });
    }

    const before = supplier.get({ plain: true });

    if (permanent === "true") {
      // Permanent delete
      await supplier.destroy();
      await recordActivity({
        facilityId,
        userId: pickActor(req),
        action: "delete",
        entityType: "supplier",
        entityId: supplier_number,
        entityLabel: before.supplier_name,
        before,
        remark: "Supplier permanently deleted",
        meta: { permanent: true },
      });
      res.json({
        success: true,
        message: "Supplier deleted permanently",
      });
    } else {
      // Soft delete - just change status
      await supplier.update({ status: "inactive" });
      await recordActivity({
        facilityId,
        userId: pickActor(req),
        action: "delete",
        entityType: "supplier",
        entityId: supplier_number,
        entityLabel: before.supplier_name,
        before: { status: before.status },
        after: { status: "inactive" },
        remark: "Supplier deactivated",
        meta: { permanent: false },
      });
      res.json({
        success: true,
        message: "Supplier deactivated successfully",
        data: supplier,
      });
    }
  } catch (error) {
    console.error("Delete Supplier Error:", error);
    res.status(500).json({
      success: false,
      message: "Error deleting supplier",
      error: error.message,
    });
  }
};

/**
 * Get supplier statistics
 */
exports.getSupplierStats = async (req, res) => {
  try {
    const { facilityId } = req.query;

    if (!facilityId) {
      return res.status(400).json({
        success: false,
        message: "facilityId is required",
      });
    }

    const [totalSuppliers, activeSuppliers, inactiveSuppliers] =
      await Promise.all([
        db.SuppliersInfo.count({ where: { facilityId } }),
        db.SuppliersInfo.count({ where: { facilityId, status: "active" } }),
        db.SuppliersInfo.count({ where: { facilityId, status: "inactive" } }),
      ]);

    res.json({
      success: true,
      message: "Supplier statistics retrieved successfully",
      data: {
        total: totalSuppliers,
        active: activeSuppliers,
        inactive: inactiveSuppliers,
      },
    });
  } catch (error) {
    console.error("Get Supplier Stats Error:", error);
    res.status(500).json({
      success: false,
      message: "Error retrieving supplier statistics",
      error: error.message,
    });
  }
};

/**
 * Bulk create suppliers
 */
exports.bulkCreateSuppliers = async (req, res) => {
  const transaction = await db.sequelize.transaction();

  try {
    const { suppliers, facilityId } = req.body;

    if (!Array.isArray(suppliers) || suppliers.length === 0) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: "No supplier data provided",
      });
    }

    if (!facilityId) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: "facilityId is required",
      });
    }

    const createdSuppliers = [];
    const errors = [];

    for (let i = 0; i < suppliers.length; i++) {
      try {
        const {
          name,
          email,
          phone,
          address,
          payable_code,
          payable_accural_code,
          other_payable_code,
          branch_id,
        } = suppliers[i];

        const parsedBranchId =
          branch_id == null || branch_id === "" || branch_id === "all"
            ? null
            : parseInt(branch_id, 10) || null;

        if (!name) {
          errors.push({
            index: i,
            data: suppliers[i],
            error: "Supplier name is required",
          });
          continue;
        }

        // Generate supplier number
        const numberResult = await db.sequelize.query(
          `CALL nurmber_generator1(:in_query_type, :facilityId)`,
          {
            replacements: { in_query_type: "sup", facilityId },
            transaction,
          },
        );

        const code = numberResult[0]?.sup;
        if (!code) {
          throw new Error("Supplier number generation failed");
        }

        const supplierNo = `SUP${String(code).padStart(3, "0")}`;

        // Create supplier
        const supplier = await db.SuppliersInfo.create(
          {
            facilityId,
            supplier_number: supplierNo,
            supplier_name: name,
            address: address || null,
            phone: phone || null,
            email: email || null,
            status: "active",
            payable_code: payable_code || null,
            payable_accural_code: payable_accural_code || null,
            branch_id: parsedBranchId,
            other_payable_code: other_payable_code || null,
            date: moment().format("YYYY-MM-DD"),
          },
          { transaction },
        );

        // Update number generator
        await db.sequelize.query(
          `CALL update_number_generator(:query_type, :in_number, :facilityId)`,
          {
            replacements: {
              query_type: "sup",
              in_number: code,
              facilityId,
            },
            transaction,
          },
        );

        createdSuppliers.push(supplier);
      } catch (error) {
        errors.push({
          index: i,
          data: suppliers[i],
          error: error.message,
        });
      }
    }

    await transaction.commit();

    res.status(201).json({
      success: true,
      message: `${createdSuppliers.length} suppliers created successfully`,
      data: {
        created: createdSuppliers,
        errors: errors.length > 0 ? errors : undefined,
      },
    });
  } catch (error) {
    await transaction.rollback();
    console.error("Bulk Create Suppliers Error:", error);
    res.status(500).json({
      success: false,
      message: "Error creating suppliers",
      error: error.message,
    });
  }
};
