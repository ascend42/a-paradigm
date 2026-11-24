// #gui-board build-time patches (spec §12.7 engine hygiene, §11.2 rule 6; boards S1.0; Aegis S1 risks e, f).
// PURE: no esbuild, no build on import. scripts/board-build.mjs applies these while bundling; test/board-patches.test.ts
// applies each one to the installed package and fails loudly when a count moves (an Excalidraw version bump).
//
// Every patch names the ONE file it edits (a dist/prod file of the engine by the hashed chunk name the pinned version
// ships, or `<package>/<path>` for another bundled package), what it looks for and how many times it must match. A patch that matches a different number of times throws: the build never ships a
// half-patched engine. Nothing here is a fork: each edit is a string replacement on the published dist/prod files.
import { createHash } from 'node:crypto';

/** The exact engine these patches are written against (package.json pins the same version). */
export const ENGINE = Object.freeze({ name: '@excalidraw/excalidraw', version: '0.18.1' });

/**
 * sha256 of every file the patches edit or replace: a different byte anywhere is a different engine. A bare name is
 * a file of the engine's dist/prod; `<package>/<path>` is a file of another bundled package.
 */
export const ENGINE_FILES = Object.freeze({
  'lodash.debounce/index.js': '78bba4c545cab8e50a6a1fd2570f853a59aacf960f0e5d264c12bb46f9aaa302',
  'lodash.throttle/index.js': '9b5dc6b0a7061704cfd74704aa8dd85a8d0c816bada28cf1cb493531fd254712',
  'index.js': '7f651063487849c79a8cdedc3aa6bd04c6b0c717ee63959116f1f12dbc0a51b8',
  'index.css': 'e72092760bae272ebe075bdadaff7f82909d318c5d819313185b19e99be31e49',
  'chunk-K2UTITRG.js': '72b54e8e9b3c17c69f1dd5e40203bfaed62313bc611b86ecb8a1625a12562e51',
  'chunk-ZUYEQ4TG.js': '810dbb85e738f382cdd82e080185029a5ba30c17d3ba0df587e0e6d92e04d952',
});

export const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

/** `style="a:b;c:d"` → `a="b" c="d"` (SVG presentation properties only: the strings below carry nothing else). */
const styleToAttrs = (_m, css) =>
  css
    .split(';')
    .filter(Boolean)
    .map((d) => {
      const i = d.indexOf(':');
      return `${d.slice(0, i).trim()}="${d.slice(i + 1).trim()}"`;
    })
    .join(' ');

/**
 * head.unitsPerEm and the hhea ascender, descender and line gap of static/fonts/JetBrainsMono-Regular.woff2, as
 * scripts/board-font.mjs reads them from the file. Never edit these by hand: the build and a test fail when the
 * file says otherwise.
 */
export const BOARD_FONT_METRICS = Object.freeze({ unitsPerEm: 1000, ascender: 1020, descender: -300, lineGap: 0 });
/** The face's natural line, as a multiple of the font size. */
export const boardLineHeight = (m) => (m.ascender - m.descender + m.lineGap) / m.unitsPerEm;

/** The engine reads its colours and its key allowlist from the Gnomon tree (src/board/skin.ts), never from literals. */
const SKIN_IMPORT = 'import{gnomonBoardSkin,gnomonBoardKeyActions,gnomonBoardRefuse}from"gnomon-board:skin";';

const SVG_BLOB = (expr) => `URL.createObjectURL(new Blob([${expr}],{type:H.svg}))`;

/**
 * The text patches. `find` is a string (exact) or a global RegExp; `expect` is the exact number of matches.
 * Order matters only within one file and is the order written here.
 */
export const PATCHES = Object.freeze([
  {
    id: 'font-family-table',
    file: 'chunk-K2UTITRG.js',
    why: 'the board has ONE text face (S1.1): JetBrains Mono joins the engine family table under its own id, so a text element can name it',
    find: '"Liberation Sans":9}',
    replace: '"Liberation Sans":9,"JetBrains Mono":10}',
    expect: 1,
  },
  {
    id: 'font-defaults',
    file: 'chunk-K2UTITRG.js',
    why: 'the default text is JetBrains Mono at 13.5 (design rule engine-wears-the-system: one size in S1), on every path that builds a text element',
    find: 'Eo=1,ut=20,Ft=Ie.Excalifont,',
    replace: 'Eo=1,ut=13.5,Ft=Ie["JetBrains Mono"],',
    expect: 1,
  },
  {
    id: 'font-metrics',
    file: 'chunk-K2UTITRG.js',
    why: 'the vertical metrics the engine places text by are those READ from the bundled face (BOARD_FONT_METRICS; test/board-font.test.ts and the build compare them with static/fonts/JetBrainsMono-Regular.woff2), and the line is the face\'s own: (ascender - descender + line gap) / units per em',
    find: 'var Fr={[Ie.Excalifont]:',
    replace: `var Fr={[Ie["JetBrains Mono"]]:{metrics:{unitsPerEm:${BOARD_FONT_METRICS.unitsPerEm},ascender:${BOARD_FONT_METRICS.ascender},descender:${BOARD_FONT_METRICS.descender},lineHeight:${boardLineHeight(BOARD_FONT_METRICS)}}},[Ie.Excalifont]:`,
    expect: 1,
  },
  {
    id: 'font-family-string',
    file: 'chunk-K2UTITRG.js',
    why: 'the canvas and text-editor font string is the one family whatever a stored element says: no Excalifont, Virgil, Nunito, Comic Shanns or other engine family name reaches it, and no per-OS emoji or CJK family is appended',
    find: 'ea=({fontFamily:e})=>{for(let[t,n]of Object.entries(Ie))if(n===e)return`${t}${bo(n).map(r=>`, ${r}`).join("")}`;return Tn},',
    replace: 'ea=()=>\'"JetBrains Mono", monospace\',',
    expect: 1,
  },
  {
    id: 'font-registry-empty',
    file: 'chunk-K2UTITRG.js',
    why: 'no Excalidraw font ships and no family without a face is registered: the registry holds ONE family, JetBrains Mono, whose single face is the bundle\'s own fonts/JetBrainsMono-Regular.woff2 (font-src self; its OFL notice ships beside it as fonts/OFL-JetBrainsMono.txt), so board text and PNG export measure with the same face on every OS',
    find: 'return n("Cascadia",...Gd),n("Comic Shanns",...Qd),n("Excalifont",...sc),n("Helvetica",...dc),n("Liberation Sans",...lc),n("Lilita One",...pc),n("Nunito",...xc),n("Virgil",...yc),n(Mn,...b1),n(Tn,...jd),ne._initialized=!0,t.registered}',
    replace: 'return n("JetBrains Mono",{uri:"../fonts/JetBrainsMono-Regular.woff2"}),ne._initialized=!0,t.registered}',
    expect: 1,
  },
  {
    id: 'font-table-uris',
    file: 'chunk-K2UTITRG.js',
    why: 'the 230 font file names leave with the fonts: the now-unused tables name nothing',
    find: /"\.\/fonts\/[^"]+\.woff2"/g,
    replace: '""',
    expect: 230,
  },
  {
    id: 'embed-allowlists-empty',
    file: 'chunk-K2UTITRG.js',
    why: 'embeddables are off (S25-M3): no third-party host is an allowed embed or an allowed same-origin embed',
    find: 'Qa=new Set(["youtube.com","youtu.be","vimeo.com","player.vimeo.com","figma.com","link.excalidraw.com","gist.github.com","twitter.com","x.com","*.simplepdf.eu","stackblitz.com","val.town","giphy.com","reddit.com"]),C2=new Set(["youtube.com","youtu.be","vimeo.com","player.vimeo.com","figma.com","twitter.com","x.com","*.simplepdf.eu","stackblitz.com","reddit.com"])',
    replace: 'Qa=new Set([]),C2=new Set([])',
    expect: 1,
  },
  {
    id: 'font-cdn-fallback-url',
    file: 'chunk-K2UTITRG.js',
    why: 'the esm.sh asset fallback is removed, not merely unreached',
    find: 'P(jn,"ASSETS_FALLBACK_URL",`https://esm.sh/${M.PKG_NAME?`${M.PKG_NAME}@${M.PKG_VERSION}`:"@excalidraw/excalidraw"}/dist/prod/`);',
    replace: '',
    expect: 1,
  },
  {
    id: 'font-cdn-fallback-push',
    file: 'chunk-K2UTITRG.js',
    why: 'an asset URL is built from EXCALIDRAW_ASSET_PATH (the bundle) only',
    find: 'return r.push(new URL(n,jn.ASSETS_FALLBACK_URL)),r}',
    replace: 'return r}',
    expect: 1,
  },
  {
    id: 'svg-inline-style-attrs',
    file: 'chunk-K2UTITRG.js',
    why: 'the placeholder and cursor SVG strings carry inline style attributes; as presentation attributes they need no style-src',
    find: /style="([a-z-]+:[^";]+(?:;[a-z-]+:[^";]+)*)"/g,
    replace: styleToAttrs,
    expect: 4,
  },
  {
    id: 'data-svg-images',
    file: 'chunk-K2UTITRG.js',
    why: 'img-src has no data: (§11.2 rule 6): the four placeholder images and the two laser cursors become blob: URLs',
    find: /`data:\$\{H\.svg\}, ?\$\{encodeURIComponent\(('(?:[^'\\]|\\.)*'|`[^`]*`)\)\}`/g,
    replace: (_m, svg) => SVG_BLOB(svg),
    expect: 6,
  },
  {
    id: 'eraser-cursor',
    file: 'chunk-K2UTITRG.js',
    why: 'the eraser cursor was a canvas data: URL; it is the same 5px ring as a blob: SVG, in the sheet and ink of the Gnomon theme (S1.1) instead of black and white',
    find: 'D2=Ct.toDataURL(H.svg)',
    replace: `D2=${SVG_BLOB(`'<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><circle cx="10" cy="10" r="5" fill="'+gnomonBoardSkin.sheet+'" stroke="'+gnomonBoardSkin.ink+'"/></svg>'`)}`,
    expect: 1,
    prepend: SKIN_IMPORT,
  },
  {
    id: 'svg-text-style-attribute',
    file: 'chunk-K2UTITRG.js',
    why: 'setAttribute("style") is an inline style (style-src-attr); the CSSOM property is not',
    find: '_.setAttribute("style","white-space: pre;")',
    replace: '_.style.whiteSpace="pre"',
    expect: 1,
  },
  {
    id: 'no-fetch-core',
    file: 'chunk-K2UTITRG.js',
    why: 'the font fetch and the image-by-URL fetch are refused: the board makes no HTTP request of its own',
    find: /(?<![.\w$])fetch\(/g,
    replace: 'gnomonBoardRefuseFetch(',
    expect: 2,
    prepend: 'import{gnomonBoardRefuseFetch}from"gnomon-board:refused";',
  },
  {
    id: 'no-fetch-ui',
    file: 'index.js',
    why: 'the library-by-URL fetch and the library publish POST are refused',
    find: /(?<![.\w$])fetch\(/g,
    replace: 'gnomonBoardRefuseFetch(',
    expect: 2,
    prepend: 'import{gnomonBoardRefuseFetch}from"gnomon-board:refused";',
  },
  {
    id: 'library-trigger-removed',
    file: 'index.js',
    why: 'the stock Library sidebar writes exported SVG previews with innerHTML (an inline style attribute and a <style> element: style-src refusals); the board has no Library, so its trigger renders nothing, on the desktop and the mobile layout',
    find: 'return vo(o.In,{children:vo(no.Trigger,{...e,className:"default-sidebar-trigger",name:pt.name})})',
    replace: 'return null',
    expect: 1,
  },
  {
    id: 'library-tab-trigger-removed',
    file: 'index.js',
    why: 'the default sidebar (still used by canvas search) offers no Library tab',
    find: 'vo(no.TabTrigger,{tab:ia,children:jn}),',
    replace: '',
    expect: 1,
  },
  {
    id: 'library-tab-removed',
    file: 'index.js',
    why: 'the Library panel is never rendered, whatever opens the sidebar (command palette, updateLibrary, a stored tab)',
    find: 'vo(no.Tab,{tab:ia,children:vo(fw,{})}),',
    replace: '',
    expect: 1,
  },
  // ── S1.1 reskin: what the engine draws (chunk-K2UTITRG.js is the scene renderer) ──────────────────────────────
  {
    id: 'image-tool-removed',
    file: 'chunk-K2UTITRG.js',
    why: 'the image tool leaves the engine tool list, with its number-row key 9: it inserted a broken placeholder and raised img-src refusals instead of refusing (Mika, S1.0 re-review)',
    find: '{icon:Kd,value:"image",key:null,numericKey:Q[9],fillable:!1},',
    replace: '',
    expect: 1,
  },
  {
    id: 'roughness-zero',
    file: 'chunk-K2UTITRG.js',
    why: 'no hand-drawn sloppiness: every element built without an explicit roughness (the handle, a paste, a restore) is drawn exact',
    find: 'strokeStyle:"solid",roughness:Gi.artist,opacity:100,locked:!1}',
    replace: 'strokeStyle:"solid",roughness:0,opacity:100,locked:!1}',
    expect: 1,
  },
  {
    id: 'stroke-exact',
    file: 'chunk-K2UTITRG.js',
    why: 'a freehand stroke is as wide as its weight says (the engine drew it 4.25 times wider and tapered: Marker was a slab about 36px thick and fine thinned out; Mika, S1.1 pass A finding 6)',
    find: 'size:e.strokeWidth*4.25,thinning:.6,',
    replace: 'size:e.strokeWidth,thinning:0,',
    expect: 1,
  },
  {
    id: 'skin-frame',
    file: 'chunk-K2UTITRG.js',
    why: 'a frame is a 1px square region in the secondary ink with its title at 11.5 (design board-rail.tools.frame), read from the theme at draw time instead of the engine greys #bbb, #999999 and #7a7a7a',
    find: 'Pe={strokeColor:"#bbb",strokeWidth:2,strokeStyle:"solid",fillStyle:"solid",roughness:0,roundness:null,backgroundColor:"transparent",radius:8,nameOffsetY:3,nameColorLightTheme:"#999999",nameColorDarkTheme:"#7a7a7a",nameFontSize:14,nameLineHeight:1.25}',
    replace: 'Pe={get strokeColor(){return gnomonBoardSkin.frame},strokeWidth:1,strokeStyle:"solid",fillStyle:"solid",roughness:0,roundness:null,backgroundColor:"transparent",radius:0,nameOffsetY:3,get nameColorLightTheme(){return gnomonBoardSkin.frame},get nameColorDarkTheme(){return gnomonBoardSkin.frame},nameFontSize:11.5,nameLineHeight:1.25}',
    expect: 1,
    prepend: SKIN_IMPORT,
  },
  {
    id: 'skin-marquee',
    file: 'chunk-K2UTITRG.js',
    why: 'the selection marquee and the frame wash were a blue tint, rgba(0, 0, 200, 0.04); they are a wash of the theme ink',
    find: /"rgba\(0, 0, 200, 0\.04\)"/g,
    replace: 'gnomonBoardSkin.wash',
    expect: 2,
    prepend: SKIN_IMPORT,
  },
  // ── S1.1 reskin: the engine UI and the interactive layer (index.js) ───────────────────────────────────────────
  {
    id: 'layer-ui-removed',
    file: 'index.js',
    why: 'the whole stock UI layer renders nothing, at every pane size: tool island and its More tools menu (Web Embed, Mermaid "Generate", Laser), lock, main menu and its Excalidraw links, properties panel and colour picker, zoom and undo island, Help button and Help dialog links, hint line, welcome-screen tunnels, export dialogs, error dialogs, the sidebar (Library with "Browse libraries", search), the scroll-back key and the phone menu. The tools come from the Gnomon rail through the handle',
    find: 'Q_=({actionManager:e,appState:o,files:t,setAppState:r,elements:n,canvas:i,onLockToggle:a,onHandToolToggle:l,onPenModeToggle:s,showExitZenModeBtn:c,renderTopRightUI:m,renderCustomStats:d,UIOptions:p,onExportImage:u,renderWelcomeScreen:h,children:f,app:b,isCollaborating:x,generateLinkForSelection:T})=>{',
    replace: 'Q_=()=>{return null;',
    expect: 1,
  },
  {
    id: 'loading-message-removed',
    file: 'index.js',
    why: 'the engine spinner and its "Loading scene…" line never paint; the board leaf owns the loading state',
    find: 'o?QT(Zs,{theme:e.theme}):e.children',
    replace: 'o?null:e.children',
    expect: 1,
  },
  {
    id: 'phone-layout-removed',
    file: 'index.js',
    why: 'the engine switched to its phone layout in a narrow OR a short host (839x499 was phone); the host owns the layout at every size, so the breakpoint is never met',
    find: 'C(this,"isMobileBreakpoint",(t,r)=>t<Ch||r<Sh&&t<Ih);',
    replace: 'C(this,"isMobileBreakpoint",()=>!1);',
    expect: 1,
  },
  {
    id: 'toast-removed',
    file: 'index.js',
    why: 'the engine toast is never rendered (a refusal is the leaf\'s to say)',
    find: 'this.state.toast!==null&&Ie(P1,',
    replace: '!1&&Ie(P1,',
    expect: 1,
  },
  {
    id: 'link-popup-removed',
    file: 'index.js',
    why: 'link fields are off: the hyperlink popup is never rendered',
    find: 'this.state.showHyperlinkPopup&&Ie(vv,',
    replace: '!1&&Ie(vv,',
    expect: 1,
  },
  {
    id: 'context-menu-removed',
    file: 'index.js',
    why: 'no context menu in S1: a right-click on the board does nothing and the browser menu stays suppressed',
    find: 'C(this,"handleCanvasContextMenu",t=>{if(t.preventDefault(),',
    replace: 'C(this,"handleCanvasContextMenu",t=>{if(t.preventDefault(),!0)return;if(',
    expect: 1,
  },
  {
    id: 'image-insert-refused',
    file: 'index.js',
    why: 'no stock path inserts an image: the one function every file-based insert goes through (tool, file paste, file drop) returns before it adds the placeholder element, and tells the host (gnomonBoardRefuse in src/board/skin.ts, the handle\'s onRefused) instead of setting an engine error nobody sees',
    find: 'C(this,"insertImageElement",async(t,r,n)=>{if(!this.isToolSupported("image")){this.setState({errorMessage:g("errors.imageToolNotSupported")});return}',
    replace: 'C(this,"insertImageElement",async(t,r,n)=>{{gnomonBoardRefuse("image");return}',
    expect: 1,
    prepend: SKIN_IMPORT,
  },
  {
    id: 'key-actions-allowlist',
    file: 'index.js',
    why: 'only the keyboard actions the board keeps run from a key (gnomonBoardKeyActions in src/board/skin.ts); every other engine shortcut (command palette, help, link, theme, zen and view mode, grid, stats, export, save, duplicate, grouping, layers, styles, lock, font size) matches nothing',
    find: '.filter(s=>(s.name in t?t[s.name]:!0)&&s.keyTest&&',
    replace: '.filter(s=>gnomonBoardKeyActions.has(s.name)&&(s.name in t?t[s.name]:!0)&&s.keyTest&&',
    expect: 1,
    prepend: SKIN_IMPORT,
  },
  {
    id: 'key-dialogs-removed',
    file: 'index.js',
    why: 'the ? key no longer opens Help and Ctrl/Cmd+Shift+E no longer opens the image export dialog',
    find: 'if(t.key===y.QUESTION_MARK){this.setState({openDialog:{name:"help"}});return}else if(t.key.toLowerCase()===y.E&&t.shiftKey&&t[y.CTRL_OR_CMD]){t.preventDefault(),this.setState({openDialog:{name:"imageExport"}});return}',
    replace: '',
    expect: 1,
  },
  {
    id: 'key-tools-removed',
    file: 'index.js',
    why: 'the engine\'s own letter and number-row tool keys go (9 was the image tool, A the arrow, K the laser, Q the lock), with the colour-popup, font-popup, eye-dropper and clear-canvas keys: the rail owns the letters. Space still pans',
    find: /else if\(!t\.ctrlKey&&!t\.altKey&&!t\.metaKey&&!this\.state\.newElement&&!this\.state\.selectionElement&&!this\.state\.selectedElementsAreBeingDragged\)\{let a=cx\(t\.key\);[\s\S]*?\(n\|\|i\)&&this\.openEyeDropper\(\{type:n\?"stroke":"background"\}\)\}\)\);C\(this,"onKeyUp"/g,
    replace: 't.key===y.SPACE&&fe.pointers.size===0&&(Mn=!0,Te(this.interactiveCanvas,we.GRAB),t.preventDefault())}));C(this,"onKeyUp"',
    expect: 1,
  },
  {
    id: 'text-size-keys-removed',
    file: 'index.js',
    why: 'text on a board is one size in S1: the text editor\'s own font-size keys do nothing',
    find: 'else if(Up.keyTest(F))l.actionManager.executeAction(Up);else if(Hp.keyTest(F))l.actionManager.executeAction(Hp);',
    replace: '',
    expect: 1,
  },
  {
    id: 'frame-name-editor',
    file: 'index.js',
    why: 'the frame title editor was stock (the unshipped Assistant face, so Times 14px; text #3D3D3D, 1.74:1 on the night ground; a 4px radius; a violet edge): it is the title\'s own 11.5 / 600 mono in the theme ink on the sheet, square, with a key-edge rule (Mika, S1.1 pass A finding 4)',
    find: 'style:{background:this.state.viewBackgroundColor,filter:t?Th:"none",zIndex:2,border:"none",display:"block",padding:`${a}px`,borderRadius:4,boxShadow:"inset 0 0 0 1px var(--color-primary)",fontFamily:"Assistant",fontSize:"14px",',
    replace: 'style:{background:gnomonBoardSkin.sheet,zIndex:2,border:"none",display:"block",padding:`${a}px`,borderRadius:0,boxShadow:`inset 0 0 0 1px ${gnomonBoardSkin.selection}`,fontFamily:\'"JetBrains Mono", monospace\',fontSize:"11.5px",fontWeight:600,',
    expect: 1,
    prepend: SKIN_IMPORT,
  },
  {
    id: 'frame-name-editor-ink',
    file: 'index.js',
    why: 'the frame title editor\'s text is the theme ink',
    find: 'color:"var(--color-gray-80)",overflow:"hidden",maxWidth:`${document.body.clientWidth-n-a}px`}',
    replace: 'color:gnomonBoardSkin.ink,overflow:"hidden",maxWidth:`${document.body.clientWidth-n-a}px`}',
    expect: 1,
    prepend: SKIN_IMPORT,
  },
  {
    id: 'frame-name-editor-keys',
    file: 'index.js',
    why: 'Esc and Enter end the frame title edit and stop there: the key used to travel on to the board, whose own Esc handling put the editor back, so it stayed on screen as a tab stop',
    find: 'onKeyDown:m=>{(m.key===y.ESCAPE||m.key===y.ENTER)&&this.resetEditingFrame(r)},',
    replace: 'onKeyDown:m=>{(m.key===y.ESCAPE||m.key===y.ENTER)&&(m.stopPropagation(),m.preventDefault(),this.resetEditingFrame(r),this.focusContainer())},',
    expect: 1,
  },
  {
    id: 'frame-name-title',
    file: 'index.js',
    why: 'a frame title is the 600 weight of the design, and a truncated one carries its whole text in title=',
    find: 'Ie("div",{id:this.getFrameNameDOMId(r),style:{position:"absolute",bottom:`${this.state.height+mo.nameOffsetY-i+this.state.offsetTop}px`,left:`${n-this.state.offsetLeft}px`,zIndex:2,fontSize:mo.nameFontSize,',
    replace: 'Ie("div",{id:this.getFrameNameDOMId(r),title:s,style:{position:"absolute",bottom:`${this.state.height+mo.nameOffsetY-i+this.state.offsetTop}px`,left:`${n-this.state.offsetLeft}px`,zIndex:2,fontSize:mo.nameFontSize,fontWeight:600,',
    expect: 1,
  },
  {
    id: 'api-run-action',
    file: 'index.js',
    why: 'the rail drives zoom, undo and redo from outside the engine: the imperative API gains one method that runs a registered action by name (the handle in src/board/index.ts allows a closed list)',
    find: 'history:{clear:this.resetHistory},',
    replace: 'history:{clear:this.resetHistory},gnomonAction:(p,u)=>this.actionManager.executeAction(this.actionManager.actions[p],"api",u),',
    expect: 1,
  },
  {
    id: 'skin-selection',
    file: 'index.js',
    why: 'the selection colour was read from the engine stylesheet (--color-selection, violet #6965db beside the reserved state.knot); it is the theme key-edge, from the skin',
    find: 'let l=e.containerRef?.current&&getComputedStyle(e.containerRef.current).getPropertyValue("--color-selection")||"#6965db";',
    replace: 'let l=gnomonBoardSkin.selection;',
    expect: 1,
    prepend: SKIN_IMPORT,
  },
  {
    id: 'skin-point-hover',
    file: 'index.js',
    why: 'the hovered line point was violet, rgba(105, 101, 219, 0.4)',
    find: 'o.fillStyle="rgba(105, 101, 219, 0.4)"',
    replace: 'o.fillStyle=gnomonBoardSkin.handleHover',
    expect: 1,
    prepend: SKIN_IMPORT,
  },
  {
    id: 'skin-point-handles',
    file: 'index.js',
    why: 'line point handles were violet (#5e5ad8 edge; rgba(134, 131, 226) and rgba(177, 151, 252) fills) on white',
    find: 'e.strokeStyle="#5e5ad8",e.setLineDash([]),e.fillStyle="rgba(255, 255, 255, 0.9)",n?e.fillStyle="rgba(134, 131, 226, 0.9)":i&&(e.fillStyle="rgba(177, 151, 252, 0.7)")',
    replace: 'e.strokeStyle=gnomonBoardSkin.selection,e.setLineDash([]),e.fillStyle=gnomonBoardSkin.handle,n?e.fillStyle=gnomonBoardSkin.selection:i&&(e.fillStyle=gnomonBoardSkin.handleHover)',
    expect: 1,
    prepend: SKIN_IMPORT,
  },
  {
    id: 'skin-binding',
    file: 'index.js',
    why: 'the binding highlight was 5% black, which is nothing on the night ground; it is a wash of the theme ink',
    find: /"rgba\(0,0,0,\.05\)"/g,
    replace: 'gnomonBoardSkin.binding',
    expect: 2,
    prepend: SKIN_IMPORT,
  },
  {
    id: 'skin-box-highlight',
    file: 'index.js',
    why: 'the element box highlight was a blue, rgb(0,118,255)',
    find: /"rgb\(0,118,255\)"/g,
    replace: 'gnomonBoardSkin.selection',
    expect: 2,
    prepend: SKIN_IMPORT,
  },
  {
    id: 'skin-transform-handles',
    file: 'index.js',
    why: 'transform handles were filled white, a white dot on the night ground; they are filled with the theme sheet',
    find: 'd.fillStyle=_d.white',
    replace: 'd.fillStyle=gnomonBoardSkin.handle',
    expect: 2,
    prepend: SKIN_IMPORT,
  },
  {
    id: 'skin-guides',
    file: 'index.js',
    why: 'snap guides were red (#ff6b6b light, #ff0000 dark), the colour family of state.fail; they are the theme ink',
    find: 'let t=o.theme===re.LIGHT||o.zenModeEnabled?c5:d5,r=',
    replace: 'let t=gnomonBoardSkin.guide,r=',
    expect: 1,
    prepend: SKIN_IMPORT,
  },
  {
    id: 'skin-guide-literals',
    file: 'index.js',
    why: 'the two red guide literals leave with their use',
    find: 'var c5="#ff6b6b",d5="#ff0000",G1=1,',
    replace: 'var G1=1,',
    expect: 1,
  },
  {
    id: 'lodash-debounce-root',
    file: 'lodash.debounce/index.js',
    why: 'the global lookup ends in Function("return this")(): eval-class source, replaced by globalThis',
    find: "Function('return this')()",
    replace: 'globalThis',
    expect: 1,
  },
  {
    id: 'lodash-throttle-root',
    file: 'lodash.throttle/index.js',
    why: 'the global lookup ends in Function("return this")(): eval-class source, replaced by globalThis',
    find: "Function('return this')()",
    replace: 'globalThis',
    expect: 1,
  },
  {
    id: 'css-engine-violets',
    file: 'index.css',
    why: 'the engine UI violet family (#6965db, #5b57d1, #5753d0, #4a47b1 and the dark theme #a8a5ff) sits inside the reserved distance of state.knot (Aegis S1.1 ruling 8); every use reads the theme key-edge instead',
    find: /#(?:6965db|5b57d1|5753d0|4a47b1|a8a5ff)\b/g,
    replace: 'var(--key-edge,#2A2925)',
    expect: 7,
  },
  {
    id: 'css-ui-font-faces',
    file: 'index.css',
    why: 'the Assistant UI font is not shipped; the stack falls through to the system font',
    find: /@font-face\{font-family:Assistant;[^}]*\}/g,
    replace: '',
    expect: 4,
  },
]);

/**
 * `data:` images in the engine stylesheet become real files of the bundle (img-src 'self').
 * Returns the rewritten CSS and the extracted files (name → bytes); names carry the content hash.
 */
export const CSS_ASSETS = Object.freeze({
  png: { find: /url\(data:image\/png;base64,([A-Za-z0-9+/=]+)\)/g, expect: 5 },
  svg: { find: /url\('data:image\/svg\+xml,(<svg[^']*<\/svg>)'\)/g, expect: 2 },
});

export function extractCssAssets(css) {
  const assets = new Map();
  const counts = {};
  const put = (bytes, ext) => {
    const name = `asset-${sha256(bytes).slice(0, 16)}.${ext}`;
    assets.set(name, bytes);
    return `url(./${name})`;
  };
  let out = css;
  for (const [ext, { find, expect }] of Object.entries(CSS_ASSETS)) {
    let n = 0;
    out = out.replace(find, (_m, body) => {
      n++;
      return put(ext === 'png' ? Buffer.from(body, 'base64') : Buffer.from(decodeURIComponent(body), 'utf8'), ext);
    });
    if (n !== expect) throw new PatchError(`css-data-${ext}`, 'index.css', expect, n);
    counts[`css-data-${ext}`] = n;
  }
  return { css: out, assets, counts };
}

/**
 * Imports that resolve to a stand-in instead of the engine's own module. `expect` counts distinct (importer, specifier)
 * pairs: esbuild resolves each pair once.
 */
export const STUBS = Object.freeze([
  { id: 'locales', filter: /^\.\/locales\/[A-Za-z0-9-]+\.js$/, stub: 'locale.ts', expect: 55, why: 'one language ships' },
  { id: 'font-subset', filter: /^\.\/subset-(shared|worker)\.chunk\.js$/, stub: 'refused.ts', expect: 2, why: 'the font subsetter and its worker: eval, new Function and WebAssembly source' },
  { id: 'build-env', filter: /^\.\.?\/chunk-ZUYEQ4TG\.js$/, stub: 'env.ts', expect: 3, why: 'the hardcoded excalidraw.com json, library, AI and collab backends' },
  { id: 'mermaid', filter: /^@excalidraw\/mermaid-to-excalidraw$/, stub: 'refused.ts', expect: 1, why: 'the Mermaid importer (and its dependency tree) is not part of a board' },
  { id: 'image-resize', filter: /^(pica|image-blob-reduce)$/, stub: 'refused.ts', expect: 2, why: 'WebAssembly source; the board has no image tool and no file-based image insert until the redaction pass (S2)' },
]);

/**
 * G-DDL-07 (Aegis S1.1 ruling 8): the colour literals of the shipped chunk that sit inside the content palette's
 * minimum distance of a reserved colour, and why each may stay. `by` is the patch that takes the literal's only
 * use off the screen, or `unreached` for a literal that is never painted on a board (the reason says why). The
 * reserved colours and theme tokens themselves (the palette source bundled for the colour check) are not listed:
 * the test reads them from gnomon-contracts. The test compares this list with the shipped bytes in BOTH directions,
 * so a new near-reserved literal fails and so does a stale entry.
 */
export const COLOUR_ALLOWLIST = Object.freeze([
  {
    file: 'board/board.js',
    by: 'layer-ui-removed',
    why: "the engine's colour tables (the open-color hues and its bronze): offered only by the stock colour picker and the chart dialog, neither of which is rendered; a mark's colours come from its content-palette tokens (src/board/index.ts)",
    literals: ['#0b7285', '#364fc7', '#3b5bdb', '#4263eb', '#495057', '#5f3dc4', '#6741d9', '#7048e8', '#846358', '#91a7ff', '#adb5bd', '#b197fc', '#c92a2a', '#ced4da', '#d2bab0', '#e9fac8', '#eaddd7', '#faa2c1', '#fab005', '#fcc419', '#ff6b6b', '#ff8787', '#ffa8a8', '#ffa94d', '#ffc078', '#ffd43b', '#ffd8a8', '#ffe3e3', '#ffe8cc', '#ffec99', '#fff3bf'],
  },
  { file: 'board/board.js', by: 'layer-ui-removed', why: 'the canvas search highlight of the engine dark theme; the search sidebar is not rendered and the engine theme is always light', literals: ['rgba(99,52,0,0.4)'] },
  { file: 'board/board.js', by: 'embed-allowlists-empty', why: 'the placeholder fill of an embeddable or iframe element; no embeddable is valid', literals: ['#d3d3d3'] },
  { file: 'board/board.js', by: 'key-actions-allowlist', why: 'the grid line colour; the grid is off and its toggle key matches nothing', literals: ['#e5e5e5'] },
  { file: 'board/board.js', by: 'unreached', why: 'the speaking ring of a collaborator avatar in the engine dark theme; the board passes no collaborators and the engine theme is always light', literals: ['#2f6330'] },
  { file: 'board/board.js', by: 'unreached', why: 'a console %c style in an engine invariant warning; never painted on a board', literals: ['#8b4000'] },
  {
    file: 'board/board.css',
    by: 'layer-ui-removed',
    why: "custom properties and rules of the engine's own UI layer (islands, buttons, dialogs, the colour picker, the hyperlink popup, its dark theme): no element they style is rendered",
    literals: ['#495057', '#4f4d6f', '#5c5c5c', '#8e8d9c', '#999999', '#aaa', '#ac2b29', '#adb5bd', '#b2aeff', '#b8b8b8', '#c5c5d0', '#c92a2a', '#ced4da', '#f3ab2c', '#f5c354', '#fceeca', '#ffa8a5', '#ffa8a8', '#ffdad6', '#ffe3e3'],
  },
]);

/** XML namespace URIs are identifiers, never fetched; they are the only http(s) literals the bundle may carry. */
export const NAMESPACE_URLS = Object.freeze([
  'http://www.w3.org/1998/Math/MathML',
  'http://www.w3.org/1999/xhtml',
  'http://www.w3.org/1999/xlink',
  'http://www.w3.org/2000/svg',
  'http://www.w3.org/2000/xmlns/',
  'http://www.w3.org/XML/1998/namespace',
]);
export const STRIPPED_HOST = 'about:invalid#';
const HOST_URL = /https?:\/\/(?!www\.w3\.org\/)[A-Za-z0-9][A-Za-z0-9.-]*(?::\d+)?/g;

/** Replace every `http(s)://<host>` literal (namespaces aside) with an inert scheme; returns the hosts it removed. */
export function stripHosts(text) {
  const hosts = {};
  const out = text.replace(HOST_URL, (m) => {
    const host = m.replace(/^https?:\/\//, '');
    hosts[host] = (hosts[host] ?? 0) + 1;
    return STRIPPED_HOST;
  });
  return { text: out, hosts };
}

export class PatchError extends Error {
  constructor(id, file, expected, got) {
    super(`board patch "${id}" matched ${got} time(s) in ${file}, expected ${expected}: the engine is not ${ENGINE.name}@${ENGINE.version} as pinned (re-derive the patch in scripts/board-patches.mjs)`);
    this.name = 'PatchError';
    this.patch = id;
  }
}

/** How many times a patch's `find` matches `text`, MEASURED (never read from `expect`). */
export function countMatches(p, text) {
  if (typeof p.find === 'string') return text.split(p.find).length - 1;
  return [...text.matchAll(new RegExp(p.find.source, p.find.flags.includes('g') ? p.find.flags : `${p.find.flags}g`))].length;
}

/** Apply ONE patch to `text`; throws PatchError unless it matches exactly `expect` times. Returns the new text. */
export function applyPatch(p, text) {
  let n = 0;
  let out = text;
  if (typeof p.find === 'string') {
    const parts = text.split(p.find);
    n = parts.length - 1;
    if (n === p.expect) out = parts.join(typeof p.replace === 'string' ? p.replace : '');
  } else {
    out = text.replace(p.find, (...a) => {
      n++;
      return typeof p.replace === 'function' ? p.replace(...a) : p.replace;
    });
  }
  if (n !== p.expect) throw new PatchError(p.id, p.file, p.expect, n);
  return out;
}

/** Apply every patch for `file` to `text`, in order; throws PatchError on any count mismatch. Returns {text, counts}. */
export function applyPatches(file, text) {
  const counts = {};
  const prepend = new Set();
  let out = text;
  for (const p of PATCHES) {
    if (p.file !== file) continue;
    counts[p.id] = countMatches(p, out); // measured on the text this patch sees, before it edits it
    out = applyPatch(p, out);
    if (p.prepend) prepend.add(p.prepend);
  }
  return { text: [...prepend].join('') + out, counts };
}

/** The files PATCHES edits (keys of ENGINE_FILES). */
export const PATCHED_FILES = Object.freeze([...new Set(PATCHES.map((p) => p.file))]);
