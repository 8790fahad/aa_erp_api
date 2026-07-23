const express = require("express");
const router = express.Router();
const projectController = require("../controller/projectController");

/**
 * @route   POST /api/projects
 * @desc    Create a new project
 * @access  Private
 */
router.post("/", projectController.createProject);

/**
 * @route   GET /api/projects
 * @desc    Get all projects (with pagination, search, and filtering)
 * @query   facilityId, status, progress_status, search, page, limit
 * @access  Private
 */
router.get("/", projectController.getAllProjects);

/**
 * @route   GET /api/projects/stats
 * @desc    Get project statistics
 * @query   facilityId
 * @access  Private
 */
router.get("/stats", projectController.getProjectStats);

/**
 * @route   GET /api/projects/:facilityId/:id
 * @desc    Get a single project by ID or project_number
 * @access  Private
 */
router.get("/:facilityId/:id", projectController.getProjectById);

/**
 * @route   PUT /api/projects/:facilityId/:id
 * @desc    Update a project
 * @access  Private
 */
router.put("/:facilityId/:id", projectController.updateProject);

/**
 * @route   PUT /api/projects/:facilityId/:id/financials
 * @desc    Update project financials (income/cost)
 * @access  Private
 */
router.put("/:facilityId/:id/financials", projectController.updateProjectFinancials);

/**
 * @route   DELETE /api/projects/:facilityId/:id
 * @desc    Delete or archive a project
 * @query   permanent (true/false)
 * @access  Private
 */
router.delete("/:facilityId/:id", projectController.deleteProject);

module.exports = router;
