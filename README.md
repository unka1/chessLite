# Chess Online

A lightweight two-player online chess game with user accounts and private rooms.

- **Backend:** Node.js + Express + Socket.io. Rooms get short random IDs, moves are
  validated server-side with `chess.js`, and the game clock is server-authoritative.
- **Accounts:** Username + password (bcrypt-hashed) + optional profile photo, stored
  in MongoDB Atlas. A JWT in an httpOnly cookie keeps you logged in; Socket.io
  connections are authenticated with that same cookie, so only logged-in users can
  join a game.
- **Frontend:** Plain HTML/CSS/JS — no framework, no build step. Moves are made by
  clicking a piece, then clicking a destination square.
- **Time controls:** 3-minute Blitz or 10-minute Rapid.
- **Two ways to play:** Quick Match (paired with the next player queued for the same
  time control) or a private room (create one, share the 6-character code or link
  with a friend).


## 2. Configure environment variables

Edit `.env`:

```
MONGO_URI=<your Atlas connection string>
JWT_SECRET=<a long random string>
PORT=your Port
```

Generate a `JWT_SECRET` with:
```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

## 3. Install and run

```bash
npm install
npm start
```



## Project structure

```
server.js            Express + Socket.io server: Mongo connection, rooms, matchmaking,
                      clocks, chess.js validation, socket auth
models/User.js        Mongoose schema — username, passwordHash, photo (nothing else)
middleware/auth.js    JWT sign/verify helpers + Express requireAuth middleware
routes/auth.js         /api/register, /api/login, /api/logout, /api/me
public/index.html     Auth screen + lobby + game screen markup
public/style.css       Minimal styling
public/client.js       Session check, auth forms, board rendering, click-to-move, clocks
```

