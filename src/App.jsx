import { useEffect, useMemo, useState } from "react";
import { Link, Navigate, Route, Routes, useNavigate, useParams } from "react-router-dom";
import { supabase } from "./lib/supabase";
import { ATTENDANCE_OPTIONS, US_STATES } from "./constants";
import { normalizeSchoolName, normalizeTown, stateOrEmpty, toLocalDateTimeInput } from "./utils";

function Page({ children, title, description, actions, width = "wide", showBack = true }) {
  const navigate = useNavigate();

  return (
    <div className="app-shell">
      <div className={`page-frame page-frame--${width}`}>
        <header className="page-header">
          <div className="page-header__copy">
            {showBack && (
              <button type="button" className="button button--ghost" onClick={() => navigate(-1)}>
                Back
              </button>
            )}
            <div className="page-header__text">
              {title ? <h1>{title}</h1> : null}
              {description ? <p>{description}</p> : null}
            </div>
          </div>
          {actions ? <div className="page-header__actions">{actions}</div> : null}
        </header>
        {children}
      </div>
    </div>
  );
}

function Surface({ children, className = "" }) {
  return <section className={`surface ${className}`.trim()}>{children}</section>;
}

function SectionHeader({ title, action, meta }) {
  return (
    <div className="section-header">
      <div>
        <h2>{title}</h2>
        {meta ? <p>{meta}</p> : null}
      </div>
      {action}
    </div>
  );
}

function Spinner({ label = "Loading..." }) {
  return (
    <div className="spinner-wrap" role="status" aria-live="polite">
      <span className="spinner" />
      <span>{label}</span>
    </div>
  );
}

function Toast({ type = "info", message, onClose }) {
  if (!message) return null;
  return (
    <div className={`toast toast--${type}`}>
      <span>{message}</span>
      <button type="button" className="toast__close" onClick={onClose} aria-label="Close message">
        Close
      </button>
    </div>
  );
}

function EmptyState({ title, description, action }) {
  return (
    <div className="empty-state">
      <h2>{title}</h2>
      <p>{description}</p>
      {action}
    </div>
  );
}

function useToast() {
  const [toast, setToast] = useState(null);

  useEffect(() => {
    if (!toast) return undefined;
    const id = window.setTimeout(() => setToast(null), 3200);
    return () => window.clearTimeout(id);
  }, [toast]);

  return {
    toast,
    notify(type, message) {
      setToast({ type, message });
    },
    clear() {
      setToast(null);
    },
  };
}

function useAuthState() {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_evt, nextSession) => {
      setSession(nextSession);
      setLoading(false);
    });

    return () => sub.subscription.unsubscribe();
  }, []);

  return { session, loading };
}

function normalizeUsername(value) {
  return value.trim().replace(/\s+/g, " ");
}

function formatDuration(minutes) {
  if (!minutes) return "No duration set";
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hours && mins) return `${hours}h ${mins}m`;
  if (hours) return `${hours}h`;
  return `${mins}m`;
}

function isEventVisible(event) {
  const startTime = new Date(event.date).getTime();
  const durationMinutes = Number(event.duration_minutes ?? 60);
  const hideAt = startTime + (durationMinutes + 60) * 60 * 1000;
  return Number.isFinite(startTime) && Date.now() < hideAt;
}

function formatEventDate(date) {
  return new Date(date).toLocaleString();
}

function EventListCard({ event, href, attendanceValue, attendanceDisabled, onAttendanceChange, action }) {
  return (
    <article className="info-card">
      <div className="stack-md">
        <div className="info-card__header">
          <div className="stack-sm">
            <Link className="card-link" to={href}>
              <h2>{event.name}</h2>
            </Link>
            <p>{formatEventDate(event.date)}</p>
          </div>
          {action}
        </div>
        <div className="detail-list">
          <div className="detail-row">
            <span>Location</span>
            <strong>{event.location}</strong>
          </div>
          <div className="detail-row">
            <span>Duration</span>
            <strong>{formatDuration(event.duration_minutes)}</strong>
          </div>
        </div>
        <label className="field">
          <span>Attendance</span>
          <select value={attendanceValue} onChange={onAttendanceChange} disabled={attendanceDisabled}>
            {ATTENDANCE_OPTIONS.map((status) => <option key={status} value={status}>{status}</option>)}
          </select>
        </label>
      </div>
    </article>
  );
}

function getProfileStatus(profile) {
  return Boolean(profile?.school_id && profile?.grade && (profile?.username || "").trim());
}

async function upsertSchoolAndProfile(userId, email, username, schoolName, town, state, grade) {
  const normalizedSchool = normalizeSchoolName(schoolName);
  const normalizedTown = normalizeTown(town);
  const normalizedState = stateOrEmpty(state);
  const uname = username != null ? normalizeUsername(username) : null;

  const { data: existingSchool } = await supabase
    .from("schools")
    .select("id")
    .eq("name", normalizedSchool)
    .eq("town", normalizedTown)
    .eq("state", normalizedState)
    .maybeSingle();

  let schoolId = existingSchool?.id;
  if (!schoolId) {
    const { data: createdSchool, error: createSchoolErr } = await supabase
      .from("schools")
      .insert({
        name: normalizedSchool,
        town: normalizedTown,
        state: normalizedState,
      })
      .select("id")
      .single();
    if (createSchoolErr) throw createSchoolErr;
    schoolId = createdSchool.id;
  }

  const profilePayload = {
    id: userId,
    email,
    school_id: schoolId,
    grade: Number(grade),
  };

  if (uname) profilePayload.username = uname;

  const { error: profileErr } = await supabase.from("users").upsert(profilePayload);
  if (profileErr) throw profileErr;
}

async function markClubSeen(userId, clubId) {
  await supabase.from("club_event_reads").upsert(
    { user_id: userId, club_id: clubId, last_seen_at: new Date().toISOString() },
    { onConflict: "user_id,club_id" }
  );
}

function HomePage() {
  return (
    <Page
      title="Run club operations from one clean workspace."
      description="Create clubs, publish events, manage members, and track attendance with a focused workflow."
      showBack={false}
      actions={
        <>
          <Link className="button button--ghost" to="/login?mode=login">Log in</Link>
          <Link className="button" to="/login?mode=signup">Get started</Link>
        </>
      }
      width="narrow"
    >
      <Surface>
        <div className="stack-lg">
          <div className="metric-grid">
            <div className="metric-card">
              <h2>Members</h2>
              <p>Promote admins and keep access tied to club membership.</p>
            </div>
            <div className="metric-card">
              <h2>Events</h2>
              <p>Schedule meetings with duration and automatic event cleanup.</p>
            </div>
            <div className="metric-card">
              <h2>Attendance</h2>
              <p>Collect responses in the same place members already check updates.</p>
            </div>
          </div>
        </div>
      </Surface>
    </Page>
  );
}

function AuthPage() {
  const navigate = useNavigate();
  const initialMode = new URLSearchParams(window.location.search).get("mode") === "signup" ? "signup" : "login";
  const [mode, setMode] = useState(initialMode);
  const [form, setForm] = useState({
    email: "",
    password: "",
    username: "",
    schoolName: "",
    town: "",
    state: "",
    grade: "",
  });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const { toast, notify, clear } = useToast();

  const update = (e) => setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));

  async function onSubmit(e) {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      if (mode === "login") {
        const { error: loginErr } = await supabase.auth.signInWithPassword({
          email: form.email.trim(),
          password: form.password,
        });
        if (loginErr) throw loginErr;
      } else {
        const { data, error: signUpErr } = await supabase.auth.signUp({
          email: form.email.trim(),
          password: form.password,
        });
        if (signUpErr) throw signUpErr;

        if (data.user && data.session) {
          await upsertSchoolAndProfile(
            data.user.id,
            form.email.trim(),
            form.username,
            form.schoolName,
            form.town,
            form.state,
            form.grade
          );
        } else if (data.user && !data.session) {
          notify("info", "Check your email to verify your account, then log in to finish setup.");
          navigate("/login?mode=login");
          return;
        }
      }

      navigate("/dashboard");
    } catch (err) {
      setError(err.message || "Could not authenticate.");
      notify("error", err.message || "Could not authenticate.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Page
      title={mode === "signup" ? "Create your account" : "Log in"}
      description={mode === "signup" ? "Set up your account and school profile in one pass." : "Access your clubs and keep operations moving."}
      width="narrow"
    >
      <Surface>
        <div className="stack-lg">
          <div className="segmented-control" role="tablist" aria-label="Authentication mode">
            <button type="button" className={`segmented-control__item${mode === "login" ? " is-active" : ""}`} onClick={() => setMode("login")}>
              Log in
            </button>
            <button type="button" className={`segmented-control__item${mode === "signup" ? " is-active" : ""}`} onClick={() => setMode("signup")}>
              Sign up
            </button>
          </div>

          <form onSubmit={onSubmit} className="form-grid">
            <label className="field">
              <span>Email</span>
              <input required name="email" type="email" value={form.email} onChange={update} />
            </label>

            <label className="field">
              <span>Password</span>
              <input required name="password" type="password" minLength={8} value={form.password} onChange={update} />
            </label>

            {mode === "signup" && (
              <>
                <label className="field">
                  <span>Username</span>
                  <input required name="username" autoComplete="username" value={form.username} onChange={update} />
                </label>

                <label className="field">
                  <span>School</span>
                  <input required name="schoolName" value={form.schoolName} onChange={update} />
                </label>

                <label className="field">
                  <span>Town</span>
                  <input required name="town" value={form.town} onChange={update} />
                </label>

                <label className="field">
                  <span>State</span>
                  <select required name="state" value={form.state} onChange={update}>
                    <option value="">Select a state</option>
                    {US_STATES.map((state) => <option key={state} value={state}>{state}</option>)}
                  </select>
                </label>

                <label className="field">
                  <span>Grade</span>
                  <input required name="grade" type="number" min="1" max="12" value={form.grade} onChange={update} />
                </label>
              </>
            )}

            <button className="button form-submit" disabled={loading}>
              {loading ? "Working..." : mode === "signup" ? "Create account" : "Log in"}
            </button>
          </form>

          {error ? <p className="status-text status-text--error">{error}</p> : null}
        </div>
        <Toast type={toast?.type} message={toast?.message} onClose={clear} />
      </Surface>
    </Page>
  );
}

function ProtectedRoute({ children }) {
  const { session, loading } = useAuthState();

  if (loading) {
    return (
      <Page title="Loading" description="Checking your session." width="narrow">
        <Surface>
          <Spinner label="Loading..." />
        </Surface>
      </Page>
    );
  }

  if (!session) return <Navigate to="/login" replace />;
  return children;
}

function DashboardPage() {
  const navigate = useNavigate();
  const { session } = useAuthState();
  const [memberClubs, setMemberClubs] = useState([]);
  const [adminClubs, setAdminClubs] = useState([]);
  const [profile, setProfile] = useState(null);
  const [showProfileForm, setShowProfileForm] = useState(false);
  const [completeForm, setCompleteForm] = useState({ username: "", schoolName: "", town: "", state: "", grade: "" });
  const [savingProfile, setSavingProfile] = useState(false);
  const { toast, notify, clear } = useToast();

  const profileComplete = getProfileStatus(profile);

  const allClubs = useMemo(() => {
    const adminItems = adminClubs.map((club) => ({
      ...club,
      roleLabel: "Admin",
      href: `/club/${club.id}/admin`,
    }));
    const memberItems = memberClubs.map((club) => ({
      ...club,
      roleLabel: "Member",
      href: `/club/${club.id}`,
    }));

    return [...adminItems, ...memberItems].sort((a, b) => a.name.localeCompare(b.name));
  }, [adminClubs, memberClubs]);

  async function loadDashboard() {
    const userId = session.user.id;
    const [{ data: membershipRows }, { data: profileRow }] = await Promise.all([
      supabase
        .from("memberships")
        .select("role, club:clubs(id, name, description, meeting_times, school_id, created_at)")
        .eq("user_id", userId),
      supabase
        .from("users")
        .select("id, username, grade, school_id, school:schools(name, town, state)")
        .eq("id", userId)
        .maybeSingle(),
    ]);

    setProfile(profileRow);

    const clubs = (membershipRows || []).map((row) => ({ ...row.club, role: row.role }));
    const memberOnly = clubs.filter((club) => club.role === "member");
    const adminOnly = clubs.filter((club) => club.role === "admin");

    const { data: seenRows } = await supabase.from("club_event_reads").select("club_id, last_seen_at").eq("user_id", userId);
    const seenMap = new Map((seenRows || []).map((row) => [row.club_id, row.last_seen_at]));

    const clubIds = clubs.map((club) => club.id);
    const { data: latestEvents } = clubIds.length
      ? await supabase.from("events").select("club_id, created_at").in("club_id", clubIds).order("created_at", { ascending: false })
      : { data: [] };

    const newestByClub = new Map();
    (latestEvents || []).forEach((event) => {
      if (!newestByClub.has(event.club_id)) newestByClub.set(event.club_id, event.created_at);
    });

    const markDot = (club) => {
      const newest = newestByClub.get(club.id);
      const seen = seenMap.get(club.id);
      return newest && (!seen || new Date(newest) > new Date(seen));
    };

    setMemberClubs(memberOnly.map((club) => ({ ...club, hasNew: markDot(club) })));
    setAdminClubs(adminOnly.map((club) => ({ ...club, hasNew: markDot(club) })));
  }

  useEffect(() => {
    if (session?.user) loadDashboard();
  }, [session?.user?.id]);

  function openCompleteProfile() {
    setCompleteForm({
      username: profile?.username || "",
      schoolName: profile?.school?.name || "",
      town: profile?.school?.town || "",
      state: profile?.school?.state || "",
      grade: profile?.grade != null ? String(profile.grade) : "",
    });
    setShowProfileForm(true);
  }

  function openEditProfile() {
    setCompleteForm({
      username: profile?.username || "",
      schoolName: profile?.school?.name || "",
      town: profile?.school?.town || "",
      state: profile?.school?.state || "",
      grade: profile?.grade != null ? String(profile.grade) : "",
    });
    setShowProfileForm(true);
  }

  async function completeProfile(e) {
    e.preventDefault();
    if (savingProfile) return;

    setSavingProfile(true);

    try {
      await upsertSchoolAndProfile(
        session.user.id,
        session.user.email,
        completeForm.username,
        completeForm.schoolName,
        completeForm.town,
        completeForm.state,
        completeForm.grade
      );
      await loadDashboard();
      notify("success", "Profile saved.");
      setShowProfileForm(false);
    } catch (err) {
      notify("error", err.message || "Could not save profile.");
    } finally {
      setSavingProfile(false);
    }
  }

  return (
    <Page
      title="Dashboard"
      description="Manage clubs, keep your profile current, and jump into the next action quickly."
      actions={
        <>
          <Link className="button button--ghost" to="/join-club">Join club</Link>
          <Link className="button" to="/create-club">Create club</Link>
        </>
      }
    >
      <div className="stack-xl">
        <Surface>
          <SectionHeader
            title="Profile"
            meta={profileComplete ? "Your account is ready for club management." : "Complete your profile to unlock the full workflow."}
            action={
              !showProfileForm && (
                <button type="button" className={profileComplete ? "button button--ghost" : "button"} onClick={profileComplete ? openEditProfile : openCompleteProfile}>
                  {profileComplete ? "Edit profile" : "Complete profile"}
                </button>
              )
            }
          />

          {showProfileForm ? (
            <form className="form-grid form-grid--two-col" onSubmit={completeProfile}>
              <label className="field">
                <span>Username</span>
                <input required value={completeForm.username} onChange={(e) => setCompleteForm((prev) => ({ ...prev, username: e.target.value }))} />
              </label>
              <label className="field">
                <span>School</span>
                <input required value={completeForm.schoolName} onChange={(e) => setCompleteForm((prev) => ({ ...prev, schoolName: e.target.value }))} />
              </label>
              <label className="field">
                <span>Town</span>
                <input required value={completeForm.town} onChange={(e) => setCompleteForm((prev) => ({ ...prev, town: e.target.value }))} />
              </label>
              <label className="field">
                <span>State</span>
                <select required value={completeForm.state} onChange={(e) => setCompleteForm((prev) => ({ ...prev, state: e.target.value }))}>
                  <option value="">Select a state</option>
                  {US_STATES.map((state) => <option key={state} value={state}>{state}</option>)}
                </select>
              </label>
              <label className="field">
                <span>Grade</span>
                <input required type="number" min="1" max="12" value={completeForm.grade} onChange={(e) => setCompleteForm((prev) => ({ ...prev, grade: e.target.value }))} />
              </label>
              <div className="form-actions">
                <button className="button" disabled={savingProfile}>{savingProfile ? "Saving..." : "Save profile"}</button>
                <button type="button" className="button button--ghost" onClick={() => setShowProfileForm(false)}>Cancel</button>
              </div>
            </form>
          ) : (
            <div className="detail-list">
              <div className="detail-row">
                <span>Username</span>
                <strong>{profile?.username || "Not set"}</strong>
              </div>
              <div className="detail-row">
                <span>School</span>
                <strong>{profile?.school ? `${profile.school.name}, ${profile.school.town}, ${profile.school.state}` : "Not set"}</strong>
              </div>
              <div className="detail-row">
                <span>Grade</span>
                <strong>{profile?.grade || "Not set"}</strong>
              </div>
            </div>
          )}
        </Surface>

        <Surface>
          <SectionHeader title="Clubs" meta="Open the workspace that needs attention next." />
          {allClubs.length === 0 ? (
            <EmptyState
              title="No clubs yet"
              description="Create a club to start managing operations or join one that already exists."
              action={
                <div className="button-row">
                  <Link className="button" to="/create-club">Create club</Link>
                  <Link className="button button--ghost" to="/join-club">Join club</Link>
                </div>
              }
            />
          ) : (
            <div className="stack-md">
              {allClubs.map((club) => (
                <button key={`${club.roleLabel}-${club.id}`} type="button" className="list-card" onClick={() => navigate(club.href)}>
                  <div className="list-card__body">
                    <div className="list-card__topline">
                      <h2>{club.name}</h2>
                      <span className={`pill${club.hasNew ? " pill--primary" : ""}`}>{club.hasNew ? "New activity" : club.roleLabel}</span>
                    </div>
                    <p>{club.description}</p>
                  </div>
                </button>
              ))}
            </div>
          )}
        </Surface>

        <Toast type={toast?.type} message={toast?.message} onClose={clear} />
      </div>
    </Page>
  );
}

function CreateClubPage() {
  const navigate = useNavigate();
  const { session } = useAuthState();
  const [form, setForm] = useState({ name: "", description: "", meeting_times: "", school_id: "" });
  const [schools, setSchools] = useState([]);
  const [creatingClub, setCreatingClub] = useState(false);
  const { toast, notify, clear } = useToast();

  useEffect(() => {
    if (!session?.user) return;

    async function load() {
      const [{ data: profile }, { data: schoolRows }] = await Promise.all([
        supabase.from("users").select("school_id").eq("id", session.user.id).single(),
        supabase.from("schools").select("id, name, town, state").order("name"),
      ]);

      setSchools(schoolRows || []);
      setForm((current) => ({ ...current, school_id: profile?.school_id || "" }));
    }

    load();
  }, [session?.user?.id]);

  async function createClub(e) {
    e.preventDefault();
    if (creatingClub) return;

    setCreatingClub(true);
    const { data: authData, error: authErr } = await supabase.auth.getUser();

    if (authErr || !authData?.user?.id) {
      notify("error", "Your session expired. Please log in again.");
      setCreatingClub(false);
      navigate("/login?mode=login");
      return;
    }

    const currentUserId = authData.user.id;

    const { data: club, error: clubErr } = await supabase
      .from("clubs")
      .insert({
        name: form.name,
        description: form.description,
        meeting_times: form.meeting_times,
        school_id: form.school_id,
      })
      .select("id")
      .single();

    if (clubErr) {
      notify("error", clubErr.message || "Could not create club.");
      setCreatingClub(false);
      return;
    }

    const { error: membershipErr } = await supabase.from("memberships").insert({
      user_id: currentUserId,
      club_id: club.id,
      role: "admin",
    });

    if (membershipErr) {
      notify("error", membershipErr.message || "Could not set club admin role.");
      setCreatingClub(false);
      return;
    }

    navigate(`/club/${club.id}/admin`);
  }

  return (
    <Page title="Create club" description="Set up the club once, then manage events and membership from a single admin view." width="narrow">
      <Surface>
        <form className="form-grid" onSubmit={createClub}>
          <label className="field">
            <span>Club name</span>
            <input required value={form.name} onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))} />
          </label>

          <label className="field">
            <span>Description</span>
            <textarea required value={form.description} onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))} />
          </label>

          <label className="field">
            <span>Regular meeting times</span>
            <input required value={form.meeting_times} onChange={(e) => setForm((prev) => ({ ...prev, meeting_times: e.target.value }))} />
          </label>

          <label className="field">
            <span>School</span>
            <select required value={form.school_id} onChange={(e) => setForm((prev) => ({ ...prev, school_id: e.target.value }))}>
              <option value="">Choose school</option>
              {schools.map((school) => (
                <option key={school.id} value={school.id}>{school.name} - {school.town}, {school.state}</option>
              ))}
            </select>
          </label>

          <button className="button form-submit" disabled={creatingClub}>{creatingClub ? "Creating..." : "Create club"}</button>
        </form>
        <Toast type={toast?.type} message={toast?.message} onClose={clear} />
      </Surface>
    </Page>
  );
}

function JoinClubPage() {
  const navigate = useNavigate();
  const { session } = useAuthState();
  const [schools, setSchools] = useState([]);
  const [search, setSearch] = useState("");
  const [schoolId, setSchoolId] = useState("");
  const [clubs, setClubs] = useState([]);
  const [joiningClubId, setJoiningClubId] = useState(null);
  const { toast, notify, clear } = useToast();

  useEffect(() => {
    supabase.from("schools").select("id, name, town, state").order("name").then(({ data }) => setSchools(data || []));
  }, []);

  useEffect(() => {
    if (!schoolId) {
      setClubs([]);
      return;
    }

    let query = supabase.from("clubs").select("id, name, description, meeting_times").eq("school_id", schoolId);
    if (search.trim()) query = query.ilike("name", `%${search.trim()}%`);
    query.order("name").then(({ data }) => setClubs(data || []));
  }, [schoolId, search]);

  async function joinClub(clubId) {
    if (joiningClubId === clubId) return;
    setJoiningClubId(clubId);

    const { data: exists } = await supabase
      .from("memberships")
      .select("id")
      .eq("user_id", session.user.id)
      .eq("club_id", clubId)
      .maybeSingle();

    if (exists) {
      notify("info", "You are already a member of this club.");
      setJoiningClubId(null);
      return;
    }

    const { error } = await supabase.from("memberships").insert({
      user_id: session.user.id,
      club_id: clubId,
      role: "member",
    });

    if (error) {
      notify("error", error.message || "Could not join club.");
      setJoiningClubId(null);
      return;
    }

    navigate(`/club/${clubId}`);
  }

  return (
    <Page title="Join club" description="Search within a school, review the club details, and join with one action.">
      <div className="stack-xl">
        <Surface>
          <form className="form-grid form-grid--two-col" onSubmit={(e) => e.preventDefault()}>
            <label className="field">
              <span>School</span>
              <input
                list="schools"
                placeholder="Type to search schools"
                onChange={(e) => {
                  const match = schools.find((school) => `${school.name} - ${school.town}, ${school.state}` === e.target.value);
                  setSchoolId(match?.id || "");
                }}
              />
              <datalist id="schools">
                {schools.map((school) => <option key={school.id} value={`${school.name} - ${school.town}, ${school.state}`} />)}
              </datalist>
            </label>

            <label className="field">
              <span>Search clubs</span>
              <input value={search} onChange={(e) => setSearch(e.target.value)} />
            </label>
          </form>
        </Surface>

        <Surface>
          <SectionHeader title="Available clubs" meta={schoolId ? `${clubs.length} clubs found` : "Select a school to see available clubs."} />
          {!schoolId ? (
            <EmptyState title="Pick a school first" description="Once you choose a school, matching clubs will appear here." />
          ) : clubs.length === 0 ? (
            <EmptyState title="No clubs found" description="Try a different school or a broader search term." />
          ) : (
            <div className="card-grid">
              {clubs.map((club) => (
                <article key={club.id} className="info-card">
                  <div className="stack-md">
                    <div className="stack-sm">
                      <h2>{club.name}</h2>
                      <p>{club.description}</p>
                    </div>
                    <div className="detail-row">
                      <span>Meets</span>
                      <strong>{club.meeting_times}</strong>
                    </div>
                    <button className="button" onClick={() => joinClub(club.id)} disabled={joiningClubId === club.id}>
                      {joiningClubId === club.id ? "Joining..." : "Join club"}
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </Surface>

        <Toast type={toast?.type} message={toast?.message} onClose={clear} />
      </div>
    </Page>
  );
}

function EventDetailsPage() {
  const { id, eventId } = useParams();
  const { session } = useAuthState();
  const [club, setClub] = useState(null);
  const [event, setEvent] = useState(null);
  const [attendees, setAttendees] = useState([]);
  const [loading, setLoading] = useState(true);
  const { toast, notify, clear } = useToast();

  useEffect(() => {
    if (!session?.user) return;

    async function load() {
      setLoading(true);
      const [{ data: clubRow, error: clubErr }, { data: eventRow, error: eventErr }, { data: attendanceRows, error: attendanceErr }] = await Promise.all([
        supabase.from("clubs").select("id, name").eq("id", id).maybeSingle(),
        supabase.from("events").select("id, club_id, name, date, location, duration_minutes").eq("id", eventId).eq("club_id", id).maybeSingle(),
        supabase
          .from("attendance")
          .select("id, status, user_id, user:users!attendance_user_id_fkey(username,email)")
          .eq("event_id", eventId)
          .order("status")
      ]);

      if (clubErr) notify("error", clubErr.message || "Could not load club.");
      if (eventErr) notify("error", eventErr.message || "Could not load event.");
      if (attendanceErr) notify("error", attendanceErr.message || "Could not load attendance list.");

      setClub(clubRow || null);
      setEvent(eventRow || null);
      setAttendees(attendanceRows || []);
      setLoading(false);
    }

    load();
  }, [eventId, id, session?.user?.id]);

  if (loading) {
    return (
      <Page title="Event details" description="Loading event information." width="narrow">
        <Surface>
          <Spinner label="Loading event..." />
        </Surface>
      </Page>
    );
  }

  return (
    <Page
      title={event?.name || "Event details"}
      description={club?.name ? `Attendance and event details for ${club.name}.` : "Attendance and event details."}
      actions={club ? <Link className="button button--ghost" to={`/club/${club.id}`}>Back to club</Link> : null}
    >
      <div className="stack-xl">
        <Surface>
          <SectionHeader title="Overview" />
          {event ? (
            <div className="detail-list">
              <div className="detail-row">
                <span>Starts</span>
                <strong>{formatEventDate(event.date)}</strong>
              </div>
              <div className="detail-row">
                <span>Location</span>
                <strong>{event.location}</strong>
              </div>
              <div className="detail-row">
                <span>Duration</span>
                <strong>{formatDuration(event.duration_minutes)}</strong>
              </div>
            </div>
          ) : (
            <EmptyState title="Event not found" description="This event may have been removed or you may not have access to it." />
          )}
        </Surface>

        <Surface>
          <SectionHeader title="Attendance" meta={attendees.length ? `${attendees.length} responses` : "No responses yet"} />
          {attendees.length === 0 ? (
            <EmptyState title="No attendance responses yet" description="Responses will appear here once members update their attendance." />
          ) : (
            <div className="stack-sm">
              {attendees.map((entry) => (
                <div key={entry.id} className="detail-row detail-row--interactive">
                  <div>
                    <strong>{entry.user?.username || entry.user?.email || entry.user_id}</strong>
                    <p>{entry.status}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Surface>

        <Toast type={toast?.type} message={toast?.message} onClose={clear} />
      </div>
    </Page>
  );
}

function ClubPage() {
  const { id } = useParams();
  const { session } = useAuthState();
  const [club, setClub] = useState(null);
  const [events, setEvents] = useState([]);
  const [attendanceMap, setAttendanceMap] = useState({});
  const [updatingAttendanceId, setUpdatingAttendanceId] = useState(null);
  const { toast, notify, clear } = useToast();

  async function load() {
    const [{ data: clubRow, error: clubErr }, { data: eventRows, error: eventErr }, { data: attendanceRows, error: attendanceErr }] = await Promise.all([
      supabase.from("clubs").select("name, description, meeting_times").eq("id", id).maybeSingle(),
      supabase.from("events").select("id, name, date, location, duration_minutes").eq("club_id", id).order("date"),
      supabase.from("attendance").select("event_id, status").eq("user_id", session.user.id),
    ]);

    if (clubErr) {
      notify("error", clubErr.message || "Could not load club.");
      setClub(null);
    } else {
      setClub(clubRow);
    }

    if (eventErr) {
      notify("error", eventErr.message || "Could not load events.");
      setEvents([]);
      return;
    }

    if (attendanceErr) {
      notify("error", attendanceErr.message || "Could not load attendance.");
      setAttendanceMap({});
      return;
    }

    setEvents((eventRows || []).filter(isEventVisible));
    const map = {};
    (attendanceRows || []).forEach((row) => {
      map[row.event_id] = row.status;
    });
    setAttendanceMap(map);
    await markClubSeen(session.user.id, id);
  }

  useEffect(() => {
    if (session?.user) load();
  }, [id, session?.user?.id]);

  async function setAttendance(eventId, status) {
    if (updatingAttendanceId === eventId) return;

    const previous = attendanceMap[eventId] || "maybe";
    setUpdatingAttendanceId(eventId);
    setAttendanceMap((prev) => ({ ...prev, [eventId]: status }));

    const { error } = await supabase.from("attendance").upsert(
      { user_id: session.user.id, event_id: eventId, status },
      { onConflict: "user_id,event_id" }
    );

    if (error) {
      setAttendanceMap((prev) => ({ ...prev, [eventId]: previous }));
      notify("error", error.message || "Could not update attendance.");
      setUpdatingAttendanceId(null);
      return;
    }

    notify("success", "Attendance updated.");
    setUpdatingAttendanceId(null);
  }

  return (
    <Page
      title={club?.name || "Club"}
      description={club?.description || "Review upcoming events and keep your attendance current."}
      actions={<Link className="button button--ghost" to={`/club/${id}/admin`}>Admin view</Link>}
    >
      <div className="stack-xl">
        <Surface>
          <SectionHeader title="Schedule" meta={club?.meeting_times || "No regular meeting time listed yet."} />
        </Surface>

        <Surface>
          <SectionHeader title="Events" meta={events.length ? `${events.length} active events` : "No active events"} />
          {events.length === 0 ? (
            <EmptyState title="No active events" description="Events appear here until one hour after they finish." />
          ) : (
            <div className="stack-md">
              {events.map((event) => (
                <EventListCard
                  key={event.id}
                  event={event}
                  href={`/club/${id}/event/${event.id}`}
                  attendanceValue={attendanceMap[event.id] || "maybe"}
                  attendanceDisabled={updatingAttendanceId === event.id}
                  onAttendanceChange={(e) => setAttendance(event.id, e.target.value)}
                />
              ))}
            </div>
          )}
        </Surface>

        <Toast type={toast?.type} message={toast?.message} onClose={clear} />
      </div>
    </Page>
  );
}

function ClubAdminPage() {
  const navigate = useNavigate();
  const { id } = useParams();
  const { session } = useAuthState();
  const durationHours = Array.from({ length: 9 }, (_, index) => index);
  const durationMinutes = [0, 15, 30, 45];
  const [club, setClub] = useState(null);
  const [events, setEvents] = useState([]);
  const [members, setMembers] = useState([]);
  const [eventForm, setEventForm] = useState({ name: "", date: "", location: "", durationHours: "1", durationMinutes: "0" });
  const [attendanceMap, setAttendanceMap] = useState({});
  const [accessChecked, setAccessChecked] = useState(false);
  const [pageLoading, setPageLoading] = useState(true);
  const [addingEvent, setAddingEvent] = useState(false);
  const [updatingEventId, setUpdatingEventId] = useState(null);
  const [promotingId, setPromotingId] = useState(null);
  const [updatingAttendanceId, setUpdatingAttendanceId] = useState(null);
  const [deletingEventId, setDeletingEventId] = useState(null);
  const { toast, notify, clear } = useToast();

  const isValid = useMemo(() => {
    const totalMinutes = Number(eventForm.durationHours) * 60 + Number(eventForm.durationMinutes);
    return eventForm.name && eventForm.date && eventForm.location && totalMinutes > 0;
  }, [eventForm]);

  async function load() {
    setPageLoading(true);

    const { data: myMembership } = await supabase
      .from("memberships")
      .select("role")
      .eq("club_id", id)
      .eq("user_id", session.user.id)
      .maybeSingle();

    if (!myMembership || myMembership.role !== "admin") {
      navigate(`/club/${id}`, { replace: true });
      return;
    }

    const [{ data: clubRow }, { data: eventRows }, { data: memberRows }, { data: attendanceRows }] = await Promise.all([
      supabase.from("clubs").select("name, description").eq("id", id).maybeSingle(),
      supabase.from("events").select("id, name, date, location, duration_minutes").eq("club_id", id).order("date"),
      supabase.from("memberships").select("id, role, user_id, user:users!memberships_user_id_fkey(username,email)").eq("club_id", id),
      supabase.from("attendance").select("event_id, status").eq("user_id", session.user.id),
    ]);

    setClub(clubRow || null);
    setEvents((eventRows || []).filter(isEventVisible));
    setMembers(memberRows || []);

    const map = {};
    (attendanceRows || []).forEach((row) => {
      map[row.event_id] = row.status;
    });
    setAttendanceMap(map);

    await markClubSeen(session.user.id, id);
    setAccessChecked(true);
    setPageLoading(false);
  }

  useEffect(() => {
    if (session?.user) load();
  }, [id, session?.user?.id]);

  async function addEvent() {
    if (addingEvent) return;
    setAddingEvent(true);

    const totalMinutes = Number(eventForm.durationHours) * 60 + Number(eventForm.durationMinutes);
    const { error } = await supabase.from("events").insert({
      club_id: id,
      name: eventForm.name,
      date: new Date(eventForm.date).toISOString(),
      location: eventForm.location,
      duration_minutes: totalMinutes,
    });

    if (error) {
      notify("error", error.message || "Could not add event.");
      setAddingEvent(false);
      return;
    }

    setEventForm({ name: "", date: "", location: "", durationHours: "1", durationMinutes: "0" });
    notify("success", "Event added.");
    await load();
    setAddingEvent(false);
  }

  async function updateEvent(eventId, patch) {
    if (updatingEventId === eventId) return;
    setUpdatingEventId(eventId);

    const { error } = await supabase.from("events").update(patch).eq("id", eventId);
    if (error) {
      notify("error", error.message || "Could not update event.");
      setUpdatingEventId(null);
      return;
    }

    notify("success", "Event updated.");
    await load();
    setUpdatingEventId(null);
  }

  async function deleteEvent(eventId) {
    if (deletingEventId === eventId) return;
    if (!window.confirm("Delete this event? Attendance for it will be removed.")) return;
    setDeletingEventId(eventId);

    const { error } = await supabase.from("events").delete().eq("id", eventId);
    if (error) {
      notify("error", error.message || "Could not delete event.");
      setDeletingEventId(null);
      return;
    }

    notify("success", "Event deleted.");
    await load();
    setDeletingEventId(null);
  }

  async function promote(memberId) {
    if (promotingId === memberId) return;
    setPromotingId(memberId);

    const { error } = await supabase.from("memberships").update({ role: "admin" }).eq("id", memberId);
    if (error) {
      notify("error", error.message || "Could not promote member.");
      setPromotingId(null);
      return;
    }

    notify("success", "Member promoted to admin.");
    await load();
    setPromotingId(null);
  }

  async function setAttendance(eventId, status) {
    if (updatingAttendanceId === eventId) return;

    const previous = attendanceMap[eventId] || "maybe";
    setUpdatingAttendanceId(eventId);
    setAttendanceMap((prev) => ({ ...prev, [eventId]: status }));

    const { error } = await supabase.from("attendance").upsert(
      { user_id: session.user.id, event_id: eventId, status },
      { onConflict: "user_id,event_id" }
    );

    if (error) {
      setAttendanceMap((prev) => ({ ...prev, [eventId]: previous }));
      notify("error", error.message || "Could not update attendance.");
      setUpdatingAttendanceId(null);
      return;
    }

    notify("success", "Attendance updated.");
    setUpdatingAttendanceId(null);
  }

  if (!accessChecked || pageLoading) {
    return (
      <Page title="Admin view" description="Loading club administration tools." width="narrow">
        <Surface>
          <Spinner label="Checking admin access..." />
        </Surface>
      </Page>
    );
  }

  return (
    <Page
      title={club?.name || "Club admin"}
      description={club?.description || "Manage events, members, and attendance from one place."}
      actions={<Link className="button button--ghost" to={`/club/${id}`}>Member view</Link>}
    >
      <div className="stack-xl">
        <Surface>
          <SectionHeader title="New event" meta="Publish an event with a clear start time and duration." />
          <form className="form-grid form-grid--event" onSubmit={(e) => { e.preventDefault(); addEvent(); }}>
            <label className="field">
              <span>Name</span>
              <input value={eventForm.name} onChange={(e) => setEventForm((prev) => ({ ...prev, name: e.target.value }))} />
            </label>
            <label className="field">
              <span>Date</span>
              <input type="datetime-local" value={eventForm.date} onChange={(e) => setEventForm((prev) => ({ ...prev, date: e.target.value }))} />
            </label>
            <label className="field">
              <span>Location</span>
              <input value={eventForm.location} onChange={(e) => setEventForm((prev) => ({ ...prev, location: e.target.value }))} />
            </label>
            <label className="field">
              <span>Hours</span>
              <select value={eventForm.durationHours} onChange={(e) => setEventForm((prev) => ({ ...prev, durationHours: e.target.value }))}>
                {durationHours.map((hour) => <option key={hour} value={String(hour)}>{hour}</option>)}
              </select>
            </label>
            <label className="field">
              <span>Minutes</span>
              <select value={eventForm.durationMinutes} onChange={(e) => setEventForm((prev) => ({ ...prev, durationMinutes: e.target.value }))}>
                {durationMinutes.map((minute) => <option key={minute} value={String(minute)}>{minute}</option>)}
              </select>
            </label>
            <button className="button form-submit" disabled={!isValid || addingEvent}>
              {addingEvent ? "Adding..." : "Add event"}
            </button>
          </form>
        </Surface>

        <Surface>
          <SectionHeader title="Members" meta={`${members.length} people in this club`} />
          <div className="stack-sm">
            {members.map((member) => (
              <div key={member.id} className="detail-row detail-row--interactive">
                <div>
                  <strong>{member.user?.username || member.user?.email || member.user_id}</strong>
                  <p>{member.role}</p>
                </div>
                {member.role !== "admin" ? (
                  <button className="button button--ghost" onClick={() => promote(member.id)} disabled={promotingId === member.id}>
                    {promotingId === member.id ? "Promoting..." : "Make admin"}
                  </button>
                ) : (
                  <span className="pill">Admin</span>
                )}
              </div>
            ))}
          </div>
        </Surface>

        <Surface>
          <SectionHeader title="Active events" meta={events.length ? `${events.length} events visible to members` : "No active events"} />
          {events.length === 0 ? (
            <EmptyState title="No active events" description="Add an event to give members something to respond to." />
          ) : (
            <div className="stack-md">
              {events.map((event) => (
                <div key={event.id} className="stack-md">
                  <EventListCard
                    event={event}
                    href={`/club/${id}/event/${event.id}`}
                    attendanceValue={attendanceMap[event.id] || "maybe"}
                    attendanceDisabled={updatingAttendanceId === event.id}
                    onAttendanceChange={(e) => setAttendance(event.id, e.target.value)}
                    action={
                      <div className="button-row">
                        <Link className="button button--ghost" to={`/club/${id}/event/${event.id}`}>View details</Link>
                        <button
                          type="button"
                          className="button button--ghost"
                          onClick={() => deleteEvent(event.id)}
                          disabled={deletingEventId === event.id || updatingEventId === event.id}
                        >
                          {deletingEventId === event.id ? "Deleting..." : "Delete"}
                        </button>
                      </div>
                    }
                  />

                  <div className="info-card">
                    <div className="form-grid form-grid--two-col">
                      <label className="field">
                        <span>Name</span>
                        <input
                          value={event.name}
                          onChange={(e) => setEvents((prev) => prev.map((item) => item.id === event.id ? { ...item, name: e.target.value } : item))}
                          onBlur={() => updateEvent(event.id, { name: event.name })}
                          disabled={updatingEventId === event.id}
                        />
                      </label>
                      <label className="field">
                        <span>Date</span>
                        <input
                          type="datetime-local"
                          value={toLocalDateTimeInput(event.date)}
                          onChange={(e) => updateEvent(event.id, { date: new Date(e.target.value).toISOString() })}
                          disabled={updatingEventId === event.id}
                        />
                      </label>
                      <label className="field">
                        <span>Location</span>
                        <input
                          value={event.location}
                          onChange={(e) => setEvents((prev) => prev.map((item) => item.id === event.id ? { ...item, location: e.target.value } : item))}
                          onBlur={() => updateEvent(event.id, { location: event.location })}
                          disabled={updatingEventId === event.id}
                        />
                      </label>
                      <div className="detail-row">
                        <span>Duration</span>
                        <strong>{formatDuration(event.duration_minutes)}</strong>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Surface>

        <Toast type={toast?.type} message={toast?.message} onClose={clear} />
      </div>
    </Page>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/login" element={<AuthPage />} />
      <Route path="/dashboard" element={<ProtectedRoute><DashboardPage /></ProtectedRoute>} />
      <Route path="/create-club" element={<ProtectedRoute><CreateClubPage /></ProtectedRoute>} />
      <Route path="/join-club" element={<ProtectedRoute><JoinClubPage /></ProtectedRoute>} />
      <Route path="/club/:id" element={<ProtectedRoute><ClubPage /></ProtectedRoute>} />
      <Route path="/club/:id/event/:eventId" element={<ProtectedRoute><EventDetailsPage /></ProtectedRoute>} />
      <Route path="/club/:id/admin" element={<ProtectedRoute><ClubAdminPage /></ProtectedRoute>} />
    </Routes>
  );
}
