import { useState } from "react";
import type { Issuance } from "./data";

const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
// Soft, vibrant hues add warmth without neon glare; labels carry the exact counts.
const colors = ["#4B9FE1", "#45B99C", "#EDB74F", "#9A83D5", "#F08075", "#4DBBCB", "#E680AE", "#A0BD5A", "#788DE3", "#E7A167", "#769FAF", "#BA7FC9"];

// Use the directory order, not monthly volume, to keep a type's color consistent.
export function issuanceColor(type: string, typeOrder: string[]) {
  const index = typeOrder.indexOf(type);
  if (index >= 0) return colors[index % colors.length];
  const hash = Array.from(type).reduce((value, character) => (value * 31 + character.charCodeAt(0)) >>> 0, 0);
  return `hsl(${hash % 360} 58% 62%)`;
}

export function MonthlyIssuanceChart({ issuances, year, typeOrder }: { issuances: Issuance[]; year: string; typeOrder: string[] }) {
  const [selectedMonth, setSelectedMonth] = useState<number | null>(null);
  // Count every type, including imported categories absent from the directory.
  const monthly = months.map((label, index) => {
    const records = issuances.filter((item) => item.date_issued.startsWith(`${year}-${String(index + 1).padStart(2, "0")}`));
    const counts = new Map<string, number>();
    records.forEach((item) => counts.set(item.issuance_type, (counts.get(item.issuance_type) || 0) + 1));
    return { label, total: records.length, counts };
  });
  const presentTypes = new Set(monthly.flatMap((month) => [...month.counts.keys()]));
  const types = [...typeOrder.filter((type) => presentTypes.has(type)), ...[...presentTypes].filter((type) => !typeOrder.includes(type)).sort()];
  const maxTotal = Math.max(1, ...monthly.map((month) => month.total));
  const latestMonth = monthly.reduce((latest, month, index) => month.total ? index : latest, 0);
  const activeIndex = selectedMonth ?? latestMonth;
  const activeMonth = monthly[activeIndex];

  if (!types.length) return <p className="chart-empty">No issuances recorded for {year}.</p>;

  return <>
    <div className="bar-chart" role="group" aria-label={`Monthly issuances by type for ${year}`}>
      {monthly.map((month, index) => {
        const description = `${month.label} ${year}: ${month.total} total issuances. ${types.map((type) => `${type}: ${month.counts.get(type) || 0}`).join("; ")}`;
        return <button type="button" className="bar-column" key={month.label}
          aria-label={description} aria-pressed={activeIndex === index} aria-controls="monthly-issuance-breakdown"
          title={description} onMouseEnter={() => setSelectedMonth(index)} onFocus={() => setSelectedMonth(index)} onClick={() => setSelectedMonth(index)}>
          <span className="bar-total">{month.total}</span>
          <span className="bar-space" aria-hidden="true">
            <span className="bar-stack" style={{ height: `${month.total / maxTotal * 100}%` }}>
              {types.map((type) => {
                const count = month.counts.get(type) || 0;
                return count > 0 && <span className="bar-segment" key={type} style={{ height: `${count / month.total * 100}%`, backgroundColor: issuanceColor(type, typeOrder) }} />;
              })}
            </span>
          </span>
          <small>{month.label}</small>
        </button>;
      })}
    </div>
    <div className="chart-breakdown" id="monthly-issuance-breakdown">
      <h3>{activeMonth.label} {year} <span>{activeMonth.total} total</span></h3>
      <p>Hover, focus, or tap a month to see its counts by issuance type.</p>
      <ul className="chart-legend">{types.map((type) => <li key={type}>
        <span className="chart-swatch" aria-hidden="true" style={{ backgroundColor: issuanceColor(type, typeOrder) }} />
        <span>{type}</span><strong>{activeMonth.counts.get(type) || 0}</strong>
      </li>)}</ul>
    </div>
  </>;
}
