// Test companion for javascript-xpath-injection-taint (semgrep --test).
// An annotation on the line above a match asserts it MUST fire; the safe-line
// annotation asserts it MUST stay silent.
const xpath = require('xpath');

function vulnSelect(doc, req) {
  const name = req.query.name;
  // ruleid: javascript-xpath-injection-taint
  return xpath.select("//user[@name='" + name + "']", doc);
}

function vulnSelect1(doc, req) {
  const id = req.params.id;
  // ruleid: javascript-xpath-injection-taint
  return xpath.select1("//user[@id='" + id + "']", doc);
}

function vulnEvaluate(doc, req) {
  const q = req.body.q;
  // ruleid: javascript-xpath-injection-taint
  return xpath.evaluate("//x[@n='" + q + "']", doc, null, 0, null);
}

function safeLiteral(doc) {
  // ok: javascript-xpath-injection-taint
  return xpath.select("//user[@name='admin']", doc);
}

// server-side `document` is NOT the DOM — it is a formula/rules-engine object; a
// `document.evaluate` reached by req.* must stay OUT of the band.
function notDomEvaluate(document, req) {
  // ok: javascript-xpath-injection-taint
  return document.evaluate(req.query.expr);
}

// a value coerced to a number cannot inject XPath syntax
function safeNumericIndex(doc, req) {
  const n = parseInt(req.query.n, 10);
  // ok: javascript-xpath-injection-taint
  return xpath.select("//item[" + n + "]", doc);
}
