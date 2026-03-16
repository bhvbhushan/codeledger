export function getStaticHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>CodeLedger Dashboard</title>
  <link rel="stylesheet" href="/style.css">
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4"></script>
</head>
<body>
  <header>
    <div class="logo">CodeLedger</div>
    <nav>
      <button class="tab active" data-tab="overview">Overview</button>
      <button class="tab" data-tab="projects">Projects</button>
      <button class="tab" data-tab="agents">Agents</button>
      <button class="tab" data-tab="skills">Skills</button>
      <button class="tab" data-tab="optimize">Optimize</button>
    </nav>
    <select id="period-select">
      <option value="today">Today</option>
      <option value="week" selected>This Week</option>
      <option value="month">This Month</option>
      <option value="all">All Time</option>
    </select>
  </header>

  <main>
    <section id="tab-overview" class="tab-content active">
      <div class="kpi-grid">
        <div class="kpi-card" style="border-left-color: var(--blue)">
          <div class="kpi-label">Total Spend</div>
          <div class="kpi-value" id="kpi-total">$0.00</div>
        </div>
        <div class="kpi-card" style="border-left-color: var(--cyan)">
          <div class="kpi-label">Your Work</div>
          <div class="kpi-value" id="kpi-user">$0.00</div>
        </div>
        <div class="kpi-card" style="border-left-color: var(--pink)">
          <div class="kpi-label">Overhead</div>
          <div class="kpi-value" id="kpi-overhead">$0.00</div>
          <div class="kpi-sub" id="kpi-overhead-pct"></div>
        </div>
        <div class="kpi-card" style="border-left-color: var(--purple)">
          <div class="kpi-label">Sessions</div>
          <div class="kpi-value" id="kpi-sessions">0</div>
        </div>
      </div>

      <div class="chart-grid chart-grid-3">
        <div class="chart-card wide">
          <div class="chart-title">Daily Spend (user vs overhead)</div>
          <canvas id="chart-daily"></canvas>
        </div>
        <div class="chart-card">
          <div class="chart-title">Model Distribution</div>
          <canvas id="chart-models"></canvas>
        </div>
        <div class="chart-card">
          <div class="chart-title">Session Categories (auto-categorized)</div>
          <canvas id="chart-categories"></canvas>
        </div>
      </div>

      <div class="table-card">
        <div class="chart-title">Top Projects</div>
        <table id="table-projects">
          <thead>
            <tr><th>Project</th><th>Your Cost</th><th>Overhead</th><th>Sessions</th></tr>
          </thead>
          <tbody></tbody>
        </table>
      </div>
    </section>

    <section id="tab-projects" class="tab-content">
      <div class="table-card">
        <div class="chart-title">Projects</div>
        <table id="table-all-projects">
          <thead>
            <tr><th>Project</th><th>Total Cost</th><th>Your Cost</th><th>Overhead</th><th>Sessions</th><th>Work Type</th><th>Last Active</th></tr>
          </thead>
          <tbody></tbody>
        </table>
      </div>
      <div id="project-detail" style="display:none">
        <div class="chart-card wide">
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <div class="chart-title" id="project-detail-title">Sessions</div>
            <button id="btn-view-project-agents" class="filter-btn" style="font-size:11px;">View Agents →</button>
          </div>
          <table id="table-project-sessions">
            <thead>
              <tr><th>Session</th><th>Started</th><th>Model</th><th>Cost</th><th>Messages</th><th>Work Type</th></tr>
            </thead>
            <tbody></tbody>
          </table>
        </div>
      </div>
    </section>

    <section id="tab-agents" class="tab-content">
      <div class="filter-bar">
        <button class="filter-btn active" data-filter="all">All Agents</button>
        <button class="filter-btn" data-filter="user">Your Work</button>
        <button class="filter-btn" data-filter="overhead">Overhead</button>
        <span id="agent-project-filter" style="display:none; margin-left: 12px; font-size: 12px; color: var(--cyan);">
          Project: <strong id="agent-project-name"></strong>
          <button id="agent-clear-filter" style="background:none;border:none;color:var(--pink);cursor:pointer;font-size:12px;margin-left:6px;">✕ clear</button>
        </span>
      </div>
      <div class="table-card">
        <div class="chart-title">Agents</div>
        <table id="table-agents">
          <thead>
            <tr><th>Agent</th><th>Type</th><th>Model</th><th>Cost</th><th>Messages</th><th>Source</th><th>Project</th></tr>
          </thead>
          <tbody></tbody>
        </table>
      </div>
    </section>

    <section id="tab-skills" class="tab-content">
      <div class="table-card">
        <div class="chart-title">Skills (~estimated)</div>
        <table id="table-skills">
          <thead>
            <tr><th>Skill</th><th>Invocations</th><th>~Est. Tokens (in/out)</th><th>~Est. Cost</th></tr>
          </thead>
          <tbody></tbody>
        </table>
        <p class="disclaimer">All skill token values are estimates based on JSONL sequence analysis.</p>
      </div>
    </section>

    <section id="tab-optimize" class="tab-content">
      <div class="table-card">
        <div class="chart-title">Cost Optimization Recommendations</div>
        <div id="optimize-content"></div>
        <p class="disclaimer">Recommendations are auto-generated from usage patterns. Savings are estimates.</p>
      </div>
    </section>
  </main>

  <script src="/app.js"></script>
</body>
</html>`;
}

export function getStaticCss(): string {
  return `
:root {
  --bg: #0f0f1a;
  --surface: #1a1a2e;
  --border: #2a2a4a;
  --text: #e0e0e0;
  --text-dim: #888;
  --blue: #4361ee;
  --cyan: #4cc9f0;
  --pink: #f72585;
  --purple: #7209b7;
  --green: #06d6a0;
}

* { margin: 0; padding: 0; box-sizing: border-box; }
body { background: var(--bg); color: var(--text); font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif; }

header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 12px 24px; background: var(--surface); border-bottom: 1px solid var(--border);
}
.logo { font-size: 16px; font-weight: 700; color: var(--blue); }
nav { display: flex; gap: 4px; }
.tab {
  background: none; border: none; color: var(--text-dim); padding: 8px 16px;
  border-radius: 6px; cursor: pointer; font-size: 13px; transition: all 0.2s;
}
.tab:hover { color: var(--text); background: var(--border); }
.tab.active { color: #fff; background: var(--blue); }

#period-select {
  background: var(--surface); color: var(--text-dim); border: 1px solid var(--border);
  border-radius: 6px; padding: 6px 12px; font-size: 13px; cursor: pointer;
}

main { max-width: 1200px; margin: 0 auto; padding: 24px; }

.tab-content { display: none; }
.tab-content.active { display: block; }

.kpi-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 20px; }
.kpi-card {
  background: var(--surface); padding: 16px; border-radius: 8px;
  border-left: 3px solid var(--blue);
}
.kpi-label { font-size: 12px; color: var(--text-dim); margin-bottom: 4px; }
.kpi-value { font-size: 24px; font-weight: 700; }
.kpi-sub { font-size: 11px; color: var(--pink); margin-top: 2px; }

.chart-grid { display: grid; grid-template-columns: 3fr 2fr; gap: 12px; margin-bottom: 20px; }
.chart-grid-3 { grid-template-columns: 3fr 2fr 2fr; }
.chart-card { background: var(--surface); padding: 16px; border-radius: 8px; position: relative; }
.chart-card.wide { grid-column: span 1; }
.chart-card canvas { max-height: 250px; }
.chart-title { font-size: 12px; color: var(--text-dim); margin-bottom: 12px; }

.table-card { background: var(--surface); padding: 16px; border-radius: 8px; margin-bottom: 20px; }
table { width: 100%; border-collapse: collapse; font-size: 13px; }
thead th { text-align: left; padding: 8px 12px; color: var(--text-dim); border-bottom: 1px solid var(--border); font-weight: 500; }
tbody td { padding: 8px 12px; border-bottom: 1px solid var(--border); }
tbody tr:hover { background: rgba(67, 97, 238, 0.05); }
tbody tr { cursor: default; }

.clickable-row { cursor: pointer; }
.clickable-row:hover { background: rgba(67, 97, 238, 0.1) !important; }

.cost { color: var(--blue); font-weight: 600; }
.overhead-cost { color: var(--pink); font-weight: 600; }
.category-user { color: var(--green); }
.category-overhead { color: var(--pink); }

.filter-bar { display: flex; gap: 6px; margin-bottom: 16px; }
.filter-btn {
  background: var(--surface); border: 1px solid var(--border); color: var(--text-dim);
  padding: 6px 14px; border-radius: 6px; cursor: pointer; font-size: 12px; transition: all 0.2s;
}
.filter-btn:hover { color: var(--text); border-color: var(--blue); }
.filter-btn.active { color: #fff; background: var(--blue); border-color: var(--blue); }

.disclaimer { font-size: 11px; color: var(--text-dim); margin-top: 12px; font-style: italic; }

.rec-card { background: var(--bg); border: 1px solid var(--border); border-radius: 8px; padding: 16px; margin-bottom: 12px; }
.rec-card h4 { color: var(--text); margin-bottom: 8px; font-size: 14px; }
.rec-evidence { color: var(--text-dim); font-size: 12px; margin-bottom: 6px; }
.rec-action { color: var(--cyan); font-size: 13px; margin-bottom: 6px; }
.rec-savings { color: var(--green); font-weight: 700; font-size: 15px; }

@media (max-width: 768px) {
  .kpi-grid { grid-template-columns: repeat(2, 1fr); }
  .chart-grid { grid-template-columns: 1fr; }
  .chart-grid-3 { grid-template-columns: 1fr; }
  header { flex-wrap: wrap; gap: 8px; }
}
`;
}

export function getStaticJs(): string {
  return `
let currentPeriod = 'week';
let dailyChart = null;
let modelChart = null;
let categoryChart = null;
let agentProjectFilter = null; // { id, name } when filtering agents by project

function esc(s) {
  if (s == null) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// Tab switching
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(tc => tc.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById('tab-' + tab.dataset.tab).classList.add('active');
    loadData();
  });
});

// Period selector
document.getElementById('period-select').addEventListener('change', (e) => {
  currentPeriod = e.target.value;
  loadData();
});

// Agent filter buttons
document.querySelectorAll('.filter-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    loadAgents(btn.dataset.filter);
  });
});

// Clear agent project filter
document.getElementById('agent-clear-filter')?.addEventListener('click', () => {
  agentProjectFilter = null;
  document.getElementById('agent-project-filter').style.display = 'none';
  loadAgents(document.querySelector('.filter-btn.active')?.dataset.filter ?? 'all');
});

function navigateToAgents(projectId, projectName) {
  agentProjectFilter = { id: projectId, name: projectName };
  // Switch to agents tab
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(tc => tc.classList.remove('active'));
  document.querySelector('[data-tab="agents"]').classList.add('active');
  document.getElementById('tab-agents').classList.add('active');
  // Show filter label
  document.getElementById('agent-project-filter').style.display = 'inline';
  document.getElementById('agent-project-name').textContent = projectName;
  loadAgents(document.querySelector('.filter-btn.active')?.dataset.filter ?? 'all');
}

function fmt(n) { return '$' + Number(n).toFixed(2); }
function fmtK(n) { return Number(n).toLocaleString(); }
function shortId(id) { return id.length > 12 ? id.slice(0, 12) + '...' : id; }
function shortDate(d) { if (!d) return '\\u2014'; return d.split('T')[0]; }

async function loadData() {
  const active = document.querySelector('.tab.active').dataset.tab;
  if (active === 'overview') await loadOverview();
  else if (active === 'projects') await loadProjects();
  else if (active === 'agents') await loadAgents(document.querySelector('.filter-btn.active')?.dataset.filter ?? 'all');
  else if (active === 'skills') await loadSkills();
  else if (active === 'optimize') await loadOptimize();
}

async function loadOverview() {
  const [summary, daily, models, projects, categories] = await Promise.all([
    fetch('/api/summary?period=' + currentPeriod).then(r => r.json()),
    fetch('/api/daily-costs?period=' + currentPeriod).then(r => r.json()),
    fetch('/api/models?period=' + currentPeriod).then(r => r.json()),
    fetch('/api/projects?period=' + currentPeriod).then(r => r.json()),
    fetch('/api/categories?period=' + currentPeriod).then(r => r.json()),
  ]);

  // KPIs
  document.getElementById('kpi-total').textContent = fmt(summary.totalCost);
  document.getElementById('kpi-user').textContent = fmt(summary.userCost);
  document.getElementById('kpi-overhead').textContent = fmt(summary.overheadCost);
  document.getElementById('kpi-overhead-pct').textContent = summary.totalCost > 0
    ? Math.round(summary.overheadCost / summary.totalCost * 100) + '% of total'
    : '';
  document.getElementById('kpi-sessions').textContent = summary.sessionCount;

  // Daily chart
  if (dailyChart) dailyChart.destroy();
  const ctx1 = document.getElementById('chart-daily').getContext('2d');
  dailyChart = new Chart(ctx1, {
    type: 'bar',
    data: {
      labels: daily.map(d => d.date),
      datasets: [
        { label: 'Your Work', data: daily.map(d => d.userCost), backgroundColor: '#4361ee', borderRadius: 3 },
        { label: 'Overhead', data: daily.map(d => d.overheadCost), backgroundColor: '#f72585', borderRadius: 3 },
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { labels: { color: '#888', font: { size: 11 } } } },
      scales: {
        x: { stacked: true, ticks: { color: '#666', font: { size: 10 } }, grid: { display: false } },
        y: { stacked: true, ticks: { color: '#666', callback: v => '$' + v }, grid: { color: '#1f1f35' } },
      }
    }
  });

  // Model chart
  if (modelChart) modelChart.destroy();
  const ctx2 = document.getElementById('chart-models').getContext('2d');
  const colors = ['#4361ee', '#4cc9f0', '#7209b7', '#f72585', '#06d6a0'];
  modelChart = new Chart(ctx2, {
    type: 'doughnut',
    data: {
      labels: models.map(m => m.model),
      datasets: [{
        data: models.map(m => m.total_cost),
        backgroundColor: colors.slice(0, models.length),
        borderWidth: 0,
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { position: 'right', labels: { color: '#888', font: { size: 11 }, padding: 12 } },
      }
    }
  });

  // Category chart
  if (categoryChart) categoryChart.destroy();
  const ctx3 = document.getElementById('chart-categories').getContext('2d');
  const catColorMap = { generation: '#4361ee', exploration: '#4cc9f0', debugging: '#f72585', review: '#7209b7', planning: '#06d6a0', devops: '#ff8c00', mixed: '#666' };
  const catColors = categories.map(c => catColorMap[c.category] ?? '#666');
  categoryChart = new Chart(ctx3, {
    type: 'doughnut',
    data: {
      labels: categories.map(c => c.category ?? 'uncategorized'),
      datasets: [{
        data: categories.map(c => c.session_count),
        backgroundColor: catColors,
        borderWidth: 0,
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { position: 'right', labels: { color: '#888', font: { size: 11 }, padding: 12 } },
      }
    }
  });

  // Top projects table (clickable → drill down to agents)
  const tbody = document.querySelector('#table-projects tbody');
  tbody.innerHTML = projects.slice(0, 8).map(p =>
    '<tr class="clickable-row" data-id="' + p.id + '" data-name="' + esc(p.name) + '"><td>' + esc(p.name) + '</td><td class="cost">' + fmt(p.userCost) + '</td><td class="overhead-cost">' + fmt(p.overheadCost) + '</td><td>' + p.session_count + '</td></tr>'
  ).join('');
  tbody.querySelectorAll('.clickable-row').forEach(row => {
    row.addEventListener('click', () => navigateToAgents(row.dataset.id, row.dataset.name));
  });
}

async function loadProjects() {
  const projects = await fetch('/api/projects?period=' + currentPeriod).then(r => r.json());
  const tbody = document.querySelector('#table-all-projects tbody');
  tbody.innerHTML = projects.map(p =>
    '<tr class="clickable-row" data-id="' + p.id + '"><td>' + esc(p.name) + '</td><td class="cost">' + fmt(p.total_cost) + '</td><td class="cost">' + fmt(p.userCost) + '</td><td class="overhead-cost">' + fmt(p.overheadCost) + '</td><td>' + p.session_count + '</td><td>' + esc(p.topCategory ?? 'mixed') + '</td><td>' + shortDate(p.last_active) + '</td></tr>'
  ).join('');

  // Click to drill down
  tbody.querySelectorAll('.clickable-row').forEach(row => {
    row.addEventListener('click', () => loadProjectSessions(row.dataset.id, projects.find(p => p.id == row.dataset.id)?.name));
  });

  document.getElementById('project-detail').style.display = 'none';
}

let currentProjectDrilldown = null; // { id, name }

async function loadProjectSessions(projectId, projectName) {
  currentProjectDrilldown = { id: projectId, name: projectName };
  document.getElementById('btn-view-project-agents').onclick = () => navigateToAgents(projectId, projectName);
  const sessions = await fetch('/api/projects/' + projectId + '/sessions?period=' + currentPeriod).then(r => r.json());
  document.getElementById('project-detail-title').textContent = projectName + ' \\u2014 Sessions';
  const tbody = document.querySelector('#table-project-sessions tbody');
  tbody.innerHTML = sessions.map(s =>
    '<tr><td>' + shortId(s.id) + '</td><td>' + shortDate(s.started_at) + '</td><td>' + esc(s.primary_model ?? '\\u2014') + '</td><td class="cost">' + fmt(s.total_cost_usd) + '</td><td>' + s.message_count + '</td><td>' + esc(s.category ?? 'mixed') + '</td></tr>'
  ).join('');
  document.getElementById('project-detail').style.display = 'block';
}

async function loadAgents(filter) {
  let url = '/api/agents?period=' + currentPeriod + (filter !== 'all' ? '&source_category=' + filter : '');
  if (agentProjectFilter) url += '&project_id=' + agentProjectFilter.id;
  const agents = await fetch(url).then(r => r.json());
  const tbody = document.querySelector('#table-agents tbody');
  tbody.innerHTML = agents.map(a =>
    '<tr><td>' + shortId(a.agent_id) + '</td><td>' + esc(a.agent_type ?? '\\u2014') + '</td><td>' + esc(a.model ?? '\\u2014') + '</td><td class="cost">' + fmt(a.total_cost_usd) + '</td><td>' + a.message_count + '</td><td class="' + (a.source_category === 'overhead' ? 'category-overhead' : 'category-user') + '">' + esc(a.source_category) + '</td><td>' + esc(a.project) + '</td></tr>'
  ).join('');
}

async function loadSkills() {
  const skills = await fetch('/api/skills?period=' + currentPeriod).then(r => r.json());
  const tbody = document.querySelector('#table-skills tbody');
  tbody.innerHTML = skills.map(s =>
    '<tr><td>' + esc(s.skill_name) + '</td><td>' + s.invocation_count + '</td><td>~' + fmtK(s.est_input_tokens) + ' / ' + fmtK(s.est_output_tokens) + '</td><td class="cost">~' + fmt(s.est_cost_usd) + '</td></tr>'
  ).join('');
}

async function loadOptimize() {
  const recs = await fetch('/api/optimize?period=' + currentPeriod).then(r => r.json());
  const container = document.getElementById('optimize-content');
  if (recs.length === 0) {
    container.innerHTML = '<p style="color: var(--green); padding: 20px; text-align: center;">No optimization recommendations — your usage looks efficient!</p>';
    return;
  }
  const totalSavings = recs.reduce((s, r) => s + r.potential_savings, 0);
  container.innerHTML = '<p style="margin-bottom: 16px; font-size: 15px;">Potential savings: <span class="rec-savings">~$' + totalSavings.toFixed(2) + '</span></p>' +
    recs.map((r, i) =>
      '<div class="rec-card"><h4>' + (i+1) + '. ' + esc(r.what) + '</h4><div class="rec-evidence">' + esc(r.evidence) + '</div><div class="rec-action">' + esc(r.recommendation) + '</div><div class="rec-savings">~$' + r.potential_savings.toFixed(2) + ' potential savings</div></div>'
    ).join('');
}

// Initial load
loadData();
`;
}
