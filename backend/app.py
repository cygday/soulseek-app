import os
from flask import Flask, request, jsonify
from flask_socketio import SocketIO, emit, join_room, leave_room
from flask_cors import CORS
from werkzeug.utils import secure_filename

app = Flask(__name__)
app.config['SECRET_KEY'] = 'secret_key_1234'
app.config['UPLOAD_FOLDER'] = 'uploads'
CORS(app, resources={r"/*": {"origins": "*"}})
socketio = SocketIO(app, cors_allowed_origins="*")

if not os.path.exists(app.config['UPLOAD_FOLDER']):
    os.makedirs(app.config['UPLOAD_FOLDER'])

# Structure to keep track of active rooms and users
# { room_id: [user_id1, user_id2] }
rooms = {}

@app.route('/upload', methods=['POST'])
def upload_file():
    if 'file' not in request.files:
        return jsonify({"error": "No file part"}), 400
    file = request.files['file']
    if file.filename == '':
        return jsonify({"error": "No selected file"}), 400
    
    filename = secure_filename(file.filename)
    filepath = os.path.join(app.config['UPLOAD_FOLDER'], filename)
    file.save(filepath)
    
    # Return a mock downloadable link (In production, serve this via an Nginx/Flask route)
    return jsonify({"filename": filename, "url": f"http://localhost:5000/files/{filename}"}), 200

# WebSocket Event Handlers
@socketio.on('join')
def handle_join(data):
    username = data.get('username')
    room = data.get('room')
    
    join_room(room)
    if room not in rooms:
        rooms[room] = []
    if request.sid not in rooms[room]:
        rooms[room].append(request.sid)
        
    emit('message', {'user': 'System', 'text': f'{username} has entered the room.'}, to=room)
    # Notify others in the room to initiate WebRTC if needed
    emit('user-joined', {'sid': request.sid, 'username': username}, to=room, include_self=False)

@socketio.on('message')
def handle_message(data):
    room = data.get('room')
    emit('message', {'user': data.get('username'), 'text': data.get('text')}, to=room)

@socketio.on('file-shared')
def handle_file_shared(data):
    room = data.get('room')
    emit('message', {
        'user': data.get('username'), 
        'text': f"Shared a file: {data.get('filename')}", 
        'fileUrl': data.get('fileUrl')
    }, to=room)

# WebRTC Signaling Handlers
@socketio.on('signal')
def handle_signal(data):
    # Relay offer, answer, or ice-candidates to the specific target in the room
    target = data.get('target')
    emit('signal', {
        'sender': request.sid,
        'signal': data.get('signal')
    }, to=target)

@socketio.on('disconnect')
def handle_disconnect():
    for room, users in rooms.items():
        if request.sid in users:
            users.remove(request.sid)
            emit('message', {'user': 'System', 'text': 'A user has disconnected.'}, to=room)
            emit('user-left', {'sid': request.sid}, to=room)

if __name__ == '__main__':
    socketio.run(app, port=5000, debug=True)
