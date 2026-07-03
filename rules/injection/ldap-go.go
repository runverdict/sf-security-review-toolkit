// Test companion for go-ldap-injection-taint (semgrep --test).
// An annotation on the line above a match asserts it MUST fire; the safe-line
// annotation asserts it MUST stay silent.
package sample

import (
	"fmt"
	"net/http"
	"net/url"
	"strconv"

	"github.com/go-ldap/ldap/v3"
	"github.com/gorilla/mux"
)

func vulnFormValue(r *http.Request) {
	uid := r.FormValue("uid")
	// ruleid: go-ldap-injection-taint
	req := ldap.NewSearchRequest("dc=x", ldap.ScopeWholeSubtree, ldap.NeverDerefAliases, 0, 0, false, "(uid="+uid+")", nil, nil)
	_ = req
}

func vulnMuxVars(r *http.Request) {
	vars := mux.Vars(r)
	uid := vars["uid"]
	// ruleid: go-ldap-injection-taint
	req := ldap.NewSearchRequest("dc=x", ldap.ScopeWholeSubtree, ldap.NeverDerefAliases, 0, 0, false, "(uid="+uid+")", nil, nil)
	_ = req
}

func vulnStructLiteral(r *http.Request) {
	uid := r.FormValue("uid")
	// ruleid: go-ldap-injection-taint
	req := &ldap.SearchRequest{BaseDN: "dc=x", Filter: "(uid=" + uid + ")"}
	_ = req
}

func safeEscaped(r *http.Request) {
	uid := ldap.EscapeFilter(r.FormValue("uid"))
	// ok: go-ldap-injection-taint
	req := ldap.NewSearchRequest("dc=x", ldap.ScopeWholeSubtree, ldap.NeverDerefAliases, 0, 0, false, "(uid="+uid+")", nil, nil)
	_ = req
}

func safeLiteral() {
	// ok: go-ldap-injection-taint
	req := ldap.NewSearchRequest("dc=x", ldap.ScopeWholeSubtree, ldap.NeverDerefAliases, 0, 0, false, "(uid=admin)", nil, nil)
	_ = req
}

// ---- benign name collision: a local package-level NewSearchRequest, not go-ldap ----
func NewSearchRequest(index, sortField, term string, a, b int, c bool, query string, x, y []string) string {
	return query
}

func notLdapLocalHelper(r *http.Request) {
	term := r.FormValue("term")
	// ok: go-ldap-injection-taint
	_ = NewSearchRequest("idx", "b", "c", 0, 5, false, "term:"+term, nil, nil)
}

// ---- benign: value coerced to an int cannot inject; the strconv sanitizer must silence it ----
func notLdapNumeric(r *http.Request) {
	uid, _ := strconv.Atoi(r.FormValue("uid"))
	filter := fmt.Sprintf("(uidNumber=%d)", uid)
	// ok: go-ldap-injection-taint
	req := ldap.NewSearchRequest("dc=x", ldap.ScopeWholeSubtree, ldap.NeverDerefAliases, 0, 0, false, filter, nil, nil)
	_ = req
}

// ---- benign: a same-named FormValue on a non-*http.Request type must not be a source ----
type ConfigForm struct{}

func (c *ConfigForm) FormValue(k string) string { return "admin" }

func notLdapConfigForm(c *ConfigForm) {
	v := c.FormValue("uid")
	// ok: go-ldap-injection-taint
	req := ldap.NewSearchRequest("dc=x", ldap.ScopeWholeSubtree, ldap.NeverDerefAliases, 0, 0, false, "(uid="+v+")", nil, nil)
	_ = req
}

// ---- benign: a config struct with a URL field is not an *http.Request source ----
type Upstream struct{ URL *url.URL }

func notLdapUpstream(u *Upstream) {
	q := u.URL.Query().Get("x")
	// ok: go-ldap-injection-taint
	req := ldap.NewSearchRequest("dc=x", ldap.ScopeWholeSubtree, ldap.NeverDerefAliases, 0, 0, false, "(uid="+q+")", nil, nil)
	_ = req
}
