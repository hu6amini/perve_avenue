!function(){
  'use strict';
  
  // ========== MAIN OPTIMIZER ==========
  if(document.currentScript)document.currentScript.setAttribute('data-priority','highest');
  
  // Helper to process a single element
  function optimizeElement(el){
    if(el.tagName==='IMG'||el.tagName==='IFRAME'){
      if(!el.loading||el.loading===''){
        el.loading='lazy';
      }
      if(el.tagName==='IMG'&&(!el.decoding||el.decoding==='')){
        el.decoding='async';
      }
    }
    return el;
  }
  
  // 1. INTERCEPT innerHTML/outerHTML
  function interceptInnerHTML(proto){
    if(!proto)return;
    
    var innerDesc=Object.getOwnPropertyDescriptor(proto,'innerHTML');
    var outerDesc=Object.getOwnPropertyDescriptor(proto,'outerHTML');
    
    if(innerDesc&&innerDesc.set){
      Object.defineProperty(proto,'innerHTML',{
        set:function(html){
          // Parse the HTML first
          var div=document.createElement('div');
          div.innerHTML=html;
          
          // Find and optimize img/iframe elements
          var imgs=div.querySelectorAll('img,iframe');
          for(var i=0;i<imgs.length;i++){
            optimizeElement(imgs[i]);
          }
          
          // Also check top-level elements
          for(var i=0;i<div.children.length;i++){
            var child=div.children[i];
            if(child.tagName==='IMG'||child.tagName==='IFRAME'){
              optimizeElement(child);
            }
          }
          
          // Set the processed HTML
          innerDesc.set.call(this,div.innerHTML);
        },
        get:innerDesc.get,
        configurable:true
      });
    }
    
    // Also intercept insertAdjacentHTML
    var origInsertAdjacentHTML=proto.insertAdjacentHTML;
    if(origInsertAdjacentHTML){
      proto.insertAdjacentHTML=function(position,html){
        // Parse and optimize before inserting
        var div=document.createElement('div');
        div.innerHTML=html;
        
        var imgs=div.querySelectorAll('img,iframe');
        for(var i=0;i<imgs.length;i++){
          optimizeElement(imgs[i]);
        }
        
        // Call original with optimized HTML
        return origInsertAdjacentHTML.call(this,position,div.innerHTML);
      };
    }
  }
  
  // Intercept on Element and HTMLElement
  interceptInnerHTML(Element.prototype);
  interceptInnerHTML(HTMLElement&&HTMLElement.prototype);
  
  // 2. INTERCEPT SOURCE SETTING
  var elProto=Element.prototype, setAttr=elProto.setAttribute;
  
  elProto.setAttribute=function(name,value){
    var tag=this.tagName;
    if((name==='src'||name==='srcset')&&(tag==='IMG'||tag==='IFRAME')){
      if(!this.loading||this.loading===''){
        this.loading='lazy';
      }
      if(tag==='IMG'&&(!this.decoding||this.decoding==='')){
        this.decoding='async';
      }
    }
    return setAttr.call(this,name,value);
  };
  
  // Intercept .src property
  function interceptProperty(proto,prop){
    if(!proto)return;
    var desc=Object.getOwnPropertyDescriptor(proto,prop);
    if(desc&&desc.set){
      Object.defineProperty(proto,prop,{
        set:function(v){
          var tag=this.tagName;
          if(!this.loading||this.loading===''){
            this.loading='lazy';
          }
          if(tag==='IMG'&&(!this.decoding||this.decoding==='')){
            this.decoding='async';
          }
          desc.set.call(this,v);
        },
        get:desc.get,
        configurable:true
      });
    }
  }
  interceptProperty(HTMLImageElement&&HTMLImageElement.prototype,'src');
  interceptProperty(HTMLIFrameElement&&HTMLIFrameElement.prototype,'src');
  
  // 3. OVERRIDE ELEMENT CREATION
  var ce=document.createElement, imgC=window.Image;
  document.createElement=function(tagName){
    var el=ce.call(document,tagName);
    return optimizeElement(el);
  };
  
  // 4. OVERRIDE Image CONSTRUCTOR
  if(imgC){
    window.Image=function(){
      var img=new imgC();
      img.loading='lazy';
      img.decoding='async';
      return img;
    };
    window.Image.prototype=imgC.prototype;
  }
  
  // 5. PROCESS EXISTING ELEMENTS
  function processExisting(){
    var imgs=document.querySelectorAll('img:not([loading]),iframe:not([loading]),img:not([decoding])');
    for(var i=0;i<imgs.length;i++){
      optimizeElement(imgs[i]);
    }
  }
  
  // 6. START IMMEDIATELY
  if(document.readyState==='loading'){
    document.addEventListener('DOMContentLoaded',processExisting);
    setTimeout(processExisting,0);
  }else{
    processExisting();
  }
  
  // 7. MUTATION OBSERVER (for any other dynamic additions)
  var mo=new MutationObserver(function(mutations){
    for(var i=0;i<mutations.length;i++){
      var mutation=mutations[i];
      if(mutation.type==='childList'&&mutation.addedNodes.length>0){
        for(var j=0;j<mutation.addedNodes.length;j++){
          var node=mutation.addedNodes[j];
          if(node.nodeType===1){ // Element node
            optimizeElement(node);
            
            // Also optimize children
            if(node.querySelectorAll){
              var children=node.querySelectorAll('img,iframe');
              for(var k=0;k<children.length;k++){
                optimizeElement(children[k]);
              }
            }
          }
        }
      }
    }
  });
  
  function startObserver(){
    if(document.body){
      mo.observe(document.body,{childList:true,subtree:true});
    }else{
      setTimeout(startObserver,10);
    }
  }
  startObserver();
  
  // ========== MONITORING ==========
  // Track innerHTML/outerHTML usage
  var htmlOperations=[];
  var origCreateElement=document.createElement;
  
  // Monitor document.write as well (some forums use it)
  var origWrite=document.write;
  var origWriteln=document.writeln;
  
  if(origWrite){
    document.write=function(text){
      // Parse and optimize images in the text
      var div=document.createElement('div');
      div.innerHTML=text;
      var imgs=div.querySelectorAll('img,iframe');
      for(var i=0;i<imgs.length;i++){
        optimizeElement(imgs[i]);
      }
      // Reconstruct HTML
      var optimizedText=div.innerHTML;
      htmlOperations.push({type:'write',text:text,optimized:optimizedText});
      return origWrite.call(document,optimizedText);
    };
  }
  
  if(origWriteln){
    document.writeln=function(text){
      var div=document.createElement('div');
      div.innerHTML=text;
      var imgs=div.querySelectorAll('img,iframe');
      for(var i=0;i<imgs.length;i++){
        optimizeElement(imgs[i]);
      }
      var optimizedText=div.innerHTML;
      htmlOperations.push({type:'writeln',text:text,optimized:optimizedText});
      return origWriteln.call(document,optimizedText);
    };
  }
  
  // Debug function
  window.debugMediaOptimizer=function(){
    console.log('=== MEDIA OPTIMIZER DEBUG ===');
    console.log('HTML operations intercepted:',htmlOperations.length);
    
    // Test all creation methods
    console.log('\n--- Creation Tests ---');
    
    // Test 1: createElement
    var test1=document.createElement('img');
    console.log('createElement img: loading='+test1.loading+', decoding='+test1.decoding);
    
    // Test 2: Image constructor
    var test2=new Image();
    console.log('new Image(): loading='+test2.loading+', decoding='+test2.decoding);
    
    // Test 3: innerHTML
    var div1=document.createElement('div');
    div1.innerHTML='<img src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7">';
    var test3=div1.querySelector('img');
    console.log('innerHTML img: loading='+test3.loading+', decoding='+test3.decoding);
    
    // Test 4: insertAdjacentHTML
    var div2=document.createElement('div');
    div2.insertAdjacentHTML('beforeend','<iframe src="about:blank"></iframe>');
    var test4=div2.querySelector('iframe');
    console.log('insertAdjacentHTML iframe: loading='+test4.loading);
    
    // Check existing
    var allImgs=document.querySelectorAll('img');
    var lazyCount=0,asyncCount=0;
    for(var i=0;i<allImgs.length;i++){
      if(allImgs[i].loading==='lazy')lazyCount++;
      if(allImgs[i].decoding==='async')asyncCount++;
    }
    console.log('\n--- Existing Images ---');
    console.log('Total: '+allImgs.length);
    console.log('Lazy: '+lazyCount+' ('+Math.round((lazyCount/allImgs.length)*100)+'%)');
    console.log('Async decoding: '+asyncCount+' ('+Math.round((asyncCount/allImgs.length)*100)+'%)');
  };
  
  // Auto-debug on load
  window.addEventListener('load',function(){
    setTimeout(function(){
      console.log('=== MEDIA OPTIMIZER LOAD REPORT ===');
      var imgs=document.querySelectorAll('img');
      var lazy=0,asyncDec=0;
      for(var i=0;i<imgs.length;i++){
        if(imgs[i].loading==='lazy')lazy++;
        if(imgs[i].decoding==='async')asyncDec++;
      }
      console.log('Images: '+lazy+'/'+imgs.length+' lazy, '+asyncDec+'/'+imgs.length+' async decoding');
      
      // Run innerHTML test
      var div=document.createElement('div');
      div.innerHTML='<img src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7">';
      var testImg=div.firstChild;
      console.log('innerHTML test: loading='+testImg.loading+', decoding='+testImg.decoding);
      
      if(testImg.loading!=='lazy'){
        console.warn('⚠️ innerHTML images not being optimized!');
      }else{
        console.log('✅ All creation methods intercepted');
      }
    },1000);
  });
}();




!function(){
  // Monitor image/iframe loading
  var loadLog = [];
  
  // Override addEventListener for load/error events
  var origAdd = EventTarget.prototype.addEventListener;
  EventTarget.prototype.addEventListener = function(type, handler, options){
    if((type==='load'||type==='error') && (this.tagName==='IMG'||this.tagName==='IFRAME')){
      var start=Date.now();
      var src=this.src||this.getAttribute('src')||'[no-src]';
      var attrs={
        loading:this.getAttribute('loading'),
        decoding:this.getAttribute('decoding')
      };
      
      loadLog.push({
        element:this.tagName,
        src:src,
        attrs:attrs,
        eventAdded:start,
        attributesSet:start,
        willLoad:!this.complete
      });
      
      // Check if already loaded (happens fast)
      setTimeout(function(){
        if(!this.complete){
          loadLog[loadLog.length-1].attributesSet=Date.now();
          loadLog[loadLog.length-1].attrsAtLoad={
            loading:this.getAttribute('loading'),
            decoding:this.getAttribute('decoding')
          };
        }
      }.bind(this),0);
    }
    return origAdd.call(this,type,handler,options);
  };
  
  // Log results after page load
  window.addEventListener('load',function(){
    setTimeout(function(){
      console.log('=== LOAD TIMING ANALYSIS ===');
      console.log('Total elements monitored: '+loadLog.length);
      
      var lateCount=0;
      loadLog.forEach(function(item,idx){
        if(item.attrsAtLoad&&(!item.attrsAtLoad.loading||item.attrsAtLoad.loading!=='lazy')){
          console.warn('Late attribute #'+idx+':',item);
          lateCount++;
        }
      });
      
      if(lateCount===0){
        console.log('✅ All attributes set BEFORE element load');
      }else{
        console.warn('⚠️ '+lateCount+' elements had late attribute setting');
      }
    },1000);
  });
}();
