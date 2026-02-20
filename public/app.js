const statsNode = document.getElementById("stats");
const workflowNode = document.getElementById("workflow");
const categoriesNode = document.getElementById("categories");
const captureBreakdownNode = document.getElementById("capture-breakdown");
const recentNode = document.getElementById("recent");
const weeklyMetaNode = document.getElementById("weekly-meta");
const weeklyDebriefNode = document.getElementById("weekly-debrief");
const kanbanHighNode = document.getElementById("kanban-high");
const kanbanMediumNode = document.getElementById("kanban-medium");
const kanbanLowNode = document.getElementById("kanban-low");
const statTemplate = document.getElementById("stat-template");
const workflowTemplate = document.getElementById("workflow-template");
const filtersNode = document.getElementById("recent-filters");

const state = {
  recentFilter: "all",
  summary: null
};

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function buildStat(label, value, hint) {
  const fragment = statTemplate.content.cloneNode(true);
  fragment.querySelector(".label").textContent = label;
  fragment.querySelector(".value").textContent = String(value);
  fragment.querySelector(".hint").textContent = hint;
  return fragment;
}

function buildWorkflowStep(label, value) {
  const fragment = workflowTemplate.content.cloneNode(true);
  fragment.querySelector(".step-label").textContent = label;
  fragment.querySelector(".step-value").textContent = String(value);
  return fragment;
}

function statusLabel(status) {
  if (status === "done") {
    return "resolvido";
  }
  if (status === "eliminated") {
    return "eliminado";
  }
  return "aberto";
}

function statusButtons(id, status) {
  if (status === "open") {
    return `<div class="actions">
      <button type="button" class="btn-action success" data-item-id="${id}" data-next-status="done">Resolver</button>
      <button type="button" class="btn-action danger" data-item-id="${id}" data-next-status="eliminated">Eliminar</button>
    </div>`;
  }

  return `<div class="actions">
    <button type="button" class="btn-action" data-item-id="${id}" data-next-status="open">Reabrir</button>
  </div>`;
}

function renderStats(summary) {
  statsNode.innerHTML = "";
  statsNode.append(
    buildStat("Capturados", summary.totalItems, "Entradas totais"),
    buildStat("Abertos", summary.statusBreakdown.open, "Itens em andamento"),
    buildStat("Resolvidos", summary.statusBreakdown.done, "Concluídos"),
    buildStat("Eliminados", summary.statusBreakdown.eliminated, "Descartados")
  );
}

function renderWorkflow(summary) {
  workflowNode.innerHTML = "";
  workflowNode.append(
    buildWorkflowStep("1. Captura", summary.workflow.captured),
    buildWorkflowStep("2. Classificação", summary.workflow.classified),
    buildWorkflowStep("3. Ações definidas", summary.workflow.actionable),
    buildWorkflowStep("4. Resolvidos", summary.workflow.resolved),
    buildWorkflowStep("5. Eliminados", summary.workflow.eliminated)
  );
}

function renderCategories(summary) {
  categoriesNode.innerHTML = summary.categories.length
    ? summary.categories
        .map((category) => `<li><p class="meta">${escapeHtml(category.total)} registros</p><p class="title">${escapeHtml(category.name)}</p></li>`)
        .join("")
    : "<li>Nenhuma categoria registrada.</li>";
}

function renderCaptureBreakdown(summary) {
  captureBreakdownNode.innerHTML = summary.captureBreakdown.length
    ? summary.captureBreakdown
        .map((item) => `<li><p class="meta">${escapeHtml(item.inputType)}</p><p class="title">${escapeHtml(item.total)} itens</p></li>`)
        .join("")
    : "<li>Nenhuma captura registrada.</li>";
}

function renderWeeklyDebrief(summary) {
  if (!summary.latestWeeklyDebrief) {
    weeklyMetaNode.textContent = "Sem debrief semanal ainda.";
    weeklyDebriefNode.textContent = "O debrief aparece aqui após o envio automático de domingo.";
    return;
  }

  const sentAt = new Date(summary.latestWeeklyDebrief.sentAt).toLocaleString("pt-BR");
  weeklyMetaNode.textContent = `Último envio: ${sentAt}`;
  weeklyDebriefNode.textContent = summary.latestWeeklyDebrief.message;
}

function renderKanbanColumn(node, items) {
  node.innerHTML = items.length
    ? items
        .map((item) => {
          const due = item.dueAt ? ` | prazo ${escapeHtml(item.dueAt)}` : "";
          const followUp = item.followUpWith ? `<p class="meta">Quem cobrar/procurar: ${escapeHtml(item.followUpWith)}</p>` : "";
          const nextStep = item.nextStep ? `<p class="meta">Proximo passo: ${escapeHtml(item.nextStep)}</p>` : "";
          return `<li>
            <p class="meta">#${item.id} | ${escapeHtml(item.categoryName)} | ${escapeHtml(item.action)}${due}</p>
            <p class="title">${escapeHtml(item.summaryPtBr)}</p>
            ${followUp}
            ${nextStep}
            ${statusButtons(item.id, "open")}
          </li>`;
        })
        .join("")
    : "<li>Sem itens nesta coluna.</li>";
}

function filteredRecentItems(summary) {
  if (state.recentFilter === "all") {
    return summary.recentItems;
  }
  return summary.recentItems.filter((item) => item.status === state.recentFilter);
}

function renderRecent(summary) {
  const rows = filteredRecentItems(summary);
  recentNode.innerHTML = rows.length
    ? rows
        .map((item) => {
          const created = new Date(item.createdAt).toLocaleString("pt-BR");
          const due = item.dueAt ? ` | prazo ${escapeHtml(item.dueAt)}` : "";
          const nextStep = item.nextStep ? `<p class="meta">Proximo passo: ${escapeHtml(item.nextStep)}</p>` : "";
          const followUp = item.followUpWith ? `<p class="meta">Quem cobrar/procurar: ${escapeHtml(item.followUpWith)}</p>` : "";
          return `<li>
            <p class="meta">#${item.id} | ${escapeHtml(created)} | ${escapeHtml(item.inputType)} | ${escapeHtml(item.categoryName)}</p>
            <p class="title">${escapeHtml(item.summaryPtBr)}</p>
            <p class="meta">
              Ação: ${escapeHtml(item.action)} | Prioridade: ${escapeHtml(item.priority)}${due}
              <span class="badge ${escapeHtml(item.status)}">${escapeHtml(statusLabel(item.status))}</span>
            </p>
            ${nextStep}
            ${followUp}
            ${statusButtons(item.id, item.status)}
          </li>`;
        })
        .join("")
    : "<li>Nenhum item para este filtro.</li>";
}

function renderDashboard(summary) {
  state.summary = summary;
  renderStats(summary);
  renderWorkflow(summary);
  renderCategories(summary);
  renderCaptureBreakdown(summary);
  renderWeeklyDebrief(summary);
  renderKanbanColumn(kanbanHighNode, summary.kanban.high);
  renderKanbanColumn(kanbanMediumNode, summary.kanban.medium);
  renderKanbanColumn(kanbanLowNode, summary.kanban.low);
  renderRecent(summary);
}

async function updateItemStatus(id, status) {
  const response = await fetch(`/api/actions/${id}/status`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ status })
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
}

async function loadDashboard() {
  try {
    const response = await fetch("/api/dashboard");
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const payload = await response.json();
    renderDashboard(payload);
  } catch (error) {
    recentNode.innerHTML = `<li>Falha ao carregar dashboard: ${escapeHtml(String(error))}</li>`;
  }
}

loadDashboard();
setInterval(loadDashboard, 30000);

document.addEventListener("click", async (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) {
    return;
  }

  const filterButton = target.closest(".filter-btn");
  if (filterButton instanceof HTMLButtonElement) {
    state.recentFilter = filterButton.dataset.filter || "all";
    if (filtersNode) {
      for (const button of filtersNode.querySelectorAll(".filter-btn")) {
        button.classList.remove("active");
      }
    }
    filterButton.classList.add("active");
    if (state.summary) {
      renderRecent(state.summary);
    }
    return;
  }

  const actionButton = target.closest(".btn-action");
  if (!(actionButton instanceof HTMLButtonElement)) {
    return;
  }

  const id = Number(actionButton.dataset.itemId);
  const nextStatus = actionButton.dataset.nextStatus;
  if (!Number.isInteger(id) || !nextStatus) {
    return;
  }

  actionButton.disabled = true;
  try {
    await updateItemStatus(id, nextStatus);
    await loadDashboard();
  } catch (error) {
    window.alert(`Falha ao atualizar item #${id}: ${String(error)}`);
  } finally {
    actionButton.disabled = false;
  }
});
