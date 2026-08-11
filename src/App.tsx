import { useEffect, useMemo, useState } from "react";
import {
  BarChart3, Building2, CalendarDays, CheckCircle2, ChevronRight, Clock3,
  Download, FileCheck2, Files, Layers3, LayoutDashboard, LogIn, MapPin, Menu, Pencil,
  Plus, ReceiptText, Search, Trash2, UserRound, UsersRound, X,
} from "lucide-react";
import {
  createIssuance, deleteIssuance, Identity, Issuance, IssuanceInput, Profile,
  subscribeIssuances, subscribeProfile, subscribeUsers, updateIssuance,
} from "./data";
import { demoMode, publicDataMode } from "./firebase";

const issuanceTypes = [
  "Development Permit", "Alteration Permit", "Certificate of Registration",
  "License to Sell — Subdivision", "License to Sell — Condominium",
  "Certificate of Non-Coverage", "License to Sell Amendment", "REMC",
  "Advertisement Approval", "Change of Name / Owner / Developer", "Mortgage Clearance",
];
type View = "dashboard" | "all" | "mine" | "types" | "type";
type Route = { view: View; type: string };
const typeSlug = (value: string) => value.normalize("NFKD").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const routeFromHash = (): Route => {
  const hash = window.location.hash.replace(/^#\/?/, "");
  if (hash.startsWith("types/")) {
    const slug = hash.slice("types/".length);
    const type = issuanceTypes.find((item) => typeSlug(item) === slug) || "";
    return type ? { view: "type", type } : { view: "types", type: "" };
  }
  if (hash === "issuances") return { view: "all", type: "" };
  if (hash === "mine") return { view: "mine", type: "" };
  if (hash === "types") return { view: "types", type: "" };
  return { view: "dashboard", type: "" };
};
const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const emptyRecord = (): IssuanceInput => ({
  reference_number: "", issuance_type: "Development Permit", source_sheet: "Manual",
  source_row: null, date_filed: "", date_issued: new Date().toISOString().slice(0, 10),
  project_name: "", location: "", applicant: "", developer: "", owner: "",
  processor: "", or_number: "", remarks: "", assigned_to: "", details: {},
});
const isIsoDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value);
const formatDate = (value: string) => {
  if (!value) return "Not recorded";
  if (!isIsoDate(value)) return value;
  return new Intl.DateTimeFormat("en-PH", { month: "short", day: "numeric", year: "numeric" })
    .format(new Date(`${value}T00:00:00`));
};
const daysBetween = (start: string, end: string) => {
  if (!isIsoDate(start) || !isIsoDate(end)) return null;
  return Math.max(0, Math.round((Date.parse(`${end}T00:00:00`) - Date.parse(`${start}T00:00:00`)) / 86_400_000));
};
const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase();

export default function App({ identity }: { identity: Identity }) {
  const [profile, setProfile] = useState<Profile | null | undefined>(undefined);
  const [users, setUsers] = useState<Profile[]>([]);
  const [issuances, setIssuances] = useState<Issuance[]>([]);
  const [route, setRoute] = useState<Route>(routeFromHash);
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState("All types");
  const [yearFilter, setYearFilter] = useState("All years");
  const [processorFilter, setProcessorFilter] = useState("All processors");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editing, setEditing] = useState<Issuance | "new" | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [navOpen, setNavOpen] = useState(false);
  const { view, type: selectedType } = route;

  useEffect(() => {
    const syncRoute = () => setRoute(routeFromHash());
    window.addEventListener("hashchange", syncRoute);
    return () => window.removeEventListener("hashchange", syncRoute);
  }, []);
  useEffect(() => subscribeProfile(identity, setProfile, (reason) => setError(reason.message)), [identity]);
  useEffect(() => {
    if (!profile?.active) return;
    return subscribeIssuances((items) => { setIssuances(items); setLoading(false); }, (reason) => { setError(reason.message); setLoading(false); });
  }, [profile?.active]);
  useEffect(() => {
    if (!profile?.active || profile.role === "viewer") return;
    return subscribeUsers(setUsers, () => setUsers([]));
  }, [profile?.active, profile?.role]);

  const selected = issuances.find((item) => item.id === selectedId) || null;
  const years = useMemo(() => [...new Set(issuances.map((item) => item.date_issued.slice(0, 4)).filter((year) => /^\d{4}$/.test(year)))].sort().reverse(), [issuances]);
  const processors = useMemo(() => [...new Set(issuances.map((item) => item.processor).filter(Boolean))].sort(), [issuances]);
  const types = useMemo(() => [...new Set(issuances.map((item) => item.issuance_type).filter(Boolean))].sort(), [issuances]);
  const knownTypes = useMemo(() => [...new Set([...issuanceTypes, ...types])], [types]);
  const mine = (item: Issuance) => item.assigned_to === profile?.id || Boolean(profile?.processor_code && item.processor.toLowerCase() === profile.processor_code.toLowerCase());
  const filtered = useMemo(() => issuances.filter((item) => {
    const haystack = [item.reference_number, item.project_name, item.location, item.applicant, item.developer, item.owner, item.processor, item.or_number, item.issuance_type].join(" ").toLowerCase();
    return (!query || haystack.includes(query.toLowerCase()))
      && (view === "type" || typeFilter === "All types" || item.issuance_type === typeFilter)
      && (yearFilter === "All years" || item.date_issued.startsWith(yearFilter))
      && (processorFilter === "All processors" || item.processor === processorFilter)
      && (view !== "mine" || mine(item))
      && (view !== "type" || item.issuance_type === selectedType);
  }), [issuances, query, typeFilter, yearFilter, processorFilter, view, selectedType, profile]);

  if (profile === undefined) return <div className="loading-page"><div className="loader" /><p>Loading your workspace…</p></div>;
  if (!profile?.active) return <div className="auth-page"><div className="auth-card"><div className="auth-mark"><UserRound /></div><h1>Access not enabled</h1><p>Your sign-in is valid, but no active staff profile is attached to <strong>{identity.email}</strong>. Ask an administrator to create or activate your user record.</p></div></div>;

  const canEdit = profile.role === "admin" || profile.role === "processor";
  const pageTitle = view === "dashboard" ? "Dashboard" : view === "mine" ? "My issuances" : view === "types" ? "Issuance types" : view === "type" ? selectedType : "All issuances";
  const pageCopy = view === "dashboard" ? "Approved application monitoring at a glance" : view === "mine" ? "Records assigned to you or matching your processor code" : view === "types" ? "Browse a dedicated register for every approval category" : view === "type" ? "Dedicated issuance-type register" : "Search and manage the complete issuance registry";
  const changeHash = (hash: string) => {
    if (window.location.hash === hash) setRoute(routeFromHash());
    else window.location.hash = hash;
    setNavOpen(false);
  };
  const navigate = (next: Exclude<View, "type">) => changeHash({ dashboard: "#/", all: "#/issuances", mine: "#/mine", types: "#/types" }[next]);
  const openType = (type: string) => changeHash(`#/types/${typeSlug(type)}`);
  const viewTotal = view === "mine" ? issuances.filter(mine).length : view === "type" ? issuances.filter((item) => item.issuance_type === selectedType).length : issuances.length;

  return <div className="app-shell">
    <aside className={navOpen ? "sidebar open" : "sidebar"}>
      <div className="brand"><div className="brand-mark"><FileCheck2 /></div><div><strong>DHSUD</strong><span>Region VI · Issuance Tracker</span></div></div>
      <nav aria-label="Main navigation">
        <button className={view === "dashboard" ? "active" : ""} onClick={() => navigate("dashboard")}><LayoutDashboard /> Dashboard</button>
        <button className={view === "all" ? "active" : ""} onClick={() => navigate("all")}><Files /> All issuances <em>{issuances.length}</em></button>
        <button className={view === "types" || view === "type" ? "active" : ""} onClick={() => navigate("types")}><Layers3 /> Issuance types <em>{knownTypes.length}</em></button>
        <button className={view === "mine" ? "active" : ""} onClick={() => navigate("mine")}><UserRound /> My issuances <em>{issuances.filter(mine).length}</em></button>
      </nav>
      <div className="sidebar-foot"><div className="avatar">{initials(profile.name)}</div><div><strong>{profile.name}</strong><span>{profile.role} {profile.processor_code && `· ${profile.processor_code}`}</span></div></div>
    </aside>
    {navOpen && <button className="nav-scrim" aria-label="Close navigation" onClick={() => setNavOpen(false)} />}

    <main>
      <header className="topbar">
        <div className="title-row"><button className="menu-button" onClick={() => setNavOpen(true)}><Menu /></button><div><span className="eyebrow">Approved applications registry</span><h1>{pageTitle}</h1><p>{pageCopy}</p></div></div>
        <div className="header-actions">
          {publicDataMode && <span className="demo-badge">Public registry</span>}
          {publicDataMode && <a className="secondary portal-link" href={`${import.meta.env.BASE_URL}staff/`}><LogIn size={16} /> Staff sign in</a>}
          {demoMode && <span className="demo-badge">Demo data</span>}
          {canEdit && <button className="primary" onClick={() => setEditing("new")}><Plus size={17} /> New issuance</button>}
        </div>
      </header>
      {error && <div className="alert"><span>{error}</span><button onClick={() => setError("")}><X size={16} /></button></div>}
      {view === "dashboard"
        ? <Dashboard issuances={issuances} mineCount={issuances.filter(mine).length} open={(id) => setSelectedId(id)} openType={openType} />
        : view === "types"
          ? <TypeDirectory types={knownTypes} issuances={issuances} open={openType} />
          : <>{view === "type" && selectedType && <TypePageHeader type={selectedType} issuances={issuances.filter((item) => item.issuance_type === selectedType)} back={() => navigate("types")} />}<Registry title={view === "mine" ? "My issuance register" : view === "type" ? `Approved ${selectedType} Applications` : "Issuance register"} items={filtered} total={viewTotal} loading={loading} query={query} setQuery={setQuery} types={types} typeFilter={typeFilter} setTypeFilter={setTypeFilter} years={years} yearFilter={yearFilter} setYearFilter={setYearFilter} processors={processors} processorFilter={processorFilter} setProcessorFilter={setProcessorFilter} open={(id) => setSelectedId(id)} hideTypeFilter={view === "type"} /></>}
    </main>
    {selected && <DetailDrawer item={selected} profile={profile} canEdit={canEdit} close={() => setSelectedId(null)} edit={() => setEditing(selected)} remove={async () => {
      if (profile.role !== "admin" || !window.confirm(`Delete ${selected.reference_number}? This cannot be undone.`)) return;
      try { await deleteIssuance(selected.id); setSelectedId(null); } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not delete the record."); }
    }} />}
    {editing && <IssuanceForm current={editing === "new" ? null : editing} users={users} profile={profile} close={() => setEditing(null)} saved={(id) => { setEditing(null); setSelectedId(id); }} fail={setError} />}
  </div>;
}

function Dashboard({ issuances, mineCount, open, openType }: { issuances: Issuance[]; mineCount: number; open: (id: string) => void; openType: (type: string) => void }) {
  const today = new Date();
  const currentYear = String(today.getFullYear());
  const currentMonth = `${currentYear}-${String(today.getMonth() + 1).padStart(2, "0")}`;
  const durations = issuances.map((item) => daysBetween(item.date_filed, item.date_issued)).filter((value): value is number => value !== null);
  const average = durations.length ? Math.round(durations.reduce((sum, value) => sum + value, 0) / durations.length) : 0;
  const latestYear = issuances.map((item) => item.date_issued.slice(0, 4)).filter((value) => /^\d{4}$/.test(value)).sort().at(-1) || currentYear;
  const monthly = monthNames.map((label, index) => ({ label, count: issuances.filter((item) => item.date_issued.startsWith(`${latestYear}-${String(index + 1).padStart(2, "0")}`)).length }));
  const maxMonth = Math.max(...monthly.map((item) => item.count), 1);
  const byType = Object.entries(issuances.reduce<Record<string, number>>((result, item) => ({ ...result, [item.issuance_type]: (result[item.issuance_type] || 0) + 1 }), {})).sort((a, b) => b[1] - a[1]);
  const maxType = byType[0]?.[1] || 1;
  const recent = [...issuances].sort((a, b) => b.date_issued.localeCompare(a.date_issued)).slice(0, 6);
  return <>
    <section className="stats-grid">
      <Stat icon={<Files />} tone="blue" label="Total issuances" value={issuances.length} note="All migrated records" />
      <Stat icon={<CheckCircle2 />} tone="green" label={`Issued in ${currentYear}`} value={issuances.filter((item) => item.date_issued.startsWith(currentYear)).length} note={`${issuances.filter((item) => item.date_issued.startsWith(currentMonth)).length} this month`} />
      <Stat icon={<Clock3 />} tone="gold" label="Average turnaround" value={`${average}d`} note={`${durations.length} records with dates`} />
      <Stat icon={<UserRound />} tone="violet" label="My issuances" value={mineCount} note="Assigned or processor match" />
    </section>
    <section className="dashboard-grid">
      <article className="panel trend-panel"><PanelHead title="Issuances by month" copy={`${latestYear} issuance activity`} />
        <div className="bar-chart" aria-label={`Monthly issuances for ${latestYear}`}>{monthly.map((item) => <div className="bar-column" key={item.label}><span>{item.count || ""}</span><div style={{ height: `${Math.max(item.count ? 8 : 2, item.count / maxMonth * 100)}%` }} /><small>{item.label}</small></div>)}</div>
      </article>
      <article className="panel type-panel"><PanelHead title="Issuance mix" copy="Records by approval category" />
        <div className="type-list">{byType.slice(0, 6).map(([type, count], index) => <button className="type-row" key={type} onClick={() => openType(type)}><div><span className={`type-dot dot-${index}`} /> <strong>{type}</strong><b>{count}</b></div><div className="type-track"><span className={`fill-${index}`} style={{ width: `${count / maxType * 100}%` }} /></div></button>)}</div>
      </article>
      <article className="panel recent-panel"><PanelHead title="Recently issued" copy="Latest approved application records" />
        <div className="recent-list">{recent.map((item) => <button key={item.id} onClick={() => open(item.id)}><span className="doc-icon"><FileCheck2 /></span><span className="recent-main"><strong>{item.project_name}</strong><small>{item.reference_number} · {item.issuance_type}</small></span><span className="recent-date">{formatDate(item.date_issued)}</span><ChevronRight /></button>)}</div>
      </article>
    </section>
  </>;
}

function TypeDirectory({ types, issuances, open }: { types: string[]; issuances: Issuance[]; open: (type: string) => void }) {
  return <section className="type-directory">
    <div className="type-grid">{types.map((type, index) => {
      const records = issuances.filter((item) => item.issuance_type === type);
      const latest = records.map((item) => item.date_issued).filter(Boolean).sort().at(-1);
      return <button className="type-card" key={type} onClick={() => open(type)}>
        <span className={`type-card-icon tone-${index % 5}`}><Layers3 /></span>
        <span className="eyebrow">Issuance type</span>
        <h2>{type}</h2>
        <p>{records.length} {records.length === 1 ? "record" : "records"}{latest ? ` · Latest ${formatDate(latest)}` : " · No issued records yet"}</p>
        <span className="type-card-link">Open Page <ChevronRight /></span>
      </button>;
    })}</div>
  </section>;
}

function TypePageHeader({ type, issuances, back }: { type: string; issuances: Issuance[]; back: () => void }) {
  const years = issuances.map((item) => item.date_issued.slice(0, 4)).filter((year) => /^\d{4}$/.test(year));
  const latestYear = years.sort().at(-1) || "—";
  const processors = new Set(issuances.map((item) => item.processor).filter(Boolean)).size;
  return <section className="type-page-header">
    <button className="type-back" onClick={back}>Issuance types <ChevronRight /></button>
    <div className="type-page-copy"><span className="type-page-icon"><Layers3 /></span><div><span className="eyebrow">Dedicated issuance page</span><h2>{type}</h2><p>Search, review, and export approved records in this category.</p></div></div>
    <div className="type-page-stats"><span><strong>{issuances.length}</strong>Total records</span><span><strong>{latestYear}</strong>Latest year</span><span><strong>{processors}</strong>Processors</span></div>
  </section>;
}

function Stat({ icon, tone, label, value, note }: { icon: React.ReactNode; tone: string; label: string; value: string | number; note: string }) {
  return <article className="stat-card"><span className={`stat-icon ${tone}`}>{icon}</span><div><span>{label}</span><strong>{value}</strong><small>{note}</small></div></article>;
}
function PanelHead({ title, copy }: { title: string; copy: string }) {
  return <div className="panel-head"><div><h2>{title}</h2><p>{copy}</p></div></div>;
}

type RegistryProps = {
  title: string; items: Issuance[]; total: number; loading: boolean; query: string; setQuery: (value: string) => void;
  types: string[]; typeFilter: string; setTypeFilter: (value: string) => void; years: string[]; yearFilter: string; setYearFilter: (value: string) => void;
  processors: string[]; processorFilter: string; setProcessorFilter: (value: string) => void; open: (id: string) => void; hideTypeFilter?: boolean;
};
function Registry(props: RegistryProps) {
  const exportCsv = () => {
    const fields: Array<keyof Issuance> = ["reference_number", "issuance_type", "date_filed", "date_issued", "project_name", "location", "applicant", "developer", "owner", "processor", "or_number", "remarks"];
    const escape = (value: unknown) => `"${String(value ?? "").replace(/"/g, '""')}"`;
    const csv = [fields.map(escape).join(","), ...props.items.map((item) => fields.map((field) => escape(item[field])).join(","))].join("\r\n");
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob(["\ufeff", csv], { type: "text/csv;charset=utf-8" }));
    link.download = `dhsud-issuances-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  };
  return <section className="panel registry-panel">
    <div className="registry-head"><div><h2>{props.title}</h2><p>Showing {props.items.length} of {props.total} records</p></div><button className="secondary" onClick={exportCsv}><Download size={16} /> Export CSV</button></div>
    <div className="filters">
      <label className="search-box"><Search size={17} /><input aria-label="Search issuances" placeholder="Search project, reference, location…" value={props.query} onChange={(event) => props.setQuery(event.target.value)} />{props.query && <button onClick={() => props.setQuery("")}><X size={14} /></button>}</label>
      {!props.hideTypeFilter && <select aria-label="Filter by type" value={props.typeFilter} onChange={(event) => props.setTypeFilter(event.target.value)}><option>All types</option>{props.types.map((type) => <option key={type}>{type}</option>)}</select>}
      <select aria-label="Filter by year" value={props.yearFilter} onChange={(event) => props.setYearFilter(event.target.value)}><option>All years</option>{props.years.map((year) => <option key={year}>{year}</option>)}</select>
      <select aria-label="Filter by processor" value={props.processorFilter} onChange={(event) => props.setProcessorFilter(event.target.value)}><option>All processors</option>{props.processors.map((processor) => <option key={processor}>{processor}</option>)}</select>
    </div>
    <div className="table-wrap"><table><thead><tr><th>Reference</th><th>Project / applicant</th><th>Type</th><th>Location</th><th>Date issued</th><th>Processor</th><th /></tr></thead>
      <tbody>{props.items.map((item) => <tr key={item.id} onClick={() => props.open(item.id)}><td><strong>{item.reference_number}</strong><span>Filed {formatDate(item.date_filed)}</span></td><td><strong>{item.project_name}</strong><span>{item.applicant || item.developer || item.owner || "Applicant not recorded"}</span></td><td><span className="type-badge">{item.issuance_type}</span></td><td>{item.location || "—"}</td><td><strong>{formatDate(item.date_issued)}</strong><span>{daysBetween(item.date_filed, item.date_issued) !== null ? `${daysBetween(item.date_filed, item.date_issued)} days` : "Turnaround unavailable"}</span></td><td><span className="processor-badge">{item.processor || "—"}</span></td><td><ChevronRight size={17} /></td></tr>)}</tbody></table></div>
    {!props.loading && !props.items.length && <div className="empty-state"><Search /><h3>No matching issuances</h3><p>Try clearing one or more search filters.</p></div>}
    {props.loading && <div className="empty-state"><div className="loader" /><p>Loading issuance records…</p></div>}
  </section>;
}

function DetailDrawer({ item, profile, canEdit, close, edit, remove }: { item: Issuance; profile: Profile; canEdit: boolean; close: () => void; edit: () => void; remove: () => void }) {
  const turnaround = daysBetween(item.date_filed, item.date_issued);
  const extraDetails = Object.entries(item.details).filter(([key]) => !["Date Filed", "Date Issued", "Processor", "Project Name", "ProjectName", "Location", "Developer", "Owner"].includes(key));
  return <div className="drawer-layer"><button className="drawer-scrim" aria-label="Close details" onClick={close} /><aside className="detail-drawer">
    <div className="drawer-head"><div><span className="eyebrow">Issuance record</span><h2>{item.reference_number}</h2></div><button className="icon-button" onClick={close}><X /></button></div>
    <div className="drawer-actions">{canEdit && <button className="primary" onClick={edit}><Pencil size={15} /> Edit record</button>}{profile.role === "admin" && <button className="danger-button" onClick={remove}><Trash2 size={15} /> Delete</button>}</div>
    <div className="issuance-hero"><span>{item.issuance_type}</span><h3>{item.project_name}</h3><p><MapPin size={14} /> {item.location || "Location not recorded"}</p></div>
    <div className="date-strip"><div><CalendarDays /><span>Date filed<strong>{formatDate(item.date_filed)}</strong></span></div><ChevronRight /><div><CheckCircle2 /><span>Date issued<strong>{formatDate(item.date_issued)}</strong></span></div><div className="turnaround"><strong>{turnaround ?? "—"}</strong><span>days</span></div></div>
    <section className="drawer-section"><h3>Parties and processing</h3><Info icon={<UserRound />} label="Applicant / representative" value={item.applicant} /><Info icon={<Building2 />} label="Developer" value={item.developer} /><Info icon={<UsersRound />} label="Owner" value={item.owner} /><Info icon={<ReceiptText />} label="Official receipt" value={item.or_number} /><Info icon={<BarChart3 />} label="Processor" value={item.processor} /></section>
    {item.remarks && <section className="drawer-section"><h3>Remarks</h3><p className="remarks-box">{item.remarks}</p></section>}
    {extraDetails.length > 0 && <section className="drawer-section"><h3>Source details</h3><dl className="source-details">{extraDetails.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl></section>}
    <div className="record-foot"><span>Source: {item.source_sheet}{item.source_row ? ` · Row ${item.source_row}` : ""}</span>{item.updated_by && <span>Last updated by {item.updated_by}</span>}</div>
  </aside></div>;
}
function Info({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return <div className="info-row"><span>{icon}</span><div><small>{label}</small><strong>{value || "Not recorded"}</strong></div></div>;
}

function IssuanceForm({ current, users, profile, close, saved, fail }: { current: Issuance | null; users: Profile[]; profile: Profile; close: () => void; saved: (id: string) => void; fail: (message: string) => void }) {
  const [form, setForm] = useState<IssuanceInput>(current ? {
    reference_number: current.reference_number, issuance_type: current.issuance_type, source_sheet: current.source_sheet,
    source_row: current.source_row, date_filed: isIsoDate(current.date_filed) ? current.date_filed : "", date_issued: isIsoDate(current.date_issued) ? current.date_issued : "",
    project_name: current.project_name, location: current.location, applicant: current.applicant, developer: current.developer,
    owner: current.owner, processor: current.processor, or_number: current.or_number, remarks: current.remarks,
    assigned_to: current.assigned_to, details: current.details,
  } : emptyRecord());
  const [saving, setSaving] = useState(false);
  const set = (field: keyof IssuanceInput, value: string) => setForm((previous) => ({ ...previous, [field]: value }));
  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); setSaving(true);
    try {
      if (current) { await updateIssuance(current.id, form, profile); saved(current.id); }
      else { saved(await createIssuance(form, profile)); }
    } catch (reason) { fail(reason instanceof Error ? reason.message : "Could not save the issuance."); setSaving(false); }
  };
  return <div className="modal-layer"><button className="modal-scrim" aria-label="Close form" onClick={close} /><div className="modal">
    <div className="modal-head"><div><span className="eyebrow">{current ? "Update registry entry" : "Add to registry"}</span><h2>{current ? "Edit issuance" : "New issuance"}</h2></div><button className="icon-button" onClick={close}><X /></button></div>
    <form onSubmit={submit}><div className="form-grid">
      <label>Reference / decision no.<input required value={form.reference_number} onChange={(event) => set("reference_number", event.target.value)} /></label>
      <label>Issuance type<select required value={form.issuance_type} onChange={(event) => set("issuance_type", event.target.value)}>{issuanceTypes.map((type) => <option key={type}>{type}</option>)}</select></label>
      <label>Date filed<input type="date" value={form.date_filed} onChange={(event) => set("date_filed", event.target.value)} /></label>
      <label>Date issued<input type="date" required value={form.date_issued} onChange={(event) => set("date_issued", event.target.value)} /></label>
      <label className="wide">Project / subject<input required value={form.project_name} onChange={(event) => set("project_name", event.target.value)} /></label>
      <label className="wide">Location<input value={form.location} onChange={(event) => set("location", event.target.value)} /></label>
      <label>Applicant / representative<input value={form.applicant} onChange={(event) => set("applicant", event.target.value)} /></label>
      <label>Developer<input value={form.developer} onChange={(event) => set("developer", event.target.value)} /></label>
      <label>Owner<input value={form.owner} onChange={(event) => set("owner", event.target.value)} /></label>
      <label>Processor initials<input value={form.processor} onChange={(event) => set("processor", event.target.value)} /></label>
      <label>Official receipt number<input value={form.or_number} onChange={(event) => set("or_number", event.target.value)} /></label>
      <label>Assign to user<select value={form.assigned_to} onChange={(event) => set("assigned_to", event.target.value)}><option value="">No direct assignment</option>{users.map((user) => <option key={user.id} value={user.id}>{user.name}{user.processor_code ? ` (${user.processor_code})` : ""}</option>)}</select></label>
      <label className="wide">Remarks<textarea rows={4} value={form.remarks} onChange={(event) => set("remarks", event.target.value)} /></label>
    </div><div className="form-actions"><button type="button" className="secondary" onClick={close}>Cancel</button><button className="primary" disabled={saving}>{saving ? "Saving…" : current ? "Save changes" : "Add issuance"}</button></div></form>
  </div></div>;
}
