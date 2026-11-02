/* Height changes happen once in the document; only snapshots move per frame. */
(function(){
  'use strict';
  let active=null;
  async function turn(wrapper,render){
    if(active)active.cancel();
    const modal=wrapper.closest('.modal-card'),root=document.documentElement;
    const margin=wrapper.offsetHeight+innerHeight;
    const candidates=modal?Array.from(modal.querySelectorAll('.modal-header,#favoriteStudyTabs,.fav-search,.vf-compact,.vf-detail.open')):Array.from(wrapper.parentElement.children).filter(el=>el.matches('.word-search-wrapper'));
    const followers=candidates.filter(el=>{if(el===wrapper)return false;const r=el.getBoundingClientRect();return r.height&&r.bottom>-margin&&r.top<innerHeight+margin;});
    const named=[root,wrapper,...(modal?[modal]:[]),...followers];
    const previous=named.map(el=>[el,el.style.viewTransitionName]);
    let transition,cancelled=false,cleaned=false,plate=null;
    const clipAnimations=[];
    const isolation=wrapper.style.isolation;
    function clipInsets(element){
      const pane=element.closest('[role="tabpanel"]');
      if(!pane||!element.isConnected)return null;
      const r=element.getBoundingClientRect(),p=pane.getBoundingClientRect();
      const sx=p.width/(pane.offsetWidth||p.width),sy=p.height/(pane.offsetHeight||p.height);
      const left=p.left+pane.clientLeft*sx,top=p.top+pane.clientTop*sy;
      return [top-r.top,r.right-left-pane.clientWidth*sx,r.bottom-top-pane.clientHeight*sy,left-r.left];
    }
    function clipPath(from,to,progress){
      return 'inset('+from.map((value,i)=>(value+(to[i]-value)*progress).toFixed(4)+'px').join(' ')+')';
    }
    const clipped=named.filter(element=>element.closest('[role="tabpanel"]')).map(element=>({element,from:null,to:null}));
    function applyClips(){
      if(cancelled||cleaned||active?.cancel!==cancel)return;
      const animations=document.getAnimations();
      clipped.forEach(({element,from,to})=>{
        if(!from||!to)return;
        const pseudo='::view-transition-group('+element.style.viewTransitionName+')';
        const motion=animations.find(animation=>animation.effect?.pseudoElement===pseudo);
        if(motion){
          // Signed insets move with the same geometry/easing as the group. Their
          // world-space edges therefore remain on the scrolling pane throughout
          // the turn, even when a row enters or leaves its visible scrollport.
          motion.effect.setKeyframes(motion.effect.getKeyframes().map(frame=>{
            const {computedOffset,...keyframe}=frame;
            keyframe.clipPath=clipPath(from,to,computedOffset);
            return keyframe;
          }));
        }else{
          // A newly captured row may have only a fade, with no geometry motion.
          // Clip that stationary group at its final position until cleanup.
          clipAnimations.push(root.animate({clipPath:clipPath(to,to,1)},{duration:1,fill:'both',pseudoElement:pseudo}));
        }
      });
    }
    function removePlate(){plate?.remove();plate=null;wrapper.style.isolation=isolation;}
    function capture(){
      removePlate();
      const source=modal?.querySelector('.glass-modal-canvas')||document.querySelector('html.glass-gpu .glass-wallpaper-canvas');
      if(!source||!source.width)return;
      const r=wrapper.getBoundingClientRect(),s=source.getBoundingClientRect();if(!r.width||!r.height)return;
      plate=document.createElement('canvas');plate.className='card-motion-plate';plate.setAttribute('aria-hidden','true');
      plate.width=Math.ceil(r.width);plate.height=Math.ceil(r.height);
      const ctx=plate.getContext('2d');ctx.drawImage(source,(r.left-s.left)*source.width/s.width,(r.top-s.top)*source.height/s.height,r.width*source.width/s.width,r.height*source.height/s.height,0,0,r.width,r.height);
      if(modal){ctx.fillStyle='rgba(255,255,255,.26)';ctx.fillRect(0,0,plate.width,plate.height);}
      wrapper.style.isolation='isolate';wrapper.prepend(plate);
    }
    function cleanup(){
      if(cleaned)return;cleaned=true;
      window.removeEventListener('wheel',userScroll,true);
      window.removeEventListener('touchstart',userScroll,true);
      clipAnimations.forEach(animation=>animation.cancel());
      removePlate();delete wrapper.dataset.snapshotTurning;wrapper.classList.remove('is-flipping','is-snapshot-turning');
      previous.forEach(([el,name])=>el.style.viewTransitionName=name);
      if(modal&&modal._cancelCardMotion===cancel)delete modal._cancelCardMotion;
      if(active?.cancel===cancel)active=null;
      window.GlassRenderer?.render();
    }
    function cancel(){cancelled=true;transition?.skipTransition();cleanup();}
    function userScroll(event){if(event.isTrusted)cancel();}
    active={cancel};if(modal)modal._cancelCardMotion=cancel;
    try{
      window.addEventListener('wheel',userScroll,{capture:true,passive:true});
      window.addEventListener('touchstart',userScroll,{capture:true,passive:true});
      root.style.viewTransitionName='none';wrapper.style.viewTransitionName='study-turn';
      if(modal)modal.style.viewTransitionName='study-shell';
      named.slice(modal?3:2).forEach((el,i)=>el.style.viewTransitionName='study-follow-'+i);
      wrapper.classList.add('is-flipping','is-snapshot-turning');
      window.GlassRenderer?.flush();capture();wrapper.dataset.snapshotTurning='';
      clipped.forEach(item=>item.from=clipInsets(item.element));
      transition=document.startViewTransition(()=>{
        if(cancelled||!wrapper.isConnected)return;
        removePlate();render();delete wrapper.dataset.snapshotTurning;
        window.GlassRenderer?.flush();capture();wrapper.dataset.snapshotTurning='';
        clipped.forEach(item=>item.to=clipInsets(item.element));
      });
      transition.ready.then(applyClips).catch(()=>{if(!cancelled&&!cleaned)transition.skipTransition();});
      await transition.finished;
    }finally{cleanup();}
  }
  window.CardMotion={turn:turn,cancel:()=>active?.cancel()};
})();
