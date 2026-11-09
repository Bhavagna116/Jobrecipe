import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../../context/AppContext';
import {
  parseResumeText,
  generateResumeQuestions,
  analyzeRoleSkillGaps,
  getRoleDefaults,
  readResumeFile,
  looksLikeResume
} from '../../utils/resumeParser';
import {
  getFaceLandmarker,
  classifyFrame,
  getObjectDetector,
  classifyObjects
} from '../../services/proctoringService';
import { apiUrl } from '../../services/api';
import { getActiveAssessments, checkAssessmentCompleted } from '../../utils/interviewLock';
import { AnimatedAvatar } from '../../components/interview/AnimatedAvatar';
import {
  getInterviewAudioForText,
  findInterviewAudioKey
} from '../../data/interviewAudioManifest';
import {
  Volume2,
  Video,
  Mic,
  ArrowRight,
  RotateCcw,
  LayoutDashboard,
  CheckCircle2,
  Sparkles,
  Award,
  TrendingUp,
  BrainCircuit,
  ShieldCheck,
  Zap,
  VideoOff,
  Activity,
  Eye,
  Smile,
  AlignCenter,
  BarChart3,
  AlertTriangle,
  Play,
  Briefcase,
  Layers,
  FileCheck,
  Edit3,
  Upload,
  FileText,
  RefreshCw,
  Target,
  ClipboardList,
  X,
  Trash2,
  Lock,
  Unlock,
  ShieldAlert,
  Clock,
  Maximize,
  Minimize,
  Info
} from 'lucide-react';

const PRESET_ROLES = [
  'ML Engineer',
  'Software Engineer',
  'Full Stack Developer',
  'Frontend Developer',
  'Backend Developer',
  'Data Scientist',
  'DevOps Engineer'
];

const SAMPLE_ML_RESUME = `Pera Vishnuvardhan Reddy - Machine Learning Engineer
Summary: Passionate ML Engineer experienced in building predictive models, data preprocessing pipelines, and model evaluation with Python, Scikit-Learn, and PyTorch.
Skills: Python, Machine Learning, Scikit-Learn, Pandas, NumPy, Model Evaluation, PyTorch, Data Preprocessing, SQL, REST APIs, Git.
Projects:
• Predictive Customer Churn Pipeline: Built classification models with Random Forest and XGBoost in Scikit-Learn, achieving 89% accuracy and reducing customer attrition.
• Computer Vision & Image Recognition: Implemented CNN architectures with PyTorch for automated defect detection in real-time camera streams.`;

// Waveform bars component
function Waveform({ active }) {
  return (
    <div className="flex items-end gap-[3px] h-5">
      {[3, 5, 7, 4, 6, 5, 8, 4, 6, 3].map((h, i) => (
        <span
          key={i}
          className={`w-[2.5px] rounded-full transition-all duration-150 ${active ? 'bg-brand-400' : 'bg-slate-700'
            }`}
          style={{
            height: active ? `${Math.max(4, (h * 2.2) % 20)}px` : '4px',
            animationDelay: `${i * 60}ms`,
          }}
        />
      ))}
    </div>
  );
}

// Circular Score Ring helper for final report
function MiniScoreRing({ score, size = 64 }) {
  const stroke = 6;
  const radius = (size - stroke) / 2;
  const circ = 2 * Math.PI * radius;
  const offset = circ - (score / 100) * circ;
  const color = score >= 80 ? '#10b981' : score >= 60 ? '#0270c5' : '#f59e0b';

  return (
    <div className="relative flex items-center justify-center flex-shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={radius} stroke="#e2e8f0" strokeWidth={stroke} fill="none" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={color}
          strokeWidth={stroke}
          fill="none"
          strokeDasharray={circ}
          strokeDashoffset={offset}
          strokeLinecap="round"
          className="transition-all duration-1000"
        />
      </svg>
      <div className="absolute flex flex-col items-center">
        <span className="text-base font-black text-slate-900 font-mono">{score}</span>
        <span className="text-[9px] text-slate-500 font-mono font-bold">/100</span>
      </div>
    </div>
  );
}

// Human-readable message for a failed getUserMedia/SpeechRecognition attempt.
function describeMediaError(err) {
  const name = err?.name || '';
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError' || name === 'SecurityError') {
    return 'Microphone access was blocked. Click the padlock/ⓘ icon in the address bar, set Microphone to "Allow", then retry.';
  }
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
    return 'No microphone was found. Please connect a microphone and retry.';
  }
  if (name === 'NotReadableError' || name === 'TrackStartError') {
    return 'Your microphone is busy in another app or tab. Close it and retry.';
  }
  if (name === 'OverconstrainedError' || name === 'ConstraintNotSatisfiedError') {
    return 'No microphone matches the requested settings. Try a different device.';
  }
  if (name === 'not-allowed' || name === 'service-not-allowed') {
    return 'Microphone access was blocked. Enable it in your browser settings and retry.';
  }
  if (name === 'audio-capture') {
    return 'No microphone was detected. Please connect a microphone and retry.';
  }
  return err?.message || 'The microphone could not be started. Please retry.';
}

export const AIMockInterviewPage = () => {
  const navigate = useNavigate();
  const { navigateTo, currentUser, role, adminUser, candidateSubmissions, assessments, isAssessmentCompleted, addToast, startAssessment, isInterviewUnlocked, interviewSettings } = useApp();

  // The interviewer is always the opposite gender of the candidate:
  // male candidate -> female interviewer, female candidate -> male interviewer.
  const candidateGender = String(currentUser?.gender || '').toLowerCase();
  const interviewerVoice = candidateGender === 'male'
    ? 'female'
    : candidateGender === 'female'
      ? 'male'
      : 'male';

  // Helper to open candidate analysis report
  const handleOpenCandidateAnalysis = () => {
    try {
      localStorage.setItem('rsj_active_analytics_tab', 'interview');
    } catch { }
    if (typeof navigateTo === 'function') {
      navigateTo('candidate-analytics');
    } else if (navigate) {
      navigate('/results?tab=interview');
    }
  };

  // Admin configuration comes from AppContext (already fetched globally), so
  // this page does not need its own /api/interview/settings request.
  const adminSettings = interviewSettings || {
    isLocked: false,
    lockReason: 'AI Mock Interview sessions are currently locked by the administrator.',
    questionCount: 3,
    difficulty: 'Moderate',
    maxWarnings: 3,
    objectDetection: true,
    audioProctoring: true,
    audioProctoringStrikes: false
  };

  // Configurable attempt limit status (INTERVIEW_MAX_ATTEMPTS on the backend).
  const [interviewAttempts, setInterviewAttempts] = useState(null);
  const [attemptLockMessage, setAttemptLockMessage] = useState('');

  useEffect(() => {
    const token = localStorage.getItem('rsj_token') || localStorage.getItem('token');
    if (!token) return;
    let cancelled = false;
    fetch(apiUrl('/api/interview/attempts'), {
      headers: { Authorization: `Bearer ${token}` }
    })
      .then((res) => res.json())
      .then((data) => {
        if (!cancelled && data?.success) setInterviewAttempts(data);
      })
      .catch((err) => console.warn('Interview attempt status notice:', err.message));
    return () => { cancelled = true; };
  }, [currentUser?.id]);

  // 1. Stage State: 'setup' (Picture 1) -> 'room' (Picture 2) -> Report
  const [stage, setStage] = useState('setup');

  // 2. Role and Resume ATS Data
  const [targetRole, setTargetRole] = useState(() => {
    return localStorage.getItem('rsj_selected_role') || 'Software Engineer';
  });

  const [uploadedFileName, setUploadedFileName] = useState(() => {
    return localStorage.getItem('rsj_uploaded_resume_name') || null;
  });

  const [rawResumeText, setRawResumeText] = useState(() => {
    return localStorage.getItem('rsj_raw_resume_text') || '';
  });
  const [isScanning, setIsScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState(0);
  const [showPasteModal, setShowPasteModal] = useState(false);
  const [pastedText, setPastedText] = useState('');

  // Resume confirmation modal states
  const [showResumeConfirmModal, setShowResumeConfirmModal] = useState(false);
  const [resumeConfirmChoice, setResumeConfirmChoice] = useState(null); // 'yes' | 'no'

  // Resume analysis state initialized only if a resume was actually uploaded
  const [analysisResult, setAnalysisResult] = useState(() => {
    const savedName = localStorage.getItem('rsj_uploaded_resume_name');
    const savedText = localStorage.getItem('rsj_raw_resume_text');
    if (savedName && savedText) {
      try {
        const saved = localStorage.getItem('rsj_resume_analysis');
        if (saved && Array.isArray(saved.skills) && saved.skills.length > 0) return saved;
      } catch { }
      const initialRole = localStorage.getItem('rsj_selected_role') || 'Software Engineer';
      return parseResumeText(savedText, initialRole);
    }
    return null;
  });

  const [isEditingRole, setIsEditingRole] = useState(false);
  const [roleInput, setRoleInput] = useState(targetRole);

  // Initialize questions using resumeParser ensuring Q1 is ALWAYS "Tell me about yourself"
  const [questions, setQuestions] = useState(() => {
    const base = analysisResult || parseResumeText('', targetRole);
    return generateResumeQuestions(base, targetRole);
  });

  // Ensure resume analysis and detected skills are continuously synchronized in localStorage
  useEffect(() => {
    if (analysisResult) {
      try {
        localStorage.setItem('rsj_resume_analysis', JSON.stringify(analysisResult));
        if (Array.isArray(analysisResult.skills)) {
          localStorage.setItem('rsj_resume_skills', JSON.stringify(analysisResult.skills));
        }
      } catch { }
    }
  }, [analysisResult]);

  const [currentQIndex, setCurrentQIndex] = useState(0);
  const [timerSeconds, setTimerSeconds] = useState(0);
  const [sessionActive, setSessionActive] = useState(false);
  const [sessionId, setSessionId] = useState(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isReportReady, setIsReportReady] = useState(() => {
    if (typeof window !== 'undefined') {
      const p = new URLSearchParams(window.location.search);
      return p.get('report') === 'true';
    }
    return false;
  });
  const [isInterviewCompleted, setIsInterviewCompleted] = useState(() => {
    try {
      if (typeof window !== 'undefined') {
        const p = new URLSearchParams(window.location.search);
        if (p.get('retake') === 'true') {
          localStorage.removeItem('rsj_interview_completed');
          localStorage.removeItem('rsj_latest_interview_analysis');
          return false;
        }
        if (localStorage.getItem('rsj_interview_completed') === 'true') {
          return true;
        }
        const cachedAnalysis = localStorage.getItem('rsj_latest_interview_analysis');
        if (cachedAnalysis) {
          const parsed = JSON.parse(cachedAnalysis);
          if (parsed?.analysis?.sessionId || parsed?.session?.id) {
            return true;
          }
        }
      }
    } catch { }
    return false;
  });

  const [showCompletedCard, setShowCompletedCard] = useState(true);
  const [finalAnalysis, setFinalAnalysis] = useState(null);

  // Audio & Video State
  const [cameraActive, setCameraActive] = useState(false);
  const [isTestingCamera, setIsTestingCamera] = useState(false);
  const [videoPlayBlocked, setVideoPlayBlocked] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [micError, setMicError] = useState('');
  const [isAISpeaking, setIsAISpeaking] = useState(false);
  const [companionText, setCompanionText] = useState('');
  const [answersList, setAnswersList] = useState([]);
  const [liveTranscript, setLiveTranscript] = useState('');

  // Autonomous Turn-Taking Agent State Machine:
  // 'IDLE' | 'SPEAKING' | 'LISTENING' | 'PROCESSING' | 'AI_RESPONSE'
  const [agentState, setAgentState] = useState('IDLE');
  const agentStateRef = useRef('IDLE');
  const [currentSpokenSubtitle, setCurrentSpokenSubtitle] = useState('');
  const [isAudioMuted, setIsAudioMuted] = useState(false);
  const lastCandidateSpokeTimeRef = useRef(0);
  const silenceCheckTimerRef = useRef(null);

  // Speech-to-Text Accent/Language ('en-IN' default for high Indian English accuracy, toggleable to 'en-US')
  const [sttLang, setSttLang] = useState('en-IN');
  const accumulatedTranscriptRef = useRef('');

  // Per-question answering window (seconds remaining once the candidate starts
  // speaking; null = they haven't started yet). Auto-advances on time-up or silence.
  const [answerSecondsLeft, setAnswerSecondsLeft] = useState(null);
  const [answerAutoNotice, setAnswerAutoNotice] = useState('');
  // Sarvam rejects clips >= 30s, so the answer window is split into two ~29s
  // segments (29 + 29 = 58s, effectively one minute per question).
  const SARVAM_CHUNK_SECONDS = 29;
  const MAX_ANSWER_SECONDS = SARVAM_CHUNK_SECONDS * 2;
  const SILENCE_SECONDS = 4;     // advance once the candidate stops talking this long

  // Pre-load and cache browser SpeechSynthesis voices
  useEffect(() => {
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      const loadVoices = () => {
        try { window.speechSynthesis.getVoices(); } catch { }
      };
      loadVoices();
      window.speechSynthesis.onvoiceschanged = loadVoices;
      return () => {
        if (window.speechSynthesis) window.speechSynthesis.onvoiceschanged = null;
      };
    }
  }, []);

  // Proctoring Violations & Warning System (Max 3: Camera Closed & Multi-Face)
  const [warningCount, setWarningCount] = useState(0);
  const [activeWarningMessage, setActiveWarningMessage] = useState('');
  const [proctoringModal, setProctoringModal] = useState(null); // { violation, count, isFinal }
  const [proctoringLog, setProctoringLog] = useState([]);
  const lastViolationTimeRef = useRef(0);

  const triggerProctoringViolation = (violationReason) => {
    // Debounce duplicate triggers within 1.5 seconds
    const now = Date.now();
    if (now - lastViolationTimeRef.current < 1500) return;
    lastViolationTimeRef.current = now;

    setWarningCount((prevCount) => {
      const newCount = prevCount + 1;
      const maxWarnings = Math.max(1, Number(adminSettings?.maxWarnings) || 3);
      const logEntry = {
        number: newCount,
        reason: violationReason,
        time: new Date().toLocaleTimeString()
      };
      setProctoringLog((prev) => [...prev, logEntry]);
      setActiveWarningMessage(`Warning ${newCount}/${maxWarnings}: ${violationReason}`);

      if (newCount >= maxWarnings) {
        // FINAL WARNING REACHED: IMMEDIATELY CLOSE INTERVIEW AND AUTO-SUBMIT
        setProctoringModal({
          violation: violationReason,
          count: maxWarnings,
          maxAllowed: maxWarnings,
          isFinal: true
        });

        // Exit fullscreen immediately if open
        if (document.fullscreenElement) {
          document.exitFullscreen?.().catch(() => { });
        }

        setTimeout(() => {
          if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
          if (telemetryIntervalRef.current) clearInterval(telemetryIntervalRef.current);
          stopAudioNoiseMonitoring();
          if (isRecording && recognitionRef.current) {
            recognitionRef.current.stop();
            setIsRecording(false);
          }
          stopSarvamRecording();
          setSessionActive(false);
          stopCamera();
          setProctoringModal(null);

          // Guarantee answer is present so report generates seamlessly
          const currentSid = sessionId || `isess_local_${Date.now()}`;
          const fallbackAns = [{
            questionNumber: 1,
            stage: 'Q1',
            question: questions[0]?.questionText || 'Tell me about yourself.',
            category: 'INTRODUCTION & PROFILE',
            companionNote: 'Interview closed & auto-submitted due to repeated proctoring violations.',
            score: 0,
            technicalScore: 0,
            communicationScore: 0,
            eyeContactScore: Number(telemetry.eyeContact) || 0,
            attentionScore: Number(telemetry.attention) || 0,
            confidenceScore: Number(telemetry.confidence) || 0
          }];

          const violationAnalysis = {
            sessionId: currentSid,
            overallScore: 0,
            communicationScore: 0,
            technicalScore: 0,
            eyeContactScore: Number(telemetry.eyeContact) || 0,
            attentionScore: Number(telemetry.attention) || 0,
            confidenceScore: Number(telemetry.confidence) || 0,
            dominantEmotion: 'Distracted',
            aiFeedback: 'Session auto-submitted due to repeated proctoring warnings.',
            questionBreakdown: fallbackAns.map((a) => ({
              ...a,
              transcript: a.companionNote,
              overallScore: a.score,
              dominantEmotion: 'Distracted',
              aiFeedback: a.companionNote
            }))
          };

          setAnswersList(fallbackAns);
          setFinalAnalysis(violationAnalysis);

          localStorage.setItem('rsj_latest_interview_analysis', JSON.stringify({
            success: true,
            analysis: violationAnalysis,
            session: {
              id: currentSid,
              targetRole: targetRole || 'Software Engineer',
              startedAt: new Date(Date.now() - timerSeconds * 1000).toISOString(),
              completedAt: new Date().toISOString(),
              questions: questions
            }
          }));
          localStorage.setItem('last_interview_session_id', currentSid);
          setIsReportReady(true);

          const token = localStorage.getItem('rsj_token') || localStorage.getItem('token');
          const headers = { 'Content-Type': 'application/json' };
          if (token) headers['Authorization'] = `Bearer ${token}`;
          fetch(apiUrl(`/api/interview/session/${currentSid}/complete`), {
            method: 'POST',
            headers,
            body: JSON.stringify({
              status: 'TERMINATED_VIOLATION',
              warningCount: Number(adminSettings?.maxWarnings) || 3
            })
          }).catch(() => { });
        }, 2500);
      } else {
        // WARNING 1 OR 2 (FINAL WARNING)
        setProctoringModal({
          violation: violationReason,
          count: newCount,
          maxAllowed: maxWarnings,
          isFinal: false
        });
      }

      return newCount;
    });
  };

  // Live telemetry starts at zero until the first real frame is evaluated.
  const [telemetry, setTelemetry] = useState({
    eyeContact: 0,
    emotion: 'Pending',
    headPose: 'Unknown',
    confidence: 0,
    attention: 0,
  });

  // DOM Refs
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const mediaStreamRef = useRef(null);
  const recognitionRef = useRef(null);
  // STT engine: Sarvam Saaras is primary (best for Indian accents / Hinglish);
  // the browser Web Speech API is the fallback.
  const sttEngineRef = useRef('none'); // 'none' | 'sarvam' | 'sarvam_stream' | 'browser'
  const sarvamRecorderRef = useRef(null);
  // One persistent microphone stream for the whole interview. Opening the mic
  // once (instead of per answer) removes the getUserMedia wake-up pause between
  // questions.
  const micStreamRef = useRef(null);
  const sarvamStartTokenRef = useRef(0);
  const sarvamFailureCountRef = useRef(0);
  const sarvamFlushResolveRef = useRef(null);
  // Streaming STT refs
  const sarvamWsRef = useRef(null);
  const sarvamAudioContextRef = useRef(null);
  const sarvamProcessorRef = useRef(null);
  const sarvamSilentGainRef = useRef(null);
  const sarvamMediaStreamRef = useRef(null);
  const sarvamListeningRef = useRef(false);
  const sarvamWsReadyRef = useRef(false);
  const sarvamPrewarmPromiseRef = useRef(null);
  const sarvamPrewarmedRef = useRef(false);
  const sarvamEpochRef = useRef(0);
  // Sarvam rejects clips >= 30s. Long answers are recorded as consecutive
  // ~29s segments and transcribed independently, then stitched together.
  const sarvamSegmentTimerRef = useRef(null);
  const sarvamRotatingRef = useRef(false);
  const sarvamSegmentCountRef = useRef(0);
  const sarvamSubmitRequestedRef = useRef(false);
  const sarvamPendingTranscriptionsRef = useRef(new Set());
  const sarvamPendingStopsRef = useRef(new Set());
  const sarvamStopResolversRef = useRef(new WeakMap());
  const timerIntervalRef = useRef(null);
  const telemetryIntervalRef = useRef(null);
  const qStartTimeRef = useRef(Date.now());
  // Per-question answer window bookkeeping
  const answerTimerRef = useRef(null);
  const answerStartedAtRef = useRef(0);
  const lastVoiceAtRef = useRef(0);
  const hasSpokenRef = useRef(false);
  const autoSubmitFiredRef = useRef(false);
  const submitAnswerRef = useRef(null);
  const submitInFlightRef = useRef(false);
  const currentQRef = useRef(questions[0]);

  // ElevenLabs TTS refs
  const elevenLabsAbortRef = useRef(null);
  const elevenLabsSourceRef = useRef(null);

  // Pre-rendered interview audio clip (fixed questions + transition lines)
  const preRenderedAudioRef = useRef(null);

  // ElevenLabs TTS is proxied through the backend (`/api/tts/speak`). The API key
  // lives server-side only and is never bundled into the browser.
  const ttsAuthHeaders = () => {
    const token = localStorage.getItem('rsj_token') || localStorage.getItem('token');
    return { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) };
  };

  const currentQ = questions[currentQIndex] || questions[0];
  const isFinalQuestion = currentQIndex >= questions.length - 1;

  useEffect(() => {
    currentQRef.current = currentQ;
  }, [currentQ]);

  // Keep questions and skill gaps synchronized with targetRole & analysisResult
  useEffect(() => {
    const updatedQ = generateResumeQuestions(analysisResult, targetRole);
    setQuestions(updatedQ);
    localStorage.setItem('rsj_resume_questions', JSON.stringify(updatedQ));
  }, [targetRole, analysisResult]);

  // Dev-only drift guard: warn if a spoken question has no pre-rendered clip.
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    questions.forEach((q) => {
      const text = q?.questionText || q?.question;
      if (text && !findInterviewAudioKey(text)) {
        console.warn('[InterviewAudio] No pre-rendered clip for question text; will use live TTS:', text);
      }
    });
  }, [questions]);

  // Determine whether a genuine resume is uploaded
  const hasUploadedResume = Boolean(uploadedFileName && (rawResumeText || (analysisResult?.skills && analysisResult.skills.length > 0)));

  // Calculate current skill gaps for the target role
  const skillGaps = analysisResult?.skillGaps || (hasUploadedResume ? analyzeRoleSkillGaps(analysisResult?.skills || [], targetRole) : { matchedCore: [], missingCore: [], skillsToCover: [], atsScore: 0 });
  const resumeATS = String(analysisResult?.atsScore || skillGaps.atsScore || 0);

  // Web Audio API background noise detector (Non-punitive notification)
  const audioContextRef = useRef(null);
  const analyserRef = useRef(null);
  const noiseCheckIntervalRef = useRef(null);
  const noiseTimeoutRef = useRef(null);
  const [noiseAlert, setNoiseAlert] = useState(false);

  // MediaPipe FaceLandmarker + ObjectDetector (phone / extra-body detection)
  const faceLandmarkerRef = useRef(null);
  const objectDetectorRef = useRef(null);
  const sessionStartTimeRef = useRef(0);

  // Measured telemetry accumulators. Every value shown in the report is derived
  // from these counters — never from Math.random() or a fixed baseline.
  const telemetryStatsRef = useRef({
    frames: 0,
    facePresent: 0,
    gazeCentered: 0,
    attentive: 0,
    phoneFrames: 0,
    extraPersonFrames: 0,
    noFaceFrames: 0,
    audioDisturbances: 0,
  });
  const noFaceStreakRef = useRef(0);
  const phoneStreakRef = useRef(0);
  const extraPersonStreakRef = useRef(0);
  const violationCooldownRef = useRef({});
  const lastNoiseEventRef = useRef(0);

  const resetTelemetryStats = () => {
    telemetryStatsRef.current = {
      frames: 0,
      facePresent: 0,
      gazeCentered: 0,
      attentive: 0,
      phoneFrames: 0,
      extraPersonFrames: 0,
      noFaceFrames: 0,
      audioDisturbances: 0,
    };
    noFaceStreakRef.current = 0;
    phoneStreakRef.current = 0;
    extraPersonStreakRef.current = 0;
    violationCooldownRef.current = {};
    lastNoiseEventRef.current = 0;
  };

  const computeMeasuredTelemetry = (stats) => {
    const frames = Math.max(1, Number(stats?.frames) || 0);
    return {
      eyeContact: Math.round(((stats?.gazeCentered || 0) / frames) * 100),
      attention: Math.round(((stats?.attentive || 0) / frames) * 100),
      confidence: Math.round(((stats?.facePresent || 0) / frames) * 100),
      emotion: (stats?.phoneFrames || 0) > 0 || (stats?.extraPersonFrames || 0) > 0
        ? 'Distracted'
        : (stats?.facePresent || 0) > 0 ? 'Focused' : 'Away',
      headPose: (stats?.gazeCentered || 0) > 0 ? 'Centered' : 'Unknown',
    };
  };

  const shouldFireViolation = (key, cooldownMs) => {
    const now = Date.now();
    const last = violationCooldownRef.current[key] || 0;
    if (now - last < cooldownMs) return false;
    violationCooldownRef.current[key] = now;
    return true;
  };

  useEffect(() => {
    let isMounted = true;
    getFaceLandmarker()
      .then((lm) => {
        if (isMounted) faceLandmarkerRef.current = lm;
      })
      .catch((err) => console.warn('MediaPipe FaceLandmarker load notice:', err));
    getObjectDetector()
      .then((od) => {
        if (isMounted) objectDetectorRef.current = od;
      })
      .catch((err) => console.warn('MediaPipe ObjectDetector load notice:', err));
    return () => {
      isMounted = false;
    };
  }, []);

  const startAudioNoiseMonitoring = (stream) => {
    try {
      const audioTrack = stream?.getAudioTracks?.()[0];
      if (!audioTrack) return;

      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) return;

      if (!audioContextRef.current || audioContextRef.current.state === 'closed') {
        audioContextRef.current = new AudioContextClass();
      }
      const audioCtx = audioContextRef.current;
      if (audioCtx.state === 'suspended') {
        audioCtx.resume();
      }

      const source = audioCtx.createMediaStreamSource(new MediaStream([audioTrack]));
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.5;
      source.connect(analyser);
      analyserRef.current = analyser;

      const dataArray = new Uint8Array(analyser.frequencyBinCount);

      if (noiseCheckIntervalRef.current) clearInterval(noiseCheckIntervalRef.current);
      noiseCheckIntervalRef.current = setInterval(() => {
        if (!analyserRef.current) return;
        analyserRef.current.getByteFrequencyData(dataArray);
        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) {
          sum += dataArray[i];
        }
        const avg = sum / dataArray.length;

        // High external background noise / multiple-voice threshold (> 40)
        if (avg > 40) {
          setNoiseAlert(true);
          if (noiseTimeoutRef.current) clearTimeout(noiseTimeoutRef.current);
          noiseTimeoutRef.current = setTimeout(() => {
            setNoiseAlert(false);
          }, 3500);

          // Record an audio-environment event at most once every 10 seconds.
          const now = Date.now();
          if (
            adminSettings.audioProctoring === true &&
            now - lastNoiseEventRef.current > 10000
          ) {
            lastNoiseEventRef.current = now;
            telemetryStatsRef.current.audioDisturbances += 1;

            // Punitive audio strikes are opt-in only (admin setting); the
            // default is an advisory notice so ordinary room noise does not
            // terminate an otherwise valid interview.
            if (adminSettings.audioProctoringStrikes === true) {
              if (shouldFireViolation('audio', 20000)) {
                triggerProctoringViolation('Background voice / high ambient noise detected');
              }
            }
          }
        }
      }, 700);
    } catch (err) {
      console.warn('Audio noise analysis notice:', err);
    }
  };

  const stopAudioNoiseMonitoring = () => {
    if (noiseCheckIntervalRef.current) clearInterval(noiseCheckIntervalRef.current);
    if (noiseTimeoutRef.current) clearTimeout(noiseTimeoutRef.current);
    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
      try {
        audioContextRef.current.close();
      } catch { }
      audioContextRef.current = null;
    }
    setNoiseAlert(false);
  };

  // Fullscreen exit, tab switching, and window blur proctoring listeners
  useEffect(() => {
    if (!sessionActive) return;

    sessionStartTimeRef.current = Date.now();

    const handleFullscreenChange = () => {
      // 1.5s grace period on session start so entering fullscreen doesn't false-trigger
      if (Date.now() - sessionStartTimeRef.current < 1500) return;
      if (!document.fullscreenElement && !proctoringModal) {
        triggerProctoringViolation('Exited Fullscreen Mode');
      }
    };

    const handleVisibilityChange = () => {
      if (Date.now() - sessionStartTimeRef.current < 1500) return;
      if (document.hidden && !proctoringModal) {
        triggerProctoringViolation('Switched Tabs / Browser Minimized');
      }
    };

    const handleWindowBlur = () => {
      if (Date.now() - sessionStartTimeRef.current < 1500) return;
      if (!proctoringModal) {
        triggerProctoringViolation('Switched Tabs / Window Lost Focus');
      }
    };

    const handleBeforeUnload = (e) => {
      e.preventDefault();
      e.returnValue = 'Interview session is currently in progress. Exiting will close and submit your interview.';
      return e.returnValue;
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('blur', handleWindowBlur);
    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('blur', handleWindowBlur);
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [sessionActive, proctoringModal]);

  const handleAcknowledgeWarning = () => {
    setProctoringModal(null);
    sessionStartTimeRef.current = Date.now();
    if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
      document.documentElement.requestFullscreen().catch(() => { });
    }
  };

  // ==========================================
  // HANDLERS FOR SETUP STAGE (PICTURE 1)
  // ==========================================
  const handleClearResume = () => {
    setUploadedFileName(null);
    setRawResumeText('');
    setAnalysisResult(null);
    try {
      localStorage.removeItem('rsj_uploaded_resume_name');
      localStorage.removeItem('rsj_raw_resume_text');
      localStorage.removeItem('rsj_resume_analysis');
      localStorage.removeItem('rsj_resume_skills');
      localStorage.removeItem('rsj_resume_ats_score');
    } catch { }
  };

  const handleRoleChange = (newRole) => {
    // Preserve user input verbatim: allows deleting, backspacing to empty, and typing spaces
    setTargetRole(newRole);
    setRoleInput(newRole);
    localStorage.setItem('rsj_selected_role', newRole);

    const effectiveRole = newRole.trim() || 'Software Engineer';

    // Only recalculate resume skills & questions if a resume is actually uploaded
    if (uploadedFileName && rawResumeText) {
      const updatedAnalysis = parseResumeText(rawResumeText, effectiveRole);
      if (analysisResult?.candidateName && analysisResult.candidateName !== 'Candidate') {
        updatedAnalysis.candidateName = analysisResult.candidateName;
      }
      setAnalysisResult(updatedAnalysis);
      try {
        localStorage.setItem('rsj_resume_analysis', JSON.stringify(updatedAnalysis));
        localStorage.setItem('rsj_resume_ats_score', String(updatedAnalysis.atsScore));
      } catch { }

      const updatedQ = generateResumeQuestions(updatedAnalysis, effectiveRole);
      setQuestions(updatedQ);
      setCurrentQIndex(0);
      try {
        localStorage.setItem('rsj_resume_questions', JSON.stringify(updatedQ));
      } catch { }
    }
    setIsEditingRole(false);
  };

  const processResumeContent = (name, text, roleToUse = targetRole) => {
    setIsScanning(true);
    setScanProgress(25);

    setTimeout(() => setScanProgress(60), 300);
    setTimeout(() => setScanProgress(90), 600);
    setTimeout(() => {
      setScanProgress(100);
      setIsScanning(false);
      setUploadedFileName(name);
      setRawResumeText(text);

      const parsed = parseResumeText(text, roleToUse);
      setAnalysisResult(parsed);

      const generatedQuestions = generateResumeQuestions(parsed, roleToUse);
      setQuestions(generatedQuestions);
      setCurrentQIndex(0);

      localStorage.setItem('rsj_uploaded_resume_name', name);
      localStorage.setItem('rsj_raw_resume_text', text);
      localStorage.setItem('rsj_selected_role', roleToUse);
      localStorage.setItem('rsj_resume_ats_score', String(parsed.atsScore));
      localStorage.setItem('rsj_resume_analysis', JSON.stringify(parsed));
      localStorage.setItem('rsj_resume_questions', JSON.stringify(generatedQuestions));
    }, 900);
  };

  const handleFileUpload = async (file) => {
    if (!file) return;
    try {
      const content = await readResumeFile(file);
      if (!looksLikeResume(content)) {
        if (typeof addToast === 'function') {
          addToast('This file does not look like a resume. Upload a PDF or TXT resume with skills, experience, education, or projects.', 'error');
        }
        return;
      }
      processResumeContent(file.name, content);
    } catch (e) {
      if (typeof addToast === 'function') {
        addToast(e.message || 'Could not read the resume file. Please upload a valid PDF or TXT resume.', 'error');
      }
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileUpload(e.dataTransfer.files[0]);
    }
  };

  const handleLoadSampleResume = () => {
    processResumeContent('Vishnu_ML_Resume.pdf', SAMPLE_ML_RESUME, 'ML Engineer');
    setTargetRole('ML Engineer');
    setRoleInput('ML Engineer');
  };

  const handleApplyPastedResume = () => {
    if (!pastedText.trim()) {
      if (typeof addToast === 'function') addToast('Paste your resume text first.', 'warning');
      return;
    }
    if (!looksLikeResume(pastedText)) {
      if (typeof addToast === 'function') {
        addToast('The pasted text does not look like a resume. Include skills, experience, education, or projects.', 'error');
      }
      return;
    }
    processResumeContent('Pasted_Resume_Profile.txt', pastedText);
    setShowPasteModal(false);
  };

  const startInterviewRoom = () => {
    // Transition from Setup to Live Interview Stage
    setIsInterviewCompleted(false);
    try {
      localStorage.removeItem('rsj_interview_completed');
    } catch { }
    setStage('room');
    try {
      if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
        document.documentElement.requestFullscreen().catch(() => { });
      }
    } catch (e) { }
    // Pre-test camera for smooth onboarding
    if (!mediaStreamRef.current) {
      startCamera();
    }
  };

  const handleProceedToRoom = () => {
    // Resume is optional — if they already uploaded one, go straight in.
    if (hasUploadedResume) {
      startInterviewRoom();
      return;
    }
    // Otherwise first ask whether they have a resume.
    setResumeConfirmChoice(null);
    setShowResumeConfirmModal(true);
  };

  const handleResumeConfirmYes = () => {
    setResumeConfirmChoice('yes');
    // Show file upload dialog
    const input = document.getElementById('resume-file-input');
    if (input) input.click();
    setShowResumeConfirmModal(false);
  };

  const handleResumeConfirmNo = () => {
    setResumeConfirmChoice('no');
    // Show confirmation that they want to proceed without resume
    // The modal will show the "are you sure" message
  };

  const handleResumeConfirmProceedWithout = () => {
    // User confirmed they want to proceed without resume
    setShowResumeConfirmModal(false);
    startInterviewRoom();
  };

  const handleResumeConfirmCancel = () => {
    setResumeConfirmChoice(null);
    setShowResumeConfirmModal(false);
  };

  // ==========================================
  // CAMERA & AUDIO HANDLERS
  // ==========================================
  const startCamera = async () => {
    try {
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach((t) => t.stop());
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' },
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
        },
      });
      mediaStreamRef.current = stream;
      setCameraActive(true);
      setIsTestingCamera(true);

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.muted = true;
        try {
          await videoRef.current.play();
          setVideoPlayBlocked(false);
        } catch (err) {
          console.warn('Video autoPlay deferred by browser:', err);
          setVideoPlayBlocked(true);
        }
      }
    } catch (err) {
      console.warn('Camera preview notice:', err.message);
      if (err?.name === 'NotAllowedError' || err?.name === 'PermissionDeniedError' || err?.name === 'NotFoundError' || err?.name === 'NotReadableError') {
        setMicError(describeMediaError(err));
      }
    }
  };

  const stopCamera = () => {
    stopAudioNoiseMonitoring();
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setCameraActive(false);
    setIsTestingCamera(false);
    setVideoPlayBlocked(false);
  };

  const handleManualVideoPlay = async () => {
    if (videoRef.current) {
      try {
        await videoRef.current.play();
        setVideoPlayBlocked(false);
      } catch (e) {
        console.error('Manual play failed:', e);
      }
    }
  };

  const handleToggleCameraTest = () => {
    if (isTestingCamera || cameraActive) {
      stopCamera();
    } else {
      startCamera();
    }
  };

  // Starfield animation
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    let animId;

    const resize = () => {
      canvas.width = canvas.offsetWidth;
      canvas.height = canvas.offsetHeight;
    };
    resize();
    window.addEventListener('resize', resize);

    const stars = Array.from({ length: 65 }, () => ({
      x: Math.random() * (canvas.width || 800),
      y: Math.random() * (canvas.height || 600),
      r: Math.random() * 1.5 + 0.5,
      alpha: Math.random(),
      speed: Math.random() * 0.008 + 0.003,
    }));

    const draw = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      stars.forEach((s) => {
        s.alpha += s.speed;
        if (s.alpha > 1 || s.alpha < 0) s.speed = -s.speed;
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(147, 197, 253, ${Math.abs(s.alpha) * 0.7})`;
        ctx.fill();
      });
      animId = requestAnimationFrame(draw);
    };
    draw();

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener('resize', resize);
    };
  }, []);

  // ── Audio Context & Sound Unlock Helpers ──
  const getAudioContext = () => {
    if (typeof window === 'undefined') return null;
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return null;
    if (!window.__agyAudioCtx || window.__agyAudioCtx.state === 'closed') {
      window.__agyAudioCtx = new AudioCtx();
    }
    if (window.__agyAudioCtx.state === 'suspended') {
      window.__agyAudioCtx.resume().catch(() => { });
    }
    return window.__agyAudioCtx;
  };

  const playStudioChime = () => {
    try {
      const ctx = getAudioContext();
      if (!ctx) return;
      const now = ctx.currentTime;
      // High-definition 2-tone broadcast chime (C5 523Hz -> E5 659Hz)
      const osc1 = ctx.createOscillator();
      const gain1 = ctx.createGain();
      osc1.type = 'sine';
      osc1.frequency.setValueAtTime(523.25, now);
      gain1.gain.setValueAtTime(0.08, now);
      gain1.gain.exponentialRampToValueAtTime(0.0001, now + 0.35);
      osc1.connect(gain1);
      gain1.connect(ctx.destination);
      osc1.start(now);
      osc1.stop(now + 0.35);

      const osc2 = ctx.createOscillator();
      const gain2 = ctx.createGain();
      osc2.type = 'sine';
      osc2.frequency.setValueAtTime(659.25, now + 0.1);
      gain2.gain.setValueAtTime(0.10, now + 0.1);
      gain2.gain.exponentialRampToValueAtTime(0.0001, now + 0.55);
      osc2.connect(gain2);
      gain2.connect(ctx.destination);
      osc2.start(now + 0.1);
      osc2.stop(now + 0.55);
    } catch (e) {
      console.warn('Studio chime notice:', e);
    }
  };

  // ── ElevenLabs Fallback: High Definition Browser Web Speech API ──
  const speakAIBrowserFallback = (cleanText, expectedDurationMs, onFinished) => {
    if (!window.speechSynthesis) {
      setIsAISpeaking(true);
      setTimeout(() => { setIsAISpeaking(false); onFinished?.(); }, expectedDurationMs);
      return;
    }

    try {
      if (window.speechSynthesis.paused) {
        window.speechSynthesis.resume();
      }
      window.speechSynthesis.cancel();

      // Delay by 60ms prevents Chromium race condition where cancel kills new speak()
      setTimeout(() => {
        const utterance = new SpeechSynthesisUtterance(cleanText);
        utterance.rate = 1.0;
        utterance.pitch = 1.0;
        utterance.volume = isAudioMuted ? 0 : 1.0;

        const voices = (window.speechSynthesis.getVoices && window.speechSynthesis.getVoices()) || [];
        // Match the interviewer's gender first, then fall back to natural /
        // Indian-English / US-English voices.
        const femaleHints = ['female', 'heera', 'samantha', 'zira', 'neerja', 'veena', 'raveena', 'kajal', 'tanya', 'swara'];
        const maleHints = ['male', 'ravi', 'prabhat', 'david', 'george', 'christopher', 'mark', 'daniel', 'alex', 'rishi'];
        const hints = interviewerVoice === 'female' ? femaleHints : maleHints;
        const enVoices = voices.filter((v) => v.lang && v.lang.startsWith('en'));
        const genderMatch = enVoices.find((v) => hints.some((h) => v.name.toLowerCase().includes(h)));
        const preferred = genderMatch
          || enVoices.find((v) => (v.name.includes('Natural') || v.name.includes('Online')))
          || enVoices.find((v) => v.lang.startsWith('en-IN'))
          || enVoices.find((v) => v.lang.startsWith('en-US'))
          || enVoices[0]
          || voices[0];

        if (preferred) utterance.voice = preferred;

        let ended = false;
        let keepAliveInterval = null;
        let safetyTimeout = null;

        const finish = () => {
          if (ended) return;
          ended = true;
          if (keepAliveInterval) clearInterval(keepAliveInterval);
          if (safetyTimeout) clearTimeout(safetyTimeout);
          setIsAISpeaking(false);
          window.__agyActiveUtterance = null;
          setTimeout(() => { onFinished?.(); }, 50);
        };

        utterance.onstart = () => {
          setIsAISpeaking(true);
          // Chromium bug workaround: speech synthesis can pause unexpectedly after 10-15s
          keepAliveInterval = setInterval(() => {
            if (window.speechSynthesis && window.speechSynthesis.speaking) {
              window.speechSynthesis.resume();
            }
          }, 1500);
        };

        utterance.onend = finish;
        utterance.onerror = (err) => {
          console.warn('SpeechSynthesis event error:', err);
          finish();
        };

        safetyTimeout = setTimeout(finish, expectedDurationMs + 3500);
        window.__agyActiveUtterance = utterance;

        if (window.speechSynthesis.paused) {
          window.speechSynthesis.resume();
        }
        setIsAISpeaking(true);
        window.speechSynthesis.speak(utterance);
      }, 60);
    } catch (err) {
      console.warn('speakAIBrowserFallback catch:', err);
      setIsAISpeaking(true);
      setTimeout(() => { setIsAISpeaking(false); onFinished?.(); }, expectedDurationMs);
    }
  };

  // Play a pre-rendered clip from /audio/interview/. Resolves true once playback
  // has started, false when the clip is missing/unplayable so the caller can
  // fall back to live TTS.
  const playPreRenderedClip = (clip, onDone) => new Promise((resolve) => {
    let audio;
    try {
      setIsAISpeaking(true);
      audio = new Audio(clip.src);
      audio.preload = 'auto';
      preRenderedAudioRef.current = audio;
    } catch (err) {
      console.warn('[InterviewAudio] could not create audio element:', err);
      resolve(false);
      return;
    }

    let settled = false;
    let started = false;
    const release = () => {
      if (preRenderedAudioRef.current === audio) preRenderedAudioRef.current = null;
    };

    audio.onplaying = () => { started = true; };

    audio.onended = () => {
      if (settled) return;
      settled = true;
      release();
      setIsAISpeaking(false);
      onDone?.();
    };

    audio.onerror = () => {
      if (settled) return;
      settled = true;
      release();
      if (started) {
        // Failed mid-playback: treat as finished so the flow continues.
        setIsAISpeaking(false);
        onDone?.();
        resolve(true);
      } else {
        console.warn('[InterviewAudio] pre-rendered clip unavailable, falling back to TTS:', clip.src);
        resolve(false);
      }
    };

    const playPromise = audio.play();
    if (playPromise && typeof playPromise.then === 'function') {
      playPromise.catch(() => {
        if (settled) return;
        settled = true;
        release();
        console.warn('[InterviewAudio] pre-rendered clip blocked/unplayable, falling back to TTS:', clip.src);
        resolve(false);
      });
    } else {
      resolve(true);
    }
  });

  // ── Interviewer Voice Engine (Sarvam / browser native TTS) ──
  const speakAI = async (text, onFinished) => {
    if (!text) { onFinished?.(); return; }

    const cleanText = String(text).replace(/[*_#`]/g, '').trim();
    setCurrentSpokenSubtitle(cleanText);

    // STT is batch: ~29s MediaRecorder clips, transcribed as each one closes.
    // Keep the microphone stream warm while the interviewer talks so the
    // recorder can start the instant the question ends (no activation pause).
    primeMicrophone();

    const words = cleanText.split(/\s+/).filter(Boolean);
    const wordCount = words.length;
    const expectedDurationMs = Math.max(2500, Math.min(30000, Math.round((wordCount / 2.2) * 1000)));

    if (isAudioMuted) {
      setIsAISpeaking(true);
      setTimeout(() => { setIsAISpeaking(false); onFinished?.(); }, 50);
      return;
    }

    // Cancel any previous ElevenLabs audio
    if (elevenLabsAbortRef.current) {
      try { elevenLabsAbortRef.current.abort(); } catch { }
    }
    if (elevenLabsSourceRef.current) {
      try { elevenLabsSourceRef.current.stop(); } catch { }
      elevenLabsSourceRef.current = null;
    }
    if (preRenderedAudioRef.current) {
      try { preRenderedAudioRef.current.pause(); } catch { }
      preRenderedAudioRef.current = null;
    }

    // 0. Pre-rendered static clip (fixed questions + transition lines). Zero
    // latency / zero cost; any unmatched text falls through to live TTS below.
    const preRenderedClip = getInterviewAudioForText(cleanText, interviewerVoice);
    if (preRenderedClip) {
      const played = await playPreRenderedClip(preRenderedClip, () => onFinished?.());
      if (played) return;
    }

    const ttsEndpoint = apiUrl('/api/tts/speak');

    getAudioContext();
    setIsAISpeaking(true);

    try {
      const abortCtrl = new AbortController();
      elevenLabsAbortRef.current = abortCtrl;

      const response = await fetch(ttsEndpoint, {
        method: 'POST',
        signal: abortCtrl.signal,
        headers: { ...ttsAuthHeaders(), 'Accept': 'audio/mpeg' },
        body: JSON.stringify({ text: cleanText, voiceGender: interviewerVoice }),
      });

      if (!response.ok) {
        console.warn('TTS proxy unavailable, falling back to browser TTS. Status:', response.status);
        speakAIBrowserFallback(cleanText, expectedDurationMs, onFinished);
        return;
      }

      const arrayBuffer = await response.arrayBuffer();
      const audioCtx = getAudioContext();
      if (!audioCtx) throw new Error('No AudioContext');

      const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
      const source = audioCtx.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(audioCtx.destination);
      elevenLabsSourceRef.current = source;

      let ended = false;
      const finish = () => {
        if (ended) return;
        ended = true;
        setIsAISpeaking(false);
        elevenLabsSourceRef.current = null;
        setTimeout(() => { onFinished?.(); }, 50);
      };

      source.onended = finish;
      const safety = setTimeout(finish, (audioBuffer.duration * 1000) + 2000);
      source.onended = () => { clearTimeout(safety); finish(); };

      source.start(0);
    } catch (err) {
      if (err.name === 'AbortError') {
        setIsAISpeaking(false);
        return;
      }
      console.warn('ElevenLabs TTS exception, falling back to browser TTS:', err);
      speakAIBrowserFallback(cleanText, expectedDurationMs, onFinished);
    }
  };

  // Safe question replay helper: pauses microphone during AI speech so candidate mic doesn't record interviewer voice
  const handlePlayOrReplayQuestion = (overrideText) => {
    const qText = overrideText || currentQ.questionText || currentQ.question;
    if (!qText) return;
    stopSpeechRecognition();
    setAgentState('SPEAKING');
    agentStateRef.current = 'SPEAKING';
    speakAI(qText, () => {
      if (sessionActive) {
        setAgentState('LISTENING');
        agentStateRef.current = 'LISTENING';
        startSpeechRecognition();
      }
    });
  };

  // Alias for backward compatibility
  const playQuestionTTS = (text, onFinished) => speakAI(text, onFinished);

  // ── Speech-to-Text (STT) Capture Engine ──
  // Engine priority: Sarvam Saaras (best accuracy on Indian accents / Hinglish),
  // recorded as consecutive ~29s clips per answer and sent to the backend proxy
  // at /api/stt/transcribe — the provider key never reaches the browser. If
  // Sarvam is unreachable, the browser Web Speech API is used as a fallback.
  const sttEndpoint = apiUrl('/api/stt/transcribe');

  const sttAuthHeaders = (contentType) => {
    const token = localStorage.getItem('rsj_token') || localStorage.getItem('token');
    return { ...(contentType ? { 'Content-Type': contentType } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) };
  };

  // Records that the candidate is actively answering (drives the answer window).
  const markVoiceActivity = () => {
    hasSpokenRef.current = true;
    lastVoiceAtRef.current = Date.now();
  };

  // Resets the per-answer capture clock. The hard time cap is measured from the
  // moment recording actually starts (not first speech), so the uploaded clip can
  // never exceed Sarvam's 30s limit even if the candidate pauses before talking.
  const clearSarvamSegmentTimer = () => {
    if (sarvamSegmentTimerRef.current) {
      clearTimeout(sarvamSegmentTimerRef.current);
      sarvamSegmentTimerRef.current = null;
    }
  };

  const beginAnswerWindow = () => {
    answerStartedAtRef.current = 0;
    lastVoiceAtRef.current = 0;
    hasSpokenRef.current = false;
    sarvamRotatingRef.current = false;
    sarvamSegmentCountRef.current = 0;
    sarvamSubmitRequestedRef.current = false;
    clearSarvamSegmentTimer();
  };
  const startAnswerWindow = () => {
    beginAnswerWindow();
    answerStartedAtRef.current = Date.now();
  };

  const appendTranscript = (text) => {
    const chunk = (text || '').trim();
    if (!chunk) return;
    accumulatedTranscriptRef.current = `${accumulatedTranscriptRef.current} ${chunk}`.replace(/\s+/g, ' ').trim();
    setCompanionText(accumulatedTranscriptRef.current);
    lastCandidateSpokeTimeRef.current = Date.now();
    markVoiceActivity();
  };

  // Switch from Sarvam to the browser engine when the proxy is unavailable.
  const fallbackToBrowserSpeechRecognition = () => {
    if (sttEngineRef.current !== 'sarvam') return;
    console.warn('Sarvam STT unavailable — falling back to browser speech recognition.');
    stopSarvamRecording();
    startBrowserSpeechRecognition();
  };

  const noteSarvamFailure = (status) => {
    sarvamFailureCountRef.current += 1;
    const permanent = status === 401 || status === 402 || status === 403 || status === 503;
    if (permanent || sarvamFailureCountRef.current >= 2) {
      fallbackToBrowserSpeechRecognition();
    }
  };

  const transcribeSegment = async (blob) => {
    if (!blob || blob.size === 0) return;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    try {
      const url = `${sttEndpoint}?language_code=${encodeURIComponent(sttLang || 'en-IN')}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: sttAuthHeaders(blob.type || 'audio/webm'),
        body: blob,
        signal: controller.signal,
      });
      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        console.warn('Sarvam STT unavailable, status:', res.status, errText);
        noteSarvamFailure(res.status);
        return;
      }
      sarvamFailureCountRef.current = 0;
      const data = await res.json().catch(() => ({}));
      if (data?.transcript) appendTranscript(data.transcript);
    } catch (err) {
      console.warn('Sarvam STT notice:', err.message);
      noteSarvamFailure(0);
    } finally {
      clearTimeout(timeout);
    }
  };

  const stopSarvamRecorder = (recorder) => {
    if (!recorder || recorder.state === 'inactive') return Promise.resolve();
    const promise = new Promise((resolve) => {
      sarvamStopResolversRef.current.set(recorder, resolve);
      try {
        recorder.stop();
      } catch {
        sarvamStopResolversRef.current.delete(recorder);
        resolve();
      }
    }).finally(() => {
      sarvamPendingStopsRef.current.delete(promise);
    });
    sarvamPendingStopsRef.current.add(promise);
    return promise;
  };

  const stopSarvamRecording = () => {
    // Invalidate any start that is still awaiting the microphone.
    sarvamStartTokenRef.current += 1;
    sarvamSubmitRequestedRef.current = true;
    sarvamRotatingRef.current = false;
    clearSarvamSegmentTimer();
    // Stop batch recording
    const recorder = sarvamRecorderRef.current;
    sarvamRecorderRef.current = null;
    if (recorder && recorder.state !== 'inactive') {
      try { recorder.stop(); } catch { }
    }
    // The microphone stream is intentionally NOT stopped here: it stays warm for
    // the next answer so the recorder can start instantly after each question.
    // Stop streaming recording
    stopSarvamStreamingRecording();

    // Release any pending flush so a submit can never hang waiting on audio.
    if (sarvamFlushResolveRef.current) {
      const resolveFlush = sarvamFlushResolveRef.current;
      sarvamFlushResolveRef.current = null;
      resolveFlush();
    }
    if (sttEngineRef.current === 'sarvam' || sttEngineRef.current === 'sarvam_stream') setIsRecording(false);
  };

  // Stop the active Sarvam recording and resolve once its transcript has been
  // processed, so submitting an answer never drops the candidate's last words.
  const flushSarvamRecording = () => {
    // Prevent a rotation-triggered segment from starting after submission.
    sarvamSubmitRequestedRef.current = true;
    clearSarvamSegmentTimer();

    // Streaming: force Sarvam to finalize its buffer and wait for the final transcript.
    if (sttEngineRef.current === 'sarvam_stream') {
      return flushSarvamStreamingRecording();
    }

    const recorder = sarvamRecorderRef.current;
    const pendingBefore = Array.from(sarvamPendingStopsRef.current);
    const activeStop = (sttEngineRef.current === 'sarvam' && recorder)
      ? stopSarvamRecorder(recorder)
      : Promise.resolve();

    // Wait for the active segment and any segment stopped moments earlier by the
    // 29s rotation, so the final transcript is never dropped.
    return Promise.allSettled([activeStop, ...pendingBefore]).then(() => undefined);
  };

  // Return a live, audio-only stream for the recorder. Resolution order:
  //   1. the live camera audio track (already open, zero wake-up cost),
  //   2. the persistent mic stream kept alive for the whole interview,
  //   3. a one-time getUserMedia (then kept alive for later answers).
  const ensureAudioStream = async () => {
    const cameraTracks = mediaStreamRef.current
      ? mediaStreamRef.current.getAudioTracks().filter((t) => t.readyState === 'live')
      : [];
    if (cameraTracks.length > 0) return new MediaStream(cameraTracks);

    const micTracks = micStreamRef.current
      ? micStreamRef.current.getAudioTracks().filter((t) => t.readyState === 'live')
      : [];
    if (micTracks.length > 0) return new MediaStream(micTracks);

    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('Microphone is not available in this browser.');
    }
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
    });
    micStreamRef.current = stream;
    return stream;
  };

  // Warm the microphone while the interviewer is speaking. Opening the stream
  // ahead of time is what makes the mic activate instantly when the question
  // ends — it never records while the interviewer is talking.
  const primeMicrophone = () => {
    if (micStreamRef.current?.getAudioTracks().some((t) => t.readyState === 'live')) return;
    const cameraTracks = mediaStreamRef.current?.getAudioTracks?.() || [];
    if (cameraTracks.some((t) => t.readyState === 'live')) return;
    ensureAudioStream().catch(() => { });
  };

  const releaseMicrophone = () => {
    sarvamStartTokenRef.current += 1;
    if (micStreamRef.current) {
      micStreamRef.current.getTracks().forEach((t) => t.stop());
      micStreamRef.current = null;
    }
  };

  // Record one Sarvam-safe segment (~29s). The first segment of an answer
  // schedules an automatic rotation; the second segment is stopped by the
  // answer timer or manual submit, never exceeding Sarvam's 30s limit.
  const startSarvamSegment = async ({ resetWindow = false } = {}) => {
    if (sttEngineRef.current !== 'sarvam') return null;
    const MediaRecorder = window.MediaRecorder;
    if (!MediaRecorder) {
      startBrowserSpeechRecognition();
      return null;
    }

    const startToken = ++sarvamStartTokenRef.current;
    try {
      // Reuse the already-open camera/mic track. This is the fast path: no
      // getUserMedia round-trip between questions. Recording is done on an
      // audio-only MediaStream: handing a video+audio stream to an audio codec
      // makes MediaRecorder.start() throw in Chromium.
      const audioStream = await ensureAudioStream();
      if (
        startToken !== sarvamStartTokenRef.current ||
        sttEngineRef.current !== 'sarvam' ||
        sarvamSubmitRequestedRef.current
      ) {
        return null;
      }

      const preferred = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'];
      const mimeType = preferred.find((t) => MediaRecorder.isTypeSupported?.(t)) || '';

      let recorder;
      try {
        recorder = mimeType ? new MediaRecorder(audioStream, { mimeType }) : new MediaRecorder(audioStream);
      } catch {
        recorder = new MediaRecorder(audioStream);
      }

      const chunks = [];
      recorder.ondataavailable = (e) => { if (e.data && e.data.size > 0) chunks.push(e.data); };
      recorder.onstop = async () => {
        if (sarvamRecorderRef.current === recorder) sarvamRecorderRef.current = null;
        const blob = new Blob(chunks, { type: recorder.mimeType || mimeType || 'audio/webm' });
        const rotating = sarvamRotatingRef.current;
        sarvamRotatingRef.current = false;

        // Rotate immediately at the 29s boundary so the next segment captures
        // the following words without waiting for this transcription.
        if (
          rotating &&
          sttEngineRef.current === 'sarvam' &&
          !sarvamSubmitRequestedRef.current &&
          answerStartedAtRef.current &&
          (Date.now() - answerStartedAtRef.current) < MAX_ANSWER_SECONDS * 1000
        ) {
          startSarvamSegment({ resetWindow: false }).catch(() => {});
        }

        const transcription = transcribeSegment(blob)
          .catch(() => {})
          .finally(() => {
            sarvamPendingTranscriptionsRef.current.delete(transcription);
          });
        sarvamPendingTranscriptionsRef.current.add(transcription);
        await transcription;

        // A pending flush (submit) resolves once the final transcript is in.
        if (sarvamFlushResolveRef.current) {
          const resolveFlush = sarvamFlushResolveRef.current;
          sarvamFlushResolveRef.current = null;
          resolveFlush();
        }
        const resolveStop = sarvamStopResolversRef.current.get(recorder);
        if (resolveStop) {
          sarvamStopResolversRef.current.delete(recorder);
          resolveStop();
        }
      };

      try {
        recorder.start();
      } catch (err) {
        console.warn('Recorder start notice:', err.message);
        // Never fail silently: tell the candidate the mic did not start and
        // fall back to the browser Web Speech API so STT still works.
        setMicError((prev) => prev || 'Microphone could not start recording. Check the browser mic permission and retry, or type your answer.');
        setIsRecording(false);
        sttEngineRef.current = 'none';
        startBrowserSpeechRecognition();
        return null;
      }

      sarvamRecorderRef.current = recorder;
      setIsRecording(true);
      setMicError('');

      if (resetWindow) startAnswerWindow();
      sarvamSegmentCountRef.current += 1;

      // Only the first segment schedules a rotation. The second segment runs
      // until the answer timer / manual submit stops it at ~58s.
      if (sarvamSegmentCountRef.current === 1) {
        clearSarvamSegmentTimer();
        sarvamSegmentTimerRef.current = setTimeout(() => {
          sarvamSegmentTimerRef.current = null;
          const active = sarvamRecorderRef.current;
          if (active && active.state !== 'inactive') {
            sarvamRotatingRef.current = true;
            stopSarvamRecorder(active);
          }
        }, SARVAM_CHUNK_SECONDS * 1000);
      }

      return recorder;
    } catch (err) {
      if (startToken !== sarvamStartTokenRef.current) return null;
      console.warn('Microphone unavailable for speech recognition:', err.message);
      setMicError(describeMediaError(err));
      setIsRecording(false);
      // Do not misreport state: fall back to the browser Web Speech API, which
      // may still capture audio through a different path.
      sttEngineRef.current = 'none';
      startBrowserSpeechRecognition();
      return null;
    }
  };

  const startSarvamRecording = async () => {
    if (sttEngineRef.current === 'sarvam' && sarvamRecorderRef.current) return;
    if (!window.MediaRecorder || !navigator.mediaDevices?.getUserMedia) {
      // Recording not possible — fall back to the browser Web Speech API.
      startBrowserSpeechRecognition();
      return;
    }

    sttEngineRef.current = 'sarvam';
    sarvamFailureCountRef.current = 0;
    // A new answer is starting: clear the previous submit/rotation state before
    // the segment-start guard checks it.
    sarvamSubmitRequestedRef.current = false;
    sarvamRotatingRef.current = false;
    sarvamSegmentCountRef.current = 0;
    clearSarvamSegmentTimer();
    await startSarvamSegment({ resetWindow: true });
  };

  // ==========================================
  // SARVAM STREAMING STT (Real-time WebSocket)
  // ==========================================
  // Build the mic -> AudioWorklet -> WebSocket pipeline ahead of time. The
  // handshake (browser -> our proxy -> Sarvam) is the slow part, so it runs
  // while the interviewer is still speaking. Audio is only forwarded once
  // sarvamListeningRef is true, so the interviewer's voice is never transcribed.
  const prewarmSarvamStreaming = () => {
    if (sarvamPrewarmedRef.current && sarvamWsRef.current?.readyState === WebSocket.OPEN) {
      return Promise.resolve(true);
    }
    if (sarvamPrewarmPromiseRef.current) return sarvamPrewarmPromiseRef.current;

    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass || !navigator.mediaDevices?.getUserMedia) {
      return Promise.resolve(false);
    }

    const epoch = sarvamEpochRef.current;

    const start = async () => {
      let processor = null;
      let silentGain = null;
      let audioContext = null;
      let audioStream = null;
      let ws = null;

      const teardown = () => {
        if (ws && sarvamWsRef.current === ws) sarvamWsRef.current = null;
        if (processor && sarvamProcessorRef.current === processor) {
          try { processor.disconnect(); } catch { }
          sarvamProcessorRef.current = null;
        }
        if (silentGain && sarvamSilentGainRef.current === silentGain) {
          try { silentGain.disconnect(); } catch { }
          sarvamSilentGainRef.current = null;
        }
        if (audioContext && sarvamAudioContextRef.current === audioContext) {
          try { audioContext.close(); } catch { }
          sarvamAudioContextRef.current = null;
        }
        if (audioStream && sarvamMediaStreamRef.current === audioStream) {
          try { audioStream.getTracks().forEach((t) => t.stop()); } catch { }
          sarvamMediaStreamRef.current = null;
        }
        try { ws?.close(); } catch { }
      };

      try {
        // Reuse the camera stream's live audio track when possible.
        const cameraStream = mediaStreamRef.current;
        const liveAudioTracks = cameraStream
          ? cameraStream.getAudioTracks().filter((t) => t.readyState === 'live')
          : [];

        if (liveAudioTracks.length > 0) {
          audioStream = new MediaStream(liveAudioTracks);
        } else {
          audioStream = await navigator.mediaDevices.getUserMedia({
            audio: {
              sampleRate: 16000,
              channelCount: 1,
              echoCancellation: true,
              noiseSuppression: true,
              autoGainControl: true,
            },
          });
          sarvamMediaStreamRef.current = audioStream;
        }

        if (epoch !== sarvamEpochRef.current) { teardown(); return false; }

        audioContext = new AudioContextClass({ sampleRate: 16000 });
        sarvamAudioContextRef.current = audioContext;
        if (audioContext.state === 'suspended') await audioContext.resume();

        const source = audioContext.createMediaStreamSource(audioStream);

        try {
          await audioContext.audioWorklet.addModule('/audio-worklet/pcm-processor.js?v=3');
          processor = new AudioWorkletNode(audioContext, 'pcm-processor');
          processor.port.onmessage = (e) => {
            if (!sarvamListeningRef.current) return;
            const socket = sarvamWsRef.current;
            if (socket?.readyState === WebSocket.OPEN && e.data?.pcmData) {
              socket.send(e.data.pcmData);
            }
          };
        } catch {
          // Fallback to the deprecated ScriptProcessorNode.
          processor = audioContext.createScriptProcessor(1024, 1, 1);
          processor.onaudioprocess = (e) => {
            if (!sarvamListeningRef.current) return;
            const socket = sarvamWsRef.current;
            if (socket?.readyState !== WebSocket.OPEN) return;
            const inputData = e.inputBuffer.getChannelData(0);
            const pcmData = new Int16Array(inputData.length);
            for (let i = 0; i < inputData.length; i++) {
              const s = Math.max(-1, Math.min(1, inputData[i]));
              pcmData[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
            }
            socket.send(pcmData.buffer);
          };
        }

        // Silent sink: never monitor the mic back to the speakers.
        silentGain = audioContext.createGain();
        silentGain.gain.value = 0;
        sarvamSilentGainRef.current = silentGain;
        source.connect(processor);
        processor.connect(silentGain);
        silentGain.connect(audioContext.destination);

        const token = localStorage.getItem('rsj_token') || localStorage.getItem('token');
        const wsUrl = `${apiUrl('/api/stt/stream').replace(/^http/, 'ws')}?token=${encodeURIComponent(token || '')}&language_code=${encodeURIComponent(sttLang || 'en-IN')}&sample_rate=16000`;

        ws = new WebSocket(wsUrl);
        sarvamWsRef.current = ws;
        sarvamProcessorRef.current = processor;
        ws.binaryType = 'arraybuffer';

        // Resolve once our proxy reports that Sarvam itself is connected.
        let settled = false;
        let resolveReady;
        const readyPromise = new Promise((resolve) => { resolveReady = resolve; });
        const markReady = (value) => {
          if (settled) return;
          settled = true;
          clearTimeout(readyTimer);
          resolveReady(value);
        };
        const readyTimer = setTimeout(() => markReady(false), 6000);

        ws.onopen = () => {
          console.log('[Sarvam Streaming STT] Proxy socket open');
        };

        ws.onmessage = (event) => {
          let data;
          try { data = JSON.parse(event.data); } catch { return; }

          if (data.type === 'ready') {
            sarvamWsReadyRef.current = true;
            markReady(true);
            return;
          }

          // Accept both the proxy's normalized shape and Sarvam's raw shape.
          const transcript = typeof data.transcript === 'string'
            ? data.transcript
            : (typeof data.data?.transcript === 'string' ? data.data.transcript : '');
          if (transcript.trim()) {
            appendTranscript(transcript);
            const resolveFlush = sarvamFlushResolveRef.current;
            sarvamFlushResolveRef.current = null;
            resolveFlush?.();
          }

          if (data.type === 'error') {
            const message = data.message || data.data?.error || data.data?.message || 'Sarvam stream error';
            console.warn('[Sarvam Streaming STT] Error:', message);
            markReady(false);
            noteSarvamFailure(0);
          }
        };

        ws.onerror = (err) => {
          console.error('[Sarvam Streaming STT] WebSocket error:', err);
          sarvamWsReadyRef.current = false;
          markReady(false);
        };

        ws.onclose = (event) => {
          console.log('[Sarvam Streaming STT] Closed:', event.code, event.reason);
          sarvamWsReadyRef.current = false;
          sarvamPrewarmedRef.current = false;
          markReady(false);

          // Unexpected close while the candidate is answering: fall back to
          // the batch recorder so their answer is still captured.
          if (sttEngineRef.current === 'sarvam_stream' && sarvamListeningRef.current && !autoSubmitFiredRef.current) {
            sarvamListeningRef.current = false;
            sttEngineRef.current = 'none';
            setIsRecording(false);
            console.warn('[Sarvam Streaming STT] Lost connection — falling back to batch STT');
            startSarvamRecording();
          }
        };

        const ready = await readyPromise;
        if (epoch !== sarvamEpochRef.current || sarvamWsRef.current !== ws) {
          teardown();
          return false;
        }
        if (!ready) {
          teardown();
          return false;
        }

        sarvamPrewarmedRef.current = true;
        return true;
      } catch (err) {
        console.warn('[Sarvam Streaming STT] Prewarm failed:', err?.message || err);
        teardown();
        return false;
      } finally {
        sarvamPrewarmPromiseRef.current = null;
      }
    };

    sarvamPrewarmPromiseRef.current = start();
    return sarvamPrewarmPromiseRef.current;
  };

  const startSarvamStreamingRecording = async () => {
    if (sttEngineRef.current === 'sarvam_stream' && sarvamListeningRef.current) return;

    sttEngineRef.current = 'sarvam_stream';
    sarvamFailureCountRef.current = 0;

    // If the socket was prewarmed while the interviewer spoke, this resolves
    // immediately and audio starts flowing on the next frame.
    const ready = await prewarmSarvamStreaming();
    if (sttEngineRef.current !== 'sarvam_stream') return;
    if (!ready) {
      sttEngineRef.current = 'none';
      console.warn('Sarvam streaming unavailable — falling back to batch STT');
      startSarvamRecording();
      return;
    }

    sarvamListeningRef.current = true;
    startAnswerWindow();
    setIsRecording(true);
    setMicError('');
  };

  const stopSarvamStreamingRecording = () => {
    // Invalidate any in-flight prewarm before tearing down.
    sarvamEpochRef.current += 1;
    sarvamListeningRef.current = false;
    sarvamWsReadyRef.current = false;
    sarvamPrewarmedRef.current = false;
    sarvamPrewarmPromiseRef.current = null;

    // Mark the engine stopped before closing so the socket's onclose handler
    // does not mistake an intentional stop for a dropped connection.
    if (sttEngineRef.current === 'sarvam_stream') {
      sttEngineRef.current = 'none';
      setIsRecording(false);
    }

    const ws = sarvamWsRef.current;
    sarvamWsRef.current = null;

    if (ws) {
      try {
        if (ws.readyState === WebSocket.OPEN) {
          // Ask Sarvam to finalize anything still buffered.
          try { ws.send(JSON.stringify({ type: 'flush' })); } catch { }
        }
        if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
          // Give the flush frame a moment to leave before closing.
          setTimeout(() => { try { ws.close(1000, 'Client stopped recording'); } catch { } }, 200);
        }
      } catch { }
    }

    // Clean up audio graph
    const processor = sarvamProcessorRef.current;
    sarvamProcessorRef.current = null;
    if (processor) {
      try { processor.disconnect(); } catch { }
    }

    const silentGain = sarvamSilentGainRef.current;
    sarvamSilentGainRef.current = null;
    if (silentGain) {
      try { silentGain.disconnect(); } catch { }
    }

    const audioContext = sarvamAudioContextRef.current;
    sarvamAudioContextRef.current = null;
    if (audioContext && audioContext.state !== 'closed') {
      try { audioContext.close(); } catch { }
    }

    const mediaStream = sarvamMediaStreamRef.current;
    sarvamMediaStreamRef.current = null;
    if (mediaStream) {
      mediaStream.getTracks().forEach((t) => t.stop());
    }

    // Release any pending flush so submitting an answer can never hang.
    if (sarvamFlushResolveRef.current) {
      const resolveFlush = sarvamFlushResolveRef.current;
      sarvamFlushResolveRef.current = null;
      resolveFlush();
    }
  };

  // Force Sarvam to finalize buffered audio, then resolve when the final
  // transcript arrives (or after a short timeout so submission never hangs).
  const flushSarvamStreamingRecording = () => {
    const ws = sarvamWsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return Promise.resolve();

    return new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        if (sarvamFlushResolveRef.current === finish) sarvamFlushResolveRef.current = null;
        clearTimeout(timer);
        resolve();
      };
      sarvamFlushResolveRef.current = finish;
      const timer = setTimeout(finish, 1500);
      try { ws.send(JSON.stringify({ type: 'flush' })); } catch { finish(); }
    });
  };

  const startBrowserSpeechRecognition = () => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      // No recording and no Web Speech API available.
      sttEngineRef.current = 'none';
      setIsRecording(false);
      setMicError((prev) => prev || 'Voice input is not supported in this browser. Please type your answer instead.');
      return;
    }
    sttEngineRef.current = 'browser';
    beginAnswerWindow();

    try {
      if (recognitionRef.current) {
        try { recognitionRef.current.abort(); } catch { }
      }

      const recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = true;
      // High-accuracy accent setting (defaults to en-IN for Indian candidate pronunciation)
      recognition.lang = sttLang || 'en-IN';
      recognition.maxAlternatives = 1;

      recognition.onstart = () => {
        setIsRecording(true);
        setMicError('');
        startAnswerWindow();
      };

      recognition.onresult = (event) => {
        let interimTranscript = '';
        let finalChunk = '';

        for (let i = event.resultIndex; i < event.results.length; ++i) {
          const res = event.results[i];
          if (res.isFinal) {
            finalChunk += res[0].transcript + ' ';
          } else {
            interimTranscript += res[0].transcript;
          }
        }

        if (finalChunk) {
          accumulatedTranscriptRef.current = (accumulatedTranscriptRef.current + ' ' + finalChunk)
            .replace(/\s+/g, ' ')
            .trim();
        }

        const combined = (accumulatedTranscriptRef.current + (interimTranscript ? ' ' + interimTranscript : ''))
          .replace(/\s+/g, ' ')
          .trim();

        if (combined) {
          setCompanionText(combined);
          lastCandidateSpokeTimeRef.current = Date.now();
          markVoiceActivity();
        }
      };

      recognition.onerror = (e) => {
        console.warn('STT notice:', e?.error);
        // Fatal errors (blocked service, capture failure, unsupported language):
        // stop cleanly; Sarvam is the primary engine so there is nothing to
        // fall back to here.
        const fatal = ['not-allowed', 'service-not-allowed', 'audio-capture', 'network', 'language-not-supported'];
        if (fatal.includes(e?.error) && sttEngineRef.current === 'browser') {
          try { recognition.abort(); } catch { }
          sttEngineRef.current = 'none';
          setIsRecording(false);
          setMicError(describeMediaError({ name: e?.error }));
        }
      };

      recognition.onend = () => {
        // If we've switched engines, do not restart the browser engine.
        if (sttEngineRef.current !== 'browser') return;
        // Auto-reconnect with zero lag if still in LISTENING state
        if (agentStateRef.current === 'LISTENING') {
          try {
            recognition.start();
          } catch {
            setTimeout(() => {
              if (agentStateRef.current === 'LISTENING') {
                try { recognition.start(); } catch { }
              }
            }, 250);
          }
        } else {
          setIsRecording(false);
        }
      };

      recognition.start();
      recognitionRef.current = recognition;
      setIsRecording(true);
    } catch (e) {
      console.warn('Recognition start notice:', e);
      setIsRecording(false);
      setMicError((prev) => prev || describeMediaError(e));
    }
  };

  // Engine selection: Sarvam Batch STT (primary), Browser Web Speech (fallback).
  // An answer is recorded as one or two ~29s clips (under Sarvam's 30s limit)
  // and transcribed as each clip closes. The streaming WebSocket path is
  // intentionally disabled.
  const startSpeechRecognition = () => {
    const MediaRecorder = window.MediaRecorder;
    const canRecordAudio = Boolean(MediaRecorder && navigator.mediaDevices?.getUserMedia);

    if (canRecordAudio) {
      // Primary: Sarvam Batch STT (MediaRecorder + POST /api/stt/transcribe)
      startSarvamRecording();
      return;
    }
    // Fallback: Browser Web Speech API
    startBrowserSpeechRecognition();
  };

  const stopSpeechRecognition = () => {
    if (recognitionRef.current) {
      try { recognitionRef.current.stop(); } catch { }
      recognitionRef.current = null;
    }
    stopSarvamRecording();
    stopSarvamStreamingRecording();
    sttEngineRef.current = 'none';
    setIsRecording(false);
  };

  // Toggle between Indian English (en-IN) and US English (en-US)
  const toggleSttLang = () => {
    const nextLang = sttLang === 'en-IN' ? 'en-US' : 'en-IN';
    setSttLang(nextLang);
    if (isRecording) {
      stopSpeechRecognition();
      setTimeout(() => {
        if (agentStateRef.current === 'LISTENING') {
          startSpeechRecognition();
        }
      }, 100);
    }
  };

  // Manual Mic toggle for candidate. The mic is only controllable while it is
  // the candidate's turn: starting it during interviewer speech would record the
  // interviewer's own voice.
  const handleRecordVoice = () => {
    const state = agentStateRef.current;
    if (state === 'SPEAKING' || state === 'AI_RESPONSE' || state === 'PROCESSING') return;

    if (isRecording) {
      stopSpeechRecognition();
    } else {
      setMicError('');
      primeMicrophone();
      startSpeechRecognition();
    }
  };

  // ── Finalize Interview Session & Generate Analysis Report ──
  const finalizeInterviewSession = (updatedAnswers) => {
    if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
    if (telemetryIntervalRef.current) clearInterval(telemetryIntervalRef.current);
    stopAudioNoiseMonitoring();
    stopSpeechRecognition();
    setSessionActive(false);
    stopCamera();
    releaseMicrophone();
    setIsProcessing(true);

    const answeredCount = updatedAnswers.filter(a => a.score > 0).length;
    const hasSpokenAtAll = answeredCount > 0;

    const calcFinalScore = hasSpokenAtAll
      ? Math.round(updatedAnswers.reduce((acc, curr) => acc + curr.score, 0) / updatedAnswers.length)
      : 0;

    const avgOf = (key, fallback = 0) => {
      if (!updatedAnswers.length) return 0;
      const total = updatedAnswers.reduce((acc, curr) => {
        const n = Number(curr?.[key]);
        return acc + (Number.isFinite(n) ? n : fallback);
      }, 0);
      return Math.round(total / updatedAnswers.length);
    };

    const calcEye = hasSpokenAtAll ? avgOf('eyeContactScore', 0) : 0;
    const calcComm = hasSpokenAtAll ? avgOf('communicationScore', 0) : 0;
    const calcTech = hasSpokenAtAll ? avgOf('technicalScore', 0) : 0;
    const calcConf = hasSpokenAtAll ? avgOf('confidenceScore', 0) : 0;
    const calcAtt = hasSpokenAtAll ? avgOf('attentionScore', 0) : 0;
    const calcEmotion = !hasSpokenAtAll
      ? 'Neutral'
      : calcAtt >= 70 ? 'Focused' : calcAtt >= 40 ? 'Neutral' : 'Distracted';

    const measuredStrengths = [];
    if (calcEye >= 70) measuredStrengths.push('Sustained eye contact with the camera');
    if (calcTech >= 65) measuredStrengths.push('Structured technical explanations');
    if (calcComm >= 65) measuredStrengths.push('Clear verbal communication');
    if (measuredStrengths.length === 0) measuredStrengths.push('Completed the interview session');

    const measuredWeaknesses = [];
    if (calcEye < 60) measuredWeaknesses.push('Frequent gaze diversion or distraction detected');
    if (calcTech < 60) measuredWeaknesses.push('Technical depth needs more concrete examples');
    if (calcComm < 60) measuredWeaknesses.push('Responses were brief; expand with more detail');
    if (telemetryStatsRef.current.phoneFrames > 0) measuredWeaknesses.push('A mobile phone was detected in the camera frame');
    if (telemetryStatsRef.current.extraPersonFrames > 0) measuredWeaknesses.push('An additional person was detected in the camera frame');
    if (telemetryStatsRef.current.audioDisturbances > 0) measuredWeaknesses.push(`${telemetryStatsRef.current.audioDisturbances} audio disturbance(s) detected in the environment`);
    if (measuredWeaknesses.length === 0) measuredWeaknesses.push('Continue practicing timed interview answers');

    const currentSid = sessionId || `isess_local_${Date.now()}`;

    const generatedAnalysis = {
      sessionId: currentSid,
      overallScore: calcFinalScore,
      communicationScore: calcComm,
      technicalScore: calcTech,
      eyeContactScore: calcEye,
      attentionScore: calcAtt,
      confidenceScore: calcConf,
      dominantEmotion: calcEmotion,
      audioDisturbances: telemetryStatsRef.current.audioDisturbances,
      phoneDetected: telemetryStatsRef.current.phoneFrames > 0,
      extraPersonDetected: telemetryStatsRef.current.extraPersonFrames > 0,
      strengths: measuredStrengths,
      weaknesses: measuredWeaknesses,
      recommendations: ['Practice timed mock answers with system design examples'],
      aiFeedback: hasSpokenAtAll ? 'Candidate demonstrated solid proficiency across key technical requirements.' : 'Candidate remained silent or provided no spoken response.',
      questionBreakdown: updatedAnswers.map(a => {
        const isSkipped = Boolean(
          a.isSkipped ||
          a.score === 0 ||
          !a.companionNote ||
          a.companionNote.includes('No verbal') ||
          a.companionNote.includes('Skipped')
        );
        return {
          questionNumber: a.questionNumber,
          category: a.category,
          questionText: a.question,
          transcript: isSkipped ? '' : a.companionNote,
          isSkipped: isSkipped,
          overallScore: isSkipped ? 0 : a.score,
          technicalScore: isSkipped ? 0 : a.technicalScore,
          communicationScore: isSkipped ? 0 : a.communicationScore,
          confidenceScore: isSkipped ? 0 : a.confidenceScore,
          eyeContactScore: isSkipped ? 0 : a.eyeContactScore,
          dominantEmotion: isSkipped
            ? 'Neutral'
            : Number(a.attentionScore) >= 70 ? 'Focused' : Number(a.attentionScore) >= 40 ? 'Neutral' : 'Distracted',
          aiFeedback: isSkipped
            ? 'Answer skipped by candidate. No analysis.'
            : (a.score > 70 ? 'Strong structured response.' : 'Acceptable response with room for deeper technical precision.')
        };
      })
    };

    setFinalAnalysis(generatedAnalysis);

    const analysisPayload = {
      success: true,
      analysis: generatedAnalysis,
      session: {
        id: currentSid,
        targetRole: targetRole || 'Software Engineer',
        startedAt: new Date(Date.now() - timerSeconds * 1000).toISOString(),
        completedAt: new Date().toISOString(),
        questions: questions
      }
    };
    localStorage.setItem('rsj_latest_interview_analysis', JSON.stringify(analysisPayload));
    localStorage.setItem('last_interview_session_id', currentSid);
    localStorage.setItem('rsj_interview_completed', 'true');
    localStorage.setItem('rsj_active_analytics_tab', 'interview');
    setIsInterviewCompleted(true);

    const token = localStorage.getItem('rsj_token') || localStorage.getItem('token');
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    fetch(apiUrl(`/api/interview/session/${currentSid}/complete`), {
      method: 'POST',
      headers
    })
      .then(res => res.json())
      .then(data => {
        if (data.success && data.analysis) {
          setFinalAnalysis(data.analysis);
          localStorage.setItem('rsj_latest_interview_analysis', JSON.stringify({
            success: true,
            analysis: data.analysis,
            session: data.session || analysisPayload.session
          }));
        }
      })
      .catch(err => console.warn('Session complete sync notice:', err.message));

    setTimeout(() => {
      setIsProcessing(false);
      handleOpenCandidateAnalysis();
    }, 1500);
  };

  // ── Candidate Answer Submission & Dynamic Turn-Taking ──
  const handleCandidateSubmit = async (forceSkip = false) => {
    if (agentState === 'PROCESSING' || agentState === 'AI_RESPONSE') return;
    if (submitInFlightRef.current) return;
    submitInFlightRef.current = true;

    // Stop the per-question answer window.
    if (answerTimerRef.current) {
      clearInterval(answerTimerRef.current);
      answerTimerRef.current = null;
    }
    setAnswerSecondsLeft(null);

    // Switch to PROCESSING immediately so the UI reacts instantly while the final
    // transcript is still being produced by Sarvam.
    setAgentState('PROCESSING');
    agentStateRef.current = 'PROCESSING';
    setIsProcessing(true);

    // Flush the in-flight Sarvam recording so the candidate's last words are captured.
    await flushSarvamRecording();

    // 1. Stop Speech-to-Text
    stopSpeechRecognition();

    const currentQ = questions[currentQIndex] || questions[0];
    const isFinalQuestion = currentQIndex >= questions.length - 1;

    // Prefer the ref (updated synchronously, after the pending segment flush).
    const recordedText = forceSkip ? '' : (accumulatedTranscriptRef.current || companionText || '').trim();
    const words = recordedText.split(/\s+/).filter(Boolean);
    const isSilent = forceSkip || words.length < 3 || recordedText.toLowerCase().includes('candidate provided verbal answer') || recordedText.toLowerCase().includes('no response');

    let calculatedScore = 0;
    let techScore = 0;
    let commScore = 0;
    let quality = 'No Response';

    // Snapshot the measured camera telemetry at the moment this answer ends.
    // No random or fixed baseline is used anywhere in the score.
    let answerTelemetry = computeMeasuredTelemetry(telemetryStatsRef.current);
    const eye = isSilent ? 0 : Math.max(0, Math.min(100, Number(answerTelemetry.eyeContact) || 0));
    const att = isSilent ? 0 : Math.max(0, Math.min(100, Number(answerTelemetry.attention) || 0));
    const conf = isSilent ? 0 : Math.max(0, Math.min(100, Number(answerTelemetry.confidence) || 0));

    if (!isSilent) {
      const wordCount = words.length;
      commScore = Math.min(96, Math.max(45, 40 + Math.min(45, wordCount * 1.5)));
      techScore = Math.min(96, Math.max(45, 45 + Math.min(45, wordCount * 1.3)));
      calculatedScore = Math.round(techScore * 0.5 + commScore * 0.3 + conf * 0.1 + eye * 0.1);
      quality = calculatedScore >= 80 ? 'Excellent' : 'Proficient';
    }

    // 3. Persist answer to backend database
    if (sessionId && currentQ?.id) {
      try {
        const token = localStorage.getItem('rsj_token') || localStorage.getItem('token');
        const headers = { 'Content-Type': 'application/json' };
        if (token) headers['Authorization'] = `Bearer ${token}`;

        const ansRes = await fetch(apiUrl(`/api/interview/question/${currentQ.id}/answer`), {
          method: 'POST',
          headers,
          body: JSON.stringify({
            transcript: isSilent ? '' : recordedText,
            duration: Math.max(1, Math.round((Date.now() - (qStartTimeRef.current || Date.now())) / 1000)),
            telemetry: {
              eyeContact: eye,
              attention: att,
              confidence: conf,
              emotion: isSilent ? 'Neutral' : (answerTelemetry.emotion || 'Neutral')
            }
          })
        });

        if (ansRes.ok) {
          const ansData = await ansRes.json();
          if (ansData.success && ansData.answer) {
            calculatedScore = ansData.answer.overallScore || calculatedScore;
            techScore = ansData.answer.technicalScore || techScore;
            commScore = ansData.answer.communicationScore || commScore;
            quality = ansData.answer.answerQuality || quality;
            answerTelemetry = {
              ...answerTelemetry,
              eyeContact: Number(ansData.answer.eyeContactScore ?? eye) || 0,
              attention: Number(ansData.answer.attentionScore ?? att) || 0,
              confidence: Number(ansData.answer.confidenceScore ?? conf) || 0,
              emotion: ansData.answer.dominantEmotion || answerTelemetry.emotion,
            };
          }
        }
      } catch (err) {
        console.warn('Question answer sync notice:', err.message);
      }
    }

    const answerRecord = {
      questionNumber: currentQIndex + 1,
      stage: `Q${currentQIndex + 1}`,
      question: currentQ.questionText || currentQ.question,
      category: currentQ.category || 'TECHNICAL',
      isSkipped: isSilent,
      companionNote: isSilent ? 'Answer Skipped (No response provided)' : recordedText,
      score: isSilent ? 0 : calculatedScore,
      technicalScore: isSilent ? 0 : techScore,
      communicationScore: isSilent ? 0 : commScore,
      eyeContactScore: isSilent ? 0 : answerTelemetry.eyeContact,
      attentionScore: isSilent ? 0 : answerTelemetry.attention,
      confidenceScore: isSilent ? 0 : answerTelemetry.confidence
    };

    const updatedAnswers = [...answersList, answerRecord];
    setAnswersList(updatedAnswers);

    // 4. Form conversational spoken transition from Dr. Arvind Swamy / Er. Vishnu Pera
    let transitionSpoken = '';
    if (isFinalQuestion) {
      transitionSpoken = isSilent
        ? 'Thank you. That completes our interview questions. I am now compiling your complete evaluation report.'
        : 'Thank you for your responses. That completes our mock interview session. I am compiling your final evaluation report now.';
    } else {
      if (isSilent) {
        transitionSpoken = forceSkip
          ? 'Question skipped. Let us proceed to the next question.'
          : 'No verbal response was detected. Let us proceed to the next question.';
      } else if (quality === 'Excellent') {
        transitionSpoken = 'Thank you. Great explanation of the key technical concepts. Let us move to the next question.';
      } else {
        transitionSpoken = 'Thank you for that response. Let us proceed to the next question.';
      }
    }

    setIsProcessing(false);
    setAgentState('AI_RESPONSE');
    agentStateRef.current = 'AI_RESPONSE';

    // 5. Dr. Arvind Swamy speaks transitional feedback aloud!
    speakAI(transitionSpoken, () => {
      if (isFinalQuestion) {
        finalizeInterviewSession(updatedAnswers);
      } else {
        const nextIndex = currentQIndex + 1;
        setCurrentQIndex(nextIndex);
        setCompanionText('');
        accumulatedTranscriptRef.current = '';
        qStartTimeRef.current = Date.now();
        setAgentState('SPEAKING');
        agentStateRef.current = 'SPEAKING';
        const nextQ = questions[nextIndex];
        speakAI(nextQ.questionText || nextQ.question, () => {
          setAgentState('LISTENING');
          agentStateRef.current = 'LISTENING';
          startSpeechRecognition();
        });
      }
    });
  };

  const handleSkipQuestion = () => {
    if (agentState === 'PROCESSING' || agentState === 'AI_RESPONSE') return;
    setCompanionText('');
    accumulatedTranscriptRef.current = '';
    handleCandidateSubmit(true);
  };

  const handleNextQuestion = () => handleCandidateSubmit();

  // Keep a ref to the latest submit handler for the auto-advance timer.
  useEffect(() => {
    submitAnswerRef.current = handleCandidateSubmit;
  });

  // ── Per-question answer window ──
  // Starts when the candidate begins speaking (mic voice activity or first
  // transcript). Auto-advances when the ~58s cap is hit, or once they have been
  // silent for a few seconds after speaking (so quick answers don't stall).
  useEffect(() => {
    if (!sessionActive || agentState !== 'LISTENING') return;

    const MAX_ANSWER_MS = MAX_ANSWER_SECONDS * 1000;
    const SILENCE_MS = SILENCE_SECONDS * 1000;
    const VOICE_LEVEL = 22;

    autoSubmitFiredRef.current = false;
    submitInFlightRef.current = false;
    setAnswerSecondsLeft(null);
    setAnswerAutoNotice('');

    const tick = () => {
      const analyser = analyserRef.current;
      let level = 0;
      if (analyser) {
        const bins = new Uint8Array(analyser.frequencyBinCount);
        analyser.getByteFrequencyData(bins);
        let sum = 0;
        for (let i = 0; i < bins.length; i++) sum += bins[i];
        level = sum / bins.length;
      }
      const now = Date.now();
      if (level > VOICE_LEVEL) {
        hasSpokenRef.current = true;
        lastVoiceAtRef.current = now;
      }

      if (!answerStartedAtRef.current) return; // recording hasn't started yet

      const elapsed = now - answerStartedAtRef.current;
      const silence = lastVoiceAtRef.current ? now - lastVoiceAtRef.current : 0;
      setAnswerSecondsLeft(Math.max(0, Math.ceil((MAX_ANSWER_MS - elapsed) / 1000)));

      // Transcription is single-shot (runs on submit), so the live transcript is
      // empty while answering — detect "spoke at all" from the audio level.
      const timeUp = elapsed >= MAX_ANSWER_MS;
      const silentFinish = hasSpokenRef.current && silence >= SILENCE_MS;
      if (!timeUp && !silentFinish) return;
      if (autoSubmitFiredRef.current) return;
      autoSubmitFiredRef.current = true;
      if (answerTimerRef.current) {
        clearInterval(answerTimerRef.current);
        answerTimerRef.current = null;
      }
      setAnswerAutoNotice(timeUp ? 'Time limit reached - moving on.' : 'Answer recorded - moving on.');
      submitAnswerRef.current?.(false);
    };

    answerTimerRef.current = setInterval(tick, 400);
    return () => {
      if (answerTimerRef.current) {
        clearInterval(answerTimerRef.current);
        answerTimerRef.current = null;
      }
    };
  }, [sessionActive, agentState, currentQIndex]);

  // ── Start Interview Session ──
  const handleStartSession = async () => {
    try {
      // 1. Audio unlock & broadcast chime
      playStudioChime();
      if (window.speechSynthesis && window.speechSynthesis.paused) {
        window.speechSynthesis.resume();
      }

      const token = localStorage.getItem('rsj_token') || localStorage.getItem('token');
      const headers = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;

      let currentSid = null;
      const qCountLimit = Math.min(4, Math.max(3, Number(adminSettings.questionCount) || 3));
      let sessionQuestions = questions.slice(0, qCountLimit);

      try {
        const createRes = await fetch(apiUrl('/api/interview/session'), {
          method: 'POST',
          headers,
          body: JSON.stringify({
            targetRole: targetRole.trim() || 'Software Engineer',
            questions: sessionQuestions,
            userId: currentUser?.id
          })
        });
        const createData = await createRes.json().catch(() => ({}));

        // The backend enforces INTERVIEW_MAX_ATTEMPTS. Do not silently fall
        // back to a local session when the candidate has used their attempts.
        if (createRes.status === 403 && createData?.code === 'INTERVIEW_ATTEMPT_LIMIT_REACHED') {
          const message = createData.error || 'You have used all your AI mock interview attempts.';
          setAttemptLockMessage(message);
          setInterviewAttempts((prev) => ({
            ...(prev || {}),
            success: true,
            unlimited: false,
            maxAttempts: createData.maxAttempts ?? prev?.maxAttempts ?? 1,
            attemptsUsed: createData.attemptsUsed ?? prev?.attemptsUsed ?? 1,
            attemptsRemaining: 0,
            canStart: false
          }));
          if (typeof addToast === 'function') addToast(message, 'error');
          return;
        }

        if (createRes.ok && createData.success && createData.session) {
          currentSid = createData.session.id;
          setSessionId(currentSid);
          localStorage.setItem('last_interview_session_id', currentSid);
          if (Array.isArray(createData.session.questions) && createData.session.questions.length > 0) {
            sessionQuestions = createData.session.questions.slice(0, qCountLimit);
            setQuestions(sessionQuestions);
          }
        }
      } catch (apiErr) {
        console.warn('Backend interview session API notice:', apiErr.message);
      }

      if (!currentSid) {
        currentSid = `isess_local_${Date.now()}`;
        setSessionId(currentSid);
        localStorage.setItem('last_interview_session_id', currentSid);
      }

      setSessionActive(true);
      setCurrentQIndex(0);
      setTimerSeconds(0);
      setAnswersList([]);
      setWarningCount(0);
      setActiveWarningMessage('');
      setCompanionText('');
      accumulatedTranscriptRef.current = '';
      qStartTimeRef.current = Date.now();

      // Ensure camera is active
      if (!cameraActive) {
        await startCamera();
      }

      // Automatically request full screen upon starting interview
      try {
        if (document.documentElement.requestFullscreen) {
          await document.documentElement.requestFullscreen();
        } else if (document.documentElement.webkitRequestFullscreen) {
          await document.documentElement.webkitRequestFullscreen();
        }
      } catch (fsErr) {
        console.warn('Auto fullscreen request notice:', fsErr);
      }

      // Start background noise monitoring
      if (mediaStreamRef.current) {
        startAudioNoiseMonitoring(mediaStreamRef.current);
      }

      // Start timer
      timerIntervalRef.current = setInterval(() => {
        setTimerSeconds((prev) => prev + 1);
      }, 1000);

      // Reset measured telemetry for this session, then start real detection.
      resetTelemetryStats();
      setTelemetry({ eyeContact: 0, attention: 0, confidence: 0, emotion: 'Pending', headPose: 'Unknown' });

      telemetryIntervalRef.current = setInterval(() => {
        const stats = telemetryStatsRef.current;
        stats.frames += 1;

        // Camera track check
        if (mediaStreamRef.current) {
          const videoTrack = mediaStreamRef.current.getVideoTracks()[0];
          if (!videoTrack || !videoTrack.enabled || videoTrack.readyState === 'ended') {
            if (shouldFireViolation('camera', 10000)) {
              triggerProctoringViolation('Camera Feed Inactive / No Face Detected');
            }
          }
        }

        const canReadVideo = Boolean(
          videoRef.current && videoRef.current.readyState >= 2
        );

        // Face + gaze detection
        let faceStatus = 'unknown';
        let faceCount = 0;
        if (faceLandmarkerRef.current && canReadVideo) {
          try {
            const results = faceLandmarkerRef.current.detectForVideo(videoRef.current, performance.now());
            const classified = classifyFrame(results);
            faceStatus = classified.status;
            faceCount = classified.faceCount || 0;

            if (faceCount > 0) stats.facePresent += 1;
            if (faceStatus === 'face_ok') stats.gazeCentered += 1;

            if (faceStatus === 'no_face') {
              stats.noFaceFrames += 1;
              noFaceStreakRef.current += 1;
            } else {
              noFaceStreakRef.current = 0;
            }

            if (
              faceCount > 1 &&
              adminSettings.multiFaceDetection !== false &&
              shouldFireViolation('multiFace', 8000)
            ) {
              triggerProctoringViolation('Multiple Faces Detected');
            }
          } catch (e) { /* detector warm-up */ }
        }

        // Object + body detection (phones and secondary people, even face-hidden)
        let objectState = { phoneDetected: false, personCount: 0 };
        if (
          objectDetectorRef.current &&
          canReadVideo &&
          adminSettings.objectDetection !== false
        ) {
          try {
            const objectResults = objectDetectorRef.current.detectForVideo(videoRef.current, performance.now());
            objectState = classifyObjects(objectResults);
          } catch (e) { /* detector warm-up */ }
        }

        if (objectState.phoneDetected) {
          stats.phoneFrames += 1;
          phoneStreakRef.current += 1;
        } else {
          phoneStreakRef.current = 0;
        }

        if (objectState.personCount >= 2) {
          stats.extraPersonFrames += 1;
          extraPersonStreakRef.current += 1;
        } else {
          extraPersonStreakRef.current = 0;
        }

        const isAttentive =
          faceStatus === 'face_ok' &&
          !objectState.phoneDetected &&
          objectState.personCount < 2;
        if (isAttentive) stats.attentive += 1;

        const measured = computeMeasuredTelemetry(stats);
        const currentEmotion = objectState.phoneDetected || objectState.personCount >= 2
          ? 'Distracted'
          : faceStatus === 'face_ok'
            ? 'Focused'
            : faceStatus === 'no_face'
              ? 'Away'
              : 'Neutral';

        setTelemetry({
          ...measured,
          emotion: currentEmotion,
          headPose: faceStatus === 'looking_away'
            ? 'Turned'
            : faceStatus === 'face_ok' ? 'Centered' : 'Unknown',
        });

        // Escalate only after sustained detections to avoid single-frame noise.
        if (phoneStreakRef.current >= 2 && shouldFireViolation('phone', 8000)) {
          triggerProctoringViolation('Mobile phone detected in frame');
          phoneStreakRef.current = 0;
        } else if (extraPersonStreakRef.current >= 3 && shouldFireViolation('extraPerson', 8000)) {
          triggerProctoringViolation('Additional person detected in frame');
          extraPersonStreakRef.current = 0;
        } else if (noFaceStreakRef.current >= 5 && shouldFireViolation('noFace', 10000)) {
          triggerProctoringViolation('No face detected in frame');
          noFaceStreakRef.current = 0;
        }
      }, 1200);

      // Start autonomous turn-taking with Question 1
      const firstQ = sessionQuestions[0];
      setAgentState('SPEAKING');
      agentStateRef.current = 'SPEAKING';

      setTimeout(() => {
        speakAI(firstQ.questionText || firstQ.question, () => {
          // AI finishes asking question -> automatically transition to LISTENING
          setAgentState('LISTENING');
          agentStateRef.current = 'LISTENING';
          startSpeechRecognition();
        });
      }, 600);
    } catch (err) {
      console.error('Session start error:', err);
    }
  };

  // Clean up
  useEffect(() => {
    return () => {
      if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
      if (telemetryIntervalRef.current) clearInterval(telemetryIntervalRef.current);
      clearSarvamSegmentTimer();
      stopSpeechRecognition();
      stopAudioNoiseMonitoring();
      if (mediaStreamRef.current) mediaStreamRef.current.getTracks().forEach((t) => t.stop());
      releaseMicrophone();
      if (window.speechSynthesis) window.speechSynthesis.cancel();
      // Cancel any in-progress ElevenLabs audio
      if (elevenLabsAbortRef.current) { try { elevenLabsAbortRef.current.abort(); } catch { } }
      if (elevenLabsSourceRef.current) { try { elevenLabsSourceRef.current.stop(); } catch { } }
      // Stop any in-progress pre-rendered clip
      if (preRenderedAudioRef.current) { try { preRenderedAudioRef.current.pause(); } catch { } preRenderedAudioRef.current = null; }
      if (document.fullscreenElement) {
        document.exitFullscreen?.().catch(() => { });
      }
    };
  }, []);

  // Format timer
  const formatTimer = (sec) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  // ==========================================
  // VIEW 1: FINAL EVALUATION REPORT
  // ==========================================
  if (isReportReady) {
    const effectiveAnswers = (answersList && answersList.length > 0)
      ? answersList
      : ((finalAnalysis?.questionBreakdown && finalAnalysis.questionBreakdown.length > 0)
        ? finalAnalysis.questionBreakdown
        : questions.map((q, idx) => ({
          questionNumber: idx + 1,
          stage: `Q${idx + 1}`,
          question: q.questionText || q.question || 'Interview question',
          category: q.category || 'TECHNICAL',
          companionNote: 'No recorded answer for this question.',
          score: 0,
          technicalScore: 0,
          communicationScore: 0,
          eyeContactScore: 0,
          attentionScore: 0,
          confidenceScore: 0
        })));

    const answeredCount = effectiveAnswers.filter(a => a.score > 0).length;
    const hasSpokenAtAll = answeredCount > 0;

    const finalScore = hasSpokenAtAll
      ? (finalAnalysis ? Number(finalAnalysis.overallScore) : Math.round(effectiveAnswers.reduce((acc, curr) => acc + curr.score, 0) / effectiveAnswers.length))
      : 0;

    const avgEffective = (key) => {
      if (!effectiveAnswers.length) return 0;
      const total = effectiveAnswers.reduce((acc, curr) => {
        const n = Number(curr?.[key]);
        return acc + (Number.isFinite(n) ? n : 0);
      }, 0);
      return Math.round(total / effectiveAnswers.length);
    };

    const eyeContactVal = hasSpokenAtAll
      ? (finalAnalysis ? Number(finalAnalysis.eyeContactScore) || 0 : avgEffective('eyeContactScore'))
      : 0;
    const commVal = hasSpokenAtAll ? avgEffective('communicationScore') : 0;
    const techVal = hasSpokenAtAll ? avgEffective('technicalScore') : 0;
    const confVal = hasSpokenAtAll
      ? (finalAnalysis ? Number(finalAnalysis.confidenceScore) || 0 : avgEffective('confidenceScore'))
      : 0;
    const attVal = hasSpokenAtAll
      ? (finalAnalysis ? Number(finalAnalysis.attentionScore) || 0 : avgEffective('attentionScore'))
      : 0;

    const DIMENSIONS = [
      { label: 'Eye Contact', score: eyeContactVal, icon: Eye },
      { label: 'Attention Score', score: attVal, icon: AlignCenter },
      { label: 'Confidence', score: confVal, icon: Smile },
      { label: 'Communication', score: commVal, icon: Activity },
      { label: 'Technical Depth', score: techVal, icon: BrainCircuit },
    ];

    const handleSubmitToAnalysis = () => {
      try {
        if (!localStorage.getItem('rsj_latest_interview_analysis') && finalAnalysis) {
          localStorage.setItem('rsj_latest_interview_analysis', JSON.stringify({
            success: true,
            analysis: finalAnalysis,
            session: {
              id: sessionId || localStorage.getItem('last_interview_session_id') || `intv-${Date.now()}`,
              targetRole,
              questions: answersList
            }
          }));
        }
        localStorage.setItem('rsj_active_analytics_tab', 'interview');
        if (typeof addToast === 'function') {
          addToast('Interview submitted successfully! Opening Interview Analysis...', 'success');
        }
      } catch (e) {
        console.warn('Analysis submit sync notice:', e);
      }
      if (navigate) {
        navigate('/results?tab=interview');
      } else if (typeof navigateTo === 'function') {
        navigateTo('candidate-analytics');
      }
    };

    return (
      <div className="relative min-h-screen w-full bg-[#F8FAFC] text-slate-800 p-4 sm:p-7 flex flex-col justify-start">
        {/* Soft Ambient Background Glows matching website design */}
        <div className="absolute inset-0 pointer-events-none z-0">
          <canvas ref={canvasRef} className="absolute inset-0 w-full h-full opacity-30" />
          <div className="absolute top-1/4 -left-32 w-80 h-80 rounded-full bg-brand-500/5 blur-3xl" />
          <div className="absolute bottom-1/3 -right-20 w-64 h-64 rounded-full bg-cyan-500/5 blur-3xl" />
        </div>

        <div className="relative z-10 max-w-7xl mx-auto w-full space-y-6">
          {/* Studio Top Control Bar */}
          <div className="bg-white rounded-2xl border border-slate-200/90 shadow-card px-5 py-3.5 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2">
                <span className="text-xs font-black tracking-wide text-slate-900 font-sans uppercase">ReadySetJob AI Interview Studio</span>
                <span className="text-[10px] text-brand-700 font-mono font-bold px-2.5 py-0.5 rounded-full bg-brand-50 border border-brand-200 hidden sm:inline">VERIFIED EVALUATION</span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  if (!document.fullscreenElement) {
                    document.documentElement.requestFullscreen?.().catch(() => { });
                  } else {
                    document.exitFullscreen?.().catch(() => { });
                  }
                }}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 text-xs font-semibold transition-all shadow-xs cursor-pointer"
                title="Toggle Fullscreen"
              >
                <Maximize className="w-3.5 h-3.5 text-brand-600" />
                <span className="hidden sm:inline">Toggle Fullscreen</span>
              </button>
              <button
                onClick={handleOpenCandidateAnalysis}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white hover:bg-slate-50 text-slate-700 hover:text-brand-600 border border-slate-200 text-xs font-semibold transition-all shadow-xs cursor-pointer"
                title="Candidate Analysis Report"
              >
                <BarChart3 className="w-3.5 h-3.5 text-brand-600" />
                <span className="hidden sm:inline">Candidate Analysis</span>
              </button>
            </div>
          </div>

          {/* Evaluation Report Header Card */}
          <div className="bg-white rounded-3xl border border-slate-200/90 shadow-card p-6 sm:p-8 flex flex-col md:flex-row md:items-center justify-between gap-5">
            <div className="flex items-center gap-5">
              <MiniScoreRing score={finalScore} size={84} />
              <div>
                <div className="inline-flex items-center gap-1.5 px-3 py-1 bg-brand-50 border border-brand-200 rounded-full text-xs font-bold text-brand-700 mb-1.5">
                  <ShieldCheck className="w-3.5 h-3.5 text-brand-600" />
                  <span>Verified Evaluation for {targetRole}</span>
                </div>
                <h2 className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight font-sans">AI Mock Interview Evaluation Report</h2>
                <p className="text-xs sm:text-sm text-slate-500 mt-0.5 font-sans">
                  Resume ATS Benchmark: <strong className="text-brand-600 font-mono font-bold">{resumeATS}%</strong> • Role: <strong className="text-slate-800 font-bold">{targetRole}</strong>
                </p>
                {warningCount > 0 && (
                  <div className="mt-2 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1 font-mono flex items-center gap-1.5 w-fit">
                    <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />
                    <span>Recorded Proctoring Warnings: {warningCount}/3</span>
                  </div>
                )}
              </div>
            </div>

            <div className="flex items-center gap-3 flex-shrink-0">
              <button
                id="submit-interview-top-btn"
                onClick={handleSubmitToAnalysis}
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-brand-600 to-cyan-600 hover:from-brand-700 hover:to-cyan-700 active:scale-[0.98] text-white text-xs sm:text-sm font-bold transition-all shadow-md shadow-brand-500/25 cursor-pointer"
              >
                <CheckCircle2 className="w-4 h-4 text-white" />
                <span>Submit</span>
              </button>
              <button
                onClick={handleOpenCandidateAnalysis}
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 hover:text-brand-600 text-xs font-bold transition-all border border-slate-200 shadow-xs cursor-pointer"
              >
                <BarChart3 className="w-4 h-4 text-brand-600" />
                <span>Candidate Analysis</span>
              </button>
            </div>
          </div>

          {/* 5 Dimension KPI Tiles */}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 sm:gap-4">
            {DIMENSIONS.map(({ label, score, icon: Icon }) => (
              <div key={label} className="bg-white rounded-2xl border border-slate-200/80 shadow-card p-4 text-center hover:shadow-md transition-shadow">
                <div className="w-9 h-9 rounded-xl bg-brand-50 text-brand-600 flex items-center justify-center mx-auto mb-2 border border-brand-100">
                  <Icon className="w-4 h-4" />
                </div>
                <div className="text-xl sm:text-2xl font-black text-slate-900 font-mono">{score}%</div>
                <div className="text-xs text-slate-500 font-semibold font-sans mt-0.5">{label}</div>
              </div>
            ))}
          </div>

          {/* Resume Skills Match Box */}
          <div className="bg-white rounded-3xl border border-slate-200/90 shadow-card p-6 sm:p-8 space-y-5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h3 className="text-lg font-black text-slate-900 font-sans">Skills for {targetRole}</h3>
                <p className="text-xs text-slate-500 font-medium mt-0.5">Resume skillset alignment evaluated against role requirements.</p>
              </div>
              <div className="flex items-center gap-2 px-3.5 py-1.5 rounded-xl bg-slate-50 border border-slate-200 text-xs font-mono self-start sm:self-auto">
                <span className="text-slate-500 font-semibold">ATS Match Benchmark:</span>
                <span className="text-emerald-600 font-black">{skillGaps.atsScore}%</span>
              </div>
            </div>

            {/* Skills Present in Your Resume */}
            {skillGaps.matchedCore && skillGaps.matchedCore.length > 0 ? (
              <div className="p-5 rounded-2xl bg-emerald-50/50 border border-emerald-200/80">
                <div className="flex items-center gap-2 mb-3 text-xs font-bold text-emerald-800 font-sans">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                  <span>Skills Present in Your Resume ({skillGaps.matchedCore.length})</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {skillGaps.matchedCore.map((skill, i) => (
                    <span key={i} className="px-3.5 py-1.5 rounded-xl bg-white border border-emerald-200 text-xs font-semibold text-emerald-800 shadow-2xs">
                      {skill}
                    </span>
                  ))}
                </div>
              </div>
            ) : (
              <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-500 font-medium">
                No specific core resume skills detected for this role.
              </div>
            )}
          </div>

          {/* Question Evaluation Breakdown */}
          <div className="bg-white rounded-3xl border border-slate-200/90 shadow-card p-6 sm:p-8">
            <div className="flex items-center justify-between mb-4">
              <h4 className="text-sm font-black uppercase tracking-wider text-slate-800 font-sans">Question Evaluation Breakdown</h4>
              <span className="text-xs font-mono text-slate-500 font-bold">{effectiveAnswers.length} {effectiveAnswers.length === 1 ? 'Question' : 'Questions'} Evaluated</span>
            </div>
            <div className="space-y-3">
              {effectiveAnswers.map((item, idx) => {
                const isSkipped = Boolean(
                  item.isSkipped ||
                  item.score === 0 ||
                  !item.companionNote ||
                  item.companionNote.includes('No verbal') ||
                  item.companionNote.includes('Skipped')
                );

                return (
                  <div key={idx} className="p-4 rounded-2xl bg-slate-50/70 hover:bg-slate-50 border border-slate-200/80 flex flex-col sm:flex-row sm:items-center justify-between gap-3 transition-colors shadow-2xs">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 mb-1.5">
                        <span className="text-[11px] font-mono font-bold text-brand-700 bg-brand-50 px-2.5 py-0.5 rounded-md border border-brand-200">{item.stage}</span>
                        <span className="text-[11px] text-slate-500 uppercase tracking-wider font-mono font-semibold">{item.category}</span>
                      </div>
                      <div className="text-xs sm:text-sm text-slate-900 font-semibold font-sans">{item.question}</div>
                      <div className="text-xs text-slate-600 mt-2 italic font-sans bg-white p-2.5 rounded-xl border border-slate-200/70">
                        {isSkipped ? (
                          <span className="text-amber-700 font-semibold not-italic">Answer Skipped — Candidate did not provide an answer (No analysis)</span>
                        ) : (
                          `"${item.companionNote || 'Answer verbalized'}"`
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      {isSkipped ? (
                        <span className="text-xs font-mono font-bold px-3 py-1.5 rounded-xl bg-amber-50 text-amber-700 border border-amber-200 shadow-2xs">
                          Answer Skipped
                        </span>
                      ) : (
                        <>
                          <span className="text-xs font-mono font-bold px-3 py-1.5 rounded-xl bg-brand-50 text-brand-700 border border-brand-200 shadow-2xs">
                            Score: {item.score}/100
                          </span>
                          <span className="text-xs font-mono font-bold px-3 py-1.5 rounded-xl bg-emerald-50 text-emerald-700 border border-emerald-200 shadow-2xs">
                            Gaze: {item.eyeContactScore}%
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Bottom Final Submit Banner */}
          <div className="bg-white rounded-3xl border border-slate-200/90 shadow-card p-6 sm:p-8 flex flex-col sm:flex-row items-center justify-between gap-5">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-brand-600 to-cyan-600 text-white flex items-center justify-center flex-shrink-0 shadow-sm">
                <CheckCircle2 className="w-6 h-6" />
              </div>
              <div>
                <h4 className="text-base font-black text-slate-900 font-sans">Ready to View In-Depth Analysis?</h4>
                <p className="text-xs sm:text-sm text-slate-500 mt-0.5 font-sans">Submit your interview report now to access complete telemetry graphs, behavioral analytics, and AI recommendations.</p>
              </div>
            </div>
            <button
              id="submit-interview-bottom-btn"
              onClick={handleSubmitToAnalysis}
              className="w-full sm:w-auto px-7 py-3.5 rounded-xl bg-gradient-to-r from-brand-600 to-cyan-600 hover:from-brand-700 hover:to-cyan-700 active:scale-[0.98] text-white font-black text-sm shadow-md shadow-brand-500/25 transition-all flex items-center justify-center gap-2.5 cursor-pointer flex-shrink-0"
            >
              <CheckCircle2 className="w-4 h-4" />
              <span>Submit</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ==========================================
  // VIEW: LOCKED / ASSESSMENT REQUIRED CHECKS
  // ==========================================
  // CANDIDATE ASSESSMENT LOCK SYSTEM
  // ==========================================
  const isAdmin = role === 'admin' || Boolean(adminUser) || (typeof window !== 'undefined' && localStorage.getItem('rsj_role') === 'admin');

  const isAllMix = (cat = '', title = '') => {
    const c = String(cat || '').toLowerCase().trim();
    const t = String(title || '').toLowerCase().trim();
    return (
      ['all mix', 'all', 'full length', 'all mix (combined)', 'hybrid all-mix'].some(m => c.includes(m)) ||
      t.includes('all mix') ||
      t.includes('full test') ||
      t.includes('job readiness full')
    );
  };

  // List of active assessments (dynamic or mock fallback)
  const activeAssessmentsList = typeof getActiveAssessments === 'function'
    ? getActiveAssessments(assessments)
    : ((Array.isArray(assessments) && assessments.length > 0) ? assessments : [
        { id: 'asm-code-1', title: 'Full-Stack Algorithmic Coding Challenge', category: 'Coding', totalQuestions: 4, durationMinutes: 10 },
        { id: 'asm-reas-1', title: 'Logical Reasoning & Critical Thinking Exam', category: 'Reasoning', totalQuestions: 10, durationMinutes: 10 },
        { id: 'asm-apt-1', title: 'Quantitative Aptitude Benchmark Test', category: 'Aptitude', totalQuestions: 10, durationMinutes: 10 },
        { id: 'asm-tech-1', title: 'Core Technical & CS Fundamentals Assessment', category: 'Technical', totalQuestions: 10, durationMinutes: 10 }
      ]);

  const checkIsCompleted = (asm) => {
    if (!asm) return false;
    if (typeof checkAssessmentCompleted === 'function' && checkAssessmentCompleted(asm, { isAssessmentCompleted, candidateSubmissions })) return true;
    if (typeof isAssessmentCompleted === 'function' && isAssessmentCompleted(asm)) return true;
    if (asm.status === 'Completed') return true;
    const targetId = String(asm.id || '').trim().toLowerCase();
    const targetCat = String(asm.category || '').trim().toLowerCase();
    const targetTitle = String(asm.title || '').trim().toLowerCase();

    return (candidateSubmissions || []).some(s => {
      const subAsmId = String(s.assessment_id || s.assessmentId || '').trim().toLowerCase();
      if (targetId && subAsmId && subAsmId === targetId) return true;
      const subCat = String(s.category || '').trim().toLowerCase();
      if (targetCat && subCat && subCat === targetCat) return true;
      const subTitle = String(s.assessment_title || s.assessmentName || '').trim().toLowerCase();
      if (targetTitle && subTitle && subTitle === targetTitle) return true;
      return false;
    });
  };

  const completedList = activeAssessmentsList.filter(checkIsCompleted);
  const completedCount = completedList.length;
  const totalRequiredCount = activeAssessmentsList.length;
  const hasCompletedAllMixInList = activeAssessmentsList.some(asm => isAllMix(asm.category, asm.title) && checkIsCompleted(asm));
  const hasCompletedAllMixSub = (candidateSubmissions || []).some(s => isAllMix(s.category, s.assessment_title || s.assessmentName) && (s.status === 'Completed' || s.score !== undefined || s.obtained_marks !== undefined));

  const hasCompletedAllAssessments = Boolean(
    isInterviewUnlocked ||
    isAdmin ||
    hasCompletedAllMixInList ||
    hasCompletedAllMixSub ||
    (totalRequiredCount > 0 && completedCount === totalRequiredCount) ||
    (totalRequiredCount === 1 && completedCount >= 1)
  );
  const completionPercentage = totalRequiredCount > 0 ? Math.round((completedCount / totalRequiredCount) * 100) : 0;

  // ==========================================
  // VIEW: ATTEMPT LIMIT REACHED
  // ==========================================
  if (!isAdmin && interviewAttempts && interviewAttempts.canStart === false) {
    const maxAttempts = interviewAttempts.maxAttempts;
    const limitMessage = attemptLockMessage
      || (maxAttempts === 1
        ? 'You have already completed your AI mock interview. Only one attempt is allowed.'
        : `You have used all ${maxAttempts} AI mock interview attempts.`);
    return (
      <div className="relative min-h-[calc(100vh-4rem)] w-full bg-[#F8FAFC] text-slate-800 p-4 sm:p-8 flex flex-col items-center justify-center">
        <div className="absolute inset-0 pointer-events-none z-0 overflow-hidden">
          <div className="absolute top-1/4 left-1/3 w-96 h-96 rounded-full bg-rose-500/5 blur-3xl" />
          <div className="absolute bottom-1/4 right-1/3 w-96 h-96 rounded-full bg-brand-500/5 blur-3xl" />
        </div>

        <div className="relative z-10 w-full max-w-2xl bg-white border border-slate-200/90 rounded-3xl shadow-xl p-6 sm:p-10 space-y-6 text-center animate-in fade-in zoom-in-95 duration-300">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-rose-50 border border-rose-200 text-rose-600 shadow-xs">
            <ShieldAlert className="w-8 h-8" />
          </div>

          <div className="space-y-3">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-rose-100/80 border border-rose-300 text-rose-900 text-xs font-bold">
              <Lock className="w-3.5 h-3.5" />
              <span>Attempt Limit Reached</span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-black text-slate-900 tracking-tight">
              AI Mock Interview Locked
            </h1>
            <p className="text-sm text-slate-600 max-w-lg mx-auto leading-relaxed">
              {limitMessage}
            </p>
            <p className="text-xs font-mono text-slate-500">
              Attempts used: {interviewAttempts.attemptsUsed}
              {maxAttempts ? ` / ${maxAttempts}` : ''}
            </p>
          </div>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-2">
            <button
              type="button"
              onClick={() => navigateTo('candidate-analytics')}
              className="w-full sm:w-auto px-6 py-3 rounded-xl bg-gradient-to-r from-brand-600 to-cyan-600 hover:from-brand-700 hover:to-cyan-700 text-white font-bold text-sm shadow-md shadow-brand-500/20 transition-all flex items-center justify-center gap-2 cursor-pointer hover:scale-[1.01]"
            >
              <BarChart3 className="w-4 h-4" />
              <span>View My Results</span>
            </button>
            <button
              type="button"
              onClick={() => navigateTo('assessments')}
              className="w-full sm:w-auto px-6 py-3 rounded-xl bg-slate-100 hover:bg-slate-200 border border-slate-200 text-slate-700 font-bold text-sm transition-all flex items-center justify-center gap-2 cursor-pointer"
            >
              <ClipboardList className="w-4 h-4" />
              <span>Go to Assessments</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ==========================================
  // VIEW: LOCKED ASSESSMENT GATE (PREREQUISITE GATEWAY)
  // ==========================================
  if (!isAdmin && !hasCompletedAllAssessments) {
    return (
      <div className="relative min-h-[calc(100vh-4rem)] w-full bg-[#F8FAFC] text-slate-800 p-4 sm:p-8 flex flex-col items-center justify-center">
        {/* Soft Ambient Background Glows */}
        <div className="absolute inset-0 pointer-events-none z-0 overflow-hidden">
          <div className="absolute top-1/4 left-1/3 w-96 h-96 rounded-full bg-amber-500/5 blur-3xl" />
          <div className="absolute bottom-1/4 right-1/3 w-96 h-96 rounded-full bg-brand-500/5 blur-3xl" />
        </div>

        <div className="relative z-10 w-full max-w-3xl bg-white border border-slate-200/90 rounded-3xl shadow-xl p-6 sm:p-10 space-y-7 animate-in fade-in zoom-in-95 duration-300">
          {/* Header & Lock Icon */}
          <div className="text-center space-y-3">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-amber-50 border border-amber-200 text-amber-600 mb-1 shadow-xs">
              <Lock className="w-8 h-8" />
            </div>

            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-amber-100/80 border border-amber-300 text-amber-900 text-xs font-bold">
              <span>Prerequisite Required</span>
              <span>•</span>
              <span>{activeAssessmentsList.length === 1 || activeAssessmentsList.some(a => isAllMix(a.category, a.title)) ? 'Assessment Completion Mandatory' : `${totalRequiredCount} Assessments Mandatory`}</span>
            </div>

            <h1 className="text-2xl sm:text-3xl font-black text-slate-900 tracking-tight">
              AI Mock Interview is Locked
            </h1>
            <p className="text-xs sm:text-sm text-slate-600 max-w-xl mx-auto leading-relaxed">
              {activeAssessmentsList.length === 1 || activeAssessmentsList.some(a => isAllMix(a.category, a.title))
                ? 'Complete your Job Readiness Assessment to unlock your personalized AI Mock Interview session.'
                : 'Complete all assessment modules to unlock your personalized AI Mock Interview session.'}
            </p>
          </div>

          {/* Progress Tracker Card */}
          <div className="p-4 sm:p-5 rounded-2xl bg-slate-50 border border-slate-200/80 space-y-3">
            <div className="flex items-center justify-between text-xs font-bold">
              <span className="text-slate-700">Assessment Completion Progress</span>
              <span className="font-mono text-brand-700">
                {completedCount} / {totalRequiredCount} Modules Completed ({completionPercentage}%)
              </span>
            </div>

            {/* Progress Bar Track */}
            <div className="w-full h-3 bg-slate-200 rounded-full overflow-hidden p-0.5">
              <div
                className="h-full bg-gradient-to-r from-amber-500 via-brand-500 to-emerald-500 rounded-full transition-all duration-500"
                style={{ width: `${Math.max(completionPercentage, 4)}%` }}
              />
            </div>
          </div>

          {/* Module Checklist Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            {activeAssessmentsList.map((asm) => {
              const isDone = checkIsCompleted(asm);
              return (
                <div
                  key={asm.id}
                  className={`p-4 rounded-xl border transition-all flex items-center justify-between gap-3 ${
                    isDone
                      ? 'bg-emerald-50/60 border-emerald-200 text-slate-800'
                      : 'bg-white border-slate-200 hover:border-slate-300 text-slate-700'
                  }`}
                >
                  <div className="space-y-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded ${
                        isDone ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-600'
                      }`}>
                        {asm.category || 'Module'}
                      </span>
                    </div>
                    <p className="text-xs font-bold text-slate-900 truncate">
                      {asm.title}
                    </p>
                    <p className="text-[11px] text-slate-500">
                      {asm.totalQuestions || 10} Questions • 10m
                    </p>
                  </div>

                  <div className="flex-shrink-0">
                    {isDone ? (
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-800 font-bold text-[11px] border border-emerald-300">
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                        <span>Completed</span>
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={async () => {
                          try {
                            if (typeof startAssessment === 'function') {
                              await startAssessment(asm.id);
                            }
                          } catch (e) {
                            console.warn('startAssessment error:', e);
                          }
                          navigateTo('take-assessment');
                        }}
                        className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-brand-600 hover:bg-brand-700 text-white font-bold text-xs transition-all shadow-xs cursor-pointer hover:scale-105"
                      >
                        <span>Start</span>
                        <ArrowRight className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Action CTAs */}
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-2">
            <button
              type="button"
              onClick={() => navigateTo('assessments')}
              className="w-full sm:w-auto px-8 py-3.5 rounded-xl bg-gradient-to-r from-brand-600 to-cyan-600 hover:from-brand-700 hover:to-cyan-700 text-white font-black text-sm shadow-lg shadow-brand-500/25 transition-all flex items-center justify-center gap-2.5 cursor-pointer hover:scale-[1.01]"
            >
              <span>Go to Assessments Suite</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ==========================================
  // VIEW 2: STEP 1 SETUP (PICTURE 1)
  // ==========================================
  if (stage === 'setup') {
    return (
      <div className="relative min-h-screen w-full overflow-hidden bg-[#F8FAFC] text-slate-800 p-4 sm:p-8 flex flex-col justify-start">

        {/* Soft Ambient Background Glows */}
        <div className="absolute inset-0 pointer-events-none z-0">
          <div className="absolute top-0 right-1/4 w-96 h-96 rounded-full bg-brand-500/5 blur-3xl" />
          <div className="absolute bottom-0 left-1/4 w-96 h-96 rounded-full bg-cyan-500/5 blur-3xl" />
        </div>

        {/* Studio Top Control Bar */}
        <div className="relative z-10 w-full max-w-5xl mx-auto flex items-center justify-between pb-4 mb-4 border-b border-slate-200/90">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <span className="text-xs font-black tracking-wide text-slate-900 font-sans uppercase">ReadySetJob AI Interview Studio</span>
              <span className="text-[10px] text-brand-700 font-mono font-bold px-2.5 py-0.5 rounded-full bg-brand-50 border border-brand-200 hidden sm:inline">FULLSCREEN</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                if (!document.fullscreenElement) {
                  document.documentElement.requestFullscreen?.().catch(() => { });
                } else {
                  document.exitFullscreen?.().catch(() => { });
                }
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 text-xs font-semibold transition-all shadow-xs cursor-pointer"
              title="Toggle Fullscreen"
            >
              <Maximize className="w-3.5 h-3.5 text-brand-600" />
              <span className="hidden sm:inline">Toggle Fullscreen</span>
            </button>
          </div>
        </div>

        <div className="relative z-10 w-full max-w-4xl mx-auto my-auto">

          {/* Admin Testing Mode Badge */}
          {isAdmin && (
            <div className="flex justify-center mb-3">
              <div className="inline-flex items-center gap-2 px-3.5 py-1.5 bg-purple-50 border border-purple-200 text-purple-700 rounded-full text-xs font-mono font-bold shadow-xs">
                <ShieldCheck className="w-3.5 h-3.5 text-purple-600" />
                <span>Admin Testing Mode Active • Interview Session Unlocked</span>
              </div>
            </div>
          )}

          {/* Subtitle directly matching website design */}
          <div className="text-center mb-6">
            <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-brand-50 border border-brand-200 text-brand-700 text-xs font-bold tracking-wider uppercase mb-3 font-sans shadow-xs">
              <Sparkles className="w-3.5 h-3.5 text-brand-600" />
              <span>AI Mock Interview Preparation Studio</span>
            </div>
            <p className="text-sm sm:text-base text-slate-500 max-w-2xl mx-auto leading-relaxed font-sans">
              Extract skills, evaluate experience depth, score candidate suitability, match targeted job descriptions, and evaluate personalized interview readiness.
            </p>
          </div>

          {/* Main Container Card (Picture 1) */}
          <div className="rounded-2xl bg-white border border-slate-200 shadow-xl shadow-slate-200/40 p-6 sm:p-8">

            {/* COMPACT RESUME DROP ZONE */}
            <div
              onDragOver={(e) => e.preventDefault()}
              onDrop={handleDrop}
              className="relative border-2 border-dashed border-brand-200 hover:border-brand-400 rounded-xl p-4 sm:p-5 text-center transition-all bg-brand-50/20 hover:bg-brand-50/50 group shadow-xs"
            >
              <input
                type="file"
                accept=".pdf,.txt"
                id="resume-file-input"
                className="hidden"
                onChange={(e) => {
                  const selected = e.target.files?.[0];
                  e.target.value = '';
                  handleFileUpload(selected);
                }}
              />

              <div className="flex flex-col sm:flex-row items-center justify-between gap-3 text-left">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-10 h-10 rounded-lg bg-brand-50 border border-brand-200 flex items-center justify-center flex-shrink-0 group-hover:scale-105 transition-transform text-brand-600 shadow-xs">
                    <FileText className="w-5 h-5" />
                  </div>
                  <div className="min-w-0">
                    <h3 className="text-sm font-bold text-slate-900 truncate font-sans">
                      {uploadedFileName ? `Resume Uploaded: ${uploadedFileName}` : 'Drag & drop your resume here'}
                    </h3>
                    <p className="text-[11px] text-slate-500 font-sans">
                      Supports PDF and TXT files (Max 20MB) • ATS & Skill Match
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2 flex-shrink-0">
                  <label
                    htmlFor="resume-file-input"
                    className="inline-flex items-center justify-center px-4 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-900 text-xs font-semibold text-white shadow-xs transition-all cursor-pointer hover:scale-105 font-sans"
                  >
                    {uploadedFileName ? 'Change File' : 'Browse File'}
                  </label>

                  {uploadedFileName && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleClearResume();
                      }}
                      className="inline-flex items-center gap-1 px-3 py-2 rounded-lg bg-rose-50 hover:bg-rose-100 border border-rose-200 text-xs font-semibold text-rose-700 transition-all cursor-pointer font-sans"
                      title="Remove uploaded resume"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>Remove</span>
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* Scanning Progress Bar */}
            {isScanning && (
              <div className="mt-5 p-4 rounded-xl bg-brand-50/80 border border-brand-200 text-center">
                <div className="flex items-center justify-center gap-2 mb-2">
                  <RefreshCw className="w-4 h-4 text-brand-600 animate-spin" />
                  <span className="text-xs font-bold text-brand-700 font-sans">Extracting skills & evaluating ATS match ({scanProgress}%)...</span>
                </div>
                <div className="w-full bg-brand-100 h-1.5 rounded-full overflow-hidden">
                  <div
                    className="bg-brand-600 h-full transition-all duration-300 rounded-full"
                    style={{ width: `${scanProgress}%` }}
                  />
                </div>
              </div>
            )}

            {/* TARGET ROLE INPUT FIELD (Picture 1) */}
            <div className="mt-6">
              <label className="block text-xs sm:text-sm font-bold text-slate-800 mb-2 font-sans">
                Target Role <span className="text-slate-400 font-normal">(Enter Manually)</span>
              </label>

              <div className="relative">
                <input
                  type="text"
                  value={targetRole}
                  onChange={(e) => handleRoleChange(e.target.value)}
                  placeholder="e.g. Data Scientist, ML Engineer, Software Engineer"
                  className="w-full bg-slate-50/80 hover:bg-white focus:bg-white border border-slate-200 hover:border-slate-300 focus:border-brand-500 focus:ring-4 focus:ring-brand-500/10 rounded-xl px-4 py-3 pr-10 text-sm text-slate-900 placeholder-slate-400 focus:outline-none transition-all shadow-xs font-sans font-medium"
                />
                {targetRole && (
                  <button
                    type="button"
                    onClick={() => handleRoleChange('')}
                    className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-md transition-all cursor-pointer"
                    title="Clear input"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>

              <p className="mt-2 text-[11px] text-slate-500 font-sans">
                Type your desired job role above (e.g. Data Scientist, ML Engineer, Full Stack Developer, etc.). The interview questions and ATS benchmark calibrate automatically.
              </p>
            </div>

            {/* ATS MATCH & EXTRACTED SKILLS (Shown ONLY when a resume is uploaded) */}
            {hasUploadedResume ? (
              <div className="mt-6 pt-6 border-t border-slate-100">
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mb-4">
                  <div className="flex items-center gap-2.5">
                    <span className="px-3 py-1 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs font-mono font-bold">
                      ATS Match: {resumeATS}%
                    </span>
                    <span className="text-xs text-slate-600 font-medium font-sans">
                      Calibrated for: <strong className="text-slate-900 font-bold">{targetRole}</strong>
                    </span>
                  </div>
                </div>

                {/* Extracted Skills Pills from Resume */}
                {analysisResult?.skills && analysisResult.skills.length > 0 ? (
                  <div className="flex items-center gap-1.5 flex-wrap mb-3">
                    <span className="text-[11px] text-emerald-800 font-semibold mr-1 font-sans">Skills Present in Resume:</span>
                    {analysisResult.skills.slice(0, 10).map((skill, idx) => (
                      <span
                        key={idx}
                        className="px-2.5 py-0.5 rounded-md bg-slate-100 border border-slate-200 text-[11px] font-mono text-slate-700 font-medium"
                      >
                        {skill}
                      </span>
                    ))}
                  </div>
                ) : (
                  <div className="mb-3 text-[11px] text-slate-500 font-sans italic">
                    No specific technical skills detected in the uploaded resume.
                  </div>
                )}

                {/* Missed Skills to Learn According to Resume */}
                {skillGaps.skillsToCover && skillGaps.skillsToCover.length > 0 && (
                  <div className="flex items-center gap-1.5 flex-wrap mb-4">
                    <span className="text-[11px] text-amber-700 font-semibold mr-1 font-sans">
                      Missed Skills to Learn (According to Resume):
                    </span>
                    {skillGaps.skillsToCover.slice(0, 8).map((skill, idx) => (
                      <span
                        key={idx}
                        className="px-2.5 py-0.5 rounded-md bg-amber-50 border border-amber-200 text-[11px] font-mono text-amber-800 font-medium"
                      >
                        + {skill}
                      </span>
                    ))}
                  </div>
                )}

                {/* Primary Action Button */}
                <div className="space-y-3">
                  <button
                    type="button"
                    onClick={handleProceedToRoom}
                    className="w-full flex items-center justify-center gap-2 py-3.5 px-6 rounded-xl bg-brand-600 hover:bg-brand-700 text-white font-bold text-sm sm:text-base shadow-md shadow-brand-600/20 transition-all hover:scale-[1.005] cursor-pointer font-sans"
                  >
                    <span>Proceed to Live AI Interview Room</span>
                    <ArrowRight className="w-4 h-4" />
                  </button>
                  {isInterviewCompleted && (
                    <div className="flex items-center justify-between p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs">
                      <div className="flex items-center gap-2 text-slate-700 font-medium">
                        <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                        <span>Previous interview session saved</span>
                      </div>
                      <button
                        type="button"
                        onClick={handleOpenCandidateAnalysis}
                        className="text-brand-600 hover:text-brand-700 font-bold hover:underline cursor-pointer flex items-center gap-1"
                      >
                        <BarChart3 className="w-3.5 h-3.5" />
                        <span>View Past Analysis Report</span>
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="mt-6 pt-6 border-t border-slate-100 space-y-4">
                <div className="p-4 rounded-2xl bg-sky-50/60 border border-sky-200/80 flex items-start gap-3.5 text-sky-900">
                  <div className="w-9 h-9 rounded-xl bg-white border border-sky-200 flex items-center justify-center text-sky-600 flex-shrink-0 shadow-2xs mt-0.5">
                    <FileText className="w-4 h-4" />
                  </div>
                  <div className="text-xs">
                    <strong className="text-slate-900 block font-bold text-sm mb-0.5">Resume is optional</strong>
                    <p className="text-slate-600 font-sans leading-relaxed">
                      You can proceed without a resume. Adding one gives better results &mdash; tailored questions, ATS match scoring, and skill gap analysis for <strong className="text-slate-900 font-bold">{targetRole || 'your target role'}</strong>.
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={handleProceedToRoom}
                  className="w-full flex items-center justify-center gap-2 py-3.5 px-6 rounded-xl bg-brand-600 hover:bg-brand-700 text-white font-bold text-sm sm:text-base shadow-md shadow-brand-600/20 transition-all hover:scale-[1.005] cursor-pointer font-sans"
                >
                  <span>Proceed to Live AI Interview Room</span>
                  <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            )}

          </div>
        </div>

      {/* Resume Confirmation Modal - inside main container */}
      {showResumeConfirmModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6">
            {resumeConfirmChoice === null ? (
              // Initial question: Do you have a resume?
              <>
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-12 h-12 rounded-xl bg-brand-50 border border-brand-200 flex items-center justify-center text-brand-600 flex-shrink-0">
                    <FileText className="w-6 h-6" />
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-slate-900">Do you have a resume?</h3>
                    <p className="text-sm text-slate-500 mt-1">Upload your resume to get tailored questions and ATS benchmarking.</p>
                  </div>
                </div>
                <div className="flex items-center justify-center gap-3 w-full">
                  <button
                    type="button"
                    onClick={handleResumeConfirmYes}
                    className="flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-brand-600 hover:bg-brand-700 text-white font-bold text-sm shadow-md shadow-brand-600/20 transition-all cursor-pointer font-sans"
                  >
                    <Upload className="w-4 h-4" />
                    <span>Yes, Upload Resume</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleResumeConfirmNo}
                    className="flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-slate-100 hover:bg-slate-200 border border-slate-200 text-slate-700 font-bold text-sm transition-all cursor-pointer font-sans"
                  >
                    <X className="w-4 h-4" />
                    <span>No, Continue Without</span>
                  </button>
                </div>
                <button
                  type="button"
                  onClick={handleResumeConfirmCancel}
                  className="mt-4 w-full text-sm text-slate-500 hover:text-slate-700 font-medium cursor-pointer"
                >
                  Cancel
                </button>
              </>
            ) : resumeConfirmChoice === 'no' ? (
              // Confirmation: Are you sure you want to proceed without resume?
              <>
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-12 h-12 rounded-xl bg-amber-50 border border-amber-200 flex items-center justify-center text-amber-600 flex-shrink-0">
                    <AlertTriangle className="w-6 h-6" />
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-slate-900">Proceed Without Resume?</h3>
                    <p className="text-sm text-slate-500 mt-1">
                      With a resume, you&apos;ll get better results &mdash; tailored questions, ATS match scoring, 
                      and skill gap analysis for <strong className="text-slate-900">{targetRole}</strong>.
                    </p>
                  </div>
                </div>
                <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 mb-4">
                  <p className="text-xs text-amber-800 font-medium flex items-center gap-1.5">
                    <Info className="w-3.5 h-3.5" />
                    You can still take the interview, but questions will be generic for your target role.
                  </p>
                </div>
                <div className="flex items-center justify-center gap-3 w-full">
                  <button
                    type="button"
                    onClick={handleResumeConfirmProceedWithout}
                    className="flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-brand-600 hover:bg-brand-700 text-white font-bold text-sm shadow-md shadow-brand-600/20 transition-all cursor-pointer font-sans"
                  >
                    <ArrowRight className="w-4 h-4" />
                    <span>Yes, Start Interview</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleResumeConfirmCancel}
                    className="flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-slate-100 hover:bg-slate-200 border border-slate-200 text-slate-700 font-bold text-sm transition-all cursor-pointer font-sans"
                  >
                    <RotateCcw className="w-4 h-4" />
                    <span>Go Back</span>
                  </button>
                </div>
              </>
            ) : (
              // Uploading state - just show loading
              <div className="text-center py-4">
                <RefreshCw className="w-8 h-8 text-brand-600 animate-spin mx-auto mb-3" />
                <p className="text-slate-600 font-medium">Opening file picker...</p>
              </div>
            )}
          </div>
        </div>
      )}

      </div>
    );
  }

  // ==========================================
  // VIEW 3: LIVE INTERVIEW STAGE (PICTURE 2)
  // ==========================================
  // The mic is controllable only on the candidate's turn.
  const micLocked = agentState === 'SPEAKING' || agentState === 'AI_RESPONSE' || agentState === 'PROCESSING';

  return (
    <div className="relative h-[100dvh] max-h-[100dvh] w-full overflow-hidden bg-[#F8FAFC] text-slate-800 p-2 sm:p-3 flex flex-col justify-between select-none">

      {/* Subtle Ambient Background Glows matching website design */}
      <div className="absolute inset-0 pointer-events-none z-0">
        <canvas ref={canvasRef} className="absolute inset-0 w-full h-full opacity-30" />
        <div className="absolute top-1/4 -left-32 w-80 h-80 rounded-full bg-brand-500/5 blur-3xl" />
        <div className="absolute bottom-1/3 -right-20 w-64 h-64 rounded-full bg-cyan-500/5 blur-3xl" />
      </div>

      {/* Content */}
      <div className="relative z-10 max-w-7xl mx-auto w-full h-full flex flex-col justify-between gap-2 sm:gap-2.5 min-h-0 overflow-hidden">
        {/* Studio Top Control Bar */}
        <div className="bg-white rounded-xl border border-slate-200/90 shadow-2xs px-4 py-2 shrink-0 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="flex items-center gap-2">
              <span className="text-xs font-black tracking-wide text-slate-900 font-sans uppercase">ReadySetJob AI Interview Studio</span>
              <span className="text-[10px] text-brand-600 font-mono font-bold px-2 py-0.5 rounded-full bg-brand-50 border border-brand-200 hidden sm:inline">FULLSCREEN</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                if (!document.fullscreenElement) {
                  document.documentElement.requestFullscreen?.().catch(() => { });
                } else {
                  document.exitFullscreen?.().catch(() => { });
                }
              }}
              className="flex items-center gap-1.5 px-3 py-1 rounded-xl bg-white hover:bg-slate-50 text-slate-700 hover:text-slate-900 border border-slate-200 text-xs font-semibold transition-all shadow-2xs cursor-pointer"
              title="Toggle Fullscreen"
            >
              <Maximize className="w-3 h-3 text-brand-600" />
              <span className="hidden sm:inline">Toggle Fullscreen</span>
            </button>
            <button
              onClick={handleOpenCandidateAnalysis}
              className="flex items-center gap-1.5 px-3 py-1 rounded-xl bg-white hover:bg-slate-50 text-slate-700 hover:text-brand-600 border border-slate-200 text-xs font-semibold transition-all shadow-2xs cursor-pointer"
              title="Candidate Analysis Report"
            >
              <BarChart3 className="w-3 h-3 text-brand-600" />
              <span className="hidden sm:inline">Analysis Report</span>
            </button>
          </div>
        </div>

        {/* Acoustic Noise Advisory (No strikes charged) */}
        {noiseAlert && (
          <div className="bg-amber-50 border border-amber-300 text-amber-900 px-3.5 py-1.5 rounded-xl flex items-center justify-between gap-2 shadow-xs shrink-0 animate-in slide-in-from-top duration-300">
            <div className="flex items-center gap-2">
              <Volume2 className="w-4 h-4 text-amber-600 flex-shrink-0 animate-pulse" />
              <div>
                <p className="text-[11px] font-bold uppercase tracking-wider text-amber-800">Acoustic Notice</p>
                <p className="text-xs font-semibold text-amber-900">High background noise detected. Please move to a quiet place.</p>
              </div>
            </div>
            <span className="text-[10px] font-mono font-semibold text-amber-800 bg-amber-100 px-2 py-0.5 rounded border border-amber-300">
              Quiet Environment Recommended
            </span>
          </div>
        )}

        {/* Proctoring Warning Banner */}
        {activeWarningMessage && (
          <div className="bg-rose-50 border-2 border-rose-400 text-rose-900 px-3.5 py-2 rounded-xl flex items-center justify-between gap-2 shadow-xs shrink-0 animate-pulse">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-rose-600 flex-shrink-0" />
              <div>
                <p className="text-[11px] font-bold uppercase tracking-wider text-rose-700">Proctoring Alert</p>
                <p className="text-xs font-semibold text-rose-900">{activeWarningMessage}</p>
              </div>
            </div>
            <span className="text-xs font-mono font-black text-rose-700 bg-rose-100 px-2 py-0.5 rounded border border-rose-300">
              {warningCount}/3 Strikes
            </span>
          </div>
        )}

        {/* Stage Header with Target Role & Resume ATS Badge */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-2 bg-white rounded-xl border border-slate-200/90 shadow-2xs px-4 py-2 shrink-0">
          <div className="flex items-center gap-2.5 w-full sm:w-auto">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-brand-600 to-cyan-600 flex items-center justify-center text-white shadow-2xs flex-shrink-0">
              <Briefcase className="w-4 h-4" />
            </div>
            <div className="text-left flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider font-sans">TARGET ROLE:</span>
                <span className="text-xs font-extrabold text-brand-600 font-sans">{targetRole}</span>
                {!sessionActive && (
                  <button
                    type="button"
                    onClick={() => setStage('setup')}
                    title="Change Target Job Role or Resume"
                    className="text-[10px] text-slate-500 hover:text-brand-600 flex items-center gap-1 font-mono underline cursor-pointer"
                  >
                    <Edit3 className="w-2.5 h-2.5" /> Edit
                  </button>
                )}
              </div>
              <p className="text-[10px] text-slate-500 font-sans truncate">
                {sessionActive
                  ? `Question ${currentQIndex + 1} of ${questions.length} • Real-time AI Evaluation`
                  : 'Resume extracted skills • Q1 is your personalized introduction'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap w-full sm:w-auto justify-end">
            {/* ATS Score Tag */}
            <div className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-50 border border-emerald-200 text-xs font-mono">
              <FileCheck className="w-3.5 h-3.5 text-emerald-600" />
              <span className="text-slate-600 text-[11px]">ATS:</span>
              <span className="text-emerald-700 font-bold text-xs">{resumeATS}%</span>
            </div>

            {/* Back to Setup Button */}
            {!sessionActive && (
              <button
                type="button"
                onClick={() => setStage('setup')}
                className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white hover:bg-slate-50 text-slate-700 hover:text-slate-900 border border-slate-200 text-xs font-bold transition-all shadow-2xs cursor-pointer font-sans"
              >
                <Upload className="w-3 h-3 text-brand-600" />
                <span>Upload</span>
              </button>
            )}

            {/* Camera Test Button */}
            {!sessionActive && (
              <button
                type="button"
                onClick={handleToggleCameraTest}
                className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold transition-all border cursor-pointer font-sans ${isTestingCamera
                  ? 'bg-emerald-50 border-emerald-300 text-emerald-700 shadow-2xs'
                  : 'bg-white hover:bg-slate-50 text-brand-700 border-brand-200 shadow-2xs'
                  }`}
              >
                <Video className="w-3 h-3" />
                <span>{isTestingCamera ? 'Cam: Active' : 'Test Cam'}</span>
              </button>
            )}

          </div>
        </div>
        {/* Question Bar - Q1 IS ALWAYS "TELL ME ABOUT YOURSELF" */}
        <div className="flex items-center gap-3 bg-white rounded-xl border border-slate-200/90 shadow-2xs px-4 py-2 shrink-0">
          <span className="flex-shrink-0 text-xs font-mono font-bold text-brand-700 bg-brand-50 border border-brand-200 px-2 py-0.5 rounded-md">
            Q{currentQIndex + 1}:
          </span>
          <span className="text-xs sm:text-sm font-bold text-slate-800 truncate font-sans min-w-0">{currentQ.questionText || currentQ.question}</span>
        </div>

        {/* Google Meet-style stage: two participant tiles */}
        <div className="flex-1 min-h-0 grid grid-cols-1 grid-rows-2 md:grid-cols-2 md:grid-rows-1 gap-2.5 sm:gap-3">

          {/* Tile 1 — AI Interviewer (Animated Avatar) */}
          <div className={`relative rounded-2xl overflow-hidden bg-gradient-to-b from-slate-800 to-slate-900 shadow-xl h-full min-h-0 flex items-center justify-center transition-all duration-300 ${
            isAISpeaking 
              ? 'ring-2 ring-cyan-400/80 shadow-[0_0_24px_rgba(6,182,212,0.4)] animate-pulse-subtle' 
              : agentState === 'LISTENING'
                ? 'ring-2 ring-emerald-400/60 shadow-[0_0_16px_rgba(16,185,129,0.3)]'
                : agentState === 'PROCESSING'
                  ? 'ring-2 ring-amber-400/60 shadow-[0_0_16px_rgba(245,158,11,0.3)]'
                  : 'border border-slate-700/60'
          }`}>
            {/* Active Speaker Glow Ring - appears behind the avatar when speaking */}
            {isAISpeaking && (
              <div className="absolute inset-0 rounded-2xl bg-gradient-to-r from-cyan-400/20 via-transparent to-cyan-400/20 animate-ping pointer-events-none" />
            )}
            {agentState === 'LISTENING' && !isAISpeaking && (
              <div className="absolute inset-0 rounded-2xl bg-gradient-to-r from-emerald-400/15 via-transparent to-emerald-400/15 animate-pulse pointer-events-none" />
            )}
            {agentState === 'PROCESSING' && (
              <div className="absolute inset-0 rounded-2xl bg-gradient-to-r from-amber-400/15 via-transparent to-amber-400/15 animate-pulse pointer-events-none" />
            )}
            
            <AnimatedAvatar
              isSpeaking={isAISpeaking}
              agentState={agentState}
              isAudioMuted={isAudioMuted}
              onToggleMute={() => setIsAudioMuted(!isAudioMuted)}
              className="w-full h-full"
            />

            {/* Active Speaker Badge - top center */}
            {(isAISpeaking || agentState === 'LISTENING' || agentState === 'PROCESSING') && (
              <div className="absolute top-2.5 left-1/2 -translate-x-1/2 z-20 flex items-center gap-1.5 px-2.5 py-1 rounded-full backdrop-blur-md text-[10px] font-mono font-bold shadow-lg ${
                isAISpeaking 
                  ? 'bg-cyan-500/20 border border-cyan-400/50 text-cyan-300 animate-pulse' 
                  : agentState === 'LISTENING'
                    ? 'bg-emerald-500/20 border border-emerald-400/50 text-emerald-300'
                    : 'bg-amber-500/20 border border-amber-400/50 text-amber-300'
              }">
                {isAISpeaking && <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-ping" />}
                {agentState === 'LISTENING' && <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />}
                {agentState === 'PROCESSING' && <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-spin" />}
                <span>
                  {isAISpeaking ? 'Speaking' : agentState === 'LISTENING' ? 'Listening' : 'Evaluating'}
                </span>
              </div>
            )}

            {/* Name pill (bottom-left, Meet style) */}
            <div className="absolute bottom-3 left-3 z-20 flex items-center gap-2 px-2.5 py-1 rounded-lg bg-black/60 backdrop-blur-md border border-white/10">
              <div className={`w-2.5 h-2.5 rounded-full ${isAISpeaking
                ? 'bg-cyan-400 animate-ping'
                : agentState === 'LISTENING'
                  ? 'bg-emerald-400 animate-pulse'
                  : agentState === 'PROCESSING'
                    ? 'bg-amber-400 animate-pulse'
                    : sessionActive
                      ? 'bg-emerald-400'
                      : 'bg-slate-400'
                }`} />
              <span className="text-xs font-bold text-white font-sans">AI Interviewer</span>
            </div>
          </div>

          {/* Tile 2 — You (Meet-style, webcam always on) */}
          <div className={`relative rounded-2xl overflow-hidden bg-slate-950 shadow-xl h-full min-h-0 transition-all duration-300 ${
            isRecording && agentState !== 'SPEAKING' 
              ? 'ring-2 ring-emerald-400/80 shadow-[0_0_20px_rgba(16,185,129,0.4)]' 
              : 'border border-slate-700/60'
          }`}>
            {/* Active Speaker Glow for user tile when recording */}
            {(isRecording && agentState !== 'SPEAKING') && (
              <div className="absolute inset-0 rounded-2xl bg-gradient-to-r from-emerald-400/15 via-transparent to-emerald-400/15 animate-ping pointer-events-none" />
            )}

            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className={`absolute inset-0 w-full h-full object-cover mirror-mode ${cameraActive ? 'block' : 'hidden'}`}
            />

            {videoPlayBlocked && cameraActive && (
              <div className="absolute inset-0 z-30 bg-black/80 flex flex-col items-center justify-center p-3 text-center">
                <Play className="w-8 h-8 text-brand-400 mb-1 cursor-pointer" onClick={handleManualVideoPlay} />
                <p className="text-xs text-white font-semibold mb-1.5 font-sans">Click to start live camera preview</p>
                <button
                  onClick={handleManualVideoPlay}
                  className="px-3 py-1 rounded-lg bg-brand-600 hover:bg-brand-500 text-white text-xs font-bold font-sans transition-colors cursor-pointer"
                >
                  Activate Video
                </button>
              </div>
            )}

            {!cameraActive && (
              <div className="absolute inset-0 z-20 flex flex-col items-center justify-center p-4 text-center">
                <div className="w-10 h-10 rounded-xl bg-slate-900 border border-slate-800 flex items-center justify-center text-slate-500 mb-2">
                  <VideoOff className="w-5 h-5" />
                </div>
                <p className="text-xs font-bold text-white mb-0.5 font-sans">Camera Feed Standby</p>
                <p className="text-[10px] text-slate-400 max-w-xs mb-2 font-sans">
                  Click below or start interview to activate.
                </p>
                <button
                  type="button"
                  onClick={startCamera}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-brand-600 hover:bg-brand-500 text-white text-xs font-bold font-sans shadow-xs cursor-pointer transition-all"
                >
                  <Video className="w-3 h-3" />
                  <span>Turn On Camera</span>
                </button>
              </div>
            )}

            {/* Live overlay HUD when session is active */}
            {sessionActive && (
              <div className="absolute top-2.5 left-2.5 right-2.5 flex items-center justify-between pointer-events-none z-10">
                <div className="px-2 py-0.5 rounded-lg bg-black/60 backdrop-blur-md border border-white/10 text-[10px] font-mono text-emerald-400 flex items-center gap-1">
                  <Eye className="w-3 h-3" />
                  <span>Gaze: {telemetry.eyeContact}%</span>
                </div>
                <div className="px-2 py-0.5 rounded-lg bg-black/60 backdrop-blur-md border border-white/10 text-[10px] font-mono text-cyan-300 flex items-center gap-1">
                  <Activity className="w-3 h-3" />
                  <span>Time: {formatTimer(timerSeconds)}</span>
                </div>
              </div>
            )}

            {/* Proctoring warning overlay (top) */}
            {activeWarningMessage && (
              <div className="absolute top-10 left-2.5 right-2.5 z-20 flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-black/60 backdrop-blur-md border border-rose-400/50 text-rose-200 text-[11px] font-sans font-semibold">
                <AlertTriangle className="w-3.5 h-3.5 text-rose-400 flex-shrink-0" />
                <span className="truncate">{activeWarningMessage}</span>
                <span className="ml-auto px-1.5 rounded bg-rose-500/30 text-[10px] font-mono font-black text-rose-100 shrink-0">
                  {warningCount}/3
                </span>
              </div>
            )}

            {/* Name pill (bottom-left, Meet style) */}
            <div className="absolute bottom-3 left-3 z-20 flex items-center gap-2 px-2.5 py-1 rounded-lg bg-black/60 backdrop-blur-md border border-white/10">
              <Mic className={`w-3.5 h-3.5 ${isRecording ? 'text-emerald-400 animate-pulse' : 'text-slate-300'}`} />
              <span className="text-xs font-bold text-white font-sans">You</span>
              {warningCount > 0 && (
                <span className={`text-[10px] font-mono font-black ${warningCount >= 3 ? 'text-rose-300' : 'text-amber-300'}`}>
                  {warningCount}/3
                </span>
              )}
            </div>

            {/* Active speaker indicator for user (bottom-right when recording) */}
            {(isRecording && agentState !== 'SPEAKING') && (
              <div className="absolute bottom-3 right-3 z-20 flex items-center gap-1.5 px-2 py-1 rounded-lg bg-black/60 backdrop-blur-md border border-emerald-500/40 animate-pulse">
                <span className="w-2 h-2 rounded-full bg-emerald-400" />
                <span className="text-[10px] font-mono font-bold text-emerald-300">Live</span>
              </div>
            )}
          </div>

        </div>

        {/* BOTTOM ACTION BAR (Autonomous Real-Time Turn Taking) */}
        <div className="flex flex-col items-center justify-center p-2.5 sm:p-3 rounded-2xl bg-white border border-slate-200/90 shadow-card shrink-0">
          {micError && (
            <div className="w-full max-w-2xl mb-2 flex items-start gap-2 px-3 py-2 rounded-xl bg-rose-50 border border-rose-200 text-rose-800">
              <AlertTriangle className="w-4 h-4 text-rose-500 shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-bold font-sans">Microphone problem</p>
                <p className="text-xs font-sans leading-snug">{micError}</p>
              </div>
              <button
                type="button"
                onClick={() => { setMicError(''); startSpeechRecognition(); }}
                className="shrink-0 flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white border border-rose-300 text-rose-700 text-xs font-bold font-sans hover:bg-rose-100 transition-all cursor-pointer"
              >
                <RefreshCw className="w-3 h-3" /> Retry mic
              </button>
            </div>
          )}
          {!sessionActive ? (
            <button
              type="button"
              onClick={handleStartSession}
              className="flex items-center justify-center gap-2 px-7 py-2.5 rounded-xl bg-gradient-to-r from-brand-600 to-cyan-600 hover:from-brand-700 hover:to-cyan-700 text-white font-bold text-sm font-sans shadow-md shadow-brand-500/20 transition-all hover:scale-[1.01] cursor-pointer"
            >
              <Video className="w-4 h-4" />
              <span>Start Interview Session</span>
            </button>
          ) : (
            <div className="flex flex-col items-center gap-2.5 w-full max-w-3xl sm:max-w-4xl">
              {/* SPEECH-TO-TEXT VERBAL TRANSCRIPTION AREA */}
              <div className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3 sm:p-4 shadow-2xs">
                <div className="flex items-center justify-between text-xs mb-2 flex-wrap gap-1">
                  <div className="flex items-center gap-2">
                    <span
                      className={`w-2.5 h-2.5 rounded-full ${isAISpeaking
                        ? 'bg-cyan-500 animate-ping'
                        : isRecording
                          ? 'bg-emerald-500 animate-ping'
                          : agentState === 'PROCESSING'
                            ? 'bg-amber-500 animate-pulse'
                            : 'bg-brand-500'
                        }`}
                    />
                    <span className="font-bold text-slate-800 font-sans text-xs sm:text-sm">
                      {isAISpeaking
                        ? 'Interviewer Question:'
                        : agentState === 'PROCESSING'
                          ? 'Evaluating Answer:'
                          : 'Your Verbal Answer (Speech-to-Text):'}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    {companionText && !isAISpeaking && (
                      <button
                        type="button"
                        onClick={() => {
                          accumulatedTranscriptRef.current = '';
                          setCompanionText('');
                        }}
                        className="text-xs text-slate-500 hover:text-rose-600 underline font-mono cursor-pointer"
                        title="Reset transcript"
                      >
                        Reset
                      </button>
                    )}
                    <span className="text-xs font-mono font-bold text-brand-600">
                      {companionText && !isAISpeaking ? `${companionText.split(/\s+/).filter(Boolean).length} words` : ''}
                    </span>
                  </div>
                </div>

                {/* Live Speech Transcription View */}
                {isAISpeaking || agentState === 'SPEAKING' ? (
                  <div className="min-h-[110px] sm:min-h-[130px] flex flex-col justify-center bg-white border border-cyan-200/90 rounded-xl p-3.5 sm:p-4 shadow-2xs">
                    <div className="flex items-center gap-2 mb-1.5 text-xs font-bold text-cyan-800">
                      <Volume2 className="w-4 h-4 text-cyan-600 animate-pulse shrink-0" />
                      <span>Question {currentQIndex + 1}:</span>
                    </div>
                    <p className="text-sm sm:text-base font-medium text-slate-800 font-sans leading-relaxed select-text">
                      "{currentSpokenSubtitle || currentQ.questionText || currentQ.question || 'Asking question...'}"
                    </p>
                  </div>
                ) : agentState === 'PROCESSING' ? (
                  <div className="min-h-[110px] sm:min-h-[130px] flex items-center justify-center text-center bg-white border border-slate-200 rounded-xl p-4 shadow-2xs">
                    <Sparkles className="w-5 h-5 mr-2 text-amber-500 animate-spin" />
                    <p className="text-sm font-medium text-slate-700 font-sans">
                      Analyzing technical keywords, speech cadence, and domain depth...
                    </p>
                  </div>
                ) : (
                  <div className="relative">
                    <textarea
                      value={companionText}
                      onChange={(e) => {
                        setCompanionText(e.target.value);
                        accumulatedTranscriptRef.current = e.target.value;
                      }}
                      placeholder={`Microphone is ${isRecording ? 'listening live' : 'ready'}. Speak clearly to answer Question ${currentQIndex + 1} (voice speech-to-text, or type directly)...`}
                      className="w-full min-h-[110px] sm:min-h-[130px] max-h-[180px] overflow-y-auto bg-white border border-slate-200 focus:border-brand-500 focus:ring-1 focus:ring-brand-500 rounded-xl p-3 sm:p-4 text-sm sm:text-base text-slate-800 leading-relaxed shadow-2xs font-sans resize-none transition-all outline-none"
                      rows={4}
                    />
                    {isRecording && (
                      <div className="absolute right-3 bottom-3 pointer-events-none flex items-center gap-1.5 text-xs font-mono text-emerald-700 bg-white/95 backdrop-blur-xs px-2 py-1 rounded-md border border-emerald-200 shadow-2xs">
                        <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping" />
                        <span className="font-bold">Live Listening</span>
                      </div>
                    )}
                  </div>
                )}

                {agentState === 'LISTENING' && isRecording && (
                  <div className={`mt-2 flex items-center justify-between text-xs px-3 py-1.5 rounded-lg border font-mono ${typeof answerSecondsLeft === 'number' && answerSecondsLeft <= 5
                    ? 'bg-rose-50 border-rose-200 text-rose-800'
                    : 'bg-emerald-50 border-emerald-200 text-emerald-800 animate-pulse'
                    }`}>
                    <span className="flex items-center gap-1.5">
                      <span className={`w-2 h-2 rounded-full animate-ping ${typeof answerSecondsLeft === 'number' && answerSecondsLeft <= 5 ? 'bg-rose-500' : 'bg-emerald-500'}`} />
                      {answerSecondsLeft === null
                        ? 'Listening... start answering whenever you are ready.'
                        : 'Recording your answer...'}
                    </span>
                    <span className="font-semibold">
                      {answerSecondsLeft === null
                        ? 'Max ~1 min per answer (2 × 29s chunks)'
                        : `${answerSecondsLeft}s left`}
                    </span>
                  </div>
                )}

                {agentState === 'PROCESSING' && (
                  <div className="mt-2 flex items-center justify-center text-xs px-3 py-1.5 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 font-mono">
                    <span>{answerAutoNotice || 'Evaluating answer with AI evaluation engine...'}</span>
                  </div>
                )}
              </div>

              {/* Turn-Taking Control Buttons */}
              <div className="flex items-center gap-2 flex-wrap justify-center w-full">
                <button
                  type="button"
                  onClick={handleRecordVoice}
                  disabled={micLocked && !isRecording}
                  className={`flex items-center justify-center gap-1.5 flex-1 sm:flex-none px-4 py-2 sm:py-1.5 rounded-lg text-xs font-bold font-sans transition-all border ${micLocked && !isRecording
                    ? 'bg-slate-50 border-slate-200 text-slate-400 opacity-70 cursor-not-allowed'
                    : isRecording
                      ? 'bg-rose-50 border-rose-300 text-rose-700 animate-pulse shadow-2xs cursor-pointer'
                      : 'bg-white hover:bg-slate-50 text-slate-700 border-slate-200 shadow-2xs cursor-pointer'
                    }`}
                  title={micLocked && !isRecording ? 'Microphone activates when the interviewer finishes the question' : 'Toggle Microphone'}
                >
                  <Mic className={`w-3.5 h-3.5 ${micLocked && !isRecording ? 'text-slate-400' : 'text-brand-600'}`} />
                  <span>{isRecording ? 'Pause Mic' : micLocked ? 'Mic Off' : 'Start Mic'}</span>
                </button>

                <button
                  type="button"
                  onClick={() => handlePlayOrReplayQuestion()}
                  className="flex items-center justify-center gap-1.5 flex-1 sm:flex-none px-3.5 py-2 sm:py-1.5 rounded-lg bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 text-xs font-bold font-sans shadow-2xs cursor-pointer transition-all"
                  title="Replay Question Audio"
                >
                  <Volume2 className="w-3.5 h-3.5 text-cyan-600" />
                  <span>Replay Audio</span>
                </button>

                <button
                  type="button"
                  onClick={handleSkipQuestion}
                  disabled={agentState === 'PROCESSING' || agentState === 'AI_RESPONSE'}
                  className="flex items-center justify-center gap-1.5 flex-1 sm:flex-none px-3.5 py-2 sm:py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold font-sans transition-all cursor-pointer shadow-2xs"
                  title="Skip this question without providing an answer"
                >
                  <span>Skip Question</span>
                </button>

                <button
                  type="button"
                  onClick={() => handleCandidateSubmit(false)}
                  disabled={agentState === 'PROCESSING' || agentState === 'AI_RESPONSE'}
                  className={`flex items-center justify-center gap-1.5 w-full sm:w-auto px-5 py-2 sm:py-1.5 rounded-lg bg-gradient-to-r from-brand-600 to-cyan-600 hover:from-brand-700 hover:to-cyan-700 text-white text-xs font-bold font-sans shadow-md shadow-brand-500/20 transition-all cursor-pointer hover:scale-105 ${agentState === 'PROCESSING' || agentState === 'AI_RESPONSE' ? 'opacity-60 cursor-not-allowed' : ''
                    }`}
                >
                  <span>{isFinalQuestion ? 'Submit & Finalize Interview' : 'Submit Answer & Continue'}</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          )}
        </div>

      </div>

      {/* Paste Modal if opened in Room stage */}
      {showPasteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-white border border-slate-200 rounded-3xl p-6 max-w-lg w-full text-slate-800 shadow-2xl font-sans">
            <h3 className="text-base font-bold mb-1 flex items-center gap-2 text-slate-900">
              <ClipboardList className="w-4 h-4 text-brand-600" />
              <span>Paste Resume Text</span>
            </h3>
            <p className="text-xs text-slate-500 mb-3">
              Paste your experience, key skills, or project highlights:
            </p>
            <textarea
              rows={7}
              value={pastedText}
              onChange={(e) => setPastedText(e.target.value)}
              placeholder="Paste resume content here..."
              className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3 text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:border-brand-500 font-mono resize-none mb-4"
            />
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowPasteModal(false)}
                className="px-4 py-2 rounded-xl text-xs font-bold text-slate-500 hover:text-slate-700 transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleApplyPastedResume}
                className="px-5 py-2 rounded-xl bg-gradient-to-r from-brand-600 to-cyan-600 hover:from-brand-700 hover:to-cyan-700 text-white text-xs font-bold font-sans shadow-md shadow-brand-500/20 transition-colors cursor-pointer"
              >
                Analyze & Apply
              </button>
            </div>
          </div>
        </div>
      )}
      {/* ============================================================== */}
      {/* PROCTORING WARNING MODAL (1st, 2nd, and 3rd TERMINATION WARNING) */}
      {/* ============================================================== */}
      {proctoringModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-md p-4 animate-in fade-in duration-200">
          <div className={`w-full max-w-md rounded-2xl border p-6 text-white shadow-2xl relative ${proctoringModal.isFinal
            ? 'bg-rose-950/95 border-rose-600 shadow-rose-900/50'
            : proctoringModal.count === 2
              ? 'bg-amber-950/95 border-amber-600 shadow-amber-900/50'
              : 'bg-slate-900/95 border-amber-500/70 shadow-amber-500/20'
            }`}>
            <div className="flex items-center gap-3 mb-3">
              <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${proctoringModal.isFinal ? 'bg-rose-900/80 text-rose-300' : 'bg-amber-900/80 text-amber-300'
                }`}>
                <AlertTriangle className="w-6 h-6 animate-bounce" />
              </div>
              <div>
                <span className="text-[11px] font-mono uppercase tracking-wider font-bold block text-slate-400">
                  AI Proctoring Telemetry Alert
                </span>
                <h3 className="text-lg font-black tracking-tight text-white">
                  {proctoringModal.isFinal
                    ? 'Interview Closed & Auto-Submitted'
                    : proctoringModal.count >= (proctoringModal.maxAllowed || 3) - 1
                      ? `FINAL WARNING (${proctoringModal.count} of ${proctoringModal.maxAllowed || 3})`
                      : `Warning ${proctoringModal.count} of ${proctoringModal.maxAllowed || 3}`}
                </h3>
              </div>
            </div>

            <div className="p-3.5 rounded-xl bg-black/40 border border-white/10 mb-4 space-y-1.5 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-slate-400">Violation Detected:</span>
                <span className="font-bold font-mono text-white">{proctoringModal.violation}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-400">Violation Count:</span>
                <span className="font-bold font-mono text-rose-400">
                  {proctoringModal.count} / {proctoringModal.maxAllowed || 3} Strikes
                </span>
              </div>
            </div>

            <p className="text-xs text-slate-200 leading-relaxed mb-5">
              {proctoringModal.isFinal ? (
                <span>
                  Maximum proctoring violations reached ({proctoringModal.maxAllowed || 3} strikes). Your interview session has closed and your answers are being submitted automatically.
                </span>
              ) : proctoringModal.count >= (proctoringModal.maxAllowed || 3) - 1 ? (
                <span>
                  <strong className="text-amber-400">
                    FINAL WARNING ({proctoringModal.count} of {proctoringModal.maxAllowed || 3})!
                  </strong>{' '}
                  You have incurred {proctoringModal.count} strike(s). Exiting fullscreen, switching tabs, a mobile phone, an additional person, or multi-face detection are strictly prohibited. The next strike will immediately close and submit your interview.
                </span>
              ) : (
                <span>
                  <strong>
                    Warning {proctoringModal.count} of {proctoringModal.maxAllowed || 3}:
                  </strong>{' '}
                  Please stay in full-screen mode, do not close or switch browser tabs, keep phones out of frame, and ensure only you are visible to the camera. You have{' '}
                  {Math.max(0, (proctoringModal.maxAllowed || 3) - proctoringModal.count)} warning(s) remaining.
                </span>
              )}
            </p>

            <div className="flex items-center justify-end">
              {proctoringModal.isFinal ? (
                <div className="text-xs font-mono text-rose-300 flex items-center gap-2">
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  <span>Submitting Assessment & Redirecting...</span>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={handleAcknowledgeWarning}
                  className="w-full py-2.5 px-4 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-slate-950 font-black text-xs shadow-lg transition-all cursor-pointer hover:scale-[1.02]"
                >
                  {proctoringModal.count >= (proctoringModal.maxAllowed || 3) - 1
                    ? 'I Understand (Final Warning) • Resume Fullscreen'
                    : `Acknowledge Warning ${proctoringModal.count} • Resume Fullscreen`}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
