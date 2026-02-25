require('dotenv').config();

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const crypto = require('crypto');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

const PORT = process.env.PORT || 3000;
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ─── In-memory state ─────────────────────────────────────────────────────────

const games = new Map();

// ─── Game logic ───────────────────────────────────────────────────────────────

function rollDie() {
  return Math.floor(Math.random() * 6) + 1;
}

function calculateScore(dice) {
  const vals = [...dice];
  if (!vals.includes(1) || !vals.includes(4)) {
    return { qualified: false, score: 0 };
  }
  const rest = [...vals];
  rest.splice(rest.indexOf(1), 1);
  rest.splice(rest.indexOf(4), 1);
  return { qualified: true, score: rest.reduce((a, b) => a + b, 0) };
}

function initTurn(game) {
  game.currentTurn = {
    playerId: game.players[game.currentPlayerIndex].id,
    dice: [null, null, null, null, null, null],
    keptIndices: [],
    rollsUsed: 0,
    maxRolls: 3,
  };
}

function endRound(game) {
  const qualified = game.players.filter(p => p.qualified);
  let winner = null;

  if (qualified.length > 0) {
    winner = qualified.reduce((best, p) => p.score > best.score ? p : best);
    winner.wins = (winner.wins || 0) + 1;
  }

  game.winner = winner ? winner.name : null;

  game.roundHistory.push({
    number: game.roundHistory.length + 1,
    results: game._turnResults.map(r => ({ ...r })),
    winner: game.winner,
  });

  game._turnResults = [];
  game.phase = 'finished';
}

function pot(game) {
  const active = game.players.filter(p => !p.disconnected).length;
  return game.wagerEnabled ? active * game.wagerAmount : 0;
}

function sanitize(game) {
  return {
    id: game.id,
    phase: game.phase,
    maxPlayers: game.maxPlayers,
    wagerEnabled: game.wagerEnabled,
    wagerAmount: game.wagerAmount,
    pot: pot(game),
    players: game.players.map(p => ({
      id: p.id,
      name: p.name,
      score: p.score,
      qualified: p.qualified,
      wins: p.wins,
      isHost: p.isHost,
      disconnected: p.disconnected,
      venmoUsername: p.venmoUsername || null,
    })),
    currentPlayerIndex: game.currentPlayerIndex,
    currentTurn: game.currentTurn
      ? {
          playerId: game.currentTurn.playerId,
          dice: game.currentTurn.dice,
          keptIndices: game.currentTurn.keptIndices,
          rollsUsed: game.currentTurn.rollsUsed,
          maxRolls: game.currentTurn.maxRolls,
        }
      : null,
    roundHistory: game.roundHistory,
    winner: game.winner,
  };
}

// ─── Serve SPA ────────────────────────────────────────────────────────────────

app.get('*', (_req, res) =>
  res.sendFile(path.join(__dirname, 'public', 'index.html'))
);

// ─── Socket.io ────────────────────────────────────────────────────────────────

io.on('connection', (socket) => {
  console.log(`[+] ${socket.id}`);

  // ── Create game ──────────────────────────────────────────────────────────────
  socket.on('create_game', ({ playerName, maxPlayers = 3, wagerEnabled = false, wagerAmount = 1 }) => {
    const gameId = crypto.randomBytes(3).toString('hex').toUpperCase();

    const game = {
      id: gameId,
      phase: 'waiting',
      maxPlayers: Math.min(Math.max(2, Number(maxPlayers)), 4),
      wagerEnabled: !!wagerEnabled,
      wagerAmount: Math.max(0.01, Number(wagerAmount) || 1),
      players: [{
        id: socket.id,
        name: playerName.trim().slice(0, 20),
        score: null,
        qualified: false,
        wins: 0,
        isHost: true,
        disconnected: false,
        venmoUsername: null,
      }],
      currentPlayerIndex: 0,
      currentTurn: null,
      roundHistory: [],
      winner: null,
      _turnResults: [],
    };

    games.set(gameId, game);
    socket.join(gameId);
    socket.gameId = gameId;

    socket.emit('game_created', { gameId, playerId: socket.id });
    io.to(gameId).emit('game_state', sanitize(game));
  });

  // ── Join game ────────────────────────────────────────────────────────────────
  socket.on('join_game', ({ gameId, playerName }) => {
    const id = (gameId || '').trim().toUpperCase();
    const game = games.get(id);

    if (!game) return socket.emit('error', { message: 'Room not found. Check the code.' });
    if (game.phase !== 'waiting') return socket.emit('error', { message: 'Game already in progress.' });
    if (game.players.length >= game.maxPlayers) return socket.emit('error', { message: 'Room is full.' });

    const name = (playerName || '').trim().slice(0, 20);
    if (!name) return socket.emit('error', { message: 'Enter a name.' });
    if (game.players.some(p => p.name.toLowerCase() === name.toLowerCase())) {
      return socket.emit('error', { message: 'That name is taken.' });
    }

    game.players.push({
      id: socket.id,
      name,
      score: null,
      qualified: false,
      wins: 0,
      isHost: false,
      disconnected: false,
      venmoUsername: null,
    });

    socket.join(id);
    socket.gameId = id;

    socket.emit('game_joined', { gameId: id, playerId: socket.id });
    io.to(id).emit('game_state', sanitize(game));
  });

  // ── Start game ───────────────────────────────────────────────────────────────
  socket.on('start_game', () => {
    const game = games.get(socket.gameId);
    if (!game) return;
    if (!game.players.find(p => p.id === socket.id)?.isHost) return;

    const active = game.players.filter(p => !p.disconnected);
    if (active.length < 2) return socket.emit('error', { message: 'Need at least 2 players.' });

    game.phase = 'playing';
    game.currentPlayerIndex = 0;
    game.winner = null;
    game._turnResults = [];
    game.players.forEach(p => { p.score = null; p.qualified = false; });

    initTurn(game);
    io.to(game.id).emit('game_state', sanitize(game));
  });

  // ── Roll dice ─────────────────────────────────────────────────────────────────
  socket.on('roll_dice', () => {
    const game = games.get(socket.gameId);
    if (!game || game.phase !== 'playing') return;

    const turn = game.currentTurn;
    if (!turn || turn.playerId !== socket.id) return socket.emit('error', { message: 'Not your turn.' });
    if (turn.rollsUsed >= turn.maxRolls) return socket.emit('error', { message: 'No rolls left — end your turn.' });

    turn.dice = turn.dice.map((val, i) =>
      turn.keptIndices.includes(i) ? val : rollDie()
    );
    turn.rollsUsed++;

    io.to(game.id).emit('game_state', sanitize(game));
  });

  // ── Toggle keep ──────────────────────────────────────────────────────────────
  socket.on('toggle_keep', ({ dieIndex }) => {
    const game = games.get(socket.gameId);
    if (!game || game.phase !== 'playing') return;

    const turn = game.currentTurn;
    if (!turn || turn.playerId !== socket.id) return;
    if (turn.rollsUsed === 0 || turn.dice[dieIndex] === null) return;

    const idx = turn.keptIndices.indexOf(dieIndex);
    if (idx >= 0) turn.keptIndices.splice(idx, 1);
    else turn.keptIndices.push(dieIndex);

    io.to(game.id).emit('game_state', sanitize(game));
  });

  // ── End turn ──────────────────────────────────────────────────────────────────
  socket.on('end_turn', () => {
    const game = games.get(socket.gameId);
    if (!game || game.phase !== 'playing') return;

    const turn = game.currentTurn;
    if (!turn || turn.playerId !== socket.id) return;
    if (turn.rollsUsed === 0) return socket.emit('error', { message: 'Roll at least once first.' });

    const currentPlayer = game.players[game.currentPlayerIndex];
    const { qualified, score } = calculateScore(turn.dice);
    currentPlayer.score = score;
    currentPlayer.qualified = qualified;

    game._turnResults.push({
      name: currentPlayer.name,
      score,
      qualified,
      dice: [...turn.dice],
    });

    game.currentPlayerIndex++;

    // Skip disconnected players
    while (
      game.currentPlayerIndex < game.players.length &&
      game.players[game.currentPlayerIndex].disconnected
    ) {
      game.currentPlayerIndex++;
    }

    if (game.currentPlayerIndex >= game.players.length) {
      endRound(game);
    } else {
      initTurn(game);
    }

    io.to(game.id).emit('game_state', sanitize(game));
  });

  // ── Play again ───────────────────────────────────────────────────────────────
  socket.on('play_again', () => {
    const game = games.get(socket.gameId);
    if (!game) return;
    if (!game.players.find(p => p.id === socket.id)?.isHost) return;

    game.phase = 'playing';
    game.currentPlayerIndex = 0;
    game.winner = null;
    game._turnResults = [];
    game.players.forEach(p => { p.score = null; p.qualified = false; });

    initTurn(game);
    io.to(game.id).emit('game_state', sanitize(game));
  });

  // ── Save Venmo username ──────────────────────────────────────────────────────
  socket.on('set_venmo_username', ({ username }) => {
    const game = games.get(socket.gameId);
    if (!game) return;
    const player = game.players.find(p => p.id === socket.id);
    if (!player) return;
    player.venmoUsername = (username || '').trim().replace(/^@/, '').slice(0, 50) || null;
    io.to(game.id).emit('game_state', sanitize(game));
    socket.emit('venmo_saved', { username: player.venmoUsername });
  });

  // ── Disconnect ───────────────────────────────────────────────────────────────
  socket.on('disconnect', () => {
    console.log(`[-] ${socket.id}`);
    const game = games.get(socket.gameId);
    if (!game) return;

    const player = game.players.find(p => p.id === socket.id);
    if (!player) return;

    player.disconnected = true;
    io.to(game.id).emit('player_left', { name: player.name });
    io.to(game.id).emit('game_state', sanitize(game));

    // Auto-advance if it was their turn
    if (game.phase === 'playing' && game.currentTurn?.playerId === socket.id) {
      game._turnResults.push({
        name: player.name, score: 0, qualified: false,
        dice: game.currentTurn.dice,
      });
      game.currentPlayerIndex++;

      while (
        game.currentPlayerIndex < game.players.length &&
        game.players[game.currentPlayerIndex].disconnected
      ) {
        game.currentPlayerIndex++;
      }

      if (game.currentPlayerIndex >= game.players.length) endRound(game);
      else initTurn(game);

      io.to(game.id).emit('game_state', sanitize(game));
    }
  });
});

// ─── Start ────────────────────────────────────────────────────────────────────

server.listen(PORT, () => {
  console.log(`🎲  1-4-24 Dice Game  →  ${BASE_URL}`);
});
