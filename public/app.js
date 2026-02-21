// --- DOM refs ---
const searchInput = document.getElementById("search");
const alertsNode = document.getElementById("alerts");
const statsNode = document.getElementById("stats");
const cardsListNode = document.getElementById("cards-list");
const emptyNode = document.getElementById("empty-state");
const categoryFilter = document.getElementById("filter-category");
const editModal = document.getElementById("edit-modal");
const editForm = document.getElementById("edit-form");

// --- State ---
const state = {
  summary: null,
  categories: [],
  filterStatus: "open",
  filterPriority: "all",
  filterCategory: "all",
  search: "",
  expandedId: null,
  editingItem: null
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
  const chips = [];
  if (summary.alerts.overdue > 0) {
    chips.push(`<span class="alert-chip danger">${summary.alerts.overdue} atrasado${summary.alerts.overdue > 1 ? "s" : ""}</span>`);
  }
  if (summary.alerts.dueToday > 0) {
    chips.push(`<span class="alert-chip warn">${summary.alerts.dueToday} vence${summary.alerts.dueToday > 1 ? "m" : ""} hoje</span>`);
  }
  if (summary.alerts.missingOwner > 0) {
    chips.push(`<span class="alert-chip info">${summary.alerts.missingOwner} sem responsavel</span>`);
  }
  alertsNode.innerHTML = chips.join("");
}

// --- Render: Stats ---
function renderStats(summary) {
  const s = summary.statusBreakdown;
  statsNode.innerHTML = [
    `<span class="stat-pill"><span class="num">${summary.totalItems}</span> capturados</span>`,
    `<span class="stat-pill"><span class="num">${s.open}</span> abertos</span>`,
    `<span class="stat-pill"><span class="num">${s.done}</span> resolvidos</span>`,
    `<span class="stat-pill"><span class="num">${s.eliminated}</span> eliminados</span>`,
    `<span class="stat-pill"><span class="num">${summary.totalProjects}</span> projetos</span>`
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

// --- Render: Cards ---
function getFilteredItems(summary) {
  let items = summary.recentItems || [];

  // Status filter
  if (state.filterStatus !== "all") {
    items = items.filter((i) => i.status === state.filterStatus);
  }

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
      (i.categoryName || "").toLowerCase().includes(q) ||
      (i.nextStep || "").toLowerCase().includes(q) ||
      (i.followUpWith || "").toLowerCase().includes(q) ||
      String(i.id).includes(q)
    );
  }

  // Sort: open first, then by priority (ALTA > MEDIA > BAIXA), then by due date
  const priOrder = { ALTA: 3, MEDIA: 2, BAIXA: 1 };
  const statusOrder = { open: 3, done: 2, eliminated: 1 };
  items.sort((a, b) => {
    const sd = (statusOrder[b.status] || 0) - (statusOrder[a.status] || 0);
    if (sd !== 0) return sd;
    const pd = (priOrder[b.priority] || 0) - (priOrder[a.priority] || 0);
    if (pd !== 0) return pd;
    return new Date(b.createdAt) - new Date(a.createdAt);
  });

  return items;
}

function renderCard(item) {
  const isExpanded = state.expandedId === item.id;
  const expandedClass = isExpanded ? " expanded" : "";
  const statusClass = item.status;
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

  // Detail section
  const detail = `
    <div class="card-detail">
      ${item.nextStep ? `<div class="detail-row"><span class="detail-label">Proximo passo</span><span class="detail-value">${esc(item.nextStep)}</span></div>` : ""}
      ${item.followUpWith ? `<div class="detail-row"><span class="detail-label">Responsavel</span><span class="detail-value">${esc(item.followUpWith)}</span></div>` : ""}
      <div class="detail-row"><span class="detail-label">Acao</span><span class="detail-value">${esc(actionLabel(item.action))}</span></div>
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
    <article class="item-card ${statusClass} ${priClass}${expandedClass}" data-card-id="${item.id}">
      <div class="card-top">
        <p class="card-summary">${esc(item.summaryPtBr)}</p>
      </div>
      <div class="card-meta">
        <span class="tag id-tag">#${item.id}</span>
        <span class="tag priority-${item.priority}">${priorityLabel(item.priority)}</span>
        <span class="tag category">${esc(item.categoryName)}</span>
        ${dueTag}
      </div>
      ${detail}
    </article>
  `;
}

function renderCards(summary) {
  const items = getFilteredItems(summary);

  if (items.length === 0) {
    cardsListNode.innerHTML = "";
    emptyNode.style.display = "block";
    return;
  }

  emptyNode.style.display = "none";
  cardsListNode.innerHTML = items.map(renderCard).join("");
}

// --- Full render ---
function renderAll() {
  if (!state.summary) return;
  renderAlerts(state.summary);
  renderStats(state.summary);
  renderCategoryFilter(state.summary);
  renderCards(state.summary);
}

// --- Load data ---
async function load() {
  try {
    const [summary, categories] = await Promise.all([fetchDashboard(), fetchCategories()]);
    state.summary = summary;
    state.categories = categories;
    renderAll();
  } catch (error) {
    cardsListNode.innerHTML = `<div class="empty-state">Erro ao carregar: ${esc(String(error))}</div>`;
  }
}

load();
setInterval(load, 30000);

// --- Events: Filters ---
document.addEventListener("click", (e) => {
  const statusChip = e.target.closest("[data-filter-status]");
  if (statusChip) {
    state.filterStatus = statusChip.dataset.filterStatus;
    document.querySelectorAll("[data-filter-status]").forEach((b) => b.classList.remove("active"));
    statusChip.classList.add("active");
    renderCards(state.summary);
    return;
  }

  const priChip = e.target.closest("[data-filter-priority]");
  if (priChip) {
    state.filterPriority = priChip.dataset.filterPriority;
    document.querySelectorAll("[data-filter-priority]").forEach((b) => b.classList.remove("active"));
    priChip.classList.add("active");
    renderCards(state.summary);
    return;
  }

  // Expand/collapse card
  const card = e.target.closest(".item-card");
  if (card && !e.target.closest("button")) {
    const id = Number(card.dataset.cardId);
    state.expandedId = state.expandedId === id ? null : id;
    renderCards(state.summary);
    return;
  }
});

// --- Events: Category filter ---
categoryFilter.addEventListener("change", () => {
  state.filterCategory = categoryFilter.value;
  renderCards(state.summary);
});

// --- Events: Search ---
let searchTimeout;
searchInput.addEventListener("input", () => {
  clearTimeout(searchTimeout);
  searchTimeout = setTimeout(() => {
    state.search = searchInput.value.trim();
    renderCards(state.summary);
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
