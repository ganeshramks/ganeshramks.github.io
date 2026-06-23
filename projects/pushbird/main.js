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
    // FIXED: Explicitly set top as arms fully extended up, and bottom as bent behind head
    primaryLabel: "ARMS EXTENDED UP (Start)",
    secondaryLabel: "FOREARMS BENT BACKWARD (Bottom)",
    computeReference: (kp) => {
      let lw = kp.find(k => k.name === 'left_wrist' || k.part === 'leftWrist');
      let rw = kp.find(k => k.name === 'right_wrist' || k.part === 'rightWrist');
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
const pipeWidth = 70, pipeSpeed = 2.3; //3
let pipeGap = 160;
let pipeSpawnInterval = 110;

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

  document.getElementById('status').innerText = "Pose Engine Loaded! Choose your workout and click Start Game.";
  document.getElementById('status').style.color = "#ffb300";

  // Bind Dynamic Menu Changer
  document.getElementById('workout-select').onchange = handleWorkoutChange;

  // ⚡ FIXED: Manually trigger a fake event on load so the form coach activates instantly!
  handleWorkoutChange({ target: document.getElementById('workout-select') });

  // Bind Control Buttons
  document.getElementById('start-game-btn').onclick = startOrRunGame;

  detectPose();
}



function startOrRunGame() {
  if (isCalibratingNow || isGameCountingDown) return;
  if (!hasCalibrated) {
    startAutoCalibrationFlow();
  } else {
    triggerGameStartSequence();
  }
}



function handleWorkoutChange(e) {
  currentWorkout = e.target.value;
  if (!currentWorkout) return;

  // FIXED: Clear game states right away to wipe the Game Over overlay
  gameOver = false;
  gameStarted = false;

  topCalibY = null; 
  bottomCalibY = null; 
  hasCalibrated = false; 
  
  const startBtn = document.getElementById('start-game-btn');
  if (startBtn) {
    startBtn.disabled = false;
    startBtn.innerText = `🎮 Start Game (${workoutConfigs[currentWorkout].name})`;
  }
  
  document.getElementById('status').innerText = `Switched to ${workoutConfigs[currentWorkout].name}. Click 'Start Game' to calibrate & play!`;
  document.getElementById('status').style.color = "#ffb300";
}



function startAutoCalibrationFlow() {
  if (isCalibratingNow || isGameCountingDown) return;
  isCalibratingNow = true;
  gameStarted = false;
  gameOver = false; // Wipes game over immediately
  topCalibY = null;
  bottomCalibY = null;
  hasCalibrated = false;
  document.getElementById('start-game-btn').disabled = true;

  const display = document.getElementById('countdown');
  const statusText = document.getElementById('status');
  const conf = workoutConfigs[currentWorkout];

  // --- PHASE 1: COUNTDOWN TO START POSE (STANDING TALL) ---
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
      
      // --- POSTURE GATE FOR THE STANDING START POSE ---
      let checkTopLoop = setInterval(() => {
        let isTopValid = true;

        if (window.lastRawPoses) {
          let kp = window.lastRawPoses.keypoints || window.lastRawPoses;
          if (Array.isArray(kp)) {
            let lh = kp.find(k => k.name === 'left_hip' || k.part === 'leftHip');
            let rh = kp.find(k => k.name === 'right_hip' || k.part === 'rightHip');
            let lk = kp.find(k => k.name === 'left_knee' || k.part === 'leftKnee');
            let rk = kp.find(k => k.name === 'right_knee' || k.part === 'rightKnee');
            let ls = kp.find(k => k.name === 'left_shoulder' || k.part === 'leftShoulder');
            let rs = kp.find(k => k.name === 'right_shoulder' || k.part === 'rightShoulder');

            // Resolve visibility scores safely
            let hScore = lh && rh ? Math.min(lh.score || lh.confidence || 0, rh.score || rh.confidence || 0) : 0;
            let kScore = lk && rk ? Math.min(lk.score || lk.confidence || 0, rk.score || rk.confidence || 0) : 0;

            if (currentWorkout === "squat") {
              // A. Visibility Guard: Force full lower body visibility before snapping Top stance
              if (!lh || !rh || !lk || !rk || hScore < 0.6 || kScore < 0.6 || lk.y >= 470 || rk.y >= 470 || lh.y >= 470 || rh.y >= 470) {
                isTopValid = false;
                display.innerText = "⚠️ KNEES NOT VISIBLE - STEP BACK";
                return;
              }

              let shoulderWidth = Math.abs(ls.x - rs.x);
              let hipWidth = Math.abs(lh.x - rh.x);

              // B. Stance Guard: If legs are completely joined together, reject the pose
              if (hipWidth < shoulderWidth * 0.5) {
                isTopValid = false;
                display.innerText = "HOLD IT... STAND WITH FEET APART!";
                return;
              }

              let verticalDistance = Math.abs(((lk.y + rk.y)/2) - ((lh.y + rh.y)/2));
              let stanceRatio = verticalDistance / shoulderWidth;
              if (stanceRatio < 0.75) {
                isTopValid = false;
                display.innerText = "HOLD IT... STAND UP TALLER!";
              }
            }
            // Maintain old Bicep Curl checks safely
            else if (currentWorkout === "bicep_curl") {
              let lw = kp.find(k => k.name === 'left_wrist' || k.part === 'leftWrist');
              let rw = kp.find(k => k.name === 'right_wrist' || k.part === 'rightWrist');
              let le = kp.find(k => k.name === 'left_elbow' || k.part === 'leftElbow');
              let re = kp.find(k => k.name === 'right_elbow' || k.part === 'rightElbow');
              if (lw && rw && le && re && lw.score > 0.3) {
                if ((lw.y + rw.y)/2 < (le.y + re.y)/2 + 15) { isTopValid = false; display.innerText = "HOLD IT... EXTEND ARMS DOWN!"; }
              } else { isTopValid = false; display.innerText = "⚠️ WRISTS NOT VISIBLE - STEP BACK"; }
            }
            // Maintain old Tricep Extension checks safely
            else if (currentWorkout === "tricep_ext") {
              let lw = kp.find(k => k.name === 'left_wrist' || k.part === 'leftWrist');
              let rw = kp.find(k => k.name === 'right_wrist' || k.part === 'rightWrist');
              if (lw && rw && ls && rs && lw.score > 0.3) {
                if (((lw.y + rw.y)/2) > ((ls.y + rs.y)/2) - 60) { isTopValid = false; display.innerText = "HOLD IT... EXTEND ARMS UP!"; }
              } else { isTopValid = false; display.innerText = "⚠️ UPPER BODY OBSCURED - STEP BACK"; }
            }
          }
        }

        if (isTopValid) {
          clearInterval(checkTopLoop);
          topCalibY = referenceY; 
          playSound('calibrate');
          display.innerText = "📸 START POSE SNAPPED!";

          setTimeout(() => {
            // --- PHASE 2: COUNTDOWN TO END POSE (SQUAT DOWN) ---
            let bottomCountdown = 5;
            statusText.innerText = `2. MOVE NOW: Hold your ${conf.secondaryLabel} position!`;
            statusText.style.color = "#ff1744";
            display.innerText = bottomCountdown;

            let bottomTimer = setInterval(() => {
              bottomCountdown--;
              if (bottomCountdown > 0) {
                display.innerText = bottomCountdown;
              } else {
                clearInterval(bottomTimer);
                
                // --- POSTURE GATE FOR THE END POSE (SQUAT DOWN) ---
                let checkBottomLoop = setInterval(() => {
                  let isBottomValid = true;
                  
                  if (window.lastRawPoses) {
                    let kp = window.lastRawPoses.keypoints || window.lastRawPoses;
                    if (Array.isArray(kp)) {
                      let lk = kp.find(k => k.name === 'left_knee' || k.part === 'leftKnee');
                      let rk = kp.find(k => k.name === 'right_knee' || k.part === 'rightKnee');
                      let kScore = lk && rk ? Math.min(lk.score || lk.confidence || 0, rk.score || rk.confidence || 0) : 0;

                      // 🔒 FIXED CRITICAL BUG: Freeze and deny bottom calibration completely if knees go out of frame
                      if (currentWorkout === "squat" && (!lk || !rk || kScore < 0.6 || lk.y >= 470 || rk.y >= 470)) {
                        isBottomValid = false;
                        display.innerText = "⚠️ KNEES NOT VISIBLE - STEP BACK";
                        return;
                      }

                      if (currentWorkout === "bicep_curl") {
                        if (topCalibY - referenceY < 40) { isBottomValid = false; display.innerText = "HOLD IT... CURL YOUR ARMS UP!"; }
                      } 
                      else if (currentWorkout === "tricep_ext" || currentWorkout === "squat" || currentWorkout === "pushup") {
                        let dropTravelPixels = referenceY - topCalibY;
                        if (currentWorkout === "tricep_ext" && dropTravelPixels < 20) {
                          isBottomValid = false; display.innerText = "HOLD IT... BEND FOREARMS BACKWARD!";
                        } else if (currentWorkout === "squat" && dropTravelPixels < 30) {
                          isBottomValid = false; display.innerText = "HOLD IT... DROP DOWN DEEPER!";
                        } else if (dropTravelPixels < 30 && currentWorkout !== "tricep_ext") {
                          isBottomValid = false; display.innerText = "HOLD IT... DROP DOWN DEEPER!";
                        }
                      }
                    }
                  }

                  if (isBottomValid) {
                    clearInterval(checkBottomLoop);
                    bottomCalibY = referenceY; 
                    playSound('calibrate');
                    display.innerText = "📸 ALL SET! SUITE UNLOCKED!";
                    
                    setTimeout(() => { display.innerText = ""; }, 1500);
                    isCalibratingNow = false;
                    checkCalibrationReady();
                  }
                }, 100);
              }
            }, 1000);
          }, 1500);
        }
      }, 100);
    }
  }, 1000);
}








function checkCalibrationReady() {
  if (topCalibY !== null && bottomCalibY !== null) {
    pushupThreshold = (topCalibY + bottomCalibY) / 2;
    hasCalibrated = true;
    document.getElementById('status').innerText = `${workoutConfigs[currentWorkout].name} Calibrated! Auto-starting game...`;
    document.getElementById('status').style.color = "#2ed573";
    document.getElementById('start-game-btn').disabled = false;
    
    setTimeout(() => {
      triggerGameStartSequence();
    }, 1500);
  }
}


function triggerGameStartSequence() {
  if (!hasCalibrated || isCalibratingNow || isGameCountingDown) return;

  const display = document.getElementById('countdown');
  const statusText = document.getElementById('status');
  
  // 🔒 POSTURE RESTART LOCK: Only block if tracking is completely lost
  if (!window.lastRawPoses) {
    display.innerText = "❌ GET IN POSITION FIRST!";
    statusText.innerText = "Cannot start! No tracking data detected. Stand in view of the camera.";
    statusText.style.color = "#ff1744";
    return; 
  }

  // --- Proceed with game countdown smoothly ---
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
        // CHANGED: Form Coach only runs during active gameplay or calibration countdowns
        // When it is Game Over, it bypasses evaluation and turns off form warnings
        let isBodyFullyVisible = true; 
        if (!gameOver) {
          isBodyFullyVisible = evaluateFormCoaching(kp.keypoints);
        } else {
          // Clear out stale form coach warning alerts when you are resting
          const formText = document.getElementById('form-feedback');
          if (formText) {
            formText.innerText = "⏸️ ROUND OVER - RESTING";
            formText.style.color = "#b0bec5"; // Neutral muted gray
          }
        }


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
  
  // Safely extract the flat keypoints array matrix dynamically 
  let kp = incomingData.keypoints || incomingData;
  if (incomingData && incomingData.keypoints) {
    kp = incomingData.keypoints;
  }

  // Safety falloff: if data isn't compiled yet, flag visibility warning
  if (!Array.isArray(kp)) {
    formText.innerText = "⚠️ SYSTEM SETUP: READING POSTURE PATH...";
    formText.style.color = "#ffb300";
    return false;
  }
  
  // Extract tracking joints safely from normalized keypoint matrix layout
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
    let leftKneeScore = lk ? (lk.score !== undefined ? lk.score : lk.confidence) : 0;
    let rightKneeScore = rk ? (rk.score !== undefined ? rk.score : rk.confidence) : 0;
    
    if (!lk || !rk || leftKneeScore < 0.65 || rightKneeScore < 0.65 || lk.y >= 470 || rk.y >= 470) {
      formText.innerText = "⚠️ KNEES NOT VISIBLE - PLEASE STEP BACK";
      formText.style.color = "#ffb300";
      return false;
    }
    
    if (!ls || !rs || !lh || !rh || lh.y >= 470 || rh.y >= 470) {
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

  // --- 4. FIXED: OVERHEAD TRICEP EXTENSION FORM RULES ---
  else if (currentWorkout === "tricep_ext") {
    // Check if elbows and wrists are actually in frame
    let elbowScore = le && re ? Math.min(le.score || le.confidence || 0, re.score || re.confidence || 0) : 0;
    let wristScore = lw && rw ? Math.min(lw.score || lw.confidence || 0, rw.score || rw.confidence || 0) : 0;

    if (!ls || !rs || !le || !re || !lw || !rw || elbowScore < 0.4 || wristScore < 0.4) {
      formText.innerText = "⚠️ STEP BACK - ENTIRE ARMS AND UPPER BODY MUST BE VISIBLE";
      formText.style.color = "#ffb300";
      return false; 
    }
    
    let elbowWidth = Math.abs(le.x - re.x);
    let shoulderWidth = Math.abs(ls.x - rs.x);
    let wristMidY = (lw.y + rw.y) / 2;
    let shoulderMidY = (ls.y + rs.y) / 2;

    // A. Form Guard: Check if user completely drops their arms below shoulder level
    if (wristMidY > shoulderMidY) {
      formText.innerText = "❌ KEEP ARMS OVERHEAD! DON'T DROP HANDS DOWN";
      formText.style.color = "#ff1744";
      return true;
    }

    // B. Form Guard: Check if elbows flare outwards past a safe alignment multiplier (1.45x shoulder space)
    if (elbowWidth > shoulderWidth * 1.45) {
      formText.innerText = "❌ ELBOWS FLARING WIDE! KEEP THEM TUCKED NEXT TO EARS";
      formText.style.color = "#ff1744";
      return true;
    }
  }
  
  // If no validation errors are flagged across any active exercise profile, pass with green flags
  formText.innerText = "✅ EXCELLENT FORM!";
  formText.style.color = "#2ed573";
  return true;
}

function runGameEngine() {
  birdY = birdY + (targetBirdY - birdY) * 0.15;

  // =========================================================================
  // 🐦 RETRO CANVAS ART BIRD CHARACTER ASSEMBLY
  // =========================================================================
  ctx.save();
  ctx.translate(birdX, birdY);
  
  ctx.beginPath();
  ctx.arc(0, 0, birdSize / 2, 0, 2 * Math.PI);
  ctx.fillStyle = '#ffeb3b'; 
  ctx.strokeStyle = '#000000';
  ctx.lineWidth = 2.5;
  ctx.fill();
  ctx.stroke();

  ctx.beginPath(); ctx.arc(5, -4, 6, 0, 2 * Math.PI); ctx.fillStyle = '#ffffff'; ctx.fill(); ctx.stroke();
  ctx.beginPath(); ctx.arc(7, -4, 2.5, 0, 2 * Math.PI); ctx.fillStyle = '#000000'; ctx.fill();

  ctx.beginPath(); ctx.moveTo(12, -1); ctx.lineTo(24, 3); ctx.lineTo(12, 7); ctx.closePath();
  ctx.fillStyle = '#ff9800'; ctx.fill(); ctx.stroke();

  ctx.beginPath(); ctx.ellipse(-6, 2, 8, 5, Math.PI / 4, 0, 2 * Math.PI); ctx.fillStyle = '#ffffff'; ctx.fill(); ctx.stroke();
  
  ctx.restore();

  // =========================================================================
  // ⚙️ FIXED DYNAMIC DIFFICULTY & WINDOW GAP ADJUSTMENTS
  // =========================================================================
  if (score >= 5 && score < 10) {
    pipeSpawnInterval = 65; // Red Mode: Squeeze pipe spawning frequency closer together
    pipeGap = 135;           // FIXED: Narrow the vertical flight opening for the cardio burst
  } else if (score >= 10) {
    pipeSpawnInterval = 140; // Hold Mode: Give extra travel space between long tunnels
    pipeGap = 145;           // FIXED: Balanced tight window to enforce an exact isometric hold height
  } else {
    pipeSpawnInterval = 110; // Normal Mode
    pipeGap = 160;           // Base calibration standard gap spacing
  }

  if (!isGameCountingDown) {
    frameCounter++;
    
    // Spawns obstacles dynamically based on our adaptive frame intervals
    if (frameCounter % pipeSpawnInterval === 0) {
      // Maximum height variance leaving a tiny 10px margin at screen boundaries
      let topH = Math.random() * (canvas.height - pipeGap - 40) + 10;
      
      let pipeType = "green"; 
      let lengthMultiplier = 1;

      if (score >= 5 && score < 10) {
        pipeType = "red"; 
      } else if (score >= 10) {
        pipeType = "hold"; 
        lengthMultiplier = 2.2; // Extends the tunnel width forcing a long muscle hold
        
        // Lock the next adjacent pipe height to force a continuous flat hold position
        if (pipes.length > 0) topH = pipes[pipes.length - 1].topHeight;
      }

      pipes.push({ 
        x: canvas.width, 
        topHeight: topH, 
        passed: false,
        type: pipeType,
        width: pipeWidth * lengthMultiplier,
        currentGap: pipeGap // FIXED: Attach the current adaptive gap size to this specific pipe instance
      });
    }
    
    for (let i = pipes.length - 1; i >= 0; i--) {
      let p = pipes[i]; 
      p.x -= pipeSpeed;

      // Draw the stylized top and bottom components based on the active color profile configuration
      drawClassicPipe(p.x, 0, p.width, p.topHeight, true, p.type);
      let lowerPipeTopY = p.topHeight + p.currentGap; // Use the attached pipe instance gap
      let lowerPipeHeight = canvas.height - lowerPipeTopY;
      drawClassicPipe(p.x, lowerPipeTopY, p.width, lowerPipeHeight, false, p.type);

      // Collision evaluation matrix
      if (bxCollidesWithVariableWidth(birdX, birdY, birdSize / 2, p)) { 
        gameOver = true; 
        playSound('crash'); 
        if (timerInterval) clearInterval(timerInterval); 
      }
      
      if (!p.passed && p.x + p.width < birdX) { 
        score++; 
        p.passed = true; 
        playSound('score'); 
      }
      
      if (p.x + p.width < 0) pipes.splice(i, 1);
    }
  }

  // --- Render HUD Graphics Panels ---
  ctx.fillStyle = '#ffffff'; ctx.font = 'bold 24px sans-serif'; ctx.textAlign = 'left';
  ctx.fillText(`Score: ${score}`, 20, 40);

  // Print Difficulty Phase Banner Overlays
  ctx.font = 'bold 16px sans-serif';
  if (score >= 5 && score < 10) {
    ctx.fillStyle = '#ff1744'; ctx.fillText(`🔴 DIFFICULT`, 20, 70);
  } else if (score >= 10) {
    ctx.fillStyle = '#ffb300'; ctx.fillText(`💥 HOLD POSE`, 20, 70);
  } else {
    ctx.fillStyle = '#2ed573'; ctx.fillText(`🟢 STEADY`, 20, 70);
  }
  
  let min = Math.floor(elapsedSeconds / 60), sec = elapsedSeconds % 60;
  ctx.fillStyle = '#64ffda'; ctx.textAlign = 'right';
  ctx.fillText(`⏱️ ${min.toString().padStart(2,'0')}:${sec.toString().padStart(2,'0')}`, canvas.width - 20, 40);
  ctx.textAlign = 'left';
}

// Updated safety hitbox compiler to evaluate the specific structural gap size attached to each unique hurdle instance
function bxCollidesWithVariableWidth(bx, by, bradius, pipe) {
  if (bx + bradius > pipe.x && bx - bradius < pipe.x + pipe.width) {
    if (by - bradius < pipe.topHeight || by + bradius > pipe.topHeight + pipe.currentGap) {
      return true;
    }
  }
  return false;
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

// =========================================================================
// 🎨 RETRO 3D SHADED CYLINDRICAL PIPE RENDERING UTILITY
// =========================================================================
function drawClassicPipe(x, y, width, height, isTopPipe) {
  if (height <= 0) return;

  ctx.save();
  
  // 1. Draw Master Cylinder Base Body (Bright Classic Arcade Green)
  ctx.fillStyle = '#73bf2e';
  ctx.strokeStyle = '#000000';
  ctx.lineWidth = 2.5;
  ctx.fillRect(x, y, width, height);
  ctx.strokeRect(x, y, width, height);

  // 2. Render 3D Longitudinal Highlight Shading Lines (Metallic sheen effect)
  // Left side deep dark green shadow edge overlay
  ctx.fillStyle = 'rgba(0, 0, 0, 0.25)';
  ctx.fillRect(x, y, width * 0.15, height);

  // Core bright glossy white reflection sheen streak striping
  ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
  ctx.fillRect(x + (width * 0.22), y, width * 0.12, height);
  
  // Right side subtle shadow accent overlay
  ctx.fillStyle = 'rgba(0, 0, 0, 0.12)';
  ctx.fillRect(x + (width * 0.8), y, width * 0.12, height);

  // 3. Render the Wide Red-and-Green Cylinder Cap Rim
  const capHeight = 32;
  const capExtendedWidth = 6; // Rims flare outwards slightly past the pipe shaft walls
  let capX = x - capExtendedWidth;
  let capWidth = width + (capExtendedWidth * 2);
  let capY = isTopPipe ? (y + height - capHeight) : y;

  // Render Cap Base (Brick Red base detailing rim layer trim band structure)
  ctx.fillStyle = '#d82828'; // Vibrant Arcade Red Rim base coloring
  ctx.fillRect(capX, capY, capWidth, capHeight);
  ctx.strokeRect(capX, capY, capWidth, capHeight);

  // Apply matching cylindrical metallic reflection layers on top of the Cap Rim
  ctx.fillStyle = 'rgba(0, 0, 0, 0.25)';
  ctx.fillRect(capX, capY, capWidth * 0.15, capHeight);

  ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
  ctx.fillRect(capX + (capWidth * 0.22), capY, capWidth * 0.12, capHeight);

  ctx.fillStyle = 'rgba(0, 0, 0, 0.12)';
  ctx.fillRect(capX + (capWidth * 0.8), capY, capWidth * 0.12, capHeight);

  ctx.restore();
}



if (document.readyState === 'complete' || document.readyState === 'interactive') {
  init();
} else {
  window.addEventListener('load', init);
}

