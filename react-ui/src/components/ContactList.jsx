export default function ContactList({
  users = [],
  groups = [],
  status = {},
  currentUser,
  activeTab = "todos",
  onSelect
}) {

const visibleUsers =
Array.isArray(users)
? users.filter(u => u !== currentUser)
: []

function formatLastSeen(ts){
 if(!ts) return "Desconectado"

 return new Date(ts).toLocaleTimeString(
  "es-MX",
  {
   hour:"2-digit",
   minute:"2-digit"
  }
 )
}

return (
<>

<h3 style={{marginTop:12}}>Personas</h3>

<ul>

{
visibleUsers.length
?

visibleUsers.map((name,i)=>{

const st=status?.[name]

return (

<li
key={i}
onClick={()=>{
 if(onSelect) onSelect(name)
}}
>

<div className="user-item compact">

<div className="avatar small">
{name?.[0]?.toUpperCase()}
</div>

<div>

<div className="name">
{name}
</div>

<small>

{
st?.online
? "🟢 En línea"
: `⚪ Últ. vez ${formatLastSeen(st?.lastSeen)}`
}

</small>

</div>

</div>

</li>

)

})

:

<li>
No hay personas conectadas
</li>

}

</ul>

<h3 style={{marginTop:20}}>
Grupos
</h3>

<ul>

{
Array.isArray(groups)
&& groups.length

?

groups.map((g,i)=>(

<li
key={i}
onClick={()=>{
 if(onSelect) onSelect(g)
}}
>

<div className="user-item compact">

<div className="avatar small">
G
</div>

<div>
{g}
</div>

</div>

</li>

))

:

<li>
No hay grupos
</li>

}

</ul>

</>
)

}