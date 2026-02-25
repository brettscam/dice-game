/* ═══════════════════════════════════════════════════════════
   1-4-24 Dice Game  –  Client
═══════════════════════════════════════════════════════════ */

// ── State ────────────────────────────────────────────────────────────────────
const S = {
  socket:     null,
  gameId:     null,
  playerId:   null,
  playerName: null,
  gs:         null,   // latest game_state from server
};

// ── Boot ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  initSocket();
  initHomeScreen();
  checkRoomInUrl();
});

// ── Socket setup ─────────────────────────────────────────────────────────────
function initSocket() {
  S.socket = io();

  S.socket.on('game_created', ({ gameId, playerId }) => {
    S.gameId   = gameId;
    S.playerId = playerId;
    showScreen('lobby');
  });

  S.socket.on('game_joined', ({ gameId, playerId }) => {
    S.gameId   = gameId;
    S.playerId = playerId;
    showScreen('lobby');
  });

  S.socket.on('game_state', (gs) => {
    S.gs = gs;
    routeToScreen(gs);
  });

  S.socket.on('error', ({ message }) => toast(message, 'error'));

  S.socket.on('player_left', ({ name }) => toast(`${name} left the game`, 'warning'));

  S.socket.on('venmo_saved', ({ username }) => {
    toast(username ? `Venmo @${username} saved ✓` : 'Venmo username cleared', 'success');
    qs('#venmo-saved')?.classList.remove('hidden');
    setTimeout(() => qs('#venmo-saved')?.classList.add('hidden'), 2500);
  });
}

// ── Screen router ─────────────────────────────────────────────────────────────
function routeToScreen(gs) {
  switch (gs.phase) {
    case 'waiting':  renderLobby(gs); showScreen('lobby');   break;
    case 'playing':  renderGame(gs);  showScreen('game');    break;
    case 'finished': renderResults(gs); showScreen('results'); break;
  }
}

function showScreen(name) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(`screen-${name}`).classList.add('active');
}

// ── URL room code ─────────────────────────────────────────────────────────────
function checkRoomInUrl() {
  const params = new URLSearchParams(window.location.search);
  const room   = params.get('room');
  if (room) {
    // Switch to join tab and pre-fill code
    qs('[data-tab="join"]').click();
    qs('#join-code').value = room.toUpperCase();
    qs('#join-name').focus();
  }
}

// ═══════════════════════════════════════════════════════════
// HOME SCREEN
// ═══════════════════════════════════════════════════════════
function initHomeScreen() {
  // Tab toggle
  qsa('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      qsa('.tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      qsa('.tab-content').forEach(c => c.classList.add('hidden'));
      qs(`#tab-${tab.dataset.tab}`).classList.remove('hidden');
    });
  });

  // Player-count selector
  qsa('.count-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      qsa('.count-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });

  // Wager toggle
  qs('#wager-toggle').addEventListener('change', e => {
    qs('#wager-detail').classList.toggle('hidden', !e.target.checked);
  });

  // How-to toggle
  qs('#how-to-toggle').addEventListener('click', () => {
    const el = qs('#how-to');
    const open = !el.classList.contains('hidden');
    el.classList.toggle('hidden', open);
    qs('#how-to-toggle').textContent = open ? 'How to play ▾' : 'How to play ▴';
  });

  // Create game
  qs('#btn-create').addEventListener('click', () => {
    const name = qs('#create-name').value.trim();
    if (!name) return toast('Enter your name', 'error');

    const maxPlayers  = parseInt(qs('.count-btn.active').dataset.count);
    const wagerEnabled = qs('#wager-toggle').checked;
    const wagerAmount  = parseFloat(qs('#wager-amount').value) || 1;

    S.playerName = name;
    S.socket.emit('create_game', { playerName: name, maxPlayers, wagerEnabled, wagerAmount });
  });

  // Join game
  qs('#btn-join').addEventListener('click', doJoin);
  qs('#join-code').addEventListener('keypress', e => { if (e.key === 'Enter') doJoin(); });
  qs('#create-name').addEventListener('keypress', e => { if (e.key === 'Enter') qs('#btn-create').click(); });
  qs('#join-name').addEventListener('keypress', e => { if (e.key === 'Enter') doJoin(); });
}

function doJoin() {
  const name = qs('#join-name').value.trim();
  const code = qs('#join-code').value.trim();
  if (!name) return toast('Enter your name', 'error');
  if (!code) return toast('Enter a room code', 'error');
  S.playerName = name;
  S.socket.emit('join_game', { playerName: name, gameId: code });
}

// ═══════════════════════════════════════════════════════════
// LOBBY SCREEN
// ═══════════════════════════════════════════════════════════
function renderLobby(gs) {
  qs('#lobby-code').textContent = gs.id;

  // Copy invite link
  qs('#btn-copy-link').onclick = () => {
    const url = `${location.origin}/?room=${gs.id}`;
    navigator.clipboard.writeText(url)
      .then(() => toast('Invite link copied! Send it to friends.', 'success'))
      .catch(() => toast(`Share code: ${gs.id}`, 'info'));
  };

  // Player list
  qs('#lobby-players').innerHTML = gs.players.map(p => `
    <div class="player-card ${p.id === S.playerId ? 'me' : ''} ${p.disconnected ? 'disconnected' : ''}">
      <div class="player-avatar">${p.name[0].toUpperCase()}</div>
      <div class="player-info">
        <span class="player-name">${esc(p.name)}${p.id === S.playerId ? ' <span style="color:var(--muted)">(you)</span>' : ''}${p.isHost ? ' 👑' : ''}</span>
        ${p.venmoUsername ? `<span class="player-venmo">💚 @${esc(p.venmoUsername)}</span>` : ''}
      </div>
      <span class="tag ${p.disconnected ? 'tag-disconnected' : 'tag-ready'}">${p.disconnected ? 'Left' : 'Ready'}</span>
    </div>
  `).join('');

  // Waiting message
  const active    = gs.players.filter(p => !p.disconnected).length;
  const remaining = gs.maxPlayers - active;
  qs('#waiting-msg').textContent = remaining > 0
    ? `Waiting for ${remaining} more player${remaining !== 1 ? 's' : ''}…`
    : 'All players joined! 🎉';

  // Wager / pot section
  const wagerSec = qs('#wager-section');
  if (gs.wagerEnabled) {
    wagerSec.classList.remove('hidden');

    // Animate pot amount when it changes
    const potEl    = qs('#pot-amount');
    const potTotal = `$${(gs.pot || 0).toFixed(2)}`;
    if (potEl.textContent !== potTotal) {
      potEl.textContent = potTotal;
      potEl.classList.remove('bump');
      void potEl.offsetWidth; // reflow
      potEl.classList.add('bump');
    }
    qs('#pot-detail').textContent =
      `${active} player${active !== 1 ? 's' : ''} × $${gs.wagerAmount.toFixed(2)}`;

    // Venmo username input — wire up once
    const input  = qs('#venmo-username-input');
    const saveBtn = qs('#btn-save-venmo');
    const me = gs.players.find(p => p.id === S.playerId);

    // Pre-fill if already saved
    if (me?.venmoUsername && !input.value) {
      input.value = me.venmoUsername;
    }

    saveBtn.onclick = () => {
      const u = input.value.trim().replace(/^@/, '');
      S.socket.emit('set_venmo_username', { username: u });
    };
    input.onkeypress = e => { if (e.key === 'Enter') saveBtn.click(); };
  } else {
    wagerSec.classList.add('hidden');
  }

  // Start button (host only)
  const isHost   = gs.players.find(p => p.id === S.playerId)?.isHost;
  const startBtn = qs('#btn-start');
  if (isHost) {
    startBtn.classList.remove('hidden');
    const enough = gs.players.filter(p => !p.disconnected).length >= 2;
    startBtn.disabled = !enough;
    startBtn.onclick  = () => S.socket.emit('start_game');
  } else {
    startBtn.classList.add('hidden');
  }

  // Leave
  qs('#btn-leave-lobby').onclick = () => location.reload();
}

// ═══════════════════════════════════════════════════════════
// GAME SCREEN
// ═══════════════════════════════════════════════════════════
function renderGame(gs) {
  const turn   = gs.currentTurn;
  const curP   = gs.players[gs.currentPlayerIndex];
  const isMyTurn = curP?.id === S.playerId;
  const rolled   = turn && turn.rollsUsed > 0;

  // Scoreboard + pot badge
  renderScoreboard(gs);
  const potBadge = qs('#game-pot-badge');
  if (gs.wagerEnabled && gs.pot > 0) {
    potBadge.textContent = `💰 $${gs.pot.toFixed(2)} pot`;
    potBadge.classList.remove('hidden');
  } else {
    potBadge.classList.add('hidden');
  }

  // Turn header
  qs('#turn-player-label').textContent = isMyTurn ? 'Your Turn!' : `${curP?.name}'s Turn`;
  if (turn) {
    const left = turn.maxRolls - turn.rollsUsed;
    qs('#turn-rolls').innerHTML =
      Array.from({ length: turn.maxRolls }, (_, i) =>
        `<span class="roll-pip ${i >= left ? 'used' : ''}"></span>`
      ).join('') + ` <span style="margin-left:.25rem;color:var(--muted)">${left} roll${left !== 1 ? 's' : ''} left</span>`;
  }

  // Dice
  renderDice(gs, isMyTurn);

  // Instruction text
  const instrEl = qs('#dice-instruction');
  if (isMyTurn) {
    instrEl.className = 'dice-instruction';
    if (!rolled) {
      instrEl.textContent = 'Hit Roll Dice to start your turn';
    } else {
      const dice = turn.dice;
      const has1 = dice.includes(1), has4 = dice.includes(4);
      if (has1 && has4) {
        instrEl.className += ' ok';
        instrEl.innerHTML  = '✅ Qualified! Keep your <strong>1</strong> & <strong>4</strong>, max the rest.';
      } else if (!has1 && !has4) {
        instrEl.className += ' warn';
        instrEl.innerHTML  = '❌ Need a <strong>1</strong> and a <strong>4</strong> to qualify — keep rolling or end turn';
      } else {
        instrEl.className += ' warn';
        instrEl.innerHTML  = has1
          ? '⚠️ Still need a <strong>4</strong> — click dice to keep, then re-roll'
          : '⚠️ Still need a <strong>1</strong> — click dice to keep, then re-roll';
      }
    }
  } else {
    instrEl.textContent = '';
  }

  // Kept legend (show after first roll)
  qs('#kept-legend').style.display = (isMyTurn && rolled) ? 'flex' : 'none';

  // Score preview (live)
  renderScorePreview(gs, isMyTurn, rolled);

  // Buttons / waiting
  const actionsEl = qs('#game-actions');
  const waitEl    = qs('#waiting-turn');

  if (isMyTurn) {
    actionsEl.style.display = '';
    waitEl.style.display    = 'none';

    const rollsLeft = turn ? turn.maxRolls - turn.rollsUsed : 3;
    const rollBtn   = qs('#btn-roll');
    const endBtn    = qs('#btn-end-turn');

    rollBtn.disabled = !turn || turn.rollsUsed >= turn.maxRolls;
    rollBtn.textContent = rollsLeft > 0 ? `🎲 Roll Dice (${rollsLeft})` : '🎲 No Rolls Left';
    endBtn.disabled  = !rolled;

    rollBtn.onclick = () => S.socket.emit('roll_dice');
    endBtn.onclick  = () => S.socket.emit('end_turn');
  } else {
    actionsEl.style.display = 'none';
    waitEl.style.display    = '';
    qs('#waiting-turn-label').textContent = `Waiting for ${curP?.name}…`;
  }
}

function renderScoreboard(gs) {
  qs('#game-scoreboard').innerHTML = gs.players.map((p, i) => {
    const isCurrent = i === gs.currentPlayerIndex;
    const isMe      = p.id === S.playerId;
    let scoreHtml   = '<span>—</span>';

    if (p.score !== null) {
      scoreHtml = p.qualified
        ? `<span class="tab-score qualified">${p.score}</span>`
        : `<span class="tab-score dnq">DNQ</span>`;
    } else {
      scoreHtml = `<span class="tab-score" style="color:var(--muted)">—</span>`;
    }

    return `
      <div class="player-tab ${isCurrent ? 'current' : ''} ${isMe ? 'me' : ''} ${p.disconnected ? 'gone' : ''}">
        <div class="tab-name">${esc(p.name)}${isMe ? ' ★' : ''}</div>
        ${scoreHtml}
        ${p.wins > 0 ? `<div class="tab-wins">${p.wins}W</div>` : ''}
      </div>
    `;
  }).join('');
}

function renderScorePreview(gs, isMyTurn, rolled) {
  const previewEl = qs('#score-preview');
  if (!isMyTurn || !rolled || !gs.currentTurn) {
    previewEl.style.display = 'none';
    return;
  }
  const dice = gs.currentTurn.dice.filter(v => v !== null);
  if (dice.length === 0) { previewEl.style.display = 'none'; return; }

  const has1   = dice.includes(1), has4 = dice.includes(4);
  previewEl.style.display = '';

  if (has1 && has4) {
    const rest = [...dice];
    rest.splice(rest.indexOf(1), 1);
    rest.splice(rest.indexOf(4), 1);
    const score = rest.reduce((a, b) => a + b, 0);
    previewEl.innerHTML = `Score if you stop now: <span class="q">${score} pts</span> <span style="color:var(--muted)">(max 24)</span>`;
  } else {
    previewEl.innerHTML = `<span class="dnq">No 1 & 4 yet — DNQ if you stop now</span>`;
  }
}

// ── Dice rendering ────────────────────────────────────────────────────────────

// Dot x/y positions as % of die size for each face value
const DOTS = {
  1: [[50, 50]],
  2: [[30, 30], [70, 70]],
  3: [[70, 28], [50, 50], [30, 72]],
  4: [[30, 28], [70, 28], [30, 72], [70, 72]],
  5: [[30, 28], [70, 28], [50, 50], [30, 72], [70, 72]],
  6: [[30, 22], [70, 22], [30, 50], [70, 50], [30, 78], [70, 78]],
};

function renderDice(gs, isMyTurn) {
  const turn = gs.currentTurn;
  const container = qs('#dice-container');
  container.innerHTML = '';
  if (!turn) return;

  const rolled = turn.rollsUsed > 0;

  turn.dice.forEach((value, idx) => {
    const isKept      = turn.keptIndices.includes(idx);
    const interactive = isMyTurn && rolled && value !== null;
    const die         = makeDie(value, idx, isKept, interactive, !isKept && rolled);

    if (interactive) {
      die.addEventListener('click', () => {
        S.socket.emit('toggle_keep', { dieIndex: idx });
      });

      // Drag support (desktop)
      die.draggable = true;
      die.addEventListener('dragstart', e => {
        e.dataTransfer.setData('dieIndex', String(idx));
        e.dataTransfer.effectAllowed = 'move';
        die.classList.add('dragging');
      });
      die.addEventListener('dragend', () => die.classList.remove('dragging'));
    }

    container.appendChild(die);
  });
}

function makeDie(value, idx, isKept, interactive, doShake) {
  const die = document.createElement('div');

  const classes = ['die'];
  if (isKept)       classes.push('kept');
  if (interactive)  classes.push('interactive');
  if (value === null) classes.push('empty');
  if (doShake && value !== null) classes.push('rolling');
  if ((value === 1 || value === 4) && value !== null) classes.push('key-die');

  die.className = classes.join(' ');
  die.dataset.index = idx;

  if (value !== null) {
    die.dataset.value = value;
    (DOTS[value] || []).forEach(([x, y]) => {
      const dot = document.createElement('div');
      dot.className = 'dot';
      dot.style.left = x + '%';
      dot.style.top  = y + '%';
      die.appendChild(dot);
    });
    // Remove rolling class after animation so CSS transitions work normally again
    die.addEventListener('animationend', () => die.classList.remove('rolling'), { once: true });
  } else {
    die.innerHTML = '<span class="die-placeholder">?</span>';
  }

  return die;
}

// Drop handler (die dragged back onto the container re-toggles it)
function handleDrop(event) {
  event.preventDefault();
  const idx = parseInt(event.dataTransfer.getData('dieIndex'));
  if (!isNaN(idx)) S.socket.emit('toggle_keep', { dieIndex: idx });
}
// Make it available globally for the inline ondrop attribute
window.handleDrop = handleDrop;

// ═══════════════════════════════════════════════════════════
// RESULTS SCREEN
// ═══════════════════════════════════════════════════════════
function renderResults(gs) {
  const latest = gs.roundHistory[gs.roundHistory.length - 1];

  // Hero
  if (gs.winner) {
    qs('#results-crown').textContent = '👑';
    qs('#results-title').textContent = `${gs.winner} Wins!`;
  } else {
    qs('#results-crown').textContent = '😬';
    qs('#results-title').textContent = 'No Winner — Nobody Qualified!';
  }

  // Sorted results table
  if (latest) {
    const sorted = [...latest.results].sort((a, b) => {
      if (a.qualified !== b.qualified) return a.qualified ? -1 : 1;
      return b.score - a.score;
    });

    qs('#results-table').innerHTML = sorted.map((r, i) => {
      const medal = ['🥇', '🥈', '🥉'][i] ?? `${i + 1}.`;
      return `
        <div class="result-row ${r.name === gs.winner ? 'winner' : ''}">
          <span class="result-rank">${medal}</span>
          <span class="result-name">${esc(r.name)}</span>
          <div class="result-dice">${(r.dice || []).map(dieMiniHtml).join('')}</div>
          <span class="result-score ${r.qualified ? 'qualified' : 'dnq'}">
            ${r.qualified ? r.score + ' pts' : 'DNQ'}
          </span>
          ${r.name === gs.winner ? '<span class="winner-badge">👑 Winner</span>' : ''}
        </div>
      `;
    }).join('');
  } else {
    qs('#results-table').innerHTML = '<p style="padding:1rem;color:var(--muted);text-align:center">No results</p>';
  }

  // Round history (show only if >1 rounds played)
  const histEl = qs('#round-history');
  if (gs.roundHistory.length > 1) {
    qs('#history-rows').innerHTML = gs.roundHistory.map(r => `
      <div class="history-row">
        <span class="history-num">R${r.number}</span>
        <span class="history-winner">${r.winner ? `👑 ${esc(r.winner)}` : '—'}</span>
        <div class="history-scores">
          ${r.results.map(p =>
            `<span class="${p.qualified ? 'q' : 'dnq'}">${esc(p.name)}: ${p.qualified ? p.score : 'DNQ'}</span>`
          ).join(' · ')}
        </div>
      </div>
    `).join('');
    histEl.style.display = '';
  } else {
    histEl.style.display = 'none';
  }

  // Venmo payout card
  renderSettleUp(gs);

  // Buttons
  const isHost    = gs.players.find(p => p.id === S.playerId)?.isHost;
  const playAgain = qs('#btn-play-again');
  if (isHost) {
    playAgain.classList.remove('hidden');
    playAgain.onclick = () => S.socket.emit('play_again');
  } else {
    playAgain.classList.add('hidden');
  }

  qs('#btn-share-results').onclick = () => shareResults(gs, latest);
  qs('#btn-new-game').onclick      = () => location.reload();
}

function renderSettleUp(gs) {
  const card = qs('#settle-up-card');
  card.innerHTML = '';

  if (!gs.wagerEnabled || !gs.winner || !gs.pot) return;

  const winner  = gs.players.find(p => p.name === gs.winner);
  const losers  = gs.players.filter(p => p.name !== gs.winner && !p.disconnected);
  const amount  = (gs.wagerAmount || 1).toFixed(2);
  const note    = encodeURIComponent(`1-4-24 — ${gs.winner} wins! 🎲`);

  const winnerUsername = winner?.venmoUsername;

  const rowsHtml = losers.map(loser => {
    const isMe = loser.id === S.playerId;
    const fromLabel = isMe ? '<strong>You</strong>' : `<strong>${esc(loser.name)}</strong>`;

    let actionHtml;
    if (winnerUsername) {
      const link = `https://venmo.com/${encodeURIComponent(winnerUsername)}?txn=pay&amount=${amount}&note=${note}`;
      actionHtml = `<a href="${link}" target="_blank" rel="noopener" class="btn-pay-venmo">💚 Pay on Venmo</a>`;
    } else {
      actionHtml = `<span style="font-size:.8rem;color:var(--muted)">Ask ${esc(gs.winner)} for their @</span>`;
    }

    return `
      <div class="settle-up-row">
        <div class="settle-up-from">${fromLabel} owes ${esc(gs.winner)}</div>
        <div class="settle-up-amount">$${amount}</div>
        ${actionHtml}
      </div>
    `;
  }).join('');

  const noVenmoNote = !winnerUsername
    ? `<div class="settle-up-no-venmo"><span>⚠️</span> ${esc(gs.winner)} didn't set a Venmo username — settle up manually!</div>`
    : '';

  card.innerHTML = `
    <div class="settle-up-card">
      <div class="settle-up-header">
        <span class="settle-up-title">💰 Settle Up</span>
        <span class="settle-up-pot">$${parseFloat(gs.pot).toFixed(2)} pot</span>
      </div>
      <div class="settle-up-rows">
        ${rowsHtml}
        ${noVenmoNote}
      </div>
    </div>
  `;
}

function dieMiniHtml(v) {
  if (v === null) return '<div class="die-mini empty">?</div>';
  const key = v === 1 || v === 4;
  return `<div class="die-mini ${key ? 'key' : ''}">${v}</div>`;
}

// ═══════════════════════════════════════════════════════════
// SHARE RESULTS
// ═══════════════════════════════════════════════════════════
function shareResults(gs, round) {
  if (!round) return toast('No results to share', 'error');

  const sorted = [...round.results].sort((a, b) => {
    if (a.qualified !== b.qualified) return a.qualified ? -1 : 1;
    return b.score - a.score;
  });

  const DICE_EMOJI = ['', '⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];
  const MEDALS = ['🥇', '🥈', '🥉'];

  const lines = [
    `🎲 1-4-24 · Round ${round.number}`,
    `Room: ${gs.id}`,
    '',
    ...sorted.map((r, i) => {
      const m = MEDALS[i] ?? `${i + 1}.`;
      const diceStr = (r.dice || []).map(v => DICE_EMOJI[v] || v).join('');
      return `${m} ${r.name}: ${r.qualified ? `${r.score} pts` : 'DNQ'} ${diceStr}`;
    }),
    '',
    gs.winner ? `👑 Winner: ${gs.winner}!` : '❌ No winner this round',
    '',
    `Play → ${location.origin}`,
  ];

  const text = lines.join('\n');
  navigator.clipboard.writeText(text)
    .then(() => toast('Results copied to clipboard! 📋', 'success'))
    .catch(() => {
      // Fallback: text area modal
      const ta = Object.assign(document.createElement('textarea'), {
        value: text, style: 'position:fixed;opacity:0;', readOnly: true,
      });
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
      toast('Results copied! 📋', 'success');
    });
}

// ═══════════════════════════════════════════════════════════
// UTILITIES
// ═══════════════════════════════════════════════════════════

function qs(sel)  { return document.querySelector(sel); }
function qsa(sel) { return document.querySelectorAll(sel); }

function esc(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function toast(message, type = 'info') {
  const container = qs('#toast-container');
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = message;
  container.appendChild(el);

  requestAnimationFrame(() => {
    requestAnimationFrame(() => el.classList.add('visible'));
  });

  setTimeout(() => {
    el.classList.remove('visible');
    setTimeout(() => el.remove(), 300);
  }, 3500);
}
