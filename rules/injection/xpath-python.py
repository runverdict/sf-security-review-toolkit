# Test companion for python-xpath-injection-taint (semgrep --test).
# An annotation on the line above a match asserts it MUST fire; the safe-line
# annotation asserts it MUST stay silent.
from flask import request
from lxml import etree
import re
import xml.etree.ElementTree as ET


def vuln_lxml_element(doc):
    q = request.args.get("q")
    # ruleid: python-xpath-injection-taint
    return doc.xpath("//user[@name='" + q + "']")


def vuln_lxml_xpath_ctor(doc):
    name = request.values.get("name")
    # ruleid: python-xpath-injection-taint
    return etree.XPath("//user[@name='" + name + "']")(doc)


def vuln_et_findtext(path):
    q = request.args["q"]
    root = ET.fromstring("<r/>")
    # ruleid: python-xpath-injection-taint
    return root.findtext("./user[@id='" + q + "']")


def vuln_et_iterfind(path):
    q = request.GET.get("q")
    tree = ET.parse(path)
    # ruleid: python-xpath-injection-taint
    return list(tree.iterfind("./x[@n='" + q + "']"))


def vuln_et_findall_assigned(path):
    q = request.args.get("q")
    tree = ET.parse(path)
    # ruleid: python-xpath-injection-taint
    return tree.findall("./user[@name='" + q + "']")


def vuln_et_findall_inline(path):
    q = request.POST.get("q")
    # ruleid: python-xpath-injection-taint
    return ET.parse(path).findall("./user[@name='" + q + "']")


def safe_literal(doc):
    # ok: python-xpath-injection-taint
    return doc.xpath("//user[@name='admin']")


def safe_parameterized(doc):
    q = request.args.get("q")
    finder = etree.XPath("//user[@name=$n]", variables={"n": q})
    # ok: python-xpath-injection-taint
    return finder(doc)


def safe_parameterized_call(doc):
    q = request.args.get("q")
    finder = etree.XPath("//user[@name=$n]")
    # ok: python-xpath-injection-taint
    return finder(doc, n=q)


def not_xpath_str_find(haystack):
    q = request.args.get("q")
    # ok: python-xpath-injection-taint
    return haystack.find(q)


def not_xpath_re_findall():
    q = request.args.get("q")
    pat = re.compile("x")
    # ok: python-xpath-injection-taint
    return pat.findall(q)


def reassigned_to_str_then_find(data):
    # a parsed name rebound to a str before the call is str.find, NOT XPath — the
    # reassignment guard must keep this out of the injection-xss band.
    node = ET.fromstring(data)
    q = request.args.get("q")
    node = "default"
    # ok: python-xpath-injection-taint
    return node.find(q)


def reassigned_to_regex_then_findall(path):
    pat = ET.parse(path)
    q = request.args.get("q")
    pat = re.compile("x")
    # ok: python-xpath-injection-taint
    return pat.findall(q)


def safe_numeric_index(doc):
    # a value coerced to an int cannot inject XPath syntax
    n = int(request.args.get("n"))
    # ok: python-xpath-injection-taint
    return doc.xpath("//item[" + str(n) + "]")
