"use strict";

const db = require("../models");
const { Op } = require("sequelize");

class InventoryValuationService {
  /**
   * Calculate FIFO valuation for a product
   * @param {string} productId - Product ID
   * @param {string} facilityId - Facility ID
   * @returns {object} Valuation result with quantity, cost, and value
   */
  static async calculateFIFO(productId, facilityId) {
    try {
      // Get all batches for this product ordered by receipt date (oldest first)
      const batches = await db.InventoryBatch.findAll({
        where: {
          product_id: productId,
          facility_id: facilityId,
          status: "ACTIVE",
          quantity_on_hand: {
            [Op.gt]: 0,
          },
        },
        order: [["receipt_date", "ASC"]],
      });

      let totalQuantity = 0;
      let totalValue = 0;

      // Calculate weighted average from active batches
      batches.forEach((batch) => {
        totalQuantity += parseFloat(batch.quantity_on_hand);
        totalValue += parseFloat(batch.total_value);
      });

      const averageCost =
        totalQuantity > 0 ? totalValue / totalQuantity : 0;

      return {
        quantity_on_hand: totalQuantity,
        avg_unit_cost: averageCost,
        total_value: totalValue,
        valuation_method: "FIFO",
        facility_id: facilityId,
      };
    } catch (error) {
      console.error("Error calculating FIFO valuation:", error);
      throw error;
    }
  }

  /**
   * Calculate WAC (Weighted Average Cost) valuation for a product
   * @param {string} productId - Product ID
   * @param {string} facilityId - Facility ID
   * @returns {object} Valuation result with quantity, cost, and value
   */
  static async calculateWAC(productId, facilityId) {
    try {
      // Get all batches for this product
      const batches = await db.InventoryBatch.findAll({
        where: {
          product_id: productId,
          facility_id: facilityId,
          status: "ACTIVE",
          quantity_on_hand: {
            [Op.gt]: 0,
          },
        },
      });

      let totalQuantity = 0;
      let totalValue = 0;

      // Calculate weighted average from all active batches
      batches.forEach((batch) => {
        totalQuantity += parseFloat(batch.quantity_on_hand);
        totalValue += parseFloat(batch.total_value);
      });

      const averageCost =
        totalQuantity > 0 ? totalValue / totalQuantity : 0;

      return {
        quantity_on_hand: totalQuantity,
        avg_unit_cost: averageCost,
        total_value: totalValue,
        valuation_method: "WAC",
        facility_id: facilityId,
      };
    } catch (error) {
      console.error("Error calculating WAC valuation:", error);
      throw error;
    }
  }

  /**
   * Calculate SPECIFIC identification valuation for a product
   * @param {string} productId - Product ID
   * @param {string} facilityId - Facility ID
   * @param {string} batchId - Specific batch ID to value
   * @returns {object} Valuation result with quantity, cost, and value
   */
  static async calculateSpecific(productId, facilityId, batchId) {
    try {
      // Get specific batch
      const batch = await db.InventoryBatch.findOne({
        where: {
          id: batchId,
          product_id: productId,
          facility_id: facilityId,
          status: "ACTIVE",
          quantity_on_hand: {
            [Op.gt]: 0,
          },
        },
      });

      if (!batch) {
        throw new Error("Batch not found or inactive");
      }

      return {
        quantity_on_hand: parseFloat(batch.quantity_on_hand),
        avg_unit_cost: parseFloat(batch.unit_cost),
        total_value: parseFloat(batch.total_value),
        valuation_method: "SPECIFIC",
        facility_id: facilityId,
      };
    } catch (error) {
      console.error("Error calculating SPECIFIC valuation:", error);
      throw error;
    }
  }

  /**
   * Get current valuation for a product using the method stored in database
   * @param {string} productId - Product ID
   * @param {string} facilityId - Facility ID
   * @returns {object} Current valuation data
   */
  static async getCurrentValuation(productId, facilityId) {
    try {
      // Get existing valuation record
      let valuation = await db.InventoryValuation.findOne({
        where: {
          product_id: productId,
          facility_id: facilityId,
        },
      });

      // If no valuation exists, create default WAC valuation
      if (!valuation) {
        const wacValuation = await this.calculateWAC(productId, facilityId);
        valuation = await db.InventoryValuation.create({
          product_id: productId,
          ...wacValuation,
        });
      }

      return valuation;
    } catch (error) {
      console.error("Error getting current valuation:", error);
      throw error;
    }
  }

  /**
   * Update or create valuation record for a product
   * @param {string} productId - Product ID
   * @param {string} facilityId - Facility ID
   * @param {string} method - Valuation method (FIFO, WAC, SPECIFIC)
   * @param {object} batchInfo - Optional batch information for SPECIFIC method
   * @returns {object} Updated valuation record
   */
  static async updateValuation(
    productId,
    facilityId,
    method = "WAC",
    batchInfo = null
  ) {
    try {
      let valuationData;

      switch (method) {
        case "FIFO":
          valuationData = await this.calculateFIFO(productId, facilityId);
          break;
        case "SPECIFIC":
          if (!batchInfo || !batchInfo.batchId) {
            throw new Error("Batch ID required for SPECIFIC valuation method");
          }
          valuationData = await this.calculateSpecific(
            productId,
            facilityId,
            batchInfo.batchId
          );
          break;
        case "WAC":
        default:
          valuationData = await this.calculateWAC(productId, facilityId);
          break;
      }

      // Update or create valuation record
      const [valuation, created] = await db.InventoryValuation.findOrCreate({
        where: {
          product_id: productId,
          facility_id: facilityId,
        },
        defaults: {
          product_id: productId,
          ...valuationData,
        },
      });

      if (!created) {
        await valuation.update(valuationData);
      }

      return valuation;
    } catch (error) {
      console.error("Error updating valuation:", error);
      throw error;
    }
  }

  /**
   * Get detailed batch information for a product
   * @param {string} productId - Product ID
   * @param {string} facilityId - Facility ID
   * @returns {array} Array of batch information
   */
  static async getProductBatches(productId, facilityId) {
    try {
      const batches = await db.InventoryBatch.findAll({
        where: {
          product_id: productId,
          facility_id: facilityId,
        },
        order: [["receipt_date", "ASC"]],
        include: [
          {
            model: db.StoreEntry,
            as: "transactions",
            attributes: [
              "id",
              "qty_in",
              "qty_out",
              "cost_price",
              "transaction_type",
              "inserted_time",
            ],
          },
        ],
      });

      return batches;
    } catch (error) {
      console.error("Error getting product batches:", error);
      throw error;
    }
  }
}

module.exports = InventoryValuationService;