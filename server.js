const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));

// ---- In-memory room state ----
// rooms[roomId] = {
//   elements: [ { id, type, ... }, ... ],
//   users: { socketId: { name, color, initials } }
// }
const rooms = {};
const MAX_ELEMENTS = 10000;

const ADJECTIVES = ['Swift', 'Quiet', 'Amber', 'Cosmic', 'Bright', 'Lucid', 'Coral', 'Violet', 'Rapid', 'Gentle', 'Nova', 'Aura', 'Solar', 'Zenith'];
const ANIMALS = ['Fox', 'Heron', 'Otter', 'Lynx', 'Sparrow', 'Wren', 'Falcon', 'Hare', 'Newt', 'Finch', 'Panda', 'Eagle', 'Koala', 'Badger'];
const PALETTE = [
  '#4F46E5', // Indigo
  '#06B6D4', // Cyan
  '#10B981', // Emerald
  '#F59E0B', // Amber
  '#EF4444', // Red
  '#EC4899', // Pink
  '#8B5CF6', // Purple
  '#14B8A6'  // Teal
];

function randomName() {
  const a = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const n = ANIMALS[Math.floor(Math.random() * ANIMALS.length)];
  return `${a} ${n}`;
}

function colorForIndex(i) {
  return PALETTE[i % PALETTE.length];
}

function getRoom(roomId) {
  if (!rooms[roomId]) {
    rooms[roomId] = { elements: [], users: {} };
  }
  return rooms[roomId];
}

function userList(roomId) {
  const room = getRoom(roomId);
  return Object.entries(room.users).map(([id, u]) => ({ id, ...u }));
}

io.on('connection', (socket) => {
  let currentRoom = null;

  socket.on('room:join', (payload) => {
    let roomId = 'default';
    let requestedName = null;
    let requestedColor = null;

    if (typeof payload === 'object' && payload !== null) {
      roomId = (payload.roomId || 'default').toString().slice(0, 64);
      if (payload.name && typeof payload.name === 'string') requestedName = payload.name.trim().slice(0, 32);
      if (payload.color && typeof payload.color === 'string') requestedColor = payload.color.trim().slice(0, 16);
    } else if (typeof payload === 'string') {
      roomId = payload.toString().slice(0, 64);
    }

    currentRoom = roomId;
    socket.join(roomId);

    const room = getRoom(roomId);
    const idx = Object.keys(room.users).length;
    const userName = requestedName || randomName();
    const userColor = requestedColor || colorForIndex(idx);
    const initials = userName.split(' ').filter(Boolean).map(w => w[0]).join('').slice(0, 2).toUpperCase() || 'U';

    room.users[socket.id] = {
      name: userName,
      color: userColor,
      initials: initials
    };

    // Send initial state to the newly connected user
    socket.emit('room:init', {
      elements: room.elements,
      users: userList(roomId),
      me: { id: socket.id, ...room.users[socket.id] }
    });

    // Notify room of updated users list
    io.to(roomId).emit('user:list', userList(roomId));
  });

  // ---- Update User Profile (Name & Color) Live ----
  socket.on('user:update', (profile) => {
    if (!currentRoom || !profile) return;
    const room = getRoom(currentRoom);
    if (!room.users[socket.id]) return;

    if (profile.name && typeof profile.name === 'string') {
      const trimmed = profile.name.trim().slice(0, 32);
      if (trimmed) {
        room.users[socket.id].name = trimmed;
        room.users[socket.id].initials = trimmed.split(' ').filter(Boolean).map(w => w[0]).join('').slice(0, 2).toUpperCase() || 'U';
      }
    }
    if (profile.color && typeof profile.color === 'string') {
      room.users[socket.id].color = profile.color.trim().slice(0, 16);
    }

    // Broadcast updated user list to everyone
    io.to(currentRoom).emit('user:list', userList(currentRoom));
  });

  // ---- Element creation (strokes, shapes, sticky notes, text) ----
  socket.on('element:add', (element) => {
    if (!currentRoom || !element) return;
    const room = getRoom(currentRoom);
    element.userId = socket.id;
    if (!element.timestamp) element.timestamp = Date.now();

    room.elements.push(element);
    if (room.elements.length > MAX_ELEMENTS) room.elements.shift();

    socket.to(currentRoom).emit('element:add', element);
  });

  // ---- Element update (moving shapes/stickies, editing text) ----
  socket.on('element:update', (updated) => {
    if (!currentRoom || !updated || !updated.id) return;
    const room = getRoom(currentRoom);
    const idx = room.elements.findIndex(e => e.id === updated.id);
    if (idx !== -1) {
      room.elements[idx] = { ...room.elements[idx], ...updated, updatedAt: Date.now() };
      socket.to(currentRoom).emit('element:update', updated);
    }
  });

  // ---- Element delete ----
  socket.on('element:delete', (elementId) => {
    if (!currentRoom || !elementId) return;
    const room = getRoom(currentRoom);
    room.elements = room.elements.filter(e => e.id !== elementId);
    io.to(currentRoom).emit('element:delete', elementId);
  });

  // ---- Undo last element by user ----
  socket.on('element:undo', () => {
    if (!currentRoom) return;
    const room = getRoom(currentRoom);
    for (let i = room.elements.length - 1; i >= 0; i--) {
      if (room.elements[i].userId === socket.id) {
        const removed = room.elements.splice(i, 1)[0];
        io.to(currentRoom).emit('element:delete', removed.id);
        break;
      }
    }
  });

  // ---- Full board import/load ----
  socket.on('board:import', (importedElements) => {
    if (!currentRoom || !Array.isArray(importedElements)) return;
    const room = getRoom(currentRoom);
    room.elements = importedElements.slice(0, MAX_ELEMENTS);
    io.to(currentRoom).emit('board:imported', room.elements);
  });

  // ---- Real-time cursor sync with live chat text ----
  socket.on('cursor:move', (data) => {
    if (!currentRoom) return;
    socket.to(currentRoom).emit('cursor:move', { ...data, userId: socket.id });
  });

  // ---- Real-time emoji reaction burst (Figma-style) ----
  socket.on('reaction:emit', (reaction) => {
    if (!currentRoom) return;
    io.to(currentRoom).emit('reaction:emit', { ...reaction, userId: socket.id });
  });

  // ---- Radar Attention Ping ("Look here!") ----
  socket.on('radar:ping', (coord) => {
    if (!currentRoom) return;
    const room = getRoom(currentRoom);
    const user = room.users[socket.id];
    io.to(currentRoom).emit('radar:ping', { ...coord, userId: socket.id, color: user ? user.color : '#4F46E5' });
  });

  // ---- Laser trail broadcast (transient, disappears after 1.5s) ----
  socket.on('laser:trail', (pts) => {
    if (!currentRoom) return;
    socket.to(currentRoom).emit('laser:trail', { points: pts, userId: socket.id });
  });

  // ---- Clear canvas ----
  socket.on('canvas:clear', () => {
    if (!currentRoom) return;
    const room = getRoom(currentRoom);
    room.elements = [];
    io.to(currentRoom).emit('canvas:clear');
  });

  // ---- Disconnect & cleanup ----
  socket.on('disconnect', () => {
    if (!currentRoom) return;
    const room = getRoom(currentRoom);
    delete room.users[socket.id];
    io.to(currentRoom).emit('user:list', userList(currentRoom));
    io.to(currentRoom).emit('user:left', socket.id);

    if (Object.keys(room.users).length === 0) {
      setTimeout(() => {
        if (rooms[currentRoom] && Object.keys(rooms[currentRoom].users).length === 0) {
          delete rooms[currentRoom];
        }
      }, 5 * 60 * 1000);
    }
  });
});

server.listen(PORT, () => {
  console.log(`FlamSpace server running on port ${PORT}`);
});
