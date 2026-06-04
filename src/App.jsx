import { useEffect, useRef, useState } from "react";
import { api, getPin, setPin, loadCustomPrices, saveCustomPrice, money, initials } from "./api.js";

export default function App() {
  const [config, setConfig] = useState(null);
  const [members, setMembers] = useState([]);
  const [currency, setCurrency] = useState("UYU");
  const [tab, setTab] = useState("charge");
  const [query, setQuery] = useState("");
  const [custom, setCustom] = useState(loadCustomPrices());
  const [sheet, setSheet] = useState(null); // a member object, or {settings:true}
  const [needPin, setNeedPin] = useState(false);
  const [fatal, setFatal] = useState("");
  const [ready, setReady] = useState(false);
  const [toast, setToast] = useState(null);

  const toastTimer = useRef();
  const showToast = (msg, err = false) => {
    setToast({ msg, err });
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2200);
  };

  const priceFor = (m) => (custom[m.id] != null ? Number(custom[m.id]) : m.basePrice);

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
  if (config && !config.hasToken) return <Shell><NeedEnv what="token" /></Shell>;
  if (config && !config.hasGroup) return <Shell><NeedGroup /></Shell>;
  if (needPin)
    return (
      <Shell>
        <PinGate
          onUnlock={async (pin) => {
            setPin(pin); // api() reads it from localStorage
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

  /* ---------- main ---------- */
  const filtered = members.filter((m) => m.name.toLowerCase().includes(query.toLowerCase()));

  async function doCharge(m, price) {
    try {
      const { cost } = await api("charge", { method: "POST", body: { userId: m.id, price } });
      setSheet(null);
      showToast(`Charged ${money(cost, currency)} to ${m.name.split(" ")[0]} 🌯`);
      await loadMembers();
    } catch (e) {
      showToast(e.message, true);
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
  function setCustomPrice(m, value) {
    setCustom(saveCustomPrice(m.id, value));
    setSheet(null);
    showToast(value === "" ? "Custom price cleared" : "Default price saved");
  }

  return (
    <Shell onGear={() => setSheet({ settings: true })}>
      {tab === "charge" ? (
        <>
          <div className="search">
            <span className="icon">🔎</span>
            <input
              placeholder="Search a coworker…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <div className="list">
            {filtered.length ? (
              filtered.map((m) => (
                <PersonRow key={m.id} m={m} price={priceFor(m)} currency={currency} onClick={() => setSheet(m)} />
              ))
            ) : (
              <div className="empty">No matches.</div>
            )}
          </div>
        </>
      ) : (
        <HistoryView currency={currency} />
      )}

      <TabBar tab={tab} setTab={setTab} />

      {sheet && !sheet.settings && (
        <ChargeSheet
          m={sheet}
          price={priceFor(sheet)}
          customPrice={custom[sheet.id] ?? ""}
          currency={currency}
          onClose={() => setSheet(null)}
          onCharge={doCharge}
          onSettle={doSettle}
          onSaveCustom={setCustomPrice}
        />
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

/* ----------------------------- presentational ----------------------------- */
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

function PersonRow({ m, price, currency, onClick }) {
  return (
    <button className="person" onClick={onClick}>
      <div className="avatar" style={m.picture ? { backgroundImage: `url('${m.picture}')` } : undefined}>
        {m.picture ? "" : initials(m.name)}
      </div>
      <div className="info">
        <div className="name">
          {m.name} {m.firstTime && <span className="tag">1st · {money(price, currency)}</span>}
        </div>
        <div className="sub">{m.owes > 0 ? <span className="owes">owes {money(m.owes, currency)}</span> : "all settled"}</div>
      </div>
      <span className="pricepill">{money(price, currency)}</span>
    </button>
  );
}

function ChargeSheet({ m, price, customPrice, currency, onClose, onCharge, onSettle, onSaveCustom }) {
  const [p, setP] = useState(price);
  const [cust, setCust] = useState(customPrice);
  const first = m.name.split(" ")[0];
  return (
    <Scrim onClose={onClose}>
      <h2>
        {m.name} {m.firstTime && <span className="tag">first burrito</span>}
      </h2>
      <div className="meta">{m.owes > 0 ? <>Currently owes you <b>{money(m.owes, currency)}</b></> : "All settled up"}</div>

      <div className="row">
        <label>Price for this burrito</label>
        <input type="number" inputMode="numeric" value={p} onChange={(e) => setP(e.target.value)} />
      </div>
      <button className="btn btn-primary" onClick={() => onCharge(m, Number(p) || price)}>
        Charge {money(Number(p) || price, currency)}
      </button>

      {m.owes > 0 && (
        <button className="btn btn-green" onClick={() => onSettle(m)}>
          Mark paid (clear {money(m.owes, currency)})
        </button>
      )}

      <div className="row" style={{ marginTop: 18 }}>
        <label>
          Default price for {first}
          <br />
          <small>(overrides 1st/regular, this device)</small>
        </label>
        <input type="number" inputMode="numeric" placeholder="auto" value={cust} onChange={(e) => setCust(e.target.value)} />
      </div>
      <button className="muted-link" onClick={() => onSaveCustom(m, cust)}>
        Save their default price
      </button>
      <button className="muted-link" onClick={onClose}>
        Close
      </button>
    </Scrim>
  );
}

function SettingsSheet({ config, currency, onClose, onForgetPin }) {
  return (
    <Scrim onClose={onClose}>
      <h2>Settings</h2>
      <div className="meta">
        Currency: {currency} · Regular {money(config.defaultPrice, currency)} · First-time {money(config.firstTimePrice, currency)}
      </div>
      <p style={{ fontSize: 13, color: "var(--muted)" }}>
        Token, group and prices are set via environment variables on Vercel. Per-person custom
        prices are saved on this device.
      </p>
      <button className="btn btn-ghost" onClick={onForgetPin}>Forget PIN on this device</button>
      <button className="muted-link" onClick={onClose}>Close</button>
    </Scrim>
  );
}

function TabBar({ tab, setTab }) {
  return (
    <div className="tabbar">
      <button className={tab === "charge" ? "active" : ""} onClick={() => setTab("charge")}>
        <span className="t">🌯</span>
        <span className="l">Charge</span>
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
                <div className="avatar">{initials(h.name)}</div>
                <div className="info">
                  <div className="name">{h.name}</div>
                  <div className="sub">{when}</div>
                </div>
                <span className="pricepill ghostpill">{money(h.cost, currency)}</span>
              </div>
            );
          })
        ) : (
          <div className="empty">No burritos sold yet.</div>
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
