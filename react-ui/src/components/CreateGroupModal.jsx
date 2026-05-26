import React, { useState } from 'react'

export default function CreateGroupModal({ onClose, contacts = [], currentUser, onCreate }) {
  const [nombre, setNombre] = useState('')
  const [selected, setSelected] = useState(() => new Set())

  const toggle = (u) => {
    const s = new Set(selected)
    if (s.has(u)) s.delete(u)
    else s.add(u)
    setSelected(s)
  }

  const handleCreate = () => {
    const miembros = Array.from(selected)
    if (currentUser && !miembros.includes(currentUser)) miembros.push(currentUser)
    if (!nombre || miembros.length < 2) return alert('Nombre y al menos 2 miembros')
    if (typeof onCreate === 'function') onCreate({ nombreGrupo: nombre, miembros })
    if (typeof onClose === 'function') onClose()
  }

  return (
    <div className="modal-backdrop" style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.4)',display:'flex',alignItems:'center',justifyContent:'center', zIndex:9999}}>
      <div className="modal" style={{background:'#fff',padding:20,borderRadius:8,maxWidth:520,width:'94%'}}>
        <div style={{fontWeight:700, marginBottom:8}}>Crear grupo</div>
        <div style={{marginBottom:12}}>
          <label style={{display:'block',fontSize:13,marginBottom:6}}>Nombre del grupo:</label>
          <input autoFocus placeholder="Nombre del grupo" value={nombre} onChange={(e) => setNombre(e.target.value)} style={{width:'100%',padding:8,marginBottom:6,borderRadius:6,border:'1px solid #ddd'}} />
        </div>
        <div style={{maxHeight:220, overflow:'auto', border:'1px solid #eee', padding:8, borderRadius:8, marginBottom:12}}>
          <div style={{fontSize:13, marginBottom:8}}>Selecciona miembros (haz clic):</div>
          {(contacts || []).map((c,i) => {
            const name = c.username || c.nombre || c
            if (name === currentUser) return null
            const checked = selected.has(name)
            return (
              <div key={name + i} style={{display:'flex', alignItems:'center', gap:8, padding:'6px 4px', cursor:'pointer'}} onClick={() => toggle(name)}>
                <input type="checkbox" checked={checked} readOnly />
                <div>{name}</div>
              </div>
            )
          })}
        </div>
        <div style={{display:'flex',justifyContent:'flex-end',gap:8}}>
          <button className="btn" onClick={() => { if (typeof onClose === 'function') onClose() }}>Cancelar</button>
          <button className="btn" onClick={handleCreate}>Crear</button>
        </div>
      </div>
    </div>
  )
}
