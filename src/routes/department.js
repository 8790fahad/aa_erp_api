// routes/departmentRoutes.js
//import { createDepartment } from '../controller/department';
const {
  createDepartment,
  getDepartment,
  deleteDepartment,
  getUsersInDepartment,
  addDepartmentMember,
  updateDepartmentStatus,
  updateDepartment,
  getUserWithDepartment
} = require("../controller/department");
module.exports = (app) => {
  app.post("/api/add/department", createDepartment);
  app.get("/api/get/department", getDepartment);
  app.get("/api/get/department/members/:facilityId/:departmentId", getUsersInDepartment);
  app.delete("/api/department/:id", deleteDepartment);
  app.post("/api/add/department/members/by-id",addDepartmentMember)
  app.post("/api/update/department/status",updateDepartmentStatus);
  app.post("/api/update/department/by-id", updateDepartment);
  app.get("/api/get/user/with/department", getUserWithDepartment);
};
