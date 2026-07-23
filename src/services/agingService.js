"use strict";
const db = require("../models");
const { Op } = require("sequelize");

function bucketDays(days) {
  if (days <= 0) return "current";
  if (days <= 30) return "1-30";
  if (days <= 60) return "31-60";
  if (days <= 90) return "61-90";
  return "90+";
}

async function arAging({ facilityId, arControlAccountId, asOfDate }) {
  const date = new Date(asOfDate || new Date());
  // Fetch all posted, locked lines for AR control with partyType=customer
  const rows = await db.GLJournalLine.findAll({
    include: [
      {
        model: db.GLJournalBatch,
        as: "batch",
        where: { facilityId, locked: true, status: "posted" },
        attributes: ["docDate"],
      },
    ],
    where: {
      accountId: arControlAccountId,
      partyType: "customer",
    },
  });

  const map = new Map();
  for (const r of rows) {
    const key = r.partyId || "unknown";
    const docDate = new Date(r.batch.docDate);
    const days = Math.floor((date - docDate) / (1000 * 3600 * 24));
    const bucket = bucketDays(days);
    const amount = Number(r.debit || 0) - Number(r.credit || 0);
    if (!map.has(key)) {
      map.set(key, { partyId: key, current: 0, "1-30": 0, "31-60": 0, "61-90": 0, "90+": 0, total: 0 });
    }
    const agg = map.get(key);
    agg[bucket] += amount;
    agg.total += amount;
  }
  return Array.from(map.values());
}

async function apAging({ facilityId, apControlAccountId, asOfDate }) {
  const date = new Date(asOfDate || new Date());
  const rows = await db.GLJournalLine.findAll({
    include: [
      {
        model: db.GLJournalBatch,
        as: "batch",
        where: { facilityId, locked: true, status: "posted" },
        attributes: ["docDate"],
      },
    ],
    where: {
      accountId: apControlAccountId,
      partyType: "vendor",
    },
  });

  const map = new Map();
  for (const r of rows) {
    const key = r.partyId || "unknown";
    const docDate = new Date(r.batch.docDate);
    const days = Math.floor((date - docDate) / (1000 * 3600 * 24));
    const bucket = bucketDays(days);
    const amount = Number(r.credit || 0) - Number(r.debit || 0); // AP credit balance
    if (!map.has(key)) {
      map.set(key, { partyId: key, current: 0, "1-30": 0, "31-60": 0, "61-90": 0, "90+": 0, total: 0 });
    }
    const agg = map.get(key);
    agg[bucket] += amount;
    agg.total += amount;
  }
  return Array.from(map.values());
}

async function reconcileControl({ facilityId, controlAccountId, partyType }) {
  // Sum by accountId for all posted locked lines
  const rows = await db.GLJournalLine.findAll({
    include: [
      {
        model: db.GLJournalBatch,
        as: "batch",
        where: { facilityId, locked: true, status: "posted" },
        attributes: [],
      },
    ],
    where: { accountId: controlAccountId, partyType },
    attributes: ["debit", "credit", "partyId"],
  });

  const detail = new Map();
  let controlBalance = 0;
  for (const r of rows) {
    const amt = Number(r.debit || 0) - Number(r.credit || 0);
    controlBalance += amt;
    const key = r.partyId || "unknown";
    detail.set(key, (detail.get(key) || 0) + amt);
  }
  return { controlBalance, detail: Array.from(detail.entries()).map(([partyId, balance]) => ({ partyId, balance })) };
}

module.exports = { arAging, apAging, reconcileControl };








