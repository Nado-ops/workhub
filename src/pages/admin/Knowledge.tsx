import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../auth/AuthProvider'
import { personName } from '../../lib/team'
import { timeAgo } from '../../lib/format'

interface Article {
  id: string
  title: string
  category: string
  body: string
  pinned: boolean
  created_by: string | null
  updated_at: string
  editor: { full_name: string; email: string | null } | null
}

const SUGGESTED = ['How-to', 'Client setup', 'Policies', 'Passwords & access (no passwords!)', 'Templates', 'General']

/** The knowledge base: the team's how-to guides and procedures, written once and found fast. */
export default function Knowledge() {
  const { profile } = useAuth()
  const [articles, setArticles] = useState<Article[]>([])
  const [pick, setPick] = useState<string | 'new' | null>(null)
  const [editing, setEditing] = useState(false)
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('')
  const [error, setError] = useState<string | null>(null)

  async function load() {
    const { data, error } = await supabase.from('kb_articles')
      .select('*, editor:profiles!kb_articles_updated_by_fkey(full_name, email)')
      .order('pinned', { ascending: false }).order('title')
    if (error) setError(error.message)
    const list = (data as Article[] | null) ?? []
    setArticles(list)
    return list
  }
  useEffect(() => { load().then((list) => { if (list[0]) setPick(list[0].id) }) }, [])

  const categories = useMemo(() => [...new Set(articles.map((a) => a.category))].sort(), [articles])
  const q = search.trim().toLowerCase()
  const shown = articles.filter((a) => (!category || a.category === category) && (!q || a.title.toLowerCase().includes(q) || a.body.toLowerCase().includes(q)))
  const current = pick && pick !== 'new' ? articles.find((a) => a.id === pick) ?? null : null

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3 pt-2">
        <div>
          <h1 className="text-2xl font-semibold">Knowledge base</h1>
          <p className="mt-1 text-sm text-muted">Your team’s how-to guides. Write the answer once and point people here.</p>
        </div>
        <button className="btn-primary" onClick={() => { setPick('new'); setEditing(true) }}>+ New article</button>
      </div>
      {error && <p className="text-sm text-danger">{error}</p>}

      <div className="flex flex-wrap items-start gap-4">
        <aside className="card flex w-full flex-col gap-3 p-4 md:w-72">
          <input className="input" type="search" placeholder="Search guides…" aria-label="Search guides" value={search} onChange={(e) => setSearch(e.target.value)} />
          {categories.length > 1 && (
            <select className="input" aria-label="Category" value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="">All categories</option>
              {categories.map((c) => <option key={c}>{c}</option>)}
            </select>
          )}
          <ul className="flex flex-col gap-0.5">
            {shown.map((a) => (
              <li key={a.id}>
                <button
                  onClick={() => { setPick(a.id); setEditing(false) }}
                  className={`w-full cursor-pointer rounded-lg px-2.5 py-2 text-left text-sm ${pick === a.id ? 'bg-hover font-semibold' : 'hover:bg-hover'}`}
                >
                  {a.pinned && <span aria-label="Pinned">📌 </span>}{a.title}
                  <span className="block text-xs font-normal text-muted">{a.category}</span>
                </button>
              </li>
            ))}
            {shown.length === 0 && <li className="px-2.5 py-2 text-sm text-muted">{articles.length ? 'No matches.' : 'No articles yet. Start with your most-asked question.'}</li>}
          </ul>
        </aside>

        <section className="card min-w-0 flex-[1_1_480px] p-6">
          {pick === 'new' || (current && editing) ? (
            <ArticleForm
              key={current?.id ?? 'new'}
              article={current}
              categories={[...new Set([...categories, ...SUGGESTED])]}
              canDelete={!!current && (profile?.role === 'admin' || current.created_by === profile?.id)}
              onDone={async (id) => { setEditing(false); await load(); setPick(id) }}
            />
          ) : current ? (
            <article>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-xs tracking-widest text-muted uppercase">{current.category}</p>
                  <h2 className="mt-1 text-2xl font-semibold">{current.title}</h2>
                  <p className="mt-1 text-xs text-muted">Last updated by {personName(current.editor)} · {timeAgo(current.updated_at)}</p>
                </div>
                <button className="btn-ghost h-9" onClick={() => setEditing(true)}>Edit</button>
              </div>
              {/* whitespace-pre-wrap keeps the line breaks and numbered steps exactly as typed */}
              <div className="mt-5 max-w-[70ch] text-[15px] leading-7 whitespace-pre-wrap text-soft">{current.body || 'Nothing written yet.'}</div>
            </article>
          ) : (
            <p className="text-sm text-muted">Pick a guide on the left.</p>
          )}
        </section>
      </div>
    </div>
  )
}

function ArticleForm({ article, categories, canDelete, onDone }: { article: Article | null; categories: string[]; canDelete: boolean; onDone: (id: string | null) => void }) {
  const [title, setTitle] = useState(article?.title ?? '')
  const [category, setCategory] = useState(article?.category ?? 'How-to')
  const [body, setBody] = useState(article?.body ?? '')
  const [pinned, setPinned] = useState(article?.pinned ?? false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    const row = { title: title.trim(), category: category.trim() || 'General', body, pinned }
    const res = article
      ? await supabase.from('kb_articles').update(row).eq('id', article.id).select('id').single()
      : await supabase.from('kb_articles').insert(row).select('id').single()
    if (res.error) return setError(res.error.message)
    onDone((res.data as { id: string }).id)
  }
  async function remove() {
    if (!article || !window.confirm(`Delete "${article.title}"?`)) return
    const { error } = await supabase.from('kb_articles').delete().eq('id', article.id)
    if (error) setError(error.message)
    else onDone(null)
  }

  return (
    <form onSubmit={submit} className="flex flex-wrap items-end gap-3">
      <label className="label flex-[3_1_260px]">Title<input className="input" required value={title} onChange={(e) => setTitle(e.target.value)} placeholder="How to set up a new client's email" /></label>
      <label className="label flex-[1_1_180px]">Category
        <input className="input" list="kb-categories" value={category} onChange={(e) => setCategory(e.target.value)} />
        <datalist id="kb-categories">{categories.map((c) => <option key={c} value={c} />)}</datalist>
      </label>
      <label className="label basis-full">Steps / content
        <textarea className="input h-80 py-3 leading-6" value={body} onChange={(e) => setBody(e.target.value)} placeholder={'1. Log in to …\n2. Click …\n3. …'} />
      </label>
      <label className="flex items-center gap-2 text-sm text-soft"><input type="checkbox" className="h-4 w-4 accent-[#B8893A]" checked={pinned} onChange={(e) => setPinned(e.target.checked)} /> Pin to the top</label>
      <p className="basis-full text-xs text-muted">Never put passwords here. Write where to find them instead.</p>
      <button className="btn-primary">{article ? 'Save' : 'Publish'}</button>
      <button type="button" className="btn-ghost" onClick={() => onDone(article?.id ?? null)}>Cancel</button>
      {canDelete && <button type="button" className="btn-ghost text-danger" onClick={remove}>Delete</button>}
      {error && <p className="basis-full text-sm text-danger">{error}</p>}
    </form>
  )
}
