# Journal Entries Module - Complete Implementation

## 📋 Overview

A comprehensive Journal Entries module for Inventria's accounting system, providing full CRUD operations, posting, reversals, and audit trails for double-entry bookkeeping.

## ✨ Features

### Core Functionality
- ✅ **Create & Edit** draft journal entries with dynamic line items
- ✅ **Post/Approve** entries to make them permanent
- ✅ **Reverse** posted entries with automatic mirror entry creation
- ✅ **Delete** draft entries (posted entries cannot be deleted)
- ✅ **Multi-currency** support with exchange rate conversion
- ✅ **CSV Export** for single or batch entries
- ✅ **Audit Trail** - tracks who created, posted, and reversed entries

### Validation & Controls
- ✅ **Balance Validation** - Debits must equal credits
- ✅ **Line Validation** - Each line must have debit XOR credit (≥ 0.01)
- ✅ **Date Validation** - Prevents future dating and locked period entry
- ✅ **Reference Uniqueness** - Enforces unique reference numbers per facility
- ✅ **Status Protection** - Posted entries are read-only

### Permissions
- ✅ **Admin & Accountant** - Full access (create, edit, post, reverse, delete, view, export)
- ✅ **Reader** - View and export only

### UI/UX
- ✅ **List View** - Filterable by status, date range, reference, account
- ✅ **Form View** - Dynamic line items with real-time balance calculation
- ✅ **Detail View** - Complete entry display with action buttons
- ✅ **Responsive Design** - Mobile-friendly interface
- ✅ **Visual Indicators** - Status badges, balance warnings, audit information

---

## 📁 File Structure

```
flowbooks_api/
├── src/
│   ├── migrations/
│   │   └── 20240101000000-create-journal-entries.js     # Database schema
│   ├── models/
│   │   ├── JournalEntry.js                              # Entry header model
│   │   └── JournalEntryLine.js                          # Entry lines model
│   ├── controller/
│   │   └── journalEntryController.js                    # API endpoints
│   ├── services/
│   │   └── journalEntryService.js                       # Business logic
│   ├── routes/
│   │   └── journalEntries.js                            # Route definitions
│   ├── utils/
│   │   └── journalValidation.js                         # Validation utilities
│   └── tests/
│       └── journalEntry.test.js                         # Unit & integration tests
│
└── src/models/inventria_v2/src/components/
    ├── pages/account/
    │   ├── JournalEntryList.jsx                         # List page
    │   ├── JournalEntryForm.jsx                         # Create/Edit form
    │   └── JournalEntryDetail.jsx                       # Detail view
    └── sidebars/
        └── sidebarModules.jsx                           # Navigation menu

docs/
├── JOURNAL_ENTRIES_API.md                               # API documentation
├── JOURNAL_ENTRIES_SETUP.md                             # Setup guide
└── JOURNAL_ENTRIES_README.md                            # This file
```

---

## 🗄️ Database Schema

### Tables Created

#### `journal_entries`
Primary table storing journal entry headers with status tracking and audit fields.

**Key Fields:**
- `id` - Primary key
- `reference_number` - Unique reference (e.g., JE-202401-00001)
- `entry_date` - Transaction date
- `status` - draft | posted | reversed
- `total_debit` / `total_credit` - Entry totals
- `facility_id` - Multi-tenancy support
- Audit fields: `created_by`, `posted_by`, `reversed_by` with timestamps
- Reversal tracking: `reversal_of_id`, `reversal_entry_id`

#### `journal_entry_lines`
Detail table storing individual debit/credit lines.

**Key Fields:**
- `journal_entry_id` - Foreign key to parent entry
- `line_number` - Line ordering
- `account_code` - Chart of accounts reference
- `debit` / `credit` - Line amounts
- `currency` / `exchange_rate` - Multi-currency support
- `base_debit` / `base_credit` - Converted amounts

---

## 🔌 API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/journals` | Create journal entry |
| `GET` | `/api/journals` | List entries (with filters) |
| `GET` | `/api/journals/:id` | Get specific entry |
| `PUT` | `/api/journals/:id` | Update draft entry |
| `DELETE` | `/api/journals/:id` | Delete draft entry |
| `POST` | `/api/journals/:id/post` | Post/approve entry |
| `POST` | `/api/journals/:id/reverse` | Reverse posted entry |
| `GET` | `/api/journals/:id/export` | Export single entry (CSV) |
| `GET` | `/api/journals/export` | Export multiple entries (CSV) |

**Query Parameters (List):**
- `facility_id` - Required
- `user_role` - Required (admin/accountant/reader)
- `status` - Filter by draft/posted/reversed
- `start_date` / `end_date` - Date range filter
- `account_code` - Filter by account
- `reference` - Search by reference number
- `page` / `limit` - Pagination

---

## 🎯 Quick Start

### 1. Run Database Migration

```bash
cd flowbooks_api
npx sequelize-cli db:migrate --name 20240101000000-create-journal-entries.js
```

### 2. Install Dependencies

```bash
npm install json2csv --save
```

### 3. Register Routes

Add to your main app file:

```javascript
require('./src/routes/journalEntries')(app);
```

### 4. Test the API

```bash
# Create a test entry
curl -X POST http://localhost:3000/api/journals \
  -H "Content-Type: application/json" \
  -d '{
    "reference_number": "TEST-001",
    "entry_date": "2024-01-15",
    "facility_id": "YOUR_FACILITY_ID",
    "user_id": "test@example.com",
    "user_role": "admin",
    "lines": [
      {"account_code": "1000", "debit": 1000, "credit": 0},
      {"account_code": "4000", "debit": 0, "credit": 1000}
    ]
  }'
```

### 5. Access UI

Navigate to: `/app/account/journal-entries`

---

## 🧪 Testing

### Run Tests

```bash
# All tests
npm test

# Journal entry tests only
npm test -- journalEntry.test.js

# With coverage
npm test -- --coverage journalEntry.test.js
```

### Test Coverage

- ✅ Validation tests (balance, line entries, amounts)
- ✅ CRUD operations
- ✅ Post and reverse operations
- ✅ Permission tests
- ✅ Error handling
- ✅ Date filtering
- ✅ CSV export

---

## 📝 Usage Examples

### Create Simple Journal Entry

```javascript
const entry = {
  reference_number: "JE-202401-00001",
  entry_date: "2024-01-15",
  description: "Office supplies purchase",
  facility_id: "FAC001",
  user_id: "user@example.com",
  user_role: "admin",
  lines: [
    {
      account_code: "5100",
      account_name: "Office Supplies Expense",
      debit: 25000,
      credit: 0
    },
    {
      account_code: "1000",
      account_name: "Cash",
      debit: 0,
      credit: 25000
    }
  ]
};

const response = await axios.post('/api/journals', entry);
```

### Multi-line Entry

```javascript
const entry = {
  reference_number: "JE-202401-00002",
  entry_date: "2024-01-15",
  description: "Invoice payment with discount",
  facility_id: "FAC001",
  user_id: "user@example.com",
  user_role: "admin",
  lines: [
    {
      account_code: "2000",
      account_name: "Accounts Payable",
      debit: 100000,
      credit: 0
    },
    {
      account_code: "5200",
      account_name: "Discount Received",
      debit: 0,
      credit: 5000
    },
    {
      account_code: "1000",
      account_name: "Cash",
      debit: 0,
      credit: 95000
    }
  ]
};
```

### Post Entry

```javascript
await axios.post(`/api/journals/${entryId}/post`, {
  facility_id: "FAC001",
  user_id: "approver@example.com",
  user_role: "admin"
});
```

### Reverse Entry

```javascript
await axios.post(`/api/journals/${entryId}/reverse`, {
  facility_id: "FAC001",
  user_id: "admin@example.com",
  user_role: "admin",
  reversal_date: "2024-01-20"
});
```

---

## 🔐 Security & Permissions

### Role-Based Access Control

```javascript
// Defined in src/utils/journalValidation.js
const permissions = {
  admin: ["create", "edit", "post", "reverse", "delete", "view", "export"],
  accountant: ["create", "edit", "post", "reverse", "delete", "view", "export"],
  reader: ["view", "export"]
};
```

### Status-Based Protection

- **Draft** - Can be edited, deleted, posted
- **Posted** - Read-only, can only be reversed
- **Reversed** - Read-only, no further actions

---

## 🔄 Integration with General Ledger

### Automatic GL Posting

When a journal entry is posted:

1. Creates entries in `general_ledger` table
2. Sets `transaction_ref` = `JE-{entry_id}`
3. Sets `type` = `expenses` (configurable)
4. Applies exchange rates for multi-currency
5. Links to journal entry for audit trail

### Reversal Handling

When an entry is reversed:

1. Creates mirror journal entry with swapped debits/credits
2. Posts reversal automatically to GL
3. Links original ↔ reversal bidirectionally
4. Updates original status to "reversed"

---

## 🎨 UI Components

### List Page (`JournalEntryList.jsx`)

**Features:**
- Search by reference number
- Filter by status (draft/posted/reversed)
- Date range filtering
- Pagination
- Actions: View, Edit (drafts), Delete (drafts)
- Bulk CSV export

### Form Page (`JournalEntryForm.jsx`)

**Features:**
- Dynamic line item management
- Real-time balance calculation
- Visual balance indicator
- Account code selection (if COA available)
- Debit/Credit validation (XOR enforcement)
- Error display
- Auto-save prevention if not balanced

### Detail Page (`JournalEntryDetail.jsx`)

**Features:**
- Complete entry display
- Status indicator
- Action buttons (Edit, Post, Reverse based on status/role)
- Audit trail section
- Line items table
- CSV export
- Navigation to related entries (original/reversal)

---

## ⚡ Performance Considerations

### Database Indexes

```sql
-- Already created in migration
CREATE INDEX idx_journal_entries_facility ON journal_entries(facility_id);
CREATE INDEX idx_journal_entries_status ON journal_entries(status);
CREATE INDEX idx_journal_entries_date ON journal_entries(entry_date);
CREATE INDEX idx_journal_lines_entry ON journal_entry_lines(journal_entry_id);
CREATE INDEX idx_journal_lines_account ON journal_entry_lines(account_code);
```

### Pagination

Default: 50 entries per page (configurable)

### Batch Operations

CSV export handles up to 10,000 records per request

---

## 🐛 Common Issues & Solutions

### Issue: "Not balanced" error
**Solution**: Ensure sum of debits equals sum of credits exactly

### Issue: Cannot edit posted entry
**Solution**: This is by design. Use reversal instead.

### Issue: Reference number already exists
**Solution**: Use unique reference numbers per facility

### Issue: Permission denied
**Solution**: Check user role is 'admin' or 'accountant' for write operations

---

## 📚 Documentation

- **[API Documentation](./JOURNAL_ENTRIES_API.md)** - Complete API reference with examples
- **[Setup Guide](./JOURNAL_ENTRIES_SETUP.md)** - Installation and configuration
- **[Test Documentation](../src/tests/journalEntry.test.js)** - Test cases and coverage

---

## 🚀 Future Enhancements

Potential additions:
- [ ] Recurring journal entries
- [ ] Templates for common entries
- [ ] Bulk import from CSV/Excel
- [ ] Advanced reporting and analytics
- [ ] Workflow approval chains
- [ ] Attachment support (receipts, invoices)
- [ ] Email notifications on post/reversal
- [ ] Integration with budgeting module

---

## 📊 System Requirements

- **Backend**: Node.js >= 14.x, Express.js
- **Database**: MySQL/MariaDB 5.7+
- **Frontend**: React >= 16.8, React Router v6
- **Dependencies**: Sequelize ORM, json2csv, axios

---

## 🤝 Contributing

To contribute improvements:

1. Follow existing code structure
2. Add tests for new features
3. Update documentation
4. Ensure validation rules are comprehensive
5. Test with multiple user roles

---

## 📞 Support

- **Email**: support@inventria.com
- **Documentation**: https://docs.inventria.com
- **Issues**: GitHub Issues

---

## 📜 License

Part of Inventria ERP System
© 2024 Inventria. All rights reserved.

---

## ✅ Completion Checklist

When deploying, verify:

- [ ] Database migration completed
- [ ] All models load correctly
- [ ] API endpoints responding
- [ ] UI accessible via sidebar
- [ ] Can create draft entry
- [ ] Can post entry
- [ ] Can reverse entry
- [ ] Cannot edit posted entry
- [ ] Can delete draft only
- [ ] Permissions enforced
- [ ] CSV export works
- [ ] General ledger integration working
- [ ] Tests passing
- [ ] Documentation reviewed

---

**Version**: 1.0.0
**Created**: January 2024
**Status**: ✅ Production Ready













