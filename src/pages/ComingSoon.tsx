// Placeholder for screens that are designed but not built yet.
export default function ComingSoon({ title, note }: { title: string; note?: string }) {
  return (
    <div className="flex flex-col gap-4">
      <h1 className="pt-2 text-2xl font-semibold">{title}</h1>
      <div className="card p-8 text-sm text-muted">
        {note ?? 'This screen is designed and comes in a later step of the build.'}
      </div>
    </div>
  )
}
