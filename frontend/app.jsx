import React, { useState, useEffect, useRef } from 'react';
import io from 'socket.io-client';
import Peer from 'simple-peer';
import { MessageSquare, Video, File, Send, LogIn, Users } from 'lucide-react';

const socket = io('http://localhost:5000', { autoConnect: false });

export default function App() {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [username, setUsername] = useState('');
  const [room, setRoom] = useState('Global');
  const [message, setMessage] = useState('');
  const [messages, setMessages] = useState([]);
  
  // Video calling states
  const [inVideoCall, setInVideoCall] = useState(false);
  const [stream, setStream] = useState(null);
  const peersRef = useRef([]); // Tracks active WebRTC peers
  
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
        // Incoming call connection
        const incomingPeer = acceptCall(sender, signal, stream);
        peersRef.current.push({ peerID: sender, peer: incomingPeer });
      }
    });

    return () => {
      socket.off('message');
      socket.off('user-joined');
      socket.off('signal');
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

  // WebRTC Logic for Video Calls
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
    video.className = "w-48 h-36 bg-black rounded-lg border-2 border-indigo-500 m-2";
    remoteVideoContainerRef.current?.appendChild(video);
  };

  if (!isLoggedIn) {
    return (
      <div className="flex items-center justify-center h-screen bg-slate-900 text-white">
        <form onSubmit={handleLogin} className="bg-slate-800 p-8 rounded-xl shadow-2xl w-96 border border-slate-700">
          <h2 className="text-2xl font-bold mb-6 flex items-center gap-2"><MessageSquare className="text-indigo-400" /> MeshChat Rooms</h2>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1 text-slate-400">Username</label>
              <input type="text" className="w-full bg-slate-950 p-2.5 rounded border border-slate-700 focus:outline-none focus:border-indigo-500" value={username} onChange={e => setUsername(e.target.value)} required />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1 text-slate-400">Chat Room</label>
              <input type="text" className="w-full bg-slate-950 p-2.5 rounded border border-slate-700 focus:outline-none focus:border-indigo-500" value={room} onChange={e => setRoom(e.target.value)} required />
            </div>
            <button type="submit" className="w-full bg-indigo-600 hover:bg-indigo-500 py-2.5 rounded font-semibold transition flex items-center justify-center gap-2 mt-4"><LogIn size={18}/> Enter Lobby</button>
          </div>
        </form>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-slate-950 text-slate-100 font-sans">
      {/* Sidebar - Rooms Area */}
      <div className="w-64 bg-slate-900 border-r border-slate-800 flex flex-col justify-between p-4">
        <div>
          <h1 className="text-xl font-black text-indigo-400 mb-6 flex items-center gap-2">🕹️ SoulSeekV2</h1>
          <div className="space-y-1">
            <div className="text-xs font-bold text-slate-500 uppercase px-2 mb-2">Active Channels</div>
            <button className="w-full text-left bg-slate-800 px-3 py-2 rounded font-medium flex items-center gap-2"><Users size={16}/> #{room}</button>
          </div>
        </div>
        <div className="p-2 bg-slate-950 rounded border border-slate-800 text-sm">
          Logged in as: <span className="font-bold text-indigo-400">{username}</span>
        </div>
      </div>

      {/* Main Chat & Video Layout */}
      <div className="flex-1 flex flex-col h-full">
        {/* Top Navbar */}
        <div className="h-16 bg-slate-900 border-b border-slate-800 flex items-center justify-between px-6">
          <div className="font-semibold text-lg">#{room} Lounge</div>
          <button onClick={startVideo} className={`flex items-center gap-2 px-4 py-2 rounded text-sm font-medium transition ${inVideoCall ? 'bg-emerald-600' : 'bg-indigo-600 hover:bg-indigo-500'}`}>
            <Video size={16} /> {inVideoCall ? 'Video Active' : 'Start Video Call'}
          </button>
        </div>

        {/* Video Streams Container */}
        {inVideoCall && (
          <div className="bg-slate-900 p-4 border-b border-slate-800 flex flex-wrap gap-4 items-center justify-center">
            <div className="relative">
              <video ref={myVideoRef} autoPlay muted className="w-48 h-36 bg-black rounded-lg border-2 border-emerald-500 transform -scale-x-100" />
              <span className="absolute bottom-2 left-2 bg-black/60 px-2 py-0.5 rounded text-xs">You</span>
            </div>
            <div ref={remoteVideoContainerRef} className="flex flex-wrap" />
          </div>
        )}

        {/* Messages Stream */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4 bg-slate-950">
          {messages.map((msg, index) => (
            <div key={index} className={`flex flex-col ${msg.user === 'System' ? 'items-center opacity-50' : ''}`}>
              <div className="max-w-xl bg-slate-900 p-3 rounded-xl border border-slate-800 shadow-sm">
                <span className="block text-xs font-bold text-indigo-400 mb-1">{msg.user}</span>
                <p className="text-sm leading-relaxed">{msg.text}</p>
                {msg.fileUrl && (
                  <a href={msg.fileUrl} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-2 text-xs bg-indigo-950/50 hover:bg-indigo-950 border border-indigo-800 text-indigo-400 px-3 py-1.5 rounded transition">
                    <File size={14}/> Download Asset
                  </a>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Chat Input Dock */}
        <div className="p-4 bg-slate-900 border-t border-slate-800">
          <form onSubmit={sendMessage} className="flex items-center gap-3">
            <label className="cursor-pointer p-2.5 bg-slate-800 hover:bg-slate-700 rounded transition text-slate-400 hover:text-slate-200">
              <File size={20} />
              <input type="file" className="hidden" onChange={handleFileUpload} />
            </label>
            <input type="text" placeholder={`Message #${room}...`} className="flex-1 bg-slate-950 px-4 py-2.5 rounded border border-slate-800 focus:outline-none focus:border-indigo-500 text-sm" value={message} onChange={e => setMessage(e.target.value)} />
            <button type="submit" className="p-2.5 bg-indigo-600 hover:bg-indigo-500 rounded text-white transition"><Send size={18} /></button>
          </form>
        </div>
      </div>
    </div>
  );
}
