(function () {
  const form = document.getElementById('plan-form');
  const generateBtn = document.getElementById('generate-btn');
  const statusLine = document.getElementById('status-line');
  const resultsCard = document.getElementById('results-card');
  const resultsTitle = document.getElementById('results-title');
  const tabsEl = document.getElementById('sprint-tabs');
  const panelsEl = document.getElementById('sprint-panels');
  const exportBtn = document.getElementById('export-btn');
  const fileInput = document.getElementById('workbook');
  const fileDrop = document.getElementById('file-drop');
  const fileDropLabel = document.getElementById('file-drop-label');

  let currentPlan = null;

  fileInput.addEventListener('change', () => {
    if (fileInput.files.length) {
      fileDropLabel.textContent = fileInput.files[0].name;
      fileDrop.classList.add('has-file');
    } else {
      fileDropLabel.textContent = 'Choose or drop the .xlsx / .xls workbook';
      fileDrop.classList.remove('has-file');
    }
  });

  function setStatus(message, kind) {
    statusLine.textContent = message || '';
    statusLine.className = 'status-line' + (kind ? ' ' + kind : '');
  }

  function setLoading(isLoading) {
    generateBtn.disabled = isLoading;
    generateBtn.querySelector('.spinner').hidden = !isLoading;
    generateBtn.querySelector('.btn-label').textContent = isLoading
      ? 'Generating…'
      : 'Generate sprint plan';
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  function renderList(el, items) {
    el.innerHTML = (items || []).map((i) => `<li>${escapeHtml(i)}</li>`).join('');
  }

  function renderPlan(plan) {
    currentPlan = plan;
    resultsTitle.textContent = plan.project_name ? `Sprint plan — ${plan.project_name}` : 'Sprint plan';

    const sprints = plan.sprints || [];
    tabsEl.innerHTML = sprints.map((s, idx) =>
      `<button type="button" class="tab-btn${idx === 0 ? ' active' : ''}" data-idx="${idx}">Sprint ${s.sprint_number}</button>`
    ).join('');

    panelsEl.innerHTML = sprints.map((s, idx) => {
      const items = s.items || [];
      const rows = items.map((it) => `
        <tr>
          <td>${escapeHtml(it.item_id)}</td>
          <td>${escapeHtml(it.title)}</td>
          <td><span class="badge">${escapeHtml(it.item_type || '—')}</span></td>
          <td>${escapeHtml(it.priority || '—')}</td>
          <td>${escapeHtml(it.story_points ?? '—')}</td>
          <td>${(it.dependencies || []).map(escapeHtml).join(', ') || '—'}</td>
        </tr>
      `).join('');

      return `
        <div class="sprint-panel${idx === 0 ? ' active' : ''}" data-idx="${idx}">
          <div class="sprint-meta">
            <div><strong>Goal</strong>${escapeHtml(s.goal || '—')}</div>
            <div><strong>Theme</strong>${escapeHtml(s.theme || '—')}</div>
            <div><strong>Stories</strong>${items.length}</div>
          </div>
          <table class="items-table">
            <thead>
              <tr><th>ID</th><th>Title</th><th>Type</th><th>Priority</th><th>Points</th><th>Depends on</th></tr>
            </thead>
            <tbody>${rows || '<tr><td colspan="6">No items assigned to this sprint.</td></tr>'}</tbody>
          </table>
          <div class="sprint-meta">
            <div style="flex:1"><strong>Risks</strong>${(s.risks || []).map(escapeHtml).join('; ') || 'None noted.'}</div>
            <div style="flex:1"><strong>Exit criteria</strong>${(s.exit_criteria || []).map(escapeHtml).join('; ') || 'None noted.'}</div>
          </div>
        </div>
      `;
    }).join('');

    tabsEl.querySelectorAll('.tab-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        tabsEl.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
        panelsEl.querySelectorAll('.sprint-panel').forEach((p) => p.classList.remove('active'));
        btn.classList.add('active');
        panelsEl.querySelector(`.sprint-panel[data-idx="${btn.dataset.idx}"]`).classList.add('active');
      });
    });

    renderList(document.getElementById('assumptions-list'), plan.planning_assumptions);
    renderList(document.getElementById('risks-list'), plan.overall_risks);
    renderList(document.getElementById('unallocated-list'), plan.unallocated);

    resultsCard.hidden = false;
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    setStatus('');
    setLoading(true);
    resultsCard.hidden = true;

    const formData = new FormData(form);
    try {
      const res = await fetch('/api/generate', { method: 'POST', body: formData });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'The sprint plan could not be generated.');
      }
      renderPlan(data.plan);
      setStatus('Plan generated.', 'info');
    } catch (err) {
      setStatus(err.message || String(err), 'error');
    } finally {
      setLoading(false);
    }
  });

  // Bug fix: inside the pywebview desktop window, a fetch->blob->a[download]
  // click is silently ignored (no browser download manager to catch it), so
  // "Export to Excel" appeared to do nothing. When running inside the desktop
  // shell, window.pywebview.api is injected and we use it to save the file
  // natively instead. Plain-browser mode (python app.py) keeps working via
  // the original download-link path.
  async function exportViaBrowser() {
    const res = await fetch('/api/export', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ plan: currentPlan }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || 'Export failed.');
    }
    const blob = await res.blob();
    const disposition = res.headers.get('Content-Disposition') || '';
    const match = disposition.match(/filename="?([^"]+)"?/);
    const filename = match ? match[1] : 'sprint_plan.xlsx';
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    setStatus(`Downloaded ${filename}.`, 'info');
  }

  async function exportViaDesktopShell() {
    const result = await window.pywebview.api.export_plan(currentPlan);
    if (result && result.error) throw new Error(result.error);
    if (result && result.cancelled) return;
    setStatus(result && result.saved ? `Saved to ${result.saved}` : 'Saved.', 'info');
  }

  exportBtn.addEventListener('click', async () => {
    if (!currentPlan) return;
    exportBtn.disabled = true;
    const original = exportBtn.textContent;
    exportBtn.textContent = 'Exporting…';
    try {
      if (window.pywebview && window.pywebview.api) {
        await exportViaDesktopShell();
      } else {
        await exportViaBrowser();
      }
    } catch (err) {
      setStatus(err.message || String(err), 'error');
    } finally {
      exportBtn.disabled = false;
      exportBtn.textContent = original;
    }
  });
})();
