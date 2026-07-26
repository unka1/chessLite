require('dotenv').config();
const express = require('express');
const http = require('http');
const path = require('path');
const crypto = require('crypto');
const cookie = require('cookie');
const cookieParser = require('cookie-parser');
const mongoose = require('mongoose');
const { Server } = require('socket.io');
const { Chess } = require('chess.js');
const User = require('./models/User');
const authRoutes = require('./routes/auth');
const { verifyToken } = require('./middleware/auth');
const app = express();
const server = http.createServer(app);
const io = new Server(server);
app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/api', authRoutes);
if (!process.env.MONGO_URI) {
  console.warn('enter credentials');
} else {
  mongoose
    .connect(process.env.MONGO_URI)
    .then(() => console.log('MongoDB connected'))
    .catch((err) => console.error('MongoDB connection error:', err.message));
}
const TIME_CONTROLS = {
  blitz: 3 * 60 * 1000,   // 3 minutes
  rapid: 10 * 60 * 1000,  // 10 minutes
};
const rooms = new Map();                 // roomId : game
const queues = { blitz: [], rapid: [] }; 
function makeRoomId() {
  let id;
  do {
    id = crypto.randomBytes(3).toString('hex');  //random room ids
  } while (rooms.has(id));
  return id;
}
function createGame(roomId, timeControl) {
  const game = {
    id: roomId,
    chess: new Chess(),
    timeControl,
    clocks: { w: TIME_CONTROLS[timeControl], b: TIME_CONTROLS[timeControl] },
    lastMoveTime: null,
    players: { w: null, b: null }, 
    started: false,
    over: false,
    result: null,
    drawOffer: null,
  };
  rooms.set(roomId, game);
  return game;
}
function opponentColor(c) {
  return c === 'w' ? 'b' : 'w';
}
function colorOfSocket(game, socketId) {
  if (game.players.w && game.players.w.socketId === socketId) return 'w';
  if (game.players.b && game.players.b.socketId === socketId) return 'b';
  return null;
}
function playerPublicInfo(p) {
  return p ? { username: p.username, photo: p.photo } : null;
}
function publicState(game) {
  return {
    roomId: game.id,
    fen: game.chess.fen(),
    turn: game.chess.turn(),
    clocks: game.clocks,
    started: game.started,
    over: game.over,
    result: game.result,
    timeControl: game.timeControl,
    players: {
      w: playerPublicInfo(game.players.w),
      b: playerPublicInfo(game.players.b),
    },
  };
}
function endGame(game, winner, reason) {
  game.over = true;
  game.result = { winner, reason };
  io.to(game.id).emit('gameOver', game.result);
}
// Server-authoritative clock ticking + flag-fall detection
setInterval(() => {
  const now = Date.now();
  for (const game of rooms.values()) {
    if (!game.started || game.over || game.lastMoveTime === null) continue;
    const turn = game.chess.turn();
    const elapsed = now - game.lastMoveTime;
    const remaining = game.clocks[turn] - elapsed;
    if (remaining <= 0) {
      game.clocks[turn] = 0;
      endGame(game, opponentColor(turn), 'timeout');
      continue;
    }
    io.to(game.id).emit('clockUpdate', {
      w: turn === 'w' ? remaining : game.clocks.w,
      b: turn === 'b' ? remaining : game.clocks.b,
    });
  }
}, 250);
function socketUser(socket) {
  return { 
    socketId: socket.id,
    username: socket.user.username,
    photo: socket.user.photo };
}
function tryMatch(timeControl) {
  const q = queues[timeControl];
  while (q.length >= 2) {
    const a = q.shift();
    const b = q.shift();
    if (a.disconnected) continue;
    if (b.disconnected) { q.unshift(a); continue; }
    const roomId = makeRoomId();
    const game = createGame(roomId, timeControl);
    const white = Math.random() < 0.5 ? a : b; // 50 50 chances of player getting white or black
    const black = white === a ? b : a;
    game.players.w = socketUser(white);
    game.players.b = socketUser(black);
    white.join(roomId);
    black.join(roomId);
    game.started = true;
    game.lastMoveTime = Date.now();
    white.emit('matched', { roomId, color: 'w', timeControl });
    black.emit('matched', { roomId, color: 'b', timeControl });
    io.to(roomId).emit('state', publicState(game));
  }
}
// valid login cookie check
io.use(async (socket, next) => {
  try {
    const cookies = cookie.parse(socket.handshake.headers.cookie || '');
    const payload = verifyToken(cookies.token);
    const user = await User.findById(payload.id);
    if (!user) {
      return next(new Error('unauthorized'));
    }
    socket.user = { id: user._id.toString(), username: user.username, photo: user.photo };
    next();
  } catch (err) {
    next(new Error('unauthorized'));
  }
});
io.on('connection', (socket) => { // player matching
  socket.on('findMatch', ({ timeControl }) => {
    if (!TIME_CONTROLS[timeControl]) return;
    for (const key of Object.keys(queues)) {
      queues[key] = queues[key].filter((s) => s.id !== socket.id); // check through the blitz and rapid queue
    }
    queues[timeControl].push(socket);
    tryMatch(timeControl);
  });
  socket.on('createRoom', ({ timeControl }) => {
    if (!TIME_CONTROLS[timeControl]) return;
    const roomId = makeRoomId();
    const game = createGame(roomId, timeControl);
    game.players.w = socketUser(socket);
    socket.join(roomId);
    socket.emit('roomCreated', { roomId, color: 'w', timeControl });
    io.to(roomId).emit('state', publicState(game));
  });
  socket.on('joinRoom', ({ roomId }) => {
    const game = rooms.get(roomId);
    if (!game) return socket.emit('errorMsg', 'Room not found');
    if (game.players.w && game.players.b){
      return socket.emit('errorMsg', 'Room is full');
    }
    const color = game.players.w ? 'b' : 'w';
    game.players[color] = socketUser(socket);
    socket.join(roomId);
    socket.emit('roomJoined', { roomId, color, timeControl: game.timeControl });
    if (game.players.w && game.players.b) {
      game.started = true;
      game.lastMoveTime = Date.now();
    }
    io.to(roomId).emit('state', publicState(game));
  });
  socket.on('makeMove', ({ roomId, from, to, promotion }) => {
    const game = rooms.get(roomId);
    if (!game || game.over || !game.started) return;
    const color = colorOfSocket(game, socket.id);
    if (!color || game.chess.turn() !== color) return;
    const now = Date.now();
    const elapsed = now - game.lastMoveTime;
    const remaining = game.clocks[color] - elapsed;
    if (remaining <= 0) {
      game.clocks[color] = 0;
      endGame(game, opponentColor(color), 'timeout');
      return;
    }
    let move;
    try {
      move = game.chess.move({ from, to, promotion: promotion || 'q' });
    } catch (e) {
      move = null;
    }
    if (!move) {
      socket.emit('illegalMove', { from, to });
      return;
    }
    game.clocks[color] = remaining;
    game.lastMoveTime = now;
    game.drawOffer = null;
    io.to(roomId).emit('moveMade', { move, state: publicState(game) });
    if (game.chess.isGameOver()) {
      if (game.chess.isCheckmate()) {
        endGame(game, color, 'checkmate');
      } else if (game.chess.isStalemate()) {
        endGame(game, null, 'stalemate');
      } else if (game.chess.isThreefoldRepetition()) {
        endGame(game, null, 'repetition');
      } else if (game.chess.isInsufficientMaterial()) {
        endGame(game, null, 'insufficient-material');
      } else if (game.chess.isDraw()) {
        endGame(game, null, 'draw');
      } else {
        endGame(game, null, 'gameover');
      }
    }
  });
  socket.on('resign', ({ roomId }) => {
    const game = rooms.get(roomId);
    if (!game || game.over) return;
    const color = colorOfSocket(game, socket.id);
    if (!color) return;
    endGame(game, opponentColor(color), 'resignation');
  });
  socket.on('offerDraw', ({ roomId }) => {
    const game = rooms.get(roomId);
    if (!game || game.over) return;
    const color = colorOfSocket(game, socket.id);
    if (!color) return;
    game.drawOffer = color;
    socket.to(roomId).emit('drawOffered', { by: color });
  });
  socket.on('respondDraw', ({ roomId, accept }) => {
    const game = rooms.get(roomId);
    if (!game || game.over || !game.drawOffer) return;
    if (accept) {
      endGame(game, null, 'draw-agreement');
    } else {
      io.to(roomId).emit('drawDeclined');
    }
    game.drawOffer = null;
  });
  socket.on('leaveRoom', ({ roomId }) => {
    const game = rooms.get(roomId);
    if (!game) return;
    const color = colorOfSocket(game, socket.id);
    if (color && !game.over && game.started) {
      endGame(game, opponentColor(color), 'disconnect');
    }
    socket.leave(roomId);
  });
  socket.on('disconnect', () => {
    for (const key of Object.keys(queues)) {
      queues[key] = queues[key].filter((s) => s.id !== socket.id);
    }
    for (const game of rooms.values()) {
      const color = colorOfSocket(game, socket.id);
      if (color && !game.over && game.started) {
        endGame(game, opponentColor(color), 'disconnect');
      }
    }
  });
});
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Chess server running on http://localhost:${PORT}`));

