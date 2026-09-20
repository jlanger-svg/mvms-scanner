import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { createClient } from "@supabase/supabase-js";
import { createWorker } from "tesseract.js";
import {
  Camera,
  ScanLine,
  Search,
  History,
  MapPin,
  ImagePlus,
  LogOut,
  Home,
  ChevronRight,
  CheckCircle2,
  AlertTriangle,
  Car,
  KeyRound,
} from "lucide-react";
import logo from "./mills-logo.svg";
import "./styles.css";
const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY,
);
const norm = (s) =>
  String(s ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
const valid = (v) => /^[A-HJ-NPR-Z0-9]{17}$/.test(v);
const gps = () =>
  new Promise((resolve) =>
    navigator.geolocation
      ? navigator.geolocation.getCurrentPosition(
          (p) =>
            resolve({
              lat: p.coords.latitude,
              lng: p.coords.longitude,
              accuracy: p.coords.accuracy,
            }),
          () => resolve({}),
          { enableHighAccuracy: true, timeout: 10000, maximumAge: 3000 },
        )
      : resolve({}),
  );
async function readVehicleText(video, canvas) {
  const sourceWidth = video.videoWidth,
    sourceHeight = video.videoHeight,
    sx = Math.round(sourceWidth * 0.04),
    sy = Math.round(sourceHeight * 0.25),
    sw = Math.round(sourceWidth * 0.92),
    sh = Math.round(sourceHeight * 0.5),
    scale = Math.max(2, 1800 / sw),
    context = canvas.getContext("2d", { willReadFrequently: true });
  canvas.width = Math.round(sw * scale);
  canvas.height = Math.round(sh * scale);
  context.drawImage(video, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  const worker = await createWorker("eng");
  await worker.setParameters({
    tessedit_char_whitelist: "ABCDEFGHJKLMNPRSTUVWXYZ0123456789",
    tessedit_pageseg_mode: "7",
  });
  const readings = [(await worker.recognize(canvas)).data.text];
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
  for (let i = 0; i < pixels.data.length; i += 4) {
    const gray =
      pixels.data[i] * 0.299 +
      pixels.data[i + 1] * 0.587 +
      pixels.data[i + 2] * 0.114;
    const enhanced = gray < 165 ? 0 : 255;
    pixels.data[i] = enhanced;
    pixels.data[i + 1] = enhanced;
    pixels.data[i + 2] = enhanced;
  }
  context.putImageData(pixels, 0, 0);
  readings.push((await worker.recognize(canvas)).data.text);
  await worker.terminate();
  return readings;
}
function App() {
  const [user, setUser] = useState(null),
    [profile, setProfile] = useState(null),
    [refs, setRefs] = useState({
      regions: [],
      campuses: [],
      dealers: [],
      departments: [],
      zones: [],
    }),
    [ctx, setCtx] = useState(null),
    [tab, setTab] = useState("scan"),
    [msg, setMsg] = useState(null),
    [busy, setBusy] = useState(false),
    [search, setSearch] = useState(""),
    [results, setResults] = useState([]),
    [recent, setRecent] = useState([]);
  useEffect(() => {
    supabase.auth
      .getSession()
      .then(({ data }) => data.session && enter(data.session.user));
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_e, s) => {
      if (!s) {
        setUser(null);
        setProfile(null);
        setCtx(null);
      }
    });
    return () => subscription.unsubscribe();
  }, []);
  async function enter(u) {
    setUser(u);
    const [
      { data: p },
      { data: r },
      { data: c },
      { data: d },
      { data: dp },
      { data: z },
    ] = await Promise.all([
      supabase.from("profiles").select("*").eq("id", u.id).single(),
      supabase.from("regions").select("*").eq("active", true).order("name"),
      supabase.from("campuses").select("*").eq("active", true).order("name"),
      supabase.from("dealerships").select("*").eq("active", true).order("name"),
      supabase.from("departments").select("*").eq("active", true).order("name"),
      supabase.from("zones").select("*").eq("active", true).order("name"),
    ]);
    if (!p || !p.active) {
      await supabase.auth.signOut();
      return setMsg({ bad: true, text: "This account is not active." });
    }
    setProfile(p);
    setRefs({
      regions: r || [],
      campuses: c || [],
      dealers: d || [],
      departments: dp || [],
      zones: z || [],
    });
    const saved = JSON.parse(localStorage.getItem("mills_context") || "null");
    if (saved) setCtx(saved);
    await recordLogin(u.id, "success");
    loadRecent();
  }
  async function recordLogin(uid, event) {
    const g = await gps();
    await supabase.from("login_events").insert({
      user_id: uid,
      event,
      latitude: g.lat,
      longitude: g.lng,
      accuracy_m: g.accuracy,
      user_agent: navigator.userAgent,
      session_id: crypto.randomUUID(),
    });
  }
  async function logout() {
    if (user) await recordLogin(user.id, "logout");
    await supabase.auth.signOut();
  }
  async function loadRecent() {
    const { data } = await supabase
      .from("movements")
      .select(
        "*,vehicles(vin,stock_number,make,model),departments:to_department_id(name,color),dealerships:to_dealership_id(name)",
      )
      .order("created_at", { ascending: false })
      .limit(30);
    setRecent(data || []);
  }
  async function findVehicles(q = search) {
    const text = q.trim();
    if (!text) return setResults([]);
    const v = norm(text);
    const { data } = await supabase
      .from("vehicles")
      .select(
        "*,departments:current_department_id(name,color),dealerships:current_dealership_id(name),zones:current_zone_id(name),profiles:current_custodian_id(display_name)",
      )
      .or(
        `vin.ilike.%${v}%,stock_number.ilike.%${text}%,make.ilike.%${text}%,model.ilike.%${text}%`,
      )
      .limit(40);
    setResults(data || []);
  }
  if (!user) return <Login onSuccess={enter} msg={msg} setMsg={setMsg} />;
  if (profile?.must_change_password)
    return (
      <ChangePassword
        onDone={() => setProfile({ ...profile, must_change_password: false })}
        setMsg={setMsg}
      />
    );
  if (!ctx)
    return (
      <ContextHome
        profile={profile}
        refs={refs}
        onSave={(x) => {
          setCtx(x);
          localStorage.setItem("mills_context", JSON.stringify(x));
        }}
        onLogout={logout}
      />
    );
  return (
    <div className="app">
      <header>
        <button className="brand" onClick={() => setCtx(null)}>
          <img src={logo} />
          <span>
            <Home />
            Change context
          </span>
        </button>
        <button className="logout" onClick={logout}>
          <LogOut />
        </button>
      </header>
      <div className="context">
        <b>{ctx.dealerName}</b>
        <span>
          {ctx.departmentName} • {profile.display_name}
        </span>
      </div>
      <nav>
        <button
          className={tab === "scan" ? "active" : ""}
          onClick={() => setTab("scan")}
        >
          <ScanLine />
          Move
        </button>
        <button
          className={tab === "search" ? "active" : ""}
          onClick={() => setTab("search")}
        >
          <Search />
          Find
        </button>
        <button
          className={tab === "recent" ? "active" : ""}
          onClick={() => {
            setTab("recent");
            loadRecent();
          }}
        >
          <History />
          Recent
        </button>
      </nav>
      <main>
        {tab === "scan" && (
          <Scanner
            ctx={ctx}
            refs={refs}
            user={user}
            setMsg={setMsg}
            onSaved={() => {
              loadRecent();
              setTab("recent");
            }}
          />
        )}
        {tab === "search" && (
          <section>
            <h1>Find a vehicle</h1>
            <div className="searchbox">
              <Search />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && findVehicles()}
                placeholder="VIN, stock, make or model"
              />
              <button onClick={() => findVehicles()}>Search</button>
            </div>
            <VehicleList rows={results} />
          </section>
        )}
        {tab === "recent" && (
          <section>
            <h1>Recent campus movements</h1>
            <div className="movements">
              {recent.map((m) => (
                <div key={m.id}>
                  <i style={{ background: m.departments?.color || "#555" }} />
                  <div>
                    <b>{m.vehicles?.stock_number || m.vehicles?.vin}</b>
                    <span>
                      {[m.vehicles?.make, m.vehicles?.model]
                        .filter(Boolean)
                        .join(" ")}
                    </span>
                    <small>
                      {m.dealerships?.name} • {m.departments?.name}
                    </small>
                  </div>
                  <time>{new Date(m.created_at).toLocaleString()}</time>
                </div>
              ))}
            </div>
          </section>
        )}
      </main>
      {msg && (
        <div
          className={"toast " + (msg.bad ? "bad" : "")}
          onClick={() => setMsg(null)}
        >
          {msg.bad ? <AlertTriangle /> : <CheckCircle2 />}
          <span>{msg.text}</span>
        </div>
      )}
      <footer>Powered by Blood, Sweat, and Tears and built by J. Langer</footer>
    </div>
  );
}
function Login({ onSuccess, msg, setMsg }) {
  const [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [busy, setBusy] = useState(false);
  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    if (error) {
      await supabase.rpc("log_failed_login", {
        p_username: email,
        p_user_agent: navigator.userAgent,
      });
      setMsg({ bad: true, text: error.message });
    } else onSuccess(data.user);
    setBusy(false);
  }
  return (
    <div className="login">
      <div className="login-card">
        <img src={logo} />
        <h1>Campus Vehicle Tracker</h1>
        <p>Authorised Mills Auto Group employees only</p>
        <form onSubmit={submit}>
          <label>
            Work email
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </label>
          <label>
            Password
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </label>
          <button disabled={busy}>
            <KeyRound />
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </form>
        {msg && <div className="login-error">{msg.text}</div>}
      </div>
    </div>
  );
}
function ChangePassword({ onDone, setMsg }) {
  const [password, setPassword] = useState(""),
    [confirm, setConfirm] = useState(""),
    [busy, setBusy] = useState(false);
  async function save(e) {
    e.preventDefault();
    if (password.length < 10 || password !== confirm)
      return setMsg({
        bad: true,
        text: "Passwords must match and contain at least 10 characters.",
      });
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password });
    if (!error) await supabase.rpc("complete_password_change");
    setBusy(false);
    if (error) setMsg({ bad: true, text: error.message });
    else onDone();
  }
  return (
    <div className="login">
      <div className="login-card">
        <img src={logo} />
        <h1>Create a private password</h1>
        <p>Your administrator issued a temporary password.</p>
        <form onSubmit={save}>
          <label>
            New password
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              minLength="10"
              required
            />
          </label>
          <label>
            Confirm password
            <input
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              minLength="10"
              required
            />
          </label>
          <button disabled={busy}>
            <KeyRound />
            {busy ? "Updating…" : "Change password"}
          </button>
        </form>
      </div>
    </div>
  );
}
function ContextHome({ profile, refs, onSave, onLogout }) {
  const [region, setRegion] = useState(profile.region_id || ""),
    [campus, setCampus] = useState(profile.campus_id || ""),
    [dealer, setDealer] = useState(profile.dealership_id || ""),
    [dept, setDept] = useState(profile.department_id || "");
  const campuses = refs.campuses.filter(
      (x) => !region || x.region_id === region,
    ),
    dealers = refs.dealers.filter(
      (x) =>
        (!region || x.region_id === region) &&
        (!campus || x.campus_id === campus),
    );
  function go() {
    const r = refs.regions.find((x) => x.id === region),
      c = refs.campuses.find((x) => x.id === campus),
      d = refs.dealers.find((x) => x.id === dealer),
      p = refs.departments.find((x) => x.id === dept);
    if (!r || !d || !p) return;
    onSave({
      regionId: region,
      regionName: r.name,
      campusId: campus || null,
      campusName: c?.name || "Standalone dealership",
      dealerId: dealer,
      dealerName: d.name,
      departmentId: dept,
      departmentName: p.name,
      departmentColor: p.color,
    });
  }
  return (
    <div className="home">
      <header>
        <img src={logo} />
        <button onClick={onLogout}>
          <LogOut />
          Sign out
        </button>
      </header>
      <main>
        <h1>Where are you working?</h1>
        <p>
          Your selections attach every vehicle movement to the correct team.
        </p>
        <label>
          Region
          <select
            value={region}
            onChange={(e) => {
              setRegion(e.target.value);
              setCampus("");
              setDealer("");
            }}
          >
            <option value="">Select region</option>
            {refs.regions.map((x) => (
              <option value={x.id} key={x.id}>
                {x.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Campus
          <select
            value={campus}
            onChange={(e) => {
              setCampus(e.target.value);
              setDealer("");
            }}
          >
            <option value="">Standalone / select campus</option>
            {campuses.map((x) => (
              <option value={x.id} key={x.id}>
                {x.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Dealership
          <select value={dealer} onChange={(e) => setDealer(e.target.value)}>
            <option value="">Select dealership</option>
            {dealers.map((x) => (
              <option value={x.id} key={x.id}>
                {x.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Department
          <select value={dept} onChange={(e) => setDept(e.target.value)}>
            <option value="">Select department</option>
            {refs.departments.map((x) => (
              <option value={x.id} key={x.id}>
                {x.name}
              </option>
            ))}
          </select>
        </label>
        <div className="identity">
          <span>Signed in as</span>
          <b>{profile.display_name}</b>
        </div>
        <button
          className="enter"
          onClick={go}
          disabled={!region || !dealer || !dept}
        >
          Enter workflow
          <ChevronRight />
        </button>
      </main>
    </div>
  );
}
function Scanner({ ctx, refs, user, setMsg, onSaved }) {
  const [vin, setVin] = useState(""),
    [vehicle, setVehicle] = useState(null),
    [form, setForm] = useState({
      stock: "",
      year: "",
      make: "",
      model: "",
      color: "",
      zone: "",
      notes: "",
      state: "on_campus",
    }),
    [decoded, setDecoded] = useState(null),
    [decodeStatus, setDecodeStatus] = useState(""),
    [vinMatches, setVinMatches] = useState([]),
    [photos, setPhotos] = useState([]),
    [busy, setBusy] = useState(false),
    video = useRef(null),
    canvas = useRef(null),
    stream = useRef(null);
  const zones = refs.zones.filter(
    (z) =>
      z.campus_id === ctx.campusId &&
      (!z.dealership_id || z.dealership_id === ctx.dealerId),
  );
  useEffect(
    () => () => stream.current?.getTracks().forEach((t) => t.stop()),
    [],
  );
  async function camera() {
    try {
      stream.current = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: false,
      });
      video.current.srcObject = stream.current;
      await video.current.play();
    } catch {
      setMsg({
        bad: true,
        text: "Allow camera access or enter the VIN manually.",
      });
    }
  }
  async function read() {
    if (!video.current?.videoWidth) return;
    setBusy(true);
    const c = canvas.current,
      v = video.current;
    try {
      const readings = await readVehicleText(v, c);
      const candidates = readings.flatMap((text) => {
        const compact = norm(text),
          tokens = text.toUpperCase().match(/[A-Z0-9]{4,20}/g) || [];
        for (let i = 0; i <= compact.length - 17; i++)
          tokens.push(compact.slice(i, i + 17));
        return tokens.map(norm);
      });
      let found = "";
      found = candidates.find(valid) || "";
      if (!found) throw Error("VIN not confidently read.");
      setVin(found);
      await lookup(found);
    } catch (e) {
      setMsg({ bad: true, text: e.message });
    }
    setBusy(false);
  }
  async function decodeVin(v) {
    const response = await fetch(
      `https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues/${encodeURIComponent(v)}?format=json`,
    );
    if (!response.ok) throw Error("VIN decoder unavailable");
    const row = (await response.json()).Results?.[0];
    if (!row) throw Error("No decoder result");
    return {
      year: row.ModelYear || "",
      make: row.Make || "",
      model: row.Model || "",
      trim: row.Trim || "",
      body: row.BodyClass || "",
      drive: row.DriveType || "",
      engine: [
        row.EngineCylinders && `${row.EngineCylinders} cyl`,
        row.DisplacementL && `${row.DisplacementL}L`,
        row.FuelTypePrimary,
      ]
        .filter(Boolean)
        .join(" • "),
      manufacturer: row.Manufacturer || "",
      plant: [row.PlantCity, row.PlantState, row.PlantCountry]
        .filter(Boolean)
        .join(", "),
    };
  }
  async function lookup(raw = vin) {
    const v = norm(raw);
    if (v.length >= 6 && v.length <= 8) {
      setBusy(true);
      const { data, error } = await supabase
        .from("vehicles")
        .select("id,vin,stock_number,year,make,model,color")
        .ilike("vin", `%${v}`)
        .limit(20);
      setBusy(false);
      if (error) return setMsg({ bad: true, text: error.message });
      if (data?.length === 1) {
        setVinMatches([]);
        return lookup(data[0].vin);
      }
      if (data?.length > 1) {
        setVinMatches(data);
        return setMsg({
          text: `${data.length} vehicles match ${v}. Select the correct vehicle.`,
        });
      }
      setVinMatches([]);
      return setMsg({
        bad: true,
        text: "No existing vehicle matches those last characters. A complete 17-character VIN is required to create a new vehicle.",
      });
    }
    if (!valid(v))
      return setMsg({
        bad: true,
        text: "Enter a full 17-character VIN or its last 6–8 characters.",
      });
    setBusy(true);
    setDecoded(null);
    setDecodeStatus("Decoding VIN…");
    const { data, error } = await supabase
      .from("vehicles")
      .select("*")
      .eq("vin", v)
      .maybeSingle();
    if (error) {
      setBusy(false);
      setDecodeStatus("");
      return setMsg({ bad: true, text: error.message });
    }
    let details = null;
    try {
      details = await decodeVin(v);
      setDecoded(details);
      setDecodeStatus("Decoded by NHTSA vPIC — verify before saving.");
    } catch {
      setDecodeStatus(
        "Decoder unavailable — enter the vehicle details manually.",
      );
    }
    setVin(v);
    setVinMatches([]);
    setVehicle(data || null);
    if (data)
      setForm({
        stock: data.stock_number || "",
        year: data.year || details?.year || "",
        make: data.make || details?.make || "",
        model: data.model || details?.model || "",
        color: data.color || "",
        zone: data.current_zone_id || "",
        notes: "",
        state: data.state || "on_campus",
      });
    else
      setForm({
        stock: "",
        year: details?.year || "",
        make: details?.make || "",
        model: details?.model || "",
        color: "",
        zone: "",
        notes: "",
        state: "on_campus",
      });
    setBusy(false);
  }
  async function save() {
    if (!valid(vin))
      return setMsg({ bad: true, text: "A valid VIN is required." });
    setBusy(true);
    try {
      const g = await gps();
      const { data, error } = await supabase.rpc("transfer_vehicle", {
        p_vin: vin,
        p_stock: form.stock,
        p_year: form.year ? Number(form.year) : null,
        p_make: form.make,
        p_model: form.model,
        p_color: form.color,
        p_region: ctx.regionId,
        p_campus: ctx.campusId,
        p_dealership: ctx.dealerId,
        p_department: ctx.departmentId,
        p_zone: form.zone || null,
        p_lat: g.lat || null,
        p_lng: g.lng || null,
        p_accuracy: g.accuracy || null,
        p_notes: form.notes,
        p_state: form.state,
      });
      if (error) throw error;
      const rec = data?.[0];
      for (let i = 0; i < photos.length; i++) {
        const f = photos[i],
          path = `${user.id}/${rec.vehicle_id}/${Date.now()}-${i}.jpg`;
        const { error: up } = await supabase.storage
          .from("vehicle-photos")
          .upload(path, f, { contentType: f.type || "image/jpeg" });
        if (up) throw up;
        const { error: db } = await supabase.from("vehicle_photos").insert({
          vehicle_id: rec.vehicle_id,
          movement_id: rec.movement_id,
          storage_path: path,
          taken_by: user.id,
        });
        if (db) throw db;
      }
      setMsg({
        text: `${form.stock || vin} updated to ${ctx.departmentName}.${g.lat ? " GPS captured." : " GPS unavailable."}`,
      });
      setVin("");
      setVehicle(null);
      setDecoded(null);
      setDecodeStatus("");
      setVinMatches([]);
      setPhotos([]);
      onSaved();
    } catch (e) {
      setMsg({ bad: true, text: e.message });
    }
    setBusy(false);
  }
  return (
    <section>
      <h1>Move or receive vehicle</h1>
      <p className="lead">
        Scanning into{" "}
        <b style={{ color: ctx.departmentColor }}>{ctx.departmentName}</b>
      </p>
      <div className="camera">
        <video ref={video} playsInline muted />
        <canvas ref={canvas} hidden />
        <div>ALIGN PRINTED VIN</div>
      </div>
      <div className="two">
        <button onClick={camera}>
          <Camera />
          Start camera
        </button>
        <button onClick={read} disabled={busy}>
          <ScanLine />
          {busy ? "Reading…" : "Read VIN"}
        </button>
      </div>
      <div className="vin-entry">
        <input
          value={vin}
          maxLength="17"
          onChange={(e) => {
            setVin(norm(e.target.value));
            setVehicle(null);
            setDecoded(null);
            setDecodeStatus("");
            setVinMatches([]);
          }}
          placeholder="Full VIN or last 6–8"
        />
        <button onClick={() => lookup()} disabled={busy}>
          {busy ? "Checking…" : "Continue"}
        </button>
      </div>
      {vinMatches.length > 1 && (
        <div className="vin-matches">
          <b>Select the correct vehicle</b>
          {vinMatches.map((match) => (
            <button key={match.id} onClick={() => lookup(match.vin)}>
              <strong>{match.stock_number || "No stock number"}</strong>
              <span>
                {[match.year, match.make, match.model]
                  .filter(Boolean)
                  .join(" ") || "Vehicle details unavailable"}
              </span>
              <small>{match.vin}</small>
            </button>
          ))}
        </div>
      )}
      {(vehicle || valid(vin)) && (
        <div className="vehicle-form">
          <div className="vehicle-state">
            <Car />
            <div>
              <b>{vehicle ? "Vehicle found" : "New vehicle"}</b>
              <span>
                {vehicle
                  ? "Current record will remain in its history."
                  : "This scan creates the initial record."}
              </span>
            </div>
          </div>
          {decodeStatus && (
            <div className={`decoder-status ${!decoded ? "warning" : ""}`}>
              <b>{decodeStatus}</b>
              {decoded && (
                <div>
                  {[
                    decoded.trim,
                    decoded.body,
                    decoded.drive,
                    decoded.engine,
                    decoded.manufacturer,
                    decoded.plant,
                  ]
                    .filter(Boolean)
                    .map((item, index) => (
                      <span key={index}>{item}</span>
                    ))}
                </div>
              )}
            </div>
          )}
          <div className="grid">
            <label>
              Stock number
              <input
                value={form.stock}
                onChange={(e) =>
                  setForm({ ...form, stock: e.target.value.toUpperCase() })
                }
              />
            </label>
            <label>
              Year
              <input
                type="number"
                value={form.year}
                onChange={(e) => setForm({ ...form, year: e.target.value })}
              />
            </label>
            <label>
              Make
              <input
                value={form.make}
                onChange={(e) => setForm({ ...form, make: e.target.value })}
              />
            </label>
            <label>
              Model
              <input
                value={form.model}
                onChange={(e) => setForm({ ...form, model: e.target.value })}
              />
            </label>
            <label>
              Colour
              <input
                value={form.color}
                onChange={(e) => setForm({ ...form, color: e.target.value })}
              />
            </label>
            <label>
              Campus zone
              <select
                value={form.zone}
                onChange={(e) => setForm({ ...form, zone: e.target.value })}
              >
                <option value="">GPS only / no zone</option>
                {zones.map((z) => (
                  <option key={z.id} value={z.id}>
                    {z.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Vehicle state
              <select
                value={form.state}
                onChange={(e) => setForm({ ...form, state: e.target.value })}
              >
                <option value="on_campus">On campus</option>
                <option value="off_campus">Off campus</option>
                <option value="delivered">Delivered</option>
                <option value="sold">Sold</option>
                <option value="removed">Removed</option>
              </select>
            </label>
            <label className="wide">
              Notes
              <textarea
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
              />
            </label>
          </div>
          <label className="photos">
            <ImagePlus />
            Add up to two location photos
            <input
              type="file"
              accept="image/*"
              capture="environment"
              multiple
              onChange={(e) => setPhotos([...e.target.files].slice(0, 2))}
            />
            <span>
              {photos.length
                ? `${photos.length} photo${photos.length > 1 ? "s" : ""} selected`
                : "Optional"}
            </span>
          </label>
          <button className="save" onClick={save} disabled={busy}>
            {busy ? "Saving movement…" : "Update location and custody"}
          </button>
        </div>
      )}
    </section>
  );
}
function VehicleList({ rows }) {
  return (
    <div className="vehicle-list">
      {rows.map((v) => (
        <div key={v.id}>
          <i style={{ background: v.departments?.color || "#777" }} />
          <div>
            <b>{v.stock_number || v.vin}</b>
            <span>{[v.year, v.make, v.model].filter(Boolean).join(" ")}</span>
            <small>{v.vin}</small>
            <small>
              {v.dealerships?.name} • {v.departments?.name} •{" "}
              {v.zones?.name || "GPS location"}
            </small>
          </div>
          <time>{new Date(v.last_seen_at).toLocaleString()}</time>
        </div>
      ))}
    </div>
  );
}
createRoot(document.getElementById("root")).render(<App />);
