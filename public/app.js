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
  draggedId: null
};

// --- Helpers ---
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

// --- API ---
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

// --- Render: Alerts ---
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

// --- Render: Stats ---
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

// --- Render: Category filter ---
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

// --- Filter items ---
function getFilteredItems(summary) {
  let items = summary.recentItems || [];

  // Priority filter
  if (state.filterPriority !== "all") {
    items = items.filter((i) => i.priority === state.filterPriority);
  }

  // Category filter
  if (state.filterCategory !== "all") {
    items = items.filter((i) => i.categoryName === state.filterCategory);
  }

  // Search
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

  // Sort: priority (ALTA > MEDIA > BAIXA), then by due date, then newest
  const priOrder = { ALTA: 3, MEDIA: 2, BAIXA: 1 };
  items.sort((a, b) => {
    const pd = (priOrder[b.priority] || 0) - (priOrder[a.priority] || 0);
    if (pd !== 0) return pd;
    // Due date: items with due date first, earliest first
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

// --- Render: Single Card ---
function renderCard(item) {
  const isExpanded = state.expandedId === item.id;
  const expandedClass = isExpanded ? " expanded" : "";
  const priClass = `pri-${item.priority}`;

  // Due tag
  let dueTag = "";
  if (item.dueAt) {
    const d = daysFromNow(item.dueAt);
    if (d !== null && d < 0) {
      dueTag = `<span class="tag overdue">Atrasado ${Math.abs(d)}d</span>`;
    } else if (d === 0) {
      dueTag = `<span class="tag overdue">Vence hoje</span>`;
    } else if (d !== null) {
      dueTag = `<span class="tag due">${item.dueAt}</span>`;
    }
  }

  // PRIMARY: Action title (what to do)
  const actionTitle = item.actionTitle
    ? `<h3 class="card-action-title">${esc(item.actionTitle)}</h3>`
    : "";

  // SECONDARY: AI interpretation
  const interpretation = item.summaryPtBr
    ? `<p class="card-interpretation">${esc(item.summaryPtBr)}</p>`
    : "";

  // Key info visible without expand
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

  // Raw text reference (shown in expanded detail)
  const hasRawText = item.rawText && item.rawText.trim() && item.rawText.trim() !== item.summaryPtBr?.trim();
  const rawTextSection = hasRawText
    ? `<button type="button" class="raw-text-toggle" data-raw-toggle="${item.id}">Mensagem original</button>
       <div class="raw-text-content" id="raw-${item.id}">${esc(item.rawText)}</div>`
    : "";

  // Detail section (expanded)
  const detail = `
    <div class="card-detail">
      ${rawTextSection}
      ${item.actionDetails ? `<div class="detail-row"><span class="detail-label">Detalhes</span><span class="detail-value">${esc(item.actionDetails)}</span></div>` : ""}
      <div class="detail-row"><span class="detail-label">Tipo</span><span class="detail-value">${esc(actionLabel(item.action))}</span></div>
      <div class="detail-row"><span class="detail-label">Criado</span><span class="detail-value">${new Date(item.createdAt).toLocaleString("pt-BR")}</span></div>
      ${item.processingError ? `<div class="detail-row"><span class="detail-label" style="color:var(--danger)">Erro</span><span class="detail-value" style="color:var(--danger)">${esc(item.processingError)}</span></div>` : ""}
      <div class="card-actions">
        ${item.status === "open" ? `
          <button class="btn edit" data-edit-id="${item.id}">Editar</button>
          <button class="btn success" data-status-id="${item.id}" data-status="done">Resolver</button>
          <button class="btn danger" data-status-id="${item.id}" data-status="eliminated">Eliminar</button>
        ` : `
          <button class="btn secondary" data-status-id="${item.id}" data-status="open">Reabrir</button>
        `}
      </div>
    </div>
  `;

  return `
    <article class="item-card ${priClass}${expandedClass}" draggable="true" data-card-id="${item.id}" data-card-status="${item.status}">
      ${actionTitle}
      ${interpretation}
      ${keyInfo}
      <div class="card-meta">
        <span class="tag id-tag">#${item.id}</span>
        <span class="tag priority-${item.priority}">${priorityLabel(item.priority)}</span>
        <span class="tag category">${esc(item.categoryName)}</span>
        <span class="tag type-tag">${inputTypeLabel(item.inputType)}</span>
        ${dueTag}
      </div>
      ${detail}
    </article>
  `;
}

// --- Render: Kanban ---
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
      col.innerHTML = `<div class="empty-state" style="padding:20px 10px;font-size:0.78rem">Nenhum card</div>`;
    } else {
      col.innerHTML = group.map(renderCard).join("");
    }
  }

  emptyNode.style.display = totalFiltered === 0 ? "block" : "none";
}

// --- Full render ---
function renderAll() {
  if (!state.summary) return;
  renderAlerts(state.summary);
  renderStats(state.summary);
  renderCategoryFilter(state.summary);
  renderKanban(state.summary);
}

// --- Load data ---
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
      colOpen.innerHTML = `<div class="empty-state">Erro ao carregar: ${esc(String(error))}</div>`;
    }
  } finally {
    state.loading = false;
  }
}

load();
setInterval(load, 30000);

// --- Events: Filters ---
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
  if (card && !e.target.closest("button")) {
    const id = Number(card.dataset.cardId);
    state.expandedId = state.expandedId === id ? null : id;
    renderKanban(state.summary);
    return;
  }
});

// --- Events: Category filter ---
categoryFilter.addEventListener("change", () => {
  state.filterCategory = categoryFilter.value;
  renderKanban(state.summary);
});

// --- Events: Search ---
let searchTimeout;
searchInput.addEventListener("input", () => {
  clearTimeout(searchTimeout);
  searchTimeout = setTimeout(() => {
    state.search = searchInput.value.trim();
    renderKanban(state.summary);
  }, 200);
});

// --- Events: Status buttons ---
document.addEventListener("click", async (e) => {
  const statusBtn = e.target.closest("[data-status-id]");
  if (!statusBtn) return;

  e.stopPropagation();
  const id = Number(statusBtn.dataset.statusId);
  const status = statusBtn.dataset.status;
  statusBtn.disabled = true;

  try {
    await patchStatus(id, status);
    await load();
  } catch (err) {
    alert(`Erro ao atualizar #${id}: ${err}`);
  } finally {
    statusBtn.disabled = false;
  }
});

// --- Events: Edit button ---
document.addEventListener("click", (e) => {
  const editBtn = e.target.closest("[data-edit-id]");
  if (!editBtn) return;

  e.stopPropagation();
  const id = Number(editBtn.dataset.editId);
  const item = state.summary?.recentItems?.find((i) => i.id === id);
  if (!item) return;

  openEditModal(item);
});

// --- Events: Raw text toggle ---
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

// --- Drag and Drop ---
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

  // Remove all drag-over highlights
  document.querySelectorAll(".kanban-column.drag-over").forEach((col) => col.classList.remove("drag-over"));
});

// Allow drop on kanban columns
for (const colEl of document.querySelectorAll(".kanban-column")) {
  colEl.addEventListener("dragover", (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    colEl.classList.add("drag-over");
  });

  colEl.addEventListener("dragleave", (e) => {
    // Only remove if leaving the column itself
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

    // Find the item to check current status
    const item = state.summary?.recentItems?.find((i) => i.id === cardId);
    if (!item || item.status === newStatus) return;

    try {
      await patchStatus(cardId, newStatus);
      await load();
    } catch (err) {
      alert(`Erro ao mover #${cardId}: ${err}`);
    }
  });
}

// --- Edit modal ---
function openEditModal(item) {
  state.editingItem = item;

  document.getElementById("edit-card-id").textContent = `#${item.id}`;
  document.getElementById("edit-summary").value = item.summaryPtBr || "";
  document.getElementById("edit-action-title").value = item.actionTitle || "";
  document.getElementById("edit-priority").value = item.priority || "MEDIA";
  document.getElementById("edit-due").value = item.dueAt || "";
  document.getElementById("edit-next-step").value = item.nextStep || "";
  document.getElementById("edit-owner").value = item.followUpWith || "";

  // Populate category dropdown
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
    actionTitle: document.getElementById("edit-action-title").value.trim(),
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
    await load();
  } catch (err) {
    alert(`Erro ao salvar #${id}: ${err}`);
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = "Salvar";
  }
});
