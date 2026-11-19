(() => {
 // A spatial strip has no editable/selectable document content. WebKit may
 // otherwise select the whole image/body on a long pinch, leaving a blue tint.
 // This clears only the HTML selection, never the inspected Mol* loci.
 function clearDocumentSelection(){
   try{const s=window.getSelection&&window.getSelection();if(s&&s.rangeCount)s.removeAllRanges();}catch(_){}
 }
 function cancelDocumentSelection(e){e.preventDefault();clearDocumentSelection();}
 for(const name of ['selectstart','dragstart','contextmenu'])document.addEventListener(name,cancelDocumentSelection,true);
 document.addEventListener('selectionchange',clearDocumentSelection);
 for(const name of ['pointerdown','mousedown','touchstart'])document.addEventListener(name,clearDocumentSelection,{capture:true,passive:true});
 document.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&String(e.key).toLowerCase()==='a')cancelDocumentSelection(e);},true);
 for(const name of ['focus','blur','pageshow'])window.addEventListener(name,clearDocumentSelection);
 clearDocumentSelection();
 window.__qarPanelSelectionGuard={version:1,clear:clearDocumentSelection};
 const webCrypto=window.crypto;
 const client=webCrypto&&typeof webCrypto.randomUUID==='function'?webCrypto.randomUUID():('panel-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2));
 const image=document.getElementById('sequence-image'),wait=document.getElementById('sequence-wait');
 let stopped=false;
 async function request(route,data){
   if(route==='sequence-state')return {sequence:await qaros.app.call('sequenceInfo')};
   if(route==='sequence-frame')return qaros.app.call('sequenceFrame',data.key);
   return qaros.app.call('sequenceInput',data);
 }
 function status(text){image.title=text;if(image.hidden)wait.textContent='Pruh není dostupný';}
 const sequence=window.createPrismSequencePanel({request,client,status});
 async function poll(){
   if(stopped)return;
   try{const s=await request('sequence-state');sequence.update(s.sequence);}
   catch(e){sequence.update(null);status(e.message);}
   setTimeout(poll,750);
 }
 window.addEventListener('pagehide',()=>{stopped=true;});
 poll();
})();
