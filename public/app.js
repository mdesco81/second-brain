// --- DOM refs ---
const searchInput = document.getElementById("search");
const alertsNode = document.getElementById("alerts");
const statsNode = document.getElementById("stats");
const emptyNode = document.getElementById("empty-state");
const categoryFilter = document.getElementById("filter-category");
const editModal = document.getElementById("edit-modal");
const editForm = document.getElementById("edit-form");

const colOpen = document.getElementById("col-open");
const colDone = document.getElementById("col-done");
const colEliminated = document.getElementById("col-eliminated");
const countOpen = document.getElementById("count-open");
const countDone = document.getElementById("count-done");
const countEliminated = document.getElementById("count-eliminated");

const columns = { open: colOpen, done: colDone, eliminated: colEliminated };
const counts = { open: countOpen, done: countDone, eliminated: countEliminated };

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
  jarbasPreviewCache: {}
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
      ${previewHtml}
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
    document.getElementById("fab-new-card")
  ];

  const jarbasSection = document.getElementById("jarbas-view");

  if (tab === "brain") {
    for (const el of brainSections) {
      if (el) el.style.display = "";
    }
    jarbasSection.style.display = "none";
  } else {
    for (const el of brainSections) {
      if (el) el.style.display = "none";
    }
    jarbasSection.style.display = "block";
    if (!state.jarbasOutputs) loadJarbasOutputs();
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

  // PRIMARY: Action title (or summary fallback)
  const displayTitle = item.actionTitle || ((item.summaryPtBr || "").length > 80 ? (item.summaryPtBr || "").slice(0, 80) + "..." : (item.summaryPtBr || ""));
  const titleHtml = displayTitle ? `<h3 class="card-action-title">${esc(displayTitle)}</h3>` : "";

  // Quick hover actions (only for open cards)
  let hoverActions = "";
  if (item.status === "open") {
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

  // Collapsed meta
  const collapsedMeta = `<div class="card-meta-collapsed">
    <span class="tag category">${esc(item.categoryName)}</span>
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
          ${item.status === "open" ? `
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
      ${titleHtml}
      ${collapsedMeta}
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

  const grouped = { open: [], done: [], eliminated: [] };
  for (const item of items) {
    const bucket = grouped[item.status];
    if (bucket) {
      bucket.push(item);
    }
  }

  const totalFiltered = items.length;

  for (const status of ["open", "done", "eliminated"]) {
    const col = columns[status];
    const group = grouped[status];
    counts[status].textContent = group.length;

    if (group.length === 0) {
      const msgs = {
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
    const [summary, categories] = await Promise.all([fetchDashboard(), fetchCategories()]);
    state.summary = summary;
    state.categories = categories;
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
// Events: Search
// ============================================================================
let searchTimeout;
searchInput.addEventListener("input", () => {
  clearTimeout(searchTimeout);
  searchTimeout = setTimeout(() => {
    state.search = searchInput.value.trim();
    renderKanban(state.summary);
  }, 200);
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

    const item = state.summary?.recentItems?.find((i) => i.id === cardId);
    if (!item || item.status === newStatus) return;

    try {
      await patchStatus(cardId, newStatus);
      const statusMessages = {
        done: "Card marcado como resolvido",
        eliminated: "Card eliminado",
        open: "Card reaberto"
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
