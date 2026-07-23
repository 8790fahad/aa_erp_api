"use strict";

module.exports = (sequelize, DataTypes) => {
  const Asset = sequelize.define(
    "assets",
    {
      id: {
        type: DataTypes.STRING(255),
        allowNull: false,
        primaryKey: true,
        defaultValue: DataTypes.UUIDV4,
      },
      facility_id: {
        type: DataTypes.STRING(255),
        allowNull: false,
        field: "facility_id",
      },
      department_id: {
        type: DataTypes.STRING(255),
        allowNull: true,
        field: "department_id",
      },
      asset_code: {
        type: DataTypes.STRING(255),
        allowNull: false,
        unique: true,
        field: "asset_code",
      },
      asset_name: {
        type: DataTypes.STRING(255),
        allowNull: true,
        field: "asset_name",
      },
      description: {
        type: DataTypes.STRING(255),
        allowNull: false,
      },
      category: {
        type: DataTypes.STRING(255),
        allowNull: false,
      },
      supplier_number: {
        type: DataTypes.STRING(255),
        allowNull: true,
        field: "supplier_number",
      },
      supplier_name: {
        type: DataTypes.STRING(255),
        allowNull: true,
        field: "supplier_name",
      },
      invoice_ref: {
        type: DataTypes.STRING(255),
        allowNull: true,
        field: "invoice_ref",
        comment: "Linked purchase bill / invoice reference",
      },
      attachment_urls: {
        type: DataTypes.TEXT,
        allowNull: true,
        field: "attachment_urls",
      },
      acquisition_date: {
        type: DataTypes.DATEONLY,
        allowNull: false,
        field: "acquisition_date",
      },
      acquisition_cost: {
        type: DataTypes.DECIMAL(15, 2),
        allowNull: false,
        field: "acquisition_cost",
      },
      useful_life_years: {
        type: DataTypes.INTEGER,
        allowNull: false,
        field: "useful_life_years",
      },
      residual_value: {
        type: DataTypes.DECIMAL(15, 2),
        allowNull: false,
        defaultValue: 0,
        field: "residual_value",
      },
      depreciation_method: {
        type: DataTypes.ENUM(
          "Straight Line",
          "Reducing Balance",
          "Units of Production",
          "Sum of Years Digits",
          "Double Declining Balance"
        ),
        allowNull: false,
        defaultValue: "Straight Line",
        field: "depreciation_method",
      },
      depreciation_rate: {
        type: DataTypes.DECIMAL(5, 2),
        allowNull: true,
        field: "depreciation_rate",
      },
      asset_account_code: {
        type: DataTypes.STRING(255),
        allowNull: false,
        field: "asset_account_code",
      },
      accumulated_depreciation_account_code: {
        type: DataTypes.STRING(255),
        allowNull: false,
        field: "accumulated_depreciation_account_code",
      },
      depreciation_expense_account_code: {
        type: DataTypes.STRING(255),
        allowNull: false,
        field: "depreciation_expense_account_code",
      },
      disposal_account_code: {
        type: DataTypes.STRING(255),
        allowNull: true,
        field: "disposal_account_code",
      },
      location: {
        type: DataTypes.STRING(255),
        allowNull: true,
      },
      custodian: {
        type: DataTypes.STRING(255),
        allowNull: true,
      },
      custodianId: {
        type: DataTypes.STRING(36),
        allowNull: true,
      },
      createdBy: {
        type: DataTypes.STRING(36),
        allowNull: true,
      },
      updatedBy: {
        type: DataTypes.STRING(36),
        allowNull: true,
      },
      status: {
        type: DataTypes.ENUM(
          "Active",
          "Disposed",
          "Impaired",
          "Under Maintenance",
          "Written Off"
        ),
        allowNull: false,
        defaultValue: "Active",
      },
      net_book_value: {
        type: DataTypes.DECIMAL(15, 2),
        allowNull: false,
        defaultValue: 0,
        field: "net_book_value",
      },
      accumulated_depreciation: {
        type: DataTypes.DECIMAL(15, 2),
        allowNull: false,
        defaultValue: 0,
        field: "accumulated_depreciation",
      },
      last_depreciation_date: {
        type: DataTypes.DATEONLY,
        allowNull: true,
        field: "last_depreciation_date",
      },
      disposal_date: {
        type: DataTypes.DATEONLY,
        allowNull: true,
        field: "disposal_date",
      },
      disposal_proceeds: {
        type: DataTypes.DECIMAL(15, 2),
        allowNull: true,
        field: "disposal_proceeds",
      },
      impairment_loss: {
        type: DataTypes.DECIMAL(15, 2),
        allowNull: true,
        field: "impairment_loss",
      },
      revaluation_surplus: {
        type: DataTypes.DECIMAL(15, 2),
        allowNull: true,
        field: "revaluation_surplus",
      },
      notes: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      firs_allowance_rate: {
        type: DataTypes.DECIMAL(5, 2),
        allowNull: true,
        field: "firs_allowance_rate",
      },
      firs_written_down_value: {
        type: DataTypes.DECIMAL(15, 2),
        allowNull: true,
        field: "firs_written_down_value",
      },
      firs_allowance_to_date: {
        type: DataTypes.DECIMAL(15, 2),
        allowNull: false,
        defaultValue: 0,
        field: "firs_allowance_to_date",
      },
    },
    {
      timestamps: true,
      createdAt: "created_at",
      updatedAt: "updated_at",
      freezeTableName: true,
      tableName: "assets",
    }
  );

  // Define associations
  Asset.associate = (models) => {
    // Custodian association
    // Asset.belongsTo(models.users, {
    //   foreignKey: 'custodianId',
    //   as: 'custodianUser',
    // });
    
    // Created by association
    // Asset.belongsTo(models.users, {
    //   foreignKey: 'createdBy',
    //   as: 'creator',
    // });
    
    // Updated by association
    // Asset.belongsTo(models.users, {
    //   foreignKey: 'updatedBy',
    //   as: 'updater',
    // });
  };

  // Instance methods for depreciation calculations
  Asset.prototype.calculateAccumulatedDepreciation = function() {
    const currentDate = new Date();
    const acquisitionDate = new Date(this.acquisition_date);
    const yearsElapsed = (currentDate - acquisitionDate) / (365.25 * 24 * 60 * 60 * 1000);
    
    const depreciableAmount = this.acquisition_cost - this.residual_value;
    
    switch (this.depreciation_method) {
      case 'Straight Line':
        const annualDepreciation = depreciableAmount / this.useful_life_years;
        return Math.min(annualDepreciation * yearsElapsed, depreciableAmount);
        
      case 'Reducing Balance':
        const rate = this.depreciation_rate / 100;
        let bookValue = this.acquisition_cost;
        let accumulated = 0;
        
        for (let year = 1; year <= Math.floor(yearsElapsed); year++) {
        const yearlyDepreciation = Math.min(
          bookValue * rate,
          Math.max(bookValue - this.residual_value, 0)
        );
          accumulated += yearlyDepreciation;
          bookValue -= yearlyDepreciation;
          
          if (bookValue <= this.residual_value) {
            accumulated = this.acquisition_cost - this.residual_value;
            break;
          }
        }
        
        return Math.min(accumulated, depreciableAmount);
        
      case 'Double Declining Balance':
        const ddbRate = (2 / this.useful_life_years);
        let ddbBookValue = this.acquisition_cost;
        let ddbAccumulated = 0;
        
        for (let year = 1; year <= Math.floor(yearsElapsed); year++) {
          const yearlyDepreciation = Math.min(
            ddbBookValue * ddbRate,
            ddbBookValue - this.residual_value
          );
          ddbAccumulated += yearlyDepreciation;
          ddbBookValue -= yearlyDepreciation;
          
          if (ddbBookValue <= this.residual_value) {
            break;
          }
        }
        
        return Math.min(ddbAccumulated, depreciableAmount);
        
      case 'Sum of Years Digits':
        const totalYears = this.useful_life_years;
        const sumOfYears = (totalYears * (totalYears + 1)) / 2;
        let sydAccumulated = 0;
        
        for (let year = 1; year <= Math.min(Math.floor(yearsElapsed), totalYears); year++) {
          const remainingYears = totalYears - year + 1;
          const yearlyDepreciation = (remainingYears / sumOfYears) * depreciableAmount;
          sydAccumulated += yearlyDepreciation;
        }
        
        return Math.min(sydAccumulated, depreciableAmount);
        
      case 'Units of Production':
        // This would require additional fields for units produced vs total expected units
        // For now, default to straight line
        const upAnnualDepreciation = depreciableAmount / this.useful_life_years;
        return Math.min(upAnnualDepreciation * yearsElapsed, depreciableAmount);
        
      default:
        return 0;
    }
  };

  Asset.prototype.calculateCurrentYearDepreciation = function() {
    const currentDate = new Date();
    const currentYear = currentDate.getFullYear();
    const acquisitionDate = new Date(this.acquisition_date);
    const acquisitionYear = acquisitionDate.getFullYear();
    
    if (currentYear < acquisitionYear) return 0;
    
    const depreciableAmount = this.acquisition_cost - this.residual_value;
    const yearsFromAcquisition = currentYear - acquisitionYear + 1;
    
    if (yearsFromAcquisition > this.useful_life_years) {
      return 0; // Asset is fully depreciated
    }
    
    switch (this.depreciation_method) {
      case 'Straight Line':
        const annualDepreciation = depreciableAmount / this.useful_life_years;
        
        if (currentYear === acquisitionYear) {
          const monthsInFirstYear = 12 - acquisitionDate.getMonth();
          return (annualDepreciation * monthsInFirstYear) / 12;
        }
        
        return annualDepreciation;
        
      case 'Reducing Balance':
        const rate = this.depreciation_rate / 100;
        let bookValue = this.acquisition_cost;
        
        // Calculate book value at start of current year
        for (let year = 1; year < yearsFromAcquisition; year++) {
          const yearlyDepreciation = bookValue * rate;
          bookValue -= yearlyDepreciation;
          
          if (bookValue <= this.residual_value) {
            return 0;
          }
        }
        
        const currentYearDepreciation = Math.min(
          bookValue * rate,
          bookValue - this.residual_value
        );
        
        return Math.max(currentYearDepreciation, 0);
        
      case 'Double Declining Balance':
        const ddbRate = (2 / this.useful_life_years);
        let ddbBookValue = this.acquisition_cost;
        
        // Calculate book value at start of current year
        for (let year = 1; year < yearsFromAcquisition; year++) {
          const yearlyDepreciation = Math.min(
            ddbBookValue * ddbRate,
            ddbBookValue - this.residual_value
          );
          ddbBookValue -= yearlyDepreciation;
          
          if (ddbBookValue <= this.residual_value) {
            return 0;
          }
        }
        
        const ddbCurrentYearDepreciation = Math.min(
          ddbBookValue * ddbRate,
          ddbBookValue - this.residual_value
        );
        
        return Math.max(ddbCurrentYearDepreciation, 0);
        
      case 'Sum of Years Digits':
        const totalYears = this.useful_life_years;
        const sumOfYears = (totalYears * (totalYears + 1)) / 2;
        const remainingYears = totalYears - yearsFromAcquisition + 1;
        
        if (remainingYears <= 0) {
          return 0;
        }
        
        const sydCurrentYearDepreciation = (remainingYears / sumOfYears) * depreciableAmount;
        return sydCurrentYearDepreciation;
        
      case 'Units of Production':
        // This would require additional fields for units produced vs total expected units
        // For now, default to straight line
        const upAnnualDepreciation = depreciableAmount / this.useful_life_years;
        
        if (currentYear === acquisitionYear) {
          const monthsInFirstYear = 12 - acquisitionDate.getMonth();
          return (upAnnualDepreciation * monthsInFirstYear) / 12;
        }
        
        return upAnnualDepreciation;
        
      default:
        return 0;
    }
  };

  return Asset;
};