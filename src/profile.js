const contentEl = document.getElementById('profile-content');
const player = JSON.parse(localStorage.getItem('alihoot-player') || 'null');

// Logout
document.getElementById('logout-btn').addEventListener('click', () => {
  localStorage.removeItem('alihoot-player');
  window.location.href = '/';
});

if (!player || !player.id) {
  contentEl.innerHTML = `<div class="not-registered">
    <p>Tu n'es pas encore inscrit</p>
    <a href="/">S'inscrire et jouer</a>
  </div>`;
} else {
  loadProfile(player.id);
}

async function loadProfile(playerId) {
  try {
    const [profileRes, gamesRes, allAchRes] = await Promise.all([
      fetch(`/api/players/${playerId}/profile`),
      fetch(`/api/players/${playerId}/games`),
      fetch('/api/achievements'),
    ]);

    if (!profileRes.ok) {
      contentEl.innerHTML = '<div class="empty-state">Profil introuvable</div>';
      return;
    }

    const { player: p, achievements: unlocked } = await profileRes.json();
    const games = await gamesRes.json();
    const allAchievements = await allAchRes.json();

    const unlockedIds = new Set(unlocked.map((a) => a.achievement_id));

    // Profile card
    let html = `
      <div class="profile-card">
        <div class="profile-avatar" style="background:${p.avatar?.color || '#666'}">${p.avatar?.icon || '👤'}</div>
        <div class="profile-info">
          <div class="profile-name">${p.nickname}</div>
          <div class="profile-email">${p.email}</div>
          <div class="profile-stats-grid">
            <div class="profile-stat">
              <div class="profile-stat-value">${p.games_played}</div>
              <div class="profile-stat-label">Parties</div>
            </div>
            <div class="profile-stat">
              <div class="profile-stat-value">${(p.total_score || 0).toLocaleString()}</div>
              <div class="profile-stat-label">Score total</div>
            </div>
            <div class="profile-stat">
              <div class="profile-stat-value">${p.best_streak}</div>
              <div class="profile-stat-label">Meilleur streak</div>
            </div>
            <div class="profile-stat">
              <div class="profile-stat-value">${unlocked.length}/${allAchievements.length}</div>
              <div class="profile-stat-label">Badges</div>
            </div>
          </div>
        </div>
      </div>
    `;

    // Achievements
    html += '<div class="section-title">Badges</div>';
    if (allAchievements.length) {
      html += '<div class="achievements-grid">';
      html += allAchievements
        .map((ach) => {
          const isUnlocked = unlockedIds.has(ach.id);
          const unlockedData = unlocked.find((u) => u.achievement_id === ach.id);
          const dateStr = unlockedData
            ? new Date(unlockedData.unlocked_at).toLocaleDateString('fr-FR', {
                day: 'numeric',
                month: 'short',
              })
            : '';
          return `<div class="achievement-card ${isUnlocked ? '' : 'locked'}">
            <div class="achievement-icon">${ach.icon}</div>
            <div class="achievement-title">${ach.title}</div>
            <div class="achievement-desc">${ach.description}</div>
            ${isUnlocked ? `<div class="achievement-date">${dateStr}</div>` : ''}
          </div>`;
        })
        .join('');
      html += '</div>';
    } else {
      html += '<div class="empty-state">Aucun badge disponible</div>';
    }

    // Game history
    html += '<div class="section-title">Mes parties</div>';
    if (games.length) {
      html += games
        .map((g) => {
          const date = new Date(g.ended_at).toLocaleDateString('fr-FR', {
            day: 'numeric',
            month: 'short',
            hour: '2-digit',
            minute: '2-digit',
          });
          const rankClass =
            g.player_rank === 1
              ? 'gold'
              : g.player_rank === 2
                ? 'silver'
                : g.player_rank === 3
                  ? 'bronze'
                  : '';
          return `<div class="game-row">
            <div class="game-rank ${rankClass}">#${g.player_rank || '?'}</div>
            <div class="game-title">${g.quiz_title}</div>
            <div class="game-meta">
              <span class="game-score">${(g.player_score || 0).toLocaleString()} pts</span>
              <span>${g.player_count} joueur${g.player_count > 1 ? 's' : ''}</span>
            </div>
            <div class="game-date">${date}</div>
          </div>`;
        })
        .join('');
    } else {
      html += '<div class="empty-state">Aucune partie jouee pour le moment</div>';
    }

    contentEl.innerHTML = html;
  } catch (e) {
    contentEl.innerHTML = '<div class="empty-state">Erreur de chargement</div>';
    console.error(e);
  }
}
