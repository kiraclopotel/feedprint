// The exported page's stylesheet, as source text.
//
// Cut out of src/forensics/html-export.ts on 2026-09-16 (PLAN-2026-09-16 item 10.1). The builder
// imports it back, so the page is byte-identical.

export const STYLES = `
:root{
  --bg:#ffffff;--text:#1a1a1a;--text2:#2a2a2a;--muted:#6a6a6a;
  --border:#e4e4e8;--border-2:#d3d3d9;--soft:#f6f6f8;
  --teal:#0288a3;--green:#2e7d32;--red:#c62828;--amber:#c46900;
}
*{box-sizing:border-box;}
body{font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;
  max-width:980px;margin:0 auto;padding:2.25rem 1rem 4rem;color:var(--text);
  background:var(--bg);line-height:1.55;font-size:15px;-webkit-font-smoothing:antialiased;}
h1{font-size:1.5rem;font-weight:600;letter-spacing:-.01em;margin:0 0 .25rem;}
h2{font-size:1.2rem;font-weight:600;margin:2rem 0 .5rem;}
h3{font-size:var(--t4);font-weight:600;margin:1rem 0 .4rem;}
p{margin:.5rem 0;}
code{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:.85em;}
.fw-meta{color:var(--muted);font-size:var(--t3);margin-bottom:1.25rem;}
/* brand lockup — the marker dot is the mark (design system: "the dot is the logo") */
.fw-brandrow{display:flex;align-items:center;gap:.5rem;margin-bottom:.75rem;}
.fw-brand-dot{width:11px;height:11px;border-radius:50%;background:var(--teal);box-shadow:0 0 0 3px rgba(2,136,163,.15);flex:0 0 auto;}
.fw-brand-word{font-weight:600;font-size:var(--t3);letter-spacing:-.01em;color:var(--text);}
/* verify action — hoisted above the feed so the recipient can verify first */
.fw-verify-block{margin:1.25rem 0 1.75rem;padding-top:.25rem;}
.fw-summary{border:1px solid var(--border);border-radius:8px;padding:1rem 1.1rem;margin:1rem 0;background:var(--soft);}
.fw-summary dl{display:grid;grid-template-columns:minmax(0,13rem) minmax(0,1fr);gap:12px 24px;margin:0;}
.fw-summary dt{font-weight:600;color:var(--text2);}
.fw-summary .fw-full{grid-column:1/-1;}
.fw-summary dd.fw-full{margin:0;}
.fw-summary dd,.fw-anchor dd,.fw-methodology dd{margin:0;}
.fw-coverage-note{display:block;font-size:var(--t3);line-height:1.45;margin-top:.2rem;color:var(--muted);}
.fw-conditions-note{display:block;font-size:var(--t3);line-height:1.45;margin-top:.2rem;color:var(--muted);}
.fw-stamp-note{display:block;font-size:var(--t3);line-height:1.45;margin-top:.2rem;color:var(--muted);}
.fw-epochs{border-collapse:collapse;font-size:var(--t3);margin:.2rem 0 .4rem;max-width:100%;}
.fw-epochs th,.fw-epochs td{border:1px solid var(--border);padding:.25rem .5rem;text-align:left;vertical-align:top;}
.fw-epochs th{font-weight:600;color:var(--text2);}
.fw-epochs code{font-size:.85em;}
.fw-disclaimer{border-left:3px solid var(--border-2);padding:.65rem 1rem;margin:1rem 0;background:var(--soft);border-radius:0 6px 6px 0;font-size:var(--t3);color:var(--text2);}
button#fw-verify-btn{font-size:var(--t4);font-weight:500;padding:.7rem 1.2rem;border:1px solid var(--text);
  background:var(--text);color:#fff;border-radius:6px;cursor:pointer;margin-top:1rem;}
button#fw-verify-btn:hover{background:#000;}
button#fw-verify-btn:disabled{opacity:.55;cursor:not-allowed;}
.fw-chain-summary{border:1px solid;border-radius:8px;padding:1rem 1.1rem;margin:1rem 0;}
.fw-chain-summary.fw-pass{border-color:#bcd9bc;background:#f1f7f1;}
.fw-chain-summary.fw-warn{border-color:#e4cf9b;background:#fff8e8;}
.fw-chain-summary.fw-fail{border-color:#e4bcbc;background:#fbf1f1;}
.fw-record{border:1px solid var(--border);border-radius:8px;padding:.35rem .8rem;margin:.25rem 0;}
.fw-record>summary{cursor:pointer;font-size:var(--t3);}
.fw-results-tally{font-weight:600;}
.fw-record.fw-pass{border-left:3px solid var(--green);}
.fw-record.fw-warn{border-left:3px solid var(--amber);}
.fw-record.fw-fail{border-left:3px solid var(--red);}
.fw-record blockquote{border-left:3px solid var(--border-2);padding-left:.75rem;color:var(--text2);margin:.5rem 0;}
.fw-fail-reason{color:var(--red);font-weight:500;}
.fw-anchors{border:1px solid #cdd6e2;border-radius:8px;padding:1rem 1.1rem;margin:1rem 0;background:#f6f8fb;}
.fw-anchors h2{margin-top:0;}
.fw-anchors-intro{font-size:var(--t3);color:var(--text2);}
.fw-anchor{border:1px solid #dbe1ea;border-radius:6px;padding:.65rem .85rem;margin:.5rem 0;background:#fff;}
.fw-anchor dl{display:grid;grid-template-columns:minmax(0,13rem) minmax(0,1fr);gap:12px 24px;margin:0;font-size:var(--t3);}
.fw-anchor dt{font-weight:600;color:var(--text2);}
.fw-completeness{border:1px solid var(--border);border-radius:10px;padding:.9rem 1.1rem;margin:1rem 0;}
.fw-completeness h3{margin:0 0 .5rem;font-size:var(--t4);}
.fw-completeness p{margin:.25rem 0;font-size:var(--t3);}
.fw-completeness-hit{font-weight:600;}
.fw-completeness-note{color:var(--text2);font-size:var(--t3);margin-top:.6rem;}
.fw-manual-badge{display:inline-block;margin:.35rem 0;padding:.15rem .5rem;border:1px solid var(--warn);border-radius:999px;font-size:var(--t2);font-weight:600;color:var(--warn);background:var(--lift);}
.fw-keygen-headline{font-weight:600;margin:.4rem 0;}
.fw-anchor-check{margin-top:.6rem;padding-top:.5rem;border-top:1px dashed #dbe1ea;}
.fw-anchor-check-line{margin:.2rem 0;font-size:var(--t3);}
.fw-anchor-check .section-label{font-size:var(--t3);font-weight:600;color:var(--text2);margin-bottom:.2rem;}
.fw-anchor-checks{margin:.35rem 0 0;padding-left:0;font-size:var(--t3);list-style:none;}
.fw-anchor-checks li{margin:.1rem 0;}
.fw-anchor-ok{color:var(--ok);}
.fw-anchor-bad{color:var(--danger);font-weight:600;}
.fw-anchor-warn{color:var(--warn);font-weight:600;}
.fw-anchor-fp{display:block;word-break:break-all;font-size:var(--t2);color:var(--text2);}
.fw-anchor-tst{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:var(--t2);word-break:break-all;background:var(--well);padding:.4rem .55rem;border-radius:4px;color:var(--text2);margin-top:.3rem;max-height:5.5em;overflow:auto;}

/* ── Methodology (criteria & AI instructions) ── */
.fw-methodology{border:1px solid var(--border);border-radius:8px;padding:.75rem 1.1rem;margin:1.25rem 0;background:var(--soft);}
.fw-methodology>summary{font-weight:600;cursor:pointer;}
.fw-methodology dl{display:grid;grid-template-columns:minmax(0,13rem) minmax(0,1fr);gap:12px 24px;margin:.4rem 0;font-size:var(--t3);}
.fw-methodology dt{font-weight:600;color:var(--text2);}
.fw-mth-floors{border-collapse:collapse;width:100%;max-width:34rem;margin:.6rem 0;font-size:var(--t3);}
.fw-mth-floors caption{caption-side:top;text-align:left;color:var(--mut);padding:0 0 .4rem;}
.fw-mth-floors th,.fw-mth-floors td{text-align:left;padding:.25rem 1.5rem .25rem 0;border-bottom:1px solid var(--line);}
.fw-mth-floors th{color:var(--mut);font-weight:500;}
.fw-mth-prompt{border:1px solid #dbe1ea;border-radius:6px;padding:.4rem .7rem;margin:.4rem 0;background:#fff;}
.fw-mth-prompt summary{cursor:pointer;font-size:var(--t3);}
.fw-mth-prompt pre{white-space:pre-wrap;font-size:var(--t1);line-height:1.45;background:var(--well);padding:.5rem .65rem;border-radius:4px;color:var(--text2);max-height:24em;overflow:auto;}

/* ── Observed exposure summary ── */
.fw-exposure{border:1px solid var(--border);border-radius:8px;padding:1rem 1.1rem;margin:1.25rem 0;background:var(--soft);}
.fw-exposure h2{margin-top:0;}
.fw-exposure-intro{font-size:var(--t3);color:var(--text2);}
.fw-exp-glance{display:flex;flex-wrap:wrap;gap:12px;margin:.75rem 0 1rem;}
.fw-exp-stat{flex:1 1 0;min-width:180px;border:1px solid var(--border);border-radius:8px;padding:.6rem .8rem;background:#fff;}
.fw-exp-stat b{display:block;font-size:1.6rem;font-weight:600;line-height:1.1;color:var(--text);letter-spacing:-.02em;}
.fw-exp-stat span{font-size:var(--t2);color:var(--muted);}
.fw-exp-barlist{margin:.4rem 0 .9rem;}
.fw-exp-barlist + .fw-bar-whole{margin:-.6rem 0 .9rem;}
.fw-exp-barrow{display:flex;align-items:center;gap:.6rem;margin:.3rem 0;font-size:var(--t3);}
.fw-exp-barlabel{flex:0 0 min(11rem,40%);color:var(--text2);display:flex;align-items:center;gap:.4rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.fw-exp-bartrack{flex:1;height:7px;background:var(--well);border-left:1px solid var(--ink);border-radius:0 4px 4px 0;overflow:hidden;}
.fw-exp-barfill{height:100%;border-radius:0 4px 4px 0;}
.fw-exp-barnum{flex:0 0 auto;color:var(--muted);text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap;}

/* ── Feed behavior (five levels + reader lenses) ── */
.fw-behavior{margin:2rem 0;}
.fwb-intro{font-size:var(--t3);color:var(--text2);}
.fwb-legend{display:flex;gap:1rem;flex-wrap:wrap;font-size:var(--t2);color:var(--muted);margin:.4rem 0 .8rem;}
.fwb-legend .k{display:inline-flex;align-items:center;gap:.35rem;}
.fwb-sw{width:10px;height:10px;border-radius:3px;border:1px solid var(--border-2);display:inline-block;}
.fwb-sw.fact{background:#fff;}
.fwb-sw.interp{background:#fff4e2;border-color:var(--amber);}
.fwb-lensbar{display:flex;gap:.4rem;flex-wrap:wrap;margin:0 0 1rem;}
.fwb-lens{border:1px solid var(--border);background:#fff;color:var(--text2);border-radius:999px;font-size:var(--t2);padding:.3rem .85rem;cursor:pointer;font-family:inherit;}
.fwb-lens.active{border-color:var(--teal);color:var(--teal);font-weight:600;}
.fwb-lens-note{font-size:var(--t2);color:var(--muted);align-self:center;}
.fwb-card{border:1px solid var(--border);border-radius:10px;padding:.9rem 1rem;margin:.8rem 0;background:#fff;}
.fwb-card.interp{background:#fff8ec;border-color:var(--amber);}
.fwb-eyebrow{font-size:var(--t1);font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin:0 0 .35rem;display:flex;align-items:center;gap:.5rem;flex-wrap:wrap;}
.fwb-lvl{display:inline-flex;align-items:center;justify-content:center;min-width:40px;height:18px;border-radius:4px;background:var(--soft);border:1px solid var(--border-2);font-size:var(--t1);font-weight:700;letter-spacing:.06em;color:var(--muted);padding:0 6px;}
.fwb-sub{font-size:var(--t2);color:var(--muted);margin:0 0 .7rem;}
.fwb-stat{font-size:1.15rem;font-weight:700;letter-spacing:-.01em;margin:.2rem 0;}
.fwb-stat .hi{color:var(--red);}
.fwb-note{font-size:var(--t2);color:var(--muted);}
.fwb-prov{font-size:var(--t1);color:var(--muted);margin-top:.55rem;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;}
.fwb-cap{font-size:var(--t3);color:var(--text2);margin-top:.6rem;padding:.5rem .65rem;border-left:2px solid var(--teal);background:var(--well);border-radius:0 6px 6px 0;}
.fwb-skewrow{display:grid;grid-template-columns:110px 1fr 130px;gap:.6rem;align-items:center;padding:.25rem 0;font-size:var(--t2);}
.fwb-skewtrack{display:block;height:10px;border-radius:5px;background:var(--well);overflow:hidden;}
.fwb-skewfill{display:block;height:100%;border-radius:5px;background:var(--amber);min-width:2px;}
.fwb-skewnum{color:var(--muted);font-variant-numeric:tabular-nums;}
.fwb-segbar{display:flex;height:12px;border-radius:6px;overflow:hidden;gap:2px;background:var(--well);margin:.5rem 0;}
.fwb-seg{height:100%;display:inline-block;}
.fwb-seglegend{display:flex;gap:.9rem;flex-wrap:wrap;font-size:var(--t2);color:var(--text2);}
.fwb-swd{width:9px;height:9px;border-radius:3px;display:inline-block;margin-right:4px;}
table.fwb-table{width:100%;border-collapse:collapse;font-size:var(--t2);}
table.fwb-table th{text-align:left;font-size:var(--t1);text-transform:uppercase;letter-spacing:.05em;color:var(--muted);font-weight:600;padding:.25rem .5rem .25rem 0;border-bottom:1px solid var(--border);}
table.fwb-table td{padding:.35rem .5rem .35rem 0;border-bottom:1px solid var(--border);vertical-align:top;overflow-wrap:anywhere;}
table.fwb-table tr:last-child td{border-bottom:none;}
table.fwb-table td.num{font-variant-numeric:tabular-nums;color:var(--text2);white-space:nowrap;}
.fwb-chainrow{display:flex;align-items:center;gap:.5rem;padding:.3rem 0;border-bottom:1px solid var(--border);font-size:var(--t2);flex-wrap:wrap;}
.fwb-chainrow:last-child{border-bottom:none;}
.fwb-chip{display:inline-flex;align-items:center;font-size:var(--t2);font-weight:600;border-radius:4px;padding:.1rem .5rem;background:var(--soft);border:1px solid var(--border-2);color:var(--text2);}
.fwb-chip.adv{color:var(--amber);border-color:var(--amber);background:#fff;}
.fwb-arrow{color:var(--muted);font-size:var(--t2);}
.fwb-chainbar{height:6px;border-radius:3px;background:var(--amber);display:inline-block;}
.fwb-chainn{margin-left:auto;font-size:var(--t2);color:var(--muted);font-variant-numeric:tabular-nums;white-space:nowrap;}
.fwb-cauttag{display:inline-block;font-size:var(--t1);font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--amber);border:1px solid var(--amber);border-radius:3px;padding:0 5px;}
.fwb-cautitem{display:flex;gap:.6rem;padding:.45rem 0;border-top:1px solid #f0dcbb;font-size:var(--t3);}
.fwb-cautitem:first-of-type{border-top:none;}
.fwb-cautn{flex:none;width:18px;height:18px;border-radius:50%;background:var(--amber);color:#fff;font-size:var(--t1);font-weight:700;display:flex;align-items:center;justify-content:center;margin-top:2px;}
.fwb-cautev{color:var(--muted);font-size:var(--t2);}
.fwb-pred{margin-top:.7rem;padding:.55rem .7rem;border:1px dashed var(--amber);border-radius:8px;font-size:var(--t2);}
.fwb-predtag{font-size:var(--t1);font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--amber);margin-right:6px;}
.fwb-mono{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:var(--t1);}

/* ── Feed view ── */
.fw-feed{margin:2rem 0;}
.fw-feed-intro{color:var(--text2);font-size:var(--t3);margin-bottom:1.25rem;}
.fw-feed-opinion-head{font-size:var(--t4);font-weight:700;letter-spacing:-.01em;margin:1.5rem 0 .25rem;}
.fw-feed-more{display:block;margin:1rem 0 2rem;padding:.6rem 1rem;font:inherit;font-size:var(--t3);color:var(--text);background:var(--surface2,#f3f3f3);border:1px solid var(--border,#ccc);border-radius:8px;cursor:pointer;}
/* the reading mode: marks, filters, numbers, blur */
.fw-reading{margin:1.5rem 0 1rem;}
.fw-num{font:inherit;background:none;border:0;padding:.1rem .3rem;border-radius:4px;color:inherit;cursor:pointer;text-decoration:underline dotted;}
.fw-num[aria-pressed="true"]{background:var(--text,#222);color:var(--bg,#fff);text-decoration:none;}
.fw-exp-barrow-link{cursor:pointer;}
.fw-exp-barrow-link:hover,.fw-exp-barrow-link:focus{outline:1px dotted var(--border-2,#999);}
.fw-reading-sentence{font-size:var(--t4);font-weight:500;margin:.4rem 0 .6rem;}
.fw-what-this-does{margin-top:.6rem;}
.fw-marks{display:flex;flex-wrap:wrap;gap:.5rem;margin:.75rem 0;}
.fw-mark{display:inline-flex;align-items:center;gap:.45rem;border:1px solid var(--border-2);border-radius:999px;
  background:var(--bg);color:var(--text);font:inherit;font-size:var(--t3);padding:.4rem .9rem;cursor:pointer;}
.fw-mark:hover{background:var(--soft);}
.fw-mark[aria-pressed="true"]{background:var(--text);color:var(--bg);border-color:var(--text);}
.fw-mark-dot{width:.7rem;height:.7rem;border-radius:50%;display:inline-block;}
.fw-filters{display:flex;flex-wrap:wrap;gap:.75rem 1.25rem;margin:.5rem 0;font-size:var(--t3);color:var(--text2);}
.fw-filter select{font:inherit;font-size:var(--t3);padding:.2rem .4rem;border:1px solid var(--border-2);border-radius:6px;background:var(--bg);color:var(--text);}
.fw-blur-toggle{display:block;font-size:var(--t3);color:var(--text2);margin:.4rem 0 .8rem;}
.fw-numbers{border-collapse:collapse;width:100%;font-size:var(--t3);margin:.75rem 0 .35rem;}
.fw-numbers th,.fw-numbers td{border-bottom:1px solid var(--border);padding:.4rem .5rem;text-align:right;}
.fw-numbers th:first-child,.fw-numbers td:first-child{text-align:left;}
.fw-numbers thead th{font-weight:600;color:var(--muted);font-size:var(--t2);}
.fw-numbers tbody th{font-weight:500;}
.fw-numbers-total th,.fw-numbers-total td{font-weight:600;border-top:2px solid var(--border-2);}
.fw-numbers-note,.fw-matching{margin:.2rem 0;}
/* blur authors: a screenshot aid, nothing else; the names stay in the record */
.fw-blur-authors .fw-item-author,.fw-blur-authors .fw-avatar,.fw-blur-authors .fw-person-name,.fw-blur-authors .fw-recon-title{
  filter:blur(6px);user-select:none;-webkit-user-select:none;}
.fw-interpretation{margin:1.5rem 0;border:1px solid var(--border);border-radius:8px;padding:.5rem .9rem;}
.fw-interpretation>summary{cursor:pointer;font-weight:600;}
.fw-glance{display:flex;flex-wrap:wrap;gap:12px;margin:1rem 0 1.25rem;}
.fw-stat{flex:1 1 0;min-width:96px;border:1px solid var(--border);border-radius:8px;padding:.65rem .85rem;background:var(--soft);}
.fw-stat b{display:block;font-size:1.6rem;font-weight:600;line-height:1.1;color:var(--text);letter-spacing:-.02em;}
.fw-stat span{font-size:var(--t2);color:var(--muted);}
.fw-barlist{margin:.6rem 0 1rem;}
.fw-bar-whole{margin:-.55rem 0 1rem;font-size:var(--t2);color:var(--mut);}
.fw-barrow{display:flex;align-items:center;gap:.6rem;margin:.3rem 0;font-size:var(--t3);}
.fw-barrow .fw-barlabel{flex:0 0 min(11rem,44%);color:var(--text2);display:flex;align-items:center;gap:.4rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.fw-barrow .fw-bartrack{flex:1;height:7px;background:var(--well);border-left:1px solid var(--ink);border-radius:0 4px 4px 0;overflow:hidden;}
.fw-barrow .fw-barfill{height:100%;border-radius:0 4px 4px 0;}
.fw-barrow .fw-barnum{flex:0 0 auto;color:var(--muted);min-width:1.8rem;text-align:right;font-variant-numeric:tabular-nums;}
.fw-people{border:1px solid var(--border);border-radius:8px;padding:.85rem 1rem;margin:1rem 0 1.5rem;background:var(--soft);}
.fw-people h3{margin-top:0;}
.fw-people-note{font-size:var(--t2);color:var(--muted);margin:.2rem 0 .6rem;}
.fw-person{display:flex;justify-content:space-between;gap:.5rem;padding:.35rem 0;border-top:1px solid var(--border);font-size:var(--t3);}
.fw-person:first-of-type{border-top:none;}
.fw-person-name{font-weight:600;color:var(--text);overflow-wrap:anywhere;}
.fw-person-count{color:var(--muted);white-space:nowrap;}

/* item card — post vs comment vs reply made unmistakable */
.fw-item{border:1px solid var(--border);border-left-width:3px;border-radius:10px;
  padding:.85rem 1rem;margin:.85rem 0;background:#fff;box-shadow:0 1px 2px rgba(20,20,20,.04);}
.fw-item-comment{background:var(--soft);border-radius:9px;}
.fw-item-reply{background:var(--soft);border-radius:8px;}
.fw-item-head{display:flex;align-items:flex-start;gap:.6rem;}
.fw-avatar{flex:0 0 auto;display:flex;align-items:center;justify-content:center;border-radius:50%;
  background:#e8ecef;color:#55606a;font-weight:600;width:40px;height:40px;font-size:var(--t4);
  box-shadow:inset 0 0 0 2px #d4dade;}
.fw-avatar-comment{width:32px;height:32px;font-size:var(--t3);box-shadow:inset 0 0 0 2px #dadfe3;}
.fw-avatar-reply{width:28px;height:28px;font-size:var(--t2);box-shadow:inset 0 0 0 2px #dee2e6;}
.fw-item-meta{flex:1;min-width:0;}
.fw-item-line1{display:flex;flex-wrap:wrap;align-items:center;gap:.45rem;}
.fw-item-author{font-weight:600;color:var(--text);font-size:var(--t4);overflow-wrap:anywhere;}
.fw-item-comment .fw-item-author,.fw-item-reply .fw-item-author{font-size:var(--t3);}
.fw-kind{font-size:var(--t1);font-weight:600;text-transform:uppercase;letter-spacing:.05em;
  color:#55606a;background:#eceef1;border-radius:999px;padding:.08rem .5rem;}
.fw-kind-post{color:#0d7a8c;background:#e0f2f5;}
.fw-item-line2{display:flex;flex-wrap:wrap;align-items:baseline;gap:.4rem .6rem;margin-top:.15rem;
  font-size:var(--t2);color:var(--muted);}
.fw-item-time{color:var(--muted);font-variant-numeric:tabular-nums;}
.fw-item-serial{color:var(--muted);border:1px solid var(--line,#ccc);border-radius:4px;padding:0 4px;font-size:var(--t2);font-variant-numeric:tabular-nums;line-height:1.3;}
.fw-item-text{margin:.55rem 0 .35rem;color:var(--text);font-size:var(--t4);line-height:1.55;white-space:pre-wrap;overflow-wrap:anywhere;}
.fw-item-comment .fw-item-text,.fw-item-reply .fw-item-text{font-size:var(--t3);}
.fw-text-capture{font-size:var(--t2);color:var(--mut);margin:.2rem 0 .1rem;line-height:1.45;}

/* engagement-metrics row */
.fw-metrics{display:flex;flex-wrap:wrap;gap:.2rem 1.1rem;margin:.45rem 0 .15rem;
  color:var(--muted);font-size:var(--t2);font-variant-numeric:tabular-nums;}
.fw-metric{white-space:nowrap;}

/* classification tags */
.fw-tags{display:flex;flex-wrap:wrap;gap:.3rem;margin:.45rem 0 .15rem;}
.fw-tag{display:inline-flex;align-items:center;gap:.35rem;font-size:var(--t2);color:var(--text2);
  background:var(--well);border-radius:999px;padding:.12rem .55rem;}
.fw-dot{display:inline-block;width:8px;height:8px;border-radius:50%;flex:0 0 auto;}
/* The person's own rule is a diamond in the ink, not a purple dot: its purple sat next to the technique violet and was dim on the dark page. */
.fw-dot-rule{background:var(--ink);border-radius:0;transform:rotate(45deg) scale(.82);}

/* softened wording + rewrite BETA */
.fw-softened{display:flex;flex-wrap:wrap;align-items:center;gap:.4rem .6rem;margin:.4rem 0 .2rem;font-size:var(--t2);}
.fw-softened-label{color:var(--green);}
.fw-beta{font-size:var(--t1);color:var(--amber);background:color-mix(in oklab,var(--warn) 10%,var(--lift));border:1px solid color-mix(in oklab,var(--warn) 35%,var(--line));
  border-radius:999px;padding:.08rem .5rem;}
.fw-orig-details{margin:.25rem 0;}
.fw-orig-details summary{cursor:pointer;color:var(--muted);font-size:var(--t2);padding:3px 0;}
.fw-orig{color:var(--text2);border-left:3px solid var(--border-2);padding-left:.65rem;margin:.35rem 0;font-size:var(--t3);white-space:pre-wrap;overflow-wrap:anywhere;}

/* source link + scannable QR */
.fw-source{display:flex;flex-wrap:wrap;align-items:baseline;gap:.4rem 1rem;margin:.45rem 0 .15rem;font-size:var(--t2);}
.fw-source-link{color:var(--teal);text-decoration:none;}
.fw-source-link:hover{text-decoration:underline;}
.fw-qr{font-size:var(--t2);}
.fw-qr summary{cursor:pointer;color:var(--muted);padding:3px 0;}
.fw-qr summary:hover,.fw-orig-details summary:hover{color:var(--ink);text-decoration:underline;text-underline-offset:3px;}
.fw-qr-holder{margin:.5rem 0;padding:.6rem;display:inline-block;background:#fff;color:#1a1a1a;border:1px solid var(--border);border-radius:8px;}
.fw-qr-holder svg{display:block;}
.fw-qr-url{margin-top:.4rem;max-width:176px;font-size:var(--t1);color:#55565a;word-break:break-all;}

/* popularity over time */
.fw-pop{margin:.5rem 0 .15rem;padding:.55rem .7rem;border:1px solid var(--border);border-radius:8px;background:var(--soft);}
.fw-pop-head{font-size:var(--t1);font-weight:600;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);}
.fw-pop-meta{font-size:var(--t2);color:var(--text2);margin:.18rem 0;}
.fw-pop-row{display:flex;align-items:center;gap:.65rem;flex-wrap:wrap;margin:.25rem 0;}
.fw-spark{display:block;}
.fw-pop-delta{font-size:var(--t3);color:var(--text);font-variant-numeric:tabular-nums;}
.fw-pop-note{font-size:var(--t1);color:var(--muted);margin-top:.2rem;}

/* thread nesting — treeline connectors: per-child vertical trunk + curved
   elbow into each reply, trunk stops at the last child's elbow */
.fw-children{margin:.5rem 0 0 1rem;padding-left:1rem;}
.fw-children>*{position:relative;}
.fw-children>*::before{content:'';position:absolute;left:-1rem;top:-.95rem;bottom:-.95rem;width:2px;background:var(--border);}
.fw-children>*::after{content:'';position:absolute;left:-1rem;top:-.95rem;width:.8rem;height:2.4rem;
  border-left:2px solid var(--border);border-bottom:2px solid var(--border);border-bottom-left-radius:.6rem;}
.fw-children>:last-child::before{content:none;}

/* comment-section room banner */
.fw-room{border:1px solid #cdd6e2;border-radius:8px;padding:.55rem .8rem;margin:.6rem 0;
  background:#f6f8fb;font-size:var(--t3);color:#37414f;}
.fw-counts{margin-top:.35rem;display:flex;flex-wrap:wrap;gap:.2rem 1rem;color:var(--muted);font-size:var(--t2);font-variant-numeric:tabular-nums;}

/* reconstructed grouping header — deliberately NOT styled like a signed
   record card (dashed, muted) so it reads as a grouping label, not evidence */
.fw-recon{border:1px dashed #b9c2d0;border-radius:8px;padding:.55rem .8rem;margin:1rem 0 .4rem;background:#fafbfd;}
.fw-recon-head{display:flex;flex-wrap:wrap;align-items:baseline;gap:.5rem;}
.fw-recon-badge{font-size:var(--t1);text-transform:uppercase;letter-spacing:.04em;color:var(--mut);
  border:1px solid var(--line);border-radius:4px;padding:.05rem .35rem;background:var(--well);}
.fw-recon-title{font-weight:600;color:#37414f;}
.fw-recon-cap{font-size:var(--t3);color:#37414f;margin-top:.25rem;}
.fw-recon-note{font-size:var(--t2);color:var(--muted);font-style:italic;margin-top:.3rem;}

/* misc notes + chain markers */
.fw-note-muted{font-size:var(--t2);color:var(--muted);font-style:italic;margin:.35rem 0;}
.fw-marker{text-align:center;color:var(--muted);font-size:var(--t2);letter-spacing:.02em;margin:1.1rem 0;}
.fw-feed-unchecked{border:1px solid #e4cf9b;background:#fff8e8;border-radius:8px;padding:.6rem .8rem;font-size:var(--t3);}
.fw-media-urls{font-size:var(--t2);color:var(--muted);margin:.3rem 0;word-break:break-all;}
.fw-withheld{font-style:italic;color:var(--muted);border-left:3px solid var(--border);padding:.3rem .6rem;margin:.4rem 0;}
.fw-item-standin{font-weight:600;margin:.4rem 0 .2rem;}
.fw-media-urls a{color:inherit;}
.fw-opinion{margin:.55rem 0 .2rem;padding:.45rem .6rem;border:1px dashed var(--border);border-radius:8px;background:var(--soft);}
.fw-opinion-head{font-size:var(--t1);letter-spacing:.03em;text-transform:uppercase;color:var(--muted);margin-bottom:.25rem;}
.fw-item-verdict{font-size:var(--t2);margin:.3rem 0 .1rem;color:var(--muted);}
.fw-item-verdict-pass{color:var(--green);}
.fw-item-verdict-warn{color:var(--amber);}
.fw-item-verdict-fail{color:var(--red);font-weight:600;}
.fw-item.fw-item-fail{outline:2px solid var(--red);outline-offset:-2px;}

/* The house system, last so it wins: the dashboard's ground and ink, one face, square corners, and a scheme that follows
   the reader's device. The old colour names point at the house tones, so every rule above keeps working. The face falls
   back to the system one: the file carries no font of its own and never loads one. */
:root{
  --ground:#eeeff1;--ink:#141518;--record:#4531c9;--ok:#246b2b;--warn:#8a4b00;--danger:#b3261e;
  --lift:color-mix(in oklab,var(--ground) 30%,white);
  --line:color-mix(in oklab,var(--ink) 18%,var(--ground));
  --edge:color-mix(in oklab,var(--ink) 48%,var(--ground));
  --mut:color-mix(in oklab,var(--ink) 66%,var(--ground));
  --bg:var(--ground);--text:var(--ink);--text2:var(--ink);--muted:var(--mut);
  --border:var(--line);--border-2:var(--edge);--soft:var(--lift);
  --teal:var(--ink);--green:var(--ok);--red:var(--danger);--amber:var(--warn);
  --well:color-mix(in oklab,var(--ink) 6%,var(--lift));
  --t1:.7rem;--t2:.8rem;--t3:.9rem;--t4:1rem;
  --sheet-shadow:0 1px 2px color-mix(in oklab,var(--ink) 10%,transparent),0 28px 56px -28px color-mix(in oklab,var(--ink) 30%,transparent);
  color-scheme:light dark;
}
@media (prefers-color-scheme:dark){
  :root{--ground:#0f1012;--ink:#dfe0e2;--record:#a79cff;--ok:#6fcf74;--warn:#ffb454;--danger:#ff8a80;
    --lift:color-mix(in oklab,var(--ground) 94%,white);color-scheme:dark;
    --line:color-mix(in oklab,var(--ink) 28%,var(--ground));
    --sheet-shadow:0 1px 2px rgb(0 0 0 / .45),0 28px 56px -28px rgb(0 0 0 / .85);}
}
html{background:var(--ground);}
/* The file reads as one sheet of paper on the grey, as an invoice or a certificate does; flat grey to the edges read as a
   screen, not a document, beside a real invoice. */
body{font-family:"Bricolage Grotesque",system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;font-size:var(--t4);
  font-variant-numeric:tabular-nums;max-width:1040px;padding:0 48px 48px;margin:32px auto;background:var(--lift);border:1px solid var(--line);
  box-shadow:var(--sheet-shadow);}
body *{border-radius:0 !important;box-shadow:none !important;}
h1,h2,h3{font-weight:700;letter-spacing:-.015em;}
a{color:var(--ink);}
code{background:var(--lift);overflow-wrap:anywhere;word-break:break-all;}
.fw-summary,.fw-anchors,.fw-anchor,.fw-room,.fw-recon,.fw-disclaimer,.fw-exposure,.fw-record,.fw-opinion,.fw-feed-unchecked,
.fw-exp-stat,.fw-epochs th,.fw-epochs td{background:var(--lift) !important;border-color:var(--line) !important;color:var(--ink) !important;}
.fw-anchors-intro,.fw-room,.fw-recon-title,.fw-recon-cap,.fw-recon-badge{color:var(--ink) !important;}
.fw-anchor,.fw-mth-prompt,.fwb-card,.fwb-lens,.fwb-sw.fact,.fwb-chip.adv,.fw-feed-more{background:var(--lift) !important;color:var(--ink);border-color:var(--line) !important;}
/* A button is a control: its edge is the control edge (the line colour is for boxes), it is a little heavier, and it answers a hover. */
.fw-feed-more{border:2px solid var(--edge) !important;font-weight:600;padding:.7rem 1.2rem;}
.fw-feed-more:hover{background:var(--ink) !important;color:var(--ground) !important;}
/* A card's left edge is the colour of its Safety Signal Level (the script sets it inline); the other three edges are the page's line. */
.fw-item{background:var(--lift) !important;color:var(--ink);border-top-color:var(--line) !important;border-right-color:var(--line) !important;border-bottom-color:var(--line) !important;}
.fw-item-comment,.fw-item-reply{background:color-mix(in oklab,var(--ink) 5%,var(--ground)) !important;}
.fw-avatar,.fw-kind,.fw-kind-post{background:color-mix(in oklab,var(--ink) 9%,var(--ground)) !important;color:var(--ink) !important;box-shadow:none !important;}
.fwb-card.interp,.fwb-sw.interp{background:var(--lift) !important;border:1px dashed var(--ink) !important;}
.fw-kind{text-transform:none;letter-spacing:0;font-size:var(--t2);}
.fw-disclaimer{border-left:2px solid var(--ink) !important;}
/* A verification row that did not pass shows it: its edge, its weight, and for a failure its colour. A row that passed stays neutral. */
.fw-record.fw-warn{border-left-color:var(--warn) !important;}
.fw-record.fw-fail{border-left-color:var(--danger) !important;}
.fw-record.fw-warn>summary,.fw-record.fw-fail>summary{font-weight:600;}
.fw-record.fw-fail>summary{color:var(--danger) !important;}
.fw-chain-summary{background:var(--lift) !important;}
.fw-chain-summary.fw-pass{border:1.5px solid var(--ok) !important;}
.fw-chain-summary.fw-warn{border:1.5px solid var(--warn) !important;}
.fw-chain-summary.fw-fail{border:1.5px solid var(--danger) !important;}
.fw-chain-summary h2{margin-top:0;}
/* The box fills a moment after the page opens. Its room is kept (the height the filled box takes: its margins, its two rules and
   three lines of text), so the page below does not drop by that much when it fills. */
#fw-status{display:flow-root;min-height:11.9rem;}
button,select,input{font-family:inherit;background:var(--lift);color:var(--ink);border:1.5px solid var(--edge);}
button#fw-verify-btn{background:var(--ink);color:var(--ground);border:0;font-weight:600;}
button#fw-verify-btn:hover:not(:disabled){background:color-mix(in oklab,var(--ink) 82%,var(--ground));}
button#fw-verify-btn:active:not(:disabled){background:color-mix(in oklab,var(--ink) 66%,var(--ground));}
.fw-brand-dot{background:var(--record);width:14px;height:14px;outline:3px solid color-mix(in oklab,var(--record) 20%,transparent);}
.fw-brandrow{gap:12px;margin-bottom:14px;}
.fw-brand-word{font-weight:700;font-size:15px;}
th{color:var(--mut);font-weight:500;}
td,th,table{border-color:var(--line);}
#fw-reading-numbers{overflow-x:auto;}

/* The reading controls read as one quiet row: the platform marks are text tabs with the chosen one in ink, the filters are
   flat selects with small labels, and the column heads wrap under their numbers. A row of boxed buttons, default selects
   and one-line headers wider than their columns read as unfinished beside a real invoice. */
h2{margin:2.5rem 0 .75rem;}
/* Running text keeps a readable line of about 72 letters: ch is the width of a zero, and in this face 75ch held 87 to 91 letters, 60ch holds
   67 and 65ch holds 75 to 77, so 62ch (71 to 73). No last line of one word. A paragraph drawn as a box keeps the column. */
p{max-width:62ch;text-wrap:pretty;}
p.fw-disclaimer,p.fw-withheld{max-width:none;}
.fw-marks{display:flex;flex-wrap:wrap;gap:4px;margin:1rem 0 .5rem;border-bottom:1px solid var(--line);padding-bottom:10px;}
.fw-marks button{border:0 !important;background:none !important;color:var(--mut) !important;padding:6px 12px !important;font-size:var(--t3);cursor:pointer;}
.fw-marks button[aria-pressed="true"],.fw-marks button.on,.fw-marks button.active{background:var(--ink) !important;color:var(--ground) !important;}
.fw-filters{gap:.5rem 1.5rem;margin:.75rem 0 .25rem;font-size:var(--t3);color:var(--mut);}
.fw-filters select{appearance:none;-webkit-appearance:none;border:0 !important;border-bottom:1.5px solid var(--edge) !important;
  background:transparent;padding:4px 24px 4px 2px;font-size:var(--t3);color:var(--ink);cursor:pointer;
  background-image:linear-gradient(45deg,transparent 50%,var(--mut) 50%),linear-gradient(135deg,var(--mut) 50%,transparent 50%);
  background-position:right 9px top 52%,right 3px top 52%;background-size:6px 6px,6px 6px;background-repeat:no-repeat;}
.fw-filters select:hover{border-bottom-color:var(--ink) !important;}
/* The list a select opens is the browser's own, drawn on its own ground: with the select flat and clear, an option in the
   page's ink read light on light (or dark on dark) in a browser whose scheme and the page's tokens disagreed (his Chrome,
   12 Oct 2026). The options carry the page's own ground and ink, so they read in both looks whatever the browser draws. */
select option,select optgroup{background-color:var(--lift);color:var(--ink);}
.fw-blur-toggle{font-size:var(--t3);color:var(--mut);cursor:pointer;}
#fw-blur-authors{accent-color:var(--ink);width:16px;height:16px;margin:0 8px 0 0;vertical-align:-3px;cursor:pointer;}
#fw-reading-numbers table{border-collapse:collapse;width:100%;margin-top:1rem;}
#fw-reading-numbers th{white-space:normal;max-width:11ch;vertical-align:bottom;line-height:1.25;font-size:var(--t2);padding:0 8px 8px;text-align:right;}
#fw-reading-numbers th:first-child{text-align:left;}
#fw-reading-numbers td{padding:10px 8px;border-top:1px solid var(--line);text-align:right;vertical-align:middle;}
#fw-reading-numbers td:first-child,#fw-reading-numbers tbody th{text-align:left;}
#fw-reading-numbers button{border:0;background:none;padding:0 2px;color:var(--ink);text-decoration:underline dotted;text-underline-offset:3px;font-weight:500;}
#fw-reading-numbers button[aria-pressed="true"]{background:var(--ink);color:var(--ground);text-decoration:none;}
/* A row head is the same size and line as the numbers beside it (the column-head rule above is for the head row only), and the
   total closes the table on a rule as wide as the table, in bold. */
#fw-reading-numbers tbody th{font-size:var(--t3);line-height:inherit;vertical-align:middle;padding:10px 8px;font-weight:500;color:var(--ink);}
#fw-reading-numbers .fw-numbers-total th,#fw-reading-numbers .fw-numbers-total td{border-top:2px solid var(--edge);font-weight:700;}
#fw-reading-numbers .fw-numbers-total button{font-weight:700;}

/* The certificate: the first screen answers what a doubter asks first. The reading sentence is the big voice on the left;
   the checker's own word and the three facts it covers stand on the right. Built by CERT_SCRIPT from the file's own data,
   so no signed line moves or changes. */
.fw-cert{display:grid;grid-template-columns:minmax(0,1.5fr) minmax(260px,1fr);gap:20px 48px;align-items:start;
  padding:40px 0 28px;margin-bottom:28px;border-bottom:1.5px solid var(--ink);}
.fw-cert-top{grid-column:1/-1;}
.fw-cert-top h1{font-size:1.5rem;margin:10px 0 2px;}
.fw-cert-top .fw-meta{font-size:var(--t3);margin:0;}
.fw-cert .fw-reading-sentence{grid-column:1;grid-row:2/span 2;margin:8px 0 0;font-size:clamp(1.35rem,2.4vw,1.85rem);
  line-height:1.18;font-weight:700;letter-spacing:-.015em;color:var(--ink);max-width:26ch;}
.fw-cert-seal{grid-column:2;grid-row:2;border-left:4px solid var(--edge);padding:6px 0 6px 18px;min-height:3rem;}
.fw-cert-seal.ok{border-left-color:var(--ok);} .fw-cert-seal.warn{border-left-color:var(--warn);} .fw-cert-seal.fail{border-left-color:var(--danger);}
.fw-cert-word{font-size:clamp(1.5rem,2.8vw,2rem);font-weight:700;letter-spacing:-.01em;line-height:1.05;color:var(--mut);}
.fw-cert-seal.ok .fw-cert-word{color:var(--ok);} .fw-cert-seal.warn .fw-cert-word{color:var(--warn);} .fw-cert-seal.fail .fw-cert-word{color:var(--danger);}
.fw-cert-word.fw-cert-long{font-size:1.25rem;line-height:1.2;letter-spacing:0;}
.fw-cert-what{margin-top:8px;color:var(--mut);font-size:var(--t3);max-width:36ch;}
.fw-cert-facts{grid-column:2;grid-row:3;display:grid;grid-template-columns:1fr 1fr;border-top:1px solid var(--line);}
.fw-cert-facts>div{padding:10px 0;border-bottom:1px solid var(--line);display:flex;flex-direction:column;}
.fw-cert-facts>.wide,.fw-cert-facts>div:first-child:nth-last-child(2){grid-column:1/-1;}
.fw-cert-facts span{font-size:var(--t2);color:var(--mut);font-weight:500;}
.fw-cert-facts b{font-size:1.6rem;font-weight:700;letter-spacing:-.02em;}
.fw-cert-facts>.wide b{font-size:1.15rem;}
@media (max-width:640px){
  body{padding:0 16px 32px;margin:0;border:0;}
  .fw-cert{grid-template-columns:1fr;padding-top:24px;}
  .fw-cert .fw-reading-sentence,.fw-cert-seal,.fw-cert-facts{grid-column:1;grid-row:auto;}
  #fw-reading-numbers table{display:block;max-width:100%;overflow-x:auto;font-size:14px;}
  .fw-summary dl,.fw-anchor dl,.fw-methodology dl{grid-template-columns:minmax(0,1fr);gap:0;}
  .fw-summary dd,.fw-anchor dd,.fw-methodology dd{margin:0 0 .7rem;}
}
/* The boxes of the page share one inner padding and one outer margin, on a 4, 8, 12, 16 scale (they were 14, 15, 17, 18, 19 px across
   boxes of one kind). A tile is 12 by 16, and the folded interpretation block is 8 by 16. */
.fw-summary,.fw-anchors,.fw-exposure,.fw-completeness,.fw-people,.fw-methodology,.fw-chain-summary,.fwb-card{padding:16px 20px;margin:16px 0;}
.fw-stat,.fw-exp-stat{padding:12px 16px;}
.fw-interpretation{padding:8px 16px;margin:16px 0;}
/* Keyboard focus: one ring in the record colour on everything a reader presses (the browsers' own rings differ per control and
   some are invisible on the page's grounds). A mouse press shows none. */
:is(button,select,input,summary,a,[role="button"]):focus-visible{outline:2px solid var(--record);outline-offset:2px;}
@media (prefers-reduced-motion:reduce){*,*::before,*::after{transition-duration:.01ms !important;animation-duration:.01ms !important;scroll-behavior:auto !important;}}
/* On paper the page has a margin of its own: the default dialog margin put a box's right edge exactly on the edge of the printable
   area and the PDF dropped that last pixel (every full-width box lost its right rule, 12 Oct 2026). The line that stands where a
   'show more' button is on a page is for paper only. */
@page{margin:16mm;}
.fw-print-note{display:none;}
@media print{
  /* Paper is light whatever the reader's device is: the accent tokens go back to their light values too, so a green or a violet
     meant for a dark ground does not print pale on white. */
  :root{--ground:#fff;--ink:#000;--lift:#fff;--record:#4531c9;--ok:#246b2b;--warn:#8a4b00;--danger:#b3261e;color-scheme:light;}
  /* The bars of the charts and the coloured edges are backgrounds, and a print dialog leaves background graphics off by default,
     which printed every bar as nothing. They print as drawn. */
  html{-webkit-print-color-adjust:exact;print-color-adjust:exact;}
  /* The two pixels at each side keep a box's edge off the edge of the printable area, where it was cut. */
  body{border:0;margin:0 auto;padding:0 2px;max-width:none;box-shadow:none;}
  /* What acts on a page does not print: the platform marks, the filters, the verify button, the more buttons, the lens buttons.
     A figure that is a button (the numbers in the table of what the feed showed) is a figure on paper: it prints in place, plain. */
  button:not(.fw-num),.fw-filters,.fw-blur-toggle,.fw-marks{display:none !important;}
  #fw-reading-numbers .fw-num,#fw-reading-numbers .fw-num[aria-pressed="true"]{background:none;color:inherit;text-decoration:none;padding:0;font-weight:500;}
  #fw-reading-numbers .fw-num[aria-pressed="true"]{font-weight:700;}
  /* A card, a table row, a box and a figure are not cut by a page edge, and a heading is not left alone at the foot of a page. */
  .fw-item,.fw-anchor,.fw-opinion,.fw-exp-stat,.fwb-card,.fw-numbers tr,.fw-barrow,.fw-exp-barrow{break-inside:avoid;}
  h1,h2,h3{break-after:avoid;}
  /* A verification row that passed prints only if the reader opened it on screen; the tally above the rows says how many there
     are, and about five hundred closed lines were twenty pages. A row that did not pass always prints. */
  #fw-results details.fw-record.fw-pass:not([open]){display:none;}
  /* A label wraps inside a third of the width, so a long one does not take half the page from its value. */
  .fw-summary dl,.fw-methodology dl,.fw-anchor dl{grid-template-columns:fit-content(32%) 1fr;}
  /* The code sits beside its link, small; the arrow that opens it is no use on paper. The panel is opened by the page before print. */
  /* A box that scrolls on the screen shows all of its text on paper: the verbatim AI instructions (2,669 px for one of the five) were cut at
     their screen height. The time stamp tokens keep theirs: each is 8 to 9 thousand characters, eight pages of them for the four of the demo,
     and a token is checked from the file, not typed back from paper. */
  .fw-mth-prompt pre{max-height:none;overflow:visible;}
  .fw-qr>summary{display:none;}
  .fw-qr{display:inline-block;}
  .fw-qr-holder{display:flex;align-items:center;gap:.5rem;margin:0;padding:.2rem;border:0;}
  .fw-qr-holder svg{width:72px;height:72px;}
  .fw-qr-url{margin:0;max-width:34ch;font-size:var(--t1);}
  /* The link is a link on paper; its address prints beside it, in the code panel's own line. The hint to click a number is for a
     screen. The button that shows more is gone on paper; its line says how many records are not on the page, in its own words. */
  a.fw-source-link{text-decoration:underline;}
  .fw-numbers-hint{display:none !important;}
  .fw-print-note{display:block;margin:.6rem 0;color:var(--mut);font-size:var(--t3);}
  .fw-print-note:empty{display:none;}
}
`;

/**
 * Build a complete standalone HTML export. Returns a self-contained string
 * that can be written to disk + opened in any modern browser. No external
 * dependencies; ECDSA P-256 verification + SHA-256 recompute use Web Crypto
 * (SubtleCrypto) baseline support.
 *
 * Per VISION §7.2 V1 minimum:
 *   • Page-1 descriptive summary (counts, time window, precision disclosure,
 *     "what FW does NOT measure" disclaimer).
 *   • One-click verifier with embedded inline JS.
 *   • Records embedded inline as JSON.
 *   • Single-language template (locale param).
 */
/**
 * The key-genesis block. Rendered with a slot the inline script fills after it
 * has checked the tokens, exactly like the chain anchors: the file states
 * nothing about the time until something has verified it.
 */
/**
 * Who made this file, when, with what, and how a reader names the copy in
 * front of them.
 *
 * The export computed `generatedAt` and `extensionVersion` in the methodology
 * block and rendered neither, so nothing in the document answered "when was
 * this file created, which build created it, and how do we know this copy is
 * that file". The digest is computed by the recipient's browser rather than
 * written in at build time: a file cannot carry a hash of itself, and a value
 * the reader derives is worth more than one the file asserts.
 */
