/* ---------------------------------------------------------
   CONFIG — set this after you deploy the Cloudflare Worker
--------------------------------------------------------- */
const CONFIG = {
  WORKER_URL: "https://legalens-proxy.karmakarasmita147.workers.dev",
};

/* ---------------------------------------------------------
   STATE
--------------------------------------------------------- */
const state = {
  fileName: "",
  pages: [],      // [{ page: 1, text: "..." }]
  fullText: "",
  clauses: [],    // [{ id, heading, page, text }]
  docType: null,  // key into BASELINES
  docTypeLabel: "",
  concerns: [],   // suggested concern chips from Gemini
  selectedConcerns: new Set(),
  findings: [],   // rendered finding cards
  missing: [],    // items flagged as not present
  clarifyItems: [], // questions collected for the clarify pack
  docB: {
    fileName: "",
    fullText: "",
    clauses: []
  }
};

let BASELINES = {};

/* ---------------------------------------------------------
   BOOT
--------------------------------------------------------- */
window.addEventListener("DOMContentLoaded", async () => {
  pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
  BASELINES = await fetch("checklists/baselines.json").then((r) => r.json());
  wireUpload();
  wireAsk();
  wireClarifyExport();
  wireCompare();
  wireLanguageToggle();
});

function showScreen(id) {
  document.querySelectorAll(".screen").forEach((s) => s.classList.remove("active"));
  document.getElementById(id).classList.add("active");
}

/* ---------------------------------------------------------
   GEMINI CALL (via Cloudflare Worker proxy)
--------------------------------------------------------- */
async function callGemini({ systemPrompt, userPrompt, jsonSchema }, retries = 5) {
  for (let i = 0; i < retries; i++) {
    const res = await fetch(CONFIG.WORKER_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ systemPrompt, userPrompt, jsonSchema }),
    });
    if (!res.ok) {
      if (res.status === 429) {
        throw new Error("Gemini rate limited (429). Quota exceeded.");
      }
      if (res.status === 503 || res.status === 400) {
        console.warn(`Gemini failed (${res.status}), retrying in 2s...`);
        await new Promise((r) => setTimeout(r, 2000));
        continue;
      }
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `Worker request failed (${res.status})`);
    }
    const data = await res.json();
    try {
      return JSON.parse(data.text);
    } catch (e) {
      throw new Error("Model did not return valid JSON: " + data.text.slice(0, 200));
    }
  }
  throw new Error("Gemini API rate limit exceeded. Please try again later.");
}

/* ---------------------------------------------------------
   1. UPLOAD + PDF PARSING (pdf.js, fully client-side)
--------------------------------------------------------- */
function wireUpload() {
  const dz = document.getElementById("dropzone");
  const input = document.getElementById("fileInput");

  dz.addEventListener("click", () => input.click());
  dz.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      input.click();
    }
  });
  dz.addEventListener("dragover", (e) => { e.preventDefault(); dz.classList.add("drag-over"); });
  dz.addEventListener("dragleave", () => dz.classList.remove("drag-over"));
  dz.addEventListener("drop", (e) => {
    e.preventDefault();
    dz.classList.remove("drag-over");
    if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
  });
  input.addEventListener("change", (e) => {
    if (e.target.files[0]) handleFile(e.target.files[0]);
  });
}

async function handleFile(file) {
  state.fileName = file.name;
  setStatus("uploadStatus", "Reading your document…");

  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;

  const pages = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    let text = "";
    let lastY = -1;
    for (const it of content.items) {
      if (lastY !== -1 && Math.abs(it.transform[5] - lastY) > 5) {
        text += "\n";
      } else if (text.length > 0 && !text.endsWith(" ") && !text.endsWith("\n")) {
        text += " ";
      }
      text += it.str;
      lastY = it.transform[5];
    }
    pages.push({ page: i, text });
  }
  state.pages = pages;
  state.fullText = pages.map((p) => p.text).join("\n\n");
  state.clauses = splitClauses(pages);

  setStatus("uploadStatus", "Detecting document type…");
  await detectDocType();
}

/* Heuristic clause splitter: looks for numbered section headings
   (1., 1.1, 8.2, Section 4, Clause 12, ARTICLE III, etc.) and slices
   the page text at those boundaries. Deterministic — no LLM involved,
   this is the ground-truth index every AI claim gets checked against. */
function splitClauses(pages) {
  const headingRe = /(?:^|\n)\s*((?:Section|Clause|Article)\s+(?:\d+|[IVXLCDM]+)[A-Za-z]?(?:\.\d+)*|\d+(?:\.\d+){0,2})[\.\)]?\s+([A-Z][^\n]{2,80})/g;
  const clauses = [];
  let idx = 0;

  pages.forEach(({ page, text }) => {
    let matches = [...text.matchAll(headingRe)];
    if (matches.length === 0) {
      idx += 1;
      clauses.push({ id: `c${idx}`, heading: `Page ${page} text`, page, text: text.slice(0, 2000) });
      return;
    }
    
    if (matches[0].index > 0) {
      const precedingText = text.slice(0, matches[0].index).trim();
      if (precedingText.length > 20) {
        idx += 1;
        clauses.push({
          id: `c${idx}`,
          heading: `Page ${page} continued`,
          page,
          text: precedingText.slice(0, 2500),
        });
      }
    }

    matches.forEach((m, i) => {
      const start = m.index;
      const end = i + 1 < matches.length ? matches[i + 1].index : text.length;
      idx += 1;
      clauses.push({
        id: `c${idx}`,
        heading: `${m[1]} ${m[2]}`.trim(),
        page,
        text: text.slice(start, end).trim().slice(0, 2500),
      });
    });
  });
  return clauses;
}

function clauseIndexText() {
  // Compact representation sent to the model: id, heading, page, text
  return state.clauses
    .map((c) => `[${c.id} | p.${c.page} | ${c.heading}]\n${c.text}`)
    .join("\n\n---\n\n")
    .slice(0, 45000); // keep prompt size sane on the free tier
}

/* ---------------------------------------------------------
   2. DOCUMENT TYPE DETECTION + INTAKE CHIPS
--------------------------------------------------------- */
async function detectDocType() {
  const schema = {
    type: "object",
    properties: {
      docType: { type: "string", enum: Object.keys(BASELINES) },
      docTypeLabel: { type: "string" },
      concerns: {
        type: "array",
        items: {
          type: "object",
          properties: { id: { type: "string" }, label: { type: "string" } },
          required: ["id", "label"],
        },
      },
    },
    required: ["docType", "docTypeLabel", "concerns"],
  };

  const systemPrompt = `You classify legal documents and suggest topics a reader
might want explained. Choose docType from exactly these keys: ${Object.keys(BASELINES).join(", ")}.
If nothing fits well, use "general_contract". Suggest 5-8 concise concern chips
(2-4 words each) drawn from headings that actually appear in the document —
do not invent generic ones.`;

  const userPrompt = `Here is the start of an uploaded document:\n\n${state.fullText.slice(0, 8000)}`;

  try {
    const result = await callGemini({ systemPrompt, userPrompt, jsonSchema: schema });
    state.docType = result.docType;
    state.docTypeLabel = result.docTypeLabel || BASELINES[result.docType]?.label || "Document";
    state.concerns = result.concerns || [];
    renderIntake();
    showScreen("intakeScreen");
  } catch (e) {
    setStatus("uploadStatus", "Couldn't reach the analysis service: " + e.message);
  }
}

function renderIntake() {
  document.getElementById("detectedType").textContent = state.docTypeLabel;
  const grid = document.getElementById("chipGrid");
  grid.innerHTML = "";
  state.concerns.forEach((c) => {
    const chip = document.createElement("div");
    chip.className = "chip";
    chip.textContent = c.label;
    chip.dataset.id = c.id;
    chip.tabIndex = 0;
    chip.setAttribute("role", "button");
    chip.setAttribute("aria-pressed", "false");
    
    const toggleChip = () => {
      chip.classList.toggle("selected");
      const isSelected = chip.classList.contains("selected");
      chip.setAttribute("aria-pressed", isSelected ? "true" : "false");
      if (isSelected) state.selectedConcerns.add(c.id);
      else state.selectedConcerns.delete(c.id);
      checkIntakeReady();
    };
    
    chip.addEventListener("click", toggleChip);
    chip.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        toggleChip();
      }
    });
    grid.appendChild(chip);
  });
}

/* ---------------------------------------------------------
   3. TARGETED ANALYSIS WITH CITATIONS + ABSTENTION
--------------------------------------------------------- */
async function runAnalysis() {
  showScreen("analysisScreen");
  document.getElementById("pdfPaneText").textContent = state.fullText.slice(0, 20000);
  setStatus("analysisStatus", "Reading the document for your selected topics…");

  const selectedLabels = state.concerns
    .filter((c) => state.selectedConcerns.has(c.id))
    .map((c) => c.label);
  const extraNote = document.getElementById("extraConcern").value.trim();

  const schema = {
    type: "object",
    properties: {
      findings: {
        type: "array",
        items: {
          type: "object",
          properties: {
            topic: { type: "string" },
            found: { type: "boolean" },
            explanation: { type: "string" },
            quote: { type: "string" },
            clauseId: { type: "string" },
            page: { type: "integer" },
            risk: { type: "string", enum: ["green", "yellow", "red", "neutral"] },
          },
          required: ["topic", "found", "explanation", "risk"],
        },
      },
    },
    required: ["findings"],
  };
  const systemPrompt = `You are analyzing ONE legal document on behalf of a
non-lawyer. You will be given the document split into indexed clauses
[id | page | heading]. For each requested topic:

- If the document addresses it: quote the EXACT relevant text VERBATIM
  (copy it character-for-character from the source, do not paraphrase the
  quote), give its clauseId and page, explain it in plain English (2-3
  sentences, no jargon), and rate risk:
  green = standard/favorable, yellow = worth attention, red = unusually
  unfavorable, neutral = informational only.
- If the document does NOT address it: set found=false, leave quote and
  clauseId empty, risk="neutral", and explanation should say plainly that
  this topic is not covered in the document and why that matters.

MANDATORY RULES:
1. Base every answer only on the supplied clauses. Never use outside
   knowledge to fill in a number, date, or term.
2. Never invent a quote. If you cannot find exact supporting text, set
   found=false instead of guessing.
3. If found=true, quote is REQUIRED and must never be empty.
4. One finding object per requested topic, in the same order given.`;

  const userPrompt = `DOCUMENT CLAUSES:\n${clauseIndexText()}\n\nTOPICS TO COVER:\n${selectedLabels
    .concat(extraNote ? [extraNote] : [])
    .map((t, i) => `${i + 1}. ${t}`)
    .join("\n")}`;

  try {
    const result = await callGemini({ systemPrompt, userPrompt, jsonSchema: schema });
    state.findings = (result.findings || []).map(verifyFinding);
    renderFindings();
    computeMissing();
    setStatus("analysisStatus", "");
  } catch (e) {
    setStatus("analysisStatus", "Analysis failed: " + e.message);
  }
}

/* Quote Verifier — this is the anti-hallucination check. Every quote the
   model returns is matched back against our own deterministic clause
   index before it's allowed to render as "verified". */
function normalize(s) {
  return (s || "").toLowerCase().replace(/\s+/g, " ").trim();
}

function verifyFinding(f) {
  if (!f.found || !f.quote) return { ...f, verified: false };
  const needle = normalize(f.quote);
  const clause = state.clauses.find((c) => c.id === f.clauseId) ||
    state.clauses.find((c) => normalize(c.text).includes(needle.slice(0, 40)));
  const haystack = clause ? normalize(clause.text) : normalize(state.fullText);
  const verified = needle.length > 0 && haystack.includes(needle.slice(0, Math.min(needle.length, 200)));
  return { ...f, verified, resolvedClause: clause };
}

function renderFindings() {
  const wrap = document.getElementById("findings");
  wrap.innerHTML = "";
  state.findings.forEach((f) => {
    const card = document.createElement("div");
    card.className = `finding-card risk-${f.risk || "neutral"}`;
    card.tabIndex = 0;
    card.setAttribute("aria-label", `Finding: ${f.topic}`);

    const riskLabel = { green: "Standard", yellow: "Attention", red: "Unfavorable", neutral: "Not found" }[f.risk] || "Info";

    card.innerHTML = `
      <div class="finding-topic">${f.topic}
        <span class="risk-tag risk-${f.risk || "neutral"}">${riskLabel}</span>
      </div>
      <div class="finding-explanation">${f.explanation}</div>
      ${f.found && f.quote ? `<blockquote class="finding-quote">"${escapeHtml(f.quote)}"</blockquote>` : ""}
      ${f.found && f.verified ? `<button class="finding-ref" data-clause="${f.clauseId}" aria-label="View clause ${f.clauseId} on page ${f.page}">View Clause → Page ${f.page}</button>` : ""}
      ${f.found && !f.verified ? `<div class="unverified-note">Could not verify this quote against the document — treat with caution and check clause ${f.clauseId || "manually"} yourself.</div>` : ""}
      ${!f.found ? `<button class="finding-ref add-clarify" data-topic="${escapeHtml(f.topic)}" aria-label="Add missing topic to Clarify Pack">+ Add to Clarify Pack</button>` : ""}
    `;
    wrap.appendChild(card);
  });

  wrap.querySelectorAll(".finding-ref[data-clause]").forEach((btn) => {
    btn.addEventListener("click", () => jumpToClause(btn.dataset.clause));
  });
  wrap.querySelectorAll(".add-clarify").forEach((btn) => {
    btn.addEventListener("click", () => {
      addClarifyItem(`Ask about: ${btn.dataset.topic} — not addressed in the document.`);
      btn.textContent = "Added ✓";
      btn.disabled = true;
    });
  });
}

function jumpToClause(clauseId) {
  const clause = state.clauses.find((c) => c.id === clauseId);
  if (!clause) return;
  const pane = document.getElementById("pdfPaneText");
  const full = state.pages.find((p) => p.page === clause.page)?.text || state.fullText;
  const idx = full.indexOf(clause.text.slice(0, 60));
  pane.innerHTML = escapeHtml(full).replace(
    escapeHtml(clause.text.slice(0, 200)),
    `<mark>${escapeHtml(clause.text.slice(0, 200))}</mark>`
  );
  document.getElementById("pageLabel").textContent = `Page ${clause.page}`;
  pane.scrollIntoView({ behavior: "smooth", block: "start" });
}

function escapeHtml(s) {
  return (s || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/* ---------------------------------------------------------
   4. MISSING-CLAUSE CHECKLIST (baseline diff, deterministic)
--------------------------------------------------------- */
function computeMissing() {
  const baseline = BASELINES[state.docType]?.expected || [];
  const coveredTopics = new Set(state.findings.filter((f) => f.found).map((f) => f.topic.toLowerCase()));
  state.missing = baseline.filter((b) => {
    const label = b.label.toLowerCase();
    const alreadyCovered = [...coveredTopics].some((t) => t.includes(label.split(" ")[0]) || label.includes(t));
    const explicitlyAbsent = state.findings.some((f) => !f.found && f.topic.toLowerCase().includes(label.split(" ")[0]));
    return !alreadyCovered || explicitlyAbsent;
  });
  renderMissing();
}

function renderMissing() {
  const section = document.getElementById("missingSection");
  const list = document.getElementById("missingList");
  list.innerHTML = "";
  if (state.missing.length === 0) {
    section.style.display = "none";
    return;
  }
  section.style.display = "block";
  state.missing.forEach((m) => {
    const row = document.createElement("div");
    row.className = "missing-card";
    row.innerHTML = `
      <div>
        <div class="m-label">${m.label}</div>
        <div class="m-why">${m.why}</div>
      </div>
      <button class="secondary add-missing" data-label="${escapeHtml(m.label)}">Add to Clarify Pack</button>
    `;
    list.appendChild(row);
  });
  list.querySelectorAll(".add-missing").forEach((btn) => {
    btn.addEventListener("click", () => {
      addClarifyItem(`Ask about: ${btn.dataset.label} — this standard clause was not found in your document.`);
      btn.textContent = "Added ✓";
      btn.disabled = true;
    });
  });
}

/* ---------------------------------------------------------
   5. GROUNDED ASK BOX (free-text questions, strict abstention)
--------------------------------------------------------- */
function wireAsk() {
  document.getElementById("askBtn").addEventListener("click", askQuestion);
  document.getElementById("askInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter") askQuestion();
  });
}

async function askQuestion() {
  const input = document.getElementById("askInput");
  const q = input.value.trim();
  if (!q) return;
  input.value = "";

  const answersWrap = document.getElementById("askAnswers");
  const pending = document.createElement("div");
  pending.className = "finding-card risk-neutral";
  pending.innerHTML = `<div class="finding-topic">${escapeHtml(q)}</div><div class="finding-explanation loading-dot">Checking the document</div>`;
  answersWrap.prepend(pending);

  const schema = {
    type: "object",
    properties: {
      found: { type: "boolean" },
      answer: { type: "string" },
      quote: { type: "string" },
      clauseId: { type: "string" },
      page: { type: "integer" },
    },
    required: ["found", "answer"],
  };

  const systemPrompt = `Answer the user's question using ONLY the supplied
document clauses. 
- If the topic is genuinely absent from the document, set found=false and say plainly: "This is not addressed in the document you provided," then briefly note what the user should ask about instead.
- If the topic IS covered but the user's question assumes a wrong value or false premise, set found=true, state the actual value, and explicitly correct the user's assumption.
- If found=true (whether a normal answer or a correction), the "quote" field is REQUIRED, must never be empty, and must be copied verbatim from the clauses.
Never use outside knowledge to answer factual questions about the document's terms.`;

  const userPrompt = `DOCUMENT CLAUSES:\n${clauseIndexText()}\n\nQUESTION: ${q}`;

  try {
    const result = await callGemini({ systemPrompt, userPrompt, jsonSchema: schema });
    const verified = result.found ? verifyFinding({ found: true, quote: result.quote, clauseId: result.clauseId }) : { verified: false };
    pending.className = `finding-card risk-${result.found ? "green" : "neutral"}`;
    pending.tabIndex = 0;
    pending.setAttribute("aria-label", `Answer to: ${q}`);
    pending.innerHTML = `
      <div class="finding-topic">${escapeHtml(q)}</div>
      <div class="finding-explanation">${escapeHtml(result.answer)}</div>
      ${result.found && result.quote ? `
      <div style="margin-top:10px;">
        <strong>Document Quote:</strong><br/>
        <blockquote class="finding-quote">"${escapeHtml(result.quote)}"</blockquote>
        ${verified.verified ? `<span style="font-size:12px;color:green;">✓ Verified (${verified.resolvedClause ? verified.resolvedClause.id : result.clauseId})</span>` : `<div class="unverified-note">Could not verify this quote...</div>`}
      </div>` : ""}
      ${result.found && verified.verified ? `<button class="finding-ref" data-clause="${result.clauseId}" aria-label="View clause ${result.clauseId} on page ${result.page}">View Clause → Page ${result.page}</button>` : ""}
      ${result.found && !verified.verified ? `<div class="unverified-note">Could not verify this quote — check manually.</div>` : ""}
      ${!result.found ? `<button class="finding-ref add-clarify-q" data-q="${escapeHtml(q)}" aria-label="Add question to Clarify Pack">+ Add to Clarify Pack</button>` : ""}
    `;
    pending.querySelectorAll(".finding-ref[data-clause]").forEach((btn) =>
      btn.addEventListener("click", () => jumpToClause(btn.dataset.clause))
    );
    pending.querySelectorAll(".add-clarify-q").forEach((btn) =>
      btn.addEventListener("click", () => {
        addClarifyItem(`Ask about: "${btn.dataset.q}" — not answered by the document.`);
        btn.textContent = "Added ✓";
        btn.disabled = true;
      })
    );
  } catch (e) {
    pending.innerHTML = `<div class="finding-explanation">Couldn't get an answer: ${e.message}</div>`;
  }
}

/* ---------------------------------------------------------
   6. CLARIFY PACK
--------------------------------------------------------- */
function addClarifyItem(text) {
  if (!state.clarifyItems.includes(text)) state.clarifyItems.push(text);
  document.getElementById("clarifyCount").textContent = state.clarifyItems.length;
}

function wireClarifyExport() {
  document.getElementById("exportPackBtn").addEventListener("click", () => {
    const w = window.open("", "_blank");
    const rows = state.clarifyItems.map((i) => `<div class="pack-item">${escapeHtml(i)}</div>`).join("") ||
      "<p>No open items — nothing flagged for follow-up.</p>";
    w.document.write(`
      <html><head><title>Clarify Pack — ${escapeHtml(state.fileName)}</title>
      <style>body{font-family:Georgia,serif;max-width:640px;margin:40px auto;padding:0 20px;}
      h1{font-size:22px;} .pack-item{border-bottom:1px solid #ddd;padding:10px 0;}</style>
      </head><body>
      <h1>Clarify Before Signing</h1>
      <p>Document: ${escapeHtml(state.fileName)} (${escapeHtml(state.docTypeLabel)})</p>
      ${rows}
      <p style="margin-top:24px;color:#666;font-size:13px;">This is legal information, not legal advice.
      Bring this list to a qualified professional for anything you're unsure about.</p>
      </body></html>
    `);
    w.document.close();
    w.print();
  });
}

/* ---------------------------------------------------------
   UI wiring for screen transitions
--------------------------------------------------------- */
function setStatus(id, msg) {
  const el = document.getElementById(id);
  if (el) el.textContent = msg;
}

document.addEventListener("click", (e) => {
  if (e.target.id === "toIntakeAnalyze") runAnalysis();
});

/* ---------------------------------------------------------
   7. COMPARE MODE (Step 1)
--------------------------------------------------------- */
function wireCompare() {
  const btn = document.getElementById("compareDocsBtn");
  const input = document.getElementById("compareFileInput");
  if (!btn || !input) return;
  
  btn.addEventListener("click", () => input.click());
  input.addEventListener("change", (e) => {
    if (e.target.files[0]) handleCompareFile(e.target.files[0]);
  });
}

async function handleCompareFile(file) {
  state.docB.fileName = file.name;
  showScreen("compareScreen");
  setStatus("compareStatus", "Reading second document…");
  
  document.getElementById("compareDocA").textContent = state.fileName;
  document.getElementById("compareDocB").textContent = state.docB.fileName;

  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
  
  const pages = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    let text = "";
    let lastY = -1;
    for (const it of content.items) {
      if (lastY !== -1 && Math.abs(it.transform[5] - lastY) > 5) {
        text += "\n";
      } else if (text.length > 0 && !text.endsWith(" ") && !text.endsWith("\n")) {
        text += " ";
      }
      text += it.str;
      lastY = it.transform[5];
    }
    pages.push({ page: i, text });
  }
  
  state.docB.fullText = pages.map((p) => p.text).join("\n\n");
  state.docB.clauses = splitClauses(pages);

  setStatus("compareStatus", "Comparing documents…");
  await runCompareAnalysis();
}

async function runCompareAnalysis() {
  const topics = state.findings.map(f => f.topic);
  if (topics.length === 0) {
    setStatus("compareStatus", "No topics found in the first document to compare.");
    return;
  }

  const schema = {
    type: "object",
    properties: {
      comparisons: {
        type: "array",
        items: {
          type: "object",
          properties: {
            topic: { type: "string" },
            docAFound: { type: "boolean" },
            docAQuote: { type: "string" },
            docAClauseId: { type: "string" },
            docBFound: { type: "boolean" },
            docBQuote: { type: "string" },
            docBClauseId: { type: "string" },
            explanation: { type: "string" },
          },
          required: ["topic", "docAFound", "docBFound", "explanation"]
        }
      }
    },
    required: ["comparisons"]
  };

  const systemPrompt = `You are comparing two legal documents: Doc A and Doc B.
For each requested topic, check both documents using their provided clauses.
If the document addresses it, extract the EXACT verbatim quote and clauseId.
If it does not address it, set found=false and leave quote/clauseId empty.
Then, provide a plain-English description (2-3 sentences) of what changed between the two documents. If a topic is present in one document and absent in the other, say so explicitly. Do not invent generic statements. Base your answers solely on the provided clauses.`;

  const clausesA = state.clauses.map(c => `[Doc A | ${c.id} | p.${c.page} | ${c.heading}]\n${c.text}`).join('\n\n---\n\n').slice(0, 20000);
  const clausesB = state.docB.clauses.map(c => `[Doc B | ${c.id} | p.${c.page} | ${c.heading}]\n${c.text}`).join('\n\n---\n\n').slice(0, 20000);

  const userPrompt = `DOC A CLAUSES:\n${clausesA}\n\nDOC B CLAUSES:\n${clausesB}\n\nTOPICS TO COMPARE:\n${topics.map((t, i) => `${i + 1}. ${t}`).join('\n')}`;

  try {
    const result = await callGemini({ systemPrompt, userPrompt, jsonSchema: schema });
    renderComparisons(result.comparisons || []);
    setStatus("compareStatus", "");
  } catch (e) {
    setStatus("compareStatus", "Compare failed: " + e.message);
  }
}

function verifyCompareQuote(quote, clauseId, clauses, fullText) {
  if (!quote) return { verified: false, resolvedClause: null };
  const needle = normalize(quote);
  const clause = clauses.find((c) => c.id === clauseId) ||
    clauses.find((c) => normalize(c.text).includes(needle.slice(0, 40)));
  const haystack = clause ? normalize(clause.text) : normalize(fullText);
  const verified = needle.length > 0 && haystack.includes(needle.slice(0, Math.min(needle.length, 200)));
  return { verified, resolvedClause: clause };
}

function renderComparisons(comparisons) {
  const wrap = document.getElementById("compareResults");
  wrap.innerHTML = "";
  
  comparisons.forEach(c => {
    const vA = c.docAFound ? verifyCompareQuote(c.docAQuote, c.docAClauseId, state.clauses, state.fullText) : { verified: false };
    const vB = c.docBFound ? verifyCompareQuote(c.docBQuote, c.docBClauseId, state.docB.clauses, state.docB.fullText) : { verified: false };

    const card = document.createElement("div");
    card.className = "finding-card";
    card.style.borderLeft = "4px solid #6c757d"; 
    card.tabIndex = 0;
    card.setAttribute("aria-label", `Comparison for ${c.topic}`);
    
    let aHtml = c.docAFound ? `
      <div style="flex:1; padding-right:10px; border-right:1px solid #ddd;">
        <strong>Doc A:</strong><br/>
        <blockquote class="finding-quote">"${escapeHtml(c.docAQuote)}"</blockquote>
        ${vA.verified ? `<span style="font-size:12px;color:green;">✓ Verified (${vA.resolvedClause ? vA.resolvedClause.id : c.docAClauseId})</span>` : `<span class="unverified-note">Unverified quote</span>`}
      </div>` : `<div style="flex:1; padding-right:10px; border-right:1px solid #ddd;"><strong>Doc A:</strong> Not found</div>`;

    let bHtml = c.docBFound ? `
      <div style="flex:1; padding-left:10px;">
        <strong>Doc B:</strong><br/>
        <blockquote class="finding-quote">"${escapeHtml(c.docBQuote)}"</blockquote>
        ${vB.verified ? `<span style="font-size:12px;color:green;">✓ Verified (${vB.resolvedClause ? vB.resolvedClause.id : c.docBClauseId})</span>` : `<span class="unverified-note">Unverified quote</span>`}
      </div>` : `<div style="flex:1; padding-left:10px;"><strong>Doc B:</strong> Not found</div>`;

    card.innerHTML = `
      <div class="finding-topic">${escapeHtml(c.topic)}</div>
      <div class="finding-explanation" style="font-weight:500; margin-bottom:12px;">${escapeHtml(c.explanation)}</div>
      <div style="display:flex; flex-direction:row; justify-content:space-between; margin-top:10px;">
        ${aHtml}
        ${bHtml}
      </div>
    `;
    wrap.appendChild(card);
  });
}

/* ---------------------------------------------------------
   8. LANGUAGE TRANSLATION
--------------------------------------------------------- */
function wireLanguageToggle() {
  const select = document.getElementById('langSelect');
  if (!select) return;
  select.addEventListener('change', (e) => {
    translateFindings(e.target.value);
  });
}

async function translateFindings(lang) {
  state.findings.forEach(f => { if (!f.explanation_en) f.explanation_en = f.explanation; });
  state.missing.forEach(m => { if (!m.explanation_en) m.explanation_en = m.explanation; });

  if (lang === 'en') {
    state.findings.forEach(f => f.explanation = f.explanation_en);
    state.missing.forEach(m => m.explanation = m.explanation_en);
    renderFindings();
    return;
  }
  
  setStatus('analysisStatus', 'Translating explanations...');
  
  const items = [];
  state.findings.forEach((f, i) => items.push({ type: 'finding', index: i, text: f.explanation_en }));
  state.missing.forEach((m, i) => items.push({ type: 'missing', index: i, text: m.explanation_en }));
  
  if (items.length === 0) {
    setStatus('analysisStatus', '');
    return;
  }
  
  const langName = lang === 'hi' ? 'Hindi' : lang;
  
  const schema = {
    type: 'object',
    properties: {
      translations: {
        type: 'array',
        items: { type: 'string' }
      }
    },
    required: ['translations']
  };
  
  const systemPrompt = `You are a legal translator. Translate the provided plain-English legal explanations into ${langName}. Maintain accuracy and a professional tone. Return an array of translated strings exactly matching the order of the inputs.`;
  
  const userPrompt = items.map((item, idx) => `[${idx}] ${item.text}`).join('\n\n');
  
  try {
    const res = await callGemini({ systemPrompt, userPrompt, jsonSchema: schema });
    if (res.translations && res.translations.length === items.length) {
      items.forEach((item, idx) => {
        if (item.type === 'finding') state.findings[item.index].explanation = res.translations[idx];
        if (item.type === 'missing') state.missing[item.index].explanation = res.translations[idx];
      });
      renderFindings();
      setStatus('analysisStatus', '');
    } else {
      setStatus('analysisStatus', 'Translation failed: mismatch in array lengths');
    }
  } catch (e) {
    setStatus('analysisStatus', 'Translation failed: ' + e.message);
  }
}
