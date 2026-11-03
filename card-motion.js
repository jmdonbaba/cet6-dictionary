/* Lay out the new face once. Only the turning card uses a bitmap snapshot;
   unchanged text follows with live compositor transforms. */
(function(){
  'use strict';
  let active=null;
  const promoted=new Set();
  function release(element){element.classList.remove('card-motion-follow');promoted.delete(element);visibility?.unobserve(element);}
  const visibility=typeof IntersectionObserver==='function'?new IntersectionObserver(entries=>{
    entries.forEach(entry=>{if(!entry.isIntersecting)release(entry.target);});
  },{rootMargin:innerHeight+'px'}):null;
  async function turn(wrapper,render){
    if(active)active.cancel();
    const modal=wrapper.closest('.modal-card'),root=document.documentElement;
    const margin=wrapper.offsetHeight+innerHeight;
    const candidates=modal?Array.from(modal.querySelectorAll('.modal-header,#favoriteStudyTabs,.fav-search,.vf-compact,.vf-detail.open')):Array.from(wrapper.parentElement.children).filter(el=>el.matches('.word-search-wrapper'));
    const followers=candidates.filter(el=>{if(el===wrapper)return false;const r=el.getBoundingClientRect();return r.height&&r.bottom>-margin&&r.top<innerHeight+margin;});
    const named=[root,wrapper];
    const previous=named.map(el=>[el,el.style.viewTransitionName]);
    let transition,cancelled=false,cleaned=false,plate=null,shell=null;
    const motionAnimations=[],restoreStyles=[];
    const before=new Map(followers.map(el=>[el,el.getBoundingClientRect()]));
    const oldModal=modal?.getBoundingClientRect();
    const pane=wrapper.closest('[role="tabpanel"]');
    const isolation=wrapper.style.isolation;
    function cssScale(element,r=element.getBoundingClientRect()){
      const s=getComputedStyle(element);
      const size=(axis)=>parseFloat(s[axis])+(s.boxSizing==='border-box'?0:
        axis==='width'?parseFloat(s.paddingLeft)+parseFloat(s.paddingRight)+parseFloat(s.borderLeftWidth)+parseFloat(s.borderRightWidth):
          parseFloat(s.paddingTop)+parseFloat(s.paddingBottom)+parseFloat(s.borderTopWidth)+parseFloat(s.borderBottomWidth));
      return {x:r.width/(size('width')||r.width),y:r.height/(size('height')||r.height)};
    }
    function setStyle(element,property,value){
      restoreStyles.push([element,property,element.style.getPropertyValue(property),element.style.getPropertyPriority(property)]);
      element.style.setProperty(property,value);
    }
    function animate(element,frames,clock,id,extra={}){
      const animation=element.animate(frames,{duration:440,easing:'cubic-bezier(.4,0,.2,1)',fill:'both',...extra});
      animation.id='card-motion-'+id;
      if(clock!==null)animation.startTime=clock;
      motionAnimations.push(animation);
      return animation;
    }
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
    const clipped=pane?[{element:wrapper,from:null,to:null}]:[];
    function applyClips(){
      if(cancelled||cleaned||active?.cancel!==cancel)return;
      const animations=document.getAnimations();
      const clock=animations.find(animation=>animation.effect?.pseudoElement==='::view-transition-group(study-turn)')?.startTime??document.timeline.currentTime;
      followers.forEach(element=>{
        if(!element.isConnected)return;
        const from=before.get(element),to=element.getBoundingClientRect(),scale=cssScale(element,to);
        element.classList.add('card-motion-follow');promoted.add(element);visibility?.observe(element);
        const frames={translate:[(from.left-to.left)/scale.x+'px '+(from.top-to.top)/scale.y+'px','0px 0px']};
        animate(element,frames,clock,'follower',{composite:'add'});
      });
      if(shell&&modal){
        const to=modal.getBoundingClientRect(),host=modal.parentElement,scale=cssScale(host);
        animate(shell,{transform:[`translate(${(oldModal.left-to.left)/scale.x}px,${(oldModal.top-to.top)/scale.y}px) scale(${oldModal.width/to.width},${oldModal.height/to.height})`,'none']},clock,'shell');
      }
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
          motionAnimations.push(root.animate({clipPath:clipPath(to,to,1)},{duration:1,fill:'both',pseudoElement:pseudo}));
        }
      });
    }
    function updateShell(){
      if(!modal)return;
      if(!shell){
        shell=document.createElement('div');shell.className='card-motion-shell';shell.setAttribute('aria-hidden','true');
        const style=getComputedStyle(modal),optics=getComputedStyle(modal,'::before'),reflection=getComputedStyle(modal,'::after');
        for(const property of ['background','border','border-radius','box-shadow'])shell.style.setProperty(property,style.getPropertyValue(property));
        const source=modal.querySelector('.glass-modal-canvas');
        if(source?.width){const canvas=document.createElement('canvas');canvas.className='card-motion-shell-optics';shell.append(canvas);}
        const face=document.createElement('div');face.className='card-motion-shell-optics';
        for(const property of ['background','box-shadow','backdrop-filter','-webkit-backdrop-filter','filter'])face.style.setProperty(property,optics.getPropertyValue(property));
        shell.append(face);
        if(reflection.content!=='none'){
          const glint=document.createElement('div');glint.className='card-motion-shell-optics';
          for(const property of ['background','opacity','box-shadow','filter','mix-blend-mode'])glint.style.setProperty(property,reflection.getPropertyValue(property));
          shell.append(glint);
        }
        modal.before(shell);
        modal.classList.add('card-motion-live-modal');
        setStyle(modal,'z-index','1');
      }
      const r=modal.getBoundingClientRect(),host=modal.parentElement,h=host.getBoundingClientRect(),scale=cssScale(host,h);
      Object.assign(shell.style,{left:(r.left-h.left)/scale.x+'px',top:(r.top-h.top)/scale.y+'px',width:r.width/scale.x+'px',height:r.height/scale.y+'px'});
      const canvas=shell.querySelector('canvas'),source=modal.querySelector('.glass-modal-canvas');
      if(canvas&&source?.width){
        const s=source.getBoundingClientRect();
        canvas.width=Math.ceil(r.width*devicePixelRatio);canvas.height=Math.ceil(r.height*devicePixelRatio);
        const context=canvas.getContext('2d');
        context.drawImage(source,0,0,source.width*r.width/s.width,source.height*r.height/s.height,0,0,canvas.width,canvas.height);
      }
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
      motionAnimations.forEach(animation=>animation.cancel());
      restoreStyles.reverse().forEach(([element,property,value,priority])=>value?element.style.setProperty(property,value,priority):element.style.removeProperty(property));
      if(cancelled||!visibility)followers.forEach(release);
      shell?.remove();shell=null;modal?.classList.remove('card-motion-live-modal');
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
      promoted.forEach(element=>{
        const r=element.getBoundingClientRect();
        if(r.bottom<-margin||r.top>innerHeight+margin||!r.height||!element.isConnected)release(element);
      });
      root.style.viewTransitionName='none';wrapper.style.viewTransitionName='study-turn';
      wrapper.classList.add('is-flipping','is-snapshot-turning');
      window.GlassRenderer?.flush();capture();updateShell();wrapper.dataset.snapshotTurning='';
      clipped.forEach(item=>item.from=clipInsets(item.element));
      transition=document.startViewTransition(()=>{
        if(cancelled||!wrapper.isConnected)return;
        removePlate();render();delete wrapper.dataset.snapshotTurning;
        window.GlassRenderer?.flush();capture();updateShell();wrapper.dataset.snapshotTurning='';
        clipped.forEach(item=>item.to=clipInsets(item.element));
      });
      transition.ready.then(applyClips).catch(()=>{if(!cancelled&&!cleaned)transition.skipTransition();});
      await transition.finished;
    }finally{cleanup();}
  }
  window.CardMotion={turn:turn,cancel:()=>active?.cancel()};
})();
