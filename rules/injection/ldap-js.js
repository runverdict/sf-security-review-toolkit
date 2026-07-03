// Test companion for javascript-ldap-injection-taint (semgrep --test).
// An annotation on the line above a match asserts it MUST fire; the safe-line
// annotation asserts it MUST stay silent.
const ldapjs = require('ldapjs');
const { Client } = require('ldapts');
const { createClient } = require('redis');
const es = require('@elastic/elasticsearch');
const ldapEscape = require('ldap-escape');

function vulnLdapjsFactory(req) {
  const client = ldapjs.createClient({ url: 'ldap://x' });
  const uid = req.query.uid;
  // ruleid: javascript-ldap-injection-taint
  client.search('ou=people,dc=x', { filter: '(uid=' + uid + ')', scope: 'sub' }, cb);
}

function vulnLdaptsClient(req) {
  const client = new Client({ url: 'ldap://x' });
  const uid = req.body.uid;
  // ruleid: javascript-ldap-injection-taint
  client.search('dc=x', { scope: 'sub', filter: '(uid=' + uid + ')' });
}

function safeEscaped(req) {
  const client = ldapjs.createClient({ url: 'ldap://x' });
  const uid = ldapEscape.filter`${req.query.uid}`;
  // ok: javascript-ldap-injection-taint
  client.search('dc=x', { filter: '(uid=' + uid + ')', scope: 'sub' }, cb);
}

function safeLiteral() {
  const client = ldapjs.createClient({ url: 'ldap://x' });
  // ok: javascript-ldap-injection-taint
  client.search('dc=x', { filter: '(uid=admin)', scope: 'sub' }, cb);
}

// ---- benign non-LDAP collisions: same shape / same factory name, different library ----
function notLdapMeili(index, req) {
  // ok: javascript-ldap-injection-taint
  index.search('star wars', { filter: req.query.genre, limit: 20 });
}

function notLdapElasticsearch(req) {
  // @elastic/elasticsearch Client (a same-named factory, resolved to a different module)
  const client = new es.Client({ node: 'x' });
  // ok: javascript-ldap-injection-taint
  client.search('products', { filter: req.body.q, scope: 'x' }, cb);
}

function notLdapRedisFactory(req) {
  // redis exports createClient too — import resolution keeps it out of the band
  const c = createClient({ url: 'x' });
  // ok: javascript-ldap-injection-taint
  c.search('/catalog', { filter: req.query.term, scope: 'team' }, cb);
}

function notLdapDataTable(table, req) {
  // ok: javascript-ldap-injection-taint
  table.search('name', { filter: req.params.term, scope: 'team' });
}

// a value coerced to a number cannot carry LDAP filter metacharacters
function safeNumeric(req) {
  const client = ldapjs.createClient({ url: 'ldap://x' });
  const n = parseInt(req.query.uidNumber, 10);
  // ok: javascript-ldap-injection-taint
  client.search('dc=x', { filter: '(uidNumber=' + n + ')', scope: 'sub' }, cb);
}
