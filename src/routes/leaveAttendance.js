module.exports = (app) => {
  const leaveAttendance = require("../controller/leaveAttendance");

  // Leave attendance routes
  app.post(
    "/api/hr/attendance/leave-attendance",
    leaveAttendance.recordLeaveAttendance
  );
  app.get(
    "/api/hr/attendance/leave-attendance",
    leaveAttendance.getLeaveAttendance
  );
};

