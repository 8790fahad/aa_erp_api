# Journal Entries Module - Setup Guide

## Overview

This guide walks you through setting up the Journal Entries module in your Inventria installation.

---

## Prerequisites

- Node.js >= 14.x
- MySQL/MariaDB database
- Existing Inventria installation
- npm or yarn package manager

---

## Installation Steps

### 1. Database Migration

Run the migration to create journal entry tables:

```bash
# Navigate to your project directory
cd flowbooks_api

# Run migration
npx sequelize-cli db:migrate --migrations-path src/migrations --name 20240101000000-create-journal-entries.js
```

Or manually run the SQL:

```sql
-- Run the SQL commands from the migration file
SOURCE src/migrations/20240101000000-create-journal-entries.js
```

### 2. Install Dependencies

Ensure you have the required npm packages:

```bash
npm install json2csv --save
```

### 3. Register Routes

Add the journal entries routes to your main Express app file:

```javascript
// In your main app.js or routes/index.js
const journalEntryRoutes = require('./routes/journalEntries');

// Register routes
journalEntryRoutes(app);
```

### 4. Verify Models Load

Ensure Sequelize loads the new models on startup:

```bash
# Test that models are loaded
node -e "const db = require('./src/models'); console.log(db.JournalEntry ? 'JournalEntry loaded' : 'Model not found');"
```

### 5. Frontend Setup

#### Add React Router Routes

In your React Router configuration, add:

```javascript
import JournalEntryList from './components/pages/account/JournalEntryList';
import JournalEntryForm from './components/pages/account/JournalEntryForm';
import JournalEntryDetail from './components/pages/account/JournalEntryDetail';

// Add routes
<Route path="/app/account/journal-entries" element={<JournalEntryList />} />
<Route path="/app/account/journal-entries/new" element={<JournalEntryForm />} />
<Route path="/app/account/journal-entries/:id" element={<JournalEntryDetail />} />
<Route path="/app/account/journal-entries/:id/edit" element={<JournalEntryForm />} />
```

#### Verify Sidebar Updated

The sidebar should now show "Journal Entries" under the Account section. If not visible, ensure your app type has access to the Account module.

---

## Configuration

### Environment Variables

Add these optional configuration variables to your `.env` file:

```env
# Journal Entry Settings
JOURNAL_ENTRY_PREFIX=JE
JOURNAL_REVERSAL_PREFIX=REV
BASE_CURRENCY=NGN
ENABLE_PERIOD_LOCKING=true
```

### Period Locking (Optional)

If you want to implement period locking, create an accounting periods table:

```sql
CREATE TABLE accounting_periods (
  id INT PRIMARY KEY AUTO_INCREMENT,
  facility_id VARCHAR(50) NOT NULL,
  period_name VARCHAR(50) NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  is_locked BOOLEAN DEFAULT FALSE,
  locked_by VARCHAR(100),
  locked_at DATETIME,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_facility_date (facility_id, start_date, end_date)
);
```

Update the validation utility (`src/utils/journalValidation.js`) to uncomment the period locking check.

---

## Testing

### Run Unit Tests

```bash
# Run all tests
npm test

# Run journal entry tests specifically
npm test -- journalEntry.test.js

# Run with coverage
npm test -- --coverage
```

### Manual Testing

1. **Create a Draft Entry**
   ```bash
   curl -X POST http://localhost:3000/api/journals \
     -H "Content-Type: application/json" \
     -d '{
       "reference_number": "TEST-001",
       "entry_date": "2024-01-15",
       "facility_id": "YOUR_FACILITY_ID",
       "user_id": "test@example.com",
       "user_role": "admin",
       "lines": [
         {"account_code": "1000", "debit": 100, "credit": 0},
         {"account_code": "4000", "debit": 0, "credit": 100}
       ]
     }'
   ```

2. **Retrieve Entry**
   ```bash
   curl http://localhost:3000/api/journals/1?facility_id=YOUR_FACILITY_ID&user_role=admin
   ```

3. **Post Entry**
   ```bash
   curl -X POST http://localhost:3000/api/journals/1/post \
     -H "Content-Type: application/json" \
     -d '{
       "facility_id": "YOUR_FACILITY_ID",
       "user_id": "test@example.com",
       "user_role": "admin"
     }'
   ```

---

## User Roles Setup

Ensure your user management system recognizes these roles:

- **admin**: Full access to all journal entry operations
- **accountant**: Full access to all journal entry operations
- **reader**: Read and export only

Update user roles in your database:

```sql
-- Example: Update user role
UPDATE users
SET role = 'accountant'
WHERE email = 'accountant@example.com';
```

---

## Troubleshooting

### Issue: "Module not found" error

**Solution**: Ensure all files are in the correct directories:
- Controllers: `src/controller/journalEntryController.js`
- Services: `src/services/journalEntryService.js`
- Models: `src/models/JournalEntry.js` and `src/models/JournalEntryLine.js`
- Routes: `src/routes/journalEntries.js`
- Utils: `src/utils/journalValidation.js`

### Issue: Database migration fails

**Solution**:
1. Check database connection
2. Ensure you have CREATE TABLE privileges
3. Check for existing tables with same names
4. Review migration file syntax

```bash
# Drop tables if needed (CAUTION: This deletes data)
DROP TABLE IF EXISTS journal_entry_lines;
DROP TABLE IF EXISTS journal_entries;

# Re-run migration
npx sequelize-cli db:migrate
```

### Issue: Routes not working

**Solution**:
1. Verify routes are registered in app.js
2. Check for route conflicts
3. Ensure middleware is loaded (body-parser, etc.)

```javascript
// Add before routes
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
```

### Issue: "Permission denied" on all operations

**Solution**: Check that `user_role` is being passed correctly:

```javascript
// Frontend: Ensure user role is included
const response = await axios.post('/api/journals', {
  ...data,
  user_role: user.role // Make sure this is 'admin', 'accountant', or 'reader'
});
```

### Issue: Journal entries not appearing in General Ledger

**Solution**: Verify the entry is posted (status = 'posted'). Only posted entries create general ledger records.

```sql
-- Check journal entry status
SELECT id, reference_number, status FROM journal_entries;

-- Check if general ledger entries were created
SELECT * FROM general_ledger WHERE transaction_ref LIKE 'JE-%';
```

---

## Verification Checklist

After installation, verify:

- [ ] Database tables created successfully
- [ ] Can create draft journal entry via API
- [ ] Can view journal entries in UI
- [ ] Can edit draft entries
- [ ] Can post draft entries
- [ ] Posted entries appear in general ledger
- [ ] Can reverse posted entries
- [ ] Cannot edit posted entries
- [ ] Can delete draft entries only
- [ ] CSV export works
- [ ] Permissions enforced correctly
- [ ] Validation prevents unbalanced entries
- [ ] Sidebar navigation shows Journal Entries

---

## Performance Optimization

For large installations:

### 1. Add Database Indexes

```sql
-- Additional indexes for better query performance
CREATE INDEX idx_je_facility_date ON journal_entries(facility_id, entry_date);
CREATE INDEX idx_je_status_date ON journal_entries(status, entry_date);
CREATE INDEX idx_jel_account ON journal_entry_lines(account_code);
```

### 2. Enable Caching

Consider caching frequently accessed data:

```javascript
// Example: Cache account list
const NodeCache = require("node-cache");
const accountCache = new NodeCache({ stdTTL: 3600 }); // 1 hour

// In your account fetching logic
const cachedAccounts = accountCache.get(`accounts_${facilityId}`);
if (cachedAccounts) return cachedAccounts;
// ... fetch and cache
```

### 3. Pagination

Default pagination is set to 50 records per page. Adjust based on your needs:

```javascript
// In controller
const limit = parseInt(req.query.limit) || 50; // Increase if needed
```

---

## Backup Recommendations

Before going live:

1. **Backup existing general ledger**
   ```bash
   mysqldump -u username -p database_name general_ledger > backup_general_ledger.sql
   ```

2. **Test reversal process** thoroughly in staging

3. **Document your chart of accounts**

4. **Train users** on the new module

---

## Support & Resources

- **API Documentation**: See `JOURNAL_ENTRIES_API.md`
- **Issue Tracker**: GitHub Issues
- **Community**: Inventria Discord/Slack
- **Email Support**: support@inventria.com

---

## Next Steps

1. Review the [API Documentation](./JOURNAL_ENTRIES_API.md)
2. Train your accounting team
3. Set up period locking (if needed)
4. Configure backup schedules
5. Monitor performance and logs

---

**Version**: 1.0.0
**Last Updated**: January 2024













