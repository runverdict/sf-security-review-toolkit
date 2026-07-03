# Test companion for python-ldap-injection-taint (semgrep --test).
# An annotation on the line above a match asserts it MUST fire; the safe-line
# annotation asserts it MUST stay silent.
from flask import request
import ldap
from ldap.filter import escape_filter_chars
from ldap3 import Connection, Server
from ldap3.utils.conv import escape_filter_chars as l3_escape


def vuln_search_s(conn):
    uid = request.args.get("uid")
    # ruleid: python-ldap-injection-taint
    return conn.search_s("ou=people,dc=x,dc=y", ldap.SCOPE_SUBTREE, "(uid=" + uid + ")")


def vuln_search_ext_s(conn):
    uid = request.form["uid"]
    # ruleid: python-ldap-injection-taint
    return conn.search_ext_s("dc=x", ldap.SCOPE_SUBTREE, "(uid=" + uid + ")")


def vuln_search_st(conn):
    uid = request.GET.get("uid")
    # ruleid: python-ldap-injection-taint
    return conn.search_st("dc=x", ldap.SCOPE_SUBTREE, "(uid=" + uid + ")")


def vuln_filterstr_keyword(conn):
    uid = request.args["uid"]
    # ruleid: python-ldap-injection-taint
    return conn.search_s("dc=x", ldap.SCOPE_SUBTREE, filterstr="(uid=" + uid + ")")


def vuln_ldap3_positional(server):
    # `Connection` here resolves to ldap3.Connection (imported above) — the gate matches.
    uid = request.args.get("uid")
    conn = Connection(server)
    # ruleid: python-ldap-injection-taint
    conn.search("dc=x", "(uid=" + uid + ")")


def vuln_ldap3_keyword(server):
    uid = request.args["uid"]
    conn = Connection(server)
    # ruleid: python-ldap-injection-taint
    conn.search("dc=x", search_filter="(uid=" + uid + ")", search_scope="SUBTREE")


def safe_escaped(conn):
    uid = escape_filter_chars(request.args.get("uid"))
    # ok: python-ldap-injection-taint
    return conn.search_s("dc=x", ldap.SCOPE_SUBTREE, "(uid=" + uid + ")")


def safe_ldap3_escaped(server):
    uid = l3_escape(request.args.get("uid"))
    conn = Connection(server)
    # ok: python-ldap-injection-taint
    conn.search("dc=x", search_filter="(uid=" + uid + ")")


def safe_literal(conn):
    # ok: python-ldap-injection-taint
    return conn.search_s("dc=x", ldap.SCOPE_SUBTREE, "(uid=admin)")


# ---- benign collisions the name/receiver gate must keep OUT of the band ----
def not_ldap_odoo(Model):
    limit = request.args.get("limit")
    # ok: python-ldap-injection-taint
    return Model.search([("active", "=", True)], 0, limit)


def not_ldap_elasticsearch(es):
    size = request.args.get("size")
    # ok: python-ldap-injection-taint
    return es.search("my-index", "_doc", size)


def not_ldap_regex(pattern):
    flags = request.args.get("flags")
    # ok: python-ldap-injection-taint
    return pattern.search("needle", "text", flags)


def not_ldap_widget(widget):
    # a non-ldap3 receiver with a search_filter= kwarg must not fire (gate requires ldap3.Connection)
    term = request.args.get("q")
    # ok: python-ldap-injection-taint
    return widget.search(dataset="x", search_filter=term)


class SqlConnection:  # a same-shaped in-house "Connection" that is NOT ldap3
    def search(self, table, query):
        return []


def not_ldap_inhouse_connection():
    q = request.args.get("q")
    conn = SqlConnection()
    # ok: python-ldap-injection-taint
    return conn.search("users", q)


def not_ldap_reporting_search_ext(svc):
    # `search_ext` (without the _s suffix) is not python-ldap-exclusive — dropped as a sink.
    term = request.args.get("q")
    # ok: python-ldap-injection-taint
    return svc.search_ext("base", "scope", term)


def safe_numeric(conn):
    # a value coerced to an int cannot carry LDAP filter metacharacters
    n = int(request.args.get("uidNumber"))
    # ok: python-ldap-injection-taint
    return conn.search_s("dc=x", ldap.SCOPE_SUBTREE, "(uidNumber=" + str(n) + ")")
