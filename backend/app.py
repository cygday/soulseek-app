import os
from flask import Flask, request, jsonify
from flask_socketio import SocketIO, emit, join_room, leave_room
from flask_cors import CORS
from werkzeug.utils import secure_filename

app = Flask(__name__)
app.config['SECRET_KEY'] = 'your-secret-key-here'
app.config['UPLOAD_FOLDER'] = os.path.join(os.getcwd(), 'uploads')

# CRITICAL: Ensure CORS allows connections from your local machine and your Vercel URL
CORS(app, resources={r"/*": {"origins": "*"}})
socketio = SocketIO(app, cors_allowed_origins="*")

if not os.path.exists(app.config['UPLOAD_FOLDER']):
    os.makedirs(app.config['UPLOAD_FOLDER'])

# Keep track of which socket ID maps to which room/username
users = {}

@socketio.on('connect')
def handle_connect():
    print(f"Client connected: {request.sid}")

@socketio.on('join')
def handle_join(data):
    username = data.get('username')
    room = data.get('room', 'Global')
    
    request_sid = request.sid
    users[request_sid] = {'username': username, 'room': room, 'streaming': False}
    
    join_room(room)
    print(f"{username} joined room: {room}")
    
    # Broadcast to the room that a user entered
    emit('message', {'user': 'System', 'text': f"{username} has entered the room."}, to=room)
    emit('user-joined', {'sid': request_sid, 'username': username}, to=room, include_self=False)


@socketio.on('get-room-users')
def handle_get_room_users(data):
    room = data.get('room', 'Global')
    request_sid = request.sid
    # Collect list of users in the requested room (exclude requester)
    room_users = []
    for sid, info in users.items():
        if info.get('room') == room and sid != request_sid:
            room_users.append({
                'sid': sid,
                'username': info.get('username'),
                'streaming': info.get('streaming', False)
            })

    # Send back the list only to the requester
    emit('room-users', {'users': room_users}, to=request_sid)

@socketio.on('stream-start')
def handle_stream_start(data):
    request_sid = request.sid
    room = data.get('room')
    if request_sid in users:
        users[request_sid]['streaming'] = True
        emit('stream-status', {
            'sid': request_sid,
            'username': users[request_sid]['username'],
            'streaming': True
        }, to=room, include_self=False)


@socketio.on('stream-stop')
def handle_stream_stop(data):
    request_sid = request.sid
    room = data.get('room')
    if request_sid in users:
        users[request_sid]['streaming'] = False
        emit('stream-status', {
            'sid': request_sid,
            'username': users[request_sid]['username'],
            'streaming': False
        }, to=room, include_self=False)


@socketio.on('message')
def handle_message(data):
    room = data.get('room')
    username = data.get('username')
    text = data.get('text')
    
    print(f"Message received from {username} in {room}: {text}")
    
    # CRITICAL FIX: Broadcast the message back to EVERYONE in the room
    emit('message', {'user': username, 'text': text, 'fileUrl': data.get('fileUrl')}, to=room)

@socketio.on('file-shared')
def handle_file_shared(data):
    room = data.get('room')
    username = data.get('username')
    filename = data.get('filename')
    file_url = data.get('fileUrl')
    
    emit('message', {
        'user': username, 
        'text': f"Shared a file: {filename}", 
        'fileUrl': file_url
    }, to=room)

@socketio.on('signal')
def handle_signal(data):
    request_sid = request.sid
    target = data.get('target')
    signal = data.get('signal')
    room = data.get('room')
    
    sender_name = users.get(request_sid, {}).get('username', 'Anonymous')
    
    # Handle room-wide video disconnects
    if signal == 'disconnect' and room:
        emit('user-left', {'sid': request_sid}, to=room, include_self=False)
        emit('message', {'user': 'System', 'text': f"{sender_name} left the video call."}, to=room)
    # Direct WebRTC handshake signaling
    elif target:
        emit('signal', {'sender': request_sid, 'username': sender_name, 'signal': signal}, to=target)

@socketio.on('disconnect')
def handle_disconnect():
    request_sid = request.sid
    if request_sid in users:
        user_info = users[request_sid]
        room = user_info['room']
        username = user_info['username']
        streaming = user_info.get('streaming', False)
        
        leave_room(room)
        if streaming:
            emit('stream-status', {'sid': request_sid, 'username': username, 'streaming': False}, to=room, include_self=False)
        emit('message', {'user': 'System', 'text': f"{username} has disconnected."}, to=room)
        emit('user-left', {'sid': request_sid}, to=room)
        del users[request_sid]
        print(f"Client disconnected: {request_sid}")

@app.route('/upload', methods=['POST'])
def upload_file():
    if 'file' not in request.files:
        return jsonify({'error': 'No file part'}), 400
    file = request.files['file']
    if file.filename == '':
        return jsonify({'error': 'No selected file'}), 400
    if file:
        filename = secure_filename(file.filename)
        file_path = os.path.join(app.config['UPLOAD_FOLDER'], filename)
        file.save(file_path)
        
        # Build URL for downloads
        file_url = f"{request.url_root}uploads/{filename}"
        return jsonify({'filename': filename, 'url': file_url}), 200

if __name__ == '__main__':
    socketio.run(app, host='0.0.0.0', port=5000, debug=True)
