// Import project controller
const {
    createProject,
    getAllProjects,
    getProjectById,
    updateProject,
    deleteProject,
    getProjectStats,
    updateProjectFinancials,
    uploadProjectDocuments,
    getProjectDocuments,
    deleteProjectDocument,
    getProjectTransactions,
    getProjectTimeActivity,
    getProjectReports,
} = require("../controller/projectController");

// Import multer for file uploads
const upload = require("../config/new_multer");

module.exports = (app) => {
    // ============================================
    // PROJECT CRUD OPERATIONS
    // ============================================

    // Create a new project
    app.post("/api/projects", createProject);

    // Get all projects (with pagination, search, filtering)
    app.get("/api/projects", getAllProjects);

    // Get project statistics
    app.get("/api/projects/stats", getProjectStats);

    // Get a single project by ID or project_number
    app.get("/api/projects/:facilityId/:id", getProjectById);

    // Update a project
    app.put("/api/projects/:facilityId/:id", updateProject);

    // Update project financials (income/cost)
    app.put("/api/projects/:facilityId/:id/financials", updateProjectFinancials);

    // Delete or archive a project
    app.delete("/api/projects/:facilityId/:id", deleteProject);

    // ============================================
    // PROJECT DOCUMENT OPERATIONS
    // ============================================

    // Upload documents for a project
    app.post(
        "/api/projects/:facilityId/:id/documents",
        upload.array("files", 10),
        uploadProjectDocuments
    );

    // Get project documents
    app.get("/api/projects/:facilityId/:id/documents", getProjectDocuments);

    // Delete a project document
    app.delete(
        "/api/projects/:facilityId/:id/documents/:transactionId",
        deleteProjectDocument
    );

    // ============================================
    // PROJECT DATA OPERATIONS
    // ============================================

    // Get project transactions
    app.get("/api/projects/:facilityId/:id/transactions", getProjectTransactions);

    // Get project time activity
    app.get("/api/projects/:facilityId/:id/time-activity", getProjectTimeActivity);

    // Get project reports
    app.get("/api/projects/:facilityId/:id/reports", getProjectReports);
};
