const db = require("../models");
const moment = require("moment");
const {
  issueCredentialForBusiness,
} = require("../utils/einvoicingCredentials");

const _getBusinessProfile = async (
  callback = (f) => f,
  error = (f) => f,
  email,
) => {
  try {
    console.log();
    // Find membership to get business_id from user_id
    const membership = await db.membership.findAll({
      where: { email: email },
      attributes: ["business_id", "access_to", "functionalities"],
    });

    if (!membership.length) {
      return error(new Error("Membership not found"));
    }

    // Get business details for all businesses the user is a member of (WHERE id IN (...))
    const businessIds = membership.map((m) => m.business_id).filter(Boolean);
    const businesses = await db.business.findAll({
      where: { id: { [db.Sequelize.Op.in]: businessIds } },
      attributes: [
        "id",
        "business_name",
        "business_type",
        "business_address",
        "wip",
        "opening_balance_equity",
        "sale_revenue_code",
        "business_logo",
        "document_header_style",
        "primary_color",
        "secondary_color",
        "business_phone",
        "business_email",
        "rc",
        "fax",
        "description",
        "abnormal_loss_account",
        "scrap_inventory_account",
        "prefix",
        "payable_code",
        "finished_goods_code",
        "other_payable_code",
        "receivable_code",
        "cost_of_sale",
        "payable_accural_code",
        "other_receivable_code",
        "receivable_accural_code",
        "costing_method",
        "depreciation_method",
        "auto_depreciation_enabled",
        "invoice_closing_enabled",
        "invoice_closing_time",
        "invoice_closing_timezone",
        "invoice_closing_last_run",
        "auto_depreciation_frequency",
        "auto_depreciation_day",
        "auto_depreciation_last_run",
        "vat_policy",
        "seal",
        "inv_ev_m",
        "default_valuation_source",
        "allow_sales_without_stock",
        "paye_auto_calculation",
        "pro_bono_code",
        "valuation_date",
        "default_receipt_type",
        "customer_notes",
        "terms_conditions",
        "enable_online_ordering",
        "enable_production_correction",
        "enable_material_requisition",
        "link_user",
        "marketplace_tiny_link",
        "enable_marketplace_social_media",
        "marketplace_social_media",
        "business_logo"
      ],
    });

    if (!businesses.length) {
      return error(new Error("Business not found"));
    }

    const business = businesses[0];

    // If accounting codes are not set, get defaults from Chart of Accounts
    const facilityId = business.id;
    let defaultCodes = {};

    // Get default codes from account_category if not already set
    if (!business.receivable_code) {
      const arAccount = await db.sequelize.query(
        `SELECT code FROM account_category
         WHERE facility_id = :facilityId
         AND description LIKE '%Accounts Receivable%'
         AND level = 3
         ORDER BY code LIMIT 1`,
        {
          replacements: { facilityId },
          type: db.Sequelize.QueryTypes.SELECT,
        },
      );
      if (arAccount && arAccount.length > 0) {
        defaultCodes.receivable_code = arAccount[0].code;
      }
    }

    if (!business.payable_code) {
      const apAccount = await db.sequelize.query(
        `SELECT code FROM account_category
         WHERE facility_id = :facilityId
         AND description LIKE '%Accounts Payable%'
         AND level = 3
         ORDER BY code LIMIT 1`,
        {
          replacements: { facilityId },
          type: db.Sequelize.QueryTypes.SELECT,
        },
      );
      if (apAccount && apAccount.length > 0) {
        defaultCodes.payable_code = apAccount[0].code;
      }
    }

    if (!business.sale_revenue_code) {
      const revenueAccount = await db.sequelize.query(
        `SELECT code FROM account_category
         WHERE facility_id = :facilityId
         AND category = 'Revenue'
         AND level = 2
         ORDER BY code LIMIT 1`,
        {
          replacements: { facilityId },
          type: db.Sequelize.QueryTypes.SELECT,
        },
      );
      if (revenueAccount && revenueAccount.length > 0) {
        defaultCodes.sale_revenue_code = revenueAccount[0].code;
      }
    }

    if (!business.cost_of_sale) {
      const cosAccount = await db.sequelize.query(
        `SELECT code FROM account_category
         WHERE facility_id = :facilityId
         AND description LIKE '%Cost of sales%'
         AND level = 2
         ORDER BY code LIMIT 1`,
        {
          replacements: { facilityId },
          type: db.Sequelize.QueryTypes.SELECT,
        },
      );
      if (cosAccount && cosAccount.length > 0) {
        defaultCodes.cost_of_sale = cosAccount[0].code;
      }
    }

    if (!business.receivable_accural_code) {
      const arAccrualAccount = await db.sequelize.query(
        `SELECT code FROM account_category
         WHERE facility_id = :facilityId
         AND description LIKE '%Accrued%'
         AND (category = 'Assets' OR category = 'Liabilities')
         ORDER BY code LIMIT 1`,
        {
          replacements: { facilityId },
          type: db.Sequelize.QueryTypes.SELECT,
        },
      );
      if (arAccrualAccount && arAccrualAccount.length > 0) {
        defaultCodes.receivable_accural_code = arAccrualAccount[0].code;
      }
    }

    if (!business.payable_accural_code) {
      const apAccrualAccount = await db.sequelize.query(
        `SELECT code FROM account_category
         WHERE facility_id = :facilityId
         AND description LIKE '%Accrued liabilities%'
         AND level = 3
         ORDER BY code LIMIT 1`,
        {
          replacements: { facilityId },
          type: db.Sequelize.QueryTypes.SELECT,
        },
      );
      if (apAccrualAccount && apAccrualAccount.length > 0) {
        defaultCodes.payable_accural_code = apAccrualAccount[0].code;
      }
    }
    // Merge business data with default codes (use first membership record)
    const businessData = {
      ...business.toJSON(),
      ...defaultCodes,
      access_to: membership[0].access_to,
      functionalities: membership[0].functionalities,
      branch_id: membership[0].branch_id,
    };

    // Build list of all businesses user is a member of (for frontend switcher)
    const businessesList = businesses.map((b) => {
      const mem = membership.find((m) => m.business_id === b.id);
      return {
        ...b.toJSON(),
        access_to: mem?.access_to ?? null,
        functionalities: mem?.functionalities ?? null,
        branch_id: mem?.branch_id ?? null,
      };
    });

    // Format response: [[currentBusinessData]] for backward compatibility, plus full list
    const result = [[businessData]];
    // console.log(result,"result");
    callback(result, businessesList);
  } catch (err) {
    console.log("Error getting business profile:", err);
    error(err);
  }
};

const _createBusiness = async (obj, callback = (f) => f, error = (f) => f) => {
  try {
    const {
      id,
      business_name,
      business_address,
      business_logo,
      primary_color,
      secondary_color,
      tertiary_color,
      license_type,
      license_expiry,
      license_last_renewal,
      business_type,
      business_phone,
      description,
      business_email,
      rc,
      tin,
      fax,
      business_admin,
      created_at,
      business_includes_logistics = false,
      query_type = "",
      store,
      prefix = "",
      transaction, // Accept transaction parameter
      dashboard_widgets = null,
    } = obj;

    // Get default accounting codes from Chart of Accounts
    // Use known default codes based on standard CoA structure
    const facilityId = id;

    // Initialize defaultCodes with fallback values (receivable_code is required)
    let defaultCodes = {
      receivable_code: "10201", // Default Accounts Receivable code (required field)
      wip: "1030701",
      finished_goods_code: "1030703",
      opening_balance_equity: "30101",
      payable_code: "2010101",
      sale_revenue_code: "40107",
      cost_of_sale: "50106",
      payable_accural_code: "1031001",
      receivable_accural_code: "20318",
    };
    try {
      // Try to get actual codes from account_category if available
      if (transaction) {
        // Query Accounts Receivable code
        const arAccounts = await db.sequelize.query(
          `SELECT code FROM account_category
           WHERE facility_id = :facilityId
           AND code = '10201'
           LIMIT 1`,
          {
            replacements: { facilityId },
            type: db.Sequelize.QueryTypes.SELECT,
            transaction,
          },
        );
        if (arAccounts && arAccounts.length > 0 && arAccounts[0].code) {
          defaultCodes.receivable_code = arAccounts[0].code;
        }
        // Query Work in Progress code
        const wipAccounts = await db.sequelize.query(
          `SELECT code FROM account_category
           WHERE facility_id = :facilityId
           AND code = '10307'
           LIMIT 1`,
        );
        if (wipAccounts && wipAccounts.length > 0 && wipAccounts[0].code) {
          defaultCodes.wip = wipAccounts[0].code;
        }

        // Query Finished Goods code
        const fgAccounts = await db.sequelize.query(
          `SELECT code FROM account_category
           WHERE facility_id = :facilityId
           AND code = '1030703'
           LIMIT 1`,
        );
        if (fgAccounts && fgAccounts.length > 0 && fgAccounts[0].code) {
          defaultCodes.finished_goods_code = fgAccounts[0].code;
        }

        // Query Opening Balance Equity code
        const equityAccounts = await db.sequelize.query(
          `SELECT code FROM account_category
           WHERE facility_id = :facilityId
           AND code = '30110'
           LIMIT 1`,
        );
        if (
          equityAccounts &&
          equityAccounts.length > 0 &&
          equityAccounts[0].code
        ) {
          defaultCodes.opening_balance_equity = equityAccounts[0].code;
        }

        // Query Accounts Payable code
        const apAccounts = await db.sequelize.query(
          `SELECT code FROM account_category
           WHERE facility_id = :facilityId
           AND code = '20101'
           LIMIT 1`,
          {
            replacements: { facilityId },
            type: db.Sequelize.QueryTypes.SELECT,
            transaction,
          },
        );
        if (apAccounts && apAccounts.length > 0 && apAccounts[0].code) {
          defaultCodes.payable_code = apAccounts[0].code;
        }

        // Query Revenue code
        const revenueAccounts = await db.sequelize.query(
          `SELECT code FROM account_category
           WHERE facility_id = :facilityId
           AND code = '40107'
           LIMIT 1`,
          {
            replacements: { facilityId },
            type: db.Sequelize.QueryTypes.SELECT,
            transaction,
          },
        );
        if (
          revenueAccounts &&
          revenueAccounts.length > 0 &&
          revenueAccounts[0].code
        ) {
          defaultCodes.sale_revenue_code = revenueAccounts[0].code;
        }

        // Query Cost of Sales code
        const cosAccounts = await db.sequelize.query(
          `SELECT code FROM account_category
           WHERE facility_id = :facilityId
           AND code = '50106'
           LIMIT 1`,
          {
            replacements: { facilityId },
            type: db.Sequelize.QueryTypes.SELECT,
            transaction,
          },
        );
        if (cosAccounts && cosAccounts.length > 0 && cosAccounts[0].code) {
          defaultCodes.cost_of_sale = cosAccounts[0].code;
        }

        // Query Payable Accrual code
        const apAccrualAccounts = await db.sequelize.query(
          `SELECT code FROM account_category
           WHERE facility_id = :facilityId
           AND code = '1031001'
           LIMIT 1`,
          {
            replacements: { facilityId },
            type: db.Sequelize.QueryTypes.SELECT,
            transaction,
          },
        );
        if (
          apAccrualAccounts &&
          apAccrualAccounts.length > 0 &&
          apAccrualAccounts[0].code
        ) {
          defaultCodes.payable_accural_code = apAccrualAccounts[0].code;
        }

        // Query Receivable Accrual code
        const arAccrualAccounts = await db.sequelize.query(
          `SELECT code FROM account_category
           WHERE facility_id = :facilityId
           AND description LIKE '%Unearned Deposits%'
           AND (category = 'Assets' OR category = 'Liabilities')
           ORDER BY code LIMIT 1`,
          {
            replacements: { facilityId },
            type: db.Sequelize.QueryTypes.SELECT,
            transaction,
          },
        );
        if (
          arAccrualAccounts &&
          arAccrualAccounts.length > 0 &&
          arAccrualAccounts[0].code
        ) {
          defaultCodes.receivable_accural_code = arAccrualAccounts[0].code;
        }
      }
    } catch (codeError) {
      // Log error but continue with default codes
      console.warn(
        "Warning: Could not query account_category, using default codes:",
        codeError.message,
      );
      // Continue with default codes - they are based on standard CoA structure
    }

    // receivable_code is always set from defaultCodes (required field)

    // Create business using Sequelize (with transaction if provided)
    const business = await db.business.create(
      {
        id: facilityId,
        business_name,
        business_address: business_address || "",
        business_logo: business_logo || "",
        primary_color: primary_color || "#4267B2",
        secondary_color: secondary_color || "#fff",
        tertiary_color: tertiary_color || "#fff",
        license_type: license_type || "TRIAL",
        license_expiry: license_expiry ? moment(license_expiry).toDate() : null,
        license_last_renewal: license_last_renewal
          ? moment(license_last_renewal).toDate()
          : null,
        business_type: business_type || "services",
        business_phone: business_phone || "",
        business_email: business_email || "",
        rc: rc || "",
        tin: tin || "",
        fax: fax || "",
        vat_policy: "vat_exclusive", // Set default to vat_exclusive (valid ENUM value)
        description: description || "",
        business_admin: business_admin || "",
        created_at: created_at ? moment(created_at).toDate() : new Date(),
        business_includes_logistics: business_includes_logistics || false,
        prefix: prefix || "",
        // Set default accounting codes from CoA (receivable_code is required)
        receivable_code: defaultCodes.receivable_code,
        payable_code: defaultCodes.payable_code || null,
        sale_revenue_code: defaultCodes.sale_revenue_code || null,
        cost_of_sale: defaultCodes.cost_of_sale || null,
        wip: defaultCodes.wip || null,
        finished_goods_code: defaultCodes.finished_goods_code || null,
        opening_balance_equity: defaultCodes.opening_balance_equity || null,
        dashboard_widgets,
        receivable_accural_code: defaultCodes.receivable_accural_code || null,
        payable_accural_code: defaultCodes.payable_accural_code || null,
      },
      { transaction },
    ); // Use transaction if provided

    // Create a default "Main Branch" for the new business
    try {
      await db.Branch.create(
        {
          branch_id: `BR-${moment().format("YY")}-001`,
          branch_name: "Main Branch",
          state: business_address
            ? business_address.split(",").pop().trim()
            : "",
          address: business_address || "",
          facilityId: facilityId,
          store_type: "Retail",
          admin: business_admin || "",
          created_by: business_admin || "",
          admin_name: "Administrator", // Default name
          crm: "",
          is_default: true,
        },
        { transaction },
      );
    } catch (branchError) {
      console.warn(
        "Warning: Could not create default branch:",
        branchError.message,
      );
      // We continue even if branch creation fails to avoid blocking business creation
    }

    // Seed default customer types so the business starts with a usable list.
    try {
      const defaultCustomerTypes = [
        { name: "Business", description: "Business customers" },
        { name: "Goverment", description: "Government customers" },
        { name: "individual", description: "Individual customers" },
      ];
      await db.CustomerType.bulkCreate(
        defaultCustomerTypes.map((t) => ({
          name: t.name,
          description: t.description,
          facilityId,
          status: "active",
        })),
        { transaction, ignoreDuplicates: true },
      );
    } catch (customerTypeError) {
      console.warn(
        "Warning: Could not seed default customer types:",
        customerTypeError.message,
      );
      // Continue even if seeding fails to avoid blocking business creation
    }

    // Auto-issue e-invoicing API credentials for the new business.
    // The plaintext secret is surfaced ONCE here; only its hash is stored.
    const businessJson = business.toJSON();
    try {
      const cred = await issueCredentialForBusiness({
        businessId: facilityId,
        name: business_name,
        transaction,
      });
      businessJson.einvoicing = {
        client_id: cred.client_id,
        client_secret: cred.client_secret,
        environment: cred.environment || "production",
        note: "Store client_secret securely — it will not be shown again. Rotate via POST /api/v1/invoice/credentials/rotate.",
      };
    } catch (credError) {
      console.warn(
        "Warning: Could not issue e-invoicing credentials:",
        credError.message,
      );
      // Do not block business creation if credential issuance fails.
    }

    // Format response to match stored procedure output format: [[{...}]]
    const result = [[businessJson]];
    callback(result);
  } catch (err) {
    console.log("Error creating business:", err);
    error(err);
  }
};

exports.createBusiness = _createBusiness;
exports.getBusinessProfile = _getBusinessProfile;
