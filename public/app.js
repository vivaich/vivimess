const $ = id => document.getElementById(id);
let token = localStorage.getItem("vm_token") || "";
let me = null, socket = null, activeFriend = null, friends = [], authMode = "login", siteSettings = {};
let pc = null, localStream = null, currentCallPeer = null, incomingOffer = null, callMode = "audio", pendingIce = [];
const ICE = { iceServers: [{ urls: "stun:stun.l.google.com:19302" }] };

function toast(message) { const el=$("toast"); el.textContent=message; el.classList.add("show"); setTimeout(()=>el.classList.remove("show"),2600); }
async function api(url, options={}) {
  const headers = { "Content-Type":"application/json", ...(options.headers||{}) };
  if (token) headers.Authorization = "Bearer " + token;
  const res = await fetch(url, {...options, headers});
  const data = await res.json().catch(()=>({}));
  if (!res.ok) throw new Error(data.error || "Something went wrong.");
  return data;
}
function setAuthMode(mode) {
  authMode=mode;
  document.querySelectorAll(".tab").forEach(b=>b.classList.toggle("active",b.dataset.tab===mode));
  $("displayLabel").classList.toggle("hidden",mode!=="register");
  $("authSubmit").textContent=mode==="register"?"Create account":"Sign in";
  $("authError").textContent="";
}
document.querySelectorAll(".tab").forEach(b=>b.onclick=()=>setAuthMode(b.dataset.tab));
$("authForm").onsubmit=async e=>{
  e.preventDefault(); $("authError").textContent="";
  try {
    const body={username:$("username").value,password:$("password").value,displayName:$("displayName").value};
    const data=await api("/api/"+(authMode==="register"?"register":"login"),{method:"POST",body:JSON.stringify(body)});
    token=data.token; localStorage.setItem("vm_token",token); me=data.user; await boot();
  } catch(err){$("authError").textContent=err.message;}
};
async function boot() {
  try { const data=await api("/api/me"); me=data.user; }
  catch { token="";localStorage.removeItem("vm_token");$("auth").classList.remove("hidden");$("app").classList.add("hidden");return; }
  $("auth").classList.add("hidden");$("app").classList.remove("hidden");
  $("studioNav").classList.toggle("hidden", me.role !== "admin");
  await loadSiteSettings(); await loadCurrencies();
  $("miniUser").textContent=me.displayName+"  @"+me.username;
  $("profileHeading").textContent=me.displayName;
  $("profileUsername").value=me.username;$("profileName").value=me.displayName;$("profileBio").value=me.bio||"";$("profileAvatarFile").value="";renderAvatar($("profileAvatar"),me);
  connectSocket(); await loadFriends(); showView("chats");
}
async function loadSiteSettings(){
  try{
    const data=await api("/api/settings");siteSettings=data.settings||{};
    applySiteSettings(data.customCss||"");
  }catch(e){console.warn("Settings unavailable",e);}
}
function applySiteSettings(customCss=""){
  const root=document.documentElement;
  if(siteSettings.accent)root.style.setProperty("--mint",siteSettings.accent);
  if(siteSettings.background)root.style.setProperty("--bg",siteSettings.background);
  if(siteSettings.panel)root.style.setProperty("--panel",siteSettings.panel);
  document.title=(siteSettings.appName||"ViviMess")+" — Creator Community";
  const name=document.querySelector(".logo b");if(name)name.textContent=siteSettings.appName||"ViviMess";
  const tagline=document.querySelector(".auth-card .muted");if(tagline)tagline.textContent=siteSettings.tagline||"Messages, calls and screen sharing — all in one place.";
  const style=document.getElementById("userCustomCss")||document.head.appendChild(Object.assign(document.createElement("style"),{id:"userCustomCss"}));
  style.textContent=customCss||"";
  document.querySelectorAll('[data-view="friends"]').forEach(el=>el.classList.toggle("hidden",siteSettings.showFriends===false));
  $("audioCall").classList.toggle("hidden",siteSettings.showCalls===false);
  $("videoCall").classList.toggle("hidden",siteSettings.showCalls===false||siteSettings.showVideo===false);
  $("shareBtn").classList.toggle("hidden",siteSettings.showScreenShare===false);
}
async function loadStudio(){
  if(me?.role!=="admin")return;
  try{
    const data=await api("/api/admin/settings");siteSettings=data.settings||{};
    $("setAppName").value=siteSettings.appName||"ViviMess";$("setTagline").value=siteSettings.tagline||"";
    $("setAccent").value=siteSettings.accent||"#28e0b2";$("setBackground").value=siteSettings.background||"#0b111a";$("setPanel").value=siteSettings.panel||"#182331";
    $("featureFriends").checked=siteSettings.showFriends!==false;$("featureCalls").checked=siteSettings.showCalls!==false;
    $("featureVideo").checked=siteSettings.showVideo!==false;$("featureShare").checked=siteSettings.showScreenShare!==false;
    $("customCss").value=data.customCss||"";
    const stats=await api("/api/admin/overview");$("statUsers").textContent=stats.users;$("statMessages").textContent=stats.messages;$("statFriends").textContent=stats.friends;
    await loadCurrencies();
  }catch(e){toast(e.message);}
}

async function loadCurrencies(){
  try{
    const data=await api("/api/currencies");
    const currencies=data.currencies||[];
    const bal=$("currencyBalance");
    if(bal) bal.innerHTML=currencies.map(c=>`${c.logo ? (c.logoType==="video" ? `<video src="${c.logo}" autoplay muted loop playsinline></video>` : `<img src="${c.logo}" alt="">`) : `<span class="currency-placeholder">◈</span>`}<span>${escapeHtml(c.name)}</span><b>${Number(c.balance||0)}</b>`).join("") || "No currency";
    const list=$("currencyList");
    if(list){list.innerHTML="";currencies.forEach(c=>{
      const row=document.createElement("div");row.className="currency-row";
      const preview=c.logoType==="video"?`<video src="${c.logo}" autoplay muted loop playsinline></video>`:c.logo?`<img src="${c.logo}" alt="">`:`<span>◈</span>`;
      row.innerHTML=`<div class="currency-logo">${preview}</div><div class="currency-meta"><b>${escapeHtml(c.name)}</b><small>Balance: ${Number(c.balance||0)}</small></div><button class="soft" data-edit="${c.id}">Edit</button>`;
      row.querySelector("button").onclick=()=>editCurrency(c);
      list.append(row);
    });}
    const select=$("balanceCurrency");
    if(select){select.innerHTML="";currencies.forEach(c=>{const o=document.createElement("option");o.value=c.id;o.textContent=c.name;select.append(o);});}
  }catch(e){if(e.message!=="Please sign in again.")console.warn(e);}
}
async function fileAsDataUrl(file){
  if(!file)return "";
  if(file.size>8*1024*1024)throw new Error("Choose a file smaller than 8 MB.");
  return await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=()=>reject(new Error("Could not read file."));r.readAsDataURL(file);});
}
function mediaType(file){return file && file.type.startsWith("video/")?"video":file && file.type==="image/gif"?"gif":"image";}
async function editCurrency(c){
  const name=prompt("Currency name:",c.name);if(name===null)return;
  const change=confirm("Replace the currency logo? Choose Cancel to keep the current logo.");
  let body={name};
  if(change){
    const pick=document.createElement("input");pick.type="file";pick.accept="image/*,.gif,video/mp4,video/webm";
    pick.onchange=async()=>{try{const f=pick.files[0];if(f){body.logo=await fileAsDataUrl(f);body.logoType=mediaType(f);}await api("/api/admin/currencies/"+c.id,{method:"PATCH",body:JSON.stringify(body)});await loadCurrencies();toast("Currency updated.");}catch(e){toast(e.message);}};
    pick.click();return;
  }
  try{await api("/api/admin/currencies/"+c.id,{method:"PATCH",body:JSON.stringify(body)});await loadCurrencies();toast("Currency renamed.");}catch(e){toast(e.message);}
}
const currencyForm=$("currencyForm");
if(currencyForm)currencyForm.onsubmit=async e=>{
  e.preventDefault();try{const file=$("currencyLogo").files[0];const logo=await fileAsDataUrl(file);await api("/api/admin/currencies",{method:"POST",body:JSON.stringify({name:$("currencyName").value,logo,logoType:mediaType(file)})});$("currencyLogo").value="";$("currencyName").value="";$("currencyStatus").textContent="Currency created. All balances start at 0.";await loadCurrencies();}catch(err){$("currencyStatus").textContent=err.message;}
};
const roleForm=$("roleForm");
if(roleForm)roleForm.onsubmit=async e=>{e.preventDefault();try{await api("/api/admin/roles",{method:"POST",body:JSON.stringify({username:$("roleUsername").value,role:$("roleValue").value})});$("accountAdminStatus").textContent="Permissions updated."; }catch(err){$("accountAdminStatus").textContent=err.message;}};
const balanceForm=$("balanceForm");
if(balanceForm)balanceForm.onsubmit=async e=>{e.preventDefault();try{await api("/api/admin/balance",{method:"POST",body:JSON.stringify({username:$("balanceUsername").value,currencyId:$("balanceCurrency").value,amount:Number($("balanceAmount").value)})});$("accountAdminStatus").textContent="Balance updated.";await loadCurrencies();}catch(err){$("accountAdminStatus").textContent=err.message;}};

function connectSocket(){
  if(socket)socket.disconnect();
  socket=io({auth:{token}});
  socket.on("connect_error",()=>toast("Live connection unavailable. Refresh the page."));
  socket.on("message:new",m=>{if(activeFriend&&(m.from===activeFriend.id||m.to===activeFriend.id))loadMessages(activeFriend.id);});
  socket.on("friends:changed",loadFriends);
  socket.on("call:incoming",data=>{if(currentCallPeer){socket.emit("call:signal",{to:data.from,signal:{type:"busy"}});return;}if(confirm(data.username+" is calling. Accept?")){startCall(data.from,data.mode,true);}else socket.emit("call:end",{to:data.from});});
  socket.on("call:signal",handleSignal);
  socket.on("call:ended",()=>endCall(false));
}
function showView(name){
  document.querySelectorAll(".view").forEach(v=>v.classList.add("hidden"));
  $("view-"+name).classList.remove("hidden");
  document.querySelectorAll(".nav[data-view]").forEach(b=>b.classList.toggle("active",b.dataset.view===name));
  $("pageTitle").textContent={chats:"Messages",friends:"Friends",profile:"My profile"}[name];
  if(name==="friends")loadPeople($("userSearch").value);
  if(name==="studio")loadStudio();
}
document.querySelectorAll(".nav[data-view]").forEach(b=>b.onclick=()=>showView(b.dataset.view));
document.querySelectorAll("[data-goto]").forEach(b=>b.onclick=()=>showView(b.dataset.goto));
$("logout").onclick=()=>{if(socket)socket.disconnect();localStorage.removeItem("vm_token");location.reload();};
function renderAvatar(el,user){el.innerHTML="";if(user.avatar){const img=document.createElement("img");img.src=user.avatar;img.onerror=()=>{el.textContent=(user.displayName||user.username||"V")[0].toUpperCase();};el.append(img);}else el.textContent=(user.displayName||user.username||"V")[0].toUpperCase();}
async function loadFriends(){
  try{friends=(await api("/api/friends")).users;renderFriends();renderFriendsGrid();}catch(e){toast(e.message);}
}
function renderFriends(){
  const host=$("chatFriends");host.innerHTML="";
  if(!friends.length){host.innerHTML='<p class="muted">No friends yet. Add someone in Friends.</p>';return;}
  friends.forEach(u=>{const el=document.createElement("div");el.className="person-row"+(activeFriend?.id===u.id?" selected":"");const av=document.createElement("div");av.className="avatar";renderAvatar(av,u);const info=document.createElement("div");info.className="person-info";info.innerHTML=`<b></b><small>@${escapeHtml(u.username)}</small>`;info.querySelector("b").textContent=u.displayName;el.append(av,info);el.onclick=()=>selectFriend(u);host.append(el);});
}
function renderFriendsGrid(){
  const host=$("friendsGrid");host.innerHTML="";
  if(!friends.length){host.innerHTML='<p class="muted">Your friend list is empty.</p>';return;}
  friends.forEach(u=>host.append(userCard(u,true)));
}
function userCard(u,isFriend){
  const el=document.createElement("div");el.className="user-card";const av=document.createElement("div");av.className="avatar";renderAvatar(av,u);const info=document.createElement("div");info.className="person-info";info.innerHTML="<b></b><small></small>";info.querySelector("b").textContent=u.displayName;info.querySelector("small").textContent="@"+u.username;const btn=document.createElement("button");btn.className=isFriend?"soft":"primary";btn.textContent=isFriend?"Remove":"＋ Add";btn.onclick=async()=>{try{await api("/api/friends/"+u.id,{method:isFriend?"DELETE":"POST"});await loadFriends();await loadPeople($("userSearch").value);toast(isFriend?"Friend removed":"Friend added!");}catch(e){toast(e.message);}};el.append(av,info,btn);return el;
}
async function loadPeople(q=""){
  try{const data=await api("/api/users?q="+encodeURIComponent(q));const host=$("searchResults");host.innerHTML="";if(!data.users.length){host.innerHTML='<p class="muted">No creators found.</p>';return;}data.users.forEach(u=>host.append(userCard(u,u.isFriend)));}catch(e){toast(e.message);}
}
let searchTimer; $("userSearch").oninput=()=>{clearTimeout(searchTimer);searchTimer=setTimeout(()=>loadPeople($("userSearch").value),250);};
async function selectFriend(user){activeFriend=user;renderFriends();$("emptyChat").classList.add("hidden");$("chatActive").classList.remove("hidden");const head=$("chatPerson");head.innerHTML="";const av=document.createElement("div");av.className="avatar";renderAvatar(av,user);const label=document.createElement("span");label.textContent=user.displayName+"  @"+user.username;head.append(av,label);await loadMessages(user.id);}
async function loadMessages(id){
  try{const data=await api("/api/messages/"+id);const host=$("messages");host.innerHTML="";data.messages.forEach(m=>appendMessage(m));host.scrollTop=host.scrollHeight;}catch(e){toast(e.message);}
}
function appendMessage(m){const host=$("messages");const el=document.createElement("div");el.className="bubble"+(m.from===me.id?" mine":"");el.textContent=m.text;const time=document.createElement("small");time.textContent=new Date(m.createdAt).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"});el.append(time);host.append(el);host.scrollTop=host.scrollHeight;}
$("messageForm").onsubmit=e=>{e.preventDefault();const text=$("messageInput").value.trim();if(!text||!activeFriend)return;socket.emit("message:send",{to:activeFriend.id,text});$("messageInput").value="";};
$("profileAvatarFile").onchange=async()=>{try{const file=$("profileAvatarFile").files[0];if(!file)return;if(!["image/png","image/jpeg","image/webp","image/gif"].includes(file.type))throw new Error("Choose a PNG, JPG, WEBP or GIF image.");if(file.size>7*1024*1024)throw new Error("Avatar must be smaller than 7 MB.");const preview=await fileAsDataUrl(file);renderAvatar($("profileAvatar"),{...me,avatar:preview});}catch(err){$("profileMessage").textContent=err.message;$("profileAvatarFile").value="";}};
$("profileForm").onsubmit=async e=>{e.preventDefault();try{const file=$("profileAvatarFile").files[0];const avatar=file?await fileAsDataUrl(file):me.avatar||"";const data=await api("/api/profile",{method:"PATCH",body:JSON.stringify({displayName:$("profileName").value,bio:$("profileBio").value,avatar})});me=data.user;$("profileHeading").textContent=me.displayName;$("profileUsername").value=me.username;renderAvatar($("profileAvatar"),me);$("miniUser").textContent=me.displayName+"  @"+me.username;$("profileAvatarFile").value="";$("profileMessage").textContent="Profile saved!";toast("Profile saved!");}catch(err){$("profileMessage").textContent=err.message;}};
function escapeHtml(s){return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}

$("audioCall").onclick=()=>startCall(activeFriend.id,"audio",false);
$("videoCall").onclick=()=>startCall(activeFriend.id,"video",false);
async function startCall(peer,mode,isAnswer){
  if(!peer)return;currentCallPeer=peer;callMode=mode;$("callModal").classList.remove("hidden");$("callTitle").textContent=(mode==="video"?"Video":"Voice")+" call";
  $("callHint").textContent=isAnswer?"Connecting…":"Calling…";
  try{
    localStream=await navigator.mediaDevices.getUserMedia({audio:true,video:mode==="video"});
    $("localVideo").srcObject=localStream;$("localVideo").classList.toggle("hidden",mode!=="video");
    pc=new RTCPeerConnection(ICE);localStream.getTracks().forEach(t=>pc.addTrack(t,localStream));
    pc.ontrack=e=>{$("remoteVideo").srcObject=e.streams[0];$("callHint").classList.add("hidden");};
    pc.onicecandidate=e=>{if(e.candidate)socket.emit("call:signal",{to:peer,signal:{type:"ice",candidate:e.candidate}});};
    pc.onconnectionstatechange=()=>{if(pc&&["failed","disconnected"].includes(pc.connectionState))$("callHint").textContent="Connection interrupted…";};
    if(isAnswer){
      if(incomingOffer){await pc.setRemoteDescription(incomingOffer);for(const c of pendingIce)await pc.addIceCandidate(c);pendingIce=[];}
      const answer=await pc.createAnswer();await pc.setLocalDescription(answer);socket.emit("call:signal",{to:peer,signal:{type:"description",description:pc.localDescription}});
    }else{
      socket.emit("call:invite",{to:peer,mode});
      const offer=await pc.createOffer();await pc.setLocalDescription(offer);socket.emit("call:signal",{to:peer,signal:{type:"description",description:pc.localDescription}});
    }
  }catch(e){toast("Camera/microphone error: "+e.message);endCall(false);}
}
async function handleSignal({from,signal}){
  try{
    if(signal.type==="busy"){toast("This user is busy.");return;}
    if(signal.type==="description"){
      if(!pc){incomingOffer=signal.description;return;}
      await pc.setRemoteDescription(signal.description);
      if(signal.description.type==="offer"){const answer=await pc.createAnswer();await pc.setLocalDescription(answer);socket.emit("call:signal",{to:from,signal:{type:"description",description:pc.localDescription}});}
      for(const c of pendingIce)await pc.addIceCandidate(c);pendingIce=[];
    }else if(signal.type==="ice"){
      if(pc&&pc.remoteDescription)await pc.addIceCandidate(signal.candidate);else pendingIce.push(signal.candidate);
    }
  }catch(e){console.error(e);toast("Call setup error: "+e.message);}
}
$("muteBtn").onclick=()=>{if(!localStream)return;const t=localStream.getAudioTracks()[0];if(t){t.enabled=!t.enabled;$("muteBtn").textContent=t.enabled?"🎙 Mute":"🔇 Unmute";}};
$("cameraBtn").onclick=()=>{if(!localStream)return;const t=localStream.getVideoTracks()[0];if(t){t.enabled=!t.enabled;$("cameraBtn").textContent=t.enabled?"▣ Camera":"▣ Show camera";}};
$("shareBtn").onclick=async()=>{
  try{
    if(!pc)return;
    const screen=await navigator.mediaDevices.getDisplayMedia({video:true,audio:true});
    const track=screen.getVideoTracks()[0];const sender=pc.getSenders().find(s=>s.track&&s.track.kind==="video");
    if(sender)await sender.replaceTrack(track);else pc.addTrack(track,screen);
    $("localVideo").srcObject=screen;$("localVideo").classList.remove("hidden");
    track.onended=async()=>{const cam=localStream?.getVideoTracks()[0];const s=pc?.getSenders().find(x=>x.track&&x.track.kind==="video");if(s&&cam)await s.replaceTrack(cam);$("localVideo").srcObject=localStream;};
  }catch(e){toast("Screen sharing was cancelled or unavailable.");}
};
$("hangupBtn").onclick=()=>endCall(true);
function endCall(notify){
  if(notify&&currentCallPeer&&socket)socket.emit("call:end",{to:currentCallPeer});
  if(pc){pc.close();pc=null;}if(localStream){localStream.getTracks().forEach(t=>t.stop());localStream=null;}
  $("remoteVideo").srcObject=null;$("localVideo").srcObject=null;$("callModal").classList.add("hidden");$("callHint").classList.remove("hidden");$("localVideo").classList.remove("hidden");currentCallPeer=null;incomingOffer=null;pendingIce=[];
}
$("designForm").onsubmit=async e=>{
  e.preventDefault();try{
    const data=await api("/api/admin/settings",{method:"PATCH",body:JSON.stringify({
      appName:$("setAppName").value,tagline:$("setTagline").value,accent:$("setAccent").value,
      background:$("setBackground").value,panel:$("setPanel").value
    })});siteSettings=data.settings;applySiteSettings();$("designStatus").textContent="Saved! Your site appearance has been updated.";
  }catch(err){$("designStatus").textContent=err.message;}
};
$("saveFeatures").onclick=async()=>{
  try{const data=await api("/api/admin/settings",{method:"PATCH",body:JSON.stringify({
    showFriends:$("featureFriends").checked,showCalls:$("featureCalls").checked,
    showVideo:$("featureVideo").checked,showScreenShare:$("featureShare").checked
  })});siteSettings=data.settings;applySiteSettings();$("featureStatus").textContent="Feature settings saved.";}
  catch(err){$("featureStatus").textContent=err.message;}
};
$("saveCss").onclick=async()=>{
  try{await api("/api/admin/code",{method:"PATCH",body:JSON.stringify({css:$("customCss").value})});applySiteSettings($("customCss").value);$("codeStatus").textContent="Custom CSS saved.";}
  catch(err){$("codeStatus").textContent=err.message;}
};
$("clearCss").onclick=()=>{$("customCss").value="";$("saveCss").click();};
if(token)boot();else {$("auth").classList.remove("hidden");loadSiteSettings();}
