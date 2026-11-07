"""Restricted SSH forced command: public-IP:443 bytes or explicit public DNS.

Python 3.6+ standard library; no TLS termination, shell, HTTP or logging.
The Windows research proxy retains DNS/hostname/TLS/allowlist/budget checks.
"""
import ipaddress
import json
import os
import select
import signal
import socket
import sys
import time

BLOCK4 = [ipaddress.ip_network(x) for x in (
    '0.0.0.0/8', '10.0.0.0/8', '100.64.0.0/10', '127.0.0.0/8',
    '169.254.0.0/16', '172.16.0.0/12', '192.0.0.0/24', '192.0.2.0/24',
    '192.88.99.0/24', '192.168.0.0/16', '198.18.0.0/15', '198.51.100.0/24',
    '203.0.113.0/24', '224.0.0.0/3')]
BLOCK6 = [ipaddress.ip_network(x) for x in (
    '2001::/23', '2001:db8::/32', '2002::/16', '3ffe::/16', '3fff::/20')]


def public_ip(value):
    if '%' in value or value.strip() != value:
        raise ValueError('target')
    address = ipaddress.ip_address(value)
    if address.version == 4:
        allowed = not any(address in n for n in BLOCK4)
    else:
        allowed = address in ipaddress.ip_network('2000::/3') and not any(address in n for n in BLOCK6)
    if not allowed:
        raise ValueError('target')
    return str(address)


def target(header):
    if len(header) > 128 or not header.endswith(b'\n'):
        raise ValueError('target')
    text = header[:-1].decode('ascii')
    if not text.startswith('IDEACLIP/1 '):
        raise ValueError('target')
    return public_ip(text[11:])


def resolve_public(header):
    text = header.decode('ascii')
    if not text.startswith('IDEACLIP-DNS/1 ') or not text.endswith('\n'):
        raise ValueError('dns')
    host = text[15:-1]
    if not 1 < len(host) <= 253 or '.' not in host or host.endswith('.'):
        raise ValueError('host')
    if any(not (c.isalnum() or c in '.-') for c in host) or host.rsplit('.', 1)[-1].lower() in ('local', 'localhost', 'internal', 'onion', 'test', 'invalid', 'arpa'):
        raise ValueError('host')
    try:
        ipaddress.ip_address(host)
        raise ValueError('literal-not-domain')
    except ValueError as e:
        if str(e) == 'literal-not-domain':
            raise
    rows = []
    for result in socket.getaddrinfo(host, 443, 0, socket.SOCK_STREAM):
        address = public_ip(result[4][0])
        row = {'address': address, 'family': 6 if ':' in address else 4}
        if row not in rows:
            rows.append(row)
    if not rows or len(rows) > 32:
        raise ValueError('dns')
    return rows


def main():
    sock = None
    ready = False
    try:
        command = os.environ.get('SSH_ORIGINAL_COMMAND')
        if command not in ('ideaclip-relay-v1', 'ideaclip-resolve-v1'):
            raise ValueError('command')
        signal.alarm(120)
        header = b''
        deadline = time.monotonic() + 10
        while not header.endswith(b'\n'):
            remaining = deadline - time.monotonic()
            if remaining <= 0 or not select.select([0], [], [], remaining)[0]:
                raise ValueError('timeout')
            part = os.read(0, 1)
            if not part or len(header) >= (300 if command == 'ideaclip-resolve-v1' else 128):
                raise ValueError('header')
            header += part
        if command == 'ideaclip-resolve-v1':
            os.write(1, (json.dumps({'addresses': resolve_public(header)}) + '\n').encode('ascii'))
            return 0
        ip = target(header)
        # A numeric address is passed directly. No domain/SNI/DNS rewriting.
        sock = socket.socket(socket.AF_INET6 if ':' in ip else socket.AF_INET, socket.SOCK_STREAM)
        sock.settimeout(10)
        sock.connect((ip, 443))
        sock.settimeout(None)
        os.write(1, b'READY\n')
        ready = True
        inputs = [0, sock]
        total = 0
        while inputs:
            readable = select.select(inputs, [], [], 30)[0]
            if not readable:
                break
            for source in readable:
                chunk = os.read(0, 32768) if source == 0 else sock.recv(32768)
                if not chunk:
                    if source == 0:
                        inputs.remove(0)
                        sock.shutdown(socket.SHUT_WR)
                        continue
                    return 0
                total += len(chunk)
                if total > 8 * 1024 * 1024:
                    return 1
                if source == 0:
                    sock.sendall(chunk)
                else:
                    view = memoryview(chunk)
                    while view:
                        view = view[os.write(1, view):]
        return 0
    except Exception:
        if not ready:
            os.write(1, b'REJECTED\n')
        return 1
    finally:
        if sock:
            sock.close()


if __name__ == '__main__':
    sys.exit(main())
