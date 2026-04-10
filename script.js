const API_URL = `${location.protocol}//${location.hostname}:5000`;

let candidates = [];
let selectedId = null;
let activeAreaFilter = "";

const COLORS = [
  { bg: "#e3edf8", txt: "#1a3d6b" },
  { bg: "#e4f2e4", txt: "#1a5c1a" },
  { bg: "#fdf0d8", txt: "#7a4a00" },
  { bg: "#fce8e8", txt: "#7a1f1f" },
  { bg: "#ede8f8", txt: "#3a1f7a" },
  { bg: "#e8f5e4", txt: "#1a5c2a" },
  { bg: "#fde8f0", txt: "#7a1f4a" },
];

// ─── API helpers ───────────────────────────────────────────────────────────
async function apiFetch(path, opts = {}) {
  const res = await fetch(API_URL + path, {
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  const data = await res.json();
  if (!res.ok)
    throw new Error(data.error || `Erro ${res.status}`);
  return data;
}

async function loadCandidates() {
  try {
    candidates = await apiFetch("/candidates");
  } catch (e) {
    candidates = [];
  }
}

// ─── Verificação do servidor ───────────────────────────────────────────────
async function checkServer() {
  const dot = document.getElementById("status-dot");
  const text = document.getElementById("status-text");
  try {
    const res = await fetch(`${API_URL}/health`, {
      signal: AbortSignal.timeout(2000),
    });
    if (res.ok) {
      dot.className = "status-dot online";
      text.textContent = "Servidor online";
      return true;
    }
  } catch (e) {}
  dot.className = "status-dot offline";
  text.textContent = "Servidor offline";
  return false;
}
checkServer();
setInterval(checkServer, 10000);

// ─── Navegação ─────────────────────────────────────────────────────────────
function showPanel(p) {
  ["add", "list", "stats", "setup"].forEach((id) => {
    const panel = document.getElementById("panel-" + id);
    const nav = document.getElementById("nav-" + id);

    if (panel) {
      panel.classList.toggle("active", id === p);
    }

    if (nav) {
      nav.classList.toggle("active", id === p);
    }
  });

  if (p === "list") {
    loadCandidates().then(() => {
      renderAreaFilters();
      renderList();
    });
  }

  if (p === "stats") {
    loadCandidates().then(renderStats);
  }
}

// ─── Upload ────────────────────────────────────────────────────────────────
function onDrag(e, over) {
  e.preventDefault();
  document
    .getElementById("upload-zone")
    .classList.toggle("drag", over);
}
function onDrop(e) {
  e.preventDefault();
  onDrag(e, false);
  const f = e.dataTransfer.files[0];
  if (f) handleFile(f);
}

function setProgress(msg, spin = false) {
  const el = document.getElementById("upload-progress");
  el.innerHTML = spin
    ? `<span class="spinner"></span>${msg}`
    : msg;
}

async function handleFile(file) {
  if (!file || file.type !== "application/pdf") {
    showMsg(
      "error",
      "Por favor, envie um arquivo PDF válido.",
    );
    return;
  }

  const online = await checkServer();
  if (!online) {
    showMsg(
      "error",
      'Servidor offline. Inicie o app.py e tente novamente. Veja a aba "Configurar".',
    );
    return;
  }

  const zone = document.getElementById("upload-zone");
  zone.classList.add("loading");
  document.getElementById("upload-title").textContent =
    file.name;
  document.getElementById("upload-sub").textContent =
    "Processando...";
  setProgress("Extraindo dados do PDF...", true);
  hideMessages();

  try {
    const formData = new FormData();
    formData.append("file", file);
    const res = await fetch(`${API_URL}/parse`, {
      method: "POST",
      body: formData,
    });
    const data = await res.json();
    if (!res.ok)
      throw new Error(data.error || `Erro ${res.status}`);
    fillForm(data);
    setProgress("");
    document.getElementById("upload-sub").textContent =
      "PDF processado com sucesso";
    zone.classList.remove("loading");
    showMsg("ai");
  } catch (err) {
    zone.classList.remove("loading");
    document.getElementById("upload-title").textContent =
      "Enviar currículo em PDF";
    document.getElementById("upload-sub").textContent =
      "Clique ou arraste o arquivo aqui";
    setProgress("");
    showMsg("error", "Erro: " + err.message);
    document.getElementById("pdf-input").value = "";
  }
}

function fillForm(d) {
  [
    ["f-nome", d.nome],
    ["f-email", d.email],
    ["f-tel", d.telefone],
    ["f-cargo", d.cargo],
    ["f-obs", d.resumo],
  ].forEach(([id, val]) => {
    const el = document.getElementById(id);
    if (val) {
      el.value = val;
      el.classList.add("ai-filled");
    }
  });
  const areaOpts = [
    "Tecnologia",
    "Marketing",
    "Vendas",
    "RH",
    "Financeiro",
    "Operações",
    "Administrativo",
    "Outro",
  ];
  if (d.area && areaOpts.includes(d.area))
    document.getElementById("f-area").value = d.area;
  const nivelOpts = [
    "Estagiário",
    "Júnior",
    "Pleno",
    "Sênior",
    "Especialista",
    "Gerencial",
  ];
  if (d.nivel && nivelOpts.includes(d.nivel))
    document.getElementById("f-nivel").value = d.nivel;
}

// ─── Mensagens ─────────────────────────────────────────────────────────────
function showMsg(type, text) {
  hideMessages();
  const map = {
    ai: "msg-ai",
    success: "msg-success",
    error: "msg-error",
  };
  const el = document.getElementById(map[type]);
  if (text) el.textContent = text;
  el.style.display = "block";
}
function hideMessages() {
  ["msg-ai", "msg-success", "msg-error"].forEach(
    (id) =>
      (document.getElementById(id).style.display = "none"),
  );
}

// ─── Form ──────────────────────────────────────────────────────────────────
async function addCandidate() {
  const nome = document
    .getElementById("f-nome")
    .value.trim();
  const cargo = document
    .getElementById("f-cargo")
    .value.trim();
  if (!nome || !cargo) {
    alert("Nome e cargo são obrigatórios.");
    return;
  }
  try {
    await apiFetch("/candidates", {
      method: "POST",
      body: JSON.stringify({
        nome,
        cargo,
        area: document.getElementById("f-area").value,
        nivel: document.getElementById("f-nivel").value,
        tel: document.getElementById("f-tel").value.trim(),
        email: document
          .getElementById("f-email")
          .value.trim(),
        status: document.getElementById("f-status").value,
        data: document.getElementById("f-data").value,
        obs: document.getElementById("f-obs").value.trim(),
      }),
    });
    clearForm();
    showMsg("success", "Candidato adicionado com sucesso!");
    setTimeout(hideMessages, 2500);
  } catch (e) {
    showMsg("error", "Erro ao salvar: " + e.message);
  }
}

function clearForm() {
  [
    "f-nome",
    "f-tel",
    "f-email",
    "f-cargo",
    "f-obs",
  ].forEach((id) => {
    const el = document.getElementById(id);
    el.value = "";
    el.classList.remove("ai-filled");
  });
  ["f-area", "f-nivel"].forEach(
    (id) => (document.getElementById(id).value = ""),
  );
  document.getElementById("f-status").value = "Novo";
  document.getElementById("f-data").value = new Date()
    .toISOString()
    .slice(0, 10);
  document.getElementById("upload-title").textContent =
    "Enviar currículo em PDF";
  document.getElementById("upload-sub").textContent =
    "Clique ou arraste — parser local, sem custo de API";
  document
    .getElementById("upload-zone")
    .classList.remove("loading", "drag");
  document.getElementById("pdf-input").value = "";
  hideMessages();
}

// ─── Lista ─────────────────────────────────────────────────────────────────
function getInitials(n) {
  return n
    .split(" ")
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();
}
function statusBadge(s) {
  const m = {
    Novo: "badge-blue",
    "Em análise": "badge-amber",
    Aprovado: "badge-green",
    Descartado: "badge-gray",
  };
  return `<span class="badge ${m[s] || "badge-gray"}">${s}</span>`;
}
function fmtDate(d) {
  if (!d) return "";
  const [y, m, day] = d.split("-");
  return `${day}/${m}/${y}`;
}

function renderAreaFilters() {
  const areas = [
    ...new Set(
      candidates.map((c) => c.area).filter(Boolean),
    ),
  ];
  document.getElementById("area-filters").innerHTML =
    `<button class="chip ${activeAreaFilter === "" ? "active" : ""}" onclick="setAreaFilter('')">Todas</button>` +
    areas
      .map(
        (a) =>
          `<button class="chip ${activeAreaFilter === a ? "active" : ""}" onclick="setAreaFilter('${a}')">${a}</button>`,
      )
      .join("");
}
function setAreaFilter(a) {
  activeAreaFilter = a;
  renderAreaFilters();
  renderList();
}

function renderList() {
  const q = (
    document.getElementById("search-input").value || ""
  ).toLowerCase();
  const st = document.getElementById("filter-status").value;
  const filtered = candidates.filter((c) => {
    const m =
      c.nome.toLowerCase().includes(q) ||
      c.cargo.toLowerCase().includes(q) ||
      (c.area || "").toLowerCase().includes(q);
    return (
      m &&
      (!st || c.status === st) &&
      (!activeAreaFilter || c.area === activeAreaFilter)
    );
  });
  document.getElementById("count-label").textContent =
    `${filtered.length} candidato${filtered.length !== 1 ? "s" : ""} encontrado${filtered.length !== 1 ? "s" : ""}`;
  const div = document.getElementById("candidate-list");
  if (!filtered.length) {
    div.innerHTML = `<div class="empty">${candidates.length ? "Nenhum encontrado." : "Nenhum candidato cadastrado ainda."}</div>`;
    return;
  }
  div.innerHTML = filtered
    .map((c, i) => {
      const av = COLORS[i % COLORS.length];
      return `<div class="candidate-card" onclick="openModal(${c.id})">
        <div class="avatar" style="background:${av.bg};color:${av.txt}">${getInitials(c.nome)}</div>
        <div class="info">
          <div class="info-name">${c.nome}</div>
          <div class="info-sub">${c.cargo}${c.area ? " · " + c.area : ""}${c.nivel ? " · " + c.nivel : ""}</div>
          <div class="info-tags">${statusBadge(c.status)}${c.data ? `<span class="badge badge-gray">${fmtDate(c.data)}</span>` : ""}</div>
        </div>
      </div>`;
    })
    .join("");
}

// ─── Modal ─────────────────────────────────────────────────────────────────
function openModal(id) {
  selectedId = id;
  const c = candidates.find((x) => x.id === id);
  if (!c) return;
  const av = COLORS[candidates.indexOf(c) % COLORS.length];
  document.getElementById("modal-title").textContent =
    c.nome;
  const rows = [
    ["Cargo", c.cargo],
    ["Área", c.area || "—"],
    ["Nível", c.nivel || "—"],
    ["Telefone", c.tel || "—"],
    ["E-mail", c.email || "—"],
    ["Recebido", c.data ? fmtDate(c.data) : "—"],
    ["Observações", c.obs || "—"],
  ];
  document.getElementById("modal-body").innerHTML =
    `<div style="display:flex;align-items:center;gap:12px;margin-bottom:1rem;">
        <div class="avatar" style="background:${av.bg};color:${av.txt}">${getInitials(c.nome)}</div>
        <div>${statusBadge(c.status)}</div>
      </div>` +
    rows
      .map(
        ([l, v]) =>
          `<div class="detail-row"><span class="detail-label">${l}</span><span class="detail-value">${v}</span></div>`,
      )
      .join("");
  document.getElementById("modal-status").value = c.status;
  document.getElementById("modal").classList.add("open");
}
function closeModal() {
  document.getElementById("modal").classList.remove("open");
  selectedId = null;
}
document
  .getElementById("modal")
  .addEventListener("click", (e) => {
    if (e.target === document.getElementById("modal"))
      closeModal();
  });

async function updateStatus() {
  const c = candidates.find((x) => x.id === selectedId);
  if (c) {
    try {
      await apiFetch(`/candidates/${selectedId}`, {
        method: "PUT",
        body: JSON.stringify({
          status:
            document.getElementById("modal-status").value,
        }),
      });
    } catch (e) {
      alert("Erro ao atualizar: " + e.message);
      return;
    }
  }
  closeModal();
  await loadCandidates();
  renderList();
  renderStats();
}

async function deleteCandidate() {
  if (!confirm("Remover este candidato?")) return;
  try {
    await apiFetch(`/candidates/${selectedId}`, {
      method: "DELETE",
    });
  } catch (e) {
    alert("Erro ao remover: " + e.message);
    return;
  }
  closeModal();
  await loadCandidates();
  renderAreaFilters();
  renderList();
  renderStats();
}

// ─── Export ────────────────────────────────────────────────────────────────
function exportCSV() {
  if (!candidates.length) {
    alert("Nenhum candidato para exportar.");
    return;
  }
  const header = [
    "Nome",
    "Cargo",
    "Área",
    "Nível",
    "Telefone",
    "E-mail",
    "Status",
    "Data",
    "Observações",
  ];
  const rows = candidates.map((c) =>
    [
      c.nome,
      c.cargo,
      c.area,
      c.nivel,
      c.tel,
      c.email,
      c.status,
      c.data,
      c.obs,
    ].map((v) => `"${(v || "").replace(/"/g, '""')}"`),
  );
  const csv = [header, ...rows]
    .map((r) => r.join(","))
    .join("\n");
  const blob = new Blob(["\uFEFF" + csv], {
    type: "text/csv;charset=utf-8;",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "banco_de_talentos.csv";
  a.click();
  URL.revokeObjectURL(url);
}

// ─── Stats ─────────────────────────────────────────────────────────────────
function renderStats() {
  document.getElementById("stats-grid").innerHTML = [
    ["Total", candidates.length],
    [
      "Novos",
      candidates.filter((c) => c.status === "Novo").length,
    ],
    [
      "Em análise",
      candidates.filter((c) => c.status === "Em análise")
        .length,
    ],
    [
      "Aprovados",
      candidates.filter((c) => c.status === "Aprovado")
        .length,
    ],
  ]
    .map(
      ([l, v]) =>
        `<div class="stat-card"><div class="stat-label">${l}</div><div class="stat-value">${v}</div></div>`,
    )
    .join("");
  const sc = {},
    ac = {};
  candidates.forEach((c) => {
    sc[c.status] = (sc[c.status] || 0) + 1;
    if (c.area) ac[c.area] = (ac[c.area] || 0) + 1;
  });
  const barColors = {
    Novo: "#3a7bd5",
    Aprovado: "#2d8c3e",
    "Em análise": "#c97a10",
    Descartado: "#999",
  };
  function barChart(data, container) {
    const max = Math.max(...Object.values(data), 1);
    document.getElementById(container).innerHTML =
      Object.entries(data)
        .sort((a, b) => b[1] - a[1])
        .map(
          ([k, v], i) => `
        <div class="bar-item">
          <div class="bar-header"><span>${k}</span><span>${v}</span></div>
          <div class="bar-track"><div class="bar-fill" style="width:${Math.round((v / max) * 100)}%;background:${barColors[k] || COLORS[i % COLORS.length].txt}"></div></div>
        </div>`,
        )
        .join("");
  }
  if (Object.keys(sc).length) barChart(sc, "chart-status");
  else
    document.getElementById("chart-status").innerHTML =
      '<p style="font-size:13px;color:var(--text-hint);">Sem dados.</p>';
  if (Object.keys(ac).length) barChart(ac, "chart-area");
  else
    document.getElementById("chart-area").innerHTML =
      '<p style="font-size:13px;color:var(--text-hint);">Sem dados.</p>';
}

// ─── Init ──────────────────────────────────────────────────────────────────
document.getElementById("f-data").value = new Date()
  .toISOString()
  .slice(0, 10);
loadCandidates().then(renderStats);
