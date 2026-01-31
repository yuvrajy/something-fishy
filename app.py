from flask import Flask, jsonify, render_template, request
from flask_socketio import SocketIO, emit, join_room, leave_room
from flask_cors import CORS
from main import Player, GameRoom
import random
import string
import os
from gevent import monkey, sleep
import time
import threading
from dotenv import load_dotenv
monkey.patch_all()

app = Flask(__name__, static_folder='static', template_folder='templates')
app.config['SECRET_KEY'] = os.environ.get('SECRET_KEY', 'dev-secret-key-change-in-production')

# Configure CORS to only allow specific domains
allowed_origins = [
    "https://superfishy.com",
    "https://www.superfishy.com",
    "http://localhost:5000",
    "http://localhost:5001",
    "http://localhost:5003",
    "http://127.0.0.1:5000",
    "http://127.0.0.1:5001",
    "http://127.0.0.1:5003"
]

CORS(app, resources={r"/*": {"origins": allowed_origins}})
socketio = SocketIO(app,
                   cors_allowed_origins=allowed_origins,
                   async_mode='gevent',
                   ping_timeout=60,
                   ping_interval=25,
                   logger=True,
                   engineio_logger=True,
                   path='/socket.io')

# Store active game rooms
game_rooms = {}
# Store player session mappings
player_sessions = {}

def generate_room_code():
    """Generate a unique 6-letter room code, excluding confusing letters (O, I)"""
    # Define allowed characters (uppercase letters excluding O and I)
    allowed_chars = ''.join(c for c in string.ascii_uppercase if c not in 'OI')

    while True:
        code = ''.join(random.choices(allowed_chars, k=6))
        if code not in game_rooms:
            return code

@app.route('/')
def index():
    """Serve the game interface"""
    return render_template('index.html')

@app.route('/create_room', methods=['POST'])
def create_room():
    """Create a new game room"""
    data = request.get_json()
    host_name = data.get('name')
    if not host_name:
        return jsonify({'error': 'Name is required'}), 400

    room_code = generate_room_code()
    game_room = GameRoom(room_code)
    game_rooms[room_code] = game_room

    return jsonify({
        'room_code': room_code,
        'message': f'Room created successfully. Share code {room_code} with other players.'
    })

@app.route('/join_room/<room_code>', methods=['POST'])
def join_game_room(room_code):
    """Join an existing game room"""
    data = request.get_json()
    player_name = data.get('name')

    if not player_name:
        return jsonify({'error': 'Name is required'}), 400

    if room_code not in game_rooms:
        return jsonify({'error': 'Room not found'}), 404

    game_room = game_rooms[room_code]
    if game_room.game_state['status'] != 'waiting':
        return jsonify({'error': 'Game already in progress'}), 400

    return jsonify({
        'message': 'Successfully joined room',
        'room_code': room_code
    })

@socketio.on('connect')
def handle_connect():
    """Handle client connection"""
    print(f"Client connected: {request.sid}")
    emit('connected', {'message': 'Connected to server'})

@socketio.on('disconnect')
def handle_disconnect():
    """Handle client disconnection"""
    print(f"Client disconnected: {request.sid}")
    if request.sid in player_sessions:
        player_id = player_sessions[request.sid]['player_id']
        room_code = player_sessions[request.sid]['room_code']
        player_name = player_sessions[request.sid]['name']

        print(f"Disconnected player info - ID: {player_id}, Name: {player_name}, Room: {room_code}")

        if room_code in game_rooms:
            game_room = game_rooms[room_code]

            # Mark player as disconnected instead of removing immediately
            if player_id in game_room.players:
                game_room.players[player_id].is_disconnected = True
                game_room.players[player_id].disconnect_time = time.time()

            leave_room(room_code)

            # Notify other players about disconnection
            emit('player_disconnected', {
                'player_id': player_id,
                'player_name': player_name,
                'message': f"{player_name} has disconnected"
            }, to=room_code)

            # Check if we should pause/end the game due to disconnections
            connected_players = [p for p in game_room.players.values() if not getattr(p, 'is_disconnected', False)]
            print(f"Connected players after disconnect: {len(connected_players)}")

            if len(connected_players) < 3 and game_room.game_state['status'] == 'playing':
                # Pause the game if too few players remain
                game_room.game_state['status'] = 'paused'
                emit('game_paused', {
                    'message': f"Game paused - need at least 3 players. Waiting for {player_name} to reconnect..."
                }, to=room_code)
            elif len(connected_players) == 0:
                # Schedule room cleanup if no one is connected
                schedule_room_cleanup(room_code, 300)  # 5 minutes

        del player_sessions[request.sid]

def schedule_room_cleanup(room_code, delay_seconds):
    """Schedule a room for cleanup after a delay"""
    def cleanup_room():
        time.sleep(delay_seconds)
        if room_code in game_rooms:
            game_room = game_rooms[room_code]
            connected_players = [p for p in game_room.players.values() if not getattr(p, 'is_disconnected', False)]

            # Only cleanup if still no connected players
            if len(connected_players) == 0:
                print(f"Cleaning up empty room: {room_code}")
                del game_rooms[room_code]

    cleanup_thread = threading.Thread(target=cleanup_room)
    cleanup_thread.daemon = True
    cleanup_thread.start()

@socketio.on('join_game')
def handle_join_game(data):
    """Handle player joining a game"""
    room_code = data.get('room_code')
    player_name = data.get('name')

    if room_code not in game_rooms:
        emit('error', {'message': 'Room not found'})
        return

    game_room = game_rooms[room_code]

    # Debug: Print current players and their status
    print(f"Join attempt: {player_name} -> {room_code}")
    print(f"Current players in room:")
    for pid, player in game_room.players.items():
        disconnected = getattr(player, 'is_disconnected', False)
        print(f"  {player.name} (ID: {pid}) - Disconnected: {disconnected}")

    # Check if this is a reconnecting player (more flexible matching)
    reconnecting_player = None
    for player in game_room.players.values():
        print(f"Checking player: '{player.name}' vs '{player_name}' (case-insensitive: {player.name.lower() == player_name.lower()})")
        print(f"  Player disconnected status: {getattr(player, 'is_disconnected', False)}")

        if player.name.lower() == player_name.lower():  # Case-insensitive matching
            if getattr(player, 'is_disconnected', False):
                reconnecting_player = player
                print(f"✓ Found disconnected player to reconnect: {player.name}")
                break
            else:
                # Player with same name is already connected
                print(f"✗ Player with same name is already connected: {player.name}")
                emit('error', {'message': f'Player "{player_name}" is already connected to this game'})
                return

    if reconnecting_player:
        # Handle reconnection
        player_id = reconnecting_player.id
        reconnecting_player.is_disconnected = False
        reconnecting_player.disconnect_time = None

        print(f"Reconnecting player {player_name} with ID {player_id}")

        # Store session info
        player_sessions[request.sid] = {
            'player_id': player_id,
            'room_code': room_code,
            'name': player_name
        }

        # Join socket room
        join_room(room_code)

        # Notify all players about reconnection
        emit('player_reconnected', {
            'player_id': player_id,
            'player_name': player_name,
            'message': f'{player_name} has reconnected'
        }, room=room_code)

        # Check if game can resume
        connected_players = [p for p in game_room.players.values() if not getattr(p, 'is_disconnected', False)]
        print(f"Connected players after reconnection: {len(connected_players)}")

        if len(connected_players) >= 3 and game_room.game_state['status'] == 'paused':
            game_room.game_state['status'] = 'playing'
            emit('game_resumed', {
                'message': 'Game resumed - enough players reconnected!'
            }, room=room_code)

        # Send current game state to reconnected player
        state = game_room.get_player_state(player_id)
        state['player_id'] = player_id
        state['current_round'] = game_room.game_state['current_round']

        print(f"Game status: {game_room.game_state['status']}")

        # Send appropriate event based on game status
        if game_room.game_state['status'] in ['playing', 'paused']:
            emit('game_started', state)  # This will show the game interface
            print(f"Sent game_started event to reconnected player")
        else:
            emit('game_state', state)  # This will show waiting room
            print(f"Sent game_state event to reconnected player")

    else:
        # Handle new player joining
        print(f"No disconnected player found, treating as new player")

        if game_room.game_state['status'] not in ['waiting']:
            # Show available disconnected players for debugging
            disconnected_players = [p.name for p in game_room.players.values() if getattr(p, 'is_disconnected', False)]
            if disconnected_players:
                emit('error', {'message': f'Game in progress. Disconnected players available for reconnection: {", ".join(disconnected_players)}'})
            else:
                emit('error', {'message': 'Game already in progress and no disconnected players available'})
            return

        # Create new player
        player_id = len(game_room.players) + 1
        player = Player(player_id, player_name)
        game_room.add_player(player)

        print(f"Created new player {player_name} with ID {player_id}")

        # Store session info
        player_sessions[request.sid] = {
            'player_id': player_id,
            'room_code': room_code,
            'name': player_name
        }

        # Join socket room
        join_room(room_code)

        # Send list of existing players to the new player
        for existing_player in game_room.players.values():
            if existing_player.id != player_id:  # Don't send the new player to themselves
                emit('player_joined', {
                    'player': existing_player.to_dict(),
                    'message': f'{existing_player.name} is in the room'
                })

        # Notify all players in room about the new player
        emit('player_joined', {
            'player': player.to_dict(),
            'message': f'{player_name} has joined the game'
        }, room=room_code)

        # Send current game state to new player
        state = game_room.get_player_state(player_id)
        state['player_id'] = player_id  # Add player's own ID to state
        emit('game_state', state)

@socketio.on('start_game')
def handle_start_game(data):
    """Handle game start request"""
    print(f"Received start_game event with data: {data}")
    room_code = data.get('room_code')

    if room_code not in game_rooms:
        print(f"Room {room_code} not found")
        emit('error', {'message': 'Room not found'})
        return

    game_room = game_rooms[room_code]
    print(f"Number of players in room: {len(game_room.players)}")

    if len(game_room.players) < 3:
        print(f"Not enough players to start game: {len(game_room.players)}")
        emit('error', {'message': 'Need at least 3 players to start'})
        return

    print("Starting game...")
    # Start the game
    game_room.start_game()

    # Send initial game state to all players
    for player_id in game_room.players:
        state = game_room.get_player_state(player_id)
        state['player_id'] = player_id  # Add player's own ID to state
        player_sid = get_player_sid(player_id, room_code)
        print(f"Sending game_started event to player {player_id} (SID: {player_sid})")
        emit('game_started', state, to=player_sid)

    print("Game started successfully")

@socketio.on('make_guess')
def handle_guess(data):
    """Handle a player making a guess"""
    room_code = data.get('room_code')
    guessed_player_id = data.get('guessed_player_id')

    if room_code not in game_rooms:
        emit('error', {'message': 'Room not found'})
        return

    game_room = game_rooms[room_code]
    guesser_id = player_sessions[request.sid]['player_id']

    # Process the guess
    result = game_room.process_guess(guesser_id, guessed_player_id)

    if 'error' in result:
        emit('error', {'message': result['error']})
        return

    # Broadcast result to all players first
    emit('guess_result', result, to=room_code)

    # If truth-teller was guessed or all liars found, handle round end
    if result.get('round_ended', False):
        if game_room.game_state['status'] == 'finished':
            # Game is over
            final_results = game_room.get_final_results()
            emit('game_over', final_results, to=room_code)
        else:
            # Wait for 1.5 seconds to let the animation complete
            sleep(1.5)

            # end_round() already calls start_new_round(), so we don't need to call it again
            # The round was already ended in process_guess -> end_round()

            # Get the current guesser after the new round started
            current_guesser = next(p for p in game_room.players.values() if p.is_guesser())

            # Send new round state to all players
            for player_id in game_room.players:
                state = game_room.get_player_state(player_id)
                state['player_id'] = player_id
                state['current_round'] = game_room.game_state['current_round']
                state['next_guesser'] = current_guesser.name
                emit('new_round', state, to=get_player_sid(player_id, room_code))
    else:
        # Just update game state for all players
        for player_id in game_room.players:
            state = game_room.get_player_state(player_id)
            state['player_id'] = player_id
            state['current_round'] = game_room.game_state['current_round']
            emit('game_state_update', state, to=get_player_sid(player_id, room_code))

@socketio.on('skip_question')
def handle_skip_question(data):
    """Handle skipping the current question"""
    room_code = data.get('room_code')
    if room_code not in game_rooms:
        return

    game_room = game_rooms[room_code]
    result = game_room.skip_question()
    emit('question_skipped', result, to=room_code)

@socketio.on('restart_game')
def handle_restart_game(data):
    """Handle restarting the game in the same room"""
    room_code = data.get('room_code')
    if room_code not in game_rooms:
        return

    game_room = game_rooms[room_code]

    # Notify all players that game is restarting
    emit('game_restarting', to=room_code)

    # Reset room state but keep players
    game_room.reset_for_restart()

    # Notify all players that game has restarted
    for player_id in game_room.players:
        player = game_room.players[player_id]
        emit('player_rejoined', {
            'player': {
                'id': player_id,
                'name': player.name
            }
        }, to=room_code)

    emit('game_restarted', to=room_code)

def get_player_sid(player_id, room_code):
    """Get socket ID for a player"""
    for sid, data in player_sessions.items():
        if data['player_id'] == player_id and data['room_code'] == room_code:
            return sid
    return None

@app.route('/room_status/<room_code>', methods=['GET'])
def get_room_status(room_code):
    """Get the status of a room and list of players"""
    if room_code not in game_rooms:
        return jsonify({'error': 'Room not found'}), 404

    game_room = game_rooms[room_code]

    players_info = []
    for player in game_room.players.values():
        players_info.append({
            'name': player.name,
            'id': player.id,
            'points': player.points,
            'is_disconnected': getattr(player, 'is_disconnected', False),
            'disconnect_time': getattr(player, 'disconnect_time', None)
        })

    return jsonify({
        'room_code': room_code,
        'status': game_room.game_state['status'],
        'current_round': game_room.game_state['current_round'],
        'total_players': len(game_room.players),
        'connected_players': len([p for p in game_room.players.values() if not getattr(p, 'is_disconnected', False)]),
        'disconnected_players': [p.name for p in game_room.players.values() if getattr(p, 'is_disconnected', False)],
        'players': players_info
    })

if __name__ == '__main__':
    load_dotenv()
    port = int(os.environ.get('PORT', 5003))
    socketio.run(app, host='0.0.0.0', port=port, debug=True)
