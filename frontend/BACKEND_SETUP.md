# Backend Socket.io Events - Video Call Integration

## Required Socket.io Events for Video Calling

Your backend needs to handle these events to support the new video calling feature:

### 1. User List Event
**When:** User joins a room
**Emit:** `user-list` event with all current users in the room

```javascript
socket.on('join', ({ username, room }) => {
  socket.join(room);
  
  // Get all users in this room
  const usersInRoom = Object.values(io.sockets.adapter.rooms.get(room) || {})
    .map(sid => ({ sid, username: users[sid] })); // Adjust based on your storage
  
  // Send user list to the connecting user
  socket.emit('user-list', { users: usersInRoom });
  
  // Notify others that new user joined
  socket.broadcast.to(room).emit('user-joined', { sid: socket.id, username });
});
```

### 2. User Joined Event
**When:** A new user joins the room
**Emit:** `user-joined` event to all users in the room

```javascript
socket.broadcast.to(room).emit('user-joined', { 
  sid: socket.id, 
  username: username 
});
```

### 3. User Left Event
**When:** User disconnects or leaves room
**Emit:** `user-left` event to all users in the room

```javascript
socket.on('disconnect', () => {
  const rooms = Object.keys(socket.rooms);
  rooms.forEach(room => {
    socket.broadcast.to(room).emit('user-left', { username });
  });
});
```

### 4. WebRTC Signal Event (Already Implemented)
**When:** WebRTC peer sends a signal
**Relay:** Signal to target user

```javascript
socket.on('signal', ({ target, signal }) => {
  io.to(target).emit('signal', { 
    sender: socket.id, 
    signal: signal 
  });
});
```

## Complete Example Backend Handler

```javascript
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: { origin: 'http://localhost:5173', methods: ['GET', 'POST'] }
});

// Store username mapping for socket IDs
const users = {};

io.on('connection', (socket) => {
  console.log('New client connected:', socket.id);

  socket.on('join', ({ username, room }) => {
    socket.join(room);
    users[socket.id] = { username, room };

    // Get all users in this room
    const roomUsers = Object.entries(users)
      .filter(([_, u]) => u.room === room && _ !== socket.id)
      .map(([sid, u]) => ({ sid, username: u.username }));

    // Send user list to joining user
    socket.emit('user-list', { users: roomUsers });

    // Notify others about new user
    socket.broadcast.to(room).emit('user-joined', {
      sid: socket.id,
      username: username
    });

    console.log(`${username} joined room: ${room}`);
  });

  socket.on('message', ({ room, username, text }) => {
    io.to(room).emit('message', { user: username, text });
  });

  socket.on('signal', ({ target, signal }) => {
    io.to(target).emit('signal', {
      sender: socket.id,
      signal: signal
    });
  });

  socket.on('disconnect', () => {
    const user = users[socket.id];
    if (user) {
      socket.broadcast.to(user.room).emit('user-left', {
        username: user.username
      });
      console.log(`${user.username} left room: ${user.room}`);
    }
    delete users[socket.id];
  });
});

server.listen(5000, () => {
  console.log('Server running on port 5000');
});
```

## Key Points

1. **User Tracking**: You must track which user is connected to which socket ID
2. **Room-Based Filtering**: Only send user lists/events to users in the same room
3. **Self Filtering**: Don't include the user in their own user list (frontend filters this too)
4. **Real-time Updates**: Send events whenever users join/leave
5. **Signal Relay**: Forward WebRTC signals between peers

## Testing the Video Call

1. Open app in two browser windows
2. Login with different usernames in the same room
3. Both click "Watch Video"
4. Select each other from the user list
5. Video streams should connect
6. You should see both video feeds
