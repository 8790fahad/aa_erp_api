"use strict";
module.exports = (sequelize, DataTypes) => {
  const Business = sequelize.define(
    "business",
    {
      id: {
        type: DataTypes.STRING(50),
        allowNull: false,
        primaryKey: true,
      },
      rc: {
        type: DataTypes.STRING(50),
        allowNull: true,
      },
      costing_method: {
        type: DataTypes.ENUM("process_costing", "job_product_costing"),
        allowNull: true,
        defaultValue: "",
      },
      depreciation_method: {
        type: DataTypes.ENUM("Straight Line", "Reducing Balance"),
        allowNull: false,
        defaultValue: "Straight Line",
        comment: "Default fixed-asset depreciation method for new assets",
      },
      auto_depreciation_enabled: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
        comment: "When true, cron runs bulk depreciation on schedule",
      },
      auto_depreciation_frequency: {
        type: DataTypes.ENUM("monthly", "quarterly", "yearly"),
        allowNull: false,
        defaultValue: "monthly",
        comment: "How often auto depreciation runs",
      },
      auto_depreciation_day: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 1,
        comment: "Day of month (1-28) to run auto depreciation",
      },
      auto_depreciation_last_run: {
        type: DataTypes.DATEONLY,
        allowNull: true,
        comment: "Last successful auto depreciation run date",
      },
      invoice_closing_enabled: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
        comment:
          "When true, unpaid non-credit invoices auto-reverse after daily closing time",
      },
      invoice_closing_time: {
        type: DataTypes.STRING(5),
        allowNull: false,
        defaultValue: "17:00",
        comment: "Daily closing time HH:mm (local business timezone)",
      },
      invoice_closing_timezone: {
        type: DataTypes.STRING(64),
        allowNull: false,
        defaultValue: "Africa/Lagos",
        comment: "IANA timezone for invoice closing time",
      },
      invoice_closing_last_run: {
        type: DataTypes.DATEONLY,
        allowNull: true,
        comment: "Last date daily invoice auto-reverse ran",
      },
      pro_bono_code: {
        type: DataTypes.STRING(50),
        allowNull: true,
      },
      tin: {
        type: DataTypes.STRING(50),
        allowNull: true,
      },
      vat_policy: {
        type: DataTypes.ENUM("vat_exclusive", "vat_inclusive", "all"),
        allowNull: true,
        defaultValue: "all",
      },
      business_name: {
        type: DataTypes.STRING(100),
        allowNull: false,
      },
      business_address: {
        type: DataTypes.STRING(400),
        allowNull: true,
      },
      business_logo: {
        type: DataTypes.TEXT("long"),
        allowNull: true,
      },
      document_header_style: {
        type: DataTypes.STRING(20),
        allowNull: false,
        defaultValue: "text",
        comment: "Document/print header layout: text | logo",
      },
      description: {
        type: DataTypes.STRING(400),
        allowNull: true,
      },
      // Enable/disable FlowBooks online ordering (WhatsApp store, etc.)
      enable_online_ordering: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
        comment:
          "When true, business can expose products to online ordering channels (e.g. WhatsApp store)",
      },
      marketplace_slug: {
        type: DataTypes.STRING(50),
        allowNull: true,
        unique: true,
        comment:
          "Short slug for marketplace tiny link (e.g. flowbooks.org/ma)",
      },
      link_user: {
        type: DataTypes.STRING(50),
        allowNull: true,
        unique: true,
        comment:
          "Custom username for marketplace link (e.g. flowbooks.org/i/myshop)",
      },
      marketplace_tiny_link: {
        type: DataTypes.STRING(255),
        allowNull: true,
        comment:
          "External shortened URL for storefront (TinyLink / URL shortener)",
      },
      enable_marketplace_social_media: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
        comment:
          "When true, social media handles are shown on the FlowSpace storefront",
      },
      marketplace_social_media: {
        type: DataTypes.JSON,
        allowNull: true,
        comment:
          "Social handles object: instagram, facebook, x, linkedin, whatsapp, telegram",
      },
      opening_balance_equity: {
        type: DataTypes.STRING(50),
        allowNull: true,
      },
      primary_color: {
        type: DataTypes.STRING(20),
        allowNull: true,
      },
      secondary_color: {
        type: DataTypes.STRING(20),
        allowNull: true,
      },
      tertiary_color: {
        type: DataTypes.STRING(20),
        allowNull: true,
      },
      payable_code: {
        type: DataTypes.STRING(20),
        allowNull: true,
      },
      wip: {
        type: DataTypes.STRING(20),
        allowNull: true,
      },
      abnormal_loss_account: {
        type: DataTypes.STRING(20),
        allowNull: true,
        comment: "Chart account code for abnormal production waste (loss)",
      },
      scrap_inventory_account: {
        type: DataTypes.STRING(20),
        allowNull: true,
        comment: "Chart account code for recyclable scrap inventory",
      },
      sale_revenue_code: {
        type: DataTypes.STRING(50),
        allowNull: true,
      },
      cost_of_sale: {
        type: DataTypes.STRING(50),
        allowNull: true,
      },
      fax: {
        type: DataTypes.STRING(50),
        allowNull: true,
      },
      tin: {
        type: DataTypes.STRING(50),
        allowNull: true,
      },
      business_email: {
        type: DataTypes.STRING(50),
        allowNull: true,
      },
      receivable_code: {
        type: DataTypes.STRING(50),
        allowNull: false,
      },
      valuation_date:{
         type: DataTypes.ENUM(
         'All', 'Daily', 'Weekly', 'Monthly', 'Yearly'
        ),
        allowNull: false,
      },
      finished_goods_code: {
        type: DataTypes.STRING(50),
        allowNull: true,
      },
      license_type: {
        type: DataTypes.STRING(50),
        allowNull: true,
      },
      license_expiry: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      license_last_renewal: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      business_type: {
        type: DataTypes.ENUM(
          "services",
          "retailers",
          "recycling",
          "manufacturing",
          "contractors",
        ),
        allowNull: false,
      },
      business_phone: {
        type: DataTypes.STRING(15),
        allowNull: true,
      },
      business_includes_logistics: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      allow_sales_without_stock: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      paye_auto_calculation: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
        comment: "When true, PAYE is computed automatically from pay components and tax settings",
      },
      /** Supplier bill (direct purchase): Finished Good / Resalable / By-Product stock-in uses sales zone (for sales). */
      price_setup_resalable_on_purchase: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      /** When true, production correction tools are available for this business. */
      enable_production_correction: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      /** When true, Material Requisition menu and flow are available. */
      enable_material_requisition: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
      business_admin: {
        type: DataTypes.STRING(50),
        allowNull: false,
      },
      created_at: {
        type: DataTypes.DATE,
        allowNull: false,
      },
      prefix: {
        type: DataTypes.STRING(100),
        allowNull: true,
      },
      other_receivable_code: {
        type: DataTypes.STRING(100),
        allowNull: true,
      },
      receivable_accural_code: {
        type: DataTypes.STRING(100),
        allowNull: true,
      },
      payable_accural_code: {
        type: DataTypes.STRING(100),
        allowNull: true,
      },
      other_payable_code: {
        type: DataTypes.STRING(100),
        allowNull: true,
      },
      seal: {
        type: DataTypes.TEXT("long"),
        allowNull: true,
      },
      stamp: {
        type: DataTypes.TEXT("long"),
        allowNull: true,
      },
      inv_ev_m: {
        type: DataTypes.ENUM("Weighted Average Cost", "LIFO", "FIFO"),
        allowNull: false,
        defaultValue: "Weighted Average Cost",
      },
      default_valuation_source: {
        type: DataTypes.ENUM("default_cost", "system_valuation"),
        allowNull: true,
        defaultValue: "default_cost",
        comment:
          "Use default cost (product cost_price) or system valuation method (inv_ev_m: Weighted Average, FIFO, LIFO)",
      },
      valuation_date: {
        type: DataTypes.ENUM("All", "Daily", "Weekly", "Monthly", "Yearly"),
        allowNull: true,
        defaultValue: "All",
        comment:
          "Inventory Valuation frequency - All (default), Daily, Weekly, Monthly, Yearly",
      },
      dashboard_widgets: {
        type: DataTypes.TEXT("long"),
        allowNull: true,
      },
      default_receipt_type: {
        type: DataTypes.ENUM("pdf", "terminal"),
        allowNull: false,
        defaultValue: "pdf",
        comment:
          "Default receipt format for sales — pdf (standard A4/A5) or terminal (80mm thermal printer)",
      },
      customer_notes: {
        type: DataTypes.TEXT,
        allowNull: true,
        comment: "Default customer notes shown on sales invoices",
      },
      terms_conditions: {
        type: DataTypes.TEXT,
        allowNull: true,
        comment: "Default terms & conditions shown on sales invoices",
      },
    },
    {
      tableName: "business",
      timestamps: true, // Since we have created_at field manually
    },
  );

  Business.associate = (models) => {
    // Business has many Customers
    if (models.Customer) {
      Business.hasMany(models.Customer, {
        foreignKey: "facilityId",
        sourceKey: "id",
        as: "customers",
      });
    }

    // Business has many CustomerEntries
    if (models.CustomerEntry) {
      Business.hasMany(models.CustomerEntry, {
        foreignKey: "facilityId",
        sourceKey: "id",
        as: "customerEntries",
      });
    }

    // Business has many GeneralLedger entries
    if (models.GeneralLedger) {
      Business.hasMany(models.GeneralLedger, {
        foreignKey: "facility_id",
        sourceKey: "id",
        as: "ledgerEntries",
      });
    }

    // Business has many Accounts
    if (models.Account) {
      Business.hasMany(models.Account, {
        foreignKey: "facilityId",
        sourceKey: "id",
        as: "accounts",
      });
    }
  };

  return Business;
};
