// Exact SceneNode model used by Prism's Structure tree; no second renderer.
(() => {
 if(location.hostname!=='molstar.org'||!location.pathname.startsWith('/prism-preview/'))return;
 try{window.__qarPrismControls?.dispatch?.('clear');}catch(_){}
 const scene=()=>{
   const m=window.molstar?.viewer?.views?.scene;
   if(!m?.roots||typeof m.pick!=='function')throw Error('Prism Structure model is not available yet');
   return m;
 };
 function nodes(visibleOnly=false) {
   const out=[],pending=[...scene().roots.value].reverse().map(node=>({node,level:1}));
   while(pending.length&&out.length<5000){
     const entry=pending.pop(),{node,level}=entry;out.push(entry);
     if(!visibleOnly||node.isExpanded.value)
       pending.push(...[...node.children.value].reverse().map(node=>({node,level:level+1})));
   }
   return out;
 }
 function snapshot() {
   const s=window.__qarAdaptationState,m=scene();
   return {url:location.href,ready:!!window.molstar?.viewer?.state?.ready?.value,
     renderer:{ready:!!s?.ready,frames:s?.frames||0,error:s?.error||null},
     rows:nodes(true).slice(0,500).map(({node:n,level})=>({
       id:n.id,label:n.label.value,description:n.description.value||'',level,
       expanded:n.lazy||n.children.value.length?n.isExpanded.value:null,
       selected:m.picked.value?.id===n.id,visible:!n.isHidden.value,canToggleVisibility:n.hasEye!==false
     }))};
 }
 let hovered=null;
 function dispatch(action,id) {
   if(action==='clear'||action==='leave'){
     if(hovered)hovered.highlight(false);hovered=null;return {ok:true};
   }
   const m=scene(),node=nodes().find(e=>e.node.id===id)?.node;
   if(!node)throw Error('The Structure item no longer exists');
   if(action==='hover'){
     if(hovered!==node&&hovered)hovered.highlight(false);
     hovered=node;node.highlight(true);
   }else if(action==='click')m.pick(node);
   else if(action==='expand')node.toggleExpanded();
   else if(action==='visibility')node.toggleVisibility();
   else throw Error('Unknown Structure action');
   return {ok:true};
 }
 window.__qarPrismControls=Object.freeze({snapshot,dispatch});
 return {installed:true,model:'Prism SceneNode'};
})()
