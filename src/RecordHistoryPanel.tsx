import { useEffect, useState } from "react";
import { HistoryEntry, Issuance, IssuanceInput, Profile, subscribeHistory } from "./data";
import { changedFields, editableFields, editableSnapshot } from "./recordHistory";

const labels: Record<string, string> = { create: "Record created", update: "Record edited", archive: "Record archived", restore: "Record restored", revert: "Earlier values recovered" };
const fieldLabels: Record<string, string> = { escrow_total_centavos: "Total escrow (PHP)", escrow_paid_centavos: "Amount paid (PHP)", assigned_to: "Assigned staff account", source_sheet: "Source worksheet", source_row: "Source row", archived: "Registry status" };
const fieldLabel = (field: string) => fieldLabels[field] || field.replace(/_/g, " ");
const display = (field: string, value: unknown): string => {
  if (value == null || value === "") return "Not recorded";
  if (field === "archived") return value ? "Archived" : "Active";
  if (field.startsWith("escrow_") && typeof value === "number") return new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(value / 100);
  if (typeof value === "object") return Object.entries(value).map(([key, item]) => `${key}: ${item}`).join("\n") || "Not recorded";
  return String(value);
};
const timestamp = (value: string) => value ? new Intl.DateTimeFormat("en-PH", { timeZone: "Asia/Manila", dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) + " (Philippine time)" : "Timestamp pending";

export function HistoryPanel({ item, profile, recover }: { item: Issuance; profile: Profile; recover: (payload: IssuanceInput) => void }) {
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [review, setReview] = useState<Record<string, unknown> | null>(null);
  const [fields, setFields] = useState<string[]>([]);
  useEffect(() => subscribeHistory(item.id, (values) => { setEntries(values); setLoading(false); }, (reason) => { setError(reason.message); setLoading(false); }), [item.id]);
  const selectVersion = (snapshot: Record<string, unknown>) => { setReview(snapshot); setFields([]); };
  const canRecover = profile.role === "admin" && !item.archived;
  return <section className="drawer-section history-panel" aria-label="Record history">
    <h3>Record history</h3>
    <p>Changes are permanent history entries. Recovery saves a new change.</p>
    {loading && <p role="status">Loading history…</p>}
    {error && <p className="login-error" role="alert">{error}</p>}
    {!loading && !entries.length && <p>History tracking begins with the next change. Earlier edits are unavailable.</p>}
    {review && <section className="history-review">
      <h3>Select earlier values to recover</h3>
      <p>Check each field to recover, then review the complete record in the edit form.</p>
      {editableFields.filter((field) => !["source_sheet", "source_row"].includes(field) && JSON.stringify(review[field] ?? null) !== JSON.stringify(item[field] ?? null)).map((field) => <label key={field}>
        <input type="checkbox" checked={fields.includes(field)} onChange={(event) => setFields((previous) => event.target.checked ? [...previous, field] : previous.filter((value) => value !== field))} />
        <span><strong>{fieldLabel(field)}</strong><span>Current: {display(field, item[field])}</span><span>Earlier: {display(field, review[field])}</span></span>
      </label>)}
      <div className="drawer-actions"><button className="secondary" onClick={() => setReview(null)}>Cancel recovery</button><button className="primary" disabled={!fields.length || !canRecover} onClick={() => {
        const payload = { ...editableSnapshot(item as unknown as Record<string, unknown>) };
        for (const field of fields) {
          const key = field as keyof IssuanceInput;
          if (review[field] === undefined) delete payload[key];
          else Object.assign(payload, { [field]: review[field] });
        }
        recover(payload); setReview(null);
      }}>Review recovered record</button></div>
    </section>}
    <ol className="history-list">{entries.map((entry) => <li key={entry.id}>
      <h4>{labels[entry.action] || entry.action} · Version {entry.version}</h4>
      <p><strong>{entry.actor_name}</strong> · {timestamp(entry.at)}</p>
      <p className="history-reason">{entry.reason}</p>
      <dl>{changedFields(entry.before, entry.after).map((field) => <div key={field}><dt>{fieldLabel(field)}</dt><dd><del>{display(field, entry.before?.[field])}</del><span> → </span><ins>{display(field, entry.after[field])}</ins></dd></div>)}</dl>
      {canRecover && <button className="secondary" onClick={() => selectVersion(entry.after)}>Recover values from this version</button>}
      {entry.version === 1 && entry.before && <div className="history-baseline"><p>Baseline before history tracking began. Earlier changes cannot be reconstructed.</p>{canRecover && <button className="secondary" onClick={() => selectVersion(entry.before!)}>Recover baseline values</button>}</div>}
    </li>)}</ol>
  </section>;
}

export function ArchiveDialog({ item, close, save }: { item: Issuance; close: () => void; save: (reason: string) => Promise<void> }) {
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  return <div className="modal-layer"><div className="modal" role="dialog" aria-modal="true" aria-labelledby="archive-title">
    <div className="modal-head"><h2 id="archive-title">{item.archived ? "Restore" : "Archive"} {item.reference_number}</h2></div>
    <form onSubmit={async (event) => {
      event.preventDefault(); setSaving(true); setError("");
      try { await save(reason); } catch (failure) { setError(failure instanceof Error ? failure.message : "Could not save this change."); setSaving(false); }
    }}>
      <p>{item.archived ? "The record will return to the active registry." : "The record will move to Archived records. Its reference number and history will be retained."}</p>
      {error && <p className="login-error" role="alert">{error}</p>}
      <div className="form-grid"><label className="wide">Reason<textarea autoFocus required maxLength={1000} rows={3} disabled={saving} value={reason} onChange={(event) => setReason(event.target.value)} /></label></div>
      <div className="form-actions"><button className="secondary" type="button" disabled={saving} onClick={close}>Cancel</button><button className="primary" disabled={saving}>{saving ? "Saving…" : item.archived ? "Restore record" : "Archive record"}</button></div>
    </form>
  </div></div>;
}
