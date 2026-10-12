import { useCallback, useEffect, useRef, useState } from "react";
import Docs from "./Docs.jsx";

const CLOUDS = {
  aws:   { label: "AWS",   service: "S3",            unit: "bucket",    uri: "S3 URI" },
  azure: { label: "Azure", service: "Blob Storage",  unit: "container", uri: "Blob URI" },
  gcp:   { label: "GCP",   service: "Cloud Storage", unit: "bucket",    uri: "GCS URI" },
};
const EXT = {
  image: "png jpg jpeg gif webp svg bmp", pdf: "pdf", video: "mp4 webm mov", audio: "mp3 wav ogg m4a",
  text: "txt md json csv log yml yaml xml html py js jsx ts css sh toml ini",
};
const kindOf = (name) => { const e = name.split(".").pop().toLowerCase(); return Object.keys(EXT).find((k) => EXT[k].split(" ").includes(e)) || "none"; };

const api = async (path, opts) => {
  const r = await fetch("/api" + path, opts);
  if (!r.ok) {
    let msg = r.statusText;
    try { msg = (await r.json()).detail; } catch {}
    throw new Error(msg);
  }
  return r.json();
};
const send = (method, body) => ({ method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const size = (n) => n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`;
const hl = (t, q) => {
  const i = t.toLowerCase().indexOf(q.toLowerCase());
  return i < 0 ? t : <>{t.slice(0, i)}<mark>{t.slice(i, i + q.length)}</mark>{t.slice(i + q.length)}</>;
};
const when = (s) => (s ? new Date(s).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "");

function Copy({ text }) {
  const [ok, setOk] = useState(false);
  return <button className="ghost sm" onClick={() => { navigator.clipboard.writeText(text); setOk(true); setTimeout(() => setOk(false), 1500); }}>{ok ? "Copied" : "Copy"}</button>;
}

function Details({ cloud, bucket, item, onClose }) {
  const [m, setM] = useState(null);
  const [err, setErr] = useState("");
  const [text, setText] = useState(null);
  const [exp, setExp] = useState(3600);
  const [link, setLink] = useState("");
  const q = encodeURIComponent(item.key);
  const src = `/api/${cloud}/b/${bucket}/download?inline=1&key=${q}`;
  const kind = item.folder ? "none" : kindOf(item.name);

  useEffect(() => {
    api(`/${cloud}/b/${bucket}/meta?key=${q}`).then(setM).catch((e) => setErr(e.message));
    if (kind === "text") fetch(src).then((r) => r.text()).then((t) => setText(t.slice(0, 20000)));
    const esc = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, []);

  const share = async () => {
    try { setLink((await api(`/${cloud}/b/${bucket}/share`, send("POST", { key: item.key, expires: exp }))).url); }
    catch (e) { setErr(e.message); }
  };
  const parent = item.key.slice(0, item.key.length - item.name.length - (item.folder ? 1 : 0));
  const rows = m && [
    ["Name", item.name],
    ["Location", `${bucket}/${parent}`],
    item.folder ? ["Items", String(m.count)] : ["Size", `${size(m.size)} (${m.size.toLocaleString()} bytes)`],
    !item.folder && ["Type", m.type],
    !item.folder && ["Modified", when(m.modified)],
    [CLOUDS[cloud].uri, m.uri, true],
    !item.folder && ["Object URL", m.url, true],
  ].filter(Boolean);

  const view = {
    image: <img src={src} alt={item.name} />, pdf: <iframe src={src} title={item.name} />,
    video: <video src={src} controls />, audio: <audio src={src} controls />,
    text: <pre>{text ?? "Loading…"}</pre>,
  }[kind];

  return (
    <div className="backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-label={item.name}>
        <header><h2>{item.name}</h2><button className="x" onClick={onClose} aria-label="Close">×</button></header>
        <div className="body">
          <div className="preview">{item.folder ? <i className="ico folder big" /> : view || <div className="blank">No preview for this file type.</div>}</div>
          <div className="props">
            {err && <div className="error">{err}</div>}
            <dl>{rows?.map(([k, v, c]) => (
              <div key={k}><dt>{k}</dt><dd className={c ? "mono" : ""}>{v}{c && <Copy text={v} />}</dd></div>
            ))}</dl>
            {!item.folder && (
              <div className="share">
                <h3>Share</h3>
                <div className="sharerow">
                  <select value={exp} onChange={(e) => { setExp(+e.target.value); setLink(""); }} aria-label="Link expiry">
                    <option value={3600}>Expires in 1 hour</option><option value={86400}>Expires in 1 day</option><option value={604800}>Expires in 7 days</option>
                  </select>
                  <button className="primary" onClick={share}>Create public link</button>
                </div>
                {link && <div className="linkbox"><input readOnly value={link} onFocus={(e) => e.target.select()} /><Copy text={link} /></div>}
                {link && <p className="note">Anyone who has this link can read the file until it expires.</p>}
                <div className="sharerow">
                  <a className="ghost" href={`/api/${cloud}/b/${bucket}/download?key=${q}`}>Download</a>
                  {link && <a className="ghost" href={link} target="_blank" rel="noreferrer">Open link</a>}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Dialog({ d, onClose }) {
  const [v, setV] = useState(d.label ? "" : null);
  const [err, setErr] = useState("");
  const ref = useRef();
  useEffect(() => {
    ref.current?.focus();
    const esc = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, []);
  const submit = (e) => {
    e.preventDefault();
    const val = v?.trim();
    const msg = d.check?.(val);
    if (msg) return setErr(msg);
    onClose();
    d.onOk(val);
  };
  return (
    <div className="backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form className="modal dlg" onSubmit={submit} role="dialog" aria-label={d.title}>
        <header><h2>{d.title}</h2><button type="button" className="x" onClick={onClose} aria-label="Close">×</button></header>
        <div className="dbody">
          {d.message && <p>{d.message}</p>}
          {d.label && (
            <label>{d.label}
              <input ref={ref} value={v} placeholder={d.placeholder} aria-invalid={!!err} autoComplete="off" spellCheck="false"
                     onChange={(e) => { setV(e.target.value); setErr(""); }} />
            </label>
          )}
          {err ? <p className="ferr" role="alert">{err}</p> : d.hint && <p className="note">{d.hint}</p>}
        </div>
        <footer>
          <button type="button" className="ghost" onClick={onClose}>Cancel</button>
          <button type="submit" ref={d.label ? null : ref} className={"primary" + (d.danger ? " danger" : "")}>{d.ok}</button>
        </footer>
      </form>
    </div>
  );
}

export default function App() {
  const [view, setView] = useState("files");
  const [cloud, setCloud] = useState(localStorage.getItem("cloud") || "aws");
  const [buckets, setBuckets] = useState([]);
  const [bucket, setBucket] = useState(null);
  const [prefix, setPrefix] = useState("");
  const [items, setItems] = useState({ folders: [], files: [] });
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);
  const [sel, setSel] = useState("");
  const [menu, setMenu] = useState(null);
  const [clip, setClip] = useState(null);
  const [detail, setDetail] = useState(null);
  const [dlg, setDlg] = useState(null);
  const [q, setQ] = useState("");
  const [res, setRes] = useState(null);
  const picker = useRef();
  const c = CLOUDS[cloud];

  const run = async (fn) => {
    setBusy(true); setError("");
    try { return await fn(); } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  const say = (t) => { setNote(t); setTimeout(() => setNote(""), 3500); };

  const loadBuckets = useCallback(() => run(async () => setBuckets(await api(`/${cloud}/b`))), [cloud]);
  const loadItems = useCallback(() => bucket
    ? run(async () => setItems(await api(`/${cloud}/b/${bucket}/ls?prefix=${encodeURIComponent(prefix)}`)))
    : setItems({ folders: [], files: [] }), [cloud, bucket, prefix]);

  useEffect(() => { localStorage.setItem("cloud", cloud); setBucket(null); setPrefix(""); setBuckets([]); setClip(null); setQ(""); setRes(null); loadBuckets(); }, [cloud]);
  useEffect(() => { loadItems(); setSel(""); }, [loadItems]);
  useEffect(() => {
    const close = () => setMenu(null);
    const esc = (e) => e.key === "Escape" && close();
    window.addEventListener("click", close); window.addEventListener("keydown", esc); window.addEventListener("scroll", close, true);
    return () => { window.removeEventListener("click", close); window.removeEventListener("keydown", esc); window.removeEventListener("scroll", close, true); };
  }, []);

  const addBucket = () => setDlg({
    title: `New ${c.unit}`, label: `${c.unit[0].toUpperCase() + c.unit.slice(1)} name`, placeholder: "my-demo-bucket",
    hint: "Lowercase letters, numbers and hyphens, 3 to 63 characters.", ok: "Create",
    check: (n) => (/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(n) ? "" : "Use 3-63 lowercase letters, numbers or hyphens, starting and ending with a letter or number."),
    onOk: (name) => run(async () => { await api(`/${cloud}/b`, send("POST", { name })); await loadBuckets(); setBucket(name); setPrefix(""); }),
  });
  const dropBucket = (name) => setDlg({
    title: `Delete ${c.unit}`, message: `Delete ${c.unit} "${name}" and everything in it? This can't be undone.`, ok: "Delete", danger: true,
    onOk: () => run(async () => { await api(`/${cloud}/b/${name}`, { method: "DELETE" }); if (bucket === name) setBucket(null); await loadBuckets(); }),
  });
  const addFolder = () => setDlg({
    title: "New folder", label: "Folder name", placeholder: "reports", hint: `It will be created in ${bucket}/${prefix}`, ok: "Create",
    check: (n) => (!n ? "Enter a folder name." : n.includes("/") ? "Folder names can't contain a slash." : ""),
    onOk: (name) => run(async () => { await api(`/${cloud}/b/${bucket}/folder`, send("POST", { path: prefix + name })); await loadItems(); }),
  });
  const upload = (files) => files.length && run(async () => {
    const fd = new FormData();
    fd.append("prefix", prefix);
    [...files].forEach((f) => fd.append("files", f));
    await api(`/${cloud}/b/${bucket}/upload`, { method: "POST", body: fd });
    await loadItems();
  });
  const remove = (it) => setDlg({
    title: it.folder ? "Delete folder" : "Delete file", ok: "Delete", danger: true,
    message: `Delete ${it.folder ? "folder and its contents" : "file"} "${it.name}"? This can't be undone.`,
    onOk: () => run(async () => { await api(`/${cloud}/b/${it.bucket || bucket}/object?key=${encodeURIComponent(it.key)}`, { method: "DELETE" });
      setRes((r) => r && { ...r,
        folders: r.folders.filter((x) => !(x.key.startsWith(it.key) && x.bucket === (it.bucket || bucket))),
        files: r.files.filter((x) => !(x.key.startsWith(it.key) && x.bucket === (it.bucket || bucket))) });
      await loadItems(); }),
  });
  const paste = () => run(async () => {
    const r = await api(`/${cloud}/transfer`, send("POST", {
      src_bucket: clip.bucket, key: clip.key, dst_bucket: bucket, dst_prefix: prefix, move: clip.mode === "move" }));
    say(`${clip.mode === "move" ? "Moved" : "Copied"} ${r.count} file${r.count === 1 ? "" : "s"} to ${bucket}/${prefix}`);
    if (clip.mode === "move") setClip(null);
    await loadItems();
  });
  const download = (it) => { const a = document.createElement("a"); a.href = `/api/${cloud}/b/${it.bucket || bucket}/download?key=${encodeURIComponent(it.key)}`; a.click(); };
  const clearSearch = () => { setQ(""); setRes(null); };
  const goTo = (it) => { setRes(null); setQ(""); setBucket(it.bucket); setPrefix(it.folder ? it.key : it.path); };

  useEffect(() => {
    const term = q.trim();
    if (!term) { setRes(null); return; }
    const id = setTimeout(() => {
      setBusy(true); setError("");
      api(`/${cloud}/search?q=${encodeURIComponent(term)}`)
        .then(setRes).catch((e) => setError(e.message)).finally(() => setBusy(false));
    }, 350);
    return () => clearTimeout(id);
  }, [q, cloud]);
  const open = (it) => (it.folder ? (it.bucket ? goTo(it) : setPrefix(it.key)) : setDetail(it));
  const grab = (mode, it) => setClip({ mode, bucket: it.bucket || bucket, key: it.key, name: it.name });

  const openMenu = (x, y, it) => setMenu({ x: Math.min(x, innerWidth - 210), y: Math.min(y, innerHeight - 260), it });
  const ctx = (e, it) => { e.preventDefault(); e.stopPropagation(); setSel(it?.key || ""); openMenu(e.clientX, e.clientY, it); };
  const menuItems = (it) => (it ? [
    ["Open", () => open(it)],
    it.bucket && ["Go to location", () => goTo(it)],
    !it.folder && ["Download", () => download(it)],
    ["Copy", () => grab("copy", it)],
    ["Move", () => grab("move", it)],
    ["Properties", () => setDetail(it)],
    ["Delete", () => remove(it), "danger"],
  ] : [
    clip && [`Paste here`, paste],
    ["New folder", addFolder], ["Upload files", () => picker.current.click()], ["Refresh", loadItems],
  ]).filter(Boolean);

  const crumbs = prefix.split("/").filter(Boolean);
  const up = () => setPrefix(crumbs.slice(0, -1).join("/") + (crumbs.length > 1 ? "/" : ""));
  const rows = [
    ...items.folders.map((f) => ({ key: f, folder: true, name: f.slice(prefix.length, -1) })),
    ...items.files.map((f) => ({ ...f, name: f.key.slice(prefix.length) })),
  ];

  return (
    <div className="app" data-cloud={cloud}>
      <aside>
        <h1>Cloud Files</h1>
        <div className="switch" role="tablist" aria-label="Cloud provider">
          {Object.entries(CLOUDS).map(([id, v]) => (
            <button key={id} role="tab" aria-selected={cloud === id} className={cloud === id ? "on" : ""} onClick={() => setCloud(id)}>{v.label}</button>
          ))}
        </div>
        <p className="svc">{c.service} on a local Floci emulator</p>
        <nav className="nav">
          <button className={view === "files" ? "on" : ""} onClick={() => setView("files")}>Files</button>
          <button className={view === "docs" ? "on" : ""} onClick={() => setView("docs")}>Python docs</button>
        </nav>
        <div className="side-head"><span>{c.unit}s</span><button className="ghost" onClick={addBucket}>+ New</button></div>
        <ul className="buckets">
          {buckets.map((b) => (
            <li key={b} className={b === bucket ? "sel" : ""}>
              <button onClick={() => { setBucket(b); setPrefix(""); setRes(null); setView("files"); }}>{b}</button>
              <button className="x" title={`Delete ${b}`} onClick={() => dropBucket(b)}>×</button>
            </li>
          ))}
          {!buckets.length && <li className="hint">No {c.unit}s yet. Create one to start.</li>}
        </ul>
      </aside>

      <main
        onDragOver={(e) => { if (view === "files" && bucket && !res) { e.preventDefault(); setDrag(true); } }}
        onDragLeave={(e) => e.currentTarget === e.target && setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); bucket && !res && upload(e.dataTransfer.files); }}
        onContextMenu={(e) => { if (view === "files" && bucket && !res) ctx(e, null); }}
      >
        {error && <div className="error" role="alert">{error}<button onClick={() => setError("")}>Dismiss</button></div>}
        {view === "files" && (
          <form className="search" role="search" onSubmit={(e) => { e.preventDefault(); const term = q.trim(); if (term) { setBusy(true); setError(""); api(`/${cloud}/search?q=${encodeURIComponent(term)}`).then(setRes).catch((ev) => setError(ev.message)).finally(() => setBusy(false)); } }}>
            <input value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search buckets, folders, and files"
                   placeholder={`Search ${c.unit}s, folders, and files on ${c.label}…`} />
            {q && <button type="button" className="ghost" onClick={clearSearch}>Clear</button>}
            {busy && q.trim() && <span className="spin">Searching…</span>}
          </form>
        )}
        {view === "docs" ? <Docs /> : res ? (
          <>
            <p className="note">
              {res.buckets.length + res.folders.length + res.files.length}{res.truncated ? "+" : ""} result{res.buckets.length + res.folders.length + res.files.length === 1 ? "" : "s"} for <b>{res.q}</b> across {res.searched} {c.unit}{res.searched === 1 ? "" : "s"} on {c.label}
              {res.truncated && " (file results capped at 200, refine your search)"}
            </p>
            {res.buckets.length > 0 && (<>
              <p className="section-head">{c.unit}s</p>
              <table>
                <thead><tr><th>Name</th><th /></tr></thead>
                <tbody>{res.buckets.map((b) => (
                  <tr key={b.name} className="row" onDoubleClick={() => { setRes(null); setQ(""); setBucket(b.name); setPrefix(""); }}>
                    <td><span className="name"><i className="ico bucket" />{hl(b.name, res.q)}</span></td>
                    <td className="act"><button onClick={() => { setRes(null); setQ(""); setBucket(b.name); setPrefix(""); setView("files"); }}>Open</button></td>
                  </tr>
                ))}</tbody>
              </table>
            </>)}
            {res.folders.length > 0 && (<>
              <p className="section-head">Folders</p>
              <table>
                <thead><tr><th>Name</th><th>Location</th><th /></tr></thead>
                <tbody>{res.folders.map((it) => (
                  <tr key={it.bucket + "/" + it.key} className="row" onDoubleClick={() => goTo(it)} onContextMenu={(e) => ctx(e, it)}>
                    <td><span className="name dir"><i className="ico folder" />{hl(it.name, res.q)}</span></td>
                    <td className="loc">{it.bucket}/{hl(it.path, res.q)}</td>
                    <td className="act"><button aria-label={`Actions for ${it.name}`} onClick={(e) => { e.stopPropagation(); const r = e.currentTarget.getBoundingClientRect(); openMenu(r.left, r.bottom, it); }}>⋯</button></td>
                  </tr>
                ))}</tbody>
              </table>
            </>)}
            {res.files.length > 0 && (<>
              <p className="section-head">Files{res.truncated ? " (first 200)" : ""}</p>
              <table>
                <thead><tr><th>Name</th><th>Location</th><th className="num">Size</th><th>Modified</th><th /></tr></thead>
                <tbody>{res.files.map((it) => (
                  <tr key={it.bucket + "/" + it.key} className="row" onDoubleClick={() => open(it)} onContextMenu={(e) => ctx(e, it)}>
                    <td><span className="name"><i className="ico file" />{hl(it.name, res.q)}</span></td>
                    <td className="loc">{it.bucket}/{hl(it.path, res.q)}</td>
                    <td className="num">{size(it.size)}</td>
                    <td>{when(it.modified)}</td>
                    <td className="act"><button aria-label={`Actions for ${it.name}`} onClick={(e) => { e.stopPropagation(); const r = e.currentTarget.getBoundingClientRect(); openMenu(r.left, r.bottom, it); }}>⋯</button></td>
                  </tr>
                ))}</tbody>
              </table>
            </>)}
            {res.buckets.length === 0 && res.folders.length === 0 && res.files.length === 0 && (
              <div className="blank">No results match "{res.q}" on {c.label}.</div>
            )}
          </>
        ) : !bucket ? (
          <div className="blank">Pick or create a {c.unit} to browse its files.</div>
        ) : (
          <>
            <div className="bar">
              <nav className="path" aria-label="Location">
                <button onClick={() => setPrefix("")}>{bucket}</button>
                {crumbs.map((p, i) => <span key={i}>/<button onClick={() => setPrefix(crumbs.slice(0, i + 1).join("/") + "/")}>{p}</button></span>)}
              </nav>
              <div className="tools">
                {busy && <span className="spin">Working…</span>}
                {note && <span className="spin ok">{note}</span>}
                <button className="ghost" onClick={loadItems}>Refresh</button>
                <button className="ghost" onClick={addFolder}>New folder</button>
                <button className="primary" onClick={() => picker.current.click()}>Upload files</button>
                <input ref={picker} type="file" multiple hidden onChange={(e) => { upload(e.target.files); e.target.value = ""; }} />
              </div>
            </div>
            {clip && (
              <div className="clip">
                <span>{clip.mode === "move" ? "Moving" : "Copying"} <b>{clip.name}</b> from {clip.bucket}</span>
                <button className="primary sm" onClick={paste}>{clip.mode === "move" ? "Move" : "Copy"} here</button>
                <button className="ghost sm" onClick={() => setClip(null)}>Cancel</button>
              </div>
            )}
            <table>
              <thead><tr><th>Name</th><th className="num">Size</th><th>Modified</th><th /></tr></thead>
              <tbody>
                {prefix && <tr className="row" onDoubleClick={up}><td colSpan="4"><button className="name" onClick={up}>▸ ..</button></td></tr>}
                {rows.map((it) => (
                  <tr key={it.key} className={"row" + (sel === it.key ? " sel" : "") + (clip?.key === it.key && clip.bucket === bucket && clip.mode === "move" ? " cut" : "")}
                      onClick={() => setSel(it.key)} onDoubleClick={() => open(it)} onContextMenu={(e) => ctx(e, it)}>
                    <td><span className={"name" + (it.folder ? " dir" : "")}><i className={"ico " + (it.folder ? "folder" : "file")} />{it.name}</span></td>
                    <td className="num">{it.folder ? "—" : size(it.size)}</td>
                    <td>{it.folder ? "" : when(it.modified)}</td>
                    <td className="act"><button aria-label={`Actions for ${it.name}`} onClick={(e) => { e.stopPropagation(); const r = e.currentTarget.getBoundingClientRect(); setSel(it.key); openMenu(r.left, r.bottom, it); }}>⋯</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!rows.length && <div className="blank">This folder is empty. Drop files here or use Upload files.</div>}
          </>
        )}
        {drag && <div className="drop">Drop to upload to /{prefix}</div>}
      </main>

      {menu && (
        <ul className="menu" style={{ left: menu.x, top: menu.y }} role="menu" onClick={(e) => e.stopPropagation()}>
          {menuItems(menu.it).map(([label, fn, tone]) => (
            <li key={label}><button role="menuitem" className={tone} onClick={() => { setMenu(null); fn(); }}>{label}</button></li>
          ))}
        </ul>
      )}
      {dlg && <Dialog key={dlg.title} d={dlg} onClose={() => setDlg(null)} />}
      {detail && <Details key={(detail.bucket || bucket) + detail.key} cloud={cloud} bucket={detail.bucket || bucket} item={detail} onClose={() => setDetail(null)} />}
    </div>
  );
}
