import React, { useState, useEffect, useRef } from 'react';
import io from 'socket.io-client';
import Peer from 'simple-peer';
import { MessageSquare, Video, File, Send, LogIn, Users, PhoneOff } from 'lucide-react';

// Change this URL to your production Render URL when deploying!
const socket = io('https://soulseek-app.onrender.com', { autoConnect: false });

export default function App() {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [username, setUsername] = useState('');
  const [room, setRoom] = useState('Global');
  const [message, setMessage] = useState('');
  const [messages, setMessages] = useState([]);
  
  // Video Calling States
  const [inVideoCall, setInVideoCall] = useState(false);
  const [stream, setStream] = useState(null);
  const peersRef = useRef([]); 
  
  const myVideoRef = useRef();
  const remoteVideoContainerRef = useRef();

  useEffect(() => {
    if (!isLoggedIn) return;

    socket.connect();
    socket.emit('join', { username, room });

    socket.on('message', (msg) => {
      setMessages((prev) => [...prev, msg]);
    });

    socket.on('user-joined', ({ sid, username: joinedUser }) => {
      console.log(`${joinedUser} joined, setting up WebRTC handshake...`);
      if (stream) {
        initiateCall(sid, stream);
      }
    });

    socket.on('signal', ({ sender, signal }) => {
      const peer = peersRef.current.find(p => p.peerID === sender);
      if (peer) {
        peer.peer.signal(signal);
      } else if (stream) {
        const incomingPeer = acceptCall(sender, signal, stream);
        peersRef.current.push({ peerID: sender, peer: incomingPeer });
      }
    });

    socket.on('user-left', ({ sid }) => {
      removeRemoteVideo(sid);
    });

    return () => {
      socket.off('message');
      socket.off('user-joined');
      socket.off('signal');
      socket.off('user-left');
      socket.disconnect();
    };
  }, [isLoggedIn, room, stream]);

  const handleLogin = (e) => {
    e.preventDefault();
    if (username.trim()) setIsLoggedIn(true);
  };

  const sendMessage = (e) => {
    e.preventDefault();
    if (message.trim()) {
      socket.emit('message', { room, username, text: message });
      setMessage('');
    }
  };

  const handleFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const formData = new FormData();
    formData.append('file', file);

    try {
      const res = await fetch('http://localhost:5000/upload', { method: 'POST', body: formData });
      const data = await res.json();
      socket.emit('file-shared', { room, username, filename: data.filename, fileUrl: data.url });
    } catch (err) {
      console.error("File upload failed", err);
    }
  };

  // WebRTC Stream Setup
  const startVideo = async () => {
    try {
      const localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      setStream(localStream);
      setInVideoCall(true);
      if (myVideoRef.current) myVideoRef.current.srcObject = localStream;
    } catch (err) {
      console.error("Failed to access media devices.", err);
    }
  };

  // Close Video Call Sequence
  const endVideoCall = () => {
    // 1. Stop webcam and mic tracks hardware-side
    if (stream) {
      stream.getTracks().forEach(track => track.stop());
    }
    
    // 2. Destroy all WebRTC peer connections safely
    peersRef.current.forEach(p => {
      p.peer.destroy();
    });
    peersRef.current = [];

    // 3. Purge the remote elements out of DOM container
    if (remoteVideoContainerRef.current) {
      remoteVideoContainerRef.current.innerHTML = '';
    }

    // 4. Update states to shift layout back
    setStream(null);
    setInVideoCall(false);
    
    // Let others know we left the stream
    socket.emit('signal', { room, signal: 'disconnect' }); 
  };

  const initiateCall = (targetSid, localStream) => {
    const peer = new Peer({ initiator: true, trickle: false, stream: localStream });
    peer.on('signal', (signal) => {
      socket.emit('signal', { target: targetSid, signal });
    });
    peer.on('stream', (remoteStream) => {
      addRemoteVideo(targetSid, remoteStream);
    });
    peersRef.current.push({ peerID: targetSid, peer });
  };

  const acceptCall = (senderSid, incomingSignal, localStream) => {
    const peer = new Peer({ initiator: false, trickle: false, stream: localStream });
    peer.on('signal', (signal) => {
      socket.emit('signal', { target: senderSid, signal });
    });
    peer.on('stream', (remoteStream) => {
      addRemoteVideo(senderSid, remoteStream);
    });
    peer.signal(incomingSignal);
    return peer;
  };

  const addRemoteVideo = (sid, remoteStream) => {
    if (document.getElementById(sid)) return;
    const video = document.createElement('video');
    video.id = sid;
    video.srcObject = remoteStream;
    video.autoplay = true;
    video.style.width = "192px";
    video.style.height = "144px";
    video.style.backgroundColor = "black";
    video.style.borderRadius = "8px";
    video.style.margin = "8px";
    remoteVideoContainerRef.current?.appendChild(video);
  };

  const removeRemoteVideo = (sid) => {
    const videoElement = document.getElementById(sid);
    if (videoElement) videoElement.remove();
    peersRef.current = peersRef.current.filter(p => p.peerID !== sid);
  };

  if (!isLoggedIn) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', backgroundColor: '#0f172a', color: 'white', fontFamily: 'sans-serif' }}>
        <form onSubmit={handleLogin} style={{ backgroundColor: '#1e293b', padding: '32px', borderRadius: '12px', width: '320px' }}>
          <h2 style={{ fontSize: '24px', marginBottom: '24px', display: 'flex', alignItems: 'center', gap: '8px' }}><MessageSquare /> SoulSeek Rooms</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div>
              <label style={{ display: 'block', fontSize: '14px', marginBottom: '4px', color: '#94a3b8' }}>Username</label>
              <input type="text" style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid #475569', backgroundColor: '#020617', color: 'white' }} value={username} onChange={e => setUsername(e.target.value)} required />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '14px', marginBottom: '4px', color: '#94a3b8' }}>Room ID</label>
              <input type="text" style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid #475569', backgroundColor: '#020617', color: 'white' }} value={room} onChange={e => setRoom(e.target.value)} required />
            </div>
            <button type="submit" style={{ width: '100%', backgroundColor: '#4f46e5', color: 'white', padding: '10px', borderRadius: '4px', border: 'none', fontWeight: 'bold', cursor: 'pointer', marginTop: '12px' }}>Enter Room</button>
          </div>
        </form>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', height: '100vh', backgroundColor: '#020617', color: '#f8fafc', fontFamily: 'sans-serif' }}>
      {/* Channels Sidebar */}
      <div style={{ width: '240px', backgroundColor: '#0f172a', padding: '16px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', borderRight: '1px solid #1e293b' }}>
        <div>
          <h3 style={{ color: '#818cf8', margin: '0 0 24px 0' }}>🕹️ SoulSeek V2</h3>
          <p style={{ fontSize: '12px', color: '#64748b', textTransform: 'uppercase', fontWeight: 'bold' }}>Channels</p>
          <div style={{ padding: '8px', backgroundColor: '#1e293b', borderRadius: '4px', display: 'flex', alignItems: 'center', gap: '8px' }}><Users size={16}/> #{room}</div>
        </div>
        <div style={{ fontSize: '14px', padding: '8px', backgroundColor: '#020617', borderRadius: '4px', marginTop: 'auto' }}>User: <b>{username}</b></div>
      </div>

      {/* Primary Chat Space */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        <div style={{ height: '64px', backgroundColor: '#0f172a', borderBottom: '1px solid #1e293b', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 24px' }}>
          <div style={{ fontWeight: 'bold' }}>#{room} Lounge</div>
          
          {/* Conditional Video Call Triggers */}
          {!inVideoCall ? (
            <button onClick={startVideo} style={{ display: 'flex', alignItems: 'center', gap: '8px', backgroundColor: '#4f46e5', color: 'white', border: 'none', padding: '8px 16px', borderRadius: '4px', cursor: 'pointer', fontWeight: '500' }}>
              <Video size={16} /> Join Video Call
            </button>
          ) : (
            <button onClick={endVideoCall} style={{ display: 'flex', alignItems: 'center', gap: '8px', backgroundColor: '#ef4444', color: 'white', border: 'none', padding: '8px 16px', borderRadius: '4px', cursor: 'pointer', fontWeight: '500' }}>
              <PhoneOff size={16} /> Leave Video Call
            </button>
          )}
        </div>

        {/* Video Call Strip */}
        {inVideoCall && (
          <div style={{ backgroundColor: '#0f172a', padding: '16px', display: 'flex', gap: '16px', justifyContent: 'center', borderBottom: '1px solid #1e293b' }}>
            <div style={{ position: 'relative' }}>
              <video ref={myVideoRef} autoPlay muted style={{ width: '192px', height: '144px', backgroundColor: 'black', borderRadius: '8px', transform: 'scaleX(-1)' }} />
              <span style={{ position: 'absolute', bottom: '8px', left: '8px', backgroundColor: 'rgba(0,0,0,0.6)', padding: '2px 6px', borderRadius: '4px', fontSize: '12px' }}>You</span>
            </div>
            <div ref={remoteVideoContainerRef} style={{ display: 'flex' }} />
          </div>
        )}

        {/* Text Messaging Box */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '24px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {messages.map((msg, idx) => (
            <div key={idx} style={{ alignSelf: msg.user === 'System' ? 'center' : 'flex-start', opacity: msg.user === 'System' ? 0.5 : 1 }}>
              <div style={{ backgroundColor: '#0f172a', padding: '12px', borderRadius: '8px', border: '1px solid #1e293b', maxWidth: '400px' }}>
                <span style={{ display: 'block', fontSize: '11px', fontWeight: 'bold', color: '#818cf8', marginBottom: '4px' }}>{msg.user}</span>
                <p style={{ margin: 0, fontSize: '14px' }}>{msg.text}</p>
                {msg.fileUrl && (
                  <a href={msg.fileUrl} target="_blank" rel="noreferrer" style={{ marginTop: '8px', display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: '#a5b4fc', textDecoration: 'none' }}>
                    <File size={14}/> Download Shared Asset
                  </a>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Action Dock */}
        <div style={{ padding: '16px', backgroundColor: '#0f172a', borderTop: '1px solid #1e293b' }}>
          <form onSubmit={sendMessage} style={{ display: 'flex', gap: '12px' }}>
            <label style={{ cursor: 'pointer', padding: '10px', backgroundColor: '#1e293b', borderRadius: '4px', display: 'flex', alignItems: 'center' }}>
              <File size={18} style={{ color: '#94a3b8' }} />
              <input type="file" style={{ display: 'none' }} onChange={handleFileUpload} />
            </label>
            <input type="text" placeholder={`Message #${room}...`} style={{ flex: 1, backgroundColor: '#020617', border: '1px solid #1e293b', borderRadius: '4px', padding: '0 16px', color: 'white' }} value={message} onChange={e => setMessage(e.target.value)} />
            <button type="submit" style={{ backgroundColor: '#4f46e5', color: 'white', border: 'none', padding: '0 16px', borderRadius: '4px', cursor: 'pointer' }}><Send size={16} /></button>
          </form>
        </div>
      </div>
    </div>
  );
}
