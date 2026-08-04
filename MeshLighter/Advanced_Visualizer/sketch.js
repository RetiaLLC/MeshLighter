let socket;

// Persistent Data
let nodes = {}; 
let bonds = []; 

// Packet Particle System
const MAX_PACKETS = 400;
let packets = new Array(MAX_PACKETS);
let pIndex = 0;

let showLegend = true;

const COLORS = {
  nodeinfo: '#bf00ff', // Purple
  text: '#ffaa00',     // Orange
  position: '#00ffff', // Cyan
  telemetry: '#00ff66',// Green
  data: '#ffffff',     // White
  heartbeat: '#ff3333' // Red
};

const HW_MAP = {
  0: "UNSET", 38: "PRIVATE_HW", 255: "PRIVATE_HW",
  1: "TLORA_V2", 4: "TBEAM", 9: "RAK4631", 43: "HELTEC_V3"
};

let stats = { nodeinfo: 0, position: 0, telemetry: 0, text: 0, data: 0 };

function setup() {
  let canvas = createCanvas(windowWidth, windowHeight);
  canvas.parent('p5-container');
  
  for (let i = 0; i < MAX_PACKETS; i++) {
    packets[i] = { 
      active: false, x: 0, y: 0, targetX: 0, targetY: 0,
      currentX: 0, currentY: 0, color: '#ffffff', size: 0, 
      type: '', payload: '', from: '', to: '', rssi: 0, seed: 0,
      lerpAmt: 0, speed: 0.0005
    };
  }
  
  // Data now comes from the browser-native read-only source (Web Serial or Demo),
  // which decodes packets in-browser and calls handleIncomingData(). No server.
  if (window.VizSource) window.VizSource.autoStart();
}

function handleIncomingData(data) {
  let nodeId = data.from;
  if (!nodeId) return;

  if (nodeId !== "HB" && nodeId !== "ALL") {
    if (!nodes[nodeId]) {
      nodes[nodeId] = {
        id: nodeId, name: String(data.name || nodeId),
        sname: String(data.sname || nodeId.substring(nodeId.length - 4)),
        hw: HW_MAP[data.hw] || "UNKNOWN",
        lastHeard: millis(),
        lastHeardTime: new Date().toLocaleTimeString(),
        x: random(width*0.3, width*0.7), y: random(height*0.3, height*0.7),
        targetX: random(width*0.3, width*0.7), targetY: random(height*0.3, height*0.7),
        rssi: data.rssi || -100, active: true, pulse: 0, vx: 0, vy: 0,
        chirpPhase: random(TWO_PI), bubbleText: "", bubbleTime: 0, centerTime: 0
      };
    } else {
      nodes[nodeId].lastHeard = millis();
      nodes[nodeId].lastHeardTime = new Date().toLocaleTimeString();
      if (data.name) nodes[nodeId].name = String(data.name);
      if (data.sname) nodes[nodeId].sname = String(data.sname);
      if (data.hw) nodes[nodeId].hw = HW_MAP[data.hw] || nodes[nodeId].hw;
      nodes[nodeId].rssi = data.rssi || nodes[nodeId].rssi;
      nodes[nodeId].active = true;
    }

    if (data.type === 'nodeinfo') {
      nodes[nodeId].centerTime = millis() + 20000;
    }

    if (data.to && nodes[data.to] && data.to !== '0xffffffff') {
      refreshBond(data.from, data.to);
    }
  }

  if (data.type === 'text' && nodes[nodeId]) {
    nodes[nodeId].bubbleText = String(data.payload).substring(0, 200);
    nodes[nodeId].bubbleTime = millis() + 15000;
  }

  spawnPacket(data);
}

function refreshBond(id1, id2) {
  let found = false;
  for (let b of bonds) {
    if ((b.n1 === id1 && b.n2 === id2) || (b.n1 === id2 && b.n2 === id1)) {
      b.life = millis() + 60000;
      found = true; break;
    }
  }
  if (!found) bonds.push({ n1: id1, n2: id2, life: millis() + 60000 });
}

function spawnPacket(data) {
  let p = packets[pIndex];
  p.active = true; p.type = String(data.type);
  p.from = String(data.from); p.to = String(data.to);
  p.rssi = data.rssi || -100;
  p.payload = String(data.payload || "").substring(0, 200);
  p.seed = random(1000); p.lerpAmt = 0;
  
  if (p.type === 'nodeinfo') { stats.nodeinfo++; p.speed = 0.0001; }
  else if (p.type === 'text') { stats.text++; p.speed = 0.0003; }
  else if (p.type === 'position') { stats.position++; p.speed = 0.0005; }
  else if (p.type === 'telemetry') { stats.telemetry++; p.speed = 0.0007; }
  else { stats.data++; p.speed = 0.001; }

  if (nodes[p.from]) { p.x = nodes[p.from].x; p.y = nodes[p.from].y; }
  else {
    let side = floor(random(4));
    if (side === 0) { p.x = random(width); p.y = -50; }
    else if (side === 1) { p.x = random(width); p.y = height + 50; }
    else if (side === 2) { p.x = -50; p.y = random(height); }
    else { p.x = width + 50; p.y = random(height); }
  }
  
  p.currentX = p.x; p.currentY = p.y;

  if (nodes[p.to] && nodes[p.to].active && p.to !== '0xffffffff') {
    p.targetX = nodes[p.to].x; p.targetY = nodes[p.to].y;
  } else {
    p.targetX = width - p.x + random(-200, 200);
    p.targetY = height - p.y + random(-200, 200);
  }

  let rssiConst = constrain(p.rssi, -120, -30);
  p.size = map(rssiConst, -120, -30, 8, 25);
  p.color = COLORS[p.type] || COLORS.data;
  
  pIndex = (pIndex + 1) % MAX_PACKETS;
}

function draw() {
  background(2, 5, 15, 60); 
  drawGrid();
  applyNodePhysics();

  let currentTime = millis();
  
  // 1. Draw Bonds
  for (let i = bonds.length - 1; i >= 0; i--) {
    let b = bonds[i];
    if (currentTime > b.life) { bonds.splice(i, 1); continue; }
    let n1 = nodes[b.n1]; let n2 = nodes[b.n2];
    if (n1 && n2 && n1.active && n2.active) {
      let alpha = map(b.life - currentTime, 0, 10000, 0, 50);
      stroke(0, 255, 255, alpha); strokeWeight(2);
      line(n1.x, n1.y, n2.x, n2.y);
    }
  }

  // 2. Draw Nodes & PRUNE
  let ids = Object.keys(nodes);
  
  // CAPACITY LIMIT: If > 30 nodes, prune the oldest one immediately
  if (ids.length > 30) {
    let oldestId = null;
    let oldestTime = Infinity;
    for (let id of ids) {
      if (nodes[id].lastHeard < oldestTime) {
        oldestTime = nodes[id].lastHeard;
        oldestId = id;
      }
    }
    if (oldestId) delete nodes[oldestId];
    ids = Object.keys(nodes);
  }

  for (let id of ids) {
    let n = nodes[id];
    let age = currentTime - n.lastHeard;
    
    // PRUNE NODES NOT HEARD FOR 1 HOUR (3,600,000 ms)
    if (age > 3600000) { 
      delete nodes[id];
      continue;
    }
    
    drawNodeHUD(n, age);
  }
  
  // Icons Layer
  for (let id in nodes) {
    drawChirpIcon(nodes[id]);
  }

  // 3. Draw Packets with Source Tethers
  for (let i = 0; i < MAX_PACKETS; i++) {
    let p = packets[i];
    if (!p.active) continue;

    p.lerpAmt += p.speed;
    if (nodes[p.to] && nodes[p.to].active) { p.targetX = nodes[p.to].x; p.targetY = nodes[p.to].y; }

    let nx = (noise(p.seed, millis() * 0.0001) - 0.5) * 150 * (1 - p.lerpAmt);
    let ny = (noise(p.seed + 500, millis() * 0.0001) - 0.5) * 150 * (1 - p.lerpAmt);
    p.currentX = lerp(p.x, p.targetX, p.lerpAmt) + nx;
    p.currentY = lerp(p.y, p.targetY, p.lerpAmt) + ny;

    if (nodes[p.from]) {
      stroke(red(color(p.color)), green(color(p.color)), blue(color(p.color)), 30 * (1 - p.lerpAmt));
      strokeWeight(1); line(p.currentX, p.currentY, nodes[p.from].x, nodes[p.from].y);
    }

    let pulse = sin(millis() * 0.005 + p.seed) * 2;
    fill(p.color); noStroke();
    circle(p.currentX, p.currentY, p.size + pulse);

    if (p.lerpAmt >= 1.0) {
      p.active = false;
      if (nodes[p.to]) nodes[p.to].pulse = 35;
    }
    
    if (p.active && p.lerpAmt < 0.98) drawPacketHUD(p);
  }

  drawUI();
}

function applyNodePhysics() {
  let ids = Object.keys(nodes).filter(id => nodes[id].active);
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      let n1 = nodes[ids[i]]; let n2 = nodes[ids[j]];
      let dx = n1.x - n2.x; let dy = n1.y - n2.y;
      let d = sqrt(dx*dx + dy*dy);
      let minDist = 1200; // ADVANCED SEPARATION
      if (d < minDist && d > 0) {
        let force = (minDist - d) * 0.001; // Stronger Repulsion
        n1.vx += (dx / d) * force; n1.vy += (dy / d) * force;
        n2.vx -= (dx / d) * force; n2.vy -= (dy / d) * force;
      }
    }
    
    let n = nodes[ids[i]];
    let margin = 300; // KEEP WELL AWAY FROM EDGES
    if (n.x < margin) n.vx += (margin - n.x) * 0.02;
    if (n.x > width - margin) n.vx -= (n.x - (width - margin)) * 0.02;
    if (n.y < margin) n.vy += (margin - n.y) * 0.02;
    if (n.y > height - margin) n.vy -= (n.y - (height - margin)) * 0.02;

    if (n.centerTime > millis()) {
      n.targetX = width / 2;
      n.targetY = height / 2;
      n.vx += (n.targetX - n.x) * 0.00002;
      n.vy += (n.targetY - n.y) * 0.00002;
    } else {
      n.vx += (n.targetX - n.x) * 0.000003;
      n.vy += (n.targetY - n.y) * 0.000003;
    }
    
    n.x += n.vx; n.y += n.vy;
    n.vx *= 0.88; n.vy *= 0.88; // Slightly more friction for stability
  }
}

function drawNodeHUD(n, age) {
  let opacity = map(age, 0, 600000, 255, 0);
  push(); translate(n.x, n.y);
  
  if (n.pulse > 0) {
    stroke(255, n.pulse * 6); noFill();
    circle(0, 0, 40 + (35 - n.pulse) * 8);
    n.pulse--;
  }

  let b = 45; 
  // TIGHTER LABEL BOX
  fill(0, 0, 0, opacity * 0.8); stroke(0, 255, 255, opacity * 0.3); 
  rectMode(CENTER); rect(0, b + 25, 140, 50, 2);
  
  fill(255, opacity); textFont('monospace'); textSize(11);
  textAlign(CENTER, TOP); text(n.name.toUpperCase(), 0, b + 5);
  
  textSize(8); fill(0, 255, 255, opacity);
  text(`HW:${n.hw} | ${n.rssi}dBm`, 0, b + 18);
  text(`SEEN:${n.lastHeardTime}`, 0, b + 28);
  
  if (n.bubbleTime > millis()) drawSpeechBubble(n, opacity);
  pop();
}

function drawChirpIcon(n) {
  push(); translate(n.x, n.y);
  strokeWeight(2); noFill(); n.chirpPhase += 0.03;
  for (let i = 0; i < 3; i++) {
    let r = 10 + i * 6; let arcSize = QUARTER_PI + sin(n.chirpPhase + i*0.4) * 0.3;
    stroke(0, 255, 255, 255 * (1.0 - i*0.3));
    arc(0, 0, r, r, -arcSize - n.chirpPhase, arcSize - n.chirpPhase);
    stroke(0, 150, 255, 255 * (1.0 - i*0.3));
    arc(0, 0, r + 2, r + 2, PI - arcSize + n.chirpPhase, PI + arcSize + n.chirpPhase);
  }
  fill(255); noStroke(); circle(0, 0, 2);
  pop();
}

function drawSpeechBubble(n, nodeOpacity) {
  let timeLeft = n.bubbleTime - millis();
  let opacity = constrain(map(timeLeft, 0, 1000, 0, 255), 0, 255);
  if (nodeOpacity < opacity) opacity = nodeOpacity;

  push(); resetMatrix(); 
  let txt = String(n.bubbleText).toUpperCase();
  textFont('monospace'); textSize(14);

  let maxW = 300; // Wrap at 300px
  let words = txt.split(' ');
  let line = '';
  let lines = [];

  for (let n_w = 0; n_w < words.length; n_w++) {
    let testLine = line + words[n_w] + ' ';
    let testWidth = textWidth(testLine);
    if (testWidth > maxW && n_w > 0) {
      lines.push(line);
      line = words[n_w] + ' ';
    } else {
      line = testLine;
    }
  }
  lines.push(line);

  let bubbleH = lines.length * 18 + 20;
  let bubbleW = maxW + 30;
  if (lines.length === 1) bubbleW = textWidth(lines[0]) + 30;

  translate(n.x, n.y - (bubbleH / 2 + 60));

  fill(0, 0, 0, opacity); stroke(COLORS.text); strokeWeight(2);
  rectMode(CENTER); rect(0, 0, bubbleW, bubbleH, 6);

  noStroke(); fill(255, opacity); textAlign(CENTER, CENTER);
  for (let i = 0; i < lines.length; i++) {
    text(lines[i], 0, (i - (lines.length - 1) / 2) * 18);
  }
  pop();
}


function drawPacketHUD(p) {
  push();
  let senderName = nodes[p.from] ? nodes[p.from].sname : p.from.substring(p.from.length-4);
  let label = `${senderName}»${p.type.substring(0,4).toUpperCase()}`;
  if (p.type === 'heartbeat') label = "SYNC";
  
  textFont('monospace'); textSize(7);
  let tw = textWidth(label) + 10;
  fill(0, 0, 0, 150); stroke(p.color); strokeWeight(1);
  rectMode(CENTER); rect(p.currentX, p.currentY + 25, tw, 12, 1);
  noStroke(); fill(255); textAlign(CENTER, CENTER); text(label, p.currentX, p.currentY + 25);
  
  if (p.type === 'text' && p.payload) {
    textSize(8); fill(COLORS.text);
    text(p.payload.toUpperCase(), p.currentX, p.currentY + 38);
  }
  pop();
}

function drawGrid() {
  stroke(255, 1);
  for (let x = 0; x < width; x += 500) line(x, 0, x, height);
}

function drawUI() {
  resetMatrix();
  if (showLegend) {
    fill(0, 0, 0, 180); noStroke(); rect(0, 0, 300, 180, 0, 0, 15, 0);
    fill(255, 150); textFont('monospace'); textSize(16); textAlign(LEFT, TOP);
    text("MESHLIGHTER // ADVANCED", 20, 20);
    stroke(255, 40); line(20, 40, 280, 40); noStroke();
    let x = 20, y = 55; textSize(10);
    for (let type in COLORS) {
      if (type === 'data') continue;
      drawKeyItem(x, y, COLORS[type], type.toUpperCase()); y += 18;
    }
  }
}

function drawKeyItem(x, y, col, txt) {
  fill(col); rectMode(CENTER); rect(x + 3, y + 4, 8, 8);
  fill(150); textAlign(LEFT, CENTER); text(txt, x + 15, y + 4);
}

function keyPressed() { if (key === 'h' || key === 'H') showLegend = !showLegend; }
function windowResized() { resizeCanvas(windowWidth, windowHeight); }
