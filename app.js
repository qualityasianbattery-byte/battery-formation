// ─── CONFIG ───────────────────────────────────────────────────────────────────
var SHEETS_URL = 'https://script.google.com/macros/s/AKfycbxyp508k0wfFeEFRRB4N_gtBRH9LLD-AdA84vowgIQHT0Y7XKyJKVMmqokwsQ06WQ_m/exec';

var CIRCUITS = ['G1-1','G1-2','G1-3','G1-4','G1-5','G1-6','G1-7','G1-8','G1-9','G1-10','G1-11','G1-12',
                'G2-1','G2-2','G2-3','G2-4','G2-5','G2-6','G2-7','G2-8',
                'G3-1','G3-2','G3-3','G3-4','G3-5','G3-6','G3-7','G3-8'];

var BTYPES = ['AB45STB','AB52STB','AB85STB','AB100STB','AB150STB','AB200STB',
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

// ─── STATE (in-memory only, loaded from Sheets on startup) ───────────────────
var formations = {};
var readingsCache = [];   // only last 200 for display
var totalReadings = 0;
var notifications = [];
var syncLogs = [];
var settings = { phone:'', method:'WhatsApp', supervisor:'', dept:'Battery Formation Dept' };
var vRec = null, vTarget = null;
var PAGE_SIZE = 50;
var currentPage = 0;
var isLoading = false;

// ─── INIT ────────────────────────────────────────────────────────────────────
function init() {
  loadSettingsLocal();
  setInterval(function(){
    var el = document.getElementById('clock');
    if(el) el.textContent = new Date().toLocaleString('en-GB',{weekday:'short',year:'numeric',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit',second:'2-digit'});
  }, 1000);
  buildTypeSelect();
  buildCircuitSelects();
  buildBattFields();
  setNow();
  loadSettingsUI();
  showLoadingOverlay(true);
  loadAllFromSheets();
}

// ─── LOADING OVERLAY ─────────────────────────────────────────────────────────
function showLoadingOverlay(show) {
  var el = document.getElementById('loading-overlay');
  if(el) el.style.display = show ? 'flex' : 'none';
}

// ─── GOOGLE SHEETS API ───────────────────────────────────────────────────────
function sheetsGet(sheetName, callback) {
  fetch(SHEETS_URL + '?sheet=' + encodeURIComponent(sheetName))
    .then(function(r){ return r.json(); })
    .then(function(d){ callback(null, d.rows || []); })
    .catch(function(e){ callback(e, []); });
}

function sheetsPost(payload, callback) {
  fetch(SHEETS_URL, {
    method: 'POST',
    body: JSON.stringify(payload)
  })
  .then(function(r){ return r.json(); })
  .then(function(d){ if(callback) callback(null, d); })
  .catch(function(e){ if(callback) callback(e, null); });
}

// ─── LOAD ALL DATA FROM SHEETS ON STARTUP ────────────────────────────────────
function loadAllFromSheets() {
  setText('loading-msg', 'Loading formations from Google Sheets...');
  sheetsGet('Formations', function(err, rows) {
    if(err) { showError('Cannot connect to Google Sheets. Check your internet connection.'); showLoadingOverlay(false); return; }
    formations = {};
    rows.forEach(function(r) {
      if(!r['Circuit']) return;
      var sns = r['Battery SNs'] ? r['Battery SNs'].toString().split(',') : [];
      formations[r['Circuit']] = {
        circuit: r['Circuit'],
        type: r['Type'] || '',
        start: r['Start'] || '',
        end: r['Expected End'] || '',
        sg: r['Initial SG'] || '',
        batteries: sns,
        readingCount: parseInt(r['Reading Count']) || 0,
        complete: r['Status'] === 'Complete',
        completeTick: r['Status'] === 'Complete',
        completedAt: r['Completed At'] || '',
        at: r['Registered At'] || ''
      };
    });
    setText('loading-msg', 'Loading readings summary...');
    sheetsGet('Readings', function(err2, rrows) {
      totalReadings = rrows.length;
      // Cache last 200 for display
      readingsCache = rrows.slice(-200).reverse();
      setText('loading-msg', 'Loading completed formations...');
      sheetsGet('Completed Formations', function(err3, crows) {
        crows.forEach(function(r) {
          if(r['Circuit'] && formations[r['Circuit']]) {
            formations[r['Circuit']].complete = true;
            formations[r['Circuit']].completeTick = true;
            formations[r['Circuit']].completedAt = r['Completed At'] || '';
          }
        });
        showLoadingOverlay(false);
        buildCircuitGrids();
        updateDash();
        updateSheetsStatus(true);
      });
    });
  });
}

// ─── REGISTER FORMATION ───────────────────────────────────────────────────────

// ─── REGISTER FORMATION ───────────────────────────────────────────────────────
function registerFormation() {
  var c = val('nf-circuit');
  var err = document.getElementById('nf-err');
  err.style.display = 'none';
  if(!c){ err.textContent='Please select a circuit.'; err.style.display='block'; return; }
  if(formations[c] && !formations[c].complete){ err.textContent='Circuit '+c+' already has an active formation.'; err.style.display='block'; return; }

  var sns = [];
  for(var i=1;i<=20;i++){
    var el = document.getElementById('ns'+i);
    if(el && el.value.trim()) sns.push(el.value.trim());
  }
  if(!sns.length){ err.textContent='Enter at least one battery serial number.'; err.style.display='block'; return; }

  var f = {
    circuit: c,
    type: val('nf-type'),
    start: val('nf-start'),
    end: val('nf-end'),
    sg: val('nf-sg'),
    batteries: sns,
    readingCount: 0,
    lastStep: '',
    complete: false,
    completeTick: false,
    at: new Date().toISOString()
  };
  formations[c] = f;

  setBtnLoading('btn-register', true);
  sheetsPost({
    sheet: 'Formations',
    headers: ['Circuit','Type','Battery SNs','Batteries Count','Start','Expected End','Initial SG','Status','Reading Count','Last Step','Completed At','Registered At'],
    row: [c, f.type, sns.join(','), sns.length, f.start, f.end, f.sg, 'Active', 0, '', '', f.at]
  }, function(err2) {
    setBtnLoading('btn-register', false);
    if(err2){ showError('Failed to save. Check connection.'); return; }
    buildCircuitGrids();
    updateDash();
    updateCompleteList();
    updateRptTable();
    show('nf-ok', 4000);
  });
}

// ─── BUILD SHEET-LIKE SN TABLE FOR REGISTRATION ───────────────────────────────
function buildBattFields() {
  var container = document.getElementById('nf-batt-grid');
  container.innerHTML = '';

  // Build scrollable spreadsheet-like table
  var wrap = document.createElement('div');
  wrap.style.cssText = 'border:1px solid #dde1e7;border-radius:10px;overflow:hidden';

  var scrollBox = document.createElement('div');
  scrollBox.style.cssText = 'overflow-y:auto;max-height:380px';

  var table = document.createElement('table');
  table.style.cssText = 'width:100%;border-collapse:collapse;font-size:13px';

  // Sticky header
  var thead = document.createElement('thead');
  thead.innerHTML =
    '<tr style="background:#0f3460;color:#fff;position:sticky;top:0;z-index:5">'+
    '<th style="padding:10px 14px;text-align:left;width:50px;font-weight:600">#</th>'+
    '<th style="padding:10px 14px;text-align:left;font-weight:600">Battery Serial Number</th>'+
    '<th style="padding:10px 14px;text-align:center;width:60px;font-weight:600">&#128247;</th>'+
    '</tr>';
  table.appendChild(thead);

  var tbody = document.createElement('tbody');
  for(var i=1;i<=20;i++){
    var tr = document.createElement('tr');
    tr.id = 'nf-row-'+i;
    tr.style.cssText = (i%2===0) ? 'background:#f8f9ff' : 'background:#fff';
    tr.innerHTML =
      '<td style="padding:6px 14px;border-bottom:1px solid #f0f2f5;color:#888;font-weight:700;font-size:12px">'+i+'</td>'+
      '<td style="padding:4px 8px;border-bottom:1px solid #f0f2f5">'+
        '<input type="text" id="ns'+i+'" placeholder="Click to type or scan &#128247;" '+
        'style="width:100%;padding:8px 10px;border:1px solid transparent;border-radius:6px;font-size:13px;font-weight:500;background:transparent;transition:all 0.2s" '+
        'onfocus="this.style.border=\'1px solid #0f3460\';this.style.background=\'#fff\';this.style.boxShadow=\'0 0 0 3px rgba(15,52,96,0.08)\'" '+
        'onblur="this.style.border=\'1px solid transparent\';this.style.background=\'transparent\';this.style.boxShadow=\'none\'" '+
        'onkeydown="snKeyNav(event,'+i+')" '+
        '>'+
      '</td>'+
      '<td style="padding:4px 8px;border-bottom:1px solid #f0f2f5;text-align:center">'+
        '<button onclick="openQRScanner('+i+')" title="Scan QR/Barcode" '+
        'style="padding:5px 10px;border:1px solid #8e44ad;border-radius:6px;background:#f8f0ff;cursor:pointer;font-size:15px;transition:all 0.2s" '+
        'onmouseover="this.style.background=\'#8e44ad\';this.style.color=\'#fff\'" '+
        'onmouseout="this.style.background=\'#f8f0ff\';this.style.color=\'inherit\'">'+
        '&#128247;</button>'+
      '</td>';
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  scrollBox.appendChild(table);
  wrap.appendChild(scrollBox);
  container.appendChild(wrap);

  // Helper text
  var hint = document.createElement('div');
  hint.style.cssText = 'font-size:11px;color:#888;margin-top:6px;padding:0 4px';
  hint.innerHTML = '&#9432; Press <strong>Enter</strong> or <strong>Tab</strong> to move to next row &nbsp;|&nbsp; Click &#128247; to scan QR/Barcode';
  container.appendChild(hint);
}

// Enter/Tab key navigation between SN rows
function snKeyNav(e, rowNum) {
  if(e.key === 'Enter' || e.key === 'Tab') {
    e.preventDefault();
    var next = document.getElementById('ns'+(rowNum+1));
    if(next) {
      next.focus();
      next.scrollIntoView({behavior:'smooth', block:'nearest'});
    }
  }
}

// ─── QR/BARCODE SCANNER (Register form only) ─────────────────────────────────
var qrScanTarget = 0;
var qrStream = null;
var qrInterval = null;

function openQRScanner(rowNum) {
  qrScanTarget = rowNum;
  var modal = document.getElementById('qr-modal');
  modal.style.display = 'flex';
  document.getElementById('qr-manual-input').value = '';
  document.getElementById('qr-manual-section').style.display = 'none';
  document.getElementById('qr-status').textContent = 'Opening camera for Battery '+rowNum+'...';
  startQRCamera();
}

function closeQRScanner() {
  document.getElementById('qr-modal').style.display = 'none';
  stopQRCamera();
}

function startQRCamera() {
  var video = document.getElementById('qr-video');
  if(!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    document.getElementById('qr-status').textContent = 'Camera not available.';
    document.getElementById('qr-manual-section').style.display = 'block';
    return;
  }
  navigator.mediaDevices.getUserMedia({video:{facingMode:'environment'}})
    .then(function(stream) {
      qrStream = stream;
      video.srcObject = stream;
      video.play();
      document.getElementById('qr-status').textContent = 'Point at QR code or barcode...';
      startQRDetection(video);
    })
    .catch(function() {
      document.getElementById('qr-status').textContent = 'Camera blocked. Use manual entry.';
      document.getElementById('qr-manual-section').style.display = 'block';
    });
}

function stopQRCamera() {
  if(qrInterval){ clearInterval(qrInterval); qrInterval=null; }
  if(qrStream){ qrStream.getTracks().forEach(function(t){t.stop();}); qrStream=null; }
  var video = document.getElementById('qr-video');
  if(video) video.srcObject = null;
}

function startQRDetection(video) {
  if(!window.BarcodeDetector) {
    document.getElementById('qr-status').textContent = 'Auto-scan not supported in this browser. Use manual entry.';
    document.getElementById('qr-manual-section').style.display = 'block';
    return;
  }
  var detector = new BarcodeDetector({
    formats:['qr_code','code_128','code_39','ean_13','ean_8','data_matrix','upc_a','upc_e','pdf417']
  });
  qrInterval = setInterval(function() {
    if(!qrStream){ clearInterval(qrInterval); return; }
    detector.detect(video).then(function(codes) {
      if(codes.length > 0) {
        clearInterval(qrInterval);
        applyQRCode(codes[0].rawValue);
      }
    }).catch(function(){});
  }, 300);
}

function applyQRCode(code) {
  var el = document.getElementById('ns'+qrScanTarget);
  if(el) {
    el.value = code;
    el.style.background = '#e8f8f0';
    el.style.borderColor = '#27ae60';
    // Highlight the row
    var row = document.getElementById('nf-row-'+qrScanTarget);
    if(row) row.style.background = '#e8f8f0';
    setTimeout(function(){
      if(row) row.style.background = qrScanTarget%2===0?'#f8f9ff':'#fff';
    }, 2000);
  }
  closeQRScanner();
  // Auto open next row scanner
  if(qrScanTarget < 20) {
    setTimeout(function(){ openQRScanner(qrScanTarget+1); }, 700);
  }
}

function qrManualSubmit() {
  var v = document.getElementById('qr-manual-input').value.trim();
  if(!v){ alert('Please enter a serial number.'); return; }
  applyQRCode(v);
}

// ─── LOAD BATTERIES FOR READING ──────────────────────────────────────────────
function loadBatteries() {
  var c = val('rd-circuit');
  var tbody = document.getElementById('rd-rows');
  var hint = document.getElementById('rd-hint');
  var tableWrap = document.getElementById('rd-table-wrap');
  tbody.innerHTML = '';

  if(!c || !formations[c]) {
    hint.style.display = 'block';
    tableWrap.style.display = 'none';
    return;
  }
  hint.style.display = 'none';
  tableWrap.style.display = 'block';

  var batteries = formations[c].batteries || [];
  for(var i=0; i<batteries.length; i++) {
    (function(idx, sn){
      var tr = document.createElement('tr');
      tr.style.cssText = idx%2===0 ? 'background:#fff' : 'background:#fafbff';
      tr.innerHTML =
        '<td style="padding:7px 10px;border-bottom:1px solid #f0f2f5;font-weight:700;text-align:center;color:#888;font-size:12px">'+(idx+1)+'</td>'+
        '<td style="padding:6px 8px;border-bottom:1px solid #f0f2f5;font-weight:600;font-size:13px;color:#0f3460">'+sn+'</td>'+
        '<td style="padding:4px 6px;border-bottom:1px solid #f0f2f5"><input type="number" id="rv'+idx+'" placeholder="12.60" step="0.01" style="width:80px;padding:6px 8px;border:1px solid #dde1e7;border-radius:6px;font-size:12px"></td>'+
        '<td style="padding:4px 6px;border-bottom:1px solid #f0f2f5"><input type="number" id="rc'+idx+'" placeholder="5.00" step="0.01" style="width:80px;padding:6px 8px;border:1px solid #dde1e7;border-radius:6px;font-size:12px"></td>'+
        '<td style="padding:4px 6px;border-bottom:1px solid #f0f2f5"><input type="number" id="rg'+idx+'" placeholder="1.260" step="0.001" style="width:88px;padding:6px 8px;border:1px solid #dde1e7;border-radius:6px;font-size:12px"></td>'+
        '<td style="padding:4px 6px;border-bottom:1px solid #f0f2f5"><select id="rs'+idx+'" style="width:90px;font-size:12px;padding:6px 8px;border:1px solid #dde1e7;border-radius:6px"><option>OK</option><option>Low V</option><option>High V</option><option>Check</option><option>Fault</option></select></td>';
      tbody.appendChild(tr);
    })(i, batteries[i]);
  }
}

// ─── SAVE READING ─────────────────────────────────────────────────────────────
function saveReading() {
  var c = val('rd-circuit');
  if(!c || !formations[c]){ alert('Please select an active circuit first.'); return; }

  var batteries = formations[c].batteries || [];
  if(batteries.length === 0){ alert('No batteries found for this circuit.'); return; }

  // Collect all battery readings
  var bats = [];
  for(var i=0; i<batteries.length; i++){
    bats.push({
      sn: batteries[i],
      voltage: (document.getElementById('rv'+i)||{}).value||'',
      current: (document.getElementById('rc'+i)||{}).value||'',
      sg: (document.getElementById('rg'+i)||{}).value||'',
      status: (document.getElementById('rs'+i)||{}).value||'OK'
    });
  }

  var rid = Date.now();
  var dt = val('rd-dt');
  var op = val('rd-op')||'Unknown';
  var temp = val('rd-temp');
  var step = val('rd-step');
  var mode = val('rd-mode');
  var fsg = val('rd-fsg');
  var durationHr = val('rd-duration-hr')||'0';
  var durationMin = val('rd-duration-min')||'0';
  var duration = durationHr+'h '+durationMin+'m';
  var btype = formations[c].type;

  setBtnLoading('btn-save-reading', true);
  var msg = document.getElementById('rd-sync-msg');
  msg.innerHTML = '<span class="spinner"></span> Saving battery 1 of '+bats.length+'...';
  msg.style.background='#e8f8f0'; msg.style.color='#27ae60'; msg.style.display='block';

  var saved=0, failed=0;

  function saveNext(index) {
    if(index >= bats.length) {
      setBtnLoading('btn-save-reading', false);
      if(failed === 0) {
        // Update formation reading count and last step
        formations[c].readingCount = (formations[c].readingCount||0) + 1;
        formations[c].lastStep = step || formations[c].lastStep;
        totalReadings++;
        updateDash();
        updateCompleteList();

        // Update Formations sheet — reading count (col 9) and last step (col 10)
        sheetsPost({sheet:'Formations',action:'update',keyCol:1,keyVal:c,updateCol:9,updateVal:formations[c].readingCount}, null);
        sheetsPost({sheet:'Formations',action:'update',keyCol:1,keyVal:c,updateCol:10,updateVal:step||''}, null);

        msg.innerHTML = '&#10003; All '+bats.length+' batteries saved! Reading #'+formations[c].readingCount+', Step '+step;
        setTimeout(function(){ msg.style.display='none'; }, 6000);
        show('rd-ok', 3000);
        setNow();
        // Clear duration fields
        setVal('rd-duration-hr','');
        setVal('rd-duration-min','');
        addSyncLog(c+' — '+bats.length+' batteries, Step '+step+', '+duration, 'Success');
      } else {
        msg.innerHTML = '&#10006; '+failed+' batteries failed. Check internet.';
        msg.style.background='#fdecea'; msg.style.color='#c0392b';
        addSyncLog(c, failed+' failed');
        setTimeout(function(){ msg.style.display='none'; }, 6000);
      }
      return;
    }

    var b = bats[index];
    msg.innerHTML = '<span class="spinner"></span> Saving battery '+(index+1)+' of '+bats.length+': <strong>'+b.sn+'</strong>...';

    fetch(SHEETS_URL, {
      method: 'POST',
      body: JSON.stringify({
        sheet: 'Readings',
        headers: ['Reading ID','Circuit','Battery Type','Battery S/N','Date Time','Operator','Mode','Step No','Temperature (C)','Voltage (V)','Current (A)','SP Gravity','Battery Status','Final SG','Duration','Saved At'],
        row: [rid, c, btype, b.sn, dt, op, mode, step||'', temp||'', b.voltage||'', b.current||'', b.sg||'', b.status||'', fsg||'', duration, new Date().toISOString()]
      })
    })
    .then(function(res){ return res.json(); })
    .then(function(){ saved++; saveNext(index+1); })
    .catch(function(){ failed++; saveNext(index+1); });
  }

  saveNext(0);
}

function toggleComplete(c) {
  if(!formations[c]) return;
  formations[c].completeTick = !formations[c].completeTick;
  formations[c].complete = formations[c].completeTick;
  if(formations[c].complete) {
    formations[c].completedAt = new Date().toISOString();
    sendNotif(c);
    // Save to Completed Formations sheet
    sheetsPost({
      sheet: 'Completed Formations',
      headers: ['Circuit','Type','Batteries','Start','Expected End','Completed At','Total Readings','Supervisor'],
      row: [c, formations[c].type, formations[c].batteries.length, formations[c].start||'', formations[c].end||'', formations[c].completedAt, formations[c].readingCount||0, settings.supervisor||'']
    }, null);
    // Update status in Formations sheet
    sheetsPost({
      sheet: 'Formations',
      action: 'update',
      keyCol: 1,
      keyVal: c,
      updateCol: 8, // Status column
      updateVal: 'Complete'
    }, null);
  }
  buildCircuitGrids();
  updateCompleteList();
  updateDash();
  updateRptTable();
}

function sendNotif(c) {
  var f = formations[c];
  var phone = settings.phone||'(not set)';
  var method = settings.method||'WhatsApp';
  var msg = 'FORMATION COMPLETE\nCircuit: '+c+'\nType: '+f.type+'\nBatteries: '+f.batteries.length+'\nCompleted: '+new Date().toLocaleString()+'\nDept: '+(settings.dept||'Battery Formation');
  notifications.push({time:new Date().toLocaleString(),circuit:c,msg:msg,method:method,phone:phone});
  alert('Notification sent via '+method+' to '+phone+':\n\n'+msg);
}

// ─── BUILD UI ─────────────────────────────────────────────────────────────────
function buildTypeSelect() {
  var sel = document.getElementById('nf-type');
  sel.innerHTML = '';
  BTYPES.forEach(function(t){ var o=document.createElement('option');o.value=t;o.textContent=t;sel.appendChild(o); });
}

function buildCircuitSelects() {
  ['nf-circuit','rd-circuit'].forEach(function(id) {
    var sel = document.getElementById(id);
    sel.innerHTML = '<option value="">-- Select --</option>';
    ['G1','G2','G3'].forEach(function(g) {
      var og = document.createElement('optgroup');
      og.label = 'Group '+g.slice(1)+' ('+g+')';
      CIRCUITS.filter(function(c){ return c.startsWith(g+'-'); }).forEach(function(c) {
        var o = document.createElement('option');o.value=c;o.textContent=c;og.appendChild(o);
      });
      sel.appendChild(og);
    });
  });
}

function buildCircuitGrids() {
  ['G1','G2','G3'].forEach(function(g) {
    var grid = document.getElementById('cg-'+g);
    if(!grid) return;
    grid.innerHTML = '';
    CIRCUITS.filter(function(c){ return c.startsWith(g+'-'); }).forEach(function(c) {
      var f = formations[c];
      var state = f?(f.complete?'complete':'running'):'';
      var lbl = f?(f.complete?'&#10003; Done':'Active'):'Empty';
      var btn = document.createElement('button');
      btn.className = 'circuit-btn '+(state||'');
      btn.id = 'cb-'+c.replace(/-/g,'_');
      btn.innerHTML = '<strong>'+c+'</strong><br><span style="font-size:9px;opacity:0.75">'+lbl+'</span>';
      btn.setAttribute('onclick','showDetail("'+c+'")');
      grid.appendChild(btn);
    });
  });
}


// Scanner for New Formation SN entry
var nfScanTarget = -1;
function openNFScanner(rowNum) {
  nfScanTarget = rowNum;
  scannerTarget = -1; // disable reading scanner
  document.getElementById('scanner-modal').style.display = 'flex';
  document.getElementById('manual-scan-input').value = '';
  document.getElementById('scanner-manual').style.display = 'none';
  document.getElementById('scanner-status').textContent = 'Starting camera for Battery '+rowNum+'...';
  startCamera();
}

function setNow() {
  var now = new Date();
  var local = new Date(now - now.getTimezoneOffset()*60000).toISOString().slice(0,16);
  document.querySelectorAll('input[type="datetime-local"]').forEach(function(el){ el.value=local; });
}

// ─── DASHBOARD ────────────────────────────────────────────────────────────────
function updateDash() {
  var fVals = Object.values(formations);
  var active = fVals.filter(function(f){ return !f.complete; }).length;
  var done = fVals.filter(function(f){ return f.complete; }).length;
  setText('m-active', active);
  setText('m-done', done);
  setText('m-readings', totalReadings);
  setText('active-count', active+' Active');
  setText('complete-count', done+' Complete');
  setText('rm1', Object.keys(formations).length);
  setText('rm2', totalReadings);
  setText('rm3', done);
  setText('rm4', active);
}

// ─── CIRCUIT DETAIL ───────────────────────────────────────────────────────────
function showDetail(c) {
  document.querySelectorAll('.circuit-btn').forEach(function(b){ b.classList.remove('active-sel'); });
  var cb = document.getElementById('cb-'+c.replace(/-/g,'_'));
  if(cb) cb.classList.add('active-sel');
  var f = formations[c];
  var d = document.getElementById('circuit-detail');
  d.style.display = 'block';
  d.scrollIntoView({behavior:'smooth',block:'nearest'});
  document.getElementById('cd-title').textContent = 'Circuit '+c;
  if(!f) {
    document.getElementById('cd-badge').className='badge badge-pending';
    document.getElementById('cd-badge').textContent='Empty';
    ['cd-type','cd-start','cd-end','cd-rc'].forEach(function(id){ document.getElementById(id).textContent='--'; });
    document.getElementById('cd-bats').innerHTML='<span style="color:#888;font-size:12px">No batteries registered</span>';
    return;
  }
  document.getElementById('cd-badge').className='badge '+(f.complete?'badge-complete':'badge-active');
  document.getElementById('cd-badge').textContent = f.complete?'Complete':'Active';
  document.getElementById('cd-type').textContent = f.type;
  document.getElementById('cd-start').textContent = f.start?new Date(f.start).toLocaleString():'--';
  document.getElementById('cd-end').textContent = f.end?new Date(f.end).toLocaleString():'--';
  document.getElementById('cd-rc').textContent = (f.readingCount||0)+' readings';
  var bc = document.getElementById('cd-bats');
  bc.innerHTML = '';
  (f.batteries||[]).forEach(function(sn) {
    var s = document.createElement('span');
    s.style.cssText = 'font-size:11px;padding:4px 10px;border:1px solid #dde1e7;border-radius:20px;background:#f8f9ff;font-weight:500';
    s.textContent = sn; bc.appendChild(s);
  });
}

// ─── COMPLETE LIST ────────────────────────────────────────────────────────────
function updateCompleteList() {
  var list = document.getElementById('complete-list');
  if(!list) return;
  var keys = Object.keys(formations).sort(function(a,b){ return CIRCUITS.indexOf(a)-CIRCUITS.indexOf(b); });
  if(!keys.length) {
    list.innerHTML = '<p style="color:#888;font-size:13px;text-align:center;padding:16px">No formations registered yet.</p>';
    return;
  }
  list.innerHTML = '';
  keys.forEach(function(c) {
    var f = formations[c];
    var div = document.createElement('div');
    div.className = 'complete-item';
    div.innerHTML =
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

// ─── REPORTS ──────────────────────────────────────────────────────────────────
function updateRptTable() {
  var tbody = document.getElementById('rpt-tbody');
  if(!tbody) return;
  tbody.innerHTML = '';
  CIRCUITS.filter(function(c){ return formations[c]; }).forEach(function(c) {
    var f = formations[c], tr = document.createElement('tr');
    tr.innerHTML =
      '<td><strong>'+c+'</strong></td>'+
      '<td style="font-size:12px">'+f.type+'</td>'+
      '<td>'+f.batteries.length+'</td>'+
      '<td style="font-size:12px">'+(f.start?new Date(f.start).toLocaleString():'--')+'</td>'+
      '<td style="font-size:12px">'+(f.end?new Date(f.end).toLocaleString():'--')+'</td>'+
      '<td>'+(f.readingCount||0)+'</td>'+
      '<td><span class="badge '+(f.complete?'badge-complete':'badge-active')+'">'+(f.complete?'Complete':'Active')+'</span></td>';
    tbody.appendChild(tr);
  });
  updateDash();
}

function showRpt(name, btn) {
  ['summary','log','notif','sync'].forEach(function(n){ var el=document.getElementById('rpt-'+n);if(el)el.style.display='none'; });
  document.getElementById('rpt-'+name).style.display='block';
  document.querySelectorAll('.tab-inner-nav button').forEach(function(b){ b.classList.remove('active'); });
  if(btn) btn.classList.add('active');
  if(name==='log') renderReadingsLog(0);
  if(name==='notif') renderNotifLog();
  if(name==='sync') renderSyncLog();
  if(name==='summary') updateRptTable();
}

function renderReadingsLog(page) {
  var tbody = document.getElementById('log-tbody');
  if(!tbody) return;

  // Show loading
  tbody.innerHTML = '<tr><td colspan="10" style="text-align:center;padding:20px"><span class="spinner"></span> Loading readings from Google Sheets...</td></tr>';

  sheetsGet('Readings', function(err, rows) {
    tbody.innerHTML = '';
    if(err || !rows.length) {
      tbody.innerHTML = '<tr><td colspan="10" style="color:#888;padding:12px;text-align:center">No readings found.</td></tr>';
      return;
    }
    var total = rows.length;
    var reversed = rows.slice().reverse();
    var start = page * PAGE_SIZE;
    var slice = reversed.slice(start, start + PAGE_SIZE);

    slice.forEach(function(r) {
      var tr = document.createElement('tr');
      var mode = r['Mode']||'';
      var mc = mode==='Charge'?'badge-charge':mode==='Discharge'?'badge-discharge':'badge-rest';
      tr.innerHTML =
        '<td style="font-size:11px">'+(r['Date Time']||'--')+'</td>'+
        '<td><strong>'+(r['Circuit']||'')+'</strong></td>'+
        '<td style="font-size:11px">'+(r['Battery Type']||'')+'</td>'+
        '<td>'+(r['Operator']||'')+'</td>'+
        '<td><span class="badge '+mc+'">'+mode+'</span></td>'+
        '<td>'+(r['Step No']||'--')+'</td>'+
        '<td>'+(r['Temperature (C)']||'--')+'°C</td>'+
        '<td>'+(r['Battery S/N']||'')+'</td>'+
        '<td>'+(r['Voltage (V)']||'--')+'V / '+(r['Current (A)']||'--')+'A</td>'+
        '<td>'+(r['Final SG']||'--')+'</td>';
      tbody.appendChild(tr);
    });

    // Pagination
    var pag = document.getElementById('rpt-log-pag');
    if(!pag){ pag=document.createElement('div');pag.id='rpt-log-pag';pag.style.cssText='margin-top:10px;display:flex;gap:8px;align-items:center;flex-wrap:wrap';document.getElementById('rpt-log').appendChild(pag); }
    pag.innerHTML = '<span style="font-size:12px;color:#888">Showing '+(start+1)+'-'+Math.min(start+PAGE_SIZE,total)+' of '+total+' rows</span>';
    if(page>0){ var pb=document.createElement('button');pb.className='btn';pb.textContent='&#8592; Previous';pb.onclick=function(){renderReadingsLog(page-1);};pag.appendChild(pb); }
    if(page<Math.ceil(total/PAGE_SIZE)-1){ var nb=document.createElement('button');nb.className='btn';nb.textContent='Next &#8594;';nb.onclick=function(){renderReadingsLog(page+1);};pag.appendChild(nb); }
  });
}

function renderNotifLog() {
  var el = document.getElementById('notif-log');
  el.innerHTML = notifications.length ?
    notifications.slice().reverse().map(function(n){
      return '<div class="notif-item"><div style="font-size:11px;color:#888">'+n.time+' — '+n.method+' to '+n.phone+'</div><div style="font-size:13px;white-space:pre-line;margin-top:4px">'+n.msg+'</div></div>';
    }).join('') :
    '<p style="color:#888;font-size:13px;padding:10px">No notifications yet.</p>';
}

function renderSyncLog() {
  var el = document.getElementById('sync-log');
  el.innerHTML = syncLogs.length ?
    syncLogs.slice().reverse().map(function(s){
      var color = s.status.startsWith('Success')?'#27ae60':'#e74c3c';
      return '<div style="padding:8px 12px;border-left:4px solid '+color+';background:#f8f9ff;border-radius:0 8px 8px 0;margin-bottom:6px;font-size:12px"><span style="color:#888">'+s.time+'</span> &mdash; '+s.label+' &mdash; <strong style="color:'+color+'">'+s.status+'</strong></div>';
    }).join('') :
    '<p style="color:#888;font-size:13px;padding:10px">No sync log yet.</p>';
}

function addSyncLog(label, status) {
  syncLogs.push({time:new Date().toLocaleString(),label:label,status:status});
  if(syncLogs.length>100) syncLogs.shift();
}

// ─── EXPORT CSV ───────────────────────────────────────────────────────────────
function exportSummary() {
  var csv = 'Circuit,Type,Batteries,Start,Expected End,Readings,Status\n';
  CIRCUITS.filter(function(c){ return formations[c]; }).forEach(function(c) {
    var f = formations[c];
    csv += c+','+f.type+','+f.batteries.length+','+(f.start||'')+','+(f.end||'')+','+(f.readingCount||0)+','+(f.complete?'Complete':'Active')+'\n';
  });
  dlCSV(csv, 'formation_summary_'+today()+'.csv');
}

function exportReadingsFromSheets() {
  var btn = document.getElementById('btn-export-readings');
  if(btn){ btn.textContent='Downloading...'; btn.disabled=true; }
  sheetsGet('Readings', function(err, rows) {
    if(btn){ btn.textContent='&#11015; Readings CSV'; btn.disabled=false; }
    if(err||!rows.length){ alert('No readings found in Google Sheets.'); return; }
    var headers = Object.keys(rows[0]);
    var csv = headers.join(',')+'\n';
    rows.forEach(function(r){ csv += headers.map(function(h){ return '"'+(r[h]||'')+'"'; }).join(',')+'\n'; });
    dlCSV(csv, 'formation_readings_'+today()+'.csv');
  });
}

function dlCSV(csv, name) {
  var a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8;'}));
  a.download = name; a.style.display='none';
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
}

function today(){ return new Date().toISOString().slice(0,10); }

// ─── DEMO & CLEAR ─────────────────────────────────────────────────────────────
function demoFill() {
  var c = val('rd-circuit');
  if(!c||!formations[c]){ alert('Select a circuit first.'); return; }
  formations[c].batteries.forEach(function(_,i) {
    var v=document.getElementById('rv'+i), cr=document.getElementById('rc'+i), g=document.getElementById('rg'+i);
    if(v) v.value=(12.4+Math.random()*0.4).toFixed(2);
    if(cr) cr.value=(4.8+Math.random()*0.5).toFixed(2);
    if(g) g.value=(1.240+Math.random()*0.04).toFixed(3);
  });
  setVal('rd-op','Operator A'); setVal('rd-temp','28'); setVal('rd-step','1'); setVal('rd-fsg','1.265');
}

function clearForm() {
  document.querySelectorAll('[id^="rv"],[id^="rc"],[id^="rg"]').forEach(function(el){ if(/^r[vcg]\d/.test(el.id)) el.value=''; });
  setVal('rd-temp',''); setVal('rd-step',''); setVal('rd-fsg','');
}

// ─── SETTINGS ─────────────────────────────────────────────────────────────────
function saveSettings() {
  settings.phone = val('notif-phone');
  settings.method = val('notif-method');
  settings.supervisor = val('sup-name');
  settings.dept = val('dept-name');
  localStorage.setItem('qab_settings', JSON.stringify(settings));
  show('setsaved', 2500);
}

function loadSettingsLocal() {
  try{ var s=localStorage.getItem('qab_settings'); if(s) settings=JSON.parse(s); }catch(e){}
}

function loadSettingsUI() {
  setVal('notif-phone', settings.phone||'');
  setVal('notif-method', settings.method||'WhatsApp');
  setVal('sup-name', settings.supervisor||'');
  setVal('dept-name', settings.dept||'Battery Formation Dept');
  setVal('sheets-url', SHEETS_URL);
}

function updateSheetsStatus(connected) {
  var el = document.getElementById('sheets-status');
  if(!el) return;
  el.textContent = connected ? '&#9729; Sheets: Connected' : '&#9729; Sheets: Not Connected';
  el.className = 'badge '+(connected?'badge-complete':'badge-nosync');
}

function showError(msg) {
  var el = document.getElementById('global-error');
  if(el){ el.textContent=msg; el.style.display='block'; }
}

// ─── VOICE ENTRY ──────────────────────────────────────────────────────────────
function toggleVoice(t) {
  if(!('webkitSpeechRecognition' in window||'SpeechRecognition' in window)){ alert('Voice entry requires Google Chrome.'); return; }
  if(vRec&&vTarget===t){ vRec.stop();vRec=null;vTarget=null;document.getElementById('voice-'+t).classList.remove('listening');document.getElementById('voice-'+t+'-status').textContent='Voice stopped.';return; }
  var SR=window.SpeechRecognition||window.webkitSpeechRecognition;
  vRec=new SR(); vTarget=t; vRec.continuous=true; vRec.interimResults=false; vRec.lang='en-US';
  vRec.onresult=function(e){ var txt=e.results[e.results.length-1][0].transcript.toLowerCase().trim(); document.getElementById('voice-'+t+'-status').textContent='Heard: "'+txt+'"'; parseVoice(txt,t); };
  vRec.onerror=function(){ document.getElementById('voice-'+t+'-status').textContent='Error. Try again.'; document.getElementById('voice-'+t).classList.remove('listening'); vRec=null;vTarget=null; };
  vRec.start();
  document.getElementById('voice-'+t).classList.add('listening');
  document.getElementById('voice-'+t+'-status').textContent='Listening... speak now';
}

function parseVoice(txt, t) {
  var cm=txt.match(/circuit\s*(g\d+-\d+)/i)||txt.match(/(g\d+-\d+)/i);
  var vm=txt.match(/voltage\s*([\d.]+)/), im=txt.match(/current\s*([\d.]+)/);
  var tm=txt.match(/temperature\s*([\d.]+)/), sm=txt.match(/step\s*(\d+)/);
  var opM=txt.match(/operator\s+([a-z]+)/);
  var chargeM=txt.match(/\b(charge|charging)\b/), disM=txt.match(/\b(discharge|discharging)\b/), restM=txt.match(/\brest\b/);
  if(t==='rd') {
    if(cm){ var cv=cm[1].toUpperCase(); var s=document.getElementById('rd-circuit'); for(var i=0;i<s.options.length;i++){if(s.options[i].value===cv){s.value=cv;loadBatteries();break;}} }
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

// ─── TAB NAVIGATION ───────────────────────────────────────────────────────────
function showTab(name, btn) {
  document.querySelectorAll('.tab').forEach(function(t){ t.classList.remove('active'); });
  document.querySelectorAll('.nav button').forEach(function(b){ b.classList.remove('active'); });
  document.getElementById('tab-'+name).classList.add('active');
  if(btn) btn.classList.add('active');
  if(name==='completed') updateCompleteList();
  if(name==='reports'){ updateRptTable(); updateDash(); }
  if(name==='dashboard'){ buildCircuitGrids(); updateDash(); }
}

// ─── HELPERS ──────────────────────────────────────────────────────────────────
function val(id){ var el=document.getElementById(id); return el?el.value:''; }
function setVal(id,v){ var el=document.getElementById(id); if(el) el.value=v; }
function setText(id,v){ var el=document.getElementById(id); if(el) el.textContent=v; }
function show(id,ms){ var el=document.getElementById(id); if(!el)return; el.style.display='block'; if(ms) setTimeout(function(){ el.style.display='none'; },ms); }
function setBtnLoading(id,loading){ var el=document.getElementById(id); if(!el)return; el.disabled=loading; el.style.opacity=loading?'0.6':'1'; }

init();
