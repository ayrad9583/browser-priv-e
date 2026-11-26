const $=id=>document.getElementById(id);
let password="",sessionId="",poller=null,infoTimer=null,credentialTimer=null,busy=false,actionQueue=Promise.resolve(),lastObjectUrl="";
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
function startPolling(){stopPolling();poll();refreshInfo();checkCredentialPrompts();poller=setInterval(poll,650);infoTimer=setInterval(refreshInfo,2500);credentialTimer=setInterval(checkCredentialPrompts,1800)}
function stopPolling(){clearInterval(poller);clearInterval(infoTimer);clearInterval(credentialTimer);poller=infoTimer=credentialTimer=null}
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
$("newTab").onclick=async()=>{if(!confirm("Créer une nouvelle session privée ? La session actuelle sera fermée."))return;await act("close");sessionId="";clearPasswordVault();stopPolling();$("login").style.display="grid";$("password").value="";$("loginError").textContent="Connecte-toi pour démarrer une nouvelle session."};
$("close").onclick=async()=>{if(confirm("Fermer la session et effacer ses données temporaires ?")){await act("close");sessionId="";clearPasswordVault();stopPolling();$("login").style.display="grid";$("password").value="";$("loginError").textContent="Session fermée."}};
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

// GeForce NOW needs a native supported browser tab: remote screenshot streaming
// cannot carry its low-latency video, audio, and controller input correctly.
$("geforceDirect")?.addEventListener("click",()=>{
  window.open("https://play.geforcenow.com/","_blank","noopener,noreferrer");
  status("GeForce NOW s’ouvre dans un onglet Chrome séparé.");
});


// Temporary password vault: data stays in this tab's memory and is never sent to the server.
const passwordVault = [];
const vault = $("passwordManager");
function renderVault() {
  const list = $("vaultList");
  list.replaceChildren();
  if (!passwordVault.length) {
    const empty = document.createElement("p");
    empty.className = "vault-empty";
    empty.textContent = "Aucun mot de passe enregistré.";
    list.append(empty);
    return;
  }
  passwordVault.forEach((entry, index) => {
    const card = document.createElement("div"); card.className = "vault-entry";
    const info = document.createElement("div");
    const site = document.createElement("strong"); site.textContent = entry.site;
    const user = document.createElement("small"); user.textContent = entry.username || "Aucun nom d’utilisateur";
    info.append(site, user);
    const actions = document.createElement("div"); actions.className = "vault-actions";
    const fill = document.createElement("button"); fill.type = "button"; fill.textContent = "Remplir sur ce site";
    fill.onclick = async () => {
      if (!confirm("Remplir le formulaire visible avec les identifiants de " + entry.site + " ? Rien ne sera envoyé avant que tu valides toi-même le formulaire.")) return;
      try {
        const result = await api("autofill", { username: entry.username, secret: entry.secret });
        status(result.usernameFilled ? "Identifiant et mot de passe remplis." : "Mot de passe rempli.");
      } catch (e) { status(e.message); }
    };
    const copyUser = document.createElement("button"); copyUser.type = "button"; copyUser.textContent = "Copier identifiant";
    copyUser.onclick = () => copyVault(entry.username, "Identifiant");
    const copyPass = document.createElement("button"); copyPass.type = "button"; copyPass.textContent = "Copier mot de passe";
    copyPass.onclick = () => copyVault(entry.secret, "Mot de passe");
    const remove = document.createElement("button"); remove.type = "button"; remove.textContent = "Supprimer";
    remove.onclick = () => { passwordVault.splice(index, 1); renderVault(); };
    actions.append(fill, copyUser, copyPass, remove); card.append(info, actions); list.append(card);
  });
}
async function copyVault(value, label) {
  if (!value) { status(label + " indisponible"); return; }
  try { await navigator.clipboard.writeText(value); status(label + " copié."); }
  catch { status("Copie refusée par le navigateur."); }
}
$("passwordManagerBtn").addEventListener("click", () => {
  if (!sessionId) { status("Connecte-toi d’abord."); return; }
  vault.hidden = false; renderVault();
});
$("vaultClose").addEventListener("click", () => { vault.hidden = true; });
vault.addEventListener("click", e => { if (e.target === vault) vault.hidden = true; });
$("vaultForm").addEventListener("submit", e => {
  e.preventDefault();
  const site = $("vaultSite").value.trim(), username = $("vaultUser").value.trim(), secret = $("vaultPass").value;
  if (!site || !secret) return;
  passwordVault.push({ site, username, secret });
  $("vaultForm").reset(); renderVault(); status("Mot de passe gardé temporairement dans cet onglet.");
});
$("vaultClear").addEventListener("click", () => {
  if (passwordVault.length && confirm("Effacer tous les mots de passe temporaires ?")) {
    passwordVault.splice(0); renderVault(); status("Coffre temporaire vidé.");
  }
});
async function checkCredentialPrompts() {
  if (!sessionId) return;
  try {
    const r = await fetch("/api/credential-prompt", {
      headers: { "x-browser-password": password, "x-session-id": sessionId },
      cache: "no-store"
    });
    if (!r.ok) return;
    const data = await r.json();
    for (const item of (data.prompts || [])) {
      const save = confirm("PRIVATE BROWSER a détecté une connexion sur " + item.site +
        (item.username ? "\\nIdentifiant : " + item.username : "") +
        "\\n\\nEnregistrer ce mot de passe uniquement pour cette session ?");
      if (save) {
        const existing = passwordVault.findIndex(entry => entry.site === item.site && entry.username === item.username);
        const entry = { site: item.site, username: item.username, secret: item.secret };
        if (existing >= 0) passwordVault[existing] = entry; else passwordVault.push(entry);
        status("Connexion enregistrée temporairement pour " + item.site + ".");
        if (!vault.hidden) renderVault();
      }
    }
  } catch {}
}
function clearPasswordVault() { passwordVault.splice(0); renderVault(); vault.hidden = true; }
