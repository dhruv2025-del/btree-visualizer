import http.server
import os
import socketserver
import sys
import threading
import time
import webbrowser

# Ensure working directory is the folder where index.html resides
DIR = os.path.dirname(os.path.abspath(__file__))
os.chdir(DIR)

PORT = 3000

class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        # Disable aggressive caching so updates show immediately
        self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()

    def log_message(self, format, *args):
        sys.stderr.write(f"[{self.log_date_time_string()}] {args[0]} - {args[1]}\n")

def open_browser():
    time.sleep(0.6)
    webbrowser.open(f"http://localhost:{PORT}")

if __name__ == '__main__':
    socketserver.TCPServer.allow_reuse_address = True
    try:
        with socketserver.TCPServer(('127.0.0.1', PORT), QuietHandler) as httpd:
            print("=====================================================")
            print(f"  DBMS B-Tree Lab is LIVE at: http://localhost:{PORT}")
            print("=====================================================")
            print("Press Ctrl+C in this window to stop the server.")
            threading.Thread(target=open_browser, daemon=True).start()
            httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nServer stopped.")
    except Exception as e:
        print(f"Error starting server: {e}")
        input("Press Enter to exit...")
