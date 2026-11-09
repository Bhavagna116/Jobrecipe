import React, { useState, useEffect } from 'react';
import { useApp } from '../../context/AppContext';
import {
  parseResumeText,
  generateResumeQuestions,
  readResumeFile,
  looksLikeResume,
  TARGET_ROLE_GROUPS,
  TARGET_ROLE_OPTIONS
} from '../../utils/resumeParser';
import {
  FileText,
  Upload,
  Sparkles,
  ArrowRight,
  ShieldCheck,
  CheckCircle2,
  RefreshCw,
  ClipboardList,
  Target,
  BarChart2,
  Zap,
  Lock
} from 'lucide-react';

const SAMPLE_ML_RESUME = `Pera Vishnuvardhan Reddy - Machine Learning Engineer
Summary: Passionate ML Engineer experienced in building predictive models, data preprocessing pipelines, and model evaluation with Python, Scikit-Learn, and PyTorch.
Skills: Python, Machine Learning, Scikit-Learn, Pandas, NumPy, Model Evaluation, PyTorch, Data Preprocessing, SQL, REST APIs, Git.
Projects:
• Predictive Customer Churn Pipeline: Built classification models with Random Forest and XGBoost in Scikit-Learn, achieving 89% accuracy and reducing customer attrition.
• Computer Vision & Image Recognition: Implemented CNN architectures with PyTorch for automated defect detection in real-time camera streams.`;

export const ResumeATSSection = () => {
  const { navigateTo, isInterviewUnlocked, role, addToast, interviewSettings } = useApp();

  const [targetRole, setTargetRole] = useState(() => {
    return localStorage.getItem('rsj_selected_role') || 'Software Engineer';
  });

  const [uploadedFileName, setUploadedFileName] = useState(() => {
    return localStorage.getItem('rsj_uploaded_resume_name') || null;
  });

  const [rawResumeText, setRawResumeText] = useState('');
  const [showPasteModal, setShowPasteModal] = useState(false);
  const [pastedText, setPastedText] = useState('');

  const [isScanning, setIsScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState(0);

  // Resume analysis state initialized intelligently based on current targetRole
  const [analysisResult, setAnalysisResult] = useState(() => {
    try {
      const saved = localStorage.getItem('rsj_resume_analysis');
      if (saved) return JSON.parse(saved);
    } catch {}
    const initialRole = localStorage.getItem('rsj_selected_role') || 'Software Engineer';
    return parseResumeText('', initialRole);
  });

  // Whenever targetRole changes, re-sync questions and analysis
  const handleRoleChange = (newRole) => {
    const roleClean = newRole.trim() || 'Software Engineer';
    setTargetRole(roleClean);
    localStorage.setItem('rsj_selected_role', roleClean);

    // Re-parse with existing text or role defaults
    const updatedAnalysis = parseResumeText(rawResumeText, roleClean);
    setAnalysisResult(updatedAnalysis);
    localStorage.setItem('rsj_resume_analysis', JSON.stringify(updatedAnalysis));
    localStorage.setItem('rsj_resume_ats_score', String(updatedAnalysis.atsScore));

    const updatedQuestions = generateResumeQuestions(updatedAnalysis, roleClean);
    localStorage.setItem('rsj_resume_questions', JSON.stringify(updatedQuestions));
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

      localStorage.setItem('rsj_uploaded_resume_name', name);
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
        addToast('This file does not look like a resume. Upload a PDF or TXT resume with skills, experience, education, or projects.', 'error');
        return;
      }
      processResumeContent(file.name, content);
    } catch (e) {
      addToast(e.message || 'Could not read the resume file. Please upload a valid PDF or TXT resume.', 'error');
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileUpload(e.dataTransfer.files[0]);
    }
  };

  const handleLoadSampleResume = () => {
    processResumeContent('Vishnu_ML_Engineer_Resume.pdf', SAMPLE_ML_RESUME, 'ML Engineer');
    setTargetRole('ML Engineer');
  };

  const handleApplyPastedResume = () => {
    if (!pastedText.trim()) {
      addToast('Paste your resume text first.', 'warning');
      return;
    }
    if (!looksLikeResume(pastedText)) {
      addToast('The pasted text does not look like a resume. Include skills, experience, education, or projects.', 'error');
      return;
    }
    processResumeContent('Pasted_Resume_Profile.txt', pastedText);
    setShowPasteModal(false);
  };

  const handleLaunchInterview = () => {
    if (!isInterviewUnlocked && role !== 'admin') {
      addToast('Please complete your required assessment to unlock your AI Mock Interview session.', 'warning');
      navigateTo('assessments');
      return;
    }
    const currentAnalysis = analysisResult || parseResumeText(rawResumeText, targetRole);
    const questionsToUse = generateResumeQuestions(currentAnalysis, targetRole).slice(0, maxPreviewQuestions);

    localStorage.setItem('rsj_selected_role', targetRole);
    localStorage.setItem('rsj_resume_ats_score', String(currentAnalysis.atsScore));
    localStorage.setItem('rsj_resume_analysis', JSON.stringify(currentAnalysis));
    localStorage.setItem('rsj_resume_questions', JSON.stringify(questionsToUse));

    navigateTo('ai-mock-interview');
  };

  const maxPreviewQuestions = Math.min(4, Math.max(3, Number(interviewSettings?.questionCount) || 3));
  const questionsPreview = generateResumeQuestions(analysisResult, targetRole).slice(0, maxPreviewQuestions);

  return (
    <section className="w-full max-w-4xl mx-auto px-4 sm:px-6 py-10">
      {/* Subtitle directly matching user reference design */}
      <p className="text-center text-sm sm:text-base text-slate-400 max-w-2xl mx-auto mb-6 leading-relaxed">
        Extract skills, evaluate experience depth, score candidate suitability, match targeted job descriptions, and generate custom interview questions.
      </p>

      {/* Main Container Card */}
      <div className="relative rounded-2xl bg-[#0b101e]/95 border border-slate-800/90 shadow-2xl p-6 sm:p-8 text-white backdrop-blur-md">

        {/* Ambient Subtle Glow */}
        <div className="absolute top-0 right-1/3 w-72 h-72 rounded-full bg-cyan-500/5 blur-3xl pointer-events-none" />

        {/* ? DROP ZONE (Matches Image 1 reference precisely) */}
        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={handleDrop}
          className="relative border-2 border-dashed border-teal-500/40 hover:border-teal-400/80 rounded-xl p-8 sm:p-10 text-center transition-all bg-slate-950/40 hover:bg-slate-950/70 group"
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

          {/* Document Icon (Soft Lavender / Violet Tint matching Image 1) */}
          <div className="w-14 h-16 rounded-xl bg-purple-950/30 border border-purple-400/30 flex items-center justify-center mx-auto mb-4 group-hover:scale-105 transition-transform shadow-inner">
            <FileText className="w-8 h-8 text-purple-200" />
          </div>

          <h3 className="text-lg sm:text-xl font-bold text-white mb-1.5">
            {uploadedFileName ? `Resume Uploaded: ${uploadedFileName}` : 'Drag & drop your resume here'}
          </h3>

          <p className="text-xs sm:text-sm text-slate-400 mb-5">
            Supports PDF and TXT files (Max 20MB)
          </p>

          <div className="flex items-center justify-center gap-3">
            <label
              htmlFor="resume-file-input"
              className="inline-flex items-center justify-center px-6 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-700 hover:border-slate-600 text-sm font-semibold text-white shadow-md transition-all cursor-pointer hover:scale-105"
            >
              Browse File
            </label>

            <button
              type="button"
              onClick={handleLoadSampleResume}
              className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-slate-900/60 hover:bg-slate-800/80 border border-slate-800 text-xs text-slate-300 hover:text-white transition-all cursor-pointer"
            >
              <Zap className="w-3.5 h-3.5 text-cyan-400" />
              <span>Sample Resume</span>
            </button>
          </div>
        </div>

        {/* Loading Spinner during scan */}
        {isScanning && (
          <div className="mt-5 p-4 rounded-xl bg-slate-900 border border-cyan-800/40 text-center">
            <div className="flex items-center justify-center gap-2 mb-2">
              <RefreshCw className="w-4 h-4 text-cyan-400 animate-spin" />
              <span className="text-xs font-bold text-cyan-300">Extracting skills & role alignment ({scanProgress}%)...</span>
            </div>
            <div className="w-full bg-slate-800 h-1.5 rounded-full overflow-hidden">
              <div
                className="bg-cyan-400 h-full transition-all duration-300 rounded-full"
                style={{ width: `${scanProgress}%` }}
              />
            </div>
          </div>
        )}

        {/* TARGET ROLE DROPDOWN */}
        <div className="mt-6">
          <label className="block text-xs sm:text-sm font-semibold text-slate-300 mb-2">
            Target Role <span className="text-slate-500 font-normal">(Select one)</span>
          </label>

          <select
            value={targetRole}
            onChange={(e) => handleRoleChange(e.target.value)}
            className="w-full bg-slate-950/80 border border-slate-800 hover:border-slate-700 focus:border-cyan-500 rounded-xl px-4 py-3 text-sm text-white focus:outline-none transition-all shadow-inner font-medium cursor-pointer"
          >
            {targetRole && !TARGET_ROLE_OPTIONS.includes(targetRole) && (
              <option value={targetRole}>{targetRole}</option>
            )}
            {TARGET_ROLE_GROUPS.map((group) => (
              <optgroup key={group.label} label={group.label}>
                {group.roles.map((role) => (
                  <option key={role} value={role}>{role}</option>
                ))}
              </optgroup>
            ))}
          </select>
          <span className="text-[10px] text-slate-500 mt-1.5 block">
            The interview questions and ATS benchmark calibrate to the selected role.
          </span>
        </div>

        {/* ? ATS SCORE & INTERVIEW PREVIEW */}
        <div className="mt-6 pt-6 border-t border-slate-800/80">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mb-4">
            <div className="flex items-center gap-2.5">
              <span className="px-3 py-1 rounded-full bg-emerald-950/70 border border-emerald-500/50 text-emerald-400 text-xs font-mono font-bold">
                ATS Match: {analysisResult.atsScore}%
              </span>
              <span className="text-xs text-slate-400 font-medium">
                Calibrated for: <strong className="text-white">{targetRole}</strong>
              </span>
            </div>

            <div className="text-[11px] text-cyan-400 font-mono flex items-center gap-1.5">
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>Moderate Level Questions (Basic to Mid-Level)</span>
            </div>
          </div>

          {/* Extracted / Role Skills Pills */}
          <div className="flex items-center gap-1.5 flex-wrap mb-4">
            <span className="text-[11px] text-slate-500 font-medium mr-1">Skills:</span>
            {analysisResult.skills.slice(0, 6).map((skill, idx) => (
              <span
                key={idx}
                className="px-2.5 py-0.5 rounded-md bg-slate-900 border border-slate-800 text-[11px] font-mono text-cyan-300"
              >
                {skill}
              </span>
            ))}
          </div>

          {/* Question Sequence Preview Banner */}
          <div className="p-4 rounded-xl bg-slate-950/80 border border-cyan-900/40 mb-6 space-y-3">
            <div className="flex items-center justify-between gap-2 border-b border-cyan-950 pb-2">
              <span className="text-[10px] font-mono font-bold bg-cyan-950 text-cyan-400 px-2 py-0.5 rounded border border-cyan-800/60">
                INTERVIEW SEQUENCE ({questionsPreview.length} QUESTIONS)
              </span>
              <span className="text-xs font-semibold text-slate-400">Curated AI Interviewer Flow</span>
            </div>
            <div className="space-y-2">
              {questionsPreview.map((q, idx) => (
                <div key={q.id || idx} className="flex items-start gap-2.5 text-xs text-slate-300">
                  <span className="font-mono text-[11px] font-bold text-cyan-400 bg-cyan-950/70 border border-cyan-800/40 px-1.5 py-0.5 rounded shrink-0">
                    Q{idx + 1}
                  </span>
                  <p className="leading-relaxed text-slate-200">
                    {q.questionText}
                  </p>
                </div>
              ))}
            </div>
          </div>

          {/* Launch Action Button */}
          <button
            type="button"
            onClick={handleLaunchInterview}
            className={`w-full flex items-center justify-center gap-2 py-3.5 px-6 rounded-xl font-bold text-sm sm:text-base shadow-lg transition-all cursor-pointer ${
              !isInterviewUnlocked && role !== 'admin'
                ? 'bg-amber-600 hover:bg-amber-500 text-white shadow-amber-600/30'
                : 'bg-gradient-to-r from-cyan-600 via-blue-600 to-indigo-600 hover:from-cyan-500 hover:to-indigo-500 text-white shadow-cyan-600/30 hover:scale-[1.01]'
            }`}
          >
            {!isInterviewUnlocked && role !== 'admin' ? (
              <>
                <Lock className="w-4 h-4 text-amber-200" />
                <span>Complete Assessment to Unlock AI Mock Interview</span>
              </>
            ) : (
              <>
                <span>Start AI Mock Interview</span>
                <ArrowRight className="w-4 h-4" />
              </>
            )}
          </button>
        </div>

      </div>

      {/* Paste Text Modal */}
      {showPasteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl p-6 max-w-lg w-full text-white shadow-2xl">
            <h3 className="text-base font-bold mb-1 flex items-center gap-2">
              <ClipboardList className="w-4 h-4 text-cyan-400" />
              <span>Paste Resume Text</span>
            </h3>
            <p className="text-xs text-slate-400 mb-3">
              Paste your experience, key skills, or project highlights:
            </p>
            <textarea
              rows={7}
              value={pastedText}
              onChange={(e) => setPastedText(e.target.value)}
              placeholder="Paste resume content here..."
              className="w-full bg-slate-950 border border-slate-700 rounded-xl p-3 text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:border-cyan-400 font-mono resize-none mb-4"
            />
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowPasteModal(false)}
                className="px-4 py-2 rounded-xl text-xs font-bold text-slate-400 hover:text-white"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleApplyPastedResume}
                className="px-5 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-bold shadow-md"
              >
                Analyze & Apply
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
};
