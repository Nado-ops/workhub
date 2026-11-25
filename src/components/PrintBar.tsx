import { Link } from 'react-router-dom'

/**
 * The bar above a printable page: Back, and Download PDF.
 * It's hidden when printing (print:hidden), so it never ends up in the PDF.
 */
export default function PrintBar({ back, children }: { back: string; children?: React.ReactNode }) {
  return (
    <div className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-3 border-b border-line bg-panel px-5 py-3 print:hidden">
      <Link to={back} className="text-sm text-accent-text">← Back</Link>
      <div className="flex flex-wrap items-center gap-3">
        {children}
        <span className="hidden text-xs text-muted sm:inline">In the print window, choose “Save as PDF”.</span>
        <button className="btn-primary h-10" onClick={() => window.print()}>Download PDF</button>
      </div>
    </div>
  )
}
