(() => {
  "use strict";

  const state = {
    files: [],
    result: null,
    project: "",
  };

  const el = (id) => document.getElementById(id);
  const projectInput = el("project");
  const dropzone = el("dropzone");
  const fileInput = el("fileInput");
  const fileListEl = el("fileList");
  const analyzeBtn = el("analyzeBtn");
  const statusLine = el("statusLine");
  const configState = el("configState");
  const emptyState = el("emptyState");
  const resultView = el("resultView");
  const toast = el("toast");

  // ---------------- Config check ----------------

  fetch("/api/status")
    .then((r) => r.json())
    .then((data) => {
      if (data.configured) {
        configState.textContent = `Model ready: ${data.model}`;
        configState.classList.add("ok");
      } else {
        configState.textContent = "No API key configured — add one to .env";
        configState.classList.add("bad");
      }
    })
    .catch(() => {
      configState.textContent = "Could not reach the backend service.";
      configState.classList.add("bad");
    });

  // ---------------- File selection ----------------

  dropzone.addEventListener("click", () => fileInput.click());
  dropzone.addEventListener("dragover", (e) => {
    e.preventDefault();
    dropzone.classList.add("dragover");
  });
  dropzone.addEventListener("dragleave", () => dropzone.classList.remove("dragover"));
  dropzone.addEventListener("drop", (e) => {
    e.preventDefault();
    dropzone.classList.remove("dragover");
    addFiles(e.dataTransfer.files);
  });
  fileInput.addEventListener("change", () => {
    addFiles(fileInput.files);
    fileInput.value = "";
  });

  function addFiles(fileListLike) {
    const incoming = Array.from(fileListLike);
    const existingKeys = new Set(state.files.map((f) => `${f.name}:${f.size}`));
    for (const f of incoming) {
      const key = `${f.name}:${f.size}`;
      if (!existingKeys.has(key)) {
        state.files.push(f);
        existingKeys.add(key);
      }
    }
    renderFileList();
    updateAnalyzeState();
  }

  function removeFile(index) {
    state.files.splice(index, 1);
    renderFileList();
    updateAnalyzeState();
  }

  function renderFileList() {
    fileListEl.innerHTML = "";
    state.files.forEach((f, idx) => {
      const li = document.createElement("li");
      const sizeKb = (f.size / 1024).toFixed(0);
      li.innerHTML = `<span class="name" title="${escapeHtml(f.name)}">${escapeHtml(f.name)} (${sizeKb} KB)</span>`;
      const btn = document.createElement("button");
      btn.textContent = "\u2715";
      btn.setAttribute("aria-label", `Remove ${f.name}`);
      btn.addEventListener("click", () => removeFile(idx));
      li.appendChild(btn);
      fileListEl.appendChild(li);
    });
  }

  projectInput.addEventListener("input", updateAnalyzeState);

  function updateAnalyzeState() {
    analyzeBtn.disabled = !(projectInput.value.trim() && state.files.length > 0);
  }

  // ---------------- Analyze ----------------

  analyzeBtn.addEventListener("click", runAnalysis);

  async function runAnalysis() {
    const project = projectInput.value.trim();
    if (!project || state.files.length === 0) return;

    analyzeBtn.disabled = true;
    analyzeBtn.textContent = "Analyzing…";
    setStatus("Reading files and contacting the AI model…", "");

    const form = new FormData();
    form.append("project", project);
    state.files.forEach((f) => form.append("files", f, f.name));

    try {
      const resp = await fetch("/api/analyze", { method: "POST", body: form });
      const data = await resp.json();
      if (!resp.ok) {
        throw new Error(data.error || "Analysis failed.");
      }
      state.result = data.result;
      state.project = project;
      renderResult(data.result, data.manifest || [], data.truncated);
      setStatus("Analysis completed.", "success");
      showToast("Analysis completed.", "success");
    } catch (err) {
      setStatus(err.message || "Analysis failed.", "error");
      showToast(err.message || "Analysis failed.", "error");
    } finally {
      analyzeBtn.textContent = "Analyze package";
      updateAnalyzeState();
    }
  }

  function setStatus(text, kind) {
    statusLine.textContent = text;
    statusLine.className = "status-line" + (kind ? ` ${kind}` : "");
  }

  // ---------------- Rendering ----------------

  function renderResult(result, manifest, truncated) {
    emptyState.classList.add("hidden");
    resultView.classList.remove("hidden");

    el("resultTitle").textContent = result.project_name || state.project;
    el("resultMeta").textContent = truncated
      ? "Source text was truncated to fit the model's input limit."
      : "";

    el("mReq").textContent = (result.requirements || []).length;
    el("mOpen").textContent = (result.open_questions || []).length;
    el("mGap").textContent = (result.traceability_gaps || []).length;
    el("summaryText").textContent = result.summary || "No summary returned.";

    renderTable("risksTable", result.risks, ["risk"]);
    renderTable("requirementsTable", result.requirements, [
      "id", "title", "description", "type", "priority", "actors",
      "acceptance_criteria", "assumptions", "open_questions", "confidence",
    ], "description");
    renderTable("storiesTable", result.user_stories, [
      "id", "description", "role", "action", "benefit", "priority",
      "story_points", "acceptance_criteria", "preconditions", "dependencies", "requirement_ids",
    ], "description");
    renderTable("dataModelTable", result.data_model, [
      "table", "field", "type", "mandatory", "reference_or_values", "source_requirement_ids",
    ], "field");
    renderTable("rolesTable", result.roles_acl, [
      "actor_or_role", "object", "operation", "condition", "required_role", "notes",
    ], "notes");
    renderTable("flowsTable", result.flows, [
      "name", "trigger", "steps", "decisions", "exception_path", "requirement_ids",
    ], "name");
    renderTable("integrationsTable", result.integrations, [
      "name", "source", "target", "direction", "trigger", "protocol", "authentication", "error_handling",
    ], "name");
    renderTable("recommendationsTable", result.recommendations, [
      "requirement_id", "implementation", "component", "reason",
    ], "reason");
    renderTable("openQuestionsTable", result.open_questions, ["question"]);
    renderTable("gapsTable", result.traceability_gaps, ["gap"]);
    renderTable("manifestTable", manifest, ["name", "type", "size_kb", "note"]);
  }

  function renderTable(containerId, rows, preferredColumns, fallbackField) {
    const container = el(containerId);
    container.innerHTML = "";

    let normalizedRows = rows;
    if (Array.isArray(rows) && rows.length && typeof rows[0] !== "object") {
      // Array of plain strings (the model sometimes returns these instead
      // of structured objects) — wrap using the section's meaningful field,
      // not preferredColumns[0], which for most sections is an identifier
      // like "id" rather than the actual content.
      const key = fallbackField || preferredColumns[0] || "value";
      normalizedRows = rows.map((v) => ({ [key]: v }));
    }

    if (!Array.isArray(normalizedRows) || normalizedRows.length === 0) {
      const div = document.createElement("div");
      div.className = "empty-note";
      div.textContent = "Nothing reported.";
      container.appendChild(div);
      return;
    }

    const columns = preferredColumns.filter((c) => normalizedRows.some((r) => c in r));
    const extra = Object.keys(normalizedRows[0]).filter((k) => !columns.includes(k));
    const allColumns = columns.length ? columns.concat(extra) : Object.keys(normalizedRows[0]);

    const table = document.createElement("table");
    table.className = "data-table";
    const thead = document.createElement("thead");
    const headRow = document.createElement("tr");
    allColumns.forEach((c) => {
      const th = document.createElement("th");
      th.textContent = c.replace(/_/g, " ");
      headRow.appendChild(th);
    });
    thead.appendChild(headRow);
    table.appendChild(thead);

    const tbody = document.createElement("tbody");
    normalizedRows.forEach((row) => {
      const tr = document.createElement("tr");
      allColumns.forEach((c) => {
        const td = document.createElement("td");
        td.textContent = formatCell(row[c]);
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    container.appendChild(table);
  }

  function formatCell(value) {
    if (value === null || value === undefined) return "";
    if (Array.isArray(value)) return value.join(", ");
    if (typeof value === "object") return JSON.stringify(value);
    return String(value);
  }

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  // ---------------- Tabs ----------------

  document.getElementById("tabs").addEventListener("click", (e) => {
    const btn = e.target.closest(".tab");
    if (!btn) return;
    document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
    btn.classList.add("active");
    const name = btn.dataset.tab;
    document.querySelectorAll(".tab-panel").forEach((panel) => {
      panel.classList.toggle("hidden", panel.dataset.panel !== name);
    });
  });

  // ---------------- Export ----------------

  document.querySelectorAll("[data-export]").forEach((btn) => {
    btn.addEventListener("click", () => exportResult(btn.dataset.export, btn));
  });

  // Detect whether we're running inside the packaged desktop window
  // (pywebview) vs. a plain browser tab. pywebview blocks normal
  // <a download>/blob-URL downloads, so desktop mode goes through a
  // native Save-As dialog exposed as window.pywebview.api.save_file.
  let desktopApiReady = !!(window.pywebview && window.pywebview.api);
  window.addEventListener("pywebviewready", () => {
    desktopApiReady = true;
  });

  const FORMAT_LABELS = { json: "JSON", excel: "Excel workbook", word: "Word summary" };

  async function exportResult(fmt, btn) {
    if (!state.result) return;

    const originalLabel = btn.textContent;
    btn.disabled = true;
    btn.textContent = "Converting…";
    setStatus(`Converting to ${FORMAT_LABELS[fmt] || fmt}…`, "");

    try {
      const resp = await fetch(`/api/export/${fmt}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project: state.project, result: state.result }),
      });
      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}));
        throw new Error(data.error || "Export failed.");
      }
      const blob = await resp.blob();
      const disposition = resp.headers.get("Content-Disposition") || "";
      const match = disposition.match(/filename="?([^"]+)"?/);
      const filename = match ? match[1] : `export.${fmt}`;

      if (desktopApiReady && window.pywebview && window.pywebview.api && window.pywebview.api.save_file) {
        const base64Data = await blobToBase64(blob);
        const result = await window.pywebview.api.save_file(filename, base64Data);
        if (result && result.ok) {
          setStatus(`Saved ${filename}`, "success");
          showToast(`Saved ${filename}`, "success");
        } else if (result && result.error !== "cancelled") {
          throw new Error(result.error || "Save failed.");
        } else {
          setStatus("Save cancelled.", "");
        }
      } else {
        // Plain browser fallback (e.g. running `python app.py` directly).
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
        setStatus(`Downloaded ${filename}`, "success");
        showToast(`Downloaded ${filename}`, "success");
      }
    } catch (err) {
      setStatus(err.message || "Export failed.", "error");
      showToast(err.message || "Export failed.", "error");
    } finally {
      btn.disabled = false;
      btn.textContent = originalLabel;
    }
  }

  function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(String(reader.result).split(",")[1] || "");
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  // ---------------- Toast ----------------

  let toastTimer = null;
  function showToast(message, kind) {
    toast.textContent = message;
    toast.className = "toast" + (kind ? ` ${kind}` : "");
    toast.classList.remove("hidden");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.add("hidden"), 3500);
  }
})();
