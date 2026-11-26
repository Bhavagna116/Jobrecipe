import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { INITIAL_ASSESSMENTS } from '../../data/mockData';
import { DeviceCheckModal } from '../../components/candidate/DeviceCheckModal';
import { AcademicMarksModal } from '../../components/candidate/AcademicMarksModal';
import {
  ClipboardCheck,
  Clock,
  Award,
  Play,
  RotateCcw,
  Eye,
  Filter,
  Sparkles,
  ChevronRight,
  BookOpen,
  BarChart2,
  CheckCircle2,
  Lock,
  ArrowRight
} from 'lucide-react';

const ROUNDS_ORDER = ['Technical', 'Aptitude', 'Reasoning', 'Coding'];

export const AssessmentsListPage = () => {
  const { assessments, assessmentsLoading, startAssessment, navigateTo, addToast, isAssessmentCompleted, candidateSubmissions } = useApp();
  const [selectedCategory, setSelectedCategory] = useState('All');

  const handleStartAttempt = async (asm) => {
    try {
      await startAssessment(asm.id);
    } catch (e) {
      console.warn('startAssessment error:', e);
    }
    navigateTo('take-assessment');
  };

  const rawList = Array.isArray(assessments) && assessments.length > 0
    ? assessments
    : (typeof INITIAL_ASSESSMENTS !== 'undefined' ? INITIAL_ASSESSMENTS : []);

  // Sort assessments strictly to match pipeline order: Technical -> Aptitude -> Reasoning -> Coding
  const sortedAssessments = [...rawList].sort((a, b) => {
    const idxA = ROUNDS_ORDER.findIndex(cat => cat.toLowerCase() === String(a.category || '').toLowerCase());
    const idxB = ROUNDS_ORDER.findIndex(cat => cat.toLowerCase() === String(b.category || '').toLowerCase());
    const oA = idxA >= 0 ? idxA : 99;
    const oB = idxB >= 0 ? idxB : 99;
    return oA - oB;
  });

  const checkCompleted = (asm) => {
    if (!asm) return false;
    const userSub = (candidateSubmissions || []).find(s => {
      const sId = String(s.assessment_id || s.assessmentId || '').trim().toLowerCase();
      const aId = String(asm.id || '').trim().toLowerCase();
      if (aId && sId) return sId === aId;
      const sTitle = String(s.assessment_title || s.assessmentName || '').trim().toLowerCase();
      const aTitle = String(asm.title || '').trim().toLowerCase();
      return !!sTitle && sTitle === aTitle;
    });
    return !!userSub || (isAssessmentCompleted && isAssessmentCompleted(asm)) || asm.status === 'Completed';
  };

  const completedCount = sortedAssessments.filter(a => checkCompleted(a)).length;
  const firstPendingIndex = sortedAssessments.findIndex(a => !checkCompleted(a));
  const allCompleted = sortedAssessments.length > 0 && firstPendingIndex === -1;
  const currentPendingAsm = firstPendingIndex >= 0 ? sortedAssessments[firstPendingIndex] : null;

  const filteredAssessments = sortedAssessments.filter(a => {
    return selectedCategory === 'All' || String(a.category).toLowerCase() === selectedCategory.toLowerCase();
  });

  return (
    <div className="space-y-8 pb-16">

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-brand-50 border border-brand-200 text-brand-700 text-xs font-bold mb-2">
            <Sparkles className="w-3.5 h-3.5 text-brand-600" />
            <span>Sequential Flow: Technical ➔ Aptitude ➔ Reasoning ➔ Coding ➔ AI Interview</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">
            Assessments & Mock Tests
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-1">
            Complete your 4 sequential rounds one after another. Upon completing the final round, you will automatically advance to your resume-tailored AI Mock Interview.
          </p>
        </div>

        {/* Category Filter Tabs */}
        {sortedAssessments.length > 1 && (
          <div className="flex items-center bg-slate-100 p-1 rounded-xl border border-slate-200 text-xs font-bold">
            {['All', 'Technical', 'Aptitude', 'Reasoning', 'Coding'].map((cat) => (
              <button
                key={cat}
                onClick={() => setSelectedCategory(cat)}
                className={`px-3 py-1.5 rounded-lg transition-all ${selectedCategory.toLowerCase() === cat.toLowerCase()
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
                  }`}
              >
                {cat}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Primary Pipeline Progress Action Banner */}
      {allCompleted ? (
        <div className="p-5 rounded-2xl bg-gradient-to-r from-emerald-50 via-teal-50 to-brand-50 border border-emerald-300 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4 animate-in fade-in">
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-emerald-800 font-extrabold text-sm">
              <CheckCircle2 className="w-5 h-5 text-emerald-600" />
              <span>All 4 Assessment Rounds Completed!</span>
            </div>
            <p className="text-xs text-slate-600">
              You have completed Technical, Aptitude, Reasoning, and Coding. You are now fully unlocked for your AI Mock Interview.
            </p>
          </div>
          <button
            onClick={() => {
              localStorage.setItem('rsj_auto_start_interview', 'true');
              navigateTo('interview');
            }}
            className="py-3 px-6 bg-gradient-to-r from-brand-600 to-cyan-600 hover:from-brand-700 hover:to-cyan-700 text-white rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2 shadow-md whitespace-nowrap cursor-pointer"
          >
            <Sparkles className="w-4 h-4 text-white" />
            <span>Proceed to AI Interview</span>
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      ) : (
        <div className="p-5 rounded-2xl bg-gradient-to-r from-brand-50 via-slate-50 to-indigo-50 border border-brand-200/80 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-brand-900 font-extrabold text-sm">
              <Sparkles className="w-4 h-4 text-brand-600" />
              <span>Multi-Round Assessment Pipeline ({completedCount} of {sortedAssessments.length || 4} Completed)</span>
            </div>
            <p className="text-xs text-slate-600">
              Rounds occur sequentially in strict order. Completing each round unlocks the next.
            </p>
          </div>
          {currentPendingAsm && (
            <button
              onClick={() => handleStartAttempt(currentPendingAsm)}
              className="py-3 px-5 bg-brand-600 hover:bg-brand-700 text-white rounded-xl text-xs font-extrabold transition-all flex items-center justify-center gap-2 shadow-md shadow-brand-600/25 whitespace-nowrap cursor-pointer ring-2 ring-brand-300"
            >
              <Play className="w-3.5 h-3.5 fill-white" />
              <span>Start Round {firstPendingIndex + 1}: {currentPendingAsm.category}</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          )}
        </div>
      )}

      {/* Sequential Pipeline Flow Stepper */}
      <div className="p-4 rounded-2xl bg-white border border-slate-200/90 shadow-card">
        <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-3 font-mono">Exam Pipeline Progression Flow</h2>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5">
          {[
            { round: 'Round 1', name: 'Technical', desc: '10 Core CS & Systems Qs', category: 'Technical' },
            { round: 'Round 2', name: 'Aptitude', desc: '10 Quantitative Qs', category: 'Aptitude' },
            { round: 'Round 3', name: 'Reasoning', desc: '10 Analytical Logic Qs', category: 'Reasoning' },
            { round: 'Round 4', name: 'Coding', desc: '4 Algorithmic Challenges', category: 'Coding' },
            { round: 'Final Round', name: 'AI Interview', desc: 'Resume-tailored & Proctoring', category: 'Interview' }
          ].map((item, idx) => {
            const isInterviewStep = item.category === 'Interview';
            const asm = sortedAssessments.find(a => String(a.category || '').toLowerCase() === item.category.toLowerCase());
            const isCompleted = isInterviewStep ? false : (asm && checkCompleted(asm));
            const isCurrent = isInterviewStep ? allCompleted : (idx === firstPendingIndex);
            const isLocked = isInterviewStep ? !allCompleted : (idx > firstPendingIndex);

            return (
              <div
                key={item.round}
                className={`p-3 rounded-xl border transition-all ${isCompleted
                  ? 'bg-emerald-50/70 border-emerald-200 text-emerald-950'
                  : isCurrent
                    ? 'bg-brand-50 border-brand-300 text-brand-950 ring-2 ring-brand-400/30'
                    : 'bg-slate-50 border-slate-200 text-slate-500 opacity-80'
                }`}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[10px] font-mono font-bold text-slate-500">{item.round}</span>
                  {isCompleted ? (
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                  ) : isCurrent ? (
                    <div className="w-2 h-2 rounded-full bg-brand-600 animate-ping" />
                  ) : (
                    <Lock className="w-3 h-3 text-slate-400" />
                  )}
                </div>
                <div className="font-bold text-xs">{item.name}</div>
                <div className="text-[10px] text-slate-500 truncate">{item.desc}</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ASSESSMENT CARDS GRID */}
      {assessmentsLoading && sortedAssessments.length === 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-2 xl:grid-cols-4 gap-6">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="bg-white rounded-2xl border border-slate-200/90 shadow-card p-6 space-y-4 animate-pulse"
            >
              <div className="flex items-center justify-between">
                <div className="h-4 w-16 rounded bg-slate-200" />
                <div className="h-4 w-24 rounded-full bg-slate-200" />
              </div>
              <div className="h-4 w-3/4 rounded bg-slate-200" />
              <div className="space-y-2">
                <div className="h-3 w-full rounded bg-slate-100" />
                <div className="h-3 w-5/6 rounded bg-slate-100" />
              </div>
              <div className="grid grid-cols-3 gap-1 p-2.5 bg-slate-50 border border-slate-100 rounded-xl">
                <div className="h-9 rounded bg-slate-200/70" />
                <div className="h-9 rounded bg-slate-200/70" />
                <div className="h-9 rounded bg-slate-200/70" />
              </div>
              <div className="h-9 w-full rounded-xl bg-slate-200" />
            </div>
          ))}
        </div>
      ) : filteredAssessments.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200/90 shadow-card p-12 text-center max-w-md mx-auto my-8 space-y-3">
          <div className="w-14 h-14 bg-brand-50 text-brand-600 rounded-2xl flex items-center justify-center mx-auto border border-brand-100">
            <ClipboardCheck className="w-7 h-7" />
          </div>
          <h3 className="text-base font-bold text-slate-900">No Assessments Available</h3>
          <p className="text-xs text-slate-500 leading-relaxed">
            There are currently no active assessments published. Check back soon or contact your portal administrator.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-2 xl:grid-cols-4 gap-6">
          {filteredAssessments.map((asm) => {
            const cardIndex = sortedAssessments.findIndex(a => a.id === asm.id);
            const isCompleted = checkCompleted(asm);
            const isCurrent = cardIndex === firstPendingIndex;
            const isLocked = !isCompleted && cardIndex > firstPendingIndex;
            const roundNum = cardIndex >= 0 ? cardIndex + 1 : 1;

            return (
              <div
                key={asm.id}
                className={`bg-white rounded-2xl border shadow-card p-6 flex flex-col justify-between space-y-4 transition-all group ${
                  isCurrent
                    ? 'border-brand-400 ring-2 ring-brand-400/20 shadow-md'
                    : isCompleted
                      ? 'border-emerald-200'
                      : 'border-slate-200/90 opacity-90'
                }`}
              >
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-slate-100 text-slate-700 uppercase tracking-wider">
                      Round {roundNum} • {asm.category}
                    </span>
                    <span className={`text-[11px] font-bold px-2.5 py-0.5 rounded-full flex items-center gap-1 ${isCompleted
                      ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                      : isCurrent
                        ? 'bg-brand-50 text-brand-700 border border-brand-200'
                        : 'bg-slate-100 text-slate-500 border border-slate-200'
                      }`}>
                      {isCompleted ? (
                        <>
                          <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                          <span>Completed • Result via Email</span>
                        </>
                      ) : isCurrent ? (
                        <>
                          <span className="w-1.5 h-1.5 rounded-full bg-brand-600 animate-pulse" />
                          <span>Available • Next Up</span>
                        </>
                      ) : (
                        <>
                          <Lock className="w-3 h-3 text-slate-400" />
                          <span>Locked</span>
                        </>
                      )}
                    </span>
                  </div>

                  <h3 className="text-base font-bold text-slate-900 group-hover:text-brand-600 transition-colors">
                    {asm.title}
                  </h3>
                  <p className="text-xs text-slate-500 mt-1 leading-relaxed line-clamp-2">
                    {asm.description}
                  </p>

                  <div className="grid grid-cols-2 gap-1 my-4 p-2.5 bg-slate-50 border border-slate-100 rounded-xl text-center text-xs">
                    <div className="px-1 border-r border-slate-200/60">
                      <span className="text-slate-400 block text-[10px] font-semibold uppercase tracking-tight">Questions</span>
                      <strong className="text-slate-800 font-bold block mt-0.5">{asm.totalQuestions || asm.total_questions || (asm.category === 'Coding' ? 4 : 10)} Qs</strong>
                    </div>
                    <div className="px-1">
                      <span className="text-slate-400 block text-[10px] font-semibold uppercase tracking-tight">Duration</span>
                      <strong className="text-slate-800 font-bold block mt-0.5">{asm.durationMinutes || asm.duration_minutes || 10}m</strong>
                    </div>
                  </div>
                </div>

                <div>
                  {isCompleted ? (
                    allCompleted ? (
                      <button
                        onClick={() => {
                          localStorage.setItem('rsj_auto_start_interview', 'true');
                          navigateTo('interview');
                        }}
                        className="w-full py-2.5 px-3 bg-gradient-to-r from-brand-600 to-cyan-600 hover:from-brand-700 hover:to-cyan-700 text-white rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 shadow-xs cursor-pointer"
                        title="Proceed to your AI Mock Interview"
                      >
                        <Sparkles className="w-3.5 h-3.5 text-white" />
                        <span>Proceed to AI Interview ➔</span>
                      </button>
                    ) : (
                      <div className="w-full py-2 px-3 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5">
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                        <span>Round Completed ✓</span>
                      </div>
                    )
                  ) : isCurrent ? (
                    <button
                      onClick={() => handleStartAttempt(asm)}
                      className="w-full py-2.5 px-3 bg-slate-900 hover:bg-brand-600 text-white rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 shadow-sm cursor-pointer"
                    >
                      <Play className="w-3.5 h-3.5 fill-white" />
                      <span>Start Round {roundNum}: {asm.category}</span>
                    </button>
                  ) : (
                    <button
                      disabled
                      className="w-full py-2.5 px-3 bg-slate-100 text-slate-400 border border-slate-200 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 cursor-not-allowed"
                    >
                      <Lock className="w-3.5 h-3.5 text-slate-400" />
                      <span>Locked • Complete Round {firstPendingIndex + 1} first</span>
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

    </div>
  );
};
