# Journal Entries API Documentation

## Overview

The Journal Entries module provides comprehensive functionality for creating, managing, and tracking accounting journal entries in Inventria. This module supports draft creation, posting, reversal, and audit trail capabilities.

## Table of Contents

1. [Features](#features)
2. [Database Schema](#database-schema)
3. [API Endpoints](#api-endpoints)
4. [Request/Response Examples](#requestresponse-examples)
5. [Validation Rules](#validation-rules)
6. [Permissions](#permissions)
7. [Error Handling](#error-handling)

---

## Features

- ✅ Create and edit draft journal entries
- ✅ Post/approve journal entries
- ✅ Reverse posted entries with automatic mirror entry creation
- ✅ Delete draft entries only
- ✅ Multi-currency support with exchange rates
- ✅ Comprehensive validation (balance, line entries, dates)
- ✅ Period locking enforcement
- ✅ Role-based permissions (admin, accountant, reader)
- ✅ CSV export functionality
- ✅ Complete audit trail
- ✅ Filter by status, date, account, reference

---

## Database Schema

### journal_entries Table

| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER | Primary key |
| reference_number | STRING(50) | Unique reference (e.g., JE-202401-00001) |
| entry_date | DATE | Journal entry date |
| description | TEXT | Entry description |
| status | ENUM | 'draft', 'posted', 'reversed' |
| total_debit | DECIMAL(20,2) | Total debit amount |
| total_credit | DECIMAL(20,2) | Total credit amount |
| facility_id | STRING(50) | Business/Facility ID |
| created_by | STRING(100) | Creator user ID |
| posted_by | STRING(100) | Approver user ID |
| posted_at | DATETIME | Post timestamp |
| reversed_by | STRING(100) | Reversal user ID |
| reversed_at | DATETIME | Reversal timestamp |
| reversal_of_id | INTEGER | Original entry ID (for reversals) |
| reversal_entry_id | INTEGER | Reversal entry ID |
| currency | STRING(3) | Currency code (ISO 4217) |
| exchange_rate | DECIMAL(20,6) | Exchange rate to base currency |
| notes | TEXT | Additional notes |

### journal_entry_lines Table

| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER | Primary key |
| journal_entry_id | INTEGER | Foreign key to journal_entries |
| line_number | INTEGER | Line order |
| account_code | STRING(255) | Chart of account code |
| account_name | STRING(300) | Account name |
| description | STRING(500) | Line description |
| debit | DECIMAL(20,2) | Debit amount |
| credit | DECIMAL(20,2) | Credit amount |
| currency | STRING(3) | Line currency |
| exchange_rate | DECIMAL(20,6) | Line exchange rate |
| base_debit | DECIMAL(20,2) | Debit in base currency |
| base_credit | DECIMAL(20,2) | Credit in base currency |

---

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/journals` | Create new journal entry |
| GET | `/api/journals` | Get all journal entries (with filters) |
| GET | `/api/journals/:id` | Get specific journal entry |
| PUT | `/api/journals/:id` | Update journal entry (drafts only) |
| DELETE | `/api/journals/:id` | Delete journal entry (drafts only) |
| POST | `/api/journals/:id/post` | Post/approve journal entry |
| POST | `/api/journals/:id/reverse` | Reverse posted journal entry |
| GET | `/api/journals/:id/export` | Export single entry to CSV |
| GET | `/api/journals/export` | Export multiple entries to CSV |

---

## Request/Response Examples

### 1. Create Journal Entry

**Request:**

```http
POST /api/journals
Content-Type: application/json

{
  "reference_number": "JE-202401-00001",
  "entry_date": "2024-01-15",
  "description": "Office supplies purchase",
  "facility_id": "FAC001",
  "user_id": "user@example.com",
  "user_role": "admin",
  "currency": "NGN",
  "exchange_rate": 1.0,
  "notes": "Monthly office supplies",
  "lines": [
    {
      "account_code": "5100",
      "account_name": "Office Supplies Expense",
      "description": "Printer paper and pens",
      "debit": 25000.00,
      "credit": 0
    },
    {
      "account_code": "1000",
      "account_name": "Cash",
      "description": "Payment for office supplies",
      "debit": 0,
      "credit": 25000.00
    }
  ]
}
```

**Response:**

```json
{
  "success": true,
  "message": "Journal entry created successfully",
  "data": {
    "id": 1,
    "reference_number": "JE-202401-00001",
    "entry_date": "2024-01-15",
    "description": "Office supplies purchase",
    "status": "draft",
    "total_debit": "25000.00",
    "total_credit": "25000.00",
    "facility_id": "FAC001",
    "created_by": "user@example.com",
    "currency": "NGN",
    "exchange_rate": "1.000000",
    "notes": "Monthly office supplies",
    "created_at": "2024-01-15T10:30:00.000Z",
    "updated_at": "2024-01-15T10:30:00.000Z",
    "lines": [
      {
        "id": 1,
        "journal_entry_id": 1,
        "line_number": 1,
        "account_code": "5100",
        "account_name": "Office Supplies Expense",
        "description": "Printer paper and pens",
        "debit": "25000.00",
        "credit": "0.00",
        "currency": "NGN",
        "exchange_rate": "1.000000",
        "base_debit": "25000.00",
        "base_credit": "0.00"
      },
      {
        "id": 2,
        "journal_entry_id": 1,
        "line_number": 2,
        "account_code": "1000",
        "account_name": "Cash",
        "description": "Payment for office supplies",
        "debit": "0.00",
        "credit": "25000.00",
        "currency": "NGN",
        "exchange_rate": "1.000000",
        "base_debit": "0.00",
        "base_credit": "25000.00"
      }
    ]
  }
}
```

### 2. Get Journal Entries (with filters)

**Request:**

```http
GET /api/journals?facility_id=FAC001&user_role=admin&status=draft&start_date=2024-01-01&end_date=2024-01-31&page=1&limit=50
```

**Response:**

```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "reference_number": "JE-202401-00001",
      "entry_date": "2024-01-15",
      "description": "Office supplies purchase",
      "status": "draft",
      "total_debit": "25000.00",
      "total_credit": "25000.00",
      "created_by": "user@example.com",
      "created_at": "2024-01-15T10:30:00.000Z",
      "lines": [...]
    }
  ],
  "pagination": {
    "total": 1,
    "page": 1,
    "limit": 50,
    "totalPages": 1
  }
}
```

### 3. Get Single Journal Entry

**Request:**

```http
GET /api/journals/1?facility_id=FAC001&user_role=admin
```

**Response:**

```json
{
  "success": true,
  "data": {
    "id": 1,
    "reference_number": "JE-202401-00001",
    "entry_date": "2024-01-15",
    "description": "Office supplies purchase",
    "status": "draft",
    "total_debit": "25000.00",
    "total_credit": "25000.00",
    "facility_id": "FAC001",
    "created_by": "user@example.com",
    "posted_by": null,
    "posted_at": null,
    "reversed_by": null,
    "reversed_at": null,
    "reversal_of_id": null,
    "reversal_entry_id": null,
    "currency": "NGN",
    "exchange_rate": "1.000000",
    "notes": "Monthly office supplies",
    "created_at": "2024-01-15T10:30:00.000Z",
    "updated_at": "2024-01-15T10:30:00.000Z",
    "lines": [
      {
        "id": 1,
        "line_number": 1,
        "account_code": "5100",
        "account_name": "Office Supplies Expense",
        "description": "Printer paper and pens",
        "debit": "25000.00",
        "credit": "0.00"
      },
      {
        "id": 2,
        "line_number": 2,
        "account_code": "1000",
        "account_name": "Cash",
        "description": "Payment for office supplies",
        "debit": "0.00",
        "credit": "25000.00"
      }
    ],
    "originalEntry": null,
    "reversalEntry": null
  }
}
```

### 4. Update Journal Entry (Draft Only)

**Request:**

```http
PUT /api/journals/1
Content-Type: application/json

{
  "reference_number": "JE-202401-00001",
  "entry_date": "2024-01-16",
  "description": "Office supplies purchase - Updated",
  "facility_id": "FAC001",
  "user_id": "user@example.com",
  "user_role": "admin",
  "currency": "NGN",
  "lines": [
    {
      "account_code": "5100",
      "account_name": "Office Supplies Expense",
      "debit": 30000.00,
      "credit": 0
    },
    {
      "account_code": "1000",
      "account_name": "Cash",
      "debit": 0,
      "credit": 30000.00
    }
  ]
}
```

**Response:**

```json
{
  "success": true,
  "message": "Journal entry updated successfully",
  "data": {
    "id": 1,
    "total_debit": "30000.00",
    "total_credit": "30000.00",
    "updated_at": "2024-01-16T14:20:00.000Z",
    ...
  }
}
```

### 5. Post Journal Entry

**Request:**

```http
POST /api/journals/1/post
Content-Type: application/json

{
  "facility_id": "FAC001",
  "user_id": "approver@example.com",
  "user_role": "admin"
}
```

**Response:**

```json
{
  "success": true,
  "message": "Journal entry posted successfully",
  "data": {
    "id": 1,
    "status": "posted",
    "posted_by": "approver@example.com",
    "posted_at": "2024-01-16T15:00:00.000Z",
    ...
  }
}
```

### 6. Reverse Journal Entry

**Request:**

```http
POST /api/journals/1/reverse
Content-Type: application/json

{
  "facility_id": "FAC001",
  "user_id": "admin@example.com",
  "user_role": "admin",
  "reversal_date": "2024-01-20"
}
```

**Response:**

```json
{
  "success": true,
  "message": "Journal entry reversed successfully",
  "data": {
    "id": 2,
    "reference_number": "REV-202401-00001",
    "entry_date": "2024-01-20",
    "description": "Reversal of JE-202401-00001: Office supplies purchase",
    "status": "posted",
    "reversal_of_id": 1,
    "posted_by": "admin@example.com",
    "posted_at": "2024-01-20T10:00:00.000Z",
    "lines": [
      {
        "account_code": "5100",
        "debit": "0.00",
        "credit": "25000.00"
      },
      {
        "account_code": "1000",
        "debit": "25000.00",
        "credit": "0.00"
      }
    ]
  }
}
```

### 7. Delete Journal Entry (Draft Only)

**Request:**

```http
DELETE /api/journals/1?facility_id=FAC001&user_role=admin
```

**Response:**

```json
{
  "success": true,
  "message": "Journal entry deleted successfully"
}
```

### 8. Export to CSV

**Request:**

```http
GET /api/journals/1/export?facility_id=FAC001&user_role=admin&format=csv
```

**Response:**

```csv
Reference Number,Entry Date,Description,Line Number,Account Code,Account Name,Line Description,Debit,Credit,Currency,Status
JE-202401-00001,2024-01-15,Office supplies purchase,1,5100,Office Supplies Expense,Printer paper and pens,25000.00,0.00,NGN,draft
JE-202401-00001,2024-01-15,Office supplies purchase,2,1000,Cash,Payment for office supplies,0.00,25000.00,NGN,draft
```

---

## Validation Rules

### Entry-Level Validation

1. **Reference Number**: Required, must be unique per facility
2. **Entry Date**: Required, cannot be in the future, must not be in locked period
3. **Balance**: Total debits must equal total credits
4. **Lines**: At least one line required

### Line-Level Validation

1. **Account Code**: Required
2. **Debit/Credit**:
   - Must have either debit OR credit, not both
   - Minimum amount: 0.01
   - Cannot both be zero
3. **Currency**: Valid ISO 4217 code
4. **Exchange Rate**: Must be > 0

### Status Restrictions

- **Draft**: Can be edited, deleted, or posted
- **Posted**: Read-only, can only be reversed
- **Reversed**: Read-only, no further actions allowed

---

## Permissions

### Admin & Accountant
- ✅ Create journal entries
- ✅ Edit draft entries
- ✅ Delete draft entries
- ✅ Post entries
- ✅ Reverse posted entries
- ✅ View all entries
- ✅ Export data

### Reader
- ✅ View entries
- ✅ Export data
- ❌ Create, edit, delete, post, or reverse

---

## Error Handling

### Common Error Responses

**400 - Validation Error**

```json
{
  "success": false,
  "message": "Validation failed",
  "errors": [
    {
      "field": "balance",
      "message": "Journal entry is not balanced. Debits: 1000.00, Credits: 900.00"
    },
    {
      "field": "lines[0].account_code",
      "message": "Account code is required"
    }
  ]
}
```

**403 - Permission Denied**

```json
{
  "success": false,
  "message": "Permission denied: reader cannot create journal entries"
}
```

**404 - Not Found**

```json
{
  "success": false,
  "message": "Journal entry not found"
}
```

**500 - Server Error**

```json
{
  "success": false,
  "message": "Failed to create journal entry",
  "error": "Database connection error"
}
```

---

## Integration with General Ledger

When a journal entry is **posted**, the system automatically:

1. Creates corresponding entries in the `general_ledger` table
2. Sets `transaction_ref` to `JE-{journal_entry_id}`
3. Applies exchange rates for multi-currency entries
4. Links entries to the original journal entry for audit trail

When a journal entry is **reversed**:

1. Creates a mirror journal entry with swapped debits/credits
2. Posts the reversal automatically to general ledger
3. Links original and reversal entries bidirectionally
4. Updates original entry status to "reversed"

---

## Best Practices

1. **Reference Numbers**: Use consistent format (e.g., JE-YYYYMM-XXXXX)
2. **Descriptions**: Provide clear, detailed descriptions for audit purposes
3. **Testing**: Always test in draft mode before posting
4. **Reversals**: Use reversals instead of editing posted entries
5. **Period Locks**: Implement period locking to prevent backdating
6. **Backup**: Always backup before bulk operations
7. **Permissions**: Assign appropriate roles to users

---

## Running Tests

```bash
# Run all journal entry tests
npm test -- journalEntry.test.js

# Run specific test suite
npm test -- journalEntry.test.js -t "Validation Tests"

# Run with coverage
npm test -- --coverage journalEntry.test.js
```

---

## Support

For issues or questions, contact:
- Technical Support: support@inventria.com
- Documentation: https://docs.inventria.com/journal-entries

---

**Version**: 1.0.0
**Last Updated**: January 2024













