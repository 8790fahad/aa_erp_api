const {
    createTeam,
    getTeams,
    deleteTeam,
    getUsersInTeam,
    addTeamMember,
    updateTeamStatus,
    updateTeam
  } = require("../controller/team");
  
  module.exports = (app) => {
    app.post("/api/add/team", createTeam);
    app.get("/api/get/team", getTeams);
    app.get("/api/get/team/members/:facilityId/:teamId", getUsersInTeam);
    app.delete("/api/team/:id", deleteTeam);
    app.post("/api/add/team/member", addTeamMember);
    app.post("/api/update/team/status", updateTeamStatus);
    app.post("/api/update/team/by-id", updateTeam);
  };
  