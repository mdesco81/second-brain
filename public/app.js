const statsNode = document.getElementById("stats");
const categoriesNode = document.getElementById("categories");
const recentNode = document.getElementById("recent");
const statTemplate = document.getElementById("stat-template");

function buildStat(label, value) {
  const fragment = statTemplate.content.cloneNode(true);
  fragment.querySelector(".label").textContent = label;
  fragment.querySelector(".value").textContent = String(value);
  return fragment;
}

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
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

  recentNode.innerHTML = summary.recentItems.length
    ? summary.recentItems
        .map((item) => {
          const badgeClass = item.status === "open" ? "badge warn" : "badge";
          const created = new Date(item.createdAt).toLocaleString("pt-BR");
          return `<li>
              <p class="meta">#${item.id} | ${escapeHtml(created)} | ${escapeHtml(item.inputType)} | ${escapeHtml(item.categoryName)}</p>
              <p class="title">${escapeHtml(item.summaryPtBr)}</p>
              <p class="meta">Acao: ${escapeHtml(item.action)} <span class="${badgeClass}">${escapeHtml(item.status)}</span></p>
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
