const $=id=>document.getElementById(id);
let password="",sessionId="",poller=null,busy=false;
async function api(path,body={}){const r=await fetch("/api/"+path,{method:"POST",headers:{"Content-Type":"application/json","x-browser-password":password,"x-session-id":sessionId},body:JSON.stringify(body)});const d=await r.json().catch(()=>({}));if(!r.ok)throw Error(d.error||"Erreur serveur");return d}
function status(t){$("status").textContent=t}
async function login(){
 password=$("password").value;
 try{const r=await fetch("/api/login",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({password})});const d=await r.json();if(!r.ok)throw Error(d.error||"Connexion refusée");
 const s=await fetch("/api/session",{method:"POST",headers:{"x-browser-password":password}});const j=await s.json();if(!s.ok)throw Error(j.error||"Démarrage impossible");
 sessionId=j.sessionId;$("login").style.display="none";$("address").value="https://www.google.com/";$("screen").style.display="block";status("Connecté à Google");startPolling();
 }catch(e){$("loginError").textContent=e.message}
}
async function poll(){if(busy||!sessionId)return;try{busy=true;const [img,info]=await Promise.all([fetch("/api/screenshot",{headers:{"x-browser-password":password,"x-session-id":sessionId},cache:"no-store"}),fetch("/api/info",{headers:{"x-browser-password":password,"x-session-id":sessionId},cache:"no-store"})]);if(img.ok){const blob=await img.blob();$("screen").src=URL.createObjectURL(blob);$("loading").style.display="none"}if(info.ok){const d=await info.json();if(document.activeElement!==$("address"))$("address").value=d.url;status(d.title||d.url)}}catch(e){status("Reconnexion…")}finally{busy=false}}
function startPolling(){poll();poller=setInterval(poll,750)}
async function act(name,body={}){try{await api(name,body);if(name==="navigate")status("Chargement…");setTimeout(poll,300)}catch(e){status(e.message)}}
$("loginBtn").onclick=login;$("password").addEventListener("keydown",e=>{if(e.key==="Enter")login()});
$("addressForm").onsubmit=e=>{e.preventDefault();act("navigate",{url:$("address").value})};
$("back").onclick=()=>act("back");$("forward").onclick=()=>act("forward");$("reload").onclick=()=>act("reload");
$("home").onclick=()=>{$("address").value="https://www.google.com/";act("navigate",{url:"https://www.google.com/"})};
$("newTab").onclick=async()=>{if(!confirm("Créer une nouvelle session privée ? La session actuelle sera fermée."))return;await act("close");sessionId="";clearInterval(poller);$("login").style.display="grid";$("password").value="";$("loginError").textContent="Connecte-toi pour démarrer une nouvelle session."};
$("close").onclick=async()=>{if(confirm("Fermer la session et effacer ses données temporaires ?")){await act("close");sessionId="";clearInterval(poller);$("login").style.display="grid";$("password").value="";$("loginError").textContent="Session fermée."}};
$("screen").addEventListener("click",e=>{const r=e.target.getBoundingClientRect();const x=(e.clientX-r.left)*1280/r.width;const y=(e.clientY-r.top)*800/r.height;act("click",{x,y})});
$("screen").addEventListener("wheel",e=>{e.preventDefault();act("scroll",{delta:e.deltaY})},{passive:false});
document.addEventListener("keydown",e=>{if(document.activeElement===$("address")||document.activeElement===$("password"))return;if(e.key==="Enter")act("key",{key:"Enter"});else if(["Backspace","Tab","Escape","ArrowUp","ArrowDown","ArrowLeft","ArrowRight"].includes(e.key)){e.preventDefault();act("key",{key:e.key})}else if(e.ctrlKey&&e.key.toLowerCase()==="a"){act("key",{key:"Control+A"})}else if(e.ctrlKey&&e.key.toLowerCase()==="c"){act("key",{key:"Control+C"})}else if(e.ctrlKey&&e.key.toLowerCase()==="v"){act("key",{key:"Control+V"})}else if(e.ctrlKey&&e.key.toLowerCase()==="x"){act("key",{key:"Control+X"})}else if(e.key.length===1)act("type",{text:e.key})});
window.addEventListener("beforeunload",()=>{if(sessionId)navigator.sendBeacon("/api/close")});

document.querySelectorAll(".quick-sites button").forEach(button=>{
  button.addEventListener("click",()=>{
    const url=button.dataset.url;
    $("address").value=url;
    act("navigate",{url});
  });
});
