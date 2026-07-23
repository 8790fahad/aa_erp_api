const db = require("../models");

const Department = db.Department;
const User = db.User;

// Create new department
const createDepartment = async (req, res) => {
  try {
    const {
      departmentName,
      facilityId,
      departmentCode,
      description,
      headOfDepartment,
      type = "others",
    } = req.body;
    // Validate required field
    if (!departmentName) {
      return res.status(400).json({ message: "Department name is required" });
    }

    // Create department
    let depart = await Department.create({
      departmentName,
      departmentCode,
      description,
      headOfDepartment,
      facilityId,
      type: type === "main" ? "main" : "others",
    });
    let id = depart.dataValues.id;
    if (id) {
      db.sequelize.query(
        "update membership set departmentId = :departmentId where user_id = :headOfDepartment and business_id = :facilityId",
        {
          replacements: {
            departmentId: id,
            headOfDepartment: headOfDepartment,
            facilityId: facilityId,
          },
        }
      );
    }
    return res.status(201).json({
      message: "Department created successfully",
      success: true,
    });
  } catch (error) {
    console.error("Error creating department:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};
const updateDepartment = async (req, res) => {
  const { name, code, description, head, id } = req.body;
  if (!id) {
    return res.status(400).json({
      message: "'id' is required to update the department",
      success: false,
    });
  }

  try {
    const department = await Department.findByPk(id);

    if (!department) {
      return res.status(404).json({
        message: "Department not found",
        success: false,
      });
    }

    // Check for changes
    const isUnchanged =
      department.name === name &&
      department.code === code &&
      department.description === description &&
      department.head === head;

    if (isUnchanged) {
      return res.status(200).json({
        message: "No changes detected",
        success: true,
      });
    }

    // Update only if something changed
    await Department.update(
      { name, code, description, head },
      { where: { id } }
    );

    return res.status(200).json({
      message: "Department updated successfully",
      success: true,
    });

  } catch (error) {
    console.error("Error updating department:", error);
    return res.status(500).json({
      message: "Internal server error",
      success: false,
    });
  }
};

const updateDepartmentStatus = async (req, res) => {
  const { departmentId, status } = req.body;
  console.log("Updating department status:", { departmentId, status });
  // Validate required fields
  if (!departmentId || !status) {
    return res.status(400).json({
      message: "Both 'departmentId' and 'status' are required",
      success: false,
    });
  }
  try {
    // Update department status
    await Department.update(
      { status: status },
      { where: { id: departmentId } }
    );
    return res.status(200).json({
      message: "Department status updated successfully",
      success: true,
    });
  } catch (error) {
    console.error("Error updating department status:", error);
    throw error; // Re-throw the error for further handling
  }
};
const addDepartmentMember = async (req, res) => {
  try {
    const { userId, departmentId, facilityId } = req.body;

    // Validate required fields
    if (!userId || !departmentId) {
      return res.status(400).json({
        message: "Both 'userId' and 'departmentId' are required",
        success: false,
      });
    }

    // Check if user exists
    await db.sequelize.query(
      "update membership set departmentId = :departmentId where user_id = :userId and business_id=:facilityId",
      {
        replacements: {
          departmentId: departmentId,
          userId: userId,
          facilityId,
        },
      }
    );

    return res.status(200).json({
      message: "User added to department successfully",
      success: true,
    });
  } catch (error) {
    console.error("Error adding user to department:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};
//FOR FETCHING depts
const getDepartment = async (req, res) => {
  try {
    const { facilityId } = req.query; // or req.params, depending on route

    if (!facilityId) {
      return res.status(400).json({ message: "facilityId is required" });
    }
    const departments = await db.sequelize.query(
      `
    SELECT
    d.id,
    d.departmentName,
    d.description,
    d.headOfDepartment,
    hod.firstname AS headFirstname,
    hod.lastname AS headLastname,
    d.departmentCode,
    d.facilityId,
    d.status,
    COUNT(m.user_id) AS staffCount
FROM
    Departments d
LEFT JOIN
    membership m ON m.departmentId = d.id and m.business_id=d.facilityId
LEFT JOIN
    users hod ON hod.id = d.headOfDepartment and d.headOfDepartment=hod.facilityId
WHERE
    d.facilityId = :facilityId
    AND d.status = 'active'
GROUP BY
    d.id, d.departmentName, d.description, d.headOfDepartment,
    hod.firstname, hod.lastname, d.departmentCode, d.facilityId, d.status;
`,
      {
        replacements: { facilityId },
        type: db.Sequelize.QueryTypes.SELECT,
      }
    );
    return res.status(200).json({
      message: "Departments fetched successfully",
      results: departments,
      success: true,
    });
  } catch (error) {
    console.error("Error fetching departments:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};
const getUserWithDepartment = async (req, res) => {
  try {
    const { userId } = req.query;

    if (!userId) {
      return res.status(400).json({
        message: "'userId' is required",
        success: false,
      });
    }

    const user = await db.sequelize.query(
      `
      SELECT
        CONCAT(u.firstname, ' ', u.lastname) AS fullName,
        d.departmentName,
        u.role
      FROM
        users u
      JOIN
        Departments d ON u.departmentId = d.id
      WHERE
        u.id = :userId;
      `,
      {
        replacements: { userId },
        type: db.Sequelize.QueryTypes.SELECT,
      }
    );

    if (!user || user.length === 0) {
      return res.status(404).json({
        message: "User not found",
        success: false,
      });
    }

    return res.status(200).json({
      message: "User fetched successfully",
      result: user[0], // return single user
      success: true,
    });
  } catch (error) {
    console.error("Error fetching user with department:", error);
    return res.status(500).json({
      message: "Internal server error",
      success: false,
    });
  }
};

const getUsersInDepartment = async (req, res) => {
  try {
    const { facilityId, departmentId } = req.params;

    if (!facilityId || !departmentId) {
      return res.status(400).json({
        message: "Both 'facilityId' and 'departmentId' are required",
        success: false,
      });
    }

    const users = await db.sequelize.query(
      `
      SELECT
    u.id AS userId,
    u.firstname,
    u.lastname,
    u.email,
    u.status,
    u.role,
    m.departmentId,
    d.departmentName,
    d.facilityId,
    CASE WHEN d.headOfDepartment = u.id THEN TRUE ELSE FALSE END AS isHead
FROM
    users u
JOIN
    membership m ON m.user_id = u.id and m.business_id=u.facilityId
JOIN
    Departments d ON m.departmentId = d.id and d.facilityId=u.facilityId
WHERE
    d.facilityId = :facilityId
    AND d.id = :departmentId;
      `,
      {
        replacements: { facilityId, departmentId },
        type: db.Sequelize.QueryTypes.SELECT,
      }
    );
    console.log(users);
    return res.status(200).json({
      message: "Users in department fetched successfully",
      results: users,
      success: true,
    });
  } catch (error) {
    console.error("Error fetching users in department:", error);
    return res.status(500).json({
      message: "Internal server error",
      success: false,
    });
  }
};

//for deleting department
const deleteDepartment = async (req, res) => {
  try {
    const { id } = req.params;

    //check if department exist
    const department = await department.findByPk(id);
    if (!department) {
      return res.status(404).json({ message: "Department not found" });
    }
    //delete department
    await department.destroy();
    return res.status(200).json({ message: "Department deleted successfully" });
  } catch (error) {
    console.error("Error deleting depatment:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};
module.exports = {
  getUsersInDepartment,
  createDepartment,
  getDepartment,
  deleteDepartment,
  addDepartmentMember,
  updateDepartmentStatus,
  updateDepartment,
  getUserWithDepartment
};
