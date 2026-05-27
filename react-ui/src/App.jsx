import React, { useState } from 'react'
import useWebSocket from './useWebSocket'
import ConnectionPanel from './components/ConnectionPanel'
import UsersList from './components/UsersList'
import ChatWindow from './components/ChatWindow'
import CreateGroupModal from './components/CreateGroupModal'

export default function App() {
  const WS_URL = import.meta.env.VITE_WS_URL || "wss://chat-server-production-1abc.up.railway.app"
  const [username, setUsername] = useState('')
  const [wsUrl, setWsUrl] = useState(WS_URL)
  const [usuarioActual, setUsuarioActual] = useState('')
  const [usuarioSeleccionado, setUsuarioSeleccionado] = useState('Todos')
  const [unread, setUnread] = useState({})

  const {
    connect,
    disconnect,
    sendChat,
    connected,
    users,
    groups,
    messages,
    sendReadReceipt,
    createGroup,
    loadMessagesFor,
    leaveGroup,
    deleteContact,
    renameGroup,
    renameContact,
    addContact,
    groupsByUser,
    dbReady
  } = useWebSocket()
  

  const [showCreateGroupModal, setShowCreateGroupModal] = useState(false)
  const [selectedChat, setSelectedChat] = useState(null)

  const handleSelectChat = (payload) => {
    // payload can be a string username or an object { tipo, nombre }
    if (!payload) return
    if (typeof payload === 'string') {
      setUsuarioSeleccionado(payload)
      setSelectedChat({ tipo: 'privado', nombre: payload })
      return
    }
    if (payload && typeof payload === 'object') {
      const name = payload.nombre || payload.name || ''
      setUsuarioSeleccionado(name)
      setSelectedChat(payload)
    }
  }

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
              users={users}
              usuarioSeleccionado={usuarioSeleccionado}
              onSelect={handleSelectChat}
              usuarioActual={usuarioActual}
              mensajes={messages}
              onCreateGroup={createGroup}
              groups={groups}
              unread={unread}
              onOpenCreateGroup={() => setShowCreateGroupModal(true)}
            />
          </aside>

          {/* Add contact modal intentionally hidden in users-first UI */}

          <section className="chat">
            <ChatWindow
              usuarioActual={usuarioActual}
              usuarioSeleccionado={usuarioSeleccionado}
              setUsuarioSeleccionado={setUsuarioSeleccionado}
                users={users}
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
      {showCreateGroupModal && (
        <CreateGroupModal
          users={users}
          currentUser={usuarioActual}
          onClose={() => setShowCreateGroupModal(false)}
          onCreate={(payload) => {
            // payload: { nombreGrupo, miembros }
            if (typeof createGroup === 'function') createGroup(payload.nombreGrupo, payload.miembros)
            setShowCreateGroupModal(false)
          }}
        />
      )}
    </div>
  )
}