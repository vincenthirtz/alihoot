const podiumEl = document.getElementById('lb-podium');
const listEl = document.getElementById('lb-list');
let currentPeriod = 'all';

// Sync filter buttons with currentPeriod
function updateFilterButtons() {
  document.querySelectorAll('.lb-filter-btn').forEach((b) => {
    b.classList.toggle('active', b.dataset.period === currentPeriod);
  });
}

async function loadLeaderboard(period) {
  currentPeriod = period;
  updateFilterButtons();
  listEl.innerHTML = '<div class="loading">Chargement...</div>';
  podiumEl.innerHTML = '';

  try {
    const res = await fetch(`/api/leaderboard?period=${period}`);
    if (!res.ok) throw new Error(`Erreur serveur (${res.status})`);
    const data = await res.json();

    if (!data.length) {
      podiumEl.innerHTML = '';
      listEl.innerHTML = '<div class="empty-state">Aucun joueur pour le moment</div>';
      return;
    }

    // Podium (top 3) — reordered as [2nd, 1st, 3rd] for visual display
    const top3 = data.slice(0, 3);
    const medals = ['🥇', '🥈', '🥉'];
    const podiumIndices = top3.length >= 3 ? [1, 0, 2] : top3.map((_, i) => i);

    podiumEl.innerHTML = podiumIndices
      .map((originalIdx, i) => {
        const p = top3[originalIdx];
        return `<div class="lb-podium-item lb-animate" style="animation-delay:${i * 0.12}s">
          <div class="lb-podium-medal">${medals[originalIdx]}</div>
          <div class="lb-podium-avatar" style="background:${p.avatar?.color || '#666'}">${p.avatar?.icon || '👤'}</div>
          <div class="lb-podium-name">${p.nickname}</div>
          <div class="lb-podium-score">${p.total_score.toLocaleString()} pts</div>
        </div>`;
      })
      .join('');

    // Full list with staggered fade-in
    listEl.innerHTML = data
      .map((p, i) => {
        const rankClass = i === 0 ? 'gold' : i === 1 ? 'silver' : i === 2 ? 'bronze' : '';
        return `<div class="lb-row lb-animate" style="animation-delay:${i * 0.06}s">
          <div class="lb-rank ${rankClass}">${i + 1}</div>
          <div class="lb-avatar" style="background:${p.avatar?.color || '#666'}">${p.avatar?.icon || '👤'}</div>
          <div class="lb-name">${p.nickname}</div>
          <div class="lb-stats">
            <span>${p.games_played} partie${p.games_played > 1 ? 's' : ''}</span>
            <span>Streak max: ${p.best_streak}</span>
          </div>
          <div class="lb-score">${p.total_score.toLocaleString()}</div>
        </div>`;
      })
      .join('');
  } catch (e) {
    listEl.innerHTML = '<div class="empty-state">Erreur de chargement</div>';
    console.error(e);
  }
}

// Filter buttons
document.querySelectorAll('.lb-filter-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    loadLeaderboard(btn.dataset.period);
  });
});

// Auto-refresh every 30s
setInterval(() => loadLeaderboard(currentPeriod), 30000);

loadLeaderboard('all');
