const $ = id => document.getElementById(id);
let token = localStorage.getItem("vm_token") || "";
if(token){$("bootSplash").classList.remove("hidden");$("auth").classList.add("hidden");}else{$("bootSplash").classList.add("hidden");$("auth").classList.remove("hidden");}
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
  catch { token="";localStorage.removeItem("vm_token");$("bootSplash").classList.add("hidden");$("auth").classList.remove("hidden");$("app").classList.add("hidden");return; }
  $("bootSplash").classList.add("hidden");$("auth").classList.add("hidden");$("app").classList.remove("hidden");
  $("studioNav").classList.toggle("hidden", me.role !== "admin");
  await loadSiteSettings(); await loadCurrencies();
  $("miniUser").textContent=me.displayName+"  @"+me.username;
  $("profileHeading").textContent=me.displayName;
  $("profileUsername").value=me.username;$("profileName").value=me.displayName;$("profileBio").value=me.bio||"";$("profileAvatarFile").value="";renderAvatar($("profileAvatar"),me);
  connectSocket(); await loadFriends(); await loadCustomNav(); showView("chats");
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
  
  $("shareBtn").classList.toggle("hidden",siteSettings.showScreenShare===false);
}
async function loadStudio(){
  if(me?.role!=="admin")return;
  try{
    const data=await api("/api/admin/settings");siteSettings=data.settings||{};
    $("setAppName").value=siteSettings.appName||"ViviMess";$("setTagline").value=siteSettings.tagline||"";
    $("setAccent").value=siteSettings.accent||"#28e0b2";$("setBackground").value=siteSettings.background||"#0b111a";$("setPanel").value=siteSettings.panel||"#182331";
    $("featureFriends").checked=siteSettings.showFriends!==false;$("featureCalls").checked=siteSettings.showCalls!==false;
    $("featureShare").checked=siteSettings.showScreenShare!==false;
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
  socket.on("friends:changed",()=>{loadFriends();loadPeople($("userSearch").value);});
  socket.on("friend-request:new",data=>{toast("Friend request from @"+data.from.username);loadFriendRequests();});
  socket.on("friend-request:changed",loadFriendRequests);
  socket.on("call:incoming",data=>{if(currentCallPeer){socket.emit("call:signal",{to:data.from,signal:{type:"busy"}});return;}if(confirm(data.username+" is calling. Accept?")){currentCallPeer=data.from;startCall(data.from,"audio",true);}else socket.emit("call:end",{to:data.from});});
  socket.on("call:signal",handleSignal);
  socket.on("call:ended",()=>endCall(false));
}
function showView(name){
  document.querySelectorAll(".view").forEach(v=>v.classList.add("hidden"));
  const builtin=$("view-"+name); if(builtin){builtin.classList.remove("hidden");}else{renderCustomPage(name);}
  document.querySelectorAll(".nav[data-view]").forEach(b=>b.classList.toggle("active",b.dataset.view===name));
  document.querySelectorAll("#customNav .nav").forEach(b=>b.classList.toggle("active",b.dataset.page===name));
  $("pageTitle").textContent={chats:"Messages",friends:"Friends",profile:"My profile",studio:"Creator Studio"}[name]||customPages.find(p=>p.slug===name)?.title||name;
  if(name==="friends"){loadPeople($("userSearch").value);loadFriendRequests();}
  if(name==="studio"){loadStudio();loadAdminPages();}
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
  const el=document.createElement("div");el.className="user-card";const av=document.createElement("div");av.className="avatar";renderAvatar(av,u);const info=document.createElement("div");info.className="person-info";info.innerHTML="<b></b><small></small>";info.querySelector("b").textContent=u.displayName;info.querySelector("small").textContent="@"+u.username;const btn=document.createElement("button");btn.className=isFriend?"soft":"primary";btn.textContent=isFriend?"Remove":u.requestSent?"Request sent":u.requestReceived?"Accept request":"＋ Add";btn.disabled=!!u.requestSent;btn.onclick=async()=>{try{if(isFriend){await api("/api/friends/"+u.id,{method:"DELETE"});toast("Friend removed");}else if(u.requestReceived){const rs=await api("/api/friend-requests");const r=rs.incoming.find(x=>x.from===u.id);if(r)await api("/api/friend-requests/"+r.id+"/accept",{method:"POST"});toast("Friend request accepted");}else{await api("/api/friends/"+u.id,{method:"POST"});toast("Request sent — waiting for acceptance");}await loadFriends();await loadPeople($("userSearch").value);await loadFriendRequests();}catch(e){toast(e.message);}};el.append(av,info,btn);return el;
}
async function loadFriendRequests(){try{const data=await api("/api/friend-requests");const host=$("friendRequests");if(!host)return;host.innerHTML="";if(!data.incoming.length&&!data.outgoing.length){host.innerHTML='<p class="muted">No pending friend requests.</p>';return;}data.incoming.forEach(r=>{const card=document.createElement("div");card.className="user-card";const info=document.createElement("div");info.className="person-info";info.innerHTML="<b></b><small>Wants to be your friend</small>";info.querySelector("b").textContent=r.user.displayName+" @"+r.user.username;const yes=document.createElement("button");yes.className="primary";yes.textContent="Accept";yes.onclick=async()=>{await api("/api/friend-requests/"+r.id+"/accept",{method:"POST"});await loadFriendRequests();await loadFriends();};const no=document.createElement("button");no.className="soft";no.textContent="Decline";no.onclick=async()=>{await api("/api/friend-requests/"+r.id,{method:"DELETE"});loadFriendRequests();};card.append(info,yes,no);host.append(card);});data.outgoing.forEach(r=>{const el=document.createElement("p");el.className="muted";el.textContent="Friend request sent — waiting for acceptance.";host.append(el);});}catch(e){console.warn(e);}}

async function loadPeople(q=""){
  try{const data=await api("/api/users?q="+encodeURIComponent(q));const host=$("searchResults");host.innerHTML="";if(!data.users.length){host.innerHTML='<p class="muted">No creators found.</p>';return;}data.users.forEach(u=>host.append(userCard(u,u.isFriend)));}catch(e){toast(e.message);}
}
let searchTimer; $("userSearch").oninput=()=>{clearTimeout(searchTimer);searchTimer=setTimeout(()=>loadPeople($("userSearch").value),250);};
async function selectFriend(user){activeFriend=user;renderFriends();$("emptyChat").classList.add("hidden");$("chatActive").classList.remove("hidden");const head=$("chatPerson");head.innerHTML="";const av=document.createElement("div");av.className="avatar";renderAvatar(av,user);const label=document.createElement("span");label.textContent=user.displayName+"  @"+user.username;head.append(av,label);await loadMessages(user.id);}
async function loadMessages(id){
  try{const data=await api("/api/messages/"+id);const host=$("messages");host.innerHTML="";data.messages.forEach(m=>appendMessage(m));host.scrollTop=host.scrollHeight;}catch(e){toast(e.message);}
}
function appendMessage(m){const host=$("messages");const el=document.createElement("div");el.className="bubble"+(m.from===me.id?" mine":"");if(m.text){const t=document.createElement("div");t.textContent=m.text;el.append(t);}if(m.media){if(m.media.type==="video"){const v=document.createElement("video");v.src=m.media.data;v.controls=true;v.playsInline=true;el.append(v);}else{const img=document.createElement("img");img.src=m.media.data;img.alt=m.media.name||"Shared image";el.append(img);}}const time=document.createElement("small");time.textContent=new Date(m.createdAt).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"});el.append(time);host.append(el);host.scrollTop=host.scrollHeight;}
async function sendMedia(file){if(!activeFriend||!file)return;try{if(file.size>7*1024*1024)throw new Error("Files must be smaller than 7 MB.");if(!file.type.startsWith("image/")&&!file.type.startsWith("video/"))throw new Error("Choose an image or video.");const data=await fileAsDataUrl(file);socket.emit("message:send",{to:activeFriend.id,text:"",media:{type:mediaType(file),name:file.name,data}});}catch(e){toast(e.message);}}
$("messageForm").onsubmit=e=>{e.preventDefault();const text=$("messageInput").value.trim();if(!text||!activeFriend)return;socket.emit("message:send",{to:activeFriend.id,text});$("messageInput").value="";};
$("attachBtn").onclick=()=>$("chatFile").click();$("chatFile").onchange=async()=>{await sendMedia($("chatFile").files[0]);$("chatFile").value="";};
$("gifBtn").onclick=async()=>{$("gifPanel").classList.toggle("hidden");await loadGifLibrary();};$("closeGif").onclick=()=>$("gifPanel").classList.add("hidden");
async function loadGifLibrary(){try{const data=await api("/api/gifs");const host=$("gifGrid");host.innerHTML="";if(!data.gifs.length){host.innerHTML='<p class="muted">Add your own GIF with the button above.</p>';return;}data.gifs.forEach(g=>{const img=document.createElement("img");img.src=g.data;img.onclick=()=>{if(activeFriend)socket.emit("message:send",{to:activeFriend.id,text:"",media:{type:"gif",name:"GIF",data:g.data}});$("gifPanel").classList.add("hidden");};host.append(img);});}catch(e){toast(e.message);}}
$("gifUpload").onchange=async()=>{try{const f=$("gifUpload").files[0];if(!f)return;if(f.type!=="image/gif"||f.size>7*1024*1024)throw new Error("Choose a GIF up to 7 MB.");const data=await fileAsDataUrl(f);await api("/api/gifs",{method:"POST",body:JSON.stringify({data})});await loadGifLibrary();toast("GIF added to your collection.");}catch(e){toast(e.message);}$("gifUpload").value="";};
let customPages=[],editingPage=null;
async function loadAdminPages(){try{const d=await api("/api/admin/pages");customPages=d.pages||[];renderAdminPages();}catch(e){}}
async function loadCustomNav(){try{const d=await api("/api/pages");customPages=d.pages||[];const nav=$("customNav");nav.innerHTML="";customPages.forEach(p=>{const b=document.createElement("button");b.className="nav";b.dataset.page=p.slug;b.innerHTML="✧ <span></span>";b.querySelector("span").textContent=p.title;b.onclick=()=>showView(p.slug);nav.append(b);});}catch(e){}}
function renderAdminPages(){const host=$("adminPagesList");if(!host)return;host.innerHTML="";customPages.forEach(p=>{const row=document.createElement("div");row.className="admin-page-row";const label=document.createElement("b");label.textContent=p.title;const edit=document.createElement("button");edit.className="soft";edit.textContent="Edit";edit.onclick=()=>openPageEditor(p);const del=document.createElement("button");del.className="danger";del.textContent="Delete";del.onclick=async()=>{if(confirm("Delete this tab?")){await api("/api/admin/pages/"+p.id,{method:"DELETE"});await loadAdminPages();await loadCustomNav();}};row.append(label,edit,del);host.append(row);});}
$("newPageForm").onsubmit=async e=>{e.preventDefault();try{const title=$("newPageTitle").value.trim();const d=await api("/api/admin/pages",{method:"POST",body:JSON.stringify({title})});$("newPageTitle").value="";await loadAdminPages();await loadCustomNav();openPageEditor(d.page);toast("New sidebar tab created.");}catch(err){toast(err.message);}};
function openPageEditor(page){editingPage=JSON.parse(JSON.stringify(page));$("pageEditor").classList.remove("hidden");$("editingPageTitle").textContent="Editing: "+page.title;$("editPageTitle").value=page.title;renderBuilderBlocks();}
$("closePageEditor").onclick=()=>$("pageEditor").classList.add("hidden");
document.querySelectorAll("[data-add-block]").forEach(b=>b.onclick=()=>{if(!editingPage)return;editingPage.elements.push({id:crypto.randomUUID(),type:b.dataset.addBlock,content:b.dataset.addBlock==="button"?"Click me":"New "+b.dataset.addBlock,label:"Button",action:"none",target:"",width:100,color:"#ffffff",radius:12});renderBuilderBlocks();});
function renderBuilderBlocks(){const host=$("builderBlocks");host.innerHTML="";(editingPage?.elements||[]).forEach((el,i)=>{const card=document.createElement("div");card.className="builder-block";card.draggable=true;card.dataset.index=i;const title=document.createElement("b");title.textContent=(i+1)+" · "+el.type;const content=document.createElement("textarea");content.value=el.content;content.placeholder="Text or media URL / uploaded media";content.oninput=()=>el.content=content.value;const controls=document.createElement("div");if(el.type==="image"||el.type==="video"){const upload=document.createElement("input");upload.type="file";upload.accept=el.type==="image"?"image/*":"video/*";upload.onchange=async()=>{try{const f=upload.files[0];if(!f)return;if(f.size>7*1024*1024)throw new Error("Media must be smaller than 7 MB.");el.content=await fileAsDataUrl(f);content.value=el.content;}catch(e){toast(e.message);}};card.append(upload);}controls.className="builder-controls";const width=document.createElement("input");width.type="number";width.min=20;width.max=100;width.value=el.width;width.title="Width %";width.onchange=()=>el.width=Number(width.value);const color=document.createElement("input");color.type="color";color.value=el.color;color.oninput=()=>el.color=color.value;const radius=document.createElement("input");radius.type="number";radius.min=0;radius.max=32;radius.value=el.radius;radius.title="Corner radius";radius.onchange=()=>el.radius=Number(radius.value);controls.append("Width %",width,"Color",color,"Radius",radius);if(el.type==="button"){const label=document.createElement("input");label.placeholder="Button label";label.value=el.label;label.oninput=()=>el.label=label.value;const action=document.createElement("select");[["none","No action"],["open-page","Open another tab"],["award-currency","Award currency (admin only)"]].forEach(([v,t])=>{const o=document.createElement("option");o.value=v;o.textContent=t;action.append(o);});action.value=el.action;action.onchange=()=>el.action=action.value;const target=document.createElement("input");target.placeholder=el.action==="award-currency"?"Currency ID":"Target tab slug";target.value=el.target;target.oninput=()=>el.target=target.value;const amount=document.createElement("input");amount.type="number";amount.min="0";amount.max="100000";amount.placeholder="Reward amount";amount.value=el.amount||0;amount.oninput=()=>el.amount=Number(amount.value);card.append(title,label,action,target,amount);}else card.append(title);card.append(content,controls);const remove=document.createElement("button");remove.className="danger";remove.textContent="Remove block";remove.onclick=()=>{editingPage.elements.splice(i,1);renderBuilderBlocks();};card.append(remove);card.ondragstart=e=>e.dataTransfer.setData("text/plain",String(i));card.ondragover=e=>e.preventDefault();card.ondrop=e=>{e.preventDefault();const from=Number(e.dataTransfer.getData("text/plain"));const [m]=editingPage.elements.splice(from,1);editingPage.elements.splice(i,0,m);renderBuilderBlocks();};host.append(card);});}
$("savePage").onclick=async()=>{try{editingPage.title=$("editPageTitle").value;await api("/api/admin/pages/"+editingPage.id,{method:"PUT",body:JSON.stringify({title:editingPage.title,elements:editingPage.elements})});await loadAdminPages();await loadCustomNav();$("pageStatus").textContent="Page saved.";toast("Page saved.");}catch(e){$("pageStatus").textContent=e.message;}};
function renderCustomPage(slug){const page=customPages.find(p=>p.slug===slug);if(!page)return;let view=document.getElementById("custom-view-"+slug);if(!view){view=document.createElement("section");view.id="custom-view-"+slug;view.className="view hidden";document.querySelector(".main").append(view);}view.innerHTML="";page.elements.forEach(el=>{const wrap=document.createElement("div");wrap.className="custom-element";wrap.style.width=el.width+"%";wrap.style.color=el.color;wrap.style.borderRadius=el.radius+"px";if(el.type==="image"){const img=document.createElement("img");img.src=el.content;wrap.append(img);}else if(el.type==="video"){const v=document.createElement("video");v.src=el.content;v.controls=true;wrap.append(v);}else if(el.type==="button"){const b=document.createElement("button");b.className="primary";b.textContent=el.label||el.content;b.onclick=()=>{if(el.action==="open-page")showView(el.target);else if(el.action==="award-currency"){api("/api/pages/"+slug+"/action",{method:"POST",body:JSON.stringify({elementId:el.id})}).then(r=>toast("You received "+r.amount+" "+r.currency+"! Balance: "+r.balance)).catch(e=>toast(e.message));}};wrap.append(b);}else{wrap.textContent=el.content;}view.append(wrap);});view.classList.remove("hidden");}
$("profileAvatarFile").onchange=async()=>{try{const file=$("profileAvatarFile").files[0];if(!file)return;if(!["image/png","image/jpeg","image/webp","image/gif"].includes(file.type))throw new Error("Choose a PNG, JPG, WEBP or GIF image.");if(file.size>7*1024*1024)throw new Error("Avatar must be smaller than 7 MB.");const preview=await fileAsDataUrl(file);renderAvatar($("profileAvatar"),{...me,avatar:preview});}catch(err){$("profileMessage").textContent=err.message;$("profileAvatarFile").value="";}};
$("profileForm").onsubmit=async e=>{e.preventDefault();try{const file=$("profileAvatarFile").files[0];const avatar=file?await fileAsDataUrl(file):me.avatar||"";const data=await api("/api/profile",{method:"PATCH",body:JSON.stringify({displayName:$("profileName").value,bio:$("profileBio").value,avatar})});me=data.user;$("profileHeading").textContent=me.displayName;$("profileUsername").value=me.username;renderAvatar($("profileAvatar"),me);$("miniUser").textContent=me.displayName+"  @"+me.username;$("profileAvatarFile").value="";$("profileMessage").textContent="Profile saved!";toast("Profile saved!");}catch(err){$("profileMessage").textContent=err.message;}};
function escapeHtml(s){return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}

$("audioCall").onclick=()=>{if(activeFriend)startCall(activeFriend.id,"audio",false);};
async function startCall(peer,mode,isAnswer){
  if(!peer)return;currentCallPeer=peer;callMode=mode;$("callModal").classList.remove("hidden");$("callTitle").textContent="Voice call";
  $("callHint").textContent=isAnswer?"Connecting…":"Calling…";
  try{
    localStream=await navigator.mediaDevices.getUserMedia({audio:true,video:false});
    pc=new RTCPeerConnection(ICE);pc.addTransceiver("video",{direction:"sendrecv"});localStream.getTracks().forEach(t=>pc.addTrack(t,localStream));
    pc.ontrack=e=>{$("remoteVideo").srcObject=e.streams[0];if(e.track.kind==="video"){e.track.onunmute=()=>$("remoteVideo").classList.add("screen-live");}if(e.track.kind==="audio")$("callHint").classList.add("hidden");};
    pc.onicecandidate=e=>{if(e.candidate)socket.emit("call:signal",{to:peer,signal:{type:"ice",candidate:e.candidate}});};
    pc.onconnectionstatechange=()=>{if(pc&&["failed","disconnected"].includes(pc.connectionState))$("callHint").textContent="Connection interrupted…";};
    if(isAnswer){
      if(incomingOffer){await pc.setRemoteDescription(incomingOffer);for(const c of pendingIce)await pc.addIceCandidate(c);pendingIce=[];}
      if(incomingOffer){const answer=await pc.createAnswer();await pc.setLocalDescription(answer);socket.emit("call:signal",{to:peer,signal:{type:"description",description:pc.localDescription}});incomingOffer=null;}
    }else{
      socket.emit("call:invite",{to:peer,mode});
      const offer=await pc.createOffer();await pc.setLocalDescription(offer);socket.emit("call:signal",{to:peer,signal:{type:"description",description:pc.localDescription}});
    }
  }catch(e){toast("Microphone error: "+e.message);endCall(false);}
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

$("shareBtn").onclick=async()=>{
  try{
    if(!pc)return;
    const screen=await navigator.mediaDevices.getDisplayMedia({video:true,audio:true});
    const track=screen.getVideoTracks()[0];const transceiver=pc.getTransceivers().find(t=>t.receiver.track.kind==="video");const sender=transceiver?.sender;
    if(sender)await sender.replaceTrack(track);else throw new Error("Screen sharing channel unavailable.");
    
    track.onended=async()=>{const t=pc?.getTransceivers().find(x=>x.receiver.track.kind==="video");if(t?.sender)await t.sender.replaceTrack(null);};
  }catch(e){toast("Screen sharing was cancelled or unavailable.");}
};
$("hangupBtn").onclick=()=>endCall(true);
function endCall(notify){
  if(notify&&currentCallPeer&&socket)socket.emit("call:end",{to:currentCallPeer});
  if(pc){pc.close();pc=null;}if(localStream){localStream.getTracks().forEach(t=>t.stop());localStream=null;}
  $("remoteVideo").srcObject=null;$("remoteVideo").classList.remove("screen-live");$("callModal").classList.add("hidden");$("callHint").classList.remove("hidden");currentCallPeer=null;incomingOffer=null;pendingIce=[];
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
    showScreenShare:$("featureShare").checked
  })});siteSettings=data.settings;applySiteSettings();$("featureStatus").textContent="Feature settings saved.";}
  catch(err){$("featureStatus").textContent=err.message;}
};
$("saveCss").onclick=async()=>{
  try{await api("/api/admin/code",{method:"PATCH",body:JSON.stringify({css:$("customCss").value})});applySiteSettings($("customCss").value);$("codeStatus").textContent="Custom CSS saved.";}
  catch(err){$("codeStatus").textContent=err.message;}
};
$("clearCss").onclick=()=>{$("customCss").value="";$("saveCss").click();};
if(token)boot();else {$("auth").classList.remove("hidden");loadSiteSettings();}
