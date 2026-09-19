let DATA = null;
let SERVER = {session:null, workers:[], task:null, events:[], notifications:[], notificationSeq:0};
let INFO = {lanUrl:"", localUrl:"http://localhost:5173"};

const state = {
  loggedIn: false,
  role: "owner",
  page: "home",
  selectedWorkflow: "video",
  selectedConnector: "davinci",
  receiverName: localStorage.getItem("swarmosReceiverName") || "iQOO Z10 Turbo",
  receiverProfile: localStorage.getItem("swarmosReceiverProfile") || "iqoo",
  builder: {
    objective: "Fastest finish",
    privacy: "Task-only data",
    network: "Prefer fastest available",
    deleteTemp: true,
    wifiOnly: false,
    allowMobile: true,
    minBattery: 30,
    maxTemp: 42,
    maxStorage: 5,
    selectedDevices: ["owner-laptop","worker-laptop","iqoo-phone"],
    sourceLabel: "Hackathon_Final / Final_Edit",
    fileNames: []
  },
  notificationDrawer: false,
  lastSeenNotification: Number(localStorage.getItem("swarmosLastNotification") || 0),
  polling: null,
  simTimer: null,
  lastAlertId: 0,
  lastCelebrationKey: "",
  newWorkerNames: [],
  lastOwnerOverlayId: 0
};

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"}[c]));
const wf = () => DATA.workflows.find(x => x.id === state.selectedWorkflow) || DATA.workflows[0];
const conn = () => wf().connectors.find(x => x.id === state.selectedConnector) || wf().connectors[0];

function appIdForProfile(profileId=state.receiverProfile,name=state.receiverName){
  const base = `${profileId}|${name}`;
  let hash = 0; for(let i=0;i<base.length;i++) hash = (hash*31 + base.charCodeAt(i)) % 100000;
  return `SW-${String(profileId||'APP').slice(0,3).toUpperCase()}-${String(hash).padStart(5,'0')}`;
}
function workerToken(name=state.receiverName){
  const base = `${name}|TOKEN`;
  let hash = 0; for(let i=0;i<base.length;i++) hash = (hash*37 + base.charCodeAt(i)) % 1000000;
  return `TOK-${String(hash).padStart(6,'0')}`;
}
function qrMatrix(text, size=13){
  let seed = 0; for(let i=0;i<text.length;i++) seed = (seed*131 + text.charCodeAt(i)) >>> 0;
  const finder=(r,c,n)=>((r<3||r>=n-3)&&(c<3||c>=n-3)) || ((r<3||r>=n-3)&&(c>=n-3||c<3)) || ((r>=n-3||r<3)&&(c<3||c>=n-3));
  let cells='';
  for(let r=0;r<size;r++){
    for(let c=0;c<size;c++){
      const border = (r<3 && c<3) || (r<3 && c>=size-3) || (r>=size-3 && c<3);
      const on = border ? ((r===0||r===2||c===0||c===2)||(r===1&&c===1)) : (((seed >> ((r*c + c + r)%24)) & 1)===1);
      cells += `<i class="${on?'on':''}"></i>`;
    }
  }
  return `<div class="qr-card"><div class="qr-grid" style="grid-template-columns:repeat(${size},1fr)">${cells}</div><small>QR-style join preview</small></div>`;
}
function waitingApprovalCount(){ return (SERVER.workers||[]).filter(x=>x.decision==='Waiting').length; }
function acceptedWorkers(){ return (SERVER.workers||[]).filter(x=>x.decision==='Accepted'); }
function workerContribution(a){
  if(!a) return 'Waiting for assignment';
  return `${a.share || 0}% contribution • ${a.range || 'assigned scope'}`;
}

function brandLogo(key,label,extra=''){
  const slugMap={
    hp:'hp',asus:'asus',iqoo:'iqoo',davinci:'davinciresolve',premiere:'adobepremierepro','media-encoder':'adobe',finalcut:'apple',capcut:'capcut','generic-video':'ffmpeg',
    github:'github',gitlab:'gitlab',bitbucket:'bitbucket','google-drive':'googledrive','drive-project':'googledrive','photo-drive':'googledrive','ocr-drive':'googledrive','data-drive':'googledrive','media-drive':'googledrive','zip-drive':'googledrive',
    onedrive:'microsoftonedrive','photo-onedrive':'microsoftonedrive','ocr-onedrive':'microsoftonedrive','zip-onedrive':'microsoftonedrive',dropbox:'dropbox','photo-dropbox':'dropbox','ocr-dropbox':'dropbox','zip-dropbox':'dropbox',s3:'amazons3','data-s3':'amazons3','ai-s3':'amazons3'
  };
  const slug=slugMap[key];
  const short=(label||key).replace(/[^A-Za-z0-9]/g,'').slice(0,3).toUpperCase() || 'SW';
  if(!slug) return `<span class="brand-fallback ${extra}">${esc(short)}</span>`;
  return `<span class="real-brand ${extra}"><img src="https://cdn.simpleicons.org/${slug}" alt="${esc(label)} logo" onerror="this.style.display='none';this.nextElementSibling.style.display='grid'"><span class="brand-fallback" style="display:none">${esc(short)}</span></span>`;
}
function deviceBrandLogo(name,extra=''){
  const n=(name||'').toLowerCase();
  if(n.includes('victus')||n.includes('hp')) return brandLogo('hp','HP',extra);
  if(n.includes('asus')||n.includes('tuf')) return brandLogo('asus','ASUS',extra);
  if(n.includes('iqoo')) return brandLogo('iqoo','iQOO',extra);
  return `<span class="brand-fallback ${extra}">PC</span>`;
}
function taskPath(task){
  const status=task?.status||'Draft'; const p=task?.progress||0;
  const steps=[
    ['1','Work selected',true],
    ['2','Devices connected',!!SERVER.session && (SERVER.workers||[]).length>0],
    ['3','Agent split ready',!!task],
    ['4','Request sent',!!task],
    ['5','Receiver approved',status==='Active'||status==='Completed'||acceptedWorkers().length>0],
    ['6','Parallel execution',status==='Active'||status==='Completed'],
    ['7','Return + merge',status==='Completed']
  ];
  return `<div class="clear-flow-path">${steps.map((s,i)=>`<div class="${s[2]?'done':''} ${(!s[2] && (i===0 || steps[i-1][2]))?'current':''}"><span>${s[0]}</span><b>${s[1]}</b></div>${i<steps.length-1?'<i>→</i>':''}`).join('')}</div>`;
}
function predictedTimeFor(a,task){
  if(!a) return task?.eta||'—';
  return `${task?.eta||wf().distributedEstimate} target`;
}
function allocationProgress(a,task,workers){
  const name=(a.device||'').toLowerCase();
  if(name.includes('victus')||name.includes('owner')) return task?.status==='Completed'?100:(task?.ownerProgress ?? task?.progress ?? 0);
  const w=workers.find(x=>(x.name||'').toLowerCase()===name || name.includes((x.name||'').toLowerCase()) || (x.name||'').toLowerCase().includes(name));
  return w?.progress||0;
}
function distributionBoard(task,workers){
  const allocations=task?.allocations?.length?task.allocations:computedAllocation(wf());
  const owner=allocations.find(a=>/victus|owner/i.test(a.device||''));
  const workerShare=allocations.filter(a=>a!==owner).reduce((s,a)=>s+(a.share||0),0);
  return `<div class="distribution-summary"><div><span>OWNER WORK</span><b>${owner?.share||0}%</b><small>${esc(owner?.range||'Local portion')}</small></div><div><span>OTHER DEVICES</span><b>${workerShare}%</b><small>${workers.length} connected receiver${workers.length===1?'':'s'}</small></div><div><span>PREDICTED FINISH</span><b>${esc(task?.eta||wf().distributedEstimate)}</b><small>${esc(task?.saving||wf().saving)} expected saving</small></div><div><span>MODE</span><b>Auto-run</b><small>Starts after approvals</small></div></div><div class="distribution-board">${allocations.map(a=>{
    const isOwner=/victus|owner/i.test(a.device||'');
    const w=workers.find(x=>(x.name||'').toLowerCase()===(a.device||'').toLowerCase());
    const prog=allocationProgress(a,task,workers);
    const status=isOwner?(task?.status==='Active'?'Working locally':task?.status==='Completed'?'Done':'Ready'):(w?.decision==='Accepted'?(task?.status==='Active'?'Working':'Accepted'):(w?.decision||'Waiting'));
    return `<div class="distribution-row ${isOwner?'owner-row':''}"><div class="dist-device">${deviceBrandLogo(a.device,'dist-logo')}<div><b>${esc(a.device)}</b><span>${isOwner?'OWNER + LOCAL EXECUTOR':'RECEIVER / WORKER'}</span></div></div><div><span>Work</span><b>${a.share||0}%</b><small>${esc(a.range||'Assigned scope')}</small></div><div><span>Time</span><b>${esc(predictedTimeFor(a,task))}</b><small>Balanced finish target</small></div><div><span>Status</span><b>${esc(status)}</b><div class="progress tiny"><span style="width:${prog}%"></span></div><small>${prog}%</small></div></div>`;
  }).join('')}</div>`;
}
function swarmMesh(workers,task){
  const pos=[['p1','left:6%;top:18%'],['p2','right:7%;top:13%'],['p3','right:10%;bottom:8%'],['p4','left:11%;bottom:7%']];
  return `<div class="swarm-mesh"><div class="mesh-grid"></div><div class="mesh-owner">${deviceBrandLogo('HP Victus 16','mesh-logo')}<b>HP Victus 16</b><span>Owner</span><em>${task?.status==='Active'?'EXECUTING':'READY'}</em></div>${workers.slice(0,4).map((w,i)=>`<div class="mesh-worker ${pos[i][0]} ${state.newWorkerNames.includes(w.name)?'new-arrival':''}" style="${pos[i][1]}">${deviceBrandLogo(w.name,'mesh-logo')}<b>${esc(w.name)}</b><span>${esc(w.decision)}</span><em>${w.progress||0}%</em></div>`).join('')}<div class="mesh-core"><span>SWARM</span><b>${workers.length+1}</b><small>devices</small></div></div>`;
}

function routeFlow(task,workers){
  const stage = task?.status==='Completed' ? 'returned' : task?.status==='Active' ? 'running' : task?.status==='Awaiting approval' ? 'sending' : 'idle';
  const ownerShare = task?.allocations?.find(a=>/victus|owner/i.test(a.device||''))?.share || 0;
  return `<div class="route-card ${stage}"><div class="route-head"><div><span class="eyebrow">SEND → EXECUTE → RETURN</span><h3>Task travel path</h3></div><span class="route-stage">${task?esc(task.stage):'Ready to connect devices'}</span></div><div class="route-scene"><div class="route-node owner"><b>OWNER</b><span>HP Victus 16</span><small>${ownerShare}% local work</small></div>${workers.length?workers.map((w,i)=>`<div class="route-node worker w${i+1}"><b>${esc(w.name)}</b><span>${esc(w.assignment?.range||'Waiting')}</span><small>${w.assignment?.share||0}% share</small></div>`).join(''):`<div class="route-node placeholder"><b>No connected device</b><span>Connect another device to extend the swarm</span><small>Code • Link • QR</small></div>`}<svg class="route-svg" viewBox="0 0 980 260" preserveAspectRatio="none"><defs><linearGradient id="routeGrad" x1="0" x2="1"><stop stop-color="#7c3aed"/><stop offset="0.55" stop-color="#06b6d4"/><stop offset="1" stop-color="#22c55e"/></linearGradient></defs>${workers.length?workers.map((w,i)=>{const y=[55,105,155][i]||205; return `<path d="M220 130 Q 450 ${y} 710 ${y}" class="send-line"/><path d="M710 ${y} Q 520 226 220 156" class="return-line"/>`;}).join(''):`<path d="M220 130 Q 460 86 700 130" class="ghost-line"/>`}</svg>${workers.length?workers.map((w,i)=>{const top=[46,96,146][i]||196; return `<span class="travel-dot send d${i+1}"></span><span class="travel-dot return r${i+1}"></span><span class="range-badge b${i+1}">${esc(w.assignment?.range||'Pending split')}</span>`;}).join(''):''}</div><div class="route-legend"><span><i class="lg send"></i>Owner sends only assigned chunk</span><span><i class="lg exec"></i>Receiver executes highlighted range</span><span><i class="lg return"></i>Result returns and merges back to owner</span></div></div>`;
}

async function api(path, method="GET", body=null){
  const r = await fetch(path, {method, headers:{"Content-Type":"application/json"}, body: body ? JSON.stringify(body) : null});
  let j = {};
  try { j = await r.json(); } catch(_) {}
  if(!r.ok) throw new Error(j.error || `Request failed (${r.status})`);
  return j;
}

async function init(){
  DATA = await fetch("data.json", {cache:"no-store"}).then(r=>r.json());
  try { INFO = await api("/api/info"); } catch(_) {}
  applyWorkflowDefaults();
  render();
  startPolling();
}

function applyWorkflowDefaults(){
  const w = wf();
  if(!w.connectors.some(c=>c.id===state.selectedConnector)) state.selectedConnector = w.connectors[0].id;
  const c = conn();
  if(w.id==="video" && c.id==="davinci") state.builder.sourceLabel = "Hackathon_Final / Final_Edit";
  else if(w.id==="tests") state.builder.sourceLabel = "D:\\Projects\\PaymentApp";
  else if(w.id==="download") state.builder.sourceLabel = "https://demo.swarmos.local/Demo_4K_Video.mp4";
  else if(w.id==="photos") state.builder.sourceLabel = "Event_Photos / 300 images";
  else if(w.id==="ocr") state.builder.sourceLabel = "Research_Papers / 500 pages";
  else state.builder.sourceLabel = w.exampleTitle || "Selected workload";
}

function startPolling(){
  clearInterval(state.polling);
  state.polling = setInterval(refreshServer, 1100);
}

async function refreshServer(){
  try{
    const oldSeq = SERVER.notificationSeq || 0;
    const oldNames = new Set((SERVER.workers||[]).map(x=>x.name));
    const next = await api("/api/state");
    const arrivals = (next.workers||[]).filter(x=>!oldNames.has(x.name)).map(x=>x.name);
    SERVER = next;
    if(arrivals.length){
      state.newWorkerNames = [...new Set([...state.newWorkerNames,...arrivals])];
      setTimeout(()=>{state.newWorkerNames=state.newWorkerNames.filter(x=>!arrivals.includes(x)); if(state.loggedIn&&state.role==='owner') renderContentOnly();},5000);
    }
    const newOnes = relevantNotifications().filter(n => n.id > Math.max(oldSeq, state.lastSeenNotification));
    if(newOnes.length){
      newOnes.forEach(n=>browserNotify(n));
      const n = newOnes[newOnes.length-1];
      toast(`${n.title}: ${n.message}`);
      if(state.role==='worker'){
        const incoming=[...newOnes].reverse().find(x=>x.kind==='task' && /request/i.test(x.title+' '+x.message));
        if(incoming && incoming.id>state.lastAlertId){ state.lastAlertId=incoming.id; showIncomingOverlay(incoming); }
      } else {
        const important=[...newOnes].reverse().find(x=>x.id>state.lastOwnerOverlayId && (x.kind==='device'||/accepted|declined|completed/i.test(x.title+' '+x.message)));
        if(important){ state.lastOwnerOverlayId=important.id; showStatusOverlay(important.title,important.message,important.kind); }
      }
    }
    checkForCelebration();
    if(state.loggedIn && ["sender","receiver","active","devices","scheduler"].includes(state.page)) renderContentOnly();
    else updateBell();
  }catch(_){ /* static preview can still render */ }
}

function notificationTarget(){
  return state.role === "owner" ? "owner" : state.receiverName;
}
function relevantNotifications(){
  const target = notificationTarget();
  return (SERVER.notifications || []).filter(n => n.target === target || n.target === "all");
}
function unseenCount(){ return relevantNotifications().filter(n=>n.id > state.lastSeenNotification).length; }
function browserNotify(n){
  if("Notification" in window && Notification.permission === "granted"){
    try { new Notification(n.title, {body:n.message}); } catch(_) {}
  }
}
function markNotificationsSeen(){
  const arr = relevantNotifications();
  if(arr.length){
    state.lastSeenNotification = Math.max(...arr.map(n=>n.id));
    localStorage.setItem("swarmosLastNotification", String(state.lastSeenNotification));
  }
  updateBell();
}

function render(){
  if(!state.loggedIn){
    document.body.innerHTML = `<div id="app">${loginView()}</div><div id="toastRoot"></div>`;
    bindLogin();
    return;
  }
  document.body.innerHTML = `<div id="app">${shellView()}</div><div id="modalRoot"></div><div id="toastRoot"></div>`;
  bindShell();
}

function renderContentOnly(){
  const root = $("#pageContent");
  if(!root) return render();
  root.innerHTML = pageView();
  const title = $("#pageTitle"); if(title) title.textContent = pageTitle();
  updateBell();
  bindPage();
}

function pageTitle(){
  return ({home:"Dashboard",create:"Create Task",sender:"Sender Console",receiver:"Receiver Console",devices:"Devices",active:"Active Task",history:"History",scheduler:"AI Scheduler",settings:"Settings",photo:"Photo Intelligence"})[state.page] || "SwarmOS";
}

function loginView(){
  return `<div class="login-shell">
    <section class="login-brand">
      <div>
        <div class="brand-mark"><span>SW</span> SwarmOS</div>
        <div class="eyebrow light">Capability-aware orchestration</div>
        <h1>Turn nearby devices into one coordinated compute pool.</h1>
        <p>Owner controls the data. Workers control participation. SwarmOS sends only the assigned portion, runs compatible work in parallel and returns the result.</p>
      </div>
      <div class="login-flow"><span>UNDERSTAND</span><b>→</b><span>ALLOCATE</span><b>→</b><span>EXECUTE</span><b>→</b><span>MERGE</span></div>
    </section>
    <section class="login-panel">
      <form class="login-card" id="loginForm">
        <div class="eyebrow">Interactive Hackathon Prototype</div>
        <h2>Open SwarmOS</h2>
        <p class="muted">Choose an interface. You can switch between owner and receiver any time.</p>
        <div class="role-pick">
          <button type="button" class="role-card active" data-login-role="owner"><span>↑</span><b>Owner / Sender</b><small>Create and distribute work</small></button>
          <button type="button" class="role-card" data-login-role="worker"><span>↓</span><b>Worker / Receiver</b><small>Join and process assigned work</small></button>
        </div>
        <div class="field"><label>Email</label><input id="email" value="${esc(DATA.demoUser.email)}"></div>
        <div class="field"><label>Password</label><input id="password" type="password" value="${esc(DATA.demoUser.password)}"></div>
        <button class="btn wide">Enter Demo</button>
        <div class="demo-note">Demo login is pre-filled. This prototype uses the local Python server for sender/receiver state.</div>
      </form>
    </section>
  </div>`;
}

function bindLogin(){
  $$('[data-login-role]').forEach(b=>b.onclick=()=>{
    $$('[data-login-role]').forEach(x=>x.classList.remove('active')); b.classList.add('active');
    state.role=b.dataset.loginRole;
  });
  $("#loginForm").onsubmit=e=>{
    e.preventDefault(); state.loggedIn=true; state.page=state.role==='worker'?'receiver':'home'; render();
  };
}

function shellView(){
  const count = unseenCount();
  return `<div class="app-shell">
    <aside class="sidebar">
      <div class="side-brand"><div class="brand-cube">S</div><div><b>SwarmOS</b><span>ORCHESTRATOR</span></div></div>
      <nav class="nav">
        ${nav("home","⌂","Dashboard")}
        ${nav("create","＋","Create Task")}
        ${nav("sender","↑","Sender Console")}
        ${nav("receiver","↓","Receiver Console")}
        ${nav("active","◉","Active Task")}
        ${nav("devices","⌘","Devices")}
        ${nav("history","↺","History")}
        ${nav("scheduler","◇","AI Scheduler")}
        ${nav("settings","⚙","Settings")}
      </nav>
      <div class="side-bottom">
        <div class="server-dot"><i></i><span>Local orchestration server</span></div>
        <small>${esc(location.host || 'localhost:5173')}</small>
      </div>
    </aside>
    <main class="main">
      <header class="topbar">
        <div><div class="crumb">SWARMOS / ${state.role==='owner'?'OWNER':'WORKER'}</div><h2 id="pageTitle">${pageTitle()}</h2></div>
        <div class="top-actions">
          <button class="icon-btn" id="notifyPermission" title="Enable browser notifications">◌</button>
          <button class="bell-btn" id="bellBtn" title="Notifications">♢${count?`<span>${count}</span>`:''}</button>
          <button class="role-switch" id="roleSwitch">${state.role==='owner'?'Switch to Receiver':'Switch to Sender'}</button>
          <button class="avatar" id="logout">${state.role==='owner'?'VO':'IQ'}</button>
        </div>
      </header>
      ${notificationDrawer()}
      <section class="content" id="pageContent">${pageView()}</section>
    </main>
  </div>`;
}

function nav(id, icon, label){ return `<button data-page="${id}" class="${state.page===id?'active':''}"><span>${icon}</span>${label}</button>`; }

function notificationDrawer(){
  if(!state.notificationDrawer) return '';
  const arr = [...relevantNotifications()].reverse().slice(0,10);
  return `<div class="notification-drawer">
    <div class="flex between"><div><div class="eyebrow">Live notifications</div><h3>Device & task activity</h3></div><button class="icon-btn" id="closeNotifications">✕</button></div>
    ${arr.length?arr.map(n=>`<div class="notify-row"><div class="notify-icon">${n.kind==='task'?'↑':n.kind==='device'?'⌘':'•'}</div><div><b>${esc(n.title)}</b><p>${esc(n.message)}</p><span>${esc(n.time)}</span></div></div>`).join(''):`<div class="empty-mini">No notifications yet.</div>`}
  </div>`;
}

function pageView(){
  if(state.page==='create') return createTaskView();
  if(state.page==='sender') return senderView();
  if(state.page==='receiver') return receiverView();
  if(state.page==='devices') return devicesView();
  if(state.page==='active') return activeView();
  if(state.page==='history') return historyView();
  if(state.page==='scheduler') return schedulerView();
  if(state.page==='settings') return settingsView();
  if(state.page==='photo') return photoView();
  return homeView();
}


function selectedStaticDevices(){
  return DATA.devices.filter(d=>state.builder.selectedDevices.includes(d.id) && d.status==='Online');
}
function workloadCompatibility(d,w){
  const ex=(d.executors||[]).join(' ').toLowerCase();
  if(w.id==='video') return /media|davinci|ffmpeg/.test(ex);
  if(w.id==='tests') return /test/.test(ex);
  if(w.id==='download') return /download/.test(ex);
  if(w.id==='photos') return /photo/.test(ex);
  if(w.id==='ocr') return /ocr/.test(ex);
  if(w.id==='transcode') return /media|ffmpeg/.test(ex);
  if(w.id==='build') return d.type==='Laptop';
  if(w.id==='ai-batch') return d.gpuScore>=65;
  return true;
}
function suitability(d,w){
  const cpu=d.cpuScore||70, gpu=d.gpuScore||65, ram=Math.min(100,(d.ramGB||8)/32*100), net=Math.min(100,(d.networkMbps||0)/14), avail=100-(d.load||0), batt=d.type==='Laptop'?Math.max(70,d.battery||70):(d.battery||70), therm=Math.max(0,100-Math.max(0,(d.temperature||38)-32)*7);
  let score;
  if(w.id==='download') score=cpu*.08+gpu*.02+ram*.08+net*.48+avail*.12+batt*.10+therm*.12;
  else if(w.id==='tests'||w.id==='build') score=cpu*.38+gpu*.08+ram*.24+net*.10+avail*.12+batt*.06+therm*.02;
  else if(w.id==='video'||w.id==='transcode') score=cpu*.20+gpu*.34+ram*.17+net*.13+avail*.08+batt*.04+therm*.04;
  else if(w.id==='ai-batch'||w.id==='photos'||w.id==='ocr') score=cpu*.21+gpu*.28+ram*.17+net*.11+avail*.10+batt*.06+therm*.07;
  else score=cpu*.26+gpu*.14+ram*.22+net*.14+avail*.10+batt*.07+therm*.07;
  return Math.round(Math.max(1,Math.min(99,score)));
}
function fmtTime(sec){ sec=Math.max(0,Math.round(sec)); const m=Math.floor(sec/60), s=sec%60; return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`; }
function computedAllocation(w=wf()){
  let ds=selectedStaticDevices().filter(d=>workloadCompatibility(d,w));
  if(!ds.length){ const owner=DATA.devices.find(d=>d.id==='owner-laptop'); if(owner) ds=[owner]; }
  const scores=ds.map(d=>suitability(d,w));
  const total=scores.reduce((a,b)=>a+b,0)||1;
  let shares=scores.map(x=>Math.max(5,Math.round(x/total*100)));
  const sum=shares.reduce((a,b)=>a+b,0); shares[shares.length-1]+=100-sum;
  let cursor=0;
  return ds.map((d,i)=>{
    const share=shares[i], start=cursor, end=i===ds.length-1?100:cursor+share; cursor=end;
    const u=w.unit||{kind:'count',total:100,label:'100 items'};
    let range='Assigned subset', requiredData='Task-specific subset';
    if(u.kind==='time'){
      range=`${fmtTime(u.total*start/100)} → ${fmtTime(u.total*end/100)}`;
      requiredData=`Media for ${range}`;
    } else if(u.kind==='gb'){
      const a=(u.total*start/100).toFixed(1), b=(u.total*end/100).toFixed(1);
      range=`${a} → ${b} GB`; requiredData=`${(u.total*share/100).toFixed(1)} GB byte range`;
    } else {
      const a=Math.floor(u.total*start/100)+1, b=i===ds.length-1?u.total:Math.floor(u.total*end/100);
      const noun=w.id==='tests'?'Tests':w.id==='photos'?'Photos':w.id==='ocr'?'Pages':w.id==='build'?'Targets':w.id==='compression'?'Files':'Items';
      range=`${noun} ${String(a).padStart(3,'0')} → ${String(b).padStart(3,'0')}`; requiredData=`${Math.max(0,b-a+1)} assigned ${noun.toLowerCase()}`;
    }
    const reason=`Score ${scores[i]}/100 • ${d.cpu.split(' ').slice(0,4).join(' ')} • ${d.ram} RAM • ${d.load}% load • ${d.network}`;
    return {deviceId:d.id,device:d.name,range,share,score:scores[i],reason,requiredData};
  });
}
function computedLiveAllocation(w=wf()){
  const owner=DATA.devices.find(d=>d.id==='owner-laptop') || DATA.devices[0];
  const liveNames=new Set((SERVER.workers||[]).map(x=>x.name));
  const liveDevices=DATA.devices.filter(d=>liveNames.has(d.name) && d.status==='Online');
  let ds=[owner,...liveDevices.filter(d=>d.id!==owner.id)].filter((d,i,a)=>a.findIndex(x=>x.id===d.id)===i).filter(d=>workloadCompatibility(d,w));
  if(ds.length===1 && (SERVER.workers||[]).length){
    // Unknown receiver profile fallback: model it as a medium worker so the live flow still stays clear.
    const rw=(SERVER.workers||[])[0];
    ds.push({id:'live-worker',name:rw.name,type:/iqoo|phone/i.test(rw.name)?'Phone':'Laptop',cpu:rw.cpu||'Receiver CPU',gpu:rw.gpu||'Receiver GPU',ram:rw.ram||'8 GB',ramGB:parseInt(rw.ram)||8,battery:rw.battery||75,temperature:rw.temperature||37,network:rw.network||'Wi-Fi',networkMbps:780,load:22,cpuScore:76,gpuScore:72,status:'Online'});
  }
  const scores=ds.map(d=>suitability(d,w)); const total=scores.reduce((a,b)=>a+b,0)||1;
  let shares=scores.map(x=>Math.max(8,Math.round(x/total*100))); const sum=shares.reduce((a,b)=>a+b,0); shares[shares.length-1]+=100-sum;
  let cursor=0;
  return ds.map((d,i)=>{
    const share=shares[i], start=cursor, end=i===ds.length-1?100:cursor+share; cursor=end;
    const u=w.unit||{kind:'count',total:100,label:'100 items'}; let range='Assigned subset',requiredData='Task-specific subset';
    if(u.kind==='time'){range=`${fmtTime(u.total*start/100)} → ${fmtTime(u.total*end/100)}`;requiredData=`Media for ${range}`;}
    else if(u.kind==='gb'){const a=(u.total*start/100).toFixed(1),b=(u.total*end/100).toFixed(1);range=`${a} → ${b} GB`;requiredData=`${(u.total*share/100).toFixed(1)} GB byte range`;}
    else{const a=Math.floor(u.total*start/100)+1,b=i===ds.length-1?u.total:Math.floor(u.total*end/100);const noun=w.id==='tests'?'Tests':w.id==='photos'?'Photos':w.id==='ocr'?'Pages':w.id==='build'?'Targets':w.id==='compression'?'Files':'Items';range=`${noun} ${String(a).padStart(3,'0')} → ${String(b).padStart(3,'0')}`;requiredData=`${Math.max(0,b-a+1)} assigned ${noun.toLowerCase()}`;}
    return {deviceId:d.id,device:d.name,range,share,score:scores[i],reason:`Capability ${scores[i]}/100 • ${d.ram} RAM • ${d.load||0}% load • ${d.network}`,requiredData};
  });
}

function gauge(label,value,max,suffix,sub){
  const pct=Math.max(0,Math.min(100,Math.round(value/max*100)));
  return `<button class="gauge-card" data-toast="${esc(label)}: ${esc(value)}${esc(suffix)}"><div class="gauge" style="--pct:${pct}"><div><b>${esc(value)}</b><span>${esc(suffix)}</span></div></div><strong>${esc(label)}</strong><small>${esc(sub)}</small></button>`;
}
function radarSvg(d){
  const vals=[d.cpuScore||70,d.gpuScore||65,Math.min(100,(d.ramGB||8)/32*100),Math.min(100,(d.networkMbps||0)/14),100-(d.load||0)];
  const cx=110,cy=105,r=78,n=5;
  const pts=vals.map((v,i)=>{const a=-Math.PI/2+i*2*Math.PI/n;const rr=r*v/100;return `${(cx+Math.cos(a)*rr).toFixed(1)},${(cy+Math.sin(a)*rr).toFixed(1)}`}).join(' ');
  const ring=(scale)=>Array.from({length:n},(_,i)=>{const a=-Math.PI/2+i*2*Math.PI/n;return `${(cx+Math.cos(a)*r*scale).toFixed(1)},${(cy+Math.sin(a)*r*scale).toFixed(1)}`}).join(' ');
  return `<svg class="radar-svg" viewBox="0 0 220 220" aria-label="Capability radar"><polygon class="radar-ring" points="${ring(1)}"/><polygon class="radar-ring faint" points="${ring(.66)}"/><polygon class="radar-ring faint" points="${ring(.33)}"/><polygon class="radar-fill" points="${pts}"/><text x="110" y="14">CPU</text><text x="194" y="76">GPU</text><text x="166" y="196">RAM</text><text x="28" y="196">NET</text><text x="8" y="76">LOAD</text></svg>`;
}
function deviceSelectionPanel(w){
  const cards=DATA.devices.map(d=>{
    const comp=workloadCompatibility(d,w), sel=state.builder.selectedDevices.includes(d.id), score=suitability(d,w);
    return `<button class="agent-device ${sel?'selected':''} ${!comp||d.status!=='Online'?'ineligible':''}" data-toggle-device="${d.id}" ${d.status!=='Online'?'disabled':''}><div class="flex between"><span class="device-chip ${d.type==='Phone'?'phone':'laptop'}">${d.type==='Phone'?'M':'PC'}</span><span class="agent-score">${comp?score:'—'}</span></div><b>${esc(d.name)}</b><small>${esc(d.cpu)}</small><div class="agent-specs"><span>${esc(d.ram)} RAM</span><span>${esc(d.gpu)}</span><span>${d.load}% load</span><span>${esc(d.network)}</span></div><div class="eligibility ${comp?'yes':'no'}">${d.status!=='Online'?'OFFLINE':comp?(sel?'SELECTED BY AGENT':'AVAILABLE'):'INCOMPATIBLE'}</div></button>`;
  }).join('');
  return `<div class="agent-selection"><div class="agent-selection-head"><div><b>◇ Utility Agent Device Selection</b><span>Scores CPU/GPU, RAM, current load, network, battery, thermals and executor compatibility.</span></div><button class="btn secondary" id="autoSelectDevices">Auto-select compatible</button></div><div class="agent-device-grid">${cards}</div><div class="agent-note"><span>AGENT RULE</span><b>Higher-capability devices receive more work; selected devices are rebalanced to finish at nearly the same time.</b></div></div>`;
}
function connectorBrand(id){
  const map={davinci:'violet',premiere:'purple','media-encoder':'blue',finalcut:'cyan',capcut:'ink','generic-video':'orange',github:'ink',gitlab:'orange',bitbucket:'blue','google-drive':'green','drive-project':'green','photo-drive':'green','ocr-drive':'green','data-drive':'green','media-drive':'green','zip-drive':'green',onedrive:'blue','photo-onedrive':'blue','ocr-onedrive':'blue','zip-onedrive':'blue',dropbox:'cyan','photo-dropbox':'cyan','ocr-dropbox':'cyan','zip-dropbox':'cyan',s3:'orange','data-s3':'orange','ai-s3':'orange'};
  return map[id]||'gradient';
}
function homeView(){
  const online = DATA.devices.filter(d=>d.status==='Online').length + (SERVER.workers||[]).length;
  const hp=DATA.devices.find(d=>d.id==='owner-laptop'), tuf=DATA.devices.find(d=>d.id==='worker-laptop'), iq=DATA.devices.find(d=>d.id==='iqoo-phone');
  return `<section class="welcome-hero">
    <div class="hero-copy colorful">
      <div class="hero-label-row"><span class="live-label"><i></i> SWARM FABRIC ONLINE</span><span class="hackathon-badge">iQOO HACKATHON DEMO</span></div>
      <h1>Welcome to <em>SwarmOS</em></h1>
      <p class="hero-lead">Turn laptops and phones into one coordinated compute pool. The agent reads every device, chooses compatible workers, calculates the split and keeps both sender and receiver informed.</p>
      <div class="hero-badges"><span>AI allocation</span><span>Live device approval</span><span>Minimum data transfer</span><span>Automatic merge</span></div>
      <div class="btn-row"><button class="btn glow" data-page="create">＋ Create a Swarm Task</button><button class="btn glass" data-page="sender">Open Sender Console</button></div>
    </div>
    <div class="hero-3d" aria-hidden="true">
      <div class="aurora a1"></div><div class="aurora a2"></div><div class="aurora a3"></div>
      <div class="iqoo-phone-3d"><div class="phone-cam"></div><div class="phone-screen"><span>iQOO</span><b>SwarmOS</b><small>DISTRIBUTED COMPUTE</small></div></div><div class="swarm-core"><div class="core-ring r1"></div><div class="core-ring r2"></div><div class="core-orb">S</div></div>
      <div class="float-device fd1"><span>HP</span><b>Victus 16</b><small>Ryzen 7 • RTX</small></div>
      <div class="float-device fd2"><span>AS</span><b>ASUS TUF</b><small>i7 • RTX 4060</small></div>
      <div class="float-device fd3"><span>IQ</span><b>iQOO Turbo</b><small>Dimensity • NPU</small></div>
      <svg viewBox="0 0 560 390"><path d="M280 190 C180 120 128 92 84 72"/><path d="M280 190 C382 118 425 94 480 76"/><path d="M280 190 C370 250 408 300 468 320"/></svg>
    </div>
  </section>
  <div class="metric-strip color-metrics"><div><b>${online}</b><span>devices visible</span></div><div><b>32 GB</b><span>highest RAM</span></div><div><b>12%</b><span>lowest load</span></div><div><b>1.34 Gbps</b><span>fastest link</span></div></div>
  <div class="section-head"><div><span class="eyebrow">LIVE TELEMETRY</span><h3>Network & compute pulse</h3></div><button class="text-btn" data-page="devices">Open device fabric →</button></div>
  <div class="telemetry-showcase">
    ${gauge('Victus network',hp.networkMbps,1500,' Mbps','HP Victus 16')}
    ${gauge('TUF network',tuf.networkMbps,1500,' Mbps','ASUS TUF Gaming F15')}
    ${gauge('iQOO network',iq.networkMbps,1500,' Mbps','iQOO Z10 Turbo')}
    <button class="throughput-card" data-page="scheduler"><div class="flex between"><div><span class="eyebrow">PREDICTED THROUGHPUT</span><b>3.04× aggregate</b></div><span class="trend-pill">+62%</span></div><svg viewBox="0 0 320 90"><defs><linearGradient id="linegrad" x1="0" x2="1"><stop stop-color="#7c3aed"/><stop offset=".5" stop-color="#06b6d4"/><stop offset="1" stop-color="#22c55e"/></linearGradient></defs><path class="spark-area" d="M0 82 C40 72 55 76 86 56 S144 61 173 38 S226 45 252 22 S296 25 320 8 L320 90 L0 90Z"/><path class="spark-line" d="M0 82 C40 72 55 76 86 56 S144 61 173 38 S226 45 252 22 S296 25 320 8"/></svg><small>Transfer + execution model across selected workers</small></button>
  </div>
  <div class="section-head"><div><span class="eyebrow">OPERATIONS</span><h3>Build the task you want to distribute</h3></div><button class="text-btn" data-page="create">See every operation & connector →</button></div>
  <div class="workflow-grid">${workflowCards('supported')}</div>
  <div class="section-head"><div><span class="eyebrow">FUTURE SURFACE</span><h3>Already designed inside the product</h3></div></div>
  <div class="future-ribbon">${DATA.workflows.filter(w=>w.group==='future').map(w=>`<button data-select-workflow="${w.id}"><span>${esc(w.icon)}</span><b>${esc(w.name)}</b><small>Clickable preview</small></button>`).join('')}</div>`;
}

function workflowCards(group){
  return DATA.workflows.filter(w=>w.group===group).map(w=>`<button class="workflow-card ${group==='future'?'future':''}" data-select-workflow="${w.id}">
    <div class="workflow-card-top"><span class="workflow-icon">${esc(w.icon)}</span><span class="status-tag ${group==='supported'?'supported':'future'}">${esc(w.badge)}</span></div>
    <h3>${esc(w.name)}</h3><p>${esc(w.summary)}</p>
    <div class="workflow-meta"><span>${esc(w.exampleTitle)}</span><b>${group==='supported'?'Configure →':'Preview →'}</b></div>
  </button>`).join('');
}

function createTaskView(){
  const w=wf(), c=conn(), alloc=computedAllocation(w);
  return `<div class="builder-shell">
    <section class="builder-main">
      <div class="builder-hero colorful-builder"><div><span class="eyebrow">CREATE TASK</span><h2>${esc(w.name)}</h2><p>Pick the operation, choose where the data comes from, set limits, choose eligible devices and watch the agent recalculate the split.</p></div><div class="builder-progress"><span class="done">1</span><i></i><span class="done">2</span><i></i><span class="done">3</span><i></i><span class="done">4</span><i></i><span>5</span></div></div>

      <div class="section-head compact"><div><span class="step-label">STEP 1</span><h3>Choose operation</h3></div><span class="muted small">Supported + future product surfaces are all clickable.</span></div>
      <div class="workflow-tabs rich-tabs">${DATA.workflows.map(x=>`<button class="workflow-tab ${x.id===w.id?'active':''}" data-quick-workflow="${x.id}"><span>${esc(x.icon)}</span><b>${esc(x.name)}</b><small>${x.group==='supported'?'LIVE DEMO':'FUTURE'}</small></button>`).join('')}</div>

      <div class="section-head compact"><div><span class="step-label">STEP 2</span><h3>${w.id==='video'?'Choose editing software / source':'Connect source'}</h3></div><span class="muted small">GitHub, Drive, cloud storage and editor integrations stay under the operation they belong to.</span></div>
      <div class="connector-grid rich-connectors">${w.connectors.map(x=>connectorCard(x,c.id)).join('')}</div>
      ${sourcePanel(w,c)}

      <div class="section-head compact"><div><span class="step-label">STEP 3</span><h3>Advanced execution policy</h3></div><span class="muted small">Tune speed, privacy, network and worker safety.</span></div>
      ${advancedOptions(w)}

      <div class="section-head compact"><div><span class="step-label">STEP 4</span><h3>Select compute devices</h3></div><span class="muted small">The agent uses processor, GPU/NPU, RAM, load, network and thermal state.</span></div>
      ${deviceSelectionPanel(w)}

      <div class="section-head compact"><div><span class="step-label">STEP 5</span><h3>AI split preview</h3></div><span class="muted small">Recalculates immediately when you add/remove a device.</span></div>
      ${allocationPreview(w)}
    </section>
    <aside class="builder-summary"><div class="sticky-card colorful-summary"><span class="eyebrow">TASK SUMMARY</span><h3>${esc(w.name)}</h3><div class="summary-row"><span>Source</span><b>${esc(c.name)}</b></div><div class="summary-row"><span>Status</span><b class="${c.enabled?'good':'amber'}">${esc(c.status)}</b></div><div class="summary-row"><span>Input</span><b>${esc(state.builder.sourceLabel)}</b></div><div class="summary-row"><span>Workers</span><b>${alloc.length} selected</b></div><div class="summary-row"><span>Objective</span><b>${esc(state.builder.objective)}</b></div><div class="summary-row"><span>Privacy</span><b>${esc(state.builder.privacy)}</b></div><div class="summary-row"><span>Predicted time</span><b>${esc(w.distributedEstimate)}</b></div><div class="saving-box"><span>EXPECTED SAVING</span><b>${esc(w.saving)}</b><small>vs ${esc(w.localEstimate)} local estimate</small></div><button class="btn wide glow" id="continueSender" ${!c.enabled?'disabled':''}>Continue to Sender Console →</button>${!c.enabled?`<div class="future-warning">${esc(c.name)} is a clickable roadmap integration. It is visible in the product but not eligible for the supported hackathon execution path.</div>`:''}</div></aside>
  </div>`;
}

function connectorCard(x,selected){
  return `<button class="connector-card ${x.id===selected?'active':''} ${!x.enabled?'disabled-future':''}" data-connector="${x.id}" data-brand="${connectorBrand(x.id)}"><div class="connector-icon brand-${connectorBrand(x.id)}">${brandLogo(x.id,x.name,'connector-logo')}</div><div class="connector-copy"><b>${esc(x.name)}</b><span>${esc(x.description)}</span></div><div class="connector-status ${x.enabled?'good':'future'}">${esc(x.status)}</div></button>`;
}

function sourcePanel(w,c){
  if(!c.enabled){
    return `<div class="source-panel future-panel colorful-future"><div class="future-big"><span>${esc(c.icon)}</span>ROADMAP CONNECTOR</div><div><span class="eyebrow">${esc(w.name)}</span><h3>${esc(c.name)}</h3><p>${esc(c.description)}</p><div class="planned-chips"><span>Secure authentication</span><span>Selected-file access</span><span>Task manifest</span><span>Minimum transfer</span></div><div class="btn-row"><button class="btn secondary" data-roadmap="${esc(c.name)}">Open integration blueprint</button><button class="btn ghost-color" data-toast="${esc(c.name)} preview selected — not eligible for live execution yet.">Simulate selection</button></div></div></div>`;
  }
  if(w.id==='video'){
    return `<div class="source-panel connected-panel"><div class="source-panel-head"><div><span class="eyebrow">CONNECTED EDITOR</span><h3>${esc(c.name)}</h3></div><span class="connection-ok"><i></i> LIVE METADATA</span></div><div class="form-grid four">${fieldView('Project','Hackathon_Final')}${fieldView('Timeline','Final_Edit')}${fieldView('Duration','30:00')}${fieldView('Resolution','3840 × 2160')}${fieldView('Frame rate','60 FPS')}${fieldView('Target codec','H.264')}${fieldView('Quality','4K High')}${fieldView('Output','Final_Export.mp4')}</div><div class="upload-zone" id="uploadZone"><div class="upload-icon">＋</div><div><b>Add supporting media / project package</b><span>Select sample files. The visual upload tray shows exactly what would be staged for the selected timeline chunks.</span></div><button class="btn secondary" type="button" id="pickFiles">Choose files</button><input id="filePicker" type="file" multiple hidden></div>${filePreview()}<div class="upload-pipeline"><span class="done">Read timeline</span><i>→</i><span class="done">Map media</span><i>→</i><span>Split ranges</span><i>→</i><span>Send assigned media</span></div></div>`;
  }
  if(w.id==='tests'){
    return `<div class="source-panel connected-panel"><div class="source-panel-head"><div><span class="eyebrow">PROJECT INTAKE</span><h3>${esc(c.name)}</h3></div><span class="connection-ok"><i></i> DETECTOR READY</span></div><div class="upload-zone" id="uploadZone"><div class="upload-icon">⌂</div><div><b>Select project folder</b><span>Detector looks for pytest.ini, requirements.txt, package.json, build.gradle, src/test and similar clues.</span></div><button class="btn secondary" id="pickFiles">Browse project</button><input id="filePicker" type="file" multiple webkitdirectory hidden></div><div class="detector-strip"><div><span>PROJECT</span><b>PaymentApp</b></div><div><span>RUNNER</span><b>Python + pytest</b></div><div><span>TEST IDS</span><b>600 discovered</b></div><div><span>PROJECT SIZE</span><b>5 GB</b></div></div>${filePreview()}<div class="upload-pipeline"><span class="done">Scan structure</span><i>→</i><span class="done">Detect runner</span><i>→</i><span>Discover tests</span><i>→</i><span>Package dependencies</span></div></div>`;
  }
  return `<div class="source-panel connected-panel"><div class="source-panel-head"><div><span class="eyebrow">REMOTE SOURCE</span><h3>${esc(c.name)}</h3></div><span class="connection-ok"><i></i> RANGE CHECK READY</span></div><div class="url-row"><div class="field grow"><label>File URL</label><input id="sourceUrl" value="${esc(state.builder.sourceLabel)}"></div><button class="btn" id="inspectUrl">Inspect source</button></div><div class="detector-strip"><div><span>FILE</span><b>Demo_4K_Video.mp4</b></div><div><span>SIZE</span><b>6 GB</b></div><div><span>RANGE SUPPORT</span><b>Yes</b></div><div><span>MERGE</span><b>HP Victus 16</b></div></div><div class="upload-pipeline"><span class="done">Inspect headers</span><i>→</i><span class="done">Confirm ranges</span><i>→</i><span>Assign bytes</span><i>→</i><span>Parallel download</span></div></div>`;
}

function fieldView(label,value){ return `<div class="field mini"><label>${esc(label)}</label><input value="${esc(value)}"></div>`; }
function filePreview(){
  const files = state.builder.fileNames;
  if(!files.length) return `<div class="upload-preview muted">No optional files selected.</div>`;
  return `<div class="file-chip-row">${files.slice(0,8).map((x,i)=>`<button class="file-chip" data-file-chip="${i}"><span>▧</span>${esc(x)}<i>×</i></button>`).join('')}${files.length>8?`<span class="file-more">+${files.length-8} more</span>`:''}</div>`;
}

function advancedOptions(w){
  return `<div class="advanced-grid">
    <div class="option-card"><span class="eyebrow">SCHEDULING OBJECTIVE</span><div class="segmented">${['Fastest finish','Balanced','Battery saver'].map(x=>`<button data-objective="${x}" class="${state.builder.objective===x?'active':''}">${x}</button>`).join('')}</div><p>Changes the resource penalty used by the scheduler.</p></div>
    <div class="option-card"><span class="eyebrow">DATA ACCESS</span><div class="segmented">${['Task-only data','Encrypted temp cache'].map(x=>`<button data-privacy="${x}" class="${state.builder.privacy===x?'active':''}">${x}</button>`).join('')}</div><label class="toggle-row"><span>Delete temporary worker data after success</span><input type="checkbox" id="deleteTemp" ${state.builder.deleteTemp?'checked':''}><i></i></label></div>
    <div class="option-card"><span class="eyebrow">NETWORK POLICY</span><div class="segmented">${['Prefer fastest available','Local network only'].map(x=>`<button data-network="${x}" class="${state.builder.network===x?'active':''}">${x}</button>`).join('')}</div><label class="toggle-row"><span>Wi-Fi only for mobile workers</span><input type="checkbox" id="wifiOnly" ${state.builder.wifiOnly?'checked':''}><i></i></label></div>
    <div class="option-card"><span class="eyebrow">WORKER LIMITS</span><div class="limit-grid"><label>Min battery<input id="minBattery" type="number" min="10" max="90" value="${state.builder.minBattery}"></label><label>Max temp °C<input id="maxTemp" type="number" min="35" max="55" value="${state.builder.maxTemp}"></label><label>Max temp storage GB<input id="maxStorage" type="number" min="1" max="50" value="${state.builder.maxStorage}"></label></div><label class="toggle-row"><span>Allow compatible mobile workers</span><input type="checkbox" id="allowMobile" ${state.builder.allowMobile?'checked':''}><i></i></label></div>
  </div>`;
}

function allocationPreview(w){
  const alloc=computedAllocation(w), chosen=selectedStaticDevices().filter(d=>workloadCompatibility(d,w));
  return `<div class="allocation-panel colorful-allocation"><div class="allocation-head"><div><b>◇ Agent-generated distribution</b><span>${chosen.length} compatible selected device(s) • live resource-weighted split</span></div><span class="ai-pill">UTILITY AGENT ACTIVE</span></div><div class="agent-reason-strip"><div><span>01</span><b>Filter</b><small>runtime + battery + thermal</small></div><i>→</i><div><span>02</span><b>Score</b><small>CPU/GPU + RAM + network</small></div><i>→</i><div><span>03</span><b>Split</b><small>weighted workload share</small></div><i>→</i><div><span>04</span><b>Balance ETA</b><small>avoid slowest-worker tail</small></div></div>${alloc.map((a,i)=>{const d=DATA.devices.find(x=>x.id===a.deviceId);return `<div class="alloc-row enhanced"><div class="alloc-device"><span class="device-avatar gradient-avatar">${d?.type==='Phone'?'IQ':i===0?'HP':'AS'}</span><div><b>${esc(a.device)}</b><small>${esc(a.range)}</small><em>${esc(d?.cpu||'')} • ${esc(d?.ram||'')} RAM</em></div></div><div><div class="alloc-track"><span style="width:${a.share}%"></span></div><small>${esc(a.reason)}</small></div><div class="share-num"><b>${a.share}%</b><span>score ${a.score}</span></div></div>`}).join('')}<div class="cost-line"><span>Estimated total cost</span><code>transfer + execution + result return + merge/setup + resource penalty</code></div></div>`;
}

function senderView(){
  const w=wf(), c=conn(), session=SERVER.session, workers=SERVER.workers||[], task=SERVER.task;
  const joinPayload = session ? `${INFO.lanUrl || location.origin}|${session.code}` : 'Create a session to generate QR';
  const completed = task && task.status==='Completed';
  return `<div class="sender-top clean-sender"><div class="sender-title"><span class="eyebrow">OWNER / SENDER</span><h2>Simple flow: create work → connect devices → send request → accept → run → return → merge.</h2><p>The owner keeps the local share. Each new receiver joins one by one, appears in the live swarm, gets a highlighted range and returns the result back to the owner path.</p></div><div class="session-panel ${session?'live':''}"><span class="eyebrow">LIVE SESSION</span>${session?`<div class="session-code">${esc(session.code)}</div><div class="join-method-grid compact-join"><div class="join-method-card"><span>Join code</span><b>${esc(session.code)}</b><small>Receiver types this code</small></div><div class="join-method-card"><span>Invite link</span><b>${esc(INFO.lanUrl || location.origin)}</b><small>Use on same Wi‑Fi</small></div><div class="join-method-card"><span>Owner ID</span><b>OWN-HPV-1601</b><small>Visible owner identity</small></div>${qrMatrix(joinPayload)}</div><div class="session-actions"><button class="btn secondary" id="copyInvite">Copy Invite</button><button class="btn secondary" id="openReceiver">Connect another device</button></div>`:`<h3>No session yet</h3><p>Create a sender session first. Then connect one device, then second, then third.</p><button class="btn glow" id="createSession">Create Sender Session</button>`}</div></div>
  ${taskPath(task)}
  ${session?`<div class="section-head"><div><span class="eyebrow">LIVE SWARM</span><h3>Devices join here one by one</h3></div><span class="muted small">New arrivals animate for 5 seconds</span></div>${swarmMesh(workers,task)}<div class="sender-discovery-card"><div class="discovery-left"><span class="eyebrow">DEVICE DISCOVERY</span><h3>${workers.length?`${workers.length} receiver${workers.length===1?'':'s'} connected`:'No connected device'}</h3><p>${workers.length?'You can still connect another device. It will appear in the swarm automatically.':'Start by connecting a receiver using code, invite link or QR-style preview.'}</p></div><div class="discovery-radar ${workers.length?'active':''}"><i></i><i></i><b>${workers.length||0}</b></div><div class="discovery-right"><button class="btn secondary" id="openReceiver2">Connect through code / link / QR</button><small>${workers.length?'You can add a 2nd or 3rd device any time.':'Radar keeps searching until a device joins.'}</small></div></div>`:''}
  ${routeFlow(task, workers)}
  <div class="sender-clean-grid"><section class="card command-card color-card"><div class="flex between"><div><span class="eyebrow">CURRENT WORK</span><h3>${esc(w.name)}</h3></div><button class="text-btn" data-page="create">Change operation →</button></div><div class="task-source"><div class="connector-icon brand-${connectorBrand(c.id)}">${brandLogo(c.id,c.name,'connector-logo')}</div><div><b>${esc(c.name)}</b><span>${esc(state.builder.sourceLabel)}</span></div><span class="status-tag ${c.enabled?'supported':'future'}">${esc(c.status)}</span></div><div class="mini-grid"><div><span>Owner device</span><b>HP Victus 16</b></div><div><span>Objective</span><b>${esc(state.builder.objective)}</b></div><div><span>Total predicted</span><b>${esc(w.distributedEstimate)}</b></div><div><span>Expected saving</span><b>${esc(w.saving)}</b></div></div><div class="sender-action-explain"><span>1</span><p><b>Create task.</b> Owner prepares the local share and waits for additional devices.</p><span>2</span><p><b>Connect receivers.</b> Each device appears in the radar + live swarm with hardware details.</p><span>3</span><p><b>Send request.</b> Receiver gets a large 5-second request alert, accepts, then SwarmOS auto-runs and returns the result.</p></div><div class="btn-row"><button class="btn glow big-action" id="sendRequests" ${!session||!c.enabled||!workers.length?'disabled':''}>${task&&task.status==='Awaiting approval'?'Resend Request':'Send Work Request'}</button>${task&&task.status==='Active'?`<button class="btn secondary" data-page="active">Open Live Execution</button>`:''}${completed?`<button class="btn secondary" id="readyNextTask">Ready for next task</button>`:''}</div>${!workers.length&&session?`<div class="inline-hint">No receiver connected yet. Use “Connect through code / link / QR”.</div>`:''}</section>
  <section class="card receiver-list-card"><div class="flex between"><div><span class="eyebrow">CONNECTED RECEIVERS</span><h3>${workers.length?`${workers.length} device${workers.length===1?'':'s'} connected`:'Waiting for devices'}</h3></div><span class="count-pill">${workers.length}</span></div>${workers.length?workers.map(workerRow).join(''):`<div class="empty-state"><div>⌁</div><b>No receivers connected</b><p>Open Receiver Console, enter the join code, and the device appears here immediately.</p>${session?`<button class="btn secondary" id="openReceiver3">Open Receiver Window</button>`:''}</div>`}${workers.length?`<div class="add-worker-strip"><button class="btn secondary" id="openReceiver4">+ Connect another device</button><small>Supports 1st, 2nd and 3rd device connections one by one.</small></div>`:''}</section></div>
  ${task?`<div class="section-head"><div><span class="eyebrow">WHO IS DOING WHAT?</span><h3>Owner + receiver distribution</h3></div></div>${distributionBoard(task,workers)}${senderTaskStatus(task,workers)}`:''}
  ${completed?`<div class="completed-side"><div class="completed-side-card"><div class="completed-check">✓</div><div><span class="eyebrow">COMPLETED</span><h3>${esc(task.name)} is finished</h3><p>Returned and merged successfully. You are now ready for another task.</p></div><button class="btn glow" id="readyNextTask2">Clear completed task</button></div></div>`:''}
  <div class="section-head"><div><span class="eyebrow">ACTIVITY</span><h3>Session log</h3></div></div><div class="card activity">${(SERVER.events||[]).length?SERVER.events.map(e=>`<div class="activity-row"><span>${esc(e.time||'')}</span><b>${esc(e.message||e)}</b></div>`).join(''):`<div class="empty-mini">Create a session to begin the live log.</div>`}</div>`;
}

function workerRow(x){
  const a=x.assignment; const fresh=state.newWorkerNames.includes(x.name);
  return `<div class="worker-row ${fresh?'new-device-arrival':''}"><div class="worker-ident">${deviceBrandLogo(x.name,'worker-brand')}<div><b>${esc(x.name)}</b><span>${esc(x.cpu||'')} • ${esc(x.ram)} RAM</span><small>${esc(x.gpu||'')} • ${esc(x.network)}</small></div></div><div class="worker-health"><span>${x.battery}% battery</span><span>${x.temperature}°C</span></div><div class="decision ${x.decision.toLowerCase()}">${esc(x.decision)}</div>${a?`<small class="assignment-pill">${esc(a.range||'')}</small><small class="contribution-pill">${esc(workerContribution(a))}</small>`:''}${fresh?'<span class="just-joined">NEW DEVICE</span>':''}</div>`;
}

function senderTaskStatus(task,workers){
  const accepted=workers.filter(x=>x.decision==='Accepted').length, waiting=workers.filter(x=>x.decision==='Waiting').length, declined=workers.filter(x=>x.decision==='Declined').length;
  const message=task.status==='Awaiting approval'?'Request sent. Owner is waiting for receiver approvals.':task.status==='Active'?'Approved devices are executing. Owner share and receiver shares are progressing together.':task.status==='Completed'?'All result chunks returned to owner and merged.':'Ready';
  return `<div class="section-head"><div><span class="eyebrow">EXECUTION STATUS</span><h3>${esc(task.name)}</h3></div><span class="status-tag supported">${esc(task.status)}</span></div><div class="live-task-card clear-live ${task.status==='Completed'?'completed-live':''}"><div class="live-task-main"><div class="status-explanation"><b>${esc(task.stage)}</b><span>${esc(message)}</span></div><div class="flex between"><strong>Overall work</strong><span>${task.progress}%</span></div><div class="progress large"><span style="width:${task.progress}%"></span></div><div class="live-stats"><div><span>Owner share</span><b>${task.ownerProgress||0}%</b></div><div><span>Accepted</span><b>${accepted}</b></div><div><span>Waiting</span><b>${waiting}</b></div><div><span>Predicted finish</span><b>${esc(task.eta)}</b></div></div></div><div class="stage-stack"><span class="${task?'on':''}">01 Request</span><span class="${accepted||task.status==='Completed'?'on':''}">02 Approval</span><span class="${task.status==='Active'||task.status==='Completed'?'on':''}">03 Auto start</span><span class="${task.progress>=25?'on':''}">04 Execute</span><span class="${task.progress>=82?'on':''}">05 Return</span><span class="${task.progress>=100?'on':''}">06 Merge</span></div></div>`;
}

function receiverView(){
  const session=SERVER.session, worker=(SERVER.workers||[]).find(x=>x.name===state.receiverName), task=SERVER.task;
  const profile=DATA.receiverProfiles.find(x=>x.id===state.receiverProfile)||DATA.receiverProfiles[0];
  const appId = appIdForProfile(profile.id, profile.name);
  const token = workerToken(profile.name);
  if(!session || !worker){
    return `<div class="receiver-entry"><section class="receiver-intro colorful-receiver"><span class="eyebrow light">WORKER / RECEIVER</span><h2>Ready to receive a SwarmOS request.</h2><p>Choose the real device profile, join the sender session, then keep this screen open. When the owner sends work, a large alert appears before any data is transferred.</p><div class="privacy-points"><span>✓ Task-specific data only</span><span>✓ Explicit accept / decline</span><span>✓ Live battery + thermal visibility</span><span>✓ Completion celebration</span></div><div class="receiver-rings"><i></i><i></i><b>RX</b></div></section><section class="join-card"><span class="eyebrow">JOIN SWARM</span><h3>Connect this device</h3><div class="id-strip"><div><span>App ID</span><b>${esc(appId)}</b></div><div><span>Device token</span><b>${esc(token)}</b></div></div><div class="field"><label>Session code</label><input id="joinCode" value="${session?esc(session.code):''}" placeholder="SWARM-1234"></div><div class="field"><label>Device profile</label><select id="receiverProfile">${DATA.receiverProfiles.map(p=>`<option value="${p.id}" ${p.id===state.receiverProfile?'selected':''}>${esc(p.name)}</option>`).join('')}</select></div><div class="device-profile-preview"><b>${esc(profile.name)}</b><span>${esc(profile.cpu)}</span><small>${esc(profile.gpu)}</small></div><div class="telemetry-grid"><div><span>RAM</span><b>${esc(profile.ram)}</b></div><div><span>Battery</span><b>${profile.battery}%</b></div><div><span>Temp</span><b>${profile.temperature}°C</b></div><div><span>Network</span><b>${esc(profile.network.split('•')[0])}</b></div></div><button class="btn wide glow" id="joinSession" ${session?'':'disabled'}>Join Sender Session</button>${session?'':`<div class="future-warning">No sender session exists yet. Create one from Sender Console first.</div>`}<button class="text-btn wide-link" id="enableNotifications">Enable browser/device notifications</button></section></div>`;
  }
  return `<div class="receiver-dashboard"><section class="receiver-device-card colorful-receiver-card"><div><span class="eyebrow light">CONNECTED WORKER</span><h2>${esc(worker.name)}</h2><p>${esc(worker.cpu)} • ${esc(worker.gpu)}</p><small>Connected to ${esc(session.owner)} • ${esc(session.code)}</small></div><div class="receiver-signal"><i></i><span>ONLINE</span></div><div class="telemetry-dark"><div><span>App ID</span><b>${esc(appId)}</b></div><div><span>Battery</span><b>${worker.battery}%</b></div><div><span>Temperature</span><b>${worker.temperature}°C</b></div><div><span>RAM</span><b>${esc(worker.ram)}</b></div><div><span>Network</span><b>${esc(worker.network)}</b></div></div><div class="btn-row"><button class="btn inverse" id="enableNotifications">Enable notifications</button><button class="btn dark-outline" id="leaveSession">Leave</button></div></section><section>${!task?receiverWaiting():receiverTask(task,worker)}</section></div>`;
}
function receiverWaiting(){
  return `<div class="waiting-card colorful-waiting"><div class="pulse-ring colorful-pulse"><span></span></div><span class="eyebrow">STANDING BY</span><h3>Waiting for a task request...</h3><p>When the sender presses <b>Send Request + Alert Devices</b>, this receiver gets a full-screen alert and a notification entry.</p><div class="receiver-clear-path"><div><b>1. Join by code / link</b><span>Use the sender’s session code or invite link.</span></div><div><b>2. Receive big alert</b><span>An attractive task request overlay appears on this screen.</span></div><div><b>3. Review contribution</b><span>You see exactly how much work this device will handle.</span></div></div><div class="scope-grid"><div><b>Nothing transferred yet</b><span>No project, video or file data has been sent.</span></div><div><b>Approval required</b><span>You will see exact scope and agent allocation before transfer begins.</span></div></div></div>`;
}
function receiverTask(task,worker){
  const a=worker.assignment||{};
  const contribution = a.share || 0;
  const contribCard = `<div class="contribution-card"><div><span>DEVICE CONTRIBUTION</span><b>${contribution}% of total work</b><small>${esc(a.range||'Assigned chunk')}</small></div><div class="contribution-bar"><i style="width:${contribution}%"></i></div></div>`;
  if(task.status==='Awaiting approval'){
    if(worker.decision==='Declined') return `<div class="incoming-task declined-box"><span class="eyebrow">REQUEST DECLINED</span><h3>${esc(task.name)}</h3><p>No task data is transferred to this device. The owner can reassign the work.</p>${contribCard}<button class="btn secondary" data-decision="Accepted">Change to Accept</button></div>`;
    if(worker.decision==='Accepted') return `<div class="incoming-task accepted-box"><span class="eyebrow">APPROVED</span><h3>Ready for ${esc(task.name)}</h3><p>Your assigned scope is approved. Work starts automatically after the approval round is complete.</p>${contribCard}${assignmentDetails(task,a)}<div class="receiver-clear-path compact"><div><b>Next</b><span>SwarmOS auto-starts when approvals are complete.</span></div><div><b>Then</b><span>Your device receives only the assigned subset.</span></div><div><b>Finally</b><span>Result returns automatically.</span></div></div><button class="btn secondary" data-decision="Declined">Withdraw approval</button></div>`;
    return `<div class="incoming-task alerting"><div class="incoming-alert big"><span>🔔 BIG TASK REQUEST</span><i>Requires your approval</i></div><h2>${esc(task.name)}</h2><p>${esc(task.sourceLabel)}</p>${contribCard}${assignmentDetails(task,a)}<div class="permission-box"><b>What the owner can send to this device</b><span>Only the assigned task subset shown above, required config/dependencies, and temporary execution files.</span><small>Never unrestricted access to the owner’s complete project.</small></div><div class="receiver-clear-path compact"><div><b>1. Review</b><span>Check contribution, range and executor.</span></div><div><b>2. Accept / Decline</b><span>Nothing starts without your permission.</span></div><div><b>3. Execute</b><span>Progress appears on both sender and receiver panels.</span></div></div><div class="btn-row"><button class="btn glow" data-decision="Accepted">Accept Task</button><button class="btn danger" data-decision="Declined">Decline</button></div></div>`;
  }
  if(task.status==='Completed'){
    return `<div class="completed-card"><div class="completed-check">✓</div><span class="eyebrow">WORK COMPLETE</span><h2>Thanks — your assigned work is finished!</h2><p>The processed result has been returned to ${esc(SERVER.session?.owner||'the owner')} and the task can be cleared from temporary storage.</p>${contribCard}${assignmentDetails(task,a)}<div class="completed-meta"><span>100% processed</span><span>Result returned</span><span>Temporary cache cleared</span></div></div>`;
  }
  if(task.status==='Active'){
    return `<div class="worker-execution"><div class="flex between"><div><span class="eyebrow">WORKER EXECUTION</span><h3>${esc(task.name)}</h3></div><span class="status-tag supported">${esc(task.status)}</span></div>${contribCard}${assignmentDetails(task,a)}<div class="execution-meter"><div class="flex between"><b>${esc(task.stage)}</b><span>${worker.progress}%</span></div><div class="progress large"><span style="width:${worker.progress}%"></span></div></div><div class="receiver-clear-path compact execution-path"><div><b>Receive</b><span>${worker.progress>=5?'Done':'Pending'}</span></div><div><b>Execute</b><span>${worker.progress>=25?'Running':'Pending'}</span></div><div><b>Return</b><span>${worker.progress>=95?'Done':'Pending'}</span></div></div><div class="execution-log"><div><span>01</span><b>Receive assigned data</b><i>${worker.progress>0?'✓':'…'}</i></div><div><span>02</span><b>Run compatible executor</b><i>${worker.progress>=25?'✓':'…'}</i></div><div><span>03</span><b>Report progress</b><i>${worker.progress>=50?'✓':'…'}</i></div><div><span>04</span><b>Return processed result</b><i>${worker.progress>=95?'✓':'…'}</i></div><div><span>05</span><b>Clear temporary task cache</b><i>${worker.progress>=100?'✓':'…'}</i></div></div></div>`;
  }
  return receiverWaiting();
}

function assignmentDetails(task,a){
  return `<div class="incoming-grid"><div><span>ASSIGNED</span><b>${esc(a.range||'Assigned chunk')}</b></div><div><span>REQUIRED DATA</span><b>${esc(a.requiredData||task.requiredData||'Task-specific subset')}</b></div><div><span>EXECUTOR</span><b>${esc(task.executor)}</b></div><div><span>EXPECTED</span><b>${esc(task.eta)}</b></div></div>`;
}

function devicesView(){
  const online=DATA.devices.filter(x=>x.status==='Online');
  return `<div class="section-head" style="margin-top:0"><div><span class="eyebrow">DEVICE FABRIC</span><h3>Real demo hardware profiles</h3></div><button class="btn secondary" data-page="sender">Invite live device</button></div><div class="device-speed-row">${online.map(d=>gauge(d.name.split(' ').slice(0,2).join(' '),d.networkMbps,1500,' Mbps',d.cpu)).join('')}</div><div class="device-grid">${DATA.devices.map(deviceCard).join('')}</div>${(SERVER.workers||[]).length?`<div class="section-head"><div><span class="eyebrow">LIVE SESSION</span><h3>Joined receivers</h3></div></div><div class="card">${SERVER.workers.map(workerRow).join('')}</div>`:''}`;
}
function deviceCard(d){
  return `<button class="device-card modern ${d.status==='Online'?'online':''}" data-device="${d.id}"><div class="flex between"><span class="device-avatar gradient-avatar lg">${d.type==='Phone'?'IQ':d.id==='owner-laptop'?'HP':'AS'}</span><span class="status-dot ${d.status==='Online'?'on':''}">${d.status}</span></div><h3>${esc(d.name)}</h3><p>${esc(d.cpu)}<br>${esc(d.gpu)}</p><div class="device-score"><span>Capability score</span><b>${d.score}</b></div><div class="capbar colorbar"><i style="width:${d.score}%"></i></div><div class="telemetry-grid mini"><div><span>RAM</span><b>${esc(d.ram)}</b></div><div><span>LOAD</span><b>${d.load}%</b></div><div><span>BATTERY</span><b>${d.battery}%</b></div><div><span>NET</span><b>${d.networkMbps}M</b></div></div></button>`;
}

function activeView(){
  const task=SERVER.task;
  if(!task) return `<div class="empty-page"><div>◉</div><h2>No active task</h2><p>Create a task, connect a receiver and send the request. Accepted work starts automatically.</p><button class="btn" data-page="create">Create Task</button></div>`;
  const workers=SERVER.workers||[];
  if(task.status==='Completed'){
    return `${taskPath(task)}<div class="completion-layout"><div class="completed-side-card hero-complete"><div class="completed-check">✓</div><div><span class="eyebrow">TASK COMPLETED</span><h2>${esc(task.name)}</h2><p>All worker chunks returned to HP Victus 16 and were merged successfully. The active area is now free for the next task.</p><div class="completed-meta"><span>Owner 100%</span><span>Receivers returned results</span><span>Merged successfully</span></div></div><div class="btn-row"><button class="btn glow" id="readyNextTask">Ready for another task</button><button class="btn secondary" data-page="history">Open history</button></div></div><div>${routeFlow(task,workers)}<div class="section-head"><div><span class="eyebrow">FINAL DISTRIBUTION</span><h3>Completed contribution</h3></div></div>${distributionBoard(task,workers)}</div></div>`;
  }
  return `${taskPath(task)}${routeFlow(task,workers)}<div class="section-head" style="margin-top:18px"><div><span class="eyebrow">LIVE ORCHESTRATION</span><h3>${esc(task.name)}</h3></div><span class="status-tag supported">${esc(task.status)}</span></div>${senderTaskStatus(task,workers)}<div class="section-head"><div><span class="eyebrow">WORK DISTRIBUTION</span><h3>Owner vs every worker</h3></div></div>${distributionBoard(task,workers)}<div class="section-head"><div><span class="eyebrow">WORKERS</span><h3>Per-device live progress</h3></div></div><div class="device-progress-grid">${workers.map(x=>`<div class="card"><div class="flex between"><div class="worker-ident">${deviceBrandLogo(x.name,'worker-brand')}<b>${esc(x.name)}</b></div><span class="decision ${x.decision.toLowerCase()}">${esc(x.decision)}</span></div><p class="muted small highlight-range">${esc(x.assignment?.range||'No assignment')}</p><div class="progress"><span style="width:${x.progress}%"></span></div><div class="flex between small"><span>${x.progress}% complete</span><span>${x.temperature}°C • ${x.battery}%</span></div></div>`).join('')}</div><div class="auto-run-note"><b>Automatic execution is ON.</b><span>No manual “start” button is needed after approvals are complete.</span></div>`;
}

function historyView(){
  return `<div class="section-head" style="margin-top:0"><div><span class="eyebrow">MEASURABLE RESULTS</span><h3>Task history</h3></div></div><div class="history-table"><div class="history-head"><span>Task</span><span>Local</span><span>SwarmOS</span><span>Saved</span><span>Status</span></div>${DATA.history.map(h=>`<button class="history-row" data-toast="${esc(h.task)} completed"><b>${esc(h.task)}</b><span>${esc(h.local)}</span><span>${esc(h.swarmos)}</span><b>${esc(h.saved)}</b><i>${esc(h.status)}</i></button>`).join('')}</div>`;
}

function schedulerView(){
  const s=DATA.scheduler, alloc=computedAllocation(wf()), ds=selectedStaticDevices().filter(d=>workloadCompatibility(d,wf()));
  return `<div class="scheduler-hero colorful-scheduler"><div><span class="eyebrow light">THE BRAIN</span><h2>${esc(s.agent)}</h2><p>The agent reads processor/GPU, RAM, load, thermal state, battery, network and executor compatibility. It scores the selected devices, then gives more work to devices predicted to finish faster.</p><div class="btn-row"><button class="btn inverse" data-page="create">Change selected devices</button><button class="btn dark-outline" data-toast="Agent recalculated the current workload split.">Recalculate now</button></div></div><div class="equation"><span>ESTIMATED TOTAL COST</span><b>Transfer + Execution + Return + Merge + Resource Penalty</b></div></div>
  <div class="section-head"><div><span class="eyebrow">RESOURCE RADAR</span><h3>What the agent sees</h3></div><span class="muted small">CPU • GPU/NPU • RAM • Network • free capacity</span></div><div class="radar-grid">${ds.map(d=>`<button class="radar-card" data-device="${d.id}">${radarSvg(d)}<div><b>${esc(d.name)}</b><span>Agent score ${suitability(d,wf())}/100</span><small>${esc(d.cpu)} • ${esc(d.ram)} RAM</small></div></button>`).join('')}</div>
  <div class="section-head"><div><span class="eyebrow">CURRENT DECISION</span><h3>Why each device gets this share</h3></div></div><div class="decision-board">${alloc.map((a,i)=>`<div><span>${String(i+1).padStart(2,'0')}</span><b>${esc(a.device)}</b><strong>${a.share}%</strong><p>${esc(a.reason)}</p></div>`).join('')}</div>
  <div class="section-head"><div><span class="eyebrow">SCHEDULER INPUTS</span><h3>Inputs used before assigning work</h3></div></div><div class="check-grid">${s.checks.map((x,i)=>`<button class="check-card" data-toast="Scheduler input: ${esc(x)}"><span>${String(i+1).padStart(2,'0')}</span><b>${esc(x)}</b></button>`).join('')}</div>
  <div class="section-head"><div><span class="eyebrow">OPTIMIZATION</span><h3>Decision pipeline</h3></div></div><div class="opt-flow"><div><span>01</span><b>Compatibility filter</b><p>Remove devices without the right executor/runtime.</p></div><i>→</i><div><span>02</span><b>Resource scoring</b><p>Compare CPU/GPU, RAM, load, network and safety limits.</p></div><i>→</i><div><span>03</span><b>Weighted split</b><p>Give stronger devices a larger independent chunk.</p></div><i>→</i><div><span>04</span><b>ETA rebalance</b><p>Minimize the predicted finish time of the slowest required worker.</p></div></div>`;
}

function settingsView(){
  return `<div class="settings-grid"><div class="card"><span class="eyebrow">WORKER PREFERENCES</span><h3>Participation limits</h3><label class="toggle-row"><span>Allow this device to help</span><input checked type="checkbox"><i></i></label><div class="field"><label>Minimum battery</label><input value="30%"></div><div class="field"><label>Maximum temperature</label><input value="42°C"></div><div class="field"><label>Maximum temporary storage</label><input value="5 GB"></div><button class="btn" data-toast="Worker preferences saved for demo.">Save preferences</button></div>
  <div class="card"><span class="eyebrow">NOTIFICATIONS</span><h3>Task request alerts</h3><p>Browser notifications can appear when another device sends a SwarmOS request. Permission is controlled by your browser.</p><button class="btn secondary" id="enableNotifications">Enable browser notifications</button><div class="divider"></div><span class="eyebrow">LIVE SERVER</span><p>Reset removes the active session, receivers and task state.</p><button class="btn danger" id="resetAll">Reset live session</button></div></div>`;
}

function photoView(){
  return `<div class="photo-hero"><div><span class="eyebrow light">FUTURE WORKFLOW PREVIEW</span><h2>Photo Intelligence</h2><p>A visual concept for splitting photo analysis across devices. This is intentionally marked future and is not claimed as an implemented executor.</p><div class="btn-row"><button class="btn inverse" id="usePhotoWorkflow">Select Photo Workflow</button><button class="btn dark-outline" data-page="create">Back to Create Task</button></div></div><span class="status-tag future">FUTURE PREVIEW</span></div>
  <div class="operation-grid"><button data-photo-op="Category sorting" class="active"><b>Category sorting</b><span>Birds • flowers • people • trees</span></button><button data-photo-op="Face matching"><b>Face matching</b><span>Reference-person search</span></button><button data-photo-op="Blur detection"><b>Blur detection</b><span>Flag low-quality images</span></button><button data-photo-op="Duplicate detection"><b>Duplicate detection</b><span>Group near-identical shots</span></button></div>
  <div class="photo-grid">${DATA.photoSamples.map(p=>`<button class="photo-card" data-toast="${esc(p.label)} selected"><img src="${esc(p.file)}" alt="${esc(p.label)}"><div><b>${esc(p.label)}</b><span>${esc(p.meta)}</span></div></button>`).join('')}</div>`;
}

function futureInfoModal(name){
  const c=conn(), w=wf();
  modal(`<span class="eyebrow">PRODUCT ROADMAP</span><h2>${esc(name)}</h2><p>${esc(c.description)}</p><div class="roadmap-flow"><div><b>1. Authenticate source</b><span>User explicitly connects ${esc(name)}.</span></div><div><b>2. Read only selected input</b><span>SwarmOS builds a task manifest, not unrestricted access.</span></div><div><b>3. Capability filter</b><span>Only compatible executors receive work.</span></div><div><b>4. Minimum transfer</b><span>Only the assigned portion is delivered to each worker.</span></div></div><div class="future-warning">Status: ${esc(c.status)}. It is shown in the original-app interface but is not eligible for the supported hackathon execution path.</div><button class="btn secondary" id="modalClose2">Close</button>`);
}

function deviceModal(id){
  const d=DATA.devices.find(x=>x.id===id); if(!d)return;
  modal(`<span class="eyebrow">DEVICE DETAILS</span><h2>${esc(d.name)}</h2><div class="device-detail-split"><div>${radarSvg(d)}</div><div class="telemetry-grid modal-tele"><div><span>CPU</span><b>${esc(d.cpu)}</b></div><div><span>GPU/NPU</span><b>${esc(d.gpu)}</b></div><div><span>RAM</span><b>${esc(d.ram)}</b></div><div><span>Network</span><b>${esc(d.network)}</b></div><div><span>Battery</span><b>${d.battery}%</b></div><div><span>Temperature</span><b>${d.temperature}°C</b></div><div><span>Current load</span><b>${d.load}%</b></div><div><span>Storage</span><b>${esc(d.storage)}</b></div></div></div><h3>Compatible executors</h3><div class="file-chip-row">${d.executors.map(x=>`<span class="file-chip static">${esc(x)}</span>`).join('')}</div><button class="btn secondary" id="modalClose2">Close</button>`);
}


function showIncomingOverlay(n){
  let old=document.getElementById('incomingOverlay'); if(old)old.remove();
  const el=document.createElement('div'); el.id='incomingOverlay'; el.className='incoming-overlay';
  el.innerHTML=`<div class="incoming-pop giant"><div class="alert-bell">🔔</div><span>SWARMOS REQUEST</span><h2>${esc(n.title)}</h2><p>${esc(n.message)}</p><div class="alert-actions"><button class="btn glow" id="openIncomingRequest">Review request</button><button class="btn glass" id="dismissIncoming">Dismiss</button></div></div>`;
  document.body.append(el);
  document.getElementById('openIncomingRequest').onclick=()=>{el.remove();state.page='receiver';render();};
  document.getElementById('dismissIncoming').onclick=()=>el.remove();
  setTimeout(()=>{if(el.isConnected)el.remove();},5000);
}
function showStatusOverlay(title,message,kind='info'){
  let old=document.getElementById('statusOverlay'); if(old) old.remove();
  const icon=/accepted/i.test(title+' '+message)?'✓':/connected|device/i.test(title+' '+message)?'⌁':/completed/i.test(title+' '+message)?'★':'↑';
  const el=document.createElement('div'); el.id='statusOverlay'; el.className=`status-overlay ${kind}`;
  el.innerHTML=`<div class="status-pop"><div class="status-icon">${icon}</div><span>SWARMOS LIVE</span><h2>${esc(title)}</h2><p>${esc(message)}</p><div class="status-timer"><i></i></div></div>`;
  document.body.append(el); setTimeout(()=>{if(el.isConnected)el.remove();},5000);
}

function checkForCelebration(){
  const t=SERVER.task; if(!t||t.status!=='Completed')return;
  const key=`${t.name}|${t.createdAt||''}|${notificationTarget()}`;
  if(state.lastCelebrationKey===key)return;
  state.lastCelebrationKey=key; showCelebration(t.name);
}
function showCelebration(taskName){
  let old=document.getElementById('celebrationOverlay'); if(old)old.remove();
  const el=document.createElement('div');el.id='celebrationOverlay';el.className='celebration-overlay';
  const confetti=Array.from({length:42},(_,i)=>`<i style="--x:${(i*37)%100}%;--d:${(i%7)*.15}s;--r:${(i*43)%360}deg"></i>`).join('');
  el.innerHTML=`<div class="confetti">${confetti}</div><div class="celebration-card"><div class="mega-check">✓</div><span>SWARM COMPLETE</span><h1>Thanks! Work completed.</h1><p>${esc(taskName)} finished, results returned and merged successfully.</p><div class="celebrate-pills"><b>100% complete</b><b>Result merged</b><b>Workers released</b></div></div>`;
  document.body.append(el); setTimeout(()=>{if(el.isConnected)el.remove();},5000);
}
function modal(inner){
  $("#modalRoot").innerHTML=`<div class="modal-bg"><div class="modal"><button class="modal-x" id="modalX">✕</button>${inner}</div></div>`;
  $("#modalX").onclick=closeModal; const c=$("#modalClose2"); if(c)c.onclick=closeModal;
}
function closeModal(){ const r=$("#modalRoot"); if(r)r.innerHTML=''; }

function toast(msg){
  let root=$("#toastRoot"); if(!root){root=document.createElement('div');root.id='toastRoot';document.body.append(root);}
  const t=document.createElement('div');t.className='toast';t.innerHTML=`<span>●</span>${esc(msg)}`;root.append(t);setTimeout(()=>t.remove(),3200);
}

function updateBell(){
  const b=$("#bellBtn"); if(!b)return; const c=unseenCount(); b.innerHTML=`♢${c?`<span>${c}</span>`:''}`;
}

function bindShell(){
  bindPage();
  $("#logout").onclick=()=>{state.loggedIn=false;render();};
  $("#roleSwitch").onclick=()=>{state.role=state.role==='owner'?'worker':'owner';state.page=state.role==='owner'?'sender':'receiver';state.notificationDrawer=false;render();};
  $("#bellBtn").onclick=()=>{state.notificationDrawer=!state.notificationDrawer;if(state.notificationDrawer)markNotificationsSeen();render();};
  const close=$("#closeNotifications");if(close)close.onclick=()=>{state.notificationDrawer=false;render();};
  $("#notifyPermission").onclick=requestNotificationPermission;
}

function bindPage(){
  $$('[data-page]').forEach(b=>b.onclick=()=>{state.page=b.dataset.page;state.notificationDrawer=false;render();});
  $$('[data-select-workflow],[data-quick-workflow]').forEach(b=>b.onclick=()=>{
    state.selectedWorkflow=b.dataset.selectWorkflow||b.dataset.quickWorkflow; state.selectedConnector=wf().connectors[0].id; applyWorkflowDefaults();
    if(state.selectedWorkflow==='photos' && b.dataset.selectWorkflow && state.page==='home'){state.page='photo';} else state.page='create'; render();
  });
  $$('[data-connector]').forEach(b=>b.onclick=()=>{state.selectedConnector=b.dataset.connector;applyWorkflowDefaults();render();});
  $$('[data-roadmap]').forEach(b=>b.onclick=()=>futureInfoModal(b.dataset.roadmap));
  $$('[data-objective]').forEach(b=>b.onclick=()=>{state.builder.objective=b.dataset.objective;renderContentOnly();});
  $$('[data-privacy]').forEach(b=>b.onclick=()=>{state.builder.privacy=b.dataset.privacy;renderContentOnly();});
  $$('[data-network]').forEach(b=>b.onclick=()=>{state.builder.network=b.dataset.network;renderContentOnly();});
  $$('[data-device]').forEach(b=>b.onclick=()=>deviceModal(b.dataset.device));
  $$('[data-toggle-device]').forEach(b=>b.onclick=()=>{const id=b.dataset.toggleDevice;if(b.disabled)return;const list=state.builder.selectedDevices;const i=list.indexOf(id);if(i>=0){if(list.length===1)return toast('Keep at least one device selected.');list.splice(i,1);}else list.push(id);renderContentOnly();});
  $$('[data-toast]').forEach(b=>b.onclick=()=>toast(b.dataset.toast));
  $$('[data-decision]').forEach(b=>b.onclick=()=>decision(b.dataset.decision));
  $$('[data-photo-op]').forEach(b=>b.onclick=()=>{$$('[data-photo-op]').forEach(x=>x.classList.remove('active'));b.classList.add('active');toast(`${b.dataset.photoOp} selected for preview.`);});

  const del=$("#deleteTemp");if(del)del.onchange=()=>state.builder.deleteTemp=del.checked;
  const wifi=$("#wifiOnly");if(wifi)wifi.onchange=()=>state.builder.wifiOnly=wifi.checked;
  const mob=$("#allowMobile");if(mob)mob.onchange=()=>state.builder.allowMobile=mob.checked;
  const mb=$("#minBattery");if(mb)mb.onchange=()=>state.builder.minBattery=Number(mb.value);
  const mt=$("#maxTemp");if(mt)mt.onchange=()=>state.builder.maxTemp=Number(mt.value);
  const ms=$("#maxStorage");if(ms)ms.onchange=()=>state.builder.maxStorage=Number(ms.value);

  const pick=$("#pickFiles"), input=$("#filePicker");if(pick&&input){pick.onclick=e=>{e.preventDefault();input.click();};input.onchange=()=>{state.builder.fileNames=[...input.files].map(f=>f.name);toast(`${input.files.length} file(s) added to preview.`);renderContentOnly();};}
  $$('[data-file-chip]').forEach(b=>b.onclick=()=>{state.builder.fileNames.splice(Number(b.dataset.fileChip),1);renderContentOnly();});
  const sourceUrl=$("#sourceUrl");if(sourceUrl)sourceUrl.onchange=()=>state.builder.sourceLabel=sourceUrl.value;
  const inspect=$("#inspectUrl");if(inspect)inspect.onclick=()=>{state.builder.sourceLabel=$("#sourceUrl").value;toast('Source inspected: byte-range support detected for demo.');renderContentOnly();};
  const auto=$("#autoSelectDevices");if(auto)auto.onclick=()=>{state.builder.selectedDevices=DATA.devices.filter(d=>d.status==='Online'&&workloadCompatibility(d,wf())).map(d=>d.id);toast('Agent selected all compatible online devices.');renderContentOnly();};
  const cont=$("#continueSender");if(cont)cont.onclick=()=>{state.page='sender';render();};

  const cs=$("#createSession");if(cs)cs.onclick=createSession;
  const copy=$("#copyInvite");if(copy)copy.onclick=copyInvite;
  const or=$("#openReceiver");if(or)or.onclick=openReceiverWindow;
  const or2=$("#openReceiver2");if(or2)or2.onclick=openReceiverWindow;
  const or3=$("#openReceiver3");if(or3)or3.onclick=openReceiverWindow;
  const or4=$("#openReceiver4");if(or4)or4.onclick=openReceiverWindow;
  const sr=$("#sendRequests");if(sr)sr.onclick=sendRequests;
  const st=$("#startTask");if(st)st.onclick=startTask;
  const rp=$("#receiverProfile");if(rp)rp.onchange=()=>{state.receiverProfile=rp.value;localStorage.setItem('swarmosReceiverProfile',rp.value);const p=DATA.receiverProfiles.find(x=>x.id===rp.value);if(p){state.receiverName=p.name;localStorage.setItem('swarmosReceiverName',p.name);}renderContentOnly();};
  const join=$("#joinSession");if(join)join.onclick=joinSession;
  const leave=$("#leaveSession");if(leave)leave.onclick=leaveSession;
  const en=$("#enableNotifications");if(en)en.onclick=requestNotificationPermission;
  const sim=$("#simulateProgress");if(sim)sim.onclick=simulateProgress;
  const reset=$("#resetAll");if(reset)reset.onclick=resetAll;
  const nxt=$("#readyNextTask");if(nxt)nxt.onclick=clearCompletedTask;
  const nxt2=$("#readyNextTask2");if(nxt2)nxt2.onclick=clearCompletedTask;
  const up=$("#usePhotoWorkflow");if(up)up.onclick=()=>{state.selectedWorkflow='photos';state.selectedConnector='photo-folder';state.page='create';render();};
}

async function requestNotificationPermission(){
  if(!('Notification' in window)) return toast('This browser does not support desktop notifications.');
  const p=await Notification.requestPermission();toast(p==='granted'?'Browser notifications enabled.':'Notification permission was not granted.');
}

async function createSession(){
  try{const r=await api('/api/session/create','POST',{owner:'HP Victus 16'});SERVER=r.state;toast(`Session ${SERVER.session.code} created.`);renderContentOnly();}catch(e){toast(e.message);}
}
async function copyInvite(){
  const text=`Join my SwarmOS session: ${SERVER.session?.code||''}\n${INFO.lanUrl||location.origin}`;
  try{await navigator.clipboard.writeText(text);toast('Invite copied.');}catch(_){modal(`<h2>Share this invite</h2><pre class="invite-pre">${esc(text)}</pre><button class="btn secondary" id="modalClose2">Close</button>`);}
}
function openReceiverWindow(){
  const url=new URL(location.href);url.searchParams.set('receiver','1');window.open(url.toString(),'swarmosReceiver','width=520,height=860');
}
async function sendRequests(){
  const w=wf(), c=conn(); if(!c.enabled)return toast('This source is marked future and is not eligible for the supported demo.');
  try{
    const alloc=computedLiveAllocation(w); const r=await api('/api/task/request','POST',{workflowId:w.id,name:w.name,connector:c.name,sourceLabel:state.builder.sourceLabel,requiredData:requiredDataFor(w),executor:w.requiredExecutor,eta:w.distributedEstimate,localEstimate:w.localEstimate,saving:w.saving,objective:state.builder.objective,privacy:state.builder.privacy,allocations:alloc});
    SERVER=r.state;toast(`Task request sent to ${SERVER.workers.length} receiver(s).`);showStatusOverlay('Request sent',`Waiting for ${SERVER.workers.length} receiver${SERVER.workers.length===1?'':'s'} to accept.`, 'task');renderContentOnly();
  }catch(e){toast(e.message);}
}
function requiredDataFor(w){
  if(w.id==='video')return 'Only media required for assigned timeline range';
  if(w.id==='tests')return 'Assigned tests + required modules/config/dependencies';
  if(w.id==='download')return 'Only assigned byte range';
  return 'Only assigned task-specific subset';
}
async function startTask(){
  try{const r=await api('/api/task/start','POST',{});SERVER=r.state;toast('Distributed execution started.');state.page='active';render();}catch(e){toast(e.message);}
}
async function joinSession(){
  const code=$("#joinCode").value.trim();
  const profile=DATA.receiverProfiles.find(x=>x.id===state.receiverProfile)||DATA.receiverProfiles[0];
  const name=profile.name; state.receiverName=name; localStorage.setItem('swarmosReceiverName',name);
  try{const r=await api('/api/session/join','POST',{code,name,battery:profile.battery,temperature:profile.temperature,network:profile.network,ram:profile.ram,cpu:profile.cpu,gpu:profile.gpu});SERVER=r.state;toast(`${name} connected to sender.`);renderContentOnly();}catch(e){toast(e.message);}
}

async function leaveSession(){
  try{const r=await api('/api/session/leave','POST',{name:state.receiverName});SERVER=r.state;toast('Left the sender session.');renderContentOnly();}catch(e){toast(e.message);}
}
async function decision(value){
  try{const r=await api('/api/session/decision','POST',{name:state.receiverName,decision:value});SERVER=r.state;toast(`Task ${value.toLowerCase()}.`);if(value==='Accepted') showStatusOverlay('Accepted — starting automatically','Your device is approved. SwarmOS will begin as soon as all requested devices respond.','success');renderContentOnly();}catch(e){toast(e.message);}
}
function simulateProgress(){
  if(state.simTimer)return;
  toast('Live simulation started. Watch both sender and receiver screens.');
  state.simTimer=setInterval(async()=>{
    try{const r=await api('/api/task/progress','POST',{delta:8});SERVER=r.state;if(SERVER.task?.status==='Completed'){clearInterval(state.simTimer);state.simTimer=null;toast('Task completed and results merged.');checkForCelebration();}renderContentOnly();}catch(e){clearInterval(state.simTimer);state.simTimer=null;toast(e.message);}
  },800);
}
async function clearCompletedTask(){
  try{const r=await api('/api/task/reset','POST',{});SERVER=r.state;toast('Completed task cleared. Ready for the next task.');state.page='sender';render();}catch(e){toast(e.message);}
}
async function resetAll(){
  try{const r=await api('/api/session/reset','POST',{});SERVER=r.state;toast('Live session reset.');renderContentOnly();}catch(e){toast(e.message);}
}

// Open receiver interface automatically when using the helper receiver window.
const params = new URLSearchParams(location.search);
if(params.get('receiver')==='1'){ state.loggedIn=true; state.role='worker'; state.page='receiver'; }

init().catch(err=>{
  document.body.innerHTML=`<div style="font-family:system-ui;padding:32px"><h2>SwarmOS could not start</h2><p>${esc(err.message)}</p><p>Run this project with <code>python server.py</code>, then open <code>http://localhost:5173</code>.</p></div>`;
});
