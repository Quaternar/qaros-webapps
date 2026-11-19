// Mirrors the original strip, forwarding normalized input to its original InputSink.
window.createPrismSequencePanel=function(io){
 const image=document.getElementById('sequence-image'),surface=document.getElementById('sequence-surface');
 const wait=document.getElementById('sequence-wait'),cursor=document.getElementById('sequence-cursor');
 let active=true,meta=null,shownKey=null,loading=false,stopped=false,point=null,down=false;
 let queue=[],sending=false,lastSent=0,timer=null,generation=0,lastPressAt=-Infinity;
 function enqueue(kind,p){
   if(!p)return;
   const data=Object.assign({action:'sequence-'+kind,client:io.client},p);
   // Keep click/drag boundaries ordered, replacing only consecutive motion events.
   if(queue.length&&/^(hover|move)$/.test(kind)&&queue[queue.length-1].action===data.action)queue[queue.length-1]=data;
   else queue.push(data);
   drain();
 }
 async function drain(){
   if(sending||!queue.length)return;sending=true;
   const data=queue.shift();
   try{
     const r=await io.request('action',data);lastSent=Date.now();
     if(r.busy)io.status('Sekvenci právě ovládá jiné otevřené okno.');
     else if(r.label)showLabel(r.label);
   }catch(e){io.status(e.message);}finally{sending=false;drain();}
 }
 function showLabel(value){
   image.setAttribute('aria-label',value?value.title:'Sekvenční pruh aktuální struktury');
 }
 function aim(p){
   if(!cursor||!surface)return;
   if(!p){cursor.hidden=true;return;}
   const r=image.getBoundingClientRect(),s=surface.getBoundingClientRect();
   const scale=Math.min(r.width/meta.width,r.height/meta.height),w=meta.width*scale,h=meta.height*scale;
   cursor.hidden=false;cursor.style.left=(r.left-s.left+(r.width-w)/2+p.u*w)+'px';
   cursor.style.top=(r.top-s.top+(r.height-h)/2)+'px';cursor.style.height=h+'px';
 }
 function coords(e,clamp){
   if(!active||!meta||!meta.ready||shownKey!==meta.key||image.hidden)return null;
   const r=image.getBoundingClientRect();if(!r.width||!r.height)return null;
   // object-fit:contain can add letterboxing when QAROS resizes the window.
   // Coordinates must address the bitmap, including at a different native DPI.
   const scale=Math.min(r.width/meta.width,r.height/meta.height),w=meta.width*scale,h=meta.height*scale;
   let u=(e.clientX-r.left-(r.width-w)/2)/w,v=(e.clientY-r.top-(r.height-h)/2)/h;
   if(!clamp&&(u<0||u>1||v<0||v>1))return null;
   return {u:Math.max(0,Math.min(1,u)),v:Math.max(0,Math.min(1,v)),key:shownKey,buttons:down?1:0,
     modifiers:(e.shiftKey?1:0)|(e.ctrlKey?2:0)|(e.altKey?4:0)|(e.metaKey?8:0)};
 }
 function leave(cancel){
   const had=point||down;
   // Losing panel focus must not discard an already queued release or a completed
   // pinch. Finish at the last valid point before releasing the pointer lease.
   if(down&&point&&!cancel){down=false;enqueue('up',Object.assign({},point,{buttons:0}));}
   point=null;down=false;queue=queue.filter(x=>x.action!=='sequence-hover');aim(null);
   if(had){queue.push({action:'leave',client:io.client});drain();}
   showLabel(null);
 }
 function move(e){const p=coords(e,down);if(p){point=p;aim(p);enqueue(down?'move':'hover',point);}else if(!down)leave();}
 function press(e){
   if(e.button!==0)return;const p=coords(e,false);if(!p)return;
   e.preventDefault();lastPressAt=Date.now();down=true;p.buttons=1;point=p;aim(p);enqueue('down',p);
   if(image.setPointerCapture&&e.pointerId!==undefined)try{image.setPointerCapture(e.pointerId);}catch(_){}
 }
 function release(e){
   if(!down)return;const p=coords(e,true)||point;down=false;if(p){p.buttons=0;point=p;enqueue('up',p);}
 }
 const pointer=!!window.PointerEvent;
 image.addEventListener(pointer?'pointermove':'mousemove',move);
 image.addEventListener(pointer?'pointerdown':'mousedown',press);
 window.addEventListener(pointer?'pointerup':'mouseup',release);
 image.addEventListener(pointer?'pointerleave':'mouseleave',()=>{if(!down)leave();});
 image.addEventListener('pointercancel',()=>leave(true));
 // Some native GUI input paths deliver a tap as click without DOM press/release.
 image.addEventListener('click',e=>{if(Date.now()-lastPressAt<1500)return;const p=coords(e,false);if(!p)return;
   lastPressAt=Date.now();point=p;enqueue('down',Object.assign({},p,{buttons:1}));enqueue('up',Object.assign({},p,{buttons:0}));});
 image.addEventListener('dragstart',e=>e.preventDefault());
 image.addEventListener('wheel',e=>{const p=coords(e,false);if(!p)return;e.preventDefault();point=p;
   enqueue('wheel',Object.assign({},p,{deltaX:e.deltaX*(e.deltaMode===1?16:1),deltaY:e.deltaY*(e.deltaMode===1?16:1)}));
 },{passive:false});
 function refresh(){
   if(stopped||!active||loading||!meta||!meta.ready){schedule();return;}
   loading=true;const key=meta.key,epoch=generation;
   image.onload=()=>{loading=false;if(epoch===generation&&meta&&meta.key===key){shownKey=key;image.hidden=false;wait.hidden=true;}schedule();};
   image.onerror=()=>{loading=false;if(epoch===generation){leave();image.hidden=true;shownKey=null;wait.hidden=false;wait.textContent='Načítám…';}schedule();};
   io.request('sequence-frame', {key}).then(png=>{
     if(epoch===generation)image.src=png;
     else {loading=false;schedule();}
   },()=>image.onerror());
 }
 function schedule(){clearTimeout(timer);if(!stopped)timer=setTimeout(refresh,350);}
 setInterval(()=>{if(active&&point&&!sending&&!queue.length&&Date.now()-lastSent>400)enqueue(down?'move':'hover',point);},250);
 window.addEventListener('blur',()=>leave());
 window.addEventListener('pagehide',()=>{stopped=true;clearTimeout(timer);leave();});
 return {
   update(value){
     const changed=!meta||!value||meta.key!==value.key;
     if(changed){leave();shownKey=null;image.hidden=true;wait.hidden=false;generation++;}
     meta=value;
     if(value&&value.error){wait.textContent='Pruh není dostupný';image.title=value.error;}
     if(value&&value.ready&&!point)showLabel(value.label);
     if(changed&&!loading)refresh();
   },
   activate(value){active=value;if(!active)leave();else refresh();},leave
 };
};
