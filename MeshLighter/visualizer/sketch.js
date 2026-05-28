let socket;

// Persistent Data
let nodes = {}; 
let bonds = []; // Active links between nodes

// Packet Particle System
const MAX_PACKETS = 400;
let packets = new Array(MAX_PACKETS);
let pIndex = 0;

let showLegend = true;

// Theme Colors
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
  
  let wsHost = location.hostname ? location.hostname : "127.0.0.1";
  socket = new WebSocket("ws://" + wsHost + ":8081");
  socket.onmessage = function(event) {
    try {
      let data = JSON.parse(event.data);
      handleIncomingData(data);
    } catch (e) { console.error(e); }
  };
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
        chirpPhase: random(TWO_PI), bubbleText: "", bubbleTime: 0
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

    if (data.to && nodes[data.to] && data.to !== '0xffffffff') {
      refreshBond(data.from, data.to);
    }
  }

  if (data.type === 'text' && nodes[nodeId]) {
    nodes[nodeId].bubbleText = String(data.payload).substring(0, 40);
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
  p.payload = String(data.payload || "").substring(0, 40);
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

  for (let id in nodes) {
    let n = nodes[id];
    if (!n.active) continue;
    let age = currentTime - n.lastHeard;
    if (age > 1200000) { n.active = false; continue; }
    drawNodeHUD(n, age);
  }
  
  for (let id in nodes) {
    let n = nodes[id];
    if (n.active) drawChirpIcon(n);
  }

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
      if (nodes[p.to] && nodes[p.to].active) nodes[p.to].pulse = 35;
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
      let minDist = 1100;
      if (d < minDist && d > 0) {
        let force = (minDist - d) * 0.0008;
        n1.vx += (dx / d) * force; n1.vy += (dy / d) * force;
        n2.vx -= (dx / d) * force; n2.vy -= (dy / d) * force;
      }
    }
    
    let n = nodes[ids[i]];
    let margin = 280;
    if (n.x < margin) n.vx += (margin - n.x) * 0.02;
    if (n.x > width - margin) n.vx -= (n.x - (width - margin)) * 0.02;
    if (n.y < margin) n.vy += (margin - n.y) * 0.02;
    if (n.y > height - margin) n.vy -= (n.y - (height - margin)) * 0.02;

    n.vx += (n.targetX - n.x) * 0.000003;
    n.vy += (n.targetY - n.y) * 0.000003;
    n.x += n.vx; n.y += n.vy;
    n.vx *= 0.9; n.vy *= 0.9;
  }
}

function drawNodeHUD(n, age) {
  let opacity = map(age, 0, 1000000, 255, 0);
  push(); translate(n.x, n.y);
  
  if (n.pulse > 0) {
    stroke(255, n.pulse * 6); noFill();
    circle(0, 0, 40 + (35 - n.pulse) * 8);
    n.pulse--;
  }

  let b = 45; 
  fill(0, 0, 0, opacity * 0.9); stroke(0, 255, 255, opacity * 0.4); 
  rectMode(CENTER); rect(0, b + 30, 160, 55, 3);
  
  fill(255, opacity); textFont('monospace'); textSize(12);
  textAlign(CENTER, TOP); text(n.name.toUpperCase(), 0, b + 5);
  
  textSize(8); fill(0, 255, 255, opacity);
  text(`ID:${n.id}`, 0, b + 20);
  text(`${n.hw} | ${n.rssi}dBm`, 0, b + 30);
  text(`SEEN:${n.lastHeardTime}`, 0, b + 40);
  
  if (n.bubbleTime > millis()) drawSpeechBubble(n, opacity);
  pop();
}

function drawChirpIcon(n) {
  push(); translate(n.x, n.y);
  strokeWeight(2); noFill(); n.chirpPhase += 0.03;
  for (let i = 0; i < 3; i++) {
    let r = 12 + i * 7; let arcSize = QUARTER_PI + sin(n.chirpPhase + i*0.4) * 0.3;
    stroke(0, 255, 255, 255 * (1.0 - i*0.25));
    arc(0, 0, r, r, -arcSize - n.chirpPhase, arcSize - n.chirpPhase);
    stroke(0, 150, 255, 255 * (1.0 - i*0.25));
    arc(0, 0, r + 2, r + 2, PI - arcSize + n.chirpPhase, PI + arcSize + n.chirpPhase);
  }
  fill(255); noStroke(); circle(0, 0, 3);
  pop();
}

function drawSpeechBubble(n, nodeOpacity) {
  let timeLeft = n.bubbleTime - millis();
  let opacity = constrain(map(timeLeft, 0, 1000, 0, 255), 0, 255);
  if (nodeOpacity < opacity) opacity = nodeOpacity;
  
  push(); resetMatrix(); translate(n.x, n.y - 80);
  let txt = String(n.bubbleText).toUpperCase();
  textFont('monospace'); textSize(16);
  let tw = textWidth(txt) + 25;
  fill(0, 0, 0, opacity); stroke(COLORS.text); strokeWeight(2);
  rectMode(CENTER); rect(0, 0, tw, 35, 6);
  noStroke(); fill(255, opacity); textAlign(CENTER, CENTER); text(txt, 0, 0);
  pop();
}

function drawPacketHUD(p) {
  push();
  let senderName = nodes[p.from] ? nodes[p.from].sname : p.from.substring(p.from.length-4);
  let label = `${senderName}»${p.type.substring(0,4).toUpperCase()}`;
  if (p.type === 'heartbeat') label = "SYNC";
  
  textFont('monospace'); textSize(8);
  let tw = textWidth(label) + 12;
  fill(0, 0, 0, 180); stroke(p.color); strokeWeight(1);
  rectMode(CENTER); rect(p.currentX, p.currentY + 25, tw, 14, 2);
  noStroke(); fill(255); textAlign(CENTER, CENTER); text(label, p.currentX, p.currentY + 25);
  
  if (p.type === 'text' && p.payload) {
    textSize(9); fill(COLORS.text);
    text(p.payload.toUpperCase(), p.currentX, p.currentY + 40);
  }
  pop();
}

function drawGrid() {
  stroke(255, 1);
  for (let x = 0; x < width; x += 400) line(x, 0, x, height);
}

function drawUI() {
  resetMatrix();
  if (showLegend) {
    fill(0, 0, 0, 200); noStroke(); rect(0, 0, 320, 200, 0, 0, 20, 0);
    fill(255, 180); textFont('monospace'); textSize(18); textAlign(LEFT, TOP);
    text("MESHLIGHTER // TACTICAL V3.7", 25, 25);
    stroke(255, 50); line(25, 50, 290, 50); noStroke();
    let x = 25, y = 65; textSize(11);
    for (let type in COLORS) {
      if (type === 'data') continue;
      drawKeyItem(x, y, COLORS[type], type.toUpperCase()); y += 18;
    }
  }
}

function drawKeyItem(x, y, col, txt) {
  fill(col); rectMode(CENTER); rect(x + 4, y + 5, 10, 10);
  fill(180); textAlign(LEFT, CENTER); text(txt, x + 18, y + 5);
}

function keyPressed() { if (key === 'h' || key === 'H') showLegend = !showLegend; }
function windowResized() { resizeCanvas(windowWidth, windowHeight); }
