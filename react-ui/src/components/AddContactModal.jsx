import React, { useState } from 'react'

export default function AddContactModal({ onClose, onAdd }) {
  const [value, setValue] = useState('')

  return (
    <div className="modal-backdrop" style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.4)',display:'flex',alignItems:'center',justifyContent:'center', zIndex:9999}}>
      <div className="modal" style={{background:'#fff',padding:20,borderRadius:8,maxWidth:400,width:'92%'}}>
        <div style={{fontWeight:700, marginBottom:8}}>Agregar contacto</div>
        <div style={{marginBottom:12}}>
          <label style={{display:'block',fontSize:13,marginBottom:6}}>Usuario:</label>
          <input autoFocus placeholder="Usuario" value={value} onChange={(e) => setValue(e.target.value)} style={{width:'100%',padding:8,marginBottom:6,borderRadius:6,border:'1px solid #ddd'}} />
        </div>
        <div style={{display:'flex',justifyContent:'flex-end',gap:8}}>
          <button className="btn" onClick={() => { if (typeof onClose === 'function') onClose() }}>Cancelar</button>
          <button className="btn" onClick={() => { if (typeof onAdd === 'function') onAdd(value); if (typeof onClose === 'function') onClose() }}>Agregar</button>
        </div>
      </div>
    </div>
  )
}
