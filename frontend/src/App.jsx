import { useState, useEffect, useRef, useCallback } from 'react';
import io from 'socket.io-client';
import Peer from 'simple-peer';
import { MessageSquare, Video, File, Send, Users, PhoneOff, Menu } from 'lucide-react';

// 1. CHANGE THIS: Put your laptop's local IP (if testing locally) or your Render production URL here.
const BACKEND_URL = "http://127.0.0.1:5000"; 
const socket = io(BACKEND_URL, { autoConnect: false, reconnection: true, reconnectionDelay: 1000, reconnectionDelayMax: 5000, reconnectionAttempts: 5 });

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
    <div style={{ position: 'relative', width: '100%', height: '260px', flexShrink: 0, borderRadius: 8, overflow: 'hidden' }}>
      <video
        ref={videoRef}
        autoPlay
        playsInline
        style={{ width: '100%', height: '100%', backgroundColor: 'black', borderRadius: '8px', objectFit: 'cover' }}
      />
      <span style={{ position: 'absolute', bottom: '8px', left: '8px', backgroundColor: 'rgba(0,0,0,0.6)', padding: '4px 6px', borderRadius: '6px', fontSize: '12px' }}>
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
  const myThumbRef = useRef();
  const messagesEndRef = useRef(null);
  const [selectedPeerId, setSelectedPeerId] = useState(null);
  const audioContextRef = useRef(null);
  const analyzerRef = useRef({});
  const socketRef = useRef(socket);
  const usernameRef = useRef('');
  const roomRef = useRef('');

  const initiateCall = useCallback((targetSid, targetUsername, localStream) => {
    if (peersRef.current.find(p => p.peerID === targetSid)) {
      return;
    }
    const peer = new Peer({ initiator: true, trickle: false, stream: localStream || undefined });
    peer.on('signal', (signal) => {
      socketRef.current.emit('signal', { target: targetSid, room: roomRef.current, username: usernameRef.current, signal });
    });
    peer.on('connect', () => {
      console.log(`WebRTC connected to ${targetUsername}`);
    });
    const peerObj = { peerID: targetSid, username: targetUsername, peer };
    peersRef.current.push(peerObj);
    setPeers(prev => [...prev, peerObj]);
  }, []);

  const acceptCall = useCallback((senderSid, incomingSignal, localStream) => {
    if (peersRef.current.find(p => p.peerID === senderSid)) {
      return peersRef.current.find(p => p.peerID === senderSid).peer;
    }
    const peer = new Peer({ initiator: false, trickle: false, stream: localStream || undefined });
    peer.on('signal', (signal) => {
      socketRef.current.emit('signal', { target: senderSid, room: roomRef.current, username: usernameRef.current, signal });
    });
    peer.on('connect', () => {
      console.log(`WebRTC connected to ${senderSid}`);
    });
    peer.signal(incomingSignal);
    const peerObj = { peerID: senderSid, username: 'Remote User', peer };
    peersRef.current.push(peerObj);
    setPeers(prev => [...prev, peerObj]);
    return peer;
  }, []);

  // Active speaker detection: analyze audio levels from remote peers
  const detectActiveSpeaker = useCallback(() => {
    if (peers.length === 0) return;
    
    let audioContext = audioContextRef.current;
    if (!audioContext) {
      try {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
        audioContextRef.current = audioContext;
      } catch (e) {
        console.warn('AudioContext not supported:', e);
        return;
      }
    }

    let maxLevel = -Infinity;
    let loudestPeerId = selectedPeerId;

    peers.forEach((peerObj) => {
      const { peerID } = peerObj;
      const audioTrack = peerObj.peer._pc?.getReceivers?.()
        .find(r => r.track?.kind === 'audio')?.track;

      if (!audioTrack || !audioTrack.enabled) return;

      let analyzer = analyzerRef.current[peerID];
      if (!analyzer) {
        try {
          const stream = new MediaStream([audioTrack]);
          const source = audioContext.createMediaStreamSource(stream);
          analyzer = audioContext.createAnalyser();
          analyzer.fftSize = 256;
          source.connect(analyzer);
          analyzerRef.current[peerID] = analyzer;
        } catch (e) {
          console.warn(`Failed to set up analyzer for ${peerID}:`, e);
          return;
        }
      }

      const dataArray = new Uint8Array(analyzer.frequencyBinCount);
      analyzer.getByteFrequencyData(dataArray);
      const average = dataArray.reduce((a, b) => a + b, 0) / dataArray.length;

      if (average > maxLevel) {
        maxLevel = average;
        loudestPeerId = peerID;
      }
    });

    // Auto-select loudest speaker if threshold exceeded
    if (maxLevel > 30 && loudestPeerId !== selectedPeerId) {
      setSelectedPeerId(loudestPeerId);
    }
  }, [peers, selectedPeerId]);

  // Run active speaker detection every 200ms
  useEffect(() => {
    if (!inVideoCall && !isWatching) return;
    const interval = setInterval(() => detectActiveSpeaker(), 200);
    return () => clearInterval(interval);
  }, [inVideoCall, isWatching, detectActiveSpeaker]);

  const removeRemoteVideo = (sid) => {
    peersRef.current = peersRef.current.filter(p => p.peerID !== sid);
    setPeers(prev => prev.filter(p => p.peerID !== sid));
  };

  // Set up socket listeners on mount (before connection)
  useEffect(() => {
    // Pre-register listeners to catch all events
    socket.on('message', (msg) => {
      console.log('Message received:', msg);
      setMessages((prev) => [...prev, msg]);
    });

    socket.on('user-joined', ({ sid, username: joinedUser }) => {
      console.log(`User joined: ${joinedUser} (${sid})`);
      if (stream || isWatching) {
        initiateCall(sid, joinedUser, stream);
      }
    });

    socket.on('room-users', ({ users: roomUsers }) => {
      console.log('Room users received:', roomUsers);
      setRoomUsers(roomUsers || []);
      if (!roomUsers || roomUsers.length === 0) return;

      const activeStreamers = roomUsers.filter(u => u.streaming);
      activeStreamers.forEach(u => {
        if (!peersRef.current.find(p => p.peerID === u.sid) && (stream || isWatching)) {
          initiateCall(u.sid, u.username, stream);
        }
      });
    });

    socket.on('stream-status', ({ sid, username: streamerName, streaming }) => {
      console.log(`Stream status: ${streamerName} - ${streaming}`);
      setRoomUsers((prev) => {
        const next = prev.map((user) => user.sid === sid ? { ...user, streaming } : user);
        if (!prev.find((user) => user.sid === sid)) {
          next.push({ sid, username: streamerName, streaming });
        }
        return next;
      });

      if (streaming && (stream || isWatching)) {
        if (!peersRef.current.find(p => p.peerID === sid)) {
          initiateCall(sid, streamerName, stream);
        }
      } else if (!streaming) {
        removeRemoteVideo(sid);
      }
    });

    socket.on('signal', ({ sender, username: senderName, signal }) => {
      console.log(`Signal received from ${senderName}`);
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
      console.log(`User left: ${sid}`);
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
  }, [stream, isWatching, initiateCall, acceptCall]);

  // Handle local video element layout mapping
  useEffect(() => {
    if (stream) {
      if (myVideoRef.current) myVideoRef.current.srcObject = stream;
      if (myThumbRef.current) myThumbRef.current.srcObject = stream;
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
      usernameRef.current = username;
      roomRef.current = room;
      setIsLoggedIn(true);
      
      // Ensure socket listeners are attached BEFORE connecting
      if (!socket.hasListeners('connect')) {
        socket.once('connect', () => {
          console.log('Socket connected:', socket.id);
          socket.emit('join', { username, room });
          socket.emit('get-room-users', { room });
        });
      }
      
      if (!socket.connected) {
        socket.connect();
      } else {
        socket.emit('join', { username, room });
        socket.emit('get-room-users', { room });
      }
    }
  };

  const sendMessage = (e) => {
    e.preventDefault();
    if (message.trim()) {
      socketRef.current.emit('message', { room: roomRef.current, username: usernameRef.current, text: message });
      setMessage('');
    }
  };

  const watchVideo = () => {
    setIsWatching(true);
    setInVideoCall(false);
    socketRef.current.emit('get-room-users', { room: roomRef.current });
  };

  const stopWatching = () => {
    setIsWatching(false);
    peersRef.current.forEach((p) => {
      try { p.peer.destroy(); } catch (e) {}
    });
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
      socketRef.current.emit('file-shared', { room: roomRef.current, username: usernameRef.current, filename: data.filename, fileUrl: data.url });
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
      socketRef.current.emit('stream-start', { room: roomRef.current });
      socketRef.current.emit('get-room-users', { room: roomRef.current });
    } catch (err) {
      alert("Camera configuration failed. Ensure you are utilizing HTTPS or Localhost endpoints.");
      console.error(err);
    }
  };

  const endVideoCall = () => {
    if (stream) {
      stream.getTracks().forEach(track => track.stop());
    }
    Object.values(analyzerRef.current).forEach(a => {
      try { a.disconnect?.(); } catch (e) {}
    });
    analyzerRef.current = {};
    peersRef.current.forEach(p => {
      try { p.peer.destroy(); } catch (e) {}
    });
    peersRef.current = [];
    setPeers([]);
    setStream(null);
    setInVideoCall(false);
    socketRef.current.emit('stream-stop', { room: roomRef.current });
    socketRef.current.emit('signal', { room: roomRef.current, signal: 'disconnect' });
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

        {/* Video Dock Panel - main + thumbnail column layout */}
        {(inVideoCall || isWatching || peers.length > 0) && (
          <div style={{ backgroundColor: '#0f172a', padding: '12px', display: 'flex', gap: '12px', overflow: 'hidden', borderBottom: '1px solid #1e293b', alignItems: 'stretch', flexShrink: 0 }}>
            {/* Main video area */}
            <div style={{ flex: 1, minHeight: '320px', borderRadius: 8, overflow: 'hidden', backgroundColor: '#000', display: 'flex', alignItems: 'stretch' }}>
              {/** If user selected themselves, show local; otherwise show selected peer (or first peer) **/}
              {selectedPeerId === 'me' && inVideoCall ? (
                <div style={{ position: 'relative', width: '100%', height: '100%' }}>
                  <video ref={myVideoRef} autoPlay muted playsInline style={{ width: '100%', height: '100%', objectFit: 'cover', transform: 'scaleX(-1)' }} />
                  <span style={{ position: 'absolute', bottom: '12px', left: '12px', backgroundColor: 'rgba(0,0,0,0.6)', padding: '6px 8px', borderRadius: 6 }}>You</span>
                </div>
              ) : (
                (() => {
                  const sel = peers.find(p => p.peerID === selectedPeerId) || peers[0];
                  return sel ? <RemoteVideo key={sel.peerID} peerObj={sel} /> : (
                    <div style={{ color: '#94a3b8', fontSize: '13px', padding: 12 }}>No active video selected.</div>
                  );
                })()
              )}
            </div>

            {/* Thumbnail column */}
            <div style={{ width: '220px', display: 'flex', flexDirection: 'column', gap: '10px', overflowY: 'auto' }}>
              {/* Local thumbnail (if streaming) */}
              {inVideoCall && (
                <div onClick={() => setSelectedPeerId('me')} style={{ cursor: 'pointer' }}>
                  <div style={{ position: 'relative', width: '100%', height: '120px', borderRadius: 8, overflow: 'hidden', backgroundColor: '#000' }}>
                    <video ref={myThumbRef} autoPlay muted playsInline style={{ width: '100%', height: '100%', objectFit: 'cover', transform: 'scaleX(-1)' }} />
                    <span style={{ position: 'absolute', bottom: '8px', left: '8px', backgroundColor: 'rgba(0,0,0,0.6)', padding: '4px 6px', borderRadius: '6px', fontSize: '12px' }}>You</span>
                  </div>
                </div>
              )}

              {/* Remote thumbnails */}
              {peers.length > 0 ? (
                peers.map((peerObj) => (
                  <div key={peerObj.peerID} onClick={() => setSelectedPeerId(peerObj.peerID)} style={{ cursor: 'pointer' }}>
                    <div style={{ position: 'relative', width: '100%', height: '120px', borderRadius: 8, overflow: 'hidden', backgroundColor: '#000', border: selectedPeerId === peerObj.peerID ? '3px solid #6366f1' : '2px solid transparent', transition: 'border 0.15s ease' }}>
                      <RemoteVideo peerObj={peerObj} />
                    </div>
                  </div>
                ))
              ) : (
                <div style={{ color: '#94a3b8', fontSize: '13px' }}>{isWatching ? 'Watching for active participants...' : 'No participants yet'}</div>
              )}
            </div>
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
