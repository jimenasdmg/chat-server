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
  // unread counts now provided by the WebSocket hook

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
    dbReady,
    unreadMap,
    clearUnreadFor
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

  // server provides unread counters; local increment logic removed

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
              unread={unreadMap}
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
              clearUnread={(contactId) => clearUnreadFor(contactId)}
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