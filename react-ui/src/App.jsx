import React, { useState } from 'react'
import useWebSocket from './useWebSocket'
import ConnectionPanel from './components/ConnectionPanel'
import UsersList from './components/UsersList'
import ChatWindow from './components/ChatWindow'

export default function App() {
  const [username, setUsername] = useState('')
  const [wsUrl, setWsUrl] = useState('wss://chat-server-production-1abc.up.railway.app')
  const [usuarioActual, setUsuarioActual] = useState('')
  const [usuarioSeleccionado, setUsuarioSeleccionado] = useState('Todos')
  const [unread, setUnread] = useState({})

  const {
    connect,
    disconnect,
    sendChat,
    connected,
    usuarios,
    groups,
    messages,
    sendReadReceipt,
    createGroup,
    loadMessagesFor,
    leaveGroup,
    deleteContact
  , renameGroup, renameContact } = useWebSocket()

  // Track new private messages and increment unread counts when appropriate
  React.useEffect(() => {
    if (!Array.isArray(messages)) return
    const prevRef = App._prevMessages || []
    const prevIds = new Set(prevRef.map(m => m.id || m.localId).filter(Boolean))
    const newItems = messages.filter(m => !(prevIds.has(m.id || m.localId)))
    if (newItems.length === 0) { App._prevMessages = messages.slice(); return }
    for (const m of newItems) {
      try {
        if (m.tipo === 'privado') {
          const em = String(m.emisor || '').toString()
          if (!em) continue
          // Do not increment if I sent it
          if (em.toString().trim().toLowerCase() === (usuarioActual||'').toString().trim().toLowerCase()) continue
          // Do not increment if chat is currently open with that user
          if (usuarioSeleccionado && usuarioSeleccionado.toString().trim() === em.toString().trim()) continue
          setUnread(prev => ({ ...prev, [em]: (prev[em] || 0) + 1 }))
        }
      } catch (e) {}
    }
    App._prevMessages = messages.slice()
  }, [messages, usuarioSeleccionado, usuarioActual])

  const handleConnect = (name, url) => {
    const n = String(name || '').trim()
    const u = String(url || '').trim() || 'wss://chat-server-production-1abc.up.railway.app'
    if (!n) return
    setUsername(n)
    setUsuarioActual(n)
    setWsUrl(u)
    connect(n, u)
  }

  return (
    <div className="app">
      <div className="phone">

        <header className="phone-header">
          <h1>Chat</h1>
        </header>

        <main className="phone-main">

          <aside className="sidebar">
            <ConnectionPanel
              username={username}
              onChangeUsername={setUsername}
              url={wsUrl}
              onChangeUrl={setWsUrl}
              onConnect={handleConnect}
              onDisconnect={disconnect}
              connected={connected}
            />

            <UsersList
              usuarios={usuarios}
              groups={groups}
              usuarioSeleccionado={usuarioSeleccionado}
              onSelect={setUsuarioSeleccionado}
              usuarioActual={usuarioActual}
                mensajes={messages}
              onCreateGroup={createGroup}
                unread={unread}
            />
          </aside>

          <section className="chat">
            <ChatWindow
              usuarioActual={usuarioActual}
              usuarioSeleccionado={usuarioSeleccionado}
              setUsuarioSeleccionado={setUsuarioSeleccionado}
                usuarios={usuarios}
                groups={groups}
              mensajes={messages}
              onSend={sendChat}
              onMarkAsRead={sendReadReceipt}
              loadMessagesFor={loadMessagesFor}
              clearUnread={(contactId) => setUnread(prev => Object.assign({}, prev, { [contactId]: 0 }))}
              leaveGroup={leaveGroup}
              deleteContact={deleteContact}
              renameGroup={renameGroup}
              renameContact={renameContact}
            />
          </section>

        </main>
      </div>
    </div>
  )
}