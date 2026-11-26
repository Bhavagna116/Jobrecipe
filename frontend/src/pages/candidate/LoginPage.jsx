import React, { useState, useEffect, useRef } from 'react';
import { useApp } from '../../context/AppContext';
import {
  readResumeFile,
  validateResumeFile,
  parseResumeText,
  generateResumeQuestions,
  TARGET_ROLE_OPTIONS
} from '../../utils/resumeParser';
import {
  Lock,
  Mail,
  ArrowRight,
  Eye,
  EyeOff,
  CheckCircle2,
  Upload,
  FileText,
  Sparkles,
  X
} from 'lucide-react';

export const LoginPage = () => {
  const { loginCandidate, navigateTo, role } = useApp();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [justRegistered, setJustRegistered] = useState(false);

  // Resume upload & keyword extraction state (carried into AI Mock Interview)
  const fileInputRef = useRef(null);
  const [targetRole, setTargetRole] = useState(() => localStorage.getItem('rsj_selected_role') || 'Software Engineer');
  const [resumeFileName, setResumeFileName] = useState(() => localStorage.getItem('rsj_uploaded_resume_name') || '');
  const [resumeKeywords, setResumeKeywords] = useState(() => {
    try {
      const saved = localStorage.getItem('rsj_resume_skills');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });
  const [resumeParsing, setResumeParsing] = useState(false);
  const [resumeError, setResumeError] = useState('');

  // Check if candidate just completed signup
  useEffect(() => {
    try {
      const regEmail = localStorage.getItem('rsj_registered_email');
      if (regEmail) {
        setEmail(regEmail);
        setJustRegistered(true);
        localStorage.removeItem('rsj_registered_email');
      }
    } catch {}
  }, []);

  // Auto redirect to exam page if candidate is already logged in
  useEffect(() => {
    if (role === 'candidate') {
      navigateTo('assessments');
    }
  }, [role, navigateTo]);

  const handleResumeUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setResumeError('');

    const validation = validateResumeFile(file);
    if (!validation.valid) {
      setResumeError(validation.error || 'Please upload a valid PDF or TXT resume.');
      return;
    }

    setResumeParsing(true);
    try {
      const rawText = await readResumeFile(file);
      const effectiveRole = targetRole.trim() || 'Software Engineer';
      const parsed = parseResumeText(rawText, effectiveRole);
      const generatedQuestions = generateResumeQuestions(parsed, effectiveRole);
      const keywords = Array.isArray(parsed.skills) ? parsed.skills : [];

      localStorage.setItem('rsj_uploaded_resume_name', file.name);
      localStorage.setItem('rsj_raw_resume_text', rawText);
      localStorage.setItem('rsj_selected_role', effectiveRole);
      localStorage.setItem('rsj_resume_ats_score', String(parsed.atsScore || 75));
      localStorage.setItem('rsj_resume_analysis', JSON.stringify(parsed));
      localStorage.setItem('rsj_resume_skills', JSON.stringify(keywords));
      localStorage.setItem('rsj_resume_questions', JSON.stringify(generatedQuestions));

      setResumeFileName(file.name);
      setResumeKeywords(keywords);
    } catch (err) {
      setResumeError(err?.message || 'Could not extract keywords from this resume. Try a PDF or TXT file.');
    } finally {
      setResumeParsing(false);
    }
  };

  const handleRoleChange = (newRole) => {
    setTargetRole(newRole);
    try {
      localStorage.setItem('rsj_selected_role', newRole);
      const savedText = localStorage.getItem('rsj_raw_resume_text');
      if (savedText) {
        const parsed = parseResumeText(savedText, newRole);
        const generatedQuestions = generateResumeQuestions(parsed, newRole);
        localStorage.setItem('rsj_resume_ats_score', String(parsed.atsScore || 75));
        localStorage.setItem('rsj_resume_analysis', JSON.stringify(parsed));
        localStorage.setItem('rsj_resume_skills', JSON.stringify(parsed.skills || []));
        localStorage.setItem('rsj_resume_questions', JSON.stringify(generatedQuestions));
        setResumeKeywords(parsed.skills || []);
      }
    } catch {}
  };

  const handleClearResume = () => {
    setResumeFileName('');
    setResumeKeywords([]);
    setResumeError('');
    if (fileInputRef.current) fileInputRef.current.value = '';
    try {
      localStorage.removeItem('rsj_uploaded_resume_name');
      localStorage.removeItem('rsj_raw_resume_text');
      localStorage.removeItem('rsj_resume_ats_score');
      localStorage.removeItem('rsj_resume_analysis');
      localStorage.removeItem('rsj_resume_skills');
      localStorage.removeItem('rsj_resume_questions');
    } catch {}
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!email || !password) {
      setError('Please enter both email address and password');
      return;
    }
    setError('');
    setIsLoading(true);
    const res = await loginCandidate(email, password);
    setIsLoading(false);
    if (!res.success) {
      setError(res.error || 'Authentication failed. Please check your credentials.');
    } else {
      navigateTo('assessments');
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col justify-center py-10 px-4 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-md">

        {/* Brand */}
        <div
          onClick={() => navigateTo('hero')}
          className="flex items-center justify-center gap-3 cursor-pointer group mb-5"
        >
          <span className="text-2xl font-black text-slate-900 tracking-tight">
            ReadySet<span className="text-brand-600">Job</span>
          </span>
        </div>

        <h2 className="text-center text-2xl font-extrabold text-slate-900 tracking-tight">
          Candidate Portal Sign In
        </h2>
        <p className="mt-2 text-center text-xs text-slate-600">
          Sign in and upload your resume to extract keywords for your AI Interview.
        </p>
      </div>

      <div className="mt-6 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="bg-white py-7 px-6 sm:px-9 rounded-2xl border border-slate-200/90 shadow-card space-y-5">

          {justRegistered && (
            <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-800 font-semibold flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 flex-shrink-0" />
              <span>Registration completed! Please sign in with your credentials to start your exam.</span>
            </div>
          )}

          {error && (
            <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-700 font-medium">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Email Address
              </label>
              <div className="relative">
                <Mail className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => { setEmail(e.target.value); setError(''); }}
                  required
                  placeholder="name@university.edu"
                  className="w-full pl-10 pr-4 py-2.5 bg-slate-50 focus:bg-white text-xs sm:text-sm rounded-xl border border-slate-200 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 outline-none transition-all"
                />
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-xs font-bold text-slate-700">
                  Password
                </label>
                <a href="#forgot" onClick={(e) => { e.preventDefault(); alert('Demo password reset link sent to registered email.'); }} className="text-[11px] font-semibold text-brand-600 hover:underline">
                  Forgot?
                </a>
              </div>
              <div className="relative">
                <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  placeholder="••••••••"
                  className="w-full pl-10 pr-10 py-2.5 bg-slate-50 focus:bg-white text-xs sm:text-sm rounded-xl border border-slate-200 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 outline-none transition-all"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {/* Resume Upload & Keyword Extraction for AI Interview */}
            <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200/90 space-y-2.5">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-brand-600" />
                  <span>Resume for AI Interview</span>
                </label>
                <select
                  value={targetRole}
                  onChange={(e) => handleRoleChange(e.target.value)}
                  className="text-[11px] font-semibold bg-white border border-slate-200 rounded-lg px-2 py-1 text-slate-700 outline-none focus:border-brand-500"
                  title="Target Job Role"
                >
                  {TARGET_ROLE_OPTIONS.slice(0, 12).map((r) => (
                    <option key={r} value={r}>{r}</option>
                  ))}
                </select>
              </div>

              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,.txt"
                onChange={handleResumeUpload}
                className="hidden"
              />

              {!resumeFileName ? (
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={resumeParsing}
                  className="w-full py-2.5 px-3 border-2 border-dashed border-slate-300 hover:border-brand-400 bg-white rounded-xl text-xs font-semibold text-slate-600 hover:text-brand-700 transition-all flex items-center justify-center gap-2 cursor-pointer"
                >
                  {resumeParsing ? (
                    <>
                      <div className="w-3.5 h-3.5 border-2 border-brand-600 border-t-transparent rounded-full animate-spin" />
                      <span>Extracting keywords...</span>
                    </>
                  ) : (
                    <>
                      <Upload className="w-3.5 h-3.5 text-brand-600" />
                      <span>Upload Resume (PDF / TXT) to Extract Keywords</span>
                    </>
                  )}
                </button>
              ) : (
                <div className="space-y-2">
                  <div className="flex items-center justify-between bg-emerald-50 border border-emerald-200 rounded-lg px-2.5 py-1.5">
                    <div className="flex items-center gap-2 min-w-0">
                      <FileText className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                      <span className="text-[11px] font-bold text-emerald-900 truncate">{resumeFileName}</span>
                    </div>
                    <button
                      type="button"
                      onClick={handleClearResume}
                      className="text-slate-400 hover:text-rose-600 p-0.5 cursor-pointer"
                      title="Remove resume"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  {resumeKeywords.length > 0 && (
                    <div className="space-y-1">
                      <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                        Extracted Keywords for AI Interview ({resumeKeywords.length})
                      </div>
                      <div className="flex flex-wrap gap-1 max-h-20 overflow-y-auto">
                        {resumeKeywords.slice(0, 14).map((kw) => (
                          <span
                            key={kw}
                            className="px-2 py-0.5 rounded-md bg-brand-50 border border-brand-200 text-brand-700 text-[10px] font-bold"
                          >
                            {kw}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {resumeError && (
                <div className="text-[11px] text-rose-600 font-medium">{resumeError}</div>
              )}
            </div>

            <button
              type="submit"
              disabled={isLoading || resumeParsing}
              className="w-full py-2.5 px-4 bg-brand-600 hover:bg-brand-700 active:scale-[0.99] text-white rounded-xl text-xs sm:text-sm font-bold shadow-md shadow-brand-600/20 transition-all flex items-center justify-center gap-2 disabled:opacity-50 cursor-pointer"
            >
              {isLoading ? (
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              ) : (
                <>
                  <span>Sign In &amp; Continue</span>
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>

          </form>

          {/* Footer links */}
          <div className="text-center text-xs text-slate-500 pt-1">
            Don&apos;t have an account?{' '}
            <button
              type="button"
              onClick={() => navigateTo('signup')}
              className="font-bold text-brand-600 hover:underline"
            >
              Sign Up
            </button>
          </div>

        </div>
      </div>
    </div>
  );
};
