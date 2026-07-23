const db = require("../models");
// Get all transactions
exports.getAllTransactions = (req, res) => {
    const { facility_id, transaction_type = "", status = "", page = 1, limit = 50 } = req.query;
    
    db.sequelize
      .query("CALL get_all_transactions(:facility_id, :transaction_type, :status, :page, :limit)", {
        replacements: { facility_id, transaction_type, status, page, limit },
      })
      .then((results) => {
        res.json({ success: true, results });
      })
      .catch((err) => {
        res.status(500).json({ err });
        console.log(err);
      });
  };
  
  // Create new transaction
  exports.createTransaction = (req, res) => {
    const { transaction_data } = req.body;
    
    db.sequelize
      .query("CALL create_transaction(:transaction_data)", {
        replacements: { transaction_data: JSON.stringify(transaction_data) },
      })
      .then((results) => {
        res.json({ success: true, results });
      })
      .catch((err) => {
        res.status(500).json({ err });
        console.log(err);
      });
  };
  
  // Get transaction by ID
  exports.getTransactionById = (req, res) => {
    const { id } = req.params;
    
    db.sequelize
      .query("CALL get_transaction_by_id(:id)", {
        replacements: { id },
      })
      .then((results) => {
        res.json({ success: true, results });
      })
      .catch((err) => {
        res.status(500).json({ err });
        console.log(err);
      });
  };
  
  // Update transaction
  exports.updateTransaction = (req, res) => {
    const { id } = req.params;
    const { transaction_data } = req.body;
    
    db.sequelize
      .query("CALL update_transaction(:id, :transaction_data)", {
        replacements: { id, transaction_data: JSON.stringify(transaction_data) },
      })
      .then((results) => {
        res.json({ success: true, results });
      })
      .catch((err) => {
        res.status(500).json({ err });
        console.log(err);
      });
  };
  
  // Delete transaction
  exports.deleteTransaction = (req, res) => {
    const { id } = req.params;
    
    db.sequelize
      .query("CALL delete_transaction(:id)", {
        replacements: { id },
      })
      .then((results) => {
        res.json({ success: true, results });
      })
      .catch((err) => {
        res.status(500).json({ err });
        console.log(err);
      });
  };
  
  // Post transaction to general ledger
  exports.postTransactionToGL = (req, res) => {
    const { id } = req.params;
    const { journal_entries } = req.body;
    
    db.sequelize
      .query("CALL post_transaction_to_gl(:id, :journal_entries)", {
        replacements: { id, journal_entries: JSON.stringify(journal_entries) },
      })
      .then((results) => {
        res.json({ success: true, results });
      })
      .catch((err) => {
        res.status(500).json({ err });
        console.log(err);
      });
  };

//   --------------------------------------------Other things used------------------------------------------------------

// ----------------------------------------------Customers Suppliers Staffs--------------------------------------------
// Get customers
exports.getCustomers = (req, res) => {
    const { search = "" } = req.query;
    
    db.sequelize
      .query("CALL get_customers(:search)", {
        replacements: { search },
      })
      .then((results) => {
        res.json({ success: true, results });
      })
      .catch((err) => {
        res.status(500).json({ err });
        console.log(err);
      });
  };
  
  // Get vendors
  exports.getVendors = (req, res) => {
    const { search = "" } = req.query;
    
    db.sequelize
      .query("CALL get_vendors(:search)", {
        replacements: { search },
      })
      .then((results) => {
        res.json({ success: true, results });
      })
      .catch((err) => {
        res.status(500).json({ err });
        console.log(err);
      });
  };
  
  // Get employees
  exports.getEmployees = (req, res) => {
    const { department = "" } = req.query;
    
    db.sequelize
      .query("CALL get_employees(:department)", {
        replacements: { department },
      })
      .then((results) => {
        res.json({ success: true, results });
      })
      .catch((err) => {
        res.status(500).json({ err });
        console.log(err);
      });
  };
  
  // Get approvers
  exports.getApprovers = (req, res) => {
    db.sequelize
      .query("CALL get_approvers()", {})
      .then((results) => {
        res.json({ success: true, results });
      })
      .catch((err) => {
        res.status(500).json({ err });
        console.log(err);
      });
  };

//  ------------------------------------------Account---------------------------------------------------
exports.getChartOfAccounts = (req, res) => {
    const { account_type = "", category = "" } = req.query;
    
    db.sequelize
      .query("CALL get_chart_of_accounts(:account_type, :category)", {
        replacements: { account_type, category },
      })
      .then((results) => {
        res.json({ success: true, results });
      })
      .catch((err) => {
        res.status(500).json({ err });
        console.log(err);
      });
  };
  
  // Get filtered accounts by transaction type
  exports.getAccountsByTransactionType = (req, res) => {
    const { transaction_type } = req.query;
    
    db.sequelize
      .query("CALL get_accounts_by_transaction_type(:transaction_type)", {
        replacements: { transaction_type },
      })
      .then((results) => {
        res.json({ success: true, results });
      })
      .catch((err) => {
        res.status(500).json({ err });
        console.log(err);
      });
  };