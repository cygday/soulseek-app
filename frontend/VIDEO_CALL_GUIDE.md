# Video Call Feature Guide

## New Features Added

### 1. **Online Users List**
- Located in the left sidebar
- Shows all active users in your current room (excluding yourself)
- Green pulsing dot indicates user is online
- Displays total count of online users

### 2. **Watch Video Button**
- Located in the top navbar
- Click **"Watch Video"** to enable your camera and audio
- This activates your video stream so others can see you
- Button changes to **"Stop Video"** when active (red color)

### 3. **Select User to Call**
- Once you click "Watch Video", you can select any online user from the sidebar list
- Click on a user's name to initiate a video call with them
- Selected user shows a green highlight with a video icon
- "Calling [username]..." appears in the navbar during active calls

### 4. **Video Display**
- Your own video appears in the top-left with "You" label
- Remote user's video appears next to yours
- All videos show with rounded corners and colored borders

## How to Make a Video Call

### Step 1: Start Your Video
1. Click the **"Watch Video"** button in the top-right
2. Allow camera and microphone access when prompted
3. Your video should appear on the left side

### Step 2: Select a User to Call
1. Look at the **"Online Users"** list on the sidebar
2. Click on any user's name to call them
3. You'll see "Calling [username]..." in the navbar

### Step 3: Accept Call (For the Recipient)
- When called, the remote user will see your video stream
- The peer connection will establish automatically if they have video enabled
- Both videos will display side by side

### Step 4: End the Call
1. Click **"Stop Video"** button to end
2. Your camera will turn off
3. All connections will be terminated
4. Remote videos will be cleared

## Backend Requirements

Your Node.js backend should emit these socket events:

```javascript
// Send list of online users when someone joins
socket.on('join', (data) => {
  socket.emit('user-list', { users: [...online users in room] });
});

// Broadcast when user joins
socket.broadcast.to(room).emit('user-joined', { sid: socket.id, username });

// Broadcast when user leaves
socket.broadcast.to(room).emit('user-left', { username });

// Handle WebRTC signaling
socket.on('signal', (data) => {
  io.to(data.target).emit('signal', { sender: socket.id, signal: data.signal });
});
```

## Important Notes

- Only one video call at a time (per design)
- You must click "Watch Video" before you can call users
- Users can see your video once you click "Watch Video"
- Network requirements: WebRTC uses p2p connections (peer-to-peer)
- For best performance, use modern browsers (Chrome, Firefox, Safari, Edge)

## Troubleshooting

**"No other users online"**
- Wait for other users to join the same room
- Make sure you're in the same chat room

**Video not showing**
- Check camera permissions in your browser
- Ensure browser allows camera access
- Try refreshing the page

**No connection to remote user**
- Both users must be in the same room
- Both must have clicked "Watch Video"
- Check internet connection and firewall settings
