const podiumEl = document.getElementById('lb-podium');
const listEl = document.getElementById('lb-list');
let currentPeriod = 'all';
const PAGE_SIZE = 50;
let currentOffset = 0;
let currentTotal = 0;

// Sync filter buttons with currentPeriod
function updateFilterButtons() {
  document.querySelectorAll('.lb-filter-btn').forEach((b) => {
    b.classList.toggle('active', b.dataset.period === currentPeriod);
  });
}

async function loadLeaderboard(period, offset = 0) {
  currentPeriod = period;
  currentOffset = offset;
  updateFilterButtons();

  if (offset === 0) {
    listEl.innerHTML = '<div class="loading">Chargement...</div>';
    podiumEl.innerHTML = '';
  }

  try {
    const res = await fetch(`/api/leaderboard?period=${period}&limit=${PAGE_SIZE}&offset=${offset}`);
    if (!res.ok) throw new Error(`Erreur serveur (${res.status})`);
    const result = await res.json();

    // Support both old format (array) and new format ({ players, total })
    const data = Array.isArray(result) ? result : result.players;
    currentTotal = Array.isArray(result) ? data.length : result.total;

    if (!data.length && offset === 0) {
      podiumEl.innerHTML = '';
      listEl.innerHTML = '<div class="empty-state">Aucun joueur pour le moment</div>';
      return;
    }

    // Podium (top 3) — only on first page
    if (offset === 0) {
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
    }

    // Full list with staggered fade-in
    const rowsHtml = data
      .map((p, i) => {
        const globalRank = offset + i + 1;
        const rankClass = globalRank === 1 ? 'gold' : globalRank === 2 ? 'silver' : globalRank === 3 ? 'bronze' : '';
        return `<div class="lb-row lb-animate" style="animation-delay:${i * 0.06}s">
          <div class="lb-rank ${rankClass}">${globalRank}</div>
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

    if (offset === 0) {
      listEl.innerHTML = rowsHtml;
    } else {
      // Remove existing pagination before appending
      const existingPag = listEl.querySelector('.lb-pagination');
      if (existingPag) existingPag.remove();
      listEl.insertAdjacentHTML('beforeend', rowsHtml);
    }

    // Add pagination if there are more results
    if (offset + data.length < currentTotal) {
      const pagDiv = document.createElement('div');
      pagDiv.className = 'lb-pagination';
      pagDiv.innerHTML = `<button class="lb-load-more">Voir plus (${currentTotal - offset - data.length} restants)</button>`;
      pagDiv.querySelector('.lb-load-more').addEventListener('click', () => {
        loadLeaderboard(currentPeriod, offset + PAGE_SIZE);
      });
      listEl.appendChild(pagDiv);
    }
  } catch (e) {
    listEl.innerHTML = '<div class="empty-state">Erreur de chargement</div>';
    console.error(e);
  }
}

// Filter buttons
document.querySelectorAll('.lb-filter-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    loadLeaderboard(btn.dataset.period, 0);
  });
});

// Auto-refresh every 30s
setInterval(() => loadLeaderboard(currentPeriod, 0), 30000);

loadLeaderboard('all');
