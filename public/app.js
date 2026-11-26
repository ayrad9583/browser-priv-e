const $=id=>document.getElementById(id);
let password="",sessionId="",poller=null,infoTimer=null,busy=false,actionQueue=Promise.resolve(),lastObjectUrl="";
const SCREEN_W=1280,SCREEN_H=800;
async function api(path,body={}){const r=await fetch("/api/"+path,{method:"POST",headers:{"Content-Type":"application/json","x-browser-password":password,"x-session-id":sessionId},body:JSON.stringify(body)});const d=await r.json().catch(()=>({}));if(!r.ok)throw Error(d.error||"Erreur serveur");return d}
function status(t){$("status").textContent=t}
async function login(){
 const error=$("loginError"),btn=$("loginBtn");error.textContent="Connexion en cours…";btn.disabled=true;btn.textContent="Connexion…";password=$("password").value.trim();
 try{const r=await fetch("/api/login",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({password})});const d=await r.json().catch(()=>({}));if(!r.ok)throw Error(d.error||"Connexion refusée");
 const s=await fetch("/api/session",{method:"POST",headers:{"x-browser-password":password}});const j=await s.json().catch(()=>({}));if(!s.ok)throw Error(j.error||"Démarrage impossible");
 sessionId=j.sessionId;$("login").style.display="none";$("address").value="https://www.google.com/";$("screen").style.display="block";$("loading").style.display="block";status("Connecté");startPolling();
 }catch(e){error.textContent=e.message||"Erreur de connexion.";status("Connexion impossible")}finally{btn.disabled=false;btn.textContent="Entrer"}
}
async function poll(){
 if(busy||!sessionId)return;
 busy=true;
 try{
  const r=await fetch("/api/screenshot",{headers:{"x-browser-password":password,"x-session-id":sessionId},cache:"no-store"});
  if(r.status===404){status("Session expirée — reconnecte-toi");stopPolling();return}
  if(r.ok){const blob=await r.blob(),url=URL.createObjectURL(blob),img=$("screen");img.onload=()=>{if(lastObjectUrl&&lastObjectUrl!==url)URL.revokeObjectURL(lastObjectUrl);lastObjectUrl=url};img.src=url;$("loading").style.display="none"}
 }catch(e){status("Reconnexion…")}finally{busy=false}
}
async function refreshInfo(){if(!sessionId)return;try{const r=await fetch("/api/info",{headers:{"x-browser-password":password,"x-session-id":sessionId},cache:"no-store"});if(r.ok){const d=await r.json();if(document.activeElement!==$("address"))$("address").value=d.url;status(d.title||d.url)}}catch{}}
function startPolling(){stopPolling();poll();refreshInfo();poller=setInterval(poll,650);infoTimer=setInterval(refreshInfo,2500)}
function stopPolling(){clearInterval(poller);clearInterval(infoTimer);poller=infoTimer=null}
function act(name,body={}){actionQueue=actionQueue.then(async()=>{if(!sessionId)return;try{await api(name,body);if(name==="navigate")status("Chargement…");await poll()}catch(e){status(e.message)}});return actionQueue}
function screenPoint(e){
 const img=$("screen"),r=img.getBoundingClientRect(),scale=Math.min(r.width/SCREEN_W,r.height/SCREEN_H);
 const w=SCREEN_W*scale,h=SCREEN_H*scale,left=r.left+(r.width-w)/2,top=r.top+(r.height-h)/2;
 return {x:Math.max(0,Math.min(SCREEN_W-1,(e.clientX-left)/scale)),y:Math.max(0,Math.min(SCREEN_H-1,(e.clientY-top)/scale))};
}
$("loginBtn").addEventListener("click",e=>{e.preventDefault();login()});
$("password").addEventListener("keydown",e=>{if(e.key==="Enter"){e.preventDefault();login()}});
$("addressForm").onsubmit=e=>{e.preventDefault();act("navigate",{url:$("address").value})};
$("back").onclick=()=>act("back");$("forward").onclick=()=>act("forward");$("reload").onclick=()=>act("reload");
$("home").onclick=()=>{$("address").value="https://www.google.com/";act("navigate",{url:"https://www.google.com/"})};
$("newTab").onclick=async()=>{if(!confirm("Créer une nouvelle session privée ? La session actuelle sera fermée."))return;await act("close");sessionId="";stopPolling();$("login").style.display="grid";$("password").value="";$("loginError").textContent="Connecte-toi pour démarrer une nouvelle session."};
$("close").onclick=async()=>{if(confirm("Fermer la session et effacer ses données temporaires ?")){await act("close");sessionId="";stopPolling();$("login").style.display="grid";$("password").value="";$("loginError").textContent="Session fermée."}};
$("screen").addEventListener("click",e=>act("click",screenPoint(e)));
$("screen").addEventListener("wheel",e=>{e.preventDefault();act("scroll",{delta:e.deltaY})},{passive:false});
document.addEventListener("keydown",e=>{
 if(document.activeElement===$("address")||document.activeElement===$("password")||!sessionId)return;
 if(e.key==="Enter")act("key",{key:"Enter"});
 else if(["Backspace","Tab","Escape","ArrowUp","ArrowDown","ArrowLeft","ArrowRight"].includes(e.key)){e.preventDefault();act("key",{key:e.key})}
 else if(e.ctrlKey&&["a","c","v","x"].includes(e.key.toLowerCase())){e.preventDefault();act("key",{key:"Control+"+e.key.toUpperCase()})}
 else if(e.key.length===1&&!e.ctrlKey&&!e.metaKey&&!e.altKey)act("type",{text:e.key});
});
window.addEventListener("beforeunload",()=>{if(sessionId)navigator.sendBeacon("/api/close")});
document.querySelectorAll(".quick-sites button").forEach(button=>button.addEventListener("click",()=>{$("address").value=button.dataset.url;act("navigate",{url:button.dataset.url})}));
