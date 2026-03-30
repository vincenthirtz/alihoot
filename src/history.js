import { AdminAuth } from './auth.js';

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

loadHistory();
