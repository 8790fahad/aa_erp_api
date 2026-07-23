# Direct Purchase Consumables - Bug Fixes

## Issues Fixed

### 1. **Invalid ENUM Type Value**

**Problem:** The code was using `type: "inventory"` for GeneralLedger entries, but "inventory" was not in the ENUM definition.

**Fix:**

- Added `'inventory'` to the GeneralLedger model's `type` ENUM
- Created migration: `20251021-add-inventory-type-to-general-ledger.js`
- Updated `src/models/GeneralLedger.js` to include the new type

**Valid types now:**

- expenses
- bank
- payable
- prepayment
- accrued
- tax
- **inventory** (NEW)

### 2. **Incorrect Field Names in GeneralLedger.create()**

**Problem:** The code was manually setting `created_at` and `updated_at` timestamps, which Sequelize handles automatically.

**Fix:**

- Removed manual `created_at` and `updated_at` assignments
- Let Sequelize auto-manage timestamps (configured in model with `underscored: true`)

### 3. **Supplier Name Field Mismatch**

**Problem:** Code used `supplier.name` but the SuppliersInfo model uses `supplier_name`.

**Fix:**

- Changed to: `supplier.supplier_name || supplier.name` for backward compatibility
- Removed trailing spaces from variable assignments

### 4. **Missing Validation**

**Problem:** Transaction was started before validating required fields.

**Fix:** Added validation before starting transaction:

- facilityId (required)
- supplier_no (required)
- data array (must be non-empty)
- finished_goods_code (required)
- At least one of payable_code or payable_accrual_code (required)

### 5. **Weak Error Messages**

**Problem:** Generic error messages made debugging difficult.

**Fix:**

- Added specific validation messages
- Added console logging for debugging
- Added item-level error handling
- Added error stack traces in development mode

### 6. **Store Entry Fields**

**Problem:** Missing some required fields and inconsistent field values.

**Fix:**

- Added `mark_up: 0` field
- Changed destination from "Direct Purchase" to "Main Store"
- Changed po_no from empty string to "DIRECT"
- Added fallback for selling_price

### 7. **Item Processing Error Handling**

**Problem:** If one item failed, the entire batch would fail without indicating which item caused the issue.

**Fix:**

- Wrapped each item's processing in try-catch
- Added validation for quantity > 0
- Added validation for item_code/sku existence
- Throws specific error message with item name

## Testing

### Test Cases

1. **Valid Direct Purchase**

```json
{
  "facilityId": "FAC123",
  "supplier_no": "SUP001",
  "payable_code": "502001",
  "finished_goods_code": "104001",
  "narration": "Direct Purchase - Office Supplies",
  "user_id": "USER123",
  "data": [
    {
      "item_name": "Notebook",
      "item_code": "NOTE-001",
      "sku": "NOTE-001",
      "cost": 50.0,
      "quantity": 100,
      "price": 75.0
    }
  ]
}
```

**Expected Result:**

- ✅ Creates Store Entry
- ✅ Creates Supplier Entry
- ✅ Creates General Ledger Entries (Debit: Inventory, Credit: Payable)
- ✅ Creates Purchase Invoice
- ✅ Updates Product cost_price
- ✅ Returns success with transaction details

2. **Missing Required Fields**

```json
{
  "facilityId": "FAC123",
  "data": []
}
```

**Expected Result:**

- ❌ Returns 400 error: "supplier_no is required"

3. **Invalid Supplier**

```json
{
  "facilityId": "FAC123",
  "supplier_no": "INVALID",
  "data": [...]
}
```

**Expected Result:**

- ❌ Returns 404 error: "Supplier not found for code: INVALID"

4. **Invalid Account Code**

```json
{
  "facilityId": "FAC123",
  "supplier_no": "SUP001",
  "finished_goods_code": "INVALID",
  "data": [...]
}
```

**Expected Result:**

- ❌ Returns 404 error: "Inventory account not found for code: INVALID"

## Database Migrations Required

Run these migrations to fix the database schema:

```bash
cd /Users/mac/Documents/project/inventria workstation/flowbooks_api
npx sequelize-cli db:migrate
```

**Migrations:**

1. `20251021-add-inventory-type-to-general-ledger.js` - Adds 'inventory' to type ENUM

## API Endpoint

**POST** `/account/directPurchaseConsumables`

### Request Body

```typescript
{
  facilityId: string;         // Required
  supplier_no: string;        // Required
  payable_code?: string;      // Optional (either this or payable_accrual_code)
  payable_accrual_code?: string; // Optional (either this or payable_code)
  finished_goods_code: string; // Required
  narration?: string;         // Optional (default: "Direct Purchase - Consumables")
  user_id?: string;          // Optional (default: "SYSTEM")
  data: Array<{
    item_name: string;
    item_code?: string;
    sku?: string;
    cost: number;
    quantity: number;
    price?: number;
    selling_price?: number;
    category?: string;
    item_category?: string;
    expiry_date?: string;
    expiryDate?: string;
  }>;
}
```

### Response

```typescript
{
  success: true,
  message: string,
  data: {
    pv_code: string;
    total_amount: number;
    supplier_number: string;
    supplier_name: string;
    previous_balance: number;
    new_balance: number;
    items_processed: number;
    ledger_entries: number;
  }
}
```

## Accounting Logic

### Accrual-Based Purchase (Supplier has existing debt)

If supplier balance > 0:

1. Debit: Inventory Account (Full Amount)
2. Credit: Accrued Payable (Up to existing balance)
3. Credit: Accounts Payable (Remaining amount)

**Example:**

- Purchase Amount: ₦10,000
- Supplier Previous Debt: ₦6,000
- Result:
  - Dr: Inventory ₦10,000
  - Cr: Accrued Payable ₦6,000
  - Cr: Accounts Payable ₦4,000

### Regular Purchase (No existing debt)

If supplier balance ≤ 0:

1. Debit: Inventory Account (Full Amount)
2. Credit: Accounts Payable (Full Amount)

**Example:**

- Purchase Amount: ₦10,000
- Result:
  - Dr: Inventory ₦10,000
  - Cr: Accounts Payable ₦10,000

## Error Handling

All errors now include:

- ✅ Specific error messages
- ✅ Error codes (400, 404, 500)
- ✅ Console logging for debugging
- ✅ Automatic transaction rollback
- ✅ Stack traces in development mode

## Notes

- All operations are wrapped in a database transaction
- If any step fails, all changes are rolled back
- Supplier balance is automatically calculated
- Product cost_price is updated for each item
- Multiple ledger entries are created based on supplier balance
