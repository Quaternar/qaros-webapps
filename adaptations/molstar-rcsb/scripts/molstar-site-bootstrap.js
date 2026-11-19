window.__qarMolstarSiteConfig=Object.freeze({"id":"rcsb","label":"RCSB PDB","name":"qaros-rcsb-pdb-molstar-v1-preview","addressPattern":"https://www.rcsb.org/3d-view/*","example":"https://www.rcsb.org/3d-view/1CBS","viewerHeight":640});
// Experimental discovery only. Not injected into the active MolView profile.
(() => {
  function pageKind(address) {
    try {
      const u=new URL(address);
      if(u.protocol!=='https:')return null;
      if((u.hostname==='www.rcsb.org'||u.hostname==='rcsb.org') && u.pathname.startsWith('/3d-view/'))return 'rcsb';
      if(u.hostname==='www.ebi.ac.uk' && /^\/pdbe\/entry\/pdb\/[^/]+\/3d\/?$/.test(u.pathname))return 'pdbe';
      if((u.hostname==='alphafold.ebi.ac.uk'||u.hostname==='www.alphafold.ebi.ac.uk') && u.pathname.startsWith('/entry/'))return 'alphafold';
    }catch(_){}
    return null;
  }
  function visible(canvas,w) {
    if(!canvas || canvas.isConnected===false)return false;
    const r=canvas.getBoundingClientRect?.();
    if(!r || !(r.width>0 && r.height>0))return false;
    const style=w.getComputedStyle?.(canvas);
    return style?.visibility!=='hidden' && style?.display!=='none';
  }
  function discover(root=window) {
    const candidates=[],seenPlugins=new Set(),visited=new Set();
    function add(plugin,source,w,contextName) {
      const canvas=plugin?.canvas3dContext?.canvas||plugin?.canvas3d?.webgl?.gl?.canvas;
      if(!plugin?.canvas3dContext?.passes?.draw || !visible(canvas,w) || seenPlugins.has(plugin))return;
      seenPlugins.add(plugin);candidates.push({plugin,canvas,source,contextName});
    }
    function walk(w,depth) {
      if(!w || depth>8 || visited.has(w))return;visited.add(w);
      let doc;try{doc=w.document;}catch(_){return;}
      if(!doc)return;
      // A global lexical binding is not a window property. A TDZ error must
      // not prevent the independent DOM lookup or traversal of other frames.
      try {
        if(w===window && /(^|\.)rcsb\.org$/.test(w.location.hostname) && typeof viewer!=='undefined')add(viewer.plugin,'rcsb-lexical',w);
      }catch(_){}
      try{add(w.viewer?.plugin,'window-viewer',w);}catch(_){}
      for(const canvas of doc.querySelectorAll('canvas')) {
        for(let e=canvas;e;e=e.parentElement) {
          try {
            const p=e.viewerInstance?.plugin;
            if(p?.canvas3d?.webgl?.gl?.canvas===canvas)add(p,'pdbe-dom',w);
          }catch(_){}
        }
      }
      const names=[...doc.querySelectorAll('mvs-stories-viewer')].map(e=>e.getAttribute('context-name')||undefined);
      for(const name of new Set(names.length?names:[undefined])) {
        try {
          for(const v of w.mvsStories?.getContext(name)?.state.viewers.value||[])add(v.model?.plugin,'stories-context',w,name||'default');
        }catch(_){}
      }
      for(const frame of doc.querySelectorAll('iframe')) {
        try{walk(frame.contentWindow,depth+1);}catch(_){}
      }
    }
    walk(root,0);return candidates;
  }
  function find(root=window) {
    const found=discover(root);return found.length===1?found[0].plugin:null;
  }
  window.__qarMolstarSites=Object.freeze({version:2,pageKind,discover,find});
  window.__qarFindMolstarPlugin=find;
})();

// Read-only prototype checks. A passing result does not certify XR streaming.
(() => {
  function inspect(plugin,ctx=null) {
    const c=plugin?.canvas3d,draw=plugin?.canvas3dContext?.passes?.draw;
    const checks={webgl2:c?.webgl?.isWebGL2===true,
      drawRender:typeof draw?.render==='function',drawConstructor:typeof draw?.constructor==='function' && draw.constructor.name!=='Object',
      resize:typeof draw?.setSize==='function',transparency:typeof draw?.setTransparency==='function',
      finalColor:typeof draw?.getColorTarget==='function',
      nativeDepth:draw?.packedDepth===false && typeof draw?.depthTextureOpaque?.bind==='function'};
    const rendererMethods=['setOcclusionTest','setTransparentBackground','setDrawingBufferSize','setPixelRatio','setViewport','update'];
    const renderer=ctx?.renderer;
    if(ctx) {
      checks.capturedScene=!!ctx.scene && Array.isArray(ctx.scene.renderables);
      for(const name of rendererMethods)checks['renderer.'+name]=typeof renderer?.[name]==='function';
      checks.uncull=checks.capturedScene && ctx.scene.renderables.every(r=>typeof r.uncull==='function');
    }
    const issues=Object.entries(checks).filter(([,passed])=>!passed).map(([name])=>name);
    if(c?.props?.illumination?.enabled)issues.push('progressive-illumination');
    if(ctx?.scene?.volumes?.renderables.length)issues.push('direct-volume-rendering');
    return {checks,issues,prototypeCompatible:issues.length===0 && !!ctx,needsContextCapture:!ctx,
      contextCaptured:!!ctx,hasFrame:ctx?!!ctx.frame:null,rendererUpdateArity:renderer?.update?.length??null,
      bloomLayout:draw?.bloom?'draw-pass':draw?.postprocessing?.bloom?'postprocessing':'unknown',
      liveXRVerified:false};
  }
  window.__qarInspectMolstarCapabilities=inspect;
})();

// Draft site hooks. Loaded only by the three offline-generated site profiles.
(() => {
  const config=window.__qarMolstarSiteConfig,sites=window.__qarMolstarSites;
  if(!config || !sites)throw Error('QAR site profile: missing configuration/discovery');
  const identities=new WeakMap();let serial=0;
  const styled=new WeakSet();
  function supportsPage(){return sites.pageKind(window.location.href)===config.id;}
  function identity(value) {
    if(value===null || typeof value!=='object')return String(value);
    if(!identities.has(value))identities.set(value,++serial);
    return identities.get(value);
  }
  function cellKey(ref) {
    if(!ref)return null;
    const cell=ref.cell||ref,transform=cell.transform;
    return [transform?.ref??identity(cell),transform?.version??ref.version??identity(cell.obj?.data??cell)];
  }
  function sceneKey(plugin) {
    if(!plugin)return null;
    const snapshot=plugin.managers?.snapshot?.state.current||null;
    const structures=plugin.managers?.structure?.hierarchy?.current?.structures;
    if(structures?.length) {
      const roots=structures.map(s=>[cellKey(s),cellKey(s.transform)]);
      roots.sort((a,b)=>{const x=JSON.stringify(a),y=JSON.stringify(b);return x<y?-1:x>y?1:0;});
      return JSON.stringify([config.id,snapshot,roots]);
    }
    // Bare viewers without the hierarchy manager still refit when bounds change.
    // Quantization avoids re-fitting due to harmless floating-point noise.
    const bounds=plugin.canvas3d?.boundingSphereVisible;
    const values=bounds?[...bounds.center,bounds.radius]:[];
    const quantized=values.map(v=>Number.isFinite(v)?Math.round(v*1000)/1000:null);
    return JSON.stringify([config.id,snapshot,quantized]);
  }
  const prefix=`html[data-qar-molstar-site="${config.id}"]`;
  const layoutCss=`
    ${prefix},${prefix} body{width:1024px!important;height:1024px!important;max-width:1024px!important;min-height:0!important;}
    ${prefix}{overflow:hidden!important;}
    ${prefix} body{position:relative;overflow:auto!important;}
    ${prefix} .qar-molstar-site-viewer{position:relative!important;height:${config.viewerHeight}px!important;min-height:${config.viewerHeight}px!important;max-height:${config.viewerHeight}px!important;max-width:100%!important;}
    ${prefix} .qar-molstar-site-viewer .msp-layout-expanded{position:absolute!important;inset:0!important;width:100%!important;height:100%!important;}
  `;
  function layoutRoot(plugin,canvas) {
    for(let e=canvas;e;e=e.parentElement) {
      try{if(e.viewerInstance?.plugin===plugin || (config.id==='rcsb' && e.id==='viewer'))return e;}catch(_){}
    }
    return canvas.closest?.('.msp-plugin')||null;
  }
  function find(root=window) {
    if(!supportsPage())return null;
    const candidates=sites.discover(root);
    if(candidates.length!==1) {
      window.__qarMolstarSiteStatus={phase:candidates.length?'ambiguous':'loading',candidates:candidates.length};return null;
    }
    const found=candidates[0],p=found.plugin;
    const capabilities=window.__qarInspectMolstarCapabilities(p);
    if(capabilities.issues.length)throw Error('QAR site profile: unsupported Mol* capabilities: '+capabilities.issues.join(', '));
    const element=layoutRoot(p,found.canvas);
    if(!element){window.__qarMolstarSiteStatus={phase:'layout-root-missing',candidates:1};return null;}
    if(!styled.has(element)){element.classList.add('qar-molstar-site-viewer');styled.add(element);}
    window.__qarMolstarSiteStatus={phase:'attached',site:config.id,candidates:1};
    return {plugin:p,context:null,mode:'site',name:config.id};
  }
  function mountLayout() {
    if(!supportsPage())return true;
    const parent=document.head||document.documentElement;
    if(!parent || !document.documentElement)return false;
    document.documentElement.setAttribute('data-qar-molstar-site',config.id);
    if(!document.getElementById('qar-molstar-site-layout')) {
      const style=document.createElement('style');style.id='qar-molstar-site-layout';style.textContent=layoutCss;parent.appendChild(style);
    }
    return true;
  }
  if(!mountLayout()) {
    let observer;
    if(typeof MutationObserver!=='undefined') {
      observer=new MutationObserver(()=>{if(mountLayout())observer.disconnect();});
      observer.observe(document,{childList:true,subtree:true});
    }
    document.addEventListener('DOMContentLoaded',()=>{observer?.disconnect();mountLayout();},{once:true});
  }
  window.__qarMolstarSiteAdapter=Object.freeze({config,supportsPage,find,sceneKey,layoutCss});
})();
