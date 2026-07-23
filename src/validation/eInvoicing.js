"use strict";

/**
 * Joi schemas for NRS / FIRS e-invoicing endpoints.
 * Used by firsInvoice controller for request validation.
 */
const Joi = require("joi");

const dateYmd = Joi.string()
  .pattern(/^\d{4}-\d{2}-\d{2}$/)
  .messages({
    "string.pattern.base": "{{#label}} must be in YYYY-MM-DD format",
  });

const timeHms = Joi.string()
  .pattern(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/)
  .messages({
    "string.pattern.base": "{{#label}} must be in HH:MM:SS format",
  });

const nonNegNumber = Joi.number().min(0).required();
const positiveNumber = Joi.number().greater(0).required();

/** IRN: no SQL/LIKE metacharacters; bounded length. */
const irnSchema = Joi.string()
  .trim()
  .min(3)
  .max(120)
  .pattern(/^[A-Za-z0-9._\-]+$/)
  .required()
  .messages({
    "string.pattern.base":
      "{{#label}} may only contain letters, numbers, dot, underscore, and hyphen",
  });

const postalAddressSchema = Joi.object({
  street_name: Joi.string().trim().required(),
  city_name: Joi.string().trim().required(),
  postal_zone: Joi.string().trim().required(),
  country: Joi.string().trim().required(),
}).required();

const partySchema = Joi.object({
  party_name: Joi.string().trim().required(),
  tin: Joi.string().trim().required(),
  email: Joi.string().trim().email().required(),
  telephone: Joi.string().trim().required(),
  business_description: Joi.string().trim().allow(null, "").optional(),
  postal_address: postalAddressSchema,
}).required();

const invoiceLineSchema = Joi.object({
  isic_code: Joi.string().trim().allow(null, ""),
  service_category: Joi.string().trim().allow(null, ""),
  hsn_code: Joi.string().trim().allow(null, ""),
  product_category: Joi.string().trim().allow(null, ""),
  discount_rate: Joi.number().min(0).optional(),
  discount_amount: Joi.number().min(0).optional(),
  fee_rate: Joi.number().min(0).optional(),
  fee_amount: Joi.number().min(0).optional(),
  invoiced_quantity: positiveNumber,
  line_extension_amount: nonNegNumber,
  item: Joi.object({
    name: Joi.string().trim().required(),
    description: Joi.string().trim().required(),
    sellers_item_identification: Joi.string().trim().required(),
  }).required(),
  price: Joi.object({
    price_amount: nonNegNumber,
    base_quantity: positiveNumber,
    price_unit: Joi.string().trim().required(),
  }).required(),
})
  .custom((line, helpers) => {
    const hasService = Boolean(line.isic_code && String(line.isic_code).trim());
    const hasProduct = Boolean(line.hsn_code && String(line.hsn_code).trim());
    if (!hasService && !hasProduct) {
      return helpers.message(
        "invoice_line item requires isic_code (service) or hsn_code (product)",
      );
    }
    if (hasService && !(line.service_category && String(line.service_category).trim())) {
      return helpers.message(
        "service_category is required when isic_code is provided",
      );
    }
    if (hasProduct && !(line.product_category && String(line.product_category).trim())) {
      return helpers.message(
        "product_category is required when hsn_code is provided",
      );
    }
    return line;
  })
  .required();

const taxSubtotalSchema = Joi.object({
  taxable_amount: nonNegNumber,
  tax_amount: nonNegNumber,
  tax_category: Joi.object({
    id: Joi.string().trim().required(),
    percent: Joi.number().min(0).required(),
  }).required(),
}).required();

const taxTotalSchema = Joi.object({
  tax_amount: nonNegNumber,
  tax_subtotal: Joi.array().items(taxSubtotalSchema).min(1).required(),
}).required();

const createInvoiceSchema = Joi.object({
  business_id: Joi.string().trim().required(),
  irn: irnSchema.description(
    "Unique tracking number per invoice. Duplicates for the same business_id are rejected.",
  ),
  invoice_kind: Joi.string().valid("B2B", "B2G", "B2C").required(),
  issue_date: dateYmd.required(),
  due_date: dateYmd.required(),
  issue_time: timeHms.required(),
  invoice_type_code: Joi.string().trim().required(),
  payment_status: Joi.string()
    .valid("PENDING", "PAID", "REJECTED", "PARTIAL")
    .required(),
  tax_point_date: dateYmd.required(),
  document_currency_code: Joi.string().trim().required(),
  tax_currency_code: Joi.string().trim().required(),
  accounting_supplier_party: partySchema,
  accounting_customer_party: partySchema,
  invoice_line: Joi.array().items(invoiceLineSchema).min(1).required(),
  tax_total: Joi.array().items(taxTotalSchema).min(1).required(),
  legal_monetary_total: Joi.object({
    line_extension_amount: nonNegNumber,
    tax_exclusive_amount: nonNegNumber,
    tax_inclusive_amount: nonNegNumber,
    payable_amount: nonNegNumber,
  }).required(),
  billing_reference: Joi.array()
    .items(
      Joi.object({
        irn: irnSchema,
        issue_date: dateYmd.required(),
      }),
    )
    .optional(),
}).unknown(true);

const statusSchema = Joi.object({
  business_id: Joi.string().trim().required(),
  irn: irnSchema,
}).unknown(true);

const PAYMENT_NOTIFY_STATUSES = ["PENDING", "PAID", "REJECTED", "PARTIAL"];

const paymentNotifySchema = Joi.object({
  business_id: Joi.string().trim().required(),
  irn: irnSchema,
  payment_status: Joi.string()
    .valid(...PAYMENT_NOTIFY_STATUSES)
    .required()
    .messages({
      "any.only":
        "payment_status must be one of: PENDING, PAID, REJECTED, PARTIAL",
    }),
  amount: Joi.number().greater(0).optional(),
  payment_amount: Joi.number().greater(0).optional(),
  paid_amount: Joi.number().greater(0).optional(),
  reference: Joi.string().trim().allow("", null).optional(),
  payment_reference: Joi.string().trim().allow("", null).optional(),
})
  .unknown(true)
  .custom((value, helpers) => {
    const status = value.payment_status;
    const resolved =
      value.amount ?? value.payment_amount ?? value.paid_amount ?? null;
    if (status === "PARTIAL" && (resolved == null || resolved === "")) {
      return helpers.message(
        "amount is required when payment_status is PARTIAL",
      );
    }
    if (resolved != null && resolved !== "" && !(Number(resolved) > 0)) {
      return helpers.message("amount must be a positive number when provided");
    }
    return value;
  });

function formatJoiErrors(error) {
  if (!error || !error.details) return ["Validation failed"];
  return error.details.map((d) => d.message.replace(/"/g, ""));
}

/**
 * Validate value against a Joi schema.
 * @returns {{ ok: true, value } | { ok: false, details: string[] }}
 */
function validate(schema, value, options = {}) {
  const { error, value: validated } = schema.validate(value, {
    abortEarly: false,
    stripUnknown: false,
    convert: true,
    ...options,
  });
  if (error) {
    return { ok: false, details: formatJoiErrors(error) };
  }
  return { ok: true, value: validated };
}

module.exports = {
  createInvoiceSchema,
  statusSchema,
  paymentNotifySchema,
  PAYMENT_NOTIFY_STATUSES,
  validate,
  formatJoiErrors,
};
