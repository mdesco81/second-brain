const statsNode = document.getElementById("stats");
const categoriesNode = document.getElementById("categories");
const focusNode = document.getElementById("focus");
const recentNode = document.getElementById("recent");
const kanbanHighNode = document.getElementById("kanban-high");
const kanbanMediumNode = document.getElementById("kanban-medium");
const kanbanLowNode = document.getElementById("kanban-low");
const statTemplate = document.getElementById("stat-template");

function buildStat(label, value) {
  const fragment = statTemplate.content.cloneNode(true);
  fragment.querySelector(".label").textContent = label;
  fragment.querySelector(".value").textContent = String(value);
  return fragment;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
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

function renderDashboard(summary) {
  statsNode.innerHTML = "";
  statsNode.append(
    buildStat("Itens capturados", summary.totalItems),
    buildStat("Acoes abertas", summary.openActions),
    buildStat("Projetos ativos", summary.totalProjects)
  );

  categoriesNode.innerHTML = summary.categories.length
    ? summary.categories
        .map(
          (category) =>
            `<li><p class="meta">${escapeHtml(category.total)} registros</p><p class="title">${escapeHtml(category.name)}</p></li>`
        )
        .join("")
    : "<li>Nenhuma categoria registrada ainda.</li>";

  focusNode.innerHTML = summary.focusItems.length
    ? summary.focusItems
        .map((item) => {
          const due = item.dueAt ? ` | prazo ${escapeHtml(item.dueAt)}` : "";
          const followUp = item.followUpWith ? `<p class="meta">Quem cobrar/procurar: ${escapeHtml(item.followUpWith)}</p>` : "";
          return `<li>
              <p class="meta">#${item.id} | ${escapeHtml(item.categoryName)} | ${escapeHtml(item.action)}</p>
              <p class="title">[${escapeHtml(item.priority)}] ${escapeHtml(item.summaryPtBr)}</p>
              <p class="meta">${due}</p>
              ${followUp}
            </li>`;
        })
        .join("")
    : "<li>Nenhuma prioridade aberta.</li>";

  renderKanbanColumn(kanbanHighNode, summary.kanban.high);
  renderKanbanColumn(kanbanMediumNode, summary.kanban.medium);
  renderKanbanColumn(kanbanLowNode, summary.kanban.low);

  recentNode.innerHTML = summary.recentItems.length
    ? summary.recentItems
        .map((item) => {
          const badgeClass = item.status === "open" ? "badge warn" : "badge";
          const created = new Date(item.createdAt).toLocaleString("pt-BR");
          return `<li>
              <p class="meta">#${item.id} | ${escapeHtml(created)} | ${escapeHtml(item.inputType)} | ${escapeHtml(item.categoryName)}</p>
              <p class="title">${escapeHtml(item.summaryPtBr)}</p>
              <p class="meta">Acao: ${escapeHtml(item.action)} | Prioridade: ${escapeHtml(item.priority)} <span class="${badgeClass}">${escapeHtml(item.status)}</span></p>
              ${statusButtons(item.id, item.status)}
            </li>`;
        })
        .join("")
    : "<li>Nenhum item ainda.</li>";
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

  const button = target.closest(".btn-action");
  if (!(button instanceof HTMLButtonElement)) {
    return;
  }

  const id = Number(button.dataset.itemId);
  const nextStatus = button.dataset.nextStatus;
  if (!Number.isInteger(id) || !nextStatus) {
    return;
  }

  button.disabled = true;
  try {
    await updateItemStatus(id, nextStatus);
    await loadDashboard();
  } catch (error) {
    alert(`Falha ao atualizar item #${id}: ${String(error)}`);
  } finally {
    button.disabled = false;
  }
});
