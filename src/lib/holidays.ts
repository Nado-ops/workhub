// South African public holidays, worked out for any year.
// Rule: when a holiday falls on a Sunday, the Monday after is a holiday too.

/** Easter Sunday (the "anonymous Gregorian" method). Good Friday and Family Day hang off it. */
function easter(year: number) {
  const a = year % 19, b = Math.floor(year / 100), c = year % 100
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3)
  const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4
  const l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451)
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1
  return new Date(year, month - 1, day)
}

export const dateKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)

/** Map of "YYYY-MM-DD" → holiday name for one year. */
export function saHolidays(year: number): Record<string, string> {
  const fixed: [number, number, string][] = [
    [1, 1, "New Year's Day"], [3, 21, 'Human Rights Day'], [4, 27, 'Freedom Day'], [5, 1, "Workers' Day"],
    [6, 16, 'Youth Day'], [8, 9, "National Women's Day"], [9, 24, 'Heritage Day'],
    [12, 16, 'Day of Reconciliation'], [12, 25, 'Christmas Day'], [12, 26, 'Day of Goodwill'],
  ]
  const out: Record<string, string> = {}
  for (const [m, d, name] of fixed) {
    const date = new Date(year, m - 1, d)
    out[dateKey(date)] = name
    if (date.getDay() === 0) out[dateKey(addDays(date, 1))] = `${name} (observed)`
  }
  const e = easter(year)
  out[dateKey(addDays(e, -2))] = 'Good Friday'
  out[dateKey(addDays(e, 1))] = 'Family Day'
  return out
}
