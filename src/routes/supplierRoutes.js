const express = require("express");
const router = express.Router();
const supplierController = require("../controller/supplierController");

/**
 * @route   POST /api/suppliers
 * @desc    Create a new supplier
 * @access  Private
 */
router.post("/", supplierController.createSupplier);

/**
 * @route   POST /api/suppliers/bulk
 * @desc    Create multiple suppliers at once
 * @access  Private
 */
router.post("/bulk", supplierController.bulkCreateSuppliers);

/**
 * @route   GET /api/suppliers
 * @desc    Get all suppliers (with pagination, search, and filtering)
 * @query   facilityId, status, search, page, limit
 * @access  Private
 */
router.get("/", supplierController.getAllSuppliers);

/**
 * @route   GET /api/suppliers/stats
 * @desc    Get supplier statistics
 * @query   facilityId
 * @access  Private
 */
router.get("/stats", supplierController.getSupplierStats);

/**
 * @route   GET /api/suppliers/:facilityId/:supplier_number
 * @desc    Get a single supplier by ID
 * @access  Private
 */
router.get("/:facilityId/:supplier_number", supplierController.getSupplierById);

/**
 * @route   PUT /api/suppliers/:facilityId/:supplier_number
 * @desc    Update a supplier
 * @access  Private
 */
router.put("/:facilityId/:supplier_number", supplierController.updateSupplier);

/**
 * @route   DELETE /api/suppliers/:facilityId/:supplier_number
 * @desc    Delete or deactivate a supplier
 * @query   permanent (true/false)
 * @access  Private
 */
router.delete("/:facilityId/:supplier_number", supplierController.deleteSupplier);

module.exports = router;















