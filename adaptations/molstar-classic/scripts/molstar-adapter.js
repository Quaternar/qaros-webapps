// MolViewStories v2: standalone named contexts, builder, and loading-safe frames.
(() => {
  if(location.hostname!=='molstar.org'||!(location.pathname==='/viewer'||location.pathname.startsWith('/viewer/')))return;
  const previous=window.__qarAdaptationState;
  let retainedFit=previous?.plugin && previous.center?{plugin:previous.plugin,fields:{
    center:previous.center,modelScale:previous.modelScale,originalRadius:previous.originalRadius,
    sceneKey:previous.sceneKey,sceneFromRoom:previous.sceneFromRoom,
    presentation:previous.presentation,presentationCenter:previous.presentationCenter}}:null;
  if(previous?.dispose)previous.dispose();
  else previous?.renderFrameLoop?.stop(); // v1 had no dispose hook
  const core = window.__qarAdaptationCore;
  const state = window.__qarAdaptationState = { version: 2, revision: 6, ready: false, frames: 0, loadingFrames: 0, status: 'loading', error: null, modelScale: 1 };
  state.integration='classic-v5';
  let pass = null, programs = null;
	function createTexture(gl, internalFormat, width, height) {
		const texture = gl.createTexture();
		gl.bindTexture(gl.TEXTURE_2D, texture);
		gl.texStorage2D(gl.TEXTURE_2D, 1, internalFormat, width, height);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
		return texture;
	}

	function ensurePass(gl, width, height) {
		if (pass && pass.width === width && pass.height === height) {
			return pass;
		}
		if (pass) {
			gl.deleteFramebuffer(pass.framebuffer);
			gl.deleteTexture(pass.color);
			gl.deleteTexture(pass.depth);
		}
		const color = createTexture(gl, gl.RGBA8, width, height);
		const depth = createTexture(gl, gl.DEPTH_COMPONENT24, width, height);
		const framebuffer = gl.createFramebuffer();
		gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
		gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, color, 0);
		gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, depth, 0);
		const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
		gl.bindFramebuffer(gl.FRAMEBUFFER, null);
		if (status !== gl.FRAMEBUFFER_COMPLETE) {
			throw new Error(`QAR adaptation: eye framebuffer incomplete (0x${status.toString(16)})`);
		}
		pass = { width, height, color, depth, framebuffer };
		return pass;
	}

	const fullScreenVertex = `#version 300 es
		void main() {
			vec2 corner = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
			gl_Position = vec4(corner * 2.0 - 1.0, 0.0, 1.0);
		}`;

	// One texel per destination pixel: `source` + (pixel - `destination`). Opaque: Chromium
	// composites alpha < 1 premultiplied (atlas page) or over white (stream surface), which
	// changes the colour bytes, so the stream never depends on the app's canvas alpha.
	const copyFragment = `#version 300 es
		precision highp float;
		uniform highp sampler2D colorTexture;
		uniform ivec2 sourceOrigin;
		uniform ivec2 destinationOrigin;
		out vec4 outColor;
		void main() {
			outColor = vec4(texelFetch(colorTexture, sourceOrigin + ivec2(gl_FragCoord.xy) - destinationOrigin, 0).rgb, 1.0);
		}`;

	// Row 0 of the packed rectangle is the view's top row, the same atlas convention every colour
	// view relies on. One depth texel per half-resolution sample, never a filtered blend.
	const packFragment = `#version 300 es
		precision highp float;
		uniform highp sampler2D depthTexture;
		uniform ivec2 depthOrigin;
		uniform vec2 depthSize;
		uniform ivec2 destinationOrigin;
		uniform float halfWidth;
		uniform float tileHeight;
		out vec4 outColor;
		void main() {
			vec2 local = floor(gl_FragCoord.xy) - vec2(destinationOrigin);
			float halfHeight = tileHeight * 2.0;
			float packedX = local.x;
			float packedY = tileHeight - 1.0 - local.y;
			float tileIndex = packedX < halfWidth ? 0.0 : 1.0;
			float halfX = tileIndex < 0.5 ? packedX : packedX - halfWidth;
			float halfY = tileIndex < 0.5 ? packedY : packedY + tileHeight;
			vec2 eyeTexel = vec2(
				clamp(floor((halfX + 0.5) * depthSize.x / halfWidth - 0.5), 0.0, depthSize.x - 1.0),
				clamp(floor((halfY + 0.5) * depthSize.y / halfHeight - 0.5), 0.0, depthSize.y - 1.0)
			);
			eyeTexel.y = depthSize.y - 1.0 - eyeTexel.y;
			float rawDepth = texelFetch(depthTexture, depthOrigin + ivec2(eyeTexel), 0).r;
			// At depth 1, float32 rounds 16777215 + 0.5 to 16777216. Saturate before
			// splitting bytes, otherwise the far plane wraps to near-plane black.
			float scaled = min(floor(clamp(rawDepth, 0.0, 1.0) * 16777215.0 + 0.5), 16777215.0);
			outColor = vec4(
				mod(scaled, 256.0) / 255.0,
				mod(floor(scaled / 256.0), 256.0) / 255.0,
				mod(floor(scaled / 65536.0), 256.0) / 255.0,
				1.0
			);
		}`;

	// Alpha at half linear resolution, three consecutive half-resolution rows per atlas row (R, G,
	// B), each sample the mean of its 2x2 eye pixels. Opaque, so CEF keeps every byte; native
	// unpacks it into the colour view's alpha channel.
	const alphaPackFragment = `#version 300 es
		precision highp float;
		uniform highp sampler2D colorTexture;
		uniform ivec2 eyeOrigin;
		uniform ivec2 eyeSize;
		uniform ivec2 destinationOrigin;
		uniform int tileHeight;
		out vec4 outColor;
		float halfAlpha(int column, int row) {
			if (row * 2 >= eyeSize.y) return 0.0;
			float sum = 0.0;
			for (int dy = 0; dy < 2; ++dy) {
				for (int dx = 0; dx < 2; ++dx) {
					int x = min(column * 2 + dx, eyeSize.x - 1);
					int y = min(row * 2 + dy, eyeSize.y - 1);
					sum += texelFetch(colorTexture, eyeOrigin + ivec2(x, eyeSize.y - 1 - y), 0).a;
				}
			}
			return sum * 0.25;
		}
		void main() {
			ivec2 local = ivec2(gl_FragCoord.xy) - destinationOrigin;
			int row = (tileHeight - 1 - local.y) * 3;
			outColor = vec4(halfAlpha(local.x, row), halfAlpha(local.x, row + 1), halfAlpha(local.x, row + 2), 1.0);
		}`;

	function compileProgram(gl, fragmentSource, uniformNames) {
		const shader = (type, source) => {
			const object = gl.createShader(type);
			gl.shaderSource(object, source);
			gl.compileShader(object);
			if (!gl.getShaderParameter(object, gl.COMPILE_STATUS)) {
				throw new Error("QAR adaptation: shader compile failed: " + gl.getShaderInfoLog(object));
			}
			return object;
		};
		const program = gl.createProgram();
		gl.attachShader(program, shader(gl.VERTEX_SHADER, fullScreenVertex));
		gl.attachShader(program, shader(gl.FRAGMENT_SHADER, fragmentSource));
		gl.linkProgram(program);
		if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
			throw new Error("QAR adaptation: shader link failed: " + gl.getProgramInfoLog(program));
		}
		const uniforms = {};
		for (const name of uniformNames) {
			uniforms[name] = gl.getUniformLocation(program, name);
		}
		return { program, uniforms };
	}

	function ensurePrograms(gl) {
		if (programs) {
			return programs;
		}
		programs = {
			copy: compileProgram(gl, copyFragment, ["colorTexture", "sourceOrigin", "destinationOrigin"]),
			pack: compileProgram(gl, packFragment, [
				"depthTexture",
				"depthOrigin",
				"depthSize",
				"destinationOrigin",
				"halfWidth",
				"tileHeight",
			]),
			alpha: compileProgram(gl, alphaPackFragment, [
				"colorTexture",
				"eyeOrigin",
				"eyeSize",
				"destinationOrigin",
				"tileHeight",
			]),
			vertexArray: gl.createVertexArray(),
		};
		return programs;
	}

	function drawRect(gl, atlasHeight, rect) {
		const y = atlasHeight - rect.y - rect.height;
		gl.viewport(rect.x, y, rect.width, rect.height);
		gl.scissor(rect.x, y, rect.width, rect.height);
		gl.drawArrays(gl.TRIANGLES, 0, 3);
		return y;
	}

	function copyEyesToAtlas(gl, target, atlasHeight, eyes) {
		const { copy, pack, alpha, vertexArray } = ensurePrograms(gl);
		gl.bindFramebuffer(gl.FRAMEBUFFER, null);
		gl.bindVertexArray(vertexArray);
		gl.disable(gl.DEPTH_TEST);
		gl.disable(gl.BLEND);
		gl.disable(gl.CULL_FACE);
		gl.disable(gl.STENCIL_TEST);
		gl.enable(gl.SCISSOR_TEST);
		gl.colorMask(true, true, true, true);
		gl.activeTexture(gl.TEXTURE0);
		for (const eye of eyes) {
			const viewport = eye.camera.viewport;
			if (eye.color) {
				const rect = eye.color.rect;
				gl.useProgram(copy.program);
				gl.bindTexture(gl.TEXTURE_2D, target.color);
				gl.uniform1i(copy.uniforms.colorTexture, 0);
				gl.uniform2i(copy.uniforms.sourceOrigin, viewport.x, viewport.y);
				gl.uniform2i(copy.uniforms.destinationOrigin, rect.x, atlasHeight - rect.y - rect.height);
				drawRect(gl, atlasHeight, rect);
			}
			if (eye.depth) {
				const rect = eye.depth.rect;
				gl.useProgram(pack.program);
				gl.bindTexture(gl.TEXTURE_2D, target.depth);
				gl.uniform1i(pack.uniforms.depthTexture, 0);
				gl.uniform2i(pack.uniforms.depthOrigin, viewport.x, viewport.y);
				gl.uniform2f(pack.uniforms.depthSize, eye.width, eye.height);
				gl.uniform2i(pack.uniforms.destinationOrigin, rect.x, atlasHeight - rect.y - rect.height);
				gl.uniform1f(pack.uniforms.halfWidth, eye.depth.logicalWidth / 2);
				gl.uniform1f(pack.uniforms.tileHeight, rect.height);
				drawRect(gl, atlasHeight, rect);
			}
			if (eye.alpha) {
				const rect = eye.alpha.rect;
				gl.useProgram(alpha.program);
				gl.bindTexture(gl.TEXTURE_2D, target.color);
				gl.uniform1i(alpha.uniforms.colorTexture, 0);
				gl.uniform2i(alpha.uniforms.eyeOrigin, viewport.x, viewport.y);
				gl.uniform2i(alpha.uniforms.eyeSize, eye.width, eye.height);
				gl.uniform2i(alpha.uniforms.destinationOrigin, rect.x, atlasHeight - rect.y - rect.height);
				gl.uniform1i(alpha.uniforms.tileHeight, rect.height);
				drawRect(gl, atlasHeight, rect);
			}
		}
		gl.bindVertexArray(null);
	}


  // Own offscreen DrawPass targets per view; scene, renderer, shaders and effect props remain Mol*'s.
function createFullPipeline() {
  const views=new Map();
  let transfer=null;
  function track(entry,webgl,work) {
    const r=webgl.resources,originals={};
    for(const name of ['texture','framebuffer','renderbuffer']) {
      if(typeof r[name]!=='function')continue;
      originals[name]=r[name];
      r[name]=(...args)=>{const resource=originals[name](...args);entry.resources.add(resource);return resource;};
    }
    try{return work();}finally{Object.assign(r,originals);}
  }
  function release(entry) {
    for(const resource of entry.resources)resource.destroy();
    entry.resources.clear();
  }
  function getView(eye,c,scene) {
    const key=`${eye.target.id}:${eye.name}`;
    let entry=views.get(key);
    if(!entry) {
      entry={resources:new Set()};
      track(entry,c.webgl,()=>{
        // SSAO initializes uTexSize from the shared canvas, which currently holds
        // the atlas. DrawPass.setSize skips all passes when its target already
        // has the requested size. Bootstrap at a different size so the first
        // setSize initializes every pass with this eye's dimensions.
        const bootstrap=eye.width===1 && eye.height===1?2:1;
        entry.draw=new state.draw.constructor(c.webgl,state.plugin.managers.asset,
          bootstrap,bootstrap,scene.transparency);
      });
      views.set(key,entry);
    }
    track(entry,c.webgl,()=>{
      entry.draw.setSize(eye.width,eye.height);
      if(entry.draw.transparency!==scene.transparency)entry.draw.setTransparency(scene.transparency);
    });
    return entry;
  }
  function ensureTransfer(gl) {
    if(transfer)return transfer;
    const fragment=`#version 300 es
      precision highp float;
      uniform highp sampler2D finalColor;
      uniform highp sampler2D originalDepth;
      uniform ivec2 destinationOrigin;
      out vec4 outColor;
      void main() {
        ivec2 pixel=ivec2(gl_FragCoord.xy)-destinationOrigin;
        outColor=texelFetch(finalColor,pixel,0);
        gl_FragDepth=texelFetch(originalDepth,pixel,0).r;
      }`;
    transfer=compileProgram(gl,fragment,['finalColor','originalDepth','destinationOrigin']);
    transfer.vao=gl.createVertexArray();
    return transfer;
  }
  function copyFinal(gl,framebuffer,eye,color,depth) {
    const p=ensureTransfer(gl),v=eye.camera.viewport;
    const previousDepthFunc=gl.getParameter(gl.DEPTH_FUNC);
    try {
    gl.bindFramebuffer(gl.FRAMEBUFFER,framebuffer);
    gl.bindVertexArray(p.vao);gl.useProgram(p.program);
    gl.disable(gl.BLEND);gl.disable(gl.CULL_FACE);gl.disable(gl.DITHER);
    gl.enable(gl.DEPTH_TEST);gl.depthFunc(gl.ALWAYS);gl.depthMask(true);
    gl.colorMask(true,true,true,true);gl.enable(gl.SCISSOR_TEST);
    gl.viewport(v.x,v.y,v.z,v.w);gl.scissor(v.x,v.y,v.z,v.w);
    color.bind(0);depth.bind(1);
    gl.uniform1i(p.uniforms.finalColor,0);gl.uniform1i(p.uniforms.originalDepth,1);
    gl.uniform2i(p.uniforms.destinationOrigin,v.x,v.y);
    gl.drawArrays(gl.TRIANGLES,0,3);
    } finally {
      // Mol* initializes LEQUAL once; resetting its cache does not restore this invariant.
      gl.depthFunc(previousDepthFunc);
    }
  }
  return {
    render(gl,target,eye,ctx) {
      const c=state.plugin.canvas3d,entry=getView(eye,c,ctx.scene);
      if(c.props.illumination?.enabled)throw Error('QAR adaptation: progressive illumination needs its own validated per-eye history; use the standard Mol* lighting pipeline');
      const props={...state.localProps,transparentBackground:true};
      const camera={...eye.molCamera,viewport:{x:0,y:0,width:eye.width,height:eye.height}};
      resetMolstarState(c);ctx.renderer.setOcclusionTest(null);
      track(entry,c.webgl,()=>state.drawOriginal.call(entry.draw,{...ctx,camera},props,false));
      if(entry.draw.packedDepth)throw Error('QAR adaptation: the full pipeline requires a native WebGL depth texture');
      copyFinal(gl,target.framebuffer,eye,entry.draw.getColorTarget(props.postprocessing).texture,
        entry.draw.depthTextureOpaque);
      state.pipeline={mode:'original-draw-pass',occlusion:props.postprocessing.occlusion?.name,
        shadow:props.postprocessing.shadow?.name,bloom:props.postprocessing.bloom?.name,
        antialiasing:props.postprocessing.antialiasing?.name,temporalAccumulation:false,
        views:views.size};
    },
    retain(eyes) {
      const active=new Set(eyes.map(e=>`${e.target.id}:${e.name}`));
      for(const [key,entry]of views)if(!active.has(key)){release(entry);views.delete(key);}
    },
    dispose() {
      for(const entry of views.values())release(entry);
      views.clear();
      if(transfer && state.sourceGl) {
        state.sourceGl.deleteProgram(transfer.program);state.sourceGl.deleteVertexArray(transfer.vao);
      }
      transfer=null;
    }
  };
}

  const fullPipeline=createFullPipeline();

  // A real top-level WebGL presenter lets QAROS probe and capture the iframe's
  // atlas. The page-region hole keeps all original HTML controls clickable.
  const output = document.createElement('canvas');
  output.id = 'qar-molstar-atlas';
  output.width = output.height = 1024;
  output.style.cssText = 'position:fixed;left:0;top:0;width:1024px;height:1024px;pointer-events:none;z-index:2147483000;clip-path:polygon(1024px 0,100% 0,100% 100%,0 100%,0 1024px,1024px 1024px)';
  document.body.appendChild(output);
  const presenter = output.getContext('webgl2', { alpha: false, antialias: false, depth: true, preserveDrawingBuffer: true });
  if (!presenter) throw new Error('QAR adaptation: WebGL2 presenter unavailable');
  state.canvas = output;
  state.gl = presenter;
  const style = document.createElement('style');
  style.textContent = 'body{position:relative;width:1024px!important;max-width:1024px!important;height:1024px!important;min-height:0!important}.h-screen{height:1024px!important}';
  document.head.appendChild(style);
  const vertex = `#version 300 es
  out vec2 uv; void main(){ vec2 p=vec2(float((gl_VertexID<<1)&2),float(gl_VertexID&2)); uv=p; gl_Position=vec4(p*2.0-1.0,0,1); }`;
  const fragment = `#version 300 es
  precision highp float; uniform sampler2D image; in vec2 uv; out vec4 color;
  void main(){color=vec4(texture(image,uv).rgb,1);}`;
  function shader(type, text) {
    const s = presenter.createShader(type); presenter.shaderSource(s,text); presenter.compileShader(s);
    if(!presenter.getShaderParameter(s,presenter.COMPILE_STATUS)) throw new Error(presenter.getShaderInfoLog(s));
    return s;
  }
  const program=presenter.createProgram();
  presenter.attachShader(program,shader(presenter.VERTEX_SHADER,vertex));
  presenter.attachShader(program,shader(presenter.FRAGMENT_SHADER,fragment));
  presenter.linkProgram(program);
  if(!presenter.getProgramParameter(program,presenter.LINK_STATUS)) throw new Error(presenter.getProgramInfoLog(program));
  const texture=presenter.createTexture(), vao=presenter.createVertexArray();
  presenter.bindTexture(presenter.TEXTURE_2D,texture);
  presenter.texParameteri(presenter.TEXTURE_2D,presenter.TEXTURE_MIN_FILTER,presenter.NEAREST);
  presenter.texParameteri(presenter.TEXTURE_2D,presenter.TEXTURE_MAG_FILTER,presenter.NEAREST);
  presenter.texParameteri(presenter.TEXTURE_2D,presenter.TEXTURE_WRAP_S,presenter.CLAMP_TO_EDGE);
  presenter.texParameteri(presenter.TEXTURE_2D,presenter.TEXTURE_WRAP_T,presenter.CLAMP_TO_EDGE);
  function present(canvas, detail) {
    if(output.width!==detail.atlas.width) output.width=detail.atlas.width;
    if(output.height!==detail.atlas.height) output.height=detail.atlas.height;
    output.style.width=output.width+'px'; output.style.height=output.height+'px';
    presenter.bindVertexArray(vao); presenter.useProgram(program);
    presenter.activeTexture(presenter.TEXTURE0); presenter.bindTexture(presenter.TEXTURE_2D,texture);
    presenter.pixelStorei(presenter.UNPACK_FLIP_Y_WEBGL,true);
    presenter.pixelStorei(presenter.UNPACK_PREMULTIPLY_ALPHA_WEBGL,false);
    presenter.pixelStorei(presenter.UNPACK_COLORSPACE_CONVERSION_WEBGL,presenter.NONE);
    presenter.texImage2D(presenter.TEXTURE_2D,0,presenter.RGBA,presenter.RGBA,presenter.UNSIGNED_BYTE,canvas);
    presenter.uniform1i(presenter.getUniformLocation(program,'image'),0);
    presenter.viewport(0,0,output.width,output.height); presenter.disable(presenter.SCISSOR_TEST);
    presenter.disable(presenter.BLEND); presenter.disable(presenter.DEPTH_TEST);
    presenter.drawArrays(presenter.TRIANGLES,0,3);
  }

  function visible(p) {
    const canvas=p?.canvas3dContext?.canvas;
    return !!canvas?.isConnected && canvas.getBoundingClientRect().width>0 && canvas.getBoundingClientRect().height>0;
  }
  function reactPlugin(w) {
    // MolViewStories' editor keeps its PluginUIContext inside React. Only walk
    // ancestors of Mol* canvases and known plugin props; never inspect app storage.
    for(const canvas of w.document.querySelectorAll('.msp-plugin canvas')) {
      for(let e=canvas;e;e=e.parentElement) {
        const key=Object.keys(e).find(k=>/^__reactFiber\$|^__reactInternalInstance\$/.test(k));
        if(!key) continue;
        for(let f=e[key],n=0;f&&n<50;f=f.return,n++) {
          for(const p of [f.memoizedProps?.plugin,f.memoizedProps?.value,f.stateNode?.plugin])
            if(p?.canvas3dContext && visible(p)) return {plugin:p,context:null,mode:'editor'};
        }
      }
    }
    return null;
  }
  function findPlugin(w) {
    const found=reactPlugin(w);
    return found?{...found,mode:'classic'}:null;
  }
  function classicSceneKey(p) {
    const roots=p?.managers?.structure?.hierarchy?.current?.structures||[];
    return JSON.stringify([p?.managers?.snapshot?.state.current||null,roots.map(s=>[
      s.cell.transform.ref,s.cell.transform.version,s.transform?.cell?.transform?.version]).sort()]);
  }
  function detach() {
    fullPipeline.dispose();
    if(state.draw && state.draw.render===state.drawWrapper) state.draw.render=state.drawOriginal;
    state.plugin=null;state.ctx=null;state.draw=null;state.sourceCanvas=null;
    state.ready=false;state.center=null;state.sceneKey=null;state.sceneFromRoom=null;state.modelScale=1;
    state.presentation=null;state.presentationCenter=null;
    state.stableCount=undefined;state.stableKey=undefined;state.stableSince=undefined;
  }
  function attach() {
    const found=findPlugin(window), plugin=found?.plugin;
    if(!plugin) {if(state.plugin)detach();state.status='loading';return;}
    state.context=found.context;state.mode=found.mode;state.contextName=found.name;
    if(plugin===state.plugin) return;
    detach();
    const c=plugin.canvas3d, draw=plugin.canvas3dContext.passes.draw;
    if(!c.webgl.isWebGL2 || typeof draw.render!=='function') throw new Error('QAR adaptation: incompatible Mol* draw pass');
    state.plugin=plugin; state.sourceGl=c.webgl.gl; state.sourceCanvas=plugin.canvas3dContext.canvas;
    if(retainedFit?.plugin===plugin)Object.assign(state,retainedFit.fields);
    retainedFit=null;
    state.draw=draw; state.drawOriginal=draw.render;
    state.drawWrapper=function(ctx, props, ...args) {
      if(!state.inXR) {state.ctx=ctx;state.localProps=props;}
      return state.drawOriginal.call(this,ctx,props,...args);
    };
    draw.render=state.drawWrapper;
    c.requestDraw();
  }
  function refresh() {
    try {
      attach();
      const loading=!!state.context?.state.isLoading.value || !!state.plugin?.behaviors?.state?.isUpdating?.value;
      const count=state.ctx?.scene.renderables.length||0;
      const key=classicSceneKey(state.plugin);
      let placementPending=false;
      if(count && (!state.center || key!==state.sceneKey)) {
        // A snapshot can yield between several state-update tasks. Its first
        // visible batch is not necessarily the complete structure's bounds.
        const task=state.sourceCanvas?.ownerDocument?.querySelector('.msp-task-state');
        const now=performance.now();
        if(loading || task || count!==state.stableCount || key!==state.stableKey) {
          state.stableSince=now;state.stableCount=count;state.stableKey=key;
        }
        placementPending=loading||!!task||now-state.stableSince<1000;
      }
      state.placementPending=loading||placementPending;
      // Mol* keeps drawing committed geometry while its asynchronous snapshot
      // transition updates the scene. Once fitted, render that live geometry
      // with current eye poses; only defer the next bounds/scale calculation.
      state.ready=!!state.ctx && !!count && (!!state.center || !state.placementPending);
      state.status=state.ready?(state.placementPending?'transitioning':'ready'):(state.placementPending?'loading':'empty');
    } catch(error) {state.error=String(error);state.ready=false;state.status='error';}
  }
  const discovery=setInterval(refresh,250);
  refresh();

  function multiply(a,b) {
    const out=new Float32Array(16);
    for(let col=0;col<4;col++) for(let row=0;row<4;row++)
      for(let k=0;k<4;k++) out[col*4+row]+=a[k*4+row]*b[col*4+k];
    return out;
  }
  function inverse(matrix) {
    const rows=Array.from({length:4},(_,r)=>Array.from({length:8},(_,c)=>c<4?matrix[c*4+r]:(c-4===r?1:0)));
    for(let col=0;col<4;col++) {
      let pivot=col;for(let r=col+1;r<4;r++)if(Math.abs(rows[r][col])>Math.abs(rows[pivot][col]))pivot=r;
      if(Math.abs(rows[pivot][col])<1e-20)throw Error('QAR adaptation: singular eye projection');
      [rows[col],rows[pivot]]=[rows[pivot],rows[col]];
      const d=rows[col][col];for(let j=0;j<8;j++)rows[col][j]/=d;
      for(let r=0;r<4;r++)if(r!==col){const f=rows[r][col];for(let j=0;j<8;j++)rows[r][j]-=f*rows[col][j];}
    }
    return new Float32Array(Array.from({length:16},(_,i)=>rows[i%4][4+Math.floor(i/4)]));
  }
  function sceneBasis(camera) {
    const normalize=v=>{const n=Math.hypot(...v);if(n<1e-8)throw Error('QAR adaptation: degenerate initial camera basis');return v.map(x=>x/n);};
    const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
    const back=normalize(camera.position.map((v,i)=>v-camera.target[i]));
    const right=normalize(cross(camera.up,back)),up=cross(back,right);
    // A proper rotation from the authored view to the room axes.
    return {right,up,back};
  }
  function updatePresentation(c) {
    const snapshots=state.plugin?.managers?.snapshot?.state;
    const key=classicSceneKey(state.plugin);
    const animation=state.plugin?.managers?.animation?.state?.animationState==='playing';
    const trackball=c.props?.trackball?.animate?.name;
    const playing=!!snapshots?.isPlaying || animation || (!!trackball && trackball!=='off');
    const wasPlaying=state.presentation?.playing;
    if(!playing && !wasPlaying) return;
    let motion=state.presentation;
    if(!motion || motion.key!==key) {
      const entry=snapshots?.entries?.find?.(e=>e.snapshot.id===key);
      const authored=entry?.snapshot.camera?.current||c.camera.state;
      const basis=sceneBasis(authored),delta=authored.position.map((v,i)=>v-state.center[i]);
      const dot=a=>a.reduce((sum,v,i)=>sum+v*delta[i],0);
      motion=state.presentation={key,offset:[dot(basis.right),dot(basis.up),dot(basis.back)]};
    }
    const camera=c.camera.state,basis=sceneBasis(camera),offset=motion.offset;
    // Apply authored camera motion to the shared model. Head poses remain
    // independent; every target observes the same animation at the same time.
    state.sceneFromRoom=basis;
    state.presentationCenter=camera.position.map((v,i)=>v-basis.right[i]*offset[0]-basis.up[i]*offset[1]-basis.back[i]*offset[2]);
    motion.playing=playing;
  }
  function eyeCamera(protocol, viewport) {
    const {pose,fov,nearFar}=protocol, [x,y,z,w]=pose.orientation;
    const center=state.presentationCenter||state.center, scale=state.modelScale;
    const basis=state.sceneFromRoom||{right:[1,0,0],up:[0,1,0],back:[0,0,1]};
    const p=center.map((v,i)=>v*scale+basis.right[i]*pose.position[0]+basis.up[i]*pose.position[1]+basis.back[i]*pose.position[2]);
    // Inverse rigid transform. Fresh matrices per eye; never change the app camera.
    const roomView=new Float32Array([
      1-2*(y*y+z*z),2*(x*y-z*w),2*(x*z+y*w),0,
      2*(x*y+z*w),1-2*(x*x+z*z),2*(y*z-x*w),0,
      2*(x*z-y*w),2*(y*z+x*w),1-2*(x*x+y*y),0,0,0,0,1]);
    const {right,up,back}=basis;
    const roomFromScene=new Float32Array([right[0],up[0],back[0],0,right[1],up[1],back[1],0,right[2],up[2],back[2],0,0,0,0,1]);
    const view=multiply(roomView,roomFromScene);
    for(let i=0;i<3;i++) view[12+i]=-(view[i]*p[0]+view[4+i]*p[1]+view[8+i]*p[2]);
    const n=nearFar.near,f=nearFar.far;
    const l=Math.tan(fov.angleLeft)*n,r=Math.tan(fov.angleRight)*n,t=Math.tan(fov.angleUp)*n,b=Math.tan(fov.angleDown)*n;
    if(!(n>0) || f===n) throw new Error('QAR adaptation: invalid near/far');
    const a=Number.isFinite(f)?-(f+n)/(f-n):-1, d=Number.isFinite(f)?-2*f*n/(f-n):-2*n;
    const projection=new Float32Array([2*n/(r-l),0,0,0,0,2*n/(t-b),0,0,(r+l)/(r-l),(t+b)/(t-b),a,-1,0,0,d,0]);
    const forward=[-view[2],-view[6],-view[10]];
    const projectionView=multiply(projection,view),local=state.plugin?.canvas3d?.camera;
    // Fog intensity is authored; its distances belong to this eye, not the PC camera.
    // This is Camera.updateClip's fog formula, with the room-centred scene as target.
    const fog=local?.state?.fog||0;
    const fogRadius=Math.max((local?.state?.clipFar?local.state.radius:local?.state?.radiusMax)||state.originalRadius||1,local?.state?.minFar||0)*scale;
    const distance=Math.hypot(...p.map((v,i)=>v-state.center[i]*scale));
    return {view,projection,projectionView,inverseProjectionView:inverse(projectionView),
      viewport:{x:viewport.x,y:viewport.y,width:viewport.z,height:viewport.w},
      near:n,far:f,fogNear:fog?distance+fogRadius*(50-fog)/50:0,fogFar:fog?distance+fogRadius:1e9,scale,minTargetDistance:0,forceFull:true,disabled:false,
      state:{...local?.state,mode:'perspective',position:p.map(v=>v/scale),target:p.map((v,i)=>(v+forward[i])/scale),up:[view[1],view[5],view[9]]},
      viewOffset:{enabled:false},headRotation:new Float32Array(16),viewEye:new Float32Array(16),isAsymmetricProjection:true};
  }
  function collectEyes(targets) {
    const eyes=[];let width=0,rowY=0;
    for(const target of targets) {
      const map=new Map();let rowX=0,rowHeight=0;
      for(const v of target.views) {
        const side=v.eye==='right'?'right':'left';
        const e=map.get(side)||{name:side,target};e[v.dataType]=v;map.set(side,e);
      }
      for(const e of map.values()) {
        const v=e.color||e.depth||e.alpha;e.width=v.logicalWidth;e.height=v.logicalHeight;
        const viewport={x:rowX,y:rowY,z:e.width,w:e.height};
        e.camera={viewport}; e.molCamera=eyeCamera(target.cameras[e.name],viewport);
        rowX+=e.width;rowHeight=Math.max(rowHeight,e.height);eyes.push(e);
      }
      width=Math.max(width,rowX);rowY+=rowHeight;
    }
    return {eyes,width,height:rowY};
  }
  function emptyFrame(detail) {
    // Loading / empty editor is a valid transparent scene, never stale geometry.
    // Draw every requested tile with far depth and zero transported alpha.
    if(output.width!==detail.atlas.width)output.width=detail.atlas.width;
    if(output.height!==detail.atlas.height)output.height=detail.atlas.height;
    output.style.width=output.width+'px';output.style.height=output.height+'px';
    presenter.bindFramebuffer(presenter.FRAMEBUFFER,null);
    presenter.disable(presenter.BLEND);presenter.disable(presenter.DEPTH_TEST);
    presenter.colorMask(true,true,true,true);presenter.enable(presenter.SCISSOR_TEST);
    for(const t of detail.targets)for(const v of t.views) {
      const r=v.rect;presenter.scissor(r.x,detail.atlas.height-r.y-r.height,r.width,r.height);
      const far=v.dataType==='depth'?1:0;
      presenter.clearColor(far,far,far,1);presenter.clear(presenter.COLOR_BUFFER_BIT);
    }
    const tagged=core.writeRenderFrameTag(presenter,detail);
    state.loadingFrames++;state.lastDetail=detail;state.targets=detail.targets.length;
    return tagged;
  }
  function placeScene(c) {
    const snapshots=state.plugin.managers?.snapshot?.state;
    const key=classicSceneKey(state.plugin);
    if(state.center && (key===state.sceneKey || state.placementPending)) return;
    const bounds=c.boundingSphereVisible;
    state.center=Array.from(bounds.center);
    state.modelScale=bounds.radius>0?40/bounds.radius:1;
    state.originalRadius=bounds.radius;
    state.sceneKey=key;
    state.presentation=null;state.presentationCenter=null;
    if(!state.sceneFromRoom) {
      const firstStoryCamera=null;
      state.sceneFromRoom=sceneBasis(firstStoryCamera||c.camera.state);
    }
  }
  function invalidateCulling(scene) {
    // Mol* caches instance/LOD draw lists by Frame identity. XR changes those
    // same lists; invalidate between cameras and before restoring the PC view.
    for(const r of scene.renderables) r.uncull();
  }
  function resetMolstarState(c) {
    const s=c.webgl.state;
    s.reset();
    // reset() reads GL flags but deliberately keeps these application caches.
    // Our raw copy/pack shaders changed the actual program and VAO bindings.
    s.currentProgramId=-1;s.currentMaterialId=-1;s.currentRenderItemId=-1;
  }
  function render(detail) {
    refresh();
    if(!state.ready || !state.ctx) return emptyFrame(detail);
    const {renderer,scene,frame}=state.ctx, c=state.plugin.canvas3d;
    if(scene.volumes.renderables.length) throw new Error('QAR adaptation: direct volume rendering is not supported by this profile; use an isosurface');
    // Fit each newly selected snapshot after geometry has finished updating.
    // Keep the geometry fit stable; authored presentation motion is applied
    // separately, while manual desktop orbit outside playback stays local.
    // Backend AppScale is .01 m/unit; the normalized diameter is about 0.8 m.
    placeScene(c);
    updatePresentation(c);
    const gl=state.sourceGl, canvas=state.sourceCanvas;
    const oldWidth=canvas.width,oldHeight=canvas.height;
    const transparent=state.localProps.transparentBackground;
    state.inXR=true;
    try {
      canvas.width=detail.atlas.width;canvas.height=detail.atlas.height;
      const {eyes,width,height}=collectEyes(detail.targets);
      fullPipeline.retain(eyes);
      if(eyes.length) {
        const target=ensurePass(gl,width,height);
        for(const eye of eyes) {
          invalidateCulling(scene);
          fullPipeline.render(gl,target,eye,state.ctx);
        }
        copyEyesToAtlas(gl,target,detail.atlas.height,eyes);
      }
      const tagged=core.writeRenderFrameTag(gl,detail);
      present(canvas,detail);
      state.frames++;state.targets=detail.targets.length;state.lastRequest=detail.requestId;
      state.lastDetail=detail;state.error=null;
      return tagged;
    } catch(error) {state.error=String(error);throw error;}
    finally {
      canvas.width=oldWidth;canvas.height=oldHeight;
      gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.bindVertexArray(null);
      resetMolstarState(c);renderer.setTransparentBackground(transparent);
      state.inXR=false;
      // Repaint the unmodified local view without advancing the story clock.
      invalidateCulling(scene);
      state.drawOriginal.call(state.draw,state.ctx,state.localProps,true);
    }
  }
  state.renderFrameLoop=core.createRenderFrameLoop(render);
  const onFrame=({detail})=>state.renderFrameLoop.update(detail);
  const onStop=()=>state.renderFrameLoop.pause();
  window.addEventListener('qaros-render-frame',onFrame);
  window.addEventListener('qaros-render-stop',onStop);
  state.dispose=()=>{clearInterval(discovery);state.renderFrameLoop.stop();detach();window.removeEventListener('qaros-render-frame',onFrame);window.removeEventListener('qaros-render-stop',onStop);output.remove();style.remove();};
  window.addEventListener('pagehide',state.dispose,{once:true});
})();
