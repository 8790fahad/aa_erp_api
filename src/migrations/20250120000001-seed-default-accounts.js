'use strict';

const accountTypesData = {
  accountTypes: [
    {
      typeId: "0",
      type: "Cash and cash equivalents",
      typeMnemonic: "bank",
      typeEnumName: "BANK",
      children: [
        { detailTypeId: "1010", detailType: "Bank", detailTypeMnemonic: "checking", detailTypeEnumName: "CHECKING" },
        { detailTypeId: "1012", detailType: "Savings", detailTypeMnemonic: "savings", detailTypeEnumName: "SAVINGS" },
        { detailTypeId: "1020", detailType: "Cash on hand", detailTypeMnemonic: "cashonhand", detailTypeEnumName: "CASH_ON_HAND" },
      ],
    },
    {
      typeId: "1",
      type: "Accounts receivable (A/R)",
      typeMnemonic: "ar",
      typeEnumName: "AR",
      children: [
        { detailTypeId: "1040", detailType: "Accounts Receivable (A/R)", detailTypeMnemonic: "accountsreceivable", detailTypeEnumName: "ACCOUNTS_RECEIVABLE" },
      ],
    },
    {
      typeId: "2",
      type: "Current assets",
      typeMnemonic: "othercurassets",
      typeEnumName: "OTHER_CUR_ASSETS",
      children: [
        { detailTypeId: "1220", detailType: "Inventory", detailTypeMnemonic: "inventory", detailTypeEnumName: "INVENTORY" },
        { detailTypeId: "1050", detailType: "Prepaid Expenses", detailTypeMnemonic: "prepaidexpenses", detailTypeEnumName: "PREPAID_EXPENSES" },
      ],
    },
    {
      typeId: "3",
      type: "Fixed assets",
      typeMnemonic: "fixedassets",
      typeEnumName: "FIXED_ASSETS",
      children: [
        { detailTypeId: "1440", detailType: "Machinery and equipment", detailTypeMnemonic: "machineryequipment", detailTypeEnumName: "MACHINERY_EQUIPMENT" },
        { detailTypeId: "1450", detailType: "Vehicles", detailTypeMnemonic: "vehicles", detailTypeEnumName: "VEHICLES" },
      ],
    },
    {
      typeId: "5",
      type: "Accounts payable (A/P)",
      typeMnemonic: "ap",
      typeEnumName: "AP",
      children: [
        { detailTypeId: "2010", detailType: "Accounts Payable (A/P)", detailTypeMnemonic: "accountspayable", detailTypeEnumName: "ACCOUNTS_PAYABLE" },
      ],
    },
    {
      typeId: "9",
      type: "Owner's equity",
      typeMnemonic: "equity",
      typeEnumName: "EQUITY",
      children: [
        { detailTypeId: "3050", detailType: "Owner's Equity", detailTypeMnemonic: "ownersequity", detailTypeEnumName: "OWNER_S_EQUITY" },
        { detailTypeId: "3070", detailType: "Retained Earnings", detailTypeMnemonic: "retainedearnings", detailTypeEnumName: "RETAINED_EARNINGS" },
      ],
    },
    {
      typeId: "10",
      type: "Income",
      typeMnemonic: "income",
      typeEnumName: "INCOME",
      children: [
        { detailTypeId: "5120", detailType: "Sales of Product Income", detailTypeMnemonic: "salesofproductincome", detailTypeEnumName: "SALES_OF_PRODUCT_INCOME" },
        { detailTypeId: "5110", detailType: "Service/Fee Income", detailTypeMnemonic: "servicefeeincome", detailTypeEnumName: "SERVICE_FEE_INCOME" },
      ],
    },
    {
      typeId: "12",
      type: "Expenses",
      typeMnemonic: "expense",
      typeEnumName: "EXPENSE",
      children: [
        { detailTypeId: "6220", detailType: "Office/General Administrative Expenses", detailTypeMnemonic: "officegeneraladministrativeexpenses", detailTypeEnumName: "OFFICE_GENERAL_ADMINISTRATIVE_EXPENSES" },
        { detailTypeId: "6230", detailType: "Utilities", detailTypeMnemonic: "utilities", detailTypeEnumName: "UTILITIES" },
        { detailTypeId: "6140", detailType: "Payroll Expenses", detailTypeMnemonic: "payrollexpenses", detailTypeEnumName: "PAYROLL_EXPENSES" },
      ],
    },
  ],
};

module.exports = {
  up: async (queryInterface, Sequelize) => {
    // Get all facility IDs from the business table
    const [facilities] = await queryInterface.sequelize.query(`
      SELECT id, business_name FROM business WHERE id IS NOT NULL
    `);

    if (!facilities || facilities.length === 0) {
      console.log('No facilities found. Skipping default account seeding.');
      return;
    }

    // Default accounts to create for each facility
    const defaultAccounts = [
      { head: '1000', description: 'Cash', typeId: '0', detailTypeId: '1020', account_type: 'Cash and cash equivalents' },
      { head: '1010', description: 'Bank Account', typeId: '0', detailTypeId: '1010', account_type: 'Cash and cash equivalents' },
      { head: '1200', description: 'Accounts Receivable', typeId: '1', detailTypeId: '1040', account_type: 'Accounts receivable (A/R)' },
      { head: '1500', description: 'Inventory', typeId: '2', detailTypeId: '1220', account_type: 'Current assets' },
      { head: '2000', description: 'Accounts Payable', typeId: '5', detailTypeId: '2010', account_type: 'Accounts payable (A/P)' },
      { head: '3000', description: "Owner's Equity", typeId: '9', detailTypeId: '3050', account_type: "Owner's equity" },
      { head: '4000', description: 'Sales Revenue', typeId: '10', detailTypeId: '5120', account_type: 'Income' },
      { head: '5000', description: 'Operating Expenses', typeId: '12', detailTypeId: '6220', account_type: 'Expenses' },
    ];

    // Insert default accounts for each facility
    for (const facility of facilities) {
      for (const account of defaultAccounts) {
        const accountType = accountTypesData.accountTypes.find(t => t.typeId === account.typeId);
        const detailType = accountType?.children.find(d => d.detailTypeId === account.detailTypeId);

        const accountData = {
          head: account.head,
          description: account.description,
          account_type: account.account_type,
          typeId: account.typeId,
          detailTypeId: account.detailTypeId,
          typeEnumName: accountType?.typeEnumName || null,
          detailTypeEnumName: detailType?.detailTypeEnumName || null,
          typeMnemonic: accountType?.typeMnemonic || null,
          detailTypeMnemonic: detailType?.detailTypeMnemonic || null,
          detailType: detailType?.detailType || null,
          facilityId: facility.id,
          status: 'activated',
          createdAt: new Date(),
        };

        // Check if account already exists
        const [existing] = await queryInterface.sequelize.query(`
          SELECT head FROM account
          WHERE head = :head AND facilityId = :facilityId
        `, {
          replacements: { head: account.head, facilityId: facility.id },
          type: Sequelize.QueryTypes.SELECT,
        });

        if (!existing) {
          await queryInterface.bulkInsert('account', [accountData]);
          console.log(`Created default account ${account.head} - ${account.description} for facility ${facility.business_name}`);
        } else {
          // Update existing account with new fields if they're null
          await queryInterface.sequelize.query(`
            UPDATE account
            SET typeId = :typeId,
                detailTypeId = :detailTypeId,
                typeEnumName = :typeEnumName,
                detailTypeEnumName = :detailTypeEnumName,
                typeMnemonic = :typeMnemonic,
                detailTypeMnemonic = :detailTypeMnemonic,
                detailType = :detailType
            WHERE head = :head AND facilityId = :facilityId
            AND (typeId IS NULL OR detailTypeId IS NULL)
          `, {
            replacements: {
              head: account.head,
              facilityId: facility.id,
              typeId: account.typeId,
              detailTypeId: account.detailTypeId,
              typeEnumName: accountType?.typeEnumName || null,
              detailTypeEnumName: detailType?.detailTypeEnumName || null,
              typeMnemonic: accountType?.typeMnemonic || null,
              detailTypeMnemonic: detailType?.detailTypeMnemonic || null,
              detailType: detailType?.detailType || null,
            },
          });
          console.log(`Updated default account ${account.head} - ${account.description} for facility ${facility.business_name}`);
        }
      }
    }

    console.log('Default accounts seeded successfully for all facilities.');
  },

  down: async (queryInterface, Sequelize) => {
    // Remove default accounts (optional - you may want to keep them)
    // This will only remove accounts with the specific heads we created
    const defaultHeads = ['1000', '1010', '1200', '1500', '2000', '3000', '4000', '5000'];

    await queryInterface.sequelize.query(`
      DELETE FROM account
      WHERE head IN (:heads)
      AND typeId IS NOT NULL
      AND detailTypeId IS NOT NULL
    `, {
      replacements: { heads: defaultHeads },
    });

    console.log('Default accounts removed.');
  }
};




