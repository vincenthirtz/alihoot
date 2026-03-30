import { AdminAuth } from './auth.js';

let historyData = [];

function escapeCSV(val) {
  const str = String(val ?? '');
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

function exportCSV() {
  if (!historyData.length) return;

  const rows = [['Quiz', 'Date', 'Joueurs', 'Questions', 'Rang', 'Pseudo', 'Score']];

  historyData.forEach((game) => {
    const date = new Date(game.ended_at).toLocaleDateString('fr-FR', {
      day: 'numeric', month: 'long', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
    const rankings = game.rankings || [];
    if (rankings.length === 0) {
      rows.push([
        escapeCSV(game.quiz_title), escapeCSV(date),
        game.player_count, game.question_count,
        '', '', '',
      ]);
    } else {
      rankings.forEach((r) => {
        rows.push([
          escapeCSV(game.quiz_title), escapeCSV(date),
          game.player_count, game.question_count,
          r.rank, escapeCSV(r.nickname), r.score,
        ]);
      });
    }
  });

  const csv = rows.map((r) => r.join(',')).join('\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  downloadBlob(blob, 'alihoot-historique.csv');
}

function exportPDF() {
  if (!historyData.length) return;

  const win = window.open('', '_blank');
  if (!win) return;

  const rows = historyData.map((game) => {
    const date = new Date(game.ended_at).toLocaleDateString('fr-FR', {
      day: 'numeric', month: 'long', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
    const rankings = game.rankings || [];
    const winner = rankings[0];

    const rankingsHtml = rankings.map((r, i) => {
      const medal = i === 0 ? '🥇 ' : i === 1 ? '🥈 ' : i === 2 ? '🥉 ' : `${r.rank}. `;
      return `<tr><td>${medal}${esc(r.nickname)}</td><td style="text-align:right">${r.score} pts</td></tr>`;
    }).join('');

    return `
      <div class="game-card">
        <div class="game-header">
          <strong>${esc(game.quiz_title)}</strong>
          <span>${date}</span>
        </div>
        <div class="game-meta">
          ${game.player_count} joueur${game.player_count > 1 ? 's' : ''} ·
          ${game.question_count} question${game.question_count > 1 ? 's' : ''}
          ${winner ? ` · Gagnant : ${esc(winner.nickname)}` : ''}
        </div>
        <table>${rankingsHtml}</table>
      </div>`;
  }).join('');

  win.document.write(`<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <title>Alihoot! — Historique des parties</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; padding: 30px; color: #222; }
    h1 { font-size: 1.6rem; margin-bottom: 5px; }
    .subtitle { color: #666; margin-bottom: 25px; font-size: 0.9rem; }
    .game-card { border: 1px solid #ddd; border-radius: 8px; padding: 15px; margin-bottom: 12px; page-break-inside: avoid; }
    .game-header { display: flex; justify-content: space-between; align-items: baseline; flex-wrap: wrap; gap: 5px; margin-bottom: 6px; }
    .game-header strong { font-size: 1.05rem; }
    .game-header span { color: #888; font-size: 0.85rem; }
    .game-meta { font-size: 0.85rem; color: #666; margin-bottom: 10px; }
    table { width: 100%; border-collapse: collapse; }
    tr { border-top: 1px solid #eee; }
    td { padding: 4px 8px; font-size: 0.9rem; }
    @media print { body { padding: 15px; } .no-print { display: none; } }
  </style>
</head>
<body>
  <h1>Alihoot! — Historique des parties</h1>
  <p class="subtitle">${historyData.length} partie${historyData.length > 1 ? 's' : ''} · Exporté le ${new Date().toLocaleDateString('fr-FR')}</p>
  <p class="no-print" style="margin-bottom:20px;">
    <button onclick="window.print()" style="padding:8px 20px;font-size:1rem;cursor:pointer;border-radius:6px;border:1px solid #ccc;">🖨️ Imprimer / Enregistrer en PDF</button>
  </p>
  ${rows}
</body>
</html>`);
  win.document.close();
}

function esc(str) {
  const d = document.createElement('div');
  d.textContent = str ?? '';
  return d.innerHTML;
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

async function loadHistory() {
  const container = document.getElementById('history-list');
  try {
    await AdminAuth.init();
    const res = await AdminAuth.authFetch('/api/history');
    const history = await res.json();

    if (!history.length) {
      container.innerHTML = '<div class="empty-state">Aucune partie jouée pour le moment</div>';
      return;
    }

    historyData = history;

    // Show export buttons
    document.getElementById('export-csv-btn').style.display = '';
    document.getElementById('export-pdf-btn').style.display = '';

    container.innerHTML = history
      .map((game) => {
        const date = new Date(game.ended_at).toLocaleDateString('fr-FR', {
          day: 'numeric',
          month: 'long',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        });
        const rankings = game.rankings || [];
        const winner = rankings[0];

        return `<div class="history-card" onclick="this.classList.toggle('expanded')">
          <div class="history-card-header">
            <div>
              <div class="history-card-title">${game.quiz_title}</div>
              <div class="history-card-date">${date}</div>
            </div>
            <div class="history-card-meta">
              <span>${game.player_count} joueur${game.player_count > 1 ? 's' : ''}</span>
              <span>${game.question_count} question${game.question_count > 1 ? 's' : ''}</span>
              ${winner ? `<span>Gagnant : ${winner.nickname}</span>` : ''}
            </div>
          </div>
          <div class="history-rankings">
            ${rankings
              .map((r, i) => {
                const rankClass = i === 0 ? 'gold' : i === 1 ? 'silver' : i === 2 ? 'bronze' : '';
                return `<div class="history-rank-row">
                <div class="avatar" style="background:${r.avatar?.color || '#666'}">${r.avatar?.icon || ''}</div>
                <div class="rank ${rankClass}">${r.rank}</div>
                <div class="name">${r.nickname}</div>
                <div class="score">${r.score} pts</div>
              </div>`;
              })
              .join('')}
          </div>
        </div>`;
      })
      .join('');
  } catch (e) {
    container.innerHTML = '<div class="empty-state">Erreur de chargement</div>';
    console.error(e);
  }
}

document.getElementById('export-csv-btn').addEventListener('click', exportCSV);
document.getElementById('export-pdf-btn').addEventListener('click', exportPDF);

loadHistory();
