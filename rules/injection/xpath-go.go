// Test companion for go-xpath-injection-taint (semgrep --test).
// An annotation on the line above a match asserts it MUST fire; the safe-line
// annotation asserts it MUST stay silent.
package sample

import (
	"fmt"
	"net/http"
	"net/url"
	"strconv"

	"github.com/antchfx/htmlquery"
	"github.com/antchfx/xmlquery"
	"github.com/beevik/etree"
	"github.com/gorilla/mux"
	"golang.org/x/net/html"
)

func vulnXmlqueryFind(r *http.Request, doc *xmlquery.Node) {
	name := r.FormValue("name")
	// ruleid: go-xpath-injection-taint
	xmlquery.Find(doc, "//user[@name='"+name+"']")
}

func vulnXmlqueryFindOne(r *http.Request, doc *xmlquery.Node) {
	q := r.URL.Query().Get("q")
	// ruleid: go-xpath-injection-taint
	xmlquery.FindOne(doc, "//x[@n='"+q+"']")
}

func vulnHtmlqueryFind(r *http.Request, doc *html.Node) {
	q := r.FormValue("q")
	// ruleid: go-xpath-injection-taint
	htmlquery.Find(doc, "//a[@id='"+q+"']")
}

func vulnEtreeFindElements(r *http.Request, el *etree.Element) {
	vars := mux.Vars(r)
	id := vars["id"]
	// ruleid: go-xpath-injection-taint
	el.FindElements("//user[@id='" + id + "']")
}

func vulnEtreeCompilePath(r *http.Request) {
	q := r.FormValue("q")
	// ruleid: go-xpath-injection-taint
	etree.CompilePath("//x[@n='" + q + "']")
}

func safeLiteral(el *etree.Element) {
	// ok: go-xpath-injection-taint
	el.FindElements("//user[@name='admin']")
}

// ---- benign method-name collision: FindElements on a non-etree receiver ----
type UITree struct{}

func (t *UITree) FindElements(label string) []int { return nil }

func notXpathUITree(r *http.Request, t *UITree) []int {
	label := r.FormValue("label")
	// ok: go-xpath-injection-taint
	return t.FindElements(label)
}

type Repo struct{}

func (repo *Repo) FindElements(name string) []int { return nil }

func notXpathRepo(r *http.Request, repo *Repo) []int {
	name := r.PostFormValue("name")
	// ok: go-xpath-injection-taint
	return repo.FindElements(name)
}

// ---- benign: value coerced to an int cannot inject; the strconv sanitizer must silence it ----
func notXpathNumeric(r *http.Request) {
	id, _ := strconv.Atoi(r.FormValue("id"))
	path := fmt.Sprintf("//user[@id=%d]", id)
	// ok: go-xpath-injection-taint
	etree.MustCompilePath(path)
}

// ---- benign: a same-named FormValue on a non-*http.Request type must not be a source ----
type ConfigForm struct{}

func (c *ConfigForm) FormValue(k string) string { return "admin" }

func notXpathConfigForm(c *ConfigForm, doc *xmlquery.Node) {
	v := c.FormValue("label")
	// ok: go-xpath-injection-taint
	xmlquery.Find(doc, "//user[@name='"+v+"']")
}

// ---- benign: a config struct with a URL field is not an *http.Request source ----
type Upstream struct{ URL *url.URL }

func notXpathUpstream(u *Upstream, doc *xmlquery.Node) {
	q := u.URL.Query().Get("x")
	// ok: go-xpath-injection-taint
	xmlquery.Find(doc, "//user[@name='"+q+"']")
}
