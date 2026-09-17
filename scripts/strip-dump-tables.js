const fs = require("fs");

const src = process.argv[2];
const dest = process.argv[3] || src;

const extra = process.argv.slice(4);
const DROP_DATA = new Set(
  extra.length
    ? extra
    : [
        "notifications",
        "general_ledger",
        "row_change_logs",
        "material_requisition_items",
        "wip_action_history",
        "logs",
        "store_entries",
        "sales",
        "sale_fulfillment_lines",
        "invoices",
        "sale_fulfillments",
      ],
);

const dumpRe = /^-- Dumping data for table `([^`]+)`\s*$/;
const sectionRe =
  /^-- (Dumping data for table|Table structure for table|Indexes for dumped tables|Indexes for table|Constraints for dumped tables|Constraints for table|AUTO_INCREMENT for dumped tables|AUTO_INCREMENT for table)/;

const original = fs.readFileSync(src, "utf8");
const lines = original.split(/\r?\n/);
const out = [];
let skipping = false;
let skipped = {};

for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  const dump = line.match(dumpRe);
  if (dump && DROP_DATA.has(dump[1])) {
    skipping = dump[1];
    skipped[skipping] = (skipped[skipping] || 0) + 1;
    // also drop the comment block just above: "--\n-- Dumping data...\n--"
    while (
      out.length &&
      (out[out.length - 1].trim() === "--" ||
        out[out.length - 1].trim() === "-- --------------------------------------------------------" ||
        out[out.length - 1].trim() === "")
    ) {
      out.pop();
    }
    continue;
  }
  if (skipping) {
    if (sectionRe.test(line) && !dumpRe.test(line)) {
      skipping = false;
      out.push("");
      out.push(line);
    }
    continue;
  }
  out.push(line);
}

const text = out.join("\n");
fs.writeFileSync(dest, text, "utf8");

function kb(n) {
  return (n / 1024).toFixed(1);
}
function mb(n) {
  return (n / 1024 / 1024).toFixed(2);
}

const before = Buffer.byteLength(original);
const after = Buffer.byteLength(text);
console.log(JSON.stringify({
  dest,
  tables_cleared: Object.keys(skipped),
  before_bytes: before,
  after_bytes: after,
  before_kb: kb(before),
  after_kb: kb(after),
  before_mb: mb(before),
  after_mb: mb(after),
  saved_mb: mb(before - after),
}, null, 2));
