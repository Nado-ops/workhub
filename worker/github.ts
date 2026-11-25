// Talking to GitHub with the key stored in Cloudflare (GITHUB_TOKEN).
// The token needs "Contents: Read and write" on the client website repos.

export interface GitHubEnv { GITHUB_TOKEN?: string; GITHUB_API?: string }

export class GitHub {
  private api: string
  constructor(private env: GitHubEnv, private repo: string, private branch: string) {
    this.api = (env.GITHUB_API || 'https://api.github.com').replace(/\/$/, '')
  }

  private async call<T>(path: string, init: RequestInit = {}, raw = false): Promise<T> {
    if (!this.env.GITHUB_TOKEN) throw new Error('GitHub isn’t connected yet: add the GITHUB_TOKEN secret in Cloudflare.')
    const res = await fetch(`${this.api}/repos/${this.repo}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.env.GITHUB_TOKEN}`,
        Accept: raw ? 'application/vnd.github.raw+json' : 'application/vnd.github+json',
        'User-Agent': 'work-hub-cms',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      },
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      if (res.status === 404) throw new Error(`GitHub can’t find ${this.repo} (branch ${this.branch}). Check the repo name and that the token can access it.`)
      if (res.status === 401 || res.status === 403) throw new Error('GitHub refused the key. Check the GITHUB_TOKEN has Contents: Read and write on this repo.')
      throw new Error(`GitHub error ${res.status}: ${text.slice(0, 200)}`)
    }
    return (raw ? res.text() : res.json()) as Promise<T>
  }

  /** Every .html file inside the folder (paths relative to the folder). */
  async listHtml(folder: string): Promise<string[]> {
    const tree = await this.call<{ tree: { path: string; type: string }[]; truncated: boolean }>(
      `/git/trees/${encodeURIComponent(this.branch)}?recursive=1`)
    const prefix = folder ? `${folder.replace(/^\/|\/$/g, '')}/` : ''
    return tree.tree
      .filter((t) => t.type === 'blob' && t.path.startsWith(prefix) && /\.html?$/i.test(t.path))
      .map((t) => t.path.slice(prefix.length))
      .sort((a, b) => (a === 'index.html' ? -1 : b === 'index.html' ? 1 : a.localeCompare(b)))
  }

  /** The text of one file. */
  readFile(path: string): Promise<string> {
    return this.call<string>(`/contents/${path.split('/').map(encodeURIComponent).join('/')}?ref=${encodeURIComponent(this.branch)}`, {}, true)
  }

  /**
   * Save several files in ONE commit (pages + photos together), so the website never ends up half-updated.
   * Text files are given as strings, photos as bytes.
   */
  async commit(files: { path: string; content: string | Uint8Array }[], message: string): Promise<string> {
    const ref = await this.call<{ object: { sha: string } }>(`/git/ref/heads/${encodeURIComponent(this.branch)}`)
    const parent = await this.call<{ tree: { sha: string } }>(`/git/commits/${ref.object.sha}`)
    const tree = []
    for (const f of files) {
      const blob = await this.call<{ sha: string }>('/git/blobs', {
        method: 'POST',
        body: JSON.stringify(typeof f.content === 'string'
          ? { content: f.content, encoding: 'utf-8' }
          : { content: toBase64(f.content), encoding: 'base64' }),
      })
      tree.push({ path: f.path, mode: '100644', type: 'blob', sha: blob.sha })
    }
    const newTree = await this.call<{ sha: string }>('/git/trees', { method: 'POST', body: JSON.stringify({ base_tree: parent.tree.sha, tree }) })
    const commit = await this.call<{ sha: string }>('/git/commits', {
      method: 'POST', body: JSON.stringify({ message, tree: newTree.sha, parents: [ref.object.sha] }),
    })
    await this.call(`/git/refs/heads/${encodeURIComponent(this.branch)}`, { method: 'PATCH', body: JSON.stringify({ sha: commit.sha }) })
    return commit.sha
  }
}

function toBase64(bytes: Uint8Array) {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}

/** "public" + "about/index.html" → "public/about/index.html" */
export const repoPath = (folder: string, page: string) =>
  [folder.replace(/^\/|\/$/g, ''), page.replace(/^\//, '')].filter(Boolean).join('/')
