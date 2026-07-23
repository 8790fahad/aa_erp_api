"use strict";
const db = require("../models");
const { Sequelize } = require("sequelize");

async function trialBalance({ facilityId, periodId }) {
  const rows = await db.GLJournalLine.findAll({
    include: [
      {
        model: db.GLJournalBatch,
        as: "batch",
        where: { facilityId, status: "posted", locked: true, periodId },
        attributes: [],
      },
    ],
    attributes: [
      "accountId",
      [Sequelize.fn("SUM", Sequelize.col("debit")), "debit"],
      [Sequelize.fn("SUM", Sequelize.col("credit")), "credit"],
    ],
    group: ["GLJournalLine.accountId"],
    raw: true,
  });
  return rows.map((r) => ({
    accountId: r.accountId,
    debit: Number(r.debit || 0),
    credit: Number(r.credit || 0),
    balance: Number(r.debit || 0) - Number(r.credit || 0),
  }));
}

module.exports = { trialBalance };








