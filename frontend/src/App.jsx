import { useState, useEffect, useRef, useCallback } from 'react';
import io from 'socket.io-client';
import Peer from 'simple-peer';
import { MessageSquare, Video, File, Send, Users, PhoneOff, Menu } from 'lucide-react';

// 1. CHANGE THIS: Put your laptop's local IP (if testing locally) or your Render production URL here.
const BACKEND_URL = "https://soulseek-app.onrender.com"; 
const socket = io(BACKEND_URL, { autoConnect: false });

function RemoteVideo({ peerObj }) {
  const videoRef = useRef();

  useEffect(() => {
    peerObj.peer.on('stream', (remoteStream) => {
      if (videoRef.current) {
        videoRef.current.srcObject = remoteStream;
      }
    });
  }, [peerObj]);

  return (
    <div style={{ position: 'relative', width: '120px', height: '90px', flexShrink: 0 }}>
      <video
        ref={videoRef}
        autoPlay
        playsInline
        style={{ width: '120px', height: '90px', backgroundColor: 'black', borderRadius: '8px', objectFit: 'cover' }}
      />
      <span style={{ position: 'absolute', bottom: '4px', left: '4px', backgroundColor: 'rgba(0,0,0,0.6)', padding: '2px 4px', borderRadius: '4px', fontSize: '10px' }}>
        {peerObj.username || "User"}
      </span>
    </div>
  );
}

export default function App() {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [username, setUsername] = useState('');
  const [room, setRoom] = useState('Global');
  const [message, setMessage] = useState('');
  const [messages, setMessages] = useState([]);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  
  const [inVideoCall, setInVideoCall] = useState(false);
  const [isWatching, setIsWatching] = useState(false);
  const [roomUsers, setRoomUsers] = useState([]);
  const [stream, setStream] = useState(null);
  const [peers, setPeers] = useState([]); 
  
  const peersRef = useRef([]); 
  const myVideoRef = useRef();
  const messagesEndRef = useRef(null);

  const initiateCall = useCallback((targetSid, targetUsername, localStream) => {
    if (peersRef.current.find(p => p.peerID === targetSid)) {
      return;
    }
    const peer = new Peer({ initiator: true, trickle: false, stream: localStream || undefined });
    peer.on('signal', (signal) => {
      socket.emit('signal', { target: targetSid, username, signal });
    });
    peer.on('connect', () => {
      console.log(`WebRTC connected to ${targetUsername}`);
    });
    const peerObj = { peerID: targetSid, username: targetUsername, peer };
    peersRef.current.push(peerObj);
    setPeers(prev => [...prev, peerObj]);
  }, [username]);

  const acceptCall = useCallback((senderSid, incomingSignal, localStream) => {
    if (peersRef.current.find(p => p.peerID === senderSid)) {
      return peersRef.current.find(p => p.peerID === senderSid).peer;
    }
    const peer = new Peer({ initiator: false, trickle: false, stream: localStream || undefined });
    peer.on('signal', (signal) => {
      socket.emit('signal', { target: senderSid, username, signal });
    });
    peer.signal(incomingSignal);
    return peer;
  }, [username]);

  const removeRemoteVideo = (sid) => {
    peersRef.current = peersRef.current.filter(p => p.peerID !== sid);
    setPeers(prev => prev.filter(p => p.peerID !== sid));
  };

  // Core Networking Event Listeners
  useEffect(() => {
    if (!isLoggedIn) return;

    // Listen for incoming messages
    socket.on('message', (msg) => {
      setMessages((prev) => [...prev, msg]);
    });

    // WebRTC: Another user joined and is ready to establish a video connection
    socket.on('user-joined', ({ sid, username: joinedUser }) => {
      console.log(`Signaling target spotted: ${joinedUser} (${sid})`);
      if (stream || isWatching) {
        initiateCall(sid, joinedUser, stream);
      }
    });

    // New user list for the room, including stream activity
    socket.on('room-users', ({ users: roomUsers }) => {
      setRoomUsers(roomUsers || []);
      if (!roomUsers || roomUsers.length === 0) return;

      const activeStreamers = roomUsers.filter(u => u.streaming);
      activeStreamers.forEach(u => {
        if (!peersRef.current.find(p => p.peerID === u.sid)) {
          initiateCall(u.sid, u.username, stream);
        }
      });
    });

    socket.on('stream-status', ({ sid, username: streamerName, streaming }) => {
      setRoomUsers((prev) => {
        const next = prev.map((user) => user.sid === sid ? { ...user, streaming } : user);
        if (!prev.find((user) => user.sid === sid)) {
          next.push({ sid, username: streamerName, streaming });
        }
        return next;
      });

      if (streaming) {
        if (!peersRef.current.find(p => p.peerID === sid)) {
          initiateCall(sid, streamerName, stream);
        }
      } else {
        removeRemoteVideo(sid);
      }
    });

    // WebRTC Handshake signaling channel
    socket.on('signal', ({ sender, username: senderName, signal }) => {
      const peerMatch = peersRef.current.find(p => p.peerID === sender);
      if (peerMatch) {
        peerMatch.peer.signal(signal);
      } else {
        const incomingPeer = acceptCall(sender, signal, stream);
        const newPeerObj = { peerID: sender, username: senderName, peer: incomingPeer };
        peersRef.current.push(newPeerObj);
        setPeers(prev => [...prev, newPeerObj]);
      }
    });

    socket.on('user-left', ({ sid }) => {
      removeRemoteVideo(sid);
    });

    return () => {
      socket.off('message');
      socket.off('user-joined');
      socket.off('room-users');
      socket.off('stream-status');
      socket.off('signal');
      socket.off('user-left');
    };
  }, [isLoggedIn, stream, isWatching, initiateCall, acceptCall]);

  // Handle local video element layout mapping
  useEffect(() => {
    if (stream && myVideoRef.current) {
      myVideoRef.current.srcObject = stream;
    }
  }, [stream, inVideoCall]);

  // Scroll to bottom helper
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // FIXED: Explicitly establish connection right on submission
  const handleLogin = (e) => {
    e.preventDefault();
    if (username.trim()) {
      setIsLoggedIn(true);
      socket.io.opts.extraHeaders = {}; 
      socket.connect(); // Force immediate engine connection
      socket.emit('join', { username, room });
      socket.emit('get-room-users', { room });
    }
  };

  const sendMessage = (e) => {
    e.preventDefault();
    if (message.trim()) {
      // Fire payload straight to backend
      socket.emit('message', { room, username, text: message });
      setMessage('');
    }
  };

  const watchVideo = () => {
    setIsWatching(true);
    setInVideoCall(false);
    socket.emit('get-room-users', { room });
  };

  const stopWatching = () => {
    setIsWatching(false);
    peersRef.current.forEach((p) => p.peer.destroy());
    peersRef.current = [];
    setPeers([]);
  };

  const handleFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const formData = new FormData();
    formData.append('file', file);

    try {
      const res = await fetch(`${BACKEND_URL}/upload`, { method: 'POST', body: formData });
      const data = await res.json();
      socket.emit('file-shared', { room, username, filename: data.filename, fileUrl: data.url });
    } catch (err) {
      console.error("Upload route dropped connection.", err);
    }
  };

  const startVideo = async () => {
    try {
      const constraints = { video: { width: 320, height: 240, facingMode: "user" }, audio: true };
      const localStream = await navigator.mediaDevices.getUserMedia(constraints);
      setStream(localStream);
      setInVideoCall(true);
      socket.emit('stream-start', { room });
      socket.emit('get-room-users', { room });
    } catch (err) {
      alert("Camera configuration failed. Ensure you are utilizing HTTPS or Localhost endpoints.");
      console.error(err);
    }
  };

  const endVideoCall = () => {
    if (stream) {
      stream.getTracks().forEach(track => track.stop());
    }
    peersRef.current.forEach(p => p.peer.destroy());
    peersRef.current = [];
    setPeers([]);
    setStream(null);
    setInVideoCall(false);
    socket.emit('stream-stop', { room });
    socket.emit('signal', { room, signal: 'disconnect' }); 
  };

  const activeStreamers = roomUsers.filter((u) => u.streaming);

  if (!isLoggedIn) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100svh', backgroundColor: '#0f172a', color: 'white', fontFamily: 'sans-serif', padding: '16px', boxSizing: 'border-box' }}>
        <form onSubmit={handleLogin} style={{ backgroundColor: '#1e293b', padding: '24px', borderRadius: '12px', width: '100%', maxWidth: '340px', boxSizing: 'border-box' }}>
          <h2 style={{ fontSize: '22px', marginBottom: '20px', display: 'flex', alignItems: 'center', gap: '8px', justifyContent: 'center' }}><MessageSquare /> SoulSeek Rooms</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div>
              <label style={{ display: 'block', fontSize: '13px', marginBottom: '4px', color: '#94a3b8' }}>Username</label>
              <input type="text" style={{ width: '100%', padding: '10px', borderRadius: '6px', border: '1px solid #475569', backgroundColor: '#020617', color: 'white', boxSizing: 'border-box' }} value={username} onChange={e => setUsername(e.target.value)} required />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '13px', marginBottom: '4px', color: '#94a3b8' }}>Room ID</label>
              <input type="text" style={{ width: '100%', padding: '10px', borderRadius: '6px', border: '1px solid #475569', backgroundColor: '#020617', color: 'white', boxSizing: 'border-box' }} value={room} onChange={e => setRoom(e.target.value)} required />
            </div>
            <button type="submit" style={{ width: '100%', backgroundColor: '#4f46e5', color: 'white', padding: '12px', borderRadius: '6px', border: 'none', fontWeight: 'bold', cursor: 'pointer', marginTop: '8px' }}>Enter Room</button>
          </div>
        </form>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', height: '100svh', backgroundColor: '#020617', color: '#f8fafc', fontFamily: 'sans-serif', overflow: 'hidden', position: 'relative' }}>
      
      {sidebarOpen && (
        <div onClick={() => setSidebarOpen(false)} style={{ position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 40 }} />
      )}
      
      <div style={{
        width: '240px', backgroundColor: '#0f172a', padding: '16px', display: 'flex', flexDirection: 'column', borderRight: '1px solid #1e293b',
        position: 'absolute', top: 0, bottom: 0, left: sidebarOpen ? 0 : '-240px', zIndex: 50, transition: 'left 0.25s ease-out', boxSizing: 'border-box'
      }}>
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
            <h3 style={{ color: '#818cf8', margin: 0 }}>🕹️ SoulSeek V2</h3>
            <button onClick={() => setSidebarOpen(false)} style={{ background: 'none', border: 'none', color: '#94a3b8', fontSize: '18px', cursor: 'pointer' }}>✕</button>
          </div>
          <p style={{ fontSize: '11px', color: '#64748b', textTransform: 'uppercase', fontWeight: 'bold', margin: '0 0 8px 0' }}>Channels</p>
          <div style={{ padding: '10px', backgroundColor: '#1e293b', borderRadius: '6px', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '14px' }}><Users size={14}/> #{room}</div>
          <div style={{ fontSize: '13px', padding: '10px', backgroundColor: '#020617', borderRadius: '6px', marginTop: 'auto' }}>User: <b>{username}</b></div>
        </div>
      </div>

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', width: '100%', height: '100%', overflow: 'hidden' }}>
        
        <div style={{ height: '60px', backgroundColor: '#0f172a', borderBottom: '1px solid #1e293b', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 16px', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <button onClick={() => setSidebarOpen(!sidebarOpen)} style={{ background: 'none', border: 'none', color: 'white', cursor: 'pointer', display: 'flex', alignItems: 'center', padding: 0 }}>
              <Menu size={22} />
            </button>
            <div style={{ fontWeight: 'bold', fontSize: '15px' }}>#{room} Lounge</div>
          </div>
          
          {!inVideoCall ? (
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              <button onClick={startVideo} style={{ display: 'flex', alignItems: 'center', gap: '6px', backgroundColor: '#4f46e5', color: 'white', border: 'none', padding: '8px 12px', borderRadius: '6px', cursor: 'pointer', fontSize: '13px', fontWeight: 'bold' }}>
                <Video size={14} /> Video Call
              </button>
              {!isWatching ? (
                <button onClick={watchVideo} style={{ display: 'flex', alignItems: 'center', gap: '6px', backgroundColor: '#0f172a', color: 'white', border: '1px solid #4f46e5', padding: '8px 12px', borderRadius: '6px', cursor: 'pointer', fontSize: '13px', fontWeight: 'bold' }}>
                  Watch Video
                </button>
              ) : (
                <button onClick={stopWatching} style={{ display: 'flex', alignItems: 'center', gap: '6px', backgroundColor: '#ef4444', color: 'white', border: 'none', padding: '8px 12px', borderRadius: '6px', cursor: 'pointer', fontSize: '13px', fontWeight: 'bold' }}>
                  Stop Watching
                </button>
              )}
            </div>
          ) : (
            <button onClick={endVideoCall} style={{ display: 'flex', alignItems: 'center', gap: '6px', backgroundColor: '#ef4444', color: 'white', border: 'none', padding: '8px 12px', borderRadius: '6px', cursor: 'pointer', fontSize: '13px', fontWeight: 'bold' }}>
              <PhoneOff size={14} /> Hang Up
            </button>
          )}
        </div>

        {/* Video Dock Panel */}
        {(inVideoCall || isWatching || peers.length > 0) && (
          <div style={{ backgroundColor: '#0f172a', padding: '10px', display: 'flex', flexWrap: 'wrap', gap: '12px', overflowY: 'auto', borderBottom: '1px solid #1e293b', alignItems: 'flex-start', flexShrink: 0, minHeight: '110px' }}>
            {inVideoCall && (
              <div style={{ position: 'relative', width: '120px', height: '90px', flexShrink: 0 }}>
                <video ref={myVideoRef} autoPlay muted playsInline style={{ width: '120px', height: '90px', backgroundColor: 'black', borderRadius: '8px', transform: 'scaleX(-1)', objectFit: 'cover' }} />
                <span style={{ position: 'absolute', bottom: '4px', left: '4px', backgroundColor: 'rgba(0,0,0,0.6)', padding: '2px 4px', borderRadius: '4px', fontSize: '10px' }}>You</span>
              </div>
            )}
            
            {peers.length > 0 ? (
              peers.map((peerObj) => (
                <RemoteVideo key={peerObj.peerID} peerObj={peerObj} />
              ))
            ) : (
              <div style={{ color: '#94a3b8', fontSize: '13px', lineHeight: '1.4' }}>
                {isWatching
                  ? 'Watching for active video call participants...'
                  : 'Waiting for others to join the video call...'}
              </div>
            )}
          </div>
        )}
        {!inVideoCall && activeStreamers.length > 0 && !isWatching && (
          <div style={{ padding: '10px 16px', color: '#c7d2fe', fontSize: '13px', backgroundColor: '#111827', borderTop: '1px solid #1e293b' }}>
            {activeStreamers.length} user{activeStreamers.length > 1 ? 's' : ''} currently sharing video. Click Watch Video to join them.
          </div>
        )}

        <div style={{ flex: 1, overflowY: 'auto', padding: '16px', display: 'flex', flexDirection: 'column', gap: '10px', backgroundColor: '#020617' }}>
          {messages.map((msg, idx) => (
            <div key={idx} style={{ alignSelf: msg.user === 'System' ? 'center' : 'flex-start', opacity: msg.user === 'System' ? 0.6 : 1, width: msg.user === 'System' ? 'auto' : '100%', maxWidth: '85%' }}>
              <div style={{ backgroundColor: msg.user === 'System' ? 'transparent' : '#0f172a', padding: msg.user === 'System' ? '4px' : '10px', borderRadius: '8px', border: msg.user === 'System' ? 'none' : '1px solid #1e293b' }}>
                {msg.user !== 'System' && (
                  <span style={{ display: 'block', fontSize: '11px', fontWeight: 'bold', color: '#818cf8', marginBottom: '2px' }}>{msg.user}</span>
                )}
                <p style={{ margin: 0, fontSize: '13px', wordBreak: 'break-word', lineHeight: '1.4' }}>{msg.text}</p>
                {msg.fileUrl && (
                  <a href={msg.fileUrl} target="_blank" rel="noreferrer" style={{ marginTop: '6px', display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '11px', color: '#a5b4fc', textDecoration: 'none' }}>
                    <File size={12}/> Asset Download
                  </a>
                )}
              </div>
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>

        <div style={{ padding: '12px', backgroundColor: '#0f172a', borderTop: '1px solid #1e293b', flexShrink: 0 }}>
          <form onSubmit={sendMessage} style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <label style={{ cursor: 'pointer', padding: '10px', backgroundColor: '#1e293b', borderRadius: '6px', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <File size={16} style={{ color: '#94a3b8' }} />
              <input type="file" style={{ display: 'none' }} onChange={handleFileUpload} />
            </label>
            <input type="text" placeholder="Type a message..." style={{ flex: 1, minWidth: 0, backgroundColor: '#020617', border: '1px solid #1e293b', borderRadius: '6px', padding: '10px 12px', color: 'white', fontSize: '14px', boxSizing: 'border-box' }} value={message} onChange={e => setMessage(e.target.value)} />
            <button type="submit" style={{ height: '38px', backgroundColor: '#4f46e5', color: 'white', border: 'none', padding: '0 14px', borderRadius: '6px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Send size={14} /></button>
          </form>
        </div>

      </div>
    </div>
  );
}
