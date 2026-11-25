// Reading and changing the client's HTML pages.
//
// A page marks its editable parts with data-cms attributes, e.g.
//   <h1 data-cms="hero-title">Bright smiles</h1>
//   <p data-cms="intro" data-cms-label="Intro paragraph">We look after…</p>
//   <img data-cms="hero-photo" src="/images/hero.jpg" alt="Our clinic">
//   <a data-cms="book-button" href="/book">Book now</a>
//
// Reading uses node-html-parser. Writing uses Cloudflare's HTMLRewriter, which only touches the
// marked elements and leaves the rest of the file exactly as it was (spacing, comments, scripts).
import { parse, HTMLElement, TextNode, Node } from 'node-html-parser'

export type FieldType = 'text' | 'richtext' | 'image' | 'link'
export interface Field { key: string; type: FieldType; label: string; value: string; position: number }
export interface Edit { key: string; type: FieldType; value: string }

// Field names are kept simple so they're safe inside a CSS selector.
export const KEY_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/i

/** "hero-title" → "Hero title" */
const nice = (key: string) => {
  const s = key.replace(/[-_]+/g, ' ').trim()
  return s.charAt(0).toUpperCase() + s.slice(1)
}

/** Decode &amp; &lt; etc. for plain text fields. */
function decode(s: string) {
  return s.replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, '&')
}

function typeOf(el: HTMLElement): FieldType {
  const declared = el.getAttribute('data-cms-type')
  if (declared === 'text' || declared === 'richtext' || declared === 'image' || declared === 'link') return declared
  const tag = el.tagName.toLowerCase()
  if (tag === 'img') return 'image'
  if (tag === 'a') return 'link'
  // Paragraphs, lists and boxes with formatting inside are rich text; headings and spans are plain text.
  if (['p', 'div', 'section', 'ul', 'ol', 'blockquote', 'li', 'td'].includes(tag)) return 'richtext'
  return el.childNodes.some((n) => n instanceof HTMLElement) ? 'richtext' : 'text'
}

/** All the editable fields on a page, in the order they appear. */
export function scanFields(html: string): Field[] {
  const root = parse(html, { comment: true })
  const out: Field[] = []
  const seen = new Set<string>()
  root.querySelectorAll('[data-cms]').forEach((el, i) => {
    const key = el.getAttribute('data-cms') ?? ''
    if (!KEY_PATTERN.test(key) || seen.has(key)) return // skip bad or duplicate names
    seen.add(key)
    const type = typeOf(el)
    let value: string
    if (type === 'image') value = JSON.stringify({ src: el.getAttribute('src') ?? '', alt: el.getAttribute('alt') ?? '' })
    else if (type === 'link') value = JSON.stringify({ href: el.getAttribute('href') ?? '', text: decode(el.text.trim()) })
    else if (type === 'text') value = decode(el.text.trim())
    else value = el.innerHTML.trim()
    out.push({ key, type, label: el.getAttribute('data-cms-label') || nice(key), value, position: i })
  })
  return out
}

// ---------------------------------------------------------------------------
// Rich text clean-up: clients can only use simple formatting. Anything else is removed,
// so nobody can add scripts, styles or tracking code to a website through the CMS.
// ---------------------------------------------------------------------------
const ALLOWED = new Set(['p', 'br', 'b', 'strong', 'i', 'em', 'u', 'a', 'ul', 'ol', 'li', 'h2', 'h3', 'h4', 'span'])
const DROP_WITH_CONTENT = new Set(['script', 'style', 'iframe', 'object', 'embed', 'template', 'noscript', 'svg', 'math'])
const SAFE_HREF = /^(https?:\/\/|mailto:|tel:|\/|#|\.\.?\/)/i

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const escAttr = (s: string) => esc(s).replace(/"/g, '&quot;')

export function sanitizeRichText(html: string): string {
  const root = parse(`<div>${html}</div>`)
  const walk = (node: Node): string => {
    if (node instanceof TextNode) return esc(decode(node.rawText))
    if (!(node instanceof HTMLElement)) return '' // comments etc.
    const tag = node.tagName?.toLowerCase() ?? ''
    if (DROP_WITH_CONTENT.has(tag)) return ''
    const inner = node.childNodes.map(walk).join('')
    if (!ALLOWED.has(tag)) return inner // unwrap: keep the words, lose the tag
    if (tag === 'br') return '<br>'
    if (tag === 'a') {
      const href = (node.getAttribute('href') ?? '').trim()
      if (!SAFE_HREF.test(href)) return inner
      const external = /^https?:/i.test(href)
      return `<a href="${escAttr(href)}"${external ? ' target="_blank" rel="noopener"' : ''}>${inner}</a>`
    }
    return `<${tag}>${inner}</${tag}>`
  }
  return (root.firstChild as HTMLElement).childNodes.map(walk).join('').trim()
}

export function safeUrl(url: string) {
  const u = url.trim()
  return SAFE_HREF.test(u) ? u : '#'
}

// ---------------------------------------------------------------------------
// Writing (needs Cloudflare's HTMLRewriter)
// ---------------------------------------------------------------------------

/** Put the new values into the page. Returns the new HTML and which fields were found. */
export async function applyEdits(html: string, edits: Edit[]): Promise<{ html: string; applied: Set<string> }> {
  const applied = new Set<string>()
  let rewriter = new HTMLRewriter()
  for (const e of edits) {
    if (!KEY_PATTERN.test(e.key)) continue
    rewriter = rewriter.on(`[data-cms="${e.key}"]`, {
      element(el) {
        if (applied.has(e.key)) return // only the first element with that name
        applied.add(e.key)
        if (e.type === 'text') {
          el.setInnerContent(e.value) // plain text: HTMLRewriter escapes it for us
        } else if (e.type === 'richtext') {
          el.setInnerContent(sanitizeRichText(e.value), { html: true })
        } else if (e.type === 'image') {
          const v = JSON.parse(e.value) as { src: string; alt?: string }
          el.setAttribute('src', safeUrl(v.src))
          el.setAttribute('alt', v.alt ?? '')
          // Old responsive versions would still show the old photo, so drop them.
          el.removeAttribute('srcset')
          el.removeAttribute('sizes')
        } else if (e.type === 'link') {
          const v = JSON.parse(e.value) as { href: string; text: string }
          el.setAttribute('href', safeUrl(v.href))
          el.setInnerContent(v.text)
        }
      },
    })
  }
  const out = await rewriter.transform(new Response(html)).text()
  return { html: out, applied }
}

/**
 * Mark the usual editable parts of an AI-built page: headings, paragraphs, images and buttons.
 * Anything already marked keeps its name. Navigation menus, scripts and forms are left alone.
 * Returns the new HTML and how many parts were marked.
 */
export async function autoMark(html: string): Promise<{ html: string; added: number }> {
  const used = new Set(scanFields(html).map((f) => f.key))
  const counters: Record<string, number> = {}
  let skipDepth = 0 // > 0 while inside <nav>, <form>, <script>…
  let added = 0
  const nextKey = (base: string) => {
    let key: string
    do { counters[base] = (counters[base] ?? 0) + 1; key = `${base}-${counters[base]}` } while (used.has(key))
    used.add(key)
    return key
  }
  const mark = (base: string) => ({
    element(el: Element) {
      if (skipDepth > 0 || el.hasAttribute('data-cms')) return
      el.setAttribute('data-cms', nextKey(base))
      added++
    },
  })
  const skip = {
    element(el: Element) {
      skipDepth++
      el.onEndTag(() => { skipDepth-- })
    },
  }
  const out = await new HTMLRewriter()
    .on('nav, form, script, style, noscript, template, svg', skip)
    .on('h1', mark('heading'))
    .on('h2', mark('heading'))
    .on('h3', mark('subheading'))
    .on('h4', mark('subheading'))
    .on('p', mark('text'))
    .on('img', mark('photo'))
    .on('a[class*="btn"], a[class*="button"], a[class*="cta"]', mark('button'))
    .transform(new Response(html)).text()
  return { html: out, added }
}
