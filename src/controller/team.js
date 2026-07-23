const db = require("../models");
const Team = db.Team;
const User = db.User;

// Create new Team
const createTeam = async (req, res) => {
  try {
    const {
      teamName,
      facilityId,
      team_id,
      description,
      headOfTeam,
    } = req.body;

    if (!teamName) {
      return res.status(400).json({ message: "Team name is required" });
    }

    let team = await Team.create({
      teamName,
      team_id,
      description,
      headOfTeam,
      facilityId,
    });

    const id = team.dataValues.id;

    if (id && headOfTeam) {
      await db.sequelize.query(
        "UPDATE users SET teamId = :teamId WHERE id = :headOfTeam",
        {
          replacements: {
            teamId: id,
            headOfTeam,
          },
        }
      );
    }

    return res.status(201).json({
      message: "Team created successfully",
      success: true,
    });
  } catch (error) {
    console.error("Error creating team:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// Update team
const updateTeam = async (req, res) => {
  const { teamName, team_id, description, headOfTeam, id } = req.body;

  if (!id) {
    return res.status(400).json({
      message: "'id' is required to update the team",
      success: false,
    });
  }

  try {
    const team = await Team.findByPk(id);

    if (!team) {
      return res.status(404).json({
        message: "Team not found",
        success: false,
      });
    }

    const isUnchanged =
      team.teamName === teamName &&
      team.team_id === team_id &&
      team.description === description &&
      team.headOfTeam === headOfTeam;

    if (isUnchanged) {
      return res.status(200).json({
        message: "No changes detected",
        success: true,
      });
    }

    await Team.update(
      { teamName, team_id, description, headOfTeam },
      { where: { id } }
    );

    return res.status(200).json({
      message: "Team updated successfully",
      success: true,
    });
  } catch (error) {
    console.error("Error updating team:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// Update team status
const updateTeamStatus = async (req, res) => {
  const { teamId, status } = req.body;

  if (!teamId || !status) {
    return res.status(400).json({
      message: "'teamId' and 'status' are required",
      success: false,
    });
  }

  try {
    await Team.update({ status }, { where: { id: teamId } });

    return res.status(200).json({
      message: "Team status updated successfully",
      success: true,
    });
  } catch (error) {
    console.error("Error updating team status:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// Add member to team
const addTeamMember = async (req, res) => {
  try {
    const { userId, teamId, facilityId } = req.body;

    if (!userId || !teamId) {
      return res.status(400).json({
        message: "'userId' and 'teamId' are required",
        success: false,
      });
    }

    await db.sequelize.query(
      "UPDATE users SET teamId = :teamId WHERE id = :userId AND facilityId = :facilityId",
      {
        replacements: { teamId, userId, facilityId },
      }
    );

    return res.status(200).json({
      message: "User added to team successfully",
      success: true,
    });
  } catch (error) {
    console.error("Error adding user to team:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// Get all teams for a facility
const getTeams = async (req, res) => {
  try {
    const { facilityId } = req.query;

    if (!facilityId) {
      return res.status(400).json({ message: "facilityId is required" });
    }

    const teams = await db.sequelize.query(
      `
      SELECT
        t.id,
        t.teamName,
        t.team_id,
        t.description,
        t.headOfTeam,
        hod.firstname AS headFirstname,
        hod.lastname AS headLastname,
        t.facilityId,
        t.status,
        COUNT(u.id) AS memberCount
      FROM
        Teams t
      LEFT JOIN
        users u ON u.teamId = t.id AND u.facilityId = t.facilityId
      LEFT JOIN
        users hod ON hod.id = t.headOfTeam AND hod.facilityId = t.facilityId
      WHERE
        t.facilityId = :facilityId
      GROUP BY
        t.id, t.teamName, t.team_id, t.description, t.headOfTeam,
        hod.firstname, hod.lastname, t.facilityId, t.status
      `,
      {
        replacements: { facilityId },
        type: db.Sequelize.QueryTypes.SELECT,
      }
    );

    return res.status(200).json({
      message: "Teams fetched successfully",
      results: teams,
      success: true,
    });
  } catch (error) {
    console.error("Error fetching teams:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// Get users in a team
const getUsersInTeam = async (req, res) => {
  try {
    const { facilityId, teamId } = req.params;

    if (!facilityId || !teamId) {
      return res.status(400).json({
        message: "'facilityId' and 'teamId' are required",
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
        u.teamId,
        t.teamName,
        t.facilityId,
        CASE WHEN t.headOfTeam = u.id THEN TRUE ELSE FALSE END AS isHead
      FROM
        users u
      JOIN
        Teams t ON u.teamId = t.id
      WHERE
        t.facilityId = :facilityId AND t.id = :teamId
      `,
      {
        replacements: { facilityId, teamId },
        type: db.Sequelize.QueryTypes.SELECT,
      }
    );

    return res.status(200).json({
      message: "Users in team fetched successfully",
      results: users,
      success: true,
    });
  } catch (error) {
    console.error("Error fetching users in team:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// Delete a team
const deleteTeam = async (req, res) => {
  try {
    const { id } = req.params;

    const team = await Team.findByPk(id);

    if (!team) {
      return res.status(404).json({ message: "Team not found" });
    }

    await team.destroy();

    return res.status(200).json({ message: "Team deleted successfully" });
  } catch (error) {
    console.error("Error deleting team:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

module.exports = {
  createTeam,
  updateTeam,
  updateTeamStatus,
  addTeamMember,
  getTeams,
  getUsersInTeam,
  deleteTeam,
};
