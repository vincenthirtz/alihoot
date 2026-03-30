const podiumEl = document.getElementById('lb-podium');
const listEl = document.getElementById('lb-list');
let currentPeriod = 'all';

async function loadLeaderboard(period) {
  currentPeriod = period;
  listEl.innerHTML = '<div class="loading">Chargement...</div>';
  podiumEl.innerHTML = '';

  try {
    const res = await fetch(`/api/leaderboard?period=${period}`);
    const data = await res.json();

    if (!data.length) {
      podiumEl.innerHTML = '';
      listEl.innerHTML = '<div class="empty-state">Aucun joueur pour le moment</div>';
      return;
    }

    // Podium (top 3)
    const top3 = data.slice(0, 3);
    const medals = ['🥇', '🥈', '🥉'];
    const podiumOrder = top3.length >= 3 ? [top3[1], top3[0], top3[2]] : top3;
    podiumEl.innerHTML = podiumOrder
      .map((p) => {
        const originalIdx = top3.indexOf(p);
        return `<div class="lb-podium-item">
          <div class="lb-podium-medal">${medals[originalIdx]}</div>
          <div class="lb-podium-avatar" style="background:${p.avatar?.color || '#666'}">${p.avatar?.icon || '👤'}</div>
          <div class="lb-podium-name">${p.nickname}</div>
          <div class="lb-podium-score">${p.total_score.toLocaleString()} pts</div>
        </div>`;
      })
      .join('');

    // Full list
    listEl.innerHTML = data
      .map((p, i) => {
        const rankClass = i === 0 ? 'gold' : i === 1 ? 'silver' : i === 2 ? 'bronze' : '';
        return `<div class="lb-row">
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
    document.querySelectorAll('.lb-filter-btn').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    loadLeaderboard(btn.dataset.period);
  });
});

loadLeaderboard('all');
