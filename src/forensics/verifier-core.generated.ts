// @ts-nocheck
// GENERATED FILE. Do not edit.
//
// Written from src/forensics/verifier-core-source.ts by scripts/build-standalone-verifier.ts and
// checked by tests/unit/forensics/the-dashboard-reads-a-restore-as-the-checker-does.test.tsx.
// Edit the source string, then run: npm run gen:verifier

  var PAYLOAD_KEYS=["id","timestamp","platform","originalText","originalHash","originalLength","neutralizedText","author","postUrl","techniques","overallScore","userAgeCategory","aiSource","feedSource","aiModel","aiProvider","detectionMode","configSnapshot","prevRecordHash","chainPosition","verdict","skipReason","kind","parentVideoId","environment","priorChainHash","resetReason","publicKeyFingerprint","topic","sourceCategory","parentRecordId","commentDepth","roomAuthor","roomCaption","roomUrl","harmFloor","failureKind","cap","metrics","anchorUrl","overrideOrigin","visualApplied","videoContext","accountType","sourceContainer","observedSequence","viewportSeenAt","surfaceSessionId","imageContext","surfaceOrigin","textCapture","mediaUrls","decision","reader","buildId","verdictOrigin","authorCapture","authorName","stamp","provenance","subject"];
  var OUTSIDE_PAYLOAD_KEYS=["integrityHash","signature","chainAnchor","redacted"];
  function hex(buf){return Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,'0')).join('');}
  async function sha256(s){return hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));}
  function b64uToBytes(s){
    s=s.replace(/-/g,'+').replace(/_/g,'/');while(s.length%4)s+='=';
    var raw=atob(s),out=new Uint8Array(raw.length);
    for(var i=0;i<raw.length;i++)out[i]=raw.charCodeAt(i);
    return out;
  }
  function canonicalPayload(r){
    return JSON.stringify({
      id:r.id,timestamp:r.timestamp,platform:r.platform,
      originalText:r.originalText,originalHash:r.originalHash,originalLength:r.originalLength,
      neutralizedText:r.neutralizedText,author:r.author,postUrl:r.postUrl,
      techniques:r.techniques,overallScore:r.overallScore,
      userAgeCategory:r.userAgeCategory,aiSource:r.aiSource,feedSource:r.feedSource,
      aiModel:r.aiModel||'',aiProvider:r.aiProvider||'',
      detectionMode:r.detectionMode||'',configSnapshot:r.configSnapshot||null,
      prevRecordHash:r.prevRecordHash||'',chainPosition:typeof r.chainPosition==='number'?r.chainPosition:-1,
      verdict:r.verdict,skipReason:r.skipReason,
      kind:r.kind,parentVideoId:r.parentVideoId,environment:r.environment,
      priorChainHash:r.priorChainHash,resetReason:r.resetReason,
      publicKeyFingerprint:r.publicKeyFingerprint,
      topic:r.topic,sourceCategory:r.sourceCategory,
      parentRecordId:r.parentRecordId,commentDepth:r.commentDepth,
      roomAuthor:r.roomAuthor,roomCaption:r.roomCaption,roomUrl:r.roomUrl,
      harmFloor:r.harmFloor,failureKind:r.failureKind,cap:r.cap,
      metrics:r.metrics,
      anchorUrl:r.anchorUrl,
      overrideOrigin:r.overrideOrigin,
      visualApplied:r.visualApplied,
      videoContext:r.videoContext,
      accountType:r.accountType,
      sourceContainer:r.sourceContainer,
      observedSequence:r.observedSequence,
      viewportSeenAt:r.viewportSeenAt,
      surfaceSessionId:r.surfaceSessionId,
      imageContext:r.imageContext,
      surfaceOrigin:r.surfaceOrigin,
      textCapture:r.textCapture,
      mediaUrls:r.mediaUrls,
      decision:r.decision,
      reader:r.reader,
      buildId:r.buildId,
      verdictOrigin:r.verdictOrigin,
      authorCapture:r.authorCapture,
      authorName:r.authorName,
      stamp:r.stamp,
      provenance:r.provenance,
      subject:r.subject??undefined
    });
  }
  async function importPubKey(jwk){
    return crypto.subtle.importKey('jwk',jwk,{name:'ECDSA',namedCurve:'P-256'},false,['verify']);
  }
  async function fingerprintJwk(jwk){
    if(!jwk||typeof jwk.x!=='string'||typeof jwk.y!=='string'){
      throw new Error('embedded public key has no P-256 coordinates');
    }
    return (await sha256(jwk.x+'|'+jwk.y)).slice(0,16);
  }
  async function importVerifiedPubKey(jwk,declaredFingerprint){
    var derived=await fingerprintJwk(jwk);
    if(typeof declaredFingerprint!=='string'||derived!==declaredFingerprint){
      throw new Error('embedded public-key fingerprint mismatch');
    }
    return {pubKey:await importPubKey(jwk),fingerprint:derived};
  }
  // keys: every key the file carries, by fingerprint ({fp: CryptoKey}); a
  // bare CryptoKey is the file's own key alone. A record is checked under
  // the key its fingerprint names (since 2026-09-03 a file carries the
  // keys of earlier generations recovered with their records); a record
  // whose key is not in the file verifies by hash only, never fails.
  // A withheld record (register item 20 part 1): its content left the file,
  // so its hash cannot be recomputed here. It is accepted only when a signed
  // redaction marker in the same file names its id and its integrityHash;
  // the marker's own signature is checked like any record's.
  function redactionOf(marker){
    if(!marker||marker.kind!=='redaction-marker') return null;
    var m=/\brecord=(\S+) recordHash=([0-9a-f]{64}) fields=(\S+)/.exec(marker.originalText||'');
    return m?{recordId:m[1],recordHash:m[2],fields:m[3].split(','),markerId:marker.id}:null;
  }
  function redactionIndex(records){
    var idx={};
    for(var i=0;i<(records||[]).length;i++){var r=redactionOf(records[i]);if(r)idx[r.recordId]=r;}
    return idx;
  }
  async function verifyOne(rec, keys, currentFingerprint, redactions){
    if(rec&&rec.redacted){
      var red=redactions&&redactions[rec.id];
      if(!red||red.recordHash!==rec.integrityHash||red.markerId!==rec.redacted.markerId) return {ok:false,reason:'redaction-unattested'};
      // The hash cannot be recomputed — the content it covers has left the
      // file — so the signature over it is the only thing here that says the
      // install made this record rather than someone else. It was not being
      // checked at all: a redacted record earned its tick from a marker naming
      // its id and a string comparison. Checking it costs one verify and turns
      // "a marker mentions this" into "the install signed this hash".
      // A withheld record carrying no signature at all is accepted on the
      // marker alone, and is NOT counted unsigned the way an ordinary record
      // is. A read on 2026-09-19 called that a hole, because deleting one field
      // moves a file from "partial, one record unauthenticated" to VERIFIED.
      // It is not one: the marker is itself a signed record whose hashed text
      // names THIS record's id and THIS record's stored integrityHash, checked
      // equal three lines above, and a forged marker fails the whole file. So
      // the install has vouched for the hash either way, and the record's own
      // signature over it adds nothing an attacker could remove. The same
      // argument covers a file whose key never set up: the marker cannot be
      // checked either, so the marker's own record already reads unverified and
      // the file is partial before this branch is reached. What WAS wrong on
      // 2026-09-19 is the sentence the reader gets: see the note in
      // scripts/build-standalone-verifier.ts, which said the signature had been
      // checked over a record that had none. noSignature is what it counts.
      if(!rec.signature) return {ok:true,redacted:true,markerId:red.markerId,noSignature:true};
      if(!currentFingerprint) return {ok:true,redacted:true,markerId:red.markerId,noKey:true};
      // The key is chosen exactly as the ordinary path below chooses it: the
      // one the record NAMES, and the file's own only when the record names
      // none. There used to be a second fallback here, "or else the file's
      // current key", and it could only fire in one case: a record that
      // names a fingerprint the file does not carry. That is a record from
      // an older generation of the install, whose signature was made by the
      // key that has since rotated, so checking it under the CURRENT key
      // cannot succeed and the record came back 'tampered', a BROKEN file.
      // The ordinary path calls that same record 'prior-key', unverified and
      // not a failure; one condition read two opposite ways by two branches
      // of one function. Measured 2026-09-18 on vector 05 with the withheld
      // record re-signed by a key the file does not carry: BROKEN at record
      // 2 (v-1): tampered, exit 2.
      var byRfp=keys&&typeof keys.type==='string'?{}:(keys||{});
      if(keys&&typeof keys.type==='string') byRfp[currentFingerprint]=keys;
      var rfp=rec.publicKeyFingerprint||currentFingerprint;
      var rkey=byRfp[rfp];
      if(!rkey){
        return {ok:true,redacted:true,markerId:red.markerId,unverified:true,priorKey:true,reason:'prior-key',fingerprint:rfp};
      }
      var rok=false;
      try{ rok=await crypto.subtle.verify({name:'ECDSA',hash:{name:'SHA-256'}},rkey,b64uToBytes(rec.signature),new TextEncoder().encode(rec.integrityHash)); }catch(e){ rok=false; }
      if(!rok) return {ok:false,reason:'tampered'};
      return {ok:true,redacted:true,markerId:red.markerId};
    }
    var recomputed=await sha256(canonicalPayload(rec));
    if(recomputed!==rec.integrityHash){
      /* The verdict never softens: a record whose content does not hash to its
         stored hash has failed, and an attacker must not be able to downgrade
         that by adding a key. What is added is the OTHER explanation, as data:
         a record written by a newer FeelingWise carries fields this checker's
         key list does not know, and a key list cannot hash a key it has never
         heard of, so the recomputation misses for a file that is perfectly
         sound. Naming the fields lets the reader tell the two apart and go and
         fetch a current checker instead of concluding the file was edited. */
      var unknown=[];
      try{
        for(var k in rec){
          if(!Object.prototype.hasOwnProperty.call(rec,k))continue;
          if(PAYLOAD_KEYS.indexOf(k)!==-1||OUTSIDE_PAYLOAD_KEYS.indexOf(k)!==-1)continue;
          unknown.push(k);
        }
      }catch(e){ unknown=[]; }
      return unknown.length
        ? {ok:false,reason:'tampered',unknownFields:unknown.sort()}
        : {ok:false,reason:'tampered'};
    }
    // A recomputed unkeyed hash is structural evidence, not authentication.
    // Keep unsigned/unknown-key records readable, but never let them make the
    // overall result green.
    if(!rec.signature) return {ok:true,unverified:true,unsigned:true,reason:'unsigned'};
    if(!currentFingerprint){
      return {ok:true,unverified:true,unverifiedSignature:true,reason:'signature-unverified'};
    }
    var byFp=keys&&typeof keys.type==='string'?{}:(keys||{});
    if(keys&&typeof keys.type==='string') byFp[currentFingerprint]=keys;
    var fp=rec.publicKeyFingerprint||currentFingerprint;
    var pubKey=byFp[fp];
    if(!pubKey){
      return {ok:true,unverified:true,priorKey:true,reason:'prior-key',fingerprint:fp};
    }
    var okSig=false;
    try{
      var sig=b64uToBytes(rec.signature);
      okSig=await crypto.subtle.verify({name:'ECDSA',hash:{name:'SHA-256'}},pubKey,sig,
        new TextEncoder().encode(rec.integrityHash));
    }catch(_err){
      okSig=false;
    }
    if(!okSig){
      if(!rec.publicKeyFingerprint){
        // The signature WAS checked and it did not verify. The record names no
        // key, so this cannot be called forgery — a record written before the
        // fingerprint field existed may have been signed under a key that has
        // since rotated, and the file carries a different one. But it is not
        // the same fact as "there was no key to check against", which is what
        // 'signature-unverified' means at the branch above, and both were
        // reported with that one word under a verdict line reading "no
        // signature failed". A signature was run and it failed.
        return {ok:true,unverified:true,unverifiedSignature:true,signatureRejected:true,reason:'signature-did-not-verify',fingerprint:fp};
      }
      return {ok:false,reason:'key-mismatch'};
    }
    // A key that travelled in this file beside the records is checked for
    // self-consistency only (its fingerprint matches its own bytes). The
    // signature verifies; the file cannot say whose key it is. The file's own
    // key is the one with a first-seen stamp from outside authorities, so the
    // two are told apart (evidence-gap register item 12, 2026-09-06).
    if(fp!==currentFingerprint) return {ok:true,carriedKey:true,fingerprint:fp};
    return {ok:true};
  }
  async function verifyChain(records,perRecord){
    // A link is a hash: record N names its predecessor by integrityHash. The
    // walk resolves each link against every record in the file, wherever it
    // sits, because a file can hold more than one run of the same chain:
    // after a record loss and recovery the install signs new records at
    // positions it had already used (2026-09-03, the owner's file: 1,062
    // positions held twice or three times, every link resolving to a record
    // in the file). Those are reported as branches, never as tampering.
    // A predecessor that is not in the file is expected for a filtered
    // export (applyExportGate drops pass/skipped records) and is counted,
    // not flagged. A seam (consecutive positions, broken link, predecessor
    // absent) is a restart: where both signatures verify the install signed
    // both records itself; where the file does not carry the key (the
    // owner's imported generations, 2026-09-03) the restart cannot be
    // confirmed by signature and is counted as unattributed. A seam is never
    // a failure on its own: a modified record fails its own hash, a forged
    // one fails its signature, and those are reported per record.
    //
    // Every table in this walk is keyed by text taken from the records, so none of them inherits
    // from Object: a record naming "constructor" is a missing hash, not a crash before the edited
    // record is reported.
    var hashes=Object.create(null);
    for(var h=0;h<records.length;h++){
      if(typeof records[h].integrityHash==='string') hashes[records[h].integrityHash]=true;
    }
    // A LINKED RUN. Positions restart at 0 on purpose in two places: the month
    // rotation and the reset. Each writes a signed marker at position 0 whose
    // prevRecordHash is the genesis constant (it has no predecessor in its own
    // run) and whose priorChainHash, inside the hashed payload, names the last
    // record of the run it follows. Until 2026-09-20 neither was read here, so
    // every position of the new month counted as "held twice" and the marker
    // counted as naming a predecessor outside the file: a whole-record export
    // made by the product's own code across one ordinary month flip, 17
    // records, read PARTIALLY VERIFIED with "7 chain seams" and "1 record names
    // a predecessor that is not in this file". That is every install after its
    // first month. The link is followed instead: when the marker's
    // priorChainHash resolves to a record in this file, the positions after it
    // are a new run and are compared only with each other. When it does not
    // resolve, nothing changes: the run before it is not shown to be the one it
    // follows, and a reused position is still counted.
    //
    // The marker itself must have verified under a key, because a marker whose
    // signature was not checked could otherwise erase branch counts by being
    // present.
    //
    // The record named may already have a successor. A restore does this: the
    // records written after the backup stay in the archive, and the next reset
    // names the record the restore went back to. Those records are counted as
    // set aside, once each, rather than as every position the two runs share,
    // so a marker naming a record in the middle of a run still leaves one of
    // the two lines from it counted and the file cannot read verified.
    var GENESIS='feelingwise-chain-genesis-v1';
    function isRunMarker(r){
      return (r.kind==='month-rotation-marker'||r.kind==='reset-marker')&&r.chainPosition===0;
    }
    function opensLinkedRun(r,idx){
      var own=perRecord&&perRecord[idx];
      return isRunMarker(r)
        && typeof r.priorChainHash==='string'&&r.priorChainHash!==''
        && hashes[r.priorChainHash]===true
        && !!(own&&own.ok&&!own.unverified);
    }
    // A record's parent is the record it follows: for a linked marker the one its priorChainHash
    // names, for any other record its predecessor. So a reset goes on from a record as a successor does.
    var byHash=Object.create(null),successors=Object.create(null);
    var linked=[],isLinked={},markersNaming=Object.create(null);
    for(var np=0;np<records.length;np++){
      var rn=records[np];
      if(typeof rn.integrityHash==='string'&&byHash[rn.integrityHash]===undefined) byHash[rn.integrityHash]=np;
      if(np>0&&opensLinkedRun(rn,np)){
        linked.push(np); isLinked[np]=true;
        (markersNaming[rn.priorChainHash]||(markersNaming[rn.priorChainHash]=[])).push(np);
      }else if(typeof rn.prevRecordHash==='string'){
        (successors[rn.prevRecordHash]||(successors[rn.prevRecordHash]=[])).push(np);
      }
    }
    function childrenOf(h){ return (successors[h]||[]).concat(markersNaming[h]||[]); }
    // The line the record kept is the one its newest record is on. A whole-record file puts the
    // live chain after the archive and before the records of earlier keys, so that record is the
    // last one with a position that is not from an earlier key. Its parents are followed back, so
    // that where a restore went back to a later backup the line it returned to is the one kept,
    // however long recording then goes on.
    var keptChild={};
    var tip=records.length-1;
    while(tip>=0&&(typeof records[tip].chainPosition!=='number'||records[tip].chainPosition<0||records[tip].chainAnchor==='pre-rekey')) tip--;
    for(var up=tip,onKept={};up>=0&&!onKept[up];){
      onKept[up]=true;
      var ur=records[up],uh=isLinked[up]?ur.priorChainHash:ur.prevRecordHash;
      var pu=typeof uh==='string'?byHash[uh]:undefined;
      if(pu===undefined||onKept[pu]) break;
      keptChild[pu]=up; up=pu;
    }
    // At a record a linked marker names, one child carries the kept line on and every other child
    // starts a line set aside. Where the newest record does not lead back to the named record, the
    // last marker in the file naming it keeps its run, as the last reset after a restore does.
    var counted={},forkDone={};
    function countSetAside(markerIdx){
      var named=records[markerIdx].priorChainHash,fork=byHash[named];
      if(forkDone[fork]) return 0;
      forkDone[fork]=true;
      var naming=markersNaming[named];
      var kept=keptChild[fork]!==undefined?keptChild[fork]:naming[naming.length-1];
      var queue=childrenOf(named),n=0;
      for(var q=0;q<queue.length;q++){
        var k=queue[q];
        if(k===kept||counted[k]) continue;
        counted[k]=true; n++;
        var kh=records[k].integrityHash;
        if(typeof kh!=='string') continue;
        var more=childrenOf(kh);
        for(var mq=0;mq<more.length;mq++) queue.push(more[mq]);
      }
      return n;
    }
    // Every line is counted before any position is compared, so that a record set aside is left
    // out of the comparison wherever the file puts it, before its marker or after.
    var setAside=0,setAsideLines=[];
    for(var li=0;li<linked.length;li++){
      var aside=countSetAside(linked[li]);
      if(aside>0){
        var namedPos=records[byHash[records[linked[li]].priorChainHash]].chainPosition;
        setAside+=aside;
        setAsideLines.push({position:typeof namedPos==='number'?namedPos:-1,n:aside});
      }
    }
    var seenPos=Object.create(null),branches=0,restarts=0,unattributed=0,outside=0,run=0;
    var keyChangesStated=0,keyChangesUnstated=0;
    // Every key change the install stated, wherever its marker sits. The marker is meant to be the
    // first record the new key signs, but one whose write failed is written at the next worker start,
    // after records the new key already signed; it still states that change. Each statement explains
    // one change, and only a marker that verified under the key it names as the new one counts.
    var keyStatements=Object.create(null);
    for(var ks=0;ks<records.length;ks++){
      var ksaid=keyReplacedLine(records[ks]),kso=perRecord&&perRecord[ks];
      if(ksaid&&kso&&kso.ok&&!kso.unverified&&records[ks].publicKeyFingerprint===ksaid.next){
        var kk=ksaid.previous+'>'+ksaid.next;
        keyStatements[kk]=(keyStatements[kk]||0)+1;
      }
    }
    for(var i=0;i<records.length;i++){
      var cur=records[i];
      if(isLinked[i]) run++;
      if(typeof cur.chainPosition==='number'&&!counted[i]){
        var posKey=(cur.publicKeyFingerprint||'')+':'+run+':'+cur.chainPosition;
        if(seenPos[posKey]) branches++; else seenPos[posKey]=true;
      }
      if(typeof cur.prevRecordHash!=='string') continue;
      // A key change is read where a record follows one signed by another key; a change no
      // statement above explains is told apart, never folded into the reading.
      var kp=byHash[cur.prevRecordHash];
      if(kp!==undefined){
        var kpf=records[kp].publicKeyFingerprint,kcf=cur.publicKeyFingerprint;
        if(typeof kpf==='string'&&kpf&&typeof kcf==='string'&&kcf&&kpf!==kcf){
          var kpair=kpf+'>'+kcf;
          if(keyStatements[kpair]>0){ keyStatements[kpair]--; keyChangesStated++; }
          else keyChangesUnstated++;
        }
      }
      // The first record in the file names a predecessor too. FORMAT.md section 4
      // says every prevRecordHash is resolved; until 2026-09-20 this loop skipped
      // index 0, so a report of 10 records, every one of which named a record the
      // report had left out, said 9 did. There is no record before it to be
      // consecutive with, so an absent predecessor of the first record is always
      // one outside the file, never a seam. A record at position 0 names none
      // (the empty string or the genesis constant).
      if(i===0){
        if(cur.prevRecordHash!==''&&cur.prevRecordHash!==GENESIS&&cur.chainPosition!==0&&!hashes[cur.prevRecordHash]) outside++;
        continue;
      }
      // The genesis constant is not a record, so a marker's own predecessor is
      // never missing. What it follows is priorChainHash, and that is the record
      // counted when it is not in the file.
      if(cur.prevRecordHash===GENESIS&&isRunMarker(cur)){
        if(typeof cur.priorChainHash==='string'&&cur.priorChainHash!==''&&!hashes[cur.priorChainHash]) outside++;
        continue;
      }
      if(hashes[cur.prevRecordHash]) continue;
      var prev=records[i-1];
      var contiguous=typeof prev.chainPosition==='number'
        && typeof cur.chainPosition==='number'
        && cur.chainPosition === prev.chainPosition + 1;
      if(!contiguous){ outside++; continue; }
      var a=perRecord&&perRecord[i-1],b=perRecord&&perRecord[i];
      var signedBoth=!!(a&&b&&a.ok&&!a.unverified&&b.ok&&!b.unverified);
      if(!signedBoth) unattributed++;
      restarts++;
    }
    return {ok:true,branches:branches,restarts:restarts,unattributed:unattributed,outside:outside,setAside:setAside,setAsideLines:setAsideLines,keyChangesStated:keyChangesStated,keyChangesUnstated:keyChangesUnstated};
  }
  // The two fingerprints a key-replaced marker names, read from its hashed line
  // (src/forensics/gap-marker.ts gapMarkerText); null for any other record.
  function keyReplacedLine(r){
    if(!r||r.kind!=='gap-marker'||typeof r.originalText!=='string') return null;
    // Anchored at the line's own opening, so words carried inside another field cannot pose as one.
    var m=/^\[gap-marker @ [^\]]+\] reason=key-replaced platform=\S+ count=\d+ unit=\S+ from=\S+ to=\S+ previousKey=([0-9a-f]{8,64}) newKey=([0-9a-f]{8,64}) origin=([a-z-]+)(?: |$)/.exec(r.originalText);
    return m?{previous:m[1],next:m[2],origin:m[3]}:null;
  }
  // Completeness, recomputed by the recipient rather than read off the
  // page-one summary. The summary is static HTML written at export time; if
  // the payload is edited afterwards the two disagree, and only this one is
  // computed from the records the reader is actually looking at.
  //
  // Mirrors computeChainCoverage in html-export.ts: runs are split at every
  // position reset, because a month rotation legitimately restarts at 0.
  // A record the person typed in, not one the software observed. flagPostManually
  // (src/forensics/manual-flag.ts) builds it from a web address and the user's
  // own words and appends it to the same signed chain, so nothing in the
  // cryptography separates it from a capture. Only the label does.
  function isManualRecord(r){
    return !!r&&(r.feedSource==='manual'
      ||(typeof r.detectionMode==='string'&&r.detectionMode.indexOf('manual')===0)
      ||(typeof r.id==='string'&&r.id.indexOf('fr-manual-')===0));
  }
  function coverageFromRecords(records){
    var chained=[];
    for(var i=0;i<records.length;i++){
      var r=records[i];
      if(typeof r.chainPosition!=='number'||r.chainPosition<0) continue;
      if(r.chainAnchor==='pre-rekey') continue;
      chained.push(r.chainPosition);
    }
    if(!chained.length) return {present:0,missingBefore:0,gapsInside:0};
    var runs=[],cur=[],prev=-Infinity;
    for(var j=0;j<chained.length;j++){
      if(chained[j]<=prev){ if(cur.length)runs.push(cur); cur=[]; }
      cur.push(chained[j]); prev=chained[j];
    }
    if(cur.length)runs.push(cur);
    var missingBefore=0,gapsInside=0;
    for(var k=0;k<runs.length;k++){
      var run=runs[k],first=run[0],last=run[run.length-1];
      if(first>0) missingBefore+=first;
      var seen={},n=0;
      for(var m=0;m<run.length;m++){ if(!seen[run[m]]){seen[run[m]]=true;n++;} }
      var span=last-first+1;
      if(span>n) gapsInside+=span-n;
    }
    return {
      present:chained.length,
      runs:runs.length,
      firstPosition:runs[0][0],
      lastPosition:runs[runs.length-1][runs[runs.length-1].length-1],
      missingBefore:missingBefore,
      gapsInside:gapsInside
    };
  }
  // What the independent timestamps say about what is missing.
  //
  // This is the only completeness evidence in the file that the person holding
  // it could not have produced. An anchor names a chain position and the exact
  // record hash at that position; both were signed by an authority with no
  // stake here. So an anchor whose record is absent, or whose position sits
  // past the last record present, is third-party evidence that this file does
  // not carry everything the chain held. Removing the tail of a chain used to
  // leave no trace at all; against an anchor it does.
  function anchorFindings(records,anchors){
    var out={checked:0,notInFile:0,beyondTail:0,beyondPosition:-1,lastPosition:-1};
    if(!anchors||!anchors.length) return out;
    var hashes={},maxPos=-1;
    for(var i=0;i<records.length;i++){
      var r=records[i];
      if(typeof r.integrityHash==='string') hashes[r.integrityHash]=true;
      if(typeof r.chainPosition==='number'&&r.chainPosition>maxPos&&r.chainAnchor!=='pre-rekey'){
        maxPos=r.chainPosition;
      }
    }
    out.lastPosition=maxPos;
    // Counted by the RECORD each anchor points at, not by the anchor. A round
    // asks two authorities about one chain head, so counting anchors would
    // report one missing record as two.
    var missing={};
    for(var a=0;a<anchors.length;a++){
      var an=anchors[a];
      out.checked++;
      if(!hashes[an.anchoredIntegrityHash]) missing[an.anchoredIntegrityHash]=true;
      if(typeof an.anchoredChainPosition==='number'&&maxPos>=0&&an.anchoredChainPosition>maxPos){
        var gap=an.anchoredChainPosition-maxPos;
        if(gap>out.beyondTail){ out.beyondTail=gap; out.beyondPosition=an.anchoredChainPosition; }
      }
    }
    out.notInFile=Object.keys(missing).length;
    return out;
  }
  // How many records of each run fall under a time stamp. A stamp names one record hash, and
  // every record before it in the same run is fixed by it through the links, so a record counts
  // when a stamp in this file names it or a later record of its own run, at the position the
  // stamp states. Runs are split as coverageFromRecords splits them, and a later run's stamp is
  // not carried back: a range and a list of stamps read side by side cannot say which run a stamp
  // stands behind. Page one counts the same way (computeStampCoverage in html-export.ts).
  // When no position is used twice there is one line, whatever order the file lists it in, so the
  // records are read in position order: two swapped records read as overlapping runs before (the
  // tester's finding 3, 8 Oct 2026). A position used twice is a restart, and file order keeps the runs apart.
  function stampCoverage(records,anchors){
    var runs=[],cur=null,prev=-Infinity,where=Object.create(null);
    var seen=Object.create(null),twice=false,listed=[];
    for(var s=0;s<records.length;s++){
      var q=records[s];
      if(!q||typeof q.chainPosition!=='number'||q.chainPosition<0||q.chainAnchor==='pre-rekey') continue;
      if(seen[q.chainPosition]) twice=true;
      seen[q.chainPosition]=true;
      listed.push(q);
    }
    var ordered=twice?listed:listed.slice().sort(function(x,y){return x.chainPosition-y.chainPosition;});
    for(var i=0;i<ordered.length;i++){
      var r=ordered[i];
      if(!r||typeof r.chainPosition!=='number'||r.chainPosition<0) continue;
      if(r.chainAnchor==='pre-rekey') continue;
      if(!cur||r.chainPosition<=prev){ cur={first:r.chainPosition,last:r.chainPosition,positions:[],stampedTo:-1,newest:null}; runs.push(cur); }
      cur.positions.push(r.chainPosition); cur.last=r.chainPosition; prev=r.chainPosition;
      if(typeof r.integrityHash==='string'&&where[r.integrityHash]===undefined) where[r.integrityHash]={run:runs.length-1,position:r.chainPosition};
    }
    var list=anchors||[];
    for(var a=0;a<list.length;a++){
      var an=list[a];
      var at=an&&typeof an.anchoredIntegrityHash==='string'?where[an.anchoredIntegrityHash]:undefined;
      if(!at||an.anchoredChainPosition!==at.position) continue;
      var hit=runs[at.run];
      if(at.position>hit.stampedTo) hit.stampedTo=at.position;
      var t=typeof an.generalizedTime==='string'&&an.generalizedTime?an.generalizedTime:null;
      if(t&&(hit.newest===null||t>hit.newest)) hit.newest=t;
    }
    var out=[];
    for(var k=0;k<runs.length;k++){
      var rn=runs[k],n=0;
      for(var m=0;m<rn.positions.length;m++) if(rn.positions[m]<=rn.stampedTo) n++;
      out.push({first:rn.first,last:rn.last,records:rn.positions.length,stamped:n,newest:rn.newest});
    }
    return out;
  }
  // What the file says it is. A report made through the export gate states
  // its own selection: how many records it holds of how many the install
  // had, and how many the gate left out. When that statement is present,
  // covers every record in the file, and the predecessors missing from the
  // chain are no more than the records it says it left out, those missing
  // links are the report's own doing and not a loss: the file reads as a
  // report, verified, not as partial. The statement sits inside the signed
  // manifest, so it is the signer's claim, not an editor's (2026-09-06, the
  // owner's first look at his own report on the check page: 95 of 943
  // records, 89 links outside, and a PARTIAL he could not explain).
  // The record kinds a file may hold BEYOND the content its selection counts.
  // A marker is written by the install to explain something about the chain —
  // a redaction, a prune, a rotation, a gap — and it is not one of the
  // observations a report says it included.
  var SELECTION_EXTRA_KINDS={
    'reset-marker':1,'month-rotation-marker':1,'prune-marker':1,'gap-marker':1,
    'heartbeat-marker':1,'import-marker':1,'repair-marker':1,'redaction-marker':1,
    'reconcile-marker':1
  };
  /**
   * The file's own statement of what it left out, accepted only when the file
   * really holds what it says.
   *
   * The count compares against CONTENT records. It compared against every
   * record in the file, so redacting one record inside a filtered report broke
   * it: the redaction marker is an extra record, included no longer equalled
   * the file's length, and this returned null. The report then lost the signed
   * selection that explains its own gaps, its unresolved links read as
   * unexplained, and a sound file fell from VERIFIED to partially verified for
   * doing the thing the product tells people to do with a name they want out.
   * Measured on a four-record report: with the marker, selectionOf null and
   * state partial; without it, a selection of 2 of 4 and state verified.
   */
  function selectionOf(data,recordCount){
    var s=data&&data.selection;
    if(!s||typeof s!=='object') return null;
    if(typeof s.included!=='number'||typeof s.totalSource!=='number') return null;
    var content=recordCount;
    if(typeof recordCount!=='number'&&recordCount&&typeof recordCount.length==='number'){
      content=0;
      for(var i=0;i<recordCount.length;i++){
        var k=recordCount[i]&&recordCount[i].kind;
        if(!k||!SELECTION_EXTRA_KINDS[k]) content++;
      }
    }
    if(s.included!==content||s.totalSource<s.included) return null;
    return {included:s.included,totalSource:s.totalSource,leftOut:s.totalSource-s.included};
  }
  // The third argument is optional so the two-argument callers in the test
  // suite keep working. chain.outside was computed and never consulted, which
  // is how a file with records removed from it printed VERIFIED.
  function verificationState(perRecord,chain,extra){
    if(!chain.ok||perRecord.some(function(r){return !r.ok;})) return 'failed';
    if(perRecord.some(function(r){return r.unverified;})) return 'partial';
    if(perRecord.some(function(r){return r.carriedKey;})) return 'partial';
    if(chain.branches>0||chain.restarts>0) return 'partial';
    // Nothing signed says whether a restore or a rewrite with the same key made
    // a line the record did not keep, and a report's selection does not explain it.
    if(chain.setAside>0) return 'partial';
    if(chain.outside>0){
      var sel=extra&&extra.selection;
      if(!sel||chain.outside>sel.leftOut) return 'partial';
    }
    if(extra&&extra.anchors&&(extra.anchors.notInFile>0||extra.anchors.beyondTail>0)) return 'partial';
    // The arithmetic that proves records are missing was computed and never
    // consulted. coverageFromRecords counts the positions absent before the
    // first record it holds and the holes inside, and a file starting at
    // position 500 could still read VERIFIED — the chain walk cannot see it,
    // because a missing head leaves nothing pointing at it and a missing run
    // leaves each surviving link still resolving.
    //
    // A filtered report is allowed to have holes: applyExportGate drops passed
    // records on purpose and the selection says so under signature. So this
    // reads exactly as chain.outside does — a gap a stated selection accounts
    // for is not a gap in what the file claims to be.
    if(extra&&extra.coverage&&(extra.coverage.missingBefore>0||extra.coverage.gapsInside>0)){
      var csel=extra&&extra.selection;
      var absent=extra.coverage.missingBefore+extra.coverage.gapsInside;
      if(!csel||absent>csel.leftOut) return 'partial';
    }
    return 'verified';
  }
  // The envelope's count of archived records the install could not read is under no digest, so it
  // is taken only when the manifest verified and the signed unreadableRows row begins with the same
  // number. It names why predecessors are missing and never makes a file read better than partial.
  function unreadableOf(data,manifestState){
    var n=data&&data.unreadableArchivedRows;
    if(manifestState!=='ok'||typeof n!=='number'||!(n>0)||n%1!==0) return 0;
    var row=provRow(readProvenanceRows(),'unreadableRows');
    var lead=row===null?null:/^[0-9]+/.exec(row);
    return lead&&Number(lead[0])===n?n:0;
  }
  function chainNotes(chain,i18n,sel,unreadable){
    var notes=[];
    var lines=chain.setAsideLines||[];
    for(var sl=0;sl<lines.length;sl++){
      notes.push(i18n.chainNoteSetAside.replace('{n}',String(lines[sl].n)).replace('{position}',lines[sl].position>=0?String(lines[sl].position):'?'));
    }
    var seams=(chain.branches||0)+(chain.restarts||0);
    if(seams>0) notes.push(i18n.chainNoteSeams.replace('{n}',String(seams)));
    if(chain.unattributed>0) notes.push(i18n.chainNoteUnattributed.replace('{n}',String(chain.unattributed)));
    if(chain.outside>0){
      if(sel&&chain.outside<=sel.leftOut&&i18n.chainNoteOutsideStated){
        notes.push(i18n.chainNoteOutsideStated.replace('{n}',String(chain.outside)).replace('{x}',String(sel.included)).replace('{y}',String(sel.totalSource)));
      }else if(unreadable>0&&chain.outside<=unreadable&&i18n.chainNoteOutsideUnreadable){
        notes.push(i18n.chainNoteOutsideUnreadable.replace('{n}',String(chain.outside)).replace('{u}',String(unreadable)));
      }else{
        notes.push(i18n.chainNoteOutside.replace('{n}',String(chain.outside)));
      }
    }
    // A file made before these notes existed carries no words for them and prints neither.
    if(chain.keyChangesStated>0&&i18n.chainNoteKeyStated) notes.push(i18n.chainNoteKeyStated.replace('{n}',String(chain.keyChangesStated)));
    if(chain.keyChangesUnstated>0&&i18n.chainNoteKeyUnstated) notes.push(i18n.chainNoteKeyUnstated.replace('{n}',String(chain.keyChangesUnstated)));
    return notes;
  }
  // The signed manifest (evidence-gap register item 6). At export time the
  // install signs a digest over the envelope's records, anchors, keys, labels
  // and wording; here the same digests are recomputed from what the file
  // actually carries and the signature is checked under the file's own key.
  // The canonical form is a fixed-order array; attachSignedManifest in
  // html-export.ts builds the identical string.
  function manifestCanonical(m){return JSON.stringify([m.version,m.recordCount,m.recordsDigest,m.anchorsDigest,m.publicKeysDigest,m.techLabelsDigest,m.i18nDigest,m.publicKeyFingerprint,m.generatedAt,m.envelopeDigest,m.provenanceDigest]);}
  function nz(v){return v===undefined||v===null?null:v;}
  // Every row of the page that carries data-fw-prov, as [name,text] pairs
  // sorted by name. The set is whatever the FILE marks, never a list written
  // here, and that is what lets the builder widen what it marks without
  // breaking a file already in somebody's hands: a file exported before the
  // widening carries its own rows and this recomputes exactly those.
  //
  // dt joined dd and p on 2026-09-18, when the labels came under the digest. A
  // browser gives this one for free; the node checker has no DOM and reads the
  // HTML with a pattern, and the three implementations of this one rule are the
  // standing hazard here, checked against each other in
  // tests/unit/forensics/provenance-rule-agrees.test.ts.
  function readProvenanceRows(){
    var nodes=document.querySelectorAll('dt[data-fw-prov],dd[data-fw-prov],p[data-fw-prov]');
    var out=[];
    for(var i=0;i<nodes.length;i++){
      out.push([nodes[i].getAttribute('data-fw-prov'),(nodes[i].textContent||'').replace(/\s+/g,' ').trim()]);
    }
    out.sort(function(a,b){return a[0]<b[0]?-1:a[0]>b[0]?1:0;});
    return out;
  }
  // The names of the rows this file marks, for the report. The set is a fact
  // about the FILE, not about the checker: an older file marks fewer, and a
  // recipient is entitled to know which of the page's statements the signature
  // covered rather than being told only that it matched. landing/check.html
  // promised this sentence before anything produced it (2026-09-18).
  function provenanceRowNames(){
    var out=[];
    var nodes=readProvenanceRows();
    for(var i=0;i<nodes.length;i++) out.push(nodes[i][0]);
    return out;
  }
  function provRow(rows,name){
    for(var i=0;i<rows.length;i++) if(rows[i][0]===name) return rows[i][1];
    return null;
  }
  // The envelope's profile block against the page rows that were rendered from
  // it. profile is the one envelope key no digest covers: envelopeCanonical was
  // fixed before it existed and cannot take it now without refusing every file
  // signed under the old order. So the copy that IS signed decides. The rendered
  // "made by" and "machine" rows are under provenanceDigest, checked one line
  // above this, and a profile that disagrees with them is a maker's name that
  // was put into the file after the key signed it.
  //
  // Measured on 2026-09-18: a profile block invented wholesale in a file whose
  // page names no maker read VERIFIED, manifest ok, exit 0.
  //
  // The name is compared exactly, as the opening of the row (the row goes on to
  // say that the name is one the maker chose). The machine facts are compared as
  // the comma line the page prints, and only when at least one of them is
  // stated: with all four absent the page prints a sentence in the file's own
  // language, which this cannot reconstruct and must not guess at.
  function profileAgrees(prof,rows){
    if(!prof||typeof prof!=='object') return true;
    var made=provRow(rows,'madeBy');
    var name=typeof prof.name==='string'?prof.name.replace(/\s+/g,' ').trim():'';
    if(name){ if(made===null||made.indexOf(name)!==0) return false; }
    else if(made!==null) return false;
    var machine=provRow(rows,'machine');
    if(machine===null) return false;
    var facts=[];
    var f=[prof.platform,prof.browser,prof.language,prof.timeZone];
    for(var i=0;i<f.length;i++) if(typeof f[i]==='string'&&f[i]) facts.push(f[i]);
    if(facts.length>0&&machine!==facts.join(', ')) return false;
    return true;
  }
  function envelopeCanonical(d){return JSON.stringify([nz(d.selection),nz(d.keyGenesis),nz(d.keyOrigins),nz(d.signingKeyCreatedAt),nz(d.precisionDisclosure),nz(d.fwVersion),nz(d.locale),nz(d.publicKeyJwk)]);}
  async function checkManifest(data,pubKey,fingerprint){
    var m=data.manifest;
    if(!m||typeof m!=='object') return 'missing';
    if(m.version===1) return 'legacy';
    if(m.version!==2) return 'version';
    if(m.publicKeyFingerprint!==fingerprint) return 'key';
    if(m.recordCount!==(data.records||[]).length) return 'records';
    if(m.recordsDigest!==await sha256(JSON.stringify(data.records||[]))) return 'records';
    if(m.anchorsDigest!==await sha256(JSON.stringify(data.anchors||[]))) return 'anchors';
    if(m.publicKeysDigest!==await sha256(JSON.stringify(data.publicKeys||[]))) return 'keys';
    if(m.techLabelsDigest!==await sha256(JSON.stringify(data.techLabels||{}))) return 'labels';
    if(m.i18nDigest!==await sha256(JSON.stringify(data.i18n||{}))) return 'wording';
    if(m.envelopeDigest!==await sha256(envelopeCanonical(data))) return 'envelope';
    // The rows a reader reads live in the HTML. A bare JSON envelope has none —
    // and that input form is advertised by this checker's own usage line, by
    // index.html and by FORMAT.md, which says outright that a bare envelope
    // "cannot fully verify". It was reading BROKEN (manifest: summary-rows),
    // because a digest over zero rows can never equal a digest over the page's
    // rows. Telling a recipient a good file is broken is the worst false alarm
    // this checker can raise, so the comparison is reported as not made rather
    // than failed. The real browser document never carries this flag, so the
    // in-page verifier is unaffected.
    // The manifest's own digest and its signature are checked BEFORE the bare
    // envelope is allowed to decline the row comparison (2026-09-19). They used
    // to sit after the early return, which meant a bare JSON envelope was never
    // signature-checked at all while the report still called the manifest
    // checked. Every digest above is computed from the file's own data, so a
    // file edited and recomputed is self-consistent: the signature is the only
    // thing binding this manifest to the key that signed it, and skipping it
    // made "remove some records and recompute" a clean pass on the one input
    // form this checker's usage line advertises.
    if(m.digest!==await sha256(manifestCanonical(m))) return 'digest';
    var okSig=false;
    try{
      okSig=await crypto.subtle.verify({name:'ECDSA',hash:{name:'SHA-256'}},pubKey,b64uToBytes(m.signature),new TextEncoder().encode(m.digest));
    }catch(_e){okSig=false;}
    if(!okSig) return 'signature';
    if(document&&document.fwNoHtml===true) return 'no-rows';
    var provRows=readProvenanceRows();
    if(m.provenanceDigest!==await sha256(JSON.stringify(provRows))) return 'page-rows';
    // Only once the rows above are known to be the signed ones.
    if(!profileAgrees(data.profile,provRows)) return 'profile';
    return 'ok';
  }
export { verifyChain, chainNotes };
