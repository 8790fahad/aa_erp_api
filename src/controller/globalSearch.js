const { Op } = require("sequelize");
const db = require("../models");

const LIMIT_PER_GROUP = 8;

/**
 * System-wide search: invoices, customers, suppliers, products.
 * GET /api/v1/global-search?facilityId=&q=
 */
exports.globalSearch = async (req, res) => {
  try {
    const facilityId = String(req.query.facilityId || "").trim();
    const q = String(req.query.q || req.query.search || "")
      .trim()
      .slice(0, 100);

    if (!facilityId) {
      return res.status(400).json({
        success: false,
        message: "facilityId is required",
      });
    }
    if (q.length < 1) {
      return res.json({
        success: true,
        results: { invoices: [], customers: [], suppliers: [], products: [] },
      });
    }

    const like = { [Op.like]: `%${q}%` };
    const results = {
      invoices: [],
      customers: [],
      suppliers: [],
      products: [],
    };

    const tasks = [];

    if (db.SaleWorkflow) {
      tasks.push(
        db.SaleWorkflow.findAll({
          where: {
            facility_id: facilityId,
            [Op.or]: [
              { sale_code: like },
              { customer_name: like },
              { customer_no: like },
            ],
          },
          attributes: [
            "sale_code",
            "customer_name",
            "customer_no",
            "payment_type",
            "status",
            "amount",
          ],
          order: [["updated_at", "DESC"]],
          limit: LIMIT_PER_GROUP,
        })
          .then((rows) => {
            results.invoices = rows.map((r) => {
              const p = r.toJSON ? r.toJSON() : r;
              return {
                type: "invoice",
                id: p.sale_code,
                title: p.sale_code,
                subtitle: [p.customer_name, p.status, p.payment_type]
                  .filter(Boolean)
                  .join(" · "),
                href: `/app/sales/process?sale_code=${encodeURIComponent(p.sale_code)}`,
                meta: {
                  amount: Number(p.amount) || 0,
                  customer_no: p.customer_no,
                },
              };
            });
          })
          .catch((err) => {
            console.error("globalSearch invoices:", err.message);
          }),
      );
    }

    if (db.Customer) {
      tasks.push(
        db.Customer.findAll({
          where: {
            facilityId,
            [Op.or]: [
              { fullname: like },
              { company_name: like },
              { customerNo: like },
              { phone: like },
              { mobile: like },
              { email: like },
            ],
          },
          attributes: [
            "customerNo",
            "fullname",
            "company_name",
            "phone",
            "mobile",
            "email",
            "status",
          ],
          order: [["updatedAt", "DESC"]],
          limit: LIMIT_PER_GROUP,
        })
          .then((rows) => {
            results.customers = rows.map((r) => {
              const p = r.toJSON ? r.toJSON() : r;
              const name =
                p.fullname || p.company_name || p.customerNo || "Customer";
              return {
                type: "customer",
                id: p.customerNo,
                title: name,
                subtitle: [p.customerNo, p.phone || p.mobile, p.email]
                  .filter(Boolean)
                  .join(" · "),
                href: `/app/customers/${encodeURIComponent(p.customerNo)}`,
              };
            });
          })
          .catch((err) => {
            console.error("globalSearch customers:", err.message);
          }),
      );
    }

    if (db.SuppliersInfo) {
      tasks.push(
        db.SuppliersInfo.findAll({
          where: {
            facilityId,
            [Op.or]: [
              { supplier_name: like },
              { company_name: like },
              { supplier_number: like },
              { phone: like },
              { mobile: like },
              { email: like },
            ],
          },
          attributes: [
            "supplier_number",
            "supplier_name",
            "company_name",
            "phone",
            "mobile",
            "email",
            "status",
          ],
          order: [["supplier_name", "ASC"]],
          limit: LIMIT_PER_GROUP,
        })
          .then((rows) => {
            results.suppliers = rows.map((r) => {
              const p = r.toJSON ? r.toJSON() : r;
              const name =
                p.supplier_name ||
                p.company_name ||
                p.supplier_number ||
                "Supplier";
              return {
                type: "supplier",
                id: p.supplier_number,
                title: name,
                subtitle: [p.supplier_number, p.phone || p.mobile, p.email]
                  .filter(Boolean)
                  .join(" · "),
                href: `/app/suppliers?search=${encodeURIComponent(p.supplier_number || name)}`,
              };
            });
          })
          .catch((err) => {
            console.error("globalSearch suppliers:", err.message);
          }),
      );
    }

    if (db.Product) {
      tasks.push(
        db.Product.findAll({
          where: {
            facility_id: facilityId,
            [Op.or]: [{ name: like }, { sku: like }, { category: like }],
          },
          attributes: ["id", "name", "sku", "category", "status", "item_type"],
          order: [["name", "ASC"]],
          limit: LIMIT_PER_GROUP,
        })
          .then((rows) => {
            results.products = rows.map((r) => {
              const p = r.toJSON ? r.toJSON() : r;
              return {
                type: "product",
                id: String(p.id),
                title: p.name || p.sku || `Product ${p.id}`,
                subtitle: [p.sku, p.category, p.item_type, p.status]
                  .filter(Boolean)
                  .join(" · "),
                href: `/app/inventory/product-list?search=${encodeURIComponent(p.sku || p.name || "")}`,
              };
            });
          })
          .catch((err) => {
            console.error("globalSearch products:", err.message);
          }),
      );
    }

    await Promise.all(tasks);

    const total =
      results.invoices.length +
      results.customers.length +
      results.suppliers.length +
      results.products.length;

    return res.json({
      success: true,
      query: q,
      total,
      results,
    });
  } catch (err) {
    console.error("globalSearch:", err);
    return res.status(500).json({
      success: false,
      message: err.message || "Search failed",
    });
  }
};
