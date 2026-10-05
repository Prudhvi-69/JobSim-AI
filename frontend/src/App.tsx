import { useEffect, useState } from 'react';
import {
  ArrowRight,
  Bell,
  BookOpen,
  BriefcaseBusiness,
  CalendarDays,
  ChevronDown,
  CircleHelp,
  ClipboardCheck,
  FileText,
  GraduationCap,
  LayoutDashboard,
  Menu,
  Mic2,
  Search,
  Settings2,
  Sparkles,
  Target,
  TrendingUp,
  X,
} from 'lucide-react';
import AuthPage, { type SessionUser } from './auth/AuthPage';
import ResumeWorkspace from './resumes/ResumeWorkspace';
import RoleWorkspace from './roles/RoleWorkspace';
import AssessmentWorkspace from './assessments/AssessmentWorkspace';
import InterviewWorkspace from './interviews/InterviewWorkspace';
import { CandidateJobsWorkspace, RecruiterJobsWorkspace } from './jobs/JobWorkspaces';
import StudyAssistant from './assistant/StudyAssistant';

const navigation = [
  { label: 'Overview', icon: LayoutDashboard },
  { label: 'My resume', icon: FileText },
  { label: 'Role matches', icon: Target },
  { label: 'Skill roadmap', icon: BookOpen },
  { label: 'Mock tests', icon: ClipboardCheck },
  { label: 'Mock interviews', icon: Mic2 },
  { label: 'Placement probability', icon: TrendingUp },
  { label: 'Explore jobs', icon: BriefcaseBusiness },
];

const actions = [
  { label: 'Add a project with measurable impact', type: 'Resume', icon: FileText },
  { label: 'Practice SQL joins and window functions', type: 'Skill gap', icon: BookOpen },
  { label: 'Try a 20-minute technical mock interview', type: 'Practice', icon: Mic2 },
];

type DashboardTopRoleMatch = { roleName: string; score: number } | null;
type DashboardData = { resumeHealth: number; dataAnalystFit: number; hasAnalyzedResume: boolean; topRoleMatch?: DashboardTopRoleMatch };
type DashboardRoleMatch = { roleName: string; score: number; explanation: string };
type DailyProgress = Record<string, string[]>;

function localDateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function readDailyProgress(userId: string): DailyProgress {
  try {
    const value = localStorage.getItem(`placeprep_daily_progress:${userId}`);
    return value ? JSON.parse(value) as DailyProgress : {};
  } catch {
    return {};
  }
}

function countStreak(progress: DailyProgress) {
  const cursor = new Date();
  if (!progress[localDateKey(cursor)]?.length) cursor.setDate(cursor.getDate() - 1);
  let streak = 0;
  while (streak < 365 && progress[localDateKey(cursor)]?.length) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

function getWeekProgress(progress: DailyProgress) {
  const today = new Date();
  const mondayOffset = (today.getDay() + 6) % 7;
  const monday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - mondayOffset);
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + index);
    const key = localDateKey(date);
    return { key, date, label: date.toLocaleDateString(undefined, { weekday: 'narrow' }), done: Boolean(progress[key]?.length) };
  });
}

type ProbabilityScenarioKey = 'stretch' | 'launch';

type ProbabilityComponentKey = 'resume' | 'roleFit' | 'assessments' | 'interviews' | 'profile';

type ProbabilityResult = {
  probability: number | null;
  confidence: 'Low' | 'Medium' | 'High';
  dataPoints: number;
  weightedScore: number | null;
  factors: Array<{ key: ProbabilityComponentKey; label: string; score: number; impact: number; reason: string }>;
};

type ProbabilitySnapshot = ProbabilityResult & {
  role: { id: string; name: string } | null;
  components: Record<ProbabilityComponentKey, number | null>;
};

type ProbabilitySimulation = {
  before: ProbabilityResult;
  after: ProbabilityResult;
  delta: number;
};

const probabilityScenarioOverrides: Record<ProbabilityScenarioKey, Partial<Record<ProbabilityComponentKey, number>>> = {
  stretch: { assessments: 85, interviews: 80 },
  launch: { resume: 90, roleFit: 90, assessments: 90, interviews: 90, profile: 90 },
};

const probabilityNextMoves: Record<ProbabilityComponentKey, { title: string; destination: string; buttonLabel: string }> = {
  resume: { title: 'Sharpen one project story', destination: 'My resume', buttonLabel: 'Open resume workspace' },
  roleFit: { title: 'Close a must-have skill gap', destination: 'Skill roadmap', buttonLabel: 'Open skill roadmap' },
  assessments: { title: 'Try a timed assessment', destination: 'Mock tests', buttonLabel: 'Open mock tests' },
  interviews: { title: 'Rehearse one role-specific answer', destination: 'Mock interviews', buttonLabel: 'Open mock interviews' },
  profile: { title: 'Complete your candidate profile', destination: 'My resume', buttonLabel: 'Open profile workspace' },
};

async function probabilityRequest<T>(path: string, accessToken: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { Authorization: `Bearer ${accessToken}`, ...(init?.headers ?? {}) },
  });
  const result = await readJsonResponse<T>(response, {} as T);
  if (!response.ok) {
    const messageResult = result as { message?: string } | undefined;
    throw new Error(messageResult?.message ?? 'Placement probability could not be loaded.');
  }
  return result;
}

async function readJsonResponse<T>(response: Response, fallback: T): Promise<T> {
  const text = await response.text();
  if (!text.trim()) return fallback;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error('The server returned an invalid response. Please try again.');
  }
}

function nullableNumber(value: number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function normalizeProbabilityResult(result: ProbabilityResult): ProbabilityResult {
  return {
    ...result,
    probability: nullableNumber(result.probability),
    dataPoints: Number(result.dataPoints),
    weightedScore: nullableNumber(result.weightedScore),
    factors: result.factors.map((factor) => ({
      ...factor,
      score: Number(factor.score),
      impact: Number(factor.impact),
    })),
  };
}

function ProbabilityForecastPanel({ accessToken, onNavigate }: { accessToken: string; onNavigate: (section: string) => void }) {
  const [snapshot, setSnapshot] = useState<ProbabilitySnapshot | null>(null);
  const [summary, setSummary] = useState<ProbabilityResult | null>(null);
  const [scenario, setScenario] = useState<ProbabilityScenarioKey | null>(null);
  const [delta, setDelta] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    probabilityRequest<ProbabilitySnapshot>('/api/v1/me/placement-probability', accessToken)
      .then((result) => {
        if (!active) return;
        const normalized = {
          ...result,
          components: Object.fromEntries(Object.entries(result.components).map(([key, value]) => [key, nullableNumber(value)])) as Record<ProbabilityComponentKey, number | null>,
          ...normalizeProbabilityResult(result),
        };
        setSnapshot(normalized);
        setSummary(normalizeProbabilityResult(normalized));
      })
      .catch((cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause.message : 'Placement probability could not be loaded.');
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [accessToken]);

  async function simulate(key: ProbabilityScenarioKey) {
    setBusy(true);
    setError('');
    setScenario(key);
    try {
      const result = await probabilityRequest<ProbabilitySimulation>('/api/v1/me/placement-probability/simulate', accessToken, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(probabilityScenarioOverrides[key]),
      });
      const normalized = {
        ...result,
        before: normalizeProbabilityResult(result.before),
        after: normalizeProbabilityResult(result.after),
        delta: Number(result.delta),
      };
      setSummary(normalized.after);
      setScenario(key);
      setDelta(Number.isFinite(normalized.delta) ? normalized.delta : null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The scenario could not be simulated.');
    } finally {
      setBusy(false);
    }
  }

  const ringStyle = {
    background: `conic-gradient(#2d7251 ${(summary?.probability ?? 0) * 3.6}deg, #edf1eb 0deg)`,
  };
  const weakestFactor = summary?.factors.length
    ? summary.factors.reduce((weakest, factor) => factor.score < weakest.score ? factor : weakest)
    : undefined;

  return (
    <article className="panel probability-panel">
      <div className="section-heading">
        <div>
          <div className="section-kicker">RULE-BASED PLACEMENT ESTIMATE</div>
          <h2>{snapshot?.role?.name ?? 'Shortlist outlook'}</h2>
        </div>
        <span className="pulse-badge">Practice signal</span>
      </div>

      {loading && <div className="workspace-loading" role="status">Loading placement estimate</div>}
      {error && <div className="resume-error" role="alert">{error}</div>}

      <div className="probability-body">
        <div className="probability-ring" style={ringStyle}>
          <div className="probability-ring-inner">
            <strong>{summary?.probability ?? '—'}</strong>
            {summary?.probability !== null && summary?.probability !== undefined && <small>%</small>}
          </div>
        </div>

        <div className="probability-copy">
          <div className="probability-meta">
            <span className="probability-tag">{summary ? `${summary.confidence} confidence` : 'Confidence unavailable'}</span>
            {delta !== null && <span className="probability-trend">{delta >= 0 ? '+' : ''}{delta.toFixed(1)} pts vs current</span>}
          </div>
          <p>{summary ? `${summary.dataPoints} of 5 signals available. This is a practice estimate, not a placement guarantee.` : 'Loading candidate signals.'}</p>

          <div className="projection-buttons" aria-label="Scenario selector">
            {(['stretch', 'launch'] as ProbabilityScenarioKey[]).map((key) => (
              <button
                key={key}
                className={scenario === key ? 'is-active' : ''}
                disabled={loading || busy || !snapshot?.dataPoints}
                onClick={() => { void simulate(key); }}
                type="button"
              >
                {busy && scenario === key ? 'Calculating' : key === 'stretch' ? 'Stretch' : 'Launch'}
              </button>
            ))}
          </div>
        </div>
      </div>

      {snapshot?.dataPoints === 0 && !loading && <p role="status">No scores yet. Run a resume analysis, mock assessment, or interview to start building an estimate.</p>}

      <div className="probability-factors" aria-label="Probability factor breakdown">
        {(summary?.factors ?? []).map((factor) => (
          <div key={factor.key} className="probability-factor-row">
            <div className="probability-factor-meta">
              <span>{factor.label}</span>
              <strong>{factor.score}%</strong>
            </div>
            <div className="probability-factor-track">
              <span style={{ width: `${factor.score}%` }} />
            </div>
          </div>
        ))}
      </div>

      {weakestFactor && (
        <div className="probability-next-move">
          <span className="next-move-icon"><Sparkles size={15} /></span>
          <div className="next-move-copy">
            <span className="section-kicker">SIGNAL TO LIFT · {weakestFactor.label}</span>
            <strong>{probabilityNextMoves[weakestFactor.key].title}</strong>
            <p>{weakestFactor.reason}</p>
          </div>
          <button
            aria-label={probabilityNextMoves[weakestFactor.key].buttonLabel}
            onClick={() => onNavigate(probabilityNextMoves[weakestFactor.key].destination)}
            title={probabilityNextMoves[weakestFactor.key].buttonLabel}
            type="button"
          >
            <ArrowRight size={15} />
          </button>
        </div>
      )}
    </article>
  );
}

type DashboardProps = {
  accessToken: string;
  user: SessionUser;
  onSignOut: () => void;
};

function CandidateDashboard({ accessToken, user, onSignOut }: DashboardProps) {
  const [active, setActive] = useState('Overview');
  const [menuOpen, setMenuOpen] = useState(false);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [dailyProgress, setDailyProgress] = useState<DailyProgress>(() => readDailyProgress(user.id));
  const [dashboardData, setDashboardData] = useState<DashboardData>({ resumeHealth: 0, dataAnalystFit: 0, hasAnalyzedResume: false, topRoleMatch: null });
  const [roleMatches, setRoleMatches] = useState<DashboardRoleMatch[]>([]);
  const [dashboardError, setDashboardError] = useState('');
  const todayKey = localDateKey(new Date());
  const completedActions = dailyProgress[todayKey] ?? [];
  const streak = countStreak(dailyProgress);
  const weekProgress = getWeekProgress(dailyProgress);

  const storedRoleName = (() => {
    try {
      return localStorage.getItem('placeprep_selected_role_name') ?? '';
    } catch {
      return '';
    }
  })();

  const selectedRoleMatch = (() => {
    const storedChoice = storedRoleName
      ? roleMatches.find((match) => match.roleName === storedRoleName) ?? null
      : null;
    const dashboardChoice = dashboardData.topRoleMatch && dashboardData.topRoleMatch.roleName
      ? { roleName: dashboardData.topRoleMatch.roleName, score: Number(dashboardData.topRoleMatch.score), explanation: 'Latest top role match' }
      : null;
    const fallbackMatch = roleMatches[0] ?? null;
    return storedChoice ?? fallbackMatch ?? dashboardChoice ?? null;
  })();

  const roleMatchScore = selectedRoleMatch ? Number(selectedRoleMatch.score) : null;
  const roleMatchName = selectedRoleMatch ? selectedRoleMatch.roleName : 'Role fit';

  useEffect(() => {
    let active = true;
    const headers = { Authorization: `Bearer ${accessToken}` };
    Promise.all([
      fetch('/api/v1/me/dashboard', { headers }).then(async (response) => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.message ?? 'Candidate scores could not be loaded.');
        return result as DashboardData;
      }),
      fetch('/api/v1/me/role-fit', { headers }).then(async (response) => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.message ?? 'Role matches could not be loaded.');
        return result as { roleMatches?: DashboardRoleMatch[] };
      }),
    ]).then(([summary, matches]) => {
      if (!active) return;
      setDashboardData(summary);
      setRoleMatches(summary.hasAnalyzedResume ? matches.roleMatches ?? [] : []);
      setDashboardError('');
    }).catch((cause: unknown) => {
      if (active) setDashboardError(cause instanceof Error ? cause.message : 'Your dashboard data could not be loaded.');
    });
    return () => { active = false; };
  }, [accessToken]);

  function toggleAction(label: string) {
    const progress = readDailyProgress(user.id);
    const current = progress[todayKey] ?? [];
    const updated = {
      ...progress,
      [todayKey]: current.includes(label) ? current.filter((item) => item !== label) : [...current, label],
    };
    localStorage.setItem(`placeprep_daily_progress:${user.id}`, JSON.stringify(updated));
    setDailyProgress(updated);
  }

  const resumeScore = Number(dashboardData.resumeHealth) || 0;
  const focusPercent = Math.round((completedActions.length / actions.length) * 100);
  const focusLabel = focusPercent >= 80 ? 'Launch mode' : focusPercent >= 45 ? 'Momentum building' : 'Starter orbit';
  const dailyEncouragement = completedActions.length === actions.length
    ? 'You completed today’s plan. Come back tomorrow to keep your streak going.'
    : completedActions.length
      ? `${actions.length - completedActions.length} small step${actions.length - completedActions.length === 1 ? '' : 's'} left for today.`
      : 'Pick one small task to get today’s momentum started.';
  const focusNarrative = focusPercent >= 80
    ? 'You have enough traction to target a role-specific sprint this week. Keep the streak alive and turn one win into a full interview-ready story.'
    : focusPercent >= 45
      ? 'Your routine is compounding. One focused 30-minute practice block can push your resume story, role-fit, and interview readiness together.'
      : 'Start small, protect consistency, and stack wins. A single focused push today can change the shape of your week.';

  return (
    <div className="app-shell">
      <aside className={`sidebar ${menuOpen ? 'sidebar-open' : ''}`}>
        <a className="brand" href="#overview" onClick={() => setActive('Overview')}>
          <span className="brand-mark"><GraduationCap size={19} strokeWidth={2.2} /></span>
          <span>placeprep<span className="brand-ai">.ai</span></span>
        </a>
        <div className="workspace-label">CANDIDATE SPACE</div>
        <div className="profile-switcher">
          <span className="avatar">{user.name.slice(0, 2).toUpperCase()}</span>
          <span className="profile-copy"><strong>{user.name}</strong><small>{user.email}</small></span>
          <ChevronDown size={15} />
        </div>
        <nav className="main-nav" aria-label="Main navigation">
          {navigation.map(({ label, icon: Icon }) => (
            <button
              className={`nav-item ${active === label ? 'nav-item-active' : ''}`}
              key={label}
              onClick={() => { setActive(label); setMenuOpen(false); }}
              type="button"
            >
              <Icon size={17} strokeWidth={1.8} />
              <span>{label}</span>
              {label === 'Mock tests' && <span className="nav-count">2</span>}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="week-card">
            <div className="week-top"><span className="week-icon"><TrendingUp size={15} /></span><span>THIS WEEK</span></div>
            <strong>3 day streak</strong>
            <p>A little practice goes a long way.</p>
            <div className="streak-dots" aria-label="Activity this week">
              {weekProgress.map((day) => (
                <span className={day.done ? 'streak-done' : ''} key={day.key} title={day.date.toLocaleDateString()}>{day.label}</span>
              ))}
            </div>
          </div>
          <button className="nav-item muted-nav" type="button" onClick={() => setActive('Settings')}><Settings2 size={17} /><span>Settings</span></button>
          <button className="nav-item muted-nav" type="button" onClick={() => setAssistantOpen((open) => !open)}><CircleHelp size={17} /><span>Help assistant</span></button>
          <div className="sidebar-footnote">A clearer path to your next role.</div>
        </div>
      </aside>

      {menuOpen && <button aria-label="Close navigation" className="mobile-scrim" onClick={() => setMenuOpen(false)} type="button" />}

      <main className="main-content">
        <header className="topbar">
          <button aria-label={menuOpen ? 'Close menu' : 'Open menu'} className="icon-button menu-toggle" onClick={() => setMenuOpen(!menuOpen)} type="button">
            {menuOpen ? <X size={19} /> : <Menu size={19} />}
          </button>
          <div className="breadcrumb"><span>My workspace</span><span className="crumb-divider">/</span><strong>{active}</strong></div>
          <div className="topbar-actions">
            <label className="search-box"><Search size={15} /><input aria-label="Search" placeholder="Search anything" /></label>
            <button aria-label="Notifications" className="icon-button notification-button" type="button"><Bell size={18} /><i /></button>
            <button className="top-avatar" aria-label="Sign out" onClick={onSignOut} type="button">{user.name.slice(0, 2).toUpperCase()}</button>
          </div>
        </header>

        <div className="page-content">
          {active === 'Explore jobs' ? <CandidateJobsWorkspace accessToken={accessToken} onNavigate={setActive} /> : active === 'My resume' ? <ResumeWorkspace accessToken={accessToken} /> : active === 'Role matches' ? <RoleWorkspace accessToken={accessToken} view="roles" /> : active === 'Skill roadmap' ? <RoleWorkspace accessToken={accessToken} view="roadmap" /> : active === 'Mock tests' ? <AssessmentWorkspace accessToken={accessToken} /> : active === 'Mock interviews' ? <InterviewWorkspace accessToken={accessToken} /> : active === 'Placement probability' ? <ProbabilityForecastPanel accessToken={accessToken} onNavigate={setActive} /> : <>
          <section className="welcome-row">
            <div>
              <div className="eyebrow"><span className="eyebrow-dot" /> WEDNESDAY, SEPTEMBER 30</div>
              <h1>Good morning, {user.name.split(' ')[0]}<span className="wave">.</span></h1>
              <p className="welcome-subtitle">You’re building momentum. Here’s where things stand.</p>
            </div>
            <button className="date-button" type="button"><CalendarDays size={16} /> This week <ChevronDown size={14} /></button>
          </section>

          {dashboardError && <div className="resume-error" role="alert">{dashboardError}</div>}
          <section aria-label="Placement preparation overview" className="metrics-grid">
            <article className="metric-card resume-metric">
              <div className="metric-head"><span>RESUME HEALTH</span><span className="metric-icon resume-icon"><FileText size={16} /></span></div>
              <div className="score-line"><strong>{resumeScore}</strong><span>/ 100</span></div>
              <div className="progress-track"><span style={{ width: `${resumeScore}%` }} /></div>
              <div className="metric-foot"><span>{dashboardData.hasAnalyzedResume ? resumeScore >= 80 ? 'Ready to apply' : resumeScore >= 65 ? 'Nearly ready' : 'Keep improving' : 'Add a resume to begin'}</span><button onClick={() => setActive('My resume')} type="button">{dashboardData.hasAnalyzedResume ? 'View report' : 'Add resume'} <ArrowRight size={13} /></button></div>
            </article>
            <article className="metric-card readiness-metric">
              <div className="metric-head"><span>INTERVIEW READINESS</span><span className="metric-icon readiness-icon"><Mic2 size={16} /></span></div>
              <div className="score-line"><strong>Getting</strong></div>
              <div className="readiness-label"><span className="status-dot" /> There’s room to grow</div>
              <div className="metric-foot"><span>2 areas to work on</span><button onClick={() => setActive('Practice')} type="button">See next steps <ArrowRight size={13} /></button></div>
            </article>
            <article className="metric-card probability-metric">
              <div className="metric-head"><span>ROLE FIT · {roleMatchName ? roleMatchName.toUpperCase() : 'ROLE FIT'}</span><span className="metric-icon probability-icon"><Target size={16} /></span></div>
              <div className="score-line">
                {roleMatchScore === null ? <strong>—</strong> : <strong>{Number(roleMatchScore)}<span className="score-percent">%</span></strong>}
              </div>
              <div className="metric-foot probability-foot"><span>{roleMatchScore === null ? 'Analyze a resume to see a match' : dashboardData.hasAnalyzedResume ? 'Based on your latest resume analysis' : 'Analyze a resume to calculate fit'}</span><button onClick={() => setActive('Role matches')} type="button">Explore roles <ArrowRight size={13} /></button></div>
            </article>
          </section>

          <section className="pulse-layout">
            <ProbabilityForecastPanel accessToken={accessToken} onNavigate={setActive} />

            <aside className="panel coach-panel">
              <div className="section-kicker">NEXT AI NUDGE</div>
              <h2>Publish an interview-ready project</h2>
              <ul className="coach-list">
                <li>Showcase measurable impact in one backend feature.</li>
                <li>Document your architecture and trade-offs clearly.</li>
                <li>Prepare a 90-second story for the strongest project.</li>
              </ul>
              <button className="practice-button coach-button" onClick={() => setActive('My resume')} type="button">Upgrade my project story <ArrowRight size={15} /></button>
            </aside>
          </section>

          <div className="content-grid">
            <section className="panel actions-panel">
              <div className="section-heading"><div><div className="section-kicker">YOUR NEXT MOVES</div><h2>Personal tracker · saved in this browser</h2></div><span className="action-counter">{completedActions.length}/{actions.length} done</span></div>
              <p className="tracker-note">This checklist is personal and local to your browser; it is not an account score.</p>
              <div className="action-list">
                {actions.map(({ label, type, icon: Icon }) => {
                  const done = completedActions.includes(label);
                  return (
                    <button className={`action-row ${done ? 'action-complete' : ''}`} key={label} onClick={() => toggleAction(label)} type="button">
                      <span className="action-check">{done && <span />}</span>
                      <span className="action-icon"><Icon size={17} /></span>
                      <span className="action-copy"><strong>{label}</strong><small>{type}</small></span>
                      <ArrowRight className="action-arrow" size={16} />
                    </button>
                  );
                })}
              </div>
              <button className="text-link" onClick={() => setActive('Skill roadmap')} type="button">View your full roadmap <ArrowRight size={14} /></button>
            </section>

            <section className="panel roles-panel">
              <div className="section-heading"><div><div className="section-kicker">BASED ON YOUR PROFILE</div><h2>Roles taking shape</h2></div><button className="round-arrow" aria-label="Explore all roles" onClick={() => setActive('Role matches')} type="button"><ArrowRight size={16} /></button></div>
              <div className="role-list">
                {roleMatches.slice(0, 5).map((role, index) => (
                  <button className="role-row" key={role.roleName} onClick={() => setActive('Role matches')} type="button">
                    <span className={`role-rank rank-${index + 1}`}>0{index + 1}</span>
                    <span className="role-details"><strong>{role.roleName}</strong><small>{role.explanation}</small></span>
                    <span className="match-pill mint">{role.score}%</span>
                  </button>
                ))}
              </div>
              {roleMatches.length === 0 ? <p className="resume-empty">Upload and analyze your resume to see role matches.</p> : <div className="roles-note"><Sparkles size={14} /><span>Matches update from your latest analyzed resume.</span></div>}
            </section>
          </div>

          <section className="spotlight-grid" aria-label="Career momentum overview">
            <article className="panel spotlight-card spotlight-card-emerald">
              <div className="spotlight-header">
                <div>
                  <div className="section-kicker">PLACEMENT SIGNAL</div>
                  <h2>Momentum engine</h2>
                </div>
                <span className="spotlight-badge">Live</span>
              </div>
              <div className="spotlight-body">
                <div className="mini-ring" aria-label="Current practice streak">
                  <span className="mini-ring-core"><strong>{streak}</strong><small>days</small></span>
                </div>
                <div className="spotlight-copy">
                  <p>{dailyEncouragement}</p>
                  <div className="chip-stack">
                    <span>{completedActions.length}/{actions.length} tasks today</span>
                    <span>{streak} day streak</span>
                  </div>
                </div>
              </div>
            </article>

            <article className="panel spotlight-card spotlight-card-sand">
              <div className="spotlight-header">
                <div>
                  <div className="section-kicker">AI COACH</div>
                  <h2>Today’s spark</h2>
                </div>
              </div>
              <div className="momentum-grid">
                <div className="momentum-tile"><span>DAILY TASKS</span><strong>{completedActions.length}/{actions.length}</strong><small>{dailyEncouragement}</small></div>
                <div className="momentum-tile"><span>STREAK</span><strong>{streak} day{streak === 1 ? '' : 's'}</strong><small>Keep the habit gentle and steady.</small></div>
              </div>
            </article>
          </section>

          <section className="creative-grid">
            <article className="panel creative-panel">
              <div className="section-heading">
                <div>
                  <div className="section-kicker">CAREER WEATHER</div>
                  <h2>Momentum map</h2>
                </div>
                <span className="pulse-badge">{focusLabel}</span>
              </div>
              <div className="creative-layout">
                <div className="focus-ring" style={{ background: `conic-gradient(#2d7251 ${focusPercent * 3.6}deg, #edf2ee 0deg)` }}>
                  <div className="focus-ring-inner">
                    <strong>{focusPercent}%</strong>
                    <small>focus</small>
                  </div>
                </div>
                <div className="signal-list">
                  <div className="signal-row"><span>Resume stories</span><strong>{resumeScore >= 80 ? 'Ready' : resumeScore >= 65 ? 'Polish' : 'Build'}</strong></div>
                  <div className="signal-row"><span>{roleMatchScore === null ? 'Role match' : `Role match · ${roleMatchName}`}</span><strong>{roleMatchScore === null ? 'Analyze a resume to see a match' : `${Number(roleMatchScore)}%`}</strong></div>
                  <div className="signal-row"><span>Practice streak</span><strong>{streak} day{streak === 1 ? '' : 's'}</strong></div>
                </div>
              </div>
            </article>

            <article className="panel creative-panel creative-panel-alt">
              <div className="section-kicker">AI COACH</div>
              <h2>Forecast for this week</h2>
              <p className="creative-blurb">{focusNarrative}</p>
              <div className="mini-timeline">
                {[
                  { label: 'Resume', text: 'Tighten metrics' },
                  { label: 'Role fit', text: 'Close gaps' },
                  { label: 'Interview', text: 'Practice story' },
                ].map(({ label, text }, index) => (
                  <div className="timeline-item" key={label}>
                    <span className={`timeline-dot dot-${index + 1}`} />
                    <div>
                      <strong>{label}</strong>
                      <small>{text}</small>
                    </div>
                  </div>
                ))}
              </div>
            </article>
          </section>

          <section className="practice-strip">
            <div className="practice-art"><span className="art-ring ring-one" /><span className="art-ring ring-two" /><span className="art-star"><Sparkles size={18} /></span><span className="art-dot dot-one" /><span className="art-dot dot-two" /></div>
            <div className="practice-copy"><span className="section-kicker">YOUR PRACTICE, YOUR PACE</span><h2>Ready for a quick win?</h2><p>Pick up where you left off with a short SQL practice set.</p></div>
            <button className="practice-button" onClick={() => setActive('Mock tests')} type="button">Continue practicing <ArrowRight size={15} /></button>
          </section>

          <footer className="page-footer"><span>PlacePrep AI <span className="footer-separator">·</span> Your progress belongs to you.</span><button onClick={() => setActive('Privacy & consent')} type="button">Privacy & consent</button></footer>
          </>}
        </div>
      </main>
      <StudyAssistant open={assistantOpen} onOpen={() => setAssistantOpen(true)} onClose={() => setAssistantOpen(false)} onNavigate={setActive} />
    </div>
  );
}

function RecruiterDashboard({ accessToken, user, onSignOut }: DashboardProps) {
  return <div className="app-shell recruiter-shell">
    <header className="recruiter-topbar"><a className="brand" href="#jobs"><span className="brand-mark"><GraduationCap size={19} strokeWidth={2.2} /></span><span>placeprep<span className="brand-ai">.ai</span></span></a><span className="recruiter-account">{user.name} · Recruiter</span><button className="top-avatar" aria-label="Sign out" onClick={onSignOut} type="button">{user.name.slice(0, 2).toUpperCase()}</button></header>
    <main className="recruiter-main"><RecruiterJobsWorkspace accessToken={accessToken} /></main>
  </div>;
}

function App() {
  const hasStoredSession = localStorage.getItem('placeprep_has_session') === 'true';
  const [session, setSession] = useState<{ accessToken: string; user: SessionUser } | null>(null);
  const [checkingSession, setCheckingSession] = useState(hasStoredSession);

  useEffect(() => {
    if (!hasStoredSession) return;
    let active = true;

    async function restoreSession() {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 4000);
        const response = await fetch('/api/v1/auth/refresh', { method: 'POST', credentials: 'include', signal: controller.signal });
        clearTimeout(timeout);
        if (!response.ok) {
          localStorage.removeItem('placeprep_has_session');
          return;
        }
        const result = await readJsonResponse<{ accessToken?: string; user?: SessionUser }>(response, {});
        if (!result.accessToken || !result.user) return;
        const profileResponse = await fetch('/api/v1/auth/me', {
          headers: { Authorization: `Bearer ${result.accessToken}` },
          credentials: 'include',
        });
        if (!profileResponse.ok) return;
        const profile = await readJsonResponse<{ roles?: string[] }>(profileResponse, {});
        if (active) setSession({ accessToken: result.accessToken, user: { ...result.user, roles: profile.roles } });
      } catch {
        if (active) {
          localStorage.removeItem('placeprep_has_session');
          setSession(null);
        }
      } finally {
        if (active) setCheckingSession(false);
      }
    }

    void restoreSession();
    return () => { active = false; };
  }, []);

  async function signOut() {
    try {
      await fetch('/api/v1/auth/logout', { method: 'POST', credentials: 'include' });
    } finally {
      localStorage.removeItem('placeprep_has_session');
      setSession(null);
    }
  }

  if (checkingSession) {
    return <main className="session-loading" aria-label="Checking your session"><span /></main>;
  }
  if (!session) {
    return <AuthPage onAuthenticated={(accessToken, user) => {
      localStorage.setItem('placeprep_has_session', 'true');
      setSession({ accessToken, user });
    }} />;
  }
  if (session.user.roles?.includes('recruiter')) {
    return <RecruiterDashboard accessToken={session.accessToken} user={session.user} onSignOut={() => { void signOut(); }} />;
  }
  return <CandidateDashboard accessToken={session.accessToken} user={session.user} onSignOut={() => { void signOut(); }} />;
}

export default App;