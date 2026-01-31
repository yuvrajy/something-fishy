"""
Production run script. Eventlet patches first, then we run the app.
No gunicorn - eventlet's server handles WebSockets correctly.
"""
import os
import eventlet
eventlet.monkey_patch()

from dotenv import load_dotenv
load_dotenv()

from app import app, socketio

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 10000))
    socketio.run(app, host='0.0.0.0', port=port)
