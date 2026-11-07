/* One wallpaper recipe for the immediately visible 2D background and GPU texture. */
(function(){
  'use strict';
  var waterPromise=null,water=null,preview=null,last='';
  // Travel is a fraction of the viewport, and the period is in seconds.
  var ambientThemes = {
    aurora: { period: 24, x: .03, y: .026, bend: .035 },
    peach: { period: 32, x: .025, y: .022, bend: .018 },
    night: { period: 36, x: .024, y: .026, bend: .026 }
  };
  function motionFor(theme) { return ambientThemes[theme] || null; }
  function rgba(token,alpha){return 'rgba('+token+','+alpha+')';}
  function paint(ctx,width,height,theme,water){
    var palettes = {
      aurora: ['#f1f6ff','#f7f2ff','#eefbf8'], peach: ['#fff8f0','#fff1f2','#f7f3ff'],
      night: ['#0b1026','#131a3a','#0b2130'], water: ['#78b5dc','#79b7dc','#86c3e5'],
      minimal: ['#eef0f8','#eef0f8','#eef0f8']
    };
    var palette = palettes[theme] || palettes.aurora;
    var base = ctx.createLinearGradient(0, 0, width * .4, height);
    palette.forEach(function (color, i) { base.addColorStop(i / 2, color); });
    ctx.fillStyle = base; ctx.fillRect(0, 0, width, height);
    if (theme === 'water' && water) {
      var imageScale = Math.max(width / water.width, height / water.height);
      ctx.drawImage(water, (width - water.width * imageScale) / 2, (height - water.height * imageScale) / 2,
        water.width * imageScale, water.height * imageScale);
      ctx.fillStyle = 'rgba(255,255,255,.18)'; ctx.fillRect(0, 0, width, height);
    } else if (theme !== 'minimal' && theme !== 'water') {
      var style = getComputedStyle(document.documentElement), vmax = Math.max(width, height);
      var colors = ['a','b','c','d'].map(function (n) { return style.getPropertyValue('--aurora-' + n).trim() || '125,211,252'; });
      [[.08,.05,.62,.7],[.98,.2,.54,.6],[.86,1.1,.52,.48],[.05,1.15,.5,.44]].forEach(function (blob, i) {
        var x = width * blob[0], y = height * blob[1], r = vmax * blob[2];
        var gradient = ctx.createRadialGradient(x,y,0,x,y,r);
        gradient.addColorStop(0, rgba(colors[i],blob[3])); gradient.addColorStop(1, rgba(colors[i],0));
        ctx.fillStyle = gradient; ctx.fillRect(0,0,width,height);
      });
      // The same contours and palette treatment for every detailed wallpaper.
      ctx.save(); ctx.scale(width / 1440, height / 1000);
      var ribbon = ctx.createLinearGradient(0,0,1440,1000);
      ribbon.addColorStop(0,rgba(colors[0],.45)); ribbon.addColorStop(.5,rgba(colors[1],.4)); ribbon.addColorStop(1,rgba(colors[2],.48));
      ctx.strokeStyle = ribbon;
      ctx.lineWidth = 110; ctx.beginPath(); ctx.moveTo(-160,160); ctx.bezierCurveTo(160,40,380,580,750,340); ctx.bezierCurveTo(1000,180,1190,20,1580,300); ctx.stroke();
      ctx.globalAlpha = .7; ctx.lineWidth = 170; ctx.beginPath(); ctx.moveTo(-120,640); ctx.bezierCurveTo(200,910,400,310,760,560); ctx.bezierCurveTo(1100,800,1170,940,1580,600); ctx.stroke();
      ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(-80,870); ctx.bezierCurveTo(290,630,530,1040,900,820); ctx.bezierCurveTo(1200,650,1290,550,1540,780); ctx.stroke();
      ctx.restore();
    }
  }
  function waterReady(){
    if(waterPromise)return waterPromise;
    waterPromise=new Promise(function(resolve){
      var image=new Image();
      image.onload=function(){water=image;refresh();resolve(image);};
      image.onerror=function(){resolve(null);};
      if(location.protocol==='file:'){
        var script=document.createElement('script');script.src='assets/water-caustics-data.js?v=b4267103b84a';
        script.onload=function(){image.src=window.Cet6WaterTexture;script.remove();};script.onerror=function(){script.remove();resolve(null);};document.head.appendChild(script);
      }else image.src='assets/water-caustics.webp?v=8922591c3548';
    });return waterPromise;
  }
  function refresh(){
    var root=document.documentElement,host=document.getElementById('appearanceBackdrop');
    if(!host)return;
    if(root.dataset.interface!=='glass'){if(root.classList.contains('glass-preview'))root.classList.remove('glass-preview');return;}
    if(!root.classList.contains('glass-preview'))root.classList.add('glass-preview');
    if(!preview){preview=document.createElement('canvas');preview.className='glass-preview-canvas';preview.setAttribute('aria-hidden','true');host.prepend(preview);}
    var box=host.getBoundingClientRect(),width=box.width,height=box.height;
    if(!width||!height)return;
    var theme=root.dataset.wallpaper,scale=Math.min(devicePixelRatio||1,1.5,Math.sqrt(2400000/(width*height)));
    var key=[width,height,scale,theme,!!water].join(':');if(last===key)return;last=key;
    preview.width=Math.max(1,Math.round(width*scale));preview.height=Math.max(1,Math.round(height*scale));
    var ctx=preview.getContext('2d');ctx.setTransform(scale,0,0,scale,0,0);paint(ctx,width,height,theme,water);
    if(theme==='water')waterReady();
  }
  document.addEventListener('appearancechange',refresh);window.addEventListener('resize',refresh,{passive:true});
  window.GlassWallpaper={paint:paint,refresh:refresh,waterReady:waterReady,motionFor:motionFor};
})();
