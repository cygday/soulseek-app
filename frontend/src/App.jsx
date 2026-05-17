import React, { useState, useEffect, useRef } from 'react';
import io from 'socket.io-client';
import Peer from 'simple-peer';
import { MessageSquare, Video, File, Send, LogIn, Users, PhoneOff, Menu } from 'lucide-react';

// REPLACE THIS URL WITH YOUR LIVE RENDER BACKEND URL FOR PRODUCTION
const BACKEND_URL = "https://soulseek-app.onrender.com"; 
const socket = io(BACKEND_URL, { autoConnect: false });

export default function App() {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [username, setUsername] = useState('');
  const [room, setRoom] = useState('Global');
  const [message, setMessage] = useState('');
  const [messages, setMessages] = useState([]);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  
  // Video States
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

  // Handle setting stream to video element safely across devices
  useEffect(() => {
    if (stream && myVideoRef.current) {
      myVideoRef.current.srcObject = stream;
    }
  }, [stream, inVideoCall]);

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
      const res = await fetch(`${BACKEND_URL}/upload`, { method: 'POST', body: formData });
      const data = await res.json();
      socket.emit('file-shared', { room, username, filename: data.filename, fileUrl: data.url });
    } catch (err) {
      console.error("File upload failed", err);
    }
  };

  // Fixed WebRTC Stream handling for Mobile Browsers
  const startVideo = async () => {
    try {
      const constraints = {
        video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: "user" },
        audio: true
      };
      const localStream = await navigator.mediaDevices.getUserMedia(constraints);
      setStream(localStream);
      setInVideoCall(true);
    } catch (err) {
      alert("Could not access camera. Please ensure permissions are granted and you are on HTTPS.");
      console.error(err);
    }
  };

  const endVideoCall = () => {
    if (stream) {
      stream.getTracks().forEach(track => track.stop());
    }
    peersRef.current.forEach(p => p.peer.destroy());
    peersRef.current = [];

    if (remoteVideoContainerRef.current) {
      remoteVideoContainerRef.current.innerHTML = '';
    }

    setStream(null);
    setInVideoCall(false);
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
    video.playsInline = true; // Crucial for iOS/Android rendering
    video.style.width = "140px";
    video.style.height = "105px";
    video.style.backgroundColor = "black";
    video.style.borderRadius = "8px";
    video.style.objectFit = "cover";
    remoteVideoContainerRef.current?.appendChild(video);
  };

  const removeRemoteVideo = (sid) => {
    const videoElement = document.getElementById(sid);
    if (videoElement) videoElement.remove();
    peersRef.current = peersRef.current.filter(p => p.peerID !== sid);
  };

  if (!isLoggedIn) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', backgroundColor: '#0f172a', color: 'white', fontFamily: 'sans-serif', padding: '16px' }}>
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
    <div style={{ display: 'flex', height: '100vh', backgroundColor: '#020617', color: '#f8fafc', fontFamily: 'sans-serif', overflow: 'hidden', position: 'relative' }}>
      
      {/* Sidebar (Responsive Overlay for Mobile, static for Desktop) */}
      <div style={{
        width: '240px', 
        backgroundColor: '#0f172a', 
        padding: '16px', 
        display: 'flex', 
        flexDirection: 'column', 
        borderRight: '1px solid #1e293b',
        position: 'absolute',
        top: 0, bottom: 0, left: sidebarOpen ? 0 : '-240px',
        zIndex: 50,
        transition: 'left 0.3s ease',
        mdPosition: 'static', // Logic handled via standard window layouts fallback
      }} className="sidebar-element">
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
          <h3 style={{ color: '#818cf8', margin: '0 0 20px 0', display: 'flex', justifyContent: 'between', alignItems: 'center' }}>
            <span>🕹️ SoulSeek V2</span>
            <button onClick={() => setSidebarOpen(false)} style={{ background: 'none', border: 'none', color: 'white', fontSize: '16px', cursor: 'pointer' }} className="mobile-only-btn">✕</button>
          </h3>
          <p style={{ fontSize: '11px', color: '#64748b', textTransform: 'uppercase', fontWeight: 'bold', margin: '0 0 8px 0' }}>Channels</p>
          <div style={{ padding: '10px', backgroundColor: '#1e293b', borderRadius: '6px', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '14px' }}><Users size={14}/> #{room}</div>
          <div style={{ fontSize: '13px', padding: '10px', backgroundColor: '#020617', borderRadius: '6px', marginTop: 'auto' }}>User: <b>{username}</b></div>
        </div>
      </div>

      {/* Main Chat Workspace */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', width: '100%', overflow: 'hidden' }}>
        
        {/* Navigation Bar */}
        <div style={{ height: '60px', backgroundColor: '#0f172a', borderBottom: '1px solid #1e293b', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <button onClick={() => setSidebarOpen(!sidebarOpen)} style={{ background: 'none', border: 'none', color: 'white', cursor: 'pointer', display: 'flex', alignItems: 'center' }}>
              <Menu size={22} />
            </button>
            <div style={{ fontWeight: 'bold', fontSize: '15px' }}>#{room}</div>
          </div>
          
          {!inVideoCall ? (
            <button onClick={startVideo} style={{ display: 'flex', alignItems: 'center', gap: '6px', backgroundColor: '#4f46e5', color: 'white', border: 'none', padding: '8px 12px', borderRadius: '6px', cursor: 'pointer', fontSize: '13px', fontWeight: 'bold' }}>
              <Video size={14} /> Video Call
            </button>
          ) : (
            <button onClick={endVideoCall} style={{ display: 'flex', alignItems: 'center', gap: '6px', backgroundColor: '#ef4444', color: 'white', border: 'none', padding: '8px 12px', borderRadius: '6px', cursor: 'pointer', fontSize: '13px', fontWeight: 'bold' }}>
              <PhoneOff size={14} /> Hang Up
            </button>
          )}
        </div>

        {/* Video Feeds Panel (Scrolls horizontally if multiple) */}
        {inVideoCall && (
          <div style={{ backgroundColor: '#0f172a', padding: '12px', display: 'flex', gap: '12px', overflowX: 'auto', borderBottom: '1px solid #1e293b', alignItems: 'center' }}>
            <div style={{ position: 'relative', width: '140px', height: '105px', flexShrink: 0 }}>
              <video 
                ref={myVideoRef} 
                autoPlay 
                muted 
                playsInline 
                style={{ width: '140px', height: '105px', backgroundColor: 'black', borderRadius: '8px', transform: 'scaleX(-1)', objectFit: 'cover' }} 
              />
              <span style={{ position: 'absolute', bottom: '4px', left: '4px', backgroundColor: 'rgba(0,0,0,0.6)', padding: '2px 4px', borderRadius: '4px', fontSize: '10px' }}>You</span>
            </div>
            <div ref={remoteVideoContainerRef} style={{ display: 'flex', gap: '12px' }} />
          </div>
        )}

        {/* Message Feed */}
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
        </div>

        {/* Action Dock */}
        <div style={{ padding: '12px', backgroundColor: '#0f172a', borderTop: '1px solid #1e293b' }}>
          <form onSubmit={sendMessage} style={{ display: 'flex', gap: '8px' }}>
            <label style={{ cursor: 'pointer', padding: '10px', backgroundColor: '#1e293b', borderRadius: '6px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <File size={16} style={{ color: '#94a3b8' }} />
              <input type="file" style={{ display: 'none' }} onChange={handleFileUpload} />
            </label>
            <input type="text" placeholder="Type a message..." style={{ flex: 1, backgroundColor: '#020617', border: '1px solid #1e293b', borderRadius: '6px', padding: '0 12px', color: 'white', fontSize: '13px', boxSizing: 'border-box' }} value={message} onChange={e => setMessage(e.target.value)} />
            <button type="submit" style={{ backgroundColor: '#4f46e5', color: 'white', border: 'none', padding: '0 14px', borderRadius: '6px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Send size={14} /></button>
          </form>
        </div>

      </div>
    </div>
  );
}
