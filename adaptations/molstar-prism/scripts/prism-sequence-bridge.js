// Mirror the actual Seq* canvases and feed Seq*'s original DOM-free InputSink.
// PointerType and PointerInput follow @molstar/seq-viewer/src/input.ts.
(() => {
 if(location.hostname!=='molstar.org'||!location.pathname.startsWith('/prism-preview/'))return;
 try{const old=window.__qarPrismSequence;if(old?.clear)old.clear();else old?.leave();}catch(_){}
 let paint=null,inspection=null;
 const inspectionOwner='qaros-inspect';
 const keyOf=shown=>shown.ref+'|'+shown.complex+'|'+shown.section;
 function context(){
   const q=window.molstar?.viewer?.views?.sequence?.viewers?.value?.get?.();
   const shown=q?.structure?.value;
   if(!shown||!q.seq?.input?.pointer)throw Error('Sekvence se ještě připravuje');
   const seq=q.seq,section=seq.layout.sectionIndex(shown.section),vp=seq.viewports.get(shown.section)?.live.current;
   if(section<0||!vp?.width||!vp?.height)throw Error('Původní sekvenční pruh není připravený');
   return {q,seq,shown,section,vp};
 }
 function surface(){
   const list=[document];
   for(let i=0;i<list.length;i++)for(const e of list[i].querySelectorAll('*'))if(e.shadowRoot)list.push(e.shadowRoot);
   const canvas=list.flatMap(r=>[...r.querySelectorAll('canvas[data-pass="main"]')]).find(c=>c.width>0&&c.height>0);
   if(!canvas)throw Error('Původní sekvenční pruh není zobrazený');
   return {main:canvas,overlay:canvas.parentElement.querySelector('canvas[data-pass="overlay"]')};
 }
 function info(){
   const {q,seq,shown,vp}=context(),label=seq.labels.current.value;
   return {ready:true,key:keyOf(shown),title:shown.title,width:vp.width,height:vp.height,
     inspectionHeld:!!inspection&&inspection.key===keyOf(shown),
     tracks:q.tracks.value.filter(t=>!t.hidden).map(t=>({ref:t.ref,label:t.label})),
     label:label?{title:label.title,lines:label.lines.map(l=>({key:l.key,value:l.value}))}:null};
 }
 function frame(){
   const meta=info(),{main,overlay}=surface();
   if(main.width>4096||main.height>1024)throw Error('Sekvenční obraz je příliš velký');
   if(!paint)paint=document.createElement('canvas');
   if(paint.width!==main.width)paint.width=main.width;
   if(paint.height!==main.height)paint.height=main.height;
   const c=paint.getContext('2d');c.clearRect(0,0,paint.width,paint.height);c.drawImage(main,0,0);
   if(overlay?.width&&overlay?.height)c.drawImage(overlay,0,0);
   return {...meta,width:paint.width,height:paint.height,png:paint.toDataURL('image/png')};
 }
 function point(data){
   const c=context();
   if(data.key!==info().key)throw Error('Zobrazená sekvence se změnila; počkej na obnovení pruhu');
   if(!Number.isFinite(data.u)||!Number.isFinite(data.v)||data.u<0||data.u>1||data.v<0||data.v>1)throw Error('Neplatné místo sekvence');
   return {...c,x:Math.min(c.vp.width-.001,data.u*c.vp.width),y:Math.min(c.vp.height-.001,data.v*c.vp.height)};
 }
 function input(action,data){
   const p=point(data),type={hover:1,down:0,move:1,up:2,cancel:3}[action];
   if(type===undefined)throw Error('Neznámý vstup sekvence');
   if(inspection&&inspection.key!==keyOf(p.shown)){p.seq.hover.clear(inspectionOwner);inspection=null;}
   p.seq.input.pointer({type,section:p.section,x:p.x,y:p.y,buttons:data.buttons===1?1:0,
     button:action==='down'||action==='up'?0:-1,modifiers:Number.isInteger(data.modifiers)?data.modifiers&15:0,
     time:performance.now(),pointerId:717,overX:0,overY:0,native:null});
   if(action==='hover'||action==='move'||action==='up'){
     const loci=p.seq.hover.toLoci();
     if(loci)inspection={key:keyOf(p.shown),loci};
   }
   return {ok:true,...info()};
 }
 function wheel(data){
   const p=point(data);
   if(!Number.isFinite(data.deltaX)||!Number.isFinite(data.deltaY))throw Error('Neplatný posun sekvence');
   const handled=p.seq.input.wheel({section:p.section,x:p.x,y:p.y,deltaX:Math.max(-2000,Math.min(2000,data.deltaX)),
     deltaY:Math.max(-2000,Math.min(2000,data.deltaY)),modifiers:Number.isInteger(data.modifiers)?data.modifiers&15:0,time:performance.now(),native:null});
   return {ok:true,handled};
 }
 function leave(){
   const q=window.molstar?.viewer?.views?.sequence?.viewers?.value?.get?.(),s=q?.seq,shown=q?.structure?.value;
   if(s&&shown){
     const section=s.layout.sectionIndex(shown.section);s.input.cancel(section);s.input.leave(section);
     // A headset user must be able to lower their hand and inspect the molecule.
     // Keep the original hit's loci, using the original cross-view highlight link.
     if(inspection?.key===keyOf(shown))s.hover.setLoci(inspection.loci,inspectionOwner);
     else inspection=null;
   }
   return {ok:true};
 }
 function clear(){
   inspection=null;leave();
   const q=window.molstar?.viewer?.views?.sequence?.viewers?.value?.get?.();
   q?.seq?.hover.clear(inspectionOwner);
   return {ok:true};
 }
 window.__qarPrismSequence=Object.freeze({info,frame,input,wheel,leave,clear});
 return {installed:true,sequence:'original SeqViewer InputSink and canvases'};
})()
