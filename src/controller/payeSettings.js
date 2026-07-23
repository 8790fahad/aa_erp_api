const db = require("../models");
const { v4: uuidv4 } = require("uuid");
const {
  DEFAULT_PAYE_SETTINGS_2026,
  DEFAULT_TAX_BANDS_2026,
  computePAYE,
  normalizePayeSettings,
  normalizePayeBase,
  parseTaxBands,
} = require("../utils/paye2026");

function settingsToPlain(record) {
  if (!record) return null;
  const row = record.toJSON ? record.toJSON() : record;
  const plain = normalizePayeSettings({
    id: row.id,
    facilityId: row.facilityId,
    assessmentYear: row.assessmentYear,
    rentReliefRate: parseFloat(row.rentReliefRate),
    rentReliefCap: parseFloat(row.rentReliefCap),
    nhfRate: parseFloat(row.nhfRate),
    nhfBase: row.nhfBase,
    nhisRate: parseFloat(row.nhisRate),
    nhisBase: row.nhisBase,
    pensionRate: parseFloat(row.pensionRate),
    pensionBase: row.pensionBase,
    taxBands: row.taxBands,
    payeLedgerAccount: row.payeLedgerAccount || null,
  });
  delete plain.autoCalculation;
  return plain;
}

async function getBusinessAutoCalculation(facilityId) {
  const business = await db.business.findByPk(facilityId, {
    attributes: ["paye_auto_calculation"],
  });
  if (!business) return true;
  return (
    business.paye_auto_calculation !== false && business.paye_auto_calculation !== 0
  );
}

async function withBusinessAutoCalc(settingsPlain, facilityId) {
  return {
    ...settingsPlain,
    autoCalculation: await getBusinessAutoCalculation(facilityId),
  };
}

function profileToPlain(profile) {
  if (!profile) return null;
  const row = profile.toJSON ? profile.toJSON() : profile;
  return {
    id: row.id,
    employeeId: row.employeeId,
    facilityId: row.facilityId,
    payEntryFrequency: row.payEntryFrequency || "monthly",
    basicSalary: parseFloat(row.basicSalary) || 0,
    housingAllowance: parseFloat(row.housingAllowance) || 0,
    transportAllowance: parseFloat(row.transportAllowance) || 0,
    otherAllowances: parseFloat(row.otherAllowances) || 0,
    nonTaxableAllowances: parseFloat(row.nonTaxableAllowances) || 0,
    bonus: parseFloat(row.bonus) || 0,
    isBonusTaxable: row.isBonusTaxable !== false && row.isBonusTaxable !== 0,
    annualRent: parseFloat(row.annualRent) || 0,
    appliesRent: row.appliesRent !== false && row.appliesRent !== 0,
    appliesNHF: row.appliesNHF !== false && row.appliesNHF !== 0,
    appliesNHIS: row.appliesNHIS !== false && row.appliesNHIS !== 0,
    appliesPension: row.appliesPension !== false && row.appliesPension !== 0,
  };
}

function parseJsonField(value) {
  if (!value) return {};
  if (typeof value === "object" && !Array.isArray(value)) return value;
  if (Array.isArray(value)) return value;
  try {
    let parsed = JSON.parse(value);
    if (typeof parsed === "string") {
      try {
        parsed = JSON.parse(parsed);
      } catch {
        /* keep string-parsed once */
      }
    }
    return parsed || {};
  } catch {
    return {};
  }
}

function resolveAllowanceAmount(item, basicSalary) {
  const amount = parseFloat(item?.amount ?? item?.value ?? 0) || 0;
  const calcType = String(
    item?.calculationType || item?.calculation_type || item?.type || "",
  ).toLowerCase();
  if (calcType.includes("percent") || calcType === "%") {
    return (amount / 100) * basicSalary;
  }
  return amount;
}

function isAllowanceTaxable(item) {
  if (!item || typeof item !== "object") return true;
  if (item.isTaxable === false || item.isTaxable === 0 || item.isTaxable === "0") {
    return false;
  }
  if (item.taxable === false || item.taxable === 0 || item.taxable === "0") {
    return false;
  }
  const flag = String(item.isTaxable ?? item.taxable ?? "yes").trim().toLowerCase();
  if (["no", "n", "false", "non-taxable", "not taxable", "non taxable"].includes(flag)) {
    return false;
  }
  return true;
}

/** Build PAYE pay components from the employee's salary structure. */
function profileDefaultsFromSalaryStructure(structure) {
  if (!structure) return null;
  const basicSalary = parseFloat(structure.basicSalary) || 0;
  const allowancesRaw = parseJsonField(structure.allowances);
  let housingAllowance = 0;
  let transportAllowance = 0;
  let otherAllowances = 0;
  let nonTaxableAllowances = 0;

  const applyAllowance = (name, amount, taxable = true) => {
    if (!amount) return;
    if (!taxable) {
      nonTaxableAllowances += amount;
      return;
    }
    const n = String(name || "").toLowerCase();
    if (n.includes("hous")) housingAllowance += amount;
    else if (n.includes("transport") || n.includes("conveyance") || n === "t&t")
      transportAllowance += amount;
    else otherAllowances += amount;
  };

  if (Array.isArray(allowancesRaw)) {
    allowancesRaw.forEach((item) => {
      if (
        item?.type &&
        String(item.type).toLowerCase().includes("deduct")
      ) {
        return;
      }
      applyAllowance(
        item?.name || item?.componentName || item?.description,
        resolveAllowanceAmount(item, basicSalary),
        isAllowanceTaxable(item),
      );
    });
  } else if (allowancesRaw && typeof allowancesRaw === "object") {
    Object.entries(allowancesRaw).forEach(([key, val]) => {
      if (val && typeof val === "object") {
        applyAllowance(
          key,
          resolveAllowanceAmount(val, basicSalary),
          isAllowanceTaxable(val),
        );
      } else {
        applyAllowance(key, parseFloat(val) || 0, true);
      }
    });
  }

  return {
    payEntryFrequency: "monthly",
    basicSalary,
    housingAllowance,
    transportAllowance,
    otherAllowances,
    nonTaxableAllowances,
    bonus: 0,
    isBonusTaxable: true,
    annualRent: 0,
    appliesRent: true,
    appliesNHF: true,
    appliesNHIS: true,
    appliesPension: true,
  };
}

function emptyPayeProfile() {
  return {
    payEntryFrequency: "monthly",
    basicSalary: 0,
    housingAllowance: 0,
    transportAllowance: 0,
    otherAllowances: 0,
    nonTaxableAllowances: 0,
    bonus: 0,
    isBonusTaxable: true,
    annualRent: 0,
    appliesRent: true,
    appliesNHF: true,
    appliesNHIS: true,
    appliesPension: true,
  };
}

function isBlankPayeProfile(profile) {
  if (!profile) return true;
  return (
    !(parseFloat(profile.basicSalary) > 0) &&
    !(parseFloat(profile.housingAllowance) > 0) &&
    !(parseFloat(profile.transportAllowance) > 0) &&
    !(parseFloat(profile.otherAllowances) > 0) &&
    !(parseFloat(profile.bonus) > 0)
  );
}

function normalizePayeApplyFlags(source = {}) {
  const pick = (key, fallback = true) => {
    if (source[key] === undefined || source[key] === null || source[key] === "") {
      return fallback;
    }
    const v = source[key];
    if (typeof v === "boolean") return v;
    const s = String(v).trim().toLowerCase();
    if (["0", "no", "n", "false", "off"].includes(s)) return false;
    if (["1", "yes", "y", "true", "on"].includes(s)) return true;
    return fallback;
  };
  return {
    appliesRent: pick("appliesRent"),
    appliesNHF: pick("appliesNHF"),
    appliesNHIS: pick("appliesNHIS"),
    appliesPension: pick("appliesPension"),
  };
}

/** Ensure employee has a PAYE profile seeded from salary structure when missing/blank. */
async function syncEmployeePayeProfileFromStructure(employee, options = {}) {
  if (!employee?.id || !employee.facilityId) return null;

  let structure = options.salaryStructure || null;
  if (!structure && employee.salaryStructureId) {
    structure = await db.salary_structures.findByPk(employee.salaryStructureId);
  }

  let fromStructure = profileDefaultsFromSalaryStructure(structure);

  // Prefer master allowance records (with isTaxable) when available for this structure
  if (structure?.id && db.allowances) {
    try {
      const masterAllowances = await db.allowances.findAll({
        where: {
          facilityId: employee.facilityId,
          salaryStructureId: structure.id,
          type: "allowance",
          status: "Active",
        },
      });
      if (masterAllowances.length) {
        const basicSalary = parseFloat(structure.basicSalary) || 0;
        let housingAllowance = 0;
        let transportAllowance = 0;
        let otherAllowances = 0;
        let nonTaxableAllowances = 0;
        masterAllowances.forEach((row) => {
          const amount = resolveAllowanceAmount(row, basicSalary);
          if (!amount) return;
          if (!isAllowanceTaxable(row)) {
            nonTaxableAllowances += amount;
            return;
          }
          const n = String(row.name || "").toLowerCase();
          if (n.includes("hous")) housingAllowance += amount;
          else if (
            n.includes("transport") ||
            n.includes("conveyance") ||
            n === "t&t"
          ) {
            transportAllowance += amount;
          } else otherAllowances += amount;
        });
        fromStructure = {
          ...(fromStructure || emptyPayeProfile()),
          payEntryFrequency: "monthly",
          basicSalary,
          housingAllowance,
          transportAllowance,
          otherAllowances,
          nonTaxableAllowances,
        };
      }
    } catch (err) {
      console.error("master allowance PAYE sync:", err.message);
    }
  }

  const payeFlags = options.payeFlags
    ? normalizePayeApplyFlags(options.payeFlags)
    : null;

  // Allow updating relief flags even when salary amounts are not yet synced
  if ((!fromStructure || !(fromStructure.basicSalary > 0)) && !payeFlags) {
    return null;
  }

  let profile = await db.employee_paye_profiles.findOne({
    where: { employeeId: employee.id },
  });

  const salaryDefaults = fromStructure || emptyPayeProfile();
  const createPayload = {
    ...salaryDefaults,
    ...(payeFlags || {}),
  };

  if (!profile) {
    if (!(createPayload.basicSalary > 0) && !payeFlags) return null;
    profile = await db.employee_paye_profiles.create({
      id: uuidv4(),
      employeeId: employee.id,
      facilityId: employee.facilityId,
      ...createPayload,
    });
    return profileToPlain(profile);
  }

  const updates = {};
  if ((isBlankPayeProfile(profile) || options.force) && fromStructure) {
    updates.basicSalary = fromStructure.basicSalary;
    updates.housingAllowance = fromStructure.housingAllowance;
    updates.transportAllowance = fromStructure.transportAllowance;
    updates.otherAllowances = fromStructure.otherAllowances;
    updates.nonTaxableAllowances = fromStructure.nonTaxableAllowances || 0;
  }
  if (payeFlags) {
    Object.assign(updates, payeFlags);
  }
  if (Object.keys(updates).length) {
    await profile.update(updates);
  }

  return profileToPlain(profile);
}

async function getOrCreateSettings(facilityId, assessmentYear, createdBy) {
  let settings = await db.paye_settings.findOne({
    where: { facilityId, assessmentYear: parseInt(assessmentYear, 10) },
  });

  if (!settings) {
    settings = await db.paye_settings.create({
      id: uuidv4(),
      facilityId,
      assessmentYear: parseInt(assessmentYear, 10),
      rentReliefRate: DEFAULT_PAYE_SETTINGS_2026.rentReliefRate,
      rentReliefCap: DEFAULT_PAYE_SETTINGS_2026.rentReliefCap,
      nhfRate: DEFAULT_PAYE_SETTINGS_2026.nhfRate,
      nhfBase: DEFAULT_PAYE_SETTINGS_2026.nhfBase,
      nhisRate: DEFAULT_PAYE_SETTINGS_2026.nhisRate,
      nhisBase: DEFAULT_PAYE_SETTINGS_2026.nhisBase,
      pensionRate: DEFAULT_PAYE_SETTINGS_2026.pensionRate,
      pensionBase: DEFAULT_PAYE_SETTINGS_2026.pensionBase,
      taxBands: DEFAULT_TAX_BANDS_2026,
      autoCalculation: true,
      createdBy,
    });
  }

  return settings;
}

function buildEmployeeCalcInput(profile, settings) {
  const p = profile || {};
  const housing = parseFloat(p.housingAllowance ?? p.housing) || 0;
  const transport = parseFloat(p.transportAllowance ?? p.transport) || 0;
  const otherAllowances = parseFloat(p.otherAllowances) || 0;
  return {
    basic: p.basicSalary ?? p.basic ?? 0,
    housing,
    transport,
    otherAllowances,
    taxableAllowances: housing + transport + otherAllowances,
    nonTaxableAllowances: parseFloat(p.nonTaxableAllowances) || 0,
    bonus: p.bonus ?? 0,
    bonusIsTaxable: p.isBonusTaxable !== false && p.isBonusTaxable !== 0,
    taxableBonus: p.taxableBonus,
    nonTaxableBonus: p.nonTaxableBonus,
    annualRent: p.annualRent ?? 0,
    payEntryFrequency: p.payEntryFrequency || "monthly",
    appliesRent: p.appliesRent,
    appliesNHF: p.appliesNHF,
    appliesNHIS: p.appliesNHIS,
    appliesPension: p.appliesPension,
    settings,
  };
}

exports.getPayeSettings = async (req, res) => {
  try {
    const { facilityId, assessmentYear = 2026 } = req.query;
    if (!facilityId) {
      return res.status(400).json({ success: false, message: "facilityId is required" });
    }

    const settings = await getOrCreateSettings(facilityId, assessmentYear, req.query.userId);
    return res.json({
      success: true,
      data: await withBusinessAutoCalc(settingsToPlain(settings), facilityId),
    });
  } catch (error) {
    console.error("getPayeSettings:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

exports.savePayeSettings = async (req, res) => {
  try {
    const {
      facilityId,
      assessmentYear = 2026,
      rentReliefRate,
      rentReliefCap,
      nhfRate,
      nhfBase,
      nhisRate,
      nhisBase,
      pensionRate,
      pensionBase,
      taxBands,
      payeLedgerAccount,
      updatedBy,
    } = req.body;

    if (!facilityId) {
      return res.status(400).json({ success: false, message: "facilityId is required" });
    }

    const normalizedPayeLedger =
      payeLedgerAccount === undefined || payeLedgerAccount === null
        ? null
        : String(payeLedgerAccount).trim();
    if (normalizedPayeLedger) {
      // Chart heads come from account_category (code) and/or legacy account (head).
      const AccountCategory = db.AccountCategory || db.account_category;
      const Account = db.Account || db.account;

      let account = null;
      if (AccountCategory) {
        account = await AccountCategory.findOne({
          where: {
            code: normalizedPayeLedger,
            facilityId,
            isActive: true,
          },
        });
        if (!account) {
          account = await AccountCategory.findOne({
            where: {
              code: normalizedPayeLedger,
              facilityId,
            },
          });
        }
      }
      if (!account && Account) {
        account = await Account.findOne({
          where: { head: normalizedPayeLedger, facilityId },
        });
      }
      if (!account) {
        return res.status(400).json({
          success: false,
          message: "Invalid PAYE ledger account",
          error: `Account head '${normalizedPayeLedger}' does not exist for this facility`,
        });
      }
    }

    const year = parseInt(assessmentYear, 10);
    let settings = await db.paye_settings.findOne({ where: { facilityId, assessmentYear: year } });

    const payload = {
      rentReliefRate: rentReliefRate ?? DEFAULT_PAYE_SETTINGS_2026.rentReliefRate,
      rentReliefCap: rentReliefCap ?? DEFAULT_PAYE_SETTINGS_2026.rentReliefCap,
      nhfRate: nhfRate ?? DEFAULT_PAYE_SETTINGS_2026.nhfRate,
      nhfBase: normalizePayeBase(nhfBase || DEFAULT_PAYE_SETTINGS_2026.nhfBase),
      nhisRate: nhisRate ?? DEFAULT_PAYE_SETTINGS_2026.nhisRate,
      nhisBase: normalizePayeBase(nhisBase || DEFAULT_PAYE_SETTINGS_2026.nhisBase),
      pensionRate: pensionRate ?? DEFAULT_PAYE_SETTINGS_2026.pensionRate,
      pensionBase: normalizePayeBase(
        pensionBase || DEFAULT_PAYE_SETTINGS_2026.pensionBase,
      ),
      taxBands: parseTaxBands(Array.isArray(taxBands) && taxBands.length ? taxBands : DEFAULT_TAX_BANDS_2026),
      payeLedgerAccount: normalizedPayeLedger,
      updatedBy,
    };

    if (settings) {
      await settings.update(payload);
    } else {
      settings = await db.paye_settings.create({
        id: uuidv4(),
        facilityId,
        assessmentYear: year,
        ...payload,
        createdBy: updatedBy,
      });
    }

    return res.json({
      success: true,
      data: await withBusinessAutoCalc(settingsToPlain(settings), facilityId),
      message: "PAYE settings saved",
    });
  } catch (error) {
    console.error("savePayeSettings:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

exports.getPayeEmployeePreview = async (req, res) => {
  try {
    const { facilityId, assessmentYear = 2026, month, year } = req.query;
    if (!facilityId) {
      return res.status(400).json({ success: false, message: "facilityId is required" });
    }

    const settingsRecord = await getOrCreateSettings(facilityId, assessmentYear);
    const settings = await withBusinessAutoCalc(settingsToPlain(settingsRecord), facilityId);

    const employees = await db.employees.findAll({
      where: { facilityId, status: "Active" },
      include: [
        {
          model: db.salary_structures,
          as: "salaryStructure",
          required: false,
        },
      ],
      order: [["firstName", "ASC"]],
    });

    const profiles = await db.employee_paye_profiles.findAll({ where: { facilityId } });
    const profileMap = Object.fromEntries(profiles.map((p) => [p.employeeId, profileToPlain(p)]));

    let overrideMap = {};
    if (month && year) {
      const payrollRows = await db.payroll.findAll({
        where: {
          facilityId,
          month: parseInt(month, 10),
          year: parseInt(year, 10),
        },
      });
      overrideMap = Object.fromEntries(
        payrollRows.map((r) => [
          r.employeeId,
          {
            payeOverride: r.payeOverride != null ? parseFloat(r.payeOverride) : null,
            computedPaye: r.computedPaye != null ? parseFloat(r.computedPaye) : null,
            payrollId: r.id,
          },
        ])
      );
    }

    const autoCalcEnabled = settings.autoCalculation !== false;

    const data = [];
    for (const emp of employees) {
      let profile = profileMap[emp.id];
      const structureDefaults = profileDefaultsFromSalaryStructure(emp.salaryStructure);

      if (isBlankPayeProfile(profile) && structureDefaults) {
        // Persist link from salary structure → PAYE profile so payroll and preview stay in sync
        profile = await syncEmployeePayeProfileFromStructure(emp, {
          salaryStructure: emp.salaryStructure,
        });
      }

      if (!profile) {
        profile = structureDefaults || emptyPayeProfile();
      } else if (isBlankPayeProfile(profile) && structureDefaults) {
        profile = { ...profile, ...structureDefaults };
      }

      const override = overrideMap[emp.id];
      const storedComputedPaye = override?.computedPaye ?? null;
      const structureName =
        emp.salaryStructure?.structureName ||
        emp.salaryStructure?.name ||
        null;

      if (!autoCalcEnabled) {
        const effectiveMonthlyTax =
          override?.payeOverride != null ? override.payeOverride : storedComputedPaye;

        data.push({
          employeeId: emp.id,
          employeeCode: emp.employeeId,
          name: `${emp.firstName} ${emp.lastName}`,
          designation: emp.designation,
          salaryStructureId: emp.salaryStructureId || null,
          salaryStructureName: structureName,
          profile,
          storedComputedPaye,
          payeOverride: override?.payeOverride ?? null,
          effectiveMonthlyTax,
          payrollId: override?.payrollId || null,
        });
        continue;
      }

      const calc = computePAYE(buildEmployeeCalcInput(profile, settings));

      data.push({
        employeeId: emp.id,
        employeeCode: emp.employeeId,
        name: `${emp.firstName} ${emp.lastName}`,
        designation: emp.designation,
        salaryStructureId: emp.salaryStructureId || null,
        salaryStructureName: structureName,
        profile,
        calculation: calc,
        storedComputedPaye: calc.monthlyTax,
        computedMonthlyTax: calc.monthlyTax,
        payeOverride: override?.payeOverride ?? null,
        effectiveMonthlyTax: calc.monthlyTax,
        payrollId: override?.payrollId || null,
      });
    }

    return res.json({
      success: true,
      data: {
        settings,
        employees: data,
      },
    });
  } catch (error) {
    console.error("getPayeEmployeePreview:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

exports.saveEmployeePayeProfile = async (req, res) => {
  try {
    const { employeeId } = req.params;
    const {
      facilityId,
      payEntryFrequency,
      basicSalary,
      housingAllowance,
      transportAllowance,
      otherAllowances,
      nonTaxableAllowances,
      bonus,
      isBonusTaxable,
      annualRent,
      appliesRent,
      appliesNHF,
      appliesNHIS,
      appliesPension,
    } = req.body;

    if (!facilityId || !employeeId) {
      return res.status(400).json({ success: false, message: "facilityId and employeeId are required" });
    }

    const employee = await db.employees.findOne({ where: { id: employeeId, facilityId } });
    if (!employee) {
      return res.status(404).json({ success: false, message: "Employee not found" });
    }

    let profile = await db.employee_paye_profiles.findOne({ where: { employeeId } });
    const payload = {
      facilityId,
      payEntryFrequency: payEntryFrequency || "monthly",
      basicSalary: parseFloat(basicSalary) || 0,
      housingAllowance: parseFloat(housingAllowance) || 0,
      transportAllowance: parseFloat(transportAllowance) || 0,
      otherAllowances: parseFloat(otherAllowances) || 0,
      nonTaxableAllowances: parseFloat(nonTaxableAllowances) || 0,
      bonus: parseFloat(bonus) || 0,
      isBonusTaxable: isBonusTaxable !== false && isBonusTaxable !== 0,
      annualRent: parseFloat(annualRent) || 0,
      appliesRent: appliesRent !== false,
      appliesNHF: appliesNHF !== false,
      appliesNHIS: appliesNHIS !== false,
      appliesPension: appliesPension !== false,
    };

    if (profile) {
      await profile.update(payload);
    } else {
      profile = await db.employee_paye_profiles.create({
        id: uuidv4(),
        employeeId,
        ...payload,
      });
    }

    return res.json({ success: true, data: profileToPlain(profile), message: "Employee PAYE profile saved" });
  } catch (error) {
    console.error("saveEmployeePayeProfile:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

exports.savePayeOverride = async (req, res) => {
  try {
    const { employeeId, facilityId, month, year, payeOverride, userId } = req.body;

    if (!employeeId || !facilityId || !month || !year) {
      return res.status(400).json({
        success: false,
        message: "employeeId, facilityId, month, and year are required",
      });
    }

    let payroll = await db.payroll.findOne({
      where: {
        employeeId,
        facilityId,
        month: parseInt(month, 10),
        year: parseInt(year, 10),
      },
    });

    const overrideVal = payeOverride === null || payeOverride === "" ? null : parseFloat(payeOverride);

    if (payroll) {
      await payroll.update({
        payeOverride: overrideVal,
        paye: overrideVal != null ? overrideVal : payroll.computedPaye ?? payroll.paye,
        updatedBy: userId,
      });
    } else {
      payroll = await db.payroll.create({
        id: uuidv4(),
        employeeId,
        facilityId,
        month: parseInt(month, 10),
        year: parseInt(year, 10),
        basicSalary: 0,
        payeOverride: overrideVal,
        paye: overrideVal ?? 0,
        computedPaye: 0,
        status: "Draft",
        createdBy: userId,
      });
    }

    return res.json({
      success: true,
      data: {
        payrollId: payroll.id,
        payeOverride: payroll.payeOverride != null ? parseFloat(payroll.payeOverride) : null,
        computedPaye: payroll.computedPaye != null ? parseFloat(payroll.computedPaye) : null,
        paye: parseFloat(payroll.paye) || 0,
      },
      message: "PAYE override saved",
    });
  } catch (error) {
    console.error("savePayeOverride:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

exports.getPayeSettingsForPayroll = getOrCreateSettings;
exports.getBusinessAutoCalculation = getBusinessAutoCalculation;
exports.settingsToPlain = settingsToPlain;
exports.profileToPlain = profileToPlain;
exports.buildEmployeeCalcInput = buildEmployeeCalcInput;
exports.syncEmployeePayeProfileFromStructure = syncEmployeePayeProfileFromStructure;
exports.profileDefaultsFromSalaryStructure = profileDefaultsFromSalaryStructure;
