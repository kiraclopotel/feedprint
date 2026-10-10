// The scripts the exported page carries inside itself.
//
// A FeelingWise export is a single file a stranger can open with no network: the checker, the feed,
// the reading mode, the exposure view and the behavior section all run from inside it. Each of
// these constants is one of those scripts, as source text.
//
// Cut out of src/forensics/html-export.ts on 2026-09-16 (PLAN-2026-09-16 item 10.1). The builder
// imports them back and re-exports the names the tests and the verifier drift checks already use,
// so the page is byte-identical.

import type { ExportI18nStrings } from '../types/export-strings';
import { VERIFIER_CORE_FNS_SOURCE } from './verifier-core-source';

export const ANCHOR_CHECK_SCRIPT = `(function(){
  var data=window.__FW_EXPORT__;
  if(!data||!data.anchors||!data.anchors.length) return;
  var api=window.__FW_RFC3161__;
  var i18n=data.i18n;
  var LABELS={
    'response-granted':i18n.checkResponseGranted,
    'message-imprint':i18n.checkMessageImprint,
    'signed-attrs-digest':i18n.checkSignedAttrs,
    'signature':i18n.checkSignature,
    'timestamping-eku':i18n.checkEku,
    'genTime-in-cert-validity':i18n.checkGenTime,
    'issuer-signature':i18n.checkIssuer,
    'known-root':i18n.checkKnownRoot,
    'nonce-echo':i18n.checkNonce
  };
  function el(tag,cls,text){
    var e=document.createElement(tag);
    if(cls)e.className=cls;
    if(text!==undefined&&text!==null)e.textContent=String(text);
    return e;
  }
  function slot(i){return document.querySelector('[data-anchor-check="'+i+'"]');}
  function paint(i,v){
    var box=slot(i);
    if(!box)return;
    box.textContent='';
    box.appendChild(el('div','section-label',i18n.anchorCheckHeader));
    if(!v){
      box.appendChild(el('p','fw-anchor-check-line fw-anchor-bad',i18n.anchorCheckFailed));
      return;
    }
    if(v.couldNotCheck){
      box.appendChild(el('p','fw-anchor-check-line',i18n.anchorCheckUnavailable));
      return;
    }
    // Three states, not two. The ok flag is true for a token that is
    // internally sound under a certificate the file itself carries, and anyone
    // can mint a certificate authority and a timestamping certificate. Printing
    // "every check passed" over a self-minted token is the overclaim; naming
    // the unrecognised authority is the honest reading.
    var known=!!v.knownRootName;
    box.appendChild(el('p','fw-anchor-check-line '+(v.ok?(known?'fw-anchor-ok':'fw-anchor-warn'):'fw-anchor-bad'),
      v.ok?(known?i18n.anchorCheckPassed:i18n.anchorCheckPassedUnknown):i18n.anchorCheckFailed));
    if(v.genTime){
      box.appendChild(el('p','fw-anchor-check-line',i18n.anchorCheckSignedTime+': '+v.genTime));
    }
    if(v.signerSubject){
      var shortName=(api&&typeof api.shortSubject==='function')?api.shortSubject(v.signerSubject):v.signerSubject;
      var sp=el('p','fw-anchor-check-line',i18n.anchorCheckSigner+': '+shortName);
      sp.title=v.signerSubject;
      box.appendChild(sp);
    }
    var list=el('ul','fw-anchor-checks');
    for(var k=0;k<v.checks.length;k++){
      var c=v.checks[k];
      var li=el('li',c.ok?'fw-anchor-ok':'fw-anchor-bad',
        (c.ok?'\u2713 ':'\u2717 ')+(LABELS[c.name]||c.name));
      li.title=c.detail;
      list.appendChild(li);
    }
    box.appendChild(list);
    if(!v.knownRootName&&v.rootCertSha256){
      box.appendChild(el('p','fw-anchor-check-line',i18n.anchorCheckUnpinned));
      box.appendChild(el('code','fw-anchor-fp',v.rootCertSha256));
    }
    if(v.error){box.appendChild(el('p','fw-anchor-check-line fw-anchor-bad',v.error));}
  }
  var sorted=data.anchors.slice().sort(function(a,b){
    return a.anchoredChainPosition-b.anchoredChainPosition;
  });
  for(var i=0;i<sorted.length;i++){
    var box=slot(i);
    if(box){
      box.textContent='';
      box.appendChild(el('div','section-label',i18n.anchorCheckHeader));
      box.appendChild(el('p','fw-anchor-check-line',i18n.anchorCheckRunning));
    }
  }
  if(!api||typeof api.verifyAnchorBase64!=='function') return;
  sorted.forEach(function(a,i){
    api.verifyAnchorBase64({tst:a.tstB64,response:a.responseB64},a.anchoredIntegrityHash)
      .then(function(v){paint(i,v);})
      .catch(function(){paint(i,null);});
  });
})();`;

/**
 * The key-genesis check. Structurally the same as the anchor check, with one
 * difference that is the whole point: the hash it verifies against is
 * RECOMPUTED here from the public key embedded in the file, not read from the
 * stored `publicKeyDigest`. A file that claims a stamp over a digest that is
 * not its own key's fails, which is what stops a fabricator borrowing someone
 * else's old timestamp.
 */
/**
 * The digest of the entries this file carries, computed where the reader is.
 * Deterministic across copies because it hashes the records array exactly as
 * the payload serialises it.
 */
export const FILE_DIGEST_SCRIPT = `(function(){
  var slot=document.querySelector('[data-file-digest]');
  if(!slot) return;
  var data=window.__FW_EXPORT__;
  if(!data||!data.records){slot.textContent='-';return;}
  if(typeof crypto==='undefined'||!crypto.subtle){slot.textContent='-';return;}
  crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(data.records)))
    .then(function(d){
      slot.textContent=Array.from(new Uint8Array(d))
        .map(function(b){return b.toString(16).padStart(2,'0');}).join('');
    })
    .catch(function(){slot.textContent='-';});
})();`;

export const KEY_GENESIS_SCRIPT = `(function(){
  var data=window.__FW_EXPORT__;
  var kg=data&&data.keyGenesis;
  if(!kg||!kg.anchors||!kg.anchors.length) return;
  var api=window.__FW_RFC3161__;
  var i18n=data.i18n;
  var LABELS={
    'response-granted':i18n.checkResponseGranted,
    'message-imprint':i18n.checkMessageImprint,
    'signed-attrs-digest':i18n.checkSignedAttrs,
    'signature':i18n.checkSignature,
    'timestamping-eku':i18n.checkEku,
    'genTime-in-cert-validity':i18n.checkGenTime,
    'issuer-signature':i18n.checkIssuer,
    'known-root':i18n.checkKnownRoot,
    'nonce-echo':i18n.checkNonce
  };
  function el(tag,cls,text){
    var e=document.createElement(tag);
    if(cls)e.className=cls;
    if(text!==undefined&&text!==null)e.textContent=String(text);
    return e;
  }
  function hex(buf){return Array.from(new Uint8Array(buf)).map(function(b){return b.toString(16).padStart(2,'0');}).join('');}
  function slot(i){return document.querySelector('[data-keygen-check="'+i+'"]');}
  function paint(i,v,expected){
    var box=slot(i);
    if(!box)return;
    box.textContent='';
    box.appendChild(el('div','section-label',i18n.anchorCheckHeader));
    if(!v){box.appendChild(el('p','fw-anchor-check-line fw-anchor-bad',i18n.anchorCheckFailed));return;}
    if(v.couldNotCheck){box.appendChild(el('p','fw-anchor-check-line',i18n.anchorCheckUnavailable));return;}
    // Three states, not two. The ok flag is true for a token that is
    // internally sound under a certificate the file itself carries, and anyone
    // can mint a certificate authority and a timestamping certificate. Printing
    // "every check passed" over a self-minted token is the overclaim; naming
    // the unrecognised authority is the honest reading.
    var known=!!v.knownRootName;
    box.appendChild(el('p','fw-anchor-check-line '+(v.ok?(known?'fw-anchor-ok':'fw-anchor-warn'):'fw-anchor-bad'),
      v.ok?(known?i18n.anchorCheckPassed:i18n.anchorCheckPassedUnknown):i18n.anchorCheckFailed));
    if(v.genTime)box.appendChild(el('p','fw-anchor-check-line',i18n.anchorCheckSignedTime+': '+v.genTime));
    if(v.signerSubject){
      var shortName=(api&&typeof api.shortSubject==='function')?api.shortSubject(v.signerSubject):v.signerSubject;
      var sp=el('p','fw-anchor-check-line',i18n.anchorCheckSigner+': '+shortName);
      sp.title=v.signerSubject;
      box.appendChild(sp);
    }
    var list=el('ul','fw-anchor-checks');
    for(var k=0;k<v.checks.length;k++){
      var c=v.checks[k];
      var li=el('li',c.ok?'fw-anchor-ok':'fw-anchor-bad',(c.ok?'✓ ':'✗ ')+(LABELS[c.name]||c.name));
      li.title=c.detail;
      list.appendChild(li);
    }
    box.appendChild(list);
    if(!v.knownRootName&&v.rootCertSha256){
      box.appendChild(el('p','fw-anchor-check-line',i18n.anchorCheckUnpinned));
      box.appendChild(el('code','fw-anchor-fp',v.rootCertSha256));
    }
  }
  for(var i=0;i<kg.anchors.length;i++){
    var box=slot(i);
    if(box){
      box.textContent='';
      box.appendChild(el('div','section-label',i18n.anchorCheckHeader));
      box.appendChild(el('p','fw-anchor-check-line',i18n.anchorCheckRunning));
    }
  }
  if(!api||typeof api.verifyAnchorBase64!=='function') return;
  if(typeof crypto==='undefined'||!crypto.subtle) return;
  var jwk=data.publicKeyJwk||{};
  crypto.subtle.digest('SHA-256',new TextEncoder().encode((jwk.x||'')+'|'+(jwk.y||''))).then(function(d){
    var expected=hex(d);
    var results=[];
    return Promise.all(kg.anchors.map(function(a,i){
      return api.verifyAnchorBase64({tst:a.tstB64,response:a.responseB64},expected)
        .then(function(v){results[i]=v;paint(i,v,expected);})
        .catch(function(){results[i]=null;paint(i,null,expected);});
    })).then(function(){
      // The headline states the earliest time any authority signed, because
      // the claim is "no later than" and the earliest signature is the
      // strongest true version of it. Only verified tokens count.
      // Only a verified token counts, and the authority named is the one the
      // CERTIFICATE says, not the label the file carries beside it. An
      // unrecognised authority is left out of the headline entirely: a
      // self-minted token must not be able to date this key.
      var best=null,who=[];
      for(var i=0;i<results.length;i++){
        var v=results[i];
        if(!v||!v.ok||!v.genTime||!v.knownRootName) continue;
        if(who.indexOf(v.knownRootName)<0)who.push(v.knownRootName);
        if(!best||v.genTime<best)best=v.genTime;
      }
      var head=document.querySelector('[data-keygen-headline]');
      if(head&&best){
        head.textContent=i18n.keyGenesisExisted.replace('{t}',best).replace('{who}',who.join(', '));
        head.className='fw-keygen-headline fw-anchor-ok';
      }
    });
  }).catch(function(){});
})();`;

/**
 * Completeness, rendered on load rather than behind the Verify button.
 *
 * The page-one summary is static HTML written when the file was made, and a
 * recipient who reads the document without pressing anything used to see only
 * that. Nothing here needs a key or a signature: it is arithmetic over the
 * records the file carries and the anchors beside them, so there is no reason
 * to make a reader ask for it.
 */
export const COMPLETENESS_SCRIPT = `(function(){
  ${VERIFIER_CORE_FNS_SOURCE}
  var host=document.getElementById('fw-completeness');
  var data=window.__FW_EXPORT__;
  if(!host||!data||!data.records) return;
  function el(tag,cls,children){
    var e=document.createElement(tag);
    if(cls)e.className=cls;
    if(children)for(var i=0;i<children.length;i++){
      var c=children[i];e.appendChild(typeof c==='string'?document.createTextNode(c):c);
    }
    return e;
  }
  var i18n=data.i18n;
  var records=data.records;
  var anchorInfo=anchorFindings(records,data.anchors||[]);
  var coverage=coverageFromRecords(records);
    // Completeness is a separate question from integrity and gets its own
    // block. Collapsing the two is what let a green banner be read as "nothing
    // was removed", which it never meant.
    var sel=data.selection;
    var manualCount=0;
    for(var mi=0;mi<records.length;mi++){ if(isManualRecord(records[mi])) manualCount++; }
    var cov=el('div','fw-completeness');
    cov.appendChild(el('h3','',[i18n.completenessHeader]));
    // More than one run: positions start again at 0 at a month change, a reset or a
    // restart, so "positions a to b" has no meaning across them. Until 2026-09-20 this
    // took the first position of the first run and the last of the last, and a file of
    // three runs (0 to 54, 0 to 34, 0 to 8) read "positions 0 to 8 are present, 99
    // records. The run is unbroken".
    var manyRuns=coverage.present>0&&coverage.runs>1;
    if(manyRuns){
      cov.appendChild(el('p','',[i18n.completenessRuns
        .replace('{r}',String(coverage.runs))
        .replace('{n}',String(coverage.present))]));
    }else if(coverage.present>0){
      cov.appendChild(el('p','',[i18n.completenessRun
        .replace('{a}',String(coverage.firstPosition))
        .replace('{b}',String(coverage.lastPosition))
        .replace('{n}',String(coverage.present))]));
    }
    var complete=true;
    if(coverage.missingBefore>0){
      complete=false;
      cov.appendChild(el('p','',[i18n.completenessMissingBefore.replace('{n}',String(coverage.missingBefore))]));
    }
    if(coverage.gapsInside>0){
      complete=false;
      cov.appendChild(el('p','',[i18n.completenessGaps.replace('{n}',String(coverage.gapsInside))]));
    }
    if(anchorInfo.notInFile>0){
      complete=false;
      cov.appendChild(el('p','fw-completeness-hit',[i18n.completenessAnchorMissing.replace('{n}',String(anchorInfo.notInFile))]));
    }
    if(anchorInfo.beyondTail>0){
      complete=false;
      cov.appendChild(el('p','fw-completeness-hit',[i18n.completenessAnchorBeyond
        .replace('{p}',String(anchorInfo.beyondPosition))
        .replace('{n}',String(anchorInfo.beyondTail))]));
    }
    if(anchorInfo.checked>0&&anchorInfo.notInFile===0&&anchorInfo.beyondTail===0){
      cov.appendChild(el('p','',[i18n.completenessAnchorHolds]));
    }
    // Recounted from the records and tokens the reader holds, beside page one's signed row, so an
    // edited row and its recount disagree in front of the reader. Each token is opened here and
    // counts only when it verifies under a pinned authority, with the time signed inside it: the
    // stored verdict is the install's word, and this block exists not to take it.
    var stampHost=null;
    var rfc=window.__FW_RFC3161__;
    if(i18n.completenessStampRun&&i18n.completenessStampRunNewest&&rfc&&typeof rfc.verifyAnchorBase64==='function'){
      stampHost=el('div','fw-completeness-stamps',[]);
      cov.appendChild(stampHost);
    }
    if(sel&&typeof sel.totalSource==='number'&&typeof sel.included==='number'&&sel.totalSource>sel.included){
      cov.appendChild(el('p','',[i18n.completenessFiltered
        .replace('{n}',String(sel.totalSource-sel.included))
        .replace('{m}',String(sel.totalSource))]));
    }
    if(manualCount>0){
      cov.appendChild(el('p','fw-completeness-hit',[i18n.completenessManual.replace('{n}',String(manualCount))]));
    }
    if(complete&&coverage.present>0) cov.appendChild(el('p','',[manyRuns?i18n.completenessWholeRuns:i18n.completenessWhole]));
    if(anchorInfo.checked>0||coverage.present>0){
      cov.appendChild(el('p','fw-completeness-note',[i18n.completenessAnchorLimit]));
    }
    cov.appendChild(el('p','fw-completeness-note',[i18n.completenessNote]));
    host.appendChild(cov);
    if(stampHost){
      var stated=data.anchors||[];
      Promise.all(stated.map(function(a){
        return rfc.verifyAnchorBase64({tst:a.tstB64,response:a.responseB64},a.anchoredIntegrityHash).then(function(v){
          return v&&v.ok&&v.knownRootName
            ?{anchoredChainPosition:a.anchoredChainPosition,anchoredIntegrityHash:a.anchoredIntegrityHash,generalizedTime:v.genTime||null}
            :null;
        },function(){return null;});
      })).then(function(checked){
        var stampRuns=stampCoverage(records,checked.filter(function(c){return c!==null;}));
        for(var si=0;si<stampRuns.length;si++){
          var sr=stampRuns[si];
          stampHost.appendChild(el('p','',[(sr.newest?i18n.completenessStampRunNewest:i18n.completenessStampRun)
            .replace('{a}',String(sr.first)).replace('{b}',String(sr.last))
            .replace('{n}',String(sr.stamped)).replace('{m}',String(sr.records))
            .replace('{t}',sr.newest||'')]));
        }
      });
    }
})();`;

export const VERIFIER_SCRIPT_TEMPLATE = `(function(){
  ${VERIFIER_CORE_FNS_SOURCE}
  function el(tag,attrs,children){
    var e=document.createElement(tag);
    if(attrs)for(var k in attrs){if(k==='class')e.className=attrs[k];else e.setAttribute(k,attrs[k]);}
    if(children)for(var i=0;i<children.length;i++){
      var c=children[i];e.appendChild(typeof c==='string'?document.createTextNode(c):c);
    }
    return e;
  }
  // The third argument names what stopped the check. Two callers, and until 2026-09-19 both
  // printed the key-setup sentence: the record loop's catch said the embedded
  // key was malformed or its fingerprint did not match, over a failure that
  // happened while hashing records, long after the key had been accepted.
  function renderVerifierSetupFailure(statusEl,i18n,why){
    statusEl.innerHTML='';
    var summary=el('div',{'class':'fw-chain-summary fw-fail'});
    summary.appendChild(el('h2',null,[FIXED.chainBroken]));
    summary.appendChild(el('p',null,[FIXED.chainBrokenReason+(why||FIXED.failReasonVerifierSetup)]));
    statusEl.appendChild(summary);
    // The button is disabled while a check runs, and the manifest and success
    // paths hand it back. These two paths returned without it, so a reader
    // whose browser hiccuped got a FAILED band and no way to try again short
    // of reloading the file. Found 2026-09-19.
    var btn=document.getElementById('fw-verify-btn');
    if(btn)btn.disabled=false;
  }
  // One reading of a per-record verdict, used by the results list below and
  // by the feed's card stamp (register item 16): the half of the file a
  // reader actually reads carries the same check as the reference list.
  function verdictView(pr,i18n){
    var isUnsigned=pr.ok&&pr.unsigned, isPriorKey=pr.ok&&pr.priorKey, isCarriedKey=pr.ok&&pr.carriedKey, isUnverified=pr.ok&&pr.unverified;
    var cls=pr.ok?(isUnverified?'warn':'pass'):'fail';
    var label=pr.ok&&pr.redacted?i18n.perRecordRedacted:isPriorKey?i18n.perRecordPriorKey:isUnsigned?i18n.perRecordUnsigned:isUnverified?i18n.perRecordUnverified:isCarriedKey?i18n.perRecordCarriedKey:(pr.ok?i18n.perRecordPass:i18n.perRecordFail);
    return {cls:cls,label:label,icon:isUnverified?'\u26a0 ':(pr.ok?'\u2713 ':'\u2717 ')};
  }
  async function runVerification(){
    var btn=document.getElementById('fw-verify-btn');btn.disabled=true;
    var statusEl=document.getElementById('fw-status');
    var resultsEl=document.getElementById('fw-results');resultsEl.innerHTML='';
    var i18n=window.__FW_EXPORT__.i18n;
    statusEl.textContent=FIXED.verifyingLabel;
    var keySetup;
    try{
      keySetup=await importVerifiedPubKey(
        window.__FW_EXPORT__.publicKeyJwk,
        window.__FW_EXPORT__.publicKeyFingerprint
      );
    }catch(_err){
      renderVerifierSetupFailure(statusEl,i18n);
      return;
    }
    // Register item 6: the envelope must match what the install signed before
    // any verdict wording is drawn from it. A file made by an earlier build
    // has no manifest and can no longer read as fully verified.
    var manifestState=await checkManifest(window.__FW_EXPORT__,keySetup.pubKey,keySetup.fingerprint);
    if(manifestState!=='ok'&&manifestState!=='missing'&&manifestState!=='legacy'){
      statusEl.innerHTML='';
      var ms=el('div',{'class':'fw-chain-summary fw-fail'});
      ms.appendChild(el('h2',null,[FIXED.chainBroken]));
      ms.appendChild(el('p',null,[FIXED.manifestFailed+' ('+manifestState+')']));
      statusEl.appendChild(ms);
      btn.disabled=false;
      return;
    }
    // The file's own key, then every earlier generation's key it carries.
    // A carried key that fails its own fingerprint check is left out (its
    // records then verify by hash only); it can never make a record fail.
    var keys={};
    keys[keySetup.fingerprint]=keySetup.pubKey;
    var carried=window.__FW_EXPORT__.publicKeys||[];
    for(var c=0;c<carried.length;c++){
      try{
        var k=await importVerifiedPubKey(carried[c].jwk,carried[c].fingerprint);
        keys[k.fingerprint]=k.pubKey;
      }catch(_skip){}
    }
    var records=window.__FW_EXPORT__.records;
    var perRecord=[];
    var redactions=redactionIndex(records);
    try{
      // Records are independent of each other (the chain is checked after),
      // so they are checked VERIFY_BATCH at a time: Web Crypto runs the digests
      // and signature checks off the page's thread, and awaiting them one by
      // one left it idle. Yield to the page every ~50 ms so a large file keeps
      // painting; yielding after every batch cost a 4 ms timer clamp each time
      // (600 ms on 10,000 records).
      var VERIFY_BATCH=64,lastYield=Date.now();
      for(var i=0;i<records.length;i+=VERIFY_BATCH){
        var batch=[];
        for(var bi=i;bi<Math.min(records.length,i+VERIFY_BATCH);bi++) batch.push(verifyOne(records[bi],keys,keySetup.fingerprint,redactions));
        var done=await Promise.all(batch);
        for(var di=0;di<done.length;di++) perRecord.push(done[di]);
        if(Date.now()-lastYield>50){ await new Promise(function(r){setTimeout(r,0);}); lastYield=Date.now(); }
      }
    }catch(_err){
      renderVerifierSetupFailure(statusEl,i18n,FIXED.failReasonCheckStopped);
      return;
    }
    // A withheld record stands on its marker: if the marker did not verify, neither does the record.
    var markerOk={};
    for(var mi=0;mi<records.length;mi++){ if(records[mi]&&records[mi].kind==='redaction-marker') markerOk[records[mi].id]=!!(perRecord[mi]&&perRecord[mi].ok); }
    for(var ri=0;ri<perRecord.length;ri++){ var prr=perRecord[ri]; if(prr&&prr.redacted&&markerOk[prr.markerId]===false) perRecord[ri]={ok:false,reason:'redaction-unattested'}; }
    var chain=await verifyChain(records,perRecord);
    var anchorInfo=anchorFindings(records,window.__FW_EXPORT__.anchors||[]);
    var coverage=coverageFromRecords(records);
    var sel=selectionOf(window.__FW_EXPORT__,records);
    var state=verificationState(perRecord,chain,{anchors:anchorInfo,coverage:coverage,selection:sel});
    if((manifestState==='missing'||manifestState==='legacy')&&state==='verified') state='partial';
    // Publish the verdicts for the feed (register item 16). The feed stamps
    // every card it has drawn and every card it draws later.
    var byId={};
    for(var v=0;v<records.length;v++){ if(records[v]&&records[v].id) byId[records[v].id]=verdictView(perRecord[v],i18n); }
    window.__FW_VERDICTS__={state:state,byId:byId};
    try{document.dispatchEvent(new CustomEvent('fw-verified'));}catch(_e){}
    statusEl.innerHTML='';
    var summary=el('div',{'class':'fw-chain-summary '+(state==='verified'?'fw-pass':state==='partial'?'fw-warn':'fw-fail')});
    // When not allOk, surface position + reason + actionable bullets so the
    // recipient understands the BROKEN status without prior crypto knowledge.
    // brokenAt = first failing record, 1-indexed for display.
    //
    // The second clause used to say "or chain.reason if all records signed
    // individually OK but the chain link mismatched". verifyChain has one exit
    // and it always returns ok:true: a seam, a restart and a record naming a
    // predecessor outside the file are all counted and none of them fails a
    // file on its own, which is what FORMAT.md says too. So chain.ok is never
    // false and neither chain.brokenAt nor chain.reason is ever set. The
    // branch stays as a guard, in case a failing exit is ever added, and the
    // comment no longer describes it as something that happens (2026-09-19).
    var brokenAt=-1,brokenReason=null;
    for(var k=0;k<perRecord.length;k++){
      if(!perRecord[k].ok){brokenAt=k+1;brokenReason=perRecord[k].reason;break;}
    }
    if(brokenAt===-1&&!chain.ok){
      brokenAt=(typeof chain.brokenAt==='number'?chain.brokenAt:0)+1;
      brokenReason=chain.reason||'unnamed';
    }
    // Why the file fell short of verified, split the way the core splits it.
    //
    // This loop had two buckets and the core has four. A record whose
    // signature was RUN, under the key this file carries, and came back false
    // fell into the "no usable key" bucket, so the page told the reader that
    // the one suspicious record in the file was an earlier install's
    // bookkeeping, and counted this file's own key among the keys it "does not
    // carry". FORMAT.md calls that reading the sharpest edge in the document.
    // The standalone checker has split them since 2026-09-19; the page, which
    // is what a stranger actually opens, had not. Found 2026-09-19 by a read
    // of the export against the checker.
    //
    // carriedKey is counted here too. It is a partial state of its own in
    // verificationState, and no branch below printed anything for it, so a
    // file whose only shortfall was a key that travelled beside the records
    // showed an amber headline with no reason under it at all.
    var priorKeyCount=0,priorKeyFps={},unsignedCount=0,rejectedCount=0,uncheckableCount=0,carriedCount=0;
    for(var u=0;u<perRecord.length;u++){
      var pu=perRecord[u];
      if(!pu.ok) continue;
      if(pu.carriedKey){carriedCount++;continue;}
      if(!pu.unverified) continue;
      if(pu.unsigned){unsignedCount++;continue;}
      if(pu.signatureRejected){rejectedCount++;continue;}
      if(pu.priorKey){priorKeyCount++;priorKeyFps[pu.fingerprint||'']=true;continue;}
      uncheckableCount++;
    }
    // Withheld records, and how many of them had no signature checked. The
    // headline reads "Every included record matched its stored hash", and for
    // a withheld record the hash was never recomputed: its content has left
    // the file. The record stands on a signed redaction marker naming its id
    // and its stored hash, which is sound, and is not what that sentence says.
    // The standalone checker has printed this since 2026-09-08 and the page,
    // which is what the reader opens, printed nothing. Found 2026-09-19.
    var withheldCount=0,withheldUnchecked=0;
    for(var w=0;w<perRecord.length;w++){
      var pw=perRecord[w];
      if(!pw||!pw.ok||!pw.redacted) continue;
      withheldCount++;
      if(pw.noSignature||pw.noKey||pw.priorKey) withheldUnchecked++;
    }
    var withheldNote=function(){
      if(withheldCount===0) return;
      summary.appendChild(el('p',null,[FIXED.chainWithheld.replace('{n}',String(withheldCount))]));
      if(withheldUnchecked>0)summary.appendChild(el('p',null,[FIXED.chainWithheldUnchecked.replace('{u}',String(withheldUnchecked))]));
    };
    if(state==='verified'){
      summary.appendChild(el('h2',null,[sel&&chain.outside>0?FIXED.chainVerifiedSelection.replace('{x}',String(sel.included)).replace('{y}',String(sel.totalSource)):FIXED.chainVerified]));
      summary.appendChild(el('p',null,[FIXED.chainVerifiedBody]));
      withheldNote();
    }else if(state==='partial'){
      summary.appendChild(el('h2',null,[FIXED.chainPartial]));
      // Worst first: a signature that was run and failed is the one a reader
      // must not miss under a softer sentence about old installs.
      if(rejectedCount>0)summary.appendChild(el('p',null,[FIXED.chainPartialRejected.replace('{n}',String(rejectedCount))]));
      if(priorKeyCount>0)summary.appendChild(el('p',null,[FIXED.chainPartialBody.replace('{n}',String(priorKeyCount)).replace('{k}',String(Object.keys(priorKeyFps).length))]));
      if(unsignedCount>0)summary.appendChild(el('p',null,[FIXED.chainPartialUnsigned.replace('{n}',String(unsignedCount))]));
      if(uncheckableCount>0)summary.appendChild(el('p',null,[FIXED.chainPartialUncheckable.replace('{n}',String(uncheckableCount))]));
      if(carriedCount>0)summary.appendChild(el('p',null,[FIXED.chainPartialCarriedKey.replace('{n}',String(carriedCount))]));
      withheldNote();
    }else{
      var hdr=FIXED.chainBroken;
      if(brokenAt>0)hdr=hdr+' '+FIXED.chainBrokenAtRecord+brokenAt;
      summary.appendChild(el('h2',null,[hdr]));
      if(brokenReason){
        var reasonText=brokenReason==='tampered'?FIXED.failReasonTampered
          :brokenReason==='key-mismatch'?FIXED.failReasonKeyMismatch
          :brokenReason==='redaction-unattested'?FIXED.failReasonRedactionUnattested
          :FIXED.failReasonUnnamed;
        summary.appendChild(el('p',null,[FIXED.chainBrokenReason+reasonText]));
      }
      summary.appendChild(el('p',null,[FIXED.chainBrokenWhatToDo]));
      var ul=el('ul',null,[]);
      ul.appendChild(el('li',null,[FIXED.chainBrokenBullet1]));
      ul.appendChild(el('li',null,[FIXED.chainBrokenBullet2]));
      ul.appendChild(el('li',null,[brokenAt>1?FIXED.chainBrokenBullet3Prior:FIXED.chainBrokenBullet3FirstRecord]));
      summary.appendChild(ul);
    }
    if(manifestState==='missing'||manifestState==='legacy') summary.appendChild(el('p',null,[FIXED.manifestMissing]));
    var notes=chainNotes(chain,i18n,sel,unreadableOf(window.__FW_EXPORT__,manifestState));
    if(!(window.__FW_EXPORT__.anchors||[]).length&&!(window.__FW_EXPORT__.keyGenesis&&window.__FW_EXPORT__.keyGenesis.anchors&&window.__FW_EXPORT__.keyGenesis.anchors.length)) notes.push(FIXED.noTimestampsNote);
    for(var q=0;q<notes.length;q++)summary.appendChild(el('p',null,[notes[q]]));
    statusEl.appendChild(summary);

    // One line per record, its detail built only when opened. The feed above
    // already shows every record's content; this list
    // is the reference, and rendering a full card per record doubled the page
    // (82,000 nodes for 10,000 records). Lines are drawn RESULTS_PAGE at a time.
    var RESULTS_PAGE=500,resultsDrawn=0;
    var tally={},tallyOrder=[],views=[];
    for(var ti=0;ti<perRecord.length;ti++){var tv=verdictView(perRecord[ti],i18n);views.push(tv);if(!tally[tv.label]){tally[tv.label]={n:0,icon:tv.icon,cls:tv.cls};tallyOrder.push(tv.label);}tally[tv.label].n++;}
    var tallyEl=el('p',{'class':'fw-results-tally'},[tallyOrder.map(function(l){return tally[l].icon+tally[l].n+' '+l;}).join(' · ')]);
    resultsEl.appendChild(tallyEl);
    var resultsMore=el('button',{'class':'fw-feed-more','type':'button'},['']);
    function failText(pr){
      // The three reasons above are every reason verifyOne returns. The last
      // arm is the guard for a reason added later. Until 2026-09-19 it named a
      // chain link the record had failed to reference correctly, which nothing
      // in the checker ever produces: the sentence was unreachable, and a new
      // reason would have printed that specific wrong cause rather than an
      // honest one.
      var base=pr.reason==='tampered'?FIXED.failReasonTampered
        :pr.reason==='key-mismatch'?FIXED.failReasonKeyMismatch
        :pr.reason==='redaction-unattested'?FIXED.failReasonRedactionUnattested
        :FIXED.failReasonUnnamed;
      /* The other explanation, when there is one. A checker older than the file
         cannot hash a field added later, so a sound file fails its
         recomputation; the verdict above does not move, and this names the
         fields so a reader can tell the two apart. */
      if(pr.unknownFields&&pr.unknownFields.length&&FIXED.failReasonUnknownFields){
        base=base+' '+FIXED.failReasonUnknownFields.replace('{fields}',pr.unknownFields.join(', '));
      }
      return base;
    }
    function recordDetail(card,r,pr){
        if(isManualRecord(r)){
          var mrb=el('p',{'class':'fw-manual-badge'},[i18n.manualBadge]);
          mrb.title=i18n.manualExplain;
          card.appendChild(mrb);
        }
        card.appendChild(el('p',null,[i18n.perRecordPlatform+': '+r.platform+' · '+i18n.perRecordCaptured+' '+r.timestamp]));
        if(r.redacted){card.appendChild(el('p',{'class':'fw-withheld'},[i18n.feedWithheld]));}
        else {
          // Same rule as the feed card's authorDisplay (FEED_SCRIPT): the
          // extractors' own 'unknown' sentinel flagged, not printed as a
          // plausible handle, and "Name @handle" when authorName is read and
          // differs. Duplicated, not called, because this runs in
          // VERIFIER_SCRIPT_TEMPLATE's own script scope.
          var handle=(r.author&&r.author!=='unknown')?r.author:'(unknown)';
          var authorText=r.authorCapture==='withheld'?i18n.feedAuthorWithheld:(r.authorName&&r.authorName!==handle?(handle==='(unknown)'?r.authorName:r.authorName+' @'+handle.replace(/^@+/,'')):handle);
          card.appendChild(el('p',null,[i18n.perRecordAuthor+': '+authorText]));
        }
        // Where the browser said the content script was running when this record
        // was made. Absent on every record written before 2026-09-04.
        if(typeof r.surfaceOrigin==='string'&&r.surfaceOrigin){
          card.appendChild(el('p',null,[i18n.perRecordSurface+': '+r.surfaceOrigin]));
          if(r.surfaceOrigin.indexOf('https://')!==0){
            card.appendChild(el('p',{'class':'fw-anchor-bad'},[i18n.perRecordSurfaceWarn]));
          }
        }
        /* Q21: the hashed protection attestation must reach the reader here
           too, not only in the evidence-report export. */
        if(r.configSnapshot&&r.configSnapshot.enabledFeatures&&r.configSnapshot.enabledFeatures.length){
          card.appendChild(el('p',null,[i18n.perRecordProtections+': '+r.configSnapshot.enabledFeatures.join(', ')]));
        }
        if(r.configSnapshot&&r.configSnapshot.settingsReadFailed===true){
          card.appendChild(el('p',{'class':'fw-fail-reason'},[i18n.perRecordSettingsReadFailed]));
        }
        if(!r.redacted){
          // A hidden item stored with no caption reads as what it was (stand-in.ts, in FWN), never as its marker.
          var standKey=typeof FWN!=='undefined'?FWN.standInKey(r):null;
          if(!standKey&&typeof FWN!=='undefined'&&FWN.isHiddenAd(r))card.appendChild(el('p',{'class':'fw-item-standin'},[i18n.feedAdHidden]));
          var bodyRow=el('blockquote',null,[standKey?i18n[standKey]:(r.originalText||'').slice(0,280)]);
          card.appendChild(el('p',null,[i18n.perRecordExcerpt+':']));
          card.appendChild(bodyRow);
        }
        if(Array.isArray(r.mediaUrls)&&r.mediaUrls.length){
          card.appendChild(el('p',null,[i18n.feedMediaAsRead+': '+r.mediaUrls.join(' · ')]));
        }
        if(typeof r.integrityHash==='string'&&r.integrityHash){
          var hashRow=el('p',null,[i18n.perRecordHash+': ']);
          hashRow.appendChild(el('code',null,[r.integrityHash]));
          card.appendChild(hashRow);
        }
        var TL=(window.__FW_EXPORT__.techLabels||{});
        var techList=(r.techniques||[]).map(function(t){return (TL[t.name]||t.name)+' (sev '+t.severity+'/10)';}).join(', ');
        /* A record a fixed rule decided is not a model's reading. The feed card has
           said so since 2026-09-17 (techTags: name the rule, print no severity), and
           this list, which sits under the same record, never got the rule: an ad
           marker and a starred swear word were each printed as "FeelingWise safety
           interpretation: ... (sev 6/10) . This is an AI Safety Interpretation", with a
           severity that is the rule's fixed stamp, on records whose own aiSource says
           no model ran. Read off the public demo on 2026-09-20: 90 of its records.
           The test is the record's own fields, the same ones techTags reads. */
        var byRule=r.aiSource==='rules'||r.aiSource==='none'||r.verdict==='blocked'||(typeof r.overrideOrigin==='string'&&r.overrideOrigin!=='');
        if(techList&&byRule){
          var ruleNames=(r.techniques||[]).map(function(t){return TL[t.name]||t.name;}).join(', ');
          card.appendChild(el('p',null,[i18n.perRecordClassification+': '+ruleNames+' · '+i18n.feedGateRule]));
        }else if(techList){
          var rop=el('div',{'class':'fw-opinion'},[el('div',{'class':'fw-opinion-head'},[i18n.feedOpinionHeader])]);
          rop.appendChild(el('p',null,[i18n.perRecordClassification+': '+techList+' · '+i18n.perRecordOpinionDisclaimer]));
          card.appendChild(rop);
        }
        if(!pr.ok) card.appendChild(el('p',{'class':'fw-fail-reason'},[failText(pr)]));
    }
    function recordLine(j){
      var r=records[j],pr=perRecord[j];
      var view=views[j];
      var card=el('details',{'class':'fw-record fw-'+view.cls});
      card.appendChild(el('summary',null,[view.icon+'#'+(typeof r.chainPosition==='number'&&r.chainPosition>=0?r.chainPosition:j+1)+': '+view.label+' · '+r.platform+' · '+r.timestamp+(pr.ok?'':' · '+failText(pr))]));
      card.addEventListener('toggle',function(){ if(card.open&&!card.__fwBuilt){card.__fwBuilt=true;recordDetail(card,r,pr);} });
      return card;
    }
    function drawResults(){
      var end=Math.min(records.length,resultsDrawn+RESULTS_PAGE);
      var frag=document.createDocumentFragment();
      for(var j=resultsDrawn;j<end;j++) frag.appendChild(recordLine(j));
      resultsDrawn=end;
      resultsEl.insertBefore(frag,resultsMore);
      var left=records.length-resultsDrawn;
      if(left<=0){resultsMore.remove();return;}
      resultsMore.textContent=(i18n.feedShowMore||'Show the next {n}').replace('{n}',''+Math.min(RESULTS_PAGE,left))+' ('+(i18n.feedRemainingRecords||'{n} records not shown yet').replace('{n}',''+left)+')';
    }
    resultsEl.appendChild(resultsMore);
    resultsMore.addEventListener('click',drawResults);
    drawResults();
    // The button is a re-run from here on.
    btn.disabled=false;
  }
  // Register the click handler directly. The inline <script> tag is at the
  // end of <body>, so the button is already in the DOM by the time this runs.
  // Wrapping in DOMContentLoaded is unsafe — DCL may have already fired before
  // the inline script executes (readyState === 'complete'), leaving the
  // listener unregistered. Direct registration is the right pattern here.
  var btn=document.getElementById('fw-verify-btn');
  if(btn)btn.addEventListener('click',runVerification);
  // Verification runs when the page opens (register item 16, 2026-09-06):
  // before this the readable feed rendered unchecked and the check waited on
  // a click most readers never made. The button stays as an explicit re-run.
  if(btn&&window.crypto&&window.crypto.subtle) runVerification();
})();`;

// Feed view. Renders the SAME embedded records as a readable, nested
// social-feed: posts → their comments → their replies, with severity heat,
// technique/platform tags, a comment-section room banner (counts captured
// before FW hid them), an at-a-glance summary, and a per-account block.
// Runs on load. The crypto verifier above also runs on load and publishes a
// verdict per record (window.__FW_VERDICTS__, event 'fw-verified'); the feed
// says "not yet checked" until then and stamps every card with its record's
// verdict after, so the readable half carries the same check as the reference
// list (register item 16). All record data is inserted via textContent / createTextNode
// (never innerHTML), so hostile record content cannot inject markup. All
// colours are hardcoded design tokens (severity ramp + technique + platform
// from colors_and_type.css), never derived from record data.

/** The verdict wording the verifier is allowed to print, inlined as code. */
export const FIXED_VERDICT_KEYS = [
  'verifyingLabel',
  'chainVerified',
  'chainVerifiedBody',
  'chainPartial',
  'chainPartialBody',
  'chainPartialUnsigned',
  'chainPartialRejected',
  'chainPartialUncheckable',
  'chainPartialCarriedKey',
  'chainWithheld',
  'chainWithheldUnchecked',
  'failReasonCheckStopped',
  'chainBroken',
  'chainBrokenAtRecord',
  'chainBrokenReason',
  'chainBrokenWhatToDo',
  'chainBrokenBullet1',
  'chainBrokenBullet2',
  'chainBrokenBullet3Prior',
  'chainBrokenBullet3FirstRecord',
  'failReasonTampered',
  'failReasonUnknownFields',
  'failReasonKeyMismatch',
  'failReasonVerifierSetup',
  'failReasonUnnamed',
  'failReasonRedactionUnattested',
  'manifestFailed',
  'manifestMissing',
  'chainVerifiedSelection',
  'noTimestampsNote',
] as const;

/**
 * The verifier script for one locale (register item 6). The sentences a
 * reader relies on (VERIFIED, its caveat, PARTIAL, BROKEN and the reasons)
 * are resolved at build time and inlined into the script as `FIXED`, so an
 * editor who wants to change what the file says has to change executable
 * code rather than a JSON field; everything else still reads the envelope.
 */
export function verifierScript(i18n: ExportI18nStrings): string {
  const fixed: Record<string, string> = {};
  for (const k of FIXED_VERDICT_KEYS) fixed[k] = i18n[k];
  return `(function(){var FIXED=${JSON.stringify(fixed).replace(/</g, '\\u003c')};`
    + VERIFIER_SCRIPT_TEMPLATE.slice('(function(){'.length);
}

export const FEED_SCRIPT = `(function(){
  var data=window.__FW_EXPORT__;
  if(!data||!data.records||!data.records.length)return;
  var i18n=data.i18n, records=data.records;
  /* A hidden item stored with no caption reads as what it was, never as its stored marker (stand-in.ts, in FWN). */
  function hiddenAd(r){return typeof FWN!=='undefined'&&FWN.isHiddenAd(r);}
  function standIn(r){var k=typeof FWN!=='undefined'?FWN.standInKey(r):null;return k?i18n[k]:null;}
  var LOCS={en:'en-US',ro:'ro-RO',es:'es-ES','pt-BR':'pt-BR'};
  var loc=LOCS[data.locale]?data.locale:'en';
  function el(tag,attrs,kids){
    var e=document.createElement(tag);
    if(attrs)for(var k in attrs){if(k==='class')e.className=attrs[k];else e.setAttribute(k,attrs[k]);}
    if(kids)for(var i=0;i<kids.length;i++){var c=kids[i];if(c==null)continue;e.appendChild(typeof c==='string'?document.createTextNode(c):c);}
    return e;
  }
  function sevColor(s){return s>=8?'#e53935':s>=5?'#e0a458':(s>=1?'#4fb3a9':'#cfcfcf');}
  // Colour keyed by the FULL technique enum (the record's t.name). The prior
  // map used short keys ('consumer-rapid','body-comparison','parasocial') that
  // never matched the persisted enum names → ads etc. fell back to grey.
  var TECH={'fear-appeal':'#ef5350','anger-trigger':'#ff7043','shame-attack':'#ab47bc','false-urgency':'#ffab40','bandwagon':'#42a5f5','scapegoating':'#ec407a','fomo':'#ffa726','toxic-positivity':'#66bb6a','misleading-format':'#78909c','combined':'#5c6bc0','combined-stack':'#5c6bc0','profanity':'#ef5350','ai-content-block':'#7b1fa2','body-comparison-priming':'#26a69a','parasocial-coercion':'#7e57c2','consumer-rapid-frame':'#9ccc65','hyperreal-trauma-bait':'#8d6e63','genuine-opinion':'#90a4ae','sexual':'#c2185b','violence-graphic':'#d32f2f','self-harm':'#ff6f00','drug-promotion':'#7b1fa2','unsafe-health-experiment':'#ff8f00','extreme-toxicity':'#1565c0'};
  // Display-only labels, served from the envelope so the export, the dashboard
  // and the Romanian build cannot disagree about what one enum is called. The
  // SIGNED record keeps the precise enum either way. This replaced a third
  // hardcoded map that said "anger bait" where the dashboard said "anger".
  var LBL=data.techLabels||{};
  function techLabel(nm){return LBL[nm]||nm;}
  var PLAT={twitter:'#1da1f2',facebook:'#4267b2',instagram:'#e1306c',tiktok:'#69c9d0',youtube:'#ff0000'};
  // Q60 (W57): RO values carry full diacritics like the rest of the RO
  // export table (this renders in a court-facing document), and the
  // en/ro key parity of this inline table is locked by
  // tests/unit/forensics/html-export-i18n-parity.test.ts alongside the typed I18N.
  var ROOM={en:{'hostile-crowd':'hostile crowd','pile-on':'pile-on','echo-chamber':'echo chamber','polarized':'polarized','mostly-positive':'mostly positive','healthy-discussion':'healthy discussion','sparse':'few comments','unknown':'not assessed'},ro:{'hostile-crowd':'mulțime ostilă','pile-on':'atac în grup','echo-chamber':'cameră de ecou','polarized':'polarizat','mostly-positive':'majoritar pozitiv','healthy-discussion':'discuție sănătoasă','sparse':'puține comentarii','unknown':'neevaluat'},es:{'hostile-crowd':'multitud hostil','pile-on':'ataque en manada','echo-chamber':'cámara de eco','polarized':'polarizado','mostly-positive':'mayoritariamente positivo','healthy-discussion':'discusión sana','sparse':'pocos comentarios','unknown':'sin evaluar'},'pt-BR':{'hostile-crowd':'multidão hostil','pile-on':'ataque em massa','echo-chamber':'câmara de eco','polarized':'polarizado','mostly-positive':'majoritariamente positivo','healthy-discussion':'discussão saudável','sparse':'poucos comentários','unknown':'não avaliado'}};
  /* Housekeeping kinds, asked in one place. FWN carries the list the rest of
     the product uses; the literal below is the fallback for a page whose
     numbers engine did not load, and it is the only second copy in the file. */
  function isMarkerKind(k){
    if(typeof FWN!=='undefined')return FWN.isSystemMarker({kind:k});
    return k==='reset-marker'||k==='month-rotation-marker'||k==='prune-marker'||k==='gap-marker'||k==='heartbeat-marker'||k==='import-marker'||k==='repair-marker'||k==='redaction-marker'||k==='reconcile-marker';
  }
  function maxSev(r){var m=0,t=r.techniques||[];for(var i=0;i<t.length;i++){if(typeof t[i].severity==='number'&&t[i].severity>m)m=t[i].severity;}return m;}
  /* A rule-based block is not a safety finding. The blocker (ai-content-blocker,
     media-only-ad-blocker, reels-blocker, media-timeout) stamps every record it
     writes with a synthetic technique 'ai-content-block' at severity 10 —
     severity 10 there means "the rule matched exactly", not "this was harmful".
     The severity clause below therefore swept every blocked ad into the flag
     count and into the high-severity bar, which is the same defect the
     dashboard already ruled out (see the note under isFlaggedVerdict in
     ui/dashboard/components/overview-data.ts, SOL review 2026-07-15 finding 5).
     Blocks get their own count in the glance row instead. */
  /* An advertisement is the same case one class wider (rebuild plan
     2026-09-14, standing decision 1: ads are never harm). The child and teen
     pipeline writes a sponsored post as flagged-hidden with technique
     consumer-rapid-frame at severity 6 from the platform's own marker; on the
     owner's six-day export that was 75 of the 150 items the app had acted on,
     and the frozen adult reader fired on none of them. Ads count on the block
     side, where the reader's own Block Ads rule put them, and never on the
     flag side. FWN.isPaidPlacement is the one definition, shared with the
     numbers table's paid-placement column. */
  function isAd(r){return typeof FWN!=='undefined'&&FWN.isPaidPlacement(r);}
  function isBlock(r){return r.verdict==='blocked'||isAd(r);}
  /* 'default' is the record's value when nobody was declared at the keyboard
     (content/record/decision.ts READER_DEFAULT). It printed as "Reader: default". */
  function readerWord(v){return v==='default'?(i18n.feedReaderDefault||v):v;}
  /* The adult reader states no reason. It answers a family, an effect and an intent from
     fixed lists, and src/core/neutralizer.ts assembles the line "judge-v1: <family>,
     <effect>, wants the reader to <intent>" from them. Until 2026-09-20 every such card
     said "Model's stated reason:" over a sentence the code wrote. A line that opens with
     the reader's id gets the label that says what it is; any other keeps the old one. */
  function whyPrefix(why){return (typeof why==='string'&&/(^|: )judge-v1: /.test(why))?(i18n.feedWhyPrefixReader||i18n.feedWhyPrefix):i18n.feedWhyPrefix;}
  function isFlagged(r){return !isBlock(r)&&!(r.techniques&&r.techniques.length===1&&r.techniques[0].name==='repeat-exposure')&&(r.verdict==='flagged'||r.verdict==='flagged-hidden'||(maxSev(r)>=5));}
  function pos(r){return (typeof r.chainPosition==='number'&&r.chainPosition>=0)?r.chainPosition:Number.POSITIVE_INFINITY;}
  function dot(color){return el('span',{'class':'fw-dot','style':'background:'+color});}
  /* The platform's own name, as the numbers table above the feed prints it. The record's
     key is 'twitter'; a card said twitter under a table row that said X (2026-09-20). */
  var PLAT_NAMES={twitter:'X',facebook:'Facebook',youtube:'YouTube',tiktok:'TikTok',instagram:'Instagram'};
  function platTag(p){return el('span',{'class':'fw-tag'},[dot(PLAT[p]||'#888'),PLAT_NAMES[p]||p||'']);}
  /* detectionMode on a blocked record is 'block:<reason>:<token>'. The reason
     is the useful half for a reader; the token is the raw matched string. */
  function blockReasonLabel(r){
    var dm=''+(r.detectionMode||'');
    var parts=dm.split(':');
    var reason=(parts[0]==='block'&&parts[1])?parts[1]:'';
    if(reason==='ads')return i18n.feedBlockReasonAds;
    if(reason==='media-timeout')return i18n.feedBlockReasonMediaTimeout;
    if(reason==='reel-surface')return i18n.feedBlockReasonReelSurface;
    if(reason==='hashtag')return i18n.feedBlockReasonHashtag;
    if(reason==='ai-label')return i18n.feedBlockReasonAiLabel;
    return i18n.feedBlockReasonOther;
  }
  /* The user's own rule, in words. A record hidden by the word filter, an
     account block, a hashtag block, the AI-label block, the reels switch or
     the media time limit is the user's decision carried out, not a reading of
     the content; it shows as "your rule: <name>" with no severity number, and
     the synthetic severity-10 technique the blocker stamps is not printed.
     Which records count is decided by FWN.ruleLabel and FWN.isUserRule, the
     same functions behind the "hidden by something you set" column above. */
  var RULE_NAMES={'word-filter':'ruleWordFilter','account-block':'ruleAccountBlock','hashtag-block':'ruleHashtagBlock','ai-content-block':'ruleAiContentBlock','reel-surface':'ruleReelSurface','media-timeout':'ruleMediaTimeout','ad-marker':'ruleAdMarker'};
  /* The ad marker is on that list since 2026-09-14. Block Ads is the reader's
     own switch, so an advertisement shows as "your rule: ad marker" with no
     severity number, exactly like the word filter, instead of printing the
     severity 6 the old pipeline stamped on it. FWN.isUserRule is left alone:
     the numbers table keeps its ad column and its user-hidden column disjoint,
     and this is a card label, not a column. */
  function userRuleLabel(r){
    if(typeof FWN==='undefined')return null;
    var lbl=FWN.ruleLabel(r);
    if(lbl!=='ad-marker'&&!FWN.isUserRule(lbl))return null;
    return i18n[RULE_NAMES[lbl]]||lbl;
  }
  /* DESCRIPTOR-V1: what a fired item does to a person.
     Read off the signed decision block; a record without it shows nothing here.
     The group the block also carries is NOT shown: on posts that touch Israel or
     Jews it was right 57.5 times in 100 and called a third of the news about
     Israel hostility (docs/research/taxonomy-2026-09-15/RESULTS-3.md). It comes
     back when a question passes its measure. */
  var DV_E={'group-hostility':'dvGroupHostility','person-hostility':'dvPersonHostility','threat':'dvThreat','sexual':'dvSexual','self-harm':'dvSelfHarm','violence':'dvViolence','body':'dvBody','commercial':'dvCommercial','deception':'dvDeception','drugs':'dvDrugs','profanity':'dvProfanity'};
  var DV_G={'jews-israelis':'dvgJewsIsraelis','muslims':'dvgMuslims','christians':'dvgChristians','black-people':'dvgBlackPeople','asian-people':'dvgAsianPeople','roma':'dvgRoma','migrants':'dvgMigrants','women':'dvgWomen','men':'dvgMen','lgbtq':'dvgLgbtq','disabled-people':'dvgDisabledPeople','a-nationality':'dvgANationality','a-political-side':'dvgAPoliticalSide','other-group':'dvgOtherGroup'};
  function descriptorTag(r){
    var d=r.decision&&r.decision.descriptorV1;
    if(!d||!DV_E[d.effect])return null;
    var text=i18n[DV_E[d.effect]]||d.effect;
    return el('span',{'class':'fw-tag fw-tag-descriptor','title':i18n.dvTitle},[dot('#455a64'),text]);
  }
  /* The gate a post-path detection mode names. The mode is 'coded-harm:<why>',
     'slur:<n>', 'profanity:<n>' or 'profanity-mask:<n>'; anything else a rule
     decided is named as a fixed rule without guessing which. */
  var MODE_GATE={'slur':'feedGateIdentitySlur','profanity':'feedGateProfanityTier','profanity-mask':'feedGateProfanityTier','coded-harm':'feedGateCodedHarm','harm-floor':'feedGateHarmFloor','ad-hominem':'feedGateAdHominem','rage-format':'feedGateRageFormat'};
  function techTags(r){
    var t=r.techniques||[],out=[];
    var yours=userRuleLabel(r);
    if(yours!==null){
      out.push(el('span',{'class':'fw-tag fw-tag-rule'},[dot('#7b1fa2'),i18n.feedYourRule+': '+yours]));
      return out;
    }
    /* A verdict one of the product's fixed gates set (overrideOrigin, wiring
       audit C22) is a rule's, not a model's reading: name the rule, print no
       severity, the same honesty as "your rule" above. */
    var GATE={'identity-slur':'feedGateIdentitySlur','profanity-tier':'feedGateProfanityTier','coded-harm':'feedGateCodedHarm','ad-hominem':'feedGateAdHominem','harm-floor':'feedGateHarmFloor','rage-format':'feedGateRageFormat'};
    var gate=(typeof r.overrideOrigin==='string'&&GATE[r.overrideOrigin])?i18n[GATE[r.overrideOrigin]]:null;
    /* The post path writes its gate into the detection mode and sets no
       overrideOrigin: that field is written on the comment path only. So a
       Child-mode hide by the coded-harm list fell through to the model branch
       below and printed "shame (signal level 9/10)" under a heading that reads
       "FeelingWise's reading", on a record whose own aiSource says no model ran
       and whose 9 is the gate's fixed stamp. Read off a real walk export on
       2026-09-17, in the mode a parent installs. The same honesty as the branch
       above: name the rule, print no severity. */
    if(gate===null&&t.length&&(r.aiSource==='rules'||r.aiSource==='none')){
      var fam=(''+(r.detectionMode||'')).replace(/^late-after-rotation:/,'').split(':')[0];
      gate=i18n[MODE_GATE[fam]]||i18n.feedGateRule;
    }
    if(gate){
      for(var gi=0;gi<t.length;gi++){
        var gn=t[gi].name;if(!gn||gn==='none')continue;
        out.push(el('span',{'class':'fw-tag fw-tag-gate','title':i18n.feedGateRule},[dot(TECH[gn]||'#888'),techLabel(gn)+' · '+gate]));
      }
      if(!out.length)out.push(el('span',{'class':'fw-tag fw-tag-gate','title':i18n.feedGateRule},[dot('#888'),gate]));
      return out;
    }
    for(var i=0;i<t.length;i++){
      var nm=t[i].name;if(!nm||nm==='none')continue;
      /* title, not body text: the rationale is the model's own words and must
         read as the model's reasoning, not as a finding of the document.
         Matters most for 'combined', which otherwise names no components. */
      var attrs={'class':'fw-tag'};
      if(t[i].why)attrs.title=whyPrefix(t[i].why)+' '+t[i].why;
      /* A blocked record's severity 10 is the rule firing, not a reading of
         the content, so printing "10/10" beside it states something the
         record does not claim. Name what matched instead — that IS what the
         record holds, and it is the more useful fact anyway. */
      if(isBlock(r)){
        out.push(el('span',attrs,[dot(TECH[nm]||'#888'),techLabel(nm)+' · '+blockReasonLabel(r)]));
      }else{
        out.push(el('span',attrs,[dot(TECH[nm]||'#888'),techLabel(nm)+' ('+i18n.feedSeverityWord+' '+(t[i].severity||0)+'/10)']));
      }
    }
    var dv=descriptorTag(r);if(dv)out.push(dv);
    return out;
  }
  // ── display formatting (zero-dependency, browser built-ins) ──
  var nf;try{nf=new Intl.NumberFormat(LOCS[loc],{notation:'compact',maximumFractionDigits:1});}catch(e){nf=null;}
  function fmtN(n){if(typeof n!=='number'||!isFinite(n))return '';return nf?nf.format(n):''+n;}
  var df;try{df=new Intl.DateTimeFormat(LOCS[loc],{dateStyle:'medium',timeStyle:'short'});}catch(e){df=null;}
  function fmtTime(ts){if(!ts)return '';var d=new Date(ts);if(df&&!isNaN(d.getTime()))return df.format(d);return (''+ts).slice(0,16).replace('T',' ');}
  /* Two questions, not one (2026-09-19). normKind answers where the card sits:
     root, or indented under something. kindLabel answers what the card is, and
     it reads the record's own kind rather than the layout bucket.

     They were one function, ending in a bare 'comment' default. A record of kind
     'image' fell into it, so 175 of the demo's 1500 rows were labelled Comment,
     given a comment avatar and the comment card, and attributed to a person's
     handle. An image record is neither a comment nor a node: export-numbers.ts
     calls it "an analysis record, not a DOM node" and flag-provenance.ts calls
     it "a second reading". The counting layer already knew that and left image
     records out of its totals, printing a note naming how many; only the
     rendering said otherwise.

     The dashboard had the answer all along: filter-rail.ts has Images as its
     own kind and keeps it out of Comments, and group-records.ts sorts image
     with post and video at root, saying the media verdict "belongs directly
     under the post header, not among the comments". Root is where it sits here
     too now, so the two surfaces agree.

     A video was labelled Post for the same reason and now says Video, which the
     export could not previously show at all.

     Markers and environment records never reach here; they are handled above,
     before this is called. */
  function normKind(k){
    if(k==='post'||k==='video'||k==='image')return 'post';
    if(k==='reply'||k==='reply-to-reply')return 'reply';
    return 'comment';
  }
  function kindLabel(k){
    if(k==='video')return i18n.feedKindVideo||i18n.feedKindPost;
    if(k==='image')return i18n.feedKindImage||i18n.feedKindPost;
    if(k==='reply'||k==='reply-to-reply')return i18n.feedKindReply;
    if(k==='post')return i18n.feedKindPost;
    return i18n.feedKindComment;
  }
  function avatarInitial(a){var s=(''+(a||'')).replace(/^[\\x00-\\x2f\\x3a-\\x40\\x5b-\\x60\\x7b-\\x7f]+/,'');return (s.charAt(0)||'?').toUpperCase();}
  function avatar(nk,a){return el('div',{'class':'fw-avatar fw-avatar-'+nk},[avatarInitial(a)]);}
  // "Name @handle" (record-feed-study/SYNTHESIS.md design D, point 1): the
  // display name beside the handle, wherever the adapter read them
  // separately (r.authorName, currently X only). Falls through to the
  // existing handle-only line on every other platform and on the withheld/
  // redacted cases, which this never overrides.
  // The resolution rule for a record's author text, shared by the feed card
  // (authorLine below) and its avatar bubble (avatarSeed below). The record
  // detail panel (VERIFIER_SCRIPT_TEMPLATE's recordDetail) and the printed
  // report (exporter.ts) run in separate script scopes and can't call this
  // function directly, so they carry the identical two lines of logic;
  // record-detail-and-report-author-consistency.test.ts pins the text so a
  // change here is caught there too.
  function authorDisplay(r){
    if(r.authorCapture==='withheld')return i18n.feedAuthorWithheld;
    // 'unknown' is the extractors' own sentinel for "the page did not name an
    // account here" (X's identity gate, an IG ad, a page with no self-link to
    // corroborate a handle) -- never a real handle. Read as-is it printed
    // indistinguishably from a genuine account named unknown; the same
    // parenthesised flag an absent author already got is what a non-account
    // needs too (record-feed-study/C-NOTES.md: "author holds non-accounts").
    var handle=(r.author&&r.author!=='unknown')?r.author:'(unknown)';
    // Cold read finding 6: the flagged '(unknown)' sentinel is not a real
    // handle to pair a name with -- "Name @(unknown)" reads worse than
    // either half alone. The name stands by itself there.
    if(r.authorName&&r.authorName!==handle)return handle==='(unknown)'?r.authorName:r.authorName+' @'+handle.replace(/^@+/,'');
    return handle;
  }
  function authorLine(r){
    if(r.redacted)return i18n.feedWithheldAuthor;
    return authorDisplay(r);
  }
  // What the avatar bubble's initial is drawn from. Matches authorDisplay's
  // own unknown-sentinel check so the bubble never shows a letter beside a
  // flagged "(unknown)" line (cold read finding 5: it drew "U").
  function avatarSeed(r){
    if(r.redacted)return '';
    return (r.author&&r.author!=='unknown')?r.author:'';
  }
  // Metrics slot. Renders only when a per-item metrics object is present on
  // the record (r.metrics); records without one render nothing — no zero-fill,
  // per the "show only what was captured" rule. Reads the canonical
  // RecordMetrics shape (src/types/forensic.ts). Shows only captured numbers;
  // never zero-fills. Posts carry comments_count; comments carry reply_count —
  // a record has at most one.
  function metricRow(r){
    var m=r.metrics;if(!m||typeof m!=='object')return null;
    var items=[];
    function add(val,word){if(typeof val==='number'&&isFinite(val))items.push(el('span',{'class':'fw-metric'},[fmtN(val)+' '+word]));}
    if(m.likes_obscured)items.push(el('span',{'class':'fw-metric'},[i18n.feedLikesHidden]));
    // primary_likes = Facebook reactions on a caption record; likes = the
    // comment-shape count. A record carries at most one, so add both.
    else { add(m.primary_likes,i18n.feedCountLikes); add(m.likes,i18n.feedCountLikes); }
    add(m.views,i18n.feedCountViews);
    add(m.shares,i18n.feedCountShares);
    add(m.retweets,i18n.feedCountReposts);
    add(m.comments_count,i18n.feedCountComments);
    add(m.reply_count,i18n.feedCountReplies);
    if(m.is_creator_hearted)items.push(el('span',{'class':'fw-metric'},[i18n.feedMetricHeart]));
    if(!items.length)return null;
    return el('div',{'class':'fw-metrics'},items);
  }
  // Build a scannable QR (SVG, drawn via createElementNS — never innerHTML)
  // pointing at the original post URL, so a recipient can scan to open where
  // the item was. Uses the inlined qrcode-generator global. Built lazily on
  // first expand to keep the file small across thousands of items.
  function buildQr(holder,text){
    try{
      if(typeof qrcode!=='function'){holder.appendChild(el('div',{'class':'fw-qr-url'},[text]));return;}
      var qr=qrcode(0,'M');qr.addData(text);qr.make();
      var n=qr.getModuleCount(),cell=4,margin=4*cell,size=n*cell+margin*2;
      var NS='http://www.w3.org/2000/svg';
      var svg=document.createElementNS(NS,'svg');
      svg.setAttribute('width',''+Math.min(size,176));svg.setAttribute('height',''+Math.min(size,176));
      svg.setAttribute('viewBox','0 0 '+size+' '+size);svg.setAttribute('role','img');
      var bg=document.createElementNS(NS,'rect');
      bg.setAttribute('width',''+size);bg.setAttribute('height',''+size);bg.setAttribute('fill','#ffffff');
      svg.appendChild(bg);
      for(var row=0;row<n;row++){for(var col=0;col<n;col++){
        if(qr.isDark(row,col)){
          var rect=document.createElementNS(NS,'rect');
          rect.setAttribute('x',''+(margin+col*cell));rect.setAttribute('y',''+(margin+row*cell));
          rect.setAttribute('width',''+cell);rect.setAttribute('height',''+cell);rect.setAttribute('fill','#1a1a1a');
          svg.appendChild(rect);
        }
      }}
      holder.appendChild(svg);
      holder.appendChild(el('div',{'class':'fw-qr-url'},[text]));
    }catch(e){holder.appendChild(el('div',{'class':'fw-qr-url'},[text]));}
  }
  // Source footer: a link to the original post + a lazily-rendered QR. Only
  // emitted for http(s) URLs — a hostile record could carry a javascript: URL,
  // which must never become a clickable href or a scannable target.
  function sourceBlock(r){
    // Prefer the per-comment deep-link (lands the recipient ON the exact
    // comment) when the platform captured one; otherwise fall back to the
    // post URL (lands on the post — the recipient finds the comment manually).
    // Same http(s)-only guard on whichever URL is chosen: a hostile record
    // could carry a javascript: URL, which must never become an href or QR.
    var anchored=(typeof r.anchorUrl==='string'&&/^https?:\\/\\//i.test(r.anchorUrl));
    var src=anchored?r.anchorUrl:r.postUrl;
    if(typeof src!=='string'||!/^https?:\\/\\//i.test(src))return null;
    // A bare platform-root URL (the home-feed fallback when no permalink was
    // capturable) leads to the platform front page, not the post — omit the
    // misleading link rather than render it.
    if(/^https?:\\/\\/[^/]+\\/?(?:home|foryou)?\\/?$/i.test(src))return null;
    var box=el('div',{'class':'fw-source'},[]);
    box.appendChild(el('a',{'class':'fw-source-link','href':src,'target':'_blank','rel':'noopener noreferrer'},[anchored?i18n.feedViewComment:i18n.feedViewOriginal]));
    var det=el('details',{'class':'fw-qr'},[]);
    det.appendChild(el('summary',null,[i18n.feedScanQr]));
    var holder=el('div',{'class':'fw-qr-holder'},[]);
    det.appendChild(holder);
    var built=false;
    det.addEventListener('toggle',function(){if(det.open&&!built){built=true;buildQr(holder,src);}});
    box.appendChild(det);
    return box;
  }
  // ── popularity over time ──
  // The same post recorded on different sessions accrues multiple records
  // (the dedup gate is session-scoped), each with its own timestamp + metrics.
  // Group post/video records by postUrl; a URL with 2+ metric-bearing
  // sightings gets a "recorded N times: X -> Y" trend. This shows only the
  // discrete moments FW recorded the post — never a continuous curve, never
  // implying FW sampled on a schedule.
  var seriesByUrl={};
  records.forEach(function(r){
    var k=r.kind||'post';
    if(k!=='post'&&k!=='video')return;
    var u=r.postUrl;
    if(typeof u!=='string'||!u||!r.metrics||typeof r.metrics!=='object')return;
    (seriesByUrl[u]=seriesByUrl[u]||[]).push({t:r.timestamp||'',m:r.metrics});
  });
  Object.keys(seriesByUrl).forEach(function(u){
    seriesByUrl[u].sort(function(a,b){return a.t<b.t?-1:(a.t>b.t?1:0);});
  });
  var TREND_KEYS=[['likes','feedCountLikes'],['primary_likes','feedCountLikes'],['views','feedCountViews'],['comments_count','feedCountComments'],['shares','feedCountShares'],['retweets','feedCountReposts']];
  function pickTrend(entries){
    for(var k=0;k<TREND_KEYS.length;k++){
      var key=TREND_KEYS[k][0],word=i18n[TREND_KEYS[k][1]],pts=[];
      for(var i=0;i<entries.length;i++){
        var v=entries[i].m&&entries[i].m[key];
        if(typeof v==='number'&&isFinite(v))pts.push({t:entries[i].t,v:v});
      }
      if(pts.length>=2)return {word:word,pts:pts};
    }
    return null;
  }
  function miniSparkline(values){
    var w=120,h=28,pad=3,NS='http://www.w3.org/2000/svg';
    var max=Math.max.apply(null,values),min=Math.min.apply(null,values),range=(max-min)||1;
    var stepX=(w-pad*2)/(values.length-1);
    function xy(v,i){return [pad+i*stepX,h-pad-((v-min)/range)*(h-pad*2)];}
    var svg=document.createElementNS(NS,'svg');
    svg.setAttribute('width',''+w);svg.setAttribute('height',''+h);
    svg.setAttribute('viewBox','0 0 '+w+' '+h);svg.setAttribute('role','img');svg.setAttribute('class','fw-spark');
    var pl=document.createElementNS(NS,'polyline');
    pl.setAttribute('points',values.map(function(v,i){return xy(v,i).join(',');}).join(' '));
    pl.setAttribute('fill','none');pl.setAttribute('stroke','#0288a3');pl.setAttribute('stroke-width','1.5');
    pl.setAttribute('stroke-linejoin','round');pl.setAttribute('stroke-linecap','round');
    svg.appendChild(pl);
    values.forEach(function(v,i){
      var p=xy(v,i),c=document.createElementNS(NS,'circle');
      c.setAttribute('cx',''+p[0]);c.setAttribute('cy',''+p[1]);c.setAttribute('r','2');c.setAttribute('fill','#0288a3');
      svg.appendChild(c);
    });
    return svg;
  }
  function popularityBlock(r){
    var k=r.kind||'post';if(k!=='post'&&k!=='video')return null;
    var s=r.postUrl&&seriesByUrl[r.postUrl];
    if(!s||s.length<2)return null;
    var trend=pickTrend(s);if(!trend)return null;
    var first=trend.pts[0],last=trend.pts[trend.pts.length-1];
    var box=el('div',{'class':'fw-pop'},[el('div',{'class':'fw-pop-head'},[i18n.feedPopularityHeader])]);
    box.appendChild(el('div',{'class':'fw-pop-meta'},[i18n.feedPopularitySeenPre+s.length+i18n.feedPopularitySeenPost+' ('+fmtTime(first.t)+' – '+fmtTime(last.t)+')']));
    box.appendChild(el('div',{'class':'fw-pop-row'},[
      miniSparkline(trend.pts.map(function(p){return p.v;})),
      el('span',{'class':'fw-pop-delta'},[fmtN(first.v)+' → '+fmtN(last.v)+' '+trend.word])
    ]));
    box.appendChild(el('div',{'class':'fw-pop-note'},[i18n.feedPopularityNote]));
    return box;
  }
  var root=document.getElementById('fw-feed');
  if(!root)return;
  // The card index and the "not yet checked" line live outside render() so
  // the verifier's one 'fw-verified' listener stamps whichever render is
  // current; render() resets the index and rebuilds the line each time.
  var cardsById={},unchecked=null;
  function verdicts(){return window.__FW_VERDICTS__&&window.__FW_VERDICTS__.byId?window.__FW_VERDICTS__.byId:null;}
  function stamp(node,id){
    var v=verdicts();
    var line=node.querySelector(':scope > .fw-item-verdict');
    if(!v||!v[id]){ if(line)line.remove(); node.classList.remove('fw-item-pass','fw-item-warn','fw-item-fail'); node.classList.add('fw-item-unchecked'); return; }
    var view=v[id];
    node.classList.remove('fw-item-unchecked','fw-item-pass','fw-item-warn','fw-item-fail');
    node.classList.add('fw-item-'+view.cls);
    if(!line){ line=el('div',{'class':'fw-item-verdict'},['']); node.insertBefore(line,node.firstChild&&node.firstChild.nextSibling?node.firstChild.nextSibling:null); }
    line.className='fw-item-verdict fw-item-verdict-'+view.cls;
    line.textContent=view.icon+view.label;
  }
  function stampAll(){ for(var id in cardsById) stamp(cardsById[id],id); if(verdicts()&&unchecked) unchecked.remove(); }
  document.addEventListener('fw-verified',stampAll);
  /* Everything from here to the end of render() is computed over the list it
     is handed. On load that is the whole file; the reading mode above the
     feed hands it the filtered list and calls render() again (item 2 of
     futurestate.md section 3b). The popularity series above stays whole-file
     on purpose: how often a post was recorded does not depend on the filter. */
  function render(records){
  while(root.firstChild)root.removeChild(root.firstChild);
  cardsById={};
  // ── classify + build tree ──
  var byId={};records.forEach(function(r){byId[r.id]=r;});
  var roots=[],markers=[],orphanComments=[],envs=[],childrenOf={},envByRoot={};
  records.forEach(function(r){
    var k=r.kind||'post';
    if(k==='environment'){envs.push(r);return;}
    if(isMarkerKind(k)){markers.push(r);return;}
    if(k==='post'||k==='video'){roots.push(r);return;}
    var pid=(r.parentRecordId&&byId[r.parentRecordId])?r.parentRecordId:null;
    if(pid){(childrenOf[pid]=childrenOf[pid]||[]).push(r);}
    else{orphanComments.push(r);}
  });
  var rootByGroup={};
  roots.forEach(function(r){rootByGroup[r.parentVideoId||r.id]=r;});
  var topLevel=roots.slice();
  // A comment can carry a parentVideoId for a video FW never recorded as its
  // own record (TikTok records comments far more often than the video above
  // them). Rather than float such comments at the top with no parent, group
  // them under a RECONSTRUCTED header built from the room metadata the comment
  // already carries (roomAuthor / roomCaption / roomUrl). This header is
  // presentation only — it is NOT a signed record, is never added to
  // data.records, and is labelled as reconstructed so a recipient never
  // mistakes it for verified evidence.
  var reconByVid={};
  orphanComments.forEach(function(r){
    var rt=r.parentVideoId?rootByGroup[r.parentVideoId]:null;
    if(rt){(childrenOf[rt.id]=childrenOf[rt.id]||[]).push(r);return;}
    if(r.parentVideoId){
      var sr=reconByVid[r.parentVideoId];
      if(!sr){
        sr={id:'fw-recon-'+r.parentVideoId,__reconstructed:true,kind:'reconstructed-room',
            platform:r.platform,parentVideoId:r.parentVideoId,
            author:(r.roomAuthor&&r.roomAuthor.toLowerCase()!=='unknown')?r.roomAuthor:'',roomCaption:r.roomCaption||'',postUrl:r.roomUrl||''};
        reconByVid[r.parentVideoId]=sr;
        rootByGroup[r.parentVideoId]=sr;
        topLevel.push(sr);
      }else{
        if(!sr.author&&r.roomAuthor)sr.author=r.roomAuthor;
        if(!sr.roomCaption&&r.roomCaption)sr.roomCaption=r.roomCaption;
        if(!sr.postUrl&&r.roomUrl)sr.postUrl=r.roomUrl;
      }
      (childrenOf[sr.id]=childrenOf[sr.id]||[]).push(r);
      return;
    }
    topLevel.push(r);
  });
  envs.forEach(function(r){
    var g=r.parentVideoId||r.parentRecordId;
    var rt=g?rootByGroup[g]:null;
    if(rt)envByRoot[rt.id]=r;else topLevel.push(r);
  });
  markers.forEach(function(r){topLevel.push(r);});
  // Feed order = REPLAY order — parity with the dashboard (group-records.ts,
  // 0d): sessions newest-first, and WITHIN a browsing session items render in
  // the order the reader actually saw them (min observedSequence per group;
  // viewportSeenAt/timestamp fallback). The chain's write order is COMPLETION
  // order and measurably lies about slow AI verdicts (14% adjacent inversions
  // on the 2026-07-01 export). Records without impression fields (pre-0d
  // builds) become their own singleton session and interleave by time.
  // Presentation only — the signed payload and the verifier are untouched.
  var repOrder={},repSessionStart={};
  topLevel.forEach(function(rt){
    var members=[rt].concat(childrenOf[rt.id]||[]);
    if(envByRoot[rt.id])members.push(envByRoot[rt.id]);
    var session='',seenAt='',seq=Number.POSITIVE_INFINITY,serial=-1;
    members.forEach(function(m){
      var at=m.viewportSeenAt||m.timestamp||'';
      if(at&&(!seenAt||at<seenAt))seenAt=at;
      if(!session&&m.surfaceSessionId)session=m.surfaceSessionId;
      if(typeof m.observedSequence==='number'&&m.observedSequence<seq)seq=m.observedSequence;
      var p=(typeof m.chainPosition==='number')?m.chainPosition:-1;
      if(p>serial)serial=p;
    });
    var sessionKey=session||('solo:'+rt.id);
    repOrder[rt.id]={session:sessionKey,seenAt:seenAt,seq:seq,serial:serial};
    var cur=repSessionStart[sessionKey];
    if(!cur||(seenAt&&seenAt<cur))repSessionStart[sessionKey]=seenAt;
  });
  topLevel.sort(function(a,b){
    var oa=repOrder[a.id],ob=repOrder[b.id];
    if(oa.session!==ob.session){
      var sa=repSessionStart[oa.session],sb=repSessionStart[ob.session];
      if(sa!==sb)return sa<sb?1:-1;
      return ob.serial-oa.serial;
    }
    if(oa.seq!==ob.seq)return oa.seq-ob.seq;
    if(oa.seenAt!==ob.seenAt)return oa.seenAt<ob.seenAt?-1:1;
    return oa.serial-ob.serial;
  });
  Object.keys(childrenOf).forEach(function(k){childrenOf[k].sort(function(a,b){
    if(typeof a.observedSequence==='number'&&typeof b.observedSequence==='number'&&a.surfaceSessionId===b.surfaceSessionId){return a.observedSequence-b.observedSequence;}
    var ta=a.timestamp||'',tb=b.timestamp||'';
    if(ta!==tb)return ta<tb?-1:1;
    return pos(a)-pos(b);
  });});

  // ── at-a-glance summary ──
  var nPost=0,nComment=0,nReply=0,nFlag=0,nFlagImage=0,nBlock=0,sevHi=0,sevMid=0,sevLo=0,nNoLevel=0,techCount={};
  /* One rule for these three bars and for the level filter on page one: FWN,
     the engine both read. The bars used to cut at 8 and 5, with labels that
     carried no numbers; the filter cuts at 6 and 3 and puts the numbers in its
     own labels. So the public demo printed "high 8" here, and a reader who then
     filtered "High (6-10)" on page one was shown 39: one file, one word, two
     meanings, and nothing on the page saying they were different questions.
     A rule match carries no level at all (it matched a word list and read no
     meaning), so it is named under the bars rather than dropped into the
     lowest one, which is what the old cut did with it. */
  function levelOf(r){
    if(typeof FWN!=='undefined')return FWN.severityLevel(r);
    var s=maxSev(r);return s>=6?'high':s>=3?'medium':'low';
  }
  records.forEach(function(r){
    var k=r.kind||'post';
    if(k==='post'||k==='video')nPost++;
    else if(k==='reply'||k==='reply-to-reply')nReply++;
    else if(k==='comment'||k==='top-comment')nComment++;
    if(k==='environment'||isMarkerKind(k))return;
    /* One rule for this count and for page one's flagged share (FWN, the same
       engine both use). Until 2026-09-17 this block used a looser rule of its
       own that counted image records, so the demo printed 129 flagged items
       here and 108 on page one: one file, two totals, under two labels that a
       reader reads as the same thing. The paragraph directly above this block
       already told the reader that images are unmeasured while the number
       below it counted them. Image records are counted apart and named. */
    if(typeof FWN!=='undefined'&&!FWN.isDecidedContentRecord(r)){
      if(k==='image'&&FWN.isFlaggedRecord(r))nFlagImage++;
      return;
    }
    /* Counted here, after the image records have left, so every tile in this row
       counts one population. It was counted above that line until 2026-09-20, so the
       public demo printed 73 blocked here beside 1056 posts, 269 comments and 99
       flagged, none of which count an image record, and beside page one's 62 paid
       placements: the 11 between them are image records about ads already counted. */
    /* isBlock() is "blocked, or an ad", which is the right question for "is this a
       finding" and the wrong one for this tile: an ad the page left visible (Block Ads
       off, or the hide did not land) was counted as blocked before analysis, under a
       note saying blocked items were hidden. Read 2026-09-20 on an adult-mode file: the
       tile said 4, three were collapsed, and the fourth's own card said the page could
       not apply the action. An ad whose decision block says it stayed on the page is
       left out; a record with no decision block is counted as it always was, because
       nothing on it says either way. */
    var adD=r.decision;
    var adStayed=isAd(r)&&r.verdict!=='blocked'&&!!adD&&typeof adD==='object'&&(adD.applied==='allow'||adD.applied==='context'||adD.applied==='mark'||adD.applied==='mask');
    if(isBlock(r)&&!adStayed)nBlock++;
    if(typeof FWN!=='undefined'?FWN.isFlaggedRecord(r):isFlagged(r)){
      nFlag++;var lvl=levelOf(r);
      if(lvl==='high')sevHi++;else if(lvl==='medium')sevMid++;else if(lvl==='low')sevLo++;else nNoLevel++;
      (r.techniques||[]).forEach(function(t){if(t.name&&t.name!=='none')techCount[t.name]=(techCount[t.name]||0)+1;});
    }
  });

  root.appendChild(el('h2',null,[i18n.feedHeader]));
  // Register item 16: until the verifier has run, nothing below is checked,
  // and the page says so where the reader is looking.
  unchecked=el('p',{'class':'fw-feed-unchecked'},[i18n.feedUnchecked||'Not yet checked']);
  if(!verdicts()) root.appendChild(unchecked);
  root.appendChild(el('p',{'class':'fw-feed-intro'},[i18n.feedIntro]));
  // The reading box's own header used to repeat on every card (about 45% of a card's height by
  // his own count, RECORD-VIEW-BRIEF-2026-09-27.md); it is said once here instead (its own class,
  // not .fw-opinion-head, which stays a per-card class with nothing in it now), and each card
  // below keeps only its own reading as chips.
  root.appendChild(el('div',{'class':'fw-feed-opinion-head'},[i18n.feedOpinionHeader]));
  root.appendChild(el('p',{'class':'fw-feed-intro fw-feed-opinion-note'},[i18n.feedOpinionNote]));
  root.appendChild(el('div',{'class':'fw-glance'},[
    el('div',{'class':'fw-stat'},[el('b',null,[''+nPost]),el('span',null,[i18n.feedPosts])]),
    el('div',{'class':'fw-stat'},[el('b',null,[''+nComment]),el('span',null,[i18n.feedComments])]),
    el('div',{'class':'fw-stat'},[el('b',null,[''+nReply]),el('span',null,[i18n.feedReplies])]),
    el('div',{'class':'fw-stat'},[el('b',null,[''+nFlag]),el('span',null,[i18n.feedFlagged])]),
    /* Rendered only when the blocker actually fired, so exports from installs
       with no blocklist do not carry an empty tile. */
    nBlock>0?el('div',{'class':'fw-stat'},[el('b',null,[''+nBlock]),el('span',null,[i18n.feedBlockedCount])]):null
  ]));
  if(nBlock>0)root.appendChild(el('p',{'class':'fw-feed-intro'},[i18n.feedBlockedNote]));
  /* Named rather than dropped: the file holds these records and a reader can
     see them in the list below, so the page says how many there are and why
     they are not in the count above. */
  if(nFlagImage>0)root.appendChild(el('p',{'class':'fw-feed-intro'},[
    (i18n.feedFlaggedImagesNote||'{n} image records are flagged in this file and are not counted above.').replace('{n}',''+nFlagImage)
  ]));
  function barRow(label,color,count,total){
    var pct=total>0?Math.round(count/total*100):0;
    return el('div',{'class':'fw-barrow'},[
      el('span',{'class':'fw-barlabel'},[color?dot(color):null,label]),
      el('div',{'class':'fw-bartrack'},[el('div',{'class':'fw-barfill','style':'width:'+pct+'%;background:'+(color||'#888')})]),
      el('span',{'class':'fw-barnum'},[''+count])
    ]);
  }
  if(nFlag>0){
    /* The bands are named with the numbers that define them, the same labels
       the level filter uses, so a reader can see that the bar and the filter
       are one question. The denominator is what actually carries a level, not
       every flagged item: filling the bars against a larger number would make
       three bars that never reach the end of the track and never say why. */
    var nLevelled=sevHi+sevMid+sevLo;
    root.appendChild(el('div',{'class':'fw-barlist'},[
      barRow(i18n.exposureSevHigh||i18n.feedSevHigh,'#e53935',sevHi,nLevelled),
      barRow(i18n.exposureSevMid||i18n.feedSevMid,'#e0a458',sevMid,nLevelled),
      barRow(i18n.exposureSevLow||i18n.feedSevLow,'#4fb3a9',sevLo,nLevelled)
    ]));
    /* Named, never folded into a band: a rule match and a hand-typed entry are
       in the flagged tile above because the file acted on them, and neither was
       read by a model, so neither has a level to be in. */
    if(nNoLevel>0)root.appendChild(el('p',{'class':'fw-feed-intro fw-feed-nolevel-note'},[
      (i18n.feedNoLevelNote||'{n} of these carry no level: a rule matched them, or they were typed in by hand, and no model read them.').replace('{n}',''+nNoLevel)
    ]));
    var techArr=Object.keys(techCount).map(function(k){return {name:k,n:techCount[k]};}).sort(function(a,b){return b.n-a.n;});
    if(techArr.length){
      root.appendChild(el('h3',null,[i18n.feedTechniquesHeader]));
      var maxN=techArr[0].n,tl=el('div',{'class':'fw-barlist'},[]);
      techArr.slice(0,8).forEach(function(t){tl.appendChild(barRow(techLabel(t.name),TECH[t.name]||'#888',t.n,maxN));});
      root.appendChild(tl);
    }
  }
  // ── per-account block ──
  var people={};
  records.forEach(function(r){
    var k=r.kind||'post';
    if(k==='environment'||isMarkerKind(k))return;
    /* The same rule as the tile above, for the same reason: these rows are read
       as a breakdown of it. On the public demo they were not, because this
       block kept the old loose rule and counted the 21 image records, so the
       ten rows added up past a total printed two inches higher. */
    if(typeof FWN!=='undefined'){
      if(!FWN.isDecidedContentRecord(r)||!FWN.isFlaggedRecord(r))return;
    } else if(!isFlagged(r))return;
    var a=r.author||'(unknown)';
    if(!people[a])people[a]={n:0,sev:0};
    people[a].n++;var s=maxSev(r);if(s>people[a].sev)people[a].sev=s;
  });
  var peopleArr=Object.keys(people).map(function(a){return {a:a,d:people[a]};}).sort(function(x,y){return y.d.n-x.d.n;});
  if(peopleArr.length){
    var pb=el('div',{'class':'fw-people'},[el('h3',null,[i18n.feedPeopleHeader]),el('p',{'class':'fw-people-note'},[i18n.feedPeopleNote])]);
    peopleArr.slice(0,10).forEach(function(p){
      pb.appendChild(el('div',{'class':'fw-person'},[
        el('span',{'class':'fw-person-name'},[p.a]),
        el('span',{'class':'fw-person-count'},[dot(sevColor(p.d.sev)),' '+p.d.n+' '+i18n.feedPeopleItems])
      ]));
    });
    root.appendChild(pb);
  }
  // ── room banner (comment-section summary + counts captured before hiding) ──
  function roomBanner(env){
    var e=env.environment;if(!e)return null;
    var lbl=(ROOM[loc]&&ROOM[loc][e.label])||e.label||'';
    var kids=[el('strong',null,[i18n.feedRoomHeader+': ']),lbl];
    if(typeof e.sampled==='number')kids.push(' · '+e.sampled+' '+i18n.feedRoomSampled);
    var banner=el('div',{'class':'fw-room'},kids);
    if(e.summary)banner.appendChild(el('div',null,[e.summary]));
    var m=e.metrics||{},counts=[];
    if(typeof m.likes==='number')counts.push(el('span',null,[fmtN(m.likes)+' '+i18n.feedCountLikes]));
    if(typeof m.shares==='number')counts.push(el('span',null,[fmtN(m.shares)+' '+i18n.feedCountShares]));
    if(typeof m.views==='number')counts.push(el('span',null,[fmtN(m.views)+' '+i18n.feedCountViews]));
    if(typeof m.comments==='number')counts.push(el('span',null,[fmtN(m.comments)+' '+i18n.feedCountComments]));
    else if(typeof e.totalVisible==='number')counts.push(el('span',null,[fmtN(e.totalVisible)+' '+i18n.feedCountComments]));
    if(counts.length)banner.appendChild(el('div',{'class':'fw-counts'},counts));
    return banner;
  }
  // ── recursive node render ──
  /* renderedIds, not "rendered": the paging counter further down declares a
     var of that name in this same function scope, so it overwrote this object
     with the number 0 and the cycle guard below became dead code. Reading
     (0)[id] is undefined, so the guard never fired, and writing (0)[id]=1 is a
     silent no-op outside strict mode — a record whose parent chain loops would
     have recursed until the stack gave out and the feed rendered nothing. */
  var renderedIds={};
  function renderNode(r,depth){
    var k=r.kind||'post';
    if(renderedIds[r.id]){return el('div',{'class':'fw-note-muted'},['…']);}
    renderedIds[r.id]=1;
    if(r.__reconstructed){
      var rn=el('div',{'class':'fw-recon'},[]);
      rn.appendChild(el('div',{'class':'fw-recon-head'},[
        el('span',{'class':'fw-recon-badge'},[i18n.feedReconBadge]),
        el('span',{'class':'fw-recon-title'},[r.author||r.roomCaption||(r.postUrl&&/\\/reel\\//.test(r.postUrl)?i18n.feedReelThread:(i18n.feedReconVideo+' '+(r.parentVideoId||'')))])
      ]));
      if(r.roomCaption&&r.roomCaption!==r.author)rn.appendChild(el('div',{'class':'fw-recon-cap'},[(''+r.roomCaption).slice(0,300)]));
      rn.appendChild(el('div',{'class':'fw-recon-note'},[i18n.feedReconNote]));
      var rsb=sourceBlock(r);if(rsb)rn.appendChild(rsb);
      var rkids=childrenOf[r.id];
      if(rkids&&rkids.length){
        var rcw=el('div',{'class':'fw-children'},[]);
        rkids.forEach(function(c){rcw.appendChild(renderNode(c,depth+1));});
        rn.appendChild(rcw);
      }
      if(r.id){ cardsById[r.id]=rn; stamp(rn,r.id); }
      return rn;
    }
    if(isMarkerKind(k)){
      var mline=k==='reset-marker'?(r.resetReason?(i18n.feedChainReset+': '+r.resetReason):i18n.feedChainMarker):(r.resetReason||i18n.feedChainMarker);
      /* A month rotation carries no reader's line of its own, so it rendered as a bare
         "chain marker" with no reason and no link, the one marker a whole-record file is
         certain to hold after its first month (read on an export, 2026-09-20). The month
         it closed is in its hashed text, and its link to that month is shown as the
         reset's is. */
      if(r.detectionMode==='month-rotation-marker'||String(k).indexOf('month-rotation')===0){
        var mm=/from=(\\d{4}-\\d{2})/.exec(r.originalText||'');
        mline=(i18n.feedMonthRotation||'').replace('{month}',mm?mm[1]:'')||i18n.feedChainMarker;
        if(typeof r.priorChainHash==='string'&&r.priorChainHash)mline+=' \u00b7 '+i18n.feedPriorChain+' '+r.priorChainHash.slice(0,12);
      }
      /* The reset's link to the chain it replaced (wiring audit C22): the last
         hash of the previous chain, shortened, so a reader can match it to the
         file that chain was exported in. */
      if(k==='reset-marker'&&typeof r.priorChainHash==='string'&&r.priorChainHash)mline+=' · '+i18n.feedPriorChain+' '+r.priorChainHash.slice(0,12);
      /* Stamped like every other card. This branch and the two below returned
         before the stamp, so a marker, a room summary and a reconstructed node
         carried no verdict at all — not even the unchecked class — while every
         content card around them did. A heartbeat that failed its signature
         rendered as an ordinary grey line in a feed whose docblock says it
         "stamps every card with its record's verdict". A chain marker is
         exactly the kind of record someone would want to edit. */
      var mnode=el('div',{'class':'fw-marker'},['— '+mline+' —']);
      if(r.id){ cardsById[r.id]=mnode; stamp(mnode,r.id); }
      return mnode;
    }
    if(k==='environment'){
      var enode=roomBanner(r)||el('div',{'class':'fw-note-muted'},[i18n.feedRoomHeader]);
      if(r.id){ cardsById[r.id]=enode; stamp(enode,r.id); }
      return enode;
    }
    if(depth>12)return el('div',{'class':'fw-note-muted'},['…']);
    var nk=normKind(k);
    var sev=maxSev(r);
    var flagged=isFlagged(r);
    var node=el('article',{'class':'fw-item fw-item-'+nk,'style':'border-left-color:'+sevColor(flagged?sev:0)});
    // head: avatar + author + kind label, then platform + captured time
    var head=el('header',{'class':'fw-item-head'},[
      avatar(nk,avatarSeed(r)),
      el('div',{'class':'fw-item-meta'},[
        el('div',{'class':'fw-item-line1'},[
          el('span',{'class':'fw-item-author'},[authorLine(r)]),
          el('span',{'class':'fw-kind fw-kind-'+nk},[kindLabel(k)])
        ]),
        el('div',{'class':'fw-item-line2'},(typeof r.chainPosition==='number'&&r.chainPosition>=0?[
          platTag(r.platform),
          el('span',{'class':'fw-item-time'},[fmtTime(r.timestamp)]),
          el('span',{'class':'fw-item-serial'},['#'+r.chainPosition])
        ]:[
          platTag(r.platform),
          el('span',{'class':'fw-item-time'},[fmtTime(r.timestamp)])
        ]))
      ])
    ]);
    node.appendChild(head);
    if(r.id){ cardsById[r.id]=node; stamp(node,r.id); }
    // A hand-typed entry is signed and chained exactly like an observed one, so
    // the only thing that can tell a reader them apart is this label. Without
    // it the file mixes what the software saw with what its owner wrote, under
    // one green tick.
    if(r.feedSource==='manual'
       ||(typeof r.detectionMode==='string'&&r.detectionMode.indexOf('manual')===0)
       ||(typeof r.id==='string'&&r.id.indexOf('fr-manual-')===0)){
      var mb=el('div',{'class':'fw-manual-badge'},[i18n.manualBadge]);
      mb.title=i18n.manualExplain;
      node.appendChild(mb);
    }
    // body text (softened version is what the page showed; original is behind a toggle)
    var hasNeut=!!(r.neutralizedText&&r.neutralizedText.length);
    var softened=hasNeut&&r.neutralizedText!==r.originalText;
    var stand=standIn(r);
    var shown=hasNeut?r.neutralizedText:(stand===null?(r.originalText||''):'');
    if(!r.redacted&&hiddenAd(r))node.appendChild(el('div',{'class':'fw-item-standin'},[i18n.feedAdHidden]));
    if(r.redacted){node.appendChild(el('div',{'class':'fw-withheld'},[i18n.feedWithheld]));}
    else if(stand!==null){if(!hiddenAd(r))node.appendChild(el('div',{'class':'fw-text-capture'},[stand]));}
    /* A card body is capped at 500 characters. It was cut with no mark, on the
       same card that says elsewhere whether the PAGE had folded the text — so a
       reader could be told the whole post was captured and still be shown less
       than the record holds, with nothing saying so. The record itself is
       untouched; only this rendering is capped. */
    else if(shown.length>500)node.appendChild(el('div',{'class':'fw-item-text'},[shown.slice(0,500),el('span',{'class':'fw-text-capture'},[' '+(i18n.feedTextClipped||'shown to 500 characters; the record holds {n}').replace('{n}',''+shown.length)])]));
    else node.appendChild(el('div',{'class':'fw-item-text'},[shown]));
    // What the page carried against what the screen showed: a fragment says
    // so under its text; a fold by style says the page held the whole text.
    if(Array.isArray(r.mediaUrls)&&r.mediaUrls.length){
      var ml=el('div',{'class':'fw-media-urls'},[el('span',{'class':'fw-media-urls-label'},[i18n.feedMediaAsRead+': '])]);
      r.mediaUrls.forEach(function(u,ui){
        if(typeof u!=='string'||u.indexOf('http')!==0)return;
        if(ui>0)ml.appendChild(document.createTextNode(' · '));
        var a=el('a',{'href':u,'rel':'noopener noreferrer nofollow','target':'_blank'},[u.length>72?u.slice(0,69)+'...':u]);
        ml.appendChild(a);
      });
      node.appendChild(ml);
    }
    if(r.textCapture==='cut'){node.appendChild(el('div',{'class':'fw-text-capture'},[i18n.feedTextCaptureCut.replace('{n}',String(r.originalLength||0))]));}
    else if(r.textCapture==='folded'){node.appendChild(el('div',{'class':'fw-text-capture'},[i18n.feedTextCaptureFolded]));}
    // The recorder saw a name beside this item and refused it. The reading
    // view says so under the item, in the same place as the text-capture
    // line, so a row with no author is never read as a failed read.
    if(r.authorCapture==='withheld'){node.appendChild(el('div',{'class':'fw-text-capture'},[i18n.feedAuthorWithheldWhy]));}
    // A reading the person asked for with the button: the feed did not serve this record and
    // no number on this page counts it, and until 2026-09-20 its card said neither.
    if(typeof r.detectionMode==='string'&&r.detectionMode.indexOf('read-this')!==-1){node.appendChild(el('div',{'class':'fw-text-capture fw-reading-asked'},[i18n.feedReadingAsked]));}
    // Why the product acted, in the policy row's own words, and who was declared
    // at the keyboard (decision block, 2026-09-07). Absent block: no line.
    if(r.decision&&typeof r.decision==='object'){
      // A band row (J1, J2, J7, J8) fires on a severity alone, so its words name no
      // family; when the record holds the reader's own answer, that family's words are
      // the why. The same rule as src/i18n/why-words.ts, restated because this file
      // imports nothing. Until 2026-09-20 a reading of commercial at 8 printed
      // "Why: hostility" here.
      var d=r.decision;var fam=(d.reading&&typeof d.reading==='object'&&typeof d.reading.family==='string')?d.reading.family:'';
      var why=((fam&&['J1','J2','J7','J8'].indexOf(d.row)!==-1)?i18n['whyfam_'+fam]:'')||i18n['why_'+d.row]||String(d.row||'');
      var mt=(Array.isArray(d.rails)?d.rails:[]).map(function(x){return x&&x.match;}).filter(Boolean)[0];
      // A mask STACKS on allow: the table lets the swearing filter run over
      // an item nothing else acted on, and src/content/record/decision.ts
      // says so in as many words, a mask stacks on allow by design so it is
      // not a miss. Printed as a difference it read "shown, shown as shown
      // with swearing starred": the same word twice, inviting the reader to
      // look for a decision that had been overridden. One outcome, one
      // phrase (2026-09-18).
      var stacked=d.action==='allow'&&d.applied==='mask';
      // An ad the Block ads switch hid reads as hidden, as on the dashboard card: the sponsored row asks for a fold
      // and the switch hides, a known reason, so neither the difference nor the older-path sentence is printed for it.
      var adHid=typeof FWN!=='undefined'&&FWN.isHiddenAd(r)&&d.applied==='hide';
      var actWord=stacked?(i18n['act_mask']||'mask'):adHid?(i18n['act_hide']||'hide'):(i18n['act_'+d.action]||String(d.action||''));
      var line=i18n.feedWhy+': '+why+(mt?' ("'+mt+'")':'')+' \u00b7 '+actWord;
      if(!stacked&&!adHid&&d.applied&&d.applied!==d.action)line+=', '+i18n.feedDecisionShownAs+' '+(i18n['act_'+d.applied]||String(d.applied));
      // The record's own note. A decision block carries one fixed sentence when
      // what the page showed differs from what the row asked for, and until
      // 2026-09-20 no card showed it: the line ended at "shown as ..." and the
      // reason the two differ stayed in the file where only a person reading the
      // raw record would find it. Two of the three sentences were corrected that
      // same day (M335, M337) and no reader of an export had ever seen either.
      // The known sentences are matched by their exact signed English text and shown in the
      // reader's language; a sentence this page does not know is shown as written.
      if(typeof d.note==='string'&&d.note){
        var NOTE={'Block ads hid this advertisement; applied is what it did':'feedNoteAdHidden','the page could not apply the action; the item stayed as the record says under applied':'feedNoteNotApplied','the household switched this action off; the item stayed as served':'feedNoteSettingOff','the legacy path acted before the table was wired; applied is what it did':'feedNoteLegacyActed','the video rule for this mode skipped the video; applied is what it did':'feedNoteVideoSkipped','the video rule for this mode marked the caption in yellow and left the video playing; applied is what it did':'feedNoteVideoMarked','a fold has no meaning on a video, so the video rule for this mode hid it; applied is what it did':'feedNoteVideoFolded','the reading answered after the item had scrolled away; it was applied when the item came back; applied is what it did':'feedNoteLateVerdict','a second model did not agree, so nothing acted':'feedNotePairVetoed'};
        if(!(adHid&&NOTE[d.note]==='feedNoteLegacyActed'))line+=' \u00b7 '+(i18n[NOTE[d.note]]||d.note);
      }else if(r.visualApplied===false){
        // A hide that did not land and carries no note (a fold that failed keeps its action): the same sentence.
        line+=' · '+i18n.feedNoteNotApplied;
      }
      if(typeof r.reader==='string'&&r.reader)line+=' \u00b7 '+i18n.feedReader+': '+readerWord(r.reader);
      node.appendChild(el('div',{'class':'fw-decision'},[line]));
    }else if(typeof r.reader==='string'&&r.reader){
      node.appendChild(el('div',{'class':'fw-decision'},[i18n.feedReader+': '+readerWord(r.reader)]));
    }
    if(softened){
      // A mask (decision.applied === 'mask') is stars on the swearing, no
      // rewrite and no BETA pill; anything else softened is the rewrite.
      var masked=!!(r.decision&&r.decision.applied==='mask');
      node.appendChild(el('div',{'class':'fw-softened'},masked
        ? [el('span',{'class':'fw-softened-label'},[i18n.feedMasked])]
        : [el('span',{'class':'fw-softened-label'},[i18n.feedSoftened]),el('span',{'class':'fw-beta'},[i18n.feedRewriteBeta])]));
      node.appendChild(el('details',{'class':'fw-orig-details'},[el('summary',null,[i18n.feedShowOriginal]),el('div',{'class':'fw-orig'},[(r.originalText||'').slice(0,500)])]));
    }
    // engagement-metrics row (lit up in step 2 when r.metrics is present)
    var mr=metricRow(r);if(mr)node.appendChild(mr);
    // popularity over time (when the post was recorded 2+ times with metrics)
    var pop=popularityBlock(r);if(pop)node.appendChild(pop);
    // The model's reading, as chips only: the signature covers that these values were stored,
    // not that they are right, said once at the page's own intro (fw-feed-opinion-head/-note)
    // instead of repeating on every card (his own count: about 45% of a card's height, RECORD-
    // VIEW-BRIEF-2026-09-27.md).
    var op=el('div',{'class':'fw-opinion'},[]);
    var opinionCount=0;
    var tags=techTags(r);
    if(tags.length){op.appendChild(el('div',{'class':'fw-tags'},tags));opinionCount++;}
    /* The model's own words, on the card, and not only in a tooltip.
       src/types/forensic.ts says why the field exists: 'combined' is the
       uncategorised residual and by far the most common technique in real
       exports, it names no components ever, and without this line an
       auditor reading "combined, severity 8" has nothing at all. It was
       rendered only as a title attribute on the tag. A title reaches a
       mouse on a desktop and nothing else: not a phone, not a keyboard,
       and not a printed PDF, which is what a recipient does with this file
       before taking it to anybody. The thing the tooltip was protecting,
       that the rationale must not read as a finding of this document, is
       kept by the label instead: the line says whose words these are
       before it says them (2026-09-18).
       Only for a record a model actually read. The same field carries a
       deterministic gate's matched evidence on rules records, and calling
       that the model's stated reason would be a plain falsehood; those
       records already name the gate in the tag itself. */
    var judged=(r.aiSource==='cloud'||r.aiSource==='local')&&!isBlock(r);
    if(tags.length&&judged){
      var reasons=[];
      for(var wi=0;wi<(r.techniques||[]).length;wi++){
        var wt=r.techniques[wi];
        if(!wt||!wt.why||wt.name==='none')continue;
        reasons.push((r.techniques.length>1?techLabel(wt.name)+': ':'')+wt.why);
      }
      if(reasons.length){
        op.appendChild(el('div',{'class':'fw-note-muted'},[whyPrefix(reasons[0])+' '+reasons.join(' \u00b7 ')]));
        opinionCount++;
      }
    }
    else if(flagged){op.appendChild(el('div',{'class':'fw-note-muted'},[i18n.feedNoTechnique]));opinionCount++;}
    // Harm pre-screen: surface only the CATEGORY (e.g. "profanity"), never the
    // raw 0-100 score. Read on a real export (2026-06-04), "5/100" beside the
    // technique's "severity 5/10" read as two competing scales for the same
    // item. Suppressed entirely when the same category is already a technique
    // chip above, to avoid a duplicate "profanity" line.
    if(r.harmFloor&&r.harmFloor.topCategory&&r.harmFloor.topCategory!=='none'){
      var hc=r.harmFloor.topCategory;
      var dupe=(r.techniques||[]).some(function(t){return t.name===hc;});
      if(!dupe){
        op.appendChild(el('div',{'class':'fw-tags'},[el('span',{'class':'fw-tag'},[dot('#b0bec5'),i18n.feedHarmPrescreen+': '+techLabel(hc)])]));opinionCount++;
      }
    }
    if(r.verdict==='blocked'){op.appendChild(el('div',{'class':'fw-note-muted'},[i18n.feedBlocked]));opinionCount++;}
    else if(r.verdict==='educational-reframe'){op.appendChild(el('div',{'class':'fw-note-muted'},[i18n.feedReframed]));opinionCount++;}
    else if(r.verdict==='skipped'){op.appendChild(el('div',{'class':'fw-note-muted'},[i18n.feedSkipped]));opinionCount++;}
    else if(typeof r.verdict==='string'&&r.verdict.indexOf('cancelled')===0){op.appendChild(el('div',{'class':'fw-note-muted'},[i18n.feedNotAnalyzed]));opinionCount++;}
    if(opinionCount>0)node.appendChild(op);
    var sb=sourceBlock(r);if(sb)node.appendChild(sb);
    var env=envByRoot[r.id];
    /* The room summary nested inside its post's card is its own signed record
       and carries its own verdict, so it is registered under the ENVIRONMENT
       record's id rather than the post's. Without this the only record on the
       page whose check was invisible was the one summarising a whole comment
       section. */
    if(env){var rb=roomBanner(env);if(rb){node.appendChild(rb);if(env.id){cardsById[env.id]=rb;stamp(rb,env.id);}}}
    var kids=childrenOf[r.id];
    if(kids&&kids.length){
      var cw=el('div',{'class':'fw-children'},[]);
      kids.forEach(function(c){cw.appendChild(renderNode(c,depth+1));});
      node.appendChild(cw);
    }
    return node;
  }
  // Forensic completeness: no record may be silently dropped. A content
  // record trapped in a parentRecordId cycle (or whose resolved parent is
  // itself unreachable from any root) would otherwise live in childrenOf
  // forever un-rendered. Walk reachable ids from the roots, then append any
  // unreached content record as a recovered top-level orphan. Environment
  // records that attached to a room are intentionally excluded (rendered as
  // banners, not tree nodes).
  var reach={};
  (function mark(list){list.forEach(function(r){if(reach[r.id])return;reach[r.id]=1;var c=childrenOf[r.id];if(c)mark(c);});})(topLevel);
  records.forEach(function(r){if(!reach[r.id]&&(r.kind||'post')!=='environment')topLevel.push(r);});
  /* Render in pages. The owner's consolidated export (2026-09-02, over
     100,000 records) rendered every card on load and the page died before
     the feed finished; the counts and bars above are computed once over the
     whole set, only the card tree is paged. Nothing is dropped: each press
     appends the next page, in the same order. */
  var FEED_PAGE=250;
  var rendered=0;
  /* How many RECORDS sit under each top-level node, so the control can count
     the unit the page's own header counts. It counted top-level nodes: on the
     2026-09-08 file that is 4,691 against 5,962 records, so "N more not shown
     yet" understated what was still hidden by 1.27x beside a header reading
     "Records included: 5,962". A thread is one node and many records. */
  function subtreeSize(r,seen){
    if(seen[r.id])return 0;
    seen[r.id]=1;
    var n=1,kids=childrenOf[r.id];
    if(kids)for(var i=0;i<kids.length;i++)n+=subtreeSize(kids[i],seen);
    if(envByRoot[r.id]&&!seen[envByRoot[r.id].id]){seen[envByRoot[r.id].id]=1;n++;}
    return n;
  }
  var sizes=[],cum=0,sizeSeen={};
  for(var si=0;si<topLevel.length;si++){cum+=subtreeSize(topLevel[si],sizeSeen);sizes.push(cum);}
  var totalShown=cum;
  var more=el('button',{'class':'fw-feed-more','type':'button'},['']);
  function moreLabel(){
    var left=topLevel.length-rendered;
    var end=Math.min(topLevel.length,rendered+FEED_PAGE);
    var recordsNow=(sizes[end-1]||0)-(rendered>0?sizes[rendered-1]:0);
    var recordsLeft=totalShown-(rendered>0?sizes[rendered-1]:0);
    return (i18n.feedShowMore||'Show the next {n}').replace('{n}',''+Math.min(FEED_PAGE,left))
      +' ('+(i18n.feedRemainingRecords||'{n} records not shown yet').replace('{n}',''+recordsLeft)
      +', '+(i18n.feedNextRecords||'{n} in the next page').replace('{n}',''+recordsNow)+')';
  }
  function renderPage(){
    var end=Math.min(topLevel.length,rendered+FEED_PAGE);
    var frag=document.createDocumentFragment();
    for(var i=rendered;i<end;i++)frag.appendChild(renderNode(topLevel[i],0));
    rendered=end;
    root.insertBefore(frag,more);
    if(rendered>=topLevel.length){more.remove();}else{more.textContent=moreLabel();}
  }
  root.appendChild(more);
  more.addEventListener('click',renderPage);
  renderPage();
  }
  render(records);
  window.__FW_FEED__={render:render};
})();`;

// The reading mode (futurestate.md section 3b, item 2). Platform marks as the
// primary switch, one row of numbers per platform from the embedded numbers
// engine (FWN, see export-numbers-inline.ts), three more filters, and the
// blur toggle. Every number is computed over data.records, the whole file,
// never the feed's loaded page; a filter change recomputes the rows and hands
// the filtered list to the feed's render(). State lives in this closure only:
// no URL parameters, nothing stored. Runs after FEED_SCRIPT so the feed's
// render() exists; the initial feed render is the feed's own, so this script
// only re-renders on a change.
export const READING_SCRIPT = `(function(){
  var data=window.__FW_EXPORT__;
  if(!data||!data.records||!data.records.length)return;
  if(typeof FWN==='undefined')return;
  var marksRoot=document.getElementById('fw-reading-marks');
  var filtersRoot=document.getElementById('fw-reading-filters');
  var numbersRoot=document.getElementById('fw-reading-numbers');
  var sentenceEl=document.getElementById('fw-reading-sentence');
  var LOCS={en:'en-US',ro:'ro-RO',es:'es-ES','pt-BR':'pt-BR'};
  var df;try{df=new Intl.DateTimeFormat(LOCS[data.locale]||'en-US',{dateStyle:'medium'});}catch(e){df=null;}
  function fmtDay(ts){if(!ts)return '';var d=new Date(ts);if(df&&!isNaN(d.getTime()))return df.format(d);return (''+ts).slice(0,10);}
  var SURFACE_LABEL={'for-you':'rdSurfaceForYou',following:'rdSurfaceFollowing',unknown:'rdSurfaceUnknown',profile:'rdSurfaceProfile',permalink:'rdSurfacePermalink',search:'rdSurfaceSearch',other:'rdSurfaceOther'};
  if(!marksRoot||!filtersRoot||!numbersRoot)return;
  var i18n=data.i18n, records=data.records;
  function el(tag,attrs,kids){
    var e=document.createElement(tag);
    if(attrs)for(var k in attrs){if(k==='class')e.className=attrs[k];else e.setAttribute(k,attrs[k]);}
    if(kids)for(var i=0;i<kids.length;i++){var c=kids[i];if(c==null)continue;e.appendChild(typeof c==='string'?document.createTextNode(c):c);}
    return e;
  }
  function fill(s,n,m){return String(s).replace('{n}',String(n)).replace('{m}',String(m));}
  var nf;try{nf=new Intl.NumberFormat(data.locale||'en');}catch(e){nf=null;}
  function num(n){return nf?nf.format(n):String(n);}
  // Display names; the record keeps the internal id ('twitter').
  var NAMES={twitter:'X',facebook:'Facebook',youtube:'YouTube',tiktok:'TikTok',instagram:'Instagram'};
  var COLORS={twitter:'#1a1a1a',facebook:'#4267b2',youtube:'#ff0000',tiktok:'#69c9d0',instagram:'#e1306c'};
  var state={platform:null,surface:null,sitting:null,seen:undefined,level:undefined,column:undefined};
  // How many sittings the file holds, over the whole file, so the select is
  // stable whatever the other filters say.
  var sittingOf=FWN.sittingByRecordId(records),maxSitting=0;
  for(var id in sittingOf)if(sittingOf[id]>maxSitting)maxSitting=sittingOf[id];
  function filterState(){
    var f={};
    if(state.platform)f.platforms=[state.platform];
    if(state.surface)f.surfaces=[state.surface];
    if(state.sitting)f.sittings=[state.sitting];
    if(state.seen!==undefined)f.seenBefore=state.seen;
    if(state.level)f.level=state.level;
    if(state.column)f.column=state.column;
    return f;
  }
  // ── the marks ──
  var markButtons={};
  function mark(key,label){
    var b=el('button',{'class':'fw-mark','type':'button','data-platform':key||'all','aria-pressed':'false'},[
      key?el('span',{'class':'fw-mark-dot','style':'background:'+COLORS[key]}):null,
      el('span',{'class':'fw-mark-word'},[label])
    ]);
    b.addEventListener('click',function(){state.platform=key;update(true);});
    markButtons[key||'all']=b;
    return b;
  }
  marksRoot.appendChild(mark(null,i18n.rdAll));
  for(var pi=0;pi<FWN.PLATFORM_ORDER.length;pi++){var p=FWN.PLATFORM_ORDER[pi];marksRoot.appendChild(mark(p,NAMES[p]));}
  // ── the other filters ──
  function select(id,label,options,onChange){
    var s=el('select',{'id':id},[]);
    for(var i=0;i<options.length;i++)s.appendChild(el('option',{'value':options[i][0]},[options[i][1]]));
    s.addEventListener('change',function(){onChange(s.value);update(true);});
    return el('label',{'class':'fw-filter'},[el('span',null,[label+': ']),s]);
  }
  filtersRoot.appendChild(select('fw-filter-surface',i18n.rdSurface,[
    ['',i18n.rdSurfaceAny],['for-you',i18n.rdSurfaceForYou],['following',i18n.rdSurfaceFollowing],['profile',i18n.rdSurfaceProfile],
    ['permalink',i18n.rdSurfacePermalink],['search',i18n.rdSurfaceSearch],['other',i18n.rdSurfaceOther],['unknown',i18n.rdSurfaceUnknown]
  ],function(v){state.surface=v||null;}));
  var sittingOptions=[['',i18n.rdSittingAny]];
  for(var si=1;si<=maxSitting;si++)sittingOptions.push([String(si),fill(i18n.rdSittingN,si)]);
  filtersRoot.appendChild(select('fw-filter-sitting',i18n.rdSitting,sittingOptions,function(v){state.sitting=v?+v:null;}));
  filtersRoot.appendChild(select('fw-filter-seen',i18n.rdSeen,[
    ['',i18n.rdSeenAny],['before',i18n.rdSeenOnly],['first',i18n.rdSeenFirst]
  ],function(v){state.seen=v==='before'?true:(v==='first'?false:undefined);}));
  filtersRoot.appendChild(select('fw-filter-level',i18n.rdLevel,[
    ['',i18n.rdLevelAny],['high',i18n.exposureSevHigh],['medium',i18n.exposureSevMid],['low',i18n.exposureSevLow]
  ],function(v){state.level=v||undefined;}));
  var levelSelect=document.getElementById('fw-filter-level');
  // ── blur authors: visual only, a class on body ──
  var blur=document.getElementById('fw-blur-authors');
  if(blur)blur.addEventListener('change',function(){document.body.classList.toggle('fw-blur-authors',!!blur.checked);});
  // ── the numbers ──
  var COLS=[['impressions','rdColImpressions'],['uniquePosts','rdColUnique'],['extraCopies','rdColSeenBefore'],['paidPlacements','rdColPaid'],['userHidden','rdColUserHidden'],['modelNamed','rdColModelNamed']];
  var table=el('table',{'class':'fw-numbers'},[]);
  var thead=el('thead',null,[]),hr=el('tr',null,[el('th',null,[''])]);
  for(var ci=0;ci<COLS.length;ci++)hr.appendChild(el('th',null,[i18n[COLS[ci][1]]]));
  thead.appendChild(hr);table.appendChild(thead);
  var tbody=el('tbody',null,[]);table.appendChild(tbody);
  var matching=el('p',{'class':'fw-meta fw-matching'},['']);
  numbersRoot.appendChild(table);
  // A report is a selection (data.selection, exporter.ts applyExportGate:
  // flagged records only), so its table cannot describe the whole record and
  // must not say it does (wiring audit 13 Sep, C4); the whole-record and
  // complete-chain files carry no selection and keep the whole-file wording.
  var rdSel=data.selection;
  var note=(rdSel&&typeof rdSel.totalSource==='number'&&rdSel.totalSource>records.length)
    ?fill(i18n.rdSelectionNote,num(records.length),num(rdSel.totalSource))
    :fill(i18n.rdWholeChain,num(records.length),'');
  numbersRoot.appendChild(el('p',{'class':'fw-meta fw-numbers-note'},[note+' '+i18n.rdNumbersHint]));
  // How two of the columns are counted, said under the table that prints them. The
  // dedupe key is the text's hash with no platform in it, and a text is unique on the
  // first impression of it anywhere in the file (export-numbers.ts contentIdentity,
  // seenBeforeIds). So a platform's row is not the number of distinct posts that
  // platform showed: in the public demo X shows 132 distinct texts and its row says
  // fewer, because 93 of the file's 145 texts were met on more than one platform and
  // each is unique only where it came first (counted from the demo, 2026-09-20). The
  // counting is deliberate, the rows add up to the total, and nothing said so.
  if(i18n.rdUniqueNote)numbersRoot.appendChild(el('p',{'class':'fw-meta fw-numbers-note'},[i18n.rdUniqueNote]));
  numbersRoot.appendChild(matching);
  // A number is a filter: pressing it narrows the
  // list to the impressions that number counts, on that row's platform.
  // Pressing the pressed number, or any impressions number, lifts the column.
  function numberButton(row,col){
    var platform=row.platform==='total'?null:row.platform;
    var pressed=col!=='impressions'&&state.column===col&&state.platform===platform;
    var b=el('button',{'class':'fw-num','type':'button','aria-pressed':pressed?'true':'false','data-col':col},[num(row[col])]);
    b.addEventListener('click',function(){
      state.platform=platform;
      state.column=(col==='impressions'||pressed)?undefined:col;
      update(true);
    });
    return b;
  }
  function renderRows(rows){
    while(tbody.firstChild)tbody.removeChild(tbody.firstChild);
    for(var i=0;i<rows.length;i++){
      var r=rows[i],isTotal=r.platform==='total';
      if(!isTotal&&r.impressions===0&&state.platform!==r.platform)continue;
      var tr=el('tr',{'class':isTotal?'fw-numbers-total':'','data-platform':r.platform},[
        el('th',null,[isTotal?i18n.rdTotal:(NAMES[r.platform]||r.platform)])
      ]);
      for(var c=0;c<COLS.length;c++)tr.appendChild(el('td',null,[numberButton(r,COLS[c][0])]));
      tbody.appendChild(tr);
    }
  }
  function update(changed){
    var f=filterState();
    for(var k in markButtons)markButtons[k].setAttribute('aria-pressed',(state.platform||'all')===k?'true':'false');
    var rows=FWN.computePlatformRows(records,f);
    renderRows(rows);
    var list=FWN.applyFilters(records,f);
    if(sentenceEl){
      var row=null;for(var ri=0;ri<rows.length;ri++){if(rows[ri].platform===(state.platform||'total')){row=rows[ri];break;}}
      var lo=null,hi=null;for(var li=0;li<list.length;li++){var ts=list[li].timestamp;if(typeof ts==='string'&&ts){if(lo===null||ts<lo)lo=ts;if(hi===null||ts>hi)hi=ts;}}
      var who=state.platform?(NAMES[state.platform]||state.platform):i18n.rdSentenceAll;
      var where=state.surface?(i18n[SURFACE_LABEL[state.surface]]||state.surface):i18n.rdSurfaceAny;
      var s=(row&&lo)
        ?i18n.rdSentence.replace('{platform}',who).replace('{surface}',where)
          .replace('{impressions}',num(row.impressions)).replace('{unique}',num(row.uniquePosts)).replace('{paid}',num(row.paidPlacements))
          .replace('{from}',fmtDay(lo)).replace('{to}',fmtDay(hi))
        :i18n.rdSentenceNone.replace('{platform}',who).replace('{surface}',where);
      sentenceEl.textContent=s.charAt(0).toUpperCase()+s.slice(1);
    }
    matching.textContent=fill(i18n.rdMatching,num(list.length),num(records.length));
    if(changed&&window.__FW_FEED__&&typeof window.__FW_FEED__.render==='function')window.__FW_FEED__.render(list);
  }
  // The exposure summary's severity bars set the level from below the feed.
  window.__FW_READING__={setLevel:function(level){
    state.level=state.level===level?undefined:level;
    if(levelSelect)levelSelect.value=state.level||'';
    update(true);
    var top=document.getElementById('fw-reading');
    if(top&&top.scrollIntoView)top.scrollIntoView({block:'start'});
  }};
  update(false);
})();`;

// Exposure summary. A render-only, at-a-glance header for the
// recipient. Recomputed in the recipient's browser from the
// SAME embedded retained records the verifier checks (window.__FW_EXPORT__.
// records) — never an asserted number the recipient can't re-derive. Kept to
// trivially-recomputable COMPOSITION aggregates: counts, date range, severity
// bands, top techniques, per-platform. The heavier sequence math
// (runs/periodicity) stays dashboard-only. All record-derived strings reach
// the DOM via textContent / createTextNode (never innerHTML), same XSS
// discipline as the feed + verifier scripts. Structural markers
// (environment / reset / month-rotation) are excluded from exposure counts —
// they are chain bookkeeping, not content the person was exposed to.
export const EXPOSURE_SCRIPT = `(function(){
  var data=window.__FW_EXPORT__;
  if(!data||!data.records||!data.records.length)return;
  var i18n=data.i18n, records=data.records;
  // Same envelope-served labels the feed and behavior scripts use. Without
  // this the composition chart printed the raw enum ("anger-trigger") next to
  // a feed that said the plain word for the same record.
  var LBL=data.techLabels||{};
  function techLabel(nm){return LBL[nm]||nm;}
  var LOCS={en:'en-US',ro:'ro-RO',es:'es-ES','pt-BR':'pt-BR'};
  var loc=LOCS[data.locale]?data.locale:'en';
  function el(tag,attrs,kids){
    var e=document.createElement(tag);
    if(attrs)for(var k in attrs){if(k==='class')e.className=attrs[k];else e.setAttribute(k,attrs[k]);}
    if(kids)for(var i=0;i<kids.length;i++){var c=kids[i];if(c==null)continue;e.appendChild(typeof c==='string'?document.createTextNode(c):c);}
    return e;
  }
  /* Housekeeping kinds, asked in one place: FWN carries the list the rest of
     the product uses. Each script string is its own scope, so this helper is
     defined in each script that needs it, and nowhere is the list written out
     again. */
  function isMarkerKind(k){return typeof FWN!=='undefined'?FWN.isSystemMarker({kind:k}):false;}
  function isMarker(k){return k==='environment'||isMarkerKind(k);}
  function maxSev(r){var m=0,t=r.techniques||[];for(var i=0;i<t.length;i++){if(typeof t[i].severity==='number'&&t[i].severity>m)m=t[i].severity;}return m;}
  /* An advertisement names no technique here, whatever its record carries
     (rebuild plan 2026-09-14, standing decision 1). The ad marker stamped
     consumer-rapid-frame at severity 6 on every sponsored post, and the
     blocked-ad records carry a synthetic ai-content-block at severity 10, so
     this panel counted advertising in its flagged total, its high-severity bar
     and its technique bars. The technique NAME is not the test: the judge
     names consumer-rapid-frame on organic posts too. */
  function isAd(r){return typeof FWN!=='undefined'&&FWN.isPaidPlacement(r);}
  function namedTechniques(r){
    if(isAd(r))return [];
    var out=[],t=r.techniques||[];
    for(var i=0;i<t.length;i++){var nm=t[i].name;if(nm&&nm!=='none')out.push(nm);}
    return out;
  }
  var df;try{df=new Intl.DateTimeFormat(LOCS[loc],{dateStyle:'medium'});}catch(e){df=null;}
  function fmtDate(ts){if(!ts)return '—';var d=new Date(ts);if(df&&!isNaN(d.getTime()))return df.format(d);return (''+ts).slice(0,10);}

  // ── aggregate over content events (markers excluded) ──
  var nEvents=0,earliest=null,latest=null;
  var sevHi=0,sevMid=0,sevLo=0,nFlagged=0;
  var techCount={},platCount={};
  records.forEach(function(r){
    var k=r.kind||'post';
    if(isMarker(k))return;
    nEvents++;
    var ts=r.timestamp;
    if(typeof ts==='string'&&ts){if(earliest===null||ts<earliest)earliest=ts;if(latest===null||ts>latest)latest=ts;}
    var p=r.platform||'(unknown)';
    platCount[p]=(platCount[p]||0)+1;
    var names=namedTechniques(r);
    // "Flagged" here is the file's one rule, the predicates page one and the feed above
    // ask. Until 2026-09-20 this block called a record flagged when it carried a technique
    // NAME, so one file gave two tallies: the feed said "anger 6, swearing 1" and this
    // summary, under a heading that says flagged items, said "anger 10, swearing 4,
    // pressure to buy 4". The extra ones were starred swearing (masked, nothing flagged),
    // button readings, a comment that passed below the cut and passes whose rewrite did
    // not land. A file with no FWN keeps the old rule, as the other sections do.
    var isFlaggedHere=typeof FWN!=='undefined'?(FWN.isDecidedContentRecord(r)&&FWN.isFlaggedRecord(r)):names.length>0;
    if(isFlaggedHere&&names.length){
      // severity band uses the record's top technique severity (task spec:
      // high>=6 / medium 3-5 / low<3). banded only over items that carry a
      // named technique — un-classified pass records would otherwise flood
      // "low" and misstate the flagged-severity composition.
      nFlagged++;
      // The bands count what the reading mode's level filter shows when a band
      // is pressed (FWN.severityLevel: judged items only, ads and rule matches
      // never), so the number a reader presses is the number of items listed.
      var lv=typeof FWN!=='undefined'&&FWN.severityLevel?FWN.severityLevel(r):null;
      if(lv==='high')sevHi++;else if(lv==='medium')sevMid++;else if(lv==='low')sevLo++;
      var seen={};
      names.forEach(function(nm){if(seen[nm])return;seen[nm]=1;techCount[nm]=(techCount[nm]||0)+1;});
    }
  });
  if(nEvents===0)return;

  var root=document.getElementById('fw-exposure');
  if(!root)return;
  root.appendChild(el('h2',null,[i18n.exposureHeader]));
  root.appendChild(el('p',{'class':'fw-exposure-intro'},[i18n.exposureIntro]));

  // headline counters: total recorded items + date range
  root.appendChild(el('div',{'class':'fw-exp-glance'},[
    el('div',{'class':'fw-exp-stat'},[el('b',null,[''+nEvents]),el('span',null,[i18n.exposureEvents])]),
    el('div',{'class':'fw-exp-stat'},[el('b',null,[fmtDate(earliest)+' – '+fmtDate(latest)]),el('span',null,[i18n.exposureDateRange])])
  ]));

  function bar(label,color,count,total,shareWord){
    var pct=total>0?Math.round(count/total*100):0;
    var num=''+count+(shareWord?(' ('+pct+'% '+shareWord+')'):'');
    return el('div',{'class':'fw-exp-barrow'},[
      el('span',{'class':'fw-exp-barlabel'},[color?el('span',{'class':'fw-dot','style':'background:'+color}):null,label]),
      el('div',{'class':'fw-exp-bartrack'},[el('div',{'class':'fw-exp-barfill','style':'width:'+pct+'%;background:'+(color||'#888')})]),
      el('span',{'class':'fw-exp-barnum'},[num])
    ]);
  }

  // A band is a way into the list: pressing it sets the reading mode's level.
  function levelBar(row,level){
    row.setAttribute('role','button');row.setAttribute('tabindex','0');row.setAttribute('data-level',level);
    row.className+=' fw-exp-barrow-link';
    function go(){if(window.__FW_READING__)window.__FW_READING__.setLevel(level);}
    row.addEventListener('click',go);
    row.addEventListener('keydown',function(e){if(e.key==='Enter'||e.key===' '){e.preventDefault();go();}});
    return row;
  }
  // severity bands (over flagged items only)
  var sevAll=sevHi+sevMid+sevLo;
  if(nFlagged>0){
    root.appendChild(el('h3',null,[i18n.exposureSeverityHeader]));
    root.appendChild(el('div',{'class':'fw-exp-barlist'},[
      levelBar(bar(i18n.exposureSevHigh,'#e53935',sevHi,sevAll,i18n.exposureShareWord),'high'),
      levelBar(bar(i18n.exposureSevMid,'#e0a458',sevMid,sevAll,i18n.exposureShareWord),'medium'),
      levelBar(bar(i18n.exposureSevLow,'#4fb3a9',sevLo,sevAll,i18n.exposureShareWord),'low')
    ]));

    // top techniques by count — 5 most frequent
    var techArr=Object.keys(techCount).map(function(k){return {name:k,n:techCount[k]};}).sort(function(a,b){return b.n-a.n;});
    if(techArr.length){
      root.appendChild(el('h3',null,[i18n.exposureTechHeader]));
      var maxN=techArr[0].n,tl=el('div',{'class':'fw-exp-barlist'},[]);
      techArr.slice(0,5).forEach(function(t){tl.appendChild(bar(techLabel(t.name),'#5c6bc0',t.n,maxN,null));});
      root.appendChild(tl);
    }
  }

  // per-platform counts (over all content events)
  var platArr=Object.keys(platCount).map(function(k){return {name:k,n:platCount[k]};}).sort(function(a,b){return b.n-a.n;});
  if(platArr.length){
    root.appendChild(el('h3',null,[i18n.exposurePlatformHeader]));
    var maxP=platArr[0].n,pl=el('div',{'class':'fw-exp-barlist'},[]);
    var EXP_NAMES={twitter:'X',facebook:'Facebook',youtube:'YouTube',tiktok:'TikTok',instagram:'Instagram'};
    platArr.forEach(function(p){pl.appendChild(bar(EXP_NAMES[p.name]||p.name,'#0288a3',p.n,maxP,null));});
    root.appendChild(pl);
  }
})();`;

// ── Feed behavior script (five levels + reader lenses) ──
// Recomputes the READER_LENSES.md analysis spine from the embedded records in
// the recipient's browser: runs (L1), in-sitting skew (L1), quiet-gap returns
// (L2), re-served threads (L2), amplification + advertiser placement (L3),
// technique hand-offs + recurring voices (L4), and the RULE-GATED cautious
// reading (L5, expressly labeled interpretation). Thresholds mirror
// src/ui/dashboard/components/feed-behavior-data.ts exactly (run>=5, returns
// n>=3 at >2x base, high-amp share >25%, top hand-off >=10) so the export and
// the dashboard can never disagree about what earns a caution. The lens bar
// switches only the "what this means" captions; every number is fixed.
/**
 * The Wilson interval, restated for the recipient's page. Kept next to the
 * embedded behavior script that uses it and drift-tested against
 * forensics/wilson.ts (tests/unit/forensics/html-export-wilson-inline.test.ts), the way
 * the canonical payload source is. Returns [lowerPct, upperPct] or null when
 * n is 0. Capability audit 2026-09-06, P0 item 2, the export's in-page half.
 */
export const WILSON_INLINE_SOURCE = `function wl(k,n){
  n=Math.max(0,Math.floor(n));if(!n)return null;k=Math.min(n,Math.max(0,Math.floor(k)));
  var p=k/n,z=1.96,z2=z*z,d=1+z2/n,c=p+z2/(2*n),m=z*Math.sqrt((p*(1-p)+z2/(4*n))/n);
  return [Math.round(Math.max(0,(c-m)/d)*100),Math.round(Math.min(1,(c+m)/d)*100)];
}`;

export const BEHAVIOR_SCRIPT = `(function(){
  var data=window.__FW_EXPORT__;
  if(!data||!data.records||!data.records.length)return;
  var root=document.getElementById('fw-behavior');
  if(!root)return;
  var i18n=data.i18n, records=data.records;
  /* A report is a selection: flagged records only (exporter.ts applyExportGate). Every
     figure below reads the order and rhythm of a whole feed, and over a selection each one
     is the filter talking: the longest run is the whole file, the baseline is 100%, every
     welcome-back item is flagged, and the cautious reading then predicts an unbroken
     charged stretch. Read on a 10-of-71 report, 2026-09-20; the same chain exported whole
     said longest run 1, baseline 16.7%, welcome-back 0 of 2 and no caution met. The
     section says what it is not and computes nothing. Same test as the numbers table's
     selection note. */
  var bhSel=data.selection;
  if(bhSel&&typeof bhSel.totalSource==='number'&&bhSel.totalSource>records.length){
    root.appendChild(el('h2',null,[i18n.bhHeader]));
    root.appendChild(el('p',{'class':'fwb-intro'},[i18n.bhSelectionNote]));
    return;
  }
  function fmt(s){var a=arguments;return String(s).replace(/%(\\d)/g,function(m,d){var v=a[+d];return v==null?'':String(v);});}
  function el(tag,attrs,kids){
    var e=document.createElement(tag);
    if(attrs)for(var k in attrs){if(k==='class')e.className=attrs[k];else e.setAttribute(k,attrs[k]);}
    if(kids)for(var i=0;i<kids.length;i++){var c=kids[i];if(c==null)continue;e.appendChild(typeof c==='string'?document.createTextNode(c):c);}
    return e;
  }
  /* Housekeeping kinds, asked in one place: FWN carries the list the rest of
     the product uses. Each script string is its own scope, so this helper is
     defined in each script that needs it, and nowhere is the list written out
     again. */
  function isMarkerKind(k){return typeof FWN!=='undefined'?FWN.isSystemMarker({kind:k}):false;}
  function isMarker(k){return k==='environment'||isMarkerKind(k);}
  /* One definition of "flagged" per export file. This block used to treat an
     UNDEFINED verdict as flagged, which put records that were never judged
     into the headline percentage the behavioral narrative is built on, while
     the feed section two scripts away used verdict-or-severity. The same chain
     answered "how many were flagged?" three different ways inside one
     downloaded file. This is now byte-identical to the feed section's rule:
     an explicit flag, or a severity the verdict pipeline missed. */
  function maxSev(r){var m=0,t=r.techniques||[];for(var i=0;i<t.length;i++){if(typeof t[i].severity==='number'&&t[i].severity>m)m=t[i].severity;}return m;}
  /* Blocked records carry a synthetic severity-10 technique from the rule-based
     blocker, not a safety judgement — excluded here for the same reason the
     feed section excludes them. They stay in the denominator (they WERE
     encountered) and out of the numerator. */
  /* Advertising is excluded on the same ground and by the same predicate the
     feed section uses (standing decision 1, 2026-09-14): a paid placement stays
     in the denominator, because it WAS served, and out of the numerator. */
  function isAd(r){return typeof FWN!=='undefined'&&FWN.isPaidPlacement(r);}
  /* One flag rate per export file, for the second time. The comment above said this rule was
     byte-identical to the feed section's, and it was not: it counted image records and a
     severity of 5 or more with no flagged verdict, so the public demo printed "99 of 1325
     content records (7.5%)" on page one and "Baseline flag rate across this export: 7.9%"
     here, 119 of 1500, in one file (read off the rendered demo, 2026-09-20). The rule is no
     longer restated: both sides ask FWN, which is what page one and the numbers table ask.
     The old expression stays only for a file with no FWN. */
  function isFl(r){if(typeof FWN!=='undefined')return FWN.isDecidedContentRecord(r)&&FWN.isFlaggedRecord(r);return r.verdict!=='blocked'&&!isAd(r)&&!(r.techniques&&r.techniques.length===1&&r.techniques[0].name==='repeat-exposure')&&(r.verdict==='flagged'||r.verdict==='flagged-hidden'||(maxSev(r)>=5));}
  /* Never judged is not the same as judged and clean. A cancelled record has
     no verdict by construction, so it belongs in neither side of a rate — it
     would silently deflate every percentage below. */
  function isUnjudged(r){return typeof r.verdict==='string'&&r.verdict.indexOf('cancelled')===0;}
  function pct1(n,d){return d>0?Math.round(n/d*1000)/10:0;}
  ${WILSON_INLINE_SOURCE}
  function ci(k,n){var w=wl(k,n);return w?' ('+fmt(i18n.bhCi,w[0],w[1])+')':'';}
  function hm(ts){var d=new Date(ts);return ('0'+d.getHours()).slice(-2)+':'+('0'+d.getMinutes()).slice(-2);}
  function day(ts){return String(ts).slice(0,10);}
  /* The label every card uses, from the envelope; the raw enum with its dashes removed
     ("consumer rapid frame" where the cards say "pressure to buy") only when the file
     carries no label for it. */
  var BH_LBL=data.techLabels||{};
  function pretty(s){return BH_LBL[s]||String(s||'').replace(/-/g,' ');}

  // Order by what the recorder OBSERVED, not by when it finished thinking.
  //
  // record.timestamp is delivery-capture time, set after the AI round trip.
  // The feed section already says so in its own comment: completion order
  // "measurably lies about slow AI verdicts (14% adjacent inversions on the
  // 2026-07-01 export)". This section makes sequence claims aimed at a lawyer,
  // so it is the one place where that 14% is not a presentation detail.
  //
  // observedSequence is stamped in the content script before any AI call and
  // is the honest signal. Records that carry it are ordered inside their
  // browsing session by it; sessions are ordered by when they began. A record
  // without it becomes its own session and falls back to its time, which is
  // the old behavior and no worse than it was.
  var judged=records.filter(function(r){if(!r.timestamp)return false;if(typeof FWN!=='undefined')return FWN.isDecidedContentRecord(r);return !isMarker(r.kind||'post')&&!isUnjudged(r);});
  var seqSessionStart={};
  judged.forEach(function(r){
    var key=r.surfaceSessionId||('solo:'+r.id);
    var at=r.viewportSeenAt||r.timestamp||'';
    var cur=seqSessionStart[key];
    if(!cur||(at&&at<cur))seqSessionStart[key]=at;
  });
  var content=judged.slice().sort(function(a,b){
    var ka=a.surfaceSessionId||('solo:'+a.id), kb=b.surfaceSessionId||('solo:'+b.id);
    if(ka!==kb){
      var sa=seqSessionStart[ka]||'', sb=seqSessionStart[kb]||'';
      if(sa!==sb)return sa<sb?-1:1;
      return ka<kb?-1:1;
    }
    var qa=typeof a.observedSequence==='number'?a.observedSequence:Number.POSITIVE_INFINITY;
    var qb=typeof b.observedSequence==='number'?b.observedSequence:Number.POSITIVE_INFINITY;
    if(qa!==qb)return qa-qb;
    var ta=a.viewportSeenAt||a.timestamp||'', tb=b.viewportSeenAt||b.timestamp||'';
    if(ta!==tb)return ta<tb?-1:1;
    return 0;
  });
  if(!content.length)return;
  var envs=records.filter(function(r){return r.kind==='environment'&&r.environment;});
  var flaggedCount=content.filter(isFl).length;
  var basePct=pct1(flaggedCount,content.length);
  var rangeStart=day(content[0].timestamp), rangeEnd=day(content[content.length-1].timestamp);
  var provAll=fmt(i18n.bhProv,content.length,rangeStart,rangeEnd);

  /* sittings: 30-minute quiet gap, >= semantics (overview-data contract) */
  var GAP=30*60*1000, sessions=[], cur=null;
  content.forEach(function(r){
    var t=+new Date(r.timestamp);
    if(!cur||t-cur.end>=GAP){cur={end:t,items:[]};sessions.push(cur);}
    cur.end=t;cur.items.push(r);
  });

  /* L1a: longest unbroken flagged run */
  var run=0,bestLen=0,bestEnd=null;
  content.forEach(function(r){
    if(isFl(r)){run++;if(run>bestLen){bestLen=run;bestEnd=r.timestamp;}}else run=0;
  });

  /* L1b: in-sitting thirds skew (6+ item sittings only) */
  var oF=0,oN=0,cF=0,cN=0,bigSessions=0;
  sessions.forEach(function(s){
    var n=s.items.length;if(n<6)return;
    bigSessions++;
    var third=Math.floor(n/3),i;
    for(i=0;i<third;i++){oN++;if(isFl(s.items[i]))oF++;}
    for(i=n-third;i<n;i++){cN++;if(isFl(s.items[i]))cF++;}
  });
  var oPct=pct1(oF,oN),cPct=pct1(cF,cN);

  /* L2a: the return after quiet (2h+) */
  var rT=0,rF=0,i;
  for(i=1;i<content.length;i++){
    if(+new Date(content[i].timestamp)-+new Date(content[i-1].timestamp)>=2*3600*1000){
      rT++;if(isFl(content[i]))rF++;
    }
  }
  var rPct=pct1(rF,rT);

  /* L2b: re-served threads (real content URLs only, 2+ distinct days) */
  var SURFACE=['/notifications','/home','/explore','/messages','/foryou','/following'];
  function isBareOrigin(u){
    try{
      var x=new URL(u);
      if(x.pathname==='/'||x.pathname==='')return true;
      for(var j=0;j<SURFACE.length;j++){if(x.pathname===SURFACE[j]||x.pathname===SURFACE[j]+'/')return true;}
      return false;
    }catch(e){return true;}
  }
  var threads={};
  content.forEach(function(r){
    var u=r.roomUrl||r.postUrl;
    if(!u||isBareOrigin(u))return;
    var t=threads[u];
    if(!t){t={url:u,author:r.author||'',platform:r.platform,days:{},n:0,fl:0};threads[u]=t;}
    t.n++;t.days[day(r.timestamp)]=1;
    if(r.author&&!t.author)t.author=r.author;
    if(isFl(r))t.fl++;
  });
  var reserved=Object.keys(threads).map(function(k){
    var t=threads[k];t.dayCount=Object.keys(t.days).length;return t;
  }).filter(function(t){return t.dayCount>=2;})
    .sort(function(a,b){return b.dayCount-a.dayCount||b.n-a.n;});
  var reservedTotal=reserved.length;

  /* L3: amplification readings + advertiser placement.
     ONE READING PER ROOM, and the percentage over rooms where the reading was
     actually taken. An environment record is written per BATCH FLUSH, so a busy
     comment section writes several and voted several times: 286 records over
     155 rooms in the file this was built from, 1.85 votes each. And the label
     is 'unknown' whenever the surface gave no view count, which was 167 of
     those 286 — counted in the denominator, so "high amplification" printed as
     25.9% when it was 62.2% of the rooms that carried a reading at all. The
     product's strongest signal, understated 2.4x by its own denominator.
     Worst label wins within a room: a section that read 'high' on any flush was
     pushed. */
  var ampByRoom={};
  var AMP_RANK={low:1,normal:2,high:3};
  envs.forEach(function(e){
    var a=e.environment.algorithmicAmplification;
    if(a!=='high'&&a!=='normal'&&a!=='low')a='unknown';
    var room=e.parentVideoId||e.postUrl||e.id;
    var prev=ampByRoom[room];
    if(prev===undefined||prev==='unknown'||(a!=='unknown'&&AMP_RANK[a]>AMP_RANK[prev]))ampByRoom[room]=a;
  });
  var amp={high:0,normal:0,low:0,unknown:0};
  Object.keys(ampByRoom).forEach(function(k){amp[ampByRoom[k]]++;});
  /* Rooms carrying a reading. The unknown ones are reported beside it, never
     inside it. */
  var ampTotal=amp.high+amp.normal+amp.low;
  var ampRooms=ampTotal+amp.unknown;
  var advTotal=0,advForYou=0;
  content.forEach(function(r){
    if(r.accountType!=='advertiser')return;
    advTotal++;
    if(r.feedSource==='for-you')advForYou++;
  });

  /* L4a: technique pairs within a sitting */
  var pairCounts={};
  sessions.forEach(function(s){
    var prev=null;
    s.items.forEach(function(r){
      /* A pair is two FLAGGED items: the sentence over these rows says "which technique
         the next flagged item carried". Until 2026-09-20 any record with a first technique
         was taken, so a starred swear word and an ad were paired as flagged items, 24 pairs
         over a file holding 19 flagged records. */
      if(!isFl(r))return;
      var tn=r.techniques&&r.techniques[0]&&r.techniques[0].name;
      if(!tn)return;
      if(prev){var k=prev+' '+tn;pairCounts[k]=(pairCounts[k]||0)+1;}
      prev=tn;
    });
  });
  var pairs=Object.keys(pairCounts).map(function(k){
    var p=k.split(' ');return {a:p[0],b:p[1],n:pairCounts[k],self:p[0]===p[1]};
  });
  var totalPairs=pairs.reduce(function(acc,p){return acc+p.n;},0);
  /* 'combined' is the uncategorised residual (mapConcernToTechnique fallback),
     so a hand-off row built on it narrates an empty bucket. Excluded from the
     rows and disclosed below; mirrors feed-behavior-data.ts. */
  function noRow(n){return n==='genuine-opinion'||n==='combined';}
  var unnamedPairs=pairs.reduce(function(acc,p){
    return acc+((p.a==='combined'||p.b==='combined')?p.n:0);},0);
  var hand=pairs.filter(function(p){return !p.self&&!noRow(p.a)&&!noRow(p.b);})
    .sort(function(x,y){return y.n-x.n;}).slice(0,5);
  var sust=pairs.filter(function(p){return p.self&&!noRow(p.a);})
    .sort(function(x,y){return y.n-x.n;}).slice(0,3);

  /* L4b: recurring voices (3+ distinct days) */
  var voiceMap={};
  content.forEach(function(r){
    var a=(r.author||'').trim();
    if(!a||a.toLowerCase()==='unknown')return;
    var k=r.platform+' '+a;
    var v=voiceMap[k];
    if(!v){v={author:a,platform:r.platform,type:r.accountType,days:{},n:0,fl:0};voiceMap[k]=v;}
    v.days[day(r.timestamp)]=1;v.n++;
    if(r.accountType)v.type=r.accountType;
    if(isFl(r))v.fl++;
  });
  var namedTotal=Object.keys(voiceMap).length;
  var voices=Object.keys(voiceMap).map(function(k){
    var v=voiceMap[k];v.dayCount=Object.keys(v.days).length;return v;
  }).filter(function(v){return v.dayCount>=3;})
    .sort(function(a,b){return b.dayCount-a.dayCount||b.n-a.n;}).slice(0,8);

  /* L5: rule-gated cautions (thresholds mirror feed-behavior-data.ts) */
  var cautions=[],predClauses=[];
  if(bestLen>=5&&bestEnd){
    cautions.push({text:i18n.bhCautionRun,ev:fmt(i18n.bhCautionRunEv,bestLen,hm(bestEnd))});
    predClauses.push(i18n.bhPredClauseRun);
  }
  if(rT>=3&&rPct>2*basePct){
    cautions.push({text:i18n.bhCautionReturn,ev:fmt(i18n.bhCautionReturnEv,rF,rT,rPct,basePct)});
    predClauses.push(i18n.bhPredClauseReturn);
  }
  if(ampTotal>0&&amp.high/ampTotal>0.25){
    cautions.push({text:i18n.bhCautionAmp,ev:fmt(i18n.bhCautionAmpEv,amp.high,ampTotal,pct1(amp.high,ampTotal))});
  }
  if(hand.length&&hand[0].n>=10){
    cautions.push({text:i18n.bhCautionChain,ev:fmt(i18n.bhCautionChainEv,pretty(hand[0].a),pretty(hand[0].b),hand[0].n)});
  }

  /* ── render ── */
  root.appendChild(el('h2',null,[i18n.bhHeader]));
  root.appendChild(el('p',{'class':'fwb-intro'},[i18n.bhIntro]));
  root.appendChild(el('div',{'class':'fwb-legend'},[
    el('span',{'class':'k'},[el('span',{'class':'fwb-sw fact'}),i18n.bhLegendFact]),
    el('span',{'class':'k'},[el('span',{'class':'fwb-sw interp'}),i18n.bhLegendInterp])
  ]));

  var LENS='parent';
  var caps={};
  function renderCaps(){
    for(var id in caps){
      var node=document.getElementById(id);
      if(node)node.textContent=caps[id][LENS];
    }
  }
  var lensbar=el('div',{'class':'fwb-lensbar'},[]);
  [['parent',i18n.bhLensParent],['lawyer',i18n.bhLensLawyer],['analyst',i18n.bhLensAnalyst],['self',i18n.bhLensSelf]]
    .forEach(function(pair){
      var b=el('button',{'class':'fwb-lens'+(pair[0]==='parent'?' active':''),'type':'button','data-lens':pair[0]},[pair[1]]);
      b.addEventListener('click',function(){
        LENS=pair[0];
        var all=lensbar.querySelectorAll('.fwb-lens');
        for(var j=0;j<all.length;j++)all[j].className='fwb-lens'+(all[j]===b?' active':'');
        renderCaps();
      });
      lensbar.appendChild(b);
    });
  lensbar.appendChild(el('span',{'class':'fwb-lens-note'},[i18n.bhLensNote]));
  root.appendChild(lensbar);

  var capSeq=0;
  function card(level,title,subText,interp,tagText){
    var eyebrow=el('p',{'class':'fwb-eyebrow'},[
      el('span',{'class':'fwb-lvl'},[fmt(i18n.bhLevelWord,level)]),title,
      tagText?el('span',{'class':'fwb-cauttag'},[tagText]):null
    ]);
    var c=el('div',{'class':'fwb-card'+(interp?' interp':'')},[eyebrow]);
    if(subText)c.appendChild(el('div',{'class':'fwb-sub'},[subText]));
    root.appendChild(c);
    return c;
  }
  function addCap(c,byLens){
    var id='fwb-cap-'+(++capSeq);
    c.appendChild(el('div',{'class':'fwb-cap','id':id},[byLens[LENS]]));
    caps[id]=byLens;
  }
  function addProv(c,text){c.appendChild(el('div',{'class':'fwb-prov'},[text]));}

  /* L1a card */
  var c1=card(1,i18n.bhRunsTitle,i18n.bhRunsSub);
  if(bestLen===0){
    c1.appendChild(el('div',{'class':'fwb-note'},[i18n.bhRunsNone]));
  }else{
    c1.appendChild(el('div',{'class':'fwb-stat'},[
      i18n.bhRunsStatPre+' ',
      el('span',{'class':'hi'},[fmt(i18n.bhRunsStatHi,bestLen)]),
      bestEnd?fmt(i18n.bhRunsStatEnd,hm(bestEnd)):'.'
    ]));
    c1.appendChild(el('div',{'class':'fwb-note'},[fmt(i18n.bhRunsNote,basePct)+ci(flaggedCount,content.length)]));
    addCap(c1,{
      parent:i18n.bhRunsCapParent,
      lawyer:fmt(i18n.bhRunsCapLawyer,bestLen),
      analyst:fmt(i18n.bhRunsCapAnalyst,basePct,bestLen),
      self:fmt(i18n.bhRunsCapSelf,bestLen)
    });
  }
  addProv(c1,provAll);

  /* L1b card */
  var c2=card(1,i18n.bhSkewTitle,fmt(i18n.bhSkewSub,bigSessions,sessions.length));
  if(bigSessions===0){
    c2.appendChild(el('div',{'class':'fwb-note'},[i18n.bhSkewNone]));
  }else{
    var skewMax=Math.max(oPct,cPct,1);
    [[i18n.bhSkewOpen,oPct,oF,oN],[i18n.bhSkewClose,cPct,cF,cN]].forEach(function(row){
      c2.appendChild(el('div',{'class':'fwb-skewrow'},[
        el('span',null,[row[0]]),
        el('span',{'class':'fwb-skewtrack'},[el('span',{'class':'fwb-skewfill','style':'width:'+(row[1]/skewMax*100)+'%'})]),
        el('span',{'class':'fwb-skewnum'},[fmt(i18n.bhSkewNum,row[1],row[2],row[3])+ci(row[2],row[3])])
      ]));
    });
    addCap(c2,{
      parent:fmt(i18n.bhSkewCapParent,oPct,cPct),
      lawyer:i18n.bhSkewCapLawyer,
      analyst:fmt(i18n.bhSkewCapAnalyst,oPct,cPct),
      self:fmt(i18n.bhSkewCapSelf,oPct,cPct)
    });
  }
  addProv(c2,fmt(i18n.bhProv,oN+cN,rangeStart,rangeEnd));

  /* L2a card */
  var c3=card(2,i18n.bhReturnTitle,i18n.bhReturnSub);
  if(rT===0){
    c3.appendChild(el('div',{'class':'fwb-note'},[i18n.bhReturnNone]));
  }else{
    c3.appendChild(el('div',{'class':'fwb-stat'},[fmt(i18n.bhReturnStat,rF,rT,rPct)+ci(rF,rT)]));
    c3.appendChild(el('div',{'class':'fwb-note'},[fmt(i18n.bhReturnNote,basePct,rT)+ci(flaggedCount,content.length)]));
    addCap(c3,{
      parent:fmt(i18n.bhReturnCapParent,rPct,basePct),
      lawyer:i18n.bhReturnCapLawyer,
      analyst:fmt(i18n.bhReturnCapAnalyst,rPct,basePct,rT),
      self:fmt(i18n.bhReturnCapSelf,rPct,basePct)
    });
  }
  addProv(c3,fmt(i18n.bhProv,rT,rangeStart,rangeEnd));

  /* L2b card: re-served threads */
  var c4=card(2,i18n.bhReserveTitle,i18n.bhReserveSub);
  if(!reserved.length){
    c4.appendChild(el('div',{'class':'fwb-note'},[i18n.bhReserveNone]));
  }else{
    var tbl=el('table',{'class':'fwb-table'},[
      el('thead',null,[el('tr',null,[
        el('th',null,[i18n.bhReserveColThread]),el('th',null,[i18n.bhReserveColDays]),
        el('th',null,[i18n.bhReserveColServings]),el('th',null,[i18n.bhReserveColFlagged])
      ])])
    ]);
    var tb=el('tbody',null,[]);
    reserved.slice(0,6).forEach(function(t){
      tb.appendChild(el('tr',null,[
        el('td',null,[
          el('strong',null,[t.author||'']),' ',
          el('span',{'class':'fwb-mono'},[String(t.url).replace(/^https?:\\/\\//,'').slice(0,52)])
        ]),
        el('td',{'class':'num'},[''+t.dayCount]),
        el('td',{'class':'num'},[''+t.n]),
        el('td',{'class':'num'},[t.fl?''+t.fl:''])
      ]));
    });
    tbl.appendChild(tb);
    c4.appendChild(tbl);
    addCap(c4,{
      parent:i18n.bhReserveCapParent,
      lawyer:i18n.bhReserveCapLawyer,
      analyst:i18n.bhReserveCapAnalyst,
      self:i18n.bhReserveCapSelf
    });
  }
  addProv(c4,fmt(i18n.bhReserveProv,reservedTotal));

  /* L3 card */
  var c5=card(3,i18n.bhAmpTitle,i18n.bhAmpSub);
  if(ampTotal===0&&advTotal===0){
    c5.appendChild(el('div',{'class':'fwb-note'},[i18n.bhAmpNone]));
  }else{
    if(ampTotal>0){
      var segs=[['high','#c62828',i18n.bhAmpHigh],['normal','#0288a3',i18n.bhAmpNormal],['low','#2e7d32',i18n.bhAmpLow],['unknown','#8a8a8a',i18n.bhAmpUnknown]]
        .filter(function(s){return amp[s[0]]>0;});
      /* The bar shows every room, unknowns included, so the reader sees how
         much of it was read; the percentages beside it divide by the rooms that
         carried a reading. */
      var segbar=el('div',{'class':'fwb-segbar'},[]);
      segs.forEach(function(s){
        segbar.appendChild(el('span',{'class':'fwb-seg','style':'width:'+(amp[s[0]]/ampRooms*100)+'%;background:'+s[1],'title':s[2]+' '+amp[s[0]]},[]));
      });
      c5.appendChild(segbar);
      var legend=el('div',{'class':'fwb-seglegend'},[]);
      segs.forEach(function(s){
        legend.appendChild(el('span',null,[el('span',{'class':'fwb-swd','style':'background:'+s[1]}),s[2]+' '+amp[s[0]]]));
      });
      c5.appendChild(legend);
    }
    if(advTotal>0){
      c5.appendChild(el('div',{'class':'fwb-stat','style':'margin-top:.6rem'},[fmt(i18n.bhAmpAdv,advForYou,advTotal)]));
      c5.appendChild(el('div',{'class':'fwb-note'},[i18n.bhAmpAdvNote]));
    }
    addCap(c5,{
      parent:fmt(i18n.bhAmpCapParent,pct1(amp.high,ampTotal),pct1(advForYou,advTotal)),
      lawyer:i18n.bhAmpCapLawyer,
      analyst:fmt(i18n.bhAmpCapAnalyst,pct1(amp.high,ampTotal),ampTotal,pct1(advForYou,advTotal)),
      self:i18n.bhAmpCapSelf
    });
  }
  addProv(c5,fmt(i18n.bhAmpProv,ampTotal,ampRooms,advTotal)+' \\u00b7 '+rangeStart+' \\u2192 '+rangeEnd);

  /* L4a card */
  var c6=card(4,i18n.bhChainsTitle,i18n.bhChainsSub);
  if(!hand.length&&!sust.length){
    c6.appendChild(el('div',{'class':'fwb-note'},[i18n.bhChainsNone]));
  }else{
    var maxN=1;
    hand.concat(sust).forEach(function(p){if(p.n>maxN)maxN=p.n;});
    function chainRow(p,tag){
      var kids=[el('span',{'class':'fwb-chip'},[pretty(p.a)])];
      if(p.self){kids.push(el('span',{'class':'fwb-arrow'},[i18n.bhChainRepeats]));}
      else{
        kids.push(el('span',{'class':'fwb-arrow'},[i18n.bhChainThen]));
        kids.push(el('span',{'class':'fwb-chip'},[pretty(p.b)]));
      }
      kids.push(el('span',{'class':'fwb-chainbar','style':'width:'+Math.max(8,p.n/maxN*120)+'px'},[]));
      kids.push(el('span',{'class':'fwb-chainn'},[fmt(i18n.bhChainTimes,p.n)+' \\u00b7 '+tag]));
      return el('div',{'class':'fwb-chainrow'},kids);
    }
    hand.forEach(function(p){c6.appendChild(chainRow(p,i18n.bhChainHandoff));});
    sust.forEach(function(p){c6.appendChild(chainRow(p,i18n.bhChainSustained));});
    addCap(c6,{
      parent:i18n.bhChainsCapParent,
      lawyer:i18n.bhChainsCapLawyer,
      analyst:i18n.bhChainsCapAnalyst,
      self:i18n.bhChainsCapSelf
    });
  }
  if(unnamedPairs>0){
    c6.appendChild(el('div',{'class':'fwb-note'},[fmt(i18n.bhChainsUnnamed,unnamedPairs,totalPairs)]));
  }
  addProv(c6,fmt(i18n.bhChainsProv,totalPairs));

  /* L4b card */
  var c7=card(4,i18n.bhVoicesTitle,i18n.bhVoicesSub);
  if(!voices.length){
    c7.appendChild(el('div',{'class':'fwb-note'},[i18n.bhVoicesNone]));
  }else{
    var vt=el('table',{'class':'fwb-table'},[
      el('thead',null,[el('tr',null,[
        el('th',null,[i18n.bhVoicesColAccount]),el('th',null,[i18n.bhVoicesColDays]),el('th',null,[i18n.bhVoicesColSeen])
      ])])
    ]);
    var vb=el('tbody',null,[]);
    voices.forEach(function(v){
      vb.appendChild(el('tr',null,[
        el('td',null,[
          v.author,
          v.type==='advertiser'?el('span',{'class':'fwb-chip adv','style':'margin-left:6px'},[i18n.bhVoicesAdvertiser]):null
        ]),
        el('td',{'class':'num'},[''+v.dayCount]),
        el('td',{'class':'num'},[''+v.n+(v.fl?' \\u00b7 '+fmt(i18n.bhVoicesFlagged,v.fl):'')])
      ]));
    });
    vt.appendChild(vb);
    c7.appendChild(vt);
    addCap(c7,{
      parent:i18n.bhVoicesCapParent,
      lawyer:i18n.bhVoicesCapLawyer,
      analyst:i18n.bhVoicesCapAnalyst,
      self:i18n.bhVoicesCapSelf
    });
  }
  addProv(c7,fmt(i18n.bhVoicesProv,voices.length,namedTotal));

  /* L5 card: the cautious reading */
  var c8=card(5,i18n.bhCautionTitle,i18n.bhCautionSub,true,i18n.bhCautionTag);
  if(!cautions.length){
    c8.appendChild(el('div',{'class':'fwb-note'},[i18n.bhCautionNone]));
  }else{
    cautions.forEach(function(c,idx){
      c8.appendChild(el('div',{'class':'fwb-cautitem'},[
        el('span',{'class':'fwb-cautn'},[''+(idx+1)]),
        el('div',null,[c.text,el('div',{'class':'fwb-cautev'},[c.ev])])
      ]));
    });
  }
  if(predClauses.length){
    c8.appendChild(el('div',{'class':'fwb-pred'},[
      el('span',{'class':'fwb-predtag'},[i18n.bhPredTag]),
      i18n.bhPredLead+predClauses.join(i18n.bhPredJoin)+i18n.bhPredTail
    ]));
  }
  addCap(c8,{
    parent:i18n.bhCautionCapParent,
    lawyer:i18n.bhCautionCapLawyer,
    analyst:i18n.bhCautionCapAnalyst,
    self:i18n.bhCautionCapSelf
  });

  renderCaps();
})();`;

/**
 * The certificate head (the export's first screen): the reading sentence as the big line, the checker's own word, and the
 * three facts that word covers. Built in the reader's browser from the file's own data and moved nodes, with no
 * data-fw-prov on anything it adds, so the signed rows read exactly as before. The word is the heading of the banner the
 * checker draws in #fw-status, on every outcome, failure paths included; the 'fw-verified' event fires before the
 * banner exists and is not sent on those paths, so it cannot be the signal.
 */
export const CERT_SCRIPT = `(function(){
  var data=window.__FW_EXPORT__;
  if(!data)return;
  var i18n=data.i18n||{}, records=data.records||[];
  var body=document.body;
  var brand=document.querySelector('body > .fw-brandrow');
  var title=document.querySelector('body > h1');
  var sub=title&&title.nextElementSibling&&title.nextElementSibling.classList.contains('fw-meta')?title.nextElementSibling:null;
  var sentence=document.getElementById('fw-reading-sentence');
  var status=document.getElementById('fw-status');
  if(!brand||!title)return;
  var LOCS={en:'en-US',ro:'ro-RO',es:'es-ES','pt-BR':'pt-BR'};
  var loc=LOCS[data.locale]||'en-US';
  var nf;try{nf=new Intl.NumberFormat(loc);}catch(e){nf=null;}
  var df;try{df=new Intl.DateTimeFormat(loc,{dateStyle:'medium'});}catch(e){df=null;}
  function num(n){return nf?nf.format(n):String(n);}
  function day(t){var d=new Date(t);return df&&!isNaN(d.getTime())?df.format(d):(''+t).slice(0,10);}
  function el(tag,cls,text){var e=document.createElement(tag);if(cls)e.className=cls;if(text!=null)e.textContent=text;return e;}
  function word(line){var s=line||'';var i=s.indexOf(':');return (i>=0?s.slice(i+1):s).trim();}
  var head=el('header','fw-cert');
  var top=el('div','fw-cert-top');
  top.appendChild(brand);top.appendChild(title);if(sub)top.appendChild(sub);
  head.appendChild(top);
  if(sentence)head.appendChild(sentence);
  var seal=el('div','fw-cert-seal');
  var sealWord=el('div','fw-cert-word','');
  seal.appendChild(sealWord);
  if(i18n.certCheckedHere)seal.appendChild(el('div','fw-cert-what',i18n.certCheckedHere));
  head.appendChild(seal);
  var facts=el('div','fw-cert-facts');
  function fact(label,value,wide){if(!label)return;var d=el('div',wide?'wide':'');d.appendChild(el('span','',label));d.appendChild(el('b','',value));facts.appendChild(d);}
  var sites={},times=[];
  // Sites and dates skip the record's own markers (a reset, a month change) and the comment-section summaries, as the
  // summary's date range below does, so the two never name different spans under the same label.
  for(var i=0;i<records.length;i++){var r=records[i];if(!r||r.kind==='environment'||(typeof FWN!=='undefined'&&FWN.isSystemMarker(r)))continue;if(r.platform)sites[r.platform]=1;var t=Date.parse(r.timestamp);if(t===t&&t)times.push(t);}
  times.sort(function(a,b){return a-b;});
  // The same count the summary below prints as records included, so the head and the summary never disagree.
  fact(i18n.summaryRecordCount,num(records.length));
  fact(i18n.certSites,num(Object.keys(sites).length));
  if(times.length)fact(i18n.exposureDateRange,day(times[0])+' \u2013 '+day(times[times.length-1]),true);
  head.appendChild(facts);
  body.insertBefore(head,body.firstChild);
  // The seal repeats the checker's own heading, never the file's word table: the heading is written from the words the
  // checker carries as code (FIXED), which an edit to the file's data cannot reach, and it already says "as a report of x
  // of y" for a report. With no banner, before the verdict or while a re-run checks again, the seal shows what the
  // status area shows, and the observer stays on so every re-run resets it.
  var STATES={'fw-pass':'ok','fw-warn':'warn','fw-fail':'fail'};
  function read(){
    var banner=status.querySelector('.fw-chain-summary');
    if(!banner){seal.className='fw-cert-seal';sealWord.textContent=status.textContent||'';return;}
    var h=banner.querySelector('h2');
    for(var k in STATES){if(banner.classList.contains(k)){seal.className='fw-cert-seal '+STATES[k];sealWord.textContent=word(h?h.textContent:'');return;}}
  }
  if(!status||!window.crypto||!window.crypto.subtle){seal.style.display='none';return;}
  read();
  if(typeof MutationObserver!=='undefined')new MutationObserver(read).observe(status,{childList:true,subtree:true,characterData:true});
})();`;
