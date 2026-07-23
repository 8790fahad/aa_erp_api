const db = require("../models");
const moment = require("moment");
const { v4: UUIDV4 } = require("uuid");
const { getAndUpdateNumber } = require("../services/numberGen");
// const { getBalance } = require("./supplier");
const {
  SuppliersInfo,
  SupplierEntry,
  StoreEntry,
  GeneralLedger,
  Account,
} = require("../models");
const { getBalance } = require("./supplier");
const { STORE_ENTRY_TYPE } = require("../constants/storeEntryTypes");
// Helper functions for number generation (assuming these exist in your system)
async function numberGenerator(
  { query_type = "", facilityId = "" },
  callback = (f) => f,
  error = (f) => f
) {
  db.sequelize
    .query("CALL nurmber_generator1(:query_type,:facilityId)", {
      replacements: {
        query_type,
        facilityId,
      },
    })
    .then(callback)
    .catch(error);
}

async function numberGeneratorUpdate(
  { query_type = "", in_number = null, facilityId = "" },
  callback = (f) => f,
  error = (f) => f
) {
  db.sequelize
    .query("CALL update_number_generator(:query_type,:in_number,:facilityId)", {
      replacements: {
        query_type,
        in_number,
        facilityId,
      },
    })
    .then((results) => callback(results))
    .catch((err) => error(err));
}

// Function to update inventory valuation
async function updateInventoryValuation(
  productId,
  facilityId,
  newQuantity,
  newCost,
  valuationMethod,
  transaction
) {
  try {
    // Get existing valuation record
    const [existingValuation] = await db.InventoryValuation.findOrCreate({
      where: {
        product_id: productId,
        facility_id: facilityId,
      },
      defaults: {
        product_id: productId,
        facility_id: facilityId,
        quantity_on_hand: 0,
        avg_unit_cost: 0,
        total_value: 0,
        valuation_method: valuationMethod || "WAC", // Use provided method or default to WAC
        updated_at: new Date(),
      },
      transaction,
    });

    let updatedQuantity = 0;
    let updatedCost = 0;
    let updatedTotalValue = 0;

    // Calculate based on valuation method
    switch (valuationMethod || existingValuation.valuation_method || "WAC") {
      case "FIFO":
        // For FIFO, we'll track the actual cost of this specific receipt
        // This is a simplified FIFO implementation - in a full system, you'd track individual lots
        updatedQuantity =
          parseFloat(existingValuation.quantity_on_hand) +
          parseFloat(newQuantity);
        // For simplicity, we'll still use weighted average for FIFO in this implementation
        // A full FIFO implementation would require lot tracking
        const currentTotalValue =
          parseFloat(existingValuation.quantity_on_hand) *
          parseFloat(existingValuation.avg_unit_cost);
        const additionalValue = parseFloat(newQuantity) * parseFloat(newCost);
        updatedTotalValue = currentTotalValue + additionalValue;
        updatedCost =
          updatedQuantity > 0 ? updatedTotalValue / updatedQuantity : 0;
        break;

      case "LIFO":
        // For LIFO, similar approach to FIFO for simplicity
        updatedQuantity =
          parseFloat(existingValuation.quantity_on_hand) +
          parseFloat(newQuantity);
        const lifoCurrentTotalValue =
          parseFloat(existingValuation.quantity_on_hand) *
          parseFloat(existingValuation.avg_unit_cost);
        const lifoAdditionalValue =
          parseFloat(newQuantity) * parseFloat(newCost);
        updatedTotalValue = lifoCurrentTotalValue + lifoAdditionalValue;
        updatedCost =
          updatedQuantity > 0 ? updatedTotalValue / updatedQuantity : 0;
        break;

      case "SPECIFIC":
        // For specific identification, we would need lot tracking
        // This is a simplified approach
        updatedQuantity =
          parseFloat(existingValuation.quantity_on_hand) +
          parseFloat(newQuantity);
        const specificCurrentTotalValue =
          parseFloat(existingValuation.quantity_on_hand) *
          parseFloat(existingValuation.avg_unit_cost);
        const specificAdditionalValue =
          parseFloat(newQuantity) * parseFloat(newCost);
        updatedTotalValue = specificCurrentTotalValue + specificAdditionalValue;
        updatedCost =
          updatedQuantity > 0 ? updatedTotalValue / updatedQuantity : 0;
        break;

      case "WAC":
      default:
        // Weighted Average Cost (default method)
        const currentQuantity =
          parseFloat(existingValuation.quantity_on_hand) || 0;
        const currentCost = parseFloat(existingValuation.avg_unit_cost) || 0;
        const currentTotalValueWAC = currentQuantity * currentCost;

        const additionalQuantity = parseFloat(newQuantity) || 0;
        const additionalCost = parseFloat(newCost) || 0;
        const additionalValueWAC = additionalQuantity * additionalCost;

        updatedQuantity = currentQuantity + additionalQuantity;
        updatedTotalValue = currentTotalValueWAC + additionalValueWAC;
        updatedCost =
          updatedQuantity > 0 ? updatedTotalValue / updatedQuantity : 0;
        break;
    }

    // Update the valuation record
    await existingValuation.update(
      {
        quantity_on_hand: updatedQuantity,
        cost: updatedCost,
        total_value: updatedTotalValue,
        valuation_method:
          valuationMethod || existingValuation.valuation_method || "WAC",
        updated_at: new Date(),
      },
      { transaction }
    );

    return existingValuation;
  } catch (error) {
    console.error("Error updating inventory valuation:", error);
    throw error;
  }
}

exports.generateGoodReceive = async (req, res) => {
  const transaction = await db.sequelize.transaction();

  try {
    const {
      supplier_code = "",
      waybill_no = "",
      truck_no = "",
      items = [],
      pr_no = "",
      po_no = "",
      facilityId,
      user_id,
      purpose = "",
      remark = "",
      payable_accrual_code,
      payable_code,
      receiving_branch = null,
      receiving_branch_id = 0,
    } = req.body;
    console.log(req.body, "=====");
    if (!supplier_code || !items.length || !facilityId || !user_id) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message:
          "Missing required fields: supplier_code, items, facilityId, user_id",
      });
    }

    const date = new Date();
    const transactionRef = `TRX-${Date.now()}-${Math.floor(
      Math.random() * 1000
    )}`;
    const grnCode = await getAndUpdateNumber("grn", facilityId);
    // branchId comes directly from the frontend (integer)
    const receivingBranchId = parseInt(receiving_branch_id, 10) || 0;

    // Supplier check
    const supplier = await SuppliersInfo.findOne({
      where: { supplier_number: supplier_code, facilityId },
    });
    if (!supplier) {
      await transaction.rollback();
      return res.status(404).json({
        success: false,
        error: `Supplier not found for code: ${supplier_code}`,
      });
    }
    const supplier_name = supplier.name || `Supplier ${supplier_code}`;

    // Account lookups
    const supplierAccrualCode =
      supplier.payable_accural_code || supplier.payable_accrual_code;
    const accruedAccount = supplierAccrualCode
      ? await Account.findOne({
          where: { head: supplierAccrualCode, facilityId },
        })
      : await Account.findOne({
          where: { head: payable_accrual_code, facilityId },
        });
    if (supplierAccrualCode && !accruedAccount) {
      await transaction.rollback();
      return res.status(404).json({
        success: false,
        error: `Accrued account not found for payable_accrual_code: ${payable_accrual_code}`,
      });
    }

    const payableAccount = supplier.payable_code
      ? await Account.findOne({
          where: { head: supplier.payable_code, facilityId },
        })
      : await Account.findOne({ where: { head: payable_code, facilityId } });
    if (payable_code && !payableAccount) {
      await transaction.rollback();
      return res.status(404).json({
        success: false,
        error: `Payable account not found for payable_code: ${payable_code}`,
      });
    }

    // --- Process Each Item ---
    let totalAmount = 0;
    let storeEntries = [];

    for (const item of items) {
      const receivedQuantity = Number(item.receivedQuantity) || 0;
      const unitCost = Number(item.averageCostPerUom) || 0;
      const additionalCost = Number(item.additionalCostValue) || 0;
      const itemTotal = receivedQuantity * unitCost + additionalCost;

      totalAmount += itemTotal;

      // Validate inventory account
      const inventoryAccount = item.inventory_account
        ? await Account.findOne({
            where: { head: item.inventory_account, facilityId },
          })
        : null;

      if (item.inventory_account && !inventoryAccount) {
        await transaction.rollback();
        return res.status(404).json({
          success: false,
          error: `Inventory account not found for ${item.inventory_account}`,
        });
      }
      await db.Product.update(
        {
          cost_price: unitCost,
        },
        { where: { sku: item.item_code, facility_id: facilityId }, transaction }
      );
      // Create Store Entry
      const storeEntry = await db.StoreEntry.create(
        {
          receive_date: moment().format("YYYY-MM-DD"),
          po_no: po_no || pr_no,
          reference_number: grnCode,
          qty_in: receivedQuantity,
          qty_out: 0,
          expiry_date: item.expiryDate || null,
          cost_price: unitCost,
          selling_price: unitCost,
          branch_name: receiving_branch || "Main Warehouse",
          branchId: receivingBranchId,
          inserted_by: user_id,
          facilityId,
          transaction_ref: transactionRef,
          item_category: item.item_category || "General",
          truckNo: truck_no,
          waybillNo: waybill_no,
          supplier_code,
          supplier_name,
          source: `Purchase from ${supplier_name}`,
          destination: receiving_branch || "Main Warehouse",
          status: "approved",
          activation: "active",
          type: STORE_ENTRY_TYPE.PURCHASE,
          product_id: item.item_code || item.id.toString(),
        },
        { transaction }
      );

      storeEntries.push(storeEntry);

      // Debit Inventory
      await db.GeneralLedger.create(
        {
          transaction_date: date,
          account_code: inventoryAccount.head,
          account_subhead: inventoryAccount.subhead,
          dr: itemTotal,
          cr: 0,
          account_description: inventoryAccount.description,
          transaction_description: `GRN ${grnCode} for ${item.item_name}`,
          reference_number: supplier_code,
          purpose_of_payment: purpose,
          payee: supplier_name,
          mode_of_payment: "GRN",
          created_by: user_id,
          facility_id: facilityId,
          status: "unpaid",
          type: "inventory",
          transaction_ref: grnCode,
        },
        { transaction }
      );

      await db.SupplierEntry.create(
        {
          supplier_number: supplier_code,
          description: item.item_name,
          cost: item.est_cost,
          qty_out: item.quantity,
          facilityId,
          mode_of_payment: "credit",
          receiptNo: grnCode,
          created_by: user_id,
          created_at: date,
        },
        { transaction }
      );
    }

    // --- Supplier Accrual / Payable Logic ---
    const previousBalance =
      parseFloat(await getBalance(supplier_code, facilityId)) || 0;
    const newBalance = previousBalance + totalAmount;

    // Handle accrued and payable accounts
    if (previousBalance > 0 && accruedAccount) {
      // Positive balance: Settle accrued first
      const accruedAmount = Math.min(totalAmount, previousBalance); // Settle up to previousBalance
      const payableAmount = totalAmount - accruedAmount; // Remaining goes to payable

      // Credit Accrued Account
      if (accruedAmount > 0) {
        await db.GeneralLedger.create(
          {
            transaction_date: date,
            account_code: accruedAccount.head,
            account_subhead: accruedAccount.subhead,
            dr: 0,
            cr: accruedAmount,
            account_description: accruedAccount.description,
            transaction_description: `Goods Received Note ${grnCode} (Accrued)`,
            reference_number: grnCode,
            purpose_of_payment: purpose,
            payee: supplier_name,
            mode_of_payment: "GRN",
            created_by: user_id,
            facility_id: facilityId,
            status: "unpaid",
            type: "accrued",
            transaction_ref: `${transactionRef}-ACCRUED`,
          },
          { transaction }
        );
      }

      // Credit Payable Account (if any remaining amount)
      if (payableAmount > 0 && payableAccount) {
        await db.GeneralLedger.create(
          {
            transaction_date: date,
            account_code: payableAccount.head,
            account_subhead: payableAccount.subhead,
            dr: 0,
            cr: payableAmount,
            account_description: payableAccount.description,
            transaction_description: `Goods Received Note ${grnCode} (Payable)`,
            reference_number: grnCode,
            purpose_of_payment: purpose,
            payee: supplier_name,
            mode_of_payment: "GRN",
            created_by: user_id,
            facility_id: facilityId,
            status: "unpaid",
            type: "payable",
            transaction_ref: `${transactionRef}-PAYABLE`,
          },
          { transaction }
        );
      }
    } else if (payableAccount) {
      // Negative or zero balance: Add entire amount to payable
      await db.GeneralLedger.create(
        {
          transaction_date: date,
          account_code: payableAccount.head,
          account_subhead: payableAccount.subhead,
          dr: 0,
          cr: totalAmount,
          account_description: payableAccount.description,
          transaction_description: `Goods Received Note ${grnCode}`,
          reference_number: grnCode,
          purpose_of_payment: purpose,
          payee: supplier_name,
          mode_of_payment: "GRN",
          created_by: user_id,
          facility_id: facilityId,
          status: "unpaid",
          type: "payable",
          transaction_ref: `${transactionRef}-PAYABLE`,
        },
        { transaction }
      );
    } else {
      // No payable account available
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: "Payable account is required for processing the transaction",
      });
    }

    // Commit
    await transaction.commit();

    res.status(200).json({
      success: true,
      message: "Goods receipt processed successfully",
      data: {
        grn_code: grnCode,
        total_amount: totalAmount,
        previous_supplier_balance: previousBalance,
        new_supplier_balance: newBalance,
        items_processed: storeEntries.length,
      },
    });
  } catch (err) {
    console.error(err, "Error in generateGoodReceive");
    await transaction.rollback();
    res.status(500).json({
      success: false,
      message: "Error while processing goods receipt",
      error: err.message,
    });
  }
};
