// Clean rich text before showing it in Work Hub. Website text can contain anything (and a client could
// paste something nasty), so only simple formatting is kept — the same rules the server uses when publishing.
const ALLOWED = new Set(['P', 'BR', 'B', 'STRONG', 'I', 'EM', 'U', 'A', 'UL', 'OL', 'LI', 'H2', 'H3', 'H4', 'SPAN'])
const DROP = new Set(['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'TEMPLATE', 'NOSCRIPT', 'SVG', 'MATH'])
const SAFE_HREF = /^(https?:\/\/|mailto:|tel:|\/|#|\.\.?\/)/i

export function cleanRichText(html: string): string {
  // DOMParser makes an inert document: nothing in it runs or loads.
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html')
  const out = document.createElement('div')
  const walk = (from: Node, to: Node) => {
    from.childNodes.forEach((n) => {
      if (n.nodeType === Node.TEXT_NODE) { to.appendChild(document.createTextNode(n.textContent ?? '')); return }
      if (n.nodeType !== Node.ELEMENT_NODE) return
      const el = n as Element
      if (DROP.has(el.tagName)) return
      if (!ALLOWED.has(el.tagName)) { walk(el, to); return } // keep the words, lose the tag
      const copy = document.createElement(el.tagName.toLowerCase())
      if (el.tagName === 'A') {
        const href = (el.getAttribute('href') ?? '').trim()
        if (!SAFE_HREF.test(href)) { walk(el, to); return }
        copy.setAttribute('href', href)
        copy.setAttribute('target', '_blank')
        copy.setAttribute('rel', 'noopener')
      }
      to.appendChild(copy)
      walk(el, copy)
    })
  }
  walk(doc.body, out)
  return out.innerHTML
}

/** Plain words only, for short previews. */
export const textOnly = (html: string) =>
  (new DOMParser().parseFromString(html, 'text/html').body.textContent ?? '').replace(/\s+/g, ' ').trim()
