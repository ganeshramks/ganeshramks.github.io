import * as tf from '@tensorflow/tfjs-core';
import '@tensorflow/tfjs-backend-webgl';
import * as poseDetection from '@tensorflow-models/pose-detection';

// --- Core App Settings ---
let video, canvas, ctx, detector;
let currentWorkout = "pushup";
let referenceY = 0;


// --- Multi-Workout Config Profile Matrix ---
const workoutConfigs = {
  pushup: {
    name: "Pushup",
    primaryLabel: "PLANK (Top)",
    secondaryLabel: "DOWN (Bottom)",
    computeReference: (kp) => {
      let nose = kp.find(k => k.name === 'nose');
      let ls = kp.find(k => k.name === 'left_shoulder');
      let rs = kp.find(k => k.name === 'right_shoulder');
      let midX = (ls.x + rs.x) / 2;
      let midY = (ls.y + rs.y) / 2;
      return { x: (midX * 0.8) + (nose.x * 0.2), y: (midY * 0.8) + (midY * 0.2) };
    }
  },
  squat: {
    name: "Squat",
    primaryLabel: "STANDING (Top)",
    secondaryLabel: "SQUAT DOWN (Bottom)",
    computeReference: (kp) => {
      let ls = kp.find(k => k.name === 'left_shoulder');
      let rs = kp.find(k => k.name === 'right_shoulder');
      let lh = kp.find(k => k.name === 'left_hip');
      let rh = kp.find(k => k.name === 'right_hip');
      let lk = kp.find(k => k.name === 'left_knee');
      let rk = kp.find(k => k.name === 'right_knee');

      let chestY = (ls.y + rs.y) / 2;
      let bellyY = (lh.y + rh.y) / 2;
      let kneeY  = (lk.y + rk.y) / 2;

      let chestX = (ls.x + rs.x) / 2;
      let bellyX = (lh.x + rh.x) / 2;
      let kneeX  = (lk.x + rk.x) / 2;

      return { x: (chestX + bellyX + kneeX) / 3, y: (chestY + bellyY + kneeY) / 3 };
    }
  },
  bicep_curl: {
    name: "Bicep Curl",
    primaryLabel: "ARMS DOWN (Start)",
    secondaryLabel: "ARMS CURLED (Top)",
    computeReference: (kp) => {
      let lw = kp.find(k => k.name === 'left_wrist');
      let rw = kp.find(k => k.name === 'right_wrist');
      return { x: (lw.x + rw.x) / 2, y: (lw.y + rw.y) / 2 };
    }
  },
  tricep_ext: {
    name: "Tricep Extension",
    primaryLabel: "ARMS LOCKED OUT (Top)",
    secondaryLabel: "ARMS BENT BACK (Bottom)",
    computeReference: (kp) => {
      let lw = kp.find(k => k.name === 'left_wrist');
      let rw = kp.find(k => k.name === 'right_wrist');
      return { x: (lw.x + rw.x) / 2, y: (lw.y + rw.y) / 2 };
    }
  }
};

// --- Calibration Threshold Profiles ---
let topCalibY = null;   
let bottomCalibY = null;  
let pushupThreshold = 0;
let hasCalibrated = false;
let isCalibratingNow = false; 
let isGameCountingDown = false; 

// --- Flappy Continuous Physics ---
let gameStarted = false;
let gameOver = false;
let score = 0;
let birdY = 240, targetBirdY = 240;
const birdX = 150, birdSize = 34;

let pipes = [];
const pipeWidth = 70, pipeGap = 160, pipeSpeed = 3;
let frameCounter = 0;

// --- Timer Configs ---
let sessionStartTime = 0, elapsedSeconds = 0, timerInterval = null;


async function init() {
  video = document.getElementById('webcam');
  canvas = document.getElementById('output-canvas');
  ctx = canvas.getContext('2d');

  await tf.setBackend('webgl');
  await tf.ready();

  const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 } });
  video.srcObject = stream;

  detector = await poseDetection.createDetector(poseDetection.SupportedModels.BlazePose, { runtime: 'tfjs', modelType: 'lite' });

  document.getElementById('status').innerText = "Pose Engine Loaded! Select Workout & Calibrate.";
  document.getElementById('status').style.color = "#ffb300";

  // Bind Dynamic Menu Changer
  document.getElementById('workout-select').onchange = handleWorkoutChange;

  // ⚡ FIXED: Manually trigger a fake event on load so the form coach activates instantly!
  handleWorkoutChange({ target: document.getElementById('workout-select') });

  // Bind Control Buttons
  document.getElementById('auto-calib-btn').onclick = startAutoCalibrationFlow;
  document.getElementById('start-game-btn').onclick = triggerGameStartSequence;

  detectPose();
}



function handleWorkoutChange(e) {
  currentWorkout = e.target.value;
  topCalibY = null; bottomCalibY = null; hasCalibrated = false; gameStarted = false;
  document.getElementById('start-game-btn').disabled = true;
  document.getElementById('status').innerText = `Switched to ${workoutConfigs[currentWorkout].name}. Click Auto Calibration!`;
  document.getElementById('status').style.color = "#ffb300";
}

function updateButtonLabels() {
  const conf = workoutConfigs[currentWorkout];
  document.getElementById('calib-top-btn').innerText = `1. Calibrate ${conf.primaryLabel}`;
  document.getElementById('calib-bottom-btn').innerText = `2. Calibrate ${conf.secondaryLabel}`;
}


function startAutoCalibrationFlow() {
  if (isCalibratingNow || isGameCountingDown) return;
  isCalibratingNow = true;
  gameStarted = false;
  topCalibY = null;
  bottomCalibY = null;
  hasCalibrated = false;
  document.getElementById('start-game-btn').disabled = true;

  const display = document.getElementById('countdown');
  const statusText = document.getElementById('status');
  const conf = workoutConfigs[currentWorkout];

  // --- PHASE 1: COUNTDOWN TO STAND TALL ---
  let topCountdown = 5;
  statusText.innerText = `1. GET READY: Move into your ${conf.primaryLabel}!`;
  statusText.style.color = "#2196f3";
  display.innerText = topCountdown;

  let topTimer = setInterval(() => {
    topCountdown--;
    if (topCountdown > 0) {
      display.innerText = topCountdown;
    } else {
      clearInterval(topTimer);
      
      // Capture top position instantly at second 0
      topCalibY = referenceY; 
      playSound('calibrate');
      display.innerText = "📸 TOP SNAPPED!";
      
      // Wait 1.5 seconds for visual feedback, then trigger Phase 2 automatically
      setTimeout(() => {
        
        // --- PHASE 2: COUNTDOWN TO LOWER DOWN ---
        let bottomCountdown = 5;
        statusText.innerText = `2. DROP DOWN NOW: Move into your ${conf.secondaryLabel}!`;
        statusText.style.color = "#ff1744";
        display.innerText = bottomCountdown;

        let bottomTimer = setInterval(() => {
          bottomCountdown--;
          if (bottomCountdown > 0) {
            display.innerText = bottomCountdown;
          } else {
            clearInterval(bottomTimer);
            
            // --- FIXED: POSTURE HOLD LOOP (WILL NOT LOCK UNTIL YOU ACTUALLY SQUAT) ---
            let checkBottomLoop = setInterval(() => {
              let isBottomValid = true;
              
              if (currentWorkout === "squat" && window.lastRawPoses) {
                let kp = window.lastRawPoses.keypoints || window.lastRawPoses;
                if (Array.isArray(kp)) {
                  // In camera pixels, referenceY INCREASES as your chest/hips move closer to the floor
                  // Calculate your downward displacement distance relative to your standing topCalibY
                  let dropTravelPixels = referenceY - topCalibY;

                  // ENFORCE SQUAT DEPTH GATING:
                  // Your body center must drop significantly below your standing height anchor.
                  // If you haven't traveled downward by at least 25-30 pixels, hold the shutter open!
                  if (dropTravelPixels < 30) {
                    isBottomValid = false;
                    display.innerText = "HOLD IT... SQUAT DEEPER!";
                  }
                }
              }

              // The exact millisecond your posture is validated, snap the camera shutter!
              if (isBottomValid) {
                clearInterval(checkBottomLoop);
                bottomCalibY = referenceY; // Lock Bottom Coordinate
                
                playSound('calibrate');
                display.innerText = "📸 ALL SET! LOCKED IN!";
                
                setTimeout(() => { display.innerText = ""; }, 1500);
                isCalibratingNow = false;
                checkCalibrationReady();
              }
            }, 100); // Poll your skeleton position 10 times a second

          }
        }, 1000);

      }, 1500);
    }
  }, 1000);
}






function checkCalibrationReady() {
  if (topCalibY !== null && bottomCalibY !== null) {
    pushupThreshold = (topCalibY + bottomCalibY) / 2;
    hasCalibrated = true;
    document.getElementById('status').innerText = `${workoutConfigs[currentWorkout].name} Fully Ready! Click '3. Start Game'.`;
    document.getElementById('status').style.color = "#2ed573";
    document.getElementById('start-game-btn').disabled = false;
  }
}


function triggerGameStartSequence() {
  if (!hasCalibrated || isCalibratingNow || isGameCountingDown) return;

  const display = document.getElementById('countdown');
  const statusText = document.getElementById('status');
  const formText = document.getElementById('form-feedback');
  
  // 🔒 POSTURE RESTART LOCK: Direct validation lookups
  if (window.lastRawPoses) {
    // FIXED: Pass the full person wrapper object instead of raw kp array to match our Form Coach expectations
    let isFormValid = evaluateFormCoaching(window.lastRawPoses);
    
    // If joints are hidden (Coaching text prints a warning "⚠️"), stop the game from launching
    if (!isFormValid || formText.innerText.includes("⚠️")) {
      display.innerText = "❌ GET IN POSITION FIRST!";
      statusText.innerText = "Cannot start! Please step back and stand fully in view of the camera.";
      statusText.style.color = "#ff1744";
      return; 
    }
  }

  // --- Proceed with game countdown if visibility checks pass ---
  isGameCountingDown = true;
  gameStarted = true;
  gameOver = false;
  score = 0;
  birdY = 240; 
  targetBirdY = 240;
  pipes = [];
  frameCounter = 0;

  statusText.innerText = "Mat position verified! Game starting...";
  statusText.style.color = "#2196f3";

  let startCounter = 5;
  display.innerText = `Game starting in: ${startCounter}`;

  let startTimer = setInterval(() => {
    startCounter--;
    if (startCounter > 0) {
      display.innerText = `Game starting in: ${startCounter}`;
    } else {
      clearInterval(startTimer);
      display.innerText = "GO! MOVE UP/DOWN TO MOVE BIRD!";
      
      // Safety release: Unlocks the physics loop engine completely
      isGameCountingDown = false; 

      // Initialize workout session clock
      sessionStartTime = Date.now();
      elapsedSeconds = 0;
      if (timerInterval) clearInterval(timerInterval);
      
      timerInterval = setInterval(() => {
        if (gameStarted && !gameOver) {
          elapsedSeconds = Math.floor((Date.now() - sessionStartTime) / 1000);
        }
      }, 1000);

      setTimeout(() => { display.innerText = ""; }, 1200);
    }
  }, 1000);
}






async function detectPose() {
  if (detector && video.readyState >= 2) {
    const rawPoses = await detector.estimatePoses(video);
    if (rawPoses && rawPoses.length > 0) window.lastRawPoses = rawPoses[0];

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    ctx.save(); ctx.translate(canvas.width, 0); ctx.scale(-1, 1);
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height); ctx.restore();

    if (rawPoses && rawPoses.length > 0) {
      const kp = rawPoses[0];
      if (kp && kp.keypoints) {
        const currentConf = workoutConfigs[currentWorkout];
        let centerRef = currentConf.computeReference(kp.keypoints);
        referenceY = centerRef.y;
        let mirroredX = canvas.width - centerRef.x;

        // Evaluates form and returns false if required joints are not visible
        let isBodyFullyVisible = evaluateFormCoaching(kp.keypoints);

        ctx.beginPath(); ctx.arc(mirroredX, referenceY, 11, 0, 2 * Math.PI);
        ctx.fillStyle = isBodyFullyVisible ? '#ff4757' : '#ff9800'; ctx.fill();

        // CHANGED: The bird will now only track and move if the required joints are fully in frame
        if (isBodyFullyVisible && hasCalibrated && gameStarted && !gameOver && !isCalibratingNow) {
          // 📐 Calculate your actual calibrated distance
            let calibratedDistance = bottomCalibY - topCalibY;
            
            // Expand the required movement range by 20% to reduce sensitivity
            // This pads the boundaries, forcing you to use larger ranges of motion
            let paddedTopY = topCalibY - (calibratedDistance * 0.2);
            let paddedBottomY = bottomCalibY + (calibratedDistance * 0.2);

            // Map your body height using the wider padded boundaries
            let mappedY = mapRange(referenceY, paddedTopY, paddedBottomY, 40, canvas.height - 40);
            targetBirdY = constrainValue(mappedY, 40, canvas.height - 40);
        }
      }
    }
  }

  if (gameStarted && !gameOver) { runGameEngine(); } 
  else if (gameOver) { renderGameOverScreen(); } 
  else if (!gameStarted && !isCalibratingNow) { runPreGameIdleState(); }

  requestAnimationFrame(detectPose);
}


function evaluateFormCoaching(incomingData) {
  const formText = document.getElementById('form-feedback');
  
  // FIXED: Extract the actual flat keypoints array matrix dynamically 
  // safely handles whether the model returns [0].keypoints or flat arrays
  let kp = incomingData.keypoints || incomingData;
  if (incomingData && incomingData[0] && incomingData[0].keypoints) {
    kp = incomingData[0].keypoints;
  }

  // Safety falloff: if data isn't compiled yet, flag visibility warning
  if (!Array.isArray(kp)) {
    formText.innerText = "⚠️ SYSTEM SETUP: READING POSTURE PATH...";
    formText.style.color = "#ffb300";
    return false;
  }
  
  // Extract tracking joints safely from our normalized keypoint matrix layout
  let ls = kp.find(k => k.name === 'left_shoulder' || k.part === 'leftShoulder');
  let rs = kp.find(k => k.name === 'right_shoulder' || k.part === 'rightShoulder');
  let lh = kp.find(k => k.name === 'left_hip' || k.part === 'leftHip');
  let rh = kp.find(k => k.name === 'right_hip' || k.part === 'rightHip');
  let lk = kp.find(k => k.name === 'left_knee' || k.part === 'leftKnee');
  let rk = kp.find(k => k.name === 'right_knee' || k.part === 'rightKnee');
  let le = kp.find(k => k.name === 'left_elbow' || k.part === 'leftElbow');
  let re = kp.find(k => k.name === 'right_elbow' || k.part === 'rightElbow');
  let lw = kp.find(k => k.name === 'left_wrist' || k.part === 'leftWrist');
  let rw = kp.find(k => k.name === 'right_wrist' || k.part === 'rightWrist');

  // --- 1. PUSHUP FORM RULES ---
  if (currentWorkout === "pushup") {
    if (!ls || !rs || !lh || !rh) {
      formText.innerText = "⚠️ STEP BACK - UPPER BODY NOT FULLY VISIBLE";
      formText.style.color = "#ffb300";
      return false; 
    }
    let hipMidY = (lh.y + rh.y) / 2, shMidY = (ls.y + rs.y) / 2;
    if (Math.abs(hipMidY - shMidY) / Math.abs(ls.x - rs.x) < 0.45) {
      formText.innerText = "❌ HIPS SAGGING! TIGHTEN YOUR CORE";
      formText.style.color = "#ff1744";
      return true; 
    }
  } 
  
  // --- 2. SQUAT FORM RULES ---
  else if (currentWorkout === "squat") {
    if (!ls || !rs || !lh || !rh || !lk || !rk) {
      formText.innerText = "⚠️ STEP BACK - ENTIRE BODY MUST BE VISIBLE";
      formText.style.color = "#ffb300";
      return false; 
    }
    
    let kneeDeltaX = Math.abs(lk.x - rk.x);
    let shoulderWidth = Math.abs(ls.x - rs.x);
    
    if (kneeDeltaX < shoulderWidth * 0.85) { 
      formText.innerText = "❌ KNEES CAVING IN! PUSH THEM OUTWARDS";
      formText.style.color = "#ff1744";
      return true;
    }
    
    let chestY = (ls.y + rs.y) / 2;
    let bellyY = (lh.y + rh.y) / 2;
    if (Math.abs(bellyY - chestY) < shoulderWidth * 0.4) {
      formText.innerText = "❌ KEEP YOUR CHEST UP! DON'T LEAN FORWARD";
      formText.style.color = "#ff1744";
      return true;
    }
  }
  
  // --- 3. BICEP CURL FORM RULES ---
  else if (currentWorkout === "bicep_curl") {
    if (!ls || !rs || !le || !re || !lw || !rw) {
      formText.innerText = "⚠️ STEP BACK - ENTIRE ARM MUST BE VISIBLE";
      formText.style.color = "#ffb300";
      return false; 
    }
    
    let elbowWidth = Math.abs(le.x - re.x), shWidth = Math.abs(ls.x - rs.x);
    if (elbowWidth > shWidth * 1.65) {
      formText.innerText = "❌ KEEP ELBOWS PINNED TO YOUR SIDES!";
      formText.style.color = "#ff1744";
      return true;
    }
  }
  
  formText.innerText = "✅ EXCELLENT FORM!";
  formText.style.color = "#2ed573";
  return true;
}



function runGameEngine() {
  birdY = birdY + (targetBirdY - birdY) * 0.15;
  ctx.beginPath(); ctx.arc(birdX, birdY, birdSize / 2, 0, 2 * Math.PI);
  ctx.fillStyle = '#ffeb3b'; ctx.strokeStyle = '#000000'; ctx.lineWidth = 2; ctx.fill(); ctx.stroke();
  ctx.beginPath(); ctx.arc(birdX + 6, birdY - 4, 2, 0, 2 * Math.PI); ctx.fillStyle = '#000000'; ctx.fill();

  if (!isGameCountingDown) {
    frameCounter++;
    if (frameCounter % 110 === 0) {
      let topH = Math.random() * (canvas.height - pipeGap - 80) + 40;
      pipes.push({ x: canvas.width, topHeight: topH, passed: false });
    }
    for (let i = pipes.length - 1; i >= 0; i--) {
      let p = pipes[i]; p.x -= pipeSpeed;
      ctx.fillStyle = '#4caf50';
      ctx.fillRect(p.x, 0, pipeWidth, p.topHeight);
      ctx.fillRect(p.x, p.topHeight + pipeGap, pipeWidth, canvas.height - (p.topHeight + pipeGap));

      if (bxCollides(birdX, birdY, birdSize / 2, p)) { gameOver = true; playSound('crash'); if (timerInterval) clearInterval(timerInterval); }
      if (!p.passed && p.x + pipeWidth < birdX) { score++; p.passed = true; playSound('score'); }
      if (p.x + pipeWidth < 0) pipes.splice(i, 1);
    }
  }

  ctx.fillStyle = '#ffffff'; ctx.font = 'bold 24px sans-serif'; ctx.textAlign = 'left';
  ctx.fillText(`Score: ${score}`, 20, 40);
  let min = Math.floor(elapsedSeconds / 60), sec = elapsedSeconds % 60;
  ctx.fillStyle = '#64ffda'; ctx.textAlign = 'right';
  ctx.fillText(`⏱️ ${min.toString().padStart(2,'0')}:${sec.toString().padStart(2,'0')}`, canvas.width - 20, 40);
  ctx.textAlign = 'left';
}

function bxCollides(bx, by, bradius, pipe) {
  if (bx + bradius > pipe.x && bx - bradius < pipe.x + pipeWidth) {
    if (by - bradius < pipe.topHeight || by + bradius > pipe.topHeight + pipeGap) return true;
  }
  return false;
}

function runPreGameIdleState() {
  ctx.fillStyle = 'rgba(0, 0, 0, 0.4)'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.beginPath(); ctx.arc(birdX, birdY, birdSize / 2, 0, 2 * Math.PI); ctx.fillStyle = '#ffeb3b'; ctx.fill();
}

function renderGameOverScreen() {
  ctx.fillStyle = 'rgba(0, 0, 0, 0.75)'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#f44336'; ctx.font = 'bold 40px sans-serif'; ctx.textAlign = 'center';
  ctx.fillText('GAME OVER', canvas.width / 2, canvas.height / 2 - 20);
  ctx.fillStyle = '#ffffff'; ctx.font = '20px sans-serif';
  ctx.fillText(`Pipes Cleared: ${score} | Time: ${Math.floor(elapsedSeconds/60)}m ${elapsedSeconds%60}s`, canvas.width / 2, canvas.height / 2 + 20);
  ctx.textAlign = 'left';
}

// --- Audio Synth & Utilities ---
let audioCtx = null;
function initAudio() { if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)(); }
function playSound(t) {
  initAudio(); if (!audioCtx) return; const n = audioCtx.currentTime;
  const osc = audioCtx.createOscillator(); const gain = audioCtx.createGain();
  if (t==='calibrate') { osc.frequency.setValueAtTime(550, n); gain.gain.setValueAtTime(0.1, n); gain.gain.exponentialRampToValueAtTime(0.01, n+0.1); }
  else if (t==='score') { osc.type = 'triangle'; osc.frequency.setValueAtTime(587.33, n); osc.frequency.setValueAtTime(698.46, n+0.08); gain.gain.setValueAtTime(0.12, n); gain.gain.exponentialRampToValueAtTime(0.01, n+0.2); }
  else if (t==='crash') { osc.type = 'sawtooth'; osc.frequency.setValueAtTime(140, n); osc.frequency.exponentialRampToValueAtTime(35, n+0.4); gain.gain.setValueAtTime(0.18, n); gain.gain.linearRampToValueAtTime(0.01, n+0.4); }
  osc.connect(gain); gain.connect(audioCtx.destination); osc.start(n); osc.stop(n + 0.4);
}
function mapRange(v, l1, h1, l2, h2) { return l2 + (h2 - l2) * (v - l1) / (h1 - l1); }
function constrainValue(v, min, max) { return Math.min(Math.max(v, min), max); }

window.onload = init;

