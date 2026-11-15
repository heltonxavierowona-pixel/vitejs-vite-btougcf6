"""
Faux serveur SMTP pour les tests locaux (port 2525) : accepte tous
les messages et les écrit dans scripts/.mails/ (un fichier par e-mail).

API démarrée avec SMTP_HOST=localhost SMTP_PORT=2525 SMTP_USER=test SMTP_PASS=test
"""
import os
import socketserver
import time

OUT = os.path.join(os.path.dirname(__file__), '.mails')
os.makedirs(OUT, exist_ok=True)


class Handler(socketserver.StreamRequestHandler):
    def send(self, line):
        self.wfile.write((line + '\r\n').encode())

    def handle(self):
        self.send('220 fake-smtp')
        data = None
        while True:
            raw = self.rfile.readline()
            if not raw:
                return
            line = raw.decode(errors='replace').rstrip('\r\n')
            if data is not None:
                if line == '.':
                    with open(os.path.join(OUT, f'{time.time_ns()}.eml'), 'w') as f:
                        f.write('\n'.join(data))
                    data = None
                    self.send('250 OK')
                else:
                    data.append(line[1:] if line.startswith('..') else line)
                continue
            cmd = line.upper()
            if cmd.startswith('EHLO'):
                self.wfile.write(b'250-fake-smtp\r\n250 AUTH PLAIN LOGIN\r\n')
            elif cmd.startswith('HELO'):
                self.send('250 fake-smtp')
            elif cmd.startswith('AUTH'):
                self.send('235 OK')
            elif cmd.startswith('DATA'):
                data = []
                self.send('354 End with .')
            elif cmd.startswith('QUIT'):
                self.send('221 Bye')
                return
            else:
                self.send('250 OK')


socketserver.ThreadingTCPServer.allow_reuse_address = True
socketserver.ThreadingTCPServer(('127.0.0.1', 2525), Handler).serve_forever()
