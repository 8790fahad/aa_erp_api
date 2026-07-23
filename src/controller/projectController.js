const db = require("../models");
const moment = require("moment");
const { Op } = require("sequelize");
const { getAndUpdateNumber } = require("../services/numberGen");

/**
 * Create a new project
 */
exports.createProject = async (req, res) => {
  const transaction = await db.sequelize.transaction();

  try {
    const {
      project_name,
      customer,
      customer_number,
      start_date,
      end_date,
      progress_status,
      notes,
      follow_up_status,
      facilityId,
      created_by,
    } = req.body;

    const userId = created_by || req.user?.id || null;

    // Validation
    if (!project_name || !facilityId || !customer) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: "project_name, facilityId, and customer are required",
      });
    }

    // Generate project number
    const code = await getAndUpdateNumber("proj", facilityId);
    console.log(code, "=====");
    const projectNo = `PROJ-${String(code).padStart(4, "0")}`;

    // Create project
    const project = await db.Project.create(
      {
        facilityId,
        project_number: projectNo,
        project_name,
        customer,
        customer_number: customer_number || null,
        start_date: start_date || null,
        end_date: end_date || null,
        progress_status: progress_status || "not-started",
        notes: notes || null,
        follow_up_status: follow_up_status || null,
        total_income: 0,
        total_cost: 0,
        status: "active",
        created_by: userId,
        created_at: new Date(),
        updated_at: new Date(),
      },
      { transaction },
    );

    await transaction.commit();

    return res.status(201).json({
      success: true,
      message: "Project created successfully",
      data: project,
    });
  } catch (error) {
    await transaction.rollback();
    console.error("CreateProject error:", error);
    return res.status(500).json({
      success: false,
      message: "Error creating project",
      error: error.message,
    });
  }
};

/**
 * Get all projects for a facility
 */
exports.getAllProjects = async (req, res) => {
  try {
    const {
      facilityId,
      status,
      progress_status,
      search,
      page = 1,
      limit = 50,
    } = req.query;

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

    // Add progress status filter if provided
    if (progress_status) {
      whereClause.progress_status = progress_status;
    }

    // Add search filter if provided
    if (search) {
      whereClause[Op.or] = [
        { project_name: { [Op.like]: `%${search}%` } },
        { project_number: { [Op.like]: `%${search}%` } },
        { customer: { [Op.like]: `%${search}%` } },
      ];
    }

    const { count, rows: projects } = await db.Project.findAndCountAll({
      where: whereClause,
      limit: parseInt(limit),
      offset: parseInt(offset),
      order: [["created_at", "DESC"]],
      attributes: {
        include: [
          [db.sequelize.literal("(total_income - total_cost)"), "profit"],
        ],
      },
    });

    res.json({
      success: true,
      message: "Projects retrieved successfully",
      data: projects,
    });
  } catch (error) {
    console.error("Get Projects Error:", error);
    res.status(500).json({
      success: false,
      message: "Error retrieving projects",
      error: error.message,
    });
  }
};

/**
 * Get a single project by id or project_number with documents
 */
exports.getProjectById = async (req, res) => {
  try {
    const { id, facilityId } = req.params;

    if (!id || !facilityId) {
      return res.status(400).json({
        success: false,
        message: "id and facilityId are required",
      });
    }

    // Try to find by id first, then by project_number
    const project = await db.Project.findOne({
      where: {
        facilityId,
        [Op.or]: [{ id: id }, { project_number: id }],
      },
    });

    if (!project) {
      return res.status(404).json({
        success: false,
        message: "Project not found",
      });
    }

    const project_number = project.project_number;

    // Get documents from memo_documents table where memo_id = project_number
    const [documents] = await db.sequelize.query(
      `SELECT
                memo_id,
                document_name,
                file_path,
                original_name,
                file_size,
                mime_type,
                created_at,
                transaction_id
            FROM memo_documents
            WHERE memo_id = :project_number
                AND facilityId = :facilityId
            ORDER BY created_at DESC`,
      {
        replacements: {
          project_number,
          facilityId,
        },
      },
    );

    // DUMMY DATA for Overview tab - Replace with actual values when ready
    const projectData = project.toJSON();
    if (!projectData.total_income) {
      projectData.total_income = 125000000.0; // Dummy income in Naira
    }
    if (!projectData.total_cost) {
      projectData.total_cost = 31225000.0; // Dummy cost in Naira
    }

    res.json({
      success: true,
      message: "Project retrieved successfully",
      data: {
        ...projectData,
        documents: documents || [],
      },
    });
  } catch (error) {
    console.error("Get Project Error:", error);
    res.status(500).json({
      success: false,
      message: "Error retrieving project",
      error: error.message,
    });
  }
};

/**
 * Update a project
 */
exports.updateProject = async (req, res) => {
  try {
    const { id, facilityId } = req.params;
    const {
      project_name,
      customer,
      customer_number,
      start_date,
      end_date,
      progress_status,
      notes,
      follow_up_status,
      status,
      total_income,
      total_cost,
    } = req.body;

    if (!id || !facilityId) {
      return res.status(400).json({
        success: false,
        message: "id and facilityId are required",
      });
    }

    // Find the project
    const project = await db.Project.findOne({
      where: {
        facilityId,
        [Op.or]: [{ id: id }, { project_number: id }],
      },
    });

    if (!project) {
      return res.status(404).json({
        success: false,
        message: "Project not found",
      });
    }

    // Update project
    const updateData = { updated_at: new Date() };
    if (project_name !== undefined) updateData.project_name = project_name;
    if (customer !== undefined) updateData.customer = customer;
    if (customer_number !== undefined)
      updateData.customer_number = customer_number;
    if (start_date !== undefined) updateData.start_date = start_date;
    if (end_date !== undefined) updateData.end_date = end_date;
    if (progress_status !== undefined)
      updateData.progress_status = progress_status;
    if (notes !== undefined) updateData.notes = notes;
    if (follow_up_status !== undefined)
      updateData.follow_up_status = follow_up_status;
    if (status !== undefined) updateData.status = status;
    if (total_income !== undefined) updateData.total_income = total_income;
    if (total_cost !== undefined) updateData.total_cost = total_cost;

    await project.update(updateData);

    res.json({
      success: true,
      message: "Project updated successfully",
      data: project,
    });
  } catch (error) {
    console.error("Update Project Error:", error);
    res.status(500).json({
      success: false,
      message: "Error updating project",
      error: error.message,
    });
  }
};

/**
 * Delete/Archive a project
 */
exports.deleteProject = async (req, res) => {
  try {
    const { id, facilityId } = req.params;
    const { permanent = false } = req.query;

    if (!id || !facilityId) {
      return res.status(400).json({
        success: false,
        message: "id and facilityId are required",
      });
    }

    const project = await db.Project.findOne({
      where: {
        facilityId,
        [Op.or]: [{ id: id }, { project_number: id }],
      },
    });

    if (!project) {
      return res.status(404).json({
        success: false,
        message: "Project not found",
      });
    }

    if (permanent === "true") {
      // Permanent delete
      await project.destroy();
      res.json({
        success: true,
        message: "Project deleted permanently",
      });
    } else {
      // Soft delete - change status to archived
      await project.update({ status: "archived", updated_at: new Date() });
      res.json({
        success: true,
        message: "Project archived successfully",
        data: project,
      });
    }
  } catch (error) {
    console.error("Delete Project Error:", error);
    res.status(500).json({
      success: false,
      message: "Error deleting project",
      error: error.message,
    });
  }
};

/**
 * Get project statistics
 */
exports.getProjectStats = async (req, res) => {
  try {
    const { facilityId } = req.query;

    if (!facilityId) {
      return res.status(400).json({
        success: false,
        message: "facilityId is required",
      });
    }

    const [
      totalProjects,
      activeProjects,
      completedProjects,
      inProgressProjects,
      totalIncome,
      totalCost,
    ] = await Promise.all([
      db.Project.count({ where: { facilityId } }),
      db.Project.count({ where: { facilityId, status: "active" } }),
      db.Project.count({
        where: { facilityId, progress_status: "completed" },
      }),
      db.Project.count({
        where: { facilityId, progress_status: "in-progress" },
      }),
      db.Project.sum("total_income", { where: { facilityId } }),
      db.Project.sum("total_cost", { where: { facilityId } }),
    ]);

    const totalProfit = (totalIncome || 0) - (totalCost || 0);

    res.json({
      success: true,
      message: "Project statistics retrieved successfully",
      data: {
        total: totalProjects,
        active: activeProjects,
        completed: completedProjects,
        inProgress: inProgressProjects,
        financial: {
          totalIncome: totalIncome || 0,
          totalCost: totalCost || 0,
          totalProfit,
        },
      },
    });
  } catch (error) {
    console.error("Get Project Stats Error:", error);
    res.status(500).json({
      success: false,
      message: "Error retrieving project statistics",
      error: error.message,
    });
  }
};

/**
 * Update project financials (income/cost)
 */
exports.updateProjectFinancials = async (req, res) => {
  try {
    const { id, facilityId } = req.params;
    const { income, cost } = req.body;

    if (!id || !facilityId) {
      return res.status(400).json({
        success: false,
        message: "id and facilityId are required",
      });
    }

    const project = await db.Project.findOne({
      where: {
        facilityId,
        [Op.or]: [{ id: id }, { project_number: id }],
      },
    });

    if (!project) {
      return res.status(404).json({
        success: false,
        message: "Project not found",
      });
    }

    const updateData = { updated_at: new Date() };

    if (income !== undefined) {
      updateData.total_income = parseFloat(income);
    }

    if (cost !== undefined) {
      updateData.total_cost = parseFloat(cost);
    }

    await project.update(updateData);

    res.json({
      success: true,
      message: "Project financials updated successfully",
      data: project,
    });
  } catch (error) {
    console.error("Update Project Financials Error:", error);
    res.status(500).json({
      success: false,
      message: "Error updating project financials",
      error: error.message,
    });
  }
};

/**
 * Upload documents for a project
 */
exports.uploadProjectDocuments = async (req, res) => {
  try {
    const { id, facilityId } = req.params;
    // Get document_names from FormData (req.body when using multipart/form-data)
    const document_names = req.body.document_names
      ? Array.isArray(req.body.document_names)
        ? req.body.document_names
        : [req.body.document_names]
      : [];

    if (!id || !facilityId) {
      return res.status(400).json({
        success: false,
        message: "id and facilityId are required",
      });
    }

    if (!req.files || req.files.length === 0) {
      return res.status(400).json({
        success: false,
        message: "No files uploaded",
      });
    }

    // Find the project to get project information
    const project = await db.Project.findOne({
      where: {
        facilityId,
        [Op.or]: [{ id: id }, { project_number: id }],
      },
    });

    if (!project) {
      return res.status(404).json({
        success: false,
        message: "Project not found",
      });
    }

    const project_number = project.project_number;
    const files = Array.isArray(req.files) ? req.files : [req.files];

    // Insert documents into memo_documents table using project_number as memo_id
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const customName = document_names[i] || file.originalname;

      await db.sequelize.query(
        `INSERT INTO memo_documents
                (memo_id, document_name, file_path, original_name, file_size, mime_type, facilityId)
                VALUES (:memo_id, :document_name, :file_path, :original_name, :file_size, :mime_type, :facilityId)`,
        {
          replacements: {
            memo_id: project_number,
            document_name: customName,
            file_path: file.filename,
            original_name: file.originalname,
            file_size: file.size,
            mime_type: file.mimetype,
            facilityId: facilityId,
          },
        },
      );
    }

    res.json({
      success: true,
      message: "Documents uploaded successfully",
      project_number,
    });
  } catch (error) {
    console.error("Upload Project Documents Error:", error);
    res.status(500).json({
      success: false,
      message: "Error uploading documents",
      error: error.message,
    });
  }
};

/**
 * Get project documents
 */
exports.getProjectDocuments = async (req, res) => {
  try {
    const { id, facilityId } = req.params;

    if (!id || !facilityId) {
      return res.status(400).json({
        success: false,
        message: "id and facilityId are required",
      });
    }

    // Find the project to get project_number
    const project = await db.Project.findOne({
      where: {
        facilityId,
        [Op.or]: [{ id: id }, { project_number: id }],
      },
    });

    if (!project) {
      return res.status(404).json({
        success: false,
        message: "Project not found",
      });
    }

    const project_number = project.project_number;

    // Get documents from memo_documents table where memo_id = project_number
    const [documents] = await db.sequelize.query(
      `SELECT
                transaction_id,
                memo_id,
                document_name,
                file_path,
                original_name,
                file_size,
                mime_type,
                created_at
            FROM memo_documents
            WHERE memo_id = :project_number
                AND facilityId = :facilityId
            ORDER BY created_at DESC`,
      {
        replacements: {
          project_number,
          facilityId,
        },
      },
    );

    res.json({
      success: true,
      message: "Documents retrieved successfully",
      documents: documents || [],
    });
  } catch (error) {
    console.error("Get Project Documents Error:", error);
    res.status(500).json({
      success: false,
      message: "Error retrieving documents",
      error: error.message,
    });
  }
};

/**
 * Delete a project document
 */
exports.deleteProjectDocument = async (req, res) => {
  try {
    const { id, facilityId, transactionId } = req.params;

    if (!id || !facilityId || !transactionId) {
      return res.status(400).json({
        success: false,
        message: "id, facilityId, and transactionId are required",
      });
    }

    // Find the project to verify it exists and get project_number
    const project = await db.Project.findOne({
      where: {
        facilityId,
        [Op.or]: [{ id: id }, { project_number: id }],
      },
    });

    if (!project) {
      return res.status(404).json({
        success: false,
        message: "Project not found",
      });
    }

    const project_number = project.project_number;

    // Delete the document using transaction_id and memo_id (project_number)
    await db.sequelize.query(
      `DELETE FROM memo_documents
            WHERE transaction_id = :transactionId
                AND memo_id = :project_number
                AND facilityId = :facilityId`,
      {
        replacements: {
          transactionId,
          project_number,
          facilityId,
        },
      },
    );

    res.json({
      success: true,
      message: "Document deleted successfully",
    });
  } catch (error) {
    console.error("Delete Project Document Error:", error);
    res.status(500).json({
      success: false,
      message: "Error deleting document",
      error: error.message,
    });
  }
};

/**
 * Get project transactions
 */
exports.getProjectTransactions = async (req, res) => {
  try {
    const { id, facilityId } = req.params;

    if (!id || !facilityId) {
      return res.status(400).json({
        success: false,
        message: "id and facilityId are required",
      });
    }

    // Find the project to get project_number
    const project = await db.Project.findOne({
      where: {
        facilityId,
        [Op.or]: [{ id: id }, { project_number: id }],
      },
    });

    if (!project) {
      return res.status(404).json({
        success: false,
        message: "Project not found",
      });
    }

    const projectId = project.id;

    // Get all invoices linked to this project (real data instead of dummy transactions)
    const invoices = await db.Invoice.findAll({
      where: {
        facility_id: facilityId,
        project_id: projectId,
      },
      order: [
        ["transaction_date", "ASC"],
        ["invoice_id", "ASC"],
      ],
    });

    // Map invoices into the transaction shape expected by the frontend
    const allTransactions = invoices.map((invoice) => {
      const amount = Number(invoice.amount || 0);
      const taxAmount = Number(invoice.tax_amount || 0);
      const discountAmount = Number(invoice.discount_amount || 0);

      return {
        id: invoice.invoice_id,
        invoice_number: invoice.invoice_ref,
        type: "invoice",
        customer_name: project.customer || null,
        vendor_name: null,
        employee_name: null,
        date: invoice.transaction_date,
        due_date: invoice.due_date,
        description: invoice.description,
        amount,
        // Basic subtotal = amount - VAT + discount (adjust when invoice structure evolves)
        subtotal: amount - taxAmount + discountAmount,
        tax: taxAmount,
        status: "posted", // TODO: wire to real invoice status when available
        work_hours: null,
        hourly_rate: null,
        created_at: invoice.created_at || invoice.transaction_date,
      };
    });

    res.json({
      success: true,
      message: "Transactions retrieved successfully",
      transactions: allTransactions,
    });
  } catch (error) {
    console.error("Get Project Transactions Error:", error);
    res.status(500).json({
      success: false,
      message: "Error retrieving transactions",
      error: error.message,
    });
  }
};

/**
 * Get project time activity
 */
exports.getProjectTimeActivity = async (req, res) => {
  try {
    const { id, facilityId } = req.params;

    if (!id || !facilityId) {
      return res.status(400).json({
        success: false,
        message: "id and facilityId are required",
      });
    }

    // Find the project to get project_number
    const project = await db.Project.findOne({
      where: {
        facilityId,
        [Op.or]: [{ id: id }, { project_number: id }],
      },
    });

    if (!project) {
      return res.status(404).json({
        success: false,
        message: "Project not found",
      });
    }

    const project_number = project.project_number;

    // DUMMY DATA - Replace with actual queries when ready
    const timeEntries = [
      {
        transaction_id: "TIME-001",
        employee_name: "John Doe",
        employee_id: "EMP-001",
        date: new Date("2024-01-16"),
        work_hours: 8.0,
        hourly_rate: 75000.0, // 75,000 Naira per hour
        total_cost: 600000.0, // 600K Naira
        description: "Project planning and requirements gathering",
        invoice_number: "INV-2024-001",
        created_at: new Date("2024-01-16"),
      },
      {
        transaction_id: "TIME-002",
        employee_name: "Jane Smith",
        employee_id: "EMP-002",
        date: new Date("2024-01-17"),
        work_hours: 6.5,
        hourly_rate: 85000.0, // 85,000 Naira per hour
        total_cost: 552500.0, // 552.5K Naira
        description: "UI/UX design work",
        invoice_number: "INV-2024-001",
        created_at: new Date("2024-01-17"),
      },
      {
        transaction_id: "TIME-003",
        employee_name: "John Doe",
        employee_id: "EMP-001",
        date: new Date("2024-02-21"),
        work_hours: 7.0,
        hourly_rate: 75000.0,
        total_cost: 525000.0, // 525K Naira
        description: "Backend development",
        invoice_number: "INV-2024-002",
        created_at: new Date("2024-02-21"),
      },
      {
        transaction_id: "TIME-004",
        employee_name: "Mike Johnson",
        employee_id: "EMP-003",
        date: new Date("2024-02-22"),
        work_hours: 8.0,
        hourly_rate: 90000.0, // 90,000 Naira per hour
        total_cost: 720000.0, // 720K Naira
        description: "Frontend development and integration",
        invoice_number: "INV-2024-002",
        created_at: new Date("2024-02-22"),
      },
      {
        transaction_id: "TIME-005",
        employee_name: "Jane Smith",
        employee_id: "EMP-002",
        date: new Date("2024-02-25"),
        work_hours: 5.0,
        hourly_rate: 85000.0,
        total_cost: 425000.0, // 425K Naira
        description: "Testing and QA",
        invoice_number: "INV-2024-002",
        created_at: new Date("2024-02-25"),
      },
      {
        transaction_id: "TIME-006",
        employee_name: "John Doe",
        employee_id: "EMP-001",
        date: new Date("2024-03-01"),
        work_hours: 4.0,
        hourly_rate: 75000.0,
        total_cost: 300000.0, // 300K Naira
        description: "Bug fixes and optimization",
        invoice_number: null,
        created_at: new Date("2024-03-01"),
      },
    ];

    // Calculate totals
    const totalHours = timeEntries.reduce(
      (sum, entry) => sum + parseFloat(entry.work_hours || 0),
      0,
    );
    const totalCost = timeEntries.reduce(
      (sum, entry) => sum + parseFloat(entry.total_cost || 0),
      0,
    );

    res.json({
      success: true,
      message: "Time activity retrieved successfully",
      timeEntries: timeEntries.map((entry) => ({
        id: entry.transaction_id,
        employee_name: entry.employee_name,
        employee_id: entry.employee_id,
        date: entry.date,
        hours: parseFloat(entry.work_hours || 0),
        hourly_rate: parseFloat(entry.hourly_rate || 0),
        total_cost: parseFloat(entry.total_cost || 0),
        description: entry.description,
        invoice_number: entry.invoice_number,
        created_at: entry.created_at,
      })),
      summary: {
        total_hours: totalHours,
        total_cost: totalCost,
        entry_count: timeEntries.length,
      },
    });
  } catch (error) {
    console.error("Get Project Time Activity Error:", error);
    res.status(500).json({
      success: false,
      message: "Error retrieving time activity",
      error: error.message,
    });
  }
};

/**
 * Get project reports data
 */
exports.getProjectReports = async (req, res) => {
  try {
    const { id, facilityId } = req.params;

    if (!id || !facilityId) {
      return res.status(400).json({
        success: false,
        message: "id and facilityId are required",
      });
    }

    // Find the project
    const project = await db.Project.findOne({
      where: {
        facilityId,
        [Op.or]: [{ id: id }, { project_number: id }],
      },
    });

    if (!project) {
      return res.status(404).json({
        success: false,
        message: "Project not found",
      });
    }

    const project_number = project.project_number;
    // DUMMY DATA - Use actual project values or dummy values
    const income = parseFloat(project.total_income || 125000000.0); // 125M Naira
    const costs = parseFloat(project.total_cost || 31225000.0); // 31.225M Naira
    const profit = income - costs;
    const profitMargin = income > 0 ? ((profit / income) * 100).toFixed(2) : 0;

    // DUMMY DATA - Replace with actual queries when ready
    const timeEntries = [
      {
        employee_name: "John Doe",
        employee_id: "EMP-001",
        total_hours: 19.0,
        avg_rate: 75000.0, // 75K Naira per hour
        total_cost: 1425000.0, // 1.425M Naira
      },
      {
        employee_name: "Mike Johnson",
        employee_id: "EMP-003",
        total_hours: 8.0,
        avg_rate: 90000.0, // 90K Naira per hour
        total_cost: 720000.0, // 720K Naira
      },
      {
        employee_name: "Jane Smith",
        employee_id: "EMP-002",
        total_hours: 11.5,
        avg_rate: 85000.0, // 85K Naira per hour
        total_cost: 977500.0, // 977.5K Naira
      },
    ];

    // DUMMY DATA - Replace with actual queries when ready
    const unbilledTransactions = [
      {
        count: 2,
        total_amount: -2750000.0, // -2.75M Naira
      },
    ];

    // DUMMY DATA - Replace with actual queries when ready
    const unbilledTime = [
      {
        count: 1,
        total_hours: 4.0,
        total_cost: 300000.0, // 300K Naira
      },
    ];

    res.json({
      success: true,
      message: "Project reports retrieved successfully",
      reports: {
        profitability: {
          income,
          costs,
          profit,
          profitMargin: parseFloat(profitMargin),
        },
        timeCostByEmployee: timeEntries.map((entry) => ({
          employee_name: entry.employee_name,
          employee_id: entry.employee_id,
          total_hours: parseFloat(entry.total_hours || 0),
          avg_rate: parseFloat(entry.avg_rate || 0),
          total_cost: parseFloat(entry.total_cost || 0),
        })),
        unbilled: {
          transactions: {
            count: parseInt(unbilledTransactions[0]?.count || 0),
            total_amount: parseFloat(
              unbilledTransactions[0]?.total_amount || 0,
            ),
          },
          time: {
            count: parseInt(unbilledTime[0]?.count || 0),
            total_hours: parseFloat(unbilledTime[0]?.total_hours || 0),
            total_cost: parseFloat(unbilledTime[0]?.total_cost || 0),
          },
        },
      },
    });
  } catch (error) {
    console.error("Get Project Reports Error:", error);
    res.status(500).json({
      success: false,
      message: "Error retrieving project reports",
      error: error.message,
    });
  }
};
