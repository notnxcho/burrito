import { useEffect, useRef, useState } from "react";
import { api, getPin, setPin, money, initials } from "./api.js";

export default function App() {
  const [config, setConfig] = useState(null);
  const [members, setMembers] = useState([]);
  const [currency, setCurrency] = useState("UYU");
  const [tab, setTab] = useState("sell");
  const [sheet, setSheet] = useState(null); // a member (people mark-paid) or {settings:true}
  const [needPin, setNeedPin] = useState(false);
  const [fatal, setFatal] = useState("");
  const [ready, setReady] = useState(false);
  const [toast, setToast] = useState(null);
  const [sellTitle, setSellTitle] = useState("");
  const [sellItems, setSellItems] = useState([]); // [{ id, name, price }]

  const toastTimer = useRef();
  const showToast = (msg, err = false) => {
    setToast({ msg, err });
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2200);
  };

  async function loadMembers() {
    const d = await api("members");
    setMembers(d.members);
    setCurrency(d.currency);
  }

  async function boot() {
    setFatal("");
    setReady(false);
    let cfg;
    try {
      cfg = await api("config");
    } catch {
      setFatal("Can't reach the server.");
      setReady(true);
      return;
    }
    setConfig(cfg);
    setCurrency(cfg.currency);
    if (!cfg.hasToken || !cfg.hasGroup) {
      setReady(true);
      return;
    }
    if (cfg.needsPin && !getPin()) {
      setNeedPin(true);
      setReady(true);
      return;
    }
    try {
      await loadMembers();
      setNeedPin(false);
    } catch (e) {
      if (e.status === 401) {
        setPin("");
        setNeedPin(true);
      } else setFatal(e.message);
    }
    setReady(true);
  }

  useEffect(() => {
    boot();
  }, []);

  /* ---------- gates ---------- */
  if (!ready) return <Shell><Spinner /></Shell>;
  if (fatal)
    return (
      <Shell>
        <Panel title="Something went off">
          <p>{fatal}</p>
          <button className="btn btn-ghost" onClick={boot}>Try again</button>
        </Panel>
      </Shell>
    );
  if (config && !config.hasToken) return <Shell><NeedEnv /></Shell>;
  if (config && !config.hasGroup) return <Shell><NeedGroup /></Shell>;
  if (needPin)
    return (
      <Shell>
        <PinGate
          onUnlock={async (pin) => {
            setPin(pin);
            try {
              await loadMembers();
              setNeedPin(false);
            } catch (e) {
              setPin("");
              showToast(e.status === 401 ? "Wrong PIN" : e.message, true);
            }
          }}
        />
      </Shell>
    );

  /* ---------- actions ---------- */
  async function doSell(title, items) {
    try {
      const { total, count } = await api("sell", { method: "POST", body: { title, items } });
      showToast(`Sold ${count} 🌯 — ${money(total, currency)}`);
      await loadMembers();
      return true;
    } catch (e) {
      showToast(e.message, true);
      return false;
    }
  }
  async function doSettle(m) {
    try {
      await api("settle", { method: "POST", body: { userId: m.id, amount: m.owes } });
      setSheet(null);
      showToast(`${m.name.split(" ")[0]} marked paid ✓`);
      await loadMembers();
    } catch (e) {
      showToast(e.message, true);
    }
  }

  return (
    <Shell onGear={() => setSheet({ settings: true })}>
      {tab === "sell" && (
        <SellView
          members={members}
          currency={currency}
          defaultPrice={config?.defaultPrice ?? 440}
          onSell={doSell}
          title={sellTitle}
          setTitle={setSellTitle}
          items={sellItems}
          setItems={setSellItems}
        />
      )}
      {tab === "people" && <PeopleView members={members} currency={currency} onPick={(m) => setSheet(m)} />}
      {tab === "history" && <HistoryView currency={currency} />}

      <TabBar tab={tab} setTab={setTab} />

      {sheet && !sheet.settings && (
        <PersonSheet m={sheet} currency={currency} onClose={() => setSheet(null)} onSettle={doSettle} />
      )}
      {sheet && sheet.settings && (
        <SettingsSheet
          config={config}
          currency={currency}
          onClose={() => setSheet(null)}
          onForgetPin={() => {
            setPin("");
            setSheet(null);
            showToast("PIN forgotten");
          }}
        />
      )}

      {toast && <div className={"toast show" + (toast.err ? " err" : "")}>{toast.msg}</div>}
    </Shell>
  );
}

/* ----------------------------- sell ----------------------------- */
function SellView({ members, currency, defaultPrice, onSell, title, setTitle, items, setItems }) {
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);

  const inSell = new Set(items.map((it) => it.id));
  const total = items.reduce((s, it) => s + (Number(it.price) || 0), 0);
  const canCreate = items.some((it) => Number(it.price) > 0) && !busy;

  function addPerson(m) {
    if (inSell.has(m.id)) return;
    setItems((xs) => [...xs, { id: m.id, name: m.name, price: defaultPrice }]);
  }
  function setPrice(id, value) {
    setItems((xs) => xs.map((it) => (it.id === id ? { ...it, price: value } : it)));
  }
  function remove(id) {
    setItems((xs) => xs.filter((it) => it.id !== id));
  }
  async function create() {
    setBusy(true);
    const payload = items
      .map((it) => ({ userId: it.id, price: Number(it.price) || 0 }))
      .filter((it) => it.price > 0);
    const ok = await onSell(title, payload);
    setBusy(false);
    if (ok) {
      setTitle("");
      setItems([]);
    }
  }

  return (
    <>
      <div className="row" style={{ marginTop: 0 }}>
        <input className="titlein" placeholder="What's this sell? (e.g. Burritos Friday)" value={title} onChange={(e) => setTitle(e.target.value)} />
      </div>

      <div className="list" style={{ marginTop: 12 }}>
        {items.length ? (
          items.map((it) => (
            <div key={it.id} className="person" style={{ cursor: "default" }}>
              <div className="avatar">{initials(it.name)}</div>
              <div className="info"><div className="name">{it.name}</div></div>
              <input
                className="pricein"
                type="number"
                inputMode="numeric"
                value={it.price}
                onChange={(e) => setPrice(it.id, e.target.value)}
              />
              <button className="rm" onClick={() => remove(it.id)} title="Remove">✕</button>
            </div>
          ))
        ) : (
          <div className="empty">No buyers yet — add who bought.</div>
        )}
      </div>

      <button className="btn btn-ghost" onClick={() => setPicking(true)}>+ Add buyers</button>
      <button className="btn btn-primary" disabled={!canCreate} onClick={create}>
        {busy ? "Creating…" : `Create sell — ${money(total, currency)}`}
      </button>

      {picking && (
        <MemberPicker members={members} currency={currency} inSell={inSell} onAdd={addPerson} onClose={() => setPicking(false)} />
      )}
    </>
  );
}

function MemberPicker({ members, currency, inSell, onAdd, onClose }) {
  const [query, setQuery] = useState("");
  const filtered = members.filter((m) => m.name.toLowerCase().includes(query.toLowerCase()));
  return (
    <Scrim onClose={onClose}>
      <h2>Add buyers</h2>
      <div className="search" style={{ marginTop: 8 }}>
        <span className="icon">🔎</span>
        <input placeholder="Search a coworker…" value={query} onChange={(e) => setQuery(e.target.value)} autoFocus />
      </div>
      <div className="list pickerlist">
        {filtered.length ? (
          filtered.map((m) => (
            <button key={m.id} className="person" onClick={() => onAdd(m)} disabled={inSell.has(m.id)}>
              <div className="avatar" style={m.picture ? { backgroundImage: `url('${m.picture}')` } : undefined}>
                {m.picture ? "" : initials(m.name)}
              </div>
              <div className="info">
                <div className="name">{m.name}</div>
                <div className="sub">{m.owes > 0 ? <span className="owes">owes {money(m.owes, currency)}</span> : "all settled"}</div>
              </div>
              <span className="pricepill ghostpill">{inSell.has(m.id) ? "added" : "+"}</span>
            </button>
          ))
        ) : (
          <div className="empty">No matches.</div>
        )}
      </div>
      <button className="btn btn-primary" onClick={onClose}>Done</button>
    </Scrim>
  );
}

/* ----------------------------- people ----------------------------- */
function PeopleView({ members, currency, onPick }) {
  const [query, setQuery] = useState("");
  const filtered = members.filter((m) => m.name.toLowerCase().includes(query.toLowerCase()));
  return (
    <>
      <div className="search">
        <span className="icon">🔎</span>
        <input placeholder="Search a coworker…" value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>
      <div className="list">
        {filtered.length ? (
          filtered.map((m) => (
            <button key={m.id} className="person" onClick={() => onPick(m)}>
              <div className="avatar" style={m.picture ? { backgroundImage: `url('${m.picture}')` } : undefined}>
                {m.picture ? "" : initials(m.name)}
              </div>
              <div className="info">
                <div className="name">{m.name}</div>
                <div className="sub">{m.owes > 0 ? <span className="owes">owes {money(m.owes, currency)}</span> : "all settled"}</div>
              </div>
              {m.owes > 0 && <span className="pricepill ghostpill">{money(m.owes, currency)}</span>}
            </button>
          ))
        ) : (
          <div className="empty">No matches.</div>
        )}
      </div>
    </>
  );
}

function PersonSheet({ m, currency, onClose, onSettle }) {
  const first = m.name.split(" ")[0];
  return (
    <Scrim onClose={onClose}>
      <h2>{m.name}</h2>
      <div className="meta">{m.owes > 0 ? <>Currently owes you <b>{money(m.owes, currency)}</b></> : "All settled up"}</div>
      {m.owes > 0 ? (
        <button className="btn btn-green" onClick={() => onSettle(m)}>
          Mark paid (clear {money(m.owes, currency)})
        </button>
      ) : (
        <p style={{ color: "var(--muted)", fontSize: 14 }}>{first} has nothing outstanding.</p>
      )}
      <button className="muted-link" onClick={onClose}>Close</button>
    </Scrim>
  );
}

/* ----------------------------- shared / presentational ----------------------------- */
function Shell({ children, onGear }) {
  return (
    <>
      <header>
        <span style={{ fontSize: 22 }}>🌯</span>
        <h1>Burrito Charger</h1>
        {onGear && (
          <button className="gear" title="Settings" onClick={onGear}>
            ⚙︎
          </button>
        )}
      </header>
      <main>{children}</main>
    </>
  );
}

function Spinner() {
  return (
    <div className="empty">
      <span className="spin dark" />
    </div>
  );
}

function Panel({ title, children }) {
  return (
    <div className="panel">
      <h2>{title}</h2>
      {children}
    </div>
  );
}

function SettingsSheet({ config, currency, onClose, onForgetPin }) {
  return (
    <Scrim onClose={onClose}>
      <h2>Settings</h2>
      <div className="meta">Currency: {currency} · Regular {money(config.defaultPrice, currency)}</div>
      <p style={{ fontSize: 13, color: "var(--muted)" }}>
        Token, group and the regular price are set via environment variables on Vercel.
      </p>
      <button className="btn btn-ghost" onClick={onForgetPin}>Forget PIN on this device</button>
      <button className="muted-link" onClick={onClose}>Close</button>
    </Scrim>
  );
}

function TabBar({ tab, setTab }) {
  return (
    <div className="tabbar">
      <button className={tab === "sell" ? "active" : ""} onClick={() => setTab("sell")}>
        <span className="t">🌯</span>
        <span className="l">Sell</span>
      </button>
      <button className={tab === "people" ? "active" : ""} onClick={() => setTab("people")}>
        <span className="t">👥</span>
        <span className="l">People</span>
      </button>
      <button className={tab === "history" ? "active" : ""} onClick={() => setTab("history")}>
        <span className="t">📜</span>
        <span className="l">History</span>
      </button>
    </div>
  );
}

function HistoryView({ currency }) {
  const [d, setD] = useState(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    api("history").then(setD).catch((e) => setErr(e.message));
  }, []);
  if (err) return <Panel title="Couldn't load history"><p>{err}</p></Panel>;
  if (!d) return <Spinner />;
  return (
    <>
      <div className="stats">
        <div className="stat">
          <div className="label">Today ({d.todayCount} 🌯)</div>
          <div className="value">{money(d.todayTotal, currency)}</div>
        </div>
        <div className="stat">
          <div className="label">All time ({d.totalCount} 🌯)</div>
          <div className="value">{money(d.allTotal, currency)}</div>
        </div>
      </div>
      <div className="list">
        {d.history.length ? (
          d.history.map((h) => {
            const dt = new Date(h.date);
            const when = dt.toLocaleString("es-UY", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
            return (
              <div key={h.id} className="person" style={{ cursor: "default" }}>
                <div className="avatar">🌯</div>
                <div className="info">
                  <div className="name">{h.title}</div>
                  <div className="sub">{h.count} {h.count === 1 ? "person" : "people"} · {when}</div>
                </div>
                <span className="pricepill ghostpill">{money(h.total, currency)}</span>
              </div>
            );
          })
        ) : (
          <div className="empty">No sells yet.</div>
        )}
      </div>
    </>
  );
}

function NeedEnv() {
  return (
    <Panel title="Connect Splitwise">
      <p>
        Set the <b>SPLITWISE_TOKEN</b> environment variable in your Vercel project (your Splitwise
        API key from secure.splitwise.com/apps), then redeploy.
      </p>
    </Panel>
  );
}

function NeedGroup() {
  const [groups, setGroups] = useState(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    api("groups").then((d) => setGroups(d.groups)).catch((e) => setErr(e.message));
  }, []);
  return (
    <Panel title="Pick your group">
      <p>
        Set <b>SPLITWISE_GROUP_ID</b> in your Vercel env to the burrito group below, then redeploy.
      </p>
      {err && <p style={{ color: "var(--accent-d)" }}>{err}</p>}
      {!groups && !err && <Spinner />}
      <div className="list">
        {(groups || []).map((g) => (
          <div key={g.id} className="person" style={{ cursor: "default" }}>
            <div className="avatar">{initials(g.name)}</div>
            <div className="info">
              <div className="name">{g.name}</div>
              <div className="sub">{g.members} people</div>
            </div>
            <span className="pricepill ghostpill">ID {g.id}</span>
          </div>
        ))}
      </div>
    </Panel>
  );
}

function PinGate({ onUnlock }) {
  const [pin, setPinVal] = useState("");
  return (
    <Panel title="Enter PIN">
      <p>This app is PIN-protected.</p>
      <input type="tel" inputMode="numeric" placeholder="PIN" value={pin} onChange={(e) => setPinVal(e.target.value)} />
      <button className="btn btn-primary" onClick={() => onUnlock(pin.trim())}>
        Unlock
      </button>
    </Panel>
  );
}

function Scrim({ children, onClose }) {
  return (
    <div className="scrim open" onClick={(e) => e.target.classList.contains("scrim") && onClose()}>
      <div className="sheet">{children}</div>
    </div>
  );
}
