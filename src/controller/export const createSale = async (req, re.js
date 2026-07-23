export const createSale = async (req, res) => {
    const t = await db.sequelize.transaction();
    let saleRef, saleDate;
  
    try {
      // -------------------------------------------------------------------------
      // 1. EXTRACT & VALIDATE INPUT
      // -------------------------------------------------------------------------
      const {
        customer_id,
        items = [],
        discount_amount = 0,
        discount_info = {},
        tax_amount = 0,
        total_amount = 0,
        modeOfPayment = "CREDIT",
        txn_type = "Credit Sale",
        facilityId,
        created_by,
        receivable_code,
        receivable_accural_code,
        cost_of_sale,
        sale_revenue_code,
        finished_goods_code,
        taxes = [],
        due_date,
      } = req.body;
  
      if (
        !customer_id ||
        !items.length ||
        !facilityId ||
        !created_by ||
        txn_type !== "Credit Sale" ||
        modeOfPayment !== "CREDIT"
      ) {
        return res.status(400).json({
          success: false,
          message: "Invalid request: Must be Credit Sale with required fields",
        });
      }
  
      // -------------------------------------------------------------------------
      // 2. INITIALIZE
      // -------------------------------------------------------------------------
      saleDate = moment().format("YYYY-MM-DD");
      saleRef = `SALE-${await getAndUpdateNumber("sale", facilityId)}`;
      const transactionRef = `SALE-${saleRef}`;
  
      // -------------------------------------------------------------------------
      // 3. CUSTOMER & ACCOUNT RESOLUTION
      // -------------------------------------------------------------------------
      const customer = await db.Customer.findOne({
        where: { customerNo: customer_id, facilityId },
      });
      if (!customer) {
        await t.rollback();
        return res
          .status(404)
          .json({ success: false, message: "Customer not found" });
      }
  
      const customerReceivable = customer.receivable_code;
      const customerAccrual = customer.receivable_accural_code;
  
      const receivableHead = customerReceivable || receivable_code;
      if (!receivableHead) {
        await t.rollback();
        return res
          .status(400)
          .json({ success: false, message: "Receivable account head required" });
      }
  
      const receivableAccount = await db.Account.findOne({
        where: { head: receivableHead, facilityId },
      });
      if (!receivableAccount) {
        await t.rollback();
        return res.status(404).json({
          success: false,
          message: `Receivable account not found: ${receivableHead}`,
        });
      }
  
      let accrualAccount = null;
      if (customerAccrual || receivable_accural_code) {
        const accrualHead = customerAccrual || receivable_accural_code;
        accrualAccount = await db.Account.findOne({
          where: { head: accrualHead, facilityId },
        });
        if (!accrualAccount) {
          await t.rollback();
          return res.status(404).json({
            success: false,
            message: `Accrual account not found: ${accrualHead}`,
          });
        }
      }
  
      // Discount Account
      let discountAccount = null;
      if (discount_amount > 0 && discount_info?.discount_id) {
        discountAccount = await db.Discount.findOne({
          where: { discount_id: discount_info.discount_id, facilityId },
        });
        if (!discountAccount || !discountAccount.discount_account_head) {
          await t.rollback();
          return res
            .status(400)
            .json({ success: false, message: "Invalid discount configuration" });
        }
        const discountAcc = await db.Account.findOne({
          where: { head: discountAccount.discount_account_head, facilityId },
        });
        if (!discountAcc) {
          await t.rollback();
          return res
            .status(404)
            .json({ success: false, message: "Discount account not found" });
        }
        discountAccount = discountAcc;
      }
  
      // -------------------------------------------------------------------------
      // 4. HELPER: SAFE ACCOUNT LOOKUP
      // -------------------------------------------------------------------------
      const getAccount = async (headFromProduct, headFromBody, type) => {
        const head = headFromProduct || headFromBody;
        if (!head) throw new Error(`Missing ${type} account head`);
        const account = await db.Account.findOne({ where: { head, facilityId } });
        if (!account) throw new Error(`${type} account not found: ${head}`);
        return account;
      };
  
      // -------------------------------------------------------------------------
      // 5. PROCESS ITEMS & CALCULATE TOTALS
      // -------------------------------------------------------------------------
      const saleEntries = [];
      const storeEntries = [];
      const ledgerEntries = [];
      const customerEntries = [];
  
      let subtotal = 0;
      let totalCOGS = 0;
  
      for (const itm of items) {
        const qty = Number(itm.quantity_sold || itm.quantity || 0);
        const price = Number(itm.selling_price || itm.price || 0);
        const lineTotal = qty * price;
        const productId = itm.product_id;
        const itemType = itm.item_type || "Finished Good";
  
        if (!productId || qty <= 0 || price <= 0) {
          await t.rollback();
          return res
            .status(400)
            .json({ success: false, message: `Invalid item: ${productId}` });
        }
  
        const product = await db.Product.findOne({
          where: { sku: productId, facility_id: facilityId },
        });
        if (!product) {
          await t.rollback();
          return res
            .status(404)
            .json({ success: false, message: `Product not found: ${productId}` });
        }
  
        const costPrice = Number(
          itm.cost_price || product.cost_price || price * 0.8
        );
        subtotal += lineTotal;
  
        // Sale Record
        const sale = await db.Sale.create(
          {
            description: itm.item_name || product.name,
            productId: product.id,
            customerId: customer_id,
            quantity: qty,
            price,
            total: lineTotal,
            saleDate,
            status: "completed",
            createdAt: saleDate,
            updatedAt: saleDate,
          },
          { transaction: t }
        );
        saleEntries.push(sale);
  
        // Customer Entry (Sale)
        await db.CustomerEntry.create(
          {
            customerNo: customer.customerNo,
            description: itm.item_name || product.name,
            qty_in: 0,
            qty_out: qty,
            bank_account_id: 0,
            cost: price,
            facilityId,
            mode_of_payment: modeOfPayment,
            link_id: product.sku,
            receiptNo: saleRef,
            type: product.item_type === "Service" ? "service" : "purchase",
            created_by,
          },
          { transaction: t }
        );
  
        // Revenue (Credit)
        let revenueAccount;
        try {
          revenueAccount = await getAccount(
            product.revenue_account,
            sale_revenue_code,
            "Revenue"
          );
        } catch (err) {
          await t.rollback();
          return res.status(400).json({ success: false, message: err.message });
        }
  
        ledgerEntries.push({
          transaction_date: saleDate,
          account_code: revenueAccount.head,
          account_subhead: revenueAccount.subhead || 0,
          dr: 0,
          cr: lineTotal,
          account_description: revenueAccount.description,
          transaction_description: `Credit Sale - ${
            itm.item_name || product.name
          }`,
          reference_number: saleRef,
          purpose_of_payment: "Credit Sale",
          payee: customer.fullname,
          mode_of_payment: modeOfPayment,
          created_by,
          facility_id: facilityId,
          status: "posted",
          type: "revenue",
          transaction_ref: `${transactionRef}-REV-${sale.id}`,
        });
  
        // COGS & Inventory (Only for Finished Goods)
        if (itemType === "Finished Good") {
          const cogsAmount = qty * costPrice;
          totalCOGS += cogsAmount;
  
          let cogsAccount, inventoryAccount;
          try {
            cogsAccount = await getAccount(
              product.cogs_head,
              cost_of_sale,
              "COGS"
            );
            inventoryAccount = await getAccount(
              product.inventory_account,
              finished_goods_code,
              "Inventory"
            );
          } catch (err) {
            await t.rollback();
            return res.status(400).json({ success: false, message: err.message });
          }
  
          // Debit COGS
          ledgerEntries.push({
            transaction_date: saleDate,
            account_code: cogsAccount.head,
            account_subhead: cogsAccount.subhead || 0,
            dr: cogsAmount,
            cr: 0,
            account_description: cogsAccount.description,
            transaction_description: `COGS - ${saleRef}`,
            reference_number: saleRef,
            purpose_of_payment: "COGS",
            payee: customer.fullname,
            mode_of_payment: modeOfPayment,
            created_by,
            facility_id: facilityId,
            status: "posted",
            type: "expenses",
            transaction_ref: `${transactionRef}-COGS-${sale.id}`,
          });
  
          // Credit Inventory
          ledgerEntries.push({
            transaction_date: saleDate,
            account_code: inventoryAccount.head,
            account_subhead: inventoryAccount.subhead || 0,
            dr: 0,
            cr: cogsAmount,
            account_description: inventoryAccount.description,
            transaction_description: `Inventory Reduction - ${saleRef}`,
            reference_number: saleRef,
            purpose_of_payment: "Inventory",
            payee: customer.fullname,
            mode_of_payment: modeOfPayment,
            created_by,
            facility_id: facilityId,
            status: "posted",
            type: "inventory",
            transaction_ref: `${transactionRef}-INV-${sale.id}`,
          });
        }
  
        // Store Entry
        const store = await db.StoreEntry.create(
          {
            receive_date: saleDate,
            reference_number: saleRef,
            qty_in: 0,
            qty_out: qty,
            sale_no: saleRef,
            cost_price: costPrice,
            selling_price: price,
            branch_name: "Sales",
            inserted_by: created_by,
            facilityId,
            trn_number: saleRef,
            item_category: product.category,
            customer_code: customer_id,
            customer_name: customer.fullname,
            sales_type: "credit",
            source: "Finished Good",
            destination: "Customer",
            status: "approved",
            activation: "active",
            product_id: productId,
          },
          { transaction: t }
        );
        storeEntries.push(store);
      }
  
      // -------------------------------------------------------------------------
      // 6. CALCULATE NET AMOUNT (A/R Impact)
      // -------------------------------------------------------------------------
      const netAmount = subtotal - discount_amount + tax_amount;
  
      if (netAmount <= 0) {
        await t.rollback();
        return res
          .status(400)
          .json({ success: false, message: "Net sale amount must be positive" });
      }
  
      // -------------------------------------------------------------------------
      // 7. GET CUSTOMER BALANCE & DECIDE A/R vs ACCRUAL
      // -------------------------------------------------------------------------
      const previousBalance =
        parseFloat(await getBalance(customer_id, facilityId)) || 0;
      console.log(
        await getBalance(customer_id, facilityId),
        "===================>Previous balance"
      );
      // If customer has prepayment (positive balance), reduce it first
      if (previousBalance > 0 && accrualAccount) {
        const appliedToPrepayment = Math.min(previousBalance, netAmount);
        const remainingToReceivable = netAmount - appliedToPrepayment;
  
        // Reduce Accrual (Credit Accrual, Debit A/R indirectly via net)
        if (appliedToPrepayment > 0) {
          ledgerEntries.push({
            transaction_date: saleDate,
            account_code: accrualAccount.head,
            account_subhead: accrualAccount.subhead || 0,
            dr: appliedToPrepayment,
            cr: 0,
            account_description: accrualAccount.description,
            transaction_description: `Prepayment Applied - ${saleRef}`,
            reference_number: saleRef,
            purpose_of_payment: "Prepayment Utilization",
            payee: customer.fullname,
            mode_of_payment: modeOfPayment,
            created_by,
            facility_id: facilityId,
            status: "posted",
            type: "accrued",
            transaction_ref: `${transactionRef}-PREPAY`,
          });
  
          await db.CustomerEntry.create(
            {
              customerNo: customer.customerNo,
              description: `Prepayment Applied - ${saleRef}`,
              qty_in: 0,
              qty_out: 1,
              link_id: 0,
              bank_account_id: 0,
              cost: appliedToPrepayment,
              facilityId,
              mode_of_payment: modeOfPayment,
              receiptNo: saleRef,
  
              created_by,
            },
            { transaction: t }
          );
        }
  
        // Remaining goes to A/R
        if (remainingToReceivable > 0) {
          ledgerEntries.push({
            transaction_date: saleDate,
            account_code: receivableAccount.head,
            account_subhead: receivableAccount.subhead || 0,
            dr: remainingToReceivable,
            cr: 0,
            account_description: receivableAccount.description,
            transaction_description: `Credit Sale - A/R - ${saleRef}`,
            reference_number: saleRef,
            purpose_of_payment: "Credit Sale",
            payee: customer.fullname,
            mode_of_payment: modeOfPayment,
            created_by,
            facility_id: facilityId,
            status: "posted",
            type: "receivable",
            transaction_ref: `${transactionRef}-AR`,
          });
        }
      } else {
        // Normal case: full amount to A/R
        ledgerEntries.push({
          transaction_date: saleDate,
          account_code: receivableAccount.head,
          account_subhead: receivableAccount.subhead || 0,
          dr: netAmount,
          cr: 0,
          account_description: receivableAccount.description,
          transaction_description: `Credit Sale - ${saleRef}`,
          reference_number: saleRef,
          purpose_of_payment: "Credit Sale",
          payee: customer.fullname,
          mode_of_payment: modeOfPayment,
          created_by,
          facility_id: facilityId,
          status: "posted",
          type: "receivable",
          transaction_ref: `${transactionRef}-AR`,
        });
      }
  
      // -------------------------------------------------------------------------
      // 8. DISCOUNT & TAX ENTRIES
      // -------------------------------------------------------------------------
      if (discount_amount > 0 && discountAccount) {
        ledgerEntries.push({
          transaction_date: saleDate,
          account_code: discountAccount.head,
          account_subhead: discountAccount.subhead || 0,
          dr: discount_amount,
          cr: 0,
          account_description: discountAccount.description,
          transaction_description: `Sales Discount - ${saleRef}`,
          reference_number: saleRef,
          purpose_of_payment: "Sales Discount",
          payee: customer.fullname,
          mode_of_payment: modeOfPayment,
          created_by,
          facility_id: facilityId,
          status: "posted",
          type: "expenses",
          transaction_ref: `${transactionRef}-DISC`,
        });
  
        await db.CustomerEntry.create(
          {
            customerNo: customer.customerNo,
            description: `${discount_info.discount_name || "Discount"} (${
              discount_info.value
            }${discount_info.discount_type})`,
            qty_in: 1,
            qty_out: 0,
            cost: discount_amount,
            bank_account_id: 0,
            receiptNo: saleRef,
            facilityId,
            created_by,
            type: "discount",
            link_id: discount_info?.discount_id,
            mode_of_payment: modeOfPayment,
          },
          { transaction: t }
        );
      }
  
      if (tax_amount > 0 && taxes.length > 0) {
        for (const tax of taxes) {
          const taxRecord = await db.Tax.findOne({
            where: { id: tax.id, facilityId },
          });
          if (!taxRecord || !taxRecord.account_sub_head) {
            await t.rollback();
            return res
              .status(400)
              .json({ success: false, message: "Invalid tax config" });
          }
  
          const taxAccount = await db.Account.findOne({
            where: { head: taxRecord.account_sub_head, facilityId },
          });
          if (!taxAccount) {
            await t.rollback();
            return res
              .status(404)
              .json({ success: false, message: "Tax account not found" });
          }
  
          ledgerEntries.push({
            transaction_date: saleDate,
            account_code: taxAccount.head,
            account_subhead: taxAccount.subhead || 0,
            dr: 0,
            cr: tax.amount || tax_amount,
            account_description: taxAccount.description,
            transaction_description: `Output Tax - ${saleRef}`,
            reference_number: saleRef,
            purpose_of_payment: "Sales Tax",
            payee: customer.fullname,
            mode_of_payment: modeOfPayment,
            created_by,
            facility_id: facilityId,
            status: "posted",
            type: "tax",
            transaction_ref: `${transactionRef}-TAX-${tax.id}`,
          });
  
          await db.CustomerEntry.create(
            {
              customerNo: customer.customerNo,
              description: `${tax.description} (${tax.rate}${tax.rate_type})`,
              qty_in: 0,
              qty_out: 1,
              cost: tax.amount,
              bank_account_id: 0,
              created_by,
              receiptNo: saleRef,
              facilityId,
              type: "tax",
              link_id: tax.id,
              mode_of_payment: modeOfPayment,
            },
            { transaction: t }
          );
        }
      }
  
      // -------------------------------------------------------------------------
      // 9. SAVE ALL LEDGER ENTRIES
      // -------------------------------------------------------------------------
      for (const entry of ledgerEntries) {
        await db.GeneralLedger.create(entry, { transaction: t });
      }
  
      // -------------------------------------------------------------------------
      // 10. CREATE INVOICE RECORD
      // -------------------------------------------------------------------------
      // Build description from items
      const itemDescriptions = items
        .map(
          (itm) =>
            `${itm.quantity_sold || itm.quantity || 0}x ${
              itm.item_name || itm.product_id
            }`
        )
        .join(", ");
      const invoiceDescription =
        items.length === 1
          ? itemDescriptions
          : `Credit Sale - ${items.length} items: ${itemDescriptions}`;
  
      // Calculate due date (default to 30 days if not provided)
      const invoiceDueDate =
        due_date || moment(saleDate).add(30, "days").format("YYYY-MM-DD");
  
      await db.Invoice.create(
        {
          ref_number: customer.customerNo,
          invoice_ref: saleRef,
          due_date: invoiceDueDate,
          transaction_date: saleDate,
          tax_amount: tax_amount || 0,
          discount_amount: discount_amount || 0,
          description: invoiceDescription,
          amount: netAmount,
          created_by,
          facility_id: facilityId,
          type: "sales",
        },
        { transaction: t }
      );
  
      await t.commit();
  
      // -------------------------------------------------------------------------
      // 11. SUCCESS RESPONSE
      // -------------------------------------------------------------------------
      return res.status(200).json({
        success: true,
        message: "Credit sale processed successfully",
        sale_code: saleRef,
        net_amount: netAmount,
        applied_to_prepayment:
          previousBalance > 0 ? Math.min(previousBalance, netAmount) : 0,
        subtotal,
        discount: discount_amount,
        tax: tax_amount,
      });
    } catch (err) {
      console.error("createSale error:", {
        message: err.message,
        stack: err.stack,
        body: req.body,
        saleRef,
      });
      await t.rollback();
      return res.status(500).json({
        success: false,
        message: "Error processing credit sale",
        error: process.env.NODE_ENV === "development" ? err.message : undefined,
      });
    }
  };