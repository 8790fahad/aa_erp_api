"use strict";
module.exports = (sequelize, DataTypes) => {
  const Team = sequelize.define(
    "Team",
    {
      teamName: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      team_id: DataTypes.STRING,
      facilityId: DataTypes.STRING,
      description: DataTypes.TEXT,
      status: {
        type: DataTypes.ENUM("active", "inactive"),
        defaultValue: "active",
      },
      headOfTeam: {
        type: DataTypes.UUID,
        allowNull: true,
      },
      user_id: {
        type: DataTypes.STRING(50),
        allowNull: true,
      },
    },
    {
      tableName: "Teams",
      freezeTableName: true,
    },
  );

  // team.associate = (models) => {
  //   team.hasMany(models.users, {
  //     foreignKey: "teamId",
  //     as: "members",
  //   });

  //   team.belongsTo(models.users, {
  //     foreignKey: "headOfteam",
  //     as: "head",
  //   });
  // };

  return Team;
};
