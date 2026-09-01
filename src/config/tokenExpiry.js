"use strict";

/** Password-reset tokens. Keep this longer than typical email-client delay. */
const RESET_TOKEN_TTL_MINUTES = 60;

function mysqlAddMinutesLiteral(sequelize, minutes = RESET_TOKEN_TTL_MINUTES) {
  const n = Math.max(1, parseInt(minutes, 10) || RESET_TOKEN_TTL_MINUTES);
  return sequelize.literal(`DATE_ADD(NOW(), INTERVAL ${n} MINUTE)`);
}

/**
 * Compare verificationExpires against MySQL NOW() so UTC vs Africa/Lagos
 * DATETIME skew cannot mark a fresh token as already expired.
 */
async function isMysqlVerificationExpired(sequelize, user) {
  if (!user?.id) return true;
  const rows = await sequelize.query(
    `SELECT CASE
       WHEN verificationExpires IS NULL THEN 0
       WHEN verificationExpires > NOW() THEN 0
       ELSE 1
     END AS expired
     FROM users
     WHERE id = :id AND facilityId = :facilityId
     LIMIT 1`,
    {
      replacements: { id: user.id, facilityId: user.facilityId },
      type: sequelize.QueryTypes.SELECT,
    },
  );
  return Number(rows[0]?.expired) === 1;
}

module.exports = {
  RESET_TOKEN_TTL_MINUTES,
  mysqlAddMinutesLiteral,
  isMysqlVerificationExpired,
};
