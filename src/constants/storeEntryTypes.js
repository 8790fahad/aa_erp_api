/**
 * Movement / transaction type for store_entries.type
 * (distinct from products.item_type — product category).
 */
const STORE_ENTRY_TYPE = {
  SALES: "sales",
  SERVICE: "service",
  PRO_BONO: "pro-bono",
  PURCHASE: "purchase",
  OPENING_BALANCE: "opening_balance",
  PRODUCTION: "production",
  /** Raw material / WIP qty_out used when production completes */
  CONSUMED: "consumed",
  /** Raw material issued to WIP on material requisition (not yet consumed) */
  MATERIAL_ISSUE: "material_issue",
  TRANSFER: "transfer",
  ADJUSTMENT: "adjustment",
  /** Customer return inward — qty back into stock */
  SALES_RETURN: "sales_return",
  /** Goods returned to supplier — qty out of stock */
  PURCHASE_RETURN: "purchase_return",
};

/** Types that count as sales outflows (goods, services, pro-bono). */
const SALES_TYPES = [
  STORE_ENTRY_TYPE.SALES,
  STORE_ENTRY_TYPE.SERVICE,
  STORE_ENTRY_TYPE.PRO_BONO,
];

/** Legacy store_entries.type values that should be treated as sales outflows. */
const LEGACY_SALES_TYPE_ALIASES = ["Service"];

const PURCHASE_TYPES = [STORE_ENTRY_TYPE.PURCHASE];

/** Product item_type values that were incorrectly stored in store_entries.type */
const LEGACY_PRODUCT_TYPE_VALUES = [
  "Raw Material",
  "Finished Good",
  "By-Product",
  "Resalable",
  "Semi Finished",
  "Service",
  "WIP",
  "Goods Transfer",
  "WIP Return",
  "WIP Write-off",
  "Raw Material Return",
  "Write-off",
  "Mixture Consumption",
  "Semi Finished Production",
];

const salesTypesSqlList = () =>
  [...SALES_TYPES, ...LEGACY_SALES_TYPE_ALIASES]
    .map((t) => `'${t}'`)
    .join(", ");

/**
 * Resolve store entry type for a sale line.
 * Payment mode (cash vs credit) is tracked elsewhere — movement type is sales, service,
 * or pro-bono when applicable.
 */
function saleStoreEntryType({ isProBono = false, isService = false } = {}) {
  if (isProBono) return STORE_ENTRY_TYPE.PRO_BONO;
  if (isService) return STORE_ENTRY_TYPE.SERVICE;
  return STORE_ENTRY_TYPE.SALES;
}

module.exports = {
  STORE_ENTRY_TYPE,
  SALES_TYPES,
  PURCHASE_TYPES,
  LEGACY_PRODUCT_TYPE_VALUES,
  LEGACY_SALES_TYPE_ALIASES,
  salesTypesSqlList,
  saleStoreEntryType,
};
