const fs = require("fs");
const path = require("path");

function walk(d) {
  for (const n of fs.readdirSync(d)) {
    const p = path.join(d, n);
    const s = fs.statSync(p);
    if (s.isDirectory()) walk(p);
    else if (n.endsWith(".js")) {
      const t = fs.readFileSync(p, "utf8");
      if (t.includes("require('mysql')") || t.includes('require("mysql")')) {
        console.log("HIT", p);
      }
    }
  }
}
walk("node_modules/sequelize/lib");
console.log("done");
