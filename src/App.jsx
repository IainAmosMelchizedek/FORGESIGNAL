import { useState, useRef } from "react";

const GITHUB_API = "https://api.github.com";

const EXT_MAP = {
  code: ["js","ts","jsx","tsx","py","rb","go","java","cpp","c","cs","sh","rs","php","swift","kt","vue","svelte"],
  data: ["json","csv","xml","yaml","yml","toml","sql","graphql","proto"],
  docs: ["md","rst","txt","html","htm","adoc"],
  config: ["dockerfile","makefile","gemfile","env","lock","ini","cfg","conf"],
  notebook: ["ipynb"],
  image: ["png","jpg","jpeg","webp","gif","svg"],
};
const CONFIG_NAMES = ["package.json","requirements.txt","cargo.toml","go.mod","pom.xml","docker-compose.yml","dockerfile","makefile"];

function categorize(path) {
  const name = path.split("/").pop().toLowerCase();
  const ext = name.includes(".") ? name.split(".").pop() : name;
  if (CONFIG_NAMES.some(c => name.startsWith(c))) return "config";
  for (const [cat, exts] of Object.entries(EXT_MAP)) {
    if (exts.includes(ext)) return cat;
  }
  return "other";
}

function ghHeaders(token) {
  const h = { Accept: "application/vnd.github+json" };
  if (token) h["Authorization"] = `Bearer ${token}`;
  return h;
}

async function fetchRepoData(owner, repo, token) {
  const headers = ghHeaders(token);
  const [repoRes, treesRes, languagesRes] = await Promise.all([
    fetch(`${GITHUB_API}/repos/${owner}/${repo}`, { headers }),
    fetch(`${GITHUB_API}/repos/${owner}/${repo}/git/trees/HEAD?recursive=1`, { headers }),
    fetch(`${GITHUB_API}/repos/${owner}/${repo}/languages`, { headers }),
  ]);
  if (!repoRes.ok) {
    const e = await repoRes.json().catch(() => ({}));
    if (repoRes.status === 404) throw new Error("Repo not found. Check the URL and make sure it's public.");
    if (repoRes.status === 401) throw new Error("Invalid GitHub token.");
    if (repoRes.status === 403) throw new Error("Rate limit hit. Add a GitHub token.");
    throw new Error(e.message || `GitHub error: ${repoRes.status}`);
  }
  const repoInfo = await repoRes.json();
  const trees = treesRes.ok ? await treesRes.json() : { tree: [] };
  const languages = languagesRes.ok ? await languagesRes.json() : {};
  const allFiles = (trees.tree || []).filter(f => f.type === "blob").map(f => ({
    path: f.path, url: f.url, size: f.size || 0, category: categorize(f.path)
  }));
  const sampled = {};
  for (const f of allFiles) {
    if (!sampled[f.category]) sampled[f.category] = [];
    if (sampled[f.category].length < 5 && f.size < 50000) sampled[f.category].push(f);
  }
  return {
    name: repoInfo.name, description: repoInfo.description || "No description",
    stars: repoInfo.stargazers_count, forks: repoInfo.forks_count,
    topics: repoInfo.topics || [], languages, allFiles, sampled
  };
}

async function fetchFileContents(files, owner, repo, token) {
  const headers = ghHeaders(token);
  const results = [];
  for (const f of files.slice(0, 20)) {
    try {
      const res = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/contents/${f.path}`, { headers });
      if (!res.ok) continue;
      const data = await res.json();
      if (data.encoding === "base64" && data.content) {
        const text = atob(data.content.replace(/\n/g, "")).slice(0, 2000);
        results.push({ path: f.path, category: f.category, preview: text });
      }
    } catch { }
  }
  return results;
}

function parseGithubUrl(url) {
  const match = url.match(/github\.com\/([^/]+)\/([^/\s]+)/);
  if (!match) throw new Error("Invalid GitHub URL. Example: https://github.com/owner/repo");
  return { owner: match[1], repo: match[2].replace(/\.git$/, "") };
}

async function callClaude(messages, useSearch = false, anthropicKey = "") {
  const body = { model: "claude-sonnet-4-20250514", max_tokens: 1500, messages };
  if (useSearch) body.tools = [{ type: "web_search_20250305", name: "web_search" }];
  const headers = { "Content-Type": "application/json" };
  if (anthropicKey) headers["x-api-key"] = anthropicKey;
  const res = await fetch("/api/claude", {
    method: "POST", headers, body: JSON.stringify(body),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message || "Anthropic API error");
  const text = data.content.filter(b => b.type === "text").map(b => b.text).join("");
  return JSON.parse(text.replace(/```json|```/g, "").trim());
}

async function quickAnalysis(repoData, previews, anthropicKey) {
  const cats = repoData.allFiles.reduce((a, f) => { a[f.category] = (a[f.category]||0)+1; return a; }, {});
  const previewText = previews.map(f => `--- ${f.path} ---\n${f.preview}`).join("\n\n").slice(0, 6000);
  const prompt = `You are a senior product strategist and software architect. Analyze this GitHub repository and determine whether it has the raw material to produce a product of consequence. Evaluate across ALL build scales and ALL monetization models.

Repo: ${repoData.name} | Stars: ${repoData.stars} | Forks: ${repoData.forks}
Description: ${repoData.description}
Languages: ${Object.keys(repoData.languages).join(", ")}
Topics: ${repoData.topics.join(", ") || "none"}
File categories: ${JSON.stringify(cats)}
Files (sample): ${repoData.allFiles.slice(0, 60).map(f => f.path).join(", ")}
File previews:\n${previewText}

Return ONLY this JSON (no markdown):
{"repoSummary":"","domainSignals":[],"consequenceScore":0,"consequenceRationale":"","verdict":"GO|PASS|REVISIT","verdictRationale":"","buildAngles":[{"title":"","scale":"Solo|Small Team|Enterprise","monetization":"SaaS|API Tool|Marketplace|Open Source + Services","description":"","techStack":[],"timeToMVP":"","difficulty":"Beginner|Intermediate|Advanced"}],"risks":[],"nextStep":""}`;
  return callClaude([{ role: "user", content: prompt }], false, anthropicKey);
}

async function deepAnalysis(repoData, previews, anthropicKey) {
  const cats = repoData.allFiles.reduce((a, f) => { a[f.category] = (a[f.category]||0)+1; return a; }, {});
  const previewText = previews.map(f => `--- ${f.path} ---\n${f.preview}`).join("\n\n").slice(0, 6000);
  const prompt = `You are a senior product strategist, market analyst, and software architect. Use web search to find current market trends, then analyze this repository for product viability.

Repo: ${repoData.name} | Stars: ${repoData.stars} | Forks: ${repoData.forks}
Description: ${repoData.description}
Languages: ${Object.keys(repoData.languages).join(", ")}
Topics: ${repoData.topics.join(", ") || "none"}
File categories: ${JSON.stringify(cats)}
Files: ${repoData.allFiles.slice(0, 60).map(f => f.path).join(", ")}
File previews:\n${previewText}

Return ONLY this JSON (no markdown):
{"repoSummary":"","domainSignals":[],"trendSignals":[],"marketContext":"","consequenceScore":0,"consequenceRationale":"","verdict":"GO|PASS|REVISIT","verdictRationale":"","buildAngles":[{"title":"","scale":"Solo|Small Team|Enterprise","monetization":"SaaS|API Tool|Marketplace|Open Source + Services","description":"","techStack":[],"timeToMVP":"","difficulty":"Beginner|Intermediate|Advanced","marketEvidence":""}],"competitors":[{"name":"","url":"","gap":""}],"risks":[],"nextStep":""}`;
  return callClaude([{ role: "user", content: prompt }], true, anthropicKey);
}

const C = {
  bg: "#0d1117", panel: "#161b22", border: "#30363d", borderLight: "#21262d",
  text: "#e6edf3", muted: "#8b949e", accent: "#58a6ff", accentDim: "#1f6feb",
  green: "#3fb950", greenBg: "#0d4429", red: "#f85149", redBg: "#3d0f0a",
  yellow: "#d29922", yellowBg: "#2d1e00", purple: "#bc8cff", purpleBg: "#1e0d45",
};
const mono = "ui-monospace, 'Cascadia Code', 'Fira Code', monospace";

function ScoreRing({ score }) {
  const color = score >= 70 ? C.green : score >= 45 ? C.yellow : C.red;
  const circ = 2 * Math.PI * 36;
  return (
    <div style={{ textAlign:"center", minWidth:90 }}>
      <svg width="90" height="90" viewBox="0 0 90 90">
        <circle cx="45" cy="45" r="36" fill="none" stroke={C.borderLight} strokeWidth="7"/>
        <circle cx="45" cy="45" r="36" fill="none" stroke={color} strokeWidth="7"
          strokeDasharray={`${(score/100)*circ} ${circ}`} strokeLinecap="round"
          transform="rotate(-90 45 45)"/>
        <text x="45" y="50" textAnchor="middle" fontSize="20" fontWeight="700" fill={color} fontFamily={mono}>{score}</text>
      </svg>
      <div style={{ fontSize:"0.72rem", color:C.muted, fontFamily:mono, letterSpacing:"0.05em", textTransform:"uppercase" }}>
        {score >= 70 ? "HIGH" : score >= 45 ? "MEDIUM" : "LOW"}
      </div>
    </div>
  );
}

function VerdictBadge({ verdict }) {
  const map = { GO:[C.green,C.greenBg], PASS:[C.red,C.redBg], REVISIT:[C.yellow,C.yellowBg] };
  const [col, bg] = map[verdict] || [C.muted, C.panel];
  return (
    <span style={{ fontFamily:mono, fontSize:"0.78rem", fontWeight:700, letterSpacing:"0.12em", padding:"0.3rem 0.8rem", borderRadius:4, background:bg, color:col, border:`1px solid ${col}`, textTransform:"uppercase" }}>
      {verdict}
    </span>
  );
}

function Tag({ label, color = C.accent, bg = C.accentDim }) {
  return <span style={{ fontFamily:mono, fontSize:"0.7rem", padding:"0.15rem 0.5rem", borderRadius:3, background:bg+"33", color, border:`1px solid ${bg}`, whiteSpace:"nowrap" }}>{label}</span>;
}

function BuildAngleCard({ angle }) {
  const diff = { Beginner:[C.green,"#0d4429"], Intermediate:[C.yellow,"#2d1e00"], Advanced:[C.red,"#3d0f0a"] };
  const [dc, db] = diff[angle.difficulty] || [C.muted, C.panel];
  return (
    <div style={{ border:`1px solid ${C.border}`, borderRadius:6, padding:"1rem", background:C.panel, marginBottom:"0.6rem" }}>
      <div style={{ display:"flex", justifyContent:"space-between", flexWrap:"wrap", gap:"0.4rem", marginBottom:"0.6rem", alignItems:"flex-start" }}>
        <span style={{ fontFamily:mono, fontWeight:700, color:C.text, fontSize:"0.92rem" }}>{angle.title}</span>
        <div style={{ display:"flex", gap:"0.3rem", flexWrap:"wrap" }}>
          <Tag label={angle.scale} color={C.purple} bg={C.purpleBg} />
          <Tag label={angle.monetization} color={C.accent} bg={C.accentDim} />
          <Tag label={angle.difficulty} color={dc} bg={db} />
        </div>
      </div>
      <p style={{ margin:"0 0 0.6rem", color:C.muted, fontSize:"0.85rem", lineHeight:1.6 }}>{angle.description}</p>
      {angle.marketEvidence && (
        <p style={{ margin:"0 0 0.6rem", color:C.accent, fontSize:"0.8rem", fontStyle:"italic", borderLeft:`2px solid ${C.accentDim}`, paddingLeft:"0.6rem" }}>{angle.marketEvidence}</p>
      )}
      <div style={{ display:"flex", flexWrap:"wrap", gap:"0.3rem", marginBottom:"0.5rem" }}>
        {angle.techStack.map((t,i) => <Tag key={i} label={t} color={C.muted} bg={C.borderLight} />)}
      </div>
      <div style={{ fontFamily:mono, fontSize:"0.75rem", color:C.muted }}>MVP_ETA: {angle.timeToMVP}</div>
    </div>
  );
}

function Panel({ title, children, accent = C.border }) {
  return (
    <div style={{ border:`1px solid ${C.border}`, borderTop:`2px solid ${accent}`, borderRadius:6, padding:"1rem", background:C.panel, marginBottom:"1rem" }}>
      <div style={{ fontFamily:mono, fontSize:"0.7rem", letterSpacing:"0.1em", textTransform:"uppercase", color:C.muted, marginBottom:"0.6rem" }}>{title}</div>
      {children}
    </div>
  );
}

function Loader({ msg }) {
  return (
    <div style={{ border:`1px solid ${C.border}`, borderRadius:6, padding:"2rem", background:C.panel, textAlign:"center" }}>
      <div style={{ fontFamily:mono, color:C.accent, fontSize:"0.85rem", marginBottom:"0.4rem" }}>[ PROCESSING ]</div>
      <div style={{ fontFamily:mono, color:C.muted, fontSize:"0.8rem" }}>{msg}</div>
    </div>
  );
}

function ErrBox({ msg }) {
  return <div style={{ border:`1px solid ${C.red}`, borderRadius:6, padding:"0.8rem 1rem", background:C.redBg, color:C.red, fontFamily:mono, fontSize:"0.83rem" }}>ERROR: {msg}</div>;
}

function KeyInput({ label, placeholder, value, onChange, show, onToggle, accentColor = C.border }) {
  return (
    <div style={{ border:`1px solid ${accentColor}`, borderRadius:4, padding:"0.7rem 1rem", marginBottom:"1rem", background:C.panel }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:"0.4rem" }}>
        <span style={{ fontFamily:mono, fontSize:"0.72rem", letterSpacing:"0.08em", color:C.muted }}>{label}</span>
        <button onClick={onToggle} style={{ background:"none", border:"none", cursor:"pointer", color:C.muted, fontFamily:mono, fontSize:"0.72rem" }}>{show?"HIDE":"SHOW"}</button>
      </div>
      <input type={show?"text":"password"} value={value} onChange={e=>onChange(e.target.value)} placeholder={placeholder}
        style={{ width:"100%", padding:"0.4rem 0.7rem", borderRadius:4, border:`1px solid ${C.border}`, background:C.bg, color:C.text, fontSize:"0.85rem", fontFamily:mono, boxSizing:"border-box", outline:"none" }} />
    </div>
  );
}

function AnalyzerTab({ token, anthropicKey }) {
  const [url, setUrl] = useState("");
  const [mode, setMode] = useState("quick");
  const [status, setStatus] = useState("idle");
  const [statusMsg, setStatusMsg] = useState("");
  const [error, setError] = useState("");
  const [repoInfo, setRepoInfo] = useState(null);
  const [result, setResult] = useState(null);

  async function handleAnalyze() {
    if (!url.trim()) return;
    if (!anthropicKey.trim()) { setError("ANTHROPIC_API_KEY is required. Add it above."); setStatus("error"); return; }
    setStatus("loading"); setError(""); setResult(null); setRepoInfo(null);
    try {
      const { owner, repo } = parseGithubUrl(url.trim());
      setStatusMsg("Fetching repo tree...");
      const repoData = await fetchRepoData(owner, repo, token);
      setRepoInfo(repoData);
      const toFetch = Object.values(repoData.sampled).flat().filter(f => ["code","data","docs","config","notebook"].includes(f.category));
      setStatusMsg(`Reading ${toFetch.length} files...`);
      const previews = await fetchFileContents(toFetch, owner, repo, token);
      setStatusMsg(mode === "deep" ? "Deep agent running — searching trends + reasoning..." : "Agent reasoning about viability...");
      const res = mode === "deep" ? await deepAnalysis(repoData, previews, anthropicKey) : await quickAnalysis(repoData, previews, anthropicKey);
      setResult(res); setStatus("done");
    } catch (e) { setError(e.message || "Unknown error."); setStatus("error"); }
  }

  const catCounts = repoInfo
    ? Object.entries(repoInfo.allFiles.reduce((a,f) => { a[f.category]=(a[f.category]||0)+1; return a; }, {}))
    : [];

  return (
    <div>
      <div style={{ display:"flex", gap:"0.5rem", marginBottom:"1rem" }}>
        {[["quick","QUICK","~30s — no web search"],["deep","DEEP","3-5min — live trend search"]].map(([id,label,sub]) => (
          <button key={id} onClick={() => setMode(id)}
            style={{ flex:1, padding:"0.7rem", borderRadius:4, border:`1px solid ${mode===id ? C.accent : C.border}`, background:mode===id ? C.accentDim+"22" : C.panel, cursor:"pointer", textAlign:"left" }}>
            <div style={{ fontFamily:mono, fontWeight:700, color:mode===id ? C.accent : C.muted, fontSize:"0.78rem", letterSpacing:"0.08em" }}>{label}</div>
            <div style={{ fontFamily:mono, fontSize:"0.7rem", color:C.muted, marginTop:"0.2rem" }}>{sub}</div>
          </button>
        ))}
      </div>
      <div style={{ display:"flex", gap:"0.5rem", marginBottom:"1rem", flexWrap:"wrap" }}>
        <input value={url} onChange={e => setUrl(e.target.value)} onKeyDown={e => e.key==="Enter" && handleAnalyze()}
          placeholder="https://github.com/owner/repo"
          style={{ flex:1, minWidth:0, padding:"0.6rem 0.9rem", borderRadius:4, border:`1px solid ${C.border}`, background:C.bg, color:C.text, fontSize:"0.88rem", fontFamily:mono, outline:"none" }} />
        <button onClick={handleAnalyze} disabled={status==="loading"}
          style={{ padding:"0.6rem 1.4rem", borderRadius:4, background:status==="loading" ? C.border : C.accentDim, color:C.text, border:`1px solid ${C.accent}`, cursor:status==="loading"?"not-allowed":"pointer", fontFamily:mono, fontWeight:700, fontSize:"0.82rem", letterSpacing:"0.06em" }}>
          {status==="loading" ? "RUNNING..." : "RUN AGENT"}
        </button>
      </div>
      {status==="loading" && <Loader msg={statusMsg} />}
      {status==="error" && <ErrBox msg={error} />}
      {repoInfo && (
        <div style={{ border:`1px solid ${C.border}`, borderRadius:6, padding:"0.8rem 1rem", marginBottom:"1rem", background:C.panel, fontFamily:mono, fontSize:"0.8rem" }}>
          <div style={{ color:C.text, fontWeight:700, marginBottom:"0.3rem" }}>{repoInfo.name}</div>
          <div style={{ color:C.muted, marginBottom:"0.5rem" }}>{repoInfo.description}</div>
          <div style={{ display:"flex", gap:"1.2rem", color:C.muted, fontSize:"0.75rem", marginBottom:"0.5rem" }}>
            <span>STARS: {repoInfo.stars}</span><span>FORKS: {repoInfo.forks}</span>
            <span>LANGS: {Object.keys(repoInfo.languages).join(", ")}</span>
          </div>
          <div style={{ display:"flex", flexWrap:"wrap", gap:"0.3rem" }}>
            {catCounts.map(([cat,count]) => <Tag key={cat} label={`${cat.toUpperCase()}: ${count}`} color={C.muted} bg={C.borderLight} />)}
          </div>
        </div>
      )}
      {result && (
        <div>
          <div style={{ border:`1px solid ${C.border}`, borderTop:`2px solid ${C.accent}`, borderRadius:6, padding:"1rem", background:C.panel, marginBottom:"1rem", display:"flex", gap:"1.2rem", alignItems:"flex-start", flexWrap:"wrap" }}>
            <ScoreRing score={result.consequenceScore} />
            <div style={{ flex:1, minWidth:180 }}>
              <div style={{ marginBottom:"0.5rem" }}><VerdictBadge verdict={result.verdict} /></div>
              <p style={{ margin:"0.5rem 0 0.7rem", color:C.muted, fontSize:"0.85rem", lineHeight:1.6 }}>{result.verdictRationale}</p>
              {result.nextStep && <div style={{ fontFamily:mono, fontSize:"0.78rem", color:C.accent, borderLeft:`2px solid ${C.accentDim}`, paddingLeft:"0.7rem" }}>NEXT_ACTION: {result.nextStep}</div>}
            </div>
          </div>
          <Panel title="Repo Analysis" accent={C.accentDim}>
            <p style={{ margin:"0 0 0.7rem", color:C.muted, fontSize:"0.85rem", lineHeight:1.6 }}>{result.repoSummary}</p>
            <div style={{ display:"flex", flexWrap:"wrap", gap:"0.3rem" }}>
              {result.domainSignals?.map((s,i) => <Tag key={i} label={s} color={C.accent} bg={C.accentDim} />)}
            </div>
          </Panel>
          {result.marketContext && (
            <Panel title="Market Intelligence" accent={C.green}>
              <p style={{ margin:"0 0 0.7rem", color:C.muted, fontSize:"0.85rem", lineHeight:1.6 }}>{result.marketContext}</p>
              <div style={{ display:"flex", flexWrap:"wrap", gap:"0.3rem" }}>
                {result.trendSignals?.map((t,i) => <Tag key={i} label={t} color={C.green} bg={C.greenBg} />)}
              </div>
            </Panel>
          )}
          <Panel title="Consequence Reasoning" accent={C.yellow}>
            <p style={{ margin:0, color:C.muted, fontSize:"0.85rem", lineHeight:1.6 }}>{result.consequenceRationale}</p>
          </Panel>
          {result.buildAngles?.length > 0 && (
            <Panel title={`Build Angles [${result.buildAngles.length}]`} accent={C.purple}>
              {result.buildAngles.map((a,i) => <BuildAngleCard key={i} angle={a} />)}
            </Panel>
          )}
          {result.competitors?.length > 0 && (
            <Panel title="Competitor Map" accent={C.red}>
              {result.competitors.map((c,i) => (
                <div key={i} style={{ borderBottom:`1px solid ${C.borderLight}`, paddingBottom:"0.6rem", marginBottom:"0.6rem" }}>
                  <div style={{ fontFamily:mono, fontSize:"0.82rem", color:C.text, fontWeight:700 }}>{c.name}
                    {c.url && <a href={c.url} target="_blank" rel="noreferrer" style={{ color:C.accent, marginLeft:"0.8rem", fontSize:"0.75rem" }}>{c.url}</a>}
                  </div>
                  <div style={{ fontFamily:mono, fontSize:"0.78rem", color:C.muted, marginTop:"0.3rem" }}>GAP: {c.gap}</div>
                </div>
              ))}
            </Panel>
          )}
          {result.risks?.length > 0 && (
            <Panel title="Risk Factors" accent={C.red}>
              {result.risks.map((r,i) => (
                <div key={i} style={{ fontFamily:mono, fontSize:"0.8rem", color:C.muted, marginBottom:"0.4rem", borderLeft:`2px solid ${C.red}`, paddingLeft:"0.6rem" }}>{r}</div>
              ))}
            </Panel>
          )}
        </div>
      )}
    </div>
  );
}

function DocTab({ anthropicKey }) {
  const [mode, setMode] = useState("upload");
  const [docUrl, setDocUrl] = useState("");
  const [fileName, setFileName] = useState("");
  const [fileData, setFileData] = useState(null);
  const [fileType, setFileType] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const [status, setStatus] = useState("idle");
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);
  const inputRef = useRef();

  function handleFile(file) {
    if (!file) return;
    const allowed = ["application/pdf","image/png","image/jpeg","image/webp","image/gif"];
    if (!allowed.includes(file.type)) { setError("Unsupported file type."); return; }
    setError(""); setFileName(file.name); setFileType(file.type);
    const reader = new FileReader();
    reader.onload = () => setFileData(reader.result.split(",")[1]);
    reader.readAsDataURL(file);
  }

  async function handleAnalyze() {
    if (!anthropicKey.trim()) { setError("ANTHROPIC_API_KEY is required. Add it in the keys section above."); setStatus("error"); return; }
    setStatus("loading"); setError(""); setResult(null);
    try {
      const docSource = mode === "url"
        ? { type: "url", url: docUrl.trim() }
        : { type: "base64", media_type: fileType, data: fileData };
      if (mode === "url" && !docUrl.trim()) throw new Error("No URL provided.");
      if (mode === "upload" && !fileData) throw new Error("No file uploaded.");
      const isImg = mode === "url" ? /\.(png|jpg|jpeg|webp|gif)$/i.test(docUrl) : fileType.startsWith("image/");
      const contentBlock = isImg ? { type:"image", source:docSource } : { type:"document", source:docSource };
      const prompt = `Analyze this document. Return ONLY this JSON (no markdown):
{"summary":"3-5 sentence summary.","keyTopics":["t1","t2"],"ideas":[{"title":"","description":"","type":"","techStack":[],"difficulty":"Beginner|Intermediate|Advanced"}]}`;
      const headers = { "Content-Type": "application/json" };
      if (anthropicKey) headers["x-api-key"] = anthropicKey;
      const res = await fetch("/api/claude", {
        method:"POST", headers,
        body:JSON.stringify({ model:"claude-sonnet-4-20250514", max_tokens:1000, messages:[{role:"user",content:[contentBlock,{type:"text",text:prompt}]}] }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error.message || "Anthropic API error");
      const text = data.content.map(b=>b.text||"").join("");
      setResult(JSON.parse(text.replace(/```json|```/g,"").trim()));
      setStatus("done");
    } catch(e) { setError(e.message||"Unknown error."); setStatus("error"); }
  }

  return (
    <div>
      <div style={{ display:"flex", gap:"0.5rem", marginBottom:"1rem" }}>
        {["upload","url"].map(m => (
          <button key={m} onClick={() => setMode(m)}
            style={{ padding:"0.4rem 1rem", borderRadius:4, border:`1px solid ${mode===m?C.accent:C.border}`, background:mode===m?C.accentDim+"22":C.panel, color:mode===m?C.accent:C.muted, fontFamily:mono, fontSize:"0.78rem", fontWeight:700, cursor:"pointer", letterSpacing:"0.06em" }}>
            {m.toUpperCase()}
          </button>
        ))}
      </div>
      {mode==="upload" && (
        <div onDragOver={e=>{e.preventDefault();setIsDragging(true);}} onDragLeave={()=>setIsDragging(false)}
          onDrop={e=>{e.preventDefault();setIsDragging(false);handleFile(e.dataTransfer.files[0]);}} onClick={()=>inputRef.current.click()}
          style={{ border:`1px dashed ${isDragging?C.accent:C.border}`, borderRadius:6, padding:"2rem", textAlign:"center", background:isDragging?C.accentDim+"11":C.panel, cursor:"pointer", marginBottom:"0.8rem" }}>
          <input ref={inputRef} type="file" accept=".pdf,image/*" style={{ display:"none" }} onChange={e=>handleFile(e.target.files[0])} />
          <div style={{ fontFamily:mono, color:isDragging?C.accent:C.muted, fontSize:"0.82rem", marginBottom:"0.4rem" }}>
            {fileName ? `LOADED: ${fileName}` : "DROP FILE OR CLICK TO BROWSE"}
          </div>
          <div style={{ fontFamily:mono, fontSize:"0.72rem", color:C.muted }}>PDF / PNG / JPG / WEBP / GIF</div>
        </div>
      )}
      {mode==="url" && (
        <input value={docUrl} onChange={e=>setDocUrl(e.target.value)} placeholder="https://example.com/document.pdf"
          style={{ width:"100%", padding:"0.6rem 0.9rem", borderRadius:4, border:`1px solid ${C.border}`, background:C.bg, color:C.text, fontSize:"0.88rem", fontFamily:mono, marginBottom:"0.8rem", boxSizing:"border-box", outline:"none" }} />
      )}
      <button onClick={handleAnalyze} disabled={status==="loading"}
        style={{ padding:"0.6rem 1.4rem", borderRadius:4, background:status==="loading"?C.border:C.accentDim, color:C.text, border:`1px solid ${C.accent}`, cursor:status==="loading"?"not-allowed":"pointer", fontFamily:mono, fontWeight:700, fontSize:"0.82rem", letterSpacing:"0.06em" }}>
        {status==="loading" ? "RUNNING..." : "ANALYZE"}
      </button>
      <div style={{ marginTop:"1rem" }}>
        {status==="loading" && <Loader msg="Reading document..." />}
        {status==="error" && <ErrBox msg={error} />}
        {result && (
          <div>
            <Panel title="Document Summary" accent={C.accentDim}>
              <p style={{ margin:"0 0 0.7rem", color:C.muted, fontSize:"0.85rem", lineHeight:1.6 }}>{result.summary}</p>
              <div style={{ display:"flex", flexWrap:"wrap", gap:"0.3rem" }}>
                {result.keyTopics?.map((t,i) => <Tag key={i} label={t} color={C.accent} bg={C.accentDim} />)}
              </div>
            </Panel>
            <Panel title={`Build Ideas [${result.ideas?.length}]`} accent={C.purple}>
              {result.ideas?.map((idea,i) => (
                <div key={i} style={{ borderBottom:`1px solid ${C.borderLight}`, paddingBottom:"0.7rem", marginBottom:"0.7rem" }}>
                  <div style={{ fontFamily:mono, fontWeight:700, color:C.text, fontSize:"0.85rem", marginBottom:"0.3rem" }}>{idea.title}</div>
                  <p style={{ margin:"0 0 0.5rem", color:C.muted, fontSize:"0.82rem", lineHeight:1.5 }}>{idea.description}</p>
                  <div style={{ display:"flex", flexWrap:"wrap", gap:"0.3rem" }}>
                    {idea.techStack?.map((t,j) => <Tag key={j} label={t} color={C.muted} bg={C.borderLight} />)}
                  </div>
                </div>
              ))}
            </Panel>
          </div>
        )}
      </div>
    </div>
  );
}

export default function App() {
  const [tab, setTab] = useState("analyzer");
  const [token, setToken] = useState("");
  const [showToken, setShowToken] = useState(false);
  const [anthropicKey, setAnthropicKey] = useState("");
  const [showAnthropicKey, setShowAnthropicKey] = useState(false);

  return (
    <div style={{ fontFamily:"system-ui, sans-serif", maxWidth:820, margin:"0 auto", padding:"1.5rem 1rem", background:C.bg, minHeight:"100vh", color:C.text }}>
      <div style={{ borderBottom:`1px solid ${C.border}`, paddingBottom:"1rem", marginBottom:"1.2rem" }}>
        <div style={{ fontFamily:mono, fontSize:"0.7rem", color:C.muted, letterSpacing:"0.12em", marginBottom:"0.2rem" }}>FORGESIGNAL // v1.0</div>
        <h1 style={{ margin:0, fontSize:"1.4rem", fontWeight:800, color:C.text, letterSpacing:"-0.02em" }}>FORGESIGNAL</h1>
        <p style={{ margin:"0.3rem 0 0", color:C.muted, fontSize:"0.82rem", fontFamily:mono }}>Extracts the signal. Renders the verdict. Determines whether a repository has the raw material to produce a product of consequence.</p>
      </div>

      <KeyInput
        label="ANTHROPIC_API_KEY (required)"
        placeholder="sk-ant-xxxxxxxxxxxxxxxxxxxx"
        value={anthropicKey}
        onChange={setAnthropicKey}
        show={showAnthropicKey}
        onToggle={() => setShowAnthropicKey(s => !s)}
        accentColor={C.accent}
      />
      <div style={{ fontFamily:mono, fontSize:"0.7rem", color:C.muted, marginTop:"-0.7rem", marginBottom:"1rem" }}>
        Stored in browser memory only. Get your key at console.anthropic.com
      </div>

      <KeyInput
        label="GITHUB_TOKEN (recommended)"
        placeholder="ghp_xxxxxxxxxxxxxxxxxxxx"
        value={token}
        onChange={setToken}
        show={showToken}
        onToggle={() => setShowToken(s => !s)}
        accentColor={C.border}
      />
      <div style={{ fontFamily:mono, fontSize:"0.7rem", color:C.muted, marginTop:"-0.7rem", marginBottom:"1.2rem" }}>
        Stored in browser memory only. Enables 5,000 req/hr vs 60 unauthenticated.
      </div>

      <div style={{ display:"flex", gap:"0.3rem", marginBottom:"1.2rem", borderBottom:`1px solid ${C.border}` }}>
        {[["analyzer","VIABILITY AGENT"],["doc","DOCUMENT"]].map(([id,label]) => (
          <button key={id} onClick={()=>setTab(id)}
            style={{ padding:"0.5rem 1rem", border:"none", borderBottom:`2px solid ${tab===id?C.accent:"transparent"}`, background:"transparent", color:tab===id?C.accent:C.muted, fontFamily:mono, fontWeight:700, cursor:"pointer", fontSize:"0.78rem", letterSpacing:"0.08em", marginBottom:"-1px" }}>
            {label}
          </button>
        ))}
      </div>

      {tab==="analyzer" && <AnalyzerTab token={token} anthropicKey={anthropicKey} />}
      {tab==="doc" && <DocTab anthropicKey={anthropicKey} />}
    </div>
  );
}