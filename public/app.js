const $ = id => document.getElementById(id);
let token = localStorage.getItem("vm_token") || "";
if(token){$("bootSplash").classList.remove("hidden");$("auth").classList.add("hidden");}else{$("bootSplash").classList.add("hidden");$("auth").classList.remove("hidden");}
let me = null, socket = null, activeFriend = null, friends = [], authMode = "login", siteSettings = {}, marketItems = [], activeCustomCss = "";
let pc = null, localStream = null, currentCallPeer = null, incomingOffer = null, callMode = "audio", pendingIce = [], pendingIncomingCall = null;
const CALL_PREFS_KEY="vm_call_preferences";
let callPrefs=JSON.parse(localStorage.getItem(CALL_PREFS_KEY)||"{}");
const SOUND_PREFS_KEY="vm_sound_preferences";
let soundPrefs={calls:true,messages:true,...JSON.parse(localStorage.getItem(SOUND_PREFS_KEY)||"{}")};
let ringtoneTimer=null, ringtoneStep=0, screenStream=null, screenSender=null;
let soundContext=null;
function playUiTone(kind="message"){
  const enabled=kind==="message"?soundPrefs.messages:soundPrefs.calls;
  if(!enabled)return;
  try{
    const Ctx=window.AudioContext||window.webkitAudioContext;
    if(!Ctx)return;
    soundContext=soundContext||new Ctx();
    if(soundContext.state==="suspended")soundContext.resume().catch(()=>{});
    const now=soundContext.currentTime;
    const notes=kind==="ring"?[660,880]:kind==="outgoing"?[480]:[740];
    notes.forEach((freq,i)=>{
      const osc=soundContext.createOscillator(),gain=soundContext.createGain();
      osc.type="sine";osc.frequency.value=freq;
      const start=now+i*.14;
      gain.gain.setValueAtTime(.0001,start);
      gain.gain.exponentialRampToValueAtTime(kind==="ring"?.10:.055,start+.025);
      gain.gain.exponentialRampToValueAtTime(.0001,start+.19);
      osc.connect(gain);gain.connect(soundContext.destination);
      osc.start(start);osc.stop(start+.21);
    });
  }catch(e){console.debug("UI sound unavailable",e);}
}
function startRingtone(kind="ring"){
  stopRingtone();if(!soundPrefs.calls)return;
  playUiTone(kind);
  ringtoneTimer=setInterval(()=>playUiTone(kind),kind==="ring"?1250:1900);
}
function stopRingtone(){if(ringtoneTimer){clearInterval(ringtoneTimer);ringtoneTimer=null;}}
function saveSoundPrefs(){
  localStorage.setItem(SOUND_PREFS_KEY,JSON.stringify(soundPrefs));
  if($("soundCalls"))$("soundCalls").checked=soundPrefs.calls;
  if($("soundMessages"))$("soundMessages").checked=soundPrefs.messages;
}
function makeIceConfig(){const iceServers=[{urls:["stun:stun.l.google.com:19302","stun:stun1.l.google.com:19302","stun:stun.cloudflare.com:3478","stun:stun2.l.google.com:19302"]}];if(callPrefs.turnUrl){iceServers.push({urls:callPrefs.turnUrl.split(/[,\s]+/).filter(Boolean),username:callPrefs.turnUsername||"",credential:callPrefs.turnPassword||""});}return {iceServers,iceTransportPolicy:"all"};}

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
  $("studioNav").classList.toggle("hidden", !["admin","moderator"].includes(me.role));
  await loadSiteSettings(); await loadCurrencies(); await loadMarket(); loadCallPreferences(); refreshAudioDevices();
  $("miniUser").textContent=me.displayName+"  @"+me.username;
  $("profileHeading").textContent=me.displayName;
  $("profileUsername").value=me.username;$("profileName").value=me.displayName;$("profileBio").value=me.bio||"";$("profileAvatarFile").value="";$("profileBannerFile").value="";$("profileBannerColor").value=me.bannerColor||"#087c70";renderAvatar($("profileAvatar"),me);renderProfileBanner(me);
  if($("presenceStatus"))$("presenceStatus").value=me.status||"Online";connectSocket(); await loadFriends(); await loadCustomNav(); applySiteSettings(); showView("chats");
}
async function loadSiteSettings(){
  try{
    const data=await api("/api/settings");siteSettings=data.settings||{};
    applySiteSettings(data.customCss||"");
    applyCustomJavaScript(data.customJs||"");
  }catch(e){console.warn("Settings unavailable",e);}
}
function applyCustomJavaScript(code=""){
  const old=document.getElementById("vmCustomJsSandbox");if(old)old.remove();
  if(!code.trim())return;
  const frame=document.createElement("iframe");frame.id="vmCustomJsSandbox";frame.hidden=true;frame.setAttribute("sandbox","allow-scripts");
  const safeCode=code.replace(/<\/script/gi,"<\\/script");
  frame.srcdoc=`<!doctype html><meta charset="utf-8"><script>
    const send=(type,payload={})=>parent.postMessage({type,...payload},'*');
    const vm={
      toast:(text)=>send('vm-custom-toast',{text:String(text).slice(0,300)}),
      log:(text)=>send('vm-custom-log',{text:String(text).slice(0,500)}),
      setTheme:(theme)=>send('vm-custom-theme',{theme}),
      setRobloxTheme:(theme)=>send('vm-custom-roblox-theme',{theme}),
      onMessage:(callback)=>{ if(typeof callback==='function') addEventListener('message',e=>{if(e.data&&e.data.type==='vm-custom-event')try{callback(e.data.detail)}catch(err){send('vm-custom-error',{text:String(err)})}}); },
      version:'5.3'
    };
    try{${safeCode}}catch(e){send('vm-custom-error',{text:String(e).slice(0,300)})}
  <\/script>`;
  document.body.append(frame);
}
window.addEventListener("message",e=>{
  if(e.source!==document.getElementById("vmCustomJsSandbox")?.contentWindow)return;
  const d=e.data||{};
  if(d.type==="vm-custom-toast")toast(d.text);
  if(d.type==="vm-custom-log")console.info("ViviMess custom JS:",d.text);
  if(d.type==="vm-custom-error")console.warn("Custom JS:",d.text);
  if(d.type==="vm-custom-theme"&&d.theme&&typeof d.theme==="object"){
    const root=document.documentElement;for(const [key,cssVar] of [["accent","--mint"],["background","--bg"],["panel","--panel"]])if(typeof d.theme[key]==="string"&&/^#[0-9a-f]{6}$/i.test(d.theme[key]))root.style.setProperty(cssVar,d.theme[key]);
  }
  if(d.type==="vm-custom-roblox-theme"&&d.theme&&typeof d.theme==="object"){
    const root=document.documentElement;for(const [key,cssVar] of [["background","--roblox-bg"],["border","--roblox-border"],["button","--roblox-button"],["artwork","--roblox-art"]])if(typeof d.theme[key]==="string"&&/^#[0-9a-f]{6}$/i.test(d.theme[key]))root.style.setProperty(cssVar,d.theme[key]);
  }
});
function applySiteSettings(customCss=null){
  if(customCss!==null) activeCustomCss=String(customCss);
  const root=document.documentElement;
  if(siteSettings.accent)root.style.setProperty("--mint",siteSettings.accent);
  if(siteSettings.background)root.style.setProperty("--bg",siteSettings.background);
  if(siteSettings.panel)root.style.setProperty("--panel",siteSettings.panel);
  document.title=(siteSettings.appName||"ViviMess")+" — Creator Community";
  const name=document.querySelector(".logo b");if(name)name.textContent=siteSettings.appName||"ViviMess";document.querySelectorAll(".auth-card h1").forEach(x=>x.textContent=siteSettings.appName||"ViviMess");if(siteSettings.logo){document.querySelectorAll(".logo img,.auth-hat").forEach(x=>x.src=siteSettings.logo);}
  const tagline=document.querySelector(".auth-card .muted");if(tagline)tagline.textContent=siteSettings.tagline||"Messages, calls and screen sharing — all in one place.";
  const style=document.getElementById("userCustomCss")||document.head.appendChild(Object.assign(document.createElement("style"),{id:"userCustomCss"}));
  const robloxCss = siteSettings.robloxTheme===false ? `.game-invite{}` : `
    :root{--roblox-bg:${siteSettings.robloxBg||"#142b42"};--roblox-border:${siteSettings.robloxBorder||"#00e6a8"};--roblox-button:${siteSettings.robloxButton||"#20c7a5"};--roblox-art:${siteSettings.robloxArt||"#1a3654"}}
    .game-invite{background:linear-gradient(145deg,var(--roblox-bg),color-mix(in srgb,var(--roblox-bg),#315b7e 35%))!important;border:2px solid var(--roblox-border)!important;box-shadow:0 8px 28px color-mix(in srgb,var(--roblox-border),transparent 82%)!important}
    .game-play-button{background:linear-gradient(135deg,var(--roblox-button),#1767e8)!important;border-radius:15px!important;box-shadow:0 5px 0 color-mix(in srgb,var(--roblox-button),#000 38%)!important}
    .game-invite-art{background:linear-gradient(135deg,var(--roblox-art),color-mix(in srgb,var(--roblox-art),#315b7e 45%))!important}
    .game-invite-meta b{letter-spacing:-.02em}
  `;
  style.textContent=activeCustomCss+robloxCss;
  const hiddenTabs = new Set(Array.isArray(siteSettings.hiddenNavItems) ? siteSettings.hiddenNavItems : []);
  document.querySelectorAll(".sidebar .nav[data-view]").forEach(el=>{
    const id=el.dataset.view;
    const roleRestricted=id==="studio" && !["admin","moderator"].includes(me?.role);
    const featureRestricted=id==="friends" && siteSettings.showFriends===false;
    el.classList.toggle("hidden", hiddenTabs.has(id) || roleRestricted || featureRestricted);
  });
  document.querySelectorAll("#customNav .nav[data-page]").forEach(el=>el.classList.toggle("hidden", hiddenTabs.has("page:" + el.dataset.page)));
  $("audioCall").classList.toggle("hidden",siteSettings.showCalls===false);
  
  $("shareBtn").classList.toggle("hidden",siteSettings.showScreenShare===false);
}
async function loadStudio(){
  if(me?.role==="moderator"){ document.querySelectorAll(".studio-panel").forEach((el,i)=>el.classList.toggle("hidden", i!==3)); loadAdminModeration(); return; }
  if(me?.role!=="admin")return;
  try{
    const data=await api("/api/admin/settings");siteSettings=data.settings||{};
    $("setAppName").value=siteSettings.appName||"ViviMess";$("setTagline").value=siteSettings.tagline||"";
    $("setAccent").value=siteSettings.accent||"#28e0b2";$("setBackground").value=siteSettings.background||"#0b111a";$("setPanel").value=siteSettings.panel||"#182331";
    $("featureFriends").checked=siteSettings.showFriends!==false;$("featureCalls").checked=siteSettings.showCalls!==false;
    $("featureShare").checked=siteSettings.showScreenShare!==false;
    $("customCss").value=data.customCss||"";
    $("customJs").value=data.customJs||"";
    $("robloxTheme").checked=siteSettings.robloxTheme!==false;
    $("robloxBg").value=siteSettings.robloxBg||"#142b42";$("robloxBorder").value=siteSettings.robloxBorder||"#00e6a8";$("robloxButton").value=siteSettings.robloxButton||"#20c7a5";$("robloxArt").value=siteSettings.robloxArt||"#1a3654";
    if($("brandName"))$("brandName").value=siteSettings.appName||"ViviMess";
    renderNavVisibilitySettings();const stats=await api("/api/admin/overview");$("statUsers").textContent=stats.users;$("statMessages").textContent=stats.messages;$("statFriends").textContent=stats.friends;
    await loadCurrencies();
    await loadAdminModeration();
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
      if(c.id!=="default"){const del=document.createElement("button");del.className="danger";del.textContent="Delete";del.onclick=async()=>{if(confirm(`Delete currency “${c.name}” and remove all user balances in it?`)){try{await api("/api/admin/currencies/"+c.id,{method:"DELETE"});await loadCurrencies();toast("Currency deleted.");}catch(e){toast(e.message);}}};row.append(del);}
      list.append(row);
    });}
    const select=$("balanceCurrency");
    if(select){select.innerHTML="";currencies.forEach(c=>{const o=document.createElement("option");o.value=c.id;o.textContent=c.name;select.append(o);});}
  }catch(e){if(e.message!=="Please sign in again.")console.warn(e);}
}
async function loadMarket(){
 try{
  const data=await api('/api/market');const items=data.items||[],quests=data.quests||[],currencies=data.currencies||[];marketItems=items;if(me&&$('profileBanner'))renderProfileBanner(me);
  for(const [id,type,prop] of [['profileEquippedFrame','frame','equippedFrame'],['profileEquippedBanner','banner','equippedBanner']]){const sel=$(id);if(sel){sel.innerHTML=type==='frame'?'<option value="">None</option>':'<option value="">Use uploaded banner</option>';items.filter(x=>x.type===type&&x.owned).forEach(x=>{const o=document.createElement('option');o.value=x.id;o.textContent=x.name;sel.append(o);});sel.value=me?.[prop]||'';}}
  const shop=$('shopItems');if(shop){shop.innerHTML='';if(!items.length)shop.innerHTML='<p class="muted">The shop is empty for now.</p>';items.forEach(it=>{const card=document.createElement('article');card.className='market-card';const media=it.mediaType==='video'?`<video src="${it.media}" autoplay muted loop playsinline></video>`:`<img src="${it.media}" alt="">`;const cur=currencies.find(c=>c.id===it.currencyId);card.innerHTML=`<div class="market-media">${media}</div><div class="market-card-body"><b>${escapeHtml(it.name)}</b><p class="muted">${escapeHtml(it.description||'')}</p><div class="market-price">${it.price} ${escapeHtml(cur?.name||'currency')}</div><button class="primary" ${it.owned?'disabled':''}>${it.owned?'Owned':'Buy'}</button>${it.owned?`<button class="soft equip-market">${it.equipped?'Unequip':'Equip'}</button>`:''}</div>`;card.querySelector('.primary').onclick=async()=>{try{await api('/api/shop/'+it.id+'/buy',{method:'POST'});await loadCurrencies();await loadMarket();toast('Purchased '+it.name+'!');}catch(e){toast(e.message);}};const equip=card.querySelector('.equip-market');if(equip)equip.onclick=async()=>{try{const r=await api('/api/shop/equip',{method:'POST',body:JSON.stringify({itemId:it.id})});me=r.user;await loadMarket();toast('Profile appearance updated.');}catch(e){toast(e.message);}};shop.append(card);});}
  const qhost=$('questItems');if(qhost){qhost.innerHTML='';if(!quests.length)qhost.innerHTML='<p class="muted">No quests available.</p>';quests.forEach(q=>{const card=document.createElement('article');card.className='quest-card';const status=q.submissionStatus||'';const cover=q.image?`<img class="quest-cover" src="${q.image}" alt="">`:'';let action='';if(status==='claimed')action='<button class="soft" disabled>Reward claimed</button>';else if(status==='approved')action='<button class="primary claim-quest">Claim reward</button>';else if(status==='pending')action=q.link?'<button class="primary do-quest">Открыть задание снова</button>':'<span class="muted">Заявка отправлена на проверку</span>'; else if(q.link)action='<button class="primary do-quest">Выполнить задание</button>';card.innerHTML=`${cover}<div class="quest-copy"><b>${escapeHtml(q.title)}</b><p>${escapeHtml(q.description||'')}</p><small>Reward: ${q.reward} ${escapeHtml(currencies.find(c=>c.id===q.currencyId)?.name||'currency')}</small><div class="quest-action">${action}</div></div>`;const go=card.querySelector('.do-quest');if(go)go.onclick=async()=>{try{if(q.link){const opened=window.open(q.link,'_blank','noopener,noreferrer');if(!opened)toast('Разреши всплывающие окна, чтобы открыть задание.');}await api('/api/quests/'+q.id+'/submit',{method:'POST'});await loadMarket();toast('Заявка отправлена администратору на проверку.');}catch(e){toast(e.message);}};const claim=card.querySelector('.claim-quest');if(claim)claim.onclick=async()=>{try{await api('/api/quests/'+q.id+'/claim',{method:'POST'});await loadCurrencies();await loadMarket();toast('Награда получена!');}catch(e){toast(e.message);}};qhost.append(card);});}
  if(me?.role==='admin'){
   for(const id of ['shopItemCurrency','questCurrency']){const sel=$(id);if(sel){sel.innerHTML='';currencies.forEach(c=>{const o=document.createElement('option');o.value=c.id;o.textContent=c.name;sel.append(o);});}}
   const si=$('adminShopItems');if(si){si.innerHTML='';items.forEach(it=>{const row=document.createElement('div');row.className='admin-row';row.innerHTML=`<span>${escapeHtml(it.name)} · ${it.price}</span><button class="danger">Delete</button>`;row.querySelector('button').onclick=async()=>{if(confirm('Delete this shop item?')){await api('/api/admin/shop/'+it.id,{method:'DELETE'});loadMarket();}};si.append(row);});}
   const aq=$('adminQuests');if(aq){aq.innerHTML='';quests.forEach(q=>{const row=document.createElement('div');row.className='admin-row';row.innerHTML=`<span>${escapeHtml(q.title)} · ${q.reward}</span><button class="danger">Delete</button>`;row.querySelector('button').onclick=async()=>{if(confirm('Delete this quest?')){await api('/api/admin/quests/'+q.id,{method:'DELETE'});loadMarket();}};aq.append(row);});}
   const review=$('adminQuestSubmissions');if(review){review.innerHTML='';try{const pending=await api('/api/admin/quest-submissions');if(!pending.submissions.length)review.innerHTML='<p class="muted">No submitted quests waiting for review.</p>';pending.submissions.forEach(sub=>{const row=document.createElement('div');row.className='admin-row';const label=document.createElement('span');label.textContent=`${sub.displayName||sub.username} (@${sub.username}) — ${sub.questTitle}`;const approve=document.createElement('button');approve.className='primary';approve.textContent='Approve';approve.onclick=async()=>{try{await api(`/api/admin/quests/${sub.questId}/review/${sub.userId}`,{method:'POST'});await loadMarket();toast('Quest approved. Claim reward is now available.');}catch(e){toast(e.message);}};row.append(label,approve);review.append(row);});}catch(e){review.textContent=e.message;}try{const all=await api('/api/admin/quest-candidates');const box=document.createElement('div');box.className='manual-quest-review';const h=document.createElement('h4');h.textContent='Manual approval (including users who did not press the task button)';box.append(h);all.candidates.forEach(c=>{if(c.status==='claimed'||c.status==='approved')return;const row=document.createElement('div');row.className='admin-row';const label=document.createElement('span');label.textContent=`${c.username} — ${c.questTitle} · ${c.status==='pending'?'Submitted':'Not submitted'}`;const approve=document.createElement('button');approve.className='soft';approve.textContent='Approve manually';approve.onclick=async()=>{try{await api(`/api/admin/quests/${c.questId}/manual-review/${c.userId}`,{method:'POST'});await loadMarket();toast('Approved. Claim reward is now available.');}catch(err){toast(err.message);}};row.append(label,approve);box.append(row);});review.append(box);}catch(e){console.warn(e);}}
  }
 }catch(e){if(e.message!=='Please sign in again.')console.warn('Market:',e.message);}
}
const shopForm=$('shopItemForm');if(shopForm)shopForm.onsubmit=async e=>{e.preventDefault();try{const file=$('shopItemMedia').files[0],media=await fileAsDataUrl(file);await api('/api/admin/shop',{method:'POST',body:JSON.stringify({name:$('shopItemName').value,description:$('shopItemDesc').value,price:Number($('shopItemPrice').value),currencyId:$('shopItemCurrency').value,type:$('shopItemType').value,media})});shopForm.reset();$('marketAdminStatus').textContent='Shop item added.';await loadMarket();}catch(err){$('marketAdminStatus').textContent=err.message;}};
const questForm=$('questForm');if(questForm)questForm.onsubmit=async e=>{e.preventDefault();try{const file=$('questImage').files[0],image=file?await fileAsDataUrl(file):'';await api('/api/admin/quests',{method:'POST',body:JSON.stringify({title:$('questTitle').value,description:$('questDesc').value,reward:Number($('questReward').value),currencyId:$('questCurrency').value,image,link:$('questLink').value.trim()})});questForm.reset();$('marketAdminStatus').textContent='Quest added.';await loadMarket();}catch(err){$('marketAdminStatus').textContent=err.message;}};
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
if(balanceForm)balanceForm.onsubmit=async e=>{e.preventDefault();try{await api("/api/admin/balance",{method:"POST",body:JSON.stringify({username:$("balanceUsername").value,currencyId:$("balanceCurrency").value,amount:Number($("balanceAmount").value)*($("balanceAction").value==="take"?-1:1)})});$("accountAdminStatus").textContent="Balance updated.";await loadCurrencies();}catch(err){$("accountAdminStatus").textContent=err.message;}};

// Presence status and group chat tools
if($("presenceStatus")){ $("presenceStatus").onchange=async()=>{try{const r=await api("/api/profile",{method:"PATCH",body:JSON.stringify({status:$("presenceStatus").value})});me=r.user;toast("Status updated");}catch(e){toast(e.message);}}; }
let activeGroup=null;
async function loadGroups(){try{const d=await api("/api/groups"),host=$("groupList");host.innerHTML="";if(!d.groups.length){host.innerHTML='<div class="groups-empty"><b>У тебя пока нет групп</b><p>Создай группу и пригласи друзей в общий чат.</p></div>';return;}d.groups.forEach(g=>{const b=document.createElement("button");b.type="button";b.className="group-list-card";const avatar=document.createElement("span");avatar.className="group-list-avatar";avatar.textContent=(g.name||"G").trim().slice(0,1).toUpperCase();const info=document.createElement("span");info.className="group-list-info";const title=document.createElement("b");title.textContent=g.name;const sub=document.createElement("small");sub.textContent=`${g.members.length} участников · ${(g.messages||[]).length} сообщений`;info.append(title,sub);const arrow=document.createElement("span");arrow.textContent="›";arrow.className="group-list-arrow";b.append(avatar,info,arrow);b.onclick=()=>openGroup(g);host.append(b);});}catch(e){toast(e.message);}}
function showGroupCreate(show){$("groupCreatePanel").classList.toggle("hidden",!show);$("groupList").classList.toggle("hidden",show);if(show){$("groupNameInput").value="";$("groupCreateStatus").textContent="";const host=$("groupMemberChoices");host.innerHTML="";if(!friends.length){host.innerHTML='<p class="muted">Сначала добавь друзей.</p>';return;}friends.forEach(u=>{const label=document.createElement("label");label.className="group-member-choice";const cb=document.createElement("input");cb.type="checkbox";cb.value=u.id;const avatar=document.createElement("span");avatar.className="group-member-avatar";avatar.textContent=(u.displayName||u.username||"?").slice(0,1).toUpperCase();const name=document.createElement("span");name.textContent=`${u.displayName||u.username} (@${u.username})`;label.append(cb,avatar,name);host.append(label);});$("groupNameInput").focus();}}
function openGroup(g){activeGroup=g;$("groupCreatePanel").classList.add("hidden");$("groupList").classList.add("hidden");$("groupChat").classList.remove("hidden");$("groupTitle").textContent=g.name;$("groupSubtitle").textContent=`${g.members.length} участников`;renderGroupMessages(g.messages||[]);}
function renderGroupMessages(ms){const h=$("groupMessages");h.innerHTML="";(ms||[]).forEach(m=>{const d=document.createElement("div");d.className="message-bubble";const sender=m.from===me.id?"Вы":(friends.find(u=>u.id===m.from)?.displayName||friends.find(u=>u.id===m.from)?.username||"Участник");d.textContent=sender+": "+m.text;h.append(d);});h.scrollTop=h.scrollHeight;}
if($("createGroup"))$("createGroup").onclick=()=>showGroupCreate(true);
if($("cancelGroupCreate"))$("cancelGroupCreate").onclick=()=>showGroupCreate(false);
if($("backToGroups"))$("backToGroups").onclick=()=>{$("groupChat").classList.add("hidden");$("groupList").classList.remove("hidden");activeGroup=null;};
if($("confirmCreateGroup"))$("confirmCreateGroup").onclick=async()=>{const name=$("groupNameInput").value.trim(),ids=[...$("groupMemberChoices").querySelectorAll('input[type="checkbox"]:checked')].map(x=>x.value);if(!name){$("groupCreateStatus").textContent="Введи название группы.";return;}if(!ids.length){$("groupCreateStatus").textContent="Выбери хотя бы одного участника.";return;}try{const r=await api("/api/groups",{method:"POST",body:JSON.stringify({name,members:ids})});await loadGroups();openGroup(r.group);toast("Группа создана!");}catch(e){$("groupCreateStatus").textContent=e.message;}};

if($("groupMessageForm"))$("groupMessageForm").onsubmit=async e=>{e.preventDefault();if(!activeGroup)return;try{const text=$("groupMessageInput").value.trim();if(!text)return;await api("/api/groups/"+activeGroup.id+"/messages",{method:"POST",body:JSON.stringify({text})});const d=await api("/api/groups");activeGroup=d.groups.find(x=>x.id===activeGroup.id)||activeGroup;renderGroupMessages(activeGroup.messages);$("groupMessageInput").value="";}catch(e){toast(e.message);}};
// Simple Paint: mouse/touch drawing, brush, background, eraser, undo and send.
(function(){
 const modal=$("paintModal"),canvas=$("paintCanvas");if(!modal||!canvas)return;
 const ctx=canvas.getContext("2d",{alpha:false});let drawing=false,erase=false,undoStack=[];
 const bg=()=>$("paintBackground")?.value||"#ffffff";
 const presetImages=new Map();
 function fill(){
   ctx.save();ctx.globalCompositeOperation="source-over";
   const preset=$("paintPreset")?.value||"solid";
   if(preset!=="solid"){
     let img=presetImages.get(preset);
     if(!img){img=new Image();img.src="/assets/paint-backgrounds/"+preset;presetImages.set(preset,img);img.onload=()=>{ctx.save();ctx.globalCompositeOperation="source-over";ctx.drawImage(img,0,0,canvas.width,canvas.height);ctx.restore();};}
     ctx.fillStyle="#fff";ctx.fillRect(0,0,canvas.width,canvas.height);
     if(img.complete&&img.naturalWidth)ctx.drawImage(img,0,0,canvas.width,canvas.height);
   }else{ctx.fillStyle=bg();ctx.fillRect(0,0,canvas.width,canvas.height);}
   ctx.restore();
 }
 fill();
 function save(){try{undoStack.push(ctx.getImageData(0,0,canvas.width,canvas.height));if(undoStack.length>20)undoStack.shift();}catch(e){}}
 function pt(e){const r=canvas.getBoundingClientRect();const sx=canvas.width/Math.max(1,r.width),sy=canvas.height/Math.max(1,r.height);return{x:Math.max(0,Math.min(canvas.width,(e.clientX-r.left)*sx)),y:Math.max(0,Math.min(canvas.height,(e.clientY-r.top)*sy))};}
 canvas.addEventListener("pointerdown",e=>{e.preventDefault();drawing=true;save();canvas.setPointerCapture(e.pointerId);const p=pt(e);ctx.beginPath();ctx.moveTo(p.x,p.y);ctx.lineTo(p.x+.1,p.y+.1);ctx.lineCap="round";ctx.lineJoin="round";ctx.lineWidth=Number($("paintSize").value)||5;ctx.strokeStyle=erase?bg():$("paintColor").value;ctx.stroke();});
 canvas.addEventListener("pointermove",e=>{if(!drawing)return;e.preventDefault();const p=pt(e);ctx.lineWidth=Number($("paintSize").value)||5;ctx.lineCap="round";ctx.lineJoin="round";ctx.strokeStyle=erase?bg():$("paintColor").value;ctx.lineTo(p.x,p.y);ctx.stroke();});
 const stop=()=>{drawing=false;ctx.closePath();};["pointerup","pointercancel","lostpointercapture"].forEach(n=>canvas.addEventListener(n,stop));
 document.querySelectorAll("[data-paint-color]").forEach(btn=>btn.addEventListener("click",()=>{erase=false;$("paintEraser").classList.remove("active");$("paintEraser").textContent="Ластик";$("paintColor").value=btn.dataset.paintColor;document.querySelectorAll("[data-paint-color]").forEach(x=>x.classList.toggle("active",x===btn));}));
 $("paintColor").addEventListener("input",()=>{document.querySelectorAll("[data-paint-color]").forEach(x=>x.classList.remove("active"));});
 document.querySelectorAll("[data-paint-color]").forEach(btn=>btn.addEventListener("click",()=>{erase=false;$("paintEraser").classList.remove("active");$("paintEraser").textContent="Ластик";$("paintColor").value=btn.dataset.paintColor;document.querySelectorAll("[data-paint-color]").forEach(x=>x.classList.toggle("active",x===btn));}));
 $("paintColor").addEventListener("input",()=>document.querySelectorAll("[data-paint-color]").forEach(x=>x.classList.remove("active")));
 $("paintOpen").onclick=()=>{modal.classList.remove("hidden");modal.setAttribute("aria-hidden","false");};
 $("paintClose").onclick=()=>{modal.classList.add("hidden");modal.setAttribute("aria-hidden","true");};
 $("paintEraser").onclick=()=>{erase=!erase;$("paintEraser").classList.toggle("active",erase);$("paintEraser").textContent=erase?"Кисть":"Ластик";};
 $("paintUndo").onclick=()=>{const v=undoStack.pop();if(v)ctx.putImageData(v,0,0);};
 $("paintBackground").oninput=()=>{save();$("paintPreset").value="solid";fill();};
 $("paintPreset").onchange=()=>{save();fill();};
 $("paintClear").onclick=()=>{save();fill();};
 $("paintSend").onclick=()=>{if(!activeFriend){toast("Сначала открой чат с другом.");return;}canvas.toBlob(async blob=>{try{if(!blob)throw new Error("Не удалось создать рисунок.");const data=await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=()=>reject(r.error);r.readAsDataURL(blob);});if(data.length>850000)throw new Error("Рисунок слишком большой.");socket.emit("message:send",{to:activeFriend.id,text:"",media:{type:"image",name:"vivimess-drawing.png",data}});modal.classList.add("hidden");modal.setAttribute("aria-hidden","true");toast("Рисунок отправлен!");}catch(e){toast(e.message);}},"image/png");};
})(); 
// Admin branding can be changed in Creator Studio and saved server-side.
if($("saveBrand"))$("saveBrand").onclick=async()=>{try{const file=$("brandLogo").files[0],logo=file?await fileAsDataUrl(file):siteSettings.logo||"";const r=await api("/api/admin/settings",{method:"PATCH",body:JSON.stringify({appName:$("brandName").value,logo})});siteSettings={...siteSettings,...r.settings};applySiteSettings();$("brandStatus").textContent="Saved for everyone.";}catch(e){$("brandStatus").textContent=e.message;}};

function connectSocket(){
  if(socket)socket.disconnect();
  socket=io({auth:{token}});
  socket.on("connect_error",()=>toast("Live connection unavailable. Refresh the page."));
  socket.on("message:new",m=>{if(m.from!==me?.id)playUiTone("message");if(activeFriend&&(m.from===activeFriend.id||m.to===activeFriend.id))loadMessages(activeFriend.id);});
  socket.on("friends:changed",()=>{loadFriends();loadPeople($("userSearch").value);});
  socket.on("group:message",data=>{if(activeGroup&&activeGroup.id===data.groupId){activeGroup.messages=activeGroup.messages||[];activeGroup.messages.push(data.message);renderGroupMessages(activeGroup.messages);}loadGroups();});
  socket.on("friend-request:new",data=>{toast("Friend request from @"+data.from.username);loadFriendRequests();});
  socket.on("friend-request:changed",loadFriendRequests);
  socket.on("call:incoming",data=>{
    if(currentCallPeer){socket.emit("call:signal",{to:data.from,signal:{type:"busy"}});return;}
    // Use an in-app dialog. Browser confirm() is unreliable when called from socket events
    // and may be suppressed, which used to auto-decline incoming calls.
    pendingIncomingCall=data;
    $("incomingCallTitle").textContent="Incoming voice call";
    $("incomingCallText").textContent="@"+(data.username||"Someone")+" is calling you.";
    $("incomingCallModal").classList.remove("hidden");
  });
  socket.on("call:signal",handleSignal);
  socket.on("call:ended",()=>endCall(false));
}
function showView(name){
  document.querySelectorAll(".view").forEach(v=>v.classList.add("hidden"));
  const builtin=$("view-"+name); if(builtin){builtin.classList.remove("hidden");}else{renderCustomPage(name);}
  document.querySelectorAll(".nav[data-view]").forEach(b=>b.classList.toggle("active",b.dataset.view===name));
  document.querySelectorAll("#customNav .nav").forEach(b=>b.classList.toggle("active",b.dataset.page===name));
  $("pageTitle").textContent={chats:"Messages",friends:"Friends",groups:"Groups",profile:"My profile",settings:"Settings",groups:"Groups",shop:"Shop",quests:"Quests",studio:"Creator Studio"}[name]||customPages.find(p=>p.slug===name)?.title||name;
  if(name==="groups"){loadGroups();}
  if(name==="friends"){loadPeople($("userSearch").value);loadFriendRequests();}
  if(name==="studio"){loadStudio();loadAdminPages();}
  if(name==="shop"||name==="quests")loadMarket();
}
document.querySelectorAll(".nav[data-view]").forEach(b=>b.onclick=()=>showView(b.dataset.view));
// Emergency access to Creator Studio if the owner hides its sidebar shortcut.
document.addEventListener("keydown",e=>{if(e.altKey&&e.shiftKey&&e.code==="KeyV"&&me?.role==="admin"){e.preventDefault();showView("studio");toast("Creator Studio opened (Alt+Shift+V).");}});
document.querySelectorAll("[data-goto]").forEach(b=>b.onclick=()=>showView(b.dataset.goto));
$("logout").onclick=()=>{if(socket)socket.disconnect();localStorage.removeItem("vm_token");location.reload();};

function renderProfileBanner(user){const host=$("profileBanner");if(!host)return;host.innerHTML="";host.style.backgroundImage="none";host.style.backgroundColor=user?.bannerColor||"#087c70";const equipped=marketItems.find(x=>x.id===user?.equippedBanner);const src=equipped?.media||user?.banner;if(!src)return;if(src.startsWith("data:video/")||/\.(mp4|webm)(\?|$)/i.test(src)){const v=document.createElement("video");v.src=src;v.autoplay=true;v.loop=true;v.muted=true;v.playsInline=true;host.append(v);}else{host.style.backgroundImage=`url("${src}")`;}}
function renderAvatar(el,user){
  el.innerHTML="";el.classList.toggle("has-profile-frame",!!user.equippedFrame);el.classList.add("avatar-framed");
  if(user.avatar){const img=document.createElement("img");img.className="avatar-photo";img.src=user.avatar;img.alt="";img.onerror=()=>{img.remove();const fallback=document.createElement("span");fallback.className="avatar-fallback";fallback.textContent=(user.displayName||user.username||"V")[0].toUpperCase();el.prepend(fallback);};el.append(img);}
  else {const fallback=document.createElement("span");fallback.className="avatar-fallback";fallback.textContent=(user.displayName||user.username||"V")[0].toUpperCase();el.append(fallback);}
  const frame=marketItems.find(x=>x.id===user.equippedFrame&&x.type==="frame");
  if(frame?.media){const art=document.createElement("img");art.className="avatar-frame-art";art.src=frame.media;art.alt="";art.draggable=false;el.append(art);}
}
async function loadFriends(){
  try{friends=(await api("/api/friends")).users;renderFriends();renderFriendsGrid();}catch(e){toast(e.message);}
}
function renderFriends(){
  const host=$("chatFriends");host.innerHTML="";
  if(!friends.length){host.innerHTML='<p class="muted">No friends yet. Add someone in Friends.</p>';return;}
  friends.forEach(u=>{const el=document.createElement("div");el.className="person-row"+(activeFriend?.id===u.id?" selected":"");const av=document.createElement("div");av.className="avatar";renderAvatar(av,u);const info=document.createElement("div");info.className="person-info";info.innerHTML=`<b></b><small>@${escapeHtml(u.username)} · ${escapeHtml(u.status||"Online")}</small>`;info.querySelector("b").textContent=u.displayName;el.append(av,info);el.onclick=()=>selectFriend(u);host.append(el);});
}
function renderFriendsGrid(){
  const host=$("friendsGrid");host.innerHTML="";
  if(!friends.length){host.innerHTML='<p class="muted">Your friend list is empty.</p>';return;}
  friends.forEach(u=>host.append(userCard(u,true)));
}
function userCard(u,isFriend){
  const el=document.createElement("div");el.className="user-card";const av=document.createElement("div");av.className="avatar";renderAvatar(av,u);const info=document.createElement("div");info.className="person-info";info.innerHTML="<b></b><small></small>";info.querySelector("b").textContent=u.displayName;info.querySelector("small").textContent="@"+u.username+" · "+(u.status||"Online");const btn=document.createElement("button");btn.className=isFriend?"soft":"primary";btn.textContent=isFriend?"Remove":u.requestSent?"Request sent":u.requestReceived?"Accept request":"＋ Add";btn.disabled=!!u.requestSent;btn.onclick=async()=>{try{if(isFriend){await api("/api/friends/"+u.id,{method:"DELETE"});toast("Friend removed");}else if(u.requestReceived){const rs=await api("/api/friend-requests");const r=rs.incoming.find(x=>x.from===u.id);if(r)await api("/api/friend-requests/"+r.id+"/accept",{method:"POST"});toast("Friend request accepted");}else{await api("/api/friends/"+u.id,{method:"POST"});toast("Request sent — waiting for acceptance");}await loadFriends();await loadPeople($("userSearch").value);await loadFriendRequests();}catch(e){toast(e.message);}};el.append(av,info,btn);return el;
}
async function loadFriendRequests(){try{const data=await api("/api/friend-requests");const host=$("friendRequests");if(!host)return;host.innerHTML="";if(!data.incoming.length&&!data.outgoing.length){host.innerHTML='<p class="muted">No pending friend requests.</p>';return;}data.incoming.forEach(r=>{const card=document.createElement("div");card.className="user-card";const info=document.createElement("div");info.className="person-info";info.innerHTML="<b></b><small>Wants to be your friend</small>";info.querySelector("b").textContent=r.user.displayName+" @"+r.user.username;const yes=document.createElement("button");yes.className="primary";yes.textContent="Accept";yes.onclick=async()=>{await api("/api/friend-requests/"+r.id+"/accept",{method:"POST"});await loadFriendRequests();await loadFriends();};const no=document.createElement("button");no.className="soft";no.textContent="Decline";no.onclick=async()=>{await api("/api/friend-requests/"+r.id,{method:"DELETE"});loadFriendRequests();};card.append(info,yes,no);host.append(card);});data.outgoing.forEach(r=>{const el=document.createElement("p");el.className="muted";el.textContent="Friend request sent — waiting for acceptance.";host.append(el);});}catch(e){console.warn(e);}}

async function loadPeople(q=""){
  try{const data=await api("/api/users?q="+encodeURIComponent(q));const host=$("searchResults");host.innerHTML="";if(!data.users.length){host.innerHTML='<p class="muted">No creators found.</p>';return;}data.users.forEach(u=>host.append(userCard(u,u.isFriend)));}catch(e){toast(e.message);}
}
let searchTimer; $("userSearch").oninput=()=>{clearTimeout(searchTimer);searchTimer=setTimeout(()=>loadPeople($("userSearch").value),250);};
async function selectFriend(user){activeFriend=user;renderFriends();$("emptyChat").classList.add("hidden");$("chatActive").classList.remove("hidden");const head=$("chatPerson");head.innerHTML="";const av=document.createElement("div");av.className="avatar";renderAvatar(av,user);const label=document.createElement("span");label.textContent=user.displayName+"  @"+user.username;head.append(av,label);await loadMessages(user.id);}
async function loadMessages(id){
  try{const data=await api("/api/messages/"+id);window.currentMessages=data.messages||[];renderMessages();}catch(e){toast(e.message);}
}
// Game invitations: only supported Roblox experience links get an automatic Play card.
function robloxGameUrl(text){
  const match=String(text||"").match(/https?:\/\/[^\s<>"']+/i);
  if(!match)return null;
  try{const u=new URL(match[0].replace(/[),.!?]+$/g,""));const host=u.hostname.toLowerCase();
    if(host!=="www.roblox.com"&&host!=="roblox.com")return null;
    if(!/^\/games\/\d+(?:\/|$)/.test(u.pathname))return null;
    return u.href;
  }catch{return null;}
}
function safeGameUrl(value){try{const u=new URL(String(value||"").trim());if(u.protocol!=="https:"&&u.protocol!=="http:")return null;if(u.username||u.password)return null;return u.href;}catch{return null;}}
function gameInviteCard(url,title="Roblox game"){
  const card=document.createElement("div");card.className="game-invite";
  const info=document.createElement("div");info.className="game-invite-info";
  const art=document.createElement("div");art.className="game-invite-art";
  const fallback=document.createElement("span");fallback.className="game-invite-cube";fallback.textContent="R";
  const brand=document.createElement("small");brand.textContent="ROBLOX";art.append(fallback,brand);
  const meta=document.createElement("div");meta.className="game-invite-meta";
  const heading=document.createElement("b");heading.textContent=title;
  const creator=document.createElement("small");creator.className="game-invite-creator";creator.textContent="Загрузка создателя…";
  const desc=document.createElement("small");desc.textContent="Загрузка информации об игре…";
  meta.append(heading,creator,desc);info.append(art,meta);
  const play=document.createElement("button");play.type="button";play.className="game-play-button";play.setAttribute("aria-label","Play Roblox game");play.textContent="▶";
  play.onclick=()=>{const link=safeGameUrl(url);if(link)window.open(link,"_blank","noopener,noreferrer");};
  card.append(info,play);
  // Load Roblox experience metadata through our same-origin server endpoint (avoids browser CORS).
  try{
    const parsed=new URL(url),parts=parsed.pathname.split("/").filter(Boolean),placeId=parts.find((x,i)=>/^games?$/i.test(x))?parts[parts.findIndex(x=>/^games?$/i.test(x))+1]:parts[0];
    if(placeId&&/^\d+$/.test(placeId)){
      fetch("/api/roblox/experience/"+encodeURIComponent(placeId))
        .then(async r=>{const data=await r.json().catch(()=>({}));if(!r.ok)throw new Error(data.error||"Roblox unavailable");return data;})
        .then(data=>{
          if(data.name)heading.textContent=data.name;
          if(data.creator)creator.textContent="by "+data.creator;
          desc.textContent=data.playing==null?"Roblox experience":"Playing now: "+data.playing.toLocaleString();
          if(data.thumbnail){const img=document.createElement("img");img.src=data.thumbnail;img.alt=data.name||"Roblox game cover";img.loading="lazy";img.referrerPolicy="no-referrer";img.onerror=()=>{img.remove();};art.replaceChildren(img);}
          else desc.textContent="Обложка пока недоступна";
        }).catch(()=>{heading.textContent="Roblox experience";creator.textContent="Не удалось загрузить данные игры";desc.textContent="Проверь ссылку или попробуй позже";});
    }
  }catch{}
  return card;
}
function messageMatches(m){const q=($("messageSearch")?.value||"").trim().toLowerCase();const f=$("messageFilter")?.value||"all";const media=m.media;let kind=!media?"text":(media.type==="video"?"video":(["image","gif"].includes(media.type)?"image":"file"));return (!q||String(m.text||"").toLowerCase().includes(q)||String(media?.name||"").toLowerCase().includes(q))&&(f==="all"||kind===f);}
function renderMessages(){const host=$("messages");if(!host)return;host.innerHTML="";const list=(window.currentMessages||[]).filter(messageMatches);if(!list.length){const empty=document.createElement("div");empty.className="message-search-empty";empty.textContent="No messages match this search.";host.append(empty);return;}list.forEach(m=>appendMessage(m,false));host.scrollTop=host.scrollHeight;}
function appendMessage(m,add=true){if(add){window.currentMessages=window.currentMessages||[];window.currentMessages.push(m);}const host=$("messages");if(!messageMatches(m))return;const el=document.createElement("div");el.className="bubble"+(m.from===me.id?" mine":"");const gameUrl=robloxGameUrl(m.text);if(gameUrl)el.classList.add("game-message");if(m.text&&!gameUrl){const t=document.createElement("div");t.textContent=m.text;el.append(t);}if(gameUrl)el.append(gameInviteCard(gameUrl));if(m.media){if(m.media.type==="video"){const v=document.createElement("video");v.src=m.media.data;v.controls=true;v.playsInline=true;el.append(v);}else if(["image","gif"].includes(m.media.type)){const img=document.createElement("img");img.src=m.media.data;img.alt=m.media.name||"Shared image";el.append(img);}else{const file=document.createElement("div");file.className="shared-file";file.innerHTML="<span>📦</span><div class=shared-file-info><b></b><small>Attachment · download to use</small></div><a class=soft download>Download</a>";file.querySelector("b").textContent=m.media.name||"Download file";file.querySelector("a").href=m.media.data;file.querySelector("a").download=m.media.name||"download";el.append(file);}}const time=document.createElement("small");time.textContent=new Date(m.createdAt).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"});el.append(time);host.append(el);host.scrollTop=host.scrollHeight;}
$("messageSearch").oninput=renderMessages;$("messageFilter").onchange=renderMessages;$("clearMessageSearch").onclick=()=>{$("messageSearch").value="";$ ("messageFilter").value="all";renderMessages();};

let pendingChatFiles=[];
function renderPendingFiles(){const host=$("pendingFiles");host.innerHTML="";if(!pendingChatFiles.length){host.classList.add("hidden");return;}host.classList.remove("hidden");pendingChatFiles.forEach((f,i)=>{const chip=document.createElement("span");chip.className="pending-file";chip.textContent=(f.type.startsWith("video/")?"🎬 ":f.type.startsWith("image/")?"🖼 ":"📦 ")+f.name;const remove=document.createElement("button");remove.type="button";remove.textContent="×";remove.title="Remove file";remove.onclick=()=>{pendingChatFiles.splice(i,1);renderPendingFiles();};chip.append(remove);host.append(chip);});}
$("messageForm").onsubmit=async e=>{e.preventDefault();if(!activeFriend)return;const text=$("messageInput").value.trim();if(!text&&!pendingChatFiles.length)return;const files=[...pendingChatFiles];if(!files.length){socket.emit("message:send",{to:activeFriend.id,text});}else{for(let i=0;i<files.length;i++){const file=files[i];try{if(file.size>8*1024*1024)throw new Error(file.name+" is over 8 MB.");const ext=file.name.split(".").pop().toLowerCase();const isMedia=file.type.startsWith("image/")||file.type.startsWith("video/");const isMod=["jar","zip","mrpack","rar","7z","schem","schematic","mcaddon","mcpack"].includes(ext);if(!isMedia&&!isMod)throw new Error("Unsupported file type: "+file.name);const data=await fileAsDataUrl(file);socket.emit("message:send",{to:activeFriend.id,text:i===0?text:"",media:{type:isMod?"file":mediaType(file),name:file.name,data}});}catch(err){toast(err.message);}}}$("messageInput").value="";pendingChatFiles=[];renderPendingFiles();};
$("attachBtn").onclick=()=>$("chatFile").click();$("chatFile").onchange=()=>{const selected=[...$("chatFile").files];const valid=selected.filter(f=>f.type.startsWith("image/")||f.type.startsWith("video/")||["jar","zip","mrpack","rar","7z","schem","schematic","mcaddon","mcpack"].includes(f.name.split(".").pop().toLowerCase()));if(valid.length!==selected.length)toast("Some file types are not supported.");if(pendingChatFiles.length+valid.length>10)toast("You can attach up to 10 files per message.");pendingChatFiles=[...pendingChatFiles,...valid].slice(0,10);renderPendingFiles();$("chatFile").value="";};
$("gifBtn").onclick=async()=>{$("gifPanel").classList.toggle("hidden");await loadGifLibrary();};$("closeGif").onclick=()=>$("gifPanel").classList.add("hidden");
async function loadGifLibrary(){try{const data=await api("/api/gifs");const host=$("gifGrid");host.innerHTML="";if(!data.gifs.length){host.innerHTML='<p class="muted">Add your own GIF with the button above.</p>';return;}data.gifs.forEach(g=>{const img=document.createElement("img");img.src=g.data;img.onclick=()=>{if(activeFriend)socket.emit("message:send",{to:activeFriend.id,text:"",media:{type:"gif",name:"GIF",data:g.data}});$("gifPanel").classList.add("hidden");};host.append(img);});}catch(e){toast(e.message);}}
$("gifUpload").onchange=async()=>{try{const f=$("gifUpload").files[0];if(!f)return;if(f.type!=="image/gif"||f.size>7*1024*1024)throw new Error("Choose a GIF up to 7 MB.");const data=await fileAsDataUrl(f);await api("/api/gifs",{method:"POST",body:JSON.stringify({data})});await loadGifLibrary();toast("GIF added to your collection.");}catch(e){toast(e.message);}$("gifUpload").value="";};
let customPages=[],editingPage=null;
async function loadAdminModeration(){
  try{
    const [u,c]=await Promise.all([api("/api/admin/users"),api("/api/admin/calls")]);
    const host=$("adminAccounts"); host.innerHTML="";
    u.users.forEach(user=>{const row=document.createElement("div");row.className="admin-user-row";const label=document.createElement("span");label.textContent=user.displayName+" @"+user.username+" · "+user.role;row.append(label);if(user.username!=="viva"){const del=document.createElement("button");del.className="danger";del.textContent="Delete";del.onclick=async()=>{if(confirm("Permanently delete @"+user.username+" and their messages?")){try{await api("/api/admin/users/"+user.id,{method:"DELETE"});await loadAdminModeration();toast("Account deleted.");}catch(e){toast(e.message);}}};row.append(del);}host.append(row);});
    const calls=$("adminCallHistory");calls.innerHTML="";if(!c.calls.length)calls.textContent="No calls recorded yet.";c.calls.forEach(x=>{const row=document.createElement("p");row.textContent="@"+x.fromUsername+" → @"+x.toUsername+" · "+new Date(x.startedAt).toLocaleString()+" · "+x.status;calls.append(row);});
  }catch(e){console.warn("Moderation tools:",e.message);}
}
$("loadModerationChat").onclick=async()=>{try{const a=$("moderationUserA").value.trim(),b=$("moderationUserB").value.trim();const data=await api("/api/admin/conversation?a="+encodeURIComponent(a)+"&b="+encodeURIComponent(b));const host=$("moderationMessages");host.innerHTML="";if(!data.messages.length){host.textContent="No messages found.";return;}data.messages.forEach(m=>{const row=document.createElement("div");row.className="moderation-message";const who=document.createElement("b");who.textContent="@"+m.fromUsername+" ";const body=document.createElement("span");body.textContent=m.text||("["+(m.media?.type||"media")+"]");const time=document.createElement("small");time.textContent=new Date(m.createdAt).toLocaleString();row.append(who,body,time);host.append(row);});}catch(e){toast(e.message);}};
$("lookupModerationUser").onclick=async()=>{try{const name=$("moderationLookup").value.trim();if(!name)throw new Error("Enter a username.");const d=await api("/api/moderation/user/"+encodeURIComponent(name));const host=$("moderationUserResult");host.innerHTML="";const head=document.createElement("p");head.textContent=d.user.displayName+" @"+d.user.username+" · "+d.user.role;host.append(head);const f=document.createElement("p");f.textContent="Friends ("+d.friends.length+"): "+(d.friends.map(x=>"@"+x.username).join(", ")||"none");host.append(f);const title=document.createElement("h5");title.textContent="Recent messages involving this user";host.append(title);d.recentMessages.forEach(m=>{const row=document.createElement("p");row.className="moderation-message";row.textContent="@"+m.fromUsername+" → @"+m.toUsername+": "+(m.text||"["+(m.media?.type||"media")+"]");host.append(row);});}catch(e){toast(e.message);}};
$("resetCommunity").onclick=async()=>{if(!confirm("This will delete all accounts except viva, all old messages, friends, call logs, GIFs and custom pages. A backup is created first. Continue?"))return;if(!confirm("Final confirmation: permanently reset the ViviMess community?"))return;try{const d=await api("/api/admin/reset-community",{method:"POST",body:"{}"});toast("Reset complete. Backup: "+d.backup);setTimeout(()=>location.reload(),1200);}catch(e){toast(e.message);}};

async function loadAdminPages(){try{const d=await api("/api/admin/pages");customPages=d.pages||[];renderAdminPages();renderNavVisibilitySettings();}catch(e){}}
const BUILTIN_NAV_TABS=[
  ["chats","Сообщения"],["friends","Друзья"],["groups","Группы"],["profile","Профиль"],["settings","Настройки"],["shop","Магазин"],["quests","Квесты"],["studio","Creator Studio"]
];
function renderNavVisibilitySettings(){
  const host=$("navVisibilityList");if(!host)return;host.innerHTML="";
  const hidden=new Set(Array.isArray(siteSettings.hiddenNavItems)?siteSettings.hiddenNavItems:[]);
  const rows=[...BUILTIN_NAV_TABS,...(customPages||[]).map(p=>["page:"+p.slug,p.title])];
  rows.forEach(([id,label])=>{const row=document.createElement("label");row.className="toggle-row nav-visibility-row";const text=document.createElement("span");text.textContent=label;const input=document.createElement("input");input.type="checkbox";input.checked=!hidden.has(id);input.dataset.navId=id;input.setAttribute("aria-label","Показывать: "+label);row.append(text,input);host.append(row);});
}
$("saveNavVisibility")?.addEventListener("click",async()=>{try{const hidden=[...document.querySelectorAll("#navVisibilityList input[data-nav-id]")].filter(x=>!x.checked).map(x=>x.dataset.navId);const r=await api("/api/admin/settings",{method:"PATCH",body:JSON.stringify({hiddenNavItems:hidden})});siteSettings={...siteSettings,...r.settings};applySiteSettings($("customCss")?.value||"");$("navVisibilityStatus").textContent="Видимость вкладок сохранена.";}catch(e){$("navVisibilityStatus").textContent=e.message;}});
async function loadCustomNav(){try{const d=await api("/api/pages");customPages=d.pages||[];const nav=$("customNav");nav.innerHTML="";const hidden=new Set(Array.isArray(siteSettings.hiddenNavItems)?siteSettings.hiddenNavItems:[]);customPages.forEach(p=>{const b=document.createElement("button");b.className="nav"+(hidden.has("page:"+p.slug)?" hidden":"");b.dataset.page=p.slug;b.innerHTML="✧ <span></span>";b.querySelector("span").textContent=p.title;b.onclick=()=>showView(p.slug);nav.append(b);});}catch(e){}}
function renderAdminPages(){const host=$("adminPagesList");if(!host)return;host.innerHTML="";customPages.forEach(p=>{const row=document.createElement("div");row.className="admin-page-row";const label=document.createElement("b");label.textContent=p.title;const edit=document.createElement("button");edit.className="soft";edit.textContent="Edit";edit.onclick=()=>openPageEditor(p);const del=document.createElement("button");del.className="danger";del.textContent="Delete";del.onclick=async()=>{if(confirm("Delete this tab?")){await api("/api/admin/pages/"+p.id,{method:"DELETE"});await loadAdminPages();await loadCustomNav();}};row.append(label,edit,del);host.append(row);});}
$("newPageForm").onsubmit=async e=>{e.preventDefault();try{const title=$("newPageTitle").value.trim();const d=await api("/api/admin/pages",{method:"POST",body:JSON.stringify({title})});$("newPageTitle").value="";await loadAdminPages();await loadCustomNav();openPageEditor(d.page);toast("New sidebar tab created.");}catch(err){toast(err.message);}};
function openPageEditor(page){editingPage=JSON.parse(JSON.stringify(page));$("pageEditor").classList.remove("hidden");$("editingPageTitle").textContent="Editing: "+page.title;$("editPageTitle").value=page.title;renderBuilderBlocks();}
$("closePageEditor").onclick=()=>$("pageEditor").classList.add("hidden");
document.querySelectorAll("[data-add-block]").forEach(b=>b.onclick=()=>{if(!editingPage)return;editingPage.elements.push({id:crypto.randomUUID(),type:b.dataset.addBlock,content:b.dataset.addBlock==="button"?"Click me":"New "+b.dataset.addBlock,label:"Button",action:"none",target:"",width:100,color:"#ffffff",radius:12});renderBuilderBlocks();});
function renderBuilderBlocks(){const host=$("builderBlocks");host.innerHTML="";(editingPage?.elements||[]).forEach((el,i)=>{const card=document.createElement("div");card.className="builder-block";card.draggable=true;card.dataset.index=i;const title=document.createElement("b");title.textContent=(i+1)+" · "+el.type;const content=document.createElement("textarea");content.value=el.content;content.placeholder="Text or media URL / uploaded media";content.oninput=()=>el.content=content.value;const controls=document.createElement("div");if(el.type==="image"||el.type==="video"){const upload=document.createElement("input");upload.type="file";upload.accept=el.type==="image"?"image/*":"video/*";upload.onchange=async()=>{try{const f=upload.files[0];if(!f)return;if(f.size>7*1024*1024)throw new Error("Media must be smaller than 7 MB.");el.content=await fileAsDataUrl(f);content.value=el.content;}catch(e){toast(e.message);}};card.append(upload);}controls.className="builder-controls";const width=document.createElement("input");width.type="number";width.min=20;width.max=100;width.value=el.width;width.title="Width %";width.onchange=()=>el.width=Number(width.value);const color=document.createElement("input");color.type="color";color.value=el.color;color.oninput=()=>el.color=color.value;const radius=document.createElement("input");radius.type="number";radius.min=0;radius.max=32;radius.value=el.radius;radius.title="Corner radius";radius.onchange=()=>el.radius=Number(radius.value);const rotation=document.createElement("input");rotation.type="number";rotation.min=-180;rotation.max=180;rotation.value=el.rotation||0;rotation.title="Rotation degrees";rotation.onchange=()=>el.rotation=Number(rotation.value);const height=document.createElement("input");height.type="number";height.min=20;height.max=1000;height.value=el.height||0;height.placeholder="Height px";height.onchange=()=>el.height=Number(height.value);const font=document.createElement("input");font.type="number";font.min=8;font.max=72;font.value=el.fontSize||16;font.title="Font size";font.onchange=()=>el.fontSize=Number(font.value);controls.append("Width %",width,"Height px",height,"Rotate °",rotation,"Text px",font,"Color",color,"Radius",radius);if(el.type==="button"){const label=document.createElement("input");label.placeholder="Button label";label.value=el.label;label.oninput=()=>el.label=label.value;const action=document.createElement("select");[["none","No action"],["open-page","Open another tab"],["award-currency","Give currency"],["code","Run my JavaScript code"],["game-link","🎮 Launch game (blue button)"]].forEach(([v,t])=>{const o=document.createElement("option");o.value=v;o.textContent=t;action.append(o);});action.value=el.action;action.onchange=()=>{el.action=action.value;renderBuilderBlocks();};const target=document.createElement("input");target.placeholder=el.action==="award-currency"?"Currency ID":"Target tab slug";target.value=el.target;target.oninput=()=>el.target=target.value;const amount=document.createElement("input");amount.type="number";amount.min="0";amount.max="100000";amount.placeholder="Reward amount";amount.value=el.amount||0;amount.oninput=()=>el.amount=Number(amount.value);card.append(title,label,action);if(el.action==="game-link"){const game=document.createElement("input");game.type="url";game.placeholder="https://www.roblox.com/games/123456/...";game.value=el.target||"";game.oninput=()=>el.target=game.value;card.append(game);}if(el.action==="award-currency")card.append(target,amount);if(el.action==="code"){const code=document.createElement("textarea");code.rows=8;code.placeholder='// Available: vm.toast("Hello"); vm.navigate("tab-slug"); vm.giveCurrency("CURRENCY_ID", 10);';code.value=el.code||"";code.oninput=()=>el.code=code.value;const hint=document.createElement("small");hint.textContent="Code runs in an isolated sandbox. Available: vm.toast(text), vm.navigate(slug), vm.giveCurrency(currencyId, amount). No direct access to passwords, tokens, or page storage.";const testCode=document.createElement("button");testCode.type="button";testCode.className="soft";testCode.textContent="▶ Test code";testCode.onclick=()=>{el.code=code.value;runButtonCode(code.value,editingPage.slug,el.id);};card.append(hint,code,testCode);}}else card.append(title);card.append(content,controls);const remove=document.createElement("button");remove.className="danger";remove.textContent="Remove block";remove.onclick=()=>{editingPage.elements.splice(i,1);renderBuilderBlocks();};card.append(remove);card.ondragstart=e=>e.dataTransfer.setData("text/plain",String(i));card.ondragover=e=>e.preventDefault();card.ondrop=e=>{e.preventDefault();const from=Number(e.dataTransfer.getData("text/plain"));const [m]=editingPage.elements.splice(from,1);editingPage.elements.splice(i,0,m);renderBuilderBlocks();};host.append(card);});}
$("savePage").onclick=async()=>{try{editingPage.title=$("editPageTitle").value;await api("/api/admin/pages/"+editingPage.id,{method:"PUT",body:JSON.stringify({title:editingPage.title,elements:editingPage.elements})});await loadAdminPages();await loadCustomNav();$("pageStatus").textContent="Page saved.";toast("Page saved.");}catch(e){$("pageStatus").textContent=e.message;}};
function runButtonCode(code,slug,elementId){
  const frame=document.createElement("iframe");frame.sandbox="allow-scripts";frame.style.display="none";
  const safeCode=String(code).slice(0,12000);
  frame.srcdoc=`<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; connect-src 'none'; img-src data:; style-src 'unsafe-inline'"><script>const send=(type,data={})=>parent.postMessage({source:'vivimess-button',type,data},'*');const vm=Object.freeze({toast:(text)=>send('toast',{text:String(text).slice(0,300)}),navigate:(slug)=>send('navigate',{slug:String(slug).slice(0,40)}),giveCurrency:(currencyId,amount)=>send('currency',{currencyId:String(currencyId),amount:Number(amount)})});try{(async()=>{${safeCode} })().catch(e=>send('error',{text:e.message}));}catch(e){send('error',{text:e.message});}<\/script>`;
  const listener=async event=>{if(event.source!==frame.contentWindow||event.data?.source!=="vivimess-button")return;const {type,data}=event.data;if(type==="toast")toast(data.text);if(type==="navigate"){const p=customPages.find(x=>x.slug===data.slug);if(p)showView(data.slug);else toast("Tab not found.");}if(type==="currency"){try{const r=await api("/api/pages/"+slug+"/action",{method:"POST",body:JSON.stringify({elementId,currencyId:data.currencyId,amount:data.amount})});toast("You received "+r.amount+" "+r.currency+". Balance: "+r.balance);}catch(e){toast(e.message);}}if(type==="error")toast("Button code error: "+data.text);};window.addEventListener("message",listener);document.body.append(frame);setTimeout(()=>{window.removeEventListener("message",listener);frame.remove();},15000);
}
$("previewPage").onclick=()=>{
  if(!editingPage){toast("Сначала выбери или создай страницу для предпросмотра.");return;}
  const panel=$("pagePreview");const host=$("pagePreviewContent");host.innerHTML="";panel.style.removeProperty("display");
  const previewPage={...editingPage,title:$("editPageTitle").value||editingPage.title};
  previewPage.elements.forEach(el=>{
    const wrap=document.createElement("div");wrap.className="custom-element";wrap.style.width=(Number(el.width)||100)+"%";wrap.style.color=el.color||"#ffffff";wrap.style.borderRadius=(Number(el.radius)||12)+"px";wrap.style.transform=`rotate(${Number(el.rotation)||0}deg)`;wrap.style.minHeight=(Number(el.height)||0)?(Number(el.height)+"px"):"";wrap.style.fontSize=(Number(el.fontSize)||16)+"px";
    if(el.type==="image"){const img=document.createElement("img");img.src=el.content||"";wrap.append(img);}
    else if(el.type==="video"){const v=document.createElement("video");v.src=el.content||"";v.controls=true;wrap.append(v);}
    else if(el.type==="button"){const b=document.createElement("button");b.className=el.action==="game-link"?"game-play-button":"primary";b.textContent=el.action==="game-link"?"▶ "+(el.label||"Играть"):(el.label||el.content||"Button");b.onclick=()=>{if(el.action==="game-link"){const url=safeGameUrl(el.target);if(url)window.open(url,"_blank","noopener,noreferrer");else toast("Add a valid game URL.");}else if(el.action==="code")runButtonCode(el.code||"",previewPage.slug,el.id);else if(el.action==="open-page")showView(el.target);else if(el.action==="award-currency")toast("Save the tab before testing currency rewards.");};wrap.append(b);}
    else wrap.textContent=el.content||"";
    host.append(wrap);
  });
  panel.classList.remove("hidden");panel.hidden=false;panel.style.display="block";panel.setAttribute("aria-live","polite");requestAnimationFrame(()=>panel.scrollIntoView({behavior:"smooth",block:"nearest"}));
};
$("closePreview").onclick=()=>{const panel=$("pagePreview");panel.classList.add("hidden");panel.hidden=true;panel.style.display="none";};
function renderCustomPage(slug){const page=customPages.find(p=>p.slug===slug);if(!page)return;let view=document.getElementById("custom-view-"+slug);if(!view){view=document.createElement("section");view.id="custom-view-"+slug;view.className="view hidden";document.querySelector(".main").append(view);}view.innerHTML="";page.elements.forEach(el=>{const wrap=document.createElement("div");wrap.className="custom-element";wrap.style.width=el.width+"%";wrap.style.color=el.color;wrap.style.borderRadius=el.radius+"px";wrap.style.transform=`rotate(${Number(el.rotation)||0}deg)`;wrap.style.minHeight=(Number(el.height)||0)?(Number(el.height)+"px"):"";wrap.style.fontSize=(Number(el.fontSize)||16)+"px";if(el.type==="image"){const img=document.createElement("img");img.src=el.content;wrap.append(img);}else if(el.type==="video"){const v=document.createElement("video");v.src=el.content;v.controls=true;wrap.append(v);}else if(el.type==="button"){const b=document.createElement("button");b.className=el.action==="game-link"?"game-play-button":"primary";b.textContent=el.action==="game-link"?"▶ "+(el.label||"Играть"):(el.label||el.content);b.onclick=()=>{if(el.action==="game-link"){const url=safeGameUrl(el.target);if(url)window.open(url,"_blank","noopener,noreferrer");else toast("Invalid game URL.");}else if(el.action==="open-page")showView(el.target);else if(el.action==="award-currency"){api("/api/pages/"+slug+"/action",{method:"POST",body:JSON.stringify({elementId:el.id})}).then(r=>toast("You received "+r.amount+" "+r.currency+"! Balance: "+r.balance)).catch(e=>toast(e.message));}else if(el.action==="code"){runButtonCode(el.code||"",slug,el.id);}};wrap.append(b);}else{wrap.textContent=el.content;}view.append(wrap);});view.classList.remove("hidden");}
$("profileAvatarFile").onchange=async()=>{try{const file=$("profileAvatarFile").files[0];if(!file)return;if(!["image/png","image/jpeg","image/webp","image/gif"].includes(file.type))throw new Error("Choose a PNG, JPG, WEBP or GIF image.");if(file.size>7*1024*1024)throw new Error("Avatar must be smaller than 7 MB.");const preview=await fileAsDataUrl(file);renderAvatar($("profileAvatar"),{...me,avatar:preview});}catch(err){$("profileMessage").textContent=err.message;$("profileAvatarFile").value="";}};
$("profileBannerFile").onchange=async()=>{try{const file=$("profileBannerFile").files[0];if(!file)return;if(!["image/png","image/jpeg","image/webp","image/gif","video/mp4","video/webm"].includes(file.type))throw new Error("Choose PNG, JPG, WEBP, GIF, MP4 or WEBM.");if(file.size>6*1024*1024)throw new Error("Banner must be smaller than 6 MB.");const banner=await fileAsDataUrl(file);renderProfileBanner({...me,banner});}catch(err){$("profileMessage").textContent=err.message;$("profileBannerFile").value="";}};
$("profileBannerColor").oninput=()=>{const host=$("profileBanner");host.innerHTML="";host.style.backgroundImage="none";host.style.backgroundColor=$("profileBannerColor").value;};
$("profileForm").onsubmit=async e=>{e.preventDefault();try{const file=$("profileAvatarFile").files[0];const avatar=file?await fileAsDataUrl(file):me.avatar||"";const bannerFile=$("profileBannerFile").files[0];const banner=bannerFile?await fileAsDataUrl(bannerFile):(me.banner||"");const data=await api("/api/profile",{method:"PATCH",body:JSON.stringify({displayName:$("profileName").value,bio:$("profileBio").value,avatar,banner,bannerColor:$("profileBannerColor").value,equippedFrame:$("profileEquippedFrame").value,equippedBanner:$("profileEquippedBanner").value})});me=data.user;$("profileHeading").textContent=me.displayName;$("profileUsername").value=me.username;renderAvatar($("profileAvatar"),me);renderProfileBanner(me);$("miniUser").textContent=me.displayName+"  @"+me.username;$("profileAvatarFile").value="";$("profileBannerFile").value="";$("profileMessage").textContent="Profile saved!";toast("Profile saved!");}catch(err){$("profileMessage").textContent=err.message;}};
function escapeHtml(s){return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}

function loadCallPreferences(){
  if($("turnUrl")){ $("turnUrl").value=callPrefs.turnUrl||"";$("turnUsername").value=callPrefs.turnUsername||"";$("turnPassword").value=callPrefs.turnPassword||""; }
}
async function refreshAudioDevices(){
  if(!navigator.mediaDevices?.enumerateDevices)return;
  try{
    const devices=await navigator.mediaDevices.enumerateDevices();
    const mic=$("micSelect"),spk=$("speakerSelect");if(!mic||!spk)return;
    const oldMic=callPrefs.micId||"",oldSpk=callPrefs.speakerId||"";
    const fill=(select,items,selected)=>{select.innerHTML="";const def=document.createElement("option");def.value="";def.textContent="System default";select.append(def);items.forEach((d,i)=>{const o=document.createElement("option");o.value=d.deviceId;o.textContent=d.label||`${select===mic?"Microphone":"Output"} ${i+1}`;select.append(o);});select.value=selected;};
    fill(mic,devices.filter(d=>d.kind==="audioinput"),oldMic);fill(spk,devices.filter(d=>d.kind==="audiooutput"),oldSpk);
    $("deviceStatus").textContent=`Found ${devices.filter(d=>d.kind==="audioinput").length} microphone(s) and ${devices.filter(d=>d.kind==="audiooutput").length} audio output(s).`;
  }catch(e){$("deviceStatus").textContent="Could not list devices: "+e.message;}
}
if($("refreshDevices"))$("refreshDevices").onclick=async()=>{try{const stream=await navigator.mediaDevices.getUserMedia({audio:true});stream.getTracks().forEach(t=>t.stop());await refreshAudioDevices();}catch(e){$("deviceStatus").textContent="Microphone permission: "+e.message;}};
if($("micSelect"))$("micSelect").onchange=()=>{callPrefs.micId=$("micSelect").value;localStorage.setItem(CALL_PREFS_KEY,JSON.stringify(callPrefs));$("deviceStatus").textContent="Microphone preference saved for your next call.";};
if($("speakerSelect"))$("speakerSelect").onchange=async()=>{callPrefs.speakerId=$("speakerSelect").value;localStorage.setItem(CALL_PREFS_KEY,JSON.stringify(callPrefs));try{if($("remoteAudio").setSinkId)await $("remoteAudio").setSinkId(callPrefs.speakerId||"");else throw new Error("This browser does not support selecting audio output.");$("deviceStatus").textContent="Audio output selected.";}catch(e){$("deviceStatus").textContent=e.message;}};
let micTestCleanup=null;
if($("testMic"))$("testMic").onclick=async()=>{
  if(micTestCleanup){micTestCleanup();micTestCleanup=null;return;}
  let stream,ctx,raf;
  try{
    stream=await navigator.mediaDevices.getUserMedia({audio:callPrefs.micId?{deviceId:{exact:callPrefs.micId}}:true});
    ctx=new (window.AudioContext||window.webkitAudioContext)();const analyser=ctx.createAnalyser();const source=ctx.createMediaStreamSource(stream);source.connect(analyser);analyser.fftSize=256;const data=new Uint8Array(analyser.frequencyBinCount);const fill=$("micMeterFill");
    const stop=()=>{cancelAnimationFrame(raf);stream.getTracks().forEach(t=>t.stop());ctx.close();fill.style.width="0%";$("testMic").textContent="Test microphone";$("deviceStatus").textContent="Microphone test stopped.";micTestCleanup=null;};
    micTestCleanup=stop;$("testMic").textContent="Stop microphone test";$("deviceStatus").textContent="Speak now — watch the level meter.";
    const tick=()=>{analyser.getByteFrequencyData(data);const level=Math.min(100,Math.round(data.reduce((a,b)=>a+b,0)/data.length/110*100));fill.style.width=level+"%";raf=requestAnimationFrame(tick);};tick();
  }catch(e){if(stream)stream.getTracks().forEach(t=>t.stop());$("deviceStatus").textContent="Microphone test failed: "+e.message;}
};
if($("testSpeaker"))$("testSpeaker").onclick=async()=>{try{const Ctx=window.AudioContext||window.webkitAudioContext;const ctx=new Ctx();const osc=ctx.createOscillator(),gain=ctx.createGain();osc.frequency.value=660;gain.gain.value=.08;osc.connect(gain);gain.connect(ctx.destination);osc.start();setTimeout(()=>{osc.stop();ctx.close();},650);$("deviceStatus").textContent="You should hear a short test tone.";}catch(e){$("deviceStatus").textContent="Speaker test failed: "+e.message;}};
if($("saveCallSettings"))$("saveCallSettings").onclick=()=>{callPrefs.turnUrl=$("turnUrl").value.trim();callPrefs.turnUsername=$("turnUsername").value.trim();callPrefs.turnPassword=$("turnPassword").value;localStorage.setItem(CALL_PREFS_KEY,JSON.stringify(callPrefs));$("callSettingsStatus").textContent="Saved. TURN settings apply to the next call.";};
if(navigator.mediaDevices?.addEventListener)navigator.mediaDevices.addEventListener("devicechange",refreshAudioDevices);

// Notification sound preferences (stored per browser/device).
if($("soundCalls")){$("soundCalls").checked=soundPrefs.calls;$("soundCalls").onchange=()=>{soundPrefs.calls=$("soundCalls").checked;saveSoundPrefs();if(!soundPrefs.calls)stopRingtone();};}
if($("soundMessages")){$("soundMessages").checked=soundPrefs.messages;$("soundMessages").onchange=()=>{soundPrefs.messages=$("soundMessages").checked;saveSoundPrefs();};}
if($("testUiSound"))$("testUiSound").onclick=()=>{if(soundContext?.state==="suspended")soundContext.resume();playUiTone("message");};
if($("enableCallSound"))$("peerVolume").oninput=()=>{const v=Number($("peerVolume").value);$("remoteAudio").volume=v/100;$("peerVolumeValue").textContent=v+"%";};
$("enableCallSound").onclick=async()=>{try{soundContext=soundContext||new (window.AudioContext||window.webkitAudioContext)();await soundContext.resume();$("remoteAudio").muted=false;await $("remoteAudio").play();$("enableCallSound").classList.add("hidden");$("callHint").textContent="Audio enabled";}catch(e){toast("Could not enable audio: "+e.message);}};
$("acceptCallBtn").onclick=()=>{
  const call=pendingIncomingCall;
  if(!call)return;
  pendingIncomingCall=null;
  $("incomingCallModal").classList.add("hidden");
  currentCallPeer=call.from;
  startCall(call.from,"audio",true);
};
$("declineCallBtn").onclick=()=>{
  const call=pendingIncomingCall;
  pendingIncomingCall=null;
  $("incomingCallModal").classList.add("hidden");
  if(call&&socket)socket.emit("call:end",{to:call.from});
};
$("audioCall").onclick=()=>{if(activeFriend)startCall(activeFriend.id,"audio",false);};
async function startCall(peer,mode,isAnswer){
  if(!peer||!socket||pc||localStream)return;
  currentCallPeer=peer;callMode="audio";if(!isAnswer)startRingtone("outgoing");$ ("callModal").classList.remove("hidden");
  $("callTitle").textContent="Voice call";$("callPeerName").textContent=activeFriend?.displayName||"Voice call";$("callPeerStatus").textContent=isAnswer?"Joining call…":"Calling…";$("callHint").textContent=isAnswer?"Connecting…":"Calling…";
  $("muteBtn").textContent="🎙 Mute";if($("peerVolume")){ $("peerVolume").value=100;$("peerVolumeValue").textContent="100%";}
  try{
    const audioBase={echoCancellation:true,noiseSuppression:true,autoGainControl:true,channelCount:{ideal:2},sampleRate:{ideal:48000}};
    try{localStream=await navigator.mediaDevices.getUserMedia({audio:callPrefs.micId?{...audioBase,deviceId:{exact:callPrefs.micId}}:audioBase,video:false});}
    catch(deviceError){if(!callPrefs.micId)throw deviceError;console.warn("Saved microphone unavailable; using system default",deviceError);callPrefs.micId="";localStorage.setItem(CALL_PREFS_KEY,JSON.stringify(callPrefs));localStream=await navigator.mediaDevices.getUserMedia({audio:audioBase,video:false});}
    pc=new RTCPeerConnection(makeIceConfig());
    // Reserve a negotiated video channel during call setup for later screen sharing.
    const screenTransceiver=pc.addTransceiver("video",{direction:"sendrecv"});
    screenSender=screenTransceiver.sender;
    localStream.getAudioTracks().forEach(track=>{
      const sender=pc.addTrack(track,localStream);
      try{const params=sender.getParameters();params.encodings=params.encodings?.length?params.encodings:[{}];params.encodings[0].maxBitrate=128000;sender.setParameters(params).catch(()=>{});}catch{}
    });
    pc.ontrack=async e=>{
      if(e.track.kind==="audio"){
        stopRingtone();const audio=$("remoteAudio");audio.autoplay=true;audio.playsInline=true;audio.muted=false;audio.volume=Math.max(0,Math.min(1,Number($("peerVolume")?.value??100)/100));
        audio.srcObject=e.streams?.[0]||new MediaStream([e.track]);
        if(callPrefs.speakerId&&audio.setSinkId){try{await audio.setSinkId(callPrefs.speakerId);}catch(err){console.warn("Audio output selection failed",err);}}
        try{await audio.play();$("callHint").textContent="Voice connected";}catch(err){$("callHint").textContent="Browser blocked call audio. Press Enable sound.";$("enableCallSound").classList.remove("hidden");}
      }
      if(e.track.kind==="video"){
        const video=$("remoteVideo");video.autoplay=true;video.playsInline=true;video.muted=true;
        video.srcObject=new MediaStream([e.track]);
        const show=()=>{video.classList.add("screen-live");$("fullscreenShareBtn")?.classList.remove("hidden");video.play().catch(err=>{console.warn("Remote screen playback failed",err);$("callHint").textContent="Screen received, but playback failed.";});};
        e.track.onunmute=show;e.track.onmute=()=>{video.classList.remove("screen-live");$("fullscreenShareBtn")?.classList.add("hidden");};
        if(e.track.readyState==="live"&&!e.track.muted)show();
      }
    };
    pc.onicecandidate=e=>{if(e.candidate&&currentCallPeer)socket.emit("call:signal",{to:peer,signal:{type:"ice",candidate:e.candidate}});};
    pc.onconnectionstatechange=()=>{if(!pc)return;const state=pc.connectionState;if(state==="connected"){stopRingtone();$("callHint").textContent="Voice connected";$("callPeerStatus").textContent="Connected · Voice";}else if(state==="connecting"){$("callHint").textContent="Connecting audio…";}else if(state==="disconnected"){$("callHint").textContent="Connection interrupted. Trying to reconnect…";}else if(state==="failed"){$("callHint").textContent="Could not connect. A TURN server may be required for this network.";}};
    pc.oniceconnectionstatechange=()=>{if(!pc)return;if(pc.iceConnectionState==="failed"){$("callHint").textContent="Network connection failed. Configure TURN in Voice settings and retry.";}else if(pc.iceConnectionState==="checking"){$("callHint").textContent="Finding the best connection…";}};
    if(isAnswer){
      if(incomingOffer){await pc.setRemoteDescription(incomingOffer);for(const c of pendingIce)await pc.addIceCandidate(c);pendingIce=[];const answer=await pc.createAnswer();await pc.setLocalDescription(answer);socket.emit("call:signal",{to:peer,signal:{type:"description",description:pc.localDescription}});incomingOffer=null;}
      // If the offer arrives after the user accepts, handleSignal creates the answer.
    }else{
      socket.emit("call:invite",{to:peer,mode:"audio"});
      const offer=await pc.createOffer();await pc.setLocalDescription(offer);socket.emit("call:signal",{to:peer,signal:{type:"description",description:pc.localDescription}});
    }
  }catch(e){toast("Could not start call: "+e.message);endCall(true);}
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
    if(!pc||pc.connectionState!=="connected")throw new Error("Сначала дождись подключения голосового звонка.");
    if(screenStream){
      const old=screenStream;screenStream=null;
      if(screenSender)await screenSender.replaceTrack(null);
      old.getTracks().forEach(t=>t.stop());
      $("shareBtn").textContent="▧ Share screen";
      $("fullscreenShareBtn")?.classList.add("hidden");
      $("callHint").textContent="Screen sharing stopped";
      return;
    }
    if(!window.isSecureContext)throw new Error("Демонстрация экрана доступна только на HTTPS-сайте.");
    if(!navigator.mediaDevices||!navigator.mediaDevices.getDisplayMedia)throw new Error("Браузер не поддерживает демонстрацию. Открой сайт в актуальном Chrome или Edge.");
    // getDisplayMedia must be called directly from this click handler.
    const captured=await navigator.mediaDevices.getDisplayMedia({video:{frameRate:{ideal:30,max:30},width:{ideal:1920},height:{ideal:1080}},audio:false});
    const track=captured.getVideoTracks()[0];
    if(!track)throw new Error("Браузер не вернул видеопоток экрана.");
    const videoTransceiver=pc.getTransceivers().find(t=>t.sender===screenSender)||pc.getTransceivers().find(t=>t.receiver?.track?.kind==="video");
    if(!videoTransceiver)throw new Error("Не найден согласованный видеоканал. Заверши звонок и начни новый после обновления страницы у обоих участников.");
    screenSender=videoTransceiver.sender;
    if(videoTransceiver.direction!=="sendrecv")videoTransceiver.direction="sendrecv";
    await screenSender.replaceTrack(track);
    try{const params=screenSender.getParameters();params.encodings=params.encodings?.length?params.encodings:[{}];params.encodings[0].maxBitrate=4000000;params.encodings[0].maxFramerate=30;params.degradationPreference="maintain-resolution";await screenSender.setParameters(params);}catch(err){console.warn("Could not tune screen quality",err);}
    screenStream=captured;
    $("shareBtn").textContent="▧ Stop sharing";
    $("fullscreenShareBtn")?.classList.remove("hidden");
    $("callHint").textContent="You are sharing your screen";
    track.addEventListener("ended",async()=>{
      try{await screenSender?.replaceTrack(null);}catch(err){console.warn("Could not stop screen sender",err);}
      if(screenStream===captured)screenStream=null;
      $("shareBtn").textContent="▧ Share screen";
      $("fullscreenShareBtn")?.classList.add("hidden");
      $("callHint").textContent="Screen sharing stopped";
    },{once:true});
  }catch(e){
    if(screenStream){screenStream.getTracks().forEach(t=>t.stop());screenStream=null;}
    $("shareBtn").textContent="▧ Share screen";
    $("fullscreenShareBtn")?.classList.add("hidden");
    toast("Демонстрация экрана: "+(e.name==="NotAllowedError"?"доступ отменён или запрещён браузером":e.message));
  }
};
$("fullscreenShareBtn").onclick=async()=>{const stage=$("remoteVideo").closest(".video-stage");if(!stage)return;try{if(!document.fullscreenElement){await stage.requestFullscreen();$("fullscreenShareBtn").textContent="⛶ Выйти из полного экрана";}else{await document.exitFullscreen();$("fullscreenShareBtn").textContent="⛶ На весь экран";}}catch(e){toast("Полный экран недоступен: "+e.message);}};
document.addEventListener("fullscreenchange",()=>{if(!document.fullscreenElement&&$("fullscreenShareBtn"))$("fullscreenShareBtn").textContent="⛶ На весь экран";});
$("hangupBtn").onclick=()=>endCall(true);
function endCall(notify){
  if(notify&&currentCallPeer&&socket)socket.emit("call:end",{to:currentCallPeer});
  stopRingtone();if(screenStream){screenStream.getTracks().forEach(t=>t.stop());screenStream=null;}screenSender=null;if(pc){pc.close();pc=null;}if(localStream){localStream.getTracks().forEach(t=>t.stop());localStream=null;}
  $("remoteVideo").srcObject=null;$("remoteVideo").classList.remove("screen-live");$("remoteAudio").srcObject=null;$("shareBtn").textContent="▧ Share screen";$("fullscreenShareBtn")?.classList.add("hidden");if(document.fullscreenElement)document.exitFullscreen().catch(()=>{});$("callModal").classList.add("hidden");$("callHint").classList.remove("hidden");$("incomingCallModal").classList.add("hidden");currentCallPeer=null;incomingOffer=null;pendingIce=[];pendingIncomingCall=null;
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
$("saveJs").onclick=async()=>{try{await api("/api/admin/code",{method:"PATCH",body:JSON.stringify({css:$("customCss").value,js:$("customJs").value})});applyCustomJavaScript($("customJs").value);$("codeStatus").textContent="JavaScript saved for everyone.";}catch(e){$("codeStatus").textContent=e.message;}};
$("clearJs").onclick=()=>{$("customJs").value="";$("saveJs").click();};
$("saveRobloxTheme").onclick=async()=>{try{const r=await api("/api/admin/settings",{method:"PATCH",body:JSON.stringify({robloxTheme:$("robloxTheme").checked,robloxBg:$("robloxBg").value,robloxBorder:$("robloxBorder").value,robloxButton:$("robloxButton").value,robloxArt:$("robloxArt").value})});siteSettings={...siteSettings,...r.settings};applySiteSettings($("customCss").value);$("codeStatus").textContent="Roblox theme and colors saved for everyone.";}catch(e){$("codeStatus").textContent=e.message;}};
$("runJs").onclick=()=>{applyCustomJavaScript($("customJs").value);$("codeStatus").textContent="JavaScript preview started in isolated sandbox.";};
if(token)boot();else {$("auth").classList.remove("hidden");loadSiteSettings();}

/* ViviMess language switcher (RU / EN), saved per browser. */
const VM_LANG_KEY="vm_language";
const VM_TRANSLATIONS={
"Messages":"Сообщения","Friends":"Друзья","My profile":"Мой профиль","Settings":"Настройки","Shop":"Магазин","Quests":"Квесты","Creator Studio":"Студия создателя","Sign out":"Выйти","WORKSPACE":"РАБОЧАЯ ОБЛАСТЬ","Connected":"В сети","Find your people":"Найти пользователей","Search by username or display name.":"Поиск по имени пользователя или отображаемому имени.","Search creators...":"Поиск пользователей...","Friend requests":"Заявки в друзья","Your friends":"Ваши друзья","ViviMess Shop":"Магазин ViviMess","Frames and animated profile banners":"Рамки и анимированные баннеры профиля","Complete quests and earn currency":"Выполняйте задания и получайте валюту","Your next conversation starts here":"Твой следующий разговор начинается здесь","Choose a friend on the left to send a message or start a call.":"Выбери друга слева, чтобы написать ему или позвонить.","Voice call":"Голосовой звонок","Search messages…":"Поиск сообщений…","All messages":"Все сообщения","Images":"Изображения","Videos":"Видео","Files / mods":"Файлы / моды","Clear":"Очистить","Write a message...":"Написать сообщение...","Send ➤":"Отправить ➤","Other person volume":"Громкость собеседника","Enable sound":"Включить звук","Mute":"Выключить микрофон","Share screen":"Поделиться экраном","End call":"Завершить звонок","Profile banner":"Баннер профиля","Your profile":"Твой профиль","Make your creator profile yours.":"Настрой свой профиль.","Sign in":"Войти","Create account":"Создать аккаунт","Display name":"Отображаемое имя","Username":"Имя пользователя","Password":"Пароль","At least 8 characters":"Не менее 8 символов","Your name":"Твоё имя","Messages, calls and screen sharing — all in one place.":"Сообщения, звонки и демонстрация экрана — всё в одном месте.","Search messages":"Поиск сообщений","No messages match this search.":"Сообщения не найдены."};
Object.assign(VM_TRANSLATIONS,{
"Call sounds (incoming and outgoing)":"Звуки звонков (входящие и исходящие)","New message sounds":"Звуки новых сообщений","A quick look at your community.":"Краткая информация о сообществе.","About you":"О вас","Accent color":"Акцентный цвет","Accept":"Принять","Accounts":"Аккаунты","Accounts & permissions":"Аккаунты и права","Action":"Действие","Add currency":"Добавить валюту","Admin account: ":"Аккаунт администратора: ","Administrator":"Администратор","Advanced: custom CSS":"Дополнительно: свой CSS","Amount":"Количество","Appearance":"Внешний вид","Appearance & branding":"Внешний вид и бренд","Apply balance":"Применить баланс","Background":"Фон","Call":"Звонок","Call history":"История звонков","Calls":"Звонки","Change site identity without editing files in GitHub.":"Меняйте название и логотип сайта без редактирования файлов в GitHub.","Clear":"Очистить","Close":"Закрыть","Close preview":"Закрыть предпросмотр","Community moderation":"Модерация сообщества","Create group chats with your friends.":"Создавайте групповые чаты с друзьями.","Create new tabs and build pages from blocks. Drag blocks to reorder; edit width, color and corners. Buttons can run built-in actions or your own JavaScript in an isolated sandbox.":"Создавайте вкладки и страницы из блоков. Перетаскивайте блоки, меняйте ширину, цвет и скругление. Кнопки могут выполнять готовые действия или ваш JavaScript в изолированной среде.","Decline":"Отклонить","Description":"Описание","Devices not checked yet.":"Устройства ещё не проверены.","Do not disturb":"Не беспокоить","During a connected call, press Share screen and choose a screen or window in the browser dialog. The browser requires this action to be started by you.":"Во время звонка нажмите «Поделиться экраном» и выберите экран или окно. Браузер требует, чтобы вы начали это действие сами.","Edit page":"Изменить страницу","End call":"Завершить звонок","English":"Английский","Eraser":"Ластик","Features":"Функции","Find a user":"Найти пользователя","Find profile & friends":"Найти профиль и друзей","First username":"Первое имя пользователя","Friend links":"Ссылки друзей","GIF":"GIF","Give currency":"Выдать валюту","Groups":"Группы","Headphones / speakers":"Наушники / динамики","Idle":"Неактивен","Image / animated GIF / video":"Изображение / GIF / видео","Image, animated GIF or video · up to 6 MB":"Изображение, GIF или видео · до 6 МБ","Incoming voice call":"Входящий голосовой звонок","Interface language":"Язык интерфейса","Invisible":"Невидимый","Item name":"Название предмета","Logo image / GIF":"Логотип: изображение / GIF","Logo image / GIF / video":"Логотип: изображение / GIF / видео","Microphone":"Микрофон","Moderator":"Модератор","Name (shown to other users)":"Имя (видно другим пользователям)","New tab name":"Название новой вкладки","Notice: conversations may be reviewed by administrators for moderation. Calls are not audio-recorded.":"Уведомление: администраторы могут проверять переписки для модерации. Звонки не записываются.","Notification sounds":"Звуки уведомлений","Only administrators can create and remove shop items and quests.":"Только администраторы могут создавать и удалять товары и квесты.","Only admins can create currencies and manage roles. The owner viva can promote other accounts.":"Только администраторы могут создавать валюты и управлять ролями. Владелец viva может повышать роли других аккаунтов.","Optional code area. Ask ChatGPT for CSS changes and paste them here.":"Необязательное поле для кода. Вставьте сюда CSS для изменения оформления.","Or choose a banner color ":"Или выберите цвет баннера","PERSONAL AUDIO SETUP":"НАСТРОЙКА ЗВУКА","Page name":"Название страницы","Panel color":"Цвет панели","Preview":"Предпросмотр","Preview tab":"Предпросмотр вкладки","Price":"Цена","Profile frame":"Рамка профиля","Properties":"Свойства","Quest cover image / GIF (optional)":"Обложка квеста: изображение / GIF (необязательно)","Quest submissions to review":"Заявки на проверку","Quest title":"Название квеста","Regular user":"Обычный пользователь","Reset community (keep viva only)":"Сбросить сообщество (оставить только viva)","Reward amount":"Размер награды","Reward currency":"Валюта награды","Role":"Роль","Save branding":"Сохранить оформление","Save call settings":"Сохранить настройки звонков","Save custom CSS":"Сохранить CSS","Save features":"Сохранить функции","Save page":"Сохранить страницу","Save role":"Сохранить роль","Save visual changes":"Сохранить изменения оформления","Search by username or display name.":"Поиск по имени пользователя или отображаемому имени.","Second username":"Второе имя пользователя","Select a block to edit its size, rotation, text and corners.":"Выберите блок, чтобы изменить размер, поворот, текст и скругление.","Share your screen in a call":"Показать экран во время звонка","Sign in":"Войти","Sign out":"Выйти","Site name":"Название сайта","Site overview":"Обзор сайта","Someone is calling you…":"Вам звонят…","System default":"По умолчанию системы","TURN password":"Пароль TURN","TURN server URL":"Адрес TURN-сервера","TURN username":"Имя пользователя TURN","Take currency":"Забрать валюту","Task link (optional, HTTPS)":"Ссылка на задание (необязательно, HTTPS)","Test headphones":"Проверить наушники","Test microphone":"Проверить микрофон","The starting currency is Чекушня. Every account starts at 0.":"Начальная валюта — Чекушня. Баланс каждого аккаунта начинается с 0.","Type":"Тип","Update the name, welcome text and colors.":"Измените название, приветственный текст и цвета.","Use uploaded banner":"Использовать загруженный баннер","Username (login and account ID)":"Имя пользователя (логин и ID аккаунта)","VIVIMESS LIVE":"VIVIMESS В СЕТИ","Voice & device settings":"Настройки звука и устройств","Voice calling":"Голосовые звонки","Website name":"Название сайта","Welcome text":"Приветственный текст","Your GIFs":"Ваши GIF","Your friends":"Ваши друзья","Your profile":"Ваш профиль","No calls recorded yet.":"Звонков пока нет.","No groups yet. Create one to start chatting.":"Групп пока нет. Создайте группу, чтобы начать общение.","Create group":"Создать группу","Create tab":"Создать вкладку","Add shop item":"Добавить товар","Add quest":"Добавить квест","Add item":"Добавить предмет","Send drawing":"Отправить рисунок","Eraser":"Ластик","Run my JavaScript code":"Запустить мой JavaScript-код"
});
Object.assign(VM_TRANSLATIONS,{
"Messages":"Сообщения","Friends":"Друзья","Groups":"Группы","My profile":"Мой профиль","Settings":"Настройки","Shop":"Магазин","Quests":"Задания","Creator Studio":"Студия создателя","Sign out":"Выйти","WORKSPACE":"РАБОЧАЯ ОБЛАСТЬ","Connected":"Подключено","Your next conversation starts here":"Здесь начнётся ваш следующий разговор","Choose a friend on the left to send a message or start a call.":"Выберите друга слева, чтобы написать сообщение или позвонить.","Voice call":"Голосовой звонок","Write a message...":"Напишите сообщение...","Send ➤":"Отправить ➤","Search messages…":"Поиск сообщений…","All messages":"Все сообщения","Images":"Изображения","Videos":"Видео","Files / mods":"Файлы / моды","Clear":"Очистить","Find your people":"Найдите друзей","Search by username or display name.":"Поиск по имени пользователя или отображаемому имени.","Search creators...":"Поиск пользователей...","Friend requests":"Заявки в друзья","Your friends":"Ваши друзья","Create group chats with your friends.":"Создавайте групповые чаты с друзьями.","New group":"Новая группа","Write to group…":"Сообщение группе…","ViviMess Shop":"Магазин ViviMess","Frames and animated profile banners":"Рамки и анимированные баннеры профиля","Complete quests and earn currency":"Выполняйте задания и получайте валюту","Profile banner":"Баннер профиля","Make your creator profile yours.":"Настройте свой профиль.","Avatar from your computer":"Аватар с компьютера","Equipped frame":"Установленная рамка","Equipped banner":"Установленный баннер","Save profile":"Сохранить профиль","Voice & device settings":"Настройки звука и устройств","Choose your microphone and headphones. Changes apply to the next call; output changes apply immediately when supported by your browser.":"Выберите микрофон и наушники. Изменения микрофона применятся при следующем звонке; устройство вывода — сразу, если браузер поддерживает эту функцию.","Headphones / speakers":"Наушники / динамики","Find devices":"Найти устройства","Test microphone":"Проверить микрофон","Test headphones":"Проверить наушники","Screen sharing":"Демонстрация экрана","Language / Язык":"Язык интерфейса","Interface language":"Язык интерфейса","OWNER CONTROL CENTER":"ПАНЕЛЬ УПРАВЛЕНИЯ ВЛАДЕЛЬЦА","ADMIN MODE":"РЕЖИМ АДМИНИСТРАТОРА","All":"Все","Design":"Оформление","Shop & quests manager":"Управление магазином и заданиями","Appearance":"Внешний вид","Features":"Функции","Currency studio":"Управление валютами","Accounts & permissions":"Аккаунты и права доступа","Sidebar pages & visual builder":"Вкладки и визуальный редактор","Community moderation":"Модерация сообщества","Advanced: custom CSS":"Дополнительно: пользовательский CSS","Save visual changes":"Сохранить оформление","Save features":"Сохранить функции","Save custom CSS":"Сохранить CSS","Clear":"Очистить","Website name":"Название сайта","Welcome text":"Приветственный текст","Accent color":"Акцентный цвет","Background":"Фон","Panel color":"Цвет панели","Friend list and adding people":"Список друзей и добавление пользователей","Voice calling":"Голосовые звонки","Share your screen in a call":"Демонстрация экрана во время звонка","Only administrators can create and remove shop items and quests.":"Только администраторы могут добавлять и удалять товары и задания.","Item name":"Название предмета","Description":"Описание","Price":"Цена","Currency":"Валюта","Type":"Тип","Profile frame":"Рамка профиля","Profile banner":"Баннер профиля","Add shop item":"Добавить товар","Quest title":"Название задания","Reward amount":"Размер награды","Reward currency":"Валюта награды","Task link (optional, HTTPS)":"Ссылка на задание (необязательно, HTTPS)","Add quest":"Добавить задание","Quest submissions to review":"Заявки на проверку заданий","Accounts":"Аккаунты","Find a user":"Найти пользователя","Username":"Имя пользователя","Find profile & friends":"Найти профиль и друзей","Conversation review":"Просмотр переписки","Call history":"История звонков","Save branding":"Сохранить оформление","Save page":"Сохранить страницу","Preview tab":"Предпросмотр вкладки","Close preview":"Закрыть предпросмотр","Properties":"Свойства","Select a block to edit its size, rotation, text and corners.":"Выберите элемент, чтобы изменить размер, поворот, текст и скругление.","Create tab":"Создать вкладку","Add item":"Добавить предмет","Send drawing":"Отправить рисунок","Eraser":"Ластик","Online":"В сети","Idle":"Неактивен","Do not disturb":"Не беспокоить","Invisible":"Невидимый","System default":"По умолчанию системы","Choose a PNG, JPG, WEBP or GIF image.":"Выберите изображение PNG, JPG, WEBP или GIF.","Profile saved!":"Профиль сохранён!","Reward claimed":"Награда получена","Waiting for admin approval":"Ожидает проверки администратора","Run my JavaScript code":"Запустить мой JavaScript-код"
});
const VM_TRANSLATIONS_EN=Object.fromEntries(Object.entries(VM_TRANSLATIONS).map(([a,b])=>[b,a]));
function vmApplyLanguage(){const lang=localStorage.getItem(VM_LANG_KEY)||"ru";if($("settingsLanguage"))$("settingsLanguage").value=lang;document.documentElement.lang=lang;const dict=lang==="ru"?VM_TRANSLATIONS:VM_TRANSLATIONS_EN;const walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);let node;while(node=walker.nextNode()){if(node.parentElement?.closest('script,style,textarea,code'))continue;if(node.__vmOriginal===undefined)node.__vmOriginal=node.nodeValue;const original=node.__vmOriginal;const key=original.trim();if(dict[key])node.nodeValue=original.replace(key,dict[key]);else if(lang==="en")node.nodeValue=original;}
 document.querySelectorAll("input[placeholder],textarea[placeholder],button[title],img[alt]").forEach(el=>{for(const attr of ['placeholder','title','alt']){if(!el.hasAttribute(attr))continue;const store='vmOriginal'+attr;if(!el.dataset[store])el.dataset[store]=el.getAttribute(attr);const key=el.dataset[store];if(dict[key])el.setAttribute(attr,dict[key]);else if(lang==='en')el.setAttribute(attr,key);}});
 document.querySelectorAll('option').forEach(el=>{if(!el.dataset.vmOriginal)el.dataset.vmOriginal=el.textContent;const key=el.dataset.vmOriginal;if(dict[key])el.textContent=dict[key];else if(lang==='en')el.textContent=key;});const sel=document.getElementById("vmLanguage");if(sel&&sel.value!==lang)sel.value=lang;}
function vmSetLanguage(lang){localStorage.setItem(VM_LANG_KEY,lang);location.reload();}
(function(){const top=document.querySelector(".topbar");if(!top||document.getElementById("vmLanguage"))return;const wrap=document.createElement("label");wrap.className="vm-language-wrap";wrap.title="Language / Язык";wrap.innerHTML='<span>🌐</span><select id="vmLanguage" aria-label="Language"><option value="ru">RU</option><option value="en">EN</option></select>';top.append(wrap);wrap.querySelector("select").onchange=e=>{vmSetLanguage(e.target.value);if($("settingsLanguage"))$("settingsLanguage").value=e.target.value;};if($("settingsLanguage"))$("settingsLanguage").onchange=e=>{vmSetLanguage(e.target.value);const top=$("vmLanguage");if(top)top.value=e.target.value;};const lang=localStorage.getItem(VM_LANG_KEY)||"ru";if($("settingsLanguage"))$("settingsLanguage").value=lang;wrap.querySelector("select").value=lang;vmApplyLanguage();new MutationObserver(()=>{if(!window.vmLangQueued){window.vmLangQueued=true;requestAnimationFrame(()=>{window.vmLangQueued=false;vmApplyLanguage();});}}).observe(document.body,{childList:true,subtree:true,characterData:true});})();


/* ViviMess 5.0 — reliable Creator Studio categories (stable panel order + bilingual titles). */
(function(){
 const host=document.getElementById('view-studio'); if(!host)return;
 const panels=[...host.querySelectorAll('.studio-grid > .studio-panel')];
 const byIndex=['design','design','system','shop','community','builder','shop','community','system','system'];
 const aliases=[
  [/appearance|внешн/i,'design'],[/features|функц/i,'design'],
  [/currency|валют/i,'shop'],[/shop|магазин|quest|квест/i,'shop'],
  [/account|permission|moderation|сообществ|аккаунт|модерац/i,'community'],
  [/page|visual builder|редактор|вклад/i,'builder'],
  [/css|system|система/i,'system']
 ];
 panels.forEach((panel,index)=>{
   const heading=(panel.querySelector('h3')?.textContent||'').trim();
   const match=aliases.find(([rx])=>rx.test(heading));
   panel.dataset.studioCategory=match?match[1]:(byIndex[index]||'system');
   panel.classList.add('studio-section-card');
 });
 const nav=document.getElementById('studioCategories'); if(!nav)return;
 const apply=filter=>{
   nav.querySelectorAll('[data-studio-filter]').forEach(btn=>btn.classList.toggle('active',btn.dataset.studioFilter===filter));
   panels.forEach(panel=>{
     const show=filter==='all'||panel.dataset.studioCategory===filter;
     panel.classList.toggle('studio-filter-hidden',!show);
     panel.hidden=!show;
   });
 };
 nav.addEventListener('click',event=>{const btn=event.target.closest('[data-studio-filter]');if(btn)apply(btn.dataset.studioFilter);});
 apply('all');
})();

