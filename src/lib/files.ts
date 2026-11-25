import { supabase } from './supabase'

// Files live in private Supabase Storage buckets (see migration 004).
// Nobody gets a permanent public link: we ask for a link that works for
// one minute each time someone opens a file.

export type Bucket = 'receipts' | 'hr-docs' | 'ticket-files'

export const MAX_FILE_MB = 10
export const ACCEPT = 'image/*,application/pdf'

/** Upload a file into `folder` and return its path in the bucket. */
export async function uploadFile(bucket: Bucket, folder: string, file: File): Promise<string> {
  if (file.size > MAX_FILE_MB * 1024 * 1024) throw new Error(`That file is bigger than ${MAX_FILE_MB} MB.`)
  // Keep the name readable but safe: letters, numbers, dots and dashes only
  const safe = file.name.replace(/[^a-zA-Z0-9._-]+/g, '-').slice(-80)
  const path = `${folder}/${Date.now()}-${safe}`
  const { error } = await supabase.storage.from(bucket).upload(path, file, { contentType: file.type })
  if (error) throw new Error(error.message)
  return path
}

/** Open a private file in a new tab using a short-lived link. */
export async function openFile(bucket: Bucket, path: string) {
  // Open the tab first (browsers block pop-ups opened after a wait), then point it at the file.
  const tab = window.open('', '_blank')
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, 60)
  if (error || !data) {
    tab?.close()
    alert('Sorry, that file could not be opened.')
    return
  }
  if (tab) tab.location.href = data.signedUrl
  else window.location.href = data.signedUrl
}

/** List the files in a folder (newest first). */
export async function listFiles(bucket: Bucket, folder: string) {
  const { data } = await supabase.storage.from(bucket).list(folder, { sortBy: { column: 'created_at', order: 'desc' } })
  return (data ?? []).filter((f) => f.name && !f.name.startsWith('.')).map((f) => ({ name: f.name, path: `${folder}/${f.name}` }))
}

/** "1732530000000-screenshot.png" → "screenshot.png" */
export const displayName = (path: string) => path.split('/').pop()!.replace(/^\d+-/, '')
