const $=s=>document.querySelector(s),au=new Audio(),view=$("#view"),tk=$("#tk"),sk=$("#seek");
const E=s=>String(s).replace(/[&<>"']/g,c=>"&#"+c.charCodeAt(0)+";");
const IC={play:'<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>',pause:'<svg viewBox="0 0 24 24"><path d="M7 5h4v14H7zM13 5h4v14h-4z"/></svg>',prev:'<svg viewBox="0 0 24 24"><path d="M6 5h2v14H6zM20 5v14L9 12z"/></svg>',next:'<svg viewBox="0 0 24 24"><path d="M16 5h2v14h-2zM4 5v14l11-7z"/></svg>'};
const st={q:[],i:-1,sh:false,rp:"off",h:[]};let cur=[],tok=0,seeking=false,errs=0;
const api=p=>fetch(p).then(r=>{if(!r.ok)throw 0;return r.json()});
const hue=s=>[...s].reduce((a,c)=>(a*31+c.charCodeAt(0))%360,7);
const cov=(k,id,n,has)=>has?`<img src="/api/cover/${k}/${id}" loading="lazy" alt="">`:`<div class="ph" style="--h:${hue(n)}">${E((n[0]||"?").toUpperCase())}</div>`;
const fmt=s=>{s=Math.floor(s||0);return Math.floor(s/60)+":"+String(s%60).padStart(2,"0")};
const toast=m=>{const t=$("#toast");t.textContent=m;t.hidden=false;setTimeout(()=>t.hidden=true,3000)};
$("#bp").innerHTML=IC.prev;$("#bn").innerHTML=IC.next;$("#bpl").innerHTML=IC.play;
const nsk=$("#nseek"),nowEl=$("#now");$("#np1").innerHTML=IC.prev;$("#np3").innerHTML=IC.next;$("#npl").innerHTML=IC.play;
const closeNow=()=>{nowEl.hidden=true;document.body.style.overflow=""};
const fillNow=t=>{$("#nart").innerHTML=cov("album",t.album_id,t.album,t.cov);$("#ntt").textContent=t.title;const a=$("#nta"),b=$("#ntb");a.textContent=t.artist;a.href="#/artist/"+t.artist_id;b.textContent=t.album;b.href="#/album/"+t.album_id};
const sync=()=>{for(const b of document.querySelectorAll('[data-a="sh"]'))b.classList.toggle("on",st.sh);for(const b of document.querySelectorAll('[data-a="rp"]')){b.textContent=st.rp=="off"?"repetir":st.rp=="all"?"repetir tudo":"repetir 1";b.classList.toggle("on",st.rp!="off")}};

/* letreiro */
const TZ="America/Sao_Paulo";/* fuso fixo: alguns navegadores (modo privacidade) reportam UTC */
const hm=()=>{const p=new Intl.DateTimeFormat("pt-BR",{timeZone:TZ,hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).formatToParts(new Date());return[+p.find(x=>x.type=="hour").value,p.find(x=>x.type=="minute").value]};
let curPl=0,curPlName="",pick=[];
const post=(u,b,m="POST")=>fetch(u,{method:m,headers:{"Content-Type":"application/json"},body:JSON.stringify(b)}).then(r=>r.json());
const clock=()=>{const [h,mi]=hm();
 const per=h<5?"DA MADRUGADA":h<12?"DA MANHÃ":h<18?"DA TARDE":"DA NOITE",g=h>=5&&h<12?"BOM DIA":h<18&&h>=12?"BOA TARDE":"BOA NOITE";
 const t=String(h).padStart(2,"0")+":"+mi+" "+per;
 document.querySelectorAll("[data-c]").forEach(e=>e.textContent=t);document.querySelectorAll("[data-g]").forEach(e=>e.textContent=g)};
function setTicker(){const t=st.q[st.i],p=[];if(t&&!au.paused)p.push(`<b>TOCANDO AGORA : ${E(t.artist)} - ${E(t.title)}</b>`);
 p.push(`AGORA ${hm()[0]==1?"É":"SÃO"} <span data-c></span>`,`<span data-g></span>`);
 const c=`<span class="cp">${p.join("<i>----</i>")}<i>----</i></span>`;tk.innerHTML=c;clock();
 const w=tk.firstChild.offsetWidth||1,n=Math.ceil(innerWidth/w);tk.innerHTML=c.repeat(n*2);clock();tk.style.animationDuration=Math.max(10,w*n/60)+"s"}
setInterval(clock,10000);addEventListener("resize",setTicker);

/* player */
function load(i,back){const t=st.q[i];if(!t)return;if(!back&&st.i>=0)st.h.push(st.i);st.i=i;au.src="/api/stream/"+t.id;au.play().catch(()=>{});
 $("#pt").textContent=t.title;$("#pa").textContent=t.artist;$("#pc").innerHTML=cov("album",t.album_id,t.album,t.cov);document.title=t.title+" - "+t.artist;mark();fillNow(t);
 setMeta(t)}
function setMeta(t){if(!("mediaSession"in navigator))return;
 /* faixa privada: a tela de bloqueio não mostra nome nem capa */
 navigator.mediaSession.metadata=t.priv?new MediaMetadata({title:"Radio X"}):new MediaMetadata({title:t.title,artist:t.artist,album:t.album,
  artwork:t.cov?[{src:"/api/cover/album/"+t.album_id,sizes:"512x512"}]:[{src:"/icons/icon-512.png",sizes:"512x512",type:"image/png"}]})}
let lastPos=0;
function setPos(){if(!("mediaSession"in navigator)||!navigator.mediaSession.setPositionState)return;
 const d=au.duration;if(!isFinite(d)||d<=0)return;
 try{navigator.mediaSession.setPositionState({duration:d,playbackRate:au.playbackRate||1,position:Math.min(au.currentTime,d)})}catch{}}
function next(auto){const n=st.q.length;if(!n)return;if(auto&&st.rp==="one"){au.currentTime=0;au.play();return}
 let i=st.i+1;if(st.sh&&n>1)do i=Math.floor(Math.random()*n);while(i===st.i);
 if(i>=n){if(st.rp!=="all")return;i=0}load(i)}
function prev(){if(au.currentTime>3||!st.h.length){au.currentTime=0;return}load(st.h.pop(),true)}
const ls={get:k=>{try{return localStorage.getItem(k)}catch{return null}},set:(k,v)=>{try{localStorage.setItem(k,v)}catch{}}};
let vol=+(ls.get("rx_vol")??80),muted=false,rate=+(ls.get("rx_rate")||1);const RATES=[1,1.25,1.5,2];
const applyVol=()=>{au.volume=muted?0:(vol/100)**2;for(const s of document.querySelectorAll(".vol")){s.value=vol;s.style.setProperty("--p",vol+"%")}for(const b of document.querySelectorAll('[data-a="mute"]')){b.textContent=muted||!vol?"mudo":"som";b.classList.toggle("on",muted||!vol)}};
const setVol=v=>{vol=Math.max(0,Math.min(100,Math.round(v)));muted=false;ls.set("rx_vol",vol);applyVol()};
const applyRate=()=>{au.defaultPlaybackRate=au.playbackRate=rate;for(const b of document.querySelectorAll('[data-a="rate"]'))b.textContent=rate+"x"};
const skip=d=>{if(au.src)au.currentTime=Math.max(0,Math.min(au.duration||Infinity,au.currentTime+d))};
document.querySelectorAll(".vol").forEach(s=>{s.oninput=()=>setVol(+s.value);s.onwheel=e=>{e.preventDefault();setVol(vol+(e.deltaY<0?5:-5))}});
const toggle=()=>au.src?(au.paused?au.play():au.pause()):0;
const mark=()=>document.querySelectorAll("[data-t]").forEach(r=>r.classList.toggle("on",r.dataset.t===(st.q[st.i]||{}).id));
const playList=(ts,i)=>{st.q=ts;st.h=[];load(i)};
au.onplay=au.onpause=()=>{if("mediaSession"in navigator)navigator.mediaSession.playbackState=au.paused?"paused":"playing";setPos();$("#bpl").innerHTML=$("#npl").innerHTML=au.paused?IC.play:IC.pause;if(st.q.length)setTicker()};
au.onended=()=>next(true);au.onplaying=()=>errs=0;
au.onerror=()=>{toast("não foi possível tocar esta faixa");if(++errs<4)setTimeout(()=>next(true),800)};
au.onloadedmetadata=au.onseeked=au.onratechange=setPos;
au.ontimeupdate=()=>{if(Date.now()-lastPos>5000){lastPos=Date.now();setPos()}if(seeking||!au.duration)return;const p=au.currentTime/au.duration*100;for(const s of[sk,nsk]){s.value=p*10;s.style.setProperty("--p",p+"%")}$("#tm").textContent=fmt(au.currentTime)+" / "+fmt(au.duration);$("#nc1").textContent=fmt(au.currentTime);$("#nc2").textContent=fmt(au.duration)};
for(const s of[sk,nsk]){s.oninput=()=>{seeking=true;s.style.setProperty("--p",s.value/10+"%")};s.onchange=()=>{if(au.duration)au.currentTime=s.value/1000*au.duration;seeking=false}}
if("mediaSession"in navigator){const m=navigator.mediaSession;m.setActionHandler("play",()=>au.play());m.setActionHandler("pause",()=>au.pause());m.setActionHandler("previoustrack",prev);m.setActionHandler("nexttrack",()=>next());
 m.setActionHandler("seekto",d=>au.currentTime=d.seekTime);try{m.setActionHandler("seekbackward",()=>skip(-10));m.setActionHandler("seekforward",()=>skip(10))}catch{}}

/* telas */
const grid=(xs,k,sub)=>`<div class="grid">${xs.map(x=>`<a class="it" href="#/${k}/${x.id}"><div class="art">${cov(k,x.id,x.name,x.cov)}</div><b>${E(x.name)}</b><span>${sub(x)}</span></a>`).join("")}</div>`;
const cr=(...p)=>`<nav class="cr"><a href="#/">musica</a>${p.map(([h,n])=>" / "+(h?`<a href="${h}">${E(n)}</a>`:E(n))).join("")}</nav>`;
const nf=n=>n+(n==1?" faixa":" faixas");
const rows=(ts,pid)=>`<div class="tr">${ts.map((t,i)=>`<div class="r" data-t="${t.id}"><button data-a="pt" data-i="${i}"><i>${String(i+1).padStart(2,"0")}</i><span>${E(t.title)}</span><em>${E(t.ext.slice(1))}</em></button><button class="x" data-a="${pid?"rm":"add"}" data-id="${t.id}" aria-label="${pid?"Remover da playlist":"Adicionar à playlist"}">${pid?"×":"+"}</button></div>`).join("")}</div>`;
async function home(){const a=await api("/api/artists");if(!a.length)return`<div class="empty"><p>Nenhuma música encontrada.</p><p>Coloque uma pasta por artista em /musica e atualize.</p><button class="btn pri" data-a="rescan">atualizar biblioteca</button></div>`;
 return grid(a,"artist",x=>x.albums+(x.albums==1?" álbum":" álbuns")+(x.priv?" *":""))+`<p class="ft">${a.length} artistas <button class="btn" data-a="rescan">atualizar biblioteca</button></p>`}
async function artist(id){const a=await api("/api/artists/"+id);return cr([0,a.name])+`<h1>${E(a.name)}</h1><br>`+grid(a.albums,"album",x=>nf(x.tracks)+(x.priv?" *":""))}
async function album(id){const b=await api("/api/albums/"+id);cur=b.tracks;
 return cr([`#/artist/${b.artist_id}`,b.artist],[0,b.name])+`<div class="ah"><div class="art">${cov("album",b.id,b.name,b.cov)}</div><div><h1>${E(b.name)}</h1><p><a href="#/artist/${b.artist_id}">${E(b.artist)}</a></p><p><button class="btn pri" data-a="pa">tocar</button> <button class="btn" data-a="pa" data-sh="1">aleatório</button> <button class="btn" data-a="addall">+ playlist</button></p></div></div>`+rows(b.tracks)}
async function search(q){const r=await api("/api/search?q="+encodeURIComponent(q));cur=r.tracks;
 return `<h1>${E(q)}</h1>`+(r.artists.length?`<h2>artistas</h2>`+grid(r.artists,"artist",()=>""):"")+(r.albums.length?`<h2>álbuns</h2>`+grid(r.albums,"album",()=>""):"")+(r.tracks.length?`<h2>faixas</h2>`+rows(r.tracks):"")+(r.artists.length+r.albums.length+r.tracks.length?"":`<p class="empty">Nada encontrado.</p>`)}
async function pls(){const a=await api("/api/playlists");return cr([0,"playlists"])+`<h1>playlists</h1><br>`+(a.length?`<div class="tr">${a.map(p=>`<div class="r"><a class="pa" href="#/playlist/${p.id}"><span>${E(p.name)}</span><em>${nf(p.n)}</em></a></div>`).join("")}</div>`:`<p class="empty">Nenhuma playlist ainda. Use o + ao lado de uma faixa.</p>`)+`<p class="ft"><button class="btn" data-a="newpl">nova playlist</button></p>`}
async function pl(id){const p=await api("/api/playlists/"+id);cur=p.tracks;curPl=p.id;curPlName=p.name;
 return cr(["#/playlists","playlists"],[0,p.name])+`<h1>${E(p.name)}</h1><p class="dim">${nf(p.tracks.length)}</p><p><button class="btn pri" data-a="pa">tocar</button> <button class="btn" data-a="pa" data-sh="1">aleatório</button> <button class="btn" data-a="plren">renomear</button> <button class="btn" data-a="pldel">apagar</button></p>`+rows(p.tracks,p.id)}
async function openPick(ids){pick=ids;const ps=await api("/api/playlists");$("#pk").innerHTML=`<div class="np"><b>adicionar à playlist</b>${ps.map(p=>`<button class="btn" data-a="addto" data-p="${p.id}">${E(p.name)}</button>`).join("")}<button class="btn pri" data-a="addnew">nova playlist</button><button class="btn" data-a="pkx">cancelar</button></div>`;$("#pk").hidden=false}
const lockUI=()=>$("#us").classList.toggle("open",!!st.open);
async function secret(){
 if(st.open){await fetch("/api/lock",{method:"POST"});st.open=false;lockUI();if(st.q.some(t=>t.priv))return location.reload();return route()}
 $("#pk").innerHTML=`<form class="np" id="pf"><b>$ senha</b><input id="pin" type="password" inputmode="numeric" autocomplete="off" aria-label="Senha"><p id="pe" class="dim"></p><button class="btn pri">entrar</button><button class="btn" type="button" data-a="pkx">cancelar</button></form>`;
 $("#pk").hidden=false;$("#pin").focus();
 $("#pf").onsubmit=async e=>{e.preventDefault();const r=await fetch("/api/unlock",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({pin:$("#pin").value})});
  if(r.ok){st.open=true;$("#pk").hidden=true;lockUI();route()}else $("#pe").textContent=r.status==404?"PIN não configurado":r.status==429?"aguarde um minuto":"senha incorreta"}}
async function route(){closeNow();const n=++tok,[p,...r]=location.hash.replace(/^#\/?/,"").split("/"),a=decodeURIComponent(r.join("/"));let h;
 try{h=p==="artist"?await artist(a):p==="album"?await album(a):p==="search"?await search(a):p==="playlists"?await pls():p==="playlist"?await pl(a):await home()}catch(e){h='<p class="empty">Não foi possível carregar.</p>'}
 if(n===tok){view.innerHTML=h;scrollTo(0,0);mark()}}
addEventListener("hashchange",route);

/* ações */
const act={play:toggle,prev,next:()=>next(),
 sh:()=>{st.sh=!st.sh;sync()},
 rp:()=>{st.rp={off:"all",all:"one",one:"off"}[st.rp];sync()},
 now:()=>{if(!st.q.length)return;nowEl.hidden=false;document.body.style.overflow="hidden";$("#ncl").focus()},
 close:()=>{closeNow();$('[data-a="now"]').focus()},
 secret:()=>secret(),mute:()=>{muted=!muted;applyVol()},rate:()=>{rate=RATES[(RATES.indexOf(rate)+1)%RATES.length];ls.set("rx_rate",rate);applyRate()},bk:()=>skip(-10),fw:()=>skip(10),
 add:b=>openPick([b.dataset.id]),addall:()=>openPick(cur.map(t=>t.id)),pkx:()=>$("#pk").hidden=true,
 addto:async b=>{await post(`/api/playlists/${b.dataset.p}/tracks`,{ids:pick});$("#pk").hidden=true;toast("adicionada à playlist")},
 addnew:async()=>{const n=prompt("nome da playlist");if(!n)return;const r=await post("/api/playlists",{name:n});await post(`/api/playlists/${r.id}/tracks`,{ids:pick});$("#pk").hidden=true;toast("playlist criada")},
 newpl:async()=>{const n=prompt("nome da playlist");if(n){await post("/api/playlists",{name:n});route()}},
 plren:async()=>{const n=prompt("novo nome",curPlName);if(n){await post("/api/playlists/"+curPl,{name:n},"PUT");route()}},
 pldel:async()=>{if(confirm("apagar esta playlist?")){await fetch("/api/playlists/"+curPl,{method:"DELETE"});location.hash="#/playlists"}},
 rm:async b=>{await fetch(`/api/playlists/${curPl}/tracks/${b.dataset.id}`,{method:"DELETE"});route()},
 pt:b=>playList(cur,+b.dataset.i),
 pa:b=>{if(!cur.length)return;if(b.dataset.sh){st.sh=true;sync()}playList(cur,b.dataset.sh?Math.floor(Math.random()*cur.length):0)},
 rescan:async b=>{b.textContent="atualizando...";b.disabled=true;await fetch("/api/rescan",{method:"POST"});route()}};
document.addEventListener("click",e=>{if(e.target.closest(".np a"))closeNow();const b=e.target.closest("[data-a]");if(b)act[b.dataset.a](b)});
document.addEventListener("keydown",e=>{if(e.code==="Space"&&!e.target.closest("input,button,a,textarea")){e.preventDefault();toggle()}});
$("#sf").onsubmit=e=>{e.preventDefault();const q=$("#q").value.trim();if(q)location.hash="#/search/"+encodeURIComponent(q)};
document.addEventListener("keydown",e=>{if(e.key==="Escape"&&!nowEl.hidden)act.close()});
document.addEventListener("keydown",e=>{if(e.ctrlKey||e.metaKey||e.altKey||e.target.closest("input,textarea,select"))return;const k=e.key,on=st.q.length>0;
 if(k==="m")act.mute();else if(k==="n")next();else if(k==="p")prev();else if(on&&k==="ArrowLeft")skip(-10);else if(on&&k==="ArrowRight")skip(10);else if(on&&k==="ArrowUp")setVol(vol+5);else if(on&&k==="ArrowDown")setVol(vol-5);else return;e.preventDefault()});
applyVol();applyRate();setTicker();route();api("/api/state").then(s=>{st.open=s.open;lockUI()}).catch(()=>{});
if("serviceWorker"in navigator&&isSecureContext)navigator.serviceWorker.register("/sw.js").catch(()=>{});
