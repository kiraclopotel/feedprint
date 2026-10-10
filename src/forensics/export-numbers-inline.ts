// FeelingWise - the numbers engine restated as a string, for the exported HTML.
//
// The forensic export runs in the recipient's browser from inline scripts and
// cannot import src/forensics/export-numbers.ts. This constant is that module
// written out as plain ES5 under one global, FWN, the same way
// WILSON_INLINE_SOURCE in html-export.ts restates wilson.ts. It must not drift,
// and two tests say so:
// tests/unit/forensics/export-numbers-filters.test.ts runs both the module and
// this string over the same records and requires the same answers, and
// tests/unit/forensics/numbers-engine-lists-in-step.source.test.ts compares the
// three shared lists as text, because a list that grows on one side only leaves
// every existing fixture still agreeing. Change export-numbers.ts first, then
// this file, then let both tests say whether they still agree.
//
// Column rules and the reasons behind them are documented once, in
// export-numbers.ts; nothing here adds a rule of its own.

export const EXPORT_NUMBERS_INLINE_SOURCE = `var FWN=(function(){
  var PLATFORM_ORDER=['twitter','facebook','youtube','tiktok','instagram'];
  var SYSTEM_MARKER_KINDS=['reset-marker','month-rotation-marker','prune-marker','gap-marker','heartbeat-marker','import-marker','repair-marker','redaction-marker','reconcile-marker'];
  /* The one place the reading view asks "is this housekeeping rather than
     something the feed showed". It used to ask by writing the nine kinds out
     as an OR chain, six times over, which is how a kind added later reaches
     four of its six sites and nobody notices (it happened once already, with
     the prune marker, in W36). */
  function isSystemMarker(r){return !!r&&SYSTEM_MARKER_KINDS.indexOf(r.kind)!==-1;}
  var SITTING_GAP_MS=30*60*1000;
  var USER_RULE_LABELS=['word-filter','account-block','hashtag-block','ai-content-block','reel-surface','media-timeout'];
  /* A reading the person asked for (export-numbers.ts isButtonReading): not a serving. */
  function isButtonReading(r){return typeof r.detectionMode==='string'&&r.detectionMode.indexOf('read-this')!==-1;}
  function isImpression(r){
    if(isButtonReading(r))return false;
    var k=r.kind;
    if(k===undefined)return true;
    if(k==='image'||k==='environment')return false;
    return SYSTEM_MARKER_KINDS.indexOf(k)===-1;
  }
  function contentIdentity(r){
    if(typeof r.originalHash!=='string'||r.originalHash==='')return null;
    if(typeof r.originalText==='string'&&r.originalText.indexOf('[blocked:')===0)return null;
    return r.originalHash;
  }
  function baseMode(r){
    var m=typeof r.detectionMode==='string'?r.detectionMode:'';
    var p='late-after-rotation:';
    return m.indexOf(p)===0?m.slice(p.length):m;
  }
  function hasRail(r,name){
    var rails=r.decision&&r.decision.rails;
    if(!rails)return false;
    for(var i=0;i<rails.length;i++)if(rails[i].name===name)return true;
    return false;
  }
  function isManual(r){
    return r.feedSource==='manual'
      ||baseMode(r).indexOf('manual')===0
      ||(typeof r.id==='string'&&r.id.indexOf('fr-manual-')===0);
  }
  function ruleLabel(r){
    if(isManual(r))return 'manual';
    var mode=baseMode(r);
    var parts=mode.split(':');
    if(parts[0]==='block'){
      var reason=parts[1]||'';
      if(reason==='ads')return 'ad-marker';
      if(reason==='hashtag')return 'hashtag-block';
      if(reason==='ai-label')return 'ai-content-block';
      if(reason==='reel-surface')return 'reel-surface';
      if(reason==='media-timeout')return 'media-timeout';
      return reason?'block:'+reason:'rule';
    }
    if(parts[0]==='sponsored-ad')return 'ad-marker';
    if(parts[0]==='blocklist'){
      var kind=parts[1]||'';
      if(kind==='account')return 'account-block';
      if(kind==='hashtag')return 'hashtag-block';
      return 'word-filter';
    }
    if(hasRail(r,'sponsored'))return 'ad-marker';
    if(hasRail(r,'blocklist'))return 'word-filter';
    if(r.overrideOrigin)return r.overrideOrigin;
    if(hasRail(r,'identity-slur'))return 'identity-slur';
    if(hasRail(r,'coded-harm'))return 'coded-harm';
    if(r.verdict==='blocked')return 'rule';
    if(r.aiSource==='rules'||r.aiSource==='none')return 'rule';
    return null;
  }
  function isUserRule(label){
    return label!==null&&USER_RULE_LABELS.indexOf(label)!==-1;
  }
  function isPaidPlacement(r){
    var mode=baseMode(r);
    return mode.indexOf('sponsored-ad')===0
      ||mode.indexOf('block:ads')===0
      ||hasRail(r,'sponsored')
      ||r.accountType==='advertiser';
  }
  function isUserHidden(r){
    return isUserRule(ruleLabel(r));
  }
  // stand-in.ts: the words that stand in for a hidden item stored with no caption.
  function isHiddenAd(r){
    if(!isPaidPlacement(r))return false;
    var ap=r.decision&&r.decision.applied;
    return ap?ap==='hide':(r.verdict==='blocked'||r.verdict==='flagged-hidden');
  }
  function standInKey(r){
    if(typeof r.originalText!=='string'||r.originalText.indexOf('[blocked:')!==0)return null;
    if(isHiddenAd(r))return 'feedAdHidden';
    var lbl=ruleLabel(r);
    return (lbl==='hashtag-block'||lbl==='account-block'||lbl==='word-filter')?'feedHiddenOwnRuleNoCaption':'feedHiddenNoCaption';
  }
  /* The population and the flagged side of the flagged share, restated for the
     recipient's browser. One rule for page one and for the reading view below
     it: until 2026-09-17 the glance over the records counted image records and
     page one did not, so this file printed 129 flagged items in one block and
     108 in another. The module's copy is src/forensics/flag-provenance.ts and
     tests/unit/forensics/flag-provenance-in-step.test.ts runs both over the
     same records. */
  function isDecidedContentRecord(r){
    var k=r.kind;
    if(k==='environment'||k==='image'||SYSTEM_MARKER_KINDS.indexOf(k)!==-1)return false;
    if(isButtonReading(r))return false;
    var v=r.verdict;
    return v==='pass'||v==='masked'||v==='blocked'||((v==='flagged'||v==='flagged-hidden'||v===undefined)&&!isRepeatOnly(r));
  }
  /* "Seen a lot" (a repeat-exposure mark alone) is on neither side: nothing read it (flag-verdict.ts). */
  function isRepeatOnly(r){return !!(r.techniques&&r.techniques.length===1&&r.techniques[0].name==='repeat-exposure');}
  function isFlaggedRecord(r){
    if(isPaidPlacement(r))return false;
    var v=r.verdict;
    return (v==='flagged'||v==='flagged-hidden'||v===undefined)&&!isRepeatOnly(r);
  }
  function isModelNamed(r){
    var v=r.verdict;
    var flagged=v==='flagged'||v==='flagged-hidden'||v===undefined;
    if(!flagged)return false;
    if(isPaidPlacement(r))return false;
    if(isManual(r))return false;
    if(r.overrideOrigin)return false;
    if(r.techniques&&r.techniques.length===1&&r.techniques[0].name==='repeat-exposure')return false;
    return r.aiSource==='cloud'||r.aiSource==='local';
  }
  function surfaceBucket(r){
    var f=r.feedSource;
    if(f==='for-you'||f==='following'||f==='profile'||f==='permalink'||f==='search')return f;
    if(f===undefined||f==='unknown')return 'unknown';
    return 'other';
  }
  function sittingByRecordId(records){
    /* Time order, not file order (export-numbers.ts sittingByRecordId says why). */
    var out={};
    var timed=[];
    for(var i=0;i<records.length;i++){
      var r=records[i];
      if(!isImpression(r))continue;
      var t=+new Date(r.timestamp);
      if(isNaN(t))continue;
      timed.push({id:r.id,t:t,i:i});
    }
    timed.sort(function(a,b){return a.t!==b.t?a.t-b.t:a.i-b.i;});
    var sitting=0;
    var lastEnd=NaN;
    for(var k=0;k<timed.length;k++){
      if(sitting===0||timed[k].t-lastEnd>=SITTING_GAP_MS)sitting++;
      lastEnd=timed[k].t;
      out[timed[k].id]=sitting;
    }
    return out;
  }
  function seenBeforeIds(records){
    var seen={};
    var out={};
    for(var i=0;i<records.length;i++){
      var r=records[i];
      if(!isImpression(r))continue;
      var key=contentIdentity(r);
      if(key===null)continue;
      if(seen[key])out[r.id]=true;
      else seen[key]=true;
    }
    return out;
  }
  function has(list,v){
    return !list||list.length===0||list.indexOf(v)!==-1;
  }
  function parentImpression(records,image){
    var pid=image.parentVideoId;
    if(typeof pid!=='string'||pid==='')return null;
    var byUrl=null;
    for(var i=0;i<records.length;i++){
      var r=records[i];
      if(r.platform!==image.platform||!isImpression(r))continue;
      if(r.kind==='comment'||r.kind==='reply')continue;
      if(r.parentVideoId===pid)return r;
      if(byUrl===null&&typeof r.postUrl==='string'&&r.postUrl!==''){
        var url=r.postUrl.split('?')[0].replace(/\\/+$/,'');
        if(url.slice(-(pid.length+1))==='/'+pid)byUrl=r;
      }
    }
    return byUrl;
  }
  function applyFilters(records,filter){
    var surfaceSet=!!(filter.surfaces&&filter.surfaces.length);
    var sittings=filter.sittings&&filter.sittings.length?sittingByRecordId(records):null;
    var column=filter.column;
    var before=(filter.seenBefore!==undefined||column==='uniquePosts'||column==='extraCopies')?seenBeforeIds(records):null;
    var narrows=surfaceSet||sittings!==null||filter.seenBefore!==undefined||filter.level!==undefined||column!==undefined;
    function inColumn(r){
      if(column==='uniquePosts')return contentIdentity(r)!==null&&!(before&&before[r.id]);
      if(column==='extraCopies')return contentIdentity(r)!==null&&!!(before&&before[r.id]);
      if(column==='paidPlacements')return isPaidPlacement(r);
      if(column==='userHidden')return isUserHidden(r);
      if(column==='modelNamed')return isModelNamed(r);
      return true;
    }
    function passes(r){
      if(surfaceSet&&!has(filter.surfaces,surfaceBucket(r)))return false;
      if(sittings&&!has(filter.sittings,sittings[r.id]))return false;
      if(filter.seenBefore!==undefined&&(!!before&&before[r.id]===true)!==filter.seenBefore)return false;
      if(filter.level!==undefined&&severityLevel(r)!==filter.level)return false;
      if(!inColumn(r))return false;
      return true;
    }
    var out=[];
    for(var i=0;i<records.length;i++){
      var r=records[i];
      if(!has(filter.platforms,r.platform))continue;
      if(isImpression(r)){
        if(!passes(r))continue;
      }else if(narrows){
        if(r.kind!=='image')continue;
        var parent=parentImpression(records,r);
        if(parent===null||!passes(parent))continue;
      }
      out.push(r);
    }
    return out;
  }
  function severityLevel(r){
    if(!isModelNamed(r))return null;
    var max=0,t=r.techniques||[];
    for(var i=0;i<t.length;i++){if(typeof t[i].severity==='number'&&t[i].severity>max)max=t[i].severity;}
    return max>=6?'high':max>=3?'medium':'low';
  }
  function emptyRow(platform){
    return {platform:platform,impressions:0,uniquePosts:0,extraCopies:0,paidPlacements:0,userHidden:0,modelNamed:0};
  }
  function computePlatformRows(records,filter){
    var set=filter?applyFilters(records,filter):records;
    var before=seenBeforeIds(records);
    var rows={};
    for(var i=0;i<PLATFORM_ORDER.length;i++)rows[PLATFORM_ORDER[i]]=emptyRow(PLATFORM_ORDER[i]);
    var total=emptyRow('total');
    for(var j=0;j<set.length;j++){
      var r=set[j];
      if(!isImpression(r))continue;
      var row=rows[r.platform];
      if(!row)continue;
      row.impressions++;
      total.impressions++;
      if(contentIdentity(r)!==null){
        if(before[r.id]){row.extraCopies++;total.extraCopies++;}else{row.uniquePosts++;total.uniquePosts++;}
      }
      if(isPaidPlacement(r)){row.paidPlacements++;total.paidPlacements++;}
      if(isUserHidden(r)){row.userHidden++;total.userHidden++;}
      if(isModelNamed(r)){row.modelNamed++;total.modelNamed++;}
    }
    var out=[];
    for(var k=0;k<PLATFORM_ORDER.length;k++)out.push(rows[PLATFORM_ORDER[k]]);
    out.push(total);
    return out;
  }
  return {
    PLATFORM_ORDER:PLATFORM_ORDER,
    SITTING_GAP_MS:SITTING_GAP_MS,
    isImpression:isImpression,
    contentIdentity:contentIdentity,
    ruleLabel:ruleLabel,
    isUserRule:isUserRule,
    isPaidPlacement:isPaidPlacement,
    isUserHidden:isUserHidden,
    isHiddenAd:isHiddenAd,
    standInKey:standInKey,
    isSystemMarker:isSystemMarker,
    isDecidedContentRecord:isDecidedContentRecord,
    isFlaggedRecord:isFlaggedRecord,
    isModelNamed:isModelNamed,
    surfaceBucket:surfaceBucket,
    severityLevel:severityLevel,
    sittingByRecordId:sittingByRecordId,
    seenBeforeIds:seenBeforeIds,
    applyFilters:applyFilters,
    computePlatformRows:computePlatformRows
  };
})();`;
