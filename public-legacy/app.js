// --- DOM refs ---
const searchInput = document.getElementById("search");
const alertsNode = document.getElementById("alerts");
const statsNode = document.getElementById("stats");
const emptyNode = document.getElementById("empty-state");
const categoryFilter = document.getElementById("filter-category");
const editModal = document.getElementById("edit-modal");
const editForm = document.getElementById("edit-form");

const colInbox = document.getElementById("col-inbox");
const colOpen = document.getElementById("col-open");
const colDone = document.getElementById("col-done");
const colEliminated = document.getElementById("col-eliminated");
const countInbox = document.getElementById("count-inbox");
const countOpen = document.getElementById("count-open");
const countDone = document.getElementById("count-done");
const countEliminated = document.getElementById("count-eliminated");

const columns = { inbox: colInbox, open: colOpen, done: colDone, eliminated: colEliminated };
const counts = { inbox: countInbox, open: countOpen, done: countDone, eliminated: countEliminated };

// --- State ---
const state = {
  summary: null,
  categories: [],
  filterPriority: "all",
  filterCategory: "all",
  search: "",
  expandedId: null,
  editingItem: null,
  loading: false,
  draggedId: null,
  attachmentsCache: {},
  activeTab: "brain",
  jarbasOutputs: null,
  jarbasPreviewCache: {},
  inboxItemIds: new Set(),
  martaData: null,
  remindersData: null
};

// ============================================================================
// Toast Notification System
// ============================================================================
const toastContainer = document.getElementById("toast-container");

function showToast(message, type = "info", duration = 3500) {
  const icons = {
    success: "\u2705",
    error: "\u274c",
    info: "\u2139\ufe0f"
  };

  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  toast.innerHTML = `<span class="toast-icon">${icons[type] || icons.info}</span><span>${esc(message)}</span>`;
  toastContainer.appendChild(toast);

  setTimeout(() => {
    toast.classList.add("removing");
    toast.addEventListener("animationend", () => toast.remove());
  }, duration);
}

// ============================================================================
// Styled Confirm Dialog
// ============================================================================
const confirmDialog = document.getElementById("confirm-dialog");
const confirmIcon = document.getElementById("confirm-icon");
const confirmTitle = document.getElementById("confirm-title");
const confirmMessage = document.getElementById("confirm-message");
const confirmOk = document.getElementById("confirm-ok");
const confirmCancel = document.getElementById("confirm-cancel");

let confirmResolver = null;

function showConfirm({ title, message, icon = "\u26a0\ufe0f", okText = "Confirmar", okClass = "danger" }) {
  return new Promise((resolve) => {
    confirmResolver = resolve;
    confirmIcon.textContent = icon;
    confirmTitle.textContent = title;
    confirmMessage.textContent = message;
    confirmOk.textContent = okText;
    confirmOk.className = `btn ${okClass}`;
    confirmDialog.showModal();
  });
}

confirmOk.addEventListener("click", () => {
  confirmDialog.close();
  if (confirmResolver) confirmResolver(true);
  confirmResolver = null;
});

confirmCancel.addEventListener("click", () => {
  confirmDialog.close();
  if (confirmResolver) confirmResolver(false);
  confirmResolver = null;
});

confirmDialog.addEventListener("close", () => {
  if (confirmResolver) confirmResolver(false);
  confirmResolver = null;
});

// ============================================================================
// Helpers
// ============================================================================
function esc(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function daysFromNow(dateStr) {
  if (!dateStr) return null;
  const diff = new Date(dateStr + "T00:00:00") - new Date(new Date().toISOString().slice(0, 10) + "T00:00:00");
  return Math.round(diff / (1000 * 60 * 60 * 24));
}

function priorityLabel(p) {
  if (p === "ALTA") return "Alta";
  if (p === "MEDIA") return "Media";
  return "Baixa";
}

function actionLabel(a) {
  if (a === "CREATE_PROJECT") return "Projeto";
  if (a === "CREATE_TASK") return "Tarefa";
  if (a === "STORE_REFERENCE") return "Referencia";
  if (a === "FOLLOW_UP") return "Follow-up";
  return "Registro";
}

function inputTypeLabel(t) {
  if (t === "audio") return "Audio";
  if (t === "image") return "Imagem";
  if (t === "pdf") return "PDF";
  if (t === "file") return "Arquivo";
  return "Texto";
}

// ============================================================================
// API
// ============================================================================
async function fetchDashboard() {
  const r = await fetch("/api/dashboard");
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

async function fetchCategories() {
  const r = await fetch("/api/categories");
  if (!r.ok) return [];
  const data = await r.json();
  return data.categories || [];
}

async function patchStatus(id, status) {
  const r = await fetch(`/api/actions/${id}/status`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ status })
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
}

async function patchItem(id, fields) {
  const r = await fetch(`/api/actions/${id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(fields)
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
}

async function fetchAttachments(itemId) {
  const r = await fetch(`/api/items/${itemId}/files`);
  if (!r.ok) return [];
  const data = await r.json();
  return data.attachments || [];
}

async function deleteItem(id) {
  const r = await fetch(`/api/actions/${id}`, { method: "DELETE" });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

async function createItem(fields) {
  const r = await fetch("/api/actions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(fields)
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

// ============================================================================
// Jarbas API
// ============================================================================
async function postExpand(id) {
  const r = await fetch(`/api/items/${id}/expand`, { method: "POST" });
  if (!r.ok) return null;
  return r.json();
}

async function fetchAgentOutputs() {
  const r = await fetch("/api/agent-outputs");
  if (!r.ok) return [];
  const data = await r.json();
  return data.outputs || [];
}

async function fetchFileContent(itemId) {
  const r = await fetch(`/api/items/${itemId}/file`);
  if (!r.ok) return null;
  return r.text();
}

async function uploadFinalVersion(itemId, fileContent) {
  const r = await fetch(`/api/agent-outputs/${itemId}/final`, {
    method: "POST",
    headers: { "content-type": "text/plain" },
    body: fileContent
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

// ============================================================================
// Render: Jarbas Grid
// ============================================================================
function renderJarbasCard(item) {
  const typeLabel = item.contentType === "article" ? "Artigo" : "Post";
  const statusBadge = item.hasFinalVersion
    ? '<span class="jarbas-badge final">Finalizado</span>'
    : '<span class="jarbas-badge draft">Rascunho</span>';

  const date = new Date(item.createdAt).toLocaleDateString("pt-BR");
  const topic = esc(item.topic || item.summaryPtBr || "Sem titulo");

  const preview = state.jarbasPreviewCache[item.id];
  const previewHtml = preview
    ? `<div class="jarbas-card-preview">${esc(preview.slice(0, 500))}${preview.length > 500 ? "..." : ""}</div>`
    : `<div class="jarbas-card-preview" style="color:var(--muted);font-style:italic">Carregando preview...</div>`;

  // Hashtags display
  const hashtagsHtml = item.hashtags && item.hashtags.length > 0
    ? `<div class="jarbas-hashtags">${item.hashtags.map((h) => `<span class="jarbas-hashtag">${esc(h)}</span>`).join("")}</div>`
    : "";

  // Hooks display
  const hooksHtml = item.hooks && item.hooks.length > 0
    ? `<div class="jarbas-hooks">
        <div class="jarbas-hooks-title">Ganchos gerados:</div>
        ${item.hooks.map((h) => `<div class="jarbas-hook${h.selected ? " selected" : ""}"><span class="jarbas-hook-type">${esc(h.type)}</span> ${esc(h.text)}</div>`).join("")}
      </div>`
    : "";

  const uploadBtn = !item.hasFinalVersion
    ? `<label class="jarbas-upload-label">
         Subir versao final
         <input type="file" accept=".md,.txt" data-upload-id="${item.id}" />
       </label>`
    : `<span class="jarbas-badge final" style="font-size:0.72rem">Versao final enviada</span>`;

  return `
    <article class="jarbas-card" data-jarbas-id="${item.id}">
      <div class="jarbas-card-header">
        <h3 class="jarbas-card-title">${topic}</h3>
        ${statusBadge}
      </div>
      <div class="jarbas-card-meta">
        <span class="tag type-tag">${typeLabel}</span>
        <span class="tag id-tag">#${item.id}</span>
        <span class="tag due">${date}</span>
      </div>
      ${hashtagsHtml}
      ${previewHtml}
      ${hooksHtml}
      <div class="jarbas-card-actions">
        <a href="/api/items/${item.id}/file" download class="btn secondary">Download MD</a>
        ${uploadBtn}
        <button class="btn delete-permanent" data-delete-id="${item.id}" title="Deletar permanentemente">Deletar</button>
      </div>
      <div class="jarbas-upload-status" id="upload-status-${item.id}"></div>
    </article>
  `;
}

function renderJarbasView() {
  const grid = document.getElementById("jarbas-grid");
  const empty = document.getElementById("jarbas-empty");
  const outputs = state.jarbasOutputs || [];

  if (outputs.length === 0) {
    grid.innerHTML = "";
    empty.style.display = "block";
  } else {
    grid.innerHTML = outputs.map(renderJarbasCard).join("");
    empty.style.display = "none";
  }
}

async function loadJarbasOutputs() {
  const outputs = await fetchAgentOutputs();
  state.jarbasOutputs = outputs;
  renderJarbasView();

  // Pre-load previews for all items
  for (const item of outputs) {
    if (!state.jarbasPreviewCache[item.id]) {
      fetchFileContent(item.id).then((content) => {
        if (content) {
          state.jarbasPreviewCache[item.id] = content;
          if (state.activeTab === "jarbas") renderJarbasView();
        }
      }).catch(() => {});
    }
  }
}

// ============================================================================
// Marta (Chief of Staff) view
// ============================================================================
async function loadMartaData() {
  try {
    const cosRes = await fetch("/api/cos");
    if (!cosRes.ok) throw new Error("Failed to load CoS data");
    state.martaData = await cosRes.json();

    // Fetch non-critical data without blocking each other
    const [remRes, healthRes, commitRes] = await Promise.allSettled([
      fetch("/api/reminders").then((r) => r.ok ? r.json() : null),
      fetch("/api/relationship-health").then((r) => r.ok ? r.json() : null),
      fetch("/api/commitments").then((r) => r.ok ? r.json() : null)
    ]);
    state.remindersData = remRes.status === "fulfilled" && remRes.value ? remRes.value.reminders || [] : [];
    state.healthData = healthRes.status === "fulfilled" && healthRes.value ? healthRes.value.health || [] : [];
    state.commitmentsData = commitRes.status === "fulfilled" && commitRes.value ? commitRes.value.commitments || [] : [];
    populateUploadPersonSelect();
    renderReminders();
    renderHealthHeatmap();
    renderCommitments();
    renderMartaView();
  } catch (err) {
    console.error("loadMartaData error:", err);
    const emptyState = document.getElementById("marta-empty");
    if (emptyState) {
      emptyState.style.display = "flex";
      emptyState.innerHTML = '<p>Erro ao carregar dados da Marta. <button onclick="loadMartaData()" class="btn btn-secondary" style="margin-top:8px">Tentar novamente</button></p>';
    }
  }
}

function renderReminders() {
  const container = document.getElementById("marta-reminders");
  if (!container) return;
  const reminders = state.remindersData || [];

  if (reminders.length === 0) {
    container.innerHTML = '<div class="marta-empty-col">Nenhum lembrete pendente.</div>';
    return;
  }

  container.innerHTML = reminders.map((r) => {
    const triggerDate = new Date(r.triggerAt);
    const dateStr = triggerDate.toLocaleString("pt-BR", {
      day: "2-digit", month: "2-digit", year: "numeric",
      hour: "2-digit", minute: "2-digit"
    });
    const isPast = triggerDate < new Date();
    const recurrenceBadge = r.recurrence
      ? `<span class="reminder-recurrence">${escapeHtml(r.recurrence)}</span>`
      : "";
    const personBadge = r.personName
      ? `<span class="reminder-person">${escapeHtml(r.personName)}</span>`
      : "";

    return `<div class="reminder-card${isPast ? " reminder-overdue" : ""}">
      <div class="reminder-text">${escapeHtml(r.text)}</div>
      <div class="reminder-meta">
        <span class="reminder-date${isPast ? " overdue" : ""}">${dateStr}</span>
        ${recurrenceBadge}
        ${personBadge}
      </div>
      <button class="btn-cancel-reminder" data-reminder-id="${r.id}" title="Cancelar lembrete">&times;</button>
    </div>`;
  }).join("");
}

// ── Upload Notes ─────────────────────────────────────────────────────
function populateUploadPersonSelect() {
  const select = document.getElementById("upload-person");
  if (!select || !state.martaData?.people) return;
  select.innerHTML = '<option value="">Selecione a pessoa...</option>' +
    state.martaData.people.map((p) =>
      `<option value="${p.id}">${escapeHtml(p.name)}${p.role ? ` (${escapeHtml(p.role)})` : ""}</option>`
    ).join("");
}

{
  const dropzone = document.getElementById("upload-dropzone");
  const fileInput = document.getElementById("upload-file");
  const uploadBtn = document.getElementById("upload-btn");
  const personSelect = document.getElementById("upload-person");
  let selectedFile = null;

  function updateUploadBtn() {
    uploadBtn.disabled = !(selectedFile && personSelect?.value);
  }

  if (dropzone) {
    dropzone.addEventListener("dragover", (e) => { e.preventDefault(); dropzone.classList.add("drag-over"); });
    dropzone.addEventListener("dragleave", () => dropzone.classList.remove("drag-over"));
    dropzone.addEventListener("drop", (e) => {
      e.preventDefault();
      dropzone.classList.remove("drag-over");
      const file = e.dataTransfer?.files?.[0];
      if (file) { setSelectedFile(file); }
    });
  }

  if (fileInput) {
    fileInput.addEventListener("change", () => {
      if (fileInput.files?.[0]) setSelectedFile(fileInput.files[0]);
    });
  }

  if (personSelect) personSelect.addEventListener("change", updateUploadBtn);

  function setSelectedFile(file) {
    selectedFile = file;
    if (dropzone) {
      dropzone.classList.add("has-file");
      dropzone.querySelector(".upload-text").textContent = file.name;
      dropzone.querySelector(".upload-hint").textContent =
        `${(file.size / 1024).toFixed(0)} KB — Clique para trocar`;
    }
    updateUploadBtn();
  }

  if (uploadBtn) {
    uploadBtn.addEventListener("click", async () => {
      if (!selectedFile || !personSelect?.value) return;
      // Pre-check file size (5MB limit)
      if (selectedFile.size > 5 * 1024 * 1024) {
        showToast("Arquivo muito grande (max 5MB)", "error");
        return;
      }
      uploadBtn.disabled = true;
      uploadBtn.textContent = "Processando...";

      const resultDiv = document.getElementById("upload-result");
      resultDiv.style.display = "block";
      resultDiv.innerHTML = '<div class="upload-spinner">&#9203; Processando notas com IA... pode levar alguns segundos.</div>';

      try {
        const formData = new FormData();
        formData.append("file", selectedFile);
        formData.append("personId", personSelect.value);

        const res = await fetch("/api/cos/upload-notes", { method: "POST", body: formData });
        const data = await res.json();

        if (!res.ok || !data.ok) {
          throw new Error(data.error || "Upload failed");
        }

        const r = data.result;
        const bulletsList = (r.executiveBullets || [])
          .map((b) => `<li>${escapeHtml(b)}</li>`).join("");

        resultDiv.innerHTML = `
          <h3>&#9989; Notas processadas!</h3>
          <div class="upload-result-stats">
            <span class="upload-stat">&#128203; ${r.actionItems} acao${r.actionItems !== 1 ? "s" : ""}</span>
            <span class="upload-stat">&#9878; ${r.decisions} decisao${r.decisions !== 1 ? "es" : ""}</span>
            <span class="upload-stat">&#129309; ${r.commitments} compromisso${r.commitments !== 1 ? "s" : ""}</span>
            ${r.teamMood ? `<span class="upload-stat">&#128172; ${escapeHtml(r.teamMood)}</span>` : ""}
          </div>
          <div class="upload-result-summary">${escapeHtml(r.summary)}</div>
          ${bulletsList ? `<ul class="upload-result-bullets">${bulletsList}</ul>` : ""}
        `;

        showToast("Notas processadas com sucesso!", "success");
        // Reset
        selectedFile = null;
        if (fileInput) fileInput.value = "";
        if (dropzone) {
          dropzone.classList.remove("has-file");
          dropzone.querySelector(".upload-text").textContent = "Arraste um arquivo aqui ou clique para selecionar";
          dropzone.querySelector(".upload-hint").textContent = "PDF, Markdown ou Texto (max 5MB)";
        }
        // Refresh Marta data
        state.martaData = null;
        loadMartaData();
      } catch (err) {
        resultDiv.innerHTML = `<h3 style="color:var(--danger)">&#10060; Erro ao processar</h3><p style="font-size:0.85rem;color:var(--muted)">${escapeHtml(err.message)}</p>`;
        showToast("Erro ao processar notas", "error");
      }

      uploadBtn.textContent = "Processar Notas";
      updateUploadBtn();
    });
  }
}

// ── Relationship Health Heatmap ──────────────────────────────────────
function renderHealthHeatmap() {
  const container = document.getElementById("health-heatmap");
  const section = document.getElementById("marta-health-section");
  const health = state.healthData || [];
  if (!container || !section) return;

  if (health.length === 0) { section.style.display = "none"; return; }
  section.style.display = "block";

  container.innerHTML = health.map((h) => {
    const levelClass = `health-${h.level}`;
    const factors = h.factors || {};
    const alertsHtml = (h.alerts || [])
      .map((a) => `<div class="health-alert-item">&#9888; ${escapeHtml(a)}</div>`).join("");

    return `<div class="health-card ${levelClass}">
      <div class="health-card-header">
        <span class="health-card-name">${escapeHtml(h.personName)}</span>
        <span class="health-card-score">${h.score}</span>
      </div>
      <div class="health-card-factors">
        ${renderHealthFactor("1:1", factors.oneOnOneAdherence ?? 0)}
        ${renderHealthFactor("Itens", factors.openItemsHealth ?? 0)}
        ${renderHealthFactor("Compromissos", factors.commitmentFulfillment ?? 0)}
        ${renderHealthFactor("Contato", factors.contactRecency ?? 0)}
      </div>
      ${alertsHtml ? `<div class="health-card-alerts">${alertsHtml}</div>` : ""}
    </div>`;
  }).join("");
}

function renderHealthFactor(label, score) {
  const pct = Math.round((score / 25) * 100);
  return `<div class="health-factor">
    <span>${label}</span>
    <div class="health-factor-bar"><div class="health-factor-fill" style="width:${pct}%"></div></div>
    <span>${score}/25</span>
  </div>`;
}

// ── Commitments Render ───────────────────────────────────────────────
function renderCommitments() {
  const container = document.getElementById("commitments-grid");
  const section = document.getElementById("marta-commitments-section");
  const commitments = state.commitmentsData || [];
  if (!container || !section) return;

  if (commitments.length === 0) { section.style.display = "none"; return; }
  section.style.display = "block";

  const mine = commitments.filter((c) => c.direction === "mine");
  const theirs = commitments.filter((c) => c.direction === "theirs");

  container.innerHTML = `
    <div>
      <div class="commitments-col-title">Meus compromissos (${mine.length})</div>
      ${mine.length ? mine.map(renderCommitmentCard).join("") : '<div class="marta-empty-col">Nenhum compromisso</div>'}
    </div>
    <div>
      <div class="commitments-col-title">Compromissos deles (${theirs.length})</div>
      ${theirs.length ? theirs.map(renderCommitmentCard).join("") : '<div class="marta-empty-col">Nenhum compromisso</div>'}
    </div>
  `;
}

function renderCommitmentCard(c) {
  const isOverdue = c.deadline && new Date(c.deadline) < new Date();
  const deadlineStr = c.deadline
    ? new Date(c.deadline).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })
    : "";

  return `<div class="commitment-card">
    <div class="commitment-card-header">
      <span class="commitment-summary">${escapeHtml(c.summary)}</span>
      <span class="commitment-person">${escapeHtml(c.personName || "")}</span>
    </div>
    <div class="commitment-meta">
      ${deadlineStr ? `<span class="commitment-deadline${isOverdue ? " overdue" : ""}">&#128197; ${deadlineStr}${isOverdue ? " (atrasado)" : ""}</span>` : ""}
      <div class="commitment-actions">
        <button class="btn-fulfill" data-commitment-id="${c.id}" title="Cumprido">&#10003;</button>
        <button class="btn-cancel-commitment" data-commitment-id="${c.id}" title="Cancelar">&#10005;</button>
      </div>
    </div>
  </div>`;
}

function renderMartaView() {
  const data = state.martaData;
  const peopleContainer = document.getElementById("marta-people");
  const outputsContainer = document.getElementById("marta-outputs");
  const emptyState = document.getElementById("marta-empty");

  if (!data || (data.people.length === 0 && data.outputs.length === 0)) {
    peopleContainer.innerHTML = "";
    outputsContainer.innerHTML = "";
    emptyState.style.display = "flex";
    return;
  }
  emptyState.style.display = "none";

  // Render people kanban boards
  peopleContainer.innerHTML = data.people.map((person) => {
    const alertClass = person.stats.totalOverdue > 0 ? "person-alert" : "person-ok";
    const alertIcon = person.stats.totalOverdue > 0
      ? `&#9888;&#65039; ${person.stats.totalOverdue} atrasado${person.stats.totalOverdue > 1 ? "s" : ""}`
      : "&#9989; Em dia";
    const lastOO = person.lastOneOnOne
      ? new Date(person.lastOneOnOne).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })
      : "nunca";

    const openCards = (person.items.open || []).map((item) => renderMartaCard(item)).join("");
    const doneCards = (person.items.done || []).slice(0, 8).map((item) => renderMartaCard(item)).join("");
    const eliminatedCards = (person.items.eliminated || []).slice(0, 5).map((item) => renderMartaCard(item)).join("");

    return `<div class="marta-person-board">
      <div class="marta-person-header ${alertClass}">
        <span class="marta-person-name">&#128100; ${escapeHtml(person.name)}${person.role ? ` (${escapeHtml(person.role)})` : ""}</span>
        <div class="marta-person-actions">
          <span class="marta-person-meta">1:1: ${lastOO} | ${alertIcon}</span>
          <button class="btn-edit-person" data-person-id="${person.id}" title="Editar">&#9998;</button>
          <button class="btn-deactivate-person" data-person-id="${person.id}" title="Desativar">&#10005;</button>
        </div>
      </div>
      <div class="marta-person-kanban">
        <div class="marta-kanban-col" data-marta-col-status="open">
          <div class="marta-kanban-header">Pendente (${(person.items.open || []).length})</div>
          <div class="marta-kanban-cards">${openCards || '<div class="marta-empty-col">Nenhum item</div>'}</div>
        </div>
        <div class="marta-kanban-col done-col" data-marta-col-status="done">
          <div class="marta-kanban-header">Concluido (${person.stats.totalDone})</div>
          <div class="marta-kanban-cards">${doneCards || '<div class="marta-empty-col">Nenhum item</div>'}</div>
        </div>
        <div class="marta-kanban-col eliminated-col" data-marta-col-status="eliminated">
          <div class="marta-kanban-header">Eliminado</div>
          <div class="marta-kanban-cards">${eliminatedCards || '<div class="marta-empty-col">Nenhum item</div>'}</div>
        </div>
      </div>
    </div>`;
  }).join("");

  // Render outputs
  const outputTypeIcons = {
    briefing: "&#128203;",
    email_draft: "&#9993;&#65039;",
    status_report: "&#128202;",
    reflection: "&#128302;",
    one_on_one_notes: "&#128221;"
  };

  outputsContainer.innerHTML = data.outputs.length > 0
    ? data.outputs.map((output) => {
      const icon = outputTypeIcons[output.outputType] || "&#128196;";
      const preview = output.content.slice(0, 120).replace(/\n/g, " ");
      const date = new Date(output.createdAt).toLocaleString("pt-BR", {
        day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit"
      });

      return `<div class="marta-output-card" data-output-id="${output.id}">
        <div class="marta-output-header">
          <span class="marta-output-icon">${icon}</span>
          <span class="marta-output-title">${escapeHtml(output.title)}</span>
          <span class="marta-output-date">${date}</span>
        </div>
        <div class="marta-output-preview">${escapeHtml(preview)}...</div>
        <div class="marta-output-actions">
          <button class="btn-copy-output" data-output-id="${output.id}" title="Copiar conteudo">&#128203; Copiar</button>
          <button class="btn-expand-output" data-output-id="${output.id}" title="Ver completo">&#128065; Ver completo</button>
          <button class="btn-delete-output" data-output-id="${output.id}" title="Excluir output">&#128465; Excluir</button>
        </div>
        <div class="marta-output-full" id="output-full-${output.id}" style="display:none">
          <pre class="marta-output-content">Carregando...</pre>
        </div>
      </div>`;
    }).join("")
    : '<div class="marta-empty-col">Nenhum output ainda.</div>';
}

function renderMartaCard(item) {
  const priorityClass = item.priority === "ALTA" ? "priority-alta" : item.priority === "MEDIA" ? "priority-media" : "priority-baixa";
  const title = item.actionTitle || item.summaryPtBr;
  const dueTag = item.dueAt ? `<span class="marta-card-due">${item.dueAt}</span>` : "";
  const isDone = item.status === "done";
  const isEliminated = item.status === "eliminated";

  const actionBtn = isDone
    ? `<button class="marta-card-action" data-marta-status="${item.id}" data-to="open" title="Reabrir">&#8635;</button>`
    : isEliminated ? ""
    : `<button class="marta-card-action" data-marta-status="${item.id}" data-to="done" title="Concluir">&#10003;</button>`;

  return `<div class="marta-card ${priorityClass}${isDone ? " marta-card-done" : ""}${isEliminated ? " marta-card-eliminated" : ""}" draggable="true" data-marta-card-id="${item.id}" data-marta-card-status="${item.status}">
    <div class="marta-card-top">
      <div class="marta-card-title">#${item.id} ${escapeHtml(title.length > 60 ? title.slice(0, 60) + "..." : title)}</div>
      ${actionBtn}
    </div>
    ${dueTag}
    ${item.nextStep ? `<div class="marta-card-next">${escapeHtml(item.nextStep)}</div>` : ""}
  </div>`;
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

// Marta output actions: copy and expand (fetch full content on demand)
const martaFullContentCache = {};

async function fetchMartaOutputFull(id) {
  if (martaFullContentCache[id]) return martaFullContentCache[id];
  const res = await fetch(`/api/cos/output/${id}`);
  if (!res.ok) throw new Error("Failed to fetch output");
  const data = await res.json();
  martaFullContentCache[id] = data.content;
  return data.content;
}

document.addEventListener("click", async (e) => {
  const copyBtn = e.target.closest(".btn-copy-output");
  if (copyBtn) {
    const id = copyBtn.dataset.outputId;
    try {
      const fullContent = await fetchMartaOutputFull(id);
      await navigator.clipboard.writeText(fullContent);
      showToast("Conteudo copiado!");
    } catch {
      showToast("Erro ao copiar", "error");
    }
    return;
  }

  const expandBtn = e.target.closest(".btn-expand-output");
  if (expandBtn) {
    const id = expandBtn.dataset.outputId;
    const fullEl = document.getElementById(`output-full-${id}`);
    if (fullEl) {
      if (fullEl.style.display === "none") {
        try {
          const fullContent = await fetchMartaOutputFull(id);
          fullEl.querySelector(".marta-output-content").textContent = fullContent;
          fullEl.style.display = "block";
          expandBtn.innerHTML = "&#128065; Recolher";
        } catch {
          showToast("Erro ao carregar conteudo", "error");
        }
      } else {
        fullEl.style.display = "none";
        expandBtn.innerHTML = "&#128065; Ver completo";
      }
    }
    return;
  }

  const deleteBtn = e.target.closest(".btn-delete-output");
  if (deleteBtn) {
    const id = deleteBtn.dataset.outputId;
    const card = deleteBtn.closest(".marta-output-card");
    const title = card?.querySelector(".marta-output-title")?.textContent || `Output #${id}`;
    const confirmed = await showConfirm({
      title: "Excluir output",
      message: `Tem certeza que deseja excluir "${title}"? Esta ação não pode ser desfeita.`,
      icon: "🗑️",
      okText: "Excluir",
      okClass: "danger"
    });
    if (!confirmed) return;
    try {
      const res = await fetch(`/api/cos/output/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Delete failed");
      card?.remove();
      delete martaFullContentCache[id];
      showToast("Output excluído!", "success");
    } catch {
      showToast("Erro ao excluir output", "error");
    }
    return;
  }
});

// ── Person Modal ──────────────────────────────────────────────────────
const personModal = document.getElementById("person-modal");
let editingPersonId = null;

function openPersonModal(person) {
  editingPersonId = person ? person.id : null;
  document.getElementById("person-modal-title").textContent =
    person ? "Editar Pessoa" : "Nova Pessoa";
  document.getElementById("person-name").value = person?.name || "";
  document.getElementById("person-role").value = person?.role || "";
  document.getElementById("person-relationship").value = person?.relationship || "direct_report";
  document.getElementById("person-email").value = person?.email || "";
  document.getElementById("person-cadence").value = person?.oneOnOneCadence || "weekly";
  document.getElementById("person-notes").value = person?.notes || "";
  personModal.showModal();
}

document.getElementById("btn-add-person")?.addEventListener("click", () => openPersonModal(null));
document.getElementById("person-modal-close")?.addEventListener("click", () => personModal.close());
document.getElementById("person-modal-cancel")?.addEventListener("click", () => personModal.close());

document.getElementById("person-form")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const fields = {
    name: document.getElementById("person-name").value.trim(),
    role: document.getElementById("person-role").value.trim(),
    relationship: document.getElementById("person-relationship").value,
    email: document.getElementById("person-email").value.trim(),
    oneOnOneCadence: document.getElementById("person-cadence").value,
    notes: document.getElementById("person-notes").value.trim()
  };
  if (!fields.name) { showToast("Nome e obrigatorio", "error"); return; }

  try {
    if (editingPersonId) {
      const r = await fetch(`/api/people/${editingPersonId}`, {
        method: "PATCH", headers: { "content-type": "application/json" },
        body: JSON.stringify(fields)
      });
      if (!r.ok) throw new Error();
      showToast("Pessoa atualizada!", "success");
    } else {
      const r = await fetch("/api/people", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify(fields)
      });
      if (!r.ok) throw new Error();
      showToast("Pessoa adicionada!", "success");
    }
    personModal.close();
    state.martaData = null;
    loadMartaData();
  } catch { showToast("Erro ao salvar pessoa", "error"); }
});

// ── Marta delegated click handlers ────────────────────────────────────
document.addEventListener("click", async (e) => {
  // Edit person
  const editBtn = e.target.closest(".btn-edit-person");
  if (editBtn) {
    const personId = Number(editBtn.dataset.personId);
    const person = state.martaData?.people?.find(p => p.id === personId);
    if (person) openPersonModal(person);
    return;
  }

  // Deactivate person
  const deactivateBtn = e.target.closest(".btn-deactivate-person");
  if (deactivateBtn) {
    const personId = Number(deactivateBtn.dataset.personId);
    const person = state.martaData?.people?.find(p => p.id === personId);
    if (!confirm(`Desativar ${person?.name || "esta pessoa"}? Os itens nao serao excluidos.`)) return;
    try {
      const r = await fetch(`/api/people/${personId}`, { method: "DELETE" });
      if (!r.ok) throw new Error();
      showToast("Pessoa desativada!", "success");
      state.martaData = null;
      loadMartaData();
    } catch { showToast("Erro ao desativar pessoa", "error"); }
    return;
  }

  // Cancel reminder
  const cancelBtn = e.target.closest(".btn-cancel-reminder");
  if (cancelBtn) {
    const id = Number(cancelBtn.dataset.reminderId);
    if (!confirm("Cancelar este lembrete?")) return;
    try {
      const r = await fetch(`/api/reminders/${id}/cancel`, { method: "POST" });
      if (!r.ok) throw new Error();
      showToast("Lembrete cancelado!", "success");
      const remRes = await fetch("/api/reminders");
      state.remindersData = remRes.ok ? (await remRes.json()).reminders || [] : [];
      renderReminders();
    } catch { showToast("Erro ao cancelar lembrete", "error"); }
    return;
  }

  // Marta kanban status toggle
  const statusBtn = e.target.closest("[data-marta-status]");
  if (statusBtn) {
    e.stopPropagation();
    const id = Number(statusBtn.dataset.martaStatus);
    const newStatus = statusBtn.dataset.to;
    try {
      const r = await fetch(`/api/actions/${id}/status`, {
        method: "PATCH", headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: newStatus })
      });
      if (!r.ok) throw new Error();
      showToast(newStatus === "done" ? "Item concluido!" : "Item reaberto!", "success");
      state.martaData = null;
      loadMartaData();
    } catch { showToast("Erro ao atualizar status", "error"); }
    return;
  }

  // Commitment fulfill
  const fulfillBtn = e.target.closest(".btn-fulfill");
  if (fulfillBtn) {
    if (!confirm("Marcar compromisso como cumprido?")) return;
    const id = Number(fulfillBtn.dataset.commitmentId);
    try {
      const r = await fetch(`/api/commitments/${id}/status`, {
        method: "PATCH", headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: "fulfilled" })
      });
      if (!r.ok) throw new Error();
      showToast("Compromisso cumprido!", "success");
      const freshRes = await fetch("/api/commitments");
      if (freshRes.ok) {
        const freshData = await freshRes.json();
        state.commitmentsData = freshData.commitments || [];
      }
      renderCommitments();
    } catch { showToast("Erro ao atualizar compromisso", "error"); }
    return;
  }

  // Commitment cancel
  const cancelCommitBtn = e.target.closest(".btn-cancel-commitment");
  if (cancelCommitBtn) {
    if (!confirm("Cancelar este compromisso?")) return;
    const id = Number(cancelCommitBtn.dataset.commitmentId);
    try {
      const r = await fetch(`/api/commitments/${id}/status`, {
        method: "PATCH", headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: "cancelled" })
      });
      if (!r.ok) throw new Error();
      showToast("Compromisso cancelado.", "success");
      const freshRes = await fetch("/api/commitments");
      if (freshRes.ok) {
        const freshData = await freshRes.json();
        state.commitmentsData = freshData.commitments || [];
      }
      renderCommitments();
    } catch { showToast("Erro ao cancelar compromisso", "error"); }
    return;
  }
});

// ============================================================================
// Marta Drag and Drop
// ============================================================================
let martaDraggedId = null;

document.addEventListener("dragstart", (e) => {
  const card = e.target.closest("[data-marta-card-id]");
  if (!card) return;

  martaDraggedId = Number(card.dataset.martaCardId);
  card.classList.add("marta-card-dragging");
  e.dataTransfer.effectAllowed = "move";
  e.dataTransfer.setData("text/marta-card", card.dataset.martaCardId);
});

document.addEventListener("dragend", (e) => {
  const card = e.target.closest("[data-marta-card-id]");
  if (card) card.classList.remove("marta-card-dragging");
  martaDraggedId = null;
  document.querySelectorAll(".marta-kanban-col.marta-drag-over").forEach((col) => col.classList.remove("marta-drag-over"));
});

document.addEventListener("dragover", (e) => {
  const col = e.target.closest("[data-marta-col-status]");
  if (!col || martaDraggedId === null) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = "move";
  col.classList.add("marta-drag-over");
});

document.addEventListener("dragleave", (e) => {
  const col = e.target.closest("[data-marta-col-status]");
  if (!col) return;
  if (!col.contains(e.relatedTarget)) {
    col.classList.remove("marta-drag-over");
  }
});

document.addEventListener("drop", async (e) => {
  const col = e.target.closest("[data-marta-col-status]");
  if (!col || martaDraggedId === null) return;
  e.preventDefault();
  col.classList.remove("marta-drag-over");

  const cardId = Number(e.dataTransfer.getData("text/marta-card"));
  const newStatus = col.dataset.martaColStatus;
  if (!cardId || !newStatus) return;

  try {
    const r = await fetch(`/api/actions/${cardId}/status`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: newStatus })
    });
    if (!r.ok) throw new Error();
    const msgs = { open: "Item reaberto!", done: "Item concluido!", eliminated: "Item eliminado!" };
    showToast(msgs[newStatus] || "Status atualizado!", "success");
    state.martaData = null;
    loadMartaData();
  } catch {
    showToast("Erro ao mover item", "error");
  }
});

// ============================================================================
// Tab switching
// ============================================================================
function switchTab(tab) {
  state.activeTab = tab;
  document.querySelectorAll(".main-tab").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.tab === tab);
  });

  const brainSections = [
    document.getElementById("alerts"),
    document.querySelector(".filters-bar"),
    document.getElementById("stats"),
    document.getElementById("kanban-board"),
    document.getElementById("empty-state"),
    document.getElementById("search-results"),
    document.getElementById("fab-new-card")
  ];

  const jarbasSection = document.getElementById("jarbas-view");
  const martaSection = document.getElementById("marta-view");

  // Hide all non-brain sections
  jarbasSection.style.display = "none";
  martaSection.style.display = "none";

  if (tab === "brain") {
    for (const el of brainSections) {
      if (el) el.style.display = "";
    }
    document.getElementById("search-results").style.display = "none";
  } else if (tab === "jarbas") {
    for (const el of brainSections) {
      if (el) el.style.display = "none";
    }
    jarbasSection.style.display = "block";
    if (!state.jarbasOutputs) loadJarbasOutputs();
  } else if (tab === "marta") {
    for (const el of brainSections) {
      if (el) el.style.display = "none";
    }
    martaSection.style.display = "block";
    if (!state.martaData) loadMartaData();
  }
}

document.addEventListener("click", (e) => {
  const tab = e.target.closest(".main-tab");
  if (tab) {
    switchTab(tab.dataset.tab);
    return;
  }
});

// ============================================================================
// Jarbas: load preview on card click
// ============================================================================
document.addEventListener("click", async (e) => {
  const card = e.target.closest(".jarbas-card");
  if (!card || e.target.closest("a") || e.target.closest("label") || e.target.closest("input") || e.target.closest("button")) return;

  const id = Number(card.dataset.jarbasId);
  if (state.jarbasPreviewCache[id]) return;

  const content = await fetchFileContent(id).catch(() => null);
  if (content) {
    state.jarbasPreviewCache[id] = content;
    renderJarbasView();
  }
});

// ============================================================================
// Jarbas: upload final version
// ============================================================================
document.addEventListener("change", async (e) => {
  const input = e.target.closest("[data-upload-id]");
  if (!input) return;

  const id = Number(input.dataset.uploadId);
  const file = input.files?.[0];
  if (!file) return;

  const statusEl = document.getElementById(`upload-status-${id}`);

  try {
    if (statusEl) statusEl.textContent = "Enviando...";
    const content = await file.text();
    const result = await uploadFinalVersion(id, content);
    showToast(`Versao final salva! ${result.learnings || 0} padroes aprendidos.`, "success");
    await loadJarbasOutputs();
  } catch (err) {
    showToast(`Erro ao enviar: ${err.message}`, "error");
    if (statusEl) statusEl.textContent = "";
  }
});

// ============================================================================
// Inbox Processing Queue
// ============================================================================
async function fetchInboxQueue() {
  const r = await fetch("/api/inbox-queue");
  if (!r.ok) return { items: [], count: 0 };
  return r.json();
}

async function processInboxItemApi(id, params) {
  const r = await fetch(`/api/inbox-queue/${id}/process`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(params)
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}


// ============================================================================
// Render: Alerts
// ============================================================================
function renderAlerts(summary) {
  const alerts = summary.alerts || {};
  const chips = [];
  if (alerts.overdue > 0) {
    chips.push(`<span class="alert-chip danger">${alerts.overdue} atrasado${alerts.overdue > 1 ? "s" : ""}</span>`);
  }
  if (alerts.dueToday > 0) {
    chips.push(`<span class="alert-chip warn">${alerts.dueToday} vence${alerts.dueToday > 1 ? "m" : ""} hoje</span>`);
  }
  if (alerts.missingOwner > 0) {
    chips.push(`<span class="alert-chip info">${alerts.missingOwner} sem responsavel</span>`);
  }
  alertsNode.innerHTML = chips.join("");
}

// ============================================================================
// Render: Stats
// ============================================================================
function renderStats(summary) {
  const s = summary.statusBreakdown || {};
  statsNode.innerHTML = [
    `<span class="stat-pill"><span class="num">${summary.totalItems || 0}</span> capturados</span>`,
    `<span class="stat-pill"><span class="num">${s.open || 0}</span> abertos</span>`,
    `<span class="stat-pill"><span class="num">${s.done || 0}</span> resolvidos</span>`,
    `<span class="stat-pill"><span class="num">${s.eliminated || 0}</span> eliminados</span>`,
    `<span class="stat-pill"><span class="num">${summary.totalProjects || 0}</span> projetos</span>`
  ].join("");
}

// ============================================================================
// Render: Category filter
// ============================================================================
function renderCategoryFilter(summary) {
  const current = state.filterCategory;
  const cats = summary.categories || [];
  let html = '<option value="all">Todas categorias</option>';
  for (const cat of cats) {
    const sel = cat.name === current ? " selected" : "";
    html += `<option value="${esc(cat.name)}"${sel}>${esc(cat.name)} (${cat.total})</option>`;
  }
  categoryFilter.innerHTML = html;
}

// ============================================================================
// Filter items
// ============================================================================
function getFilteredItems(summary) {
  let items = summary.recentItems || [];

  if (state.filterPriority !== "all") {
    items = items.filter((i) => i.priority === state.filterPriority);
  }

  if (state.filterCategory !== "all") {
    items = items.filter((i) => i.categoryName === state.filterCategory);
  }

  if (state.search) {
    const q = state.search.toLowerCase();
    items = items.filter((i) =>
      (i.summaryPtBr || "").toLowerCase().includes(q) ||
      (i.actionTitle || "").toLowerCase().includes(q) ||
      (i.categoryName || "").toLowerCase().includes(q) ||
      (i.nextStep || "").toLowerCase().includes(q) ||
      (i.followUpWith || "").toLowerCase().includes(q) ||
      (i.rawText || "").toLowerCase().includes(q) ||
      String(i.id).includes(q)
    );
  }

  const priOrder = { ALTA: 3, MEDIA: 2, BAIXA: 1 };
  items.sort((a, b) => {
    const pd = (priOrder[b.priority] || 0) - (priOrder[a.priority] || 0);
    if (pd !== 0) return pd;
    if (a.dueAt && !b.dueAt) return -1;
    if (!a.dueAt && b.dueAt) return 1;
    if (a.dueAt && b.dueAt) {
      const dd = new Date(a.dueAt) - new Date(b.dueAt);
      if (dd !== 0) return dd;
    }
    return new Date(b.createdAt) - new Date(a.createdAt);
  });

  return items;
}

// ============================================================================
// Render: Single Card
// ============================================================================
function renderCard(item) {
  const isExpanded = state.expandedId === item.id;
  const expandedClass = isExpanded ? " expanded" : "";
  const priClass = `pri-${item.priority}`;

  // Due tag logic
  let dueTag = "";
  let urgentDueTag = "";
  if (item.dueAt) {
    const d = daysFromNow(item.dueAt);
    if (d !== null && d < 0) {
      dueTag = `<span class="tag overdue">Atrasado ${Math.abs(d)}d</span>`;
      urgentDueTag = dueTag;
    } else if (d === 0) {
      dueTag = `<span class="tag overdue">Vence hoje</span>`;
      urgentDueTag = dueTag;
    } else if (d !== null) {
      dueTag = `<span class="tag due">${item.dueAt}</span>`;
    }
  }

  // Progressive summarization layers
  let progressiveHtml = "";
  const prog = item.progressive;
  if (prog) {
    if (prog.layer3) {
      progressiveHtml += `<div class="progressive-layer3">${esc(prog.layer3)}</div>`;
    }
    if (prog.layer2 && Array.isArray(prog.layer2) && prog.layer2.length > 0) {
      progressiveHtml += `<div class="progressive-layer2">${prog.layer2.map((h) => `<span class="highlight-phrase">${esc(h)}</span>`).join("")}</div>`;
    }
  }

  // PRIMARY: Action title (or summary fallback)
  const displayTitle = item.actionTitle || ((item.summaryPtBr || "").length > 80 ? (item.summaryPtBr || "").slice(0, 80) + "..." : (item.summaryPtBr || ""));
  const titleHtml = displayTitle ? `<h3 class="card-action-title">${esc(displayTitle)}</h3>` : "";

  // Quick hover actions
  const isInbox = state.inboxItemIds.has(item.id);
  let hoverActions = "";
  if (isInbox) {
    hoverActions = `<div class="card-hover-actions">
      <button class="card-hover-btn action-done" data-inbox-process="${item.id}" data-inbox-mode="actionable" title="Marcar como tarefa">&#10003;</button>
      <button class="card-hover-btn" data-inbox-process="${item.id}" data-inbox-mode="reference" title="Referencia">&#128218;</button>
      <button class="card-hover-btn action-eliminate" data-inbox-process="${item.id}" data-inbox-mode="trash" title="Descartar">&#10005;</button>
    </div>`;
  } else if (item.status === "open") {
    hoverActions = `<div class="card-hover-actions">
      <button class="card-hover-btn action-done" data-status-id="${item.id}" data-status="done" title="Resolver">&#10003;</button>
      <button class="card-hover-btn action-eliminate" data-status-id="${item.id}" data-status="eliminated" title="Eliminar">&#10005;</button>
      <button class="card-hover-btn" data-edit-id="${item.id}" title="Editar">&#9998;</button>
    </div>`;
  } else {
    hoverActions = `<div class="card-hover-actions">
      <button class="card-hover-btn" data-status-id="${item.id}" data-status="open" title="Reabrir">&#8634;</button>
    </div>`;
  }

  // Inline inbox processing actions (always visible in inbox column)
  const inboxActionsHtml = isInbox ? `<div class="card-inbox-actions">
    <button class="btn success" data-inbox-process="${item.id}" data-inbox-mode="actionable">&#10003; Tarefa</button>
    <button class="btn secondary" data-inbox-process="${item.id}" data-inbox-mode="reference">Ref</button>
    <button class="btn danger" data-inbox-process="${item.id}" data-inbox-mode="trash">Lixo</button>
  </div>` : "";

  // Forwarded badge
  const forwardedBadge = item.metadata?.forwarded
    ? `<span class="tag forwarded-tag" title="Encaminhada de ${esc(item.metadata.forwardFrom || 'desconhecido')}">&#8618; Encaminhada</span>`
    : "";

  // Collapsed meta
  const collapsedMeta = `<div class="card-meta-collapsed">
    <span class="tag category">${esc(item.categoryName)}</span>
    ${forwardedBadge}
    ${urgentDueTag}
  </div>`;

  // SECONDARY: AI interpretation (moved to expandable)
  const interpretation = item.summaryPtBr
    ? `<p class="card-interpretation">${esc(item.summaryPtBr)}</p>`
    : "";

  // Key info (moved to expandable)
  const keyInfoRows = [];
  if (item.nextStep) {
    keyInfoRows.push(`<div class="key-info-row"><span class="key-info-label">Proximo:</span><span class="key-info-value">${esc(item.nextStep)}</span></div>`);
  }
  if (item.followUpWith && item.followUpWith !== "PENDENTE_DONO" && item.followUpWith.toLowerCase() !== "definir responsavel e cobrar atualizacao") {
    keyInfoRows.push(`<div class="key-info-row"><span class="key-info-label">Responsavel:</span><span class="key-info-value">${esc(item.followUpWith)}</span></div>`);
  }
  const keyInfo = keyInfoRows.length > 0
    ? `<div class="card-key-info">${keyInfoRows.join("")}</div>`
    : "";

  // File indicator
  const fileCount = item.attachmentCount || (item.hasFile ? 1 : 0);
  const fileIndicator = fileCount > 0
    ? `<span class="tag file-tag" title="${fileCount} arquivo${fileCount > 1 ? "s" : ""} anexado${fileCount > 1 ? "s" : ""}">&#128206; ${fileCount > 1 ? fileCount : ""}</span>`
    : "";

  // Full meta tags (shown in expandable zone)
  const fullMeta = `<div class="card-meta">
    <span class="tag id-tag">#${item.id}</span>
    <span class="tag priority-${item.priority}">${priorityLabel(item.priority)}</span>
    <span class="tag category">${esc(item.categoryName)}</span>
    <span class="tag type-tag">${inputTypeLabel(item.inputType)}</span>
    ${forwardedBadge}
    ${fileIndicator}
    ${dueTag}
  </div>`;

  // Raw text reference (shown in expanded detail)
  const hasRawText = item.rawText && item.rawText.trim() && item.rawText.trim() !== item.summaryPtBr?.trim();
  const rawTextSection = hasRawText
    ? `<button type="button" class="raw-text-toggle" data-raw-toggle="${item.id}">Mensagem original</button>
       <div class="raw-text-content" id="raw-${item.id}">${esc(item.rawText)}</div>`
    : "";

  // File attachments section
  let fileSection = "";
  if (fileCount > 0) {
    const cached = state.attachmentsCache[item.id];
    if (cached) {
      fileSection = cached.map(renderAttachment).join("");
    } else {
      const fileUrl = `/api/items/${item.id}/file`;
      fileSection = renderAttachmentByType(fileUrl, item.inputType, item.id);
    }
  }

  // Detail section (expanded) — with separated danger zone
  const detail = `
    <div class="card-detail">
      ${fileSection}
      ${rawTextSection}
      ${item.actionDetails ? `<div class="detail-row"><span class="detail-label">Detalhes</span><span class="detail-value">${esc(item.actionDetails)}</span></div>` : ""}
      <div class="detail-row"><span class="detail-label">Tipo</span><span class="detail-value">${esc(actionLabel(item.action))}</span></div>
      <div class="detail-row"><span class="detail-label">Criado</span><span class="detail-value">${new Date(item.createdAt).toLocaleString("pt-BR")}</span></div>
      ${item.processingError ? `<div class="detail-row"><span class="detail-label" style="color:var(--danger)">Erro</span><span class="detail-value" style="color:var(--danger)">${esc(item.processingError)}</span></div>` : ""}
      <div class="card-actions">
        <div class="card-actions-main">
          ${isInbox ? `
            <button class="btn success" data-inbox-process="${item.id}" data-inbox-mode="actionable">Marcar como tarefa</button>
            <button class="btn secondary" data-inbox-process="${item.id}" data-inbox-mode="reference">Referencia</button>
            <button class="btn danger" data-inbox-process="${item.id}" data-inbox-mode="trash">Descartar</button>
          ` : item.status === "open" ? `
            <button class="btn edit" data-edit-id="${item.id}">Editar</button>
            <button class="btn success" data-status-id="${item.id}" data-status="done">Resolver</button>
            <button class="btn danger" data-status-id="${item.id}" data-status="eliminated">Eliminar</button>
          ` : `
            <button class="btn secondary" data-status-id="${item.id}" data-status="open">Reabrir</button>
          `}
        </div>
        <div class="card-actions-danger">
          <button class="btn delete-permanent" data-delete-id="${item.id}" title="Deletar permanentemente">Deletar</button>
        </div>
      </div>
    </div>
  `;

  return `
    <article class="item-card ${priClass}${expandedClass}" draggable="true" data-card-id="${item.id}" data-card-status="${item.status}">
      ${hoverActions}
      ${progressiveHtml}
      ${titleHtml}
      ${collapsedMeta}
      ${inboxActionsHtml}
      <div class="card-expandable">
        ${interpretation}
        ${keyInfo}
        ${fullMeta}
      </div>
      ${detail}
    </article>
  `;
}

// ============================================================================
// Render: Kanban
// ============================================================================
function renderKanban(summary) {
  const items = getFilteredItems(summary);

  const grouped = { inbox: [], open: [], done: [], eliminated: [] };
  for (const item of items) {
    if (item.status === "open" && state.inboxItemIds.has(item.id)) {
      grouped.inbox.push(item);
    } else {
      const bucket = grouped[item.status];
      if (bucket) {
        bucket.push(item);
      }
    }
  }

  const totalFiltered = items.length;

  for (const status of ["inbox", "open", "done", "eliminated"]) {
    const col = columns[status];
    const group = grouped[status];
    counts[status].textContent = group.length;

    if (group.length === 0) {
      const msgs = {
        inbox: "Nenhum item para processar",
        open: "Nenhum card aberto",
        done: "Nenhum resolvido",
        eliminated: "Nenhum eliminado"
      };
      col.innerHTML = `<div class="empty-state" style="padding:24px 10px;font-size:0.82rem">${msgs[status]}</div>`;
    } else {
      col.innerHTML = group.map(renderCard).join("");
    }
  }

  emptyNode.style.display = totalFiltered === 0 ? "block" : "none";
}

// ============================================================================
// Full render
// ============================================================================
function renderAll() {
  if (!state.summary) return;
  renderAlerts(state.summary);
  renderStats(state.summary);
  renderCategoryFilter(state.summary);
  renderKanban(state.summary);
}

// ============================================================================
// Load data
// ============================================================================
async function load() {
  if (state.loading) return;
  state.loading = true;
  try {
    const [summary, categories, inboxData] = await Promise.all([
      fetchDashboard(),
      fetchCategories(),
      fetchInboxQueue().catch(() => ({ items: [], count: 0 }))
    ]);
    state.summary = summary;
    state.categories = categories;
    state.inboxItemIds = new Set((inboxData.items || []).map((i) => i.id));
    renderAll();
  } catch (error) {
    if (!state.summary) {
      colOpen.innerHTML = `<div class="empty-state" style="padding:24px">
        <span class="empty-state-icon">&#128533;</span>
        <p class="empty-state-text">Erro ao carregar dados</p>
      </div>`;
    }
  } finally {
    state.loading = false;
  }
}

load();
setInterval(load, 30000);

// ============================================================================
// Events: Filters
// ============================================================================
document.addEventListener("click", (e) => {
  const priChip = e.target.closest("[data-filter-priority]");
  if (priChip) {
    state.filterPriority = priChip.dataset.filterPriority;
    document.querySelectorAll("[data-filter-priority]").forEach((b) => b.classList.remove("active"));
    priChip.classList.add("active");
    renderKanban(state.summary);
    return;
  }

  // Expand/collapse card
  const card = e.target.closest(".item-card");
  if (card && !e.target.closest("button") && !e.target.closest("a")) {
    const id = Number(card.dataset.cardId);
    const wasExpanded = state.expandedId === id;
    state.expandedId = wasExpanded ? null : id;
    renderKanban(state.summary);
    // Auto-load attachments when expanding a card that has files
    if (!wasExpanded) {
      const item = state.summary?.recentItems?.find((i) => i.id === id);
      const fileCount = (item?.attachmentCount || 0) + (item?.hasFile && !item?.attachmentCount ? 1 : 0);
      if (fileCount > 0) {
        loadAttachmentsForCard(id);
      }
      // Fire-and-forget: track expand for progressive summarization
      postExpand(id).catch(() => {});
    }
    return;
  }
});

// ============================================================================
// Events: Clear filters button (empty state CTA)
// ============================================================================
document.getElementById("clear-filters-btn").addEventListener("click", () => {
  state.filterPriority = "all";
  state.filterCategory = "all";
  state.search = "";
  searchInput.value = "";
  document.querySelectorAll("[data-filter-priority]").forEach((b) => b.classList.remove("active"));
  document.querySelector('[data-filter-priority="all"]').classList.add("active");
  categoryFilter.value = "all";
  renderKanban(state.summary);
});

// ============================================================================
// Events: Category filter
// ============================================================================
categoryFilter.addEventListener("change", () => {
  state.filterCategory = categoryFilter.value;
  renderKanban(state.summary);
});

// ============================================================================
// Semantic Search API
// ============================================================================
async function semanticSearch(query) {
  const r = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
  if (!r.ok) return { results: [], mode: "none" };
  return r.json();
}

function renderSearchResults(results, mode, query) {
  const container = document.getElementById("search-results-cards");
  const title = document.getElementById("search-results-title");
  const modeLabel = mode === "semantic" ? "semantica" : "textual";
  title.textContent = `${results.length} resultado${results.length !== 1 ? "s" : ""} (busca ${modeLabel})`;

  if (results.length === 0) {
    container.innerHTML = `<div class="empty-state" style="padding:24px">
      <span class="empty-state-icon">&#128270;</span>
      <p class="empty-state-text">Nenhum resultado para "${esc(query)}"</p>
    </div>`;
    return;
  }

  container.innerHTML = results.map((item) => {
    const scoreHtml = item.score !== null && item.score !== undefined
      ? `<span class="tag" style="background:var(--accent-soft);color:var(--accent)">${Math.round(item.score * 100)}%</span>`
      : "";
    const displayTitle = item.actionTitle || (item.summaryPtBr || "").slice(0, 100);
    const priClass = `pri-${item.priority}`;

    return `<article class="item-card ${priClass}" data-card-id="${item.id}" data-card-status="${item.status}" style="cursor:pointer">
      <h3 class="card-action-title" style="padding-right:0">${esc(displayTitle)}</h3>
      <div class="card-meta" style="margin-top:6px">
        <span class="tag id-tag">#${item.id}</span>
        <span class="tag priority-${item.priority}">${priorityLabel(item.priority)}</span>
        <span class="tag category">${esc(item.categoryName)}</span>
        ${scoreHtml}
        ${item.dueAt ? `<span class="tag due">${item.dueAt}</span>` : ""}
      </div>
      <p class="card-interpretation" style="margin-top:8px">${esc((item.summaryPtBr || "").slice(0, 200))}${(item.summaryPtBr || "").length > 200 ? "..." : ""}</p>
    </article>`;
  }).join("");
}

function showSearchResults(results, mode, query) {
  document.getElementById("kanban-board").style.display = "none";
  document.getElementById("empty-state").style.display = "none";
  document.getElementById("search-results").style.display = "block";
  renderSearchResults(results, mode, query);
}

function hideSearchResults() {
  document.getElementById("search-results").style.display = "none";
  document.getElementById("kanban-board").style.display = "";
  renderKanban(state.summary);
}

document.getElementById("back-to-kanban").addEventListener("click", () => {
  searchInput.value = "";
  state.search = "";
  hideSearchResults();
});

// Click on a search result card: navigate to kanban and expand that card
document.getElementById("search-results-cards").addEventListener("click", (e) => {
  const card = e.target.closest(".item-card[data-card-id]");
  if (!card) return;
  const id = Number(card.dataset.cardId);
  state.expandedId = id;
  searchInput.value = "";
  state.search = "";
  hideSearchResults();
});

// ============================================================================
// Events: Search (semantic + client-side fallback)
// ============================================================================
let searchTimeout;
searchInput.addEventListener("input", () => {
  clearTimeout(searchTimeout);
  const query = searchInput.value.trim();

  if (!query || query.length < 3) {
    // Short or empty query: revert to client-side filtering
    state.search = query;
    if (document.getElementById("search-results").style.display !== "none") {
      hideSearchResults();
    }
    if (state.summary) renderKanban(state.summary);
    return;
  }

  searchTimeout = setTimeout(async () => {
    state.search = query;
    try {
      const data = await semanticSearch(query);
      if (data.results && data.results.length > 0) {
        showSearchResults(data.results, data.mode, query);
      } else {
        // No semantic results, try client-side filter
        hideSearchResults();
        renderKanban(state.summary);
      }
    } catch {
      // On error, fall back to client-side search
      hideSearchResults();
      renderKanban(state.summary);
    }
  }, 400);
});

// ============================================================================
// Events: Status buttons (including quick hover actions)
// ============================================================================
document.addEventListener("click", async (e) => {
  const statusBtn = e.target.closest("[data-status-id]");
  if (!statusBtn) return;

  e.stopPropagation();
  const id = Number(statusBtn.dataset.statusId);
  const status = statusBtn.dataset.status;
  statusBtn.disabled = true;

  // Animate card removal
  const card = statusBtn.closest(".item-card");
  if (card) card.classList.add("removing");

  try {
    await patchStatus(id, status);
    const statusMessages = {
      done: "Card marcado como resolvido",
      eliminated: "Card eliminado",
      open: "Card reaberto"
    };
    showToast(statusMessages[status] || "Status atualizado", "success", 2500);
    // Small delay to let animation play
    await new Promise((r) => setTimeout(r, 200));
    await load();
  } catch (err) {
    showToast(`Erro ao atualizar #${id}: ${err.message}`, "error");
    if (card) card.classList.remove("removing");
  } finally {
    statusBtn.disabled = false;
  }
});

// ============================================================================
// Events: Delete button (permanent) — with styled confirm
// ============================================================================
document.addEventListener("click", async (e) => {
  const deleteBtn = e.target.closest("[data-delete-id]");
  if (!deleteBtn) return;

  e.stopPropagation();
  const id = Number(deleteBtn.dataset.deleteId);

  const confirmed = await showConfirm({
    title: "Deletar permanentemente?",
    message: `O card #${id} e seus arquivos serao removidos. Esta acao nao pode ser desfeita.`,
    icon: "\ud83d\uddd1\ufe0f",
    okText: "Deletar",
    okClass: "danger"
  });

  if (!confirmed) return;

  deleteBtn.disabled = true;
  deleteBtn.textContent = "Deletando...";

  // Animate card removal
  const card = deleteBtn.closest(".item-card") || deleteBtn.closest(".jarbas-card");
  if (card) card.classList.add("removing");

  try {
    await deleteItem(id);
    showToast("Card deletado permanentemente", "success", 2500);
    await new Promise((r) => setTimeout(r, 250));
    if (state.activeTab === "jarbas") {
      await loadJarbasOutputs();
    }
    await load();
  } catch (err) {
    showToast(`Erro ao deletar #${id}: ${err.message}`, "error");
    if (card) card.classList.remove("removing");
  } finally {
    deleteBtn.disabled = false;
    deleteBtn.textContent = "Deletar";
  }
});

// ============================================================================
// Events: Inbox processing (kanban inline actions)
// ============================================================================
document.addEventListener("click", async (e) => {
  const btn = e.target.closest("[data-inbox-process]");
  if (!btn) return;

  e.stopPropagation();
  const id = Number(btn.dataset.inboxProcess);
  const mode = btn.dataset.inboxMode;

  if (mode === "trash") {
    const item = state.summary?.recentItems?.find((i) => i.id === id);
    const confirmed = await showConfirm({
      title: "Descartar item?",
      message: `"${((item?.summaryPtBr) || "").slice(0, 80)}" sera eliminado.`,
      icon: "\ud83d\uddd1\ufe0f",
      okText: "Descartar",
      okClass: "danger"
    });
    if (!confirmed) return;
  }

  btn.disabled = true;
  const card = btn.closest(".item-card");
  if (card) card.classList.add("removing");

  try {
    await processInboxItemApi(id, { mode });
    const msgs = { actionable: "Marcado como tarefa", reference: "Arquivado como referencia", trash: "Descartado" };
    showToast(msgs[mode] || "Processado", "success", 2500);
    await new Promise((r) => setTimeout(r, 200));
    await load();
  } catch (err) {
    showToast(`Erro: ${err.message}`, "error");
    if (card) card.classList.remove("removing");
  } finally {
    btn.disabled = false;
  }
});

// ============================================================================
// Events: Edit button
// ============================================================================
document.addEventListener("click", (e) => {
  const editBtn = e.target.closest("[data-edit-id]");
  if (!editBtn) return;

  e.stopPropagation();
  const id = Number(editBtn.dataset.editId);
  const item = state.summary?.recentItems?.find((i) => i.id === id);
  if (!item) return;

  openEditModal(item);
});

// ============================================================================
// Events: Raw text toggle
// ============================================================================
document.addEventListener("click", (e) => {
  const toggle = e.target.closest("[data-raw-toggle]");
  if (!toggle) return;

  e.stopPropagation();
  const id = toggle.dataset.rawToggle;
  const content = document.getElementById(`raw-${id}`);
  if (content) {
    content.classList.toggle("visible");
    toggle.textContent = content.classList.contains("visible") ? "Ocultar original" : "Mensagem original";
  }
});

// ============================================================================
// Events: PDF preview toggle
// ============================================================================
document.addEventListener("click", (e) => {
  const toggle = e.target.closest("[data-pdf-toggle]");
  if (!toggle) return;

  e.stopPropagation();
  const id = toggle.dataset.pdfToggle;
  const wrapper = document.getElementById(`pdf-preview-${id}`);
  if (wrapper) {
    wrapper.classList.toggle("visible");
    toggle.textContent = wrapper.classList.contains("visible") ? "Ocultar previa" : "Mostrar previa";
  }
});

// ============================================================================
// Events: Image lightbox
// ============================================================================
document.addEventListener("click", (e) => {
  const trigger = e.target.closest(".lightbox-trigger");
  if (!trigger) return;

  e.stopPropagation();
  const src = trigger.dataset.lightboxSrc;
  if (!src) return;

  const lightbox = document.getElementById("image-lightbox");
  document.getElementById("lightbox-img").src = src;
  lightbox.showModal();
});

document.getElementById("lightbox-close").addEventListener("click", () => {
  document.getElementById("image-lightbox").close();
});

document.getElementById("image-lightbox").addEventListener("click", (e) => {
  if (e.target === e.currentTarget) {
    e.currentTarget.close();
  }
});

// ============================================================================
// Render single attachment from API data
// ============================================================================
function renderAttachment(att) {
  const url = att.url;
  const name = esc(att.fileName || "Arquivo");
  return renderAttachmentByType(url, att.inputType, `att-${att.id}`, name);
}

// ============================================================================
// Render attachment by type (works with any URL)
// ============================================================================
function renderAttachmentByType(url, inputType, uniqueId, name) {
  name = name || "Arquivo";
  const downloadUrl = url;

  if (inputType === "image") {
    return `
      <div class="file-attachment">
        <div class="file-header">
          <span class="file-icon">&#128247;</span>
          <span class="file-label">${esc(name)}</span>
          <a href="${downloadUrl}" download class="btn-file-open" title="Download">&#11015;</a>
          <a href="${url}" target="_blank" class="btn-file-open" title="Abrir em nova aba">&#8599;</a>
        </div>
        <div class="file-preview">
          <img src="${url}" alt="${esc(name)}" class="file-preview-img lightbox-trigger" loading="lazy" data-lightbox-src="${url}" />
        </div>
      </div>`;
  }
  if (inputType === "pdf") {
    return `
      <div class="file-attachment">
        <div class="file-header">
          <span class="file-icon">&#128196;</span>
          <span class="file-label">${esc(name)}</span>
          <a href="${downloadUrl}" download class="btn-file-open" title="Download">&#11015;</a>
          <a href="${url}" target="_blank" class="btn-file-open" title="Abrir PDF">&#8599;</a>
        </div>
      </div>`;
  }
  if (inputType === "audio") {
    return `
      <div class="file-attachment">
        <div class="file-header">
          <span class="file-icon">&#127911;</span>
          <span class="file-label">${esc(name)}</span>
          <a href="${downloadUrl}" download class="btn-file-open" title="Download">&#11015;</a>
        </div>
        <audio controls preload="none" class="file-audio-player">
          <source src="${url}" />
        </audio>
      </div>`;
  }
  return `
    <div class="file-attachment">
      <div class="file-header">
        <span class="file-icon">&#128206;</span>
        <span class="file-label">${esc(name)}</span>
        <a href="${downloadUrl}" download class="btn-file-open" title="Download">&#11015;</a>
        <a href="${url}" target="_blank" class="btn-file-open" title="Abrir">&#8599;</a>
      </div>
    </div>`;
}

// ============================================================================
// Auto-load attachments when card expands
// ============================================================================
async function loadAttachmentsForCard(itemId) {
  if (state.attachmentsCache[itemId]) return;
  try {
    const attachments = await fetchAttachments(itemId);
    if (attachments.length > 0) {
      state.attachmentsCache[itemId] = attachments;
      if (state.expandedId === itemId) {
        renderKanban(state.summary);
      }
    }
  } catch {
    // Silently fail — the fallback single-file render is already shown
  }
}

// ============================================================================
// Drag and Drop
// ============================================================================
document.addEventListener("dragstart", (e) => {
  const card = e.target.closest(".item-card[draggable]");
  if (!card) return;

  state.draggedId = Number(card.dataset.cardId);
  card.classList.add("dragging");
  e.dataTransfer.effectAllowed = "move";
  e.dataTransfer.setData("text/plain", card.dataset.cardId);
});

document.addEventListener("dragend", (e) => {
  const card = e.target.closest(".item-card[draggable]");
  if (card) card.classList.remove("dragging");
  state.draggedId = null;

  document.querySelectorAll(".kanban-column.drag-over").forEach((col) => col.classList.remove("drag-over"));
});

for (const colEl of document.querySelectorAll(".kanban-column")) {
  colEl.addEventListener("dragover", (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    colEl.classList.add("drag-over");
  });

  colEl.addEventListener("dragleave", (e) => {
    if (!colEl.contains(e.relatedTarget)) {
      colEl.classList.remove("drag-over");
    }
  });

  colEl.addEventListener("drop", async (e) => {
    e.preventDefault();
    colEl.classList.remove("drag-over");

    const cardId = Number(e.dataTransfer.getData("text/plain"));
    const newStatus = colEl.dataset.status;
    if (!cardId || !newStatus) return;

    // Don't allow drops to inbox column
    if (newStatus === "inbox") return;

    const item = state.summary?.recentItems?.find((i) => i.id === cardId);
    if (!item) return;

    const isFromInbox = state.inboxItemIds.has(cardId);
    if (!isFromInbox && item.status === newStatus) return;

    try {
      if (isFromInbox) {
        // Process inbox item based on target column
        const modeMap = { open: "actionable", done: "actionable", eliminated: "trash" };
        const mode = modeMap[newStatus] || "actionable";
        await processInboxItemApi(cardId, { mode });
        // If target is done, also mark as done after processing
        if (newStatus === "done") {
          await patchStatus(cardId, "done");
        }
      } else {
        await patchStatus(cardId, newStatus);
      }
      const statusMessages = {
        open: isFromInbox ? "Marcado como tarefa" : "Card reaberto",
        done: "Card marcado como resolvido",
        eliminated: isFromInbox ? "Descartado" : "Card eliminado"
      };
      showToast(statusMessages[newStatus] || "Status atualizado", "success", 2500);
      await load();
    } catch (err) {
      showToast(`Erro ao mover #${cardId}: ${err.message}`, "error");
    }
  });
}

// ============================================================================
// Edit modal
// ============================================================================
function openEditModal(item) {
  state.editingItem = item;

  document.getElementById("edit-card-id").textContent = `#${item.id}`;
  document.getElementById("edit-summary").value = item.summaryPtBr || "";
  document.getElementById("edit-action-title").value = item.actionTitle || "";
  document.getElementById("edit-priority").value = item.priority || "MEDIA";
  document.getElementById("edit-due").value = item.dueAt || "";
  document.getElementById("edit-next-step").value = item.nextStep || "";
  document.getElementById("edit-owner").value = item.followUpWith || "";

  const catSelect = document.getElementById("edit-category");
  let catHtml = "";
  for (const cat of state.categories) {
    const sel = cat.name === item.categoryName ? " selected" : "";
    catHtml += `<option value="${esc(cat.name)}"${sel}>${esc(cat.name)}</option>`;
  }
  catSelect.innerHTML = catHtml;

  editModal.showModal();
}

document.getElementById("modal-close").addEventListener("click", () => editModal.close());
document.getElementById("modal-cancel").addEventListener("click", () => editModal.close());

editForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!state.editingItem) return;

  const id = state.editingItem.id;
  const fields = {
    summaryPtBr: document.getElementById("edit-summary").value.trim(),
    actionTitle: document.getElementById("edit-action-title").value.trim().slice(0, 140),
    priority: document.getElementById("edit-priority").value,
    dueAt: document.getElementById("edit-due").value || null,
    nextStep: document.getElementById("edit-next-step").value.trim(),
    followUpWith: document.getElementById("edit-owner").value.trim(),
    categoryName: document.getElementById("edit-category").value
  };

  const saveBtn = document.getElementById("modal-save");
  saveBtn.disabled = true;
  saveBtn.textContent = "Salvando...";

  try {
    await patchItem(id, fields);
    editModal.close();
    showToast("Card atualizado", "success", 2500);
    await load();
  } catch (err) {
    showToast(`Erro ao salvar #${id}: ${err.message}`, "error");
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = "Salvar";
  }
});

// ============================================================================
// New Card modal
// ============================================================================
const newModal = document.getElementById("new-modal");
const newForm = document.getElementById("new-form");

document.getElementById("fab-new-card").addEventListener("click", () => {
  document.getElementById("new-summary").value = "";
  document.getElementById("new-action-title").value = "";
  document.getElementById("new-priority").value = "MEDIA";
  document.getElementById("new-due").value = "";
  document.getElementById("new-next-step").value = "";
  document.getElementById("new-owner").value = "";

  const catSelect = document.getElementById("new-category");
  let catHtml = "";
  for (const cat of state.categories) {
    catHtml += `<option value="${esc(cat.name)}">${esc(cat.name)}</option>`;
  }
  catSelect.innerHTML = catHtml;

  newModal.showModal();
  document.getElementById("new-summary").focus();
});

document.getElementById("new-modal-close").addEventListener("click", () => newModal.close());
document.getElementById("new-modal-cancel").addEventListener("click", () => newModal.close());

newForm.addEventListener("submit", async (e) => {
  e.preventDefault();

  const summaryPtBr = document.getElementById("new-summary").value.trim();
  if (!summaryPtBr) {
    document.getElementById("new-summary").focus();
    return;
  }

  const fields = {
    summaryPtBr,
    actionTitle: document.getElementById("new-action-title").value.trim().slice(0, 140) || undefined,
    priority: document.getElementById("new-priority").value,
    dueAt: document.getElementById("new-due").value || undefined,
    nextStep: document.getElementById("new-next-step").value.trim() || undefined,
    followUpWith: document.getElementById("new-owner").value.trim() || undefined,
    categoryName: document.getElementById("new-category").value || undefined
  };

  const saveBtn = document.getElementById("new-modal-save");
  saveBtn.disabled = true;
  saveBtn.textContent = "Criando...";

  try {
    await createItem(fields);
    newModal.close();
    showToast("Card criado com sucesso", "success", 2500);
    await load();
  } catch (err) {
    showToast(`Erro ao criar card: ${err.message}`, "error");
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = "Criar";
  }
});

// ============================================================================
// Voice Dictation (Web Speech API)
// ============================================================================
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

if (SpeechRecognition) {
  let activeRecognition = null;
  let activeBtn = null;

  document.addEventListener("click", (e) => {
    const micBtn = e.target.closest(".mic-btn");
    if (!micBtn) return;

    e.preventDefault();
    e.stopPropagation();

    const targetId = micBtn.dataset.micTarget;
    const textarea = document.getElementById(targetId);
    if (!textarea) return;

    if (activeBtn === micBtn && activeRecognition) {
      activeRecognition.stop();
      return;
    }

    if (activeRecognition) {
      activeRecognition.stop();
    }

    const recognition = new SpeechRecognition();
    recognition.lang = "pt-BR";
    recognition.continuous = true;
    recognition.interimResults = true;

    const baseText = textarea.value;

    recognition.onstart = () => {
      activeRecognition = recognition;
      activeBtn = micBtn;
      micBtn.classList.add("recording");
      micBtn.title = "Parar ditado";
    };

    let finalText = "";

    recognition.onresult = (event) => {
      let interim = "";
      finalText = "";
      for (let i = 0; i < event.results.length; i++) {
        if (event.results[i].isFinal) {
          finalText += event.results[i][0].transcript;
        } else {
          interim += event.results[i][0].transcript;
        }
      }
      const separator = baseText && !baseText.endsWith(" ") ? " " : "";
      textarea.value = baseText + separator + finalText + interim;
    };

    recognition.onend = () => {
      const separator = baseText && !baseText.endsWith(" ") ? " " : "";
      textarea.value = baseText + separator + finalText;
      activeRecognition = null;
      activeBtn = null;
      micBtn.classList.remove("recording");
      micBtn.title = "Ditar por voz";
    };

    recognition.onerror = (event) => {
      console.warn("Speech recognition error:", event.error);
      activeRecognition = null;
      activeBtn = null;
      micBtn.classList.remove("recording");
      micBtn.title = "Ditar por voz";
    };

    recognition.start();
  });
} else {
  document.querySelectorAll(".mic-btn").forEach((btn) => {
    btn.style.display = "none";
  });
}
