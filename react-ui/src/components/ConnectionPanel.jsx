import React from 'react'

export default function ConnectionPanel({ username, onChangeUsername, url, onChangeUrl, onConnect, onDisconnect, connected }) {
  const nombreValido = String(username || '').trim().length > 0

  return (
    <section className="connection">
      <label>Usuario</label>
      <input value={username} onChange={(e) => onChangeUsername(e.target.value)} />

      <label>WebSocket URL</label>
      <input value={url} onChange={(e) => onChangeUrl(e.target.value)} placeholder="ws://localhost:8083" />

      {!connected ? (
        <button onClick={() => onConnect(String(username).trim(), String(url).trim())} className="btn" disabled={!nombreValido}>Conectar</button>
      ) : (
        <button onClick={onDisconnect} className="btn danger">Desconectar</button>
      )}
    </section>
  )
}
