// ─── DATA ───────────────────────────────────────────────────────────────────
var CIRCUITS=['G1-1','G1-2','G1-3','G1-4','G1-5','G1-6','G1-7','G1-8','G1-9','G1-10','G1-11','G1-12',
              'G2-1','G2-2','G2-3','G2-4','G2-5','G2-6','G2-7','G2-8',
              'G3-1','G3-2','G3-3','G3-4','G3-5','G3-6','G3-7','G3-8'];

var BTYPES=['AB45STB','AB52STB','AB85STB','AB100STB','AB150STB','AB200STB',
            'AB42AMB','AU35','YS35','AB72AMB','YS70','AU70','AB77AMB','AB87AMB',
            'AU80','YS80','AB97AMB','YS100','AU100','AB114AMB','YS130','AU130',
            'AB144AMB','AU150','YS150','AB164AMB','AB194AMB','AB214AMB',
            'AB44ADB','AB55ADB','AB66ADB','AB88ADB','AB100ADB',
            'AWB900','AWB1100','AWB1400','AWB1600',
            'AB40TB','AB65TB','AB105TB','AB150TTB','AB160TB','AB177G','AB180','AB200TB',
            '240TB','177GOLD','155GOLD','250GOLD','260GOLD',
            'JCT100','JCT150','JCT200','JCT240','KBH',
            '18TKTB','18KJTB','20TGTB','20LBTB','18LBFB','18TRTB','18RRTB',
            '18GATB','18HNTB','BYPTB','18BYPFB','18TITB','18PBTB','18TMTB',
            'SB1600','18DRTB','18SFTB','18NGTB','999TB','TRS777',
            '1400ERTB(Sample)','16SMTB','18JNFB','20JNTB','IP200','IP2000',
            'IP1500','18BTTB','20GTTB'];

// ─── STATE ───────────────────────────────────────────────────────────────────
var formations={}, readings=[], notifications=[], syncLogs=[];
var settings={
  phone:'', method:'WhatsApp', supervisor:'', dept:'Battery Formation Dept',
  sheetsUrl:'https://script.google.com/macros/s/AKfycbwLztGVlMV6Z5MTYuzwBfVNPLIYS84v0LnbiFd-kAPUdvCePHGelzWQ2tbSuZ92cEDjfg/exec'
};
var vRec=null, vTarget=null;
var PAGE_SIZE=100, readingsPage=0;

// ─── INIT ────────────────────────────────────────────────────────────────────
function init(){
  load();
  setInterval(function(){
    var el=document.getElementById('clock');
    if(el) el.textContent=new Date().toLocaleString('en-GB',{weekday:'short',year:'numeric',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit',second:'2-digit'});
  },1000);
  buildTypeSelect();
  buildCircuitSelects();
  buildCircuitGrids();
  buildBattFields();
  setNow();
  updateDash();
  loadSettingsUI();
  updateSheetsStatus();
}

// ─── STORAGE (chunked to avoid 5MB limit) ────────────────────────────────────
function save(){
  try{
    localStorage.setItem('qab_f',JSON.stringify(formations));
    localStorage.setItem('qab_n',JSON.stringify(notifications));
    localStorage.setItem('qab_s',JSON.stringify(syncLogs.slice(-200))); // keep last 200
    localStorage.setItem('qab_cfg',JSON.stringify(settings));
    // Save readings in chunks of 200
    var chunks=Math.ceil(readings.length/200)||1;
    localStorage.setItem('qab_r_chunks',chunks);
    for(var i=0;i<chunks;i++){
      localStorage.setItem('qab_r_'+i,JSON.stringify(readings.slice(i*200,(i+1)*200)));
    }
  }catch(e){console.warn('Storage full — export data to Sheets.',e);}
}

function load(){
  try{
    var f=localStorage.getItem('qab_f');
    var n=localStorage.getItem('qab_n');
    var s=localStorage.getItem('qab_s');
    var c=localStorage.getItem('qab_cfg');
    if(f) formations=JSON.parse(f);
    if(n) notifications=JSON.parse(n);
    if(s) syncLogs=JSON.parse(s);
    if(c) settings=JSON.parse(c);
    // Load chunked readings
    readings=[];
    var chunks=parseInt(localStorage.getItem('qab_r_chunks'))||0;
    for(var i=0;i<chunks;i++){
      var chunk=localStorage.getItem('qab_r_'+i);
      if(chunk) readings=readings.concat(JSON.parse(chunk));
    }
  }catch(e){ console.warn('Load error',e); }
}

// ─── BUILD UI ─────────────────────────────────────────────────────────────────
function buildTypeSelect(){
  var sel=document.getElementById('nf-type');
  sel.innerHTML='';
  BTYPES.forEach(function(t){
    var o=document.createElement('option');o.value=t;o.textContent=t;sel.appendChild(o);
  });
}

function buildCircuitSelects(){
  ['nf-circuit','rd-circuit'].forEach(function(id){
    var sel=document.getElementById(id);
    sel.innerHTML='<option value="">-- Select --</option>';
    ['G1','G2','G3'].forEach(function(g){
      var og=document.createElement('optgroup');
      og.label='Group '+g.slice(1)+' ('+g+')';
      CIRCUITS.filter(function(c){return c.startsWith(g+'-');}).forEach(function(c){
        var o=document.createElement('option');o.value=c;o.textContent=c;og.appendChild(o);
      });
      sel.appendChild(og);
    });
  });
}

function buildCircuitGrids(){
  ['G1','G2','G3'].forEach(function(g){
    var grid=document.getElementById('cg-'+g);
    if(!grid) return;
    grid.innerHTML='';
    CIRCUITS.filter(function(c){return c.startsWith(g+'-');}).forEach(function(c){
      var f=formations[c];
      var state=f?(f.complete?'complete':'running'):'';
      var lbl=f?(f.complete?'&#10003; Done':'Active'):'Empty';
      var btn=document.createElement('button');
      btn.className='circuit-btn '+(state||'');
      btn.id='cb-'+c.replace(/-/g,'_');
      btn.innerHTML='<strong>'+c+'</strong><br><span style="font-size:9px;opacity:0.75">'+lbl+'</span>';
      btn.setAttribute('onclick','showDetail("'+c+'")');
      grid.appendChild(btn);
    });
  });
}

function buildBattFields(){
  var g=document.getElementById('nf-batt-grid');
  g.innerHTML='';
  for(var i=1;i<=20;i++){
    var d=document.createElement('div');
    d.innerHTML='<label>Battery '+i+' S/N</label><input type="text" id="ns'+i+'" placeholder="SN-'+String(i).padStart(3,'0')+'">';
    g.appendChild(d);
  }
}

function setNow(){
  var now=new Date();
  var local=new Date(now-now.getTimezoneOffset()*60000).toISOString().slice(0,16);
  document.querySelectorAll('input[type="datetime-local"]').forEach(function(el){el.value=local;});
}

// ─── REGISTER FORMATION ───────────────────────────────────────────────────────
function registerFormation(){
  var c=document.getElementById('nf-circuit').value;
  var err=document.getElementById('nf-err');
  err.style.display='none';
  if(!c){err.textContent='Please select a circuit.';err.style.display='block';return;}
  if(formations[c]&&!formations[c].complete){err.textContent='Circuit '+c+' already has an active formation.';err.style.display='block';return;}
  var sns=[];
  for(var i=1;i<=20;i++){
    var v=document.getElementById('ns'+i).value.trim();
    if(v) sns.push(v);
  }
  if(!sns.length){err.textContent='Enter at least one battery serial number.';err.style.display='block';return;}
  formations[c]={
    circuit:c,
    type:document.getElementById('nf-type').value,
    start:document.getElementById('nf-start').value,
    end:document.getElementById('nf-end').value,
    sg:document.getElementById('nf-sg').value,
    batteries:sns,
    readings:[],
    complete:false,
    completeTick:false,
    at:new Date().toISOString()
  };
  save();
  buildCircuitGrids();
  updateDash();
  updateCompleteList();
  updateRptTable();
  // Sync formation to sheets
  postToSheets({
    sheet:'Formations',
    headers:['Circuit','Type','Batteries Count','Start','Expected End','Initial SG','Registered At'],
    row:[c,formations[c].type,sns.length,formations[c].start||'',formations[c].end||'',formations[c].sg||'',formations[c].at]
  });
  show('nf-ok',4000);
}

// ─── ADD READING ──────────────────────────────────────────────────────────────
function loadBatteries(){
  var c=document.getElementById('rd-circuit').value;
  var tbody=document.getElementById('rd-rows');
  var hint=document.getElementById('rd-hint');
  tbody.innerHTML='';
  if(!c||!formations[c]){hint.style.display='block';return;}
  hint.style.display='none';
  formations[c].batteries.forEach(function(sn,i){
    var tr=document.createElement('tr');
    if(i%2) tr.className='row-alt';
    tr.innerHTML='<td style="font-weight:600">'+(i+1)+'</td>'+
      '<td style="font-weight:500">'+sn+'</td>'+
      '<td><input type="number" id="rv'+i+'" placeholder="12.60" step="0.01" style="width:80px"></td>'+
      '<td><input type="number" id="rc'+i+'" placeholder="5.00" step="0.01" style="width:80px"></td>'+
      '<td><input type="number" id="rg'+i+'" placeholder="1.260" step="0.001" style="width:88px"></td>'+
      '<td><select id="rs'+i+'" style="width:90px;font-size:12px"><option>OK</option><option>Low V</option><option>High V</option><option>Check</option><option>Fault</option></select></td>';
    tbody.appendChild(tr);
  });
}

function saveReading(doSync){
  var c=document.getElementById('rd-circuit').value;
  if(!c||!formations[c]){alert('Please select an active circuit first.');return;}
  var bats=formations[c].batteries.map(function(sn,i){
    return{
      sn:sn,
      voltage:(document.getElementById('rv'+i)||{}).value||'',
      current:(document.getElementById('rc'+i)||{}).value||'',
      sg:(document.getElementById('rg'+i)||{}).value||'',
      status:(document.getElementById('rs'+i)||{}).value||''
    };
  });
  var r={
    id:Date.now(),
    circuit:c,
    type:formations[c].type,
    dt:document.getElementById('rd-dt').value,
    op:document.getElementById('rd-op').value||'Unknown',
    temp:document.getElementById('rd-temp').value,
    step:document.getElementById('rd-step').value,
    mode:document.getElementById('rd-mode').value,
    fsg:document.getElementById('rd-fsg').value,
    batteries:bats,
    synced:false
  };
  // Don't store battery data in formation.readings to save space — just count
  if(!formations[c].readingCount) formations[c].readingCount=0;
  formations[c].readingCount++;
  readings.push(r);
  save();
  updateDash();
  updateRptTable();
  show('rd-ok',3000);
  setNow();
  if(doSync) syncReading(r);
}

// ─── GOOGLE SHEETS SYNC ───────────────────────────────────────────────────────
function postToSheets(payload){
  if(!settings.sheetsUrl) return;
  return fetch(settings.sheetsUrl,{
    method:'POST',
    body:JSON.stringify(payload)
  }).then(function(r){return r.json();});
}

function syncReading(r){
  if(!settings.sheetsUrl){alert('Set Google Sheets URL in Settings first.');return;}
  var msg=document.getElementById('rd-sync-msg');
  msg.innerHTML='<span class="spinner"></span>Syncing to Google Sheets...';
  msg.style.background='#e8f8f0';msg.style.color='#27ae60';msg.style.display='block';

  var rows=r.batteries.map(function(b){
    return postToSheets({
      sheet:'Readings',
      headers:['Reading ID','Circuit','Battery Type','Battery S/N','Date Time','Operator','Mode','Step No','Temperature (C)','Voltage (V)','Current (A)','SP Gravity','Battery Status','Final SG','Synced At'],
      row:[r.id,r.circuit,r.type,b.sn,r.dt,r.op,r.mode,r.step||'',r.temp||'',b.voltage||'',b.current||'',b.sg||'',b.status||'',r.fsg||'',new Date().toISOString()]
    });
  });

  Promise.all(rows).then(function(){
    r.synced=true;save();
    addSyncLog(r.circuit+' — '+r.batteries.length+' batteries','Success');
    msg.innerHTML='&#10003; Synced to Google Sheets successfully!';
    setTimeout(function(){msg.style.display='none';},4000);
  }).catch(function(e){
    addSyncLog(r.circuit,'Failed: '+e.message);
    msg.innerHTML='&#10006; Sync failed. Data saved locally.';
    msg.style.background='#fdecea';msg.style.color='#c0392b';
    setTimeout(function(){msg.style.display='none';},5000);
  });
}

function syncAll(){
  if(!settings.sheetsUrl){alert('Set Google Sheets URL in Settings first.');return;}
  var un=readings.filter(function(r){return!r.synced;});
  if(!un.length){alert('All readings already synced to Google Sheets!');return;}
  if(!confirm('Sync '+un.length+' unsynced readings to Google Sheets?')) return;
  var done=0;
  un.forEach(function(r){
    syncReading(r);
    done++;
    if(done===un.length) alert('Sync started for '+un.length+' readings. Check Sync Log.');
  });
}

function addSyncLog(label,status){
  syncLogs.push({time:new Date().toLocaleString(),label:label,status:status});
  save();
}

function testSheets(){
  var url=document.getElementById('sheets-url').value.trim();
  if(!url){alert('Enter the URL first.');return;}
  var res=document.getElementById('testres');
  res.innerHTML='<span class="spinner"></span>Testing...';
  res.style.color='#e67e22';res.style.display='inline';
  fetch(url).then(function(r){return r.json();}).then(function(d){
    if(d.status==='ok'){
      res.innerHTML='&#10003; Connected successfully!';res.style.color='#27ae60';
      settings.sheetsUrl=url;save();updateSheetsStatus();
    }else{res.innerHTML='&#10006; Failed.';res.style.color='#e74c3c';}
  }).catch(function(){
    res.innerHTML='&#10006; Cannot connect. Check URL and redeploy.';res.style.color='#e74c3c';
  });
}

function updateSheetsStatus(){
  var el=document.getElementById('sheets-status');
  if(!el) return;
  el.textContent=settings.sheetsUrl?'&#9729; Sheets: Connected':'&#9729; Sheets: Not Connected';
  el.className='badge '+(settings.sheetsUrl?'badge-complete':'badge-nosync');
}

// ─── CIRCUIT DETAIL ───────────────────────────────────────────────────────────
function showDetail(c){
  document.querySelectorAll('.circuit-btn').forEach(function(b){b.classList.remove('active-sel');});
  var cb=document.getElementById('cb-'+c.replace(/-/g,'_'));
  if(cb) cb.classList.add('active-sel');
  var f=formations[c];
  var d=document.getElementById('circuit-detail');
  d.style.display='block';
  d.scrollIntoView({behavior:'smooth',block:'nearest'});
  document.getElementById('cd-title').textContent='Circuit '+c;
  if(!f){
    document.getElementById('cd-badge').className='badge badge-pending';
    document.getElementById('cd-badge').textContent='Empty';
    ['cd-type','cd-start','cd-end','cd-rc'].forEach(function(id){document.getElementById(id).textContent='--';});
    document.getElementById('cd-bats').innerHTML='<span style="color:#888;font-size:12px">No batteries registered</span>';
    return;
  }
  document.getElementById('cd-badge').className='badge '+(f.complete?'badge-complete':'badge-active');
  document.getElementById('cd-badge').textContent=f.complete?'Complete':'Active';
  document.getElementById('cd-type').textContent=f.type;
  document.getElementById('cd-start').textContent=f.start?new Date(f.start).toLocaleString():'--';
  document.getElementById('cd-end').textContent=f.end?new Date(f.end).toLocaleString():'--';
  document.getElementById('cd-rc').textContent=(f.readingCount||0)+' readings';
  var bc=document.getElementById('cd-bats');
  bc.innerHTML='';
  (f.batteries||[]).forEach(function(sn){
    var s=document.createElement('span');
    s.style.cssText='font-size:11px;padding:4px 10px;border:1px solid #dde1e7;border-radius:20px;background:#f8f9ff;font-weight:500';
    s.textContent=sn;bc.appendChild(s);
  });
}

// ─── DASHBOARD ────────────────────────────────────────────────────────────────
function updateDash(){
  var fVals=Object.values(formations);
  var active=fVals.filter(function(f){return!f.complete;}).length;
  var done=fVals.filter(function(f){return f.complete;}).length;
  setText('m-active',active);
  setText('m-done',done);
  setText('m-readings',readings.length);
  setText('active-count',active+' Active');
  setText('complete-count',done+' Complete');
  setText('rm1',Object.keys(formations).length);
  setText('rm2',readings.length);
  setText('rm3',done);
  setText('rm4',active);
}

// ─── COMPLETE LIST ────────────────────────────────────────────────────────────
function updateCompleteList(){
  var list=document.getElementById('complete-list');
  if(!list) return;
  var keys=Object.keys(formations).sort(function(a,b){return CIRCUITS.indexOf(a)-CIRCUITS.indexOf(b);});
  if(!keys.length){
    list.innerHTML='<p style="color:#888;font-size:13px;text-align:center;padding:16px">No formations registered yet. Go to New Formation tab to start.</p>';
    return;
  }
  list.innerHTML='';
  keys.forEach(function(c){
    var f=formations[c];
    var div=document.createElement('div');
    div.className='complete-item';
    div.innerHTML=
      '<div class="check-circle '+(f.completeTick?'checked':'')+'\" onclick=\"toggleComplete(\''+c+'\')\">'+
      (f.completeTick?'&#10003;':'')+'</div>'+
      '<div style="flex:1">'+
        '<div style="font-weight:600;font-size:14px">'+c+' &mdash; '+f.type+'</div>'+
        '<div style="font-size:11px;color:#888;margin-top:3px">'+
          f.batteries.length+' batteries &nbsp;|&nbsp; '+
          'Started: '+(f.start?new Date(f.start).toLocaleString():'--')+' &nbsp;|&nbsp; '+
          (f.readingCount||0)+' readings'+
        '</div>'+
      '</div>'+
      '<span class="badge '+(f.complete?'badge-complete':'badge-active')+'">'+(f.complete?'&#10003; Complete':'Active')+'</span>';
    list.appendChild(div);
  });
}

function toggleComplete(c){
  if(!formations[c]) return;
  formations[c].completeTick=!formations[c].completeTick;
  formations[c].complete=formations[c].completeTick;
  if(formations[c].complete){
    formations[c].completedAt=new Date().toISOString();
    sendNotif(c);
    postToSheets({
      sheet:'Completed Formations',
      headers:['Circuit','Type','Batteries','Start','Expected End','Completed At','Total Readings','Supervisor'],
      row:[c,formations[c].type,formations[c].batteries.length,formations[c].start||'',formations[c].end||'',formations[c].completedAt,formations[c].readingCount||0,settings.supervisor||'']
    });
  }
  buildCircuitGrids();
  updateCompleteList();
  updateDash();
  updateRptTable();
  save();
}

function sendNotif(c){
  var f=formations[c];
  var phone=settings.phone||'(not set)';
  var method=settings.method||'WhatsApp';
  var msg='FORMATION COMPLETE\nCircuit: '+c+'\nType: '+f.type+'\nBatteries: '+f.batteries.length+'\nCompleted: '+new Date().toLocaleString()+'\nDept: '+(settings.dept||'Battery Formation');
  notifications.push({time:new Date().toLocaleString(),circuit:c,msg:msg,method:method,phone:phone});
  save();
  alert('&#128241; Notification sent via '+method+' to '+phone+':\n\n'+msg);
}

// ─── REPORTS ──────────────────────────────────────────────────────────────────
function updateRptTable(){
  var tbody=document.getElementById('rpt-tbody');
  if(!tbody) return;
  tbody.innerHTML='';
  CIRCUITS.filter(function(c){return formations[c];}).forEach(function(c){
    var f=formations[c],tr=document.createElement('tr');
    tr.innerHTML='<td><strong>'+c+'</strong></td><td style="font-size:12px">'+f.type+'</td><td>'+f.batteries.length+'</td>'+
      '<td style="font-size:12px">'+(f.start?new Date(f.start).toLocaleString():'--')+'</td>'+
      '<td style="font-size:12px">'+(f.end?new Date(f.end).toLocaleString():'--')+'</td>'+
      '<td>'+(f.readingCount||0)+'</td>'+
      '<td><span class="badge '+(f.complete?'badge-complete':'badge-active')+'">'+(f.complete?'Complete':'Active')+'</span></td>';
    tbody.appendChild(tr);
  });
  updateDash();
}

function showRpt(name,btn){
  ['summary','log','notif','sync'].forEach(function(n){
    var el=document.getElementById('rpt-'+n);if(el) el.style.display='none';
  });
  document.getElementById('rpt-'+name).style.display='block';
  document.querySelectorAll('.tab-inner-nav button').forEach(function(b){b.classList.remove('active');});
  if(btn) btn.classList.add('active');
  if(name==='log') renderReadingsLog(0);
  if(name==='notif') renderNotifLog();
  if(name==='sync') renderSyncLog();
  if(name==='summary') updateRptTable();
}

function renderReadingsLog(page){
  var tbody=document.getElementById('log-tbody');
  if(!tbody) return;
  tbody.innerHTML='';
  var start=page*PAGE_SIZE;
  var slice=readings.slice().reverse().slice(start,start+PAGE_SIZE);
  slice.forEach(function(r){
    var tr=document.createElement('tr');
    var mc=r.mode==='Charge'?'badge-charge':r.mode==='Discharge'?'badge-discharge':'badge-rest';
    tr.innerHTML='<td style="font-size:11px">'+(r.dt?new Date(r.dt).toLocaleString():'--')+'</td>'+
      '<td><strong>'+r.circuit+'</strong></td>'+
      '<td style="font-size:11px">'+r.type+'</td>'+
      '<td>'+r.op+'</td>'+
      '<td><span class="badge '+mc+'">'+r.mode+'</span></td>'+
      '<td>'+(r.step||'--')+'</td>'+
      '<td>'+(r.temp||'--')+'°C</td>'+
      '<td>'+r.batteries.length+' batt.</td>'+
      '<td>'+(r.fsg||'--')+'</td>'+
      '<td><span class="badge '+(r.synced?'badge-complete':'badge-nosync')+'" style="font-size:10px">'+(r.synced?'Synced':'Local')+'</span></td>';
    tbody.appendChild(tr);
  });
  // Pagination
  var total=readings.length;
  var pages=Math.ceil(total/PAGE_SIZE);
  var pag=document.getElementById('rpt-log-pag');
  if(!pag){pag=document.createElement('div');pag.id='rpt-log-pag';pag.style.cssText='margin-top:10px;display:flex;gap:8px;align-items:center';document.getElementById('rpt-log').appendChild(pag);}
  pag.innerHTML='<span style="font-size:12px;color:#888">Showing '+(start+1)+'-'+Math.min(start+PAGE_SIZE,total)+' of '+total+' readings</span>';
  if(page>0){var pb=document.createElement('button');pb.className='btn';pb.textContent='&#8592; Previous';pb.onclick=function(){renderReadingsLog(page-1);};pag.appendChild(pb);}
  if(page<pages-1){var nb=document.createElement('button');nb.className='btn';nb.textContent='Next &#8594;';nb.onclick=function(){renderReadingsLog(page+1);};pag.appendChild(nb);}
}

function renderNotifLog(){
  var el=document.getElementById('notif-log');
  el.innerHTML=notifications.length?
    notifications.slice().reverse().map(function(n){
      return'<div class="notif-item"><div style="font-size:11px;color:#888">'+n.time+' — '+n.method+' to '+n.phone+'</div><div style="font-size:13px;white-space:pre-line;margin-top:4px">'+n.msg+'</div></div>';
    }).join(''):
    '<p style="color:#888;font-size:13px;padding:10px">No notifications yet.</p>';
}

function renderSyncLog(){
  var el=document.getElementById('sync-log');
  el.innerHTML=syncLogs.length?
    syncLogs.slice().reverse().map(function(s){
      var color=s.status.startsWith('Success')?'#27ae60':'#e74c3c';
      return'<div style="padding:8px 12px;border-left:4px solid '+color+';background:#f8f9ff;border-radius:0 8px 8px 0;margin-bottom:6px;font-size:12px">'+
        '<span style="color:#888">'+s.time+'</span> &mdash; '+s.label+' &mdash; <strong style="color:'+color+'">'+s.status+'</strong></div>';
    }).join(''):
    '<p style="color:#888;font-size:13px;padding:10px">No sync attempts yet.</p>';
}

// ─── EXPORT CSV ───────────────────────────────────────────────────────────────
function exportSummary(){
  var csv='Circuit,Type,Batteries,Start,Expected End,Readings,Status\n';
  CIRCUITS.filter(function(c){return formations[c];}).forEach(function(c){
    var f=formations[c];
    csv+=c+','+f.type+','+f.batteries.length+','+(f.start||'')+','+(f.end||'')+','+(f.readingCount||0)+','+(f.complete?'Complete':'Active')+'\n';
  });
  dlCSV(csv,'formation_summary_'+today()+'.csv');
}

function exportReadings(){
  var csv='ID,Circuit,Type,Battery S/N,DateTime,Operator,Mode,Step,Temperature,Voltage,Current,SP Gravity,Status,Final SG,Synced\n';
  readings.forEach(function(r){
    r.batteries.forEach(function(b){
      csv+=r.id+','+r.circuit+','+r.type+','+b.sn+','+(r.dt||'')+','+(r.op||'')+','+r.mode+','+(r.step||'')+','+(r.temp||'')+','+(b.voltage||'')+','+(b.current||'')+','+(b.sg||'')+','+(b.status||'')+','+(r.fsg||'')+',' +(r.synced?'Yes':'No')+'\n';
    });
  });
  dlCSV(csv,'formation_readings_'+today()+'.csv');
}

function dlCSV(csv,name){
  var a=document.createElement('a');
  a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8;'}));
  a.download=name;a.style.display='none';
  document.body.appendChild(a);a.click();document.body.removeChild(a);
}

function today(){return new Date().toISOString().slice(0,10);}

// ─── SETTINGS ─────────────────────────────────────────────────────────────────
function saveSettings(){
  settings.phone=val('notif-phone');
  settings.method=val('notif-method');
  settings.supervisor=val('sup-name');
  settings.dept=val('dept-name');
  var u=val('sheets-url');
  if(u) settings.sheetsUrl=u;
  save();updateSheetsStatus();
  show('setsaved',2500);
}

function loadSettingsUI(){
  setVal('notif-phone',settings.phone||'');
  setVal('notif-method',settings.method||'WhatsApp');
  setVal('sup-name',settings.supervisor||'');
  setVal('dept-name',settings.dept||'Battery Formation Dept');
  setVal('sheets-url',settings.sheetsUrl||'');
}

function resetData(){
  formations={};readings=[];notifications=[];syncLogs=[];
  var keys=[];for(var i=0;i<localStorage.length;i++){var k=localStorage.key(i);if(k&&k.startsWith('qab_'))keys.push(k);}
  keys.forEach(function(k){localStorage.removeItem(k);});
  buildCircuitGrids();updateDash();updateCompleteList();updateRptTable();
  document.getElementById('rd-rows').innerHTML='';
  document.getElementById('rd-hint').style.display='block';
  document.getElementById('circuit-detail').style.display='none';
  alert('All data reset.');
}

// ─── VOICE ENTRY ──────────────────────────────────────────────────────────────
function toggleVoice(t){
  if(!('webkitSpeechRecognition' in window||'SpeechRecognition' in window)){
    alert('Voice entry requires Google Chrome browser.');return;
  }
  if(vRec&&vTarget===t){
    vRec.stop();vRec=null;vTarget=null;
    document.getElementById('voice-'+t).classList.remove('listening');
    document.getElementById('voice-'+t+'-status').textContent='Voice stopped.';return;
  }
  var SR=window.SpeechRecognition||window.webkitSpeechRecognition;
  vRec=new SR();vTarget=t;
  vRec.continuous=true;vRec.interimResults=false;vRec.lang='en-US';
  vRec.onresult=function(e){
    var txt=e.results[e.results.length-1][0].transcript.toLowerCase().trim();
    document.getElementById('voice-'+t+'-status').textContent='Heard: "'+txt+'"';
    parseVoice(txt,t);
  };
  vRec.onerror=function(){
    document.getElementById('voice-'+t+'-status').textContent='Error. Try again.';
    document.getElementById('voice-'+t).classList.remove('listening');
    vRec=null;vTarget=null;
  };
  vRec.start();
  document.getElementById('voice-'+t).classList.add('listening');
  document.getElementById('voice-'+t+'-status').textContent='Listening... speak now';
}

function parseVoice(txt,t){
  var cm=txt.match(/circuit\s*(g\d+-\d+)/i)||txt.match(/(g\d+-\d+)/i);
  var vm=txt.match(/voltage\s*([\d.]+)/);
  var im=txt.match(/current\s*([\d.]+)/);
  var tm=txt.match(/temperature\s*([\d.]+)/);
  var sm=txt.match(/step\s*(\d+)/);
  var opM=txt.match(/operator\s+([a-z]+)/);
  var chargeM=txt.match(/\b(charge|charging)\b/);
  var disM=txt.match(/\b(discharge|discharging)\b/);
  var restM=txt.match(/\brest\b/);
  if(t==='rd'){
    if(cm){
      var cv=cm[1].toUpperCase();
      var s=document.getElementById('rd-circuit');
      for(var i=0;i<s.options.length;i++){if(s.options[i].value===cv){s.value=cv;loadBatteries();break;}}
    }
    if(vm) document.querySelectorAll('[id^="rv"]').forEach(function(el){if(/^rv\d/.test(el.id))el.value=vm[1];});
    if(im) document.querySelectorAll('[id^="rc"]').forEach(function(el){if(/^rc\d/.test(el.id))el.value=im[1];});
    if(tm) setVal('rd-temp',tm[1]);
    if(sm) setVal('rd-step',sm[1]);
    if(chargeM) setVal('rd-mode','Charge');
    if(disM) setVal('rd-mode','Discharge');
    if(restM) setVal('rd-mode','Rest');
    if(opM) setVal('rd-op',opM[1].charAt(0).toUpperCase()+opM[1].slice(1));
  }
}

// ─── DEMO & CLEAR ─────────────────────────────────────────────────────────────
function demoFill(){
  var c=document.getElementById('rd-circuit').value;
  if(!c||!formations[c]){alert('Select a circuit first.');return;}
  formations[c].batteries.forEach(function(_,i){
    var v=document.getElementById('rv'+i);
    var cr=document.getElementById('rc'+i);
    var g=document.getElementById('rg'+i);
    if(v) v.value=(12.4+Math.random()*0.4).toFixed(2);
    if(cr) cr.value=(4.8+Math.random()*0.5).toFixed(2);
    if(g) g.value=(1.240+Math.random()*0.04).toFixed(3);
  });
  setVal('rd-op','Operator A');setVal('rd-temp','28');setVal('rd-step','1');setVal('rd-fsg','1.265');
}

function clearForm(){
  document.querySelectorAll('[id^="rv"],[id^="rc"],[id^="rg"]').forEach(function(el){
    if(/^r[vcg]\d/.test(el.id)) el.value='';
  });
  setVal('rd-temp','');setVal('rd-step','');setVal('rd-fsg','');
}

// ─── TAB NAVIGATION ───────────────────────────────────────────────────────────
function showTab(name,btn){
  document.querySelectorAll('.tab').forEach(function(t){t.classList.remove('active');});
  document.querySelectorAll('.nav button').forEach(function(b){b.classList.remove('active');});
  document.getElementById('tab-'+name).classList.add('active');
  if(btn) btn.classList.add('active');
  if(name==='completed') updateCompleteList();
  if(name==='reports'){updateRptTable();updateDash();}
  if(name==='dashboard'){buildCircuitGrids();updateDash();}
}

// ─── HELPERS ──────────────────────────────────────────────────────────────────
function val(id){var el=document.getElementById(id);return el?el.value:'';}
function setVal(id,v){var el=document.getElementById(id);if(el)el.value=v;}
function setText(id,v){var el=document.getElementById(id);if(el)el.textContent=v;}
function show(id,ms){var el=document.getElementById(id);if(!el)return;el.style.display='block';if(ms)setTimeout(function(){el.style.display='none';},ms);}

// ─── START ────────────────────────────────────────────────────────────────────
init();
