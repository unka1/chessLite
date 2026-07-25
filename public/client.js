let socket = null;
let currentUser = null; 


let myColor = null;      // w | b
let roomId = null;
let currentFen = 'start';
let currentTurn = 'w';
let selectedSquare = null;
let selectedPiece = null; // piece at selectedSquare
let gameStarted = false;
let gameOver = false;
let pendingPromotion = null; 

const PIECE_UNICODE = {
  p: '♟', r: '♜', n: '♞', b: '♝', q: '♛', k: '♚',
  P: '♙', R: '♖', N: '♘', B: '♗', Q: '♕', K: '♔',
};

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';


const authScreen = document.getElementById('authScreen');
const lobbyEl = document.getElementById('lobby');
const gameEl = document.getElementById('game');

const loginForm = document.getElementById('loginForm');
const registerForm = document.getElementById('registerForm');
const showRegister = document.getElementById('showRegister');
const showLogin = document.getElementById('showLogin');
const authError = document.getElementById('authError');

const lobbyAvatar = document.getElementById('lobbyAvatar');
const lobbyUsername = document.getElementById('lobbyUsername');
const logoutBtn = document.getElementById('logoutBtn');

const queueStatus = document.getElementById('queueStatus');
const roomLinkBox = document.getElementById('roomLinkBox');
const roomCodeDisplay = document.getElementById('roomCodeDisplay');
const copyLinkBtn = document.getElementById('copyLinkBtn');
const joinCodeInput = document.getElementById('joinCodeInput');
const joinBtn = document.getElementById('joinBtn');
const lobbyError = document.getElementById('lobbyError');

const boardEl = document.getElementById('board');
const opponentAvatarEl = document.getElementById('opponentAvatar');
const opponentNameEl = document.getElementById('opponentName');
const opponentClockEl = document.getElementById('opponentClock');
const selfAvatarEl = document.getElementById('selfAvatar');
const selfNameEl = document.getElementById('selfName');
const selfClockEl = document.getElementById('selfClock');
const resignBtn = document.getElementById('resignBtn');
const drawBtn = document.getElementById('drawBtn');
const leaveBtn = document.getElementById('leaveBtn');

const promotionModal = document.getElementById('promotionModal');
const drawModal = document.getElementById('drawModal');
const drawText = document.getElementById('drawText');
const drawAcceptBtn = document.getElementById('drawAcceptBtn');
const drawDeclineBtn = document.getElementById('drawDeclineBtn');
const gameOverModal = document.getElementById('gameOverModal');
const gameOverTitle = document.getElementById('gameOverTitle');
const gameOverReason = document.getElementById('gameOverReason');
const gameOverCloseBtn = document.getElementById('gameOverCloseBtn');



function setAvatar(el, user) {
  el.innerHTML = '';
  if (user && user.photo) {
    const img = document.createElement('img');
    img.src = user.photo;
    img.alt = '';
    el.appendChild(img);
  } else {
    el.textContent = user && user.username ? user.username[0].toUpperCase() : '?';
  }
}

showRegister.addEventListener('click', () => {
  loginForm.classList.add('hidden');
  registerForm.classList.remove('hidden');
  showRegister.classList.add('hidden');
  showLogin.classList.remove('hidden');
  authError.classList.add('hidden');
});
showLogin.addEventListener('click', () => {
  registerForm.classList.add('hidden');
  loginForm.classList.remove('hidden');
  showLogin.classList.add('hidden');
  showRegister.classList.remove('hidden');
  authError.classList.add('hidden');
});

loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  authError.classList.add('hidden');
  const formData = new FormData(loginForm);
  try {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: formData.get('username'),
        password: formData.get('password'),
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Login failed');
    onAuthenticated(data);
  } catch (err) {
    authError.textContent = err.message;
    authError.classList.remove('hidden');
  }
});

registerForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  authError.classList.add('hidden');
  const formData = new FormData(registerForm);
  try {
    const res = await fetch('/api/register', { method: 'POST', body: formData });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Registration failed');
    onAuthenticated(data);
  } catch (err) {
    authError.textContent = err.message;
    authError.classList.remove('hidden');
  }
});

logoutBtn.addEventListener('click', async () => {
  await fetch('/api/logout', { method: 'POST' });
  currentUser = null;
  if (socket) { socket.disconnect(); socket = null; }
  lobbyEl.classList.add('hidden');
  gameEl.classList.add('hidden');
  authScreen.classList.remove('hidden');
  loginForm.reset();
  registerForm.reset();
});

function onAuthenticated(user) {
  currentUser = user;
  authScreen.classList.add('hidden');
  lobbyEl.classList.remove('hidden');
  lobbyUsername.textContent = user.username;
  setAvatar(lobbyAvatar, user);
  connectSocket();
}

// Check for an existing session on load
fetch('/api/me')
  .then((res) => (res.ok ? res.json() : null))
  .then((user) => { if (user) onAuthenticated(user); })
  .catch(() => {});



function connectSocket() {
  if (socket) return;
  socket = io();
  wireSocketEvents();
}

function wireSocketEvents() {
  socket.on('errorMsg', (msg) => {
    lobbyError.textContent = msg;
    lobbyError.classList.remove('hidden');
  });

  socket.on('matched', ({ roomId: rid, color }) => enterGame(rid, color));
  socket.on('roomCreated', ({ roomId: rid }) => {
    roomId = rid;
    roomCodeDisplay.textContent = rid;
    roomLinkBox.classList.remove('hidden');
  });
  socket.on('roomJoined', ({ roomId: rid, color }) => enterGame(rid, color));

  socket.on('state', (state) => {
    currentFen = state.fen;
    currentTurn = state.turn;
    gameStarted = state.started;
    gameOver = state.over;
    updatePlayerBars(state.players);
    updateClocksDisplay(state.clocks);
    renderBoard();
  });

  socket.on('moveMade', ({ state }) => {
    currentFen = state.fen;
    currentTurn = state.turn;
    selectedSquare = null;
    selectedPiece = null;
    updateClocksDisplay(state.clocks);
    renderBoard();
  });

  socket.on('illegalMove', () => {
    selectedSquare = null;
    selectedPiece = null;
    renderBoard();
  });

  socket.on('clockUpdate', (clocks) => updateClocksDisplay(clocks));

  socket.on('drawOffered', () => {
    drawText.textContent = 'Your opponent offers a draw.';
    drawModal.classList.remove('hidden');
  });
  socket.on('drawDeclined', () => flashMessage('Draw declined'));

  socket.on('gameOver', (result) => {
    gameOver = true;
    showGameOver(result);
  });
}



document.querySelectorAll('.time-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    lobbyError.classList.add('hidden');
    socket.emit('findMatch', { timeControl: btn.dataset.tc });
    queueStatus.classList.remove('hidden');
  });
});

document.querySelectorAll('.create-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    lobbyError.classList.add('hidden');
    socket.emit('createRoom', { timeControl: btn.dataset.tc });
  });
});

joinBtn.addEventListener('click', doJoin);
joinCodeInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') doJoin(); });
function doJoin() {
  const code = joinCodeInput.value.trim().toLowerCase();
  if (!code) return;
  lobbyError.classList.add('hidden');
  socket.emit('joinRoom', { roomId: code });
}

copyLinkBtn.addEventListener('click', () => {
  const url = `${location.origin}?room=${roomId}`;
  navigator.clipboard?.writeText(url);
  copyLinkBtn.textContent = 'Copied!';
  setTimeout(() => (copyLinkBtn.textContent = 'Copy link'), 1500);
});

const urlRoom = new URLSearchParams(location.search).get('room');
if (urlRoom) joinCodeInput.value = urlRoom;



function enterGame(rid, color) {
  roomId = rid;
  myColor = color;
  queueStatus.classList.add('hidden');
  roomLinkBox.classList.add('hidden');
  lobbyEl.classList.add('hidden');
  gameEl.classList.remove('hidden');
  leaveBtn.classList.add('hidden');
  gameOverModal.classList.add('hidden');
  currentFen = START_FEN;
  selectedSquare = null;
  selectedPiece = null;
  setAvatar(selfAvatarEl, currentUser);
  selfNameEl.textContent = currentUser.username;
  opponentNameEl.textContent = 'Waiting…';
  setAvatar(opponentAvatarEl, null);
  renderBoard();
}

function updatePlayerBars(players) {
  if (!players || !myColor) return;
  const oppColor = myColor === 'w' ? 'b' : 'w';
  const opponent = players[oppColor];
  if (opponent) {
    opponentNameEl.textContent = opponent.username;
    setAvatar(opponentAvatarEl, opponent);
  }
}

function backToLobby() {
  if (roomId) socket.emit('leaveRoom', { roomId });
  roomId = null;
  myColor = null;
  gameEl.classList.add('hidden');
  lobbyEl.classList.remove('hidden');
  gameOverModal.classList.add('hidden');
  history.replaceState(null, '', location.pathname);
}

function showGameOver(result) {
  let title;
  if (result.winner === null) {
    title = 'Draw';
  } else if (result.winner === myColor) {
    title = 'You won!';
  } else {
    title = 'You lost';
  }
  const reasons = {
    checkmate: 'by checkmate',
    timeout: 'on time',
    resignation: 'by resignation',
    'draw-agreement': 'by agreement',
    stalemate: 'by stalemate',
    repetition: 'by threefold repetition',
    'insufficient-material': 'insufficient material',
    disconnect: 'opponent disconnected',
  };
  gameOverTitle.textContent = title;
  gameOverReason.textContent = reasons[result.reason] || '';
  gameOverModal.classList.remove('hidden');
  leaveBtn.classList.remove('hidden');
}

function flashMessage(msg) {
  const el = document.createElement('div');
  el.textContent = msg;
  el.style.cssText = 'position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:#262421;color:#fff;padding:8px 16px;border-radius:8px;font-size:13px;z-index:20;';
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 1800);
}



resignBtn.addEventListener('click', () => {
  if (gameOver) return;
  if (confirm('Resign the game?')) socket.emit('resign', { roomId });
});

drawBtn.addEventListener('click', () => {
  if (gameOver) return;
  socket.emit('offerDraw', { roomId });
  flashMessage('Draw offer sent');
});

drawAcceptBtn.addEventListener('click', () => {
  socket.emit('respondDraw', { roomId, accept: true });
  drawModal.classList.add('hidden');
});
drawDeclineBtn.addEventListener('click', () => {
  socket.emit('respondDraw', { roomId, accept: false });
  drawModal.classList.add('hidden');
});

leaveBtn.addEventListener('click', backToLobby);
gameOverCloseBtn.addEventListener('click', backToLobby);

//  Board rendering

function fenToBoard(fen) {
  const placement = fen.split(' ')[0];
  const rows = placement.split('/');
  const map = {};
  for (let r = 0; r < 8; r++) {
    let file = 0;
    const rank = 8 - r;
    for (const ch of rows[r]) {
      if (/\d/.test(ch)) {
        file += parseInt(ch, 10);
      } else {
        const square = String.fromCharCode(97 + file) + rank;
        map[square] = ch;
        file++;
      }
    }
  }
  return map;
}

function squareColor(file, rank) {
  return (file + rank) % 2 === 0 ? 'dark' : 'light';
}

function renderBoard() {
  boardEl.innerHTML = '';
  const board = fenToBoard(currentFen === 'start' ? START_FEN : currentFen);
  const flipped = myColor === 'b';

  const files = 'abcdefgh'.split('');
  const ranks = [8, 7, 6, 5, 4, 3, 2, 1];
  const orderedFiles = flipped ? [...files].reverse() : files;
  const orderedRanks = flipped ? [...ranks].reverse() : ranks;

  orderedRanks.forEach((rank) => {
    orderedFiles.forEach((file) => {
      const square = file + rank;
      const fileIdx = files.indexOf(file);
      const sqDiv = document.createElement('div');
      sqDiv.className = `square ${squareColor(fileIdx, rank)}`;
      sqDiv.dataset.square = square;

      if (selectedSquare === square) sqDiv.classList.add('selected');

      const piece = board[square];
      if (piece) {
        const span = document.createElement('span');
        span.className = 'piece';
        span.style.color=isUpper(piece)?"#ffffff":"#000000";
        span.textContent = PIECE_UNICODE[piece];
        sqDiv.appendChild(span);
      }

      sqDiv.addEventListener('click', () => onSquareClick(square, piece));
      boardEl.appendChild(sqDiv);
    });
  });
}
function isUpper(piece){
  const reg= /^[A-Z]+$/;
  return reg.test(piece);
}
function isOwnPiece(piece) {
  if (!piece) return false;
  const isWhitePiece = piece === piece.toUpperCase();
  return (myColor === 'w') === isWhitePiece;
}

function isPromotionMove(piece, toSquare) {
  if (!piece) return false;
  const rank = toSquare[1];
  if (piece === 'P' && rank === '8') return true;
  if (piece === 'p' && rank === '1') return true;
  return false;
}

function onSquareClick(square, piece) {
  if (gameOver || !gameStarted) return;
  if (currentTurn !== myColor) return;

  if (selectedSquare && square !== selectedSquare) {
    if (isOwnPiece(piece)) {
      selectedSquare = square;
      selectedPiece = piece;
      renderBoard();
      return;
    }
    if (isPromotionMove(selectedPiece, square)) {
      pendingPromotion = { from: selectedSquare, to: square };
      promotionModal.classList.remove('hidden');
    } else {
      sendMove(selectedSquare, square);
    }
    return;
  }

  if (selectedSquare === square) {
    selectedSquare = null;
    selectedPiece = null;
    renderBoard();
    return;
  }

  if (isOwnPiece(piece)) {
    selectedSquare = square;
    selectedPiece = piece;
    renderBoard();
  }
}

function sendMove(from, to, promotion) {
  socket.emit('makeMove', { roomId, from, to, promotion: promotion || undefined });
  selectedSquare = null;
  selectedPiece = null;
}

promotionModal.querySelectorAll('[data-piece]').forEach((btn) => {
  btn.addEventListener('click', () => {
    if (pendingPromotion) {
      sendMove(pendingPromotion.from, pendingPromotion.to, btn.dataset.piece);
      pendingPromotion = null;
    }
    promotionModal.classList.add('hidden');
    renderBoard();
  });
});

// Clocks

function formatClock(ms) {
  const total = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function updateClocksDisplay(clocks) {
  if (!clocks || !myColor) return;
  const oppColor = myColor === 'w' ? 'b' : 'w';
  selfClockEl.textContent = formatClock(clocks[myColor]);
  opponentClockEl.textContent = formatClock(clocks[oppColor]);
}

renderBoard();
