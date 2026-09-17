/**
 * Static, render-blocking CSS + pre-hydration script for the BootSplash.
 *
 * Emitted by the synchronous root layout as raw inline <style>/<script>, so
 * both ship in the very first HTML shell — before async segments resolve,
 * before React hydration, and before any external stylesheet/JS chunk
 * finishes over a slow cross-border link.
 *
 * The overlay fades in with a delay (fast loads never see it). The
 * end-of-visible-HTML script calls window.__splashReady(): if the document
 * became ready within 450ms of navigation start the overlay is hidden
 * instantly (it was never visible); on a slow load it is forced fully
 * visible, held for 400ms as a branded beat, then faded out. DOMContentLoaded,
 * load, bfcache restore and a 3s timeout backstop it — whichever fires first.
 */
const BOOT_SPLASH_CSS = `
#boot-splash{opacity:0;animation:bootSplashIn .18s ease-out .22s forwards;transition:opacity .35s ease}
html[data-splash-slow] #boot-splash{animation:none;opacity:1}
html[data-splash-done] #boot-splash{animation:none;opacity:0;pointer-events:none}
@keyframes bootSplashIn{to{opacity:1}}
.boot-splash-pulse{transform-origin:center;animation:bootPulse 1.6s ease-in-out infinite}
@keyframes bootPulse{0%,100%{opacity:.6;transform:scale(.96)}50%{opacity:1;transform:scale(1)}}
.boot-splash-bar{background:#6b4f3a;animation:bootBar 1.1s ease-in-out infinite}
@keyframes bootBar{0%{transform:translateX(-120%)}100%{transform:translateX(320%)}}
.boot-nav-loader{opacity:0;animation:bootSplashIn .18s ease-out .2s forwards}
@media (prefers-reduced-motion:reduce){
  #boot-splash{animation-duration:.01s;animation-delay:0s;transition:none}
  .boot-splash-pulse,.boot-splash-bar,.boot-nav-loader{animation:none;opacity:1}
}
`;

const BOOT_SPLASH_INIT = `(function(){try{var d=document.documentElement,fired=false;function done(){if(fired)return;fired=true;d.setAttribute("data-splash-done","");}
window.__splashReady=function(){if(fired)return;
if(performance.now()<450){done();return;}
d.setAttribute("data-splash-slow","");window.setTimeout(done,400);};
window.addEventListener("load",done);
document.addEventListener("DOMContentLoaded",function(){window.setTimeout(done,350);});
window.addEventListener("pageshow",function(e){if(e.persisted)done();});
window.setTimeout(done,3000);}catch(e){}})();`;

export function BootSplashAssets() {
  return (
    <>
      <style id="boot-splash-css" dangerouslySetInnerHTML={{ __html: BOOT_SPLASH_CSS }} />
      <script id="boot-splash-init" dangerouslySetInnerHTML={{ __html: BOOT_SPLASH_INIT }} />
    </>
  );
}
