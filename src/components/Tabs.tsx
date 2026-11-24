// A row of tabs with optional counts, used on several pages.
export default function Tabs<T extends string>({
  tabs, value, onChange,
}: {
  tabs: { key: T; label: string; count?: number | string }[]
  value: T
  onChange: (key: T) => void
}) {
  return (
    <div role="tablist" className="flex flex-wrap gap-1 border-b border-line px-4">
      {tabs.map((t) => (
        <button
          key={t.key}
          role="tab"
          aria-selected={value === t.key}
          onClick={() => onChange(t.key)}
          className={`-mb-px h-11 cursor-pointer border-b-2 px-3 text-sm ${value === t.key ? 'border-accent font-semibold text-text' : 'border-transparent text-muted'}`}
        >
          {t.label}
          {t.count !== undefined && <span className="ml-1.5 rounded-md bg-[#1A2B2E] px-1.5 py-0.5 text-[11px] text-soft">{t.count}</span>}
        </button>
      ))}
    </div>
  )
}
