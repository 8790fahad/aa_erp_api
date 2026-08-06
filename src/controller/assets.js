const uuidv4 = require('uuid/v4');
const { Op } = require('sequelize');

const db = require('../models');
const Asset = db.assets;
const AssetTransaction = db.asset_transactions;
const AssetMaintenance = db.asset_maintenance;
const User = db.users;
const {
  createAssetJournalEntry,
  createBulkDepreciationJournal,
  computeFirsPeriodAllowance,
  getAssetAccountCode,
  getAccumulatedDepreciationAccountCode,
  getDepreciationExpenseAccountCode,
} = require('./assetAccounting');
const {
  recordActivity,
  pickActor,
} = require('../services/activityAuditService');

// Helper function to generate asset code
const generateAssetCode = async (facilityId, category) => {
  const categoryPrefix = {
    'Land': 'LND',
    'Buildings': 'BLD',
    'Land & Building': 'BLD',
    'Plant and Machinery': 'PLT',
    'Plant & Machinery': 'PLT',
    'Motor Vehicles': 'VEH',
    'Furniture and Fittings': 'FUR',
    'Furniture & Fittings': 'FUR',
    'Computer Equipment': 'CMP',
    'IT Equipment': 'CMP',
    'Office Equipment': 'OFC',
    'Other Assets': 'OTH'
  };

  const prefix = categoryPrefix[category] || 'AST';
  const year = new Date().getFullYear().toString().slice(-2);
  
  // Get the next sequence number for this category and facility
  const lastAsset = await Asset.findOne({
    where: {
      facility_id: facilityId,
      category,
      asset_code: {
        [Op.like]: `${prefix}${year}%`
      }
    },
    order: [['asset_code', 'DESC']]
  });

  let sequence = 1;
  if (lastAsset) {
    const lastSequence = parseInt(lastAsset.asset_code.slice(-4));
    sequence = lastSequence + 1;
  }

  return `${prefix}${year}${sequence.toString().padStart(4, '0')}`;
};

// Create new asset
exports.createAsset = async (req, res) => {
  try {
    const {
      assetCode: assetCodeOverride,
      assetName,
      description,
      category,
      acquisitionDate,
      acquisitionCost,
      cost,
      usefulLife,
      residualValue = 0,
      depreciationMethod = 'Straight Line',
      depreciationRate,
      location,
      departmentId,
      supplierNumber,
      supplierName,
      invoiceRef,
      custodian,
      custodianId,
      notes,
      attachmentUrls,
      firsAllowanceRate,
      status,
      facilityId,
      assetAccountCode,
      accumulatedDepreciationAccountCode,
      depreciationExpenseAccountCode,
      disposalAccountCode,
      paymentAccountCode,
      paymentAccountName,
      chequeNumber,
      postToLedger,
      recordedInPurchase,
    } = req.body;

    // `description` is treated as the display name; keep asset_name in sync.
    const resolvedName = assetName || description;
    const resolvedDescription = description || assetName;
    const resolvedCost = acquisitionCost != null ? acquisitionCost : cost;

    if (!facilityId || !resolvedDescription || !category || !acquisitionDate || !resolvedCost || !usefulLife) {
      return res.status(400).json({
        success: false,
        message: 'facilityId, description/assetName, category, acquisitionDate, cost and usefulLife are required',
      });
    }

    const createdBy = req.user?.id || req.body.createdBy || 'SYSTEM';

    const resolvedAssetCode = assetAccountCode || getAssetAccountCode(category);
    const resolvedAccumCode =
      accumulatedDepreciationAccountCode || getAccumulatedDepreciationAccountCode(category);
    const resolvedDepExpenseCode =
      depreciationExpenseAccountCode || getDepreciationExpenseAccountCode(category);

    // Asset code: allow an explicit editable override, else auto-generate.
    const assetCode = assetCodeOverride && String(assetCodeOverride).trim()
      ? String(assetCodeOverride).trim()
      : await generateAssetCode(facilityId, category);

    let attachmentsJson = null;
    if (attachmentUrls !== undefined && attachmentUrls !== null) {
      try {
        attachmentsJson =
          typeof attachmentUrls === 'string'
            ? attachmentUrls
            : JSON.stringify(attachmentUrls);
      } catch (e) {
        attachmentsJson = null;
      }
    }

    // Create asset with database field names
    const asset = await Asset.create({
      id: uuidv4(),
      facility_id: facilityId,
      department_id: departmentId || null,
      asset_code: assetCode,
      asset_name: resolvedName,
      description: resolvedDescription,
      category,
      supplier_number: supplierNumber || null,
      supplier_name: supplierName || null,
      invoice_ref: invoiceRef || null,
      recorded_in_purchase:
        recordedInPurchase === true ||
        recordedInPurchase === "true" ||
        recordedInPurchase === 1 ||
        recordedInPurchase === "1",
      attachment_urls: attachmentsJson,
      acquisition_date: acquisitionDate,
      acquisition_cost: resolvedCost,
      useful_life_years: usefulLife,
      residual_value: residualValue,
      depreciation_method: depreciationMethod,
      depreciation_rate: depreciationRate,
      asset_account_code: resolvedAssetCode,
      accumulated_depreciation_account_code: resolvedAccumCode,
      depreciation_expense_account_code: resolvedDepExpenseCode,
      disposal_account_code: disposalAccountCode || null,
      location,
      custodian,
      custodianId: custodianId || null,
      status: status === 'Written Off' ? 'Written Off' : 'Active',
      net_book_value: resolvedCost,
      accumulated_depreciation: 0,
      last_depreciation_date: null,
      disposal_date: null,
      disposal_proceeds: null,
      impairment_loss: null,
      revaluation_surplus: null,
      notes,
      firs_allowance_rate:
        firsAllowanceRate !== undefined && firsAllowanceRate !== null && firsAllowanceRate !== ''
          ? firsAllowanceRate
          : null,
      firs_written_down_value: resolvedCost,
      firs_allowance_to_date: 0,
      createdBy,
      updatedBy: createdBy,
    });

    let journalRef = null;
    let ledgerWarning = null;

    // Already booked in purchase (or explicit postToLedger=false) — skip capitalization JE.
    const alreadyInPurchase =
      recordedInPurchase === true ||
      recordedInPurchase === 'true' ||
      recordedInPurchase === 1 ||
      recordedInPurchase === '1' ||
      asset.recorded_in_purchase === true;
    const shouldPostLedger =
      !alreadyInPurchase &&
      (postToLedger === true ||
        postToLedger === 'true' ||
        (postToLedger !== false &&
          postToLedger !== 'false' &&
          !invoiceRef));

    if (shouldPostLedger) {
      try {
        journalRef = await createAssetJournalEntry(
          'Acquisition',
          asset,
          resolvedCost,
          acquisitionDate,
          facilityId,
          {
            paymentAccountCode: paymentAccountCode || '1010',
            paymentAccountName: paymentAccountName || 'Cash Account',
            chequeNumber: chequeNumber || null,
            createdBy,
          }
        );
      } catch (ledgerError) {
        console.error('Asset acquisition GL posting failed:', ledgerError);
        ledgerWarning = ledgerError.message;
      }
    }

    try {
      if (AssetTransaction) {
        await AssetTransaction.create({
          id: uuidv4(),
          assetId: asset.id,
          transactionType: 'Acquisition',
          transactionDate: acquisitionDate,
          amount: resolvedCost,
          description: `Initial acquisition of ${resolvedDescription}`,
          facilityId,
          createdBy,
          status: 'Approved',
          journalEntryId: journalRef,
        });
      }
    } catch (transactionError) {
      console.warn('Asset transaction creation skipped:', transactionError.message);
    }

    res.status(201).json({
      success: true,
      message: ledgerWarning
        ? 'Asset created, but ledger posting failed'
        : 'Asset created successfully',
      data: asset,
      journalRef,
      ledgerWarning,
    });

  } catch (error) {
    console.error('Error creating asset:', error);
    res.status(500).json({
      success: false,
      message: 'Error creating asset',
      error: error.message
    });
  }
};

// Get all assets
exports.getAllAssets = async (req, res) => {
  try {
    const { facilityId, category, status, page = 1, limit = 50 } = req.query;
    
    const whereClause = { facility_id: facilityId };
    
    if (category) whereClause.category = category;
    if (status) whereClause.status = status;

    const offset = (page - 1) * limit;

    const { count, rows: assets } = await Asset.findAndCountAll({
      where: whereClause,
      order: [['created_at', 'DESC']],
      limit: parseInt(limit),
      offset: parseInt(offset)
    });

    // Calculate depreciation values for each asset
    const assetsWithDepreciation = assets.map(asset => {
      const assetData = asset.toJSON();
      const accumulatedDepreciation = asset.calculateAccumulatedDepreciation();
      const currentYearDepreciation = asset.calculateCurrentYearDepreciation();
      const netBookValue = assetData.acquisition_cost - accumulatedDepreciation;

      return {
        ...assetData,
        accumulatedDepreciation: parseFloat(accumulatedDepreciation.toFixed(2)),
        currentYearDepreciation: parseFloat(currentYearDepreciation.toFixed(2)),
        netBookValue: parseFloat(netBookValue.toFixed(2))
      };
    });

    res.json({
      success: true,
      data: {
        assets: assetsWithDepreciation,
        pagination: {
          total: count,
          page: parseInt(page),
          limit: parseInt(limit),
          totalPages: Math.ceil(count / limit)
        }
      }
    });

  } catch (error) {
    console.error('Error fetching assets:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching assets',
      error: error.message
    });
  }
};

// Get asset by ID
exports.getAssetById = async (req, res) => {
  try {
    const { id } = req.params;

    const asset = await Asset.findByPk(id);

    if (!asset) {
      return res.status(404).json({
        success: false,
        message: 'Asset not found'
      });
    }

    const assetData = asset.toJSON();
    const storedAccum = parseFloat(assetData.accumulated_depreciation || 0);
    const accumulatedDepreciation = storedAccum > 0
      ? storedAccum
      : asset.calculateAccumulatedDepreciation();
    const currentYearDepreciation = asset.calculateCurrentYearDepreciation();
    const netBookValue = assetData.acquisition_cost - accumulatedDepreciation;

    // Parse attachment JSON for the UI.
    let attachments = [];
    if (assetData.attachment_urls) {
      try {
        const parsed = JSON.parse(assetData.attachment_urls);
        if (Array.isArray(parsed)) attachments = parsed;
      } catch (e) {
        attachments = [];
      }
    }

    // Transaction history + maintenance records.
    let transactions = [];
    let maintenanceRecords = [];
    let totalMaintenanceCost = 0;
    try {
      if (AssetTransaction) {
        transactions = await AssetTransaction.findAll({
          where: { assetId: id },
          order: [['transactionDate', 'DESC']],
        });
      }
    } catch (e) {
      console.warn('Asset transactions fetch skipped:', e.message);
    }
    try {
      if (AssetMaintenance) {
        maintenanceRecords = await AssetMaintenance.findAll({
          where: { assetId: id },
          order: [['createdAt', 'DESC']],
        });
        totalMaintenanceCost = maintenanceRecords.reduce(
          (sum, m) => sum + parseFloat(m.cost || 0),
          0
        );
      }
    } catch (e) {
      console.warn('Asset maintenance fetch skipped:', e.message);
    }

    res.json({
      success: true,
      data: {
        ...assetData,
        attachments,
        transactions,
        maintenanceRecords,
        totalMaintenanceCost: parseFloat(totalMaintenanceCost.toFixed(2)),
        accumulatedDepreciation: parseFloat(accumulatedDepreciation.toFixed(2)),
        currentYearDepreciation: parseFloat(currentYearDepreciation.toFixed(2)),
        netBookValue: parseFloat(netBookValue.toFixed(2)),
        firsWrittenDownValue:
          assetData.firs_written_down_value != null
            ? parseFloat(assetData.firs_written_down_value)
            : parseFloat(assetData.acquisition_cost || 0),
        firsAllowanceToDate: parseFloat(assetData.firs_allowance_to_date || 0),
      }
    });

  } catch (error) {
    console.error('Error fetching asset:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching asset',
      error: error.message
    });
  }
};

// Update asset
exports.updateAsset = async (req, res) => {
  try {
    const { id } = req.params;
    const updatedBy = req.user?.id || req.body.updatedBy;

    const asset = await Asset.findByPk(id);
    if (!asset) {
      return res.status(404).json({
        success: false,
        message: 'Asset not found'
      });
    }

    // Map frontend field names to database field names
    const updateData = {};
    if (req.body.assetCode && String(req.body.assetCode).trim()) {
      updateData.asset_code = String(req.body.assetCode).trim();
    }
    if (req.body.assetName !== undefined) updateData.asset_name = req.body.assetName;
    if (req.body.description !== undefined) {
      updateData.description = req.body.description;
      // Keep asset_name in sync when only description is provided.
      if (req.body.assetName === undefined) updateData.asset_name = req.body.description;
    }
    if (req.body.category) updateData.category = req.body.category;
    if (req.body.supplierNumber !== undefined) updateData.supplier_number = req.body.supplierNumber || null;
    if (req.body.supplierName !== undefined) updateData.supplier_name = req.body.supplierName || null;
    if (req.body.attachmentUrls !== undefined) {
      try {
        updateData.attachment_urls =
          req.body.attachmentUrls === null
            ? null
            : typeof req.body.attachmentUrls === 'string'
            ? req.body.attachmentUrls
            : JSON.stringify(req.body.attachmentUrls);
      } catch (e) {
        // leave unchanged on serialization failure
      }
    }
    if (req.body.acquisitionDate) updateData.acquisition_date = req.body.acquisitionDate;
    if (req.body.acquisitionCost) updateData.acquisition_cost = req.body.acquisitionCost;
    else if (req.body.cost) updateData.acquisition_cost = req.body.cost;
    if (req.body.usefulLife) updateData.useful_life_years = req.body.usefulLife;
    if (req.body.residualValue !== undefined) updateData.residual_value = req.body.residualValue;
    if (req.body.depreciationMethod) updateData.depreciation_method = req.body.depreciationMethod;
    if (req.body.depreciationRate !== undefined) updateData.depreciation_rate = req.body.depreciationRate;
    if (req.body.location !== undefined) updateData.location = req.body.location;
    if (req.body.departmentId !== undefined) updateData.department_id = req.body.departmentId || null;
    if (req.body.supplierNumber !== undefined) updateData.supplier_number = req.body.supplierNumber || null;
    if (req.body.supplierName !== undefined) updateData.supplier_name = req.body.supplierName || null;
    if (req.body.invoiceRef !== undefined) updateData.invoice_ref = req.body.invoiceRef || null;
    if (req.body.recordedInPurchase !== undefined) {
      updateData.recorded_in_purchase =
        req.body.recordedInPurchase === true ||
        req.body.recordedInPurchase === 'true' ||
        req.body.recordedInPurchase === 1 ||
        req.body.recordedInPurchase === '1';
    }
    if (req.body.custodian !== undefined) updateData.custodian = req.body.custodian;
    if (req.body.custodianId !== undefined) updateData.custodianId = req.body.custodianId || null;
    if (req.body.status) updateData.status = req.body.status;
    if (req.body.notes !== undefined) updateData.notes = req.body.notes;
    if (req.body.firsAllowanceRate !== undefined) {
      updateData.firs_allowance_rate =
        req.body.firsAllowanceRate === '' || req.body.firsAllowanceRate === null
          ? null
          : req.body.firsAllowanceRate;
    }
    if (req.body.assetAccountCode) updateData.asset_account_code = req.body.assetAccountCode;
    if (req.body.accumulatedDepreciationAccountCode) {
      updateData.accumulated_depreciation_account_code = req.body.accumulatedDepreciationAccountCode;
    }
    if (req.body.depreciationExpenseAccountCode) {
      updateData.depreciation_expense_account_code = req.body.depreciationExpenseAccountCode;
    }
    if (req.body.disposalAccountCode !== undefined) {
      updateData.disposal_account_code = req.body.disposalAccountCode || null;
    }
    
    // Always update the updatedBy field
    updateData.updatedBy = updatedBy;

    const before = {
      asset_code: asset.asset_code,
      asset_name: asset.asset_name,
      description: asset.description,
      status: asset.status,
      location: asset.location,
      custodian: asset.custodian,
    };

    await asset.update(updateData);

    await recordActivity({
      facilityId: asset.facility_id,
      userId: pickActor(req) || updatedBy,
      action: 'update',
      entityType: 'asset',
      entityId: asset.id,
      entityLabel: asset.asset_code || asset.asset_name,
      before,
      after: updateData,
      remark: 'Asset updated',
    });

    res.json({
      success: true,
      message: 'Asset updated successfully',
      data: asset
    });

  } catch (error) {
    console.error('Error updating asset:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating asset',
      error: error.message
    });
  }
};

// Shared disposal/write-off routine. `finalStatus` is either 'Disposed' or
// 'Written Off'. Both post the same gain/loss journal via createAssetJournalEntry.
const performDisposal = async (asset, opts) => {
  const {
    disposalDate,
    disposalMethod,
    disposalProceeds = 0,
    description,
    facilityId,
    paymentAccountCode,
    paymentAccountName,
    createdBy,
    finalStatus = 'Disposed',
  } = opts;

  const accumulatedDepreciation =
    parseFloat(asset.accumulated_depreciation) ||
    asset.calculateAccumulatedDepreciation();
  const facility = facilityId || asset.facility_id;

  let journalRef = null;
  let ledgerWarning = null;
  try {
    journalRef = await createAssetJournalEntry(
      'Disposal',
      asset,
      disposalProceeds,
      disposalDate,
      facility,
      {
        accumulatedDepreciation,
        disposalProceeds,
        paymentAccountCode,
        paymentAccountName,
        createdBy,
      }
    );
  } catch (ledgerError) {
    console.error('Asset disposal GL posting failed:', ledgerError);
    ledgerWarning = ledgerError.message;
  }

  const acquisitionCost = parseFloat(asset.acquisition_cost || 0);
  const netBookValue = Math.max(acquisitionCost - accumulatedDepreciation, 0);
  const gainLoss = parseFloat(disposalProceeds || 0) - netBookValue;

  try {
    if (AssetTransaction) {
      await AssetTransaction.create({
        id: uuidv4(),
        assetId: asset.id,
        transactionType: 'Disposal',
        transactionDate: disposalDate,
        amount: disposalProceeds,
        disposalMethod: disposalMethod || (finalStatus === 'Written Off' ? 'Loss' : null),
        disposalProceeds,
        description:
          description ||
          `${finalStatus === 'Written Off' ? 'Write-off' : 'Disposal'} of ${asset.description}`,
        facilityId: facility,
        createdBy,
        status: 'Approved',
        journalEntryId: journalRef,
      });
    }
  } catch (transactionError) {
    console.warn('Asset disposal transaction creation skipped:', transactionError.message);
  }

  await asset.update({
    status: finalStatus,
    disposal_date: disposalDate,
    disposal_proceeds: disposalProceeds,
    accumulated_depreciation: accumulatedDepreciation,
    net_book_value: netBookValue,
    updatedBy: createdBy,
  });

  await recordActivity({
    facilityId: facility,
    userId: createdBy,
    action: 'delete',
    entityType: 'asset',
    entityId: asset.id,
    entityLabel: asset.asset_code || asset.description,
    before: { status: asset.status },
    after: {
      status: finalStatus,
      disposal_date: disposalDate,
      disposal_proceeds: disposalProceeds,
      net_book_value: netBookValue,
    },
    remark: finalStatus === 'Written Off' ? 'Asset written off' : 'Asset disposed',
    meta: { journalRef, gainLoss },
  });

  return { journalRef, ledgerWarning, netBookValue, gainLoss, accumulatedDepreciation };
};

// Dispose asset
exports.disposeAsset = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      disposalDate,
      disposalMethod,
      disposalProceeds = 0,
      description,
      facilityId,
      paymentAccountCode,
      paymentAccountName,
    } = req.body;

    const createdBy = req.user?.id || req.body.createdBy || 'SYSTEM';

    const asset = await Asset.findByPk(id);
    if (!asset) {
      return res.status(404).json({
        success: false,
        message: 'Asset not found'
      });
    }

    if (asset.status === 'Disposed' || asset.status === 'Written Off') {
      return res.status(400).json({
        success: false,
        message: `Asset is already ${asset.status.toLowerCase()}`
      });
    }

    if (!disposalDate || !disposalMethod) {
      return res.status(400).json({
        success: false,
        message: 'disposalDate and disposalMethod are required',
      });
    }

    const result = await performDisposal(asset, {
      disposalDate,
      disposalMethod,
      disposalProceeds,
      description,
      facilityId,
      paymentAccountCode,
      paymentAccountName,
      createdBy,
      finalStatus: 'Disposed',
    });

    res.json({
      success: true,
      message: result.ledgerWarning
        ? 'Asset disposed, but ledger posting failed'
        : 'Asset disposed successfully',
      data: { asset },
      journalRef: result.journalRef,
      gainLoss: parseFloat(result.gainLoss.toFixed(2)),
      ledgerWarning: result.ledgerWarning,
    });

  } catch (error) {
    console.error('Error disposing asset:', error);
    res.status(500).json({
      success: false,
      message: 'Error disposing asset',
      error: error.message
    });
  }
};

// Write off asset (disposal with zero proceeds, status "Written Off")
exports.writeOffAsset = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      writeOffDate,
      disposalDate,
      description,
      facilityId,
      paymentAccountCode,
      paymentAccountName,
    } = req.body;

    const effectiveDate = writeOffDate || disposalDate;
    const createdBy = req.user?.id || req.body.createdBy || 'SYSTEM';

    const asset = await Asset.findByPk(id);
    if (!asset) {
      return res.status(404).json({ success: false, message: 'Asset not found' });
    }

    if (asset.status === 'Disposed' || asset.status === 'Written Off') {
      return res.status(400).json({
        success: false,
        message: `Asset is already ${asset.status.toLowerCase()}`,
      });
    }

    if (!effectiveDate) {
      return res.status(400).json({
        success: false,
        message: 'writeOffDate is required',
      });
    }

    const result = await performDisposal(asset, {
      disposalDate: effectiveDate,
      disposalMethod: 'Loss',
      disposalProceeds: 0,
      description: description || `Write-off of ${asset.description}`,
      facilityId,
      paymentAccountCode,
      paymentAccountName,
      createdBy,
      finalStatus: 'Written Off',
    });

    res.json({
      success: true,
      message: result.ledgerWarning
        ? 'Asset written off, but ledger posting failed'
        : 'Asset written off successfully',
      data: { asset },
      journalRef: result.journalRef,
      loss: parseFloat(Math.abs(result.gainLoss).toFixed(2)),
      ledgerWarning: result.ledgerWarning,
    });
  } catch (error) {
    console.error('Error writing off asset:', error);
    res.status(500).json({
      success: false,
      message: 'Error writing off asset',
      error: error.message,
    });
  }
};

// Transfer asset to a new location / department / custodian (no GL impact)
exports.transferAsset = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      toLocation,
      toDepartmentId,
      toCustodian,
      toCustodianId,
      transferDate,
      notes,
      facilityId,
    } = req.body;

    const createdBy = req.user?.id || req.body.createdBy || 'SYSTEM';

    const asset = await Asset.findByPk(id);
    if (!asset) {
      return res.status(404).json({ success: false, message: 'Asset not found' });
    }

    if (!transferDate) {
      return res.status(400).json({
        success: false,
        message: 'transferDate is required',
      });
    }

    const fromLocation = asset.location || null;
    const fromDepartment = asset.department_id || null;
    const fromCustodian = asset.custodian || null;
    const facility = facilityId || asset.facility_id;

    try {
      if (AssetTransaction) {
        await AssetTransaction.create({
          id: uuidv4(),
          assetId: asset.id,
          transactionType: 'Transfer',
          transactionDate: transferDate,
          amount: 0,
          description: notes || `Transfer of ${asset.description}`,
          fromLocation,
          toLocation: toLocation || fromLocation,
          fromCustodian,
          toCustodian: toCustodian || fromCustodian,
          fromDepartment,
          toDepartment: toDepartmentId || fromDepartment,
          facilityId: facility,
          createdBy,
          status: 'Approved',
        });
      }
    } catch (transactionError) {
      console.warn('Asset transfer transaction creation skipped:', transactionError.message);
    }

    const assetUpdate = { updatedBy: createdBy };
    if (toLocation !== undefined) assetUpdate.location = toLocation;
    if (toDepartmentId !== undefined) assetUpdate.department_id = toDepartmentId || null;
    if (toCustodian !== undefined) assetUpdate.custodian = toCustodian;
    if (toCustodianId !== undefined) assetUpdate.custodianId = toCustodianId || null;

    await asset.update(assetUpdate);

    res.json({
      success: true,
      message: 'Asset transferred successfully',
      data: { asset },
    });
  } catch (error) {
    console.error('Error transferring asset:', error);
    res.status(500).json({
      success: false,
      message: 'Error transferring asset',
      error: error.message,
    });
  }
};

// Record depreciation for an asset
exports.recordDepreciation = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      depreciationDate,
      depreciationAmount,
      description,
      facilityId
    } = req.body;
    
    const createdBy = req.user?.id || req.body.createdBy || 'SYSTEM';

    const asset = await Asset.findByPk(id);
    if (!asset) {
      return res.status(404).json({
        success: false,
        message: 'Asset not found'
      });
    }

    if (asset.status !== 'Active') {
      return res.status(400).json({
        success: false,
        message: 'Can only record depreciation for active assets'
      });
    }

    const amount = parseFloat(depreciationAmount);
    if (!depreciationDate || !amount || amount <= 0) {
      return res.status(400).json({
        success: false,
        message: 'depreciationDate and a positive depreciationAmount are required',
      });
    }

    const facility = facilityId || asset.facility_id;
    let journalRef = null;
    let ledgerWarning = null;

    try {
      journalRef = await createAssetJournalEntry(
        'Depreciation',
        asset,
        amount,
        depreciationDate,
        facility,
        { createdBy }
      );
    } catch (ledgerError) {
      console.error('Asset depreciation GL posting failed:', ledgerError);
      ledgerWarning = ledgerError.message;
    }

    try {
      if (AssetTransaction) {
        await AssetTransaction.create({
          id: uuidv4(),
          assetId: asset.id,
          transactionType: 'Depreciation',
          transactionDate: depreciationDate,
          amount,
          description: description || `Depreciation for ${asset.description}`,
          facilityId: facility,
          createdBy,
          status: 'Approved',
          journalEntryId: journalRef,
        });
      }
    } catch (transactionError) {
      console.warn('Asset depreciation transaction creation skipped:', transactionError.message);
    }

    const currentAccumulatedDepreciation = parseFloat(asset.accumulated_depreciation || 0);
    const newAccumulatedDepreciation = currentAccumulatedDepreciation + amount;
    const newNetBookValue = parseFloat(asset.acquisition_cost) - newAccumulatedDepreciation;

    await asset.update({
      accumulated_depreciation: newAccumulatedDepreciation,
      net_book_value: newNetBookValue,
      last_depreciation_date: depreciationDate,
      updatedBy: createdBy,
    });

    res.json({
      success: true,
      message: ledgerWarning
        ? 'Depreciation recorded, but ledger posting failed'
        : 'Depreciation recorded successfully',
      data: {
        asset,
        depreciationAmount: amount,
        newAccumulatedDepreciation,
        newNetBookValue
      },
      journalRef,
      ledgerWarning,
    });

  } catch (error) {
    console.error('Error recording depreciation:', error);
    res.status(500).json({
      success: false,
      message: 'Error recording depreciation',
      error: error.message
    });
  }
};

// Get depreciation schedule
exports.getDepreciationSchedule = async (req, res) => {
  try {
    const { id } = req.params;

    const asset = await Asset.findByPk(id);
    if (!asset) {
      return res.status(404).json({
        success: false,
        message: 'Asset not found'
      });
    }

    const schedule = [];
    const acquisitionDate = new Date(asset.acquisition_date);
    const depreciableAmount = asset.acquisition_cost - asset.residual_value;
    
    let bookValue = asset.acquisition_cost;
    let accumulatedDepreciation = 0;

    for (let year = 1; year <= asset.useful_life_years; year++) {
      let yearlyDepreciation = 0;
      
      switch (asset.depreciation_method) {
        case 'Straight Line':
          yearlyDepreciation = depreciableAmount / asset.useful_life_years;
          break;
          
      case 'Reducing Balance':
        const rate = asset.depreciation_rate / 100;
        yearlyDepreciation = Math.min(bookValue * rate, bookValue - asset.residual_value);
        break;
        
      case 'Double Declining Balance':
        const ddbRate = 2 / asset.useful_life_years;
        yearlyDepreciation = Math.min(bookValue * ddbRate, bookValue - asset.residual_value);
        break;
        
      case 'Sum of Years Digits':
        const totalYears = asset.useful_life_years;
        const sumOfYears = (totalYears * (totalYears + 1)) / 2;
        const remainingYears = totalYears - year + 1;
        yearlyDepreciation = (remainingYears / sumOfYears) * depreciableAmount;
        break;
          
        default:
          yearlyDepreciation = depreciableAmount / asset.useful_life_years;
      }

      accumulatedDepreciation += yearlyDepreciation;
      bookValue -= yearlyDepreciation;

      // Ensure we don't depreciate below residual value
      if (bookValue < asset.residual_value) {
        yearlyDepreciation -= (asset.residual_value - bookValue);
        accumulatedDepreciation = asset.acquisition_cost - asset.residual_value;
        bookValue = asset.residual_value;
      }

      const yearDate = new Date(acquisitionDate);
      yearDate.setFullYear(acquisitionDate.getFullYear() + year);

      schedule.push({
        year,
        date: yearDate.toISOString().split('T')[0],
        openingBookValue: parseFloat((asset.acquisition_cost - (accumulatedDepreciation - yearlyDepreciation)).toFixed(2)),
        depreciation: parseFloat(yearlyDepreciation.toFixed(2)),
        accumulatedDepreciation: parseFloat(accumulatedDepreciation.toFixed(2)),
        closingBookValue: parseFloat(bookValue.toFixed(2))
      });

      if (bookValue <= asset.residual_value) break;
    }

    res.json({
      success: true,
      data: {
        asset: {
          id: asset.id,
          asset_code: asset.asset_code,
          description: asset.description,
          acquisition_cost: asset.acquisition_cost,
          residual_value: asset.residual_value,
          useful_life_years: asset.useful_life_years,
          depreciation_method: asset.depreciation_method
        },
        schedule
      }
    });

  } catch (error) {
    console.error('Error generating depreciation schedule:', error);
    res.status(500).json({
      success: false,
      message: 'Error generating depreciation schedule',
      error: error.message
    });
  }
};

// Get asset summary/dashboard data
exports.getAssetSummary = async (req, res) => {
  try {
    const { facilityId } = req.query;

    // Get asset counts by category
    const categoryStats = await Asset.findAll({
      where: { facility_id: facilityId },
      attributes: [
        'category',
        [db.sequelize.fn('COUNT', db.sequelize.col('id')), 'count'],
        [db.sequelize.fn('SUM', db.sequelize.col('acquisition_cost')), 'totalCost']
      ],
      group: ['category']
    });

    // Get asset counts by status
    const statusStats = await Asset.findAll({
      where: { facility_id: facilityId },
      attributes: [
        'status',
        [db.sequelize.fn('COUNT', db.sequelize.col('id')), 'count']
      ],
      group: ['status']
    });

    // Get total asset value
    const totalValue = await Asset.sum('acquisition_cost', {
      where: { facility_id: facilityId }
    });

    res.json({
      success: true,
      data: {
        categoryStats,
        statusStats,
        totalValue: parseFloat((totalValue || 0).toFixed(2)),
        maintenanceDue: 0 // Placeholder since maintenance table might not exist
      }
    });

  } catch (error) {
    console.error('Error fetching asset summary:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching asset summary',
      error: error.message
    });
  }
};

// Compute one period (default monthly) of book depreciation for an asset,
// capping so NBV never drops below residual value.
const computePeriodBookDepreciation = (asset, periodMonths = 1) => {
  const cost = parseFloat(asset.acquisition_cost || 0);
  const residual = parseFloat(asset.residual_value || 0);
  const accum = parseFloat(asset.accumulated_depreciation || 0);
  const usefulLife = parseInt(asset.useful_life_years || 0, 10);
  const nbv = cost - accum;
  const depreciableRemaining = Math.max(nbv - residual, 0);

  if (depreciableRemaining <= 0) return 0;

  let periodDep = 0;
  if (asset.depreciation_method === 'Reducing Balance') {
    const annualRate = parseFloat(asset.depreciation_rate || 0) / 100;
    periodDep = nbv * annualRate * (periodMonths / 12);
  } else {
    // Straight line (default): annual = (cost - residual)/life; monthly = annual/12
    const annual = usefulLife > 0 ? (cost - residual) / usefulLife : 0;
    periodDep = annual * (periodMonths / 12);
  }

  periodDep = Math.min(periodDep, depreciableRemaining);
  return parseFloat(Math.max(periodDep, 0).toFixed(2));
};

// Bulk depreciation calculation and recording.
// Posts ONE summarized journal grouped by category (book depreciation) and
// updates FIRS capital-allowance figures in parallel WITHOUT any GL impact.
exports.runBulkDepreciation = async ({
  facilityId,
  periodEndDate,
  depreciationDate,
  assetIds,
  periodMonths = 1,
  createdBy = "SYSTEM",
}) => {
  const runDate = periodEndDate || depreciationDate;

  if (!facilityId || !runDate) {
    const err = new Error("facilityId and periodEndDate are required");
    err.statusCode = 400;
    throw err;
  }

  const months = Math.max(1, parseInt(periodMonths, 10) || 1);

  const whereClause = {
    facility_id: facilityId,
    status: "Active",
  };

  if (assetIds && assetIds.length > 0) {
    whereClause.id = { [Op.in]: assetIds };
  }

  const assets = await Asset.findAll({ where: whereClause });

  const depreciationResults = [];
  const categoryTotals = {};
  let totalBookDepreciation = 0;
  let totalFirsAllowance = 0;

  for (const asset of assets) {
    try {
      // Cost already booked via purchase — skip depreciation GL / register updates.
      if (asset.recorded_in_purchase) {
        depreciationResults.push({
          assetId: asset.id,
          assetCode: asset.asset_code,
          description: asset.description,
          category: asset.category,
          depreciationAmount: 0,
          skipped: true,
          skipReason: "recorded_in_purchase",
        });
        continue;
      }

      const depreciationAmount = computePeriodBookDepreciation(asset, months);

      // FIRS capital allowance (parallel, tax-only, never posted to GL).
      const firs = computeFirsPeriodAllowance(asset, { periodMonths: months });

      if (depreciationAmount <= 0 && firs.allowance <= 0) {
        continue;
      }

      if (depreciationAmount > 0 && AssetTransaction) {
        await AssetTransaction.create({
          id: uuidv4(),
          assetId: asset.id,
          transactionType: "Depreciation",
          transactionDate: runDate,
          amount: depreciationAmount,
          description: `Bulk depreciation for ${asset.description}`,
          facilityId,
          createdBy,
          status: "Approved",
        });

        const cat = asset.category || "Other Assets";
        if (!categoryTotals[cat]) categoryTotals[cat] = { amount: 0, count: 0 };
        categoryTotals[cat].amount += depreciationAmount;
        categoryTotals[cat].count += 1;
      }

      const currentAccum = parseFloat(asset.accumulated_depreciation || 0);
      const newAccum = parseFloat((currentAccum + depreciationAmount).toFixed(2));
      const newNbv = parseFloat(
        (parseFloat(asset.acquisition_cost) - newAccum).toFixed(2),
      );

      await asset.update({
        accumulated_depreciation: newAccum,
        net_book_value: newNbv,
        last_depreciation_date:
          depreciationAmount > 0 ? runDate : asset.last_depreciation_date,
        firs_written_down_value: firs.newWrittenDownValue,
        firs_allowance_to_date: firs.newAllowanceToDate,
        updatedBy: createdBy,
      });

      totalBookDepreciation += depreciationAmount;
      totalFirsAllowance += firs.allowance;

      depreciationResults.push({
        assetId: asset.id,
        assetCode: asset.asset_code,
        description: asset.description,
        category: asset.category,
        depreciationAmount,
        newAccumulatedDepreciation: newAccum,
        newNetBookValue: newNbv,
        firsAllowance: firs.allowance,
        firsWrittenDownValue: firs.newWrittenDownValue,
      });
    } catch (error) {
      console.error(`Error processing depreciation for asset ${asset.id}:`, error);
    }
  }

  // Post ONE summarized journal grouped by category (book depreciation only).
  let journalRef = null;
  let ledgerWarning = null;
  if (Object.keys(categoryTotals).length > 0) {
    try {
      journalRef = await createBulkDepreciationJournal(
        categoryTotals,
        runDate,
        facilityId,
        { createdBy },
      );
      if (journalRef && AssetTransaction) {
        await AssetTransaction.update(
          { journalEntryId: journalRef },
          {
            where: {
              facilityId,
              transactionType: "Depreciation",
              transactionDate: runDate,
              journalEntryId: null,
            },
          },
        );
      }
    } catch (ledgerError) {
      console.error("Bulk depreciation GL posting failed:", ledgerError);
      ledgerWarning = ledgerError.message;
    }
  }

  return {
    processedAssets: depreciationResults.length,
    totalAssets: assets.length,
    totalBookDepreciation: parseFloat(totalBookDepreciation.toFixed(2)),
    totalFirsAllowance: parseFloat(totalFirsAllowance.toFixed(2)),
    journalRef,
    categoryTotals,
    results: depreciationResults,
    ledgerWarning,
    periodEndDate: runDate,
    periodMonths: months,
  };
};

exports.calculateBulkDepreciation = async (req, res) => {
  try {
    const {
      facilityId,
      periodEndDate,
      depreciationDate,
      assetIds,
      periodMonths = 1,
    } = req.body;
    const createdBy = req.user?.id || req.body.createdBy || "SYSTEM";

    const data = await exports.runBulkDepreciation({
      facilityId,
      periodEndDate,
      depreciationDate,
      assetIds,
      periodMonths,
      createdBy,
    });

    res.json({
      success: true,
      message: `Bulk depreciation processed for ${data.processedAssets} assets`,
      data,
      journalRef: data.journalRef,
      ledgerWarning: data.ledgerWarning,
    });
  } catch (error) {
    console.error("Error calculating bulk depreciation:", error);
    const status = error.statusCode || 500;
    res.status(status).json({
      success: false,
      message:
        status === 400
          ? error.message
          : "Error calculating bulk depreciation",
      error: error.message,
    });
  }
};

/**
 * Manually trigger the auto-depreciation cron logic.
 * body: { facilityId?, force?: boolean }
 * - If facilityId + force: run that facility now (ignores day/frequency gate)
 * - Else: run the scheduled check for all due businesses
 */
exports.triggerAutoDepreciation = async (req, res) => {
  try {
    const { facilityId, force } = req.body || {};
    const {
      runScheduledDepreciation,
      processFacility,
      FREQUENCY_MONTHS,
    } = require("../jobs/depreciationCron");

    if (facilityId && force) {
      const business = await db.business.findByPk(facilityId, {
        attributes: [
          "id",
          "business_name",
          "auto_depreciation_enabled",
          "auto_depreciation_frequency",
          "auto_depreciation_day",
          "auto_depreciation_last_run",
        ],
      });
      if (!business) {
        return res.status(404).json({
          success: false,
          message: "Business not found",
        });
      }
      const result = await processFacility(business);
      return res.json({
        success: true,
        message: `Auto depreciation forced for ${business.business_name || facilityId}`,
        data: {
          frequency: business.auto_depreciation_frequency,
          periodMonths:
            FREQUENCY_MONTHS[business.auto_depreciation_frequency] || 1,
          ...result,
        },
      });
    }

    const results = await runScheduledDepreciation();
    res.json({
      success: true,
      message: `Scheduled check complete — ${results.length} facility(ies) processed`,
      data: { results },
    });
  } catch (error) {
    console.error("Error triggering auto depreciation:", error);
    res.status(500).json({
      success: false,
      message: "Error triggering auto depreciation",
      error: error.message,
    });
  }
};

// ---------------------------------------------------------------------------
// Maintenance
// ---------------------------------------------------------------------------

const OPEN_MAINTENANCE_STATUSES = ['Scheduled', 'In Progress', 'Overdue'];

// Recalculate the asset status based on open maintenance records.
const syncAssetMaintenanceStatus = async (assetId, createdBy) => {
  try {
    const asset = await Asset.findByPk(assetId);
    if (!asset) return;
    // Never override a terminal status.
    if (['Disposed', 'Written Off'].includes(asset.status)) return;

    const openCount = await AssetMaintenance.count({
      where: { assetId, status: { [Op.in]: OPEN_MAINTENANCE_STATUSES } },
    });

    const nextStatus = openCount > 0 ? 'Under Maintenance' : 'Active';
    if (asset.status !== nextStatus && ['Active', 'Under Maintenance'].includes(asset.status)) {
      await asset.update({ status: nextStatus, updatedBy: createdBy || asset.updatedBy });
    }
  } catch (e) {
    console.warn('syncAssetMaintenanceStatus skipped:', e.message);
  }
};

// GET /api/assets/:id/maintenance
exports.getAssetMaintenance = async (req, res) => {
  try {
    const { id } = req.params;
    const records = await AssetMaintenance.findAll({
      where: { assetId: id },
      order: [['createdAt', 'DESC']],
    });
    const totalMaintenanceCost = records.reduce(
      (sum, m) => sum + parseFloat(m.cost || 0),
      0
    );
    res.json({
      success: true,
      data: { records, totalMaintenanceCost: parseFloat(totalMaintenanceCost.toFixed(2)) },
    });
  } catch (error) {
    console.error('Error fetching maintenance records:', error);
    res.status(500).json({ success: false, message: 'Error fetching maintenance records', error: error.message });
  }
};

// POST /api/assets/:id/maintenance
exports.createAssetMaintenance = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      maintenanceType,
      description,
      scheduledDate,
      actualDate,
      cost = 0,
      vendor,
      technician,
      status = 'Scheduled',
      priority = 'Medium',
      notes,
      nextMaintenanceDate,
      facilityId,
    } = req.body;

    const createdBy = req.user?.id || req.body.createdBy || 'SYSTEM';

    const asset = await Asset.findByPk(id);
    if (!asset) {
      return res.status(404).json({ success: false, message: 'Asset not found' });
    }
    if (!maintenanceType || !description) {
      return res.status(400).json({
        success: false,
        message: 'maintenanceType and description are required',
      });
    }

    const record = await AssetMaintenance.create({
      id: uuidv4(),
      assetId: id,
      maintenanceType,
      description,
      scheduledDate: scheduledDate || null,
      actualDate: actualDate || null,
      cost: cost || 0,
      vendor: vendor || null,
      technician: technician || null,
      status,
      priority,
      notes: notes || null,
      nextMaintenanceDate: nextMaintenanceDate || null,
      facilityId: facilityId || asset.facility_id,
      createdBy,
    });

    await syncAssetMaintenanceStatus(id, createdBy);

    res.status(201).json({
      success: true,
      message: 'Maintenance record created successfully',
      data: record,
    });
  } catch (error) {
    console.error('Error creating maintenance record:', error);
    res.status(500).json({ success: false, message: 'Error creating maintenance record', error: error.message });
  }
};

// PUT /api/assets/maintenance/:maintenanceId
exports.updateAssetMaintenance = async (req, res) => {
  try {
    const { maintenanceId } = req.params;
    const createdBy = req.user?.id || req.body.updatedBy || req.body.createdBy || 'SYSTEM';

    const record = await AssetMaintenance.findByPk(maintenanceId);
    if (!record) {
      return res.status(404).json({ success: false, message: 'Maintenance record not found' });
    }

    const fields = [
      'maintenanceType',
      'description',
      'scheduledDate',
      'actualDate',
      'cost',
      'vendor',
      'technician',
      'status',
      'priority',
      'notes',
      'nextMaintenanceDate',
    ];
    const updateData = {};
    fields.forEach((f) => {
      if (req.body[f] !== undefined) updateData[f] = req.body[f];
    });

    await record.update(updateData);
    await syncAssetMaintenanceStatus(record.assetId, createdBy);

    res.json({
      success: true,
      message: 'Maintenance record updated successfully',
      data: record,
    });
  } catch (error) {
    console.error('Error updating maintenance record:', error);
    res.status(500).json({ success: false, message: 'Error updating maintenance record', error: error.message });
  }
};

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------

const decorateAsset = (asset) => {
  const data = asset.toJSON();
  const cost = parseFloat(data.acquisition_cost || 0);
  const accum = parseFloat(data.accumulated_depreciation || 0);
  const nbv = data.net_book_value != null ? parseFloat(data.net_book_value) : cost - accum;
  return {
    ...data,
    accumulatedDepreciation: parseFloat(accum.toFixed(2)),
    netBookValue: parseFloat(nbv.toFixed(2)),
  };
};

// GET /api/assets/reports/register
exports.getAssetRegisterReport = async (req, res) => {
  try {
    const { facilityId, category, location, status } = req.query;
    if (!facilityId) {
      return res.status(400).json({ success: false, message: 'facilityId is required' });
    }
    const where = { facility_id: facilityId };
    if (category) where.category = category;
    if (location) where.location = location;
    if (status) where.status = status;

    const assets = await Asset.findAll({ where, order: [['category', 'ASC'], ['asset_code', 'ASC']] });
    const rows = assets.map(decorateAsset);

    const totals = rows.reduce(
      (acc, a) => {
        acc.cost += parseFloat(a.acquisition_cost || 0);
        acc.accumulatedDepreciation += a.accumulatedDepreciation;
        acc.netBookValue += a.netBookValue;
        return acc;
      },
      { cost: 0, accumulatedDepreciation: 0, netBookValue: 0 }
    );

    res.json({
      success: true,
      data: {
        assets: rows,
        totals: {
          cost: parseFloat(totals.cost.toFixed(2)),
          accumulatedDepreciation: parseFloat(totals.accumulatedDepreciation.toFixed(2)),
          netBookValue: parseFloat(totals.netBookValue.toFixed(2)),
        },
      },
    });
  } catch (error) {
    console.error('Error generating register report:', error);
    res.status(500).json({ success: false, message: 'Error generating register report', error: error.message });
  }
};

// GET /api/assets/reports/depreciation-schedule?startDate=&endDate=
exports.getDepreciationScheduleReport = async (req, res) => {
  try {
    const { facilityId, startDate, endDate } = req.query;
    if (!facilityId) {
      return res.status(400).json({ success: false, message: 'facilityId is required' });
    }
    const where = {
      facilityId,
      transactionType: 'Depreciation',
    };
    if (startDate && endDate) {
      where.transactionDate = { [Op.between]: [startDate, endDate] };
    } else if (startDate) {
      where.transactionDate = { [Op.gte]: startDate };
    } else if (endDate) {
      where.transactionDate = { [Op.lte]: endDate };
    }

    const transactions = await AssetTransaction.findAll({
      where,
      order: [['transactionDate', 'ASC']],
    });

    const total = transactions.reduce((sum, t) => sum + parseFloat(t.amount || 0), 0);

    res.json({
      success: true,
      data: {
        transactions,
        total: parseFloat(total.toFixed(2)),
      },
    });
  } catch (error) {
    console.error('Error generating depreciation schedule report:', error);
    res.status(500).json({ success: false, message: 'Error generating depreciation schedule report', error: error.message });
  }
};

// GET /api/assets/reports/movements?startDate=&endDate=
exports.getMovementsReport = async (req, res) => {
  try {
    const { facilityId, startDate, endDate } = req.query;
    if (!facilityId) {
      return res.status(400).json({ success: false, message: 'facilityId is required' });
    }
    const where = {
      facilityId,
      transactionType: { [Op.in]: ['Acquisition', 'Transfer', 'Disposal'] },
    };
    if (startDate && endDate) {
      where.transactionDate = { [Op.between]: [startDate, endDate] };
    } else if (startDate) {
      where.transactionDate = { [Op.gte]: startDate };
    } else if (endDate) {
      where.transactionDate = { [Op.lte]: endDate };
    }

    const transactions = await AssetTransaction.findAll({
      where,
      order: [['transactionDate', 'ASC']],
    });

    const additions = transactions.filter((t) => t.transactionType === 'Acquisition');
    const transfers = transactions.filter((t) => t.transactionType === 'Transfer');
    const disposals = transactions.filter((t) => t.transactionType === 'Disposal');

    res.json({
      success: true,
      data: {
        additions,
        transfers,
        disposals,
        summary: {
          additions: additions.length,
          transfers: transfers.length,
          disposals: disposals.length,
        },
      },
    });
  } catch (error) {
    console.error('Error generating movements report:', error);
    res.status(500).json({ success: false, message: 'Error generating movements report', error: error.message });
  }
};

// GET /api/assets/reports/fully-depreciated
exports.getFullyDepreciatedReport = async (req, res) => {
  try {
    const { facilityId } = req.query;
    if (!facilityId) {
      return res.status(400).json({ success: false, message: 'facilityId is required' });
    }
    const assets = await Asset.findAll({
      where: { facility_id: facilityId, status: 'Active' },
      order: [['asset_code', 'ASC']],
    });

    const rows = assets
      .map(decorateAsset)
      .filter((a) => {
        const residual = parseFloat(a.residual_value || 0);
        const cost = parseFloat(a.acquisition_cost || 0);
        return a.netBookValue <= residual || a.accumulatedDepreciation >= cost - residual;
      });

    res.json({ success: true, data: { assets: rows, count: rows.length } });
  } catch (error) {
    console.error('Error generating fully-depreciated report:', error);
    res.status(500).json({ success: false, message: 'Error generating fully-depreciated report', error: error.message });
  }
};

// GET /api/assets/reports/maintenance-costs?thresholdPct=30
exports.getMaintenanceCostsReport = async (req, res) => {
  try {
    const { facilityId } = req.query;
    const thresholdPct = parseFloat(req.query.thresholdPct || 30);
    if (!facilityId) {
      return res.status(400).json({ success: false, message: 'facilityId is required' });
    }

    const assets = await Asset.findAll({ where: { facility_id: facilityId } });
    const rows = [];

    for (const asset of assets) {
      const records = await AssetMaintenance.findAll({ where: { assetId: asset.id } });
      if (records.length === 0) continue;
      const totalCost = records.reduce((sum, m) => sum + parseFloat(m.cost || 0), 0);
      const cost = parseFloat(asset.acquisition_cost || 0);
      const pctOfCost = cost > 0 ? (totalCost / cost) * 100 : 0;
      rows.push({
        assetId: asset.id,
        assetCode: asset.asset_code,
        description: asset.description,
        category: asset.category,
        acquisitionCost: cost,
        totalMaintenanceCost: parseFloat(totalCost.toFixed(2)),
        maintenanceCount: records.length,
        pctOfCost: parseFloat(pctOfCost.toFixed(2)),
        flagged: pctOfCost > thresholdPct,
      });
    }

    rows.sort((a, b) => b.totalMaintenanceCost - a.totalMaintenanceCost);

    res.json({
      success: true,
      data: {
        assets: rows,
        thresholdPct,
        flaggedCount: rows.filter((r) => r.flagged).length,
      },
    });
  } catch (error) {
    console.error('Error generating maintenance-costs report:', error);
    res.status(500).json({ success: false, message: 'Error generating maintenance-costs report', error: error.message });
  }
};